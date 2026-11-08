// @vitest-environment happy-dom
//
// A re-check answer carries is_refresh so the feedback telemetry can tell
// it from a fresh photo read (spec T9 item 5). A fresh read carries no mark.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingRules } from '../types'

const ANSWER: ParkingRules = {
  rules: '2P',
  observations: [],
  can_park_now: true,
  until: null,
  duration_minutes: null,
  confidence: 'high',
  clarification: null,
}
const { postJsonAndPoll } = vi.hoisted(() => ({ postJsonAndPoll: vi.fn() }))
vi.mock('./api', () => ({ postJsonAndPoll, endpointUrl: (p: string) => `/api${p}` }))

import { refreshInterpretation, translateSign } from './claude'

beforeEach(() => {
  postJsonAndPoll.mockReset()
  postJsonAndPoll.mockImplementation(async () => ({ ...ANSWER }))
})

describe('is_refresh on the answer', () => {
  it('a re-check answer is marked, and the request is the text-only refresh', async () => {
    const result = await refreshInterpretation({ rules: '2P', observations: [] }, { lat: -37.8, lng: 144.9 })
    expect(result.is_refresh).toBe(true)
    expect(result.rules).toBe('2P')
    const [path, body] = postJsonAndPoll.mock.calls[0] as [string, Record<string, unknown>]
    expect(path).toBe('/sign-translate')
    expect(body).toMatchObject({ prior_rules: '2P' })
    expect(body).not.toHaveProperty('image_base64')
  })

  it('a fresh photo read is not marked', async () => {
    const result = await translateSign('AAAA', 'image/jpeg', null)
    expect(result.is_refresh).toBeUndefined()
  })
})
