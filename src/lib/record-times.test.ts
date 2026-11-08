// @vitest-environment happy-dom
//
// The times a record carries into the PDFs and the appeal draft (spec T1b,
// N5): phone times and ParkProof's signing times kept apart, signed values
// read from the signed payload, every time formatted in the record's own
// zone with the zone name (both sides of a DST change, and zones without
// DST), and this device's signing state read without throwing.
import { afterEach, describe, expect, it } from 'vitest'
import type { ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import { DEV_KEY_ALIAS } from './evidence-chain'
import { appealEvidence, deviceRecordContext, evidenceTime, recordTimes } from './record-times'
import { markEndedOnThisDevice } from './signing'

const MELBOURNE = { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps' as const, accuracy_meters: 8 }
const BRISBANE = { lat: -27.4698, lng: 153.0251, source: 'gps' as const, accuracy_meters: 9 }
const PERTH = { lat: -31.9523, lng: 115.8613, source: 'manual' as const }

function bundle(payload: Record<string, unknown>, overrides: Partial<SignatureBundle> = {}): SignatureBundle {
  return {
    schema: String(payload.schema ?? 'parkproof-evidence-v2'),
    signed_at: String(payload.signed_at ?? '2026-10-25T00:00:04.000Z'),
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify(payload),
    signature_base64: 'MEUCIQ',
    ...overrides,
  }
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-times',
    arrived_at: '2026-10-24T23:55:00.000Z',
    location: MELBOURNE,
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: '2026-10-25T01:55:00.000Z',
    confidence: 'high',
    ...overrides,
  }
}

const LINK0 = bundle({
  schema: 'parkproof-evidence-v2',
  session_id: 'rec-times',
  arrived_at: '2026-10-24T23:55:00.000Z',
  expires_at: '2026-10-25T01:55:00.000Z',
  signed_at: '2026-10-24T23:55:04.000Z',
})

function departure(state: 'signed' | 'pending' | 'rejected', data: Record<string, unknown> = {}): SignedAddendum {
  const d = {
    ended_at: '2026-10-25T02:55:00.000Z',
    location: { lat: -37.8118, lng: 144.9631, accuracy_meters: 11, source: 'gps' },
    distance_from_arrival_m: 200,
    return_photos: [],
    ...data,
  }
  const a: SignedAddendum = { id: 'dep-1', seq: 2, kind: 'departure', captured_at: '2026-10-25T02:55:00.000Z', data: d }
  if (state === 'signed') {
    a.bundle = bundle(
      { schema: 'parkproof-addendum-v1', addendum_id: 'dep-1', kind: 'departure', seq: 2, signed_at: '2026-10-25T02:56:10.000Z', data: d },
      { schema: 'parkproof-addendum-v1' },
    )
  }
  if (state === 'rejected') a.rejected = { code: 'ERR_BAD_STRING', at: '2026-10-25T02:56:00.000Z' }
  return a
}

afterEach(() => {
  localStorage.clear()
})

describe('evidenceTime (N5)', () => {
  it('gives the year and the zone name, either side of the October DST change', () => {
    // Melbourne moved to AEDT on Sun 4 Oct 2026.
    expect(evidenceTime('2026-10-03T15:30:00.000Z', 'Australia/Melbourne')).toBe('Sun 4 Oct 2026, 1:30 am AEST')
    expect(evidenceTime('2026-10-04T15:30:00.000Z', 'Australia/Melbourne')).toBe('Mon 5 Oct 2026, 2:30 am AEDT')
  })

  it('and either side of the April change back', () => {
    expect(evidenceTime('2027-04-03T14:00:00.000Z', 'Australia/Melbourne')).toBe('Sun 4 Apr 2027, 1:00 am AEDT')
    expect(evidenceTime('2027-04-03T16:30:00.000Z', 'Australia/Melbourne')).toBe('Sun 4 Apr 2027, 2:30 am AEST')
  })

  it('zones without DST keep one name all year', () => {
    expect(evidenceTime('2026-10-25T02:55:00.000Z', 'Australia/Brisbane')).toBe('Sun 25 Oct 2026, 12:55 pm AEST')
    expect(evidenceTime('2026-10-25T02:55:00.000Z', 'Australia/Perth')).toBe('Sun 25 Oct 2026, 10:55 am AWST')
  })
})

describe('recordTimes', () => {
  it('an unsigned record: the stored phone times, arrival not signed yet, no departure', () => {
    const times = recordTimes(record())
    expect(times).toEqual({
      time_zone: 'Australia/Melbourne',
      arrived_at: '2026-10-24T23:55:00.000Z',
      expires_at: '2026-10-25T01:55:00.000Z',
      arrival_signing: { state: 'pending' },
      departure: null,
    })
  })

  it('a refused link 0 is "rejected", but never on a shared copy', () => {
    expect(recordTimes(record(), { arrivalRejection: 'ERR_BAD_TIME' }).arrival_signing).toEqual({ state: 'rejected' })
    const shared = record({
      shared_from: { original_session_id: 'x', received_at: '2026-10-25T03:00:00.000Z', shared_at: null, arrival_bundle: null, snapshot: {} },
    })
    expect(recordTimes(shared, { arrivalRejection: 'ERR_BAD_TIME' }).arrival_signing).toEqual({ state: 'pending' })
  })

  it('a signed record: the signed arrival, expiry and signing time win over the stored copy', () => {
    const times = recordTimes(record({ signature: LINK0, arrived_at: '2026-10-24T20:00:00.000Z', expires_at: null }))
    expect(times.arrived_at).toBe('2026-10-24T23:55:00.000Z')
    expect(times.expires_at).toBe('2026-10-25T01:55:00.000Z')
    expect(times.arrival_signing).toEqual({ state: 'signed', signed_at: '2026-10-24T23:55:04.000Z' })
  })

  it('a signed no-expiry record keeps the signed null expiry', () => {
    const signed = bundle({ schema: 'parkproof-evidence-v1', arrived_at: '2026-10-24T23:55:00.000Z', expires_at: null, signed_at: '2026-10-24T23:55:04.000Z' })
    expect(recordTimes(record({ signature: signed, expires_at: '2026-10-25T09:00:00.000Z' })).expires_at).toBeNull()
  })

  it('a development key is never "signed"', () => {
    const times = recordTimes(record({ signature: { ...LINK0, key_alias: DEV_KEY_ALIAS } }))
    expect(times.arrival_signing).toEqual({ state: 'dev_key', signed_at: '2026-10-24T23:55:04.000Z' })
  })

  it('a shared copy reads the sender bundle', () => {
    const shared = record({
      shared_from: { original_session_id: 'x', received_at: '2026-10-25T03:00:00.000Z', shared_at: null, arrival_bundle: LINK0, snapshot: {} },
    })
    expect(recordTimes(shared).arrival_signing).toEqual({ state: 'signed', signed_at: '2026-10-24T23:55:04.000Z' })
  })

  it('the zone comes from where the record was logged', () => {
    expect(recordTimes(record({ location: BRISBANE })).time_zone).toBe('Australia/Brisbane')
    expect(recordTimes(record({ location: PERTH })).time_zone).toBe('Australia/Perth')
    expect(recordTimes(record({ location: null })).time_zone).toBe('Australia/Melbourne')
  })

  it('an ended record carries its departure summary, with this device\'s state passed through', () => {
    const ended = record({ signature: LINK0, ended_at: '2026-10-25T02:55:00.000Z' })
    const afterGrace = Date.parse('2026-10-25T02:56:00.000Z')
    // A v2 chain whose key isn't here: no departure part will ever come.
    expect(recordTimes(ended, { now: afterGrace, endedHere: true }).departure!.signing).toEqual({ state: 'none' })
    const withPart = recordTimes({ ...ended, addenda: [departure('signed')] })
    expect(withPart.departure).toMatchObject({
      tapped_at: '2026-10-25T02:55:00.000Z',
      signing: { state: 'signed', signed_at: '2026-10-25T02:56:10.000Z' },
      location: { lat: -37.8118, lng: 144.9631, accuracy_meters: 11 },
      distance_from_arrival_m: 200,
    })
  })
})

describe('appealEvidence (the separately labelled appeal lines)', () => {
  it('formats every time in the record zone with its name, and keeps phone and signing times apart', () => {
    const s = record({ signature: LINK0, ended_at: '2026-10-25T02:55:00.000Z', addenda: [departure('signed')] })
    expect(appealEvidence(s)).toEqual({
      time_zone: 'Australia/Melbourne',
      arrival_phone: 'Sun 25 Oct 2026, 10:55 am AEDT',
      arrival_signed: 'Sun 25 Oct 2026, 10:55 am AEDT',
      arrival_signing: 'signed',
      expires: 'Sun 25 Oct 2026, 12:55 pm AEDT',
      departure_tapped: 'Sun 25 Oct 2026, 1:55 pm AEDT',
      departure_signed: 'Sun 25 Oct 2026, 1:56 pm AEDT',
      departure_signing: 'signed',
      location_source: 'gps',
    })
  })

  it('a record still open: no departure fields; an unsigned one: no signing time', () => {
    const e = appealEvidence(record())
    expect(e.arrival_signed).toBeNull()
    expect(e.arrival_signing).toBe('pending')
    expect(e.departure_tapped).toBeNull()
    expect(e.departure_signed).toBeNull()
    expect(e.departure_signing).toBeNull()
  })

  it('a pending or refused departure has its tap time but no signing time', () => {
    const base = record({ signature: LINK0, ended_at: '2026-10-25T02:55:00.000Z' })
    const pending = appealEvidence({ ...base, addenda: [departure('pending')] })
    expect(pending).toMatchObject({ departure_tapped: 'Sun 25 Oct 2026, 1:55 pm AEDT', departure_signed: null, departure_signing: 'pending' })
    const refused = appealEvidence({ ...base, addenda: [departure('rejected')] })
    expect(refused).toMatchObject({ departure_signed: null, departure_signing: 'rejected' })
  })

  it('a winter record is in AEST', () => {
    const e = appealEvidence(record({ arrived_at: '2026-07-01T02:00:00.000Z', expires_at: null }))
    // en-AU's short month for July is "July".
    expect(e.arrival_phone).toBe('Wed 1 July 2026, 12:00 pm AEST')
    expect(e.expires).toBeNull()
  })

  it('location_source is gps only for a phone GPS fix', () => {
    expect(appealEvidence(record({ location: PERTH })).location_source).toBe('manual')
    expect(appealEvidence(record({ location: { lat: -37.8, lng: 144.9 } })).location_source).toBeNull()
    expect(appealEvidence(record({ location: null })).location_source).toBeNull()
  })

  it('a development-key departure keeps its time, marked dev_key', () => {
    const dev = departure('signed')
    dev.bundle = { ...dev.bundle!, key_alias: DEV_KEY_ALIAS }
    const e = appealEvidence(record({ signature: LINK0, ended_at: '2026-10-25T02:55:00.000Z', addenda: [dev] }))
    expect(e).toMatchObject({ departure_signing: 'dev_key', departure_signed: 'Sun 25 Oct 2026, 1:56 pm AEDT' })
  })
})

describe('deviceRecordContext', () => {
  it("reads this device's ended-here mark and link-0 refusal", () => {
    expect(deviceRecordContext('rec-a', 5)).toEqual({ now: 5, endedHere: false, arrivalRejection: null })
    markEndedOnThisDevice('rec-a')
    localStorage.setItem(
      'parkproof.signing.state.v2',
      JSON.stringify({
        ...JSON.parse(localStorage.getItem('parkproof.signing.state.v2')!),
        'rec-b': { link0_rejected: { code: 'ERR_BAD_TIME', at: '2026-10-25T00:00:00.000Z' } },
      }),
    )
    expect(deviceRecordContext('rec-a', 5)).toEqual({ now: 5, endedHere: true, arrivalRejection: null })
    expect(deviceRecordContext('rec-b', 5)).toEqual({ now: 5, endedHere: false, arrivalRejection: 'ERR_BAD_TIME' })
  })

  it('never throws on unreadable state', () => {
    localStorage.setItem('parkproof.signing.state.v2', '{not json')
    expect(deviceRecordContext('rec-a', 5)).toEqual({ now: 5, endedHere: false, arrivalRejection: null })
  })
})
