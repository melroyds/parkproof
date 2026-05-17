# CLAUDE.md — ParkProof engineering notes

Quick context for AI assistance on this codebase. Read this before touching things.

## What this is

Mobile-first installable PWA. Photograph an Australian parking sign → Claude vision answers "can I park now?" with structured JSON → optionally log a session (car photo + GPS + address) → get a `.ics` calendar reminder or in-tab browser notification → later, export the session as a PDF for an infringement dispute.

Live: <https://parkproof.dsouza.tech> (custom domain, CloudFront-fronted). Hosted on AWS in `ap-southeast-2`.

See [`parkproof-spec.md`](parkproof-spec.md) for the original product brief and [`README.md`](README.md) for the user-facing version.

## Run it

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env   # required
npm run dev   # → http://localhost:5173
```

## How the backend works

There is **one** Lambda function (`parkproof-sign-translator`) handling two HTTP routes via path dispatch in [`lambda/index.js`](lambda/index.js):

| Route | Handler | Purpose |
|---|---|---|
| `POST /sign-translate` | `handleSignTranslate` → `translateSign({...})` | Two modes, inferred from request body |
| `POST /feedback` | `handleFeedback` | Layer-1 telemetry: logs `[parkproof.feedback]` events to CloudWatch |

`translateSign` itself has **two modes** controlled by what the body contains:

1. **Fresh translate** — body has `image_base64`. Sends the image + current-time context to Claude vision. Returns full `ParkingRules` JSON.
2. **Refresh** (smart re-scan) — body has `prior_rules` + `prior_observations` instead of `image_base64`. No vision call; pure text-only reasoning about whether the previously-read rules still allow parking right now. ~3× faster, ~4× cheaper. Triggered from the frontend when the user reuses a saved session.

The Lambda is **reused as the local dev proxy** via a Vite plugin in [`vite.config.ts`](vite.config.ts) that intercepts `POST /api/sign-translate` and `POST /api/feedback`, dynamically imports `lambda/index.js`, and calls the same code paths. Same code in dev and prod — never call the Anthropic API from the browser, the key must stay server-side.

## Claude API choices

- **Model: `claude-sonnet-4-6`.** Vision + native JSON Schema enforcement + adaptive thinking. Don't downgrade to Haiku 4.5 — we tried it and Haiku **doesn't support thinking of any kind**, which broke multi-rule time-window math on stacked signs. Sonnet 4.6 with adaptive thinking is the floor for correctness on this task.
- `thinking: { type: 'adaptive' }`. Required for the multi-rule "compute leave-by per rule, take the earliest" reasoning. **Don't** use `budget_tokens` — deprecated on Sonnet 4.6.
- `output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA }, effort: 'low' }`. Schema-enforced output; `effort: 'low'` keeps thinking depth tight so we stay in the 6–12s range instead of 15–30s on `medium`.
- `max_tokens: 16384`. Adaptive thinking shares this budget — keep it generous. If you ever see `stop_reason === 'max_tokens'` or truncated JSON, bump higher; do not lower it.
- The system prompt has a detailed **"HOW TO COMPUTE `until`"** section with worked examples. The model previously regressed (picked the *farthest* leave-by time instead of the *earliest*) — the examples fix that. Don't remove them.
- **Refresh mode** uses the same model and parameters but the user message says "This is a REFRESH request, NOT a fresh sign reading" and embeds the prior rules + observations + chosen variant. The frontend then overrides `rules`/`observations`/`chosen_label`/`confidence` from the prior session and trusts only `can_park_now` / `until` / `duration_minutes` from the model.

## Schema shape

```ts
type ParkingRules = {
  rules: string                                          // factual sign description, no time conclusions
  observations: { scope: string; items: string[] }[]     // grouped by sign element (arrow, both directions, etc.)
  can_park_now: boolean
  until: string | null                                   // ISO 8601 in user's local timezone (resolved from coords)
  duration_minutes: number | null
  confidence: 'low' | 'medium' | 'high'
  clarification: null | {
    question: string
    options: RuleVariant[]                               // each with its own observations + can_park_now + until
  }
  chosen_label?: string                                  // frontend-only: set after the user picks a variant
  alternate_variants?: RuleVariant[]                     // frontend-only: variants the user did NOT pick
}
```

## API request shapes

**Translate (fresh sign):**
```json
{
  "image_base64": "/9j/4AA...",
  "media_type": "image/jpeg",
  "lat": -37.7980,
  "lng": 144.9675
}
```

**Translate (smart re-scan, text-only):**
```json
{
  "prior_rules": "2P Mon-Fri 8am-6pm; Permit Zone Sat-Sun 8am-11pm",
  "prior_observations": [{"scope":"→ Right arrow","items":["2P","Mon–Fri 8am–6pm"]}, ...],
  "prior_chosen_label": "Right side",
  "lat": -37.7980,
  "lng": 144.9675
}
```

**Feedback:**
```json
{
  "verdict": "correct" | "retake",
  "feedback_id": "<uuid>"
}
```

## App.tsx state machine

```
home → scan → loading → (clarify? →) result → logging → remind → home
                                          ↓
home → history → session → history       └──→ retake → scan
```

Plus the smart re-scan branch: `scan` → user picks a recent session (or proximity-matched one) → `loading` (refresh mode) → `result`.

The state is a discriminated union in [`src/App.tsx`](src/App.tsx). When adding new views, add the variant there and handle each branch.

## Conventions

- TypeScript strict. Discriminated unions over boolean flags.
- Tailwind v4 with `@theme` tokens defined in [`src/index.css`](src/index.css). No CSS modules, no styled-components.
- Brand colour tokens: `brand-*` (vivid blue, `#275BFF` base), `ink-*` (navy text, `#1A2233` base), `paper-*` (cool off-white, `#F2F4F7` base), `accent-*` (teal, `#20C4C7` base). The semantic green/red on the answer card uses Tailwind's built-in `emerald-*` / `red-*` — those mean "go / stop" and shouldn't be rebrand-overridden.
- Fonts: Fraunces 700/800 for headings + brand, Inter 400–700 for body.
- File naming: `PascalCase.tsx` for components, `kebab-case.ts` (no, lowercase no-hyphen) for libs.
- Async errors: `throw new Error('message')` with a user-facing string. The Lambda handler maps it to a JSON `{ error }` response. The frontend `claude.ts` re-throws so the App's `'error'` view can display it.
- Storage: any new persisted shape goes in `src/types.ts` and gets a corresponding helper in `src/lib/storage.ts`. Bump the localStorage key (`parkproof.sessions.v1` → `v2`) if you change the saved shape incompatibly.
- Anonymous-by-default. No user accounts, no email, no login. Sessions are device-local in `localStorage`. If you ever add user accounts, sessions need to migrate to a backend — but don't add the database without a real user-facing trigger.

## AWS resources

| Resource | Name / ID |
|---|---|
| Lambda function | `parkproof-sign-translator` |
| IAM execution role | `parkproof-lambda-role` |
| API Gateway HTTP API | `parkproof-api` (id `tlsmpbft4f`), routes `POST /sign-translate` + `POST /feedback` |
| S3 bucket | `parkproof-app-251800369612` (private; CloudFront OAC only) |
| CloudFront distribution | `E33V8DMM3LQACG` → `parkproof.dsouza.tech` (custom domain via ACM cert in us-east-1) / fallback `d1jmpu2roekssu.cloudfront.net` |
| CloudFront Origin Access Control | `parkproof-oac` (id `E3JE1OX4WHEIWK`) |
| AWS Budgets alarm | `parkproof-monthly` (\$10/mo threshold, emails moltensnake@gmail.com) |

Region: `ap-southeast-2` (Sydney). Account: `251800369612`.

## Deploy scripts

All in `scripts/`. All idempotent. All re-runnable.

| Script | What it does |
|---|---|
| `deploy.sh` | Builds Lambda zip, updates code + env, builds frontend with prod API URL, syncs to S3, invalidates CloudFront, ensures `/feedback` route exists |
| `harden.sh` | One-time: locks API Gateway CORS to CloudFront origin, creates OAC, migrates S3 origin to private REST endpoint |
| `set-throttle.sh [burst] [rate]` | API Gateway rate limits (default 20 burst / 10 rate per sec) |
| `billing-alarm.sh [email] [threshold]` | AWS Budgets monthly alarm |
| `teardown.sh [--confirm]` | Destroys everything (dry-run by default) |

## CloudWatch logs

Two structured log prefixes worth knowing:

- `[parkproof]` — per-request timing: `preflight=Nms model=X tz=Y image_b64_len=Z mode=translate|refresh`, then `anthropic_call=Nms stop=... usage={...}`, then `parse=Nms total=Nms`.
- `[parkproof.feedback]` — Feedback events. Layer 1 fields: `{verdict, feedback_id, timestamp}`. Layer 2 (additive — old clients still work without these): `{confidence, had_clarification, chosen_label, duration_minutes, observations_count, rules_excerpt, scanned_hour_local, is_refresh}`.

**Useful Logs Insights queries** (log group `/aws/lambda/parkproof-sign-translator`):

```
# Layer 1 — Verdict counts (overall accept rate)
fields @timestamp, @message
| filter @message like "[parkproof.feedback]"
| parse @message /"verdict":"(?<verdict>[a-z]+)"/
| stats count() as events by verdict
```

```
# Layer 2 — Retake rate by model confidence
# Surfaces "wrongly-confident" failures: high confidence + retake = prompt regression.
fields @timestamp, @message
| filter @message like "[parkproof.feedback]"
| parse @message /"verdict":"(?<verdict>[a-z]+)"/
| parse @message /"confidence":"(?<confidence>[a-z]+)"/
| stats count() as events, sum(verdict = 'retake') as retakes by confidence
| display confidence, events, retakes, retakes / events * 100 as retake_pct
```

```
# Layer 2 — Failure rate by hour of day (lighting / night-scan diagnostics)
fields @timestamp, @message
| filter @message like "[parkproof.feedback]"
| parse @message /"verdict":"(?<verdict>[a-z]+)"/
| parse @message /"scanned_hour_local":(?<hour>\d+)/
| stats sum(verdict = 'retake') as retakes, count() as total by hour
| sort hour
```

```
# Layer 2 — Top failing rule patterns (where to focus prompt work)
fields @timestamp, @message
| filter @message like "[parkproof.feedback]"
| filter @message like "\"verdict\":\"retake\""
| parse @message /"rules_excerpt":"(?<rules>[^"]+)"/
| stats count() as retakes by rules
| sort retakes desc
| limit 20
```

```
# Layer 2 — Does clarification (stacked / arrow signs) increase retake rate?
fields @timestamp, @message
| filter @message like "[parkproof.feedback]"
| parse @message /"verdict":"(?<verdict>[a-z]+)"/
| parse @message /"had_clarification":(?<clarified>(?:true|false))/
| stats count() as events, sum(verdict = 'retake') as retakes by clarified
| display clarified, events, retakes, retakes / events * 100 as retake_pct
```

```
# Translate latency over time
fields @timestamp, @message
| filter @message like "anthropic_call="
| parse @message /anthropic_call=(?<ms>\d+)ms.*?mode=(?<mode>\w+)/
| stats avg(ms), p90(ms), max(ms) by bin(1h), mode
```

## Gotchas

- **vestauth on Windows.** A third-party tool wraps `dotenv` and stops it from populating `process.env`. `vite.config.ts` explicitly assigns parsed values to `process.env`. **Don't remove that block.**
- **`vite.config.ts` lives in `node_modules/.vite-temp/...` at runtime.** Vite compiles the config to a temp file, so `process.cwd()` ≠ the project root reliably and `__dirname` points at the temp dir. The dotenv loader walks up from `import.meta.url` to find `.env`.
- **Haiku 4.5 doesn't support adaptive thinking.** Tried, failed with `400 invalid_request_error`. Also doesn't support extended thinking (`budget_tokens`). Without thinking it gets multi-rule time math wrong on stacked signs. Stay on Sonnet 4.6 for now.
- **`effort: low` works on Sonnet 4.6 / Opus 4.6+ only — NOT on Haiku 4.5 or Sonnet 4.5.** Will 400. If you ever switch models, remove or adjust.
- **AWS CLI on Windows is at `/c/Program Files/Amazon/AWSCLIV2/aws.exe`.** All deploy scripts prepend that to PATH explicitly. Don't break that.
- **Git Bash on Windows path-mungs leading `/` in AWS CLI args.** Use `MSYS_NO_PATHCONV=1` when calling `aws logs ...` with log-group names that start with `/aws/lambda/...`.
- **Git Bash temp files don't work with the Windows `aws.exe`.** `mktemp` creates `/tmp/...` paths that the Windows binary can't read. Use project-relative paths for any file you'll pass via `file://` (e.g. `cloudfront-config.tmp.json`).
- **No `zip` on Windows Git Bash by default.** The deploy script falls back to PowerShell `Compress-Archive`.
- **Image quota.** `localStorage.setItem` throws `QuotaExceededError` if total stored data exceeds ~5MB. `src/lib/image.ts` resizes to ≤1200px @ 0.82 JPEG before storage. **Don't remove this** — raw phone photos break the save flow within 1–2 sessions.
- **`output_config.format` + small `max_tokens` truncates.** Adaptive thinking shares the budget. 2048 is too low; 16384 handles two-variant signs comfortably. The handler surfaces `stop_reason === 'max_tokens'` as a useful error rather than a JSON-parse failure.
- **`.ics` description newlines.** Use `'\n'` (one backslash) — `'\\n'` writes literal `\n` text into the calendar event. The `ics` package handles RFC-encoding.
- **Desktop browser geolocation is unreliable.** Chrome returns IP-based coords that can be kilometres off. `SignScanner` treats `accuracy > 100m` as "no usable GPS" and falls back to the manual `RecentScansPicker`.
- **CloudFront update propagation takes 3–10 min** but the old origin keeps serving. Bucket policy + BlockPublicAccess changes are immediate. Plan the order so the live site doesn't break during a migration.
- **Social platforms (iMessage, LinkedIn, Slack) cache OG images aggressively.** After updating `og-image.png`, force refresh via each platform's debugger or share with `?v=N` to bust the cache.
- **Sonnet 4.6's `prompt-caching` minimum is 2048 tokens.** Our system prompt is currently ~1700 tokens — below threshold, so caching never activates. If you grow the prompt past 2048, caching will kick in for free and shave ~0.5–1s per warm call.

## Where things are

```
src/App.tsx                                    ← view-state machine
src/types.ts                                   ← shared types
src/index.css                                  ← Tailwind @theme + body bg + cavalcade pattern
src/components/SignScanner.tsx                 ← camera/library + silent GPS + reuse card + picker
src/components/Clarify.tsx                     ← position chooser
src/components/ParkingResult.tsx               ← answer card + observations + verify + feedback wiring
src/components/SessionLogger.tsx               ← GPS + reverse-geocode + address edit + car photo
src/components/ReminderOptions.tsx             ← .ics + browser notification
src/components/SessionHistory.tsx              ← list + empty state illustration
src/components/SessionDetail.tsx               ← single session + PDF export + delete
src/components/BrandMark.tsx                   ← inline SVG layered-P + clock logo
src/components/Icon.tsx                        ← 8-icon stroke set, currentColor
src/components/LoadingProgress.tsx             ← stepped progress UI
src/components/ReuseCard.tsx                   ← proximity-matched smart-rescan card
src/components/RecentScansPicker.tsx           ← desktop / no-GPS smart-rescan fallback
src/lib/claude.ts                              ← translateSign + refreshInterpretation
src/lib/feedback.ts                            ← submitFeedback (fire-and-forget)
src/lib/storage.ts                             ← localStorage CRUD + quota handling
src/lib/geocode.ts                             ← Nominatim reverse + forward
src/lib/geo.ts                                 ← Haversine distance
src/lib/image.ts                               ← canvas resize + JPEG re-encode
src/lib/ics.ts                                 ← .ics generator
src/lib/notifications.ts                       ← Notification API scheduler
src/lib/pdf.ts                                 ← evidence PDF with caption overlay
src/lib/time-format.ts                         ← relative-time helper
src/tz-lookup.d.ts                             ← ambient module declaration
lambda/index.js                                ← translateSign (vision + refresh) + feedback + AWS handler
lambda/index.d.ts                              ← types for dev-side import
vite.config.ts                                 ← API middlewares + .env loader + PWA plugin
public/parkproof-icon.svg                      ← source for all generated PWA install sizes
public/parkproof-wordmark.svg                  ← horizontal lockup
public/parkproof-icon-mono.svg                 ← single-colour variant
public/parkproof-splash.svg                    ← portrait splash for PWA install
public/hero-illustration.svg                   ← home-screen scene
public/empty-history.svg                       ← parking-bay empty state
public/cavalcade-pattern.svg                   ← repeating background pattern (body bg)
public/og-image.png                            ← social share card (1200×630)
public/icons/*.svg                             ← stroke icons (camera, gallery, etc.)
archive/old-melbourne-civic/                   ← first-round assets, archived
scripts/deploy.sh                              ← day-to-day deploy
scripts/harden.sh                              ← one-time security pass
scripts/set-throttle.sh                        ← API throttle limits
scripts/billing-alarm.sh                       ← AWS Budgets alarm
scripts/teardown.sh                            ← destroy everything (dry-run by default)
```

## Status

- ✅ Feature 1 — Sign translator
- ✅ Clarification step for position-dependent signs (bonus UX)
- ✅ Feature 2 — Session logger (GPS + reverse geocode + editable address + car photo)
- ✅ Feature 3 — Reminders (`.ics` + browser notification)
- ✅ Feature 4 — Evidence PDF export
- ✅ Feature 5 — Session history + detail + delete
- ✅ PWA — manifest + service worker + install icons in all sizes + Apple splash
- ✅ AWS deploy — Lambda + API Gateway + S3 + CloudFront in `ap-southeast-2`
- ✅ Security hardening — CORS lockdown, OAC, private bucket, throttle, billing alarm
- ✅ Code-split — jsPDF and ics lazy-loaded; main bundle ~225KB
- ✅ Timezone-aware — derived from coords via `tz-lookup`
- ✅ Photo resize — keeps localStorage under quota
- ✅ Smart re-scan — proximity-matched card + desktop picker; refresh-mode API path
- ✅ Stepped loading state
- ✅ Brand identity — layered-P + clock, blue/navy/teal, Fraunces serif
- ✅ AI feedback Layer 1 — verdict events to CloudWatch
- ⏳ Web Push background notifications — needs service worker push subscription + scheduler + DB
- ⏳ Database (DynamoDB + S3 photos) — deliberately deferred; no user-facing trigger yet
- ⏳ AI feedback Layer 2 (diagnostic capture) + Layer 3 (training data)
- ⏳ Cryptographic evidence signing
- ⏳ Voice confirmation (Web Speech API)
- ⏳ Council-specific appeal deep-links
