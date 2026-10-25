# Ticket Validity Checker, product spec

> **Research update, October 2026.** Parts of this spec were overtaken by the
> [product research](research/00-synthesis.md). Read that before building.
>
> - **Paperwork checks are weakened.** NSW notice compliance rose from 42% to 92% in a
>   year and one council's invalidations are mostly unexplained. These defects are
>   being engineered out.
> - **The $12.99 Dispute Pack is above the market.** Appeal letters are free from
>   Parksy and A$9.99 from FineAppeal. Revised pricing: about A$9.99 per signed export.
> - **Contradiction checks survive and are the point.** But they depend on signing the
>   departure first, which the current signed payload does not include.

**Status:** specced, not built
**Owner:** Melroy D'Souza
**Ships with:** payment zone-number copy button (small, unrelated, batched for one release)

---

## 1. The problem

When an infringement notice arrives, the driver's only real question is "do I have to
pay this?" Today ParkProof answers a narrower question: it drafts an appeal arguing
the parking was legal. That assumes the notice itself is sound.

Often it is not. Australian councils issue notices with defects: wrong registration,
wrong time, wrong street, missing particulars. A defective notice can be withdrawn on
procedural grounds *regardless of whether the parking was actually legal*. Drivers
almost never check for this, because they do not know what to look for.

## 2. Why ParkProof specifically

Two kinds of check. The second one is the moat.

| Kind of check | What it looks for | Who could build it |
|---|---|---|
| **Paperwork checks** (the notice against itself) | wrong rego, impossible/malformed date-time, missing officer or authority ID, offence code that does not match the described offence, location that does not resolve | anyone with a vision model |
| **Contradiction checks** (the notice against your own record) | the alleged offence time falls *inside* the window the user's KMS-signed session says they were legally parked; the notice cites a restriction the user's sign photo contradicts; the notice location differs from the GPS-verified address on the session | **only ParkProof** |

Contradiction checks work because ParkProof already holds a cryptographically signed, timestamped
record of what the sign said and when the car arrived. No competitor has that. It turns
the evidence chain from a nice-to-have into the thing that finds the defect.

## 3. Decisions locked

1. **Store vehicle registration.** Required for the strongest paperwork check. Held
   against the user's profile. Capture is **photo-first** (read it off the notice or
   the car photo via vision) rather than asking the user to type it. See §6 for the
   privacy design, which is not optional.
2. **Free tier shows ONE finding in full, plus the count of any others.** The strongest
   finding is revealed free. It is the most persuasive thing the product can say, and
   saying it free is also the best marketing the product has ("ParkProof told me my
   fine was wrong"). What is sold is the **remedy**, not the diagnosis: the formal
   appeal that argues the point, with signed evidence attached.
3. **Ship alongside the payment zone-number copy button.** One release.

## 4. Scope, v1

**In:**
- Photograph an infringement notice, extract its fields
- Run paperwork checks on the notice alone
- Run contradiction checks when a saved session plausibly matches (same day, nearby)
- Return a count of potential issues (free), detail + appeal (paid)

**Out (v1):**
- Judging whether the parking was *actually* legal, which the existing appeal flow already does
- Council-specific procedural rules (differs per council, needs research per LGA)
- Automated submission to councils (externally blocked: captchas, no public APIs)
- Any check that requires reading legislation live

## 5. The checks

### Paperwork checks (the notice against itself)

| Check | Signal | Confidence |
|---|---|---|
| Registration mismatch | notice rego != stored rego | high, when rego is stored |
| Date/time malformed or impossible | unparseable, future-dated, or 25:00 | high |
| Offence date outside restriction hours | notice time falls outside the hours the cited restriction can apply | medium |
| Missing authorised officer ID | field absent or unreadable | medium |
| Missing/!= issuing authority | no council named | medium |
| Offence code vs description mismatch | code says one thing, prose another | medium |
| Location does not resolve | street/suburb not geocodable | low, OCR often at fault |

### Contradiction checks (the notice against your signed record)

| Check | Signal | Confidence |
|---|---|---|
| Time inside a legal window | offence time within `arrived_at`..`expires_at` of a signed session at that location | **high** |
| Restriction contradiction | notice cites "No Standing", the session's sign read says "2P" | **high** |
| Location mismatch | notice street != session's GPS-verified reverse-geocoded address, beyond a tolerance | medium |
| Signed evidence exists at all | a KMS-signed record covering that time and place | supporting, not a defect |

Contradiction findings must cite the signed session ID so the appeal can reference verifiable
evidence.

## 6. Registration storage: privacy design

This is the first real PII ParkProof holds, and the product's brand is
anonymous-by-default. That promise stays intact under these rules:

- **Optional, and staying anonymous is a supported choice, not a degraded one.**
  Everything works without a rego; only the rego-mismatch check is skipped. Never
  require it, never gate a feature on it, never nag. Ask once, in context (when a
  notice is being checked), and accept it gladly if offered.
- **Local first.** Stored in `localStorage` like sessions. Mirrored to the user's
  DynamoDB profile *only if they are signed in*. Anonymous users never transmit it.
- **Never logged.** Rego must not appear in CloudWatch. The existing
  `[parkproof.feedback]` whitelist pattern is the model: whitelist fields, never
  pass through raw client objects.
- **Photo-first capture.** Read it from the notice or car photo with vision, show it
  for confirmation, let the user correct it. Less typing, fewer errors.
- **Included in export and delete.** `/me/export` and `/me/delete` must cover it.
- **Privacy Policy update is a launch blocker.** The policy currently describes a
  no-PII posture. It must say what is stored, where, why, and how to remove it.

## 7. UX flow and the three copy states

```
Session detail ──► "Got a ticket?" ──► photograph notice
                          │
                   [async job, vision + record comparison]
                          │
                          ▼
                 how many findings?
        ┌─────────────┼─────────────┐
      zero           one          two+
```

The pitch changes with the count. This is the crux of the design: with one finding
there is nothing left to "unlock", so the offer must shift from revealing information
to **acting on it**.

### Zero findings

Say so plainly. Do **not** upsell the pack on validity grounds, and do not manufacture
doubt. Route to the ordinary appeal flow, which argues the parking itself was legal.

> **This notice looks properly issued.**
> We checked it against your signed record from 14 Jul and found nothing obviously wrong
> with the paperwork. That does not mean you have to accept it. If you believe the
> parking was legal, we can still help you appeal.

### Exactly one finding: sell the remedy

Show it in full. Then pivot the offer to help, because there is nothing left to reveal.

> **One thing here is worth raising.**
> Your signed record shows you were still inside the 2-hour limit at 3:10pm, the time
> on this notice. You arrived at 2:05pm and the sign read 2P.
> *Evidence: signed session 14 Jul, GPS-verified, timestamp cryptographically sealed.*
>
> **We can help you put this to the council.**
> The Dispute Pack writes the formal appeal that argues this exact point and attaches
> your verifiable evidence. · $12.99

Copy rule: with one finding, never imply more exist. The value is the drafted argument,
the correct format, the deadline tracking, and the attached signed evidence.

### Two or more findings: reveal the strongest, sell the rest plus the remedy

> **2 things here are worth raising.**
> The strongest: your signed record shows you were still inside the 2-hour limit at
> 3:10pm, the time on this notice.
>
> **1 more issue found.** Unlock it and get the appeal letter that argues both. · $12.99

Always reveal the **highest-confidence** finding, not the first found, and prefer a
contradiction finding over a paperwork one. The free clue should be the most convincing
sentence the product can produce.

## 8. Language and liability rules

Non-negotiable. Getting this wrong sends someone into an appeal they lose, and turns a
trustworthy tool into a liability.

- **Never** "this fine is invalid / void / unenforceable."
- **Always** "this looks worth raising", "this appears inconsistent with your record."
- Every finding shows **the discrepancy and its evidence**, so the user judges it.
- Confidence is surfaced per finding, never hidden.
- A persistent line: *ParkProof is not legal advice. Councils make the final decision.*
- Never state or imply a success rate for an individual case.

## 9. Technical design

Reuses what exists. No new infrastructure.

- **Route:** `POST /check-notice`, async (202 + `job_id`), polled via
  `/check-notice/status/{job_id}`. Mirrors `/draft-appeal` exactly.
- **Model:** same Sonnet 4.6 vision call, JSON-schema enforced output. A new
  `NOTICE_SCHEMA` capturing extracted fields plus a `findings[]` array.
- **Contradiction checks** run as plain server-side comparison against the session record.
  No model call, so it is deterministic and free. This matters: the highest-confidence
  checks are the ones that are not AI-generated.
- **Entitlement:** the count is free; the `findings[]` detail is stripped from the
  response unless the caller holds a Dispute Pack entitlement.

New schema fields on the sign-translate response (for the zone button, §11):
`payment_zone_number: string | null`.

## 10. Metrics

| Metric | Why |
|---|---|
| Notices checked | demand |
| % with ≥1 finding | is the premise true? if very low, the feature is theatre |
| Free → Dispute Pack conversion, split by finding count | does the count actually entice? (decision 2) |
| Contradiction-check finding rate | is the moat real, or is it all generic paperwork checks? |
| Appeal outcome, when reported | the only metric that proves value |

If "% with ≥1 finding" is under ~15%, revisit. The feature only works if defects are
genuinely common.

## 11. Shipping alongside: payment zone-number copy

Unrelated but batched. AU parking apps publish **no** per-bay deep link
(see `src/lib/parking-apps.ts` research note), so pre-filling the app is impossible.
The achievable 80%: read the **zone number** off the sign, show it with a copy button
next to the existing Open EasyPark / Open PayStay buttons.

> Zone **1234** · tap to copy → Open PayStay

Removes the real friction (finding and remembering the zone) without a deep link.

## 12. Open questions

- Which councils to prioritise for procedural rules in v2? Melbourne, Yarra, Port
  Phillip cover most inner-Melbourne volume.
- ~~Should one contradiction finding be shown free?~~ **Resolved: yes.** The free clue
  doubles as the product's best word-of-mouth. What is sold is the remedy, not the
  diagnosis. See §7.
- Retention period for rego. Indefinite, or expire with the session?
