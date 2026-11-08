# Real-AWS test plan for `feat/evidence-chain`

What this covers: the push fix, the signed record chain (T0a to T0b4), the departure sheet and signatures panel (T1a), the rebuilt PDFs (T1b), the full PDF fonts and the translation review. No new API routes are needed. Everything runs through the existing `/sign-session`, `/push/*`, `/sessions/*` and `/photos/*` routes.

There is no separate staging backend. `deploy.sh` updates the one production Lambda and the live site. Nobody uses the app yet, so production is the test environment. The rollback is in section 4.

Who does what: **[Claude]** runs it from this machine. **[You]** do it on your phone or laptop.

---

## 1. Pre-flight checks [Claude, read-only, about 2 minutes]

Nothing here changes AWS.

| # | Check | Why it matters | Pass |
|---|---|---|---|
| 1.1 | `aws sts get-caller-identity` | Right account and credentials | Account ID shown |
| 1.2 | `aws kms get-public-key --key-id alias/parkproof-evidence-signing` compared with `public/parkproof-public-key.pem` and the copy inside `lambda/index.js` | The Lambda now verifies each signed part's parent with this embedded key. A mismatch would make every addendum fail with `ERR_PARENT_SIGNATURE`, and those refusals are permanent | Byte-identical key |
| 1.3 | `aws lambda get-function-configuration --function-name parkproof-sign-translator` | Runtime, and that `KMS_KEY_ID`, `PUSH_SCHEDULER_ROLE_ARN`, `PUSH_DISPATCH_LAMBDA_ARN` and the table and bucket variables are set | All present |
| 1.4 | Lambda role inline policies (`parkproof-lambda-role`) | The new code calls `scheduler:GetSchedule` (push ownership), conditional DynamoDB `PutItem`/`UpdateItem` (merge-safe sync), and paginated `s3:ListBucket` (photo hydration) | All actions granted |
| 1.5 | `aws apigatewayv2 get-routes --api-id tlsmpbft4f` | The routes this build uses already exist | `sign-session`, `push/*`, `sessions/*`, `photos/*`, `me/*` present |
| 1.6 | Local gate: `npx tsc -b`, `npx vitest run`, scoped lint | Nothing broke since the last commit | All pass |

If 1.2 fails, stop. The fix is to update the embedded key from KMS before deploying.

## 2. Deploy [Claude, with your go-ahead, about 5 minutes]

```bash
git switch feat/evidence-chain
./scripts/deploy.sh
```

This rebuilds the Lambda zip, updates the code, rebuilds the frontend, syncs it to S3 and invalidates CloudFront. CloudFront takes 3 to 10 minutes to serve the new files everywhere. On your phone, close the installed app fully and reopen it, or the old service worker can keep serving the old version for one launch.

## 3. Tests [You, about 30 minutes]

For each test: do the steps, compare with "Expected", and if anything differs send me a screenshot plus the time it happened (I can find it in the logs).

### A. A signed record, start to finish (signed out)
1. Open www.parkproof.com.au/app on your phone. Scan a real sign, save the record with GPS on and a car photo.
2. Open the record. Under the green signature panel, open "parts signed".
   - Expected: 2 parts signed (the arrival and the arrival details), each with a signing time and time zone.
3. Tap "Check signatures".
   - Expected: "All 2 signatures are valid. Nothing has changed since ParkProof signed it. That doesn't show what the record says is true." This is the first time the browser checker runs against the real AWS key.
4. Tap "I've left". The sheet shows a location status. Tap "Confirm I've left".
   - Expected: the sheet closes at once. The record shows "You tapped I've left at ... (phone clock)" and, within a few seconds, ParkProof's signing time. Parts signed becomes 3.
5. Check signatures again. Expected: all 3 valid.
6. Export the PDF.
   - Expected: every time shows a zone (AEDT). Departure rows show the phone tap time and ParkProof's signing time separately. The appendix has link 0, link 1 and link 2, each with its payload, signature and the chain step.

### B. A clean record for the test fixture (signed out)
1. Scan, then "No sign here? Just log my park", then "Skip: just save GPS + time". Decline or skip location so the record has no address.
2. Save, then tap "I've left" straight away.
- Why: this record holds only timestamps, no location. I'll turn its real signatures into the test fixture that the two skipped verifier tests need. It goes in the public repo, so it must not contain where you parked.
- What I need from you: export its PDF and send it to me, or sign in (test D) so I can read it from your own cloud row.

### C. Reminders (signed out, notifications allowed)
1. Save a record on a sign whose limit ends soon, or a no-sign record with the earliest "check on my car" reminder. Allow notifications when asked.
2. Lock the phone and wait for the first reminder.
   - Expected: it makes a sound or vibrates. The text names a clock time ("Your parking expires at 2:00 pm"). Tapping it opens that record, not the marketing page.
3. If there's a second reminder due, tap "I've left" before it.
   - Expected: the second reminder never arrives.

### D. Two devices (signed in)
1. Sign in on your phone. Save a record with a photo.
2. Sign in on your laptop at www.parkproof.com.au/app.
   - Expected: the record appears with its photo, and Check signatures passes there too.
3. On the laptop, tap "I've left" on that record. Refresh the phone.
   - Expected: the phone shows it ended, with the departure signed. Nothing was overwritten, and parts signed matches on both.
4. On the laptop, try to remove a reminder that was set on the phone.
   - Expected: a message that the reminders were set on another device. The phone's reminder still fires.

### E. Old records and other languages
1. If you have records from before this build, open one and export its PDF. Expected: it opens and exports as before.
2. Switch the language to 中文, then 한국어, and export a PDF in each. Expected: no blank boxes anywhere. Repeat for Tiếng Việt, Ελληνικά, हिन्दी or ਪੰਜਾਬੀ if you have time.

## 4. Rollback [Claude]

If something is badly broken:

```bash
git switch main
./scripts/deploy.sh
```

That restores the previous Lambda and site. Records saved during the test keep their newer fields, and old code ignores fields it doesn't know. Records with `parkproof-evidence-v2` signatures still display, but old code can't add to their chains. That's acceptable for test data.

## 5. After your tests [Claude, read-only]

- CloudWatch for the test window: errors, `[parkproof.push.dispatch.ok]` lines with their TTL, `/sign-session` 400 codes (`ERR_PARENT_SIGNATURE`, `ERR_CHAIN_KEY`, `ERR_FUTURE_TIME` and the rest), and `/sessions/upload` 409s from the merge.
- Build the real-key fixture from test B and enable the two skipped verifier tests.
- Write up what passed and what didn't, then fix anything that failed.
