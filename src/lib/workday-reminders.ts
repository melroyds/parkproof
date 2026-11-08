import type { TFunction } from 'i18next'
import type { ParkingSession } from '../types'
import { cancelInTabReminders, scheduleAbsoluteReminders } from './notifications'
import { MAX_PUSH_REMINDERS } from './permit-answer'
import { isPushTurnedOff, type ScheduledFire } from './push'
import { remindMe, summariseRemindMe, type RemindMeSummary } from './remind-me'
import { updateSession } from './storage'
import { mirrorSessionUpdateToCloud } from './sync'
import {
  stretchInAreaMode,
  workdayPushReminders,
  workdayReminderCopy,
  workdayReminderSchedule,
  type WorkdayReminder,
} from './workday'

/**
 * A workday stop's reminders (build spec T6b item 9). Workday stops skip
 * the reminder screen: when a stop is saved, T6a's schedule for it (a
 * heads-up, go now, and at the deadline) is booked at once, as push
 * reminders through the same code as "Remind me" (remindMe, at most
 * MAX_PUSH_REMINDERS per record) and as in-tab reminders. The copy is T6a's
 * (`workdayReminderCopy`): absolute times, and under an area limit, the
 * whole area. Screens that show these reminders carry the reliability line.
 *
 * Booking never asks for notification permission by itself (a save isn't a
 * tap the browser lets prompt from): the workday start screen asks. Only a
 * "Try again" tap may ask.
 */

export interface WorkdayLegPlan {
  /** The reminders to book, soonest first, at most MAX_PUSH_REMINDERS. */
  reminders: WorkdayReminder[]
  /** Under an area limit (carried over the workday): the copy names the whole area. */
  area_mode: boolean
}

/**
 * What a stop's reminders are: T6a's schedule for its deadline (its saved
 * `expires_at`, the earlier of its sign's limit and the stretch's), with
 * the area wording when the limit running over the workday is an area one.
 * `legs` are the workday's saved legs in leg order, this one included.
 */
export function workdayLegPlan(
  leg: Pick<ParkingSession, 'expires_at'>,
  legs: Parameters<typeof stretchInAreaMode>[0],
  now: number = Date.now(),
): WorkdayLegPlan {
  return {
    reminders: workdayReminderSchedule({ deadline: leg.expires_at ?? null, now }).slice(0, MAX_PUSH_REMINDERS),
    area_mode: stretchInAreaMode(legs),
  }
}

/** Notification permission as it stands, without asking. */
function permissionNow(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

/** Arm the in-tab copies of a stop's reminders, replacing any armed before. Never asks for permission. */
function armInTab(leg: ParkingSession, plan: WorkdayLegPlan, t: TFunction) {
  cancelInTabReminders(leg.id)
  const byTime = new Map(plan.reminders.map((r) => [Date.parse(r.fire_at), r]))
  return scheduleAbsoluteReminders(
    leg,
    plan.reminders.map((r) => new Date(r.fire_at)),
    (fireAt) => {
      const reminder = byTime.get(fireAt.getTime()) ?? plan.reminders[plan.reminders.length - 1]
      return workdayReminderCopy(reminder, leg, t, { area_mode: plan.area_mode })
    },
  )
}

/** Stops whose in-tab reminders were armed in this page (in-tab timers don't survive a reload). */
const armedHere = new Set<string>()

export interface BookWorkdayLegOptions {
  now?: number
  /** True only from a tap ("Try again"): then the browser may ask for permission. */
  fromTap?: boolean
  /** Signed in: the booked times are mirrored to the cloud copy. */
  signedIn?: boolean
}

/**
 * Book a stop's reminders: in-tab and push, with T6a's copy. Stores the
 * push times the server booked on the record (`push_reminders`), so the
 * record screen lists them and I've left cancels them. Returns what was
 * set, or null when nothing was attempted: the stop has no deadline ahead,
 * notifications are turned off in Settings, or (except from a tap) the
 * browser hasn't been allowed to notify. Never throws.
 */
export async function bookWorkdayLegReminders(
  leg: ParkingSession,
  legs: Parameters<typeof stretchInAreaMode>[0],
  t: TFunction,
  options: BookWorkdayLegOptions = {},
): Promise<RemindMeSummary | null> {
  if (leg.ended_at) return null
  const plan = workdayLegPlan(leg, legs, options.now)
  if (plan.reminders.length === 0) return null
  if (isPushTurnedOff()) return null
  // No notifications at all in this browser, or blocked: the card says so
  // and offers the calendar file. Not asked yet: only a tap may ask.
  const permission = permissionNow()
  if (permission !== 'granted' && !(permission === 'default' && options.fromTap)) return null
  try {
    const result = await remindMe({
      sessionId: leg.id,
      pushReminders: workdayPushReminders(leg, plan.reminders, t, { area_mode: plan.area_mode }),
      expiresAt: leg.expires_at ?? null,
      armInTab: () => {
        armedHere.add(leg.id)
        return armInTab(leg, plan, t)
      },
    })
    if (result.background.ok) persistBooked(leg.id, result.background.created, options.signedIn === true)
    return summariseRemindMe(result)
  } catch (err) {
    console.warn('[workday] could not set the stop reminders:', err)
    return { kind: 'none', times: [], step: 'failed' }
  }
}

/**
 * Arm a parked stop's in-tab reminders again after a reload, once per page.
 * In-tab only (its push reminders were booked when it was saved). Only when
 * notifications are already allowed; never asks. Returns true when armed.
 */
export function rearmWorkdayLegInTab(
  leg: ParkingSession,
  legs: Parameters<typeof stretchInAreaMode>[0],
  t: TFunction,
  now: number = Date.now(),
): boolean {
  if (armedHere.has(leg.id) || leg.ended_at || isPushTurnedOff() || permissionNow() !== 'granted') return false
  const plan = workdayLegPlan(leg, legs, now)
  if (plan.reminders.length === 0) return false
  armedHere.add(leg.id)
  void armInTab(leg, plan, t).catch((err) => console.warn('[workday] could not arm the stop reminders:', err))
  return true
}

/** Test-only: forget which stops were armed in this page. */
export function resetWorkdayRemindersForTests(): void {
  armedHere.clear()
}

function persistBooked(sessionId: string, created: ScheduledFire[], signedIn: boolean): void {
  try {
    updateSession(sessionId, { push_reminders: created.map((c) => ({ fire_at: c.fire_at })) })
    if (signedIn) mirrorSessionUpdateToCloud(sessionId)
  } catch (err) {
    console.warn('[workday] could not keep the booked reminder times:', err)
  }
}
