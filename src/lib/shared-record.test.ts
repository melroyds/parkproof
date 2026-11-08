// What a share shows and the copy it leaves (build spec T7 items 3, 4 and
// 6), on hand-made payloads: which check results count, what a payload
// must have, the copy's shape, and when the permit safeguard shows.
import { describe, expect, it } from 'vitest'
import type { ParkingSession, PermitContext, SignatureBundle } from '../types'
import {
  sharedCopyRecord,
  sharedFacts,
  sharedFactsOfCopy,
  shareOutcome,
  showsPermitSafeguard,
} from './shared-record'
import { shareExtrasOf } from './share-link'

const PAYLOAD = {
  schema: 'parkproof-evidence-v2',
  session_id: '11111111-2222-4333-8444-555555555555',
  arrived_at: '2026-10-25T02:31:00.000Z',
  expires_at: '2026-10-25T04:31:00.000Z',
  location: { lat: -31.9523, lng: 115.8613, address: '1 Hay St, Perth', source: 'gps', accuracy_meters: 6 },
  rules: '2P 8am-6pm',
  chosen_label: 'Left side',
  confidence: 'medium',
  no_sign: false,
  sign_photo_sha256: 'aa'.repeat(32),
  ambient_photo_sha256: null,
  car_photo_sha256: null,
  signed_at: '2026-10-25T02:31:04.000Z',
  chain_key_sha256: 'bb'.repeat(32),
}
const EXTRAS = shareExtrasOf({ driver: 'Sam', time_zone: 'Australia/Sydney', ended_at: null, rules: '2P', standard_until: null })
const SHARED_AT = '2026-10-25T03:00:00.000Z'

const permit = (type: PermitContext['type']): PermitContext => ({
  type,
  area: null,
  holder_present: type === 'accessible' ? true : null,
  sign_exception_applies: false,
  standard_until: null,
  permit_until: null,
  note: null,
})

describe('shareOutcome', () => {
  it('counts only a valid signature, and a development key only in development builds', () => {
    expect(shareOutcome({ status: 'valid' }, false)).toBe('valid')
    expect(shareOutcome({ status: 'dev_key' }, false)).toBe('changed')
    expect(shareOutcome({ status: 'dev_key' }, true)).toBe('dev_key')
    for (const status of ['invalid', 'pending', 'rejected'] as const) {
      expect(shareOutcome({ status }, true)).toBe('changed')
    }
  })
})

describe('sharedFacts', () => {
  it('takes the signed fields from the payload and the extras apart', () => {
    const facts = sharedFacts(PAYLOAD, EXTRAS, SHARED_AT)
    expect(facts).toEqual({
      original_session_id: PAYLOAD.session_id,
      arrived_at: PAYLOAD.arrived_at,
      expires_at: PAYLOAD.expires_at,
      location: { lat: -31.9523, lng: 115.8613, address: '1 Hay St, Perth', source: 'gps', accuracy_meters: 6 },
      no_sign: false,
      signed_rules: '2P 8am-6pm',
      chosen_label: 'Left side',
      confidence: 'medium',
      signed_at: PAYLOAD.signed_at,
      // From the signed coordinates (Perth), not the sender's zone (Sydney).
      time_zone: 'Australia/Perth',
      shared_at: SHARED_AT,
      extras: EXTRAS,
    })
  })

  it('refuses a payload without what a share shows', () => {
    const bad: Array<Record<string, unknown> | null> = [
      null,
      { ...PAYLOAD, session_id: undefined },
      { ...PAYLOAD, session_id: '../../etc' },
      { ...PAYLOAD, arrived_at: 'soon' },
      { ...PAYLOAD, expires_at: 'later' },
      { ...PAYLOAD, location: { lat: 'x', lng: 1 } },
      { ...PAYLOAD, location: { lat: 95, lng: 1 } },
      { ...PAYLOAD, location: [1, 2] },
    ]
    for (const p of bad) expect(sharedFacts(p, EXTRAS, SHARED_AT)).toBeNull()
  })

  it('a record without a location shows in the sender zone, else the default', () => {
    expect(sharedFacts({ ...PAYLOAD, location: null }, EXTRAS, SHARED_AT)?.time_zone).toBe('Australia/Sydney')
    expect(sharedFacts({ ...PAYLOAD, location: null }, { ...EXTRAS, time_zone: null }, SHARED_AT)?.time_zone).toBe(
      'Australia/Melbourne',
    )
  })

  it('an unknown confidence reads as low; a no-sign payload says so', () => {
    const facts = sharedFacts({ ...PAYLOAD, confidence: 'certain', no_sign: true, rules: '', expires_at: null }, EXTRAS, null)
    expect(facts).toMatchObject({ confidence: 'low', no_sign: true, signed_rules: '', expires_at: null, shared_at: null })
  })
})

describe('the read-only copy', () => {
  const bundle: SignatureBundle = {
    schema: 'parkproof-evidence-v2',
    signed_at: PAYLOAD.signed_at,
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify(PAYLOAD),
    signature_base64: 'MEU=',
  }

  it('has a new id, the sender bundle in shared_from, the extras as the snapshot, and nothing else of theirs', () => {
    const facts = sharedFacts(PAYLOAD, EXTRAS, SHARED_AT)!
    const copy = sharedCopyRecord(facts, bundle, '2026-10-25T03:05:00.000Z', 'local-1')
    expect(copy).toEqual({
      id: 'local-1',
      arrived_at: PAYLOAD.arrived_at,
      location: facts.location,
      sign_photo: null,
      car_photo: null,
      rules: '2P 8am-6pm',
      observations: [],
      expires_at: PAYLOAD.expires_at,
      confidence: 'medium',
      chosen_label: 'Left side',
      shared_from: {
        original_session_id: PAYLOAD.session_id,
        received_at: '2026-10-25T03:05:00.000Z',
        shared_at: SHARED_AT,
        arrival_bundle: bundle,
        snapshot: { ...EXTRAS },
      },
    } satisfies ParkingSession)
    expect(copy.signature).toBeUndefined()
  })

  it('reads its facts back from its bundle, and refuses a bundle that signs another record', () => {
    const copy = sharedCopyRecord(sharedFacts(PAYLOAD, EXTRAS, SHARED_AT)!, bundle, SHARED_AT, 'local-1')
    expect(sharedFactsOfCopy(copy)).toEqual(sharedFacts(PAYLOAD, EXTRAS, SHARED_AT))
    const swapped = { ...copy, shared_from: { ...copy.shared_from!, original_session_id: 'another-record' } }
    expect(sharedFactsOfCopy(swapped)).toBeNull()
    expect(sharedFactsOfCopy({ ...copy, shared_from: null })).toBeNull()
    expect(sharedFactsOfCopy({ ...copy, shared_from: { ...copy.shared_from!, arrival_bundle: { ...bundle, canonical_payload: '{' } } })).toBeNull()
  })
})

describe('the permit safeguard (item 6)', () => {
  it('shows only for a park that used an accessible parking permit', () => {
    expect(showsPermitSafeguard({ permit_context: permit('accessible') })).toBe(true)
    expect(showsPermitSafeguard({ permit_context: permit('resident') })).toBe(false)
    expect(showsPermitSafeguard({ permit_context: permit('business') })).toBe(false)
    expect(showsPermitSafeguard({ permit_context: null })).toBe(false)
    expect(showsPermitSafeguard({})).toBe(false)
  })
})
