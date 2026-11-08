/**
 * Street sweeping and weekly reminders (T5a): the pure maths and data rules.
 *
 * Every day and time of a rule is a wall-clock time in the rule's own IANA
 * zone ("Tuesday 7 am in Melbourne"), so an occurrence is found on the
 * zone's calendar first and only then turned into an instant. That keeps a
 * 7 am sweep at 7 am on both sides of a daylight saving change. No React,
 * no storage, no i18n here (copy lives in recurring-copy.ts).
 */
import type { RecurringFrequency, RecurringRestriction, RecurringRule, Weekday } from '../types'
import { UUID_RE } from '../../lambda/addendum-schema.js'
// The calendar and zone maths live in a plain-JS module the server's push
// dispatcher (T5b) imports too, so "does this rule occur on this date" is
// one piece of code on both sides.
import {
  WEEKDAYS as SHARED_WEEKDAYS,
  dateOfDayNumber,
  dayNumber,
  isValidTimeZone,
  localDateInZone,
  HHMM_RE,
  minutesOfDay,
  occursOn as sharedOccursOn,
  parseLocalDate,
  recurringReminderTag as sharedReminderTag,
  weekdayOfDayNumber,
  zonedWallClock,
  zonedWallClockToUtc,
} from '../../lambda/recurring-schedule.js'

export { isValidTimeZone, localDateInZone, zonedWallClock, zonedWallClockToUtc }

export const WEEKDAYS: readonly Weekday[] = SHARED_WEEKDAYS
export const RECURRING_KINDS: readonly RecurringRule['kind'][] = ['street_cleaning', 'clearway', 'no_stopping', 'other']
export const RECURRING_FREQUENCIES: readonly RecurringFrequency[] = ['weekly', 'fortnightly', 'monthly_nth']
/** Weeks of the month a monthly_nth rule can pick (5 = the fifth, which some months don't have). */
export const NTH_VALUES = [1, 2, 3, 4, 5] as const
/** The "before it starts" choices the editor offers, in minutes. */
export const MINUTES_BEFORE_OPTIONS = [15, 30, 60, 120] as const
export const LABEL_MAX = 60
export const ADDRESS_MAX = 200
/** Default evening-before time for a restriction that starts in the morning. */
export const DEFAULT_EVENING_TIME = '20:00'
export const DEFAULT_MINUTES_BEFORE = 60

const DAY_MS = 86_400_000
// Control characters, bidi overrides and line separators: never in a label
// or an address (they end up in notifications and calendar files).
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g

/** One occurrence of a rule: when it starts and ends, and its local date in the rule's zone. */
export interface Occurrence {
  start: Date
  end: Date
  /** 'YYYY-MM-DD' in the rule's zone. */
  date: string
  weekday: Weekday
}

export type ReminderKind = 'evening' | 'before'

export interface ReminderFire {
  ruleId: string
  kind: ReminderKind
  fireAt: Date
  occurrence: Occurrence
}

// ── Zone and calendar maths (shared with the server: lambda/recurring-schedule.js) ──

/** Today's date on `timeZone`'s calendar. */
export function todayInZone(timeZone: string, now: Date | number = Date.now()): string {
  return localDateInZone(now, timeZone)
}

function parseDate(s: string): { year: number; month: number; day: number } | null {
  return parseLocalDate(s)
}

function dateOf(n: number): string {
  return dateOfDayNumber(n)
}

function weekdayOf(n: number): Weekday {
  return weekdayOfDayNumber(n)
}

function minutesOf(hhmm: string): number {
  return minutesOfDay(hhmm)
}

/** True when the rule has an occurrence on this local date (ignores `paused`). */
export function occursOn(rule: RecurringRule, date: string): boolean {
  return sharedOccursOn(rule, date)
}

/** The occurrence on local date `date`, whether or not the rule occurs that day. */
function occurrenceOn(rule: RecurringRule, n: number): Occurrence {
  const date = dateOf(n)
  const p = parseDate(date)!
  const startMin = minutesOf(rule.start)
  const endMin = minutesOf(rule.end)
  const start = zonedWallClockToUtc(
    { year: p.year, month: p.month, day: p.day, hour: Math.floor(startMin / 60), minute: startMin % 60 },
    rule.timezone,
  )
  // An end at or before the start is on the next day ("10 pm to 6 am").
  const endDay = endMin <= startMin ? parseDate(dateOf(n + 1))! : p
  const end = zonedWallClockToUtc(
    { year: endDay.year, month: endDay.month, day: endDay.day, hour: Math.floor(endMin / 60), minute: endMin % 60 },
    rule.timezone,
  )
  return { start, end, date, weekday: weekdayOf(n) }
}

/** How far ahead the occurrence search looks: a fifth Tuesday can be three months away. */
const SEARCH_DAYS = 400

/**
 * Occurrences that are still running or yet to start at `now` (end after
 * now), soonest first, at most `limit`. Ignores `paused`.
 */
export function upcomingOccurrences(rule: RecurringRule, now: Date | number, limit: number): Occurrence[] {
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const out: Occurrence[] = []
  // Start a day back: an overnight occurrence that began yesterday can still be running.
  const first = Math.max(dayNumber(localDateInZone(nowMs, rule.timezone)) - 1, dayNumber(rule.anchor_date))
  for (let n = first; n <= first + SEARCH_DAYS && out.length < limit; n++) {
    if (!occursOn(rule, dateOf(n))) continue
    const occ = occurrenceOn(rule, n)
    if (occ.end.getTime() > nowMs) out.push(occ)
  }
  return out
}

/** The occurrence running now or starting next, or null when there is none within a year. */
export function nextOccurrence(rule: RecurringRule, now: Date | number): Occurrence | null {
  return upcomingOccurrences(rule, now, 1)[0] ?? null
}

/** The first occurrence on or after the anchor date: the calendar event's DTSTART. */
export function firstOccurrence(rule: RecurringRule): Occurrence | null {
  const first = dayNumber(rule.anchor_date)
  for (let n = first; n <= first + SEARCH_DAYS; n++) {
    if (occursOn(rule, dateOf(n))) return occurrenceOn(rule, n)
  }
  return null
}

/**
 * Minutes between the evening-before reminder and the start: 8 pm the day
 * before a 7 am start is 11 hours. Null when the rule has no evening
 * reminder.
 */
export function eveningLeadMinutes(rule: RecurringRule): number | null {
  if (!rule.remind_evening_before) return null
  return minutesOf(rule.start) + (24 * 60 - minutesOf(rule.remind_evening_before))
}

/** When each of the rule's reminders fires for one occurrence. */
export function reminderFireTimes(rule: RecurringRule, occ: Occurrence): ReminderFire[] {
  const fires: ReminderFire[] = []
  if (rule.remind_evening_before) {
    // A wall-clock time on the day before, in the rule's zone (not a fixed
    // number of hours, which a daylight saving night would shift).
    const p = parseDate(dateOf(dayNumber(occ.date) - 1))!
    const m = minutesOf(rule.remind_evening_before)
    const fireAt = zonedWallClockToUtc(
      { year: p.year, month: p.month, day: p.day, hour: Math.floor(m / 60), minute: m % 60 },
      rule.timezone,
    )
    fires.push({ ruleId: rule.id, kind: 'evening', fireAt, occurrence: occ })
  }
  if (rule.remind_minutes_before !== null) {
    const fireAt = new Date(occ.start.getTime() - rule.remind_minutes_before * 60_000)
    fires.push({ ruleId: rule.id, kind: 'before', fireAt, occurrence: occ })
  }
  return fires
}

/**
 * Every reminder of a rule that fires after `now` and no later than
 * `now + horizonMs`, earliest first. None for a paused rule.
 */
export function upcomingReminderFires(rule: RecurringRule, now: Date | number, horizonMs: number): ReminderFire[] {
  if (rule.paused) return []
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const until = nowMs + horizonMs
  // An evening reminder fires up to ~2 days before its occurrence, so look
  // at occurrences up to two days past the horizon.
  const fires: ReminderFire[] = []
  for (const occ of upcomingOccurrences(rule, nowMs, 64)) {
    if (occ.start.getTime() > until + 2 * DAY_MS) break
    for (const f of reminderFireTimes(rule, occ)) {
      const at = f.fireAt.getTime()
      if (at > nowMs && at <= until) fires.push(f)
    }
  }
  return fires.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
}

/**
 * The soonest occurrence of any active rule that is running now or starts
 * within `windowMs` (the home row shows it inline within 24 hours). Paused
 * rules don't count.
 */
export function nextOccurrenceWithin(
  rules: readonly RecurringRule[],
  now: Date | number,
  windowMs: number,
): { rule: RecurringRule; occurrence: Occurrence } | null {
  const nowMs = typeof now === 'number' ? now : now.getTime()
  let best: { rule: RecurringRule; occurrence: Occurrence } | null = null
  for (const rule of rules) {
    if (rule.paused) continue
    const occ = nextOccurrence(rule, nowMs)
    if (!occ || occ.start.getTime() > nowMs + windowMs) continue
    if (!best || occ.start.getTime() < best.occurrence.start.getTime()) best = { rule, occurrence: occ }
  }
  return best
}

/**
 * Notification tag for one recurring reminder. The in-tab copy uses it, and
 * T5b's push dispatcher uses the same shared formula with the same fire
 * instant, so the two collapse into one alert when the app is open.
 */
export function recurringReminderTag(ruleId: string, fireAt: Date): string {
  return sharedReminderTag(ruleId, fireAt)
}

// ── Calendar file pieces ─────────────────────────────────────────────────

/** RRULE value for the rule: FREQ=WEEKLY;BYDAY=TU, INTERVAL=2, or FREQ=MONTHLY;BYDAY=1TU,3TU. */
export function rruleFor(rule: RecurringRule): string {
  const days = WEEKDAYS.filter((d) => rule.days.includes(d))
  switch (rule.frequency) {
    case 'weekly':
      return `FREQ=WEEKLY;BYDAY=${days.join(',')}`
    case 'fortnightly':
      // WKST=MO pins the week the interval counts in to the one
      // occursOn() uses (Monday to Sunday).
      return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${days.join(',')};WKST=MO`
    case 'monthly_nth': {
      const nths = [...rule.nth].sort((a, b) => a - b)
      return `FREQ=MONTHLY;BYDAY=${days.flatMap((d) => nths.map((n) => `${n}${d}`)).join(',')}`
    }
  }
}

/** A floating local date-time for a calendar file ('20261110T070000', no zone, no Z). */
export function floatingDateTime(date: string, hhmm: string): string {
  return `${date.replace(/-/g, '')}T${hhmm.replace(':', '')}00`
}

/** The day after a 'YYYY-MM-DD' date. */
export function nextDate(date: string): string {
  return dateOf(dayNumber(date) + 1)
}

// ── Validation ───────────────────────────────────────────────────────────

/** Fields whose change alters the calendar event, so an edit bumps `sequence`. */
const CALENDAR_FIELDS = [
  'label',
  'kind',
  'days',
  'start',
  'end',
  'frequency',
  'nth',
  'anchor_date',
  'timezone',
  'address',
  'remind_evening_before',
  'remind_minutes_before',
] as const satisfies readonly (keyof RecurringRule)[]

/**
 * True when two rules describe the same restriction at the same place: same
 * kind, days, times and repeat, and the same address (ignoring case and
 * spacing). The remind screen uses it not to offer a reminder the driver
 * already has.
 */
export function sameSchedule(a: RecurringRule, b: RecurringRule): boolean {
  const place = (r: RecurringRule) => (r.address ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  return (
    a.kind === b.kind &&
    a.start === b.start &&
    a.end === b.end &&
    a.frequency === b.frequency &&
    a.days.join() === b.days.join() &&
    a.nth.join() === b.nth.join() &&
    place(a) === place(b)
  )
}

/** True when `next` differs from `prev` in anything a calendar file carries. */
export function changesCalendar(prev: RecurringRule, next: RecurringRule): boolean {
  return CALENDAR_FIELDS.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]))
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim()
}

function cleanDays(value: unknown): Weekday[] {
  if (!Array.isArray(value)) return []
  return WEEKDAYS.filter((d) => value.includes(d))
}

function cleanNth(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return NTH_VALUES.filter((n) => value.includes(n))
}

/**
 * A stored or edited rule checked against the store's shape. Returns the
 * cleaned rule (days in MO..SU order, text trimmed, nth sorted and empty
 * unless monthly), or null when it can't be one: a bad id, zone, date or
 * time, no days, the same start and end, a monthly rule without weeks.
 */
export function normalizeRecurringRule(raw: unknown): RecurringRule | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !UUID_RE.test(r.id)) return null
  const kind = RECURRING_KINDS.includes(r.kind as RecurringRule['kind']) ? (r.kind as RecurringRule['kind']) : null
  const frequency = RECURRING_FREQUENCIES.includes(r.frequency as RecurringFrequency)
    ? (r.frequency as RecurringFrequency)
    : null
  if (!kind || !frequency) return null
  const days = cleanDays(r.days)
  if (days.length === 0) return null
  if (typeof r.start !== 'string' || !HHMM_RE.test(r.start)) return null
  if (typeof r.end !== 'string' || !HHMM_RE.test(r.end) || r.end === r.start) return null
  const nth = frequency === 'monthly_nth' ? cleanNth(r.nth) : []
  if (frequency === 'monthly_nth' && nth.length === 0) return null
  if (typeof r.anchor_date !== 'string' || !parseDate(r.anchor_date)) return null
  if (!isValidTimeZone(r.timezone)) return null
  const address = cleanText(r.address, ADDRESS_MAX)
  const evening = r.remind_evening_before
  if (evening !== null && evening !== undefined && (typeof evening !== 'string' || !HHMM_RE.test(evening))) return null
  const minutes = r.remind_minutes_before
  if (
    minutes !== null &&
    minutes !== undefined &&
    (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60)
  ) {
    return null
  }
  const sequence = typeof r.sequence === 'number' && Number.isInteger(r.sequence) && r.sequence >= 0 ? r.sequence : 0
  return {
    id: r.id,
    label: cleanText(r.label, LABEL_MAX),
    kind,
    days,
    start: r.start,
    end: r.end,
    frequency,
    nth,
    anchor_date: r.anchor_date,
    timezone: r.timezone,
    address: address || null,
    remind_evening_before: typeof evening === 'string' ? evening : null,
    remind_minutes_before: typeof minutes === 'number' ? minutes : null,
    push: r.push === true,
    paused: r.paused === true,
    sequence,
  }
}

/**
 * The weekly restrictions on a saved record or a sign result, checked:
 * T3 adds `recurring_restrictions` (model output) to both, so this reads it
 * as an optional, untrusted field. Entries without a valid day or time are
 * dropped. So is an entry whose week_of_month holds anything but the whole
 * numbers 1 to 5 (a "last week" -1, a 0): the offer would otherwise
 * describe the sign wrongly, as weekly or with fewer weeks, on the very
 * screen that asks the driver to check it against the sign.
 */
export function recurringRestrictionsOf(source: unknown): RecurringRestriction[] {
  if (!source || typeof source !== 'object') return []
  const list = (source as { recurring_restrictions?: unknown }).recurring_restrictions
  if (!Array.isArray(list)) return []
  const out: RecurringRestriction[] = []
  for (const item of list.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const days = cleanDays(r.days)
    if (days.length === 0) continue
    if (typeof r.start !== 'string' || !HHMM_RE.test(r.start)) continue
    if (typeof r.end !== 'string' || !HHMM_RE.test(r.end) || r.end === r.start) continue
    if (r.week_of_month !== undefined && r.week_of_month !== null && !Array.isArray(r.week_of_month)) continue
    const weeks: unknown[] = Array.isArray(r.week_of_month) ? r.week_of_month : []
    if (weeks.some((w) => !(NTH_VALUES as readonly unknown[]).includes(w))) continue
    out.push({
      kind: RECURRING_KINDS.includes(r.kind as RecurringRule['kind']) ? (r.kind as RecurringRule['kind']) : 'other',
      days,
      start: r.start,
      end: r.end,
      week_of_month: cleanNth(r.week_of_month),
      exceptions_text: cleanText(r.exceptions_text, 200),
      label: cleanText(r.label, LABEL_MAX),
    })
  }
  return out
}

/**
 * The first local date, today or later in `timeZone`, that falls on one of
 * `days`: the editor's default "date of the next one" for a fortnightly rule.
 */
export function nextDateOnDays(days: readonly Weekday[], timeZone: string, now: Date | number = Date.now()): string {
  const today = dayNumber(localDateInZone(now, timeZone))
  for (let n = today; n < today + 7; n++) {
    if (days.includes(weekdayOf(n))) return dateOf(n)
  }
  return dateOf(today)
}

/** The device's own zone, else Melbourne. */
export function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (isValidTimeZone(tz)) return tz
  } catch {
    /* fall through */
  }
  return 'Australia/Melbourne'
}

export interface NewRuleContext {
  timezone: string
  address: string | null
  now: Date | number
  id?: string
}

/**
 * Sensible starting values for a new rule. A restriction that starts in
 * the morning gets an evening-before reminder (move the car tonight); every
 * rule gets one an hour before it starts.
 */
export function defaultReminders(start: string): Pick<RecurringRule, 'remind_evening_before' | 'remind_minutes_before'> {
  return {
    remind_evening_before: minutesOf(start) < 12 * 60 ? DEFAULT_EVENING_TIME : null,
    remind_minutes_before: DEFAULT_MINUTES_BEFORE,
  }
}

/** A blank rule for the editor's "Add a weekly reminder": street sweeping, Monday 7 to 9 am. */
export function blankRule(ctx: NewRuleContext): RecurringRule {
  return {
    id: ctx.id ?? crypto.randomUUID(),
    label: '',
    kind: 'street_cleaning',
    days: ['MO'],
    start: '07:00',
    end: '09:00',
    frequency: 'weekly',
    nth: [],
    anchor_date: localDateInZone(ctx.now, ctx.timezone),
    timezone: ctx.timezone,
    address: ctx.address ? cleanText(ctx.address, ADDRESS_MAX) || null : null,
    ...defaultReminders('07:00'),
    push: true,
    paused: false,
    sequence: 0,
  }
}

/**
 * A new rule prefilled from a restriction the sign showed (the editor
 * opens with it, and asks the driver to check it against the sign). Weeks
 * of the month make it a monthly_nth rule; otherwise it repeats weekly.
 * The sign reading's label is model text in English: with
 * `labelFromSign: false` (a reader in another language) the rule is left
 * unnamed, so it shows under its translated kind.
 */
export function ruleFromRestriction(
  restriction: RecurringRestriction,
  ctx: NewRuleContext & { labelFromSign?: boolean },
): RecurringRule {
  const nth = cleanNth(restriction.week_of_month)
  return {
    ...blankRule(ctx),
    label: ctx.labelFromSign === false ? '' : cleanText(restriction.label, LABEL_MAX),
    kind: restriction.kind,
    days: cleanDays(restriction.days),
    start: restriction.start,
    end: restriction.end,
    frequency: nth.length > 0 ? 'monthly_nth' : 'weekly',
    nth,
    ...defaultReminders(restriction.start),
  }
}
