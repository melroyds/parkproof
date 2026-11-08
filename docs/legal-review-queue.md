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

T6b adds its keys here (start gate, readiness, explainer, workday card, moving, the boundary question and its answers, "not sure" and deadline-passed lines, end workday).

### T6c: workday record PDF

T6c adds its keys here (export warning, PDF header and footer, cover table headings, rule-sheet line).

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
