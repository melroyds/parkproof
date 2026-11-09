# Field test plan for `integration/roadmap-2` (Tests E to K)

What this covers: everything new tonight on real phones. That's the field-test fixes (one Remind me button, self-healing push, Reconnect, iPhone safe area, back buttons, Ended times, live sync), T2 (condition and proof photos, return photos, the evidence file, the verify pages), T3 (unclear signs, weekly restriction hint), T4 (Settings, saved permits, the permit answer, driver name, home layout), T5a and T5b (weekly reminders on the phone and by push), T7 (share where the car is, hand the car over), T8 ("Got a fine? Start here") and the copy pass. T6a (workday maths) and T9 (accuracy harness) have no phone surface. They get one line each.

It follows Tests A to D in `docs/build/aws-test-plan.md`. Same deal: there's no staging backend, so production is the test environment. Nobody uses the app yet.

Who does what: **[Claude]** runs it from this machine. **[You]** do it on a phone or the laptop.

Phone time: about 82 minutes, inside a 90-minute block. Waiting for reminders runs in the background while you do the next test.

---

## 1. Pre-flight [Claude, read-only, about 5 minutes]

Nothing here changes AWS.

| # | Check | Why it matters | Pass |
|---|---|---|---|
| 1.1 | `git log` on the branch to deploy | T7 must be merged on top of `cfdecc7`. If it isn't, skip Test I and the "Who's driving?" line in G | T7 merge commit present, tree clean |
| 1.2 | Local gate: `npx tsc -b`, `npx vitest run`, scoped lint, `npx vite build` to a scratch folder | Includes `copy-lint.test.ts`, which fails on any em-dash or banned claim. T7 branched before the copy pass, so its strings need the lint after the merge | All pass, lint at baseline |
| 1.3 | `VITE_FEATURE_WORKDAY` is not set in `.env` or `deploy.sh` | Workday mode stays off in production until a lawyer reads the copy | Not set |
| 1.4 | `aws sts get-caller-identity` | Right account | Account ID shown |
| 1.5 | KMS public key against `public/parkproof-public-key.pem` and the copy in `lambda/index.js` | A mismatch makes every new part (condition, proof, handover, departure) fail with `ERR_PARENT_SIGNATURE`, permanently | Byte-identical key |
| 1.6 | `aws lambda get-function-configuration --function-name parkproof-sign-translator` | Runtime is `nodejs20.x` now and deploy moves it to `nodejs22.x`. `KMS_KEY_ID`, `PUSH_SCHEDULER_ROLE_ARN`, `PUSH_DISPATCH_LAMBDA_ARN` and the table variables are set | All present |
| 1.7 | `parkproof-lambda-role` inline policies | Weekly push books cron schedules named `parkproof-push-r-*` (covered by `parkproof-push-*`). New: `/read-notice/status` deletes each job row after reading it, so the role needs `dynamodb:DeleteItem` on `parkproof-jobs`. The delete is best effort, so a missing grant fails quietly and the privacy promise breaks without an error | Scheduler Create, Get, Delete on `parkproof-push-*`, `iam:PassRole` for the scheduler role, `DeleteItem` on `parkproof-jobs` |

If 1.5 fails, stop. If 1.7 is missing `DeleteItem`, add it before deploying (your go-ahead first).

## 2. Deploy [Claude, with your go-ahead, about 5 minutes]

```bash
./scripts/deploy.sh
```

This moves the Lambda to Node 22, adds the routes `push/recurring`, `push/recurring/cancel`, `read-notice` and `GET /read-notice/status/{job_id}`, strips CR from the public key, rebuilds and syncs the site, and invalidates CloudFront.

After it finishes, Claude checks (read-only): the four new routes exist, the runtime reads `nodejs22.x`, the live public key is 178 bytes, and the live verify page contains `certutil`.

---

## 3. Before you start [You, about 10 minutes, not counted]

### Devices

| Device | Browser | Account | Role tonight |
|---|---|---|---|
| **iPhone** | ParkProof on the Home Screen | Signed in | The main driver. Record A, permits, weekly push, share and handover |
| **Samsung** (Android 1, S26 Ultra) | Chrome | Signed in, same account | Live sync partner. Push off then Remind me, Reconnect, Samsung Calendar |
| **Android 2** | Chrome tab, not installed | **Signed out** | Someone else's phone. No readable sign, blocked notifications, receives the share link |
| **Desktop** | Chrome or Edge on Windows | Signed in, same account | Remind me, another device's reminders, the evidence file and the Windows commands |

### Checklist

- [ ] On each phone, close ParkProof fully (swipe it away) and reopen it, so the new version loads. You're on the new version when Home shows **Got a fine? Start here** and a **Settings** row.
- [ ] Android 2: if it's signed in from Test D, sign out.
- [ ] Desktop: Windows "Do not disturb" off. Git for Windows installed (it carries `openssl`). PowerShell open in a new empty folder.
- [ ] A chat app that reaches Android 2 from the iPhone (Messages, WhatsApp or email).
- [ ] Put these in the **iPhone** photo library first. Street View on the laptop screen is fine where you can't find the real thing.
  1. An ordinary timed sign (2P or similar), ideally where the car is.
  2. The same sign with your thumb over about a third of it, including some of the times.
  3. No sign at all: a fence, a tree or the footpath. (Take this one on **Android 2** too.)
  4. A permit-zone sign that shows an area number (for example "Permit Zone Area 25").
  5. A sign with a weekly restriction: a clearway ("Clearway 7-9am Mon-Fri") or street sweeping.
  6. An infringement notice. A real old one with your name, address and registration covered, or a sample notice from a council website on the laptop screen.
- [ ] A notes app open for times. Write the start time as 0:00.

### Rules for the session (pre-decided)

- When something differs from "Expected", take a screenshot, write the time and the device, and move on. Don't fix anything mid-test.
- If a test runs 5 minutes over its box, mark the rest of it skipped and move on. The later tests matter as much.
- AI misreads of staged photos are model notes, not app failures. Note them and carry on.

---

## 4. Tests [You, about 90 minutes]

| Test | What | Devices | Phone time | Clock |
|---|---|---|---|---|
| E | Settings, permits and the app shell | iPhone, Samsung | 12 min | 0:00 to 0:12 |
| F | Reading signs: unclear, permits, weekly | iPhone, Android 2 | 15 min | 0:12 to 0:27 |
| G | Saving with photos, and Remind me on every device | All four | 18 min | 0:27 to 0:45 |
| H | Weekly reminders and calendar files | iPhone, Android 2, Samsung | 10 min | 0:45 to 0:55 |
| I | Share where the car is, and hand it over | iPhone, Android 2 | 10 min | 0:55 to 1:05 |
| J | Leaving, live sync and the evidence file | iPhone, Samsung, desktop | 6 min (+8 desktop) | 1:05 to 1:19 |
| K | Got a fine?, and the copy check | iPhone, desktop | 11 min | 1:19 to 1:30 |

Each test feeds the next. E saves your name and a permit that F and G use. G makes Record A, which I shares, J ends and K matches against a notice.

---

### E. Settings, permits and the app shell [iPhone, Samsung, 12 min]

**Home layout (iPhone)**
1. Open ParkProof from the Home Screen.
   - Expected, top to bottom: the active card (if any), **Scan a parking sign**, then three rows: **History** (with a count), **Street sweeping and weekly reminders** ("None yet"), **Settings** (your email on the right). Then **Got a fine? Start here**.
   - Expected: no "Parking all day? Start a workday" link. Workday mode is off in production.
   - Expected: no old three-step list ("Photo the sign, Photo your car, Get a calendar reminder").

**Safe area and back buttons (iPhone)**
2. Look at the top of Home. The dark green fills the status bar. Nothing sits under the clock or the notch.
3. Visit each screen and tap its back button once: History, an old record, Scan, Settings, Account (from Settings, "Open account"), Weekly reminders, Got a fine?, Privacy.
   - Expected: every "← Home", "← Back" or "← Back to history" sits fully below the clock and works on the **first** tap.
   - Expected: it reads clearly as pale sage green on the dark green, even outdoors.
   - Expected: buttons at the bottom of long screens clear the home indicator bar.

**Old records still work (iPhone)**
4. Open a record from Tests A to D. Tap **Check signatures**.
   - Expected: still valid. Photos still show.

**Settings, driver name and permits (iPhone)**
5. Settings. Expected heading "Settings" and "Saved in this browser only, not in your account."
6. "Your name on records you share": type your first name. **Save name**. Expected: "Saved".
7. My permits, **Add a permit**: Resident parking permit, Victoria, area as printed on photo 4 (for example "Area 25"), no expiry. **Save permit**.
   - Expected: listed with "Area or zone: Area 25". No warning for a resident permit.
8. **Add a permit** again: Accessible parking permit. **Save permit**.
   - Expected: before it saves, the warning "Saving this permit means its type is sent with each sign photo you scan... Accessible permit details are health information. You can delete them any time." with **Save this permit**.
   - Tap **Save this permit**. It's listed. Now **delete it**. Expected: gone, the resident permit untouched.
   - Pre-decided: keep it only if there's an accessible bay on your walk and you want the optional step in F.
9. Push block, "Push notifications on this device".
   - Expected: "✓ Subscribed on this device", the copy "Turning it on sets no reminder by itself", and **Reminders not arriving? Reconnect**.
   - Tap Reconnect. Expected: "Reconnected. Your upcoming reminders on this device will use the new connection." The reliability line sits underneath.
   - If it says **Enable push** instead, tap it and allow. Note that it did.
10. **Open privacy policy**. Expected to find: ParkProof works without an account and the server signs details without keeping a copy; what goes to the AI with each scan (the photo, location, saved permit types); notice photos; weekly push reminders kept only while they're on.

**Per-browser settings (Samsung)**
11. Samsung: open Settings. Expected: no name and no permits. They live in each browser, not the account.
12. Samsung: open History, a record, and Scan. Expected: the back buttons read clearly on the dark green.

**Pass**
- [ ] Home layout as listed, no workday link
- [ ] Every iPhone back button tappable first time, nothing under the clock or home bar
- [ ] Old records open and still check as valid
- [ ] Name and resident permit saved; accessible warning shown before saving; delete works
- [ ] Reconnect works in Settings
- [ ] Samsung has no name or permits

---

### F. Reading signs: unclear signs, permits and weekly restrictions [iPhone, Android 2, 15 min]

Makes: **Record N** (Android 2), **Record P** (iPhone), **Record W** and a weekly rule (iPhone).

**Partly obscured (iPhone, 3 min)**
1. Scan, **From library**, photo 2 (thumb over the sign), Translate.
   - Expected: the answer card still answers, using the strictest reading.
   - Expected banner: "Part of this sign is hard to read", "The answer above uses the most restrictive reading. Check the sign yourself before you leave the car." and "A sign that can't be read clearly is worth keeping a record of."
   - Expected: "What the AI noticed" lists what was hidden. The "On the sign" text describes the sign only, not the AI's complaints.
   - If the AI calls it readable, cover more and try once more. Then move on.
2. **Scan another sign**. Don't save this one.

**No readable sign (Android 2, signed out, 4 min)**
3. Scan, photo 3 (fence or footpath).
   - Expected screen "No readable parking sign", the line about general road rules still applying (10 metres from an intersection), your photo, and two buttons: **Retake photo** and **Log without a sign**.
4. Tap **Retake photo**. Expected: back on Scan. Scan the same photo again.
5. Tap **Log without a sign**.
   - Expected: "We'll save when and where you parked, with the photo you took." and the banner "The record will say ParkProof found no readable parking sign in your photo and you logged this park without one. It doesn't show there was no sign here."
6. Allow location. **Save record**. This is **Record N**.
   - Expected on the reminder screen: "No sign was read for this park, so there's no expiry to remind you of..." **Stop here.** G carries on from this screen.
   - Expected within a few seconds: **Back up your photos** ("Safari can clear a site's data after 7 days without a visit"), with the Home Screen line for other browsers, **Sign in to back up** and **Not now**. Tap **Not now**.
   - It must not appear on the iPhone (Home Screen app) or the Samsung (signed in) at any point tonight.

**Permit zone (iPhone, 4 min)**
7. Scan, library, photo 4 (permit zone), Translate.
   - Expected: the main answer card is the standard answer. Your permit doesn't change it.
   - Expected: "Permit Area 25 only right now" and "Your saved permit for Area 25 matches this zone."
   - Expected question: "Is this permit for this car, and displayed or registered to it?" Nothing is ticked for you.
   - If the sign prints "permit holders excepted", expected: a separate "With your permit" block that quotes the sign, then "ParkProof only reads what the sign prints. Check the conditions on your permit too."
8. Answer **No**. Expected: "Then the permit can't be used for this park. Don't park in this permit zone without a valid permit for it." Save stays blocked.
9. Answer **Yes**, tick the permit acknowledgement, **Save & remind me**.
   - Expected in the logger: **Who's driving? (optional)** filled with your name (T7 adds this field; without T7 the name still goes into the record unseen). The proof section shows "Add a photo of your ticket or permit (optional)".
10. Take the proof photo (anything will do). Expected: the type choice appears only now, with **Permit displayed** already picked. **Save record**. This is **Record P**. On the reminder screen, go Home.
11. Open Record P. Tap **Add a photo of your ticket or permit**. Expected: **Permit displayed** preselected again, the same as on the save screen. Cancel.

**Weekly restriction (iPhone, 4 min)**
12. Scan, library, photo 5 (clearway or street sweeping), Translate.
    - Expected: "This sign has a weekly restriction. You can set a reminder after you save."
    - If the answer is "You can park" with a time limit, expected also: "Your permit may allow more time under Victoria rules. ParkProof doesn't calculate that. Check the conditions on your permit or with your council." (Your resident permit is saved.)
13. **Save & remind me** (or **Log it anyway** if the answer is "Don't park here"), skip the photos, **Save record**. This is **Record W**.
    - Expected on the reminder screen: "Weekly restriction on this sign", a line saying what and when, and **Remind me every week**.
14. Tap **Remind me every week**. Expected: a sheet with "Check these days and times against the sign", the editor filled in with the kind, days, start and end from the sign, and "The sign also says: ..." if it has exceptions.
15. Compare the days and times with photo 5. Fix anything wrong (note what). **Save**.
    - Expected: "Weekly reminder saved." The offer now says "You already have a weekly reminder for this."

**Optional (2 min): accessible bay.** Only if you kept the accessible permit and there's a bay nearby. Scan it. Expected question: "The permit holder is in the car with me and getting out here, and their permit is displayed." Answer No. Expected: "Then the permit can't be used for this park. Don't park in the accessible bay."

**Pass**
- [ ] Obscured banner shown, answer still the strictest one
- [ ] No-readable-sign screen, Retake, and Log without a sign all work; Record N saved with its caption
- [ ] Backup prompt once on Android 2, never on the iPhone or Samsung
- [ ] Area match line, permit question not pre-ticked, "No" blocks the save
- [ ] Driver name prefilled; "Permit displayed" preselected on save and on the record screen
- [ ] Weekly hint shown; the weekly rule prefilled from the sign and saved

---

### G. Saving with photos, and Remind me on every device [all four, 18 min]

Makes: **Record A** (the main record, iPhone), **Record S** (Samsung), **Record D** (desktop). Sets the reminders in the ledger (section 5).

**Record A with photos (iPhone, 8 min)**
1. At the car, scan the real sign (photo 1 or live). Tick any gate that applies to you, such as "I've paid".
2. **Save & remind me**. Expected section order: Location, Car at the spot, Who's driving? (your name), **Record the car's condition (optional)** (closed), Proof of payment or permit, Save record.
3. Allow location. Take the car photo.
4. Open **Record the car's condition (optional)**. Tap **Front**.
   - Expected: the camera opens straight away, with no photo library option.
   - Expected on each tile: "Saving photo…" then "Saved on your phone".
   - Take Front, Rear, Left side, Right side and one Close-up. Type a damage note, for example "Small scratch on rear bumper".
   - Expected text: "A signed photo shows the photo existed by the time it was signed. It doesn't show who caused any damage."
5. Proof section: if you ticked "I've paid", expected **Meter ticket on the dash** ready to go after the photo. Otherwise it stays closed. Leave it.
6. **Save record**. Expected: no slower than before, nothing blocks Save.
7. Reminder screen: pick one chip. Pre-decided: pick the chip that falls after about 1:15 on your clock if there is one, so I've left in J can show it gets cancelled. **Remind me**.
   - Expected: no permission prompt (already allowed) and "1 reminder set for **4:45 pm**. It's sent to this device even when ParkProof is closed." The reliability line shows. No Android tips on the iPhone.
8. Open Record A.
   - Expected: "Logged 3:12 pm (phone clock)" and "Active until ...". Scheduled reminders lists your reminder.
   - Expected: signed parts shows **Arrival** and **Details at parking**, each "Signed by ParkProof at ...".
   - Expected: "Condition when parked" shows 5 photos, each with "Added at ... (phone clock)." and a fingerprint, plus your note "in your own words".
9. **Check signatures**. Expected: "All 2 signatures are valid... That doesn't show they're true." Each photo: "This photo matches its signed fingerprint."
10. **Add condition photos**. Expected intro "ParkProof signs each photo's fingerprint as a new part of this record. The photos themselves aren't sent for signing." Take one photo, **Add to record**. Expected: a **Condition photos** part, signed within seconds.
11. **Add a photo of your ticket or permit**. Use **Paid in an app? Add the payment confirmation from your photos** and pick any screenshot. Choose "Payment confirmation". **Add to record**.
    - Expected: a **Proof of payment or permit** part, and the label "Added from the photo library. The signature shows the photo existed by ParkProof's signing time, not when it was taken."
    - iPhone: both sheets keep their top and bottom buttons clear of the notch and home bar.

**Push off, then Remind me, then Reconnect (Samsung, 4 min)**
12. Settings, **Disable push on this device**, confirm. Expected: the block now offers **Enable push**.
13. Home, Scan, **No sign here? Just log my park**, **Skip: just save GPS + time**, **Save record**. This is **Record S**.
14. Reminder screen: pick **30 min**, tap **Remind me**.
    - Expected: no prompt, then "1 reminder set for ... It's sent to this device even when ParkProof is closed."
    - Settings now shows "✓ Subscribed on this device" again. Remind me turned push back on.
15. Back on the reminder screen, open **Tips for Android phones**. Expected: the spam tip, the Samsung battery tip, and **Reminders not arriving? Reconnect**.
16. Tap Reconnect. Expected: "Reconnected..." The reminder you just booked must still arrive (the ledger checks this).
17. Lock the Samsung and swipe Chrome away. Leave it alone until Test J.

**Blocked, then offline, then online (Android 2, 4 min)**
18. On Record N's reminder screen (from F), reset notifications first: address bar icon, Permissions, Notifications, **Reset** (or set to Ask).
19. Pick **30 min**, tap **Remind me**. Expected: Chrome asks inside that tap (a full prompt, or a small bell in the address bar). Tap **Don't allow**.
    - Expected: "No reminder was set." and "Notifications are off for ParkProof. Allow them when your browser asks, or in your browser's site settings, then tap Remind me again."
20. Tap **Remind me** again. Expected: no second prompt, the same message.
21. Address bar icon, Notifications, **Allow**. Turn on **Airplane mode** with Wi-Fi off. Tap **Remind me**.
    - Expected within about 15 seconds (never stuck on "Setting up…"): "1 reminder set for ..., but it only works while ParkProof is open." and "Reminders for when ParkProof is closed couldn't be set up. Check your connection, then tap Remind me again."
22. Airplane mode off. **Remind me** again. Expected: "...It's sent to this device even when ParkProof is closed."

**Desktop (2 min, not phone time)**
23. Scan, **No sign here? Just log my park**, skip the photo, decline location, **Save record**. This is **Record D**. Pick **30 min**, **Remind me**, allow. Expected: the "sent to this device even when ParkProof is closed" message. Keep Chrome running. Closing the tab is fine, closing Chrome isn't.
24. Open Record A (synced from the iPhone). Scheduled reminders, **+ Add reminder**, pick one.
    - Expected: "These reminders were set on another device. Change them on that device." The iPhone's reminder is untouched.

**Optional (2 min): iPhone in Safari, not the Home Screen app.** Open www.parkproof.com.au/app in Safari, log a no-sign park, tap Remind me. Expected: "On iPhone, reminders need ParkProof on your Home Screen. Tap Share, then Add to Home Screen..." Delete that record afterwards.

**Pass**
- [ ] Logger order right, condition grid camera-only, every tile saved
- [ ] Record A parts signed and checked, with every photo matching
- [ ] After-save condition and proof parts added and signed; library label shown
- [ ] iPhone, Samsung and desktop each say "sent to this device even when ParkProof is closed"
- [ ] Samsung: Remind me turned push back on after Disable; Reconnect done
- [ ] Android 2: blocked path, offline path and online path each say exactly what was set
- [ ] Desktop: another device's reminders can't be changed

---

### H. Weekly reminders and calendar files [iPhone, Android 2, Samsung, 10 min]

**The rule from F (iPhone, 1 min)**
1. Home, **Street sweeping and weekly reminders**.
   - Expected: the rule from Record W with its summary ("Every week on ..."), "Next: ...", and "Set to alert this phone even when ParkProof is closed. Open ParkProof at least once every two months to keep it set."
   - Expected: "Days and times are local time in Melbourne.", the council note ("Councils change these schedules, and public holidays may be different...") and the reliability line.

**Push with ParkProof closed (iPhone, 4 min)**
2. **Add a weekly reminder**:
   - What is it? Street sweeping. Name: "Test sweep". Days: today.
   - Starts: **45 minutes from now, rounded up to the next 5 minutes**. Ends: 30 minutes after that.
   - How often: Every week. Remind me: untick "The evening before". Tick "Before it starts", **15 minutes before**.
   - Notify me on this phone: on. **Save**.
   - Expected: "Weekly reminder saved." and "Set to alert this phone even when ParkProof is closed..."
   - Write the fire time (start minus 15 minutes) in the ledger. It should land at about 1:17, during J's desktop part.
3. Go Home. Expected: the weekly row shows "Next: Test sweep, 7:35 pm" (within 24 hours, so it shows inline).
4. Open the rule, **Add to calendar**.
   - Expected: iOS shows the event with **Add All** or opens Calendar. Expected event: "Test sweep" today at your times, **repeats every week** on that day, an alert 15 minutes before, and notes with the council line and the reliability line.
   - If nothing happens in the Home Screen app, note it. Don't chase it.

**Weekly reminder with ParkProof open (Android 2, 3 min)**
5. Weekly reminders, **Add a weekly reminder**: Name "Test sweep 2", today, Starts **25 minutes from now, rounded up to 5**, 15 minutes before, Notify on. **Save**.
   - It fires at about 1:00, during Test I, while ParkProof is open on this phone.
   - Expected then: **one** notification, not two. It names the day and times and ends "Move the car before 7:15 pm."
6. **Add to calendar**. Pre-decided: if no app offers to open the file, note it and move on. Google Calendar on Android often can't import a file. That's a calendar limit, not ParkProof.

**Calendar, pause and delete (Samsung, 2 min)**
7. Unlock the Samsung only briefly. Weekly reminders, add "Test sweep 3": tomorrow, any time, Notify on. **Save**. **Add to calendar**, open the file with **Samsung Calendar**.
   - Expected: imported as a weekly repeating event at the same wall-clock time, with its alert.
8. **Pause**. Expected: "Paused" and "Paused reminders don't alert you here. A calendar you added it to keeps its own alarms." **Resume**.
9. **Delete reminder**. Expected confirm: "Delete this weekly reminder? A calendar you added it to keeps its copy." Confirm. Gone from the list. Still in Samsung Calendar.
10. Lock the Samsung and swipe Chrome away again. Record S's reminder is due at about 1:06.

**Pass**
- [ ] List shows the zone note, council note and reliability line
- [ ] iPhone rule saved for push; home row shows the next one inline
- [ ] iPhone `.ics` imports as a weekly repeating event with the alert
- [ ] Samsung `.ics` imports in Samsung Calendar
- [ ] Pause, resume and delete behave and say the calendar keeps its copy
- [ ] (Checked later) iPhone push and Android 2 single alert arrive (ledger)

---

### I. Share where the car is, and hand it over [iPhone, Android 2, 10 min]

Needs T7 merged. Uses Record A.

**Share (iPhone, 2 min)**
1. Home: the active card for Record A has a Share icon. Tap it. Expected confirm: "Anyone with this link can see where the car is parked, who parked it and until when. It works for anyone it's forwarded to, and you can't switch it off." Cancel.
2. Open Record A, **Share where the car is**. Same confirm. **Share link**. Send it to Android 2 in your chat app.

**Receive (Android 2, 4 min)**
3. Tap the link. It opens in Chrome.
   - Expected: "Checking the link…", then "Where the car is".
   - Expected banner: "Shared by [your name] at 4:12 pm. This is a snapshot and doesn't update. The car may have moved."
   - Expected: **Signed details** (where it was logged, logged at, limit), with "ParkProof signed these details at ... It doesn't show they are true, who was driving, where the car was, or when it arrived or left."
   - Expected: a **From the sender, not signed** section, **Directions**, and "Saved in your parking records as "Shared with you". Opening the link again updates it."
   - Expected: the address bar no longer shows `#share=`. The browser tab title is ParkProof, not the address.
4. **Check the signature**. Expected: "The signature is valid. Nothing has changed since ParkProof signed it. That doesn't show the details are true..."
5. **Directions**. Expected: maps opens at the parked spot. Come back.
6. Home and History. Expected: no active card for it on Home. History shows it with **Shared with you**.
7. Open it from History. Expected: only the countdown, Directions, Check the signature and Remove. No I've left, no Add condition photos, no Share, no Hand the car over.
8. Changed links. Copy the link from the chat into Chrome's address bar:
   - Change `share=1.` to `share=2.` Expected: "This link was made by a newer version of ParkProof". No details.
   - Restore it, then change one letter in the middle. Expected: "This link has been changed since it was shared" or "This share link can't be read. Ask the sender to share it again." Either is fine. **No details and no Directions** either way.

**Hand over (iPhone, 3 min)**
9. Record A, **Hand the car over**. Expected intro ending "ParkProof doesn't check it, and the signature doesn't show who was driving. The record stays active."
10. Tap **Record the handover** with the name empty. Expected: "Enter the next driver's name."
11. Enter your partner's first name. **Record the handover**.
    - Expected: "Your record now says [you] handed the car to [partner]. ParkProof signs it when your phone is online. The record stays active." and "You can send them a link to where the car is."
    - Expected: Record A is still active on Home. Signed parts gains **Handover**, signed within seconds.
12. Share the new link to Android 2.

**Updated copy (Android 2, 1 min)**
13. Open the new link. Expected: the banner names the driver the record names now. History still has **one** "Shared with you" copy, now updated, not two.

**Optional (1 min):** open the first link on the Samsung, which has Record A through sync. Expected: "This link is for a record saved on this phone, so it wasn't added again." Don't do this if it means unlocking the Samsung before about 1:06.

**Optional:** if you opened a link on the iPhone, it opens in Safari, not the Home Screen app, so the copy lands in Safari. Note it as an observation, not a fail.

**Pass**
- [ ] Confirm copy shown before every share
- [ ] Received view: signed details, unsigned section labelled, banner, Directions, signature valid
- [ ] Shared copy is read-only and never active on Home
- [ ] Changed and newer-version links show no details and no Directions
- [ ] Handover asks for a name, signs a Handover part, keeps the record active
- [ ] Reopening the link updates the one copy

---

### J. Leaving, live sync and the evidence file [iPhone, Samsung, desktop, 14 min]

**Set up the watcher (Samsung, 2 min)**
1. Unlock the Samsung. Has Record S's reminder arrived (due about 1:06)? Note the time it appeared. Tap it. Expected: Record S opens, not the landing page. If it isn't due yet, come back to this after step 4.
2. Open Record A on the Samsung (synced). Note the parts-signed count. Expected: the condition photos load (fetched from your cloud copy).
3. Press Home so ParkProof goes to the background. Leave it there **at least 60 seconds**. Coming back sooner skips the pull.

**Leave with return photos (iPhone, 3 min)**
4. Record A, **I've left**.
   - Expected sheet: a location line ("Getting your location", then "Location captured, ±12 m"), a closed **Record the car's condition now (optional)**, **Confirm I've left** and Cancel. On the iPhone, all of it clears the home bar.
5. Open the condition section. Take **Front** and **Rear**. **Confirm I've left**.
   - Expected: the sheet closes at once.
   - Expected: the status line reads "**Ended 5:23 pm**" (your tap time, not just "Ended"). "Logged ... (phone clock)" is still easy to see.
   - Expected: "You tapped I've left at 5:23 pm (phone clock)." then, within seconds, "Signed by ParkProof at 5:23 pm."
   - Expected: a "Condition on return" group with both photos, each with its time and fingerprint.
   - Expected: Scheduled reminders for Record A is gone. Its reminder must never arrive now.
6. **Check signatures**. Expected: every part valid (about 6: Arrival, Details at parking, Condition photos, Proof of payment or permit, Handover, Departure). Every photo matches.
7. Close ParkProof fully and lock the iPhone. The weekly push is due at about 1:17.

**Live sync (Samsung, 1 min)**
8. Back to ParkProof on the Samsung. Don't reload.
   - Expected within about 5 seconds: Record A shows "Ended 5:23 pm" (the same minute as the iPhone), the departure rows, the same parts-signed count as the iPhone, and the return photos.
9. Optional (2 min): Samsung, Record S, **I've left**, Confirm. On the iPhone, leave ParkProof for 60 seconds then reopen. Expected: Record S shows Ended with the Samsung's tap time.

**Evidence file and the Windows commands (desktop, 8 min, not phone time)**
10. Desktop, Record A. **Export as PDF**. Then **Download evidence file** with "Include permit details" unticked.
    - Expected: `parkproof-evidence-` plus 8 characters `.json` in Downloads. No "signed photos aren't on this device" note, because the desktop fetches them from your cloud copy. If the note shows, write down its count.
11. Copy the file into your empty PowerShell folder and rename it `evidence.json` (the verify page uses that name).
12. Open www.parkproof.com.au/verify/ and follow **Using the evidence file instead of the PDF**, "In PowerShell":
    ```powershell
    $e = Get-Content evidence.json -Raw | ConvertFrom-Json
    [IO.File]::WriteAllBytes((Join-Path $PWD 'link0-payload.txt'), [Convert]::FromBase64String($e.links[0].canonical_payload_base64))
    [IO.File]::WriteAllBytes((Join-Path $PWD 'link0-sig.bin'), [Convert]::FromBase64String($e.links[0].signature_base64))
    curl.exe -O https://www.parkproof.com.au/parkproof-public-key.pem
    openssl dgst -sha256 -verify parkproof-public-key.pem -signature link0-sig.bin link0-payload.txt
    ```
    - Expected: `Verified OK`.
    - Watch for two snags and note whether the page prepared you for them: `openssl` may not be found in PowerShell (Git keeps it in `C:\Program Files\Git\usr\bin\`), and the page prints the openssl command split with `\`, which PowerShell doesn't understand. Type it on one line.
13. The PDF route with `certutil` (the new Windows step). From the PDF's appendix, copy link 1's base64 payload block into `link1-payload.b64` and its signature block into `link1-sig.b64`. Then:
    ```powershell
    certutil -decode link1-payload.b64 link1-payload.txt
    certutil -decode link1-sig.b64 link1-sig.bin
    openssl dgst -sha256 -verify parkproof-public-key.pem -signature link1-sig.bin link1-payload.txt
    ```
    - Expected: `Verified OK`. If certutil says the file exists, delete the old output first.
14. Chain step: `certutil -hashfile link0-payload.txt SHA256`. Expected: the hash equals `parent_payload_sha256` in `link1-payload.txt` (open it in Notepad).
15. Photo step, from "Check the photos", "On Windows":
    ```powershell
    [IO.File]::WriteAllBytes((Join-Path $PWD 'photo1.jpg'), [Convert]::FromBase64String($e.photos[0].bytes_base64))
    certutil -hashfile photo1.jpg SHA256
    $e.photos[0].signed_in
    ```
    - Expected: the hash appears in the signed payload of the link that `signed_in` names (Ctrl+F in that link's payload text).
16. Tamper check: change one character in `link0-payload.txt` in Notepad, save, run the openssl command again. Expected: `Verification failure`.
17. Optional (2 min): Record P's evidence file, unticked then ticked. Expected: unticked, its permit photo shows `withheld_permit` and no permit details. Ticked, the photo bytes and the permit details are in.

**Pass**
- [ ] Departure sheet takes return photos; Confirm closes at once
- [ ] Status line says "Ended" with the tap time; phone time and ParkProof's signing time shown apart
- [ ] Samsung updated without a reload, same time and same parts count
- [ ] Record A's reminder cancelled and never arrives
- [ ] Evidence file complete on the desktop
- [ ] `Verified OK` from the evidence file and from the PDF with `certutil`; chain hash and photo hash match; a changed payload fails

---

### K. Got a fine?, and the copy check [iPhone, desktop, 11 min]

**Not a notice (iPhone, 1 min)**
1. Home, **Got a fine? Start here**. Photograph something that isn't a notice (a coffee cup).
   - Expected: "Couldn't read the notice", **Try a different photo** and **Draft an appeal anyway**. Tap Draft an appeal anyway. Expected: the appeal flow opens at its own photo step. Go back Home.

**Read the notice (iPhone, 6 min)**
2. **Got a fine? Start here**, photo 6 (the notice).
   - Expected: three reading steps, then "What the notice says": notice number, issued by, date, time, place, offence. No registration field.
   - Expected: "Read by AI from your photo. Check each detail against the notice." Check each one. Note misreads.
3. Edit the date to today and the time to **10 minutes after Record A's I've left**.
   - Expected: "Your records from around this time" lists Record A. Tap **Compare with this record**.
   - Expected lines, in substance:
     - "You tapped I've left at 5:23 pm, 10 minutes before the time on the notice. ParkProof signed that record at 5:23 pm. The record shows when you tapped, not when the car moved."
     - "You logged this park at 3:12 pm, 2 hours 21 minutes before the time on the notice."
     - "Your record says [you] was driving... ParkProof didn't check it... Only nominate the person who was actually driving."
     - "Your record says the car was handed to [partner] at ..." (from Test I)
     - "Check the registration on the notice is the car in this record. ParkProof doesn't record registrations." and "Check the due date on the notice itself."
     - If the notice's place is elsewhere: "This record is about N km from the place on the notice."
     - The disclaimer: "This compares your record with what the notice says. It isn't legal advice..."
4. Change the time to the middle of Record A's park, before you tapped I've left.
   - Expected: "...ParkProof only signed it at 5:23 pm, after the time on the notice, so the signature can't show you'd left by 4:30 pm."
5. Change the date to a day with no records. Expected: "None of your saved parking records are from around this date and time..." and **Draft an appeal anyway**.
6. Put the time back to step 3. **Draft an appeal with this record**.
   - Expected: no second photo step, one draft (not two), and no "Strong evidence" style label.
   - Read the draft. It must not say "verified", "GPS-verified", or that the signature proves when the car arrived, left or where it was. Note any sentence that does.
7. **Export evidence PDF**. Expected: Record A's PDF opens.

**Copy check (4 min: 2 on the iPhone, 2 on the desktop)**
8. Record A's PDF (iPhone or desktop). Expected:
   - "Driver (entered on the phone, not checked)" and a handover section.
   - Departure rows: "Tapped I've left (phone clock)" apart from "Signed by ParkProof (server clock)".
   - "Sign condition: Readable in the photo".
   - The Windows paragraph in the verify steps (`certutil -decode`, `curl.exe`).
   - The closing statement: "It is not a legal finding about what happened. The council or court decides that."
   - No em-dashes anywhere. "Verified" only inside the openssl step ("Expect "Verified OK"").
9. Desktop: on www.parkproof.com.au, /verify/, one other language's verify page and /accuracy/, press Ctrl+F for the em-dash character (U+2014, typed with Alt+0151 on Windows) and then for `verif`.
   - Expected: no em-dashes. No "VERIFIED RECORD", "Council-ready", "softens a council review" or "strong evidence". "Verified OK" on the verify page is fine (it's openssl's output).
   - Expected on /accuracy/: the method, and a plain line that the first numbers appear once a held-out set is labelled. Linked from the landing footer only.
10. Paste https://www.parkproof.com.au/?v=11 into a chat. Expected: the preview card's image has no "verified" claim.
11. iPhone: switch the language to Tiếng Việt, open Record A and Settings, and look for the long em-dash. Switch back to English.

**Clean-up (not counted)**
- Delete "Test sweep" and "Test sweep 2". Keep the clearway rule from F only if you want tonight's or tomorrow's alert as a bonus check.
- On Android 2, **Remove** the "Shared with you" copy. This also keeps a rollback safe (section 7).
- Leave the records in place until Claude has read the logs.

**Pass**
- [ ] Not-a-notice path offers "Draft an appeal anyway"
- [ ] Notice fields read, no registration field, date and time editable
- [ ] Before and after comparison lines are factual and say what the signature can't show
- [ ] Driver and handover lines appear from real records
- [ ] Appeal draft has no verdict label and no "verified" or "proves" claims
- [ ] No em-dashes and no banned claims in the PDF, landing, verify, accuracy pages or one other language

---

## 5. Reminder ledger

Fill in the "Arrived" column as they come. Times are from your 0:00 start.

| Set in | Device | Reminder | Due about | Phone state when due | Expected | Arrived |
|---|---|---|---|---|---|---|
| G7 | iPhone | Record A, before expiry | Varies | Varies | Arrives if due before you tap I've left in J. Never after it | |
| G14 | Samsung | Record S, 30 min check-in, then Reconnect | 1:06 | Locked, Chrome swiped away | Arrives on time. Tap opens Record S | |
| G22 | Android 2 | Record N, 30 min check-in | 1:10 | Idle after Test I | Arrives on time | |
| G23 | Desktop | Record D, 30 min check-in | 1:13 | Chrome running, tab in the background | Windows notification | |
| H5 | Android 2 | "Test sweep 2", 15 min before | 1:00 | ParkProof open, during Test I | One alert, not two | |
| H2 | iPhone | "Test sweep", 15 min before | 1:17 | Home Screen app closed, locked | Arrives. Tap opens Weekly reminders | |
| F15 | iPhone | Clearway rule from the sign, defaults | Tonight or tomorrow | Any | Bonus only | |

A reminder counts as late when it lands more than 5 minutes after its time with the phone out of battery saver.

## 6. What a pass looks like, and what blocks the release (pre-decided)

**The build passes** when every pass box in E to K is ticked, or each failure has a screenshot, a time and a fix-list entry, and none of them is a blocker below.

**Blockers.** Any one of these stops the release:
- A signature check fails on a record made tonight, in the app or with openssl.
- A screen says "sent to this device even when ParkProof is closed" and that reminder doesn't arrive, or arrives more than 5 minutes late.
- A reminder arrives for a record after I've left.
- A changed share link shows any details or the Directions link.
- A shared copy offers I've left, photos, handover or share, or shows as an active card.
- The notice comparison or the appeal draft says a signature proves when or where the car was, or uses "verified" about the record.
- A back button on the installed iPhone can't be tapped.
- Claude finds a permit type (accessible, resident or business) in the server logs.

**Fix later** (fix list, not blockers): copy nits, a calendar app that won't import a file, AI misreads of staged photos, layout polish, the PowerShell snags in J12 if `Verified OK` was still reachable.

**Known limits, not failures:**
- A record deleted on one device stays on the other device, and can come back at that device's next app start. The pull on return is pull-only on purpose.
- Daylight saving changes can't be field tested in November. The next one is April 2027. Unit tests cover both changes.
- Workday mode (T6a) has no screens and is off in production. The accuracy harness (T9) has no phone surface beyond the /accuracy/ page.

## 7. Rollback [Claude]

If something is badly broken:

```bash
git switch main
./scripts/deploy.sh
```

Before rolling back:
- Delete the weekly rules on each phone, or Claude deletes the `parkproof-push-r-*` schedules (your go-ahead first). The old code doesn't know weekly push and would get their events until the schedules end.
- Remove "Shared with you" copies on Android 2. The old code doesn't know they're read-only and could treat one as a record of yours.

Records saved tonight keep their newer fields, and old code ignores fields it doesn't know. The Lambda stays on Node 22 after a rollback, which the old code also runs on. The new API routes stay but do nothing.

## 8. After your tests [Claude, read-only]

- **CloudWatch, the test window:**
  - errors of any kind;
  - `[parkproof.push.dispatch.ok]` for each ledger line, including the two weekly ones;
  - `ERR_NOT_SUBSCRIBED` followed by a successful retry (the self-heal), and any `ERR_ENDPOINT_GONE`;
  - `/sign-session` 400 codes for the new parts (condition, compliance, departure with return photos, handover);
  - `[parkproof.job] ... delete after read failed` (the notice rows);
  - no raw model text from the notice reads;
  - no permit types anywhere in the logs.
- **EventBridge Scheduler:** `parkproof-push-r-*` schedules for the weekly rules, with a `cron()` expression, `Australia/Melbourne`, an `EndDate` and `ActionAfterCompletion: DELETE`. None left for "Test sweep 3" after its delete in H9. The dispatcher's log for each weekly fire shows the occurrence date it worked out.
- **DynamoDB:** each test device has a live push registration. The Samsung's endpoint changed after Reconnect. No notice rows left in `parkproof-jobs`.
- Write up what passed and what didn't, add failures to `docs/build/fix-list.md`, then fix them.
