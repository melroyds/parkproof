# ParkProof test strategy

_A risk-targeted account of what is tested, what is deliberately not, and why. The governing principle: test the **deterministic logic** and the **trust-critical chains** (signature, evidence, de-identification) hard, because those fail silently; do not waste effort mocking what a real browser, a real model, or a trusted library already exercises._

## The one-paragraph posture

ParkProof has 112 passing unit tests across 5 files, and they are good tests, the time-and-timezone math, the countdown urgency tiers, the walk-back distance logic, and the localStorage quota recovery are all covered with edge cases and DST-survival assertions. But the coverage is concentrated in the **display layer**, and it thins out exactly where the product's credibility lives: the **KMS signature canonicalization, the photo-hash evidence leg, the cloud-sync photo path, and the de-identification surfaces have zero unit coverage.** Those are the paths that, if they regress, corrupt evidence or leak PII without throwing an error in dev. This document says so plainly and ranks the gaps. The companion [`qa/e2e-test-suite.md`](qa/e2e-test-suite.md) is the manual launch gate that catches what unit tests structurally can't.

## What IS worth unit-testing

Three categories earn unit tests, in priority order.

### 1. Trust-critical chains (highest value, currently the weakest)

These are the features the whole product stakes its credibility on. A silent regression here is worse than a crash, because it ships "Verified OK" over broken evidence.

| Chain | What must hold | Coverage before this pass |
|---|---|---|
| **Signature canonicalization** (`lambda/index.js` `canonicalize()` + `handleSignSession`) | The Lambda's canonical bytes must be byte-identical to what the openssl verifier re-hashes. Sorted keys, no whitespace, stable null-vs-omitted coercion, stable number formatting. | **ZERO.** No golden-vector test pinned the canonical bytes. _This was the single highest-value gap in the codebase._ |
| **Photo-hash leg** (`src/lib/signing.ts` `hashDataUrlImage` ↔ the PDF's "recompute SHA-256" step) | The hash signed at save time must match a re-hash of the photo a verifier can actually obtain. | **ZERO, and broken by construction** — see the P0 finding below. |
| **Unsigned-session retry** (`signing.ts` `retryUnsignedSessions`) | Pure, time-injectable candidate selection: 30-day horizon, 3-attempt cap, 5-min throttle, NaN-age guard. A regression either hammers the Lambda on every mount or silently never retries, leaving sessions unsigned (weak evidence) with no error. | **ZERO.** |
| **EventBridge safety** (`isSafeSessionId`, `toSchedulerAtExpr`) | `isSafeSessionId` is a name-injection / 64-char-overflow boundary; `toSchedulerAtExpr` is the exact timezone-formatting class of bug ParkProof has been bitten by (a stray `Z`/offset makes every push reminder fail to schedule). | **ZERO.** |

### 2. Pure, deterministic app logic (good ROI, easy)

Logic that takes inputs and returns outputs with no I/O. Fast to test, and a regression ships a visibly-wrong UI. Mostly uncovered before this pass:

- `photo-quality.ts` — blur/dark/overexposed/tiny verdict **precedence** (the deliberate "dark before blurry" ordering) and thresholds.
- `ics.ts` — VALARM offset sorting, "at expiry" vs "N min before" wording, city-label derivation, pluralisation.
- `parking-apps.ts` — `payAppsToShow` normalisation/promotion/cap and `launchUrlFor` per-platform link shape (the feature just shipped; the `intent://` string is the kind of thing that breaks invisibly).
- `api.ts` — `friendlyErrorFor` (the guarantee no raw system string reaches a user) and `endpointUrl` (the dev-vs-prod path swap).
- `accuracy.ts` / `verify-url.ts` — tiny, pure, the GPS-radius unit-switch boundary and the locale→verify-URL map.

### 3. Already-covered display logic (keep green)

`countdown.ts`, `time-format.ts`, `walk-back.ts`, `storage.ts`, and the refresh-mode **contract** in `refresh.test.js` (which correctly tests the wiring, model id, thinking config, schema, prompt content, not the model's answer). `storage.ts` is the best-tested module and is the template to copy: a hand-rolled fake `Storage` to defeat happy-dom's Proxy, time injected as a parameter, every branch of the 3-phase quota recovery asserted.

## What is deliberately NOT unit-tested (and why)

This is not laziness, it is scope discipline. Each of these is covered by a *different* technique, named in brackets.

- **Claude's sign-reading correctness** — whether the model gets the leave-by math right on a stacked sign is non-deterministic model output. Unit-testing a mock of it proves nothing about the real answer. _[Covered by: the `npm run eval` accuracy harness against a ground-truthed corpus, plus the in-app feedback telemetry once there are users. `refresh.test.js` tests the wiring around the call, which is the right unit-level thing to pin.]_
- **AWS SDK round-trips** — KMS Sign, DynamoDB Get/Put, S3 presign, EventBridge, Cognito admin. These are network- and IAM-dependent. The deterministic *logic* around them is extractable and should be tested; the `.send()` itself is not unit material. _[Covered by: `scripts/smoke-test-auth.mjs` and live smoke tests.]_
- **Third-party libraries** — `ics` RFC-5545 serialisation, `tz-lookup` coordinate mapping, jsPDF rendering, the AWS SDK internals. Trust the dependency; test only our inputs to it. _[Covered by: the dependency's own test suite.]_
- **Browser / canvas / DOM primitives** — `createImageBitmap`, canvas pixel reads, `FileReader`, `Notification`, `navigator.geolocation`, the service worker. The pixel-math in `photo-quality`/`image.ts` is deterministic *given a pixel buffer*, but the decode+draw path needs a real browser and isn't worth shimming. _[Covered by: the manual e2e suite and `screenshots.mjs` Playwright harness.]_
- **React UI and the `App.tsx` state machine** — rendering and interaction are integration/e2e territory. _[Covered by: the manual e2e suite.]_

The honest line: anything whose failure is **loud** (a crash, a build error, a blank screen) can lean on the e2e gate. Anything whose failure is **silent** (a wrong signature that still says "Verified", a dropped photo the UI doesn't flag, an address that shouldn't be in the payload) must have a unit test, because no human will catch it in a 30-minute launch pass.

## The highest-risk untested paths (ranked)

### P0 — Evidence-chain integrity (RESOLVED — see the verify-walkthrough fix)

**1. The photo-hash leg (RESOLVED).** Previously the PDF told a verifier to recompute the SHA-256 of an embedded photo and match it to the signed value, which could *never* pass because jsPDF re-encodes embedded images. Fixed by scoping the claim honestly (option b): the embedded photos are now described as a re-encoded visual copy, the signature commits to the SHA-256 of each *original* photo (printed in the payload and confirmed by the metadata signature), and step 7 tells a verifier to hash the *original captured file* to confirm a specific image. Verified end-to-end: hashing the original file with `openssl dgst -sha256` reproduces the signed value exactly.

**2. The metadata signature now verifies externally (RESOLVED).** The canonical bytes are pinned by the golden-vector test, and the walkthrough no longer depends on lossy copy-paste. The PDF now prints the payload as base64 and the verifier runs `base64 -d`, which ignores the PDF's line wrapping and adds no trailing newline, recovering the exact signed bytes. Verified end-to-end against a real KMS signature: the new method returns `Verified OK` (even with an apostrophe in the payload), while the old `echo`-with-trailing-newline method returns `Verification failure`, confirming the original bug and the fix. This closes (a) the trailing-newline break, (b) the wrapped-transcription break, and (c) the format-drift break (pinned by the test).

### P1 — Silent data loss and PII

**3. The cloud-sync "warned-and-swallowed" photo path** (`sync.ts` `uploadSession`/`performInitialSync`). This is the exact failure that already cost a silent 2-day photo loss in May. A photo PUT fails, `photoFailed` is set, but the session row still writes. Nothing tests that the failure actually surfaces to the UI banner. **ZERO coverage.**

**4. Free-text feedback PII** (`lambda/index.js` `handleUserFeedback`). The message (up to 5000 chars) is logged verbatim to CloudWatch (no retention set = effectively indefinite) and mirrored to S3 for 2 years, with **zero redaction**. The "no PII beyond what the user provides" framing is backwards: the message *is* the PII surface, the field where a user pastes an address or plate. **ZERO coverage**, and arguably a data-handling fix, not just a test.

**5. Address de-identification is effectively absent** (`geocode.ts` `formatAddress`). It concatenates `house_number + road` into a precise street address that flows into (a) the KMS-signed payload, permanently attested and in the cloud, (b) the appeal letter sent to Claude (the appeal prompt *claims* the address is omitted, but only for the sign-off, the cited GPS address is still included), and (c) the PDF. No granularity guard, no test. The "partly reversed de-id" state is invisible to CI.

### P2 — Resilience paths

**6. The async-poll worker** (`handler` `_async_kind` branch + `handleJobStatus` deadline). A worker that dies mid-call, or a job that 404s after TTL sweep, can strand a polling client. `refresh.test.js` covers `translateSign` directly but not through the job machinery. **PARTIAL.**

## What changed in this pass

Closed the pure-upside, zero-runtime-risk gaps with real tests (the trust-critical *logic*, not the AWS round-trips). New files:

- **`lambda/sign.test.js`** — golden-vector test pinning `canonicalize()` output byte-for-byte, the null/omitted coercions, the 64-char-hex photo-hash validation branches, plus `isSafeSessionId` and `toSchedulerAtExpr` (UTC formatting, no trailing `Z`). Required exporting those functions from `index.js` (a no-op for runtime behaviour).
- **`src/lib/signing.test.ts`** — `retryUnsignedSessions` candidate selection (horizon, cap, throttle, NaN-age) and `hashDataUrlImage`.
- **`src/lib/pure-logic.test.ts`** — `parking-apps`, `api` (`friendlyErrorFor`/`endpointUrl`), `accuracy`, `verify-url` pure helpers.

The two P0 evidence-chain *product* bugs (the photo-hash leg, the verify-walkthrough newline) were flagged here and then fixed in a dedicated follow-up pass (the base64 verify walkthrough + honest photo-claim wording, verified end-to-end with openssl against a real KMS signature) rather than rushed inside the test-coverage commit, because a careless fix to the signing flow makes the evidence *worse* while still printing "Verified." The P1 PII issues (cloud-sync silent photo loss, free-text feedback retention, address de-identification) remain open for their own passes.

## Running the tests

```bash
npm test            # vitest, the whole suite
npm test -- --watch # iterate
npm run eval        # the separate accuracy harness (real Claude calls, needs a corpus)
```

CI (`.github/workflows/test.yml`) runs the suite on push; remember the explicit `cd lambda && npm ci` step, the Lambda's AWS-SDK deps are not in the root `node_modules`, so `lambda/*.test.js` fails to resolve without it.
