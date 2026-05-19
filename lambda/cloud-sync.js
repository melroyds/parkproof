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
  if (!_s3) _s3 = new S3Client({ region: REGION })
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

  // Write the session as a DynamoDB row.
  await ddb().send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        pk: pk(userId),
        sk: sessionSk(session.id),
        gsi_updated_at: new Date().toISOString(), // for future incremental sync GSI
        ...session,
      },
    }),
  )

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
      await ddb().send(
        new BatchWriteCommand({
          RequestTables: undefined,
          RequestItems: {
            [TABLE_NAME]: batch.map((it) => ({
              DeleteRequest: { Key: { pk: it.pk, sk: it.sk } },
            })),
          },
        }),
      )
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
