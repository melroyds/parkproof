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

/** Find the sign-photo fixture, falling back to og-image.png with a warning. */
function findSignPhoto() {
  for (const name of ['parking-sign.jpg', 'parking-sign.jpeg', 'parking-sign.png']) {
    const p = join(FIXTURES_DIR, name)
    if (existsSync(p)) return p
  }
  console.warn(
    '[screenshots] No parking-sign fixture found — using public/og-image.png as placeholder.',
  )
  return join(ROOT, 'public', 'og-image.png')
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
  const proc = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
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

async function captureFlow({ page, signPhotoPath }) {
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

  // Add a "car photo" (reuse the same fixture) so the saved session has both.
  await page.locator('input[type=file]').first().setInputFiles(signPhotoPath)
  // Wait until the car-photo preview is up before saving.
  await page.getByAltText('Your car').waitFor()
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

  // AppealFlow capture stage — just upload a ticket photo (reuse fixture)
  await page.getByText('Draft an appeal letter').waitFor()
  await page.locator('input[type=file]').first().setInputFiles(signPhotoPath)

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
}

// ---------- Orchestrator ----------

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const signPhotoPath = findSignPhoto()
  console.log(`[screenshots] Sign-photo fixture: ${signPhotoPath}`)
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

    await captureFlow({ page, signPhotoPath })

    console.log('[screenshots] All six screenshots saved.')
  } finally {
    await browser?.close()
    dev.stop()
  }
}

main().catch((err) => {
  console.error('[screenshots] FAILED:', err)
  process.exit(1)
})
