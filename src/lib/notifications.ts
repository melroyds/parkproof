import type { ParkingSession } from '../types'
import { reminderTag, type ReminderCopy } from './reminder-copy'
import { sessionLink } from './deep-link'
import { getSession } from './storage'

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
  /** When each armed alarm fires, earliest first. Empty unless 'scheduled'. */
  firesAt: Date[]
}

// setTimeout precision degrades dramatically past ~24h on most browsers, so we
// refuse anything further out and steer the user to the calendar option.
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000
// If a reminder would fire in under this many ms, treat it as past — avoids the
// awkward "scheduled… and it fired half a second later" UX.
const SAFETY_MARGIN_MS = 30 * 1000

/**
 * An in-tab reminder this late is dropped, not shown. A backgrounded page
 * is frozen (Android Chrome does this), and on resume every overdue timer
 * runs at once: without this, a driver opening ParkProof after the expiry
 * would get "30 min left" and "5 min left" for parking that has already
 * expired. The push copy covers the time the page was frozen.
 */
export const IN_TAB_STALE_MS = 60 * 1000

/**
 * The service worker's notificationclick handler opens data.url. `in_tab`
 * marks the in-tab copy, so the push copy of the same reminder replaces it
 * without a second alert (src/service-worker.ts).
 */
function clickData(sessionId: string): { url: string; session_id: string; in_tab: true } {
  return { url: sessionLink(sessionId), session_id: sessionId, in_tab: true }
}

// Armed setTimeout handles per session, each with its fire time, so
// "I've left" can disarm them all and removing one reminder disarms just it.
interface Armed {
  handle: ReturnType<typeof setTimeout>
  fireAtMs: number
}
const armed = new Map<string, Armed[]>()

function arm(sessionId: string, fireAt: Date, fn: () => void, delay: number): void {
  const fireAtMs = fireAt.getTime()
  const handle = setTimeout(() => {
    const left = (armed.get(sessionId) ?? []).filter((a) => a.handle !== handle)
    if (left.length) armed.set(sessionId, left)
    else armed.delete(sessionId)
    if (!stillWanted(sessionId, fireAtMs)) return
    fn()
  }, delay)
  armed.set(sessionId, [...(armed.get(sessionId) ?? []), { handle, fireAtMs }])
}

/**
 * Checked when a timer fires: false when it fires too late to help (see
 * IN_TAB_STALE_MS), or when the record has ended since, here or on another
 * device through a cloud pull. Never throws.
 */
function stillWanted(sessionId: string, fireAtMs: number): boolean {
  if (Date.now() - fireAtMs > IN_TAB_STALE_MS) return false
  try {
    if (getSession(sessionId)?.ended_at) return false
  } catch {
    /* storage unreadable: show the reminder */
  }
  return true
}

/**
 * Show one in-tab reminder. `new Notification()` throws on Android Chrome
 * ("Illegal constructor": pages there must go through the service worker),
 * so fall back to the service worker's showNotification, with the same
 * click-through data a push carries. Silent best-effort: permission can be
 * revoked mid-flight.
 */
function showInTab(title: string, options: NotificationOptions & { data?: unknown }): void {
  try {
    new Notification(title, options)
    return
  } catch {
    /* fall through to the service worker */
  }
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    void navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.showNotification(title, options))
      .catch(() => {})
  } catch {
    /* nothing else to try */
  }
}

/**
 * Disarm in-tab reminders for a session: all of them (the driver has left,
 * or cancelled every reminder), or only those firing at `fireAts` (one
 * reminder removed). Returns how many were disarmed.
 */
export function cancelInTabReminders(sessionId: string, fireAts?: Date[]): number {
  const all = armed.get(sessionId) ?? []
  const times = fireAts ? new Set(fireAts.map((d) => d.getTime())) : null
  const drop = times ? all.filter((a) => times.has(a.fireAtMs)) : all
  const keep = times ? all.filter((a) => !times.has(a.fireAtMs)) : []
  drop.forEach((a) => clearTimeout(a.handle))
  if (keep.length) armed.set(sessionId, keep)
  else armed.delete(sessionId)
  return drop.length
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
    return { status: 'nothing-selected', scheduledCount: 0, pastCount: 0, totalSelected: 0, firesAt: [] }
  }
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { status: 'unsupported', scheduledCount: 0, pastCount: 0, totalSelected: total, firesAt: [] }
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
      firesAt: [],
    }
  }

  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }
  if (permission !== 'granted') {
    return { status: 'denied', scheduledCount: 0, pastCount, totalSelected: total, firesAt: [] }
  }

  for (const { fireAt, delay } of fireable) {
    arm(session.id, fireAt, () => {
      const { title, body } = copyFor(fireAt)
      // Same tag as the push copy of this reminder, so the two collapse
      // into one alert when the tab is open.
      showInTab(title, { body, tag: reminderTag(session.id, fireAt), data: clickData(session.id) })
    }, delay)
  }

  return {
    status: 'scheduled',
    scheduledCount: fireable.length,
    pastCount,
    totalSelected: total,
    firesAt: fireable.map((f) => f.fireAt).sort((a, b) => a.getTime() - b.getTime()),
  }
}

export async function scheduleParkingReminders(
  session: ParkingSession,
  offsetsMinutes: number[],
  copyFor: (fireAt: Date) => ReminderCopy,
): Promise<ScheduleResult> {
  const total = offsetsMinutes.length
  if (total === 0) {
    return { status: 'nothing-selected', scheduledCount: 0, pastCount: 0, totalSelected: 0, firesAt: [] }
  }
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { status: 'unsupported', scheduledCount: 0, pastCount: 0, totalSelected: total, firesAt: [] }
  }
  if (!session.expires_at) {
    return { status: 'no-expiry', scheduledCount: 0, pastCount: 0, totalSelected: total, firesAt: [] }
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
      firesAt: [],
    }
  }

  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }
  if (permission !== 'granted') {
    return { status: 'denied', scheduledCount: 0, pastCount, totalSelected: total, firesAt: [] }
  }

  for (const { offset, delay } of fireable) {
    const fireAt = new Date(expiresAt - offset * 60 * 1000)
    arm(session.id, fireAt, () => {
      const { title, body } = copyFor(fireAt)
      // Distinct tag per fire time, shared with the push copy of the same
      // reminder so the two collapse into one alert when the tab is open.
      showInTab(title, { body, tag: reminderTag(session.id, fireAt), data: clickData(session.id) })
    }, delay)
  }

  return {
    status: 'scheduled',
    scheduledCount: fireable.length,
    pastCount,
    totalSelected: total,
    firesAt: fireable
      .map((f) => new Date(expiresAt - f.offset * 60 * 1000))
      .sort((a, b) => a.getTime() - b.getTime()),
  }
}
