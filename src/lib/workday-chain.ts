import type { ArrivalWorkday, ParkingSession, SignedAddendum } from '../types'
import { HEX64_RE, UUID_RE } from '../../lambda/addendum-schema.js'

/**
 * Linking a workday stop to the stop before it (build spec T6b item 11,
 * N2). A stop's arrival_context carries `workday.previous_departure_payload_sha256`:
 * the sha256 hex of the previous stop's signed departure payload, so the
 * signed stops form one chain across the day. It can only be filled at sign
 * time, once that departure is signed, so the signing queue holds a stop's
 * arrival_context until then, or for at most 24 hours, after which it is
 * signed with null. Pure: callers pass the records and the clock.
 */

/** How long a stop's arrival_context waits for the previous stop's departure before it is signed with null. */
export const PREVIOUS_DEPARTURE_WAIT_MS = 24 * 60 * 60 * 1000

/** The workday link in a pending arrival_context's data, or null when it has none. */
export function arrivalWorkday(addendum: Pick<SignedAddendum, 'kind' | 'data'>): ArrivalWorkday | null {
  if (addendum.kind !== 'arrival_context') return null
  const w = (addendum.data as { workday?: unknown } | null | undefined)?.workday
  if (!w || typeof w !== 'object') return null
  const link = w as Partial<ArrivalWorkday>
  if (typeof link.workday_id !== 'string' || !UUID_RE.test(link.workday_id)) return null
  if (!Number.isInteger(link.leg_index) || (link.leg_index as number) < 0) return null
  return link as ArrivalWorkday
}

/**
 * The stop before a leg on its workday: the saved leg with the highest leg
 * index below it (read-only shared copies are never legs). Null for the
 * first stop, or when that stop isn't on this device.
 */
export function previousLegOf(
  sessionId: string,
  link: Pick<ArrivalWorkday, 'workday_id' | 'leg_index'>,
  sessions: readonly ParkingSession[],
): ParkingSession | null {
  let best: ParkingSession | null = null
  for (const s of sessions) {
    if (s.id === sessionId || s.shared_from || s.workday_id !== link.workday_id) continue
    if (!Number.isInteger(s.leg_index) || (s.leg_index as number) >= link.leg_index) continue
    if (!best || (s.leg_index as number) > (best.leg_index as number)) best = s
  }
  return best
}

/**
 * What to do with a pending addendum before it is signed:
 *   - sign: sign it as it is (not a workday stop's arrival_context, the
 *     first stop, or the link is already filled);
 *   - fill: put `payload`'s sha256 in `previous_departure_payload_sha256`
 *     first (the previous stop's departure is signed);
 *   - wait: the previous stop's departure isn't signed yet, and less than
 *     24 hours have passed since this arrival_context was queued;
 *   - sign_null: sign with null. 24 hours have passed, or the previous
 *     stop's departure was refused by the server and will never be signed.
 */
export type PreviousDepartureStep =
  | { kind: 'sign' }
  | { kind: 'fill'; payload: string }
  | { kind: 'wait' }
  | { kind: 'sign_null' }

export function previousDepartureStep(
  sessionId: string,
  addendum: Pick<SignedAddendum, 'kind' | 'data' | 'captured_at'>,
  sessions: readonly ParkingSession[],
  now: number,
): PreviousDepartureStep {
  const link = arrivalWorkday(addendum)
  if (!link || link.leg_index === 0) return { kind: 'sign' }
  if (typeof link.previous_departure_payload_sha256 === 'string' && HEX64_RE.test(link.previous_departure_payload_sha256)) {
    return { kind: 'sign' }
  }
  const previous = previousLegOf(sessionId, link, sessions)
  const departure = previous?.addenda?.find((a) => a.kind === 'departure')
  if (departure?.bundle && typeof departure.bundle.canonical_payload === 'string') {
    return { kind: 'fill', payload: departure.bundle.canonical_payload }
  }
  if (departure?.rejected) return { kind: 'sign_null' }
  const queued = Date.parse(addendum.captured_at)
  // An unreadable queue time can't start the wait: sign now rather than never.
  if (!Number.isFinite(queued) || now - queued >= PREVIOUS_DEPARTURE_WAIT_MS) return { kind: 'sign_null' }
  return { kind: 'wait' }
}

/**
 * The legs whose pending arrival_context waits for this record's departure
 * (the next stop on its workday), so their signing can be tried as soon as
 * that departure is signed.
 */
export function legsWaitingOnDeparture(session: ParkingSession, sessions: readonly ParkingSession[]): string[] {
  if (typeof session.workday_id !== 'string' || !Number.isInteger(session.leg_index)) return []
  const out: string[] = []
  for (const s of sessions) {
    if (s.id === session.id || s.shared_from || s.workday_id !== session.workday_id) continue
    const pending = (s.addenda ?? []).find((a) => a.kind === 'arrival_context' && !a.bundle && !a.rejected)
    const link = pending ? arrivalWorkday(pending) : null
    if (!link || link.previous_departure_payload_sha256) continue
    if (previousLegOf(s.id, link, sessions)?.id === session.id) out.push(s.id)
  }
  return out
}
