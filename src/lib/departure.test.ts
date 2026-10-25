// @vitest-environment happy-dom
//
// The signed departure (spec T1a): the GPS fix the departure sheet starts
// (high accuracy, maximumAge 0, a too-rough fix dropped), the distance rule
// (phone GPS to phone GPS only), waiting up to 8 s after Confirm, a fresh
// fix when the sheet's is too old, and saving the record's `departure` plus
// the departure addendum. End to end, the departure is signed by the REAL
// Lambda handler on top of link 0 and link 1 and the whole chain verifies.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession } from '../types'

vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

import {
  DEPARTURE_FAR_M,
  DEPARTURE_FIX_MAX_AGE_MS,
  DEPARTURE_FIX_PRE_TAP_MAX_MS,
  DEPARTURE_FIX_TIMEOUT_MS,
  DEPARTURE_FIX_WAIT_MS,
  buildDepartureData,
  completeDeparture,
  departureField,
  departureLocation,
  distanceFromArrival,
  farFromArrival,
  fixFailureReason,
  fixFromPosition,
  fixUsableAt,
  needsFreshFix,
  requestDepartureFix,
  saveDeparture,
  waitForFix,
  type DepartureFixRequest,
  type DepartureFixState,
  type GeolocationLike,
} from './departure'
import { appendAddendum, endSession, getSession, saveSession } from './storage'
import { emptyLogDraft } from './evidence-chain'
import {
  prepareNewRecord,
  resetSigningQueueForTests,
  signNewRecord,
  whenSigningIdle,
} from './signing'
import { verifyRecord } from './verify'
import { createTestSigner, type TestSigner } from './test-support/test-signer'

const T0 = Date.parse('2026-10-25T02:55:00.000Z')
const GPS_ARRIVAL = { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps' as const, accuracy_meters: 8 }

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-dep',
    arrived_at: new Date(T0 - 60 * 60_000).toISOString(),
    location: GPS_ARRIVAL,
    sign_photo: 'data:image/jpeg;base64,' + btoa('sign-bytes'),
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: new Date(T0 + 60 * 60_000).toISOString(),
    confidence: 'high',
    ...overrides,
  }
}

/** A fix request whose state the test sets by hand. */
function manualRequest(initial: DepartureFixState = { status: 'pending' }) {
  let state = initial
  const listeners = new Set<() => void>()
  let resolve: (s: Exclude<DepartureFixState, { status: 'pending' }>) => void = () => {}
  const settled = new Promise<Exclude<DepartureFixState, { status: 'pending' }>>((r) => {
    resolve = r
  })
  if (state.status !== 'pending') resolve(state)
  const request: DepartureFixRequest = {
    current: () => state,
    settled,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    request,
    settle(next: Exclude<DepartureFixState, { status: 'pending' }>) {
      state = next
      resolve(next)
      for (const l of listeners) l()
    },
  }
}

const okFix = (lat: number, lng: number, accuracy: number, received_at: number): Extract<DepartureFixState, { status: 'ok' }> => ({
  status: 'ok',
  fix: { lat, lng, accuracy_meters: accuracy, received_at },
})

beforeEach(() => {
  localStorage.clear()
  resetSigningQueueForTests()
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  // No server by default: every signing request is transient, so queued links stay pending.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
})

afterEach(async () => {
  await whenSigningIdle()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the fix', () => {
  it('asks once for a high-accuracy, uncached fix with the 8 s timeout', () => {
    const getCurrentPosition = vi.fn()
    requestDepartureFix({ geolocation: { getCurrentPosition } })
    expect(getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({
      enableHighAccuracy: true,
      timeout: DEPARTURE_FIX_TIMEOUT_MS,
      maximumAge: 0,
    })
    expect(DEPARTURE_FIX_TIMEOUT_MS).toBe(8_000)
    expect(DEPARTURE_FIX_WAIT_MS).toBe(8_000)
  })

  it('goes from pending to ok once, telling subscribers, and ignores a second answer', async () => {
    let ok: ((pos: GeolocationPosition) => void) | null = null
    const geolocation: GeolocationLike = {
      getCurrentPosition: (success) => {
        ok = success
      },
    }
    const req = requestDepartureFix({ geolocation, now: () => 1234 })
    const listener = vi.fn()
    req.subscribe(listener)
    expect(req.current()).toEqual({ status: 'pending' })
    const same = req.current()
    expect(req.current()).toBe(same) // stable snapshot for useSyncExternalStore

    const pos = { coords: { latitude: -37.81, longitude: 144.96, accuracy: 9 } } as GeolocationPosition
    ok!(pos)
    ok!({ coords: { latitude: 0, longitude: 0, accuracy: 1 } } as GeolocationPosition)
    expect(req.current()).toEqual(okFix(-37.81, 144.96, 9, 1234))
    expect(listener).toHaveBeenCalledTimes(1)
    await expect(req.settled).resolves.toEqual(okFix(-37.81, 144.96, 9, 1234))
  })

  it('maps the browser errors, and settles at once without a geolocation API', async () => {
    expect(fixFailureReason({ code: 1 })).toBe('denied')
    expect(fixFailureReason({ code: 2 })).toBe('unavailable')
    expect(fixFailureReason({ code: 3 })).toBe('timeout')
    expect(fixFailureReason({ code: 9 })).toBe('error')
    expect(fixFailureReason(null)).toBe('error')

    const denied = requestDepartureFix({
      geolocation: { getCurrentPosition: (_ok, fail) => fail?.({ code: 1 } as GeolocationPositionError) },
      now: () => 5,
    })
    expect(denied.current()).toEqual({ status: 'none', reason: 'denied', at: 5 })

    const none = requestDepartureFix({ geolocation: null, now: () => 6 })
    expect(none.current()).toEqual({ status: 'none', reason: 'unsupported', at: 6 })
    await expect(none.settled).resolves.toEqual({ status: 'none', reason: 'unsupported', at: 6 })

    const throws = requestDepartureFix({
      geolocation: {
        getCurrentPosition: () => {
          throw new Error('blocked')
        },
      },
      now: () => 7,
    })
    expect(throws.current()).toEqual({ status: 'none', reason: 'error', at: 7 })
  })

  it('drops a fix rougher than 100 m, and nonsense coordinates', () => {
    const at = (accuracy: number, latitude = -37.8, longitude = 144.9) =>
      fixFromPosition({ coords: { latitude, longitude, accuracy } }, 10)
    expect(at(100).status).toBe('ok')
    expect(at(100.5)).toEqual({ status: 'none', reason: 'inaccurate', at: 10 })
    expect(at(2_300)).toEqual({ status: 'none', reason: 'inaccurate', at: 10 })
    expect(at(Number.NaN)).toEqual({ status: 'none', reason: 'inaccurate', at: 10 })
    expect(at(-1)).toEqual({ status: 'none', reason: 'inaccurate', at: 10 })
    expect(at(5, 91)).toEqual({ status: 'none', reason: 'error', at: 10 })
    expect(at(5, -37.8, Number.POSITIVE_INFINITY)).toEqual({ status: 'none', reason: 'error', at: 10 })
  })

  it('a fix is usable up to 15 s before the tap or a minute after it; older ones get a fresh fix', () => {
    const fix = { lat: 1, lng: 2, accuracy_meters: 5, received_at: T0 }
    // Taken before the tap: a car can be hundreds of metres away a minute later.
    expect(DEPARTURE_FIX_PRE_TAP_MAX_MS).toBe(15_000)
    expect(fixUsableAt(fix, T0 + DEPARTURE_FIX_PRE_TAP_MAX_MS)).toBe(true)
    expect(fixUsableAt(fix, T0 + DEPARTURE_FIX_PRE_TAP_MAX_MS + 1)).toBe(false)
    expect(fixUsableAt(fix, T0 + 50_000)).toBe(false)
    // Came in after the tap.
    expect(fixUsableAt(fix, T0 - 8_000)).toBe(true)
    expect(fixUsableAt(fix, T0 - DEPARTURE_FIX_MAX_AGE_MS)).toBe(true)
    expect(fixUsableAt(fix, T0 - DEPARTURE_FIX_MAX_AGE_MS - 1)).toBe(false)
    expect(fixUsableAt(fix, Number.NaN)).toBe(false)

    expect(needsFreshFix({ status: 'pending' }, T0)).toBe(false)
    expect(needsFreshFix({ status: 'ok', fix }, T0 + 10_000)).toBe(false)
    // Opened the sheet at the bay, confirmed 50 s later: ask again.
    expect(needsFreshFix({ status: 'ok', fix }, T0 + 50_000)).toBe(true)
    expect(needsFreshFix({ status: 'ok', fix }, T0 + 2 * 60_000)).toBe(true)
    // A timeout two minutes ago may work now; a refusal or no API never asks again.
    expect(needsFreshFix({ status: 'none', reason: 'timeout', at: T0 }, T0 + 2 * 60_000)).toBe(true)
    expect(needsFreshFix({ status: 'none', reason: 'timeout', at: T0 }, T0 + 5_000)).toBe(false)
    expect(needsFreshFix({ status: 'none', reason: 'denied', at: T0 }, T0 + 2 * 60_000)).toBe(false)
    expect(needsFreshFix({ status: 'none', reason: 'unsupported', at: T0 }, T0 + 2 * 60_000)).toBe(false)
  })

  it('waitForFix answers at once when settled, waits for a pending one, and gives up after the wait', async () => {
    vi.useFakeTimers()
    const done = manualRequest(okFix(1, 2, 3, T0))
    await expect(waitForFix(done.request, 8_000)).resolves.toEqual(okFix(1, 2, 3, T0))

    const late = manualRequest()
    const waiting = waitForFix(late.request, 8_000)
    await vi.advanceTimersByTimeAsync(3_000)
    late.settle(okFix(4, 5, 6, T0))
    await expect(waiting).resolves.toEqual(okFix(4, 5, 6, T0))

    const never = manualRequest()
    const givingUp = waitForFix(never.request, 8_000)
    await vi.advanceTimersByTimeAsync(7_999)
    let settled = false
    void givingUp.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(givingUp).resolves.toBeNull()
  })
})

describe('departure data', () => {
  const loc = (lat: number, lng: number, accuracy_meters: number | null = 10) =>
    ({ lat, lng, accuracy_meters, source: 'gps' }) as const

  it('distance is whole metres, phone GPS to phone GPS only', () => {
    // ~200 m north.
    const d = distanceFromArrival({ location: GPS_ARRIVAL }, loc(-37.8118, 144.9631))!
    expect(Number.isInteger(d)).toBe(true)
    expect(d).toBeGreaterThan(195)
    expect(d).toBeLessThan(205)
    expect(distanceFromArrival({ location: GPS_ARRIVAL }, loc(-37.8136, 144.9631))).toBe(0)
    // Nothing to compare.
    expect(distanceFromArrival({ location: GPS_ARRIVAL }, null)).toBeNull()
    expect(distanceFromArrival({ location: null }, loc(-37.81, 144.96))).toBeNull()
    // An address typed in (its point came from a map search), a rough arrival fix, an old record without a source.
    expect(distanceFromArrival({ location: { ...GPS_ARRIVAL, source: 'manual' } }, loc(-37.81, 144.96))).toBeNull()
    expect(distanceFromArrival({ location: { ...GPS_ARRIVAL, accuracy_meters: 450 } }, loc(-37.81, 144.96))).toBeNull()
    expect(distanceFromArrival({ location: { lat: -37.8136, lng: 144.9631 } }, loc(-37.81, 144.96))).toBeNull()
  })

  it('says "far" only when the distance still exceeds 150 m once both fixes\' error is taken off', () => {
    // A phone that never left the bay, two rough CBD fixes.
    expect(farFromArrival(170, 95, 95)).toBe(false)
    expect(farFromArrival(160, 90, 90)).toBe(false)
    // Good fixes: 201 m with ±8 m and ±12 m is clearly away.
    expect(farFromArrival(201, 8, 12)).toBe(true)
    expect(farFromArrival(DEPARTURE_FAR_M + 20, 8, 12)).toBe(false)
    expect(farFromArrival(DEPARTURE_FAR_M + 21, 8, 12)).toBe(true)
    // An unknown accuracy counts as the worst usable one (100 m).
    expect(farFromArrival(300, null, 10)).toBe(true)
    expect(farFromArrival(250, undefined, 10)).toBe(false)
    expect(farFromArrival(null, 5, 5)).toBe(false)
  })

  it('builds schema-valid departure data and the record field', () => {
    const location = departureLocation({ lat: -37.8118, lng: 144.9631, accuracy_meters: 12.5, received_at: T0 })
    expect(location).toEqual({ lat: -37.8118, lng: 144.9631, accuracy_meters: 12.5, source: 'gps' })
    const data = buildDepartureData({ location: GPS_ARRIVAL }, '2026-10-25T02:55:00.000Z', location)
    expect(data).toEqual({
      ended_at: '2026-10-25T02:55:00.000Z',
      location,
      distance_from_arrival_m: expect.any(Number),
      return_photos: [],
    })
    expect(data.distance_from_arrival_m!).toBeGreaterThan(DEPARTURE_FAR_M)
    expect(departureField(data)).toEqual({
      ended_at: data.ended_at,
      location,
      distance_from_arrival_m: data.distance_from_arrival_m,
    })
    // What is stored is what the shared schema accepts (appendAddendum normalises and throws otherwise).
    saveSession(record())
    expect(appendAddendum('rec-dep', { kind: 'departure', data })?.data).toEqual(data)
    expect(buildDepartureData({ location: GPS_ARRIVAL }, data.ended_at, null)).toEqual({
      ended_at: data.ended_at,
      location: null,
      distance_from_arrival_m: null,
      return_photos: [],
    })
  })
})

describe('saveDeparture and completeDeparture', () => {
  const ENDED = '2026-10-25T02:55:00.000Z'
  const ended = (overrides: Partial<ParkingSession> = {}) => {
    saveSession(record({ ended_at: ENDED, ...overrides }))
  }

  it('saves the field, queues one departure addendum and reports the change', () => {
    ended()
    const onRecordUpdated = vi.fn()
    const location = { lat: -37.8118, lng: 144.9631, accuracy_meters: 12, source: 'gps' as const }
    const result = saveDeparture('rec-dep', ENDED, location, onRecordUpdated)
    expect(result.status).toBe('saved')
    const s = getSession('rec-dep')!
    expect(s.departure).toEqual({ ended_at: ENDED, location, distance_from_arrival_m: expect.any(Number) })
    const deps = s.addenda!.filter((a) => a.kind === 'departure')
    expect(deps).toHaveLength(1)
    expect(deps[0].data).toEqual({ ...s.departure, return_photos: [] })
    expect(onRecordUpdated).toHaveBeenCalledWith('rec-dep')
  })

  it('skips a record that is gone, shared, or no longer carries this tap', () => {
    expect(saveDeparture('nope', ENDED, null)).toEqual({ status: 'skipped', reason: 'missing' })
    ended({ id: 'shared', shared_from: { original_session_id: 'x', received_at: ENDED, shared_at: null, arrival_bundle: null, snapshot: {} } })
    expect(saveDeparture('shared', ENDED, null)).toEqual({ status: 'skipped', reason: 'shared' })
    ended({ id: 'other-tap', ended_at: '2026-10-25T02:50:00.000Z' })
    expect(saveDeparture('other-tap', ENDED, null)).toEqual({ status: 'skipped', reason: 'not_this_tap' })
    expect(getSession('other-tap')!.departure).toBeUndefined()
  })

  it('when the catch-up got there first, adds no second departure and copies its data to the field', () => {
    ended()
    const first = appendAddendum('rec-dep', {
      kind: 'departure',
      data: { ended_at: ENDED, location: null, distance_from_arrival_m: null, return_photos: [] },
    })!
    const result = saveDeparture('rec-dep', ENDED, { lat: -37.81, lng: 144.96, accuracy_meters: 5, source: 'gps' })
    expect(result).toMatchObject({ status: 'saved', addendum: first })
    const s = getSession('rec-dep')!
    expect(s.addenda!.filter((a) => a.kind === 'departure')).toHaveLength(1)
    expect(s.departure).toEqual({ ended_at: ENDED, location: null, distance_from_arrival_m: null })
  })

  it("queues no addendum on a v2 chain whose key isn't on this device (the field is still saved)", () => {
    ended({
      signature: {
        schema: 'parkproof-evidence-v2',
        signed_at: ENDED,
        algorithm: 'ECDSA_SHA_256',
        key_alias: 'alias/parkproof-evidence-signing',
        canonical_payload: JSON.stringify({ schema: 'parkproof-evidence-v2', chain_key_sha256: 'a'.repeat(64) }),
        signature_base64: 'MEUCIQ',
      },
    })
    const result = saveDeparture('rec-dep', ENDED, null)
    expect(result).toMatchObject({ status: 'saved', addendum: null })
    expect(getSession('rec-dep')!.addenda ?? []).toEqual([])
    expect(getSession('rec-dep')!.departure).toBeDefined()
  })

  it('keeps an existing departure field', () => {
    const kept = { ended_at: ENDED, location: null, distance_from_arrival_m: null }
    ended({ departure: kept })
    saveDeparture('rec-dep', ENDED, { lat: -37.81, lng: 144.96, accuracy_meters: 5, source: 'gps' })
    expect(getSession('rec-dep')!.departure).toEqual(kept)
  })

  it("uses the sheet's fix when it came in around the tap", async () => {
    ended()
    const sheet = manualRequest(okFix(-37.8118, 144.9631, 12, Date.parse(ENDED) - 3_000))
    const requestFix = vi.fn()
    const result = await completeDeparture('rec-dep', ENDED, sheet.request, { requestFix })
    expect(requestFix).not.toHaveBeenCalled()
    expect(result.status).toBe('saved')
    expect(getSession('rec-dep')!.departure!.location).toEqual({ lat: -37.8118, lng: 144.9631, accuracy_meters: 12, source: 'gps' })
  })

  it('waits for a fix still coming in after the tap', async () => {
    ended()
    const sheet = manualRequest()
    const done = completeDeparture('rec-dep', ENDED, sheet.request)
    await Promise.resolve()
    expect(getSession('rec-dep')!.departure).toBeUndefined()
    sheet.settle(okFix(-37.8136, 144.9632, 7, Date.parse(ENDED) + 2_000))
    await done
    expect(getSession('rec-dep')!.departure!.location?.accuracy_meters).toBe(7)
  })

  it('saves without a location when no fix comes within the wait', async () => {
    vi.useFakeTimers()
    ended()
    const sheet = manualRequest()
    const done = completeDeparture('rec-dep', ENDED, sheet.request)
    await vi.advanceTimersByTimeAsync(DEPARTURE_FIX_WAIT_MS)
    await done
    expect(getSession('rec-dep')!.departure).toEqual({ ended_at: ENDED, location: null, distance_from_arrival_m: null })
    // A fix that turns up after the wait changes nothing.
    sheet.settle(okFix(-37.81, 144.96, 5, Date.parse(ENDED) + 9_000))
    await vi.advanceTimersByTimeAsync(10)
    expect(getSession('rec-dep')!.departure!.location).toBeNull()
  })

  it('a fix from more than 15 s before the tap is not signed as where the phone was: a fresh one is asked for', async () => {
    ended()
    // The bay, when the sheet opened 50 s before Confirm.
    const sheet = manualRequest(okFix(-37.8136, 144.9631, 5, Date.parse(ENDED) - 50_000))
    // Where the phone was at Confirm.
    const fresh = manualRequest(okFix(-37.8100, 144.9631, 6, Date.parse(ENDED) + 1_500))
    const requestFix = vi.fn(() => fresh.request)
    await completeDeparture('rec-dep', ENDED, sheet.request, { requestFix })
    expect(requestFix).toHaveBeenCalledTimes(1)
    expect(getSession('rec-dep')!.departure!.location).toEqual({ lat: -37.81, lng: 144.9631, accuracy_meters: 6, source: 'gps' })
    expect(getSession('rec-dep')!.departure!.distance_from_arrival_m).toBeGreaterThan(350)
  })

  it('the fresh fix is asked for synchronously, inside the Confirm click', async () => {
    ended()
    const sheet = manualRequest(okFix(-37.8136, 144.9631, 5, Date.parse(ENDED) - 30_000))
    const fresh = manualRequest()
    const requestFix = vi.fn(() => fresh.request)
    const done = completeDeparture('rec-dep', ENDED, sheet.request, { requestFix })
    // No await yet: the request already started.
    expect(requestFix).toHaveBeenCalledTimes(1)
    fresh.settle({ status: 'none', reason: 'timeout', at: Date.parse(ENDED) + 8_000 })
    await done
    // The bay fix from 30 s before the tap was not used.
    expect(getSession('rec-dep')!.departure!.location).toBeNull()
  })

  it("asks for a fresh fix when the sheet's one is too old for the tap", async () => {
    ended()
    const stale = manualRequest(okFix(-37.9, 145.1, 5, Date.parse(ENDED) - 3 * 60_000))
    const fresh = manualRequest(okFix(-37.8136, 144.9631, 6, Date.parse(ENDED) + 1_000))
    const requestFix = vi.fn(() => fresh.request)
    await completeDeparture('rec-dep', ENDED, stale.request, { requestFix })
    expect(requestFix).toHaveBeenCalledTimes(1)
    expect(getSession('rec-dep')!.departure!.location).toEqual({ lat: -37.8136, lng: 144.9631, accuracy_meters: 6, source: 'gps' })
    expect(getSession('rec-dep')!.departure!.distance_from_arrival_m).toBe(0)
  })

  it('a refused location saves the departure at once, with no location', async () => {
    ended()
    const sheet = manualRequest({ status: 'none', reason: 'denied', at: Date.parse(ENDED) - 1_000 })
    await completeDeparture('rec-dep', ENDED, sheet.request)
    expect(getSession('rec-dep')!.departure).toEqual({ ended_at: ENDED, location: null, distance_from_arrival_m: null })
  })
})

describe('end to end: the departure is signed on top of the chain and verifies', () => {
  let signer: TestSigner
  beforeEach(async () => {
    signer = await createTestSigner()
    vi.stubGlobal('fetch', vi.fn(signer.fetch))
  })

  it('link 0, arrival_context and the departure with the location all verify', async () => {
    const prepared = await prepareNewRecord(record({ arrived_at: new Date(Date.now() - 30 * 60_000).toISOString() }))
    saveSession(prepared)
    signNewRecord(prepared.id, emptyLogDraft())
    await whenSigningIdle(prepared.id)

    const tap = new Date()
    endSession(prepared.id, tap)
    const endedAt = tap.toISOString()
    const sheet = manualRequest(okFix(-37.8118, 144.9631, 11, tap.getTime()))
    const result = await completeDeparture(prepared.id, endedAt, sheet.request)
    expect(result.status).toBe('saved')
    await whenSigningIdle(prepared.id)

    const s = getSession(prepared.id)!
    const dep = s.addenda!.find((a) => a.kind === 'departure')!
    expect(dep.seq).toBe(2)
    expect(dep.bundle).toBeDefined()
    const payload = JSON.parse(dep.bundle!.canonical_payload) as { data: Record<string, unknown> }
    expect(payload.data).toEqual({
      ended_at: endedAt,
      location: { lat: -37.8118, lng: 144.9631, accuracy_meters: 11, source: 'gps' },
      distance_from_arrival_m: s.departure!.distance_from_arrival_m,
      return_photos: [],
    })

    const verification = await verifyRecord(s, { publicKeys: [signer.publicKey], arrivalRejection: null })
    expect(verification.overall).toBe('valid')
    expect(verification.links.map((l) => `${l.kind}#${l.seq}:${l.status}`)).toEqual([
      'arrival#0:valid',
      'arrival_context#1:valid',
      'departure#2:valid',
    ])
    // The departure request carried the tap time inside its data.
    expect(signer.calls.at(-1)).toMatchObject({ kind: 'departure', data: { ended_at: endedAt } })
  })
})
