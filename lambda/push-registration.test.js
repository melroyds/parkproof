// @vitest-environment node
// Push registration (field-test fix list, item 1). A phone could hold a
// browser push subscription while the server had no row for it (the row
// expired after PUSH_TTL_DAYS, or the first save failed). /push/schedule
// booked anyway and dispatch later dropped the reminder in silence. Now:
//   - /push/schedule refuses with 409 ERR_NOT_SUBSCRIBED when the device has
//     no row, or its row's expires_at has passed (the TTL sweep lags), and
//     changes no schedule;
//   - a successful booking pushes the row's expires_at out again, so a
//     device that keeps booking never expires;
//   - /push/subscribe (re-sent by the app on open and before bookings)
//     writes a fresh expires_at;
//   - a dead endpoint (the push service answered 410 Gone) leaves a
//     tombstone: /push/subscribe refuses that same endpoint with 409
//     ERR_ENDPOINT_GONE, so the app registers a fresh one instead of putting
//     the dead one back and booking reminders that are dropped in silence.
//
// DynamoDB and EventBridge Scheduler are in-memory fakes; no test can reach
// AWS. SDK mocks use real classes, because the code does `new X(...)`.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const fake = vi.hoisted(() => {
  // Module-level env is read when index.js loads, so set it before import.
  process.env.PUSH_SCHEDULER_ROLE_ARN = 'arn:aws:iam::123456789012:role/test-scheduler'
  process.env.PUSH_DISPATCH_LAMBDA_ARN = 'arn:aws:lambda:ap-southeast-2:123456789012:function:test'
  const schedules = new Map()
  const subs = new Map()
  const calls = []
  const state = { getFailure: null, updateFailure: null, pushStatus: 201 }
  const pushes = []
  const error = (name) => Object.assign(new Error(name), { name })

  function schedulerSend(cmd) {
    calls.push({ service: 'scheduler', op: cmd.op, name: cmd.input.Name })
    if (cmd.op === 'get') {
      if (!schedules.has(cmd.input.Name)) return Promise.reject(error('ResourceNotFoundException'))
      return Promise.resolve(structuredClone(schedules.get(cmd.input.Name)))
    }
    if (cmd.op === 'delete') {
      if (!schedules.delete(cmd.input.Name)) return Promise.reject(error('ResourceNotFoundException'))
      return Promise.resolve({})
    }
    if (cmd.op === 'create') {
      if (schedules.has(cmd.input.Name)) return Promise.reject(error('ConflictException'))
      schedules.set(cmd.input.Name, { Name: cmd.input.Name, Target: cmd.input.Target })
      return Promise.resolve({})
    }
    return Promise.reject(new Error(`unexpected scheduler op ${cmd.op}`))
  }

  // Supports exactly the expressions index.js sends to the push table.
  function ddbSend(cmd) {
    const input = cmd.input
    calls.push({ service: 'ddb', op: cmd.op, input })
    if (cmd.op === 'get') {
      if (state.getFailure) return Promise.reject(error(state.getFailure))
      const item = subs.get(input.Key.device_id)
      return Promise.resolve({ Item: item === undefined ? undefined : structuredClone(item) })
    }
    if (cmd.op === 'put') {
      if (input.ConditionExpression === '#ep = :dead') {
        const current = subs.get(input.Item.device_id)
        if (current?.[input.ExpressionAttributeNames['#ep']] !== input.ExpressionAttributeValues[':dead']) {
          return Promise.reject(error('ConditionalCheckFailedException'))
        }
      } else if (input.ConditionExpression) {
        return Promise.reject(new Error(`unexpected put condition ${input.ConditionExpression}`))
      }
      subs.set(input.Item.device_id, structuredClone(input.Item))
      return Promise.resolve({})
    }
    if (cmd.op === 'update') {
      if (state.updateFailure) return Promise.reject(error(state.updateFailure))
      const current = subs.get(input.Key.device_id)
      if (input.ConditionExpression === 'attribute_exists(#id)' && current === undefined) {
        return Promise.reject(error('ConditionalCheckFailedException'))
      }
      const names = input.ExpressionAttributeNames
      const values = input.ExpressionAttributeValues
      const next = { ...(current ?? { device_id: input.Key.device_id }) }
      for (const assignment of input.UpdateExpression.replace(/^SET /, '').split(',')) {
        const [name, value] = assignment.split('=').map((s) => s.trim())
        next[names[name]] = values[value]
      }
      subs.set(input.Key.device_id, next)
      return Promise.resolve({})
    }
    return Promise.reject(new Error(`unexpected ddb op ${cmd.op}`))
  }
  return { schedules, subs, calls, state, pushes, schedulerSend, ddbSend }
})

// No push leaves the test: web-push answers with fake.state.pushStatus.
vi.mock('web-push', () => ({
  default: {
    setVapidDetails() {},
    sendNotification(subscription) {
      fake.pushes.push(subscription.endpoint)
      if (fake.state.pushStatus === 201) return Promise.resolve({ statusCode: 201 })
      return Promise.reject(Object.assign(new Error('push failed'), { statusCode: fake.state.pushStatus }))
    },
  },
}))

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
    DeleteCommand: command('delete'),
    UpdateCommand: command('update'),
  }
})
vi.mock('@aws-sdk/client-scheduler', () => {
  const command = (op) =>
    class {
      constructor(input) {
        this.op = op
        this.input = input
      }
    }
  class SchedulerClient {
    send(cmd) {
      return fake.schedulerSend(cmd)
    }
  }
  return {
    SchedulerClient,
    GetScheduleCommand: command('get'),
    DeleteScheduleCommand: command('delete'),
    CreateScheduleCommand: command('create'),
  }
})

import { handler, PUSH_ERR_ENDPOINT_GONE, PUSH_ERR_NOT_SUBSCRIBED } from './index.js'

const DEVICE = '11111111-1111-4111-8111-111111111111'
const SID = 'session-abc'
const DAY_S = 24 * 60 * 60

const nowSec = () => Math.floor(Date.now() / 1000)
const futureIso = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString()

function post(path, body) {
  return handler({
    requestContext: { http: { method: 'POST', path } },
    body: JSON.stringify(body),
  })
}

function scheduleBody(count = 2) {
  return {
    device_id: DEVICE,
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

function registerRow(expires_at) {
  fake.subs.set(DEVICE, {
    device_id: DEVICE,
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    p256dh: 'p',
    auth: 'a',
    created_at: nowSec() - 100 * DAY_S,
    last_seen_at: nowSec() - 80 * DAY_S,
    expires_at,
  })
}

const schedulerMutations = () =>
  fake.calls.filter((c) => c.service === 'scheduler' && c.op !== 'get')

beforeEach(() => {
  fake.schedules.clear()
  fake.subs.clear()
  fake.calls.length = 0
  fake.state.getFailure = null
  fake.state.updateFailure = null
  fake.state.pushStatus = 201
  fake.pushes.length = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /push/schedule: ERR_NOT_SUBSCRIBED', () => {
  it('refuses with 409 when the server has no registration for the device, and books nothing', async () => {
    const res = await post('/push/schedule', scheduleBody(2))
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body)).toEqual({ error: PUSH_ERR_NOT_SUBSCRIBED })
    expect(PUSH_ERR_NOT_SUBSCRIBED).toBe('ERR_NOT_SUBSCRIBED')
    expect(fake.schedules.size).toBe(0)
    expect(fake.calls.filter((c) => c.service === 'scheduler')).toEqual([])
  })

  it('refuses when the row expired but the TTL sweep has not deleted it yet', async () => {
    registerRow(nowSec() - 60)
    const res = await post('/push/schedule', scheduleBody(1))
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).error).toBe('ERR_NOT_SUBSCRIBED')
    expect(fake.schedules.size).toBe(0)
  })

  it('leaves existing schedules for the record untouched when it refuses', async () => {
    fake.schedules.set(`parkproof-push-${SID}-0`, {
      Name: `parkproof-push-${SID}-0`,
      Target: { Input: JSON.stringify({ device_id: DEVICE }) },
    })
    const res = await post('/push/schedule', scheduleBody(1))
    expect(res.statusCode).toBe(409)
    expect([...fake.schedules.keys()]).toEqual([`parkproof-push-${SID}-0`])
    expect(schedulerMutations()).toEqual([])
  })

  it('reads the registration with a consistent read (the app re-sends it just before booking)', async () => {
    registerRow(nowSec() + 10 * DAY_S)
    await post('/push/schedule', scheduleBody(1))
    const get = fake.calls.find((c) => c.service === 'ddb' && c.op === 'get')
    expect(get.input.ConsistentRead).toBe(true)
    expect(get.input.Key).toEqual({ device_id: DEVICE })
  })

  it('books when the row is live, including a legacy row with no expires_at', async () => {
    registerRow(undefined)
    const res = await post('/push/schedule', scheduleBody(2))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).created).toHaveLength(2)
  })

  it('answers 500 (not a booking) when the registration cannot be read', async () => {
    registerRow(nowSec() + 10 * DAY_S)
    fake.state.getFailure = 'ProvisionedThroughputExceededException'
    const res = await post('/push/schedule', scheduleBody(1))
    expect(res.statusCode).toBe(500)
    expect(schedulerMutations()).toEqual([])
  })
})

describe('POST /push/schedule: expiry refresh', () => {
  it('pushes expires_at out to PUSH_TTL_DAYS from now after a successful booking', async () => {
    registerRow(nowSec() + 2 * DAY_S)
    const before = nowSec()
    const res = await post('/push/schedule', scheduleBody(2))
    expect(res.statusCode).toBe(200)
    const row = fake.subs.get(DEVICE)
    expect(row.expires_at).toBeGreaterThanOrEqual(before + 90 * DAY_S)
    expect(row.expires_at).toBeLessThanOrEqual(nowSec() + 90 * DAY_S)
    expect(row.last_seen_at).toBeGreaterThanOrEqual(before)
    // The keys and endpoint are untouched.
    expect(row.endpoint).toBe('https://fcm.googleapis.com/fcm/send/abc')
    expect(row.p256dh).toBe('p')
  })

  it('keeps the row alive until a day after a reminder booked further out than the TTL', async () => {
    registerRow(nowSec() + 2 * DAY_S)
    const farFire = Date.now() + 100 * DAY_S * 1000
    const body = scheduleBody(1)
    body.expires_at = new Date(farFire + 60 * 60_000).toISOString()
    body.reminders[0].fire_at = new Date(farFire).toISOString()
    const res = await post('/push/schedule', body)
    expect(res.statusCode).toBe(200)
    expect(fake.subs.get(DEVICE).expires_at).toBe(Math.floor(farFire / 1000) + DAY_S)
  })

  it('does not refresh when nothing was booked (every reminder in the past)', async () => {
    const expires_at = nowSec() + 2 * DAY_S
    registerRow(expires_at)
    const body = scheduleBody(1)
    body.reminders[0].fire_at = new Date(Date.now() - 60_000).toISOString()
    const res = await post('/push/schedule', body)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).created).toEqual([])
    expect(fake.subs.get(DEVICE).expires_at).toBe(expires_at)
    expect(fake.calls.some((c) => c.service === 'ddb' && c.op === 'update')).toBe(false)
  })

  it('only updates an existing row (never recreates one without keys)', async () => {
    registerRow(nowSec() + 2 * DAY_S)
    await post('/push/schedule', scheduleBody(1))
    const update = fake.calls.find((c) => c.service === 'ddb' && c.op === 'update')
    expect(update.input.ConditionExpression).toBe('attribute_exists(#id)')
  })

  it('still reports the booking when the refresh fails', async () => {
    registerRow(nowSec() + 2 * DAY_S)
    fake.state.updateFailure = 'ConditionalCheckFailedException'
    const res = await post('/push/schedule', scheduleBody(2))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).created).toHaveLength(2)
  })
})

describe('POST /push/subscribe', () => {
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/new',
    keys: { p256dh: 'p2', auth: 'a2' },
  }

  it('re-registering an expired device writes a fresh expires_at, and then booking works', async () => {
    registerRow(nowSec() - 60)
    expect((await post('/push/schedule', scheduleBody(1))).statusCode).toBe(409)

    const before = nowSec()
    const sub = await post('/push/subscribe', { device_id: DEVICE, subscription })
    expect(sub.statusCode).toBe(204)
    const row = fake.subs.get(DEVICE)
    expect(row.endpoint).toBe(subscription.endpoint)
    expect(row.expires_at).toBeGreaterThanOrEqual(before + 90 * DAY_S)

    expect((await post('/push/schedule', scheduleBody(1))).statusCode).toBe(200)
  })
})

describe('a dead endpoint (410 Gone) is not registered again', () => {
  const DEAD = 'https://fcm.googleapis.com/fcm/send/abc'
  const deadSubscription = { endpoint: DEAD, keys: { p256dh: 'p', auth: 'a' } }
  const freshSubscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/fresh', keys: { p256dh: 'p3', auth: 'a3' } }

  function dispatch() {
    return handler({
      _async_kind: 'push-dispatch',
      device_id: DEVICE,
      session_id: SID,
      title: 'Parking reminder',
      body: 'Your parking expires soon.',
      stale_at: futureIso(30),
    })
  }

  it('dispatch answered 410 leaves a tombstone: no endpoint or keys, the dead endpoint hashed', async () => {
    registerRow(nowSec() + 30 * DAY_S)
    fake.state.pushStatus = 410
    expect(await dispatch()).toEqual({ ok: false })
    const row = fake.subs.get(DEVICE)
    expect(row.endpoint).toBeUndefined()
    expect(row.p256dh).toBeUndefined()
    expect(row.auth).toBeUndefined()
    expect(row.gone_endpoint_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(row.gone_endpoint_sha256).not.toContain('fcm')
    expect(row.expires_at).toBeGreaterThan(nowSec())
  })

  it('/push/subscribe refuses the same dead endpoint with 409 ERR_ENDPOINT_GONE and keeps the tombstone', async () => {
    registerRow(nowSec() + 30 * DAY_S)
    fake.state.pushStatus = 410
    await dispatch()
    const tombstone = structuredClone(fake.subs.get(DEVICE))

    const res = await post('/push/subscribe', { device_id: DEVICE, subscription: deadSubscription })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body)).toEqual({ error: PUSH_ERR_ENDPOINT_GONE })
    expect(fake.subs.get(DEVICE)).toEqual(tombstone)
    // So booking stays refused: the app can't book onto a dead endpoint.
    expect((await post('/push/schedule', scheduleBody(1))).statusCode).toBe(409)
    expect(schedulerMutations()).toEqual([])
  })

  it('a fresh endpoint replaces the tombstone, and booking and sending work again', async () => {
    registerRow(nowSec() + 30 * DAY_S)
    fake.state.pushStatus = 410
    await dispatch()

    expect((await post('/push/subscribe', { device_id: DEVICE, subscription: freshSubscription })).statusCode).toBe(204)
    expect(fake.subs.get(DEVICE).endpoint).toBe(freshSubscription.endpoint)
    expect(fake.subs.get(DEVICE).gone_endpoint_sha256).toBeUndefined()
    expect((await post('/push/schedule', scheduleBody(1))).statusCode).toBe(200)

    fake.state.pushStatus = 201
    expect(await dispatch()).toEqual({ ok: true })
    expect(fake.pushes.at(-1)).toBe(freshSubscription.endpoint)
  })

  it('dispatch sends nothing to a device that only has a tombstone', async () => {
    registerRow(nowSec() + 30 * DAY_S)
    fake.state.pushStatus = 410
    await dispatch()
    fake.pushes.length = 0
    expect(await dispatch()).toEqual({ ok: false })
    expect(fake.pushes).toEqual([])
  })

  it('a 410 never overwrites a fresh registration stored while the send was in flight', async () => {
    registerRow(nowSec() + 30 * DAY_S)
    fake.state.pushStatus = 410
    // The device re-registers with a new endpoint between the lookup and the 410.
    const send = fake.ddbSend
    let swapped = false
    fake.ddbSend = (cmd) => {
      if (!swapped && cmd.op === 'put' && cmd.input.ConditionExpression) {
        swapped = true
        fake.subs.set(DEVICE, { ...fake.subs.get(DEVICE), endpoint: freshSubscription.endpoint })
      }
      return send(cmd)
    }
    try {
      await dispatch()
    } finally {
      fake.ddbSend = send
    }
    expect(fake.subs.get(DEVICE).endpoint).toBe(freshSubscription.endpoint)
    expect(fake.subs.get(DEVICE).gone_endpoint_sha256).toBeUndefined()
  })

  it('a live row with the same endpoint is re-registered as before (only a tombstone refuses)', async () => {
    registerRow(nowSec() + 30 * DAY_S)
    expect((await post('/push/subscribe', { device_id: DEVICE, subscription: deadSubscription })).statusCode).toBe(204)
  })
})
