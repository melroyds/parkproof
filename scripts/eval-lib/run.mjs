// Running the corpus through the sign reader. The reader itself is
// injected (`translate`), so tests and --dry-run need no network: the CLI
// passes lambda/index.js translateSign with a model client that either
// records each real call or answers from the labels.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import { parseArgs } from 'node:util'
import { canonicalize } from '../../lambda/addendum-schema.js'
import { scoreTrial } from './score.mjs'
import { sumUsage } from './stats.mjs'

export const MAX_RUNS = 20
export const SPLIT_CHOICES = ['dev', 'test', 'all']

export const USAGE = `Usage: npm run eval -- [options]

  --split dev|test|all   which labelled photos to run (default dev)
  --runs N               run each photo N times, 1 to ${MAX_RUNS} (default 1)
  --json FILE            also write the results as JSON to FILE
  --dry-run              no model calls: answers come from the labels
  --corpus DIR           labelled photos (default eval/corpus)
  --show-failures        list failures for the test split too
  --verbose              keep the sign reader's own log lines
  --help                 show this help
`

/** Parses CLI arguments. Throws an Error with a readable message on bad input. */
export function parseCliArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    allowPositionals: false,
    options: {
      split: { type: 'string', default: 'dev' },
      runs: { type: 'string', default: '1' },
      json: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      corpus: { type: 'string' },
      'show-failures': { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  if (!SPLIT_CHOICES.includes(values.split)) throw new Error(`--split must be one of ${SPLIT_CHOICES.join(', ')}`)
  if (!/^\d+$/.test(values.runs) || Number(values.runs) < 1 || Number(values.runs) > MAX_RUNS) {
    throw new Error(`--runs must be a whole number from 1 to ${MAX_RUNS}`)
  }
  return {
    split: values.split,
    runs: Number(values.runs),
    json: values.json ?? null,
    dryRun: values['dry-run'],
    corpus: values.corpus ?? null,
    showFailures: values['show-failures'],
    verbose: values.verbose,
    help: values.help,
  }
}

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

/**
 * The instruction text of a request's user turn, with the per-photo values
 * (the scan's time zone and time, in `call.context`) swapped for
 * placeholders, so every photo's request gives the same template. The
 * photo itself is not part of it.
 */
export function userPromptTemplate(call) {
  const content = call?.params?.messages?.[0]?.content
  const blocks = Array.isArray(content) ? content : [{ type: 'text', text: String(content ?? '') }]
  let text = blocks
    .filter((b) => b?.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n')
  const { now, timezone } = call?.context ?? {}
  if (now) text = text.split(now).join('{{now}}')
  if (timezone) text = text.split(timezone).join('{{timezone}}')
  return text
}

/**
 * What produced a run, read from the requests the sign reader actually
 * sent: the model, a hash of the system prompt, a hash of the instruction
 * text in the user turn (as a template, see userPromptTemplate), a hash of
 * the response schema, and the thinking and effort settings. Null without
 * a call. Should the template differ between photos, the hash covers every
 * distinct template, sorted.
 */
export function fingerprintFromCalls(calls) {
  const withParams = calls.filter((c) => c?.params)
  const first = withParams[0]
  if (!first) return null
  const p = first.params
  const system = Array.isArray(p.system)
    ? p.system.map((b) => (typeof b === 'string' ? b : (b?.text ?? ''))).join('\n')
    : String(p.system ?? '')
  const schema = p.output_config?.format?.schema
  const templates = [...new Set(withParams.map(userPromptTemplate))].sort()
  return {
    model: p.model ?? null,
    prompt_sha256: sha256Hex(system),
    user_prompt_sha256: sha256Hex(templates.join('\n\u0000\n')),
    schema_sha256: schema === undefined ? null : sha256Hex(canonicalize(schema)),
    max_tokens: p.max_tokens ?? null,
    thinking: p.thinking?.type ?? null,
    effort: p.output_config?.effort ?? null,
  }
}

/**
 * The `git status` arguments that say whether the tree differs from the
 * commit, leaving out the results file this run is about to write (an
 * earlier run's copy would otherwise mark every later run as uncommitted).
 * `root` is the repo root, `outputPath` the --json file or null.
 */
export function gitStatusArgs(root, outputPath) {
  const args = ['status', '--porcelain']
  if (!outputPath) return args
  const rel = relative(root, outputPath).split(sep).join('/')
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return args
  return [...args, '--', '.', `:(exclude)${rel}`]
}

/**
 * Wraps the real model client so every `messages.create` call is reported
 * to `sink` with its request and the response's model, usage and stop
 * reason. The response itself is passed through untouched.
 */
export function createRecordingWrapper(sink) {
  return (client) => ({
    messages: {
      create: async (params, ...rest) => {
        const call = { params, response: null }
        sink(call)
        const response = await client.messages.create(params, ...rest)
        call.response = { model: response?.model ?? null, usage: response?.usage ?? null, stop_reason: response?.stop_reason ?? null }
        return response
      },
    },
  })
}

/** The token counts every dry-run answer reports, so the cost maths still runs. */
export const DRY_RUN_USAGE = Object.freeze({
  input_tokens: 2400,
  output_tokens: 900,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
})

/**
 * A model answer in the response schema's shape built from a label: the
 * right answer, so a dry run of a well-formed corpus scores 100%. A label
 * that names a position gets a position question with that option and one
 * opposite decoy. It carries T3's required fields too (sign_status,
 * sign_issues, is_area_sign, permit_exception_type and
 * permit_exception_text, recurring_restrictions, with empty defaults when
 * the label doesn't state them), so it matches RESPONSE_SCHEMA, the
 * model's raw shape, and passes T3's output normaliser. The harness lists
 * no permits, so the exception is 'none' with no text (the normaliser
 * turns that into permit_exception []).
 */
export function answerFromLabel(entry) {
  const exp = entry.expected
  const flags = entry.expected_flags ?? {}
  const answer = {
    can_park_now: exp.can_park_now,
    until: exp.until ?? null,
    duration_minutes: exp.duration_minutes ?? null,
    requires_disabled_permit: flags.requires_disabled_permit ?? false,
    is_permit_zone: flags.is_permit_zone ?? false,
    permit_area: flags.permit_area ?? null,
    is_area_sign: flags.is_area_sign ?? false,
    permit_exception_type: 'none',
    permit_exception_text: '',
    next_transition: null,
  }
  const top = {
    sign_status: entry.expected_sign_status ?? 'readable',
    sign_issues: [],
    rules: 'Dry run: no sign was read.',
    observations: [{ scope: 'Whole sign', items: ['Dry run'] }],
    ...answer,
    confidence: 'high',
    requires_ticket: flags.requires_ticket ?? false,
    payment_methods: flags.payment_methods ?? null,
    recurring_restrictions: [],
    clarification: null,
  }
  if (entry.expected_variant) {
    const decoy = {
      ...answer,
      label: 'Dry run decoy',
      rules: 'Dry run decoy.',
      observations: [],
      can_park_now: !exp.can_park_now,
      until: null,
      duration_minutes: null,
    }
    top.clarification = {
      question: 'Where are you parked?',
      options: [{ ...answer, label: entry.expected_variant[0], rules: top.rules, observations: [] }, decoy],
    }
  }
  return top
}

/**
 * Stands in for the model client in --dry-run: answers every call from
 * the current label (`currentEntry()`), with fixed usage, and reports the
 * call to `sink` like the recording wrapper. No network.
 */
export function createDryRunWrapper(currentEntry, sink) {
  return () => ({
    messages: {
      create: async (params) => {
        const call = { params, response: null }
        sink(call)
        const entry = currentEntry()
        if (!entry) throw new Error('dry run: no label for this call')
        const response = {
          model: params?.model ?? null,
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(answerFromLabel(entry)) }],
          usage: { ...DRY_RUN_USAGE },
        }
        call.response = { model: response.model, usage: response.usage, stop_reason: response.stop_reason }
        return response
      },
    },
  })
}

/** Reads an entry's photo as base64. */
export function readImageBase64(entry) {
  return readFileSync(entry.image_path).toString('base64')
}

/**
 * Runs every entry `runs` times through `translate(entry, imageBase64)`, in
 * order, one call at a time. `takeCalls()` returns (and clears) the model
 * calls recorded since it was last asked, so each run gets its own usage.
 * Each call is given `context: { timezone, now }` from its entry, for the
 * fingerprint's user-turn template. `onProgress(score, entry)` runs after
 * each read. Returns `{ trials, calls }`.
 */
export async function runEval({
  entries,
  runs = 1,
  translate,
  readImage = readImageBase64,
  takeCalls = () => [],
  clock = () => performance.now(),
  onProgress = () => {},
}) {
  const trials = []
  const allCalls = []
  for (const entry of entries) {
    let image = null
    let imageError = null
    try {
      image = readImage(entry)
    } catch (err) {
      imageError = `photo could not be read (${err?.message || err})`
    }
    for (let run = 1; run <= runs; run += 1) {
      takeCalls()
      let output = null
      let error = imageError
      const started = clock()
      if (!error) {
        try {
          output = await translate(entry, image)
        } catch (err) {
          error = String(err?.message || err)
        }
      }
      const latency = clock() - started
      const calls = takeCalls()
      for (const c of calls) c.context = { timezone: entry.timezone ?? null, now: entry.scanContext?.datetime ?? null }
      allCalls.push(...calls)
      const responses = calls.map((c) => c.response).filter(Boolean)
      const score = scoreTrial(entry, output, error)
      trials.push({
        id: entry.id,
        split: entry.split,
        tags: entry.tags,
        run,
        has_variant_label: !!entry.expected_variant,
        latency_ms: error ? null : Math.round(latency),
        usage: sumUsage(responses.map((r) => r.usage)),
        response_model: responses.find((r) => r.model)?.model ?? null,
        model_calls: calls.length,
        score,
      })
      onProgress(score, entry)
    }
  }
  return { trials, calls: allCalls }
}
