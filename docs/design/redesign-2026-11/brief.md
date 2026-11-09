# ParkProof redesign brief

**For:** three designers, one direction each. **Owner:** Melroy. **Date:** 9 Nov 2026.
**Evidence:** 81 screenshots at 390x844 (iPhone Safari user agent) in a session folder (not committed; regenerate the app screenshots with `npm run screenshots`). Numbers like (24) or (36) refer to those files. Every problem below was checked against the screenshots. Findings that only show up in code are parked at the end.

## What we're solving

ParkProof answers one question on the kerb ("can I park here, and until when?") and keeps a signed record in case of a fine. The product logic is strong. The UI was assembled screen by screen and it shows: the answer card doesn't say what it means, the brightest button is usually the wrong one, and the evidence page reads like a debug view.

The bar: a hiring PM at a consumer company opens it on their phone and thinks "this person has taste".

---

## Decision 0: the base surface (one direction per designer)

Almost every other problem depends on this. The whole app sits on the dark vault (`#073B25`) with a pinstripe. Pine buttons vanish against it (about 1.6:1), green can't mean "go" because everything is green, and `src/index.css` still comments `paper-100` as "app background" while `body` uses the vault. The code disagrees with itself about what the app is meant to be.

| | Direction | What it is | Wins on | Risk |
|---|---|---|---|---|
| **A** | Vault, refined | Keep dark everywhere. Drop the page pinstripe, light primary button, three surfaces, mint truly rare, semantic ok/warn/stop tokens tuned for dark. | Cheapest. Keeps the current look. | The vault still means nothing. Weakest in sunlight. |
| **B** | Daylight + Vault | Everyday flow (home, scan, result, start parking, history, settings) on `paper-100` with white cards and a pine primary. Vault only for signed evidence: the record header, signed-parts panel, seal, PDF preview. | Green is free to mean go. Stepping onto the dark surface means "this is signed". Best outdoors. | Two modes still have to feel like one product. Landing and verify must follow. |
| **C** | Kerbside | Built on Australian sign grammar: white sign-panel cards, sign green for permitted, sign red for restrictions, bold numerals. The verdict reads like a sign you can trust. Pine and seal kept for evidence only. | Most ownable. Semantics come from a system drivers already know. | Most work. Can tip into "council app". Has to make peace with the pine brand. |

**My pick: B.** The deciding question is "is the dark green the brand, or is the seal the brand?" The seal is the thing no other parking app has, and B makes it precious. A is the fallback if the dark identity is non-negotiable. C is the wildcard worth paying for once, because it might be the one that makes people stop scrolling.

---

## Top problems, ranked by impact

Each one: what's wrong (seen in the shots), what to do, and the screens.

### 1. The verdict card doesn't carry the verdict
- A paid bay (46), a permit zone (54), an accessible-permit bay (55) and a low-confidence read whose end time is "hidden by foliage" (53) all get the same tick, "You can park here" and a firm "Until 11:43 am". The condition that decides whether the driver gets fined sits one to two scrolls down, below the chips, "Did we read this right?" and "View the photo". Low confidence is a small amber dot at the bottom of the second card.
- "Can park" is black text on white with a pale tick. Only "Don't park here" gets colour (52), with a warning triangle and no reason or next legal time, so the card is half empty. Every chip, "No Stopping" included, wears the same mint "go" tint.
- **Do:** four designed states, not a boolean. **Go.** **Go with a condition** ("You can park if you pay. PayStay zone 4521", with the gate's action inside the card). **Unsure** ("Probably until 11:43 am. Check the end time on the sign."). **Stop** (reason, "You can park from 9:30 am", "Remind me when I can park"). The state is the card's structure (band or surface), never just a text colour. Chips go neutral and turn red only for restrictions in force now.
- **Screens:** 24, 46, 52, 53, 54, 55

### 2. The primary button is the dimmest thing on screen, and there are 12+ button styles
- Pine on the vault fades while escape routes glow. Pale "Retake" beats "Translate" (20). Charcoal "Retake photo" beats white "Yes, looks right" (24, 53). White "Scan another sign" outshines the parking card (30). White "Continue with Google" beats "Sign in" (13). White "Back to home" beats "Try again" (56).
- Disabled "Confirm payment to save" is a lighter, brighter green than the enabled button (46, 55). The success state "√ 2 notifications scheduled" is a grey button that looks disabled (29). Selected reminder chips are pine and recede while unselected chips are white and pop (28). Account gives every card a different button (73). The departure sheet's button shows square grey corners behind its rounded clip (35).
- In code: 11 files import `ui/Button`, against 122 raw `<button>` tags.
- **Do:** four variants plus a prose link. Primary (highest contrast on its surface), secondary (outline or glass, never brighter than primary), tertiary (text), destructive. Disabled is the same hue at reduced strength plus a reason line. Success is a confirmation row with an icon, not a button. A selected chip is filled with a check.
- **Screens:** 13, 20, 24, 28, 29, 30, 35, 46, 53, 55, 56, 73

### 3. One green for everything
- Background, cards, buttons, links, muted text, the live dot, headline accents ("simple.", "in seconds."), the "You confirmed the reading" stamp and the production seal are all pine, sage or mint. There are 43 hard-coded `#7BE3A4` in components. The pinstripe runs behind long reading pages too (08, 09).
- State colours on the vault sit around 1.2 to 1.6:1: the loading bar (21), selected chips (28), the active-list stripe (50). In Australian sun they disappear. The go state has no colour of its own, and the production seal (62) competes with footer links.
- **Do:** Decision 0 settles the base. Whatever the base, define semantic tokens (`ok`, `warn`, `stop`, `signed`) in `@theme`, keep mint for the seal, the live dot and selected state only, make links neutral and underlined, emphasise headlines by weight not colour, and allow no raw hex in components.
- **Screens:** 05, 08, 21, 28, 30, 50, 62, and every other screen

### 4. The words break the spec's own rules, and a restyle would ship them with more polish
- **Legal:** "VERIFIED RECORD" on the in-app hero (05, 80, 81) and the landing (01). A "STRONG EVIDENCE" badge and "Strong case." on appeal review (43), banned by name. The no-sign note says the signature "covers when and where" (59), which the spec says a signature does not show. "Too imprecise to verify your spot" (59). "Council-ready" (73). "Your proof if you're ever wrongly ticketed" (24). "It softens a council review" on every record's note (36, 62, 77) promises an outcome. "Reset to AI draft" (43) uses a banned word. Em-dashes throughout the landing (01) and verify page (02, 03).
- **Vocabulary:** one action, six names ("Snap a session", "Check a parking sign", "Scan a parking sign", "Scan another sign", "Translate", "Re-check now"). "Session history" on home opens a screen called "Parking records". "Back to session" (43). "Logged as an unsigned spot" sits under "Cryptographically signed" (62) and reads as "not signed". "Compare the bullets above" refers to chips.
- **Jargon on the front step:** a raw base64 signature prefix as the seal's subtitle (36, 62), the Cognito UUID (73), "every photo from S3", "Download .ics with 2 alarms", "per-browser-per-device" (28, 73), raw coordinates and "±8m accuracy" (26, 36).
- **Do:** one copy pass with one owner, before or alongside the visual work. Glossary: verb "Check a sign" (on the preview, "Check this sign"), noun "parking record", "no-sign park" instead of "unsigned", "rules we read" instead of "bullets". Hashes, IDs and coordinates go behind "Technical details". Add an em-dash and banned-word lint to the definition of done.
- **Screens:** 01, 02, 03, 05, 24, 26, 28, 36, 43, 59, 62, 73, 77, 80, 81

### 5. The record screen leads with cryptography and ignores state
- Top to bottom: a low-contrast back link, the title, a small seal indented off the title's grid, a raw signature prefix truncated to "AE…" (so the time zone is lost), a four-line disclaimer, a collapsed signed-parts header, then STATUS. Then a run of full-width cards (status, note, reminders, sign photo, car photo), four stacked actions, and a near-invisible "Delete record".
- Active and ended records share one layout. While the car is still parked, the primary is "Export as PDF" and "I've left" is fourth in the stack, under "Got a ticket? Draft an appeal letter" for a fine that doesn't exist yet (36). Ended records still offer "Walk back to the car" (62, 67). Rounded and chamfered cards are mixed, as are two label styles (tracked Inter "STATUS" vs condensed Space Grotesk "NOTE"). The empty note renders "TapAdd noteto".
- **Do:** a certificate-style header (an "evidence pass"): status chip, address, arrived / signed / left times, photo thumbnails, and the seal at full size with "Signed by ParkProof, Tue 3 Nov, 11:05 pm AEDT". One disclaimer line plus a "What a signature shows" disclosure. State drives the actions: active shows the countdown, Walk back and I've left; ended shows Export PDF and Appeal. Signed parts, hashes and coordinates go under "Technical details". Delete moves to an overflow with a real danger style and an in-app confirm.
- **Screens:** 36, 40, 62, 65, 67, 77

### 6. The active home card buries "I've left" and repaints itself like an error dialog
- "I'VE LEFT" is a roughly 32px uppercase chip, the smallest control on the card, and it's the tap that creates the signed departure. "Walk back" gets a full button while its own subtitle says "You're already there" (30, 32, 34). "Re-check now" gets full width.
- Urgency swaps the whole card: glass, then Tailwind `amber-700` (renders burnt orange), then `red-700`, then near-black for expired. Expired, when the driver is actually liable, is the quietest state, and its grey border breaks at the chamfer (34). The buttons on the amber card are white on white/20, about 3.6:1 (32). The same park reads "59 min left" on an amber card in one place and "1 hour left" calm in another (50, 71). The white "Scan another sign" below is the brightest thing on screen.
- **Do:** a steady surface, with urgency carried by the countdown colour, a depletion bar and a status band. Expired is the loudest state. "I've left" is a 48px button in every state, paired with Walk back, and Walk back hides within about 50 m. One shared urgency function for home, the active list, history and the record.
- **Screens:** 30, 32, 33, 34, 49, 50, 70, 71

### 7. The next action is below the fold, and photos eat the screen
- "Save & remind me" is about one and a half screens down on the result (24). A car photo pushes "Save record" off screen (27). The dark-photo warning starts below a 500px black preview (19). The imprecise-GPS warning sits under a full-height surroundings photo, so you can save without ever seeing it (59). Done is off screen on Remind (28). The preview (20) leaves a large empty gap between the photo and its buttons. Photos are letterboxed inside framed cards (59).
- **Do:** a sticky, safe-area-aware action bar on every screen that ends in a commit. Photos as fixed-aspect thumbnails (capped near 40vh, cropped to fill), tap to expand. Blocking warnings above the image, not under it.
- **Screens:** 19, 20, 24, 27, 28, 58, 59

### 8. Logging a park is three screens and 8 to 11 taps behind a mislabelled button
- "Save & remind me" neither saves nor reminds. It opens a logger that re-shows raw coordinates for a position the app already took at scan time, plus two equal cards for an optional car photo (26). "Save record" then opens a third screen with a push banner, six chips, a calendar card, a browser-notification card and Done (28).
- **Do (pick one per direction):** (a) one tap, "Start parking", saves with the scan-time GPS and default reminders, then a light sheet offers "Add car photo" and "Change reminders"; or (b) one "Confirm park" screen (address line, car-photo slot, reminder chips, one Start button) that replaces both logger and remind. Either way the button says what it does. The spec rule "the common path must not get slower" can't hold on top of a three-screen commit.
- **Screens:** 24, 26, 27, 28, 29, 61

### 9. The app misses its own accessibility floor where it matters outdoors
- Under 44px, visible in the shots: "I'VE LEFT" (30), "Enable push" (28), "No sign here? Just log my park" as a bare text link (17), the logger's "Edit" (26).
- Below AA: "Delete record" is close to invisible on the vault (36, 62). The gated Save buttons put their instruction ("Confirm payment to save") in pale text on light green (46, 55).
- Size and truncation: 11px text carries real content ("STEP 1 OF 5", the How it works copy, the signature line). The signing timestamp is truncated mid time zone (36, 62, 77).
- **Do:** one TextButton primitive built like BackButton (44px minimum). A 13px floor for sentences and 12px for metadata. Truncate hashes, never timestamps. Danger actions at AA. Check every mock at iOS Larger Text.
- **Screens:** 17, 21, 26, 28, 30, 36, 46, 55, 62, 77

### 10. Localisation renders wrong where it's most visible
- `<html lang="en">` never changes, so Greek capitals keep their accents ("ΈΦΥΓΑ", "+1 ΑΚΌΜΑ") (70). The Greek label "ΣΕ ΣΤΑΘΜΕΥΣΗ ΤΩΡΑ" runs under the "+1 ΑΚΌΜΑ" pill (70). Uppercase letter-spacing breaks the Devanagari headline stroke (71). The Hindi sign-in button text runs edge to edge (81). The hero card stays English ("VERIFIED RECORD", "You can park", "until 4:00 PM") in Greek and Hindi (80, 81). Times stay "11:43 am" inside Hindi sentences (71). History dates are hard-coded `en-AU` (69).
- **Do:** set `lang` per locale. Per-script type tokens (no uppercase or tracking for el, hi, pa labels, line-height of 1.5 or more for Devanagari display). Pills in normal flow, not absolutely positioned. `Intl` for every date and time. No text baked into illustrations. Every mock gets one Greek or Hindi variant.
- **Screens:** 69, 70, 71, 80, 81

### 11. There is no system underneath: surfaces, shapes, type and icons
- **Surfaces:** about twelve card types (white sharp chamfer, white rounded chamfer, glass, pale mint, cream, pink, dashed tiles, a centred modal, a floating chamfered sheet). The chamfer is on buttons, rows, warnings and sheets, so it no longer signals "evidence". Rounded and square cards stack on top of each other (39).
- **Type:** Space Grotesk, Inter, IBM Plex Mono (which falls back to a Courier in the app) and system mono. Three uppercase label styles. Space Grotesk's flagged "1" makes "11:43", "1 hour left" and "1.1 km" read oddly on the most-read numbers in the app (24, 70).
- **Icons:** emoji tiles on About (08), typographic "√" and "✓" for ticks (27, 29), a native disclosure triangle (24), a stray "⌋" where a chevron should be (50), and one warning triangle for "We analyse", can't park, errors, notices and photo quality (05, 52, 56, 59). Apple and Google sign-in buttons have no marks (13).
- **Do:** three surfaces (background, row, content card), one notice pattern, one docked bottom-sheet pattern. Chamfer reserved for signed artefacts. A type scale as tokens with one label style, and tabular Inter (or an alternate "1") for numerals. Every icon through `Icon.tsx`, adding stop, info, chevron, scan, the International Symbol of Access and cloud. Official Apple and Google marks.
- **Screens:** 05, 08, 13, 24, 27, 29, 35, 39, 50, 52, 56, 70

### 12. Home has three layouts, and first visit is a second marketing page
- First visit (05): language pill top right, an SVG hero with decorative English "VERIFIED RECORD" and "KMS · f3a9c4…b21", ticks, a caveat, two CTAs, trust pills, a squeezed three-column How it works with a warning triangle for "We analyse", then a tamper card. Returning (78): a hero image with a visible AI sparkle watermark and the logo on a fake street sign, a different tagline, the language pill now centred. Active (30): the language pill is the loudest element above the parking card.
- The language menu uses flags (Australia for English, India for both Hindi and Punjabi) and runs to the right edge of the screen (07). The iOS install hint covers the main CTA (04), and the Android banner covers Sign in (06).
- **Do:** one home skeleton with a state slot at the top (first run, active parks, last park) and the main action in the same thumb-zone spot every time. The real, localised verdict component as the first-run hero. Language as a compact globe in a consistent header, auto-detected, listed by name with no flags. Install and sign-in prompts after the first saved record, in the page flow, never over the CTA.
- Note: the car photo in 27 and 36 is a test fixture. Its watermark is not a product issue. The one in 78 (`public/hero-illustration.png`) is.
- **Screens:** 04, 05, 06, 07, 30, 78, 80, 81

### 13. Landing, app and verify page look like three products
- `/verify` (02, 03), where a council officer decides whether to trust a record, is in the retired identity: sage background, Fraunces serif, electric-blue italic, blue links, em-dashes and long walls of copy. In Greek a floating blue "View in English" pill sits on top of the back link (03).
- The landing (01) adds mono eyebrows, a coral "absurd." and red "?" badges (red means stop everywhere else), and a hero card that says "VERIFIED RECORD". Its headline is "Read any Aussie sign in seconds." while the app's first-run headline is "Parking made simple."
- **Do:** the chosen direction carries to landing and verify. Verify becomes a light "document" layout in the app's type, with a public-key card and copyable code blocks. One tagline, one verb, one logo lockup. No red or coral as marketing accents.
- **Screens:** 01, 02, 03

### 14. Scan, wait and fail feel like a web form
- Capture is two dashed drop-zone tiles, one with a green dash and one grey, so they read as selected and unselected, with half the screen empty below (17, 59). The privacy line contradicts itself ("read on your phone. Only the sign photo is sent to translate it").
- Loading (21) is a static icon tile, "STEP 1 OF 5", a pine bar you can barely see, and "Usually takes about 10 seconds" when stacked signs take 30 to 50. No photo, no cancel.
- The unreadable-sign error (56) says "Something went wrong" when the cause is known, drops the photo, and makes "Back to home" brighter than "Try again".
- **Do:** one large camera primary with a framing hint ("fit every sign on the pole"), the library as a text link, one accurate privacy line. Loading shows the user's own photo with the scan sweep the landing already has, an honest "Complex signs can take up to 40 seconds", and Cancel. Errors name the cause, keep the photo, and offer "Retake photo" plus "Log without a reading".
- **Screens:** 17, 18, 19, 21, 22, 56, 57

### 15. History is a stack of slabs with no order
- Five full white chamfer cards, not sorted by date (3 Nov sits above 9 Nov), the same green tick on every row whether the record was signed by the production key or the dev key, status as a small footer line, and one row with a different fill (69). The empty state has an unrelated ">>" illustration and no button (79).
- **Do:** a grouped list on one surface (Parked now, then Earlier), sorted by arrival, with the address as the headline, a status chip (Active, Ended, Expired), the sign thumbnail kept, the seal only where a production signature exists, and an empty state with a "Check a sign" button.
- **Screens:** 50, 69, 79

---

## Themes

| Theme | Problems | The fix in one line |
|---|---|---|
| The answer must mean something | 1, 3 | Colour is semantics, and the verdict's state is the card's structure. |
| One action grammar | 2, 6, 7, 8 | One primary per screen, brightest on its surface, always in thumb reach. |
| Evidence that reads as evidence | 5, 11, 15 | Seal, chamfer and (in B) the vault become rare and ceremonial. |
| Words you can stand behind | 4 | Legal-safe, one vocabulary, technical detail behind a door. |
| One product, nine languages | 10, 12, 13 | One skeleton, one brand, localised all the way into the art. |
| Built for the kerb | 9, 14 | Outdoor contrast, 44px targets, honest waits, failures that keep your work. |

---

## Keep

Argue before changing any of these.

- **The verdict's scale and wording.** "You can park here", the "Until 12:43 pm" pill and "2h 1m left" is the most glanceable moment in the app. Fix the state colours, not the hierarchy.
- **The home countdown as the hero** ("2h 1m left", "Move by 12:43 pm"), with urgency always stated in words and tabular numerals.
- **The production seal with the mint ring (62) and the P mark with the notch.** Both get scarcer, not different.
- **The chamfer,** reserved for signed artefacts.
- **Space Grotesk display with Inter body** and the Noto fallback. Fix the numerals, keep the pairing.
- **The gates** (pay, permit, accessible permit) that block Save until acknowledged, in that severity order. Move them up into the verdict.
- **Clarify (23):** the user's own sign photo, one question, two big choices.
- **Rule chips grouped by arrow or panel** with "not in force today", and the rule-change heads-up banner (46).
- **"Did we read this right?"** as a human check. Fix its button weights.
- **The departure sheet (35, 66)** and its honest phone-clock copy. Dock it to the bottom edge.
- **The signed-parts panel:** collapsed by default, plain part names (Arrival, Details at parking, Departure), phone times kept apart from ParkProof signing times, the dev-key wording.
- **The photo-quality pre-check (19)** and the **reuse card (44).**
- **Sign-photo thumbnails in history (69).**
- **The landing's "Melbourne problem" section** with the real annotated pole (01). The best image and story in the product.
- **Anonymous by default** with sign-in clearly optional (13). Delete account behind typing DELETE (74). The offline error that says what still works (57).
- **Engineering hygiene:** BackButton's 44px hit area, `Input` at 16px, `.tnum`, the `gf-btn` inset focus ring, dialog focus traps, reduced-motion handling.

---

## Design principles

1. **Colour is meaning.** Green means go (and validly signed). Red means stop. Amber means a condition or a doubt. The brand colour never stands in for any of them, and no state relies on colour alone.
2. **The verdict carries its condition.** If the yes has an "if", the "if" is in the headline and the action that satisfies it is in the card.
3. **One primary, brightest, in reach.** Every screen has exactly one primary action. It is the highest-contrast control on its surface, and on commit screens it is pinned to the bottom.
4. **State decides the layout.** Active, ended and expired records, and go, conditional, unsure and stop answers, get different layouts, not the same layout with a different word.
5. **Evidence is rare and ceremonial.** Seal, chamfer, mint and (in B) the vault appear only on signed artefacts, so seeing them means "this is signed". Saving a park gets one crafted moment.
6. **Say it once, plainly, in the user's language.** One caveat at the point of decision, one verb, one noun, no jargon on the front step, and every string localised, including art, aria labels and dates.
7. **Designed for the kerb.** One hand, bright sun, often walking. 44px targets, AA or better, no hairline states, honest waits, and failures that keep your work.

---

## Hard constraints

- **Legal-safety copy** (`docs/build/roadmap-build-spec.md`, Copy rules):
  - No em-dashes in user-facing copy. Australian spelling, sentence case, second person.
  - Never "verified" for records or signatures, and never "reset", "compliant", "compliance proven", "admissible", "authentic", "verified location", "accepted by insurers" or "accepted by council". No verdicts or odds ("strong evidence"), no promised outcomes, no legal advice.
  - Wherever signed material appears, say what a signature shows (the signed details existed, unchanged, by the signed time) and what it does not (that they're true, who was driving, where the car was, when it arrived or left).
  - Phone times are labelled as phone times. ParkProof's times are labelled as signing times. Driver statements stay the driver's own.
  - Every reminder surface carries the reliability line.
  - The noun is "parking record", never "session".
- **Nine locales:** en, zh-CN, vi, id, ko, it, el, hi, pa. Layouts take long Greek and Hindi/Punjabi strings without truncating meaning. No text baked into images or SVG.
- **Touch targets** at least 44x44px.
- **WCAG AA:** 4.5:1 for body text, 3:1 for large text, component boundaries and focus indicators.
- **Answer card:** green means go, red means stop, with icon shape and words as the non-colour backup.
- **Installed PWA on iPhone and Android:** safe-area insets top and bottom, no zoom lock, text inputs at 16px or more.
- **Tailwind v4,** tokens in `@theme` in `src/index.css`, no raw hex in components.
- **Product rules:** anonymous by default, nothing gated behind sign-in, optional steps collapsed, the common path never gets slower.
- **Motion** respects `prefers-reduced-motion`.
- **Sheets and modals** follow the FeedbackModal pattern (`role="dialog"`, `aria-modal`, focus trap, Escape closes). Icons live in `Icon.tsx`.

---

## The six screens every direction mocks

All at 390x844, in English, plus the locale variants noted.

1. **Home, currently parked.** States: calm (2h left), under an hour, expired and not ended, and two active parks at once. One state in Greek or Hindi. Show where Check a sign, Parking records, Draft an appeal and Settings live. *(Refs 30, 32, 33, 34, 49, 70, 71)*
2. **Result answer.** States: go (24), go with a condition (pay 46, accessible permit 55), unsure (53), stop with the next legal time (52). The commit action in a sticky bar. One state in Greek or Hindi. *(Refs 24, 46, 52, 53, 54, 55)*
3. **Parking record with evidence.** States: active (36) and ended production-signed (62). Header, photos, signed parts collapsed and expanded, actions by state. *(Refs 36, 37, 62, 63, 67)*
4. **Start parking (logger and reminders merged).** The commit after a go answer: address, car-photo slot, reminder chips with a clear selected state, push or calendar fallback, the reliability line, one Start button. Plus the "saved and signed" moment after it. *(Refs 26, 27, 28, 29, 61)*
5. **Parking records (history).** Several records of mixed status, plus the empty state. *(Refs 50, 69, 79)*
6. **Marketing landing, first two viewports.** Hero, CTA and the start of the Melbourne problem section, in the direction's language. *(Ref 01)*

### What each designer hands back
- The six screens with the states listed above.
- A one-page token sheet: colour (semantic `ok`, `warn`, `stop`, `signed`, with measured contrast), type scale, the four button variants, three surfaces, sheet, notice and chip.
- A short note on what the direction changes in the spec's "Design rules" section.

---

## Calls made where the critiques disagreed

| Question | Options on the table | Call |
|---|---|---|
| Primary button on the vault | White fill, or mint fill | Depends on the base. On the vault, a light fill with `brand-900` text. On paper, a pine fill. Mint stays with the seal. |
| Verdict surface | Full emerald surface, or a state band on a white card | Each direction chooses, but the state must be structural and "go" gets its own colour, not brand pine. |
| "I've left" vs "Walk back" | One primary chosen by distance, or a two-button row | Two-button row. "I've left" is always present at 48px. Walk back hides within about 50 m. |
| Language picker | Header globe, or move into settings | Auto-detect with a one-time prompt, then a globe in a consistent header (also in Settings). No flags. |
| "Reset to AI draft" | Keep it, or it's a banned word | Keep the mechanic, rename the action ("Use the AI draft again"). |
| Appeal on active records | Offer it, or hide it | Hide until the record has ended. |

---

## Already in flight on another branch (note, don't redesign)

- Back links grey on the vault, the iPhone back button under the status bar (safe-area insets), reminders needing two taps (being merged into one "Remind me"), and the record status saying only "Ended".
- Additions for that reminder rework: selected chips filled with a check, success as a confirmation row, and every reminder that was set (any channel) shown on the record and on home. Shot 77 says "No push reminders set for this session" after a check-in reminder was set on 61.
- If a direction adopts "Start parking" (problem 8), coordinate with that branch so reminders aren't redesigned twice.

## Not confirmed from screenshots (send to engineering, don't design around)

- Focus ring contrast: a `brand-500` outline on the vault is about 1.6:1, and `clip-path` on chamfered card buttons clips it entirely.
- iOS zoom on 14px text fields (feedback, note, appeal letter, manual address, "Type DELETE").
- `VerifiedSeal` has a hard-coded `aria-label="Verified, tamper-evident record"`, and several aria and title strings are English literals with em-dashes.
- The landing demo auto-advances with no pause or reduced-motion check, and its "See how to verify a record" link is reported at about 1.0:1.
