# Legal review queue

> **Read this first (9 November 2026).** No lawyer is engaged, and nobody qualified has read any string in this file, so every status below is **Not reviewed**.
> - **Workday mode stays off in production.** Its copy carries the most risk in the app (next section), so no production or staging build turns it on until every workday key here is **Approved** (see "Gate" below).
> - **The other sections ship with the rest of the app.** They are written to state facts only: what the code does, what a signature does and doesn't show, and which times come from the phone and which from ParkProof's server. They promise no outcome and give no legal advice. Until someone qualified reads them, treat a change to the code they describe as a change to the copy, and change both together.

Every user-facing string a lawyer should read before launch, grouped by area: first the app's string keys (`src/locales`), then the pages outside the app, which aren't locale keys (the /verify pages, the landing page and the accuracy page, section 8). Each app section names the roadmap task (`docs/build/roadmap-build-spec.md`) and the inject script that wrote its keys. Run that script with `--list` to print every key it owns: `legal` marks the keys listed here. `--list` only prints; it never writes a locale file.

The English is quoted from `src/locales/en.json` on `integration/roadmap-2` at `09d5c24`, and for the pages outside the app from their source files. The other 8 locales carry the same meaning and need checking by a reviewer who reads that language. `docs/build/translation-human-review.md` covers both language reviews: the evidence-chain build's (`b8c88eb`), with the translations its reviewers asked a person to read and why, and roadmap 2's T10 review (`90d5eff`), which kept no such list, with the legal strings it rewrote. `src/lib/legal-review-queue.test.ts` fails when a workday key (`workday.*`, `pdf.workday.*`) is missing from this file, or when a workday screen shows another key that the workday section doesn't name. The other sections have no such test, so a task that adds a statement of the same kind adds it here by hand.

Status values: **Not reviewed**, **Changes asked**, **Approved** (with the reviewer and date).

Sections:
1. Workday mode (T6a, T6b, T6c), off in production
2. Signature statements (T0a to T3)
3. Permits (T4)
4. Weekly reminders (T5)
5. Sharing the record (T7)
6. Notice comparison (T8)
7. Privacy policy (T4, T5 and the fix list)
8. Pages outside the app: the /verify pages, the landing page and the accuracy page

---

## Workday mode (T6a, T6b, T6c)

**Gate.** Workday mode ships behind `VITE_FEATURE_WORKDAY` (`src/lib/features.ts`). Unset, it is on in `npm run dev` and off in any build. `vite.config.ts` and `package.json` never set it. `scripts/deploy.sh` and `scripts/_deploy-staging.sh` always set it on the build command: `false`, unless the shell that runs them sets `DEPLOY_ALLOW_WORKDAY=1`, which makes it `true`. With T6b and T6c merged, that one variable ships the whole workday UI: the home link, the start screen, the workday card, the boundary question, the stop reminders, the workday view and the workday PDF. Don't set `DEPLOY_ALLOW_WORKDAY=1` until every key in this section is **Approved**.

**Why it needs a lawyer.** Continuous parking runs until the car leaves the signed length of road, or the whole area under an area sign (Road Rules r205(2), r332, r335, as adopted in Victoria and Queensland). A record of a move a few bays along the same stretch is signed evidence of a breach. The copy must never say or imply that moving, paying again or topping up restarts the limit, must never promise an outcome, and must never name a distance. See `docs/research/03-workday-shuffle.md` section 2.

Copy keys are in `src/locales/<locale>.json`. The English text is quoted below; the other 8 locales carry the same meaning and need checking by a reviewer who reads that language.

### T6a: reminder copy (scheduled for each workday leg)

Added by `scripts/_i18n_inject_t6a.mjs` (run it with `--list` to print the keys). Sent by `workdayReminderCopy` in `src/lib/workday.ts`. `{{time}}` is the deadline as an absolute local time, with the day when it isn't the day the reminder fires, and the zone's name ("2:20 am AEST") when a daylight saving change falls between the reminder and the deadline.

| Key | When it fires | English | Status |
|---|---|---|---|
| `workday.reminder.headsUp` | 45 minutes before the deadline, on a signed length of road | Your time limit on this stretch ends at {{time}}. Move off this signed stretch, not just to another bay. | Not reviewed |
| `workday.reminder.headsUpArea` | 45 minutes before the deadline, under an area sign | Your time limit in this parking area ends at {{time}}. Move the car out of the whole area, not just to another street inside it. | Not reviewed |
| `workday.reminder.goNow` | The walk time (at least 10 minutes) plus 15 minutes before the deadline; as soon as possible when that time has already passed | Leave now to move the car before {{time}}. | Not reviewed |
| `workday.reminder.ended` | At the deadline, on a signed length of road | Your time on this stretch ended at {{time}}. | Not reviewed |
| `workday.reminder.endedArea` | At the deadline, under an area sign | Your time in this parking area ended at {{time}}. | Not reviewed |

**Which wording a leg gets.** The area lines go to a leg whose own sign is an area sign, and to a leg that kept an area limit running (the driver answered "I'm not sure" to the area question), including an area limit carried over several moves (`legInAreaMode`, `stretchInAreaMode`). Every other leg gets the stretch lines. Go-now names no place, so both share it.

**Open question for the spec owner: heads-up wording.** Build spec T6b item 9 gives the heads-up as "Your 2P on this stretch ends at {{time}}. ..." The build says "Your time limit" instead, because the deadline can be an earlier sign's limit carried over (the driver wasn't sure they had left the stretch), so naming this sign's "2P" could be wrong, and records don't reliably carry the limit. The heads-up and go-now lines are T6b item 9's reminder copy, added in T6a because the reminder function that sends them is T6a's. Please confirm the wording or ask for the limit to be named.

The push title reuses `reminders.pushTitleFallback` ("Parking reminder") when the record has no address. Wherever these reminders are offered, the screen also carries the reliability line from the copy rules (`reminders.reliability`: "Reminders can be delayed or silenced, for example by Focus or battery saving. Don't rely on them alone."). T6b shows it on the start screen's readiness note and with the stop's reminders on the home workday card (`WorkdayReadinessNote`, `WorkdayStopReminders`).

### Behaviour to read with the copy (T6a, no strings)

These decide what the copy above says and when. They are app rules, not legal rules, and no copy presents them as legal rules.

- **When the app asks which boundary the driver passed** (`sameStretchCheck`): the new park is within 30 m of the previous one; or on the same road within 150 m; or the sign reads the same within 300 m; or either sign is an area sign, or the previous stop was still under an area sign's limit (the driver wasn't sure they had left the area), however many moves ago that sign was; or either location is missing, typed in, of unknown accuracy, or worse than 100 m. The distances only decide when to ask. Beyond them the app doesn't ask, and the driver's new sign starts its own limit. The reasons are signed with the leg, so each one is recorded only when it is literally true: when the road name couldn't be looked up, the same-street test simply finds no match.
- **When the app can't tell whether a sign is an area sign** (a reading or record from before the sign reader reported it): a sign whose text names an area counts as an area sign, so the app asks the area question.
- **What keeps the original limit running** (`startsNewLimit`, `legDeadline`): "I'm not sure", no answer, or an answer the question didn't offer. Only a sign showing the zone ended, a yellow edge line, or the end of the road at a T-intersection or dead end starts a new limit. Under an area sign, and on every later stop until the driver says they left the area, only "I drove out of the parking area" does. The new leg can never run past the original deadline in that case: the earliest deadline that applied at the previous stop, which can be that stop's own sign limit when it was shorter than the stretch it continued.
- **Where workday mode works** (`jurisdiction.ts`): Victoria and Queensland only, read from the ISO 3166-2 state code of the reverse geocode of the phone's GPS fix alone, with no fallback. An address the driver typed never sets the state: that leg's state is unknown.
- **Reminder timing** (`workdayReminderSchedule`): go-now allows for at least a 10-minute walk, because reminders are set while the driver is at the car, and never caps a longer walk. When a leg is saved too close to its deadline for go-now's time, go-now fires as soon as it can. The heads-up is still sent when a long walk puts it after go-now. No reminder is planned less than a minute ahead, because the push service drops those.
- **The driver's answer is recorded as the driver's statement**, never as something the app checked (`buildBoundaryStatement`; signed in the leg's arrival context).

### T6b: screens and flow

**Gate, restated.** The owner has no access to a lawyer, so workday mode stays off in production indefinitely. `vite.config.ts` and `package.json` never set `VITE_FEATURE_WORKDAY`. `scripts/deploy.sh` and `scripts/_deploy-staging.sh` set it to `false` on every build unless the shell that runs them sets `DEPLOY_ALLOW_WORKDAY=1`, which must not be used until every key in this section is **Approved**. With the flag off, none of the keys below is shown: no home link, no start screen, no workday card, no workday scan rules, no History grouping (`src/app-workday.test.tsx` renders home and every affected screen with the flag off). `src/lib/features-build.test.ts` checks that a production build reads the flag as off from this checkout's env files and shell, that neither the Vite config nor `package.json` sets it, and that the two deploy scripts assign it only from `DEPLOY_ALLOW_WORKDAY`. `scripts/deploy-scripts.test.mjs` and `scripts/vite-env-precedence.test.mjs` check that a `.env` line can't turn it on.

#### Items 1 to 7 and 10: start, readiness, explainer, card, moving, readable signs, end

Added by `scripts/_i18n_inject_t6bc.mjs` (run it with `--list`; `legal` marks the keys this table says a lawyer must read first, `exact` the spec's own wording, which the script refuses to change). Every key in the table is new except `home.startWorkday` (T4's text, shown by T6b) and the shared lines in the last rows, which the home card and the record screen already show for a normal record. On a workday screen all of them are workday copy: none may be shown there in production before a lawyer has read them.

| Key | Where it shows | English | Status |
|---|---|---|---|
| `home.startWorkday` | Home, under the glass rows (T4 added the text; T6b shows it). Hidden while a workday is active and when the last record is in another state | Parking all day? Start a workday | Not reviewed |
| `workday.start.title` | Start screen title | Start a workday | Not reviewed |
| `workday.start.intro` | Start screen, under the title | For a day of moving the car between time-limited spots. Each stop gets its own record, read from a fresh photo of its sign. | Not reviewed |
| `workday.start.locating` | Start screen, while the GPS fix and the state lookup run | Checking which state you're in… | Not reviewed |
| `workday.start.unavailable` | Start screen, the phone is in another state or territory (no Start button) | Workday mode is available in Victoria and Queensland while we check other states' rules. (spec wording) | Not reviewed |
| `workday.start.unknown` | Start screen, no usable fix or the lookup failed (no Start button; Retry) | ParkProof couldn't work out which state you're in from your phone's location. Workday mode is only available in Victoria and Queensland, so it needs to check first. | Not reviewed |
| `workday.start.button` | Start screen, the Start button when no record is active | Start workday | Not reviewed |
| `workday.start.useCurrent` | Start screen, the only Start button while a record is active (it becomes stop 1) | Use the car's current park as the first stop (spec wording) | Not reviewed |
| `workday.start.useCurrentHelp` | Start screen, under that button | That park keeps the time you logged it and its time limit. Moving a few bays since then doesn't restart that limit, so use it anyway. If the car has left the signed stretch, go back and tap I've left on it first. (reworded in review: it no longer suggests that tapping I've left after a short move gives a fresh limit) | Not reviewed |
| `workday.start.currentIneligible` | Start screen, in place of a Start button when the active park cannot be a stop | Your current park can't be a workday stop. Stops need a readable sign in Victoria or Queensland. Tap I've left on it once the car has left the signed stretch, then start the workday. (reworded in review: the first stop runs on its own sign's limit, so the driver is told to start only after leaving the stretch) | Not reviewed |
| `workday.explainer.heading` | Start screen, explainer heading | How time limits work | Not reviewed |
| `workday.explainer.full` | Start screen, the explainer on the first workday on this device | Moving a few bays doesn't restart the time limit. You need to leave the signed length of road, or the whole area under an area sign. Paying again or topping up doesn't restart the limit either. Each move needs a fresh photo of the new sign. (spec wording) | Not reviewed |
| `workday.explainer.short` | Start screen, the explainer on every later workday | Moving a few bays doesn't restart the time limit. Each move needs a fresh photo of the new sign. | Not reviewed |
| `workday.ready.heading` | Start screen, readiness heading | Reminders | Not reviewed |
| `workday.ready.on` | Start screen, notifications allowed and push available | Notifications are on, so workday reminders can reach this phone while ParkProof is closed. | Not reviewed |
| `workday.ready.ask` | Start screen and home workday card, the browser has not asked for notifications yet: under `workday.ready.cantDeliver`, above the "Turn on notifications" button | Turn on notifications so workday reminders can reach this phone while ParkProof is closed. (reworded in review: it now follows the spec's can't-deliver line) | Not reviewed |
| `workday.ready.allow` | Start screen, the button that asks | Turn on notifications | Not reviewed |
| `workday.ready.cantDeliver` | Start screen and the home card, whenever reminders cannot reach the phone | Workday reminders need notifications. Without them you'll need to watch the time yourself. (spec wording) | Not reviewed |
| `workday.ready.iosInstall` | Under that line on an iPhone browser tab | On iPhone, notifications need ParkProof on your Home Screen. Tap Share, then Add to Home Screen, and start the workday from there. | Not reviewed |
| `workday.ready.denied` | Under that line when notifications are blocked | Notifications are blocked for ParkProof. You can allow them in your browser's site settings. | Not reviewed |
| `workday.ready.turnedOff` | Under that line when notifications were turned off in Settings | Notifications are turned off for ParkProof on this phone. You can turn them on again in Settings. | Not reviewed |
| `workday.ics.button` | Start screen (for the park becoming stop 1) and the home card, when reminders cannot reach the phone | Add calendar reminders for this stop | Not reviewed |
| `workday.ics.title` | Calendar event title for a stop on a signed length of road. The alarms reuse the T6a reminder lines above | Move off this signed stretch by {{time}} | Not reviewed |
| `workday.ics.titleArea` | The same under an area limit | Move the car out of this parking area by {{time}} | Not reviewed |
| `workday.card.kicker` | Home workday card, top line | Workday | Not reviewed |
| `workday.card.stop` | Home workday card and the workday view, each stop | Stop {{number}} | Not reviewed |
| `workday.card.noStops` | Home workday card, before the first stop | No stops yet. Each stop starts with a photo of its sign. | Not reviewed |
| `workday.card.moved` | Home workday card between moves | Stop {{number}} ended at {{time}} (phone clock). | Not reviewed |
| `workday.card.open` | Screen-reader name of the card when it shows no status | Open this workday | Not reviewed |
| `workday.card.openAria` | Screen-reader name of the card | Open this workday. {{status}} | Not reviewed |
| `workday.card.expiredHint` | Home workday card once the stop's limit has passed | Still here? Move now. Already moved? Tap I'm moving the car now. | Not reviewed |
| `workday.card.move` | Home workday card's primary button while parked (opens the departure sheet) | I'm moving the car now (spec wording) | Not reviewed |
| `workday.card.moveHint` | Under that button | Tap before you drive off (spec wording) | Not reviewed |
| `workday.card.scanFirst` | Home workday card's button before the first stop | Parked? Scan the sign where you are | Not reviewed |
| `workday.card.scanNext` | Home workday card's button between moves | Parked again? Scan the new sign (spec wording) | Not reviewed |
| `workday.card.end` | Home workday card, the workday view, the no-readable-sign screen and the end dialog | End workday | Not reviewed |
| `workday.end.title` | Dialog when ending between moves | End this workday? | Not reviewed |
| `workday.end.body` | Dialog body | Your stops stay in History. After this, a park you log is a normal record, and ParkProof won't ask whether you left the signed stretch. | Not reviewed |
| `workday.history.row_one` | History, one row per workday | Workday, {{count}} stop | Not reviewed |
| `workday.history.row_other` | History, one row per workday | Workday, {{count}} stops (spec wording) | Not reviewed |
| `workday.status.active` | History row and workday view | In progress | Not reviewed |
| `workday.status.ended` | History row and workday view | Ended | Not reviewed |
| `workday.view.title` | Workday view title | Workday | Not reviewed |
| `workday.view.started` | Workday view | Started {{time}} (phone clock) | Not reviewed |
| `workday.view.ended` | Workday view | Ended {{time}} (phone clock) | Not reviewed |
| `workday.view.stopsHeading` | Workday view | Stops | Not reviewed |
| `workday.view.noStops` | Workday view | No stops yet. | Not reviewed |
| `workday.view.tagged` | Workday view, on a first stop that was an earlier park | Added to this workday from an earlier park. Its signed details don't mention the workday. | Not reviewed |
| `workday.noSign.body` | No-readable-sign screen during a workday (only Retake photo and End workday) | Workday mode needs a readable sign at each spot. Some areas, like central Brisbane, have time limits even where a street has no sign. (spec wording) | Not reviewed |
| `workday.stopped.notAvailable` | Reminder screen after a stop whose own place puts it in a state other than Victoria or Queensland was saved as a normal record | Workday mode isn't available here yet. This park is saved as a normal record with its own sign reading. (spec wording) | Not reviewed |
| `workday.stopped.unknownState` | Reminder screen after a stop whose state couldn't be told (no GPS fix at Save, a fix too rough to look up, a typed address, a lookup that failed) was saved as a normal record. Not the line above, which would be false in Victoria or Queensland | ParkProof couldn't tell which state this park is in, so the workday has ended. This park is saved as a normal record. If you told us you weren't sure, your original time limit still applies. (added) | Not reviewed |
| `workday.scan.fresh` | Scanner for a stop (camera only) | Workday stop: take a fresh photo of the sign where the car is now. | Not reviewed |
| `workday.scan.cameraDenied` | Scanner for a stop, when the camera was refused | Turn camera access back on in your browser settings. Workday stops need a photo taken now. | Not reviewed |
| `workday.scan.notFresh` | Scanner for a stop, when the camera input handed over a photo that wasn't just taken (a desktop file chooser, an Android chooser's Files or Gallery: the file is more than 2 minutes old) | That photo wasn't taken just now. Workday stops need a photo of the sign taken now. Take a new one with the camera. (added) | Not reviewed |
| `active.moveBy` | Home workday card, under the countdown while the stop's limit hasn't passed (shared with the home card for a normal record). `{{time}}` is the stop's limit. On a workday card it can read as "move to another bay by then", and a move along the same stretch doesn't restart the limit | Move by {{time}} | Not reviewed |
| `active.expiredAt` | Home workday card, the large line and the card's status once the stop's limit has passed (shared with the home card) | Expired at {{time}} | Not reviewed |
| `time.minLeft_one`, `time.minLeft_other`, `time.hoursLeft_one`, `time.hoursLeft_other`, `time.hoursMinsLeft` | Home workday card, the countdown to the stop's limit and the card's status before it passes (`formatCountdownLocalized`, shared with the home card) | 1 min left / {{count}} min left / 1 hour left / {{count}} hours left / {{hours}}h {{mins}}m left | Not reviewed |
| `session.arrived` | Workday view, each stop, and the leg picker, each leg (shared with the record screen) | Logged {{when}} (phone clock) | Not reviewed |

The workday view also shows `departure.tapped` ("You tapped I've left at {{time}} (phone clock).") on each stop that has ended. It is listed under "Signature statements". Approve it there before workday mode ships. The other shared keys the workday screens show are buttons and labels that state nothing about the rules, the record or a time. `src/lib/legal-review-queue.test.ts` lists them, and fails when a workday screen (`src/components/Workday*.tsx`) shows any other key that this section doesn't name.

#### Behaviour to read with the copy (items 1 to 7 and 10, no strings)

- **Where workday mode can start** (`startGateFor`, `WorkdayStart`): a high-accuracy GPS fix (worse than 100 m counts as no fix), then the reverse geocode's ISO 3166-2 state code. Only `AU-VIC` and `AU-QLD` open the gate. No fix, a failed lookup or no code shows `workday.start.unknown` and nothing can start; there is no fallback that can produce Victoria or Queensland. The explainer and the Start button only show once the gate has passed.
- **The home link** (`showStartWorkdayLink`): hidden while a workday is active, and when the driver's most recent own record has a known state that isn't Victoria or Queensland. An unknown state still shows it, because the start screen checks the phone's location itself.
- **A car that hasn't moved never gets a new arrival time** (`firstStopOffer`): while a record is active, the start screen's only way in is "Use the car's current park as the first stop". That record becomes stop 1 as it was logged: tagged on the phone with the workday's id, not re-signed, keeping its logged time and limit. Its signed details therefore don't name the workday, and the workday view says so (`workday.view.tagged`). A park that can't be a stop (no readable sign, a no-sign park, a state other than Victoria or Queensland by its own place, or a stop of another workday) offers no way in until the driver taps I've left on it.
- **Readiness** (`workdayReadiness`): reminders count as deliverable only with web push available, notifications allowed, push not turned off in Settings, and not an iPhone browser tab. Anything else, including notifications not asked for yet, shows the spec's line (`workday.ready.cantDeliver`) and offers the calendar file for the stop, whose alarms are the same three as the push reminders (T6a's schedule: heads-up, go now, at the deadline) with the same text. Not asked yet adds `workday.ready.ask` and the "Turn on notifications" button, on the start screen and on the home card; on the card the tap asks, then books the stop's reminders.
- **The home card** replaces the active card for the whole workday, whether or not the stop's limit has passed. It never offers "Re-check now" (a re-check would log a new arrival for a car that hasn't moved), and the home "Scan another sign" button is hidden. A workday stop shown on the ordinary card (its workday isn't on this device) also never offers "Re-check now".
- **Moving**: "I'm moving the car now" opens the same departure sheet as I've left (the phone's GPS at the old bay, the tap time as the stop's end, signed as a departure). Confirm moves the workday between moves. I've left on the stop's record screen does the same.
- **Every move is a fresh photo of a readable sign**: between moves, every scan is the next stop's. The scanner is camera only (no library, no re-check offers, no "No sign here"), and a file from the camera input that wasn't just taken is refused (`workday.scan.notFresh`); App refuses it again if one gets through. The result screen has Back and no "Scan another"; Back from the scanner, the result or the logger returns home with the workday unchanged. A photo with no readable sign offers only Retake photo and End workday.
- **No second arrival at a stop**: workday stops are never offered for a re-check anywhere (the scanner's "reuse this read" card and recent-scans picker leave them out, whatever the flag says), and nothing is re-checked while a workday is active. While the car is at a stop, the app's other ways into the scanner (About's "Try it", the error screen's "Try again", the first-visit card) go to the workday card instead; between moves they open the next stop's scan.
- **A stop must be in Victoria or Queensland by its own place** (`resolveLegSave`): read from the logger's reverse geocode of its own GPS fix. Another state saves the park as a normal record with its own sign's limit and no workday link, ends the workday, and shows `workday.stopped.notAvailable`. A state that couldn't be told (no fix at Save, a fix worse than 100 m, which is never looked up, a typed address, a lookup that failed or took more than 5 seconds after Save) can't be a stop either, because there is no fallback that can produce Victoria or Queensland, so the workday ends. But the car may not have left the stretch, so that park keeps the limit the logger showed: after "I'm not sure" the running limit (never a fresh one), and the driver's boundary statement, which its arrival context signs. It shows `workday.stopped.unknownState`.
- **End workday**: with the car at a stop, the departure sheet runs first and Confirm ends the stop and the workday. Between moves it asks (`workday.end.*`) and ends the workday; the stops stay in History.

#### Items 8, 9 and 11: the boundary question, a stop's reminders, and the chain between stops

Added by `scripts/_i18n_inject_t6bc.mjs` (`legal` and `exact` in its `--list`). Every key below is new. Marked "(spec wording)": the English is build spec T6b item 8's own text, and the script refuses to write if it drifts. Marked "(added)": a line the spec doesn't give, added so the app never tells a driver under an area sign to leave "this stretch" (r335), or so a line still reads when the running limit has no end time.

| Key | Where it shows | English | Status |
|---|---|---|---|
| `workday.boundary.title` | Logger, the boundary question's title, when a stop may be on the same signed stretch | This may be the same signed stretch. (spec wording) | Not reviewed |
| `workday.boundary.body` | Under the title | Moving bays doesn't restart the time limit. Did you pass one of these on the way here? (spec wording) | Not reviewed |
| `workday.boundary.area` | In place of the title and body under an area sign (area mode) | This is a parking area. Moving to another street inside it doesn't count. You need to leave the whole area. (spec wording) | Not reviewed |
| `workday.boundary.option.oppositeDirectionSign` | Answer (stretch question) | A sign showing this zone had ended (a two-way arrow sign in the middle of the block doesn't count) (spec wording) | Not reviewed |
| `workday.boundary.option.yellowEdgeLine` | Answer (stretch question) | A yellow edge line (spec wording) | Not reviewed |
| `workday.boundary.option.tIntersectionOrDeadEnd` | Answer (stretch question) | The end of the road at a T-intersection or dead end (spec wording) | Not reviewed |
| `workday.boundary.option.leftParkingArea` | Answer (area question) | I drove out of the parking area, past a sign saying it ends (spec wording) | Not reviewed |
| `workday.boundary.option.notSure` | Last answer of both questions; where focus goes when Save is tapped without an answer | I'm not sure (spec wording) | Not reviewed |
| `workday.boundary.footer` | Under the answers, both questions | If you're not sure, your original time limit is still running. (spec wording) | Not reviewed |
| `workday.boundary.required` | Save tapped without an answer | Choose an answer to save this stop. | Not reviewed |
| `workday.boundary.newLimit` | After an answer that names a boundary. `{{boundary}}` is one of the four lines below | New limit based on what you told us: you passed {{boundary}}. (spec wording) | Not reviewed |
| `workday.boundary.passed.oppositeDirectionSign` | `{{boundary}}` above | a sign showing this zone had ended | Not reviewed |
| `workday.boundary.passed.yellowEdgeLine` | `{{boundary}}` above | a yellow edge line | Not reviewed |
| `workday.boundary.passed.tIntersectionOrDeadEnd` | `{{boundary}}` above | the end of the road at a T-intersection or dead end | Not reviewed |
| `workday.boundary.passed.leftParkingArea` | `{{boundary}}` above (area question) | a sign saying the parking area ends | Not reviewed |
| `workday.boundary.notSure` | After "I'm not sure" on a signed stretch. `{{start}}` is the logged time of the stop that started the running limit (a phone time), `{{deadline}}` when that limit ends | Your limit on this stretch still runs from {{start}}. Move the car off this stretch by {{deadline}}. (spec wording) | Not reviewed |
| `workday.boundary.notSureArea` | The same under an area limit | Your limit in this parking area still runs from {{start}}. Move the car out of the whole area by {{deadline}}. (added) | Not reviewed |
| `workday.boundary.notSureNoDeadline` | "I'm not sure" when the running limit has no end time (the stop it continues had no limit time) | Your limit on this stretch still runs from {{start}}. (added) | Not reviewed |
| `workday.boundary.notSureNoDeadlineArea` | The same under an area limit | Your limit in this parking area still runs from {{start}}. (added) | Not reviewed |
| `workday.boundary.passedDeadline` | "I'm not sure" after the running limit has already ended. Save and Cancel give way to the two buttons below | Your time on this stretch ended at {{time}}. Move the car off this stretch now. (spec wording) | Not reviewed |
| `workday.boundary.passedDeadlineArea` | The same under an area limit | Your time in this parking area ended at {{time}}. Move the car out of the whole area now. (added) | Not reviewed |
| `workday.boundary.saveAnyway` | With the line above: saves the stop with the driver's answer | Save anyway (spec wording) | Not reviewed |
| `workday.boundary.dontSave` | With the line above: deletes the stop being logged and its photos; nothing is signed | Don't save this stop (spec wording) | Not reviewed |
| `workday.reminders.notSet` | Home workday card, when a stop's reminders couldn't be set (a Retry button follows) | Reminders for this stop couldn't be set up. Watch the time yourself, or try again. | Not reviewed |

The card's other reminder lines reuse keys already in the app: `reminders.remindMe.setBackground` and `reminders.remindMe.setOpenOnly` (the times booked), and `reminders.reliability` (the reliability line). The reminders themselves are T6a's keys above.

**Open questions for the spec owner.**

- `{{start}}` in `workday.boundary.notSure` is a phone time (when the stop that started the limit was logged). The copy rules label phone times as such, but the spec gives this line word for word, so it ships without "(phone clock)". Please confirm, or add the label.
- The area variants marked "(added)" are not in the spec. Without them, a driver under an area sign would be told to move "off this stretch", which could read as "another street inside the area is fine" (r335).
- Stop 1 always runs on its own sign's limit (T6a's deadline maths has no earlier stop to compare with). A driver who taps I've left, moves a few bays along the same stretch and then starts a workday gets a fresh limit at stop 1. The start screen now steers away from that (`workday.start.useCurrentHelp`, `workday.start.currentIneligible`): use the current park as stop 1, or start only after leaving the signed stretch. The app doesn't check it. Please decide whether stop 1 should also be compared with the driver's last record whose limit is still running, and ask the boundary question when it trips.

#### Behaviour to read with the copy (items 8, 9 and 11, no strings)

- **When the question shows** (`stopBoundaryCheck`, `src/lib/workday-boundary.ts`, on T6a's `sameStretchCheck`): only on a workday stop after the first, never with the flag off. It compares the new stop with the workday's last saved stop. It shows once the phone's GPS fix and its place lookup are in, so it doesn't flash up and vanish while the fix arrives. If Save is tapped while the fix still isn't in, that location counts as unreliable, so the question asks.
- **Nothing is answered for the driver.** No answer is preselected. "I'm not sure" has the focus when the question first shows (focus only, never checked, and not while the driver is typing in a field). Save without an answer doesn't save: it says an answer is needed and moves focus to "I'm not sure" again. The answer is saved, and signed in the stop's arrival context, as the driver's own statement, with the reasons the app asked (`buildBoundaryStatement`). A stop the question didn't ask about is saved as "not asked", with its distance from the previous stop.
- **Which answers start a new limit** (`startsNewLimit`, `legDeadline`): only "a sign showing this zone had ended", "a yellow edge line" or "the end of the road", and under an area sign only "I drove out of the parking area". Every other answer keeps the running limit: the stop's limit is then the earlier of its own sign's and the running one, and the stop is saved with that limit (`stopLimitFields`), so its countdown, its reminders and its signed arrival all use it.
- **The time in the "not sure" and deadline-passed lines** is the stop's saved limit: the running limit's end, or the new sign's own limit when that ends first. So the line, the card's countdown and the reminders always name the same time.
- **When the running limit has already ended** and the answer keeps it: only "Save anyway" (saves the stop with the driver's answer, its limit already passed) or "Don't save this stop" (deletes the stop being logged and its photos; nothing is saved or signed).
- **A stop that isn't one after all**: in a state other than Victoria or Queensland, saved as a normal record with its own sign's limit and no boundary statement (`withoutStopLimit`). With a state that couldn't be told, or past the most stops a workday holds, saved as a normal record that keeps the limit the logger showed and the boundary statement (`stopLimitFields`), so a car that may not have left the stretch never gets a fresh limit.
- **Reminders** (`bookWorkdayLegReminders`, `src/lib/workday-reminders.ts`): workday stops skip the reminder screen. When a stop is saved, or the car's current park becomes the first stop, T6a's three reminders for its limit are set at once (replacing any the record had), in the app and as push notifications, through the same code as "Remind me" (at most 6 per record). A save never asks for notification permission: when notifications aren't allowed nothing is set, and the card shows `workday.ready.cantDeliver` with the calendar file (and, when the browser hasn't asked yet, "Turn on notifications", which asks and then books them). The card lists the times booked, or, whenever none is booked to reach the phone while notifications are allowed (a failed booking, a reload after one, notifications turned on after the stop was saved), `workday.reminders.notSet` with Retry and the calendar file, and always the reliability line. I've left and "I'm moving the car now" cancel them, as for any record. After a reload, the parked stop's in-app reminders are armed again; its push reminders are already booked.
- **The chain between stops** (`previousDepartureStep`, `src/lib/workday-chain.ts`; the signing queue in `src/lib/signing.ts`): a stop's arrival context carries the sha256 of the previous stop's signed departure (`workday.previous_departure_payload_sha256`). It is filled when the arrival context is signed, so the signing queue holds it until that departure is signed, for at most 24 hours, then signs it with null. If the server refused the previous departure, it signs with null at once (the refusal wakes the next stop's signing, as a signed departure does). The stop's arrival (link 0) is never held. This links the stops' signatures; it doesn't show where the car was or when it moved.

### T6c: workday record PDF

Added by `scripts/_i18n_inject_t6bc.mjs` (unit t6c-pdf; `legal` and `exact` in its `--list`). Every key below is new. Marked "(spec wording)": the English is build spec T6c's own text, and the script refuses to write if it drifts. Marked "(added)": a line the spec doesn't give, needed so the PDF reads correctly when legs are left out, when the first leg was an earlier park, or to explain the chain check. The PDF strings (`pdf.workday.*`) are checked against every locale's PDF font (`src/lib/pdf-font-coverage.test.ts`).

#### The leg picker (on screen)

| Key | Where it shows | English | Status |
|---|---|---|---|
| `workday.pdf.open` | Workday view, above the stops: opens the leg picker | Export a PDF of this workday | Not reviewed |
| `workday.pdf.title` | Leg picker (a dialog), title | Workday PDF | Not reviewed |
| `workday.pdf.warning` | Leg picker, under the title, before anything is exported | This PDF includes every leg you choose, with distances between them and what you told us at each move. Councils can read it. (spec wording) | Not reviewed |
| `workday.pdf.chooseLegs` | Leg picker, above the list of legs (every leg starts ticked) | Legs to include | Not reviewed |
| `workday.pdf.leg` | Leg picker, each leg (with its address and "Logged {{when}} (phone clock)") | Leg {{number}} | Not reviewed |
| `workday.pdf.noneChosen` | Leg picker, when every leg is unticked (Export is disabled) | Choose at least one leg to export. | Not reviewed |

The picker's buttons reuse `session.exportAsPdf`, `session.buildingPdf`, `common.cancel`, and `session.pdfErrorHeader` with `session.pdfErrorHelp` when the PDF can't be built.

#### The PDF

| Key | Where it shows | English | Status |
|---|---|---|---|
| `pdf.workday.title` | PDF page 1, the title, and the running header at the top of every later page | Record of parking events. (spec wording) | Not reviewed |
| `pdf.workday.footer` | PDF, the footer of every page | This records what you did and what you told us. It is not a legal finding that you complied. Your council decides that. (spec wording) | Not reviewed |
| `pdf.workday.councilLine` | PDF, in a box at the top of every leg's rule sheet, above its table with the sign's rules | Councils may interpret this rule more strictly. Check your council's parking page. (spec wording) | Not reviewed |
| `pdf.workday.started` | PDF cover, when the workday state is on this device | Workday started {{time}} (phone clock) | Not reviewed |
| `pdf.workday.ended` | PDF cover, when the workday has ended | Workday ended {{time}} (phone clock) | Not reviewed |
| `pdf.workday.legCount` | PDF cover | Legs in this PDF: {{chosen}} of {{total}} | Not reviewed |
| `pdf.workday.partial` | PDF cover, when the picker left legs out | Not every leg of this workday is in this PDF. Each distance and driver's statement is about the leg just before it on the workday, even when that leg is left out. (added) | Not reviewed |
| `pdf.workday.intro` | PDF cover, above the table | Each leg is its own parking record. A section for each leg follows this table, and the signature pages come last. (added) | Not reviewed |
| `pdf.workday.col.leg` | Cover table heading: the leg number | Leg | Not reviewed |
| `pdf.workday.col.arrived` | Cover table heading: when the leg was logged, by the phone | Arrived (phone clock) | Not reviewed |
| `pdf.workday.col.left` | Cover table heading: when the leg's departure was tapped, by the phone | Left (phone clock) | Not reviewed |
| `pdf.workday.col.distance` | Cover table heading: the distance in the leg's signed boundary statement | Approx. distance from previous leg (phone GPS) (spec wording) | Not reviewed |
| `pdf.workday.col.statement` | Cover table heading: the driver's answer at the move | Driver's statement (spec wording) | Not reviewed |
| `pdf.workday.cell.notLeft` | Cover table, Left, when no departure was tapped | Not recorded | Not reviewed |
| `pdf.workday.cell.signedArrival` | Cover table, signing column: link 0's signing time, or why there is none | Arrival: {{value}} | Not reviewed |
| `pdf.workday.cell.signedDeparture` | Cover table, signing column: the departure's signing time, or why there is none | Departure: {{value}} | Not reviewed |
| `pdf.workday.cell.noDistance` | Cover table, distance, when either park had no phone GPS fix | Not measured. It needs a phone GPS fix at both legs. | Not reviewed |
| `pdf.workday.statement.firstLeg` | Cover table, statement, first leg | None. This is the first leg. | Not reviewed |
| `pdf.workday.statement.notAsked` | Cover table, statement, when the app didn't ask (the parks were not close, same road or same sign text, and both fixes were good) | Not asked. ParkProof didn't ask about this move. | Not reviewed |
| `pdf.workday.statement.oppositeDirectionSign` | Cover table, statement, for that answer | The driver said they passed a sign showing this zone had ended. | Not reviewed |
| `pdf.workday.statement.yellowEdgeLine` | Cover table, statement, for that answer | The driver said they passed a yellow edge line. | Not reviewed |
| `pdf.workday.statement.tIntersectionOrDeadEnd` | Cover table, statement, for that answer | The driver said they passed the end of the road at a T-intersection or dead end. | Not reviewed |
| `pdf.workday.statement.leftParkingArea` | Cover table, statement, for that answer (area question) | The driver said they drove out of the parking area, past a sign saying it ends. | Not reviewed |
| `pdf.workday.statement.notSure` | Cover table, statement, "I'm not sure" to the stretch question | Asked whether they had left the signed stretch, the driver answered: I'm not sure. | Not reviewed |
| `pdf.workday.statement.notSureArea` | Cover table, statement, "I'm not sure" to the area question | Asked whether they had left the parking area, the driver answered: I'm not sure. (added) | Not reviewed |
| `pdf.workday.legHeading` | Each leg's section heading, and the subtitle of its signature pages | Leg {{number}} | Not reviewed |
| `pdf.workday.tagged` | A leg that was an earlier park made the first stop | This leg was an earlier park added to the workday. Its signed details don't mention the workday. (added) | Not reviewed |
| `pdf.workday.chain.heading` | The last page: checking the chain between legs | The chain between legs (added) | Not reviewed |
| `pdf.workday.chain.intro` | Under that heading | Each leg's details at parking carry previous_departure_payload_sha256, the SHA-256 of the signed departure payload of the leg before it, when that departure was signed in time. Save each leg's files from its signature pages in a folder of its own (leg1, leg2 and so on) and decode them as in its steps. Then run the command shown for each pair. (added) | Not reviewed |
| `pdf.workday.chain.equals` | Under each `openssl dgst -sha256 leg1/link2-payload.txt` command | That hex value must equal previous_departure_payload_sha256 in leg {{leg}}, link {{link}}. (added) | Not reviewed |
| `pdf.workday.chain.equalsOneOf` | The same, when the previous departure was added from two devices | One of these hex values must equal previous_departure_payload_sha256 in leg {{leg}}, link {{link}}. (added) | Not reviewed |
| `pdf.workday.chain.notLinked` | A leg whose details at parking were signed without the previous leg's departure | Leg {{leg}}, link {{link}} was signed without a departure of the leg before it, because none was signed in time. There is nothing to compare here. (added) | Not reviewed |
| `pdf.workday.chain.notInPdf` | A leg whose previous leg's signed departure isn't in this PDF | Leg {{leg}}, link {{link}} names a signed departure of the leg before it that isn't in this PDF. (added) | Not reviewed |

The PDF also prints shared keys a lawyer should read in this context: the signing column heading is `pdf.signature.signedAt` ("Signed by ParkProof (server clock)"), the address heading `pdf.evidence.field.address`, the closing statement on the cover `pdf.evidence.statement` ("This is a record of a parking event made with ParkProof. Times marked as phone times come from the driver's phone. Statements marked as the driver's are the driver's own. It is not a legal finding about what happened. The council or court decides that."), and the signing marks `pdf.evidence.value.notSignedYet`, `pdf.evidence.value.partRejected` and `pdf.evidence.value.notSigned`. Each leg's section is the same record table, photos and signature pages as every record PDF (T1b to T7).

#### Behaviour to read with the copy (T6c, no strings)

- **Only behind the flag.** The export button is on the workday view only, which App shows only with `VITE_FEATURE_WORKDAY` on, and the button itself renders nothing with it off. `downloadWorkdayPdf` (`src/lib/pdf-workday.ts`) checks the flag again and draws and saves nothing when it is off (`src/lib/pdf-workday.test.ts`, `src/components/workday-pdf-export.test.tsx`, `src/app-workday.test.tsx`).
- **The warning comes first.** Nothing is exported from the workday view itself: the button opens the picker, which shows `workday.pdf.warning` above the list. Every leg starts ticked; the PDF holds only the legs left ticked, in leg order, and never a leg of another workday or a shared copy.
- **What the cover table says, and where it comes from.** Arrived is the time the leg was logged and Left the time its departure was tapped ("I'm moving the car now", I've left or End workday), both by the phone's clock, as the labels say. The signing column is ParkProof's server time for each part, or "Not signed yet" and its siblings. The distance and the driver's statement come from the leg's boundary statement as signed in its details at parking (N2), marked "(not signed yet)" until then. The statement is worded as the driver's own answer; the PDF never says the app checked it, or whether a new limit started.
- **The council line** is on every leg's rule sheet, in a box above the table that holds that leg's sign rules.
- **Never printed:** permit details or the permit salt (N3). The signed details carry only the permit commitment, a hash, as in every record PDF.
- **The chain between legs** is checked with `openssl dgst -sha256` on the previous leg's signed departure payload, saved in a folder per leg (`leg1/link2-payload.txt`), against `previous_departure_payload_sha256` in the next leg's details at parking. It links the signatures; it doesn't show where the car was or when it moved.

**Open questions for the spec owner.**

- The spec calls them legs ("every leg you choose", "previous leg"); the workday screens call them stops. The PDF and the picker say "Leg" in English to match the spec's exact wording; the other 8 locales use their word for a workday stop, so the two never read as different things. Please confirm "leg", or ask for "stop" throughout (that changes two spec-wording strings).
- "Arrived (phone clock)" is the time the leg was logged, which the account export calls "Logged (phone clock)". The spec lists the column as "arrived (phone clock)". Please confirm, or ask for "Logged".

## Signature statements (T0a to T3)

**Why it needs a lawyer.** These lines say what a ParkProof signature shows, on screen, in every PDF and in the evidence file, and which times come from the phone and which from ParkProof's server. Every one follows the build spec's copy rules: a signature shows that the signed details existed, unchanged, by the signed time. It doesn't show they are true, who was driving, where the car was, or when it arrived or left. Phone times are labelled as phone times and never called signed. Driver statements are worded as the driver's own. A reader who finds a line that claims more than that should ask for it to change.

Added or rewritten by `scripts/_i18n_inject_t0a.mjs`, `_t1a.mjs`, `_t1b.mjs`, `_t2.mjs` and `_t3.mjs` (`legal` in their `--list`), then by the copy pass (`scripts/_i18n_inject_copy_pass.mjs`) and, in the other 8 locales, the T10 translation review (`scripts/_i18n_inject_t10_review.mjs`, which runs last). The T0a to T1b scripts must never be re-run: their text predates the language review in `b8c88eb`. The verifier's lines (`verifier.*`, from T0b3) and the photo-not-on-device lines (T0b2) aren't marked `legal` by their scripts, but they say what a check found, so they are listed here too. The signed seal's label (`common.signedSeal`) is in the privacy section's first table.

### Ending a record (T0a)

| Key | Where it shows | English | Status |
|---|---|---|---|
| `active.iveLeftConfirm` | Departure sheet opened from the home card's I've left, when the tap is before the record's limit | Mark this record as ended now? It saves the time you tap, from your phone's clock. If you left earlier, that earlier time isn't recorded. | Not reviewed |
| `session.endConfirm` | Departure sheet opened from the record screen's I've left, when the tap is before the record's limit | Mark this record as ended now? It saves the time you tap, from your phone's clock. If you left earlier, that earlier time isn't recorded. | Not reviewed |
| `session.endConfirmLate` | Departure sheet, from either screen, when the tap is after the record's limit (or more than 12 hours after a park with no limit was logged) | Mark this record as ended now? It will record {{time}}, the time you tap, from your phone's clock. It won't show when the car actually left. | Not reviewed |
| `pdf.evidence.field.endedAt` | PDF record table: the I've left tap | Tapped I've left (phone clock) | Not reviewed |
| `pdf.evidence.field.actualDuration` | PDF record table, after an I've left tap | Time from arrival to the I've left tap (phone clock) | Not reviewed |

### The signed parts on the record screen (T1a)

| Key | Where it shows | English | Status |
|---|---|---|---|
| `chain.intro` | Record screen, the signed parts panel, under its heading | ParkProof's server signs each part when it receives it. A valid signature shows the signed details haven't changed since then. It doesn't show they are true, who was driving, where the car was, or when it arrived or left. | Not reviewed |
| `chain.covers.arrival` | Signed parts panel: what the arrival (link 0) covers, on a record with a sign reading | The time and place you logged on your phone, the sign reading and the photo fingerprints. | Not reviewed |
| `chain.covers.arrivalNoSign` | The same, on a park logged without a sign | The time and place you logged on your phone, and the photo fingerprints. | Not reviewed |
| `chain.covers.arrivalContext` | Signed parts panel: what the details at parking (link 1) cover | What you added when you parked, such as who you said was driving, your answers and photo fingerprints. | Not reviewed |
| `chain.covers.condition` | Signed parts panel: what a part with condition photos covers | Fingerprints of your photos of the car's condition, and your note. | Not reviewed |
| `chain.covers.compliance` | Signed parts panel: what a proof of payment or permit part covers | The fingerprint of your photo of a meter ticket, payment confirmation or permit. | Not reviewed |
| `chain.covers.departure` | Signed parts panel: what the departure covers | When you tapped I've left (phone clock), and where your phone was if a location was captured. | Not reviewed |
| `chain.covers.handover` | Signed parts panel: what a handover covers | Who you said you handed the car to, and when you recorded it. | Not reviewed |
| `chain.signedAt` | Each signed part's signing time (the panel, the departure row and each signed photo) | Signed by ParkProof at {{time}}. | Not reviewed |
| `chain.checkValid_one` | After Check signatures, when every part and every photo on this device checks out | {{count}} signature is valid. The signed details haven't changed since ParkProof signed them. That doesn't show they're true. | Not reviewed |
| `chain.checkValid_other` | The same, more than one part | All {{count}} signatures are valid. The signed details haven't changed since ParkProof signed them. That doesn't show they're true. | Not reviewed |
| `chain.checkValidPhotosUnchecked_one` | After Check signatures, when every part checks out but some photos aren't on this device | {{count}} signature is valid. Some photos aren't on this device, so they couldn't be compared with their fingerprints. That doesn't show what the record says is true. | Not reviewed |
| `chain.checkValidPhotosUnchecked_other` | The same, more than one part | All {{count}} signatures are valid. Some photos aren't on this device, so they couldn't be compared with their fingerprints. That doesn't show what the record says is true. | Not reviewed |
| `departure.tapped` | Record screen, the departure row (and each stop in the workday view) | You tapped I've left at {{time}} (phone clock). | Not reviewed |
| `departure.far` | Departure row, when the phone was more than 150 m from where the car was logged, after taking off both fixes' stated accuracy | Your phone was {{distance}} from where you parked when you tapped I've left. The record shows when you tapped, not when the car moved. | Not reviewed |
| `departure.notSigned` | Departure row, when the departure was never signed | This departure isn't signed. | Not reviewed |
| `about.sealCaveat` | About screen, and the record screen's signature panel | The seal shows the signed details existed, unchanged, by the time ParkProof signed them. It doesn't show they're true, that the AI read the sign correctly, who was driving, where the car was, or when it arrived or left. | Not reviewed |
| `about.evidence.items[1]` | About screen, the evidence list | Each record is signed, so anyone can check its signed details haven't changed since ParkProof signed them. | Not reviewed |

### What a signature check found (T0b3, T0b2)

| Key | Where it shows | English | Status |
|---|---|---|---|
| `verifier.link.valid` | Signed parts panel, per part, after Check signatures | Signature valid. The signed details haven't changed since ParkProof signed them. | Not reviewed |
| `verifier.link.invalid` | The same, a part whose signature fails | Signature not valid. This part isn't what ParkProof signed for this record. | Not reviewed |
| `verifier.link.pending` | Wherever a part has no signature yet (panel, departure row, photos) | Not signed yet | Not reviewed |
| `verifier.link.rejected` | Wherever ParkProof's server refused to sign a part | This part couldn't be signed | Not reviewed |
| `verifier.link.devKey` | A part signed by the local development server's key | Signed with a development key. It can't be checked with ParkProof's published key. | Not reviewed |
| `session.devKeySigned` | Record screen and History, a record signed with a development key | Signed with a development key. It can't be checked with ParkProof's published key. | Not reviewed |
| `verifier.link.chainBroken` | After Check signatures, a part whose parent part is missing or doesn't match | Its place in the record can't be checked. The part signed before it is missing from this device or doesn't match. | Not reviewed |
| `verifier.fork` | Signed parts panel, when two devices signed a part at the same place in the chain | Added from two devices | Not reviewed |
| `verifier.photo.matches` | After Check signatures, per photo | This photo matches its signed fingerprint. | Not reviewed |
| `verifier.photo.differs` | The same, a photo whose bytes don't match its signed fingerprint | This isn't the photo that was signed. Its fingerprint doesn't match. | Not reviewed |
| `session.photoNotOnDevice` | In place of a photo whose bytes aren't on this device | Photo not on this device. Signed fingerprint {{fingerprint}}. | Not reviewed |
| `session.photoNotOnDeviceUnsigned` | The same, before the photo's part is signed | Photo not on this device. Fingerprint {{fingerprint}}. Not signed yet. | Not reviewed |
| `verifier.photo.notOnDeviceDevKey` | The same, when the part was signed with a development key | Photo not on this device. Fingerprint {{fingerprint}}. Signed with a development key. | Not reviewed |

### Photos, proof of payment and the evidence file (T2)

| Key | Where it shows | English | Status |
|---|---|---|---|
| `photoGrid.signedNote` | Condition photo grid (logger, after saving, departure sheet) and each signed condition photo | A signed photo shows the photo existed by the time it was signed. It doesn't show who caused any damage. | Not reviewed |
| `evidence.addIntro` | The sheet for adding condition photos or a proof photo after saving | ParkProof signs each photo's fingerprint as a new part of this record. The photos themselves aren't sent for signing. | Not reviewed |
| `evidence.addedAt` | Under each added photo on the record screen | Added at {{time}} (phone clock). | Not reviewed |
| `evidence.library` | Under a photo that came from the photo library (or a file more than 2 minutes old) | Added from the photo library. The signature shows the photo existed by ParkProof's signing time, not when it was taken. | Not reviewed |
| `evidence.notSigned` | Under a photo whose part isn't signed | This photo isn't in a signed part of the record. | Not reviewed |
| `evidence.noteLabel` | Record screen, the label above a condition note | Damage you noticed, in your own words | Not reviewed |
| `evidence.noteNotSigned` | Under that note when its part isn't signed | This note isn't in a signed part of the record. | Not reviewed |
| `evidence.complianceDescribed` | The proof photo's type on the record screen (the type the driver picked) | {{type}} (as you described it) | Not reviewed |
| `evidenceFile.help` | Record screen, above Download evidence file | A .json file with every signature and the original photos, so anyone can check this record without ParkProof. A signature shows the details haven't changed since ParkProof signed them. It doesn't show they're true, who was driving, where the car was, or when it arrived or left. The file contains the location and times saved in this record, so share it only with people who need it. | Not reviewed |
| `evidenceFile.permitHelp` | Under Include permit details | Your permit details, and any photo marked "Permit displayed", are only in the file if you tick this. The signed record holds only their fingerprints, which they can be checked against. Accessible permit details are health information. | Not reviewed |
| `evidenceFile.photosMissing_one` | After the file is made, when a signed photo isn't on this device | {{count}} signed photo isn't on this device, so it isn't in the file. Its signed fingerprint is. | Not reviewed |
| `evidenceFile.photosMissing_other` | The same, more than one | {{count}} signed photos aren't on this device, so they aren't in the file. Their signed fingerprints are. | Not reviewed |
| `evidenceFile.photosDiffer_one` | After the file is made, when a photo doesn't match its signed fingerprint | {{count}} photo on this device doesn't match its signed fingerprint, so it isn't in the file. Its signed fingerprint is. | Not reviewed |
| `evidenceFile.photosDiffer_other` | The same, more than one | {{count}} photos on this device don't match their signed fingerprints, so they aren't in the file. Their signed fingerprints are. | Not reviewed |
| `backupPrompt.body` | The one-time prompt after the first signed photo | Your records and their signed photos are kept only in this browser. Safari can clear a site's data after 7 days without a visit. | Not reviewed |
| `backupPrompt.homeScreenIos` | The same prompt on an iPhone browser tab | Add ParkProof to your Home Screen: tap Share, then Add to Home Screen. Records you save from the Home Screen app stay with the app. Records already saved in Safari stay in Safari and don't move to the app. | Not reviewed |

### Unclear signs (T3)

| Key | Where it shows | English | Status |
|---|---|---|---|
| `unclearSign.strictest` | Result screen, when the sign is partly obscured or contradictory | The answer above uses the most restrictive reading. Check the sign yourself before you leave the car. | Not reviewed |
| `unclearSign.noSignBody` | The no-readable-sign screen (missing, or not a parking sign) | We couldn't find a readable parking sign in this photo. That doesn't mean there are no rules here. General road rules still apply, such as no parking within 10 metres of an intersection without traffic lights, and some areas have time limits without a sign on every street. | Not reviewed |
| `unclearSign.loggerBanner` | Logger, when the driver logs without a sign from that screen | The record will say ParkProof found no readable parking sign in your photo and you logged this park without one. It doesn't show there was no sign here. | Not reviewed |
| `unclearSign.photoCaption` | Caption of that photo in the logger and on the record screen | Photo taken where you parked. ParkProof found no readable parking sign in it. | Not reviewed |
| `unclearSign.recordNoSignRead` | Record screen, the rules section of such a record | No sign read. ParkProof found no readable parking sign in the photo, and you logged this park without one. | Not reviewed |

### The PDFs (T1b, T2, T3)

| Key | Where it shows | English | Status |
|---|---|---|---|
| `pdf.evidence.statement` | Every record PDF, the closing statement (also the workday PDF's cover) | This is a record of a parking event made with ParkProof. Times marked as phone times come from the driver's phone. Statements marked as the driver's are the driver's own. It is not a legal finding about what happened. The council or court decides that. | Not reviewed |
| `pdf.signature.intro` | Every PDF's signature pages, the opening paragraph | Each part of this record was signed by ParkProof's server when the server received it, at the signed_at time shown for that part. A valid signature shows the signed details and photo fingerprints have not changed since then. It does not show that they are true, who was driving, where the car was, or when the car arrived or left. | Not reviewed |
| `pdf.signature.signedAt` | Signature pages, each part's signing time (also the workday PDF's signing column) | Signed by ParkProof (server clock) | Not reviewed |
| `pdf.signature.verifyStep6` | Signature pages, the openssl steps | 6. Expect "Verified OK". This shows the signed bytes have not changed since ParkProof signed them. | Not reviewed |
| `pdf.signature.verifyStep7` | Signature pages, the photo step | 7. About the photos: the images printed in this PDF are copies, re-encoded for the document, so their bytes differ from the originals and won't match the signed fingerprints. That is expected and isn't a sign of tampering. The signed payloads carry the SHA-256 of each original photo: sign_photo_sha256, car_photo_sha256 and ambient_photo_sha256 in link 0, and each sha256 under photos, photo or return_photos in later links. The originals are in the record's evidence file, a .json file the driver can download from the record in ParkProof. To check a photo, save its bytes_base64 value from that file as photo1.b64, then decode it and print its SHA-256: | Not reviewed |
| `pdf.signature.verifyPhotoMatch` | Signature pages, after the photo hash command | The hex value must equal that photo's sha256 inside a signed payload above, not just the sha256 next to it in the evidence file, which isn't signed. Step 6 showed the signed values have not changed since ParkProof signed them. Do the same for each photo. | Not reviewed |
| `pdf.fullExport.intro` | Account export PDF, the opening paragraph | This document gathers every parking record saved to this ParkProof account, one section per record. Where a record has signed parts, its signature pages follow its section, with the steps to check each signature. A valid signature shows the signed details haven't changed since ParkProof signed them. It doesn't show that they are true, who was driving, where the car was, or when the car arrived or left. | Not reviewed |
| `pdf.evidence.field.arrivedAt` | PDF record table: when the park was logged | Logged (phone clock) | Not reviewed |
| `pdf.evidence.field.arrivalSigned` | PDF record table: when ParkProof signed the arrival | Arrival signed by ParkProof (server clock) | Not reviewed |
| `pdf.evidence.field.departureSigned` | PDF record table: when ParkProof signed the departure | Departure signed by ParkProof (server clock) | Not reviewed |
| `pdf.evidence.field.departureLocation` | PDF record table: the phone's fix at the I've left tap | Phone location at the I've left tap (GPS) | Not reviewed |
| `pdf.evidence.field.departureDistance` | PDF record table: distance between the arrival and the I've left tap | Approx. distance from arrival (phone GPS) | Not reviewed |
| `pdf.evidence.value.distanceRough` | Its value, when the tap's fix was rough | {{distance}}. The phone's location at the tap was only accurate to {{accuracy}}, so this distance is rough. | Not reviewed |
| `pdf.evidence.value.distanceRoughNoAccuracy` | Its value, when the phone gave no accuracy for the tap's fix | {{distance}}. The phone didn't report how accurate its location at the tap was, so this distance is rough. | Not reviewed |
| `pdf.evidence.value.distanceUnavailable` | Its value, when the arrival wasn't a usable phone GPS fix | Not available. The arrival location isn't a phone GPS fix accurate enough to compare. | Not reviewed |
| `pdf.evidence.gpsNoticeBody` | PDF, a box under the location when the arrival fix was coarse | The GPS reading at capture time was {{accuracy}}, wider than typical for evidence purposes. The coordinates above identify a point within that radius, not an exact spot. Common causes: indoor / multi-storey carparks, Starlink or VPN connections, or weak satellite signal. Reviewers should weight the captured address against this radius. | Not reviewed |
| `pdf.evidence.noSignRules` | PDF rules section of a park logged without a sign | No sign was read for this record. The driver said there were no parking signs at this spot. | Not reviewed |
| `pdf.evidence.noSignRead` | PDF rules section of a park logged without a sign after ParkProof found no readable sign | No sign read. ParkProof found no readable parking sign in the photo, and the driver logged this park without one. | Not reviewed |
| `pdf.evidence.ambientPhotoCaption` | PDF, under the surroundings photo of a park logged without a sign | Taken by the driver when the record was logged, to show the surroundings. It doesn't show there was no sign nearby. | Not reviewed |
| `pdf.evidence.driverNoteUnsigned` | PDF, under the driver's note | Added by the driver. This note is not covered by the cryptographic signature. | Not reviewed |
| `pdf.evidence.value.complianceDescribed` | PDF record table: the proof photo's type | {{type}} (as the driver described it) | Not reviewed |
| `pdf.evidence.value.noteWhenParked` | PDF record table: the condition note made when parking | When parked, in the driver's own words: {{note}} | Not reviewed |
| `pdf.evidence.value.noteOnReturn` | PDF record table: the condition note made on return | On return, in the driver's own words: {{note}} | Not reviewed |
| `pdf.photos.added` | PDF, each photo's caption: when it was added | Added {{time}} (phone clock) | Not reviewed |
| `pdf.photos.library` | PDF, caption of a photo from the photo library | Added from the photo library. The signature shows the photo existed by ParkProof's signing time, not when it was taken. | Not reviewed |
| `pdf.photos.signedAt` | PDF, each photo's caption: when its fingerprint was signed | Fingerprint signed by ParkProof at {{time}} (server clock) | Not reviewed |
| `pdf.photos.signedNote` | PDF, under the condition photos | A signed photo shows the photo existed by the time it was signed. It doesn't show who caused any damage. | Not reviewed |
| `pdf.evidence.value.notSignedYet` | PDF, a value whose part is waiting to be signed | (not signed yet) | Not reviewed |
| `pdf.evidence.value.partRejected` | PDF, a value whose part ParkProof's server refused to sign | (this part couldn't be signed) | Not reviewed |
| `pdf.evidence.value.notSigned` | PDF, a value that was never signed | (not signed) | Not reviewed |

### Behaviour to read with the copy (signatures, no strings)

- **What is signed** (`lambda/index.js`, `lambda/addendum-schema.js`, build spec N2): link 0 is the arrival (`parkproof-evidence-v1` on old records, `parkproof-evidence-v2` on new ones: the logged time and place, the sign reading and the photo fingerprints). Each later part is a `parkproof-addendum-v1` link that names the hash of the part before it: the details at parking (always link 1 on a new record), condition photos, a proof of payment or permit photo, the departure, a handover. ParkProof's server signs each part with the KMS key when it receives it and stamps its own time (`signed_at`). Photos are never sent: only their SHA-256 fingerprints.
- **The server refuses, never repairs.** A part with a missing or unknown field, a string with control characters, or a phone time more than 5 minutes after the server's clock is refused with an ERR code (HTTP 400). The phone marks it "This part couldn't be signed" and never retries it.
- **Signed values are read from the signed payload.** The record screen, the PDFs and the notice comparison show the signed value parsed from each part's payload. Anything not signed yet says so ("Not signed yet", "(not signed yet)").
- **Phone times and server times are never mixed.** The I've left tap, the logged time and each photo's capture time are the phone's clock and are labelled that way. Only `signed_at` is ParkProof's, labelled "Signed by ParkProof" or "(server clock)".
- **Permit details are never signed in plain text** (N3). The details at parking carry only `permit_commitment`, a hash of a random salt and the permit details. The evidence file and the PDF reveal the details and the salt only when the driver ticks "Include permit details".
- **The development key.** `npm run dev` signs with a key made when the dev server starts (`key_alias: 'dev-ephemeral'`). The app and the verifier never call such a part valid: it shows `verifier.link.devKey`, and in production builds a share link signed with it reads as changed.
- **The verifier** (`src/lib/verify.ts`) checks each part's ECDSA P-256 signature against the published public key, the chain (session id, sequence, parent hash, chain key hash) and every photo whose bytes are on the device. A photo that isn't on the device is reported as not checkable, never as valid.

---

## Permits (T4)

**Why it needs a lawyer.** Accessible parking permit status is health information (build spec N3). These lines decide what a driver is told about using a permit, and they must never suggest ParkProof worked out a concession: the answer card is always the sign's standard answer, a permit answer is only what the sign itself prints, and a later permit time is only one the driver read off the sign and typed in. No line may tell a driver they can use an accessible bay without the permit holder.

Added by `scripts/_i18n_inject_t4.mjs` (`legal` in its `--list`). Its privacy keys are in the privacy section.

### Settings

| Key | Where it shows | English | Status |
|---|---|---|---|
| `prefs.permitsIntro` | Settings, My permits, under the heading | Saved permits are sent with each sign you scan or re-check, so the answer can include what the sign says about them. Only the permit type is sent, plus the area or zone of a resident or business permit. | Not reviewed |
| `prefs.accessibleWarning` | Settings, before an accessible parking permit is saved ("Save this permit" confirms it) | Saving this permit means its type is sent with each sign photo you scan, so the answer can include what the sign says about permits. Accessible permit details are health information. You can delete them any time. | Not reviewed |

### The result screen

| Key | Where it shows | English | Status |
|---|---|---|---|
| `result.permit.areaMatch` | A saved resident or business permit whose area matches the permit zone the sign names (a plain comparison of the two labels, done in the app) | Your saved permit for {{area}} matches this zone. | Not reviewed |
| `result.permit.areaMismatch` | The same, when the labels don't match | Your saved permit is for {{area}}. This zone is Permit Area {{zone}}. | Not reviewed |
| `result.permit.accessibleQuestion` | The accessible bay question, when an accessible permit is saved | The permit holder is in the car with me and getting out here, and their permit is displayed. | Not reviewed |
| `result.permit.accessibleNo` | After No to that question | Then the permit can't be used for this park. Don't park in the accessible bay. | Not reviewed |
| `result.permit.forThisCarQuestion` | The question for a saved resident or business permit in a permit zone | Is this permit for this car, and displayed or registered to it? | Not reviewed |
| `result.permit.forThisCarNo` | After No to that question in a permit zone | Then the permit can't be used for this park. Don't park in this permit zone without a valid permit for it. | Not reviewed |
| `result.permit.noStandardApplies` | After No to either question, when the sign prints an exception for that permit: only the standard answer applies | Then the permit can't be used for this park. Only the standard answer applies. | Not reviewed |
| `result.permit.checkConditions` | Under the permit answer the sign prints | ParkProof only reads what the sign prints. Check the conditions on your permit too. | Not reviewed |
| `result.permit.timeHint` | Under the field for a later permit time the driver reads off the sign | Read it from the sign. ParkProof doesn't work out permit times. | Not reviewed |
| `result.permit.mayAllowMore` | A saved permit, and the sign prints nothing for it, with the state known | Your permit may allow more time under {{state}} rules. ParkProof doesn't calculate that. Check the conditions on your permit or with your council. | Not reviewed |
| `result.permit.mayAllowMoreNoState` | The same, when the state isn't known | Your permit may allow more time under the rules where you've parked. ParkProof doesn't calculate that. Check the conditions on your permit or with your council. | Not reviewed |

### Reminders on a record that used a permit

| Key | Where it shows | English | Status |
|---|---|---|---|
| `reminders.permitStandardEnds` | Reminder at the sign's standard limit, when the driver entered a later permit time (push, in-app and the calendar file) | The standard limit on this sign ends now. Your permit time runs to {{time}}. | Not reviewed |
| `reminders.permitBodyBefore_one` | Reminder before that permit time | The permit time you entered from the sign ends at {{time}}. This is your {{count}}-minute reminder. | Not reviewed |
| `reminders.permitBodyBefore_other` | The same, plural form | The permit time you entered from the sign ends at {{time}}. This is your {{count}}-minute reminder. | Not reviewed |
| `reminders.permitBodyAt` | Reminder at that permit time | The permit time you entered from the sign ends at {{time}}. Time to move the car. | Not reviewed |
| `reminders.calendarPermitSummary` | Calendar file description for such a record | The permit time you entered from the sign ends at {{time}}. ParkProof doesn't work out permit times. | Not reviewed |

### Behaviour to read with the copy (T4, no strings)

- **What is sent with a scan** (`src/lib/profile.ts`, `lambda/sign-reading.js`): at most 3 saved permits, each as its type (`accessible`, `resident` or `business`), plus the area or zone label of a resident or business permit, and only while the permit hasn't expired. Never the issuing state, the expiry or the driver's name. The Lambda never logs them.
- **What the sign reader may say** (`lambda/index.js`, PERMIT EXCEPTIONS): only whether the sign itself prints an exception for one of the listed types, quoting the sign. It never works out a concession from state law or council policy.
- **What the app works out itself** (`src/lib/permit-answer.ts`): the area match is a plain comparison of the two labels (case, punctuation, leading zeros and words such as Area, Zone and Permit are ignored). Nothing ticks a gate: the driver answers every question. After "No", the permit isn't used and the standard answer stands.
- **What a saved record keeps**: `permit_context` (type, area, the holder-present answer for an accessible permit, whether the sign prints an exception, the standard and permit end times, a note) and `permit_salt`, on the phone and in the driver's own cloud copy when signed in. Only `permit_commitment` is signed.
- **What the feedback log holds**: the driver's yes or no to the accessible permit question (`disabled_permit_acknowledged`), with the sign's accessible bay flag. See the privacy section: N3 allows a `permit_used` boolean at most, and keeping this field is an open decision for the owner.

---

## Weekly reminders (T5)

**Why it needs a reader.** Street sweeping and other weekly reminders come from the driver's own entries, or from a sign the model read. The copy must never present a council's schedule as certain, and every reminder feature carries the reliability line. The weekly push privacy text is in the privacy section.

Added by `scripts/_i18n_inject_t5.mjs` (`legal` in its `--list`); the reliability line predates T5 and every reminder feature reuses it.

### The weekly reminder copy

| Key | Where it shows | English | Status |
|---|---|---|---|
| `recurring.councilNote` | Weekly reminders list and editor, the offer after a scan that found a weekly restriction, and the calendar file | Councils change these schedules, and public holidays may be different. Check the signs where you park. | Not reviewed |
| `reminders.reliability` | Every reminder feature: the reminder screen after saving, a record's scheduled reminders, the weekly reminders list, editor and offer, Settings (notifications), About, the workday start screen and card, and the calendar files | Reminders can be delayed or silenced, for example by Focus or battery saving. Don't rely on them alone. | Not reviewed |

---

## Sharing the record (T7)

**Why it needs a lawyer.** A share link hands a signed arrival to anyone it reaches, together with what the sender says (who was driving, when they left). The copy must keep the signed details apart from the sender's say-so, say what a signature does and doesn't show, never word a driver name as checked, and say plainly that a link can't be switched off.

### T7 items 1 to 4: driver line, share link, receive view, shared copies

Added by `scripts/_i18n_inject_t7.mjs` (run it with `--list` to print every key; `legal` marks these). The en text of `share.confirm`, `share.banner`, `share.tampered` and `share.unsignedHeading` is the spec's wording.

| Key | Where it shows | English | Status |
|---|---|---|---|
| `logger.driver.help` | Under "Who's driving?" in the logger | Saved with this record. ParkProof doesn't check it. | Not reviewed |
| `share.confirm` | On the share sheet, before any link is made | Anyone with this link can see where the car is parked, who parked it and until when. It works for anyone it's forwarded to, and you can't switch it off. | Not reviewed |
| `share.permitSafeguard` | On the share sheet when the park used an accessible parking permit (item 6; the handover screen will reuse it) | This park used an accessible parking permit. If the permit holder won't be in the car, take the permit off the dash before anyone drives it. | Not reviewed |
| `share.banner` | Top of a shared record (receive view and the stored copy) | Shared by {{driver}} at {{time}}. This is a snapshot and doesn't update. The car may have moved. | Not reviewed |
| `share.bannerNoDriver` | Same, when the sender named no driver | Shared at {{time}}. This is a snapshot and doesn't update. The car may have moved. | Not reviewed |
| `share.bannerNoTime` | Same, on a stored copy without a readable share time | This is a snapshot and doesn't update. The car may have moved. | Not reviewed |
| `share.signedNote` | Above the signed details of a shared record | ParkProof signed these details at {{time}}. The signature shows they haven't changed since then. It doesn't show they are true, who was driving, where the car was, or when it arrived or left. | Not reviewed |
| `share.signedNoteNoTime` | Same, when the signing time can't be read | The signature shows these details haven't changed since ParkProof signed them. It doesn't show they are true, who was driving, where the car was, or when it arrived or left. | Not reviewed |
| `share.field.limitRecorded` | Label of the signed limit when the link also carries the sign's standard limit and the signed limit is later than it (a permit-adjusted park), in place of "Limit read from the sign" | Limit on this record | Not reviewed |
| `share.permitTimeNote` | Under the countdown of a permit-adjusted share whose signed limit is later than the standard limit | This limit includes extra time from a permit. Without the permit, the sign's standard limit applies. The sender says it ends at {{time}}. | Not reviewed |
| `share.unsignedHeading` | Above the sender's unsigned extras (driver, sign reading, standard limit, departure) | From the sender, not signed | Not reviewed |
| `share.endedValue` | The sender's I've left tap, as an unsigned extra | The sender tapped I've left at {{time}} (phone clock). | Not reviewed |
| `share.tampered` | A share link whose signature doesn't check out (no details, no map link) | This link has been changed since it was shared | Not reviewed |
| `share.checkValid` | "Check the signature" on a stored copy, when it checks out | The signature is valid. The signed details haven't changed since ParkProof signed them. That doesn't show they're true, who was driving, where the car was, or when it arrived or left. | Not reviewed |
| `pdf.shared.madeElsewhere` | First row of a shared copy's PDF table | This record was made on someone else's phone. | Not reviewed |

### Behaviour to read with the copy (T7, no strings)

- **What is signed on a shared record**: only the arrival bundle (link 0). The address, coordinates, logged time and limit shown come from its signed payload, and only after the in-browser verifier passed it. The driver, the sign-reading summary, the departure tap and the standard limit come from the sender's phone, unsigned, under "From the sender, not signed" (`src/lib/shared-record.ts`).
- **What a link never carries**: photos, the chain key, permit details or the permit salt, or any later part of the record. When a permit gave more time than the sign, the sign's standard limit is shared instead (`permitAdjustedStandardUntil`, `src/lib/share-link.ts`).
- **A link signed with a development key** reads as changed in production builds, because a development key's signature isn't checked at all (`shareOutcome`).
- **A permit-adjusted share**: when the signed limit is the permit's later time, it is labelled "Limit on this record" (never "read from the sign"), and `share.permitTimeNote` gives the sign's standard limit, which comes from the sender unsigned (`SharedFactsPanel`). A record T4 saved signs the sign's standard limit itself (the permit's later time stays on the sender's phone, in `permit_context.permit_until`), so its link carries the standard limit as an unsigned extra only: the signed limit keeps "Limit read from the sign" and no permit line shows.
- **Which link wins**: opening the link again updates the copy unless the stored copy came from a later link. The share time is the sender's and unsigned, so a share time later than when the link was opened (plus 5 minutes) never decides it (`upsertSharedCopy`).
- **Storage**: a copy is saved without a tap, so it never costs the receiver their own records. When storage is full, only other shared copies may be removed to fit it; otherwise the view says storage is full and nothing is saved (`upsertSharedCopy`).

### T7 items 5 to 7: handover and PDF

Added by the same script (`legal` in its `--list`). The en text of `pdf.evidence.field.driver` is the spec's wording. The handover sheet also shows `share.permitSafeguard` (above) when the park used an accessible parking permit.

| Key | Where it shows | English | Status |
|---|---|---|---|
| `handover.intro` | Top of the "Hand the car over" sheet, above the next driver's name | Enter who's taking the car next. ParkProof signs it with this record, as your own statement. ParkProof doesn't check it, and the signature doesn't show who was driving. The record stays active. | Not reviewed |
| `handover.fromDriver` | On the sheet before "Record the handover", when the record names a driver: who the signed handover will say handed the car over | Handed over by {{from_driver}}, the driver this record names now. | Not reviewed |
| `handover.done` | The sheet, once the handover is added (before the share offer), when nobody was named as handing over | Your record now says the car was handed to {{to_driver}}. ParkProof signs it when your phone is online. The record stays active. | Not reviewed |
| `handover.doneFromTo` | Same, when the record names who handed the car over | Your record now says {{from_driver}} handed the car to {{to_driver}}. ParkProof signs it when your phone is online. The record stays active. | Not reviewed |
| `handover.line` | Record screen, under "Handover", one line per handover (followed by "Saved with this record. ParkProof doesn't check it.") | Your record says the car was handed to {{to_driver}} at {{time}} (phone clock). | Not reviewed |
| `handover.lineFromTo` | Same, when the handover names who handed the car over | Your record says {{from_driver}} handed the car to {{to_driver}} at {{time}} (phone clock). | Not reviewed |
| `pdf.evidence.field.driver` | PDF evidence table (all three PDFs), when a driver was named | Driver (entered on the phone, not checked) | Not reviewed |
| `pdf.evidence.field.handover` | PDF evidence table, one row per handover | Handover (entered on the phone, not checked) | Not reviewed |
| `pdf.evidence.field.handoverSigned` | PDF evidence table, after each handover row (ParkProof's signing time, or why there is none) | Handover signed by ParkProof (server clock) | Not reviewed |
| `pdf.evidence.value.handoverTo` | The handover row's value when nobody was named as handing over | Handed to {{to_driver}} at {{time}} (phone clock). | Not reviewed |
| `pdf.evidence.value.handoverFromTo` | The handover row's value when the record names who handed over | {{from_driver}} handed the car to {{to_driver}} at {{time}} (phone clock). | Not reviewed |

### Behaviour to read with the copy (T7 items 5 to 7, no strings)

- **What a handover signs**: `{ from_driver, to_driver, handed_over_at, location }` (`lambda/addendum-schema.js`, kind `handover`). `from_driver` is who the record already names as driving (the latest handover's next driver, else the driver entered at parking), shown on the sheet before the tap (`handover.fromDriver`); `handed_over_at` is the phone's clock when the driver tapped "Record the handover", and `location` is always null: the phone may not be at the car (`src/lib/handover.ts`). ParkProof checks none of it.
- **Only on an active record**: "Hand the car over" shows only while the record is active as the home screen decides it (not ended, and its limit still ahead or passed less than 12 hours ago, or a no-sign park with no limit; `isActiveRecord`), so a park that finished long ago never gets a handover dated now.
- **The record stays active**: a handover never stamps `ended_at`, cancels reminders or queues a departure.
- **The share link after a handover** names the record's own driver (who parked it) as the sender, not the person the car was handed to, because the receiving screen reads "Shared by {{driver}}".
- **The PDF reads signed values from the signed parts**: the driver row from the signed arrival details (marked "(not signed yet)" or "(not signed)" otherwise), each handover from its signed part, with ParkProof's signing time in its own server-clock row. The driver row and the notice screen's driver line use the same reading (`recordDriver`, `src/lib/notice-compare.ts`). Names lose symbols and emoji no PDF font draws.

## Notice comparison (T8)

**Why it needs a lawyer.** "Got a fine? Start here" reads a photo of an infringement notice and lines a parking record up against it. A driver may rely on these lines when deciding whether to seek a review, so each one must state only what the record and its signatures show, keep phone times apart from ParkProof's signing time (N5), never say whether the fine should stand, and word the driver's name as what was entered, not as something ParkProof checked. The nomination line must never encourage nominating anyone but the actual driver.

Added by `scripts/_i18n_inject_t8.mjs` (`legal` in its `--list`). The en text of the departure, arrival, driver, handover and check lines follows build spec T8 item 4.

### The comparison

| Key | Where it shows | English | Status |
|---|---|---|---|
| `notice.disclaimer` | Notice screen, above the comparison | This compares your record with what the notice says. It isn't legal advice, and it doesn't say whether the fine should stand. The council or court decides that. | Not reviewed |
| `notice.compare.noDeparture` | No I've left tap on the record | You haven't tapped I've left on this record. | Not reviewed |
| `notice.compare.departureSignedBefore` | ParkProof signed the departure before the notice time, and the phone's tap is at least a minute before it | You tapped I've left at {{time}}, {{duration}} before the time on the notice. ParkProof signed that record at {{signedTime}}. The record shows when you tapped, not when the car moved. | Not reviewed |
| `notice.compare.departureSignedBeforeClock` | ParkProof signed it before the notice time, but the phone's tap is at or after it (a phone clock running fast) | You tapped I've left at {{time}} by your phone's clock. ParkProof signed that record at {{signedTime}}, before the time on the notice. The record shows when you tapped, not when the car moved. | Not reviewed |
| `notice.compare.departureSignedAfter` | ParkProof signed it at or after the notice time | You tapped I've left at {{time}} by your phone's clock. ParkProof only signed it at {{signedTime}}, after the time on the notice, so the signature can't show you'd left by {{noticeTime}}. | Not reviewed |
| `notice.compare.departurePending` | Tapped, not signed yet | You tapped I've left at {{time}}. This hasn't been signed yet. | Not reviewed |
| `notice.compare.departureNotSigned` | Tapped, never signed (refused, or no signature) | You tapped I've left at {{time}}. This wasn't signed. | Not reviewed |
| `notice.compare.departureDevKey` | Tapped, signed with a development key | You tapped I've left at {{time}} by your phone's clock. It was signed with a development key, not ParkProof's published key, so the signature can't show you'd left by {{noticeTime}}. | Not reviewed |
| `notice.compare.arrivalBefore` | The logged time (phone clock) is at least a minute before the notice time | You logged this park at {{time}}, {{duration}} before the time on the notice. | Not reviewed |
| `notice.compare.arrivalAfter` | It is at least a minute after | You logged this park at {{time}}, {{duration}} after the time on the notice. | Not reviewed |
| `notice.compare.arrivalSame` | It is within the same minute | You logged this park at {{time}}, the same minute as the time on the notice. | Not reviewed |
| `notice.compare.arrivalSignedBefore` | ParkProof signed the arrival before the notice time, shown when the logged time isn't before it or is more than 5 minutes from the signing time | ParkProof signed this record at {{signedTime}}, before the time on the notice. The signature shows the record existed by then, not when the car arrived or where it was. | Not reviewed |
| `notice.compare.arrivalSignedAfter` | ParkProof signed the arrival at or after the notice time | ParkProof only signed this record at {{signedTime}}, after the time on the notice, so the signature can't show it existed by {{noticeTime}}. | Not reviewed |
| `notice.compare.arrivalPending` | The arrival isn't signed yet | ParkProof hasn't signed this record yet. | Not reviewed |
| `notice.compare.arrivalNotSigned` | ParkProof's server refused to sign the arrival | This record wasn't signed. | Not reviewed |
| `notice.compare.arrivalDevKey` | The arrival was signed with a development key | This record was signed with a development key, not ParkProof's published key, so the signature can't show it existed by {{noticeTime}}. | Not reviewed |
| `notice.compare.driver` | The record names a driver (read from its signed details at parking when they are signed) | Your record says {{driver}} was driving. That's what was entered when the park was logged. ParkProof didn't check it. If someone else was driving, the notice explains how to nominate them. Only nominate the person who was actually driving. | Not reviewed |
| `notice.compare.driverPending` | Under that line, and under the driver on the record screen, when the name isn't signed yet | The driver's name hasn't been signed yet. | Not reviewed |
| `notice.compare.driverNotSigned` | The same, when the name was never signed | The driver's name wasn't signed. | Not reviewed |
| `notice.compare.handover` | One line per handover | Your record says the car was handed to {{to_driver}} at {{time}}. | Not reviewed |
| `notice.compare.handoverPending` | Under a handover that isn't signed yet (here and on the record screen). A development-key signature shows verifier.link.devKey instead | This handover hasn't been signed yet. | Not reviewed |
| `notice.compare.checkRegistration` | Always, after the lines above | Check the registration on the notice is the car in this record. ParkProof doesn't record registrations. | Not reviewed |
| `notice.compare.checkDueDate` | Always, last | Check the due date on the notice itself. | Not reviewed |

### The notice time on a daylight saving day

| Key | Where it shows | English | Status |
|---|---|---|---|
| `notice.match.repeatedHour` | A matched record, when the notice time fell in the hour that happened twice | Daylight saving ended on this date, so the time on the notice happened twice. This compares the record with {{time}}. | Not reviewed |
| `notice.match.skippedHour` | A matched record, when the notice time fell in the hour the clocks skipped | Daylight saving started on this date, so the time on the notice didn't exist on the clock. This compares the record with {{time}}. | Not reviewed |

### Behaviour to read with the copy (T8, no strings)

- **What is read off the notice** (`lambda/index.js` `NOTICE_SCHEMA`): the notice number, issuer, the date and time as printed, the place, the offence code and description, the amount, the due date and how legible it was. No registration field: ParkProof never records one, so the comparison always says to check it. The driver can correct a misread date or time on the screen.
- **What is kept** (`handleJobStatus`): the notice photo is never stored. The fields read off it sit in the jobs table until the phone collects them, then the row is deleted; a row past its 10-minute TTL is never served and is deleted when asked for. A job's error holds only an ERR code. The raw model text is never logged.
- **Which records are matched** (`src/lib/notice-match.ts`): records from 10 minutes before their logged arrival to 6 hours after the first of the signed departure, the I've left tap, the limit or 24 hours after arrival, ranked by time and by distance from the place on the notice. On a daylight saving day the notice time can be two instants or none; the screen says which instant it compared.
- **"Signed before the notice"** (`src/lib/notice-compare.ts`) rests only on ParkProof's signing time, and must hold for every reading of the notice time. A signature inside the notice's own minute counts as after it. When the phone's logged time and ParkProof's signing time are more than 5 minutes apart, or disagree about before and after, both are shown.
- **The driver line** reads the name from the signed details at parking when they are signed, and the line under it says when it isn't signed yet or was never signed. Handover lines come from the signed handover parts.
- **Actions** (`NoticeLookup`): "Draft an appeal with this record" opens the appeal flow with the notice already captured, and "Export evidence PDF". With no match: "Draft an appeal anyway". The appeal flow shows no verdict on the evidence: the model's `evidence_strength` only calibrates the letter and is never shown.

---

## Privacy policy (T4, T5 and the fix list)

**Why it needs a reader.** These statements tell drivers what leaves their phone, what the server keeps and for how long. The fix list rewrote the three in the first table to describe what the code does today, no more and no less, and a test ties each one to the code (below). The older text further down hasn't had that check: "Facts for the reader to check", at the end, lists what this pass found. Until someone qualified reads the policy, treat any change to the code it describes as a change to the policy: update the text in all 9 locales, `PRIVACY_LAST_UPDATED` (`src/lib/privacy-version.ts`) and the tests together.

Rewritten or added by `scripts/_i18n_inject_fixlist_final.mjs` (run it with `--list`; `legal` marks these). `privacy.anonymousWeeklyPush` was first added by `scripts/_i18n_inject_t5.mjs`. The other 8 locales carry the same meaning and need checking by a reviewer who reads that language.

| Key | Where it shows | English | Status |
|---|---|---|---|
| `privacy.anonymousCloudwatch` | Privacy policy, the list under "What you give us when you use ParkProof without an account" | <strong>When you tell us whether we read a sign right</strong>, ParkProof's server logs your answer in <strong>AWS CloudWatch</strong>, with when you gave it and a random ID for that answer. With it go details of the reading: the first 120 characters of its description of the sign's rules, how sure it was, the time limit, any payment methods and permit area, whether it asked where you parked and the option you picked, and how many groups of rules, reading problems and weekly restrictions it found. They also say whether the sign was readable, whether the reading was a re-check, and whether it found an area sign, paid parking, a permit zone or an accessible parking bay, and give the hour of day where the sign is. Your answers so far to the paid parking, permit zone and accessible parking permit questions are logged too, so a log line can show that you said an accessible parking permit was displayed. The log doesn't include the photo, its GPS location, or an ID for you or this device. We use it to find where sign readings go wrong. It's deleted after 90 days. | Not reviewed |
| `privacy.anonymousWeeklyPush` | Same list | <strong>Weekly reminders by push</strong>, if you turn them on: each reminder's name and any address you entered, its days, times, repeat pattern and time zone, when it should remind you, and its notification text go to <strong>ParkProof's server</strong>, with a random ID for this device. The server keeps them while the reminder is on, so it can go out every week. They're deleted when you pause or delete the reminder or switch off its notifications, the next time ParkProof is open and online. Each time ParkProof sends them, the server keeps them for 90 days at most. ParkProof sends them again from time to time while you keep opening it, so if you stop, they're deleted within 90 days of the last time you opened ParkProof. | Not reviewed |
| `privacy.rightsAnonymous` | Privacy policy, "Your rights" | If you don't sign in, your parking records are only on this device. Clear your browser storage to delete them. That doesn't delete what's already on our servers. A push reminder you set for a record is kept until it's sent or you cancel it. A weekly reminder by push is deleted within 90 days of the last time you opened ParkProof. This device's push registration (a random ID for this device, the push address and encryption keys your browser gave us, and when they were last renewed) is kept for about 90 days after ParkProof last renewed it. ParkProof renews it when you open the app with push reminders on and when you set a reminder. Switching push reminders off, in ParkProof or in your browser, doesn't tell our server, so the registration is kept as above. If the push service tells us the address no longer works (this can happen when a reminder you set earlier is sent after you switched them off), we delete the address and keys at once. We keep only this device's ID, a fingerprint of the address and when we found out, for about 90 days, so the address isn't stored again. Our server's logs also record this device's ID when it registers for push, sets a reminder or is sent one, with the push service it uses, the random ID of the record or weekly reminder, and when each reminder was set, sent or skipped. The logs are deleted after 90 days. Feedback you send, with your email if you add one, is kept for up to two years. | Not reviewed |
| `common.signedSeal` | The signed seal on a History row of a record signed with ParkProof's key (its accessible label) | Signed, tamper-evident record | Not reviewed |

### Behaviour to read with the copy (fix list, no strings)

- **The "Did we read this right?" log** (`privacy.anonymousCloudwatch`): the result screen sends the reading details once per answer, on "Yes, looks right" or "Retake photo" (`buildFeedbackContext`, `src/components/ParkingResult.tsx`), and the Lambda logs only the fields it whitelists (`handleFeedback`, `lambda/index.js`). `src/lib/privacy-feedback-log.test.tsx` runs a real tap through both and fails if the logged fields and the policy's list differ. The line carries no device or user ID and no coordinates.
- **The accessible parking permit answer in that log.** The line holds the sign's accessible bay flag and the driver's yes or no to the accessible parking permit question, so together they say an accessible parking permit was used for that answer. Build spec N3 allows the feedback telemetry "a `permit_used` boolean at most" and calls accessible permit status health information. The text now says this is logged. Whether to keep logging it at all is an open decision for the owner (dropping `disabled_permit_acknowledged` from the whitelist, and the text with it, is the smaller promise).
- **"Deleted after 90 days" for the logs** is true only once `scripts/setup-log-retention.sh` has run (`docs/build/deploy-checklist-roadmap-2.md`, stage 6.2). Don't deploy this text without it.
- **Push data periods** (`privacy.anonymousWeeklyPush`, `privacy.rightsAnonymous`): `PUSH_TTL_DAYS` (`lambda/push-tombstone.js`) and `RECURRING_SCHEDULE_DAYS` (`lambda/recurring-schedule.js`), both 90; `src/lib/fixlist-cleanups.test.ts` checks the text against them. That weekly schedules delete themselves (`EndDate` with `ActionAfterCompletion: DELETE`) is checked on real AWS in stages 6.3 and 8.5 of the deploy checklist.
- **Feedback kept up to two years**: the feedback bucket's lifecycle rule expires objects after 730 days (`scripts/setup-feedback-bucket.sh`).
- **The policy's "Last updated" date** is the day the text last changed (`src/lib/privacy-version.ts`); `src/lib/privacy-version.test.tsx` fails when a privacy string changes and the date doesn't.

### Earlier privacy text (T4, and the policy before this build)

T4 rewrote the intro and added what is sent with each scan, notice photos, permits and push (`scripts/_i18n_inject_t4.mjs`, `legal` in its `--list`). The rest of the policy is older and no script marks it `legal`, but it is the policy a driver reads, so it is all here. Headings (`privacy.header`, `privacy.*Header`, `privacy.anonymousThings`, `privacy.signedInThings`, `privacy.rightsSignedIn`, `privacy.lastUpdated`, `privacy.verifyLinkLabel`) are left out.

### T4: what leaves the phone, and permits

| Key | Where it shows | English | Status |
|---|---|---|---|
| `privacy.anonymousIntro` | Privacy policy, top of "What you give us when you use ParkProof without an account" (the spec's wording) | ParkProof works without an account. Your records are stored in this browser. To sign a record, your phone sends its details (times, location, what you entered, and photo fingerprints, not the photos) to ParkProof's server, which signs them and doesn't keep a copy. | Not reviewed |
| `privacy.anonymousAnthropic` | Same list | <strong>Each sign photo you scan</strong> is sent to <strong>Anthropic</strong> (Claude) to read the sign, with its location and the type of each permit you've saved (plus the area or zone of a resident or business permit). A re-check sends the earlier reading instead of the photo. We don't keep the photo or the location. The answer, which can mention your permit types, stays on our server briefly so your phone can collect it. Anthropic's retention policy applies. | Not reviewed |
| `privacy.anonymousFineNotice` | Same list | <strong>Photos of an infringement notice</strong> (a parking fine) are sent to <strong>Anthropic</strong> to read the notice, for example when you draft an appeal. Drafting an appeal also sends the details of the parking record you chose. We don't keep the photo. | Not reviewed |
| `privacy.anonymousPermits` | Same list | <strong>A permit you use for a park</strong>: its type, its area or zone and any permit time you entered are kept with that record. Signing the record sends a fingerprint of these details, not the details, along with your answers to the permit questions. Deleting a permit in Settings doesn't change records already saved. Deleting the record removes them. | Not reviewed |
| `privacy.anonymousPush` | Same list | <strong>Push reminders</strong>, if you turn them on: the record's address, each reminder's time and its text (which can mention a permit time you entered) go to <strong>ParkProof's server</strong>, which keeps each one until it is sent, then deletes it. | Not reviewed |
| `privacy.signedInPermits` | Privacy policy, "What you give us when you sign in" | <strong>Permit details</strong> kept with a record (the type, area or zone and any permit time you entered, for a park where you used a saved permit) are stored with that record in AWS DynamoDB. Your saved permits in Settings aren't. Deleting the record removes them. | Not reviewed |

### The rest of the policy (older text, never marked legal by a script)

| Key | Where it shows | English | Status |
|---|---|---|---|
| `privacy.anonymousNominatim` | "Without an account" list | <strong>GPS coordinates</strong> are sent to <strong>OpenStreetMap Nominatim</strong> to resolve the street address. Nominatim does not require a key and applies their public retention policy. | Not reviewed |
| `privacy.signedInIntro` | "When you sign in" | Signing in is optional. It enables cloud sync, the same records visible across all your devices. | Not reviewed |
| `privacy.signedInEmail` | Same list | Your <strong>email address</strong>: stored in AWS Cognito; used as your account identifier and for password reset. | Not reviewed |
| `privacy.signedInSessions` | Same list | Every <strong>parking record</strong> you save: stored in AWS DynamoDB, keyed to your Cognito user ID. Includes timestamps, GPS, sign rules, the AI's translation, your notes, and the cryptographic signature. | Not reviewed |
| `privacy.signedInPhotos` | Same list | Every <strong>photo</strong> attached to a record: stored in AWS S3 under a path that includes your user ID, accessible only to you while signed in. | Not reviewed |
| `privacy.federationCopy1` | "Sign-in with Apple or Google" | If you choose Apple or Google sign-in instead of email/password, your authentication is brokered by AWS Cognito's Hosted UI. Your password, biometrics, or passkey never reach ParkProof. They stay with Apple or Google. | Not reviewed |
| `privacy.federationCopy2` | Same section | From the OAuth handshake we receive two things: a stable opaque user identifier (so Cognito recognises you on return), and your email address. That's it. We do not receive your profile photo, friends list, calendar, contacts, or any other information from your Apple ID or Google account. | Not reviewed |
| `privacy.federationCopy3` | Same section | Signing out of ParkProof in-app does not revoke Apple's or Google's upstream permission. To revoke that, visit your <apple>Apple ID</apple> ('Sign in with Apple' section) or your <google>Google Account</google> ('Security > Third-party access'). Deleting your ParkProof account in-app removes our record but does not unsubscribe the upstream permission. | Not reviewed |
| `privacy.locationCopy` | "Where the data lives" | All cloud storage is in <strong>AWS Sydney (ap-southeast-2)</strong>. Data does not leave Australia for storage purposes. Anthropic and Nominatim may process data internationally during a single API call; those calls do not persist. | Not reviewed |
| `privacy.dontSell` | "What we don't do" | We don't sell your data, ever. | Not reviewed |
| `privacy.dontShare` | Same list | We don't share it with third parties beyond the AWS, Anthropic and Nominatim flows above. | Not reviewed |
| `privacy.dontAds` | Same list | We don't use it for advertising. ParkProof has no ads. | Not reviewed |
| `privacy.dontTrack` | Same list | We don't track you across other sites. | Not reviewed |
| `privacy.dontFingerprint` | Same list | We don't run analytics that fingerprint your device. | Not reviewed |
| `privacy.rightsExport` | "Your rights", signed in | <strong>Export.</strong> Tap "Download as PDF" in Account to get a complete document with every record you've stored: cover page summary plus a per-record detail block with photos. | Not reviewed |
| `privacy.rightsDelete` | Same list | <strong>Delete.</strong> Tap "Delete account" in Account. Removes your sign-in record, every DynamoDB row, and every S3 photo within seconds. Irreversible. | Not reviewed |
| `privacy.rightsCorrect` | Same list | <strong>Correct.</strong> You edit your records in-app. Every change syncs to the cloud immediately if signed in. | Not reviewed |
| `privacy.photosCopy` | "Photos taken inside ParkProof" | Photos are resized to ≤1200px and re-encoded as JPEG at 0.82 quality on your device before they leave the browser. The original high-resolution camera capture never leaves your phone. | Not reviewed |
| `privacy.signingCopy` | "Cryptographic signing" | Signed in or not, each record is signed with an ECDSA P-256 key held in AWS KMS. To sign a record, ParkProof's server receives the details being signed (such as times, location, the sign reading, photo fingerprints and any names you enter, never the photos themselves) and sends back the signature. The private key never leaves AWS. The public key is published at <a>/parkproof-public-key.pem</a> so anyone (a council, court or insurer) can check the signatures with <code>openssl dgst</code>. A signature shows the signed details haven't changed since ParkProof signed them. It doesn't show they're true, who was driving, where the car was, or when the car arrived or left. The appendix in any exported PDF has the steps. | Not reviewed |
| `privacy.contactCopy` | "Contact + complaints" | For questions or to exercise your rights outside of the in-app controls, email <a>hello@parkproof.com.au</a>. | Not reviewed |
| `privacy.complaintCopy` | Same section | Unhappy with our response? You can complain to the <a>Office of the Australian Information Commissioner (OAIC)</a>. | Not reviewed |

### Facts for the reader to check against the code (found while writing this list, 9 Nov 2026)

These are places where the policy and the code may not say the same thing. None has been changed: each change needs all 9 languages, and the T10 translation review changed only translations, never the English. Decide each one before launch.

- **Retention by Anthropic and Nominatim.** `privacy.locationCopy` says their calls "do not persist". `privacy.anonymousAnthropic` says "Anthropic's retention policy applies", and `privacy.anonymousNominatim` says Nominatim "applies their public retention policy". ParkProof can't promise what another provider keeps, so the first statement is the one to look at.
- **Push services.** `privacy.dontShare` names only AWS, Anthropic and Nominatim. A push reminder also goes through the push service the browser uses (Google, Apple or Mozilla), end-to-end encrypted, to the push address the browser gave. `privacy.rightsAnonymous` mentions the push service only as something the server logs.
- **How long a reading or an appeal draft stays in the jobs table.** Fresh sign readings, appeal drafts and notice reads are written to the DynamoDB jobs table with a 10-minute TTL on `ttl`. DynamoDB's TTL sweep is lazy and can take days. The notice route deletes its row once the phone has the result and never serves an expired row. The shared status route for sign readings and appeal drafts does neither, so a finished reading or appeal letter stays readable by anyone holding its random job id until the sweep removes it (`handleJobStatus`, `lambda/index.js`). `privacy.anonymousAnthropic` says the answer stays "briefly"; `privacy.anonymousFineNotice` doesn't mention the appeal letter.
- **Two log lines the policy doesn't list.** The signing route logs each signed record's random id, its schema and the key alias (`[parkproof.signing]`), and the sign reader logs the time zone of each scan's location (`[parkproof] preflight=… tz=…`). Both are deleted after 90 days once `scripts/setup-log-retention.sh` has run.

---

## Pages outside the app (the /verify pages, the landing page, the accuracy page)

**Why they need a reader.** These pages are static HTML, not locale keys, so no inject script lists them and no test ties them to this file. They make the same kinds of statement as the app: what a signature shows and doesn't show, what ParkProof does with a driver's data, and how well it reads signs. The copy lint checks them only for em-dashes and "verified record" (`src/lib/copy-lint.test.ts`, rule 5). `scripts/deploy.sh` ships them with every deploy, whatever the workday flag says. Treat a change to one of these pages as a change to this section.

### The /verify pages (all 9 languages)

Built by `scripts/_build_verify_pages.py` from its `TRANSLATIONS` and `STEPS` into `migrations/two-app-architecture/landing-from-claude-design/verify/` (English at `/verify/`, the other 8 at `/verify/<locale>/`). `python scripts/_build_verify_pages.py --check` confirms the pages on disk match the script. The app links here from the record screen and the privacy policy, and the landing page's evidence section does too. The English is quoted from the script, and the first column is the script's key for it. The other 8 languages carry the same meaning and need a reader of that language. The T10 review rewrote 44 of their translations (`docs/build/translation-human-review.md`).

| String | Where it shows | English | Status |
|---|---|---|---|
| `meta_desc` | Search and share description | Step-by-step openssl walkthrough for checking that a ParkProof evidence record hasn't changed since ParkProof signed it. Cryptographic signing via AWS KMS ECDSA P-256. | Not reviewed |
| `lede` | Top of the page, under the title | Every ParkProof evidence PDF carries a cryptographic signature appendix, and every record can be saved as an evidence file. This page shows anyone, such as a council officer, an insurer, a court clerk or the driver, how to check offline that a record hasn't changed since ParkProof signed it. | Not reviewed |
| `callout_body` | The "Honest framing." box at the top | A valid signature shows <em>integrity</em>: the signed details and photo fingerprints are exactly what ParkProof signed, at the signed time. It doesn't show that the record is <em>true</em> (the AI could have read the sign wrongly), who was driving, where the car was, or when the car arrived or left, and it doesn't decide what weight the record carries. That's for whoever reviews it. | Not reviewed |
| `p_verifying_1` | "What you're checking" | A ParkProof record is signed in parts, called links. Link 0 is signed when ParkProof receives the saved record. Each later link, such as the details at parking, condition photos, a proof of payment photo or the departure, is signed when ParkProof receives it, and carries the SHA-256 of the link before it, so the links form a chain. Each link has a <strong>payload</strong> (the exact text that was signed, including the SHA-256 fingerprints of its photos) and a <strong>signature</strong> made with ParkProof's private key (ECDSA P-256), which never leaves AWS KMS. The evidence PDF prints every link in its signature appendix. The record's <strong>evidence file</strong> (a .json file the driver can download from the record in the app) holds the same payloads and signatures, plus the original photos. | Not reviewed |
| `p_verifying_2` | Same section | The <strong>public key</strong> needed to check the signatures is published at <a class="link" href="/parkproof-public-key.pem"><code>/parkproof-public-key.pem</code></a>. Open it in a browser to confirm it loads, then save it. | Not reviewed |
| `li_need_1` | "What you'll need" | <strong>The evidence PDF or the evidence file</strong>, from the person producing the record. Checking the photos needs the evidence file. | Not reviewed |
| `p_chain_fork` | "Check the links are joined in order" | If two links share a number (2a and 2b), two devices each added a part at that point. Both name the same link before them. | Not reviewed |
| `p_photos` | "Check the photos" | The signatures cover each photo's SHA-256 fingerprint, not the image itself. The photos printed in the PDF are re-encoded copies, so their bytes never match. To check a photo, use the record's evidence file. It lists each photo under <code>photos</code>, with its <code>sha256</code>, the links that sign it (<code>signed_in</code>) and the original bytes in base64 (<code>bytes_base64</code>). The file's name starts with parkproof-evidence- and the start of the record's ID. These commands call it <code>evidence.json</code>. | Not reviewed |
| `p_photo_match` | Same section, after the photo commands | The hex value must equal the photo's <code>sha256</code> inside the signed payload of each link in <code>signed_in</code>: <code>sign_photo_sha256</code>, <code>car_photo_sha256</code> or <code>ambient_photo_sha256</code> in link 0, or a <code>sha256</code> under <code>photos</code>, <code>photo</code> or <code>return_photos</code> in a later link. Check it against the payload whose signature you checked in step 4, not just the <code>sha256</code> next to the photo in the file, which isn't signed. Use <code>.photos[1]</code> for the second photo, and so on. | Not reviewed |
| `callout_photo_body` | Same section, the "The photo check is separate." box | <code>Verified OK</code> shows the fingerprints in a payload haven't changed. Only re-hashing the original photo shows a photo is the one that was signed. If the hashes differ, that photo isn't the one ParkProof signed, even when the signature check passed. A file with no bytes for a photo (<code>bytes</code> is <code>not_on_this_device</code>, or <code>withheld_permit</code> for a photo of a permit the driver chose not to include) can't be used to check that photo. | Not reviewed |
| `pass_body` | "What the result means", Signature valid (PASS) | <code>Verified OK</code>: the payload is exactly what ParkProof signed. The details and photo fingerprints in it haven't changed since ParkProof signed them, at the <code>signed_at</code> time inside it. The photos themselves are checked in steps 6 to 8. | Not reviewed |
| `fail_body` | Same, Failure (FAIL) | <code>Verification failure</code>: the payload or the signature isn't what ParkProof signed. The record may have been changed, or a block may have been copied with a mistake. Copy the base64 blocks again in full and retry before drawing conclusions. | Not reviewed |
| `p_beyond` | The section headed Beyond "did the bytes change?", above its list | A valid signature shows <em>integrity</em>. It doesn't show: | Not reviewed |
| `li_beyond_1` | That list, item 1 | <strong>That the AI read the sign correctly.</strong> The ParkProof scan is a machine read of a parking sign, and machines can be wrong. The verdict text and rules in the record are the AI's best read at scan time, not ground truth. | Not reviewed |
| `li_beyond_2` | That list, item 2 | <strong>That the photos depict what the person says they depict.</strong> A valid signature shows the photo fingerprints haven't changed since ParkProof signed them, and re-hashing shows whether a photo matches its fingerprint. Neither shows the photos were honestly taken. | Not reviewed |
| `li_beyond_3` | That list, item 3 | <strong>Any legal outcome.</strong> Whether the evidence supports an appeal, a refund, or a court case is the reviewer's call. ParkProof is a tool, not a lawyer. | Not reviewed |
| `li_beyond_4` | That list, item 4 | <strong>Where the car was, when it arrived or left, or who was driving.</strong> The location in the record comes from the driver's phone, or the driver typed it in. Times marked as phone times come from the driver's phone, and ParkProof's signing time is when ParkProof received each part. | Not reviewed |
| `p_why_1` | "Why this exists" | Most parking apps that produce "evidence" produce a screenshot. A screenshot could have been edited at any point between when it was taken and when it was sent. The cryptographic signature is the difference between <em>"here's what I saw"</em> and <em>"here's what I saw, and anyone can check it hasn't changed since ParkProof signed it."</em> | Not reviewed |
| `p_why_2` | Same section | The public key is published, so once you've saved it the check works offline, without our app. The signed time comes from ParkProof's server clock, so for that time you're trusting ParkProof. The check can be done years from now, even if ParkProof is no longer running, as long as you have a saved copy of the public key and <code>openssl</code>. | Not reviewed |

The rest of each page is headings, labels and the steps themselves (`p_steps`, `c_step_1` to `c_step_4`, `p_repeat`, `p_windows`, `p_chain`, `c_chain_1` to `c_chain_3`, `c_photo_1` to `c_photo_3`, `p_photo_nojq`, `p_photo_windows`, `p_file`, `p_file_windows`). They say how to run the check, not what it shows. Read them for accuracy against the PDF's signature appendix, not for claims.

### The landing page (English only)

`migrations/two-app-architecture/landing-from-claude-design/index.html`, served at `/`, with the hero animation's captions in `landing-demo.js`. The app's own page (`index.html` at the repo root, served at `/app/`) has its own search and share descriptions. Quoted as shown, without the markup. The evidence and reminders lists are waiting on T10 item 4 (the landing update, `docs/build/fix-list.md`), so read them again once that lands.

| Where it shows | English | Status |
|---|---|---|
| Page title, search description, share descriptions | Read any Aussie parking sign in seconds \| ParkProof / Point your phone at any stacked Melbourne parking sign and get a plain-English answer in seconds. Keep a tamper-evident record in case you get a fine. Not legal advice. / Photograph a stacked Melbourne parking sign and get a plain-English answer in seconds. Keep a tamper-evident record in case you get a fine. | Not reviewed |
| The app's page (`/app/`): search and share descriptions | Aussie parking, decoded. Photograph a sign, get a plain-English answer, save evidence in case of a wrongful ticket. / Photograph a parking sign, get a plain-English answer, save evidence in case of a wrongful ticket. | Not reviewed |
| Hero | Read any Aussie sign in seconds. / Point your phone at the most chaotic stacked sign in Melbourne. We tell you, in one sentence, whether you can park here and when you need to leave. / Free, no account · Saved records work offline · About 10 seconds for most signs | Not reviewed |
| Hero animation captions | Snap the sign · Reading the sign · ~10s · Verdict · plain English · Reminders before tow-away · Tamper-evident PDF export · Works in your language | Not reviewed |
| "How it works" | Open ParkProof. Snap the sign. Get a plain-English verdict. No account. No subscription. No telling us where you live. / ParkProof works with stacked, tilted, partial and overcast shots. / Claude vision parses every panel, normalises Australian sign grammar, and reconciles overrides: clearway over time limit over permit zone, the works. / One sentence: "You can park here until 4:00 am Saturday. That's 5h 56m of overnight parking before the 4 am tow-away." Plus the list of rules we read, so you can check them against the sign before you walk away. | Not reviewed |
| The comparison with other tools (claims about other products) | Most OCR-only tools read the first sign. We read every sign, then do the maths. / Australian signs override each other in non-obvious ways. The "2P time-limit" says you have until 4:30 pm. But the clearway underneath says tow-away from 4:00 pm on weekdays. The real cap is 4:00 pm, not 4:30 pm. That's the kind of read most apps get wrong. / OCR-only tools: Reads the largest text on the sign and stops. Ignores secondary panels (clearway, permit zones, day-of-week shifts). Treats the time-limit as the cap, full stop. / ParkProof: Parses every panel on the pole: clearway, time limit, permit zone, accessible parking, motorcycle, pay by phone. Cross-references the time-of-day, day-of-week, and which side of the post you're on. Applies override precedence: clearway beats time-limit beats permit. Earliest restriction wins. | Not reviewed |
| Reminders | Parking anxiety ends when you park. / Other parking apps remind you about meters you paid through them. ParkProof can remind you about any park: the free 2P spot you grabbed at lunch, the permit-zone bay you checked this morning. Layered push notifications, sent by a scheduler before your time runs out. / Works in the background. Web Push can reach you with the tab closed or the phone in your pocket. On iPhone, add ParkProof to your Home Screen first. / One-tap re-check. Wondering if you can still park there? One tap re-checks the rules we read, in seconds, without walking back to the sign. / Any park. Paid meter, free 2P, permit zone, all covered. Not only parks you paid for in an app. / Reminders can be delayed or silenced, for example by Focus or battery saving. Don't rely on them alone. | Not reviewed |
| Evidence | If you get ticketed anyway / Every saved park is tamper-evident. / If you get a fine, ParkProof exports the record as a PDF with its cryptographic signatures, the sign photo and the details you saved. It can also draft an appeal letter for you to check and send. / Not legal advice. A signature shows the record's details existed, unchanged, by the time ParkProof signed them. It doesn't show they're true, who was driving, where the car was, or when it arrived or left. How a council or court weighs the record is up to them. | Not reviewed |
| Evidence, the list | Signed by ParkProof's server. Each part of the record is signed when ParkProof receives it, with a key held in AWS KMS. The signing time comes from the server, not your phone. / Your phone's location. The GPS reading your phone gives when you log the park, looked up as a street address. It's your phone's reading, and the signature doesn't show where the car was. / Photo of the sign and your car. Both go in the PDF, and their fingerprints are signed with the record. / AI-drafted appeal letter. A plain-English starting point that refers to your saved record. You check it, edit it and send it yourself. | Not reviewed |
| Evidence, the record picture's labels | SIGNED RECORD · Tamper-evident | Not reviewed |
| Privacy (read with the privacy policy, section 7) | Anonymous-first. Local-first. / Saved records and reminders work offline. There's no account and no sign-up. Your photos and records are stored on your phone unless you turn on cloud sync. / Open the URL, take a photo, get an answer. No email, no phone number, no Apple/Google sign-in required. / Records, photos and answers are saved on your phone. To read a sign, the photo goes to the AI. To look up an address, your location goes to OpenStreetMap. To sign a record, its details (not its photos) go to ParkProof's server. To send a push reminder, its time and text are kept on ParkProof's server until it's sent, cancelled or expires. / Want your records on all your devices? Sign in with email, Apple or Google and we sync them via Cognito. Delete your account and your synced records and photos are deleted. | Not reviewed |
| Closing line | Free, anonymous, and faster than reading the sign yourself. Next time you're staring at six signs on one pole, let us read them. | Not reviewed |
| Footer (also on the accuracy page) | ParkProof is an independent tool, not affiliated with, endorsed by, or operated by any council, government body, or parking authority. | Not reviewed |

### The accuracy page (English only)

`migrations/two-app-architecture/landing-from-claude-design/accuracy/index.html`, served at `/accuracy/` and linked from the landing page's footer. It explains how the sign reader is tested and shows no numbers yet. Once numbers are published, `accuracy/accuracy.js` builds the results table from them (its row names, the test set line, the model and version line, time and cost), so read the page again then.

| Where it shows | English | Status |
|---|---|---|
| Intro | ParkProof uses an AI model to read parking signs. To find out how often it gets them right, we run it over photos of real signs that a person has already read and labelled, and count the mistakes. This page explains the method, what each number means, and what the test can't tell you. | Not reviewed |
| Results, before any numbers | No numbers yet. / The first numbers will appear here once a held-out set of signs has been labelled and tested. / Until then there's nothing honest to report, so we don't show a number. | Not reviewed |
| The method | We collect photos of real parking signs, including stacked poles, arrows, clearways, permit zones and paid parking. Number plates and faces are kept out of frame. / Each photo goes into one of two sets when it's added, before it's ever run. The development set is used while we improve the instructions the model follows. The test set never is. Only test set numbers appear on this page, so the model hasn't been tuned to the photos it's scored on. Which test photos it got wrong isn't published. / Each photo goes through the same sign-reading code the app uses, with the clock set to the labelled date and time, so every run asks the same question. / The labelling rules and the test code are public | Not reviewed |
| Definitions, "Said you can park when you can't" | Of the signs where you can't park at the labelled time, the share of reads that said you can. It's one of the mistakes that can cost you a fine, so it's reported on its own. Missing a payment or permit condition and giving a leave-by time that's too late can cost you a fine too. They have their own rows. | Not reviewed |
| Definitions, "95% range" | A Wilson score interval. With a few dozen signs, the true rate is likely to be somewhere in this range, but it could be outside it. Ranges are counted per sign, not per read, because repeat reads of the same photo aren't independent. | Not reviewed |
| "What the test can't tell you" | A few dozen photos can't cover every sign in Australia. The ranges give a rough idea of how much the numbers could change with other photos. / The test set may not include signs like yours, or signs from your city or state. When results are shown, the tags listed with them say what the test set covers. / Your photo may be darker, blurrier, more angled or more blocked than the photos in the test set, and harder to read. / A label is a person's reading of the sign. Labels can be wrong, and a council may read a sign differently. / The numbers apply to one model, set of instructions and app version, named with the results. A change to any of them needs a fresh run. / Numbers about many signs don't tell you whether one particular read is right. Always check the actual sign before you leave the car. | Not reviewed |
