// Scoring for the accuracy harness: compares one model answer with its
// label, then sums many runs into the reported metrics. Pure functions.
//
// The answer that is scored is the one the driver would see in the app.
// When the model asks where you're parked (more than one option, as in
// App.handleCapture), the scored answer is the option the label names,
// merged the way App.handlePickVariant merges it. When it doesn't ask, the
// top-level answer is scored.

import { FLAG_KEYS, TOLERANCE_MINUTES } from './corpus.mjs'
import { costFromUsage, percentile, perSignRate } from './stats.mjs'

/** A leave-by time or a duration within this many minutes of the label counts as right. */
export { TOLERANCE_MINUTES }
/**
 * Sign statuses that get T3's "We couldn't find a readable parking sign"
 * screen instead of a verdict.
 */
export const NO_SIGN_STATUSES = new Set(['missing', 'not_a_parking_sign'])
const CONFIDENCES = ['high', 'medium', 'low']
const OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/

export function normalizeLabel(label) {
  return String(label ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** The chosen variant merged onto the top-level answer, as App.handlePickVariant does. */
export function mergeVariant(output, variant) {
  return {
    ...output,
    rules: variant.rules,
    can_park_now: variant.can_park_now,
    until: variant.until,
    duration_minutes: variant.duration_minutes,
    requires_disabled_permit: variant.requires_disabled_permit ?? false,
    is_permit_zone: variant.is_permit_zone ?? false,
    permit_area: variant.permit_area ?? null,
    // Per-variant from T3 on; the top-level value before that.
    is_area_sign: variant.is_area_sign !== undefined ? variant.is_area_sign : output.is_area_sign,
    clarification: null,
    chosen_label: variant.label,
  }
}

/**
 * Picks the answer to score. `variant` says how the position question went:
 *   'none'        no position in the label and the model didn't ask
 *   'matched'     the model asked and offered the labelled position
 *   'not_offered' the model asked but none of its options is the labelled position
 *   'not_asked'   the label names a position but the model didn't ask
 *   'unexpected'  the model asked though the label names no position
 * `answer` is null only for 'not_offered'.
 */
export function pickAnswer(output, expectedVariants) {
  const options = Array.isArray(output?.clarification?.options) ? output.clarification.options : []
  const offered = options.map((o) => String(o?.label ?? ''))
  const asked = options.length > 1
  if (asked && expectedVariants) {
    const wanted = new Set(expectedVariants.map(normalizeLabel))
    const hit = options.find((o) => wanted.has(normalizeLabel(o?.label)))
    if (!hit) return { answer: null, variant: 'not_offered', offered }
    return { answer: mergeVariant(output, hit), variant: 'matched', offered }
  }
  if (asked) return { answer: output, variant: 'unexpected', offered }
  return { answer: output, variant: expectedVariants ? 'not_asked' : 'none', offered }
}

const describePark = (v) => (v === true ? 'you can park' : v === false ? "you can't park" : 'no answer')

/**
 * The leave-by time. `direction` says which way a wrong one is off: 'late'
 * when it lets you stay past the labelled time (including no leave-by time
 * when the label has one), the mistake that can cost a fine; 'early' when
 * it moves you on sooner (including a made-up leave-by time). Null when
 * right, or when a time with no zone can't be placed.
 */
function scoreUntil(expected, answer, verdictOk) {
  if (!('until' in expected) || expected.until === undefined) return { labelled: false, scored: false, ok: null, direction: null }
  const got = answer.until ?? null
  const base = { labelled: true, expected: expected.until, got }
  // Only a right verdict has a leave-by worth checking.
  if (!verdictOk) return { ...base, scored: false, ok: null, direction: null }
  if (expected.until === null) {
    const ok = got === null
    return { ...base, scored: true, ok, direction: ok ? null : 'early' }
  }
  if (typeof got !== 'string' || !OFFSET_RE.test(got.trim())) {
    // No time, or a time with no zone: the app would read it in the phone's zone.
    return { ...base, scored: true, ok: false, direction: got === null ? 'late' : null }
  }
  const gotMs = Date.parse(got)
  if (!Number.isFinite(gotMs)) return { ...base, scored: true, ok: false, direction: null }
  const deltaMinutes = (gotMs - Date.parse(expected.until)) / 60_000
  const ok = Math.abs(deltaMinutes) <= TOLERANCE_MINUTES
  return { ...base, scored: true, ok, delta_minutes: deltaMinutes, direction: ok ? null : deltaMinutes > 0 ? 'late' : 'early' }
}

function scoreDuration(expected, answer, verdictOk) {
  if (!('duration_minutes' in expected) || expected.duration_minutes === undefined) {
    return { labelled: false, scored: false, ok: null }
  }
  const got = answer.duration_minutes ?? null
  const base = { labelled: true, expected: expected.duration_minutes, got }
  if (!verdictOk) return { ...base, scored: false, ok: null }
  if (expected.duration_minutes === null) return { ...base, scored: true, ok: got === null }
  if (!Number.isFinite(got)) return { ...base, scored: true, ok: false }
  return { ...base, scored: true, ok: Math.abs(got - expected.duration_minutes) <= TOLERANCE_MINUTES }
}

const normalizeArea = (v) => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().toUpperCase())
const normalizeMethods = (v) =>
  Array.isArray(v) ? [...new Set(v.map((m) => String(m).trim().toLowerCase()).filter(Boolean))].sort().join('|') : ''

/**
 * One sign detail. `returned: false` when the model output has no such
 * field at all (for example is_area_sign before T3 adds it): not scored.
 * payment_methods compares as a set, and null equals an empty list.
 */
export function scoreFlag(key, expected, got) {
  if (got === undefined) return { expected, got: null, returned: false, ok: null }
  let ok
  if (key === 'permit_area') ok = normalizeArea(expected) === normalizeArea(got)
  else if (key === 'payment_methods') ok = normalizeMethods(expected) === normalizeMethods(got)
  else ok = typeof got === 'boolean' && got === expected
  return { expected, got, returned: true, ok }
}

function scoreSignStatus(entry, output) {
  if (!entry.expected_sign_status) return { labelled: false, returned: false, ok: null }
  // sign_status arrives with T3. Before that the model doesn't return it.
  const returned = typeof output.sign_status === 'string'
  return {
    labelled: true,
    returned,
    expected: entry.expected_sign_status,
    got: returned ? output.sign_status : null,
    ok: returned ? output.sign_status === entry.expected_sign_status : null,
  }
}

const NOT_SCORED = Object.freeze({ labelled: false, scored: false, ok: null, direction: null })

/**
 * Scores one run of one sign. `pass` is the headline: the can-park verdict
 * is right and, when the label has a leave-by time (including "no leave-by
 * time", null), the leave-by time is right too. `scorable` is false for an
 * error and for a position question that didn't offer the labelled position.
 *
 * From T3 on, a sign_status of missing or not_a_parking_sign means the app
 * shows "We couldn't find a readable parking sign" and no verdict. So when
 * the model returns sign_status, a photo labelled as having no readable
 * sign passes only when the model says so (`no_sign: true`, no verdict,
 * left out of both false-answer rates), and any other photo the model
 * calls signless gets no verdict, which is wrong. Before T3 the model
 * returns no sign_status and every photo is scored on its verdict.
 */
export function scoreTrial(entry, output, error) {
  const failures = []
  if (error || !output || typeof output !== 'object') {
    const message = error ? String(error) : 'no answer'
    return { scorable: false, pass: false, error: message, variant: null, offered: [], confidence: null, failures: [`error: ${message}`] }
  }
  const confidence = CONFIDENCES.includes(output.confidence) ? output.confidence : null
  const signStatus = scoreSignStatus(entry, output)
  if (signStatus.ok === false) failures.push(`sign condition: label ${signStatus.expected}, got ${signStatus.got}`)
  const returnedStatus = typeof output.sign_status === 'string' ? output.sign_status : null
  const shownNoSign = returnedStatus !== null && NO_SIGN_STATUSES.has(returnedStatus)

  if (returnedStatus !== null && NO_SIGN_STATUSES.has(entry.expected_sign_status)) {
    if (!shownNoSign) {
      failures.push(`no sign: label says there's no readable parking sign, the model read one (${returnedStatus})`)
    }
    return {
      scorable: true,
      pass: shownNoSign,
      error: null,
      no_sign: true,
      variant: 'none',
      offered: [],
      confidence,
      verdict: { expected: null, got: shownNoSign ? null : (output.can_park_now ?? null), ok: shownNoSign },
      until: NOT_SCORED,
      duration: NOT_SCORED,
      flags: {},
      sign_status: signStatus,
      failures,
    }
  }

  if (shownNoSign) {
    // The driver sees the no-sign screen, so there's no verdict, no
    // position question and no sign details to check.
    failures.push(`verdict: found no readable parking sign (${returnedStatus}), label says ${describePark(entry.expected.can_park_now)}`)
    return {
      scorable: true,
      pass: false,
      error: null,
      variant: entry.expected_variant ? 'not_asked' : 'none',
      offered: [],
      confidence,
      verdict: { expected: entry.expected.can_park_now, got: null, ok: false },
      until: { ...NOT_SCORED, labelled: entry.expected.until !== undefined },
      duration: { ...NOT_SCORED, labelled: entry.expected.duration_minutes !== undefined },
      flags: {},
      sign_status: signStatus,
      failures,
    }
  }

  const { answer, variant, offered } = pickAnswer(output, entry.expected_variant)
  if (variant === 'not_offered') {
    failures.push(`position: label says ${entry.expected_variant.join(' or ')}, model offered ${offered.join(', ') || 'nothing'}`)
  } else if (variant === 'not_asked') {
    failures.push(`position: label says ${entry.expected_variant.join(' or ')}, model didn't ask`)
  } else if (variant === 'unexpected') {
    failures.push(`position: model asked (${offered.join(', ')}) though the label names no position`)
  }
  if (!answer) {
    return { scorable: false, pass: false, error: null, variant, offered, confidence, sign_status: signStatus, failures }
  }

  const expected = entry.expected
  const got = typeof answer.can_park_now === 'boolean' ? answer.can_park_now : null
  const verdictOk = got === expected.can_park_now
  if (!verdictOk) {
    failures.push(`verdict: said ${describePark(got)}, label says ${describePark(expected.can_park_now)}`)
  }
  const until = scoreUntil(expected, answer, verdictOk)
  if (until.scored && !until.ok) failures.push(`leave-by: label ${until.expected ?? 'none'}, got ${until.got ?? 'none'}`)
  const duration = scoreDuration(expected, answer, verdictOk)
  if (duration.scored && !duration.ok) {
    failures.push(`minutes: label ${duration.expected ?? 'none'}, got ${duration.got ?? 'none'}`)
  }

  const flags = {}
  for (const key of FLAG_KEYS) {
    if (!(key in entry.expected_flags)) continue
    flags[key] = scoreFlag(key, entry.expected_flags[key], answer[key])
    if (flags[key].ok === false) {
      failures.push(`${key}: label ${JSON.stringify(flags[key].expected)}, got ${JSON.stringify(flags[key].got)}`)
    }
  }

  return {
    scorable: true,
    pass: verdictOk && (until.scored ? until.ok : true),
    error: null,
    variant,
    offered,
    confidence,
    verdict: { expected: expected.can_park_now, got, ok: verdictOk },
    until,
    duration,
    flags,
    sign_status: signStatus,
    failures,
  }
}

/**
 * Sums scored runs into the reported metrics. Every rate is counted per
 * sign (see perSignRate). `trials` are `{ id, tags, latency_ms, usage,
 * score, has_variant_label }`; `price` is the model's price row or null.
 */
export function summarize(trials, { runs = 1, price = null } = {}) {
  const scorable = (t) => t.score.scorable
  const answered = trials.filter((t) => !t.score.error)

  const flags = {}
  for (const key of FLAG_KEYS) {
    const rate = perSignRate(trials, {
      includes: (t) => t.score.flags?.[key]?.ok === true || t.score.flags?.[key]?.ok === false,
      succeeds: (t) => t.score.flags[key].ok === true,
    })
    if (rate.signs) flags[key] = rate
  }

  const byConfidence = {}
  for (const level of CONFIDENCES) {
    const rate = perSignRate(trials, { includes: (t) => scorable(t) && t.score.confidence === level, succeeds: (t) => t.score.pass })
    byConfidence[level] = rate
  }

  const signStatus = perSignRate(trials, {
    includes: (t) => t.score.sign_status?.ok === true || t.score.sign_status?.ok === false,
    succeeds: (t) => t.score.sign_status.ok === true,
  })

  let stability = null
  if (runs > 1) {
    const bySign = new Map()
    for (const t of trials) {
      const s = bySign.get(t.id) ?? { pass: 0, n: 0 }
      s.n += 1
      if (t.score.pass) s.pass += 1
      bySign.set(t.id, s)
    }
    stability = { always_right: 0, always_wrong: 0, mixed: 0 }
    for (const s of bySign.values()) {
      if (s.pass === s.n) stability.always_right += 1
      else if (s.pass === 0) stability.always_wrong += 1
      else stability.mixed += 1
    }
  }

  // Leave-by and minutes are measured where the label says you can park:
  // on a can't-park sign "no leave-by time" is right whenever the verdict
  // is, so counting those would inflate the rate without any time maths.
  const leaveBy = (t) => scorable(t) && t.score.verdict.expected === true && t.score.until.scored
  const latencies = answered.map((t) => t.latency_ms)
  const costs = trials.map((t) => costFromUsage(t.usage, price)).filter((c) => c !== null)

  return {
    // Errors and unanswerable position questions count as wrong here.
    answer: perSignRate(trials, { succeeds: (t) => t.score.pass }),
    verdict: perSignRate(trials, { includes: scorable, succeeds: (t) => t.score.verdict.ok }),
    // Of the runs on signs where you can't park, the share that said you
    // can. Photos labelled as having no readable sign have no verdict
    // (expected null) and are left out of both false-answer rates.
    false_park: perSignRate(trials, {
      includes: (t) => scorable(t) && t.score.verdict.expected === false,
      succeeds: (t) => t.score.verdict.got === true,
    }),
    // Of the runs on signs where you can park, the share that said you can't.
    false_no_park: perSignRate(trials, {
      includes: (t) => scorable(t) && t.score.verdict.expected === true,
      succeeds: (t) => t.score.verdict.got === false,
    }),
    until: perSignRate(trials, { includes: leaveBy, succeeds: (t) => t.score.until.ok }),
    // Of those, the share whose leave-by time let you stay past the label's
    // (or gave none when the label has one): the leave-by mistake that can
    // cost a fine.
    until_late: perSignRate(trials, { includes: leaveBy, succeeds: (t) => t.score.until.direction === 'late' }),
    duration: perSignRate(trials, {
      includes: (t) => scorable(t) && t.score.verdict.expected === true && t.score.duration.scored,
      succeeds: (t) => t.score.duration.ok,
    }),
    flags,
    sign_status: signStatus.signs ? signStatus : null,
    sign_status_not_returned: trials.filter((t) => t.score.sign_status?.labelled && !t.score.sign_status.returned).length,
    // An error says nothing about the position question, so it's left out
    // here (it still counts as wrong in the headline).
    position: perSignRate(trials, {
      includes: (t) => t.has_variant_label && !t.score.error && !t.score.no_sign,
      succeeds: (t) => t.score.variant === 'matched',
    }),
    unexpected_position_question: trials.filter((t) => t.score.variant === 'unexpected').length,
    by_confidence: byConfidence,
    errors: trials.filter((t) => t.score.error).length,
    unscorable: trials.filter((t) => !t.score.scorable && !t.score.error).length,
    stability,
    latency_ms: { p50: percentile(latencies, 50), p90: percentile(latencies, 90), reads: latencies.length },
    cost_usd: {
      total: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
      per_read: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
      priced_reads: costs.length,
    },
  }
}

/** The answer rate for every tag that appears in the runs. */
export function summarizeByTag(trials) {
  const tags = [...new Set(trials.flatMap((t) => t.tags ?? []))].sort()
  return Object.fromEntries(
    tags.map((tag) => [tag, perSignRate(trials, { includes: (t) => (t.tags ?? []).includes(tag), succeeds: (t) => t.score.pass })]),
  )
}

/** Wrong verdicts and errors make the run fail, so the harness works as a CI gate. */
export function failingRunCount(trials) {
  return trials.filter((t) => !t.score.scorable || !t.score.verdict.ok).length
}
