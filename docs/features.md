# ParkProof: feature showcase

A single canonical list of what ParkProof can actually do. Use this for:

- **Reddit / Hacker News / LinkedIn posts**: pick the bullets that fit the audience
- **Interview answers**: "tell me about a project you built" → cherry-pick from here
- **Resume copy**: distil the most impressive lines
- **Future-self memory**: six months from now when you've forgotten what you shipped

Curated for *impressive*, not *exhaustive*. The README and CLAUDE.md have the long tail. Every claim here follows the app's own copy rules: a signature shows the signed details haven't changed since ParkProof signed them, and nothing more.

Live at **[https://www.parkproof.com.au](https://www.parkproof.com.au)** · Source at **[github.com/melroyds/parkproof](https://github.com/melroyds/parkproof)**

> **Status, 9 Nov 2026.** Production runs `main`. Bullets marked *(roadmap 2)* are built and tested on `integration/roadmap-2` but not deployed yet. Workday mode is built and stays off in production until a lawyer has read its copy.

---

## 🎯 The core moment

> **Photograph any Australian parking sign. Get a plain-English "can I park now?" answer in about 10 seconds.**

- **AI vision via Claude Sonnet 4.6** with adaptive thinking: reads stacked Melbourne CBD signs (Clearway + multi-arrow + accessible bay + meter) that take a human 30 seconds to parse
- **JSON-schema-enforced output**: the API guarantees the answer's shape. A size budget test and a live compile check keep the schema inside what the API will compile (it refused one version on 9 Nov 2026, which only a real call could show)
- **Multi-rule reasoning**: when windows overlap (2P Mon-Fri 8am-6pm + Permit Zone Sat-Sun), the model takes the *earliest* leave-by, not the latest
- **Clarification step** for position-dependent rules (arrows, sides, bays): the AI asks where you are before answering
- **Honest about unclear signs** *(roadmap 2)*: partly hidden or contradictory signs get the most restrictive answer and a warning; no readable sign gets its own screen, reminding you general road rules still apply where there's no sign
- **Photo-quality pre-check**: blur and brightness checks run before any token is spent

## 🛡️ A signed record of every park

> **Every park you log gets a record ParkProof's server signs, part by part. Not legal advice: a signature shows the signed details haven't changed since ParkProof signed them. It doesn't show they're true, who was driving, where the car was, or when it arrived or left.**

- **Parking record**: GPS, reverse-geocoded address (editable), optional car photo, the time from your phone, the sign reading
- **A chain of signed parts**: the arrival, the details you gave at parking, each photo you add later, the departure and any handover are each signed with an **AWS KMS ECDSA P-256** key, and each names the hash of the part before it. The private key never leaves AWS; the public key is at `/parkproof-public-key.pem`
- **Photos never leave the phone to be signed**: only their SHA-256 fingerprints. Photos live in IndexedDB, addressed by their hash, and can't be overwritten
- **Check it yourself**: **Check signatures** on any record checks every part's signature, the links between parts and every photo's fingerprint in the browser (WebCrypto). The PDF's signature pages and the `/verify/` page (9 languages) walk anyone through the same checks with `openssl`
- **Condition photos and proof of payment** *(roadmap 2)*: camera-only photos of the car at parking and on return, and a photo of your meter ticket, payment confirmation or permit, each signed as its own part
- **I've left, signed**: the departure records your tap (phone clock) and your phone's location, and says so if your phone was far from the car
- **Evidence PDF and evidence file** *(roadmap 2 for the file)*: times labelled phone clock or server clock, signature pages per part, and a `.json` file with every signature and the original photos so a third party can re-hash them
- **Health information stays out of the signature**: an accessible permit is signed only as a salted hash, revealed only if the driver ticks "Include permit details"
- **Background signing**: parts that couldn't be signed (offline, tab closed) are signed later, in order, one queue per record; a part the server refuses is marked and never retried

## 📅 Reminders & live status

> **Know when to leave. Get back to your car.**

- **One Remind me button** *(roadmap 2)*: pick any of 30 / 15 / 10 / 5 / 2 / 0 minutes before the limit. It registers the phone if needed and books a **server-side Web Push through AWS EventBridge Scheduler**, which arrives with the app closed, or tells you plainly that the reminder only works while ParkProof is open
- **Calendar file**: an `.ics` with one alarm per reminder, in your language
- **Self-healing push** *(roadmap 2)*: the phone re-sends its registration on open and before every booking; the server refuses to book for a device it doesn't know and remembers dead endpoints
- **Auto-cancel on I've left**: every pending push for that record is deleted, so no stale "time's nearly up" after you've gone
- **Street sweeping and weekly reminders** *(roadmap 2)*: weekly, fortnightly or "first and third Tuesday", set by hand or picked out of a sign's restrictions; on the phone, by weekly push (cron in the rule's own time zone) and in a calendar file with a repeat rule
- **Live home card**: countdown coloured by urgency (green over 1 h, amber 15 to 60 min, red under 15 min), the next reminder time, and a Share icon *(roadmap 2)*
- **Walk-back navigation**: distance and walking time to your car, with a deep link into Apple Maps or Google Maps
- **Rule-change heads-up**: a banner when the sign's rules change within about 3 hours

## 🧠 Smart polish

> **The small touches that make the difference between "MVP" and "built by someone who cares".**

- **Re-check**: back within 40 m and 7 days of a spot you scanned? Re-check the earlier reading against the time now, with no photo. About 3× faster and 4× cheaper per scan
- **Timezone-aware everywhere**: every time is in the *parking spot's* timezone (from GPS via `tz-lookup`), and PDFs name the zone
- **Date-aware labels**: times more than 24 hours away show the day and date
- **Photo resize**: every photo downscaled to at most 1200 px at JPEG 0.82 before it's stored or sent
- **Storage that protects evidence**: when browser storage is full, ParkProof drops shared copies first, then older photos, and never touches a record still on home or one with an unsigned part
- **Stepped loading**: "Reading the sign… → Identifying parking rules… → Computing when you can park… → Composing the answer…", with timings tuned from CloudWatch latency
- **Async polling**: slow AI calls (30 to 50 s on complex signs) get past API Gateway's 30 s limit with a 202 and a polled job row
- **Push owned by the device that booked it**: deterministic schedule names (`parkproof-push-{record}-{i}`, `parkproof-push-r-{rule}-{n}`), so re-booking is replace-all and cancelling needs no list call

## ⚠️ Safety gates

> **The "are you sure" checks that protect you from a fine.**

- **Paid-parking gate**: when payment is due now, Save waits until you confirm you've paid
- **Payment app links**: when the sign shows a pay-by-app sticker, a link straight to EasyPark, PayStay, OPark, Wilson Parking or Secure Parking
- **Permit zone and accessible bay gates**: you confirm before you save; nothing is ticked for you
- **Saved permits** *(roadmap 2)*: the answer shows what the sign itself prints for your permit, separately from the standard answer, and checks a permit zone's area against yours. ParkProof never works out a concession. For an accessible permit it asks whether the permit holder is in the car and getting out there, and says not to use the bay if not
- **Share safeguard** *(roadmap 2)*: when a park used an accessible permit, sharing or handing the car over reminds you to take the permit off the dash if the holder won't be in the car
- **No-sign mode**: log a park where there's no sign, with a surroundings photo. The record says what it is: a park logged without a sign, not proof there was none
- **I've left**: the record shows when you tapped, by your phone's clock, and the PDF shows the time from arrival to that tap

## ⚖️ When a fine arrives

> **Got a fine? Start here.** *(roadmap 2)*

- Photograph the notice → Claude reads its number, date, time, place, offence and due date → ParkProof finds your records from around then (it handles the daylight saving hour that happens twice, or not at all)
- **A factual comparison, line by line**: when you tapped I've left by your phone's clock, whether ParkProof signed that before the time on the notice, when you logged the park, who the record says was driving and any handover. Always: check the registration and the due date on the notice itself. Never a verdict, never legal advice
- **AI-drafted appeal letter**: from the notice and your record, a formal letter to the issuing council. Editable, exported as a PDF. The model rates the evidence internally to calibrate the letter, and that rating is never shown

## 🌏 Inclusion & access

> **Free, no app store, nine languages.**

- **PWA**: installable to the iPhone, Android or desktop home screen, with its own icon, splash and service worker
- **9 languages**: English, 简体中文, Tiếng Việt, Bahasa Indonesia, 한국어, Italiano, Ελληνικά, हिन्दी, ਪੰਜਾਬੀ, chosen from the **top languages spoken at home in the City of Melbourne** (2021 ABS Census). The whole app *and* the evidence PDFs translate (per-locale Noto font subsets). The evidence-chain strings had two language reviewers per locale, and the roadmap 2 strings are in review now. The AI's sign reading stays in English because it quotes the sign
- **Anonymous by default**: every feature works without an account. Sign-in is opt-in, for cloud backup
- **Mobile first**: built for the moment you're standing at the pole
- **Accessible**: 44 px touch targets, back and destructive buttons tested for AA contrast on the dark vault, `<html lang>` set to the language on screen so screen readers use the right voice

## ☁️ Cloud sync (opt-in)

> **Choose to sign in, and your records follow you across devices.**

- **Email and password, Apple or Google** via the Cognito Hosted UI
- **Cloud mirror**: records to **DynamoDB**, photos to a private per-user **S3** prefix (presigned upload, read back through the API)
- **A merge that never loses a signed part**: both sides union the signed parts, so two devices can add to one record
- **Account export**: every record as one PDF
- **Account delete**: database rows, photos and the Cognito user, all gone

## 🔭 Built right

> **The engineering rigour that's invisible until something breaks.**

- **One Lambda, 23 API Gateway routes** (14 anonymous, 9 JWT) once roadmap 2 is deployed, plus the self-invoked job worker and the EventBridge target for one-shot and weekly pushes. The same code runs as the local dev proxy
- **Legal-safety discipline**: a copy lint fails the build on em-dashes and banned claims ("verified record", "tamper-proof", "strong evidence"…) in all 9 languages; every string a lawyer should read is listed in `docs/legal-review-queue.md`
- **A feature held back on purpose**: workday mode (moving between time-limited spots all day) is built and tested, and off in production until a lawyer has read it. The deploy scripts set the flag explicitly, and tests prove a `.env` line can't turn it on
- **Server checks on every signed part**: the parent's signature, its sequence, the chain key, no phone time from the future, size caps; malformed parts are refused, never repaired
- **AI feedback telemetry**: every "Yes, looks right" / "Retake photo" logs the reading's shape to CloudWatch, and the privacy policy lists exactly which fields (a test fails if they drift)
- **Accuracy benchmark harness** *(roadmap 2)*: Wilson intervals, false "you can park" counted apart from false "you can't", a held-out test split. No numbers published until that split is labelled
- **3,037 tests in 168 files**, all green (9 Nov 2026): time maths across daylight saving, the signing chain, the merge, quota recovery, push ownership, the deploy scripts against a fake AWS, the schema budget, locale parity, the copy lint
- **CloudFront + OAC** with a private S3 origin
- **Cost-bounded**: account concurrency cap, a \$25 a month budget alarm, a Claude call-volume alarm, per-IP rate limits and API throttling
- **Custom domain**: `www.parkproof.com.au` on Cloudflare DNS; the apex and both forms of `parkproof.au` redirect to it
- **Lazy-loaded heavy code**: jsPDF, html2canvas, ics and the cloud sync code load on use. The 9 locales are bundled inline so switching language is instant, which puts the main chunk at about 517 KB gzipped
- **MIT-licensed open source**

---

## At a glance

| Dimension | Value |
|---|---|
| Live URL | https://www.parkproof.com.au |
| Source | github.com/melroyds/parkproof |
| First build | 7 active days (16 to 22 May 2026); roadmap 2 in October and November 2026 |
| Commits | 188 on `main`, 223 on `integration/roadmap-2` (9 Nov 2026) |
| API routes | 23 (14 anonymous + 9 JWT) once roadmap 2 is deployed |
| Lambda invocation modes | HTTP routes, self-invoked job worker, EventBridge Scheduler target (one-shot and weekly), warmer |
| Languages | 9 |
| Tests passing | 3,037 in 168 files |
| Monthly running cost | about \$5 to 7 AUD at launch volumes (May 2026 estimate) |
| Real users | 0 (portfolio grade, not a startup attempt) |

---

## What's NOT shipped yet

Honest about gaps:

- **Roadmap 2 isn't deployed.** Built, tested and documented; the deploy runbook is `docs/build/deploy-checklist-roadmap-2.md`.
- **Workday mode** is built and off in production. No lawyer is engaged to read its copy.
- **The About page and landing** for roadmap 2 wait on the redesign choice.
- **Accuracy numbers**: the harness and method page exist; the labelled test set doesn't yet.
- **AI feedback Layer 3**: opt-in photo capture for systematic failures, for when there are real users.
- **Citywide parking map**: every scan has the data; it needs a share toggle, a viewer and the cold start solved.
- **Council-specific appeal auto-submit**: blocked by council captchas and no public APIs.

*Recently moved off this list: Web Push (VAPID + EventBridge Scheduler), and the notice lookup, weekly reminders, sharing and permits (roadmap 2, awaiting deploy).*

---

## 🎙️ Considered and deferred: voice confirmation

> **A feature we sketched, costed, then asked the harder product question about.**

- **The idea**: Web Speech API voice intents ("save", "cancel", "extend") to log or re-check a park without tapping. Per-locale intent matching for all 9 languages, rolled out English first, then the four well-supported non-English locales (zh-CN, ko, it, id), the rest gated on native-speaker validation
- **Why deferred**: product, not technical. Photographing a sign needs the phone in your hand, so by the time the camera's up, voice is redundant. The real cases (re-checking from a cafe with full hands, limited dexterity) are narrow and don't earn time over the larger items
- **What we kept**: the i18n constraints found while scoping. Speech recognition quality varies a lot by locale, and a feature that fails silently for some users is worse than none. If voice ever becomes a real request, that's the starting point
- **What this says about the process**: "considered and deferred" is a different verdict from "haven't built yet". Documented so the decision is visible, not the omission

---

## 🔌 Considered and deferred: offline or hybrid sign reading

> **An architectural pivot mapped end to end, sequenced for after launch data shows where Claude earns its keep.**

- **The idea**: Claude vision is the magic moment of the scan, the largest per-scan cost and the only mandatory network call. Five layers sit between photo and answer: OCR, symbol recognition, layout, rule parsing, rule application. The last two are easy on-device; the first three are where Claude earns its money.

- **Path A, full offline rip-and-replace.** A custom vision pipeline or fine-tuned VLM: 6 to 12 months with ML expertise, a realistic ceiling well below Claude on stacked Melbourne signs, a 200 to 500 MB model, battery drain and retraining cost. **Not shipping this.** The wrong call at portfolio scale.

- **Path B, hybrid, over months 2 to 4 after launch.** (1) a pure TypeScript rule-application library, (2) a cross-user GPS-cached scan store (anonymous, opt-in), (3) a pattern library for common Australian signs as a confidence-gated fast path, (4) OCR-assisted text-only Claude calls. Estimated: most scans served without vision, Claude as the fallback for novel or stacked signs, and a much lower cost per scan.

- **Path C, re-check from a shared cache (about a weekend).** The re-check already does text-only reasoning against rules from an earlier photo, for the same user nearby. Extending the cache across users (anonymous, opt-in) would cover most repeat-location scans. The seam is refresh mode in `lambda/index.js`.

- **Why deferred**: every path depends on usage data the launch hasn't produced. What share of scans are repeat locations? Which sign patterns dominate? Where does Claude succeed and fail? The feedback telemetry and the accuracy harness collect the seed of that.

- **What we kept**: the seam. Re-check proves the text-only path works, and the rule shape (`rules`, `observations`, `can_park_now`, `until`, `duration_minutes`, `confidence`) already lets the client reason about time. Every move above is additive.

- **What this says about the process**: ship the cloud version first (faster, better, easier to iterate), gather data, then decide what deserves to run on the device. "Not yet", not "never".

---

## 🌐 Considered and deferred: localising the marketing landing

> **The app works in 9 languages already. Translating the marketing wrapper around it earns less than it costs.**

- **The idea**: translate `parkproof.com.au/` into all 9 languages with `/zh-CN/`-style routes, hreflang tags and `Vary: Accept-Language` at the edge, the same pattern `/verify/` uses.

- **Why deferred**:
  - **Cost is high.** Nine marketing pages, and marketing copy is the least forgiving to translate: headlines need cultural translation, not literal. Every copy edit becomes 9 edits.
  - **The funnel already handles it.** The landing's language chip routes non-English visitors to `/app/`, which is fully translated. The English landing is a one-second waystation.
  - **The landing's audience skews English** (Reddit, LinkedIn, early word of mouth).

- **What we kept**: the seam. `/verify/` ships 9 locale folders generated by `scripts/_build_verify_pages.py`, and the CloudFront rewrite function already resolves `/zh-CN/index.html`.

- **What this says about the process**: translate what serves non-English users (the app, the PDF that outlives them, the verify page), not everything. Revisit if more than a fifth of `/app/` traffic arrives from non-English sources.

---

## How to use this list

**For a technical Reddit post** (r/aws, r/programming): "Built right" plus the async-polling and push lines under Smart polish. Lead with the one-Lambda design and the signed chain.

**For a consumer post** (r/Melbourne, r/SideProject): "The core moment", "A signed record of every park" and the languages line.

**For LinkedIn**: 5 to 7 of the most distinctive bullets, lead with the core moment, end with "built solo after redundancy, with a feature held back until a lawyer reads it".

**For an interview**: PM roles → "Safety gates", "When a fine arrives" and the held-back feature (scoping and the discipline of stopping). Engineering roles → "Built right" and the signed chain. Design roles → "Inclusion & access" and the vault identity.

**For Hacker News (Show HN)**: lead with "AI vision + a KMS-signed chain of evidence you can check with openssl", and link the build journal in the comments.

---

*Last updated: 9 Nov 2026 (T10 docs pass). When you ship a feature, add it to the relevant section.*
