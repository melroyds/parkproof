import type { ParkingSession } from '../types'
import { reminderTag, type ReminderCopy } from './reminder-copy'

export type ScheduleStatus =
  | 'scheduled' // ≥1 alarm armed
  | 'denied' // user said no to the permission prompt
  | 'unsupported' // no Notification API on this browser
  | 'no-expiry' // session has no expiry time, nothing to remind about
  | 'all-past' // every selected offset is already in the past
  | 'all-too-far' // every selected offset is beyond setTimeout's safe horizon
  | 'nothing-selected' // caller passed an empty offset list

export interface ScheduleResult {
  status: ScheduleStatus
  /** Alarms actually armed via setTimeout. */
  scheduledCount: number
  /** Of the selected offsets, how many were skipped because they were already in the past. */
  pastCount: number
  /** Total offsets the caller asked us to schedule. */
  totalSelected: number
}

// setTimeout precision degrades dramatically past ~24h on most browsers, so we
// refuse anything further out and steer the user to the calendar option.
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000
// If a reminder would fire in under this many ms, treat it as past — avoids the
// awkward "scheduled… and it fired half a second later" UX.
const SAFETY_MARGIN_MS = 30 * 1000

// setTimeout handles per session, so "I've left" can disarm in-tab reminders.
interface ArmedTimer {
  handle: ReturnType<typeof setTimeout>
  /**
   * Set for timers armed by replaceInTabNotifications: the reminder's tag
   * and fire time, so a re-arm can keep a timer that is still wanted.
   */
  key?: string
  /** Its latest text, read when it fires (a re-arm can change the words). */
  item?: InTabNotification
}

const armed = new Map<string, ArmedTimer[]>()

function arm(ownerId: string, fn: (timer: ArmedTimer) => void, delay: number, extra: Omit<ArmedTimer, 'handle'> = {}): void {
  const timer: ArmedTimer = { ...extra, handle: undefined as unknown as ReturnType<typeof setTimeout> }
  timer.handle = setTimeout(() => {
    const left = (armed.get(ownerId) ?? []).filter((x) => x !== timer)
    if (left.length) armed.set(ownerId, left)
    else armed.delete(ownerId)
    fn(timer)
  }, delay)
  armed.set(ownerId, [...(armed.get(ownerId) ?? []), timer])
}

/** Disarm every in-tab reminder for a session (the driver has left). */
export function cancelInTabReminders(sessionId: string): number {
  return disarm(sessionId)
}

function disarm(ownerId: string): number {
  const timers = armed.get(ownerId) ?? []
  timers.forEach((x) => clearTimeout(x.handle))
  armed.delete(ownerId)
  return timers.length
}

/**
 * True when this browser can show a notification from an open tab right
 * now: the Notification API exists, permission is granted, and it isn't
 * Android, whose browsers refuse `new Notification()` (only a service
 * worker may show one there, which is what push does).
 */
export function canShowInTabNotifications(): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission !== 'granted') return false
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
  return !/Android/i.test(ua)
}

export interface InTabNotification {
  fireAt: Date
  title: string
  body: string
  /** Shared with the push copy of the same reminder, so the two collapse into one alert. */
  tag: string
}

const inTabKey = (item: InTabNotification) => `${item.tag}@${item.fireAt.getTime()}`

/**
 * Make the in-tab notifications armed for `ownerId` exactly `items`, on the
 * same timers as the parking reminders (nothing beyond 24 h). A reminder
 * that is already armed keeps its timer (only its words are updated), so a
 * re-arm a few seconds before it fires never loses it; the 30 s margin
 * applies only to a reminder armed for the first time. Timers no longer in
 * `items` are cleared. Never asks for permission: arms nothing, and clears
 * everything, unless notifications are already allowed. Used by the weekly
 * reminders (T5a), which re-arm their next 24 hours whenever the app is
 * open. Returns how many are armed afterwards.
 */
export function replaceInTabNotifications(ownerId: string, items: readonly InTabNotification[], now: number = Date.now()): number {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
    disarm(ownerId)
    return 0
  }
  const wanted = new Map<string, InTabNotification>()
  for (const item of items) wanted.set(inTabKey(item), item)

  const kept: ArmedTimer[] = []
  for (const timer of armed.get(ownerId) ?? []) {
    const next = timer.key ? wanted.get(timer.key) : undefined
    if (next && !kept.some((k) => k.key === timer.key)) {
      timer.item = next
      kept.push(timer)
    } else {
      clearTimeout(timer.handle)
    }
  }
  if (kept.length) armed.set(ownerId, kept)
  else armed.delete(ownerId)

  const keptKeys = new Set(kept.map((k) => k.key))
  let count = kept.length
  for (const [key, item] of wanted) {
    if (keptKeys.has(key)) continue
    const delay = item.fireAt.getTime() - now
    if (delay < SAFETY_MARGIN_MS || delay > MAX_TIMEOUT_MS) continue
    arm(
      ownerId,
      (timer) => {
        const shown = timer.item ?? item
        try {
          new Notification(shown.title, { body: shown.body, tag: shown.tag })
        } catch {
          // Permission can be revoked mid-flight: silent best-effort.
        }
      },
      delay,
      { key, item },
    )
    count++
  }
  return count
}

/** Disarm in-tab notifications for every owner not in `keep` whose id starts with `prefix`. */
export function disarmInTabNotificationsExcept(prefix: string, keep: ReadonlySet<string>): void {
  for (const ownerId of [...armed.keys()]) {
    if (ownerId.startsWith(prefix) && !keep.has(ownerId)) disarm(ownerId)
  }
}

/**
 * Schedule in-tab browser notifications for an OPEN-ENDED no-sign session.
 *
 * Unlike `scheduleParkingReminders` (which computes delays from expires_at
 * minus offset), this takes absolute Date objects and arms a setTimeout
 * for each. Same setTimeout constraints apply — anything beyond 24h is
 * rejected because browser timer precision degrades past that point.
 *
 * Copy comes from the caller (reminderCopy in reminder-copy.ts): a
 * "check on your car" message rather than the expiry wording, because the
 * intent is different (you ASKED to be reminded, not "you'd better move
 * or get a ticket").
 */
export async function scheduleAbsoluteReminders(
  session: ParkingSession,
  fireAtList: Date[],
  copyFor: (fireAt: Date) => ReminderCopy,
): Promise<ScheduleResult> {
  const total = fireAtList.length
  if (total === 0) {
    return { status: 'nothing-selected', scheduledCount: 0, pastCount: 0, totalSelected: 0 }
  }
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { status: 'unsupported', scheduledCount: 0, pastCount: 0, totalSelected: total }
  }

  const now = Date.now()
  const fireable: { fireAt: Date; delay: number }[] = []
  let pastCount = 0
  let tooFarCount = 0
  for (const fireAt of fireAtList) {
    const delay = fireAt.getTime() - now
    if (delay < SAFETY_MARGIN_MS) {
      pastCount += 1
    } else if (delay > MAX_TIMEOUT_MS) {
      tooFarCount += 1
    } else {
      fireable.push({ fireAt, delay })
    }
  }

  if (fireable.length === 0) {
    return {
      status: pastCount > 0 ? 'all-past' : tooFarCount > 0 ? 'all-too-far' : 'all-past',
      scheduledCount: 0,
      pastCount,
      totalSelected: total,
    }
  }

  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }
  if (permission !== 'granted') {
    return { status: 'denied', scheduledCount: 0, pastCount, totalSelected: total }
  }

  for (const { fireAt, delay } of fireable) {
    arm(session.id, () => {
      try {
        const { title, body } = copyFor(fireAt)
        // Same tag as the push copy of this reminder, so the two collapse
        // into one alert when the tab is open.
        new Notification(title, { body, tag: reminderTag(session.id, fireAt) })
      } catch {
        // Permission can be revoked mid-flight — silent best-effort.
      }
    }, delay)
  }

  return {
    status: 'scheduled',
    scheduledCount: fireable.length,
    pastCount,
    totalSelected: total,
  }
}

export async function scheduleParkingReminders(
  session: ParkingSession,
  offsetsMinutes: number[],
  copyFor: (fireAt: Date) => ReminderCopy,
): Promise<ScheduleResult> {
  const total = offsetsMinutes.length
  if (total === 0) {
    return { status: 'nothing-selected', scheduledCount: 0, pastCount: 0, totalSelected: 0 }
  }
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { status: 'unsupported', scheduledCount: 0, pastCount: 0, totalSelected: total }
  }
  if (!session.expires_at) {
    return { status: 'no-expiry', scheduledCount: 0, pastCount: 0, totalSelected: total }
  }

  const expiresAt = new Date(session.expires_at).getTime()
  const now = Date.now()

  const fireable: { offset: number; delay: number }[] = []
  let pastCount = 0
  let tooFarCount = 0
  for (const offset of offsetsMinutes) {
    const delay = expiresAt - offset * 60 * 1000 - now
    if (delay < SAFETY_MARGIN_MS) {
      pastCount += 1
    } else if (delay > MAX_TIMEOUT_MS) {
      tooFarCount += 1
    } else {
      fireable.push({ offset, delay })
    }
  }

  if (fireable.length === 0) {
    return {
      status: pastCount > 0 ? 'all-past' : tooFarCount > 0 ? 'all-too-far' : 'all-past',
      scheduledCount: 0,
      pastCount,
      totalSelected: total,
    }
  }

  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }
  if (permission !== 'granted') {
    return { status: 'denied', scheduledCount: 0, pastCount, totalSelected: total }
  }

  for (const { offset, delay } of fireable) {
    arm(session.id, () => {
      try {
        const fireAt = new Date(expiresAt - offset * 60 * 1000)
        const { title, body } = copyFor(fireAt)
        // Distinct tag per fire time, shared with the push copy of the same
        // reminder so the two collapse into one alert when the tab is open.
        new Notification(title, { body, tag: reminderTag(session.id, fireAt) })
      } catch {
        // Permission can be revoked mid-flight — nothing to do, silent best-effort.
      }
    }, delay)
  }

  return {
    status: 'scheduled',
    scheduledCount: fireable.length,
    pastCount,
    totalSelected: total,
  }
}
