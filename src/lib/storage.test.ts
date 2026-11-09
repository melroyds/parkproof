// @vitest-environment happy-dom
//
// storage — localStorage CRUD + 3-phase quota recovery + endSession +
// loadActiveSessions + the records-changed event.
//
// The 3-phase recovery is the most important code in this file to test:
// it's the kind of logic that only fires on a full localStorage, only
// matters when the user is mid-flow, and produces no error in unit-less
// dev environments. A regression here = "I logged my park but it didn't
// save and I didn't know" — the worst-case ParkProof failure mode.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  ACTIVE_AFTER_EXPIRY_MS,
  RECORDS_CHANGED_EVENT,
  getRecordsRevision,
  hasUnsignedEvidence,
  loadSessions,
  notifyRecordsChanged,
  saveSession,
  deleteSession,
  updateSession,
  endSession,
  loadActiveSessions,
  getSession,
  subscribeRecordsChanged,
  ERR_STORAGE_FULL,
  StorageFullError,
  isStorageFullError,
  appendAddendum,
  rejectAddendum,
  setAddendumBundle,
  setArrivalSignature,
  subscribeStorageRecovered,
  DuplicateRecordError,
  ERR_DUPLICATE_RECORD,
  isDuplicateRecordError,
  loadSessionIdsForGc,
  isActiveRecord,
  upsertSharedCopy,
  SHARED_AT_SKEW_MS,
} from './storage'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from './photo-store'
import { AddendumValidationError } from '../../lambda/addendum-schema.js'
import { MAX_ADDENDA } from './evidence-chain'
import type { ParkingSession, SignatureBundle } from '../types'

const KEY = 'parkproof.sessions.v1'
const FIXED_NOW = new Date('2026-05-21T10:00:00+10:00').getTime()

/**
 * An arrival signature. Quota recovery only strips or evicts records whose
 * evidence is fully signed, so expired records in the recovery tests carry
 * one.
 */
const SIGNED: SignatureBundle = {
  schema: 'parkproof-evidence-v1',
  signed_at: '2026-05-19T08:00:05.000Z',
  algorithm: 'ECDSA_SHA_256',
  key_alias: 'alias/parkproof-evidence-signing',
  canonical_payload: '{}',
  signature_base64: 'MEUCIQ==',
}

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
      signature: SIGNED,
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

  it('excludes sessions more than 12h past expiry (auto-fall-off)', () => {
    const past = makeSession({ id: 'past', expires_at: '2026-05-20T21:59:00+10:00' })
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
    const past = makeSession({ id: 'past', expires_at: '2026-05-20T08:00:00+10:00' })
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
      signature: SIGNED,
    })
    const newerExpired = makeSession({
      id: 'newerExpired',
      arrived_at: '2026-05-20T08:00:00+10:00',
      expires_at: '2026-05-20T18:00:00+10:00',
      signature: SIGNED,
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
      signature: SIGNED,
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
      signature: SIGNED,
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
      signature: SIGNED,
    })
    const newer = makeSession({
      id: 'newer',
      arrived_at: '2026-05-20T08:00:00+10:00',
      expires_at: '2026-05-20T18:00:00+10:00',
      signature: SIGNED,
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
      signature: SIGNED,
    })
    localStorage.setItem(KEY, JSON.stringify([endedButFutureExpiry]))

    quotaThrowsNTimes(1)
    const report = saveSession(makeSession({ id: 'fresh' }))
    expect(report.trimmedPhotosFrom).toBe(1)
    // The ended session got its car_photo stripped despite future expires_at.
    expect(loadSessions().find((s) => s.id === 'endedFuture')?.car_photo).toBeNull()
  })

  it('throws a typed StorageFullError when even full eviction cannot fit', () => {
    localStorage.setItem(KEY, JSON.stringify([])) // no expired sessions to evict

    quotaThrowsNTimes(99)
    let caught: unknown
    try {
      saveSession(makeSession({ id: 'fresh' }))
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(StorageFullError)
    expect((caught as StorageFullError).code).toBe(ERR_STORAGE_FULL)
    expect(isStorageFullError(caught)).toBe(true)
    // The English message is for logs only, and uses the record noun.
    expect((caught as Error).message).toMatch(/storage is full/i)
    expect((caught as Error).message).not.toMatch(/session/i)
  })

  it('isStorageFullError recognises the code and nothing else', () => {
    expect(isStorageFullError(Object.assign(new Error('x'), { code: ERR_STORAGE_FULL }))).toBe(true)
    expect(isStorageFullError(new Error('storage is full'))).toBe(false)
    expect(isStorageFullError(null)).toBe(false)
  })
})

describe('loadActiveSessions — ending after expiry', () => {
  it('keeps an expired, un-ended record for 12 hours after expires_at', () => {
    const justExpired = makeSession({ id: 'justExpired', expires_at: '2026-05-21T09:30:00+10:00' })
    const longAgo = makeSession({ id: 'longAgo', expires_at: '2026-05-20T21:00:00+10:00' })
    localStorage.setItem(KEY, JSON.stringify([justExpired, longAgo]))
    expect(loadActiveSessions(FIXED_NOW).map((s) => s.id)).toEqual(['justExpired'])
  })

  it('drops the record exactly at expires_at + 12h', () => {
    const expiresMs = new Date('2026-05-21T09:00:00+10:00').getTime()
    const s = makeSession({ id: 's', expires_at: new Date(expiresMs).toISOString() })
    localStorage.setItem(KEY, JSON.stringify([s]))
    expect(ACTIVE_AFTER_EXPIRY_MS).toBe(12 * 60 * 60 * 1000)
    expect(loadActiveSessions(expiresMs + ACTIVE_AFTER_EXPIRY_MS - 1).map((x) => x.id)).toEqual(['s'])
    expect(loadActiveSessions(expiresMs + ACTIVE_AFTER_EXPIRY_MS)).toEqual([])
  })

  it('never keeps an expired record the driver has ended', () => {
    const ended = makeSession({
      id: 'ended',
      expires_at: '2026-05-21T09:30:00+10:00',
      ended_at: '2026-05-21T09:45:00+10:00',
    })
    localStorage.setItem(KEY, JSON.stringify([ended]))
    expect(loadActiveSessions(FIXED_NOW)).toEqual([])
  })

  it('puts live countdowns first, then open-ended records, then expired un-ended ones', () => {
    const expired = makeSession({ id: 'expired', expires_at: '2026-05-21T09:00:00+10:00' })
    const live = makeSession({ id: 'live', expires_at: '2026-05-21T12:00:00+10:00' })
    const noSign = makeSession({ id: 'noSign', expires_at: null, no_sign: true })
    localStorage.setItem(KEY, JSON.stringify([expired, noSign, live]))
    expect(loadActiveSessions(FIXED_NOW).map((s) => s.id)).toEqual(['live', 'noSign', 'expired'])
  })

  it('a stale expired record never takes the main card from a live countdown', () => {
    // Parked at 9 under 2P, moved at 10:55 without tapping I've left, then
    // logged a 1P at 2 pm. At 2:30 pm the 1P countdown must be first.
    const now = new Date('2026-05-21T14:30:00+10:00').getTime()
    const morning = makeSession({
      id: 'morning',
      arrived_at: '2026-05-21T09:00:00+10:00',
      expires_at: '2026-05-21T11:00:00+10:00',
    })
    const afternoon = makeSession({
      id: 'afternoon',
      arrived_at: '2026-05-21T14:00:00+10:00',
      expires_at: '2026-05-21T15:00:00+10:00',
    })
    localStorage.setItem(KEY, JSON.stringify([morning, afternoon]))
    expect(loadActiveSessions(now).map((s) => s.id)).toEqual(['afternoon', 'morning'])
  })

  it('orders several expired un-ended records most recently expired first', () => {
    const now = new Date('2026-05-21T14:30:00+10:00').getTime()
    const earlier = makeSession({ id: 'earlier', expires_at: '2026-05-21T09:00:00+10:00' })
    const later = makeSession({ id: 'later', expires_at: '2026-05-21T13:00:00+10:00' })
    localStorage.setItem(KEY, JSON.stringify([earlier, later]))
    expect(loadActiveSessions(now).map((s) => s.id)).toEqual(['later', 'earlier'])
  })

  it('shows an expired record as the main card once nothing is live', () => {
    const expired = makeSession({ id: 'expired', expires_at: '2026-05-21T09:00:00+10:00' })
    localStorage.setItem(KEY, JSON.stringify([expired]))
    expect(loadActiveSessions(FIXED_NOW).map((s) => s.id)).toEqual(['expired'])
  })

  it('ignores an unparseable expires_at', () => {
    const broken = makeSession({ id: 'broken', expires_at: 'not a date' })
    localStorage.setItem(KEY, JSON.stringify([broken]))
    expect(loadActiveSessions(FIXED_NOW)).toEqual([])
  })
})

describe('hasUnsignedEvidence', () => {
  it('is true without an arrival signature', () => {
    expect(hasUnsignedEvidence(makeSession({ signature: undefined }))).toBe(true)
  })

  it('is false for a signed record with no addenda', () => {
    expect(hasUnsignedEvidence(makeSession({ signature: SIGNED }))).toBe(false)
  })

  it('is true while any addendum is neither signed nor rejected', () => {
    const s = { ...makeSession({ signature: SIGNED }), addenda: [{ bundle: SIGNED }, { id: 'pending' }] }
    expect(hasUnsignedEvidence(s as ParkingSession)).toBe(true)
  })

  it('is false when every addendum is signed or rejected', () => {
    const s = {
      ...makeSession({ signature: SIGNED }),
      addenda: [{ bundle: SIGNED }, { rejected: { code: 'ERR_BAD_STRING', at: '2026-05-21T00:00:00Z' } }],
    }
    expect(hasUnsignedEvidence(s as ParkingSession)).toBe(false)
  })
})

describe('persistWithQuotaRecovery — fixes and protections', () => {
  it('Phase 3 evicts by id: removing one victim never shifts eviction onto an active record', () => {
    // Storage order after the save: [fresh, e1, e2, active]. The old code
    // remembered array indices, so after splicing e1 the "e2" index pointed
    // at the active record and evicted it instead.
    const e1 = makeSession({
      id: 'e1',
      arrived_at: '2026-05-18T08:00:00+10:00',
      expires_at: '2026-05-18T18:00:00+10:00',
      signature: SIGNED,
    })
    const e2 = makeSession({
      id: 'e2',
      arrived_at: '2026-05-19T08:00:00+10:00',
      expires_at: '2026-05-19T18:00:00+10:00',
      signature: SIGNED,
    })
    const active = makeSession({
      id: 'active',
      arrived_at: '2026-05-21T09:00:00+10:00',
      expires_at: '2099-01-01T00:00:00+10:00',
    })
    localStorage.setItem(KEY, JSON.stringify([e1, e2, active]))

    // Fails: initial, 2 car strips, 2 sign strips, the first eviction.
    // The 7th write (after evicting e2 as well) succeeds.
    quotaThrowsNTimes(6)
    const report = saveSession(makeSession({ id: 'fresh', expires_at: '2099-01-01T00:00:00+10:00' }))

    expect(report.evicted).toBe(2)
    const ids = loadSessions().map((s) => s.id)
    expect(ids).toEqual(['fresh', 'active'])
    const kept = getSession('active')!
    expect(kept.car_photo).toBe('data:image/jpeg;base64,CAR')
    expect(kept.sign_photo).toBe('data:image/jpeg;base64,SIGN')
  })

  it('Phase 2 strips ambient_photo too', () => {
    const noSign = makeSession({
      id: 'noSign',
      arrived_at: '2026-05-19T08:00:00+10:00',
      expires_at: null,
      no_sign: true,
      sign_photo: null,
      car_photo: null,
      ambient_photo: 'data:image/jpeg;base64,AMBIENT',
      ended_at: '2026-05-19T10:00:00+10:00',
      signature: SIGNED,
    })
    localStorage.setItem(KEY, JSON.stringify([noSign]))

    quotaThrowsNTimes(1) // initial fails; no car photo to strip, so Phase 2 runs
    const report = saveSession(makeSession({ id: 'fresh' }))

    expect(report).toEqual({ trimmedPhotosFrom: 1, evicted: 0 })
    const after = getSession('noSign')!
    expect(after.ambient_photo).toBeNull()
    expect(after.sign_photo).toBeNull() // untouched: it had none
    expect(after.signature).toEqual(SIGNED)
  })

  it('counts a record once even when both photo phases touched it', () => {
    const expired = makeSession({
      id: 'expired',
      arrived_at: '2026-05-19T08:00:00+10:00',
      expires_at: '2026-05-19T18:00:00+10:00',
      signature: SIGNED,
    })
    localStorage.setItem(KEY, JSON.stringify([expired]))
    quotaThrowsNTimes(2) // initial + Phase 1 fail, Phase 2 succeeds
    expect(saveSession(makeSession({ id: 'fresh' }))).toEqual({ trimmedPhotosFrom: 1, evicted: 0 })
  })

  it('counts an evicted record as evicted only, not also as trimmed', () => {
    const expired = makeSession({
      id: 'expired',
      arrived_at: '2026-05-19T08:00:00+10:00',
      expires_at: '2026-05-19T18:00:00+10:00',
      signature: SIGNED,
    })
    localStorage.setItem(KEY, JSON.stringify([expired]))
    quotaThrowsNTimes(3)
    expect(saveSession(makeSession({ id: 'fresh' }))).toEqual({ trimmedPhotosFrom: 0, evicted: 1 })
  })

  it('never strips or evicts an expired record whose arrival signature is missing', () => {
    const unsigned = makeSession({
      id: 'unsigned',
      arrived_at: '2026-05-19T08:00:00+10:00',
      expires_at: '2026-05-19T18:00:00+10:00',
    })
    localStorage.setItem(KEY, JSON.stringify([unsigned]))

    quotaThrowsNTimes(99)
    expect(() => saveSession(makeSession({ id: 'fresh' }))).toThrow(/storage is full/i)
    const after = getSession('unsigned')!
    expect(after.car_photo).toBe('data:image/jpeg;base64,CAR')
    expect(after.sign_photo).toBe('data:image/jpeg;base64,SIGN')
  })

  it('never strips or evicts a record with a pending addendum, but still frees space elsewhere', () => {
    const pending = {
      ...makeSession({
        id: 'pending',
        arrived_at: '2026-05-18T08:00:00+10:00',
        expires_at: '2026-05-18T18:00:00+10:00',
        signature: SIGNED,
      }),
      addenda: [{ id: 'a1', seq: 1, kind: 'arrival_context' }],
    } as ParkingSession
    const signedOld = makeSession({
      id: 'signedOld',
      arrived_at: '2026-05-19T08:00:00+10:00',
      expires_at: '2026-05-19T18:00:00+10:00',
      signature: SIGNED,
    })
    localStorage.setItem(KEY, JSON.stringify([pending, signedOld]))

    // `pending` is the oldest, so it would have been the first victim.
    quotaThrowsNTimes(1)
    const report = saveSession(makeSession({ id: 'fresh' }))
    expect(report).toEqual({ trimmedPhotosFrom: 1, evicted: 0 })
    expect(getSession('pending')!.car_photo).toBe('data:image/jpeg;base64,CAR')
    expect(getSession('signedOld')!.car_photo).toBeNull()
  })
})

describe('persistWithQuotaRecovery — records still on home are protected', () => {
  const HOUR = 60 * 60 * 1000

  it('never strips or evicts a signed record that expired 1 h ago and was not ended', () => {
    const recent = makeSession({
      id: 'recent',
      arrived_at: new Date(Date.now() - 3 * HOUR).toISOString(),
      expires_at: new Date(Date.now() - HOUR).toISOString(),
      signature: SIGNED,
    })
    localStorage.setItem(KEY, JSON.stringify([recent]))

    quotaThrowsNTimes(99)
    expect(() => saveSession(makeSession({ id: 'fresh' }))).toThrow(StorageFullError)
    const after = getSession('recent')!
    expect(after.car_photo).toBe('data:image/jpeg;base64,CAR')
    expect(after.sign_photo).toBe('data:image/jpeg;base64,SIGN')
  })

  it('frees space from a record that expired more than 12 h ago instead', () => {
    const recent = makeSession({
      id: 'recent',
      arrived_at: new Date(Date.now() - 3 * HOUR).toISOString(),
      expires_at: new Date(Date.now() - HOUR).toISOString(),
      signature: SIGNED,
    })
    const old = makeSession({
      id: 'old',
      arrived_at: new Date(Date.now() - 15 * HOUR).toISOString(),
      expires_at: new Date(Date.now() - 13 * HOUR).toISOString(),
      signature: SIGNED,
    })
    localStorage.setItem(KEY, JSON.stringify([recent, old]))

    quotaThrowsNTimes(1)
    expect(saveSession(makeSession({ id: 'fresh' }))).toEqual({ trimmedPhotosFrom: 1, evicted: 0 })
    expect(getSession('old')!.car_photo).toBeNull()
    expect(getSession('recent')!.car_photo).toBe('data:image/jpeg;base64,CAR')
  })

  it('an expired record the driver ended is eligible straight away', () => {
    const ended = makeSession({
      id: 'ended',
      arrived_at: new Date(Date.now() - 3 * HOUR).toISOString(),
      expires_at: new Date(Date.now() - HOUR).toISOString(),
      ended_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      signature: SIGNED,
    })
    localStorage.setItem(KEY, JSON.stringify([ended]))
    quotaThrowsNTimes(1)
    expect(saveSession(makeSession({ id: 'fresh' }))).toEqual({ trimmedPhotosFrom: 1, evicted: 0 })
  })
})

describe('records-changed event', () => {
  const seen: Array<string | null> = []
  const onChange = (e: Event) => seen.push((e as CustomEvent<{ id: string | null }>).detail.id)

  beforeEach(() => {
    seen.length = 0
    window.addEventListener(RECORDS_CHANGED_EVENT, onChange)
  })
  afterEach(() => {
    window.removeEventListener(RECORDS_CHANGED_EVENT, onChange)
  })

  it('fires on save, update, end and delete, with the record id', () => {
    saveSession(makeSession({ id: 'a' }))
    updateSession('a', { note: 'n' })
    endSession('a')
    deleteSession('a')
    expect(seen).toEqual(['a', 'a', 'a', 'a'])
  })

  it('does not fire when updateSession finds no record', () => {
    updateSession('missing', { note: 'n' })
    expect(seen).toEqual([])
  })

  it('does not fire when the write fails', () => {
    quotaThrowsNTimes(99)
    expect(() => saveSession(makeSession({ id: 'a' }))).toThrow()
    expect(seen).toEqual([])
  })

  it('bumps the revision on every notification', () => {
    const before = getRecordsRevision()
    saveSession(makeSession({ id: 'a' }))
    notifyRecordsChanged()
    expect(getRecordsRevision()).toBe(before + 2)
    expect(seen).toEqual(['a', null])
  })

  it('subscribeRecordsChanged delivers events until unsubscribed', () => {
    let calls = 0
    const unsubscribe = subscribeRecordsChanged(() => calls++)
    saveSession(makeSession({ id: 'a' }))
    unsubscribe()
    saveSession(makeSession({ id: 'b' }))
    expect(calls).toBe(1)
  })

  it('forwards a records write from another tab (storage event)', () => {
    let calls = 0
    const unsubscribe = subscribeRecordsChanged(() => calls++)
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'some.other.key' }))
    unsubscribe()
    expect(calls).toBe(1)
  })
})

describe('evidence chain writes', () => {
  const T = '2026-05-21T08:00:00.000Z'
  const departure = { ended_at: T, location: null, distance_from_arrival_m: null, return_photos: [] }
  const condition = () => ({
    when: 'parking',
    photos: [{ role: 'condition-front', sha256: 'a'.repeat(64), captured_at: T, source: 'camera_input' }],
    note: null,
  })
  /** A bundle that signs addendum `id` at `seq` (only its identity is read here). */
  const bundleFor = (id: string, seq: number): SignatureBundle => ({
    ...SIGNED,
    schema: 'parkproof-addendum-v1',
    canonical_payload: JSON.stringify({ schema: 'parkproof-addendum-v1', addendum_id: id, seq }),
  })

  let seen: Array<string | null>
  let unsubscribe: () => void
  beforeEach(() => {
    seen = []
    const listener = (e: Event) => seen.push((e as CustomEvent<{ id: string | null }>).detail.id)
    window.addEventListener(RECORDS_CHANGED_EVENT, listener)
    unsubscribe = () => window.removeEventListener(RECORDS_CHANGED_EVENT, listener)
  })
  afterEach(() => unsubscribe())

  it('appendAddendum assigns seq from a fresh read, not from the caller', () => {
    const stale = makeSession({ id: 'r', signature: SIGNED })
    saveSession(stale)
    const a = appendAddendum('r', { kind: 'condition', data: condition() })!
    // The caller still holds the stale copy, with no addenda; storage decides.
    const b = appendAddendum(stale.id, { kind: 'condition', data: condition() })!
    expect([a.seq, b.seq]).toEqual([1, 2])
    expect(getSession('r')!.addenda!.map((x) => x.seq)).toEqual([1, 2])
    expect(seen).toEqual(['r', 'r', 'r'])
  })

  it('stores the normalised data and freezes the capture time', () => {
    saveSession(makeSession({ id: 'r' }))
    const reordered = { return_photos: [], distance_from_arrival_m: null, location: null, ended_at: T }
    const a = appendAddendum('r', { kind: 'departure', data: reordered, captured_at: T })!
    expect(Object.keys(a.data)).toEqual(['ended_at', 'location', 'distance_from_arrival_m', 'return_photos'])
    expect(a.captured_at).toBe(T)
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.bundle).toBeUndefined()
    expect(getSession('r')!.addenda![0]).toEqual(a)
  })

  it('throws for invalid data and stores nothing', () => {
    saveSession(makeSession({ id: 'r' }))
    expect(() => appendAddendum('r', { kind: 'departure', data: { ...departure, extra: 1 } })).toThrow(AddendumValidationError)
    expect(() => appendAddendum('r', { kind: 'departure', data: departure, captured_at: 'now' })).toThrow(AddendumValidationError)
    expect(() => appendAddendum('r', { kind: 'departure', data: departure, id: 'not-a-uuid' })).toThrow(AddendumValidationError)
    expect(getSession('r')!.addenda).toBeUndefined()
  })

  it('keeps one arrival_context and one departure per record', () => {
    saveSession(makeSession({ id: 'r' }))
    const first = appendAddendum('r', { kind: 'departure', data: departure })!
    const second = appendAddendum('r', { kind: 'departure', data: { ...departure, ended_at: '2026-05-21T09:00:00.000Z' } })!
    expect(second).toEqual(first)
    expect(getSession('r')!.addenda).toHaveLength(1)
  })

  it('returns null for a missing record, a shared copy, a duplicate id, or a full record', () => {
    expect(appendAddendum('missing', { kind: 'departure', data: departure })).toBeNull()
    saveSession(
      makeSession({
        id: 'shared',
        shared_from: { original_session_id: 'x', received_at: T, shared_at: null, arrival_bundle: null, snapshot: {} },
      }),
    )
    expect(appendAddendum('shared', { kind: 'departure', data: departure })).toBeNull()

    saveSession(makeSession({ id: 'r' }))
    const id = '0b6f7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e'
    appendAddendum('r', { kind: 'condition', data: condition(), id })
    expect(appendAddendum('r', { kind: 'condition', data: condition(), id })).toBeNull()
    for (let i = 1; i < MAX_ADDENDA; i++) appendAddendum('r', { kind: 'condition', data: condition() })
    expect(getSession('r')!.addenda).toHaveLength(MAX_ADDENDA)
    expect(appendAddendum('r', { kind: 'condition', data: condition() })).toBeNull()
  })

  it('setAddendumBundle is first-write-wins', () => {
    saveSession(makeSession({ id: 'r' }))
    const a = appendAddendum('r', { kind: 'condition', data: condition() })!
    const first = bundleFor(a.id, 1)
    const second = { ...bundleFor(a.id, 1), signed_at: '2026-05-21T09:00:00.000Z' }
    expect(setAddendumBundle('r', a.id, first)).toBe(true)
    expect(setAddendumBundle('r', a.id, second)).toBe(false)
    expect(getSession('r')!.addenda![0].bundle).toEqual(first)
  })

  it('setAddendumBundle refuses a bundle for another addendum or seq, a rejected addendum, or a missing one', () => {
    saveSession(makeSession({ id: 'r' }))
    const a = appendAddendum('r', { kind: 'condition', data: condition() })!
    expect(setAddendumBundle('r', a.id, bundleFor(a.id, 2))).toBe(false)
    expect(setAddendumBundle('r', a.id, bundleFor('someone-else', 1))).toBe(false)
    expect(setAddendumBundle('r', a.id, { ...SIGNED, canonical_payload: 'garbage' })).toBe(false)
    expect(setAddendumBundle('r', 'missing', bundleFor('missing', 1))).toBe(false)
    expect(setAddendumBundle('nope', a.id, bundleFor(a.id, 1))).toBe(false)
    rejectAddendum('r', a.id, 'ERR_BAD_STRING')
    expect(setAddendumBundle('r', a.id, bundleFor(a.id, 1))).toBe(false)
  })

  it('rejectAddendum marks it, renumbers later pending addenda, and only once', () => {
    saveSession(makeSession({ id: 'r', signature: SIGNED }))
    const a = appendAddendum('r', { kind: 'condition', data: condition() })!
    setAddendumBundle('r', a.id, bundleFor(a.id, 1))
    const b = appendAddendum('r', { kind: 'condition', data: condition() })!
    const c = appendAddendum('r', { kind: 'departure', data: departure })!
    expect([b.seq, c.seq]).toEqual([2, 3])

    expect(rejectAddendum('r', b.id, 'ERR_BAD_STRING', T)).toBe(true)
    const after = getSession('r')!.addenda!
    expect(after.find((x) => x.id === b.id)).toMatchObject({ seq: 2, rejected: { code: 'ERR_BAD_STRING', at: T } })
    expect(after.find((x) => x.id === c.id)!.seq).toBe(2)
    expect(rejectAddendum('r', b.id, 'ERR_BAD_STRING')).toBe(false)
    // A signed addendum is never rejected after the fact.
    expect(rejectAddendum('r', a.id, 'ERR_BAD_STRING')).toBe(false)
  })

  it('setArrivalSignature is first-write-wins', () => {
    saveSession(makeSession({ id: 'r', signature: undefined }))
    expect(setArrivalSignature('r', SIGNED)).toBe(true)
    expect(setArrivalSignature('r', { ...SIGNED, signed_at: '2026-05-22T00:00:00.000Z' })).toBe(false)
    expect(getSession('r')!.signature).toEqual(SIGNED)
    expect(setArrivalSignature('missing', SIGNED)).toBe(false)
  })

  it('a background chain write that frees space fires storage-recovered with the report', () => {
    const reports: unknown[] = []
    const stop = subscribeStorageRecovered((r) => reports.push(r))
    try {
      saveSession(
        makeSession({
          id: 'old',
          arrived_at: '2026-05-18T08:00:00+10:00',
          expires_at: '2026-05-18T18:00:00+10:00',
          ended_at: '2026-05-18T17:00:00+10:00',
          signature: SIGNED,
        }),
      )
      saveSession(makeSession({ id: 'r' }))
      expect(reports).toEqual([]) // clean writes say nothing

      // Initial write, the car-photo strip and the sign-photo strip all fail;
      // evicting the old record fits.
      quotaThrowsNTimes(3)
      expect(appendAddendum('r', { kind: 'departure', data: departure })).not.toBeNull()
      expect(getSession('old')).toBeUndefined()
      expect(reports).toEqual([{ trimmedPhotosFrom: 0, evicted: 1 }])

      // A write that can't fit at all changed nothing, so it fires nothing.
      quotaThrowsNTimes(99)
      expect(() => appendAddendum('r', { kind: 'condition', data: condition() })).toThrow(StorageFullError)
      expect(reports).toHaveLength(1)
    } finally {
      stop()
    }
    // Unsubscribed: nothing more arrives.
    quotaThrowsNTimes(0)
    saveSession(makeSession({ id: 'old2', expires_at: '2026-05-18T18:00:00+10:00', ended_at: '2026-05-18T17:00:00+10:00', signature: SIGNED }))
    quotaThrowsNTimes(1)
    setArrivalSignature('r', SIGNED)
    expect(reports).toHaveLength(1)
  })

  it('a record with a pending addendum is never a quota victim', () => {
    const old = makeSession({
      id: 'old',
      arrived_at: '2026-05-18T08:00:00+10:00',
      expires_at: '2026-05-18T18:00:00+10:00',
      signature: SIGNED,
    })
    saveSession(old)
    appendAddendum('old', { kind: 'departure', data: departure })
    expect(hasUnsignedEvidence(getSession('old')!)).toBe(true)
    quotaThrowsNTimes(99)
    expect(() => saveSession(makeSession({ id: 'fresh' }))).toThrow(StorageFullError)
    expect(getSession('old')!.car_photo).toBe('data:image/jpeg;base64,CAR')
  })
})

describe('the photo store and the records (T0b2)', () => {
  let photos: ReturnType<typeof createMemoryPhotoBackend>
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
  const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)
  const keysOf = (id: string) => [...photos.records.keys()].filter((k) => k.startsWith(`${id}/`))

  beforeEach(() => {
    photos = createMemoryPhotoBackend()
    setPhotoBackendForTests(photos)
  })
  afterEach(() => setPhotoBackendForTests(null))

  it('saveSession refuses a duplicate id: throws, writes nothing, notifies nobody', () => {
    saveSession(makeSession({ id: 'dup', rules: 'first' }))
    const before = localStorage.getItem(KEY)
    const heard = vi.fn()
    const unsubscribe = subscribeRecordsChanged(heard)
    let thrown: unknown
    try {
      saveSession(makeSession({ id: 'dup', rules: 'second' }))
    } catch (err) {
      thrown = err
    }
    unsubscribe()
    expect(thrown).toBeInstanceOf(DuplicateRecordError)
    expect(isDuplicateRecordError(thrown)).toBe(true)
    expect(isDuplicateRecordError({ code: ERR_DUPLICATE_RECORD })).toBe(true)
    expect(isDuplicateRecordError(new Error('other'))).toBe(false)
    expect(localStorage.getItem(KEY)).toBe(before)
    expect(loadSessions().filter((s) => s.id === 'dup')).toHaveLength(1)
    expect(getSession('dup')?.rules).toBe('first')
    expect(heard).not.toHaveBeenCalled()
  })

  it("deleteSession deletes that record's photos, and only them", async () => {
    saveSession(makeSession({ id: 'gone' }))
    saveSession(makeSession({ id: 'kept' }))
    await putPhoto('gone', jpeg('g1'))
    await putPhoto('gone', jpeg('g2'))
    await putPhoto('kept', jpeg('k1'))
    deleteSession('gone')
    await vi.waitFor(() => expect(keysOf('gone')).toEqual([]))
    expect(keysOf('kept')).toHaveLength(1)
  })

  it("quota eviction deletes the evicted record's photos; stripping legacy fields does not", async () => {
    const expiredA = makeSession({
      id: 'old-a',
      arrived_at: '2026-05-18T08:00:00+10:00',
      expires_at: '2026-05-18T18:00:00+10:00',
      signature: SIGNED,
    })
    const expiredB = makeSession({
      id: 'old-b',
      arrived_at: '2026-05-19T08:00:00+10:00',
      expires_at: '2026-05-19T18:00:00+10:00',
      signature: SIGNED,
    })
    localStorage.setItem(KEY, JSON.stringify([expiredB, expiredA]))
    await putPhoto('old-a', jpeg('a'))
    await putPhoto('old-b', jpeg('b'))

    // Initial write, 2 car strips and 2 sign strips fail; evicting old-a fits.
    quotaThrowsNTimes(5)
    expect(saveSession(makeSession({ id: 'fresh' }))).toEqual({ trimmedPhotosFrom: 1, evicted: 1 })
    expect(getSession('old-a')).toBeUndefined()
    await vi.waitFor(() => expect(keysOf('old-a')).toEqual([]))
    // old-b was only stripped of its legacy fields: its photo-store bytes stay.
    await flush()
    expect(getSession('old-b')).toBeDefined()
    expect(keysOf('old-b')).toHaveLength(1)
  })

  it('a write that still cannot fit deletes no photos', async () => {
    localStorage.setItem(KEY, JSON.stringify([]))
    await putPhoto('fresh', jpeg('f'))
    quotaThrowsNTimes(10)
    expect(() => saveSession(makeSession({ id: 'fresh' }))).toThrow(StorageFullError)
    await flush()
    expect(keysOf('fresh')).toHaveLength(1)
  })
})

describe('loadSessionIdsForGc (the startup photo sweep reads records strictly)', () => {
  it('lists the saved ids, and [] only when nothing has been saved', () => {
    expect(loadSessionIdsForGc()).toEqual([])
    saveSession(makeSession({ id: 'a' }))
    saveSession(makeSession({ id: 'b' }))
    expect(loadSessionIdsForGc()?.sort()).toEqual(['a', 'b'])
  })

  it('null (not []) when the records cannot be read: corrupt JSON, not a list, or a storage error', () => {
    localStorage.setItem(KEY, '{not json')
    expect(loadSessionIdsForGc()).toBeNull()
    expect(loadSessions()).toEqual([]) // the lenient reader would have said "no records"
    localStorage.setItem(KEY, JSON.stringify({ id: 'a' }))
    expect(loadSessionIdsForGc()).toBeNull()
    const realGetItem = fakeLocalStorage.getItem
    fakeLocalStorage.getItem = () => {
      throw new DOMException('The file is corrupted', 'NS_ERROR_FILE_CORRUPTED')
    }
    try {
      expect(loadSessionIdsForGc()).toBeNull()
    } finally {
      fakeLocalStorage.getItem = realGetItem
    }
  })

  it('skips entries without a string id', () => {
    localStorage.setItem(KEY, JSON.stringify([{ id: 'a' }, null, 7, { id: 3 }, { id: 'b' }]))
    expect(loadSessionIdsForGc()).toEqual(['a', 'b'])
  })
})

// ─── Shared copies (T7) under quota, and which copy is newer ─────────────

describe('shared copies and the storage quota (T7)', () => {
  const sharedFrom = (original: string, receivedAt: string, sharedAt: string | null = receivedAt) => ({
    original_session_id: original,
    received_at: receivedAt,
    shared_at: sharedAt,
    arrival_bundle: SIGNED,
    snapshot: {},
  })
  const copyOf = (id: string, original: string, receivedAt: string, sharedAt?: string | null) =>
    makeSession({
      id,
      sign_photo: null,
      car_photo: null,
      expires_at: '2099-01-01T00:00:00.000Z', // a live countdown: never "off home" by its own times
      shared_from: sharedFrom(original, receivedAt, sharedAt === undefined ? receivedAt : sharedAt),
    })
  // The driver's own old record, signed and off home: normal recovery would strip and evict it.
  const ownOld = () =>
    makeSession({
      id: 'own-old',
      arrived_at: '2026-05-19T08:00:00+10:00',
      expires_at: '2026-05-19T18:00:00+10:00',
      signature: SIGNED,
    })

  it("never strips or evicts the driver's own records to fit someone else's copy", () => {
    localStorage.setItem(KEY, JSON.stringify([ownOld()]))
    // One failed write: normal recovery would strip the own record's car
    // photo and then fit. A copy must not get that far.
    quotaThrowsNTimes(1)
    expect(() => upsertSharedCopy(copyOf('copy-1', 'theirs-1', '2026-05-21T09:00:00.000Z'))).toThrow(StorageFullError)
    const after = loadSessions()
    expect(after.map((s) => s.id)).toEqual(['own-old'])
    expect(after[0].car_photo).toBe('data:image/jpeg;base64,CAR')
    expect(after[0].sign_photo).toBe('data:image/jpeg;base64,SIGN')
  })

  it('fits a copy by evicting older shared copies only', () => {
    const older = copyOf('copy-old', 'theirs-old', '2026-05-20T09:00:00.000Z')
    localStorage.setItem(KEY, JSON.stringify([older, ownOld()]))
    quotaThrowsNTimes(1) // the first write fails; dropping the older copy fits
    const result = upsertSharedCopy(copyOf('copy-new', 'theirs-new', '2026-05-21T09:00:00.000Z'))
    expect(result.status).toBe('created')
    const after = loadSessions()
    expect(after.map((s) => s.id).sort()).toEqual(['copy-new', 'own-old'])
    expect(after.find((s) => s.id === 'own-old')!.car_photo).toBe('data:image/jpeg;base64,CAR')
  })

  it("any other write takes shared copies first, before a photo of the driver's own", () => {
    localStorage.setItem(KEY, JSON.stringify([copyOf('copy-1', 'theirs-1', '2026-05-21T09:00:00.000Z'), ownOld()]))
    quotaThrowsNTimes(1) // the first write fails; evicting the copy fits
    const report = saveSession(makeSession({ id: 'fresh' }))
    expect(report).toEqual({ trimmedPhotosFrom: 0, evicted: 1 })
    const after = loadSessions()
    expect(after.find((s) => s.id === 'copy-1')).toBeUndefined()
    expect(after.find((s) => s.id === 'own-old')!.car_photo).toBe('data:image/jpeg;base64,CAR')
  })

  it("a forwarded link's future share time never keeps a later genuine link out", () => {
    const received = '2026-05-21T09:00:00.000Z'
    // Unsigned shared_at edited to 2099 in a forwarded link.
    expect(upsertSharedCopy(copyOf('copy-1', 'theirs', received, '2099-01-01T00:00:00.000Z')).status).toBe('created')
    // The sender's genuine link, opened later: it updates the copy.
    const genuine = copyOf('copy-2', 'theirs', '2026-05-21T10:00:00.000Z', '2026-05-21T09:55:00.000Z')
    const result = upsertSharedCopy(genuine)
    expect(result.status).toBe('updated')
    expect(result.record.id).toBe('copy-1')
    expect(result.record.shared_from!.shared_at).toBe('2026-05-21T09:55:00.000Z')
  })

  it('still keeps the copy from a later link when an earlier link is opened again', () => {
    expect(upsertSharedCopy(copyOf('copy-1', 'theirs', '2026-05-21T10:00:00.000Z', '2026-05-21T09:55:00.000Z')).status).toBe('created')
    // A share time a little ahead of its receive time (phone clock drift) still counts.
    const drift = new Date(Date.parse('2026-05-21T10:30:00.000Z') + SHARED_AT_SKEW_MS).toISOString()
    expect(upsertSharedCopy(copyOf('copy-2', 'theirs', '2026-05-21T10:30:00.000Z', drift)).status).toBe('updated')
    const earlier = copyOf('copy-3', 'theirs', '2026-05-21T11:00:00.000Z', '2026-05-21T09:00:00.000Z')
    expect(upsertSharedCopy(earlier).status).toBe('kept_newer')
    expect(loadSessions()[0].shared_from!.shared_at).toBe(drift)
  })
})

describe('isActiveRecord', () => {
  it('is true for exactly the records loadActiveSessions lists', () => {
    const hour = 60 * 60 * 1000
    const at = (ms: number) => new Date(FIXED_NOW + ms).toISOString()
    const records = [
      makeSession({ id: 'live', expires_at: at(hour) }),
      makeSession({ id: 'lapsed', expires_at: at(-11 * hour) }),
      makeSession({ id: 'gone', expires_at: at(-12 * hour) }),
      makeSession({ id: 'ended', expires_at: at(hour), ended_at: at(-60_000) }),
      makeSession({ id: 'noSign', expires_at: null, no_sign: true }),
      makeSession({ id: 'noLimit', expires_at: null }),
      makeSession({
        id: 'copy',
        expires_at: at(hour),
        shared_from: { original_session_id: 'x', received_at: at(0), shared_at: null, arrival_bundle: null, snapshot: {} },
      }),
    ]
    localStorage.setItem(KEY, JSON.stringify(records))
    const active = new Set(loadActiveSessions(FIXED_NOW).map((s) => s.id))
    expect([...active].sort()).toEqual(['lapsed', 'live', 'noSign'])
    for (const r of records) expect(isActiveRecord(r, FIXED_NOW)).toBe(active.has(r.id))
  })
})
