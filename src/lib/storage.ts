import type { ParkingSession } from '../types'

const KEY = 'parkproof.sessions.v1'

export function loadSessions(): ParkingSession[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as ParkingSession[]) : []
  } catch {
    return []
  }
}

function isQuotaError(err: unknown): err is DOMException {
  return (
    err instanceof DOMException &&
    // Different browsers spell it differently. Match all known variants.
    (err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err.code === 22)
  )
}

export interface QuotaRecoveryReport {
  /** Number of expired sessions we stripped photos from (kept metadata). */
  trimmedPhotosFrom: number
  /** Number of expired sessions we removed entirely as a last resort. */
  evicted: number
}

/**
 * Try to write `sessions` to localStorage, recovering from quota errors by
 * progressively releasing space taken by *expired* sessions:
 *   1. Strip car_photo from oldest expired session(s) until we fit. Photos
 *      are the bulk of each session (~200KB resized) so even one strip can
 *      free a quarter of the budget.
 *   2. Strip sign_photo too. Now the session is metadata-only — still
 *      usable as a written record but loses visual evidence.
 *   3. As a last resort, evict the oldest expired session entirely.
 *
 * Active sessions (expires_at > now or expires_at = null) are NEVER touched
 * — those are the ones the user actively needs.
 *
 * Returns a report describing what was done, so the caller can tell the user.
 */
function persistWithQuotaRecovery(
  sessions: ParkingSession[],
  now: number = Date.now(),
): QuotaRecoveryReport {
  const report: QuotaRecoveryReport = { trimmedPhotosFrom: 0, evicted: 0 }

  // First attempt — most writes succeed here.
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions))
    return report
  } catch (err) {
    if (!isQuotaError(err)) throw err
  }

  // Build an oldest-first list of expired sessions to victim-select from.
  // "Expired" = either expires_at is in the past OR ended_at is set (the
  // user explicitly signalled they've left). Sort key falls back to
  // arrived_at when neither timestamp is available, so the oldest record
  // always victim-selects first.
  const tombstoneTime = (s: ParkingSession): number => {
    if (s.ended_at) return new Date(s.ended_at).getTime()
    if (s.expires_at) return new Date(s.expires_at).getTime()
    return new Date(s.arrived_at).getTime()
  }
  const expiredOldestFirst = sessions
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => {
      if (s.ended_at) return true
      if (!s.expires_at) return false
      const ms = new Date(s.expires_at).getTime()
      return Number.isFinite(ms) && ms < now
    })
    .sort((a, b) => tombstoneTime(a.s) - tombstoneTime(b.s))

  // Phase 1: strip car_photo (the user-supplied second photo).
  for (const { idx } of expiredOldestFirst) {
    if (!sessions[idx].car_photo) continue
    sessions[idx] = { ...sessions[idx], car_photo: null }
    report.trimmedPhotosFrom++
    try {
      localStorage.setItem(KEY, JSON.stringify(sessions))
      return report
    } catch (err) {
      if (!isQuotaError(err)) throw err
    }
  }

  // Phase 2: strip sign_photo too (last visual evidence, but the metadata
  // chain — coords, timestamp, signature — is preserved).
  for (const { idx } of expiredOldestFirst) {
    if (!sessions[idx].sign_photo) continue
    sessions[idx] = { ...sessions[idx], sign_photo: '' }
    report.trimmedPhotosFrom++
    try {
      localStorage.setItem(KEY, JSON.stringify(sessions))
      return report
    } catch (err) {
      if (!isQuotaError(err)) throw err
    }
  }

  // Phase 3: evict whole sessions, oldest first.
  for (const { idx } of expiredOldestFirst) {
    sessions.splice(idx, 1)
    report.evicted++
    try {
      localStorage.setItem(KEY, JSON.stringify(sessions))
      return report
    } catch (err) {
      if (!isQuotaError(err)) throw err
    }
  }

  // Genuinely full — even with all expired sessions gone we can't fit.
  // The user must have a single huge active session (or all sessions are
  // active). Surface a friendly error.
  throw new Error(
    'Your device storage is full and no expired sessions are available to clean up. Open History and delete an old session, then try again.',
  )
}

export function saveSession(session: ParkingSession): QuotaRecoveryReport {
  const sessions = loadSessions()
  sessions.unshift(session)
  return persistWithQuotaRecovery(sessions)
}

export function deleteSession(id: string): void {
  const sessions = loadSessions().filter((s) => s.id !== id)
  localStorage.setItem(KEY, JSON.stringify(sessions))
}

/**
 * Patch fields onto an existing session in place. Used for both:
 *   - async signature enrichment (fire-and-forget; caller swallows errors)
 *   - editable note saves (caller should surface failures to the user)
 *
 * Goes through persistWithQuotaRecovery so a quota error during enrichment
 * doesn't silently lose data — but the caller decides whether to surface it.
 */
export function updateSession(id: string, patch: Partial<ParkingSession>): QuotaRecoveryReport {
  const sessions = loadSessions()
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx === -1) return { trimmedPhotosFrom: 0, evicted: 0 }
  sessions[idx] = { ...sessions[idx], ...patch }
  return persistWithQuotaRecovery(sessions)
}

export function getSession(id: string): ParkingSession | undefined {
  return loadSessions().find((s) => s.id === id)
}

/**
 * Sessions that are currently in progress. Three flavours, in priority order:
 *   1. Sessions with `expires_at` still in the future (sorted soonest-first)
 *   2. No-sign sessions with no `ended_at` (open-ended — sorted most-recent
 *      arrival first, placed after expiry-bearing ones)
 *
 * In both cases, an explicit `ended_at` excludes the session — the user has
 * signalled they've left. That's the only way to remove a no-sign session
 * from this list; for expiry-bearing sessions, hitting expires_at also works.
 */
export function loadActiveSessions(now: number = Date.now()): ParkingSession[] {
  const all = loadSessions().filter((s) => !s.ended_at)
  const withExpiry = all
    .filter((s) => {
      if (!s.expires_at) return false
      const ms = new Date(s.expires_at).getTime()
      return Number.isFinite(ms) && ms > now
    })
    .sort(
      (a, b) =>
        new Date(a.expires_at as string).getTime() -
        new Date(b.expires_at as string).getTime(),
    )
  const openEnded = all
    .filter((s) => !s.expires_at && s.no_sign)
    .sort(
      (a, b) =>
        new Date(b.arrived_at).getTime() - new Date(a.arrived_at).getTime(),
    )
  return [...withExpiry, ...openEnded]
}

/**
 * Mark a session as ended. Sets `ended_at` to the supplied timestamp (default
 * now) and persists. Returns the same QuotaRecoveryReport shape as
 * `updateSession` since this is a thin wrapper over it — quota errors are
 * extremely unlikely here (a 24-byte field) but the report is uniform.
 */
export function endSession(id: string, when: Date = new Date()): QuotaRecoveryReport {
  return updateSession(id, { ended_at: when.toISOString() })
}
