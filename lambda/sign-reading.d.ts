// Types for lambda/sign-reading.js (build spec T3): the sign reader's
// request checks and answer normaliser. The browser may import it too.

export type UserPermitType = 'accessible' | 'resident' | 'business'
export type SignStatusName = 'readable' | 'partially_obscured' | 'missing' | 'contradictory' | 'not_a_parking_sign'
export type JurisdictionCode = 'VIC' | 'QLD' | 'NSW' | 'ACT' | 'SA' | 'WA' | 'TAS' | 'NT'
export type RecurringKind = 'street_cleaning' | 'clearway' | 'no_stopping' | 'other'
export type WeekdayCode = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

export declare const USER_PERMIT_TYPES: readonly UserPermitType[]
export declare const CONFIDENCE_LEVELS: readonly ('low' | 'medium' | 'high')[]
export declare const RECURRING_KINDS: readonly RecurringKind[]
export declare const WEEKDAYS: readonly WeekdayCode[]
/** A 24-hour 'HH:MM' local time, 00:00 to 23:59. */
export declare const HHMM_RE: RegExp
export declare const NO_READABLE_SIGN_STATUSES: readonly SignStatusName[]

export declare const SIGN_READING_CAPS: Readonly<{
  userPermits: number
  userPermitArea: number
  rules: number
  observationGroups: number
  observationScope: number
  observationItems: number
  observationItem: number
  clarificationQuestion: number
  clarificationOptions: number
  variantLabel: number
  transitionChange: number
  isoTime: number
  signIssue: number
  signIssues: number
  paymentMethod: number
  paymentMethods: number
  permitArea: number
  permitExceptionText: number
  recurringRestrictions: number
  recurringLabel: number
  recurringExceptionsText: number
  weekOfMonthMax: number
}>

/** One permit as the sign reader receives it. `area` is the label the user typed, trimmed. */
export interface UserPermitInput {
  type: UserPermitType
  area?: string | null
}

export interface CheckedUserPermit {
  type: UserPermitType
  area: string | null
}

/** A rejected /sign-translate request: HTTP 400 with `{ error: code, field }`. */
export declare class SignInputError extends Error {
  constructor(code: string, path: string)
  readonly code: string
  readonly path: string
  readonly statusCode: 400
  readonly status: 400
}

/** At most 3 permits, each exactly `{ type, area? }`. Throws SignInputError. */
export function validateUserPermits(value: unknown): CheckedUserPermit[]
/** A Jurisdiction code or null. Throws SignInputError. */
export function validateParkingState(value: unknown): JurisdictionCode | null
export function validateTranslateExtras(body: unknown): {
  user_permits: CheckedUserPermit[]
  parking_state: JurisdictionCode | null
}

/** The refresh-mode echoes, cleaned (unknown values count as not supplied). */
export interface PriorSignContext {
  sign_status: SignStatusName | null
  sign_issues: string[]
  is_area_sign: boolean | null
}
export function readPriorSignContext(body: unknown): PriorSignContext

/**
 * What the sign itself prints for one of the user's permit types. Answers
 * carry one per listed type, in list order ([] when none are listed), so
 * `permit_type` is always set there; the schema keeps it nullable.
 */
export interface PermitExceptionShape {
  applies: boolean
  permit_type: UserPermitType | null
  /** The sign's own words; '' when applies is false. */
  text: string
}

export interface RecurringRestrictionShape {
  kind: RecurringKind
  days: WeekdayCode[]
  /** 'HH:MM', 24-hour local time. */
  start: string
  /** 'HH:MM'; earlier than start when the restriction runs past midnight. */
  end: string
  /** 1 to 5; [] means every week. */
  week_of_month: number[]
  exceptions_text: string
  label: string
}

export interface ObservationGroupShape {
  scope: string
  items: string[]
}

export interface NextTransitionShape {
  when: string
  change: string
}

export interface ModelRuleVariant {
  label: string
  rules: string
  observations: ObservationGroupShape[]
  can_park_now: boolean
  until: string | null
  duration_minutes: number | null
  requires_disabled_permit: boolean
  is_permit_zone: boolean
  permit_area: string | null
  is_area_sign: boolean
  permit_exception: PermitExceptionShape[]
  next_transition: NextTransitionShape | null
}

/** The sign reader's answer after normalizeModelOutput: every key always present. */
export interface ModelParkingRules {
  sign_status: SignStatusName
  sign_issues: string[]
  rules: string
  observations: ObservationGroupShape[]
  can_park_now: boolean
  until: string | null
  duration_minutes: number | null
  confidence: 'low' | 'medium' | 'high'
  requires_ticket: boolean
  payment_methods: string[] | null
  requires_disabled_permit: boolean
  is_permit_zone: boolean
  permit_area: string | null
  is_area_sign: boolean
  permit_exception: PermitExceptionShape[]
  recurring_restrictions: RecurringRestrictionShape[]
  next_transition: NextTransitionShape | null
  clarification: { question: string; options: ModelRuleVariant[] } | null
}

export interface NormalizeContext {
  user_permits?: ReadonlyArray<{ type: string }>
  refresh?: PriorSignContext | null
}

/** One entry per permit type, applies false ("the sign prints nothing for these"). */
export function noPermitExceptions(permitTypes: readonly UserPermitType[]): PermitExceptionShape[]
/**
 * One weekly restriction as the app keeps it, checked (days in MO..SU order,
 * 'HH:MM' times that differ, weeks 1 to 5 or none, an unknown kind as
 * 'other', text fitted to its caps), or null when it can't be one. The one
 * check for answers, stored records and the weekly reminders.
 */
export function readRecurringRestriction(value: unknown): RecurringRestrictionShape | null
/** Each restriction checked, duplicates kept once, at most SIGN_READING_CAPS.recurringRestrictions. */
export function readRecurringRestrictions(value: unknown): RecurringRestrictionShape[]
/** A note in characters every PDF font can draw: arrows and comparison signs as ASCII, other symbols and emoji removed. */
export function plainNoteText(value: unknown): string
export function fitModelText(value: unknown, max: number): string
/** Enums and caps enforced. Throws Error('ERR_SIGN_UNREADABLE') for an answer that can't be trusted. */
export function normalizeModelOutput(raw: unknown, context?: NormalizeContext): ModelParkingRules
