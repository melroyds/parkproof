// @vitest-environment node
// Delete forever, with another device still signed in (cloud-sync.js,
// "Deleted accounts").
//
// /me/delete deletes the Cognito user last, and a token issued before that
// stays valid for up to an hour. Without a guard, another signed-in device
// finds /sessions/list empty on its next sync and uploads every record and
// photo again, under a sub nobody can ever sign in as. So /me/delete writes
// a marker to the jobs table first, and the routes that read or add an
// account's data answer 410 {"error":"ERR_ACCOUNT_DELETED"} once it is there.
// When a step after the marker fails, /me/delete removes it again before it
// answers with that step's error: the account isn't deleted, so it works from
// every device, and the retry starts clean.
//
// DynamoDB (the records table and the jobs table), S3 and the Cognito client
// are in-memory fakes, as in me-delete.test.js and cloud-sync.test.js. Where
// the HTTP answer matters, requests go through index.js's handler. The clock
// is frozen in every test.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const fake = vi.hoisted(() => {
  // Module-level env is read when cloud-sync.js loads, so set it before import.
  process.env.S3_BUCKET_EVIDENCE = 'test-evidence'
  process.env.COGNITO_USER_POOL_ID = 'ap-southeast-2_testpool'
  const RECORDS = 'parkproof-sessions'
  const JOBS = 'parkproof-jobs'
  const rows = new Map() // records table: `${pk}|${sk}` -> item
  const jobs = new Map() // jobs table: job_id -> item
  const objects = new Map() // S3 key -> { body: Buffer, contentType }
  const users = [] // the user pool: { username, sub }, local users (username = sub)
  const calls = []
  const state = {}
  const error = (name, extra = {}) => Object.assign(new Error(name), { name, ...extra })
  const rowKey = (k) => `${k.pk}|${k.sk}`
  const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

  function reset() {
    rows.clear()
    jobs.clear()
    objects.clear()
    users.length = 0
    calls.length = 0
    Object.assign(state, {
      queryPage: 2,
      jobsWriteError: null, // thrown by every write to the jobs table
      jobsReadError: null, // thrown by every read of the jobs table
      jobsDeleteError: null, // thrown by DeleteItem on the jobs table...
      jobsDeleteFailures: Infinity, // ...this many times, after which DeleteItem works again
      rowDeleteError: null, // thrown by DeleteItem on the records table
      beforeRowPut: null, // run once, before the next records-table Put lands
      beforeBatchWrite: null, // run once, before the next BatchWrite (the record sweep) is answered
      batchUnprocessed: false, // BatchWrite leaves every request unprocessed
      batchError: null, // thrown by BatchWrite
      photoDeleteError: null, // a code every photo delete fails with (DeleteObjects lists it per key)
      cognitoError: null, // thrown by AdminDeleteUser
    })
  }

  function conditionHolds(input, current) {
    const expr = input.ConditionExpression
    if (!expr) return true
    const values = input.ExpressionAttributeValues ?? {}
    if (expr === 'attribute_not_exists(#pk)') return current === undefined
    if (expr === '#rev = :rev') return current !== undefined && current.rev === values[':rev']
    if (expr === 'attribute_exists(#pk) AND attribute_not_exists(#rev)') return current !== undefined && current.rev === undefined
    throw new Error(`unexpected condition ${expr}`)
  }

  async function jobsSend(cmd) {
    const input = cmd.input
    if (cmd.op === 'get') {
      if (state.jobsReadError) throw state.jobsReadError
      const item = jobs.get(input.Key.job_id)
      return { Item: item === undefined ? undefined : structuredClone(item) }
    }
    if (cmd.op === 'put') {
      if (state.jobsWriteError) throw state.jobsWriteError
      jobs.set(input.Item.job_id, structuredClone(input.Item))
      return {}
    }
    if (cmd.op === 'delete') {
      if (state.jobsDeleteError && state.jobsDeleteFailures > 0) {
        state.jobsDeleteFailures -= 1
        throw state.jobsDeleteError
      }
      jobs.delete(input.Key.job_id)
      return {}
    }
    throw new Error(`unexpected jobs table op ${cmd.op}`)
  }

  async function recordsSend(cmd) {
    const input = cmd.input
    if (cmd.op === 'get') {
      const item = rows.get(rowKey(input.Key))
      return { Item: item === undefined ? undefined : structuredClone(item) }
    }
    if (cmd.op === 'put') {
      if (state.beforeRowPut) {
        const run = state.beforeRowPut
        state.beforeRowPut = null
        await run(input)
      }
      const current = rows.get(rowKey(input.Item))
      if (!conditionHolds(input, current)) throw error('ConditionalCheckFailedException')
      rows.set(rowKey(input.Item), structuredClone(input.Item))
      return {}
    }
    if (cmd.op === 'query') {
      // Like DynamoDB, ExclusiveStartKey marks a position in key order.
      const pkValue = input.ExpressionAttributeValues[':pk']
      const back = input.ScanIndexForward === false
      let all = [...rows.values()].filter((r) => r.pk === pkValue).sort((a, b) => byKey(a.sk, b.sk))
      if (back) all.reverse()
      const after = input.ExclusiveStartKey?.sk
      if (after !== undefined) all = all.filter((r) => (back ? r.sk < after : r.sk > after))
      const page = all.slice(0, state.queryPage)
      return {
        Items: page.map((r) => (input.ProjectionExpression ? { pk: r.pk, sk: r.sk } : structuredClone(r))),
        LastEvaluatedKey: all.length > state.queryPage ? { pk: page.at(-1).pk, sk: page.at(-1).sk } : undefined,
      }
    }
    if (cmd.op === 'delete') {
      if (state.rowDeleteError) throw state.rowDeleteError
      rows.delete(rowKey(input.Key))
      return {}
    }
    if (cmd.op === 'batchWrite') {
      if (state.beforeBatchWrite) {
        const run = state.beforeBatchWrite
        state.beforeBatchWrite = null
        await run()
      }
      if (state.batchError) throw state.batchError
      if (state.batchUnprocessed) return { UnprocessedItems: input.RequestItems }
      for (const reqs of Object.values(input.RequestItems)) for (const r of reqs) rows.delete(rowKey(r.DeleteRequest.Key))
      return {}
    }
    throw new Error(`unexpected records table op ${cmd.op}`)
  }

  async function ddbSend(cmd) {
    const input = cmd.input
    // BatchWrite names its table in RequestItems, everything else in TableName.
    const table = input.TableName ?? Object.keys(input.RequestItems ?? {})[0]
    calls.push({ service: 'ddb', table, op: cmd.op, input })
    if (table === JOBS) return jobsSend(cmd)
    if (table === RECORDS) return recordsSend(cmd)
    throw new Error(`unexpected table ${table}`)
  }

  async function s3Send(cmd) {
    const input = cmd.input
    calls.push({ service: 's3', op: cmd.op, input })
    if (cmd.op === 'list') {
      // Like S3, the continuation token marks a position in key order.
      const after = input.ContinuationToken ?? ''
      const keys = [...objects.keys()].filter((k) => k.startsWith(input.Prefix) && k > after).sort(byKey)
      const size = Math.min(input.MaxKeys ?? 1000, 1000)
      const page = keys.slice(0, size)
      const truncated = keys.length > size
      return {
        Contents: page.map((Key) => ({ Key })),
        KeyCount: page.length,
        IsTruncated: truncated,
        NextContinuationToken: truncated ? page.at(-1) : undefined,
      }
    }
    if (cmd.op === 'head') {
      if (!objects.has(input.Key)) throw error('NotFound', { $metadata: { httpStatusCode: 404 } })
      return {}
    }
    if (cmd.op === 'get') {
      const o = objects.get(input.Key)
      if (!o) throw error('NoSuchKey', { $metadata: { httpStatusCode: 404 } })
      return {
        ContentType: o.contentType,
        Body: (async function* () {
          yield o.body
        })(),
      }
    }
    if (cmd.op === 'listVersions') {
      // One version per object: this fake keeps no old versions
      // (lambda/evidence-versions.test.js has a bucket that does).
      const keys = [...objects.keys()].filter((k) => k.startsWith(input.Prefix)).sort(byKey)
      const size = Math.min(input.MaxKeys ?? 1000, 1000)
      return { Versions: keys.slice(0, size).map((Key) => ({ Key, VersionId: 'v1' })), IsTruncated: keys.length > size }
    }
    if (cmd.op === 'deleteObjects') {
      if (state.photoDeleteError) {
        // Quiet mode: S3 lists only the deletes that failed, each with its code.
        return {
          Errors: input.Delete.Objects.map(({ Key, VersionId }) => ({ Key, VersionId, Code: state.photoDeleteError, Message: 'refused' })),
        }
      }
      for (const { Key } of input.Delete.Objects) objects.delete(Key)
      return {}
    }
    throw new Error(`unexpected s3 op ${cmd.op}`)
  }

  // cognitoSend is set below the imports, where the SDK's classes are in scope.
  return { rows, jobs, objects, users, calls, state, reset, ddbSend, s3Send, cognitoSend: null }
})

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}))
vi.mock('@aws-sdk/lib-dynamodb', () => {
  // Real classes, not arrow-function factories: the code does `new X(...)`.
  const command = (op) =>
    class {
      constructor(input) {
        this.op = op
        this.input = input
      }
    }
  return {
    DynamoDBDocumentClient: { from: () => ({ send: (cmd) => fake.ddbSend(cmd) }) },
    GetCommand: command('get'),
    PutCommand: command('put'),
    QueryCommand: command('query'),
    DeleteCommand: command('delete'),
    BatchWriteCommand: command('batchWrite'),
    UpdateCommand: command('update'),
  }
})
vi.mock('@aws-sdk/client-s3', () => {
  const command = (op) =>
    class {
      constructor(input) {
        this.op = op
        this.input = input
      }
    }
  return {
    S3Client: class {
      send(cmd) {
        return fake.s3Send(cmd)
      }
    },
    DeleteObjectsCommand: command('deleteObjects'),
    GetObjectCommand: command('get'),
    HeadObjectCommand: command('head'),
    ListObjectVersionsCommand: command('listVersions'),
    ListObjectsV2Command: command('list'),
    PutObjectCommand: command('put'),
  }
})
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: async (_client, cmd) => `https://signed.test/${cmd.op}/${cmd.input.Key}`,
}))
vi.mock('@aws-sdk/client-cognito-identity-provider', async (importOriginal) => {
  // The SDK's own commands and exceptions: only the client is fake.
  const sdk = await importOriginal()
  return {
    ...sdk,
    CognitoIdentityProviderClient: class {
      send(cmd) {
        return fake.cognitoSend(cmd)
      }
    },
  }
})

import { AdminDeleteUserCommand, TooManyRequestsException, UserNotFoundException } from '@aws-sdk/client-cognito-identity-provider'
import { handler } from './index.js'
import {
  ACCOUNT_DELETED_KIND,
  DELETION_MARKER_TTL_SECONDS,
  ERR_ACCOUNT_DELETED,
  MARKER_DELETING,
  MARKER_REMOVAL_BACKOFF_MS,
  MARKER_REMOVAL_TRIES,
  MARKER_ROWS_DELETED,
  deletionMarkerKey,
  handleMeDelete,
  handleMeExport,
  handlePhotosMaterialize,
  handlePhotosPresign,
  handleSessionsList,
  handleSessionsUpload,
} from './cloud-sync.js'

fake.cognitoSend = async (cmd) => {
  if (!(cmd instanceof AdminDeleteUserCommand)) throw new Error(`unexpected cognito command ${cmd?.constructor?.name}`)
  fake.calls.push({ service: 'cognito', op: 'delete', input: cmd.input })
  if (fake.state.cognitoError) throw fake.state.cognitoError
  const i = fake.users.findIndex((u) => u.username === cmd.input.Username)
  if (i < 0) throw new UserNotFoundException({ message: 'User does not exist.', $metadata: { httpStatusCode: 400 } })
  fake.users.splice(i, 1)
  return {}
}

const RECORDS = 'parkproof-sessions'
const JOBS = 'parkproof-jobs'
const SUB = '5b1c8e4a-7f2d-4c3b-9a6e-0d1f2e3c4b5a' // the driver deleting their account
const OTHER = '9e8d7c6b-5a49-4382-a170-f6e5d4c3b2a1' // someone else
const SID = '0f0e0d0c-0b0a-4908-8706-050403020100'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const NOW = new Date('2026-11-15T03:00:00.000Z')
const NOW_SEC = NOW.getTime() / 1000
const REFUSED_BODY = '{"error":"ERR_ACCOUNT_DELETED"}'

/** The id token's claims, as API Gateway's JWT authorizer passes them on (a local user: username = sub). */
const claims = (sub) => ({ sub, email: 'driver@example.test', token_use: 'id', 'cognito:username': sub })

/** A JWT route's request through index.js's handler. */
function request(method, path, body, sub = SUB) {
  return handler({
    requestContext: { http: { method, path, sourceIp: '203.0.113.9' }, authorizer: { jwt: { claims: claims(sub) } } },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** The event a cloud-sync handler gets, for calling it directly. */
const event = (body = {}, sub = SUB) => ({
  requestContext: { authorizer: { jwt: { claims: claims(sub) } } },
  body: JSON.stringify(body),
})

function record(overrides = {}) {
  return {
    id: SID,
    arrived_at: '2026-11-15T02:00:00.000Z',
    location: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    photos: [{ role: 'sign', sha256: SHA_A, captured_at: '2026-11-15T01:59:00.000Z', source: 'camera_input' }],
    ...overrides,
  }
}

/** A record and its two photos under an account, as an upload leaves them. */
function seedRecord(sub, id) {
  fake.rows.set(`USER#${sub}|SESSION#${id}`, { pk: `USER#${sub}`, sk: `SESSION#${id}`, id, rev: 1 })
  addPhoto(`${sub}/${id}/p/${SHA_A}.jpg`)
  addPhoto(`${sub}/${id}/p/${SHA_B}.jpg`)
}

const addPhoto = (key) => fake.objects.set(key, { body: Buffer.from('jpeg'), contentType: 'image/jpeg' })

/** The marker /me/delete writes, put straight into the jobs table. */
function markDeleted(sub, fields = {}) {
  const job_id = `DEL#${sub}`
  fake.jobs.set(job_id, { job_id, kind: 'account-deleted', deleted_at: NOW.toISOString(), ttl: NOW_SEC + 172_800, ...fields })
}

const rowsOf = (sub) => [...fake.rows.values()].filter((r) => r.pk === `USER#${sub}`)
const objectsOf = (sub) => [...fake.objects.keys()].filter((k) => k.startsWith(`${sub}/`))
const ddbCalls = (table, op) => fake.calls.filter((c) => c.service === 'ddb' && c.table === table && c.op === op)
const s3Calls = () => fake.calls.filter((c) => c.service === 's3')
const firstCall = (service, op, table) =>
  fake.calls.findIndex((c) => c.service === service && c.op === op && (table === undefined || c.table === table))

/** The error DynamoDB throws when the role lacks a grant. */
const accessDenied = (action) =>
  Object.assign(
    new Error(
      `User: arn:aws:sts::123456789012:assumed-role/parkproof-lambda-role/parkproof-sign-translator is not authorized to perform: dynamodb:${action} on resource: arn:aws:dynamodb:ap-southeast-2:123456789012:table/parkproof-jobs`,
    ),
    { name: 'AccessDeniedException' },
  )

beforeEach(() => {
  fake.reset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the deletion marker', () => {
  it('lives in the jobs table under DEL#sub, for two days', () => {
    expect(deletionMarkerKey(SUB)).toBe(`DEL#${SUB}`)
    expect(ACCOUNT_DELETED_KIND).toBe('account-deleted')
    expect(ERR_ACCOUNT_DELETED).toBe('ERR_ACCOUNT_DELETED')
    expect([MARKER_DELETING, MARKER_ROWS_DELETED]).toEqual(['deleting', 'rows_deleted'])
    // Longer than any id token lives (a day at most).
    expect(DELETION_MARKER_TTL_SECONDS).toBe(2 * 24 * 60 * 60)
  })
})

describe('POST /me/delete marks the account deleted first', () => {
  it('writes the marker before it sweeps anything: the key, the kind, the time, the TTL and its state, nothing else', async () => {
    fake.users.push({ username: SUB, sub: SUB })
    for (const id of ['r1', 'r2', 'r3']) seedRecord(SUB, id)

    const res = await request('POST', '/me/delete')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, deleted_rows: 3, deleted_objects: 6 })

    const marker = { job_id: `DEL#${SUB}`, kind: 'account-deleted', deleted_at: '2026-11-15T03:00:00.000Z', ttl: NOW_SEC + 172_800 }
    expect([...fake.jobs.values()]).toEqual([{ ...marker, state: 'rows_deleted' }])
    // The very first call, before the first BatchWrite, the photo sweep and the Cognito delete.
    expect(firstCall('ddb', 'put', JOBS)).toBe(0)
    expect(firstCall('ddb', 'batchWrite', RECORDS)).toBeGreaterThan(0)
    expect(firstCall('s3', 'deleteObjects')).toBeGreaterThan(0)
    expect(firstCall('cognito', 'delete')).toBeGreaterThan(0)
    // Written 'deleting', then 'rows_deleted' once the last record batch is
    // done and before any photo is deleted: a refusal may sweep the photos
    // again only from then on.
    const writes = ddbCalls(JOBS, 'put')
    expect(writes.map((c) => c.input.Item)).toEqual([
      { ...marker, state: 'deleting' },
      { ...marker, state: 'rows_deleted' },
    ])
    const lastBatch = fake.calls.findLastIndex((c) => c.op === 'batchWrite')
    expect(fake.calls.indexOf(writes[1])).toBeGreaterThan(lastBatch)
    expect(fake.calls.indexOf(writes[1])).toBeLessThan(firstCall('s3', 'deleteObjects'))
    // A delete that worked keeps its marker: nothing removes it.
    expect(ddbCalls(JOBS, 'delete')).toEqual([])
    expect(rowsOf(SUB)).toEqual([])
    expect(objectsOf(SUB)).toEqual([])
    expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining('marker=written'))
  })

  it('stops before deleting anything when the marker cannot be written, and a retry runs the whole delete', async () => {
    // Without the marker, an ok here would leave another device still signed
    // in free to upload everything again, under an account no one can reach.
    fake.users.push({ username: SUB, sub: SUB })
    seedRecord(SUB, 'r1')
    fake.state.jobsWriteError = accessDenied('PutItem')

    const res = await request('POST', '/me/delete')
    expect(res.statusCode).toBe(500)
    // The phone is asked to try again, and told nothing about the role or the account.
    expect(JSON.parse(res.body)).toEqual({ error: 'Could not start deleting the account. Please try again.' })
    expect(res.body).not.toMatch(/arn:|123456789012|parkproof-lambda-role/)
    // Nothing was read or deleted: the rows, the photos and the Cognito user are all still there.
    expect(rowsOf(SUB)).toHaveLength(1)
    expect(objectsOf(SUB)).toHaveLength(2)
    expect(fake.users).toHaveLength(1)
    expect(ddbCalls(RECORDS, 'query')).toEqual([])
    expect(s3Calls()).toEqual([])
    expect(fake.calls.filter((c) => c.service === 'cognito')).toEqual([])
    // No marker went in, so there is none to remove.
    expect(ddbCalls(JOBS, 'delete')).toEqual([])
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/^\[parkproof\.me\.delete\] user=5b1c8e4a-\S+ marker write failed, nothing deleted: AccessDeniedException: .*not authorized/),
    )

    // The phone tries again, and this time the write works: everything goes.
    fake.state.jobsWriteError = null
    const retry = await request('POST', '/me/delete')
    expect(retry.statusCode).toBe(200)
    expect(JSON.parse(retry.body)).toMatchObject({ ok: true, deleted_rows: 1, deleted_objects: 2 })
    expect(fake.jobs.get(`DEL#${SUB}`)).toMatchObject({ kind: 'account-deleted', ttl: NOW_SEC + 172_800 })
    expect(rowsOf(SUB)).toEqual([])
    expect(objectsOf(SUB)).toEqual([])
    expect(fake.users).toEqual([])
    expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining('marker=written'))
  })

  it('is never refused itself: a retry with the marker there runs, writes it again and sweeps what came back', async () => {
    fake.users.push({ username: SUB, sub: SUB })
    seedRecord(SUB, 'r1')
    expect((await request('POST', '/me/delete')).statusCode).toBe(200)

    // The answer never reached the phone. A minute later a record and its
    // photos are back (written before the marker could stop them), and the
    // phone tries again.
    vi.setSystemTime(new Date(NOW.getTime() + 60_000))
    seedRecord(SUB, 'late')
    const retry = await request('POST', '/me/delete')
    expect(retry.statusCode).toBe(200)
    expect(JSON.parse(retry.body)).toMatchObject({ ok: true, deleted_rows: 1, deleted_objects: 2 })
    expect(rowsOf(SUB)).toEqual([])
    expect(objectsOf(SUB)).toEqual([])
    expect(fake.jobs.get(`DEL#${SUB}`)).toEqual({
      job_id: `DEL#${SUB}`,
      kind: 'account-deleted',
      deleted_at: '2026-11-15T03:01:00.000Z',
      ttl: NOW_SEC + 60 + 172_800,
      state: 'rows_deleted',
    })
    expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining('cognito=already_deleted'))
    // /me/delete never reads the marker.
    expect(ddbCalls(JOBS, 'get')).toEqual([])
  })

  it('says plainly when it could not delete every record, before the Cognito user goes, and removes the marker', async () => {
    // The BatchWrite retries back off with real waits: fake them too.
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })
    vi.setSystemTime(NOW)
    fake.users.push({ username: SUB, sub: SUB })
    seedRecord(SUB, 'r1')
    fake.state.batchUnprocessed = true

    const pending = request('POST', '/me/delete')
    await vi.runAllTimersAsync()
    const res = await pending
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body)).toEqual({ error: 'Could not delete every record. Please try again.' })
    // No em-dash (U+2014, written as a code so this file holds none) and no "session".
    expect(res.body.includes(String.fromCharCode(0x2014))).toBe(false)
    expect(res.body).not.toMatch(/session/i)
    // Stopped before the Cognito delete, so a retry can finish the job.
    expect(fake.users).toHaveLength(1)
    // The account isn't deleted, so its marker is gone again and no device is refused.
    expect(fake.jobs.has(`DEL#${SUB}`)).toBe(false)
  })
})

describe('a /me/delete that fails after its marker', () => {
  const failures = [
    {
      step: 'the record sweep',
      fail: () => {
        // What the SDK throws once its own retries are spent.
        fake.state.batchError = Object.assign(new Error('Rate exceeded'), { name: 'ProvisionedThroughputExceededException' })
      },
      error: 'Rate exceeded',
      name: 'ProvisionedThroughputExceededException',
      failedAt: () => firstCall('ddb', 'batchWrite', RECORDS),
    },
    {
      step: 'the photo sweep',
      fail: () => {
        fake.state.photoDeleteError = 'InternalError'
      },
      error: 'Could not delete every photo. Please try again.',
      name: 'Error',
      failedAt: () => firstCall('s3', 'deleteObjects'),
    },
    {
      step: 'the Cognito delete',
      fail: () => {
        fake.state.cognitoError = new TooManyRequestsException({ message: 'Rate exceeded', $metadata: { httpStatusCode: 400 } })
      },
      error: 'Rate exceeded',
      name: 'TooManyRequestsException',
      failedAt: () => firstCall('cognito', 'delete'),
    },
  ]
  const recover = () => Object.assign(fake.state, { batchError: null, photoDeleteError: null, cognitoError: null })

  it.each(failures)(
    'when $step fails, removes the marker and still answers that 500; every device is served again, and the retry deletes everything',
    async ({ fail, error, name, failedAt }) => {
      fake.users.push({ username: SUB, sub: SUB })
      seedRecord(SUB, 'r1')
      fail()

      const res = await request('POST', '/me/delete')
      expect(res.statusCode).toBe(500)
      expect(JSON.parse(res.body)).toEqual({ error })
      // The marker went in first, and was removed by its key after the step failed.
      expect(firstCall('ddb', 'put', JOBS)).toBe(0)
      const removals = ddbCalls(JOBS, 'delete')
      expect(removals.map((c) => c.input)).toEqual([{ TableName: JOBS, Key: { job_id: `DEL#${SUB}` } }])
      expect(fake.calls.indexOf(removals[0])).toBeGreaterThan(failedAt())
      expect(fake.jobs.has(`DEL#${SUB}`)).toBe(false)
      expect(console.warn).toHaveBeenCalledWith(`[parkproof.me.delete] user=${SUB} delete failed (${name}), marker removed`)
      // The account isn't deleted: its sign-in is still there, and a device
      // still signed in to it lists and uploads as before.
      expect(fake.users).toHaveLength(1)
      expect((await request('GET', '/sessions/list')).statusCode).toBe(200)
      expect((await request('POST', '/sessions/upload', { session: record() })).statusCode).toBe(200)

      // The retry starts clean: it writes the marker again, deletes everything, and the marker stays.
      recover()
      const retry = await request('POST', '/me/delete')
      expect(retry.statusCode).toBe(200)
      expect(fake.jobs.get(`DEL#${SUB}`)).toMatchObject({ kind: 'account-deleted', ttl: NOW_SEC + 172_800 })
      expect(ddbCalls(JOBS, 'delete')).toHaveLength(1)
      expect(rowsOf(SUB)).toEqual([])
      expect(objectsOf(SUB)).toEqual([])
      expect(fake.users).toEqual([])
      expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining('marker=written'))
    },
  )

  it('refuses another device during its record sweep without deleting a photo: when that sweep fails, the rows it left keep their photos', async () => {
    fake.users.push({ username: SUB, sub: SUB })
    seedRecord(SUB, 'r1')
    seedRecord(SUB, 'r2')
    // Phone B asks for a photo URL and uploads a record while phone A's
    // delete is in its record sweep, which then fails.
    const refusals = []
    fake.state.beforeBatchWrite = async () => {
      refusals.push(await request('POST', '/photos/presign', { session_id: 'r1', sha256: SHA_A }))
      refusals.push(await request('POST', '/sessions/upload', { session: record({ id: 'r2' }) }))
    }
    fake.state.batchError = Object.assign(new Error('Rate exceeded'), { name: 'ProvisionedThroughputExceededException' })

    const res = await request('POST', '/me/delete')
    expect(res.statusCode).toBe(500)
    expect(refusals.map((r) => [r.statusCode, r.body])).toEqual([
      [410, REFUSED_BODY],
      [410, REFUSED_BODY],
    ])
    // The account isn't deleted: its marker is gone, and every row is still
    // there with every photo of it. Nothing in S3 was even listed.
    expect(fake.jobs.has(`DEL#${SUB}`)).toBe(false)
    expect(rowsOf(SUB)).toHaveLength(2)
    expect(objectsOf(SUB)).toHaveLength(4)
    expect(s3Calls()).toEqual([])
    expect(console.log).toHaveBeenCalledWith(`[parkproof.account] refused route=photos/presign user=${SUB}`)
    expect(console.log).toHaveBeenCalledWith(`[parkproof.account] refused route=sessions/upload user=${SUB}`)
  })

  /** Fake the waits between the removal's tries too (Date stays frozen at NOW until a test moves it). */
  function fakeTheWaits() {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] })
    vi.setSystemTime(NOW)
  }
  const removals = () => ddbCalls(JOBS, 'delete')

  it('tries the removal again after a short wait when it fails, and the marker goes on a later try', async () => {
    fakeTheWaits()
    fake.users.push({ username: SUB, sub: SUB })
    seedRecord(SUB, 'r1')
    fake.state.cognitoError = new TooManyRequestsException({ message: 'Rate exceeded', $metadata: { httpStatusCode: 400 } })
    // DynamoDB throttles the first two removals, and the third works.
    fake.state.jobsDeleteError = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' })
    fake.state.jobsDeleteFailures = 2
    expect([MARKER_REMOVAL_TRIES, MARKER_REMOVAL_BACKOFF_MS]).toEqual([3, 100])

    const pending = request('POST', '/me/delete')
    // The first try goes as soon as the step has failed...
    await vi.advanceTimersByTimeAsync(0)
    expect(removals()).toHaveLength(1)
    // ...the second 100 ms later...
    await vi.advanceTimersByTimeAsync(MARKER_REMOVAL_BACKOFF_MS - 1)
    expect(removals()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(removals()).toHaveLength(2)
    // ...and the third 200 ms after that.
    await vi.advanceTimersByTimeAsync(2 * MARKER_REMOVAL_BACKOFF_MS - 1)
    expect(removals()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    const res = await pending
    expect(removals()).toHaveLength(3)
    for (const r of removals()) expect(r.input).toEqual({ TableName: JOBS, Key: { job_id: `DEL#${SUB}` } })

    // The step's own error, and the marker is gone: every device is served again.
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body)).toEqual({ error: 'Rate exceeded' })
    expect(fake.jobs.has(`DEL#${SUB}`)).toBe(false)
    expect(console.warn).toHaveBeenCalledWith(`[parkproof.me.delete] user=${SUB} delete failed (TooManyRequestsException), marker removed`)
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('marker removal failed'))
    expect((await request('GET', '/sessions/list')).statusCode).toBe(200)
  })

  it("tries the removal 3 times, then logs a marker it could not remove and still answers the step's own error; the account stays refused until the marker lapses", async () => {
    fakeTheWaits()
    fake.users.push({ username: SUB, sub: SUB })
    seedRecord(SUB, 'r1')
    fake.state.cognitoError = new TooManyRequestsException({ message: 'Rate exceeded', $metadata: { httpStatusCode: 400 } })
    fake.state.jobsDeleteError = accessDenied('DeleteItem')

    const pending = request('POST', '/me/delete')
    await vi.runAllTimersAsync()
    const res = await pending
    expect(res.statusCode).toBe(500)
    // The Cognito error, not the removal's: that one is only in the log.
    expect(JSON.parse(res.body)).toEqual({ error: 'Rate exceeded' })
    expect(res.body).not.toMatch(/DeleteItem|arn:|123456789012/)
    // Three tries, the last one the last call made, then one line in the log.
    expect(removals()).toHaveLength(MARKER_REMOVAL_TRIES)
    expect(fake.calls.at(-1)).toBe(removals().at(-1))
    const removalLines = vi.mocked(console.error).mock.calls.filter(([line]) => String(line).includes('marker removal failed'))
    expect(removalLines).toHaveLength(1)
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[parkproof\.me\.delete\] user=5b1c8e4a-\S+ delete failed \(TooManyRequestsException\), marker removal failed after 3 tries: AccessDeniedException: .*dynamodb:DeleteItem/,
      ),
    )
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('marker removed'))
    expect(fake.jobs.has(`DEL#${SUB}`)).toBe(true)
    expect((await request('GET', '/sessions/list')).statusCode).toBe(410)

    // Past the marker's TTL the account works again, and a retry then deletes everything.
    vi.setSystemTime(new Date(NOW.getTime() + DELETION_MARKER_TTL_SECONDS * 1000))
    expect((await request('GET', '/sessions/list')).statusCode).toBe(200)
    fake.state.cognitoError = null
    fake.state.jobsDeleteError = null
    expect((await request('POST', '/me/delete')).statusCode).toBe(200)
    expect(fake.users).toEqual([])
    expect(rowsOf(SUB)).toEqual([])
  })
})

describe('a deleted account is refused', () => {
  it('every route in the contract answers 410 with exactly {"error":"ERR_ACCOUNT_DELETED"}, before reading any data', async () => {
    // The marker is in and the sweep hasn't reached this record yet.
    seedRecord(SUB, SID)
    markDeleted(SUB)
    const cases = [
      ['POST', '/sessions/upload', { session: record() }],
      ['POST', '/photos/presign', { session_id: SID, sha256: SHA_A }],
      ['GET', '/sessions/list', undefined],
      ['POST', '/sessions/list', {}],
      ['POST', '/photos/materialize', { session_id: SID, sha256: SHA_A }],
      ['GET', '/me/export', undefined],
      ['POST', '/me/export', {}],
    ]
    for (const [method, path, body] of cases) {
      const res = await request(method, path, body)
      expect(res.statusCode, `${method} ${path}`).toBe(410)
      expect(res.body, `${method} ${path}`).toBe(REFUSED_BODY)
      expect(res.headers['Content-Type']).toBe('application/json')
    }
    // No record was read or written, and no photo read.
    for (const op of ['get', 'put', 'query', 'delete']) expect(ddbCalls(RECORDS, op)).toEqual([])
    expect(s3Calls().filter((c) => c.op === 'get' || c.op === 'head')).toEqual([])
    // One marker read per request, strongly consistent.
    const reads = ddbCalls(JOBS, 'get')
    expect(reads).toHaveLength(cases.length)
    for (const r of reads) expect(r.input).toEqual({ TableName: JOBS, Key: { job_id: `DEL#${SUB}` }, ConsistentRead: true })
    // An expected answer: logged as [parkproof.account] refused, never as a handler error.
    expect(console.error).not.toHaveBeenCalled()
    expect(console.log).toHaveBeenCalledWith(`[parkproof.account] refused route=sessions/list user=${SUB}`)
  })

  it('refuses an upload before anything is written, whatever its body', async () => {
    markDeleted(SUB)
    await expect(handleSessionsUpload(event({ session: record() }))).rejects.toMatchObject({
      statusCode: 410,
      message: ERR_ACCOUNT_DELETED,
    })
    // A body that would be a 400 is refused the same way: the device should sign out, not fix and retry.
    await expect(handleSessionsUpload(event({}))).rejects.toMatchObject({ statusCode: 410 })
    expect(ddbCalls(RECORDS, 'get')).toEqual([])
    expect(ddbCalls(RECORDS, 'put')).toEqual([])
    expect(rowsOf(SUB)).toEqual([])
  })

  it('sweeps the photos again when it refuses an upload or a presign, and leaves S3 alone on the routes that only read', async () => {
    markDeleted(SUB)
    addPhoto(`${OTHER}/theirs/p/${SHA_A}.jpg`)
    // Photos PUT through URLs presigned just before the delete, landing after its sweep.
    const landLate = () => [SHA_A, SHA_B].forEach((sha) => addPhoto(`${SUB}/${SID}/p/${sha}.jpg`))

    const refusals = [
      ['sessions/upload', () => handleSessionsUpload(event({ session: record() }))],
      ['photos/presign', () => handlePhotosPresign(event({ session_id: SID, sha256: SHA_A }))],
    ]
    for (const [route, send] of refusals) {
      landLate()
      await expect(send()).rejects.toMatchObject({ statusCode: 410, message: ERR_ACCOUNT_DELETED })
      expect(objectsOf(SUB)).toEqual([])
      expect(console.log).toHaveBeenLastCalledWith(`[parkproof.account] refused route=${route} user=${SUB} resweep_objects=2`)
    }
    expect(objectsOf(OTHER)).toHaveLength(1)

    landLate()
    fake.calls.length = 0
    for (const send of [
      () => handleSessionsList(event()),
      () => handlePhotosMaterialize(event({ session_id: SID, sha256: SHA_A })),
      () => handleMeExport(event()),
    ]) {
      await expect(send()).rejects.toMatchObject({ statusCode: 410, message: ERR_ACCOUNT_DELETED })
    }
    expect(s3Calls()).toEqual([])
    expect(objectsOf(SUB)).toHaveLength(2)
  })

  it('sweeps the photos again only once the delete has removed every row; a row written during the record sweep still goes', async () => {
    addPhoto(`${SUB}/${SID}/p/${SHA_A}.jpg`)
    // The delete is still removing the rows: a refused presign deletes no photo.
    markDeleted(SUB, { state: 'deleting' })
    await expect(handlePhotosPresign(event({ session_id: SID, sha256: SHA_B }))).rejects.toMatchObject({ statusCode: 410 })
    expect(objectsOf(SUB)).toHaveLength(1)
    expect(s3Calls()).toEqual([])
    // An upload whose write lands then: its row is deleted again (the record
    // sweep may have passed it), and the photos stay.
    fake.state.beforeRowPut = async () => markDeleted(SUB, { state: 'deleting' })
    fake.jobs.delete(`DEL#${SUB}`)
    await expect(handleSessionsUpload(event({ session: record() }))).rejects.toMatchObject({ statusCode: 410 })
    expect(rowsOf(SUB)).toEqual([])
    expect(objectsOf(SUB)).toHaveLength(1)
    expect(console.log).toHaveBeenLastCalledWith(`[parkproof.account] refused route=sessions/upload user=${SUB}`)

    // Every row is gone: the next refusal sweeps the photos again.
    markDeleted(SUB, { state: 'rows_deleted' })
    await expect(handlePhotosPresign(event({ session_id: SID, sha256: SHA_B }))).rejects.toMatchObject({ statusCode: 410 })
    expect(objectsOf(SUB)).toEqual([])
    expect(console.log).toHaveBeenLastCalledWith(`[parkproof.account] refused route=photos/presign user=${SUB} resweep_objects=1`)
  })

  it('deletes a row that landed after the sweep, and refuses it: the race the marker closes', async () => {
    fake.users.push({ username: SUB, sub: SUB })
    seedRecord(SUB, 'r1')
    // Phone B's upload passes the first check and reads the stored row. Then,
    // before its write lands, phone A runs Delete forever from start to finish
    // (its sweep can't see a row that isn't written yet), and one of B's photos
    // lands after that sweep.
    fake.state.beforeRowPut = async () => {
      await handleMeDelete(event())
      addPhoto(`${SUB}/${SID}/p/${SHA_A}.jpg`)
    }

    await expect(handleSessionsUpload(event({ session: record() }))).rejects.toMatchObject({
      statusCode: 410,
      message: ERR_ACCOUNT_DELETED,
    })
    expect(rowsOf(SUB)).toEqual([])
    expect(objectsOf(SUB)).toEqual([])
    const deletes = ddbCalls(RECORDS, 'delete')
    expect(deletes).toHaveLength(1)
    expect(deletes[0].input.Key).toEqual({ pk: `USER#${SUB}`, sk: `SESSION#${SID}` })
    // In that order: the write, the second marker check, the row's delete.
    const putAt = firstCall('ddb', 'put', RECORDS)
    const checkAt = fake.calls.findIndex((c, i) => i > putAt && c.table === JOBS && c.op === 'get')
    expect(checkAt).toBeGreaterThan(putAt)
    expect(fake.calls.indexOf(deletes[0])).toBeGreaterThan(checkAt)
    expect(console.log).toHaveBeenLastCalledWith(`[parkproof.account] refused route=sessions/upload user=${SUB} resweep_objects=1`)
  })

  it('still answers 410 when that delete fails, and logs the record for the owner to clear', async () => {
    fake.state.rowDeleteError = Object.assign(new Error('Rate exceeded'), { name: 'ProvisionedThroughputExceededException' })
    fake.state.beforeRowPut = async () => markDeleted(SUB)

    const res = await request('POST', '/sessions/upload', { session: record() })
    expect(res.statusCode).toBe(410)
    expect(res.body).toBe(REFUSED_BODY)
    expect(console.error).toHaveBeenCalledWith(
      `[parkproof.account] row delete after refusal failed user=${SUB} record=${SID}: ProvisionedThroughputExceededException`,
    )
  })

  it('lets the request through when the marker cannot be read (fails open), so a missing grant never stops sync', async () => {
    fake.state.jobsReadError = accessDenied('GetItem')

    const upload = await request('POST', '/sessions/upload', { session: record() })
    expect(upload.statusCode).toBe(200)
    expect(rowsOf(SUB)).toHaveLength(1)
    const list = await request('GET', '/sessions/list')
    expect(list.statusCode).toBe(200)
    expect(JSON.parse(list.body).sessions.map((s) => s.id)).toEqual([SID])
    const presign = await request('POST', '/photos/presign', { session_id: SID, sha256: SHA_B })
    expect(presign.statusCode).toBe(200)
    expect(JSON.parse(presign.body).url).toBe(`https://signed.test/put/${SUB}/${SID}/p/${SHA_B}.jpg`)
    expect((await request('GET', '/me/export')).statusCode).toBe(200)

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[parkproof\.account\] marker check failed, allowing: AccessDeniedException: .*not authorized/),
    )
    expect(console.error).not.toHaveBeenCalled()
  })

  it('counts a marker past its TTL as gone (DynamoDB sweeps lazily), and only ever refuses its own account', async () => {
    markDeleted(SUB, { ttl: NOW_SEC - 1 })
    markDeleted(OTHER)
    expect((await request('GET', '/sessions/list')).statusCode).toBe(200)
    expect((await request('GET', '/sessions/list', undefined, OTHER)).statusCode).toBe(410)
  })

  it('leaves POST /sessions/delete alone', async () => {
    seedRecord(SUB, 'r1')
    markDeleted(SUB)
    expect((await request('POST', '/sessions/delete', { session_id: 'r1' })).statusCode).toBe(200)
    expect(rowsOf(SUB)).toEqual([])
    expect(ddbCalls(JOBS, 'get')).toEqual([])
  })
})

describe('Delete forever with a second phone still signed in', () => {
  it('the second phone is refused instead of uploading everything again, and no status route serves the marker', async () => {
    fake.users.push({ username: SUB, sub: SUB })
    seedRecord(SUB, 'r1')
    seedRecord(SUB, 'r2')
    expect((await request('POST', '/me/delete')).statusCode).toBe(200)

    // Phone B, with a token issued before the delete, starts a full sync.
    const list = await request('GET', '/sessions/list')
    expect(list.statusCode).toBe(410)
    expect(JSON.parse(list.body)).toEqual({ error: ERR_ACCOUNT_DELETED })
    // Uploading straight away gets nowhere either: photos first, then the row.
    expect((await request('POST', '/photos/presign', { session_id: 'r1', sha256: SHA_A })).statusCode).toBe(410)
    expect((await request('POST', '/sessions/upload', { session: record({ id: 'r1' }) })).statusCode).toBe(410)
    expect(rowsOf(SUB)).toEqual([])
    expect(objectsOf(SUB)).toEqual([])
    expect(ddbCalls(RECORDS, 'put')).toEqual([])

    // The status routes serve job UUIDs only, so the marker can't be read through them.
    const before = ddbCalls(JOBS, 'get').length
    for (const route of ['sign-translate', 'draft-appeal', 'read-notice']) {
      for (const id of [`DEL#${SUB}`, `DEL%23${SUB}`]) {
        const res = await handler({ requestContext: { http: { method: 'GET', path: `/${route}/status/${id}` } } })
        expect(res.statusCode).toBe(404)
        expect(res.body).not.toContain('account-deleted')
      }
    }
    expect(ddbCalls(JOBS, 'get')).toHaveLength(before)
    expect(fake.jobs.has(`DEL#${SUB}`)).toBe(true)
  })
})
