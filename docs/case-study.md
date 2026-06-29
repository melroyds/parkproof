# ParkProof — a PM case study

_Mobile-first PWA. Photograph an Australian parking sign, get a plain-English "can I park now?" verdict in seconds, and save a timestamped, GPS-tagged, cryptographically-signed evidence record you'd use to dispute a wrongful ticket. Built solo across ten active days (16–25 May 2026), launched 26 May; ~$5/month to run; nine locales; **zero real users.**_

[Live →](https://www.parkproof.com.au) · [Source →](https://github.com/melroyds/parkproof)

This is a craft project built to show how I scope, sequence, and trade off as a PM, not a startup attempt. The honest framing up front: the market is thin, there's no clean monetisation path, and no real user has ever used it. What it's optimised for is demonstrating range and decision-making on a real, shipped, working product. Read it for the decisions, not the metrics, there are no real metrics yet, and the case study says so wherever it matters.

---

## 1. The problem, and who it's for

Inner-city Australian parking signs stack three or four overlapping rules on one pole: time windows, side-specific arrows, permit-zone overlays, ticket-machine bays. They're dense by design (councils maximise revenue per pole), and they're genuinely hard to read correctly. Existing apps (ParkingMate.ai, Parky.AI) translate the rules well, but stop there. None capture the evidence you'd need to dispute a wrongful ticket later.

ParkProof does both: translate the sign, **and** capture the timestamp + GPS + the sign-as-it-appeared + the car at the spot. That turns a council dispute from "your word against the officer's" into "here is what was on the pole at 11:42, and here is the time-math that says I was within the rules."

**The user is one person:** a driver who has already had one wrongful-feeling ticket and has decided they don't want a repeat. Mobile, one-handed, standing at the pole. Every other decision cascades from that persona (see §3).

**Who it is explicitly _not_ for:** casual once-a-week parkers (they'll guess or use Maps), fleet managers (a different product, multi-user, audit trails, billing, the willingness-to-pay segment, see §6 probe 4), council officers, and people who dispute every ticket on principle (a feature, not a customer). Naming the non-users is itself the scoping discipline this project is meant to show.

**Honest scale:** this is an annoyance, not a pain. Small TAM. As a venture it's weak; as a craft project, the narrowness forced ruthless scoping.

---

## 2. How it works, at a glance

An installable React 19 + Vite PWA on CloudFront (private S3 behind Origin Access Control). You photograph a sign; the browser POSTs the image to a **single AWS Lambda** that calls Claude Sonnet 4.6 vision with JSON-Schema-enforced output and adaptive thinking.

The load-bearing engineering decision is in that path. Stacked signs take Claude 30–50s to read carefully, but API Gateway's HTTP API caps a request at 30s. Rather than fight the ceiling, the fresh-scan path is **async**: the Lambda writes a `pending` row to a TTL'd DynamoDB jobs table, self-invokes as its own worker (`InvocationType: 'Event'`), and returns `202 + job_id` in under a second; the client polls a sub-second `GetItem` status endpoint. A "refresh" re-check (prior rules + current time, no image) is text-only and stays synchronous, ~4× cheaper. One Lambda dispatches 18 routes across three invocation modes (HTTP handler, self-invoked worker, EventBridge push-dispatch target) and is reused verbatim as the local dev proxy via a Vite plugin, one handler, two runtimes, no mocks.

Everything is **anonymous and `localStorage`-first.** Optional Cognito sign-in mirrors sessions to DynamoDB and photos to a per-user S3 prefix; the local copy stays canonical. Reminders fan out to a calendar `.ics` VALARM, an in-tab notification, and a server-side Web Push scheduled via one-shot EventBridge schedules. Evidence export is a multi-page, localised jsPDF document with a KMS-signed appendix.

---

## 3. Key product decisions (what I chose, and what I deliberately didn't build)

Each row is the decision, the trade-off accepted, and the alternative consciously rejected.

| Decision | Chose | Trade-off accepted | Deliberately did **not** build |
|---|---|---|---|
| **Vision model** | Sonnet 4.6 (adaptive thinking, schema-enforced) | ~3× the per-scan cost and 6–12s latency | Haiku 4.5 (cheaper/faster). Tried and rejected: it supports no thinking and inverted earliest-vs-farthest leave-by on stacked signs, "park until 6pm" became "until 11pm". Cost/correctness only trades one way here. |
| **Account model** | Anonymous-by-default, `localStorage` canonical, opt-in cloud sync never gated | Built the canonical session schema twice (local + cloud) and a 3-phase quota-recovery system; resisted every retention-funnel instinct | The default SaaS sign-up wall. The target user was just screwed by an institution; they will not make an account before translating a sign. |
| **Evidence integrity** | KMS ECDSA P-256 signature over canonical metadata + in-browser SHA-256 photo hashes, with an `openssl dgst -verify` recipe in the PDF | ~$1/mo and apparatus no real user has exercised | A plain self-held hash (the user could alter the photo and re-hash, so it proves nothing) or no integrity layer. |
| **The 30s gateway ceiling** | Async-polling via a TTL'd jobs table + self-invoke | A small polling state machine and a jobs table | Streaming (the gateway buffers anyway) or a longer-timeout integration. The pivot _removed_ complexity rather than adding it, the tell of a good one. |
| **i18n language set** | English + the top non-English languages spoken at home in the City of Melbourne LGA (2021 ABS Census): Mandarin, Vietnamese, Indonesian, Korean, Italian, Greek, Hindi, Punjabi | A build-time font-subsetting pipeline (jsPDF ships zero CJK/Devanagari/Gurmukhi/Greek glyphs) | The generic "translate all the major world languages" default. The signal is the data-driven _method_, not the count. |
| **Cross-device photo access** | Server-side proxy: a JWT'd `/photos/materialize` endpoint where the Lambda fetches S3 and returns base64 through the trusted API origin | Slightly heavier responses | The textbook presigned-S3-URL pattern. Rejected after three separate mobile-only failures (S3 CORS drift, an AWS SDK checksum-header regression, a 5G carrier interaction with long STS URLs) proved it has too many failure modes invisible from the server. |

**Shelved on purpose, each with an explicit re-trigger** (the discipline of stopping):

- **Citywide rules heatmap** — genuine data moat (every scan captures rules + GPS), but a map with five points is worse than none. Trigger: a few hundred consistent users, or a council partnership.
- **Auto-submit appeals to councils** — externally blocked, not just deferred: council captchas, login walls, no public APIs. The realistic version is deep-linking a council's existing form with metadata pre-encoded.
- **Voice confirmation** — deferred on _product_ grounds: snapping a sign means the phone is already in hand, so voice is redundant for the core case.
- **AI feedback Layer 3** (opt-in photo capture of failures) — gated until Layer 2 surfaces a specific failure mode worth the photo-storage and a privacy-policy line.
- **Offline on-device sign reading** — Path A (full offline VLM) rejected outright: ~70–80% accuracy vs ~95%, 200–500MB bundle, frozen at model-release date. Hybrid paths deferred until launch data exists.
- **Native apps / Play Store, a premium tier, multi-city, a 9-language marketing landing** — each off the roadmap for stated reasons (PWA covers the value; anonymous-first leaves no clean charge; the prompt hard-encodes AU conventions; the acquisition audience is English-first).

---

## 4. What it demonstrably signals (grounded in the code)

Honest strength rating in brackets, this is what a technical reviewer can verify, not what the README claims.

- **Mobile PWA [strong].** `vite-plugin-pwa` in `injectManifest` mode with a hand-written `service-worker.ts` (precache + Web Push receiver + notification-click), a two-app architecture (marketing at `/`, PWA at `/app/`) resolved by a CloudFront viewer-request function, plus real mobile-first UX: silent GPS on the scan screen, a photo-quality pre-flight (Laplacian-variance blur + Rec.709 luminance) _before_ spending a token, walk-back map deep-links, a live countdown card.
- **AI vision [strong].** Schema-enforced Sonnet 4.6 vision + adaptive thinking; a ~1700-token system prompt that does real domain modelling (orthogonal permit/disability/paid flags vs parkability; a worked "compute `until` = earliest leave-by across all rules" section added to fix a real regression; payment-sticker detection). Two genuinely distinct AI features (sign translate, and infringement-notice read + appeal-letter draft). A staged feedback telemetry design (verdict + model-context to CloudWatch, no PII).
- **AWS infra [strong].** One Lambda, 18 routes, three invocation modes; Cognito JWT authorizer; DynamoDB (sessions, TTL'd jobs, push subs); S3 (OAC static, per-user evidence, lifecycle'd feedback); KMS; EventBridge Scheduler; CloudFront. Operational maturity past demo level: per-IP rate limiting via a DDB counter that fails _open_, a 5-min warmer ping, idempotent re-runnable deploy scripts, a billing alarm, a rollback playbook, and a `/me/delete` that drains DynamoDB `BatchWrite` `UnprocessedItems` with backoff before deleting the Cognito user, so erasure can't report false success.
- **Cryptographic evidence integrity [strong].** The rare case where "cryptographic" is fully earned: hash in the browser, sign canonical metadata + hashes with a hardware-backed ECDSA P-256 key whose private half never leaves AWS, ship the public key PEM at `/parkproof-public-key.pem`, and print a self-contained `openssl` verification recipe so no party needs ParkProof in the loop. A background sweep re-signs sessions that failed mid-flight.
- **Multi-locale i18n [strong].** Nine fully-populated locale files (not stubs, non-Latin scripts run 80–97KB vs ~48KB for English) with `react-i18next` auto-detection. The evidence PDF itself is localised and lazy-loads per-locale subsetted Noto Sans fonts. **Caveat:** the AI's sign-translation _output_ deliberately stays in English (it mirrors the literal sign); the localisation is the app shell and the evidence document.
- **Civic-utility product thinking [solid].** Visible in the artifacts, not just claimed: the MVP rule ("every v1 feature must end in a submittable evidence record"), the deferral list with named build-triggers, anonymous-first justified from the persona, a no-sign mode for unsigned spots, a driver's-note field for human context in a council review, and evidence-strength honesty baked into the appeal prompt (it rates a case `weak` when there's no saved evidence).

---

## 5. Honest limitations

- **Zero real users.** Every feedback loop (verdict telemetry, the user-feedback channel) is designed and wired but has never been fired by a real person. Every product decision below is self-graded by the person who made it.
- **AI accuracy is unmeasured.** There is no labelled eval set and no real verdict data, so "the translator is correct" is asserted, not demonstrated. This is the load-bearing unknown (see §6 probe 1).
- **The crypto is aspirational.** No ParkProof PDF has been used in a real dispute. The signature proves _integrity_ (the record wasn't altered), not _legal weight_ (that a council will rule your way). The app says so; the case study should never call it a "moat".
- **No monetisation path.** By design, anonymous-first leaves no clean way to charge without degrading the free experience. This is the portfolio gap ParkProof does not fill (the next piece, SubToll, covers B2C monetisation).
- **Australia-only.** The prompt hard-encodes AU conventions (AEST/AEDT, "P" notation, ACROD, council language). It does not generalise without prompt re-engineering and likely home-market accuracy loss.
- **GPS is unreliable** indoors, in multi-storey carparks, and on desktop (IP coords can be kilometres off). Mitigated honestly: accuracy >100m is treated as untrusted, the PDF discloses accuracy, and the app falls back to manual entry.
- **The stepped loading bar is a timed simulation** tuned from CloudWatch latency, not real token streaming (the gateway buffers). Functionally fine, not literally live.
- **Error handling for opt-in cloud features is "warn-and-swallow",** which once caused a two-day silent photo-upload failure (S3 CORS drift after a domain migration) caught only by dogfooding, not alerting.

---

## 6. What a hiring PM would probe — and how this story should answer

These are the five doubts that surfaced independently across multiple senior-PM reads. They are the real ones.

**1. "It's an AI-in-the-loop product. How do you know the translator is _accurate_, not confidently wrong?"**
The whole evidence value-prop rests on the AI being right, and the only accuracy mechanism is a feedback button no one has pressed. There is no eval harness and no labelled test set.
_Preempt, honestly:_ build a 30–50 sign labelled corpus (real Melbourne poles, hand-computed correct answers) and report measured accuracy _plus_ failure classes. Frame the staged telemetry as the _production_ complement to that eval, not as the validation itself. This is the single highest-leverage thing missing.

**2. "The KMS evidence chain, no council has accepted it and you concede it proves integrity not legal weight. Differentiator, or engineering theatre?"**
It's the headline feature and admittedly aspirational, which reads as falling in love with the artifact.
_Preempt:_ downgrade the language everywhere from "moat" / "regulatory recognition" to "integrity guarantee" (the app copy already does this; the older docs slipped). Make the bet explicit and falsifiable: the cheap validation I _could_ have run first (show one council's review form and confirm it accepts attachments), and the condition that would have killed the feature.

**3. "Zero users, every decision self-graded. Walk me through one where _data_ changed your mind, not a trade-off you reasoned out in advance."**
Almost every decision here is framed as correctly-reasoned up front, which is the failure mode of solo work.
_Preempt:_ surface the genuine reversals, and there are real ones: `localStorage`-first then adding cloud sync once "what if they lose the phone before disputing?" became concrete; deferring Web Push then building the full pipeline after dogfooding showed I kept ignoring the calendar reminder; redesigning the cross-device photo path away from presigned URLs after three real mobile failures; the pre-launch audit catching six-of-nine locales rendering PDFs as glyph boxes. Frame each as "I assumed X, reality showed Y, I changed course."

**4. "Anonymous-first means no clean monetisation. Handed a revenue target, what would you actually do?"**
A consumer/platform PM needs business-model instinct, and the portfolio openly lacks it. "Revisit it for a startup" is a deflection.
_Preempt:_ name the willingness-to-pay wedge already in the spec, the fleet/tradie/professional-parker segment, sketch a freemium line that doesn't degrade the anonymous core (team evidence vaults, bulk export, an audit trail), and bridge explicitly to SubToll, the portfolio piece built to carry the monetisation signal.

**5. "Your own numbers don't agree, and the '12-second' promise hides the hard case."**
Per-scan cost appears as ~$0.02, ~$0.05, and ~$0.015 across the docs; language and commit counts drift between files; and the "~12 seconds" headline is the simple-sign path, while the stacked signs that are the _reason the product exists_ take 30–50s. A PM who cites cost discipline as a principle should have clean unit economics.
_Preempt:_ pin one canonical per-scan cost derived from real CloudWatch token usage and use it everywhere. Separate the latency paths openly, 8–12s simple, 30–50s stacked, which is _why_ async-polling and the stepped loader exist. Reconcile the figures across the docs, and clarify that every "spotted live" bug was me dogfooding on real signs, not an external user.

---

_Contact: hello@parkproof.com.au_
