// A record's photos, however they are held (build spec N4).
//
// Records saved before the photo store keep their sign, car and ambient
// photos in the legacy `sign_photo` / `car_photo` / `ambient_photo` fields
// (a data URL, or an HTTPS URL on a copy pulled from the cloud). New records
// keep every photo's bytes in the photo store and describe each one with a
// PhotoRef in `photos`, leaving the legacy fields null. Every reader goes
// through `getSessionPhoto` / `resolveSessionPhoto` (or the
// `useSessionPhoto` hook) so it never has to know which kind of record it
// has.
import type { ParkingSession, PhotoRef, PhotoRole, SignatureBundle } from '../types'
import { HEX64_RE, PHOTO_ROLES, isIsoTime } from '../../lambda/addendum-schema.js'
import { DEV_KEY_ALIAS } from './evidence-chain'
import { getPhoto, putPhoto } from './photo-store'

export type LegacyPhotoRole = 'sign' | 'car' | 'ambient'
type LegacyPhotoField = 'sign_photo' | 'car_photo' | 'ambient_photo'

/** The roles link 0 signs a hash for, in link-0 order of the v1 hashes. */
export const LEGACY_PHOTO_ROLES: readonly LegacyPhotoRole[] = ['sign', 'car', 'ambient']

const FIELD_BY_ROLE: Record<LegacyPhotoRole, LegacyPhotoField> = {
  sign: 'sign_photo',
  car: 'car_photo',
  ambient: 'ambient_photo',
}

export function isLegacyPhotoRole(role: PhotoRole): role is LegacyPhotoRole {
  return role === 'sign' || role === 'car' || role === 'ambient'
}

/** The legacy record field that held this role's photo. */
export function legacyPhotoField(role: LegacyPhotoRole): LegacyPhotoField {
  return FIELD_BY_ROLE[role]
}

/** When and how a photo came into the app, captured with the file. */
export interface PhotoCaptureMeta {
  /** Client ISO time of the capture. */
  captured_at: string
  source: PhotoRef['source']
}

/**
 * A file older than this when it is picked counts as a library photo, even
 * from the camera input: desktop browsers ignore `capture` and open a file
 * picker.
 */
export const LIBRARY_AGE_MS = 2 * 60_000

/**
 * The PhotoRef source of a picked file (N1): 'library' when it came through
 * the library input, or its `lastModified` is more than LIBRARY_AGE_MS
 * before `now`; 'camera_input' otherwise.
 */
export function photoSourceFor(
  file: { lastModified?: number },
  input: 'camera' | 'library',
  now: number = Date.now(),
): PhotoRef['source'] {
  if (input === 'library') return 'library'
  const modified = file.lastModified
  if (typeof modified === 'number' && Number.isFinite(modified) && modified > 0 && now - modified > LIBRARY_AGE_MS) {
    return 'library'
  }
  return 'camera_input'
}

/** Capture metadata for a file picked now. */
export function captureMetaFor(file: { lastModified?: number }, input: 'camera' | 'library', now: number = Date.now()): PhotoCaptureMeta {
  return { captured_at: new Date(now).toISOString(), source: photoSourceFor(file, input, now) }
}

/**
 * A PhotoRef for stored bytes. An unusable capture time becomes `fallbackNow`
 * (the signed schema needs `YYYY-MM-DDTHH:MM:SS(.sss)Z`).
 */
export function makePhotoRef(
  role: PhotoRole,
  sha256: string,
  meta: PhotoCaptureMeta,
  fallbackNow: number = Date.now(),
): PhotoRef {
  let captured_at = meta.captured_at
  if (!isIsoTime(captured_at)) {
    const ms = Date.parse(captured_at)
    captured_at = new Date(Number.isFinite(ms) ? ms : fallbackNow).toISOString()
  }
  return { role, sha256, captured_at, source: meta.source === 'camera_input' ? 'camera_input' : 'library' }
}

/**
 * How long a photo write may take before it counts as failed. A write
 * normally lands in milliseconds; this bounds WebKit's IndexedDB stalls (an
 * open or a transaction that never settles, for example after the PWA comes
 * back from the camera app), so Save can never hang on one.
 */
export const PHOTO_WRITE_TIMEOUT_MS = 5000

// Every write started for a record that hasn't settled yet, including
// writes that timed out (their bytes can still land later).
const writesInFlight = new Map<string, Set<Promise<void>>>()

function trackWrite(sessionId: string, write: Promise<unknown>): void {
  const settled = write.then(
    () => {},
    () => {},
  )
  let set = writesInFlight.get(sessionId)
  if (!set) {
    set = new Set()
    writesInFlight.set(sessionId, set)
  }
  const owner = set
  owner.add(settled)
  void settled.then(() => {
    owner.delete(settled)
    if (owner.size === 0 && writesInFlight.get(sessionId) === owner) writesInFlight.delete(sessionId)
  })
}

/**
 * Wait until every photo write started for this record has settled,
 * including writes that timed out. Resolves true when it had to wait for
 * at least one, so a caller re-runs its clean-up for bytes that landed
 * late (no PhotoRef refers to them); false at once when none was in flight.
 */
export async function whenPhotoWritesSettle(sessionId: string): Promise<boolean> {
  const set = writesInFlight.get(sessionId)
  if (!set || set.size === 0) return false
  await Promise.all([...set])
  await whenPhotoWritesSettle(sessionId) // any started meanwhile
  return true
}

const TIMED_OUT = Symbol('timed out')

/**
 * Put a captured photo in the photo store and make its PhotoRef. The ref
 * exists only once the bytes are stored: resolves null (and logs) when the
 * write failed or took longer than `timeoutMs`, so the caller treats it as
 * failed (an error on the tile, or the legacy-field fallback). Bytes that
 * land after a timeout have no ref; `whenPhotoWritesSettle` tells the
 * caller when to tidy them away.
 */
export async function storeSessionPhoto(
  sessionId: string,
  role: PhotoRole,
  dataUrl: string,
  meta: PhotoCaptureMeta,
  timeoutMs: number = PHOTO_WRITE_TIMEOUT_MS,
): Promise<PhotoRef | null> {
  const put = putPhoto(sessionId, dataUrl)
  trackWrite(sessionId, put)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs)
  })
  try {
    const outcome = await Promise.race([put, timeout])
    if (outcome === TIMED_OUT) {
      console.warn(`[photos] storing the ${role} photo took longer than ${timeoutMs} ms; treated as failed`)
      return null
    }
    return makePhotoRef(role, outcome, meta)
  } catch (err) {
    console.warn(`[photos] could not store the ${role} photo:`, err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

function isPhotoRef(p: unknown): p is PhotoRef {
  if (!p || typeof p !== 'object') return false
  const r = p as Record<string, unknown>
  return typeof r.role === 'string' && PHOTO_ROLES.includes(r.role) && typeof r.sha256 === 'string' && HEX64_RE.test(r.sha256)
}

/** The record's PhotoRef for a role (the last one, should there be several), or null. */
export function photoRefFor(session: ParkingSession, role: PhotoRole): PhotoRef | null {
  const photos = Array.isArray(session.photos) ? session.photos : []
  for (let i = photos.length - 1; i >= 0; i--) {
    const p = photos[i]
    if (isPhotoRef(p) && p.role === role) return p
  }
  return null
}

/** The legacy field's value for a role (data URL or HTTPS URL), or null. */
export function legacyPhotoValue(session: ParkingSession, role: PhotoRole): string | null {
  if (!isLegacyPhotoRole(role)) return null
  const value = session[FIELD_BY_ROLE[role]]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Does the record have a photo for this role at all (a PhotoRef, or a
 * legacy value)? Synchronous; the bytes may still turn out to be missing.
 */
export function hasSessionPhoto(session: ParkingSession, role: PhotoRole): boolean {
  return photoRefFor(session, role) !== null || legacyPhotoValue(session, role) !== null
}

export type SessionPhoto =
  /** The record has no photo for this role. */
  | { kind: 'none' }
  /** Something an `<img>` can show: a data URL, or an HTTPS URL for a cloud copy. */
  | { kind: 'available'; src: string; ref: PhotoRef | null }
  /** The record has a PhotoRef but its bytes aren't on this device. */
  | { kind: 'missing'; ref: PhotoRef }

/**
 * Decide a record's photo from what the photo store (or the cloud) returned
 * for its ref (`stored`, a data URL or null). Pure, so the hook and the
 * async resolver agree. A ref without bytes falls back to a legacy data URL
 * when there is one, and is otherwise 'missing'. A URL in the legacy field
 * of a role that has a ref is ignored: refs are never hydrated with URLs
 * (T0b4), so such a value is an interim leftover not tied to the ref's
 * bytes.
 */
export function settleSessionPhoto(
  session: ParkingSession,
  role: PhotoRole,
  stored: string | null,
): SessionPhoto {
  const ref = photoRefFor(session, role)
  const legacy = legacyPhotoValue(session, role)
  if (ref && stored) return { kind: 'available', src: stored, ref }
  if (legacy && (!ref || legacy.startsWith('data:'))) return { kind: 'available', src: legacy, ref }
  if (ref) return { kind: 'missing', ref }
  return { kind: 'none' }
}

// ─── Bytes from the cloud ────────────────────────────────────────────────

/**
 * Where a ref's bytes come from when they aren't on this device: the
 * signed-in user's cloud copy (sync.ts `fetchRefPhotoFromCloud`, which
 * checks them against the sha256 and caches them in the photo store).
 * Resolves a data URL whose bytes hash to `sha256`, or null.
 */
export type RemotePhotoFetcher = (sessionId: string, sha256: string) => Promise<string | null>

let remoteFetcher: RemotePhotoFetcher | null = null

/**
 * Set (App, once at start) or clear (null) the cloud source for missing
 * ref bytes. Without one, a ref whose bytes aren't here stays 'missing'.
 * The source itself answers null while signed out. Setting a different
 * source counts as a photo source change (`notifyPhotoSourceChanged`).
 */
export function setRemotePhotoFetcher(fetcher: RemotePhotoFetcher | null): void {
  if (fetcher === remoteFetcher) return
  remoteFetcher = fetcher
  notifyPhotoSourceChanged()
}

// ─── Photo source changes ────────────────────────────────────────────────
// A photo that came out 'missing' can turn up later: a cloud source is
// installed after the first paint, the driver signs in, or another reader
// (a PDF export, the record screen) fetched the bytes and kept them here.
// Each of those bumps this version, and `useSessionPhoto` asks again for
// photos it hasn't got.

let photoSourceGeneration = 0
const photoSourceListeners = new Set<() => void>()

/** The current photo source version (bumped by `notifyPhotoSourceChanged`). */
export function photoSourceVersion(): number {
  return photoSourceGeneration
}

/** Be told whenever the photo source version changes. Returns the unsubscribe function. */
export function subscribePhotoSource(listener: () => void): () => void {
  photoSourceListeners.add(listener)
  return () => {
    photoSourceListeners.delete(listener)
  }
}

/**
 * A missing photo may now be found: a cloud source was set, the sign-in
 * state changed, or a photo's bytes were just kept on this device.
 */
export function notifyPhotoSourceChanged(): void {
  photoSourceGeneration++
  for (const listener of [...photoSourceListeners]) {
    try {
      listener()
    } catch (err) {
      console.warn('[photos] a photo source listener failed:', err)
    }
  }
}

/**
 * A ref's bytes from the cloud, as a data URL that hashes to `sha256`, or
 * null (no source set, nothing there, a mismatch, an error). Never throws.
 * Callers skip read-only shared copies: their photos are in someone else's
 * account.
 */
export async function fetchRemotePhoto(sessionId: string, sha256: string): Promise<string | null> {
  const fetcher = remoteFetcher
  if (!fetcher) return null
  try {
    return await fetcher(sessionId, sha256)
  } catch (err) {
    console.warn('[photos] could not fetch a photo from the cloud:', err)
    return null
  }
}

/**
 * One photo of a record, read through the photo store for new records. A
 * ref whose bytes aren't on this device is fetched from the signed-in
 * user's cloud copy when there is one (checked against its sha256 and
 * cached here). Never throws.
 */
export async function resolveSessionPhoto(session: ParkingSession, role: PhotoRole): Promise<SessionPhoto> {
  const ref = photoRefFor(session, role)
  let stored: string | null = null
  if (ref) {
    try {
      stored = await getPhoto(session.id, ref.sha256)
    } catch (err) {
      console.warn(`[photos] could not read the ${role} photo:`, err)
    }
    if (!stored && !session.shared_from) stored = await fetchRemotePhoto(session.id, ref.sha256)
  }
  return settleSessionPhoto(session, role, stored)
}

/**
 * A record's photo for a role: the legacy field's value for old records,
 * the photo store's bytes (as a data URL) for new ones. Null when there is
 * no photo, or its bytes aren't on this device. Never throws.
 */
export async function getSessionPhoto(session: ParkingSession, role: PhotoRole): Promise<string | null> {
  const photo = await resolveSessionPhoto(session, role)
  return photo.kind === 'available' ? photo.src : null
}

/**
 * The capture metadata to carry when a record's photo is reused for a new
 * record (the re-check flow): the ref's own time and source, or for a
 * legacy photo the record's arrival time and 'library', since how it was
 * taken isn't known.
 */
export function reusedPhotoMeta(session: ParkingSession, role: PhotoRole): PhotoCaptureMeta {
  const ref = photoRefFor(session, role)
  if (ref && isIsoTime(ref.captured_at)) return { captured_at: ref.captured_at, source: ref.source }
  const ms = Date.parse(session.arrived_at)
  return {
    captured_at: Number.isFinite(ms) ? new Date(ms).toISOString() : session.arrived_at,
    source: 'library',
  }
}

// ─── Signed fingerprints ─────────────────────────────────────────────────

function payloadOf(bundle: SignatureBundle | undefined): Record<string, unknown> | null {
  if (!bundle || bundle.key_alias === DEV_KEY_ALIAS || typeof bundle.canonical_payload !== 'string') return null
  try {
    const p = JSON.parse(bundle.canonical_payload)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Every photo hash inside signed addendum data (any `{ role, sha256 }` object, at any depth). */
function collectPhotoHashes(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 6 || !value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const v of value) collectPhotoHashes(v, out, depth + 1)
    return
  }
  const o = value as Record<string, unknown>
  if (typeof o.role === 'string' && typeof o.sha256 === 'string') out.add(o.sha256)
  for (const v of Object.values(o)) collectPhotoHashes(v, out, depth + 1)
}

/**
 * Is this photo hash inside one of the record's stored ParkProof
 * signatures? Read from the signed payloads (link 0's photo hashes and the
 * photos in signed addenda), never from the unsigned record fields. A
 * development-key signature doesn't count.
 */
export function photoHashSigned(session: ParkingSession, sha256: string): boolean {
  const link0 = payloadOf(session.signature)
  if (
    link0 &&
    (link0.sign_photo_sha256 === sha256 ||
      link0.car_photo_sha256 === sha256 ||
      link0.ambient_photo_sha256 === sha256)
  ) {
    return true
  }
  for (const a of session.addenda ?? []) {
    const p = payloadOf(a?.bundle)
    if (!p) continue
    const hashes = new Set<string>()
    collectPhotoHashes(p.data, hashes)
    if (hashes.has(sha256)) return true
  }
  return false
}

/** A short form of a hash for people: the first and last four characters ("3f9a…c21b"). */
export function shortFingerprint(sha256: string, ellipsis = '…'): string {
  return sha256.length <= 8 ? sha256 : `${sha256.slice(0, 4)}${ellipsis}${sha256.slice(-4)}`
}
