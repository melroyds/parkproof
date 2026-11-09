// @vitest-environment happy-dom
//
// The sign reader's requests from the phone (build spec T3 items 3 and 5):
// a re-check echoes what the first reading saw (prior_sign_status,
// prior_sign_issues, prior_is_area_sign) only when the record has them, so
// records saved before T3 send the same body as before; the optional
// user_permits and parking_state (T4 fills them) go out only when given, in
// the exact shape the server accepts. The appeal drafter gets the record's
// sign condition and no-sign state.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession } from '../types'
import { validateTranslateExtras } from '../../lambda/sign-reading.js'

const { postJsonAndPoll } = vi.hoisted(() => ({ postJsonAndPoll: vi.fn(async () => ({})) }))
vi.mock('./api', () => ({ postJsonAndPoll, endpointUrl: (p: string) => `/api${p}` }))

import { appealSessionBody, refreshInterpretation, translateSign } from './claude'
import { refreshPriorOf } from './sign-result'

const lastBody = () => (postJsonAndPoll.mock.calls.at(-1) as unknown as [string, Record<string, unknown>])[1]

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-claude',
    arrived_at: '2026-11-02T22:00:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '1P AREA',
    observations: [{ scope: 'Whole sign', items: ['1P AREA'] }],
    expires_at: '2026-11-02T23:00:00.000Z',
    confidence: 'high',
    ...overrides,
  }
}

beforeEach(() => {
  postJsonAndPoll.mockClear()
  localStorage.clear()
})

describe('refreshInterpretation', () => {
  it("echoes the record's sign condition and area flag", async () => {
    const saved = record({
      sign_status: 'partially_obscured',
      sign_issues: ['Bottom plate faded'],
      rule_flags: {
        requires_ticket: false,
        payment_methods: null,
        requires_disabled_permit: false,
        is_permit_zone: false,
        permit_area: null,
        is_area_sign: true,
      },
    })
    await refreshInterpretation(refreshPriorOf(saved), saved.location)
    expect((postJsonAndPoll.mock.calls[0] as unknown as [string])[0]).toBe('/sign-translate')
    expect(lastBody()).toMatchObject({
      prior_rules: '1P AREA',
      prior_sign_status: 'partially_obscured',
      prior_sign_issues: ['Bottom plate faded'],
      prior_is_area_sign: true,
      lat: -37.8136,
      lng: 144.9631,
    })
  })

  it('a record saved before T3 sends the same body as before (no T3 echoes, no permits)', async () => {
    const old = record()
    await refreshInterpretation(refreshPriorOf(old), old.location)
    expect(Object.keys(lastBody()).sort()).toEqual(['lat', 'lng', 'prior_observations', 'prior_rules'])
  })
})

describe('the permit and state inputs (seam for T4)', () => {
  it('are sent only when given, in the shape the server accepts', async () => {
    await translateSign('AAAA', 'image/jpeg', null)
    expect(lastBody()).not.toHaveProperty('user_permits')
    expect(lastBody()).not.toHaveProperty('parking_state')

    await translateSign('AAAA', 'image/jpeg', null, {
      user_permits: [{ type: 'resident', area: '25' }, { type: 'accessible', area: null }],
      parking_state: 'VIC',
    })
    const body = lastBody()
    expect(body.user_permits).toEqual([{ type: 'resident', area: '25' }, { type: 'accessible' }])
    expect(body.parking_state).toBe('VIC')
    // The server's own check passes it unchanged.
    expect(validateTranslateExtras(body)).toEqual({
      user_permits: [
        { type: 'resident', area: '25' },
        { type: 'accessible', area: null },
      ],
      parking_state: 'VIC',
    })

    await refreshInterpretation(refreshPriorOf(record()), null, { user_permits: [{ type: 'business' }] })
    expect(lastBody().user_permits).toEqual([{ type: 'business' }])
  })
})

describe('appealSessionBody (T3: evidenceText)', () => {
  it("carries the record's sign condition and notes", () => {
    const body = appealSessionBody(record({ sign_status: 'contradictory', sign_issues: ['Plates disagree'] }))
    expect(body).toMatchObject({ no_sign: false, sign_status: 'contradictory', sign_issues: ['Plates disagree'] })
  })

  it('a no-sign record logged from the "no readable sign" screen says so', () => {
    const body = appealSessionBody(record({ no_sign: true, rules: '', sign_status: 'missing', sign_issues: ['No sign in view'] }))
    expect(body).toMatchObject({ no_sign: true, sign_status: 'missing', sign_issues: ['No sign in view'] })
  })

  it('an old record sends null and []', () => {
    expect(appealSessionBody(record())).toMatchObject({ no_sign: false, sign_status: null, sign_issues: [] })
  })
})
