// The driver's saved permits on the result screen, on the saved record and
// in its reminders (build spec T4 items 4 to 6). Pure: no storage, no
// network, and the clock only where a caller passes it in.
//
// What ParkProof says about permits, and what it never does:
// - The answer card is the STANDARD answer: what the sign says with no
//   permit (the model's can_park_now and until never change for permits).
// - When the sign itself prints an exception for one of the driver's saved
//   permit types, the result screen shows it separately: the sign's own
//   words, and nothing ParkProof worked out.
// - The area match ("Your saved permit for Area 25 matches this zone") is
//   a plain comparison of two labels, done here, never by the model.
// - Nothing here ticks a gate. The driver answers every gate question.
// - A later permit time is only ever the time the driver read off the sign
//   and typed in. ParkProof doesn't calculate permit times or concessions.
import { HEX64_RE } from '../../lambda/addendum-schema.js'
import { draftWithGateAcks } from './evidence-chain'
import { wallClockInZone, type ZonedClockReading } from './time-format'
import type {
  GateAcks,
  LogDraft,
  ParkingRules,
  ParkingSession,
  PermitContext,
  PermitException,
  SavedPermit,
  UserPermitType,
} from '../types'

// ─── The area match ──────────────────────────────────────────────────────

/** Words that only say what kind of label it is ("Area 25", "Permit zone B"). */
const LABEL_WORDS = /(^|\s)(PERMIT|PARKING|AREA|ZONE|NUMBER|NO)(?=\s|\d|$)/g

/**
 * The identifier in a permit area or zone label, for comparing a saved
 * permit's label with the one on the sign: upper case, label words
 * ("Area", "Zone", "Permit", "No") and anything that isn't A-Z or 0-9
 * dropped, leading zeros dropped from numbers. "Area 25", "PERMIT AREA 25"
 * and "25" all give "25"; "Zone 2A" gives "2A". Null when nothing is left
 * to compare.
 */
export function areaKey(label: unknown): string | null {
  if (typeof label !== 'string') return null
  const spaced = label.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]+/g, ' ')
  // Twice: "AREA NO 25" has two label words in a row sharing a space.
  const stripped = spaced.replace(LABEL_WORDS, '$1 ').replace(LABEL_WORDS, '$1 ')
  const parts = stripped
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? String(Number.parseInt(part, 10)) : part))
  const key = parts.join('')
  return key.length > 0 ? key : null
}

export type AreaMatch = 'match' | 'mismatch'

/**
 * Does a saved permit's area label name the same area as the sign's?
 * Null when either side has no identifier to compare (no label, or a label
 * with nothing but label words in it).
 */
export function matchPermitArea(savedArea: unknown, signArea: unknown): AreaMatch | null {
  const saved = areaKey(savedArea)
  const sign = areaKey(signArea)
  if (saved === null || sign === null) return null
  return saved === sign ? 'match' : 'mismatch'
}

// ─── Which saved permit this park may use ────────────────────────────────

/**
 * The sign's printed exception for a permit type, when it applies: the
 * model's entry for that type with `applies` true. Null otherwise.
 */
export function exceptionFor(result: Pick<ParkingRules, 'permit_exception'>, type: UserPermitType): PermitException | null {
  const list: unknown = result.permit_exception
  if (!Array.isArray(list)) return null
  const entry = list.find(
    (e): e is PermitException =>
      !!e && typeof e === 'object' && (e as PermitException).permit_type === type && (e as PermitException).applies === true,
  )
  return entry ?? null
}

/** The result-screen gate a permit question sits in. */
export type PermitGate = 'accessible' | 'permit_zone'

/** A saved permit this park may use, and how the result screen asks about it. */
export interface PermitAnswer {
  permit: SavedPermit
  /** The sign's printed exception for this permit type, when it applies. */
  exception: PermitException | null
  /**
   * The gate that asks about this permit: the accessible-permit gate or the
   * permit-zone gate. Null when no gate is showing, so the permit card asks.
   */
  gate: PermitGate | null
  /** The saved permit's area against the sign's permit area (resident and business only). */
  areaMatch: AreaMatch | null
}

/**
 * The saved permits that can apply to this sign: every usable permit except
 * a resident or business permit whose area the code has found is not the
 * sign's ("Area 12" on a Permit Area 25 sign). Such a permit is never offered
 * for the park, never passes a gate and never gets "may allow more time".
 */
export function permitsForSign(result: Pick<ParkingRules, 'permit_area'>, permits: readonly SavedPermit[]): SavedPermit[] {
  return permits.filter((p) => p.type === 'accessible' || matchPermitArea(p.area, result.permit_area) !== 'mismatch')
}

/** A permit exception the sign prints for one of the driver's saved permit types. */
export interface PrintedException {
  type: UserPermitType
  exception: PermitException
}

/**
 * Every exception the sign prints, and that applies, for a type of permit
 * the driver has saved (and that can apply to this sign): one per type, in
 * saved order. The result screen quotes each one, whichever permit the
 * driver goes on to use for the park.
 */
export function printedExceptions(result: ParkingRules, permits: readonly SavedPermit[]): PrintedException[] {
  const out: PrintedException[] = []
  for (const p of permitsForSign(result, permits)) {
    if (out.some((e) => e.type === p.type)) continue
    const exception = exceptionFor(result, p.type)
    if (exception) out.push({ type: p.type, exception })
  }
  return out
}

/**
 * The area line for the permit-zone gate, worked out from the saved
 * resident and business permits whatever permit the accessible gate uses:
 * the one whose area matches the sign's, else the first whose area doesn't.
 * Null when the sign names no area or no saved permit has one to compare.
 */
export function zoneAreaCheck(
  result: Pick<ParkingRules, 'permit_area'>,
  permits: readonly SavedPermit[],
): { permit: SavedPermit; match: AreaMatch } | null {
  let mismatch: SavedPermit | null = null
  for (const p of permits) {
    if (p.type === 'accessible') continue
    const match = matchPermitArea(p.area, result.permit_area)
    if (match === 'match') return { permit: p, match }
    if (match === 'mismatch' && !mismatch) mismatch = p
  }
  return mismatch ? { permit: mismatch, match: 'mismatch' } : null
}

/** The accessible-permit gate shows: the bay is for permit holders and parking is allowed now. */
export function accessibleGateShows(result: ParkingRules): boolean {
  return result.can_park_now === true && result.requires_disabled_permit === true
}

/** The permit-zone gate shows: a permit zone is in force and parking is allowed now. */
export function permitZoneGateShows(result: ParkingRules): boolean {
  return result.can_park_now === true && result.is_permit_zone === true
}

/**
 * The one saved permit this park may use, or null. `permits` are the
 * driver's usable saved permits (not expired), in saved order.
 *
 * - An accessible permit is relevant when the accessible-permit gate shows
 *   or the sign prints an exception for accessible permits. It comes first.
 * - Otherwise a resident or business permit is relevant when the
 *   permit-zone gate shows or the sign prints an exception for its type.
 *   Of several, the one whose area matches the sign's comes first, then
 *   one the sign prints an exception for, then saved order. A permit whose
 *   area the code has found is not the sign's is never used
 *   (`permitsForSign`): the screen says so and keeps the zone's tick box.
 *
 * At most one permit per park: when a sign has both gates (rare), the other
 * gate keeps its plain tick box.
 */
export function permitAnswerFor(result: ParkingRules, permits: readonly SavedPermit[]): PermitAnswer | null {
  const accessibleGate = accessibleGateShows(result)
  const accessible = permits.find((p) => p.type === 'accessible')
  if (accessible) {
    const exception = exceptionFor(result, 'accessible')
    if (accessibleGate || exception) {
      return { permit: accessible, exception, gate: accessibleGate ? 'accessible' : null, areaMatch: null }
    }
  }

  const zoneGate = permitZoneGateShows(result)
  const candidates = permitsForSign(result, permits).filter(
    (p) => p.type !== 'accessible' && (zoneGate || exceptionFor(result, p.type)),
  )
  if (candidates.length === 0) return null
  const rank = (p: SavedPermit): number =>
    matchPermitArea(p.area, result.permit_area) === 'match' ? 0 : exceptionFor(result, p.type) ? 1 : 2
  // Array.prototype.sort is stable, so equal ranks keep saved order.
  const permit = [...candidates].sort((a, b) => rank(a) - rank(b))[0]
  return {
    permit,
    exception: exceptionFor(result, permit.type),
    gate: zoneGate ? 'permit_zone' : null,
    areaMatch: matchPermitArea(permit.area, result.permit_area),
  }
}

/**
 * Show "Your permit may allow more time under {{state}} rules..."? Only
 * when the driver holds a usable permit that can apply to this sign (not a
 * permit for another area), the sign prints no exception for any of their
 * permit types, and the standard answer is a time limit (you can park now,
 * until a set time). ParkProof never says how much more.
 */
export function showsMayAllowMore(result: ParkingRules, permits: readonly SavedPermit[]): boolean {
  const relevant = permitsForSign(result, permits)
  if (relevant.length === 0) return false
  if (result.can_park_now !== true || typeof result.until !== 'string' || !Number.isFinite(Date.parse(result.until))) {
    return false
  }
  return !relevant.some((p) => exceptionFor(result, p.type))
}

// ─── The permit time the driver typed in ─────────────────────────────────

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

// The zone's wall clock comes from time-format.ts's wallClockInZone, the
// app's one reading of a zone's clock (notice-match.ts uses it too).

/** The zone's offset from UTC at an instant, in ms (whole minutes). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const p = wallClockInZone(instant, timeZone)
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute)
  return wall - Math.floor(instant / 60_000) * 60_000
}

const DAY_MS = 24 * 60 * 60_000

/**
 * The next time the clock in `timeZone` reads `hhmm` ('HH:MM', 24 hour),
 * strictly after `now`: today if that time is still to come there, else
 * tomorrow. So it is always within 24 hours. Null for an invalid time or
 * zone. A time in the hour skipped when daylight saving starts comes out
 * an hour later, as the clock would show it. A time in the hour repeated
 * when daylight saving ends is the first of the two that is still to come.
 */
export function nextWallClockTime(hhmm: string, timeZone: string, now: Date): Date | null {
  const m = HHMM_RE.exec(hhmm)
  if (!m || !Number.isFinite(now.getTime())) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  let today: ZonedClockReading
  try {
    today = wallClockInZone(now.getTime(), timeZone)
  } catch {
    return null
  }
  for (const addDays of [0, 1, 2]) {
    const wall = Date.UTC(today.year, today.month - 1, today.day + addDays, hour, minute)
    const date = new Date(wall)
    // Every instant that day when the clock reads hh:mm: one normally, two
    // in the hour repeated when daylight saving ends. The zone's offsets a
    // day either side cover both sides of any change that day.
    const offsets = new Set([DAY_MS, 0, -DAY_MS].map((shift) => zoneOffsetMs(wall + shift, timeZone)))
    const exact = [...offsets]
      .map((offset) => wall - offset)
      .filter((instant) => {
        const p = wallClockInZone(instant, timeZone)
        return (
          p.year === date.getUTCFullYear() &&
          p.month === date.getUTCMonth() + 1 &&
          p.day === date.getUTCDate() &&
          p.hour === hour &&
          p.minute === minute
        )
      })
      .sort((a, b) => a - b)
    if (exact.length === 0) {
      // The hour skipped when daylight saving starts: two passes, as the
      // offset at the first guess is on the other side of the change.
      let instant = wall - zoneOffsetMs(wall, timeZone)
      instant = wall - zoneOffsetMs(instant, timeZone)
      exact.push(instant)
    }
    const next = exact.find((instant) => instant > now.getTime())
    if (next !== undefined) return new Date(next)
  }
  return null
}

/**
 * The permit time the driver typed ('HH:MM') as an instant, when it is
 * later than the standard limit: the next time the parking spot's clock
 * reads that time. Null when nothing usable was typed, there is no
 * standard limit, or the time isn't later than it.
 */
export function laterPermitTime(
  hhmm: string,
  standardUntil: string | null | undefined,
  timeZone: string,
  now: Date,
): Date | null {
  if (typeof standardUntil !== 'string') return null
  const standard = Date.parse(standardUntil)
  if (!Number.isFinite(standard)) return null
  const at = nextWallClockTime(hhmm, timeZone, now)
  return at && at.getTime() > standard ? at : null
}

// ─── What the result screen hands to the logger ──────────────────────────

/** The driver's answer to a permit question: "Yes", "No", or not answered yet. */
export type PermitCheck = 'yes' | 'no' | null

const toUtcIso = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * The permit context saved on the record (N1), or null when the driver
 * didn't confirm the permit for this park (answered "No", or didn't
 * answer). It is never signed as it stands: link 1 signs only a commitment
 * to it (N3, `permitCommitmentFor` in signing.ts).
 *
 * - `holder_present`: true for an accessible permit (the driver confirmed
 *   the holder is in the car and getting out here); null for resident and
 *   business permits.
 * - `standard_until`: the sign's standard answer, in UTC.
 * - `permit_until`: the later time the driver typed in, only when the sign
 *   prints an exception for this permit and the time is later than the
 *   standard limit. Otherwise null.
 */
export function buildPermitContext(
  answer: PermitAnswer,
  result: Pick<ParkingRules, 'until'>,
  check: PermitCheck,
  permitUntil: Date | null,
): PermitContext | null {
  if (check !== 'yes') return null
  const standard = toUtcIso(result.until)
  const later =
    answer.exception && standard && permitUntil && permitUntil.getTime() > Date.parse(standard)
      ? permitUntil.toISOString()
      : null
  return {
    type: answer.permit.type,
    area: answer.permit.type === 'accessible' ? null : answer.permit.area,
    holder_present: answer.permit.type === 'accessible' ? true : null,
    sign_exception_applies: answer.exception !== null,
    standard_until: standard,
    permit_until: later,
    note: null,
  }
}

/** What the result screen adds to the draft when the driver goes on to log the park. */
export interface ResultAnswers {
  gate_acks: GateAcks
  permit_context: PermitContext | null
}

const isAck = (v: unknown): v is boolean | null => v === null || typeof v === 'boolean'
const PERMIT_TYPES: readonly string[] = ['accessible', 'resident', 'business']

function isPermitContext(v: unknown): v is PermitContext {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const c = v as Record<string, unknown>
  const strOrNull = (x: unknown) => x === null || typeof x === 'string'
  return (
    typeof c.type === 'string' &&
    PERMIT_TYPES.includes(c.type) &&
    strOrNull(c.area) &&
    isAck(c.holder_present) &&
    typeof c.sign_exception_applies === 'boolean' &&
    strOrNull(c.standard_until) &&
    strOrNull(c.permit_until) &&
    strOrNull(c.note)
  )
}

/**
 * The draft with the result screen's answers in: the gate answers and the
 * permit context. This is the one path from the result screen into the
 * logging draft: the gate answers go through draftWithGateAcks, so they
 * reach the record's `gate_acks` and arrival_context. Anything that isn't
 * one of those (a click event from a caller that passes nothing on) leaves
 * the draft as it was, the same object, and so do answers that change
 * nothing (no gate asked, no permit), so a scan keeps one draft from scan
 * to save. Pure: a draft with answers that change it is a new object.
 */
export function withResultAnswers(draft: LogDraft, answers: unknown): LogDraft {
  if (!answers || typeof answers !== 'object') return draft
  const a = answers as Record<string, unknown>
  let out = draft
  const acks = a.gate_acks as Record<string, unknown> | undefined
  if (acks && typeof acks === 'object' && isAck(acks.meter_ticket) && isAck(acks.permit_zone) && isAck(acks.accessible_permit)) {
    out = draftWithGateAcks(out, {
      meter_ticket: acks.meter_ticket,
      permit_zone: acks.permit_zone,
      accessible_permit: acks.accessible_permit,
    })
  }
  if (a.permit_context === null) {
    if (out.permit_context !== null) out = { ...out, permit_context: null }
  } else if (isPermitContext(a.permit_context)) {
    out = { ...out, permit_context: { ...a.permit_context } }
  }
  return out
}

// ─── Reminders on a record whose permit allows a later time ──────────────

/** How close a fire time must be to the standard limit to be its own reminder. */
const SAME_MOMENT_MS = 30_000

type PermitRecord = Pick<ParkingSession, 'permit_context' | 'expires_at'>

/**
 * The permit time a record's reminders count down to: `permit_until` when
 * the sign prints an exception for the permit the driver used and the time
 * they typed in is later than the standard limit (`expires_at`, which stays
 * the sign's standard answer and is what link 0 signs). Null otherwise.
 */
export function permitAdjustedUntil(session: PermitRecord): string | null {
  const pc = session.permit_context
  if (!pc || pc.sign_exception_applies !== true || pc.holder_present === false) return null
  const permit = typeof pc.permit_until === 'string' ? Date.parse(pc.permit_until) : NaN
  const standard = typeof session.expires_at === 'string' ? Date.parse(session.expires_at) : NaN
  if (!Number.isFinite(permit) || !Number.isFinite(standard) || permit <= standard) return null
  return pc.permit_until
}

/** What a record's expiry reminders count down to: the permit time when there is one, else `expires_at`. */
export function reminderAnchor(session: PermitRecord): string | null {
  return permitAdjustedUntil(session) ?? session.expires_at ?? null
}

/**
 * On a record whose permit allows a later time, is this the extra reminder
 * at the standard limit ("The standard limit on this sign ends now...")?
 */
export function isStandardLimitReminder(session: PermitRecord, fireAt: Date): boolean {
  if (!permitAdjustedUntil(session)) return false
  return Math.abs(fireAt.getTime() - Date.parse(session.expires_at as string)) < SAME_MOMENT_MS
}

/**
 * The most push reminders one record can have: `/push/schedule` refuses
 * more (PUSH_MAX_REMINDERS_PER_SESSION in lambda/index.js), and then sets
 * none of them.
 */
export const MAX_PUSH_REMINDERS = 6

/** Reminders closer than this to the moment they're due are too late to set (SAFETY_MARGIN_MS in notifications.ts). */
const TOO_SOON_MS = 30_000

/**
 * Every reminder time to set for a record, earliest first, one per moment:
 * the picked times, plus, on a record whose permit allows a later time, the
 * reminder when the standard limit ends (while it is at least 30 s away).
 * A picked time at the same moment as the standard limit, or as another
 * picked time, adds nothing: the reminder already at that moment covers
 * it. Never capped here: callers keep the total at MAX_PUSH_REMINDERS.
 */
export function reminderFireTimes(session: PermitRecord, picked: readonly Date[], now: number): Date[] {
  const times: Date[] = []
  if (permitAdjustedUntil(session)) {
    const standard = Date.parse(session.expires_at as string)
    if (standard - now >= TOO_SOON_MS) times.push(new Date(standard))
  }
  for (const at of picked) {
    const ms = at.getTime()
    if (!Number.isFinite(ms)) continue
    if (times.some((t) => Math.abs(t.getTime() - ms) < SAME_MOMENT_MS)) continue
    times.push(new Date(ms))
  }
  return times.sort((a, b) => a.getTime() - b.getTime())
}

/** True for a usable permit salt (`generatePermitSalt` in signing.ts): 64 lowercase hex characters. */
export function isPermitSalt(value: unknown): value is string {
  return typeof value === 'string' && HEX64_RE.test(value)
}
