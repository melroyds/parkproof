# CLAUDE.md: ParkProof engineering notes

Quick context for AI assistance on this codebase. Read this before touching things. Checked against the code on `integration/roadmap-2` at `09d5c24` (9 Nov 2026).

## What this is

Mobile-first installable PWA for Australian drivers. Photograph a parking sign → Claude vision answers "can I park now?" as schema-enforced JSON → optionally log a **parking record** (GPS, address, car photo, optional condition photos and proof of payment) → ParkProof's server signs it with a KMS key, and every later part (departure, handover, photos) is signed as a link in a chain → reminders by push, in the open tab and by `.ics` → later, an evidence PDF or evidence file, a notice lookup ("Got a fine? Start here") and an AI-drafted appeal letter. Weekly reminders for street sweeping, saved permits, share links and handovers sit around that. Workday mode (moving the car between time-limited spots all day) is built but switched off in production (see Status).

The user-facing noun is "parking record" or "record". Code still says `session` everywhere (`ParkingSession`, `parkproof.sessions.v1`); never put "session" in copy.

Live: <https://www.parkproof.com.au> (custom domain on Cloudflare DNS, CloudFront-fronted). Apex `parkproof.com.au` and both forms of `parkproof.au` 301-redirect to the canonical via Cloudflare Page Rules. Hosted on AWS in `ap-southeast-2`. Production runs `main` (the evidence chain, T0a to T1b, field-tested on real AWS on 8 Nov 2026). `integration/roadmap-2` is not deployed yet: [`docs/build/deploy-checklist-roadmap-2.md`](docs/build/deploy-checklist-roadmap-2.md) is the runbook.

See [`parkproof-spec.md`](parkproof-spec.md) for the original product brief, [`docs/build/roadmap-build-spec.md`](docs/build/roadmap-build-spec.md) for the roadmap tasks (T0a to T10) and their copy, i18n and design rules, [`README.md`](README.md) for the user-facing version, and [`docs/lessons-for-next-project.md`](docs/lessons-for-next-project.md) for the portable takeaways.

## Run it

```bash
npm install
(cd lambda && npm ci)                          # the dev proxy and the Lambda tests import the AWS SDK from lambda/
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env     # required for real scans
npm run dev                                    # → http://localhost:5173/app/
```

- `npm run dev` turns workday mode on (`VITE_FEATURE_WORKDAY` unset means on in dev, off in any build).
- `/api/sign-session` in dev signs with an ephemeral P-256 key (`key_alias: 'dev-ephemeral'`), never KMS. Never set `KMS_KEY_ID` locally.
- Gate before you finish any change: `npx tsc -b`, `npx vitest run`, `npx eslint src vite.config.ts vitest.config.ts lambda` (no new problems), and `npx vite build --outDir <scratch folder>` (never into `dist/`).

## How the backend works

There is **one** Lambda function (`parkproof-sign-translator`) with path dispatch in [`lambda/index.js`](lambda/index.js) `handler()`. The order matters: `event.warmer` → `event._async_kind` (worker, push dispatch) → `OPTIONS` → any path with `/status/` → the push routes (`/push/recurring/cancel` before `/push/recurring`) → `/user-feedback` before `/feedback` → `/draft-appeal` → `/read-notice` → `/sign-session` → the JWT routes → anything else falls through to `handleSignTranslate`.

**Anonymous routes** (no auth; per-IP limits are counted in the jobs table and fail open):

| Route | Handler | Purpose |
|---|---|---|
| `POST /sign-translate` | `handleSignTranslate` → `translateSign` | Two modes, inferred from the body (below). Fresh mode is **async**: 202 + `job_id`, 20 a minute per IP. Refresh mode answers inline. A bad `user_permits` or `parking_state` is a 400 with an ERR code |
| `GET /sign-translate/status/{job_id}` | `handleJobStatus` | Poll target for sign and appeal jobs: `{ status, result, error }`. Refuses notice jobs. `JOB_TIMED_OUT` once a pending job passes its 70 s deadline |
| `POST /draft-appeal` | enqueue, then `handleDraftAppeal` in the worker | Reads the notice photo and drafts an appeal letter from the chosen record. **Async**, 10 a minute |
| `GET /draft-appeal/status/{job_id}` | `handleJobStatus` | Same route family as above |
| `POST /read-notice` | `handleReadNotice`, then `readNotice` in the worker | Reads an infringement notice photo into `NOTICE_SCHEMA` fields (T8). **Async**, 10 a minute. Bad image: 400 with an ERR code |
| `GET /read-notice/status/{job_id}` | `handleJobStatus` with kind `read-notice` | Serves notice jobs only. Deletes the row once it hands back a finished result, and never serves a row past its `ttl` |
| `POST /sign-session` | `handleSignSessionRequest` | Signs link 0 (`parkproof-evidence-v1` or `-v2`) or an addendum (`parkproof-addendum-v1`) with KMS ECDSA P-256, after the server checks below. 30 a minute. Validation failures are 400 + ERR code |
| `POST /feedback` | `handleFeedback` | "Did we read this right?" telemetry. Logs `[parkproof.feedback]` with whitelisted fields only (the privacy policy lists them) |
| `POST /user-feedback` | `handleUserFeedback` | Free-text feedback, 10 a minute. Logs `[parkproof.user_feedback]` and mirrors to the feedback bucket at `YYYY-MM-DD/{uuid}.json` |
| `POST /push/subscribe` | `handlePushSubscribe` | Stores the device's push subscription (conditional Put). 409 `ERR_ENDPOINT_GONE` for an endpoint already tombstoned |
| `POST /push/schedule` | `handlePushSchedule` | One-shot EventBridge schedules for a record, at most 6. Needs `device_id` and only replaces schedules that device owns (403 `ERR_NOT_OWNER`). 409 `ERR_NOT_SUBSCRIBED` when the device has no live row |
| `POST /push/cancel` | `handlePushCancel` | Deletes a record's one-shot schedules, owner only |
| `POST /push/recurring` | `handlePushRecurring` | Weekly reminders (T5b): replace-all for one rule's cron schedules, owner only, 30 a minute |
| `POST /push/recurring/cancel` | `handlePushRecurringCancel` | Deletes one rule's cron schedules, owner only, 30 a minute |

**JWT-authenticated routes** (Cognito access token, checked by the API Gateway authorizer before the Lambda runs; handlers in [`lambda/cloud-sync.js`](lambda/cloud-sync.js) scope everything to the token's `sub`):

| Route | Handler | Purpose |
|---|---|---|
| `POST /sessions/upload` | `handleSessionsUpload` | Writes a record with a conditional `rev` check (up to 3 tries) and the server merge: addenda unioned by id (signed copy wins, a stored signed addendum is never dropped, at most 20), `signature`, `ended_at` and `departure` kept when the incoming row lacks them, last write wins for the rest. Only `ALLOWED_SESSION_FIELDS` are stored |
| `GET\|POST /sessions/list` | `handleSessionsList` | The caller's records (consistent read), with legacy photos re-minted |
| `POST /sessions/delete` | `handleSessionsDelete` | One record, and its S3 photos |
| `POST /photos/presign` | `handlePhotosPresign` | Short-lived presigned `PUT` for one photo: `{ session_id, sha256 }` for photo refs, the legacy role form for old records |
| `POST /photos/materialize` | `handlePhotosMaterialize` | Returns a photo's bytes as base64 through the API (the browser never fetches private S3 directly) |
| `GET\|POST /me/export` | `handleMeExport` | Every record of the caller as JSON |
| `POST /me/delete` | `handleMeDelete` | Deletes the caller's rows, S3 photos and Cognito user |

**Not HTTP:** `{"warmer": true}` returns at once (a hand-made `parkproof-warmer` schedule, if it exists; no script makes it). `_async_kind: 'sign-translate' | 'draft-appeal' | 'read-notice'` is the self-invoked worker (`handleAsyncWork`). `_async_kind: 'push-dispatch'` is a one-shot reminder firing (`handlePushDispatch`), `'push-recurring'` a weekly cron firing (`handleRecurringPushDispatch`, which decides fortnightly and nth-weekday rules from the occurrence date in the rule's zone).

`translateSign` has **two modes**:

1. **Fresh read**: body has `image_base64`. Vision call with the current time in the spot's time zone (from the coordinates via `tz-lookup`), the saved permits and the parking state. Async only (202 + job).
2. **Refresh** (re-check): body has `prior_rules` + `prior_observations` (and echoes `prior_sign_status`, `prior_sign_issues`, `prior_is_area_sign`). No image; text-only reasoning about whether the recorded rules allow parking now. Synchronous, about 3× faster and 4× cheaper. Workday stops are never re-checked (it would give a car that hasn't moved a new arrival).

**Async polling** (`/sign-translate`, `/draft-appeal`, `/read-notice`): stacked signs can take 30 to 50 s, past API Gateway's hard 30 s limit. The route writes a `pending` row to `parkproof-jobs` (TTL attribute `ttl`, 10 minutes), self-invokes with `InvocationType: 'Event'` and returns `202 { job_id }` in under a second. The worker writes `done` or `error`. The client polls `<route>/status/{job_id}` every 1.5 s (`postJsonAndPoll` in `src/lib/api.ts`, which also accepts a plain synchronous result). `job_id` is the bearer credential. DynamoDB's TTL sweep is lazy, so the notice route checks `ttl` itself; the shared status route doesn't.

**Server checks before signing an addendum** (build spec N2): the parent's signature verifies against the public key embedded in the Lambda (`ERR_PARENT_SIGNATURE`); same `session_id`, and `seq` follows the parent (`ERR_PARENT_MISMATCH`); `sha256(chain_key)` equals the chain's `chain_key_sha256` (`ERR_CHAIN_KEY`); no client time more than 5 minutes after server time (`ERR_FUTURE_TIME`); parent payload at most 16 KB, body at most 32 KB. Validation (`lambda/addendum-schema.js`) rejects, never repairs: every key required, unknown keys and control characters refused. It runs before the `KMS_KEY_ID` check.

The Lambda is **reused as the local dev proxy**: a Vite plugin in [`vite.config.ts`](vite.config.ts) mounts `/api/*` middlewares that import `lambda/index.js` in-process. In dev, `/api/draft-appeal` and `/api/read-notice` run the job synchronously (`runJobNow`), `/api/sign-session` uses the dev signer, the JWT routes decode the bearer token without verifying it, and `/api/push/subscribe` and the two weekly push routes are stubs that log (`/api/push/schedule` and `/api/push/cancel` have no dev middleware, so one-shot push isn't testable locally). Never call the Anthropic API from the browser; the key stays server-side.

## Claude API choices

- **Model: `claude-sonnet-4-6`** for all three calls (sign reading, notice reading, appeal draft). Don't downgrade the sign reader to Haiku 4.5: it supports no thinking of any kind, and without thinking it got multi-rule time maths wrong on stacked signs.
- **Sign reading:** `thinking: { type: 'adaptive' }`, `output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA }, effort: 'low' }`, `max_tokens: 16384`. Adaptive thinking shares the `max_tokens` budget, and T3 made every answer longer, so never lower it. `stop_reason` of `max_tokens` or `refusal`, or unparseable JSON, becomes `ERR_SIGN_UNREADABLE`. Don't use `budget_tokens` (deprecated on Sonnet 4.6).
- **Notice reading:** no thinking, `max_tokens: 1024` (`NOTICE_MAX_TOKENS`), `NOTICE_SCHEMA`. Transcription, not reasoning. The raw model text is never logged.
- **Appeal draft:** no thinking (it pushed calls past 50 s), `max_tokens: 4096`, `APPEAL_RESPONSE_SCHEMA`. The schema keeps `evidence_strength`, but it only calibrates the letter and is never shown to the driver (no verdict labels, build spec T8). The prompt forbids saying a signature proves when the car arrived or left, or where it was.
- **The system prompt** (`SYSTEM_PROMPT`, about 25,000 characters) is sent as a block with `cache_control: { type: 'ephemeral' }`, so it must stay byte-identical across requests: time, state and permits go in the user message, never the system prompt. Keep the "HOW TO COMPUTE `until`" worked examples (the model once picked the farthest leave-by instead of the earliest) and the T3 sections (SIGN STATUS, PERMIT EXCEPTIONS, AREA SIGNS, RECURRING RESTRICTIONS).
- **The sign schema has a grammar budget.** On 9 Nov 2026 a real call showed the API refusing T3's first sign schema with 400 `invalid_request_error` "The compiled grammar is too large, which would cause performance issues". Every scan would have failed after a deploy, and unit tests couldn't see it because they mock the client. Compile probes showed the limit is **tighter with the route's adaptive thinking and `effort: 'low'`** than for a bare request (a shape that compiled bare was refused with the real settings), that it tracks the number of properties more than name length, and that a sub-schema in `$defs` counts once however often it is referenced. So the raw model shape is flat (`permit_exception_type` and `permit_exception_text` per level; `days` and `week_of_month` as one string each; the observation group and next transition in `$defs`), and `normalizeModelOutput` (`lambda/sign-reading.js`) maps it back to the kept shape. Two guards:
  - the schema budget test in `lambda/sign-reading.test.js` fails if `RESPONSE_SCHEMA` grows past 3,396 characters of JSON, 46 properties, or 9 `anyOf`, 5 `enum` or 7 array nodes (today: 3,356, 45, 9, 5, 7; it compiled with one more plain string field and nothing more was tried);
  - `node scripts/check-schema-compiles.mjs` sends one tiny real request per schema (sign reading, notice, appeal), each with its route's own thinking and effort, and prints COMPILES or FAILS. Run it after any schema change and before every deploy. It needs `lambda/node_modules` and an `ANTHROPIC_API_KEY`.
- **Refresh mode** uses the same model and settings. The frontend keeps `rules`, `observations`, `chosen_label` and `confidence` from the record and trusts only `can_park_now`, `until` and `duration_minutes` from the model.

## Schema shape

What `translateSign` returns (normalised; `ModelParkingRules` in `lambda/sign-reading.d.ts`, `ParkingRules` in `src/types.ts`):

```ts
type ParkingRules = {
  sign_status: 'readable' | 'partially_obscured' | 'missing' | 'contradictory' | 'not_a_parking_sign'
  sign_issues: string[]                                  // why it isn't clear; never in `rules` (rules are signed)
  rules: string                                          // factual sign description, no time conclusions
  observations: { scope: string; items: string[] }[]     // grouped by sign element
  can_park_now: boolean                                  // the STANDARD answer; permits never change it
  until: string | null                                   // ISO 8601 with the spot's offset
  duration_minutes: number | null
  confidence: 'low' | 'medium' | 'high'
  requires_ticket: boolean
  payment_methods: string[] | null
  requires_disabled_permit: boolean
  is_permit_zone: boolean
  permit_area: string | null
  is_area_sign: boolean                                  // the sign governs an area, not a length of road
  permit_exception: { applies: boolean; permit_type: 'accessible' | 'resident' | 'business' | null; text: string }[]
  recurring_restrictions: { kind: 'street_cleaning' | 'clearway' | 'no_stopping' | 'other'; days: ('MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU')[];
                            start: string; end: string; week_of_month: number[]; exceptions_text: string; label: string }[]
  next_transition: { when: string; change: string } | null
  clarification: null | { question: string; options: RuleVariant[] }   // per-position answers with their own flags
  chosen_label?: string; alternate_variants?: RuleVariant[]; is_refresh?: boolean   // frontend only
}
```

`missing` and `not_a_parking_sign` carry no answer (empty rules, `can_park_now: false`); the app shows its own "no readable sign" screen. `partially_obscured` and `contradictory` carry the most restrictive reading plus a banner. `permit_exception` has one entry per listed permit type; since the flat schema, at most one applies per level.

## API request shapes

**Translate (fresh):** `{ image_base64, media_type, lat, lng, user_permits?, parking_state? }`. `user_permits` is at most 3 of `{ type: 'accessible' | 'resident' | 'business', area? }` (area at most 60 characters, never sent for an accessible permit, nothing else from Settings); `parking_state` is `'VIC' | 'NSW' | …`. `current_datetime` is honoured only outside Lambda (local dev and the accuracy harness) or with `ALLOW_TIME_OVERRIDE=1`, which must never be set in production. The app's `?dev_time=` URL parameter feeds it.

**Translate (refresh):** `{ prior_rules, prior_observations, prior_chosen_label, prior_sign_status, prior_sign_issues, prior_is_area_sign, lat, lng, user_permits?, parking_state? }`.

**Sign session:** link 0 sends the canonical record fields (v2 adds `chain_key_sha256`); an addendum sends exactly `{ schema: 'parkproof-addendum-v1', addendum_id, kind, session_id, seq, captured_at, chain_key, parent: { canonical_payload, signature_base64 }, data }` (`ADDENDUM_BODY_KEYS` in `lambda/addendum-schema.js`; `chain_key` is null for a chain whose link 0 is v1).

**Feedback:** `{ verdict: 'correct' | 'retake', feedback_id, context? }`. The context fields the Lambda keeps are listed in `handleFeedback` and, word for word, in `privacy.anonymousCloudwatch`; `src/lib/privacy-feedback-log.test.tsx` fails if they drift.

## App.tsx state machine

```
home → scan → loading → (clarify →) result → logging → remind → home
                             └→ noReadableSign → scan (retake) | logNoSign
scan → logNoSign ("No sign here") → remind → home
home → history → session ⇄ appeal          home → actives → session
home → notice → appeal → notice            home → recurring | settings → account | privacy | about | signin
home → workdayStart → home (workday card) → workday → session      [VITE_FEATURE_WORKDAY only]
#share=… at startup → shared                ?session=<id> (push tap) → session
any → error
```

The re-check branch: `scan` → a proximity-matched record (`ReuseCard`, within 40 m and 7 days) or the recent-scans picker → `loading` (refresh) → `result`. The state is a discriminated union (`View` in [`src/App.tsx`](src/App.tsx)). The scan-to-save views carry a `LogDraft` (`gate_acks`, `permit_context`, `workday`, `driver_name`): later tasks add data to a new record only through it. When adding a view, add the variant and handle each branch.

## Data model

Every field added by the roadmap is optional on `ParkingSession` (`src/types.ts`), so old records keep loading. A new persisted field goes in `src/types.ts`, in `ALLOWED_SESSION_FIELDS` (`lambda/cloud-sync.js`; a test fails when one is missing), and, if two copies can disagree, in the client merge (`src/lib/evidence-merge.ts`) and the server merge (`mergeSessionRows`).

**The evidence chain** (build spec N2; `src/lib/evidence-chain.ts`, `src/lib/signing.ts`, `src/lib/verify.ts`):
- **Link 0** is the arrival bundle in `signature`. Old records: `parkproof-evidence-v1`. New records: `parkproof-evidence-v2` (every v1 field plus `chain_key_sha256`). `chain_key` is 32 random bytes (hex), secret, kept on the device and in the owner's own cloud row. `v1_hashes` keeps the link-0 photo hashes so link 0 can always be signed.
- **Links 1, 2, 3…** are `addenda: SignedAddendum[]` (`{ id, seq, kind, captured_at, data, bundle?, rejected? }`). Payload `parkproof-addendum-v1`: `{ schema, addendum_id, kind, session_id, seq, parent_payload_sha256, chain_key_sha256, captured_at, signed_at, data }`.
- **Kinds** (`lambda/addendum-schema.js`, every key required, null when empty): `arrival_context` (always link 1 on a new record, queued at save: driver name, sign status and issues, rule flags, gate answers, `permit_commitment`, photo refs, condition note, proof type, jurisdiction, the workday link and boundary statement), `condition` (`when: 'parking' | 'return'`, 1 to 5 photos, note), `compliance` (a proof of payment or permit photo and its type), `departure` (`ended_at` from the phone, GPS fix or null, distance from arrival, return photos), `handover` (`from_driver`, `to_driver`, `handed_over_at`, location always null). `arrival_context` and `departure` are singletons; at most 20 addenda.
- **Ordering:** `appendAddendum` assigns `seq` from a fresh read; a link is sent only when its parent has a bundle; `setAddendumBundle` is first-write-wins. All signing for a record runs through one promise chain inside `navigator.locks` where available. 400 marks a link `rejected` for good; 429, 5xx and offline are transient and never count against anything. The sweep runs on mount, `online` and `visibilitychange` (at most once a minute per record, records up to 30 days old) and catches up a missing departure. Addendum signing is held (at most 60 s) until the first cloud sync settles, so two devices don't fork a chain.
- **Signed values are read from the signed payload.** Screens and PDFs show what `canonical_payload` says; anything unsigned is labelled "Not signed yet". Phone times (`arrived_at`, `ended_at`, `captured_at`) are labelled as phone times; only `signed_at` is ParkProof's.
- The browser verifier checks each signature with WebCrypto against the published key, the chain hashes, forks ("Added from two devices") and every photo it has bytes for. Dev-key links are never called valid.

**Photos** (N4; `src/lib/photo-store.ts`, `src/lib/session-photos.ts`): new records keep every photo in IndexedDB (`parkproof-photos`), content-addressed by `${sessionId}/${sha256}`, written once, and list them in `photos: PhotoRef[]` (`{ role, sha256, captured_at, source: 'camera_input' | 'library' }`). Roles: `sign`, `car`, `ambient`, `condition-*`, `return-*` (front, rear, left, right, detail) and `compliance`. The legacy `sign_photo`, `car_photo` and `ambient_photo` data URLs stay for old records only; every reader goes through `getSessionPhoto(session, role)`. S3 keys: `{sub}/{sessionId}/p/{sha256}.jpg` for refs, `{sub}/{sessionId}/{role}.jpg` for legacy photos. A photo not on the device shows "Photo not on this device. Signed fingerprint …" and the verifier reports it as not checkable.

**Permits** (N3): accessible permit status is health information. `permit_context` (`{ type, area, holder_present, sign_exception_applies, standard_until, permit_until, note }`) and `permit_salt` stay on the device and in the owner's cloud row; only `permit_commitment = sha256(permit_salt + canonicalize(permit_context))` is signed, in `arrival_context`. The PDF and the evidence file reveal the details only when the driver ticks "Include permit details". Never log permit types server-side.

**Other record fields:** `driver_name`, `gate_acks`, `rule_flags`, `sign_status`, `sign_issues`, `recurring_restrictions`, `condition_note`, `compliance_type`, `place` (raw reverse-geocode parts; `place.state_code` is Nominatim's `ISO3166-2-lvl4`, the only source of `jurisdiction`), `departure`, `push_reminders` (a display cache of booked fire times), `photo_sync_failed`, and the workday fields `workday_id`, `leg_index`, `boundary`, `stretch_deadline`.

**Shared copies** (T7): opening a `/app/#share=1.<base64url JSON>` link stores a read-only copy with `shared_from` (`original_session_id`, `received_at`, `shared_at`, the sender's `arrival_bundle` and an unsigned `snapshot`) under a new local id, deduplicated on `original_session_id`. Copies never queue addenda and are left out of active records, the signing sweep and cloud sync. A link carries the arrival bundle and unsigned extras only: no photos, no chain key, no permit details.

**Stores in `localStorage`** (helpers in `src/lib/storage.ts` unless named):
| Key | What |
|---|---|
| `parkproof.sessions.v1` | Every record. Not bumped by the roadmap (all fields additive). Writes fire `parkproof:records-changed`; `useRecordsVersion()` re-renders on it |
| `parkproof.profile.v1` | Settings (`src/lib/profile.ts`): `driver_name` (at most 60 characters) and up to 3 `permits` (`{ id, type, state, area, expires_on }`). This browser only, never synced |
| `parkproof.recurring.v1` | Weekly reminders (`RecurringRule[]`: label, kind, days, start, end, frequency `weekly`, `fortnightly` or `monthly_nth`, nth, anchor date, IANA zone, address, reminder offsets, push, paused, calendar sequence). Never signed. `parkproof.recurring.push.v1` holds a fingerprint of what was last booked by push (`src/lib/recurring-push.ts`) |
| `parkproof.workday.v1` | Workday state (T6a): `{ id, started_at, jurisdiction, status: 'parked' \| 'between_moves' \| 'ended', current_session_id, previous_session_id, ended_at }`, at most one active. The stops are ordinary records with `workday_id` and `leg_index` |
| Device-local | `parkproof.device_id.v1` (push ownership), `parkproof.push.registration_sent.v1`, `parkproof.push.turned_off.v1`, `parkproof.signing.state.v2` (sweep timestamps, link-0 rejections, pulled marks), `parkproof.sync.uploaded.v1` (photo upload markers), `parkproof.backupPrompt.v1`, `parkproof.install-dismissed.v1`, `parkproof.language` |

## Conventions

- TypeScript strict. Discriminated unions over boolean flags.
- Tailwind v4 with `@theme` tokens in [`src/index.css`](src/index.css). No CSS modules, no styled-components.
- **Brand: the Greenfield vault identity** (since `44ee7a3`, 30 Jun 2026; build spec "Design rules"). The app sits on the vault, `brand-800` `#073B25`, with a faint guilloché stripe; content goes in white `.gf-card` cards (a chamfered top-right corner) or glass rows (`rgba(255,255,255,0.055)`). `brand-*` is pine (`brand-500` `#0E5C3A`), `ink-*` near-black green (`ink-900` `#0B1A14`), `paper-*` green-tinted off-white (`paper-100` `#F3F6F4`), `accent-*` a quiet slate green. Mint `#7BE3A4` only for the verified seal glow and active states; sage `#A9CFBE` (inline, not a token) for muted text on the vault; `danger-300` `#FFB4AB` only for destructive actions on the vault (Button's `danger` variant). The answer card keeps Tailwind's `emerald-*` and `red-*` for go and stop. Fonts: Space Grotesk (display, Latin only) and Inter, with the Noto Sans chain for other scripts. The mark is the Datum P (`BrandMark.tsx`); `theme_color` is `#073B25`.
- Reuse `src/components/ui/*` (`Alert`, `BackButton`, `Button`, `Card`, `Input`). Screen wrapper `min-h-screen flex flex-col p-6 max-w-md mx-auto w-full`; title `font-display text-3xl font-extrabold text-paper-50 mb-1`. Touch targets at least 44 px. Modals follow `FeedbackModal.tsx` (`role="dialog"`, `aria-modal`, focus trap, Escape). Fixed layers use the `safe-*` utilities so they clear the iPhone notch (`src/lib/app-shell.test.ts`). New icons go in `Icon.tsx` (14 today). Every photo goes through `resizeImageFile`.
- **Copy rules** (build spec): no em-dashes, Australian spelling, sentence case, second person. Never "reset", "compliant", "admissible", "authentic", "verified location"; never promise an outcome. A signature shows the signed details existed, unchanged, by the signed time, and nothing more. Phone times are labelled as phone times. Every reminder feature carries `reminders.reliability`. `src/lib/copy-lint.test.ts` enforces what a machine can.
- **i18n**: every user-facing string goes through `t()`, in all 9 locales (`en`, `zh-CN`, `vi`, `id`, `ko`, `it`, `el`, `hi`, `pa`), added only by an idempotent `scripts/_i18n_inject_<task>.mjs` (see Gotchas for the order). Terminology from `docs/legal-pdf-review-worksheet.md`; register el εσύ, id kamu, zh 你; gender-neutral hi and pa. `src/lib/locales.test.ts` enforces key, variable, tag and plural parity. PDF strings use plain text and WinAnsi punctuation only.
- **Feature flags:** `src/lib/features.ts` (`isWorkdayEnabled()`). Every workday entry point checks it.
- Async errors: `throw new Error('ERR_…')` codes; the client maps them to copy (an Error's message can reach the screen, so the copy lint checks error strings too).
- **Anonymous by default, opt-in cloud.** Records live on the device first and every feature works without an account. Signed in (Cognito email and password, or Apple or Google), records mirror to DynamoDB and photos to S3. The local copy stays the source of truth. Never gate a feature behind sign-in.
- Active records: `loadActiveSessions(now)` keeps a record with `ended_at` out; keeps one with `expires_at` for 12 h after it passes (shown as "Expired at …" with I've left first); keeps a no-sign record until I've left. Shared copies are never active. One end path: `App.handleEndSession` owns `endSession`, the departure addendum, the cloud mirror and the push and in-tab cancels; the departure sheet (`DepartureSheet.tsx`) replaces `window.confirm`.

## AWS resources

| Resource | Name / ID |
|---|---|
| Lambda function | `parkproof-sign-translator` (`deploy.sh` moves it to `nodejs22.x` on the next deploy; main created it on `nodejs20.x`) |
| IAM execution role | `parkproof-lambda-role`. Inline policies from the setup scripts: `parkproof-kms-sign`, `parkproof-data-access` (sessions table, evidence bucket, Cognito admin), `parkproof-user-feedback-write`, `parkproof-push-subscriptions-rw`, `parkproof-lambda-schedule-rw` (Scheduler on `parkproof-push-*` plus `iam:PassRole`), and `parkproof-jobs-delete` once `setup-jobs-table.sh` has run. The jobs table's `GetItem`, `PutItem` and `UpdateItem` grants were made by hand and no script has them. Self-invoke `lambda:InvokeFunction` is hand-made too |
| API Gateway HTTP API | `parkproof-api` (id `tlsmpbft4f`). After the roadmap-2 deploy: 23 routes, 14 anonymous (11 POST plus the 3 status GETs) and 9 JWT-gated (7 POST plus GET on `/sessions/list` and `/me/export`). The deploy adds `push/recurring`, `push/recurring/cancel`, `read-notice` and `GET /read-notice/status/{job_id}`. Hard 30 s timeout; the slow routes poll |
| API Gateway JWT authorizer | id `t1utm6`, issuer = Cognito User Pool |
| DynamoDB: async jobs | `parkproof-jobs` (PK `job_id`). **TTL attribute `ttl`** (confirmed on the live table 9 Nov 2026): 10 minutes for job rows, 2 minutes for the per-IP limiter rows (`RL#<route>#<ip>#<minute>`). Made by hand; no script creates it. `JOBS_TABLE` overrides the name |
| DynamoDB: records | `parkproof-sessions` (PK `userId`, SK `sessionId`, a `rev` attribute for the conditional merge) |
| DynamoDB: push | `parkproof-push-subscriptions` (PK `device_id`, TTL on `expires_at`, 90 days after the last renewal; tombstone rows keep only a hash of a dead endpoint). `setup-push.sh` |
| EventBridge Scheduler | One-shot `parkproof-push-<session uuid>-<n>` (`at()` in UTC, at most 6 per record) and weekly `parkproof-push-r-<rule uuid>-<0\|1>` (`cron()` in the rule's IANA zone, `EndDate` 90 days out, `ActionAfterCompletion: DELETE`), both in the `default` group, targeting this Lambda through `parkproof-push-scheduler-role` (`parkproof-push-scheduler-invoke`, invoke only). `setup-push-scheduler.sh` |
| Cognito User Pool | `ap-southeast-2_fBbsYa7VM`; App Client `5ldgcdf1qol1qje9h55inl9pq9`; Hosted UI `parkproof-<ACCOUNT_ID>.auth.ap-southeast-2.amazoncognito.com` (Apple and Google federation) |
| Apple Sign-in identifiers | App ID `au.com.parkproof.app`, Services ID `au.com.parkproof.signin`, Key ID `43627FRVZ2` (Team `L89J489GL4`). Rotated 2026-05-22 from `tech.dsouza.parkproof`; the old key `5N98KL6J88`, Services ID and App ID can be revoked |
| S3: static hosting | `parkproof-app-<ACCOUNT_ID>` (private; CloudFront OAC only). Landing at `/`, the PWA at `/app/`, `/verify/` (9 locales), `/accuracy/` |
| S3: evidence photos | `parkproof-evidence-<ACCOUNT_ID>` (private; per-user `{sub}/` prefixes; presigned `PUT` only; reads go through `/photos/materialize`) |
| S3: user feedback | `parkproof-user-feedback-<ACCOUNT_ID>` (private; `YYYY-MM-DD/{uuid}.json`; 730-day lifecycle; AES256; the Lambda may only `PutObject`). `setup-feedback-bucket.sh` |
| KMS asymmetric key | `alias/parkproof-evidence-signing` (ECDSA P-256, `Sign` only, digest mode). Public key at `/parkproof-public-key.pem` and embedded in `lambda/index.js` (a test keeps them equal) |
| CloudFront | Distribution `E33V8DMM3LQACG` (comment `parkproof-cdn`) for `www.parkproof.com.au` and the legacy `parkproof.dsouza.tech`; OAC `parkproof-oac` (`E3JE1OX4WHEIWK`); viewer-request function `parkproof-uri-rewrite` (`scripts/_cloudfront-uri-rewrite.js`) |
| ACM certificate (us-east-1) | `www.parkproof.com.au` + `parkproof.com.au` (`8257fd02-fcc0-4958-a092-7e5a3d07fa57`), DNS-validated on Cloudflare. A legacy cert for `parkproof.dsouza.tech` (`3442f3b7-aa80-40ec-b580-331487b7b0cd`) was kept for the cutover |
| DNS | Cloudflare (`jake` + `nova` for `parkproof.com.au`; `kenia` + `woz` for `parkproof.au`). Page Rules redirect to the canonical. Crazy Domains is registrar only |
| Email | Titan, `hello@parkproof.com.au` (MX, SPF and DKIM in Cloudflare). The free trial was due to end 20 Jun 2026; this file doesn't record the plan since |
| CloudWatch logs | `/aws/lambda/parkproof-sign-translator`. No retention until `setup-log-retention.sh` sets 90 days, which the privacy policy promises |
| Alarms | AWS Budgets `parkproof-monthly` (\$25 a month). CloudWatch `parkproof-anthropic-usage` on the `parkproof-anthropic-calls` metric filter (`anthropic-usage-alarm.sh`; it counts `anthropic_call=`, `appeal_call=` and `notice_call=`. The live filter predates `notice_call=` until the script is re-run, a go-ahead deploy step) |

Region: `ap-southeast-2` (Sydney). Account: `<ACCOUNT_ID>` (`aws sts get-caller-identity`).

## Deploy scripts

All in `scripts/`. Never run any of them, or call AWS, without the owner's go-ahead.

| Script | What it does |
|---|---|
| `deploy.sh` | Stages and zips the Lambda in a temp folder outside the repo (`npm ci --omit=dev` there; `lambda/node_modules` in the tree is never touched), checks the package, moves the runtime to Node 22, updates the code and merges env vars (never deletes one), ensures every route and permission, re-cuts the PDF fonts when fontTools is installed, builds the frontend with `VITE_FEATURE_WORKDAY=false` (or `true` only with `DEPLOY_ALLOW_WORKDAY=1`), layers the landing and the SW shim into `dist/`, strips CR from every PEM, syncs to S3 with `--delete` and invalidates CloudFront |
| `deploy.sh --package-only` | Builds and lists the Lambda package only. No `.env`, no AWS call. The rehearsal for the real thing |
| `_deploy-staging.sh` | Temporary Greenfield preview: builds under an obscure base path and syncs only that prefix (noindexed). Same workday rule as `deploy.sh`. A full `deploy.sh` sync deletes the prefix |
| `setup-auth.sh` | One-time: Cognito pool, app client, Hosted UI domain, sessions table, evidence bucket, JWT authorizer; writes `scripts/.aws-resources`. **Never re-run it for an IAM fix:** it rewrites `.aws-resources` from scratch (dropping the VAPID, push and feedback lines) and resets the app client's identity providers to COGNITO only, which cuts Apple and Google sign-in |
| `setup-signing.sh` | One-time: the KMS key, `kms:Sign` on the role, exports `public/parkproof-public-key.pem` |
| `setup-feedback-bucket.sh` | One-time: the feedback bucket and its write policy |
| `setup-push.sh` | One-time: VAPID keys (never regenerated: that would orphan every subscription) and the push table |
| `setup-push-scheduler.sh` | One-time: the scheduler role and the Lambda's Scheduler and PassRole policy. Also edits `.aws-resources`; for an IAM-only fix, `put-role-policy` the document instead |
| `setup-jobs-table.sh` | Adds `dynamodb:DeleteItem` on `parkproof-jobs` (`parkproof-jobs-delete`), which `/read-notice/status` needs. Not yet run (deploy checklist 6.1) |
| `setup-log-retention.sh` | Sets 90-day retention on the Lambda's log group and reads it back. Deletes older logs, launch day included; export first. Not yet run (deploy checklist 6.2) |
| `harden.sh` | One-time: CORS lockdown, OAC, private bucket origin. Security-critical; inspect before re-running |
| `set-throttle.sh [burst] [rate]` | API Gateway limits (default 100 burst, 25 a second). The account's Lambda concurrency cap of 10 is the real cost ceiling |
| `billing-alarm.sh`, `anthropic-usage-alarm.sh` | The two alarms above |
| `check-schema-compiles.mjs` | One tiny real Anthropic call per structured-output schema (see Claude API choices). Before every deploy |
| `eval-accuracy.mjs` | The accuracy benchmark harness (T9; `eval/README.md`). `eval/corpus/` is still empty |
| `smoke-test-auth.mjs`, `send-test-push.mjs` | Live checks of the auth routes and of one push |
| `screenshots.mjs` | Playwright harness that regenerates `docs/screenshots/*.png` (last run 25 May 2026, before the green identity) |
| `teardown.sh [--confirm]` | Dry run by default (it reads only the account id). `--confirm` removes everything the setup and deploy scripts create: every `parkproof-push-*` schedule (and a hand-made `parkproof-warmer`), CloudFront and its function, the OAC, the API, the Lambda, its log groups, the usage alarm, its topic and the dashboard, the Cognito pool and domain, the three tables, the app, evidence and feedback buckets (emptied first, old versions included), the KMS key (scheduled for deletion after 7 days, the minimum) and both roles (inline policies deleted first). Keeps the budget alarm and `.aws-resources`. A lookup that fails with anything but AWS's not-found error (a missing permission, throttling, an expired sign-in) stops the run and never reads as "nothing to delete", and the app bucket goes only when no distribution still uses it as an origin (a freed bucket name could be claimed and served on the site's domain). `scripts/teardown.test.mjs` runs it against a fake AWS |

The deploy itself: follow [`docs/build/deploy-checklist-roadmap-2.md`](docs/build/deploy-checklist-roadmap-2.md), from a clone outside Dropbox.

## CloudWatch logs

Structured prefixes worth knowing:

- `[parkproof]`: per-request timing. Sign reads: `preflight=Nms model=X mode=translate|refresh tz=Y image_b64_len=Z`, then `anthropic_call=Nms stop=… usage={…}`. Notices: `notice_call=…`. Appeals: `appeal_preflight=…`, `appeal_call=…`.
- `[parkproof.feedback]`: "Did we read this right?" events: `{verdict, feedback_id, timestamp}` plus the whitelisted context (confidence, had_clarification, chosen_label, duration_minutes, observations_count, rules_excerpt, scanned_hour_local, is_refresh, requires_ticket, ticket_acknowledged, payment_methods, requires_disabled_permit, disabled_permit_acknowledged, is_permit_zone, permit_area, permit_zone_acknowledged, sign_status, sign_issues_count, is_area_sign, recurring_restrictions_count).
- `[parkproof.user_feedback]`: free-text feedback `{id, timestamp, message, email, page, user_agent, app_version, locale, sessions_count, is_signed_in}`, mirrored to S3. `[parkproof.user_feedback.s3_error]` means the mirror failed.
- `[parkproof.signing]`: `sign=Nms key=… session_id=… schema=…`, and `rejected code=… field=…` for a 400.
- `[parkproof.job]`: job done or error, and `delete after read failed` / `expired-row delete failed` on the notice route.
- `[parkproof.push.*]`: `subscribe`, `schedule`, `cancel`, `recurring`, `recurring_cancel`, `dispatch.ok`, `dispatch.failed`, `dispatch.stale`, `recurring.skip` and their `not_owner`, `not_subscribed` and `error` variants.
- `[parkproof.ratelimit] check failed, allowing`: the limiter failed open (usually IAM).

**Useful Logs Insights queries** (log group `/aws/lambda/parkproof-sign-translator`):

```
# Free-text user feedback, newest first
fields @timestamp, @message
| filter @message like "[parkproof.user_feedback]"
| parse @message /"message":"(?<msg>[^"]+)"/
| parse @message /"email":"(?<email>[^"]+)"/
| parse @message /"page":"(?<page>[^"]+)"/
| sort @timestamp desc
| display @timestamp, page, email, msg
| limit 50
```

```
# Verdict counts (overall accept rate)
fields @timestamp, @message
| filter @message like "[parkproof.feedback]"
| parse @message /"verdict":"(?<verdict>[a-z]+)"/
| stats count() as events by verdict
```

```
# Retake rate by model confidence: high confidence + retake = prompt regression
fields @timestamp, @message
| filter @message like "[parkproof.feedback]"
| parse @message /"verdict":"(?<verdict>[a-z]+)"/
| parse @message /"confidence":"(?<confidence>[a-z]+)"/
| stats count() as events, sum(verdict = 'retake') as retakes by confidence
| display confidence, events, retakes, retakes / events * 100 as retake_pct
```

```
# Failure rate by hour of day at the sign
fields @timestamp, @message
| filter @message like "[parkproof.feedback]"
| parse @message /"verdict":"(?<verdict>[a-z]+)"/
| parse @message /"scanned_hour_local":(?<hour>\d+)/
| stats sum(verdict = 'retake') as retakes, count() as total by hour
| sort hour
```

```
# Top failing rule patterns
fields @timestamp, @message
| filter @message like "[parkproof.feedback]"
| filter @message like "\"verdict\":\"retake\""
| parse @message /"rules_excerpt":"(?<rules>[^"]+)"/
| stats count() as retakes by rules
| sort retakes desc
| limit 20
```

```
# Does clarification (stacked or arrow signs) raise the retake rate?
fields @timestamp, @message
| filter @message like "[parkproof.feedback]"
| parse @message /"verdict":"(?<verdict>[a-z]+)"/
| parse @message /"had_clarification":(?<clarified>(?:true|false))/
| stats count() as events, sum(verdict = 'retake') as retakes by clarified
| display clarified, events, retakes, retakes / events * 100 as retake_pct
```

```
# Sign-read latency over time
fields @timestamp, @message
| filter @message like "anthropic_call="
| parse @message /anthropic_call=(?<ms>\d+)ms/
| stats avg(ms), pct(ms, 90), max(ms) by bin(1h)
```

```
# Errors and denials (the deploy checklist's watch-window query)
fields @timestamp, @message
| filter @message like /ERROR|Task timed out|ImportModuleError|AccessDenied|not authorized|delete after read failed|ratelimit\] check failed|push\.recurring\.error/
| sort @timestamp desc | limit 100
```

## Rollback playbook

For when something breaks under live load and you need to recover without thinking it through from scratch. For the roadmap-2 deploy, the checklist's section 3 comes first: it deletes the four new routes and the weekly cron schedules before main is redeployed, because main's Lambda would answer those routes with a 202 and fail on every weekly firing.

### Triage first: match the symptom to the fix

| Symptom | First thing to check | Likely fix |
|---|---|---|
| 5xx on `/sign-translate` | `MSYS_NO_PATHCONV=1 aws logs tail /aws/lambda/parkproof-sign-translator --follow` | Lambda regression: revert, or redeploy the previous Lambda code |
| Every scan fails with a 400 from Anthropic | `[parkproof]` lines; `node scripts/check-schema-compiles.mjs` | A schema the API won't compile. Revert the schema change |
| Slow scans (over 30 s) | Anthropic status page and `anthropic_call=` in CloudWatch | Upstream issue: wait and post a status. Or async polling broke: revert |
| Broken landing page | `curl -sI https://www.parkproof.com.au/ \| head` | Bad deploy: revert and redeploy. Or an invalidation still in flight (wait 5 min) |
| PWA users on a stale shell | The service worker pins the old `index.html` | They need to close and reopen the app; new visitors are fine |
| Sign-in broken | Cognito console, pool `ap-southeast-2_fBbsYa7VM`, recent changes | Config drift: restore in the console; auth changes can't be git-reverted |
| `429 Too Many Requests` | `aws apigatewayv2 get-stage --api-id tlsmpbft4f --stage-name '$default'` | Throttle hit: `scripts/set-throttle.sh 200 50` |
| `AccessDenied` or `not authorized` in the logs | The deploy checklist's IAM simulator (4.4) | A missing grant. Add it with `put-role-policy`; never re-run `setup-auth.sh` |
| Costs spiking | Cost Explorer by service; the Anthropic console | Usually Lambda invocations or Claude calls. Disable the API stage if extreme |

### Frontend rollback (most common)

The site is static files in S3 behind CloudFront. Rollback = redeploy an earlier commit.

```bash
git log --oneline -10
git revert <bad-sha>            # a NEW commit on top; never reset --hard and force-push
./scripts/deploy.sh             # about 3 min including the invalidation
git push                        # so origin matches what's live
```

`main` is shared with `origin`; `git revert` keeps the audit trail.

### Lambda rollback (rare: most regressions are frontend)

`deploy.sh` never publishes Lambda versions, so `list-versions-by-function` probably shows only `$LATEST` (the checklist's 4.11 optionally publishes one before a deploy). The reliable rollback is to redeploy the previous commit:

```bash
git checkout <good-sha> -- lambda/
./scripts/deploy.sh
git checkout HEAD -- lambda/     # restore the working tree afterwards
```

### What can't be rolled back with git

These are stateful and need a forward fix:

- **Cognito User Pool config**: schema, federation providers, callback URLs. Use the console history.
- **DynamoDB data**: records merged by the new server code stay merged. Revert app code that needs a new shape, then redeploy code that handles the old one.
- **Weekly cron schedules** (`parkproof-push-r-*`): they outlive a code rollback and keep firing until their `EndDate`. Delete them by hand (checklist section 3).
- **The Lambda runtime**: `deploy.sh` moves it to Node 22 and main's script has no runtime step. Don't move it back.
- **KMS key and the published public key**: never roll the signing key or change `parkproof-public-key.pem` once published. If the key is ever compromised, revoke it and publish a new one (a separate incident process).
- **S3 bucket policy and CloudFront OAC**: `harden.sh` is idempotent but security-critical; inspect in the console first.
- **Signed parts**: KMS signatures are permanent. `lambda/addendum-schema.js` must stay compatible so older Lambdas accept the same kinds.

### Comms

If the bug is user-facing during a launch window:

1. **Within 5 min**: acknowledge it where you launched ("hitting a snag, investigating"). Silence is worse than honesty.
2. **Within 15 min**: edit the post to flag the issue at the top.
3. **After the fix lands**: confirm it and thank whoever flagged it.
4. **The in-app feedback form** is the best signal. Tail it with the user-feedback query above.

### Pre-launch checklist

- [ ] Last deploy on green CI: `gh run list --limit 3`
- [ ] `node scripts/check-schema-compiles.mjs` prints COMPILES three times
- [ ] Smoke test on prod: scan a real sign, log a record, I've left, Check signatures, export a PDF, read a notice, draft an appeal. Under 3 minutes
- [ ] Logs Insights queries above open in a tab, and Cost Explorer (month to date) in another
- [ ] A phone with the PWA installed nearby

## Gotchas

- **Dropbox locks (EBUSY).** The canonical folder is in Dropbox, and Dropbox holds file handles on anything it is syncing. Vite rewrites its dependency cache (`node_modules/.vite`) and compiled config (`node_modules/.vite-temp`) on start, and a build rewrites `dist/`; inside Dropbox those writes can fail with EBUSY. `deploy.sh` used to `rm -rf lambda/node_modules` and failed the same way, which is why it now packages the Lambda in a temp folder. Run the dev server, builds and every deploy from a clone or worktree outside Dropbox (this build's worktrees are under `%USERPROFILE%\Downloads\pp-wt\`; the deploy checklist's stage 2 makes a deploy clone), or pause Dropbox syncing first. OneDrive has the same locks.
- **`deploy.sh` stages the Lambda package outside the repo.** It copies `lambda/` without `node_modules` and tests to a `mktemp` folder, runs `npm ci --omit=dev` there, zips it (`zip`, else PowerShell's `Compress-Archive`, preferring PowerShell 7), and refuses a package without `index.js`, `package.json` or `node_modules` at the top, or over 50 MB. The Windows `aws.exe` gets the zip's Windows path via `cygpath -w`. `--package-only` stops there and keeps the zip for inspection.
- **`DEPLOY_ALLOW_WORKDAY`.** `deploy.sh` and `_deploy-staging.sh` read it from the invoking shell before sourcing `.env` and `scripts/.aws-resources`, make the result read-only, and pass `VITE_FEATURE_WORKDAY=true|false` explicitly on the build command. `vite.config.ts` keeps any `VITE_*` value the environment already has, so a `.env` line can't override it (`scripts/vite-env-precedence.test.mjs`, `scripts/deploy-scripts.test.mjs`, `src/lib/features-build.test.ts`). With T6b and T6c merged, `DEPLOY_ALLOW_WORKDAY=1` ships the whole workday UI. Never set it until every workday key in `docs/legal-review-queue.md` is approved; no lawyer is engaged.
- **The i18n inject order.** The committed locale files are generated by the roadmap-2 inject scripts, run on top of the evidence-chain build's output in this order: `fix_push`, `t6a`, `t8`, `t3`, `t5`, `t2`, `t4`, `t7`, `t6bc`, `fixlist_final`, `copy_pass`, `t10_review` (`node scripts/_i18n_inject_<name>.mjs`). A script writes its own text for every key it owns, whatever is there (`setOwned`), so re-running one undoes any later edit to those keys, including in-place fixes from a language review. Run one again only to change its own keys, and diff `src/locales/` afterwards. The copy pass runs after the task scripts and wins on any key it overwrites; `t6bc` and `fixlist_final` check their keys against the copy-pass files before writing. The T10 translation review runs last: its corrections are in `scripts/t10-review/<locale>.json`, and a reviewed key that the copy pass also overwrites carries the reviewed text in the copy-pass file too (the script checks), so running the copy pass again changes nothing. After re-running any earlier script, run `t10_review` again; `t7` refuses to run on keys the review changed (its own-key guard) rather than writing its old text back. **Never re-run the T0a to T1b scripts** (`_t0a`, `_t0b1`, `_t0b2`, `_t0b3`, `_t1a`, `_t1b`): their text predates the language review in `b8c88eb`, and re-running them writes the pre-review translations back. The older one-off injectors (`_i18n_inject_about*.mjs`, `_end_session*`, `_user_feedback`, the `.py` ones) aren't part of the order; don't run them either. Every script is idempotent, aborts before writing if any locale's keys, `{{vars}}` or `<tags>` differ from English, and has `--list` (prints its keys, marks `legal` ones, writes nothing). New keys need a new script for the task, appended to the order.
- **The copy lint** (`src/lib/copy-lint.test.ts`) fails the build on an em-dash in any locale string, any `.tsx` string or any `.ts` string literal; on banned wording ("session", "reset", "verified record" and the rest) in English strings, JSX text and error messages; and on an em-dash or "verified record" in the landing pages. Comments are exempt.
- **`.gitattributes` keeps `*.pem`, `*.mjs` and `*.sh` LF.** `core.autocrlf=true` is set system-wide on this machine. A CRLF `.sh` breaks bash, a CRLF shebang breaks Node and Vitest, and a CRLF PEM made the live key 182 bytes against 178 in the repo. Merging the rule doesn't rewrite files already checked out; `deploy.sh` strips CR from every PEM in `dist/` anyway. Clone with `-c core.autocrlf=false` for deploys.
- **The dev signer is ephemeral.** `npm run dev` makes a fresh P-256 key per dev-server process (kept on `globalThis` across config reloads, never written to disk). After a restart, parts signed by the previous key can't be extended: the server answers `ERR_PARENT_SIGNATURE` and the phone marks the part "couldn't be signed". Test chains with fresh records. Dev-key parts are never shown as valid, and a share link signed with one reads as changed in production builds.
- **PDF fonts are cut to the strings.** `scripts/_subset_pdf_fonts.py` cuts each `public/fonts/Noto*.ttf` to the characters the locales use, from the full fonts in `fonts-src/` (gitignored; `--fetch` downloads them). Without `fonts-src/` it re-subsets the committed files in place, which can only drop glyphs, and a new character prints as a blank box. Re-cut after any locale change, at the latest at deploy time from a clone with `fonts-src/` copied in, and run `src/lib/pdf-font-coverage.test.ts`.
- **Locales are not lazy-loaded.** `src/lib/i18n.ts` imports all 9 locale files statically, about 1.4 MB of JSON, which is most of the 1.96 MB main chunk. PDF fonts and the heavy libraries are lazy.
- **vestauth on Windows.** It wraps `dotenv` and stops it filling `process.env`. `vite.config.ts` assigns the parsed values itself (except `VITE_*` keys the environment already has). Don't remove that block.
- **`vite.config.ts` runs from `node_modules/.vite-temp/...`.** `__dirname` points there, so the dotenv loader walks up from `import.meta.url` to find `.env`.
- **Haiku 4.5 supports no thinking** (adaptive or extended; 400 `invalid_request_error`). **`effort: 'low'` works on Sonnet 4.6 and Opus 4.6+ only**, not Haiku 4.5 or Sonnet 4.5. If you change models, re-check both, and re-run `check-schema-compiles.mjs`: the grammar limit depends on the thinking settings.
- **AWS CLI on Windows** is at `/c/Program Files/Amazon/AWSCLIV2/aws.exe`; the scripts prepend it to `PATH`. Git Bash rewrites leading `/` in arguments: use `MSYS_NO_PATHCONV=1` for log group names. Git Bash `/tmp/...` paths mean nothing to the Windows `aws.exe`: use project-relative files for `file://`, or `cygpath -w`.
- **Image quota.** `localStorage` holds about 5 MB. New records keep photos in IndexedDB, but old records still carry data URLs, so `src/lib/image.ts` resizes every photo to at most 1200 px at JPEG 0.82. Quota recovery (`persistWithQuotaRecovery` in `storage.ts`) evicts shared copies first, then strips legacy car photos, then sign and surroundings photos, then evicts the oldest records. It never touches a record still on the home screen or one whose evidence isn't fully signed, and throws `StorageFullError` rather than break that.
- **`.ics` description newlines.** Use `'\n'`; `'\\n'` writes a literal `\n`.
- **Desktop geolocation is unreliable.** Chrome can return IP-based fixes kilometres off. `SignScanner` treats anything coarser than 100 m as no usable GPS and offers the recent-scans picker instead of the proximity card; workday mode treats it as an unreliable location, so the boundary question always asks.
- **CloudFront propagation takes 3 to 10 min**; bucket policy changes are immediate. Order migrations so the live site never breaks.
- **Social platforms cache OG images.** Force a refresh in each platform's debugger, or share with `?v=N`.
- **CI installs root deps, then `npm ci` in `lambda/`** (`.github/workflows/test.yml`). The Lambda tests import the AWS SDK from `lambda/package.json`. A new subfolder with its own `package.json` needs the same step.
- **happy-dom's `localStorage` defeats `vi.spyOn`.** Swap in a `Storage`-shaped object with `Object.defineProperty(globalThis, 'localStorage', …)` for quota tests (see `src/lib/storage.test.ts`).
- **`vi.mock` with arrow-function constructors fails** (`new Anthropic(...)` throws "is not a constructor"). Use a real class in the mock factory (see `lambda/refresh.test.js`).
- **Cognito `update-identity-provider` rejects an inline private key.** Pass `--provider-details file://apple-idp.tmp.json` with real `\n` escapes (`docs/federation-setup.md`, "Rotating the Apple Bundle ID").
- **Cloudflare's DNS import skips underscore records**, so ACM validation CNAMEs must be added by hand before moving nameservers. Crazy Domains rejects trailing dots in CNAME values and charges for URL forwarding; Cloudflare's Page Rules do it free.
- **S3 CORS must follow domain moves.** After the move to `www.parkproof.com.au` the evidence bucket's `AllowedOrigins` missed it and every presigned photo `PUT` failed silently (2026-05-25). Audit CORS in any domain migration.
- **The OAuth callback path.** Cognito redirects to `/auth/callback`, which only exists because the CloudFront function rewrites it to `/app/index.html`; `handleCallback()` reads `?code=` whatever the path.
- **`performInitialSync` must bump `activesVersion` in `.finally()`**, or a fresh-device sign-in sits on `LandingFeatures`. An earlier `useMemo` fix crashed every view and was reverted (`2db84b8`); re-attempt only with a local repro.
- **jsPDF only embeds data URLs.** `materializeRemotePhotos` in `src/lib/pdf.ts` turns cloud photos into data URLs first, through `/photos/materialize`, at most 4 at a time, and only the photos the PDF draws.
- **`@aws-sdk/client-s3` 3.729+ adds `x-amz-checksum-mode=ENABLED` to presigned URLs**, which breaks browser CORS in a way curl doesn't show. `cloud-sync.js` creates the client with `requestChecksumCalculation` and `responseChecksumValidation` set to `'WHEN_REQUIRED'`. Re-check cross-device photos in a real browser after any SDK bump.
- **Never hand the browser a presigned GET for private storage.** Mobile networks, CORS and SDK changes broke it in three different ways. Route reads through an API endpoint like `/photos/materialize`; presigned `PUT` for uploads is fine.
- **Stale photo URLs in old local records.** Uploads null any legacy photo value that isn't a `data:` URL, and hydration always re-mints. If a device still shows CORS errors on an old URL: sign out, close every tab, reopen, sign in.
- **The notice route must be able to delete rows.** Until `setup-jobs-table.sh` runs, `DeleteItem` is denied, the delete after read fails quietly (`delete after read failed` in the log), and notice fields wait for the lazy TTL sweep.

## Where things are

```
src/App.tsx                        ← the View state machine, home, end-session and departure orchestration, sweeps
src/types.ts                       ← every shared type (records, the chain, stores, notice fields)
src/index.css                      ← Tailwind @theme tokens, the vault background, .gf-card, safe-area utilities
src/components/                    ← screens and sheets. The main ones:
  SignScanner, Clarify, ParkingResult, NoReadableSign      scan → answer (permit answers, gates, unclear signs)
  SessionLogger, PhotoAngleGrid, BoundaryQuestion          logging a record (condition photos, proof photo, driver)
  ReminderOptions, ReminderStatus, ScheduledRemindersSection   Remind me, push status, booked reminders
  SessionDetail, ChainPanel, EvidencePhotos, DepartureRow  the record screen and its signed parts
  DepartureSheet, AddEvidenceSheet, HandoverSheet, ShareSheet  the sheets
  SessionHistory, ActiveSessionCard, ActiveSessionsList, HomeMenu
  NoticeLookup, AppealFlow                                 "Got a fine? Start here" and the appeal letter
  RecurringReminders, RecurringRuleEditor, RecurringOffer  weekly reminders
  Settings, PushManagementSection, AuthSettings, PrivacyPolicy, AboutFeatures
  SharedLinkView, SharedRecordScreen, SharedFactsPanel     share links and shared copies
  WorkdayStart, WorkdayCard, WorkdayView, WorkdayPdfExport workday mode (flag)
  ui/                                                      Alert, BackButton, Button, Card, Input
src/lib/storage.ts                 ← records, workday and recurring stores, the chain writes, quota recovery
src/lib/evidence-chain.ts          ← chain rules, arrival_context, departure catch-up
src/lib/signing.ts                 ← the per-record signing queue and the sweep
src/lib/verify.ts                  ← the browser verifier
src/lib/photo-store.ts, session-photos.ts   ← IndexedDB photos and getSessionPhoto
src/lib/sync.ts, evidence-merge.ts ← cloud mirror and the client merge
src/lib/claude.ts, api.ts          ← translateSign, refreshInterpretation, draftAppeal, postJsonAndPoll
src/lib/permit-answer.ts, profile.ts        ← permits on the result screen and in Settings
src/lib/notice-read.ts, notice-match.ts, notice-compare.ts   ← T8
src/lib/recurring.ts, recurring-push.ts, ics.ts             ← weekly reminders and calendar files
src/lib/push.ts, remind-me.ts, alert-reach.ts, notifications.ts   ← push, in-tab reminders, "can this phone alert"
src/lib/share-link.ts, share-receive.ts, shared-record.ts, handover.ts   ← T7
src/lib/workday*.ts, jurisdiction.ts, pdf-workday.ts         ← workday maths, flow, reminders, chain, PDF
src/lib/pdf.ts, pdf-fonts.ts, evidence-bundle.ts             ← PDFs and the evidence file
src/lib/features.ts                ← VITE_FEATURE_WORKDAY
src/lib/i18n.ts, src/locales/*.json ← i18next, 9 locales (generated by the inject scripts)
src/service-worker.ts              ← precache, push receiver, notification click
lambda/index.js                    ← dispatcher, sign reader, notice reader, appeal, signing, feedback, push
lambda/sign-reading.js             ← normalizeModelOutput, request checks (no SDK imports)
lambda/addendum-schema.js          ← addendum schemas, caps, canonicalize (shared with the browser)
lambda/recurring-schedule.js, push-tombstone.js   ← weekly cron plans and dispatch; push tombstones
lambda/cloud-sync.js               ← the JWT routes and the server merge
vite.config.ts                     ← dev /api middlewares, the dev signer, .env loader, PWA plugin
scripts/                           ← deploy and setup scripts, i18n injectors, schema check, eval harness
migrations/two-app-architecture/landing-from-claude-design/   ← the landing, /verify/ and /accuracy/
public/                            ← icons, splash, og-image, parkproof-public-key.pem, fonts/ (PDF subsets)
eval/                              ← accuracy benchmark corpus (empty) and rubric
docs/build/                        ← roadmap spec, deploy checklist, field-test plan, fix list, translation review
docs/legal-review-queue.md         ← every string a lawyer should read (none read yet)
```

## Status

### Shipped to production (main)

- ✅ Sign translator, clarification for position-dependent signs, photo-quality pre-check, restriction-transition banner
- ✅ Record logger (GPS, reverse geocode, editable address, car photo), driver's note (280 characters, unsigned)
- ✅ Reminders: multi-offset picker, `.ics` with several alarms, in-tab notifications and Web Push through EventBridge Scheduler, booked times on the record screen, cancelled on I've left
- ✅ Evidence PDF, account export PDF, AI-drafted appeal letter
- ✅ History, record screen, delete; live home card; no-sign records; walk-back navigation
- ✅ Cloud sync (opt-in), Apple and Google federation, account export and delete
- ✅ PWA, custom domain, two-app architecture (landing at `/`, app at `/app/`), security hardening, Web Push via EventBridge Scheduler
- ✅ 9 languages including the PDFs (per-locale Noto subsets), time zones from the coordinates
- ✅ Re-check (smart re-scan) by proximity or picker; stepped loading; AI feedback telemetry
- ✅ Brand: the Greenfield vault identity (`44ee7a3`, 30 Jun 2026)
- ✅ The evidence chain, T0a to T1b (merged to main as `12d9318`, field-tested 8 Nov 2026): signed addenda, IndexedDB photos, the browser verifier, chain-aware sync, the departure sheet and signed departure, the signed parts panel, time zones in every PDF, chained signature pages, honest appeal evidence

### On `integration/roadmap-2`, not deployed yet

- ✅ Field-test fixes (`b639e76`, `7b10cc1`): self-healing push registration, one Remind me, iPhone safe area, visible back buttons, "Ended 5:23 pm", pull on return
- ✅ T2: condition photos at parking and on return, proof of payment or permit, the evidence file, verify pages with the chain and photo steps (`2a100f6`)
- ✅ T3: sign status, area signs, permit exceptions, weekly restrictions, the unclear-sign screens (`4168c72`; schema flattened in `789fdc5`)
- ✅ T4: Settings (driver name, up to 3 permits, notifications), permit answers and safeguards, `permit_commitment`, the privacy policy rewrite, the home layout (`e60391c`)
- ✅ T5a and T5b: street sweeping and weekly reminders, on the phone and by weekly push (`86041be`)
- ✅ T7: "Share where the car is" links, read-only shared copies, "Hand the car over" (`5071dba`)
- ✅ T8: "Got a fine? Start here", the notice reader, matching and the factual comparison (`598ffdf`)
- ✅ T9: the accuracy harness, rubric and method page (`d44c191`). No numbers yet: the test corpus is empty, so the in-app link stays off
- ✅ Copy pass and copy lint (`5902506`), overnight fix list (`b63e8ee`: deploy packaging, the workday build switch, the jobs-table and log-retention scripts, privacy accuracy, contrast, `<html lang>`, calendar text in every language)
- 🚩 **T6a, T6b, T6c: workday mode** (`c615e66`, `378c4c6`, merged `09d5c24`). Built, tested, and **off in production** behind `VITE_FEATURE_WORKDAY`. Why: moving a few bays along the same signed stretch doesn't restart a time limit, and under an area sign the car must leave the whole area (Road Rules r205(2), r332, r335). A careless version gets drivers fined and hands councils signed proof of the breach. Every workday string must be read by a lawyer first, and none is engaged. VIC and QLD only, when it does ship
- ✅ T10 items 1, 2 and 5: the language review of every new string in 8 locales and the /verify pages (`scripts/t10-review/`, applied by `scripts/_i18n_inject_t10_review.mjs` and `scripts/_build_verify_pages.py`), these docs, and the legal review queue
- ⏳ T10 items 3 and 4: the About page and the landing (waiting on the redesign choice)

### Numbers (9 Nov 2026, at `09d5c24`)

- Tests: 168 files, 3,037 tests (`npx vitest run`, which includes `lambda/**` and `scripts/**/*.test.mjs`).
- Bundle (`npx vite build`, workday flag unset, so off): main chunk 1,964.55 kB minified, 516.75 kB gzipped, most of it the 9 inline locale files (about 1.4 MB of JSON). Lazy chunks include the PDF code (457 kB, 148 kB gzipped), html2canvas (200 kB), ics (72 kB) and the cloud sync code (96 kB). 52 precache entries, 4,339 KiB.

### Later

- ⏳ AI feedback Layer 3: opt-in photo capture for systematic failures
- ⏳ Citywide parking map: needs a share toggle, a viewer and the cold start solved
- 🤔 Voice confirmation: considered and deferred (the phone is already in hand at the sign; `docs/features.md`)
- ⛔ Council appeal auto-submit: blocked by council captchas and no public APIs
