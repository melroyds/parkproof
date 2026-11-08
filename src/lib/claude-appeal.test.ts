// @vitest-environment happy-dom
//
// draftAppeal (spec T1b item 6) sends the record's times as separately
// labelled, pre-formatted values: phone clock for the logged time and the
// I've left tap, server clock for ParkProof's signing time of each part, in
// the record's zone with its name, plus location_source. The standalone
// appeal (no record) still sends session null.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession, SignatureBundle } from '../types'

const { postJsonAndPoll } = vi.hoisted(() => ({ postJsonAndPoll: vi.fn(async () => ({})) }))
vi.mock('./api', () => ({ postJsonAndPoll, endpointUrl: (p: string) => `/api${p}` }))

import { appealSessionBody, draftAppeal } from './claude'

const LINK0: SignatureBundle = {
  schema: 'parkproof-evidence-v1',
  signed_at: '2026-10-24T23:55:04.000Z',
  algorithm: 'ECDSA_SHA_256',
  key_alias: 'alias/parkproof-evidence-signing',
  canonical_payload: JSON.stringify({ schema: 'parkproof-evidence-v1', arrived_at: '2026-10-24T23:55:00.000Z', signed_at: '2026-10-24T23:55:04.000Z' }),
  signature_base64: 'MEUCIQ',
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-appeal',
    arrived_at: '2026-10-24T23:55:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'manual' },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: '2026-10-25T01:55:00.000Z',
    confidence: 'high',
    ...overrides,
  }
}

beforeEach(() => {
  postJsonAndPoll.mockClear()
  localStorage.clear()
})

describe('draftAppeal', () => {
  it('sends the labelled, zoned times and location_source with the record', async () => {
    await draftAppeal('AAAA', 'image/jpeg', record({ signature: LINK0, ended_at: '2026-10-25T01:30:00.000Z' }))
    const [path, body] = postJsonAndPoll.mock.calls[0] as unknown as [string, { session: ReturnType<typeof appealSessionBody> }]
    expect(path).toBe('/draft-appeal')
    expect(body.session.evidence).toMatchObject({
      time_zone: 'Australia/Melbourne',
      arrival_phone: 'Sun 25 Oct 2026, 10:55 am AEDT',
      arrival_signed: 'Sun 25 Oct 2026, 10:55 am AEDT',
      arrival_signing: 'signed',
      departure_tapped: 'Sun 25 Oct 2026, 12:30 pm AEDT',
      departure_signed: null,
      location_source: 'manual',
    })
    expect(body.session.rules).toBe('2P')
  })

  it('a departure ended on this device is "pending" until signed; on an old record never ended here, "none"', () => {
    const ended = record({ signature: LINK0, ended_at: '2026-10-25T01:30:00.000Z' })
    const later = Date.parse('2026-10-25T02:00:00.000Z')
    expect(appealSessionBody(ended, later).evidence.departure_signing).toBe('none')
    localStorage.setItem('parkproof.signing.state.v2', JSON.stringify({ 'rec-appeal': { ended_here: true } }))
    expect(appealSessionBody(ended, later).evidence.departure_signing).toBe('pending')
  })

  it('the standalone appeal sends no record', async () => {
    await draftAppeal('AAAA', 'image/jpeg', null)
    expect((postJsonAndPoll.mock.calls[0] as unknown as [string, { session: unknown }])[1].session).toBeNull()
  })
})
