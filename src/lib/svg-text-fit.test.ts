// @vitest-environment node
//
// Fitting translated text into a fixed SVG box (src/lib/svg-text-fit.ts).
import { describe, expect, it } from 'vitest'
import { estimateTextEm, estimateTextWidth, fitFontSize } from './svg-text-fit'

describe('estimateTextEm', () => {
  it('counts Latin and Greek letters at the font\'s letter width and spaces narrower', () => {
    expect(estimateTextEm('abc', 0.6)).toBeCloseTo(1.8)
    expect(estimateTextEm('a b', 0.5)).toBeCloseTo(1.3)
    expect(estimateTextEm('Μπορείς', 0.6)).toBeCloseTo(7 * 0.6)
  })

  it('counts Chinese and Korean characters as a full em', () => {
    expect(estimateTextEm('可以停车', 0.6)).toBe(4)
    expect(estimateTextEm('주차 가능', 0.6)).toBeCloseTo(4.3)
  })

  it('counts Devanagari and Gurmukhi letters wider, their vowel signs narrower, and marks over a letter as nothing', () => {
    // क (letter), ि (spacing vowel sign), ं (nonspacing mark)
    expect(estimateTextEm('कि', 0.6)).toBeCloseTo(0.7 + 0.35)
    expect(estimateTextEm('कं', 0.6)).toBeCloseTo(0.7)
    expect(estimateTextEm('ਪ', 0.6)).toBeCloseTo(0.7)
  })

  it('treats decomposed accents as part of their letter', () => {
    const decomposed = 'é' // e + combining acute
    expect(estimateTextEm(decomposed, 0.6)).toBeCloseTo(0.6)
    expect(estimateTextWidth(decomposed + 'x', 10, 0.6, 2)).toBeCloseTo(12 + 2)
  })
})

describe('fitFontSize', () => {
  const box = { base: 26, maxWidth: 222, narrowEm: 0.6, letterSpacing: -0.5 }

  it('keeps the design size when the text fits', () => {
    expect(fitFontSize('You can park', box)).toBe(26)
  })

  it('shrinks text that would overflow until it fits', () => {
    const long = 'Μπορείς να παρκάρεις εδώ τώρα'
    const size = fitFontSize(long, box)
    expect(size).toBeLessThan(26)
    expect(estimateTextWidth(long, size, box.narrowEm, box.letterSpacing)).toBeLessThanOrEqual(box.maxWidth)
    // The largest size that fits, to a tenth.
    expect(estimateTextWidth(long, size + 0.1, box.narrowEm, box.letterSpacing)).toBeGreaterThan(box.maxWidth)
  })

  it('takes letter-spacing into account', () => {
    const text = 'CATATAN BERTANDA TANGAN'
    const tight = fitFontSize(text, { base: 11, maxWidth: 160, narrowEm: 0.6 })
    const spaced = fitFontSize(text, { base: 11, maxWidth: 160, narrowEm: 0.6, letterSpacing: 1.5 })
    expect(spaced).toBeLessThan(tight)
    expect(estimateTextWidth(text, spaced, 0.6, 1.5)).toBeLessThanOrEqual(160)
  })

  it('never goes below the minimum', () => {
    expect(fitFontSize('x'.repeat(200), { ...box, min: 12 })).toBe(12)
  })
})
