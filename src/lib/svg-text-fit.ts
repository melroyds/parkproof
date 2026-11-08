// SVG text doesn't wrap or shrink to fit its box, so a translated label in
// a fixed illustration (the landing hero, HeroAnswer.tsx) can run past its
// card. These helpers estimate a string's width from its characters and
// pick a font size that keeps it inside a given width. The estimate is
// deliberately generous (wide scripts count as a full em), so a string it
// says fits does fit in the fonts the app loads and their fallbacks.

/** Han, kana, Hangul, CJK punctuation and full-width forms: about one em each. */
const WIDE = /[ᄀ-ᇿ⺀-鿿ꥠ-꥿가-퟿豈-﫿︰-﹏＀-｠￠-￦]/u
/** Devanagari and Gurmukhi letters, a little wider than Latin ones. */
const INDIC = /[ऀ-ॿ਀-੿]/u
/** Marks drawn on the letter before them (Devanagari matras below, Vietnamese tones on decomposed text). */
const NONSPACING = /\p{Mn}/u
/** Marks that take room of their own (most Devanagari and Gurmukhi vowel signs). */
const SPACING_MARK = /\p{Mc}/u

/**
 * The width of `text` in ems at a font whose ordinary letters are
 * `narrowEm` wide (about 0.6 for Space Grotesk bold and IBM Plex Mono,
 * 0.56 for Inter semibold).
 */
export function estimateTextEm(text: string, narrowEm: number): number {
  let em = 0
  for (const ch of text) {
    if (NONSPACING.test(ch)) continue
    if (SPACING_MARK.test(ch)) em += 0.35
    else if (ch === ' ') em += 0.3
    else if (WIDE.test(ch)) em += 1
    else if (INDIC.test(ch)) em += 0.7
    else em += narrowEm
  }
  return em
}

export interface FitOptions {
  /** The design's font size, used whenever the text fits at it. */
  base: number
  /** The room the text has, in user units. */
  maxWidth: number
  /** See estimateTextEm. */
  narrowEm: number
  /** The text element's letter-spacing, added between characters. */
  letterSpacing?: number
  /** Never smaller than this. */
  min?: number
}

/** How many characters `text` draws (combining marks don't add a letter-space). */
function drawnCharacters(text: string): number {
  let n = 0
  for (const ch of text) if (!NONSPACING.test(ch)) n++
  return n
}

/** The estimated drawn width of `text` at `fontSize`. */
export function estimateTextWidth(text: string, fontSize: number, narrowEm: number, letterSpacing = 0): number {
  const gaps = Math.max(0, drawnCharacters(text) - 1)
  return estimateTextEm(text, narrowEm) * fontSize + gaps * letterSpacing
}

/**
 * The font size at which `text` fits `maxWidth`: `base` when it already
 * fits there, otherwise the largest size that fits (rounded down to a
 * tenth), never below `min` (default 9).
 */
export function fitFontSize(text: string, { base, maxWidth, narrowEm, letterSpacing = 0, min = 9 }: FitOptions): number {
  if (estimateTextWidth(text, base, narrowEm, letterSpacing) <= maxWidth) return base
  const em = estimateTextEm(text, narrowEm)
  if (em <= 0) return base
  const gaps = Math.max(0, drawnCharacters(text) - 1)
  const size = Math.floor(((maxWidth - gaps * letterSpacing) / em) * 10) / 10
  return Math.max(min, Math.min(base, size))
}
