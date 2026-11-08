// @vitest-environment node
// Weekly reminders by push (T5b): POST /push/recurring (replace-all for one
// rule), POST /push/recurring/cancel, ownership (spec N6), schedule names,
// rate limits, and the push-recurring dispatcher's decisions.
//
// EventBridge Scheduler, DynamoDB and web-push are replaced with in-memory
// fakes (the same shape as push-ownership.test.js): GetSchedule and
// DeleteSchedule throw ResourceNotFoundException for a missing name,
// CreateSchedule throws ConflictException for an existing one.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => {
  // Module-level env is read when index.js loads, so set it before import.
  process.env.PUSH_SCHEDULER_ROLE_ARN = 'arn:aws:iam::123456789012:role/test-scheduler'
  process.env.PUSH_DISPATCH_LAMBDA_ARN = 'arn:aws:lambda:ap-southeast-2:123456789012:function:test'
  const store = new Map()
  const calls = []
  const ddbCalls = []
  const subscriptions = new Map()
  const sent = []
  const error = (name) => Object.assign(new Error(name), { name })
  const state = { getFailure: null, rateCount: null, createFailure: null, deleteFailure: null }
  function send(cmd) {
    calls.push({ op: cmd.op, name: cmd.input.Name })
    if (cmd.op === 'get') {
      if (state.getFailure) return Promise.reject(error(state.getFailure))
      if (!store.has(cmd.input.Name)) return Promise.reject(error('ResourceNotFoundException'))
      return Promise.resolve(structuredClone(store.get(cmd.input.Name)))
    }
    if (cmd.op === 'delete') {
      if (state.deleteFailure && store.has(cmd.input.Name)) return Promise.reject(error(state.deleteFailure))
      if (!store.delete(cmd.input.Name)) return Promise.reject(error('ResourceNotFoundException'))
      return Promise.resolve({})
    }
    if (cmd.op === 'create') {
      if (state.createFailure) return Promise.reject(error(state.createFailure))
      if (store.has(cmd.input.Name)) return Promise.reject(error('ConflictException'))
      store.set(cmd.input.Name, structuredClone(cmd.input))
      return Promise.resolve({ ScheduleArn: `arn:test:${cmd.input.Name}` })
    }
    return Promise.reject(new Error(`unexpected op ${cmd.op}`))
  }
  const counters = new Map()
  function ddbSend(cmd) {
    ddbCalls.push({ op: cmd.op, input: cmd.input })
    if (cmd.op === 'update') {
      // The per-IP rate limit counter (checkRateLimit).
      const key = cmd.input.Key.job_id
      const count = state.rateCount ?? (counters.get(key) ?? 0) + 1
      counters.set(key, count)
      return Promise.resolve({ Attributes: { count } })
    }
    if (cmd.op === 'get') {
      return Promise.resolve({ Item: subscriptions.get(cmd.input.Key.device_id) })
    }
    return Promise.resolve({})
  }
  return { store, calls, ddbCalls, subscriptions, sent, state, counters, send, ddbSend }
})

vi.mock('@aws-sdk/client-scheduler', () => {
  // Real classes, not arrow-function factories: the code does `new X(...)`.
  const command = (op) =>
    class {
      constructor(input) {
        this.op = op
        this.input = input
      }
    }
  class SchedulerClient {
    send(cmd) {
      return fake.send(cmd)
    }
  }
  return {
    SchedulerClient,
    GetScheduleCommand: command('get'),
    DeleteScheduleCommand: command('delete'),
    CreateScheduleCommand: command('create'),
  }
})
vi.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: class {} }))
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
    QueryCommand: command('query'),
    BatchWriteCommand: command('batchWrite'),
  }
})
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: (subscription, payload, options) => {
      fake.sent.push({ subscription, payload: JSON.parse(payload), options })
      return Promise.resolve({ statusCode: 201 })
    },
  },
}))

import { handler, handleRecurringPushDispatch, isSafeSessionId, scheduleOwnerDeviceId } from './index.js'
import {
  RECURRING_PUSH_NAME_PREFIX,
  SCHEDULE_NAME_MAX,
  recurringCronPlans,
  recurringReminderTag,
  recurringScheduleName,
  recurringScheduleNames,
} from './recurring-schedule.js'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const RULE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SLOT0 = `parkproof-push-r-${RULE}-0`
const SLOT1 = `parkproof-push-r-${RULE}-1`

function post(path, body, ip = '203.0.113.7') {
  return handler({
    requestContext: { http: { method: 'POST', path, sourceIp: ip } },
    body: JSON.stringify(body),
  })
}

function rule(overrides = {}) {
  return {
    id: RULE,
    days: ['TU'],
    start: '07:00',
    frequency: 'weekly',
    nth: [],
    anchor_date: '2026-01-01',
    timezone: 'Australia/Melbourne',
    remind_evening_before: '20:00',
    remind_minutes_before: 60,
    ...overrides,
  }
}

function copyFor(r, text = 'Street sweeping on {day}, 7 to 9 am.') {
  const byDay = Object.fromEntries(r.days.map((d) => [d, text.replace('{day}', d)]))
  return {
    title: '12 King St',
    url: '/app/?recurring=open',
    evening: r.remind_evening_before ? byDay : null,
    before: r.remind_minutes_before !== null ? byDay : null,
  }
}

function booking(device_id, overrides = {}) {
  const r = rule(overrides)
  return { device_id, rule: r, copy: copyFor(r) }
}

function seed(name, input) {
  fake.store.set(name, { Name: name, Target: { Input: typeof input === 'string' ? input : JSON.stringify(input) } })
}

const snapshot = () => JSON.stringify([...fake.store.entries()].sort())
const mutatingCalls = () => fake.calls.filter((c) => c.op !== 'get')
const inputOf = (name) => JSON.parse(fake.store.get(name).Target.Input)

beforeEach(() => {
  fake.store.clear()
  fake.calls.length = 0
  fake.ddbCalls.length = 0
  fake.subscriptions.clear()
  fake.sent.length = 0
  fake.counters.clear()
  fake.state.getFailure = null
  fake.state.rateCount = null
  fake.state.createFailure = null
  fake.state.deleteFailure = null
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('schedule names', () => {
  it('are parkproof-push-r-<uuid>-<slot>, inside the IAM prefix and under 64 characters', () => {
    expect(recurringScheduleNames(RULE)).toEqual([SLOT0, SLOT1])
    for (const name of recurringScheduleNames(RULE)) {
      // setup-push-scheduler.sh scopes the Lambda to schedule/default/parkproof-push-*
      expect(name.startsWith('parkproof-push-')).toBe(true)
      expect(name.startsWith(RECURRING_PUSH_NAME_PREFIX)).toBe(true)
      expect(name.length).toBeLessThanOrEqual(SCHEDULE_NAME_MAX)
      // EventBridge Scheduler name characters.
      expect(name).toMatch(/^[0-9a-zA-Z._-]+$/)
    }
    // A 36-character uuid with the highest slot is 55 characters.
    expect(recurringScheduleName(RULE, 1)).toHaveLength(55)
    expect(SCHEDULE_NAME_MAX).toBe(64)
  })

  it('accepts only a 36-character lowercase uuid as the rule id, so a name can never run long', async () => {
    for (const id of [`${RULE}0`, RULE.toUpperCase(), 'not-a-uuid', `${RULE}-${'x'.repeat(30)}`, '']) {
      const res = await post('/push/recurring', { ...booking(OWNER), rule: { ...rule(), id } })
      expect(res.statusCode).toBe(400)
      const cancel = await post('/push/recurring/cancel', { device_id: OWNER, rule_id: id })
      expect(cancel.statusCode).toBe(400)
    }
    expect(fake.calls).toEqual([])
  })

  it("keeps a record's schedules out of the weekly reminders' names", async () => {
    expect(isSafeSessionId(`r-${RULE}`)).toBe(false)
    expect(isSafeSessionId('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true)
    const res = await post('/push/schedule', {
      device_id: OWNER,
      session_id: `r-${RULE}`,
      reminders: [{ fire_at: new Date(Date.now() + 3600_000).toISOString(), body: 'x' }],
    })
    expect(res.statusCode).toBe(400)
    expect(fake.calls).toEqual([])
  })
})

describe('cron plans', () => {
  it('fires the evening reminder the day before and the other one before the start, in wall-clock time', () => {
    const plans = recurringCronPlans(rule({ days: ['MO', 'TH'] }))
    expect(plans.map((p) => [p.slot, p.reminder, p.expression, p.lead_minutes])).toEqual([
      [0, 'evening', 'cron(0 20 ? * WED,SUN *)', 11 * 60],
      [1, 'before', 'cron(0 6 ? * MON,THU *)', 60],
    ])
  })

  it('moves a before-reminder that goes past midnight to the day before', () => {
    const [plan] = recurringCronPlans(rule({ days: ['MO'], start: '00:30', remind_evening_before: null, remind_minutes_before: 60 }))
    expect(plan).toMatchObject({ reminder: 'before', expression: 'cron(30 23 ? * SUN *)', fire_time: '23:30', lead_minutes: 60 })
  })

  it('books only the reminders the rule has', () => {
    expect(recurringCronPlans(rule({ remind_evening_before: null })).map((p) => p.slot)).toEqual([1])
    expect(recurringCronPlans(rule({ remind_minutes_before: null })).map((p) => p.slot)).toEqual([0])
  })
})

describe('POST /push/recurring', () => {
  it("books cron schedules in the rule's own zone, owned by the caller", async () => {
    const before = Date.now()
    const res = await post('/push/recurring', booking(OWNER))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.skipped).toEqual([])
    expect(body.created.map((c) => [c.name, c.reminder, c.expression])).toEqual([
      [SLOT0, 'evening', 'cron(0 20 ? * MON *)'],
      [SLOT1, 'before', 'cron(0 6 ? * TUE *)'],
    ])
    for (const name of [SLOT0, SLOT1]) {
      const s = fake.store.get(name)
      expect(s.ScheduleExpressionTimezone).toBe('Australia/Melbourne')
      expect(s.FlexibleTimeWindow).toEqual({ Mode: 'OFF' })
      expect(s.ActionAfterCompletion).toBe('DELETE')
      // The schedules end by themselves after 90 days; the app books again when opened.
      const days = (new Date(s.EndDate).getTime() - before) / 86_400_000
      expect(days).toBeGreaterThan(89.9)
      expect(days).toBeLessThan(90.1)
      expect(s.Target.Arn).toBe(process.env.PUSH_DISPATCH_LAMBDA_ARN)
      expect(scheduleOwnerDeviceId(s)).toBe(OWNER)
    }
    const input = inputOf(SLOT0)
    expect(input).toMatchObject({
      _async_kind: 'push-recurring',
      device_id: OWNER,
      rule_id: RULE,
      reminder: 'evening',
      lead_minutes: 11 * 60,
      scheduled_time: '<aws.scheduler.scheduled-time>',
      rule: { days: ['TU'], start: '07:00', frequency: 'weekly', timezone: 'Australia/Melbourne' },
      title: '12 King St',
      url: '/app/?recurring=open',
      bodies: { TU: 'Street sweeping on TU, 7 to 9 am.' },
    })
  })

  it('reads both slots before it deletes or creates anything', async () => {
    await post('/push/recurring', booking(OWNER))
    const firstMutation = fake.calls.findIndex((c) => c.op !== 'get')
    const gets = fake.calls.slice(0, firstMutation)
    expect(gets.map((c) => c.name).sort()).toEqual([SLOT0, SLOT1])
  })

  it('replaces the whole set for the rule (an edit that drops the evening reminder)', async () => {
    await post('/push/recurring', booking(OWNER))
    expect(fake.store.size).toBe(2)
    const res = await post('/push/recurring', booking(OWNER, { start: '08:00', remind_evening_before: null }))
    expect(res.statusCode).toBe(200)
    expect([...fake.store.keys()]).toEqual([SLOT1])
    expect(fake.store.get(SLOT1).ScheduleExpression).toBe('cron(0 7 ? * TUE *)')
  })

  it('refuses another device with 403 ERR_NOT_OWNER and changes nothing', async () => {
    await post('/push/recurring', booking(OWNER))
    const before = snapshot()
    fake.calls.length = 0
    const res = await post('/push/recurring', booking(OTHER, { start: '05:00' }))
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body)).toEqual({ error: 'ERR_NOT_OWNER' })
    expect(snapshot()).toBe(before)
    expect(mutatingCalls()).toEqual([])
  })

  it('refuses when even one slot belongs to someone else, or cannot be attributed', async () => {
    seed(SLOT0, { device_id: OWNER })
    seed(SLOT1, { device_id: OTHER })
    expect((await post('/push/recurring', booking(OWNER))).statusCode).toBe(403)
    fake.store.clear()
    seed(SLOT1, '{garbled')
    expect((await post('/push/recurring', booking(OWNER))).statusCode).toBe(403)
    expect(mutatingCalls()).toEqual([])
  })

  it('changes nothing when a slot cannot be read', async () => {
    seed(SLOT0, { device_id: OWNER })
    const before = snapshot()
    fake.state.getFailure = 'ThrottlingException'
    const res = await post('/push/recurring', booking(OWNER))
    expect(res.statusCode).toBe(500)
    expect(snapshot()).toBe(before)
    expect(mutatingCalls()).toEqual([])
  })

  it('reports an old schedule it could not delete, so the phone books again', async () => {
    await post('/push/recurring', booking(OWNER))
    fake.state.deleteFailure = 'ThrottlingException'
    // The edit drops the evening reminder: its old schedule would keep firing.
    const res = await post('/push/recurring', booking(OWNER, { remind_evening_before: null }))
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.skipped).toEqual(
      expect.arrayContaining([{ reason: 'delete error', name: SLOT0 }, { reason: 'delete error', name: SLOT1 }]),
    )
    expect(fake.store.has(SLOT0)).toBe(true)
  })

  it('reports a schedule it could not create as skipped', async () => {
    fake.state.createFailure = 'ValidationException'
    const res = await post('/push/recurring', booking(OWNER))
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ created: [], skipped: [{ reminder: 'evening' }, { reminder: 'before' }] })
  })

  it('rejects a bad body with 400 before touching the scheduler', async () => {
    const r = rule()
    const bad = [
      { ...booking(OWNER), device_id: undefined },
      { ...booking(OWNER), device_id: 'not a uuid!' },
      { ...booking(OWNER), rule: { ...r, timezone: 'Mars/Olympus' } },
      { ...booking(OWNER), rule: { ...r, days: [] } },
      { ...booking(OWNER), rule: { ...r, days: ['XX'] } },
      { ...booking(OWNER), rule: { ...r, start: '7am' } },
      { ...booking(OWNER), rule: { ...r, frequency: 'monthly_nth', nth: [] } },
      { ...booking(OWNER), rule: { ...r, anchor_date: '2026-02-30' } },
      { ...booking(OWNER), rule: { ...r, remind_minutes_before: 0 } },
      // No reminders at all: that's a cancel.
      { ...booking(OWNER), rule: { ...r, remind_evening_before: null, remind_minutes_before: null } },
      // The words for a rule day are missing.
      { ...booking(OWNER), copy: { ...copyFor(r), evening: {} } },
      { ...booking(OWNER), copy: undefined },
    ]
    for (const body of bad) {
      const res = await post('/push/recurring', body)
      expect(res.statusCode).toBe(400)
    }
    expect(fake.calls).toEqual([])
  })

  it('books with the canonical spelling of the zone name', async () => {
    const res = await post('/push/recurring', booking(OWNER, { timezone: 'australia/brisbane' }))
    expect(res.statusCode).toBe(200)
    expect(fake.store.get(SLOT0).ScheduleExpressionTimezone).toBe('Australia/Brisbane')
    expect(inputOf(SLOT0).rule.timezone).toBe('Australia/Brisbane')
  })

  it('keeps notification links inside the app', async () => {
    const r = rule()
    await post('/push/recurring', { device_id: OWNER, rule: r, copy: { ...copyFor(r), url: 'https://evil.example/' } })
    expect(inputOf(SLOT0).url).toBe('/app/')
  })

  it('is rate limited per IP (429, nothing booked)', async () => {
    fake.state.rateCount = 31
    const res = await post('/push/recurring', booking(OWNER))
    expect(res.statusCode).toBe(429)
    expect(JSON.parse(res.body)).toEqual({ error: 'RATE_LIMITED' })
    expect(fake.calls).toEqual([])
    const limiter = fake.ddbCalls.find((c) => c.op === 'update')
    expect(limiter.input.Key.job_id).toMatch(/^RL#pushrecurring#203\.0\.113\.7#\d+$/)
  })

  it('allows up to 30 requests a minute from one IP', async () => {
    fake.state.rateCount = 30
    expect((await post('/push/recurring', booking(OWNER))).statusCode).toBe(200)
  })
})

describe('POST /push/recurring/cancel', () => {
  it("lets the owner delete the rule's schedules", async () => {
    await post('/push/recurring', booking(OWNER))
    const res = await post('/push/recurring/cancel', { device_id: OWNER, rule_id: RULE })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ deleted: 2 })
    expect(fake.store.size).toBe(0)
  })

  it('does not report success when a schedule could not be deleted, so the phone cancels again', async () => {
    await post('/push/recurring', booking(OWNER))
    fake.state.deleteFailure = 'InternalServerException'
    const res = await post('/push/recurring/cancel', { device_id: OWNER, rule_id: RULE })
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body)).toEqual({ error: 'ERR_SCHEDULER', deleted: 0, failed: 2 })
    expect(fake.store.size).toBe(2)
    fake.state.deleteFailure = null
    const again = await post('/push/recurring/cancel', { device_id: OWNER, rule_id: RULE })
    expect(again.statusCode).toBe(200)
    expect(JSON.parse(again.body)).toEqual({ deleted: 2 })
  })

  it('returns deleted 0 when nothing is booked', async () => {
    const res = await post('/push/recurring/cancel', { device_id: OWNER, rule_id: RULE })
    expect(JSON.parse(res.body)).toEqual({ deleted: 0 })
    expect(mutatingCalls()).toEqual([])
  })

  it('refuses another device with 403 ERR_NOT_OWNER and deletes nothing', async () => {
    await post('/push/recurring', booking(OWNER))
    const before = snapshot()
    fake.calls.length = 0
    const res = await post('/push/recurring/cancel', { device_id: OTHER, rule_id: RULE })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body)).toEqual({ error: 'ERR_NOT_OWNER' })
    expect(snapshot()).toBe(before)
    expect(mutatingCalls()).toEqual([])
  })

  it('requires device_id before touching the scheduler', async () => {
    seed(SLOT0, { device_id: OWNER })
    const res = await post('/push/recurring/cancel', { rule_id: RULE })
    expect(res.statusCode).toBe(400)
    expect(fake.calls).toEqual([])
  })

  it('is rate limited under its own key', async () => {
    fake.state.rateCount = 31
    const res = await post('/push/recurring/cancel', { device_id: OWNER, rule_id: RULE })
    expect(res.statusCode).toBe(429)
    expect(fake.ddbCalls[0].input.Key.job_id).toMatch(/^RL#pushrecurringcancel#/)
    expect(fake.calls).toEqual([])
  })

  it("is not mistaken for a record's /push/cancel", async () => {
    seed(SLOT0, { device_id: OWNER })
    // /push/cancel would have answered 400 (no session_id) without deleting.
    const res = await post('/push/recurring/cancel', { device_id: OWNER, rule_id: RULE })
    expect(JSON.parse(res.body)).toEqual({ deleted: 1 })
  })
})

// ── The dispatcher ──────────────────────────────────────────────────────

const SUB = { device_id: OWNER, endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' }

/** Book through the route, then fire one slot at `fireIso` as EventBridge would. */
async function bookAndFire(overrides, slot, fireIso, nowIso = fireIso) {
  const r = rule(overrides)
  const res = await post('/push/recurring', { device_id: OWNER, rule: r, copy: copyFor(r) })
  expect(res.statusCode).toBe(200)
  const input = fake.store.get(recurringScheduleName(RULE, slot)).Target.Input
  // EventBridge Scheduler fills its context attribute at each run.
  const event = JSON.parse(input.replace('<aws.scheduler.scheduled-time>', fireIso))
  fake.sent.length = 0
  return handler.call(null, { ...event }).then((out) => ({ out, nowIso }))
}

describe('push-recurring dispatch', () => {
  beforeEach(() => {
    fake.subscriptions.set(OWNER, SUB)
  })

  it('sends a weekly reminder with the same tag as the in-tab copy, high urgency and a TTL to the start', async () => {
    // Evening before Tuesday 10 Nov 2026 (Melbourne, AEDT): Monday 8 pm = 09:00Z.
    vi.useFakeTimers({ now: Date.parse('2026-11-09T09:00:05Z') })
    try {
      await bookAndFire({}, 0, '2026-11-09T09:00:00Z')
    } finally {
      vi.useRealTimers()
    }
    expect(fake.sent).toHaveLength(1)
    const [{ payload, options }] = fake.sent
    expect(payload).toMatchObject({
      title: '12 King St',
      body: 'Street sweeping on TU, 7 to 9 am.',
      url: '/app/?recurring=open',
      tag: recurringReminderTag(RULE, Date.parse('2026-11-09T09:00:00Z')),
      session_id: `r-${RULE}`,
      kind: 'recurring',
    })
    expect(options.urgency).toBe('high')
    // Stale at the 7 am start (20:00Z): 11 hours away, capped at 6.
    expect(options.TTL).toBe(6 * 3600)
  })

  it('fortnightly: sends in an on week and stays silent in the week between', async () => {
    const fortnightly = { frequency: 'fortnightly', anchor_date: '2026-11-10' }
    vi.useFakeTimers({ now: Date.parse('2026-11-09T19:00:05Z') })
    try {
      // Before-reminder for Tue 10 Nov (on week): 6 am AEDT = 19:00Z on the 9th.
      await bookAndFire(fortnightly, 1, '2026-11-09T19:00:00Z')
      expect(fake.sent).toHaveLength(1)
      // Tue 17 Nov is an off week: the schedule fires, nothing is sent and the
      // subscription is not even looked up.
      vi.setSystemTime(Date.parse('2026-11-16T19:00:05Z'))
      fake.ddbCalls.length = 0
      const { out } = await bookAndFire(fortnightly, 1, '2026-11-16T19:00:00Z')
      expect(out).toEqual({ ok: false, skipped: 'no_occurrence' })
      expect(fake.sent).toHaveLength(0)
      expect(fake.ddbCalls.filter((c) => c.op === 'get')).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('monthly_nth: decides from the occurrence date, not the fire date', async () => {
    const firstTuesday = { frequency: 'monthly_nth', nth: [1] }
    vi.useFakeTimers({ now: Date.parse('2026-11-30T09:00:05Z') })
    try {
      // Tue 1 Dec 2026 is the first Tuesday. Its evening reminder fires on
      // Mon 30 Nov, the fifth Monday of November: still sent.
      await bookAndFire(firstTuesday, 0, '2026-11-30T09:00:00Z')
      expect(fake.sent).toHaveLength(1)
      expect(fake.sent[0].payload.body).toBe('Street sweeping on TU, 7 to 9 am.')
      // Mon 7 Dec is in the first week, but its evening reminder is for
      // Tue 8 Dec, the second Tuesday: not sent.
      vi.setSystemTime(Date.parse('2026-12-07T09:00:05Z'))
      const { out } = await bookAndFire(firstTuesday, 0, '2026-12-07T09:00:00Z')
      expect(out).toEqual({ ok: false, skipped: 'no_occurrence' })
      expect(fake.sent).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('monthly_nth: reads the date in the rule zone, not UTC', async () => {
    // First Monday of February 2027 is the 1st. 6:30 am AEDT on Mon 1 Feb
    // is 19:30Z on Sun 31 Jan: the UTC date is in January.
    const rule1 = { days: ['MO'], start: '07:00', frequency: 'monthly_nth', nth: [1], remind_evening_before: null, remind_minutes_before: 30 }
    vi.useFakeTimers({ now: Date.parse('2027-01-31T19:30:05Z') })
    try {
      await bookAndFire(rule1, 1, '2027-01-31T19:30:00Z')
      expect(fake.sent).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a firing that arrives too late to be useful', async () => {
    // Before-reminder for Tue 10 Nov, delivered at 7:20 am (start + 20 min).
    vi.useFakeTimers({ now: Date.parse('2026-11-09T20:20:00Z') })
    try {
      const { out } = await bookAndFire({}, 1, '2026-11-09T19:00:00Z')
      expect(out).toEqual({ ok: false, skipped: 'stale' })
      expect(fake.sent).toHaveLength(0)
      // The evening reminder is stale from the start itself.
      vi.setSystemTime(Date.parse('2026-11-09T20:00:00Z'))
      const late = await bookAndFire({}, 0, '2026-11-09T09:00:00Z')
      expect(late.out).toEqual({ ok: false, skipped: 'stale' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a before-reminder delivered a few minutes late carries a short TTL', async () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-09T20:05:00Z') })
    try {
      await bookAndFire({}, 1, '2026-11-09T19:00:00Z')
    } finally {
      vi.useRealTimers()
    }
    expect(fake.sent).toHaveLength(1)
    // Stale at 7:15 am local (20:15Z): 10 minutes left.
    expect(fake.sent[0].options.TTL).toBe(600)
  })

  it('falls back to the current minute when the scheduled time is missing or was never filled in', async () => {
    const r = rule()
    await post('/push/recurring', { device_id: OWNER, rule: r, copy: copyFor(r) })
    const stored = JSON.parse(fake.store.get(SLOT0).Target.Input)
    const now = Date.parse('2026-11-09T09:00:30Z')
    vi.useFakeTimers({ now })
    try {
      for (const scheduled_time of [undefined, '<aws.scheduler.scheduled-time>']) {
        fake.sent.length = 0
        const out = await handleRecurringPushDispatch({ ...stored, scheduled_time }, now)
        expect(out).toEqual({ ok: true })
        expect(fake.sent[0].payload.tag).toBe(recurringReminderTag(RULE, Date.parse('2026-11-09T09:00:00Z')))
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends nothing when the device has no subscription', async () => {
    fake.subscriptions.clear()
    vi.useFakeTimers({ now: Date.parse('2026-11-09T09:00:05Z') })
    try {
      const { out } = await bookAndFire({}, 0, '2026-11-09T09:00:00Z')
      expect(out).toEqual({ ok: false })
    } finally {
      vi.useRealTimers()
    }
    expect(fake.sent).toHaveLength(0)
  })

  it('sends nothing for a malformed event', async () => {
    const out = await handleRecurringPushDispatch({ _async_kind: 'push-recurring', device_id: OWNER }, Date.now())
    expect(out).toEqual({ ok: false, skipped: 'bad_input' })
    expect(fake.sent).toHaveLength(0)
  })
})
