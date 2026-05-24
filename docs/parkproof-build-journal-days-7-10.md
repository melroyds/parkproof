# ParkProof — Build Journal Addendum · 22-25 May 2026

*Days 7-10 of the build, written contemporaneously. Companion to the
five-day journal covering 16-21 May. Same rule: no retroactive
tidying-up. The dead ends and the decisions both get to stay raw.*

By Day 7 the app is feature-complete. The work changes shape — most
of the next four days is **scrubbing personal identity off the public
surface, hardening for traffic that hasn't arrived yet, and catching
the kind of silent failures that pass CI but show up as cringe on
launch day**.

| Date   | Theme                       | Headline work                                                                                |
|--------|-----------------------------|----------------------------------------------------------------------------------------------|
| 22 May | De-identify + Web Push      | Apple Bundle ID rotation · web push end-to-end · 7 → 9 languages · visual pop refresh        |
| 23 May | Two-app architecture        | Marketing landing at `/`, PWA at `/app/` · considered-and-deferred docs                       |
| 24 May | Pre-launch hardening (Tier 1) | PDF font crisis caught · Lambda warmer · /verify page · scheduled-reminder visibility · 14 more |
| 25 May | Launch eve                  | Sign-in CTA gap · screenshot refresh · Reddit thumbnail · case-study tightening              |

Net additions: 9 → confirmed-shipped locales · 1 Apple Bundle ID
rotation · 1 two-app cutover · 1 silent PDF-export bug caught before
~30% of users saw it · 1 self-service reminder management surface ·
1 public-key verifier page that anyone can use offline.

---

## DAY 7 · Fri 22 May 2026 · De-identify + Web Push

A long day. ~25 commits. The brief: **strip every trace of personal
identity from the public surface before posting on Reddit**, finish
the Web Push pipeline end-to-end, and add the two locales the
LGA-census pass had missed.

The de-identification pass alone was eight commits. The personal name
was on the About page footer, in the LinkedIn case-study link, in the
"melroy@" email address used as the privacy-policy contact, and —
most awkwardly — in the Apple Sign-in OAuth consent screen, which
read *"Continue to ParkProof using your Apple ID. Created by
[Personal Name]."* Every single one of those is a place a Reddit
commenter could screenshot and turn into the post. The fix was
methodical: swap to `hello@parkproof.com.au` everywhere, drop the
LinkedIn refs, rotate the Apple App ID + Services ID + Key to a
new bundle (`au.com.parkproof.app`) that carries no personal name,
and re-translate the About page across the 7 then-supported locales
so the new copy stayed consistent.

The Web Push pipeline shipped in four staged commits — foundation
(VAPID + DDB subscription store + `/push/subscribe` route), service
worker push + notificationclick handlers (which required switching
`vite-plugin-pwa` from `generateSW` to `injectManifest` mode so the
SW could carry our custom handler), the EventBridge Scheduler
dispatcher, and a cancel-on-end-session sweep that fan-outs
`DeleteSchedule` calls when the driver signals "I've left." The
trade-off worth naming is below.

Then the visual pop refresh: AI-generated photoreal hero (Nano
Banana) composited with the layered-P brand mark on the sign face,
split-colour `Parking made simple.` headline, purple-gradient primary
CTA, dot-grid background, sage + topographic rings + corner aurora
("variant J") replacing the cool tech-grey body bg. Five style
iterations on the aurora alone before the 3× radius felt right.

And finally: Indonesian + Korean. The original LGA-census pass had
picked seven languages off the 2021 ABS data; a sanity-check on the
actual City of Melbourne ranking surfaced Indonesian (#3) and Korean
(#6) as top-non-English-spoken-at-home languages the first cut had
missed. Adding them was ~2 hours of translation + flag-picker
updates. Worth it for the defensibility of the locale set.

### DECISION · Push schedule naming — deterministic vs random?

```
Q: One EventBridge Scheduler schedule gets created per chosen
   reminder offset (15min, 30min, 1hr...). When the driver ends
   the session early, we need to delete all of them. How do we
   find them to delete?

           +-- A · Random UUID names, ListSchedules at delete time
           |       ✗ Needs scheduler:ListSchedules IAM permission
           |       ✗ ListSchedules is rate-limited and paginated
           |       ✗ Race condition: a new schedule might land
           |         between list and delete
           |
   Find ---+
           |
           +-- B · Deterministic names  ←  CHOSEN
                   `parkproof-push-{session_id}-{i}`
                   ✓ Cancel = 6 parallel DeleteSchedule calls,
                     no list needed
                   ✓ No new IAM permission to grant
                   ✓ Idempotent on re-pick (overwrite same name)
                   ✓ Trivial to reason about in logs
```

The path mattered more than the destination. The deterministic-name
trick let the cancel pathway stay as boring as `Promise.all(offsets.
map(i => deleteSchedule(name(sessionId, i))))` without ever calling
`ListSchedules`.

### DECISION · Personal identity on public surfaces

```
Q: Reddit-launch ready means a stranger can fully inspect the
   product without finding the author's name, LinkedIn, or
   personal email. Which surfaces need scrubbing?

   Audit pass identified:
   1. About page footer  →  swap "Made by [Name]" to brand-only
   2. Privacy-policy contact email  →  hello@parkproof.com.au
   3. Apple Sign-in OAuth consent  →  rotate Bundle ID
   4. README + case-study LinkedIn refs  →  drop entirely
   5. VAPID subject (mailto:)  →  swap to hello@
   6. Source code "Author:" tags  →  scrub (kept in git history)

   The Apple rotation was the awkward one — burning the old
   Bundle ID, Services ID, Key ID, and consent-screen string
   meant re-uploading the Apple JWT private key. Done via a
   project-relative JSON file because the inline shorthand
   rejected the multiline private key on update (gotcha logged
   in CLAUDE.md for next time).
```

### Commits — Day 7 (25 commits)

```
38718ec  feat(about): drop "on the way" section + translate to 7 languages
61b3e1e  fix(about): strip personal identity from in-app footer (Reddit-safe)
583b7e9  feat(push): web push foundation (subscribe + persist)
62ae67d  fix(push): add @aws-sdk dynamo packages at root for test script
f375a7a  feat(push): SW push + notificationclick via injectManifest
a1f8b4a  fix(push): check actual subscription, not just permission
a97c576  feat(push): scheduler + de-identification + docs refresh
848bd44  docs(readme): finish the audit — file tree + script table
eaa6bdb  docs(screenshots): regenerate all 16 with current UI
495e5f6  chore(auth): rotate Apple Bundle ID + Services ID + Key
b8c0532  feat(permit-zone): acknowledgment gate for permit holders
18c5546  feat(landing): visual pop refresh — split-colour hero + gradient CTA
3296efa  style(polish): gradient CTAs across screens + dot-grid background
50fcaeb  feat(reminders): open-ended picker for no-sign sessions
cf50f36  style(bg): warm paper background (#FAF6EE) instead of tech-grey
d1a30af  style(hero): dimensional hero illustration upgrade
0eb5f2d  feat(hero): swap SVG illustration for AI-generated photoreal hero
b0aa621  fix(hero): re-bake composite — brand mark was 63px outside sign face
681e50b  fix(hero): App.tsx returning-user header still pointed at deleted .svg
7eaac63  feat(landing): promote hero photo to full-width banner
bc65ef7  refactor(hero-bake): promote sign-bbox detection into the script
a9bcb61  feat(hero): swap in higher-res Nano Banana photo (1152x928)
28b5847  fix(i18n): localise countdown "left" label + swap car-photo fixture
298ed17  fix(screenshots): screenshot 07 was reading seeded fixture, not live
0bf27cc  feat(bg): ship sage + topographic rings + corner aurora ("variant J")
1aba9f9  style(bg): bump aurora from 500px to 2000px (4× linear)
90ccae4  style(bg): dial aurora back from 4× to 2× (sweet spot)
778bf28  style(bg): aurora to 3× — Goldilocks middle ground
53a7604  feat(i18n): add Indonesian + Korean (7 → 9 languages)
0756585  docs: final pre-launch consistency sweep — 9 languages, 7 days
```

---

## DAY 8 · Sat 23 May 2026 · Two-App Architecture

A focused, short day — 5 commits. The biggest one is the **two-app
architecture cutover**: marketing landing page at `/`, React PWA at
`/app/`. Until today, the React app was serving the marketing page
too — bundle bloat, slower first paint, and the React Router-less
"home" view doing double duty as a landing page. Splitting them
freed the landing to be hand-tuned static HTML/CSS (instant first
paint, no JS to parse) while the PWA stayed at `/app/` with all the
state-machine routing intact.

The trade-off was real: every `<img src="/foo.png">` in the React
app had to route through Vite's `BASE_URL` after the cutover or it
404'd because the asset now lived at `/app/`. The 4add63e commit was
the cleanup pass — every absolute-path asset got either a
`${import.meta.env.BASE_URL}` prefix or moved into the new
`public/app/` mirror. CloudFront also needed a viewer-request
function (`parkproof-uri-rewrite`) to handle the trailing-slash
resolution that OAC + S3 REST origins don't do natively (S3 returns
404 for `GET /app/`; the function rewrites to `/app/index.html`).

The other thread was **considered-and-deferred docs**. Three of
them: voice confirmation (Web Speech API), localising the marketing
landing, and offline / hybrid sign reading. Each one had a real
reason it didn't ship — voice is redundant when the user is already
holding the phone next to the sign, localising the landing 8 times
over costs more than it earns until traffic justifies it, and
offline sign reading needs a Claude-class model in the browser which
doesn't exist yet. Each got a paragraph in `docs/features.md` so
future-me has the reasoning when the question comes back.

### DECISION · One app or two?

```
Q: The landing page (hero + 3 feature cards + CTA) is currently
   the React app's "home" view. Should it stay there, or split
   into a separate static page at /?

           +-- A · Keep one app, render landing as a React view
           |       ✗ Ships all of React + i18n + auth code to a
           |         visitor whose only intent is to read the
           |         pitch and click Scan
           |       ✗ First paint blocked on bundle parse
           |       ✗ Landing redesigns require a full app redeploy
           |
   Apps ---+
           |
           +-- B · Two apps — static landing at /, PWA at /app/  ←  CHOSEN
                   ✓ Landing is 30KB of hand-tuned HTML/CSS,
                     instant first paint
                   ✓ React app stays at /app/ behind its own
                     code-split chunks
                   ✓ The marketing page can be edited and pushed
                     without touching the app
                   ✗ Every absolute-path asset reference in the
                     app needs to route through BASE_URL — one
                     careful cleanup pass (4add63e)
                   ✗ CloudFront viewer-request function needed
                     for /app/ trailing-slash → /app/index.html
                     (S3 REST origins don't do this natively)
```

### Commits — Day 8 (5 commits)

```
deae35e  feat: two-app architecture — marketing landing at /, PWA at /app/
4add63e  fix: route absolute-path assets through Vite base after /app/ cutover
244db78  docs: capture two-app cutover gotchas in migration runbook
860a2fe  docs(status): mark Web Push + two-app shipped, refresh canonical
5e9e844  docs: file voice confirmation as considered-and-deferred
```

---

## DAY 9 · Sun 24 May 2026 · Pre-launch Hardening (Tier 1)

The most PM-y day of the project. With the feature set frozen and CI
green, I sat down on Sunday afternoon — ~48 hours before the planned
Reddit launch — and explicitly enumerated **what could break under
launch traffic that a green build wouldn't catch**. Six items, ~5
hours of work, framed as a "Tier 1" list: *if any of these fails on
launch day, you'll cringe*. Then I worked the list.

22 commits. The single biggest catch is the one I almost shipped
without noticing.

> **The PDF font crisis.** Item 1 on the audit list was *"actually
> export a PDF in every supported locale."* I'd never done it. The
> strings were translated, `jsPDF` was wired in, the UI worked.
> But `jsPDF` ships with Adobe Type 1 fonts that have zero glyph
> coverage for Devanagari, Gurmukhi, CJK, Greek, or Vietnamese.
> Six of nine locales rendered evidence PDFs as **missing-glyph
> rectangles**. Silent data corruption for ~30% of supported users.
> Would have been a *"btw your evidence PDF is just boxes"* Reddit
> comment within hours of going live.

The fix was substantive but mechanical once the diagnosis was right:
source variable-weight Noto Sans TTFs from the Google Fonts GitHub
repo, write a Python build-time script that subsets each font down
to just the glyphs that appear in the locale JSONs (94% size
reduction — Chinese Simplified went from 17MB to 893KB), self-host
the subsets on CloudFront, lazy-load the right one per locale at PDF
export time. Two hours of focused work. Ships clean.

The interesting bit isn't the fix — it's that the *audit* found it.
A different sequencing (skip the audit, trust the build, hit publish)
would have shipped the bug.

### DECISION · The Tier 1 audit list

```
Q: Feature work is done, CI is green, the site is technically
   launch-ready. What could still cringe on launch day?

   The list I wrote on Sunday afternoon:

   1. PDF export in every locale, not just English
      → Caught: 6/9 locales rendered as glyph boxes. Fixed.
   2. Reddit / iMessage / LinkedIn share preview
      → Caught: no OG tags on the new marketing landing. Fixed.
   3. First Reddit visitor's cold-start latency
      → Caught: 1-3s p99 cold-start. Fixed with EventBridge
        warmer pinging every 5min.
   4. Reminder visibility after setting
      → Caught: pushes were invisible after configuration. Built
        self-service management surface.
   5. CloudWatch dashboard for the launch window
      → Built. 9 widgets across 4 rows.
   6. Rollback playbook in CLAUDE.md
      → Written. Symptom triage table + revert recipes.

   Every item is a thing that doesn't fail a test, can't be
   caught by lint, and isn't worth a feature PR — but each one,
   left unchecked, becomes a launch-day cringe moment.
```

### DECISION · PDF font sourcing strategy

```
Q: jsPDF needs a TTF (not WOFF/WOFF2) registered per locale at
   export time. Six locales need non-Latin scripts. What's the
   smallest, most maintainable pipeline?

           +-- A · @fontsource v5 from npm
           |       ✗ Ships WOFF only. jsPDF needs TTF.
           |       ✗ Adds 5 new top-level dependencies for what
           |         is fundamentally a static asset problem.
           |
           +-- B · Bundle full Noto Sans TTFs with the SPA
           |       ✗ Chinese Simplified is 17MB uncompressed.
           |         Korean is 11MB. Inflates the bundle ~50MB
           |         for users who'll never trigger PDF export
           |         in those locales.
           |
   Fonts --+
           |
           +-- C · Subset + self-host + lazy-load  ←  CHOSEN
                   • Source: google/fonts GitHub raw URLs
                   • Build: scripts/_subset_pdf_fonts.py runs
                     pyftsubset over each locale JSON's unique
                     glyphs, --no-hinting --desubroutinize
                   • Result: 94% size reduction (CJK 17MB → 893KB)
                   • Runtime: src/lib/pdf-fonts.ts lazy-fetches
                     the right subset for the active locale
                   ✓ Bundle stays small
                   ✓ Subset is reproducible — re-run the script
                     when locales change
                   ✓ jsPDF gets a real TTF with the glyphs it
                     needs and nothing else
                   ~ One Python build dep (fontTools) — deploy.sh
                     skips gracefully if missing
```

### DECISION · Reminder visibility — invisible vs managed

```
Q: After the user picks reminder offsets, the schedules live in
   EventBridge — invisible from the app. The .ics calendar event
   renders in the user's calendar, but Web Push is a black box:
   set-and-forget, no way to see what's queued, no way to cancel
   one without redoing the whole session. That violates the trust
   principle the rest of the product is built on.

           +-- A · Don't show anything; trust EventBridge
           |       ✗ User can't verify reminders were set
           |       ✗ "I never got the push" — was it never queued,
           |         or did the user deny permission, or did the
           |         SW fail? No way to tell from the app.
           |
           +-- B · Show a passive list — no controls
           |       ✗ Half-measure. User sees "3 reminders queued"
           |         but still can't change them.
           |
   Vis  ---+
           |
           +-- C · Full self-service management  ←  CHOSEN
                   • Lists every queued fire_at, time-formatted
                   • Per-row × cancel (DeleteSchedule one-shot)
                   • "+ Add reminder" picker filtered to offsets
                     that haven't already fired or aren't queued
                   • Preserves per-reminder body text across edits
                     (bug caught and fixed pre-launch)
                   ✓ The feature went from fire-and-forget to
                     managed-and-trusted in 2.5 hours
```

### Commits — Day 9 (22 commits)

```
bfc3d24  docs+i18n: soften legal-promising language across all surfaces
1a4eb51  docs: regenerate screenshots + PDFs after tamper-proof language sweep
d870c9a  fix(landing): drop EVIDENCE.PDF tab on Evidence section image
39f6b33  fix(landing): swap PDF mockup's Sign photo from scanner to real sign
411e536  docs: file offline / hybrid sign reading as considered-and-deferred
9fa6ae6  feat(landing): public /verify/ page with openssl walkthrough
5ebe6b3  feat(privacy): federated sign-in section in in-app privacy policy
5fc42a3  fix(wiring): PEM at site root + /verify discoverability
eaa3d16  feat(verify): multi-lingual /verify pages in all 9 locales
b68b9cd  feat(verify): auto-detect chip on /verify/ + locale-aware link
210a580  refactor(about): translated, contextual push-subscribe block
d68cd07  fix(i18n): include querystring in detection chain
c243877  fix(landing): pass ?lng= to chip target URL
4c6bc4f  docs: file landing translation as considered-and-deferred
5eda011  fix(pdf): render non-Latin scripts via self-hosted Noto Sans
5e782ba  feat(lambda): pre-warm via EventBridge to kill cold-start
0efe3d4  docs: add rollback playbook to CLAUDE.md
6307c64  feat(seo): OG cards + canonical + robots/sitemap on landing
732d584  feat(pwa): service worker update banner
937958d  feat(ops): launch-day CloudWatch dashboard + 30-day log retention
7706116  feat(reminders): scheduled-reminder visibility + per-session mgmt
ce6005d  fix(reminders): preserve per-reminder body text across edits
19cff0a  docs: refresh case study + README + lessons for launch readiness
62146aa  feat(a11y): reduced-motion respect + OAuth callback splash
c4e3e84  feat(polish): Tier 3 polish bundle — 5 self-contained launches
```

---

## DAY 10 · Mon 25 May 2026 · Launch Eve

Three commits, three categories of fix: a genuine UX gap, a stale
asset refresh, and Reddit-thumbnail polish. Tomorrow morning is
the launch.

The gap I almost shipped: **first-time visitors who already had an
account on another device had no path to sign in**. The first-time
landing surfaced the gradient `Scan a parking sign` CTA and nothing
else. Returning users see auth options in the home view's overflow
menu, but a first-time visitor on a new device — say, a returning
Mac user opening the iOS app fresh — had to *create a dummy session*
to discover the sign-in path. That's a fatal cross-device-recovery
gap. The fix was small: pass an `onSignInCta` prop from `App.tsx`
to `LandingFeatures` (only when `auth.configured && !auth.user`),
which renders a white-on-paper secondary button directly below the
gradient CTA. Reuses the existing `home.signInToSync` i18n key, so
no translation churn across 9 locales.

The first attempt at this fix put a small underlined link at the
bottom of the landing — *"Already have an account? Sign in."* User
feedback was decisive: *"I don't like where it's located. It's
genuinely hidden at the bottom of the screen. I think it should be a
button below 'Check a parking sign'."* Moved it. Second attempt
shipped. The dialogue mattered more than the diff: it pushed the
sign-in path from *findable-if-you-look* to *unmissable-on-arrival*.

The remaining work was a screenshot refresh (the demo grid now
reflects the secondary sign-in button) and a Reddit thumbnail tweak
— the original "ParkProof" wordmark on the carousel slide read too
small at Reddit feed size, so a brand-blue header strip with the
word in large Georgia Bold white got composited on top. Tiny edit,
proportionally large impact on first-impression brand recognition.

Then case-study tightening: ~260 words trimmed from 3,603 to 3,344
on seven targeted cuts — hedge sentences in the Problem section,
walk-back disclaimers, the "hiring PM would recognise" sentence that
read as fishing, a screenshot-pipeline hindsight bullet that didn't
earn its weight against the others, and a stack-summary section that
was 90% there but reading slightly verbose.

### DECISION · Sign-in CTA placement on the landing

```
Q: First-time visitors with no session see only the gradient
   "Scan a parking sign" CTA. Cross-device-recovery users
   (account exists, new device) have no path to sign in. Where
   does the sign-in button go?

           +-- A · Bottom-of-page text link
           |       ✗ Hidden below the fold on iPhone widths
           |       ✗ Reads as low-importance footer fine print
           |       ✗ User explicitly rejected this in review
           |
           +-- B · Top-right of the header, next to language picker
           |       ✗ Crowds the header in narrow viewports
           |       ✗ "Sign in" pattern is button-style, not
           |         icon-button-style — wouldn't read naturally
           |         in a 32px corner slot
           |
   Slot ---+
           |
           +-- C · Secondary button directly below scan CTA  ←  CHOSEN
                   • White-on-paper, smaller padding than gradient
                   • Renders ONLY when auth.configured && !auth.user
                     (returning users / signed-in users skip it)
                   • Reuses home.signInToSync i18n key across all
                     9 locales — no translation churn
                   ✓ Unmissable on arrival
                   ✓ Visual hierarchy preserved — gradient still
                     wins the eye
                   ✓ Two-line tap surface, mobile-thumb friendly
```

### Commits — Day 10 (3 commits so far)

```
23c49c8  fix(auth): expose sign-in path for first-time visitors
3083867  fix(auth): move sign-in CTA next to the primary scan button
cbc886a  docs: regenerate screenshots to reflect today's UI changes
```

(Plus uncommitted local edits to `docs/case-study.md` and the
Reddit-launch asset folder, both gitignored. Will commit before
bedtime.)

---

## What four extra days proved

**1 · The audit is the deliverable.** The single most valuable
session of these four days was the 5-hour Tier 1 pre-launch audit
on Sunday afternoon. Naming six things that *don't fail tests but
do fail on launch day*, then working the list, caught the PDF font
crisis that would have shipped a silent data-corruption bug to
~30% of supported users. The audit cost five hours; the upside is
not having to retract a Reddit post.

**2 · De-identification is its own feature.** Going from
*"functional product with my name on it"* to *"functional product
that could be anyone's"* took a focused half-day. Surfaces that
needed sweeping: About-page footer, privacy contact email, Apple
Sign-in consent screen, README/case-study LinkedIn references,
VAPID `mailto:` subject, source-code author tags. Most of these
are invisible until they're embarrassing. Worth doing once, on
purpose, in one pass.

**3 · Trust principles compound or compound-rot.** The reminder-
visibility gap on Day 9 was a small thing — *"I just told the app
to set 3 push reminders; where are they?"* — but it violated the
trust principle the rest of the product is built on (anonymous by
default, transparent about what's running, user is in control).
Fixing it was 2.5 hours. Not fixing it would have rotted the
trust principle by one notch, and the next gap would have rotted
it by another. These don't add linearly.

**4 · The right time to write the case study is before launch,
not after.** Day 10's case-study cuts were the last hour of focused
writing on the project — and surfaced things the build didn't.
Examples: I didn't explicitly name the *"no clean monetisation
path"* trade-off until I was forced to articulate it in writing.
Forcing prose discipline at the end of a build is a free pass
through every decision you made on autopilot.

---

*Total: 10 active build days · ~110+ commits · 9 locales · 18 API
routes · ~$5-7/month at portfolio traffic · zero real users at
publish time, by design.*

*Launch: Tuesday 26 May 2026, r/Melbourne, ~10am AEST.*
