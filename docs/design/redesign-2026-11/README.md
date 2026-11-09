# ParkProof redesign, November 2026

**Decision (9 Nov 2026): Direction A, Plain Sign, built without its bottom tab bar.**

A UX review captured 81 to 125 screens of the app at phone size, critiqued them from four angles (visual design, flow, accessibility, brand and trust), and ranked the problems. Three designers then mocked up a direction each, and a judge scored them. Melroy chose A.

## What's here

| File | What it is |
|---|---|
| `brief.md` | The review brief: the ranked problems, what to keep, the design principles and the hard constraints |
| `verdict.md` | The judge's scores, the case for A, and the ideas to borrow from B and C |
| `direction-a/rationale.md` | Direction A in full: the idea, what changes, how it fixes each problem, risks and effort |
| `direction-a/mockups.html` | Direction A's phone mockups and token sheet. Open it in a browser (it loads Google Fonts) |
| `direction-b/rationale.md`, `direction-c/rationale.md` | The two directions not chosen, kept for the ideas the verdict borrows from them |

## Direction A in one paragraph

ParkProof speaks the kerb's own visual language. Every answer is a sign plate: go is a green P square, a condition is a yellow diamond with an ink edge, unsure is a dashed question mark, and stop is a red slashed P. Everyday screens are light (a warm kerb background with ink as the main colour), so they read in bright sun. The dark vault green appears only on signed things, such as the signed pass on a record and the saved moment. Landing on dark green means "this is signed".

## Changes to A, from the verdict

1. **No bottom tab bar.** Use a docked "Check a sign" button in the thumb zone instead (from B). App.tsx keeps its single state machine.
2. **The full signature sentence** on the pass, the saved moment, History and the PDF (from B). A signature shows the details existed, unchanged, by the signed time. It doesn't show they're true, who was driving, where the car was, or when it arrived or left.
3. **Two model fields first:** `next_can_park_at` and a per-rule `in_force_now` (from B). Fall back to hiding the line and keeping chips neutral, so nothing shows an invented time. Mind the schema budget test and `scripts/check-schema-compiles.mjs`: the sign schema is close to the API's grammar limit.
4. **When a park expires,** "I've left" becomes the main button (from B).
5. **No colour in the calm state.** The bar carries the green, so amber and red land harder (from C).
6. **A 20px side gutter** for Greek and Hindi (from C).
7. **Night tokens in Tier 2,** not Tier 3.
8. **Status bar.** The installed iPhone app changes from `black-translucent` to `default` in the same commit as the light background.

## Build order

1. **The logic layer first.** This part doesn't depend on the look: the four answer states (go, go with a condition, unsure, stop), one shared urgency rule, merging logging and reminders into Start parking, and record actions that follow the record's state.
2. **Then the look on its own branch,** shipped once every screen is done, including Settings, sign-in, appeal, About, verify and the landing. A half-light, half-dark app recreates the inconsistency the review found.
3. **About and the landing** (T10 items 3 and 4) are written as part of step 2.

**Effort.** The verdict puts the whole of A, without the tab bar, at 22 to 25 build days.
