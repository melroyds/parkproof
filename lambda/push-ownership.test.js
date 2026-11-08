// @vitest-environment node
// Push ownership (spec N6): schedules belong to the device that created them.
// /push/schedule and /push/cancel read every existing schedule first and go
// ahead only when the device_id in its Target Input matches the caller's. A
// mismatch is 403 ERR_NOT_OWNER and changes nothing.
//
// The EventBridge Scheduler client is replaced with an in-memory fake that
// behaves like the real one for the calls we make: GetSchedule and
// DeleteSchedule throw ResourceNotFoundException for a missing name,
// CreateSchedule throws ConflictException for an existing one.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const fake = vi.hoisted(() => {
  // Module-level env is read when index.js loads, so set it before import.
  process.env.PUSH_SCHEDULER_ROLE_ARN = 'arn:aws:iam::123456789012:role/test-scheduler'
  process.env.PUSH_DISPATCH_LAMBDA_ARN = 'arn:aws:lambda:ap-southeast-2:123456789012:function:test'
  const store = new Map()
  const calls = []
  const error = (name) => Object.assign(new Error(name), { name })
  const state = { getFailure: null }
  function send(cmd) {
    calls.push({ op: cmd.op, name: cmd.input.Name })
    if (cmd.op === 'get') {
      if (state.getFailure) return Promise.reject(error(state.getFailure))
      if (!store.has(cmd.input.Name)) return Promise.reject(error('ResourceNotFoundException'))
      return Promise.resolve(structuredClone(store.get(cmd.input.Name)))
    }
    if (cmd.op === 'delete') {
      if (!store.delete(cmd.input.Name)) return Promise.reject(error('ResourceNotFoundException'))
      return Promise.resolve({})
    }
    if (cmd.op === 'create') {
      if (store.has(cmd.input.Name)) return Promise.reject(error('ConflictException'))
      store.set(cmd.input.Name, { Name: cmd.input.Name, Target: cmd.input.Target })
      return Promise.resolve({ ScheduleArn: `arn:test:${cmd.input.Name}` })
    }
    return Promise.reject(new Error(`unexpected op ${cmd.op}`))
  }
  // The push-subscriptions table: /push/schedule refuses a device with no
  // live row (ERR_NOT_SUBSCRIBED, covered in push-registration.test.js), so
  // every device in these tests is registered. Mocked so no test can reach
  // a real DynamoDB table.
  const subs = new Map()
  function ddbSend(cmd) {
    if (cmd.op === 'get') {
      const item = subs.get(cmd.input.Key.device_id)
      return Promise.resolve({ Item: item === undefined ? undefined : structuredClone(item) })
    }
    if (cmd.op === 'update') return Promise.resolve({})
    return Promise.reject(new Error(`unexpected ddb op ${cmd.op}`))
  }
  return { store, calls, state, send, subs, ddbSend }
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
    DeleteCommand: command('delete'),
    UpdateCommand: command('update'),
  }
})

vi.mock('@aws-sdk/client-scheduler', () => {
  // Real classes, not arrow-function factories: the code does `new X(...)`.
  class SchedulerClient {
    send(cmd) {
      return fake.send(cmd)
    }
  }
  class GetScheduleCommand {
    constructor(input) {
      this.op = 'get'
      this.input = input
    }
  }
  class DeleteScheduleCommand {
    constructor(input) {
      this.op = 'delete'
      this.input = input
    }
  }
  class CreateScheduleCommand {
    constructor(input) {
      this.op = 'create'
      this.input = input
    }
  }
  return { SchedulerClient, GetScheduleCommand, DeleteScheduleCommand, CreateScheduleCommand }
})

import { handler, scheduleOwnerDeviceId, PUSH_ERR_NOT_OWNER } from './index.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const SID = 'session-abc'

function post(path, body) {
  return handler({
    requestContext: { http: { method: 'POST', path } },
    body: JSON.stringify(body),
  })
}

function futureIso(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

function scheduleBody(device_id, count = 2) {
  return {
    device_id,
    session_id: SID,
    expires_at: futureIso(120),
    reminders: Array.from({ length: count }, (_, i) => ({
      fire_at: futureIso(60 + i * 10),
      title: 'Parking reminder',
      body: 'Your parking expires soon.',
      url: `/app/?session=${SID}`,
    })),
  }
}

/** Put a schedule straight into the fake store, as if created earlier. */
function seed(name, input) {
  fake.store.set(name, {
    Name: name,
    Target: { Input: typeof input === 'string' ? input : JSON.stringify(input) },
  })
}

function snapshot() {
  return JSON.stringify([...fake.store.entries()].sort())
}

const mutatingCalls = () => fake.calls.filter((c) => c.op !== 'get')

beforeEach(() => {
  fake.store.clear()
  fake.calls.length = 0
  fake.state.getFailure = null
  fake.subs.clear()
  const live = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
  for (const device_id of [OWNER, OTHER]) {
    fake.subs.set(device_id, { device_id, endpoint: 'https://push.example/x', p256dh: 'p', auth: 'a', expires_at: live })
  }
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('scheduleOwnerDeviceId()', () => {
  it('reads device_id from the schedule Target Input', () => {
    expect(scheduleOwnerDeviceId({ Target: { Input: JSON.stringify({ device_id: OWNER }) } })).toBe(OWNER)
  })

  it('returns null when the Input is missing, unparseable or has no device_id', () => {
    expect(scheduleOwnerDeviceId(undefined)).toBeNull()
    expect(scheduleOwnerDeviceId({})).toBeNull()
    expect(scheduleOwnerDeviceId({ Target: {} })).toBeNull()
    expect(scheduleOwnerDeviceId({ Target: { Input: '{not json' } })).toBeNull()
    expect(scheduleOwnerDeviceId({ Target: { Input: JSON.stringify({ session_id: SID }) } })).toBeNull()
    expect(scheduleOwnerDeviceId({ Target: { Input: JSON.stringify({ device_id: '' }) } })).toBeNull()
  })
})

describe('POST /push/schedule ownership', () => {
  it('creates schedules that carry the caller device_id in their Input', async () => {
    const res = await post('/push/schedule', scheduleBody(OWNER, 2))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).created).toHaveLength(2)
    for (const s of fake.store.values()) {
      expect(scheduleOwnerDeviceId(s)).toBe(OWNER)
    }
  })

  it('reads every slot before it deletes or creates anything', async () => {
    await post('/push/schedule', scheduleBody(OWNER, 1))
    const firstMutation = fake.calls.findIndex((c) => c.op !== 'get')
    const gets = fake.calls.slice(0, firstMutation)
    expect(gets).toHaveLength(6)
    expect(gets.every((c) => c.op === 'get')).toBe(true)
  })

  it('lets the owner replace its own schedules (replace-all)', async () => {
    await post('/push/schedule', scheduleBody(OWNER, 3))
    expect(fake.store.size).toBe(3)
    const res = await post('/push/schedule', scheduleBody(OWNER, 1))
    expect(res.statusCode).toBe(200)
    expect(fake.store.size).toBe(1)
    expect(scheduleOwnerDeviceId([...fake.store.values()][0])).toBe(OWNER)
  })

  it('refuses another device with 403 ERR_NOT_OWNER and changes nothing', async () => {
    await post('/push/schedule', scheduleBody(OWNER, 2))
    const before = snapshot()
    fake.calls.length = 0

    const res = await post('/push/schedule', scheduleBody(OTHER, 1))
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body)).toEqual({ error: PUSH_ERR_NOT_OWNER })
    expect(PUSH_ERR_NOT_OWNER).toBe('ERR_NOT_OWNER')
    expect(snapshot()).toBe(before)
    expect(mutatingCalls()).toEqual([])
  })

  it('refuses when even one existing slot belongs to someone else', async () => {
    seed(`parkproof-push-${SID}-0`, { device_id: OWNER })
    seed(`parkproof-push-${SID}-3`, { device_id: OTHER })
    const before = snapshot()

    const res = await post('/push/schedule', scheduleBody(OWNER, 1))
    expect(res.statusCode).toBe(403)
    expect(snapshot()).toBe(before)
    expect(mutatingCalls()).toEqual([])
  })

  it('treats a schedule it cannot attribute (bad Input) as not owned', async () => {
    seed(`parkproof-push-${SID}-0`, '{garbled')
    const res = await post('/push/schedule', scheduleBody(OWNER, 1))
    expect(res.statusCode).toBe(403)
    expect(mutatingCalls()).toEqual([])
  })

  it('changes nothing when a schedule cannot be read (scheduler error)', async () => {
    seed(`parkproof-push-${SID}-0`, { device_id: OWNER })
    const before = snapshot()
    fake.state.getFailure = 'ThrottlingException'

    const res = await post('/push/schedule', scheduleBody(OWNER, 1))
    expect(res.statusCode).toBe(500)
    expect(snapshot()).toBe(before)
    expect(mutatingCalls()).toEqual([])
  })

  it('still rejects a missing or malformed device_id with 400', async () => {
    const noId = await post('/push/schedule', { ...scheduleBody(OWNER), device_id: undefined })
    expect(noId.statusCode).toBe(400)
    const bad = await post('/push/schedule', { ...scheduleBody(OWNER), device_id: 'not a uuid!' })
    expect(bad.statusCode).toBe(400)
    expect(fake.calls).toEqual([])
  })
})

describe('POST /push/cancel ownership', () => {
  it('lets the owner cancel every schedule for the session', async () => {
    await post('/push/schedule', scheduleBody(OWNER, 3))
    const res = await post('/push/cancel', { device_id: OWNER, session_id: SID })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ deleted: 3 })
    expect(fake.store.size).toBe(0)
  })

  it('only deletes slots that exist (no blind deletes)', async () => {
    seed(`parkproof-push-${SID}-2`, { device_id: OWNER })
    fake.calls.length = 0
    const res = await post('/push/cancel', { device_id: OWNER, session_id: SID })
    expect(JSON.parse(res.body)).toEqual({ deleted: 1 })
    expect(mutatingCalls()).toEqual([{ op: 'delete', name: `parkproof-push-${SID}-2` }])
  })

  it('returns deleted 0 when nothing is scheduled', async () => {
    const res = await post('/push/cancel', { device_id: OWNER, session_id: SID })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ deleted: 0 })
  })

  it('refuses another device with 403 ERR_NOT_OWNER and deletes nothing', async () => {
    await post('/push/schedule', scheduleBody(OWNER, 2))
    const before = snapshot()
    fake.calls.length = 0

    const res = await post('/push/cancel', { device_id: OTHER, session_id: SID })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body)).toEqual({ error: 'ERR_NOT_OWNER' })
    expect(snapshot()).toBe(before)
    expect(mutatingCalls()).toEqual([])
  })

  it('requires device_id (400) before touching the scheduler', async () => {
    seed(`parkproof-push-${SID}-0`, { device_id: OWNER })
    const res = await post('/push/cancel', { session_id: SID })
    expect(res.statusCode).toBe(400)
    expect(fake.calls).toEqual([])
    expect(fake.store.size).toBe(1)
  })

  it('still validates session_id', async () => {
    const res = await post('/push/cancel', { device_id: OWNER, session_id: '../../etc' })
    expect(res.statusCode).toBe(400)
    expect(fake.calls).toEqual([])
  })

  it('ignores a schedule that fires (disappears) between the read and the delete', async () => {
    seed(`parkproof-push-${SID}-0`, { device_id: OWNER })
    seed(`parkproof-push-${SID}-1`, { device_id: OWNER })
    const realSend = fake.send
    const spy = vi.spyOn(fake, 'send').mockImplementation((cmd) => {
      // Slot 1 fires and auto-deletes right after it was read.
      if (cmd.op === 'delete' && cmd.input.Name.endsWith('-1')) fake.store.delete(cmd.input.Name)
      return realSend(cmd)
    })
    const res = await post('/push/cancel', { device_id: OWNER, session_id: SID })
    spy.mockRestore()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ deleted: 1 })
    expect(fake.store.size).toBe(0)
  })
})
