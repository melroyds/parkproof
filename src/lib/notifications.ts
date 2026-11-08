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

// Armed setTimeout handles per owner (a record's id, or a weekly reminder's
// 'recurring:<rule id>'), each with its fire time, so "I've left" can disarm
// them all and removing one reminder disarms just it.
interface Armed {
  handle: ReturnType<typeof setTimeout>
  fireAtMs: number
  /**
   * Set for timers armed by replaceInTabNotifications: the reminder's tag
   * and fire time, so a re-arm can keep a timer that is still wanted.
   */
  key?: string
  /** Its latest text, read when it fires (a re-arm can change the words). */
  item?: InTabNotification
  /**
   * False for a weekly reminder (T5a): it belongs to no record, so the
   * ended-record check never drops it. True for a record's reminders.
   */
  ofRecord: boolean
}
const armed = new Map<string, Armed[]>()

function arm(
  ownerId: string,
  fireAt: Date,
  fn: (timer: Armed) => void,
  delay: number,
  extra: Pick<Armed, 'key' | 'item'> & { ofRecord?: boolean } = {},
): void {
  const { ofRecord = true, ...fields } = extra
  const timer: Armed = {
    ...fields,
    ofRecord,
    fireAtMs: fireAt.getTime(),
    handle: undefined as unknown as ReturnType<typeof setTimeout>,
  }
  timer.handle = setTimeout(() => {
    const left = (armed.get(ownerId) ?? []).filter((a) => a !== timer)
    if (left.length) armed.set(ownerId, left)
    else armed.delete(ownerId)
    if (!stillWanted(ownerId, timer)) return
    fn(timer)
  }, delay)
  armed.set(ownerId, [...(armed.get(ownerId) ?? []), timer])
}

/**
 * Checked when a timer fires: false when it fires too late to help (see
 * IN_TAB_STALE_MS), or, for a record's reminder, when the record has ended
 * since, here or on another device through a cloud pull. A weekly reminder
 * is tied to no record, so only the lateness check applies to it. Never
 * throws.
 */
function stillWanted(ownerId: string, timer: Armed): boolean {
  if (Date.now() - timer.fireAtMs > IN_TAB_STALE_MS) return false
  if (!timer.ofRecord) return true
  try {
    if (getSession(ownerId)?.ended_at) return false
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

/** Disarm every in-tab notification armed for `ownerId`. */
function disarm(ownerId: string): number {
  return cancelInTabReminders(ownerId)
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
 * open. They belong to no record, so when one fires only the lateness
 * check (IN_TAB_STALE_MS) can drop it. Returns how many are armed
 * afterwards.
 */
export function replaceInTabNotifications(ownerId: string, items: readonly InTabNotification[], now: number = Date.now()): number {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
    disarm(ownerId)
    return 0
  }
  const wanted = new Map<string, InTabNotification>()
  for (const item of items) wanted.set(inTabKey(item), item)

  const kept: Armed[] = []
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
      item.fireAt,
      (timer) => {
        const shown = timer.item ?? item
        try {
          new Notification(shown.title, { body: shown.body, tag: shown.tag })
        } catch {
          // Permission can be revoked mid-flight: silent best-effort.
        }
      },
      delay,
      { key, item, ofRecord: false },
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
