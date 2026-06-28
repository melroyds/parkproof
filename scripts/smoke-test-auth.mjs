#!/usr/bin/env node
/**
 * ParkProof — end-to-end smoke test for the auth + cloud-sync routes.
 *
 * Drives a fresh user through the whole loop, against the LIVE deployed API:
 *   1. Sign up with a throwaway email                       (Cognito)
 *   2. Auto-confirm the user via AdminConfirmSignUp         (Cognito admin)
 *   3. Sign in to obtain an idToken                         (Cognito SRP)
 *   4. POST /sessions/upload — write one fake session       (DynamoDB)
 *   5. GET  /sessions/list  — verify the session is there   (DynamoDB)
 *   6. POST /photos/presign — request a presigned upload    (S3)
 *   7. POST /sessions/delete — remove the session           (DynamoDB + S3)
 *   8. POST /me/delete — nuke the test account              (Cognito + DDB + S3)
 *
 * Pass = every step returns the expected shape and the final delete cleans
 * everything up. Failures throw with a step number for quick diagnosis.
 *
 * Reads resource IDs from scripts/.aws-resources (written by setup-auth.sh)
 * and the deployed API URL from $VITE_API_URL or the discovered Gateway.
 *
 * Run with:   npm run smoke-test:auth
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// ─── Config discovery ────────────────────────────────────────────────────
const resourcesPath = join(ROOT, 'scripts', '.aws-resources')
if (!existsSync(resourcesPath)) {
  console.error('✗ scripts/.aws-resources not found. Run scripts/setup-auth.sh first.')
  process.exit(1)
}
const resources = Object.fromEntries(
  readFileSync(resourcesPath, 'utf8')
    .split('\n')
    .filter((l) => l && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    }),
)
const USER_POOL_ID = resources.COGNITO_USER_POOL_ID
const APP_CLIENT_ID = resources.COGNITO_APP_CLIENT_ID
const REGION = resources.COGNITO_REGION || 'ap-southeast-2'

// Resolve the API URL — derive from the API Gateway if VITE_API_URL is unset.
let apiUrl = process.env.VITE_API_URL
if (!apiUrl) {
  const awsRes = spawnSync('aws', [
    'apigatewayv2', 'get-apis', '--region', REGION,
    '--query', "Items[?Name=='parkproof-api'].ApiId | [0]",
    '--output', 'text',
  ])
  const apiId = awsRes.stdout.toString().trim()
  if (!apiId || apiId === 'None') {
    console.error('✗ Could not discover the API Gateway. Set VITE_API_URL or re-run deploy.sh.')
    process.exit(1)
  }
  apiUrl = `https://${apiId}.execute-api.${REGION}.amazonaws.com`
} else {
  // Strip trailing route path — we only want the base.
  apiUrl = apiUrl.replace(/\/[^/]*$/, '')
}

const testEmail = `parkproof-smoketest-${Date.now()}@example.com`
const testPassword = `SmokeTest!${Date.now()}`

console.log('▶ Smoke-testing auth + cloud sync against the live deployment')
console.log(`  API base:    ${apiUrl}`)
console.log(`  User Pool:   ${USER_POOL_ID}`)
console.log(`  App Client:  ${APP_CLIENT_ID}`)
console.log(`  Test user:   ${testEmail}`)
console.log('')

// ─── Helpers ─────────────────────────────────────────────────────────────
function step(n, label) {
  console.log(`▶ [${n}] ${label}`)
}

function ok(detail) {
  console.log(`  ✓ ${detail}`)
}

async function awsCli(args) {
  const res = spawnSync('aws', args, { encoding: 'utf8' })
  if (res.status !== 0) {
    throw new Error(`aws ${args.join(' ')} failed: ${res.stderr}`)
  }
  return res.stdout
}

async function callApi(method, path, options = {}) {
  const headers = { ...(options.headers || {}) }
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
  const res = await fetch(apiUrl + path, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  }
  return parsed
}

// ─── Test flow ───────────────────────────────────────────────────────────
let idToken = null
let createdUserSub = null
let createdSessionId = `smoketest-session-${Date.now()}`

async function run() {
  step(1, 'Sign up via Cognito (SignUp action)')
  const signupRes = await awsCli([
    'cognito-idp', 'sign-up',
    '--client-id', APP_CLIENT_ID,
    '--username', testEmail,
    '--password', testPassword,
    '--user-attributes', `Name=email,Value=${testEmail}`,
    '--region', REGION,
    '--output', 'json',
  ])
  const signup = JSON.parse(signupRes)
  createdUserSub = signup.UserSub
  ok(`UserSub: ${createdUserSub}`)

  step(2, 'Auto-confirm via AdminConfirmSignUp')
  await awsCli([
    'cognito-idp', 'admin-confirm-sign-up',
    '--user-pool-id', USER_POOL_ID,
    '--username', testEmail,
    '--region', REGION,
  ])
  ok('user confirmed')

  step(3, 'Sign in (InitiateAuth USER_PASSWORD_AUTH)')
  const authRes = await awsCli([
    'cognito-idp', 'initiate-auth',
    '--client-id', APP_CLIENT_ID,
    '--auth-flow', 'USER_PASSWORD_AUTH',
    '--auth-parameters', `USERNAME=${testEmail},PASSWORD=${testPassword}`,
    '--region', REGION,
    '--output', 'json',
  ])
  idToken = JSON.parse(authRes).AuthenticationResult.IdToken
  ok(`got idToken (${idToken.length} chars)`)

  step(4, 'POST /sessions/upload')
  const session = {
    id: createdSessionId,
    arrived_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    location: {
      lat: -37.798,
      lng: 144.9675,
      address: 'Smoke Test St, Carlton VIC 3053',
      source: 'gps',
      accuracy_meters: 8,
    },
    sign_photo: null, // skip — would go to S3 via presigned URL
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm (smoke test)',
    observations: [{ scope: 'Whole sign', items: ['2P', '8am-6pm Mon-Fri'] }],
    confidence: 'high',
  }
  const upload = await callApi('POST', '/sessions/upload', {
    token: idToken,
    body: { session },
  })
  if (upload?.ok !== true) throw new Error(`upload response missing ok=true: ${JSON.stringify(upload)}`)
  ok('session written to DynamoDB')

  step(5, 'GET /sessions/list')
  const listed = await callApi('GET', '/sessions/list', { token: idToken })
  const found = (listed?.sessions || []).find((s) => s.id === createdSessionId)
  if (!found) throw new Error(`list did not return our session. Got: ${JSON.stringify(listed)}`)
  ok(`list returned ${listed.sessions.length} session(s) including ours`)

  step(6, 'POST /photos/presign')
  const presign = await callApi('POST', '/photos/presign', {
    token: idToken,
    body: { session_id: createdSessionId, role: 'sign', content_type: 'image/jpeg' },
  })
  if (!presign?.url || !presign.url.startsWith('https://')) {
    throw new Error(`presign returned unexpected shape: ${JSON.stringify(presign)}`)
  }
  ok(`presigned URL issued for s3://${presign.bucket}/${presign.key}`)

  step(7, 'POST /sessions/delete')
  const del = await callApi('POST', '/sessions/delete', {
    token: idToken,
    body: { session_id: createdSessionId },
  })
  if (del?.ok !== true) throw new Error(`delete response missing ok=true: ${JSON.stringify(del)}`)
  ok('session removed')

  step(8, 'POST /me/delete (cleanup the test account)')
  const accountDel = await callApi('POST', '/me/delete', { token: idToken })
  if (accountDel?.ok !== true) {
    throw new Error(`account delete response missing ok=true: ${JSON.stringify(accountDel)}`)
  }
  ok(
    `deleted: ${accountDel.deleted_rows} DDB rows + ${accountDel.deleted_objects} S3 objects + Cognito user`,
  )
}

run()
  .then(() => {
    console.log('')
    console.log('✓ All 8 steps passed — auth + cloud sync end-to-end is healthy.')
  })
  .catch(async (err) => {
    console.error('')
    console.error('✗ Smoke test failed:', err.message)
    // Best-effort cleanup so a failed run doesn't leave debris in Cognito.
    if (createdUserSub) {
      try {
        await awsCli([
          'cognito-idp', 'admin-delete-user',
          '--user-pool-id', USER_POOL_ID,
          '--username', testEmail,
          '--region', REGION,
        ])
        console.error(`  (cleanup) deleted Cognito user ${testEmail}`)
      } catch (cleanupErr) {
        console.error(
          `  (cleanup) could NOT delete Cognito user ${testEmail} — clean up manually:\n    ` +
            cleanupErr.message,
        )
      }
    }
    process.exit(1)
  })
