#!/usr/bin/env node
/**
 * Generate the six README demo screenshots by driving the app in headless
 * Chromium with Playwright. All network calls are intercepted so the run is
 * deterministic and offline — no Claude tokens spent, no Nominatim hits.
 *
 * Run with:   npm run screenshots
 *
 * Outputs:    docs/screenshots/0{1..6}-*.png  (iPhone 15 Pro viewport)
 * Inputs:     scripts/screenshots-fixtures/parking-sign.{jpg,jpeg,png}
 *
 * If you change a screen's heading text or button label, re-run this script
 * and the demo grid in README.md updates with the new look automatically.
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, devices } from 'playwright'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FIXTURES_DIR = join(ROOT, 'scripts', 'screenshots-fixtures')
const OUT_DIR = join(ROOT, 'docs', 'screenshots')
const PORT = 5174 // Off-default so we don't clash with a dev server you may have running
const APP_URL = `http://localhost:${PORT}`

// ---------- Fixtures ----------

/** Look for a fixture with any of {jpg, jpeg, png}; return path or null. */
function findFixture(stem) {
  for (const ext of ['jpg', 'jpeg', 'png']) {
    const p = join(FIXTURES_DIR, `${stem}.${ext}`)
    if (existsSync(p)) return p
  }
  return null
}

/** Find the sign-photo fixture, falling back to og-image.png with a warning. */
function findSignPhoto() {
  const found = findFixture('parking-sign')
  if (found) return found
  console.warn(
    '[screenshots] No parking-sign fixture found — using public/og-image.png as placeholder.',
  )
  return join(ROOT, 'public', 'og-image.png')
}

/** Optional car-photo fixture — falls back to the sign photo so existing screens still work. */
function findCarPhoto(signFallback) {
  const found = findFixture('car-photo')
  if (found) return found
  console.warn('[screenshots] No car-photo fixture — Session Logger will reuse the sign photo.')
  return signFallback
}

/** Optional ticket fixture — falls back to the sign photo. */
function findTicketPhoto(signFallback) {
  const found = findFixture('ticket')
  if (found) return found
  console.warn('[screenshots] No ticket fixture — Appeal Flow will reuse the sign photo.')
  return signFallback
}

/**
 * Build a fake but locally-valid Cognito session and pre-seed it into
 * localStorage so the "signed-in account" screen can be screenshotted
 * without standing up a real user. amazon-cognito-identity-js validates
 * tokens client-side only by decoding the payload and checking expiry —
 * signature verification happens server-side, so any signature suffix
 * works. All authed API calls are intercepted by Playwright routes anyway.
 *
 * Returns the localStorage payload as plain { key: value } so the caller
 * can stamp it into the page via page.evaluate.
 */
function fakeCognitoSession({ clientId, email, sub }) {
  // base64url encode without padding — what JWTs use
  const b64url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
  const nowSec = Math.floor(Date.now() / 1000)
  const expSec = nowSec + 60 * 60 * 24 * 30 // 30 days out
  const header = b64url({ alg: 'RS256', kid: 'demo', typ: 'JWT' })
  const idPayload = b64url({
    sub,
    email,
    email_verified: true,
    iss: `https://cognito-idp.ap-southeast-2.amazonaws.com/demo`,
    aud: clientId,
    token_use: 'id',
    auth_time: nowSec,
    iat: nowSec,
    exp: expSec,
  })
  const accessPayload = b64url({
    sub,
    iss: `https://cognito-idp.ap-southeast-2.amazonaws.com/demo`,
    client_id: clientId,
    token_use: 'access',
    scope: 'aws.cognito.signin.user.admin',
    auth_time: nowSec,
    iat: nowSec,
    exp: expSec,
    username: email,
  })
  const fakeSig = 'demoSignatureNotVerifiedClientSide' // any string the SDK accepts as opaque
  const idToken = `${header}.${idPayload}.${fakeSig}`
  const accessToken = `${header}.${accessPayload}.${fakeSig}`
  const prefix = `CognitoIdentityServiceProvider.${clientId}`
  return {
    [`${prefix}.LastAuthUser`]: email,
    [`${prefix}.${email}.idToken`]: idToken,
    [`${prefix}.${email}.accessToken`]: accessToken,
    [`${prefix}.${email}.refreshToken`]: 'demo-refresh-token',
    [`${prefix}.${email}.clockDrift`]: '0',
  }
}

/** Parse VITE_COGNITO_* values from scripts/.aws-resources if present, for forwarding to the dev server. */
function readCognitoEnv() {
  const f = join(ROOT, 'scripts', '.aws-resources')
  if (!existsSync(f)) return {}
  const text = readFileSync(f, 'utf8')
  const get = (k) => {
    const m = text.match(new RegExp(`^${k}=(.+)$`, 'm'))
    return m ? m[1].trim() : null
  }
  const pool = get('COGNITO_USER_POOL_ID')
  const client = get('COGNITO_APP_CLIENT_ID')
  const hosted = get('COGNITO_HOSTED_UI_DOMAIN')
  const out = {}
  if (pool) out.VITE_COGNITO_USER_POOL_ID = pool
  if (client) out.VITE_COGNITO_APP_CLIENT_ID = client
  if (hosted) out.VITE_COGNITO_HOSTED_UI_DOMAIN = hosted
  return out
}

/**
 * Mocked /api/sign-translate response. The shape matches the Lambda's real
 * output: a multi-variant clarification (left = 1/4P, right = 2P, plus the
 * weekend permit zone). When the user picks a variant we fall through to
 * the "result" view — the App.tsx merge logic handles that branch in pure
 * frontend code, so we don't need a second mocked response.
 */
function mockTranslateResponse() {
  const now = Date.now()
  return {
    rules:
      '1/4P Mon-Fri 8am-6pm (left); 2P Mon-Fri 8am-6pm (right); Permit Zone Sat-Sun 8am-11pm (both directions)',
    observations: [
      {
        scope: '↔ Both directions',
        items: ['Permit Zone', '8am-11pm Sat-Sun'],
      },
      {
        scope: '← Left side',
        items: ['1/4P (15 minutes)', '8am-6pm Mon-Fri'],
      },
      {
        scope: '→ Right side',
        items: ['2P (2 hours)', '8am-6pm Mon-Fri'],
      },
    ],
    can_park_now: true,
    until: new Date(now + 90 * 60 * 1000).toISOString(),
    duration_minutes: 90,
    confidence: 'high',
    next_transition: null,
    clarification: {
      question: 'Which side of the sign are you parked on?',
      options: [
        {
          label: 'Left side (1/4P)',
          rules: '1/4P Mon-Fri 8am-6pm',
          observations: [
            { scope: '← Left side', items: ['1/4P (15 minutes)', '8am-6pm Mon-Fri'] },
          ],
          can_park_now: true,
          until: new Date(now + 15 * 60 * 1000).toISOString(),
          duration_minutes: 15,
          next_transition: null,
        },
        {
          label: 'Right side (2P)',
          rules: '2P Mon-Fri 8am-6pm',
          observations: [
            { scope: '→ Right side', items: ['2P (2 hours)', '8am-6pm Mon-Fri'] },
          ],
          can_park_now: true,
          until: new Date(now + 120 * 60 * 1000).toISOString(),
          duration_minutes: 120,
          // Featured in screenshot #03 — surfaces the new transition banner so
          // the portfolio demo grid showcases the feature.
          next_transition: {
            when: new Date(now + 60 * 60 * 1000).toISOString(),
            change: 'Permit Zone ends — anyone can park free until 8am Mon-Fri',
          },
        },
      ],
    },
  }
}

const MOCK_REVERSE_GEOCODE = {
  display_name: '175 Lygon Street, Carlton VIC 3053',
  address: { road: 'Lygon Street', suburb: 'Carlton', state: 'Victoria', postcode: '3053' },
}

/**
 * Mocked /api/draft-appeal response. Realistic content so the appeal-flow
 * screenshot is portfolio-worthy — actual sentence structure, plausible
 * council reference, real-feeling argument. The session reference inside the
 * letter is filled with the live session's metadata at draft time so it
 * always reads consistent with whatever the screenshot pipeline has set up.
 */
const MOCK_APPEAL_DRAFT = {
  ticket_summary:
    'City of Melbourne · Infringement #INF-2026-487123 · $96 · alleged 2P time-limit overstay at 175 Lygon Street, Carlton.',
  appeal_subject:
    'Request for review — Infringement #INF-2026-487123 (175 Lygon St, Carlton)',
  appeal_letter: [
    'Dear City of Melbourne Parking Review Officer,',
    '',
    'I am writing to request a review of infringement notice #INF-2026-487123 issued at 175 Lygon Street, Carlton.',
    '',
    'The alleged offence is a "2P" time-limit overstay. I respectfully dispute this on the basis of the following contemporaneous evidence, captured at the moment of parking via the ParkProof evidence app:',
    '',
    '• Arrival timestamp: GPS-anchored to the second',
    '• GPS coordinates: -37.79800, 144.96750 (±0m accuracy)',
    '• Address resolved via OpenStreetMap: 175 Lygon Street, Carlton VIC 3053',
    '• Sign read at parking time: "2P Mon-Fri 8am-6pm"',
    '• AI-translated outcome: parking permitted (well within the 2-hour limit)',
    '',
    'At the time of parking, my vehicle and the sign were both photographed. The 2P restriction printed on the sign applies only to weekdays 8am–6pm — the only restriction in force during my parking session was the overlapping "Permit Zone" notice, which I had verified did not apply.',
    '',
    'I respectfully request the notice be withdrawn on the basis that the cited 2P restriction was not active at the time. The full cryptographically-signed evidence record is available on request — photographs and metadata are signed by an AWS KMS-managed key, with the public verification key published at https://parkproof.dsouza.tech/parkproof-public-key.pem.',
    '',
    'Yours sincerely,',
    '[Your name]',
    '[Your contact details]',
  ].join('\n'),
  evidence_strength: 'strong',
  notes:
    'Strong case — the GPS-anchored arrival timestamp, signed photos, and clearly-readable sign all corroborate that the 2P restriction was not active at the time. Lead with the day-of-week / time-of-day argument rather than disputing the officer\'s observation; it reframes the dispute around a fact rather than a judgement call.',
}

// ---------- Dev server ----------

// Strip ANSI escape sequences so we can pattern-match Vite's coloured stdout.
// eslint-disable-next-line no-control-regex
const STRIP_ANSI = /\x1B\[[0-9;]*[A-Za-z]/g

/**
 * Spawn `vite --port PORT --strictPort` and resolve once the dev server is
 * listening. Returns {proc, stop} so the caller can always tear down — even
 * if the readiness check fails, the spawned proc must be killed.
 */
function startDevServer() {
  // Forward Cognito IDs from .aws-resources so the auth UI renders during the
  // screenshot run. Without these, authConfigured() === false and the sign-in
  // button on the home screen never mounts — so the auth-flow screenshots
  // (#12 / #13) would have nothing to capture.
  const cognitoEnv = readCognitoEnv()
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...cognitoEnv, BROWSER: 'none' },
  })

  const stop = () => {
    if (proc.exitCode !== null || proc.killed) return
    if (process.platform === 'win32') {
      // taskkill /T kills the whole tree — Vite spawns child processes that
      // otherwise linger and keep port 5174 bound.
      spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { shell: true })
    } else {
      proc.kill('SIGTERM')
      setTimeout(() => proc.kill('SIGKILL'), 5_000)
    }
  }

  const ready = new Promise((resolve, reject) => {
    let stdout = ''
    const onData = (chunk) => {
      const text = chunk.toString()
      stdout += text.replace(STRIP_ANSI, '')
      process.stdout.write(`[vite] ${text}`)
      // Vite logs "Local:   http://localhost:5174/" once the server is up.
      // Match on the port number directly — robust against colour codes,
      // whitespace, and minor copy changes.
      if (stdout.includes(`localhost:${PORT}/`)) resolve()
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', (c) => process.stderr.write(`[vite] ${c}`))
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) reject(new Error(`vite exited with code ${code}`))
    })
    setTimeout(() => reject(new Error('Vite did not become ready within 60s')), 60_000)
  })

  return { proc, stop, ready }
}

// ---------- The flow ----------

async function captureFlow({ page, signPhotoPath, carPhotoPath, ticketPath }) {
  // === 01-scan: scan screen with the two dashed upload zones ===
  await page.goto(APP_URL, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Scan a parking sign/ }).click()
  await page.getByText('Scan parking sign').waitFor()
  // Let the optional ReuseCard / RecentScansPicker settle (they wait on GPS
  // permission state — none in fresh context, so they shouldn't render, but
  // the effect schedules a setState that needs to flush).
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT_DIR, '01-scan.png'), animations: 'disabled', fullPage: true })
  console.log('[screenshots] ✓ 01-scan')

  // Upload the fixture sign. Both file inputs are hidden but setInputFiles
  // works regardless of visibility.
  await page.locator('input[type=file]').first().setInputFiles(signPhotoPath)
  // resizeImageFile() runs async on the change event — wait for the preview
  // image and Translate button to render before clicking.
  // Button reads "Translate" when the photo-quality pre-check is happy and
  // "Translate anyway" when it flags an issue — both lead to the same flow.
  await page.getByRole('button', { name: /^Translate( anyway)?$/ }).click()

  // === 02-clarify: variant chooser ===
  await page.getByText('Which side of the sign are you parked on?').waitFor()
  await page.waitForTimeout(300) // image render
  await page.screenshot({ path: join(OUT_DIR, '02-clarify.png'), animations: 'disabled', fullPage: true })
  console.log('[screenshots] ✓ 02-clarify')

  // Pick the 2P side — gives a more interesting countdown than 15 min.
  await page.getByRole('button', { name: /Right side/ }).click()

  // === 03-result: green answer card + observations + verify ===
  await page.getByText('You can park here').waitFor()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT_DIR, '03-result.png'), animations: 'disabled', fullPage: true })
  console.log('[screenshots] ✓ 03-result')

  await page.getByRole('button', { name: /Log this parking session/ }).click()

  // === 04-logger: GPS + address + car-photo dropzone ===
  // Wait for the reverse-geocode result to render the address.
  await page.getByText('Lygon Street').waitFor({ timeout: 10_000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT_DIR, '04-logger.png'), animations: 'disabled', fullPage: true })
  console.log('[screenshots] ✓ 04-logger')

  // Add a real car photo so the saved session has both a sign and a car —
  // referenced by Session Detail (#07) and the evidence PDF. The alt-text
  // comes from t('logger.carAtSpot') = "Car at the spot".
  await page.locator('input[type=file]').first().setInputFiles(carPhotoPath)
  await page.getByAltText('Car at the spot').waitFor()
  await page.getByRole('button', { name: /^Save session$/ }).click()

  // === 05-remind: chip grid + calendar + notification cards ===
  await page.getByText(/Set reminders?/).waitFor()
  await page.waitForTimeout(400) // chip render + useNow tick
  await page.screenshot({ path: join(OUT_DIR, '05-remind.png'), animations: 'disabled', fullPage: true })
  console.log('[screenshots] ✓ 05-remind')

  // === 06-history: list with three saved sessions (one fresh + two seeded) ===
  // Inject two older sessions directly into localStorage so the list looks
  // lived-in rather than first-use. The "yesterday" seed is the rich one
  // used for the SessionDetail screenshot (#07) — it has a real-looking
  // sign photo, expired status, and a complete cryptographic signature so
  // the "Signed" badge renders and the PDF appendix path exercises.
  const SIGN_FIXTURE_DATAURL = `data:image/png;base64,${readFileSync(signPhotoPath).toString('base64')}`
  await page.evaluate(
    async ({ signPhotoDataUrl }) => {
      // localStorage caps at ~5MB per origin; the raw og-image fixture is
      // ~2.5MB base64 per photo, so resize via canvas before storing —
      // mirrors src/lib/image.ts behaviour for real user uploads.
      async function downscaledJpeg(dataUrl) {
        const img = await new Promise((resolve, reject) => {
          const i = new Image()
          i.onload = () => resolve(i)
          i.onerror = reject
          i.src = dataUrl
        })
        const MAX = 800
        const ratio = Math.min(1, MAX / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * ratio))
        const h = Math.max(1, Math.round(img.height * ratio))
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        c.getContext('2d').drawImage(img, 0, 0, w, h)
        return c.toDataURL('image/jpeg', 0.7)
      }
      const smallSignPhoto = await downscaledJpeg(signPhotoDataUrl)

      const KEY = 'parkproof.sessions.v1'
      const sessions = JSON.parse(localStorage.getItem(KEY) || '[]')
      const yesterday = new Date(Date.now() - 22 * 60 * 60 * 1000)
      const yesterdayExpired = new Date(yesterday.getTime() + 2 * 60 * 60 * 1000) // 2h after arrival
      const lastWeek = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
      // Carlton seed at the screenshot context's GPS (-37.7980, 144.9675).
      // Drives the smart re-scan ReuseCard for capture #11 — "you parked here
      // 6 hours ago, reuse the prior reading?" — without burning a second
      // active session that would conflict with the live "Currently parked"
      // home card in #09.
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
      const sixHoursAgoExpired = new Date(sixHoursAgo.getTime() + 2 * 60 * 60 * 1000) // expired 4h ago
      sessions.push(
        {
          id: 'fixture-yesterday',
          arrived_at: yesterday.toISOString(),
          expires_at: yesterdayExpired.toISOString(), // now in the past — shows "Expired" state
          location: {
            lat: -37.8136,
            lng: 144.9631,
            address: '230 Collins Street, Melbourne VIC 3000',
            source: 'gps',
            accuracy_meters: 12,
          },
          sign_photo: smallSignPhoto,
          car_photo: smallSignPhoto,
          rules: '2P Mon-Fri 8am-6pm; Permit Zone Sat-Sun 8am-11pm',
          observations: [
            { scope: '↔ Both directions', items: ['2P (2 hours)', '8am-6pm Mon-Fri'] },
            { scope: '↔ Both directions', items: ['Permit Zone', '8am-11pm Sat-Sun'] },
          ],
          chosen_label: 'Right side (2P)',
          confidence: 'high',
          signature: {
            schema: 'parkproof.session.v1',
            signed_at: yesterday.toISOString(),
            algorithm: 'ECDSA_SHA_256',
            key_alias: 'alias/parkproof-evidence-key',
            canonical_payload: JSON.stringify({
              session_id: 'fixture-yesterday',
              arrived_at: yesterday.toISOString(),
              rules: '2P Mon-Fri 8am-6pm; Permit Zone Sat-Sun 8am-11pm',
              location: { lat: -37.8136, lng: 144.9631 },
            }),
            signature_base64:
              'MEUCIQDexampleSignatureBaseSixtyFourEncodedBlobThatLooksReal'
              + 'IsticAndFillsTheCanonicalSlotForScreenshotPurposesAiE3qY=',
          },
        },
        {
          id: 'fixture-lastweek',
          arrived_at: lastWeek.toISOString(),
          expires_at: null,
          location: {
            lat: -37.7704,
            lng: 144.9573,
            address: '15 Errol Street, North Melbourne VIC 3051',
            source: 'gps',
            accuracy_meters: 8,
          },
          sign_photo:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
          car_photo: null,
          rules: 'No Standing 7am-9am Mon-Fri',
          observations: [{ scope: 'Whole sign', items: ['No Standing', '7am-9am Mon-Fri'] }],
          confidence: 'medium',
        },
        {
          id: 'fixture-carlton',
          arrived_at: sixHoursAgo.toISOString(),
          expires_at: sixHoursAgoExpired.toISOString(),
          location: {
            lat: -37.798,
            lng: 144.9675,
            address: '175 Lygon Street, Carlton VIC 3053',
            source: 'gps',
            accuracy_meters: 10,
          },
          sign_photo: smallSignPhoto,
          car_photo: null,
          rules: '2P Mon-Fri 8am-6pm; Permit Zone Sat-Sun 8am-11pm',
          observations: [
            { scope: '↔ Both directions', items: ['2P (2 hours)', '8am-6pm Mon-Fri'] },
          ],
          chosen_label: 'Right side (2P)',
          confidence: 'high',
        },
      )
      localStorage.setItem(KEY, JSON.stringify(sessions))
    },
    { signPhotoDataUrl: SIGN_FIXTURE_DATAURL },
  )

  await page.getByRole('button', { name: /^Done$/ }).click()
  await page.getByRole('button', { name: /Session history/ }).click()
  await page.getByText('Session history', { exact: true }).waitFor()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT_DIR, '06-history.png'), animations: 'disabled', fullPage: true })
  console.log('[screenshots] ✓ 06-history')

  // === 07-session-detail: Collins St session (expired, signed) ===
  // Pick the "230 Collins Street" card — has cryptographic signature + an
  // expired status, the richest detail-screen for the screenshot.
  await page.locator('button').filter({ hasText: '230 Collins Street' }).click()
  await page.getByText('Parking session', { exact: true }).waitFor()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT_DIR, '07-session-detail.png'), animations: 'disabled', fullPage: true })
  console.log('[screenshots] ✓ 07-session-detail')

  // PDF export sanity check — verifies the click actually triggers a
  // download (the user reported it silently doesn't work on past sessions).
  // We attach the listener BEFORE clicking, then await the event.
  const downloadPromise = page
    .waitForEvent('download', { timeout: 15_000 })
    .catch((e) => ({ failed: true, error: e }))
  await page.getByRole('button', { name: /^Export as PDF$/ }).click()
  const dl = await downloadPromise
  if (dl && 'failed' in dl) {
    console.error(
      `[screenshots] ⚠ PDF export did NOT fire a download — bug repro likely. ${dl.error?.message ?? ''}`,
    )
  } else if (dl) {
    const tmpPath = await dl.path()
    const { size } = tmpPath ? await stat(tmpPath) : { size: 0 }
    console.log(
      `[screenshots] PDF download fired: ${dl.suggestedFilename()} (${size} bytes)`,
    )
  }

  // Back to history → pick the Lygon (fresh) session for the appeal flow
  await page.getByRole('button', { name: /Back to history/ }).click()
  await page.getByText('Session history', { exact: true }).waitFor()
  await page.locator('button').filter({ hasText: 'Lygon Street' }).first().click()
  await page.getByText('Parking session', { exact: true }).waitFor()
  await page.getByRole('button', { name: /Got a ticket/ }).click()

  // AppealFlow capture stage — upload a real(-looking) infringement notice
  // photo so the AI-drafted appeal screenshot shows the right artifact.
  await page.getByText('Draft an appeal letter').waitFor()
  await page.locator('input[type=file]').first().setInputFiles(ticketPath)

  // === 08-appeal: AI-drafted review screen ===
  // The mocked /api/draft-appeal returns "strong evidence" so the brand-blue
  // chip renders. Wait on the letter textarea — it's the slowest piece to
  // appear because the mock has a 400ms realism delay.
  await page.getByText(/Strong evidence/i).waitFor({ timeout: 20_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT_DIR, '08-appeal.png'), animations: 'disabled', fullPage: true })
  console.log('[screenshots] ✓ 08-appeal')

  // === 09-home-active: home screen with the live "Currently parked" card ===
  // The Lygon session from the main flow has expires_at = now + 2h, so it's
  // still active here. Navigate back to home via the URL (faster than the
  // back-button chain and avoids any state in the AppealFlow component).
  await page.goto(APP_URL, { waitUntil: 'networkidle' })
  // The card needs the useNow tick to flush; 400ms is comfortable.
  await page.getByText(/Currently parked/i).waitFor({ timeout: 5_000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT_DIR, '09-home-active.png'), animations: 'disabled', fullPage: true })
  console.log('[screenshots] ✓ 09-home-active')

  // === 10-photo-quality-warning ===
  // Generate a low-variance, dark photo in-browser (canvas → blob → File) and
  // feed it through the SignScanner. The pre-flight (src/lib/photo-quality.ts)
  // computes Laplacian-variance + mean luminance; a near-solid dark grey
  // canvas trips the 'blurry' OR 'dark' verdict and the warning UI renders.
  await page.getByRole('button', { name: /Scan another|Scan a parking sign/ }).click()
  await page.getByText('Scan parking sign').waitFor()
  // Dismiss the ReuseCard / picker if they popped — we want a clean upload zone.
  const dismissReuse = page.getByRole('button', { name: /No, take a new photo/ })
  if (await dismissReuse.isVisible().catch(() => false)) await dismissReuse.click()
  const dismissPicker = page.getByRole('button', { name: /No, take a new photo/ })
  if (await dismissPicker.isVisible().catch(() => false)) await dismissPicker.click()
  await page.waitForTimeout(200)
  // Build a deliberately-bad 800x600 photo in the page and inject it into the
  // hidden file input. Using DataTransfer (not setInputFiles with a path)
  // because the bad photo lives in memory, not on disk.
  await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 800
    c.height = 600
    const ctx = c.getContext('2d')
    // Near-uniform dark grey + a sliver of noise — variance ~0, luminance ~30.
    ctx.fillStyle = '#1c1c20'
    ctx.fillRect(0, 0, 800, 600)
    const imgData = ctx.getImageData(0, 0, 800, 600)
    for (let i = 0; i < imgData.data.length; i += 4) {
      const jitter = (Math.random() * 3) | 0
      imgData.data[i] += jitter
      imgData.data[i + 1] += jitter
      imgData.data[i + 2] += jitter
    }
    ctx.putImageData(imgData, 0, 0)
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'))
    const file = new File([blob], 'dark-blurry-sign.png', { type: 'image/png' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const input = document.querySelector('input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  // Wait for the quality verdict to render (regex matches all four warning
  // messages: blurry / dark / overexposed / tiny).
  await page
    .getByText(/blurry|dark|overexposed|tiny|too small/i)
    .waitFor({ timeout: 5_000 })
  await page.waitForTimeout(300)
  await page.screenshot({
    path: join(OUT_DIR, '10-photo-quality-warning.png'),
    animations: 'disabled',
    fullPage: true,
  })
  console.log('[screenshots] ✓ 10-photo-quality-warning')

  // === 11-reuse-card: smart re-scan proximity-matched suggestion ===
  // The fixture-carlton seed (planted earlier in the localStorage block) sits
  // 0m from the screenshot context's GPS, so ReuseCard should render at the
  // top of the scan screen.
  await page.goto(APP_URL, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Scan another|Scan a parking sign/ }).click()
  await page.getByText('Scan parking sign').waitFor()
  await page
    .getByText(/scanned this spot|reuse this reading|here before/i)
    .waitFor({ timeout: 5_000 })
    .catch(() => {
      // Some i18n strings may not include those exact words — fall back to
      // the ReuseCard's CTA text which is more stable.
      return page.getByRole('button', { name: /Reuse this reading|Use this/i }).waitFor()
    })
  await page.waitForTimeout(300)
  await page.screenshot({
    path: join(OUT_DIR, '11-reuse-card.png'),
    animations: 'disabled',
    fullPage: true,
  })
  console.log('[screenshots] ✓ 11-reuse-card')

  // === 12-signin: sign-in screen with federation buttons ===
  // Only meaningful when auth is configured for the build. Skipped with a
  // warning otherwise (the home button doesn't render in that case).
  const authConfigured = await page.evaluate(() => {
    return Boolean(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.localStorage // smoke test only — Vite injects env at build, not at runtime
    )
  })
  // Navigate home, then tap "Sign in to sync"
  await page.goto(APP_URL, { waitUntil: 'networkidle' })
  const signInBtn = page.getByRole('button', { name: /Sign in to sync/i })
  if ((await signInBtn.count()) === 0) {
    console.warn(
      '[screenshots] Skipping #12 / #13 — auth UI not configured (set VITE_COGNITO_* via scripts/.aws-resources).',
    )
  } else {
    await signInBtn.click()
    // Heading is uniquely "Sign in" — avoids the strict-mode trap of matching
    // the h2 + paragraph + submit button (all three contain "Sign in").
    await page.getByRole('heading', { name: 'Sign in' }).waitFor({ timeout: 5_000 })
    await page.waitForTimeout(400)
    await page.screenshot({
      path: join(OUT_DIR, '12-signin.png'),
      animations: 'disabled',
      fullPage: true,
    })
    console.log('[screenshots] ✓ 12-signin')

    // === 13-signed-in-account: account settings with fake Cognito session ===
    // amazon-cognito-identity-js trusts whatever JWTs sit in localStorage as
    // long as the payload is well-formed and exp is in the future. Pull the
    // client ID from .aws-resources (same source the dev server gets it from).
    const clientId = readCognitoEnv().VITE_COGNITO_APP_CLIENT_ID
    if (!clientId) {
      console.warn(
        '[screenshots] Skipping #13 — VITE_COGNITO_APP_CLIENT_ID not on the script\'s env.',
      )
    } else {
      const fakeStorage = fakeCognitoSession({
        clientId,
        email: 'demo@parkproof.example',
        sub: '00000000-0000-0000-0000-000000000001',
      })
      await page.evaluate((entries) => {
        for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v)
      }, fakeStorage)
      // Hard-reload so AuthProvider re-reads localStorage and picks up the
      // fake session on mount.
      await page.reload({ waitUntil: 'networkidle' })
      // The home-screen "signed-in account" card shows the email.
      await page.getByText('demo@parkproof.example').waitFor({ timeout: 5_000 })
      await page.getByRole('button', { name: /demo@parkproof\.example/ }).click()
      // The settings intro paragraph is uniquely worded — safer than matching
      // the "Account" heading which collides with the home-screen "Account"
      // right-label and any sub-section heading that might also say "Account".
      await page
        .getByText(/Manage cloud sync, export your data/i)
        .waitFor({ timeout: 5_000 })
      await page.waitForTimeout(400)
      await page.screenshot({
        path: join(OUT_DIR, '13-signed-in-account.png'),
        animations: 'disabled',
        fullPage: true,
      })
      console.log('[screenshots] ✓ 13-signed-in-account')

      // Tear the fake session down so it doesn't leak into the language captures.
      await page.evaluate((entries) => {
        for (const k of Object.keys(entries)) localStorage.removeItem(k)
      }, fakeStorage)
    }
  }

  // === 14/15/16: i18n showcase — same home screen in EN, IT, HI ===
  // Reads the LanguageSelector dropdown and clicks the target option for
  // each. Captures full-page screenshots so the wrapping copy + button text
  // are all visible in the right script.
  for (const [code, file] of [
    ['en', '14-home-en.png'],
    ['it', '15-home-it.png'],
    ['hi', '16-home-hi.png'],
  ]) {
    await page.goto(APP_URL, { waitUntil: 'networkidle' })
    // The app overrides i18next-browser-languagedetector's default key to
    // 'parkproof.language' (see src/lib/i18n.ts:60). Writing the i18nextLng
    // default key has no effect.
    await page.evaluate((langCode) => {
      try {
        window.localStorage.setItem('parkproof.language', langCode)
      } catch {
        // ignore quota
      }
    }, code)
    await page.reload({ waitUntil: 'networkidle' })
    // Wait for the language to take effect — the LanguageSelector trigger
    // should show the picked language's native label. Probe by waiting for
    // the language-specific home tagline text rather than time-based sleep.
    await page.waitForTimeout(400)
    await page.screenshot({
      path: join(OUT_DIR, file),
      animations: 'disabled',
      fullPage: true,
    })
    console.log(`[screenshots] ✓ ${file.replace('.png', '')}`)
  }
}

// ---------- Orchestrator ----------

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const signPhotoPath = findSignPhoto()
  const carPhotoPath = findCarPhoto(signPhotoPath)
  const ticketPath = findTicketPhoto(signPhotoPath)
  console.log(`[screenshots] Sign-photo fixture: ${signPhotoPath}`)
  console.log(`[screenshots] Car-photo fixture:  ${carPhotoPath}`)
  console.log(`[screenshots] Ticket fixture:     ${ticketPath}`)
  console.log(`[screenshots] Output directory:   ${OUT_DIR}`)

  console.log('[screenshots] Starting Vite dev server on :' + PORT + ' …')
  const dev = startDevServer()

  let browser
  try {
    await dev.ready
    browser = await chromium.launch()
    const context = await browser.newContext({
      ...devices['iPhone 15 Pro'],
      // Force device-scale to 2 so screenshots render crisp on retina HiDPI.
      deviceScaleFactor: 2,
      geolocation: { latitude: -37.7980, longitude: 144.9675 }, // Carlton, VIC
      permissions: ['geolocation'],
      locale: 'en-AU',
      timezoneId: 'Australia/Melbourne',
    })

    // Mock outbound network so the run is hermetic.
    await context.route('**/api/sign-translate', async (route) => {
      await new Promise((r) => setTimeout(r, 300)) // tiny realism delay
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockTranslateResponse()),
      })
    })
    await context.route('**/nominatim.openstreetmap.org/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_REVERSE_GEOCODE),
      }),
    )
    await context.route('**/api/sign-session', (route) =>
      // The signing path is fire-and-forget and JSON.parse'd on success.
      // Return body "null" so `await resp.json()` resolves to null and the
      // caller's `if (signature)` guard short-circuits — no fake signature
      // field gets persisted into the screenshot fixture session.
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: 'null',
      }),
    )
    await context.route('**/api/feedback', (route) =>
      route.fulfill({ status: 204, body: '' }),
    )
    await context.route('**/api/draft-appeal', async (route) => {
      await new Promise((r) => setTimeout(r, 400)) // tiny realism delay
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_APPEAL_DRAFT),
      })
    })

    const page = await context.newPage()
    page.on('pageerror', (err) => console.error('[page error]', err.message))
    page.on('console', (msg) => {
      // Surface only errors — the app is chatty in dev mode.
      if (msg.type() === 'error') console.error('[page console]', msg.text())
    })

    await captureFlow({ page, signPhotoPath, carPhotoPath, ticketPath })

    console.log('[screenshots] All screenshots saved.')
  } finally {
    await browser?.close()
    dev.stop()
  }
}

main().catch((err) => {
  console.error('[screenshots] FAILED:', err)
  process.exit(1)
})
