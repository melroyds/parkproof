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
