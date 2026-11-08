import type { ParkingSession, SignatureBundle } from '../types'
import { EVIDENCE_V2_SCHEMA, HEX64_RE } from '../../lambda/addendum-schema.js'
import { getIdToken } from './auth'
import { getSession, loadSessions, mergeCloudEvidence, scheduleRecordsChanged, updateSession } from './storage'
import { getPhotoBytes, putPhoto } from './photo-store'
import { hashDataUrlImage, sha256HexUtf8 } from './hash'
import {
  LEGACY_PHOTO_ROLES,
  legacyPhotoField,
  legacyPhotoValue,
  notifyPhotoSourceChanged,
  photoRefFor,
  type LegacyPhotoRole,
} from './session-photos'
import { cloudLacksEvidence, pulledRecord, sameEvidence, uploadableAddenda, uploadablePhotoRefs } from './evidence-merge'
import { hasPendingAddenda } from './evidence-chain'
import { enqueueSigning, markPulledRecords } from './signing'
import { createLimiter } from './concurrency'

/**
 * Local↔cloud sync layer.
 *
 * Model: localStorage stays as the source of truth for the current device.
 * The cloud is a mirror that allows multi-device coverage. The record's
 * evidence (its signed chain, end and photos) is merged, never overwritten:
 * the server merges every upload into the stored row (lambda/cloud-sync.js,
 * `mergeSessionRows`), and the first sync after sign-in merges the cloud
 * copy into this device's (`mergeEvidence`, src/lib/evidence-merge.ts).
 * Other fields: this device's copy wins here, and the last upload wins in
 * the cloud.
 *
 * Photos come in two kinds:
 *   - legacy photos (`sign_photo` / `car_photo` / `ambient_photo` data URLs
 *     of records saved before the photo store): uploaded under per-role S3
 *     keys, and "hydrated" by /sessions/list with a fresh presigned URL;
 *   - photo refs (every PhotoRef in `photos`): bytes from the photo store,
 *     uploaded once under a content-addressed key, never hydrated. Missing
 *     bytes are fetched through /photos/materialize by sha256, re-hashed,
 *     and cached in the photo store only when they match.
 * A per-device, per-account set of upload markers records which photos
 * already reached S3, so nothing is uploaded twice.
 *
 * All cloud calls go through fetch directly — the Cognito SDK gives us the
 * JWT and we attach it as the Authorization header. API Gateway's JWT
 * authorizer validates server-side.
 */

function apiBase(): string {
  // Prefer the prod URL baked in at build time. Fall back to /api for local dev.
  const url = import.meta.env.VITE_API_URL as string | undefined
  if (!url) return '/api'
  // VITE_API_URL points at the /sign-translate endpoint; strip the trailing path
  // segment so we can append /sessions/upload etc.
  return url.replace(/\/[^/]*$/, '')
}

async function authFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getIdToken()
  if (!token) throw new Error('Not signed in')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(apiBase() + path, { ...init, headers })
}

async function expectJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text()
    let detail = text
    try {
      const json = JSON.parse(text)
      detail = json.error ?? text
    } catch {
      /* not JSON, use raw text */
    }
    throw new Error(`API ${res.status}: ${detail}`)
  }
  return (await res.json()) as T
}

/** The Cognito `sub` in an id token (no signature check: only to scope device-local state). */
function tokenSubject(token: string | null): string | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { sub?: unknown }
    return typeof json.sub === 'string' && json.sub.length > 0 ? json.sub : null
  } catch {
    return null
  }
}

// ─── Delete tombstones ─────────────────────────────────────────────────────
// A fire-and-forget photo/metadata upload that is already in flight can land
// AFTER a /sessions/delete and resurrect the row the user just erased, and a
// /sessions/list that was answered before the delete reached the server
// still lists the row. Both are decided by the order of events, not by how
// long ago the delete was: a weak signal or a suspended app can hold a
// listing or an upload for minutes, so any fixed age would let one through.
//
// Every listing and every upload takes a number from one counter when it
// starts (`beginOperation`). A delete marks its tombstone when it starts,
// and notes the counter again when its request settles (answered or
// failed). An operation skips a deleted id when the delete hadn't settled
// before the operation started (`deletedSince`): either it is still in
// flight, or it settled later.
//
// An operation that starts just after the delete settled is still covered
// for a short grace (DELETE_SETTLE_GRACE_MS, by the clock). The server's
// answer to the delete doesn't mean every later read sees it: a request
// that failed here may still reach the server, and a read can lag a write.
// /sessions/list reads consistently now, but this side doesn't rely on it
// alone: a pulled-back record is uploaded again by the next full sync,
// which undoes the delete for good. After the grace, an operation sees the
// server's state, so a row listed then was put back by another device and
// is pulled as usual. A tombstone goes once its grace is over and no
// running operation it covers is left.

/** How long after a delete settles a new listing or upload still skips its id. */
export const DELETE_SETTLE_GRACE_MS = 10_000

/** A listing or upload in progress: its place in the event order and its start time. */
interface SyncOperation {
  seq: number
  startedAt: number
}

/** The event counter: operation starts and delete settlements, in order. */
let eventSeq = 0
/** Per deleted id: when its delete settled, in event order and by the clock (null while in flight). */
const tombstones = new Map<string, { settledAt: number | null; settledTime: number | null }>()
/** The listings and uploads still running. */
const runningOperations = new Set<SyncOperation>()

function nextEvent(): number {
  eventSeq += 1
  return eventSeq
}

/** A listing or upload starts: its place, for `deletedSince`. Pair with `endOperation`. */
function beginOperation(): SyncOperation {
  const operation = { seq: nextEvent(), startedAt: Date.now() }
  runningOperations.add(operation)
  return operation
}

function endOperation(operation: SyncOperation): void {
  runningOperations.delete(operation)
  pruneTombstones()
}

/** True when a delete's tombstone still applies to an operation. */
function covers(
  t: { settledAt: number | null; settledTime: number | null },
  operation: SyncOperation,
): boolean {
  if (t.settledAt === null || t.settledTime === null) return true
  return t.settledAt > operation.seq || operation.startedAt < t.settledTime + DELETE_SETTLE_GRACE_MS
}

/** Forget the tombstones past their grace that no running operation needs. */
function pruneTombstones(): void {
  const now = Date.now()
  for (const [id, t] of tombstones) {
    if (t.settledTime === null || now < t.settledTime + DELETE_SETTLE_GRACE_MS) continue
    let needed = false
    for (const operation of runningOperations) {
      if (covers(t, operation)) {
        needed = true
        break
      }
    }
    if (!needed) tombstones.delete(id)
  }
}

function markSessionDeleted(id: string): void {
  // A newer delete of the same id (another tap, a retry) is in flight again.
  tombstones.set(id, { settledAt: null, settledTime: null })
  nextEvent()
}

function markDeleteSettled(id: string): void {
  const t = tombstones.get(id)
  if (t && t.settledAt === null) {
    t.settledAt = nextEvent()
    t.settledTime = Date.now()
  }
  pruneTombstones()
}

/**
 * True when `id` was deleted on this device and `operation` may predate
 * that delete: the delete hadn't settled before the operation began, or it
 * settled less than DELETE_SETTLE_GRACE_MS before. What the operation read
 * or is about to write must then skip the id.
 */
function deletedSince(id: string, operation: SyncOperation): boolean {
  const t = tombstones.get(id)
  return t !== undefined && covers(t, operation)
}

// ─── Upload markers ──────────────────────────────────────────────────────
// Which photos this device has already put in S3, per account (a different
// account on the same device has its own S3 prefix, and an account that was
// deleted and made again starts empty). A marker is set only after the S3
// PUT returned 2xx (or the server said the content-addressed object already
// exists, or its bytes were just fetched from there). Best-effort: losing
// the markers only means a photo is uploaded once more.

const UPLOAD_MARKERS_KEY = 'parkproof.sync.uploaded.v1'
type UploadMarkers = Record<string, string[]>

/** The marker of a photo ref's upload. */
export function refUploadMarker(sessionId: string, sha256: string): string {
  return `${sessionId}/${sha256}`
}

/** The marker of a legacy (per-role) photo's upload. */
export function legacyUploadMarker(sessionId: string, role: LegacyPhotoRole): string {
  return `${sessionId}/${role}`
}

function loadUploadMarkers(): UploadMarkers {
  try {
    const raw = localStorage.getItem(UPLOAD_MARKERS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as UploadMarkers) : {}
  } catch {
    return {}
  }
}

function saveUploadMarkers(markers: UploadMarkers): void {
  try {
    localStorage.setItem(UPLOAD_MARKERS_KEY, JSON.stringify(markers))
  } catch {
    /* best-effort: the worst case is one more upload */
  }
}

/** The markers set for this account on this device. */
export function uploadedPhotoMarkers(scope: string): Set<string> {
  const list = loadUploadMarkers()[scope]
  return new Set(Array.isArray(list) ? list.filter((m) => typeof m === 'string') : [])
}

function markUploaded(scope: string | null, marker: string): void {
  if (!scope) return
  const markers = loadUploadMarkers()
  const list = Array.isArray(markers[scope]) ? markers[scope] : []
  if (list.includes(marker)) return
  markers[scope] = [...list, marker]
  saveUploadMarkers(markers)
}

/** Forget every account's markers for a record (it was deleted). */
function forgetRecordMarkers(sessionId: string): void {
  const markers = loadUploadMarkers()
  const prefix = `${sessionId}/`
  let changed = false
  for (const scope of Object.keys(markers)) {
    const list = Array.isArray(markers[scope]) ? markers[scope] : []
    const kept = list.filter((m) => !m.startsWith(prefix))
    if (kept.length !== list.length) {
      markers[scope] = kept
      changed = true
    }
  }
  if (changed) saveUploadMarkers(markers)
}

/** Keep only this account's markers for records still saved here. */
function pruneUploadMarkers(scope: string, knownIds: ReadonlySet<string>): void {
  const markers = loadUploadMarkers()
  const list = Array.isArray(markers[scope]) ? markers[scope] : []
  const kept = list.filter((m) => knownIds.has(m.slice(0, m.lastIndexOf('/'))))
  if (kept.length === list.length) return
  markers[scope] = kept
  saveUploadMarkers(markers)
}

// ─── Photo uploads ───────────────────────────────────────────────────────

interface PresignResponse {
  url?: string
  key: string
  bucket: string
  /** A content-addressed photo that is already stored: nothing to upload. */
  exists?: boolean
}

/**
 * At most this many photo uploads at once across every record, and
 * separately at most this many photo fetches from the cloud, so a record
 * being saved never waits behind photos being fetched for the screen (or a
 * PDF), and the other way round.
 */
const PHOTO_TRANSFER_CONCURRENCY = 4
const photoUploads = createLimiter(PHOTO_TRANSFER_CONCURRENCY)
const photoFetches = createLimiter(PHOTO_TRANSFER_CONCURRENCY)

async function putToS3(url: string, blob: Blob, contentType: string): Promise<void> {
  // PUT the blob directly to S3 — no auth header needed because the
  // presigned URL itself carries the signed authorization.
  const putRes = await fetch(url, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': contentType },
  })
  if (!putRes.ok) {
    throw new Error(`S3 PUT failed (${putRes.status}): ${await putRes.text()}`)
  }
}

/**
 * Upload one legacy photo under its per-role key: mint a presigned PUT URL,
 * then send the bytes directly to S3 from the browser. Lambda never sees
 * the photo — keeps the request small and sidesteps API Gateway's 6MB
 * payload limit.
 */
async function uploadLegacyPhoto(sessionId: string, role: LegacyPhotoRole, dataUrl: string): Promise<void> {
  // Decode the data URL → Blob. Splits 'data:image/jpeg;base64,XYZ' into the
  // media type and the base64 payload, then atob → Uint8Array → Blob.
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new Error(`photo for role "${role}" is not a base64 data URL`)
  }
  const [, contentType, b64] = match
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const presignRes = await authFetch('/photos/presign', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, role, content_type: contentType }),
  })
  const { url } = await expectJson<PresignResponse>(presignRes)
  if (!url) throw new Error('presign returned no upload URL')
  await putToS3(url, new Blob([bytes], { type: contentType }), contentType)
}

/**
 * Upload one photo ref's bytes (from the photo store) under its
 * content-addressed key. 'absent' when the bytes aren't on this device
 * (another device has them, or they're gone): nothing to send, and not a
 * failure.
 */
async function uploadRefPhoto(sessionId: string, sha256: string): Promise<'uploaded' | 'absent'> {
  let stored: { type: string; bytes: Uint8Array } | null
  try {
    stored = await getPhotoBytes(sessionId, sha256)
  } catch {
    stored = null
  }
  if (!stored) return 'absent'
  const presignRes = await authFetch('/photos/presign', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, sha256, content_type: stored.type }),
  })
  const presigned = await expectJson<PresignResponse>(presignRes)
  if (presigned.exists) return 'uploaded'
  if (!presigned.url) throw new Error('presign returned no upload URL')
  await putToS3(presigned.url, new Blob([stored.bytes as BlobPart], { type: stored.type }), stored.type)
  return 'uploaded'
}

// ─── Operations ──────────────────────────────────────────────────────────

/**
 * The metadata row for /sessions/upload: the record with every legacy photo
 * field null (their bytes go to S3 separately, and a URL there is a
 * presigned link that will have expired), and only its signed and rejected
 * addenda (a pending addendum stays on the device that queued it until it
 * is signed; see src/lib/evidence-merge.ts). `photo_sync_failed` is left
 * out: it says this device couldn't back a photo up, which says nothing
 * about any other device's copy.
 */
export function uploadRow(session: ParkingSession): ParkingSession {
  const row: ParkingSession = { ...session }
  delete row.photo_sync_failed
  const fields = row as unknown as Record<string, unknown>
  for (const role of LEGACY_PHOTO_ROLES) {
    const field = legacyPhotoField(role)
    if (field in row) fields[field] = null
  }
  const addenda = uploadableAddenda(session.addenda)
  if (addenda !== undefined) row.addenda = addenda
  const photos = uploadablePhotoRefs(session.photos)
  if (photos !== undefined) row.photos = photos
  return row
}

export interface UploadResult {
  /** True when the row reached the cloud but at least one photo upload failed. */
  photoFailed: boolean
}

const NO_FAILURE: UploadResult = { photoFailed: false }

/**
 * One upload of a record, read from storage (not from a caller's copy).
 * Photos go to S3 first (direct browser PUT via presigned URLs), skipping
 * any this device already uploaded; then the record is read again and its
 * row goes to /sessions/upload, which merges it into the stored row.
 *
 * Photo upload errors are warned-and-swallowed: the metadata is the
 * minimum-viable record (timestamp, GPS, sign rules, signatures). We still
 * report whether any photo failed, so the caller can surface it: a silent
 * photo loss leaves another device with a missing image and a blank PDF.
 */
async function runUpload(id: string): Promise<UploadResult> {
  const operation = beginOperation()
  try {
    return await uploadOnce(id, operation)
  } finally {
    endOperation(operation)
  }
}

async function uploadOnce(id: string, operation: SyncOperation): Promise<UploadResult> {
  const isTombstoned = (recordId: string) => deletedSince(recordId, operation)
  // Don't resurrect a session the user just deleted.
  if (isTombstoned(id)) return NO_FAILURE
  const start = getSession(id)
  // Gone from this device, or a read-only copy of someone else's record.
  if (!start || start.shared_from) return NO_FAILURE
  const token = await getIdToken()
  if (!token) throw new Error('Not signed in')
  const scope = tokenSubject(token)
  const done = scope ? uploadedPhotoMarkers(scope) : new Set<string>()

  const jobs: Array<() => Promise<void>> = []
  for (const target of photoUploadTargets(start)) {
    const { marker } = target
    if (done.has(marker)) continue
    if (target.kind === 'legacy') {
      const { role, value } = target
      jobs.push(async () => {
        await uploadLegacyPhoto(id, role, value)
        // A delete meanwhile removes the record's photos: don't claim this one is there.
        if (!isTombstoned(id)) markUploaded(scope, marker)
      })
      continue
    }
    const { sha256 } = target
    jobs.push(async () => {
      if ((await uploadRefPhoto(id, sha256)) === 'uploaded' && !isTombstoned(id)) markUploaded(scope, marker)
    })
  }
  let photoFailed = false
  await Promise.all(
    jobs.map((job) =>
      photoUploads(job).catch((err) => {
        photoFailed = true
        console.warn(`[sync] photo upload for ${id} failed:`, err)
      }),
    ),
  )

  // Re-check after the photo PUTs (multi-RTT): a delete may have landed while
  // they were in flight. Drop the metadata write so the row stays deleted.
  if (isTombstoned(id)) return NO_FAILURE
  // Read the record again right before the metadata POST, so the row
  // carries everything stored meanwhile (a signature landing, an end).
  const fresh = getSession(id)
  if (!fresh || fresh.shared_from) return { photoFailed }
  const res = await authFetch('/sessions/upload', {
    method: 'POST',
    body: JSON.stringify({ session: uploadRow(fresh) }),
  })
  await expectJson<{ ok: true }>(res)
  // This device's "photo not backed up" flag clears on its own once every
  // photo it holds for the record is known to be in S3.
  if (!photoFailed && scope && getSession(id)?.photo_sync_failed && !isTombstoned(id)) {
    const marked = uploadedPhotoMarkers(scope)
    const current = getSession(id)
    if (current && photoUploadTargets(current).every((t) => marked.has(t.marker))) {
      try {
        updateSession(id, { photo_sync_failed: false })
      } catch (err) {
        console.warn(`[sync] could not clear the photo flag of ${id}:`, err)
      }
    }
  }
  // Only reached when the metadata upload SUCCEEDED — so photoFailed here means
  // "the row is on the cloud but an image isn't", the true silent-evidence-loss
  // case. A whole-session network failure throws above and never returns this.
  return { photoFailed }
}

type PhotoUploadTarget =
  | { kind: 'legacy'; marker: string; role: LegacyPhotoRole; value: string }
  | { kind: 'ref'; marker: string; sha256: string }

/**
 * Every photo of a record that an upload from this device covers, with its
 * upload marker: each legacy data-URL photo of a role without a ref, then
 * each photo ref (once per sha256). A legacy cloud URL isn't one: its bytes
 * came from S3.
 */
function photoUploadTargets(session: ParkingSession): PhotoUploadTarget[] {
  const targets: PhotoUploadTarget[] = []
  for (const role of LEGACY_PHOTO_ROLES) {
    // A role with a ref uploads as a ref, below.
    if (photoRefFor(session, role)) continue
    const value = legacyPhotoValue(session, role)
    if (!value || !value.startsWith('data:')) continue
    targets.push({ kind: 'legacy', marker: legacyUploadMarker(session.id, role), role, value })
  }
  const seen = new Set<string>()
  for (const ref of Array.isArray(session.photos) ? session.photos : []) {
    const sha256 = ref?.sha256
    if (typeof sha256 !== 'string' || !HEX64_RE.test(sha256) || seen.has(sha256)) continue
    seen.add(sha256)
    targets.push({ kind: 'ref', marker: refUploadMarker(session.id, sha256), sha256 })
  }
  return targets
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Per record: the upload in flight, and whether another was asked for meanwhile. */
const uploadSlots = new Map<string, { again: Deferred<UploadResult> | null }>()

function startUpload(id: string): Promise<UploadResult> {
  const slot: { again: Deferred<UploadResult> | null } = { again: null }
  uploadSlots.set(id, slot)
  const run = runUpload(id)
  const settle = () => {
    uploadSlots.delete(id)
    const again = slot.again
    if (again) startUpload(id).then(again.resolve, again.reject)
  }
  run.then(settle, settle)
  return run
}

/**
 * Upload one record to the cloud. At most one upload per record is in
 * flight: a call made while one runs marks the record dirty and resolves
 * with ONE more upload that starts when the current one ends (however many
 * calls came in meanwhile). Every upload reads the record from storage, so
 * the follow-up carries the latest copy. A record that is no longer saved
 * on this device, or is a read-only shared copy, is not uploaded.
 */
export function uploadSession(session: ParkingSession): Promise<UploadResult> {
  const slot = uploadSlots.get(session.id)
  if (slot) {
    if (!slot.again) slot.again = deferred<UploadResult>()
    return slot.again.promise
  }
  return startUpload(session.id)
}

/** List all sessions stored in the cloud for the signed-in user. */
export async function listCloudSessions(): Promise<ParkingSession[]> {
  const res = await authFetch('/sessions/list', { method: 'GET' })
  const data = await expectJson<{ sessions: ParkingSession[] }>(res)
  return data.sessions
}

/**
 * Materialize one LEGACY photo from the cloud as a data URL via the
 * server-side proxy. Used by the PDF generator's cross-device path. The
 * Lambda fetches from S3 server-side and returns the bytes through the same
 * API origin the browser already trusts — sidesteps the direct-to-S3 CORS
 * failures we hit on some mobile networks (Android Chrome over 5G, certain
 * privacy-layer VPNs) that the curl-equivalent test path doesn't reproduce.
 *
 * Returns null when S3 has no object at the canonical key. Photo refs use
 * `fetchRefPhotoFromCloud` instead.
 */
export async function materializePhotoFromCloud(
  sessionId: string,
  role: LegacyPhotoRole,
): Promise<string | null> {
  const res = await authFetch('/photos/materialize', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, role }),
  })
  const data = await expectJson<{ data_url: string | null }>(res)
  return data.data_url
}

// ─── Photo refs from the cloud ───────────────────────────────────────────

/** A ref that wasn't in the cloud (or didn't match) isn't asked for again for this long. */
export const REMOTE_MISS_TTL_MS = 60_000
const remoteInFlight = new Map<string, Promise<string | null>>()
const remoteMisses = new Map<string, number>()
const SIGNED_OUT = Symbol('signed out')

async function fetchAndCacheRef(sessionId: string, sha256: string): Promise<string | null | typeof SIGNED_OUT> {
  const token = await getIdToken()
  if (!token) return SIGNED_OUT
  const res = await authFetch('/photos/materialize', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, sha256 }),
  })
  const { data_url } = await expectJson<{ data_url: string | null }>(res)
  if (typeof data_url !== 'string' || !data_url.startsWith('data:')) return null
  if ((await hashDataUrlImage(data_url)) !== sha256) {
    console.warn(`[sync] the cloud copy of a photo of ${sessionId} does not match its fingerprint; not used`)
    return null
  }
  let kept = false
  try {
    // Content-addressed: putPhoto hashes the bytes again and stores them under the same key.
    await putPhoto(sessionId, data_url)
    kept = true
  } catch (err) {
    console.warn('[sync] could not keep a fetched photo on this device:', err)
  }
  // The bytes came from S3, so they are there: never upload them again.
  markUploaded(tokenSubject(token), refUploadMarker(sessionId, sha256))
  // Other screens showing this photo as missing can read it here now.
  if (kept) notifyPhotoSourceChanged()
  return data_url
}

/**
 * A photo ref's bytes from the signed-in user's cloud copy, for a ref whose
 * bytes aren't on this device: fetched through /photos/materialize by
 * sha256, re-hashed, and cached in the photo store only when they match.
 * Resolves the data URL, or null: signed out (no request is made), not in
 * the cloud, a mismatch, or an error. Never throws. Concurrent asks for the
 * same photo share one request; at most PHOTO_TRANSFER_CONCURRENCY run at
 * once (apart from uploads); a miss isn't asked for again for
 * REMOTE_MISS_TTL_MS. While signed out it answers null at once, without
 * taking a place in the queue. App installs this as the photo readers'
 * cloud source (`setRemotePhotoFetcher`) once at start.
 */
export function fetchRefPhotoFromCloud(sessionId: string, sha256: string): Promise<string | null> {
  if (typeof sha256 !== 'string' || !HEX64_RE.test(sha256) || typeof sessionId !== 'string' || !sessionId) {
    return Promise.resolve(null)
  }
  const key = refUploadMarker(sessionId, sha256)
  const running = remoteInFlight.get(key)
  if (running) return running
  const missedAt = remoteMisses.get(key)
  if (missedAt !== undefined && Date.now() - missedAt < REMOTE_MISS_TTL_MS) return Promise.resolve(null)
  const request = getIdToken()
    .then((token) => (token ? photoFetches(() => fetchAndCacheRef(sessionId, sha256)) : SIGNED_OUT))
    .catch((err) => {
      console.warn('[sync] could not fetch a photo from the cloud:', err)
      return null
    })
    .then((outcome) => {
      remoteInFlight.delete(key)
      if (outcome === SIGNED_OUT) return null
      if (outcome === null) remoteMisses.set(key, Date.now())
      else remoteMisses.delete(key)
      return outcome
    })
  remoteInFlight.set(key, request)
  return request
}

/** Delete one session from the cloud (DDB row + S3 photos, best-effort). */
export async function deleteCloudSession(sessionId: string): Promise<void> {
  // Tombstone first (synchronously) so any overlapping in-flight upload bails
  // before it can re-create the row.
  markSessionDeleted(sessionId)
  forgetRecordMarkers(sessionId)
  try {
    const res = await authFetch('/sessions/delete', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    })
    await expectJson<{ ok: true }>(res)
  } finally {
    // Answered or failed: once DELETE_SETTLE_GRACE_MS has passed, a listing
    // or upload that starts reads the server as it is.
    markDeleteSettled(sessionId)
  }
}

/** Export everything the cloud holds about the signed-in user. */
export async function exportCloudData(): Promise<unknown> {
  const res = await authFetch('/me/export', { method: 'GET' })
  return expectJson<unknown>(res)
}

/** Permanently delete the user's account + every byte of their data. */
export async function deleteAccount(): Promise<void> {
  const scope = tokenSubject(await getIdToken())
  const res = await authFetch('/me/delete', { method: 'POST' })
  await expectJson<{ ok: true }>(res)
  if (scope) {
    const markers = loadUploadMarkers()
    delete markers[scope]
    saveUploadMarkers(markers)
  }
}

// ─── First-time sync ─────────────────────────────────────────────────────

export interface InitialSyncResult {
  uploaded: number // local sessions newly uploaded to the cloud
  pulled: number // cloud sessions newly added to the local store
  alreadyInSync: number // sessions present on both sides with the same id
  /** Records on both sides whose local copy took evidence from the cloud copy. */
  merged: number
  // True when the cloud list call failed and we proceeded treating the cloud as
  // empty. Lets the caller distinguish "you genuinely have no sessions" from
  // "we couldn't reach your sessions" — the latter shouldn't drop a returning
  // user onto the first-time landing with no explanation.
  listFailed: boolean
}

function payloadOf(bundle: SignatureBundle | undefined): Record<string, unknown> | null {
  if (!bundle || typeof bundle.canonical_payload !== 'string') return null
  try {
    const p = JSON.parse(bundle.canonical_payload)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Can this chain key extend the record's chain? For a v2 link 0, its hash
 * must be the `chain_key_sha256` link 0 signed (the server refuses every
 * addendum otherwise). True when there is no v2 link 0 to check against.
 */
async function chainKeyFits(link0: SignatureBundle | undefined, chainKey: string): Promise<boolean> {
  const p = payloadOf(link0)
  if (!p || p.schema !== EVIDENCE_V2_SCHEMA) return true
  return (await sha256HexUtf8(chainKey)) === p.chain_key_sha256
}

/** A presigned legacy photo URL with more than this left is kept, not swapped for a fresh one. */
const LEGACY_URL_REFRESH_MARGIN_MS = 10 * 60 * 1000

/**
 * True when `url` is a presigned URL (X-Amz-Date plus X-Amz-Expires) with
 * more than the margin left before it expires. Anything else counts as
 * stale. /sessions/list mints new URLs on every call, so without this every
 * pull on return (up to once a minute) would rewrite each such record and
 * re-render its screens for a URL that still works.
 */
function presignedUrlStillFresh(url: string, nowMs: number): boolean {
  try {
    const query = new URL(url).searchParams
    const signed = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(query.get('X-Amz-Date') ?? '')
    const expiresS = Number(query.get('X-Amz-Expires'))
    if (!signed || !Number.isFinite(expiresS) || expiresS <= 0) return false
    const [, y, mo, d, h, mi, se] = signed.map(Number)
    const expiresAt = Date.UTC(y, mo - 1, d, h, mi, se) + expiresS * 1000
    return expiresAt - nowMs > LEGACY_URL_REFRESH_MARGIN_MS
  } catch {
    return false
  }
}

/**
 * The legacy photo fields to refresh on this device's copy. For a role
 * without a ref: a data URL here stays (self-contained, works offline);
 * otherwise the cloud's freshly minted URL replaces an older one that is
 * expired or close to it (`presignedUrlStillFresh`). For a role with a ref:
 * a URL left in the legacy field by an earlier sync is dropped, because a
 * ref's photo is read from this device or fetched by its sha256, never
 * from a URL.
 */
function legacyPhotoPatch(local: ParkingSession, cloud: ParkingSession): Partial<ParkingSession> {
  const patch: Partial<ParkingSession> = {}
  for (const role of LEGACY_PHOTO_ROLES) {
    const field = legacyPhotoField(role)
    const localValue = local[field]
    if (typeof localValue === 'string' && localValue.startsWith('data:')) continue
    if (photoRefFor(local, role) || photoRefFor(cloud, role)) {
      if (typeof localValue === 'string' && localValue.length > 0) patch[field] = null
      continue
    }
    const cloudValue = cloud[field]
    if (!cloudValue || cloudValue === localValue) continue
    if (typeof localValue === 'string' && presignedUrlStillFresh(localValue, Date.now())) continue
    patch[field] = cloudValue
  }
  return patch
}

/**
 * One record on both sides: refresh legacy photo URLs, merge the cloud
 * copy's evidence into this device's (`mergeCloudEvidence`), then upload
 * when this device has evidence the cloud copy lacks. Returns whether this
 * device's copy took anything from the cloud.
 */
async function syncBothSides(local: ParkingSession, cloud: ParkingSession): Promise<boolean> {
  let incoming = cloud
  if (!local.chain_key && typeof cloud.chain_key === 'string' && cloud.chain_key) {
    // Every record saved here since the chain has its key here, so this copy
    // came from the cloud (before keys synced). Mark it as pulled first, so
    // it never gets a link 0 of its own; if that can't be stored, leave the
    // copy as it is until the next sync.
    if (!markPulledRecords([local.id])) return false
    if (!(await chainKeyFits(local.signature ?? cloud.signature, cloud.chain_key))) {
      console.warn(`[sync] the cloud chain key of ${local.id} does not match its link 0; not used`)
      incoming = { ...cloud, chain_key: undefined }
    }
  }
  const patch = legacyPhotoPatch(local, cloud)
  if (Object.keys(patch).length > 0) updateSession(local.id, patch)
  const before = getSession(local.id)
  const merged = mergeCloudEvidence(local.id, incoming)
  if (!merged) return false
  const changed = !!before && !sameEvidence(before, merged)
  // The merge may have brought the parent a pending link was waiting for,
  // or renumbered this device's pending links onto links signed elsewhere:
  // sign them now rather than at the next sweep trigger.
  if (changed && hasPendingAddenda(merged)) void enqueueSigning(local.id)
  if (cloudLacksEvidence(merged, cloud)) await uploadSession(merged)
  return changed
}

/** Options for one `performInitialSync` run. */
export interface SyncOptions {
  /**
   * Upload the records only this device holds (default true). False for a
   * pull on return: a record missing from the listing then is most likely
   * one deleted on another device, and uploading it again would undo that
   * delete within a minute. New records reach the cloud when they are saved
   * (`mirrorSessionToCloud`); one that didn't still goes up at the next app
   * start or sign-in, as before the pull on return existed.
   */
  uploadLocalOnly?: boolean
}

/**
 * Runs at app start, after sign-in, and when the app comes back to the
 * screen (App runs it through `createSyncRunner`). Merges local + cloud:
 *   - cloud-only records → written into local storage, marked as pulled
 *     (they never get a link 0 on this device) and without any pending
 *     addenda
 *   - records on both sides → the cloud copy's evidence merged into the
 *     local copy (`mergeEvidence`), and uploaded again when the local copy
 *     has links (or an end, photos...) the cloud copy lacks
 *   - local-only records → uploaded to the cloud, except on a pull on
 *     return (`SyncOptions.uploadLocalOnly`)
 * Read-only shared copies never sync.
 *
 * In that order, so what arrives from other devices lands first (field-test
 * fix list, item 6): the pull is local writes only, and each merge lands
 * before any local-only upload is waited on. The three sets don't overlap,
 * so the order changes nothing else. Each record that lands tells open
 * screens at once: pulled records through `scheduleRecordsChanged` (one
 * notification per synchronous batch), merges through the storage write
 * itself (`updateSession`, `mergeCloudEvidence`).
 */
export async function performInitialSync(options: SyncOptions = {}): Promise<InitialSyncResult> {
  // The listing's place in the order of events: a record deleted here after
  // it started is still in what it returns (however long it took).
  const listing = beginOperation()
  try {
    return await syncOnce(options, listing)
  } finally {
    endOperation(listing)
  }
}

async function syncOnce(options: SyncOptions, listing: SyncOperation): Promise<InitialSyncResult> {
  const uploadLocalOnly = options.uploadLocalOnly ?? true
  let listFailed = false
  const cloudSessions = await listCloudSessions().catch((err) => {
    console.warn('[sync] list failed, treating cloud as empty:', err)
    listFailed = true
    return [] as ParkingSession[]
  })
  const localSessions = loadSessions()
  const localById = new Map(localSessions.map((s) => [s.id, s]))
  const cloudById = new Map(cloudSessions.map((s) => [s.id, s]))

  const result: InitialSyncResult = { uploaded: 0, pulled: 0, alreadyInSync: 0, merged: 0, listFailed }

  // Cloud-only → into local storage. The pulled mark goes first: a pulled
  // record must never be signed as if it were saved here. A record deleted
  // here after the listing started, or just before it, may still be in that
  // listing: skip it (its tombstone), or it comes back here and the next
  // full sync uploads it again.
  const toPull = cloudSessions.filter((s) => !localById.has(s.id) && !s.shared_from && !deletedSince(s.id, listing))
  if (toPull.length > 0) {
    if (!markPulledRecords(toPull.map((s) => s.id))) {
      console.warn('[sync] could not mark records as pulled; they are pulled on the next sync')
    } else {
      for (const session of toPull) {
        try {
          if (writeNewLocalSession(pulledRecord(session), listing)) result.pulled++
        } catch (err) {
          console.warn(`[sync] pull of ${session.id} failed:`, err)
        }
      }
    }
  }

  // On both sides → merge, and push back what the cloud lacks.
  for (const cloudSession of cloudSessions) {
    const local = localById.get(cloudSession.id)
    if (!local || local.shared_from) continue
    result.alreadyInSync++
    try {
      if (await syncBothSides(local, cloudSession)) result.merged++
    } catch (err) {
      console.warn(`[sync] merge of ${cloudSession.id} failed:`, err)
    }
  }

  // Local-only → upload to cloud (not on a pull on return: see SyncOptions).
  for (const session of uploadLocalOnly ? localSessions : []) {
    if (cloudById.has(session.id) || session.shared_from) continue
    // The listing shows no row for it. If it had one before, it was deleted
    // (from another device), and that delete swept its photos too, so this
    // device's markers no longer hold. Forget them: a photo still stored
    // costs one presign that answers `exists`, with no bytes sent.
    if (!listFailed) forgetRecordMarkers(session.id)
    try {
      await uploadSession(session)
      result.uploaded++
    } catch (err) {
      console.warn(`[sync] upload of ${session.id} failed:`, err)
    }
  }

  // Forget upload markers of records no longer saved here.
  const scope = tokenSubject(await getIdToken().catch(() => null))
  if (scope && !listFailed) pruneUploadMarkers(scope, new Set(loadSessions().map((s) => s.id)))

  console.log(
    `[sync] initial sync: uploaded=${result.uploaded} pulled=${result.pulled} already=${result.alreadyInSync} merged=${result.merged}`,
  )
  return result
}

/**
 * Insert a session into localStorage at index 0 (newest-first ordering),
 * preserving the rest. Used by the cloud-pull path during initial sync.
 * Returns false (and writes nothing) when a record with the id is already
 * saved, the record was deleted here after the listing it came from
 * started or just before it (its tombstone), or the write failed. A write tells open screens
 * through `scheduleRecordsChanged`, so the list shows a pulled record as
 * soon as it lands, with one re-render for a whole pull.
 *
 * A read-only shared copy of this same record (T7: the driver opened their
 * own share link on this device before the record itself arrived) gives
 * way to the record: it is removed in the same write, so History never
 * shows one park twice. upsertSharedCopy covers the other order.
 */
function writeNewLocalSession(session: ParkingSession, listing: SyncOperation): boolean {
  const KEY = 'parkproof.sessions.v1'
  if (deletedSince(session.id, listing)) return false
  try {
    const raw = localStorage.getItem(KEY)
    const all: ParkingSession[] = raw ? JSON.parse(raw) : []
    if (all.some((s) => s.id === session.id)) return false
    const shadowed = all.filter((s) => s.shared_from?.original_session_id === session.id)
    const kept = shadowed.length > 0 ? all.filter((s) => !shadowed.includes(s)) : all
    kept.unshift(session)
    localStorage.setItem(KEY, JSON.stringify(kept))
    scheduleRecordsChanged(session.id)
    for (const copy of shadowed) scheduleRecordsChanged(copy.id)
    return true
  } catch (err) {
    console.warn('[sync] writeNewLocalSession failed:', err)
    return false
  }
}

// ─── Running the sync ────────────────────────────────────────────────────
// One sync at a time. App runs it at app start, at sign-in and from the
// retry (`now`), and again when the app comes back to the screen or back
// online (`onReturn` through `installSyncOnReturn`; field-test fix list
// Tier 2: before, another device's changes only arrived on a reload).

/** Coming back to the app pulls again at most this often (from the start of the last sync). */
export const SYNC_ON_RETURN_INTERVAL_MS = 60_000

export interface SyncRunner {
  /**
   * Sync now (app start, sign-in, the retry). Never two at once: while one
   * runs, this returns one more run that starts when it settles, shared by
   * every call made meanwhile. So a sign-in during a sync still syncs the
   * account it signed into, and no record is merged by two runs at once.
   */
  now(): Promise<InitialSyncResult>
  /**
   * Pull on return: sync again so changes made on another device arrive
   * without a reload. It pulls and merges but uploads no local-only record
   * (`SyncOptions.uploadLocalOnly`). Returns the run, or null when skipped:
   * a sync is running or queued, the browser is offline (the `online` event
   * asks again), or the last run started under the interval ago. Only call
   * it while signed in.
   */
  onReturn(now?: number): Promise<InitialSyncResult> | null
  /**
   * When the interval since the last start ends (the earliest an
   * `onReturn` is not throttled), or null before any run.
   */
  nextReturnAt(): number | null
}

/**
 * The one-at-a-time guard around the sync. `sync` is `performInitialSync`
 * (App passes it in; tests pass a stand-in). Each runner has its own state,
 * so App keeps one for its lifetime.
 */
export function createSyncRunner(
  sync: (options?: SyncOptions) => Promise<InitialSyncResult> = performInitialSync,
  intervalMs: number = SYNC_ON_RETURN_INTERVAL_MS,
): SyncRunner {
  let running: Promise<InitialSyncResult> | null = null
  let followUp: Promise<InitialSyncResult> | null = null
  let lastStartedAt: number | null = null

  const start = (at: number, options: SyncOptions = {}): Promise<InitialSyncResult> => {
    lastStartedAt = at
    let run: Promise<InitialSyncResult>
    try {
      run = sync(options)
    } catch (err) {
      run = Promise.reject(err)
    }
    const tracked: Promise<InitialSyncResult> = run.finally(() => {
      if (running === tracked) running = null
    })
    running = tracked
    return tracked
  }

  return {
    now() {
      // Checked first: between a run settling and its follow-up starting,
      // `running` is already null.
      if (followUp) return followUp
      const current = running
      if (!current) return start(Date.now())
      const queued: Promise<InitialSyncResult> = current
        .catch(() => undefined)
        .then(() => {
          followUp = null
          return start(Date.now())
        })
      followUp = queued
      return queued
    },
    onReturn(now = Date.now()) {
      if (running || followUp) return null
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
      if (lastStartedAt !== null) {
        const since = now - lastStartedAt
        if (since >= 0 && since < intervalMs) return null
      }
      return start(now, { uploadLocalOnly: false })
    },
    nextReturnAt() {
      return lastStartedAt === null ? null : lastStartedAt + intervalMs
    },
  }
}

/**
 * Pull on return when the page becomes visible again (an installed app is
 * usually resumed, not reloaded) and when the browser comes back online.
 * A return inside the interval is not dropped: one pull follows when the
 * interval ends, if the page is still on screen, so a device picked up
 * seconds after the last sync doesn't stay stale while it is in use.
 * App installs it only while someone is signed in. `onRun` gets each run
 * that starts, to settle it as the app-start sync is settled. Returns the
 * cleanup for a React effect.
 */
export function installSyncOnReturn(
  runner: SyncRunner,
  onRun: (run: Promise<InitialSyncResult>) => void,
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  let later: ReturnType<typeof setTimeout> | null = null
  const pull = () => {
    if (later !== null) {
      clearTimeout(later)
      later = null
    }
    const run = runner.onReturn()
    if (run) {
      onRun(run)
      return
    }
    // Skipped. Try once more when the interval ends: by then a skip for
    // any other reason (a sync still running) has usually cleared too.
    const at = runner.nextReturnAt()
    const wait = at === null ? 0 : at - Date.now()
    if (wait > 0) {
      later = setTimeout(() => {
        later = null
        if (document.visibilityState === 'visible') pull()
      }, wait)
    }
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible') pull()
  }
  window.addEventListener('online', pull)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    if (later !== null) clearTimeout(later)
    later = null
    window.removeEventListener('online', pull)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

// ─── Background mirror ───────────────────────────────────────────────────

/**
 * Fire-and-forget mirror of a newly-saved local session to the cloud. Called
 * from App after saveSession, only when signed in. Never throws to the
 * caller — sync is best-effort, the local copy is the source of truth.
 */
export function mirrorSessionToCloud(
  session: ParkingSession,
): Promise<UploadResult> {
  return uploadSession(session).catch((err) => {
    console.warn('[sync] mirror failed (will retry on next app load):', err)
    // Whole-session failure (network/metadata). This retries on the next app
    // load, so we deliberately don't raise the photo-failed flag here — that
    // signal is reserved for the "row synced but photo didn't" case, which is
    // the one that won't self-heal.
    return NO_FAILURE
  })
}

/**
 * Fire-and-forget mirror of a session UPDATE (e.g. note edit, signature
 * enrichment) to the cloud. Same semantics as mirrorSessionToCloud — the
 * upload reads the latest local copy and the server merges it in.
 */
export function mirrorSessionUpdateToCloud(sessionId: string): void {
  const session = getSession(sessionId)
  if (!session) return
  void uploadSession(session).catch((err) => {
    console.warn('[sync] mirror update failed:', err)
  })
}

/** Test-only: forget uploads in flight, tombstones and the cloud-photo caches. */
export function resetSyncForTests(): void {
  uploadSlots.clear()
  tombstones.clear()
  runningOperations.clear()
  remoteInFlight.clear()
  remoteMisses.clear()
}

// Re-export updateSession so callers can do `updateSession + mirror` in one
// import statement without juggling two paths.
export { updateSession }
