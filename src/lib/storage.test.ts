// @vitest-environment happy-dom
//
// storage — localStorage CRUD + 3-phase quota recovery + endSession +
// loadActiveSessions.
//
// The 3-phase recovery is the most important code in this file to test:
// it's the kind of logic that only fires on a full localStorage, only
// matters when the user is mid-flow, and produces no error in unit-less
// dev environments. A regression here = "I logged my park but it didn't
// save and I didn't know" — the worst-case ParkProof failure mode.

import { beforeEach, describe, it, expect } from 'vitest'
import {
  loadSessions,
  saveSession,
  deleteSession,
  updateSession,
  endSession,
  loadActiveSessions,
  getSession,
} from './storage'
import type { ParkingSession } from '../types'

const KEY = 'parkproof.sessions.v1'
const FIXED_NOW = new Date('2026-05-21T10:00:00+10:00').getTime()

/**
 * Session factory — only the fields the storage layer ever inspects.
 * Other tests should NOT depend on this shape; we deliberately don't
 * export it.
 */
function makeSession(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: overrides.id ?? `session-${Math.random().toString(36).slice(2, 10)}`,
    arrived_at: overrides.arrived_at ?? '2026-05-21T08:00:00+10:00',
    location: overrides.location ?? { lat: -37.8136, lng: 144.9631 },
    sign_photo: overrides.sign_photo ?? 'data:image/jpeg;base64,SIGN',
    car_photo: overrides.car_photo ?? 'data:image/jpeg;base64,CAR',
    rules: overrides.rules ?? '2P Mon-Fri 8am-6pm',
    observations: overrides.observations ?? [{ scope: 'Whole sign', items: ['2P'] }],
    expires_at: overrides.expires_at ?? null,
    confidence: overrides.confidence ?? 'high',
    ...overrides,
  }
}

/**
 * Quota-error simulator. happy-dom wraps `localStorage` in a Proxy that
 * blocks both vi.spyOn restoration AND direct property reassignment on
 * the instance. Working around the proxy isn't worth it — we just swap
 * in our own Storage-shaped object on `globalThis` for the duration of
 * this test file. storage.ts reads `localStorage` from the global scope,
 * so it picks up our replacement transparently.
 *
 * Module-level counter controls when the simulator throws; beforeEach
 * resets it so each test starts with a working setItem.
 */
let _quotaThrowsRemaining = 0
const _backing = new Map<string, string>()

const fakeLocalStorage: Storage = {
  get length() {
    return _backing.size
  },
  clear() {
    _backing.clear()
  },
  getItem(key: string) {
    return _backing.has(key) ? _backing.get(key)! : null
  },
  key(index: number) {
    return Array.from(_backing.keys())[index] ?? null
  },
  removeItem(key: string) {
    _backing.delete(key)
  },
  setItem(key: string, value: string) {
    if (_quotaThrowsRemaining > 0) {
      _quotaThrowsRemaining--
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    }
    _backing.set(key, String(value))
  },
}

// Globally swap the happy-dom-provided localStorage for our fake. storage.ts
// captures the global at call time, so this re-binding takes effect for every
// subsequent import/call site.
Object.defineProperty(globalThis, 'localStorage', {
  value: fakeLocalStorage,
  writable: false,
  configurable: true,
})

function quotaThrowsNTimes(n: number) {
  _quotaThrowsRemaining = n
}

beforeEach(() => {
  _quotaThrowsRemaining = 0
  fakeLocalStorage.clear()
})

describe('loadSessions / saveSession / deleteSession', () => {
  it('returns [] when the storage key has never been set', () => {
    expect(loadSessions()).toEqual([])
  })

  it('returns [] on JSON parse failure (corrupt localStorage)', () => {
    localStorage.setItem(KEY, '{{not json{{')
    expect(loadSessions()).toEqual([])
  })

  it('saveSession unshifts (newest first)', () => {
    const older = makeSession({ id: 'older', arrived_at: '2026-05-21T08:00:00+10:00' })
    const newer = makeSession({ id: 'newer', arrived_at: '2026-05-21T09:00:00+10:00' })
    saveSession(older)
    saveSession(newer)
    const all = loadSessions()
    expect(all[0].id).toBe('newer')
    expect(all[1].id).toBe('older')
  })

  it('deleteSession removes by id and persists immediately', () => {
    saveSession(makeSession({ id: 'a' }))
    saveSession(makeSession({ id: 'b' }))
    deleteSession('a')
    const after = loadSessions()
    expect(after.map((s) => s.id)).toEqual(['b'])
    // Also confirm persistence — a fresh load returns the same shape.
    expect(loadSessions().map((s) => s.id)).toEqual(['b'])
  })

  it('deleteSession on a non-existent id is a no-op (no throw)', () => {
    saveSession(makeSession({ id: 'a' }))
    expect(() => deleteSession('does-not-exist')).not.toThrow()
    expect(loadSessions().map((s) => s.id)).toEqual(['a'])
  })
})

describe('updateSession (partial patch)', () => {
  it('updates only the supplied fields, preserves the rest', () => {
    saveSession(makeSession({ id: 'a', rules: 'original rules' }))
    updateSession('a', { rules: 'edited rules' })
    const s = getSession('a')
    expect(s?.rules).toBe('edited rules')
    expect(s?.id).toBe('a')
    expect(s?.location).not.toBeNull()
    expect(s?.sign_photo).toBe('data:image/jpeg;base64,SIGN')
  })

  it('no-op when id is not found — returns a zero-cost report', () => {
    const report = updateSession('does-not-exist', { rules: 'x' })
    expect(report).toEqual({ trimmedPhotosFrom: 0, evicted: 0 })
  })

  it('survives the patch going through quota recovery (rare)', () => {
    // Setup: one expired session with photos that can be stripped, and
    // an active session being patched.
    const expired = makeSession({
      id: 'expired',
      arrived_at: '2026-05-20T08:00:00+10:00',
      expires_at: '2026-05-20T18:00:00+10:00', // in the past relative to FIXED_NOW
    })
    const active = makeSession({
      id: 'active',
      arrived_at: '2026-05-21T08:00:00+10:00',
      expires_at: '2026-05-21T18:00:00+10:00',
    })
    // Pre-seed both directly (bypassing quota recovery on the initial write).
    localStorage.setItem(KEY, JSON.stringify([active, expired]))

    quotaThrowsNTimes(1) // first write fails, Phase 1 strip succeeds
    const report = updateSession('active', { rules: 'edited under quota pressure' })
    expect(report.trimmedPhotosFrom).toBeGreaterThanOrEqual(1)
    // The patched field survived.
    expect(getSession('active')?.rules).toBe('edited under quota pressure')
  })
})

describe('endSession helper', () => {
  it('sets ended_at to an ISO timestamp', () => {
    saveSession(makeSession({ id: 'a' }))
    endSession('a')
    const s = getSession('a')
    expect(s?.ended_at).toBeTruthy()
    // ISO 8601 with timezone offset
    expect(s?.ended_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/)
  })

  it('uses the supplied `when` Date when provided, falls back to new Date() otherwise', () => {
    saveSession(makeSession({ id: 'a' }))
    const when = new Date('2026-05-21T15:30:00+10:00')
    endSession('a', when)
    expect(getSession('a')?.ended_at).toBe(when.toISOString())
  })

  it('does not mutate any other field', () => {
    const original = makeSession({
      id: 'a',
      rules: 'preserve me',
      sign_photo: 'data:image/jpeg;base64,KEEP',
    })
    saveSession(original)
    endSession('a', new Date('2026-05-21T15:30:00+10:00'))
    const after = getSession('a')!
    expect(after.rules).toBe('preserve me')
    expect(after.sign_photo).toBe('data:image/jpeg;base64,KEEP')
    expect(after.id).toBe('a')
    expect(after.location).toEqual(original.location)
  })
})

describe('loadActiveSessions', () => {
  it('excludes any session with ended_at set', () => {
    const ended = makeSession({
      id: 'ended',
      expires_at: '2026-05-21T18:00:00+10:00',
      ended_at: '2026-05-21T11:00:00+10:00',
    })
    const live = makeSession({ id: 'live', expires_at: '2026-05-21T18:00:00+10:00' })
    localStorage.setItem(KEY, JSON.stringify([ended, live]))
    const active = loadActiveSessions(FIXED_NOW)
    expect(active.map((s) => s.id)).toEqual(['live'])
  })

  it('includes future-expiry sessions sorted soonest-first', () => {
    const later = makeSession({ id: 'later', expires_at: '2026-05-21T20:00:00+10:00' })
    const sooner = makeSession({ id: 'sooner', expires_at: '2026-05-21T11:30:00+10:00' })
    localStorage.setItem(KEY, JSON.stringify([later, sooner]))
    expect(loadActiveSessions(FIXED_NOW).map((s) => s.id)).toEqual(['sooner', 'later'])
  })

  it('includes no_sign sessions without ended_at, after expiry-bearing ones', () => {
    const noSign = makeSession({
      id: 'noSign',
      expires_at: null,
      no_sign: true,
    })
    const expiring = makeSession({ id: 'expiring', expires_at: '2026-05-21T18:00:00+10:00' })
    localStorage.setItem(KEY, JSON.stringify([noSign, expiring]))
    expect(loadActiveSessions(FIXED_NOW).map((s) => s.id)).toEqual(['expiring', 'noSign'])
  })

  it('excludes past-expiry sessions (auto-fall-off)', () => {
    const past = makeSession({ id: 'past', expires_at: '2026-05-21T08:00:00+10:00' })
    const live = makeSession({ id: 'live', expires_at: '2026-05-21T18:00:00+10:00' })
    localStorage.setItem(KEY, JSON.stringify([past, live]))
    expect(loadActiveSessions(FIXED_NOW).map((s) => s.id)).toEqual(['live'])
  })

  it('open-ended sessions sorted by arrived_at descending (most recent first)', () => {
    const older = makeSession({
      id: 'older',
      expires_at: null,
      no_sign: true,
      arrived_at: '2026-05-21T08:00:00+10:00',
    })
    const newer = makeSession({
      id: 'newer',
      expires_at: null,
      no_sign: true,
      arrived_at: '2026-05-21T09:30:00+10:00',
    })
    localStorage.setItem(KEY, JSON.stringify([older, newer]))
    expect(loadActiveSessions(FIXED_NOW).map((s) => s.id)).toEqual(['newer', 'older'])
  })

  it('handles a mix correctly — expiry-bearing first by urgency, then no-sign by recency', () => {
    const past = makeSession({ id: 'past', expires_at: '2026-05-21T08:00:00+10:00' })
    const noSignOld = makeSession({
      id: 'noSignOld',
      expires_at: null,
      no_sign: true,
      arrived_at: '2026-05-21T07:00:00+10:00',
    })
    const noSignNew = makeSession({
      id: 'noSignNew',
      expires_at: null,
      no_sign: true,
      arrived_at: '2026-05-21T09:00:00+10:00',
    })
    const expiringLater = makeSession({
      id: 'expiringLater',
      expires_at: '2026-05-21T20:00:00+10:00',
    })
    const expiringSooner = makeSession({
      id: 'expiringSooner',
      expires_at: '2026-05-21T11:30:00+10:00',
    })
    localStorage.setItem(
      KEY,
      JSON.stringify([past, noSignOld, noSignNew, expiringLater, expiringSooner]),
    )
    expect(loadActiveSessions(FIXED_NOW).map((s) => s.id)).toEqual([
      'expiringSooner',
      'expiringLater',
      'noSignNew',
      'noSignOld',
    ])
  })
})

describe('persistWithQuotaRecovery — 3-phase eviction', () => {
  it('Phase 0: clean write — no recovery needed when under quota', () => {
    const report = saveSession(makeSession({ id: 'a' }))
    expect(report).toEqual({ trimmedPhotosFrom: 0, evicted: 0 })
    expect(loadSessions().length).toBe(1)
  })

  it('Phase 1: strips car_photo from oldest expired session(s), in oldest-first order', () => {
    const olderExpired = makeSession({
      id: 'olderExpired',
      arrived_at: '2026-05-19T08:00:00+10:00',
      expires_at: '2026-05-19T18:00:00+10:00',
    })
    const newerExpired = makeSession({
      id: 'newerExpired',
      arrived_at: '2026-05-20T08:00:00+10:00',
      expires_at: '2026-05-20T18:00:00+10:00',
    })
    localStorage.setItem(KEY, JSON.stringify([newerExpired, olderExpired]))

    quotaThrowsNTimes(1) // initial write fails, first Phase 1 strip succeeds
    const report = saveSession(makeSession({ id: 'fresh' }))

    expect(report.trimmedPhotosFrom).toBe(1)
    expect(report.evicted).toBe(0)
    // Older expired should have lost its car_photo first.
    const after = loadSessions()
    const older = after.find((s) => s.id === 'olderExpired')
    const newer = after.find((s) => s.id === 'newerExpired')
    expect(older?.car_photo).toBeNull()
    expect(newer?.car_photo).not.toBeNull() // still intact — wasn't reached
  })

  it('Phase 2: strips sign_photo (after car_photo exhausted) — session keeps metadata', () => {
    // One expired session — only one car_photo to strip, so Phase 2 has to kick in.
    const expired = makeSession({
      id: 'expired',
      arrived_at: '2026-05-19T08:00:00+10:00',
      expires_at: '2026-05-19T18:00:00+10:00',
    })
    localStorage.setItem(KEY, JSON.stringify([expired]))

    quotaThrowsNTimes(2) // initial + Phase 1 strip both fail, Phase 2 strip succeeds
    saveSession(makeSession({ id: 'fresh' }))

    const after = loadSessions()
    const e = after.find((s) => s.id === 'expired')
    expect(e?.car_photo).toBeNull()
    expect(e?.sign_photo).toBe('') // stripped — kept as empty string per impl
    // Metadata preserved
    expect(e?.rules).toBe('2P Mon-Fri 8am-6pm')
    expect(e?.location).not.toBeNull()
  })

  it('Phase 3: evicts entire sessions, oldest first', () => {
    const expired = makeSession({
      id: 'expired',
      arrived_at: '2026-05-19T08:00:00+10:00',
      expires_at: '2026-05-19T18:00:00+10:00',
    })
    localStorage.setItem(KEY, JSON.stringify([expired]))

    quotaThrowsNTimes(3) // Phase 0, 1, 2 all fail, Phase 3 eviction succeeds
    const report = saveSession(makeSession({ id: 'fresh' }))

    expect(report.evicted).toBe(1)
    const after = loadSessions()
    expect(after.find((s) => s.id === 'expired')).toBeUndefined()
    expect(after.find((s) => s.id === 'fresh')).toBeDefined()
  })

  it('reports trimmedPhotosFrom + evicted counts truthfully', () => {
    const older = makeSession({
      id: 'older',
      arrived_at: '2026-05-19T08:00:00+10:00',
      expires_at: '2026-05-19T18:00:00+10:00',
    })
    const newer = makeSession({
      id: 'newer',
      arrived_at: '2026-05-20T08:00:00+10:00',
      expires_at: '2026-05-20T18:00:00+10:00',
    })
    localStorage.setItem(KEY, JSON.stringify([newer, older]))

    quotaThrowsNTimes(2) // initial + 1 Phase 1 strip fail; 2nd Phase 1 strip succeeds
    const report = saveSession(makeSession({ id: 'fresh' }))
    expect(report).toEqual({ trimmedPhotosFrom: 2, evicted: 0 })
  })

  it('NEVER touches active sessions (expires_at > now OR no_sign without ended_at)', () => {
    const activeFuture = makeSession({
      id: 'activeFuture',
      arrived_at: '2026-05-21T08:00:00+10:00',
      expires_at: '2026-05-21T18:00:00+10:00', // future relative to FIXED_NOW
    })
    const activeNoSign = makeSession({
      id: 'activeNoSign',
      arrived_at: '2026-05-21T07:00:00+10:00',
      expires_at: null,
      no_sign: true,
    })
    localStorage.setItem(KEY, JSON.stringify([activeFuture, activeNoSign]))

    // Force every retry to throw — Phase 3 should hit a wall because no
    // expired sessions exist.
    quotaThrowsNTimes(99)
    expect(() => saveSession(makeSession({ id: 'fresh' }))).toThrow(/storage is full/i)

    // After the failed write, the active sessions should be intact in
    // localStorage (whatever we last successfully wrote — which is the
    // initial seed we set above).
    const after = loadSessions()
    expect(after.find((s) => s.id === 'activeFuture')?.car_photo).not.toBeNull()
    expect(after.find((s) => s.id === 'activeFuture')?.sign_photo).not.toBe('')
    expect(after.find((s) => s.id === 'activeNoSign')?.car_photo).not.toBeNull()
  })

  it('treats ended_at sessions as victim-eligible (same as past-expiry)', () => {
    const endedButFutureExpiry = makeSession({
      id: 'endedFuture',
      arrived_at: '2026-05-21T08:00:00+10:00',
      expires_at: '2026-05-21T18:00:00+10:00', // still in the future…
      ended_at: '2026-05-21T11:00:00+10:00', // …but driver signalled "I've left"
    })
    localStorage.setItem(KEY, JSON.stringify([endedButFutureExpiry]))

    quotaThrowsNTimes(1)
    const report = saveSession(makeSession({ id: 'fresh' }))
    expect(report.trimmedPhotosFrom).toBe(1)
    // The ended session got its car_photo stripped despite future expires_at.
    expect(loadSessions().find((s) => s.id === 'endedFuture')?.car_photo).toBeNull()
  })

  it('throws a friendly error when even full eviction cannot fit', () => {
    localStorage.setItem(KEY, JSON.stringify([])) // no expired sessions to evict

    quotaThrowsNTimes(99)
    expect(() => saveSession(makeSession({ id: 'fresh' }))).toThrow(
      /storage is full.*delete an old session/i,
    )
  })
})
