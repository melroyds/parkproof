// ParkProof — cloud sync handlers.
//
// Seven routes, all JWT-protected by API Gateway's Cognito authorizer:
//   POST   /sessions/upload    — merge one record into the signed-in user's row
//   GET    /sessions/list      — list all records for the signed-in user
//   POST   /sessions/delete    — delete one (incl. its S3 photos)
//   POST   /photos/presign     — issue a presigned S3 URL for a direct photo upload
//   POST   /photos/materialize — return one stored photo as a data URL
//   GET    /me/export          — return the user's full data as JSON
//   POST   /me/delete          — nuke everything (DDB rows + S3 objects + Cognito user)
//
// Anonymous-by-default is preserved by keeping the original /sign-translate,
// /sign-session, /draft-appeal and /feedback routes unauthenticated. Only the
// /sessions/*, /photos/* and /me/* routes require sign-in.
//
// Photos come in two kinds (build spec T0b4):
//   - Legacy photos: the `sign_photo` / `car_photo` / `ambient_photo` fields of
//     records saved before the photo store. One S3 object per role at
//     `{userId}/{sessionId}/{role}.jpg`. The DDB row never stores them (the
//     fields are always null there); /sessions/list "hydrates" them with a
//     fresh presigned GET URL for every object that exists.
//   - Photo refs: every PhotoRef in a record's `photos`. Content-addressed and
//     immutable at `{userId}/{sessionId}/p/{sha256}.jpg`. Never hydrated: the
//     client reads them from IndexedDB, or fetches them through
//     /photos/materialize and checks the bytes against the sha256.
//
// /sessions/upload merges instead of overwriting, so two devices can't undo
// each other's evidence: it reads the stored row and writes with a condition
// on its `rev` attribute, retrying when another write got in first. See
// `mergeSessionRows` for the rules.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb'
import {
  S3Client,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider'

const REGION = process.env.AWS_REGION || 'ap-southeast-2'
const TABLE_NAME = process.env.DYNAMODB_TABLE_SESSIONS || 'parkproof-sessions'
const EVIDENCE_BUCKET = process.env.S3_BUCKET_EVIDENCE
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID
// The table index.js keeps its async jobs and rate-limit counters in. It
// also holds the deletion markers (see "Deleted accounts" below).
const JOBS_TABLE = process.env.JOBS_TABLE || 'parkproof-jobs'

// Whitelist of session fields persisted to DynamoDB. The raw session object is
// NEVER spread into the item — a body field named pk/sk would otherwise
// override the server-derived tenant key (cross-tenant write), and arbitrary
// extra fields would bloat the table. pk/sk/gsi_updated_at/rev are server-set
// only.
//
// Every field of ParkingSession (src/types.ts) is listed, including the
// evidence-chain fields of build spec N1. `chain_key` is the record's secret:
// it only ever goes to the owner's own row (and back to the owner's devices
// through /sessions/list). A test keeps this list in step with types.ts.
export const ALLOWED_SESSION_FIELDS = Object.freeze([
  'id', 'arrived_at', 'expires_at', 'ended_at', 'location', 'rules',
  'observations', 'chosen_label', 'alternate_variants', 'confidence',
  'no_sign', 'note', 'sign_photo', 'car_photo', 'ambient_photo',
  'signature', 'push_reminders', 'photo_sync_failed',
  // Evidence chain and later-task fields (build spec N1).
  'chain_key', 'photos', 'v1_hashes', 'addenda', 'condition_note',
  'compliance_type', 'gate_acks', 'rule_flags', 'sign_status', 'sign_issues',
  'recurring_restrictions', 'place', 'departure', 'driver_name',
  'permit_context', 'permit_salt', 'jurisdiction', 'workday_id', 'leg_index',
  'boundary', 'stretch_deadline', 'shared_from',
])

/**
 * Fields that describe one device's copy only, never the record: listed
 * above so the whitelist stays in step with types.ts, but never stored
 * from an upload (a field the upload leaves out is cleared, see
 * mergeSessionRows). `photo_sync_failed` says the uploading device couldn't
 * back a photo up; on another device that would be false.
 */
export const DEVICE_LOCAL_FIELDS = Object.freeze(['photo_sync_failed'])

/** The field-backed photos of records saved before the photo store, by role. */
export const LEGACY_PHOTO_FIELDS = Object.freeze({
  sign: 'sign_photo',
  car: 'car_photo',
  ambient: 'ambient_photo',
})
const LEGACY_ROLES = Object.freeze(Object.keys(LEGACY_PHOTO_FIELDS))

/** Server-managed attributes: never accepted from a client, never returned. */
const INTERNAL_KEYS = Object.freeze(['pk', 'sk', 'gsi_updated_at', 'rev'])

// The DDB item limit is 400 KB. A record with a full chain (20 signed
// addenda, each carrying its canonical payload) stays well under this.
export const MAX_SESSION_ITEM_BYTES = 300_000
export const MAX_USER_OBJECTS = 3000 // ~1000 records of photos; bounds bucket-fill abuse
/** Most addenda a row keeps (the client never queues more, MAX_ADDENDA in src/lib/evidence-chain.ts). */
export const MAX_ADDENDA = 20
/**
 * Most photo refs a row keeps. The client keeps every record within it
 * (RECORD_PHOTOS_MAX in src/lib/evidence-photos.ts, a test keeps the two
 * equal): photos added after saving are offered only while there is room.
 */
export const MAX_PHOTO_REFS = 50
/** The first conditional write plus up to 3 retries when another write changed `rev` meanwhile. */
export const MAX_UPLOAD_ATTEMPTS = 4
export const ERR_CONFLICT = 'ERR_CONFLICT'

export const SHA256_HEX_RE = /^[0-9a-f]{64}$/
const PHOTO_CONTENT_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp'])
const S3_LIST_PAGE = 1000 // S3 never returns more keys than this per ListObjectsV2 page

// Lazy-init clients — Lambda reuses module-level state across invocations,
// so we keep a singleton per cold start.
let _ddb, _s3, _cognito
function ddb() {
  if (!_ddb) {
    _ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
      marshallOptions: { removeUndefinedValues: true },
    })
  }
  return _ddb
}
function s3() {
  if (!_s3) {
    // `requestChecksumCalculation` + `responseChecksumValidation` set to
    // 'WHEN_REQUIRED' suppress the "default integrity protections" added in
    // @aws-sdk/client-s3 v3.729+, which would otherwise inject the query
    // parameter `x-amz-checksum-mode=ENABLED` into every presigned URL.
    // That parameter triggers S3 CORS preflight failures in browsers — the
    // response on the actual GET arrives WITHOUT `Access-Control-Allow-Origin`,
    // even though the bucket's CORS rule explicitly permits the origin.
    // Symptom: cross-device PDF export shows "Image could not be embedded"
    // for every photo, because materializeRemotePhotos can't fetch them.
    // We don't need checksums for evidence photos (the client re-hashes
    // photo refs itself, and jsPDF re-encodes anyway).
    _s3 = new S3Client({
      region: REGION,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }
  return _s3
}
function cognito() {
  if (!_cognito) _cognito = new CognitoIdentityProviderClient({ region: REGION })
  return _cognito
}

// ─── JWT identity extraction ──────────────────────────────────────────────
/**
 * The token's claims. API Gateway's JWT authorizer puts the validated claims
 * at `event.requestContext.authorizer.jwt.claims`. Null when there are none.
 */
function jwtClaims(event) {
  return event?.requestContext?.authorizer?.jwt?.claims ?? event?.requestContext?.authorizer?.claims ?? null
}

/**
 * Pull the Cognito user `sub` from the event.
 * Throws a 401-shaped error if missing — caller maps to an HTTP response.
 */
function requireUserId(event) {
  const sub = jwtClaims(event)?.sub
  if (!sub || typeof sub !== 'string') {
    const err = new Error('Not signed in')
    err.statusCode = 401
    throw err
  }
  return sub
}

/**
 * The token's Cognito username: `cognito:username` in an id token (what the
 * app sends), `username` in an access token. Null when it has neither.
 */
function tokenUsername(event) {
  const claims = jwtClaims(event)
  for (const name of [claims?.['cognito:username'], claims?.username]) {
    if (typeof name === 'string' && name.length > 0) return name
  }
  return null
}

function pk(userId) {
  return `USER#${userId}`
}
function sessionSk(sessionId) {
  // The frontend's session.id is already a UUID, so it is unique per record.
  return `SESSION#${sessionId}`
}

/**
 * A record id the S3 keys and the SK can safely carry: 1 to 64 characters,
 * no '/', no control characters, not '.' or '..'. The same rule as the
 * client's photo store (`isValidSessionId` in src/lib/photo-store.ts).
 */
export function isValidSessionId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return false
  if (id === '.' || id === '..' || id.includes('/')) return false
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return false
  }
  return true
}

/** S3 key of a legacy (field-backed) photo. */
export function legacyPhotoKey(userId, sessionId, role) {
  return `${userId}/${sessionId}/${role}.jpg`
}

/** S3 key of a photo ref: content-addressed, written once. */
export function refPhotoKey(userId, sessionId, sha256) {
  return `${userId}/${sessionId}/p/${sha256}.jpg`
}

// ─── Merge rules (pure) ───────────────────────────────────────────────────

const isNone = (v) => v === undefined || v === null
const isSignedAddendum = (a) => !!a && typeof a.bundle === 'object' && a.bundle !== null
const isRejectedAddendum = (a) => !isSignedAddendum(a) && !!a?.rejected

function queueOrder(a, b) {
  const seq = (Number(a.seq) || 0) - (Number(b.seq) || 0)
  if (seq !== 0) return seq
  const at = String(a.captured_at ?? '').localeCompare(String(b.captured_at ?? ''))
  if (at !== 0) return at
  return String(a.id).localeCompare(String(b.id))
}

/**
 * Merge a row's stored addenda with an upload's. Union by `id`:
 *   - an addendum on one side only is kept;
 *   - a stored signed addendum is never dropped or replaced;
 *   - otherwise the copy with a bundle wins;
 *   - when neither is signed, a rejection (final, never retried) beats a
 *     pending copy, and between two copies in the same state the upload wins.
 * Capped at MAX_ADDENDA: every stored signed addendum stays, then other
 * signed ones, then rejected, then pending, each in chain order. Returns the
 * kept addenda in chain order (seq, captured_at, id).
 */
export function mergeAddendaRows(stored, incoming) {
  const storedList = Array.isArray(stored) ? stored : []
  const incomingList = Array.isArray(incoming) ? incoming : []
  const merged = new Map()
  const storedSigned = new Set()
  for (const a of storedList) {
    if (!a || typeof a.id !== 'string' || merged.has(a.id)) continue
    merged.set(a.id, a)
    if (isSignedAddendum(a)) storedSigned.add(a.id)
  }
  for (const a of incomingList) {
    const current = merged.get(a.id)
    if (!current) {
      merged.set(a.id, a)
      continue
    }
    if (isSignedAddendum(current)) continue
    if (isSignedAddendum(a)) {
      merged.set(a.id, a)
      continue
    }
    if (isRejectedAddendum(current) && !isRejectedAddendum(a)) continue
    merged.set(a.id, a)
  }
  const all = [...merged.values()]
  if (all.length <= MAX_ADDENDA) return all.sort(queueOrder)
  const tier = (a) =>
    storedSigned.has(a.id) && isSignedAddendum(a) ? 0 : isSignedAddendum(a) ? 1 : isRejectedAddendum(a) ? 2 : 3
  const ranked = all.sort((a, b) => tier(a) - tier(b) || queueOrder(a, b))
  const mustKeep = ranked.filter((a) => tier(a) === 0)
  const rest = ranked.filter((a) => tier(a) !== 0)
  return [...mustKeep, ...rest.slice(0, Math.max(0, MAX_ADDENDA - mustKeep.length))].sort(queueOrder)
}

/** Union of photo refs by role and sha256: stored ones first, capped at MAX_PHOTO_REFS. */
export function mergePhotoRefs(stored, incoming) {
  const out = []
  const seen = new Set()
  for (const list of [stored, incoming]) {
    if (!Array.isArray(list)) continue
    for (const p of list) {
      if (!p || typeof p.role !== 'string' || typeof p.sha256 !== 'string') continue
      const key = `${p.role}/${p.sha256}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(p)
    }
  }
  return out.slice(0, MAX_PHOTO_REFS)
}

/** Fields written once per record: a stored value is never replaced. */
const WRITE_ONCE_FIELDS = Object.freeze(['signature', 'chain_key', 'v1_hashes'])
/** Fields an upload can set or change, but never clear. */
const KEEP_WHEN_INCOMING_EMPTY = Object.freeze(['ended_at', 'departure'])

/**
 * The row to store when an upload (`incoming`, already whitelisted) meets
 * the stored row (`stored`, or null for a new record). Pure.
 *
 *   - addenda: `mergeAddendaRows` (union by id, never drop a stored signed one).
 *   - photos: union by role and sha256.
 *   - signature, chain_key, v1_hashes: the stored value when there is one.
 *     The upload's is used only when nothing is stored (link 0 and the chain
 *     key are first-write-wins on the device too, and a second link 0 would
 *     orphan every addendum signed on the first).
 *   - ended_at, departure: the stored value when the upload has none.
 *   - the legacy photo fields: always null (their bytes live in S3).
 *   - everything else: last write wins, so an upload that leaves a field
 *     out (a cleared note) clears it.
 */
export function mergeSessionRows(stored, incoming) {
  const out = {}
  for (const f of ALLOWED_SESSION_FIELDS) {
    if (incoming[f] !== undefined) out[f] = incoming[f]
  }
  if (stored) {
    for (const f of KEEP_WHEN_INCOMING_EMPTY) {
      if (isNone(out[f]) && !isNone(stored[f])) out[f] = stored[f]
    }
    for (const f of WRITE_ONCE_FIELDS) {
      if (!isNone(stored[f])) out[f] = stored[f]
    }
  }
  if (stored?.addenda !== undefined || incoming.addenda !== undefined) {
    out.addenda = mergeAddendaRows(stored?.addenda, incoming.addenda)
  }
  if (stored?.photos !== undefined || incoming.photos !== undefined) {
    out.photos = mergePhotoRefs(stored?.photos, incoming.photos)
  }
  for (const field of Object.values(LEGACY_PHOTO_FIELDS)) {
    if (field in out || (stored && field in stored)) out[field] = null
  }
  return out
}

// ─── Upload validation ────────────────────────────────────────────────────

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Shape checks for the evidence lists. Rejects, never repairs. */
function readAddenda(value) {
  if (value === undefined) return undefined
  if (value === null) return []
  if (!Array.isArray(value)) throw badRequest('session.addenda must be a list')
  if (value.length > 5 * MAX_ADDENDA) throw badRequest('session.addenda has too many entries')
  value.forEach((a, i) => {
    const where = `session.addenda[${i}]`
    if (!isPlainObject(a)) throw badRequest(`${where} must be an object`)
    if (typeof a.id !== 'string' || a.id.length === 0 || a.id.length > 64) throw badRequest(`${where}.id is not valid`)
    if (!Number.isInteger(a.seq) || a.seq < 1 || a.seq > 100) throw badRequest(`${where}.seq is not valid`)
    if (typeof a.kind !== 'string' || typeof a.captured_at !== 'string') throw badRequest(`${where} is missing kind or captured_at`)
    if (!isPlainObject(a.data)) throw badRequest(`${where}.data must be an object`)
    if (a.bundle !== undefined) {
      const b = a.bundle
      if (!isPlainObject(b) || typeof b.canonical_payload !== 'string' || typeof b.signature_base64 !== 'string') {
        throw badRequest(`${where}.bundle is not valid`)
      }
    }
    if (a.rejected !== undefined && (!isPlainObject(a.rejected) || typeof a.rejected.code !== 'string')) {
      throw badRequest(`${where}.rejected is not valid`)
    }
  })
  return value
}

function readPhotoRefs(value) {
  if (value === undefined) return undefined
  if (value === null) return []
  if (!Array.isArray(value)) throw badRequest('session.photos must be a list')
  if (value.length > MAX_PHOTO_REFS) throw badRequest('session.photos has too many entries')
  value.forEach((p, i) => {
    if (!isPlainObject(p) || typeof p.role !== 'string' || typeof p.sha256 !== 'string' || !SHA256_HEX_RE.test(p.sha256)) {
      throw badRequest(`session.photos[${i}] is not valid`)
    }
  })
  return value
}

/** The whitelisted, shape-checked fields of an uploaded record. */
export function readIncomingSession(session) {
  if (!isPlainObject(session) || !session.id) {
    throw badRequest('session object with `id` is required')
  }
  if (!isValidSessionId(session.id)) throw badRequest('session id is not valid')
  const incoming = {}
  for (const f of ALLOWED_SESSION_FIELDS) {
    if (session[f] !== undefined && !DEVICE_LOCAL_FIELDS.includes(f)) incoming[f] = session[f]
  }
  const addenda = readAddenda(session.addenda)
  if (addenda !== undefined) incoming.addenda = addenda
  const photos = readPhotoRefs(session.photos)
  if (photos !== undefined) incoming.photos = photos
  return incoming
}

function revCondition(stored) {
  if (!stored) {
    return {
      ConditionExpression: 'attribute_not_exists(#pk)',
      ExpressionAttributeNames: { '#pk': 'pk' },
    }
  }
  if (typeof stored.rev === 'number') {
    return {
      ConditionExpression: '#rev = :rev',
      ExpressionAttributeNames: { '#rev': 'rev' },
      ExpressionAttributeValues: { ':rev': stored.rev },
    }
  }
  // A row written before `rev` existed.
  return {
    ConditionExpression: 'attribute_exists(#pk) AND attribute_not_exists(#rev)',
    ExpressionAttributeNames: { '#pk': 'pk', '#rev': 'rev' },
  }
}

// ─── Deleted accounts ─────────────────────────────────────────────────────
// /me/delete deletes the Cognito user last, but an id token issued before
// that stays valid until it expires (an hour by default, a day at most).
// Another device still signed in would find /sessions/list empty on its next
// full sync and upload every record and photo again, under a sub nobody can
// ever sign in as: data no one can reach or delete.
//
// So /me/delete first writes a marker to the jobs table (and stops, deleting
// nothing, when it can't), and the routes that read or add an account's data
// refuse a deleted account with 410 and {"error":"ERR_ACCOUNT_DELETED"} (the
// app signs that device out and keeps its records; the device running the
// delete ignores its own refusals while it runs). When a step after the
// marker fails, /me/delete removes the marker again (removeDeletionMarker):
// the account isn't deleted, so it works from every device, and the retry
// starts clean. /sessions/upload checks again after its write: the marker
// goes in before the sweep and both reads are strongly consistent, so either
// the upload sees the marker, or the sweep sees the row. /me/delete is never
// refused (a retry must always run), and /sessions/delete is left alone.
//
// A refused upload or presign sweeps the account's photos again, for a photo
// presigned before the marker that lands after the photo sweep. That waits
// until the marker says every row is gone (MARKER_ROWS_DELETED): if the
// delete fails in its record sweep, the account stays, and the photos of the
// rows it didn't reach must stay with them.

export const ERR_ACCOUNT_DELETED = 'ERR_ACCOUNT_DELETED'
export const ACCOUNT_DELETED_KIND = 'account-deleted'
/** The marker's state while /me/delete removes the rows: a refusal deletes no photo. */
export const MARKER_DELETING = 'deleting'
/**
 * The marker's state once every row is gone (an upload's row written later
 * is deleted by its own check): a refusal may sweep the photos again.
 */
export const MARKER_ROWS_DELETED = 'rows_deleted'
/**
 * How long a marker lives: two days, longer than any id token (a day at
 * most), and a deleted user's refresh token can't mint a new one.
 */
export const DELETION_MARKER_TTL_SECONDS = 2 * 24 * 60 * 60

/**
 * The marker's key in the jobs table. Job ids there are UUIDs and the rate
 * limiter's are RL#, so the DEL# prefix can't meet either. The status routes
 * in index.js serve UUIDs only, so a marker is never readable through them.
 */
export function deletionMarkerKey(userId) {
  return `DEL#${userId}`
}

/**
 * Mark the account deleted: the key, the kind, when, the TTL and its state
 * (MARKER_DELETING), nothing else. Resolves the marker. Throws when it can't
 * be written. It is /me/delete's first step, so nothing has been deleted yet
 * and the driver's retry runs the whole delete again, while carrying on
 * without it would answer ok and leave another device still signed in free
 * to upload everything again. The SDK has already retried throttling and
 * other transient errors by then. The error the phone gets names no role or
 * account (index.js sends its message): the detail is in the log.
 */
async function writeDeletionMarker(userId) {
  const now = Date.now()
  const marker = {
    job_id: deletionMarkerKey(userId),
    kind: ACCOUNT_DELETED_KIND,
    deleted_at: new Date(now).toISOString(),
    ttl: Math.floor(now / 1000) + DELETION_MARKER_TTL_SECONDS,
    state: MARKER_DELETING,
  }
  try {
    await ddb().send(new PutCommand({ TableName: JOBS_TABLE, Item: marker }))
  } catch (err) {
    console.error(
      `[parkproof.me.delete] user=${userId} marker write failed, nothing deleted: ${err?.name || 'error'}: ${err?.message || err}`,
    )
    throw new Error('Could not start deleting the account. Please try again.')
  }
  return marker
}

/**
 * Mark every row of the account gone (MARKER_ROWS_DELETED), the same marker
 * otherwise. Throws when it can't be written: the delete stops there and
 * removes its marker, as for any later step.
 */
async function markRowsDeleted(userId, marker) {
  try {
    await ddb().send(new PutCommand({ TableName: JOBS_TABLE, Item: { ...marker, state: MARKER_ROWS_DELETED } }))
  } catch (err) {
    console.error(`[parkproof.me.delete] user=${userId} marker update failed: ${err?.name || 'error'}: ${err?.message || err}`)
    throw new Error('Could not finish deleting the account. Please try again.')
  }
}

/** How many times a failed /me/delete tries to remove its marker. */
export const MARKER_REMOVAL_TRIES = 3
/** The wait before the second try, in ms, doubled before each try after it. */
export const MARKER_REMOVAL_BACKOFF_MS = 100

/**
 * Remove the marker after a later step of /me/delete failed (`cause`): the
 * account isn't deleted, so every device can use it again, and the driver's
 * retry writes a new one. Best effort, and it never throws: the phone gets
 * `cause` either way. A failed removal is tried again, up to
 * MARKER_REMOVAL_TRIES times in all, after a short wait (100 ms, then
 * 200 ms): a throttled or dropped DeleteItem would otherwise leave every
 * device of an account that isn't deleted refused for two days. When the
 * last try fails too it is logged, and the account's devices stay refused
 * (and signed out) until the marker lapses.
 *
 * Accepted edge cases: there is one marker per account, so of two deletes of
 * one account at once, one that fails can remove the marker the other wrote.
 * And a retry that fails after an earlier call deleted everything (its answer
 * lost) removes the marker of an account that is gone, until a later retry
 * writes it again.
 */
async function removeDeletionMarker(userId, cause) {
  const failed = `[parkproof.me.delete] user=${userId} delete failed (${cause?.name || 'error'})`
  let lastError
  for (let attempt = 1; attempt <= MARKER_REMOVAL_TRIES; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, MARKER_REMOVAL_BACKOFF_MS * 2 ** (attempt - 2)))
    try {
      await ddb().send(new DeleteCommand({ TableName: JOBS_TABLE, Key: { job_id: deletionMarkerKey(userId) } }))
      console.warn(`${failed}, marker removed`)
      return
    } catch (err) {
      lastError = err
    }
  }
  console.error(
    `${failed}, marker removal failed after ${MARKER_REMOVAL_TRIES} tries: ${lastError?.name || 'error'}: ${lastError?.message || lastError}`,
  )
}

/**
 * The account's deletion marker when /me/delete has marked it deleted, or
 * null. A strongly consistent read, so a marker written a moment before is
 * seen. Fails open: when the read itself fails (a missing IAM grant,
 * throttling) the account counts as live, because a broken check must never
 * stop every user's sync. A marker past its TTL counts as gone (DynamoDB's
 * TTL sweep is lazy, and GetItem still returns such a row): by then no token
 * for the account is still valid.
 */
async function deletionMarker(userId) {
  let marker
  try {
    const got = await ddb().send(
      new GetCommand({ TableName: JOBS_TABLE, Key: { job_id: deletionMarkerKey(userId) }, ConsistentRead: true }),
    )
    marker = got?.Item
  } catch (err) {
    console.warn(`[parkproof.account] marker check failed, allowing: ${err?.name || 'error'}: ${err?.message || err}`)
    return null
  }
  if (!marker || marker.kind !== ACCOUNT_DELETED_KIND) return null
  return typeof marker.ttl === 'number' && marker.ttl * 1000 <= Date.now() ? null : marker
}

/** True when a refusal may sweep the account's photos again: the delete has removed every row. */
function rowsGone(marker) {
  return marker.state !== MARKER_DELETING
}

/** The error a deleted account gets. index.js answers it as 410 {"error":"ERR_ACCOUNT_DELETED"}. */
function accountDeletedError() {
  const err = new Error(ERR_ACCOUNT_DELETED)
  err.statusCode = 410
  return err
}

/**
 * Sweep the account's photos again, best effort. Resolves how many objects
 * went, or 'failed'.
 */
async function resweepPhotos(route, userId) {
  if (!EVIDENCE_BUCKET) return 0
  try {
    return await deleteObjectsUnder(`${userId}/`)
  } catch (err) {
    console.error(`[parkproof.account] resweep failed route=${route} user=${userId}: ${err?.name || 'error'}`)
    return 'failed'
  }
}

/**
 * Refuse a request from a deleted account (throws the 410). With `resweep`
 * (/sessions/upload and /photos/presign, once every row is gone: rowsGone),
 * the account's photos are swept again first: a photo PUT through a URL
 * presigned just before the delete can land after its sweep, and the app
 * uploads a record's photos before its row, so the row's refusal comes
 * after them.
 */
async function refuseDeletedAccount(route, userId, { resweep = false } = {}) {
  const swept = resweep ? ` resweep_objects=${await resweepPhotos(route, userId)}` : ''
  console.log(`[parkproof.account] refused route=${route} user=${userId}${swept}`)
  throw accountDeletedError()
}

/**
 * Throws the 410 when the account has been deleted. `resweep` sweeps the
 * photos again only once the delete has removed every row (rowsGone).
 */
async function refuseIfDeleted(route, userId, { resweep = false } = {}) {
  const marker = await deletionMarker(userId)
  if (marker) await refuseDeletedAccount(route, userId, { resweep: resweep && rowsGone(marker) })
}

// ─── /sessions/upload ─────────────────────────────────────────────────────
/**
 * Merge one record into the signed-in user's row. Reads the stored row,
 * merges (`mergeSessionRows`), and writes with a condition on `rev`, so a
 * write that lands in between (another device, or two uploads of this one)
 * is never overwritten: the merge is redone from the new row, up to
 * MAX_UPLOAD_ATTEMPTS times, then 409 ERR_CONFLICT (the client retries
 * later; its local copy is untouched).
 *
 * A deleted account is refused before the write and checked again after
 * it (see "Deleted accounts"): a row written after the marker is deleted
 * again, and the upload answers 410.
 */
export async function handleSessionsUpload(event) {
  const userId = requireUserId(event)
  await refuseIfDeleted('sessions/upload', userId, { resweep: true })
  const body = parseBody(event)
  const session = body?.session
  const incoming = readIncomingSession(session)

  // Data URLs never go into DynamoDB — those bytes belong in S3, uploaded
  // separately via /photos/presign. Reported back for older clients.
  const photosMissing = Object.values(LEGACY_PHOTO_FIELDS).filter(
    (field) => typeof session[field] === 'string' && session[field].startsWith('data:'),
  )

  // pk/sk are derived from the JWT sub and set by the server only, so a
  // crafted session.pk/session.sk in the body can't redirect the write to
  // another user's partition (and they aren't whitelisted anyway).
  const key = { pk: pk(userId), sk: sessionSk(incoming.id) }
  for (let attempt = 1; ; attempt++) {
    const got = await ddb().send(new GetCommand({ TableName: TABLE_NAME, Key: key, ConsistentRead: true }))
    const stored = got?.Item ?? null
    const rev = typeof stored?.rev === 'number' ? stored.rev : 0
    const item = {
      ...mergeSessionRows(stored, incoming),
      ...key,
      gsi_updated_at: new Date().toISOString(), // for future incremental sync GSI
      rev: rev + 1,
    }
    if (Buffer.byteLength(JSON.stringify(item), 'utf8') > MAX_SESSION_ITEM_BYTES) {
      throw badRequest('session record too large')
    }
    try {
      await ddb().send(new PutCommand({ TableName: TABLE_NAME, Item: item, ...revCondition(stored) }))
    } catch (err) {
      if (err?.name !== 'ConditionalCheckFailedException') throw err
      if (attempt >= MAX_UPLOAD_ATTEMPTS) {
        const conflict = new Error(`${ERR_CONFLICT}: the record changed while it was being saved; try again`)
        conflict.statusCode = 409
        throw conflict
      }
      continue
    }
    // Checked again now the row is written. /me/delete writes its marker
    // before it sweeps: a marker written after this write means the sweep
    // finds the row, and one written before it is found here, so a row the
    // sweep may have missed is deleted now.
    const marker = await deletionMarker(userId)
    if (marker) {
      await deleteRowBestEffort(key, userId, incoming.id)
      await refuseDeletedAccount('sessions/upload', userId, { resweep: rowsGone(marker) })
    }
    return { ok: true, session_id: incoming.id, photos_missing: photosMissing, rev: rev + 1 }
  }
}

/** Delete a row an upload wrote under a deleted account. A failure is logged and left for the owner to clear. */
async function deleteRowBestEffort(key, userId, sessionId) {
  try {
    await ddb().send(new DeleteCommand({ TableName: TABLE_NAME, Key: key }))
  } catch (err) {
    console.error(
      `[parkproof.account] row delete after refusal failed user=${userId} record=${sessionId}: ${err?.name || 'error'}`,
    )
  }
}

// ─── Reading rows ─────────────────────────────────────────────────────────

/**
 * Every row of the user's partition, following DynamoDB's pages. A strongly
 * consistent read: an eventually consistent Query just after a
 * /sessions/delete can still return the deleted row, and a phone that
 * pulls it back re-uploads it on its next full sync, undoing the delete.
 */
async function queryAllRows(userId, scanForward) {
  const rows = []
  let lastKey
  do {
    const page = await ddb().send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk(userId) },
        ConsistentRead: true,
        ExclusiveStartKey: lastKey,
        ...(scanForward === undefined ? {} : { ScanIndexForward: scanForward }),
      }),
    )
    rows.push(...(page.Items ?? []))
    lastKey = page.LastEvaluatedKey
  } while (lastKey)
  return rows
}

/** Every S3 key under the user's prefix: one paginated ListObjectsV2. */
async function listUserObjectKeys(userId) {
  const keys = new Set()
  let token
  do {
    const page = await s3().send(
      new ListObjectsV2Command({
        Bucket: EVIDENCE_BUCKET,
        Prefix: `${userId}/`,
        MaxKeys: S3_LIST_PAGE,
        ContinuationToken: token,
      }),
    )
    for (const o of page.Contents ?? []) if (typeof o.Key === 'string') keys.add(o.Key)
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return keys
}

/**
 * How many objects the user has, counted page by page and stopping once
 * `limit` is reached (a single ListObjectsV2 page never holds more than
 * 1000 keys, so one call can't count past that).
 */
async function countUserObjects(userId, limit) {
  let count = 0
  let token
  do {
    const page = await s3().send(
      new ListObjectsV2Command({
        Bucket: EVIDENCE_BUCKET,
        Prefix: `${userId}/`,
        MaxKeys: S3_LIST_PAGE,
        ContinuationToken: token,
      }),
    )
    count += page.KeyCount ?? (page.Contents ?? []).length
    if (count >= limit) return count
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return count
}

function hasPhotoRefFor(row, role) {
  return Array.isArray(row.photos) && row.photos.some((p) => p && p.role === role && typeof p.sha256 === 'string')
}

/**
 * Put a fresh presigned GET URL on each legacy photo field whose S3 object
 * exists, and null on the rest (a URL stored in an old row has long
 * expired). A role the record has a photo ref for is never hydrated: its
 * bytes are content-addressed and read through /photos/materialize.
 */
async function hydrateLegacyPhotos(rows, userId, existingKeys) {
  for (const row of rows) {
    for (const role of LEGACY_ROLES) {
      const field = LEGACY_PHOTO_FIELDS[role]
      const key = legacyPhotoKey(userId, row.id, role)
      if (!hasPhotoRefFor(row, role) && existingKeys.has(key)) {
        row[field] = await getSignedUrl(
          s3(),
          new GetObjectCommand({ Bucket: EVIDENCE_BUCKET, Key: key }),
          // 1 hour — comfortably longer than a typical user's app session, and
          // re-running /sessions/list re-mints fresh URLs anyway.
          { expiresIn: 3600 },
        )
      } else if (row[field] !== undefined) {
        row[field] = null
      }
    }
  }
}

async function hydrateBestEffort(rows, userId) {
  if (!EVIDENCE_BUCKET) return
  try {
    await hydrateLegacyPhotos(rows, userId, await listUserObjectKeys(userId))
  } catch (err) {
    // Best-effort — don't fail the whole response if S3 is flaky.
    console.warn('[cloud-sync] photo hydrate failed:', err?.message ?? err)
    for (const row of rows) {
      for (const field of Object.values(LEGACY_PHOTO_FIELDS)) if (row[field] !== undefined) row[field] = null
    }
  }
}

// ─── /sessions/list ───────────────────────────────────────────────────────
export async function handleSessionsList(event) {
  const userId = requireUserId(event)
  // A deleted account's list would be empty, and a device that reads it so
  // would upload all its records again.
  await refuseIfDeleted('sessions/list', userId)
  // Newest first by descending SK.
  const sessions = (await queryAllRows(userId, false)).map(stripInternalKeys)
  await hydrateBestEffort(sessions, userId)
  return { sessions }
}

async function objectExists(key) {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: EVIDENCE_BUCKET, Key: key }))
    return true
  } catch (err) {
    // S3 returns 404 NoSuchKey via $metadata.httpStatusCode on HEAD.
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') {
      return false
    }
    // Any other error (perms, throttle) — log and treat as absent.
    console.warn(`[cloud-sync] HEAD ${key} failed:`, err?.message ?? err)
    return false
  }
}

// ─── /sessions/delete ─────────────────────────────────────────────────────
export async function handleSessionsDelete(event) {
  const userId = requireUserId(event)
  const body = parseBody(event)
  const sessionId = body?.session_id
  if (typeof sessionId !== 'string' || !sessionId) {
    throw badRequest('session_id is required')
  }

  await ddb().send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { pk: pk(userId), sk: sessionSk(sessionId) },
    }),
  )

  // Best-effort sweep of every photo under that record's S3 prefix (legacy
  // per-role objects and content-addressed refs alike).
  if (EVIDENCE_BUCKET && isValidSessionId(sessionId)) {
    await deletePhotosForSession(userId, sessionId)
  }
  return { ok: true, session_id: sessionId }
}

// ─── Photo request bodies ─────────────────────────────────────────────────

/**
 * Which photo a /photos/* request means: `{ session_id, sha256 }` for a
 * photo ref (content-addressed), `{ session_id, role }` for a legacy photo.
 */
export function readPhotoTarget(body, userId) {
  const sessionId = body?.session_id
  if (!isValidSessionId(sessionId)) throw badRequest('session_id is required')
  if (body.sha256 !== undefined) {
    if (body.role !== undefined) throw badRequest('send either role or sha256, not both')
    if (typeof body.sha256 !== 'string' || !SHA256_HEX_RE.test(body.sha256)) {
      throw badRequest('sha256 must be 64 lowercase hex characters')
    }
    return { sessionId, sha256: body.sha256, key: refPhotoKey(userId, sessionId, body.sha256) }
  }
  const role = body.role
  if (!LEGACY_ROLES.includes(role)) {
    throw badRequest('session_id + role ("sign", "car", or "ambient") or sha256 are required')
  }
  return { sessionId, role, key: legacyPhotoKey(userId, sessionId, role) }
}

function readContentType(value) {
  if (value === undefined || value === null) return 'image/jpeg'
  if (!PHOTO_CONTENT_TYPES.includes(value)) throw badRequest('content_type must be image/jpeg, image/png or image/webp')
  return value
}

// ─── /photos/presign ──────────────────────────────────────────────────────
/**
 * Issue a presigned PUT URL the browser uses to upload a photo direct to S3.
 * Lambda never sees the photo bytes — keeps the request small and avoids the
 * 6MB API Gateway payload limit.
 *
 * A photo ref's key is content-addressed and written once: when the object
 * already exists the response is `{ exists: true, key }` and no URL, so the
 * client marks it uploaded without sending the bytes again.
 */
export async function handlePhotosPresign(event) {
  const userId = requireUserId(event)
  await refuseIfDeleted('photos/presign', userId, { resweep: true })
  if (!EVIDENCE_BUCKET) {
    throw new Error('S3_BUCKET_EVIDENCE not configured')
  }
  const body = parseBody(event)
  const target = readPhotoTarget(body, userId)
  const contentType = readContentType(body?.content_type)

  const exists = await objectExists(target.key)
  if (target.sha256 && exists) {
    return { exists: true, key: target.key, bucket: EVIDENCE_BUCKET }
  }

  // Per-user object-count ceiling. A presigned PUT can't enforce a per-object
  // size (that needs presigned POST), so the count cap is the practical guard
  // against a single (cheap, self-serve) account filling the evidence bucket.
  // Replacing a legacy photo overwrites its one key, so that is allowed at
  // the cap.
  if (!exists && (await countUserObjects(userId, MAX_USER_OBJECTS)) >= MAX_USER_OBJECTS) {
    throw badRequest('photo storage limit reached for this account')
  }

  const url = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: EVIDENCE_BUCKET,
      Key: target.key,
      ContentType: contentType,
    }),
    { expiresIn: 300 }, // 5 min upload window, plenty even on slow 3G
  )
  return { url, key: target.key, bucket: EVIDENCE_BUCKET }
}

// ─── /photos/materialize ──────────────────────────────────────────────────
/**
 * Server-side photo proxy. Replaces the older browser-direct-to-S3 fetch
 * path that materializeRemotePhotos in src/lib/pdf.ts used. The browser-
 * direct path worked everywhere on desktop but failed on some mobile
 * browsers (Android Chrome over 5G observed, status=0 errors at 4-6ms,
 * no CORS error logged) — likely a carrier/privacy-layer interaction
 * with the long presigned S3 URLs. Going through the API removes the
 * cross-origin S3 hop entirely.
 *
 * Auth: JWT (same as /sessions/list). The caller can only materialize
 * photos under their own `{sub}/` prefix — we construct the S3 key from
 * the JWT's sub, not from anything in the request body.
 *
 * Request:  POST /photos/materialize  { session_id, sha256 } (a photo ref)
 *                                  or { session_id, role }   (a legacy photo)
 * Response: { data_url: "data:image/jpeg;base64,..." }  or  { data_url: null }
 *
 * Best-effort: returns `data_url: null` when the S3 object doesn't exist.
 * The client checks a photo ref's bytes against its sha256 before using or
 * caching them.
 */
export async function handlePhotosMaterialize(event) {
  const userId = requireUserId(event)
  await refuseIfDeleted('photos/materialize', userId)
  if (!EVIDENCE_BUCKET) {
    throw new Error('S3_BUCKET_EVIDENCE not configured')
  }
  const body = parseBody(event)
  const { key } = readPhotoTarget(body, userId)
  try {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: EVIDENCE_BUCKET, Key: key }),
    )
    // res.Body is a Readable stream in Node Lambda runtime. Collect chunks
    // into a Buffer, then base64-encode for the data URL.
    const chunks = []
    for await (const chunk of res.Body) {
      chunks.push(chunk)
    }
    const buf = Buffer.concat(chunks)
    const contentType = PHOTO_CONTENT_TYPES.includes(res.ContentType) ? res.ContentType : 'image/jpeg'
    const dataUrl = `data:${contentType};base64,${buf.toString('base64')}`
    return { data_url: dataUrl }
  } catch (err) {
    // S3 returns NoSuchKey via err.name on GetObject. Treat as benign null —
    // the photo was never uploaded.
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      return { data_url: null }
    }
    console.warn(`[cloud-sync] materialize GET ${key} failed:`, err?.message ?? err)
    throw err
  }
}

// ─── /me/export ───────────────────────────────────────────────────────────
/**
 * Returns the user's full dataset as JSON. The frontend renders it as the
 * full-export PDF. Legacy photo fields carry fresh presigned URLs (as in
 * /sessions/list); photo refs are listed in each record's `photos`. Each
 * record's `chain_key` is left out: it is a credential for extending the
 * record's signed chain, not information about the user, and an export
 * file can travel further than the user's own devices.
 */
export async function handleMeExport(event) {
  const userId = requireUserId(event)
  await refuseIfDeleted('me/export', userId)
  const claims = event.requestContext.authorizer.jwt.claims
  const sessions = (await queryAllRows(userId)).map((row) => {
    const out = stripInternalKeys(row)
    delete out.chain_key
    return out
  })
  await hydrateBestEffort(sessions, userId)

  return {
    exported_at: new Date().toISOString(),
    schema: 'parkproof-export-v1',
    account: {
      user_id: userId,
      email: claims.email ?? null,
      created_at: claims.iat ? new Date(Number(claims.iat) * 1000).toISOString() : null,
    },
    sessions,
    notes:
      'This export contains everything ParkProof stores about your account: '
      + 'account metadata + every parking record. Photos saved before the photo store '
      + 'carry a link that works for one hour; newer photos are listed by SHA-256 '
      + 'fingerprint and stay in your account. ',
  }
}

// ─── /me/delete ───────────────────────────────────────────────────────────
/**
 * Nukes the account end-to-end: every record row, every S3 object (old
 * versions included, see deleteObjectsUnder), and the Cognito user record
 * itself. Irreversible: the app confirms before calling. What stays after a
 * delete that worked is the deletion marker, for two days (see "Deleted
 * accounts").
 *
 * Safe to call again. A call can delete everything and still lose its answer
 * on the way back to the phone. The phone's retry then finds the Cognito user
 * already gone, which counts as deleted (deleteCognitoUser), so the retry
 * answers ok and the phone can sign out and clear itself. The Cognito user
 * goes last, so every call, a retry included, sweeps the rows and photos
 * first, and a retry's sweeps also remove anything uploaded since.
 *
 * Before any of that, the account is marked deleted (see "Deleted
 * accounts"), so another device still signed in can't upload it all again,
 * and the marker says so again once every row is gone. When a later step
 * fails, the marker is removed before the error is answered, so a failed
 * delete leaves the account usable from every device. This route never
 * checks the marker: a retry must always run.
 */
export async function handleMeDelete(event) {
  const userId = requireUserId(event)

  // 1. The deletion marker, first, so an upload that arrives during the
  // sweep is refused. A failed write stops the delete here, before anything
  // is deleted, and the driver tries again.
  const marker = await writeDeletionMarker(userId)

  // 2 to 4. The rows, the photos and the Cognito user. When any of them
  // fails, the account isn't deleted: the marker goes again, and the phone
  // gets the step's own error.
  let deleted
  try {
    deleted = await deleteAccountData(userId, tokenUsername(event), marker)
  } catch (err) {
    await removeDeletionMarker(userId, err)
    throw err
  }

  console.log(
    `[parkproof.me.delete] user=${userId} marker=written deleted_rows=${deleted.rows} deleted_objects=${deleted.objects} cognito=${deleted.cognitoUser}`,
  )
  return { ok: true, deleted_rows: deleted.rows, deleted_objects: deleted.objects }
}

/**
 * /me/delete's steps after the marker, in order: every row, the marker's
 * MARKER_ROWS_DELETED, every photo, then the Cognito user. Resolves what
 * went, and throws at the first step that fails, with the later ones not run.
 */
async function deleteAccountData(userId, username, marker) {
  // 2. Sweep DynamoDB rows in batches of 25 (BatchWriteItem max).
  let deletedRows = 0
  let lastKey
  do {
    const page = await ddb().send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk(userId) },
        // Strongly consistent, as in queryAllRows: an eventually consistent
        // read can miss a row uploaded a moment before, and leave it behind.
        ConsistentRead: true,
        ExclusiveStartKey: lastKey,
        ProjectionExpression: 'pk, sk',
      }),
    )
    const items = page.Items ?? []
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25)
      // BatchWrite returns UnprocessedItems on partial throttling instead of
      // throwing. Drain them with backoff — otherwise rows could survive while
      // the code still deletes the S3 photos and the Cognito user, orphaning a
      // user's data under an unreachable account and reporting a false success.
      let unprocessed = {
        [TABLE_NAME]: batch.map((it) => ({
          DeleteRequest: { Key: { pk: it.pk, sk: it.sk } },
        })),
      }
      for (let attempt = 0; attempt < 6 && Object.keys(unprocessed).length > 0; attempt++) {
        const resp = await ddb().send(new BatchWriteCommand({ RequestItems: unprocessed }))
        unprocessed =
          resp.UnprocessedItems && Object.keys(resp.UnprocessedItems).length > 0
            ? resp.UnprocessedItems
            : {}
        if (Object.keys(unprocessed).length > 0) {
          await new Promise((r) => setTimeout(r, 100 * 2 ** attempt))
        }
      }
      if (Object.keys(unprocessed).length > 0) {
        // Stop BEFORE the Cognito delete so the user can re-invoke and finish
        // the erasure rather than being locked out with rows still present.
        throw new Error('Could not delete every record. Please try again.')
      }
      deletedRows += batch.length
    }
    lastKey = page.LastEvaluatedKey
  } while (lastKey)

  // Every row is gone (an upload's row written from now on is deleted by its
  // own check), so a refusal may sweep the photos again from here.
  await markRowsDeleted(userId, marker)

  // 3. Sweep S3 objects under <userId>/, paginated for large accounts.
  let deletedObjects = 0
  if (EVIDENCE_BUCKET) {
    deletedObjects = await deleteObjectsUnder(`${userId}/`)
  }

  // 4. Delete the Cognito user record itself, last, so that a retry always
  // runs both sweeps first. After this returns, the JWT remains valid until
  // it expires (~1h default) but no further sign-in is possible, and the
  // marker refuses what another device sends with it.
  let cognitoUser = 'skipped'
  if (USER_POOL_ID) {
    cognitoUser = await deleteCognitoUser(userId, username)
  }

  return { rows: deletedRows, objects: deletedObjects, cognitoUser }
}

/**
 * Delete the token's Cognito user. Resolves 'deleted', or 'already_deleted'
 * when the user is gone, which is what a retry finds after a call that
 * deleted the user but whose answer was lost. Every other error is thrown,
 * so the route fails and the driver can try again.
 *
 * AdminDeleteUser finds a user by username, or by the sub of a local user
 * only: an Apple or Google user's sub finds no one. So the user is named by
 * the token's username (a local user's username is their sub in this pool,
 * which signs in with email), and a user that name can't find is gone. A
 * token without a username leaves only the sub, and then not finding the
 * user is an error: it can't tell a deleted user from an Apple or Google one.
 *
 * An Apple or Google username can be taken again: the same Apple or Google
 * account signing in after a delete makes a new user, with a new sub, under
 * the same username. So before deleting by a username that isn't the token's
 * sub, Cognito is asked whose it is, and a user with another sub is left alone.
 */
async function deleteCognitoUser(sub, username) {
  const name = username ?? sub
  try {
    if (name !== sub) {
      const user = await cognito().send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: name }))
      const userSub = user?.UserAttributes?.find((a) => a?.Name === 'sub')?.Value
      // A newer user has the username, so the token's own user is gone.
      if (typeof userSub === 'string' && userSub !== sub) return 'already_deleted'
    }
    await cognito().send(new AdminDeleteUserCommand({ UserPoolId: USER_POOL_ID, Username: name }))
    return 'deleted'
  } catch (err) {
    if (err?.name === 'UserNotFoundException' && username !== null) return 'already_deleted'
    throw err
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function parseBody(event) {
  if (!event.body) return {}
  if (typeof event.body === 'string') {
    try {
      return JSON.parse(event.body)
    } catch {
      return {}
    }
  }
  return event.body
}

function badRequest(msg) {
  const err = new Error(msg)
  err.statusCode = 400
  return err
}

/** A row without the server-managed attributes (the partition-key shape, rev). */
function stripInternalKeys(row) {
  const out = { ...row }
  for (const k of INTERNAL_KEYS) delete out[k]
  return out
}

/**
 * Delete everything under a prefix, old versions included. Resolves with how
 * many photo versions went (delete markers aren't counted).
 *
 * The evidence bucket is versioned (setup-auth.sh), and deleting a key
 * without its VersionId only adds a delete marker: the photo's bytes stay
 * as an old version. So every version and delete marker under the prefix is
 * listed (ListObjectVersions) and deleted by its VersionId, which needs
 * s3:ListBucketVersions and s3:DeleteObjectVersion
 * (scripts/setup-evidence-versions.sh). Without them S3 answers
 * AccessDenied: the current photos are then deleted by key, as before, so
 * none can be read, and an error is logged. Their old versions stay until
 * the bucket's lifecycle rule (the same script) removes them.
 */
async function deleteObjectsUnder(prefix) {
  try {
    return await deleteEveryVersionUnder(prefix)
  } catch (err) {
    if (err?.name !== 'AccessDenied') throw err
    console.error(
      '[parkproof.s3] AccessDenied deleting old photo versions: deleted the current photos only. Run scripts/setup-evidence-versions.sh.',
    )
    return deleteCurrentObjectsUnder(prefix)
  }
}

/**
 * Every version and delete marker under a prefix, deleted by VersionId.
 * Each pass lists from the start (the pass before deleted all it listed), so
 * no listing ever starts from a version that is gone. A failed delete throws,
 * named AccessDenied when that was every failure, so it can't loop.
 */
async function deleteEveryVersionUnder(prefix) {
  let deleted = 0
  let lastFirst = null
  for (;;) {
    const page = await s3().send(
      new ListObjectVersionsCommand({ Bucket: EVIDENCE_BUCKET, Prefix: prefix, MaxKeys: S3_LIST_PAGE }),
    )
    const versions = (page.Versions ?? []).filter((v) => typeof v?.Key === 'string')
    const markers = (page.DeleteMarkers ?? []).filter((m) => typeof m?.Key === 'string')
    const entries = [...versions, ...markers].map((v) => ({ Key: v.Key, VersionId: v.VersionId }))
    if (entries.length === 0) return deleted
    // The same first entry again means the last pass deleted nothing.
    const first = `${entries[0].Key}\n${entries[0].VersionId}`
    if (first === lastFirst) throw new Error('Could not delete every photo. Please try again.')
    lastFirst = first
    const res = await s3().send(
      new DeleteObjectsCommand({ Bucket: EVIDENCE_BUCKET, Delete: { Objects: entries, Quiet: true } }),
    )
    // Quiet: the answer lists only the deletes that failed, each with a code.
    const failed = res?.Errors ?? []
    if (failed.length > 0) {
      const codes = [...new Set(failed.map((e) => e?.Code || 'unknown'))]
      console.error(`[parkproof.s3] ${failed.length} of ${entries.length} versions not deleted: ${codes.join(', ')}`)
      const err = new Error('Could not delete every photo. Please try again.')
      if (codes.every((c) => c === 'AccessDenied')) err.name = 'AccessDenied'
      throw err
    }
    deleted += versions.length
  }
}

/** Every current object under a prefix, deleted by key (a delete marker each). Resolves with how many. */
async function deleteCurrentObjectsUnder(prefix) {
  let deleted = 0
  let token
  do {
    const list = await s3().send(
      new ListObjectsV2Command({
        Bucket: EVIDENCE_BUCKET,
        Prefix: prefix,
        MaxKeys: S3_LIST_PAGE,
        ContinuationToken: token,
      }),
    )
    const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key }))
    if (keys.length > 0) {
      await s3().send(
        new DeleteObjectsCommand({
          Bucket: EVIDENCE_BUCKET,
          Delete: { Objects: keys, Quiet: true },
        }),
      )
      deleted += keys.length
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (token)
  return deleted
}

async function deletePhotosForSession(userId, sessionId) {
  if (!EVIDENCE_BUCKET) return
  await deleteObjectsUnder(`${userId}/${sessionId}/`)
}
