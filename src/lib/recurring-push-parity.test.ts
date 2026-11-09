// Weekly reminders: push (T5b) against the phone's own reminders (T5a).
//
// For each rule, the request the phone builds is parsed by the server,
// turned into its cron schedules, and those are fired the way EventBridge
// Scheduler fires a cron() in a time zone (simulated below, independently
// of the production zone maths). Every firing goes through the dispatcher's
// decision. What it sends must be exactly the reminders the phone arms in
// the tab: the same instants, kinds, tags and words. The window covers
// both Melbourne daylight saving changes (4 Oct 2026, 4 Apr 2027) and the
// same months in Brisbane, which has none.
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from './i18n'
import type { RecurringRule } from '../types'
import { recurringReminderTag, upcomingReminderFires } from './recurring'
import { recurringNotificationCopy } from './recurring-copy'
import { recurringPushRequest } from './recurring-push'
import {
  parseRecurringPushRequest,
  recurringCronPlans,
  recurringDispatchDecision,
  recurringDispatchInput,
} from '../../lambda/recurring-schedule.js'

const DEVICE = '11111111-1111-4111-8111-111111111111'
const DAY = 86_400_000

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

function rule(overrides: Partial<RecurringRule>): RecurringRule {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    label: '',
    kind: 'street_cleaning',
    days: ['MO'],
    start: '07:00',
    end: '09:00',
    frequency: 'weekly',
    nth: [],
    anchor_date: '2026-08-01',
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

// ── An EventBridge Scheduler cron(), simulated ──────────────────────────
// Wall-clock time in the schedule's zone. Per the Scheduler docs, a time
// the clocks skip (spring forward) is not run that day, and a time that
// happens twice (fall back) runs once: the first time.

const wallFormatters = new Map<string, Intl.DateTimeFormat>()
function wallOf(ms: number, tz: string): string {
  let f = wallFormatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    wallFormatters.set(tz, f)
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}`
}

/** Every instant at which `tz` shows this date and time (0, 1 or 2 of them). */
function instantsShowing(date: string, hh: number, mm: number, tz: string): number[] {
  const [y, m, d] = date.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d, hh, mm)
  const want = `${date} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  const out = new Set<number>()
  for (let offsetMin = -14 * 60; offsetMin <= 14 * 60; offsetMin += 15) {
    const ms = naive - offsetMin * 60_000
    if (wallOf(ms, tz) === want) out.add(ms)
  }
  return [...out].sort((a, b) => a - b)
}

const CRON_DAY: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }

function eventBridgeFires(expression: string, tz: string, fromDate: string, days: number): number[] {
  const m = /^cron\((\d{1,2}) (\d{1,2}) \? \* ([A-Z,]+) \*\)$/.exec(expression)
  if (!m) throw new Error(`unexpected cron ${expression}`)
  const minute = Number(m[1])
  const hour = Number(m[2])
  const dows = new Set(m[3].split(',').map((d) => CRON_DAY[d]))
  const [y, mo, d] = fromDate.split('-').map(Number)
  const fires: number[] = []
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.UTC(y, mo - 1, d + i))
    if (!dows.has(day.getUTCDay())) continue
    const date = day.toISOString().slice(0, 10)
    const at = instantsShowing(date, hour, minute, tz)
    if (at.length > 0) fires.push(at[0])
  }
  return fires
}

interface Fire {
  at: number
  kind: string
  tag: string
  body: string
}

const key = (f: Fire) => `${new Date(f.at).toISOString()} ${f.kind}`

/** What the server's schedules send between `from` and `to`. */
function serverFires(r: RecurringRule, from: number, to: number): Fire[] {
  const t = i18n.t.bind(i18n)
  const parsed = parseRecurringPushRequest({ device_id: DEVICE, ...recurringPushRequest(r, t) })
  if (!parsed.ok) throw new Error(parsed.error)
  const out: Fire[] = []
  const fromDate = new Date(from - 3 * DAY).toISOString().slice(0, 10)
  const days = Math.ceil((to - from) / DAY) + 6
  for (const plan of recurringCronPlans(parsed.rule)) {
    const input = recurringDispatchInput({ device_id: DEVICE, rule: parsed.rule, copy: parsed.copy, plan })
    for (const at of eventBridgeFires(plan.expression, r.timezone, fromDate, days)) {
      if (at <= from || at > to) continue
      // Delivered a few seconds after the scheduled time, as EventBridge does.
      const decision = recurringDispatchDecision({ ...input, scheduled_time: new Date(at).toISOString() }, at + 5_000)
      if (decision.send) out.push({ at, kind: plan.reminder, tag: decision.message.tag, body: decision.message.body })
    }
  }
  return out.sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind))
}

/** What the phone arms in the tab between `from` and `to` (in 20-day windows, as it re-arms). */
function deviceFires(r: RecurringRule, from: number, to: number): Fire[] {
  const t = i18n.t.bind(i18n)
  const seen = new Map<string, Fire>()
  for (let now = from; now < to; now += 20 * DAY) {
    for (const f of upcomingReminderFires(r, now, Math.min(20 * DAY, to - now))) {
      const fire = {
        at: f.fireAt.getTime(),
        kind: f.kind,
        tag: recurringReminderTag(r.id, f.fireAt),
        body: recurringNotificationCopy(r, f.occurrence, f.kind, t).body,
      }
      seen.set(key(fire), fire)
    }
  }
  return [...seen.values()].sort((a, b) => a.at - b.at || a.kind.localeCompare(b.kind))
}

const FROM = Date.parse('2026-09-01T00:00:00Z')
const TO = Date.parse('2027-05-15T00:00:00Z')

function expectParity(r: RecurringRule): Fire[] {
  const device = deviceFires(r, FROM, TO)
  const server = serverFires(r, FROM, TO)
  expect(server.map(key)).toEqual(device.map(key))
  expect(server.map((f) => f.tag)).toEqual(device.map((f) => f.tag))
  expect(server.map((f) => f.body)).toEqual(device.map((f) => f.body))
  expect(device.length).toBeGreaterThan(0)
  return server
}

const localTimes = (fires: Fire[], tz: string) => new Set(fires.map((f) => wallOf(f.at, tz).slice(11)))

describe('push and on-device reminders fire together in Australia/Melbourne, across both changes', () => {
  const tz = 'Australia/Melbourne'

  it('weekly Monday sweep: the Sunday 8 pm reminder on both change days stays at 8 pm', () => {
    const fires = expectParity(rule({ timezone: tz }))
    // Same wall-clock times all year, so the UTC times moved by an hour twice.
    expect(localTimes(fires, tz)).toEqual(new Set(['20:00', '06:00']))
    const utcHours = new Set(fires.filter((f) => f.kind === 'evening').map((f) => new Date(f.at).getUTCHours()))
    expect(utcHours).toEqual(new Set([9, 10]))
    // The Sunday evenings of 4 Oct 2026 and 4 Apr 2027 are in the set.
    const sundays = fires.filter((f) => f.kind === 'evening').map((f) => wallOf(f.at, tz).slice(0, 10))
    expect(sundays).toContain('2026-10-04')
    expect(sundays).toContain('2027-04-04')
  })

  it('weekly Sunday 7 am: an occurrence on each change day itself', () => {
    const fires = expectParity(rule({ timezone: tz, days: ['SU'], start: '07:00', end: '08:00', remind_minutes_before: 30 }))
    const onChangeDays = fires.filter((f) => ['2026-10-04', '2027-04-04'].includes(wallOf(f.at, tz).slice(0, 10)))
    expect(onChangeDays.map((f) => wallOf(f.at, tz).slice(11))).toEqual(['06:30', '06:30'])
  })

  it('fortnightly from a change day: on weeks only, decided from the occurrence date', () => {
    const r = rule({
      timezone: tz,
      days: ['SU'],
      start: '07:00',
      end: '08:00',
      frequency: 'fortnightly',
      anchor_date: '2026-10-04',
      remind_evening_before: '21:00',
      remind_minutes_before: 120,
    })
    const fires = expectParity(r)
    const occurrenceDays = fires.filter((f) => f.kind === 'before').map((f) => wallOf(f.at, tz).slice(0, 10))
    expect(occurrenceDays[0]).toBe('2026-10-04')
    expect(occurrenceDays).toContain('2027-04-04')
    expect(occurrenceDays).not.toContain('2026-10-11')
    // Every second week: 14 days between consecutive occurrences.
    const gaps = occurrenceDays.slice(1).map((d, i) => (Date.parse(d) - Date.parse(occurrenceDays[i])) / DAY)
    expect(new Set(gaps)).toEqual(new Set([14]))
  })

  it('first and third Tuesday: the evening reminder for Tue 1 Dec fires on Mon 30 Nov', () => {
    const fires = expectParity(rule({ timezone: tz, days: ['TU'], frequency: 'monthly_nth', nth: [1, 3] }))
    const evenings = fires.filter((f) => f.kind === 'evening').map((f) => wallOf(f.at, tz))
    expect(evenings).toContain('2026-11-30 20:00')
    expect(evenings).not.toContain('2026-12-07 20:00')
    expect(evenings).toContain('2026-12-14 20:00')
  })

  it('first Sunday of the month, which is a change day in October and April', () => {
    expectParity(
      rule({ timezone: tz, days: ['SU'], start: '09:00', end: '11:00', frequency: 'monthly_nth', nth: [1] }),
    )
  })

  it('a start just after midnight: the reminder an hour before is the previous evening', () => {
    const fires = expectParity(
      rule({ timezone: tz, days: ['TU'], start: '00:30', end: '02:00', remind_evening_before: '19:00', remind_minutes_before: 60 }),
    )
    expect(localTimes(fires, tz)).toEqual(new Set(['19:00', '23:30']))
  })

  it('an overnight clearway and a reminder a day ahead on two days a week', () => {
    expectParity(rule({ timezone: tz, days: ['FR'], start: '22:00', end: '06:00', remind_evening_before: null, remind_minutes_before: 120 }))
    expectParity(
      rule({ timezone: tz, days: ['MO', 'TH'], start: '08:00', end: '10:00', remind_evening_before: null, remind_minutes_before: 24 * 60 }),
    )
  })
})

describe('push and on-device reminders fire together in Australia/Brisbane (no daylight saving)', () => {
  const tz = 'Australia/Brisbane'

  it('weekly: the same UTC time every week', () => {
    const fires = expectParity(rule({ timezone: tz }))
    const evenings = new Set(fires.filter((f) => f.kind === 'evening').map((f) => new Date(f.at).toISOString().slice(11)))
    expect(evenings).toEqual(new Set(['10:00:00.000Z']))
  })

  it('fortnightly and monthly_nth', () => {
    expectParity(rule({ timezone: tz, days: ['SU'], frequency: 'fortnightly', anchor_date: '2026-10-04', remind_minutes_before: 120 }))
    expectParity(rule({ timezone: tz, days: ['TU'], frequency: 'monthly_nth', nth: [1, 3] }))
    expectParity(rule({ timezone: tz, days: ['TU'], start: '00:30', end: '02:00', remind_minutes_before: 60 }))
  })
})

describe('the known gap: a before-start reminder whose lead crosses the 2 to 3 am change', () => {
  it('push runs on the wall clock (skipped hour: no run; repeated hour: the first one); the tab counts real minutes', () => {
    // First Sunday 3:30 am with an hour's notice. Twice a year the hour
    // before it crosses the change; every other month matches exactly.
    const r = rule({
      timezone: 'Australia/Melbourne',
      days: ['SU'],
      start: '03:30',
      end: '05:00',
      frequency: 'monthly_nth',
      nth: [1],
      remind_evening_before: null,
      remind_minutes_before: 60,
    })
    const device = deviceFires(r, FROM, TO).map(key)
    const server = serverFires(r, FROM, TO).map(key)
    const shared = device.filter((k) => server.includes(k))
    expect(shared.length).toBeGreaterThanOrEqual(6)
    // 4 Oct 2026: 2:30 am never happens, so EventBridge doesn't run; the tab
    // fires an hour before 3:30 am AEDT (1:30 am AEST, 15:30Z). 4 Apr 2027:
    // 2:30 am happens twice; EventBridge runs at the first (AEDT, 15:30Z),
    // the tab an hour before 3:30 am AEST (the second 2:30, 16:30Z).
    expect(device.filter((k) => !server.includes(k))).toEqual([
      '2026-10-03T15:30:00.000Z before',
      '2027-04-03T16:30:00.000Z before',
    ])
    expect(server.filter((k) => !device.includes(k))).toEqual(['2027-04-03T15:30:00.000Z before'])
  })
})
