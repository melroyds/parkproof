# ParkProof design review (code-level, 8 lenses)

_Each lens was audited against the code, then every finding re-checked against the code by a second pass. The verify pass demoted several "splinter" findings as intentional (noted at the end), so what's below is the surviving, confirmed set._

## The read

This is a more disciplined design system than most solo builds, and the audit should say so plainly. Four of the eight lenses came back genuinely healthy: the **type scale** is coherent (one heading voice, `font-display` + `extrabold` + `tracking-tight`, applied across 15+ screens), **spacing rhythm** is tight (every screen shares `min-h-screen flex flex-col p-6 max-w-md mx-auto w-full`, zero arbitrary bracket spacing), **motion** is restrained and correctly gated behind a load-bearing `prefers-reduced-motion` block (index.css:105-114), and **responsive** is solid (every view caps at `max-w-md`, images use `object-contain max-h`).

The real story is concentrated in three places, and it's the same story each time: **there is no shared component layer.** Every button, card, input, back-button, and alert is hand-written inline in each file, so they've drifted, and a handful of token-level bugs are silently riding along inside those duplicated primitives. Fix the primitives and the tokens, and most of the scattered contrast/spacing/disabled-state findings dissolve because they don't have 25 separate homes anymore, they have one.

So this isn't a "the design is messy" review. It's a "the design is good but it's copy-pasted, and copy-paste rots" review.

## The 3 highest-leverage moves

**1. Extract a shared primitive layer (`Button`, `Card`, `BackButton`, `Input`, `Alert`).** This is the single biggest lever in the codebase. It collapses ~80 duplicated sites, and because the drift lives in those copies, it simultaneously fixes: the inconsistent disabled-button contrast (3 ad-hoc recipes → 1), the ~6 back-buttons that fail the 44px touch target the a11y commit was meant to close, the `p-4`/`p-5` + `mb-3/4/6` card drift, and it gives the focus ring and disabled state exactly one place to live. Duplication, spacing, half the a11y findings, and a chunk of the colour findings all drain into this one move.

**2. Three `index.css` fixes, about 12 lines, that dissolve ~45 sites.** (a) Define `--color-ink-400` — it's used in 8 places but doesn't exist, so those elements silently render full navy instead of muted grey (live defect, below). (b) Add a global `:focus-visible` ring — there is none, so every button and link across 25 components falls back to the browser default outline. (c) Add a `text-2xs` token for the 12 arbitrary `text-[10px]/[11px]` micro-labels.

**3. Settle the purple question (one decision).** The in-app primary CTA is a blue→purple gradient; the marketing landing's primary CTA is all-blue; and `purple-500/600` is an off-token colour declared nowhere in `@theme`. One decision (keep purple and tokenise it, or drop it for the brand blue) aligns the primary CTA across all 15 in-app uses *and* the landing *and* the step badges. It's the biggest cross-surface brand divergence, and the shared `<Button>` from move #1 is where the answer gets baked in.

---

# Burn-down (stack-ranked)

## Tier 1 — Live defects (wrong on screen right now)

| # | Defect | file:line | Fix |
|---|---|---|---|
| 1 | **`text-ink-400` is an undefined token.** The `ink` ramp in `@theme` is only 500-900 (index.css:15-19), so `text-ink-400` generates no class and the element inherits navy. The damaging cases: disabled/"past" reminder chips render in full-strength navy (so a *disabled* chip reads as *active*), and form placeholders render as near-real text. | `src/index.css:14` (the gap); ReminderOptions.tsx:428, ScheduledRemindersSection.tsx:446, FeedbackModal.tsx:227/254, InstallPromptBanner.tsx:166, SessionHistory.tsx:90, LandingFeatures.tsx:218/240 | Add `--color-ink-400: #8A93AB;` to the `@theme` ink block. One line, all 8 sites. |
| 2 | **`font-display font-semibold` requests Fraunces 600, which the app never loads** (only 700/800 are loaded). The result-card heading renders a synthesized faux-weight or the serif fallback. | ParkingResult.tsx:258 | Change to `font-bold` (700) or `font-extrabold` (800). |
| 3 | **`disabled:bg-none` on the gradient CTA strips the background with no fallback.** When disabled, the button renders white text on the bare sage page, effectively invisible. | ParkingResult.tsx:570 | Give it a disabled background (the standard disabled recipe from move #1). |

## Tier 2 — High-leverage tokens & components

**2A. The shared primitive layer (move #1).** In rough priority:

| Primitive | Duplication | Drift it fixes | Anchor |
|---|---|---|---|
| `<Button variant>` | gradient CTA ×15, flat brand ×13, 3 disabled recipes | radius/shadow/transition-property drift; the unreadable `brand-200/white-70` disabled state (~1.5:1) | AuthFlow.tsx:292/325 |
| `<BackButton>` | 15+ hand-written | ~6 fail the 44px touch target | SignScanner.tsx:275 |
| `<Card>` | `bg-white rounded-2xl border border-paper-300 p-5` ×25+ | the `p-4`/`p-5` and `mb-3/4/6` splinter | SessionDetail.tsx:292 |
| `<Input>` | ×10 | two divergent focus-ring conventions | AuthFlow.tsx:267 |
| `<Alert variant>` | ×6 (info/warn/error) | a mis-coloured AuthFlow error box | AuthFlow.tsx:212 |
| `<UploadTile>`, `<Dialog>` shell | ×8 / ×1 | pre-empts the next copy-paste | SignScanner.tsx:366, FeedbackModal.tsx:161 |

**2B. Global `:focus-visible` ring** — none exists in `index.css`; add one rule (`:focus-visible { outline: 2px solid var(--color-brand-500); outline-offset: 2px; border-radius: inherit; }` or a ring utility) to cover all 25 interactive components. `src/index.css`.

**2C. `--color-ink-400` token** — same fix as Tier-1 #1; listed here too because it's definitionally high-leverage (one token, 8 sites).

**2D. Secondary-caption contrast** — `ink-500` (#5C6680) small text on the sage body (#C8DCCF) computes ~4.0:1, under the 4.5:1 AA floor for 12px text. Bump the caption/label role to `ink-600` (#404B66, ~6.3:1 on sage; the token already exists). Verify-pass rates this **partial** (only bites where a card doesn't fully cover the sage), but the one-step bump clears it durably across ~30 sites. ParkingResult.tsx:273 + uppercase labels across a dozen components.

**2E. Micro-text token** — 12 arbitrary `text-[10px]/[11px]` literals → one `--text-2xs`. AuthSettings.tsx:120/323, ActiveSessionCard.tsx:153/162, LoadingProgress.tsx:46, ReuseCard.tsx:28, SessionDetail.tsx:255/440, SessionLogger.tsx:379, LandingFeatures.tsx:188/204/211.

**2F. One disabled-button recipe** — collapse `brand-300/white`, `brand-200/white-70`, `paper-300/ink-500` into one legible default; bake into `<Button>`. The `brand-200/white-70` one is unreadable. ReminderOptions.tsx:492/748.

**2G. Purple decision (move #3)** — `purple-500/600` is undeclared; app CTA blue→purple vs landing all-blue. LandingFeatures.tsx:64/136. Resolve, then bake into `<Button>`.

## Tier 3 — Polish

- **amber permit "P" badge**: white on `amber-500` (~1.9:1) for a meaningful glyph → `amber-700` (~4.9:1, matches the warning surfaces). ParkingResult.tsx:452. (Mitigated today by the redundant text label, so not colour-only-locked.)
- **AppealFlow error CTA** uses `py-3` where every other primary CTA is `py-4/5`. AppealFlow.tsx:126.
- **`font-light` single use** — the only sub-400 weight in the app; remove. LandingFeatures.tsx:218.
- **Eyebrow/label tracking** hand-tuned per instance → bind to the label token. LoadingProgress.tsx:46, ActiveSessionCard.tsx:153/162, ReuseCard.tsx:28.
- **Banner overflow guard** — `whitespace-nowrap` inside a viewport-capped pill with no fallback. SwUpdateBanner.tsx:99-117, InstallPromptBanner.tsx.
- **GPS coords + address** share one line with a `whitespace-nowrap` coord span. SessionLogger.tsx:362-368.
- **Marketing landing has zero `:focus` styles** — add two rules covering nav links + CTAs. landing-styles.css:221-232.
- **Cross-surface nits**: verdict green `emerald-700/800` (app) vs `#10B981` (landing) (ParkingResult.tsx:240); `font-mono` system vs JetBrains Mono on the session-ID treatment (SessionDetail.tsx:255).
- **Dead code**: stale comment in index.css:96 (references a removed SW-banner pulse); unused Vite-scaffold transitions in App.css:8/128.
- **Verdict card has no entrance animation** — the app's most important moment just pops in. Verify rates this **partial** (restraint is defensible); optional 150ms fade/rise. ParkingResult.tsx:237-267.

## Tier 4 — Judgment calls

- **No dark mode.** Defensible scope for a portfolio PWA, but a hiring PM on a dark phone sees an unflinching bright sage theme (and ParkProof's use case is literally a dark car park). The 80/20, if you want it: a `@media (prefers-color-scheme: dark)` block that darkens *only* the body background behind the cards (most components already use white text on saturated surfaces that survive). Not a full token ramp. index.css.
- **Landing hardcodes hex** — fine; it's a standalone hand-written file, on-brand. No fix.
- **Headline accent** styled italic-blue in-app vs upright-blue-block on the landing. LandingFeatures.tsx:99. Cosmetic cross-surface choice.
- **Transition durations unspecified** (rely on Tailwind's 150ms default) + 3 one-off property scopes. Mild; a `--ease`/`--dur` token would formalise it.

---

## Dropped by the verify pass (recorded so they don't come back)

- **"Screen titles splinter text-3xl vs text-2xl"** — overcorrection. The `text-2xl` on AppealFlow step headers and the FeedbackModal title are deliberately a smaller tier than the `text-3xl` screen-header norm. Not drift.
- **Most of the "card-section margin splinter" (`mb-3/4/6`) and the "card-to-CTA gap"** — overcorrection. The finder swept in the deliberate pattern it was recommending; the genuine part (the `p-4`/`p-5` card-padding split) survives inside the `<Card>` move (2A).

## Suggested execution order

Tier 1 (3 quick fixes, ~10 minutes, clears the live defects) → 2A `<Button>` + `<Card>` + `<BackButton>` first (they carry the most drift and the most a11y debt) → 2B/2C/2D/2E/2F (the `index.css` token + contrast pass) → 2G purple decision → Tier 3 polish → Tier 4 only if you want them. The first two tiers are ~90% of the value.
