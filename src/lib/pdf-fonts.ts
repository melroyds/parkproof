import type { jsPDF } from 'jspdf'

/**
 * PDF font loader for non-Latin scripts.
 *
 * Background: jsPDF's built-in fonts (helvetica, courier, times) are Adobe
 * Type 1 fonts whose glyph coverage is roughly Latin-1 Supplement + Latin
 * Extended A — fine for English, Italian, Indonesian, even passable for
 * basic Greek and Vietnamese WITHOUT diacritics. They have ZERO coverage
 * for Chinese / Korean / Devanagari (Hindi) / Gurmukhi (Punjabi) and only
 * partial coverage for Greek / Vietnamese with combining diacritics.
 *
 * Without a real Unicode font registered, jsPDF renders those characters
 * as missing-glyph rectangles ▯▯▯. Users in zh-CN / ko / hi / pa / vi / el
 * locales saw their evidence PDFs rendered as gibberish.
 *
 * Fix: lazy-fetch a per-locale Noto Sans TTF from the @fontsource CDN
 * (jsdelivr-hosted, Apache 2.0 licensed), register it with jsPDF on the
 * fly, and use it for the body text. Helvetica still handles the monospace
 * signature/verify blocks (those are pure ASCII anyway).
 *
 * Architecture notes:
 *  - **Module-scope cache** keyed by locale code. First export pays the
 *    fetch cost; subsequent ones are instant.
 *  - **In-flight deduplication** via `inflightLoads` so concurrent calls
 *    (e.g. user spam-clicks Export) don't fetch the same TTF twice.
 *  - **Synchronous registration** at PDF-generation time. Callers MUST
 *    `await prefetchPdfFont(locale)` before invoking the synchronous
 *    `downloadPdf` family — Safari's user-gesture rules forbid awaiting
 *    inside the click handler that triggers `doc.save()`. The PDF entry
 *    points handle this by accepting a locale + calling `registerPdfFonts`
 *    which reads from the already-warmed cache.
 *  - **Graceful fallback to helvetica** when the locale doesn't need a
 *    custom font (en, it, id) OR when the fetch failed (network blip,
 *    CDN outage). Failed-fetch case is logged + cached as "tried, no
 *    font" so we don't retry every export.
 *  - **Faux-bold via same regular file** registered under both 'normal'
 *    and 'bold' styles. Pure Noto Sans Bold variants would double the
 *    bandwidth — instead we lean on font-size hierarchy (22pt title vs
 *    10pt body) to carry visual structure. Acceptable trade for v1.
 */

type FontConfig = {
  /** Family name we register with jsPDF — referenced via `setFont(family, ...)`. */
  family: string
  /**
   * TTF URL on the @fontsource jsdelivr mirror. Each entry uses the script
   * subset matching the locale (Vietnamese / Greek / etc. are subsets of
   * the broader Noto Sans family, served as separate small files).
   */
  url: string
}

/**
 * Locale → font config. `null` means "no special font needed — helvetica
 * handles this locale's glyphs natively."
 *
 * Fonts are SELF-HOSTED from `public/fonts/` so they ship alongside the
 * app build to our own CloudFront. The original attempt to lazy-fetch
 * from a third-party CDN (jsdelivr / @fontsource) failed because:
 *   1. @fontsource v5 ships ONLY WOFF/WOFF2 (jsPDF needs TTF)
 *   2. v4 had TTF but the path scheme is unstable across versions
 *   3. Runtime CDN dependency means a third-party outage breaks PDF
 *      export for non-English users — unacceptable for evidence data
 *
 * Self-hosting trades a one-time build-time download (`npm run setup:fonts`,
 * or just commit the TTFs) for runtime resilience. The fonts are large
 * (especially CJK: SC 17MB, KR 10MB) but only loaded when the user actually
 * exports a PDF in that locale — so the cost is bounded and cached after
 * first hit.
 *
 * `import.meta.env.BASE_URL` resolves to '/app/' in production and '/' in
 * dev — matches the same pattern App.tsx uses for the hero image, keeps
 * paths working in both environments.
 *
 * Files are variable fonts (single TTF containing the full weight axis).
 * jsPDF treats them as static at their default instance, which is fine
 * for our regular-weight-only use case.
 *
 * Note: Vietnamese and Greek both use the same NotoSans.ttf — it includes
 * Latin Extended + Greek + Vietnamese diacritics + Cyrillic in one file.
 */
const FONT_BASE = `${import.meta.env.BASE_URL}fonts`

const FONT_CONFIGS: Record<string, FontConfig | null> = {
  en: null,
  it: null,
  id: null,
  'zh-CN': { family: 'NotoSansSC', url: `${FONT_BASE}/NotoSansSC.ttf` },
  ko: { family: 'NotoSansKR', url: `${FONT_BASE}/NotoSansKR.ttf` },
  vi: { family: 'NotoSans', url: `${FONT_BASE}/NotoSans.ttf` },
  el: { family: 'NotoSans', url: `${FONT_BASE}/NotoSans.ttf` },
  hi: { family: 'NotoSansDevanagari', url: `${FONT_BASE}/NotoSansDevanagari.ttf` },
  pa: { family: 'NotoSansGurmukhi', url: `${FONT_BASE}/NotoSansGurmukhi.ttf` },
}

/** Cache: locale → base64 TTF data (or `null` if no font needed / fetch failed). */
const fontCache = new Map<string, string | null>()

/** In-flight loads keyed by locale — prevents duplicate fetches. */
const inflightLoads = new Map<string, Promise<void>>()

/**
 * Normalize a raw i18next language code to one of our canonical 9 codes.
 * `i18n.resolvedLanguage` normally returns canonical thanks to the
 * `supportedLngs` setting, but defensive in case a future caller passes a
 * region code like 'zh-Hans-CN' or 'pt-BR'.
 */
function normalize(lng: string | undefined): string {
  if (!lng) return 'en'
  // Exact match on canonical codes first.
  if (lng in FONT_CONFIGS) return lng
  // Try a stripped base — e.g. 'zh' → 'zh-CN' (the only zh variant we
  // ship). Not generally correct (could resolve to zh-TW in another app)
  // but fine for ParkProof's locale set.
  const base = lng.split('-')[0].toLowerCase()
  if (base === 'zh') return 'zh-CN'
  if (base in FONT_CONFIGS) return base
  return 'en'
}

/**
 * Convert ArrayBuffer to base64. Avoids `String.fromCharCode(...)` apply
 * blow-up on large fonts by chunking in 8KB blocks. CJK fonts can be
 * 2-5MB; the naive single-call approach blows the JS stack on Safari.
 */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    )
  }
  return btoa(binary)
}

/**
 * Prefetch the font for the given locale into the module-scope cache.
 * Safe to call multiple times — concurrent calls dedupe via inflightLoads.
 * No-ops for locales that don't need a custom font.
 *
 * The PDF export flow calls this on component mount (alongside the
 * dynamic import of pdf.ts) so by the time the user clicks "Export PDF"
 * the font is warm and `registerPdfFonts` returns synchronously.
 */
export async function prefetchPdfFont(locale: string | undefined): Promise<void> {
  const canonical = normalize(locale)
  const config = FONT_CONFIGS[canonical] ?? null

  if (!config) {
    fontCache.set(canonical, null)
    return
  }

  if (fontCache.has(canonical)) return

  const existing = inflightLoads.get(canonical)
  if (existing) {
    await existing
    return
  }

  const load = (async () => {
    try {
      const res = await fetch(config.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      const b64 = arrayBufferToBase64(buf)
      fontCache.set(canonical, b64)
    } catch (err) {
      console.warn(`[pdf-fonts] could not load font for ${canonical}:`, err)
      // Cache the failure so we don't retry on every export. The user gets
      // helvetica fallback (= missing glyphs for non-Latin scripts), which
      // is the same state as before this whole feature shipped — degraded
      // gracefully rather than crashing the export.
      fontCache.set(canonical, null)
    } finally {
      inflightLoads.delete(canonical)
    }
  })()

  inflightLoads.set(canonical, load)
  await load
}

/**
 * Register the cached font with the given jsPDF document and return the
 * font family name the caller should pass to `setFont()`.
 *
 * Returns 'helvetica' (jsPDF's built-in default) when:
 *  - The locale doesn't need a custom font (en / it / id)
 *  - The prefetch was never called (programmer error — should warn)
 *  - The prefetch failed (graceful degradation — same as pre-fix behavior)
 *
 * Safe to call without awaiting. Always synchronous. Idempotent within a
 * single document — calling twice with the same locale just re-registers
 * the same font (no-op on jsPDF's side).
 */
export function registerPdfFonts(doc: jsPDF, locale: string | undefined): string {
  const canonical = normalize(locale)
  const config = FONT_CONFIGS[canonical] ?? null
  if (!config) return 'helvetica'

  if (!fontCache.has(canonical)) {
    // Caller forgot to prefetch. Warn but don't throw — the export still
    // produces a PDF, just with missing glyphs in the body. Loud-enough
    // signal during dev that this gets caught before shipping.
    console.warn(
      `[pdf-fonts] font for ${canonical} not prefetched. Call prefetchPdfFont() before downloadPdf()`,
    )
    return 'helvetica'
  }

  const base64 = fontCache.get(canonical)
  if (!base64) return 'helvetica' // Cached failure → helvetica fallback.

  const filename = `${config.family}.ttf`
  doc.addFileToVFS(filename, base64)
  // Register the same regular weight under both styles so callers can use
  // setFont(family, 'bold') without errors. Real Bold weight would mean a
  // second fetch — deferred. Visual hierarchy comes from font-size deltas.
  doc.addFont(filename, config.family, 'normal')
  doc.addFont(filename, config.family, 'bold')
  // Italic too — Noto Sans CJK has no real italic, so we'd faux-slant in
  // helvetica's case. Here we just use regular and accept the loss.
  doc.addFont(filename, config.family, 'italic')

  return config.family
}
