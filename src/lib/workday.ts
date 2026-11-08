import type { TFunction } from 'i18next'
import type {
  BoundaryAnswer,
  BoundaryAskedBecause,
  BoundaryStatement,
  ParkingRules,
  ParkingSession,
} from '../types'
import { CAPS } from '../../lambda/addendum-schema.js'
import { ACCURACY_USABLE_M } from './accuracy'
import { sessionLink } from './deep-link'
import { haversineMeters } from './geo'
import type { ScheduledReminder } from './push'
import { formatExpiryAbsolute } from './time-format'
import { sessionTimezone } from './timezone'

/**
 * Workday mode's safety maths (build spec T6a items 3 to 5). Pure: no
 * storage, no clock unless one is passed in, no network.
 *
 * The law this follows (docs/research/03-workday-shuffle.md): continuous
 * parking runs until the car leaves the signed length of road, or the whole
 * area under an area sign (Road Rules r205(2), r332, r335). Moving a few
 * bays along doesn't restart the limit, and the app can't see where a
 * signed length ends. So every rule here fails safe: when the app can't
 * tell, it asks, and when the driver doesn't name a boundary, the original
 * limit keeps running.
 *
 * The distances below only decide when to ask the boundary question. They
 * are never a legal distance and no copy may present them as one (there is
 * no minimum re-parking distance in any rule).
 */

// ─── 3. Same-stretch check ─────────────────────────────────────────────────

/** Ask when the new park is this close to the previous one (metres, inclusive). */
export const SAME_SPOT_M = 30
/** Ask when both parks are on the same road and this close (metres, inclusive). */
export const SAME_ROAD_M = 150
/** Ask when both signs read the same and the parks are this close (metres, inclusive). */
export const SAME_SIGN_TEXT_M = 300
/** A GPS fix worse than this (metres) is unreliable. Same threshold as the logger's. */
export const UNRELIABLE_ACCURACY_M = ACCURACY_USABLE_M

/** A leg's location as saved on a record (`ParkingSession.location`). */
export interface StretchLocation {
  lat: number
  lng: number
  source?: 'gps' | 'manual' | null
  accuracy_meters?: number | null
}

/**
 * What the same-stretch check needs to know about one leg. Build it with
 * `stretchLegFromRecord` for a saved leg, or `stretchLegFromReading` for
 * the leg being logged.
 */
export interface StretchLeg {
  location: StretchLocation | null
  /** `place.road` from the reverse geocode; null when unknown. */
  road: string | null
  /** The sign reading's factual description (`rules`); null when there is none. */
  sign_text: string | null
  /**
   * True when the sign governs an area, not a length of road (T3). Null
   * when unknown (a reading or record from before T3): then the sign text
   * decides, see `isAreaSignLeg`.
   */
  is_area_sign: boolean | null
  /**
   * The limit running on this leg is an area limit, whatever its own sign
   * says: it kept an earlier leg's area limit running (the driver answered
   * "I'm not sure" to the area question). Set on a saved leg by
   * `stretchLegFromRecord` (`legInAreaMode`) or, over the whole workday, by
   * `previousStretchLeg` (`stretchInAreaMode`). Absent on the leg being
   * logged, whose limit depends on the answer.
   */
  area_limit?: boolean
}

/** Sign text that names an area ("2P Parking Area", "Area ends"). */
const AREA_WORD_RE = /\barea\b/i

/**
 * Whether a leg's sign governs an area (r335), so the car has to leave the
 * whole area. T3's `is_area_sign` decides whenever it is known. When it is
 * unknown (a reading or record from before T3), the sign text decides: text
 * that names an area counts as an area sign. That is the fail-safe reading,
 * because area mode always asks and only "I drove out of the parking area"
 * starts a new limit. A permit-area label ("Permit Area 25") matches too,
 * which only asks more than needed.
 */
export function isAreaSignLeg(leg: Pick<StretchLeg, 'is_area_sign' | 'sign_text'>): boolean {
  if (typeof leg.is_area_sign === 'boolean') return leg.is_area_sign
  return typeof leg.sign_text === 'string' && AREA_WORD_RE.test(leg.sign_text)
}

/** A leg under an area limit: its own sign is an area sign, or it carried an area limit over. */
const underAreaLimit = (leg: StretchLeg): boolean => leg.area_limit === true || isAreaSignLeg(leg)

/**
 * The parts of a sign reading the workday maths uses: T3's answer
 * (`ParkingRules`, after the clarify merge). `is_area_sign` and
 * `sign_status` are absent on an answer from a server older than T3, which
 * reads as "not known". A saved leg's area flag is `rule_flags.is_area_sign`
 * (T3's signReadingFields), read by `stretchLegFromRecord`.
 */
export type WorkdaySignReading = Pick<ParkingRules, 'rules' | 'until' | 'is_area_sign' | 'sign_status'>

export interface StretchLegFromRecordOptions {
  /**
   * The limit running on this leg is an area limit, for example
   * `stretchInAreaMode(workdayLegs(...))`. It can only add area mode: a
   * leg that `legInAreaMode` finds under an area limit always has it.
   */
  area_limit?: boolean
}

/**
 * A saved record as a leg for the same-stretch check. `area_limit` is set
 * when the leg itself shows an area limit (`legInAreaMode`: its own area
 * sign, or an area limit it kept running), so the next move inside the area
 * gets the area question again, not the stretch one.
 */
export function stretchLegFromRecord(
  session: Pick<ParkingSession, 'location' | 'place' | 'rules' | 'rule_flags' | 'boundary'>,
  options: StretchLegFromRecordOptions = {},
): StretchLeg {
  return {
    location: session.location ?? null,
    road: session.place?.road ?? null,
    sign_text: session.rules || null,
    is_area_sign: session.rule_flags?.is_area_sign ?? null,
    area_limit: options.area_limit === true || legInAreaMode(session),
  }
}

/**
 * The previous leg for the next move's same-stretch check: the last of a
 * workday's legs (pass them in leg order, `workdayLegs`), under an area
 * limit when `stretchInAreaMode` finds one running over the whole workday.
 * This is the entry point for the logger: it catches an area limit carried
 * over several moves even where the last leg's own record can't show it.
 * Null for no legs.
 */
export function previousStretchLeg(
  legs: readonly (Pick<ParkingSession, 'location' | 'place'> & AreaModeLeg)[],
): StretchLeg | null {
  if (legs.length === 0) return null
  return stretchLegFromRecord(legs[legs.length - 1], { area_limit: stretchInAreaMode(legs) })
}

/** The leg being logged: the fresh sign reading plus the logger's location and place. */
export function stretchLegFromReading(
  reading: WorkdaySignReading,
  location: StretchLocation | null,
  place: { road: string | null } | null | undefined,
): StretchLeg {
  return {
    location,
    road: place?.road ?? null,
    sign_text: reading.rules || null,
    is_area_sign: reading.is_area_sign ?? null,
  }
}

const hasCoords = (loc: StretchLocation | null): loc is StretchLocation =>
  !!loc &&
  typeof loc.lat === 'number' &&
  typeof loc.lng === 'number' &&
  Number.isFinite(loc.lat) &&
  Number.isFinite(loc.lng) &&
  Math.abs(loc.lat) <= 90 &&
  Math.abs(loc.lng) <= 180

/**
 * A location the check can rely on: a phone GPS fix with a known accuracy
 * of at most 100 m. Missing, typed in (manual), unknown accuracy (including
 * older records with no `source`), or worse than 100 m is unreliable.
 */
export function isReliableLocation(loc: StretchLocation | null | undefined): boolean {
  if (!hasCoords(loc ?? null)) return false
  const l = loc as StretchLocation
  if (l.source !== 'gps') return false
  const acc = l.accuracy_meters
  if (typeof acc !== 'number' || !Number.isFinite(acc) || acc < 0) return false
  return acc <= UNRELIABLE_ACCURACY_M
}

const ROAD_WORDS: Readonly<Record<string, string>> = Object.freeze({
  st: 'street',
  rd: 'road',
  ave: 'avenue',
  av: 'avenue',
  pde: 'parade',
  hwy: 'highway',
  cres: 'crescent',
  cct: 'circuit',
  ct: 'court',
  pl: 'place',
  dr: 'drive',
  tce: 'terrace',
  bvd: 'boulevard',
  blvd: 'boulevard',
  ln: 'lane',
  cl: 'close',
  sq: 'square',
  gr: 'grove',
  esp: 'esplanade',
  hts: 'heights',
  mt: 'mount',
})

/** Road names compared case-, punctuation- and abbreviation-blind ("Smith St." = "smith street"). */
export function normaliseRoad(road: string | null | undefined): string | null {
  if (typeof road !== 'string') return null
  const words = road
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => ROAD_WORDS[w] ?? w)
  return words.length ? words.join(' ') : null
}

const DAY_WORDS: Readonly<Record<string, string>> = Object.freeze({
  monday: 'mon',
  tuesday: 'tue',
  tues: 'tue',
  wednesday: 'wed',
  thursday: 'thu',
  thur: 'thu',
  thurs: 'thu',
  friday: 'fri',
  saturday: 'sat',
  sunday: 'sun',
})

/** Joining words two readings use differently ("Mon to Fri", "Mon-Fri"). */
const FILLER_WORDS: ReadonlySet<string> = new Set(['to', 'and', 'the', 'from', 'until', 'till'])

/**
 * Sign text compared the way two readings of the same sign tend to differ:
 * case, punctuation, dash style, "8:00 am" against "8am", "2 hour" against
 * "2P", day names written out, joining words, and word order. Order-blind
 * on purpose: two readings that list the same parts in a different order
 * match. A false match only asks the boundary question when it wasn't
 * needed, which is the safe direction.
 */
export function normaliseSignText(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  const s = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\b(\d{1,2})[:.]00\s*([ap])\.?\s*m\b\.?/g, '$1$2m')
    .replace(/\b(\d{1,2})([:.]\d{2})?\s+([ap])\.?\s*m\b\.?/g, '$1$2$3m')
    .replace(/\b([ap])\.m\.?/g, '$1m')
    .replace(/\b(\d{1,2})\s*-?\s*(?:hours?|hrs?)\b/g, '$1p')
  const tokens = s
    .split(/[^\p{L}\p{N}:]+/u)
    .map((w) => w.replace(/^:+|:+$/g, ''))
    .filter((w) => w && !FILLER_WORDS.has(w))
    .map((w) => DAY_WORDS[w] ?? w)
  return tokens.length ? tokens.sort().join(' ') : null
}

/** Canonical order of the reasons, as the signed `asked_because` lists them. */
const REASON_ORDER: readonly BoundaryAskedBecause[] = [
  'within_30m',
  'same_street',
  'same_sign_text',
  'area_sign',
  'location_unreliable',
]

export interface StretchCheck {
  /** Ask the boundary question. True whenever any reason holds. */
  ask: boolean
  /**
   * Either leg has an area sign, or the previous leg was still under an
   * area limit carried over from an earlier leg: the car has to leave the
   * whole area, so the question is the area one and only
   * `left_parking_area` starts a new limit.
   */
  area_mode: boolean
  /** Why it asks, in canonical order. Empty when it doesn't. */
  asked_because: BoundaryAskedBecause[]
  /**
   * Distance between the two parks from phone GPS, to 0.1 m. Null unless
   * both locations are GPS fixes (a typed address is not a measurement).
   */
  distance_from_previous_m: number | null
}

export interface StretchCheckOptions {
  /** Distance in metres between two points. Defaults to the haversine distance. Tests inject exact values. */
  distance?: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => number
}

/**
 * Same-stretch check (build spec T6a item 3): whether to ask the driver
 * which boundary they passed, and why. It asks when any of these hold:
 *   - `within_30m`: the parks are at most 30 m apart;
 *   - `same_street`: same road and at most 150 m apart;
 *   - `same_sign_text`: the signs read the same and at most 300 m apart;
 *   - `area_sign`: either leg has an area sign (area mode: always asks),
 *     as `isAreaSignLeg` decides, or the previous leg is still under an
 *     area sign's limit that it carried over (`area_limit`), because
 *     moving to another street inside the area doesn't end it;
 *   - `location_unreliable`: either location is missing, typed in, of
 *     unknown accuracy or worse than 100 m.
 * The distance tests use phone GPS only; with a typed address the location
 * is unreliable, so it asks anyway. Each reason is signed in the leg's
 * arrival_context, so a reason is recorded only when it is literally true:
 * an unknown road just means the same-street test finds no match.
 */
export function sameStretchCheck(
  previous: StretchLeg,
  next: StretchLeg,
  options: StretchCheckOptions = {},
): StretchCheck {
  const distanceFn = options.distance ?? haversineMeters
  const reasons = new Set<BoundaryAskedBecause>()

  const gpsPair =
    hasCoords(previous.location) &&
    hasCoords(next.location) &&
    previous.location.source === 'gps' &&
    next.location.source === 'gps'
  const rawDistance = gpsPair ? distanceFn(previous.location!, next.location!) : null
  const distance = rawDistance !== null && Number.isFinite(rawDistance) && rawDistance >= 0 ? rawDistance : null

  if (distance !== null) {
    if (distance <= SAME_SPOT_M) reasons.add('within_30m')
    const roadA = normaliseRoad(previous.road)
    const roadB = normaliseRoad(next.road)
    if (distance <= SAME_ROAD_M && roadA !== null && roadA === roadB) reasons.add('same_street')
    const signA = normaliseSignText(previous.sign_text)
    const signB = normaliseSignText(next.sign_text)
    if (distance <= SAME_SIGN_TEXT_M && signA !== null && signA === signB) reasons.add('same_sign_text')
  }
  if (underAreaLimit(previous) || underAreaLimit(next)) reasons.add('area_sign')
  if (!isReliableLocation(previous.location) || !isReliableLocation(next.location) || distance === null) {
    reasons.add('location_unreliable')
  }

  const asked_because = REASON_ORDER.filter((r) => reasons.has(r))
  return {
    ask: asked_because.length > 0,
    area_mode: reasons.has('area_sign'),
    asked_because,
    distance_from_previous_m: distance === null ? null : Math.round(distance * 10) / 10,
  }
}

/** The answers to the normal question that name a r332 boundary. */
export const STRETCH_BOUNDARY_ANSWERS: readonly BoundaryAnswer[] = Object.freeze([
  'opposite_direction_sign',
  'yellow_edge_line',
  't_intersection_or_dead_end',
])

/** The answers offered for a check: the area question in area mode, else the stretch question. */
export function boundaryOptions(check: Pick<StretchCheck, 'area_mode'>): BoundaryAnswer[] {
  return check.area_mode ? ['left_parking_area', 'not_sure'] : [...STRETCH_BOUNDARY_ANSWERS, 'not_sure']
}

/**
 * The boundary statement for a new leg (signed in its arrival_context).
 * When the check didn't ask, the answer is always `not_asked`. When it did,
 * the driver's answer is recorded as given: their own statement, never
 * something the app confirmed.
 */
export function buildBoundaryStatement(
  previousSessionId: string,
  check: StretchCheck,
  answer: BoundaryAnswer,
): BoundaryStatement {
  return {
    previous_session_id: previousSessionId.slice(0, CAPS.previousSessionId),
    asked_because: [...check.asked_because],
    answer: check.ask ? answer : 'not_asked',
    distance_from_previous_m: check.distance_from_previous_m,
  }
}

// ─── 4. Deadline maths ─────────────────────────────────────────────────────

/**
 * Whether a leg's boundary statement starts a new limit (build spec T6a
 * item 4). Self-contained, so it can be re-derived from a signed record:
 *   - not asked (`asked_because` empty): a new limit, unless the answer is
 *     `not_sure`;
 *   - area mode (`area_sign` among the reasons): only `left_parking_area`;
 *   - otherwise: only a r332 boundary (opposite-arrow sign, yellow edge
 *     line, T-intersection or dead end).
 * Everything else keeps the original limit running: `not_sure`, no answer,
 * `not_asked` after the question fired, an answer the question didn't
 * offer, and a missing or malformed statement.
 */
export function startsNewLimit(
  boundary: Pick<BoundaryStatement, 'asked_because' | 'answer'> | null | undefined,
): boolean {
  if (!boundary || typeof boundary !== 'object' || !Array.isArray(boundary.asked_because)) return false
  const { asked_because, answer } = boundary
  if (answer === 'not_sure') return false
  if (asked_because.length === 0) return true
  if (asked_because.includes('area_sign')) return answer === 'left_parking_area'
  return STRETCH_BOUNDARY_ANSWERS.includes(answer)
}

/** Parse a time; null when missing or unparseable. */
function timeMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

const nowMs = (now: number | Date | undefined): number =>
  now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.now()

export interface LegDeadlineInput {
  /**
   * The previous leg on this workday, as saved. Null for the first leg
   * (leg 0), which always runs on its own sign's limit.
   */
  previous: Pick<ParkingSession, 'expires_at' | 'stretch_deadline'> | null
  /** The new leg's own sign answer (the reading's `until`, or the chosen variant's). */
  sign_until: string | null
  /** The new leg's boundary statement. Null after a previous leg counts as unanswered. */
  boundary: Pick<BoundaryStatement, 'asked_because' | 'answer'> | null
  /** Defaults to Date.now(). Only decides `deadline_passed`. */
  now?: number | Date
}

export interface LegDeadline {
  /** The boundary statement starts a new limit (or this is leg 0). */
  starts_new_limit: boolean
  /**
   * When the limit running on this stretch ends (UTC ISO with Z, as signed
   * in arrival_context). Set only when the leg continues a running limit
   * that has an end: the deadline in force on the previous leg, the earlier
   * of its `stretch_deadline` and `expires_at` (whichever can be read).
   * Null when a new limit starts.
   */
  stretch_deadline: string | null
  /**
   * The new leg's expiry: the earlier of its own sign answer and
   * `stretch_deadline`. The sign's own string when that is earlier (kept as
   * the model wrote it), `stretch_deadline` otherwise (and on a tie).
   */
  expires_at: string | null
  /** Which of the two set `expires_at`; null when neither has a time. */
  limited_by: 'sign' | 'stretch' | null
  /** `stretch_deadline` is at or before `now`: the time on this stretch has already ended. */
  deadline_passed: boolean
}

/**
 * Deadline maths for a new leg (build spec T6a item 4). When the leg
 * continues the previous leg's stretch (`not_sure`, or the question fired
 * and wasn't answered with a boundary), the previous limit keeps running:
 * `stretch_deadline` is the deadline in force on the previous leg, the
 * earlier of its `stretch_deadline` and its `expires_at`, and the new leg
 * can't run past it. The earlier one, because the previous leg's own sign
 * may have set a shorter limit than the stretch it continued (a 1P sign
 * after a 2P one): a driver who isn't sure they left that 1P length is
 * still on its limit. A boundary answer starts the new leg's own limit; in
 * area mode only `left_parking_area` does.
 */
export function legDeadline(input: LegDeadlineInput): LegDeadline {
  const ownMs = timeMs(input.sign_until)
  const ownExpiry = ownMs === null ? null : input.sign_until
  const fresh = input.previous === null || startsNewLimit(input.boundary)

  let stretchMs: number | null = null
  if (!fresh && input.previous) {
    const inForce = [timeMs(input.previous.stretch_deadline), timeMs(input.previous.expires_at)].filter(
      (ms): ms is number => ms !== null,
    )
    stretchMs = inForce.length ? Math.min(...inForce) : null
  }
  if (stretchMs === null) {
    return {
      starts_new_limit: fresh,
      stretch_deadline: null,
      expires_at: ownExpiry,
      limited_by: ownExpiry === null ? null : 'sign',
      deadline_passed: false,
    }
  }
  const stretch_deadline = new Date(stretchMs).toISOString()
  const signFirst = ownMs !== null && ownMs < stretchMs
  return {
    starts_new_limit: false,
    stretch_deadline,
    expires_at: signFirst ? ownExpiry : stretch_deadline,
    limited_by: signFirst ? 'sign' : 'stretch',
    deadline_passed: stretchMs <= nowMs(input.now),
  }
}

/** One leg as the stretch-start walk needs it. */
export interface StretchStartLeg {
  arrived_at: string
  boundary?: Pick<BoundaryStatement, 'asked_because' | 'answer'> | null
}

/**
 * When the limit running on the last leg's stretch started: the arrival of
 * the most recent leg that started a new limit (leg 0 always does). For
 * the "still runs from {{start}}" line, pass the saved legs in leg order
 * plus the leg being logged with its boundary. Null for no legs.
 */
export function stretchStartedAt(legs: readonly StretchStartLeg[]): string | null {
  if (legs.length === 0) return null
  let i = legs.length - 1
  while (i > 0 && !startsNewLimit(legs[i].boundary)) i--
  return legs[i].arrived_at
}

/** A workday's legs among the saved records, in leg order. Read-only shared copies are not legs. */
export function workdayLegs(sessions: readonly ParkingSession[], workdayId: string): ParkingSession[] {
  return sessions
    .filter((s) => s.workday_id === workdayId && !s.shared_from && Number.isInteger(s.leg_index))
    .sort((a, b) => (a.leg_index as number) - (b.leg_index as number) || Date.parse(a.arrived_at) - Date.parse(b.arrived_at))
}

/** The highest leg index the signed `workday` link accepts. */
export const MAX_LEG_INDEX = CAPS.legIndexMax

/** The next leg's index on a workday: one more than the highest saved, 0 for the first. Null past MAX_LEG_INDEX. */
export function nextLegIndex(sessions: readonly ParkingSession[], workdayId: string): number | null {
  const legs = workdayLegs(sessions, workdayId)
  const next = legs.length ? (legs[legs.length - 1].leg_index as number) + 1 : 0
  return next <= MAX_LEG_INDEX ? next : null
}

// ─── 5. Reminder schedule ──────────────────────────────────────────────────

/** Heads-up this long before the deadline (minutes). */
export const HEADS_UP_BEFORE_MIN = 45
/** Time to find a park plus a margin, added to the walk for the go-now reminder (minutes). */
export const SEARCH_AND_MARGIN_MIN = 15
/**
 * Walk time when it isn't known (minutes), and the least the go-now
 * reminder ever allows for. Reminders are scheduled when a leg is saved,
 * with the driver standing at the car, where walk-back.ts measures about a
 * minute; allowing for less would only make "leave now" come later.
 */
export const DEFAULT_WALK_MIN = 10
/**
 * The soonest a reminder is planned, counted from now (ms). `/push/schedule`
 * skips any reminder less than 30 s ahead by the server's clock, so one
 * planned closer than that would be dropped without a word. 60 s leaves room
 * for the request and for the phone's clock being a little off.
 */
export const MIN_SCHEDULE_LEAD_MS = 60_000

export type WorkdayReminderKind = 'heads_up' | 'go_now' | 'at_deadline'

export interface WorkdayReminder {
  kind: WorkdayReminderKind
  /** When to fire (UTC ISO with Z). */
  fire_at: string
  /** The deadline the copy names (UTC ISO with Z). */
  deadline: string
}

export interface WorkdayReminderInput {
  /** The leg's deadline: its `expires_at` from legDeadline. Null: nothing to schedule. */
  deadline: string | Date | null
  /**
   * Walk time back to the car in minutes (`estimateWalkBack(...).minutes`),
   * measured from where the driver will be. Null when unknown, which it is
   * when a leg is saved (the driver is at the car). The go-now reminder
   * never allows for less than DEFAULT_WALK_MIN.
   */
  walk_minutes?: number | null
  /** Defaults to Date.now(). */
  now?: number | Date
}

/**
 * The walk time the go-now reminder allows for: whole minutes, rounded up,
 * and at least 10 (also when unknown or invalid). There is no upper cap: a
 * longer walk only moves "leave now" earlier, never later.
 */
export function walkAllowanceMinutes(walk: number | null | undefined): number {
  if (typeof walk !== 'number' || !Number.isFinite(walk) || walk < 0) return DEFAULT_WALK_MIN
  return Math.max(DEFAULT_WALK_MIN, Math.ceil(walk))
}

const MIN_MS = 60_000

/**
 * The reminders for one leg (build spec T6a item 5), soonest first:
 *   - `heads_up` at the deadline minus 45 minutes;
 *   - `go_now` at the deadline minus the walk time (at least 10 minutes)
 *     minus 15 minutes;
 *   - `at_deadline` at the deadline ("Your time on this stretch ended at").
 * Times are absolute instants, so a DST change between now and the
 * deadline moves nothing.
 *
 * Nothing is planned less than MIN_SCHEDULE_LEAD_MS from now (the push
 * route would skip it), so a deadline that has passed gives none. Go-now is
 * the one exception to dropping: when its time has already come but the
 * deadline is still ahead (a leg saved close to a deadline it carried over),
 * it fires as soon as the push route accepts it, so the driver still gets a
 * "leave now" before the deadline. The heads-up is kept even when a long
 * walk puts it after go-now (a second nudge if go-now is missed), and is
 * dropped only when it falls at the same instant as go-now.
 */
export function workdayReminderSchedule(input: WorkdayReminderInput): WorkdayReminder[] {
  const deadlineMs =
    input.deadline instanceof Date ? input.deadline.getTime() : timeMs(input.deadline ?? null)
  if (deadlineMs === null || !Number.isFinite(deadlineMs)) return []
  const deadline = new Date(deadlineMs).toISOString()
  const earliest = nowMs(input.now) + MIN_SCHEDULE_LEAD_MS
  const headsUpMs = deadlineMs - HEADS_UP_BEFORE_MIN * MIN_MS
  const goNowMs = Math.max(
    deadlineMs - (walkAllowanceMinutes(input.walk_minutes) + SEARCH_AND_MARGIN_MIN) * MIN_MS,
    earliest,
  )

  const planned: Array<{ kind: WorkdayReminderKind; ms: number }> = []
  if (headsUpMs !== goNowMs) planned.push({ kind: 'heads_up', ms: headsUpMs })
  if (goNowMs < deadlineMs) planned.push({ kind: 'go_now', ms: goNowMs })
  planned.push({ kind: 'at_deadline', ms: deadlineMs })

  return planned
    .filter((r) => r.ms >= earliest)
    .sort((a, b) => a.ms - b.ms)
    .map((r) => ({ kind: r.kind, fire_at: new Date(r.ms).toISOString(), deadline }))
}

/** i18n key for each reminder's body on a signed length of road. Each takes {{time}}, the deadline. */
export const WORKDAY_REMINDER_KEYS: Readonly<Record<WorkdayReminderKind, string>> = Object.freeze({
  heads_up: 'workday.reminder.headsUp',
  go_now: 'workday.reminder.goNow',
  at_deadline: 'workday.reminder.ended',
})

/**
 * The same under an area sign (r335): the car has to leave the whole area,
 * not just the street. Go-now names no place, so both share it.
 */
export const WORKDAY_AREA_REMINDER_KEYS: Readonly<Record<WorkdayReminderKind, string>> = Object.freeze({
  heads_up: 'workday.reminder.headsUpArea',
  go_now: 'workday.reminder.goNow',
  at_deadline: 'workday.reminder.endedArea',
})

/** A saved leg as the area test needs it. */
export type AreaModeLeg = Pick<ParkingSession, 'rules' | 'rule_flags' | 'boundary'>

/**
 * Whether a leg's limit is an area limit, so its reminders say to leave the
 * whole area: its own sign is an area sign (`isAreaSignLeg`, so an unknown
 * flag falls back to the sign text), or its boundary question was the area
 * one and the answer kept that limit running.
 */
export function legInAreaMode(leg: AreaModeLeg): boolean {
  if (isAreaSignLeg({ is_area_sign: leg.rule_flags?.is_area_sign ?? null, sign_text: leg.rules || null })) {
    return true
  }
  const b = leg.boundary
  return !!b && Array.isArray(b.asked_because) && b.asked_because.includes('area_sign') && !startsNewLimit(b)
}

/**
 * Whether the limit running on the last leg's stretch is an area limit: any
 * leg from the one that started that limit through to the last is in area
 * mode. Pass the workday's legs in leg order (`workdayLegs`). This catches
 * an area limit carried over more than one move, which the last leg alone
 * can't show. False for no legs.
 */
export function stretchInAreaMode(legs: readonly AreaModeLeg[]): boolean {
  for (let i = legs.length - 1; i >= 0; i--) {
    if (legInAreaMode(legs[i])) return true
    if (i === 0 || startsNewLimit(legs[i].boundary)) return false
  }
  return false
}

/** A saved leg as the reminder copy needs it. */
export type WorkdayReminderLeg = Pick<ParkingSession, 'location'> & AreaModeLeg

export interface WorkdayReminderCopyOptions {
  /**
   * Use the area wording even when the leg alone doesn't show it, for
   * example `stretchInAreaMode(workdayLegs(...))`. It can only add the area
   * wording: a leg in area mode always gets it.
   */
  area_mode?: boolean
}

export interface WorkdayReminderCopy {
  title: string
  body: string
}

/** The zone's short name at a moment ("AEST", "AEDT"), or '' when Intl can't say. */
function zoneNameAt(ms: number, timeZone: string): string {
  try {
    return (
      new Intl.DateTimeFormat('en-AU', { timeZone, timeZoneName: 'short' })
        .formatToParts(new Date(ms))
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    )
  } catch {
    return ''
  }
}

/**
 * The deadline as a reminder names it: an absolute time in the leg's zone,
 * with the day when it isn't the day the reminder fires. When a daylight
 * saving change falls between the reminder and the deadline (the zone's
 * name differs at the two moments), the zone's name is added ("2:20 am
 * AEST"), so a deadline in the repeated hour of the April change can't be
 * read as the other 2:20 am.
 */
function reminderTime(reminder: WorkdayReminder, timeZone: string): string {
  const fire = new Date(reminder.fire_at)
  const f = formatExpiryAbsolute(reminder.deadline, { timeZone, now: fire })
  const zone = zoneNameAt(Date.parse(reminder.deadline), timeZone)
  const time = zone && zone !== zoneNameAt(fire.getTime(), timeZone) ? `${f.time} ${zone}` : f.time
  return f.dayDate ? `${time}, ${f.dayDate}` : time
}

/**
 * Title and body for one workday reminder. The body names the deadline as
 * an absolute time in the leg's own time zone, never "in 10 minutes": a
 * push can arrive late, and an absolute time stays true. Under an area limit
 * (`legInAreaMode`, or `options.area_mode`) the body says to leave the whole
 * area. The title is the leg's address, the most useful thing on a lock
 * screen.
 */
export function workdayReminderCopy(
  reminder: WorkdayReminder,
  leg: WorkdayReminderLeg,
  t: TFunction,
  options: WorkdayReminderCopyOptions = {},
): WorkdayReminderCopy {
  const timeZone = sessionTimezone(leg.location)
  const keys = options.area_mode === true || legInAreaMode(leg) ? WORKDAY_AREA_REMINDER_KEYS : WORKDAY_REMINDER_KEYS
  return {
    title: leg.location?.address || t('reminders.pushTitleFallback'),
    body: t(keys[reminder.kind], { time: reminderTime(reminder, timeZone) }),
  }
}

/** The leg's reminders as `/push/schedule` entries, each opening the leg's record. */
export function workdayPushReminders(
  leg: Pick<ParkingSession, 'id'> & WorkdayReminderLeg,
  reminders: readonly WorkdayReminder[],
  t: TFunction,
  options: WorkdayReminderCopyOptions = {},
): ScheduledReminder[] {
  return reminders.map((r) => {
    const { title, body } = workdayReminderCopy(r, leg, t, options)
    return { fire_at: r.fire_at, title, body, url: sessionLink(leg.id) }
  })
}
