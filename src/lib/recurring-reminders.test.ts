// @vitest-environment happy-dom
//
// Weekly reminders while the app is open (T5a): the next 24 hours of each
// rule's reminders are armed on the in-tab scheduler, re-arming replaces
// what was armed (an edit, a pause or a delete takes effect at once), and
// nothing is armed without notification permission.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TFunction } from 'i18next'
import i18n from './i18n'
import type { RecurringRule } from '../types'
import { armRecurringInTabReminders, ensureReminderPermission, inTabNotificationsFor } from './recurring-reminders'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: A,
    label: '',
    kind: 'street_cleaning',
    days: ['TU'],
    start: '07:00',
    end: '09:00',
    frequency: 'weekly',
    nth: [],
    anchor_date: '2026-11-01',
    timezone: 'Australia/Melbourne',
    address: '12 King St',
    remind_evening_before: '20:00',
    remind_minutes_before: 60,
    push: true,
    paused: false,
    sequence: 0,
    ...overrides,
  }
}

const shown: { title: string; body?: string; tag?: string }[] = []
let permission: NotificationPermission = 'granted'
let t: TFunction

beforeAll(async () => {
  await i18n.changeLanguage('en')
  t = i18n.getFixedT('en')
})

beforeEach(() => {
  vi.useFakeTimers()
  // Mon 9 Nov 2026, 11 am in Melbourne. Tue 10 Nov's sweep: 8 pm tonight and 6 am tomorrow.
  vi.setSystemTime(new Date('2026-11-09T00:00:00.000Z'))
  shown.length = 0
  permission = 'granted'
  class FakeNotification {
    static get permission() {
      return permission
    }
    static requestPermission = vi.fn(async () => {
      permission = 'granted'
      return permission
    })
    constructor(title: string, options: { body?: string; tag?: string } = {}) {
      shown.push({ title, ...options })
    }
  }
  vi.stubGlobal('Notification', FakeNotification)
})

afterEach(() => {
  armRecurringInTabReminders([], t)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('in-tab weekly reminders', () => {
  it('lists the next 24 hours of reminders with their text and tags', () => {
    const items = inTabNotificationsFor(rule(), t, Date.now())
    expect(items.map((i) => i.fireAt.toISOString())).toEqual([
      '2026-11-09T09:00:00.000Z', // Mon 8 pm AEDT
      '2026-11-09T19:00:00.000Z', // Tue 6 am AEDT
    ])
    expect(items[0]).toMatchObject({
      title: '12 King St',
      body: 'Street sweeping on Tuesday 7 to 9 am. Move the car tonight.',
      tag: `pp-r-${A}-${Date.parse('2026-11-09T09:00:00Z')}`,
    })
    expect(inTabNotificationsFor(rule({ push: false }), t, Date.now())).toEqual([])
    expect(inTabNotificationsFor(rule({ paused: true }), t, Date.now())).toEqual([])
  })

  it('fires each armed reminder at its time', () => {
    expect(armRecurringInTabReminders([rule()], t)).toBe(2)
    vi.advanceTimersByTime(9 * 3600_000 - 1000)
    expect(shown).toEqual([])
    vi.advanceTimersByTime(2000)
    expect(shown.map((n) => n.body)).toEqual(['Street sweeping on Tuesday 7 to 9 am. Move the car tonight.'])
    vi.advanceTimersByTime(10 * 3600_000)
    expect(shown).toHaveLength(2)
    expect(shown[1].body).toBe('Street sweeping on Tuesday 7 to 9 am. Move the car before 7 am.')
  })

  it('replaces what was armed when a rule changes, pauses or goes', () => {
    armRecurringInTabReminders([rule(), rule({ id: B, days: ['MO'], start: '18:00', end: '19:00', remind_evening_before: null })], t)
    // Paused: its reminders are disarmed, not added to.
    expect(armRecurringInTabReminders([rule({ paused: true }), rule({ id: B, days: ['MO'], start: '18:00', end: '19:00', remind_evening_before: null })], t)).toBe(1)
    // Rule A deleted, rule B still there: only B's reminder (Mon 5 pm) fires.
    armRecurringInTabReminders([rule({ id: B, days: ['MO'], start: '18:00', end: '19:00', remind_evening_before: null })], t)
    vi.advanceTimersByTime(24 * 3600_000)
    expect(shown.map((n) => n.tag)).toEqual([`pp-r-${B}-${Date.parse('2026-11-09T06:00:00Z')}`])
  })

  it('a re-arm a few seconds before a reminder fires keeps it (the 15-minute tick, or another rule saved)', () => {
    armRecurringInTabReminders([rule()], t)
    // 10 s before the 8 pm reminder: inside the 30 s margin for a new alarm.
    vi.advanceTimersByTime(9 * 3600_000 - 10_000)
    expect(armRecurringInTabReminders([rule()], t)).toBe(2)
    // Saving another rule re-arms everything again, 5 s before.
    vi.advanceTimersByTime(5_000)
    armRecurringInTabReminders([rule(), rule({ id: B, days: ['FR'] })], t)
    vi.advanceTimersByTime(10_000)
    expect(shown.map((n) => n.tag)).toEqual([`pp-r-${A}-${Date.parse('2026-11-09T09:00:00Z')}`])
  })

  it('never shows one reminder twice when it is re-armed', () => {
    armRecurringInTabReminders([rule()], t)
    armRecurringInTabReminders([rule()], t)
    armRecurringInTabReminders([rule()], t)
    vi.advanceTimersByTime(24 * 3600_000)
    expect(shown).toHaveLength(2)
  })

  it('a re-arm with new words keeps the timer and shows the new words', () => {
    armRecurringInTabReminders([rule()], t)
    vi.advanceTimersByTime(9 * 3600_000 - 10_000)
    armRecurringInTabReminders([rule({ address: '14 King St' })], t)
    vi.advanceTimersByTime(20_000)
    expect(shown).toHaveLength(1)
    expect(shown[0].title).toBe('14 King St')
  })

  it('a first arm still skips a reminder due within 30 seconds', () => {
    vi.setSystemTime(new Date(Date.parse('2026-11-09T09:00:00Z') - 10_000))
    expect(armRecurringInTabReminders([rule()], t)).toBe(1)
    vi.advanceTimersByTime(20_000)
    expect(shown).toEqual([])
  })

  it('disarms a rule that is no longer in the list at all', () => {
    armRecurringInTabReminders([rule()], t)
    armRecurringInTabReminders([], t)
    vi.advanceTimersByTime(48 * 3600_000)
    expect(shown).toEqual([])
  })

  it('arms nothing without permission and never asks on its own', () => {
    permission = 'default'
    expect(armRecurringInTabReminders([rule()], t)).toBe(0)
    expect((Notification as unknown as { requestPermission: ReturnType<typeof vi.fn> }).requestPermission).not.toHaveBeenCalled()
    vi.advanceTimersByTime(48 * 3600_000)
    expect(shown).toEqual([])
  })

  it('asks once, from a tap, when notifications are switched on', async () => {
    permission = 'default'
    await expect(ensureReminderPermission()).resolves.toBe('granted')
    permission = 'denied'
    await expect(ensureReminderPermission()).resolves.toBe('denied')
    const request = (Notification as unknown as { requestPermission: ReturnType<typeof vi.fn> }).requestPermission
    expect(request).toHaveBeenCalledTimes(1)
  })
})
