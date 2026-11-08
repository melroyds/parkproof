/**
 * Street sweeping and weekly reminders: the calendar and zone maths both
 * sides share (T5a on the phone, T5b on the server), and the push plan the
 * server books with EventBridge Scheduler (T5b).
 *
 * No SDK imports: the browser imports this module too (src/lib/recurring.ts),
 * so "does this rule occur on this date" is one piece of code wherever it
 * runs. Types in recurring-schedule.d.ts.
 *
 * Every day and time of a rule is a wall-clock time in the rule's own IANA
 * zone ("Tuesday 7 am in Melbourne"). An occurrence is found on the zone's
 * calendar first and only then turned into an instant, so a 7 am sweep
 * stays at 7 am on both sides of a daylight saving change.
 *
 * Push (T5b). Each rule gets at most two EventBridge cron() schedules with
 * ScheduleExpressionTimezone set to the rule's zone: slot 0 for the
 * evening-before reminder, slot 1 for the one before it starts. Cron can
 * say "every Monday at 8 pm" but not "every second Monday" or "the first
 * Tuesday of the month", so fortnightly and monthly_nth rules fire every
 * week on their days and the dispatcher decides each time. It works out the
 * OCCURRENCE date (the fire time plus the reminder's lead, on the rule
 * zone's wall clock) and asks occursOn(), never the fire date and never UTC:
 * the evening reminder for the first Tuesday of December fires on the last
 * day of November, and a 6:30 am Melbourne reminder fires on the previous
 * day in UTC.
 */
import { UUID_RE } from './addendum-schema.js'

export const WEEKDAYS = Object.freeze(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])
export const RECURRING_FREQUENCIES = Object.freeze(['weekly', 'fortnightly', 'monthly_nth'])
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000
const MINUTES_PER_DAY = 24 * 60
// Control characters, bidi overrides and line separators: never in text a
// notification shows.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g

// ── Zone maths ───────────────────────────────────────────────────────────

const formatters = new Map()

function formatterFor(timeZone) {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(timeZone, f)
  }
  return f
}

/**
 * The runtime's canonical spelling of a zone name ("australia/melbourne" is
 * "Australia/Melbourne"), so what the server books with EventBridge is a
 * name it knows. Assumes isValidTimeZone(timeZone).
 */
export function canonicalTimeZone(timeZone) {
  return formatterFor(timeZone).resolvedOptions().timeZone || timeZone
}

/** True when the runtime knows this IANA zone name. */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) return false
  try {
    formatterFor(timeZone)
    return true
  } catch {
    return false
  }
}

/** The wall clock in `timeZone` at `instant` (to the minute). */
export function zonedWallClock(instant, timeZone) {
  const ms = typeof instant === 'number' ? instant : instant.getTime()
  const parts = formatterFor(timeZone).formatToParts(new Date(ms))
  const get = (type) => Number(parts.find((p) => p.type === type)?.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Some engines print midnight as 24 even with h23.
    hour: get('hour') % 24,
    minute: get('minute'),
  }
}

/** The zone's offset from UTC at `ms`, in ms (Melbourne in summer: +11 h). */
function zoneOffsetMs(ms, timeZone) {
  const w = zonedWallClock(ms, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)
  return asUtc - Math.floor(ms / 60_000) * 60_000
}

/**
 * The instant at which `timeZone`'s clocks show this wall-clock time.
 *  - A time that happens twice (the hour repeated when daylight saving
 *    ends) gives the earlier instant, so a reminder is never late.
 *  - A time that never happens (the hour skipped when it starts) gives the
 *    instant the clocks jumped past it, shifted forward by the gap: 2:30 am
 *    on a 2 am to 3 am jump is 3:30 am.
 */
export function zonedWallClockToUtc(w, timeZone) {
  const guess = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute)
  const before = zoneOffsetMs(guess - DAY_MS, timeZone)
  const after = zoneOffsetMs(guess + DAY_MS, timeZone)
  const shows = (ms) => {
    const z = zonedWallClock(ms, timeZone)
    return z.year === w.year && z.month === w.month && z.day === w.day && z.hour === w.hour && z.minute === w.minute
  }
  const candidates = [...new Set([guess - before, guess - after])].filter(shows).sort((a, b) => a - b)
  if (candidates.length > 0) return new Date(candidates[0])
  // In the gap: read with the offset in force before the jump.
  return new Date(guess - before)
}

/** 'YYYY-MM-DD' of `instant` on `timeZone`'s calendar. */
export function localDateInZone(instant, timeZone) {
  const w = zonedWallClock(instant, timeZone)
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`
}

function pad(n) {
  return n < 10 ? `0${n}` : String(n)
}

// ── Calendar maths (zone-free: a day number is days since 1970-01-01) ────

/** { year, month, day } of a real 'YYYY-MM-DD' date, else null. */
export function parseLocalDate(s) {
  const m = typeof s === 'string' ? DATE_RE.exec(s) : null
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return { year, month, day }
}

/** Days since 1970-01-01 of a 'YYYY-MM-DD' date. Throws on anything else. */
export function dayNumber(date) {
  const p = parseLocalDate(date)
  if (!p) throw new Error(`not a date: ${date}`)
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS)
}

/** The 'YYYY-MM-DD' date of a day number. */
export function dateOfDayNumber(n) {
  const d = new Date(n * DAY_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** The weekday of a day number (1970-01-01 was a Thursday). */
export function weekdayOfDayNumber(n) {
  return WEEKDAYS[(((n + 3) % 7) + 7) % 7]
}

/** The day number of the Monday that starts `n`'s week. */
function mondayOf(n) {
  return n - WEEKDAYS.indexOf(weekdayOfDayNumber(n))
}

/** Minutes after midnight of an 'HH:MM' time. */
export function minutesOfDay(hhmm) {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
}

/**
 * True when the rule has an occurrence on this local date (ignores
 * `paused`). Needs only days, frequency, nth and anchor_date:
 *  - never before anchor_date;
 *  - fortnightly: the anchor's week (Monday to Sunday) and every second
 *    week after it;
 *  - monthly_nth: the nth of that weekday in the month (1st = days 1 to 7).
 */
export function occursOn(rule, date) {
  const n = dayNumber(date)
  if (n < dayNumber(rule.anchor_date)) return false
  if (!rule.days.includes(weekdayOfDayNumber(n))) return false
  switch (rule.frequency) {
    case 'weekly':
      return true
    case 'fortnightly': {
      const weeks = (mondayOf(n) - mondayOf(dayNumber(rule.anchor_date))) / 7
      return weeks % 2 === 0
    }
    case 'monthly_nth': {
      const dayOfMonth = Number(date.slice(8, 10))
      return rule.nth.includes(Math.ceil(dayOfMonth / 7))
    }
    default:
      return false
  }
}

/**
 * Notification tag for one weekly reminder. The in-tab copy (T5a) and the
 * push copy (T5b) use this one formula with the same fire instant, so the
 * two copies of one reminder collapse into one alert.
 */
export function recurringReminderTag(ruleId, fireAt) {
  const ms = typeof fireAt === 'number' ? fireAt : fireAt.getTime()
  return `pp-r-${ruleId}-${ms}`
}

// ── Push schedules (T5b) ─────────────────────────────────────────────────

/** Every weekly reminder schedule name starts with this; it sits inside the IAM scope `parkproof-push-*`. */
export const RECURRING_PUSH_NAME_PREFIX = 'parkproof-push-r-'
/** EventBridge Scheduler's limit on a schedule name. */
export const SCHEDULE_NAME_MAX = 64
/** The reminders a rule can have, in slot order: slot 0 is the evening before, slot 1 before it starts. */
export const RECURRING_PUSH_REMINDERS = Object.freeze(['evening', 'before'])
export const RECURRING_PUSH_SLOTS = RECURRING_PUSH_REMINDERS.length
/** How long a booked weekly schedule lives. The app books again (replace-all) when it is opened. */
export const RECURRING_SCHEDULE_DAYS = 90
/** A "before it starts" reminder is still worth delivering this long after the start. */
export const RECURRING_STALE_AFTER_START_MS = 15 * 60 * 1000
/** Caps on the copy the phone sends (same as /push/schedule). */
export const RECURRING_COPY_CAPS = Object.freeze({ title: 120, body: 240, url: 256 })
/** The longest lead between a reminder and its start: the evening before can be 48 hours ahead. */
const MAX_LEAD_MINUTES = 2 * MINUTES_PER_DAY

/** The `rule_id`'s weekly schedules are owned per slot, like a record's `parkproof-push-{session_id}-{i}`. */
export function recurringScheduleName(ruleId, slot) {
  return `${RECURRING_PUSH_NAME_PREFIX}${ruleId}-${slot}`
}

/** Every name the rule's schedules can have. */
export function recurringScheduleNames(ruleId) {
  return Array.from({ length: RECURRING_PUSH_SLOTS }, (_, slot) => recurringScheduleName(ruleId, slot))
}

/** The topic key for a rule's pushes (one per rule, so the newest undelivered reminder replaces older ones). */
export function recurringTopicId(ruleId) {
  return `r-${ruleId}`
}

const CRON_DAYS = Object.freeze({ MO: 'MON', TU: 'TUE', WE: 'WED', TH: 'THU', FR: 'FRI', SA: 'SAT', SU: 'SUN' })

function shiftDayBack(day, by) {
  return WEEKDAYS[(WEEKDAYS.indexOf(day) - by + 7) % 7]
}

/**
 * The cron schedules a rule needs, one per reminder it has. Each fires on
 * the rule's days shifted back by the reminder's day shift, at a wall-clock
 * time in the rule's zone:
 *  - evening: `remind_evening_before` on the day before each rule day;
 *  - before: `start - remind_minutes_before`, on the day before when that
 *    goes past midnight (a 12:30 am start with an hour's notice is 11:30 pm).
 * `lead_minutes` is the wall-clock distance from the fire time to the
 * start, which the dispatcher adds back to find the occurrence date.
 */
export function recurringCronPlans(rule) {
  const start = minutesOfDay(rule.start)
  const plans = []
  if (rule.remind_evening_before) {
    const at = minutesOfDay(rule.remind_evening_before)
    plans.push({ slot: 0, reminder: 'evening', minuteOfDay: at, dayShift: 1, lead_minutes: start + MINUTES_PER_DAY - at })
  }
  if (rule.remind_minutes_before !== null && rule.remind_minutes_before !== undefined) {
    const raw = start - rule.remind_minutes_before
    const dayShift = raw < 0 ? 1 : 0
    plans.push({
      slot: 1,
      reminder: 'before',
      minuteOfDay: raw + dayShift * MINUTES_PER_DAY,
      dayShift,
      lead_minutes: rule.remind_minutes_before,
    })
  }
  return plans.map((p) => {
    const fireDays = WEEKDAYS.filter((d) => rule.days.some((day) => shiftDayBack(day, p.dayShift) === d))
    const hour = Math.floor(p.minuteOfDay / 60)
    const minute = p.minuteOfDay % 60
    return {
      slot: p.slot,
      name: recurringScheduleName(rule.id, p.slot),
      reminder: p.reminder,
      lead_minutes: p.lead_minutes,
      fire_days: fireDays,
      fire_time: `${pad(hour)}:${pad(minute)}`,
      expression: `cron(${minute} ${hour} ? * ${fireDays.map((d) => CRON_DAYS[d]).join(',')} *)`,
    }
  })
}

/**
 * The occurrence a reminder fired for: the fire time read on the rule
 * zone's wall clock, plus the reminder's lead in wall-clock minutes. The
 * date is the zone's calendar date, never the fire date or the UTC date.
 */
export function occurrenceDateForFire(fireMs, timeZone, leadMinutes) {
  const w = zonedWallClock(fireMs, timeZone)
  const fireDay = Math.round(Date.UTC(w.year, w.month - 1, w.day) / DAY_MS)
  const n = fireDay + Math.floor((w.hour * 60 + w.minute + leadMinutes) / MINUTES_PER_DAY)
  return { date: dateOfDayNumber(n), weekday: weekdayOfDayNumber(n) }
}

function cleanText(value, max) {
  if (typeof value !== 'string') return ''
  return value.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim()
}

function isNth(n) {
  return Number.isInteger(n) && n >= 1 && n <= 5
}

/**
 * The schedule part of a rule, checked. Only what the server needs to book
 * and decide: no label, address or end time (the phone sends the words).
 * Returns { ok: true, rule } or { ok: false, error }.
 */
export function parseRecurringRule(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'rule is required' }
  if (typeof raw.id !== 'string' || !UUID_RE.test(raw.id)) return { ok: false, error: 'rule.id must be a lowercase uuid' }
  if (!Array.isArray(raw.days) || raw.days.length === 0 || raw.days.some((d) => !WEEKDAYS.includes(d))) {
    return { ok: false, error: 'rule.days must list days from MO to SU' }
  }
  if (typeof raw.start !== 'string' || !HHMM_RE.test(raw.start)) return { ok: false, error: 'rule.start must be HH:MM' }
  if (!RECURRING_FREQUENCIES.includes(raw.frequency)) return { ok: false, error: 'rule.frequency is not known' }
  const nth = Array.isArray(raw.nth) ? raw.nth : []
  if (nth.some((n) => !isNth(n))) return { ok: false, error: 'rule.nth must be weeks 1 to 5' }
  if (raw.frequency === 'monthly_nth' && nth.length === 0) return { ok: false, error: 'rule.nth is required for monthly_nth' }
  if (!parseLocalDate(raw.anchor_date)) return { ok: false, error: 'rule.anchor_date must be YYYY-MM-DD' }
  if (!isValidTimeZone(raw.timezone)) return { ok: false, error: 'rule.timezone must be an IANA zone' }
  const evening = raw.remind_evening_before ?? null
  if (evening !== null && (typeof evening !== 'string' || !HHMM_RE.test(evening))) {
    return { ok: false, error: 'rule.remind_evening_before must be HH:MM or null' }
  }
  const minutes = raw.remind_minutes_before ?? null
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > MINUTES_PER_DAY)) {
    return { ok: false, error: 'rule.remind_minutes_before must be 1 to 1440 or null' }
  }
  return {
    ok: true,
    rule: {
      id: raw.id,
      days: WEEKDAYS.filter((d) => raw.days.includes(d)),
      start: raw.start,
      frequency: raw.frequency,
      nth: raw.frequency === 'monthly_nth' ? [...new Set(nth)].sort((a, b) => a - b) : [],
      anchor_date: raw.anchor_date,
      timezone: canonicalTimeZone(raw.timezone),
      remind_evening_before: evening,
      remind_minutes_before: minutes,
    },
  }
}

/**
 * The body of POST /push/recurring, checked (the handler checks device_id):
 *   { rule: { id, days, start, frequency, nth, anchor_date, timezone,
 *             remind_evening_before, remind_minutes_before },
 *     copy: { title, url, evening: { MO: body, ... } | null, before: {...} | null } }
 * The phone sends the notification words, already translated, one body per
 * reminder per rule day: the text names the day ("Street sweeping on
 * Tuesday"), so a Monday-and-Thursday rule has two. Text is cleaned and
 * capped like /push/schedule's. Returns { ok: true, rule, copy } or
 * { ok: false, error }.
 */
export function parseRecurringPushRequest(body) {
  const parsed = parseRecurringRule(body?.rule)
  if (!parsed.ok) return parsed
  const { rule } = parsed
  if (rule.remind_evening_before === null && rule.remind_minutes_before === null) {
    return { ok: false, error: 'the rule has no reminders (cancel instead)' }
  }
  const copy = body?.copy
  if (!copy || typeof copy !== 'object') return { ok: false, error: 'copy is required' }
  const title = cleanText(copy.title, RECURRING_COPY_CAPS.title) || 'ParkProof'
  const rawUrl = typeof copy.url === 'string' ? copy.url.trim() : ''
  // App-relative only: a notification never opens another site.
  const url = /^\/(?!\/)/.test(rawUrl) && rawUrl.length <= RECURRING_COPY_CAPS.url ? rawUrl : '/app/'
  const bodies = {}
  for (const reminder of RECURRING_PUSH_REMINDERS) {
    const wanted = reminder === 'evening' ? rule.remind_evening_before !== null : rule.remind_minutes_before !== null
    if (!wanted) continue
    const byDay = copy[reminder]
    if (!byDay || typeof byDay !== 'object') return { ok: false, error: `copy.${reminder} is required` }
    bodies[reminder] = {}
    for (const day of rule.days) {
      const text = cleanText(byDay[day], RECURRING_COPY_CAPS.body)
      if (!text) return { ok: false, error: `copy.${reminder}.${day} is required` }
      bodies[reminder][day] = text
    }
  }
  return { ok: true, rule, copy: { title, url, bodies } }
}

/**
 * The Target Input of one weekly schedule: what the dispatcher gets each
 * time it fires. `device_id` is the owner (spec N6, read back by
 * scheduleOwnerDeviceId). `scheduled_time` is EventBridge Scheduler's
 * context attribute, replaced with the fire time on every run, so the
 * dispatcher reads the intended fire time even when a retry runs late.
 */
export function recurringDispatchInput({ device_id, rule, copy, plan }) {
  return {
    _async_kind: 'push-recurring',
    device_id,
    rule_id: rule.id,
    slot: plan.slot,
    reminder: plan.reminder,
    lead_minutes: plan.lead_minutes,
    scheduled_time: '<aws.scheduler.scheduled-time>',
    rule: {
      days: rule.days,
      start: rule.start,
      frequency: rule.frequency,
      nth: rule.nth,
      anchor_date: rule.anchor_date,
      timezone: rule.timezone,
    },
    title: copy.title,
    url: copy.url,
    bodies: copy.bodies[plan.reminder],
  }
}

/**
 * What the dispatcher does with one firing of a weekly schedule. Pure.
 *   { send: false, reason }  'bad_input', 'no_occurrence' (an off week of a
 *                            fortnightly rule, a week of the month the rule
 *                            skips, or before its anchor date), 'no_copy',
 *                            'stale' (fired too late to be useful);
 *   { send: true, date, occurrence_start, message }  where message is the
 *                            handlePushDispatch event for the push.
 * The fire time is the schedule's scheduled_time; when that is missing or
 * unreadable, now (to the minute).
 */
export function recurringDispatchDecision(input, nowMs) {
  const parsed = parseRecurringRule({ ...input?.rule, id: input?.rule_id })
  if (!parsed.ok) return { send: false, reason: 'bad_input' }
  const { rule } = parsed
  const lead = input.lead_minutes
  if (!Number.isInteger(lead) || lead < 0 || lead > MAX_LEAD_MINUTES) return { send: false, reason: 'bad_input' }
  if (!RECURRING_PUSH_REMINDERS.includes(input.reminder)) return { send: false, reason: 'bad_input' }
  if (typeof input.device_id !== 'string' || !input.device_id) return { send: false, reason: 'bad_input' }

  const scheduledMs = typeof input.scheduled_time === 'string' ? Date.parse(input.scheduled_time) : NaN
  const fireMs = Number.isFinite(scheduledMs) ? scheduledMs : Math.floor(nowMs / 60_000) * 60_000
  const { date, weekday } = occurrenceDateForFire(fireMs, rule.timezone, lead)
  if (!occursOn(rule, date)) return { send: false, reason: 'no_occurrence', date }

  const body = input.bodies && typeof input.bodies === 'object' ? input.bodies[weekday] : undefined
  if (typeof body !== 'string' || !body) return { send: false, reason: 'no_copy', date }

  const p = parseLocalDate(date)
  const startMin = minutesOfDay(rule.start)
  const startMs = zonedWallClockToUtc(
    { year: p.year, month: p.month, day: p.day, hour: Math.floor(startMin / 60), minute: startMin % 60 },
    rule.timezone,
  ).getTime()
  // "Move the car tonight" is no use once it has started; the reminder
  // before the start (if any) carries on for a few minutes after it.
  const staleMs = input.reminder === 'evening' ? startMs : startMs + RECURRING_STALE_AFTER_START_MS
  if (nowMs >= staleMs) return { send: false, reason: 'stale', date }

  return {
    send: true,
    date,
    occurrence_start: new Date(startMs).toISOString(),
    message: {
      device_id: input.device_id,
      // Not a record: the rule's topic key. It gives the push one topic per
      // rule, and lets the service worker tidy this rule's older alerts.
      session_id: recurringTopicId(rule.id),
      title: cleanText(input.title, RECURRING_COPY_CAPS.title) || 'ParkProof',
      body: cleanText(body, RECURRING_COPY_CAPS.body),
      url: typeof input.url === 'string' && /^\/(?!\/)/.test(input.url) ? input.url.slice(0, RECURRING_COPY_CAPS.url) : '/app/',
      tag: recurringReminderTag(rule.id, fireMs),
      kind: 'recurring',
      stale_at: new Date(staleMs).toISOString(),
    },
  }
}
