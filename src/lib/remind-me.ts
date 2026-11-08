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
 *   2. Arm the in-tab reminders (they work while ParkProof is open). They
 *      need no connection, so they go first: on a weak signal the push
 *      steps below can take seconds, or time out, and the driver still has
 *      these.
 *   3. Subscribe to push if needed and make sure the server has this
 *      device's registration.
 *   4. Book the push reminders on the server (they work when it's closed).
 *      schedulePushReminders re-sends the registration first and retries
 *      once on ERR_NOT_SUBSCRIBED.
 *
 * Every push request gives up after PUSH_REQUEST_TIMEOUT_MS (push.ts). A
 * timeout stops the push steps there: the result says the reminder only
 * works while ParkProof is open, and to try again.
 *
 * The result says exactly what got booked, so the screen can confirm it in
 * plain words or say that the reminder only works while ParkProof is open,
 * and why. Nothing is ever skipped quietly.
 */
import { schedulePushReminders, subscribeToPush, type ScheduledFire, type ScheduledReminder } from './push'
import { cancelInTabReminders, type ScheduleResult } from './notifications'
import { isIosBrowserTab } from './platform'
import { alertEnvironment, alertReach, type AlertEnvironment } from './alert-reach'

/**
 * Why the reminder can't reach the driver while ParkProof is closed.
 *   - ios_install: an iPhone browser tab. Apple only allows web
 *     notifications for a site added to the Home Screen.
 *   - denied: notifications are blocked (or the prompt was dismissed).
 *   - unsupported: this browser has no web push.
 *   - failed: push is possible here but registering or booking failed
 *     (offline, no answer in time, server error, or the server refused the
 *     registration even after one retry). Trying again may work.
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
  /**
   * Arms the in-tab reminders. Called once, after permission is settled and
   * before any push network work, and not at all when permission was refused.
   */
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

  // 2. In-tab reminders, before any network work and whatever happens with
  //    push.
  const inTab = await args.armInTab()

  if (permission === 'unsupported') {
    // No notifications of any kind in this browser.
    return disarmUnshowable(args.sessionId, { background: { ok: false, reason: noPushReason() }, inTab })
  }

  // 3 and 4. The in-tab reminders are armed by now, so a push step that
  // fails in a way it shouldn't (they never throw by contract) still ends
  // in an outcome that tells the truth about them.
  let background: BackgroundResult
  try {
    background = await bookBackground(args)
  } catch (err) {
    console.error('[remind-me] push booking threw:', err)
    background = { ok: false, reason: 'failed' }
  }
  return disarmUnshowable(args.sessionId, { background, inTab })
}

/**
 * When push booked nothing and this phone can't show an alert from an open
 * tab (alertReach 'none': Android before a service worker controls the
 * page), the outcome says no reminder was set. The in-tab timers armed in
 * step 2 are disarmed here, so that stays true: without this, a service
 * worker that took control later would let them fire after the screen said
 * nothing would (fix round 1). The result then carries no armed times, and
 * summariseRemindMe reports 'none' with the push step, whatever the phone
 * can do by the time it is called.
 */
export function disarmUnshowable(
  sessionId: string,
  result: RemindMeResult,
  env: AlertEnvironment = alertEnvironment(),
): RemindMeResult {
  const { background, inTab } = result
  if (background.ok && background.created.length > 0) return result
  if (inTab.status !== 'scheduled' || inTab.firesAt.length === 0) return result
  if (alertReach(false, env) !== 'none') return result
  cancelInTabReminders(sessionId, inTab.firesAt)
  return { background, inTab: { ...inTab, scheduledCount: 0, firesAt: [] } }
}

/** Steps 3 and 4: register this device for push, then book the push reminders. */
async function bookBackground(args: RemindMeArgs): Promise<BackgroundResult> {
  // 3. Subscribe if needed and register with the server. Permission is
  //    already granted, so this never prompts.
  const prep = await subscribeToPush()
  if (!prep.ok && prep.reason === 'timeout') {
    // No answer in time: the signal is too weak for push right now. Booking
    // would only wait out another timeout. "Try again" is the next step.
    return { ok: false, reason: 'failed' }
  }
  if (!prep.ok && prep.reason !== 'network') {
    const reason: BackgroundFailure =
      prep.reason === 'denied' ? 'denied' : prep.reason === 'subscribe_failed' ? 'failed' : noPushReason()
    return { ok: false, reason }
  }

  // 4. Book. A registration the server didn't store ('network' above) gets
  //    re-sent here, and the server has the final say.
  const booked = await schedulePushReminders(args.sessionId, args.pushReminders, args.expiresAt)
  if (booked.ok) return { ok: true, created: booked.created }
  const reason: BackgroundFailure =
    booked.reason === 'not_owner' ? 'not_owner' : booked.reason === 'unsupported' ? noPushReason() : 'failed'
  return { ok: false, reason }
}

/**
 * What to tell the driver after remindMe().
 *   - kind: 'background' when push reminders were booked (they work with
 *     ParkProof closed), 'openOnly' when only in-tab reminders were armed,
 *     'none' when nothing was set.
 *   - times: the booked fire times, earliest first.
 *   - step: the one next step when push isn't working, else null.
 *     'allPast' when nothing could be booked because the times have passed.
 *
 * 'openOnly' is claimed only when this phone can show an alert from an open
 * tab right now, by the same check the weekly reminders list uses
 * (alert-reach.ts). On Android before a service worker controls the page
 * an in-tab alert can't show, so remindMe disarms the timers it armed
 * (disarmUnshowable) and the outcome says nothing was set, with the push
 * step that would fix it, exactly as the weekly list says the phone can't
 * alert.
 */
export interface RemindMeSummary {
  kind: 'background' | 'openOnly' | 'none'
  times: Date[]
  step: BackgroundFailure | 'allPast' | null
}

export function summariseRemindMe(
  result: RemindMeResult,
  env: AlertEnvironment = alertEnvironment(),
): RemindMeSummary {
  const { background, inTab } = result
  if (background.ok && background.created.length > 0) {
    // Booked by the server just now, under a granted permission and with a
    // stored registration: what alertReach calls 'closed'.
    const times = background.created
      .map((c) => new Date(c.fire_at))
      .filter((d) => Number.isFinite(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())
    return { kind: 'background', times, step: null }
  }
  // Push booked nothing. Push booking failed, or (rare) the server skipped
  // every time while the tab armed some: a retry is the honest next step.
  const pushStep: BackgroundFailure = background.ok ? 'failed' : background.reason
  if (inTab.status === 'scheduled') {
    if (inTab.firesAt.length > 0 && alertReach(false, env) === 'open_only') {
      return { kind: 'openOnly', times: inTab.firesAt, step: pushStep }
    }
    // Armed, but this phone can't show an in-tab alert (remindMe has
    // disarmed them, disarmUnshowable): say none was set.
    return { kind: 'none', times: [], step: pushStep }
  }
  // Nothing set. Times that have passed explain it better than any push
  // problem: retrying or installing wouldn't help.
  if (background.ok || inTab.status === 'all-past') return { kind: 'none', times: [], step: 'allPast' }
  return { kind: 'none', times: [], step: background.reason }
}
