// @vitest-environment happy-dom
//
// Weekly reminders by push (T5b), the phone's side: the request it books,
// the reconcile pass that keeps the server in step with create, edit,
// pause, resume and delete, the fall back to on-device reminders when push
// can't work, and the two routes' request shapes.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TFunction } from 'i18next'
import i18n from './i18n'
import type { RecurringRule } from '../types'
import { RECURRING_SCHEDULE_DAYS, parseRecurringPushRequest } from '../../lambda/recurring-schedule.js'
import {
  REGISTER_TIMEOUT_MS,
  RECURRING_PUSH_LAPSE_MS,
  RECURRING_PUSH_RESYNC_MS,
  RECURRING_PUSH_STATE_KEY,
  alertEnvironment,
  bookRecurringPush,
  bookedRecurringRuleIds,
  cancelRecurringPush,
  reconcileRecurringPush,
  recurringAlertReach,
  recurringBookingStands,
  recurringPushRequest,
  registerForRecurringPush,
  recurringPushSignature,
  recurringPushStatusOf,
  requestRecurringPushSync,
  resetRecurringPushForTests,
  wantsServerPush,
  type PushReadiness,
  type RecurringPushCallResult,
  type RecurringPushDeps,
  type RecurringPushRequest,
} from './recurring-push'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DEVICE_ID_KEY = 'parkproof.device_id.v1'
const DEVICE = '11111111-1111-4111-8111-111111111111'

let t: TFunction

beforeAll(async () => {
  await i18n.changeLanguage('en')
  t = i18n.t.bind(i18n) as TFunction
})

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: A,
    label: '',
    kind: 'street_cleaning',
    days: ['MO', 'TH'],
    start: '07:00',
    end: '09:00',
    frequency: 'weekly',
    nth: [],
    anchor_date: '2026-01-01',
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

/**
 * A fake server and push platform for reconcile. Its clock starts at the
 * real one, so a status read later with the default (real) clock sees a
 * booking of the right age, whatever day the tests run.
 */
function fakeDeps(opts: { readiness?: PushReadiness; book?: RecurringPushCallResult[]; cancel?: RecurringPushCallResult[] } = {}) {
  let now = Date.now()
  const booked: RecurringPushRequest[] = []
  const cancelled: string[] = []
  const readinessCalls: ({ force?: boolean } | undefined)[] = []
  const bookQueue = [...(opts.book ?? [])]
  const cancelQueue = [...(opts.cancel ?? [])]
  const deps: RecurringPushDeps = {
    readiness: async (o) => {
      readinessCalls.push(o)
      return opts.readiness ?? 'ready'
    },
    book: async (req) => {
      booked.push(req)
      return bookQueue.shift() ?? { ok: true }
    },
    cancel: async (id) => {
      cancelled.push(id)
      return cancelQueue.shift() ?? { ok: true }
    },
    now: () => now,
  }
  return {
    deps,
    booked,
    cancelled,
    readinessCalls,
    advance: (ms: number) => {
      now += ms
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  resetRecurringPushForTests()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the booking request', () => {
  it('carries the schedule and, per reminder, the words for each rule day', () => {
    const req = recurringPushRequest(rule(), t)
    expect(req.rule).toEqual({
      id: A,
      days: ['MO', 'TH'],
      start: '07:00',
      frequency: 'weekly',
      nth: [],
      anchor_date: '2026-01-01',
      timezone: 'Australia/Melbourne',
      remind_evening_before: '20:00',
      remind_minutes_before: 60,
    })
    expect(req.copy.title).toBe('12 King St')
    expect(req.copy.url).toMatch(/\?recurring=open$/)
    expect(req.copy.evening?.MO).toMatch(/^Street sweeping on Monday/)
    expect(req.copy.evening?.MO).toMatch(/Move the car tonight\.$/)
    expect(req.copy.evening?.TH).toMatch(/^Street sweeping on Thursday/)
    expect(req.copy.before?.TH).toMatch(/Thursday/)
    // The server only needs what it books from: no label, address or end.
    expect(Object.keys(req.rule)).not.toContain('address')
  })

  it('leaves out the words for a reminder the rule does not have', () => {
    const req = recurringPushRequest(rule({ remind_evening_before: null }), t)
    expect(req.copy.evening).toBeNull()
    expect(req.copy.before).not.toBeNull()
  })

  it('is accepted by the server as it is (the two sides agree on the shape)', () => {
    for (const r of [
      rule(),
      rule({ frequency: 'fortnightly', anchor_date: '2026-11-12' }),
      rule({ frequency: 'monthly_nth', nth: [1, 3], days: ['TU'] }),
      rule({ remind_evening_before: null, start: '00:30', end: '02:00' }),
      rule({ address: null, label: 'Clearway' }),
    ]) {
      const parsed = parseRecurringPushRequest({ device_id: DEVICE, ...recurringPushRequest(r, t) })
      expect(parsed.ok).toBe(true)
    }
  })

  it('changes its fingerprint with anything the push carries, not with pause or the push switch', () => {
    const base = recurringPushSignature(recurringPushRequest(rule(), t))
    expect(recurringPushSignature(recurringPushRequest(rule({ label: 'Sweeper' }), t))).not.toBe(base)
    expect(recurringPushSignature(recurringPushRequest(rule({ start: '06:30' }), t))).not.toBe(base)
    expect(recurringPushSignature(recurringPushRequest(rule({ end: '10:00' }), t))).not.toBe(base)
    expect(recurringPushSignature(recurringPushRequest(rule({ paused: true }), t))).toBe(base)
    expect(recurringPushSignature(recurringPushRequest(rule({ sequence: 4 }), t))).toBe(base)
  })

  it('wants server push only when notifications are on, it is running and it has a reminder', () => {
    expect(wantsServerPush(rule())).toBe(true)
    expect(wantsServerPush(rule({ push: false }))).toBe(false)
    expect(wantsServerPush(rule({ paused: true }))).toBe(false)
    expect(wantsServerPush(rule({ remind_evening_before: null, remind_minutes_before: null }))).toBe(false)
  })
})

describe('keeping the server in step', () => {
  it('create: books once, then leaves it alone until something changes', async () => {
    const f = fakeDeps()
    const report = await reconcileRecurringPush([rule()], t, f.deps)
    expect(report.booked).toEqual([A])
    expect(f.booked).toHaveLength(1)
    expect(bookedRecurringRuleIds()).toEqual([A])
    expect(recurringPushStatusOf(rule(), t)).toBe('push')

    await reconcileRecurringPush([rule()], t, f.deps)
    expect(f.booked).toHaveLength(1)
    // No request needed, so push readiness wasn't even checked again.
    expect(f.readinessCalls).toHaveLength(1)
  })

  it('edit: books the new version (replace-all on the server)', async () => {
    const f = fakeDeps()
    await reconcileRecurringPush([rule()], t, f.deps)
    await reconcileRecurringPush([rule({ start: '06:00' })], t, f.deps)
    expect(f.booked).toHaveLength(2)
    expect(f.booked[1].rule.start).toBe('06:00')
    expect(f.cancelled).toEqual([])
  })

  it('pause cancels, resume books again', async () => {
    const f = fakeDeps()
    await reconcileRecurringPush([rule()], t, f.deps)
    await reconcileRecurringPush([rule({ paused: true })], t, f.deps)
    expect(f.cancelled).toEqual([A])
    expect(bookedRecurringRuleIds()).toEqual([])
    expect(recurringPushStatusOf(rule({ paused: true }), t)).toBeNull()
    await reconcileRecurringPush([rule()], t, f.deps)
    expect(f.booked).toHaveLength(2)
  })

  it('delete, notifications off and no reminders left all cancel', async () => {
    for (const after of [[], [rule({ push: false })], [rule({ remind_evening_before: null, remind_minutes_before: null })]]) {
      localStorage.clear()
      const f = fakeDeps()
      await reconcileRecurringPush([rule()], t, f.deps)
      await reconcileRecurringPush(after, t, f.deps)
      expect(f.cancelled).toEqual([A])
      expect(bookedRecurringRuleIds()).toEqual([])
    }
  })

  it('keeps a cancel that failed (offline) and tries it again next time', async () => {
    const f = fakeDeps({ cancel: [{ ok: false, reason: 'network' }] })
    await reconcileRecurringPush([rule()], t, f.deps)
    await reconcileRecurringPush([], t, f.deps)
    expect(bookedRecurringRuleIds()).toEqual([A])
    await reconcileRecurringPush([], t, f.deps)
    expect(f.cancelled).toEqual([A, A])
    expect(bookedRecurringRuleIds()).toEqual([])
  })

  it('a rule paused while offline and resumed before the cancel went through needs no new booking', async () => {
    const f = fakeDeps({ cancel: [{ ok: false, reason: 'network' }] })
    await reconcileRecurringPush([rule()], t, f.deps)
    await reconcileRecurringPush([rule({ paused: true })], t, f.deps)
    await reconcileRecurringPush([rule()], t, f.deps)
    expect(f.booked).toHaveLength(1)
    expect(recurringPushStatusOf(rule(), t)).toBe('push')
  })

  it('books again after a week, so the server schedules (90 days) never lapse for a phone in use', async () => {
    const f = fakeDeps()
    await reconcileRecurringPush([rule()], t, f.deps)
    f.advance(RECURRING_PUSH_RESYNC_MS - 60_000)
    await reconcileRecurringPush([rule()], t, f.deps)
    expect(f.booked).toHaveLength(1)
    f.advance(120_000)
    await reconcileRecurringPush([rule()], t, f.deps)
    expect(f.booked).toHaveLength(2)
  })

  it('books again when the language changes (the words are booked in it)', async () => {
    const f = fakeDeps()
    await reconcileRecurringPush([rule()], t, f.deps)
    await i18n.changeLanguage('it')
    try {
      await reconcileRecurringPush([rule()], i18n.t.bind(i18n) as TFunction, f.deps)
    } finally {
      await i18n.changeLanguage('en')
    }
    expect(f.booked).toHaveLength(2)
    expect(f.booked[1].copy.evening?.MO).not.toBe(f.booked[0].copy.evening?.MO)
  })

  it('a booking whose answer never came (offline, lost response) is still cancelled when the rule is deleted', async () => {
    for (const after of [[], [rule({ paused: true })], [rule({ push: false })]]) {
      localStorage.clear()
      resetRecurringPushForTests()
      const f = fakeDeps({ book: [{ ok: false, reason: 'network' }] })
      await reconcileRecurringPush([rule()], t, f.deps)
      expect(bookedRecurringRuleIds()).toEqual([])
      await reconcileRecurringPush(after, t, f.deps)
      expect(f.cancelled).toEqual([A])
      expect(localStorage.getItem(RECURRING_PUSH_STATE_KEY)).toBe('{}')
    }
  })

  it('a partial booking (some schedules created) is cancelled too', async () => {
    localStorage.setItem('parkproof.device_id.v1', DEVICE)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ created: [{}], skipped: [{ reason: 'scheduler error' }] }), { status: 200 })),
    )
    const f = fakeDeps()
    const deps: RecurringPushDeps = { ...f.deps, book: bookRecurringPush }
    const report = await reconcileRecurringPush([rule()], t, deps)
    expect(report.statuses[A]).toBe('pending')
    await reconcileRecurringPush([], t, deps)
    expect(f.cancelled).toEqual([A])
  })

  it('a failed cancel of an unconfirmed booking is kept and tried again', async () => {
    const f = fakeDeps({ book: [{ ok: false, reason: 'network' }], cancel: [{ ok: false, reason: 'network' }] })
    await reconcileRecurringPush([rule()], t, f.deps)
    await reconcileRecurringPush([], t, f.deps)
    await reconcileRecurringPush([], t, f.deps)
    expect(f.cancelled).toEqual([A, A])
    expect(localStorage.getItem(RECURRING_PUSH_STATE_KEY)).toBe('{}')
  })

  it('sends no booking it could not first note down (storage full), so nothing is left it cannot cancel', async () => {
    const f = fakeDeps()
    // happy-dom's localStorage can't be spied on (CLAUDE.md gotcha): swap in
    // a Storage-shaped object that refuses this module's key.
    const real = globalThis.localStorage
    const backing = new Map<string, string>()
    const full: Storage = {
      get length() {
        return backing.size
      },
      clear: () => backing.clear(),
      getItem: (k) => backing.get(k) ?? null,
      key: (i) => [...backing.keys()][i] ?? null,
      removeItem: (k) => void backing.delete(k),
      setItem: (k, v) => {
        if (k === RECURRING_PUSH_STATE_KEY) throw new DOMException('full', 'QuotaExceededError')
        backing.set(k, String(v))
      },
    }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: full })
    try {
      const report = await reconcileRecurringPush([rule()], t, f.deps)
      expect(f.booked).toEqual([])
      expect(report.statuses[A]).toBe('pending')
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: real })
    }
    await reconcileRecurringPush([rule()], t, f.deps)
    expect(f.booked).toHaveLength(1)
  })

  it('handles each rule on its own', async () => {
    const f = fakeDeps({ book: [{ ok: true }, { ok: false, reason: 'network' }] })
    const report = await reconcileRecurringPush([rule(), rule({ id: B, days: ['FR'] })], t, f.deps)
    expect(report.statuses).toEqual({ [A]: 'push', [B]: 'pending' })
    expect(bookedRecurringRuleIds()).toEqual([A])
  })
})

describe('falling back to on-device reminders', () => {
  it('push not possible on this phone: nothing booked, the rule is on this device only', async () => {
    for (const readiness of ['unsupported', 'not_allowed'] as const) {
      localStorage.clear()
      resetRecurringPushForTests()
      const f = fakeDeps({ readiness })
      const report = await reconcileRecurringPush([rule()], t, f.deps)
      expect(f.booked).toEqual([])
      expect(report.statuses[A]).toBe('device')
      expect(recurringPushStatusOf(rule(), t)).toBe('device')
    }
  })

  it('offline: pending, and booked on the next pass', async () => {
    const f = fakeDeps({ book: [{ ok: false, reason: 'network' }] })
    await reconcileRecurringPush([rule()], t, f.deps)
    expect(recurringPushStatusOf(rule(), t)).toBe('pending')
    expect(bookedRecurringRuleIds()).toEqual([])
    await reconcileRecurringPush([rule()], t, f.deps)
    expect(recurringPushStatusOf(rule(), t)).toBe('push')
  })

  it('a failed weekly refresh of an unchanged booking keeps it on push', async () => {
    const f = fakeDeps({ book: [{ ok: true }, { ok: false, reason: 'rate_limited' }] })
    await reconcileRecurringPush([rule()], t, f.deps)
    f.advance(RECURRING_PUSH_RESYNC_MS + 1)
    const report = await reconcileRecurringPush([rule()], t, f.deps)
    expect(report.statuses[A]).toBe('push')
    expect(recurringPushStatusOf(rule(), t, f.deps.now())).toBe('push')
  })

  it("another device's schedules (ERR_NOT_OWNER): on this device only, and forgotten here", async () => {
    const f = fakeDeps({ book: [{ ok: true }, { ok: false, reason: 'not_owner' }] })
    await reconcileRecurringPush([rule()], t, f.deps)
    const report = await reconcileRecurringPush([rule({ start: '06:00' })], t, f.deps)
    expect(report.statuses[A]).toBe('device')
    expect(bookedRecurringRuleIds()).toEqual([])
  })

  it('a server that has forgotten the phone (409 ERR_NOT_SUBSCRIBED): registers again and retries once', async () => {
    const f = fakeDeps({ book: [{ ok: false, reason: 'not_subscribed' }, { ok: true }] })
    const report = await reconcileRecurringPush([rule()], t, f.deps)
    expect(f.readinessCalls).toEqual([undefined, { force: true }])
    expect(f.booked).toHaveLength(2)
    expect(report.statuses[A]).toBe('push')
  })
})

describe('a booking past the end of its server schedules (90 days)', () => {
  const DAY = 24 * 60 * 60 * 1000
  const granted = { permission: 'granted' as const, inTab: true }

  it('trusts a booking until five days before the server deletes it', () => {
    expect(RECURRING_PUSH_LAPSE_MS).toBe((RECURRING_SCHEDULE_DAYS - 5) * DAY)
    expect(RECURRING_PUSH_LAPSE_MS).toBeLessThan(RECURRING_SCHEDULE_DAYS * DAY)
    const at = Date.parse('2026-11-09T10:00:00Z')
    expect(recurringBookingStands(at, at)).toBe(true)
    expect(recurringBookingStands(at, at + RECURRING_PUSH_LAPSE_MS - 1)).toBe(true)
    expect(recurringBookingStands(at, at + RECURRING_PUSH_LAPSE_MS)).toBe(false)
    expect(recurringBookingStands(at, at + 91 * DAY)).toBe(false)
    // The phone's clock went back: the age is unknown, so it isn't trusted.
    expect(recurringBookingStands(at, at - 60_000)).toBe(false)
  })

  it('a refresh that fails after 91 days is pending, never "alerts with ParkProof closed"', async () => {
    const failures: { readiness: PushReadiness; refresh: RecurringPushCallResult }[] = [
      // Offline: readiness can't be checked, so nothing is sent.
      { readiness: 'network', refresh: { ok: true } },
      // Online, but the booking fails.
      { readiness: 'ready', refresh: { ok: false, reason: 'network' } },
      { readiness: 'ready', refresh: { ok: false, reason: 'rate_limited' } },
    ]
    for (const failure of failures) {
      localStorage.clear()
      resetRecurringPushForTests()
      // Booked while online; then four months away, and back offline or into a server error.
      const f = fakeDeps({ book: [{ ok: true }, failure.refresh] })
      await reconcileRecurringPush([rule()], t, f.deps)
      expect(recurringPushStatusOf(rule(), t, f.deps.now())).toBe('push')
      f.advance(91 * DAY)
      const deps: RecurringPushDeps = { ...f.deps, readiness: async () => failure.readiness }
      const report = await reconcileRecurringPush([rule()], t, deps)
      expect(f.booked).toHaveLength(failure.readiness === 'network' ? 1 : 2)
      expect(report.statuses[A]).toBe('pending')
      expect(recurringPushStatusOf(rule(), t, f.deps.now())).toBe('pending')
      expect(recurringAlertReach(rule(), t, granted, f.deps.now())).toBe('open_only')
      expect(recurringAlertReach(rule(), t, { permission: 'granted', inTab: false }, f.deps.now())).toBe('none')
    }
  })

  it('on opening the app, before any pass: a lapsed booking is not yet worked out, a live one is push', async () => {
    const f = fakeDeps()
    await reconcileRecurringPush([rule()], t, f.deps)
    const bookedAt = f.deps.now()
    // A fresh start: nothing in memory, only what was stored.
    resetRecurringPushForTests()
    expect(recurringPushStatusOf(rule(), t, bookedAt + 60 * DAY)).toBe('push')
    expect(recurringAlertReach(rule(), t, granted, bookedAt + 60 * DAY)).toBe('closed')
    expect(recurringPushStatusOf(rule(), t, bookedAt + 91 * DAY)).toBeNull()
    expect(recurringAlertReach(rule(), t, granted, bookedAt + 91 * DAY)).toBeNull()
  })

  it('a tab left open past the end, before its next pass, stops saying push', async () => {
    const f = fakeDeps()
    await reconcileRecurringPush([rule()], t, f.deps)
    const bookedAt = f.deps.now()
    expect(recurringPushStatusOf(rule(), t, bookedAt + RECURRING_PUSH_LAPSE_MS - 1)).toBe('push')
    expect(recurringPushStatusOf(rule(), t, bookedAt + RECURRING_PUSH_LAPSE_MS)).toBe('pending')
  })

  it('a successful booking after the lapse puts it back on push', async () => {
    const f = fakeDeps()
    await reconcileRecurringPush([rule()], t, f.deps)
    f.advance(91 * DAY)
    const report = await reconcileRecurringPush([rule()], t, f.deps)
    expect(f.booked).toHaveLength(2)
    expect(report.statuses[A]).toBe('push')
    expect(recurringPushStatusOf(rule(), t, f.deps.now())).toBe('push')
  })
})

describe('what the line under a rule may say', () => {
  const granted = { permission: 'granted' as const, inTab: true }

  async function withStatus(readiness: PushReadiness, book: RecurringPushCallResult = { ok: true }) {
    await reconcileRecurringPush([rule()], t, fakeDeps({ readiness, book: [book] }).deps)
  }

  it('booked and allowed: alerts with ParkProof closed', async () => {
    await withStatus('ready')
    expect(recurringAlertReach(rule(), t, granted)).toBe('closed')
    // Android, where in-tab alerts can't show: push still reaches it.
    expect(recurringAlertReach(rule(), t, { permission: 'granted', inTab: false })).toBe('closed')
  })

  it('booked, then notifications revoked: push is silenced too, so nothing alerts', async () => {
    await withStatus('ready')
    expect(recurringAlertReach(rule(), t, { permission: 'denied', inTab: false })).toBe('none')
  })

  it('no push, but this browser alerts from an open tab: only while open', async () => {
    await withStatus('unsupported')
    expect(recurringAlertReach(rule(), t, granted)).toBe('open_only')
  })

  it('no push and no in-tab alerts: says nothing can alert, never "while open"', async () => {
    // iPhone Safari outside the Home Screen app (no Notification API), a
    // dismissed prompt, a blocked one, and Android before push is booked.
    for (const env of [
      { permission: 'unsupported' as const, inTab: false },
      { permission: 'default' as const, inTab: false },
      { permission: 'denied' as const, inTab: false },
      { permission: 'granted' as const, inTab: false },
    ]) {
      resetRecurringPushForTests()
      localStorage.clear()
      await withStatus(env.permission === 'granted' ? 'ready' : 'not_allowed', { ok: false, reason: 'network' })
      expect(recurringAlertReach(rule(), t, env)).toBe('none')
    }
  })

  it('nothing to say for a paused rule, notifications off, or before the status is known', () => {
    expect(recurringAlertReach(rule(), t, granted)).toBeNull()
    expect(recurringAlertReach(rule({ paused: true }), t, granted)).toBeNull()
    expect(recurringAlertReach(rule({ push: false }), t, granted)).toBeNull()
  })

  it('reads in-tab support from the browser: Android refuses new Notification()', () => {
    class FakeNotification {
      static permission: NotificationPermission = 'granted'
    }
    vi.stubGlobal('Notification', FakeNotification)
    const ua = vi.spyOn(navigator, 'userAgent', 'get')
    ua.mockReturnValue('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36')
    expect(alertEnvironment()).toEqual({ permission: 'granted', inTab: false })
    ua.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17 Safari/605.1.15')
    expect(alertEnvironment()).toEqual({ permission: 'granted', inTab: true })
    FakeNotification.permission = 'default'
    expect(alertEnvironment()).toEqual({ permission: 'default', inTab: false })
    ua.mockRestore()
  })
})

describe('registering from the Save tap', () => {
  it('gives up after a while when no service worker ever becomes ready, so later passes still run', async () => {
    vi.useFakeTimers()
    try {
      class FakeNotification {
        static permission: NotificationPermission = 'granted'
      }
      vi.stubGlobal('Notification', FakeNotification)
      vi.stubGlobal('PushManager', class {})
      vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BKtestVapidKey')
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: { ready: new Promise(() => {}) },
      })
      const result = registerForRecurringPush()
      let settled: PushReadiness | null = null
      void result.then((r) => (settled = r))
      await vi.advanceTimersByTimeAsync(REGISTER_TIMEOUT_MS - 100)
      expect(settled).toBeNull()
      await vi.advanceTimersByTimeAsync(200)
      expect(settled).toBe('network')
    } finally {
      vi.useRealTimers()
      vi.unstubAllEnvs()
      delete (navigator as unknown as Record<string, unknown>).serviceWorker
    }
  })
})

describe('one pass at a time', () => {
  it('runs a change made during a pass once more afterwards, with the newest rules', async () => {
    let release: () => void = () => {}
    let inFlight = 0
    let maxInFlight = 0
    const booked: string[] = []
    const deps: RecurringPushDeps = {
      readiness: async () => 'ready',
      book: async (req) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        if (booked.length === 0) await new Promise<void>((r) => (release = r))
        booked.push(req.rule.start)
        inFlight--
        return { ok: true }
      },
      cancel: async () => ({ ok: true }),
      now: () => Date.now(),
    }
    const first = requestRecurringPushSync([rule()], t, deps)
    await Promise.resolve()
    void requestRecurringPushSync([rule({ start: '06:00' })], t, deps)
    void requestRecurringPushSync([rule({ start: '05:00' })], t, deps)
    await new Promise((r) => setTimeout(r, 0))
    release()
    await first
    expect(maxInFlight).toBe(1)
    // The first pass, then one more with the newest rules (06:00 was overtaken).
    expect(booked).toEqual(['07:00', '05:00'])
  })
})

describe('the two routes', () => {
  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  }

  it('books with this device id and the request', async () => {
    localStorage.setItem(DEVICE_ID_KEY, DEVICE)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { created: [{}, {}], skipped: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const req = recurringPushRequest(rule(), t)
    expect(await bookRecurringPush(req)).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/push\/recurring$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ device_id: DEVICE, ...JSON.parse(JSON.stringify(req)) })
  })

  it('maps the server answers', async () => {
    localStorage.setItem(DEVICE_ID_KEY, DEVICE)
    const req = recurringPushRequest(rule(), t)
    const cases: [Response, RecurringPushCallResult][] = [
      [jsonResponse(403, { error: 'ERR_NOT_OWNER' }), { ok: false, reason: 'not_owner' }],
      [jsonResponse(409, { error: 'ERR_NOT_SUBSCRIBED' }), { ok: false, reason: 'not_subscribed' }],
      [jsonResponse(429, { error: 'RATE_LIMITED' }), { ok: false, reason: 'rate_limited' }],
      [jsonResponse(500, { error: 'boom' }), { ok: false, reason: 'network' }],
      // A schedule the server couldn't create is not a booking.
      [jsonResponse(200, { created: [{}], skipped: [{ reason: 'scheduler error' }] }), { ok: false, reason: 'network' }],
    ]
    for (const [resp, want] of cases) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(resp))
      expect(await bookRecurringPush(req)).toEqual(want)
    }
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await bookRecurringPush(req)).toEqual({ ok: false, reason: 'network' })
  })

  it('cancels with this device id and the rule id', async () => {
    localStorage.setItem(DEVICE_ID_KEY, DEVICE)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { deleted: 2 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await cancelRecurringPush(A)).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/push\/recurring\/cancel$/)
    expect(JSON.parse(init.body as string)).toEqual({ device_id: DEVICE, rule_id: A })
  })

  it('sends no cancel from a browser without a device id (it owns no schedules)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await cancelRecurringPush(A)).toEqual({ ok: false, reason: 'no_device' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull()
  })

  it('remembers bookings under its own key', async () => {
    await reconcileRecurringPush([rule()], t, fakeDeps().deps)
    expect(Object.keys(JSON.parse(localStorage.getItem(RECURRING_PUSH_STATE_KEY) ?? '{}'))).toEqual([A])
  })
})
