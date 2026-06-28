// ParkProof — cloud sync handlers.
//
// Six routes, all JWT-protected by API Gateway's Cognito authorizer:
//   POST   /sessions/upload   — write one session for the signed-in user
//   GET    /sessions/list     — list all sessions for the signed-in user
//   POST   /sessions/delete   — delete one (incl. its S3 photos)
//   POST   /photos/presign    — issue a presigned S3 URL for a direct photo upload
//   GET    /me/export         — return the user's full data as JSON
//   POST   /me/delete         — nuke everything (DDB rows + S3 objects + Cognito user)
//
// Anonymous-by-default is preserved by keeping the original /sign-translate,
// /sign-session, /draft-appeal and /feedback routes unauthenticated. Only the
// /sessions/*, /photos/* and /me/* routes require sign-in.

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
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
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
} from '@aws-sdk/client-cognito-identity-provider'

const REGION = process.env.AWS_REGION || 'ap-southeast-2'
const TABLE_NAME = process.env.DYNAMODB_TABLE_SESSIONS || 'parkproof-sessions'
const EVIDENCE_BUCKET = process.env.S3_BUCKET_EVIDENCE
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID

// Whitelist of session fields persisted to DynamoDB. The raw session object is
// NEVER spread into the item — a body field named pk/sk would otherwise
// override the server-derived tenant key (cross-tenant write), and arbitrary
// extra fields would bloat the table. pk/sk/gsi_updated_at are server-set only.
const ALLOWED_SESSION_FIELDS = [
  'id', 'arrived_at', 'expires_at', 'ended_at', 'location', 'rules',
  'observations', 'chosen_label', 'alternate_variants', 'confidence',
  'no_sign', 'note', 'sign_photo', 'car_photo', 'ambient_photo',
  'signature', 'push_reminders', 'photo_sync_failed',
]
const MAX_SESSION_ITEM_BYTES = 50_000 // well under the 400KB DDB item limit
const MAX_USER_OBJECTS = 3000 // ~1000 sessions of photos; bounds bucket-fill abuse

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
    // We don't need checksums for evidence photos (jsPDF re-encodes anyway).
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
 * Pull the Cognito user `sub` from the event. API Gateway's JWT authorizer
 * puts the validated claims at `event.requestContext.authorizer.jwt.claims`.
 * Throws a 401-shaped error if missing — caller maps to an HTTP response.
 */
function requireUserId(event) {
  const claims =
    event?.requestContext?.authorizer?.jwt?.claims ??
    event?.requestContext?.authorizer?.claims ??
    null
  const sub = claims?.sub
  if (!sub || typeof sub !== 'string') {
    const err = new Error('Not signed in')
    err.statusCode = 401
    throw err
  }
  return sub
}

function pk(userId) {
  return `USER#${userId}`
}
function sessionSk(sessionId) {
  // Random-suffix the SK so two sessions saved in the same millisecond don't
  // collide. The frontend's session.id is already a UUID, so include it.
  return `SESSION#${sessionId}`
}

// ─── /sessions/upload ─────────────────────────────────────────────────────
export async function handleSessionsUpload(event) {
  const userId = requireUserId(event)
  const body = parseBody(event)
  const session = body?.session
  if (!session || typeof session !== 'object' || !session.id) {
    throw badRequest('session object with `id` is required')
  }

  // Strip the bulky photo data URLs before writing to DynamoDB — those
  // belong in S3, with the DDB row carrying only the S3 keys. Frontend is
  // expected to upload photos separately via /photos/presign.
  const photosMissing = []
  for (const field of ['sign_photo', 'car_photo', 'ambient_photo']) {
    if (session[field] && session[field].startsWith('data:')) {
      photosMissing.push(field)
      session[field] = null // store nothing; client should re-upload separately
    }
  }

  // Write the session as a DynamoDB row — whitelisted, never spread. pk/sk are
  // derived from the JWT sub and set by the server only, so a crafted
  // session.pk/session.sk in the body can't redirect the write to another
  // user's partition.
  const item = {
    pk: pk(userId),
    sk: sessionSk(session.id),
    gsi_updated_at: new Date().toISOString(), // for future incremental sync GSI
  }
  for (const f of ALLOWED_SESSION_FIELDS) {
    if (session[f] !== undefined) item[f] = session[f]
  }
  if (Buffer.byteLength(JSON.stringify(item), 'utf8') > MAX_SESSION_ITEM_BYTES) {
    throw badRequest('session record too large')
  }
  await ddb().send(new PutCommand({ TableName: TABLE_NAME, Item: item }))

  return {
    ok: true,
    session_id: session.id,
    photos_missing: photosMissing,
  }
}

// ─── /sessions/list ───────────────────────────────────────────────────────
export async function handleSessionsList(event) {
  const userId = requireUserId(event)
  const result = await ddb().send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': pk(userId) },
      // Sort newest first by descending SK (SESSION#<arrived_at>).
      ScanIndexForward: false,
    }),
  )
  const rawSessions = (result.Items ?? []).map(stripInternalKeys)

  // Hydrate photos. The DDB row stores `sign_photo: null` / `car_photo: null`
  // (we strip data URLs on the upload path to stay under the 400KB item limit).
  // The actual photo bytes live at `{userId}/{sessionId}/{role}.jpg` in the
  // evidence S3 bucket. Mint short-TTL presigned GET URLs here so the client
  // can drop them straight into <img src=...>.
  //
  // We HEAD each object first to avoid handing the client a URL that 404s —
  // sessions saved on devices that never made it past upload (or older rows
  // from before this code shipped) won't have photos in S3 yet.
  if (EVIDENCE_BUCKET) {
    await Promise.all(
      rawSessions.map((session) =>
        hydrateSessionPhotos(session, userId).catch((err) => {
          // Best-effort — don't fail the whole list response if S3 is flaky.
          console.warn(
            `[cloud-sync] photo hydrate failed for ${session.id}:`,
            err?.message ?? err,
          )
        }),
      ),
    )
  }

  return { sessions: rawSessions }
}

/**
 * Best-effort: for each photo role, check S3 has an object at the canonical
 * key. If present, mutate the session in place so `session.sign_photo` /
 * `session.car_photo` becomes a short-TTL presigned GET URL the browser can
 * fetch directly.
 *
 * Why HEAD before presign: the SDK happily signs any URL regardless of
 * whether the object exists. Handing the client a 404-returning URL works
 * but is wasteful — the <img> still tries to fetch, the browser logs a
 * network error, and the user sees a broken-image icon for a frame. The
 * extra HEAD is one round-trip per session, well under the list-route's
 * existing latency budget.
 */
async function hydrateSessionPhotos(session, userId) {
  for (const role of ['sign', 'car', 'ambient']) {
    const field = `${role}_photo`
    // If the cloud row already carries something (an external URL, or — in
    // future — a still-fresh presigned URL the upload path stamped on),
    // don't overwrite it.
    if (session[field]) continue
    const key = `${userId}/${session.id}/${role}.jpg`
    const exists = await objectExists(key)
    if (!exists) continue
    session[field] = await getSignedUrl(
      s3(),
      new GetObjectCommand({ Bucket: EVIDENCE_BUCKET, Key: key }),
      // 1 hour — comfortably longer than a typical user's app session, and
      // re-running /sessions/list re-mints fresh URLs anyway.
      { expiresIn: 3600 },
    )
  }
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
    // Any other error (perms, throttle) — log and treat as absent. Better to
    // hide the image than show a broken one.
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

  // Best-effort sweep of any photos under that session's S3 prefix.
  if (EVIDENCE_BUCKET) {
    await deletePhotosForSession(userId, sessionId)
  }
  return { ok: true, session_id: sessionId }
}

// ─── /photos/presign ──────────────────────────────────────────────────────
/**
 * Issue a presigned PUT URL the browser uses to upload a photo direct to S3.
 * Lambda never sees the photo bytes — keeps the request small and avoids the
 * 6MB API Gateway payload limit.
 */
export async function handlePhotosPresign(event) {
  const userId = requireUserId(event)
  if (!EVIDENCE_BUCKET) {
    throw new Error('S3_BUCKET_EVIDENCE not configured')
  }
  const body = parseBody(event)
  const sessionId = body?.session_id
  const role = body?.role // 'sign' | 'car' | 'ambient'
  const contentType = body?.content_type || 'image/jpeg'
  if (!sessionId || (role !== 'sign' && role !== 'car' && role !== 'ambient')) {
    throw badRequest('session_id + role ("sign", "car", or "ambient") are required')
  }

  // Per-user object-count ceiling. A presigned PUT can't enforce a per-object
  // size (that needs presigned POST), so the count cap is the practical guard
  // against a single (cheap, self-serve) account filling the evidence bucket.
  // Re-uploading the same session/role overwrites one key, so this doesn't
  // block legitimate re-saves.
  const existing = await s3().send(
    new ListObjectsV2Command({
      Bucket: EVIDENCE_BUCKET,
      Prefix: `${userId}/`,
      MaxKeys: MAX_USER_OBJECTS + 1,
    }),
  )
  if ((existing.KeyCount ?? 0) > MAX_USER_OBJECTS) {
    throw badRequest('photo storage limit reached for this account')
  }

  const key = `${userId}/${sessionId}/${role}.jpg`
  const url = await getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: EVIDENCE_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 300 }, // 5 min upload window — plenty even on slow 3G
  )
  return { url, key, bucket: EVIDENCE_BUCKET }
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
 * Request:  POST /photos/materialize  { session_id, role }
 * Response: { data_url: "data:image/jpeg;base64,..." }  or  { data_url: null }
 *
 * Best-effort: returns `data_url: null` when the S3 object doesn't exist
 * (historical sessions from before the CORS fix). The frontend treats
 * null the same as a fetch failure — falls back to the "could not embed"
 * placeholder for that one photo, doesn't break the whole PDF.
 */
export async function handlePhotosMaterialize(event) {
  const userId = requireUserId(event)
  if (!EVIDENCE_BUCKET) {
    throw new Error('S3_BUCKET_EVIDENCE not configured')
  }
  const body = parseBody(event)
  const sessionId = body?.session_id
  const role = body?.role // 'sign' | 'car' | 'ambient'
  if (!sessionId || (role !== 'sign' && role !== 'car' && role !== 'ambient')) {
    throw badRequest(
      'session_id + role ("sign", "car", or "ambient") are required',
    )
  }

  const key = `${userId}/${sessionId}/${role}.jpg`
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
    const contentType = res.ContentType || 'image/jpeg'
    const dataUrl = `data:${contentType};base64,${buf.toString('base64')}`
    return { data_url: dataUrl }
  } catch (err) {
    // S3 returns NoSuchKey via err.name on GetObject. Treat as benign null —
    // the photo was never uploaded (the historical-session case).
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      return { data_url: null }
    }
    console.warn(`[cloud-sync] materialize GET ${key} failed:`, err?.message ?? err)
    throw err
  }
}

// ─── /me/export ───────────────────────────────────────────────────────────
/**
 * Returns the user's full dataset as a JSON blob. The frontend downloads it
 * as a file — satisfies the "give me everything you have on me" obligation.
 */
export async function handleMeExport(event) {
  const userId = requireUserId(event)
  const claims = event.requestContext.authorizer.jwt.claims
  const sessions = await ddb()
    .send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk(userId) },
      }),
    )
    .then((r) => (r.Items ?? []).map(stripInternalKeys))

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
      + 'account metadata + every parking session. Photos are referenced by S3 key — '
      + 'visit /photos/<key> with your signed-in browser to download each one. ',
  }
}

// ─── /me/delete ───────────────────────────────────────────────────────────
/**
 * Nukes the account end-to-end: every DynamoDB row, every S3 object, and the
 * Cognito user record itself. Irreversible — frontend confirms before calling.
 */
export async function handleMeDelete(event) {
  const userId = requireUserId(event)

  // 1. Sweep DynamoDB rows in batches of 25 (BatchWriteItem max).
  let deletedRows = 0
  let lastKey
  do {
    const page = await ddb().send(
      new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk(userId) },
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
        throw new Error('Could not delete all session records — please try again.')
      }
      deletedRows += batch.length
    }
    lastKey = page.LastEvaluatedKey
  } while (lastKey)

  // 2. Sweep S3 objects under <userId>/ — paginated for large accounts.
  let deletedObjects = 0
  if (EVIDENCE_BUCKET) {
    let continuationToken
    do {
      const list = await s3().send(
        new ListObjectsV2Command({
          Bucket: EVIDENCE_BUCKET,
          Prefix: `${userId}/`,
          ContinuationToken: continuationToken,
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
        deletedObjects += keys.length
      }
      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined
    } while (continuationToken)
  }

  // 3. Delete the Cognito user record itself. After this returns, the JWT
  // remains valid until it expires (~1h default) but no further sign-in is
  // possible.
  if (USER_POOL_ID) {
    await cognito().send(
      new AdminDeleteUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: userId,
      }),
    )
  }

  console.log(
    `[parkproof.me.delete] user=${userId} deleted_rows=${deletedRows} deleted_objects=${deletedObjects}`,
  )
  return { ok: true, deleted_rows: deletedRows, deleted_objects: deletedObjects }
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

function stripInternalKeys(row) {
  // Don't leak the partition-key shape to the client.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pk: _pk, sk: _sk, gsi_updated_at: _u, ...rest } = row
  return rest
}

async function deletePhotosForSession(userId, sessionId) {
  if (!EVIDENCE_BUCKET) return
  const prefix = `${userId}/${sessionId}/`
  const list = await s3().send(
    new ListObjectsV2Command({ Bucket: EVIDENCE_BUCKET, Prefix: prefix }),
  )
  const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key }))
  if (keys.length === 0) return
  await s3().send(
    new DeleteObjectsCommand({
      Bucket: EVIDENCE_BUCKET,
      Delete: { Objects: keys, Quiet: true },
    }),
  )
}
