// The harness's outputs: the results object written with --json (and read
// by the public accuracy page), and the text report printed after a run.

import { summarize, summarizeByTag } from './score.mjs'
import { PRICES_AS_OF } from './stats.mjs'

export const RESULTS_SCHEMA = 'parkproof-accuracy-v1'

/**
 * True when a test photo's own results must stay hidden: always, unless
 * --show-failures. Which held-out photo failed is enough to tune a prompt
 * against, so neither the report, the progress line nor the JSON says.
 */
export function hidesOutcome(entry, showFailures) {
  return entry.split === 'test' && !showFailures
}

/**
 * The --json results. `meta` carries what produced the run: split, runs,
 * dry_run, git `{ sha, dirty }`, the request fingerprint, the price row and
 * the date. Test photos' own results (right and error counts, failure
 * text) and the rates by tag are left out unless `showFailures`, so the
 * published file can't point at the held-out photos that failed. Their
 * rows keep only the id, split, tags and number of reads.
 */
export function buildResults({ entries, trials, meta }) {
  const { split, runs, dryRun, git, fingerprint, price, generatedAt, showFailures } = meta
  const bySplit = { dev: 0, test: 0 }
  const tagCounts = {}
  for (const e of entries) {
    bySplit[e.split] += 1
    for (const tag of e.tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
  }
  const anyHidden = entries.some((e) => hidesOutcome(e, showFailures))
  const signs = entries.map((e) => {
    const own = trials.filter((t) => t.id === e.id)
    const row = { id: e.id, split: e.split, tags: e.tags, runs: own.length }
    if (hidesOutcome(e, showFailures)) return { ...row, outcome_hidden: true }
    return {
      ...row,
      right: own.filter((t) => t.score.pass).length,
      errors: own.filter((t) => t.score.error).length,
      failures: [...new Set(own.flatMap((t) => t.score.failures))],
    }
  })
  return {
    schema: RESULTS_SCHEMA,
    generated_at: generatedAt,
    dry_run: !!dryRun,
    split,
    runs,
    git: git ?? { sha: null, dirty: null },
    model: fingerprint?.model ?? null,
    fingerprint: fingerprint ?? null,
    pricing: price ? { usd_per_million_tokens: price, as_of: PRICES_AS_OF } : null,
    corpus: { signs: entries.length, by_split: bySplit, tags: tagCounts },
    metrics: summarize(trials, { runs, price }),
    // A tag with one or two test photos would name them, so rates by tag
    // are left out while test results are hidden.
    by_tag: anyHidden ? null : summarizeByTag(trials),
    signs,
  }
}

/**
 * The results as written to the --json file. A test photo's own results
 * never go in it, even with --show-failures: the file is what gets
 * published at /accuracy/results.json, and the page says which test photos
 * failed isn't published. --show-failures only changes what is printed.
 */
export function buildResultsFile({ entries, trials, meta }) {
  return buildResults({ entries, trials, meta: { ...meta, showFailures: false } })
}

const pct = (x) => (x === null || x === undefined ? 'n/a' : `${Math.round(x * 100)}%`)

function rateLine(label, rate, { unit = 'runs' } = {}) {
  if (!rate || !rate.signs) return `${label.padEnd(50)} not measured`
  const range = rate.ci95 ? `(95% range ${pct(rate.ci95[0])} to ${pct(rate.ci95[1])})` : ''
  const count = `${rate.run_successes}/${rate.runs} ${unit}, ${rate.signs} sign${rate.signs === 1 ? '' : 's'}`
  return `${label.padEnd(50)} ${pct(rate.rate).padStart(4)}  ${range.padEnd(28)} ${count}`
}

/** The text report printed after a run. */
export function formatReport(results, { showFailures = false } = {}) {
  const m = results.metrics
  const lines = []
  lines.push('')
  lines.push('=== ParkProof sign-reading accuracy ===')
  if (results.dry_run) lines.push('DRY RUN: answers came from the labels, no model was called. These are not accuracy numbers.')
  const fp = results.fingerprint
  lines.push(
    `split ${results.split} | ${results.corpus.signs} sign${results.corpus.signs === 1 ? '' : 's'} | ${results.runs} run${results.runs === 1 ? '' : 's'} each`,
  )
  lines.push(
    `model ${results.model ?? 'unknown'} | prompt ${fp?.prompt_sha256?.slice(0, 12) ?? 'n/a'} | user turn ${fp?.user_prompt_sha256?.slice(0, 12) ?? 'n/a'} | schema ${fp?.schema_sha256?.slice(0, 12) ?? 'n/a'} | git ${results.git.sha?.slice(0, 12) ?? 'unknown'}${results.git.dirty ? ' (uncommitted changes)' : ''}`,
  )
  lines.push('')
  lines.push(rateLine('Answer right (verdict and leave-by)', m.answer))
  lines.push(rateLine("Said you can park when you can't", m.false_park))
  lines.push(rateLine("Said you can't park when you can", m.false_no_park))
  lines.push(rateLine('Leave-by time right (can park, verdict right)', m.until))
  lines.push(rateLine('Leave-by time later than the label', m.until_late))
  lines.push(rateLine('Minutes right (can park, verdict right)', m.duration))
  for (const [key, rate] of Object.entries(m.flags)) lines.push(rateLine(`Sign detail: ${key}`, rate))
  if (m.sign_status) lines.push(rateLine('Sign condition right', m.sign_status))
  if (m.sign_status_not_returned) {
    lines.push(`${'Sign condition'.padEnd(50)} not scored in ${m.sign_status_not_returned} runs: the model doesn't return it yet`)
  }
  if (m.position.signs) lines.push(rateLine('Asked where you parked, offered the right spot', m.position))
  if (m.unexpected_position_question) lines.push(`Asked where you parked when the label names no position: ${m.unexpected_position_question} runs`)
  for (const level of ['high', 'medium', 'low']) {
    lines.push(rateLine(`Answer right when the model says ${level} confidence`, m.by_confidence[level]))
  }
  if (m.stability) {
    lines.push(
      `Across runs: ${m.stability.always_right} always right, ${m.stability.always_wrong} always wrong, ${m.stability.mixed} changed between runs`,
    )
  }
  lines.push(
    `Time per read: p50 ${m.latency_ms.p50 ?? 'n/a'} ms, p90 ${m.latency_ms.p90 ?? 'n/a'} ms (${m.latency_ms.reads} reads)`,
  )
  lines.push(
    m.cost_usd.per_read === null
      ? 'Cost: no price for this model, add it to PRICES_USD_PER_MTOK in scripts/eval-lib/stats.mjs'
      : `Cost: US$${m.cost_usd.per_read.toFixed(4)} per read, US$${m.cost_usd.total.toFixed(2)} in total (list prices as of ${results.pricing?.as_of})`,
  )
  lines.push(`Errors: ${m.errors}${m.unscorable ? `, position not offered: ${m.unscorable}` : ''}`)

  const failing = results.signs.filter((s) => s.failures && s.failures.length)
  const hidden = results.signs.some((s) => s.outcome_hidden)
  if (failing.length) {
    lines.push('')
    lines.push('Failures (the prompt worklist):')
    for (const s of failing) for (const f of s.failures) lines.push(`  - ${s.id}: ${f}`)
  }
  if (hidden && !showFailures) {
    lines.push('')
    lines.push(
      "Which test photos were right or wrong is hidden (here, in the progress line and in the JSON) so it can't steer prompt work. Use --show-failures to see it here. The JSON never has it.",
    )
  }
  return lines.join('\n')
}
