import type { TFunction } from 'i18next'
import type { ParkingSession } from '../types'
import { departureSummary } from './chain-view'
import { formatCountdownLocalized, type Urgency } from './countdown'
import { ACTIVE_AFTER_EXPIRY_MS } from './storage'
import { formatInZone, isSameDayInZone } from './time-format'

/**
 * "I've left" is offered on any record the driver hasn't ended yet,
 * including one whose expiry has passed (the driver may come back late).
 */
export function canEndRecord(session: ParkingSession): boolean {
  return !session.ended_at
}

/**
 * True when an "I've left" tap right now would be late: the record's expiry
 * has passed, or it has no expiry and was logged more than
 * ACTIVE_AFTER_EXPIRY_MS ago. The stored ended_at is the phone's tap time,
 * so a late tap says little about when the car left. Those taps get the
 * stronger confirm that names the time that will be recorded.
 */
export function isLateEnd(session: ParkingSession, now: number): boolean {
  const expiresMs = session.expires_at ? new Date(session.expires_at).getTime() : NaN
  if (Number.isFinite(expiresMs)) return expiresMs < now
  const arrivedMs = new Date(session.arrived_at).getTime()
  return Number.isFinite(arrivedMs) && now - arrivedMs > ACTIVE_AFTER_EXPIRY_MS
}

/**
 * "Sat 25 Oct, 3:05 pm AEDT" in the record's own time zone, with its name:
 * the same format the record screen's departure row shows the tap in.
 */
function tapWhen(ms: number, timeZone: string): string {
  return formatInZone(ms, timeZone)
}

/**
 * The confirm shown before an "I've left" tap. Every version says the stored
 * time is the phone's tap time. A late tap (see `isLateEnd`) names the time
 * that will be recorded, so nobody mistakes it for when the car left.
 *
 * `onTimeKey` is the screen's own confirm for an on-time tap. `now` defaults
 * to the clock at the call, which is the tap, so call this from the click
 * handler rather than with a render-time tick.
 */
export function endConfirmText(
  session: ParkingSession,
  t: TFunction,
  timeZone: string,
  onTimeKey: 'active.iveLeftConfirm' | 'session.endConfirm',
  now: number = Date.now(),
): string {
  if (isLateEnd(session, now)) {
    return t('session.endConfirmLate', { time: tapWhen(now, timeZone) })
  }
  return t(onTimeKey)
}

/**
 * The time for an ended record's status line on its record screen ("Ended
 * 5:23 pm AEDT"; field-test fix list, item 6), so two records from the same
 * afternoon can't be mistaken for each other. It is the departure row's tap
 * time (`departureSummary`: the signed departure's tap time once signed,
 * else `ended_at`), so the two lines never disagree. In the record's own
 * zone with the zone's name. The day is left out when the record ended on
 * the day it arrived (the screen's header shows that day) and added when it
 * didn't. Null when the record hasn't ended or the time can't be read.
 *
 * A phone time: the departure row right below labels it as the tap on the
 * phone's clock, so this compact line doesn't repeat that.
 */
export function endedStatusTime(session: ParkingSession, timeZone: string): string | null {
  const tapped = departureSummary(session)?.tapped_at
  if (typeof tapped !== 'string' || !Number.isFinite(Date.parse(tapped))) return null
  const sameDay = isSameDayInZone(tapped, session.arrived_at, timeZone)
  return formatInZone(tapped, timeZone, { withDate: !sameDay })
}

export type RecordStatusKind = 'ended' | 'expired' | 'no_expiry' | 'counting'

export interface RecordStatus {
  kind: RecordStatusKind
  label: string
  /** Countdown urgency. Null unless `kind` is 'counting'. */
  urgency: Urgency | null
}

/** "18 May, 3:15 pm" in the record's own time zone. */
function shortWhen(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * One-line status for a record in History. An explicit `ended_at` wins over
 * everything else: once the driver tapped "I've left", the record is ended,
 * whatever its expiry says.
 */
export function recordStatus(
  session: ParkingSession,
  now: number,
  t: TFunction,
  timeZone: string,
): RecordStatus {
  if (session.ended_at && Number.isFinite(new Date(session.ended_at).getTime())) {
    return {
      kind: 'ended',
      label: t('session.endedAt', { when: shortWhen(session.ended_at, timeZone) }),
      urgency: null,
    }
  }
  const expiresMs = session.expires_at ? new Date(session.expires_at).getTime() : NaN
  if (!Number.isFinite(expiresMs)) {
    return { kind: 'no_expiry', label: t('history.noExpiry'), urgency: null }
  }
  if (expiresMs < now) {
    return { kind: 'expired', label: t('history.expired'), urgency: null }
  }
  const countdown = formatCountdownLocalized(expiresMs - now, t)
  return { kind: 'counting', label: countdown.label, urgency: countdown.urgency }
}
