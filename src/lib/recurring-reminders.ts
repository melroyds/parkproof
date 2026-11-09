/**
 * Weekly reminders on this device (T5a). While the app is open, every rule
 * with notifications on gets its next 24 hours of reminders armed through
 * the in-tab scheduler in notifications.ts. Re-arming replaces what was
 * armed before, so an edit, a pause or a delete takes effect at once.
 *
 * Push delivery with the app closed is T5b's: it registers the same fire
 * times with the server and must use `recurringReminderTag` so the two
 * copies of one reminder collapse into one alert.
 */
import type { TFunction } from 'i18next'
import type { RecurringRule } from '../types'
import { recurringReminderStaleAt, recurringTopicId } from '../../lambda/recurring-schedule.js'
import { recurringLink } from './deep-link'
import { disarmInTabNotificationsExcept, replaceInTabNotifications, type InTabNotification } from './notifications'
import { recurringReminderTag, upcomingReminderFires } from './recurring'
import { recurringNotificationCopy } from './recurring-copy'

/** In-tab timers are only reliable within a day, the same limit as the parking reminders. */
export const IN_TAB_HORIZON_MS = 24 * 60 * 60 * 1000
const OWNER_PREFIX = 'recurring:'

/**
 * The in-tab notifications one rule needs for the next `horizonMs`. None
 * when paused or notifications are off. Each carries what its push copy
 * carries (tag, link, topic) and the push copy's cut-off: a timer that runs
 * late still shows "Move the car tonight" until the restriction starts, and
 * the one before the start until just after it.
 */
export function inTabNotificationsFor(
  rule: RecurringRule,
  t: TFunction,
  now: number,
  horizonMs: number = IN_TAB_HORIZON_MS,
): InTabNotification[] {
  if (!rule.push || rule.paused) return []
  return upcomingReminderFires(rule, now, horizonMs).map((fire) => ({
    fireAt: fire.fireAt,
    ...recurringNotificationCopy(rule, fire.occurrence, fire.kind, t),
    tag: recurringReminderTag(rule.id, fire.fireAt),
    url: recurringLink(),
    topicId: recurringTopicId(rule.id),
    staleAt: new Date(recurringReminderStaleAt(fire.kind, fire.occurrence.start.getTime())),
  }))
}

/**
 * Arm the next 24 hours of reminders for every rule, replacing whatever
 * was armed for them, and disarm rules that are gone. Arms nothing unless
 * notifications are already allowed. Returns how many were armed.
 */
export function armRecurringInTabReminders(rules: readonly RecurringRule[], t: TFunction, now: number = Date.now()): number {
  const keep = new Set<string>()
  let armed = 0
  for (const rule of rules) {
    const owner = OWNER_PREFIX + rule.id
    keep.add(owner)
    armed += replaceInTabNotifications(owner, inTabNotificationsFor(rule, t, now), now)
  }
  disarmInTabNotificationsExcept(OWNER_PREFIX, keep)
  return armed
}

export type ReminderPermission = NotificationPermission | 'unsupported'

/**
 * Ask for notification permission when it hasn't been asked yet (call it
 * from a tap, such as Save with notifications on). Never asks twice.
 */
export async function ensureReminderPermission(): Promise<ReminderPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}
