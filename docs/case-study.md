# ParkProof — a PM case study

*Mobile-first PWA. Photograph an Australian parking sign → plain-English answer + timestamped, GPS-tagged evidence. Built solo across seven active days (16-22 May 2026); ~$5/month to run; zero real users.*

[Live demo →](https://www.parkproof.com.au) · [Source →](https://github.com/melroyds/parkproof)

---

## TL;DR

ParkProof is a craft project I built to demonstrate how I scope, sequence, and make trade-offs as a PM — not a startup attempt. It's intentionally a narrow, well-defined slice of a problem I have personal exposure to (Australian parking signs are notoriously dense; I have, like most Melburnians, had at least one wrongful-feeling ticket). The project gave me an excuse to make a sequence of real product decisions in public, with the constraint that everything had to ship to a working URL.

The work is structured around four product questions:

1. **Who's the user, and what's their actual job?**
2. **What's the smallest version that solves the job credibly?**
3. **What do you defer, and what triggers you to come back?**
4. **How do you know if the AI in the loop is doing its job?**

I'll walk through how I answered each, the trade-offs I made, and what I'd do next if this were a real product.

---

## The problem

If you've ever stood next to a Melbourne CBD parking pole reading three stacked signs with overlapping time windows, side-specific arrows, and a "Permit Zone" overlay and thought *I genuinely don't know if I'm allowed to park here*, you understand the problem in your bones. Inner-city Australian parking signs are dense by design — councils stack rules to maximise revenue per pole — and the cognitive load is significant.

Existing apps in this space (ParkingMate.ai, Parky.AI, SIGNlanguage) translate the rules. They do this well. But they stop there: none of them save the evidence you'd need to dispute a wrongful ticket later. That evidence — timestamp, GPS, the sign as it appeared when you parked, the car at the spot — is what changes the conversation with a council from "your word against the officer's" to "here's what was on the pole at 11:42am, and here's the time-math that says I was fine."

ParkProof does both: translates the sign, AND captures the evidence trail.

I want to be honest about the scale of this problem. It's not life-altering. It's an annoyance, not a pain. Most people who get a parking ticket grumble, pay it, and move on. The actual market for *systematic* parking-evidence capture is small: people who got a wrongful ticket recently and got angry, people who park professionally (couriers, taxi drivers), and people with chronic anxiety about parking. As a startup this is tough; as a craft project, the narrowness is a feature — it forced me to scope ruthlessly.

---

## The user (and the cuts I made because of them)

I built ParkProof for one person: **a driver who's already had a wrongful-feeling ticket once, and who has decided they don't want it to happen again.**

Everything else cascaded from that:

- **Anonymous-by-default.** This user has just been screwed by an institution. The last thing they want is to create an account, verify an email, agree to a privacy policy, and then *finally* get to translate a sign. So the entire app works fully anonymously. Sign-in is opt-in, gated behind features the anonymous experience already gives you (cloud sync, cross-device evidence).
- **Mobile-first, installable.** They're standing next to the sign. They have one hand free. The home screen is a single button: "Scan a parking sign." Everything else is one tap deeper.
- **Court-friendly output, even though they hope they never need it.** The evidence PDF is built to be print-ready, council-ready, with a cryptographic signature appendix that includes an `openssl dgst -verify` walkthrough so the receiving party (council, court, insurer) can independently confirm the file hasn't been altered since it was saved.
- **Cost-conscious by default.** A user who's already cranky about a parking ticket isn't going to subscribe to a parking app. The whole thing had to work on free / near-free infrastructure (~$5/mo all-in at portfolio scale).

The user I *didn't* build for:

- Casual drivers who park once a week (they'll use Apple Maps' built-in info or just guess)
- Council parking officers (different product entirely)
- Fleet managers (real opportunity, but very different product surface area — multi-user, audit trails, billing)
- People who want to dispute every ticket on principle (this is a feature, not a customer)

---

## The MVP — what I built first, and what I cut

I tried to be disciplined about MVP scoping. The rule I held myself to: **the first version must end in a saved evidence record that the user could in principle submit to a council.** If a feature didn't directly serve that, it didn't make v1.

What made the cut:
1. **Sign translation** — photograph a sign, get a plain-English "can I park now?" answer with the exact moment you must leave. ~8-12 seconds via Claude Sonnet 4.6 vision.
2. **GPS + reverse-geocoded address** — captured silently while the user is still on the sign-scan screen, so it's already there when they go to log a session.
3. **Car photo at the spot** — the second half of the evidence pair.
4. **PDF export** — multi-page, timezone-aware, with the address and timestamp burnt into the corner of the car photo as a caption overlay.
5. **Reminder** — `.ics` calendar event + in-tab browser notification, because half the value of knowing when parking expires is being reminded before it does.

What I deliberately cut from v1:
- **User accounts, cloud storage, cross-device.** All sessions are device-local in `localStorage`. I deferred building a database until there was a user-facing trigger that demanded one — eventually that became "what if the user loses their phone before disputing a ticket?", and I added optional cloud sync. But not on day one.
- **Auto-submit appeals.** Tempting, but blocked by council-side captchas, login walls, and the absence of public APIs across Australian councils. A realistic version is deep-linking the user into the council's existing form with metadata pre-encoded, which is on the *next* roadmap, not v1.
- **A citywide heatmap of parking rules.** Genuine moat — every scan captures data that could feed it — but heatmaps with five data points are worse than no map at all. Build trigger: a few hundred consistent users, or a council partnership offer.

What I cut from v1 but came back to (and finished) by day 7:
- **Web Push background notifications.** Originally deferred — the `.ics` calendar event covers the "you'll be reminded with the app closed" need on iOS/Android/macOS for users who keep a connected calendar, and I assumed that was good enough for v1. It mostly was. But after using my own app for a few days I noticed I kept *not* opening the calendar notification, and the in-tab notification only fired if I happened to have the tab open. So I went back and built the full pipeline: VAPID-signed `web-push` from the Lambda, push subscriptions persisted to DynamoDB, one-shot **EventBridge Scheduler** schedules created per selected reminder offset, dispatch routed back through the same Lambda. The interesting trade-off was the schedule-naming scheme: I picked deterministic names (`parkproof-push-{session_id}-{i}`) over random UUIDs specifically so that ending a session early could fan-out 6 parallel `DeleteSchedule` calls without ever calling `ListSchedules` — no extra IAM permission, idempotent on re-pick. The path mattered more than the destination.

---

## Key trade-offs (the ones a PM-style review would actually probe)

### 1. Sonnet 4.6 vs Haiku 4.5

Haiku is ~3× cheaper and ~2× faster. Tempting. I tried it. It failed.

The model needs to do multi-rule time-window math on stacked signs — compute the "leave-by" time for each rule, take the *earliest* one. Sonnet 4.6 with adaptive thinking handles this correctly. Haiku 4.5 does not support adaptive thinking *or* extended thinking, and without it, gets the earliest-vs-farthest leave-by inverted on multi-rule signs. That's not a 5% accuracy drop; it's the difference between "you can park until 6pm" and "you can park until 11pm" when the actual answer is 6pm.

The cost/correctness trade-off only works in one direction. Sonnet 4.6 is the floor for this task.

I logged this in the engineering notes and the system-prompt for future maintainers. The cost premium is real (~$0.05 per scan vs ~$0.015) but at portfolio traffic it's $2/month, not $200.

### 2. Anonymous-first vs cloud-first

The classic SaaS instinct is to require sign-up so you can build a user funnel. I picked the opposite: sign-up is *optional*, never gated, and every feature works fully anonymous on `localStorage`.

The cost of this was real. I had to:
- Build a `localStorage` quota-management system (3-phase auto-recovery when the 5MB ceiling is hit)
- Build a migration path from `localStorage` → DynamoDB when users opt into cloud sync (which means designing the canonical schema *twice*, once local, once cloud)
- Resist the temptation to add features behind sign-in (account-only history, "premium" tier, etc.)

The benefit: the experience the wronged-driver-on-the-street actually has is the experience I built for. No friction tax on first use. If a recruiter visits the live URL, they can use every feature in 30 seconds without an email verification step.

In hindsight, I'd make the same call. If this were a real product with growth targets, I'd revisit it.

### 3. Cryptographic evidence signing — overengineering or differentiation?

When I'm building a portfolio piece, I have to be honest about the line between "this demonstrates competence" and "this is showing off." Cryptographic signing flirted with that line.

The argument *for* it: the entire premise of the app is that the evidence has to survive scrutiny. A SHA-256 hash of the photo isn't enough — the user could alter the photo after saving it, then re-hash. A cryptographic signature over the canonical metadata + photo hashes, signed by a key the user doesn't have access to (KMS-held), is the only thing that actually proves "this record existed in this form at this time."

The argument *against* it: nobody has ever used a ParkProof PDF in a real council dispute. The whole signing apparatus is aspirational.

I built it anyway, for one reason: **the cost is small once and the value compounds.** $1/month for the KMS key. The `openssl dgst -verify` walkthrough in the PDF is one paragraph. And the day a real user actually submits a ParkProof PDF to a council, it'll be the differentiator. I'd rather have it sitting unused than scramble to add it under deadline pressure.

### 4. 9 languages, picked from Melbourne LGA census data

The temptation in i18n is to support "all the major world languages" — Spanish, French, German, Japanese. None of those move the needle for a Melbourne parking app.

I went to the 2021 ABS Census for the City of Melbourne LGA and looked at the top non-English languages spoken at home. The list (Mandarin, Vietnamese, Italian, Greek, Hindi, Punjabi) gave me the seven supported languages including English. Punjabi and Hindi both use the India flag in the language picker, so I show native names (हिन्दी / ਪੰਜਾਬੀ) to disambiguate.

This is a small detail but it's exactly the kind of decision where you can tell a PM is doing the work vs. defaulting to a generic "translate all the things." The cost was the same as supporting any other seven languages; the *signal* of "I picked these because of the actual user data" is what differentiated.

---

## How I'd know if it's working — the feedback loop

The thing I'm most proud of from a PM perspective is the AI-feedback design, even though no real user has ever fired it.

After each translation, the user sees two buttons under the result: "Yes, looks right" and "Retake photo." Both fire a structured event to CloudWatch Logs with the model's confidence, the rules-shape, whether the clarification step ran, the local hour of day, and a 120-character excerpt of the rules text.

Why I designed it this way:

- **Verdict count alone (Layer 1) tells me *if* there's a problem.** A 95% accept rate means the model is generally trusted. A 60% rate means something's broken.
- **Verdict + context (Layer 2) tells me *what kind* of problem.** *"Of all retake verdicts, what's the confidence distribution? Which sign patterns? Which hours of day?"* If retake correlates with low confidence — good, the model is calibrated. If retake correlates with high confidence — that's a prompt regression and I need to look at it. If retake correlates with specific hours (e.g. 8pm onwards) — that's a lighting / photo-quality issue, not a model issue.
- **Photo capture for systematic failures (Layer 3)** — not built yet. Build trigger: Layer 2 surfaces a specific failure mode worth investing photo-storage in. I'm not going to ask users to opt into photo capture until I have a clear hypothesis.

This is the part of the work that I think a hiring PM would recognise as senior-PM thinking. Most product builds skip the feedback design entirely, then are surprised when the AI degrades silently and they can't tell why.

---

## What I'd build next (if this were going to v1)

In rough priority order:

1. **Council-specific appeal deep-links.** Right now the appeal flow drafts the letter and exports it as a PDF the user submits manually. The next version deep-links to the council's online dispute form with metadata pre-encoded (session ID, photo URLs, infringement number). Blocked by per-council research; the system architecture is ready.
2. **Citywide heatmap.** Cloud sync is already in place, which means the data pipeline exists. The missing pieces are (a) a "share my scans to improve the map" opt-in toggle distinct from cloud-sync sign-in, (b) Mapbox/Leaflet viewer, (c) the cold-start problem (a map with five scans is useless). Build trigger: enough consistent users, or a council partnership.
3. **AI feedback Layer 3.** Opt-in photo capture for systematic failure modes surfaced by Layer 2. Builds a private training dataset for prompt tuning.
4. **Voice confirmation.** "Hey ParkProof, when does parking expire?" — Web Speech API, ~half a day of work, limited by iOS PWA support.

What I'd *deprioritise* even though it's tempting:

- **Multi-city expansion.** ParkProof is Australia-specific because the Claude prompt encodes Australian conventions (e.g. AEST/AEDT formatting, "P" notation, council-flavoured language). Adding the US would require re-engineering the prompt and probably hurting accuracy in the existing market. The 80/20 isn't there.
- **A "premium" tier.** No clean way to monetise without making the anonymous experience worse, which defeats the whole positioning.

---

## What I'd do differently with hindsight

A few honest reflections:

- **I'd start with the cloud schema and back-port to `localStorage`, not the other way around.** The local-first decision was right for users, but the migration cost was real — I built the canonical session shape twice.
- **I'd write the case study earlier.** Forcing myself to articulate the trade-offs in writing would have surfaced some decisions I made on autopilot. Writing this document made me realise I never explicitly named the "no clean monetisation path" trade-off until now.
- **I'd build the screen-recording fixture pipeline earlier.** Halfway through the build, I added a Playwright-driven screenshot harness that re-generates the README demo grid deterministically. It's now 16 captures across four themed sub-grids. If I'd had this from week 1, every PR would have come with a visual diff and I'd have caught at least three UI regressions earlier.

---

## What this project taught me about PM-engineering

The thing I keep returning to: **the discipline of stopping is harder than the discipline of building.** ParkProof is feature-complete for its scope. Every hour I spend adding the citywide heatmap or Layer 3 telemetry or a fourteenth language is an hour I'm not spending in front of the people I want to see this work.

The decisions that made the project work weren't the ones about *what to build*. They were the ones about *what not to build, yet*. DynamoDB deferred until cloud sync had a real trigger. Auto-submit deferred until council research is done. Layer 3 telemetry deferred until Layer 2 surfaces a failure worth investigating. Each "not yet" came with an explicit build trigger so future-me could tell when the conditions had changed.

That's the part of the job I think most PMs underweight. It's easy to ship features; it's hard to defend an empty roadmap slot.

---

## Stack & cost summary

**Frontend:** React 19 + TypeScript (strict) + Tailwind v4 + Vite + PWA service worker. Main bundle ~225KB gzipped.

**Backend:** Single AWS Lambda function (`parkproof-sign-translator`) handling 18 API Gateway routes via path dispatch, fronted by API Gateway HTTP API with a Cognito JWT authorizer on the cloud-sync routes. The same Lambda is also the EventBridge Scheduler target for one-shot push dispatch and the self-invoked worker for async-polled Claude calls that exceed the 30s API Gateway timeout — three invocation modes, one cold-start budget. Reused as the local dev proxy via a Vite plugin — one handler, two runtimes, no mocks.

**AI:** Anthropic Claude Sonnet 4.6 with adaptive thinking and native JSON-schema-enforced output. ~$0.05 per sign-translate.

**Persistence:** `localStorage` first, with optional Cognito-gated mirroring to DynamoDB + a private per-user S3 prefix.

**Evidence integrity:** AWS KMS asymmetric key (ECDSA P-256) signing the canonical session metadata + photo hashes. Public key shipped at `/parkproof-public-key.pem` for offline verification.

**Hosting:** CloudFront + private S3 with Origin Access Control, custom domain via ACM cert. ap-southeast-2 (Sydney).

**Telemetry:** CloudWatch Logs with structured feedback events (verdict + model context); Logs Insights queries committed alongside the code.

**Cost at portfolio traffic:** ~$5–7/month (KMS asymmetric key + domain dominate; AWS itself is effectively free at this scale). Monitored with an AWS Budgets alarm at $10/month.

---

*If you've read this far and you'd like to talk product — about ParkProof, AI-feedback design, or just the discipline of deferring features — drop a line at hello@parkproof.com.au.*
