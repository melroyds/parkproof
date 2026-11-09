// @vitest-environment happy-dom
//
// The client side of the evidence chain (spec N2, T0b1), end to end: the
// browser's requests go to the REAL Lambda handler (lambda/index.js) with a
// local P-256 test key, so every request shape the client builds is one the
// server accepts, and every bundle the client stores verifies.
//
// Covered: link 0 v1/v2, arrival_context queued at save before link 0 is
// signed, queue ordering (two quick appends, a pending parent, rejected-link
// renumbering, double-sign protection, Web Locks), transient vs rejected,
// the 60 s sweep throttle with no retry cap, the departure catch-up, the
// triggers and the cloud-mirror hook.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession, SignatureBundle } from '../types'

vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

import { handleSignSessionRequest } from '../../lambda/index.js'
import { AddendumValidationError } from '../../lambda/addendum-schema.js'
import { getSession, loadSessions, saveSession } from './storage'
import { emptyLogDraft, ERR_SIGNED_DATA_MISMATCH } from './evidence-chain'
import {
  RETRY_HORIZON_MS,
  SWEEP_THROTTLE_MS,
  addendumSigningHeld,
  arrivalSigningRejection,
  chainKeyHash,
  computeV1Hashes,
  enqueueSigning,
  hashDataUrlImage,
  holdAddendumSigning,
  installSigningTriggers,
  markEndedOnThisDevice,
  prepareNewRecord,
  queueAddendum,
  releaseAddendumSigning,
  resetSigningQueueForTests,
  runSigningSweep,
  scheduleDepartureCatchUp,
  setSignedRecordListener,
  signNewRecord,
  whenSigningIdle,
} from './signing'

const KEY = 'parkproof.sessions.v1'
// The test "KMS" key, made with WebCrypto (this file is type-checked as
// browser code, so no node:crypto). WebCrypto ECDSA signatures are raw
// r||s; KMS and the Lambda use DER, so the helpers below convert.
const ECDSA = { name: 'ECDSA', hash: 'SHA-256' } as const
let testKey: CryptoKeyPair
let TEST_PUBLIC_PEM = ''

const bytesToBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
const base64ToBytes = (b64: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const utf8 = (text: string) => new TextEncoder().encode(text)

/** One DER INTEGER from a 32-byte big-endian value. */
function derInteger(value: Uint8Array): number[] {
  let i = 0
  while (i < value.length - 1 && value[i] === 0) i++
  const body = Array.from(value.slice(i))
  if (body[0] & 0x80) body.unshift(0)
  return [0x02, body.length, ...body]
}
function rawToDer(raw: Uint8Array): Uint8Array {
  const r = derInteger(raw.slice(0, 32))
  const s = derInteger(raw.slice(32, 64))
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s])
}
function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  const rLen = der[3]
  const r = der.slice(4, 4 + rLen)
  const sLen = der[5 + rLen]
  const s = der.slice(6 + rLen, 6 + rLen + sLen)
  const out = new Uint8Array(64)
  const put = (x: Uint8Array, at: number) => {
    const trimmed = x.length > 32 ? x.slice(x.length - 32) : x
    out.set(trimmed, at + 32 - trimmed.length)
  }
  put(r, 0)
  put(s, 32)
  return out
}
async function signDer(message: Uint8Array): Promise<Uint8Array> {
  const raw = new Uint8Array(await crypto.subtle.sign(ECDSA, testKey.privateKey, message as Uint8Array<ArrayBuffer>))
  return rawToDer(raw)
}
async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(text)))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

beforeAll(async () => {
  testKey = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', testKey.publicKey))
  const NL = String.fromCharCode(10)
  const lines = bytesToBase64(spki).match(/.{1,64}/g)!.join(NL)
  TEST_PUBLIC_PEM = ['-----BEGIN PUBLIC KEY-----', lines, '-----END PUBLIC KEY-----', ''].join(NL)
})

const SIGN_BYTES = 'fake-jpeg-bytes-of-a-sign'
const SIGN_PHOTO = 'data:image/jpeg;base64,' + btoa(SIGN_BYTES)

type Body = Record<string, unknown> & { schema?: string; seq?: number; kind?: string; addendum_id?: string }
type Override = { status: number; json: unknown } | 'network' | null
type OverrideResult = Override | Promise<Override>

/** The fake network: every request is logged; `override` can answer instead of the server. */
const net: {
  calls: Body[]
  override: ((body: Body, index: number) => OverrideResult) | null
  onCall: ((body: Body) => void) | null
} = { calls: [], override: null, onCall: null }

async function fakeFetch(_url: string, init: RequestInit): Promise<Response> {
  const text = init.body as string
  const body = JSON.parse(text) as Body
  net.calls.push(body)
  net.onCall?.(body)
  const forced = (await net.override?.(body, net.calls.length - 1)) ?? null
  if (forced === 'network') throw new TypeError('Failed to fetch')
  if (forced) return new Response(JSON.stringify(forced.json), { status: forced.status })
  const res = await handleSignSessionRequest(
    { body: text },
    {
      signer: ({ message }) => signDer(message),
      keyAlias: 'test-local',
      parentPublicKeys: [TEST_PUBLIC_PEM],
    },
  )
  return new Response(res.body, { status: res.statusCode })
}

/** Verify a stored bundle the way any third party would: P-256 over the payload bytes. */
const verifies = async (b: SignatureBundle) =>
  crypto.subtle.verify(ECDSA, testKey.publicKey, derToRaw(base64ToBytes(b.signature_base64)), utf8(b.canonical_payload))
const payloadOf = (b: SignatureBundle) => JSON.parse(b.canonical_payload) as Record<string, unknown>
const kinds = () => net.calls.map((c) => (c.schema === 'parkproof-addendum-v1' ? `${c.kind}#${c.seq}` : c.schema ?? 'v1'))

let seqId = 0
function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  seqId++
  return {
    id: `rec-${seqId}`,
    arrived_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 9 },
    sign_photo: SIGN_PHOTO,
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: new Date(Date.now() + 90 * 60_000).toISOString(),
    confidence: 'high',
    ...overrides,
  }
}

/** Save a new record the way App does: chain key + hashes, save, then start the chain. */
async function saveNew(overrides: Partial<ParkingSession> = {}): Promise<ParkingSession> {
  const prepared = await prepareNewRecord(record(overrides))
  saveSession(prepared)
  signNewRecord(prepared.id, emptyLogDraft())
  await whenSigningIdle(prepared.id)
  return getSession(prepared.id)!
}

const departure = (ended_at: string) => ({
  ended_at,
  location: null,
  distance_from_arrival_m: null,
  return_photos: [] as never[],
})
const condition = () => ({
  when: 'parking' as const,
  photos: [{ role: 'condition-front' as const, sha256: 'a'.repeat(64), captured_at: new Date().toISOString(), source: 'camera_input' as const }],
  note: null,
})

beforeEach(() => {
  localStorage.clear()
  resetSigningQueueForTests()
  net.calls.length = 0
  net.override = null
  net.onCall = null
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

afterEach(async () => {
  await whenSigningIdle()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('a new record: chain key, v1_hashes, link 0 (v2) and link 1', () => {
  it('prepareNewRecord adds a 64-hex chain key and the photo hashes', async () => {
    const prepared = await prepareNewRecord(record())
    expect(prepared.chain_key).toMatch(/^[0-9a-f]{64}$/)
    expect(prepared.v1_hashes).toEqual({ sign: (await sha256Hex(SIGN_BYTES)), car: null, ambient: null })
    expect(await hashDataUrlImage(SIGN_PHOTO)).toBe((await sha256Hex(SIGN_BYTES)))
    const again = await prepareNewRecord(record())
    expect(again.chain_key).not.toBe(prepared.chain_key)
  })

  it('queues arrival_context as link 1 before link 0 is requested, then signs 0 and 1 in order', async () => {
    let addendaAtFirstCall: number | null = null
    net.onCall = (body) => {
      if (addendaAtFirstCall === null) {
        addendaAtFirstCall = getSession(body.session_id as string)?.addenda?.length ?? 0
      }
    }
    const s = await saveNew()
    expect(addendaAtFirstCall).toBe(1)
    expect(kinds()).toEqual(['parkproof-evidence-v2', 'arrival_context#1'])

    expect(s.signature?.schema).toBe('parkproof-evidence-v2')
    expect(payloadOf(s.signature!).chain_key_sha256).toBe(await chainKeyHash(s.chain_key!))
    expect(payloadOf(s.signature!).sign_photo_sha256).toBe((await sha256Hex(SIGN_BYTES)))
    expect(await verifies(s.signature!)).toBe(true)

    const link1 = s.addenda![0]
    expect(link1).toMatchObject({ seq: 1, kind: 'arrival_context' })
    const p1 = payloadOf(link1.bundle!)
    expect(p1.parent_payload_sha256).toBe(await sha256Hex(s.signature!.canonical_payload))
    expect(p1.chain_key_sha256).toBe(payloadOf(s.signature!).chain_key_sha256)
    expect(p1.data).toEqual(link1.data)
    expect(await verifies(link1.bundle!)).toBe(true)
    // The secret itself never leaves in a payload.
    expect(link1.bundle!.canonical_payload).not.toContain(s.chain_key!)
  })

  it('an empty draft still gives a full arrival_context with every field null', async () => {
    const s = await saveNew({ sign_photo: null, no_sign: true, rules: '', expires_at: null, confidence: 'low' })
    expect(s.addenda![0].data).toEqual({
      driver_name: null,
      sign_status: null,
      sign_issues: [],
      rule_flags: null,
      gate_acks: null,
      permit_commitment: null,
      photos: [],
      condition_note: null,
      compliance_type: null,
      jurisdiction: null,
      workday: null,
      boundary: null,
    })
    expect(s.addenda![0].bundle).toBeDefined()
  })

  it('a record saved before the chain (no chain key) signs link 0 as v1', async () => {
    const old = record()
    saveSession(old)
    await enqueueSigning(old.id)
    const s = getSession(old.id)!
    expect(net.calls[0].schema).toBeUndefined()
    expect(s.signature?.schema).toBe('parkproof-evidence-v1')
    expect(payloadOf(s.signature!).chain_key_sha256).toBeUndefined()
  })

  it('the signed-record listener runs once per drain that stored a bundle', async () => {
    const listener = vi.fn()
    setSignedRecordListener(listener)
    const s = await saveNew()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(s.id)
    await enqueueSigning(s.id) // nothing left to sign
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('a record signed before the listener is set (sign-in still resolving) is mirrored once it is', async () => {
    setSignedRecordListener(null)
    const s = await saveNew()
    expect(s.signature).toBeDefined()
    const mirror = vi.fn()
    setSignedRecordListener(mirror)
    expect(mirror).toHaveBeenCalledTimes(1)
    expect(mirror).toHaveBeenCalledWith(s.id)
    // Replayed once only.
    setSignedRecordListener(null)
    setSignedRecordListener(mirror)
    expect(mirror).toHaveBeenCalledTimes(1)
  })

  it('prepareNewRecord stores the driver’s text the way link 1 signs it', async () => {
    const NL = String.fromCharCode(10)
    const prepared = await prepareNewRecord(
      record({ driver_name: '  Sam' + NL + 'Lee ', condition_note: 'Scratch on' + NL + 'rear bumper ' + 'x'.repeat(300) }),
    )
    expect(prepared.driver_name).toBe('Sam Lee')
    expect(prepared.condition_note).toHaveLength(280)
    expect(prepared.condition_note!.startsWith('Scratch on rear bumper')).toBe(true)
    saveSession(prepared)
    signNewRecord(prepared.id, emptyLogDraft())
    await whenSigningIdle(prepared.id)
    const link1 = getSession(prepared.id)!.addenda![0]
    expect(payloadOf(link1.bundle!).data).toMatchObject({
      driver_name: prepared.driver_name,
      condition_note: prepared.condition_note,
    })
    expect(getSession(prepared.id)!.driver_name).toBe('Sam Lee')
    // Fields the record doesn't have stay absent; cleared ones stay null.
    const plain = await prepareNewRecord(record())
    expect('driver_name' in plain).toBe(false)
    expect('condition_note' in plain).toBe(false)
    expect((await prepareNewRecord(record({ driver_name: null }))).driver_name).toBeNull()
  })
})

describe('queue ordering', () => {
  it('two quick appends get seq 2 and 3 from fresh reads and sign in order, each on its parent', async () => {
    const s = await saveNew()
    net.calls.length = 0
    const a = queueAddendum(s.id, 'condition', condition())!
    const b = queueAddendum(s.id, 'departure', departure(new Date().toISOString()))!
    expect([a.seq, b.seq]).toEqual([2, 3])
    await whenSigningIdle(s.id)
    expect(kinds()).toEqual(['condition#2', 'departure#3'])
    const after = getSession(s.id)!
    const [l1, l2, l3] = after.addenda!
    expect(payloadOf(l2.bundle!).parent_payload_sha256).toBe(await sha256Hex(l1.bundle!.canonical_payload))
    expect(payloadOf(l3.bundle!).parent_payload_sha256).toBe(await sha256Hex(l2.bundle!.canonical_payload))
  })

  it('an addendum is not sent while its parent (link 0) is unsigned', async () => {
    net.override = (body) => (body.schema === 'parkproof-evidence-v2' ? { status: 503, json: { error: 'down' } } : null)
    const s = await saveNew()
    expect(kinds()).toEqual(['parkproof-evidence-v2'])
    expect(s.signature).toBeUndefined()
    expect(s.addenda![0].bundle).toBeUndefined()
    expect(s.addenda![0].rejected).toBeUndefined()

    net.override = null
    await enqueueSigning(s.id)
    expect(kinds()).toEqual(['parkproof-evidence-v2', 'parkproof-evidence-v2', 'arrival_context#1'])
    expect(getSession(s.id)!.addenda![0].bundle).toBeDefined()
  })

  it('a rejected link is never retried; later pending links are renumbered after it and signed', async () => {
    const s = await saveNew()
    net.calls.length = 0
    net.override = (body) =>
      body.kind === 'condition' ? { status: 400, json: { error: 'ERR_BAD_STRING', field: 'data.note' } } : null
    queueAddendum(s.id, 'condition', condition()) // seq 2: refused
    const c = queueAddendum(s.id, 'departure', departure(new Date().toISOString()))! // seq 3 -> 2
    expect(c.seq).toBe(3)
    await whenSigningIdle(s.id)

    const after = getSession(s.id)!
    const [l1, rejected, renumbered] = after.addenda!
    expect(rejected.rejected?.code).toBe('ERR_BAD_STRING')
    expect(rejected.bundle).toBeUndefined()
    expect(rejected.seq).toBe(2)
    expect(renumbered.seq).toBe(2)
    expect(payloadOf(renumbered.bundle!).seq).toBe(2)
    expect(payloadOf(renumbered.bundle!).parent_payload_sha256).toBe(await sha256Hex(l1.bundle!.canonical_payload))
    expect(kinds()).toEqual(['condition#2', 'departure#2'])

    // Never retried, and a new addendum follows the last signed link.
    net.calls.length = 0
    await enqueueSigning(s.id)
    expect(net.calls).toHaveLength(0)
    expect(queueAddendum(s.id, 'condition', condition())!.seq).toBe(3)
  })

  it('double-sign protection: concurrent triggers send each link once', async () => {
    const prepared = await prepareNewRecord(record())
    saveSession(prepared)
    signNewRecord(prepared.id, emptyLogDraft())
    void enqueueSigning(prepared.id)
    void enqueueSigning(prepared.id)
    runSigningSweep()
    await whenSigningIdle()
    expect(kinds()).toEqual(['parkproof-evidence-v2', 'arrival_context#1'])
  })

  it('runs every drain inside the record’s Web Lock when the browser has one', async () => {
    const names: string[] = []
    const request = vi.fn(async (name: string, cb: () => Promise<void>) => {
      names.push(name)
      return cb()
    })
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
    try {
      const s = await saveNew()
      expect(names).toEqual([`pp-sign-${s.id}`])
      expect(getSession(s.id)!.addenda![0].bundle).toBeDefined()
    } finally {
      Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true })
    }
  })

  it('a returned payload that differs from the stored data is not stored', async () => {
    const s = await saveNew()
    net.override = (body) => {
      if (body.kind !== 'condition') return null
      return tamperedBundle(body).then((json) => ({ status: 200, json }))
    }
    const a = queueAddendum(s.id, 'condition', condition())!
    await whenSigningIdle(s.id)
    const stored = getSession(s.id)!.addenda!.find((x) => x.id === a.id)!
    expect(stored.bundle).toBeUndefined()
    expect(stored.rejected?.code).toBe(ERR_SIGNED_DATA_MISMATCH)
  })

  it('a returned payload with a different chain key hash is not stored', async () => {
    const s = await saveNew()
    net.override = (body) =>
      body.kind === 'condition' ? tamperedBundle(body, 'chain').then((json) => ({ status: 200, json })) : null
    const a = queueAddendum(s.id, 'condition', condition())!
    await whenSigningIdle(s.id)
    const stored = getSession(s.id)!.addenda!.find((x) => x.id === a.id)!
    expect(stored.bundle).toBeUndefined()
    expect(stored.rejected?.code).toBe(ERR_SIGNED_DATA_MISMATCH)
  })

  it('invalid addendum data throws and stores nothing', async () => {
    const s = await saveNew()
    const before = getSession(s.id)!.addenda!.length
    expect(() =>
      queueAddendum(s.id, 'handover', { from_driver: null, to_driver: '', handed_over_at: new Date().toISOString(), location: null }),
    ).toThrow(AddendumValidationError)
    expect(getSession(s.id)!.addenda!.length).toBe(before)
  })

  it('leaves addenda pending when the chain key for a v2 chain is not on this device', async () => {
    const s = await saveNew()
    const rows = loadSessions().map((r) => (r.id === s.id ? { ...r, chain_key: undefined } : r))
    localStorage.setItem(KEY, JSON.stringify(rows))
    net.calls.length = 0
    queueAddendum(s.id, 'condition', condition())
    await whenSigningIdle(s.id)
    expect(net.calls).toHaveLength(0)
    const last = getSession(s.id)!.addenda!.at(-1)!
    expect(last.bundle).toBeUndefined()
    expect(last.rejected).toBeUndefined()
  })
})

/**
 * A correctly signed bundle for this request with one thing changed: the
 * data (default) or the chain key hash.
 */
async function tamperedBundle(body: Body, what: 'data' | 'chain' = 'data'): Promise<SignatureBundle> {
  const parentPayload = (body.parent as { canonical_payload: string }).canonical_payload
  const parentChainHash = (JSON.parse(parentPayload).chain_key_sha256 ?? null) as string | null
  const payload = {
    schema: 'parkproof-addendum-v1',
    addendum_id: body.addendum_id,
    kind: body.kind,
    session_id: body.session_id,
    seq: body.seq,
    parent_payload_sha256: await sha256Hex(parentPayload),
    chain_key_sha256: what === 'chain' ? 'f'.repeat(64) : parentChainHash,
    captured_at: body.captured_at,
    signed_at: new Date().toISOString(),
    data: what === 'data' ? { ...(body.data as object), note: 'not what you sent' } : body.data,
  }
  const canonical_payload = JSON.stringify(payload)
  return {
    schema: 'parkproof-addendum-v1',
    signed_at: payload.signed_at,
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'test-local',
    canonical_payload,
    signature_base64: bytesToBase64(await signDer(utf8(canonical_payload))),
  }
}

describe('transient and rejected outcomes', () => {
  it('offline: nothing is sent and the link stays pending', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const s = await saveNew()
    expect(net.calls).toHaveLength(0)
    expect(s.signature).toBeUndefined()
    expect(arrivalSigningRejection(s.id)).toBeNull()
  })

  it('429, 5xx and network errors are transient and never capped', async () => {
    const answers: Override[] = [
      { status: 429, json: { error: 'RATE_LIMITED' } },
      { status: 500, json: { error: 'boom' } },
      'network',
      { status: 502, json: {} },
      { status: 503, json: {} },
    ]
    net.override = (_b, i) => answers[i] ?? null
    const prepared = await prepareNewRecord(record())
    saveSession(prepared)
    const t0 = Date.now()
    // Five sweeps, each past the throttle: five attempts, no cap.
    for (let i = 0; i < 5; i++) {
      runSigningSweep(t0 + i * (SWEEP_THROTTLE_MS + 1_000))
      await whenSigningIdle()
    }
    expect(net.calls).toHaveLength(5)
    expect(getSession(prepared.id)!.signature).toBeUndefined()
    // The sixth sweep succeeds.
    runSigningSweep(t0 + 5 * (SWEEP_THROTTLE_MS + 1_000))
    await whenSigningIdle()
    expect(getSession(prepared.id)!.signature).toBeDefined()
  })

  it('a 400 on link 0 is remembered and not retried', async () => {
    net.override = (body) => (body.schema === 'parkproof-evidence-v2' ? { status: 400, json: { error: 'ERR_BAD_VALUE' } } : null)
    // Open screens hear about the refusal (it lives in the signing state, not on the record).
    const seenWithRefusal: string[] = []
    const onChange = (e: Event) => {
      const id = (e as CustomEvent<{ id: string | null }>).detail?.id
      if (id && arrivalSigningRejection(id)) seenWithRefusal.push(id)
    }
    window.addEventListener('parkproof:records-changed', onChange)
    const s = await saveNew()
    window.removeEventListener('parkproof:records-changed', onChange)
    expect(seenWithRefusal).toContain(s.id)
    expect(arrivalSigningRejection(s.id)).toBe('ERR_BAD_VALUE')
    net.override = null
    net.calls.length = 0
    runSigningSweep(Date.now() + 10 * SWEEP_THROTTLE_MS)
    await whenSigningIdle()
    expect(net.calls).toHaveLength(0)
  })

  it('a 200 whose link 0 signs other data is not stored and is retried, not rejected', async () => {
    // A rolled-back Lambda that ignores `schema` signs v1 for a v2 request.
    net.override = async (body) => {
      if (body.schema !== 'parkproof-evidence-v2') return null
      const v1: Record<string, unknown> = { ...body }
      delete v1.schema
      delete v1.chain_key_sha256
      const res = await handleSignSessionRequest(
        { body: JSON.stringify(v1) },
        { signer: ({ message }) => signDer(message), keyAlias: 'test-local', parentPublicKeys: [TEST_PUBLIC_PEM] },
      )
      return { status: res.statusCode, json: JSON.parse(res.body) }
    }
    const s = await saveNew()
    expect(kinds()).toEqual(['parkproof-evidence-v2'])
    expect(s.signature).toBeUndefined()
    expect(arrivalSigningRejection(s.id)).toBeNull()
    expect(s.addenda![0].bundle).toBeUndefined()
    expect(s.addenda![0].rejected).toBeUndefined()

    // Once the server is fixed, the next sweep signs v2 and link 1.
    net.override = null
    runSigningSweep()
    await whenSigningIdle()
    const after = getSession(s.id)!
    expect(after.signature?.schema).toBe('parkproof-evidence-v2')
    expect(after.addenda![0].bundle).toBeDefined()
  })

  it('a 400 without an ERR code still counts as a rejection', async () => {
    const s = await saveNew()
    net.override = (body) => (body.kind === 'condition' ? { status: 400, json: { message: 'nope' } } : null)
    const a = queueAddendum(s.id, 'condition', condition())!
    await whenSigningIdle(s.id)
    expect(getSession(s.id)!.addenda!.find((x) => x.id === a.id)!.rejected?.code).toBe('ERR_BAD_REQUEST')
  })
})

describe('the sweep', () => {
  it('looks at a record at most once per 60 s', async () => {
    net.override = () => ({ status: 503, json: {} })
    const prepared = await prepareNewRecord(record())
    saveSession(prepared)
    const t0 = Date.now()
    runSigningSweep(t0)
    await whenSigningIdle()
    runSigningSweep(t0 + SWEEP_THROTTLE_MS - 1)
    await whenSigningIdle()
    expect(net.calls).toHaveLength(1)
    runSigningSweep(t0 + SWEEP_THROTTLE_MS)
    await whenSigningIdle()
    expect(net.calls).toHaveLength(2)
  })

  it('skips shared copies, records past the horizon and records with nothing to do', async () => {
    const done = await saveNew()
    net.calls.length = 0
    saveSession(record({ shared_from: { original_session_id: 'x', received_at: new Date().toISOString(), shared_at: null, arrival_bundle: null, snapshot: {} } }))
    saveSession(record({ arrived_at: new Date(Date.now() - RETRY_HORIZON_MS - 60_000).toISOString() }))
    runSigningSweep()
    await whenSigningIdle()
    expect(net.calls).toHaveLength(0)
    expect(getSession(done.id)!.signature).toBeDefined()
  })

  it('does not sign link 0 when the photo bytes are not on this device', async () => {
    saveSession(record({ sign_photo: 'https://bucket.example/photo.jpg' }))
    runSigningSweep()
    await whenSigningIdle()
    expect(net.calls).toHaveLength(0)
  })

  it('removes the old retry log, whose attempt caps no longer apply', () => {
    localStorage.setItem('parkproof.signing.retry.v1', JSON.stringify({ a: { attempts: 3, lastAttempt: 1 } }))
    runSigningSweep()
    expect(localStorage.getItem('parkproof.signing.retry.v1')).toBeNull()
  })

  it('runs again when the browser comes back online or the page becomes visible', async () => {
    net.override = () => ({ status: 503, json: {} })
    const prepared = await prepareNewRecord(record())
    saveSession(prepared)
    const uninstall = installSigningTriggers()
    try {
      window.dispatchEvent(new Event('online'))
      await whenSigningIdle()
      expect(net.calls).toHaveLength(1)
      // Inside the throttle window: the visibility trigger runs the sweep,
      // which skips the record.
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
      await whenSigningIdle()
      expect(net.calls).toHaveLength(1)
    } finally {
      uninstall()
    }
    window.dispatchEvent(new Event('online'))
    await whenSigningIdle()
    expect(net.calls).toHaveLength(1)
  })

  it('does nothing while offline, so the online trigger right after an offline launch signs at once', async () => {
    const prepared = await prepareNewRecord(record())
    saveSession(prepared)
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    const uninstall = installSigningTriggers()
    try {
      runSigningSweep() // the mount sweep, in an underground car park
      await whenSigningIdle()
      expect(net.calls).toHaveLength(0)
      // Back online well within 60 s of the mount sweep.
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
      window.dispatchEvent(new Event('online'))
      await whenSigningIdle()
      expect(kinds()).toEqual(['parkproof-evidence-v2'])
      expect(getSession(prepared.id)!.signature).toBeDefined()
    } finally {
      uninstall()
    }
  })
})

describe('holding addenda until the first sync (T0b4)', () => {
  it('while held, link 0 still signs and addenda wait; the release signs them at once, catch-ups included', async () => {
    // Ended on this device a minute ago, before this start: its departure is due.
    const ended = await saveNew()
    const ended_at = new Date(Date.now() - 60_000).toISOString()
    localStorage.setItem(KEY, JSON.stringify(loadSessions().map((r) => (r.id === ended.id ? { ...r, ended_at } : r))))
    markEndedOnThisDevice(ended.id)
    net.calls.length = 0

    holdAddendumSigning()
    expect(addendumSigningHeld()).toBe(true)
    const prepared = await prepareNewRecord(record())
    saveSession(prepared)
    signNewRecord(prepared.id, emptyLogDraft())
    await whenSigningIdle()
    expect(kinds()).toEqual(['parkproof-evidence-v2'])
    // The sweep (mount, online, visible) leaves addendum work alone while held.
    runSigningSweep(Date.now() + SWEEP_THROTTLE_MS)
    await whenSigningIdle()
    expect(kinds()).toEqual(['parkproof-evidence-v2'])
    expect(getSession(ended.id)!.addenda!.some((a) => a.kind === 'departure')).toBe(false)

    releaseAddendumSigning()
    expect(addendumSigningHeld()).toBe(false)
    await whenSigningIdle()
    expect(kinds().sort()).toEqual(['arrival_context#1', 'departure#2', 'parkproof-evidence-v2'])
    expect(getSession(prepared.id)!.addenda![0].bundle).toBeDefined()
    expect(getSession(ended.id)!.addenda!.find((a) => a.kind === 'departure')?.bundle).toBeDefined()
  })

  it('a hold ends on its own if the first sync never settles', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Drive the hold's timer by hand. A real 5 ms timer raced the signing work below and
    // lost on a slow CI runner, so the addendum was signed before the first check.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    holdAddendumSigning(5)
    const prepared = await prepareNewRecord(record())
    saveSession(prepared)
    signNewRecord(prepared.id, emptyLogDraft())
    await whenSigningIdle()
    expect(kinds()).toEqual(['parkproof-evidence-v2'])
    expect(addendumSigningHeld()).toBe(true)
    await vi.advanceTimersByTimeAsync(5)
    vi.useRealTimers()
    await vi.waitFor(() => expect(kinds()).toEqual(['parkproof-evidence-v2', 'arrival_context#1']))
    expect(addendumSigningHeld()).toBe(false)
  })

  it('releasing without a hold does nothing', async () => {
    const prepared = await prepareNewRecord(record())
    saveSession(prepared)
    releaseAddendumSigning()
    await whenSigningIdle()
    expect(net.calls).toHaveLength(0)
  })
})

describe('departure catch-up', () => {
  it('queues and signs a location-less departure for a record ended past the grace period', async () => {
    const s = await saveNew()
    const ended_at = new Date(Date.now() - 60_000).toISOString()
    const rows = loadSessions().map((r) => (r.id === s.id ? { ...r, ended_at } : r))
    localStorage.setItem(KEY, JSON.stringify(rows))
    // Without the ended-here mark (an end synced from another device) nothing is queued.
    runSigningSweep(Date.now() + SWEEP_THROTTLE_MS)
    await whenSigningIdle()
    expect(getSession(s.id)!.addenda!.some((a) => a.kind === 'departure')).toBe(false)
    markEndedOnThisDevice(s.id)
    net.calls.length = 0
    runSigningSweep(Date.now() + SWEEP_THROTTLE_MS)
    await whenSigningIdle()
    const dep = getSession(s.id)!.addenda!.find((a) => a.kind === 'departure')!
    expect(dep.seq).toBe(2)
    expect(dep.data).toEqual({ ended_at, location: null, distance_from_arrival_m: null, return_photos: [] })
    expect(payloadOf(dep.bundle!).data).toEqual(dep.data)
    expect(kinds()).toEqual(['departure#2'])
  })

  it('waits out the grace period, and never adds a second departure', async () => {
    const s = await saveNew()
    const rows = loadSessions().map((r) => (r.id === s.id ? { ...r, ended_at: new Date(Date.now() - 5_000).toISOString() } : r))
    localStorage.setItem(KEY, JSON.stringify(rows))
    markEndedOnThisDevice(s.id)
    runSigningSweep()
    await whenSigningIdle()
    expect(getSession(s.id)!.addenda!.some((a) => a.kind === 'departure')).toBe(false)

    queueAddendum(s.id, 'departure', departure(new Date().toISOString()))
    await whenSigningIdle()
    runSigningSweep(Date.now() + 10 * SWEEP_THROTTLE_MS)
    await whenSigningIdle()
    expect(getSession(s.id)!.addenda!.filter((a) => a.kind === 'departure')).toHaveLength(1)
  })

  it('scheduleDepartureCatchUp queues the departure once the timer fires', async () => {
    const s = await saveNew()
    const rows = loadSessions().map((r) => (r.id === s.id ? { ...r, ended_at: new Date(Date.now() - 31_000).toISOString() } : r))
    localStorage.setItem(KEY, JSON.stringify(rows))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    scheduleDepartureCatchUp(s.id, 1_000)
    expect(getSession(s.id)!.addenda!.some((a) => a.kind === 'departure')).toBe(false)
    vi.advanceTimersByTime(1_000)
    vi.useRealTimers()
    await whenSigningIdle()
    expect(getSession(s.id)!.addenda!.find((a) => a.kind === 'departure')?.bundle).toBeDefined()
  })

  it('never queues a departure on a pulled v2 copy whose chain key is not on this device', async () => {
    const s = await saveNew()
    // What a second device holds today: signature and ended_at, no chain key or addenda.
    const ended_at = new Date(Date.now() - 60_000).toISOString()
    const rows = loadSessions().map((r) => (r.id === s.id ? { ...r, chain_key: undefined, addenda: undefined, ended_at } : r))
    localStorage.setItem(KEY, JSON.stringify(rows))
    net.calls.length = 0
    runSigningSweep(Date.now() + SWEEP_THROTTLE_MS)
    await whenSigningIdle()
    expect(getSession(s.id)!.addenda).toBeUndefined()
    expect(net.calls).toHaveLength(0)
  })

  it('without a chain key, catches up only a record that was ended on this device', async () => {
    // A record saved before the chain (v1 link 0), ended a minute ago.
    const old = record({ ended_at: new Date(Date.now() - 60_000).toISOString() })
    saveSession(old)
    await enqueueSigning(old.id)
    expect(getSession(old.id)!.signature?.schema).toBe('parkproof-evidence-v1')
    net.calls.length = 0
    // Not ended here (a v1 copy pulled from the cloud looks the same): not ours to extend.
    runSigningSweep()
    await whenSigningIdle()
    expect(getSession(old.id)!.addenda ?? []).toHaveLength(0)
    expect(net.calls).toHaveLength(0)

    // The I've left path marks the record as ended here, even if its timer never fires.
    scheduleDepartureCatchUp(old.id, 60_000)()
    runSigningSweep(Date.now() + SWEEP_THROTTLE_MS)
    await whenSigningIdle()
    const dep = getSession(old.id)!.addenda!.find((a) => a.kind === 'departure')!
    expect(dep.seq).toBe(1)
    expect(dep.bundle).toBeDefined()
    expect(payloadOf(dep.bundle!).chain_key_sha256).toBeNull()
  })

  it('a cancelled catch-up does nothing', async () => {
    const s = await saveNew()
    const rows = loadSessions().map((r) => (r.id === s.id ? { ...r, ended_at: new Date(Date.now() - 31_000).toISOString() } : r))
    localStorage.setItem(KEY, JSON.stringify(rows))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const cancel = scheduleDepartureCatchUp(s.id, 1_000)
    cancel()
    vi.advanceTimersByTime(5_000)
    vi.useRealTimers()
    expect(getSession(s.id)!.addenda!.some((a) => a.kind === 'departure')).toBe(false)
  })
})

describe('photo-store records (T0b2): hashes come from the PhotoRefs', () => {
  const CAR_PHOTO = 'data:image/jpeg;base64,' + btoa('fake-car-bytes')
  const AMBIENT_PHOTO = 'data:image/jpeg;base64,' + btoa('fake-ambient-bytes')
  const photoRef = (role: 'sign' | 'car' | 'ambient', sha256: string) => ({
    role,
    sha256,
    captured_at: new Date(Date.now() - 60_000).toISOString(),
    source: 'camera_input' as const,
  })

  it('computeV1Hashes reads PhotoRef hashes without needing the bytes, legacy fields otherwise', async () => {
    const signSha = 'a'.repeat(64)
    // Sign from a ref (bytes not needed), ambient still a legacy data URL.
    const mixed = record({ sign_photo: null, ambient_photo: AMBIENT_PHOTO, photos: [photoRef('sign', signSha)] })
    expect(await computeV1Hashes(mixed)).toEqual({
      sign: signSha,
      car: null,
      ambient: await hashDataUrlImage(AMBIENT_PHOTO),
    })
    // A legacy cloud URL still can't be hashed here; a ref for that role can.
    expect(await computeV1Hashes(record({ car_photo: 'https://cdn/car.jpg' }))).toBeNull()
    expect(
      await computeV1Hashes(record({ car_photo: 'https://cdn/car.jpg', photos: [photoRef('car', 'b'.repeat(64))] })),
    ).toMatchObject({ car: 'b'.repeat(64) })
  })

  it('a new record with null legacy fields signs link 0 and link 1 over its PhotoRefs', async () => {
    const signSha = await hashDataUrlImage(SIGN_PHOTO)
    const carSha = await hashDataUrlImage(CAR_PHOTO)
    const refs = [photoRef('sign', signSha), photoRef('car', carSha)]
    const s = await saveNew({ sign_photo: null, car_photo: null, photos: refs })
    expect(s.v1_hashes).toEqual({ sign: signSha, car: carSha, ambient: null })
    const p0 = payloadOf(s.signature!)
    expect(p0.sign_photo_sha256).toBe(signSha)
    expect(p0.car_photo_sha256).toBe(carSha)
    expect(p0.ambient_photo_sha256).toBeNull()
    expect(await verifies(s.signature!)).toBe(true)
    // Link 1 signs the refs themselves (role, hash, capture time, source).
    const link1 = s.addenda!.find((a) => a.kind === 'arrival_context')!
    expect(payloadOf(link1.bundle!).data).toMatchObject({ photos: refs })
  })
})
