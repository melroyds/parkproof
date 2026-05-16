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
  const expiredOldestFirst = sessions
    .map((s, idx) => ({ s, idx }))
    .filter(({ s }) => {
      if (!s.expires_at) return false
      const ms = new Date(s.expires_at).getTime()
      return Number.isFinite(ms) && ms < now
    })
    .sort(
      (a, b) =>
        new Date(a.s.expires_at as string).getTime() -
        new Date(b.s.expires_at as string).getTime(),
    )

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
 * Sessions that are currently in progress — `expires_at` is set and still in
 * the future. Sorted soonest-expiring first so the home-screen card surfaces
 * the most urgent one when (rarely) multiple are open at once.
 *
 * Pure derivation off `expires_at` — no extra schema field — which means a
 * session naturally moves from "active" to "past" the moment its timer
 * elapses, with zero extra bookkeeping.
 */
export function loadActiveSessions(now: number = Date.now()): ParkingSession[] {
  return loadSessions()
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
}
