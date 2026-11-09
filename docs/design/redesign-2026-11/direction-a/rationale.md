# Direction A: Plain Sign (bold reinvention)

**The idea in one line:** ParkProof turns a chaotic pole into one plain-English sign, so the app speaks the kerb's own visual language. Every answer is a sign plate, every record is a signed pass, and colour only ever means go, condition, stop or signed.

Mocks: `index.html` (20 frames plus a token sheet). Render: `preview.png`.

---

## Where this sits against Decision 0

This is not a fourth base surface. It answers the brief's deciding question the same way B does ("the seal is the brand, not the dark green"), then goes further than B on three fronts:

| | B, Daylight + Vault | C, Kerbside | **A, Plain Sign** |
|---|---|---|---|
| Base | Paper, vault for evidence | White sign panels | Warm kerb, vault for signed artefacts only |
| Primary button | Pine | Not specified | **Ink.** Green is taken by "go" |
| Brand colour in UI | Pine | Pine for evidence | **None.** Brand lives in the seal, the P mark and the vault |
| Semantics | ok / warn / stop | Sign green / sign red | Sign green, **sign yellow with an ink edge**, sign red, plus shape-coded glyphs |
| Type | Space Grotesk + Inter | Bold numerals | **Overpass** (Highway Gothic cousin) + Inter |
| Navigation | Unchanged | Unchanged | **Bottom dock** with a camera-shutter "Check a sign" |

If you like B but want it to stop a design-literate scroller, this is that version. If you want the cheapest credible fix, this is not it.

---

## What changes

### Colour
- **Base:** `kerb #F3F1EC` background, `plate #FFFFFF` cards and sheets, `sunk #EAE7E0` for tracks and wells. No pinstripe anywhere except a faint guilloché on the vault.
- **Ink is the brand's working colour.** `ink #111D17` for text, the primary button (17.3:1 white on ink) and selected chips.
- **Four signals and nothing else:**
  - `go #00703C` (6.2:1 on plate, white on it 6.2:1), tint `#E3F1E7`, ink `#005A30`
  - `warn #FFC72C` used only as a fill with ink on it (11.1:1), like a warning sign. Text version `warn-ink #7A4B00` (7.4:1)
  - `stop #C1122F` (6.2:1 both ways), tint `#FCEAEC`, ink `#A50E27`
  - `signed`: vault `#073B25`, seal `#0E5C3A`, mint `#7BE3A4` (8.1:1 on vault), sage `#A9CFBE` (7.4:1 on vault)
- **Mint never touches a light surface.** On the vault it is the seal ring, the live dot and the focus ring.
- Every pairing used in the mocks is AA or better. Measured ratios are on the token sheet.

### Type
- **Overpass** (Google Fonts, OFL) for numerals, headlines and addresses. It is an open-source face modelled on Highway Gothic, the US highway alphabet that Australia's AS 1744 sign lettering derives from. The numbers the driver reads on the pole and in the app are the same family of shapes.
- It replaces Space Grotesk, whose flagged "1" makes "11:43" and "1 hour left" read oddly on the most-read numbers in the app.
- **Inter** for body. **Overpass Mono** replaces IBM Plex Mono and its Courier fallback, and only appears under Technical details.
- **Noto Sans Devanagari and Gurmukhi** at 1.5 line height for hi and pa display text.
- **No uppercase and no tracking anywhere, in any locale.** One label style: Inter 600, 13px, sentence case. This deletes the Greek accent bug and the broken Devanagari headline stroke as a class, not one by one.
- Scale: countdown 84, verdict time 62, titles 29 to 34, addresses 19 to 26, body 15 to 17, label 13, metadata floor 12.

### Layout model
- **Bottom dock on Home and Records:** Home tab, a raised camera-shutter "Check a sign" in the centre, Records tab. The main action sits in the same thumb spot on every top-level screen.
- **One fixed header:** P badge and wordmark on the left, a globe (language, listed by name, no flags) and a gear (Settings) on the right. No more pill that moves between three positions.
- **Commit bar:** every screen that ends in a commit pins its one primary to the bottom, above the home indicator, with a reason line when it is disabled.
- **State decides the layout:** active records lead with time and actions, ended records lead with the signed pass.

### Components
- **Verdict plate** with four structural states: 8px top rule, tinted head and a shape-coded glyph.
  - Go: green rounded square with a P (the parking sign shape)
  - Condition: yellow diamond with an ink edge (the warning sign shape) carrying $ or the International Symbol of Access
  - Unsure: dashed ring with ?, a caution-tape top rule, and a dashed underline on the time
  - Stop: red ring with a slashed P (the No Parking shape)
- **Live parked plate** (home): steady white surface. Urgency rides on a yellow or red band, the countdown colour and a depletion bar.
- **Signed pass** (record, saved moment): the only square-cut object in the app. Vault, chamfer top-right, ticket perforation with side notches, seal at 60px, full signing time.
- **Four buttons and a prose link:** primary (ink), secondary (white, 1.5px ink outline), tertiary (underlined text, 44px), destructive (stop outline). Disabled keeps the shape at reduced strength plus a reason line. Success is a confirmation row.
- **Chips:** rule chips quote the sign and stay neutral. Only a restriction in force now turns red. "Not today" is dashed. Selectable chips are 44px pills, filled ink with a tick when on. Status chips: Active, minutes left, Expired, Ended.
- **Notice:** one pattern, three tones (info, condition, stop) with a 4px left rule.
- **Sheet:** docked bottom sheet, grabber, 24px top radius, safe-area padding, FeedbackModal focus rules.
- **Icons:** about 25 new stroke icons through `Icon.tsx` (home, gear, globe, clock, walk-back arrow, leave, info, stop, more, lock, doc, ticket, cloud, copy, refresh, external, close, trash, arrows, ISA, dollar, edit, chevrons). No emoji, no typographic ticks.

### Motion
- Verdict plate rises 12px and fades in (200ms). The top rule wipes left to right (280ms).
- Reading screen shows the user's own photo with the landing's scan sweep, honest timing ("Complex signs can take up to 40 seconds") and Cancel.
- Countdown bar depletes once a minute. Band changes cross-fade.
- **The only celebration:** the seal stamps on (1.15 to 1, 450ms) with one mint pulse on the saved moment.
- Everything jumps to its final frame under `prefers-reduced-motion`.

### Imagery
- The user's own photos as fixed-aspect, cropped thumbnails. The verdict header carries a 44px thumbnail of the sign photo instead of a "View the photo" disclosure.
- The landing keeps the real annotated Melbourne pole. Its callouts use the app's own signal colours, so the landing teaches the grammar.
- Illustrations carry no words. The empty state is the Datum P on a blank sign plate.
- `public/hero-illustration.png` (AI sparkle watermark, logo on a fake sign) is retired.

---

## How it fixes the top problems, by rank

1. **The verdict doesn't carry the verdict.** Four designed states, each structural (rule, tint, glyph shape). The condition is the headline ("You can park if you pay", "Accessible permit holders only", "You can probably park here"). The gate's action sits inside the plate. Stop names the reason and the next legal time, and its primary becomes "Remind me at 6:30 pm". (R1 to R5)
2. **Dim primaries, 12+ button styles.** Ink primary is the highest-contrast control on every light surface. Four variants plus a link. Disabled keeps its shape and says why. Selected chips are filled ink with a tick. Success is a row.
3. **One green for everything.** The brand stops using green in the UI. Green means go and valid signature, and nothing else. No raw hex in components (lint rule). Headlines get emphasis from weight, not colour.
4. **Words that break the spec.** Every string in the mocks follows the copy rules: no "verified", no "strong", no "council-ready", no em-dashes. Signed material always says what a signature shows and doesn't. Glossary used throughout: "Check a sign", "Start parking", "parking record", "no-sign park", "the rules we read". Hashes, key alias and coordinates only under Technical details.
5. **Record leads with cryptography and ignores state.** Active: countdown, Walk back and I've left first, pass second, no appeal. Ended: pass first, Export PDF and Draft an appeal pinned, no Walk back. Seal at full size with the untruncated signing time. Delete moves to the overflow in stop red with an in-app confirm. (P1 to P3)
6. **Active home card.** Steady white plate. "I've left" is a 52px button in every state. Walk back appears with its distance only beyond about 50 m. Expired is now the loudest state. One shared urgency function for home, Records and the record. (H1 to H4)
7. **Next action below the fold.** Commit bar on every commit screen. Photos are cropped thumbnails. Blocking notices sit inside the plate, above any image.
8. **Logging is three screens.** One "Start parking" sheet replaces logger and remind: scan-time address with Edit, optional car photo, reminder chips, the channel line, the reliability line, one Start. One tap on the common path. (S1, S2)
9. **Accessibility floor.** 44px minimum on every control in the mocks, 13px floor for sentences, 12px for metadata, timestamps never truncated, danger actions at AA. Focus ring is 3px ink on light, mint on the vault.
10. **Localisation renders wrong.** `lang` set per locale, no uppercase or tracking anywhere, pills in normal flow, Intl times ("12:43 μ.μ."), locale word order ("12:43 pm तक"). Rule chips stay in the sign's English because they quote the pole. (H5, R6)
11. **No system underneath.** Three surfaces, one notice, one sheet, chamfer reserved for signed artefacts, one label style, one icon set.
12. **Home has three layouts.** One skeleton: header, state slot, dock. The first-run hero becomes the real, localised verdict plate. Install and sign-in prompts move into the page flow after the first saved record.
13. **Landing, app and verify look like three products.** Same plate, type and signals on the landing. "Can I park here?" as the headline, one CTA, no coral or red "?" badges. Verify follows as a light document layout in Overpass and Inter (not mocked, scoped below).
14. **Scan, wait and fail feel like a web form.** Not mocked, but specified in the motion and component rules: one camera primary with a framing hint, library as a text link, the user's photo with a scan sweep while loading, honest timing, Cancel, and errors that keep the photo.
15. **History is unordered slabs.** Grouped list (Parked now, then Earlier), sorted by arrival, address as headline, status chip, sign thumbnail, seal only on production signatures, and a footnote on what the seal means. The empty state has a "Check a sign" button. (L1, L2)

---

## What it keeps

- **The verdict's wording and hierarchy.** "You can park here", then the time, then the time left. The "Until 12:43 pm" pill becomes 62px numerals in the same slot. I'm arguing for that change: a pill caps the size of the most important number on screen.
- **The home countdown as the hero,** bigger (84px) and tabular, with urgency always stated in words.
- **The production seal with its mint ring and the Datum P with the notch.** Both get scarcer. The seal gains one small variant for the vault (a sage guilloché rim instead of a pine one that disappears on dark).
- **The chamfer,** now only on signed artefacts.
- **Inter body and the Noto fallback.** Space Grotesk is replaced, and I'm arguing for that (see Type).
- **The gates** in severity order, moved into the plate.
- **Clarify, rule chips grouped by arrow or panel, "not in force today", the heads-up notice, "Did we read this right?"** with fixed button weights.
- **The departure sheet,** docked to the bottom edge, honest phone-clock copy unchanged.
- **The signed-parts panel:** collapsed by default, plain part names, phone times kept apart from signing times, dev-key wording.
- **Photo-quality pre-check, reuse card, history thumbnails, the Melbourne problem section, anonymous by default, DELETE-to-confirm, the offline error.**
- **Engineering hygiene:** BackButton's 44px hit area, 16px inputs, `.tnum`, focus traps, reduced-motion handling.

---

## Risks (honest)

1. **It's the most expensive of the three.** Every screen changes, plus navigation. On a four-to-six-week runway with live interviews and SubToll waiting, that is real opportunity cost.
2. **Navigation is a model change, not a restyle.** The dock adds tabs to a view-state machine in `App.tsx` that has no tabs today. Deep links (`?session=`), back behaviour and the OAuth callback landing all need checking.
3. **The stop state needs data the model may not return.** "You can park from 6:30 pm" needs a reliable next-legal-time. `next_transition` exists but is only a heads-up within about 3 hours. A `can_park_from` field plus prompt examples plus an eval run is needed, or the stop plate falls back to "Check the sign for when parking opens". Never invent a time.
4. **Light UI at 11 pm.** Kerb white is right in sun and harsh in a dark street. Night tokens are drafted (bg `#0F1613`, plate `#1A2420`, ink `#EEF2EF` 14.1:1, go `#4CCB88` 7.8:1, stop `#FF7A88` 6.4:1, warn fill unchanged 10.2:1), but they are Tier 3, not in these mocks.
5. **It can tip into "council app".** Sign grammar is the point, and also the risk. The warm kerb, editorial numerals and the vault ceremony are what keep it consumer. If someone reads it as a government form, cut the glyph borders before cutting the grammar.
6. **Yellow on white is a weak edge** (1.6:1). Mitigated: yellow only carries ink text (11:1), glyphs have an ink edge, bands have an inset line. Don't let anyone use yellow as text.
7. **Overpass has no Greek.** Greek headings fall to Inter (as Greek falls from Space Grotesk today). Numerals stay Overpass in every locale, so the most-read content is consistent.
8. **Brand equity.** The vault identity shipped recently and is on the landing, OG image and app icon. The icon and P badge stay on the vault tile, so the home screen icon doesn't change. The OG image and landing do.
9. **Status bar:** the installed iPhone app uses `black-translucent` (white clock). A light UI needs `default`, plus `theme-color` and manifest colours moved to kerb. Small change, easy to forget, ugly if missed.
10. **New strings in nine locales.** Around 40 new or changed keys (Start parking, Parked now, Under an hour left, Move now, You can park from, glossary renames). Greek and Hindi in the mocks are my drafts and need a native check.
11. **Collision with the in-flight branch.** The "Remind me" rework becomes part of the Start parking sheet. Merge that branch first, then build the sheet on its logic, or reminders get redesigned twice.

---

## Effort

Realistic build days for one person with Claude Code doing the typing, including tests and locale work. Assumes the in-flight reminders branch has merged.

| Tier | Work | Days |
|---|---|---|
| **Tier 1, must** (the six mocked areas, shippable alone) | Copy pass and glossary, em-dash and banned-word lint | 1.5 |
| | Tokens in `@theme`, fonts, status bar and manifest colours, no-raw-hex lint | 1 |
| | Primitives: Button (4 + link), Chip set, Notice, Sheet, CommitBar, Dock, VerdictGlyph, icons, seal variant | 2 |
| | Shell: header, dock, tabs, home skeleton | 2 |
| | Result: verdict state derivation, plate, gates in card, commit bar | 2.5 |
| | Start parking sheet and saved moment (logger and reminders merged) | 3 |
| | Home live plate, shared urgency function, two-park layout | 1.5 |
| | Record: pass, state-driven layout, signed parts, Technical details, overflow delete | 2.5 |
| | Records list and empty state | 1 |
| | **Tier 1 total** | **17** |
| **Tier 2, should** | Scan, loading, error restyle | 1.5 |
| | Settings, auth, appeal, notice lookup, clarify, reuse, install prompts, about, privacy, feedback | 3 |
| | i18n and a11y QA: `lang`, Intl dates, Larger Text, VoiceOver, screenshot harness re-run, test updates | 2.5 |
| | `can_park_from` schema, prompt examples, eval run | 1.5 |
| | **Tier 2 total** | **8.5** |
| **Tier 3, defer** | Landing restyle and verify page in nine locales, OG image | 3 |
| | Night mode | 2 |
| | PDF cover band in the vault style | 0.5 |
| **Tier 4, skip** | Custom illustration set, animated sign-flip transitions, a custom typeface, a council-sign icon library | 0 |

**Whole app: about 25 to 31 build days** (Tier 1 to 3). **Tier 1 alone: about 17.**

### Files that change
- `src/index.css`: full `@theme` rewrite (kerb, plate, sunk, line, edge, ink 1 to 3, go, warn, stop with tint and ink, vault, seal, mint, sage, radius, shadows, font tokens), `[lang]` per-script rules, `.gf-card` becomes `.pass` only, `.gf-btn` retired, focus ring ink and mint, body background kerb.
- `index.html`: Overpass and Overpass Mono in, Space Grotesk and IBM Plex Mono out, `theme-color`, `apple-mobile-web-app-status-bar-style` to `default`.
- `vite.config.ts`: manifest `theme_color` and `background_color`.
- `src/components/ui/`: `Button.tsx` (4 variants and TextButton), `Card.tsx` (Plate, Pass), `Alert.tsx` becomes Notice, `Input.tsx`, `BackButton.tsx`. New: `Chip.tsx`, `Sheet.tsx`, `CommitBar.tsx`, `Dock.tsx`.
- New: `VerdictPlate.tsx` (replaces `HeroAnswer.tsx`), `VerdictGlyph.tsx`, `StartParkingSheet.tsx` (replaces `SessionLogger.tsx` and `ReminderOptions.tsx` as screens), `src/lib/urgency.ts`, `src/lib/verdict-state.ts`.
- `Icon.tsx` (about 25 icons), `VerifiedSeal.tsx` (vault variant, aria-label "Signed by ParkProof"), `BrandMark.tsx` (unchanged shapes).
- `App.tsx` (shell, tabs, merged start state), `ActiveSessionCard.tsx`, `ActiveSessionsList.tsx` (folds into home), `ParkingResult.tsx`, `Clarify.tsx`, `SessionDetail.tsx`, `ChainPanel.tsx`, `DepartureSheet.tsx`, `DepartureRow.tsx`, `ScheduledRemindersSection.tsx`, `SessionHistory.tsx`, `SignScanner.tsx`, `LoadingProgress.tsx`, `LandingFeatures.tsx`, `LanguageSelector.tsx`, plus the Tier 2 screens.
- `src/locales/*.json` (9) through `scripts/_i18n_inject_plainsign.mjs`.
- `lambda/index.js` and `src/types.ts` for `can_park_from` (Tier 2).
- `migrations/two-app-architecture/landing-from-claude-design/` (`index.html`, `landing-styles.css`, `landing-demo.js`, `verify/*`, `og-image.png`) for Tier 3.
- About 15 test files with text queries for renamed strings.

---

## Proposed rewrite of the spec's "Design rules"

Replace the first two bullets in `docs/build/roadmap-build-spec.md` with:

- **Plain Sign identity.** Kerb `#F3F1EC` background, white plates, ink `#111D17` for text and the primary button. Colour only for signals: `go`, `warn`, `stop`, `signed`. The vault `#073B25`, the seal and mint appear only on signed artefacts (the pass, the saved moment, the PDF cover). Overpass for numerals and headlines, Inter for body, Noto Devanagari and Gurmukhi at 1.5 line height.
- **No raw hex in components.** Tokens from `@theme` only, enforced by lint.
- **Rounded is everyday, cut is signed.** 16px plates, 12px controls, 8px chips, 24px sheets. The chamfer appears only on signed artefacts.
- **One primary per screen,** the highest-contrast control on its surface. Screens that end in a commit pin it in the CommitBar. Disabled states keep their shape and show a reason line.
- **Labels are sentence case,** Inter 600 13px, never uppercase, never tracked, in any locale.
- **Verdict states are structural:** top rule, tint and glyph shape, with words as the backup. Rule chips stay neutral unless a restriction is in force now.
- **Every new screen is checked once in Greek or Hindi** and at iOS Larger Text before merge.

The remaining bullets (44px targets, FeedbackModal sheet pattern, icons in `Icon.tsx`, `resizeImageFile`, no sign-in gate, optional steps collapsed, common path never slower) stay as written.

---

## My call on this direction

Build Tier 1 only if the honest answer to "is the dark green the brand?" is no, and you can spare about 17 days before SubToll starts. If the interviews need a portfolio refresh sooner than that, take B's surface split and steal three things from here: ink primary, the four-state verdict plate and the Start parking sheet. That is about 7 days and gets most of the "this person has taste" signal.
