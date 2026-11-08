// @vitest-environment node
// Cloud sync for the evidence chain and photos (build spec T0b4).
//
// DynamoDB and S3 are replaced with in-memory fakes that behave like the
// real services for the calls the handlers make: conditional PutItem
// (ConditionalCheckFailedException), paginated Query, ListObjectsV2 pages of
// at most 1000 keys, HeadObject 404s, GetObject streams.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const fake = vi.hoisted(() => {
  // Module-level env is read when cloud-sync.js loads, so set it before import.
  process.env.S3_BUCKET_EVIDENCE = 'test-evidence'
  const rows = new Map() // `${pk}|${sk}` -> item
  const objects = new Map() // key -> { body: Buffer, contentType }
  const calls = []
  const state = { queryPage: 2, beforePut: null }
  const error = (name, extra = {}) => Object.assign(new Error(name), { name, ...extra })
  const rowKey = (k) => `${k.pk}|${k.sk}`

  function conditionHolds(input, current) {
    const expr = input.ConditionExpression
    if (!expr) return true
    const values = input.ExpressionAttributeValues ?? {}
    if (expr === 'attribute_not_exists(#pk)') return current === undefined
    if (expr === '#rev = :rev') return current !== undefined && current.rev === values[':rev']
    if (expr === 'attribute_exists(#pk) AND attribute_not_exists(#rev)') return current !== undefined && current.rev === undefined
    throw new Error(`unexpected condition ${expr}`)
  }

  async function ddbSend(cmd) {
    calls.push({ service: 'ddb', op: cmd.op, input: cmd.input })
    const input = cmd.input
    if (cmd.op === 'get') {
      const item = rows.get(rowKey(input.Key))
      return { Item: item === undefined ? undefined : structuredClone(item) }
    }
    if (cmd.op === 'put') {
      if (state.beforePut) await state.beforePut(input)
      const current = rows.get(rowKey(input.Item))
      if (!conditionHolds(input, current)) throw error('ConditionalCheckFailedException')
      rows.set(rowKey(input.Item), structuredClone(input.Item))
      return {}
    }
    if (cmd.op === 'query') {
      const pkValue = input.ExpressionAttributeValues[':pk']
      const all = [...rows.values()].filter((r) => r.pk === pkValue).sort((a, b) => a.sk.localeCompare(b.sk))
      if (input.ScanIndexForward === false) all.reverse()
      let start = 0
      if (input.ExclusiveStartKey) start = all.findIndex((r) => r.sk === input.ExclusiveStartKey.sk) + 1
      const page = all.slice(start, start + state.queryPage)
      const more = start + state.queryPage < all.length
      const items = page.map((r) => {
        if (!input.ProjectionExpression) return structuredClone(r)
        return { pk: r.pk, sk: r.sk }
      })
      return { Items: items, LastEvaluatedKey: more ? { pk: page.at(-1).pk, sk: page.at(-1).sk } : undefined }
    }
    if (cmd.op === 'delete') {
      rows.delete(rowKey(input.Key))
      return {}
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
      // Like S3, the continuation token marks a position in key order, so
      // deleting a listed page doesn't make the next page skip keys.
      const after = input.ContinuationToken ?? ''
      const keys = [...objects.keys()].filter((k) => k.startsWith(input.Prefix) && k > after).sort()
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
          yield o.body.subarray(0, 3)
          yield o.body.subarray(3)
        })(),
      }
    }
    if (cmd.op === 'deleteObjects') {
      for (const { Key } of input.Delete.Objects) objects.delete(Key)
      return {}
    }
    throw new Error(`unexpected s3 op ${cmd.op}`)
  }

  return { rows, objects, calls, state, ddbSend, s3Send, error }
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
    ListObjectsV2Command: command('list'),
    PutObjectCommand: command('put'),
  }
})
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: async (_client, cmd) => `https://signed.test/${cmd.op}/${cmd.input.Key}`,
}))
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class {
    send() {
      return Promise.resolve({})
    }
  },
  AdminDeleteUserCommand: class {},
}))

import {
  ALLOWED_SESSION_FIELDS,
  ERR_CONFLICT,
  MAX_ADDENDA,
  MAX_UPLOAD_ATTEMPTS,
  MAX_USER_OBJECTS,
  handleMeExport,
  handlePhotosMaterialize,
  handlePhotosPresign,
  handleSessionsDelete,
  handleSessionsList,
  handleSessionsUpload,
  isValidSessionId,
  mergeAddendaRows,
  mergePhotoRefs,
  mergeSessionRows,
  refPhotoKey,
} from './cloud-sync.js'

const USER = 'user-1111'
const SID = '0f0e0d0c-0b0a-4908-8706-050403020100'
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

const event = (body, sub = USER) => ({
  requestContext: { authorizer: { jwt: { claims: { sub, email: 'x@example.test' } } } },
  body: JSON.stringify(body),
})
const storedRow = (id = SID) => fake.rows.get(`USER#${USER}|SESSION#${id}`)
const puts = () => fake.calls.filter((c) => c.service === 'ddb' && c.op === 'put')
const s3Ops = (op) => fake.calls.filter((c) => c.service === 's3' && c.op === op)

const bundle = (tag) => ({
  schema: 'parkproof-addendum-v1',
  signed_at: '2026-10-20T01:00:05.000Z',
  algorithm: 'ECDSA_SHA_256',
  key_alias: 'alias/parkproof-evidence-signing',
  canonical_payload: JSON.stringify({ tag }),
  signature_base64: `sig-${tag}`,
})
const link0 = (tag) => ({ ...bundle(tag), schema: 'parkproof-evidence-v2' })

function addendum(id, seq, state = 'pending', extra = {}) {
  const a = { id, seq, kind: 'condition', captured_at: `2026-10-20T01:0${seq % 10}:00.000Z`, data: { n: seq } }
  if (state === 'signed') a.bundle = bundle(id)
  if (state === 'rejected') a.rejected = { code: 'ERR_BAD_VALUE', at: '2026-10-20T01:10:00.000Z' }
  return { ...a, ...extra }
}

function record(overrides = {}) {
  return {
    id: SID,
    arrived_at: '2026-10-20T01:00:00.000Z',
    location: null,
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    ...overrides,
  }
}

const photoRef = (role, sha256) => ({ role, sha256, captured_at: '2026-10-20T00:59:00.000Z', source: 'camera_input' })

beforeEach(() => {
  fake.rows.clear()
  fake.objects.clear()
  fake.calls.length = 0
  fake.state.queryPage = 2
  fake.state.beforePut = null
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('ALLOWED_SESSION_FIELDS', () => {
  it('lists every ParkingSession field in src/types.ts (so no field silently fails to sync)', () => {
    const types = readFileSync(fileURLToPath(new URL('../src/types.ts', import.meta.url)), 'utf8')
    const start = types.indexOf('export interface ParkingSession {')
    expect(start).toBeGreaterThan(-1)
    // Comments out, so their brackets don't count.
    const body = types.slice(start).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    // Top-level members only: two-space indent, then the name.
    const fields = []
    let depth = 0
    for (const line of body.split(/\r?\n/).slice(1)) {
      if (depth === 0 && /^}/.test(line)) break
      const m = depth === 0 ? /^ {2}([a-z_0-9]+)\??:/.exec(line) : null
      if (m) fields.push(m[1])
      for (const ch of line) {
        if (ch === '{' || ch === '(' || ch === '[') depth++
        if (ch === '}' || ch === ')' || ch === ']') depth--
      }
    }
    for (const known of ['id', 'arrived_at', 'photo_sync_failed', 'chain_key', 'addenda', 'shared_from']) {
      expect(fields).toContain(known)
    }
    expect(fields.length).toBeGreaterThan(35)
    expect(fields.filter((f) => !ALLOWED_SESSION_FIELDS.includes(f))).toEqual([])
    for (const internal of ['pk', 'sk', 'gsi_updated_at', 'rev']) expect(ALLOWED_SESSION_FIELDS).not.toContain(internal)
  })
})

describe('mergeAddendaRows', () => {
  it('unions by id and keeps chain order', () => {
    const out = mergeAddendaRows([addendum('a1', 1, 'signed')], [addendum('a2', 2, 'signed'), addendum('a1', 1, 'signed')])
    expect(out.map((a) => a.id)).toEqual(['a1', 'a2'])
  })

  it('never drops or replaces a stored signed addendum', () => {
    const stored = addendum('a1', 1, 'signed')
    // The upload has it pending, or with a different bundle (a second signing).
    expect(mergeAddendaRows([stored], [addendum('a1', 1)])[0].bundle).toEqual(stored.bundle)
    const other = { ...addendum('a1', 1), bundle: bundle('second') }
    expect(mergeAddendaRows([stored], [other])[0].bundle).toEqual(stored.bundle)
    // And a stored signed addendum the upload leaves out stays.
    expect(mergeAddendaRows([stored], []).map((a) => a.id)).toEqual(['a1'])
  })

  it('prefers the copy with a bundle', () => {
    const out = mergeAddendaRows([addendum('a1', 1)], [addendum('a1', 1, 'signed')])
    expect(out[0].bundle).toBeDefined()
  })

  it('a rejection beats a pending copy; otherwise the upload wins', () => {
    expect(mergeAddendaRows([addendum('a1', 1, 'rejected')], [addendum('a1', 1)])[0].rejected).toBeDefined()
    expect(mergeAddendaRows([addendum('a1', 1)], [addendum('a1', 1, 'rejected')])[0].rejected).toBeDefined()
    const renumbered = mergeAddendaRows([addendum('a1', 3)], [addendum('a1', 2)])
    expect(renumbered[0].seq).toBe(2)
  })

  it(`caps at ${MAX_ADDENDA}: stored signed ones always stay, then signed, rejected, pending`, () => {
    const stored = Array.from({ length: 15 }, (_, i) => addendum(`s${i}`, i + 1, 'signed'))
    const incoming = [
      ...Array.from({ length: 4 }, (_, i) => addendum(`n${i}`, 16 + i, 'signed')),
      addendum('r0', 20, 'rejected'),
      addendum('r1', 21, 'rejected'),
      addendum('p0', 20),
    ]
    const out = mergeAddendaRows(stored, incoming)
    expect(out).toHaveLength(MAX_ADDENDA)
    for (const s of stored) expect(out.map((a) => a.id)).toContain(s.id)
    expect(out.filter((a) => a.id.startsWith('n'))).toHaveLength(4)
    expect(out.filter((a) => a.id.startsWith('r'))).toHaveLength(1)
    expect(out.some((a) => a.id === 'p0')).toBe(false)
    // Already more stored signed addenda than the cap: none is dropped.
    const many = Array.from({ length: 22 }, (_, i) => addendum(`m${i}`, i + 1, 'signed'))
    expect(mergeAddendaRows(many, [addendum('x', 23, 'signed')])).toHaveLength(22)
  })
})

describe('mergeSessionRows', () => {
  it('a new record: whitelisted fields only, legacy photo fields always null', () => {
    const out = mergeSessionRows(null, { ...record({ sign_photo: 'https://old', car_photo: 'data:image/jpeg;base64,AA' }), pk: 'evil' })
    expect(out.pk).toBeUndefined()
    expect(out.sign_photo).toBeNull()
    expect(out.car_photo).toBeNull()
    expect(out.rules).toBe('2P')
  })

  it('signature, chain_key and v1_hashes are first-write-wins', () => {
    const stored = record({ signature: link0('first'), chain_key: 'k1', v1_hashes: { sign: SHA_A, car: null, ambient: null } })
    const out = mergeSessionRows(stored, record({ signature: link0('second'), chain_key: 'k2', v1_hashes: { sign: SHA_B, car: null, ambient: null } }))
    expect(out.signature.signature_base64).toBe('sig-first')
    expect(out.chain_key).toBe('k1')
    expect(out.v1_hashes.sign).toBe(SHA_A)
    // Kept when the upload has none.
    expect(mergeSessionRows(stored, record()).signature.signature_base64).toBe('sig-first')
    // Taken from the upload when nothing is stored.
    expect(mergeSessionRows(record(), record({ signature: link0('new') })).signature.signature_base64).toBe('sig-new')
  })

  it('ended_at and departure: kept when the upload has none, otherwise the upload wins', () => {
    const departure = { ended_at: '2026-10-20T02:00:00.000Z', location: null, distance_from_arrival_m: null }
    const stored = record({ ended_at: '2026-10-20T02:00:00.000Z', departure })
    const kept = mergeSessionRows(stored, record({ ended_at: null }))
    expect(kept.ended_at).toBe('2026-10-20T02:00:00.000Z')
    expect(kept.departure).toEqual(departure)
    const replaced = mergeSessionRows(stored, record({ ended_at: '2026-10-20T02:05:00.000Z' }))
    expect(replaced.ended_at).toBe('2026-10-20T02:05:00.000Z')
  })

  it('everything else is last write wins, including a field the upload leaves out', () => {
    const out = mergeSessionRows(record({ note: 'old note', push_reminders: [{ fire_at: 'x' }] }), record({ push_reminders: [] }))
    expect(out.note).toBeUndefined()
    expect(out.push_reminders).toEqual([])
  })

  it('unions photo refs and addenda', () => {
    const stored = record({ photos: [photoRef('sign', SHA_A)], addenda: [addendum('a1', 1, 'signed')] })
    const out = mergeSessionRows(stored, record({ photos: [photoRef('car', SHA_B), photoRef('sign', SHA_A)], addenda: [addendum('a2', 2, 'signed')] }))
    expect(out.photos.map((p) => p.role)).toEqual(['sign', 'car'])
    expect(out.addenda.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(mergePhotoRefs(undefined, [photoRef('car', SHA_B)])).toHaveLength(1)
  })
})

describe('POST /sessions/upload', () => {
  it('first upload creates the row with rev 1 under the JWT user, never the body\'s keys', async () => {
    const res = await handleSessionsUpload(event({ session: { ...record(), pk: 'USER#someone-else', sk: 'x' } }))
    expect(res).toMatchObject({ ok: true, session_id: SID, rev: 1 })
    const row = storedRow()
    expect(row.pk).toBe(`USER#${USER}`)
    expect(row.sk).toBe(`SESSION#${SID}`)
    expect(row.rev).toBe(1)
    expect(puts()[0].input.ConditionExpression).toBe('attribute_not_exists(#pk)')
  })

  it('a second upload merges with the stored row and bumps rev', async () => {
    await handleSessionsUpload(event({ session: record({ signature: link0('first'), addenda: [addendum('a1', 1, 'signed')] }) }))
    await handleSessionsUpload(event({ session: record({ note: 'hi', addenda: [addendum('a2', 2, 'signed')] }) }))
    const row = storedRow()
    expect(row.rev).toBe(2)
    expect(row.signature.signature_base64).toBe('sig-first')
    expect(row.addenda.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(row.note).toBe('hi')
    expect(puts()[1].input.ExpressionAttributeValues[':rev']).toBe(1)
  })

  it('never stores a device-local field (photo_sync_failed), and an older stored value is cleared', async () => {
    fake.rows.set(`USER#${USER}|SESSION#${SID}`, { pk: `USER#${USER}`, sk: `SESSION#${SID}`, rev: 1, ...record({ photo_sync_failed: true }) })
    await handleSessionsUpload(event({ session: record({ photo_sync_failed: true }) }))
    expect('photo_sync_failed' in storedRow()).toBe(false)
    expect(ALLOWED_SESSION_FIELDS).toContain('photo_sync_failed')
  })

  it('a row written before rev existed is updated under attribute_not_exists(rev)', async () => {
    fake.rows.set(`USER#${USER}|SESSION#${SID}`, { pk: `USER#${USER}`, sk: `SESSION#${SID}`, ...record({ signature: link0('old') }) })
    await handleSessionsUpload(event({ session: record() }))
    expect(puts()[0].input.ConditionExpression).toBe('attribute_exists(#pk) AND attribute_not_exists(#rev)')
    expect(storedRow().rev).toBe(1)
    expect(storedRow().signature.signature_base64).toBe('sig-old')
  })

  it('a write that lands between the read and the write is merged in, not overwritten', async () => {
    await handleSessionsUpload(event({ session: record({ addenda: [addendum('a1', 1, 'signed')] }) }))
    let raced = false
    fake.state.beforePut = async () => {
      if (raced) return
      raced = true
      // Another device's upload commits first.
      const row = storedRow()
      fake.rows.set(`USER#${USER}|SESSION#${SID}`, { ...row, rev: row.rev + 1, addenda: [...row.addenda, addendum('b2', 2, 'signed')] })
    }
    await handleSessionsUpload(event({ session: record({ addenda: [addendum('c3', 3, 'signed')] }) }))
    expect(storedRow().addenda.map((a) => a.id)).toEqual(['a1', 'b2', 'c3'])
    expect(storedRow().rev).toBe(3)
  })

  it(`gives up with 409 ${ERR_CONFLICT} after ${MAX_UPLOAD_ATTEMPTS} conflicting attempts`, async () => {
    await handleSessionsUpload(event({ session: record() }))
    fake.calls.length = 0
    fake.state.beforePut = async () => {
      const row = storedRow()
      fake.rows.set(`USER#${USER}|SESSION#${SID}`, { ...row, rev: row.rev + 1 })
    }
    await expect(handleSessionsUpload(event({ session: record({ note: 'x' }) }))).rejects.toMatchObject({ statusCode: 409 })
    expect(puts()).toHaveLength(MAX_UPLOAD_ATTEMPTS)
  })

  it('never stores photo bytes or URLs in the row, and reports data-URL fields', async () => {
    const res = await handleSessionsUpload(
      event({ session: record({ sign_photo: 'data:image/jpeg;base64,AAAA', car_photo: 'https://expired.test/car.jpg' }) }),
    )
    expect(res.photos_missing).toEqual(['sign_photo'])
    expect(storedRow().sign_photo).toBeNull()
    expect(storedRow().car_photo).toBeNull()
  })

  it('rejects malformed evidence lists and record ids with 400', async () => {
    const bad = [
      record({ addenda: 'nope' }),
      record({ addenda: [{ id: 'a1' }] }),
      record({ addenda: [addendum('a1', 0)] }),
      record({ addenda: [{ ...addendum('a1', 1), bundle: 'x' }] }),
      record({ photos: [{ role: 'sign', sha256: 'XYZ' }] }),
      record({ id: '../other' }),
      record({ id: 'x'.repeat(65) }),
    ]
    for (const session of bad) {
      await expect(handleSessionsUpload(event({ session }))).rejects.toMatchObject({ statusCode: 400 })
    }
    await expect(handleSessionsUpload(event({}))).rejects.toMatchObject({ statusCode: 400 })
    expect(puts()).toHaveLength(0)
  })

  it('rejects a record too large for one row', async () => {
    const huge = record({ rules: 'x'.repeat(310_000) })
    await expect(handleSessionsUpload(event({ session: huge }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('401 without a JWT sub', async () => {
    await expect(handleSessionsUpload({ body: '{}' })).rejects.toMatchObject({ statusCode: 401 })
  })
})

describe('GET /sessions/list', () => {
  it('follows DynamoDB pages and strips server attributes', async () => {
    for (const id of ['r1', 'r2', 'r3']) await handleSessionsUpload(event({ session: record({ id }) }))
    fake.calls.length = 0
    const { sessions } = await handleSessionsList(event({}))
    expect(sessions.map((s) => s.id).sort()).toEqual(['r1', 'r2', 'r3'])
    // Strongly consistent on every page: an eventually consistent read just
    // after a /sessions/delete can still list the deleted row, and a phone
    // that pulls it back uploads it again (polish list).
    const queries = fake.calls.filter((c) => c.service === 'ddb' && c.op === 'query')
    expect(queries.length).toBeGreaterThan(1)
    for (const q of queries) expect(q.input.ConsistentRead).toBe(true)
    for (const s of sessions) {
      expect(s.rev).toBeUndefined()
      expect(s.pk).toBeUndefined()
      expect(s.gsi_updated_at).toBeUndefined()
    }
  })

  it('hydrates legacy photos from ONE paginated listing, re-minting every time, never for refs', async () => {
    await handleSessionsUpload(event({ session: record({ id: 'old' }) }))
    await handleSessionsUpload(event({ session: record({ id: 'new', photos: [photoRef('sign', SHA_A)] }) }))
    // A stale presigned URL left in an old row is replaced.
    fake.rows.get(`USER#${USER}|SESSION#old`).car_photo = 'https://expired.test/car.jpg'
    fake.objects.set(`${USER}/old/sign.jpg`, { body: Buffer.from('x') })
    // An interim per-role object for a record that has a ref: not hydrated.
    fake.objects.set(`${USER}/new/sign.jpg`, { body: Buffer.from('y') })
    fake.objects.set(refPhotoKey(USER, 'new', SHA_A), { body: Buffer.from('z') })
    for (let i = 0; i < 1200; i++) fake.objects.set(`${USER}/filler/${String(i).padStart(4, '0')}.jpg`, { body: Buffer.from('') })
    fake.calls.length = 0

    const { sessions } = await handleSessionsList(event({}))
    const byId = Object.fromEntries(sessions.map((s) => [s.id, s]))
    expect(byId.old.sign_photo).toBe(`https://signed.test/get/${USER}/old/sign.jpg`)
    expect(byId.old.car_photo).toBeNull()
    expect(byId.new.sign_photo).toBeNull()
    expect(s3Ops('head')).toHaveLength(0)
    expect(s3Ops('list')).toHaveLength(2) // 1203 keys: two pages, one listing
  })
})

describe('POST /photos/presign', () => {
  it('a photo ref gets its content-addressed key', async () => {
    const res = await handlePhotosPresign(event({ session_id: SID, sha256: SHA_A, content_type: 'image/jpeg' }))
    expect(res.key).toBe(`${USER}/${SID}/p/${SHA_A}.jpg`)
    expect(res.url).toBe(`https://signed.test/put/${USER}/${SID}/p/${SHA_A}.jpg`)
  })

  it('a ref that is already stored is not uploaded again', async () => {
    fake.objects.set(refPhotoKey(USER, SID, SHA_A), { body: Buffer.from('x') })
    const res = await handlePhotosPresign(event({ session_id: SID, sha256: SHA_A }))
    expect(res).toMatchObject({ exists: true })
    expect(res.url).toBeUndefined()
  })

  it('the legacy role form still works', async () => {
    const res = await handlePhotosPresign(event({ session_id: SID, role: 'car' }))
    expect(res.key).toBe(`${USER}/${SID}/car.jpg`)
  })

  it('rejects bad bodies', async () => {
    const bad = [
      { session_id: SID, sha256: 'A'.repeat(64) },
      { session_id: SID, sha256: SHA_A.slice(1) },
      { session_id: SID, sha256: SHA_A, role: 'sign' },
      { session_id: SID, role: 'condition-front' },
      { session_id: 'a/b', sha256: SHA_A },
      { sha256: SHA_A },
      { session_id: SID, sha256: SHA_A, content_type: 'text/html' },
    ]
    for (const body of bad) await expect(handlePhotosPresign(event(body))).rejects.toMatchObject({ statusCode: 400 })
  })

  it(`enforces the ${MAX_USER_OBJECTS}-object cap across ListObjectsV2 pages`, async () => {
    for (let i = 0; i < MAX_USER_OBJECTS - 1; i++) fake.objects.set(`${USER}/r${i}/sign.jpg`, { body: Buffer.from('') })
    // 2999 objects: one more fits.
    await expect(handlePhotosPresign(event({ session_id: SID, sha256: SHA_A }))).resolves.toHaveProperty('url')
    fake.objects.set(`${USER}/extra/sign.jpg`, { body: Buffer.from('') })
    // 3000: a new key is refused (a single page would only have counted 1000)...
    await expect(handlePhotosPresign(event({ session_id: SID, sha256: SHA_B }))).rejects.toMatchObject({ statusCode: 400 })
    // ...but replacing an existing legacy photo is allowed.
    await expect(handlePhotosPresign(event({ session_id: 'r1', role: 'sign' }))).resolves.toHaveProperty('url')
    // Another user's objects don't count.
    await expect(handlePhotosPresign(event({ session_id: SID, sha256: SHA_A }, 'user-2222'))).resolves.toHaveProperty('url')
  })
})

describe('POST /photos/materialize', () => {
  it('returns a ref by sha256, a legacy photo by role, null when absent', async () => {
    fake.objects.set(refPhotoKey(USER, SID, SHA_A), { body: Buffer.from('ref-bytes'), contentType: 'image/jpeg' })
    fake.objects.set(`${USER}/${SID}/sign.jpg`, { body: Buffer.from('legacy-bytes'), contentType: 'image/jpeg' })
    const ref = await handlePhotosMaterialize(event({ session_id: SID, sha256: SHA_A }))
    expect(ref.data_url).toBe(`data:image/jpeg;base64,${Buffer.from('ref-bytes').toString('base64')}`)
    const legacy = await handlePhotosMaterialize(event({ session_id: SID, role: 'sign' }))
    expect(legacy.data_url).toBe(`data:image/jpeg;base64,${Buffer.from('legacy-bytes').toString('base64')}`)
    expect(await handlePhotosMaterialize(event({ session_id: SID, sha256: SHA_B }))).toEqual({ data_url: null })
    // Another user's photo can't be reached: the key comes from the JWT.
    expect(await handlePhotosMaterialize(event({ session_id: SID, sha256: SHA_A }, 'user-2222'))).toEqual({ data_url: null })
    await expect(handlePhotosMaterialize(event({ session_id: SID, sha256: 'nope' }))).rejects.toMatchObject({ statusCode: 400 })
  })
})

describe('POST /sessions/delete and GET /me/export', () => {
  it('delete removes the row and every photo under the record, refs included, page by page', async () => {
    await handleSessionsUpload(event({ session: record() }))
    for (let i = 0; i < 1100; i++) fake.objects.set(`${USER}/${SID}/p/${String(i).padStart(64, '0')}.jpg`, { body: Buffer.from('') })
    fake.objects.set(`${USER}/${SID}/sign.jpg`, { body: Buffer.from('') })
    fake.objects.set(`${USER}/other/sign.jpg`, { body: Buffer.from('') })
    await handleSessionsDelete(event({ session_id: SID }))
    expect(storedRow()).toBeUndefined()
    expect([...fake.objects.keys()]).toEqual([`${USER}/other/sign.jpg`])
  })

  it('export follows pages and leaves out chain keys and server attributes', async () => {
    for (const id of ['r1', 'r2', 'r3']) await handleSessionsUpload(event({ session: record({ id, chain_key: 'secret' }) }))
    const out = await handleMeExport(event({}))
    expect(out.sessions).toHaveLength(3)
    for (const s of out.sessions) {
      expect(s.chain_key).toBeUndefined()
      expect(s.rev).toBeUndefined()
    }
  })
})

describe('isValidSessionId', () => {
  it('accepts uuids, refuses slashes, dots, control characters and long ids', () => {
    expect(isValidSessionId(SID)).toBe(true)
    for (const bad of ['', '.', '..', 'a/b', 'a\nb', 'x'.repeat(65), 12]) expect(isValidSessionId(bad)).toBe(false)
  })
})
