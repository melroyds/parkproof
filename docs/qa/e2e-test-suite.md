# ParkProof manual e2e launch-gate suite

_Concrete, runnable test cases covering every user-facing flow. This is the human gate that catches what unit tests structurally can't (real camera, real GPS, real Claude, real cross-device sync). The **P1 block is the launch gate**: all P1 cases must pass on a real phone before posting. P2/P3 are the fuller regression sweep, run them before a marketing push, not every deploy._

## How to use this

- **P1** = blocks launch. A user hits it on the happy path; if it's broken, do not post. ~12 cases, ~30 minutes on a phone.
- **P2** = important, run before any traffic spike. Degraded-but-not-broken or lower-frequency paths.
- **P3** = edge/polish. Run when touching the relevant area.
- Record pass/fail + device/browser. A case "passes" only if the **Expected** matches exactly, partial is a fail with a note.

## Prerequisites and test data

Have these ready before starting, several cases are unreachable without them:

| Item | Why |
|---|---|
| A real phone (iOS Safari **and** Android Chrome ideally) | The product is mobile-first; desktop hides GPS/camera/push paths. |
| A **paid-parking** sign (meter/app zone) | Only way to reach the pay-gate + parking-app deep-links. |
| A **stacked multi-rule** sign (clearway + arrows) | The 30-50s async path, the clarify step, the hardest accuracy case. |
| A **disability-permit** and a **permit-zone** sign | The two other gates. |
| A sign that reads **"cannot park now"** | The can't-park override flow. |
| A photo of a real **infringement notice** | The appeal flow (both linked + standalone). |
| **Two devices** + a test Cognito account (email + password) | Cross-device cloud sync, the highest-risk data path. |
| An **Apple ID** and a **Google account** | Federation. |

## Highest-risk untested paths — verify these by hand every launch

These have **zero or partial unit coverage** (see [`../testing.md`](../testing.md)) and fail *silently*. A green CI badge says nothing about them. Manually confirm:

1. **Evidence PDF re-verifies (P0).** Export a signed session's PDF, follow its own openssl walkthrough on a desktop, and confirm the signature line reports OK. _Known P0: the photo-hash step currently cannot pass (jsPDF recompresses); confirm the metadata-signature step at least verifies, and that the PDF does not claim success it can't deliver._ See **PP-014**.
2. **Cross-device photos actually arrive (P1).** Sign in on device B, open a session saved on device A, confirm the **photos render** (not just the session count). This is the exact failure that was silent for 2 days in May. See **PP-021**.
3. **A photo-upload failure is surfaced, not swallowed (P1).** Force a sync failure (airplane mode mid-save while signed in) and confirm the UI shows the "photo didn't sync" banner with retry, rather than a session row with blank photos. See **PP-022**.
4. **No personal address leaks where it shouldn't (P1).** Check the appeal letter and the feedback payload for a precise street address you didn't intend to share. See **PP-019, PP-028**.

---

## P1 — Launch gate

### PP-001 · First-run landing
**Priority:** P1 · **Prereq:** empty localStorage (fresh install / private window)
**Steps:** Open `/app/` cold. Observe the landing (hero photo, split-colour headline, 3 value bullets, accuracy caveat, "How it works" 3-card grid, footer with About/Privacy/Feedback + standalone "draft appeal" link).
**Expected:** Landing renders fully; Scan button is primary and tappable; no history row, no active-session card; if auth is configured a secondary "sign in to sync" shows, if not it's absent (no broken button).

### PP-002 · Core scan → result → log → remind (happy path)
**Priority:** P1 · **Prereq:** a clear, simple time-restriction sign; GPS on
**Steps:** Scan button → "Take a photo" → capture the sign → wait for the verdict → on a "can park" result tap Save → fill/confirm address → Save → pick a reminder offset → Done.
**Expected:** Verdict card appears within ~6-15s for a simple sign; shows can-park + leave-by time + plain-English rules + observations; Save flows to logger with a reverse-geocoded address; reminder picker offers offsets; returns home with an active-session card counting down.

### PP-003 · Stacked-sign async path
**Priority:** P1 · **Prereq:** a stacked multi-rule sign (clearway + arrows)
**Steps:** Scan it. Watch the stepped loading UI through the full read.
**Expected:** The read completes (may take 30-50s) without a "Service Unavailable" / gateway-timeout error; the stepped loader advances; the result is coherent (the async-polling path is working). If it routes to a clarify step, that's correct (PP-004).

### PP-004 · Clarify step (position-dependent / multi-arrow)
**Priority:** P1 · **Prereq:** a sign with a left/right arrow split
**Steps:** Scan → on the clarify screen, read the question, pick one side.
**Expected:** One big button per variant; picking a side merges *that side's* rules and leave-by; only the chosen side's gate flags fire (e.g. if only the left side is permit-zone, picking right shows no permit gate). Back returns to the question.

### PP-005 · Paid-parking gate + parking-app deep-links
**Priority:** P1 · **Prereq:** a paid/metered sign; phone with EasyPark or PayStay installed (ideally)
**Steps:** Scan the paid sign → on the result, find the amber pay-required section → tap "Open EasyPark" (or PayStay/Wilson) → return → tick the "yes I paid" checkbox → Save.
**Expected:** Pay section shows the right app buttons (PayStay + EasyPark always; Wilson when the sign names it); tapping opens the installed app (iOS) or the app/Play Store (Android), not a dead `easypark://`; Save is disabled until the checkbox is ticked.

### PP-006 · Disability-permit gate
**Priority:** P1 · **Prereq:** a ♿ permit sign
**Steps:** Scan → observe the red ♿ section above any pay section → try Save (blocked) → tick "I have a valid permit" → Save.
**Expected:** Save is gated on the permit checkbox; if the sign *also* requires payment, both checkboxes are mandatory; ♿ shows first (highest severity).

### PP-007 · No-sign logging
**Priority:** P1 · **Prereq:** GPS on
**Steps:** Scan view → "No sign here" → choose to photograph surroundings (or skip) → Save → pick a duration-based reminder.
**Expected:** Routes to the no-sign reminder picker (duration chips, not expiry offsets); session saves as open-ended-active; appears on home and stays active until "I've left"; excluded from smart-rescan matching.

### PP-008 · Smart re-scan / refresh
**Priority:** P1 · **Prereq:** a saved session ≤7 days old, within ~40m
**Steps:** Return to roughly the same spot → on the scan screen tap the proximity ReuseCard (or "Re-check now" on the active card) → wait.
**Expected:** Refresh is fast (~3s, text-only, no camera) and returns an updated can-park / leave-by using the prior reading; no new vision call. On desktop / poor GPS it falls back to the RecentScansPicker instead of the proximity card.

### PP-009 · Active-session home card
**Priority:** P1 · **Prereq:** one active session
**Steps:** From home, observe the active card.
**Expected:** Live countdown (or elapsed for no-sign) with urgency colour; address; "Move by" line; next-ping line if reminders queued; walk-back appears when >30m away; "I've left" present.

### PP-010 · History list → session detail
**Priority:** P1 · **Prereq:** ≥1 saved session
**Steps:** Home history row → list → tap a session.
**Expected:** List shows thumbnail + date + address + rules/no-sign badge + status; detail shows photos, rules, location, note, reminders, and the export/appeal/delete actions; empty history shows the illustration + copy.

### PP-011 · Evidence PDF export
**Priority:** P1 · **Prereq:** a saved, **signed** session (wait a moment after save for signing)
**Steps:** Session detail → "Export as PDF" → open the file.
**Expected:** PDF downloads (Safari gesture window preserved); contains the sign/car photos, rules, address, timestamp, the driver's note if any, and the signature appendix with the openssl walkthrough. Photos are embedded, not "could not be embedded."

### PP-012 · AI-drafted appeal (linked session)
**Priority:** P1 · **Prereq:** a saved session + an infringement-notice photo
**Steps:** Session detail → "Draft appeal" → photograph the notice → wait for the draft → review → edit → copy or export PDF.
**Expected:** Async draft completes; shows a ticket summary + evidence-strength badge + an editable formal letter; copy-to-clipboard works (or falls back to manual select in a PWA); PDF includes the linked evidence.

### PP-013 · Sign-in (email/password)
**Priority:** P1 · **Prereq:** test account
**Steps:** "Sign in to sync" → sign in (or sign up → verify code → auto-sign-in) → land home.
**Expected:** Correct stage transitions; wrong-credentials / already-exists / code-mismatch show *friendly translated* copy, never a raw Cognito exception; an unconfirmed sign-in routes to the verify stage; success returns home and triggers initial sync.

### PP-014 · Signature verifies externally (P0 trust check)
**Priority:** P1 · **Prereq:** an exported signed PDF + a desktop with openssl
**Steps:** Follow the PDF's own verification walkthrough: save the public key, recreate the canonical payload, run `openssl dgst -sha256 -verify`.
**Expected:** The metadata signature reports **Verified OK**. _Note the P0: get the canonical payload bytes exactly (watch the trailing newline). Confirm the document does not assert photo-hash verification it cannot deliver._

### PP-015 · Cross-device cloud sync (P1 data integrity)
**Priority:** P1 · **Prereq:** two devices, same account, a session saved on device A
**Steps:** Sign in on device B (fresh) → wait for sync → open the session from A.
**Expected:** Device B pulls the session into its list **and the photos render** (not just a count); home re-derives correctly (does not get stuck on the first-run landing). This is the highest-risk silent-failure path.

---

## P2 — Pre-traffic sweep

### PP-016 · Permit-zone gate
**P2** · Scan a residential/business permit-zone sign. **Expected:** amber permit-zone section (with area name if present), mandatory checkbox, Save gated; stacks correctly with ♿/pay (severity ♿ > permit-zone > pay).

### PP-017 · Can't-park override
**P2** · Scan a "no parking now" sign. **Expected:** no Save button; instead an "AI may have misread, log as evidence anyway" path that routes to the logger; no gates fire; session saved with whatever expiry the rules imply.

### PP-018 · Verify / feedback
**P2** · On any result, tap "Looks right" then (fresh scan) "Retake". **Expected:** "Looks right" confirms inline and submits a verdict; "Retake" returns to scan; double-submit is guarded.

### PP-019 · AI-drafted appeal (standalone, no session)
**P2** · Home → "Draft an appeal" with no saved park. **Expected:** drafts from the notice alone; standalone intro copy; **no** Download-PDF button (nothing to attach); Back goes home. _Check the letter does not cite a precise home address._

### PP-020 · Reminders — expiry-offset picker
**P2** · After saving an expiry-bearing session, open the offset picker. **Expected:** offset chips (30/15/10/5/2/0 before expiry) with past ones disabled; live fire-time summary; .ics download + in-tab + push rails; "reminders expired" empty state if the sign already lapsed.

### PP-021 · Reminders — no-sign open-ended picker
**P2** · Reminder step for a no-sign session. **Expected:** duration chips (30m-8h from now), default 1h, absolute fire-times; "check on your car" copy.

### PP-022 · Scheduled-reminder self-management
**P2** · Session detail → scheduled reminders section. **Expected:** lists future pushes with human labels + per-row cancel; "+ Add reminder" picker filters out past/duplicate times; section self-hides when none and can't-add.

### PP-023 · End session ("I've left")
**P2** · Tap "I've left" on the active card (and "End session" in detail). **Expected:** confirm → card disappears → record stays in history → future push reminders cancelled → mirrors to cloud if signed in.

### PP-024 · Sign-in via Apple / Google
**P2** · "Continue with Apple/Google" → consent → return. **Expected:** redirects to the provider, returns through `/auth/callback` (rewritten to the app), lands signed-in home; a splash covers the callback beat; failure releases the splash (no infinite spinner).

### PP-025 · Account data export
**P2** · Settings → "Export my data". **Expected:** a single PDF with a cover summary + every session; per-photo embed failures tolerated; friendly error on failure (no raw detail); signed-in only.

### PP-026 · Account deletion
**P2** · Settings → danger → "Delete account" → type `DELETE`. **Expected:** button disabled until the word matches exactly; deletes DDB rows + S3 photos + Cognito user; signs out locally; returns home. Irreversible, verify on a throwaway account.

### PP-027 · Sign-out
**P2** · Settings → "Sign out". **Expected:** returns to anonymous home; local sessions remain; cloud copy untouched.

### PP-028 · Free-text feedback (P1 PII check)
**P2** · Home footer → "Send feedback" → submit a message. **Expected:** modal focus-trapped, Esc/backdrop close, required message (5000 cap) + optional email, submits; won't close while submitting. _Confirm you are not unintentionally sending PII, the message is logged verbatim server-side._

### PP-029 · Push notification management
**P2** · Settings/About push block → Enable → Disable. **Expected:** Enable subscribes (VAPID) and shows a subscribed pill; Disable confirms and unsubscribes; section hidden entirely on unsupported (iOS Safari <16.4); denied permission shows guidance, no enable button.

### PP-030 · Web Push delivery + click
**P2** · Schedule a near-term reminder, background the app, wait for the push. **Expected:** notification fires with address title + time-left body; tapping focuses/opens the app; per-session tag collapses duplicates.

### PP-031 · Cloud-sync failure is surfaced (P1 data integrity)
**P2** · Signed in, enable airplane mode mid-save. **Expected:** the session shows a "photo didn't sync" banner with a retry affordance, **not** a silent row with blank photos. Re-enabling network + retry uploads the photos.

### PP-032 · Language switch (9 locales)
**P2** · Header language selector → pick each of the 9. **Expected:** entire UI re-renders in the chosen language including buttons and the PDF strings; native names + flags correct; Hindi/Punjabi disambiguated by script; outside-click/Esc closes.

### PP-033 · Error view + offline
**P2** · Trigger a failed scan (airplane mode, then scan). **Expected:** offline-aware copy when `navigator.onLine` is false; "Try again" → scan, "Back home" → home; raw error shown only for non-offline failures.

---

## P3 — Edge / polish

### PP-034 · Photo-quality pre-check
**P3** · Capture a blurry or dark sign. **Expected:** amber verdict-specific warning; button becomes "Translate anyway"; never blocks; analysis error fails open (continues).

### PP-035 · Camera-denied fallback
**P3** · Deny camera permission, tap "Take a photo". **Expected:** amber "camera denied" hint pointing at "From library"; library path always works; no false hint on the happy path.

### PP-036 · GPS / address handling in logger
**P3** · Save with good GPS, then with GPS denied. **Expected:** good GPS reverse-geocodes; imprecise GPS warns + offers manual address (won't reverse-geocode unreliable coords); can save via typed address with no GPS.

### PP-037 · Driver's note
**P3** · Add a note in session detail. **Expected:** 280-char cap + counter; saves + mirrors to cloud; renders verbatim and appears in the PDF; a quota error keeps edit mode so text isn't lost.

### PP-038 · Multiple active sessions
**P3** · Have ≥2 active sessions → "+N more" pill → list. **Expected:** full list sorted soonest-expiring first; urgency-striped rows; mixes expiry-bearing and open-ended no-sign rows.

### PP-039 · Walk-back navigation
**P3** · From an active session >30m away. **Expected:** distance + walk-minutes + a deep-link that opens Apple/Google Maps walking directions; hidden when ≤30m; works even if the current-position fetch fails.

### PP-040 · PWA install + offline shell
**P3** · Install to home screen, then open offline. **Expected:** installs with icon + splash; app shell loads offline; a scan offline fails gracefully to the error view (Claude needs network); existing PWA users may need a hard refresh after a deploy (stale-shell).

### PP-041 · Privacy + About pages
**P3** · Footer → Privacy, → About. **Expected:** both render and route back home; About is the anonymous-user push-management surface; contact shows the role alias `hello@parkproof.com.au`, never a personal address.

---

## Sign-off

A launch is **green** when every **P1** case passes on at least one real iOS device and one real Android device, and the four highest-risk untested paths (PP-014, PP-015, PP-028, PP-031) have been hand-verified. Record the run date, devices, and any P2/P3 fails accepted as known-issues in the launch notes.
