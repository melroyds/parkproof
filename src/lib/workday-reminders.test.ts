// @vitest-environment happy-dom
//
// A workday stop's reminders (build spec T6b item 9): set automatically
// when the stop is saved, with no reminder screen, through the same code as
// "Remind me" (remindMe: in-tab and push, at most 6 per record), with
// T6a's schedule and copy. Saving isn't a tap, so it never asks for
// notification permission.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from './i18n'
import type { ParkingSession, RuleFlags } from '../types'
import type { RemindMeArgs, RemindMeResult } from './remind-me'

const mocks = vi.hoisted(() => ({
  remindMe: vi.fn<(args: RemindMeArgs) => Promise<RemindMeResult>>(),
  scheduleAbsolute: vi.fn(),
  cancelInTab: vi.fn(),
  mirror: vi.fn(),
  turnedOff: { value: false },
}))
vi.mock('./remind-me', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./remind-me')>()),
  remindMe: mocks.remindMe,
}))
vi.mock('./notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./notifications')>()),
  scheduleAbsoluteReminders: mocks.scheduleAbsolute,
  cancelInTabReminders: mocks.cancelInTab,
}))
vi.mock('./push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./push')>()),
  isPushTurnedOff: () => mocks.turnedOff.value,
}))
vi.mock('./sync', () => ({ mirrorSessionUpdateToCloud: mocks.mirror }))

import { getSession, saveSession } from './storage'
import { MAX_PUSH_REMINDERS } from './permit-answer'
import { bookWorkdayLegReminders, rearmWorkdayLegInTab, resetWorkdayRemindersForTests, workdayLegPlan } from './workday-reminders'

const NOW = Date.parse('2026-11-09T00:00:00.000Z') // 11:00 am in Melbourne
const MIN = 60_000
const t = i18n.t.bind(i18n)

const FLAGS = (is_area_sign: boolean): RuleFlags => ({
  requires_ticket: false,
  payment_methods: null,
  requires_disabled_permit: false,
  is_permit_zone: false,
  permit_area: null,
  is_area_sign,
})

function stop(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'stop-1',
    arrived_at: new Date(NOW).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P 8am-6pm',
    observations: [],
    expires_at: new Date(NOW + 120 * MIN).toISOString(), // 1:00 pm
    confidence: 'high',
    rule_flags: FLAGS(false),
    workday_id: '0f0e0d0c-1111-4111-8111-111111111111',
    leg_index: 1,
    ...overrides,
  }
}

function setPermission(permission: NotificationPermission | null) {
  if (permission === null) {
    // @ts-expect-error removing the API to model a browser without it
    delete window.Notification
    return
  }
  Object.defineProperty(window, 'Notification', {
    value: Object.assign(function Notification() {}, { permission, requestPermission: vi.fn(async () => permission) }),
    configurable: true,
    writable: true,
  })
}

const booked = (fires: string[]): RemindMeResult => ({
  background: { ok: true, created: fires.map((fire_at, i) => ({ name: `parkproof-push-stop-1-${i}`, fire_at })) },
  inTab: { status: 'scheduled', scheduledCount: fires.length, pastCount: 0, totalSelected: fires.length, firesAt: fires.map((f) => new Date(f)) },
})

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  localStorage.clear()
  resetWorkdayRemindersForTests()
  mocks.remindMe.mockReset()
  mocks.scheduleAbsolute.mockReset()
  mocks.scheduleAbsolute.mockResolvedValue({ status: 'scheduled', scheduledCount: 3, pastCount: 0, totalSelected: 3, firesAt: [] })
  mocks.cancelInTab.mockReset()
  mocks.mirror.mockReset()
  mocks.turnedOff.value = false
  setPermission('granted')
})
afterEach(() => {
  setPermission(null)
})

describe('workdayLegPlan', () => {
  it("is T6a's schedule for the stop's saved limit: heads-up, go now, at the deadline", () => {
    const plan = workdayLegPlan(stop(), [stop()], NOW)
    expect(plan.reminders.map((r) => [r.kind, r.fire_at])).toEqual([
      ['heads_up', new Date(NOW + 75 * MIN).toISOString()],
      ['go_now', new Date(NOW + 95 * MIN).toISOString()],
      ['at_deadline', new Date(NOW + 120 * MIN).toISOString()],
    ])
    expect(plan.area_mode).toBe(false)
    expect(plan.reminders.length).toBeLessThanOrEqual(MAX_PUSH_REMINDERS)
  })

  it('has nothing to set when the limit has passed or there is none', () => {
    expect(workdayLegPlan(stop({ expires_at: new Date(NOW - MIN).toISOString() }), [], NOW).reminders).toEqual([])
    expect(workdayLegPlan(stop({ expires_at: null }), [], NOW).reminders).toEqual([])
  })
})

describe('bookWorkdayLegReminders', () => {
  it('books in-tab and push with the exact copy, and keeps the booked times on the record', async () => {
    const leg = stop()
    saveSession(leg)
    mocks.remindMe.mockImplementation(async (args) => {
      await args.armInTab()
      return booked(args.pushReminders.map((r) => r.fire_at))
    })
    const summary = await bookWorkdayLegReminders(leg, [leg], t, { now: NOW, signedIn: true })

    expect(mocks.remindMe).toHaveBeenCalledTimes(1)
    const args = mocks.remindMe.mock.calls[0][0]
    expect(args.sessionId).toBe('stop-1')
    expect(args.expiresAt).toBe(leg.expires_at)
    expect(args.pushReminders.length).toBeLessThanOrEqual(MAX_PUSH_REMINDERS)
    expect(args.pushReminders.map((r) => r.body)).toEqual([
      'Your time limit on this stretch ends at 1:00 pm. Move off this signed stretch, not just to another bay.',
      'Leave now to move the car before 1:00 pm.',
      'Your time on this stretch ended at 1:00 pm.',
    ])
    expect(args.pushReminders.every((r) => r.title === '12 King St, Melbourne' && r.url?.includes('stop-1'))).toBe(true)

    // In-tab copies replace any armed before, at the same times, with the same words.
    expect(mocks.cancelInTab).toHaveBeenCalledWith('stop-1')
    const [inTabLeg, fireAts, copyFor] = mocks.scheduleAbsolute.mock.calls[0]
    expect(inTabLeg.id).toBe('stop-1')
    expect((fireAts as Date[]).map((d) => d.toISOString())).toEqual(args.pushReminders.map((r) => r.fire_at))
    expect(copyFor((fireAts as Date[])[1]).body).toBe('Leave now to move the car before 1:00 pm.')

    expect(getSession('stop-1')!.push_reminders).toEqual(args.pushReminders.map((r) => ({ fire_at: r.fire_at })))
    expect(mocks.mirror).toHaveBeenCalledWith('stop-1')
    expect(summary).toMatchObject({ kind: 'background', step: null })
  })

  it('says to leave the whole area under an area limit', async () => {
    const leg = stop({ rules: '2P Parking Area', rule_flags: FLAGS(true) })
    mocks.remindMe.mockResolvedValue(booked([]))
    await bookWorkdayLegReminders(leg, [leg], t, { now: NOW })
    expect(mocks.remindMe.mock.calls[0][0].pushReminders[0].body).toBe(
      'Your time limit in this parking area ends at 1:00 pm. Move the car out of the whole area, not just to another street inside it.',
    )
  })

  it('never asks for permission from a save, and sets nothing without it', async () => {
    setPermission('default')
    expect(await bookWorkdayLegReminders(stop(), [], t, { now: NOW })).toBeNull()
    setPermission('denied')
    expect(await bookWorkdayLegReminders(stop(), [], t, { now: NOW })).toBeNull()
    setPermission(null)
    expect(await bookWorkdayLegReminders(stop(), [], t, { now: NOW })).toBeNull()
    expect(mocks.remindMe).not.toHaveBeenCalled()
    expect(mocks.scheduleAbsolute).not.toHaveBeenCalled()
  })

  it('a Retry tap may ask (remindMe asks inside the tap)', async () => {
    setPermission('default')
    mocks.remindMe.mockResolvedValue(booked([]))
    await bookWorkdayLegReminders(stop(), [], t, { now: NOW, fromTap: true })
    expect(mocks.remindMe).toHaveBeenCalledTimes(1)
  })

  it('sets nothing for an ended stop, a passed limit, or with notifications turned off in Settings', async () => {
    expect(await bookWorkdayLegReminders(stop({ ended_at: new Date(NOW).toISOString() }), [], t, { now: NOW })).toBeNull()
    expect(await bookWorkdayLegReminders(stop({ expires_at: new Date(NOW - MIN).toISOString() }), [], t, { now: NOW })).toBeNull()
    mocks.turnedOff.value = true
    expect(await bookWorkdayLegReminders(stop(), [], t, { now: NOW })).toBeNull()
    expect(mocks.remindMe).not.toHaveBeenCalled()
  })

  it('reports a push failure so the card can offer Retry, and keeps no times', async () => {
    const leg = stop()
    saveSession(leg)
    mocks.remindMe.mockResolvedValue({
      background: { ok: false, reason: 'failed' },
      inTab: { status: 'scheduled', scheduledCount: 3, pastCount: 0, totalSelected: 3, firesAt: [new Date(NOW + 75 * MIN)] },
    })
    const summary = await bookWorkdayLegReminders(leg, [leg], t, { now: NOW })
    expect(summary).toMatchObject({ kind: 'openOnly', step: 'failed' })
    expect(getSession('stop-1')!.push_reminders).toBeUndefined()
  })
})

describe('rearmWorkdayLegInTab', () => {
  it('arms the parked stop in-tab again after a reload, once per page, never asking', () => {
    expect(rearmWorkdayLegInTab(stop(), [], t, NOW)).toBe(true)
    expect(rearmWorkdayLegInTab(stop(), [], t, NOW)).toBe(false)
    expect(mocks.scheduleAbsolute).toHaveBeenCalledTimes(1)
    expect(mocks.remindMe).not.toHaveBeenCalled()

    resetWorkdayRemindersForTests()
    setPermission('default')
    expect(rearmWorkdayLegInTab(stop(), [], t, NOW)).toBe(false)
    expect(mocks.scheduleAbsolute).toHaveBeenCalledTimes(1)
  })
})
