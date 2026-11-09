// @vitest-environment node
//
// The accuracy harness's statistics (spec T9 item 1): Wilson intervals,
// rates counted per sign rather than per run, nearest-rank p50/p90 and
// cost from token usage.
import { describe, expect, it } from 'vitest'
import { PRICES_USD_PER_MTOK, costFromUsage, percentile, perSignRate, priceFor, sumUsage, wilson } from './stats.mjs'

describe('wilson', () => {
  it('matches the published Wilson interval for 5 of 10', () => {
    const [lo, hi] = wilson(5, 10)
    expect(lo).toBeCloseTo(0.2366, 4)
    expect(hi).toBeCloseTo(0.7634, 4)
  })

  it('is not zero-width at 0% and 100%, and stays inside [0, 1]', () => {
    const [lo0, hi0] = wilson(0, 10)
    expect(lo0).toBe(0)
    expect(hi0).toBeCloseTo(0.2775, 4)
    const [lo1, hi1] = wilson(10, 10)
    expect(lo1).toBeCloseTo(0.7225, 4)
    expect(hi1).toBe(1)
  })

  it('matches 18 of 20 and narrows as n grows at the same rate', () => {
    const [lo, hi] = wilson(18, 20)
    expect(lo).toBeCloseTo(0.6990, 3)
    expect(hi).toBeCloseTo(0.9721, 3)
    const [lo2, hi2] = wilson(180, 200)
    expect(hi2 - lo2).toBeLessThan(hi - lo)
  })

  it('accepts a fractional success count and rejects impossible ones', () => {
    const [lo, hi] = wilson(2.5, 4)
    expect(lo).toBeGreaterThan(0)
    expect(hi).toBeLessThan(1)
    expect(wilson(0, 0)).toBeNull()
    expect(() => wilson(5, 4)).toThrow(RangeError)
    expect(() => wilson(-1, 4)).toThrow(RangeError)
  })
})

describe('perSignRate', () => {
  const trial = (id, ok, extra = {}) => ({ id, ok, ...extra })

  it('counts each sign once, weighted by its share of right runs', () => {
    // Sign a: 3 of 3 runs right. Sign b: 1 of 3 right.
    const trials = [
      trial('a', true),
      trial('a', true),
      trial('a', true),
      trial('b', true),
      trial('b', false),
      trial('b', false),
    ]
    const r = perSignRate(trials, { succeeds: (t) => t.ok })
    expect(r.signs).toBe(2)
    expect(r.runs).toBe(6)
    expect(r.run_successes).toBe(4)
    expect(r.rate).toBeCloseTo((1 + 1 / 3) / 2, 10)
    // The interval uses 2 signs, not 6 runs: as wide as 1.333 of 2.
    expect(r.ci95).toEqual(wilson((1 + 1 / 3), 2))
  })

  it('a sign with many runs does not outweigh a sign with one', () => {
    const trials = [...Array.from({ length: 9 }, () => trial('many', true)), trial('one', false)]
    expect(perSignRate(trials, { succeeds: (t) => t.ok }).rate).toBe(0.5)
  })

  it('leaves out runs the denominator excludes, and signs with none left', () => {
    const trials = [trial('a', true, { in: true }), trial('a', false, { in: false }), trial('b', false, { in: false })]
    const r = perSignRate(trials, { includes: (t) => t.in, succeeds: (t) => t.ok })
    expect(r.signs).toBe(1)
    expect(r.rate).toBe(1)
  })

  it('reports no rate when nothing is included', () => {
    const r = perSignRate([trial('a', true)], { includes: () => false, succeeds: () => true })
    expect(r).toMatchObject({ signs: 0, runs: 0, rate: null, ci95: null })
  })
})

describe('percentile (nearest rank)', () => {
  it('p50 and p90 of 1..10 are 5 and 9', () => {
    const xs = [7, 3, 10, 1, 9, 2, 8, 4, 6, 5]
    expect(percentile(xs, 50)).toBe(5)
    expect(percentile(xs, 90)).toBe(9)
    expect(percentile(xs, 100)).toBe(10)
  })

  it('returns an observed value, never an interpolated one', () => {
    expect(percentile([100, 200], 50)).toBe(100)
    expect(percentile([100, 200], 90)).toBe(200)
    expect(percentile([42], 90)).toBe(42)
  })

  it('ignores missing values and returns null when there are none', () => {
    expect(percentile([null, 30, undefined, NaN, 10, 20], 50)).toBe(20)
    expect(percentile([], 50)).toBeNull()
    expect(percentile([null], 90)).toBeNull()
  })
})

describe('costFromUsage', () => {
  const sonnet = PRICES_USD_PER_MTOK['claude-sonnet-4-6']

  it('prices input and output tokens (thinking is inside output)', () => {
    // 2,000 in at $3/M + 1,000 out at $15/M = 0.006 + 0.015
    expect(costFromUsage({ input_tokens: 2000, output_tokens: 1000 }, sonnet)).toBeCloseTo(0.021, 10)
  })

  it('prices cache writes at 1.25x input and cache reads at 0.1x', () => {
    const cost = costFromUsage(
      { input_tokens: 100, output_tokens: 0, cache_creation_input_tokens: 2000, cache_read_input_tokens: 10000 },
      sonnet,
    )
    expect(cost).toBeCloseTo((100 * 3 + 2000 * 3.75 + 10000 * 0.3) / 1e6, 12)
  })

  it('uses the TTL breakdown when the API returns one (1-hour writes at 2x)', () => {
    const cost = costFromUsage(
      {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 3000,
        cache_creation: { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 2000 },
      },
      sonnet,
    )
    expect(cost).toBeCloseTo((1000 * 3.75 + 2000 * 6) / 1e6, 12)
  })

  it('returns null without usage or a price, and the model must be in the table', () => {
    expect(costFromUsage(null, sonnet)).toBeNull()
    expect(costFromUsage({ input_tokens: 5 }, null)).toBeNull()
    expect(priceFor('claude-sonnet-4-6')).toBe(sonnet)
    expect(priceFor('some-other-model')).toBeNull()
  })

  it('sumUsage adds retried responses so one scan is priced as a whole', () => {
    const total = sumUsage([
      { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50 },
      null,
      { input_tokens: 200, output_tokens: 20, cache_creation_input_tokens: 5 },
    ])
    expect(total).toMatchObject({ input_tokens: 300, output_tokens: 30, cache_read_input_tokens: 50, cache_creation_input_tokens: 5 })
    expect(costFromUsage(total, sonnet)).toBeCloseTo((300 * 3 + 30 * 15 + 50 * 0.3 + 5 * 3.75) / 1e6, 12)
    expect(sumUsage([null, undefined])).toBeNull()
  })
})
