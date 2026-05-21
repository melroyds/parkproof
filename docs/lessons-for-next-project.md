# Lessons from ParkProof — for the next project

A self-contained takeaways doc. Carry into the next portfolio piece (or real product) so you don't relearn what 8-day-me already paid for.

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

- **One Lambda handling 13 routes via path dispatch.** Cold-start cost paid once, deployment surface stays tiny. Don't split into multiple functions at portfolio scale.
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

### Test surface sizing for an 8-day portfolio MVP

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

The 8-day build journal (`docs/parkproof-build-journal.pdf`) was written within hours of each day's commits. The dead ends are still raw — Day 5's CloudFront-OAC failure, Cognito-Identity-Pool failure, then async-polling success. **Most "build retrospectives" are written months later, when the failures have been softened into a clean success story.** The rawness IS the value.

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

The point isn't to follow it religiously. The point is to *not have to rediscover what 8-day-me already paid for*.

Good luck with the next one.

— *Compiled 21 May 2026, the morning of Day 6.*
