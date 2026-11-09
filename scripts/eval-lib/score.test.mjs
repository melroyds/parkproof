// @vitest-environment node
//
// Scoring one answer against its label, and summing runs into the metrics
// (spec T9 item 1): the null-until fix, duration and sign-detail scoring,
// position questions, false "you can park" vs false "you can't", accuracy
// by confidence, latency and cost.
import { describe, expect, it } from 'vitest'
import { normalizeEntry } from './corpus.mjs'
import { failingRunCount, pickAnswer, scoreFlag, scoreTrial, summarize, summarizeByTag } from './score.mjs'
import { PRICES_USD_PER_MTOK, wilson } from './stats.mjs'

function label(overrides = {}) {
  const { expected, ...rest } = overrides
  const { entry, errors } = normalizeEntry(
    {
      format: 2,
      id: 'sign',
      image: 'sign.jpg',
      split: 'dev',
      scanContext: { lat: -37.798, lng: 144.9675, datetime: '2026-05-20T14:30:00+10:00' },
      expected: { can_park_now: true, until: '2026-05-20T16:00:00+10:00', duration_minutes: 90, ...expected },
      ...rest,
    },
    'sign.json',
  )
  if (!entry) throw new Error(errors.join('; '))
  return entry
}

function answer(overrides = {}) {
  return {
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    can_park_now: true,
    until: '2026-05-20T16:00:00+10:00',
    duration_minutes: 90,
    confidence: 'high',
    requires_ticket: false,
    payment_methods: null,
    requires_disabled_permit: false,
    is_permit_zone: false,
    permit_area: null,
    next_transition: null,
    clarification: null,
    ...overrides,
  }
}

describe('scoreTrial: the leave-by time', () => {
  it('a label of "no leave-by time" (null) fails an answer that gives one', () => {
    // The old harness skipped the leave-by check whenever the label's until
    // was null, so any time the model made up passed.
    const entry = label({ expected: { can_park_now: true, until: null, duration_minutes: null } })
    const s = scoreTrial(entry, answer({ until: '2026-05-20T18:00:00+10:00', duration_minutes: 210 }), null)
    expect(s.verdict.ok).toBe(true)
    expect(s.until).toMatchObject({ scored: true, ok: false })
    expect(s.pass).toBe(false)
    expect(s.failures.join('\n')).toMatch(/leave-by: label none, got 2026-05-20T18:00/)
  })

  it("can't park with a null label: a made-up leave-by time also fails", () => {
    const entry = label({ expected: { can_park_now: false, until: null, duration_minutes: null } })
    expect(scoreTrial(entry, answer({ can_park_now: false, until: '2026-05-20T19:00:00+10:00' }), null).pass).toBe(false)
    expect(scoreTrial(entry, answer({ can_park_now: false, until: null, duration_minutes: null }), null).pass).toBe(true)
  })

  it('passes within one minute, in any offset, and fails beyond it', () => {
    const entry = label()
    expect(scoreTrial(entry, answer({ until: '2026-05-20T16:01:00+10:00' }), null).pass).toBe(true)
    expect(scoreTrial(entry, answer({ until: '2026-05-20T06:00:00Z' }), null).pass).toBe(true)
    const late = scoreTrial(entry, answer({ until: '2026-05-20T16:02:00+10:00' }), null)
    expect(late.pass).toBe(false)
    expect(late.until.delta_minutes).toBe(2)
  })

  it('says which way a wrong leave-by time is off: late lets you stay past the label', () => {
    const entry = label()
    expect(scoreTrial(entry, answer({ until: '2026-05-20T16:30:00+10:00' }), null).until.direction).toBe('late')
    expect(scoreTrial(entry, answer({ until: '2026-05-20T15:30:00+10:00' }), null).until.direction).toBe('early')
    // No leave-by time when the label has one: you'd stay on past it.
    expect(scoreTrial(entry, answer({ until: null }), null).until.direction).toBe('late')
    expect(scoreTrial(entry, answer(), null).until.direction).toBeNull()
    // A made-up leave-by time on a "no leave-by time" label moves you on early.
    const none = label({ expected: { can_park_now: true, until: null, duration_minutes: null } })
    expect(scoreTrial(none, answer({ until: '2026-05-20T18:00:00+10:00' }), null).until.direction).toBe('early')
  })

  it('a leave-by time with no zone offset fails, since the app would read it in the phone zone', () => {
    expect(scoreTrial(label(), answer({ until: '2026-05-20T16:00:00' }), null).pass).toBe(false)
    expect(scoreTrial(label(), answer({ until: null }), null).pass).toBe(false)
  })

  it('is only scored when the label states it (a version 1 label may not), and only after a right verdict', () => {
    const unlabelled = label({ format: undefined, expected: { can_park_now: true, until: undefined, duration_minutes: undefined } })
    const s = scoreTrial(unlabelled, answer({ until: '2026-05-21T09:00:00+10:00' }), null)
    expect(s.until.scored).toBe(false)
    expect(s.pass).toBe(true)

    const wrong = scoreTrial(label(), answer({ can_park_now: false, until: null }), null)
    expect(wrong.pass).toBe(false)
    expect(wrong.until.scored).toBe(false)
    expect(wrong.failures[0]).toMatch(/verdict: said you can't park, label says you can park/)
  })
})

describe('scoreTrial: minutes and sign details', () => {
  it('scores duration_minutes within a minute, with null matching only null', () => {
    expect(scoreTrial(label(), answer({ duration_minutes: 91 }), null).duration.ok).toBe(true)
    const off = scoreTrial(label(), answer({ duration_minutes: 120 }), null)
    expect(off.duration.ok).toBe(false)
    // Duration is reported on its own, it doesn't decide the headline.
    expect(off.pass).toBe(true)
    const none = label({ expected: { can_park_now: true, until: null, duration_minutes: null } })
    expect(scoreTrial(none, answer({ until: null, duration_minutes: 30 }), null).duration.ok).toBe(false)
    expect(scoreTrial(none, answer({ until: null, duration_minutes: null }), null).duration.ok).toBe(true)
  })

  it('scores only the details the label states', () => {
    const entry = label({ expected_flags: { requires_ticket: true, permit_area: '25' } })
    const s = scoreTrial(entry, answer({ requires_ticket: true, permit_area: '24', is_permit_zone: true }), null)
    expect(Object.keys(s.flags).sort()).toEqual(['permit_area', 'requires_ticket'])
    expect(s.flags.requires_ticket.ok).toBe(true)
    expect(s.flags.permit_area.ok).toBe(false)
  })

  it('payment methods compare as a set, and null equals an empty list', () => {
    expect(scoreFlag('payment_methods', ['meter', 'easypark'], ['EasyPark', 'meter', 'meter']).ok).toBe(true)
    expect(scoreFlag('payment_methods', ['meter'], ['meter', 'paystay']).ok).toBe(false)
    expect(scoreFlag('payment_methods', null, []).ok).toBe(true)
    expect(scoreFlag('permit_area', '12a', ' 12A ').ok).toBe(true)
    expect(scoreFlag('requires_ticket', false, 'false').ok).toBe(false)
  })

  it('a detail the model does not return yet (is_area_sign before T3) is not scored', () => {
    const entry = label({ expected_flags: { is_area_sign: false } })
    const s = scoreTrial(entry, answer(), null)
    expect(s.flags.is_area_sign).toMatchObject({ returned: false, ok: null })
    expect(scoreTrial(entry, answer({ is_area_sign: true }), null).flags.is_area_sign.ok).toBe(false)
  })

  it('sign condition is scored only when the model returns sign_status', () => {
    const entry = label({ expected_sign_status: 'partially_obscured' })
    expect(scoreTrial(entry, answer(), null).sign_status).toMatchObject({ labelled: true, returned: false, ok: null })
    expect(scoreTrial(entry, answer({ sign_status: 'readable' }), null).sign_status.ok).toBe(false)
    expect(scoreTrial(entry, answer({ sign_status: 'partially_obscured' }), null).sign_status.ok).toBe(true)
  })
})

describe('photos with no readable parking sign (the T3 seam)', () => {
  const noSign = (status = 'missing') =>
    label({ expected_sign_status: status, expected: { can_park_now: false, until: null, duration_minutes: null } })

  it('before T3 (no sign_status returned) the verdict is scored as labelled', () => {
    const s = scoreTrial(noSign(), answer({ can_park_now: false, until: null, duration_minutes: null }), null)
    expect(s.no_sign).toBeUndefined()
    expect(s.pass).toBe(true)
    expect(scoreTrial(noSign(), answer({ can_park_now: true }), null).verdict).toMatchObject({ expected: false, got: true, ok: false })
  })

  it('from T3 on, the right answer is the no-sign screen, with no verdict to score', () => {
    // The model's can_park_now doesn't matter: the driver never sees it.
    const s = scoreTrial(noSign(), answer({ sign_status: 'not_a_parking_sign', can_park_now: true }), null)
    expect(s).toMatchObject({ scorable: true, pass: true, no_sign: true, verdict: { expected: null, ok: true } })
    expect(s.sign_status.ok).toBe(false)
    const read = scoreTrial(noSign('not_a_parking_sign'), answer({ sign_status: 'readable' }), null)
    expect(read).toMatchObject({ pass: false, no_sign: true, verdict: { expected: null, got: true, ok: false } })
    expect(read.failures.join('\n')).toMatch(/no sign: label says there's no readable parking sign, the model read one \(readable\)/)
  })

  it('from T3 on, a real sign the model calls signless gets no verdict, which is wrong', () => {
    const s = scoreTrial(label(), answer({ sign_status: 'missing' }), null)
    expect(s).toMatchObject({ scorable: true, pass: false, verdict: { expected: true, got: null, ok: false } })
    expect(s.failures[0]).toMatch(/verdict: found no readable parking sign \(missing\), label says you can park/)
    expect(failingRunCount([{ score: s }])).toBe(1)
  })

  it('no-sign photos are left out of both false-answer rates', () => {
    const trial = (entry, output) => ({ id: entry.id, tags: [], has_variant_label: false, latency_ms: 1, usage: null, score: scoreTrial(entry, output, null) })
    const m = summarize([
      trial({ ...noSign(), id: 'n1' }, answer({ sign_status: 'readable', can_park_now: true })),
      trial({ ...noSign(), id: 'n2' }, answer({ sign_status: 'missing' })),
    ])
    expect(m.answer).toMatchObject({ signs: 2, rate: 0.5 })
    expect(m.false_park.signs).toBe(0)
    expect(m.false_no_park.signs).toBe(0)
  })
})

describe('the position question', () => {
  const both = (overrides = {}) =>
    answer({
      can_park_now: true,
      until: '2026-05-20T18:00:00+10:00',
      clarification: {
        question: 'Where are you parked?',
        options: [
          { label: 'Left side', can_park_now: true, until: '2026-05-20T18:00:00+10:00', duration_minutes: 210, requires_disabled_permit: false, is_permit_zone: false, permit_area: null },
          { label: 'Right side', can_park_now: true, until: '2026-05-20T16:00:00+10:00', duration_minutes: 90, requires_disabled_permit: true, is_permit_zone: false, permit_area: null },
        ],
      },
      ...overrides,
    })

  it('scores the labelled option, matched without regard to case or spacing, merged like the app', () => {
    const entry = label({ expected_variant: ['right  SIDE'], expected_flags: { requires_disabled_permit: true } })
    const s = scoreTrial(entry, both(), null)
    expect(s.variant).toBe('matched')
    expect(s.pass).toBe(true)
    expect(s.flags.requires_disabled_permit.ok).toBe(true)
    // The top-level answer (least restrictive, 6 pm) would have failed.
    expect(scoreTrial(label(), both(), null).pass).toBe(false)
  })

  it('an option list without the labelled position is wrong and not scorable', () => {
    const s = scoreTrial(label({ expected_variant: 'Bay 12' }), both(), null)
    expect(s).toMatchObject({ scorable: false, pass: false, variant: 'not_offered' })
    expect(s.failures[0]).toMatch(/model offered Left side, Right side/)
  })

  it('a labelled position the model never asks about scores the top-level answer', () => {
    const s = scoreTrial(label({ expected_variant: 'Right side' }), answer(), null)
    expect(s.variant).toBe('not_asked')
    expect(s.pass).toBe(true)
  })

  it('one option is not a question (the app shows the answer straight away)', () => {
    const one = answer({ clarification: { question: 'q', options: [{ label: 'Only', can_park_now: false }] } })
    expect(pickAnswer(one, null)).toMatchObject({ variant: 'none' })
    expect(pickAnswer(both(), null)).toMatchObject({ variant: 'unexpected' })
  })
})

describe('summarize', () => {
  const sonnet = PRICES_USD_PER_MTOK['claude-sonnet-4-6']
  const canPark = label({ id: 'can' })
  const cannot = label({ id: 'cannot', expected: { can_park_now: false, until: null, duration_minutes: null } })
  const trial = (entry, output, extra = {}) => ({
    id: entry.id,
    tags: entry.tags,
    has_variant_label: !!entry.expected_variant,
    latency_ms: 1000,
    usage: { input_tokens: 1000, output_tokens: 100 },
    score: scoreTrial(entry, output, extra.error ?? null),
    ...extra,
  })

  it('reports false "you can park" apart from false "you can\'t"', () => {
    const trials = [
      // The sign says you can't park; the model said you can. The costly mistake.
      trial(cannot, answer({ can_park_now: true })),
      trial(canPark, answer()),
      trial(label({ id: 'can2' }), answer({ can_park_now: false, until: null })),
      trial(label({ id: 'can3' }), answer()),
    ]
    const m = summarize(trials)
    expect(m.false_park).toMatchObject({ signs: 1, run_successes: 1, rate: 1 })
    expect(m.false_no_park.signs).toBe(3)
    expect(m.false_no_park.rate).toBeCloseTo(1 / 3, 10)
    expect(m.answer.rate).toBe(0.5)
    expect(m.answer.ci95).toEqual(wilson(2, 4))
    expect(failingRunCount(trials)).toBe(2)
  })

  it('counts an error as a wrong answer but keeps it out of the false-answer rates', () => {
    const trials = [
      trial(cannot, null, { error: 'ERR_SIGN_UNREADABLE', latency_ms: null, usage: null }),
      trial(cannot, answer({ can_park_now: false, until: null, duration_minutes: null })),
    ]
    const m = summarize(trials, { runs: 2 })
    expect(m.errors).toBe(1)
    expect(m.answer.rate).toBe(0.5)
    expect(m.false_park).toMatchObject({ runs: 1, rate: 0 })
    expect(m.stability).toEqual({ always_right: 0, always_wrong: 0, mixed: 1 })
    expect(m.latency_ms.reads).toBe(1)
    expect(failingRunCount(trials)).toBe(1)
  })

  it('splits accuracy by the confidence the model reported', () => {
    const trials = [
      trial(label({ id: 'h1' }), answer({ confidence: 'high' })),
      trial(label({ id: 'h2' }), answer({ confidence: 'high' })),
      trial(label({ id: 'l1' }), answer({ confidence: 'low', can_park_now: false, until: null })),
      trial(label({ id: 'l2' }), answer({ confidence: 'low' })),
    ]
    const m = summarize(trials)
    expect(m.by_confidence.high).toMatchObject({ signs: 2, rate: 1 })
    expect(m.by_confidence.low).toMatchObject({ signs: 2, rate: 0.5 })
    expect(m.by_confidence.medium).toMatchObject({ signs: 0, rate: null })
  })

  it('reports p50/p90 time per read and the cost from usage', () => {
    const latencies = [900, 1200, 4000, 1500, 2100, 1800, 1300, 1100, 1000, 9000]
    const trials = latencies.map((ms, i) => trial(label({ id: `s${i}` }), answer(), { latency_ms: ms }))
    const m = summarize(trials, { price: sonnet })
    expect(m.latency_ms).toEqual({ p50: 1300, p90: 4000, reads: 10 })
    const each = (1000 * 3 + 100 * 15) / 1e6
    expect(m.cost_usd.per_read).toBeCloseTo(each, 12)
    expect(m.cost_usd.total).toBeCloseTo(each * 10, 12)
    expect(summarize(trials).cost_usd.per_read).toBeNull()
  })

  it('leaves errors out of the position rate (they still count as wrong answers)', () => {
    const positioned = label({ id: 'pos', expected_variant: 'Right side' })
    const trials = [
      trial(positioned, null, { error: 'ERR_SIGN_UNREADABLE', latency_ms: null, usage: null, has_variant_label: true }),
      trial(positioned, answer({ clarification: { question: 'q', options: [{ label: 'Right side', can_park_now: true, until: '2026-05-20T16:00:00+10:00', duration_minutes: 90 }, { label: 'Left side', can_park_now: false }] } }), {
        has_variant_label: true,
      }),
    ]
    const m = summarize(trials, { runs: 2 })
    expect(m.position).toMatchObject({ signs: 1, runs: 1, rate: 1 })
    expect(m.answer.rate).toBe(0.5)
  })

  it('measures the leave-by time on can-park signs only, and reports late leave-by times', () => {
    const trials = [
      // A can't-park sign read right: "no leave-by time" is trivially right, so not counted.
      trial(cannot, answer({ can_park_now: false, until: null, duration_minutes: null })),
      trial(label({ id: 'right' }), answer()),
      trial(label({ id: 'late' }), answer({ until: '2026-05-20T17:00:00+10:00', duration_minutes: 150 })),
      trial(label({ id: 'early' }), answer({ until: '2026-05-20T15:00:00+10:00', duration_minutes: 30 })),
    ]
    const m = summarize(trials)
    expect(m.until).toMatchObject({ signs: 3, run_successes: 1 })
    expect(m.until_late).toMatchObject({ signs: 3, run_successes: 1 })
    expect(m.duration).toMatchObject({ signs: 3, run_successes: 1 })
  })

  it('reports detail and position rates only where labelled, and by tag', () => {
    const tagged = label({ id: 't', tags: ['clearway'], expected_flags: { requires_ticket: true } })
    const trials = [trial(tagged, answer({ requires_ticket: false })), trial(label({ id: 'u' }), answer())]
    const m = summarize(trials)
    expect(Object.keys(m.flags)).toEqual(['requires_ticket'])
    expect(m.flags.requires_ticket.rate).toBe(0)
    expect(m.position.signs).toBe(0)
    expect(m.sign_status).toBeNull()
    expect(summarizeByTag(trials)).toEqual({ clearway: expect.objectContaining({ signs: 1, rate: 1 }) })
  })
})
