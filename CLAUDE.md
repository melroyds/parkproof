# CLAUDE.md — ParkProof engineering notes

Quick context for AI assistance on this codebase. Read this before touching things.

## What this is

Mobile-first installable PWA. Photograph an Australian parking sign → Claude vision answers "can I park now?" with structured JSON → optionally log a session (car photo + GPS + address) → get a `.ics` calendar reminder or in-tab browser notification → later, export the session as a PDF for an infringement dispute.

Live: <https://www.parkproof.com.au> (custom domain on Cloudflare DNS, CloudFront-fronted). Apex `parkproof.com.au` and both forms of `parkproof.au` 301-redirect to the canonical via Cloudflare Page Rules. Old domain `parkproof.dsouza.tech` kept as fallback for ~7 days post-cutover. Hosted on AWS in `ap-southeast-2`.

See [`parkproof-spec.md`](parkproof-spec.md) for the original product brief, [`README.md`](README.md) for the user-facing version, and [`docs/lessons-for-next-project.md`](docs/lessons-for-next-project.md) for the portable takeaways doc — what 8-day-me learned that the *next* project should carry forward.

## Run it

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env   # required
npm run dev   # → http://localhost:5173
```

## How the backend works

There is **one** Lambda function (`parkproof-sign-translator`) handling thirteen HTTP routes via path dispatch in [`lambda/index.js`](lambda/index.js):

**Anonymous routes** (no auth required):

| Route | Handler | Purpose |
|---|---|---|
| `POST /sign-translate` | `handleSignTranslate` → `translateSign({...})` | Two modes, inferred from request body — see below. Fresh-image mode is **async** (returns 202 + `job_id`) |
| `GET /sign-translate/status/{job_id}` | `handleJobStatus` | Poll target for the async sign-translate job — returns `{status, result, error}` |
| `POST /draft-appeal` | `handleDraftAppeal` | Vision read of an infringement notice + Claude draft of a formal appeal letter. **Async** (returns 202 + `job_id`) |
| `GET /draft-appeal/status/{job_id}` | `handleJobStatus` | Poll target for the async draft-appeal job |
| `POST /sign-session` | `handleSignSession` | KMS-backed ECDSA P-256 signature over the canonical session metadata |
| `POST /feedback` | `handleFeedback` | Layers 1 + 2 telemetry: logs `[parkproof.feedback]` events to CloudWatch with verdict + model context (confidence, sign-pattern, hour, etc.) |
| `POST /user-feedback` | `handleUserFeedback` | Free-text user feedback (distinct from AI-verdict above). Logs `[parkproof.user_feedback]` to CloudWatch + mirrors record to S3 bucket `parkproof-user-feedback-*` at `YYYY-MM-DD/{uuid}.json`. Anonymous; no JWT. |

**JWT-authenticated routes** (Cognito-issued access token, verified by API Gateway authorizer before Lambda runs — see [`lambda/cloud-sync.js`](lambda/cloud-sync.js)):

| Route | Handler | Purpose |
|---|---|---|
| `POST /sessions/upload` | `handleSessionsUpload` | Persist a session record to DynamoDB scoped to the JWT's `sub` claim |
| `GET\|POST /sessions/list` | `handleSessionsList` | List the caller's sessions |
| `POST /sessions/delete` | `handleSessionsDelete` | Delete one session (the caller's) by ID + cascade-delete its S3 photos |
| `POST /photos/presign` | `handlePhotosPresign` | Mint a short-TTL presigned `PUT` URL into the user's prefix on the evidence bucket — browser uploads the photo directly |
| `GET\|POST /me/export` | `handleMeExport` | Stream every session belonging to the caller as a single JSON export |
| `POST /me/delete` | `handleMeDelete` | Wipe all of the caller's data: DDB rows, S3 photos, Cognito user record |

`translateSign` itself has **two modes** controlled by what the body contains:

1. **Fresh translate** — body has `image_base64`. Sends the image + current-time context to Claude vision. Returns full `ParkingRules` JSON. **Async-only**: enqueues a job and returns 202 + `job_id` immediately. The slow Claude call runs in a self-invoked Lambda; the client polls `/sign-translate/status/{job_id}`.
2. **Refresh** (smart re-scan) — body has `prior_rules` + `prior_observations` instead of `image_base64`. No vision call; pure text-only reasoning about whether the previously-read rules still allow parking right now. ~3× faster, ~4× cheaper. **Synchronous** — fast enough to fit the API Gateway 30s window, so it just returns the result inline (the `postJsonAndPoll` helper transparently handles both shapes). Triggered from the frontend when the user reuses a saved session.

**Async-polling architecture** (`POST /sign-translate` + `POST /draft-appeal`):

Stacked Melbourne signs (Clearway + multi-arrow + accessibility + meter) take Claude 30–50s to read carefully. API Gateway HTTP API has a hard 30s timeout — the live site was returning `{"message":"Service Unavailable"}` on complex signs. Pivoted to async polling rather than fighting the gateway:

1. Client `POST`s body → Lambda writes a `pending` row to `parkproof-jobs` (DDB, TTL 600s), self-invokes asynchronously with `InvocationType: 'Event'`, returns `202 { job_id, status: 'pending' }` in <1s.
2. Worker invocation runs the actual Claude call. On finish (success or error) it updates the DDB row to `done` / `error` with the result/error.
3. Client polls `GET /sign-translate/status/{job_id}` every 1.5s. Each poll is a single DDB `GetItem` (sub-second), well within the gateway window.
4. On `status: 'done'` the client treats the `result` field exactly as if it had been the original sync response. The legacy retry-on-5xx layer in `postJsonWithRetry` still wraps the enqueue call.

Job rows are scoped by random UUID — `job_id` itself is the bearer credential for the status endpoint, so no auth is needed. DDB TTL (`expires_at`) sweeps rows 10 minutes after creation. The dispatcher in `handler()` routes on `event._async_kind` (worker invocation) → `path.includes('/status/')` (status read) → normal route lookup.

The Lambda is **reused as the local dev proxy** via a Vite plugin in [`vite.config.ts`](vite.config.ts) that intercepts all `/api/*` routes, dynamically imports `lambda/index.js`, and calls the same code paths. Same code in dev and prod — never call the Anthropic API from the browser, the key must stay server-side.

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
- Storage: any new persisted shape goes in `src/types.ts` and gets a corresponding helper in `src/lib/storage.ts`. Bump the localStorage key (`parkproof.sessions.v1` → `v2`) if you change the saved shape incompatibly. **Additive** fields (e.g. the recent `ended_at` driver-signalled end-of-session timestamp) are forward-compatible and don't require a key bump — old saved sessions just lack the field, which all readers handle as "session has not been explicitly ended".
- Active-session derivation lives in `loadActiveSessions(now)` in `storage.ts` — three states feed it: `ended_at` ⇒ never active (regardless of expiry); `expires_at > now` ⇒ active (sorted soonest first); `no_sign` with no `ended_at` ⇒ open-ended-active (sorted most-recent first, placed after expiry-bearing sessions). The home `ActiveSessionCard` + the per-session `SessionDetail` both expose an "I've left" action that stamps `ended_at = now()` via the `endSession(id)` helper and mirrors to cloud when signed in.
- **Anonymous-by-default, opt-in cloud.** No login wall — sessions are always device-local in `localStorage` first, and every feature works without an account. If the user *chooses* to sign in (Cognito email/password or Apple/Google federation), the same sessions opportunistically mirror to DynamoDB + S3 evidence bucket via the `/sessions/*` and `/photos/*` routes. The local copy stays the source of truth; cloud is durability + cross-device recovery. Never gate functionality behind sign-in.

## AWS resources

| Resource | Name / ID |
|---|---|
| Lambda function | `parkproof-sign-translator` |
| IAM execution role | `parkproof-lambda-role` (DDB + S3-evidence + KMS-sign + Cognito-admin permissions) |
| API Gateway HTTP API | `parkproof-api` (id `tlsmpbft4f`); 18 routes — 10 anonymous (incl. 2 async-job status GETs + `/push/{subscribe,schedule,cancel}`) + 8 JWT-gated (GET + POST variants on `/sessions/list` and `/me/export`). Hard 30s timeout per HTTP API; the slow Claude routes (`/sign-translate`, `/draft-appeal`) bypass it via async polling (see "Async-polling architecture" above). `src/lib/api.ts` still catches transient 5xx with one auto-retry and a friendly "complex sign" message as the final fallback. |
| DynamoDB table — async jobs | `parkproof-jobs` (PK = `job_id`); TTL on `expires_at` (10-min sweep). Holds the `pending` / `done` / `error` status + `result` payload for every fresh `sign-translate` / `draft-appeal` request. |
| API Gateway JWT authorizer | id `t1utm6`, issuer = Cognito User Pool |
| Cognito User Pool | `ap-southeast-2_fBbsYa7VM` |
| Cognito App Client | `5ldgcdf1qol1qje9h55inl9pq9` |
| Cognito Hosted UI domain | `parkproof-251800369612.auth.ap-southeast-2.amazoncognito.com` (Apple + Google federation wired in) |
| Apple Sign-in identifiers | App ID `au.com.parkproof.app` + Services ID `au.com.parkproof.signin` + Key ID `43627FRVZ2` (Team `L89J489GL4`). Rotated 2026-05-22 from the original `tech.dsouza.parkproof` set to strip personal identity from the OAuth consent screen. Old Key 5N98KL6J88 + old Services ID + old App ID safe to revoke in Apple Developer Console once you're confident nothing's broken. |
| DynamoDB table | `parkproof-sessions` (PK = `userId`, SK = `sessionId`) |
| S3 bucket — static hosting | `parkproof-app-251800369612` (private; CloudFront OAC only) |
| S3 bucket — evidence photos | `parkproof-evidence-251800369612` (private; per-user `{sub}/` prefixes; presigned `PUT` only) |
| S3 bucket — user feedback | `parkproof-user-feedback-251800369612` (private; date-partitioned `YYYY-MM-DD/{uuid}.json`; 2-year lifecycle expiry; AES256 SSE; Lambda has `s3:PutObject` only). Provisioned via `scripts/setup-feedback-bucket.sh`. |
| KMS asymmetric key | alias `alias/parkproof-evidence-signing` (ECDSA P-256). Public key shipped at `/parkproof-public-key.pem` |
| CloudFront distribution | `E33V8DMM3LQACG` → `www.parkproof.com.au` + legacy `parkproof.dsouza.tech` (both as alt-names) / fallback `d1jmpu2roekssu.cloudfront.net` |
| CloudFront Origin Access Control | `parkproof-oac` (id `E3JE1OX4WHEIWK`) |
| ACM certificate (us-east-1) | `www.parkproof.com.au` + `parkproof.com.au` (`8257fd02-fcc0-4958-a092-7e5a3d07fa57`) DNS-validated CNAMEs on Cloudflare. Legacy cert for `parkproof.dsouza.tech` (`3442f3b7-aa80-40ec-b580-331487b7b0cd`) still issued for the 7-day fallback window. |
| DNS hosting | Cloudflare (`jake.ns.cloudflare.com` + `nova.ns.cloudflare.com` for `parkproof.com.au`; `kenia.ns.cloudflare.com` + `woz.ns.cloudflare.com` for `parkproof.au`). Page Rules handle apex → www redirect (`.com.au`) and both apex + www → canonical (`.au`). Crazy Domains registrar only — DNS migrated off them to dodge their $26/yr URL-forwarding upcharge. |
| Email | Titan (`hello@parkproof.com.au`) — Free Trial expires 20 Jun 2026. MX/SPF/DKIM TXT records in Cloudflare. The role-style alias replaced the original `melroy@…` mailbox so the user-facing surface (Privacy Policy contact, case-study, VAPID subject) carries no personal identity. |
| AWS Budgets alarm | `parkproof-monthly` (\$25/mo threshold, emails moltensnake@gmail.com — raised from \$10 to allow Reddit-day spike without false-alarm noise) |

Region: `ap-southeast-2` (Sydney). Account: `251800369612`.

## Deploy scripts

All in `scripts/`. All idempotent. All re-runnable.

| Script | What it does |
|---|---|
| `deploy.sh` | Builds Lambda zip, updates code + env, builds frontend with prod API URL + Cognito IDs from `.aws-resources`, syncs to S3, invalidates CloudFront, ensures every API route exists + JWT authorizer is attached where needed |
| `setup-auth.sh` | One-time: creates Cognito User Pool + App Client + Hosted UI domain, DynamoDB sessions table, S3 evidence bucket (private + CORS for both `parkproof.dsouza.tech` and the legacy CloudFront origin), API Gateway JWT authorizer. Writes `scripts/.aws-resources` for `deploy.sh` to consume |
| `setup-signing.sh` | One-time: creates the KMS ECDSA P-256 asymmetric key, attaches `kms:Sign` to the Lambda role, exports the public key to `public/parkproof-public-key.pem` for client-side verification |
| `harden.sh` | One-time: locks API Gateway CORS to the allowed origins, creates OAC, migrates S3 origin to private REST endpoint |
| `set-throttle.sh [burst] [rate]` | API Gateway rate limits (default 100 burst / 25 rate per sec — sized for a Reddit launch day; Lambda's account-level concurrency cap of 10 is the actual cost ceiling) |
| `billing-alarm.sh [email] [threshold]` | AWS Budgets monthly alarm |
| `smoke-test-auth.mjs` | End-to-end test of the auth-gated paths: sign-up → upload → list → delete via the live API |
| `screenshots.mjs` | Playwright harness — drives the local app through every screen, regenerates `docs/screenshots/*.png` for the README demo grid |
| `teardown.sh [--confirm]` | Destroys everything (dry-run by default) |

## CloudWatch logs

Two structured log prefixes worth knowing:

- `[parkproof]` — per-request timing: `preflight=Nms model=X tz=Y image_b64_len=Z mode=translate|refresh`, then `anthropic_call=Nms stop=... usage={...}`, then `parse=Nms total=Nms`.
- `[parkproof.feedback]` — Feedback events. Layer 1 fields: `{verdict, feedback_id, timestamp}`. Layer 2 (additive — old clients still work without these): `{confidence, had_clarification, chosen_label, duration_minutes, observations_count, rules_excerpt, scanned_hour_local, is_refresh}`.
- `[parkproof.user_feedback]` — Free-text user feedback (distinct from AI-verdict telemetry above). Fields: `{id, timestamp, message, email, page, user_agent, app_version, locale, sessions_count, is_signed_in}`. Also mirrored to S3 bucket `parkproof-user-feedback-{accountId}` at `YYYY-MM-DD/{uuid}.json` for 2-year retention. See `scripts/setup-feedback-bucket.sh` for bucket provisioning (lifecycle, encryption, IAM).
- `[parkproof.user_feedback.s3_error]` — Rare: indicates the S3 mirror failed (IAM, transient, or bucket env var unset). CloudWatch still has the record. Fix the IAM if you see these.

**Useful Logs Insights queries** (log group `/aws/lambda/parkproof-sign-translator`):

```
# Free-text user feedback — read the actual messages
# Most useful query during a launch window. Sort newest first; truncate
# message to ~200 chars for the dashboard view.
fields @timestamp, @message
| filter @message like "[parkproof.user_feedback]"
| parse @message /"message":"(?<msg>[^"]+)"/
| parse @message /"email":"(?<email>[^"]+)"/
| parse @message /"page":"(?<page>[^"]+)"/
| sort @timestamp desc
| display @timestamp, page, email, msg
| limit 50
```

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
- **CI installs root deps only — `lambda/node_modules` doesn't exist by default.** `lambda/refresh.test.js` imports `lambda/index.js` which transitively pulls in `@aws-sdk/client-{kms,dynamodb,s3,lambda}` etc — those packages live in `lambda/package.json`, NOT root. Without an explicit `npm ci` in `lambda/` during CI, every AWS SDK import fails to resolve before any test runs. The `.github/workflows/test.yml` has an explicit "Install lambda dependencies" step for this. If you add another subdirectory with its own `package.json` (e.g. a future `worker/` or `infra/`), it needs the same treatment.
- **happy-dom wraps `localStorage` in a Proxy that defeats `vi.spyOn`.** Spies installed via `vi.spyOn(localStorage, 'setItem')` don't reliably restore between tests (the previous test's quota-throw mock leaks into the next test's `localStorage.setItem(...)` seed). Direct assignment (`localStorage.setItem = fn`) is also blocked by the Proxy's set trap. `src/lib/storage.test.ts` works around this by swapping in a custom `Storage`-shaped object via `Object.defineProperty(globalThis, 'localStorage', ...)` for the test file's lifetime. Use that pattern whenever you need to simulate quota errors or other Storage misbehaviour.
- **`vi.mock` with arrow-fn constructors fails.** Anthropic SDK does `new Anthropic(...)` — if your mock factory returns `vi.fn().mockImplementation(() => ({...}))` with an arrow function inside, Node throws `is not a constructor`. Use a real class form (`class MockAnthropic { constructor() { this.messages = {...} } }`) instead. See `lambda/refresh.test.js`.
- **Cognito `update-identity-provider` rejects keys passed via inline `--provider-details` shorthand.** The flattened `\n`-separated private key works in `create-identity-provider` (which is what `setup-auth.sh` and `docs/federation-setup.md` Step 5 originally used), but `update-identity-provider` won't accept the same string — it returns `InvalidParameterException: Provided private key cannot be used for Sign in with Apple`. Workaround: write the provider-details to a project-relative JSON file with real `\n` escape sequences and pass `--provider-details file://apple-idp.tmp.json`. See the "Rotating the Apple Bundle ID" section in `docs/federation-setup.md` for the full pattern. Burned ~5 min on this during the 2026-05-22 rotation.
- **Cloudflare's auto-DNS-import skips underscore-prefixed records.** When migrating DNS from another provider, the ACM cert validation CNAMEs (which always start with `_`) won't carry over — you have to manually add them in Cloudflare before flipping nameservers, or the cert silently fails to auto-renew in 12 months.
- **Crazy Domains' CNAME validator rejects trailing dots and is strict about underscores.** Paste CNAME values WITHOUT the trailing `.` and the underscore-prefixed records (ACM validation, etc.) will go through. Their DNS panel batches writes — needs an explicit "Update Status" click to publish "Pending" records to their authoritative nameservers.
- **Crazy Domains charges $26/yr per domain for URL forwarding.** Cloudflare's free tier provides equivalent 301 redirects via Page Rules + Redirect Rules. The migration is ~30-60 min nameserver propagation; saves ~$52/yr on the two-domain setup. Plus you get apex CNAME flattening for free if you ever want `https://parkproof.com.au` (no www) as canonical.

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
- ✅ Photo-quality pre-check — blur + brightness pre-flight before any token spend
- ✅ Restriction-transition heads-up — banner when a rule change is within ~3 hours
- ✅ Feature 2 — Session logger (GPS + reverse geocode + editable address + car photo)
- ✅ Feature 3 — Reminders — multi-offset picker + `.ics` (multi-VALARM) + in-tab browser notification
- ✅ Feature 4 — Evidence PDF export (caption overlay, signature appendix when present)
- ✅ Feature 5 — Session history + detail + delete
- ✅ Driver's note — 280-char free-text per session, rendered verbatim in PDF
- ✅ Live "Currently parked" home — countdown card colour-coded by urgency; explicit "I've left" affordance ends the session and stamps `ended_at`
- ✅ No-sign open-ended sessions — sessions logged without a sign stay active on home until the driver signals "I've left" (mandatory there; optional shortcut on expiry-bearing sessions when leaving early)
- ✅ Walk-back navigation — distance + ETA + Apple/Google Maps deep-link
- ✅ AI-drafted appeal letter — ticket photo → Claude draft → editable + PDF export
- ✅ Cryptographic evidence signing — KMS ECDSA P-256 + openssl-verify walkthrough in PDF
- ✅ Background signing retry — sessions self-heal if signing fails mid-flight
- ✅ Cloud sync (opt-in) — Cognito + DynamoDB + S3 evidence bucket, anonymous-by-default still works without sign-in
- ✅ Federated auth — Apple + Google via Cognito Hosted UI
- ✅ Account export + delete — full data dump as PDF; full wipe of DDB rows + S3 photos + Cognito user
- ✅ PWA — manifest + service worker + install icons in all sizes + Apple splash
- ✅ AWS deploy — Lambda + API Gateway + S3 + CloudFront in `ap-southeast-2`
- ✅ Custom domain — `parkproof.dsouza.tech` via ACM + CloudFront alternate name
- ✅ Security hardening — CORS lockdown, OAC, private bucket, throttle, billing alarm
- ✅ Code-split — jsPDF, ics, html2canvas, and non-English locale chunks lazy-loaded; main bundle ~100KB gzipped
- ✅ Timezone-aware — derived from coords via `tz-lookup` (display + PDF + .ics)
- ✅ Photo resize + 3-phase quota auto-recovery — keeps localStorage under quota
- ✅ Smart re-scan — proximity-matched card + desktop picker; refresh-mode API path
- ✅ Stepped loading state
- ✅ Brand identity — layered-P + clock, blue/navy/teal, Fraunces serif
- ✅ Multi-lingual UI — 7 languages (en, zh-CN, vi, it, el, hi, pa) including PDF strings
- ✅ AI feedback Layers 1 + 2 — verdict events + model context (confidence, hour, sign-pattern) to CloudWatch
- ⏳ True Web Push background notifications — needs service worker push subscription + server-side scheduler (EventBridge)
- ⏳ AI feedback Layer 3 — opt-in photo capture for systematic failures, building a private training dataset
- ⏳ Citywide parking heatmap — every scan captures the data; needs share-toggle, viewer, cold-start solved
- ⏳ Voice confirmation (Web Speech API)
- ⏳ Council-specific appeal deep-links (auto-submit) — blocked by council-side captchas + no public APIs
