// The sign reader's answer on the phone (build spec T3 items 5 to 7): which
// screen an answer goes to, how a picked position and a re-check change it,
// and what of it is kept on the saved record. Pure: no storage, no network,
// no clock.
//
// Every T3 server answer carries sign_status, sign_issues, is_area_sign,
// permit_exception and recurring_restrictions (normalizeModelOutput in
// lambda/sign-reading.js). An answer from an older server, and a record
// saved before T3, has none of them. The readers here treat that as "not
// known" and never fill in a value nobody determined: a pre-T3 answer saves
// no sign_status and no rule_flags, rather than a signed "readable, not an
// area sign".
import type {
  ObservationGroup,
  ParkingRules,
  ParkingSession,
  RecurringRestriction,
  RuleFlags,
  RuleVariant,
  SignStatus,
  Weekday,
} from '../types'
import { CAPS, SIGN_STATUSES } from '../../lambda/addendum-schema.js'
import { NO_READABLE_SIGN_STATUSES, RECURRING_KINDS, SIGN_READING_CAPS, WEEKDAYS } from '../../lambda/sign-reading.js'
import { fitText } from './evidence-chain'

/** Anything that may carry a sign reading: an answer, a variant-merged answer or a saved record. */
export interface MaybeSignReading {
  sign_status?: unknown
  sign_issues?: unknown
  recurring_restrictions?: unknown
}

/** The answer's or record's sign status, or null when it has none (pre-T3) or an unknown one. */
export function signStatusOf(value: MaybeSignReading | null | undefined): SignStatus | null {
  const s = value?.sign_status
  return typeof s === 'string' && SIGN_STATUSES.includes(s) ? (s as SignStatus) : null
}

/**
 * The notes on what stops the sign being read clearly: strings only, each
 * fitted to the signed cap (control and bidi characters become spaces), at
 * most CAPS.signIssues. Always [] for a readable sign or no status.
 */
export function signIssuesOf(value: MaybeSignReading | null | undefined): string[] {
  const status = signStatusOf(value)
  const issues: unknown = value?.sign_issues
  if (status === null || status === 'readable' || !Array.isArray(issues)) return []
  return issues
    .map((s) => fitText(s, CAPS.signIssue))
    .filter((s): s is string => s !== null)
    .slice(0, CAPS.signIssues)
}

/** 'missing' or 'not_a_parking_sign': there is no answer, and the app shows its "no readable sign" screen. */
export function hasNoReadableSign(value: MaybeSignReading | null | undefined): boolean {
  const s = signStatusOf(value)
  return s !== null && NO_READABLE_SIGN_STATUSES.includes(s)
}

/** 'partially_obscured' or 'contradictory': the most restrictive answer, with the unclear-sign banner. */
export function isUnclearSign(value: MaybeSignReading | null | undefined): boolean {
  const s = signStatusOf(value)
  return s === 'partially_obscured' || s === 'contradictory'
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function isRecurringRestriction(value: unknown): value is RecurringRestriction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  return (
    typeof r.kind === 'string' &&
    RECURRING_KINDS.includes(r.kind as RecurringRestriction['kind']) &&
    Array.isArray(r.days) &&
    r.days.length > 0 &&
    r.days.every((d) => typeof d === 'string' && WEEKDAYS.includes(d as Weekday)) &&
    typeof r.start === 'string' &&
    HHMM_RE.test(r.start) &&
    typeof r.end === 'string' &&
    HHMM_RE.test(r.end) &&
    Array.isArray(r.week_of_month) &&
    r.week_of_month.every((w) => Number.isInteger(w) && (w as number) >= 1 && (w as number) <= SIGN_READING_CAPS.weekOfMonthMax) &&
    typeof r.exceptions_text === 'string' &&
    typeof r.label === 'string'
  )
}

/**
 * The weekly restrictions of an answer or record: only well-formed ones,
 * copied to exactly the RecurringRestriction keys, at most
 * SIGN_READING_CAPS.recurringRestrictions. [] when there are none.
 */
export function recurringRestrictionsOf(value: MaybeSignReading | null | undefined): RecurringRestriction[] {
  const list: unknown = value?.recurring_restrictions
  if (!Array.isArray(list)) return []
  return list
    .filter(isRecurringRestriction)
    .slice(0, SIGN_READING_CAPS.recurringRestrictions)
    .map((r) => ({
      kind: r.kind,
      days: [...r.days],
      start: r.start,
      end: r.end,
      week_of_month: [...r.week_of_month],
      exceptions_text: r.exceptions_text,
      label: r.label,
    }))
}

/** The result screen's weekly restriction hint (T3 item 7) shows for these. */
export function hasWeeklyRestriction(value: MaybeSignReading | null | undefined): boolean {
  return recurringRestrictionsOf(value).length > 0
}

/** Where a fresh or refreshed answer goes. */
export type ReadingView = 'noReadableSign' | 'clarify' | 'result'

/**
 * The screen for an answer: the "no readable sign" screen for 'missing' and
 * 'not_a_parking_sign' (never an answer card: those carry no answer), the
 * position picker when the answer depends on where the car is, otherwise
 * the result.
 */
export function viewForReading(result: ParkingRules): ReadingView {
  if (hasNoReadableSign(result)) return 'noReadableSign'
  if (result.clarification && result.clarification.options.length > 1) return 'clarify'
  return 'result'
}

/**
 * The answer once the driver picked a position on the clarify screen. The
 * picked variant supplies everything that is per position: the rules and
 * observations, the current-time answer, the transition, the permit flags,
 * and (T3) whether its rules come from an area sign and what it prints for
 * the user's permits. A variant from a pre-T3 server has neither T3 field,
 * so the whole sign's values stay. The sign's condition, its notes and its
 * weekly restrictions describe the whole sign and stay as they are.
 */
export function mergeChosenVariant(base: ParkingRules, variant: RuleVariant): ParkingRules {
  const alternates = base.clarification?.options.filter((o) => o.label !== variant.label) ?? []
  return {
    ...base,
    rules: variant.rules,
    observations: variant.observations,
    can_park_now: variant.can_park_now,
    until: variant.until,
    duration_minutes: variant.duration_minutes,
    // Variant carries its own transition awareness: use it in preference
    // to the top-level one (which describes the unmerged combined rule).
    next_transition: variant.next_transition ?? base.next_transition ?? null,
    // Disability-permit requirement is per-variant on multi-arrow signs
    // (left = general, right = accessible only). Carry the chosen variant's
    // flag up so the ParkingResult gate fires only when the side the user
    // actually picked is permit-restricted.
    requires_disabled_permit: variant.requires_disabled_permit ?? false,
    // Permit-zone flag and area work the same way.
    is_permit_zone: variant.is_permit_zone ?? false,
    permit_area: variant.permit_area ?? null,
    // The top level says "area sign" when any part is one; the picked
    // position may be on an ordinary length of road.
    is_area_sign: typeof variant.is_area_sign === 'boolean' ? variant.is_area_sign : base.is_area_sign,
    // One entry per permit type. The top level's entries apply only when
    // the exception covers every position, so the picked position's win.
    permit_exception: variant.permit_exception ?? base.permit_exception,
    clarification: null,
    chosen_label: variant.label,
    alternate_variants: alternates,
  }
}

/** What a re-check sends about the earlier reading (claude.ts refreshInterpretation). */
export interface RefreshPrior {
  rules: string
  observations: ObservationGroup[]
  chosen_label?: string
  /** The status the first reading saw, echoed by the server (null: not recorded). */
  sign_status: SignStatus | null
  sign_issues: string[]
  /** Whether the first reading saw an area sign (null: not recorded). */
  is_area_sign: boolean | null
}

export function refreshPriorOf(session: ParkingSession): RefreshPrior {
  const area = session.rule_flags?.is_area_sign
  return {
    rules: session.rules,
    observations: session.observations,
    chosen_label: session.chosen_label,
    sign_status: signStatusOf(session),
    sign_issues: signIssuesOf(session),
    is_area_sign: typeof area === 'boolean' ? area : null,
  }
}

/**
 * A re-check's answer as the result screen shows it. The model is trusted
 * only for the current-time fields (and what it works out from the stored
 * rules: payment, permit flags, the permit exception). Everything the first
 * reading saw in the photo is kept from the record: the rules text,
 * observations and picked position, and (T3) the sign's condition and
 * notes, the area flag and the weekly restrictions. A re-check reads no
 * photo, so it can't change those.
 *
 * A record saved before T3 has none of them, and a text-only re-check
 * can't determine them: the server's status for such a record is only a
 * placeholder. So the answer keeps the pre-T3 shape (no sign_status,
 * sign_issues, is_area_sign or recurring_restrictions), and a record saved
 * from it stores and signs none of them (signReadingFields gives {}),
 * rather than a "readable" nobody read.
 */
export function applyRefreshOverride(fresh: ParkingRules, session: ParkingSession): ParkingRules {
  const prior = refreshPriorOf(session)
  const out: ParkingRules = {
    ...fresh,
    rules: session.rules,
    observations: session.observations,
    confidence: 'high',
    clarification: null,
    chosen_label: session.chosen_label,
  }
  if (prior.sign_status === null) {
    delete out.sign_status
    delete out.sign_issues
    delete out.is_area_sign
    delete out.recurring_restrictions
    return out
  }
  return {
    ...out,
    sign_status: prior.sign_status,
    sign_issues: prior.sign_issues,
    is_area_sign: prior.is_area_sign ?? fresh.is_area_sign,
    recurring_restrictions: recurringRestrictionsOf(session),
  }
}

/** The T3 fields a record keeps from the answer it was logged with. */
export type SignReadingFields = Pick<ParkingSession, 'rule_flags' | 'sign_status' | 'sign_issues' | 'recurring_restrictions'>

/**
 * The rule flags as kept on a record (and signed in arrival_context), or
 * null when the answer doesn't say whether the sign is an area sign (a
 * pre-T3 answer): a flag nobody determined is never stored as "no".
 */
export function ruleFlagsOf(result: ParkingRules): RuleFlags | null {
  if (typeof result.is_area_sign !== 'boolean') return null
  return {
    requires_ticket: result.requires_ticket === true,
    payment_methods: Array.isArray(result.payment_methods)
      ? result.payment_methods
          .map((m) => fitText(m, CAPS.paymentMethod))
          .filter((m): m is string => m !== null)
          .slice(0, CAPS.paymentMethods)
      : null,
    requires_disabled_permit: result.requires_disabled_permit === true,
    is_permit_zone: result.is_permit_zone === true,
    permit_area: fitText(result.permit_area, CAPS.permitArea),
    is_area_sign: result.is_area_sign,
  }
}

/**
 * The fields a new record keeps from the answer it was logged with (T3
 * item 5): the sign's condition and notes, the rule flags and the weekly
 * restrictions. Additive: a pre-T3 answer gives {} and the record looks
 * like one saved before T3.
 */
export function signReadingFields(result: ParkingRules): SignReadingFields {
  const status = signStatusOf(result)
  if (status === null) return {}
  const out: SignReadingFields = {
    sign_status: status,
    sign_issues: signIssuesOf(result),
    recurring_restrictions: recurringRestrictionsOf(result),
  }
  const flags = ruleFlagsOf(result)
  if (flags) out.rule_flags = flags
  return out
}

/** What the "Log without a sign" path carries to the no-sign logger. */
export interface NoSignReading {
  sign_status: 'missing' | 'not_a_parking_sign'
  sign_issues: string[]
}

/** The reading behind "Log without a sign", or null for an answer that has a readable sign. */
export function noSignReadingOf(result: ParkingRules): NoSignReading | null {
  if (!hasNoReadableSign(result)) return null
  return { sign_status: signStatusOf(result) as NoSignReading['sign_status'], sign_issues: signIssuesOf(result) }
}

/**
 * The fields a no-sign record keeps when it was logged from the "no
 * readable sign" screen: the status ParkProof found and its notes. {} for
 * the ordinary no-sign path.
 */
export function noSignReadingFields(reading: NoSignReading | null | undefined): Pick<ParkingSession, 'sign_status' | 'sign_issues'> {
  if (!reading || !hasNoReadableSign(reading)) return {}
  return { sign_status: reading.sign_status, sign_issues: signIssuesOf(reading) }
}

/**
 * A no-sign record logged after ParkProof found no readable parking sign in
 * the photo (its surroundings photo is that scan photo). Shown and printed
 * with the "No sign read" wording instead of "the driver said there were
 * no parking signs".
 */
export function isNoSignReadRecord(session: ParkingSession): boolean {
  return session.no_sign === true && hasNoReadableSign(session)
}

/**
 * The T3 additions to the result screen's feedback telemetry (T3 item 5).
 * Counts, not the notes themselves; nothing about the user's permits (N3).
 * The server whitelists the same four fields.
 */
export function signReadingTelemetry(result: ParkingRules): {
  sign_status?: SignStatus
  sign_issues_count?: number
  is_area_sign?: boolean
  recurring_restrictions_count?: number
} {
  const status = signStatusOf(result)
  if (status === null) return {}
  return {
    sign_status: status,
    sign_issues_count: signIssuesOf(result).length,
    ...(typeof result.is_area_sign === 'boolean' ? { is_area_sign: result.is_area_sign } : {}),
    recurring_restrictions_count: recurringRestrictionsOf(result).length,
  }
}
