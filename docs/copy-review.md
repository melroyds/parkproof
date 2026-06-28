# ParkProof — Copy & Microcopy Review

*A seven-lens adversarial copy audit (clarity, consistency, tone, register, microcopy, i18n-readiness, punctuation), run 2026-06-29. Findings were skeptic-verified so intentional voice survives, with special attention to raw system strings that can reach a user screen and to the highest-anxiety surfaces. The fan-out hit API rate-limiting partway, so the terminology lens was rebuilt by hand from `en.json`; the raw-error lens, the priority, came through complete.*

---

## 1. The voice, in one line

**A warm, plain-spoken Australian who has already done the worrying for you: wry and generous in the marketing, calm and exact the moment your money or your evidence is on the line.**

Inferred from the strongest existing copy: *"You probably came here thinking oh, it reads parking signs. It does. But while it's at it, we figured we'd also save the evidence..."* (`about.lead`), *"A few small kindnesses"* (`about.kindnesses`), *"Built solo, free forever. If it saved you from a ticket, chip in for the AWS bill"* (`about.support`). That voice is a real asset and most of this review is about protecting it from drift, not changing it.

---

## 2. Terminology glossary

One canonical term per concept, with the deviating sites. Where the canonical is a judgment call, it is flagged and carried into section 4.

| Concept | Canonical (recommended) | Deviating sites (file:line) | Note |
|---|---|---|---|
| A saved parking event | **session** / "parking session" | "evidence record" ([en.json:182](src/locales/en.json:182), [:189](src/locales/en.json:189), [:203-204](src/locales/en.json:203), [:233](src/locales/en.json:233), [:464](src/locales/en.json:464)); "tamper-proof record" ([:276](src/locales/en.json:276)); "park" / "the spot" ([:55](src/locales/en.json:55), [:328](src/locales/en.json:328)) | "session" is the de-facto term (history, detail, "End session"), but it is mildly technical. "evidence record" is warmer and on-brand. Pick one for user-facing surfaces (section 4). |
| The reminder | **reminder** / "remind" | "ping" / "pinged" ([en.json:210](src/locales/en.json:210), [:343](src/locales/en.json:343), [:346](src/locales/en.json:346), [:411](src/locales/en.json:411)); "nudge" ([:64](src/locales/en.json:64)) | Clear drift. "ping" reads techy, "nudge" is a one-off. Standardise on "reminder"/"remind". Mostly mechanical. |
| The tamper-proof claim | **(pick one consumer term)** | "digital seal" ([en.json:58](src/locales/en.json:58)); "tamper-proof" ([:276](src/locales/en.json:276), landing); "cryptographically signed" ([:156](src/locales/en.json:156), [:430](src/locales/en.json:430), [:759](src/locales/en.json:759)); "cryptographic signature" ([:335](src/locales/en.json:335), [:591](src/locales/en.json:591), [:709](src/locales/en.json:709)) | Four names for one thing, on a legal surface. Reserve "cryptographic signature" for the technical/verify/PDF context; pick one consumer term (section 4). |
| AI interpreting the sign | **read** (plain) or "translate" | "translate" (in-app, many); "decode" ([en.json:150](src/locales/en.json:150), [:168](src/locales/en.json:168), landing); "read" (colloquial) | The user "scans"; the app "reads/translates". "decode" is a marketing flourish. Worth one canonical for the in-product action. |
| A photo | **photo** | "image" ([en.json:215](src/locales/en.json:215), [:218](src/locales/en.json:218), [:222](src/locales/en.json:222) in the quality warnings) | Minor. "photo" everywhere except a few scanner quality strings. Safe swap. |
| Signing in | **sign in** | none found | Already consistent. Good. |

---

## 3. Mechanical fixes (safe to apply)

### 3a. Raw error strings reaching users (the priority)

The app has a systemic pattern: catch an error, render `err.message` verbatim. A stressed user standing at a sign, or assembling evidence for a dispute, can be shown a developer string. Six distinct sites; the fix in every case is the same shape, show a fixed friendly line, keep the raw text in `console.error`/CloudWatch only.

| Site | Current | Suggested |
|---|---|---|
| **The main scan-error screen** renders `{view.message}` verbatim ([App.tsx:497](src/App.tsx:497)), fed by the async worker's raw error ([lambda/index.js:1636](lambda/index.js:1636)) rethrown by `postJsonAndPoll` ([api.ts:200](src/lib/api.ts:200)). A raw Anthropic SDK error (overloaded/529, rate-limit) or a DDB throttle can become the whole error body. | `throw new ApiError(payload.error \|\| 'Background job failed', 500, false)` | Map any non-`JOB_TIMED_OUT` job error to a friendly line, e.g. a new `errors.scanFailed`: "We couldn't finish reading that sign. Try again, or retake the photo a little clearer." Raw text to console only. |
| **The Lambda dispatcher** returns `{ error: err?.message \|\| String(err) }` on every 500 ([lambda/index.js:1557](lambda/index.js:1557) and ~11 siblings). | `{ error: err?.message \|\| String(err) }` | Return a single friendly localisable string (reuse `errors.somethingWrong`, [en.json:644](src/locales/en.json:644)); keep `err.message` in the CloudWatch `console.error` line. |
| **SessionDetail PDF error** renders raw `{pdfError}` between the friendly header and help line ([SessionDetail.tsx:564](src/components/SessionDetail.tsx:564)). | `{pdfError}` | Drop the raw line from the UI (the header + help already cover it); keep `console.error`. |
| **AppealFlow PDF error** renders raw `{pdfError}` with NO help line, on the just-got-a-ticket surface ([AppealFlow.tsx:221](src/components/AppealFlow.tsx:221)). | `<p ...>{pdfError}</p>` | Drop the raw line, or at minimum append the existing `session.pdfErrorHelp` ([en.json:456](src/locales/en.json:456)) that SessionDetail has and this omits. |
| **AuthSettings export error** renders raw `{exportError}` under no header ([AuthSettings.tsx:133](src/components/AuthSettings.tsx:133)); can show `sync.ts` "API 500: ..." or "Not signed in". | `setExportError(err.message)` | Fixed line: "Couldn't build your export just now. Please try again in a moment." Raw to console. |
| **api.ts status fallbacks** render `Request failed (502)` / `Status check failed (404)` ([api.ts:119](src/lib/api.ts:119), [:180](src/lib/api.ts:180)) on the long-tail non-transient path. | `` `Request failed (${resp.status})` `` | Reuse the friendly `errors.somethingWrong`-style copy; status code to console only. |
| **FeedbackModal** renders `err.message` when it is a `UserFeedbackError`, which can carry a raw "API 500: ..." detail ([FeedbackModal.tsx:147](src/components/FeedbackModal.tsx:147)). | `err instanceof UserFeedbackError ? err.message : t('feedback.error.generic')` | On a 500/parse error, fall back to `feedback.error.generic` rather than rendering the carried detail. |

Note the skeptic's corrections, folded in: the named examples "KMS_KEY_ID env var not configured" / "session_id required" are thrown on the sign-session and push routes, which are called via fetches that swallow errors and never reach `view.message`, so those specific strings do not leak. The leak is real via the async-worker and PDF/export paths above.

### 3b. Other mechanical fixes

| What | Current | Suggested | Where |
|---|---|---|---|
| The api.ts English fallback for the complex-sign timeout has **drifted from the canonical en.json** despite a "Keep them in sync" comment. | "...crop to just the part you need decoded." | Make byte-identical to en.json: "...crop in to just the rules that apply where you're parked." | [api.ts:246](src/lib/api.ts:246) vs [en.json:647](src/locales/en.json:647) |
| Two active-card **aria-labels are hardcoded English** assembled around localised data, so non-English screen-reader users hear English glue. | `` aria-label={`Active parking session at ${addr}, ${countdown}. Tap for details.`} `` | Add `active.cardAria` / `active.listCardAria` i18n keys with `{{address}}` / `{{status}}` and `t(...)` them. | [ActiveSessionCard.tsx:180](src/components/ActiveSessionCard.tsx:180), [ActiveSessionsList.tsx:97](src/components/ActiveSessionsList.tsx:97) |
| The morePill **inline `defaultValue`** is a stale, un-pluralised duplicate of the canonical key. | `defaultValue: 'View {{count}} more active session'` | Drop the inline default; the pluralised `active.morePillAria_one/_other` is the source of truth. | [ActiveSessionCard.tsx:152](src/components/ActiveSessionCard.tsx:152) |
| "ping/pinged" → "reminder/remind" (glossary). | "Next ping", "you want to be pinged", "When should we ping you?" | "Next reminder", "you want to be reminded", "When should we remind you?" | [en.json:210](src/locales/en.json:210), [:343](src/locales/en.json:343), [:346](src/locales/en.json:346), [:411](src/locales/en.json:411) |
| "image" → "photo" in the quality warnings (glossary). | "the AI may misread it" uses "image" | "photo" | [en.json:215](src/locales/en.json:215), [:218](src/locales/en.json:218), [:222](src/locales/en.json:222) |

---

## 4. Voice & naming calls (your decision)

Tiered by how much they matter, each with the trade-off. These are yours to make, not safe to apply blind.

### Tier 1

**The em-dash. 113 of them** (81 in `en.json`, 32 on the landing). Your own allergy aside, this is a real density: the dashes give a breathless, dashed-off energy that suits the chatty marketing, but they fragment sentences and, on the serious surfaces, a comma or full stop reads steadier and more trustworthy. **The call:** a considered reduction, not a blanket swap. Keep a few where the aside genuinely lands; replace them with commas/periods on the high-anxiety and legal surfaces (the gates, the privacy policy, the appeal disclaimers, the error copy) where the dash undercuts the gravity. Trade-off: lose a little of the conversational rhythm, gain calm and a house style you can actually hold to. *(Worth a single deliberate pass, since it touches ~113 strings across 9 locales.)*

**The disability-permit gate moralises** ([en.json:290](src/locales/en.json:290)). On a $400-fine surface a user glances at one-handed, the copy adds *"the social cost, taking a bay from someone who needs it, is real."* Its two sibling gates (pay, permit-zone) inform via rule plus fine with no lecture; only this one editorialises about the user's character, and it is delivered to the honest permit-holder whose acknowledgement is literally "I have a valid disability permit." Current: *"...is an offence. In Victoria the fine is $400+ and the social cost, taking a bay from someone who needs it, is real. If you don't have one, scan a different spot."* Suggested: *"...is an offence. In Victoria the fine is $400 or more, and the bay is reserved for people who need it. If you don't have one, scan a different spot."* Trade-off: loses a beat of civic conscience the author clearly intended; gains register consistency and stops scolding the person who is actually reading it. The deterrent (it's an offence, $400+) carries the gate on its own.

### Tier 2

**Pick one name for the tamper-proof claim.** "digital seal" / "tamper-proof" / "cryptographically signed" / "cryptographic signature" all name the same thing across a legal surface (see glossary). Suggested: one warm consumer term (e.g. "tamper-proof seal") for the marketing and in-app surfaces, with "cryptographic signature" reserved for the verify page, the PDF appendix, and the privacy policy where precision is the job. Trade-off: consistency and a clearer mental model vs the slight loss of each term's individual flavour.

**Pick one name for the saved event: "session" or "evidence record".** "session" is established and everywhere, but it is the most technical word in the consumer UI; "evidence record" is warmer and squarely on-brand for an evidence product. Suggested: lean "evidence record" on user-facing copy, keep "session" only where it is genuinely a data/technical reference. Trade-off: a warmer, more legible product vs a non-trivial find-replace across history, detail, and the gates.

**Soften the landing's "±5 m" GPS claim** ([landing index.html:395](migrations/two-app-architecture/landing-from-claude-design/index.html:395)). The product hedges GPS hard (`logger.gpsImprecise` warns "could be the wrong suburb entirely"; the PDF carries a "GPS accuracy notice"), but the landing states a flat *"Co-ordinates accurate to ±5 m."* Suggested: *"GPS-anchored arrival, reverse-geocoded to a street address"* (drop the absolute, or qualify "in good conditions"). Trade-off: the crisp number reads impressively, but it over-claims against your own honesty pitch and is exactly the kind of absolute a sceptical council could call out.

**Collapse the three-key hero headline.** `heroTitle1` "Parking" + `heroTitle2` "made" + `heroTitle3` "simple." ([en.json:127-129](src/locales/en.json:127)) are concatenated, which assumes English word order and pins the brand-blue accent to the third fragment. This is already shipped harm: `el.json` sets `heroTitle3` to a literal space, so the accent styles nothing. Suggested: one key rendered via `Trans` with an inline emphasis marker (`"Parking made <accent>simple.</accent>"`). Trade-off: real translatability and movable emphasis vs touching the per-fragment styling.

**Localise the friendly Lambda error strings.** The model-parse and size/type errors we already softened are good English, but they are hardcoded in the Lambda ([index.js:225,228,648,651](lambda/index.js:225) etc.), so a Korean or Vietnamese user still sees English on these high-frequency, user-fixable paths. Suggested: return an error code from the server, resolve it to a localised string client-side (`errors.imageTooLarge`, `errors.signUnreadable`, etc.). Trade-off: 8 locales get localised errors vs a small code-to-string mapping layer (the Lambda can't easily read the user's locale).

---

## What is strong (filtered, so the list reads calibrated)

- **The voice itself.** The marketing copy is genuinely good, warm, plain, self-aware. Most of this review is about protecting it from drift.
- **"Sign in"** is consistent throughout. No "log in" drift.
- **Pluralisation** is done correctly with `_one`/`_other` keys across the board.
- **The model-parse and auth errors** were already softened in the robustness pass (the audit verified, not re-flagged, those).
- **The gates' core seriousness** (pay, permit-zone) is well-judged; only the disability gate over-reaches.

---

## Method note

The consistency/terminology lens and several microcopy skeptics were lost to API rate-limiting mid-run, so section 2 (the glossary) was rebuilt by hand from `en.json` rather than from the fan-out, and a few low-value mechanical microcopy nits (button-punctuation polish) were not exhaustively swept. The raw-error lens, the priority, ran to completion and is reflected in full in section 3a. If you want the microcopy lens swept exhaustively (every button label and empty state), that is a clean follow-up.
