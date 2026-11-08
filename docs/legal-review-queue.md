# Legal review queue

Every user-facing string key a lawyer should read before launch. Each section belongs to one roadmap task (`docs/build/roadmap-build-spec.md`); a task adds its keys to its own section. T10 completes the list (permit, notice comparison and signature statements).

Status values: **Not reviewed**, **Changes asked**, **Approved** (with the reviewer and date).

---

## Workday mode (T6a, T6b, T6c)

**Gate.** Workday mode ships behind `VITE_FEATURE_WORKDAY` (`src/lib/features.ts`): on in `npm run dev`, off in production builds unless the build sets it. Do not set it for a production build until every key in this section is **Approved**.

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

The push title reuses `reminders.pushTitleFallback` ("Parking reminder") when the record has no address. Wherever these reminders are offered, the screen also carries the reliability line from the copy rules ("Reminders can be delayed or silenced, for example by Focus or battery saving. Don't rely on them alone."); T6b adds that screen.

### Behaviour to read with the copy (T6a, no strings)

These decide what the copy above says and when. They are app rules, not legal rules, and no copy presents them as legal rules.

- **When the app asks which boundary the driver passed** (`sameStretchCheck`): the new park is within 30 m of the previous one; or on the same road within 150 m; or the sign reads the same within 300 m; or either sign is an area sign, or the previous stop was still under an area sign's limit (the driver wasn't sure they had left the area), however many moves ago that sign was; or either location is missing, typed in, of unknown accuracy, or worse than 100 m. The distances only decide when to ask. Beyond them the app doesn't ask, and the driver's new sign starts its own limit. The reasons are signed with the leg, so each one is recorded only when it is literally true: when the road name couldn't be looked up, the same-street test simply finds no match.
- **When the app can't tell whether a sign is an area sign** (a reading or record from before the sign reader reported it): a sign whose text names an area counts as an area sign, so the app asks the area question.
- **What keeps the original limit running** (`startsNewLimit`, `legDeadline`): "I'm not sure", no answer, or an answer the question didn't offer. Only a sign showing the zone ended, a yellow edge line, or the end of the road at a T-intersection or dead end starts a new limit. Under an area sign, and on every later stop until the driver says they left the area, only "I drove out of the parking area" does. The new leg can never run past the original deadline in that case: the earliest deadline that applied at the previous stop, which can be that stop's own sign limit when it was shorter than the stretch it continued.
- **Where workday mode works** (`jurisdiction.ts`): Victoria and Queensland only, read from the ISO 3166-2 state code of the reverse geocode of the phone's GPS fix alone, with no fallback. An address the driver typed never sets the state: that leg's state is unknown.
- **Reminder timing** (`workdayReminderSchedule`): go-now allows for at least a 10-minute walk, because reminders are set while the driver is at the car, and never caps a longer walk. When a leg is saved too close to its deadline for go-now's time, go-now fires as soon as it can. The heads-up is still sent when a long walk puts it after go-now. No reminder is planned less than a minute ahead, because the push service drops those.
- **The driver's answer is recorded as the driver's statement**, never as something the app checked (`buildBoundaryStatement`; signed in the leg's arrival context).

### T6b: screens and flow

**Gate, restated.** The owner has no access to a lawyer, so `VITE_FEATURE_WORKDAY` stays off in production indefinitely. With it off, none of the keys below is shown: no home link, no start screen, no workday card, no workday scan rules, no History grouping (`src/app-workday.test.tsx` renders home and every affected screen with the flag off). `src/lib/features-build.test.ts` checks that a production build reads the flag as off from this checkout's env files and shell, and that no build script sets it.

#### Items 1 to 7 and 10: start, readiness, explainer, card, moving, readable signs, end

Added by `scripts/_i18n_inject_t6bc.mjs` (run it with `--list`; `legal` marks the keys this table says a lawyer must read first, `exact` the spec's own wording, which the script refuses to change). Every key in the table is new except `home.startWorkday` (T4's text, shown by T6b). All of them are workday copy; none may be shown in production before a lawyer has read them.

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

---

## Privacy policy (fix list, 9 November 2026)

**Why it needs a reader.** These statements tell drivers what leaves their phone, what the server keeps and for how long. Each one describes what the code does today, no more and no less, and a test ties it to the code (below). Until someone qualified reads them, treat any change to the code they describe as a change to the policy: update the text in all 9 locales, `PRIVACY_LAST_UPDATED` (`src/lib/privacy-version.ts`) and the tests together.

Rewritten or added by `scripts/_i18n_inject_fixlist_final.mjs` (run it with `--list`; `legal` marks these). The other 8 locales carry the same meaning and need checking by a reviewer who reads that language.

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
