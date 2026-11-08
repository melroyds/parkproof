// @vitest-environment happy-dom
//
// A workday stop's link to the stop before it (build spec T6b item 11, N2),
// end to end through the REAL Lambda handler with a local P-256 key, like
// signing.test.ts. The signing queue signs a stop's arrival_context only
// after the previous stop's departure is signed, with that departure's
// payload hash in workday.previous_departure_payload_sha256, or after 24
// hours with null. Link 0 never waits. With VITE_FEATURE_WORKDAY off
// nothing waits.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArrivalContextData, LogDraft, ParkingSession, SignatureBundle } from '../types'

const flag = vi.hoisted(() => ({ on: true }))
vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))
vi.mock('./features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./features')>()),
  isWorkdayEnabled: () => flag.on,
}))

import { handleSignSessionRequest } from '../../lambda/index.js'
import { getSession, saveSession } from './storage'
import { emptyLogDraft } from './evidence-chain'
import { PREVIOUS_DEPARTURE_WAIT_MS } from './workday-chain'
import {
  enqueueSigning,
  prepareNewRecord,
  queueAddendum,
  resetSigningQueueForTests,
  signNewRecord,
  whenSigningIdle,
} from './signing'

const ECDSA = { name: 'ECDSA', hash: 'SHA-256' } as const
let testKey: CryptoKeyPair
let TEST_PUBLIC_PEM = ''
const bytesToBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
const utf8 = (text: string) => new TextEncoder().encode(text)

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
async function signDer(message: Uint8Array): Promise<Uint8Array> {
  return rawToDer(new Uint8Array(await crypto.subtle.sign(ECDSA, testKey.privateKey, message as Uint8Array<ArrayBuffer>)))
}
async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(text)))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

beforeAll(async () => {
  testKey = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', testKey.publicKey))
  const NL = String.fromCharCode(10)
  TEST_PUBLIC_PEM = ['-----BEGIN PUBLIC KEY-----', bytesToBase64(spki).match(/.{1,64}/g)!.join(NL), '-----END PUBLIC KEY-----', ''].join(NL)
})

type Body = Record<string, unknown> & { schema?: string; seq?: number; kind?: string; session_id?: string }
const net: { calls: Body[]; refuse: ((body: Body) => boolean) | null } = { calls: [], refuse: null }

async function fakeFetch(_url: string, init: RequestInit): Promise<Response> {
  const text = init.body as string
  const body = JSON.parse(text) as Body
  net.calls.push(body)
  if (net.refuse?.(body)) return new Response(JSON.stringify({ error: 'ERR_BAD_VALUE' }), { status: 400 })
  const res = await handleSignSessionRequest(
    { body: text },
    { signer: ({ message }) => signDer(message), keyAlias: 'test-local', parentPublicKeys: [TEST_PUBLIC_PEM] },
  )
  return new Response(res.body, { status: res.statusCode })
}

const W = '0f0e0d0c-1111-4111-8111-111111111111'
const SIGN_PHOTO = 'data:image/jpeg;base64,' + btoa('fake-jpeg-bytes-of-a-sign')
const payloadOf = (b: SignatureBundle) => JSON.parse(b.canonical_payload) as Record<string, unknown>
const calls = (id: string) =>
  net.calls.filter((c) => c.session_id === id).map((c) => (c.schema === 'parkproof-addendum-v1' ? `${c.kind}#${c.seq}` : 'link0'))
const arrivalOf = (s: ParkingSession) => s.addenda!.find((a) => a.kind === 'arrival_context')!
const workdayLinkOf = (data: unknown) => (data as ArrivalContextData).workday

/** Save a workday stop the way App does: prepare, save, then start its chain. */
async function saveStop(id: string, legIndex: number): Promise<ParkingSession> {
  const prepared = await prepareNewRecord({
    id,
    arrived_at: new Date(Date.now() - (5 - legIndex) * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 9 },
    sign_photo: SIGN_PHOTO,
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: new Date(Date.now() + 90 * 60_000).toISOString(),
    confidence: 'high',
    jurisdiction: 'VIC',
    workday_id: W,
    leg_index: legIndex,
    boundary:
      legIndex === 0
        ? null
        : { previous_session_id: `stop-${legIndex - 1}`, asked_because: ['within_30m'], answer: 'yellow_edge_line', distance_from_previous_m: 12 },
  })
  saveSession(prepared)
  const draft: LogDraft = { ...emptyLogDraft(), workday: { workday_id: W, leg_index: legIndex, previous_session_id: null } }
  signNewRecord(prepared.id, draft)
  await whenSigningIdle()
  return getSession(prepared.id)!
}

async function depart(id: string): Promise<void> {
  queueAddendum(id, 'departure', {
    ended_at: new Date(Date.now() - 1_000).toISOString(),
    location: null,
    distance_from_arrival_m: null,
    return_photos: [],
  })
  await whenSigningIdle()
}

beforeEach(() => {
  flag.on = true
  localStorage.clear()
  resetSigningQueueForTests()
  net.calls.length = 0
  net.refuse = null
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})

afterEach(async () => {
  await whenSigningIdle()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('a workday stop links to the stop before it', () => {
  it('the first stop signs its arrival_context at once, with a null link', async () => {
    const first = await saveStop('stop-0', 0)
    expect(calls('stop-0')).toEqual(['link0', 'arrival_context#1'])
    const signed = payloadOf(arrivalOf(first).bundle!)
    expect(workdayLinkOf(signed.data)).toEqual({
      workday_id: W,
      leg_index: 0,
      stretch_deadline: null,
      previous_departure_payload_sha256: null,
    })
  })

  it("a later stop's arrival_context waits for the previous departure, then signs its payload hash", async () => {
    await saveStop('stop-0', 0)
    const second = await saveStop('stop-1', 1)
    // Link 0 never waits; link 1 does, until stop 0's departure is signed.
    expect(calls('stop-1')).toEqual(['link0'])
    expect(second.signature).toBeTruthy()
    expect(arrivalOf(second).bundle).toBeUndefined()

    await depart('stop-0')
    await whenSigningIdle()
    const dep = getSession('stop-0')!.addenda!.find((a) => a.kind === 'departure')!
    expect(dep.bundle).toBeTruthy()
    // Signing the departure woke stop 1's queue: no sweep was needed.
    expect(calls('stop-1')).toEqual(['link0', 'arrival_context#1'])
    const after = getSession('stop-1')!
    const link1 = arrivalOf(after)
    const expected = await sha256Hex(dep.bundle!.canonical_payload)
    expect(workdayLinkOf(payloadOf(link1.bundle!).data)!.previous_departure_payload_sha256).toBe(expected)
    // What is stored is what was signed.
    expect(payloadOf(link1.bundle!).data).toEqual(link1.data)
    // The boundary statement is signed with it.
    expect((payloadOf(link1.bundle!).data as unknown as ArrivalContextData).boundary).toMatchObject({
      answer: 'yellow_edge_line',
      asked_because: ['within_30m'],
    })
  })

  it('signs with null after 24 hours when the previous departure never arrives', async () => {
    await saveStop('stop-0', 0)
    await saveStop('stop-1', 1)
    expect(calls('stop-1')).toEqual(['link0'])
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + PREVIOUS_DEPARTURE_WAIT_MS + 1_000)
    await enqueueSigning('stop-1')
    const link1 = arrivalOf(getSession('stop-1')!)
    expect(link1.bundle).toBeTruthy()
    expect(workdayLinkOf(payloadOf(link1.bundle!).data)!.previous_departure_payload_sha256).toBeNull()
  })

  it('signs with null at once when the previous departure was refused, with no sweep needed', async () => {
    await saveStop('stop-0', 0)
    await saveStop('stop-1', 1)
    expect(calls('stop-1')).toEqual(['link0'])
    net.refuse = (b) => b.kind === 'departure'
    await depart('stop-0')
    await whenSigningIdle()
    expect(getSession('stop-0')!.addenda!.find((a) => a.kind === 'departure')!.rejected).toBeTruthy()
    // The refusal woke stop 1's queue: its arrival_context is signed without a sweep or another trigger.
    expect(calls('stop-1')).toEqual(['link0', 'arrival_context#1'])
    const link1 = arrivalOf(getSession('stop-1')!)
    expect(link1.bundle).toBeTruthy()
    expect(workdayLinkOf(link1.data)!.previous_departure_payload_sha256).toBeNull()
  })

  it('with VITE_FEATURE_WORKDAY off, nothing waits', async () => {
    flag.on = false
    await saveStop('stop-0', 0)
    await saveStop('stop-1', 1)
    expect(calls('stop-1')).toEqual(['link0', 'arrival_context#1'])
    expect(workdayLinkOf(arrivalOf(getSession('stop-1')!).data)!.previous_departure_payload_sha256).toBeNull()
  })
})
