// @vitest-environment happy-dom
//
// storage — localStorage CRUD + 3-phase quota recovery + endSession +
// loadActiveSessions. Skeleton — fill in tomorrow.
//
// The 3-phase recovery is the most important code in this file to test:
// it's the kind of logic that only fires on a full localStorage, only
// matters when the user is mid-flow, and produces no error in unit-less
// dev environments. A regression here = "I logged my park but it didn't
// save and I didn't know" — the worst-case ParkProof failure mode.

import { beforeEach, describe, it } from 'vitest'

beforeEach(() => {
  localStorage.clear()
})

describe('loadSessions / saveSession / deleteSession', () => {
  it.todo('returns [] when the storage key has never been set')
  it.todo('returns [] on JSON parse failure (corrupt localStorage)')
  it.todo('saveSession unshifts (newest first)')
  it.todo('deleteSession removes by id and persists immediately')
  it.todo('deleteSession on a non-existent id is a no-op (no throw)')
})

describe('updateSession (partial patch)', () => {
  it.todo('updates only the supplied fields, preserves the rest')
  it.todo('no-op when id is not found — returns a zero-cost report')
  it.todo('survives the patch going through quota recovery (rare)')
})

describe('endSession helper', () => {
  it.todo('sets ended_at to an ISO timestamp')
  it.todo('uses the supplied `when` Date when provided, falls back to new Date() otherwise')
  it.todo('does not mutate any other field')
})

describe('loadActiveSessions', () => {
  it.todo('excludes any session with ended_at set')
  it.todo('includes future-expiry sessions sorted soonest-first')
  it.todo('includes no_sign sessions without ended_at, after expiry-bearing ones')
  it.todo('excludes past-expiry sessions (auto-fall-off)')
  it.todo('open-ended sessions sorted by arrived_at descending (most recent first)')
  it.todo('handles a mix correctly — expiry-bearing first by urgency, then no-sign by recency')
})

describe('persistWithQuotaRecovery — 3-phase eviction', () => {
  it.todo('Phase 0: clean write — no recovery needed when under quota')
  it.todo('Phase 1: strips car_photo from oldest expired session(s), in oldest-first order')
  it.todo('Phase 2: strips sign_photo (after car_photo exhausted) — session keeps metadata')
  it.todo('Phase 3: evicts entire sessions, oldest first')
  it.todo('reports trimmedPhotosFrom + evicted counts truthfully')
  it.todo('NEVER touches active sessions (expires_at > now OR no_sign without ended_at)')
  it.todo('treats ended_at sessions as victim-eligible (same as past-expiry)')
  it.todo('throws a friendly error when even full eviction cannot fit')
})
