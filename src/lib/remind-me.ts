/**
 * The one "Remind me" action (field-test fix list, item 2).
 *
 * It used to take two taps: "Enable push" only registered the phone, and
 * the browser-notification button booked the server reminder plus an
 * in-tab one. Either tap alone failed without a word. remindMe() does the
 * whole thing from ONE tap, in this order:
 *
 *   1. Ask for notification permission when the browser hasn't been asked.
 *      This is the first await, so it still runs inside the tap: iOS shows
 *      the prompt only from a user gesture.
 *   2. Subscribe to push if needed and make sure the server has this
 *      device's registration.
 *   3. Arm the in-tab reminders (they work while ParkProof is open).
 *   4. Book the push reminders on the server (they work when it's closed).
 *      schedulePushReminders re-sends the registration first and retries
 *      once on ERR_NOT_SUBSCRIBED.
 *
 * The result says exactly what got booked, so the screen can confirm it in
 * plain words or say that the reminder only works while ParkProof is open,
 * and why. Nothing is ever skipped quietly.
 */
import { schedulePushReminders, subscribeToPush, type ScheduledFire, type ScheduledReminder } from './push'
import type { ScheduleResult } from './notifications'
import { isIosBrowserTab } from './platform'

/**
 * Why the reminder can't reach the driver while ParkProof is closed.
 *   - ios_install: an iPhone browser tab. Apple only allows web
 *     notifications for a site added to the Home Screen.
 *   - denied: notifications are blocked (or the prompt was dismissed).
 *   - unsupported: this browser has no web push.
 *   - failed: push is possible here but registering or booking failed
 *     (offline, server error, or the server refused the registration even
 *     after one retry). Trying again may work.
 *   - not_owner: another device owns this record's reminders (spec N6).
 */
export type BackgroundFailure = 'ios_install' | 'denied' | 'unsupported' | 'failed' | 'not_owner'

export type BackgroundResult =
  | { ok: true; created: ScheduledFire[] }
  | { ok: false; reason: BackgroundFailure }

export interface RemindMeResult {
  /** Push reminders booked on the server: these work when ParkProof is closed. */
  background: BackgroundResult
  /** In-tab reminders: these work only while ParkProof is open. */
  inTab: ScheduleResult
}

export interface RemindMeArgs {
  sessionId: string
  /** The full set of push reminders to book (the server replaces the record's set). */
  pushReminders: ScheduledReminder[]
  /** The record's parking expiry, or null for a no-sign record. */
  expiresAt: string | null
  /** Arms the in-tab reminders. Called after permission is settled. */
  armInTab: () => Promise<ScheduleResult>
}

/**
 * Ask for notification permission when the browser hasn't been asked.
 * 'unsupported' when this browser has no Notification API at all (an
 * iPhone browser tab, for one).
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

/** No web push here: on an iPhone browser tab the fix is the Home Screen. */
function noPushReason(): BackgroundFailure {
  return isIosBrowserTab() ? 'ios_install' : 'unsupported'
}

/** The in-tab result when permission was refused, without asking again. */
function refused(total: number): ScheduleResult {
  return { status: 'denied', scheduledCount: 0, pastCount: 0, totalSelected: total, firesAt: [] }
}

export async function remindMe(args: RemindMeArgs): Promise<RemindMeResult> {
  // 1. Permission first, while the tap's user gesture is still live.
  const permission = await requestNotificationPermission()

  if (permission === 'denied' || permission === 'default') {
    // Blocked, or the prompt was dismissed. Don't prompt a second time.
    return {
      background: { ok: false, reason: 'denied' },
      inTab: refused(args.pushReminders.length),
    }
  }

  if (permission === 'unsupported') {
    // No notifications of any kind in this browser.
    return { background: { ok: false, reason: noPushReason() }, inTab: await args.armInTab() }
  }

  // 2. Subscribe if needed and register with the server. Permission is
  //    already granted, so this never prompts.
  const prep = await subscribeToPush()

  // 3. In-tab reminders, whatever happens with push.
  const inTab = await args.armInTab()

  if (!prep.ok && prep.reason !== 'network') {
    const reason: BackgroundFailure =
      prep.reason === 'denied' ? 'denied' : prep.reason === 'subscribe_failed' ? 'failed' : noPushReason()
    return { background: { ok: false, reason }, inTab }
  }

  // 4. Book. A registration the server didn't store ('network' above) gets
  //    re-sent here, and the server has the final say.
  const booked = await schedulePushReminders(args.sessionId, args.pushReminders, args.expiresAt)
  if (booked.ok) return { background: { ok: true, created: booked.created }, inTab }
  const reason: BackgroundFailure =
    booked.reason === 'not_owner' ? 'not_owner' : booked.reason === 'unsupported' ? noPushReason() : 'failed'
  return { background: { ok: false, reason }, inTab }
}

/**
 * What to tell the driver after remindMe().
 *   - kind: 'background' when push reminders were booked (they work with
 *     ParkProof closed), 'openOnly' when only in-tab reminders were armed,
 *     'none' when nothing was set.
 *   - times: the booked fire times, earliest first.
 *   - step: the one next step when push isn't working, else null.
 *     'allPast' when nothing could be booked because the times have passed.
 */
export interface RemindMeSummary {
  kind: 'background' | 'openOnly' | 'none'
  times: Date[]
  step: BackgroundFailure | 'allPast' | null
}

export function summariseRemindMe(result: RemindMeResult): RemindMeSummary {
  const { background, inTab } = result
  if (background.ok && background.created.length > 0) {
    const times = background.created
      .map((c) => new Date(c.fire_at))
      .filter((d) => Number.isFinite(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())
    return { kind: 'background', times, step: null }
  }
  if (inTab.status === 'scheduled' && inTab.firesAt.length > 0) {
    // Push booked nothing (the server skipped every time) yet the tab armed
    // some: rare, and a retry is the honest next step.
    return { kind: 'openOnly', times: inTab.firesAt, step: background.ok ? 'failed' : background.reason }
  }
  // Nothing set. Times that have passed explain it better than any push
  // problem: retrying or installing wouldn't help.
  if (background.ok || inTab.status === 'all-past') return { kind: 'none', times: [], step: 'allPast' }
  return { kind: 'none', times: [], step: background.reason }
}
