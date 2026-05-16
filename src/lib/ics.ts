import { createEvent } from 'ics'
import type { ParkingSession } from '../types'

// Event covers the expiry moment plus a short tail so calendars don't display
// it as zero-length. The actual alarms come from the VALARM blocks below.
const EVENT_DURATION_MINUTES = 10
// TODO: derive from session.location via tz-lookup for non-Melbourne sessions.
// Tracked alongside the same hard-code in ParkingResult/SessionDetail/ReminderOptions.
const DISPLAY_TIMEZONE = 'Australia/Melbourne'

function utcParts(d: Date): [number, number, number, number, number] {
  return [
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
  ]
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
 */
export function downloadIcs(session: ParkingSession, offsetsMinutes: number[]): void {
  if (!session.expires_at) {
    throw new Error('This session has no expiry time — nothing to remind about.')
  }
  if (offsetsMinutes.length === 0) {
    throw new Error('Pick at least one reminder time before downloading.')
  }

  const expires = new Date(session.expires_at)
  const endAt = new Date(expires.getTime() + EVENT_DURATION_MINUTES * 60 * 1000)

  const expiresLabel = expires.toLocaleString('en-AU', {
    timeZone: DISPLAY_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })

  // Sort descending so calendars that render alarms in property order show the
  // earliest (longest lead time) first.
  const sortedOffsets = [...offsetsMinutes].sort((a, b) => b - a)

  const description = [
    `Your parking expires at ${expiresLabel} (Melbourne).`,
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
    trigger: { minutes: offset, before: true },
  }))

  const { error, value } = createEvent({
    title: 'ParkProof — Parking expires 🚗',
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

  const blob = new Blob([value], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `parkproof-${session.id.slice(0, 8)}.ics`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
