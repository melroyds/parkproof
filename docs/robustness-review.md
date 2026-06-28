# ParkProof — Robustness & Security Review

*An adversarial robustness and security audit, run 2026-06-28 across seven independent lenses (error handling, input validation, auth, secrets/PII, data integrity, cost/abuse, client concurrency). Every finding was re-checked by a skeptic whose job was to refute it, and two load-bearing claims the skeptics disagreed on were resolved by hand against the deploy config and the live site. 23 findings survived: 3 High, 4 Medium, 16 Low.*

---

## The read

The security boundaries that matter most are sound. Tenant isolation on the read path is real: every JWT route derives identity from the validated Cognito claim and scopes DynamoDB and S3 to it ([cloud-sync.js:84](lambda/cloud-sync.js:84)), failing closed if the claim is missing, and S3 keys are built from the JWT sub, never the request body. There is no remote data-exposure path, no unauthenticated read of another user's data, no Critical. The PII scrub from the earlier audit held. Input is capped in the obvious places (feedback at 5000 chars, photo hashes validated as 64-char hex, device ids regex-checked). The signature design itself is sound: `signed_at` is server-set so the timestamp is trustworthy, and the payload commits to the photos by SHA-256 hash. This is not a breach-risk app.

The soft spots cluster in two places, and they are the two places that matter for what this product actually sells.

The first is the evidence chain, and the problem is a gap between what the signature proves and what the document implies. The signature binds the photos by hash, but the verification walkthrough the product hands a council never recomputes that hash, so a swapped photo passes "Verified OK" (H1). The driver's note is rendered inside the signed-looking PDF but is not in the signed payload and stays editable after signing (M2). Cloud-synced photos are re-served from mutable S3 with no hash check on read (a Low, because the only writer is the owner). The throughline: the cryptographic guarantee is narrower than the surrounding document suggests, and the one check that would make the photographic evidence tamper-evident is documented but never performed. For a product whose headline is "tamper-proof evidence," that is the finding to fix first.

The second is cost and degradation on the anonymous AI routes. The Claude vision endpoints are unauthenticated by design, and the only real ceiling on spend is the global Lambda concurrency cap. The one budget alarm that exists is reactive and cannot see the Anthropic bill at all (H3). Under that same load, a dropped async worker leaves the job stuck and the user gets a misleading "complex sign" message, which makes them retake and add more load at exactly the wrong moment (M1). These are wallet and availability issues, not data issues, but they are real and they bite during a launch.

There is also one genuine broken-access-control bug that the auth lens missed and a skeptic caught in passing: `/sessions/upload` lets the request body override the server-set tenant key (H2). It is a one-line fix and currently shielded only by the fact that a victim's Cognito sub is not public. That it works at all means write isolation is not actually being enforced by the server, which is a line you do not want to depend on a secret to hold.

**Two honesty notes on the audit itself.** The fan-out's headline cost finding claimed the anonymous routes "bypass the throttle entirely" via a CloudFront-to-Function-URL path. That is wrong: `deploy.sh` bakes the API Gateway URL into the client, the built bundle confirms it, the Function-URL provisioning script is uncommitted (a reverted experiment), and a live `POST /api/sign-translate` is served by S3, not a Function URL. The `api.ts` header comment describing that architecture is stale. The cost finding survives, but on a corrected mechanism: the concurrency cap, not a throttle bypass, is the ceiling. Separately, the cross-tenant write (H2) was a skeptic's aside that I confirmed and promoted, because it is more serious than the finding it was attached to.

---

## High

### H1. The verification walkthrough never re-hashes the photos, so a swapped photo still reads "Verified OK"
- **Lens:** data integrity. **Tag:** clear-fix.
- **What:** The signed payload contains `sign_photo_sha256` / `car_photo_sha256` / `ambient_photo_sha256` ([lambda/index.js:768](lambda/index.js:768)), but the published verification procedure only runs `openssl dgst -sha256 -verify` over the metadata text. No step recomputes the SHA-256 of the actual photo bytes embedded in the PDF and compares it to the hashes in the payload. The hash that would catch a swap is signed, printed, and never used.
- **Where:** [verify/index.html:302-313](migrations/two-app-architecture/landing-from-claude-design/verify/index.html) (openssl steps, no photo re-hash); `en.json:722-727` (PDF appendix steps, payload-only); [pdf.ts:649-698](src/lib/pdf.ts) (appendix prints payload + the same six steps). Worse, the PASS card at `verify/index.html:320` affirmatively claims "the photo hashes have not been altered."
- **Failure path:** A driver exports a genuine signed PDF, opens it in any PDF editor, and replaces the embedded sign or car photo with a different image (a cleaner sign, a different bay, one that hides a no-standing line). The `canonical_payload` and `signature_base64` text blocks are left untouched. A council officer follows the official verify page, runs the one openssl command, gets "Verified OK", and concludes the whole record including the swapped photo is authentic. The integrity guarantee the product sells is silently void for the photographic evidence, the part most likely to matter in a dispute.
- **Fix:** Add a mandatory step to both the verify page and the PDF appendix that runs `sha256sum` (or `openssl dgst -sha256`) on each extracted photo and compares it to the hash in the payload. Render the expected hashes as labelled, copy-pasteable lines next to each photo so a reviewer can check without parsing JSON. Until that ships, soften the PASS card to say the openssl check covers metadata only and the photos are unverified.

### H2. `/sessions/upload` lets the request body override the server-set tenant key (broken write isolation)
- **Lens:** auth / input validation. **Tag:** clear-fix.
- **What:** The DynamoDB item is built as `{ pk: pk(userId), sk: sessionSk(session.id), gsi_updated_at, ...session }` with the spread placed **after** `pk`/`sk` ([cloud-sync.js:131-136](lambda/cloud-sync.js:131)). In a JS object literal, later keys win, so a `session.pk` / `session.sk` in the request body overrides the server-derived values. The server's own write-scoping is silently defeatable by the caller. The same handler also writes the entire non-whitelisted session object, so any extra or oversized fields persist up to the 400KB item limit.
- **Where:** [cloud-sync.js:108-145](lambda/cloud-sync.js:108).
- **Failure path:** An attacker creates a Cognito account (self-serve or federated), then POSTs `/sessions/upload` with `session = { id, pk: "USER#<victim-sub>", ... }`. The PutCommand writes the row into the victim's partition. Targeting a specific victim requires their Cognito sub, which is a non-public UUID, so this is not trivially weaponizable today. But the control is broken regardless: write isolation is currently held only by sub being secret, not by the server enforcing it.
- **Fix:** Spread `...session` first, then set `pk` and `sk` after it so server values always win, or better, whitelist the persisted fields explicitly (`id, arrived_at, expires_at, location, rules, observations, chosen_label, confidence, no_sign, note, photo keys, signature`) and never read `pk`/`sk` from the body. The whitelist also closes the unbounded-write resource-exhaustion path. Add a serialized-size guard (reject items over ~50KB) before the put.

### H3. Anonymous Claude routes have only the concurrency cap as a cost ceiling, and the budget alarm cannot see the Anthropic bill
- **Lens:** cost / abuse. **Tag:** clear-fix (mostly).
- **What:** `POST /sign-translate` and `POST /draft-appeal` are unauthenticated and each runs a Claude Sonnet vision call (real dollars per call). They are behind the API Gateway throttle (25 req/s), but the throttle is not the binding constraint: the enqueue returns fast and the work runs in a self-invoked worker, so the effective Claude-call rate is set by the ~10 Lambda concurrency cap, roughly 15 calls/min. There is no per-IP limit, no CAPTCHA, no WAF, and no server-side image-size cap. The `$25` AWS Budgets alarm is reactive and covers AWS only; the Anthropic bill is billed separately and has no alarm at all.
- **Where:** [lambda/index.js:560-637](lambda/index.js:560) (translate, no size guard), [lambda/index.js:153-231](lambda/index.js:153) (appeal); throttle at [set-throttle.sh](scripts/set-throttle.sh) (API Gateway stage only); [billing-alarm.sh](scripts/billing-alarm.sh) (AWS-only, reactive).
- **Failure path:** An anonymous attacker scripts a loop POSTing images. Workers process at ~10 concurrent, sustaining on the order of `$10-27`/hour of Anthropic spend (roughly `$200-650`/day) with zero auth, and saturating the concurrency pool so legitimate users get the "complex sign" timeout (see M1). The only budget alarm in place never sees the Anthropic charge, so the spend is invisible until the Anthropic invoice.
- **Fix:** Put a real per-caller ceiling on the path: an AWS WAF rate-based rule on the distribution (or API Gateway), Lambda reserved concurrency on the worker so the cap is explicit, a lightweight CAPTCHA/Turnstile token on the anonymous enqueue, and an Anthropic-side spend alert independent of AWS Budgets. Pair with the server-side image-size cap in M3 to bound per-call cost.

---

## Medium

### M1. A dropped async worker leaves the job "pending" forever, and the client then shows a misleading "complex sign" message
- **Lens:** error handling. **Tag:** needs-judgment.
- **What / where:** Only the worker writes `done`/`error` back to the job row, and there is no DLQ, `onFailure` destination, or reserved concurrency anywhere ([lambda/index.js:1467](lambda/index.js:1467) enqueue, [:1528-1553](lambda/index.js:1528) the sole status writer; [api.ts:163-196](src/lib/api.ts) poll loop).
- **Failure path:** During a launch spike, a worker Event invocation is throttled, async-retried twice, throttled again, and with no DLQ the event is discarded. The row stays `pending`, the client polls 50 times over ~75s, then throws `complexSignMessage()`. The user blames their photo, retakes, and adds more load to the same exhausted pool, a self-amplifying failure during exactly the high-traffic moment.
- **Fix:** Give the worker reserved concurrency, and make a dropped failure observable: write an absolute deadline into the job row and have the status read (or a reaper) flip rows older than ~70s to `error` with a distinct reason. In `api.ts`, when the loop exits still `pending` vs the worker writing an explicit error, surface a "we are under heavy load, try again in a minute" message instead of the complex-sign copy.

### M2. The driver's note is shown inside the signed PDF but is not in the signed payload and stays editable after signing
- **Lens:** data integrity. **Tag:** needs-judgment.
- **What / where:** `session.note` renders in the evidence body ([pdf.ts:513-533](src/lib/pdf.ts)) above a signature appendix whose intro says the metadata below "has not been altered" (`en.json:713`), but `note` is absent from the signed payload ([lambda/index.js:755-772](lambda/index.js:755)) and editing it ([SessionDetail.tsx:215](src/components/SessionDetail.tsx)) does not invalidate or re-request the signature.
- **Failure path:** A user signs a session, later edits the note to add a favourable false context line, and exports. The fabricated note prints in the evidence body; the appendix below it still verifies "Verified OK". A reviewer treats the note as part of the attested record when it is unsigned free text the user can change at will.
- **Fix:** Either include `note` in the signed payload and clear the signature on edit (letting the retry path re-sign), or render the note in a visually distinct "unsigned, added by user" block outside the integrity boundary and have the appendix intro explicitly enumerate that the note is not covered.

### M3. No server-side cap on `image_base64` / `ticket_image_base64` size
- **Lens:** input validation / cost. **Tag:** clear-fix.
- **What / where:** Both vision handlers forward the raw base64 image to Claude with only a presence check ([lambda/index.js:603](lambda/index.js:603) translate, [:165](lambda/index.js:165) appeal). The client resize to ≤1200px is browser-only; the server never enforces it, so a direct caller can send images up to the ~6MB platform payload cap, each consuming several times the vision input tokens of a normal scan.
- **Failure path:** An attacker bypasses the browser and POSTs a maximally large image; the per-call Anthropic cost multiplies, compounding H3.
- **Fix:** Reject before the Claude call when `image_base64.length` exceeds a sane bound (~2.5MB base64, about a 1600px JPEG) with a "photo too large, retake" error, mirroring the existing hash/length caps elsewhere.

### M4. `/photos/presign` has no size condition and no per-user object cap
- **Lens:** cost / abuse. **Tag:** clear-fix.
- **What / where:** The presigned PUT carries no `ContentLengthRange` and there is no limit on how many sessionIds a user can presign ([cloud-sync.js:265-289](lambda/cloud-sync.js:265)); the evidence bucket, unlike the feedback bucket, has no lifecycle expiry or quota.
- **Failure path:** A single registered (even free federated) user loops `/photos/presign` with random sessionIds and uploads large objects (up to S3's 5GB single-PUT limit) into their own prefix, accruing storage cost with no per-account ceiling and no alarm that sees it.
- **Fix:** Add a `Conditions` `ContentLengthRange` (e.g. 1 byte to 6MB) to the presigned PutObjectCommand so S3 rejects oversized uploads, and enforce a per-user object/session cap before issuing presigns.

---

## Low

These are real but bounded: UX-degradation, telemetry, hygiene, or heavily-conditional. Grouped by lens; each has where and the fix.

**Error handling**
- **Undecodable photo strands the scan screen.** `handleFile` / `handleAmbientFile` have no try/catch and are called fire-and-forget, so a `resizeImageFile` rejection on a corrupt/zero-byte/unsupported-HEIC file leaves the user on the scan screen with no spinner and no error ([SignScanner.tsx:204-219](src/components/SignScanner.tsx), reject source [image.ts:50-59](src/lib/image.ts)). *Fix: wrap both in try/catch and show an inline "couldn't read that photo" error.* clear-fix.
- **Raw model/parse error strings surface verbatim.** The error view renders `view.message` directly ([App.tsx:473](src/App.tsx)), so internal strings like "Model returned malformed JSON: Unexpected end of JSON input" ([lambda/index.js:664](lambda/index.js:664)) reach the user. No PII or stack traces, but it reads as broken software at a trust-sensitive moment. *Fix: map the parse/no-content/refusal cases to friendly copy; keep raw detail in CloudWatch only.* clear-fix.
- **Fresh-device sync failure drops a returning user on the first-time landing.** If `/sessions/list` fails transiently, `performInitialSync` treats the cloud as empty, nothing lands in localStorage, `sessionCount` stays 0, and the home renders `LandingFeatures` as if brand-new, with no error or retry ([App.tsx:671](src/App.tsx), [:742](src/App.tsx)). No data loss (self-heals next load). *Fix: track sync outcome and show a "couldn't load your sessions, retry" banner instead.* needs-judgment.
- **Account deletion ignores DynamoDB `UnprocessedItems`.** `handleMeDelete` never inspects the batch-write response for throttled items (which do not throw), counts `deletedRows` unconditionally, then deletes the S3 objects and the Cognito user ([cloud-sync.js:392-468](lambda/cloud-sync.js:392)). A throttled batch can orphan session rows under a now-deleted account while reporting success. Rare on a single user's same-partition rows. *Fix: loop on `UnprocessedItems` with backoff and gate the Cognito delete on a clean sweep; remove the bogus `RequestTables` key.* clear-fix.
- **Transient 5xx on the status poll burns `MAX_POLLS`.** A 5xx on the status GET does `continue` without a separate budget ([api.ts:167-172](src/lib/api.ts)), so a flaky status route can exhaust the 50 polls and throw the timeout error even though the result is sitting `done` in DDB. *Fix: do one final non-skipping read on exit, or cap transient-error polls separately.* needs-judgment.

**Input validation**
- **`media_type` is unvalidated.** Both handlers place the client-supplied media type straight into the Claude image source with no allow-list ([lambda/index.js:562](lambda/index.js:562), [:161](lambda/index.js:161)). Base64 not URL, so no SSRF; worst case is an Anthropic 400 surfaced as a 500 on the caller's own request. *Fix: allow-list `image/{jpeg,png,webp,gif}`, coerce otherwise.* clear-fix.
- **`current_datetime` lets an anonymous caller spoof "now".** Intended as a dev-time override, it is read verbatim from the public `/sign-translate` body and used as the time context for the verdict ([lambda/index.js:581](lambda/index.js:581)). A caller can fudge their own parking verdict; no third-party victim, and the signature never attested the verdict-time anyway. *Fix: gate it behind a dev-only env flag; in prod always use server time.* clear-fix.

**Auth**
- **Job-status endpoint is a capability URL.** `GET /…/status/{job_id}` returns the full result keyed on the `job_id` alone, with no caller binding ([lambda/index.js:1486-1522](lambda/index.js:1486)). The id is a 122-bit UUID with a 10-minute TTL, so brute force is infeasible; the only realistic vector is id leakage (logs, proxy, shoulder-surf), exposing one job's result, which for `/draft-appeal` can include the appeal letter's personal details. *Fix (optional hardening): return a second `job_token` secret required on the status read, and consume `/draft-appeal` results once.* needs-judgment.

**Secrets / PII**
- **Appeal model output logged verbatim on parse failure.** On a JSON parse failure the handler logs the full raw appeal text, which can embed the user's address, GPS, and infringement details ([lambda/index.js:250](lambda/index.js:250)). Bounded: log retention is 30 days (set in commit 937958d), the trigger is a parse failure despite schema enforcement (rare), and the audience is IAM insiders, not external. *Fix: log only `stop_reason` + length + a hash, or gate raw text behind a debug env flag.* clear-fix.
- **Anonymous feedback PII has no erasure path.** `/user-feedback` writes a self-supplied email plus free text to CloudWatch and S3 under an anonymous UUID ([lambda/index.js:990](lambda/index.js:990), [:998-1008](lambda/index.js:998)); `/me/delete` queries by Cognito sub and so cannot reach it. The CloudWatch copy has no explicit retention. An APP-13 erasure-process gap, not a breach. *Fix: set a short CloudWatch retention on the log group and document the feedback-store deletion procedure.* needs-judgment.

**Data integrity**
- **Cloud photos are re-served with no hash re-check.** The signed `*_photo_sha256` is computed only at sign time; no read path (hydrate, materialize, PDF embed) recomputes it ([sync.ts:261-278](src/lib/sync.ts)). A tampered cloud object is served as authentic. Bounded because presign keys are JWT-sub-scoped, so the only writer is the owner (self-tampering) or a full account compromise, and the verify page already scopes the claim to integrity-since-saving. Shares the fix with H1: make the hash load-bearing on read. needs-judgment.

**Cost / abuse**
- **Anonymous `/user-feedback` writes an unbounded S3 object + log per call.** No per-IP/device cap ([lambda/index.js:998-1008](lambda/index.js:998)); rate-bounded by the throttle and the ~10 concurrency cap, but each call is a small PutObject retained two years. Fractions of a cent per call, so an attacker hits the expensive Claude routes first. *Fix: rides the WAF rate rule from H3, plus a per-device soft cap.* needs-judgment.
- **Anonymous `/sign-session` runs a KMS Sign per call.** Unauthenticated, one billed KMS asymmetric Sign each ([lambda/index.js:778](lambda/index.js:778)). KMS Sign is ~`$0.03`/10k and concurrency-bounded, so worst-case spend is trivial; not a confidentiality issue (public verification is by design). *Fix: cover it under the same WAF rate rule.* needs-judgment.

**Concurrency**
- **Save button has no double-submit guard.** `saveSession()` mints a fresh UUID per call with no in-flight flag ([SessionLogger.tsx:499-504](src/components/SessionLogger.tsx)), so a double-tap creates two distinct sessions, each firing its own KMS sign + S3 upload + DDB write, and orphans a duplicate in history. Self-inflicted, fractions of a cent. *Fix: add a `submitting` flag with `disabled`, mirroring `ParkingResult`'s save.* clear-fix.
- **Mirror can lose a race with delete and resurrect a session.** Delete and the cloud mirror are both fire-and-forget with no tombstone or ordering ([SessionDetail.tsx:147-177](src/components/SessionDetail.tsx) vs [sync.ts:343-351](src/lib/sync.ts)). A `retryPhotoSync` upload in flight can land after `/sessions/delete`, re-creating the row the user erased; it re-pulls to other devices next sync. Needs a same-device retry-then-delete within ~1-2s, recoverable by deleting again. *Fix: a short-lived client tombstone the upload path consults, or a per-session op queue.* needs-judgment.
- **Feedback verdict buttons double-log on a double-tap.** `submitFeedback` fires with no in-flight guard and a stable per-render `feedback_id` ([ParkingResult.tsx:331-359](src/components/ParkingResult.tsx)), and the server does not dedup by `feedback_id`, so a double-tap over-counts the accept/retake telemetry the dashboards rely on. Telemetry only. *Fix: disable after first click, or dedup server-side by `feedback_id`.* clear-fix.

---

## Suggested order

1. **H1 and H2 first.** Both are clear-fix and both touch the product's core promise: H1 makes the photo-integrity claim real (add the re-hash step to the verify page and PDF, fix the PASS copy), H2 closes the write-isolation hole (reorder the spread or whitelist the fields, a one-line change). H2 in particular should not wait, because relying on a secret sub for write isolation is not a posture to commercialise on.
2. **H3 next**, because it is the one that can quietly cost real money during a launch and the budget alarm cannot see it. The server-side image cap (M3) is the cheap first half; the WAF rate rule and an Anthropic-side alert are the durable half.
3. **M1**, because it lands precisely when traffic is highest and turns a capacity blip into a self-amplifying retake loop.
4. **M2 and M4**, then the Low cluster as hygiene.

Nothing here is a data breach or a remote-exploitable Critical. The work is to make the evidence chain prove what the document claims, and to put a real ceiling and an honest alarm on the anonymous AI routes before they are commercialised.
