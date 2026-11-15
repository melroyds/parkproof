// @vitest-environment node
// POST /me/delete must be safe to try again (handleMeDelete in cloud-sync.js).
//
// A call can delete the rows, the photos and the Cognito user and still lose
// its answer on the way back to the phone. The phone then tries again, and
// that call finds the Cognito user already gone. It must still sweep the rows
// and photos (a sync still running on the phone may have put some back) and
// answer ok, so the phone signs out and clears itself. Every other Cognito
// error is still a failure, which removes the deletion marker again.
//
// DynamoDB, S3 and the Cognito client are in-memory fakes, as in
// cloud-sync.test.js. The Cognito fake finds a user the way the SDK documents
// `Username` for AdminGetUser and AdminDeleteUser (aliases aside): by
// username, or by the sub of a local user only, so an Apple or Google user's
// sub finds no one. Its commands and exceptions are the SDK's own classes.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const fake = vi.hoisted(() => {
  // Module-level env is read when cloud-sync.js loads, so set it before import.
  process.env.S3_BUCKET_EVIDENCE = 'test-evidence'
  process.env.COGNITO_USER_POOL_ID = 'ap-southeast-2_testpool'
  const rows = new Map() // `${pk}|${sk}` -> item
  const jobs = new Map() // the jobs table, where the deletion marker goes: job_id -> item
  const objects = new Set() // S3 keys
  const users = [] // the user pool: { username, sub, local }
  const calls = []
  // failNext: { op: 'get' | 'delete', error } throws `error` from that Cognito command, once.
  const state = { queryPage: 2, failNext: null }
  const rowKey = (k) => `${k.pk}|${k.sk}`
  const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

  async function ddbSend(cmd) {
    const input = cmd.input
    calls.push({ service: 'ddb', op: cmd.op, input })
    if (input.TableName === 'parkproof-jobs') {
      // The marker goes in first, and comes out again when a later step fails.
      if (cmd.op === 'put') jobs.set(input.Item.job_id, structuredClone(input.Item))
      else if (cmd.op === 'delete') jobs.delete(input.Key.job_id)
      else throw new Error(`unexpected jobs table op ${cmd.op}`)
      return {}
    }
    if (cmd.op === 'query') {
      // Like DynamoDB, ExclusiveStartKey marks a position in key order, so
      // deleting a page before reading the next doesn't skip rows.
      const pkValue = input.ExpressionAttributeValues[':pk']
      const after = input.ExclusiveStartKey?.sk ?? ''
      const all = [...rows.values()].filter((r) => r.pk === pkValue && r.sk > after).sort((a, b) => byKey(a.sk, b.sk))
      const page = all.slice(0, state.queryPage)
      const more = all.length > state.queryPage
      return {
        Items: page.map((r) => (input.ProjectionExpression ? { pk: r.pk, sk: r.sk } : structuredClone(r))),
        LastEvaluatedKey: more ? { pk: page.at(-1).pk, sk: page.at(-1).sk } : undefined,
      }
    }
    if (cmd.op === 'batchWrite') {
      for (const reqs of Object.values(input.RequestItems)) for (const r of reqs) rows.delete(rowKey(r.DeleteRequest.Key))
      return {}
    }
    throw new Error(`unexpected ddb op ${cmd.op}`)
  }

  async function s3Send(cmd) {
    const input = cmd.input
    calls.push({ service: 's3', op: cmd.op, input })
    if (cmd.op === 'list') {
      // Like S3, the continuation token marks a position in key order.
      const after = input.ContinuationToken ?? ''
      const keys = [...objects].filter((k) => k.startsWith(input.Prefix) && k > after).sort(byKey)
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
    if (cmd.op === 'listVersions') {
      // One version per object: this fake keeps no old versions
      // (lambda/evidence-versions.test.js has a bucket that does).
      const keys = [...objects].filter((k) => k.startsWith(input.Prefix)).sort(byKey)
      const size = Math.min(input.MaxKeys ?? 1000, 1000)
      return { Versions: keys.slice(0, size).map((Key) => ({ Key, VersionId: 'v1' })), IsTruncated: keys.length > size }
    }
    if (cmd.op === 'deleteObjects') {
      for (const { Key } of input.Delete.Objects) objects.delete(Key)
      return {}
    }
    throw new Error(`unexpected s3 op ${cmd.op}`)
  }

  // cognitoSend is set below the imports, where the SDK's classes are in scope.
  return { rows, jobs, objects, users, calls, state, ddbSend, s3Send, cognitoSend: null }
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

import {
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderServiceException,
  TooManyRequestsException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider'
import { handleMeDelete } from './cloud-sync.js'

const POOL = process.env.COGNITO_USER_POOL_ID
const SUB = '5b1c8e4a-7f2d-4c3b-9a6e-0d1f2e3c4b5a' // the driver deleting their account
const OTHER = '9e8d7c6b-5a49-4382-a170-f6e5d4c3b2a1' // someone else
const NEWER = '3c2b1a09-f8e7-4d6c-b5a4-938271605f4e' // a newer account under the same Google username
const GOOGLE = 'Google_105556172358914' // Cognito usernames of Google and Apple users
const APPLE = 'SignInWithApple_001234.5f6a7b8c9d0e4f1a.0423'

/** The pool's user for a `Username`: by username, or by the sub of a local user only. */
function findUser(name) {
  return fake.users.find((u) => u.username === name || (u.local && u.sub === name))
}

fake.cognitoSend = async (cmd) => {
  const op = cmd instanceof AdminGetUserCommand ? 'get' : cmd instanceof AdminDeleteUserCommand ? 'delete' : null
  if (!op) throw new Error(`unexpected cognito command ${cmd?.constructor?.name}`)
  fake.calls.push({ service: 'cognito', op, input: cmd.input })
  if (cmd.input.UserPoolId !== POOL) throw new Error(`unexpected user pool ${cmd.input.UserPoolId}`)
  if (fake.state.failNext?.op === op) {
    const { error } = fake.state.failNext
    fake.state.failNext = null
    throw error
  }
  const user = findUser(cmd.input.Username)
  if (!user) throw new UserNotFoundException({ message: 'User does not exist.', $metadata: { httpStatusCode: 400 } })
  if (op === 'get') {
    return {
      Username: user.username,
      UserAttributes: [
        { Name: 'sub', Value: user.sub },
        { Name: 'email', Value: 'driver@example.test' },
      ],
    }
  }
  fake.users.splice(fake.users.indexOf(user), 1)
  return {}
}

/**
 * The request as the Lambda gets it: the id token's claims, which API
 * Gateway's JWT authorizer passes on. A local user's username is their sub
 * (the pool signs in with email); pass null for a token without one.
 */
function deleteEvent(sub, username = sub) {
  const claims = { sub, email: 'driver@example.test', token_use: 'id' }
  if (username !== null) claims['cognito:username'] = username
  return { requestContext: { authorizer: { jwt: { claims } } } }
}

/** A record and its two photos under an account, as an upload leaves them. */
function seedRecord(sub, id) {
  fake.rows.set(`USER#${sub}|SESSION#${id}`, { pk: `USER#${sub}`, sk: `SESSION#${id}`, id, rev: 1 })
  fake.objects.add(`${sub}/${id}/p/${'a'.repeat(64)}.jpg`)
  fake.objects.add(`${sub}/${id}/p/${'b'.repeat(64)}.jpg`)
}

const rowsOf = (sub) => [...fake.rows.values()].filter((r) => r.pk === `USER#${sub}`)
const objectsOf = (sub) => [...fake.objects].filter((k) => k.startsWith(`${sub}/`))
const hasUser = (username) => fake.users.some((u) => u.username === username)
const cognitoCalls = (op) => fake.calls.filter((c) => c.service === 'cognito' && c.op === op)

beforeEach(() => {
  fake.rows.clear()
  fake.jobs.clear()
  fake.objects.clear()
  fake.users.length = 0
  fake.calls.length = 0
  fake.state.queryPage = 2
  fake.state.failNext = null
  vi.spyOn(console, 'log').mockImplementation(() => {})
  // A failed call logs that it removed its marker.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('POST /me/delete, tried again', () => {
  it('a retry after the user is already gone answers ok, and still sweeps the rows and photos', async () => {
    fake.users.push({ username: SUB, sub: SUB, local: true })
    for (const id of ['r1', 'r2', 'r3']) seedRecord(SUB, id)
    seedRecord(OTHER, 'theirs')

    // The first call deletes everything, but its answer never reaches the phone.
    await expect(handleMeDelete(deleteEvent(SUB))).resolves.toMatchObject({ ok: true, deleted_rows: 3, deleted_objects: 6 })
    expect(hasUser(SUB)).toBe(false)
    expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining('cognito=deleted'))
    // The account is marked deleted (lambda/account-deleted.test.js covers the marker).
    expect([...fake.jobs.keys()]).toEqual([`DEL#${SUB}`])
    expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining('marker=written'))

    // A sync still running on the phone puts a record and its photos back.
    seedRecord(SUB, 'late')

    // The retry finds no Cognito user. It still sweeps, and answers ok.
    await expect(handleMeDelete(deleteEvent(SUB))).resolves.toMatchObject({ ok: true, deleted_rows: 1, deleted_objects: 2 })
    expect(rowsOf(SUB)).toEqual([])
    expect(objectsOf(SUB)).toEqual([])
    expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining('cognito=already_deleted'))
    // Someone else's records are never touched.
    expect(rowsOf(OTHER)).toHaveLength(1)
    expect(objectsOf(OTHER)).toHaveLength(2)
    expect(cognitoCalls('delete').map((c) => c.input.Username)).toEqual([SUB, SUB])
  })

  it('reads the rows to sweep strongly consistently, so a record uploaded a moment before is swept too', async () => {
    fake.users.push({ username: SUB, sub: SUB, local: true })
    for (const id of ['r1', 'r2', 'r3']) seedRecord(SUB, id)
    await handleMeDelete(deleteEvent(SUB))
    const queries = fake.calls.filter((c) => c.service === 'ddb' && c.op === 'query')
    expect(queries.length).toBeGreaterThan(1)
    for (const q of queries) expect(q.input.ConsistentRead).toBe(true)
  })

  it.each([
    [
      'an email user',
      SUB,
      'delete',
      () => new TooManyRequestsException({ message: 'Rate exceeded', $metadata: { httpStatusCode: 400 } }),
    ],
    [
      // The lookup that guards an Apple or Google username, refused by IAM.
      'an Apple or Google user',
      APPLE,
      'get',
      () =>
        new CognitoIdentityProviderServiceException({
          name: 'AccessDeniedException',
          $fault: 'client',
          message: 'User is not authorized to perform: cognito-idp:AdminGetUser',
          $metadata: { httpStatusCode: 400 },
        }),
    ],
  ])('every other Cognito error is still a failure, for %s, and trying again finishes the job', async (_who, username, op, makeError) => {
    fake.users.push({ username, sub: SUB, local: username === SUB })
    seedRecord(SUB, 'r1')
    const error = makeError()
    fake.state.failNext = { op, error }

    await expect(handleMeDelete(deleteEvent(SUB, username))).rejects.toBe(error)
    expect(hasUser(username)).toBe(true)
    // The sweeps ran first, as on every call.
    expect(rowsOf(SUB)).toEqual([])
    expect(objectsOf(SUB)).toEqual([])
    // The account isn't deleted, so its deletion marker is gone again
    // (lambda/account-deleted.test.js covers the marker).
    expect(fake.jobs.size).toBe(0)

    await expect(handleMeDelete(deleteEvent(SUB, username))).resolves.toMatchObject({ ok: true })
    expect(hasUser(username)).toBe(false)
    expect([...fake.jobs.keys()]).toEqual([`DEL#${SUB}`])
  })

  it('names an Apple or Google user by their username, since their sub finds no one', async () => {
    fake.users.push({ username: GOOGLE, sub: SUB, local: false })
    seedRecord(SUB, 'r1')

    // A token without a username leaves only the sub, which can't find this
    // user. Not finding them there is no sign they are gone, so it fails,
    // and the account's deletion marker is removed again.
    await expect(handleMeDelete(deleteEvent(SUB, null))).rejects.toBeInstanceOf(UserNotFoundException)
    expect(hasUser(GOOGLE)).toBe(true)
    expect(fake.jobs.size).toBe(0)

    await expect(handleMeDelete(deleteEvent(SUB, GOOGLE))).resolves.toMatchObject({ ok: true })
    expect(hasUser(GOOGLE)).toBe(false)
    expect(cognitoCalls('delete').map((c) => c.input.Username)).toEqual([SUB, GOOGLE])

    // A retry after that is ok too, and sweeps what arrived in between.
    seedRecord(SUB, 'late')
    await expect(handleMeDelete(deleteEvent(SUB, GOOGLE))).resolves.toMatchObject({ ok: true, deleted_rows: 1 })
    expect(rowsOf(SUB)).toEqual([])
    expect(objectsOf(SUB)).toEqual([])
  })

  it('never deletes a newer account that has taken the same Apple or Google username', async () => {
    // The first call deleted the driver's account and its answer was lost.
    // The driver then signed in again with the same Google account, which
    // made a new user, with a new sub, under the same username.
    fake.users.push({ username: GOOGLE, sub: NEWER, local: false })
    seedRecord(NEWER, 'new1')
    seedRecord(SUB, 'late')

    // The old token's retry: its own account is gone, so it answers ok,
    // sweeps under its own sub, and leaves the newer account alone.
    await expect(handleMeDelete(deleteEvent(SUB, GOOGLE))).resolves.toMatchObject({ ok: true, deleted_rows: 1 })
    expect(rowsOf(SUB)).toEqual([])
    expect(objectsOf(SUB)).toEqual([])
    expect(hasUser(GOOGLE)).toBe(true)
    expect(rowsOf(NEWER)).toHaveLength(1)
    expect(objectsOf(NEWER)).toHaveLength(2)
    expect(cognitoCalls('delete')).toEqual([])
  })
})
