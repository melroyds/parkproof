#!/usr/bin/env node
/**
 * Generate public/og-image.png — the social-share thumbnail every platform
 * shows when the link is previewed (iMessage, WhatsApp, LinkedIn, Slack,
 * Reddit, Discord, Facebook). 1200x630 PNG.
 *
 * Replaces the retired PIL generator (scripts/_og_image.py), which was built
 * on the pre-redesign identity: cool-grey paper, vivid blue #275BFF, and the
 * Fraunces serif. This renders the card as HTML in headless Chromium instead,
 * so it uses the REAL Greenfield / Verified Pine tokens and the actual
 * Space Grotesk + Inter + JetBrains Mono webfonts the live site loads — the
 * thumbnail therefore matches the site pixel-for-pixel in feel.
 *
 * Re-runnable and deterministic. Run after any brand change:
 *   node scripts/_og_image.mjs
 *
 * NOTE: social platforms cache OG images hard. After deploying a new one,
 * re-scrape via each platform's debugger, or share with ?v=N to bust it.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TMP_DIR = join(ROOT, 'scripts', '.og-tmp')
const TMP_HTML = join(TMP_DIR, 'og.html')

/**
 * TWO copies ship, and they land at different URLs — both must be written or
 * the thumbnail silently stays stale where it actually matters:
 *
 *   public/og-image.png                  -> /app/og-image.png   (the PWA)
 *   <landing>/og-image.png               -> /og-image.png       (ROOT)
 *
 * The marketing landing's <meta og:image> points at the ROOT copy, so the
 * landing one is what every platform shows when parkproof.com.au is shared.
 * Writing only public/ was the trap that left the old blue card live.
 */
const OUTPUTS = [
  join(ROOT, 'public', 'og-image.png'),
  join(ROOT, 'migrations', 'two-app-architecture', 'landing-from-claude-design', 'og-image.png'),
]

// Greenfield / Verified Pine tokens — mirrors src/index.css @theme.
const T = {
  vault: '#073B25',
  pine: '#0E5C3A',
  paper: '#F3F6F4',
  sage: '#A9CFBE',
  mint: '#7BE3A4',
  ink: '#0B1A14',
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1200px;height:630px;overflow:hidden}
  body{
    background:
      radial-gradient(90% 70% at 88% -10%, rgba(123,227,164,.16), transparent 62%),
      repeating-linear-gradient(115deg, rgba(123,227,164,.05) 0 1px, transparent 1px 10px),
      ${T.vault};
    font-family:'Inter',system-ui,sans-serif;
    display:flex; align-items:center;
    padding:0 72px; gap:56px;
    -webkit-font-smoothing:antialiased;
  }
  /* ---- left: the message ---- */
  .left{flex:1 1 auto; min-width:0}
  .lockup{display:flex; align-items:center; gap:16px; margin-bottom:38px}
  .lockup .mark{width:60px;height:60px;flex:none;border-radius:15px;background:${T.paper};
    display:grid;place-items:center;box-shadow:0 4px 14px rgba(0,0,0,.28)}
  .lockup .name{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:38px;
    letter-spacing:-.02em;color:${T.paper}}
  h1{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:78px;line-height:1.02;
    letter-spacing:-.035em;color:${T.paper};margin-bottom:26px}
  h1 .go{color:${T.mint}}
  .sub{font-size:23px;line-height:1.45;color:${T.sage};font-weight:400;max-width:20ch;margin-bottom:34px}
  .url{display:inline-flex;align-items:center;gap:10px;font-family:'JetBrains Mono',monospace;
    font-weight:600;font-size:19px;color:${T.vault};background:${T.paper};padding:13px 22px;
    clip-path:polygon(0 0, calc(100% - 13px) 0, 100% 13px, 100% 100%, 0 100%)}
  .url .arrow{color:${T.pine}}
  /* ---- right: the product moment (the verdict card) ---- */
  .card{
    flex:0 0 392px; background:${T.paper}; color:${T.ink};
    padding:34px 32px 32px; position:relative;
    clip-path:polygon(0 0, calc(100% - 30px) 0, 100% 30px, 100% 100%, 0 100%);
    box-shadow:0 26px 60px rgba(0,0,0,.42);
  }
  .seal{width:52px;height:52px;border-radius:50%;background:${T.pine};color:${T.mint};
    display:grid;place-items:center;font-size:29px;font-weight:800;line-height:1;
    box-shadow:0 0 0 5px rgba(123,227,164,.3);margin-bottom:20px}
  .vlabel{font-family:'JetBrains Mono',monospace;font-weight:600;font-size:13px;letter-spacing:.15em;
    text-transform:uppercase;color:${T.pine};margin-bottom:10px}
  .vhead{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:44px;line-height:1;
    letter-spacing:-.03em;color:${T.ink};margin-bottom:18px}
  .pill{display:inline-block;background:${T.pine};color:#fff;font-family:'JetBrains Mono',monospace;
    font-weight:600;font-size:20px;padding:9px 18px;border-radius:999px}
  .obs{margin-top:24px;padding-top:20px;border-top:1px solid rgba(11,26,20,.14);
    display:flex;flex-direction:column;gap:9px}
  .obs div{font-family:'JetBrains Mono',monospace;font-size:14.5px;color:#25332c;display:flex;gap:10px}
  .obs b{color:${T.pine};font-weight:600;min-width:64px}
</style></head>
<body>
  <div class="left">
    <div class="lockup">
      <div class="mark">
        <svg width="42" height="42" viewBox="0 0 512 512" aria-hidden="true">
          <g transform="translate(18 47) scale(4.4)">
            <rect x="27" y="19" width="12.5" height="63" fill="${T.pine}"/>
            <path fill-rule="evenodd" fill="${T.pine}" d="M57 13 A24 24 0 1 0 57 61 A24 24 0 1 0 57 13 Z M57 25 A12 12 0 1 1 57 49 A12 12 0 1 1 57 25 Z"/>
            <circle cx="57" cy="37" r="5.5" fill="${T.vault}"/>
            <path d="M73 20 L80.5 17.5 L77.5 27 Z" fill="${T.mint}"/>
          </g>
        </svg>
      </div>
      <div class="name">ParkProof</div>
    </div>
    <h1>Aussie parking,<br><span class="go">decoded.</span></h1>
    <p class="sub">Photograph a sign. Get a plain-English answer. Keep the evidence.</p>
    <div class="url"><span class="arrow">&#8594;</span> www.parkproof.com.au</div>
  </div>

  <div class="card">
    <div class="seal">&#10003;</div>
    <div class="vlabel">Verified record</div>
    <div class="vhead">You can park</div>
    <div><span class="pill">until 4:00 PM</span></div>
    <div class="obs">
      <div><b>2P</b><span>Mon&#8211;Fri 8am&#8211;6pm</span></div>
      <div><b>Signed</b><span>KMS &#183; tamper-evident</span></div>
    </div>
  </div>
</body></html>`

mkdirSync(TMP_DIR, { recursive: true })
writeFileSync(TMP_HTML, html, 'utf8')

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.goto(`file://${TMP_HTML.replace(/\\/g, '/')}`, { waitUntil: 'networkidle' })
  // Webfonts must be fully loaded or the card renders in a fallback face.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400)
  const buf = await page.screenshot({ animations: 'disabled' })
  for (const out of OUTPUTS) {
    writeFileSync(out, buf)
    console.log(`[og] wrote ${out} (1200x630)`)
  }
} finally {
  await browser.close()
}
