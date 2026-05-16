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
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
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
        },
      ],
    },
  }
}

const MOCK_REVERSE_GEOCODE = {
  display_name: '175 Lygon Street, Carlton VIC 3053',
  address: { road: 'Lygon Street', suburb: 'Carlton', state: 'Victoria', postcode: '3053' },
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
  await page.getByRole('button', { name: /^Translate$/ }).click()

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
  // lived-in rather than first-use. We do this BEFORE navigating to history
  // so the component's mount-time loadSessions() picks them up.
  await page.evaluate(() => {
    const KEY = 'parkproof.sessions.v1'
    const sessions = JSON.parse(localStorage.getItem(KEY) || '[]')
    const yesterday = new Date(Date.now() - 22 * 60 * 60 * 1000)
    const lastWeek = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    sessions.push(
      {
        id: 'fixture-yesterday',
        arrived_at: yesterday.toISOString(),
        expires_at: null,
        location: {
          lat: -37.8136,
          lng: 144.9631,
          address: '230 Collins Street, Melbourne VIC 3000',
          source: 'gps',
          accuracy_meters: 12,
        },
        sign_photo:
          // 1×1 transparent PNG, just enough for the thumbnail not to error.
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        car_photo: null,
        rules: '1P Mon-Fri 8am-6pm',
        observations: [{ scope: 'Whole sign', items: ['1P (1 hour)', '8am-6pm Mon-Fri'] }],
        confidence: 'high',
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
  })

  await page.getByRole('button', { name: /^Done$/ }).click()
  await page.getByRole('button', { name: /Session history/ }).click()
  await page.getByText('Session history', { exact: true }).waitFor()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT_DIR, '06-history.png'), animations: 'disabled', fullPage: true })
  console.log('[screenshots] ✓ 06-history')
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
