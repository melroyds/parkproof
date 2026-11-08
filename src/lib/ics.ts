import { createEvent } from 'ics'
import type { TFunction } from 'i18next'
import type { ParkingSession, RecurringRule } from '../types'
import { sessionTimezone } from './timezone'
import { eveningLeadMinutes, firstOccurrence, floatingDateTime, nextDate, rruleFor } from './recurring'
import { recurringAlarmText, ruleSummary, ruleWhat } from './recurring-copy'

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

function offsetWord(offset: number): string {
  if (offset === 0) return 'at expiry'
  return `${offset} min before`
}

/**
 * Generate and download a .ics calendar event for the given session.
 *
 * One VEVENT anchored at `expires_at`, with one VALARM per offset. macOS,
 * iOS, and Google Calendar honour multiple VALARMs natively. Outlook only
 * fires the first one — that's a known limitation we accept rather than
 * emitting multiple competing events.
 *
 * `options.anchor` moves the event and its offsets off `expires_at` (T4: a
 * permit time the driver read off the sign). `options.extraAlarms` adds
 * alarms at fixed times with their own text (T4: every reminder of a
 * permit-adjusted record, the standard limit included); with them, the
 * offsets may be empty. `options.title` and `options.description` replace
 * the event's English title and description with the caller's translated
 * text (T4: the permit time is the driver's own reading, not an expiry).
 */
export function downloadIcs(
  session: ParkingSession,
  offsetsMinutes: number[],
  options: {
    anchor?: string | null
    extraAlarms?: Array<{ at: Date; description: string }>
    title?: string
    description?: string
  } = {},
): void {
  if (!session.expires_at) {
    throw new Error('This session has no expiry time — nothing to remind about.')
  }
  if (offsetsMinutes.length === 0 && (options.extraAlarms ?? []).length === 0) {
    throw new Error('Pick at least one reminder time before downloading.')
  }

  const expires = new Date(options.anchor ?? session.expires_at)
  const endAt = new Date(expires.getTime() + EVENT_DURATION_MINUTES * 60 * 1000)
  const timeZone = sessionTimezone(session.location)
  // City name from the IANA tz string ("Australia/Sydney" → "Sydney") for the
  // human description. Cheap and works for every region tz-lookup returns.
  const cityLabel = timeZone.split('/').pop()?.replace(/_/g, ' ') ?? timeZone

  const expiresLabel = expires.toLocaleString('en-AU', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })

  // Sort descending so calendars that render alarms in property order show the
  // earliest (longest lead time) first.
  const sortedOffsets = [...offsetsMinutes].sort((a, b) => b - a)

  const description =
    options.description ??
    [
      `Your parking expires at ${expiresLabel} (${cityLabel}).`,
      `Reminders: ${sortedOffsets.map(offsetWord).join(', ')}.`,
      `ParkProof session: ${session.id}`,
    ].join('\n')

  const mapsUrl = session.location
    ? `https://www.google.com/maps?q=${session.location.lat},${session.location.lng}`
    : null
  const locationField = session.location
    ? session.location.address
      ? `${session.location.address} (${mapsUrl})`
      : mapsUrl!
    : undefined

  const alarms = sortedOffsets.map((offset) => ({
    action: 'display' as const,
    description:
      offset === 0
        ? 'Parking expires now — move your car'
        : `Parking expires in ${offset} ${offset === 1 ? 'min' : 'mins'} — move your car`,
    // A zero relative offset serialises as "TRIGGER:-PT", which is not a
    // valid RFC 5545 duration, so the at-expiry alarm uses an absolute time.
    // As a timestamp: the `ics` package reads a date array in an alarm
    // trigger as the phone's local time (not UTC, unlike start and end), so
    // utcParts here put the alarm hours off on any phone east of UTC.
    trigger: offset === 0 ? expires.getTime() : { minutes: offset, before: true },
  }))
  for (const extra of options.extraAlarms ?? []) {
    alarms.push({ action: 'display' as const, description: extra.description, trigger: extra.at.getTime() })
  }

  const { error, value } = createEvent({
    title: options.title ?? 'ParkProof: Parking expires 🚗',
    description,
    location: locationField,
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

  if (error || !value) {
    throw error ?? new Error('Failed to generate calendar event')
  }

  saveIcsFile(value, `parkproof-${session.id.slice(0, 8)}.ics`)
}

/**
 * Generate and download an .ics for an OPEN-ENDED no-sign session.
 *
 * Unlike `downloadIcs`, there's no posted expiry to anchor the alarms
 * against — the driver is just choosing "remind me in N hours from now"
 * to come check on their car. We emit ONE VEVENT anchored at the EARLIEST
 * fire-at time (so the calendar shows one entry, not a clutter of N), and
 * one VALARM per fire-at using an absolute DATE-TIME trigger. macOS,
 * iOS, and Google Calendar honour absolute-trigger VALARMs natively;
 * Outlook only fires the first one (same known limitation as the
 * expiry-based path).
 */
export function downloadIcsAbsolute(session: ParkingSession, fireAtList: Date[]): void {
  if (fireAtList.length === 0) {
    throw new Error('Pick at least one reminder time before downloading.')
  }

  // Sort ascending so the earliest is the event anchor and the alarms
  // render in chronological order.
  const sorted = [...fireAtList].sort((a, b) => a.getTime() - b.getTime())
  const eventStart = sorted[0]
  const endAt = new Date(eventStart.getTime() + EVENT_DURATION_MINUTES * 60 * 1000)
  const timeZone = sessionTimezone(session.location)
  const cityLabel = timeZone.split('/').pop()?.replace(/_/g, ' ') ?? timeZone

  const fireAtLabels = sorted.map((d) =>
    d.toLocaleString('en-AU', {
      timeZone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }),
  )

  const description = [
    `Check on your car at ${session.location?.address ?? 'your parking spot'} (${cityLabel}).`,
    `Reminders: ${fireAtLabels.join(', ')}.`,
    `ParkProof session: ${session.id}`,
  ].join('\n')

  const mapsUrl = session.location
    ? `https://www.google.com/maps?q=${session.location.lat},${session.location.lng}`
    : null
  const locationField = session.location
    ? session.location.address
      ? `${session.location.address} (${mapsUrl})`
      : mapsUrl!
    : undefined

  // Absolute DATE-TIME triggers, written as VALUE=DATE-TIME in UTC, which
  // every modern calendar app (macOS, iOS, Google) handles natively. As a
  // timestamp, like downloadIcs: the `ics` package reads a date array in an
  // alarm trigger as the phone's local time (not UTC, unlike start and
  // end), so utcParts here would put every alarm hours early on any phone
  // east of UTC.
  const alarms = sorted.map((fireAt) => ({
    action: 'display' as const,
    description: `Check on your car${session.location?.address ? ` at ${session.location.address}` : ''}`,
    trigger: fireAt.getTime(),
  }))

  const { error, value } = createEvent({
    title: 'ParkProof — Check on your car 🚗',
    description,
    location: locationField,
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

  if (error || !value) {
    throw error ?? new Error('Failed to generate calendar event')
  }

  saveIcsFile(value, `parkproof-${session.id.slice(0, 8)}.ics`)
}

/**
 * RFC 5545 text escaping for VALARM descriptions, which the ics package
 * writes without escaping (it does escape SUMMARY, DESCRIPTION and
 * LOCATION itself).
 */
function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
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
  if (!first) throw new Error('This weekly reminder has no dates to add.')
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
  if (error || !value) throw error ?? new Error('Failed to generate calendar event')
  return value
}

/** Download the calendar file for a weekly reminder. */
export function downloadRecurringIcs(rule: RecurringRule, t: TFunction, language?: string): void {
  saveIcsFile(buildRecurringIcs(rule, t, language), `parkproof-weekly-${rule.id.slice(0, 8)}.ics`)
}
