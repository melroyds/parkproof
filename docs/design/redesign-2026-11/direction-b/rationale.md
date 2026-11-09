# Direction B: Vault, lit (premium evolution)

**The idea in one line:** keep the vault, the mint and the type, but make the vault a stage instead of a page. Bright paper carries everything you read, and only meaning is allowed to glow: the verdict's state, the countdown's urgency and the seal.

Files: `index.html` (20 phone frames plus the token sheet), `preview.png` (full render at 2800px wide), `img/` (fixture photos, the car photo cropped so the generator watermark is out of frame).

---

## The call in 30 seconds

- **Pick this if the dark green is the brand to you.** Every screen still opens on the vault, so ParkProof still looks like ParkProof at a glance. What changes is underneath: one type scale, one spacing grid, three surfaces, four button variants, semantic colour tokens and a pass component for signed records.
- **What it gives up versus the brief's Daylight + Vault pick:** in Daylight, stepping onto dark green *means* "this is signed". Here the vault is on every screen, so it can't carry that meaning. Instead, "signed" is carried by the **pass shape** (white card, one chamfered corner), the **guilloché** texture and the **seal**. That's a weaker signal than a whole surface change, and it's the honest cost of keeping the identity.
- **What it does better than Vault refined:** nothing you read sits on the vault any more. Rules, gates, records and settings live on paper and white cards, which is what fixes sunlight contrast and frees green to mean go.

---

## What changes

### Colour
- **Three surfaces on paper, glass on the vault.** `paper #F3F6F4` for sheets, `card #FFFFFF` for content, `paper-2 #E9EEEB` for icon tiles and neutral chips. On the vault, depth is a lighter surface (`glass`, white at 8% and 14%), never a shadow.
- **Meaning tokens, each with fill, tint and ink:** `ok #0B8545`, `warn #F4B536`, `stop #C8281E`, plus `mint #7BE3A4` for signed. Measured ratios are on the token sheet. Every text pairing is 4.5:1 or better, every bar and edge 3:1 or better.
- **Go is not brand pine.** Go is a brighter, lighter signal green that only appears on the verdict band, the "Parked now" band and progress bars. The vault is near-black green and is only ever a background. Mint is the seal ring, the live dot and the tick in a selected chip. Nothing else.
- **The pinstripe is gone from the page.** Texture survives only as the guilloché on signed passes.
- **Primary is the inverse of its surface.** Vault fill with white text on paper, white fill with vault text on the vault. Both 12.6:1. The brightest control on any surface is always its primary.
- **Links are neutral and underlined.** No mint links, no coral, no electric blue.

### Type
- **Space Grotesk for display words, Inter for every numeral.** The flagged "1" disappears from "11:43", "1 hour left" and "1.1 km". In code, a `PP Display` `@font-face` with `unicode-range` maps digits to Inter, so a headline like "Permit Area 12 only right now" also gets Inter digits without anyone remembering to.
- **Nine styles as tokens:** num-xl 50, num-lg 40, display 30 to 32, title 17 to 20, heading 16 to 18, body 15 to 17, label 13, meta 12, mono 12.5. Floors are 13px for sentences and 12px for metadata.
- **One label style:** Inter 600 13px, sentence case, never uppercase, never tracked. That one rule fixes Greek accents on capitals, broken Devanagari headstrokes and the three competing label styles.
- **Per-script tokens:** `:lang(hi)` and `:lang(pa)` get 1.45 display leading and 1.6 body leading, no letter-spacing. `<html lang>` follows the locale.
- **Mono is IBM Plex Mono, actually loaded,** and only inside Technical details.

### Layout
- **One skeleton everywhere: stage, sheet, dock.** The vault stage holds the header, the title and the one live thing (the pass, the verdict, the countdown). A paper sheet holds the reading. A sticky, safe-area-aware dock holds the commit.
- **Home** has one skeleton for every state: header (logo, globe, settings), the live pass, a sheet of places to go (Parking records, Draft an appeal, Back up your records), and **Check a sign** docked in the thumb zone.
- **Result** puts your sign photo in the top bar as a thumbnail (replacing the "View the photo" row) and pins the commit to the bottom.
- **Record** is ordered by state. Active leads with the countdown and its two actions, then the pass. Ended leads with the pass, then Export PDF and Draft an appeal.
- **Photos are fixed-aspect thumbnails** (64px on passes, 52px in lists), cropped to fill, tap to expand.

### Components
- **Pass:** the signed-record card. White, rounded corners, one 22px chamfer top right, optional status band, guilloché, seal. Used on home, the record screen and the saved moment. Nothing unsigned gets the cut.
- **Verdict card:** a white card whose top band *is* the state (go, condition, doubt, stop), each with its own icon shape and words. The condition's action lives inside the card.
- **Buttons:** primary (56), secondary (48, 1.5px edge), tertiary (44, text with icon), destructive (stop-ink text, solid only inside a confirm). Disabled is the same hue at 36% plus a reason line above it.
- **Chips:** rule chips are neutral, turn stop-red only for a rule in force now, go dashed amber with a question mark when unreadable, and go dashed grey when "not in force today". Reminder chips are pill-shaped and, when selected, filled vault with a mint tick.
- **Status chip:** Active, Move soon, Expired, Ended, No expiry, Not signed yet.
- **Notice:** one pattern (icon disc, title, body) in four tints: info, ok, warn, stop.
- **Sheet:** docked to the bottom edge, 28px top radius, handle, follows the FeedbackModal rules (`role="dialog"`, `aria-modal`, focus trap, Escape closes). The departure sheet and Start parking both use it.

### Motion
- **Press:** 120ms, scale 0.98, no colour flash.
- **State change:** 220ms for chip select, band colour and countdown tier.
- **Sheet rise and verdict reveal:** 420ms. The band lands first, then the time.
- **Seal stamp:** 600ms, once, only on the saved-and-signed moment. It's the one bounce in the product.
- **Easing:** `cubic-bezier(.2,.8,.2,1)`. Under `prefers-reduced-motion`, everything becomes a crossfade or a static final frame.

### Imagery
- **The first-run hero is the real verdict component,** rendered live and localised. No "VERIFIED RECORD", no KMS hash, no text baked into art.
- **`public/hero-illustration.png` is retired** (AI sparkle watermark, logo on a fake street sign).
- **The annotated Melbourne pole stays** as the landing's hero image. Its pins use the app's meaning colours.
- **Icons all come from `Icon.tsx`.** New ones: stop, help, access (International Symbol of Access), card, leave, walk, globe, sliders, key, trash, clock, refresh, external link, download, chevrons and arrows. No emoji, no typographic ticks, no native disclosure triangles.

---

## How it fixes the top problems, by rank

| # | Problem | What this direction does | Frames |
|---|---|---|---|
| 1 | The verdict card doesn't carry the verdict | Four designed states. The band is the state, with its own icon and words: "You can park here", "You can park if you pay", "You can park with an accessible permit", "You can probably park here", "Don't park here". The gate sits inside the card. Stop gives a reason, "You can park from 6:30 pm" and "Remind me when I can park". | Result, all six |
| 2 | Primary is the dimmest thing, 12+ button styles | Primary is the inverse of its surface and always the brightest control on it. Four variants. Disabled keeps its hue at 36% and adds a reason line. Success is a row, not a grey button. Selected chips are filled and ticked. "Yes, looks right" and "Retake" are equal secondaries. | Every frame, token sheet |
| 3 | One green for everything | Semantic tokens. Go green only on verdict, band and bar. Vault only as a background. Mint only for seal, live dot and selected tick. Headlines get emphasis from weight ("in seconds." is Space Grotesk 400). No raw hex in components. | Token sheet, landing |
| 4 | The words break the spec's own rules | Every new string in the mocks is legal-checked: no "verified", no "strong", no outcome promises. The full "what a signature shows" sentence appears wherever the seal does. Phone times and signing times are labelled apart. "Check a sign", "parking record", "No-sign park", "rules we read", "Technical details". Raw base64, UUIDs and coordinates are gone from the front. | Record, Start parking, saved moment |
| 5 | Record leads with cryptography and ignores state | The evidence pass: status, address, three times with their sources, photo thumbnails, full-size seal, "Signed by ParkProof, Tue 10 Nov, 10:42 am AEDT" never truncated, one sentence. Active shows countdown, I've left and Walk back. Ended shows Export PDF and Draft an appeal. Delete moves to the overflow. Signed parts read as a chain. | Record, all three |
| 6 | "I've left" is buried, the card repaints like an error | Steady white pass. Urgency is a band, the countdown's ink colour and a depletion bar. Expired is the loudest state (solid stop band, red edge, striped bar, "Move now") and promotes "I've left" to the screen's primary. "I've left" is 48px or bigger in every state. Walk back hides within about 50 m. | Home, all five |
| 7 | Next action below the fold, photos eat the screen | The dock pins the commit on every commit screen. Photos are thumbnails. The sign photo is a 44px button in the top bar. | Result, Start parking |
| 8 | Logging is three screens and 8 to 11 taps | Option (b): one docked "Start parking" sheet over the result, with address, one car-photo slot, reminder chips, delivery line and reliability line. Park here, Start parking. Two taps. The optional extras (car photo, note) come after the commit. | Start parking, saved moment |
| 9 | Misses its own accessibility floor | 44px tertiary, 48px secondary, 56px primary. 13px and 12px floors. Destructive at 7.4:1. Gate reason lines in ink-2 on white. Measured ratios on the token sheet. | Token sheet |
| 10 | Localisation renders wrong | No uppercase anywhere. `lang` per locale. Per-script leading. The second park is a stacked pass in normal flow, not an absolute pill. The countdown splits number from word, and the "until" string is split around its time so Hindi puts तक after it. `Intl` for times, durations and decimals ("1,1 km", "11:43 π.μ."). | Home Greek, Result Hindi |
| 11 | No system underneath | Three surfaces, one notice, one sheet, one chip family, one label style, nine type tokens, a 4pt grid, five radii, three elevations. Chamfer reserved for passes. Every icon in Icon.tsx. | Token sheet |
| 12 | Three home layouts, a second marketing page | One home skeleton, with the state slot at the top and Check a sign always docked in the same place. Globe with a locale code, no flags. Sign-in becomes a "Back up your records" row in the sheet, never over the CTA. | Home |
| 13 | Landing, app and verify look like three products | The landing uses the same stage, paper, buttons and verdict component. One tagline ("Read any Aussie parking sign in seconds."), one verb ("Check a sign"). No coral, no red "?" badges. Verify becomes a paper document page in the app's type (not mocked, same components). | Landing, both |
| 14 | Scan, wait and fail feel like a web form | Not mocked. The system answers it directly: one camera primary, library as a tertiary, the loading screen on the vault stage with your own photo and an honest "up to 40 seconds", errors as a stop notice that keeps the photo. | (system) |
| 15 | History is a stack of slabs | A grouped list on one surface (Parked now, Earlier), sorted by arrival, address as headline, status chip, thumbnail kept, seal only on production signatures, "Not signed yet" when it isn't. The empty state ends in Check a sign. | History, both |

---

## What it keeps

- **The verdict's scale and wording.** "You can park here" is still the biggest thing on the result. I made one change: the "Until 12:43 pm" pill becomes a label plus a 40px numeral, with "2h 1m left" in the pill. The time is the most-read number in the app and it deserved more than a pill.
- **The home countdown as the hero,** with urgency in words ("Move soon", "Move now", "Expired at 12:43 pm") and tabular numerals.
- **The production seal with the mint ring, and the P mark with the notch.** Both untouched, both rarer.
- **The chamfer, for signed artefacts only.** I'm bending one keeper here, so I'm arguing it: the other three corners are now rounded. Before, sharp corners plus a chamfer read as "engineered". Now, rounded corners plus one deliberate cut read as "this one is different", and the pass sits in the same family as every other card.
- **Space Grotesk with Inter,** with the Noto fallback. Numerals move to Inter.
- **The gates** in severity order (pay, permit zone, accessible permit), moved up into the verdict. The accessible-permit gate is the only one on a stop tint, and it offers "No permit? Check a different spot" first.
- **Clarify, rule chips grouped by panel or arrow, the rule-change heads-up** (now a standard info notice), **"Did we read this right?"** with fixed weights, the **departure sheet** docked to the bottom, the **signed-parts panel** collapsed by default with plain part names, **sign thumbnails** in history, the **Melbourne problem** section, **anonymous by default**, and the engineering hygiene (44px BackButton, 16px inputs, `.tnum`, the inset focus ring, focus traps, reduced motion).

---

## What changes in the spec's "Design rules"

Replace the first two bullets with:

- **Identity:** the vault (`--color-vault #073B25`) is the stage at the top of every screen and the background of the saved moment. It is never a reading surface. Reading happens on `paper` sheets and `card` surfaces. Space Grotesk for display words, Inter for body and every numeral.
- **Meaning:** `ok`, `warn`, `stop` and `signed` (mint) are the only accent colours, and each means one thing. No raw hex in components. Links are neutral and underlined. Headlines get emphasis from weight, never colour.
- **Signed things:** the pass shape (one 22px chamfer), the guilloché and the seal appear only on signed records. A dev-key record shows the development-key line instead of the seal.
- **Structure:** every screen is stage, sheet and dock. Every screen has one primary, the inverse of its surface, and every commit screen pins it in the dock with safe-area padding.
- **Type and labels:** use the type tokens only. One label style, Inter 600 13px, sentence case. Never uppercase, never tracked, in any locale.

Keep the rest (44px targets, the FeedbackModal sheet rules, Icon.tsx, `resizeImageFile`, no sign-in gates, optional steps collapsed). Change "Optional steps are collapsed by default" to "Optional steps come after the commit or stay collapsed".

---

## Copy this direction needs

**New English strings** (all checked against the copy rules): "Check a sign", "Check another sign", "Park here", "Start parking", "Parking started", "Saved and signed by ParkProof at {{time}}", "Move soon", "You can park if you pay", "You can park with an accessible permit", "You can probably park here", "Probably until", "You can park from", "Remind me when I can park", "Check the end time on the sign. Part of it is hidden by foliage." (model-provided reason), "Tick "I've paid" above to park here", "No permit? Check a different spot", "Retake closer", "Back up your records", "Not signed yet", "No-sign park", "Technical details", "Last signed", "Your note", "How a council can check this record" (replaces "How a council can verify this record →"), "Compare the rules we read with the actual sign before you leave the car." Roughly 40 keys across 9 locales through one inject script.

**Draft translations in the mocks, for review:** el "Μετακίνηση σύντομα" and "απομένουν". hi: the condition headline, "साइन जाँच" and "यहाँ पार्क करें".

**Existing locale bugs found while building the mocks:**
- hi `result.payRequired.ack` ends "करूँगा", a masculine first person. The i18n rules ban gendered first person in hi and pa. The mock shows it as it ships today. Fix it.
- el and hi `history.emptyHelp` both contain an em-dash, and hi `result.transitionHeadsUp` is "ध्यान दें — {{when}} पर". The English rule should apply to every locale. Add the em-dash lint to the locale parity test.

**Two schema additions the result screen needs** (both optional, both additive):
- `next_can_park_at` (ISO) on a can't-park answer, for "You can park from 6:30 pm". Without it, fall back to `next_transition`, or hide the line.
- An `in_force_now` flag per observation item, so only live rules turn red. Today "not in force today" is just text the model appends.

---

## Risks

1. **The vault means less than in Daylight.** It's on every screen, so it can't be the "signed" signal. The pass, guilloché and seal have to carry that alone. If a hiring PM doesn't read the pass as special, the evidence story gets quieter. Mitigation: the saved moment is the only full-vault screen, and it's where the seal stamps.
2. **Two greens on one screen.** The go band (`#0B8545`) sits on the vault at 2.7:1. It reads as distinct because it's attached to a white card, carries a white icon disc and says the words. For deuteranopes it'll look like a brighter band, not a different colour, which is why the shape and words are mandatory.
3. **Amber does two jobs** (condition and doubt). They're separated by icon (card, access, question mark) and by wording. If testing shows people confuse them, give doubt a dashed band edge as well.
4. **Clip-path chamfer with rounded corners clips focus rings and shadows.** Shadows go on a wrapper (`filter: drop-shadow`), and focus uses the existing inset double ring. Already a known pattern in `.gf-btn`.
5. **Short phones.** On an iPhone SE (667px), the home pass plus the dock leaves the sheet below the fold. That's acceptable, since the primary is docked, but every screen needs a pass at 667 and at iOS Larger Text.
6. **Start parking collides with the reminder branch.** That branch is merging reminders into one "Remind me" button. This sheet *is* that button, plus the logger. Land the reminder branch first, then build the sheet on its permission and fallback logic, or reminders get redesigned twice.
7. **Notification permission on the Start tap** only works in an installed PWA on iPhone. In Safari, the sheet has to show the install step inline (the existing `stepInstall` copy) instead of the "sent to this phone" line.

---

## Effort

**Realistic estimate: 15 to 18 build days** for the whole app, landing and verify included, about three and a half weeks elapsed. **The first 6 days deliver most of what people will notice:** tokens, primitives, Result and Home.

| Slice | Days | Files |
|---|---|---|
| Tokens, lint, fonts | 1 | `src/index.css` (`@theme`: surfaces, meaning, type, radius, shadow, motion; `.pass`, `.guilloche`, `:lang()` rules; pinstripe removed), `index.html` (lang, theme-color, fonts), new ESLint rule for raw hex, plus an em-dash and banned-word check in `src/lib/locales.test.ts` |
| Primitives | 1.5 | `ui/Button.tsx` (4 variants × 2 surfaces), new `ui/TextButton.tsx`, `ui/Chip.tsx`, `ui/StatusChip.tsx`, `ui/Notice.tsx` (replaces `Alert.tsx`), `ui/Sheet.tsx`, `ui/Dock.tsx`, `ui/Pass.tsx`, `ui/Card.tsx`, `Icon.tsx` (about 16 icons), `VerifiedSeal.tsx` (aria-label from `t()`), `BrandMark.tsx` |
| Result | 2 | `HeroAnswer.tsx`, `ParkingResult.tsx`, `Clarify.tsx`, plus the two optional fields in `lambda/index.js` and `src/types.ts` |
| Home | 1.5 | `App.tsx` (home skeleton, state slot), `ActiveSessionCard.tsx`, `ActiveSessionsList.tsx`, `LanguageSelector.tsx` (globe), `LandingFeatures.tsx` (first-run slot), install prompts moved into the flow |
| Start parking and the saved moment | 2.5 | New `StartParkingSheet.tsx` merging `SessionLogger.tsx` and `ReminderOptions.tsx`, `App.tsx` view states, after the reminder branch lands |
| Record | 2 | `SessionDetail.tsx`, `ChainPanel.tsx`, `DepartureRow.tsx`, `DepartureSheet.tsx` (docked), `ScheduledRemindersSection.tsx`, `RecordPhoto.tsx` |
| History | 0.5 | `SessionHistory.tsx`, empty state art inline |
| Scan, loading, errors | 1 | `SignScanner.tsx`, `LoadingProgress.tsx`, `NoReadableSign.tsx`, `ReuseCard.tsx`, `RecentScansPicker.tsx` |
| Everything else | 1.5 | `AuthFlow.tsx`, `AuthSettings.tsx`, `AboutFeatures.tsx`, `PrivacyPolicy.tsx`, `FeedbackModal.tsx`, `AppealFlow.tsx`, `NoticeLookup.tsx`, `SwUpdateBanner.tsx`, `InstallPromptBanner.tsx`, `IosInstallHint.tsx` |
| Landing and verify | 1.5 | `migrations/two-app-architecture/landing-from-claude-design/index.html`, `landing-styles.css`, `verify/**` (9 locales) |
| i18n | 1 | `scripts/_i18n_inject_redesign.mjs`, about 40 keys × 9 locales, plus the three locale bug fixes above |
| QA | 1.5 | Installed PWA on iPhone and Android, el, hi and pa passes, Larger Text, reduced motion, contrast audit, `scripts/screenshots.mjs` rerun, component tests updated for new markup |

**Tokens that change:** add `vault`, `vault-900`, `glass`, `on-vault`, `on-vault-2`, `sage`, `paper`, `paper-2`, `card`, `line`, `line-strong`, `track`, `ink`, `ink-2`, `ink-3`, `ok`, `ok-ink`, `ok-tint`, `warn`, `warn-ink`, `warn-tint`, `warn-bar`, `stop`, `stop-ink`, `stop-tint`, `stop-on-vault` and `signed` (mint), plus `--text-num-xl`, `--text-num-lg`, `--text-display`, `--text-title`, `--text-heading`, `--text-body`, `--text-label`, `--text-meta`, `--radius-chip`, `--radius-button`, `--radius-card`, `--radius-verdict`, `--radius-sheet`, `--shadow-e1` to `e3`, and the motion durations and ease. Keep `brand-*` as aliases for one release, then delete. Drop `accent-*`. Swap the 47 hard-coded `#7BE3A4` (in 17 files) for `signed`, and reserve `--color-mint` for the seal alone.
