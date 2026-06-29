#!/usr/bin/env node
// Accuracy eval harness for the sign translator.
//
// Runs every labelled sign in eval/corpus/ through the real translateSign and
// reports MEASURED accuracy + failure classes. This is the answer to the
// hiring-PM question "how do you know the AI is right?" that the in-app
// feedback telemetry can't give until there are real users: a fixed,
// ground-truthed corpus you can re-run after every prompt change.
//
// Setup:
//   cd lambda && npm ci         # translateSign pulls the AWS SDK from lambda/
//   ANTHROPIC_API_KEY in .env    # real Claude calls, ~$0.03-0.05 each
// Run:
//   npm run eval
//
// Corpus format — one pair per sign in eval/corpus/ (see eval/README.md):
//   <id>.jpg                     the sign photo
//   <id>.json                    { image, scanContext{lat,lng,datetime}, expected{can_park_now,until,duration_minutes,note} }

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CORPUS = join(ROOT, 'eval', 'corpus')
const UNTIL_TOLERANCE_MIN = 1

// Minimal .env load (ANTHROPIC_API_KEY), matching the dev proxy's approach.
const envPath = join(ROOT, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set (.env). The eval makes real Claude calls.')
  process.exit(1)
}

const { translateSign } = await import('../lambda/index.js')

const entries = existsSync(CORPUS)
  ? readdirSync(CORPUS)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(CORPUS, f), 'utf8')) }))
  : []

if (!entries.length) {
  console.log(
    'No labelled signs found in eval/corpus/.\n' +
      'Add <id>.jpg + <id>.json pairs (see eval/README.md), then re-run `npm run eval`.',
  )
  process.exit(0)
}

const mediaTypeFor = (name) => (name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg')
const results = []
for (const e of entries) {
  const imgPath = join(CORPUS, e.image)
  if (!existsSync(imgPath)) {
    console.warn(`skip ${e.id ?? e.file}: image "${e.image}" not found`)
    continue
  }
  const b64 = readFileSync(imgPath).toString('base64')
  const ctx = e.scanContext || {}
  let out, err
  try {
    out = await translateSign({
      image_base64: b64,
      media_type: mediaTypeFor(e.image),
      lat: ctx.lat,
      lng: ctx.lng,
      current_datetime: ctx.datetime, // honoured when not running inside Lambda
    })
  } catch (x) {
    err = String(x?.message || x)
  }
  results.push({ e, out, err })
  process.stdout.write(err ? 'x' : '.')
}
process.stdout.write('\n')

let pass = 0,
  verdictWrong = 0,
  untilWrong = 0,
  errored = 0
const fails = []
for (const { e, out, err } of results) {
  const exp = e.expected || {}
  if (err) {
    errored++
    fails.push(`${e.id}: ERROR ${err}`)
    continue
  }
  const verdictOk = out.can_park_now === exp.can_park_now
  let untilOk = true
  if (verdictOk && exp.until) {
    untilOk = out.until
      ? Math.abs(new Date(out.until) - new Date(exp.until)) <= UNTIL_TOLERANCE_MIN * 60000
      : false
  }
  if (verdictOk && untilOk) {
    pass++
  } else if (!verdictOk) {
    verdictWrong++
    fails.push(`${e.id}: verdict expected ${exp.can_park_now} got ${out.can_park_now}${exp.note ? `  — ${exp.note}` : ''}`)
  } else {
    untilWrong++
    fails.push(`${e.id}: leave-by expected ${exp.until} got ${out.until}`)
  }
}

const n = results.length
const pct = (x) => (n ? ((x / n) * 100).toFixed(0) : '0') + '%'
console.log('\n=== ParkProof sign-translation accuracy ===')
console.log(`corpus:                    ${n} signs`)
console.log(`pass (verdict + leave-by): ${pass} (${pct(pass)})`)
console.log(`verdict wrong:             ${verdictWrong} (${pct(verdictWrong)})`)
console.log(`leave-by wrong:            ${untilWrong} (${pct(untilWrong)})`)
console.log(`errored:                   ${errored}`)
if (fails.length) {
  console.log('\nfailures (the prompt-iteration worklist):')
  for (const f of fails) console.log('  - ' + f)
}
// Non-zero exit if any verdict was wrong or a call errored — usable in CI as a
// regression gate once the corpus is populated.
process.exit(verdictWrong + errored > 0 ? 1 : 0)
