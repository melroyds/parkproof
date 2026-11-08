/**
 * The one answer to "can this phone alert the driver, and when?" (fix
 * list, after the overnight build: the Remind me outcome said "only works
 * while ParkProof is open" on an Android phone where the weekly reminders
 * list said it couldn't alert at all).
 *
 * Both screens read it:
 *   - the Remind me outcome for a record (remind-me.ts summariseRemindMe),
 *   - the line under each weekly reminder (recurring-push.ts
 *     recurringAlertReach).
 * So for the same phone at the same moment they can never disagree.
 *
 * The in-tab half is notifications.ts canShowInTabNotifications(): the
 * Notification API exists, permission is granted, and on Android a service
 * worker controls the page (Android's browsers refuse `new Notification()`,
 * so an in-tab alert there has to go through one). Before that, an in-tab
 * alert can't show, so neither screen may say it will.
 */
import { canShowInTabNotifications } from './notifications'
import { isPushTurnedOff } from './push'

/**
 * What a reminder can truthfully claim on this phone:
 *  - 'closed': booked for push, notifications are allowed and push hasn't
 *    been turned off in Settings, so it alerts even when ParkProof is closed;
 *  - 'open_only': not on push, but this browser can show an alert while
 *    ParkProof is open;
 *  - 'none': nothing on this phone can alert for it right now.
 */
export type AlertReach = 'closed' | 'open_only' | 'none'

export interface AlertEnvironment {
  /** Notification.permission, or 'unsupported' when there is no Notification API. */
  permission: NotificationPermission | 'unsupported'
  /** canShowInTabNotifications(): can an open tab show an alert here? */
  inTab: boolean
  /**
   * push.ts isPushTurnedOff(): push was turned off in Settings on this
   * browser and hasn't been registered again. Absent counts as false.
   */
  pushOff?: boolean
}

/** This phone, right now. */
export function alertEnvironment(): AlertEnvironment {
  const permission = typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  const env: AlertEnvironment = { permission, inTab: canShowInTabNotifications() }
  if (isPushTurnedOff()) env.pushOff = true
  return env
}

/**
 * The reach of a reminder that is (`pushBooked`) or isn't booked for push.
 * A push booking only counts while notification permission is still
 * granted (a revoked permission silences push too) and while push is on in
 * Settings. Without one, the reminder can alert only while ParkProof is
 * open, and only when an open tab can show an alert here.
 */
export function alertReach(pushBooked: boolean, env: AlertEnvironment): AlertReach {
  if (pushBooked && env.permission === 'granted' && env.pushOff !== true) return 'closed'
  if (env.inTab) return 'open_only'
  return 'none'
}
