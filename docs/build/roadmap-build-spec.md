# ParkProof roadmap build spec (October 2026, v2)

This spec turns the tiers in `docs/research/00-synthesis.md` (section 8, "The plan") into build tasks. Version 2 folds in an adversarial review from three angles: legal safety, data integrity, and sequencing/UX. Nobody uses the app yet, so changes to local data are fine as long as existing saved records still load.

Read this whole file before starting any task. Each task section says what to build. The rules in "Rules for every task" and the "Normative designs" section apply to every task.

Task order: T0a, T0b1, T0b2, T0b3, T0b4, T1a, T1b, T2, T3, T4, T5a, T5b, T7, T8, T9, T6a, T6b, T6c, T10.

---

## Rules for every task

### Safety and scope
- Never deploy. Never run `scripts/deploy.sh` or any `scripts/setup-*.sh`. Never call AWS. Never `git commit` or `git push` in the real repo. Never set `KMS_KEY_ID` locally.
- The current working tree is the baseline, including the uncommitted push-notification hardening (lambda/index.js push handlers, service worker, reminder copy, deep links). Don't revert it.
- Do not touch `dist/`. Build checks go to a scratch folder.
- No new runtime dependencies. Dev dependencies (for example `fake-indexeddb`) only if your report names them.
- Do not build anything on the "Do not build" list: reading users' calendars, maps of where people have been, appeal odds, penalty amount checks, NSW notice-error screening, "can I sleep here tonight", reporting other drivers, walk-me-home safety, inspector or patrol alerts, a made-up minimum re-parking distance.
- Leave other tasks' work alone unless your task says to change it. If you find a real bug outside your task, fix it only if it blocks you, and say so in your report.

### Verification gate (must all pass before you finish)
- `npx tsc -b` exits 0.
- `npx vitest run` passes, including your new tests.
- Scoped lint: `npx eslint src vite.config.ts vitest.config.ts lambda` shows no NEW problems. The baseline is 1 pre-existing error (`lambda/cloud-sync.js` unknown rule comment) and 1 pre-existing warning.
- `npx vite build --outDir <scratchpad>/build-check` succeeds.

### Copy rules (user-facing text)
- No em-dashes anywhere in user-facing copy. Use commas or full stops.
- Australian spelling. Sentence case. Second person. Short sentences. The user-facing noun is "parking record" or "record", not "session".
- Never write "reset", "compliant", "compliance proven", "admissible", "authentic", "verified location", "accepted by insurers" or "accepted by council". Never promise an outcome. No odds, no verdicts ("strong evidence"), no legal advice.
- A signature shows that the signed details existed, unchanged, by the signed time. It does not show they are true, who was driving, where the car was, or when it arrived or left. Say so wherever signed material is presented.
- Times from the phone are labelled as phone times ("You tapped I've left at 1:55 pm"). Times from the server are labelled as ParkProof's signing time. Never call a phone time "signed".
- Driver statements are the driver's own statements. Never word them as something the app confirmed.
- Every reminder feature carries the reliability line: "Reminders can be delayed or silenced, for example by Focus or battery saving. Don't rely on them alone."

### i18n rules
- Every user-facing string goes through `t()`. Enum values from the model or from code go through a key map, never printed raw.
- Add keys to all 9 locales (`en, zh-CN, vi, id, ko, it, el, hi, pa`) with ONE idempotent script per task: `scripts/_i18n_inject_<task>.mjs`. Format: `JSON.stringify(data, null, 2) + '\n'`, UTF-8, LF. Append new keys inside their parent object. Never re-sort a file. Changed existing strings need an explicit overwrite list in the script.
- The script aborts before writing if any locale's new key set differs from en's, if `{{vars}}` or `<tags>` differ from en, or if a `_one` key lacks its `_other` sibling.
- Plurals: `_one` and `_other` under the SAME base name in all 9 locales, `{{count}}` in both forms (hi and pa use `_one` for 0 too).
- Terminology: the verified table in `docs/legal-pdf-review-worksheet.md` (council, fine, infringement notice, appeal/review, accessible parking permit, permit zone, cryptographic signature, driver, parking record, departed). Register: el εσύ, id kamu, zh 你. Gender-neutral, no gendered first person (hi/pa). Rewrite whole strings; never regex-swap terms.
- "ticket" is ambiguous in English. Key names say `meterTicket` (pay-and-display) or `fineNotice` (infringement notice).
- PDF strings: plain text plus WinAnsi punctuation. No ✓ ⚠ → ≈ ≤ or emoji.
- `src/lib/locales.test.ts` (T0a) enforces parity and must pass.

### Design rules
- Greenfield identity: vault `brand-800 #073B25` background, white `.gf-card` cards, pine `brand-500`, mint `#7BE3A4` only for the verified seal glow and active states, sage `#A9CFBE` for muted text on the vault. Space Grotesk headings, Inter body.
- Reuse `src/components/ui/*` and the idioms in existing screens: wrapper `min-h-screen flex flex-col p-6 max-w-md mx-auto w-full`, title `font-display text-3xl font-extrabold text-paper-50 mb-1`, field label `text-xs uppercase tracking-widest font-semibold text-ink-600`, glass rows on the vault with `background: rgba(255,255,255,0.055)`.
- Touch targets at least 44px. Modals and sheets follow `FeedbackModal.tsx` (`fixed inset-0 z-50`, `role="dialog"`, `aria-modal`, focus trap, Escape closes).
- New icons go in `Icon.tsx` (`IconName` union and `PATHS`, 24-unit stroke paths).
- Every photo goes through `resizeImageFile`.
- Never gate a feature behind sign-in. Local first, cloud mirror when signed in.
- Optional steps are collapsed by default. The common path must not get slower.

### Local development facts
- `npm run dev` serves the app at `http://localhost:5173/app/`. The Vite plugin in `vite.config.ts` proxies `/api/*` to `lambda/index.js` in-process.
- After T0b1, `/api/sign-session` in dev uses an ephemeral local P-256 key (`key_alias: 'dev-ephemeral'`), so chains can be exercised locally. Production signing is unchanged.

### Report
Finish with a structured report: what you built, every file touched, public functions and types other tasks will rely on, decisions you made where this spec was silent, anything left undone, and the exact verification results.

---

## Normative designs (every task follows these)

### N1. Data model added in this build
All new session fields are optional, so existing records keep loading. T0b1 adds every type below, and T0b4 adds every field to the cloud whitelist, so later tasks only fill them in. If a later task needs a field not listed here, it adds it to `src/types.ts` AND to `ALLOWED_SESSION_FIELDS` in `lambda/cloud-sync.js` AND to the client merge.

```ts
type PhotoRole =
  | 'sign' | 'car' | 'ambient'
  | 'condition-front' | 'condition-rear' | 'condition-left' | 'condition-right' | 'condition-detail'
  | 'return-front' | 'return-rear' | 'return-left' | 'return-right' | 'return-detail'
  | 'compliance'

interface PhotoRef {
  role: PhotoRole
  sha256: string              // hex of the exact JPEG bytes stored; computed at capture
  captured_at: string         // client ISO
  source: 'camera_input' | 'library'   // 'library' when the file input was the library, or File.lastModified is > 2 min old
}

type AddendumKind = 'arrival_context' | 'condition' | 'compliance' | 'departure' | 'handover'

interface SignedAddendum {
  id: string                  // uuid, also inside the signed payload as addendum_id
  seq: number                 // 1, 2, 3...; link 0 is the arrival bundle
  kind: AddendumKind
  captured_at: string         // client ISO, frozen at queue time
  data: Record<string, unknown>   // frozen at queue time, normalised by lambda/addendum-schema.js
  bundle?: SignatureBundle    // absent = pending
  rejected?: { code: string; at: string }   // server said 400; never retried
}

type SignStatus = 'readable' | 'partially_obscured' | 'missing' | 'contradictory' | 'not_a_parking_sign'
type Jurisdiction = 'VIC' | 'QLD' | 'NSW' | 'ACT' | 'SA' | 'WA' | 'TAS' | 'NT'

interface LogDraft {             // carried by the clarify, result and logging views
  gate_acks: { meter_ticket: boolean | null; permit_zone: boolean | null; accessible_permit: boolean | null }
  permit_context: PermitContext | null
  workday: { workday_id: string; leg_index: number; previous_session_id: string | null } | null
  driver_name: string | null
}

interface PermitContext {
  type: 'accessible' | 'resident' | 'business'
  area: string | null
  holder_present: boolean | null       // accessible only; null for resident/business
  sign_exception_applies: boolean      // the sign itself prints an exception for this permit
  standard_until: string | null
  permit_until: string | null
  note: string | null
}

ParkingSession gains:
  chain_key?: string                   // 32 random bytes hex; secret; this device and the user's own cloud copy only
  photos?: PhotoRef[]                  // every IndexedDB-backed photo of this record (new records: sign, car, ambient too)
  v1_hashes?: { sign: string | null; car: string | null; ambient: string | null }  // stored at save so link 0 can always be signed
  addenda?: SignedAddendum[]
  condition_note?: string | null       // existing damage the driver noticed, <= 280 chars
  compliance_type?: 'meter_ticket' | 'payment_confirmation' | 'permit_displayed' | 'other' | null
  gate_acks?: LogDraft['gate_acks']
  rule_flags?: { requires_ticket: boolean; payment_methods: string[] | null; requires_disabled_permit: boolean;
                 is_permit_zone: boolean; permit_area: string | null; is_area_sign: boolean }
  sign_status?: SignStatus
  sign_issues?: string[]
  recurring_restrictions?: RecurringRestriction[]
  place?: { road: string | null; suburb: string | null; state_code: string | null }   // raw reverse-geocode parts, unsigned, never edited
  departure?: { ended_at: string; location: { lat: number; lng: number; accuracy_meters: number | null; source: 'gps' } | null;
                distance_from_arrival_m: number | null }
  driver_name?: string | null
  permit_context?: PermitContext | null
  permit_salt?: string | null          // hex; lets the driver reveal permit_context later (see N3)
  jurisdiction?: Jurisdiction | null
  workday_id?: string | null
  leg_index?: number | null
  boundary?: BoundaryStatement | null
  stretch_deadline?: string | null
  shared_from?: { original_session_id: string; received_at: string; shared_at: string | null;
                  arrival_bundle: SignatureBundle | null; snapshot: Record<string, unknown> } | null   // read-only import
```

`sign_photo`, `car_photo` and `ambient_photo` stay for old records. New records (from T0b2) store those bytes in IndexedDB and leave the fields null. Every reader goes through `getSessionPhoto(session, role)`.

### N2. The evidence chain
- **Link 0** is the arrival bundle. Old records have `parkproof-evidence-v1`. New records sign `parkproof-evidence-v2` = every v1 field plus `chain_key_sha256` (sha256 hex of the record's `chain_key`). v1 stays byte-identical: extract `buildEvidenceV1Payload(body, signed_at)` and golden-test it before touching the handler, then add `buildEvidenceV2Payload`.
- **Link N (N >= 1)** is an addendum, schema `parkproof-addendum-v1`, canonical payload:
  `{ schema, addendum_id, kind, session_id, seq, parent_payload_sha256, chain_key_sha256, captured_at, signed_at, data }`
  `parent_payload_sha256` = sha256 hex of the parent link's `canonical_payload` UTF-8 bytes. `chain_key_sha256` is copied forward from link 0 (null for v1 parents).
- **Ordering**: the parent of seq N is seq N-1. `appendAddendum` assigns seq from a fresh read (max seq + 1), never from a caller's object. An addendum is sent for signing only when its parent has a bundle. `setAddendumBundle` is first-write-wins (returns false if a bundle exists). Children are signed against the parent bundle read from storage.
- **One queue per record**: all signing for a record runs through one in-memory promise chain, inside `navigator.locks.request('pp-sign-' + id)` where available. `queueAddendum`, the retry sweep and the `online` and `visibilitychange` triggers all enqueue there. When a link gets its bundle, the next pending link is tried immediately.
- **arrival_context is always link 1** for new records: queued right after `saveSession` and before `signSession`, even when every field is null. It carries `chain_key_sha256` and the facts captured at parking.
- **Failures**: signing returns `{ ok: bundle } | { transient } | { rejected: code }`. HTTP 400 marks the addendum `rejected` and stops retrying it; later pending addenda are renumbered after it; the screen shows "This part couldn't be signed". 429, 5xx, network errors and `navigator.onLine === false` are transient and never count toward a retry cap. The sweep runs on mount, on `online`, and on `visibilitychange` to visible, at most once per 60 s per record.
- **Server checks** before signing an addendum: (1) verify the parent's signature locally with the published public key embedded in the Lambda (no KMS call; `ERR_PARENT_SIGNATURE`); (2) `parent.session_id === session_id`, and either `seq === 1` with a v1/v2 parent or an addendum parent with `parent.seq === seq - 1` (`ERR_PARENT_MISMATCH`); (3) when the chain has a key, `sha256(chain_key) === parent.chain_key_sha256` (`ERR_CHAIN_KEY`); the request carries `chain_key`, the payload carries only its hash; (4) client times (`captured_at`, and `ended_at`, `handed_over_at` inside data) no later than server time + 5 min (`ERR_FUTURE_TIME`); (5) parent payload <= 16 KB, body <= 32 KB.
- **Validation rejects, never repairs.** Every key in a kind's schema is required (null when empty). Missing key: `ERR_MISSING_FIELD`. Unknown key at any depth: `ERR_UNKNOWN_FIELD`. Over-long strings, or strings containing U+0000-001F, U+007F-009F, U+2028/2029, U+202A-202E, U+2066-2069: `ERR_BAD_STRING`. ISO times match `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$`. Validation failures are HTTP 400 with the code. The schemas, caps and `normalizeAddendumData()` live in `lambda/addendum-schema.js` with no SDK imports (plus a `.d.ts`). The client imports it and normalises before queueing, so what is stored equals what is signed. After signing, the client asserts `canonicalize(stored data) === canonicalize(parsed payload data)`.
- **Per-kind data** (all keys required):
  - `arrival_context`: `{ driver_name: str<=60|null, sign_status: enum|null, sign_issues: str<=200[]<=5, rule_flags: RuleFlags|null, gate_acks: GateAcks|null, permit_commitment: hex64|null, photos: PhotoRefData[]<=12, condition_note: str<=280|null, compliance_type: enum|null, jurisdiction: enum|null, workday: { workday_id: uuid, leg_index: int 0..50, stretch_deadline: iso|null, previous_departure_payload_sha256: hex64|null }|null, boundary: BoundaryStatement|null }`
  - `condition`: `{ when: 'parking'|'return', photos: PhotoRefData[] 1..5, note: str<=280|null }`
  - `compliance`: `{ compliance_type: enum, photo: PhotoRefData }`
  - `departure`: `{ ended_at: iso, location: Location|null, distance_from_arrival_m: number>=0|null, return_photos: PhotoRefData[]<=5 }`
  - `handover`: `{ from_driver: str<=60|null, to_driver: str 1..60, handed_over_at: iso, location: Location|null }`
  - `RuleFlags`: `{ requires_ticket: bool, payment_methods: str<=20[]<=6|null, requires_disabled_permit: bool, is_permit_zone: bool, permit_area: str<=20|null, is_area_sign: bool }`
  - `GateAcks`: `{ meter_ticket: bool|null, permit_zone: bool|null, accessible_permit: bool|null }`
  - `PhotoRefData`: `{ role: PhotoRole, sha256: hex64, captured_at: iso, source: 'camera_input'|'library' }`
  - `Location`: `{ lat: -90..90, lng: -180..180, accuracy_meters: number>=0|null, source: 'gps' }`
  - `BoundaryStatement`: `{ previous_session_id: str<=64, asked_because: ('within_30m'|'same_street'|'same_sign_text'|'area_sign'|'location_unreliable')[], answer: 'opposite_direction_sign'|'yellow_edge_line'|'t_intersection_or_dead_end'|'left_parking_area'|'not_sure'|'not_asked', distance_from_previous_m: number>=0|null }`
- **Signed facts are read from the signed payload.** Screens and PDFs show signed values parsed from `canonical_payload`. Values not yet signed are labelled "Not signed yet".
- **Departure catch-up**: the sweep queues a `departure` addendum (location null) for any record with `ended_at` but no departure addendum.
- **Dev signer**: in `npm run dev`, `/api/sign-session` signs with an ephemeral P-256 key and `key_alias: 'dev-ephemeral'`. The verifier reports such links as "Signed with a development key", never as valid.

### N3. Sensitive data in signed records
Accessible-permit status is health information. Never sign permit details in plain text. `arrival_context.permit_commitment` = sha256 hex of `permit_salt + canonicalize(permit_context)`. The PDF and the evidence bundle reveal `permit_context` and the salt only when the driver ticks "Include permit details". Never log permit types server side. The feedback telemetry gets a `permit_used` boolean at most.

### N4. Photos
- IndexedDB, content-addressed and immutable. Key `${sessionId}/${sha256}`. Role is metadata, never part of a key. A key is written once and never overwritten. S3 key `${userId}/${sessionId}/p/${sha256}.jpg`.
- API (`src/lib/photo-store.ts`): `putPhoto(sessionId, dataUrl): Promise<string /* sha256 */>` (hashes inside with the exported `hashDataUrlImage`), `getPhoto(sessionId, sha256)`, `deleteSessionPhotos(sessionId)`, `listSessionPhotos(sessionId)`, `sweepOrphanPhotos(knownIds)`. Injectable backend for tests.
- A `PhotoRef` is created only after the IndexedDB transaction completes. On failure the tile shows an error and no ref is created. Reopen the database once on `InvalidStateError` or `UnknownError`.
- Call `navigator.storage.persist()` on the first capture.
- One "bytes missing" state everywhere: "Photo not on this device. Signed fingerprint 3f9a…c21b." The verifier shows it as not checkable, never as valid.
- SessionLogger mints the record id on mount (`useState(() => crypto.randomUUID())`); cancelling the logger calls `deleteSessionPhotos(id)`; `saveSession` refuses a duplicate id. Startup GC deletes photos whose record id is absent and older than 24 h. Quota eviction also deletes the evicted record's photos.

### N5. Times
- `ended_at` and `arrived_at` come from the phone. Only `signed_at` comes from the server. Comparisons with a notice use `signed_at` for any "before the notice" statement; when `signed_at - ended_at` > 5 min, show both.
- Exported `formatInZone(iso, tz, { withYear, withZone })` (with `timeZoneName: 'short'`) is used for every time in PDFs and comparisons.

### N6. Push ownership
Push schedules belong to the device that created them. `/push/schedule`, `/push/cancel` and the T5b recurring routes require `device_id`. Before deleting or replacing a schedule the handler reads it (`GetScheduleCommand`) and goes ahead only when the Target Input `device_id` matches. A mismatch returns 403 `ERR_NOT_OWNER` and changes nothing.

---

## T0a. Hygiene the rest depends on

1. **Locale parity test** `src/lib/locales.test.ts`: flattened key equality across all 9 files, equal array lengths, equal `{{var}}` and `<tag>` sets per key, every `_one` has an `_other` sibling, hi and pa `_one` strings contain `{{count}}`. Fix existing violations instead of weakening the test: 17 hi and 17 pa `_one` strings hardcode "1"; split-base plural keys (`time.hourLeft_one` vs `time.hoursLeft_other`, `parkedForHour`, `hourAgo`, `pdf.duration.hourOnly`) fall back to English in zh-CN, vi, id, ko. Rename to one base per concept and update `countdown.ts`, `time-format.ts`, `pdf.ts`.
2. **One end-session path.** `SessionDetail` and `ActiveSessionCard` only ask App to end the record. `App.handleEndSession` owns `endSession`, cloud mirror, push cancel and in-tab cancel.
3. **Ending after expiry.** `loadActiveSessions` keeps expiry-bearing records without `ended_at` for 12 h after `expires_at`; the home card shows them as "Expired at {{time}}" with "I've left" as the primary action. "I've left" is available on any record without `ended_at` (SessionDetail `canEnd`). `SessionHistory.statusFor` treats `ended_at` as ended.
4. **Quota recovery** (`storage.ts`): fix the phase 3 splice bug, strip `ambient_photo` too, and never strip photos from or evict a record whose arrival signature is missing or which has any pending addendum.
5. **Re-check hang**: `handleReuseSession` returns while the view is `loading` when `sign_photo` is falsy. Route that case back to `scan`.
6. **Records-changed event**: `updateSession`, `saveSession`, `deleteSession` (and later `appendAddendum`, `setAddendumBundle`) dispatch `parkproof:records-changed` on `window`. A `useRecordsVersion()` hook re-renders on it. App's `activesVersion` and SessionDetail use it; SessionDetail reads its record with `getSession(id)` on every change, so background signing shows up without navigating away.
7. **Push ownership (N6)**: implement in `lambda/index.js` for `/push/schedule` and `/push/cancel`; `cancelPushReminders` sends `device_id`. Tests with a mocked Scheduler client.

## T0b1. Evidence chain core (no UI)

1. Types: everything in N1, plus `LogDraft`. The `clarify`, `result` and `logging` views in `App.tsx` carry `draft: LogDraft` (empty values for now). Later tasks add data only through it.
2. `lambda/addendum-schema.js` (+ `.d.ts`): schemas, caps, `validateAddendumBody`, `normalizeAddendumData`, as N2.
3. Lambda: extract and golden-test `buildEvidenceV1Payload`; add v2 (N2); addendum branch inside the existing `/sign-session` handling when `body.schema === 'parkproof-addendum-v1'`, with every server check in N2. Embed the public key in the Lambda (a module constant, plus a test that it equals `public/parkproof-public-key.pem` with line endings normalised). Validation runs before the `KMS_KEY_ID` check. Map v1 validation errors to 400 as well.
4. KMS test mock: freeze time with `vi.setSystemTime`, build the expected payload, assert the `SignCommand` `Message` equals `sha256(expected)` with `MessageType: 'DIGEST'`, and return `crypto.sign('sha256', expected, key)` (DER). Never switch production to RAW.
5. Dev signer middleware in `vite.config.ts` (N2).
6. Client (`src/lib/storage.ts`, `src/lib/signing.ts`): `chain_key` generated at save; `appendAddendum`, `setAddendumBundle` (N2 semantics, dispatch records-changed); the per-record queue; `queueAddendum(sessionId, kind, data)`; v2 arrival signing for new records; `v1_hashes` stored at save; the retry sweep (link 0, then pending addenda in order; transient vs rejected; triggers; cloud mirror after a successful retry, which is missing today); `arrival_context` queued at save (built by a pure `buildArrivalContext(session, draft)`); departure catch-up.
7. Tests: golden vectors (v1, v2, addendum), every validation rejection, server parent/seq/chain-key/future-time checks, queue ordering (two quick appends, pending parent, rejected link renumbering, double-sign protection).

## T0b2. Photos in IndexedDB

1. `src/lib/photo-store.ts` as N4, with tests on an injected backend.
2. New records store sign, car and ambient photos in the photo store (roles `sign`, `car`, `ambient` in `photos`) and leave the legacy fields null. `getSessionPhoto(session, role): Promise<string | null>` returns the legacy data URL for old records and IndexedDB bytes for new ones. Signing (hashes come from `PhotoRef.sha256` or `v1_hashes`), SessionDetail, the SessionHistory thumbnail, PDF materialisation, the re-check flow and sync all read through it.
3. SessionLogger mints the id on mount, writes photos on capture, cancels cleanly (N4). The sign photo from the scan is written when the logger mounts.
4. Startup GC, `persist()`, the bytes-missing state, eviction deletes photos.
5. Deleting a record deletes its photos.

## T0b3. Browser verifier

`src/lib/verify.ts`: verify with `crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, utf8(canonical_payload))` (payload bytes, not the digest). DER to raw: drop one leading 0x00, left-pad each integer to 32 bytes, reject longer. Per link, check `schema`, `session_id`, `seq`, the parent hash and the chain key hash. Detect forks (two signed links with the same seq) and report "Added from two devices". Re-hash every locally available photo against its signed hash. Report per link: valid, invalid, pending, rejected, dev key, and per photo: matches, differs, not on this device. Tests: hand-made vectors (33-byte r, 31-byte s), a 1,000-signature loop with a local key, chain checks, an optional real-bundle fixture `src/lib/__fixtures__/kms-bundle.json` (skip with a warning if absent).

## T0b4. Cloud sync for the chain and photos

1. `ALLOWED_SESSION_FIELDS`: every N1 field (including `chain_key`, which only ever goes to the owner's own row).
2. Two lists per side: `LEGACY_PHOTO_FIELDS` (sign, car, ambient; field-backed, hydrated) and photo refs (IndexedDB plus materialize only, never hydrated). `/photos/presign` and `/photos/materialize` accept `{ session_id, sha256 }` (sha256 `^[0-9a-f]{64}$`) for refs, keeping the legacy role form for old records.
3. Server merge: `/sessions/upload` reads the item and writes with a condition on a `rev` attribute (retry up to 3 times). `addenda`: union by `id`, prefer the copy with a bundle, never drop a stored signed addendum. `signature`, `ended_at`, `departure`: keep the stored value when the incoming row has none. Everything else: last write wins. Cap addenda at 20.
4. Client merge: a pure `mergeEvidence(local, cloud)` with the same rules runs in `performInitialSync`'s both-sides branch, then uploads if local has links the cloud lacks.
5. At most one `uploadSession` in flight per record; a request during one sets a dirty flag and runs once more after. `uploadSession` re-reads the record right before the metadata POST.
6. Upload marker: a per-device set of `${sessionId}/${sha256}` (and legacy role keys), set only after the S3 PUT returns 2xx. No re-uploads.
7. Stale-URL fix: on upload, null any legacy photo value that is not a `data:` URL; at hydration, always re-mint for objects that exist. Hydrate with one paginated `ListObjectsV2` per list call.
8. Enforce the per-user object cap correctly (paging, or a counter), not with a single `ListObjectsV2` count.
9. Missing local bytes for a ref: fetch through `/photos/materialize`, re-hash, cache in IndexedDB only on a match.
10. PDFs materialise only the photos they draw, concurrency 4.
11. Pulled records whose v1 photos are not local never get a second link 0 (the retry skips them).
12. Tests for merge, server merge rules (mock DynamoDB), upload serialisation.

## T1a. Signed departure and the chain on screen

1. **Departure sheet** (modal) replaces `window.confirm` at both "I've left" entry points (home card, record screen). One status line ("Getting your location" / "Location captured, ±12 m" / "No location"), the button "Confirm I've left", and "Cancel". Confirm stamps `ended_at` and closes the sheet at once. App's orchestrator keeps waiting up to 8 s for the fix in the background (logic extracted from `SessionLogger.requestGps`: high accuracy, `maximumAge: 0`), then saves `departure` and queues the departure addendum. If the tab closes first, the departure catch-up covers it.
2. Distance from arrival. Over 150 m add: "Your phone was {{distance}} from where you parked when you tapped I've left. The record shows when you tapped, not when the car moved."
3. `buildArrivalContext` fills from the record and the draft (most fields null until later tasks).
4. **Chain panel** on the record screen, under the existing vault signature panel: each link with what it covers and ParkProof's signing time (local time with zone), pending links "Not signed yet", rejected links "This part couldn't be signed". "Check signatures" runs `verify.ts`. Success copy: "All {{count}} signatures are valid. Nothing has changed since ParkProof signed it. That doesn't show what the record says is true." Photo results as N4. Dev-key and fork states as T0b3.
5. Departure row copy: "You tapped I've left at {{time}} (phone clock)." and "Signed by ParkProof at {{time}}." Never "signed departure at" for the tap time.

## T1b. Time zones, the PDF, and appeal evidence

1. `formatInZone` (N5) and use it for every time in all PDFs.
2. Extract `sessionRows(session, tz, t)` and `drawSessionBlock(doc, session, y, t, font, tz): number` and make all three PDF entry points (`downloadPdf`, `downloadAppealPdf`, `downloadFullExportPdf`) use them. Later tasks add rows only there.
3. Departure rows: "Tapped I've left (phone clock)", "Signed by ParkProof (server clock)", departure location and accuracy, approximate distance from arrival (phone GPS).
4. `drawSignatureAppendix` loops over link 0 and every signed addendum: a heading per link, file names `link0-payload.b64`, `link1-payload.b64` and so on, and a chain step ("`sha256sum link0-payload.txt` equals `parent_payload_sha256` in link 1"). The appeal PDF and the full export get the appendix too. New sections go before the closing statement (it does not advance `y`).
5. Copy replacements (all 9 locales, explicit overwrites):
   - `pdf.evidence.statement`: "This is a record of a parking event made with ParkProof. Times marked as phone times come from the driver's phone. Statements marked as the driver's are the driver's own. It is not a legal finding about what happened. The council or court decides that."
   - `pdf.signature.intro`: "Each part of this record was signed by ParkProof's server when the server received it, at the signed_at time shown for that part. A valid signature shows the signed details and photo fingerprints have not changed since then. It does not show that they are true, who was driving, or when the car arrived or left."
   - `verifyStep6`: "6. Expect \"Verified OK\". This shows the signed bytes have not changed since ParkProof signed them."
   - In `verifyStep7`, "already proved those values are authentic" becomes "showed those values have not changed since signing".
   - `about.evidence.items[1]`: "Each record is signed, so anyone can check it hasn't been changed since it was signed."
6. Appeal evidence: `draftAppeal` (`src/lib/claude.ts`) and `evidenceText` (`lambda/index.js`) send separately labelled lines: arrival (phone clock), arrival signed (server), departure tapped (phone clock), departure signed (server), `location_source: gps|manual`, all pre-formatted in local time with the zone name. Add to `APPEAL_SYSTEM_PROMPT`: "A ParkProof signature shows only that the record existed, unchanged, by its signed time. Never write that a signature proves when the car arrived or left, or where it was. Describe tapped times as the driver's own record. Call a location GPS-based only when location_source is gps, and never call it verified." Delete the "GPS-verified location" wording.

## T2. The signed before-photo and the compliance photo

1. **`PhotoAngleGrid`**: front, rear, left, right and an optional detail tile. Camera input only (`capture="environment"`, no library button); record `source` per N1 (library when `File.lastModified` is more than 2 minutes old, since desktop browsers ignore `capture`). Each capture goes through `resizeImageFile`, `putPhoto`, then a `PhotoRef`.
2. **SessionLogger section order** (fixed for every later task): location, car photo, driver line (T7), "Record the car's condition (optional)" (collapsed), proof of payment or permit, boundary question (T6, workday only), Save. Only the boundary question may block Save.
3. **At parking**: the collapsed condition section holds the grid and an optional "Damage you noticed" note (280 chars). These go into `arrival_context`.
4. **Proof of payment or permit**: when the rules need a meter ticket, a permit zone or an accessible permit, one button "Add a photo of your ticket or permit (optional)" with the type preselected from the gate; the type picker (meter ticket on the dash, payment confirmation, permit displayed, other) appears only after a photo is taken. Payment confirmations may come from the library. Otherwise the section is collapsed. Gate acknowledgements reach the logger through `draft.gate_acks` and are saved as `gate_acks`.
5. **After saving**: on a record that has not ended, "Add condition photos" and "Add a photo of your ticket or permit". Each queues its own `condition` or `compliance` addendum.
6. **On return**: the departure sheet gets a collapsed "Record the car's condition now (optional)" above Confirm, using the grid with `return-*` roles; the photos go into the departure addendum; `ended_at` is still the Confirm tap.
7. **Display** on the record screen with time and short fingerprint; bytes-missing state per N4. Library photos are labelled "Added from the photo library. The signature shows when it was added, not when it was taken."
8. **PDF**: `addImageGrid` with x and width; arrival and return condition photos side by side; the compliance photo after the sign photo; rows via `sessionRows`; the verify step for photo hashes updated.
9. **Evidence bundle** download on the record screen: a JSON file with every canonical payload, every signature and the original photo bytes (base64), so a third party can re-hash photos. Permit details only when the driver ticks "Include permit details" (N3).
10. **Verify pages** (`scripts/_build_verify_pages.py`, 9 locales): fix the out-of-date copy-paste step (use `payload.b64` and `base64 -d` as the PDF does), add the chain step and the photo re-hash step using the evidence bundle, then regenerate the pages once.
11. Copy: "A signed photo shows the photo existed by the time it was signed. It doesn't show who caused any damage."
12. After the first signed photo, prompt once: add to Home Screen or sign in to back up (Safari can clear site data after 7 days without a visit).

## T3. Model upgrades and unclear signs

1. **Schema** (`lambda/index.js` RESPONSE_SCHEMA; every property required, nullable via `anyOf`, prefer `[]` to nullable arrays):
   - `sign_status` (first property): enum `readable | partially_obscured | missing | contradictory | not_a_parking_sign`.
   - `sign_issues`: string array, `[]` when readable.
   - `is_area_sign`: boolean, true when the sign governs an area ("area", "parking area", area start or end sign) rather than a length of road. Top level and per variant.
   - `permit_exception`: per user permit type, whether the SIGN ITSELF prints an exception or allowance for it: `{ applies: boolean, permit_type: 'accessible'|'resident'|'business'|null, text: string }` (`text` quotes the sign; `''` when none). Top level and per variant. The model never computes concessions from general state law.
   - `recurring_restrictions`: `{ kind: 'street_cleaning'|'clearway'|'no_stopping'|'other', days: ('MO'..'SU')[], start: 'HH:MM', end: 'HH:MM', week_of_month: integer[], exceptions_text, label }[]`.
2. **Prompt**: a SIGN STATUS section (missing means no posted restriction is visible in the photo, which is not the same as "can't park"; contradictory still applies the most restrictive reading AND says so); a PERMIT EXCEPTIONS section (only applies when the user message lists permits; only what the sign prints); an AREA SIGNS section; a RECURRING RESTRICTIONS section. Fix the "Melbourne local time" contradiction in the `until` contract. Unreadability explanations go in `sign_issues`, never `rules` (rules is signed evidence). Permits and the parking state go in the user message, never the system prompt.
3. **Request**: `translateSign` accepts `user_permits` (at most 3; `type` in `accessible|resident|business`; `area` <= 60 chars; strip and reject control characters; untrusted) and `parking_state`. Refresh mode echoes `prior_sign_status`, `prior_sign_issues`, `prior_is_area_sign` and receives permits. Update `lambda/index.d.ts`.
4. **`normalizeModelOutput()`** enforces enums and caps after parsing, reusing caps from `lambda/addendum-schema.js` where they overlap.
5. **Client threading**: types; the variant merge in `App.tsx`; the refresh override; persistence (`rule_flags` including `is_area_sign`, `sign_status`, `sign_issues`, `recurring_restrictions`); feedback context (client and server whitelist); `draftAppeal` and `evidenceText`.
6. **Unclear sign UI**:
   - `partially_obscured` and `contradictory`: the answer card still shows the most restrictive answer, with a banner explaining the problem: "A sign that can't be read clearly is worth keeping a record of."
   - `missing` and `not_a_parking_sign`: a screen with "We couldn't find a readable parking sign in this photo. That doesn't mean there are no rules here. General road rules still apply, such as no parking within 10 metres of an intersection without traffic lights, and some areas have time limits without a sign on every street." Actions: "Retake photo" and "Log without a sign" (the no-sign logger keeps the photo as the surroundings photo).
   - Caption for that photo: "Photo taken where you parked. ParkProof found no readable parking sign in it." PDF: "No sign read. ParkProof found no readable parking sign in the photo, and the driver logged this park without one."
   - PDF row "Sign condition" via `sessionRows`.
7. **Weekly restriction hint**: the result screen says "This sign has a weekly restriction. You can set a reminder after you save." (T5a adds the action on the remind screen.)
8. Tests: prompt-section regex guards, schema `required` assertions, normaliser tests, permit input validation.

## T4. Settings, permits, driver name, privacy, home layout

1. **Rename** the existing `settings` view to `account` (AuthSettings). The new `settings` view uses a new `prefs.*` key namespace. Extract `PushManagementSection` into its own file, show it in Settings, remove it from Account.
2. **Settings** (anonymous; links to Account when signed in): driver name ("Your name on records you share", optional, 60 chars), My permits (type, issuing state, area or zone label, optional expiry), notifications. Store under `parkproof.profile.v1` with a helper in `storage.ts` and tests. Before saving an accessible permit: "Saving this permit means its type is sent with each sign photo you scan, so the answer can include what the sign says about permits. Accessible permit details are health information. You can delete them any time."
3. Send saved permits and the parking state to `translateSign` and `refreshInterpretation`.
4. **Result screen**: deterministic area match for permit zones ("Your saved permit for Area 25 matches this zone"); when the sign prints a permit exception that applies, show the permit answer separately from the standard answer. When no exception is printed but the user holds a permit: "Your permit may allow more time under {{state}} rules. ParkProof doesn't calculate that. Check the conditions on your permit or with your council." Never auto-tick a gate.
5. **Accessible permit safeguard**: when a saved accessible permit exists, the existing accessible-permit gate reads "The permit holder is in the car with me and getting out here, and their permit is displayed." Answering no shows "Then the permit can't be used for this park. Don't park in the accessible bay." For resident and business permits, `holder_present` is null and the question is "Is this permit for this car, and displayed or registered to it?"
6. `permit_context` saved on the record, signed only as `permit_commitment` (N3), with `permit_salt` stored locally. When the sign's exception sets a later time, also remind at `standard_until`: "The standard limit on this sign ends now. Your permit time runs to {{time}}."
7. Driver name defaults into new records (`draft.driver_name`, then `driver_name`) and into `arrival_context`.
8. **Privacy policy** (`PrivacyPolicy.tsx`, `privacy.*` keys): `anonymousIntro` becomes "ParkProof works without an account. Your records are stored in this browser. To sign a record, your phone sends its details (times, location, what you entered, and photo fingerprints, not the photos) to ParkProof's server, which signs them and doesn't keep a copy." Add what is sent to the AI with each scan (the photo, location, saved permit types) and notice photos (T8).
9. **Home layout (this task owns it)**: active card or workday card, scan button, then three glass rows: History; "Street sweeping and weekly reminders" (shows the next occurrence inline when within 24 h; T5a fills it); Settings (right-hand label: the email when signed in, "Sign in to sync" otherwise). Then the link "Parking all day? Start a workday" (T6 shows it). Then "Got a fine? Start here" (T8). Remove the returning-user 3-step list. The home card gains only a Share icon (T7).

## T5a. Street sweeping and weekly reminders (on the device)

1. **Store** `parkproof.recurring.v1`: `{ id (uuid), label, kind, days, start, end, frequency: 'weekly'|'fortnightly'|'monthly_nth', nth: number[], anchor_date, timezone, address: string|null, remind_evening_before: 'HH:MM'|null, remind_minutes_before: number|null, push: boolean, paused: boolean, sequence: number }`.
2. **View** `recurring`: list with the next occurrence of each, editor (create, edit, pause, delete). The home row from T4 shows the next occurrence within 24 h. Pure, tested next-occurrence maths in the rule's IANA zone, across both DST changes.
3. **From a scan**: when the saved record has `recurring_restrictions`, the remind screen offers "Remind me every week" as a sheet that opens the editor prefilled, with "Check these days and times against the sign".
4. **Calendar file**: floating local time (not UTC), RRULE (`FREQ=WEEKLY;BYDAY=TU`, `INTERVAL=2`, `FREQ=MONTHLY;BYDAY=1TU,3TU`), relative VALARMs, a stable UID per rule, `SEQUENCE` bumped on edit, translated text.
5. Copy says what the reminder is for ("Street sweeping on Tuesday 7 to 9 am. Move the car tonight."), notes that council schedules change and public holidays may differ, and carries the reliability line.

## T5b. Weekly reminders by push

1. EventBridge `cron()` schedules with `ScheduleExpressionTimezone` set to the rule's IANA zone, named `parkproof-push-r-<uuid>-<n>` (the IAM prefix is `parkproof-push-*`; a 36-char uuid keeps the name under 64 chars). Fortnightly and monthly_nth rules fire weekly and the dispatcher decides, using the occurrence date (fire time plus the reminder offset) in the rule's zone, never the fire date or UTC.
2. Routes `POST /push/recurring` (replace-all for one rule) and `POST /push/recurring/cancel`, with N6 ownership, rate limits, `deploy.sh` `ensure_route` entries, dev middleware stubs, and the dispatcher's stale/TTL handling.
3. Tests: parity in Australia/Melbourne across both DST changes and in Australia/Brisbane, ownership, name length.

## T7. Sharing the record and handing the car over

1. **Driver on each record**: "Who's driving?" in the logger (driver line in the T2 order), prefilled from settings, optional.
2. **Share link**: "Share where the car is" on the record screen and a Share icon on the home card. Confirm first: "Anyone with this link can see where the car is parked, who parked it and until when. It works for anyone it's forwarded to, and you can't switch it off." Format `/app/#share=1.<base64url(JSON)>`, uncompressed, rejected above 16 KB, unknown version prefixes rejected ("This link was made by a newer version of ParkProof"). The JSON carries the arrival bundle (`canonical_payload`, `signature_base64`, `signed_at`, `key_alias`) plus unsigned extras: `shared_at`, driver, time zone, ended, rules summary. No photos, no chain key, no permit status (share `standard_until` when the park is permit-adjusted). Web Share API with copy-to-clipboard fallback.
3. **Receive view** `shared`: App parses `#share=` at startup (extend `src/lib/deep-link.ts`) and clears it with `replaceState`. Address, coordinates, arrival and expiry come from the verified signed payload. Unsigned extras are labelled "From the sender, not signed". Banner: "Shared by {{driver}} at {{time}}. This is a snapshot and doesn't update. The car may have moved." If verification fails: "This link has been changed since it was shared", and the map link is hidden. Never set the page title or meta tags from the snapshot.
4. **Imported records are read-only copies**: stored with `shared_from` (the sender's bundle in `shared_from.arrival_bundle`, never as `signature`), a new local id, deduplicated on `original_session_id` (opening the link again updates the copy). They never queue addenda, are excluded from `loadActiveSessions`, the retry sweep and cloud sync, have no I've left, condition, compliance, handover or share actions, are badged "Shared with you" in History, and their record screen shows the countdown, Directions, "Check the signature" and Remove. The PDF says "This record was made on someone else's phone."
5. **Handover**: "Hand the car over" on the record screen of an active record. Asks for the next driver's name, queues a signed `handover` addendum, then offers the share link. The record stays active.
6. **Permit safeguard**: only when `permit_context.type === 'accessible'`, the share and handover screens say "This park used an accessible parking permit. If the permit holder won't be in the car, take the permit off the dash before anyone drives it."
7. PDF: "Driver (entered on the phone, not checked)" row and a handover section from the signed addenda, via `sessionRows`.

## T8. Notice-first lookup ("Got a fine? Start here")

1. **Lambda**: async route `POST /read-notice` (copy the `/draft-appeal` job pattern) plus `GET /read-notice/status/{job_id}`. `NOTICE_SCHEMA`: `notice_number, issuing_authority, offence_date_raw, offence_time_raw, offence_datetime_local ('YYYY-MM-DDTHH:MM' no offset, or null), location_text, offence_code, offence_description, amount, due_date, legibility`. No registration field. No thinking, small `max_tokens`. Never log raw model text. The status route deletes the job row after returning a done or error result (for this route). Rate limit, ERR codes (client `ERROR_CODE_KEYS` plus en strings), `deploy.sh` routes (`ensure_route "read-notice"`, `ensure_get_anon_route "/read-notice/status/{job_id}"`), `index.d.ts`.
2. **Dev proxy**: a `/api/read-notice` middleware that runs the extraction synchronously, and fix the dev `/api/draft-appeal` path the same way, so the appeal flow works locally.
3. **Matching** `src/lib/notice-match.ts` (pure, tested): `zonedWallClockToUtc(parts, tz)` returns an array (two instants for the repeated DST hour, the shifted instant for the skipped hour); re-derive the local time from `offence_date_raw` day-first in code and flag disagreement with the model; window end = the first of signed departure `signed_at`, `ended_at`, `expires_at`, or `arrived_at + 24 h`, then plus 6 h; window start = `arrived_at - 10 min`; a record with no location uses the zone of the notice's geocoded location, else the issuing state, else every Australian zone; rank by time distance and by distance from a forward geocode of `location_text`. Tests: Australia/Melbourne 2027-04-04 02:30 and 2026-10-04 02:30, Australia/Brisbane.
4. **View** `notice`: capture, reading (give `LoadingProgress` a stages prop), the extracted fields (date and time editable if misread), the matches. Comparison lines (factual only):
   - Signed before the notice time: "You tapped I've left at 1:55 pm, 15 minutes before the time on the notice. ParkProof signed that record at 1:56 pm. The record shows when you tapped, not when the car moved."
   - Signed after the notice time: "You tapped I've left at 1:55 pm by your phone's clock. ParkProof only signed it at 3:12 pm, after the time on the notice, so the signature can't show you'd left by 2:10 pm."
   - Not signed: "You tapped I've left at 1:55 pm. This hasn't been signed yet."
   - Arrival: "You logged this park at 12:31 pm, 1 hour 39 minutes before the time on the notice."
   - Driver: "Your record says {{driver}} was driving. That's what was entered when the park was logged. ParkProof didn't check it. If someone else was driving, the notice explains how to nominate them. Only nominate the person who was actually driving."
   - After a handover: "Your record says the car was handed to {{to_driver}} at {{time}}."
   - Always: "Check the registration on the notice is the car in this record. ParkProof doesn't record registrations." and "Check the due date on the notice itself."
5. **Actions**: "Draft an appeal with this record" opens AppealFlow with the record and the captured notice (an `initialNotice` prop that skips capture; guard against double drafting in StrictMode). "Export evidence PDF". No match: "Draft an appeal anyway". Hide AppealFlow's "Strong evidence" style verdict label.
6. The home "Got a fine? Start here" link (from T4's layout) opens this view.

## T9. Accuracy benchmark (method first, numbers when labelled)

1. **Harness** (`scripts/eval-accuracy.mjs`): `--json <file>` output with model, prompt hash, schema hash, git sha and date; corpus format v2 (`split: 'dev'|'test'`, `tags[]`, `expected_variant`, flag expectations, `expected_sign_status`); score duration and flags; fix the null-`until` pass bug; `--runs N` with Wilson intervals; report false "you can park" separately from false "you can't"; accuracy by confidence; p50/p90 latency; cost from usage.
2. **Docs**: `eval/README.md` with the labelling rubric, the dev/test split rule (the test split is never used for prompt work), how to add photos, and second-person labelling.
3. **Page** `migrations/two-app-architecture/landing-from-claude-design/accuracy/index.html` in the landing's style: the method, metric definitions, limitations, and a results table rendered from `accuracy/results.json` when it exists. With no results it says plainly that the first numbers will appear once a held-out set is labelled. Add to `sitemap.xml` (trailing slash).
4. **Links**: add the in-app link (`result.aiCaveat`, `landing.accuracyNote`) only when a results file with test-split numbers exists. Until then the page is linked from the landing footer only.
5. **Telemetry fixes**: `is_refresh` is hardcoded `false` and `scanned_hour_local` uses the device time zone (`ParkingResult.tsx`). Fix both.

## T6a. Workday mode: state, jurisdiction and the safety maths (no UI)

The research verdict governs workday mode (`docs/research/00-synthesis.md` section 5, `docs/research/03-workday-shuffle.md`). Moving a few bays along the same signed stretch does not restart the limit (Road Rules r205(2), r332). Under an area sign the car must leave the whole area (r335). A careless version gets users fined and hands councils signed proof. The whole feature ships behind `VITE_FEATURE_WORKDAY` (on in dev, off in production builds unless set). List every workday string key in `docs/legal-review-queue.md`; the copy must be read by a lawyer before the flag is turned on in production.

1. **Workday store** `parkproof.workday.v1` (helper in `storage.ts`, tested): `{ id, started_at, jurisdiction, status: 'parked' | 'between_moves' | 'ended', current_session_id, previous_session_id, ended_at }`. At most one active.
2. **`reverseGeocodeDetails(lat, lng)`** returning `{ address, road, suburb, state_code }` from the raw `ISO3166-2-lvl4`; saved as `place` at capture. Jurisdiction is decided per leg from that value only; there is no fallback that can produce VIC or QLD.
3. **Same-stretch check** (pure, tested). Ask the boundary question when any of these hold: within 30 m of the previous leg; same `place.road` within 150 m; same normalised sign text within 300 m; either location missing, manually entered, of unknown accuracy, or worse than 100 m; the previous or new leg has `is_area_sign` (area mode: always ask).
4. **Deadline maths** (pure, tested): `stretch_deadline` = the previous leg's `stretch_deadline` or `expires_at` when the answer is `not_sure` (or the question fired and was not answered with a boundary); the new leg's `expires_at` = the earlier of its own sign answer and `stretch_deadline`. A boundary answer starts the new leg's own limit. In area mode only `left_parking_area` starts a new limit.
5. **Reminder schedule** (pure, tested): heads-up at deadline minus 45 min; go-now at deadline minus (walk time from `walk-back.ts`, or 10 min when unknown) minus 15 min; at the deadline only "Your time on this stretch ended at {{time}}." Absolute times only.

## T6b. Workday mode: screens and flow

1. **Start**: home link "Parking all day? Start a workday" (hidden while a workday is active, and when the last record's jurisdiction is known and isn't VIC or QLD). Start takes a GPS fix, runs `reverseGeocodeDetails`, and gates on jurisdiction BEFORE the explainer's Start button: elsewhere, "Workday mode is available in Victoria and Queensland while we check other states' rules."
2. **Readiness**: Start checks push support and permission, and Home Screen install on iOS. If reminders can't be delivered: "Workday reminders need notifications. Without them you'll need to watch the time yourself." Offer the `.ics` with the same alarms.
3. **Explainer** (full on the first workday, one line after that): "Moving a few bays doesn't restart the time limit. You need to leave the signed length of road, or the whole area under an area sign. Paying again or topping up doesn't restart the limit either. Each move needs a fresh photo of the new sign." Plus the reliability line.
4. If a record is active when the driver taps Start, offer "Use the car's current park as the first stop". That record becomes leg 0 (tagged locally, not re-signed) and keeps its `arrived_at` and `expires_at`. Never create a first leg with a new arrival time for a car that hasn't moved.
5. **Workday card** replaces the active card on home while a workday is active, whether or not the leg has expired. Workday legs never show "Re-check now", the ReuseCard or the recent-scans picker; "Scan another" is hidden. History shows one row per workday ("Workday, {{count}} stops") that opens the workday view.
6. **Moving**: the card's primary button is "I'm moving the car now" with the hint "Tap before you drive off". It runs the departure flow for the current leg (GPS at the old bay) and sets `between_moves`. Home then shows "Parked again? Scan the new sign", which opens the scan flow (fresh photo mandatory), then logging with the same-stretch check. Backing out of scan, result or logging while `between_moves` returns home with the state unchanged.
7. **Legs need a readable sign**: `missing` and `not_a_parking_sign` offer only "Retake photo" and "End workday". Copy: "Workday mode needs a readable sign at each spot. Some areas, like central Brisbane, have time limits even where a street has no sign." A leg whose jurisdiction isn't VIC or QLD is saved as a normal record and the workday stops: "Workday mode isn't available here yet. This park is saved as a normal record with its own sign reading."
8. **Boundary question** (in the logger, the only step that may block Save; if GPS isn't in when Save is tapped, treat it as unreliable and ask):
   - Title: "This may be the same signed stretch."
   - Body: "Moving bays doesn't restart the time limit. Did you pass one of these on the way here?"
   - Options: "A sign showing this zone had ended (a two-way arrow sign in the middle of the block doesn't count)"; "A yellow edge line"; "The end of the road at a T-intersection or dead end"; "I'm not sure" (focused by default).
   - Area mode instead: "This is a parking area. Moving to another street inside it doesn't count. You need to leave the whole area." Options: "I drove out of the parking area, past a sign saying it ends"; "I'm not sure".
   - Footer: "If you're not sure, your original time limit is still running."
   - After a boundary answer: "New limit based on what you told us: you passed {{boundary}}."
   - After "not sure": "Your limit on this stretch still runs from {{start}}. Move the car off this stretch by {{deadline}}."
   - Deadline already passed: "Your time on this stretch ended at {{time}}. Move the car off this stretch now." with "Save anyway" and "Don't save this stop" (deletes the draft and its photos, signs nothing).
9. **Reminders**: workday legs skip the remind screen; reminders from T6a are scheduled automatically, copy "Your 2P on this stretch ends at {{time}}. Move off this signed stretch, not just to another bay." and "Leave now to move the car before {{time}}."
10. **End workday** runs the departure flow for the current leg if not ended, then sets `ended`.
11. The boundary answer and `workday` link go into `arrival_context`; `previous_departure_payload_sha256` is filled at sign time (the sweep signs a leg's `arrival_context` only after the previous leg's departure is signed, or after 24 h with null).

## T6c. Workday record PDF

1. `downloadWorkdayPdf` with a leg picker. Before export: "This PDF includes every leg you choose, with distances between them and what you told us at each move. Councils can read it."
2. Header "Record of parking events." Footer on every page: "This records what you did and what you told us. It is not a legal finding that you complied. Your council decides that."
3. Cover table: leg, arrived (phone clock), left (phone clock), signed times, address, "Approx. distance from previous leg (phone GPS)", "Driver's statement".
4. Per-leg blocks via `drawSessionBlock`, chained appendices, and on every rule sheet: "Councils may interpret this rule more strictly. Check your council's parking page."

## T10. Translation review, docs, About, landing

1. Translation review: one reviewer per non-English locale checks every key added or changed in this build against the terminology table, register and grammar, and fixes problems in place.
2. Update `docs/features.md`, `README.md` and `CLAUDE.md` (status list, routes, data model, the evidence chain, gotchas, stale facts: brand, `max_tokens`, bundle size, locales not lazy-loaded, test counts).
3. In-app About: sections for the evidence chain, sharing, notice lookup and (behind the flag) workday mode, following the About style guide.
4. Landing page (`migrations/two-app-architecture/landing-from-claude-design/index.html`): update the evidence and reminders feature lists. English only.
5. `docs/legal-review-queue.md`: every string key a lawyer should read before launch (workday, permit, notice comparison, signature statements).
