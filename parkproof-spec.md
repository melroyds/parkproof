# ParkProof — Product Spec

> Mobile-first installable PWA for Australian drivers. Photograph any Australian parking sign → plain-English answer to **"Can I park here right now?"** → log a timestamped, GPS-tagged evidence record → calendar reminder before parking expires → export a tamper-proof PDF for infringement disputes. (Not legal advice; the cryptographic signature proves the record wasn't altered after it was saved, not that a council or court will rule in the driver's favour.)

---

## The problem

Australian parking signs — especially in inner-city Melbourne, Sydney and Brisbane — are notoriously dense. A typical pole stacks 3–4 signs with overlapping time windows, side-specific arrows, permit-zone overlays, and ticket-machine bays. Drivers either:

- Skip the spot and park further away (often unnecessarily — they could have parked there)
- Park anyway and risk a $99–$300+ infringement
- Get a ticket and lack contemporaneous evidence to dispute it

Existing apps (ParkingMate.ai, Parky.AI, SIGNlanguage) translate the rules but provide **no evidence trail**. ParkProof does both.

## Target user

- Australian urban drivers, primary Melbourne (then Sydney / Brisbane)
- Smartphone-first, mostly iPhone Safari with growing Android Chrome share
- Already mildly anxious about parking enforcement
- Willing to trade 60 seconds of capture effort for confidence + dispute leverage

Secondary: small-fleet operators (couriers, tradies) who get many infringements per year.

---

## User flow

```
[Arrive at spot]
       ↓
📷 Photo of the parking SIGN
       ↓
AI translates → "Yes, you can park here. Move by Thu 10:00 am (2h 14m left)."
       ↓
(if multiple zones) Pick your position → resolved per-side answer
       ↓
📷 Photo of your CAR at the spot   ← optional but recommended
       ↓
App creates a "Parking Session" record:
  • Sign photo + AI-read rules + observations
  • Car photo (if provided)
  • Timestamp (arrival, ISO 8601 with TZ)
  • GPS coordinates + reverse-geocoded address (editable)
  • Cryptographic signature (AWS KMS, ECDSA P-256)
       ↓
"Set a reminder for 9:45 am?" → [.ics calendar] or [browser notification]
       ↓
       [Later, if needed]
       ↓
Export session as PDF evidence
       │
       └──→ (got a ticket?) → "Draft an appeal letter" → AI cross-references
                                   ticket photo with the evidence and drafts
                                   a formal council appeal
```

---

## MVP scope

The build was scoped tight: a weekend POC, then ~2 weeks of iteration. P0/P1 are the foundation; P2 is the polish that made the result feel like a real product.

| Priority | Feature | Why |
|---|---|---|
| **P0** | Sign translation + "can I park now" answer | Core value prop |
| **P0** | `.ics` calendar reminder | Works on every platform without server infrastructure |
| **P0** | AWS Lambda backend (no API key in the browser) | Security floor |
| **P1** | Session logger (car photo, GPS, timestamp, address) | The "evidence" half — what makes ParkProof different from competitors |
| **P1** | PDF evidence export | The user-facing artefact for actual disputes |
| **P1** | Session history + detail + delete | Personal archive of saved evidence |
| **P1** | Browser notification (in-tab) | Fallback reminder; honest about its limitations |
| **P2** | Reverse + forward geocode (Nominatim) | Human-readable addresses; editable when the AI gets the spot wrong |
| **P2** | Smart re-scan from history (proximity match + recent picker) | UX win for spots the user revisits |
| **P2** | AI feedback loop (verdict telemetry) | Measure whether the AI is actually right; informs prompt iteration |
| **P2** | AI-written appeal-letter drafting | End-to-end "got a ticket → here's your draft" workflow |
| **P2** | Cryptographic evidence signing (AWS KMS) | Tamper-evidence trail; regulatory-recognition moat |
| **P2** | Position-clarification for stacked / arrowed signs | Accuracy on the hardest real-world signs |
| **P2** | Timezone derived from coordinates | Works correctly outside Melbourne |
| **P2** | Live countdown + stepped loading state | Perceived-latency polish |
| **P2** | Installable PWA (manifest + service worker + icons) | Real home-screen install, fullscreen, offline-capable |

---

## Features in detail

### 1. Sign Translator
- Upload or capture a photo of any Australian parking sign
- Send to Claude Sonnet 4.6 vision with adaptive thinking enabled
- Return a JSON-schema-enforced response: rules, observations grouped by sign element, current can-park-now status, leave-by timestamp, duration, confidence, and an optional clarification block for position-dependent signs
- Display: big green ✓ / red ✗ at the top, sign observations grouped by arrow direction, live time-to-fine countdown

### 2. Parking Session Logger
- After translation, prompt: "Log your parking to protect against a wrongful ticket"
- Silent GPS request (timezone-aware: derived from lat/lng via `tz-lookup`)
- Reverse-geocode to a human address (Nominatim); user can edit if wrong, forward-geocode replaces the coords
- Optional car photo (camera or library, downsized to ≤1200px for storage quota)
- Save to `localStorage` — device-local by deliberate choice
- **End-of-session signal** — when the driver leaves, an "I've left" action stamps an `ended_at` timestamp on the record. **Mandatory** for no-sign sessions (no posted expiry to fall off naturally). **Optional shortcut** for sign-translated sessions when the driver leaves early — the evidence PDF then surfaces both the sign's posted expiry *and* the actual driver-signalled departure time + computed duration.

### 2b. No-Sign Mode
- Entry-point on the scan screen: "No sign here? Just log my park →"
- Captures an *ambient surroundings* photo (substitutes for the missing sign photo as visual evidence of "no posted restrictions at the time of parking") plus the same GPS + address chain
- No AI call — no token spend, no sign translation; the record's `rules` is empty and `confidence` is N/A
- Open-ended on the home "Currently parked" card: elapsed-time copy ("Parked for 2h 14m") and a neutral palette in place of the urgency colour grammar; ends only on the driver's explicit "I've left"
- Use case: open carparks, quiet residentials, apartment laneways — and the defensive case where a council later puts up a sign claiming the spot was restricted all along

### 3. Departure Reminder (both options offered)
- **`.ics` calendar event** — RFC 5545 compliant with `GEO` field; works on iPhone, Android, Outlook even with ParkProof closed. The primary reminder mechanism.
- **In-tab browser notification** — `setTimeout` + `Notification` API. Honest about its limitation (only fires while the tab is open). Backup option.

### 4. Evidence PDF Export
- Multi-page PDF: title, ParkProof Guidance one-liner, evidence table (timezone-correct arrival, address, GPS + accuracy, map link, sign rules), sign photo on page 1, car photo with address + timestamp overlay-burnt-in
- Final appendix page: cryptographic signature block + `openssl` verification walkthrough
- Suitable for attachment to a council infringement review

### 5. AI Appeal Letter
- User receives a ticket → opens the matching session → "Draft an appeal letter"
- Photo of the infringement notice → Claude reads it, cross-references with the saved evidence
- Returns: ticket summary, evidence-strength assessment (strong/moderate/weak), editable formal-English letter, strategy notes
- Copy to clipboard or download as PDF (letter + supporting evidence bundle)

---

## Claude API approach

- **Model**: `claude-sonnet-4-6` — vision-capable, supports adaptive thinking and JSON-schema-enforced outputs
- **Thinking**: `adaptive` for multi-rule time-window reasoning ("compute leave-by per rule, take the earliest"). Without this, stacked-sign math regresses badly (Haiku 4.5 was tested and rejected for this reason).
- **Effort**: `low` — keeps end-to-end latency in the 6–12s range vs ~20s on `medium`
- **Output enforcement**: `output_config.format` with a strict JSON schema. The model literally cannot return malformed JSON.
- **Prompt design**: explicit "HOW TO COMPUTE `until`" reasoning section with worked examples to lock the algorithm
- **Cost**: ~$0.02 per scan; ~$0.005 per smart-rescan (no vision call)
- **Refresh mode**: when the user re-uses a saved session within proximity + freshness window, the same Lambda handler runs a text-only call (no image) — 3× faster, 4× cheaper

---

## Tech stack

| Layer | Choice |
|---|---|
| UI | Vite + React 19 + TypeScript + Tailwind CSS v4 |
| PWA | `vite-plugin-pwa` (manifest + service worker + auto-generated icons) |
| AI | Anthropic Claude Sonnet 4.6 via `@anthropic-ai/sdk` |
| Backend | AWS Lambda (Node.js 20) + API Gateway HTTP API |
| Hosting | S3 (private) + CloudFront with Origin Access Control |
| Crypto | AWS KMS asymmetric key (ECDSA P-256) for evidence signing |
| Geocoding | OpenStreetMap Nominatim (in-browser, cached) |
| Timezone | `tz-lookup` (offline polygon library) |
| Calendar | `ics` (RFC 5545) |
| PDF | `jsPDF` + `jspdf-autotable` |
| Telemetry | CloudWatch Logs Insights (structured event lines) |
| Storage | `localStorage` (device-local; no backend database) |

---

## Out of scope (deliberate POC discipline)

The following are intentionally NOT built. Each has a clear trigger that would justify revisiting later.

| Feature | Why deferred | Trigger to revisit |
|---|---|---|
| User accounts / authentication | Anonymous-by-default cuts friction + privacy complexity | A real user wants cross-device recovery |
| Cross-device sync | Requires a backend database (DynamoDB + S3 photos) | Users complaining about losing data on browser wipe |
| True background push (Web Push protocol) | Calendar `.ics` covers the "closed-app reminder" need | Users miss reminders because `.ics` import fails |
| Auto-submit infringement appeals to councils | No public APIs; captchas + login walls | A council exposes a real submission API |
| Native iOS / Android apps | PWA + Add-to-Home-Screen covers most of the value | App Store presence becomes a real channel |
| Multi-language sign support | Aussie-only market for now | Demand from NZ / UK / other RHD English markets |
| Council appeal deep-linking | Each council is bespoke; high research overhead | A specific council partnership |
| Voice confirmation ("Hey ParkProof…") | Browser support flaky in PWA-installed mode on iOS | Accessibility becomes a primary requirement |

---

## Success metrics

- **Time to first answer**: < 12s end-to-end on a typical scan
- **Accuracy**: > 70% positive verdict on AI feedback Layer 1 (user-marked "looks right" after a scan)
- **Cost discipline**: < $3/month operating cost at portfolio scale (low traffic); < $0.02 per scan in Anthropic API spend
- **Privacy**: zero PII collected server-side; user data on-device only
- **End-to-end demonstrable**: a real user can scan → log → get a reminder → export a PDF → walk into a (hypothetical) council appeal with everything they need

---

## Differentiators vs competitors

| Feature | ParkProof | ParkingMate.ai | Parky.AI | SIGNlanguage |
|---|---|---|---|---|
| Sign translation | ✓ | ✓ | ✓ | ✓ |
| Time-aware "park now?" answer | ✓ | ✓ | ✓ | ✓ |
| Position-clarification for stacked signs | ✓ | partial | ✗ | ✗ |
| GPS + timestamped arrival log | ✓ | ✗ | ✗ | ✗ |
| Car-at-the-spot photo evidence | ✓ | ✗ | ✗ | ✗ |
| PDF for council disputes | ✓ | ✗ | ✗ | ✗ |
| **Cryptographic evidence signing** | ✓ | ✗ | ✗ | ✗ |
| **AI-drafted appeal letter** | ✓ | ✗ | ✗ | ✗ |
| Smart re-scan (proximity + history) | ✓ | ✗ | ✗ | ✗ |
| Calendar (`.ics`) reminder | ✓ | ✗ | ✓ | ✓ |
| Browser notification reminder | ✓ | ✗ | ✗ | ✗ |
| Installable PWA | ✓ | ✗ | ✗ | ✗ |
| Anonymous-by-default (no login) | ✓ | login | login | login |

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Claude API rate-limit / outage | Graceful error UI; `set-throttle.sh` caps abuse; user can re-attempt; API Gateway 30s timeout surfaces clearly |
| Stacked-sign translation accuracy | Adaptive thinking + worked examples in system prompt; per-variant clarification flow; AI feedback loop catches regressions |
| `localStorage` quota overflow | Photos resized to ≤1200px @ JPEG 0.82 before storage; defensive `QuotaExceededError` handling |
| GPS unreliable in indoor / multi-storey carparks | Treat accuracy > 100m as untrusted; surface warning; push user to manual address entry; PDF discloses GPS accuracy honestly |
| Cryptographic provenance only useful if recognised | Council outreach pipeline (City of Yarra pilot proposed); openssl verification path is independent of ParkProof trust |
| Anthropic SDK / model deprecation | Lambda model string is a single line to change; structured output makes prompt changes safe |
| Cost runaway from bot abuse | `set-throttle.sh` caps API at 20 burst / 10 sustained req/sec; `billing-alarm.sh` emails at $8 actual / $10 forecast |

---

## Design principles

- **Mobile-first.** Used on the street, one-handed, in a hurry
- **Big tap targets.** Buttons are thumb-friendly
- **Instant feedback.** Loading screen shows real model phases, not a generic spinner
- **Green / red clarity.** The can-park-now answer must be immediately obvious
- **Anonymous-by-default.** No login, no email, no PII. Sessions are device-local
- **Honest disclosure.** When evidence is weak (low GPS accuracy, low confidence), the app says so — better for credibility than overselling
- **Tight feedback loop.** Every result has a "Yes, looks right / Retake" prompt that feeds CloudWatch for prompt iteration

---

## Status

See [`README.md`](README.md) for the user-facing summary of what's live, and [`CLAUDE.md`](CLAUDE.md) for engineering notes (model config, AWS resource IDs, gotchas, file layout).
