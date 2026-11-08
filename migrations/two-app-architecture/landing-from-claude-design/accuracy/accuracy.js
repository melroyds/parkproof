// Renders the accuracy page's results table from results.json, the file
// scripts/eval-accuracy.mjs writes with --json. Only a real run (not a dry
// run) of the held-out test split, made on committed code, is shown.
// Anything else, including a missing file, leaves the "no numbers yet"
// message in place.

export const RESULTS_SCHEMA = 'parkproof-accuracy-v1'

/**
 * The fewest test photos a rate over a labelled group (a sign detail, the
 * sign condition, the position question) may cover and still be shown.
 * The harness withholds smaller ones (scripts/eval-lib/report.mjs
 * MIN_SIGNS_PER_LABELLED_GROUP): they would say how single held-out photos
 * went.
 */
export const MIN_SIGNS_PER_LABELLED_GROUP = 5

/** True when a rate over a labelled group is shown although it covers too few photos. */
function pointsAtSinglePhotos(rate) {
  return (
    !!rate &&
    typeof rate === 'object' &&
    rate.rate !== null &&
    rate.rate !== undefined &&
    rate.signs > 0 &&
    rate.signs < MIN_SIGNS_PER_LABELLED_GROUP
  )
}

/**
 * The results when they are fit to publish, otherwise null. A run with
 * uncommitted changes (or none recorded) isn't, because the page names the
 * commit as the app version the numbers belong to. Nor is a file that says
 * which test photos were right or wrong (a row with its own results,
 * rates by tag, or a rate over a labelled group of fewer than
 * MIN_SIGNS_PER_LABELLED_GROUP photos), because the page says that isn't
 * published.
 */
export function publishableResults(data) {
  if (!data || typeof data !== 'object') return null
  if (data.schema !== RESULTS_SCHEMA) return null
  if (data.dry_run !== false) return null
  if (data.split !== 'test') return null
  if (!data.git || typeof data.git.sha !== 'string' || data.git.dirty !== false) return null
  if (data.by_tag != null) return null
  const hidden = (row) =>
    row && row.outcome_hidden === true && !('right' in row) && !('errors' in row) && !('failures' in row)
  if (!Array.isArray(data.signs) || !data.signs.every(hidden)) return null
  const answer = data.metrics && data.metrics.answer
  if (!answer || !(answer.signs > 0)) return null
  const m = data.metrics
  const grouped = [...Object.values(m.flags || {}), m.sign_status, m.position]
  if (grouped.some(pointsAtSinglePhotos)) return null
  return data
}

const DETAIL_NAMES = {
  requires_ticket: 'Payment needed now',
  payment_methods: 'Ways to pay',
  requires_disabled_permit: 'Accessible parking bay',
  is_permit_zone: 'Permit zone in force',
  permit_area: 'Permit area',
  is_area_sign: 'Area sign',
}

const pct = (x) => `${Math.round(x * 100)}%`

function signsText(rate, runs) {
  const signs = `${rate.signs} sign${rate.signs === 1 ? '' : 's'}`
  return runs > 1 ? `${signs}, ${rate.runs} reads` : signs
}

/**
 * The table rows: `{ measure, result, range, count }` as display text, in
 * page order. Measures with nothing to count are left out.
 */
export function resultRows(data) {
  const m = data.metrics
  const runs = data.runs || 1
  const rows = []
  const add = (measure, rate) => {
    if (!rate || !(rate.signs > 0) || rate.rate === null) return
    rows.push({
      measure,
      result: pct(rate.rate),
      range: rate.ci95 ? `${pct(rate.ci95[0])} to ${pct(rate.ci95[1])}` : '',
      count: signsText(rate, runs),
    })
  }
  add('Answer right', m.answer)
  add("Said you can park when you can't", m.false_park)
  add("Said you can't park when you can", m.false_no_park)
  add('Leave-by time right', m.until)
  add('Leave-by time later than the label', m.until_late)
  add('Minutes left right', m.duration)
  for (const key of Object.keys(DETAIL_NAMES)) add(`Sign detail: ${DETAIL_NAMES[key]}`, m.flags && m.flags[key])
  add('Sign condition right', m.sign_status)
  add("Asked where you're parked, with the right spot offered", m.position)
  add('Answer right when the model says high confidence', m.by_confidence && m.by_confidence.high)
  add('Answer right when the model says medium confidence', m.by_confidence && m.by_confidence.medium)
  add('Answer right when the model says low confidence', m.by_confidence && m.by_confidence.low)
  return rows
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

/** The lines under the table: what was run, speed and cost. */
export function resultFacts(data) {
  const facts = []
  const runs = data.runs || 1
  const signs = data.corpus && data.corpus.signs
  facts.push(
    `Held-out test set of ${signs} labelled sign${signs === 1 ? '' : 's'}, ${runs === 1 ? 'each read once' : `each read ${runs} times`}.`,
  )
  const when = Date.parse(data.generated_at)
  const date = Number.isFinite(when)
    ? new Date(when).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Melbourne' })
    : null
  const tags = Object.entries((data.corpus && data.corpus.tags) || {})
    .filter(([, n]) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  if (tags.length) facts.push(`What the test set covers, by tag: ${tags.map(([tag, n]) => `${tag} ${n}`).join(', ')}.`)
  const fp = data.fingerprint || {}
  facts.push(
    `Model ${data.model || 'unknown'}, prompt fingerprint ${(fp.prompt_sha256 || 'unknown').slice(0, 12)}${fp.user_prompt_sha256 ? ` and ${fp.user_prompt_sha256.slice(0, 12)}` : ''}, app version ${((data.git && data.git.sha) || 'unknown').slice(0, 12)}${date ? `, run on ${date}` : ''}.`,
  )
  const latency = data.metrics.latency_ms
  if (latency && Number.isFinite(latency.p50) && Number.isFinite(latency.p90)) {
    facts.push(`Time per read: ${seconds(latency.p50)} for half of reads (p50), ${seconds(latency.p90)} for 90% of reads (p90), measured on the test machine.`)
  }
  const cost = data.metrics.cost_usd
  if (cost && Number.isFinite(cost.per_read)) {
    facts.push(`Model cost: about US$${cost.per_read.toFixed(3)} per read, at list prices.`)
  }
  return facts
}

function cell(doc, tag, text, className) {
  const el = doc.createElement(tag)
  el.textContent = text
  if (className) el.className = className
  return el
}

/** Fills `root` with the results table and facts. Text only, never HTML from the file. */
export function renderResults(doc, root, data) {
  root.textContent = ''
  const wrap = doc.createElement('div')
  wrap.className = 'acc-table-wrap'
  const table = doc.createElement('table')
  table.className = 'acc-table'
  const caption = cell(doc, 'caption', 'Results on the held-out test set')
  table.appendChild(caption)
  const head = doc.createElement('thead')
  const headRow = doc.createElement('tr')
  for (const h of ['Measure', 'Result', '95% range']) {
    const th = cell(doc, 'th', h)
    th.scope = 'col'
    headRow.appendChild(th)
  }
  head.appendChild(headRow)
  table.appendChild(head)
  const body = doc.createElement('tbody')
  for (const row of resultRows(data)) {
    const tr = doc.createElement('tr')
    // What each rate is counted over sits under its name, so the range
    // stays on screen at phone width.
    const th = doc.createElement('th')
    th.scope = 'row'
    th.appendChild(cell(doc, 'span', row.measure, 'acc-measure'))
    th.appendChild(cell(doc, 'span', row.count, 'acc-count'))
    tr.appendChild(th)
    tr.appendChild(cell(doc, 'td', row.result, 'acc-num'))
    tr.appendChild(cell(doc, 'td', row.range))
    body.appendChild(tr)
  }
  table.appendChild(body)
  wrap.appendChild(table)
  root.appendChild(wrap)
  const list = doc.createElement('ul')
  list.className = 'acc-facts'
  for (const fact of resultFacts(data)) list.appendChild(cell(doc, 'li', fact))
  root.appendChild(list)
}

/**
 * Loads results.json next to the page. Shows the table when the file holds
 * publishable results, otherwise the "no numbers yet" message. A missing
 * file, or a page served in its place, counts as no results. The page's
 * HTML already shows the right message without JavaScript (see
 * scripts/eval-lib/accuracy-page.test.mjs), so this only swaps in the table.
 */
export async function init({ doc = document, fetchImpl = globalThis.fetch, url = 'results.json' } = {}) {
  const root = doc.getElementById('accuracy-results')
  const empty = doc.getElementById('accuracy-empty')
  let data = null
  try {
    const res = await fetchImpl(url, { cache: 'no-store' })
    if (res && res.ok) data = publishableResults(await res.json())
  } catch {
    data = null
  }
  if (data && root) {
    renderResults(doc, root, data)
    root.hidden = false
    if (empty) empty.hidden = true
    return true
  }
  if (root) root.hidden = true
  if (empty) empty.hidden = false
  return false
}
