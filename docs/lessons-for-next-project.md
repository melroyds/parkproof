# Lessons from ParkProof — for the next project

A self-contained takeaways doc. Carry into the next portfolio piece (or real product) so you don't relearn what 10-day-me already paid for.

Skim the table of contents, jump to the bit you need.

---

## TL;DR if you're reading this in a hurry

1. **Sequencing beats stack.** Order matters more than tooling choice. Tier-A user-facing features ship before infra pivots. Telemetry ships before traffic. Tests ship before architecture experiments. *Order is a craft skill — practise it.*
2. **The right pivot makes the system simpler, not cleverer.** When the first attempt fails, the second attempt should remove components, not add them. (Day 5's async-polling rewrite was less code than the CloudFront-OAC + Cognito-Identity-Pool attempts that preceded it.)
3. **Commit hygiene IS product thinking made visible.** Conventional-commits scope, band-aid → real-fix preserved (not squashed), docs commits interleaved with feature commits. Hiring managers can see your decomposition through the git log.
4. **AI integration is testable — at the contract layer, not the inference layer.** Mock the SDK, assert request shape (system prompt content, schema enforcement, refresh-mode branching). Don't test the model's reasoning in CI; that's the live site's job.
5. **Build journals are useful WITHIN the build window, not after.** Write the post-mortem while the dead ends are still raw. Otherwise they get softened into a tidy success story and lose their value.
6. **Anonymous-by-default is a real design principle.** Every feature should work without a login wall. Cloud sync is opt-in, never gated.
7. **Cost the cheap features carefully. Skip the expensive ones decisively.** Cloudflare free tier ate every "advanced DNS" feature a registrar would have charged $26-50/yr for. Same pattern repeats with auth (Cognito free 50k MAU), storage (S3 + DDB pennies at portfolio scale), AI (Sonnet 4.6 prompt caching = free latency cut).

---

## Stack choices that paid off

### React + TypeScript + Tailwind v4 + Vite + PWA

- **React 19 strict** — no class components, hooks throughout.
- **TypeScript strict** — discriminated unions over boolean flags. View states as `{ name: 'home' } | { name: 'scan' } | ...` instead of multiple booleans.
- **Tailwind v4 `@theme`** — brand tokens in CSS, not JS config. Faster IDE, smaller config surface.
- **Vite** — the dev-server-as-API-gateway pattern (Vite middleware intercepts `/api/*` and dynamically imports the same Lambda code that runs in prod) is gold. Zero parity drift between dev and prod.
- **PWA via `vite-plugin-pwa`** — installable, offline-capable, no app-store gatekeeping. Manifest + service worker generated at build time.

### AWS serverless (Lambda + API Gateway + DynamoDB + S3 + KMS + Cognito + CloudFront)

- **One Lambda handling 18 routes via path dispatch.** Cold-start cost paid once, deployment surface stays tiny. Don't split into multiple functions at portfolio scale. By launch the same function also handles two non-HTTP invocation modes (self-invoked async worker for slow Claude calls, EventBridge Scheduler target for one-shot push dispatch) — still one cold-start budget.
- **DynamoDB single-table** for sessions; `PK = userId, SK = sessionId`. Indexes only when needed.
- **S3 + OAC + CloudFront** for static hosting. Private bucket, OAC-only access. ACM cert in us-east-1 (mandatory for CloudFront), DNS-validated CNAME.
- **KMS asymmetric (ECDSA P-256)** for evidence signing. Private key never leaves AWS; public key shipped at `/parkproof-public-key.pem`. The `openssl-verify` walkthrough in the evidence PDF means a third party can verify offline. *Almost no MVPs do this — it disproportionately impresses.*

### Cloudflare for DNS + redirects

- **Free tier covers everything you actually need.** Unlimited zones, unlimited DNS records, Page Rules + Redirect Rules, DDoS, analytics, CNAME flattening at apex.
- **Migration from a budget registrar takes ~30-60 min** including nameserver propagation. The "24-48h" you'll read about is a worst case that rarely happens.

### Anthropic Claude (Sonnet 4.6) with adaptive thinking + JSON schema enforcement

- **`thinking: { type: 'adaptive' }`** is mandatory for multi-rule reasoning (e.g., "compute leave-by per rule, take the earliest"). Haiku 4.5 doesn't support thinking — it gets multi-rule math wrong.
- **`output_config: { format: { type: 'json_schema', schema: SCHEMA }, effort: 'low' }`** — schema-enforced output means the model literally cannot return malformed JSON.
- **`cache_control: { type: 'ephemeral' }`** on the system prompt — once you cross 2048 tokens, warm calls within 5 minutes read from cache and shave ~0.5-1s per call.
- **Layered telemetry** — Layer 1 (verdict events) tells you *whether* there's a problem; Layer 2 (model confidence, rules excerpt, hour-of-day, payment methods detected) tells you *which kind*.

---

## Stack choices to avoid

### Anything that requires apex DNS at a budget registrar

If your project needs `https://yourproject.com` (no `www`) as canonical, you need **ALIAS records or CNAME flattening at the apex**. Budget registrars (Crazy Domains, Network Solutions, GoDaddy basic) don't support either. Workarounds are paid-tier upgrades or hacky.

**Solution**: just use Cloudflare for DNS from day 1, regardless of where you registered. Free, supports flattening, supports underscore records, supports Page Rules.

### Haiku 4.5 for anything requiring multi-rule reasoning

Cheaper but breaks. No adaptive thinking, no extended thinking. Try Sonnet 4.6 first; only downgrade if you can prove the task doesn't need reasoning.

### Lambda Function URL + AuthType=NONE

Returns 403 on otherwise-perfectly-configured accounts with no SCPs/RCPs/PAB visible. A known AWS quirk. **Use API Gateway HTTP API instead**, or CloudFront-fronted Function URL with `AuthType=AWS_IAM` if you really need a Function URL.

### Cognito Identity Pool + anonymous sigv4 for unauthenticated access

Same family of mysterious 403s. Just front anonymous routes with plain API Gateway.

### Registrar-bundled "URL Forwarding" features that cost money

Cloudflare free tier replaces all of them. Don't pay $26+/yr for what's free elsewhere.

### Email forwarding for user feedback

Tempting because it feels personal ("their messages will email me!"). **Don't do this**. A successful launch produces 50-200 messages per day; an email firehose fatigues you fast. Use CloudWatch + S3 with a Logs Insights query for reading. SES integration is a 10-line addition if you change your mind.

---

## Testing patterns that work

### What to test

1. **Pure functions with non-obvious edge cases** — time formatting around DST, distance calculations at the 1000m boundary, quota-recovery state machines.
2. **The model's request shape, NOT its responses** — for AI integrations, mock the SDK and assert system prompt content (especially regression tests for prompt fixes), schema enforcement, request parameters.
3. **The handler's input/output contract** — does it return the right error code for the right input, does it persist what it claims to persist.

### What NOT to test

1. **React component rendering details** — snapshot tests are low signal, high churn.
2. **Live API calls** — flaky, slow, costs money. Use contract tests with mocked SDK.
3. **Trivial getters** — coverage % chasing is anti-portfolio.

### Critical gotchas

- **`vi.spyOn` doesn't reliably restore on Proxy-wrapped globals** (e.g. happy-dom's `localStorage`). Use a custom global swap pattern: `Object.defineProperty(globalThis, 'localStorage', { value: fakeImpl, configurable: true })`.
- **Mock SDK constructors as real classes**, not arrow-function factories. `new Anthropic({apiKey})` requires a constructable.
- **CI installs root deps only.** If your repo has subdirectory `package.json` files (e.g., `lambda/`, `worker/`, `infra/`), CI needs explicit `npm ci` steps for each.

### Test surface sizing for a 10-day portfolio MVP

~100-150 tests across 5-6 risk-targeted files is the right size. More is anti-portfolio. Less is amateur. Aim for:

- 1 file per "this is the kind of thing that silently breaks" surface (time math, storage, distance, API client, prompt regressions)
- ~20-30 cases per file
- All passing on CI on every push

### CI badge

Worth two hours of writing tests on its own. A green tests badge on the README is the single highest-signal thing a recruiter sees in 5 seconds.

---

## Deployment + ops patterns

### Idempotent scripts everywhere

`scripts/setup-auth.sh`, `scripts/setup-signing.sh`, `scripts/harden.sh`, `scripts/setup-feedback-bucket.sh` — all idempotent. Re-runnable. They check for existing state and skip if present.

**Pattern**: every "AWS provisioning" script writes its bucket / table / pool / etc. names into `scripts/.aws-resources`, which the deploy script sources. New env vars flow through automatically.

### Deploy script tells you what's going to happen

Print the bucket name, the API URL, the CloudFront ID, the env vars being injected — before doing anything destructive. Failure mode: silent overwrite of something important. Print first, ask forgiveness never.

### Telemetry-first design

Before shipping a feature, ship the log line for it. The `[parkproof.user_feedback]` CloudWatch prefix + the `[parkproof.feedback]` Layer 2 events were both designed before the corresponding UI. Means: you can debug a launch in real time without grepping prod.

### Friendly errors over raw HTTP details

5xx errors → user sees "this took too long — try a clearer photo". Not "Service Unavailable". `src/lib/api.ts`'s `complexSignMessage()` is the pattern.

### CI verification habit

After every push, **explicitly check CI status** before declaring the work done. Don't trust "should be green". If CI fails on commit N, every subsequent commit piles failure-on-failure invisibly. Cost me 4 commits of silent breakage on this build.

### Vite `base` doesn't rewrite absolute paths in JSX or service workers

When you point a Vite build at a non-root URL — e.g., `base: '/app/'` because you've added a marketing landing at `/` and the app moved under `/app/` — Vite rewrites *build-time references* (HTML `<link>` and `<script>` tags, CSS `url()` calls, PWA manifest icon paths). It does NOT rewrite *runtime string literals* inside JSX (`<img src="/foo.png" />`) or service worker source (`icon: '/pwa-192.png'`). Those are just strings to Vite, and they bake into the bundle unchanged.

**Symptom**: hero images, public-key links, empty-state illustrations all 404 on `/app/` because they're written as `/foo.png` (root) but the assets live at `/app/foo.png`. ParkProof's cutover surfaced 8 such instances (4 JSX, 4 in `src/service-worker.ts`) — all silently wrong post-deploy until manual smoke test.

**Fix pattern**:

```tsx
// JSX — use Vite's exposed base value:
<img src={`${import.meta.env.BASE_URL}hero-illustration.png`} />

// Service workers — relative paths resolve against the SW's URL:
icon: 'pwa-192x192.png',   // SW at /app/sw.js → resolves to /app/pwa-192x192.png
```

**Audit before changing `base`** — grep `src/` for `src="/`, `href="/`, and `'/<filename>.<ext>'` patterns. Each match is a candidate fix. Doing this BEFORE the deploy is much cheaper than finding it AFTER.

### CloudFront with OAC + S3 REST origin doesn't auto-resolve directories

S3 website-mode endpoints resolve `/app/` → `/app/index.html`. S3 REST API endpoints (what CloudFront uses when fronted by OAC for private-bucket security) do NOT. If your app lives at a subpath, plain CloudFront-with-OAC will 403 on directory requests.

**Symptom**: `/app/` returns whatever your `CustomErrorResponses` falls back to (usually `/index.html`), not the React app at `/app/index.html`. Look for `X-Cache: Error from cloudfront` in the response headers.

**Fix**: deploy a CloudFront Function (viewer-request handler) that rewrites trailing-slash URIs:

```javascript
function handler(event) {
    var request = event.request;
    if (request.uri.endsWith('/')) {
        request.uri += 'index.html';
    }
    return request;
}
```

Attach via `FunctionAssociations` in the `DefaultCacheBehavior`. Five-minute propagation, no infrastructure change beyond that. Worth bundling into the `harden.sh`-equivalent for the next project so you don't have to discover this in production.

---

## AI-integration patterns

### Schema-enforce the output

Don't parse free-text from the model. Use the SDK's JSON schema feature (`output_config.format: { type: 'json_schema', schema }`). The model becomes a structured-data API.

### Adaptive thinking for multi-step reasoning

If the prompt asks for "compute X for each rule, take the min", you need thinking. Without it, the model picks one rule and ignores others.

### System prompt as the contract

Treat the system prompt like an API contract. Every shipped fix gets a regression test:

```js
it('includes the EasyPark / payment-method instruction (regression for a2b2b4f)', async () => {
  // ...
  expect(systemText).toMatch(/EasyPark/i)
  expect(systemText).toMatch(/regardless of whether the current time is inside the paid window/i)
})
```

Future-you / future-me will refactor the prompt and accidentally delete a line. The test catches it.

### Layered feedback

- **Layer 1**: verdict (correct / retake). Counts say *whether* there's a problem.
- **Layer 2**: context (confidence, hour-of-day, sign-pattern, payment methods detected). Slices say *which kind* of problem.
- **Layer 3**: opt-in photo capture for systematic failures. Private training data. *(Not yet built on ParkProof — but reserved for when you have real users.)*

### Prompt caching

Sonnet 4.6 caches system prompts ≥2048 tokens for 5 min. Once your prompt grows past that threshold, every warm call within 5 min reads from cache. Free latency cut. Worth designing prompts to land just over 2048 tokens.

### Async-polling for slow inferences

API Gateway HTTP API caps at 30 seconds. Adaptive thinking on a complex input can hit 50s. The fix is **not** to fight the gateway — it's to return 202 + job_id immediately, run the slow call in a self-invoked Lambda, write to a TTL'd DDB table, have the client poll a fast status endpoint.

```
Client → POST /sign-translate
       ← 202 { job_id, status: "pending" }      (in < 1s)
       → GET /sign-translate/status/{job_id}    (every 1.5s)
       ← 200 { status: "done", result: {...} }  (eventually)
```

Each piece is a sub-second DDB roundtrip. The 30s gateway ceiling never gets hit. Lambda's own 60s timeout is the new ceiling.

---

## Process habits

### Build journal in the same week

The 10-day build journal (`docs/parkproof-build-journal.pdf`) was written within hours of each day's commits. The dead ends are still raw — Day 5's CloudFront-OAC failure, Cognito-Identity-Pool failure, then async-polling success. **Most "build retrospectives" are written months later, when the failures have been softened into a clean success story.** The rawness IS the value.

### Commit messages with the "why"

```
fix(prompt): ♿-only bays are parkable (with permit), not a hard block

Spotted live: user picked the Right side of a multi-arrow Pratt St sign
where the right is "2P ♿ Only 7:30am-4pm Mon-Fri". At the spoofed test
time of Thu 10:30am — inside that window — the model returned
can_park_now=FALSE ...
```

Not just *what* changed. *Why* it changed. *What it was before*. *What broke that triggered the fix*. Hiring managers reading the git log get the reasoning for free.

### Conventional Commits is non-negotiable

`feat(scope):`, `fix(scope):`, `docs:`, `chore:`, `test:`. Makes the log scannable. Makes squashed PR titles legible. Makes future you grateful.

### Documentation tier

For a serious portfolio project, you need three doc tiers:

1. **README.md** — what is this, how do I run it, what's the live demo. Audience: anyone landing on the GitHub.
2. **CLAUDE.md** (or similar) — engineering notes, AWS resource IDs, gotchas, file layout. Audience: anyone (including AI assistants) touching the code.
3. **Case study + build journal** — narrative artefacts. Audience: hiring managers, conference reviewers.

Don't conflate them. README isn't the case study. Engineering notes aren't the README.

---

## Cost levers

At portfolio scale (≤1000 users / month):

| Resource | Free tier covers | Becomes paid at |
|---|---|---|
| **AWS Lambda** | 1M requests + 400k GB-sec | ~10k-50k DAU |
| **DynamoDB on-demand** | 25 GB free + 25 WCU/RCU | Heavy writes |
| **S3** | 5 GB free + 20k GET + 2k PUT | Real photo volume |
| **CloudFront** | 1 TB egress + 10M requests | A viral moment |
| **Cognito** | 50k MAU | Significant traction |
| **KMS** | $1/mo per key. Always paid. | n/a |
| **ACM** | Free for CloudFront-bound certs | n/a |
| **Cloudflare DNS + Page Rules** | Unlimited everything | Enterprise-only features |
| **CloudWatch logs** | 5 GB ingestion free | Heavy logging |
| **GitHub Actions** | 2000 min/mo private repo | n/a public |

**ParkProof actual cost**: ~$5-7 AUD/mo at zero real-user traffic. Almost entirely KMS ($1) + domain registration ($30/yr amortised ≈ $2.50/mo) + a tiny bit of CloudWatch + S3.

**Money pits to skip on day 1**:
- Registrar URL forwarding ($26/yr per domain)
- "Premium DNS" tiers
- Cognito advanced security features
- Multi-AZ Aurora (use DynamoDB)
- NAT gateways (use VPC endpoints or skip VPC entirely for Lambda)

---

## What to do DIFFERENTLY next time

### Verify CI status after every push

I (Claude) pushed 4 commits with red CI between c62adc8 and 85cc6bf because I asserted "CI will land green" and didn't verify. Caught only when the failure email arrived. **Habit to build**: after every push, before declaring work complete, check CI. If it's still running, wait. Don't trust optimism.

### Pick a real domain on day 1

`yourname.tech` is fine for personal stuff but bad for a portfolio piece — it links the project to your personal identity, exposes WHOIS info, and forces a costly migration later. **Register `.com.au` / `.app` / `.io` / `.com` on day 1 with WHOIS privacy enabled.** Then point Cloudflare DNS at it from the start. Saves the Day 6 migration.

### Set up CloudWatch retention from day 1

Default CloudWatch log group retention is "never expire". A live launch with logs growing unbounded costs money silently. Set retention to 30 days at creation. Specifically valuable logs (feedback events, paid telemetry) can be longer or mirrored to S3.

### Build the feedback channel before launching

ParkProof launched on LinkedIn without an in-app feedback channel. One commenter publicly affected by the 30s timeout was the only feedback signal we got. **Always have a feedback channel before traffic.** This time: 5-min addition. Next time: ship it before announcing.

### Frame the project with launch context

The build journal PDF buries the "8 days post-redundancy" framing. That single contextual fact is worth more than another shipped feature for hiring purposes. **Put the framing in the case study's first paragraph.** Make it impossible to miss.

---

## Lessons from the final 48 hours (pre-launch hardening)

Added retroactively after the Sunday-before-launch audit. These are the lessons that only show up under launch-readiness scrutiny, not feature-build scrutiny.

### Run a "Tier 1" silent-failure audit 48 hours pre-launch

The most valuable PM-y thing I did wasn't a feature. It was sitting down on the weekend before launch and enumerating the **silent-failure modes** the green tests wouldn't catch. Six items, ~5 hours. The very first item — *"test PDF export in all 9 locales"* — caught a critical bug: jsPDF's default fonts have zero glyph coverage for Chinese / Korean / Devanagari / Gurmukhi / Greek / Vietnamese diacritics, and I'd shipped the integration without ever exporting a non-English PDF myself. Six of nine locales would have rendered as boxes. **The discipline isn't the fix — it's the audit. Most launches skip this step and ship the bug.**

### jsPDF + non-Latin scripts: self-host the fonts, subset them, pre-launch

The jsPDF built-in fonts (helvetica / courier / times) are Adobe Type 1 with Latin-1 + Latin Extended A coverage only. Anything beyond — CJK, Devanagari, Gurmukhi, Greek, Vietnamese diacritics — renders as missing-glyph boxes. The fix is non-trivial and platform-fragile:

1. **@fontsource v5+ ships only WOFF/WOFF2.** jsPDF needs TTF. v4 had TTF but the path scheme is unstable. Don't depend on it.
2. **Google's PageSpeed Insights API now requires an API key.** Anonymous quota is zero.
3. **Best path**: source variable-weight TTFs from the `google/fonts` GitHub repo (`raw.githubusercontent.com/google/fonts/main/ofl/...`), pre-subset at build time using `fontTools.subset` to only the glyphs that appear in your locale JSONs, self-host. CJK fonts go from 17MB → 893KB (94% reduction).
4. **Lazy-load per-locale at PDF export time.** Only the user who's in zh-CN and clicked Export pays the fetch cost.

If you ever ship a PDF generator with i18n, **test every locale before launch.** Don't trust that "the strings translate" implies "the rendering pipeline does."

### i18next detection chain needs `'querystring'` explicitly

Default `i18next-browser-languagedetector` order is `['localStorage', 'navigator', 'htmlTag']` — **`querystring` is NOT in the default**. So `?lng=ko` in the URL is silently ignored, and i18next falls through to localStorage (= the user's PREVIOUS choice, typically English). For any handoff flow (marketing landing → app, deep links from emails, etc.), explicitly add `'querystring'` to the front of the chain. Cost a couple of hours debugging.

### When Chrome launcher fails on Windows, pivot to PageSpeed Insights API (or manual audit)

Lighthouse CLI via `npx lighthouse` choked on Windows with `EPERM` on temp-file cleanup. PageSpeed Insights public API now requires a Google API key. Falling back to a **manual signal-by-signal audit** (curl the HTML, grep for `og:image` / `meta description` / alt-text coverage / canonical link) caught the actual high-impact issues — including a critical missing Open Graph card on the marketing landing that would have killed Reddit-share CTR.

### Self-service management surfaces matter for "invisible" backend features

When a feature lives server-side (EventBridge schedules, KMS signatures, cloud sync state), the user has no way to verify it's working without UI surfacing it. After shipping Web Push reminders, dogfooding revealed: *I have no idea WHEN the pushes will fire.* The fix was a `Scheduled reminders` section in the session detail screen — list each fire time, per-row cancel, smart-filtered add. **2.5 hours of UI for trust that the feature delivers what it promises.** Apply this principle to every "background" feature you ship.

### Lambda warmer is cheap, dramatic, and one EventBridge rule away

Node.js + AWS SDK + Anthropic SDK cold start = ~1 second of init duration on the first request. Bad first impression for the first Reddit visitor. Add a 3-line short-circuit at the top of `handler()` (`if (event.warmer === true) return { statusCode: 200, body: 'warm' }`), create an EventBridge Scheduler rule at `rate(5 minutes)` pinging the Lambda with `{warmer: true}`. Costs ~$0.008/month. Container stays hot indefinitely. **Do this for any latency-sensitive endpoint pre-launch.**

### CLAUDE.md should have a "Rollback playbook" section

Symptom → first-check → likely-fix triage table, with explicit commands for frontend revert (`git revert + scripts/deploy.sh`), Lambda version rollback (`update-function-code`), and what can't be rolled back (Cognito, DDB schema, KMS rotation). The first time you need it is the worst time to write it. **5 minutes pre-launch saves 30 minutes mid-incident.**

### S3 CORS allowlist follows domain migrations — or photos silently never upload

The single most expensive bug of the project, caught in bed at 2am on launch eve. The evidence bucket was provisioned during initial setup with CORS allowing the legacy domain + raw CloudFront origin + localhost. Six weeks later the production domain migrated to `www.parkproof.com.au`, but the bucket's `AllowedOrigins` was never updated. Every photo upload from the production site hit CORS preflight failure, the frontend swallowed the error per its "best-effort" sync policy, and DDB session rows landed with NULL photo fields. Symptom from the user side: signed-in, sessions visible, **photos completely missing from UI and PDFs** — while S3 sat literally empty.

Two takeaways: (1) **Add a CORS audit to every domain-migration runbook.** A 2-second `aws s3api get-bucket-cors --bucket X` would have caught it. (2) **"Best-effort, warned-and-swallowed" error handling needs an escape hatch.** Silent fail with a `console.warn()` means nobody notices until a user manually inspects S3. Either: surface upload failures to the user (toast / banner), or instrument the failure with a counter that triggers a CloudWatch alarm if non-zero for >5 min. The current design optimised for "don't fail the metadata write because of a photo glitch" — admirable but the threshold for breaking that silence is too high.

### Re-render plumbing for async-pull-into-localStorage flows

When an async operation mutates `localStorage` outside the React render cycle (`performInitialSync`, background sync workers, service-worker storage updates), nothing tells React to re-derive view state from it. The component holding the derived count just keeps showing the pre-mutation value until *something else* triggers a re-render (`useNow` tick at 30s in our case, or a user gesture). Symptom: post-sign-in on a fresh device, cloud sessions land in localStorage successfully but the home view stays at `sessionCount === 0` and renders the first-time-visitor experience indefinitely.

The fix is a `.finally(() => bumpRenderVersion(v => v + 1))` on the async chain. **Cheap, idempotent, runs once per operation.** The version state primitive should already exist for similar "I mutated storage, please re-render" cases (save/delete/end-session); reuse it rather than introducing parallel state.

⚠️ **What NOT to do**: trying to "fix this properly" by wrapping the derived count in `useMemo([versionState])` PLUS adding a fire-on-mount-when-unsigned-in branch to bump the version — that combination crashed the entire React tree on every view transition in this codebase. Reverted in 5 minutes. Root cause never fully diagnosed under 3am conditions. **The minimal `.finally()` bump alone is sufficient.** If you reach for the more elaborate refactor, do it with a local dev environment and console.log render counts to validate first.

### Pre-launch testing has to happen on the actual production URL, not localhost or CloudFront-direct

Every bug caught in the launch-eve testing window came from one of two things: (1) testing the *actual* production domain end-to-end on a real device, and (2) testing federation flows that aren't part of `npm run dev`. The S3 CORS bug, the OAuth callback orphan, the post-sync render: none would have surfaced under `localhost:5173` because dev runs against a permissive proxy with different CORS, different auth callback paths, and different SW behaviour.

**Mandatory pre-launch smoke test**: on a real phone, on the production URL, in a private/incognito tab so the SW doesn't serve cached state. Walk every user-facing flow including (a) federated sign-in cold from no-cookie state, (b) photo upload save + PDF export, (c) sign-in then sign-out then sign-in again, (d) the marketing landing page sharing preview on at least one platform's debugger. ~30 minutes. Catches in 30 minutes what would otherwise become a Reddit comment.

### Discipline of "do not deploy more code after a midnight revert"

Got broken right after a deploy at 2:30am. Reverted at 2:35am. Two more bugs surfaced from continued testing. **Resisting the urge to re-attempt the broken fix the same night was the right call** — the suspect commit was the one that broke things; re-attempting the same approach at 3am with cloudy judgement would have either re-introduced the bug or shipped a different one. Discipline: name the bug clearly in CLAUDE.md gotchas + a TODO in the issue tracker, schedule the diagnosis for "tomorrow eyes-fresh", and ship only the minimum-viable workaround that doesn't touch the same surface. **The build journal entry the next morning will be more honest if you didn't try to hide the failure with a 3am re-deploy.**

### AWS SDK version bumps can silently break browser CORS

The gnarliest bug of the launch-eve session and the one that's most likely to bite future projects. `@aws-sdk/client-s3` v3.729+ enables "default integrity protections" — a security-positive change that injects `x-amz-checksum-mode=ENABLED` (and a related signed header) into every presigned URL the SDK generates. The change is invisible to server-side callers and to curl tests, but it breaks browser CORS in a way that's almost designed to be undebuggable: the `Access-Control-Allow-Origin` header is RETURNED by S3 on a curl-equivalent request, but BROWSERS report `No Access-Control-Allow-Origin header is present` on the actual fetch.

This cost ~90 minutes of mid-launch-eve debugging — I didn't suspect the SDK because (a) the URL pattern looked normal, (b) curl tests worked, (c) the CORS bucket config was correct. The fix is one line: pass `requestChecksumCalculation: 'WHEN_REQUIRED'` + `responseChecksumValidation: 'WHEN_REQUIRED'` to the `S3Client` constructor for any client that generates browser-facing presigned URLs.

**Takeaway for the next project:** when bumping an AWS SDK version anywhere it generates URLs the browser will hit, re-run the actual browser flow before declaring victory. Test envs that use curl or server-to-server fetches will pass while real browsers fail. Pin SDK majors and read the release notes for any "default integrity protections" / "default checksums" / "auto-validation" language — those are all signals that browser-facing URLs may have changed shape.

### Photo upload pipelines need surfaced failure signals

The two-day silent CORS failure (every photo upload from production failing the S3 preflight, the swallow-and-warn handler in `sync.ts:uploadPhoto` logging to `console.warn` only) only got caught because of bed-testing on launch eve. **The user-visible signal was "DDB session row exists, S3 has zero photos."** Nobody would have noticed without explicitly checking S3 contents — the app surface gave no indication.

Two patterns to ship next time:
  * **Toast or banner on upload failure.** "Couldn't sync photo to cloud — try again?" with retry. Annoying for users on flaky networks, but at least they know.
  * **CloudWatch alarm on photo-upload failure count.** Emit a `[parkproof.photo_upload_error]` log line on every catch. Alarm if non-zero for 5 min. Catches the silent regression before users do.

"Best-effort, warned-and-swallowed" is fine for genuinely-optional features. For features the user PAID with their attention to set up (e.g. they took a photo, they tapped Save), you owe them a visible "we tried, it didn't work, here's why."

### When the localStorage cache is the bug, the recovery is "sign out, close all tabs, reopen"

A stale presigned URL in localStorage will survive a hard refresh if the `alreadyInSync` patching path doesn't fire correctly (which it sometimes doesn't, for reasons not yet fully diagnosed — see CLAUDE.md gotcha). The reliable user-facing recovery is sign-out + force-quit browser + reopen, which nukes the localStorage entries entirely and forces a fresh fetch. **Document this in the user-facing FAQ before you need it during a real customer support thread.**

---

## A starter checklist for the next project

Hand-rolled from what worked. Print, tape to wall, work down it.

```
□ Register the domain — .com.au / .app / .io / .com with WHOIS privacy
□ Set up Cloudflare DNS — free tier, point at the registrar's NS within an hour
□ Create the GitHub repo — private until ready, public when shipped
□ MIT LICENSE + CODE_OF_CONDUCT
□ README.md skeleton — placeholder for "Try it live →" link
□ TypeScript + Tailwind + Vite (or Next, your call) scaffold
□ Choose your AWS region — match user geography, pick one and stay
□ Lambda role with the smallest IAM policy you'd ship to prod, not "AdministratorAccess"
□ ACM cert request first (us-east-1) — DNS validation takes 5-30 min, do it early
□ One Lambda + path dispatch — don't split until you have a reason
□ Telemetry log prefix decided (e.g. [yourapp.event_kind {}]) before any user-facing feature
□ Vitest + happy-dom set up — even with 0 tests
□ GitHub Actions test workflow — green badge before any feature
□ Local dev API proxy in vite.config so dev hits the same code as prod
□ .env.example committed; never commit real .env
□ Custom domain DNS pointing at CloudFront from day 1
□ AWS Budgets alarm at $10/mo before any traffic
□ Idempotent setup scripts for every AWS resource
□ scripts/.aws-resources file as the single env source
□ Commit hygiene: conventional commits, no WIP commits, real-time docs commits
□ Build journal Day 1 entry written same day
□ Feedback channel built BEFORE launch (modal + Lambda route + S3 + CloudWatch)
□ One-paragraph case study draft before launch
□ Verify CI after every push — don't trust "should be green"
```

---

## What this artefact is for

This isn't documentation about ParkProof. It's lessons EXTRACTED from ParkProof, applicable to anything else you build next.

When you start the next project, read this on Day 0, refer back to it on Day 3 when you hit the first hard infra question, and again on Day 6 when something breaks in a way that feels familiar.

The point isn't to follow it religiously. The point is to *not have to rediscover what 10-day-me already paid for*.

Good luck with the next one.

— *Originally compiled 21 May 2026 (Day 6). "Final 48 hours" lessons added 24 May 2026, the Sunday before launch.*
