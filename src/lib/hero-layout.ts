// The landing hero's card (src/components/HeroAnswer.tsx): where its three
// translated lines sit, how much room each has, and the sizes that keep a
// translation inside that room (src/lib/svg-text-fit.ts).
import { estimateTextWidth, fitFontSize } from './svg-text-fit'

/**
 * The time in the card's pill and its description, written the way the app
 * writes every clock time (en-AU, time-format.ts), whatever the language.
 */
export const HERO_TIME = '4:00 pm'

/**
 * The card's three lines: where each starts, its design size, and the room
 * it has before the card's edge (the kicker and the headline) or the seal
 * (the pill, which grows with its text up to `maxWidth`).
 */
export const HERO_TEXT = {
  kicker: { x: 218, base: 11, narrowEm: 0.6, letterSpacing: 1.5, maxWidth: 200 },
  headline: { x: 218, base: 26, narrowEm: 0.6, letterSpacing: -0.5, maxWidth: 222 },
  pill: { x: 218, padding: 16, minWidth: 150, maxWidth: 176, base: 15, narrowEm: 0.56, letterSpacing: 0 },
} as const

/**
 * Scripts without letter case, where the design's tracking doesn't belong:
 * Devanagari and Gurmukhi (hi, pa), whose letters join along the headline
 * stroke, which any letter-spacing breaks into pieces (and negative spacing
 * overlaps), and Han and Hangul (zh-CN, ko), which are set solid.
 */
const UNTRACKED_SCRIPT = /[\p{Script=Devanagari}\p{Script=Gurmukhi}\p{Script=Han}\p{Script=Hangul}]/u

/**
 * The letter-spacing a line of the card is drawn with: the design's own for
 * Latin, Greek and Vietnamese, 0 when the text is in a script listed in
 * UNTRACKED_SCRIPT. The size fit uses the same value, so a line still fits.
 */
export function heroLetterSpacing(line: 'kicker' | 'headline', text: string): number {
  return UNTRACKED_SCRIPT.test(text) ? 0 : HERO_TEXT[line].letterSpacing
}

/** The kicker's font size for its translated text. */
export function heroKickerSize(text: string): number {
  return fitFontSize(text, { ...HERO_TEXT.kicker, letterSpacing: heroLetterSpacing('kicker', text) })
}

/** The headline's font size for its translated text. */
export function heroHeadlineSize(text: string): number {
  return fitFontSize(text, { ...HERO_TEXT.headline, letterSpacing: heroLetterSpacing('headline', text) })
}

/** The pill's text size and the pill's width for a translated "Until 4:00 pm". */
export function heroPill(text: string): { fontSize: number; width: number } {
  const p = HERO_TEXT.pill
  const fontSize = fitFontSize(text, {
    base: p.base,
    maxWidth: p.maxWidth - 2 * p.padding,
    narrowEm: p.narrowEm,
    letterSpacing: p.letterSpacing,
  })
  const textWidth = estimateTextWidth(text, fontSize, p.narrowEm, p.letterSpacing)
  return { fontSize, width: Math.min(p.maxWidth, Math.max(p.minWidth, Math.ceil(textWidth + 2 * p.padding))) }
}
