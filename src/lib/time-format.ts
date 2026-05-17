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
 * time.minAgo (plural), time.hourAgo (plural), time.hoursAgo (plural),
 * time.yesterday, time.daysAgo (plural).
 */
export function formatRelativeLocalized(ms: number, t: TFunction): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return t('time.minAgo', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return hours === 1
      ? t('time.hourAgo', { count: hours })
      : t('time.hoursAgo', { count: hours })
  }
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
