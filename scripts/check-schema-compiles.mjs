#!/usr/bin/env node
// Does the Anthropic API accept every structured-output schema the Lambda
// sends?
//
// The API compiles each output_config.format json_schema into a grammar
// and refuses one that is too large: 400 invalid_request_error "The
// compiled grammar is too large, which would cause performance issues."
// Unit tests mock the model client, so they can't see this. On 9 Nov 2026
// the T3 sign-reading schema was refused this way, which would have failed
// every scan after a deploy. Run this after any change to RESPONSE_SCHEMA,
// NOTICE_SCHEMA or APPEAL_RESPONSE_SCHEMA (lambda/index.js), and before a
// deploy. The schema budget test in lambda/sign-reading.test.js guards the
// sign-reading schema's size between runs.
//
// One tiny request per schema (max_tokens 16, a few hundred input tokens):
// the answer is cut off and thrown away; only whether the API accepts the
// schema matters. Each request carries the thinking and effort settings
// its route sends, because the limit depends on them: on 9 Nov 2026 a
// sign-reading schema that compiled in a bare request was refused with the
// sign reader's adaptive thinking and effort low. Prints COMPILES or FAILS
// per schema. Exit 0 when all compile, 1 when any fails, 2 when there is no
// API key.
//
// Setup:
//   cd lambda && npm ci          # lambda/index.js pulls the AWS SDK from lambda/
//   ANTHROPIC_API_KEY in the environment or in .env at the repo root
// Run:
//   node scripts/check-schema-compiles.mjs
//   node scripts/check-schema-compiles.mjs --env path/to/.env
//
// The key is read, never printed or written anywhere.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import Anthropic from '@anthropic-ai/sdk'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// The model lambda/index.js sends every request to.
const MODEL = 'claude-sonnet-4-6'

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  allowPositionals: false,
  options: { env: { type: 'string' } },
})

/** ANTHROPIC_API_KEY from a .env file, or null. Reads only that one key. */
function keyFromEnvFile(path) {
  if (!existsSync(path)) return null
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*ANTHROPIC_API_KEY\s*=\s*(.*)$/)
    if (m) {
      const key = m[1].trim().replace(/^["']|["']$/g, '')
      return key || null
    }
  }
  return null
}

const apiKey =
  process.env.ANTHROPIC_API_KEY || keyFromEnvFile(values.env ? resolve(values.env) : join(ROOT, '.env'))
if (!apiKey) {
  console.error('No ANTHROPIC_API_KEY in the environment or the .env file. Nothing was checked.')
  process.exit(2)
}

const { APPEAL_RESPONSE_SCHEMA, NOTICE_SCHEMA, RESPONSE_SCHEMA } = await import('../lambda/index.js')

// Each schema with the thinking and effort its route sends (lambda/index.js:
// translateSign, readNotice, handleDraftAppeal). Keep these in step.
const SCHEMAS = [
  { name: 'RESPONSE_SCHEMA (sign reading)', schema: RESPONSE_SCHEMA, thinking: { type: 'adaptive' }, effort: 'low' },
  { name: 'NOTICE_SCHEMA (notice reader)', schema: NOTICE_SCHEMA },
  { name: 'APPEAL_RESPONSE_SCHEMA (appeal draft)', schema: APPEAL_RESPONSE_SCHEMA },
]

const client = new Anthropic({ apiKey })
const width = Math.max(...SCHEMAS.map(({ name }) => name.length))
let failed = 0

for (const { name, schema, thinking, effort } of SCHEMAS) {
  const size = `${JSON.stringify(schema).length} chars`
  try {
    await client.messages.create({
      model: MODEL,
      max_tokens: 16,
      ...(thinking ? { thinking } : {}),
      messages: [{ role: 'user', content: 'Reply with any JSON that fits the schema.' }],
      output_config: { format: { type: 'json_schema', schema }, ...(effort ? { effort } : {}) },
    })
    console.log(`${name.padEnd(width)}  COMPILES  (${size})`)
  } catch (err) {
    failed += 1
    // The SDK's error message is the API's status and error body; it never
    // carries the request headers, so the key can't leak through it.
    const status = err?.status ? `${err.status} ` : ''
    const detail = String(err?.error?.error?.message || err?.message || err).slice(0, 300)
    console.log(`${name.padEnd(width)}  FAILS     (${size}): ${status}${detail}`)
  }
}

if (failed > 0) {
  console.log(
    `\n${failed} of ${SCHEMAS.length} schemas failed. A 400 means the API refuses that schema, so its route would fail after a deploy; any other error means it couldn't be checked.`,
  )
  // exitCode rather than exit(): the SDK's sockets close on their own, and
  // exiting under them can trip a libuv assertion on Windows.
  process.exitCode = 1
} else {
  console.log(`\nAll ${SCHEMAS.length} schemas compile.`)
}
