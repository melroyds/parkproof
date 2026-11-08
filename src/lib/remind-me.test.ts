// @vitest-environment happy-dom
//
// The one "Remind me" action (field-test fix list, item 2). One tap must:
// ask for permission first and synchronously (iOS only prompts inside the
// tap), arm the in-tab reminders before any network work (a weak signal
// must not leave the driver with nothing), subscribe and register, book the
// push ones, and report exactly what got booked. "Not registered" or "no
// answer in time" is never a quiet success: the result says the reminder
// only works while ParkProof is open, and why.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleResult } from './notifications'
import type { PushScheduleResult, SubscribeResult } from './push'
import { remindMe, summariseRemindMe, type RemindMeResult } from './remind-me'

const mocks = vi.hoisted(() => ({
  subscribeToPush: vi.fn(),
  schedulePushReminders: vi.fn(),
}))
vi.mock('./push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./push')>()),
  subscribeToPush: mocks.subscribeToPush,
  schedulePushReminders: mocks.schedulePushReminders,
}))

const FIRE = '2099-01-01T00:30:00.000Z'
const REMINDERS = [{ fire_at: FIRE, title: 'Swan St', body: 'Your parking expires at 1:00 am.' }]
const ARMED: ScheduleResult = {
  status: 'scheduled',
  scheduledCount: 1,
  pastCount: 0,
  totalSelected: 1,
  firesAt: [new Date(FIRE)],
}

let order: string[]
let requestPermission: ReturnType<typeof vi.fn>
let armInTab: ReturnType<typeof vi.fn<() => Promise<ScheduleResult>>>

function stubNotification(permission: NotificationPermission, answer: NotificationPermission = permission) {
  requestPermission = vi.fn(async () => {
    order.push('permission')
    return answer
  })
  vi.stubGlobal('Notification', { permission, requestPermission })
}

function subscribeResult(r: SubscribeResult) {
  mocks.subscribeToPush.mockImplementation(async () => {
    order.push('subscribe')
    return r
  })
}
function scheduleResult(r: PushScheduleResult) {
  mocks.schedulePushReminders.mockImplementation(async () => {
    order.push('schedule')
    return r
  })
}

const run = () =>
  remindMe({ sessionId: 'rec-1', pushReminders: REMINDERS, expiresAt: '2099-01-01T01:00:00.000Z', armInTab })

beforeEach(() => {
  order = []
  mocks.subscribeToPush.mockReset()
  mocks.schedulePushReminders.mockReset()
  armInTab = vi.fn<() => Promise<ScheduleResult>>(async () => {
    order.push('inTab')
    return ARMED
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('remindMe()', () => {
  it('asks for permission synchronously, inside the tap, before anything else', async () => {
    stubNotification('default', 'granted')
    subscribeResult({ ok: true })
    scheduleResult({ ok: true, created: [{ name: 'n', fire_at: FIRE }], skipped: 0 })

    const pending = run()
    // Nothing has been awaited yet: the prompt must already be on its way.
    expect(requestPermission).toHaveBeenCalledTimes(1)
    await pending
    // In-tab first: it needs no connection, so a weak signal can't hold it up.
    expect(order).toEqual(['permission', 'inTab', 'subscribe', 'schedule'])
  })

  it('arms the in-tab reminders before any push network work, even when push never answers', async () => {
    stubNotification('granted')
    mocks.subscribeToPush.mockImplementation(() => new Promise(() => {}))

    void run()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(armInTab).toHaveBeenCalledTimes(1)
    expect(mocks.subscribeToPush).toHaveBeenCalledTimes(1)
    expect(mocks.schedulePushReminders).not.toHaveBeenCalled()
  })

  it('push timed out: in-tab only, "try again" as the step, no booking and no second arming', async () => {
    stubNotification('granted')
    subscribeResult({ ok: false, reason: 'timeout' })

    const result = await run()

    expect(result).toEqual({ background: { ok: false, reason: 'failed' }, inTab: ARMED })
    expect(armInTab).toHaveBeenCalledTimes(1)
    expect(mocks.schedulePushReminders).not.toHaveBeenCalled()
    expect(summariseRemindMe(result)).toEqual({ kind: 'openOnly', times: [new Date(FIRE)], step: 'failed' })
  })

  it('the booking timed out after a good registration: in-tab only, "try again"', async () => {
    stubNotification('granted')
    subscribeResult({ ok: true })
    // schedulePushReminders reports a timed-out request as network.
    scheduleResult({ ok: false, reason: 'network' })

    const result = await run()

    expect(armInTab).toHaveBeenCalledTimes(1)
    expect(summariseRemindMe(result)).toEqual({ kind: 'openOnly', times: [new Date(FIRE)], step: 'failed' })
  })

  it('a push step that throws anyway still reports the in-tab reminders it armed', async () => {
    stubNotification('granted')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.subscribeToPush.mockRejectedValue(new Error('boom'))

    const result = await run()

    expect(result).toEqual({ background: { ok: false, reason: 'failed' }, inTab: ARMED })
    expect(summariseRemindMe(result).kind).toBe('openOnly')
  })

  it('books push and in-tab, and passes the full reminder set and expiry through', async () => {
    stubNotification('granted')
    subscribeResult({ ok: true })
    scheduleResult({ ok: true, created: [{ name: 'n', fire_at: FIRE }], skipped: 0 })

    const result = await run()

    expect(requestPermission).not.toHaveBeenCalled()
    expect(result.background).toEqual({ ok: true, created: [{ name: 'n', fire_at: FIRE }] })
    expect(result.inTab).toBe(ARMED)
    expect(mocks.schedulePushReminders).toHaveBeenCalledWith('rec-1', REMINDERS, '2099-01-01T01:00:00.000Z')
  })

  it('server still refuses the registration: background fails (not a quiet skip), in-tab still armed', async () => {
    stubNotification('granted')
    subscribeResult({ ok: true })
    scheduleResult({ ok: false, reason: 'not_subscribed' })

    const result = await run()

    expect(result.background).toEqual({ ok: false, reason: 'failed' })
    expect(armInTab).toHaveBeenCalledTimes(1)
    expect(summariseRemindMe(result)).toEqual({ kind: 'openOnly', times: [new Date(FIRE)], step: 'failed' })
  })

  it('a registration the server did not store still goes on to book (the booking re-sends it)', async () => {
    stubNotification('granted')
    subscribeResult({ ok: false, reason: 'network' })
    scheduleResult({ ok: true, created: [{ name: 'n', fire_at: FIRE }], skipped: 0 })

    const result = await run()

    expect(mocks.schedulePushReminders).toHaveBeenCalledTimes(1)
    expect(result.background.ok).toBe(true)
  })

  it('blocked or dismissed: says so, books nothing and never prompts twice', async () => {
    for (const answer of ['denied', 'default'] as const) {
      order = []
      stubNotification('default', answer)
      const result = await run()
      expect(result.background).toEqual({ ok: false, reason: 'denied' })
      expect(result.inTab.status).toBe('denied')
      expect(requestPermission).toHaveBeenCalledTimes(1)
      expect(armInTab).not.toHaveBeenCalled()
      expect(mocks.subscribeToPush).not.toHaveBeenCalled()
      expect(mocks.schedulePushReminders).not.toHaveBeenCalled()
      expect(summariseRemindMe(result)).toEqual({ kind: 'none', times: [], step: 'denied' })
    }
  })

  it('an iPhone browser tab (no Notification API): points to the Home Screen', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    })
    const noNotifications: ScheduleResult = { ...ARMED, status: 'unsupported', scheduledCount: 0, firesAt: [] }
    armInTab.mockResolvedValue(noNotifications)

    const result = await run()

    expect(result.background).toEqual({ ok: false, reason: 'ios_install' })
    expect(summariseRemindMe(result)).toEqual({ kind: 'none', times: [], step: 'ios_install' })
    expect(mocks.subscribeToPush).not.toHaveBeenCalled()
  })

  it('no web push in this browser: in-tab only, with the unsupported step', async () => {
    stubNotification('granted')
    subscribeResult({ ok: false, reason: 'unsupported' })

    const result = await run()

    expect(mocks.schedulePushReminders).not.toHaveBeenCalled()
    expect(summariseRemindMe(result)).toEqual({ kind: 'openOnly', times: [new Date(FIRE)], step: 'unsupported' })
  })

  it("another device owns the record's reminders: not_owner", async () => {
    stubNotification('granted')
    subscribeResult({ ok: true })
    scheduleResult({ ok: false, reason: 'not_owner' })
    expect((await run()).background).toEqual({ ok: false, reason: 'not_owner' })
  })
})

describe('summariseRemindMe()', () => {
  const none: ScheduleResult = { status: 'all-past', scheduledCount: 0, pastCount: 1, totalSelected: 1, firesAt: [] }

  it('lists the server-booked times, earliest first', () => {
    const result: RemindMeResult = {
      background: {
        ok: true,
        created: [
          { name: 'b', fire_at: '2099-01-01T00:45:00.000Z' },
          { name: 'a', fire_at: '2099-01-01T00:30:00.000Z' },
        ],
      },
      inTab: ARMED,
    }
    expect(summariseRemindMe(result)).toEqual({
      kind: 'background',
      times: [new Date('2099-01-01T00:30:00.000Z'), new Date('2099-01-01T00:45:00.000Z')],
      step: null,
    })
  })

  it('says the times have passed when nothing could be booked anywhere', () => {
    expect(summariseRemindMe({ background: { ok: true, created: [] }, inTab: none })).toEqual({
      kind: 'none',
      times: [],
      step: 'allPast',
    })
    expect(summariseRemindMe({ background: { ok: false, reason: 'failed' }, inTab: none }).step).toBe('allPast')
  })
})
