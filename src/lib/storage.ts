import type {
  AddendumKind,
  DriverProfile,
  Jurisdiction,
  ParkingSession,
  RecurringRule,
  SignatureBundle,
  SignedAddendum,
  WorkdayState,
  WorkdayStatus,
} from '../types'
import {
  AddendumValidationError,
  ERR,
  UUID_RE,
  isIsoTime,
  normalizeAddendumData,
} from '../../lambda/addendum-schema.js'
import {
  MAX_ADDENDA,
  SINGLETON_KINDS,
  compactPendingSeqs,
  nextAddendumSeq,
  signedAddendumIdentity,
} from './evidence-chain'
import { mergeEvidence, sameEvidence } from './evidence-merge'
import { deleteSessionPhotos } from './photo-store'
import { isWorkdayJurisdiction } from './jurisdiction'
import { changesCalendar, normalizeRecurringRule } from './recurring'
import { PROFILE_KEY, emptyProfile, normalizeProfile } from './profile'

const KEY = 'parkproof.sessions.v1'

/** Workday mode's state (T6a). See the workday section at the end of this file. */
export const WORKDAY_KEY = 'parkproof.workday.v1'

/**
 * Fired on `window` after any write to the saved records (save, update,
 * delete, end, and the evidence-chain writes: appendAddendum,
 * setAddendumBundle, rejectAddendum, setArrivalSignature, and the cloud merge
 * mergeCloudEvidence), and after any write to the workday state
 * (startWorkday, setWorkdayLeg, markWorkdayMoving, endWorkday). `useRecordsVersion()`
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

/** The records named by `scheduleRecordsChanged` calls not yet notified, or null when none is queued. */
let queuedChanges: Set<string | null> | null = null

/**
 * `notifyRecordsChanged` for bulk writes, such as records landing from a
 * cloud pull (field-test fix list, item 6): every call made in one
 * synchronous run becomes ONE notification on the next microtask, so a pull
 * of 50 records re-renders the screens once, not 50 times. The notification
 * names the record when only one changed, else null. Never throws.
 */
export function scheduleRecordsChanged(id: string | null = null): void {
  if (queuedChanges) {
    queuedChanges.add(id)
    return
  }
  queuedChanges = new Set([id])
  queueMicrotask(flushQueuedRecordsChanged)
}

function flushQueuedRecordsChanged(): void {
  const ids = queuedChanges
  queuedChanges = null
  if (!ids) return
  const [only] = ids
  notifyRecordsChanged(ids.size === 1 ? only : null)
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
      if (e.key === KEY || e.key === WORKDAY_KEY || e.key === null) notifyRecordsChanged()
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

/**
 * The id of every saved record, for the photo store's startup GC. Strict,
 * unlike `loadSessions` (which reads "couldn't read" as "no records"):
 * null when the records can't be read right now (localStorage threw, the
 * JSON doesn't parse, or it isn't a list), so the GC never mistakes an
 * unreadable list for an empty one and deletes every photo on the device.
 * [] only when nothing has been saved. Entries without a string id are
 * skipped (no photo can be stored under them).
 */
export function loadSessionIdsForGc(): string[] | null {
  let raw: string | null
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return null
  }
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const ids: string[] = []
  for (const s of parsed) {
    const id = s && typeof s === 'object' ? (s as { id?: unknown }).id : undefined
    if (typeof id === 'string') ids.push(id)
  }
  return ids
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

/** Error code on a DuplicateRecordError. */
export const ERR_DUPLICATE_RECORD = 'ERR_DUPLICATE_RECORD'

/**
 * Thrown by `saveSession` when a record with the same id is already saved.
 * The logger mints the record id when it opens (its photos are stored under
 * it), so a second save of the same logger would otherwise store the record
 * twice. Nothing is written.
 */
export class DuplicateRecordError extends Error {
  readonly code = ERR_DUPLICATE_RECORD
  readonly id: string
  constructor(id: string) {
    super(`A record with id ${id} is already saved.`)
    this.name = 'DuplicateRecordError'
    this.id = id
  }
}

/** True for the duplicate-record error, however it was constructed. */
export function isDuplicateRecordError(err: unknown): boolean {
  return (
    err instanceof DuplicateRecordError ||
    (!!err && typeof err === 'object' && (err as { code?: unknown }).code === ERR_DUPLICATE_RECORD)
  )
}

/**
 * Delete a record's photo-store photos in the background, after the record
 * itself is gone (deleted, or evicted by quota recovery). Never throws; a
 * failure leaves orphans that the startup sweep removes later.
 */
function releaseRecordPhotos(id: string): void {
  void deleteSessionPhotos(id).catch((err) => {
    console.warn(`[storage] could not delete the photos of ${id}:`, err)
  })
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
 * Fired on `window` (detail: the QuotaRecoveryReport) whenever a write only
 * fitted after quota recovery stripped photos from or deleted older
 * records. Any write can trigger it, including the background evidence
 * chain writes, so App listens once and tells the driver
 * (`errors.storageEvicted` / `errors.storageRecovered`) instead of each
 * caller having to.
 */
export const STORAGE_RECOVERED_EVENT = 'parkproof:storage-recovered'

function notifyStorageRecovered(report: QuotaRecoveryReport): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent(STORAGE_RECOVERED_EVENT, { detail: { ...report } }))
  } catch {
    /* a listener threw, or CustomEvent is missing: the write itself stands */
  }
}

/** Subscribe to storage-recovered notifications. Returns the unsubscribe function. */
export function subscribeStorageRecovered(listener: (report: QuotaRecoveryReport) => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {}
  }
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<QuotaRecoveryReport>).detail
    if (detail && typeof detail === 'object') listener(detail)
  }
  window.addEventListener(STORAGE_RECOVERED_EVENT, handler)
  return () => window.removeEventListener(STORAGE_RECOVERED_EVENT, handler)
}

/**
 * True while a record still has evidence that hasn't been signed: no
 * arrival signature yet, or an addendum that is neither signed nor rejected.
 * Quota recovery never strips photos from such a record or evicts it,
 * because the photo bytes are what the pending signature commits to.
 */
export function hasUnsignedEvidence(session: ParkingSession): boolean {
  if (!session.signature) return true
  const addenda = session.addenda
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
 * An evicted record's photo-store photos are deleted too, once the write
 * that dropped it has succeeded. Phases 1 and 2 only strip the legacy
 * photo fields: photo-store bytes don't count against localStorage.
 *
 * Returns a report describing what was done. When anything was stripped or
 * evicted it also fires STORAGE_RECOVERED_EVENT, so the driver is told even
 * when the write happened in the background.
 */
function persistWithQuotaRecovery(
  input: ParkingSession[],
  now: number = Date.now(),
): QuotaRecoveryReport {
  let sessions = input
  const trimmed = new Set<string>()
  let evicted = 0
  const report = (): QuotaRecoveryReport => ({ trimmedPhotosFrom: trimmed.size, evicted })
  // Every return after the first attempt has freed something.
  const recovered = (): QuotaRecoveryReport => {
    const r = report()
    notifyStorageRecovered(r)
    return r
  }

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
    if (tryWrite()) return recovered()
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
    if (tryWrite()) return recovered()
  }

  // Phase 3: evict whole records, oldest first.
  const evictedIds: string[] = []
  for (const id of victimIds) {
    sessions = sessions.filter((s) => s.id !== id)
    // An evicted record is counted once, as evicted, not also as trimmed.
    trimmed.delete(id)
    evicted++
    evictedIds.push(id)
    if (tryWrite()) {
      for (const gone of evictedIds) releaseRecordPhotos(gone)
      return recovered()
    }
  }

  // Genuinely full: even with every eligible record gone we can't fit.
  // Records still on home and records still waiting for a signature are kept.
  throw new StorageFullError()
}

/**
 * Save a new record (newest first). Refuses a record whose id is already
 * saved: throws DuplicateRecordError and writes nothing.
 */
export function saveSession(session: ParkingSession): QuotaRecoveryReport {
  const sessions = loadSessions()
  if (sessions.some((s) => s.id === session.id)) throw new DuplicateRecordError(session.id)
  sessions.unshift(session)
  const report = persistWithQuotaRecovery(sessions)
  notifyRecordsChanged(session.id)
  return report
}

/** Delete a record, and its photo-store photos in the background. */
export function deleteSession(id: string): void {
  const sessions = loadSessions().filter((s) => s.id !== id)
  localStorage.setItem(KEY, JSON.stringify(sessions))
  notifyRecordsChanged(id)
  releaseRecordPhotos(id)
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

// ─── Evidence chain writes (build spec N2) ────────────────────────────────
// Every write below re-reads the stored records first, so a caller's stale
// copy can never decide a seq or overwrite a bundle. Each successful write
// dispatches records-changed for the record.

export interface AppendAddendumInput {
  kind: AddendumKind
  /** Normalised here with the shared schema; invalid data throws. */
  data: unknown
  /** Client ISO time; defaults to now. Frozen once stored. */
  captured_at?: string
  /** uuid; defaults to a fresh one. */
  id?: string
}

/**
 * Append a pending addendum to a record. The data is normalised with
 * `normalizeAddendumData` (so the stored copy is the copy that will be
 * signed) and the seq is assigned here from a fresh read: one more than the
 * highest seq that isn't rejected.
 *
 * Returns the stored addendum; for `arrival_context` and `departure`, which
 * a record has at most one of, the existing one when there already is one.
 * Returns null when the record is missing, is a read-only shared copy, or
 * already holds MAX_ADDENDA. Throws AddendumValidationError for data that
 * doesn't fit the schema, and StorageFullError when storage is full.
 */
export function appendAddendum(sessionId: string, input: AppendAddendumInput): SignedAddendum | null {
  const data = normalizeAddendumData(input.kind, input.data)
  const captured_at = input.captured_at ?? new Date().toISOString()
  if (!isIsoTime(captured_at)) throw new AddendumValidationError(ERR.BAD_TIME, 'captured_at')
  const id = input.id ?? crypto.randomUUID()
  if (!UUID_RE.test(id)) throw new AddendumValidationError(ERR.BAD_VALUE, 'addendum_id')

  const sessions = loadSessions()
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) return null
  const session = sessions[idx]
  if (session.shared_from) return null
  const addenda = session.addenda ?? []
  if (SINGLETON_KINDS.has(input.kind)) {
    const existing = addenda.find((a) => a.kind === input.kind)
    if (existing) return existing
  }
  if (addenda.some((a) => a.id === id)) return null
  if (addenda.length >= MAX_ADDENDA) return null

  const addendum: SignedAddendum = {
    id,
    seq: nextAddendumSeq(addenda),
    kind: input.kind,
    captured_at,
    data,
  }
  sessions[idx] = { ...session, addenda: [...addenda, addendum] }
  persistWithQuotaRecovery(sessions)
  notifyRecordsChanged(sessionId)
  return addendum
}

/**
 * Store the signature bundle for a pending addendum. First write wins:
 * returns false (and changes nothing) when the addendum is missing, already
 * has a bundle, was rejected, or the bundle signs a different addendum id
 * or seq than the one stored.
 */
export function setAddendumBundle(sessionId: string, addendumId: string, bundle: SignatureBundle): boolean {
  const sessions = loadSessions()
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) return false
  const addenda = sessions[idx].addenda ?? []
  const target = addenda.find((a) => a.id === addendumId)
  if (!target || target.bundle || target.rejected) return false
  const signed = signedAddendumIdentity(bundle)
  if (!signed || signed.addendum_id !== addendumId || signed.seq !== target.seq) return false
  sessions[idx] = {
    ...sessions[idx],
    addenda: addenda.map((a) => (a.id === addendumId ? { ...a, bundle } : a)),
  }
  persistWithQuotaRecovery(sessions)
  notifyRecordsChanged(sessionId)
  return true
}

/**
 * Mark a pending addendum rejected (the server answered 400 with `code`).
 * It is never retried. The pending addenda after it are renumbered so the
 * next one's parent is the last signed link. Returns false when the
 * addendum is missing, signed, or already rejected.
 */
export function rejectAddendum(
  sessionId: string,
  addendumId: string,
  code: string,
  at: string = new Date().toISOString(),
): boolean {
  const sessions = loadSessions()
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) return false
  const addenda = sessions[idx].addenda ?? []
  const target = addenda.find((a) => a.id === addendumId)
  if (!target || target.bundle || target.rejected) return false
  const marked = addenda.map((a) => (a.id === addendumId ? { ...a, rejected: { code, at } } : a))
  sessions[idx] = { ...sessions[idx], addenda: compactPendingSeqs(marked) }
  persistWithQuotaRecovery(sessions)
  notifyRecordsChanged(sessionId)
  return true
}

/**
 * Merge the cloud copy's evidence into a saved record (`mergeEvidence`,
 * T0b4): links signed on another device, a link 0 or an end this device
 * didn't have, more photo refs. Reads the record fresh and writes in the
 * same synchronous step, so a signature stored meanwhile is never lost.
 * Pending addenda are renumbered to follow the highest signed link; a drain
 * that was signing one of them at the old seq finds its bundle refused by
 * `setAddendumBundle` (the seq differs) and signs it again at the new one.
 *
 * Returns the stored record (unchanged when the cloud had nothing new), or
 * null when the record isn't saved here. Can throw StorageFullError.
 */
export function mergeCloudEvidence(sessionId: string, cloud: ParkingSession): ParkingSession | null {
  const sessions = loadSessions()
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1) return null
  const local = sessions[idx]
  const merged = mergeEvidence(local, cloud)
  if (sameEvidence(local, merged)) return local
  sessions[idx] = merged
  persistWithQuotaRecovery(sessions)
  notifyRecordsChanged(sessionId)
  return merged
}

/**
 * Store a record's arrival bundle (link 0). First write wins: returns false
 * when the record is missing or already signed.
 */
export function setArrivalSignature(sessionId: string, bundle: SignatureBundle): boolean {
  const sessions = loadSessions()
  const idx = sessions.findIndex((s) => s.id === sessionId)
  if (idx === -1 || sessions[idx].signature) return false
  sessions[idx] = { ...sessions[idx], signature: bundle }
  persistWithQuotaRecovery(sessions)
  notifyRecordsChanged(sessionId)
  return true
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

// ─── Workday mode (build spec T6a) ────────────────────────────────────────
// The workday state lives under WORKDAY_KEY, on this device only (it is
// never synced; the legs are ordinary records carrying workday_id and
// leg_index, and those sync). The key holds a list, newest first: every
// workday that hasn't ended plus up to MAX_ENDED_WORKDAYS ended ones. At most
// one workday is active (status other than 'ended'): startWorkday refuses
// while one is. Every write re-reads the list first and dispatches
// records-changed, so the home screen follows a workday changed in the
// background or in another tab.

/** Ended workdays kept on the device, newest first. Active ones are never dropped. */
export const MAX_ENDED_WORKDAYS = 30

/** startWorkday: a workday is already active. */
export const ERR_WORKDAY_ACTIVE = 'ERR_WORKDAY_ACTIVE'
/** startWorkday: workday mode isn't available in that jurisdiction (only VIC and QLD). */
export const ERR_WORKDAY_JURISDICTION = 'ERR_WORKDAY_JURISDICTION'

export type WorkdayErrorCode = typeof ERR_WORKDAY_ACTIVE | typeof ERR_WORKDAY_JURISDICTION

/** Thrown by startWorkday. Nothing is written. The message is English for logs only. */
export class WorkdayError extends Error {
  readonly code: WorkdayErrorCode
  constructor(code: WorkdayErrorCode, message: string) {
    super(message)
    this.name = 'WorkdayError'
    this.code = code
  }
}

const WORKDAY_STATUSES: readonly WorkdayStatus[] = ['parked', 'between_moves', 'ended']

const isTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const isIdOrNull = (v: unknown): v is string | null => v === null || (typeof v === 'string' && v.length > 0)

/**
 * A stored workday that can be trusted. Anything else is dropped on read,
 * including a workday in a jurisdiction where workday mode isn't available.
 */
function isWorkdayState(v: unknown): v is WorkdayState {
  if (!v || typeof v !== 'object') return false
  const w = v as Record<string, unknown>
  if (typeof w.id !== 'string' || !UUID_RE.test(w.id)) return false
  if (!isTime(w.started_at)) return false
  if (!isWorkdayJurisdiction(w.jurisdiction as Jurisdiction)) return false
  if (!WORKDAY_STATUSES.includes(w.status as WorkdayStatus)) return false
  if (!isIdOrNull(w.current_session_id) || !isIdOrNull(w.previous_session_id)) return false
  if (w.status === 'ended') return isTime(w.ended_at)
  return w.ended_at === null
}

const byStartedDesc = (a: WorkdayState, b: WorkdayState): number =>
  Date.parse(b.started_at) - Date.parse(a.started_at)

/** Every stored workday that reads cleanly, newest first. [] when none or unreadable. */
export function loadWorkdays(): WorkdayState[] {
  try {
    const raw = localStorage.getItem(WORKDAY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isWorkdayState).sort(byStartedDesc)
  } catch {
    return []
  }
}

/**
 * The active workday (status 'parked' or 'between_moves'), or null. Should
 * two ever be stored (two tabs starting one at the same moment), the most
 * recently started one is the active one.
 */
export function getActiveWorkday(): WorkdayState | null {
  return loadWorkdays().find((w) => w.status !== 'ended') ?? null
}

export function getWorkday(id: string): WorkdayState | null {
  return loadWorkdays().find((w) => w.id === id) ?? null
}

function persistWorkdays(list: WorkdayState[]): void {
  const sorted = [...list].sort(byStartedDesc)
  const active = sorted.filter((w) => w.status !== 'ended')
  const ended = sorted.filter((w) => w.status === 'ended').slice(0, MAX_ENDED_WORKDAYS)
  const kept = [...active, ...ended].sort(byStartedDesc)
  try {
    localStorage.setItem(WORKDAY_KEY, JSON.stringify(kept))
  } catch (err) {
    if (isQuotaError(err)) throw new StorageFullError()
    throw err
  }
  notifyRecordsChanged(null)
}

/**
 * Apply `change` to one stored workday and save it. Returns the workday as
 * stored afterwards (unchanged when `change` returned it as it was, and
 * then nothing is written), or null when it isn't stored.
 */
function writeWorkday(id: string, change: (w: WorkdayState) => WorkdayState): WorkdayState | null {
  const list = loadWorkdays()
  const idx = list.findIndex((w) => w.id === id)
  if (idx === -1) return null
  const next = change(list[idx])
  if (next === list[idx]) return next
  list[idx] = next
  persistWorkdays(list)
  return next
}

export interface StartWorkdayInput {
  /** From the start fix's `place.state_code` (jurisdiction.ts). Only VIC and QLD can start one. */
  jurisdiction: Jurisdiction | null
  /**
   * The record that becomes leg 0 when the car is already parked ("Use the
   * car's current park as the first stop"). The workday starts 'parked' on
   * it. Without one it starts 'between_moves': the next scan makes leg 0.
   */
  current_session_id?: string | null
  /** Phone time of the Start tap; defaults to now. */
  now?: Date
  /** Lower-case uuid; defaults to a fresh one. */
  id?: string
}

/**
 * Start a workday. Throws WorkdayError (and writes nothing) when a workday
 * is already active (ERR_WORKDAY_ACTIVE) or the jurisdiction isn't one
 * where workday mode is available (ERR_WORKDAY_JURISDICTION; the start
 * screen gates on it first, this is the backstop). Can throw
 * StorageFullError.
 */
export function startWorkday(input: StartWorkdayInput): WorkdayState {
  const jurisdiction = input.jurisdiction
  if (!isWorkdayJurisdiction(jurisdiction)) {
    throw new WorkdayError(ERR_WORKDAY_JURISDICTION, `Workday mode isn't available in ${String(jurisdiction)}.`)
  }
  const list = loadWorkdays()
  const active = list.find((w) => w.status !== 'ended')
  if (active) throw new WorkdayError(ERR_WORKDAY_ACTIVE, `Workday ${active.id} is already active.`)
  const id = input.id ?? crypto.randomUUID()
  if (!UUID_RE.test(id)) throw new Error(`Workday id ${id} is not a lower-case uuid.`)
  const current = input.current_session_id ?? null
  const workday: WorkdayState = {
    id,
    started_at: (input.now ?? new Date()).toISOString(),
    jurisdiction,
    status: current ? 'parked' : 'between_moves',
    current_session_id: current,
    previous_session_id: null,
    ended_at: null,
  }
  persistWorkdays([workday, ...list])
  return workday
}

/**
 * A new leg was saved: it becomes the current leg, the leg it replaced
 * becomes the previous one, and the workday is 'parked'. Passing the
 * current leg again changes nothing and writes nothing, whatever the
 * status: while 'between_moves' the current leg is the one the car just
 * left, so a repeated save of it must not mark the car parked there again.
 * Null when the workday isn't stored or has ended (an ended workday never
 * gains legs).
 */
export function setWorkdayLeg(workdayId: string, sessionId: string): WorkdayState | null {
  const stored = getWorkday(workdayId)
  if (!stored || stored.status === 'ended') return null
  return writeWorkday(workdayId, (w) => {
    if (w.current_session_id === sessionId) return w
    return {
      ...w,
      status: 'parked',
      previous_session_id: w.current_session_id ?? w.previous_session_id,
      current_session_id: sessionId,
    }
  })
}

/**
 * The driver tapped "I'm moving the car now" and the current leg's
 * departure has been recorded: the workday is 'between_moves' until the
 * next leg is saved. `current_session_id` stays on the leg just left (it
 * is the next leg's previous leg). Null when the workday isn't stored, has
 * ended, or has no current leg.
 */
export function markWorkdayMoving(workdayId: string): WorkdayState | null {
  const stored = getWorkday(workdayId)
  if (!stored || stored.status === 'ended' || !stored.current_session_id) return null
  return writeWorkday(workdayId, (w) => (w.status === 'between_moves' ? w : { ...w, status: 'between_moves' }))
}

/**
 * End a workday at `when` (phone time). Ending an ended workday keeps its
 * first ended_at. Null when the workday isn't stored. The caller runs the
 * departure flow for a current leg that hasn't ended first.
 */
export function endWorkday(workdayId: string, when: Date = new Date()): WorkdayState | null {
  return writeWorkday(workdayId, (w) =>
    w.status === 'ended' ? w : { ...w, status: 'ended', ended_at: when.toISOString() },
  )
}

// ─── Street sweeping and weekly reminders (T5a) ──────────────────────────
// Stored apart from the records under their own key, on this device only.
// Every write re-reads the list, keeps it valid (normalizeRecurringRule)
// and fires RECURRING_CHANGED_EVENT, so the home row, the recurring view
// and the in-tab reminders all follow it.

const RECURRING_KEY = 'parkproof.recurring.v1'

/** Fired on `window` after any write to the recurring rules (detail: { id }). */
export const RECURRING_CHANGED_EVENT = 'parkproof:recurring-changed'

let recurringRevision = 0
let recurringCrossTabInstalled = false

/** Monotonic counter, bumped on every recurring-changed notification. */
export function getRecurringRevision(): number {
  return recurringRevision
}

function notifyRecurringChanged(id: string | null): void {
  recurringRevision++
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  try {
    window.dispatchEvent(new CustomEvent(RECURRING_CHANGED_EVENT, { detail: { id } }))
  } catch {
    /* a listener threw: the write itself stands */
  }
}

/**
 * Subscribe to recurring-changed notifications, including writes made in
 * another tab. Returns the unsubscribe function.
 */
export function subscribeRecurringChanged(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => {}
  }
  if (!recurringCrossTabInstalled) {
    recurringCrossTabInstalled = true
    window.addEventListener('storage', (e: StorageEvent) => {
      if (e.key === RECURRING_KEY || e.key === null) notifyRecurringChanged(null)
    })
  }
  window.addEventListener(RECURRING_CHANGED_EVENT, listener)
  return () => window.removeEventListener(RECURRING_CHANGED_EVENT, listener)
}

/**
 * Every saved recurring rule, oldest first. Entries that don't fit the
 * store's shape are skipped rather than failing the whole list; nothing
 * readable gives [].
 */
export function loadRecurringRules(): RecurringRule[] {
  try {
    const raw = localStorage.getItem(RECURRING_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    const out: RecurringRule[] = []
    for (const item of parsed) {
      const rule = normalizeRecurringRule(item)
      if (rule && !out.some((r) => r.id === rule.id)) out.push(rule)
    }
    return out
  } catch {
    return []
  }
}

export function getRecurringRule(id: string): RecurringRule | undefined {
  return loadRecurringRules().find((r) => r.id === id)
}

/**
 * The stored list exactly as written, entries this version can't read
 * included. Writes start from it, so a rule saved by a newer build (a kind
 * or a field this one doesn't know, say from a tab still on an older cached
 * app) survives an edit made here. [] when nothing readable is stored.
 */
function readRawRecurring(): unknown[] {
  try {
    const raw = localStorage.getItem(RECURRING_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const rawRuleId = (item: unknown): unknown =>
  item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined

function writeRecurringRaw(items: unknown[]): void {
  try {
    localStorage.setItem(RECURRING_KEY, JSON.stringify(items))
  } catch (err) {
    if (isQuotaError(err)) throw new StorageFullError()
    throw err
  }
}

/** Thrown when a rule doesn't fit the store's shape (normalizeRecurringRule says no). */
export class InvalidRecurringRuleError extends Error {
  constructor() {
    super('This weekly reminder is missing a day, a time or a date.')
    this.name = 'InvalidRecurringRuleError'
  }
}

/**
 * Create a rule, or replace the saved rule with the same id. Returns what
 * was stored. On a replace, `sequence` comes from the stored copy (never
 * the caller's) and goes up by one when anything the calendar file carries
 * changed, so a re-downloaded calendar file updates the event instead of
 * adding a second one. Pausing, resuming or switching notifications leave
 * it alone. Throws InvalidRecurringRuleError or StorageFullError.
 */
export function saveRecurringRule(input: RecurringRule): RecurringRule {
  const cleaned = normalizeRecurringRule(input)
  if (!cleaned) throw new InvalidRecurringRuleError()
  const prev = loadRecurringRules().find((r) => r.id === cleaned.id)
  const stored: RecurringRule = prev
    ? { ...cleaned, sequence: prev.sequence + (changesCalendar(prev, cleaned) ? 1 : 0) }
    : { ...cleaned, sequence: 0 }
  // Write over the raw list: the rule's own entry keeps any field this
  // version doesn't know, and every other entry is left exactly as it was.
  const raw = readRawRecurring()
  const idx = prev ? raw.findIndex((item) => rawRuleId(item) === stored.id && normalizeRecurringRule(item) !== null) : -1
  if (idx === -1) raw.push(stored)
  else raw[idx] = { ...(raw[idx] as Record<string, unknown>), ...stored }
  writeRecurringRaw(raw)
  notifyRecurringChanged(stored.id)
  return stored
}

/** Pause or resume a rule. Returns the stored rule, or null when it isn't saved. */
export function setRecurringRulePaused(id: string, paused: boolean): RecurringRule | null {
  const current = getRecurringRule(id)
  if (!current) return null
  if (current.paused === paused) return current
  return saveRecurringRule({ ...current, paused })
}

/** Delete a rule. Returns false when it wasn't saved. */
export function deleteRecurringRule(id: string): boolean {
  if (!getRecurringRule(id)) return false
  // Every stored copy of that id goes; entries this version can't read stay.
  writeRecurringRaw(readRawRecurring().filter((item) => rawRuleId(item) !== id))
  notifyRecurringChanged(id)
  return true
}

// ─── Settings: the driver's name and saved permits (T4) ─────────────────

/**
 * The profile saved in Settings: the driver's name and saved permits
 * (src/lib/profile.ts has the shape rules). Stored in this browser only,
 * under `parkproof.profile.v1`, and never synced. Anything unreadable
 * (nothing saved, storage blocked, a damaged value) reads as the empty
 * profile, and a stored value is re-checked on every read, so callers
 * always get a valid profile. Never throws.
 */
export function loadProfile(): DriverProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? normalizeProfile(JSON.parse(raw)) : emptyProfile()
  } catch {
    return emptyProfile()
  }
}

/**
 * Save the Settings profile, shaped by `normalizeProfile` first (name cut to
 * 60, at most 3 valid permits, no area on an accessible permit). Returns
 * what was stored. Throws StorageFullError when the browser's storage is
 * full (records are never cleared to make room for settings), and passes
 * any other storage error on.
 */
export function saveProfile(profile: DriverProfile): DriverProfile {
  const stored = normalizeProfile(profile)
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(stored))
  } catch (err) {
    if (isQuotaError(err)) throw new StorageFullError()
    throw err
  }
  return stored
}
