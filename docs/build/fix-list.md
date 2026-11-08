# Fix list

Problems found while testing `feat/evidence-chain` on real AWS. None of these come from the branch itself, so none of them block the merge. Ordered by priority.

## Tier 1: fix next

### 1. A phone can look registered for push when the server has never heard of it

*Found in Test C, 8 Nov 2026, on Android 1.*

- **What happens:**
  - Chrome still holds a push registration, so the reminders screen says "✓ Push reminders enabled".
  - The server has no registration for that phone.
  - `/push/schedule` books the reminder anyway.
  - When it's due, the sender finds no registration, logs `no subscription for device_id` and sends nothing.
  - The user never finds out.
- **Evidence:**
  - Device `2d6f35da` (Android 1) had a reminder booked at 16:09, but `parkproof-push-subscriptions` had no row for it.
  - Device `d477b7b2` (Android 2) did the same at 16:32. Two of three phones were affected.
  - Both Androids were probably registered during the May launch testing, which fits the 90-day expiry.
- **Likely causes:** either of these leaves the phone believing it is registered while the server has nothing:
  - the server row expired after its 90-day lifetime (`PUSH_TTL_DAYS`);
  - the original save to the server failed after Chrome had already registered.
- **The code promises a fix that doesn't exist.** `lambda/index.js` says "Active devices re-subscribe on app open (frontend logic)", but no such frontend code exists.
- **Fix:**
  - Re-send the phone's registration to the server when the app opens and before every booking. `subscribeToPush()` already reuses the existing registration, so this is cheap.
  - Make `/push/schedule` refuse with `ERR_NOT_SUBSCRIBED` when the server has no registration for the device. The app then registers again and retries, instead of booking a reminder that can't be sent.

### 2. A background reminder needs two separate taps, and either one alone fails silently

*Found in Test C, 8 Nov 2026, on the iPhone and Android 1.*

- **The two buttons:**
  - **Enable push** only registers the phone.
  - **Enable 1 browser notification** is what actually books the server reminder. Its wording says it "fires while this tab stays open", which undersells it.
- **Each tap alone fails, with no warning:**
  - Tap only Enable push: nothing is booked.
  - Tap only the browser notification: the reminder lives in the open tab only, and dies when the app is closed. `schedulePushReminders` treats "not registered" as a normal skip.
- **Fix:** one **Remind me** button that registers the phone if needed and then books the reminder. If push can't be turned on, say plainly that the reminder only works while the app is open.

### 3. On an installed iPhone, the back button sits under the status bar and can't be tapped

*Found in Test C, 8 Nov 2026.*

- **Why it happens:**
  - `index.html` sets `viewport-fit=cover` and `apple-mobile-web-app-status-bar-style: black-translucent`, so the installed app draws under the clock and the notch.
  - Nothing in `src/` uses `env(safe-area-inset-*)` to push content back down.
  - The top-left "← Home" lands where iOS swallows taps.
- **Fix:** pad the top of the app shell with `env(safe-area-inset-top)` and the bottom with `env(safe-area-inset-bottom)`. Then re-check every screen on an installed iPhone.

### 4. "← Home" and "← Back" are almost invisible on most screens

*Found in Test C, 8 Nov 2026, on Android and iPhone.*

- **The cause:**
  - `BackButton` sets a default colour of `text-ink-600` (#3C4A43), which suits a light page. The app's page background is the dark green #073B25.
  - Callers try to override that with `text-[#7BE3A4]`.
  - With two colour classes on one element, the order in the CSS file decides the winner, not the order in `className`. In the live CSS, `.text-ink-600` comes after `.text-[#7BE3A4]`, so the grey wins.
- **The result:** the button's contrast is about 1.4:1. The intended green would give about 8:1, and WCAG asks for at least 4.5:1.
- **Screens affected:**
  - SessionHistory, SessionDetail and ActiveSessionsList (their override loses);
  - Clarify and SignScanner (no override at all).
  - The screens that use `!text-[#A9CFBE]` and SessionLogger's `text-paper-50` are fine.
- **Fix:**
  - Make the default colour one that suits a dark page.
  - Stop overriding colours by stacking classes: use `!`, or a single variant prop.

### 5. Reminders reached a Samsung phone late or not at all (cause found: a registration that went bad)

*Found in Test C, 8 Nov 2026, on Android 1 (Samsung S26 Ultra, Chrome).*

- **The setup:**
  - Every send went to the same freshly re-registered phone.
  - Google accepted every one of them (`dispatch.ok`).
  - Chrome's battery use was set to never sleep before test 3.
- **What arrived:**

  | Send | Sent | Phone state | What happened |
  |---|---|---|---|
  | Real reminder | 16:39 | Locked, Chrome swiped away | Never arrived |
  | Test 1 | 16:47 | Chrome open | Arrived at once |
  | Test 2 | 16:51 | Locked, Chrome swiped away | Appeared at 16:52, on unlock |
  | Test 3 | 17:00 | Locked, Chrome swiped away | Appeared at 17:05, on unlock |
  | Test 4 | 17:03 | Locked | Never arrived |
  | Series 1 | 17:15:29 | Unlocked, screen on, Chrome swiped away | Arrived at 17:27, 12 minutes late |
  | Series 2 to 6 | 17:16 to 17:20 | Unlocked at first, then locked | Not arrived as of 17:27 |

- **What the delays suggest:**
  - Reminders are being held somewhere before they reach the phone, and the wait varies.
  - Test sends have a 30-minute lifetime (`PUSH_DEFAULT_TTL_S`), so Google discards anything held longer. That would explain the reminders that never arrived.
  - A likely cause is the home Wi-Fi router quietly dropping the phone's connection to Google, which Google's push service uses to deliver reminders. Messages then wait until the phone reconnects, which unlocking often triggers.
- **Tried 17:30:48:** with Wi-Fi off, on mobile data and locked, the "mobile test" didn't arrive. That weakens the Wi-Fi theory and points at the phone's own push channel, through Google Play services or Chrome.
- **What fixed it:** at 17:44 the user reset the site's notification permission and turned it back on. That made a fresh registration (`push.subscribe` at 17:44:25). Every test after that arrived instantly:

  | Test | Sent | Phone state | Result |
  |---|---|---|---|
  | Live test | 17:44:50 | After a restart | Arrived at once |
  | A | 17:46:36 | Locked, Chrome in the background | Arrived at once, but didn't wake the screen. That's normal on Samsung. |
  | B | 17:47:59 | Locked, Chrome swiped away | Arrived at once |
  | C | 17:54:18 | Locked and untouched for 5 minutes | Arrived at once |

- **Conclusion:**
  - The 16:24 registration went bad. Google kept accepting reminders for it but delivered them late or never.
  - It isn't Samsung's power management, Wi-Fi, or ParkProof's code.
  - The likely trigger is Chrome's "possible spam" handling at 16:51, though that isn't proven.
- **Fix:** item 1 covers it, by re-sending the registration when the app opens. Also consider:
  - re-registering after any spam warning;
  - re-registering whenever a phone hasn't confirmed a delivery for a while.

- **What's ruled out:** the server, the push registration, and the notification code. Test 1 showed the service worker displays a reminder correctly whenever one reaches it.
- **Diagnose before changing anything:**
  - Connect the phone over USB.
  - On the PC, open `chrome://inspect` and inspect the ParkProof service worker on the phone.
  - Go to Application → Background services → Push messaging and record while sending tests.
  - This shows whether a push reaches the phone at all. That narrows it to Google, Samsung's power management, or Chrome's notification filtering.
- **Don't rely on installing to the home screen as a fix.** The installed app still receives reminders through Chrome's same registration.

### 6. A record's screen doesn't say which record it is, so two similar records are easy to mix up

*Found in Test D, 8 Nov 2026, on Android 2 and the desktop.*

- **What was seen:** Android 2 showed "Departure 5:03 PM" for the Test D record, which really ended at 5:23. The parts-signed count also differed from the desktop. A reload fixed both.
- **The data was never wrong.** The cloud rows confirm it:
  - 4e53e51d arrived at 17:08:11, ended at 17:23:23, and its departure was signed at 17:23:23.
  - e11bc03b arrived at 17:02:47, ended at 17:03:02, and its departure was signed at 17:03:04.
  - Neither record carries the other's times.
- **No code path mixes records.** A 9-agent code review checked this and found nothing. The record screen is built only from the record looked up by its id, with no shared caches.
- **What most likely happened:**
  - Android 2 was showing e11bc03b's own screen.
  - Straight after a reload, the phone's list is stale for a few seconds while the sync runs. 4e53e51d isn't ended there yet, or is missing, while e11bc03b shows "Ended 5:03 pm".
  - The record screen's status line says only "Ended", with no time and no other identifier, so it's easy to open the wrong one.
  - The parts mismatch most likely came from viewing 4e53e51d before its merge landed: 2 parts instead of 3.
- **Fix:**
  - Show "Ended 5:23 pm" (the departure tap time) in the status line at `SessionDetail.tsx:360-361`, and keep the arrival time prominent.
  - Fire `notifyRecordsChanged` for each record pulled from the cloud, not only at the end of the whole sync (`sync.ts` `writeNewLocalSession`, `App.tsx:363-365`).

## Tier 2: housekeeping before the next deploy

- **Another device's changes only arrive when the app starts.** `performInitialSync` runs once per page load or sign-in (`App.tsx:384-389`). Nothing pulls when the app comes back to the screen. Add a pull on `visibilitychange`, throttled.

- **Node version.** Move the Lambda from Node 20 to Node 22. The AWS SDK needs Node 22 or newer from early January 2027.
- **Public key line endings.** The live `parkproof-public-key.pem` has Windows line endings (182 bytes against 178 in the repo). The key itself is identical. Add `*.pem text eol=lf` to `.gitattributes` and redeploy.
- **`deploy.sh` and Dropbox.** The script deletes `lambda/node_modules` inside the Dropbox folder, where Dropbox's file locks make it fail. Package the Lambda in a temp folder outside Dropbox.

- **Android first-run tips for reminders.** Two problems on Samsung (S26 Ultra), found in Test C on 8 Nov 2026:
  - **Chrome's spam warning.** Chrome hid one test reminder behind a "possible spam" warning until the user allowed it.
  - **Held reminders.** A reminder sent at 4:51:11 to a locked phone, with Chrome swiped away, only appeared at 4:52, when the phone was unlocked. Samsung's battery management probably held it back.
  - **The fix:** neither one can be fixed in code. Add short help text to the reminders screen on Android:
    - "If Chrome marks it as possible spam, tap Allow."
    - "On Samsung, set Chrome's battery to Unrestricted."
  - Keep the reminder wording plain.

## Tier 3: polish

- **Em-dashes.** Some older strings in the other languages still contain them.
- **Windows verify steps.** The PDF's `base64 -d` verification step doesn't work in Windows cmd or PowerShell.
- **English-only tooltips.** Some tooltips are hardcoded in English and skip translation.
- **Stale `CLAUDE.md` (T10).** It no longer matches the current build.

---

# Status after the overnight build (9 Nov 2026)

Everything above is fixed on `integration/roadmap-2`, except where this section says otherwise. The Tier 3 em-dash and Windows-verify items are done too. Tooltips are partly done (see below). The items below are still open.

## Before deploying

- **The sign schema must compile on the real API.** At 5 am a real call showed the API rejected T3's schema ("compiled grammar is too large"). The fix is on `fix/schema-grammar`. Run `node scripts/check-schema-compiles.mjs` before every deploy.
- **Deploy from a clone outside Dropbox.** `deploy.sh` still deletes `lambda/node_modules` in place. See `docs/build/deploy-checklist-roadmap-2.md`, Stage 2.
- **IAM and tables.** Check `dynamodb:DeleteItem` and `UpdateItem` on `parkproof-jobs`, and whether that table's TTL attribute is `ttl` (as the code writes) or `expires_at` (as CLAUDE.md says). See the checklist's Stage 4.
- **Weekly push (T5b) assumptions need a real AWS check:**
  - the Scheduler's scheduled-time placeholder in the Lambda input;
  - cron behaviour across daylight saving;
  - `EndDate` with `ActionAfterCompletion: DELETE` on cron schedules.
- **Build with `VITE_FEATURE_WORKDAY=false`.** Workday mode needs a lawyer to read its copy first (`docs/legal-review-queue.md`).

## Small, found by the end-to-end run

- **Android "only works while ParkProof is open".** The reminder screen says this, while the weekly list on the same phone says it can't alert at all. That happens only before the service worker controls the page. Make both screens use the same check.
- **"Remove" (shared copy) and "Delete record" are nearly invisible.** Both are `text-accent-600` on the vault, about 1.5:1.
- **`<html lang>` stays `en` in every language.** Screen readers then use an English voice for Greek and Hindi.
- **"No note added. TapAdd noteto record why..."** A negative margin swallows the spaces. This bug is older than tonight.

## Clean-ups

- `src/lib/ics.ts` calendar text and its error string are English-only and not through `t()`. The copy lint only scans `.tsx`, so extend it to user-facing `.ts` strings.
- `HeroAnswer.tsx` and `VerifiedSeal.tsx` have hardcoded English SVG text and aria labels. Move them to `t()`.
- Unused locale keys: `appeal.strongEvidence`, `moderateEvidence`, `weakEvidence`, `landing.feature.*`, `prefs.remindersReliability`, `active.shareAria`, `notice.homeLink`. Delete them in one script.
- Two home rows use T4's own strings rather than the wording T5 and T8 reviewed. Pick one key each.
- Duplicate helpers: `permit-answer.ts` `zonedParts` vs `time-format.ts` `wallClockInZone`, and `DRIVER_NAME_MAX` in two files.
- Privacy wording: `privacy.rightsAnonymous` and `privacy.anonymousWeeklyPush` disagree on how long push data is kept. This needs a legal read and 9 translations (T10).
- Home: "Got a ticket? Draft an appeal" became "Got a fine? Start here", as the spec says. The appeal flow now starts from the notice screen. Revisit if you want the direct link back.

## Not built yet

- **T6b and T6c (workday screens and PDF).** Behind the flag, and blocked on legal review anyway.
- **T10.** Native review of every new string in 8 languages, docs, `CLAUDE.md`, About and the landing page. Do it after you choose a design direction.
- **The redesign.** Three directions are in the artifact "ParkProof Redesign Directions".
