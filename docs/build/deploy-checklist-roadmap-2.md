# Deploy checklist for `integration/roadmap-2`

What this deploys: `integration/roadmap-2`. That's main plus the field-test fixes, T2, T3, T4, T5a and T5b, T6a, T8, T9, the copy pass and the integration fixes, with T7 on top (merged as `2edc532`).

Evidence comes from commit `cfdecc7` in `C:\Users\molte\Downloads\pp-wt\readonly`, compared with `git diff main...HEAD`. Line numbers are at that commit. T7 has since merged as `2edc532` ("Merge feat/t7-share into integration/roadmap-2"). From `cfdecc7` to `2edc532`, the only change in `lambda/`, `scripts/`, `migrations/`, `public/` or the build config is the new `scripts/_i18n_inject_t7.mjs`. T7 calls no new API route. A share link is `/app/#share=…`, and the fragment never reaches CloudFront or the API (`src/lib/deep-link.ts`). Its handover addendum kind already exists on the server (`lambda/addendum-schema.js:66`, `:309`). Re-check all of this against the final tip in stage 1.

There's no staging backend. `scripts/deploy.sh` updates the one production Lambda, the live API and the live site. Nobody relies on the app yet, so production is the test bed, as in `docs/build/aws-test-plan.md`. The phone tests themselves live in `field-test-plan.md` next to this file. This checklist covers getting the build onto AWS safely and proving the plumbing.

Who does what:
- **[Claude]** read-only checks from this machine.
- **[Claude, go-ahead]** changes AWS, only after you say go.
- **[You]** phone and laptop.

Time: about 2.5 hours. Setup and local gates 30 min, read-only pre-flight 20 min, deploy 10 min, smoke 45 min, Scheduler probe 20 min. Then a 24-hour watch.

---

## Top risks

1. **The jobs table may not allow `DeleteItem`.** `/read-notice/status` deletes each notice row after it's read. No script grants anything on `parkproof-jobs`, so the live grant was made by hand and nobody has checked it. The delete is best effort, so a missing grant fails quietly and fine-notice details sit in the table. Worse, CLAUDE.md says the table's TTL is on `expires_at`, but the code writes `ttl`. If CLAUDE.md is right, those rows never expire.
2. **The new prompts and schemas have only met mocks.** T3's sign schema, T8's notice schema and the appeal prompt changes are tested against mocked Anthropic clients. The eval corpus is empty (`eval/corpus/` holds only `.gitkeep`). If the API rejects the schema, every scan fails in production. One real local scan before deploying settles it.
3. **The T5b Scheduler assumptions are unproven.** If `CreateSchedule` refuses `cron()` with `EndDate` and `ActionAfterCompletion: DELETE`, every weekly push booking fails and the app falls back to on-device reminders. Daylight saving can't be seen live until 4 April 2027, but schedules booked from 4 January 2027 cross it.
4. **The shipped PDF fonts aren't the tested fonts.** `deploy.sh` re-subsets the fonts after your tests ran. In a clean clone without `fonts-src/`, it re-subsets in place, which can only drop glyphs.
5. **Dropbox breaks the deploy.** `deploy.sh` runs `rm -rf node_modules` inside `lambda/`, and Dropbox's file locks make that fail (EBUSY). Deploy from a clone outside Dropbox.
6. **A route can fail silently.** If `add-permission` fails after `create-route`, a re-run skips the route because it exists. The GET route's permission errors are swallowed outright. Either way the route answers 500.
7. **Rollback isn't clean.** Weekly cron schedules outlive a code rollback, and main's Lambda errors on every firing. Main also answers the four new routes with a 202 (it treats them as a sign scan), and the new app reads a 202 from `/push/recurring` as "booked". So rollback deletes the routes and the schedules before it redeploys main (section 3). Push tombstones and the Node 22 runtime also stay.
8. **Old app shells lose push bookings.** `/push/schedule` now answers 409 `ERR_NOT_SUBSCRIBED` when a device's row is missing or expired. Rows expire 90 days after their last refresh. A cached old shell doesn't re-register on open, so its bookings fail until the shell updates.

---

## 0. Decide these now, not mid-deploy

**Stop before deploying if:**
- [ ] The KMS public key doesn't match `public/parkproof-public-key.pem` (stage 4.2).
- [ ] The IAM simulator denies something in stage 4.4 that stage 6 doesn't fix.
- [ ] A real local scan, notice read or appeal draft errors out (stage 3.4).
- [ ] The font coverage test fails after the re-subset (stage 3.3).
- [ ] T7's merge changed `lambda/`, `scripts/deploy.sh` or the landing, and this checklist hasn't been re-run against it.
- [ ] Stage 1's route check lists an API path that isn't in the expected list. The frontend would call a route `deploy.sh` doesn't create.
- [ ] 4.8 finds no distribution with the comment `parkproof-cdn`. `deploy.sh` would create a second distribution and invalidate that one, so the live site would keep serving old files.

**Roll back (section 3) if, in the first hour:**
- [ ] Fresh scans fail on two different real signs.
- [ ] `/sign-session` returns 5xx, or Check signatures fails on a new record.
- [ ] `/` or `/app/` doesn't load once the CloudFront invalidation shows Completed.
- [ ] One-shot reminders stop arriving.

**Fix forward, no rollback, if:**
- A Scheduler probe check fails (stage 9). Weekly push falls back to on-device reminders.
- The accuracy page, OG image or sitemap is wrong.
- `/read-notice` misbehaves. It's a new feature, so a hot fix costs less than rolling back everything else.
- A new route answers 500 because a permission is missing. Add it by hand (stage 7, "If a route answers 500").

---

## 1. What changes on AWS

### 1.1 API routes (item 1)

Four new routes. `deploy.sh` creates all four.

| Route | Auth and limit | Lambda dispatch (`lambda/index.js`) | `deploy.sh` | Created by deploy.sh? |
|---|---|---|---|---|
| `POST /push/recurring` | Anonymous, 30 a minute per IP (`:2720`, `:3345`) | `:3343-3355`, then `handlePushRecurring` `:2741` | `:302` `ensure_route` | Yes, with a Lambda permission (`:273-280`) |
| `POST /push/recurring/cancel` | Anonymous, 30 a minute per IP (`:3329`) | `:3327-3339`, then `handlePushRecurringCancel` `:2837` | `:303` | Yes, same |
| `POST /read-notice` | Anonymous, 10 a minute per IP (`:3044`) | `:3415-3422`, then `handleReadNotice` `:3043` | `:305` | Yes, same |
| `GET /read-notice/status/{job_id}` | Anonymous, the job id is the bearer | `:3271-3284`, then `handleJobStatus` `:3078` with kind `read-notice` | `:407` `ensure_get_anon_route` | Yes, but a failed permission is swallowed (`:400`) |

One new trigger that isn't an HTTP route. Scheduler events carrying `_async_kind: 'push-recurring'` go to `handleRecurringPushDispatch` (`:3253-3255`, `:2874`).

Order in the dispatcher matters. `/push/recurring/cancel` is matched before `/push/recurring` (`:3327`, then `:3343`). Any path nothing matches falls through to `handleSignTranslate` (`:3475`).

Changed behaviour on existing routes:
- `POST /push/subscribe` writes with a condition and answers 409 `ERR_ENDPOINT_GONE` for an endpoint that's already dead (`:2079-2089`).
- `POST /push/schedule` answers 409 `ERR_NOT_SUBSCRIBED` when the device has no live row (`:2509-2512`). It also keeps a schedule that's due within 30 seconds (`:2536`).
- `GET /sign-translate/status/{id}` and `/draft-appeal/status/{id}` now refuse notice jobs. The notice route serves notice jobs only (`:3106`).
- `POST /sign-translate` checks `user_permits` and `parking_state` and answers 400 with an ERR code (`:2994`, `:3022-3029`). Old clients don't send these fields, and a missing field passes (`lambda/sign-reading.js:112-147`).
- Sign answers are now normalised (`index.js:1369`, `lambda/sign-reading.js:547-615`). New fields are added. One change shows on an old cached shell: when the model finds no sign, or not a parking sign, the answer is `can_park_now: false` with empty `rules` and `observations` (`sign-reading.js:569-590`). An old shell shows that as a plain "no" with no rules. Everything else is additive.
- `POST /feedback` logs the T3 counts (`:1856` onwards).

No JWT routes changed. `harden.sh` CORS already allows GET, POST, OPTIONS and the `Content-Type` and `Authorization` headers (`scripts/harden.sh:64-66`). The client sends no new headers.

Two traps in `deploy.sh`:
- [ ] `ensure_route` runs `create-route` and then `add-permission` (`:266-280`). If `add-permission` fails, `set -e` stops the deploy. A re-run then finds the route and skips it, so the permission never gets added (`:291-292`).
- [ ] `ensure_get_anon_route` throws away any `add-permission` error (`:400`). The route then answers `{"message":"Internal Server Error"}` with nothing in the Lambda log.

### 1.2 IAM (item 2)

Every AWS call the Lambda makes that's new or changed, against what the scripts grant on `parkproof-lambda-role`:

| Call | Where | Needs | Granted by | Status |
|---|---|---|---|---|
| `CreateSchedule` with `cron()`, `ScheduleExpressionTimezone`, `EndDate` and `ActionAfterCompletion: DELETE`, named `parkproof-push-r-<rule uuid>-<0 or 1>` | `index.js:2775`, `:2782-2800`. Names from `recurring-schedule.js:221`, `:247-255` (55 characters, under the limit of 64) | `scheduler:CreateSchedule` on `schedule/default/parkproof-push-*`, plus `iam:PassRole` on `parkproof-push-scheduler-role` | `parkproof-lambda-schedule-rw` (`setup-push-scheduler.sh:86-115`) | Covered. Verify (4.4) |
| `GetSchedule` on rule slots (owner check) | `index.js:2291-2311` (`:2295`) | `scheduler:GetSchedule` | same | Covered. Verify |
| `DeleteSchedule` on rule slots | `index.js:2360-2385` (`:2366`) | `scheduler:DeleteSchedule` | same | Covered |
| Scheduler invoking the Lambda for weekly fires | Target `PUSH_DISPATCH_LAMBDA_ARN` with `PUSH_SCHEDULER_ROLE_ARN` | `lambda:InvokeFunction` for the scheduler role | `parkproof-push-scheduler-invoke` (`setup-push-scheduler.sh:63-81`) | Covered |
| Jobs table: conditional `PutItem` (`attribute_exists(job_id)`) | `index.js:156-173` | `dynamodb:PutItem` | Hand-made grant, no script | Already used by scans |
| Jobs table: **`DeleteItem`** after a notice is read, and on expired rows | `index.js:183-185`, `:3111-3117`, `:3133-3139` | `dynamodb:DeleteItem` on `table/parkproof-jobs` | **Nothing in any script** | **New. Probably missing** |
| Jobs table: `UpdateItem` for the per-IP limiter, now also on the two recurring routes and `/read-notice` | `index.js:215-239` | `dynamodb:UpdateItem` | Hand-made | Verify. The limiter fails open, so a missing grant only shows as `[parkproof.ratelimit] check failed, allowing` |
| Push table: conditional `PutItem` (registration and tombstone) | `push-tombstone.js:33-62`, `index.js:2079`, `:2972-2976` | `dynamodb:PutItem` | `parkproof-push-subscriptions-rw` (`setup-push.sh:78-93`) | Covered |
| Push table: `GetItem` with `ConsistentRead` | `index.js:2418-2426` (`:2420`), `:2906-2909` | `dynamodb:GetItem` (no extra permission for consistent reads) | same | Covered |
| Push table: conditional `UpdateItem` to push out the expiry | `index.js:2436-2453` | `dynamodb:UpdateItem` | same | Covered |
| Sessions table: `Query` with `ConsistentRead` | `cloud-sync.js:482-490` | `dynamodb:Query` | `parkproof-data-access` (`setup-auth.sh:237-244`) | Covered |
| Self-invoke for `read-notice` jobs | `index.js:189-200`, `:3059` | `lambda:InvokeFunction` on itself | Hand-made (scans already use it) | Covered |
| KMS | `index.js:1431`, `Sign` only | `kms:Sign` | `parkproof-kms-sign` (`setup-signing.sh:71-75`) | No new KMS use |
| S3 | `cloud-sync.js` changed only comments and `ConsistentRead` | none new | | No new S3 use |

A conditional write needs no extra permission. A failed condition comes back as `ConditionalCheckFailedException`, and the code handles every one: a 409 at `:2081`, `false` at `:171`, swallowed at `:2981`, logged at `:2451`.

**The one statement to add, only if the simulator in 4.4 says `DeleteItem` is denied.** It's a new inline policy on `parkproof-lambda-role`, named `parkproof-jobs-delete`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "NoticeJobDeleteAfterRead",
    "Effect": "Allow",
    "Action": "dynamodb:DeleteItem",
    "Resource": "arn:aws:dynamodb:ap-southeast-2:<ACCOUNT_ID>:table/parkproof-jobs"
  }]
}
```

If the simulator also denies `UpdateItem` on the jobs table, put `"dynamodb:UpdateItem"` in the same `Action` list. If it denies any scheduler action, put the whole two-statement document from `setup-push-scheduler.sh:86-108` again with `put-role-policy`. Don't re-run the setup script for this. It also rewrites `scripts/.aws-resources`.

### 1.3 DynamoDB and Scheduler state (item 3)

No new tables, keys or indexes. New item shapes:

**`parkproof-jobs`** (key `job_id`)
- Notice job rows: `{ job_id, ttl, status, kind: 'read-notice', deadline, result | error }` (`index.js:3058`, `:3204-3218`). The result holds the notice fields (`index.js:617-640`). The error holds only an ERR code (`:3160-3164`). The row is deleted the first time a finished result is read (`:3133-3139`). A worker writing late can't bring it back, because the write is conditional (`:3203`, `:166`).
- New limiter rows: `RL#pushrecurring#…`, `RL#pushrecurringcancel#…`, `RL#notice#…` with `count` and `ttl` (`:218-231`).
- **TTL attribute.** The code writes `ttl` (`:163`, `:224`, unchanged from main). CLAUDE.md says the table's TTL is on `expires_at` (CLAUDE.md, "AWS resources", jobs row). Check which is live in 4.5. The notice route ignores an expired row by its own `ttl` check (`:3111`), so this isn't a deploy blocker. It does decide whether DynamoDB ever sweeps the rows.

**`parkproof-push-subscriptions`** (key `device_id`, TTL on `expires_at` per `setup-push.sh:60-66`)
- Tombstone: `{ device_id, gone_endpoint_sha256, gone_at, expires_at }`, with no endpoint and no keys (`push-tombstone.js:33-46`). It's written instead of a delete when a send gets 410 or 404 (`index.js:2964-2982`).
- A live registration is now a conditional Put that refuses the dead endpoint's hash (`push-tombstone.js:55-62`). Existing rows have no `gone_endpoint_sha256`, so they pass.
- `expires_at` is now pushed out after each booking. That's at least 90 days, and for weekly rules the schedule's EndDate plus a day (`index.js:2436-2453`, `:2811`).
- Rows from launch that never got refreshed have expired. Those devices get 409 until the app re-registers. The new app re-sends its registration on open (`src/lib/push.ts`). An old cached shell doesn't.

**`parkproof-sessions`**: no shape change on the server. The list query is now consistent (`cloud-sync.js:482-486`).

**EventBridge Scheduler** (new state outside the code)
- Up to two cron schedules per weekly rule: `parkproof-push-r-<uuid>-0` (the evening before) and `-1` (before it starts). They live in the `default` group, use the rule's IANA zone, end after 90 days (`recurring-schedule.js:228`) and delete themselves after that (`index.js:2784-2800`).
- The Target Input holds the device_id, the rule's days and times, and the notification words for each day (`recurring-schedule.js:421-445`). That's well under Scheduler's input limit.
- The one-shot schedules `parkproof-push-<session uuid>-<n>` are unchanged.

### 1.4 Environment and build config (item 4)

**Lambda: no new variables.** `lambda/*.js` reads the same names as main (`index.js:86-89`, `:1428`, `:1890`, `:1991`, `:2116-2117`, `:2930-2932`, `cloud-sync.js:55-58`).
- [ ] These must be present: `ANTHROPIC_API_KEY`, `KMS_KEY_ID`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `DYNAMODB_TABLE_SESSIONS`, `DYNAMODB_TABLE_PUSH`, `S3_BUCKET_EVIDENCE`, `S3_BUCKET_USER_FEEDBACK`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_SCHEDULER_ROLE_ARN` and `PUSH_DISPATCH_LAMBDA_ARN`. Without the two `PUSH_` names, `/push/recurring` answers 500 (`index.js:2743-2751`).
- [ ] `ALLOW_TIME_OVERRIDE` must be absent. With it set, any anonymous caller can spoof the clock (`index.js:100-101`). The accuracy harness never needs it, because it imports `lambda/index.js` locally (`scripts/eval-accuracy.mjs:94`).
- `JOBS_TABLE` is optional and defaults to `parkproof-jobs`. If 4.3 shows it set, every `parkproof-jobs` in this checklist (4.4, 4.5, stage 6) means its value instead.
- `deploy.sh` merges values and never deletes one (`:144-179`). Your `scripts/.aws-resources` has both `S3_BUCKET_*` lines with values (key names checked, values not read), so the deploy prints the bucket names (`:50-51`) and writes them again. `KMS_KEY_ID` isn't in that file or in the merge list, so the live value is kept. That's expected.

**Frontend build**
- `deploy.sh` passes `VITE_API_URL`, the `VITE_COGNITO_*` values and `VITE_VAPID_PUBLIC_KEY` (`:457-463`).
- New: `VITE_FEATURE_WORKDAY` (`src/lib/features.ts:25-38`). It must be unset or `false` in production (`docs/legal-review-queue.md:11`). Two ways it could leak in:
  - `deploy.sh` exports everything in `.env` and `scripts/.aws-resources` into the build (`:38`, `:46`).
  - Vite also reads `.env.local`, `.env.production` and `.env.production.local`.
- Today the Dropbox `.env` holds only `ANTHROPIC_API_KEY`, and `scripts/.aws-resources` has no `VITE_` keys either (key names checked, values not read). Nothing calls `isWorkdayEnabled()` yet, even after T7, because T6b isn't merged, so the flag currently changes nothing. An unset flag is off in a production build (`src/lib/features.ts:25-33`). Set it off explicitly anyway, so T6b can't ship switched on by accident. Stage 7 runs `VITE_FEATURE_WORKDAY=false bash scripts/deploy.sh`.
- That command-line value is not the whole guard. It beats `.env.local`, `.env.production` and `.env.production.local`, which Vite reads itself. It does not beat `.env` or `scripts/.aws-resources`: `deploy.sh` sources both into its own shell with `set -a` (`:38`, `:46`) after it starts, so a `VITE_FEATURE_WORKDAY` line in either would replace `false` before the build. The greps in 3.2 are what keep those two files clean.

### 1.5 Runtime (item 5)

- `LAMBDA_RUNTIME=nodejs22.x` (`deploy.sh:18-20`).
- On an existing function, the deploy reads the runtime, moves it to Node 22 and waits. Only then does it upload the code (`:101-128`). For a few seconds the old code runs on Node 22. That's fine, because CI runs main on Node 22 too (`.github/workflows/test.yml:27` on both).
- A new function would be created on Node 22 (`:131-141`).
- No dependency changes in `lambda/package.json`. No JSON import assertions and no `__dirname` in the Lambda code. Both are common Node 22 breakers.
- The runtime is effectively forward-only. Rolling back the code leaves Node 22 in place (section 3).

### 1.6 Static assets (item 6)

All of these come from `migrations/two-app-architecture/landing-from-claude-design/`, copied into `dist/` (`deploy.sh:486-513`). The app gets `public/` under `/app/`.
- **Landing** `index.html`: new titles and descriptions, "Check a sign" (`:70`, `:109`, `:528`), a reminders caveat, signature wording, an Accuracy footer link (`:546`). Also `landing-demo.js` captions.
- **Accuracy page**, new: `accuracy/index.html` and `accuracy/accuracy.js`. A module script loads `results.json` next to the page (`accuracy.js:193-211`). There's no `results.json` yet, so the page must show "No numbers yet". A missing file, or a page served in its place, counts as no results.
- **Verify pages**: `verify/index.html` plus 8 locales rewritten (link chain, evidence file, a Windows section).
- **OG image**: `og-image.png` changed in both `public/` and the landing. The two files are identical, sha256 `f2d05875…6868`, 168,472 bytes. The meta tags still point at `/og-image.png` with no version (landing `index.html:23`, `:34`, app `index.html:35`, `:43`).
- **Sitemap**: `/accuracy/` added (`sitemap.xml:32-38`). The landing and verify entries keep `lastmod` 2026-05-24 although their copy changed. That's optional to fix, not a blocker.
- **PEM**: both copies are 178 bytes, LF only, sha256 `d025dea8…d1f8`. `.gitattributes` pins `*.pem` to LF (`.gitattributes:5`). `deploy.sh` strips CR from every PEM in `dist/` and stops if any CR is left (`:515-533`).
- `/accuracy` without a slash may not resolve. The CloudFront function only adds `index.html` to URIs that end in `/` (`scripts/_cloudfront-uri-rewrite.js:33-35`). Every link and the sitemap use `/accuracy/`.
- `aws s3 sync dist/ … --delete` (`deploy.sh:565`) removes anything in the app bucket that isn't in `dist/`. That includes the Greenfield staging prefix from `scripts/_deploy-staging.sh` if it's still there. Check 4.8.

---

## 2. Run sheet, in order

The order is what keeps the deploy safe. IAM goes before the code, because the new code calls `DeleteItem` straight away. `deploy.sh` then puts the Lambda first, the routes second and the site last. Every state in between works with the old site (table in stage 7).

### Stage 1. Freeze the commit [Claude]

- [ ] T7's merge has landed on `integration/roadmap-2`, and the tree is clean.
- [ ] Record two SHAs: `DEPLOY_SHA` (the integration tip) and `MAIN_SHA` (current `main`, for rollback).
- [ ] Re-diff the parts this checklist depends on:
  ```bash
  git diff --stat cfdecc7.."$DEPLOY_SHA" -- lambda scripts/deploy.sh 'scripts/setup-*.sh' \
    migrations/two-app-architecture public .gitattributes package.json package-lock.json index.html vite.config.ts
  ```
  Expected: no output. That's true at `2edc532`. T7's only new script, `scripts/_i18n_inject_t7.mjs`, is outside this filter. If `lambda/` or `deploy.sh` changed, re-check section 1 before going on. If anything else here changed, re-check 1.6 and stage 8.3.
- [ ] Every API path the frontend calls has a route. This catches a late fix that calls a route `deploy.sh` doesn't make:
  ```bash
  git grep -hoE "(\(|^)\s*['\`]/[a-z][a-z0-9/_-]*['\`]" "$DEPLOY_SHA" -- src ':!*.test.*' ':!**/test-support/**' \
    | sed -E "s/^[( ]*//; s/['\`]//g" | sort -u
  ```
  Expected, at both `cfdecc7` and `2edc532`: `/app/` plus these 18 and nothing else. `/draft-appeal`, `/feedback`, `/me/delete`, `/me/export`, `/photos/materialize`, `/photos/presign`, `/push/cancel`, `/push/recurring`, `/push/recurring/cancel`, `/push/schedule`, `/push/subscribe`, `/read-notice`, `/sessions/delete`, `/sessions/list`, `/sessions/upload`, `/sign-session`, `/sign-translate`, `/user-feedback`. The three job routes also poll `<path>/status/{id}` (`src/lib/api.ts:194`), and `deploy.sh:403-407` makes all three.

### Stage 2. Build a deploy clone outside Dropbox [Claude] (item 8)

Why: `deploy.sh` runs `rm -rf node_modules` and `npm install` inside `lambda/` (`:84-87`). In the Dropbox checkout, Dropbox holds file handles there and the delete fails with EBUSY. `set -e` stops the deploy before any AWS change, so it fails safe. It still leaves a half-deleted `lambda/node_modules` behind. Dropbox would also try to sync `dist/` and `function.zip`.

Don't deploy from `C:\Users\molte\Downloads\pp-wt\readonly` (read-only, detached) or `pp-wt\t9` (the merge is happening there). Don't use OneDrive either: same locks.

In Git Bash:

```bash
SRC="/c/Users/molte/Dropbox/Claude Output/Product Manager Portfolio/ParkProof"
cd /c/Users/molte
git clone --no-hardlinks -c core.autocrlf=false "$SRC" pp-deploy
cd pp-deploy
git checkout --detach "$DEPLOY_SHA"
git log -1 --oneline

# Gitignored files the deploy needs (secrets: delete them when you retire the clone)
cp "$SRC/.env" .env
cp "$SRC/scripts/.aws-resources" scripts/.aws-resources
cp -r "$SRC/fonts-src" fonts-src     # full Noto sources, see stage 3.3

npm ci
(cd lambda && npm ci)                # the Lambda tests need it (CLAUDE.md gotcha)
```

- [ ] `core.autocrlf=false` matters. It's `true` system-wide here (`C:/Program Files/Git/etc/gitconfig`), and `main` has no `.gitattributes`. Without the override, checking out `main` for a rollback would rewrite `scripts/deploy.sh` with CRLF, and bash can't run that. Check before each deploy: `head -1 scripts/deploy.sh | od -c | grep -c '\\r'` should print `0`.
- [ ] `--no-hardlinks` keeps the clone's git objects from sharing files with the Dropbox copy.
- [ ] Keep the clone until the 24-hour watch is over (it's the rollback tool). Then delete it, or at least `.env` and `scripts/.aws-resources`.

### Stage 3. Local gates, no AWS [Claude]

3.1 Type check, tests and lint:
- [ ] `npx tsc -b`
- [ ] `npx vitest run` (includes `copy-lint`, `pdf-font-coverage`, the Lambda tests and `scripts/**/*.test.mjs`, per `vitest.config.ts:34-40`). The fonts here are still the committed ones. If only `pdf-font-coverage` fails, do 3.3 and run it again before calling it a stop.
- [ ] `npm run lint`, at the same baseline as main

3.2 Feature flag and env:
- [ ] `env | grep '^VITE_'` prints nothing, or only values you expect.
- [ ] `ls -a | grep '^\.env'` shows only `.env`.
- [ ] `grep -c '^VITE_' .env` prints `0`.
- [ ] `grep -c '^VITE_' scripts/.aws-resources` prints `0`. `deploy.sh` sources this file too, so a `VITE_` line here also reaches the build.

3.3 PDF fonts, so the fonts that ship are the fonts you tested:
- `deploy.sh` re-subsets the fonts whenever fontTools is installed (`:438-444`), and it is on this machine. Without `fonts-src/` it re-subsets the committed files in place, which can only drop glyphs (`scripts/_subset_pdf_fonts.py:24-30`, `:183-189`).
- This branch rewrote every locale (about 700 lines each) but didn't touch `public/fonts`. The last change there was `b8c88eb` on main.
- [ ] `PYTHONIOENCODING=utf-8 python scripts/_subset_pdf_fonts.py` (now cut from `fonts-src/`). Keep the prefix, as `deploy.sh:440` does. The script prints `→` and `↓`, and in Git Bash Python writes to a pipe in cp1252, so without it the run can stop with `UnicodeEncodeError` part way through.
- [ ] `npx vitest run src/lib/pdf-font-coverage.test.ts src/lib/pdf-layout.test.ts`
- [ ] `git status --short public/fonts`. Changes are expected: the fonts gained glyphs. Commit them on the branch afterwards, so the repo matches what shipped. `deploy.sh` will cut the same files again from the same sources.

3.4 One real round trip to Anthropic, still no AWS:
- [ ] `npm run dev` and open the local URL Vite prints. The dev proxy runs the same Lambda code with the real key from `.env` (`vite.config.ts:82-104` for scans, `:180-213` for notices and appeals).
- [ ] Scan one stacked sign photo, then reuse it (refresh mode). The terminal shows `[parkproof] anthropic_call=… stop=end_turn` and a verdict.
- [ ] Read one notice photo through "Got a fine? Start here". The terminal shows `[parkproof] notice_call=…`.
- [ ] Draft one appeal from a saved record.
- [ ] Any 400 from Anthropic (a schema or parameter error) means stop. Push routes are stubs in dev (`vite.config.ts:325-410`), so push isn't tested here.

### Stage 4. Read-only AWS pre-flight [Claude]

Set up once per shell:

```bash
export PATH="/c/Program Files/Amazon/AWSCLIV2:$PATH"
export AWS_REGION=ap-southeast-2
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text | tr -d '\r')
FN=parkproof-sign-translator
ROLE="arn:aws:iam::$ACCOUNT_ID:role/parkproof-lambda-role"
API=https://tlsmpbft4f.execute-api.ap-southeast-2.amazonaws.com
SITE=https://www.parkproof.com.au
```

| # | Check | Pass |
|---|---|---|
| 4.1 | `aws sts get-caller-identity` | The ParkProof account |
| 4.2 | `aws kms get-public-key --key-id alias/parkproof-evidence-signing --query PublicKey --output text` against the base64 body of `public/parkproof-public-key.pem`, and the copy in `lambda/index.js` | Identical. If not, stop (as in `aws-test-plan.md` 1.2) |
| 4.3 | `aws lambda get-function-configuration --function-name $FN --query '{rt:Runtime,state:State,last:LastUpdateStatus,timeout:Timeout,mem:MemorySize,sha:CodeSha256,env:keys(Environment.Variables)}'` | Write the runtime down. Main's `deploy.sh` only sets one on create, `nodejs20.x` (main `deploy.sh:110`), but main's CI comment says the live one is `nodejs22.x`. Either is fine. Every name in 1.4 present, no `ALLOW_TIME_OVERRIDE`. If `JOBS_TABLE` is present, use its value for the jobs table in 4.4, 4.5 and stage 6. Write down `CodeSha256` |
| 4.4 | IAM simulator, below | Every line `allowed` |
| 4.5 | `aws dynamodb describe-time-to-live --table-name parkproof-jobs` and the same for `parkproof-push-subscriptions` | Jobs: ENABLED on `ttl`. Push: ENABLED on `expires_at` |
| 4.6 | `aws apigatewayv2 get-routes --api-id tlsmpbft4f --query 'Items[].RouteKey' --output text \| tr -d '\r' \| tr '\t' '\n' \| sort > routes-before.txt` (the `tr -d '\r'` stops a stray CR from the Windows `aws.exe` showing up as a false diff in 8.2) | No `push/recurring` or `read-notice` routes yet |
| 4.7 | `aws lambda get-policy --function-name $FN --query Policy --output text \| wc -c` | Under about 18,000. The hard limit is 20,480, and four new statements add about 1.6 KB |
| 4.8 | `aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='parkproof-cdn'].Id" --output text` and `aws s3 ls s3://parkproof-app-$ACCOUNT_ID/` | `E33V8DMM3LQACG` (if blank, `deploy.sh` would create a new distribution, `:571-629`). Top-level prefixes match what `dist/` will hold. Anything else, such as the staging slug, gets deleted |
| 4.9 | `aws scheduler list-schedules --name-prefix parkproof-push- --query 'length(Schedules)'` and the same with `parkproof-push-r-` | A baseline count. `parkproof-push-r-` is 0 |
| 4.10 | `aws --version` | AWS CLI v2 from late 2023 or newer, so `--action-after-completion` exists for stage 9 |
| 4.11 | Optional: `aws lambda publish-version --function-name $FN --description pre-roadmap-2` | A snapshot of today's code. `deploy.sh` never publishes versions, so `list-versions-by-function` in the CLAUDE.md playbook probably shows only `$LATEST`. This is additive. Say go first |

4.4, the IAM simulator. It's read-only and needs `iam:SimulatePrincipalPolicy`.

```bash
sim() {  # sim <principal-arn> <resource-arn> <actions...>
  local p="$1" r="$2"; shift 2
  aws iam simulate-principal-policy --policy-source-arn "$p" --resource-arns "$r" \
    --action-names "$@" --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text
}
T="arn:aws:dynamodb:ap-southeast-2:$ACCOUNT_ID:table"
sim "$ROLE" "$T/parkproof-jobs" dynamodb:GetItem dynamodb:PutItem dynamodb:UpdateItem dynamodb:DeleteItem
sim "$ROLE" "$T/parkproof-push-subscriptions" dynamodb:GetItem dynamodb:PutItem dynamodb:UpdateItem
sim "$ROLE" "$T/parkproof-sessions" dynamodb:Query
sim "$ROLE" "arn:aws:scheduler:ap-southeast-2:$ACCOUNT_ID:schedule/default/parkproof-push-r-00000000-0000-4000-8000-000000000000-0" \
  scheduler:CreateSchedule scheduler:GetSchedule scheduler:DeleteSchedule
sim "$ROLE" "arn:aws:lambda:ap-southeast-2:$ACCOUNT_ID:function:$FN" lambda:InvokeFunction
KEY_ARN=$(aws kms describe-key --key-id alias/parkproof-evidence-signing --query KeyMetadata.Arn --output text | tr -d '\r')
sim "$ROLE" "$KEY_ARN" kms:Sign
aws iam simulate-principal-policy --policy-source-arn "$ROLE" \
  --action-names iam:PassRole --resource-arns "arn:aws:iam::$ACCOUNT_ID:role/parkproof-push-scheduler-role" \
  --context-entries "ContextKeyName=iam:PassedToService,ContextKeyValues=scheduler.amazonaws.com,ContextKeyType=string" \
  --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text
sim "arn:aws:iam::$ACCOUNT_ID:role/parkproof-push-scheduler-role" "arn:aws:lambda:ap-southeast-2:$ACCOUNT_ID:function:$FN" lambda:InvokeFunction
```

- [ ] Everything `allowed`. Expect `dynamodb:DeleteItem` on `parkproof-jobs` to be the one `implicitDeny`. Stage 6 fixes it.
- [ ] If 4.5 shows the jobs TTL on `expires_at`, or disabled, note it for after the deploy. A table has one TTL attribute. Moving it means disabling TTL, waiting until AWS lets you re-enable (up to an hour), then enabling it on `ttl`. Fix CLAUDE.md's jobs row at the same time. It's not a deploy blocker.

### Stage 5. Pre-deploy smoke, a baseline on live [Claude and You] (item 10)

So that anything broken afterwards is clearly caused by the deploy.

```bash
curl -sI "$SITE/" | head -1                                   # 200
curl -sI "$SITE/app/" | head -1                               # 200
curl -s "$SITE/app/" | grep -o 'assets/index-[^"]*\.js' | head -1 > bundle-before.txt
curl -s "$SITE/parkproof-public-key.pem" | wc -c              # 178. If 182, the live copy has CRLF and the deploy fixes it
curl -s -w ' %{http_code}\n' -X POST "$API/read-notice" -d '{}'   # {"message":"Not Found"} 404: the route isn't there yet
```

- [ ] [You] One fresh scan of a real sign on the live app. Note the time.
- [ ] [You] Optional: save a record with a reminder that fires 20 to 40 minutes after the deploy starts. If it arrives, one-shot dispatch survived the switch.
- [ ] [Claude] Save the 4.3 output, `routes-before.txt`, `bundle-before.txt` and the 4.9 counts in the clone.

### Stage 6. IAM fix, before the code [Claude, go-ahead]

Only if 4.4 denied something. IAM changes are additive and safe with the old code.

```bash
cat > jobs-delete-policy.tmp.json <<EOF
{"Version":"2012-10-17","Statement":[{"Sid":"NoticeJobDeleteAfterRead","Effect":"Allow",
 "Action":"dynamodb:DeleteItem","Resource":"arn:aws:dynamodb:ap-southeast-2:$ACCOUNT_ID:table/parkproof-jobs"}]}
EOF
aws iam put-role-policy --role-name parkproof-lambda-role \
  --policy-name parkproof-jobs-delete --policy-document file://jobs-delete-policy.tmp.json
```

- [ ] Use a project-relative file. The Windows `aws.exe` can't read `/tmp` paths (CLAUDE.md gotcha). `*.tmp.json` is gitignored.
- [ ] Wait a minute, then re-run the 4.4 line for `parkproof-jobs`. Every action `allowed`.

### Stage 7. Deploy [Claude, go-ahead]

```bash
cd /c/Users/molte/pp-deploy
head -1 scripts/deploy.sh | od -c | grep -c '\\r'          # 0
VITE_FEATURE_WORKDAY=false bash scripts/deploy.sh 2>&1 | tee "deploy-$(date +%Y%m%d-%H%M).log"
echo "deploy exit: ${PIPESTATUS[0]}"
```

Watch the log for:
- [ ] `moving runtime from nodejs20.x to nodejs22.x`, or `runtime: nodejs22.x` on a re-run (`:112`, `:120`)
- [ ] `adding /push/recurring route`, `adding /push/recurring/cancel route`, `adding /read-notice route`, `adding GET /read-notice/status/{job_id}`
- [ ] `re-subsetting PDF fonts…` with no `WARNING` line
- [ ] `pem (LF): dist/parkproof-public-key.pem (178 bytes)` and the same for `dist/app/parkproof-public-key.pem`, with no `no .pem in dist/` warning
- [ ] `✓ Deploy complete` and exit 0

What users see if it stops part way. The steps run in this order, so every state in between works with the old site.

| Stops at | Live state | Users see | Do |
|---|---|---|---|
| `lambda/` npm install (`:84-87`) | Nothing changed | Old site | Fix it, re-run |
| Runtime switch (`:111-118`) | Old code, maybe on Node 22 | Old site, works | Re-run |
| Code update or env merge (`:122-179`) | New Lambda, old env (no new variables needed) | Old site, works. The new Lambda serves old clients, with the two visible differences in 1.1 (409 on an unregistered push booking, a plain "no" for a photo with no sign) | Re-run |
| Route creation (`:296-407`) | Some new routes, maybe without a permission | Old site doesn't call them | See "If a route answers 500", then re-run |
| `tsc` or `vite build` (`:463`) | New Lambda and routes, old site | Old site, works | Fix it, re-run |
| S3 sync (`:565`) | Mixed old and new files in the bucket. The edge still serves old cached files | A broken load is possible for uncached assets until the invalidation | Re-run (sync is idempotent) |
| Invalidation (`:638`) | New files, stale edge | Old site for a while | `aws cloudfront create-invalidation --distribution-id E33V8DMM3LQACG --paths '/*'` |

Don't start testing until `aws cloudfront list-invalidations --distribution-id E33V8DMM3LQACG --max-items 1` shows `Completed`.

**If a route answers 500** (`{"message":"Internal Server Error"}` with nothing in the Lambda log), add its permission by hand. Here it's `push/recurring`. Use the matching path for the others, with `read-notice/status/*` for the GET route.

```bash
aws lambda add-permission --function-name $FN \
  --statement-id "apigateway-invoke-push-recurring-manual-$(date +%s)" \
  --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:ap-southeast-2:$ACCOUNT_ID:tlsmpbft4f/*/*/push/recurring"
```

### Stage 8. Post-deploy smoke (items 1, 5, 6 and 10)

8.1 Runtime [Claude] (item 5):
- [ ] `aws lambda get-function-configuration --function-name $FN --query '{rt:Runtime,state:State,last:LastUpdateStatus,sha:CodeSha256}'` shows `nodejs22.x`, `Active`, `Successful`, and a new `CodeSha256`.
- [ ] `MSYS_NO_PATHCONV=1 aws logs tail /aws/lambda/parkproof-sign-translator --since 20m --filter-pattern '?ERROR ?ImportModuleError ?"Task timed out" ?AccessDenied ?"not authorized" ?"check failed"'` shows nothing new. The last two matter: the rate limiter logs a denied `UpdateItem` as `[parkproof.ratelimit] check failed, allowing: User: … is not authorized to perform …` (`index.js:234`), a WARN line with no `AccessDenied` in it.
- [ ] `… --filter-pattern REPORT` still shows REPORT lines, with an `Init Duration` on cold starts. If the `parkproof-warmer` schedule exists (`index.js:3228-3238` expects one), they come every 5 minutes. Compare with the same query before the deploy.

8.2 Routes, permissions and IAM, by curl [Claude] (item 1). These change nothing.

```bash
U=$(node -e "console.log(crypto.randomUUID())")
aws apigatewayv2 get-routes --api-id tlsmpbft4f --query 'Items[].RouteKey' --output text | tr -d '\r' | tr '\t' '\n' | sort > routes-after.txt
diff routes-before.txt routes-after.txt             # exactly the 4 new routes
curl -s -w ' %{http_code}\n' -X POST "$API/read-notice" -H 'Content-Type: application/json' -d '{}'
#   {"error":"ERR_BAD_REQUEST"} 400  (route, permission, new code)
curl -s -w ' %{http_code}\n' "$API/read-notice/status/$U"
#   {"error":"job not found or expired"} 404
curl -s -w ' %{http_code}\n' -X POST "$API/push/recurring" -H 'Content-Type: application/json' -d '{}'
#   400 "device_id is required…"  (also proves both PUSH_ variables are set: a missing one is a 500 first)
curl -s -w ' %{http_code}\n' -X POST "$API/push/recurring/cancel" -H 'Content-Type: application/json' \
  -d "{\"device_id\":\"$U\",\"rule_id\":\"$U\"}"
#   {"deleted":0} 200  (two real GetSchedule calls on parkproof-push-r-$U-0 and -1: proves GetSchedule only.
#   With nothing found, no DeleteSchedule runs. CreateSchedule, DeleteSchedule and PassRole are proven by the
#   weekly reminder in 8.4. A denied GetSchedule is a 500 with the error in the body.)
curl -s -i -X OPTIONS "$API/push/recurring" -H "Origin: $SITE" \
  -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' | head -12
#   204 with access-control-allow-origin: https://www.parkproof.com.au
curl -s -w ' %{http_code}\n' "$API/sign-translate/status/$U"
#   404 JSON (the shared status route still works)
```

A 404 `{"message":"Not Found"}` means the route is missing. A 500 `{"message":"Internal Server Error"}` with no log means a missing permission (stage 7).

None of the curls above touch `DeleteItem` on the jobs table, the top risk. The `/read-notice/status` 404 is a plain `GetItem` miss, and old code gives the same answer. Optional, one cheap Claude call, no phone needed: read a 1-pixel PNG as a notice, collect the result, then ask again.

```bash
curl -s -w ' %{http_code}\n' -X POST "$API/read-notice" -H 'Content-Type: application/json' \
  -d '{"image_base64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","media_type":"image/png"}'
#   {"job_id":"…","status":"pending"} 202. Set J to that job_id.
curl -s "$API/read-notice/status/$J" | cut -c1-160
#   Repeat until status is "done" or "error" (about 5 to 20 seconds). Either one deletes the row.
curl -s -w ' %{http_code}\n' "$API/read-notice/status/$J"
#   A few seconds later. 404 "job not found or expired": DeleteItem works.
#   200 with the same answer again: DeleteItem is denied. Do stage 6 now. The log also has "delete after read failed".
```

The job id is the only key to that row, and the row holds nothing about a real fine.

8.3 Static assets [Claude] (item 6):

```bash
for p in / /app/ /accuracy/ /accuracy/accuracy.js /sitemap.xml /robots.txt /og-image.png \
         /parkproof-public-key.pem /app/parkproof-public-key.pem /verify/ /verify/el/ /verify/hi/ \
         /verify/id/ /verify/it/ /verify/ko/ /verify/pa/ /verify/vi/ /verify/zh-CN/; do
  printf '%-32s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}' "$SITE$p")"
done
curl -s "$SITE/og-image.png" | sha256sum                  # f2d05875e2e6a2d405f0fa417940cbd7372ebaefdfabf4cedf69b90ade326868
curl -s "$SITE/parkproof-public-key.pem" | sha256sum      # d025dea819226b20e77aa745867ef324d1c33c445be961f74bbf857f76acd1f8
curl -s "$SITE/app/parkproof-public-key.pem" | sha256sum  # the same
curl -s "$SITE/parkproof-public-key.pem" | od -c | grep -c '\\r'   # 0
curl -s "$SITE/" | grep -c 'Check a sign'                 # 3
curl -s "$SITE/" | grep -c 'href="/accuracy/"'            # 1
curl -s "$SITE/sitemap.xml" | grep -c '/accuracy/'        # 2 (loc and comment)
curl -s "$SITE/verify/" | grep -c 'certutil'              # 1 or more
curl -s "$SITE/accuracy/" | grep -c 'No numbers yet'      # 1
curl -s "$SITE/app/" | grep -o 'assets/index-[^"]*\.js' | head -1   # differs from bundle-before.txt
grep -rl "sk-ant-" dist/ || echo "no Anthropic key in dist"
grep -rlF "$(grep '^VAPID_PRIVATE_KEY=' scripts/.aws-resources | cut -d= -f2-)" dist/ || echo "no VAPID private key in dist"
```

- [ ] Every path is 200. `accuracy.js` must be a JavaScript content type, or the module script won't run. The app's own module scripts already prove the bucket's mapping.
- [ ] [You] Open `/accuracy/` in a browser: "No numbers yet", with no console error beyond the missing `results.json`.
- [ ] Social cache for the OG image. CloudFront is covered by the invalidation. Platforms keep their own copies:
  - Facebook Sharing Debugger: "Scrape again" on `https://www.parkproof.com.au/`.
  - LinkedIn Post Inspector: the same URL.
  - iMessage, Slack, WhatsApp and X can't be forced. Share `https://www.parkproof.com.au/?v=2` for a while.
  - The lasting fix is `og-image.png?v=2` in the four meta tags (1.6), as a follow-up commit. Not tonight.
- [ ] Optional: resubmit `sitemap.xml` in Search Console.

8.4 One pass on the phone [You] (item 10). The full tests are E to K in `field-test-plan.md`. This is the minimum that proves the deploy.
- [ ] Close the installed app fully and reopen it twice (`registerType: 'autoUpdate'`, `vite.config.ts:541`). Settings is on the home screen.
- [ ] Scan one real stacked sign, then reuse it. You get a verdict both times.
- [ ] Save with a car photo and the earliest reminder. Allow notifications and lock the phone. **The test push:** it arrives on time and opens the record. CloudWatch shows `[parkproof.push.subscribe]` when the app opened and `[parkproof.push.dispatch.ok]` when it fired. Optional direct push: `node scripts/send-test-push.mjs <device_id>` (it reads VAPID from `scripts/.aws-resources`).
- [ ] Tap "I've left", then Check signatures. All valid.
- [ ] Export a PDF in 中文 or 한국어 and in हिन्दी or ਪੰਜਾਬੀ. No blank boxes.
- [ ] Use "Got a fine? Start here" on a notice photo. Fields come back. CloudWatch has `notice_call=` and no `delete after read failed`.
- [ ] Create a weekly reminder for today with a "before" reminder about 10 minutes ahead.
  - The rule says "Set to alert this phone even when ParkProof is closed", not "Alerts this phone only while ParkProof is open" (`recurring.pushStatus` in `en.json`). The push arrives.
  - CloudWatch has `[parkproof.push.recurring]` with `created` 1 or more. Take the `rule_id` from it.
  - `aws scheduler get-schedule --name parkproof-push-r-<rule_id>-1 --query '{e:ScheduleExpression,tz:ScheduleExpressionTimezone,end:EndDate,after:ActionAfterCompletion}'` shows a `cron(...)`, `Australia/Melbourne`, an end date about 90 days out, and `DELETE`.
  - Delete the rule in the app. `[parkproof.push.recurring_cancel]` shows `deleted` 1 or more, and `list-schedules --name-prefix parkproof-push-r-<rule_id>` comes back empty.
- [ ] From the new PDF, follow `/verify/` for link 0 with openssl in Git Bash. It prints `Verified OK`.

### Stage 9. T5b checks on real AWS [Claude, go-ahead] (item 7)

Three assumptions from the T5b commit (`86041be`) need a live check:
- Scheduler fills in `<aws.scheduler.scheduled-time>` in the Lambda's input.
- Cron schedules follow daylight saving in the given zone.
- A cron schedule accepts `EndDate` with `ActionAfterCompletion: DELETE`, and deletes itself afterwards.

One throwaway schedule checks the first and third, and the time-zone half of the second, after the deploy.

**Why it's safe.**
- The name `pp-awscheck-<date>` sits outside the Lambda's `parkproof-push-*` scope, so the app never touches it.
- It uses the existing scheduler role, which can only invoke this Lambda.
- Its input is a `push-recurring` event whose `rule_id` is the placeholder. The dispatcher refuses it as `bad_input` before any lookup, so there's no DynamoDB, no push and no Claude call. It logs the `rule_id`, which is where the substituted time shows (`index.js:2874-2885`, `recurring-schedule.js:455-458`).
- It needs the new Lambda code. On the old code, `push-recurring` is an unknown kind.

```bash
cd /c/Users/molte/pp-deploy
export PUSH_DISPATCH_LAMBDA_ARN=$(grep '^PUSH_DISPATCH_LAMBDA_ARN=' scripts/.aws-resources | cut -d= -f2- | tr -d '\r')
export PUSH_SCHEDULER_ROLE_ARN=$(grep '^PUSH_SCHEDULER_ROLE_ARN=' scripts/.aws-resources | cut -d= -f2- | tr -d '\r')
PROBE="pp-awscheck-$(date +%Y%m%d)"
# Fire 5 minutes from now on Melbourne's wall clock. End 12 minutes from now.
read MIN HOUR < <(node -e "const p=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Melbourne',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(Date.now()+5*60e3));const g=t=>Number(p.find(x=>x.type===t).value);console.log(g('minute'),g('hour'))")
END=$(node -e "console.log(new Date(Date.now()+12*60e3).toISOString().slice(0,19)+'Z')")
node -e "require('fs').writeFileSync('scheduler-probe.tmp.json',JSON.stringify({Arn:process.env.PUSH_DISPATCH_LAMBDA_ARN,RoleArn:process.env.PUSH_SCHEDULER_ROLE_ARN,Input:JSON.stringify({_async_kind:'push-recurring',rule_id:'<aws.scheduler.scheduled-time>',reminder:'awscheck',device_id:'awscheck'})}))"
aws scheduler create-schedule --name "$PROBE" \
  --schedule-expression "cron($MIN $HOUR ? * * *)" \
  --schedule-expression-timezone Australia/Melbourne \
  --flexible-time-window Mode=OFF \
  --end-date "$END" \
  --action-after-completion DELETE \
  --target file://scheduler-probe.tmp.json
echo "fires $HOUR:$MIN Melbourne time, ends $END"
aws scheduler get-schedule --name "$PROBE" --query '{e:ScheduleExpression,tz:ScheduleExpressionTimezone,end:EndDate,after:ActionAfterCompletion,state:State}'
```

A minute after the fire time:

```bash
MSYS_NO_PATHCONV=1 aws logs tail /aws/lambda/parkproof-sign-translator --since 15m --filter-pattern awscheck
# expect: [parkproof.push.recurring.skip] {"rule_id":"2026-11-..T..:..:00Z","reminder":"awscheck","reason":"bad_input","date":null}
```

**Assumption 1: the scheduled-time placeholder.**
- Pass: `rule_id` is an ISO time ending in `Z`, equal to the Melbourne fire time less 11 hours (AEDT in November). Also `node -e "console.log(Date.parse('<that value>'))"` prints a number.
- Fail: it's the literal `<aws.scheduler.scheduled-time>`, or it won't parse.
- If it fails: no rollback. The dispatcher falls back to "now, to the minute" (`recurring-schedule.js:464-465`), so on-time fires are still right. Only a fire that Scheduler retries late can pick the wrong day, or be dropped as stale. Fix forward later: read the time from somewhere else, or drop the field.

**Assumption 3: `EndDate` with `ActionAfterCompletion: DELETE` on cron.**
- Pass: `create-schedule` was accepted, `get-schedule` showed both settings, and after `$END` the schedule deletes itself. Allow up to an hour, then `aws scheduler get-schedule --name "$PROBE"` returns `ResourceNotFoundException`.
- Fail A: `create-schedule` refused with a `ValidationException`. Then every weekly push booking fails and the app reports on-device only. No rollback for the rest of the release. Fix forward by taking `ActionAfterCompletion` out of the cron call (`index.js:2792`), keeping `EndDate`, and adding a periodic clean-up of expired `parkproof-push-r-*` schedules.
- Fail B: accepted, but still there the next day. Scheduler stops firing it after `EndDate` anyway, so it's inert clutter. Clean up with the loop in section 3, step 2, filtered to schedules whose `EndDate` has passed (`list-schedules` doesn't return `EndDate`, so read each one with `get-schedule` first).
- Either way, finish with `aws scheduler delete-schedule --name "$PROBE"` if it's still there, then `rm scheduler-probe.tmp.json`.

**Assumption 2, the time-zone half.**
- Pass: the line arrives at the Melbourne wall-clock minute.
- Fail: nothing arrives in the window. If Scheduler ignored the zone, the cron would fall 11 hours later, after `$END`. To tell "didn't fire" from "fired, but no log", look at the schedule's metrics in the Scheduler console and the Lambda's Invocations metric.

**Assumption 2, the daylight saving half.** It can't be watched live yet. No Australian zone changes its clocks before Sunday 4 April 2027 (3 am back to 2 am in Melbourne). The next change after that is Sunday 3 October 2027. Weekly schedules end after 90 days, so none booked before 4 January 2027 crosses a change.
- [ ] Now, read-only: read the time zone and daylight saving section of the EventBridge Scheduler user guide. My understanding of it, to confirm against the current page:
  - A zoned cron follows the local wall clock across a change.
  - A time inside the skipped hour is skipped, not moved.
  - A time inside the repeated hour runs once.
  - The app's maths differs on the first point: it moves a skipped time forward and takes the earlier of a repeated time (`recurring-schedule.js:106-126`). That only affects reminders set between 2:00 and 2:59 am on change days. Accept and document it, or stop offering those times.
- [ ] Optional, read-only: if your Scheduler console's create wizard previews the next trigger dates, enter `cron(0 9 3-5 4 ? 2027)` with `Australia/Melbourne`. Check the offsets, then cancel without saving.
- [ ] Decide by early December, before schedules can cross 4 April. If the docs leave any doubt, cap each weekly `EndDate` at the next clock change in the rule's zone (a small code change). The app re-books when it's opened.
- [ ] Live, in the week of 29 March 2027: repeat the probe with `cron(0 9 ? * * *)` and an `EndDate` of 6 April 2027.
  - Pass: the fire on Sunday 4 April logs `…-04-03T23:00:00Z` (9 am AEST), where the days before logged `22:00:00Z` (9 am AEDT).
  - If it fails: in April, Scheduler would fire an hour early on the local clock. In October, an hour late. A late "before" reminder is dropped as stale (`recurring-schedule.js:480-481`), so failure mostly means silence, not wrong pushes. In-tab reminders and the `.ics` alarms (floating local time) aren't affected. Fix forward with the `EndDate` cap.

### Stage 10. Watch window, 24 hours [Claude, read-only]

Logs Insights on `/aws/lambda/parkproof-sign-translator`:

```
fields @timestamp, @message
| filter @message like /ERROR|Task timed out|ImportModuleError|AccessDenied|not authorized|delete after read failed|expired-row delete failed|ratelimit\] check failed|push\.recurring\.error|push\.cancel\.slot_error/
| sort @timestamp desc | limit 100
```

```
fields @timestamp, @message
| filter @message like /\[parkproof\.push\.(recurring|recurring_cancel|schedule\.not_subscribed|subscribe\.endpoint_gone|schedule\.refresh_failed|dispatch)/
| sort @timestamp desc | limit 100
```

- [ ] No `AccessDenied` and no `not authorized` anywhere. Some handlers log the error's message, not its name, so a denial can show only as "not authorized".
- [ ] `not_subscribed` is followed by a successful retry from the same device (the self-heal). Repeated ones from one device suggest an old cached shell.
- [ ] `aws scheduler list-schedules --name-prefix parkproof-push-r-` matches the weekly rules you know about.
- [ ] Anthropic spend: the notice reader is a new vision call, limited to 10 a minute per IP. The `parkproof-monthly` budget alarm still applies.
- [ ] Burst load: weekly evening reminders cluster on the same minute (8 pm Sunday is likely). Account concurrency is capped at 10. Lambda's async queue absorbs short bursts. Watch for throttles once there are real users.

---

## 3. Rollback (item 9)

This follows the CLAUDE.md playbook. If `integration/roadmap-2` hasn't been merged to `main`, redeploy `MAIN_SHA` from the deploy clone. If it has, `git revert -m 1 <merge sha>` on main and deploy that. Never `git reset --hard` and force-push.

Do the three steps in this order. Steps 1 and 2 take a minute. They stop phones still on the new app from booking anything main can't serve.

**Step 1. Delete the four new routes.** Main's dispatcher has no handler for them. They fall through to `handleSignTranslate`, which queues a sign job and answers 202 with a job id (main `lambda/index.js:2073-2110`). The new app doesn't see that as an error:
- `/push/recurring`: a 202 with no `skipped` list reads as booked (`src/lib/recurring-push.ts:364-367`). The phone shows weekly push as set, and nothing fires.
- `/push/recurring/cancel`: the 202 reads as cancelled.
- `/read-notice`: main reads the notice photo as a sign (a real Claude call), and the app polls back a sign answer.

With the routes gone, those calls fail, and the app falls back (on-device reminders, a notice error). Installed apps move to main's shell the next time they open, so this matters for about a day. That's the day you're rolling back.

```bash
for key in "POST /push/recurring" "POST /push/recurring/cancel" "POST /read-notice" "GET /read-notice/status/{job_id}"; do
  id=$(MSYS_NO_PATHCONV=1 aws apigatewayv2 get-routes --api-id tlsmpbft4f \
    --query "Items[?RouteKey=='$key'].RouteId | [0]" --output text | tr -d '\r')
  if [ -n "$id" ] && [ "$id" != "None" ]; then
    aws apigatewayv2 delete-route --api-id tlsmpbft4f --route-id "$id" && echo "deleted $key"
  fi
done
```

**Step 2. Delete the weekly cron schedules.** Main's handler has no `push-recurring` kind. Each firing falls into its job worker as an unknown kind, fails to write a job row with no key, throws, and Lambda retries it twice. That happens every week until the `EndDate`. With the routes gone, nothing can book them again.

```bash
for n in $(aws scheduler list-schedules --name-prefix parkproof-push-r- --query 'Schedules[].Name' --output text | tr -d '\r'); do
  aws scheduler delete-schedule --name "$n" && echo "deleted $n"
done
```

The phones keep their rules. Rolling forward again re-books them the next time each app opens (replace-all).

**Step 3. Redeploy main.**

```bash
cd /c/Users/molte/pp-deploy
git checkout --detach "$MAIN_SHA"
head -1 scripts/deploy.sh | od -c | grep -c '\\r'      # 0, thanks to core.autocrlf=false
bash scripts/deploy.sh 2>&1 | tee rollback.log
```

To roll forward again later, run stage 7 as before. `deploy.sh` re-creates the four routes and adds four more permission statements, so re-check 4.7 first.

**What a redeploy of main can't undo:**

| Change | After a rollback | Action |
|---|---|---|
| Weekly cron schedules `parkproof-push-r-*` | Keep firing for up to 90 days | Delete them (step 2) |
| Push tombstone rows (no endpoint) | Main's dispatch tries to send, fails and logs. Main's subscribe overwrites them without a condition, which brings back the old dead-endpoint bug | Leave them. Their TTL removes them |
| Push rows with a longer `expires_at` | Harmless | None |
| Lambda runtime `nodejs22.x` | Stays, because main's `deploy.sh` has no runtime step. Main is tested on Node 22 | Don't move it back. Node 20 is past end of life, and Lambda may refuse it |
| Four new API routes | Stay unless deleted. Main's Lambda sends them to `handleSignTranslate`, which answers 202, not an error. The old site never calls them, but a phone still on the new shell does | Delete them (step 1). Their Lambda permission statements stay, which is harmless |
| IAM additions | Stay | Leave them (additive) |
| Notice job rows not yet read | Expire 10 minutes after their last write, but DynamoDB's TTL sweep is lazy and can take days (the code says so at `index.js:3107-3110`). It only sweeps at all if the TTL attribute is `ttl` (4.5). Main's status routes have no `ttl` or `kind` check, so main hands one back to anyone holding its job id | None. The job id is a random UUID. If 4.5 showed the wrong TTL attribute, delete leftover `kind = read-notice` rows by hand |
| Data on the phones: `parkproof.profile.v1`, `parkproof.recurring.v1`, `parkproof.recurring.push.v1`, `parkproof.push.registration_sent.v1`, `parkproof.push.turned_off.v1`, `parkproof.workday.v1`, plus new record fields | Old code ignores them. `parkproof.sessions.v1` wasn't bumped, so records still load. Settings, permits and rules come back on roll-forward | None. See `field-test-plan.md` section 7 for T7's "Shared with you" copies |
| Signed parts (KMS) | Permanent. `lambda/addendum-schema.js` is unchanged, so main's Lambda accepts the same kinds | None |
| OG image in social caches, crawled pages | Can't be pulled back | None |
| `parkproof-public-key.pem` | Unchanged bytes, immutable per CLAUDE.md | Never change it |
| Cognito, KMS key, bucket policies, CloudFront config | Not touched by this branch | None |
