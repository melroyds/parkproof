#!/usr/bin/env node
// Accuracy harness for the sign reader.
//
// Runs every labelled photo in eval/corpus/ through the real translateSign
// (lambda/index.js, the code the app uses) with the time pinned to the
// labelled moment, and reports measured accuracy: answer right, false "you
// can park" separately from false "you can't", leave-by, minutes and sign
// details, accuracy by the model's confidence, p50/p90 time per read and
// cost from token usage. Rates carry 95% Wilson intervals counted per sign.
//
// Setup:
//   cd lambda && npm ci          # translateSign pulls the AWS SDK from lambda/
//   ANTHROPIC_API_KEY in .env    # real model calls, a few cents each
// Run:
//   npm run eval                              # dev split, one run each
//   npm run eval -- --split test --runs 3 --json results.json
//   npm run eval -- --dry-run                 # no model calls, checks labels and plumbing
//
// Labels, the dev/test split rule and the format: eval/README.md.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { filterSplit, loadCorpus } from './eval-lib/corpus.mjs'
import { buildResults, buildResultsFile, formatReport, hidesOutcome } from './eval-lib/report.mjs'
import {
  USAGE,
  createDryRunWrapper,
  createRecordingWrapper,
  fingerprintFromCalls,
  gitStatusArgs,
  parseCliArgs,
  runEval,
} from './eval-lib/run.mjs'
import { failingRunCount } from './eval-lib/score.mjs'
import { priceFor } from './eval-lib/stats.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let args
try {
  args = parseCliArgs(process.argv.slice(2))
} catch (err) {
  console.error(String(err?.message || err))
  console.error(USAGE)
  process.exit(2)
}
if (args.help) {
  console.log(USAGE)
  process.exit(0)
}

const corpusDir = args.corpus ? resolve(args.corpus) : join(ROOT, 'eval', 'corpus')
const corpus = loadCorpus(corpusDir)
for (const w of corpus.warnings) console.warn(`warning: ${w}`)
if (corpus.errors.length) {
  console.error('These labels need fixing before the eval can run:')
  for (const e of corpus.errors) console.error(`  - ${e}`)
  process.exit(2)
}
if (!corpus.entries.length) {
  console.log(
    'No labelled signs found in eval/corpus/.\n' +
      'Add <id>.jpg + <id>.json pairs (see eval/README.md), then re-run `npm run eval`.',
  )
  process.exit(0)
}
const entries = filterSplit(corpus.entries, args.split)
if (!entries.length) {
  console.log(`No labelled signs in the ${args.split} split (${corpus.entries.length} in the corpus).`)
  process.exit(0)
}
if (args.split !== 'dev' && !args.dryRun) {
  console.log('Running the held-out test split. Keep its results out of prompt work: report them, then leave the prompt alone.')
}

// Minimal .env load (ANTHROPIC_API_KEY), matching the dev proxy's approach.
const envPath = join(ROOT, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
if (args.dryRun) {
  // translateSign checks a key is configured; the dry-run client never sends it.
  if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = 'dry-run-no-network'
} else if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set (.env). The eval makes real Claude calls. Use --dry-run to check the labels without them.')
  process.exit(1)
}

const { translateSign, setSignClientWrapper } = await import('../lambda/index.js')

const recorded = []
let current = null
setSignClientWrapper(
  args.dryRun
    ? createDryRunWrapper(() => current, (call) => recorded.push(call))
    : createRecordingWrapper((call) => recorded.push(call)),
)

const quietLog = console.log
const { trials, calls } = await runEval({
  entries,
  runs: args.runs,
  takeCalls: () => recorded.splice(0),
  translate: async (entry, imageBase64) => {
    current = entry
    // The sign reader logs timings per call; keep the progress line clean.
    if (!args.verbose) console.log = () => {}
    try {
      return await translateSign({
        image_base64: imageBase64,
        media_type: entry.media_type,
        lat: entry.scanContext.lat,
        lng: entry.scanContext.lng,
        current_datetime: entry.scanContext.datetime, // honoured when not running inside Lambda
      })
    } finally {
      console.log = quietLog
      current = null
    }
  },
  // A test photo's own result stays hidden (see hidesOutcome): '-' for every read.
  onProgress: (score, entry) =>
    process.stdout.write(hidesOutcome(entry, args.showFailures) ? '-' : score.error ? 'x' : score.pass ? '.' : 'F'),
})
process.stdout.write('\n')
setSignClientWrapper(null)

const jsonPath = args.json ? resolve(args.json) : null

function gitInfo() {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
    const status = execFileSync('git', gitStatusArgs(ROOT, jsonPath), { cwd: ROOT, encoding: 'utf8' })
    return { sha, dirty: status.trim().length > 0 }
  } catch {
    return { sha: null, dirty: null }
  }
}

const git = gitInfo()
const fingerprint = fingerprintFromCalls(calls)
const meta = {
  split: args.split,
  runs: args.runs,
  dryRun: args.dryRun,
  git,
  fingerprint,
  price: priceFor(fingerprint?.model),
  generatedAt: new Date().toISOString(),
  showFailures: args.showFailures,
}
console.log(formatReport(buildResults({ entries, trials, meta }), { showFailures: args.showFailures }))

if (jsonPath) {
  // The file never says which test photos were right or wrong, even with
  // --show-failures, because it is what gets published (buildResultsFile).
  mkdirSync(dirname(jsonPath), { recursive: true })
  writeFileSync(jsonPath, JSON.stringify(buildResultsFile({ entries, trials, meta }), null, 2) + '\n', 'utf8')
  console.log(`\nResults written to ${jsonPath}`)
  if (args.showFailures && entries.some((e) => e.split === 'test')) {
    console.log("The file leaves out each test photo's own results, as always. --show-failures only changes what is printed.")
  }
  if (args.split === 'test' && !args.dryRun && git.dirty !== false) {
    // The page names the commit the numbers came from, so it only shows a
    // run of committed code (accuracy.js publishableResults).
    console.log(
      'The tree had uncommitted changes (or git could not say), so the accuracy page will not show these results. Commit, then run again.',
    )
  }
}

// Non-zero exit when any verdict was wrong or a run errored, so the harness
// works as a regression gate in CI once the corpus is populated.
process.exit(failingRunCount(trials) > 0 ? 1 : 0)
