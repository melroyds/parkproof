import type { TFunction } from 'i18next'

export function formatRelative(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/**
 * Locale-aware version of formatRelative. Same logic, but emits translated
 * strings via i18next. Callers pass `t` from useTranslation so this file
 * stays React-agnostic. Translation keys consumed: time.justNow,
 * time.minAgo (plural), time.hoursAgo (plural), time.yesterday,
 * time.daysAgo (plural).
 */
export function formatRelativeLocalized(ms: number, t: TFunction): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return t('time.minAgo', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('time.hoursAgo', { count: hours })
  const days = Math.round(hours / 24)
  if (days === 1) return t('time.yesterday')
  return t('time.daysAgo', { count: days })
}

const DEFAULT_TZ = 'Australia/Melbourne'

/**
 * "10:00 am" in the target timezone.
 */
function formatTime(d: Date, timeZone: string): string {
  return d.toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  })
}

/**
 * "Mon 18/05/2026" — abbreviated weekday + en-AU numeric date.
 * We compose manually because Intl.DateTimeFormat with weekday + numeric
 * date emits different separators on different runtimes ("Mon, 18/05/2026"
 * on some, "Mon., 18/05/2026" on others). Manual avoids the inconsistency.
 */
function formatDayDate(d: Date, timeZone: string): string {
  const weekday = d.toLocaleDateString('en-AU', { timeZone, weekday: 'short' })
  const numeric = d.toLocaleDateString('en-AU', { timeZone })
  return `${weekday} ${numeric}`
}

/**
 * Same-calendar-day check, in the target timezone. We compare the formatted
 * en-AU date strings rather than the JS local dates — the user might be in
 * a different timezone than the parking spot, and "today" should mean today
 * AT THE SPOT, which is the timezone we display everything else in.
 */
function isSameDay(a: Date, b: Date, timeZone: string): boolean {
  return (
    a.toLocaleDateString('en-AU', { timeZone }) ===
    b.toLocaleDateString('en-AU', { timeZone })
  )
}

export interface FormattedExpiry {
  /** "10:00 am" — always present. */
  time: string
  /** "Mon 18/05/2026" — only set when the expiry isn't on the same calendar day as `now`. */
  dayDate: string | null
  /** Convenience: "10:00 am" if today, "10:00 am, Mon 18/05/2026" otherwise. */
  combined: string
}

/**
 * Format an ISO timestamp into a human "Until …" / "Move by …" string,
 * including the day + date only when the moment isn't on today's calendar
 * day in the target timezone. Keeps short cases ("Until 3:45 pm") concise,
 * disambiguates long cases ("Until 10:00 am, Mon 18/05/2026") explicitly.
 */
export function formatExpiryAbsolute(
  isoOrDate: string | Date,
  options: { timeZone?: string; now?: Date } = {},
): FormattedExpiry {
  const tz = options.timeZone ?? DEFAULT_TZ
  const now = options.now ?? new Date()
  const expires = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate

  const time = formatTime(expires, tz)
  if (isSameDay(expires, now, tz)) {
    return { time, dayDate: null, combined: time }
  }
  const dayDate = formatDayDate(expires, tz)
  return { time, dayDate, combined: `${time}, ${dayDate}` }
}

/**
 * True when two moments fall on the same calendar day in `timeZone` (the
 * record's own zone, not the device's). False for an unknown zone or an
 * invalid time, so a caller then shows the full date rather than too little.
 */
export function isSameDayInZone(a: string | number | Date, b: string | number | Date, timeZone: string): boolean {
  const da = a instanceof Date ? a : new Date(a)
  const db = b instanceof Date ? b : new Date(b)
  if (!Number.isFinite(da.getTime()) || !Number.isFinite(db.getTime())) return false
  try {
    return isSameDay(da, db, timeZone)
  } catch {
    return false
  }
}

export interface FormatInZoneOptions {
  /** Add the year ("Sun 25 Oct 2026, 1:55 pm"). Default false. Ignored without the date. */
  withYear?: boolean
  /** Add the zone's short name ("... 1:55 pm AEDT"). Default true. */
  withZone?: boolean
  /**
   * Add the weekday, day and month. Default true. False gives only the time
   * ("1:55 pm AEDT"), for a line whose day is already shown next to it.
   */
  withDate?: boolean
}

/**
 * A moment as a person reads it in the record's own time zone (build spec
 * N5): "Sun 25 Oct, 1:55 pm AEDT", with the year when asked for. The zone
 * name is Intl's `timeZoneName: 'short'` for en-AU (AEST/AEDT, ACST/ACDT,
 * AWST, or "GMT+13" style outside Australia), so a time is never read in
 * the wrong zone, including either side of a DST change.
 *
 * Composed from Intl parts rather than `format()`, because runtimes differ
 * in the punctuation they put between the parts. Returns the input as text
 * when it isn't a valid time, so a bad value shows rather than vanishes.
 */
export function formatInZone(
  value: string | number | Date,
  timeZone: string,
  options: FormatInZoneOptions = {},
): string {
  const { withZone = true, withDate = true } = options
  const withYear = withDate && options.withYear === true
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return String(value)
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-AU', {
      timeZone,
      weekday: withDate ? 'short' : undefined,
      day: withDate ? 'numeric' : undefined,
      month: withDate ? 'short' : undefined,
      year: withYear ? 'numeric' : undefined,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: withZone ? 'short' : undefined,
    }).formatToParts(date)
  } catch {
    // An unknown zone name: fall back to the default zone rather than throw in a render.
    return timeZone === DEFAULT_TZ ? date.toISOString() : formatInZone(date, DEFAULT_TZ, options)
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  const time = `${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase()}`
  const zone = withZone ? ` ${part('timeZoneName')}` : ''
  if (!withDate) return `${time}${zone}`
  const day = `${part('weekday')} ${part('day')} ${part('month')}${withYear ? ` ${part('year')}` : ''}`
  return `${day}, ${time}${zone}`
}

/** A zone's wall clock at one moment, as numbers (month 1 to 12, hour 0 to 23). */
export interface ZonedClockReading {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>()

/** Throws RangeError for an unknown zone. */
function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = wallClockFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    wallClockFormatters.set(timeZone, f)
  }
  return f
}

/**
 * The clock in `timeZone` at `value`: the one place the app reads a zone's
 * wall clock (hourInZone here, wallClockAt in notice-match.ts). Some
 * engines print midnight as "24" even when asked for a 0 to 23 hour; that
 * reads as hour 0 here, so every caller sees the same midnight. Throws
 * RangeError for an unknown zone or an invalid time.
 */
export function wallClockInZone(value: string | number | Date, timeZone: string): ZonedClockReading {
  const date = value instanceof Date ? value : new Date(value)
  const parts = wallClockFormatter(timeZone).formatToParts(date)
  const num = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour: num('hour') % 24,
    minute: num('minute'),
    second: num('second'),
  }
}

/**
 * The zone's short name at a moment, as formatInZone prints it ("AEST",
 * "AEDT", "AWST"), or '' for an unknown zone or an invalid time. Two
 * moments with different names have a daylight saving change between them.
 */
export function zoneNameInZone(value: string | number | Date, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  try {
    return (
      new Intl.DateTimeFormat('en-AU', { timeZone, timeZoneName: 'short' })
        .formatToParts(date)
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    )
  } catch {
    return ''
  }
}

/**
 * The hour of the day (0 to 23) at `value` in the record's zone, not the
 * phone's: a scan in Perth reads as Perth time whatever zone the phone is
 * set to. Falls back to the default zone for an unknown zone name, and
 * returns null for an invalid time.
 */
export function hourInZone(value: string | number | Date, timeZone: string): number | null {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  let hour: number
  try {
    hour = wallClockInZone(date, timeZone).hour
  } catch {
    return timeZone === DEFAULT_TZ ? null : hourInZone(date, DEFAULT_TZ)
  }
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null
}

/**
 * Format a list of reminder fire-times for a single day into one prose line.
 * Most reminder bundles all fire in the 30-minute window before expiry, so
 * the common case is "all on the same day" — surface the day suffix once at
 * the end rather than repeating it inline.
 *
 *   today          → "9:30 am, 9:45 am"
 *   future day     → "9:30 am, 9:45 am on Mon 18/05/2026"
 *   mixed (rare)   → each time tagged with its day: "9:30 am (Mon 18/05/2026), 8:00 am (Tue 19/05/2026)"
 *
 * Pass `t` wherever the line is shown: the future-day join then comes from
 * `reminders.timesOnDay` in the reader's language. Without it the join is
 * the English " on ".
 */
export function formatReminderTimesLine(
  fireAtList: Date[],
  options: { timeZone?: string; now?: Date; t?: TFunction } = {},
): string {
  const tz = options.timeZone ?? DEFAULT_TZ
  const now = options.now ?? new Date()
  if (fireAtList.length === 0) return ''

  const sameDayAcrossAll = fireAtList.every((d, _i, all) => isSameDay(d, all[0], tz))
  if (sameDayAcrossAll) {
    const timeList = fireAtList.map((d) => formatTime(d, tz)).join(', ')
    if (isSameDay(fireAtList[0], now, tz)) return timeList
    const day = formatDayDate(fireAtList[0], tz)
    return options.t ? options.t('reminders.timesOnDay', { times: timeList, day }) : `${timeList} on ${day}`
  }
  // Cross-day reminder bundle — annotate each with its day-date for clarity.
  return fireAtList
    .map((d) => `${formatTime(d, tz)} (${formatDayDate(d, tz)})`)
    .join(', ')
}
