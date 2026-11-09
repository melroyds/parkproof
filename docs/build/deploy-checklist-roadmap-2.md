# Deploy checklist for `integration/roadmap-2`

What this deploys: `integration/roadmap-2`. That's main plus the field-test fixes, T2, T3, T4, T5a and T5b, T6a, T8, T9, the copy pass and the integration fixes, T7 (merged as `2edc532`), the sign schema fix (`863a230`), the overnight fix list (`6d46dfc`) and T6b and T6c (merged as `09d5c24`). Workday mode (T6a to T6c) is in the code but stays off in this deploy: see 1.4.

Evidence comes from commit `cfdecc7` in `%USERPROFILE%\Downloads\pp-wt\readonly`, compared with `git diff main...HEAD`. Its line numbers were at that commit; the note before "There's no staging backend" says which are current now. T7 has since merged as `2edc532` ("Merge feat/t7-share into integration/roadmap-2"). From `cfdecc7` to `2edc532`, the only change in `lambda/`, `scripts/`, `migrations/`, `public/` or the build config is the new `scripts/_i18n_inject_t7.mjs`. T7 calls no new API route. A share link is `/app/#share=…`, and the fragment never reaches CloudFront or the API (`src/lib/deep-link.ts`). Its handover addendum kind already exists on the server (`lambda/addendum-schema.js:66`, `:309`). Re-check all of this against the final tip in stage 1. The T10 docs pass re-checked the deploy scripts, the setup scripts and the route list at `09d5c24` (second revision note below).

**Revised 9 Nov 2026 on `fix/final-list`.** What changed in this revision:
- `scripts/deploy.sh` packages the Lambda in a temp folder outside the repo and never deletes or reinstalls `lambda/node_modules`. `bash scripts/deploy.sh --package-only` builds and lists the package with no AWS call (stage 3.5, rehearsed on 9 Nov 2026).
- `deploy.sh` builds the frontend with `VITE_FEATURE_WORKDAY=false` unless the shell that runs it sets `DEPLOY_ALLOW_WORKDAY=1`, and prints which (1.4).
- Read-only AWS checks on 9 Nov 2026 settled two open questions. `dynamodb:DeleteItem` on `parkproof-jobs` is not granted to `parkproof-lambda-role` (implicitDeny; `GetItem`, `PutItem` and `UpdateItem` are allowed). The jobs table's TTL attribute is `ttl`, as the code writes. The new `scripts/setup-jobs-table.sh` adds the missing grant, and stage 6 runs it with your go-ahead.
- The sign reader's permit tie-break now matches the app (accessible first). `node scripts/check-schema-compiles.mjs` printed COMPILES for all three schemas after the change.
- The three T5b Scheduler checks moved into the post-deploy stage (8.5), with exact steps. The old stage 10 (the watch window) is now stage 9.
- Fix round 1 (same day): `vite.config.ts` no longer lets a `.env` line overwrite a `VITE_*` value the build sets, so the `false` from `deploy.sh` really reaches the bundle (1.4, 3.2). Stage 6 grew two steps. 6.2 sets a 90-day retention on the Lambda's log group with the new `scripts/setup-log-retention.sh`, because this build's privacy text says the logs are deleted after 90 days and no script ever set a retention (CloudWatch keeps logs forever by default). 6.3 checks before the deploy, with a disabled throwaway schedule, that Scheduler accepts a weekly `cron()` with `EndDate` and `ActionAfterCompletion: DELETE`. Both 8.5 failure paths for check B now say what to do about the privacy text, which promises that weekly schedules are deleted.

**Revised 9 Nov 2026 again, for T10, at `09d5c24`.** What changed in this revision:
- T6b and T6c are merged (`378c4c6`, merge `09d5c24`). Every workday screen now checks `isWorkdayEnabled()`, so `DEPLOY_ALLOW_WORKDAY=1` would ship the whole workday UI: the home link, the start screen, the workday card, the boundary question, the stop reminders, the workday view and the workday PDF. No lawyer has read that copy (`docs/legal-review-queue.md`), so this deploy keeps it off (1.4, section 0).
- `378c4c6` re-cut `public/fonts/NotoSansKR.ttf` and `NotoSansSC.ttf` for the workday strings. The T10 translation review changes locale strings after `09d5c24`, so 3.3 re-cuts the fonts from `fonts-src/` again.
- `scripts/deploy.sh`, `scripts/_deploy-staging.sh` and the `scripts/setup-*.sh` files are unchanged since the fix list (`b63e8ee`), so every `deploy.sh` line number below still holds. The `vite.config.ts` and `src/lib/recurring-push.ts` line numbers are now at `09d5c24`.
- CLAUDE.md now says the jobs table's TTL attribute is `ttl`.

Line numbers for `scripts/deploy.sh`, `vite.config.ts` and `src/lib/recurring-push.ts` are at `09d5c24`. Line numbers in `lambda/` were refreshed for the last lows (9 Nov 2026) and match the code at `573c427`; `lambda/` hasn't changed since `b63e8ee`. The ones that were wrong at `cfdecc7` (the weekly dispatcher's skip line, the cron call's `ActionAfterCompletion`) were corrected, and main's code is named by function. If `lambda/` changes again, look each one up by the function it names: the numbers go stale, the names don't.

There's no staging backend. `scripts/deploy.sh` updates the one production Lambda, the live API and the live site. Nobody relies on the app yet, so production is the test bed, as in `docs/build/aws-test-plan.md`. The phone tests themselves live in `field-test-plan.md` next to this file. This checklist covers getting the build onto AWS safely and proving the plumbing.

Who does what:
- **[Claude]** read-only checks from this machine.
- **[Claude, go-ahead]** changes AWS, only after you say go.
- **[You]** phone and laptop.

Time: about 2.5 hours, plus any log export you choose in 6.2. Setup and local gates 35 min, read-only pre-flight 20 min, stage 6 (IAM grant, log retention, Scheduler pre-check, usage alarm) 20 min, deploy 10 min, post-deploy smoke and Scheduler checks 65 min. Then a 24-hour watch, and an hour after the deploy one last look at the Scheduler probe (8.5).

---

## Top risks

1. **The jobs table doesn't allow `DeleteItem` (confirmed).** `/read-notice/status` deletes each notice row after it's read. A read-only IAM simulation on 9 Nov 2026 showed `dynamodb:DeleteItem` on `parkproof-jobs` is an implicitDeny for `parkproof-lambda-role` (`GetItem`, `PutItem` and `UpdateItem` are allowed, from a grant made by hand). The delete is best effort, so without the grant it fails quietly and fine-notice details sit in the table until DynamoDB's TTL sweep removes them. The TTL attribute is confirmed as `ttl`, which is what the code writes, so the sweep does happen (CLAUDE.md said `expires_at` until T10 corrected it). Stage 6 runs `scripts/setup-jobs-table.sh` before the code goes up.
2. **Schemas must compile on the real API.** This was a real failure, now fixed. On 9 Nov 2026 a real call showed the API refused T3's sign schema ("compiled grammar is too large"), so every scan would have failed in production. Merge `863a230` reshaped it, and real fresh and refresh reads now succeed. Two guards stop it coming back: a size-budget test in `lambda/sign-reading.test.js`, and `node scripts/check-schema-compiles.mjs`, which must print COMPILES for all three schemas before every deploy (stage 3.4). The eval corpus is still empty (`eval/corpus/` holds only `.gitkeep`).
3. **The T5b Scheduler assumptions are unproven.** If `CreateSchedule` refuses `cron()` with `EndDate` and `ActionAfterCompletion: DELETE`, every weekly push booking fails and the app falls back to on-device reminders. Stage 6.3 now checks that before the deploy. Whether such a schedule really deletes itself after its end date is only seen after the deploy (8.5 B), and the privacy text says weekly schedules are deleted within 90 days, so a failure there has a deadline (8.5). Daylight saving can't be seen live until 4 April 2027, but schedules booked from 4 January 2027 cross it.
4. **The shipped PDF fonts aren't the tested fonts.** `deploy.sh` re-subsets the fonts after your tests ran. In a clean clone without `fonts-src/`, it re-subsets in place, which can only drop glyphs.
5. **Dropbox broke the deploy (fixed in `deploy.sh`).** It used to run `rm -rf node_modules` inside `lambda/`, which Dropbox's file locks made fail (EBUSY). It now stages the Lambda package in a temp folder outside the repo and never touches `lambda/node_modules`. Still deploy from a clone outside Dropbox (stage 2): the build rewrites `dist/` in the tree, and the clone is the rollback tool.
6. **A route can fail silently.** If `add-permission` fails after `create-route`, a re-run skips the route because it exists. The GET route's permission errors are swallowed outright. Either way the route answers 500.
7. **Rollback isn't clean.** Weekly cron schedules outlive a code rollback, and main's Lambda errors on every firing. Main also answers the four new routes with a 202 (it treats them as a sign scan), and the new app reads a 202 from `/push/recurring` as "booked". So rollback deletes the routes and the schedules before it redeploys main (section 3). Push tombstones and the Node 22 runtime also stay.
8. **Old app shells lose push bookings.** `/push/schedule` now answers 409 `ERR_NOT_SUBSCRIBED` when a device's row is missing or expired. Rows expire 90 days after their last refresh. A cached old shell doesn't re-register on open, so its bookings fail until the shell updates.
9. **The privacy text promises a log retention nobody has set.** This build's `privacy.rightsAnonymous` says the server logs (which hold device IDs, record and weekly reminder IDs and push service names) are deleted after 90 days. No script had ever set a retention on `/aws/lambda/parkproof-sign-translator`, and CloudWatch keeps logs forever by default. Stage 6.2 sets it. It deletes the older logs, launch day included, so export anything you want first.

---

## 0. Decide these now, not mid-deploy

**Stop before deploying if:**
- [ ] The KMS public key doesn't match `public/parkproof-public-key.pem` (stage 4.2).
- [ ] `bash scripts/deploy.sh --package-only` fails, or its top-level entries lack `index.js`, `package.json` or `node_modules` (stage 3.5).
- [ ] The IAM simulator denies something in stage 4.4 other than `dynamodb:DeleteItem` on the jobs table, or still denies that after stage 6.
- [ ] A real local scan, notice read or appeal draft errors out (stage 3.4).
- [ ] The font coverage test fails after the re-subset (stage 3.3).
- [ ] A commit after `09d5c24` changed `lambda/`, `scripts/deploy.sh` or the landing, and this checklist hasn't been re-checked against it (stage 1).
- [ ] The deploy banner says `Workday: ON`, or `DEPLOY_ALLOW_WORKDAY` is set in the deploy shell. With T6b and T6c merged that ships the whole workday UI, and no lawyer has read its copy.
- [ ] Stage 1's route check lists an API path that isn't in the expected list. The frontend would call a route `deploy.sh` doesn't create.
- [ ] 4.8 finds no distribution with the comment `parkproof-cdn`. `deploy.sh` would create a second distribution and invalidate that one, so the live site would keep serving old files.
- [ ] Stage 6.2 didn't run, or didn't print `keeps log events for 90 days`. The privacy text in this build says the logs are deleted after 90 days. If you don't want the retention, don't deploy this build: the text has to change first (through `scripts/_i18n_inject_fixlist_final.mjs`, all 9 languages).
- [ ] Stage 6.3's disabled schedule was refused. Weekly push can't book with this code. Decide before deploying: ship with weekly push falling back to on-device reminders, as 8.5 "B fails at once" describes, or fix it first.

**Roll back (section 3) if, in the first hour:**
- [ ] Fresh scans fail on two different real signs.
- [ ] `/sign-session` returns 5xx, or Check signatures fails on a new record.
- [ ] `/` or `/app/` doesn't load once the CloudFront invalidation shows Completed.
- [ ] One-shot reminders stop arriving.

**Fix forward, no rollback, if:**
- A Scheduler check fails (stage 8.5). Weekly push falls back to on-device reminders.
- The accuracy page, OG image or sitemap is wrong.
- `/read-notice` misbehaves. It's a new feature, so a hot fix costs less than rolling back everything else.
- A new route answers 500 because a permission is missing. Add it by hand (stage 7, "If a route answers 500").

---

## 1. What changes on AWS

### 1.1 API routes (item 1)

Four new routes. `deploy.sh` creates all four.

| Route | Auth and limit | Lambda dispatch (`lambda/index.js`) | `deploy.sh` | Created by deploy.sh? |
|---|---|---|---|---|
| `POST /push/recurring` | Anonymous, 30 a minute per IP (`:2759`, `:3384`) | `:3382-3394`, then `handlePushRecurring` `:2780` | `:484` `ensure_route` | Yes, with a Lambda permission (`:455-462`) |
| `POST /push/recurring/cancel` | Anonymous, 30 a minute per IP (`:3368`) | `:3366-3378`, then `handlePushRecurringCancel` `:2876` | `:485` | Yes, same |
| `POST /read-notice` | Anonymous, 10 a minute per IP (`:3083`) | `:3454-3461`, then `handleReadNotice` `:3082` | `:487` | Yes, same |
| `GET /read-notice/status/{job_id}` | Anonymous, the job id is the bearer | `:3310-3323`, then `handleJobStatus` `:3117` with kind `read-notice` | `:589` `ensure_get_anon_route` | Yes, but a failed permission is swallowed (`:582`) |

One new trigger that isn't an HTTP route. Scheduler events carrying `_async_kind: 'push-recurring'` go to `handleRecurringPushDispatch` (`:3292-3294`, `:2913`).

Order in the dispatcher matters. `/push/recurring/cancel` is matched before `/push/recurring` (`:3366`, then `:3382`). Any path nothing matches falls through to `handleSignTranslate` (`:3514`).

Changed behaviour on existing routes:
- `POST /push/subscribe` writes with a condition and answers 409 `ERR_ENDPOINT_GONE` for an endpoint that's already dead (`:2118-2128`).
- `POST /push/schedule` answers 409 `ERR_NOT_SUBSCRIBED` when the device has no live row (`:2548-2551`). It also keeps a schedule that's due within 30 seconds (`:2575`).
- `GET /sign-translate/status/{id}` and `/draft-appeal/status/{id}` now refuse notice jobs. The notice route serves notice jobs only (`:3145`).
- `POST /sign-translate` checks `user_permits` and `parking_state` and answers 400 with an ERR code (`:3033`, `:3061-3068`). Old clients don't send these fields, and a missing field passes (`lambda/sign-reading.js:120-155`).
- Sign answers are now normalised (`index.js:1402`, `lambda/sign-reading.js:628-696`). New fields are added. One change shows on an old cached shell: when the model finds no sign, or not a parking sign, the answer is `can_park_now: false` with empty `rules` and `observations` (`sign-reading.js:650-671`). An old shell shows that as a plain "no" with no rules. Everything else is additive.
- `POST /feedback` logs the T3 counts (`:1895` onwards).

No JWT routes changed. `harden.sh` CORS already allows GET, POST, OPTIONS and the `Content-Type` and `Authorization` headers (`scripts/harden.sh:64-66`). The client sends no new headers.

Two traps in `deploy.sh`:
- [ ] `ensure_route` runs `create-route` and then `add-permission` (`:439-462`). If `add-permission` fails, `set -e` stops the deploy. A re-run then finds the route and skips it, so the permission never gets added (`:473-474`).
- [ ] `ensure_get_anon_route` throws away any `add-permission` error (`:582`). The route then answers `{"message":"Internal Server Error"}` with nothing in the Lambda log.

### 1.2 IAM (item 2)

Every AWS call the Lambda makes that's new or changed, against what the scripts grant on `parkproof-lambda-role`:

| Call | Where | Needs | Granted by | Status |
|---|---|---|---|---|
| `CreateSchedule` with `cron()`, `ScheduleExpressionTimezone`, `EndDate` and `ActionAfterCompletion: DELETE`, named `parkproof-push-r-<rule uuid>-<0 or 1>` | `index.js:2814`, `:2821-2839`. Names from `recurring-schedule.js:221`, `:247-255` (55 characters, under the limit of 64) | `scheduler:CreateSchedule` on `schedule/default/parkproof-push-*`, plus `iam:PassRole` on `parkproof-push-scheduler-role` | `parkproof-lambda-schedule-rw` (`setup-push-scheduler.sh:86-115`) | Covered. Verify (4.4) |
| `GetSchedule` on rule slots (owner check) | `index.js:2330-2350` (`:2334`) | `scheduler:GetSchedule` | same | Covered. Verify |
| `DeleteSchedule` on rule slots | `index.js:2399-2424` (`:2405`) | `scheduler:DeleteSchedule` | same | Covered |
| Scheduler invoking the Lambda for weekly fires | Target `PUSH_DISPATCH_LAMBDA_ARN` with `PUSH_SCHEDULER_ROLE_ARN` | `lambda:InvokeFunction` for the scheduler role | `parkproof-push-scheduler-invoke` (`setup-push-scheduler.sh:63-81`) | Covered |
| Jobs table: conditional `PutItem` (`attribute_exists(job_id)`) | `index.js:157-174` | `dynamodb:PutItem` | Hand-made grant, no script | Allowed (checked 9 Nov 2026). Already used by scans |
| Jobs table: **`DeleteItem`** after a notice is read, and on expired rows | `index.js:184-186`, `:3150-3156`, `:3172-3178` | `dynamodb:DeleteItem` on `table/parkproof-jobs` | **`scripts/setup-jobs-table.sh`** (new), run in stage 6 | **Missing: implicitDeny (checked 9 Nov 2026). Stage 6 adds it** |
| Jobs table: `UpdateItem` for the per-IP limiter, now also on the two recurring routes and `/read-notice` | `index.js:216-238` (`checkRateLimit`) | `dynamodb:UpdateItem` | Hand-made | Allowed (checked 9 Nov 2026). The limiter fails open, so a missing grant would only show as `[parkproof.ratelimit] check failed, allowing` |
| Jobs table: `GetItem` for the status routes | `index.js:3117` onwards | `dynamodb:GetItem` | Hand-made | Allowed (checked 9 Nov 2026) |
| Push table: conditional `PutItem` (registration and tombstone) | `push-tombstone.js:33-62`, `index.js:2118`, `:3011-3015` | `dynamodb:PutItem` | `parkproof-push-subscriptions-rw` (`setup-push.sh:78-93`) | Covered |
| Push table: `GetItem` with `ConsistentRead` | `index.js:2457-2465` (`:2459`), `:2945-2948` | `dynamodb:GetItem` (no extra permission for consistent reads) | same | Covered |
| Push table: conditional `UpdateItem` to push out the expiry | `index.js:2475-2492` | `dynamodb:UpdateItem` | same | Covered |
| Sessions table: `Query` with `ConsistentRead` | `cloud-sync.js:482-490` | `dynamodb:Query` | `parkproof-data-access` (`setup-auth.sh:237-244`) | Covered |
| Self-invoke for `read-notice` jobs | `index.js:193-201` (`asyncSelfInvoke`), `:3098` | `lambda:InvokeFunction` on itself | Hand-made (scans already use it) | Covered |
| KMS | `index.js:1464`, `Sign` only | `kms:Sign` | `parkproof-kms-sign` (`setup-signing.sh:71-75`) | No new KMS use |
| S3 | `cloud-sync.js` changed only comments and `ConsistentRead` | none new | | No new S3 use |

A conditional write needs no extra permission. A failed condition comes back as `ConditionalCheckFailedException`, and the code handles every one: a 409 at `:2120`, `false` at `:172`, swallowed at `:3020`, logged at `:2490`.

**The one statement to add.** The simulator showed `DeleteItem` denied, so this isn't optional. `scripts/setup-jobs-table.sh` puts it on `parkproof-lambda-role` as a new inline policy named `parkproof-jobs-delete`, and changes nothing else (stage 6):

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

The script reads the account id from `aws sts get-caller-identity`, and the table name from `JOBS_TABLE` when that's set (default `parkproof-jobs`). It's safe to re-run: `put-role-policy` replaces the policy with the same document. It doesn't touch `scripts/.aws-resources`, the table, its TTL or any other policy.

Never re-run `scripts/setup-auth.sh` for an IAM fix. It rewrites `scripts/.aws-resources` from scratch, which drops the VAPID, push and feedback lines, and its `update-user-pool-client` call resets the app client's identity providers to COGNITO only, which would cut Apple and Google sign-in. If 4.4 denies any scheduler action, put the whole two-statement document from `setup-push-scheduler.sh:86-108` again with `put-role-policy`, rather than re-running that script, which also edits `scripts/.aws-resources`.

### 1.3 DynamoDB and Scheduler state (item 3)

No new tables, keys or indexes. New item shapes:

**`parkproof-jobs`** (key `job_id`)
- Notice job rows: `{ job_id, ttl, status, kind: 'read-notice', deadline, result | error }` (`index.js:3097`, `:3243-3257`). The result holds the notice fields (`index.js:620-643`). The error holds only an ERR code (`:3199-3203`). The row is deleted the first time a finished result is read (`:3172-3178`). A worker writing late can't bring it back, because the write is conditional (`:3242`, `:167`).
- New limiter rows: `RL#pushrecurring#…`, `RL#pushrecurringcancel#…`, `RL#notice#…` with `count` and `ttl` (`:219-232`).
- **TTL attribute: `ttl` (confirmed 9 Nov 2026).** The code writes `ttl` (`:164`, `:225`, unchanged from main), and a read-only `describe-time-to-live` showed the live table's TTL is on `ttl`, so DynamoDB does sweep these rows. CLAUDE.md's jobs row said `expires_at` until T10 corrected it. The notice route also ignores an expired row by its own `ttl` check (`:3150`).

**`parkproof-push-subscriptions`** (key `device_id`, TTL on `expires_at` per `setup-push.sh:60-66`)
- Tombstone: `{ device_id, gone_endpoint_sha256, gone_at, expires_at }`, with no endpoint and no keys (`push-tombstone.js:33-46`). It's written instead of a delete when a send gets 410 or 404 (`index.js:3003-3021`).
- A live registration is now a conditional Put that refuses the dead endpoint's hash (`push-tombstone.js:55-62`). Existing rows have no `gone_endpoint_sha256`, so they pass.
- `expires_at` is now pushed out after each booking. That's at least 90 days, and for weekly rules the schedule's EndDate plus a day (`index.js:2475-2492`, `:2850`).
- Rows from launch that never got refreshed have expired. Those devices get 409 until the app re-registers. The new app re-sends its registration on open (`src/lib/push.ts`). An old cached shell doesn't.

**`parkproof-sessions`**: no shape change on the server. The list query is now consistent (`cloud-sync.js:482-486`).

**EventBridge Scheduler** (new state outside the code)
- Up to two cron schedules per weekly rule: `parkproof-push-r-<uuid>-0` (the evening before) and `-1` (before it starts). They live in the `default` group, use the rule's IANA zone, end after 90 days (`recurring-schedule.js:228`) and delete themselves after that (`index.js:2823-2839`).
- The Target Input holds the device_id, the rule's days and times, and the notification words for each day (`recurring-schedule.js:421-445`). That's well under Scheduler's input limit.
- The one-shot schedules `parkproof-push-<session uuid>-<n>` are unchanged.

### 1.4 Environment and build config (item 4)

**Lambda: no new variables.** `lambda/*.js` reads the same names as main (`index.js:87-90`, `:1461`, `:1929`, `:2030`, `:2155-2156`, `:2969-2971`, `cloud-sync.js:55-58`).
- [ ] These must be present: `ANTHROPIC_API_KEY`, `KMS_KEY_ID`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `DYNAMODB_TABLE_SESSIONS`, `DYNAMODB_TABLE_PUSH`, `S3_BUCKET_EVIDENCE`, `S3_BUCKET_USER_FEEDBACK`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_SCHEDULER_ROLE_ARN` and `PUSH_DISPATCH_LAMBDA_ARN`. Without the two `PUSH_` names, `/push/recurring` answers 500 (`index.js:2781-2789`, at the top of `handlePushRecurring`).
- [ ] `ALLOW_TIME_OVERRIDE` must be absent. With it set, any anonymous caller can spoof the clock (`index.js:101-102`). The accuracy harness never needs it, because it imports `lambda/index.js` locally (`scripts/eval-accuracy.mjs:94`).
- `JOBS_TABLE` is optional and defaults to `parkproof-jobs`. If 4.3 shows it set, every `parkproof-jobs` in this checklist (4.4, 4.5, stage 6) means its value instead.
- `deploy.sh` merges values and never deletes one (`:326-361`). Your `scripts/.aws-resources` has both `S3_BUCKET_*` lines with values (key names checked, values not read), so the deploy prints the bucket names (`:243-244`) and writes them again. `KMS_KEY_ID` isn't in that file or in the merge list, so the live value is kept. That's expected.

**Lambda package**
- `deploy.sh` stages the package in a temp folder outside the repo (`build_lambda_package`, `:106-158`): it copies the `lambda/` sources without `node_modules` or the `*.test.js` files, runs `npm ci --omit=dev` there, and zips it (`zip`, else PowerShell's `Compress-Archive`, preferring PowerShell 7). `lambda/node_modules` in the working tree is never deleted or reinstalled, so the Lambda tests keep their dev dependencies after a deploy.
- The Windows `aws.exe` gets the zip's Windows path, from `cygpath -w` (`:281`). Git Bash paths such as `/tmp/...` mean nothing to it (CLAUDE.md gotcha).
- `describe_lambda_package` (`:182-207`) prints the size and the top-level entries, and stops the deploy before any upload if `index.js`, `package.json` or `node_modules` isn't at the top, or the zip is over Lambda's 50 MB direct-upload limit.
- The temp folder is deleted when the script exits, whether it succeeded or not. Re-runs make a fresh one.
- `bash scripts/deploy.sh --package-only` does only this and exits before the AWS CLI check, `.env` and any AWS call (`:209-219`). It keeps the zip for inspection and prints its path.

**Frontend build**
- `deploy.sh` passes `VITE_API_URL`, the `VITE_COGNITO_*` values and `VITE_VAPID_PUBLIC_KEY` (`:641-649`).
- New: `VITE_FEATURE_WORKDAY` (`src/lib/features.ts:25-38`). It must be off in production until a lawyer has read the workday copy (`docs/legal-review-queue.md`, "Workday mode", "Gate"). No lawyer is engaged, so that means off for this deploy and every one after it until then.
- **`deploy.sh` now sets it on every build** (`:642`): `false`, unless the shell that runs the deploy sets `DEPLOY_ALLOW_WORKDAY=1`, which makes it `true`. It prints which twice: `Workday: off (VITE_FEATURE_WORKDAY=false; DEPLOY_ALLOW_WORKDAY=1 turns it on)` in the opening banner, and `• workday mode: off (...)` just before the build.
- It decides at the top of the script (`:46-55`), before it sources `.env` and `scripts/.aws-resources` with `set -a` (`:231`, `:239`), so a `VITE_FEATURE_WORKDAY` or `DEPLOY_ALLOW_WORKDAY` line in either file can't turn workday mode on. The value is read-only, so a file that tries to change it stops the deploy instead. An explicit value in the environment also beats `.env.local`, `.env.production` and `.env.production.local`, which Vite reads itself.
- `vite.config.ts` copies the repo's `.env` onto `process.env` before Vite reads its env files (the vestauth workaround). Until 9 Nov 2026 that copy overwrote every key, so a `VITE_FEATURE_WORKDAY=true` line in `.env` beat the `false` from `deploy.sh` and shipped workday mode on while the banner said off. It now keeps any `VITE_*` key the environment already has (`applyParsed`), which is Vite's own rule for env files.
- T6b and T6c are merged (`09d5c24`), so the flag now decides real screens. With `true`, the build ships the whole workday UI: the home link "Parking all day? Start a workday", the start screen, the workday card that replaces the active card, the boundary question in the logger, automatic stop reminders, the workday view in History and the workday PDF. With `false` (this deploy), none of it renders and none of its code paths run (`src/app-workday.test.tsx`). Never run this deploy with `DEPLOY_ALLOW_WORKDAY=1`: no lawyer has read the workday copy. `scripts/deploy-scripts.test.mjs` runs the script against a fake AWS and checks the build command gets `false` even with both lines in `.env`. `scripts/vite-env-precedence.test.mjs` runs Vite's real config and env resolution with `VITE_FEATURE_WORKDAY=true` in a `.env` and `false` in the environment, and checks the build gets `false`. `scripts/_deploy-staging.sh` follows the same rule.

### 1.5 Runtime (item 5)

- `LAMBDA_RUNTIME=nodejs22.x` (`deploy.sh:61-63`).
- On an existing function, the deploy reads the runtime, moves it to Node 22 and waits. Only then does it upload the code (`:283-310`). For a few seconds the old code runs on Node 22. That's fine, because CI runs main on Node 22 too (`.github/workflows/test.yml:27` on both).
- A new function would be created on Node 22 (`:312-323`).
- No dependency changes in `lambda/package.json`. No JSON import assertions and no `__dirname` in the Lambda code. Both are common Node 22 breakers.
- The runtime is effectively forward-only. Rolling back the code leaves Node 22 in place (section 3).

### 1.6 Static assets (item 6)

All of these come from `migrations/two-app-architecture/landing-from-claude-design/`, copied into `dist/` (`deploy.sh:672-699`). The app gets `public/` under `/app/`.
- **Landing** `index.html`: new titles and descriptions, "Check a sign" (`:70`, `:109`, `:528`), a reminders caveat, signature wording, an Accuracy footer link (`:546`). Also `landing-demo.js` captions.
- **Accuracy page**, new: `accuracy/index.html` and `accuracy/accuracy.js`. A module script loads `results.json` next to the page (`accuracy.js:193-211`). There's no `results.json` yet, so the page must show "No numbers yet". A missing file, or a page served in its place, counts as no results.
- **Verify pages**: `verify/index.html` plus 8 locales rewritten (link chain, evidence file, a Windows section).
- **OG image**: `og-image.png` changed in both `public/` and the landing. The two files are identical, sha256 `f2d05875…6868`, 168,472 bytes. The share tags now ask for `og-image.png?v=2` (landing `index.html:23`, `:34`, the accuracy page's `accuracy/index.html:15`, app `index.html:35`, `:43`), so a platform that cached the old picture fetches the new one. The file itself keeps its name.
- **Sitemap**: `/accuracy/` added (`sitemap.xml:32-38`). The landing, accuracy and verify entries (all 9) have `lastmod` 2026-11-09, the day their copy last changed. `/app/` keeps 2026-05-24.
- **PEM**: both copies are 178 bytes, LF only, sha256 `d025dea8…d1f8`. `.gitattributes` pins `*.pem` to LF (`.gitattributes:5`). `deploy.sh` strips CR from every PEM in `dist/` and stops if any CR is left (`:701-719`).
- `/accuracy` without a slash may not resolve. The CloudFront function only adds `index.html` to URIs that end in `/` (`scripts/_cloudfront-uri-rewrite.js:33-35`). Every link and the sitemap use `/accuracy/`.
- `aws s3 sync dist/ … --delete` (`deploy.sh:751`) removes anything in the app bucket that isn't in `dist/`. That includes the Greenfield staging prefix from `scripts/_deploy-staging.sh` if it's still there. Check 4.8.

---

## 2. Run sheet, in order

The order is what keeps the deploy safe. IAM goes before the code, because the new code calls `DeleteItem` straight away. `deploy.sh` then puts the Lambda first, the routes second and the site last. Every state in between works with the old site (table in stage 7).

### Stage 1. Freeze the commit [Claude]

- [ ] Everything meant for this deploy has landed on `integration/roadmap-2` (at least `09d5c24`, plus the T10 translation review if it's done), and the tree is clean.
- [ ] Record two SHAs: `DEPLOY_SHA` (the integration tip) and `MAIN_SHA` (current `main`, for rollback).
- [ ] Re-diff the parts this checklist depends on, from the commit it was last checked against:
  ```bash
  git diff --stat 09d5c24.."$DEPLOY_SHA" -- lambda scripts/deploy.sh scripts/_deploy-staging.sh 'scripts/setup-*.sh' \
    migrations/two-app-architecture public .gitattributes package.json package-lock.json index.html vite.config.ts
  ```
  Expected: no output, or only `public/fonts/*.ttf` if fonts re-cut in 3.3 were committed. Locale files, docs and inject scripts are outside this filter. If `lambda/`, `deploy.sh` or a setup script changed, re-check section 1 before going on. If anything else here changed, re-check 1.6 and stage 8.3.
- [ ] Every API path the frontend calls has a route. This catches a late fix that calls a route `deploy.sh` doesn't make:
  ```bash
  git grep -hoE "(\(|^)\s*['\`]/[a-z][a-z0-9/_-]*['\`]" "$DEPLOY_SHA" -- src ':!*.test.*' ':!**/test-support/**' \
    | sed -E "s/^[( ]*//; s/['\`]//g" | sort -u
  ```
  Expected, at `cfdecc7`, `2edc532` and `09d5c24` alike: `/app/` plus these 18 and nothing else. `/draft-appeal`, `/feedback`, `/me/delete`, `/me/export`, `/photos/materialize`, `/photos/presign`, `/push/cancel`, `/push/recurring`, `/push/recurring/cancel`, `/push/schedule`, `/push/subscribe`, `/read-notice`, `/sessions/delete`, `/sessions/list`, `/sessions/upload`, `/sign-session`, `/sign-translate`, `/user-feedback`. The three job routes also poll `<path>/status/{id}` (`src/lib/api.ts:194`), and `deploy.sh:585-589` makes all three.

### Stage 2. Build a deploy clone outside Dropbox [Claude] (item 8)

Why: `deploy.sh` used to run `rm -rf node_modules` and `npm install` inside `lambda/`, and Dropbox's file handles made the delete fail with EBUSY. That's fixed: it now packages the Lambda in a temp folder outside the repo (1.4, "Lambda package"). Deploy from a clone anyway:
- The build still deletes and rewrites `dist/` in the working tree (`:635`), which Dropbox would sync and can lock.
- `core.autocrlf=false` in the clone keeps `deploy.sh` runnable after a rollback checkout of `main` (below).
- The clone is the rollback tool for the 24-hour watch.

Don't deploy from `%USERPROFILE%\Downloads\pp-wt\readonly` (read-only, detached) or `pp-wt\t9` (the integration merges and the T10 review happen there). Don't use OneDrive either: same locks.

In Git Bash:

```bash
SRC="$HOME/Dropbox/Claude Output/Product Manager Portfolio/ParkProof"
cd $HOME
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

3.2 Feature flag and env. `deploy.sh` sets `VITE_FEATURE_WORKDAY=false` itself (1.4). These checks are still stop conditions: a `VITE_` key that `deploy.sh` doesn't set itself still reaches the build from either file.
- [ ] `env | grep -E '^(VITE_|DEPLOY_ALLOW_WORKDAY)'` prints nothing, or only values you expect. `DEPLOY_ALLOW_WORKDAY=1` in this shell would build workday mode on.
- [ ] `ls -a | grep '^\.env'` shows only `.env`.
- [ ] `grep -c '^VITE_' .env` prints `0`. Anything else: stop, remove the line, and check again.
- [ ] `grep -c '^VITE_' scripts/.aws-resources` prints `0`. Anything else: stop, remove the line, and check again.

3.3 PDF fonts, so the fonts that ship are the fonts you tested:
- `deploy.sh` re-subsets the fonts whenever fontTools is installed (`:620-626`), and it is on this machine. Without `fonts-src/` it re-subsets the committed files in place, which can only drop glyphs (`scripts/_subset_pdf_fonts.py:24-30`, `:183-189`).
- This branch rewrote every locale. `378c4c6` (T6b and T6c) re-cut `NotoSansKR.ttf` and `NotoSansSC.ttf` from `fonts-src/` for the workday strings; the other fonts last changed in `b8c88eb` on main. The T10 translation review changes strings in 8 locales after `09d5c24`, so the committed subsets can miss characters it adds: cut them again here, from `fonts-src/`.
- [ ] `PYTHONIOENCODING=utf-8 python scripts/_subset_pdf_fonts.py` (now cut from `fonts-src/`). Keep the prefix, as `deploy.sh:622` does. The script prints `→` and `↓`, and in Git Bash Python writes to a pipe in cp1252, so without it the run can stop with `UnicodeEncodeError` part way through.
- [ ] `npx vitest run src/lib/pdf-font-coverage.test.ts src/lib/pdf-layout.test.ts`
- [ ] `git status --short public/fonts`. Changes are expected: the fonts gained glyphs. Commit them on the branch afterwards, so the repo matches what shipped. `deploy.sh` will cut the same files again from the same sources.

3.4 One real round trip to Anthropic, still no AWS:
- [ ] `node scripts/check-schema-compiles.mjs` prints COMPILES for RESPONSE_SCHEMA, NOTICE_SCHEMA and APPEAL_RESPONSE_SCHEMA and exits 0. It sends each route's real thinking and effort settings, which matter: a schema that compiles without thinking can still be refused with it. Any FAILS means stop.
- [ ] `npm run dev` and open the local URL Vite prints. The dev proxy runs the same Lambda code with the real key from `.env` (`vite.config.ts:88-121` for scans, `:186-219` for notices and appeals). Workday mode is on in dev (the flag is unset there); that doesn't affect the deploy.
- [ ] Scan one stacked sign photo, then reuse it (refresh mode). The terminal shows `[parkproof] anthropic_call=… stop=end_turn` and a verdict.
- [ ] Read one notice photo through "Got a fine? Start here". The terminal shows `[parkproof] notice_call=…`.
- [ ] Draft one appeal from a saved record.
- [ ] Any 400 from Anthropic (a schema or parameter error) means stop. Push routes are stubs in dev (`vite.config.ts:298-416`), so push isn't tested here.

3.5 Rehearse the Lambda package, still no AWS:
- [ ] `bash scripts/deploy.sh --package-only`. It needs no `.env` and makes no AWS call: it exits before the AWS CLI check. It takes about 40 seconds, most of it `npm ci`.
- [ ] The output starts `▶ Lambda package only. No AWS call is made.` and ends `✓ Package built. Nothing was deployed.`
- [ ] `• packaging in %USERPROFILE%\AppData\Local\Temp\parkproof-lambda.…`, a folder outside the clone.
- [ ] `• package: … bytes (… MB), … entries`. The rehearsal on 9 Nov 2026 from `fix/final-list` gave 7,768,042 bytes (7.4 MB) and 7,159 entries. Anything near 50 MB stops the real deploy.
- [ ] `• top-level entries:` lists exactly these 14: `addendum-schema.d.ts`, `addendum-schema.js`, `cloud-sync.d.ts`, `cloud-sync.js`, `index.d.ts`, `index.js`, `node_modules`, `package-lock.json`, `package.json`, `push-tombstone.js`, `recurring-schedule.d.ts`, `recurring-schedule.js`, `sign-reading.d.ts`, `sign-reading.js`. No `*.test.js`. A new file in `lambda/` since then is fine if you expect it.
- [ ] No `! entry names use backslashes` line. That line means the zip came from Windows PowerShell 5.1 rather than PowerShell 7 (`pwsh`, installed on this machine). Lambda has accepted such packages so far, so it's a warning, not a stop.
- [ ] `• a full deploy would build the frontend with workday mode off (VITE_FEATURE_WORKDAY=false; …)`.
- [ ] `git status --short lambda` prints nothing: the working tree wasn't touched.
- [ ] Delete the kept zip's folder (the `kept for inspection:` path, without `function.zip`).

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
| 4.4 | IAM simulator, below | Every line `allowed`, except `dynamodb:DeleteItem` on the jobs table until stage 6 |
| 4.5 | `aws dynamodb describe-time-to-live --table-name parkproof-jobs` and the same for `parkproof-push-subscriptions` | Jobs: ENABLED on `ttl` (it was on 9 Nov 2026). Push: ENABLED on `expires_at` |
| 4.6 | `aws apigatewayv2 get-routes --api-id tlsmpbft4f --query 'Items[].RouteKey' --output text \| tr -d '\r' \| tr '\t' '\n' \| sort > routes-before.txt` (the `tr -d '\r'` stops a stray CR from the Windows `aws.exe` showing up as a false diff in 8.2) | No `push/recurring` or `read-notice` routes yet |
| 4.7 | `aws lambda get-policy --function-name $FN --query Policy --output text \| wc -c` | Under about 18,000. The hard limit is 20,480, and four new statements add about 1.6 KB |
| 4.8 | `aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='parkproof-cdn'].Id" --output text` and `aws s3 ls s3://parkproof-app-$ACCOUNT_ID/` | `E33V8DMM3LQACG` (if blank, `deploy.sh` would create a new distribution, `:757-815`). Top-level prefixes match what `dist/` will hold. Anything else, such as the staging slug, gets deleted |
| 4.9 | `aws scheduler list-schedules --name-prefix parkproof-push- --query 'length(Schedules)'` and the same with `parkproof-push-r-` | A baseline count. `parkproof-push-r-` is 0 |
| 4.10 | `aws --version` | AWS CLI v2 from late 2023 or newer, so `--action-after-completion` exists for stage 8.5 |
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

- [ ] Everything `allowed`, except `dynamodb:DeleteItem` on `parkproof-jobs`, which is `implicitDeny`. That was the result on 9 Nov 2026, and stage 6 fixes it. Any other denial is a stop (section 0).
- [ ] 4.5 showed the jobs TTL ENABLED on `ttl` on 9 Nov 2026. If it now shows `expires_at` or disabled, someone changed the table since: note it for after the deploy. A table has one TTL attribute. Moving it means disabling TTL, waiting until AWS lets you re-enable (up to an hour), then enabling it on `ttl`. It's not a deploy blocker.

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

### Stage 6. Grants and checks before the code [Claude, go-ahead]

6.1 The jobs-table grant. Not optional: 4.4 showed `dynamodb:DeleteItem` on the jobs table is denied (confirmed on 9 Nov 2026), and the new code deletes notice rows from its first request. Run the setup script's grant, only after you say go. It adds one inline policy, `parkproof-jobs-delete`, to `parkproof-lambda-role` (the statement in 1.2) and changes nothing else. IAM additions are safe with the old code still running.

```bash
cd $HOME/pp-deploy
bash scripts/setup-jobs-table.sh
# If 4.3 showed JOBS_TABLE set on the Lambda, run it as: JOBS_TABLE=<that value> bash scripts/setup-jobs-table.sh
```

- [ ] It prints `role: parkproof-lambda-role`, `table: arn:aws:dynamodb:ap-southeast-2:<account>:table/parkproof-jobs`, then `✓ parkproof-lambda-role can delete rows in parkproof-jobs`, and exits 0.
- [ ] Wait a minute, then re-run the 4.4 line for `parkproof-jobs`. All four actions `allowed`. The script prints the same check for `DeleteItem` alone.
- [ ] `aws iam list-role-policies --role-name parkproof-lambda-role` now includes `parkproof-jobs-delete`.
- It's safe to run again: the same policy is replaced with the same document. It passes the policy inline, so no temp file is involved. It doesn't touch `scripts/.aws-resources`.
- Don't use `setup-auth.sh` for this (1.2 says why).

6.2 The log retention. Not optional for this build: its privacy text (`privacy.rightsAnonymous` and `privacy.anonymousCloudwatch`) says the server logs are deleted after 90 days. The logs hold each push device's random ID, the random ID of the record or weekly reminder, the push service's host name and, for feedback, the message and any email the driver added. Each "Did we read this right?" answer is logged too, with details of the reading (the start of the sign's rules text, the sign's permit area, the hour at the sign) and the driver's answers to the paid parking, permit zone and accessible parking permit questions. No script ever set a retention on the log group, so today CloudWatch keeps them forever.

Setting it deletes, within a few days, every log event older than 90 days, including the May launch logs and the AI feedback events that only live there. That can't be undone. First decide what to keep. To export, run each Logs Insights query you care about (the CLAUDE.md list) over the full range and download the results, or ask Claude to set up `aws logs create-export-task` to an S3 bucket (one more go-ahead).

```bash
cd $HOME/pp-deploy
bash scripts/setup-log-retention.sh
```

- [ ] It prints `log group: /aws/lambda/parkproof-sign-translator`, then `✓ /aws/lambda/parkproof-sign-translator keeps log events for 90 days`, and exits 0. It reads the retention back itself and fails if it isn't 90.
- It changes nothing else, and it's safe to run again. Don't change the 90 in the script on its own: the privacy text names that number in 9 languages (`src/lib/fixlist-cleanups.test.ts` and `scripts/deploy-scripts.test.mjs` check they agree).
- If you'd rather keep the logs longer, stop here and change the privacy text first (section 0).

6.3 Will Scheduler accept a weekly schedule's settings? This is the part of 8.5 B that doesn't need the new code. One throwaway schedule, created DISABLED (it never fires), read back and deleted at once. Its name sits outside the Lambda's `parkproof-push-*` scope, and it uses the existing scheduler role.

```bash
cd $HOME/pp-deploy
export PUSH_DISPATCH_LAMBDA_ARN=$(grep '^PUSH_DISPATCH_LAMBDA_ARN=' scripts/.aws-resources | cut -d= -f2- | tr -d '\r')
export PUSH_SCHEDULER_ROLE_ARN=$(grep '^PUSH_SCHEDULER_ROLE_ARN=' scripts/.aws-resources | cut -d= -f2- | tr -d '\r')
PRE="pp-awscheck-pre-$(date +%Y%m%d-%H%M)"
END=$(node -e "console.log(new Date(Date.now() + 864e5).toISOString().slice(0, 19) + 'Z')")
node -e "require('fs').writeFileSync('scheduler-precheck.tmp.json', JSON.stringify({ Arn: process.env.PUSH_DISPATCH_LAMBDA_ARN, RoleArn: process.env.PUSH_SCHEDULER_ROLE_ARN, Input: JSON.stringify({ _async_kind: 'push-recurring', rule_id: 'precheck', reminder: 'awscheck', device_id: 'awscheck' }) }))"
aws scheduler create-schedule --name "$PRE" \
  --schedule-expression "cron(0 9 ? * MON *)" \
  --schedule-expression-timezone Australia/Melbourne \
  --flexible-time-window Mode=OFF \
  --end-date "$END" \
  --action-after-completion DELETE \
  --state DISABLED \
  --target file://scheduler-precheck.tmp.json
echo "create exit: $?"
aws scheduler get-schedule --name "$PRE" \
  --query '{e:ScheduleExpression,tz:ScheduleExpressionTimezone,end:EndDate,after:ActionAfterCompletion,state:State}'
aws scheduler delete-schedule --name "$PRE"
echo "delete exit: $?"
rm -f scheduler-precheck.tmp.json
```

- [ ] `create exit: 0`, and `get-schedule` shows `cron(0 9 ? * MON *)`, `Australia/Melbourne`, the end date `$END`, `DELETE` and `DISABLED`. Then `delete exit: 0`.
- [ ] Refused with a `ValidationException`: every weekly push booking would fail the same way. Stop and decide (section 0). If the refusal names `ActionAfterCompletion`, the fix is the one in 8.5 "B fails at once", and it needs the privacy text change described there.
- If `delete-schedule` fails, run it again. A disabled schedule never fires, but don't leave it behind.
- This doesn't show that a schedule deletes itself after its end date. Only 8.5 step 3 shows that.

6.4 The usage alarm counts notice reads. `scripts/anthropic-usage-alarm.sh` now counts `notice_call=` lines as well as `anthropic_call=` and `appeal_call=`, but the live metric filter only changes when the script runs, so until then a run of `/read-notice` calls never moves `parkproof-anthropic-usage`. Re-running it changes AWS, so only after you say go. It replaces the `parkproof-anthropic-calls` filter and re-puts the alarm with the threshold and email you pass, so pass the live ones:

```bash
cd $HOME/pp-deploy
MSYS_NO_PATHCONV=1 aws logs describe-metric-filters --log-group-name /aws/lambda/parkproof-sign-translator \
  --filter-name-prefix parkproof-anthropic-calls --query 'metricFilters[0].filterPattern' --output text
aws cloudwatch describe-alarms --alarm-names parkproof-anthropic-usage \
  --query 'MetricAlarms[0].[Threshold,AlarmActions[0]]' --output text
aws sns list-subscriptions-by-topic --topic-arn <the AlarmActions ARN above> --query 'Subscriptions[].Endpoint' --output text
bash scripts/anthropic-usage-alarm.sh <that email> <that threshold>
MSYS_NO_PATHCONV=1 aws logs describe-metric-filters --log-group-name /aws/lambda/parkproof-sign-translator \
  --filter-name-prefix parkproof-anthropic-calls --query 'metricFilters[0].filterPattern' --output text
```

- [ ] The first read shows `?"anthropic_call=" ?"appeal_call="`. The last shows `?"anthropic_call=" ?"appeal_call=" ?"notice_call="`.
- [ ] The script ends with `✓ Done.` and doesn't ask for a new confirmation email (the subscription already exists).
- Not a stop condition for the deploy: without it, notice reads are only missing from the alarm's count. Do it in this stage or the watch window.

### Stage 7. Deploy [Claude, go-ahead]

```bash
cd $HOME/pp-deploy
head -1 scripts/deploy.sh | od -c | grep -c '\\r'          # 0
env | grep -c '^DEPLOY_ALLOW_WORKDAY='                       # 0: workday mode stays off
bash scripts/deploy.sh 2>&1 | tee "deploy-$(date +%Y%m%d-%H%M).log"
echo "deploy exit: ${PIPESTATUS[0]}"
```

`deploy.sh` sets `VITE_FEATURE_WORKDAY=false` itself now (1.4), so the command needs no prefix.

Watch the log for:
- [ ] `Workday: off (VITE_FEATURE_WORKDAY=false; DEPLOY_ALLOW_WORKDAY=1 turns it on)` in the opening banner. `ON` means stop: Ctrl+C before the build step, and check the shell for `DEPLOY_ALLOW_WORKDAY`.
- [ ] `• packaging in %USERPROFILE%\AppData\Local\Temp\parkproof-lambda.…`, then `• top-level entries:` with the 14 entries from 3.5, and no `✗` line
- [ ] `moving runtime from nodejs20.x to nodejs22.x`, or `runtime: nodejs22.x` on a re-run (`:294`, `:302`)
- [ ] `adding /push/recurring route`, `adding /push/recurring/cancel route`, `adding /read-notice route`, `adding GET /read-notice/status/{job_id}`
- [ ] `re-subsetting PDF fonts…` with no `WARNING` line
- [ ] `• workday mode: off (VITE_FEATURE_WORKDAY=false; …)` just before the build
- [ ] `pem (LF): dist/parkproof-public-key.pem (178 bytes)` and the same for `dist/app/parkproof-public-key.pem`, with no `no .pem in dist/` warning
- [ ] `✓ Deploy complete` and exit 0

What users see if it stops part way. The steps run in this order, so every state in between works with the old site.

| Stops at | Live state | Users see | Do |
|---|---|---|---|
| Lambda packaging in the temp folder: `npm ci`, the zip, or the package check (`:276-281`) | Nothing changed. The working tree isn't touched either | Old site | Fix it (3.5 reproduces it without AWS), re-run |
| Runtime switch (`:293-300`) | Old code, maybe on Node 22 | Old site, works | Re-run |
| Code update or env merge (`:304-361`) | New Lambda, old env (no new variables needed) | Old site, works. The new Lambda serves old clients, with the two visible differences in 1.1 (409 on an unregistered push booking, a plain "no" for a photo with no sign) | Re-run |
| Route creation (`:478-589`) | Some new routes, maybe without a permission | Old site doesn't call them | See "If a route answers 500", then re-run |
| `tsc` or `vite build` (`:649`) | New Lambda and routes, old site | Old site, works | Fix it, re-run |
| S3 sync (`:751`) | Mixed old and new files in the bucket. The edge still serves old cached files | A broken load is possible for uncached assets until the invalidation | Re-run (sync is idempotent) |
| Invalidation (`:824`) | New files, stale edge | Old site for a while | `aws cloudfront create-invalidation --distribution-id E33V8DMM3LQACG --paths '/*'` |

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
- [ ] `MSYS_NO_PATHCONV=1 aws logs tail /aws/lambda/parkproof-sign-translator --since 20m --filter-pattern '?ERROR ?ImportModuleError ?"Task timed out" ?AccessDenied ?"not authorized" ?"check failed"'` shows nothing new. The last two matter: the rate limiter logs a denied `UpdateItem` as `[parkproof.ratelimit] check failed, allowing: User: … is not authorized to perform …` (`index.js:235`), a WARN line with no `AccessDenied` in it.
- [ ] `… --filter-pattern REPORT` still shows REPORT lines, with an `Init Duration` on cold starts. If the `parkproof-warmer` schedule exists (`index.js:3267-3277` expects one), they come every 5 minutes. Compare with the same query before the deploy.

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

None of the curls above touch `DeleteItem` on the jobs table, the top risk. The `/read-notice/status` 404 is a plain `GetItem` miss, and old code gives the same answer. So prove stage 6's grant with one cheap Claude call, no phone needed: read a 1-pixel PNG as a notice, collect the result, then ask again.

```bash
curl -s -w ' %{http_code}\n' -X POST "$API/read-notice" -H 'Content-Type: application/json' \
  -d '{"image_base64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","media_type":"image/png"}'
#   {"job_id":"…","status":"pending"} 202. Set J to that job_id.
curl -s "$API/read-notice/status/$J" | cut -c1-160
#   Repeat until status is "done" or "error" (about 5 to 20 seconds). Either one deletes the row.
curl -s -w ' %{http_code}\n' "$API/read-notice/status/$J"
#   A few seconds later. 404 "job not found or expired": DeleteItem works.
#   200 with the same answer again: DeleteItem is still denied. The log also has "delete after read failed".
#   Re-run the stage 6 simulator line. If it says allowed, IAM hadn't applied yet: wait a minute and try again.
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
  - The share tags already ask for `og-image.png?v=2` (1.6), so a page these platforms read again picks up the new picture.
- [ ] `curl -s "$SITE/" | grep -c 'og-image.png?v=2'` prints 2, and `curl -s "$SITE/app/" | grep -c 'og-image.png?v=2'` prints 2.
- [ ] Optional: resubmit `sitemap.xml` in Search Console.

8.4 One pass on the phone [You] (item 10). The full tests are E to K in `field-test-plan.md`. This is the minimum that proves the deploy.
- [ ] Close the installed app fully and reopen it twice (`registerType: 'autoUpdate'`, `vite.config.ts:547`). Settings is on the home screen, and "Parking all day? Start a workday" is not (workday mode is off).
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

8.5 The three T5b Scheduler checks on real AWS [Claude, go-ahead] (item 7)

Three assumptions from the T5b commit (`86041be`) need real AWS. They can only be checked after the deploy: the probe needs the new dispatcher, and on the old code `push-recurring` is an unknown kind.
- **A.** Scheduler fills in `<aws.scheduler.scheduled-time>` in the Lambda's input.
- **B.** A cron schedule accepts `EndDate` with `ActionAfterCompletion: DELETE`, and deletes itself after the end date.
- **C.** Cron schedules follow the given time zone, including across daylight saving.

One throwaway schedule checks A, B and the time-zone half of C today. The daylight saving half of C can't happen before April 2027, so it has dated steps at the end. Start step 1 right after 8.2: the probe fires 5 minutes after it's created and needs no phone, so it runs while you do 8.3 and 8.4.

**Why it's safe.**
- The name `pp-awscheck-<date>-<time>` sits outside the Lambda's `parkproof-push-*` scope, so the app never touches it.
- It uses the existing scheduler role, which can only invoke this Lambda.
- Its input is a `push-recurring` event whose `rule_id` is the placeholder. The dispatcher refuses it as `bad_input` before any lookup, so there's no DynamoDB, no push and no Claude call. It logs the `rule_id`, which is where the substituted time shows (`handleRecurringPushDispatch`, the `[parkproof.push.recurring.skip]` line at `lambda/index.js:2913-2927`, and `lambda/recurring-schedule.js:457-462`).
- It runs once (the end date is 7 minutes after the fire time) and then deletes itself, or step 3 deletes it.

**Step 1. Create the probe.** In the deploy clone, in the shell from stage 4:

```bash
cd $HOME/pp-deploy
export PUSH_DISPATCH_LAMBDA_ARN=$(grep '^PUSH_DISPATCH_LAMBDA_ARN=' scripts/.aws-resources | cut -d= -f2- | tr -d '\r')
export PUSH_SCHEDULER_ROLE_ARN=$(grep '^PUSH_SCHEDULER_ROLE_ARN=' scripts/.aws-resources | cut -d= -f2- | tr -d '\r')
PROBE="pp-awscheck-$(date +%Y%m%d-%H%M)"
echo "$PROBE" > scheduler-probe-name.tmp.txt          # step 3 needs it an hour from now
# One clock reading for all four values: fire 5 minutes from now, to the minute;
# end 7 minutes after the fire.
read MIN HOUR FIRE_UTC END < <(node -e "
const fire = new Date(Date.now() + 5 * 60e3); fire.setUTCSeconds(0, 0)
const p = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(fire)
const g = (t) => Number(p.find((x) => x.type === t).value)
console.log(g('minute'), g('hour'), fire.toISOString().replace('.000Z', 'Z'), new Date(fire.getTime() + 7 * 60e3).toISOString().slice(0, 19) + 'Z')
")
echo "fires at $HOUR:$MIN Melbourne time, which is $FIRE_UTC; ends $END"
node -e "require('fs').writeFileSync('scheduler-probe.tmp.json', JSON.stringify({ Arn: process.env.PUSH_DISPATCH_LAMBDA_ARN, RoleArn: process.env.PUSH_SCHEDULER_ROLE_ARN, Input: JSON.stringify({ _async_kind: 'push-recurring', rule_id: '<aws.scheduler.scheduled-time>', reminder: 'awscheck', device_id: 'awscheck' }) }))"
aws scheduler create-schedule --name "$PROBE" \
  --schedule-expression "cron($MIN $HOUR ? * * *)" \
  --schedule-expression-timezone Australia/Melbourne \
  --flexible-time-window Mode=OFF \
  --end-date "$END" \
  --action-after-completion DELETE \
  --target file://scheduler-probe.tmp.json
echo "create exit: $?"
aws scheduler get-schedule --name "$PROBE" \
  --query '{e:ScheduleExpression,tz:ScheduleExpressionTimezone,end:EndDate,after:ActionAfterCompletion,state:State}'
```

- [ ] `create exit: 0`, and `get-schedule` shows `cron(<MIN> <HOUR> ? * * *)`, `Australia/Melbourne`, the end date `$END`, `DELETE` and `ENABLED`. That's the first half of **B**.
- [ ] **B fails at once** if `create-schedule` is refused with a `ValidationException`. Then every weekly push booking fails and the app reports on-device only. No rollback for the rest of the release. Fix forward by taking `ActionAfterCompletion` out of the cron call (the `CreateScheduleCommand` in `handlePushRecurring`, `lambda/index.js:2831`), keeping `EndDate`, and adding a periodic clean-up of expired `parkproof-push-r-*` schedules. Go straight to step 3's clean-up lines. The privacy text matters here: `privacy.anonymousWeeklyPush` and `privacy.rightsAnonymous` say weekly schedules are deleted within 90 days of the last time the app was opened, and a schedule left after its `EndDate` keeps its device ID, the reminder's name, any address, its days and times and its notification text. So the fix forward ships the automatic clean-up (running at least daily) in the same deploy, or changes both strings in the same deploy (all 9 languages, through `scripts/_i18n_inject_fixlist_final.mjs`, which keeps the copy-pass files in step). Never one without the other.

**Step 2. A minute after `$FIRE_UTC`, read the log.**

```bash
MSYS_NO_PATHCONV=1 aws logs tail /aws/lambda/parkproof-sign-translator --since 15m --filter-pattern awscheck
# expect one line:
# [parkproof.push.recurring.skip] {"rule_id":"<a time>","reminder":"awscheck","reason":"bad_input","date":null}
LOGGED='<paste the rule_id value from that line>'
node -e "const [a, b] = process.argv.slice(1).map(Date.parse); console.log(Number.isFinite(a) && a === b ? 'A and the zone half of C pass' : 'FAIL')" "$LOGGED" "$FIRE_UTC"
```

- [ ] **A passes** when it prints `A and the zone half of C pass`: Scheduler put the scheduled time into the input, and it's the Melbourne wall-clock minute you asked for. In November that's the Melbourne time less 11 hours (AEDT).
- [ ] **A fails** if `rule_id` is the literal `<aws.scheduler.scheduled-time>`, or won't parse. No rollback: the dispatcher falls back to "now, to the minute" (`lambda/recurring-schedule.js:464-465`), so on-time fires are still right. Only a fire that Scheduler retries late can pick the wrong day, or be dropped as stale. Fix forward later: read the time from somewhere else, or drop the field.
- [ ] **The zone half of C fails** if no line arrives within 5 minutes of `$FIRE_UTC`. If Scheduler ignored the zone, the cron would fall 11 hours later, after `$END`, so it never fires. To tell "didn't fire" from "fired, but no log", look at the schedule's metrics in the Scheduler console and the Lambda's Invocations metric. If a line arrives with a different time, the check prints `FAIL`: compare `$LOGGED` with `$FIRE_UTC` to see the offset.

**Step 3. An hour after `$END`, check the self-delete, then clean up.**

```bash
cd $HOME/pp-deploy
PROBE=$(cat scheduler-probe-name.tmp.txt)
aws scheduler get-schedule --name "$PROBE" 2>&1 | grep -c ResourceNotFoundException   # 1: it deleted itself
aws scheduler delete-schedule --name "$PROBE" 2>/dev/null || true                      # only does anything if B failed
rm -f scheduler-probe.tmp.json scheduler-probe-name.tmp.txt
```

- [ ] **B passes** when the first line prints `1`.
- [ ] **B fails later** if it prints `0`: the schedule is still there. Scheduler stops firing it after `EndDate`, so nothing is sent, but it isn't harmless clutter: each leftover weekly schedule keeps the device ID, the reminder's name, any address, its days and times and its notification text, and the privacy text says those are deleted within 90 days of the last time the app was opened. The delete line above removes the probe. Then, with a deadline:
  - The first real weekly schedule reaches its `EndDate` 90 days after the deploy. By then, either ship an automatic clean-up of `parkproof-push-r-*` schedules whose `EndDate` has passed (running at least daily), or change `privacy.anonymousWeeklyPush` and `privacy.rightsAnonymous` so they no longer promise the deletion (all 9 languages, through `scripts/_i18n_inject_fixlist_final.mjs`).
  - Nothing is past its `EndDate` before that day. If the day comes and neither has shipped, run the loop in section 3, step 2 by hand every day from then on, filtered to schedules whose `EndDate` has passed (`list-schedules` doesn't return `EndDate`, so read each one with `get-schedule` first).
  - Write the deadline down now, with the deploy date.

**C, the daylight saving half.** It can't be watched live yet. No Australian zone changes its clocks before Sunday 4 April 2027 (3 am back to 2 am in Melbourne). The next change after that is Sunday 3 October 2027. Weekly schedules end after 90 days, so none booked before 4 January 2027 crosses a change.
- [ ] Now, read-only: read the time zone and daylight saving section of the EventBridge Scheduler user guide. My understanding of it, to confirm against the current page:
  - A zoned cron follows the local wall clock across a change.
  - A time inside the skipped hour is skipped, not moved.
  - A time inside the repeated hour runs once.
  - The app's maths differs on the second point: it moves a skipped time forward and takes the earlier of a repeated time (`lambda/recurring-schedule.js:106-126`). That only affects reminders set between 2:00 and 2:59 am on change days. Accept and document it, or stop offering those times.
- [ ] Optional, read-only: if your Scheduler console's create wizard previews the next trigger dates, enter `cron(0 9 3-5 4 ? 2027)` with `Australia/Melbourne`. Check the offsets, then cancel without saving.
- [ ] Decide by early December 2026, before schedules can cross 4 April. If the docs leave any doubt, cap each weekly `EndDate` at the next clock change in the rule's zone (a small code change). The app re-books when it's opened.
- [ ] Live, in the week of 29 March 2027: repeat steps 1 to 3 with two changes in step 1: `--schedule-expression "cron(0 9 ? * * *)"` and `--end-date 2027-04-06T00:00:00Z` (skip the `read MIN HOUR …` line). In step 2, run the log tail with `--since 4d` on 5 April.
  - Pass: the fire on Saturday 3 April logs `2027-04-02T22:00:00Z` (9 am AEDT), and the fire on Sunday 4 April logs `2027-04-03T23:00:00Z` (9 am AEST).
  - If it fails: in April, Scheduler would fire an hour early on the local clock. In October, an hour late. A late "before" reminder is dropped as stale (`lambda/recurring-schedule.js:480-481`), so failure mostly means silence, not wrong pushes. In-tab reminders and the `.ics` alarms (floating local time) aren't affected. Fix forward with the `EndDate` cap.

### Stage 9. Watch window, 24 hours [Claude, read-only]

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

**Step 1. Delete the four new routes.** Main's dispatcher has no handler for them. They fall through to `handleSignTranslate`, which queues a sign job and answers 202 with a job id (`handleSignTranslate` in main's `lambda/index.js`, reached from the last line of main's `handler`). The new app doesn't see that as an error:
- `/push/recurring`: a 202 with no `skipped` list reads as booked (`src/lib/recurring-push.ts:346-350`). The phone shows weekly push as set, and nothing fires.
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
cd $HOME/pp-deploy
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
| Notice job rows not yet read | Expire 10 minutes after their last write, but DynamoDB's TTL sweep is lazy and can take days (the code says so at `index.js:3146-3149`). The TTL attribute is `ttl` (confirmed 9 Nov 2026), so the sweep does run. Main's status routes have no `ttl` or `kind` check, so main hands one back to anyone holding its job id | None. The job id is a random UUID. If 4.5 ever shows TTL off `ttl`, delete leftover `kind = read-notice` rows by hand |
| Data on the phones: `parkproof.profile.v1`, `parkproof.recurring.v1`, `parkproof.recurring.push.v1`, `parkproof.push.registration_sent.v1`, `parkproof.push.turned_off.v1`, `parkproof.workday.v1`, plus new record fields | Old code ignores them. `parkproof.sessions.v1` wasn't bumped, so records still load. Settings, permits and rules come back on roll-forward | None. See `field-test-plan.md` section 7 for T7's "Shared with you" copies |
| Signed parts (KMS) | Permanent. `lambda/addendum-schema.js` is unchanged, so main's Lambda accepts the same kinds | None |
| OG image in social caches, crawled pages | Can't be pulled back | None |
| `parkproof-public-key.pem` | Unchanged bytes, immutable per CLAUDE.md | Never change it |
| Cognito, KMS key, bucket policies, CloudFront config | Not touched by this branch | None |
