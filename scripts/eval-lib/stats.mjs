// Statistics for the accuracy harness: Wilson intervals, rates counted per
// sign, nearest-rank percentiles and model cost from token usage. Pure
// functions with no I/O, so the maths can be tested on its own.

/** The normal quantile for a two-sided 95% interval. */
export const Z95 = 1.959963984540054

/**
 * Wilson score interval for `successes` out of `n`. Unlike the plain
 * p +/- z*sqrt(p(1-p)/n) interval it stays inside [0, 1] and is not
 * zero-width at 0% or 100%, which matters for a small labelled set.
 * `successes` may be fractional (a mean of per-sign rates times the number
 * of signs, see perSignRate). Returns null when n is 0.
 */
export function wilson(successes, n, z = Z95) {
  if (!(n > 0)) return null
  if (!(successes >= 0 && successes <= n)) {
    throw new RangeError(`wilson: successes ${successes} must be between 0 and ${n}`)
  }
  const p = successes / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  // At 0% and 100% the bounds are exactly 0 and 1; say so rather than
  // leave a rounding error such as 0.9999999999999999.
  const lo = successes === 0 ? 0 : Math.max(0, centre - half)
  const hi = successes === n ? 1 : Math.min(1, centre + half)
  return [lo, hi]
}

/**
 * A rate counted per sign, not per run. Repeat runs of the same photo are
 * not independent, so each sign counts once: its weight is the share of its
 * runs that succeeded, and the interval uses the number of signs. With one
 * run per sign this is the ordinary rate and Wilson interval.
 *
 * `includes(trial)` says whether a run belongs in this rate's denominator,
 * `succeeds(trial)` whether it counts as a success. A sign none of whose runs
 * are included is left out.
 */
export function perSignRate(trials, { includes = () => true, succeeds }) {
  const bySign = new Map()
  for (const trial of trials) {
    if (!includes(trial)) continue
    const s = bySign.get(trial.id) ?? { n: 0, k: 0 }
    s.n += 1
    if (succeeds(trial)) s.k += 1
    bySign.set(trial.id, s)
  }
  let weighted = 0
  let runs = 0
  let runSuccesses = 0
  for (const s of bySign.values()) {
    weighted += s.k / s.n
    runs += s.n
    runSuccesses += s.k
  }
  const signs = bySign.size
  return {
    signs,
    runs,
    run_successes: runSuccesses,
    rate: signs ? weighted / signs : null,
    ci95: signs ? wilson(Math.min(signs, weighted), signs) : null,
  }
}

/**
 * Nearest-rank percentile: the smallest observed value with at least p% of
 * the values at or below it. Always one of the observed values. Non-finite
 * values are ignored; returns null when none are left.
 */
export function percentile(values, p) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!xs.length) return null
  const rank = Math.ceil((p / 100) * xs.length)
  return xs[Math.min(xs.length, Math.max(1, rank)) - 1]
}

/**
 * List prices in US dollars per million tokens. Cache writes with the
 * 5-minute TTL cost 1.25x input and with the 1-hour TTL 2x; cache reads
 * cost 0.1x. Thinking tokens are billed as output and are already inside
 * `output_tokens`. Add a row when the sign reader's model changes.
 */
export const PRICES_AS_OF = '2026-10'
export const PRICES_USD_PER_MTOK = {
  'claude-sonnet-4-6': { input: 3, output: 15, cache_write_5m: 3.75, cache_write_1h: 6, cache_read: 0.3 },
}

export function priceFor(model) {
  return (model && PRICES_USD_PER_MTOK[model]) || null
}

/**
 * Dollar cost of one response from its `usage` object. `input_tokens`
 * excludes cached tokens, which are counted separately as cache writes
 * (`cache_creation_input_tokens`, split by TTL in `cache_creation` when the
 * API returns the breakdown) and cache reads. Returns null without a price
 * or usage.
 */
export function costFromUsage(usage, price) {
  if (!usage || typeof usage !== 'object' || !price) return null
  const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0)
  let write5m = n(usage.cache_creation_input_tokens)
  let write1h = 0
  const breakdown = usage.cache_creation
  if (breakdown && typeof breakdown === 'object') {
    write5m = n(breakdown.ephemeral_5m_input_tokens)
    write1h = n(breakdown.ephemeral_1h_input_tokens)
  }
  const dollars =
    n(usage.input_tokens) * price.input +
    n(usage.output_tokens) * price.output +
    write5m * price.cache_write_5m +
    write1h * price.cache_write_1h +
    n(usage.cache_read_input_tokens) * price.cache_read
  return dollars / 1_000_000
}

/** Adds up the token counts of several responses (one scan can retry). */
export function sumUsage(usages) {
  const total = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
  }
  let any = false
  for (const u of usages) {
    if (!u || typeof u !== 'object') continue
    any = true
    const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0)
    total.input_tokens += n(u.input_tokens)
    total.output_tokens += n(u.output_tokens)
    total.cache_creation_input_tokens += n(u.cache_creation_input_tokens)
    total.cache_read_input_tokens += n(u.cache_read_input_tokens)
    const b = u.cache_creation
    if (b && typeof b === 'object') {
      total.cache_creation.ephemeral_5m_input_tokens += n(b.ephemeral_5m_input_tokens)
      total.cache_creation.ephemeral_1h_input_tokens += n(b.ephemeral_1h_input_tokens)
    } else {
      total.cache_creation.ephemeral_5m_input_tokens += n(u.cache_creation_input_tokens)
    }
  }
  return any ? total : null
}
