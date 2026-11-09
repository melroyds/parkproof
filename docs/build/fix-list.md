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

# Status after the overnight build (9 Nov 2026, updated for T10 at `09d5c24`)

Everything above is fixed on `integration/roadmap-2`. None of it is deployed yet: `docs/build/deploy-checklist-roadmap-2.md` is the runbook.

| Item above | Fixed in |
|---|---|
| Tier 1.1, a phone that looks registered for push | `b639e76` (re-send on open and before every booking, `ERR_NOT_SUBSCRIBED`, tombstones), hardened in `7b10cc1` |
| Tier 1.2, two taps for one reminder | `b639e76` (one Remind me button); `7b10cc1` arms the in-tab reminders before any network work |
| Tier 1.3, the iPhone safe area | `b639e76` |
| Tier 1.4, invisible back buttons | `b639e76` (sage on the vault, 7.4:1) |
| Tier 1.5, late or lost reminders on Samsung | `b639e76`: the re-registration in 1.1, Reconnect for a fresh registration, and the Android tips |
| Tier 1.6, which record is this | `b639e76` ("Ended 5:23 pm" in the record's zone; records update as they sync) |
| Tier 2, changes from another device | `b639e76` (a throttled pull when the app comes back to the screen) |
| Tier 2, Node 22 | `b639e76` (`deploy.sh` moves the runtime on the next deploy) |
| Tier 2, public key line endings | `b639e76` (`*.pem` LF in `.gitattributes`; `deploy.sh` strips CR from every PEM); `2f00630` adds `*.mjs` and `*.sh` |
| Tier 2, `deploy.sh` and Dropbox | `b63e8ee` (the Lambda package is staged in a temp folder; `--package-only` rehearses it) |
| Tier 2, Android first-run tips | `b639e76` |
| Tier 3, em-dashes | `5902506` (none left in any locale; the copy lint keeps it that way) |
| Tier 3, Windows verify steps | `2a100f6` (the verify pages' Windows section, `certutil -decode`) |
| Tier 3, English-only tooltips | `b63e8ee` |
| Tier 3, stale `CLAUDE.md` | T10 docs pass (rewritten against the code at `09d5c24`) |

## Done since the overnight build

- **The sign schema compiles on the real API.** `789fdc5`, merged as `863a230`. Run `node scripts/check-schema-compiles.mjs` before every deploy.
- **Permit tie-break** (accessible first, then an area match, then list order, in the app and the prompt). `b63e8ee`.
- **`deploy.sh` and Dropbox, `VITE_FEATURE_WORKDAY=false` on every build unless `DEPLOY_ALLOW_WORKDAY=1`, `.env` can't override the shell.** `b63e8ee`.
- **`scripts/setup-jobs-table.sh` (the missing `dynamodb:DeleteItem`) and `scripts/setup-log-retention.sh` (90 days).** Written in `b63e8ee`. Neither has been run: they are go-ahead steps 6.1 and 6.2 of the deploy checklist.
- **"Small, found by the end-to-end run"**: the shared "can this phone alert" check, Remove and Delete record contrast, `<html lang>`, and the note spacing. All `b63e8ee`. The note sentence is one string since `81d3895` (below).
- **Clean-ups**: calendar text, the hero and seal labels, unused keys, the home rows, duplicate helpers, and the privacy wording. All `b63e8ee`.
- **T6b and T6c (workday screens and PDF).** `378c4c6`, merged as `09d5c24`. Behind `VITE_FEATURE_WORKDAY`, which stays off in production: no lawyer has read the workday copy.
- **Home: "Got a fine? Start here"** replaced "Got a ticket? Draft an appeal" (the T4 home layout, `e60391c`; the notice screen is T8, `598ffdf`). The appeal flow starts from the notice screen. Revisit if you want the direct link back.
- **The last lows, all `81d3895`** (the inject script is `scripts/_i18n_inject_last_lows.mjs`, run after the T10 review):
  - **The empty-note sentence** is one translated string, `session.noteEmpty`, with the Add note button inside it through `<Trans>`. Each of the 9 locales puts the button where its word order wants it (ko, hi and pa put the verb last). The button's text is the locale's `session.addNote`, so its accessible name is unchanged, and the spaces either side come from the sentence (the `b63e8ee` fix holds). `session.noNote` and `session.noteHelp` are deleted, and no inject script or copy-pass file writes them (`src/lib/i18n-chain.test.ts`).
  - **"ticket" in older English strings** now says "fine", or "infringement notice" and "notice" for the paper: `session.draftAppeal`, `home.draftAppeal`, `home.tagline`, `about.lead`, `about.evidence.items[0]`, `about.appeal.title`, `about.appeal.items[0]`, `about.support.body`, `landing.bullet.defensible`, `reminders.expired`, `appeal.captureTakePhotoSub` and `appeal.draftingHeader`, plus the app shell's and the landing's own English. The 8 translations changed only where they said ticket or used another word than the verified term for a fine. `session.notePlaceholder` also stopped saying the note is used for an appeal (the appeal draft never reads it): it says the note goes in the record's PDF, in all 9. `src/lib/copy-lint.test.ts` fails on "ticket" alone in any English string or landing page; "meter ticket", "pay-and-display ticket", keys about a meter ticket and the two paid-parking answers are allowed. `docs/build/translation-human-review.md` says what a native reader should check.
  - **The Anthropic usage alarm counts notice reads**: `scripts/anthropic-usage-alarm.sh` adds `?"notice_call="` to its filter pattern. Only the script changed. Re-running it is a go-ahead deploy step (deploy checklist 6.4): until then the live filter doesn't count `/read-notice` calls.
  - **`scripts/teardown.sh` is up to date.** A dry run (still the default) lists, and `--confirm` removes, everything the setup and deploy scripts create: every `parkproof-push-*` schedule and a hand-made `parkproof-warmer`, CloudFront and its `parkproof-uri-rewrite` function, the OAC, the API, the Lambda, its log groups, the usage alarm, its topic and the launch dashboard, the Cognito pool and its Hosted UI domain, the sessions, push and jobs tables, the app, evidence and feedback buckets (emptied first, old versions included), the KMS key (scheduled for deletion after 7 days, the minimum KMS allows, then its alias) and the scheduler and Lambda roles (inline policies deleted and managed ones detached first). It keeps the budget alarm and `scripts/.aws-resources`. `scripts/teardown.test.mjs` runs it against a fake AWS and checks that it names every resource a setup script creates. Since the review after `bc388a7`, a lookup that fails any way but AWS's not-found error stops the run and it never says "Teardown complete" (it used to read every failed lookup as "nothing to delete", so a failed CloudFront list would have deleted the app bucket while the distribution still used it, leaving the name free to claim). The app bucket also goes only when no distribution in the account still uses it as an origin. The test fails each kind of lookup and checks the run stops there. Never run.
  - **`lambda/` line numbers in the deploy checklist** match the current code. Two that were already wrong at `cfdecc7` are corrected, and main's code is named by function.
  - **OG image cache**: the landing, the accuracy page and the app shell ask for `og-image.png?v=2` in their share tags.
  - **Sitemap dates**: the landing, accuracy and verify entries have `lastmod` 2026-11-09. `/app/` keeps 2026-05-24.

## Still open

### Waiting on a decision

- **The About page and the landing (T10 items 3 and 4).** Waiting for the design choice. `AboutFeatures.tsx` has no sections yet for the evidence chain, sharing, the notice lookup or workday mode, and the landing's evidence and reminders lists predate this build.
- **The redesign.** Three directions are in the artifact "ParkProof Redesign Directions". The README screenshots (`docs/screenshots/`, 25 May 2026) predate the green identity, so regenerate them (`npm run screenshots`) once a direction is chosen.
- **The accessible permit answer in the feedback log.** Keep `disabled_permit_acknowledged` (the privacy text now says it's logged) or drop it and its sentence. `docs/legal-review-queue.md`, privacy section.
- **Weekly push across daylight saving.** Decide by early December 2026 whether to cap each weekly schedule's `EndDate` at the next clock change (deploy checklist 8.5, C).
- **A legal read.** No lawyer is engaged. Every key in `docs/legal-review-queue.md` is Not reviewed, and workday mode stays off until its keys are approved.

### At or before the deploy

- **PDF font subsets: re-cut from `fonts-src/` at deploy time.** The T10 translation review changes 8 locales after `09d5c24`, and the committed subsets (Korean and Chinese last cut in `378c4c6`) can miss characters it adds. With the review applied, `src/lib/pdf-font-coverage.test.ts` passes on the committed subsets, so this re-cut is a safeguard. `deploy.sh` re-cuts them when fontTools is installed, from `fonts-src/` when it's there. Without `fonts-src/` it re-subsets the committed files in place, which can only drop glyphs. So deploy from the clone with `fonts-src/` copied in (checklist stages 2 and 3.3), run `src/lib/pdf-font-coverage.test.ts`, and commit the re-cut fonts.
- **The Scheduler checks for weekly push** need real AWS: stage 6.3 before the deploy, 8.5 after it.
- **The jobs-table grant and the log retention** (stages 6.1 and 6.2).
- **Re-run `scripts/anthropic-usage-alarm.sh`** so the live filter counts notice reads (stage 6.4, a go-ahead step).

### Copy and translation

- **Privacy facts to check.** Writing the legal queue turned up four places where older policy text and the code may not say the same thing (Anthropic and Nominatim retention, push services, how long sign readings and appeal drafts stay in the jobs table, two unlisted log lines). Listed at the end of `docs/legal-review-queue.md`. Each change needs all 9 languages and a new "Last updated" date.

### Lows found in the git log and the docs

- **No accuracy numbers yet.** `eval/corpus/` holds only `.gitkeep`, so the accuracy page says no numbers yet and the in-app link stays off (T9 item 4) until a held-out test split is labelled.

### Workday spec questions for later

Workday mode is off in production, so none of these blocks a deploy. Answer them before anyone asks a lawyer to approve the workday keys.

- **(a) "still runs from {{start}}" has no "(phone clock)" label.** `{{start}}` in `workday.boundary.notSure` is a phone time (when the stop that started the limit was logged). The copy rules label phone times, but build spec T6b item 8 gives the line word for word, so it ships without the label. Confirm, or add it.
- **(b) "stop" or "leg".** The spec says "stop" in some places (T6b: "Workday, {{count}} stops", "Don't save this stop") and "leg" in others (T6a, T6c: "every leg you choose", "previous leg"). The screens say stop. The PDF and its picker say "Leg" in English to match T6c's exact wording, and the other 8 locales use their word for a workday stop. Pick one.
- **(c) The heads-up reminder's wording.** T6b item 9 gives "Your 2P on this stretch ends at {{time}}. Move off this signed stretch, not just to another bay." The build says "Your time limit on this stretch ends at {{time}}. …" (`workday.reminder.headsUp`), because the deadline can be an earlier sign's limit carried over, so naming this sign's limit could be wrong. Confirm, or ask for the limit to be named.
- **(d) Should stop 1 be checked against an ended earlier record?** Stop 1 always runs on its own sign's limit. A driver who taps I've left, moves a few bays along the same stretch and then starts a workday gets a fresh limit at stop 1. The start screen steers away from that (`workday.start.useCurrentHelp`, `workday.start.currentIneligible`) but the app doesn't check it. Decide whether stop 1 should be compared with the driver's last record whose limit is still running, and ask the boundary question when it trips.

The legal queue also asks about the area lines marked "(added)" and about "Arrived (phone clock)" against "Logged (phone clock)" in the workday PDF.
