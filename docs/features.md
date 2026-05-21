# ParkProof — feature showcase

A single canonical list of what ParkProof can actually do. Use this for:

- **Reddit / Hacker News / LinkedIn posts** — pick the bullets that fit the audience
- **Interview answers** — "tell me about a project you built" → cherry-pick from here
- **Resume copy** — distill the most impressive lines
- **Future-self memory** — six months from now when you've forgotten what you shipped

Curated for *impressive*, not *exhaustive*. The README narrative + CLAUDE.md status list have the long tail.

Live at **[https://www.parkproof.com.au](https://www.parkproof.com.au)** · Source at **[github.com/melroyds/parkproof](https://github.com/melroyds/parkproof)**

---

## 🎯 The core moment

> **Photograph any Australian parking sign. Get a plain-English "can I park now?" answer in 10 seconds.**

- **AI vision via Claude Sonnet 4.6** with adaptive thinking — handles stacked Melbourne CBD signs (Clearway + multi-arrow + accessibility + meter) that take humans 30 seconds to parse
- **JSON-schema-enforced output** — the model literally cannot return malformed JSON. Every response shape is guaranteed
- **Multi-rule reasoning** — when a sign has overlapping windows (2P Mon-Fri 8am-6pm + Permit Zone Sat-Sun), the model picks the *earliest* leave-by, not the latest
- **Clarification step** for position-dependent rules (different arrows, side-specific bays, EV-only spots) — the AI asks "where are you parked?" before answering
- **Photo-quality pre-check** — Laplacian-variance blur + Rec.709 brightness checks fire *before* any token spend. Saves money, sets expectations

## 🛡️ Defensible evidence

> **Every park you log gets a court-grade record — not just a screenshot.**

- **Session logger** — GPS coords + reverse-geocoded address (editable if wrong) + optional car photo + arrival timestamp + sign translation
- **Cryptographic signing** — each evidence record is signed by an **AWS KMS ECDSA P-256** key. The private key never leaves AWS. The public key is shipped at `/parkproof-public-key.pem`
- **Verifiable offline** — the evidence PDF includes a one-paragraph `openssl dgst -verify` walkthrough so a council, court, or insurer can verify the signature without ParkProof being in the loop
- **Caption-burnt car photo** — the saved car photo has address + timestamp permanently rendered into the bottom corner. Tamper-evident
- **Driver's note** — 280-char free-text per session for the *why* ("Mum's chemo at the Royal", "Saturday market"). Renders verbatim in the PDF — softens a council review when context matters
- **Background signing retry** — sessions that don't sign mid-flight (tab closed, network blip) self-heal on the next app load. 5-minute throttle, 3-attempt cap, 30-day horizon

## 📅 Reminders & live status

> **Know when to leave. Get back to your car. Never get a ticket from forgetting.**

- **Multi-offset reminder picker** — 30 / 15 / 10 / 5 / 2 / 0 minutes before expiry. Pick any combination
- **Three reminder rails fired in parallel from one tap:**
  - **`.ics` calendar event** with multiple `VALARM` blocks — honoured natively on macOS, iOS, and Google Calendar
  - **In-tab browser notification** — fires while the tab is open, labelled honestly so the user knows the limit
  - **Server-side Web Push via AWS EventBridge Scheduler** — fires on the device's OS even when the tab is closed, browser quit, or screen asleep. Title is the parking-spot address; body is the time-left, localized into all 7 languages
- **Auto-cancel on early end** — hit "I've left" before the timer expires and every pending push for that session is deleted server-side, so stale "30 min until your parking expires" pings don't arrive after you've already gone
- **Live "Currently parked" home card** — countdown colour-coded by urgency: green > 1h, amber 15-60min, red < 15min
- **Walk-back navigation** — distance + estimated walking time to your car, plus a deep-link straight into Apple Maps (iOS) or Google Maps (everywhere else) with walking-mode forced
- **Restriction-transition heads-up banner** — when a meaningful rule change is approaching within ~3 hours ("Permit Zone ends — anyone can park free until 8am"), shown under the answer card

## 🧠 Smart polish

> **The small touches that make the difference between "MVP" and "actually-built-by-someone-who-cares".**

- **Smart re-scan** — when you arrive at a spot you've scanned before (within 40m and 7 days), ParkProof recognises it and offers to **reuse the prior reading**. ~3× faster, ~4× cheaper per scan
- **Timezone-aware everywhere** — every displayed time is in the *parking spot's* timezone (resolved from GPS via `tz-lookup`), not the user's device locale. Scan in Sydney while travelling, see Sydney times
- **Date-aware time labels** — times more than 24 hours away show day + numeric date ("Until 10:00 am, Mon 18/05/2026") so a long-window expiry never looks like a today-window expiry
- **Photo resize** — every photo downscaled to ≤1200px @ 0.82 JPEG before storage. Saves localStorage, API payload, and money
- **3-phase quota auto-recovery** — when `localStorage` hits its 5MB ceiling, strips car-photos → sign-photos → whole expired sessions in order. Active sessions never touched
- **Stepped loading UX** — "Reading the sign… → Identifying parking rules… → Computing when you can park… → Composing the answer…" — with a real progress bar, timings tuned from actual CloudWatch latency
- **Async-polling architecture** — slow Claude calls (30-50s on complex signs) bypass API Gateway's 30s timeout cleanly via 202 + DDB-backed job polling
- **Push schedule cleanup is part of the data lifecycle** — server-side EventBridge schedules use deterministic names (`parkproof-push-{session_id}-{i}`), so ending or deleting a session can fan-out 6 parallel `DeleteSchedule` calls with no list step. Idempotent on re-pick too: changing reminder offsets wipes-then-recreates without conflict-handling code

## ⚠️ Safety gates

> **The "are-you-sure" checks that protect you from a wrongful-feeling ticket.**

- **Paid-parking gate** — when the sign indicates a meter / ticket / app-pay zone is currently active, an explicit acknowledgement checkbox blocks Save until you tick "yes, I've paid"
- **EasyPark / PayStay / Wilson / Care Park detection** — the AI looks specifically for app-payment stickers mounted below or beside the main sign (typically a separate small sticker), and surfaces the right deep-link
- **Accessibility-permit gate** — when the sign requires a disability permit (♿ pictogram, "DISABLED ONLY", ACROD, Mobility Pass), a RED banner + acknowledgement-required checkbox fires. Doesn't block a permit-holder; protects everyone else
- **No-sign mode** — log a park at an unsigned spot with an *ambient surroundings photo* as defensible evidence ("no signs were here at the time of parking"). The session stays open-ended until the driver hits "I've left"
- **Driver-signalled end-of-session** — explicit "I've left" stamps an `ended_at` time on the record. The evidence PDF then shows actual duration on-site alongside the sign's posted limit

## ⚖️ AI appeal letters

> **You got a ticket. ParkProof writes the dispute.**

- Photograph the infringement notice → Claude vision reads it, cross-references your saved session → drafts a formal letter to the issuing council
- **Evidence-strength rating** — strong / moderate / weak — with a one-paragraph strategy note
- Editable in-app before export
- Exports as a separate, polished PDF — letter + supporting evidence bundle ready to attach

## 🌏 Inclusion & access

> **Free, no app required, every Melbourne language.**

- **PWA** — installable to iPhone / Android / desktop home screen. Real app icon, theme colour, splash screen, offline-capable service worker. No App Store gatekeeping
- **7 languages** — English, 简体中文, Tiếng Việt, Italiano, Ελληνικά, हिन्दी, ਪੰਜਾਬੀ. Sourced from the **top non-English languages spoken in the City of Melbourne LGA** (2021 ABS Census). The UI scaffolding *and* the evidence PDF translate; the AI's sign translation stays in English (it reflects what's literally on the sign)
- **Anonymous-by-default** — every feature works without a login wall. Sign-in is opt-in for cloud sync. Local-first; cloud is durability, not gatekeeping
- **Mobile-first design** — built for the moment you're standing next to a pole on the street, not a desktop

## ☁️ Cloud sync (opt-in)

> **Choose to sign in — your evidence follows you across devices.**

- **Email + password sign-in** via Cognito Hosted UI
- **Apple federation** — single tap with your iCloud account
- **Google federation** — single tap with your Gmail
- **Cloud mirror** — saved sessions opportunistically mirror to **DynamoDB** for metadata + **S3** for photos (per-user prefixes, presigned PUT only, never publicly readable)
- **Cross-device recovery** — saved on phone, evidence available on laptop
- **Account export** — one tap dumps every session as a single PDF. Useful for legal hand-off, or just walking away with your data
- **Account delete** — wipes everything: DDB rows, S3 photos, Cognito user record itself. No retention, no soft-delete

## 🔭 Built right

> **The engineering rigor that's invisible until something breaks.**

- **One Lambda, 18 API Gateway routes + 2 internal invocation modes** (self-invoked async worker, EventBridge Scheduler target) — same code in dev (Vite middleware) and prod. Zero parity drift
- **AI feedback Layers 1 + 2** — every "Yes, looks right" / "Retake photo" event fires to CloudWatch with verdict + model context (confidence, sign-pattern, hour-of-day, payment methods detected). Layer 2 slicing tells you *which kind* of failure, not just *whether*
- **Free user-feedback channel** — in-app modal → CloudWatch (queryable) + S3 mirror (2-year retention). No email firehose
- **`?dev_time=` URL spoofing** for testing time-dependent behaviour outside wall-clock hours
- **112 tests on CI**, all green — covers time math, quota recovery, distance calculations, Lambda contract (system prompt regression tests), Maps deep-link UA routing
- **CloudFront + OAC** with private S3 origin — bucket isn't directly readable
- **Cost-bounded** — Lambda's account-level concurrency ceiling + $25/mo Budget alarm + per-API throttle (100 burst / 25 rate per second) all in place before traffic hits
- **Custom domain** at `www.parkproof.com.au` (Cloudflare DNS + Page Rules); `parkproof.com.au` and both forms of `parkproof.au` 301-redirect to the canonical
- **Code-split** — main bundle ~225 KB gzipped; jsPDF, ics, html2canvas, DOMPurify, and non-English locale chunks all lazy-loaded on use
- **MIT-licensed open source** — every line public for review

---

## At a glance

| Dimension | Value |
|---|---|
| Live URL | https://www.parkproof.com.au |
| Source | github.com/melroyds/parkproof |
| Build duration | 7 active build days (16-22 May 2026) |
| Commits on `main` | 60+ |
| Lambda routes | 18 (10 anonymous + 8 JWT-gated) |
| Lambda invocation modes | 3 (HTTP handler · self-invoked worker · EventBridge target) |
| Languages | 7 |
| Tests passing on CI | 112 |
| Monthly running cost | ~$5-7 AUD |
| Real users | 0 (portfolio-grade, not a startup attempt) |

---

## What's NOT shipped yet

Honest about gaps:

- **AI feedback Layer 3** — opt-in photo capture for systematic failures, building a private training dataset. Reserved for when there are real users.
- **Citywide parking heatmap** — every scan captures the data; needs a share-toggle, viewer, and cold-start solved.
- **Voice confirmation** (Web Speech API).
- **Council-specific appeal deep-links** (auto-submit) — blocked by council-side captchas + no public APIs.

*Recently moved off this list: **Web Push** (full VAPID + EventBridge Scheduler pipeline now shipped, including auto-cancel on early session end).*

---

## How to use this list

**For a Reddit post** (technical sub like r/aws or r/programming): pull from "Built right" + the "async-polling architecture" line under Smart Polish. Mention the one-Lambda design + KMS signing chain.

**For a Reddit post** (consumer sub like r/Melbourne or r/SideProject): pull from "The core moment" + "Defensible evidence" + the languages line under Inclusion.

**For LinkedIn**: pull 5-7 of the most distinctive bullets, lead with the core moment, end with "built in 6 days post-redundancy".

**For interview**: pick the bullets that match the role. PM role → "Smart polish" + "Safety gates" demonstrate scoping. Engineering role → "Built right" + "Defensible evidence" demonstrate craft. Design role → "Inclusion & access" + the brand consistency story.

**For Hacker News (Show HN)**: lead with the technical novelty — "AI vision + cryptographic signing + offline-verifiable evidence chain", link the build journal PDF in the comments.

---

*Last updated: 22 May 2026 (Day 7). When you ship a new feature, add it to the relevant section.*
