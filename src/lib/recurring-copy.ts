/**
 * Words for street sweeping and weekly reminders (T5a): schedule lines,
 * notification text and calendar text, all through t(). Times are written
 * the way the rest of the app writes them ("7 am", "9:30 pm").
 */
import type { TFunction } from 'i18next'
import type { RecurringRule, Weekday } from '../types'
import {
  WEEKDAYS,
  deviceTimeZone,
  nextOccurrence,
  nextOccurrenceWithin,
  zonedWallClock,
  type Occurrence,
  type ReminderKind,
} from './recurring'
import { formatExpiryAbsolute, formatInZone } from './time-format'

/** "7 am", "9:30 am", "12 pm". With `suffix: false`, just "7" or "9:30". */
export function formatClock(hhmm: string, suffix = true): string {
  const h = Number(hhmm.slice(0, 2))
  const m = Number(hhmm.slice(3, 5))
  const hour12 = h % 12 === 0 ? 12 : h % 12
  const base = m === 0 ? String(hour12) : `${hour12}:${hhmm.slice(3, 5)}`
  return suffix ? `${base} ${h < 12 ? 'am' : 'pm'}` : base
}

/** "7 to 9 am", "11 am to 1 pm", "10 pm to 6 am". */
export function timeRangeText(start: string, end: string, t: TFunction): string {
  const samePeriod = Number(start.slice(0, 2)) < 12 === Number(end.slice(0, 2)) < 12 && end > start
  return t('recurring.timeRange', { start: formatClock(start, !samePeriod), end: formatClock(end) })
}

export function dayName(day: Weekday, t: TFunction): string {
  return t(`recurring.days.${day}`)
}

/** Join names the way the reader's language joins a list ("Monday and Thursday"). */
function listText(items: string[], language: string | undefined): string {
  if (items.length <= 1) return items[0] ?? ''
  try {
    return new Intl.ListFormat(language || 'en', { style: 'long', type: 'conjunction' }).format(items)
  } catch {
    return items.join(', ')
  }
}

/** "Tuesday", "Monday to Friday" (three or more days in a row), "Monday and Thursday". */
export function daysText(days: readonly Weekday[], t: TFunction, language?: string): string {
  const idx = WEEKDAYS.map((d, i) => (days.includes(d) ? i : -1)).filter((i) => i >= 0)
  if (idx.length >= 3 && idx[idx.length - 1] - idx[0] === idx.length - 1) {
    return t('recurring.dayRange', { from: dayName(WEEKDAYS[idx[0]], t), to: dayName(WEEKDAYS[idx[idx.length - 1]], t) })
  }
  return listText(
    idx.map((i) => dayName(WEEKDAYS[i], t)),
    language,
  )
}

/** The rule's own name, else its kind's ("Street sweeping"). */
export function ruleWhat(rule: Pick<RecurringRule, 'label' | 'kind'>, t: TFunction): string {
  return rule.label.trim() || t(`recurring.kind.${rule.kind}`)
}

/** "Every week on Tuesday", "Every second week on Tuesday", "The 1st and 3rd Tuesday of each month". */
export function scheduleText(
  rule: Pick<RecurringRule, 'days' | 'frequency' | 'nth'>,
  t: TFunction,
  language?: string,
): string {
  const days = daysText(rule.days, t, language)
  if (rule.frequency === 'monthly_nth') {
    const nths = listText(
      [...rule.nth].sort((a, b) => a - b).map((n) => t(`recurring.nth.n${n}`)),
      language,
    )
    return t('recurring.schedule.monthly_nth', { nths, days })
  }
  return t(`recurring.schedule.${rule.frequency}`, { days })
}

/** "Every week on Tuesday, 7 to 9 am". */
export function ruleSummary(rule: RecurringRule, t: TFunction, language?: string): string {
  return t('recurring.summary', {
    schedule: scheduleText(rule, t, language),
    range: timeRangeText(rule.start, rule.end, t),
  })
}

/**
 * Australian IANA zones (and their old alias names) to the place a reader
 * knows them by, each translated under recurring.zone.*. A zone name is a
 * code value, so it is never shown raw.
 */
const ZONE_PLACE_KEYS: Readonly<Record<string, string>> = {
  'Australia/Melbourne': 'melbourne',
  'Australia/Victoria': 'melbourne',
  'Australia/Sydney': 'sydney',
  'Australia/NSW': 'sydney',
  'Australia/Canberra': 'canberra',
  'Australia/ACT': 'canberra',
  'Australia/Brisbane': 'brisbane',
  'Australia/Queensland': 'brisbane',
  'Australia/Lindeman': 'lindeman',
  'Australia/Adelaide': 'adelaide',
  'Australia/South': 'adelaide',
  'Australia/Broken_Hill': 'brokenHill',
  'Australia/Yancowinna': 'brokenHill',
  'Australia/Darwin': 'darwin',
  'Australia/North': 'darwin',
  'Australia/Perth': 'perth',
  'Australia/West': 'perth',
  'Australia/Eucla': 'eucla',
  'Australia/Hobart': 'hobart',
  'Australia/Tasmania': 'hobart',
  'Australia/Currie': 'hobart',
  'Australia/Lord_Howe': 'lordHowe',
  'Australia/LHI': 'lordHowe',
}

/** The zone's short name ("AEDT", "GMT+1"), for a zone outside the map. */
function shortZoneName(timeZone: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-AU', { timeZone, timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')
    return part?.value || timeZone
  } catch {
    return timeZone
  }
}

/**
 * Where a rule's times are local, in the reader's language: "Melbourne"
 * for Australia/Melbourne, through recurring.zone.*; the zone's short
 * name ("GMT+1") for a zone outside Australia.
 */
export function zonePlace(timeZone: string, t: TFunction): string {
  const key = ZONE_PLACE_KEYS[timeZone]
  return key ? t(`recurring.zone.${key}`) : shortZoneName(timeZone)
}

/** True when a restriction starts before noon, so "move the car tonight" is the right advice. */
function startsInTheMorning(rule: RecurringRule): boolean {
  return Number(rule.start.slice(0, 2)) < 12
}

export interface RecurringNotificationCopy {
  title: string
  body: string
}

/**
 * The notification for one reminder of one occurrence. It names the day
 * and the times (a late alert stays true), and says what to do: "Street
 * sweeping on Tuesday, 7 to 9 am. Move the car tonight." The title is the
 * address when there is one, the most useful line on a lock screen. Only
 * the occurrence's weekday is read, so the push copy (T5b) can be written
 * ahead for each of the rule's days.
 */
export function recurringNotificationCopy(
  rule: RecurringRule,
  occurrence: Pick<Occurrence, 'weekday'>,
  kind: ReminderKind,
  t: TFunction,
): RecurringNotificationCopy {
  const what = ruleWhat(rule, t)
  const vars = {
    what,
    day: dayName(occurrence.weekday, t),
    range: timeRangeText(rule.start, rule.end, t),
    start: formatClock(rule.start),
  }
  const body =
    kind === 'evening' && startsInTheMorning(rule)
      ? t('recurring.notify.moveTonight', vars)
      : t('recurring.notify.moveBefore', vars)
  return { title: rule.address || what, body }
}

/** Calendar alarm text for each reminder kind (the same every week, so "tomorrow" rather than a day name). */
export function recurringAlarmText(rule: RecurringRule, kind: ReminderKind, t: TFunction): string {
  const vars = { what: ruleWhat(rule, t), range: timeRangeText(rule.start, rule.end, t), start: formatClock(rule.start) }
  if (kind === 'before') return t('recurring.ics.alarmSoon', vars)
  return startsInTheMorning(rule) ? t('recurring.ics.alarmTonight', vars) : t('recurring.ics.alarmTomorrow', vars)
}

/**
 * True when a moment in `timeZone` reads differently on this phone's clock,
 * so a time shown in that zone needs its zone name: 7 am in Melbourne seen
 * from Perth. A Sydney phone reading a Melbourne rule needs none.
 */
export function differsFromPhoneClock(instant: Date | number, timeZone: string): boolean {
  const device = deviceTimeZone()
  if (device === timeZone) return false
  const a = zonedWallClock(instant, timeZone)
  const b = zonedWallClock(instant, device)
  return a.year !== b.year || a.month !== b.month || a.day !== b.day || a.hour !== b.hour || a.minute !== b.minute
}

/** A rule's line in the list: "Next: Tue 10 Nov, 7:00 am", "On now, until 9 am", "Paused". */
export function ruleStatusText(rule: RecurringRule, now: number, t: TFunction): string {
  if (rule.paused) return t('recurring.paused')
  const occ = nextOccurrence(rule, now)
  if (!occ) return t('recurring.noNext')
  if (occ.start.getTime() <= now) return t('recurring.onNow', { time: formatClock(rule.end) })
  // The zone name only when the phone's clock would read the time
  // differently, so a Melbourne driver isn't told "AEDT" on every line.
  const time = formatInZone(occ.start, rule.timezone, { withZone: differsFromPhoneClock(occ.start, rule.timezone) })
  return t('recurring.next', { time })
}

/** The home row shows the next occurrence inline when it starts within this window. */
export const HOME_NEXT_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * The line under the home screen's "Street sweeping and weekly reminders"
 * row (T5a's words, in T4's home layout): when an active rule starts within
 * 24 hours (or is on now), its name and time; otherwise null.
 */
export function recurringHomeNext(rules: readonly RecurringRule[], now: number, t: TFunction): string | null {
  const soon = nextOccurrenceWithin(rules, now, HOME_NEXT_WINDOW_MS)
  if (!soon) return null
  const what = ruleWhat(soon.rule, t)
  const tz = soon.rule.timezone
  if (soon.occurrence.start.getTime() <= now) {
    return t('recurring.homeOnNow', { what, time: formatClock(soon.rule.end) })
  }
  return t('recurring.homeNext', {
    what,
    // The rule's own zone, named when the phone's clock reads it
    // differently (as in the list), so 7 am in Melbourne isn't read
    // as 7 am on a phone in Perth.
    time: differsFromPhoneClock(soon.occurrence.start, tz)
      ? formatInZone(soon.occurrence.start, tz, { withZone: true })
      : formatExpiryAbsolute(soon.occurrence.start, { timeZone: tz, now: new Date(now) }).combined,
  })
}

/** The home row's right-hand label: "None yet", "2 set". */
export function recurringHomeCount(rules: readonly RecurringRule[], t: TFunction): string {
  return rules.length === 0 ? t('recurring.homeNone') : t('recurring.homeCount', { count: rules.length })
}
