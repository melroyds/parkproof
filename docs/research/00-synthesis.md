# ParkProof: what the research found, and what we do next

*October 2026. The readable version. The full record, with every source, is in
[01](01-market-landscape.md), [02](02-novel-use-cases.md) and
[03](03-workday-shuffle.md).*

---

## The short version

1. **The market caught up.** About ten AI parking-sign readers shipped between
   January and October 2026, several covering Australia. Reading a sign is no longer
   a differentiator, and neither is drafting an appeal letter.
2. **The evidence chain is still ours alone.** No parking product anywhere signs its
   records. But no Australian dispute has ever been shown to accept a signed record
   either. The moat is real in principle and untested in practice.
3. **The strongest new idea is the signed before-photo.** Six of seven independent
   researchers found it: proof the car was undamaged when you walked away.
4. **Frequency is the real problem.** Almost everything people need from a parking
   app is occasional. Only two genuine habit loops turned up: street sweeping
   (weekly) and the workday shuffle (several times a day).
5. **The workday shuffle is real and legally dangerous.** Moving a few bays does not
   restart the time limit. Built naively, the feature would get users fined and then
   hand councils signed proof of the offence.
6. **One build unlocks most of the plan: sign the departure.** Today the "I've left"
   moment is not signed. Signing it completes five separate use cases at once.

---

## What we set out to learn

Three research passes, run in parallel by AI research agents and then checked by a
separate adversarial reviewer in each pass:

| Pass | Question | Scale |
|---|---|---|
| **Market landscape** | Who are we really up against, and what does nobody do well? | 7 researchers, 16 sources re-fetched by the reviewer |
| **Novel use cases** | Family car sharing came from realising the subject is "my car and everyone who cares about it", not "me and the sign". What else hides behind that? | 7 territories, ~65 candidate use cases |
| **Workday shuffle** | Can we safely help commuters who must move the car every two hours? | 5 angles, the authorised Victorian and Queensland road rules read directly |

Across the three, roughly **286 distinct sources**. Every claim needed a source URL or
an explicit "none found". The reviewers struck unsupported claims, merged
duplicates, and fetched the load-bearing sources themselves. Where an individual
report and its reviewer disagree, the reviewer wins.

---

## 1. The market caught up

When ParkProof was built, nobody in Australia read a parking sign from a photo.
That stopped being true in 2026.

- **SIGNLanguage** is Australian, native iOS, with reminders, a Lock Screen and
  Dynamic Island timer, CarPlay and eight languages, priced in credits ($1 for 2
  checks). It is close to a clone of our core loop. It has too few ratings to show an
  average, and it says nothing about evidence or disputes.
- **Parksy**, from Sydney, is the most complete competitor: sign scanner, timer,
  find-my-car and AI appeal letters for Australian infringements, live since at least
  July 2026 and actively shipping. It already offers one-tap timer re-set and was
  rolling out multiple timers during the research.
- **ParkSnap** gives five free checks a day and claims 99% accuracy with no
  methodology. **Parky.ai** covers 85 languages and publishes a 544-photo benchmark,
  though its own surfaces quote different accuracy figures.

The appeal letter is commoditised too. **FineAppeal** charges **A$9.99** for a parking
appeal across 75+ councils, offers a free strength assessment, and explicitly makes no
claim to check whether the fine is valid. Parksy gives letters away free.

The most sobering data point: **Parkopedia shut down its consumer app on 1 July
2026.** The company with arguably the best parking dataset in the world could not make
a consumer app work.

**What this means.** Competing on "we read the sign" is a race to the bottom on
price, against funded native apps. That race is not worth running.

---

## 2. What is still ours

Two independent searches failed to find a single parking product anywhere that does
capture-time hashing, independent timestamping or a custody log. Competitors'
"history" features are plain photo logs, which is exactly what a council reviewer
should distrust. ParkProof already signs every session with an AWS KMS key whose
public half is published for anyone to verify.

**The reframe the research points at: ParkProof is not a sign-reading app that keeps
records. It is the record, and the AI read is how the record gets made.**

There is an important limit on that claim. **Nobody found a single documented case
of a cryptographic signature being used, accepted, or even considered in an
Australian parking or insurance dispute.** Two insurance-ombudsman determinations
that would have supported it could not be traced to a source.

So what we can honestly say is narrow: *a signed record removes the other side's
ability to claim your photos were altered.* We must never say "admissible" or
"accepted by insurers". Contemporaneous and verifiable, yes. Proven in a tribunal, no.

---

## 3. The signed before-photo

The second pass split the search into seven unrelated territories so they would cover
different ground. **Six of them came back with the same idea under different names:
proving the car was fine when you walked away from it.** Independent convergence like
that is a stronger signal than any single statistic.

The pain is well documented. AAMI analysed more than **17,300 shopping-centre car park
claims** in a year and found **40% were damage to parked vehicles**. The failure
pattern repeats across forums: you return to a crease in the door, you can't say when
it happened, the centre won't release CCTV, police assign no fault, and you pay the
excess.

Everyone has an *after* photo. Almost nobody has a credible *before* photo. The
standard advice ("take timestamped photos") is close to worthless, because photo
timestamps are trivially editable and everyone in a dispute knows it. A signed photo
taken at the moment of parking is precisely what's missing.

This also changes the economics of the evidence chain. Today it pays off on roughly
one park in two hundred, the one that gets disputed. **If every park captures a signed
condition baseline, it pays off on every park.** The value stops being insurance
against a rare fine and becomes a record that accrues.

One boundary the reviewers drew firmly: **do not reposition as a "vehicle evidence
platform".** The parking moment is what gets the app open at the right time. Lose
that trigger and ParkProof becomes something people remember only after something has
already gone wrong.

---

## 4. Frequency is the real problem

Almost every use case the research surfaced is occasional or rare: a fine, a dent, a
tow, a stolen car. Those are emotionally intense but they happen to any one person a
few times a year at most. That is a poor shape for a subscription and a poor shape for
retention, and the reviewer called the retention story "thin".

Two genuine habit loops turned up:

- **Street sweeping.** The best-verified unique finding in the whole set. It happens
  weekly, on a different day for each side of the street, and Stonnington confirms in
  writing that **resident permits do not exempt you**. The only current mitigation is
  phoning the council. It reuses the calendar-reminder generator ParkProof already has.
- **The workday shuffle.** Several times a day, five days a week. See below.

One segment also stood out: **motorcycle and scooter riders.** A Sydney rider fined
$263 told a journalist he now "takes photos as a precaution when parking", which is a
user building a worse version of ParkProof with his camera roll. Roughly 982,000
registered motorcycles, commuting daily, with footpath rules that vary wildly by
council. No new product is needed, just a segment to speak to.

---

## 5. The workday shuffle

The scenario: a commuter has no work parking, parks on a two-hour street in a busy
suburb, and has to move the car through the day. 9am, 11am, 1pm, 3pm.

### The law is clear, and stricter than people think

Rule 205 of the Australian Road Rules, as adopted in Victoria and Queensland (both
read from the authorised text), says continuous parking runs until the driver
*"moves the vehicle off the length of road, or out of the area, to which the
permissive parking sign applies"*.

So **moving a few bays along the same signed stretch is still a breach.** Rule 332
says a stretch ends at the nearest of three things: a sign with an arrow pointing the
other way, a yellow edge line, or the end of the road at a T-intersection or dead
end. A cross street is not on that list. Under a "parking area" sign you must leave the
whole area, so going round the corner may not count.

Official guidance is stricter still. Legal Aid Victoria: *"you cannot add more money
to the meter or move to a nearby spot."* City of Greater Geelong lists moving to
another bay in the same signed area as an **invalid** appeal ground. Driving out of
the stretch and returning to the very same bay, on the other hand, is lawful.

### The finding that matters most

**A signed record of a two-bay shuffle is signed evidence that the car never left the
stretch.** Tamper-evidence cuts both ways. A feature that helps someone shuffle
wrongly does not just give bad advice, it manufactures cryptographic proof of their
offence.

That turns the safety design from good practice into a requirement:

- A **fresh sign scan at every re-park**, never reusing the previous reading.
- A **same-stretch tripwire**: same street within about 150 metres, matching sign
  text, or GPS within about 30 metres, and the app asks which boundary the user passed.
  The answer is recorded as something the user said, never something the app verified.
- **"Not sure" keeps the original clock running.**
- The words **"reset" and "compliant" never appear** in the app or the PDF.
- **Victoria and Queensland signed streets only** at first. WA runs on entirely
  different legislation. NSW waits until someone reads the authorised text.
- Framed as **"stay legal on a workday"**, never "beat the limit". Short-stay bays
  exist for customer turnover, and that framing protects the relationship with councils.

### Who it actually helps

The behaviour is well documented, but the most-hurt group is the wrong one for a
reminder. Hospital and school staff (nurses at Box Hill, St Vincent's, RMH and others)
are fined because they **cannot leave work**, not because they forget. For flexible
office workers, a self-selected Sydney poll found most overstay and gamble rather than
shuffle.

So one question decides whether to build it:

> **"When you got fined, did you forget, or could you not get away?"**

Mostly "forgot": build it. Mostly "couldn't get away": a reminder won't help them.

### Competitors

Nobody chains workday legs, checks for a zone change at each move, or records the day.
Single reminders are everywhere. Parksy is the one closest to closing the gap.

---

## 6. Family sharing, reconsidered

The first pass found **no evidence anyone wants it**: no study, survey or forum corpus
quantifying household parking confusion. Absence of a competitor in a mature category
is as often a sign nobody wants something as a sign nobody built it.

The second pass found something more useful than demand: **evidence of what people
will and won't accept.** Australian parents, verbatim, call continuous tracking
"creepy/stalkery" and connect it to coercive control, yet happily accept arrival
confirmations and pickup logistics.

That gives a defensible position: **share the session, not the person.** A parking
session is a bounded object, with a start, an address, an expiry and an end. A
person-tracking app like Life360 structurally cannot offer that, because its unit is
someone's live location.

It also has legal weight. Fines Victoria confirms that if you nominate the wrong
driver, they can reject it and **the fine is reissued to you**. A household that keeps
a signed record of who had the car is doing what the law already assumes it does.

**One rail is mandatory.** The ACT's parking director says most permit misuse is
family members using a permit when the holder isn't in the car: a $600 fine, and
grounds for confiscation in NSW. A sharing feature that silently carries a disability
permit across drivers would generate fines for the very person who depends on that
permit. Sharing must ask *"is the permit holder travelling?"* or it should not ship.

---

## 7. Assumptions the research overturned

Being explicit about these, because the plan changed because of them.

| We assumed | The research found |
|---|---|
| Nobody reads parking signs with AI | True at launch, false by mid-2026 |
| A $12.99 Dispute Pack would be the main revenue | Letters are free or A$9.99 elsewhere; demand is thin (roughly 430 Australian searches a month, from vendor PR) |
| Family sharing is the most valuable next build | No evidence of demand; valuable only as "share the session", with a permit rail |
| The validity checker's notice-defect checks are the core opportunity | NSW notification compliance went from 42% to 92% in a year, and 203 of one council's 239 invalidations are unexplained. The defects are being engineered out |
| A shuffle chain would prove a commuter complied all day | The departure isn't signed yet, and a chain can prove the opposite |

What survived from the validity checker: the **contradiction checks**, comparing a
notice against the user's own signed record. Those depend on signing the departure.

---

## 8. The plan

### This week

| Task | Effort | Why now |
|---|---|---|
| **Harden push notifications** | An afternoon | A live bug: background reminders share one tag with no re-alert, so the final "your bay expires now" can replace the earlier one silently. Pushes also go out at normal urgency with a 28-day lifetime. Every feature below depends on reminders landing. |
| **Ask the coworkers the one question** | One conversation | Decides whether the shuffle feature is worth building. |

### Tier 1: build next

1. **Sign the departure.** Add the "I've left" time and a departure GPS fix to the
   signed record. It is the missing half of five use cases at once: chalk-mark duration
   disputes, the damage window, the workday chain, the custody handover, and the
   school-zone countdown. The highest-leverage single change in all three passes.
2. **Signed condition capture at park.** The six-of-seven convergence.
3. **The compliance frame.** One extra photo: permit on the dash, ticket on the
   windscreen, payment confirmation. Councils publish exactly this as the evidence they
   want, and nobody can stage it after a notice arrives.
4. **Street sweeping reminders.** Weekly, verified, reuses existing code.

### Tier 2: after validation

5. **Workday log**, in the reduced safe form above, if the coworkers mostly "forgot".
6. **No sign, obscured sign, contradictory sign** as a first-class path. Every
   competitor disclaims it, and database-driven apps structurally can't handle it.
7. **Permit-aware answers**, inside the photo flow, with a visible "check with your
   council" escape hatch. NSW permit concessions are counterintuitive: the ordinary bay
   often beats the accessible one.
8. **A published accuracy benchmark** with methodology. Competitors claim 74% to 99%
   with no method. ParkProof already has the feedback telemetry to do it honestly.

### Tier 3: later

9. **Share the session**, with the custody ledger and the permit rail.
10. **Fine-first lookup**: start from a notice and find the matching signed record.

### Do not build

Reading users' calendars. Maps of where people have been. Anything that quotes appeal
odds (published rates run from 1% to 50% and contradict each other). Penalty-amount
audits. NSW notice-validity screening. "Can I sleep here tonight". Reporting other
drivers. Walk-me-home safety. Inspector or patrol alerts. Any invented minimum
distance for re-parking.

---

## 9. How ParkProof makes money

**Capture is free. The signed export is paid.**

Capture has to become a habit or the archive never exists, so charging for it would
destroy the asset. What people pay for is the bundle they need when something goes
wrong: the dispute pack, the damage bundle, the day record.

- **Price:** about **A$9.99 per export**, anchored on carseal.ai ($9.99 per report) and
  FineAppeal (A$9.99).
- **Billing:** CellOPark's model, verified on its listing: *"only charged in months the
  app is used"*. It solves the low-frequency problem directly.
- **Channel:** Stripe on the web keeps about 97% of a A$9.99 sale, against about 70%
  through the app stores.

The honest gap: **nobody found any Australian willingness-to-pay data.** These prices
are anchored on competitors, not on demand. Treat them as the first experiment.

---

## 10. The mobile apps

iOS first is now properly evidenced. iOS accounts for about **62.6% of Australian
mobile web traffic**, and iOS 26's **AlarmKit** lets a user-scheduled countdown break
through Focus and silent mode, with a Lock Screen Live Activity. That is exactly what a
workday reminder needs and exactly what the web cannot do: no web platform in 2026 can
break through a Work Focus.

But **the port should follow validation, not lead it.** Ship the safe version on the
web. If users report missed reminders, that is the trigger to port iOS as a thin
native shell. An Android wrapper (TWA) still runs on web push, so it fixes no
reliability problem.

---

## 11. Still open

- **The coworker question.** Forget, or can't get away?
- **Has any council ever accepted an app-generated record** in an internal review?
- **The NSW authorised road rules text**, which returned access errors.
- **Melbourne councils' own re-parking guidance.** City of Melbourne, Yarra, Port
  Phillip and Stonnington pages were all blocked or silent.
- **"Parking area" signs:** whether moving streets inside an area resets the clock.
  No case law. Design for the strict reading.
- **Australian willingness to pay.** No data exists in anything found.

---

## 12. Sources: use with care

Most sources held up under review. These did not, and should not appear in anything
public:

- **australian5.com** is a content farm. Its "hospital fine" story has no original
  source and cites anonymous "insiders".
- **RAA "55,000+ claims"** and related figures do not appear on the page they are
  attributed to. The directional claim (parked-car damage is common) survives.
- **INRIX's £209 parking-search cost** is UK data from 2017.
- **RevenueCat's 10.7% vs 2.1%** conversion figures are real, but the page labels them
  as trial-to-paid, not download-to-paid. Check the label before quoting.

And one security note. A competitor site, appealticket.com, embeds hidden text
addressed to AI agents, including an instruction about refusing payment. Competitors in
this category are already planting instructions for crawling agents. ParkProof's
planned MCP server is a live prompt-injection surface and belongs in the threat model.
