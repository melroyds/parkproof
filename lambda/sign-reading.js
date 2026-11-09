// Sign reading (build spec T3): what the sign reader accepts besides the
// photo, and how the model's answer is cleaned before anyone uses it.
//
// Used by the Lambda (lambda/index.js), which checks every /sign-translate
// request and normalises every model answer. No SDK imports and no Node
// built-ins, so the browser can import it too (T4 can check saved permits
// with these exact rules before sending them).
//
// Two kinds of input, two policies:
// - user_permits and parking_state are typed or chosen on the phone and go
//   into the prompt. They are untrusted: anything outside the contract is
//   rejected with HTTP 400 (SignInputError), never repaired.
// - The model's answer and the refresh-mode echoes (prior_sign_status and
//   friends, which are earlier model answers stored on the phone) are
//   normalised: wrong enums fall back to a stated default, strings lose
//   control and bidi characters and are cut to their caps, and lists are
//   cut to theirs. A malformed time on an answer throws ERR_SIGN_UNREADABLE,
//   because dropping a leave-by time would turn "move by 2 pm" into "no limit".

import { CAPS, ERR, FORBIDDEN_CHARS_RE, JURISDICTIONS, SIGN_STATUSES } from './addendum-schema.js'

export const USER_PERMIT_TYPES = Object.freeze(['accessible', 'resident', 'business'])
/**
 * The model's permit_exception_type when the sign prints no exception for
 * any listed permit (or none are listed). The model's answer carries one
 * flat type and quote per level, because a list of objects made the
 * schema's grammar too large for the API (lambda/index.js); the answer the
 * app gets keeps the permit_exception list.
 */
export const NO_PERMIT_EXCEPTION_TYPE = 'none'
export const CONFIDENCE_LEVELS = Object.freeze(['low', 'medium', 'high'])
/**
 * The kinds of weekly restriction: the one list the sign reader's schema
 * offers the model, the answer and stored-record check
 * (readRecurringRestrictions) and the weekly reminders (src/lib/recurring.ts)
 * all use.
 */
export const RECURRING_KINDS = Object.freeze(['street_cleaning', 'clearway', 'no_stopping', 'other'])
/** iCalendar BYDAY codes, Monday first. */
export const WEEKDAYS = Object.freeze(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])
/** A 24-hour 'HH:MM' local time, 00:00 to 23:59. */
export const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/
/** Statuses for which the app shows its "no readable sign" screen instead of an answer. */
export const NO_READABLE_SIGN_STATUSES = Object.freeze(['missing', 'not_a_parking_sign'])

/**
 * Caps for the sign reader's inputs and answers. Where a value also ends up
 * in signed addendum data (sign_issues, payment_methods, permit_area), the
 * cap is the one lambda/addendum-schema.js enforces, so an answer can be
 * signed as is. String lengths count UTF-16 code units.
 */
export const SIGN_READING_CAPS = Object.freeze({
  userPermits: 3,
  userPermitArea: 60,
  rules: 1000,
  observationGroups: 12,
  observationScope: 60,
  observationItems: 10,
  observationItem: 200,
  clarificationQuestion: 200,
  clarificationOptions: 6,
  variantLabel: 40,
  transitionChange: 120,
  isoTime: 40,
  signIssue: CAPS.signIssue,
  signIssues: CAPS.signIssues,
  paymentMethod: CAPS.paymentMethod,
  paymentMethods: CAPS.paymentMethods,
  permitArea: CAPS.permitArea,
  permitExceptionText: 200,
  recurringRestrictions: 8,
  recurringLabel: 80,
  recurringExceptionsText: 200,
  weekOfMonthMax: 5,
})

/** A /sign-translate request the server won't run. HTTP 400 with `{ error: code, field }`. */
export class SignInputError extends Error {
  /**
   * @param {string} code one of ERR (lambda/addendum-schema.js)
   * @param {string} path the offending field, e.g. `user_permits[1].area`
   */
  constructor(code, path) {
    super(`${code} at ${path || '(body)'}`)
    this.name = 'SignInputError'
    this.code = code
    this.path = path
    this.statusCode = 400
    // The dev proxy in vite.config.ts reads `status`.
    this.status = 400
  }
}

function reject(code, path) {
  throw new SignInputError(code, path)
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

// ─── Request checks ─────────────────────────────────────────────────────

const USER_PERMIT_KEYS = Object.freeze(['type', 'area'])

/**
 * The user's saved permits as the prompt receives them: at most 3, each
 * exactly `{ type, area }` with `type` one of USER_PERMIT_TYPES and `area`
 * optional. An area holding any control or bidi character is rejected;
 * otherwise surrounding whitespace is trimmed, the rest must be at most 60
 * characters, and an empty area becomes null. Any other key is rejected, so
 * nothing but the permit type and its area label ever reaches the model
 * (the privacy policy says only the type is sent). Absent or null means no
 * permits. Throws SignInputError.
 *
 * @returns {{ type: 'accessible'|'resident'|'business', area: string|null }[]}
 */
export function validateUserPermits(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) reject(ERR.BAD_VALUE, 'user_permits')
  if (value.length > SIGN_READING_CAPS.userPermits) reject(ERR.TOO_LARGE, 'user_permits')
  return value.map((permit, i) => {
    const path = `user_permits[${i}]`
    if (!isPlainObject(permit)) reject(ERR.BAD_VALUE, path)
    for (const key of Object.keys(permit)) {
      if (!USER_PERMIT_KEYS.includes(key)) reject(ERR.UNKNOWN_FIELD, `${path}.${key}`)
    }
    if (typeof permit.type !== 'string' || !USER_PERMIT_TYPES.includes(permit.type)) {
      reject(ERR.BAD_VALUE, `${path}.type`)
    }
    let area = null
    if (permit.area !== undefined && permit.area !== null) {
      if (typeof permit.area !== 'string') reject(ERR.BAD_STRING, `${path}.area`)
      if (FORBIDDEN_CHARS_RE.test(permit.area)) reject(ERR.BAD_STRING, `${path}.area`)
      const trimmed = permit.area.trim()
      if (trimmed.length > SIGN_READING_CAPS.userPermitArea) reject(ERR.BAD_STRING, `${path}.area`)
      area = trimmed.length > 0 ? trimmed : null
    }
    return { type: permit.type, area }
  })
}

/**
 * The state or territory the car is parked in (Jurisdiction), or null when
 * absent. Anything else is rejected. Throws SignInputError.
 *
 * @returns {string|null}
 */
export function validateParkingState(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !JURISDICTIONS.includes(value)) reject(ERR.BAD_VALUE, 'parking_state')
  return value
}

/**
 * Checks the request fields T3 added. Run before any work is queued, so a
 * bad request is a 400 at once rather than a failed job later.
 */
export function validateTranslateExtras(body) {
  const b = isPlainObject(body) ? body : {}
  return {
    user_permits: validateUserPermits(b.user_permits),
    parking_state: validateParkingState(b.parking_state),
  }
}

/**
 * The refresh-mode echoes, cleaned rather than rejected: they are earlier
 * model answers stored on the phone, and an odd old value shouldn't stop a
 * re-check. An unknown status, or a non-boolean area flag, counts as not
 * supplied (null).
 */
export function readPriorSignContext(body) {
  const b = isPlainObject(body) ? body : {}
  const sign_status = oneOf(SIGN_STATUSES, b.prior_sign_status, null)
  return {
    sign_status,
    sign_issues: sign_status === 'readable' ? [] : signIssueList(b.prior_sign_issues),
    is_area_sign: typeof b.prior_is_area_sign === 'boolean' ? b.prior_is_area_sign : null,
  }
}

// ─── Plain notes ────────────────────────────────────────────────────────

// Arrows, maths signs and pictographs that no PDF font draws: jsPDF's
// Helvetica (en, it, id) is WinAnsi only, and the Noto subsets hold their
// own script. The prompt teaches arrow scopes ("\u2190 Left arrow"), so a
// note such as "\u2192 plate faded" is likely, and a limit can come back as
// "\u2264 2P". The common arrows and comparison signs become ASCII; other
// arrows, maths signs, shapes, dingbats and emoji are dropped.
const NOTE_ASCII = Object.freeze([
  [/[\u2194\u21D4\u27F7\u2B0C]/g, '<->'],
  [/[\u2190\u21D0\u27F5\u2B05]/g, '<-'],
  [/[\u2192\u21D2\u27A1\u27F6]/g, '->'],
  [/[\u2191\u21D1\u2B06]/g, '^'],
  [/[\u2193\u21D3\u2B07]/g, 'v'],
  // Less than or equal, greater than or equal, not equal, about.
  [/[\u2264\u2266\u2A7D]/g, '<='],
  [/[\u2265\u2267\u2A7E]/g, '>='],
  [/[\u2260]/g, '!='],
  [/[\u2248\u2243\u2245\u223C]/g, '~'],
  // A minus sign and the hyphens and dashes WinAnsi lacks.
  [/[\u2212\u2010\u2011\u2012\u2015]/g, '-'],
  [/[\u2215\u2044]/g, '/'],
  [/[\u2217]/g, '*'],
  // Primes (feet and inches, minutes and seconds).
  [/[\u2032]/g, "'"],
  [/[\u2033]/g, '"'],
])
// Arrows, maths operators and technical signs (U+2190 to U+23FF), shapes,
// dingbats and maths brackets (U+25A0 to U+27FF), more arrows and maths
// (U+2900 to U+2BFF), variation selectors and emoji.
const NOTE_SYMBOLS_RE = /[\u2190-\u23FF\u2034-\u2037\u25A0-\u27FF\u2900-\u2BFF\uFE0E\uFE0F\u{1F000}-\u{1FAFF}]/gu

/**
 * A note on what stops a sign being read, in characters every PDF font can
 * draw: arrows and comparison signs as ASCII ("->", "<="), other symbols
 * and emoji removed, runs of spaces collapsed. Notes are kept with the
 * record, signed in its arrival_context and printed in its PDF. Non-strings
 * become ''.
 */
export function plainNoteText(value) {
  if (typeof value !== 'string') return ''
  let s = value
  for (const [re, ascii] of NOTE_ASCII) s = s.replace(re, ascii)
  return s.replace(NOTE_SYMBOLS_RE, ' ').replace(/ {2,}/g, ' ').trim()
}

/** sign_issues as kept: plain notes, each fitted to the signed cap, empties and duplicates dropped, at most 5. */
function signIssueList(value) {
  if (!Array.isArray(value)) return []
  return fitTextList(
    value.map((item) => (typeof item === 'string' ? plainNoteText(item) : item)),
    SIGN_READING_CAPS.signIssue,
    SIGN_READING_CAPS.signIssues,
  )
}

// ─── Answer normalisation ───────────────────────────────────────────────

const FORBIDDEN_RUNS = new RegExp(FORBIDDEN_CHARS_RE.source + '+', 'g')

/**
 * A model string made safe to show and to sign: each run of control or
 * bidi characters becomes one space, the ends are trimmed, and anything
 * over `max` is cut without splitting a surrogate pair. Non-strings
 * become ''.
 */
export function fitModelText(value, max) {
  if (typeof value !== 'string') return ''
  let s = value.replace(FORBIDDEN_RUNS, ' ').trim()
  if (s.length > max) {
    s = s.slice(0, max)
    const last = s.charCodeAt(s.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1)
    s = s.trimEnd()
  }
  return s
}

function fitTextOrNull(value, max) {
  const s = fitModelText(value, max)
  return s.length > 0 ? s : null
}

/** Each string fitted, empties dropped, duplicates dropped, at most `maxItems`. */
function fitTextList(value, maxLength, maxItems) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    const s = fitModelText(item, maxLength)
    if (s && !out.includes(s)) out.push(s)
    if (out.length === maxItems) break
  }
  return out
}

function oneOf(values, value, fallback) {
  return typeof value === 'string' && values.includes(value) ? value : fallback
}

const bool = (value) => value === true

// ISO 8601 date and time with an explicit offset (or Z), as the prompt asks.
const ZONED_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/

function isZonedTime(value) {
  return (
    typeof value === 'string' &&
    value.length <= SIGN_READING_CAPS.isoTime &&
    ZONED_TIME_RE.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

/**
 * A leave-by time: null, or a zoned ISO time. A blank string reads as null
 * when null is what it can only mean: the answer says the car can't park
 * (the prompt's contract), or gives no time limit either. Anything else
 * can't be trusted, so it throws: a can-park answer with a limit and a
 * blank or malformed end would otherwise read as "no limit".
 */
function leaveByTime(value, answer) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') {
    if (answer.can_park_now !== true || durationMinutes(answer.duration_minutes) === null) return null
    throw new Error('ERR_SIGN_UNREADABLE')
  }
  if (!isZonedTime(value)) throw new Error('ERR_SIGN_UNREADABLE')
  return value
}

function durationMinutes(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function observationGroups(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const group of value) {
    if (!isPlainObject(group)) continue
    const scope = fitModelText(group.scope, SIGN_READING_CAPS.observationScope)
    const items = fitTextList(group.items, SIGN_READING_CAPS.observationItem, SIGN_READING_CAPS.observationItems)
    if (!scope && items.length === 0) continue
    out.push({ scope, items })
    if (out.length === SIGN_READING_CAPS.observationGroups) break
  }
  return out
}

function paymentMethods(value) {
  if (!Array.isArray(value)) return null
  return fitTextList(value, SIGN_READING_CAPS.paymentMethod, SIGN_READING_CAPS.paymentMethods)
}

function nextTransition(value) {
  if (!isPlainObject(value)) return null
  // Advisory only: a heads-up with a bad time is dropped, never guessed.
  if (!isZonedTime(value.when)) return null
  const change = fitModelText(value.change, SIGN_READING_CAPS.transitionChange)
  return change ? { when: value.when, change } : null
}

/**
 * The driver's permits in the order the app ranks them when more than one
 * could apply to a sign (permitAnswerFor in src/lib/permit-answer.ts): an
 * accessible permit first, then resident and business permits in the order
 * they were saved. A new array; the order within each group is kept.
 *
 * The sign reader lists the permits to the model in this order, and the
 * prompt's tie-break (PERMIT EXCEPTIONS in lambda/index.js) gives the
 * accessible permit first, then a permit whose area label matches the
 * sign's area, then the first in this order: the same ranking the app
 * uses. The model reports one exception per level, so it must be the one
 * the app would choose. The answer's permit_exception entries follow this
 * order too.
 *
 * @template {{ type?: unknown }} T
 * @param {readonly T[] | null | undefined} permits
 * @returns {T[]}
 */
export function permitsInPriorityOrder(permits) {
  const list = Array.isArray(permits) ? permits : []
  const isAccessible = (p) => !!p && p.type === 'accessible'
  return [...list.filter(isAccessible), ...list.filter((p) => !isAccessible(p))]
}

/**
 * The user's permit types the answer reports on: each listed type once, in
 * priority order (permitsInPriorityOrder), known types only.
 */
function permitTypesOf(userPermits) {
  const types = []
  for (const p of permitsInPriorityOrder(userPermits)) {
    const type = p && p.type
    if (USER_PERMIT_TYPES.includes(type) && !types.includes(type)) types.push(type)
  }
  return types
}

/**
 * "The sign prints nothing for these permit types": one entry per type,
 * applies false. [] when the user listed no permits.
 */
export function noPermitExceptions(permitTypes) {
  return permitTypes.map((type) => ({ applies: false, permit_type: type, text: '' }))
}

/**
 * What the sign itself prints for each of the user's permit types (build
 * spec T3 item 1, "per user permit type"): exactly one entry per listed
 * type, in priority order (accessible first), [] when no permits are
 * listed. The model reports at most one exception per level, as two flat
 * fields (permit_exception_type and permit_exception_text), so at most one
 * entry applies: the one for
 * that exact type, and only when the model quotes the sign. Anything else
 * (a type the user doesn't hold, 'none', an unknown type, an empty quote)
 * is "no exception" for every type: a false "your permit allows this"
 * could get the driver fined.
 */
function permitExceptions(type, text, permitTypes) {
  const quote = fitModelText(text, SIGN_READING_CAPS.permitExceptionText)
  return permitTypes.map((permitType) =>
    permitType === type && quote
      ? { applies: true, permit_type: permitType, text: quote }
      : { applies: false, permit_type: permitType, text: '' },
  )
}

/**
 * 'HH:MM' (24-hour) or null. Accepts 'H:MM'. '24:00' is the end of the
 * day: '23:59' as an end time (so "00:00 to 24:00" stays an all-day
 * restriction, as the prompt writes it), '00:00' as a start time.
 */
function clockTime(value, { isEnd = false } = {}) {
  if (typeof value !== 'string') return null
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour === 24 && minute === 0) return isEnd ? '23:59' : '00:00'
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${m[2]}`
}

/**
 * One weekly restriction as the app keeps it, checked, or null when it
 * can't be one. This is the one check for a weekly restriction, wherever it
 * comes from: the server's answer (after repairRecurringRestriction), a
 * record in storage or the cloud, or a server of any age. It returns a
 * fresh object with exactly the stored keys:
 * - days: the known ones, in MO..SU order, at least one;
 * - start and end: 'HH:MM', and not the same (an end before the start runs
 *   past midnight);
 * - week_of_month: absent, null or [] for every week, else whole numbers 1
 *   to 5 (sorted, each once). Anything else ("last week" -1, a 0, a
 *   string) drops the restriction rather than describe the sign wrongly,
 *   as weekly or with fewer weeks, on the screen that asks the driver to
 *   check it against the sign;
 * - kind: one of RECURRING_KINDS; any other becomes 'other', so the
 *   restriction isn't lost;
 * - exceptions_text and label: fitted to their caps ('' when not text).
 */
export function readRecurringRestriction(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const days = WEEKDAYS.filter((d) => Array.isArray(value.days) && value.days.includes(d))
  if (days.length === 0) return null
  const { start, end } = value
  if (typeof start !== 'string' || !HHMM_RE.test(start)) return null
  if (typeof end !== 'string' || !HHMM_RE.test(end) || end === start) return null
  const weeks = value.week_of_month
  if (weeks !== undefined && weeks !== null && !Array.isArray(weeks)) return null
  const list = Array.isArray(weeks) ? weeks : []
  if (!list.every((w) => Number.isInteger(w) && w >= 1 && w <= SIGN_READING_CAPS.weekOfMonthMax)) return null
  return {
    kind: oneOf(RECURRING_KINDS, value.kind, 'other'),
    days,
    start,
    end,
    week_of_month: [...new Set(list)].sort((a, b) => a - b),
    exceptions_text: fitModelText(value.exceptions_text, SIGN_READING_CAPS.recurringExceptionsText),
    label: fitModelText(value.label, SIGN_READING_CAPS.recurringLabel),
  }
}

/**
 * Weekly restrictions as the app keeps them: each checked by
 * readRecurringRestriction, the same restriction printed on two plates
 * kept once, at most SIGN_READING_CAPS.recurringRestrictions. [] for
 * anything that isn't a list.
 */
export function readRecurringRestrictions(value) {
  if (!Array.isArray(value)) return []
  const out = []
  const seen = new Set()
  for (const item of value) {
    const r = readRecurringRestriction(item)
    if (!r) continue
    const key = [r.kind, r.days.join(','), r.start, r.end, r.week_of_month.join(',')].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
    if (out.length === SIGN_READING_CAPS.recurringRestrictions) break
  }
  return out
}

/**
 * The model's `days` string ('MO,TU') as the kept list: comma-separated
 * tokens, each trimmed and upper-cased, unknown ones ignored, each day once,
 * in MO..SU order. [] for anything that isn't a string, or names no known
 * day (readRecurringRestriction then drops the restriction).
 */
function modelDays(value) {
  if (typeof value !== 'string') return []
  const tokens = value.split(',').map((t) => t.trim().toUpperCase())
  return WEEKDAYS.filter((day) => tokens.includes(day))
}

/** A week token the kept list allows: a single digit 1 to 5. */
const WEEK_TOKEN_RE = new RegExp(`^[1-${SIGN_READING_CAPS.weekOfMonthMax}]$`)

/**
 * The model's `week_of_month` string ('1,3') as the kept list: '' (or only
 * commas and spaces) is every week, []; otherwise the comma-separated
 * tokens that are a week 1 to 5 (trimmed, each once, sorted), others
 * ignored. Null when the value isn't a string, or names weeks but none of
 * them is 1 to 5 ('last', '0'): the restriction is then dropped rather than
 * shown as running every week.
 */
function modelWeeks(value) {
  if (typeof value !== 'string') return null
  const tokens = value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length === 0) return []
  const weeks = [...new Set(tokens.filter((t) => WEEK_TOKEN_RE.test(t)).map(Number))].sort((a, b) => a - b)
  return weeks.length > 0 ? weeks : null
}

/**
 * A model's weekly restriction repaired into the kept shape before the
 * check: the days and week_of_month strings become lists (modelDays,
 * modelWeeks), times written 'H:MM' get their leading zero, and '24:00' is
 * the end of the day ('23:59' as an end, '00:00' as a start). Null when it
 * isn't an object or its weeks can't be read; anything else it can't
 * repair is left for readRecurringRestriction to drop.
 */
function repairRecurringRestriction(value) {
  if (!isPlainObject(value)) return null
  const week_of_month = modelWeeks(value.week_of_month)
  if (week_of_month === null) return null
  return {
    ...value,
    days: modelDays(value.days),
    start: clockTime(value.start),
    end: clockTime(value.end, { isEnd: true }),
    week_of_month,
  }
}

function recurringRestrictions(value) {
  return readRecurringRestrictions(Array.isArray(value) ? value.map(repairRecurringRestriction) : [])
}

function ruleVariant(value, permitTypes) {
  if (!isPlainObject(value)) return null
  const label = fitModelText(value.label, SIGN_READING_CAPS.variantLabel)
  // A position the driver can't pick from the list is no use.
  if (!label) return null
  return {
    label,
    rules: fitModelText(value.rules, SIGN_READING_CAPS.rules),
    observations: observationGroups(value.observations),
    can_park_now: bool(value.can_park_now),
    until: leaveByTime(value.until, value),
    duration_minutes: durationMinutes(value.duration_minutes),
    requires_disabled_permit: bool(value.requires_disabled_permit),
    is_permit_zone: bool(value.is_permit_zone),
    permit_area: fitTextOrNull(value.permit_area, SIGN_READING_CAPS.permitArea),
    is_area_sign: bool(value.is_area_sign),
    permit_exception: permitExceptions(value.permit_exception_type, value.permit_exception_text, permitTypes),
    next_transition: nextTransition(value.next_transition),
  }
}

function clarification(value, permitTypes) {
  if (!isPlainObject(value)) return null
  const options = []
  if (Array.isArray(value.options)) {
    for (const option of value.options) {
      const v = ruleVariant(option, permitTypes)
      if (v) options.push(v)
      if (options.length === SIGN_READING_CAPS.clarificationOptions) break
    }
  }
  if (options.length === 0) return null
  return { question: fitModelText(value.question, SIGN_READING_CAPS.clarificationQuestion), options }
}

/**
 * The sign reader's answer with every enum and cap enforced (build spec T3
 * item 4). Returns a fresh object holding exactly the answer keys the app
 * reads (ModelParkingRules), in a fixed order: RESPONSE_SCHEMA's keys, with
 * the model's flat permit_exception_type and permit_exception_text read
 * into one permit_exception list, and each weekly restriction's days and
 * week_of_month strings read into lists. Defaults for a missing or invalid
 * value:
 * sign_status 'partially_obscured' (the cautious banner), confidence 'low',
 * booleans false, strings '', lists [], nullable values null, an unknown
 * recurring kind 'other'. Throws ERR_SIGN_UNREADABLE when the answer isn't
 * an object or carries a malformed leave-by time.
 *
 * Rules beyond types and caps, all from the prompt's contract:
 * - 'readable' has no sign_issues.
 * - 'missing' and 'not_a_parking_sign' carry no reading at all: no rules,
 *   observations, flags, exception, restrictions, transition or options,
 *   and can_park_now false. The app shows its own screen for these. The
 *   rest of such an answer is never read, so a malformed time in it
 *   doesn't turn that screen into an error.
 * - permit_exception has one entry per permit type in
 *   `context.user_permits`, in priority order (permitsInPriorityOrder:
 *   accessible first, then the order listed; [] when none are listed). At
 *   most one of them applies at each level: the model reports one
 *   exception per level, picked by the same priority.
 * - A weekly restriction's days are the known codes in its days string
 *   ('MO,TU'); its weeks are the 1 to 5 tokens in its week_of_month string
 *   ('1,3', '' for every week). One with no known day, or with weeks none of
 *   which can be read, is dropped.
 * - sign_issues are plain notes (plainNoteText): no arrows or symbols a
 *   PDF font can't draw.
 * - The top-level is_area_sign is true when any position's is.
 * - In refresh mode (`context.refresh`), a recorded sign_status replaces the
 *   model's (with its sign_issues), and a recorded is_area_sign replaces
 *   the model's: a re-check reads no photo, so it can't change them. With
 *   no recorded status (a record saved before T3) the status is the
 *   placeholder 'readable' with no notes, whatever the model says: the
 *   re-check has the recorded rules to answer from, so a model that calls
 *   the sign missing (it was sent no photo) can't blank the answer into a
 *   "can't park" with every flag off. The app doesn't keep the placeholder.
 *
 * @param {unknown} raw the parsed model output
 * @param {{ user_permits?: { type: string }[], refresh?: { sign_status: string|null, sign_issues: string[], is_area_sign: boolean|null } | null }} [context]
 */
export function normalizeModelOutput(raw, context = {}) {
  if (!isPlainObject(raw)) throw new Error('ERR_SIGN_UNREADABLE')
  const permitTypes = permitTypesOf(context.user_permits)
  const refresh = context.refresh || null

  let sign_status = oneOf(SIGN_STATUSES, raw.sign_status, 'partially_obscured')
  let sign_issues = signIssueList(raw.sign_issues)
  let is_area_sign = bool(raw.is_area_sign)
  if (refresh) {
    const recorded = oneOf(SIGN_STATUSES, refresh.sign_status, null)
    if (recorded !== null) {
      sign_status = recorded
      sign_issues = signIssueList(refresh.sign_issues)
    } else {
      // The placeholder the refresh prompt asks for, enforced.
      sign_status = 'readable'
      sign_issues = []
    }
    if (typeof refresh.is_area_sign === 'boolean') is_area_sign = refresh.is_area_sign
  }
  if (sign_status === 'readable') sign_issues = []

  if (NO_READABLE_SIGN_STATUSES.includes(sign_status)) {
    return {
      sign_status,
      sign_issues,
      rules: '',
      observations: [],
      can_park_now: false,
      until: null,
      duration_minutes: null,
      confidence: oneOf(CONFIDENCE_LEVELS, raw.confidence, 'low'),
      requires_ticket: false,
      payment_methods: null,
      requires_disabled_permit: false,
      is_permit_zone: false,
      permit_area: null,
      is_area_sign: false,
      permit_exception: noPermitExceptions(permitTypes),
      recurring_restrictions: [],
      next_transition: null,
      clarification: null,
    }
  }

  const out = {
    sign_status,
    sign_issues,
    rules: fitModelText(raw.rules, SIGN_READING_CAPS.rules),
    observations: observationGroups(raw.observations),
    can_park_now: bool(raw.can_park_now),
    until: leaveByTime(raw.until, raw),
    duration_minutes: durationMinutes(raw.duration_minutes),
    confidence: oneOf(CONFIDENCE_LEVELS, raw.confidence, 'low'),
    requires_ticket: bool(raw.requires_ticket),
    payment_methods: paymentMethods(raw.payment_methods),
    requires_disabled_permit: bool(raw.requires_disabled_permit),
    is_permit_zone: bool(raw.is_permit_zone),
    permit_area: fitTextOrNull(raw.permit_area, SIGN_READING_CAPS.permitArea),
    is_area_sign,
    permit_exception: permitExceptions(raw.permit_exception_type, raw.permit_exception_text, permitTypes),
    recurring_restrictions: recurringRestrictions(raw.recurring_restrictions),
    next_transition: nextTransition(raw.next_transition),
    clarification: clarification(raw.clarification, permitTypes),
  }

  if (out.clarification && out.clarification.options.some((o) => o.is_area_sign)) out.is_area_sign = true
  return out
}
