# Path C: Vault, tightened

**The idea in one line:** keep the vault, the cards and the component tree. Give each state its own colour, make the next tap the brightest thing on screen, and keep the seal for signed records only.

This is the disciplined polish option. It sits closest to the brief's Direction A ("Vault, refined"). It doesn't try to give ParkProof a new identity. It tries to make the current one mean something. Day 1 is the core and covers most of what a hiring PM would notice. The whole app takes 4.5 build days.

Files: `index.html` (mocks and token sheet), `preview.png` (full render), `assets/` (fixture photos and before thumbnails).

---

## What changes

### Colour
- **Three surfaces only.** `vault` #073B25 (page), `row` white at 7% (lists, notices, the active card) and `card` #FFFFFF (verdict, evidence pass, sheets). The body pinstripe goes. The guilloché moves onto the evidence pass, which is the one signed surface.
- **Four semantic tokens**, each measured against the surface it sits on:

| Token | Fill | Tint / ink on tint | On vault | Means |
|---|---|---|---|---|
| `ok` | #15803D, white text 5.02:1 | #E7F5EC / #14532D 8.10:1 | not defined | Go. Never brand pine. |
| `warn` | #F5A524, ink text 8.78:1 | #FFF4DB / #7A4300 7.31:1 | #FCC765, 8.12:1 (6.61 on row) | A condition or a doubt |
| `stop` | #C42B2B, white text 5.63:1 | #FDECEC / #9F1D1D 6.89:1 | #FF9B92, 6.23:1 (5.07 on row) | Stop, expired, danger |
| `signed` | seal disc #0E5C3A, 8.04:1 on card | chamfer + guilloché on the pass | mint #7BE3A4, 8.05:1 | Signed, live dot, selected chip |

- Text on the vault is #F8FBF9 (12.13:1) and muted text is sage #A9CFBE (7.44:1, or 6.05:1 on a row). On cards, ink is #0B1A14 (17.92:1) and ink-2 is #3C4A43 (9.32:1).
- Calm on the vault gets no colour on purpose. "2h 1m left" is plain white. Colour only appears when something needs attention.
- Links go neutral and underlined. Headlines get emphasis from weight, not mint ("in seconds." and "simple." lose their colour).
- Measured fixes: primary vs vault goes from 1.57 to 12.1:1. Disabled no longer beats enabled (it was 4.9 vs 1.6, now 3.2 vs 12.1, plus a reason line). The selected chip goes from 1.57 to 8.05:1. "Delete record" goes from 1.49 to 6.23:1. The back link (1.36:1) is fixed on the other branch.

### Type
- Keep the pairing: Space Grotesk for words, Inter for body, plus the Noto fallback.
- **Numbers move to Inter 800 tabular.** That takes Space Grotesk's flagged "1" out of "11:43", "1 hour left" and "1.1 km", and stops countdowns jittering.
- Scale as tokens: countdown 44/46, verdict 32/35, title 30/33, heading 17 to 22, body-l 16 to 17/22, body 15/22, meta 13/19, label 12/16.
- 13px is the floor for sentences and 12px is the floor for metadata. Only one uppercase label style is allowed, and only for Latin scripts. For el, hi and pa, labels are sentence case with no tracking, and Devanagari display text gets a line-height of at least 1.5.
- IBM Plex Mono is dropped (it was falling back to Courier). Hashes use the system `ui-monospace` stack and only appear under Technical details.

### Layout
- **One primary per screen, and it's the brightest thing on its surface.** On the vault that's a light fill with brand-900 text. On a card it's a pine fill.
- A **sticky, safe-area-aware action bar** on every screen that ends in a commit: result, Start parking, the saved moment. It's a solid vault bar with a 32px fade above it, so any reason line stays legible.
- **State decides the layout.** There are four verdict states. The home card has calm, warn, urgent and expired states. Active and ended records get different action rows.
- Photos become fixed-aspect thumbnails (48px in the verdict, 84px on the pass, 44px in Start parking) that you tap to expand. They can't push a commit off screen.
- The screen gutter drops from 24 to 20, which gives Greek and Hindi 8px more width.

### Components
- `Button` has four variants (primary, secondary, tertiary, destructive), each defined for the vault and for a card. Disabled is the same button at 40% with a reason line above it.
- A new `TextButton` primitive has a 44px minimum, built like `BackButton`.
- A selected chip is a mint fill with a tick. A success state is a confirmation row, not a grey button.
- Rule chips are neutral by default. A chip turns red only when it's a restriction in force now, and goes dashed amber when we couldn't read it.
- One notice pattern (row surface, round icon, title, body) and one docked bottom sheet (24px top radius, FeedbackModal behaviour).
- The **chamfer is now only for signed artefacts**: the evidence pass and the PDF. It comes off the verdict card, buttons, rows and sheets.
- The **evidence pass** is a certificate-style header on the record: status, address, phone times, photos, a perforation, then the seal at full size with "Signed by ParkProof" and the signing time.

### Motion
- There's one crafted moment. When a record is saved and signed, the seal stamps on (scale 1.15 to 1, a single mint pulse, 450 ms). Under `prefers-reduced-motion` it's static. The landing demo gets the same reduced-motion check and a pause.
- Nothing else animates beyond the existing transitions.

### Imagery
- The landing and first-run hero stop being an SVG with "VERIFIED RECORD" baked in. They use the real verdict component, which localises like the rest of the app.
- The AI hero photo with the visible sparkle watermark (`public/hero-illustration.png`) goes. Returning home uses the same skeleton as active home.
- The annotated Melbourne pole stays. Its dots now use app semantics: red for a restriction, amber for a condition, white for info.
- Empty states use the brand mark and a button. There's no illustration with text in it.

### Words (one pass, one owner)
- One verb: "Check a sign". One noun: "parking record". "No-sign park" replaces "unsigned spot". "Rules we read" replaces "bullets". "Signed by ParkProof at {time}" replaces "VERIFIED RECORD" and the base64 prefix.
- The result button is now "Park here", which opens "Start parking" and commits with "Start parking". "Save & remind me" goes, because it did neither.
- Legal fixes: no "Strong evidence" or "Strong case", "Reset to AI draft" becomes "Use the AI draft again", "verify your spot" goes, "covers when and where" is rewritten to the spec wording, "It softens a council review" becomes "Your own statement", "Council-ready" and "Your proof if you're ever wrongly ticketed" go, and the em-dashes on landing and verify go. The Hindi `result.transitionHeadsUp` string has an em-dash too.
- Add `scripts/lint-copy.mjs` to the definition of done. It fails on em-dashes and the banned list in every locale.

---

## How it fixes the 15 problems, by rank

| # | Problem | What Path C does | Status |
|---|---|---|---|
| 1 | The verdict card doesn't carry the verdict | Four designed states. Each one is a 6px state rule, a tinted header, an icon shape (tick, $, ISA, ?, stop) and its own headline. The condition goes in the headline ("You can park if you pay") and its action sits inside the card (PayStay, the tick). Unsure gets "probably", a dashed time and Retake in the card. Stop gives the reason, "You can park from 6:30 pm" and "Remind me at 6:30 pm". Chips go neutral, and only red when in force now. | Fixed |
| 2 | Primary is the dimmest thing on screen, 12+ button styles | Four variants × two surfaces. The light primary on the vault is 12.1:1. Disabled is dimmer than enabled and carries a reason. "Yes" and "Retake" are equal secondaries. The selected chip is filled with a tick. Success is a row. The ~30 raw buttons on the six key screens move to the primitive. The rest are linted, not rewritten. | Fixed |
| 3 | One green for everything | Semantic `ok`, `warn`, `stop` and `signed` tokens. Go gets its own green, and only on the white verdict card. Mint is limited to the seal, the live dot and the selected chip. Links are neutral. The pinstripe goes. No raw hex in components. **But the base is still dark green**, so brand, surface and "signed" still share a hue family. | Partly |
| 4 | The words break the spec's own rules | One copy pass, a glossary and a lint script. All legal-word violations from the brief are fixed in en. Changed strings go through an `_i18n_inject_polish.mjs` script with native review. | Fixed (en day 1, locales day 4) |
| 5 | The record leads with cryptography and ignores state | Evidence pass header: status, address, phone times, photos, then the seal and the signing time. There's one caveat line plus "What a signature shows". Active shows I've left and Walk back. Ended shows Export PDF and Draft an appeal. Signed parts, hashes and coordinates sit under Technical details with the copy unchanged. Delete moves to ⋯ with an in-app sheet. The "TapAdd noteto" bug dies with the new note row. | Fixed |
| 6 | Home card buries "I've left" and repaints like an error | Steady glass surface. Urgency goes in a band, the countdown colour and a depletion bar. Expired is the loudest state (red band, red outline, "Move now"). "I've left" is 48px in every state, paired with Walk back, and Walk back hides within about 50 m. One urgency function feeds home, the list, history and the record. "Check a sign" drops to secondary. | Fixed |
| 7 | Next action below the fold, photos eat the screen | Sticky bars on result, Start parking and the saved moment. Thumbnails replace full-width photos. The pay gate moves about a screen and a half higher. The scan-screen warnings above the image (19, 59) get the same rule but aren't mocked. | Mostly |
| 8 | Logging takes three screens and 8 to 11 taps | Logger and reminders merge into one Start parking screen. It uses scan-time GPS, a single car-photo slot and pre-selected reminder chips, then Start parking, so it's 3 taps from answer to signed record. This depends on the reminders branch landing first. | Fixed |
| 9 | Misses its own accessibility floor | `TextButton` at 44px, "I've left" at 48px, reminder chips at 48px. Danger at 6.23:1. Sentence floor at 13px. Timestamps are never truncated (hashes are). The focus ring on the vault becomes a 2px white outline (12.1:1), and the chamfer no longer clips button focus because buttons lose the chamfer. An iOS Larger Text check is in the day 4.5 pass, not mocked. | Mostly |
| 10 | Localisation renders wrong where it's most visible | `<html lang>` follows the locale. Per-script label rules. `Intl` for every time and date (history's hard-coded `en-AU` goes). Pills sit in normal flow. The first-run hero is the real component. Greek and Hindi frames prove the fit. Not done: a full sweep of aria and title literals. | Partly |
| 11 | No system underneath | Three surfaces, one notice, one sheet, the chamfer reserved, a type scale, one label style, and about 20 new `Icon.tsx` glyphs (stop, ?, info, $, ISA, clock, walk, globe, chevrons, more, trash). Deferred: the emoji tiles on About and the official Apple and Google marks. | Partly |
| 12 | Home has three layouts, first visit is a marketing page | The active home skeleton is fixed: header (mark + globe), state slot, Check a sign, then the list group. The globe has no flags and lists languages by name. The first-run and returning states use the same skeleton with the real verdict as the hero, but aren't mocked here. Install prompts move into the page flow after the first saved record. | Partly |
| 13 | Landing, app and verify look like three products | Landing: one tagline, one verb, the real verdict hero, no coral, no em-dash, no "VERIFIED RECORD". Verify gets reskinned to the app's type and colours on day 4 but keeps its structure and long walkthrough. | Partly |
| 14 | Scan, wait and fail feel like a web form | Cheap fixes only: one camera primary with library as a link, one accurate privacy line, loading shows the user's photo with "Complex signs can take up to 40 seconds" and a Cancel button, and the unreadable error names its cause, keeps the photo and offers "Retake photo" plus "Log without a reading". Not mocked. Not a scan redesign. | Partly |
| 15 | History is a stack of slabs | One surface, grouped into Parked now and Earlier, sorted by arrival, with the street as the headline. Status in words and colour. The seal only appears for a ParkProof signature, and "Not signed yet" otherwise. The empty state has a "Check a sign" button. | Fixed |

**Scorecard:** 7 fixed, 2 mostly, 6 partly. Nothing goes untouched, but the brief's Decision 0 (the base surface) is the trade this path makes on purpose.

---

## What it keeps

All of the brief's Keep list, and more of the current look than the other two directions:
- The dark vault itself, Space Grotesk with Inter, the P mark with its notch, and the production seal with the mint ring (now shown at 60px on the pass).
- The verdict's scale and wording ("You can park here", the "Until" pill, "2h 1m left"). Only the state colours and structure change.
- The home countdown as the hero, with urgency always stated in words.
- The gates and their severity order, moved up into the verdict card.
- Clarify, rule chips grouped by arrow or panel, "not in force today", the heads-up banner, "Did we read this right?", the reuse card and the photo-quality pre-check.
- The departure sheet's honest phone-clock copy (docked to the bottom edge).
- The signed-parts panel copy, word for word, now behind Technical details.
- Anonymous by default, the offline error, delete-account-by-typing-DELETE, and all the engineering hygiene (`BackButton`, `Input` at 16px, `.tnum`, dialog focus traps, reduced motion).

---

## Proposed change to the spec's "Design rules"

Replace the first two bullets of `docs/build/roadmap-build-spec.md` § Design rules with:

> - Vault identity: page background `vault #073B25` with no pattern. Three surfaces only: vault, `row` (white 7%) and `card` (white). Semantic colour comes from `ok`, `warn`, `stop` and `signed` tokens in `@theme`. Brand pine never stands in for go. Mint (#7BE3A4) is only for the seal ring, the live dot and the selected state. No raw hex in components.
> - One primary per screen, and it's the highest-contrast control on its surface: a light fill on the vault, a pine fill on a card. Use `ui/Button` (primary, secondary, tertiary, destructive) and `ui/TextButton`. Screens that end in a commit use `StickyActionBar`. Disabled = same button at 40% plus a reason line.
> - The chamfer, the guilloché and the full-size seal appear only on signed artefacts (the record's evidence pass and the PDF).
> - Type: Space Grotesk for words, Inter for body and all numerals (tabular). Floors are 13px for sentences and 12px for metadata. The uppercase label style is Latin only. For el, hi and pa, labels are sentence case with no tracking.
> - Photos are fixed-aspect thumbnails that expand on tap. Warnings go above the image, never under it.

Rules 3 to 7 (targets, modals, icons, `resizeImageFile`, sign-in, optional steps) stay as they are. Also fix the stale `paper-100` "app background" comment in `src/index.css`.

---

## Risks

1. **The vault still doesn't mean anything.** The seal becomes rare by count, not by surface. Direction B is stronger here because stepping onto the dark surface would itself mean "this is signed". If the deciding question is "is the seal the brand?", this path answers no.
2. **Bright sun.** The verdict is on a white card, so the key moment reads outdoors. But the home countdown and every list sit on dark green, which is the weakest of the three directions at midday.
3. **Go green vs pine** is only 1.6:1 in luminance. That's fine because go only appears on the white verdict card and always comes with a tick and words. Never use `ok` on the vault.
4. **A light primary on dark can look generic**, like any app's dark mode. Brand presence moves to the vault, the mark and the seal. That's acceptable, but the chamfered primary button goes away.
5. **Collision with the reminders branch.** Start parking merges the same two screens that branch is reworking. Land that branch first, then merge screens, or reminders get designed twice.
6. **Translation load.** About 40 keys change or get added, several of them legal. The el and hi strings in the mocks are drafts and need native review. Greek countdowns wrap to two lines by design.
7. **Polish invites scope creep.** The value of this path is that it stops. Anything not on the six screens or the token sheet waits for a real redesign.
8. **Partial on the long tail.** About 90 raw `<button>`s off the key screens, the About page, verify's structure and the scan flow only get lint and light fixes. A hiring PM who goes deep will still find seams.

---

## Effort (realistic build days, one developer with Claude Code)

| Day | Scope | Problems moved |
|---|---|---|
| **1 (the core, shippable on its own)** | `@theme` tokens, pinstripe removed, focus ring on the vault. `Button` variants + `StickyActionBar`. Verdict as 4 states with gates in the card, neutral chips and the photo thumbnail. Home card on a steady surface with band, bar and the 48px I've left row, plus one urgency function. "Park here" and the glossary verbs. en copy and legal fixes. | 1, 2, 3, 4 (en), 6, 7 (result) |
| 2 | Record evidence pass, state-driven actions, Technical details wrapper, ⋯ menu and delete sheet. History sorted and grouped, status lines, empty-state CTA. | 5, 15, 9 (danger) |
| 3 | Start parking (logger + reminders merged) and the saved-and-signed moment. Assumes the reminders branch has landed. Add 0.5 day if it hasn't. | 8, 7 |
| 4 | `lang` per locale, per-script label rules, `Intl` dates and times, `_i18n_inject_polish.mjs` across 8 locales plus a review pass. Landing first two viewports. Verify reskin. Globe language picker. | 10, 12, 13 |
| 4.5 | `TextButton`, the icon additions, scan/loading/error quick fixes, migrating visible raw buttons, the `lint-copy` script, an iOS Larger Text check, and a re-run of the screenshot harness. | 9, 11, 14 |

**Total: 4.5 days.** Day 1 alone gets roughly 60% of the visible improvement.

### Files that change
- `src/index.css`: tokens and utilities (below). Body background without the pinstripe. `.gf-card` limited to the pass. `.gf-btn` retired. `:lang(el|hi|pa)` label rules. Focus ring per surface.
- `src/components/ui/Button.tsx`, new `ui/TextButton.tsx`, new `ui/StickyActionBar.tsx`, new `ui/Notice.tsx`, new `ui/Sheet.tsx` (extracted from `FeedbackModal`).
- `src/components/ParkingResult.tsx`, `HeroAnswer.tsx` (replaced by the verdict component), and new `src/lib/verdict-state.ts` (a pure `go | conditional | unsure | stop` derivation with tests).
- `src/components/ActiveSessionCard.tsx`, `ActiveSessionsList.tsx`, `src/lib/countdown.ts` (one urgency function, 60 and 15 min thresholds), `src/App.tsx` (home skeleton and header).
- `src/components/LanguageSelector.tsx` (globe, names only, sets `document.documentElement.lang`). Drops the `country-flag-icons` dependency.
- `src/components/SessionDetail.tsx`, `ChainPanel.tsx` (layout only, copy untouched), `VerifiedSeal.tsx` (aria-label "Signed by ParkProof"), `DepartureSheet.tsx` (docked).
- `src/components/SessionHistory.tsx`.
- `src/components/SessionLogger.tsx` + `ReminderOptions.tsx`, merged into new `StartParking.tsx`, with `App.tsx` view-state updated (`logging` and `remind` collapse into `start`).
- `src/components/Icon.tsx` (about 20 glyphs), `SignScanner.tsx`, `LoadingProgress.tsx`, error view.
- `src/locales/*.json` via `scripts/_i18n_inject_polish.mjs`. New `scripts/lint-copy.mjs`.
- `migrations/two-app-architecture/landing-from-claude-design/index.html`, `landing-styles.css`, `verify/`.

### Tokens added to `@theme`
```
--color-row: rgb(255 255 255 / 0.07);   --color-row-line: rgb(255 255 255 / 0.10);
--color-on-vault: #F8FBF9;              --color-muted: #A9CFBE;
--color-ok: #15803D;    --color-ok-tint: #E7F5EC;    --color-ok-ink: #14532D;
--color-warn: #F5A524;  --color-warn-tint: #FFF4DB;  --color-warn-ink: #7A4300;  --color-warn-on-vault: #FCC765;
--color-stop: #C42B2B;  --color-stop-tint: #FDECEC;  --color-stop-ink: #9F1D1D;  --color-stop-on-vault: #FF9B92;
--color-signed: #0E5C3A;  (mint stays --color-mint)
--text-countdown: 2.75rem;  --text-verdict: 2rem;  --text-title: 1.875rem;  --text-meta: 0.8125rem;  --text-label: 0.75rem;
--radius-chip: 8px;  --radius-btn: 12px;  --radius-group: 16px;  --radius-card: 20px;
--shadow-e1: 0 1px 2px rgb(0 0 0 / .18), 0 10px 28px rgb(0 0 0 / .26);
--shadow-e2: 0 -10px 40px rgb(0 0 0 / .35);
```
Retired: `--text-2xs` (11px) as a content size, and the `accent-*` scale for UI states (the semantic tokens replace it).
