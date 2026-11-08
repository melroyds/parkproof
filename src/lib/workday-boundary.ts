import type { BoundaryAnswer, BoundaryStatement, ParkingSession, PlaceParts } from '../types'
import {
  boundaryOptions,
  buildBoundaryStatement,
  legDeadline,
  previousStretchLeg,
  sameStretchCheck,
  startsNewLimit,
  stretchLegFromReading,
  stretchStartedAt,
  workdayLegs,
  type LegDeadline,
  type StretchCheck,
  type StretchLocation,
  type WorkdaySignReading,
} from './workday'

/**
 * The boundary question for a workday stop (build spec T6b item 8), and
 * the limit the stop is saved with. Pure: callers pass in the saved records
 * and the clock. The logger asks the question; App saves the stop with
 * `stopLimitFields`, both from the same T6a maths (sameStretchCheck,
 * boundaryOptions, buildBoundaryStatement, legDeadline), so what the driver
 * was shown is what the record keeps.
 *
 * Fails safe throughout: when the app can't tell whether the car left the
 * signed stretch it asks, and an answer that names no boundary keeps the
 * original limit running.
 */

/** The workday a stop is logged on, as the boundary question needs it. */
export interface StopContext {
  /** The workday's saved legs, in leg order. The stop being logged isn't among them. */
  legs: ParkingSession[]
  /** The last saved leg: the one the question compares with. Null for the first stop. */
  previous: ParkingSession | null
}

export function stopContext(sessions: readonly ParkingSession[], workdayId: string): StopContext {
  const legs = workdayLegs(sessions, workdayId)
  return { legs, previous: legs.length > 0 ? legs[legs.length - 1] : null }
}

/**
 * The same-stretch check for the stop being logged, against the last saved
 * leg (with any area limit carried over the workday, `previousStretchLeg`).
 * `location` is null when the phone's GPS fix isn't in: that location is
 * unreliable, so the check asks. Null for the first stop, which has nothing
 * to compare with and runs on its own sign's limit.
 */
export function stopBoundaryCheck(
  ctx: StopContext,
  reading: WorkdaySignReading,
  location: StretchLocation | null,
  place: Pick<PlaceParts, 'road'> | null | undefined,
): StretchCheck | null {
  const previous = previousStretchLeg(ctx.legs)
  if (!previous || !ctx.previous) return null
  return sameStretchCheck(previous, stretchLegFromReading(reading, location, place))
}

/** An answer the question offered for this check, or null (no answer yet, or one from the other question). */
export function offeredAnswer(check: StretchCheck, answer: BoundaryAnswer | null | undefined): BoundaryAnswer | null {
  return answer && boundaryOptions(check).includes(answer) ? answer : null
}

/**
 * The boundary statement a stop is saved and signed with:
 *   - null for the first stop (nothing was compared);
 *   - `not_asked` when the check didn't ask;
 *   - the driver's answer when it did, as their own statement;
 *   - 'unanswered' when the check asks and no offered answer was given:
 *     Save waits for one (the only step that may block it).
 */
export function stopBoundaryStatement(
  ctx: StopContext,
  check: StretchCheck | null,
  answer: BoundaryAnswer | null | undefined,
): BoundaryStatement | null | 'unanswered' {
  if (!ctx.previous || !check) return null
  if (!check.ask) return buildBoundaryStatement(ctx.previous.id, check, 'not_asked')
  const given = offeredAnswer(check, answer)
  return given ? buildBoundaryStatement(ctx.previous.id, check, given) : 'unanswered'
}

/** What the logger shows once the driver has answered, and what the stop will be saved with. */
export interface StopOutcome {
  /** legDeadline for the stop: its own limit, or the stretch's running one. */
  deadline: LegDeadline
  /**
   * When the limit still running on this stretch started (the arrival of
   * the leg that started it), for "still runs from {{start}}". Null when
   * the stop starts its own limit.
   */
  stretch_start: string | null
  /**
   * When the car has to be off this stretch (or out of the area), for the
   * "Move the car off this stretch by {{deadline}}" and deadline-passed
   * lines: the stop's saved `expires_at` whenever it continues the running
   * limit. That is the stretch deadline, or the new sign's own limit when
   * that ends first, so the time shown always equals the time the record,
   * the card and the reminders use. Null when the stop starts its own limit
   * or no limit in force has an end.
   */
  move_by: string | null
  /** `move_by` is at or before now. */
  move_by_passed: boolean
}

export function stopOutcome(
  ctx: StopContext,
  statement: BoundaryStatement | null,
  signUntil: string | null,
  now: number | Date,
): StopOutcome {
  const deadline = legDeadline({ previous: ctx.previous, sign_until: signUntil, boundary: statement, now })
  const nowMs = now instanceof Date ? now.getTime() : now
  const nowIso = new Date(nowMs).toISOString()
  const stretch_start = deadline.starts_new_limit
    ? null
    : stretchStartedAt([
        ...ctx.legs.map((l) => ({ arrived_at: l.arrived_at, boundary: l.boundary ?? null })),
        { arrived_at: nowIso, boundary: statement },
      ])
  const move_by = !deadline.starts_new_limit && deadline.stretch_deadline ? deadline.expires_at : null
  const moveByMs = move_by === null ? NaN : Date.parse(move_by)
  return { deadline, stretch_start, move_by, move_by_passed: Number.isFinite(moveByMs) && moveByMs <= nowMs }
}

/**
 * Whether the driver's answer names a boundary that starts the stop's own
 * limit ("New limit based on what you told us"). Read from the statement,
 * like `startsNewLimit`, so the line shown always matches the saved limit.
 */
export function answerStartsNewLimit(statement: BoundaryStatement | null): boolean {
  return statement !== null && statement.asked_because.length > 0 && startsNewLimit(statement)
}

/**
 * The time on this stretch has already ended for the answer picked: an
 * answer that keeps the running limit, whose end (`move_by`, the stop's
 * saved expiry) is at or before now. The logger then offers only "Save
 * anyway" and "Don't save this stop".
 */
export function stopDeadlinePassed(
  answer: BoundaryAnswer | null,
  startsNew: boolean,
  outcome: StopOutcome | null,
): boolean {
  return !!answer && !startsNew && !!outcome?.move_by && outcome.move_by_passed
}

/** The limit fields a workday stop is saved with (T6b item 8, T6a item 4). */
export type StopLimitFields = Pick<ParkingSession, 'boundary' | 'stretch_deadline' | 'expires_at'>

/**
 * The limit a stop is saved with, worked out from the record the logger
 * produced (its own sign's `expires_at`, and the `boundary` statement the
 * logger set) and the workday's saved legs:
 *   - `boundary`: the logger's statement; null for the first stop;
 *   - `stretch_deadline`: the running limit's end when the stop continues
 *     it, else null;
 *   - `expires_at`: the earlier of the sign's own limit and the stretch's.
 * A later stop that somehow has no statement counts as unanswered, so the
 * original limit keeps running (legDeadline).
 */
export function stopLimitFields(
  record: Pick<ParkingSession, 'expires_at' | 'boundary'>,
  ctx: StopContext,
): StopLimitFields {
  const boundary = ctx.previous ? (record.boundary ?? null) : null
  const deadline = legDeadline({ previous: ctx.previous, sign_until: record.expires_at ?? null, boundary })
  return { boundary, stretch_deadline: deadline.stretch_deadline, expires_at: deadline.expires_at }
}

/**
 * A logged record that isn't saved as a workday stop after all (T6b item 7:
 * a normal record with its own sign reading): without the logger's
 * boundary statement or a stretch deadline.
 */
export function withoutStopLimit(record: ParkingSession): ParkingSession {
  if (record.boundary === undefined && record.stretch_deadline === undefined) return record
  const out: ParkingSession = { ...record }
  delete out.boundary
  delete out.stretch_deadline
  return out
}
