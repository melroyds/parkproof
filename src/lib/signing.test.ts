// retryUnsignedSessions() candidate selection — pure, time-injectable logic that
// the audit flagged "high": a regression either hammers the Lambda on every
// mount (cost) or silently never retries (sessions stay unsigned = weak evidence).
//
// We drive it through a mocked storage layer + a fetch spy. signSession() (same
// module) fetches /sign-session synchronously for each selected candidate, so
// counting fetch calls tells us exactly which sessions the filter selected.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ParkingSession } from '../types'

// Controlled session list + no-op updates.
const sessions: ParkingSession[] = []
vi.mock('./storage', () => ({
  loadSessions: () => sessions,
  updateSession: vi.fn(),
}))
// Keep endpointUrl deterministic and dependency-free.
vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

import { retryUnsignedSessions } from './signing'

const RETRY_LOG_KEY = 'parkproof.signing.retry.v1'
const DAY = 24 * 60 * 60_000
const NOW = 1_700_000_000_000 // fixed instant; logic takes `now` as a param

// A minimal unsigned, photo-less session (no photos → no crypto.subtle hashing).
function unsigned(id: string, ageMs: number): ParkingSession {
  return {
    id,
    arrived_at: new Date(NOW - ageMs).toISOString(),
    rules: '2P',
    confidence: 'high',
    can_park_now: true,
    observations: [],
  } as unknown as ParkingSession
}

let fetchSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  sessions.length = 0
  localStorage.clear()
  fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ signature_base64: 'sig' }) }))
  vi.stubGlobal('fetch', fetchSpy)
})

// The set of session ids that triggered a /sign-session POST = the candidates.
function attemptedIds(): string[] {
  return fetchSpy.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).session_id)
}

describe('retryUnsignedSessions candidate selection', () => {
  it('attempts a fresh unsigned session', () => {
    sessions.push(unsigned('a', 1 * DAY))
    retryUnsignedSessions(NOW)
    expect(attemptedIds()).toEqual(['a'])
  })

  it('skips an already-signed session', () => {
    const s = unsigned('a', 1 * DAY)
    ;(s as unknown as { signature: unknown }).signature = { signature_base64: 'x' }
    sessions.push(s)
    retryUnsignedSessions(NOW)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips a session past the 30-day horizon', () => {
    sessions.push(unsigned('old', 31 * DAY), unsigned('fresh', 2 * DAY))
    retryUnsignedSessions(NOW)
    expect(attemptedIds()).toEqual(['fresh'])
  })

  it('skips a session with an unparseable arrived_at (NaN age guard)', () => {
    const s = unsigned('bad', 1 * DAY)
    ;(s as unknown as { arrived_at: string }).arrived_at = 'not-a-date'
    sessions.push(s)
    retryUnsignedSessions(NOW)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips a session that has hit the 3-attempt cap', () => {
    sessions.push(unsigned('capped', 1 * DAY))
    localStorage.setItem(
      RETRY_LOG_KEY,
      JSON.stringify({ capped: { attempts: 3, lastAttempt: NOW - 10 * 60_000 } }),
    )
    retryUnsignedSessions(NOW)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips a session attempted within the 5-min throttle window', () => {
    sessions.push(unsigned('recent', 1 * DAY))
    localStorage.setItem(
      RETRY_LOG_KEY,
      JSON.stringify({ recent: { attempts: 1, lastAttempt: NOW - 2 * 60_000 } }),
    )
    retryUnsignedSessions(NOW)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('retries again once the throttle window has elapsed (and under the cap)', () => {
    sessions.push(unsigned('again', 1 * DAY))
    localStorage.setItem(
      RETRY_LOG_KEY,
      JSON.stringify({ again: { attempts: 1, lastAttempt: NOW - 6 * 60_000 } }),
    )
    retryUnsignedSessions(NOW)
    expect(attemptedIds()).toEqual(['again'])
  })

  it('records the attempt in the retry log (so the throttle/cap can apply next time)', () => {
    sessions.push(unsigned('a', 1 * DAY))
    retryUnsignedSessions(NOW)
    const log = JSON.parse(localStorage.getItem(RETRY_LOG_KEY) || '{}')
    expect(log.a.attempts).toBe(1)
    expect(log.a.lastAttempt).toBe(NOW)
  })
})
