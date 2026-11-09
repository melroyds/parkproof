// @vitest-environment happy-dom
//
// A workday stop's arrival_context links to the previous stop's signed
// departure (build spec T6b item 11): previous_departure_payload_sha256 is
// filled at sign time, after that departure is signed, or the
// arrival_context is signed with null after 24 hours. These are the pure
// decisions and the one storage write that fills the link.
import { beforeEach, describe, expect, it } from 'vitest'
import type { ArrivalContextData, ParkingSession, SignedAddendum, SignatureBundle } from '../types'
import { PREVIOUS_DEPARTURE_WAIT_MS, legsWaitingOnDeparture, previousDepartureStep, previousLegOf } from './workday-chain'
import { appendAddendum, fillPreviousDepartureHash, getSession, saveSession } from './storage'

const W = '0f0e0d0c-1111-4111-8111-111111111111'
const NOW = Date.parse('2026-11-09T03:00:00.000Z')
const HASH = 'ab'.repeat(32)

function arrivalData(legIndex: number | null, previousHash: string | null = null): ArrivalContextData {
  return {
    driver_name: null,
    sign_status: null,
    sign_issues: [],
    rule_flags: null,
    gate_acks: null,
    permit_commitment: null,
    photos: [],
    condition_note: null,
    compliance_type: null,
    jurisdiction: 'VIC',
    workday:
      legIndex === null
        ? null
        : { workday_id: W, leg_index: legIndex, stretch_deadline: null, previous_departure_payload_sha256: previousHash },
    boundary: null,
  }
}

const bundle = (payload: string): SignatureBundle => ({
  schema: 'parkproof-addendum-v1',
  signed_at: new Date(NOW).toISOString(),
  algorithm: 'ECDSA_SHA_256',
  key_alias: 'test',
  canonical_payload: payload,
  signature_base64: 'c2ln',
})

function arrival(legIndex: number | null, capturedAt = NOW - 60_000, previousHash: string | null = null): SignedAddendum {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    seq: 1,
    kind: 'arrival_context',
    captured_at: new Date(capturedAt).toISOString(),
    data: arrivalData(legIndex, previousHash) as unknown as Record<string, unknown>,
  }
}

function departureAddendum(state: 'pending' | 'signed' | 'rejected'): SignedAddendum {
  return {
    id: '66666666-7777-4888-8999-000000000000',
    seq: 2,
    kind: 'departure',
    captured_at: new Date(NOW - 120_000).toISOString(),
    data: { ended_at: new Date(NOW - 120_000).toISOString(), location: null, distance_from_arrival_m: null, return_photos: [] },
    ...(state === 'signed' ? { bundle: bundle('{"kind":"departure","seq":2}') } : {}),
    ...(state === 'rejected' ? { rejected: { code: 'ERR_BAD_VALUE', at: new Date(NOW).toISOString() } } : {}),
  }
}

function legRecord(id: string, index: number, addenda: SignedAddendum[] = [], overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id,
    arrived_at: new Date(NOW - (3 - index) * 3_600_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    workday_id: W,
    leg_index: index,
    addenda,
    ...overrides,
  }
}

describe('previousDepartureStep', () => {
  it('signs at once: not a workday stop, the first stop, or a link already filled', () => {
    expect(previousDepartureStep('b', arrival(null), [], NOW)).toEqual({ kind: 'sign' })
    expect(previousDepartureStep('b', arrival(0), [], NOW)).toEqual({ kind: 'sign' })
    expect(previousDepartureStep('b', arrival(1, NOW, HASH), [], NOW)).toEqual({ kind: 'sign' })
    expect(previousDepartureStep('b', { ...departureAddendum('pending') }, [], NOW)).toEqual({ kind: 'sign' })
  })

  it('fills from the previous stop signed departure', () => {
    const a = legRecord('a', 0, [departureAddendum('signed')])
    expect(previousDepartureStep('b', arrival(1), [a], NOW)).toEqual({
      kind: 'fill',
      payload: '{"kind":"departure","seq":2}',
    })
  })

  it('waits while the previous departure is pending, missing, or the stop is not on this device', () => {
    expect(previousDepartureStep('b', arrival(1), [legRecord('a', 0, [departureAddendum('pending')])], NOW)).toEqual({ kind: 'wait' })
    expect(previousDepartureStep('b', arrival(1), [legRecord('a', 0)], NOW)).toEqual({ kind: 'wait' })
    expect(previousDepartureStep('b', arrival(1), [], NOW)).toEqual({ kind: 'wait' })
  })

  it('signs with null after 24 hours, and at once when the previous departure was refused', () => {
    const pending = [legRecord('a', 0, [departureAddendum('pending')])]
    const queued = NOW - PREVIOUS_DEPARTURE_WAIT_MS
    expect(previousDepartureStep('b', arrival(1, queued + 1), pending, NOW)).toEqual({ kind: 'wait' })
    expect(previousDepartureStep('b', arrival(1, queued), pending, NOW)).toEqual({ kind: 'sign_null' })
    expect(previousDepartureStep('b', arrival(1), [legRecord('a', 0, [departureAddendum('rejected')])], NOW)).toEqual({
      kind: 'sign_null',
    })
  })
})

describe('previousLegOf and legsWaitingOnDeparture', () => {
  it('the previous stop is the highest leg index below, on the same workday, never a shared copy', () => {
    const legs = [
      legRecord('a', 0),
      legRecord('c', 2),
      legRecord('b', 1),
      legRecord('shared', 1, [], { shared_from: { original_session_id: 'x', received_at: '', shared_at: null, arrival_bundle: null, snapshot: {} } }),
      legRecord('other', 1, [], { workday_id: '0f0e0d0c-2222-4222-8222-222222222222' }),
    ]
    expect(previousLegOf('c', { workday_id: W, leg_index: 2 }, legs)?.id).toBe('b')
    expect(previousLegOf('a', { workday_id: W, leg_index: 0 }, legs)).toBeNull()
  })

  it('names the next stop whose arrival_context waits for this departure', () => {
    const a = legRecord('a', 0, [departureAddendum('signed')])
    const b = legRecord('b', 1, [arrival(1)])
    const c = legRecord('c', 2, [arrival(2)])
    const filled = legRecord('d', 1, [arrival(1, NOW, HASH)], { workday_id: W })
    expect(legsWaitingOnDeparture(a, [a, b, c])).toEqual(['b'])
    expect(legsWaitingOnDeparture(b, [a, b, c])).toEqual(['c'])
    expect(legsWaitingOnDeparture(a, [a, filled])).toEqual([])
    expect(legsWaitingOnDeparture(legRecord('n', 0, [], { workday_id: null, leg_index: null }), [a, b])).toEqual([])
  })
})

describe('fillPreviousDepartureHash (storage)', () => {
  beforeEach(() => localStorage.clear())

  function savedLeg(legIndex: number | null): { id: string; addendumId: string } {
    const r = legRecord(`r-${Math.random()}`, legIndex ?? 0)
    delete r.addenda
    saveSession(r)
    const added = appendAddendum(r.id, { kind: 'arrival_context', data: arrivalData(legIndex) })!
    return { id: r.id, addendumId: added.id }
  }

  it('fills the link on a pending arrival_context, and only that field', () => {
    const { id, addendumId } = savedLeg(1)
    const before = getSession(id)!.addenda![0]
    const filled = fillPreviousDepartureHash(id, addendumId, HASH)!
    expect((filled.data as unknown as ArrivalContextData).workday?.previous_departure_payload_sha256).toBe(HASH)
    const stored = getSession(id)!.addenda![0]
    expect(stored.data).toEqual({
      ...before.data,
      workday: { ...(before.data as unknown as ArrivalContextData).workday!, previous_departure_payload_sha256: HASH },
    })
    expect(stored).toMatchObject({ id: before.id, seq: before.seq, captured_at: before.captured_at })
    // The same hash again changes nothing; another one is refused.
    expect(fillPreviousDepartureHash(id, addendumId, HASH)).toEqual(stored)
    expect(fillPreviousDepartureHash(id, addendumId, 'cd'.repeat(32))).toBeNull()
  })

  it('never touches a signed addendum, one without a workday link, or a bad hash', () => {
    const plain = savedLeg(null)
    expect(fillPreviousDepartureHash(plain.id, plain.addendumId, HASH)).toBeNull()
    const leg = savedLeg(1)
    expect(fillPreviousDepartureHash(leg.id, leg.addendumId, 'not-hex')).toBeNull()
    expect(fillPreviousDepartureHash(leg.id, leg.addendumId, HASH.toUpperCase())).toBeNull()
    expect(fillPreviousDepartureHash(leg.id, 'missing', HASH)).toBeNull()
    expect((getSession(leg.id)!.addenda![0].data as unknown as ArrivalContextData).workday!.previous_departure_payload_sha256).toBeNull()
  })
})
