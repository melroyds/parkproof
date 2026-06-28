# ParkProof — Accessibility Review

*An accessibility audit against WCAG 2.1/2.2, run 2026-06-29 across five lenses (touch targets, colour contrast, screen reader, reduced motion, forms). Every finding was checked by a skeptic, contrast ratios were recomputed from the actual palette hex, and a separate hand pass cross-checked the result, which added one Tier-1 the fan-out missed. 48 findings: 5 Tier-1 (real failure), 30 Tier-2 (should), 13 Tier-3 (polish). Intentional choices and already-handled cases are filtered.*

---

## The read

Two things are genuinely right, and they are not small. **Reduced motion is fully handled** by a global `prefers-reduced-motion` rule ([index.css:105-114](src/index.css:105)) that zeroes every animation and transition duration, so the live "currently parked" ping, the loading pulse, and the banners all resolve to a static end-state. The whole motion lens produced zero findings, which is the right outcome. And the **`AuthFlow` forms are done correctly**: inputs are wrapped in real `<label>` elements, so sign-in, the one place a label matters most, is properly associated. The icon set is `aria-hidden`, and the one spot where a nested button would have been easy to write (the "+N more" pill on the active card) was deliberately moved outside its parent button. Someone was paying attention.

The problems cluster in three systemic themes, and each has a single-shaped fix that sweeps most of its findings.

The most serious is that **a screen reader cannot follow the app**. There are zero live regions anywhere in `src/`. The park / don't-park verdict, which is the entire reason the app exists, mounts after a 12-second wait into a static region with no `role="status"` and no focus move, so a blind user is never told the answer. The same is true of the loading steps, the error screens, GPS capture, reminder confirmations, copy-to-clipboard, and the Toast that announces "we removed photos from your older records to free space." Eleven findings, all WCAG 4.1.3, and the fix is one reusable live-region pattern applied to about eight spots.

The second is **light text on light surfaces**. White on the teal `accent` buttons computes to 2.1 to 2.9:1, white on the amber-400 "move soon" warning card to 1.56:1, and the white/85 countdown on the emerald verdict card to 2.2:1. The colours that carry "go / caution / stop" and the verdict text itself sit below the AA readable floor. There is no dark mode (the app is light-only, which is a fact, not a fault), so this is the light palette failing on its own terms.

The third is **touch targets**. Twenty interactive controls render under 44px, and several, the footer links, the dismiss x's, the morePill, the back links, fall under even the 24px AA minimum (WCAG 2.5.8). For a one-handed, stressed, sometimes older audience, those are real misses. A shared "tappable" utility (min-height plus negative margin so the visual size is unchanged) fixes the lot.

Forms are a smaller, mechanical fourth theme: four textareas and inputs outside `AuthFlow` have visual labels not tied to the field, errors that are neither associated nor announced, and missing `autocomplete`.

---

## Tier 1 — real failures

### 1. White text on the teal `accent` buttons fails AA (added by hand cross-check)
- **Standard:** 1.4.3 Contrast (Minimum) AA. **Lens:** contrast.
- **What:** White text on `accent-600` (#1AA9AC) computes to **2.87:1** and on `accent-500` (#20C4C7) to **2.15:1**, both far under the 4.5:1 floor and under even the 3:1 large-text floor. The text is `text-sm font-semibold`, not large. The fan-out's contrast pass caught the gradient cards but missed these solid-fill buttons; the hand pass recomputed and confirmed.
- **Where:** the Retake button [ParkingResult.tsx:365](src/components/ParkingResult.tsx:365); [SessionLogger.tsx:349](src/components/SessionLogger.tsx:349) and [:434](src/components/SessionLogger.tsx:434); [AuthSettings.tsx:220](src/components/AuthSettings.tsx:220); [LandingFeatures.tsx:65](src/components/LandingFeatures.tsx:65); [ReminderOptions.tsx:524](src/components/ReminderOptions.tsx:524) and [:777](src/components/ReminderOptions.tsx:777).
- **Fix:** the teal is too light for white at any usable size. Either darken the button fill to `accent-800` (#0F6F71, white = 4.8:1) for these CTAs, or use `ink-900` text on the existing teal. Set it once on a shared button class so all seven move together.

### 2. White text on the amber-400 "move soon" warning card
- **Standard:** 1.4.3 AA. **Lens:** contrast.
- **What:** when an active session enters the `warning` urgency, the card uses a `from-amber-400 #FBBF24` gradient with white and white/75-90 text. White on amber-400 is **1.56:1**; even at the dark `amber-600` stop it is ~3.1:1. The small `text-xs` kicker and walk-back lines (white/75) are the worst.
- **Where:** [ActiveSessionCard.tsx:49](src/components/ActiveSessionCard.tsx:49) (the warning surface in `URGENCY_STYLES`), with the white text at lines 171, 189, 213, 236, 273, 282.
- **Fix:** amber with white is the wrong pairing. Carry a per-urgency text colour in `URGENCY_STYLES` and set the warning variant to `ink-900` on an amber-500/600 floor (the conventional caution pairing, which clears 4.5:1), rather than white. Structural, not a scrim.

### 3. White/85 countdown on the emerald verdict card
- **Standard:** 1.4.3 AA. **Lens:** contrast.
- **What:** the `URGENCY_STYLE.normal` countdown line is `text-white/85` `text-sm` over the can-park emerald gradient. Recomputed: white/85 on emerald-500 is **2.2:1**, on emerald-600 ~3.1:1, on emerald-700 ~4.4:1, all under 4.5:1 for normal-weight text. `normal` urgency fires for any session over 60 minutes (the common all-day/2P/4P case), so it fails across the whole gradient. The big 3xl verdict headline gets the large-text allowance and is fine.
- **Where:** [ParkingResult.tsx:38](src/components/ParkingResult.tsx:38) (`URGENCY_STYLE.normal`), the countdown at [:250](src/components/ParkingResult.tsx:250), the "until" line at [:245](src/components/ParkingResult.tsx:245).
- **Fix:** pin the smaller lines to solid white and raise the gradient's light stop to emerald-600, or set those lines to a guaranteed-dark colour. Keep the headline as is.

### 4. The park / don't-park verdict is never announced
- **Standard:** 4.1.3 Status Messages AA. **Lens:** screen reader.
- **What:** the verdict mounts after the ~12s async read into a static region with no `role="status"`/`aria-live` and no focus move. A screen-reader user who scans, waits, and lands on the result is told nothing, and has to blindly re-explore to find the legal/illegal answer the app exists to give.
- **Where:** [ParkingResult.tsx:226-254](src/components/ParkingResult.tsx:226) (verdict `<h2>` at :241, countdown at :250), reached via the view swap at [App.tsx:528-549](src/App.tsx:528).
- **Fix:** on result mount, move focus to the verdict heading (`tabIndex={-1}` + `ref.focus()`), or wrap the answer card in `role="status" aria-live="polite" aria-atomic="true"` so the verdict and "until" time are read on appearance.

### 5. Loading progress is never announced
- **Standard:** 4.1.3 AA. **Lens:** screen reader.
- **What:** the stage label and "taking longer than usual" copy update purely visually during the 12-50s call. A blind user cannot tell progress from a hang.
- **Where:** [LoadingProgress.tsx:59-66](src/components/LoadingProgress.tsx:59) (stage heading) and [:88-90](src/components/LoadingProgress.tsx:88) (timing copy).
- **Fix:** add `role="status" aria-live="polite"` to the stage-text container so each stage is announced, and give the bar `role="progressbar"` with `aria-valuenow/min/max`.

---

## Tier 2 — should fix

### Screen reader: the rest of the missing live regions (all 4.1.3 AA)
Same root as Tier-1 items 4 and 5: state changes that are visual-only. Each fix is the same `role="status"` (or `role="alert"` for errors) wrapper.

| What changes silently | Where | Fix |
|---|---|---|
| Error / offline view replaces the screen | [App.tsx:483-511](src/App.tsx:483), [AppealFlow.tsx:111-132](src/components/AppealFlow.tsx:111) | `role="alert"` on the message + focus the heading |
| Toast ("photos removed to free space", "photo didn't back up") | [App.tsx:83-97](src/App.tsx:83) | `role="alert"`; consider not auto-dismissing the destructive-evidence notice |
| GPS status (Acquiring → Captured / error, resolved address) | [SessionLogger.tsx:301-439](src/components/SessionLogger.tsx:301) | `role="status"` on the GPS status/result region |
| Reminder scheduling outcome + the silent-push-fail warning | [ReminderOptions.tsx:489-543](src/components/ReminderOptions.tsx:489) (and the no-sign picker at :740-794) | `role="status"`/`role="alert"` on the outcome line |
| Copy-to-clipboard success on the appeal letter | [AppealFlow.tsx:193-198](src/components/AppealFlow.tsx:193) | render "Copied" into a `role="status"` region |
| AuthFlow info messages (account created, code resent, reset) | [AuthFlow.tsx:208-212](src/components/AuthFlow.tsx:208) | `role="status"` on the info container |

### Contrast: muted footer text on the sage background
- **Standard:** 1.4.3 AA. **What:** the home footer links (About, Privacy, Send feedback) are `text-xs text-ink-500` (#5C6680) on the fixed sage body bg #C8DCCF, which is **3.55:1**, under 4.5:1 for small text. **Where:** [App.tsx:901,907,913](src/App.tsx:901). **Fix:** step the text to `ink-700` (#2D374F, ~7.4:1 on sage) or sit the links on a white/paper surface.

### Forms: label, error, and input-purpose association
`AuthFlow` is correct and excluded. The rest:

| Field / issue | Where | Standard | Fix |
|---|---|---|---|
| Feedback message textarea: label is a sibling, no `htmlFor`/`id` | [FeedbackModal.tsx:165-178](src/components/FeedbackModal.tsx:165) | 3.3.2 / 1.3.1 / 4.1.2 | `id` + `htmlFor` (or wrap) |
| Feedback email input: same unassociated label | [FeedbackModal.tsx:185-197](src/components/FeedbackModal.tsx:185) | 3.3.2 / 1.3.1 | `id` + `htmlFor` |
| Feedback "required" is an asterisk only | [FeedbackModal.tsx:167](src/components/FeedbackModal.tsx:167) | 3.3.2 / 4.1.2 | `aria-required` + hide the `*` or label it |
| Feedback submit error not associated/announced | [FeedbackModal.tsx:202-206](src/components/FeedbackModal.tsx:202) | 3.3.1 / 4.1.2 | `role="alert"` + `aria-describedby`/`aria-invalid` |
| Feedback email missing `autocomplete` | [FeedbackModal.tsx:189](src/components/FeedbackModal.tsx:189) | 1.3.5 AA | `autoComplete="email"` |
| Feedback modal: no focus trap, no focus return on close | [FeedbackModal.tsx:54-76](src/components/FeedbackModal.tsx:54) | 2.4.3 / 4.1.2 | trap Tab within the dialog; restore focus to the trigger |
| Address input: no label at all, no `autocomplete` | [SessionLogger.tsx:394-405](src/components/SessionLogger.tsx:394) | 3.3.2 / 1.3.1 / 1.3.5 | hidden `<label htmlFor>` + `autoComplete="street-address"` |
| Address-edit error not associated/announced | [SessionLogger.tsx:406](src/components/SessionLogger.tsx:406) | 3.3.1 | `role="alert"` + `aria-describedby`/`aria-invalid` |
| AuthFlow errors not tied to the field | [AuthFlow.tsx:213-217](src/components/AuthFlow.tsx:213) | 3.3.1 | `role="alert"` + `aria-invalid` on the field |
| Note textarea: labelled by an `<h3>`, not bound | [SessionDetail.tsx:421-430](src/components/SessionDetail.tsx:421) | 3.3.2 / 1.3.1 | `aria-labelledby` the h3, or hidden label |
| Note save-error not associated/announced | [SessionDetail.tsx:450-454](src/components/SessionDetail.tsx:450) | 3.3.1 | `role="alert"` + `aria-describedby` |
| Appeal-letter textarea: labelled by an `<h3>`, not bound | [AppealFlow.tsx:184-189](src/components/AppealFlow.tsx:184) | 3.3.2 / 1.3.1 | `aria-labelledby` the h3, or hidden label |

### Touch targets under the 24px AA floor (WCAG 2.5.8)
These render under 24px in at least one dimension. Fix is a structural hit area, never visual-only: `min-h-[44px] inline-flex items-center` plus a negative margin (`-my-2.5`) so the visible size is unchanged.

| Control | Where | Size |
|---|---|---|
| Footer About / Privacy / Feedback links | [App.tsx:899-916](src/App.tsx:899) | ~16px tall |
| Toast dismiss x | [App.tsx:88-94](src/App.tsx:88) | ~28x20px |
| SW-update banner dismiss x | [SwUpdateBanner.tsx:109-116](src/components/SwUpdateBanner.tsx:109) | ~16px |
| Install-prompt dismiss x | [InstallPromptBanner.tsx:162-169](src/components/InstallPromptBanner.tsx:162) | ~24x16px |
| Per-row reminder cancel x | [ScheduledRemindersSection.tsx:382-391](src/components/ScheduledRemindersSection.tsx:382) | ~26px |
| Camera-denied banner dismiss x | [SignScanner.tsx:405-411](src/components/SignScanner.tsx:405) | ~12x18px |
| "+N more" pill (opens the actives list) | [ActiveSessionCard.tsx:149-156](src/components/ActiveSessionCard.tsx:149) | ~22px |
| "Draft an appeal" home entry | [App.tsx:891-896](src/App.tsx:891) | ~20px |
| Back links (history, session, scanner, appeal, settings) | [SessionHistory.tsx:42](src/components/SessionHistory.tsx:42) and siblings | ~20px |
| Note "Add note"/"Edit"/"How to verify"/retry links | [SessionDetail.tsx:411-417](src/components/SessionDetail.tsx:411) | ~16px |
| "Reset draft" link | [AppealFlow.tsx:177-182](src/components/AppealFlow.tsx:177) | ~16px |

---

## Tier 3 — polish

### Decorative glyphs exposed to screen readers (1.1.1 / 1.3.1 A)
Each reads as literal noise ("bullet", "P", "middle dot", "check mark") before meaningful content. Fix: `aria-hidden="true"` on the glyph span.

| Glyph | Where |
|---|---|
| `•` before each sign observation | [ParkingResult.tsx:304-310](src/components/ParkingResult.tsx:304) |
| `P` permit-zone icon letter | [ParkingResult.tsx:439-441](src/components/ParkingResult.tsx:439) |
| `·` separators (auth links, signed badge) | [AuthFlow.tsx:392](src/components/AuthFlow.tsx:392), [SessionDetail.tsx:252](src/components/SessionDetail.tsx:252) |
| `✓` success checkmark | [FeedbackModal.tsx:129-131](src/components/FeedbackModal.tsx:129) |

### Touch targets between 24px and 44px (meet AA 2.5.8, miss AAA 2.5.5)
These pass the AA minimum but miss the 44px enhanced target. Worth raising on the destructive and high-frequency ones; pure polish elsewhere. Fix: `py-2.5 min-h-[44px]`.

| Control | Where | Size |
|---|---|---|
| Feedback modal close x | [FeedbackModal.tsx:151-159](src/components/FeedbackModal.tsx:151) | ~36px |
| Reminder "+ Add another" / "Cancel all" / pick-cancel | [ScheduledRemindersSection.tsx:406-426](src/components/ScheduledRemindersSection.tsx:406), :472 | ~36px / text |
| Reminder chips (both pickers) | [ReminderOptions.tsx:425](src/components/ReminderOptions.tsx:425), :694; [ScheduledRemindersSection.tsx:443](src/components/ScheduledRemindersSection.tsx:443) | ~28-36px |
| Language selector trigger + option rows | [LanguageSelector.tsx:77-84](src/components/LanguageSelector.tsx:77), :112 | ~28px / ~36px |
| iOS install hint dismiss | [IosInstallHint.tsx:79-84](src/components/IosInstallHint.tsx:79) | ~24px (scrapes AA) |
| Note Cancel / Save | [SessionDetail.tsx:436-448](src/components/SessionDetail.tsx:436) | ~28px |
| Account-delete confirm (Cancel / Delete forever) | [AuthSettings.tsx:210-223](src/components/AuthSettings.tsx:210) | ~40px (destructive, worth the 4px) |

---

## What is not a problem (filtered)

- **Reduced motion.** Fully handled by the global rule at [index.css:105](src/index.css:105). Zero findings. Don't touch it.
- **`AuthFlow` forms.** Inputs are wrapped in real labels. The sign-in form is the one done right; mirror its pattern for the others.
- **Decorative icons.** The `Icon` component sets `aria-hidden="true"` on its `<svg>`, so the stroke icon set is correctly hidden.
- **Nested interactive elements.** None. The active card deliberately positions the "+N more" pill outside its parent button to avoid button-in-button.
- **Dark mode.** There is none; the app is light-only. The contrast findings above are all in the actual light palette, not an invented dark one.

---

## Suggested sequence

Four fixes close most of the 48.

1. **One live-region pattern.** Build a tiny `<LiveRegion>` (or a shared `role="status"` wrapper) and drop it on the verdict, loading, errors, GPS, reminders, copy, Toast, and auth-info. That single pattern clears Tier-1 items 4 and 5 plus the whole Tier-2 screen-reader cluster: the largest accessibility gap, closed by the smallest amount of repeated code.
2. **Per-surface text colour for contrast.** Carry the text colour alongside the surface in `URGENCY_STYLES` / the gradient cards, darken the teal CTAs to `accent-800` (or flip to `ink-900`), and step the footer text to `ink-700`. Fixes all five contrast findings.
3. **A shared "tappable" class.** `min-h-[44px] inline-flex items-center` plus negative margin, applied to the small buttons and links, fixes all 20 touch-target findings without changing a single visual size.
4. **Mechanical form association.** `id`/`htmlFor`, `role="alert"` on errors, `autocomplete`, and a focus trap on the feedback modal. Copy the pattern `AuthFlow` already uses.

None of this is a redesign. It is wiring the semantics and the sizing the visual design already implies, so the app works for the part of its public audience that can't see the screen or can't tap a 16px target.
