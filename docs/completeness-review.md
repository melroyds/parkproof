# ParkProof — Completeness Review

*A completeness audit, the inverse of a quality audit. It does not judge whether the copy or the design is good. It hunts for absence: what the product should surface, sell, or explain to a user but does not. Run 2026-06-28 across six independent lenses, every finding confirmed against the code, then re-checked by a skeptic whose job was to refute it by finding the thing already present somewhere. 25 gaps survived that check: 1 must, 16 should, 8 nice.*

---

## The read

ParkProof is honest, and it sells itself well. The problem is geography, not content. The honesty, the trust signals, and the pitch all live on the surfaces a careful, unhurried user visits: the marketing landing at `/`, the `/verify` explainer, the appeal flow's disclaimers, the privacy policy. They are almost entirely absent from the two places that actually decide outcomes. The first is the in-app first-contact home (`LandingFeatures`), which a large cohort reaches directly by opening the installed PWA, a bookmark, or a shared `/app/` link, never seeing the marketing site. The second is the moment a stressed driver acts on a verdict and walks away from the car. The app says "a verdict you can rely on" at first contact and shows no "the AI can be wrong, check the real sign" line at the decision point, while the genuinely careful framing sits one tap away on a page that audience never opens.

The second theme is silent failure, and it cuts straight at the product's two promises. For an app whose whole value is durable evidence and reliable reminders, the error lens turned up the most gaps by far (9 of 25), and they cluster on exactly those promises: a photo that fails to back up, a reminder that never schedules, an evidence photo quietly stripped to free storage, a PDF that ships blank. Each fails without telling the user, and the user finds out at the worst possible moment, in front of a council reviewer or after the fine has already landed.

Both themes share one root: the product was built feature-first and the connective tissue, the caveats, the failure surfaces, the "you reached this screen with nothing yet" copy, was added where it was convenient rather than where the user needs it. None of this is a rebuild. Most of it is a line of copy or a small surfaced state at a point that currently says nothing.

---

## Top 3 highest-leverage gaps

**1. The accuracy caveat is missing at both decision points, and the first one over-promises.** `LandingFeatures` (the in-app front door for direct entrants) tells a first-timer the verdict is one they "can rely on" ([en.json:143](src/locales/en.json:143)), and the `ParkingResult` card a driver acts on carries only a soft "did we read this right?" with no plain statement that a machine read can be wrong ([ParkingResult.tsx](src/components/ParkingResult.tsx)). The honest version of this sentence already exists on `/verify`; it just never reaches the person who needs it. This is the rare gap that is a trust problem and a liability problem at once, and it is a one-line fix in two places. For a product about to charge money on parking advice, soften "rely on" and add a persistent caveat before you do anything else.

**2. Silent failures on the evidence and reminder paths.** Three separate places let a core promise fail without a word: a signed-in user's photo upload to S3 fails silently, leaving a cloud session with no image and a blank PDF ([sync.ts:133-141](src/lib/sync.ts)); a Web Push reminder schedule fails silently while the button still says "scheduled", so the only rail that fires when the tab is closed never runs ([push.ts:312-314](src/lib/push.ts), [ReminderOptions.tsx:341-353](src/components/ReminderOptions.tsx)); and localStorage quota recovery deletes the photos off older sessions to make room, telling the user nothing ([App.tsx:286-290](src/App.tsx), [storage.ts:80-117](src/lib/storage.ts)). The product sells evidence and reminders. These let both fail invisibly.

**3. The appeal-letter drafter has no standalone entry point.** It is reachable only from a saved session's detail screen ([SessionDetail.tsx:503](src/components/SessionDetail.tsx)), which means a driver who just got a ticket and found the app to fight it, the single highest-intent acquisition moment, cannot reach the advertised feature, because they never logged a parking session for that spot. The landing explicitly courts this person ("Got a wrongful ticket? Photograph it and we'll draft a formal dispute"). This is the only Tier 1 finding, and it is an activation gap, not a polish one.

---

## What is not a gap (checked and cleared)

The skeptic killed several plausible-sounding claims. Worth recording so the list reads as calibrated, not padded:

- **Empty states are handled.** History has a real empty state ("No sessions yet. Scan a sign and log a session, it'll appear here", [en.json:399-400](src/locales/en.json:399)) and account export has its own. The "blank dead-end screen" worry is unfounded.
- **The appeal flow is honest about itself.** It carries proper disclaimers ("a starting point, not legal advice", "verify every claim before sending", [en.json:448](src/locales/en.json:448) and [en.json:463](src/locales/en.json:463)). The accuracy-caveat gap is specific to the verdict path, not the appeal path.
- **Photo-quality warnings exist** ("Photo looks dark, the AI may misread it", [en.json:212](src/locales/en.json:212)). The pre-token-spend quality check is surfaced.
- **The `/verify` page is the honesty high-water mark.** It says plainly that machines can be wrong and explains what the signature does and does not prove. The gap is that nothing in-app points a user to it at the moment they would want it.
- **The web front door (PWA shell) has full meta.** `index.html` carries a real title, description, Open Graph, and Twitter cards. Positioning is weak in-app, not at the crawlable HTML level.

---

## Gaps by surface

Each finding: what is missing, where, why it matters for this audience (non-technical Australian drivers, often stressed, wary of an app touching their photos and location), the concrete fix, and a tier (1 must, 2 should, 3 nice, 4 noted).

### Onboarding and first contact

**[T2] No accuracy caveat on the in-app first-contact home, and it over-promises.**
`LandingFeatures` never tells the user the AI can be wrong, and `landing.howItWorks.answerDesc` reads "Plain-English verdict you can rely on" ([en.json:143](src/locales/en.json:143); no caveat anywhere in [LandingFeatures.tsx:68-213](src/components/LandingFeatures.tsx)). The only verify copy fires after the scan, too late to set the expectation and easy for a fast user to blow past. *Fix:* add one quiet line under the how-it-works grid ("AI can misread a messy sign, always check our read against the actual sign before you walk away") and soften "verdict you can rely on" to "a plain-English verdict to check against the sign."

**[T2] No iOS "Add to Home Screen" instructions anywhere.**
The Android/Chrome install path is handled by `InstallPromptBanner` on `beforeinstallprompt`, but that event never fires on iOS Safari, and the component says so itself ([InstallPromptBanner.tsx:21-26](src/components/InstallPromptBanner.tsx), returns null on iOS at line 147). The marketing landing's only mention is a passive "iOS Safari, Android Chrome, Installable PWA" list with no how-to ([landing index.html:481](migrations/two-app-architecture/landing-from-claude-design/index.html)). iOS Safari is the largest mobile browser among Australian drivers, and the whole retention loop (offline use, reminders, fast re-check) depends on installing. *Fix:* detect iOS Safari and not-standalone, show a dismissible hint: "Install ParkProof: tap Share, then Add to Home Screen."

**[T2] The in-app home never says free, no account, anonymous.**
The marketing hero carries "Free, no account / Works offline", but a user landing directly at `/app/` sees only "Built for Aussie drivers" ([LandingFeatures.tsx:158-161](src/components/LandingFeatures.tsx); no free/no-account/anonymous string in the `landing.*` block, [en.json:122-157](src/locales/en.json:122)). A privacy-wary driver needs that reassurance at the moment of first contact, before the camera prompt. *Fix:* add a "Free · No account · Works offline" trust strip to `LandingFeatures` matching the marketing hero tail.

**[T3] The "10 seconds vs under 12 seconds" speed claim is inconsistent across the two front doors.**
Marketing says "under 12 seconds" ([landing index.html:7](migrations/two-app-architecture/landing-from-claude-design/index.html)); the React app says "10 seconds" ([en.json:127](src/locales/en.json:127), [en.json:151](src/locales/en.json:151)); the spec says "~12s". "10 seconds" is also the riskier number, a 14s stacked-sign read breaks the promise. *Fix:* pick one honest figure ("in about 12 seconds") and use it on both surfaces.

**[T3] No-GPS expectation is never set at first contact.**
Neither front door tells the user the app still works if they decline location (it falls back to manual address). The fallback copy only appears reactively after a denial ([en.json:301](src/locales/en.json:301)). A privacy-wary driver who denies the location prompt may assume the app is now broken and quit. *Fix:* a half-sentence on the how-it-works or trust line: "Location is optional, decline it and you can still read signs and type the address yourself."

### Positioning and the sell

**[T2] No "who built this / is this official" statement on the visible landing.**
There is no line telling a wary driver this is an independent tool not affiliated with any council, government body, or the people who issue tickets. The only authorship signal is a footer "Built solo over 2 weeks, Made in Melbourne" that a non-technical user will not read as an independence statement ([landing index.html:486-501](migrations/two-app-architecture/landing-from-claude-design/index.html)). The ambiguity cuts both ways: some assume council endorsement and over-trust the legal weight, others distrust an anonymous tool. The "not affiliated with any council" line exists, but only in the Reddit launch copy, never on the site. *Fix:* one line near the privacy section: "ParkProof is an independent tool, not affiliated with, endorsed by, or operated by any council, government body, or parking authority."

**[T3] The in-app first-time home is even thinner on trust than the marketing page.**
`LandingFeatures` carries three confident benefit bullets and "Built for Aussie drivers" with zero accuracy caveat and zero "what powers this" framing ([LandingFeatures.tsx:108-161](src/components/LandingFeatures.tsx), [en.json:122-135](src/locales/en.json:122)). For everyone who reaches the React app directly, this is the front door, and it is pure benefit copy with nothing acknowledging the AI's fallibility before they hand over a photo and GPS. *Fix:* a fourth muted line, "A smart read of the sign, always double-check before you leave the car", as a new translated key. (Same root as the onboarding caveat gap; fix them together.)

### Empty and first-run states

**[T3] No camera-permission-denied fallback on the scan screen.**
`SignScanner` fires the OS camera prompt via a hidden file input; if the user denies camera at the OS level, nothing happens in-app, no copy, no "use library instead" nudge, no re-enable path. There is no camera-denied i18n key (only GPS-denied and notification-denied exist) ([SignScanner.tsx:314](src/components/SignScanner.tsx)). First-timers routinely tap deny out of caution, and then the primary CTA silently does nothing on the very first action. *Fix:* detect the blocked/no-file case and show "Camera access is off. Pick a photo from your library instead, or re-enable camera in your settings", pointing at the existing library path.

**[T3] No privacy reassurance on the scan screen before the first capture.**
The scanner header is purely operational ("Take a clear photo of the sign(s)"). It never says, at the moment of the first photo, that the image and location go to an AI, are not stored server-side, and that the app is anonymous ([SignScanner.tsx:239](src/components/SignScanner.tsx)). That reassurance lives only in the Privacy Policy, a surface this audience does not open. *Fix:* one muted line under the instructions, "Your photo and location are sent to AI to read the sign and are not stored on our servers. No account needed", with a link to the privacy view.

**[T3] First result never reconnects the "why save this" payoff.**
On a brand-new user's first scan, the result shows the verdict plus "Save & remind me" and "Scan another", but nothing explains why a free, anonymous user would save (the evidence-chain payoff the landing teased). The save CTA reads as optional busywork next to "Scan another" ([ParkingResult.tsx:519-541](src/components/ParkingResult.tsx), no first-time framing in `result.*`). *Fix:* show a one-line value reminder beside the save CTA only when `sessionCount === 0`: "Saving keeps a timestamped, tamper-proof record, your proof if you're ever wrongly ticketed."

### Discoverability

**[T1] The appeal-letter drafter has no standalone entry point.**
`AppealFlow` is reachable only from `SessionDetail` ([App.tsx:532](src/App.tsx), [SessionDetail.tsx:503](src/components/SessionDetail.tsx)); its props require a non-optional `session` ([AppealFlow.tsx:10](src/components/AppealFlow.tsx)). A driver who got a ticket but never logged a session for that spot, the highest-intent acquisition moment, has no path to the advertised feature. The home and scan screens expose no appeal entry. *Fix:* add a "Draft an appeal letter" affordance to the home screen that routes into `AppealFlow` with a standalone (null) session. The flow already takes a ticket photo as its input; decouple it from requiring a prior `ParkingSession`.

**[T2] No one-tap "re-check my current parking" entry, despite the landing selling exactly that.**
The landing promises "a tap re-verifies your parking in 2 seconds, no walking back to the sign", but smart re-scan only appears inside the scan screen, after the camera CTA, and only when GPS proximity-matches a saved spot ([SignScanner.tsx:243-258](src/components/SignScanner.tsx)). The `ActiveSessionCard` on home has walk-back and "I've left" but no "re-verify now". The advertised one-tap re-check is actually three taps and a GPS lock deep. *Fix:* surface a "Re-check now" button directly on `ActiveSessionCard`, which already holds the session, calling `handleReuseSession` without routing through the camera.

**[T3] The freshly-exported PDF and `SessionDetail` never link to the friendly `/verify` walkthrough.**
`/verify` is linked from the Privacy Policy ([PrivacyPolicy.tsx:177](src/components/PrivacyPolicy.tsx)) and the marketing landing, but not from the moment a user exports their evidence PDF ([SessionDetail.tsx:481-507](src/components/SessionDetail.tsx)). The PDF appendix ships raw openssl commands and no pointer to the plain-English explainer that exists in 9 locales. The person who just exported evidence is the one most motivated to understand how a council verifies it. *Fix:* add a "How to verify this record" link next to the export button, reusing the existing `verifyUrlForLocale` helper.

### Error and edge states

**[T2] Photo-upload failure is silent.**
The warned-and-swallowed policy in `uploadSession` means a signed-in user is never told their photo did not back up. The DDB row persists with a null photo, so on another device the session shows but the image is gone, and the PDF renders "Image could not be embedded" ([sync.ts:133-141](src/lib/sync.ts); `mirrorSessionToCloud` is fire-and-forget at [App.tsx:306-307](src/App.tsx)). The whole reason a wary driver signs in is durable cross-device evidence. *Fix:* track per-session sync state and show a "Photo didn't back up, tap to retry" indicator; at minimum a non-blocking toast after save when mirroring fails.

**[T2] "Works offline" is claimed, but the core scan needs the network and dead-ends when offline.**
The landing says "works fully offline", yet there is no `navigator.onLine` check anywhere, and an offline scan lands in the generic error view showing a raw "Failed to fetch" ([landing index.html:133,431](migrations/two-app-architecture/landing-from-claude-design/index.html); [api.ts:125-127](src/lib/api.ts); [App.tsx:408-432](src/App.tsx)). A driver in a basement carpark gets a cryptic error after being told the app works offline. *Fix:* catch the network error specifically and render "You're offline. Reading a sign needs a connection, your saved sessions and reminders still work", and soften the landing copy to "Saved sessions and reminders work offline."

**[T2] Quota recovery deletes evidence photos silently.**
When localStorage is full, the recovery strips photos from old sessions or evicts them, logged only to `console.info` ([App.tsx:286-290](src/App.tsx), [storage.ts:80-117](src/lib/storage.ts); no i18n keys for quota recovery exist). For a product selling evidence a user produces months later, silently deleting that evidence to fit a new save directly contradicts the promise. *Fix:* when eviction or photo-trimming happens, show "Your device storage was full, so photos from N older record(s) were removed. Sign in to keep evidence safe in the cloud."

**[T2] Background push-reminder scheduling fails silently while the button says "scheduled".**
When the in-tab path works but the server-side Web Push schedule (the only rail that fires with the tab closed) fails on the network POST, `schedulePushReminders` returns null and the result is ignored ([push.ts:312-314](src/lib/push.ts), [ReminderOptions.tsx:341-353](src/components/ReminderOptions.tsx)). The user closes the tab believing a reminder is set; none fires; they get ticketed. A silent failure here costs real money. *Fix:* when the user is push-subscribed but scheduling returns null, surface "Couldn't set the background reminder, it may only fire while this tab is open. Try again", distinct from the legitimate not-subscribed case.

**[T2] A wrong "can't park" verdict strands the user with no override.**
The result's log button is gated on `can_park_now`, and the verify card offers only "Looks right" or "Retake" ([ParkingResult.tsx:519-534](src/components/ParkingResult.tsx)). An AI misread that wrongly says "can't park" leaves the driver with no way to log the spot as evidence of a reasonable decision, the app silently overruling them. *Fix:* on a "can't park" verdict, add "Think this is wrong? You can still log this spot as evidence" routing to `SessionLogger`, plus the same accuracy caveat.

**[T2] The GPS hard-error state hides the manual-address entry that exists for the imprecise case.**
The "Enter address" affordance only renders when `gps.status === 'ok'` (the imprecise branch); the hard-error branch shows "can save without GPS" but no address box ([SessionLogger.tsx:411-416](src/components/SessionLogger.tsx); `startEdit` hard-returns if status is not ok, line 85). A driver whose GPS errored, common indoors or in an urban canyon, is downgraded to a location-less record when they could have typed the corner. *Fix:* add an "Enter address manually" button to the error branch, opening the same geocode edit flow.

**[T2] No global error boundary.**
Any unhandled render exception takes the whole React tree to a blank white screen with no recovery ([App.tsx](src/App.tsx), no `ErrorBoundary` in the tree at [main.tsx:32-50](src/main.tsx)). The CLAUDE.md records a prior full-tree crash (commit 2db84b8) that blanked auth and scan. A blank screen is the most dead-end failure possible for a stressed user at a sign. *Fix:* wrap the app in an error boundary with a friendly "Something broke. Reload the app." fallback and a reload button, ideally firing a feedback event so crashes become observable.

**[T2] Cross-device PDF embed failure is invisible and unactionable.**
When a cloud-pulled photo can't be materialized (old pre-CORS session, expired presign, S3 404), the PDF silently substitutes "Image could not be embedded" with no explanation ([pdf.ts:194-198](src/lib/pdf.ts), and the jsPDF catch at 275-280). A driver hands a council a PDF where the sign photo reads "Image could not be embedded", having no idea it happened, because the PDF "generated successfully". *Fix:* when `materializeRemotePhotos` returns a session still holding HTTPS or null photo fields, show a pre-export note: "One or more photos couldn't be loaded for this older session. Export anyway, or open it on the device where it was created."

**[T3] Sign-in failures render raw Cognito exceptions.**
Only `UserNotConfirmedException` is mapped; everything else surfaces `err.message` verbatim ([AuthFlow.tsx:59-67](src/components/AuthFlow.tsx) and the other handlers at 81-156). A driver who fat-fingers a password sees a Java-style "NotAuthorizedException". *Fix:* a small error-code mapper (wrong password, already have an account, too many attempts, code didn't match) with a friendly generic fallback.

### Trust and safety messaging

**[T2] No context line before the OS camera or location prompt.**
The first "Take a photo" fires the camera input cold, and `SessionLogger` calls `getCurrentPosition` on mount, both triggering the OS dialog with no preceding "why we need this and that the photo stays on your phone" ([SignScanner.tsx:314](src/components/SignScanner.tsx), [SessionLogger.tsx:179](src/components/SessionLogger.tsx)). Cold permission prompts are where users bail or deny, and a denial here breaks GPS-anchored evidence silently. *Fix:* one short line above each: for the scanner, "Your photo is read on your phone and only the sign image is sent to translate it"; for the GPS card, "We use your location only to timestamp where you parked, it stays on your device unless you sign in." New translated keys.

**[T2] The in-app result card never states the verdict can be wrong, while the landing says it can be relied on.**
`ParkingResult` carries only the soft "Did we read this right? Compare the bullets to the actual sign", never a plain "this is a machine read that can be incorrect", while [en.json:143](src/locales/en.json:143) says "verdict you can rely on". This is the highest-stakes screen, where a wrong read costs a real fine, and it is the one place the honesty (which `/verify` nails) never reaches. *Fix:* add a persistent low-key `result.aiCaveat` near the verdict for every result, not only low-confidence ones, and soften the landing line. (Same cluster as the two onboarding caveat gaps; one decision, three surfaces.)

**[T2] The "tamper-proof" claim is asserted but never explained in plain English in-app.**
`AboutFeatures` says "signed with a digital seal so nobody can argue it was edited" ([en.json:55](src/locales/en.json:55)) and the landing says "tamper-proof evidence", but the only honest plain-English explanation of what that proves (integrity, not that the AI was right, not legal admissibility) lives on the external `/verify` page and the PDF appendix. The in-app privacy signing section is the opposite problem: pure KMS/ECDSA/openssl jargon ([en.json:579](src/locales/en.json:579)). A non-technical driver reads "tamper-proof" and assumes "this wins my dispute". *Fix:* one plain-English caveat next to the digital-seal bullet and on the export surface: "The seal proves the record wasn't changed after you saved it. It doesn't prove the AI read the sign correctly or guarantee a council will accept it", linking "How this works" to `/verify`.

---

## Suggested sequence

The brief asked for absence, not priority, but the leverage is lopsided enough to name a sequence.

1. **Do the accuracy-caveat cluster first.** Three findings (in-app home over-promise, the result card, the "can't park" override) are one decision: stop selling "rely on" and add a "check the real sign" line at the points a driver acts. It is cheap, it is the same copy in three places, and it is the one gap that is also a liability before you commercialise.
2. **Then close the silent failures.** Photo-sync, push-schedule, and quota-deletion each break a promise the product is about to charge for. These need a small surfaced state, not a redesign. The error boundary belongs here too, given the app's crash history.
3. **Then the appeal standalone entry**, the only Tier 1, because it converts the highest-intent visitor you already advertise to.
4. **The rest is should-and-nice:** the trust strip and permission-context lines, the install hint for iOS, the `/verify` links at the point of need, the empty-state reassurances. Worthwhile, none blocking.

Nothing here is structural. The product is feature-complete; what it lacks is the connective copy and the failure surfaces at the exact moments the user is deciding or being let down.
