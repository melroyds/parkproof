// @vitest-environment happy-dom
//
// One "can this phone alert" check for both reminder screens (fix list,
// after the overnight build). The end-to-end run found an Android phone
// where the Remind me outcome said "only works while ParkProof is open"
// while the weekly reminders list said the phone couldn't alert at all.
// That happens before a service worker controls the page: Android shows
// in-tab alerts only through one, so neither screen may claim it will.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TFunction } from 'i18next'
import i18n from './i18n'
import type { RecurringRule } from '../types'
import type { ScheduleResult } from './notifications'
import { alertEnvironment, alertReach, type AlertEnvironment } from './alert-reach'
import { summariseRemindMe, type RemindMeResult } from './remind-me'
import {
  reconcileRecurringPush,
  recurringAlertReach,
  resetRecurringPushForTests,
  type PushReadiness,
  type RecurringPushDeps,
} from './recurring-push'

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36'
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15'
const FIRE = '2099-01-01T00:30:00.000Z'

/** The record's in-tab reminders were armed; push booked nothing. */
const ARMED: ScheduleResult = {
  status: 'scheduled',
  scheduledCount: 1,
  pastCount: 0,
  totalSelected: 1,
  firesAt: [new Date(FIRE)],
}
const PUSH_FAILED: RemindMeResult = { background: { ok: false, reason: 'failed' }, inTab: ARMED }

let t: TFunction

beforeAll(async () => {
  await i18n.changeLanguage('en')
  t = i18n.t.bind(i18n) as TFunction
})

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    label: '',
    kind: 'street_cleaning',
    days: ['TU'],
    start: '07:00',
    end: '09:00',
    frequency: 'weekly',
    nth: [],
    anchor_date: '2026-01-01',
    timezone: 'Australia/Melbourne',
    address: null,
    remind_evening_before: '20:00',
    remind_minutes_before: null,
    push: true,
    paused: false,
    sequence: 0,
    ...overrides,
  }
}

/** Work out the weekly rule's push status the way the app does, with no server. */
async function settleWeeklyRule(readiness: PushReadiness): Promise<void> {
  const deps: RecurringPushDeps = {
    readiness: async () => readiness,
    book: async () => ({ ok: true }),
    cancel: async () => ({ ok: true }),
    now: () => Date.now(),
  }
  await reconcileRecurringPush([rule()], t, deps)
}

/** A phone: its browser, its notification permission, and its service worker. */
function phone({ ua, permission, controlled }: { ua: string; permission: NotificationPermission; controlled: boolean }) {
  vi.stubGlobal('Notification', { permission, requestPermission: async () => permission })
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { controller: controlled ? {} : null },
  })
}

beforeEach(() => {
  localStorage.clear()
  resetRecurringPushForTests()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (navigator as unknown as Record<string, unknown>).serviceWorker
})

describe('alertReach()', () => {
  it('push counts only while permission is granted and push is on; otherwise the open tab decides', () => {
    const granted: AlertEnvironment = { permission: 'granted', inTab: true }
    expect(alertReach(true, granted)).toBe('closed')
    expect(alertReach(true, { permission: 'granted', inTab: false })).toBe('closed')
    expect(alertReach(true, { ...granted, pushOff: true })).toBe('open_only')
    expect(alertReach(true, { permission: 'denied', inTab: false })).toBe('none')
    expect(alertReach(false, granted)).toBe('open_only')
    expect(alertReach(false, { permission: 'granted', inTab: false })).toBe('none')
    expect(alertReach(false, { permission: 'unsupported', inTab: false })).toBe('none')
  })
})

describe('Android before a service worker controls the page', () => {
  it('reads as "this phone cannot show an in-tab alert"', () => {
    phone({ ua: ANDROID_UA, permission: 'granted', controlled: false })
    expect(alertEnvironment()).toEqual({ permission: 'granted', inTab: false })
  })

  it('the Remind me outcome never says "only works while ParkProof is open"', () => {
    phone({ ua: ANDROID_UA, permission: 'granted', controlled: false })
    const summary = summariseRemindMe(PUSH_FAILED)
    expect(summary.kind).toBe('none')
    expect(summary.times).toEqual([])
    // The push step that would fix it is still offered.
    expect(summary.step).toBe('failed')
  })

  it('and the weekly list says the same: this phone cannot alert', async () => {
    phone({ ua: ANDROID_UA, permission: 'granted', controlled: false })
    await settleWeeklyRule('unsupported')
    expect(recurringAlertReach(rule(), t)).toBe('none')
  })

  it('once a service worker controls the page, both say "only while open"', async () => {
    phone({ ua: ANDROID_UA, permission: 'granted', controlled: true })
    await settleWeeklyRule('unsupported')
    expect(summariseRemindMe(PUSH_FAILED)).toEqual({ kind: 'openOnly', times: [new Date(FIRE)], step: 'failed' })
    expect(recurringAlertReach(rule(), t)).toBe('open_only')
  })

  it('a desktop browser shows in-tab alerts without a service worker', async () => {
    phone({ ua: MAC_UA, permission: 'granted', controlled: false })
    await settleWeeklyRule('unsupported')
    expect(summariseRemindMe(PUSH_FAILED).kind).toBe('openOnly')
    expect(recurringAlertReach(rule(), t)).toBe('open_only')
  })

  it('the rare "server skipped every time" case follows the same check', () => {
    phone({ ua: ANDROID_UA, permission: 'granted', controlled: false })
    const skipped: RemindMeResult = { background: { ok: true, created: [] }, inTab: ARMED }
    expect(summariseRemindMe(skipped)).toEqual({ kind: 'none', times: [], step: 'failed' })
  })
})

describe('the two screens never disagree', () => {
  const envs: AlertEnvironment[] = []
  for (const permission of ['granted', 'denied', 'default', 'unsupported'] as const) {
    for (const inTab of [true, false]) {
      for (const pushOff of [undefined, true]) envs.push(pushOff ? { permission, inTab, pushOff } : { permission, inTab })
    }
  }

  it('without push: "only while open" on one exactly when it is on the other', async () => {
    await settleWeeklyRule('unsupported')
    for (const env of envs) {
      const weekly = recurringAlertReach(rule(), t, env)
      const record = summariseRemindMe(PUSH_FAILED, env)
      expect({ env, openOnly: record.kind === 'openOnly' }).toEqual({ env, openOnly: weekly === 'open_only' })
      expect({ env, none: record.kind === 'none' }).toEqual({ env, none: weekly === 'none' })
    }
  })
})
