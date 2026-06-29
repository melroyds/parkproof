# Greenfield / Verified Pine — ParkProof visual theme

The chosen direction for the July 2026 redesign. The one idea behind it: **pine
green is the brand, "verified", and "go" all at once.** The product's whole
promise (can I park = go, and your evidence is verified) and the brand colour
become the same fact. It is cool, dark, and instrument-like, the deliberate
opposite of generic civic-tech blue and of a warm-calm to-do app.

## Files

- [`theme.css`](theme.css) — the Tailwind v4 `@theme` token block. Drop-in for the brand/ink/paper/accent tokens in `src/index.css`.
- [`preview.html`](preview.html) — a standalone, runnable prototype (home, verdict, payment, and the dark evidence "vault"). Open it directly in a browser; no build step.

## Palette

| Role | Hex | Where it goes |
|---|---|---|
| Brand / verified / go | `#0E5C3A` | Header, primary buttons, the seal, the "you can park" verdict. One colour, three meanings. |
| Vault (brand deep) | `#073B25` | Dark evidence panels and the signed PDF ground. Reads almost black-green, feels like a vault. |
| Ink | `#0B1A14` | Body text (14:1+ on paper). |
| Paper | `#F4F7F5` | App background. A green-tinted cool grey (hue ~150°), **never** warm cream. |
| Surface | `#FFFFFF` | Cards. |
| Mint spark | `#7BE3A4` | RARE. A 1px highlight on the seal glow and active-tap only. Never a fill, never a background. |
| Stop | `#C0392B` | Quarantined. Only on the answer card when you cannot park. |

The go/stop semantic green **is** the brand pine. Stop red appears nowhere except the verdict card.

## Typography

- **Display: Space Grotesk (600/700)** — Latin-only moments: the wordmark, the verdict line, big numerals. Its surveyed, engineered character reads "instrument", not "brand consultancy".
- **Body: Inter (400/500/600)** with the Noto fallback chain (`Noto Sans SC`, `Noto Sans KR`, `Noto Sans Devanagari`, `Noto Sans`) so all 9 locales render at one weight and rhythm.
- **Rule that matters:** the display face never touches non-Latin views. This is the exact fix for why Fraunces failed (it had no CJK/Devanagari sibling, so display text broke across zh/ko/hi/pa/el). Keep Space Grotesk on Latin hero/verdict strings only.
- Tabular figures (`font-variant-numeric: tabular-nums`) on every countdown and timestamp, so the numbers feel measured.

## Shape and texture

- **Cards 8px radius**, hairline 1px pine borders instead of heavy shadows.
- **Observation chips are square-ish (3px)** so sign rules read like ticket fields.
- **The verdict answer card is the one fully-rounded (16px), high-contrast object** — it should feel more emphatic than everything around it.
- **The signed-evidence record** gets a notched / perforated certificate edge.
- **Background:** cool paper with a barely-visible engine-turned (banknote guilloché) line texture in pine at ~3%. Invisible in bright sun so legibility is never harmed, reads as "official document" up close. Dark evidence surfaces flip to vault green with the same texture at ~8%.

## The Verified Seal (the hero object)

A circular pine stamp with a guilloché rim and the KMS signature's short
fingerprint engraved around it. It turns the invisible backend feature (KMS
ECDSA signing) into the product's central visual object, and it appears in three
places:

1. **In-app**, pressing onto a session the moment it becomes tamper-evident.
2. **Embossed** at the top of the exported evidence PDF.
3. As the **app icon / favicon** mark.

The rim text is the actual signature hash, so the trust claim is literal, not decorative.

## Motion

Restrained throughout (120–180ms opacity/translate). The single hero moment is
the seal pressing onto a freshly-signed record: a 250ms scale-down-and-press,
one outward mint ring pulse that fades, then the perforated edge draws across to
"commit" it. Countdown digits tick with no animation, calm under roadside
pressure. `prefers-reduced-motion` shows the seal already stamped.

## Do / don't

The failure mode is drifting into herbal / wellness / eco green.

- **Keep** the green dark and saturated (`#0E5C3A` and below, never above ~45% lightness).
- **Keep** mint a rare 1px spark.
- **Keep** sharp certificate geometry (stamps, notches, banknote lines).
- **Avoid** soft sage, mint washes, rounded organic blobs, leaf motifs. If it starts to feel like a meditation or plant-care app, the green has gone too light and the shapes too round. Pull back to vault, stamp, and banknote.

## Applying it to the codebase

1. Replace the `@theme` colour + font tokens in `src/index.css` with [`theme.css`](theme.css) (the existing components already consume `brand-*` / `ink-*` / `paper-*` / `accent-*`, so most of the cascade follows for free).
2. Swap the heading font from Fraunces to Space Grotesk, and confine it to Latin display strings (wordmark, verdict, numerals). Leave Inter + Noto on everything localised.
3. Retire the `cavalcade` background pattern for the guilloché texture (`body` rule in `theme.css`).
4. Build the Verified Seal as a component (animated in-app, embossed in `src/lib/pdf.ts`, exported as the icon).
5. Re-run the manual e2e suite ([`../../docs/qa/e2e-test-suite.md`](../../docs/qa/e2e-test-suite.md)) once components are migrated; the visual redesign touches every screen.

Contact stays `hello@parkproof.com.au`.
