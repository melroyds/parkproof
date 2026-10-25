// @vitest-environment happy-dom
//
// The browser verifier (spec T0b3). Chains are signed by the REAL Lambda
// handler (lambda/index.js) with a local P-256 test key, so the verifier is
// checked against the payloads production builds. Hand-built payloads cover
// the cases the server would refuse to sign (wrong seq, wrong parent,
// wrong chain key hash).
//
// Covered: DER to raw (hand-made vectors, a real 33-byte r / 31-byte s
// signature, strict DER), the published key, every per-link check, forks,
// dev-key links, pending and rejected links, photo re-hashing, shared
// copies, the copy keys, and an optional real KMS bundle.
//
// The 1,000-signature loop lives in lambda/verify-interop.test.js: it signs
// with Node's OpenSSL (the DER that KMS also returns) and verifies here.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddendumKind, ParkingSession, PhotoRef, SignatureBundle, SignedAddendum } from '../types'
import { PARKPROOF_PUBLIC_KEY_PEM as LAMBDA_PUBLIC_KEY_PEM, handleSignSession } from '../../lambda/index.js'
import { ADDENDUM_SCHEMA, EVIDENCE_V1_SCHEMA, EVIDENCE_V2_SCHEMA, canonicalize } from '../../lambda/addendum-schema.js'
import en from '../locales/en.json'
import i18n from './i18n'
import { DEV_KEY_ALIAS, buildArrivalContext, emptyLogDraft } from './evidence-chain'
import { hashDataUrlImage, sha256HexUtf8 } from './hash'
import { createMemoryPhotoBackend, photoKey, putPhoto, setPhotoBackendForTests } from './photo-store'
import { shortFingerprint } from './session-photos'
import {
  DerSignatureError,
  FORK_KEY,
  LINK_CHAIN_BROKEN_KEY,
  LINK_STATUS_KEYS,
  PARKPROOF_PUBLIC_KEY_PEM,
  PHOTO_NOT_ON_DEVICE_DEV_KEY,
  PHOTO_STATUS_KEYS,
  VerifierUnavailableError,
  derToRawSignature,
  forkText,
  importPublicKeyPem,
  isChainOnlyProblem,
  isVerifierUnavailable,
  linkStatusKey,
  linkStatusText,
  parkProofPublicKey,
  pemToSpki,
  photoStatusText,
  resetVerifierForTests,
  verifyArrivalBundle,
  verifyRecord,
  verifySignature,
  type LinkCheck,
  type LinkProblem,
  type LinkStatus,
  type RecordVerification,
} from './verify'

const ECDSA = { name: 'ECDSA', hash: 'SHA-256' } as const
const PROD_ALIAS = 'alias/parkproof-evidence-signing'
let testKey: CryptoKeyPair
let TEST_PEM = ''

const utf8 = (s: string) => new TextEncoder().encode(s)
const b64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const hex64 = (fill: string) => fill.repeat(64).slice(0, 64)

/** Minimal DER INTEGER for a 32-byte big-endian value. */
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
async function rawSign(message: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign(ECDSA, testKey.privateKey, message as Uint8Array<ArrayBuffer>))
}
const signDer = async (message: Uint8Array) => rawToDer(await rawSign(message))

/** Sign a link with the real Lambda handler and the test key. */
function lambdaSign(body: Record<string, unknown>, keyAlias = PROD_ALIAS): Promise<SignatureBundle> {
  return handleSignSession(
    { body: JSON.stringify(body) },
    { signer: ({ message }) => signDer(message), keyAlias, parentPublicKeys: [TEST_PEM] },
  )
}

/** Sign any payload with the test key, bypassing the server's checks. */
async function signObject(payload: Record<string, unknown>, keyAlias = PROD_ALIAS): Promise<SignatureBundle> {
  const canonical_payload = canonicalize(payload)
  return {
    schema: String(payload.schema),
    signed_at: String(payload.signed_at),
    algorithm: 'ECDSA_SHA_256',
    key_alias: keyAlias,
    canonical_payload,
    signature_base64: b64(await signDer(utf8(canonical_payload))),
  }
}

const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)
const SIGN_PHOTO = jpeg('sign-photo-bytes')
const OTHER_PHOTO = jpeg('a-different-photo')
const CONDITION_PHOTO = jpeg('condition-front-bytes')

function randomHex64(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface BuildOptions {
  v2?: boolean
  photo?: 'store' | 'legacy' | 'none'
  keyAlias?: string
}

/** A saved record with a signed link 0 (v2 by default, sign photo in the photo store). */
async function newRecord(o: BuildOptions = {}): Promise<ParkingSession> {
  const v2 = o.v2 ?? true
  const photo = o.photo ?? 'store'
  const id = crypto.randomUUID()
  const now = Date.now()
  const session: ParkingSession = {
    id,
    arrived_at: new Date(now - 30 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 9 },
    sign_photo: null,
    car_photo: null,
    rules: photo === 'none' ? '' : '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: new Date(now + 90 * 60_000).toISOString(),
    confidence: 'high',
    addenda: [],
  }
  let signSha: string | null = null
  if (photo === 'store') {
    signSha = await putPhoto(id, SIGN_PHOTO)
    session.photos = [{ role: 'sign', sha256: signSha, captured_at: session.arrived_at, source: 'camera_input' }]
  } else if (photo === 'legacy') {
    session.sign_photo = SIGN_PHOTO
    signSha = await hashDataUrlImage(SIGN_PHOTO)
  } else {
    session.no_sign = true
  }
  const body: Record<string, unknown> = {
    session_id: id,
    arrived_at: session.arrived_at,
    expires_at: session.expires_at,
    location: session.location,
    rules: session.rules,
    chosen_label: null,
    confidence: 'high',
    no_sign: photo === 'none',
    sign_photo_sha256: signSha,
    ambient_photo_sha256: null,
    car_photo_sha256: null,
  }
  if (v2) {
    session.chain_key = randomHex64()
    body.schema = EVIDENCE_V2_SCHEMA
    body.chain_key_sha256 = await sha256HexUtf8(session.chain_key)
  }
  session.signature = await lambdaSign(body, o.keyAlias)
  return session
}

const seqOf = (b: SignatureBundle) => JSON.parse(b.canonical_payload).seq as number

/** Sign an addendum on top of `parent` (default: the chain's last signed link) and store it. */
async function addLink(
  session: ParkingSession,
  kind: AddendumKind,
  data: Record<string, unknown>,
  opts: { parent?: SignatureBundle; keyAlias?: string } = {},
): Promise<SignedAddendum> {
  const signed = (session.addenda ?? []).filter((a) => a.bundle)
  const parent = opts.parent ?? (signed.length ? signed[signed.length - 1].bundle! : session.signature!)
  const seq = parent === session.signature ? 1 : seqOf(parent) + 1
  const id = crypto.randomUUID()
  const captured_at = new Date().toISOString()
  const bundle = await lambdaSign(
    {
      schema: ADDENDUM_SCHEMA,
      addendum_id: id,
      kind,
      session_id: session.id,
      seq,
      captured_at,
      chain_key: session.chain_key ?? null,
      parent: { canonical_payload: parent.canonical_payload, signature_base64: parent.signature_base64 },
      data,
    },
    opts.keyAlias,
  )
  const addendum: SignedAddendum = { id, seq, kind, captured_at, data, bundle }
  session.addenda = [...(session.addenda ?? []), addendum]
  return addendum
}

const arrivalData = (s: ParkingSession) => buildArrivalContext(s, emptyLogDraft()) as unknown as Record<string, unknown>
const departureData = (): Record<string, unknown> => ({
  ended_at: new Date().toISOString(),
  location: null,
  distance_from_arrival_m: null,
  return_photos: [],
})
const conditionData = (ref: PhotoRef): Record<string, unknown> => ({ when: 'parking', photos: [ref], note: null })

/** A hand-built addendum payload, for chains the server wouldn't sign. */
async function addendumPayload(
  session: ParkingSession,
  parent: SignatureBundle,
  over: Record<string, unknown> = {},
): Promise<{ payload: Record<string, unknown>; addendum: Omit<SignedAddendum, 'bundle'> }> {
  const id = crypto.randomUUID()
  const captured_at = new Date().toISOString()
  const data = departureData()
  const parentPayload = JSON.parse(parent.canonical_payload)
  const payload = {
    schema: ADDENDUM_SCHEMA,
    addendum_id: id,
    kind: 'departure',
    session_id: session.id,
    seq: parent === session.signature ? 1 : parentPayload.seq + 1,
    parent_payload_sha256: await sha256HexUtf8(parent.canonical_payload),
    chain_key_sha256: parentPayload.schema === EVIDENCE_V1_SCHEMA ? null : parentPayload.chain_key_sha256,
    captured_at,
    signed_at: new Date().toISOString(),
    data,
    ...over,
  }
  return {
    payload,
    addendum: { id, seq: payload.seq as number, kind: 'departure', captured_at, data },
  }
}

async function storeHandBuilt(session: ParkingSession, parent: SignatureBundle, over: Record<string, unknown> = {}) {
  const { payload, addendum } = await addendumPayload(session, parent, over)
  const bundle = await signObject(payload)
  const stored: SignedAddendum = { ...addendum, bundle }
  session.addenda = [...(session.addenda ?? []), stored]
  return stored
}

const TRUST_TEST_KEY = () => ({ publicKeys: [testKey.publicKey], arrivalRejection: null })
const verify = (s: ParkingSession, extra: Record<string, unknown> = {}) =>
  verifyRecord(s, { ...TRUST_TEST_KEY(), ...extra })
const statuses = (r: RecordVerification) => r.links.map((l) => `${l.kind}#${l.seq}:${l.status}`)

/** Link 0 the way a share link carries it (T7 item 2): no schema, no algorithm. */
function shareShape(b: SignatureBundle): Record<string, unknown> {
  const out: Record<string, unknown> = { ...b }
  delete out.schema
  delete out.algorithm
  return out
}

/** A read-only shared copy (T7) of `original`, holding `bundle` as the sender's link 0. */
function sharedCopyOf(original: ParkingSession, bundle: unknown): ParkingSession {
  return {
    ...original,
    id: crypto.randomUUID(),
    sign_photo: null,
    signature: undefined,
    chain_key: undefined,
    addenda: undefined,
    shared_from: {
      original_session_id: original.id,
      received_at: new Date().toISOString(),
      shared_at: null,
      arrival_bundle: bundle as SignatureBundle,
      snapshot: {},
    },
  }
}

const t = i18n.t.bind(i18n)
const EN_INVALID = en.verifier.link.invalid
const EN_CHAIN_BROKEN = en.verifier.link.chainBroken

let store: ReturnType<typeof createMemoryPhotoBackend>

beforeAll(async () => {
  testKey = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', testKey.publicKey))
  const NL = String.fromCharCode(10)
  TEST_PEM = ['-----BEGIN PUBLIC KEY-----', b64(spki).match(/.{1,64}/g)!.join(NL), '-----END PUBLIC KEY-----', ''].join(NL)
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  store = createMemoryPhotoBackend()
  setPhotoBackendForTests(store)
  resetVerifierForTests()
})

afterEach(() => {
  setPhotoBackendForTests(null)
  vi.unstubAllGlobals()
})

// ─── DER to raw ──────────────────────────────────────────────────────────

describe('derToRawSignature', () => {
  const fill = (n: number, byte: number) => new Array<number>(n).fill(byte)
  const der = (r: number[], s: number[]) => Uint8Array.from([0x30, 4 + r.length + s.length, 0x02, r.length, ...r, 0x02, s.length, ...s])

  it('drops the leading 0x00 of a 33-byte r and left-pads a 31-byte s (hand-made vector)', () => {
    const r = [0x00, 0x80, ...fill(31, 0x11)] // 33 bytes: 0x00 + a 32-byte value with the top bit set
    const s = [0x7f, ...fill(30, 0x22)] // 31 bytes
    const raw = derToRawSignature(der(r, s))
    expect(raw.length).toBe(64)
    expect(Array.from(raw.slice(0, 32))).toEqual([0x80, ...fill(31, 0x11)])
    expect(Array.from(raw.slice(32))).toEqual([0x00, 0x7f, ...fill(30, 0x22)])
  })

  it('keeps 32-byte integers as they are and pads short ones', () => {
    const r = [0x12, ...fill(31, 0x34)]
    const s = [0x05]
    const raw = derToRawSignature(der(r, s))
    expect(Array.from(raw.slice(0, 32))).toEqual(r)
    expect(Array.from(raw.slice(32))).toEqual([...fill(31, 0x00), 0x05])
  })

  it.each([
    ['too short', Uint8Array.from([0x30, 0x02, 0x02, 0x00])],
    ['not a SEQUENCE', Uint8Array.from([0x31, 6, 0x02, 1, 1, 0x02, 1, 1])],
    ['long-form sequence length', Uint8Array.from([0x30, 0x81, 6, 0x02, 1, 1, 0x02, 1, 1])],
    ['sequence length mismatch', Uint8Array.from([0x30, 7, 0x02, 1, 1, 0x02, 1, 1])],
    ['trailing bytes', Uint8Array.from([0x30, 9, 0x02, 1, 1, 0x02, 1, 1, 0x00, 0x00, 0x00])],
    ['trailing byte after s', Uint8Array.from([0x30, 7, 0x02, 1, 1, 0x02, 1, 1, 0x00])],
    ['second element not an INTEGER', Uint8Array.from([0x30, 6, 0x02, 1, 1, 0x04, 1, 1])],
    ['empty integer', Uint8Array.from([0x30, 6, 0x02, 0, 0x02, 2, 1, 1])],
    ['zero integer', Uint8Array.from([0x30, 6, 0x02, 1, 0, 0x02, 1, 1])],
    ['negative integer', Uint8Array.from([0x30, 6, 0x02, 1, 0x80, 0x02, 1, 1])],
    ['leading 0x00 that isn\'t needed', Uint8Array.from([0x30, 7, 0x02, 2, 0x00, 0x7f, 0x02, 1, 1])],
    ['truncated integer', Uint8Array.from([0x30, 6, 0x02, 9, 1, 0x02, 1, 1])],
  ])('rejects %s', (_label, bytes) => {
    expect(() => derToRawSignature(bytes)).toThrow(DerSignatureError)
  })

  it('rejects an integer longer than 32 bytes', () => {
    // 33 bytes without a sign byte, and 34 bytes with one.
    expect(() => derToRawSignature(der([0x01, ...fill(32, 0x11)], [0x01]))).toThrow(DerSignatureError)
    expect(() => derToRawSignature(der([0x00, 0x80, ...fill(32, 0x11)], [0x01]))).toThrow(DerSignatureError)
  })
})

describe('verifySignature', () => {
  it('verifies a real signature whose DER has a 33-byte r and a 31-byte s', async () => {
    const message = utf8('{"hello":"council"}')
    let raw: Uint8Array | null = null
    for (let i = 0; i < 40_000 && !raw; i++) {
      const candidate = await rawSign(message)
      // r needs a sign byte (top bit set); s has one zero top byte and no sign byte.
      if (candidate[0] >= 0x80 && candidate[32] === 0x00 && candidate[33] !== 0x00 && candidate[33] < 0x80) {
        raw = candidate
      }
    }
    expect(raw).not.toBeNull()
    const der = rawToDer(raw!)
    expect(der[3]).toBe(33) // r length
    expect(der[3 + 33 + 2]).toBe(31) // s length
    expect(Array.from(derToRawSignature(der))).toEqual(Array.from(raw!))
    expect(await verifySignature([testKey.publicKey], '{"hello":"council"}', b64(der))).toBe(true)
    expect(await verifySignature([testKey.publicKey], '{"hello":"councils"}', b64(der))).toBe(false)
  })

  it('verifies the payload bytes, not a digest of them', async () => {
    const payload = '{"a":1}'
    const der = await signDer(utf8(payload))
    expect(await verifySignature([testKey.publicKey], payload, b64(der))).toBe(true)
    const digestHex = await sha256HexUtf8(payload)
    expect(await verifySignature([testKey.publicKey], digestHex, b64(der))).toBe(false)
  })

  it('refuses malformed signatures instead of throwing', async () => {
    const payload = '{"a":1}'
    const raw = await rawSign(utf8(payload))
    expect(await verifySignature([testKey.publicKey], payload, b64(raw))).toBe(false) // raw r||s, not DER
    expect(await verifySignature([testKey.publicKey], payload, 'not base64!')).toBe(false)
    expect(await verifySignature([testKey.publicKey], payload, '')).toBe(false)
  })

  it('refuses a valid signature re-encoded as non-minimal DER (as openssl does)', async () => {
    const payload = '{"strict":true}'
    let der: Uint8Array | null = null
    for (let i = 0; i < 200 && !der; i++) {
      const raw = await rawSign(utf8(payload))
      if (raw[32] !== 0 && raw[32] < 0x80) der = rawToDer(raw) // s without a sign byte
    }
    expect(der).not.toBeNull()
    expect(await verifySignature([testKey.publicKey], payload, b64(der!))).toBe(true)
    const rLen = der![3]
    const sStart = 4 + rLen + 2
    const padded = Uint8Array.from([
      0x30,
      der![1] + 1,
      ...der!.slice(2, 4 + rLen),
      0x02,
      der![5 + rLen] + 1,
      0x00,
      ...der!.slice(sStart),
    ])
    expect(await verifySignature([testKey.publicKey], payload, b64(padded))).toBe(false)
  })

  it('tries every trusted key', async () => {
    const other = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as CryptoKeyPair
    const payload = '{"k":2}'
    const der = await signDer(utf8(payload))
    expect(await verifySignature([other.publicKey], payload, b64(der))).toBe(false)
    expect(await verifySignature([other.publicKey, testKey.publicKey], payload, b64(der))).toBe(true)
  })
})

// ─── The published key ───────────────────────────────────────────────────

describe('the published key', () => {
  it("equals the Lambda's embedded key (which lambda/sign-chain.test.js keeps equal to public/parkproof-public-key.pem)", () => {
    expect(PARKPROOF_PUBLIC_KEY_PEM.replace(/\r\n/g, '\n').trim()).toBe(LAMBDA_PUBLIC_KEY_PEM.replace(/\r\n/g, '\n').trim())
  })

  it('imports as a P-256 verify key, once per page', async () => {
    const key = await parkProofPublicKey()
    expect(key.type).toBe('public')
    expect(key.usages).toEqual(['verify'])
    expect((key.algorithm as EcKeyAlgorithm).namedCurve).toBe('P-256')
    expect(await parkProofPublicKey()).toBe(key)
  })

  it('reads PEM bodies and refuses garbage', async () => {
    expect(pemToSpki(TEST_PEM).length).toBeGreaterThan(60)
    expect(() => pemToSpki('-----BEGIN PUBLIC KEY-----\n!!!\n-----END PUBLIC KEY-----')).toThrow()
    const imported = await importPublicKeyPem(TEST_PEM)
    const der = await signDer(utf8('x'))
    expect(await verifySignature([imported], 'x', b64(der))).toBe(true)
  })

  it('verifyRecord trusts only the published key by default', async () => {
    const s = await newRecord()
    await addLink(s, 'arrival_context', arrivalData(s))
    const result = await verifyRecord(s, { arrivalRejection: null })
    expect(statuses(result)).toEqual(['arrival#0:invalid', 'arrival_context#1:invalid'])
    expect(result.links.every((l) => l.problems.includes('signature'))).toBe(true)
    expect(result.overall).toBe('problem')
  })

  it('accepts PEM strings as trusted keys', async () => {
    const s = await newRecord()
    const result = await verifyRecord(s, { publicKeys: [TEST_PEM], arrivalRejection: null })
    expect(result.overall).toBe('valid')
  })
})

// ─── Chains ──────────────────────────────────────────────────────────────

describe('verifyRecord: chains', () => {
  it('a v2 record with arrival_context and departure: every link valid', async () => {
    const s = await newRecord()
    await addLink(s, 'arrival_context', arrivalData(s))
    await addLink(s, 'departure', departureData())
    const r = await verify(s)
    expect(r.session_id).toBe(s.id)
    expect(statuses(r)).toEqual(['arrival#0:valid', 'arrival_context#1:valid', 'departure#2:valid'])
    expect(r.overall).toBe('valid')
    expect(r.counts).toEqual({ valid: 3, invalid: 0, pending: 0, rejected: 0, dev_key: 0 })
    expect(r.forks).toEqual([])
    expect(r.chain_key_on_device).toBe('matches')
    expect(r.links.map((l) => l.signature_ok)).toEqual([true, true, true])
    // Signed facts come from the signed payload.
    const zero = r.links[0]
    expect(zero.payload?.schema).toBe(EVIDENCE_V2_SCHEMA)
    expect(zero.signed_at).toBe(JSON.parse(s.signature!.canonical_payload).signed_at)
    expect(zero.captured_at).toBeNull()
    expect(r.links[2].captured_at).toBe(s.addenda![1].captured_at)
    expect(r.links[2].addendum_id).toBe(s.addenda![1].id)
  })

  it('a v1 chain (no chain key) verifies, with null chain key hashes', async () => {
    const s = await newRecord({ v2: false, photo: 'legacy' })
    await addLink(s, 'departure', departureData())
    const r = await verify(s)
    expect(statuses(r)).toEqual(['arrival#0:valid', 'departure#1:valid'])
    expect(r.links[0].payload?.schema).toBe(EVIDENCE_V1_SCHEMA)
    expect(r.links[1].payload?.chain_key_sha256).toBeNull()
    expect(r.chain_key_on_device).toBe('not_applicable')
  })

  it('a changed link-0 payload fails its signature and breaks the next link', async () => {
    const s = await newRecord()
    await addLink(s, 'arrival_context', arrivalData(s))
    s.signature = { ...s.signature!, canonical_payload: s.signature!.canonical_payload.replace('2P Mon-Fri', '4P Mon-Fri') }
    const r = await verify(s)
    expect(statuses(r)).toEqual(['arrival#0:invalid', 'arrival_context#1:invalid'])
    expect(r.links[0].problems).toEqual(['signature'])
    expect(r.links[1].problems).toEqual(['parent_hash'])
    expect(r.links[0].payload).toBeNull()
    expect(r.links[0].signed_at).toBeNull()
    expect(r.overall).toBe('problem')
    // The child itself is what ParkProof signed: only its parent changed.
    expect(r.links[0].signature_ok).toBe(false)
    expect(r.links[1].signature_ok).toBe(true)
    expect(linkStatusText(r.links[0], t)).toBe(EN_INVALID)
    expect(linkStatusText(r.links[1], t)).toBe(EN_CHAIN_BROKEN)
  })

  it('a changed signature fails that link only (the next link still commits to the same bytes)', async () => {
    const s = await newRecord()
    await addLink(s, 'arrival_context', arrivalData(s))
    await addLink(s, 'departure', departureData())
    const sig = fromB64(s.addenda![0].bundle!.signature_base64)
    sig[sig.length - 1] ^= 0x01
    s.addenda![0] = { ...s.addenda![0], bundle: { ...s.addenda![0].bundle!, signature_base64: b64(sig) } }
    const r = await verify(s)
    expect(statuses(r)).toEqual(['arrival#0:valid', 'arrival_context#1:invalid', 'departure#2:valid'])
    expect(r.links[1].problems).toEqual(['signature'])
    expect(r.links[1].signature_ok).toBe(false)
    expect(linkStatusText(r.links[1], t)).toBe(EN_INVALID)
  })

  it("a bundle whose signed_at isn't the signed one is invalid", async () => {
    const s = await newRecord()
    s.signature = { ...s.signature!, signed_at: '2020-01-01T00:00:00.000Z' }
    const r = await verify(s)
    expect(r.links[0].status).toBe('invalid')
    expect(r.links[0].problems).toEqual(['signed_at'])
  })

  it("another record's link 0 is invalid here", async () => {
    const a = await newRecord()
    const b = await newRecord()
    b.signature = a.signature
    const r = await verify(b)
    expect(r.links[0].problems).toContain('session_id')
    // Genuinely signed, but for another record: not a chain-only problem.
    expect(r.links[0].signature_ok).toBe(true)
    expect(isChainOnlyProblem(r.links[0])).toBe(false)
    expect(linkStatusText(r.links[0], t)).toBe(EN_INVALID)
  })

  it('wrong schema or algorithm is invalid', async () => {
    const s = await newRecord()
    await addLink(s, 'departure', departureData())
    s.signature = { ...s.signature!, schema: EVIDENCE_V1_SCHEMA }
    s.addenda![0] = { ...s.addenda![0], bundle: { ...s.addenda![0].bundle!, algorithm: 'RSASSA_PSS_SHA_256' } }
    const r = await verify(s)
    expect(r.links[0].problems).toEqual(['schema'])
    expect(r.links[1].problems).toEqual(['algorithm'])
  })

  it('an addendum stored with a different seq, capture time or data than it signs is invalid', async () => {
    const s = await newRecord()
    const first = await addLink(s, 'arrival_context', arrivalData(s))
    const second = await addLink(s, 'departure', departureData())
    s.addenda = [{ ...first, seq: 4 }, { ...second, data: { ...second.data, distance_from_arrival_m: 5 } }]
    let r = await verify(s)
    expect(statuses(r)).toEqual(['arrival#0:valid', 'arrival_context#1:invalid', 'departure#2:invalid'])
    expect(r.links[1].problems).toEqual(['entry_mismatch'])
    expect(r.links[2].problems).toEqual(['entry_mismatch'])
    s.addenda = [{ ...first, captured_at: new Date(0).toISOString() }, second]
    r = await verify(s)
    expect(r.links[1].problems).toEqual(['entry_mismatch'])
    expect(r.links[2].status).toBe('valid')
  })

  it('a link whose parent seq has no signed link is invalid (parent missing)', async () => {
    const s = await newRecord()
    // seq 2 directly on link 0: there is no signed seq 1.
    await storeHandBuilt(s, s.signature!, { seq: 2 })
    const r = await verify(s)
    expect(r.links[1].status).toBe('invalid')
    expect(r.links[1].problems).toEqual(['parent_missing'])
    // Its own signature is still checked, and its copy doesn't say it changed.
    expect(r.links[1].signature_ok).toBe(true)
    expect(isChainOnlyProblem(r.links[1])).toBe(true)
    expect(linkStatusKey(r.links[1])).toBe(LINK_CHAIN_BROKEN_KEY)
    expect(linkStatusText(r.links[1], t)).toBe(
      "Its place in the record can't be checked. The part signed before it is missing from this device or doesn't match.",
    )
  })

  it('a chain problem with a failing signature too reads as not valid', async () => {
    const s = await newRecord()
    const stored = await storeHandBuilt(s, s.signature!, { seq: 2 })
    const sig = fromB64(stored.bundle!.signature_base64)
    sig[sig.length - 1] ^= 0x01
    s.addenda = [{ ...stored, bundle: { ...stored.bundle!, signature_base64: b64(sig) } }]
    const r = await verify(s)
    expect(r.links[1].problems).toEqual(['parent_missing', 'signature'])
    expect(r.links[1].signature_ok).toBe(false)
    expect(isChainOnlyProblem(r.links[1])).toBe(false)
    expect(linkStatusText(r.links[1], t)).toBe(EN_INVALID)
  })

  it('a link that commits to other parent bytes is invalid (parent hash)', async () => {
    const s = await newRecord()
    await storeHandBuilt(s, s.signature!, { parent_payload_sha256: hex64('a') })
    const r = await verify(s)
    expect(r.links[1].problems).toEqual(['parent_hash'])
    expect(r.links[1].signature_ok).toBe(true)
    expect(linkStatusText(r.links[1], t)).toBe(EN_CHAIN_BROKEN)
  })

  it('a part signed on top of another device\'s copy of its parent reads as chain-broken, not changed', async () => {
    // Two devices each signed the same pending addendum X at seq 1, so there
    // are two genuine signed copies. This device kept copy A; child Z was
    // signed on top of copy B, which isn't here.
    const s = await newRecord()
    const x = await addLink(s, 'arrival_context', arrivalData(s))
    await new Promise((resolve) => setTimeout(resolve, 5)) // a later signed_at, so copy B's bytes differ
    const copyB = await lambdaSign({
      schema: ADDENDUM_SCHEMA,
      addendum_id: x.id,
      kind: x.kind,
      session_id: s.id,
      seq: 1,
      captured_at: x.captured_at,
      chain_key: s.chain_key ?? null,
      parent: { canonical_payload: s.signature!.canonical_payload, signature_base64: s.signature!.signature_base64 },
      data: x.data,
    })
    const z = await addLink(s, 'departure', departureData(), { parent: copyB })
    const r = await verify(s)
    const zCheck = r.links.find((l) => l.addendum_id === z.id)!
    expect(zCheck.problems).toEqual(['parent_hash'])
    expect(zCheck.signature_ok).toBe(true)
    expect(linkStatusText(zCheck, t)).toBe(EN_CHAIN_BROKEN)
  })

  it("a link that doesn't carry link 0's chain key hash is invalid", async () => {
    const v2 = await newRecord()
    await storeHandBuilt(v2, v2.signature!, { chain_key_sha256: hex64('b') })
    let r = await verify(v2)
    expect(r.links[1].problems).toEqual(['chain_key'])

    const v1 = await newRecord({ v2: false })
    await storeHandBuilt(v1, v1.signature!, { chain_key_sha256: hex64('c') })
    r = await verify(v1)
    expect(r.links[1].problems).toEqual(['chain_key'])

    const missing = await newRecord()
    const { payload, addendum } = await addendumPayload(missing, missing.signature!)
    delete payload.chain_key_sha256
    missing.addenda = [{ ...addendum, bundle: await signObject(payload) }]
    r = await verify(missing)
    expect(r.links[1].problems).toEqual(['chain_key'])
  })

  it('checks the chain key hash against the parent each child actually extends', async () => {
    const s = await newRecord()
    const one = await addLink(s, 'arrival_context', arrivalData(s))
    // seq 2 on top of seq 1, but with link 0's chain hash replaced.
    await storeHandBuilt(s, one.bundle!, { chain_key_sha256: hex64('d') })
    const r = await verify(s)
    expect(statuses(r)).toEqual(['arrival#0:valid', 'arrival_context#1:valid', 'departure#2:invalid'])
    expect(r.links[2].problems).toEqual(['chain_key'])
  })

  it('an addendum payload with a bad seq is invalid', async () => {
    const s = await newRecord()
    await storeHandBuilt(s, s.signature!, { seq: 0 })
    const r = await verify(s)
    expect(r.links[1].problems).toContain('seq')
  })

  it('unreadable bundles are invalid', async () => {
    const s = await newRecord()
    const good = await addLink(s, 'arrival_context', arrivalData(s))
    s.addenda = [
      { ...good, bundle: { ...good.bundle!, canonical_payload: 'not json' } },
      { ...good, id: crypto.randomUUID(), seq: 2, bundle: { schema: ADDENDUM_SCHEMA } as unknown as SignatureBundle },
    ]
    const r = await verify(s)
    expect(r.links[1].problems).toEqual(['unreadable'])
    expect(r.links[2].problems).toEqual(['unreadable'])
    expect(r.links[2].bundle).toBeNull()
    expect([r.links[1].signature_ok, r.links[2].signature_ok]).toEqual([null, null])
    expect(linkStatusText(r.links[1], t)).toBe(EN_INVALID)

    const broken = await newRecord()
    broken.signature = { schema: EVIDENCE_V2_SCHEMA } as unknown as SignatureBundle
    const r2 = await verify(broken)
    expect(r2.links[0].status).toBe('invalid')
    expect(r2.links[0].problems).toEqual(['unreadable'])
  })

  it("this device's own link 0 must be a full stored bundle (the share-link shape is for shared copies)", async () => {
    const s = await newRecord()
    s.signature = shareShape(s.signature!) as unknown as SignatureBundle
    const r = await verify(s)
    expect(r.links[0].problems).toEqual(['unreadable'])
  })

  it('pending and rejected links are listed after the signed ones, in seq order', async () => {
    const s = await newRecord()
    await addLink(s, 'arrival_context', arrivalData(s))
    const at = new Date().toISOString()
    s.addenda!.push(
      { id: crypto.randomUUID(), seq: 2, kind: 'condition', captured_at: at, data: {}, rejected: { code: 'ERR_BAD_VALUE', at } },
      { id: crypto.randomUUID(), seq: 2, kind: 'departure', captured_at: at, data: departureData() },
    )
    const r = await verify(s)
    expect(statuses(r)).toEqual([
      'arrival#0:valid',
      'arrival_context#1:valid',
      'condition#2:rejected',
      'departure#2:pending',
    ])
    expect(r.links[2].rejected_code).toBe('ERR_BAD_VALUE')
    expect(r.links[3].captured_at).toBe(at)
    expect(r.links[3].payload).toBeNull()
    expect([r.links[2].signature_ok, r.links[3].signature_ok]).toEqual([null, null])
    expect(r.counts).toEqual({ valid: 2, invalid: 0, pending: 1, rejected: 1, dev_key: 0 })
    // Pending and rejected links don't make the record a problem.
    expect(r.overall).toBe('valid')
  })

  it('an addendum stored with a null bundle is not signed yet', async () => {
    const s = await newRecord()
    const at = new Date().toISOString()
    s.addenda = [
      { id: crypto.randomUUID(), seq: 1, kind: 'departure', captured_at: at, data: departureData(), bundle: null as unknown as undefined },
    ]
    const r = await verify(s)
    expect(statuses(r)).toEqual(['arrival#0:valid', 'departure#1:pending'])
  })

  it('an unsigned link 0 is pending, or rejected when the server refused it', async () => {
    const s = await newRecord()
    delete s.signature
    let r = await verify(s)
    expect(statuses(r)).toEqual(['arrival#0:pending'])
    expect(r.overall).toBe('unsigned')

    r = await verify(s, { arrivalRejection: 'ERR_MISSING_FIELD' })
    expect(r.links[0].status).toBe('rejected')
    expect(r.links[0].rejected_code).toBe('ERR_MISSING_FIELD')

    // By default it reads the signing queue's record of a link-0 rejection.
    localStorage.setItem(
      'parkproof.signing.state.v2',
      JSON.stringify({ [s.id]: { link0_rejected: { code: 'ERR_BAD_VALUE', at: new Date().toISOString() } } }),
    )
    r = await verifyRecord(s, { publicKeys: [testKey.publicKey] })
    expect(r.links[0].status).toBe('rejected')
    expect(r.links[0].rejected_code).toBe('ERR_BAD_VALUE')
    expect(r.overall).toBe('unsigned')
  })

  it("reports whether this device holds link 0's chain key", async () => {
    const s = await newRecord()
    expect((await verify(s)).chain_key_on_device).toBe('matches')
    expect((await verify({ ...s, chain_key: randomHex64() })).chain_key_on_device).toBe('differs')
    expect((await verify({ ...s, chain_key: undefined })).chain_key_on_device).toBe('absent')
  })
})

// ─── Forks ───────────────────────────────────────────────────────────────

describe('verifyRecord: forks', () => {
  it('two signed links at one seq are a fork; each branch is checked on its own', async () => {
    const s = await newRecord()
    await addLink(s, 'arrival_context', arrivalData(s))
    const one = s.addenda![0].bundle!
    const a = await addLink(s, 'departure', departureData(), { parent: one })
    const b = await addLink(s, 'handover', {
      from_driver: null,
      to_driver: 'Sam',
      handed_over_at: new Date().toISOString(),
      location: null,
    }, { parent: one })
    // A child of the second branch.
    await addLink(s, 'condition', conditionData({ role: 'condition-front', sha256: hex64('e'), captured_at: new Date().toISOString(), source: 'camera_input' }), { parent: b.bundle! })
    const r = await verify(s)
    expect(r.links.map((l) => `${l.seq}:${l.status}`)).toEqual(['0:valid', '1:valid', '2:valid', '2:valid', '3:valid'])
    expect(r.forks).toHaveLength(1)
    expect(r.forks[0].seq).toBe(2)
    const forkedIds = r.forks[0].link_indexes.map((i) => r.links[i].addendum_id).sort()
    expect(forkedIds).toEqual([a.id, b.id].sort())
    expect(r.links.filter((l) => l.forked).map((l) => l.addendum_id).sort()).toEqual([a.id, b.id].sort())
    // A fork isn't a problem in itself: both parts are signed.
    expect(r.overall).toBe('valid')
  })

  it("a changed copy at the same seq isn't a fork", async () => {
    const s = await newRecord()
    const one = await addLink(s, 'arrival_context', arrivalData(s))
    s.addenda!.push({ ...one, id: crypto.randomUUID(), bundle: { ...one.bundle!, canonical_payload: one.bundle!.canonical_payload + ' ' } })
    const r = await verify(s)
    expect(r.forks).toEqual([])
    expect(r.counts.invalid).toBe(1)
  })

  it('the same signed link stored twice counts once', async () => {
    const s = await newRecord()
    const one = await addLink(s, 'arrival_context', arrivalData(s))
    s.addenda!.push({ ...one })
    const r = await verify(s)
    expect(statuses(r)).toEqual(['arrival#0:valid', 'arrival_context#1:valid'])
    expect(r.forks).toEqual([])
  })

  it('a pending copy of an addendum that is also stored signed is the signed one', async () => {
    const s = await newRecord()
    const one = await addLink(s, 'arrival_context', arrivalData(s))
    const { bundle: _bundle, ...pendingCopy } = one
    void _bundle
    s.addenda = [pendingCopy, one]
    const r = await verify(s)
    expect(statuses(r)).toEqual(['arrival#0:valid', 'arrival_context#1:valid'])
    expect(r.counts.pending).toBe(0)
  })
})

// ─── Development keys ────────────────────────────────────────────────────

describe('verifyRecord: development-key links', () => {
  it('reports dev-key links as dev key, never valid, and the record as dev key', async () => {
    const s = await newRecord({ keyAlias: DEV_KEY_ALIAS })
    await addLink(s, 'arrival_context', arrivalData(s), { keyAlias: DEV_KEY_ALIAS })
    // Even the published key isn't consulted for them.
    const r = await verifyRecord(s, { arrivalRejection: null })
    expect(statuses(r)).toEqual(['arrival#0:dev_key', 'arrival_context#1:dev_key'])
    expect(r.overall).toBe('dev_key')
    expect(r.counts.dev_key).toBe(2)
    expect(r.links.map((l) => l.signature_ok)).toEqual([null, null])
    expect(r.links[0].payload?.session_id).toBe(s.id)
    expect(r.photos.every((p) => p.signer === 'dev_key')).toBe(true)
  })

  it('a dev-key link with a broken chain is invalid', async () => {
    const s = await newRecord({ keyAlias: DEV_KEY_ALIAS })
    const { payload, addendum } = await addendumPayload(s, s.signature!, { parent_payload_sha256: hex64('f') })
    s.addenda = [{ ...addendum, bundle: await signObject(payload, DEV_KEY_ALIAS) }]
    const r = await verify(s)
    expect(r.links[1].status).toBe('invalid')
    expect(r.links[1].problems).toEqual(['parent_hash'])
    expect(r.overall).toBe('problem')
    // Its signature can't be tried, and the copy makes no claim about it.
    expect(r.links[1].signature_ok).toBeNull()
    expect(linkStatusText(r.links[1], t)).toBe(EN_CHAIN_BROKEN)
  })

  it('one dev-key link among valid ones makes the record dev key, not valid', async () => {
    const s = await newRecord()
    await addLink(s, 'departure', departureData(), { keyAlias: DEV_KEY_ALIAS })
    const r = await verify(s)
    expect(statuses(r)).toEqual(['arrival#0:valid', 'departure#1:dev_key'])
    expect(r.overall).toBe('dev_key')
  })
})

// ─── Photos ──────────────────────────────────────────────────────────────

describe('verifyRecord: photos', () => {
  it('re-hashes a photo-store photo; one result per photo, listing every link that signs it', async () => {
    const s = await newRecord()
    await addLink(s, 'arrival_context', arrivalData(s)) // its photos include the sign ref
    const r = await verify(s)
    const signSha = s.photos![0].sha256
    expect(r.photos).toEqual([
      { role: 'sign', sha256: signSha, status: 'matches', local_sha256: signSha, signer: 'parkproof', link_indexes: [0, 1] },
    ])
  })

  it('stored bytes that no longer hash to their key differ', async () => {
    const s = await newRecord()
    const signSha = s.photos![0].sha256
    store.records.get(photoKey(s.id, signSha))!.bytes = utf8('tampered bytes').buffer as ArrayBuffer
    const r = await verify(s)
    expect(r.photos[0].status).toBe('differs')
    expect(r.photos[0].local_sha256).toBe(await sha256HexUtf8('tampered bytes'))
    expect(r.overall).toBe('problem')
    // The signatures themselves are still valid.
    expect(r.links[0].status).toBe('valid')
  })

  it("a ref whose bytes aren't here is not on this device, never matching", async () => {
    const s = await newRecord()
    store.records.clear()
    const r = await verify(s)
    expect(r.photos[0].status).toBe('not_on_device')
    expect(r.photos[0].local_sha256).toBeNull()
    expect(r.overall).toBe('valid')
  })

  it('checks the photo the record shows: a swapped sign ref differs even with the signed bytes still stored', async () => {
    const s = await newRecord()
    const otherSha = await putPhoto(s.id, OTHER_PHOTO)
    s.photos = [{ ...s.photos![0], sha256: otherSha }]
    const r = await verify(s)
    expect(r.photos[0].status).toBe('differs')
    expect(r.photos[0].local_sha256).toBe(otherSha)
  })

  it('legacy data-URL photos: matches, differs, unreadable, and cloud URLs are not on this device', async () => {
    const s = await newRecord({ photo: 'legacy' })
    expect((await verify(s)).photos[0].status).toBe('matches')
    expect((await verify({ ...s, sign_photo: OTHER_PHOTO })).photos[0]).toMatchObject({
      status: 'differs',
      local_sha256: await hashDataUrlImage(OTHER_PHOTO),
    })
    expect((await verify({ ...s, sign_photo: 'data:image/jpeg;base64,%%%' })).photos[0]).toMatchObject({
      status: 'differs',
      local_sha256: null,
    })
    expect((await verify({ ...s, sign_photo: 'https://example.com/sign.jpg' })).photos[0].status).toBe('not_on_device')
    expect((await verify({ ...s, sign_photo: null })).photos[0].status).toBe('not_on_device')
  })

  it('photos signed in addenda are looked up by their fingerprint', async () => {
    const s = await newRecord({ photo: 'none' })
    const sha = await putPhoto(s.id, CONDITION_PHOTO)
    const ref: PhotoRef = { role: 'condition-front', sha256: sha, captured_at: new Date().toISOString(), source: 'camera_input' }
    await addLink(s, 'condition', conditionData(ref))
    let r = await verify(s)
    expect(r.photos).toEqual([
      { role: 'condition-front', sha256: sha, status: 'matches', local_sha256: sha, signer: 'parkproof', link_indexes: [1] },
    ])
    store.records.clear()
    r = await verify(s)
    expect(r.photos[0].status).toBe('not_on_device')
  })

  it("photos from links that don't check out aren't listed", async () => {
    const s = await newRecord()
    s.signature = { ...s.signature!, signed_at: '2020-01-01T00:00:00.000Z' }
    const r = await verify(s)
    expect(r.links[0].status).toBe('invalid')
    expect(r.photos).toEqual([])
  })
})

// ─── Shared copies and single bundles ────────────────────────────────────

describe('shared copies and single arrival bundles', () => {
  it("checks a shared copy against the sender's bundle and record id", async () => {
    const original = await newRecord({ photo: 'legacy' })
    const copy = sharedCopyOf(original, original.signature!)
    const r = await verifyRecord(copy, { publicKeys: [testKey.publicKey] })
    expect(r.session_id).toBe(original.id)
    expect(statuses(r)).toEqual(['arrival#0:valid'])
    expect(r.photos[0].status).toBe('not_on_device')
    expect(r.chain_key_on_device).toBe('not_applicable')

    const tampered = { ...copy, shared_from: { ...copy.shared_from!, original_session_id: crypto.randomUUID() } }
    expect((await verify(tampered)).links[0].problems).toEqual(['session_id'])
  })

  it('checks a shared copy whose bundle has the share-link shape (no schema, no algorithm)', async () => {
    const original = await newRecord({ photo: 'legacy' })
    const r = await verifyRecord(sharedCopyOf(original, shareShape(original.signature!)), {
      publicKeys: [testKey.publicKey],
    })
    expect(statuses(r)).toEqual(['arrival#0:valid'])
    expect(r.overall).toBe('valid')
    // The missing fields are filled in from the signed payload and the fixed algorithm.
    expect(r.links[0].bundle).toEqual(original.signature)
    expect(r.photos[0]).toMatchObject({ role: 'sign', status: 'not_on_device', signer: 'parkproof' })

    const wrongAlgorithm = sharedCopyOf(original, { ...shareShape(original.signature!), algorithm: 'RSASSA_PSS_SHA_256' })
    expect((await verify(wrongAlgorithm)).links[0].problems).toEqual(['algorithm'])
  })

  it('verifyArrivalBundle takes the share-link shape: four fields, schema and algorithm optional', async () => {
    const keys = { publicKeys: [testKey.publicKey] }
    const s = await newRecord()
    const share = shareShape(s.signature!)
    expect(Object.keys(share).sort()).toEqual(['canonical_payload', 'key_alias', 'signature_base64', 'signed_at'])
    const check = await verifyArrivalBundle(share, { ...keys, sessionId: s.id })
    expect(check.status).toBe('valid')
    expect(check.signature_ok).toBe(true)
    expect(check.bundle).toEqual(s.signature)
    expect(check.payload?.schema).toBe(EVIDENCE_V2_SCHEMA)
    // A v1 link 0 too, and with only one of the two left out.
    const v1 = await newRecord({ v2: false })
    expect((await verifyArrivalBundle(shareShape(v1.signature!), keys)).status).toBe('valid')
    expect((await verifyArrivalBundle({ ...share, algorithm: 'ECDSA_SHA_256' }, keys)).status).toBe('valid')
    expect((await verifyArrivalBundle({ ...share, schema: EVIDENCE_V2_SCHEMA }, keys)).status).toBe('valid')
    // A changed share link still fails its signature.
    const changed = { ...share, canonical_payload: s.signature!.canonical_payload.replace('12 King St', '14 King St') }
    expect((await verifyArrivalBundle(changed, keys)).problems).toEqual(['signature'])
  })

  it('a share-link bundle with schema or algorithm present must still match', async () => {
    const keys = { publicKeys: [testKey.publicKey] }
    const s = await newRecord()
    const share = shareShape(s.signature!)
    const wrongAlgorithm = await verifyArrivalBundle({ ...share, algorithm: 'RSASSA_PSS_SHA_256' }, keys)
    expect(wrongAlgorithm.status).toBe('invalid')
    expect(wrongAlgorithm.problems).toEqual(['algorithm'])
    expect((await verifyArrivalBundle({ ...share, schema: EVIDENCE_V1_SCHEMA }, keys)).problems).toEqual(['schema'])
    // Present but not a string, or a required field missing: unreadable.
    expect((await verifyArrivalBundle({ ...share, algorithm: 7 }, keys)).problems).toEqual(['unreadable'])
    expect((await verifyArrivalBundle({ ...share, schema: null }, keys)).problems).toEqual(['unreadable'])
    const noAlias = { ...share }
    delete noAlias.key_alias
    expect((await verifyArrivalBundle(noAlias, keys)).problems).toEqual(['unreadable'])
    // An unreadable payload with no schema to read is unreadable.
    expect((await verifyArrivalBundle({ ...share, canonical_payload: 'not json' }, keys)).problems).toEqual(['unreadable'])
    // The schema read from the payload must still be link 0's (v1 or v2).
    const addendum = await addLink(s, 'departure', departureData())
    expect((await verifyArrivalBundle(shareShape(addendum.bundle!), keys)).problems).toEqual(['schema'])
  })

  it('verifyArrivalBundle checks one link 0 on its own', async () => {
    const s = await newRecord()
    const keys = { publicKeys: [testKey.publicKey] }
    expect((await verifyArrivalBundle(s.signature, { ...keys, sessionId: s.id })).status).toBe('valid')
    expect((await verifyArrivalBundle(s.signature, keys)).status).toBe('valid')
    expect((await verifyArrivalBundle(s.signature, { ...keys, sessionId: 'someone-else' })).problems).toEqual(['session_id'])
    expect((await verifyArrivalBundle({ nope: true }, keys)).problems).toEqual(['unreadable'])
    const changed = { ...s.signature!, canonical_payload: s.signature!.canonical_payload.replace('12 King St', '14 King St') }
    expect((await verifyArrivalBundle(changed, keys)).problems).toEqual(['signature'])
    const dev = await newRecord({ keyAlias: DEV_KEY_ALIAS })
    expect((await verifyArrivalBundle(dev.signature)).status).toBe('dev_key')
  })
})

// ─── No WebCrypto ────────────────────────────────────────────────────────

describe('without WebCrypto', () => {
  it('refuses to run rather than report anything', async () => {
    const s = await newRecord()
    vi.stubGlobal('crypto', {})
    const err = await verifyRecord(s, { arrivalRejection: null }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(VerifierUnavailableError)
    expect(isVerifierUnavailable(err)).toBe(true)
    await expect(verifyArrivalBundle(s.signature)).rejects.toBeInstanceOf(VerifierUnavailableError)
  })
})

// ─── Copy ────────────────────────────────────────────────────────────────

describe('copy', () => {
  const lookup = (path: string): unknown =>
    path.split('.').reduce<unknown>((node, k) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[k] : undefined), en)
  const link = (
    status: LinkStatus,
    problems: LinkProblem[] = [],
    signature_ok: LinkCheck['signature_ok'] = null,
  ): Pick<LinkCheck, 'status' | 'problems' | 'signature_ok'> => ({ status, problems, signature_ok })

  it('every status maps to a key that exists', () => {
    for (const key of [
      ...Object.values(LINK_STATUS_KEYS),
      ...Object.values(PHOTO_STATUS_KEYS),
      FORK_KEY,
      LINK_CHAIN_BROKEN_KEY,
      PHOTO_NOT_ON_DEVICE_DEV_KEY,
    ]) {
      expect(typeof lookup(key), key).toBe('string')
    }
  })

  it('renders the statuses in words', () => {
    expect(linkStatusText(link('pending'), t)).toBe('Not signed yet')
    expect(linkStatusText(link('rejected'), t)).toBe("This part couldn't be signed")
    expect(linkStatusText(link('dev_key'), t)).toMatch(/^Signed with a development key/)
    expect(linkStatusText(link('valid', [], true), t)).toBe(
      "Signature valid. The signed details haven't changed since ParkProof signed them.",
    )
    expect(linkStatusText(link('invalid', ['signature'], false), t)).toBe(
      "Signature not valid. This part isn't what ParkProof signed for this record.",
    )
    expect(forkText(t)).toBe('Added from two devices')
    const sha = hex64('3f9a').slice(0, 60) + 'c21b'
    expect(photoStatusText({ status: 'matches', sha256: sha, signer: 'parkproof' }, t)).toBe(
      'This photo matches its signed fingerprint.',
    )
    expect(photoStatusText({ status: 'differs', sha256: sha, signer: 'parkproof' }, t)).toMatch(/^This isn't the photo/)
    expect(photoStatusText({ status: 'not_on_device', sha256: sha, signer: 'parkproof' }, t)).toBe(
      `Photo not on this device. Signed fingerprint ${shortFingerprint(sha)}.`,
    )
    expect(shortFingerprint(sha)).toBe('3f9a…c21b')
    // A photo only development-key links sign is signed, so it never reads "Not signed yet".
    const devKeyText = photoStatusText({ status: 'not_on_device', sha256: sha, signer: 'dev_key' }, t)
    expect(devKeyText).toBe(`Photo not on this device. Fingerprint ${shortFingerprint(sha)}. Signed with a development key.`)
    expect(devKeyText).not.toContain('Not signed yet')
  })

  it('words an invalid link by its problems', () => {
    // Only the chain around it is in doubt: its place can't be checked.
    for (const problems of [['parent_missing'], ['parent_hash'], ['chain_key'], ['parent_hash', 'chain_key']] as LinkProblem[][]) {
      expect(linkStatusKey(link('invalid', problems, true)), problems.join()).toBe(LINK_CHAIN_BROKEN_KEY)
      expect(linkStatusText(link('invalid', problems, null), t)).toBe(EN_CHAIN_BROKEN)
    }
    // Anything else about the part itself, or a failing signature: not valid.
    for (const problems of [['signature'], ['entry_mismatch'], ['unreadable'], ['session_id'], ['parent_missing', 'signature'], ['parent_hash', 'entry_mismatch']] as LinkProblem[][]) {
      expect(linkStatusKey(link('invalid', problems, problems.includes('signature') ? false : true)), problems.join()).toBe(
        LINK_STATUS_KEYS.invalid,
      )
    }
    // Never chain-broken when its own signature failed, even if a caller drops the code.
    expect(linkStatusKey(link('invalid', ['parent_missing'], false))).toBe(LINK_STATUS_KEYS.invalid)
    expect(isChainOnlyProblem(link('valid', [], true))).toBe(false)
  })

  it('the en copy makes no claim the verifier cannot back', () => {
    // The valid line is about the signed details, not the whole part (a photo
    // can differ on a valid link); the invalid line doesn't say which of
    // "changed" or "not signed by ParkProof" happened.
    expect(en.verifier.link.valid).not.toMatch(/this part hasn't changed/i)
    expect(EN_INVALID).not.toMatch(/has changed|didn't sign/i)
    expect(EN_CHAIN_BROKEN).not.toMatch(/changed|not valid/i)
  })
})

// ─── A real KMS bundle (optional) ────────────────────────────────────────
// Drop a bundle signed by the production key at src/lib/__fixtures__/kms-bundle.json
// (a SignatureBundle, or a whole saved record with `signature`) to check the
// verifier against KMS itself.

const FIXTURES = import.meta.glob<unknown>('./__fixtures__/kms-bundle.json', { eager: true, import: 'default' })
const KMS_FIXTURE = FIXTURES['./__fixtures__/kms-bundle.json'] as Record<string, unknown> | undefined
if (!KMS_FIXTURE) {
  console.warn('[verify.test] src/lib/__fixtures__/kms-bundle.json is absent, so the real KMS bundle check is skipped')
}

describe.skipIf(!KMS_FIXTURE)('a real KMS bundle', () => {
  const bundle = (KMS_FIXTURE && 'canonical_payload' in KMS_FIXTURE
    ? KMS_FIXTURE
    : (KMS_FIXTURE?.signature as Record<string, unknown> | undefined)) as unknown as SignatureBundle

  it("verifies with ParkProof's published key, and fails once changed", async () => {
    const key = await parkProofPublicKey()
    expect(await verifySignature([key], bundle.canonical_payload, bundle.signature_base64)).toBe(true)
    expect(await verifySignature([key], bundle.canonical_payload + ' ', bundle.signature_base64)).toBe(false)
  })

  it('a saved record with it has no invalid links', async () => {
    const record = (KMS_FIXTURE && 'canonical_payload' in KMS_FIXTURE
      ? { id: JSON.parse(bundle.canonical_payload).session_id, signature: bundle }
      : KMS_FIXTURE) as unknown as ParkingSession
    const r = await verifyRecord(record, { arrivalRejection: null })
    expect(r.counts.invalid).toBe(0)
    expect(r.links[0].status).toBe('valid')
  })
})
