import { createEvent } from 'ics'
import type { TFunction } from 'i18next'
import type { ParkingSession, RecurringRule } from '../types'
import { sessionTimezone } from './timezone'
import { eveningLeadMinutes, firstOccurrence, floatingDateTime, nextDate, rruleFor } from './recurring'
import { recurringAlarmText, ruleSummary, ruleWhat, zonePlace } from './recurring-copy'
import { reminderCopy } from './reminder-copy'
import { formatInZone, formatReminderTimesLine } from './time-format'

// Event covers the expiry moment plus a short tail so calendars don't display
// it as zero-length. The actual alarms come from the VALARM blocks below.
const EVENT_DURATION_MINUTES = 10

function utcParts(d: Date): [number, number, number, number, number] {
  return [
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
  ]
}

/** Hand a generated calendar file to the browser as a download. */
function saveIcsFile(value: string, filename: string): void {
  const blob = new Blob([value], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * RFC 5545 text escaping for VALARM descriptions, which the ics package
 * writes without escaping (it does escape SUMMARY, DESCRIPTION and
 * LOCATION itself). Translated alarm text can carry commas ("4:00 pm,
 * Tue 10/11/2026"), so every alarm description goes through this.
 */
function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
}

/** The calendar file couldn't be built: the reader's words, with the ics package's own error as the cause. */
function buildFailed(t: TFunction, cause: unknown): Error {
  return new Error(t('reminders.ics.buildFailed'), { cause })
}

/** The event's LOCATION: the address and a map link, or the map link alone. */
function locationField(session: ParkingSession): string | undefined {
  if (!session.location) return undefined
  const mapsUrl = `https://www.google.com/maps?q=${session.location.lat},${session.location.lng}`
  return session.location.address ? `${session.location.address} (${mapsUrl})` : mapsUrl
}

/**
 * Generate and download a .ics calendar event for the given session.
 *
 * One VEVENT anchored at `expires_at`, with one VALARM per offset. macOS,
 * iOS, and Google Calendar honour multiple VALARMs natively. Outlook only
 * fires the first one, a known limitation we accept rather than emitting
 * multiple competing events.
 *
 * Every word in the file is in the reader's language (`t`): the title, the
 * description (when the parking expires, where its times are local, the
 * reminder times, the record id) and each alarm's text, which is the same
 * text the push and in-tab reminder for that moment show (reminderCopy).
 *
 * `options.anchor` moves the event and its offsets off `expires_at` (T4: a
 * permit time the driver read off the sign). `options.extraAlarms` adds
 * alarms at fixed times with their own text (T4: every reminder of a
 * permit-adjusted record, the standard limit included); with them, the
 * offsets may be empty. `options.title` and `options.description` replace
 * the event's title and description with the caller's own translated text
 * (T4: the permit time is the driver's own reading, not an expiry).
 */
export function downloadIcs(
  session: ParkingSession,
  offsetsMinutes: number[],
  t: TFunction,
  options: {
    anchor?: string | null
    extraAlarms?: Array<{ at: Date; description: string }>
    title?: string
    description?: string
  } = {},
): void {
  if (!session.expires_at) {
    throw new Error(t('reminders.noExpiry'))
  }
  if (offsetsMinutes.length === 0 && (options.extraAlarms ?? []).length === 0) {
    throw new Error(t('reminders.calendarPickAtLeastOne'))
  }

  const expires = new Date(options.anchor ?? session.expires_at)
  const endAt = new Date(expires.getTime() + EVENT_DURATION_MINUTES * 60 * 1000)
  const timeZone = sessionTimezone(session.location)

  // Sort descending so calendars that render alarms in property order show the
  // earliest (longest lead time) first.
  const sortedOffsets = [...offsetsMinutes].sort((a, b) => b - a)
  const fireTimes = sortedOffsets.map((offset) => new Date(expires.getTime() - offset * 60 * 1000))

  const description =
    options.description ??
    [
      t('reminders.ics.expiresAt', {
        time: formatInZone(expires, timeZone, { withZone: false }),
        place: zonePlace(timeZone, t),
      }),
      t('reminders.ics.remindersAt', { times: formatReminderTimesLine(fireTimes, { timeZone, t }) }),
      t('reminders.ics.recordId', { id: session.id }),
    ].join('\n')

  const alarms = sortedOffsets.map((offset, i) => ({
    action: 'display' as const,
    description: escapeIcsText(reminderCopy(session, fireTimes[i], t).body),
    // A zero relative offset serialises as "TRIGGER:-PT", which is not a
    // valid RFC 5545 duration, so the at-expiry alarm uses an absolute time.
    // As a timestamp: the `ics` package reads a date array in an alarm
    // trigger as the phone's local time (not UTC, unlike start and end), so
    // utcParts here put the alarm hours off on any phone east of UTC.
    trigger: offset === 0 ? expires.getTime() : { minutes: offset, before: true },
  }))
  for (const extra of options.extraAlarms ?? []) {
    alarms.push({ action: 'display' as const, description: escapeIcsText(extra.description), trigger: extra.at.getTime() })
  }

  const { error, value } = createEvent({
    title: options.title ?? t('reminders.ics.expiresTitle'),
    description,
    location: locationField(session),
    geo: session.location ? { lat: session.location.lat, lon: session.location.lng } : undefined,
    start: utcParts(expires),
    startInputType: 'utc',
    startOutputType: 'utc',
    end: utcParts(endAt),
    endInputType: 'utc',
    endOutputType: 'utc',
    alarms,
    productId: 'parkproof',
    uid: `parkproof-${session.id}@parkproof.local`,
  })

  if (error || !value) throw buildFailed(t, error)

  saveIcsFile(value, `parkproof-${session.id.slice(0, 8)}.ics`)
}

/**
 * Generate and download an .ics for an OPEN-ENDED no-sign session.
 *
 * Unlike `downloadIcs`, there's no posted expiry to anchor the alarms
 * against: the driver is just choosing "remind me in N hours from now"
 * to come check on their car. We emit ONE VEVENT anchored at the EARLIEST
 * fire-at time (so the calendar shows one entry, not a clutter of N), and
 * one VALARM per fire-at using an absolute DATE-TIME trigger. macOS,
 * iOS, and Google Calendar honour absolute-trigger VALARMs natively;
 * Outlook only fires the first one (same known limitation as the
 * expiry-based path).
 *
 * The words are in the reader's language (`t`), and each alarm says what
 * the push and in-tab reminder at that moment say (reminderCopy).
 */
export function downloadIcsAbsolute(session: ParkingSession, fireAtList: Date[], t: TFunction): void {
  if (fireAtList.length === 0) {
    throw new Error(t('reminders.calendarPickAtLeastOne'))
  }

  // Sort ascending so the earliest is the event anchor and the alarms
  // render in chronological order.
  const sorted = [...fireAtList].sort((a, b) => a.getTime() - b.getTime())
  const eventStart = sorted[0]
  const endAt = new Date(eventStart.getTime() + EVENT_DURATION_MINUTES * 60 * 1000)
  const timeZone = sessionTimezone(session.location)
  const place = zonePlace(timeZone, t)
  const address = session.location?.address

  const description = [
    address ? t('reminders.ics.checkOnAt', { address, place }) : t('reminders.ics.checkOnHere', { place }),
    t('reminders.ics.remindersAt', { times: formatReminderTimesLine(sorted, { timeZone, t }) }),
    t('reminders.ics.recordId', { id: session.id }),
  ].join('\n')

  // Absolute DATE-TIME triggers, written as VALUE=DATE-TIME in UTC, which
  // every modern calendar app (macOS, iOS, Google) handles natively. As a
  // timestamp, like downloadIcs: the `ics` package reads a date array in an
  // alarm trigger as the phone's local time (not UTC, unlike start and
  // end), so utcParts here would put every alarm hours early on any phone
  // east of UTC.
  const alarms = sorted.map((fireAt) => ({
    action: 'display' as const,
    description: escapeIcsText(reminderCopy(session, fireAt, t).body),
    trigger: fireAt.getTime(),
  }))

  const { error, value } = createEvent({
    title: t('reminders.ics.checkOnTitle'),
    description,
    location: locationField(session),
    geo: session.location ? { lat: session.location.lat, lon: session.location.lng } : undefined,
    start: utcParts(eventStart),
    startInputType: 'utc',
    startOutputType: 'utc',
    end: utcParts(endAt),
    endInputType: 'utc',
    endOutputType: 'utc',
    alarms,
    productId: 'parkproof',
    uid: `parkproof-${session.id}-nosign@parkproof.local`,
  })

  if (error || !value) throw buildFailed(t, error)

  saveIcsFile(value, `parkproof-${session.id.slice(0, 8)}.ics`)
}

/** A duration in minutes as the ics package's { hours, minutes } (11 h, not 660 min). */
function leadDuration(minutes: number): { hours?: number; minutes?: number; before: true } {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return { ...(hours ? { hours } : {}), ...(rest ? { minutes: rest } : {}), before: true }
}

/**
 * The calendar file for a weekly reminder (T5a): one repeating event.
 *  - Floating local time (no zone, no Z): 7 am stays 7 am in the phone's
 *    calendar on both sides of a daylight saving change.
 *  - RRULE from the rule (FREQ=WEEKLY;BYDAY=TU, INTERVAL=2 for every second
 *    week, FREQ=MONTHLY;BYDAY=1TU,3TU), starting at the first occurrence
 *    on or after the rule's anchor date.
 *  - Relative alarms before each occurrence: the evening before and/or
 *    the chosen minutes before it starts.
 *  - A UID that is the same for every download of the rule and the rule's
 *    SEQUENCE, so a re-download after an edit updates the event instead
 *    of adding a second one.
 *  - Text in the reader's language, with the council and reliability notes.
 */
export function buildRecurringIcs(rule: RecurringRule, t: TFunction, language?: string): string {
  const first = firstOccurrence(rule)
  if (!first) throw new Error(t('recurring.ics.noDates'))
  const endDate = rule.end <= rule.start ? nextDate(first.date) : first.date

  const alarms: { action: 'display'; description: string; trigger: ReturnType<typeof leadDuration> }[] = []
  const evening = eveningLeadMinutes(rule)
  if (evening !== null) {
    alarms.push({ action: 'display', description: escapeIcsText(recurringAlarmText(rule, 'evening', t)), trigger: leadDuration(evening) })
  }
  if (rule.remind_minutes_before !== null) {
    alarms.push({
      action: 'display',
      description: escapeIcsText(recurringAlarmText(rule, 'before', t)),
      trigger: leadDuration(rule.remind_minutes_before),
    })
  }

  const description = [
    `${ruleSummary(rule, t, language)}.`,
    t('recurring.ics.move'),
    t('recurring.councilNote'),
    // The same reliability line as every reminder screen (ReminderHelp).
    t('reminders.reliability'),
    t('recurring.ics.footer'),
  ].join('\n')

  const { error, value } = createEvent({
    productId: 'parkproof',
    uid: `parkproof-recurring-${rule.id}@parkproof.local`,
    sequence: rule.sequence,
    title: ruleWhat(rule, t),
    description,
    location: rule.address ?? undefined,
    // Strings pass through the ics package as written: floating local times.
    start: floatingDateTime(first.date, rule.start),
    end: floatingDateTime(endDate, rule.end),
    recurrenceRule: rruleFor(rule),
    alarms,
    // A reminder, not a meeting: don't show the driver as busy.
    transp: 'TRANSPARENT',
    busyStatus: 'FREE',
  })
  if (error || !value) throw buildFailed(t, error)
  return value
}

/** Download the calendar file for a weekly reminder. */
export function downloadRecurringIcs(rule: RecurringRule, t: TFunction, language?: string): void {
  saveIcsFile(buildRecurringIcs(rule, t, language), `parkproof-weekly-${rule.id.slice(0, 8)}.ics`)
}
