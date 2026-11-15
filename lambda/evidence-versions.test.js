// @vitest-environment node
// Deleting photos from the versioned evidence bucket (cloud-sync.js,
// deleteObjectsUnder).
//
// setup-auth.sh turns versioning on for the evidence bucket. There, deleting
// a key without its VersionId only adds a delete marker, and the photo's
// bytes stay as an old version that nothing ever removes. So every sweep
// (Delete forever, deleting a record, the re-sweep when a deleted account's
// upload is refused) lists every version and delete marker under the prefix
// and deletes each by its VersionId. Without the two grants that needs
// (scripts/setup-evidence-versions.sh), S3 answers AccessDenied, and the
// sweep falls back to deleting the current photos by key, as before, and
// logs an error.
//
// S3 here is an in-memory versioned bucket: a PUT adds a version, a delete
// by key adds a delete marker, a delete by VersionId removes that version
// or marker, and ListObjectsV2 shows only keys whose newest entry is a
// version. DynamoDB and Cognito are small fakes, as in account-deleted.test.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const fake = vi.hoisted(() => {
  process.env.S3_BUCKET_EVIDENCE = 'test-evidence'
  process.env.COGNITO_USER_POOL_ID = 'ap-southeast-2_testpool'
  const rows = new Map() // records table: `${pk}|${sk}` -> item
  const jobs = new Map() // jobs table: job_id -> item
  const bucket = new Map() // S3 key -> entries, oldest first: { VersionId, marker }
  const users = [] // { username, sub }
  const calls = []
  const state = {}
  let nextVersion = 0
  const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  const s3Error = (name) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 403 } })

  function reset() {
    rows.clear()
    jobs.clear()
    bucket.clear()
    users.length = 0
    calls.length = 0
    nextVersion = 0
    Object.assign(state, {
      denyListVersions: false, // ListObjectVersions answers AccessDenied (no s3:ListBucketVersions)
      deleteVersionError: null, // a code every delete by VersionId fails with (AccessDenied: no s3:DeleteObjectVersion)
    })
  }

  /** A PUT: a new current version of the key. */
  function put(key) {
    nextVersion += 1
    const entries = bucket.get(key) ?? []
    entries.push({ VersionId: `v${String(nextVersion).padStart(5, '0')}`, marker: false })
    bucket.set(key, entries)
  }

  /** A delete by key: a delete marker becomes the current entry. */
  function deleteByKey(key) {
    const entries = bucket.get(key)
    if (!entries) return
    nextVersion += 1
    entries.push({ VersionId: `m${String(nextVersion).padStart(5, '0')}`, marker: true })
  }

  async function ddbSend(cmd) {
    const input = cmd.input
    const table = input.TableName ?? Object.keys(input.RequestItems ?? {})[0]
    calls.push({ service: 'ddb', table, op: cmd.op })
    if (table === 'parkproof-jobs') {
      if (cmd.op === 'put') {
        jobs.set(input.Item.job_id, structuredClone(input.Item))
        return {}
      }
      if (cmd.op === 'get') return { Item: jobs.get(input.Key.job_id) }
      if (cmd.op === 'delete') {
        jobs.delete(input.Key.job_id)
        return {}
      }
    }
    if (table === 'parkproof-sessions') {
      if (cmd.op === 'query') {
        const items = [...rows.values()].filter((r) => r.pk === input.ExpressionAttributeValues[':pk'])
        return { Items: items.map((r) => ({ pk: r.pk, sk: r.sk })) }
      }
      if (cmd.op === 'batchWrite') {
        for (const reqs of Object.values(input.RequestItems)) {
          for (const r of reqs) rows.delete(`${r.DeleteRequest.Key.pk}|${r.DeleteRequest.Key.sk}`)
        }
        return {}
      }
      if (cmd.op === 'delete') {
        rows.delete(`${input.Key.pk}|${input.Key.sk}`)
        return {}
      }
    }
    throw new Error(`unexpected ddb ${table} ${cmd.op}`)
  }

  async function s3Send(cmd) {
    const input = cmd.input
    const call = { service: 's3', op: cmd.op, input }
    calls.push(call)
    if (cmd.op === 'listVersions') {
      if (state.denyListVersions) throw s3Error('AccessDenied')
      // Like S3: by key, then newest first, versions and delete markers
      // together counting towards MaxKeys.
      const all = []
      for (const key of [...bucket.keys()].filter((k) => k.startsWith(input.Prefix)).sort(byKey)) {
        for (const e of [...bucket.get(key)].reverse()) all.push({ Key: key, ...e })
      }
      const size = Math.min(input.MaxKeys ?? 1000, 1000)
      const page = all.slice(0, size)
      return {
        Versions: page.filter((e) => !e.marker).map(({ Key, VersionId }) => ({ Key, VersionId })),
        DeleteMarkers: page.filter((e) => e.marker).map(({ Key, VersionId }) => ({ Key, VersionId })),
        IsTruncated: all.length > size,
      }
    }
    if (cmd.op === 'list') {
      const after = input.ContinuationToken ?? ''
      const keys = [...bucket.keys()]
        .filter((k) => k.startsWith(input.Prefix) && k > after && bucket.get(k).at(-1)?.marker === false)
        .sort(byKey)
      const size = Math.min(input.MaxKeys ?? 1000, 1000)
      const page = keys.slice(0, size)
      const truncated = keys.length > size
      // Kept on the call, so a test can check the next page asked for this token.
      call.output = {
        Contents: page.map((Key) => ({ Key })),
        KeyCount: page.length,
        IsTruncated: truncated,
        NextContinuationToken: truncated ? page.at(-1) : undefined,
      }
      return call.output
    }
    if (cmd.op === 'deleteObjects') {
      const errors = []
      for (const { Key, VersionId } of input.Delete.Objects) {
        if (VersionId === undefined) {
          deleteByKey(Key)
          continue
        }
        if (state.deleteVersionError) {
          errors.push({ Key, VersionId, Code: state.deleteVersionError, Message: 'refused' })
          continue
        }
        const entries = (bucket.get(Key) ?? []).filter((e) => e.VersionId !== VersionId)
        if (entries.length > 0) bucket.set(Key, entries)
        else bucket.delete(Key)
      }
      return errors.length > 0 ? { Errors: errors } : {}
    }
    throw new Error(`unexpected s3 op ${cmd.op}`)
  }

  async function cognitoSend(cmd) {
    calls.push({ service: 'cognito', op: cmd.constructor.name })
    const i = users.findIndex((u) => u.username === cmd.input.Username)
    if (i >= 0) users.splice(i, 1)
    return {}
  }

  return { rows, jobs, bucket, users, calls, state, reset, put, deleteByKey, ddbSend, s3Send, cognitoSend }
})

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: class {},
}))
vi.mock('@aws-sdk/lib-dynamodb', () => {
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
  getSignedUrl: async () => 'https://signed.test/',
}))
vi.mock('@aws-sdk/client-cognito-identity-provider', async (importOriginal) => {
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

import { handler } from './index.js'

const SUB = '5b1c8e4a-7f2d-4c3b-9a6e-0d1f2e3c4b5a'
const OTHER = '9e8d7c6b-5a49-4382-a170-f6e5d4c3b2a1'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const NOW = new Date('2026-11-15T03:00:00.000Z')

const claims = (sub) => ({ sub, email: 'driver@example.test', token_use: 'id', 'cognito:username': sub })

function request(method, path, body, sub = SUB) {
  return handler({
    requestContext: { http: { method, path, sourceIp: '203.0.113.9' }, authorizer: { jwt: { claims: claims(sub) } } },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function seedRow(sub, id) {
  fake.rows.set(`USER#${sub}|SESSION#${id}`, { pk: `USER#${sub}`, sk: `SESSION#${id}`, id, rev: 1 })
}

/** Every entry (versions and delete markers) under a prefix. */
const entriesUnder = (prefix) =>
  [...fake.bucket.entries()].filter(([k]) => k.startsWith(prefix)).flatMap(([k, es]) => es.map((e) => `${k}@${e.VersionId}`))
const s3Calls = (op) => fake.calls.filter((c) => c.service === 's3' && c.op === op)

/**
 * An account as the bucket holds it after a while: a legacy photo put twice
 * (an old version behind the current one), a photo deleted earlier by key
 * (its bytes kept behind a delete marker) and a current photo ref.
 */
function seedAccount(sub) {
  seedRow(sub, 'r1')
  seedRow(sub, 'r2')
  fake.put(`${sub}/r1/sign.jpg`)
  fake.put(`${sub}/r1/sign.jpg`)
  fake.put(`${sub}/r1/car.jpg`)
  fake.deleteByKey(`${sub}/r1/car.jpg`)
  fake.put(`${sub}/r2/p/${SHA_A}.jpg`)
}

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

describe('Delete forever on a versioned bucket', () => {
  it('deletes every version and delete marker under the account, by VersionId, and nothing of anyone else', async () => {
    fake.users.push({ username: SUB, sub: SUB })
    seedAccount(SUB)
    fake.put(`${OTHER}/theirs/p/${SHA_A}.jpg`)
    expect(entriesUnder(`${SUB}/`)).toHaveLength(5)

    const res = await request('POST', '/me/delete')
    expect(res.statusCode).toBe(200)
    // Four photo versions (the delete marker isn't counted).
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, deleted_rows: 2, deleted_objects: 4 })
    expect(entriesUnder(`${SUB}/`)).toEqual([])
    expect(entriesUnder(`${OTHER}/`)).toHaveLength(1)
    // Every delete named its version: none left a delete marker behind.
    const deleted = s3Calls('deleteObjects').flatMap((c) => c.input.Delete.Objects)
    expect(deleted).toHaveLength(5)
    for (const o of deleted) expect(o.VersionId).toEqual(expect.any(String))
    expect(s3Calls('list')).toEqual([])
    expect(console.error).not.toHaveBeenCalled()
    expect(fake.users).toEqual([])
  })

  it('takes as many passes as it needs, each listing from the start, at most 1000 entries a delete', async () => {
    fake.users.push({ username: SUB, sub: SUB })
    for (let i = 0; i < 1500; i++) fake.put(`${SUB}/r1/p/${String(i).padStart(64, '0')}.jpg`)
    fake.deleteByKey(`${SUB}/r1/p/${'0'.repeat(64)}.jpg`)

    const res = await request('POST', '/me/delete')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ deleted_objects: 1500 })
    expect(entriesUnder(`${SUB}/`)).toEqual([])
    const lists = s3Calls('listVersions')
    expect(lists).toHaveLength(3) // 1000, then 501, then none left
    for (const l of lists) expect(l.input).toEqual({ Bucket: 'test-evidence', Prefix: `${SUB}/`, MaxKeys: 1000 })
    for (const d of s3Calls('deleteObjects')) expect(d.input.Delete.Objects.length).toBeLessThanOrEqual(1000)
  })

  it('without s3:ListBucketVersions, deletes the current photos by key, as before, logs the AccessDenied, and still deletes the account', async () => {
    fake.users.push({ username: SUB, sub: SUB })
    seedAccount(SUB)
    fake.state.denyListVersions = true

    const res = await request('POST', '/me/delete')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, deleted_objects: 2 })
    // No current photo is left to read...
    expect((await fake.s3Send({ op: 'list', input: { Prefix: `${SUB}/` } })).Contents).toEqual([])
    // ...but their old versions are, until the lifecycle rule removes them.
    expect(entriesUnder(`${SUB}/`).length).toBeGreaterThan(0)
    expect(console.error).toHaveBeenCalledWith(
      '[parkproof.s3] AccessDenied deleting old photo versions: deleted the current photos only. Run scripts/setup-evidence-versions.sh.',
    )
    expect(fake.users).toEqual([])
  })

  it('without s3:ListBucketVersions, the fallback deletes more than 1,000 current photos across ListObjectsV2 pages, every one, following the continuation token', async () => {
    fake.users.push({ username: SUB, sub: SUB })
    // 2,500 current photos: three pages of at most 1,000 keys.
    for (let i = 0; i < 2500; i++) fake.put(`${SUB}/r1/p/${String(i).padStart(64, '0')}.jpg`)
    fake.put(`${OTHER}/theirs/p/${SHA_A}.jpg`)
    fake.state.denyListVersions = true

    const res = await request('POST', '/me/delete')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, deleted_objects: 2500 })

    // Three pages: the first from the start, each later one with the token
    // the page before it gave, and the last one not truncated.
    const lists = s3Calls('list')
    expect(lists.map((l) => l.output.KeyCount)).toEqual([1000, 1000, 500])
    expect(lists.map((l) => l.output.IsTruncated)).toEqual([true, true, false])
    expect(lists[0].input.ContinuationToken).toBeUndefined()
    expect(lists[1].input.ContinuationToken).toBe(lists[0].output.NextContinuationToken)
    expect(lists[2].input.ContinuationToken).toBe(lists[1].output.NextContinuationToken)
    for (const l of lists) expect(l.input).toMatchObject({ Bucket: 'test-evidence', Prefix: `${SUB}/`, MaxKeys: 1000 })
    // Each page deleted by key, all of it: 2,500 keys in three deletes, every key once.
    const deletes = s3Calls('deleteObjects').map((c) => c.input.Delete.Objects)
    expect(deletes.map((objects) => objects.length)).toEqual([1000, 1000, 500])
    const keys = deletes.flat().map((o) => o.Key)
    expect(new Set(keys).size).toBe(2500)
    for (const o of deletes.flat()) expect(o.VersionId).toBeUndefined()
    // No current photo of the account is left to read, and nobody else's was touched.
    expect((await fake.s3Send({ op: 'list', input: { Prefix: `${SUB}/` } })).Contents).toEqual([])
    expect(entriesUnder(`${OTHER}/`)).toHaveLength(1)
    expect(fake.users).toEqual([])
  })

  it('without s3:DeleteObjectVersion (every delete by version refused), falls back the same way', async () => {
    fake.users.push({ username: SUB, sub: SUB })
    seedAccount(SUB)
    fake.state.deleteVersionError = 'AccessDenied'

    const res = await request('POST', '/me/delete')
    expect(res.statusCode).toBe(200)
    expect((await fake.s3Send({ op: 'list', input: { Prefix: `${SUB}/` } })).Contents).toEqual([])
    expect(console.error).toHaveBeenCalledWith('[parkproof.s3] 5 of 5 versions not deleted: AccessDenied')
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/^\[parkproof\.s3\] AccessDenied deleting old photo versions/))
  })

  it('any other failed delete stops before the Cognito user goes, says so plainly, and removes the marker for the retry', async () => {
    fake.users.push({ username: SUB, sub: SUB })
    seedAccount(SUB)
    fake.state.deleteVersionError = 'InternalError'

    const res = await request('POST', '/me/delete')
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body)).toEqual({ error: 'Could not delete every photo. Please try again.' })
    // No key (it holds the account's ID) in the answer.
    expect(res.body).not.toContain(SUB)
    expect(fake.users).toHaveLength(1)
    // The account isn't deleted, so no device is refused (lambda/account-deleted.test.js).
    expect(fake.jobs.has(`DEL#${SUB}`)).toBe(false)
    expect(console.error).toHaveBeenCalledWith('[parkproof.s3] 5 of 5 versions not deleted: InternalError')

    // The retry, once S3 is back, finishes the job.
    fake.state.deleteVersionError = null
    expect((await request('POST', '/me/delete')).statusCode).toBe(200)
    expect(entriesUnder(`${SUB}/`)).toEqual([])
    expect(fake.users).toEqual([])
  })
})

describe('Deleting one record on a versioned bucket', () => {
  it("deletes every version and delete marker under the record, and leaves the account's other records alone", async () => {
    seedAccount(SUB)
    fake.put(`${SUB}/r1/p/${SHA_B}.jpg`)

    const res = await request('POST', '/sessions/delete', { session_id: 'r1' })
    expect(res.statusCode).toBe(200)
    expect(entriesUnder(`${SUB}/r1/`)).toEqual([])
    expect(entriesUnder(`${SUB}/r2/`)).toHaveLength(1)
    expect(s3Calls('listVersions').map((c) => c.input.Prefix)).toEqual([`${SUB}/r1/`, `${SUB}/r1/`])
  })
})

describe("A deleted account's refused presign", () => {
  it('re-sweeps every version a late photo left', async () => {
    fake.jobs.set(`DEL#${SUB}`, { job_id: `DEL#${SUB}`, kind: 'account-deleted', ttl: NOW.getTime() / 1000 + 172_800 })
    // A photo PUT through a URL presigned before the delete lands twice (a retry).
    fake.put(`${SUB}/r1/p/${SHA_A}.jpg`)
    fake.put(`${SUB}/r1/p/${SHA_A}.jpg`)

    const res = await request('POST', '/photos/presign', { session_id: 'r1', sha256: SHA_B })
    expect(res.statusCode).toBe(410)
    expect(entriesUnder(`${SUB}/`)).toEqual([])
    expect(console.log).toHaveBeenCalledWith(`[parkproof.account] refused route=photos/presign user=${SUB} resweep_objects=2`)
  })
})
