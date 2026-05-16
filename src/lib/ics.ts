import { createEvent } from 'ics'
import type { ParkingSession } from '../types'

const MINUTES_BEFORE_EXPIRY = 15
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

export function downloadIcs(session: ParkingSession): void {
  if (!session.expires_at) {
    throw new Error('This session has no expiry time — nothing to remind about.')
  }

  const expires = new Date(session.expires_at)
  const reminderAt = new Date(expires.getTime() - MINUTES_BEFORE_EXPIRY * 60 * 1000)
  const endAt = new Date(reminderAt.getTime() + EVENT_DURATION_MINUTES * 60 * 1000)

  const expiresLabel = expires.toLocaleString('en-AU', {
    timeZone: 'Australia/Melbourne',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })

  const description = [
    `Your parking expires at ${expiresLabel} (Melbourne).`,
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

  const { error, value } = createEvent({
    title: 'ParkProof — Move your car 🚗',
    description,
    location: locationField,
    geo: session.location
      ? { lat: session.location.lat, lon: session.location.lng }
      : undefined,
    start: utcParts(reminderAt),
    startInputType: 'utc',
    startOutputType: 'utc',
    end: utcParts(endAt),
    endInputType: 'utc',
    endOutputType: 'utc',
    alarms: [
      {
        action: 'display',
        description: 'Move your car — parking expires soon',
        trigger: { minutes: 0, before: true },
      },
    ],
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
