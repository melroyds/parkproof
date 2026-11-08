// @vitest-environment happy-dom
//
// The public accuracy page (spec T9 items 3 and 4): it renders a table only
// from a real run of the held-out test split, says plainly that there are
// no numbers yet otherwise, is in the sitemap with a trailing slash and is
// linked from the landing footer only. The results it reads are the ones
// the harness writes, so the two are tested together here.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  init,
  publishableResults,
  resultFacts,
  resultRows,
} from '../../migrations/two-app-architecture/landing-from-claude-design/accuracy/accuracy.js'
import { normalizeEntry } from './corpus.mjs'
import { buildResults, buildResultsFile } from './report.mjs'
import { scoreTrial } from './score.mjs'
import { PRICES_USD_PER_MTOK } from './stats.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LANDING = join(ROOT, 'migrations', 'two-app-architecture', 'landing-from-claude-design')
const PAGE_HTML = readFileSync(join(LANDING, 'accuracy', 'index.html'), 'utf8')

function entry(id, split, expected, tags = []) {
  return normalizeEntry(
    {
      id,
      image: `${id}.jpg`,
      split,
      tags,
      scanContext: { lat: -37.8136, lng: 144.9631, datetime: '2026-05-20T14:30:00+10:00' },
      expected,
    },
    `${id}.json`,
  ).entry
}

/**
 * Results as the harness writes them to the --json file for a run of the
 * test split. `build: buildResults` gives the in-memory results the text
 * report is printed from instead.
 */
function harnessResults({
  dryRun = false,
  split = 'test',
  git = { sha: '12d93185cb355c1231b087284679afd23b3c45a5', dirty: false },
  showFailures = false,
  build = buildResultsFile,
} = {}) {
  const can = entry('can', 'test', { can_park_now: true, until: '2026-05-20T16:00:00+10:00' }, ['clearway', 'vic'])
  const cannot = entry('cannot', 'test', { can_park_now: false, until: null }, ['vic'])
  const out = (can_park_now, until) => ({ can_park_now, until, duration_minutes: null, confidence: 'high', clarification: null })
  const trial = (e, output, latency) => ({
    id: e.id,
    tags: e.tags,
    has_variant_label: false,
    latency_ms: latency,
    usage: { input_tokens: 2000, output_tokens: 1000 },
    score: scoreTrial(e, output, null),
  })
  const trials = [
    trial(can, out(true, '2026-05-20T16:00:00+10:00'), 6200),
    trial(cannot, out(true, '2026-05-20T16:00:00+10:00'), 11000),
  ]
  return build({
    entries: [can, cannot],
    trials,
    meta: {
      split,
      runs: 1,
      dryRun,
      git,
      fingerprint: { model: 'claude-sonnet-4-6', prompt_sha256: 'ab'.repeat(32), schema_sha256: 'cd'.repeat(32) },
      price: PRICES_USD_PER_MTOK['claude-sonnet-4-6'],
      generatedAt: '2026-11-08T01:00:00.000Z',
      showFailures,
    },
  })
}

function pageDocument() {
  const doc = document.implementation.createHTMLDocument('accuracy')
  doc.body.innerHTML = PAGE_HTML.slice(PAGE_HTML.indexOf('<main'), PAGE_HTML.indexOf('</main>') + 7)
  return doc
}

const respond = (body, { ok = true } = {}) => async () => ({ ok, json: async () => (typeof body === 'string' ? JSON.parse(body) : body) })

describe('which results are published', () => {
  it('a real run of the test split is published', () => {
    expect(publishableResults(harnessResults())).not.toBeNull()
  })

  it('a dry run, the dev split or another file is not', () => {
    expect(publishableResults(harnessResults({ dryRun: true }))).toBeNull()
    expect(publishableResults(harnessResults({ split: 'dev' }))).toBeNull()
    expect(publishableResults(harnessResults({ split: 'all' }))).toBeNull()
    expect(publishableResults({ ...harnessResults(), schema: 'something-else' })).toBeNull()
    expect(publishableResults(null)).toBeNull()
  })

  it('a run with uncommitted changes is not: the page names the commit as the app version', () => {
    const sha = '12d93185cb355c1231b087284679afd23b3c45a5'
    expect(publishableResults(harnessResults({ git: { sha, dirty: true } }))).toBeNull()
    expect(publishableResults(harnessResults({ git: { sha, dirty: null } }))).toBeNull()
    expect(publishableResults(harnessResults({ git: { sha: null, dirty: null } }))).toBeNull()
    expect(publishableResults(harnessResults({ git: { sha, dirty: false } }))).not.toBeNull()
  })

  it('the file written with --show-failures still names no test photo, so it is still published', () => {
    const file = harnessResults({ showFailures: true })
    expect(file.signs).toEqual([
      { id: 'can', split: 'test', tags: ['clearway', 'vic'], runs: 1, outcome_hidden: true },
      { id: 'cannot', split: 'test', tags: ['vic'], runs: 1, outcome_hidden: true },
    ])
    expect(file.by_tag).toBeNull()
    expect(JSON.stringify(file)).not.toMatch(/can_park_now|failures/)
    expect(publishableResults(file)).not.toBeNull()
  })

  it('results that say which test photos were right or wrong are not published', () => {
    // What the text report is built from with --show-failures: each test
    // photo's own result and the rates by tag. The page says that isn't
    // published, so it refuses such a file however it was made.
    const shown = harnessResults({ showFailures: true, build: buildResults })
    expect(shown.signs.find((s) => s.id === 'cannot').failures.length).toBeGreaterThan(0)
    expect(publishableResults(shown)).toBeNull()
    expect(publishableResults({ ...harnessResults(), by_tag: shown.by_tag })).toBeNull()
    const oneRowShown = harnessResults()
    oneRowShown.signs = [oneRowShown.signs[0], shown.signs[1]]
    expect(publishableResults(oneRowShown)).toBeNull()
    expect(publishableResults({ ...harnessResults(), signs: [{ ...harnessResults().signs[0], right: 1 }] })).toBeNull()
    expect(publishableResults({ ...harnessResults(), signs: undefined })).toBeNull()
  })
})

describe('the results table', () => {
  it('shows the harness numbers with their ranges, false park apart from false no-park', () => {
    const rows = resultRows(harnessResults())
    const byName = Object.fromEntries(rows.map((r) => [r.measure, r]))
    expect(byName['Answer right']).toMatchObject({ result: '50%', range: '9% to 91%', count: '2 signs' })
    expect(byName["Said you can park when you can't"]).toMatchObject({ result: '100%', count: '1 sign' })
    expect(byName["Said you can't park when you can"]).toMatchObject({ result: '0%', count: '1 sign' })
    // Leave-by is measured on the can-park sign only, and it was right, not late.
    expect(byName['Leave-by time right']).toMatchObject({ result: '100%', count: '1 sign' })
    expect(byName['Leave-by time later than the label']).toMatchObject({ result: '0%', count: '1 sign' })
    // Nothing labelled, nothing shown: no minutes, no sign details.
    expect(rows.some((r) => r.measure.startsWith('Sign detail'))).toBe(false)
    expect(rows.some((r) => r.measure === 'Minutes left right')).toBe(false)
  })

  it('states what was run, the time per read and the cost', () => {
    const facts = resultFacts(harnessResults()).join('\n')
    expect(facts).toMatch(/Held-out test set of 2 labelled signs, each read once\./)
    expect(facts).toMatch(/What the test set covers, by tag: vic 2, clearway 1\./)
    expect(facts).toMatch(/Model claude-sonnet-4-6, prompt fingerprint abababababab, app version 12d93185cb35, run on 8 November 2026\./)
    const withUserTurn = harnessResults()
    withUserTurn.fingerprint = { ...withUserTurn.fingerprint, user_prompt_sha256: 'ef'.repeat(32) }
    expect(resultFacts(withUserTurn).join('\n')).toMatch(/prompt fingerprint abababababab and efefefefefef, app version/)
    expect(facts).toMatch(/6\.2 s for half of reads \(p50\), 11\.0 s for 90% of reads \(p90\)/)
    expect(facts).toMatch(/about US\$0\.021 per read/)
  })
})

describe('init', () => {
  it('renders the table and hides the empty message when results exist', async () => {
    const doc = pageDocument()
    expect(await init({ doc, fetchImpl: respond(harnessResults()) })).toBe(true)
    const root = doc.getElementById('accuracy-results')
    expect(root.hidden).toBe(false)
    expect(doc.getElementById('accuracy-empty').hidden).toBe(true)
    expect(root.querySelector('caption').textContent).toBe('Results on the held-out test set')
    expect(root.querySelectorAll('tbody tr').length).toBe(resultRows(harnessResults()).length)
    const first = root.querySelector('tbody tr')
    expect(first.querySelector('th .acc-measure').textContent).toBe('Answer right')
    expect(first.querySelector('th .acc-count').textContent).toBe('2 signs')
    expect([...first.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['50%', '9% to 91%'])
    expect([...root.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Measure', 'Result', '95% range'])
  })

  it.each([
    ['no results file', respond({}, { ok: false })],
    ['a page served in place of the file', async () => ({ ok: true, json: async () => JSON.parse('<!doctype html>') })],
    ['a network failure', async () => { throw new Error('offline') }],
    ['dry-run results', respond(harnessResults({ dryRun: true }))],
  ])('with %s, says plainly there are no numbers yet', async (_name, fetchImpl) => {
    const doc = pageDocument()
    expect(await init({ doc, fetchImpl })).toBe(false)
    const empty = doc.getElementById('accuracy-empty')
    expect(empty.hidden).toBe(false)
    expect(empty.textContent).toMatch(/first numbers will appear here once a held-out set of signs has been labelled/)
    expect(doc.getElementById('accuracy-results').hidden).toBe(true)
  })

  it('never puts HTML from the results file into the page', async () => {
    const doc = pageDocument()
    const results = harnessResults()
    results.model = '<img src=x onerror=alert(1)>'
    await init({ doc, fetchImpl: respond(results) })
    expect(doc.getElementById('accuracy-results').querySelector('img')).toBeNull()
    expect(doc.getElementById('accuracy-results').textContent).toContain('<img src=x')
  })
})

describe('the page, the sitemap and the links', () => {
  it('uses the landing styles, loads the renderer and has no em-dashes', () => {
    expect(PAGE_HTML).toContain('href="../landing-styles.css"')
    expect(PAGE_HTML).toMatch(/<script type="module">\s*import \{ init \} from '\.\/accuracy\.js'/)
    expect(PAGE_HTML).toContain('<link rel="canonical" href="https://www.parkproof.com.au/accuracy/">')
    const js = readFileSync(join(LANDING, 'accuracy', 'accuracy.js'), 'utf8')
    const emDash = String.fromCharCode(0x2014)
    expect(PAGE_HTML).not.toContain(emDash)
    expect(js).not.toContain(emDash)
  })

  it('is in the sitemap with a trailing slash', () => {
    const sitemap = readFileSync(join(LANDING, 'sitemap.xml'), 'utf8')
    expect(sitemap).toContain('<loc>https://www.parkproof.com.au/accuracy/</loc>')
  })

  it('is linked from the landing footer and nowhere else on the landing', () => {
    const landing = readFileSync(join(LANDING, 'index.html'), 'utf8')
    const links = landing.match(/href="\/accuracy\/"/g) ?? []
    expect(links).toHaveLength(1)
    const footer = landing.slice(landing.indexOf('<footer'), landing.indexOf('</footer>'))
    expect(footer).toContain('<a href="/accuracy/">Accuracy</a>')
  })

  function publishedResults() {
    try {
      return publishableResults(JSON.parse(readFileSync(join(LANDING, 'accuracy', 'results.json'), 'utf8')))
    } catch {
      return null
    }
  }

  it('links from the app, in every locale, only once published test results exist', () => {
    // Spec T9 item 4: result.aiCaveat and landing.accuracyNote link to the
    // page only once a results file with test-split numbers exists. Until
    // then the landing footer is the only way in.
    const published = publishedResults() !== null
    const files = readdirSync(join(ROOT, 'src', 'locales')).filter((f) => f.endsWith('.json'))
    expect(files).toHaveLength(9)
    for (const file of files) {
      const strings = JSON.parse(readFileSync(join(ROOT, 'src', 'locales', file), 'utf8'))
      const linkedInApp = /accuracy\//i.test(strings.result.aiCaveat) || /accuracy\//i.test(strings.landing.accuracyNote)
      expect({ file, linkedInApp }).toEqual({ file, linkedInApp: published })
    }
  })

  it('without JavaScript the page still says plainly whether there are numbers yet', () => {
    // The "no numbers yet" card is visible in the HTML itself until results
    // are published, then hidden (the script swaps in the table).
    const card = PAGE_HTML.match(/<div id="accuracy-empty"[^>]*>/)?.[0]
    expect(card).toBeTruthy()
    expect(/\shidden(\s|>|=)/.test(card)).toBe(publishedResults() !== null)
    expect(PAGE_HTML).not.toContain('Loading results')
  })
})
