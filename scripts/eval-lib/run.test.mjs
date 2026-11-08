// @vitest-environment node
//
// Running the corpus with no network (spec T9 item 1): an injected reader,
// the recording and dry-run model clients around the real translateSign,
// the request fingerprint, CLI arguments, and the CLI end to end in
// --dry-run.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setSignClientWrapper, translateSign } from '../../lambda/index.js'
import { normalizeEntry } from './corpus.mjs'
import {
  DRY_RUN_USAGE,
  answerFromLabel,
  createDryRunWrapper,
  createRecordingWrapper,
  fingerprintFromCalls,
  gitStatusArgs,
  parseCliArgs,
  runEval,
  userPromptTemplate,
} from './run.mjs'
import { scoreTrial } from './score.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function label(raw, file = 'x.json') {
  const { entry, errors } = normalizeEntry(
    {
      image: 'x.jpg',
      split: 'dev',
      scanContext: { lat: -37.8136, lng: 144.9631, datetime: '2026-05-20T14:30:00+10:00' },
      expected: { can_park_now: true, until: '2026-05-20T16:30:00+10:00', duration_minutes: 120 },
      ...raw,
    },
    file,
  )
  if (!entry) throw new Error(errors.join('; '))
  return entry
}

describe('runEval with an injected reader', () => {
  it('runs each sign N times, scores each run and keeps each run\'s own usage', async () => {
    const entries = [label({ id: 'a' }), label({ id: 'b', expected: { can_park_now: false, until: null } })]
    const pending = []
    let n = 0
    const translate = async (entry, image) => {
      expect(image).toBe(`bytes-of-${entry.id}`)
      n += 1
      pending.push({ response: { model: 'claude-sonnet-4-6', usage: { input_tokens: n, output_tokens: 1 } } })
      if (entry.id === 'b' && n === 4) throw new Error('ERR_SIGN_UNREADABLE')
      return { ...answerFromLabel(entry), confidence: 'medium' }
    }
    let t = 0
    const { trials } = await runEval({
      entries,
      runs: 2,
      translate,
      readImage: (e) => `bytes-of-${e.id}`,
      takeCalls: () => pending.splice(0),
      clock: () => (t += 250),
    })
    expect(trials.map((x) => `${x.id}#${x.run}`)).toEqual(['a#1', 'a#2', 'b#1', 'b#2'])
    expect(trials.map((x) => x.usage?.input_tokens ?? null)).toEqual([1, 2, 3, 4])
    expect(trials.map((x) => x.score.pass)).toEqual([true, true, true, false])
    expect(trials[3].score.error).toBe('ERR_SIGN_UNREADABLE')
    expect(trials[3].latency_ms).toBeNull()
    expect(trials[0].latency_ms).toBe(250)
    expect(trials[0].score.confidence).toBe('medium')
  })

  it('a photo that cannot be read is an error for every run, without calling the reader', async () => {
    let called = false
    const { trials } = await runEval({
      entries: [label({ id: 'gone' })],
      runs: 2,
      translate: async () => {
        called = true
      },
      readImage: () => {
        throw new Error('ENOENT')
      },
    })
    expect(called).toBe(false)
    expect(trials.map((x) => x.score.error)).toEqual(['photo could not be read (ENOENT)', 'photo could not be read (ENOENT)'])
  })
})

describe('the model clients around the real translateSign', () => {
  let savedKey
  beforeAll(() => {
    savedKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'test-key-never-sent'
  })
  afterAll(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = savedKey
  })
  afterEach(() => setSignClientWrapper(null))

  const call = (entry) =>
    translateSign({
      image_base64: 'AAAA',
      media_type: 'image/jpeg',
      lat: entry.scanContext.lat,
      lng: entry.scanContext.lng,
      current_datetime: entry.scanContext.datetime,
    })

  it('dry run: answers from the label with no network, and the answer scores as right', async () => {
    const entry = label({
      id: 'pos',
      expected_variant: ['Right side'],
      expected_sign_status: 'readable',
      expected_flags: { requires_ticket: true, payment_methods: ['meter'], is_permit_zone: true, permit_area: '25' },
    })
    const calls = []
    setSignClientWrapper(createDryRunWrapper(() => entry, (c) => calls.push(c)))
    const output = await call(entry)
    expect(scoreTrial(entry, output, null)).toMatchObject({ pass: true, variant: 'matched' })
    expect(Object.values(scoreTrial(entry, output, null).flags).every((f) => f.ok)).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].response.usage).toEqual(DRY_RUN_USAGE)
    // The request the app would send: the pinned time and the sign photo.
    const user = calls[0].params.messages[0].content
    expect(user[0]).toMatchObject({ type: 'image', source: { data: 'AAAA' } })
    expect(user[1].text).toContain('2026-05-20T14:30:00+10:00')
  })

  it('records the request and usage of the real client and passes its answer through', async () => {
    const entry = label({ id: 'rec' })
    const response = {
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(answerFromLabel(entry)) }],
      usage: { input_tokens: 2100, output_tokens: 700, cache_read_input_tokens: 0 },
    }
    const fakeSdkClient = { messages: { create: async () => response } }
    const calls = []
    const wrap = createRecordingWrapper((c) => calls.push(c))
    // The wrapper gets the client translateSign built; stand in for the SDK's.
    setSignClientWrapper(() => wrap(fakeSdkClient))
    const output = await call(entry)
    expect(output.can_park_now).toBe(true)
    expect(calls[0].response).toEqual({ model: 'claude-sonnet-4-6', usage: response.usage, stop_reason: 'end_turn' })

    const fp = fingerprintFromCalls(calls)
    const system = calls[0].params.system.map((b) => b.text).join('\n')
    expect(fp).toMatchObject({ model: 'claude-sonnet-4-6', thinking: 'adaptive', effort: 'low', max_tokens: calls[0].params.max_tokens })
    expect(fp.prompt_sha256).toBe(createHash('sha256').update(system, 'utf8').digest('hex'))
    expect(fp.schema_sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('the user-turn hash is the same for every photo, whatever its zone and time, and changes with the instructions', async () => {
    const melbourne = label({ id: 'mel' })
    const perth = label({ id: 'per', scanContext: { lat: -31.9523, lng: 115.8613, datetime: '2026-05-20T12:30:00+08:00' } })
    expect(perth.timezone).toBe('Australia/Perth')
    const pending = []
    let current = null
    setSignClientWrapper(createDryRunWrapper(() => current, (c) => pending.push(c)))
    const { calls } = await runEval({
      entries: [melbourne, perth],
      translate: async (entry) => {
        current = entry
        return call(entry)
      },
      readImage: () => 'AAAA',
      takeCalls: () => pending.splice(0),
    })
    expect(calls.map((c) => c.context)).toEqual([
      { timezone: 'Australia/Melbourne', now: '2026-05-20T14:30:00+10:00' },
      { timezone: 'Australia/Perth', now: '2026-05-20T12:30:00+08:00' },
    ])
    const both = fingerprintFromCalls(calls)
    expect(both.user_prompt_sha256).toBe(fingerprintFromCalls([calls[0]]).user_prompt_sha256)
    expect(both.user_prompt_sha256).toBe(fingerprintFromCalls([calls[1]]).user_prompt_sha256)
    // The template keeps the instructions and swaps the per-photo values.
    const template = userPromptTemplate(calls[1])
    expect(template).toContain("User's timezone: {{timezone}} (IANA).")
    expect(template).toContain("Current local time at the user's location: {{now}}")
    expect(template).toContain('Read this parking sign')

    const edited = {
      ...calls[0],
      params: {
        ...calls[0].params,
        messages: [{ role: 'user', content: [calls[0].params.messages[0].content[0], { type: 'text', text: 'Different instructions.' }] }],
      },
    }
    const changed = fingerprintFromCalls([edited])
    expect(changed.user_prompt_sha256).not.toBe(both.user_prompt_sha256)
    expect(changed.prompt_sha256).toBe(both.prompt_sha256)
  })

  it('the fingerprint changes when the prompt changes', () => {
    const base = { model: 'm', system: [{ type: 'text', text: 'prompt A' }], output_config: { format: { schema: { b: 1, a: 2 } } } }
    const a = fingerprintFromCalls([{ params: base }])
    const b = fingerprintFromCalls([{ params: { ...base, system: [{ type: 'text', text: 'prompt B' }] } }])
    const sameSchemaReordered = fingerprintFromCalls([{ params: { ...base, output_config: { format: { schema: { a: 2, b: 1 } } } } }])
    expect(a.prompt_sha256).not.toBe(b.prompt_sha256)
    expect(a.schema_sha256).toBe(b.schema_sha256)
    expect(sameSchemaReordered.schema_sha256).toBe(a.schema_sha256)
    expect(fingerprintFromCalls([])).toBeNull()
  })
})

describe('answerFromLabel', () => {
  it('carries the fields T3 makes required, with empty defaults, top level and per option', () => {
    const plain = answerFromLabel(label({ id: 'plain' }))
    expect(plain).toMatchObject({
      sign_status: 'readable',
      sign_issues: [],
      is_area_sign: false,
      permit_exception: { applies: false, permit_type: null, text: '' },
      recurring_restrictions: [],
    })
    const stated = answerFromLabel(
      label({ id: 'stated', expected_sign_status: 'partially_obscured', expected_variant: 'Left side', expected_flags: { is_area_sign: true } }),
    )
    expect(stated).toMatchObject({ sign_status: 'partially_obscured', is_area_sign: true })
    for (const option of stated.clarification.options) {
      expect(option).toMatchObject({ is_area_sign: true, permit_exception: { applies: false, permit_type: null, text: '' } })
    }
  })
})

describe('gitStatusArgs', () => {
  const root = join(tmpdir(), 'repo')
  it('leaves the results file being written out of the uncommitted-changes check', () => {
    expect(gitStatusArgs(root, join(root, 'migrations', 'accuracy', 'results.json'))).toEqual([
      'status',
      '--porcelain',
      '--',
      '.',
      ':(exclude)migrations/accuracy/results.json',
    ])
  })
  it('checks the whole tree when there is no results file, or it is outside the repo', () => {
    expect(gitStatusArgs(root, null)).toEqual(['status', '--porcelain'])
    expect(gitStatusArgs(root, join(tmpdir(), 'elsewhere.json'))).toEqual(['status', '--porcelain'])
  })
})

describe('parseCliArgs', () => {
  it('defaults to one run of the dev split', () => {
    expect(parseCliArgs([])).toMatchObject({ split: 'dev', runs: 1, json: null, dryRun: false, showFailures: false })
  })

  it('reads every option', () => {
    expect(parseCliArgs(['--split', 'test', '--runs', '3', '--json', 'out.json', '--dry-run', '--show-failures'])).toMatchObject({
      split: 'test',
      runs: 3,
      json: 'out.json',
      dryRun: true,
      showFailures: true,
    })
  })

  it.each([
    [['--split', 'train'], /--split must be one of dev, test, all/],
    [['--runs', '0'], /--runs must be a whole number from 1 to 20/],
    [['--runs', '2.5'], /--runs must be a whole number/],
    [['--runs', '21'], /--runs must be a whole number/],
    [['--bogus'], /Unknown option/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrow(message)
  })
})

describe('the CLI in --dry-run', () => {
  const run = promisify(execFile)
  const dirs = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  async function cli(files, args) {
    const dir = mkdtempSync(join(tmpdir(), 'pp-eval-cli-'))
    dirs.push(dir)
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
    try {
      const { stdout } = await run(process.execPath, [join(ROOT, 'scripts', 'eval-accuracy.mjs'), '--dry-run', '--corpus', dir, ...args], {
        cwd: ROOT,
      })
      return { code: 0, stdout }
    } catch (err) {
      return { code: err.code, stdout: err.stdout, stderr: err.stderr }
    }
  }

  const sign = (id, split, extra = {}) =>
    JSON.stringify({
      format: 2,
      id,
      image: `${id}.jpg`,
      split,
      scanContext: { lat: -37.8136, lng: 144.9631, datetime: '2026-05-20T14:30:00+10:00' },
      expected: { can_park_now: true, until: '2026-05-20T16:30:00+10:00', duration_minutes: 120 },
      ...extra,
    })

  it('runs the chosen split, writes the JSON and exits 0', async () => {
    const out = join(tmpdir(), `pp-eval-${process.pid}-${Date.now()}.json`)
    const res = await cli(
      { 'a.json': sign('a', 'dev'), 'a.jpg': 'x', 'b.json': sign('b', 'test', { tags: ['clearway'] }), 'b.jpg': 'y' },
      ['--split', 'test', '--runs', '2', '--json', out],
    )
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('DRY RUN')
    const results = JSON.parse(readFileSync(out, 'utf8'))
    rmSync(out, { force: true })
    expect(results).toMatchObject({ schema: 'parkproof-accuracy-v1', dry_run: true, split: 'test', runs: 2, model: 'claude-sonnet-4-6' })
    expect(results.corpus).toMatchObject({ signs: 1, by_split: { dev: 0, test: 1 }, tags: { clearway: 1 } })
    expect(results.metrics.answer).toMatchObject({ signs: 1, runs: 2, rate: 1 })
    expect(results.fingerprint.prompt_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(results.fingerprint.user_prompt_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(results.git).toHaveProperty('sha')
    // Which held-out photo was right or wrong stays out of the results, the
    // rates by tag and the progress line by default.
    expect(results.signs).toEqual([{ id: 'b', split: 'test', tags: ['clearway'], runs: 2, outcome_hidden: true }])
    expect(results.by_tag).toBeNull()
    expect(res.stdout).toMatch(/^--$/m)
    expect(res.stdout).toMatch(/Which test photos were right or wrong is hidden/)
  }, 30_000)

  it('--show-failures shows each test photo\'s results; the dev split always does', async () => {
    const out = join(tmpdir(), `pp-eval-${process.pid}-${Date.now()}-shown.json`)
    const res = await cli(
      { 'a.json': sign('a', 'dev', { tags: ['arrows'] }), 'a.jpg': 'x', 'b.json': sign('b', 'test'), 'b.jpg': 'y' },
      ['--split', 'all', '--json', out],
    )
    const results = JSON.parse(readFileSync(out, 'utf8'))
    rmSync(out, { force: true })
    expect(res.code).toBe(0)
    // Dev photos show their result; the test photo doesn't, so no rates by tag either.
    expect(results.signs).toEqual([
      { id: 'a', split: 'dev', tags: ['arrows'], runs: 1, right: 1, errors: 0, failures: [] },
      { id: 'b', split: 'test', tags: [], runs: 1, outcome_hidden: true },
    ])
    expect(results.by_tag).toBeNull()
    expect(res.stdout).toMatch(/^\.-$/m)

    const shownOut = join(tmpdir(), `pp-eval-${process.pid}-${Date.now()}-shown-file.json`)
    const shown = await cli({ 'b.json': sign('b', 'test', { tags: ['clearway'] }), 'b.jpg': 'y' }, [
      '--split',
      'test',
      '--show-failures',
      '--json',
      shownOut,
    ])
    const shownFile = JSON.parse(readFileSync(shownOut, 'utf8'))
    rmSync(shownOut, { force: true })
    expect(shown.stdout).toMatch(/^\.$/m)
    expect(shown.stdout).not.toMatch(/is hidden/)
    // The file is what gets published, so it stays cut down even then.
    expect(shownFile.signs).toEqual([{ id: 'b', split: 'test', tags: ['clearway'], runs: 1, outcome_hidden: true }])
    expect(shownFile.by_tag).toBeNull()
    expect(shown.stdout).toMatch(/The file leaves out each test photo's own results/)
  }, 30_000)

  it('stops with exit 2 when the scan time has the wrong offset for the spot', async () => {
    const res = await cli(
      { 'a.json': sign('a', 'dev', { scanContext: { lat: -37.8136, lng: 144.9631, datetime: '2026-11-01T14:30:00+10:00' } }), 'a.jpg': 'x' },
      [],
    )
    expect(res.code).toBe(2)
    expect(res.stderr).toMatch(/isn't Australia\/Melbourne's offset at that moment \(\+11:00\)/)
  }, 30_000)

  it('stops with exit 2 when a label cannot be scored', async () => {
    const res = await cli({ 'a.json': sign('a', 'dev', { split: 'holdout' }), 'a.jpg': 'x' }, [])
    expect(res.code).toBe(2)
    expect(res.stderr).toMatch(/split must be "dev" or "test"/)
  }, 30_000)

  it('an empty corpus says how to add signs and exits 0, as before', async () => {
    const res = await cli({}, [])
    expect(res.code).toBe(0)
    expect(res.stdout).toMatch(/No labelled signs found/)
  }, 30_000)
})
