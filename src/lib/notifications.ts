import type { ParkingSession } from '../types'

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

/**
 * Schedule in-tab browser notifications for an OPEN-ENDED no-sign session.
 *
 * Unlike `scheduleParkingReminders` (which computes delays from expires_at
 * minus offset), this takes absolute Date objects and arms a setTimeout
 * for each. Same setTimeout constraints apply — anything beyond 24h is
 * rejected because browser timer precision degrades past that point.
 *
 * Body text is "Time to check on your car at <address>" — explicitly
 * different from the expiry-based "Parking expires" copy because the
 * intent is different (you ASKED to be reminded, not "you'd better move
 * or get a ticket").
 */
export async function scheduleAbsoluteReminders(
  session: ParkingSession,
  fireAtList: Date[],
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

  const locationLabel = session.location
    ? (session.location.address ??
      `${session.location.lat.toFixed(4)}, ${session.location.lng.toFixed(4)}`)
    : 'your spot'

  for (const { fireAt, delay } of fireable) {
    setTimeout(() => {
      try {
        new Notification('🚗 Check on your car', {
          body: `Time to check on your car at ${locationLabel}.`,
          // Distinct tag per fire-time so multiple notifications coexist.
          tag: `parkproof-${session.id}-${fireAt.getTime()}`,
        })
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

  const locationLabel = session.location
    ? (session.location.address ??
      `${session.location.lat.toFixed(4)}, ${session.location.lng.toFixed(4)}`)
    : 'your spot'

  for (const { offset, delay } of fireable) {
    setTimeout(() => {
      try {
        const body =
          offset === 0
            ? `Parking is expiring now at ${locationLabel}.`
            : `Parking expires in ${offset} ${offset === 1 ? 'min' : 'mins'} at ${locationLabel}.`
        // Distinct tag per offset so multiple notifications coexist instead of replacing each other.
        new Notification('⏰ Move your car', {
          body,
          tag: `parkproof-${session.id}-${offset}`,
        })
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
