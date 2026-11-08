import type { AddendumKind, DriverProfile, ParkingSession, SignatureBundle, SignedAddendum } from '../types'
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
import { PROFILE_KEY, emptyProfile, normalizeProfile } from './profile'

const KEY = 'parkproof.sessions.v1'

/**
 * Fired on `window` after any write to the saved records (save, update,
 * delete, end, and the evidence-chain writes: appendAddendum,
 * setAddendumBundle, rejectAddendum, setArrivalSignature, and the cloud merge
 * mergeCloudEvidence). `useRecordsVersion()`
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
