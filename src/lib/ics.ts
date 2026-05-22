import { createEvent } from 'ics'
import type { ParkingSession } from '../types'
import { sessionTimezone } from './timezone'

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

  const description = [
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

  // Absolute DATE-TIME triggers. The `ics` package types expect a 5-tuple
  // [Y, M, D, H, m] for absolute triggers (not a Date object), which the
  // existing utcParts helper already produces. The library serialises
  // each tuple as a VALUE=DATE-TIME VTRIGGER in UTC — every modern
  // calendar app (macOS, iOS, Google) handles these natively.
  const alarms = sorted.map((fireAt) => ({
    action: 'display' as const,
    description: `Check on your car${session.location?.address ? ` at ${session.location.address}` : ''}`,
    trigger: utcParts(fireAt),
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
