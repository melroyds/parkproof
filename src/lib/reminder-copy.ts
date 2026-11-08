import type { TFunction } from 'i18next'
import type { ParkingSession } from '../types'
import { formatExpiryAbsolute } from './time-format'
import { sessionTimezone } from './timezone'
import { isStandardLimitReminder, permitAdjustedUntil } from './permit-answer'

/**
 * Notification tag for one reminder. Same formula as pushReminderPlan() in
 * lambda/index.js: when the tab is open, the in-tab copy and the push copy
 * of the same reminder share a tag, so the second one replaces the first
 * instead of alerting twice. Different fire times get different tags, so
 * every reminder alerts (a reused tag replaces silently in Chrome).
 */
export function reminderTag(sessionId: string, fireAt: Date): string {
  return `pp-${sessionId}-${fireAt.getTime()}`
}

export interface ReminderCopy {
  title: string
  body: string
}

/**
 * Title and body for a reminder firing at `fireAt`.
 *
 * The body always names the absolute expiry time in the session's timezone
 * ("Your parking expires at 3:45 pm"), or, on a record whose permit allows
 * a later time, the permit time the driver entered. A push can arrive late;
 * a relative "15 min left" would then be wrong, while the absolute time
 * stays true. Title is the address, the most useful thing on a lock screen.
 */
export function reminderCopy(
  session: ParkingSession,
  fireAt: Date,
  t: TFunction,
): ReminderCopy {
  const timeZone = sessionTimezone(session.location)
  const title = session.location?.address || t('reminders.pushTitleFallback')

  if (session.no_sign || !session.expires_at) {
    const time = formatExpiryAbsolute(session.arrived_at, { timeZone, now: fireAt }).combined
    return { title, body: t('reminders.pushBodyCheckOn', { time }) }
  }

  // A permit the sign prints an exception for, with a later time the
  // driver read off the sign (T4 item 6): the reminders count down to that
  // permit time, and one more fires when the standard limit ends. The
  // permit time is the driver's own reading, so the copy says "the permit
  // time you entered", never that the parking expires then.
  const permitUntil = permitAdjustedUntil(session)
  if (permitUntil) {
    const time = formatExpiryAbsolute(permitUntil, { timeZone, now: fireAt }).combined
    if (isStandardLimitReminder(session, fireAt)) {
      return { title, body: t('reminders.permitStandardEnds', { time }) }
    }
    const minsBefore = Math.round((Date.parse(permitUntil) - fireAt.getTime()) / 60_000)
    if (minsBefore <= 0) return { title, body: t('reminders.permitBodyAt', { time }) }
    return { title, body: t('reminders.permitBodyBefore', { time, count: minsBefore }) }
  }

  const expires = new Date(session.expires_at)
  const time = formatExpiryAbsolute(expires, { timeZone, now: fireAt }).combined
  const minsBefore = Math.round((expires.getTime() - fireAt.getTime()) / 60_000)
  if (minsBefore <= 0) {
    return { title, body: t('reminders.pushBodyAtExpiry', { time }) }
  }
  return { title, body: t('reminders.pushBodyBefore', { time, count: minsBefore }) }
}
