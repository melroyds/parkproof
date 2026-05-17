# ParkProof — Asset Generation Brief

> **📜 Historical artefact.** This brief was written under the original **"Melbourne Civic"** brand direction (tram-green / terracotta / cream / Fraunces serif slab-frame). The final shipped brand went in a different direction — see [`public/parkproof-icon.svg`](../public/parkproof-icon.svg) and friends for the **layered-P + alarm-clock monogram** in blue / navy / teal that's actually live. Kept here as a record of the design process. If you're generating *new* assets today, treat the colours and motif as out-of-date; use this only as a structural template (filenames, dimensions, prompt-shape).

A copy-pasteable brief for generating polished assets in Midjourney, DALL-E, Imagen, a designer, etc. Bring the files back into `public/` with the filenames below and I'll wire them in.

---

## Brand identity recap

**Name:** ParkProof
**Tagline:** "Melbourne parking, decoded — with photo evidence in case of a wrongful ticket."
**Direction:** Melbourne Civic — locally rooted, civic-leaning, slab-serif character. The kind of design the City of Melbourne would credibly ship.

### Palette (use these exact hexes)

| Token | Hex | Use |
|---|---|---|
| Tram green (primary) | `#0F7B5E` | Logos, primary CTAs, brand outlines |
| Brand green (deep) | `#0A5A45` | Hover states, gradients |
| Terracotta brick (accent) | `#C0573A` | Secondary CTAs, warning highlights |
| Ochre highlight | `#E8B743` | Verification cards, gold accents |
| Cream paper (background) | `#F5F0E6` | Main background — warm off-white, NOT pure white |
| Cream paper-50 (light surface) | `#FAF7F0` | Lighter cream for layered surfaces |
| Espresso (text) | `#1F1B16` | Body text, near-black with warmth |
| Espresso muted | `#5C4E40` | Secondary text |

### Typography

- **Display / headings:** [Fraunces](https://fonts.google.com/specimen/Fraunces) (Google Fonts) — slab-leaning serif, weights 700/800, slight optical sizing. Used for the wordmark and all H1/H2/H3.
- **Body:** [Inter](https://fonts.google.com/specimen/Inter), 400/500/600/700.

### Tone / mood words

Warm, locally rooted, civic, slightly retro signage, opinionated, calm, evidence-grade. NOT corporate, NOT generic SaaS, NOT cute.

### Avoid

- Pure white backgrounds (always cream `#F5F0E6`)
- Generic blue/purple AI-look gradients
- Glossy 3D renders
- Inter for headings (Fraunces only for display)
- Excessive shadows or neon effects

---

## Tier 1 — biggest visual wins

### 1. Refined logo (3 variants)

**1a. Square icon** — `public/parkproof-icon.svg`
- **Spec:** SVG, 512×512 viewBox, square, must read at 16×16.
- **Current state:** Rounded cream square containing a tram-green sign-frame (white interior, ~28px stroke), bold serif "P" centred inside, downward chevron beneath the P. Mine is functional but a designer pass would tighten proportions, letterform balance, chevron weight.
- **Where used:** PWA install icon (all sizes auto-generated from this), favicon, inline brand mark in app header and loading screen, social previews.
- **Prompt:**
  > Square app icon, 512×512 viewBox, vector SVG. Cream rounded-square background (`#F5F0E6`, 96px corner radius). Inside, a centred parking-sign frame — white interior, tram-green stroke (`#0F7B5E`, ~28px wide), 40px corner radius, 360×360 box centred. Inside the sign: a bold serif capital P (slab-leaning, weight 800, dark tram-green fill `#0F7B5E`) taking the upper two-thirds. Below the P, still inside the sign frame, a small downward chevron in the same tram green, 24px stroke weight, rounded line caps. Civic, calm, evidence-grade. No gradients, no glow, no extra ornament. Must remain legible at 32×32.

**1b. Horizontal wordmark** — `public/parkproof-wordmark.svg`
- **Spec:** SVG, ~800×200 viewBox, transparent background.
- **Where used:** README header, future marketing pages, OG image.
- **Prompt:**
  > Horizontal logo lockup, vector SVG, ~800×200 viewBox, transparent background. On the left: the ParkProof square icon (sign-frame with serif P + chevron, tram-green and cream — see icon spec). On the right, vertically centred and properly optically aligned: the word "ParkProof" set in Fraunces weight 800, espresso colour `#1F1B16`, slight letter-tracking tightening (-1.5%). Generous whitespace between the icon and the wordmark (one icon-width's gap). The icon should appear ~30% smaller than the cap-height of the wordmark feels visually balanced — adjust until it looks right.

**1c. Monochrome variant** — `public/parkproof-icon-mono.svg`
- **Spec:** SVG, 512×512 viewBox, single colour.
- **Where used:** Dark backgrounds, print, embossing, anywhere two-colour reproduction isn't possible.
- **Prompt:**
  > Single-colour SVG of the ParkProof sign-frame icon (sign frame + serif P + downward chevron), 512×512 viewBox, no fill on the sign interior, espresso colour `#1F1B16` throughout (suitable for inversion to white on dark surfaces). No rounded background tile — transparent. Slightly heavier strokes than the colour variant (~32px) so it reads as a unified mark in one weight.

### 2. Open Graph share card — `public/og-image.png`

- **Spec:** PNG, 1200×630 pixels, sRGB.
- **Where used:** Auto-displayed when someone shares the CloudFront URL on iMessage, WhatsApp, Slack, LinkedIn, Twitter, Discord. **The single most-seen surface for a portfolio link.**
- **Prompt:**
  > Open Graph social card, 1200×630 pixels, cream background (`#F5F0E6`) with a very subtle paper texture. Left third: the ParkProof horizontal wordmark (icon + serif "ParkProof"), large, vertically centred. Centre/right: the tagline "Melbourne parking, decoded" set in Fraunces weight 800, espresso colour, ~64pt, two lines, generous line-height. Below the tagline in smaller Inter 500 (~24pt) espresso-muted: "Photograph a sign, get a plain-English answer, save evidence in case of a wrongful ticket." Bottom-right corner: a small terracotta-coloured pill saying "→ parkproof.dsouza.tech" or your final URL. Optional decorative element: a faded silhouette of a Melbourne parking sign (rectangular, with arrows) at very low opacity in the background. Warm, civic, editorial.

### 3. Hero illustration — `public/hero-illustration.svg`

- **Spec:** SVG, max 400×300 viewBox, transparent background.
- **Where used:** Sits behind / above the BrandMark in the home-screen hero. Adds atmospheric depth.
- **Prompt:**
  > Editorial line illustration, SVG, ~400×300, transparent background. A spare Melbourne laneway scene: a single tall parking sign pole (with a stylized sign at the top), maybe a hint of tram cables across the upper portion, and the silhouetted back-half of one parked car. Two-tone: tram-green (`#0F7B5E`) line strokes on what would be the foreground, terracotta (`#C0573A`) very-light fills or accents on the sign and car. NO faces, NO realistic detail, NO photographic style. Loose, gestural strokes — think New Yorker cartoon meets civic infographic. Heavy whitespace. Should feel quiet and contemplative, not busy. 2px stroke weight, rounded line caps.

---

## Tier 2 — high polish, lower effort

### 4. Custom icon set (8 icons replacing emoji)

- **Spec:** 8 individual SVGs, 24×24 viewBox, 2px stroke weight, rounded line caps and joins, transparent background, single-colour (will be tinted via CSS `currentColor`).
- **Where used:** Throughout the app — replacing 📷 🖼️ 📅 🔔 📋 ⚠︎ ✓ ✗ emojis.
- **Filenames:** `public/icons/camera.svg`, `gallery.svg`, `calendar.svg`, `bell.svg`, `list.svg`, `pin.svg`, `check.svg`, `warning.svg`.
- **Prompt (per icon, replace `{NOUN}`):**
  > Single-colour stroke icon, 24×24 viewBox, 2px line weight, rounded caps and joins, transparent background, vector SVG. The icon depicts a {NOUN}. Civic / utilitarian style — think Lucide or Phosphor. NO fills (outline only), NO gradients, NO shadows. The stroke should be the only visual element. Use `currentColor` so it inherits the parent's CSS colour.
- **Free alternative:** Install `lucide-react` and skip this. Their icons fit the brand perfectly and will save you 2-3 hours.

### 5. iOS PWA splash screen — `public/parkproof-splash.svg`

- **Spec:** SVG, 1290×2796 viewBox (iPhone 15 Pro Max portrait ratio). The `pwa-assets-generator` will rasterize this into all required Apple device sizes.
- **Where used:** The half-second loading screen shown by iOS when someone launches ParkProof from their Home Screen.
- **Prompt:**
  > Portrait splash screen, SVG, 1290×2796 viewBox. Cream background (`#F5F0E6`). The ParkProof square icon (sign-frame + P + chevron) centred horizontally and vertically, sized at ~30% of canvas width. Below the icon (with ~120px gap): the word "ParkProof" set in Fraunces weight 800, espresso colour, ~96pt, centred. No tagline, no decoration. Calm, deliberate emptiness. Optional: a single thin terracotta hairline across the very bottom, 20% from the bottom edge, as a subtle visual anchor.

### 6. Empty-state illustration — `public/empty-history.svg`

- **Spec:** SVG, 300×200 viewBox, transparent background.
- **Where used:** Session History screen when there are no saved sessions yet.
- **Prompt:**
  > Line illustration, SVG, 300×200, transparent background. A single empty parking bay seen from above — just the painted bay outline (white rectangle inside dotted-line markings) on a hint of asphalt-grey ground (`#D9CCB0` very light). NO car, NO sign, NO text. Two tram-green chevrons painted on the bay surface, suggesting "park here", but the bay is empty. The illustration should feel inviting (waiting for you) rather than sad. Loose, gestural strokes matching the hero illustration style.

---

## Tier 3 — nice to have

### 7. Paper texture — `public/paper-texture.png`

- **Spec:** PNG, 512×512 seamless tile, very low contrast (visible only at ~5% opacity), grayscale.
- **Where used:** Layered over `bg-paper-100` as a CSS `background-image` with very low opacity to add subtle tactility.
- **Prompt:**
  > Seamless tileable paper texture, 512×512 PNG, grayscale, very low contrast. Subtle fiber grain like aged sign paint or kraft paper. Designed to be overlaid at ~5% opacity over a solid colour — so very gentle, no strong dark marks, no obvious features that would betray the seam. Think the texture you'd see on a Penguin Classics book cover up close.

### 8. Favicon ICO — `public/favicon.ico`

- **Spec:** Multi-resolution ICO containing 16×16, 32×32, 48×48 versions of the refined logo.
- **Where used:** Browser tabs (especially on older browsers that don't pick up the SVG favicon), Windows taskbar pinning.
- **How to generate:** Most logo designers will export this on request. Or use [realfavicongenerator.net](https://realfavicongenerator.net/) to convert from your `parkproof-icon.svg`.

---

## Tier 4 — for when you submit somewhere serious

### 9. Marketing screenshots / device mockups

- **Spec:** PNG, varies — typically 1284×2778 (App Store iPhone) or 1242×2208 (LinkedIn post 9:16).
- **Where used:** Your portfolio post, LinkedIn announcement, README hero, possible App Store submission.
- **Process:** Take real iPhone screenshots of the app first (Safari → device toolbar → iPhone 15 Pro). Drop them into a Figma community template like "iPhone 15 Pro Mockup" or "Frame X". Add cream background + tagline + one terracotta accent. Six panels showing scan → clarify → result → log → reminder → history covers the full story.

### 10. Demo screencast — `docs/demo.mp4` or `docs/demo.gif`

- **Spec:** ~15–30 seconds, 1080×1920 portrait, MP4 (or compressed GIF if you want it in the README).
- **Where used:** Top of the README, your portfolio site, LinkedIn post. **Single biggest credibility multiplier** for a portfolio piece.
- **Process:** Use iPhone's built-in screen recording (Settings → Control Center → Add "Screen Recording"). Record yourself doing the full flow with a real Melbourne sign. Trim in iOS Photos or QuickTime. Export.

---

## When the assets are ready

Drop files into `public/` (icons in `public/icons/`) and tell me which filenames changed. For each I'll:
- Replace the file in the repo
- If it's a logo change, re-run `npx pwa-assets-generator --override` to regenerate all PWA sizes
- Wire it into the right component(s) — add `<meta og:image>` for the share card, swap emoji for `<Icon>` components, add the hero illustration behind the BrandMark, etc.
- Redeploy with `bash scripts/deploy.sh`

That's it. Have fun generating.
