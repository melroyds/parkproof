# Two-app architecture cutover — runbook

**Goal:** ship the Claude Design marketing landing at `/` while keeping
the React PWA fully working at `/app/`. Production cutover on Saturday
afternoon (or whichever weekend block makes sense); Reddit launch
tied to whatever your "ship date" framing is afterwards.

**Status while this directory exists but is not yet activated:** the
live site behaves exactly as it does today. None of the files in this
directory are part of the Vite build, the `npm run dev` flow, or the
production deploy. Everything here is dormant until you follow the
runbook below.

---

## What this directory contains

| File | Purpose | What you do with it |
|---|---|---|
| `README.md` | This document | Skim ahead of Saturday so the cutover feels familiar |
| `landing-from-claude-design/` | Empty home for the Claude Design output | Unzip the `site.zip` from Claude Design here |
| `public-sw-shim.js` | Self-immolating SW that evicts the old root-scope registration | Copied into `dist/sw.js` by the modified deploy script |
| `locale-detect-snippet.html` | Auto-detect "Continue in 한국어 →" chip | Pasted into the landing's `index.html` before `</body>` |
| `vite-config.diff.md` | Manual edits to `vite.config.ts` | Apply on cutover day |
| `deploy.diff.md` | Manual edits to `scripts/deploy.sh` | Apply on cutover day |

---

## Architecture target

Before:

```
www.parkproof.com.au/         ← React PWA (scan button is the landing)
www.parkproof.com.au/sw.js    ← SW scope: /
```

After:

```
www.parkproof.com.au/                     ← Marketing landing (static HTML)
www.parkproof.com.au/asset_*.png|woff2    ← Landing's inlined assets
www.parkproof.com.au/sw.js                ← Eviction shim (cleans up old SW)
www.parkproof.com.au/app/                 ← React PWA
www.parkproof.com.au/app/sw.js            ← Workbox SW, scope: /app/
www.parkproof.com.au/app/manifest.webmanifest  ← start_url: /app/
www.parkproof.com.au/app/assets/...       ← Vite chunks
```

Key properties:

- **Anonymous PWA users (today: ~zero installed)** keep working. If any
  exist, the eviction shim cleans up their old SW on next visit.
- **Cognito federation** still works — Hosted UI callback/logout URIs
  don't need to change because they point at the origin, and the React
  app at `/app/` parses the same query params.
- **Push subscriptions** (if any exist) point at the old `/sw.js`
  endpoint, which is now the eviction shim. When the shim runs, it
  unregisters the SW, which orphans the push subscription. **Inform
  the ~3 friends who installed the POC** that they'll need to
  re-enable notifications on their next visit. No backend cleanup
  needed — orphaned subscriptions just fail silently on dispatch.
- **The deploy stays one command** — `./scripts/deploy.sh` builds both
  surfaces and syncs `dist/` in a single S3 sync.

---

## Day-of runbook

Plan to start mid-afternoon. End-to-end should fit in a 4-hour block
including the install-PWA test on your phone. Coffee, headphones,
phone on the desk, no Slack/email open.

### Hour 1 — prep & local build

1. **Verify Claude Design output is in place.**
   `ls migrations/two-app-architecture/landing-from-claude-design/` —
   should show `index.html` + a bunch of `asset_*.png|jpg|svg|woff2`
   files. If empty, go back to Claude Design and re-download the
   site bundle zip.

2. **Apply the landing-page fixes inline.** Open
   `landing-from-claude-design/index.html`:
   - Replace `asset_000.svg` (the brand mark) with your real
     `public/parkproof-icon.svg` — either rename your real file to
     `asset_000.svg` (so the existing `<img src="asset_000.svg">` tags
     keep working) and copy it into `landing-from-claude-design/`, or
     do a find-replace of `asset_000.svg` → `parkproof-icon.svg` and
     copy your real SVG in.
   - Find footer `href="#"` placeholders. Update:
     - `Privacy` → `/app/#/privacy` or `/privacy-policy.html` if you
       have one, otherwise leave as `#` (footnote)
     - `Send feedback` → `/app/?feedback=open` (deep-link to open
       the in-app feedback modal — easier than a separate page)
     - `Case study` → link to your GitHub repo's `docs/case-study.md`
   - Find `href="#cta"` in the nav and `href="#cta"` in the hero
     buttons — replace with `href="/app/"` (so visitors who click
     "Snap a session" land on the React app, not an in-page anchor).
   - Find `href="#top"` in the final-CTA button — also replace with
     `href="/app/"`.
   - Find the "Most signage apps" text in the reasoning section and
     soften to "Most OCR tools" (positions against a technology, not
     a named competitor).
   - At the very end, **paste in the locale-detect chip** from
     `locale-detect-snippet.html` immediately before `</body>`.

3. **Apply the `vite.config.ts` changes.** Open
   `migrations/two-app-architecture/vite-config.diff.md` and follow
   the two replace blocks. Save.

4. **Apply the `scripts/deploy.sh` changes.** Open
   `migrations/two-app-architecture/deploy.diff.md` and follow the
   one insert block. Save.

5. **Local build sanity check.**
   ```bash
   npm run build
   ls dist/                  # expect: app/ index.html sw.js asset_*.{png,jpg,svg,woff2}
   ls dist/app/              # expect: index.html sw.js manifest.webmanifest assets/ locales/ ...
   ```
   If either of those don't match, fix before deploying. Trace back
   through the diffs. Do not deploy a broken build.

### Hour 2 — staged production deploy

6. **Heads-up message to the POC friends.** One-line text to the ~3
   people who tried the early build:
   > *"FYI new website goes live in ~1h. Old installed app icons
   > might act weird until you visit www.parkproof.com.au once and
   > let the page reload itself. Sorry for the churn — ping me if
   > anything's actually broken."*

7. **Deploy.**
   ```bash
   ./scripts/deploy.sh
   ```
   Watch the output. Expect:
   - `[4/6] Building frontend` ← npm run build, ~30s
   - `[4.5/6] Layering marketing landing + SW shim into dist/` ←
     new step, prints landing-file count + SW shim path
   - `[5/6] S3 bucket: parkproof-app-251800369612` ← uploads ~5MB
   - `[6/6] CloudFront: parkproof-cdn` ← invalidates `/*`
   - `✓ Deploy complete`

8. **Wait for CloudFront invalidation.** Usually <90 seconds for
   `/*`. Don't smoke-test before this completes — you'll get
   confused by stale-cache responses.

### Hour 3 — smoke tests

Do each in order. Don't skip. If anything's wrong, the rollback
section below is one command.

9. **Anonymous desktop browser, fresh tab:**
   - Visit `www.parkproof.com.au` (incognito window, English).
     Expect: marketing landing renders, no JS errors in console.
   - Click "Snap a session" CTA → expect to land on `/app/`,
     React app loads, language is English.
   - Click your browser's back button → back on the landing.
   - In the address bar, type `www.parkproof.com.au/app/` directly
     → React app loads (no marketing flash).

10. **Phone (fresh, not the POC install):**
    - Open `www.parkproof.com.au` in mobile Safari/Chrome.
    - Landing renders responsive — chip in top-right if your phone
      is set to Korean/Mandarin (sanity-check this by temporarily
      changing your phone language).
    - Tap "Snap a session" → camera permission prompts → scan a
      real sign → verdict comes back.
    - "Add to Home Screen" / "Install app" → installed PWA opens
      at `/app/` start URL (not the landing).
    - Close + reopen the installed PWA → still goes straight to
      the scan flow.

11. **POC friend's device (if reachable):**
    - Have them visit `www.parkproof.com.au` once. The SW eviction
      shim runs invisibly; they get the new marketing landing.
    - Their old installed PWA icon (if any) will now either redirect
      to `/app/` on next launch, or sit at the marketing landing —
      depends on how aggressively their browser re-fetches the
      manifest. Either way, no broken state.

12. **CloudWatch sanity for ~15 minutes:**
    ```
    aws logs tail /aws/lambda/parkproof-sign-translator --since 15m --follow
    ```
    Watch for `[parkproof]` timing logs. Any 5xx spikes = rollback.

### Hour 4 — buffer / breathe

If everything above is clean, you're done. Stop touching things.

If something's broken, roll back. Do not iterate live.

---

## Rollback

The previous `dist/` is reproducible: revert the manual edits to
`vite.config.ts` and `scripts/deploy.sh`, then re-run `deploy.sh`.
That syncs the old `dist/` shape back to S3, invalidates CloudFront,
and the live site is back to today's state within ~3 minutes.

Practical version with `git`:

```bash
# Save your in-progress migration edits to a branch first so you don't
# lose them when reverting.
git stash push -m "in-progress migration edits"

# Then run deploy with the pre-migration tree — this rolls production
# back to today's working state.
./scripts/deploy.sh
```

When you're ready to try again (later that day, or next weekend):

```bash
git stash pop                 # restore the migration edits
# ... re-run from "Hour 2 — staged production deploy"
```

**What rollback does NOT undo:**

- Browsers that already had the SW eviction shim activate stay clean.
  This is fine — they just get a regular fresh-visitor experience
  against the rolled-back site.
- Cognito federation users keep their session tokens; localStorage
  is untouched.
- Any user feedback / DDB sessions / S3 evidence written during the
  cutover window persist. No data loss in either direction.

---

## Gotchas observed during the cutover

Three real issues hit during the live cutover. Documented so future-you
doesn't burn the same time we did.

### 1. Vite `base` doesn't rewrite absolute paths in JSX or service workers

When you change Vite's `base` from `/` to `/app/`, Vite rewrites
*build-time references* — HTML `<link>` / `<script>` tags, CSS `url()`
calls, the PWA manifest's icon paths. It does **NOT** rewrite *runtime
string literals* in JSX (`<img src="/foo.png" />`) or in the service
worker source (`icon: '/pwa-192.png'`). Those are just strings to Vite
and they bake into the bundle unchanged.

**Symptom on this cutover:** the hero illustration 404'd on
`parkproof.com.au/app/` because `LandingFeatures.tsx` and `App.tsx`
both hard-coded `src="/hero-illustration.png"`. The asset is now at
`/app/hero-illustration.png` but the code asked for the wrong path.
Same problem in `PrivacyPolicy.tsx` (`href="/parkproof-public-key.pem"`),
`SessionHistory.tsx` (`src="/empty-history.svg"`), and four references
inside `src/service-worker.ts` (push-notification icon/badge URLs).
Eight instances total.

**Fix:** use `import.meta.env.BASE_URL` in JSX, drop the leading slash
in the SW:

```tsx
// JSX — base-aware:
<img src={`${import.meta.env.BASE_URL}hero-illustration.png`} />

// Service worker — relative paths resolve against the SW's URL,
// which is /app/service-worker.js, so the / is unnecessary:
icon: 'pwa-192x192.png',   // resolves to /app/pwa-192x192.png
```

**Audit pattern for next time** — run these greps *before* the cutover,
not after:

```bash
grep -rn 'src="/[^"]*\.\(png\|jpg\|svg\|webp\|ico\)' src/
grep -rn 'href="/[^"]*\.\(pem\|html\|svg\|json\)' src/
grep -rn "'/[^']*\.\(png\|jpg\|svg\)'" src/
```

Each match is a candidate fix.

### 2. CloudFront OAC + S3 REST origin doesn't auto-resolve directories

If you've run `harden.sh` (which sets up OAC), CloudFront's origin is
the S3 REST API endpoint, not the website endpoint. REST endpoints do
**NOT** auto-resolve `/app/` → `/app/index.html` the way website mode
used to.

**Symptom on this cutover:** `/app/` returned the marketing landing's
HTML because CloudFront tried to fetch `/app/` from S3, got a 403
(no such key, because the file is at `/app/index.html`), hit its
`CustomErrorResponses` fallback (error → `/index.html`), and served
the landing. The `X-Cache: Error from cloudfront` response header is
the diagnostic giveaway.

**Fix:** deploy a CloudFront Function on viewer-request that appends
`index.html` to any trailing-slash URI:

```javascript
function handler(event) {
    var request = event.request;
    if (request.uri.endsWith('/')) {
        request.uri += 'index.html';
    }
    return request;
}
```

Provision once with `aws cloudfront create-function`, publish, then
attach to the distribution's `DefaultCacheBehavior.FunctionAssociations`
as event-type `viewer-request`. The function takes 5-15 min to
propagate to all edges; the affected URLs work the moment the
distribution status flips to `Deployed`.

The function is already live on `parkproof-cdn` (name:
`parkproof-uri-rewrite`). Don't delete it.

### 3. `outDir` change leaves stale files in `dist/` between builds

When you change Vite's `outDir` from `dist` (default) to `dist/app`,
the `emptyOutDir: true` setting empties `dist/app/` — not `dist/`.
Files from any previous build sitting at `dist/` root (old `index.html`,
old `sw.js`, old `manifest.webmanifest`) survive the build and ship
to production alongside the new landing.

**Symptom on this cutover:** caught during the local layering
simulation BEFORE the production deploy. Would have manifested as
ghost files at `s3://bucket/` that confused service-worker
registration and broke manifest discovery.

**Fix:** `rm -rf dist` at the start of `deploy.sh`'s build step.
Each deploy starts from a clean slate. Already applied — see
`deploy.sh` around line 393.

---

## Known limitations

- **Landing is English-only.** The auto-detect chip catches non-English
  visitors and routes them to `/app/`, but the *pitch* in the
  reasoning + evidence sections is English. A v2 weekend can ship
  localised landing variants (`/zh-CN/`, `/ko/` etc. with hreflang
  + CloudFront `Vary: Accept-Language`). For v1, the chip is enough.
- **No CloudFront Function for path-aware 404 routing.** Typo'd URLs
  bounce to the marketing landing instead of returning a real 404.
  Acceptable trade-off for v1; revisit if you ever add React Router.
- **PWA install prompt only fires on `/app/`.** The landing doesn't
  trigger Chrome's install banner because its manifest scope is
  `/app/`. Visitors have to click through to `/app/` first. This is
  intentional — the marketing landing is for browsing, the app is
  for installing. Don't try to "fix" it.
- **The `og-image.png` reference in the landing should point at
  your existing `public/og-image.png`.** Either copy your file into
  `landing-from-claude-design/` with the right filename, or update
  the `<meta property="og:image">` tag in the landing's `index.html`
  to point at `/og-image.png` (which will still be at the root after
  cutover because deploy.sh copies the landing folder over `dist/`).

---

## Post-cutover follow-ups (not for Saturday)

- Soften "Built solo over 7 days" in the footer to whatever the
  ship date actually marks ("Built solo, 2 weeks" if you're shipping
  on the anniversary).
- Add a `parkproof-public-key.pem` link somewhere in the landing's
  Evidence section so cryptographers can verify your KMS signatures
  without having to find the URL.
- Consider a `/api/landing-visit` ping (anonymous) to track how
  many marketing-landing impressions turn into `/app/` clicks —
  funnel data is useful for v2 iteration.
- **Add per-file cache-control headers** to `deploy.sh`. Claude
  Design's own DEPLOY.md (read on cutover day, then deleted by the
  modified deploy script before sync) suggested a sensible pattern:
    - `index.html` (both root + `/app/`): `Cache-Control:
      public,max-age=60,must-revalidate` — short cache so deploys
      propagate quickly.
    - All hashed static assets (`assets/*`, fonts, images, CSS, JS):
      `Cache-Control: public,max-age=31536000,immutable` — long
      cache because filenames change on rebuild.
    - `sw.js` (both root + `/app/`): `Cache-Control: no-cache,
      must-revalidate` — browsers MUST recheck the SW each visit so
      the eviction shim activates fast. (Modern browsers already
      apply this implicitly per the SW spec, but explicit beats
      implicit for the CloudFront edge.)
  We're skipping this on cutover day because the existing
  `aws s3 sync` + `--paths '/*'` CloudFront invalidation works
  fine for v1. Add it in a follow-up commit once the cutover is
  stable.
- **Convert the hero phone-cycling PNG screenshots to AVIF/WebP.**
  Claude Design flagged ~1.3 MB of compressed PNGs in the hero
  demo. Worth a 5-minute optimisation pass post-launch.
- Remove `migrations/two-app-architecture/` entirely after ~30 days
  of stable production. The SW shim has done its job by then, and
  the migration-day diffs are committed in git history if you ever
  need to reconstruct what changed.
