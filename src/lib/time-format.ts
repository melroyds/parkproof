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

export interface FormatInZoneOptions {
  /** Add the year ("Sun 25 Oct 2026, 1:55 pm"). Default false. */
  withYear?: boolean
  /** Add the zone's short name ("... 1:55 pm AEDT"). Default true. */
  withZone?: boolean
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
  const { withYear = false, withZone = true } = options
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return String(value)
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-AU', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
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
  const day = `${part('weekday')} ${part('day')} ${part('month')}${withYear ? ` ${part('year')}` : ''}`
  const time = `${part('hour')}:${part('minute')} ${part('dayPeriod').toLowerCase()}`
  return `${day}, ${time}${withZone ? ` ${part('timeZoneName')}` : ''}`
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
 */
export function formatReminderTimesLine(
  fireAtList: Date[],
  options: { timeZone?: string; now?: Date } = {},
): string {
  const tz = options.timeZone ?? DEFAULT_TZ
  const now = options.now ?? new Date()
  if (fireAtList.length === 0) return ''

  const sameDayAcrossAll = fireAtList.every((d, _i, all) => isSameDay(d, all[0], tz))
  if (sameDayAcrossAll) {
    const timeList = fireAtList.map((d) => formatTime(d, tz)).join(', ')
    if (isSameDay(fireAtList[0], now, tz)) return timeList
    return `${timeList} on ${formatDayDate(fireAtList[0], tz)}`
  }
  // Cross-day reminder bundle — annotate each with its day-date for clarity.
  return fireAtList
    .map((d) => `${formatTime(d, tz)} (${formatDayDate(d, tz)})`)
    .join(', ')
}
