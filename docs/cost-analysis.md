# ParkProof running-cost model

_What ParkProof costs to run on AWS + Claude vision at 100, 1k, 10k and 100k monthly active users (MAU). Honest ranges, not false precision — the inputs that matter most (scans per user, Claude token mix) are estimates, so every figure is a band, not a point._

## TL;DR

**Claude vision is the dominant cost at every tier, and it isn't close.** The entire AWS stack (Lambda, DynamoDB, S3, Cognito, CloudFront, KMS) is a rounding error next to the per-scan Claude bill, from ~85% of the total at 100 MAU to ~99% at 100k. The architecture scales fine on cost. What doesn't scale is the **unit economics: ~$0.10–0.25 per MAU per month, ~all of it Claude, against zero revenue** (anonymous-first, free, no monetisation). The first *hard wall* is the deliberate Lambda concurrency cap of 10 (a throughput limit under burst, ~10k MAU); the first thing that *blows the budget* is the Claude spend itself meeting no revenue, painful by ~10k MAU (~$1–2.5k/mo) and unsustainable at 100k (~$10–25k/mo).

## Assumptions (the levers that matter)

| Assumption | Value | Why / sensitivity |
|---|---|---|
| Scans per MAU / month | **5** (range 3–8) | A parking app user scans a few times a month, not daily. This is the single biggest lever — the whole Claude bill is linear in it. |
| Fresh vs refresh | ~70% fresh, ~30% refresh re-checks | Refresh is text-only, ~4× cheaper. |
| Claude cost / scan | **fresh ~$0.04** (range $0.03–0.05), refresh ~$0.01 | Grounded: one real CloudWatch sample was ~1,500 in / ~1,500 out tokens ≈ $0.027; a fresh image scan adds image tokens + deeper thinking. Sonnet 4.6 ≈ $3 / 1M input, $15 / 1M output (thinking counts as output). |
| Blended Claude / MAU / month | **~$0.15** (range $0.10–0.25) | = 5 scans × the fresh/refresh mix. |
| Sign-in rate | **15%** | Anonymous-first; most users never create an account. Only signed-in users incur DynamoDB session storage, S3 photos, and Cognito. |
| Saved-session rate | ~50% of scans | KMS signs every *saved* session (anonymous or signed-in — the `/sign-session` route is anonymous). |
| Image size | ~150 KB | Resized client-side to ≤1200px @ 0.82 JPEG before any upload or Claude call. |
| Region / pricing | ap-southeast-2 (Sydney) | Slightly above us-east-1. AWS perpetual free tier applied where it bites (CloudFront 1TB + 10M req; Lambda 1M req + 400k GB-s; Cognito 50k MAU). |

**Per-scan request pattern** (from the code): one fresh scan ≈ 1 enqueue Lambda invocation + 1 async-worker invocation (the worker holds a 512MB container for the full 6–50s Claude call, billed as GB-s) + ~10–30 lightweight status-poll invocations (every 1.5s). DynamoDB: ~2 job-row writes + ~15 poll reads + the per-request rate-limiter counter. Each saved session = 1 KMS Sign (+ DynamoDB row + ~2 S3 photo PUTs for signed-in users only).

## Cost by tier (monthly, USD)

Ranges reflect the 3–8 scans/MAU and $0.03–0.05/scan bands.

| Service | 100 MAU | 1k MAU | 10k MAU | 100k MAU |
|---|---|---|---|---|
| **Claude vision** | **$10–25** | **$100–250** | **$1,000–2,500** | **$10,000–25,000** |
| Lambda (compute) | ~$0 (free tier) | ~$0 (free tier) | ~$3–5 | ~$85–110 |
| DynamoDB (on-demand) | ~$0 | ~$0–1 | ~$1–3 | ~$13–20 |
| S3 (signed-in photos, growing) | ~$0 | ~$0–1 | ~$1–3 | ~$5–15 |
| CloudFront | $0 (under 1TB free) | $0 | $0 | ~$0–25 |
| Cognito | $0 (under 50k free) | $0 | $0 | $0 (15k signed-in < 50k) |
| KMS ($1 key + Sign) | ~$1 | ~$1 | ~$2 | ~$5 |
| Domain / DNS / EventBridge | ~$1–2 | ~$1–2 | ~$1–2 | ~$2–3 |
| **Total / month** | **~$12–30** | **~$105–255** | **~$1,010–2,520** | **~$10,200–25,200** |
| **Dominant driver** | Claude (~85%) | Claude (~97%) | Claude (~99%) | Claude (~99%) |

A useful reframe: **total cost ≈ Claude cost.** Everything else combined never exceeds ~$160/month even at 100k MAU.

## The dominant driver at each tier

It's Claude vision at all four, and its share only grows. At 100 MAU the fixed costs (KMS key, domain) make the AWS side a visible ~15%; by 1k MAU the per-scan Claude cost has swamped everything and the AWS stack is noise. There is no tier at which an infrastructure line item becomes the thing to optimise. The optimisation surface is entirely: (a) scans per user, (b) cost per scan.

Levers on cost-per-scan are limited and known: Haiku is ~3× cheaper but was rejected because it can't do the stacked-sign leave-by math (it inverts earliest-vs-farthest). The refresh path already saves ~4× on re-checks. Prompt caching would trim the ~1,700-token system prompt on warm calls, but only the cheaper *input* half, and the prompt is currently just under the 2,048-token cache threshold, so it isn't active. The output/thinking tokens that dominate the bill are intrinsic to the task.

## What breaks first

**1. The Lambda concurrency cap of 10 (a throughput wall, not a cost wall) — bites around 10k MAU under burst.** The async worker holds a 512MB container for the entire 6–50s Claude call. With a cap of 10, at most ~10 scans run at once, so peak throughput is roughly 10 workers ÷ ~25s ≈ **~24 scans/minute (~1,400/hour)**. Average load is far below that at every tier, but parking is bursty (weekday-morning arrivals, a Reddit launch spike). At 10k MAU a peak hour can plausibly exceed 1,400 scans, and users hit the throttle (the app surfaces it as "complex sign, try again"). The cap is *deliberate* — it's the cost ceiling, set to 10 so a runaway can't run up the Claude bill. Raising it is a one-line AWS limit increase, but raising it just removes the throttle that was protecting the budget, which exposes the real wall.

**2. The real wall: Claude spend against zero revenue.** ParkProof is free and anonymous-first by design — there is no monetisation. So every MAU is ~$0.15 of pure monthly burn with nothing offsetting it. That's invisible at portfolio scale ($5–25/mo, fine to self-fund) and still tolerable at 1k MAU (~$150/mo). It becomes a real decision at **~10k MAU (~$1–2.5k/month)** and is **unsustainable at 100k (~$10–25k/month)** for a free app. Nothing in the architecture fails; the *business model* is what can't scale. This is the same gap the case study names openly: ParkProof signals no monetisation path, and that is the honest ceiling on this product as anything beyond a craft piece.

**3. Watch also: Anthropic API rate limits.** At 100k MAU (~500k scans/month, bursting well past the average ~700/hour), the Anthropic organisation's per-minute request/token limits would need raising ahead of the traffic, an operational item, not a cost one, but the kind of thing that fails silently on launch day if not pre-cleared.

## What does NOT break

Worth stating, because it's the reassuring half: the storage and request costs (DynamoDB, S3, CloudFront, Cognito) stay trivial to 100k MAU. Anonymous-first is doing real work here — 85% of users touch no per-user storage at all, so DynamoDB and S3 only carry the signed-in minority. Cognito's 50k-MAU free tier covers the signed-in cohort even at 100k total MAU. CloudFront's 1TB free tier covers a service-worker-cached PWA whose repeat loads transfer almost nothing. The async-polling design adds Lambda invocations (~15 cheap polls per scan) but they're sub-second GetItems that stay inside the free tier until ~10k MAU and cost ~$90/month even at 100k. None of these is ever the thing to fix.

---

_Caveats: figures use list pricing (no committed-use or EDP discounts) and assume Sonnet 4.6 at ~$3/$15 per 1M tokens; if that pricing differs the Claude column scales linearly. The scans-per-MAU figure (5) is an estimate with no real-usage data behind it yet — at 100k MAU, every +1 scan/user/month is roughly +$2–5k/month. Treat the bands as order-of-magnitude, which is the honest resolution given zero production traffic._
