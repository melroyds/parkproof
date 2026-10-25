import type { ParkingSession } from '../types'

const KEY = 'parkproof.sessions.v1'

/**
 * Fired on `window` after any write to the saved records (save, update,
 * delete, end; later tasks add addendum writes). `useRecordsVersion()`
 * re-renders on it, so screens that show a record pick up background
 * changes such as a signature landing, without navigating away.
 */
export const RECORDS_CHANGED_EVENT = 'parkproof:records-changed'

/**
 * How long an expiry-bearing record stays on the home screen after its
 * expiry when the driver hasn't tapped "I've left". Long enough to cover a
 * driver who comes back late; short enough that a forgotten record doesn't
 * sit on home for days.
 */
export const ACTIVE_AFTER_EXPIRY_MS = 12 * 60 * 60 * 1000

let recordsRevision = 0
let crossTabListenerInstalled = false

/** Monotonic counter, bumped on every records-changed notification. */
export function getRecordsRevision(): number {
  return recordsRevision
}

/**
 * Tell every listener the saved records changed. `id` is the record that
 * changed, or null when several did (or it isn't known). Never throws.
 */
export function notifyRecordsChanged(id: string | null = null): void {
  recordsRevision++
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent(RECORDS_CHANGED_EVENT, { detail: { id } }))
  } catch {
    /* a listener threw, or CustomEvent is missing: the revision bump still stands */
  }
}

/**
 * Subscribe to records-changed notifications. Also forwards writes made by
 * another tab of the app (the browser's `storage` event), so two open tabs
 * stay in step. Returns the unsubscribe function.
 */
export function subscribeRecordsChanged(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {}
  }
  if (!crossTabListenerInstalled) {
    crossTabListenerInstalled = true
    window.addEventListener('storage', (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) notifyRecordsChanged()
    })
  }
  window.addEventListener(RECORDS_CHANGED_EVENT, listener)
  return () => window.removeEventListener(RECORDS_CHANGED_EVENT, listener)
}

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

/** Error code on a StorageFullError. App maps it to `errors.storageFull`. */
export const ERR_STORAGE_FULL = 'ERR_STORAGE_FULL'

/**
 * Thrown when a write can't fit even after quota recovery released everything
 * it safely could. The message is English for logs only; screens show
 * `t('errors.storageFull')` instead (see `isStorageFullError`).
 */
export class StorageFullError extends Error {
  readonly code = ERR_STORAGE_FULL
  constructor() {
    super(
      'Device storage is full. Current records and records still waiting for a signature were kept, and nothing else could be removed safely.',
    )
    this.name = 'StorageFullError'
  }
}

/** True for the storage-full error, however it was constructed. */
export function isStorageFullError(err: unknown): boolean {
  return (
    err instanceof StorageFullError ||
    (!!err && typeof err === 'object' && (err as { code?: unknown }).code === ERR_STORAGE_FULL)
  )
}

export interface QuotaRecoveryReport {
  /** Number of expired records we stripped photos from (kept metadata). */
  trimmedPhotosFrom: number
  /** Number of expired records we removed entirely as a last resort. */
  evicted: number
}

/**
 * Structural view of the evidence-chain addenda added in a later task
 * (`SignedAddendum` in types.ts). Read here only to decide whether a record
 * still has signing work outstanding.
 */
type WithAddenda = {
  addenda?: Array<{ bundle?: unknown; rejected?: unknown } | null | undefined>
}

/**
 * True while a record still has evidence that hasn't been signed: no
 * arrival signature yet, or an addendum that is neither signed nor rejected.
 * Quota recovery never strips photos from such a record or evicts it,
 * because the photo bytes are what the pending signature commits to.
 */
export function hasUnsignedEvidence(session: ParkingSession): boolean {
  if (!session.signature) return true
  const addenda = (session as ParkingSession & WithAddenda).addenda
  if (!Array.isArray(addenda)) return false
  return addenda.some((a) => !!a && !a.bundle && !a.rejected)
}

/**
 * Try to write `sessions` to localStorage, recovering from quota errors by
 * progressively releasing space taken by *expired* records:
 *   1. Strip car_photo from the oldest expired record(s) until we fit.
 *      Photos are the bulk of each record (~200KB resized) so even one strip
 *      can free a quarter of the budget.
 *   2. Strip sign_photo and ambient_photo too. The record is now
 *      metadata-only, still usable as a written record but without photos.
 *   3. As a last resort, evict the oldest expired record entirely.
 *
 * Never touched:
 *   - any record still on the home screen: not ended and either expiring in
 *     the future, expired less than ACTIVE_AFTER_EXPIRY_MS ago (its card
 *     still asks "I've left", and it's the record a driver most needs if a
 *     fine arrives), or open-ended with no expiry
 *   - any record whose evidence isn't fully signed (`hasUnsignedEvidence`)
 *
 * Victims are tracked by id, never by array index, so evicting one record
 * can't shift the next victim onto a different (possibly active) record.
 *
 * Returns a report describing what was done, so the caller can tell the user.
 */
function persistWithQuotaRecovery(
  input: ParkingSession[],
  now: number = Date.now(),
): QuotaRecoveryReport {
  let sessions = input
  const trimmed = new Set<string>()
  let evicted = 0
  const report = (): QuotaRecoveryReport => ({ trimmedPhotosFrom: trimmed.size, evicted })

  const tryWrite = (): boolean => {
    try {
      localStorage.setItem(KEY, JSON.stringify(sessions))
      return true
    } catch (err) {
      if (!isQuotaError(err)) throw err
      return false
    }
  }

  // First attempt: most writes succeed here.
  if (tryWrite()) return report()

  // Oldest-first list of records to pick victims from. A record is eligible
  // once it has left the home screen: ended_at is set (the driver signalled
  // they've left), or it expired at least ACTIVE_AFTER_EXPIRY_MS ago (the
  // same window loadActiveSessions uses). The sort key falls back to
  // arrived_at when neither timestamp is available, so the oldest record
  // always goes first.
  const tombstoneTime = (s: ParkingSession): number => {
    if (s.ended_at) return new Date(s.ended_at).getTime()
    if (s.expires_at) return new Date(s.expires_at).getTime()
    return new Date(s.arrived_at).getTime()
  }
  const isOffHome = (s: ParkingSession): boolean => {
    if (s.ended_at) return true
    if (!s.expires_at) return false
    const ms = new Date(s.expires_at).getTime()
    return Number.isFinite(ms) && ms + ACTIVE_AFTER_EXPIRY_MS <= now
  }
  const victimIds = sessions
    .filter((s) => isOffHome(s) && !hasUnsignedEvidence(s))
    .sort((a, b) => tombstoneTime(a) - tombstoneTime(b))
    .map((s) => s.id)

  const patchById = (id: string, patch: Partial<ParkingSession>) => {
    sessions = sessions.map((s) => (s.id === id ? { ...s, ...patch } : s))
  }
  const byId = (id: string) => sessions.find((s) => s.id === id)

  // Phase 1: strip car_photo (the user-supplied second photo).
  for (const id of victimIds) {
    if (!byId(id)?.car_photo) continue
    patchById(id, { car_photo: null })
    trimmed.add(id)
    if (tryWrite()) return report()
  }

  // Phase 2: strip sign_photo and ambient_photo (the last photos; the
  // metadata, coords, timestamps and signature are kept).
  for (const id of victimIds) {
    const s = byId(id)
    if (!s || (!s.sign_photo && !s.ambient_photo)) continue
    const patch: Partial<ParkingSession> = {}
    if (s.sign_photo) patch.sign_photo = ''
    if (s.ambient_photo) patch.ambient_photo = null
    patchById(id, patch)
    trimmed.add(id)
    if (tryWrite()) return report()
  }

  // Phase 3: evict whole records, oldest first.
  for (const id of victimIds) {
    sessions = sessions.filter((s) => s.id !== id)
    // An evicted record is counted once, as evicted, not also as trimmed.
    trimmed.delete(id)
    evicted++
    if (tryWrite()) return report()
  }

  // Genuinely full: even with every eligible record gone we can't fit.
  // Records still on home and records still waiting for a signature are kept.
  throw new StorageFullError()
}

export function saveSession(session: ParkingSession): QuotaRecoveryReport {
  const sessions = loadSessions()
  sessions.unshift(session)
  const report = persistWithQuotaRecovery(sessions)
  notifyRecordsChanged(session.id)
  return report
}

export function deleteSession(id: string): void {
  const sessions = loadSessions().filter((s) => s.id !== id)
  localStorage.setItem(KEY, JSON.stringify(sessions))
  notifyRecordsChanged(id)
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
  const report = persistWithQuotaRecovery(sessions)
  notifyRecordsChanged(id)
  return report
}

export function getSession(id: string): ParkingSession | undefined {
  return loadSessions().find((s) => s.id === id)
}

/**
 * Records that are currently in progress, i.e. shown on the home screen.
 * Three groups, in this order (App shows the first as the main card):
 *   1. Live: `expires_at` still ahead, soonest expiry first. A live
 *      countdown always wins the main card.
 *   2. Open-ended: no-sign records with no expiry, most recent arrival first.
 *   3. Lapsed: `expires_at` passed less than ACTIVE_AFTER_EXPIRY_MS ago,
 *      most recently expired first. Most drivers move the car without
 *      tapping "I've left", so a lapsed record usually describes a car that
 *      has already gone. It waits behind "+N more" until nothing is live,
 *      then its card asks "I've left".
 *
 * In every group an explicit `ended_at` excludes the record: the driver has
 * signalled they've left.
 */
export function loadActiveSessions(now: number = Date.now()): ParkingSession[] {
  const all = loadSessions().filter((s) => !s.ended_at)
  const expiryMs = (s: ParkingSession): number =>
    s.expires_at ? new Date(s.expires_at).getTime() : NaN
  const live = all
    .filter((s) => {
      const ms = expiryMs(s)
      return Number.isFinite(ms) && ms > now
    })
    .sort((a, b) => expiryMs(a) - expiryMs(b))
  const lapsed = all
    .filter((s) => {
      const ms = expiryMs(s)
      return Number.isFinite(ms) && ms <= now && ms + ACTIVE_AFTER_EXPIRY_MS > now
    })
    .sort((a, b) => expiryMs(b) - expiryMs(a))
  const openEnded = all
    .filter((s) => !s.expires_at && s.no_sign)
    .sort(
      (a, b) =>
        new Date(b.arrived_at).getTime() - new Date(a.arrived_at).getTime(),
    )
  return [...live, ...openEnded, ...lapsed]
}

/**
 * Mark a session as ended. Sets `ended_at` to the supplied timestamp (default
 * now) and persists. Returns the same QuotaRecoveryReport shape as
 * `updateSession` since this is a thin wrapper over it — quota errors are
 * extremely unlikely here (a 24-byte field) but the report is uniform.
 *
 * Only App.handleEndSession calls this, so the cloud mirror and reminder
 * cancels always run with it.
 */
export function endSession(id: string, when: Date = new Date()): QuotaRecoveryReport {
  return updateSession(id, { ended_at: when.toISOString() })
}
