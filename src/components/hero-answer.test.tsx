// @vitest-environment happy-dom
//
// The landing hero and the signed seal in the reader's language (fix list
// clean-ups, item 2). The hero's card text and its description come from
// the locale files, and each translated line is sized to stay inside the
// card: the kicker and headline before the card's edge, the time pill
// before the seal.
import { cleanup, render, screen } from '@testing-library/react'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import i18n from '../lib/i18n'
import { HERO_TEXT, HERO_TIME } from '../lib/hero-layout'
import { estimateTextWidth } from '../lib/svg-text-fit'
import HeroAnswer from './HeroAnswer'
import VerifiedSeal from './VerifiedSeal'

const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa'] as const

afterEach(() => cleanup())
afterAll(async () => {
  await i18n.changeLanguage('en')
})

/** One of the card's lines: its text, and the font size and letter-spacing it was drawn at. */
function line(container: HTMLElement, name: string): { text: string; fontSize: number; spacing: number } {
  const el = container.querySelector(`[data-hero="${name}"]`)
  expect(el).not.toBeNull()
  return {
    text: el!.textContent ?? '',
    fontSize: Number(el!.getAttribute('font-size')),
    spacing: Number(el!.getAttribute('letter-spacing') ?? 0),
  }
}

/** Locales whose script has no letter case: drawn with no tracking (fix round 1). */
const UNTRACKED = new Set(['zh-CN', 'ko', 'hi', 'pa'])

describe('HeroAnswer', () => {
  it.each(LOCALES)('is in %s and every line fits its room', async (locale) => {
    await i18n.changeLanguage(locale)
    const { container } = render(<HeroAnswer />)

    const svg = screen.getByRole('img')
    expect(svg.getAttribute('aria-label')).toBe(i18n.t('landing.hero.aria', { time: HERO_TIME }))

    const kicker = line(container, 'kicker')
    const headline = line(container, 'headline')
    const pill = line(container, 'pill')
    expect(kicker.text).toBe(i18n.t('landing.hero.kicker'))
    expect(headline.text).toBe(i18n.t('landing.hero.canPark'))
    // The pill says what the real answer card says.
    expect(pill.text).toBe(i18n.t('result.until', { when: HERO_TIME }))

    const k = HERO_TEXT.kicker
    const h = HERO_TEXT.headline
    const p = HERO_TEXT.pill
    // Tracking breaks the headline stroke that joins Devanagari and Gurmukhi
    // letters (and negative tracking overlaps it), so only cased scripts get it.
    expect(kicker.spacing).toBe(UNTRACKED.has(locale) ? 0 : k.letterSpacing)
    expect(headline.spacing).toBe(UNTRACKED.has(locale) ? 0 : h.letterSpacing)
    expect(estimateTextWidth(kicker.text, kicker.fontSize, k.narrowEm, kicker.spacing)).toBeLessThanOrEqual(k.maxWidth)
    expect(estimateTextWidth(headline.text, headline.fontSize, h.narrowEm, headline.spacing)).toBeLessThanOrEqual(h.maxWidth)
    const box = container.querySelector('[data-hero="pill-box"]')!
    const boxWidth = Number(box.getAttribute('width'))
    expect(boxWidth).toBeLessThanOrEqual(p.maxWidth)
    expect(estimateTextWidth(pill.text, pill.fontSize, p.narrowEm, p.letterSpacing) + 2 * p.padding).toBeLessThanOrEqual(boxWidth)

    // Still readable: never shrunk below these sizes in any language.
    expect(kicker.fontSize).toBeGreaterThanOrEqual(9)
    expect(headline.fontSize).toBeGreaterThanOrEqual(18)
    expect(pill.fontSize).toBeGreaterThanOrEqual(12)

    if (locale !== 'en') {
      const text = container.textContent ?? ''
      expect(text).not.toMatch(/SIGNED RECORD|You can park|until/i)
      expect(svg.getAttribute('aria-label')).not.toMatch(/parking sign turning/i)
    }
  })

  it('keeps the English design sizes and the original pill width', async () => {
    await i18n.changeLanguage('en')
    const { container } = render(<HeroAnswer />)
    expect(line(container, 'kicker').fontSize).toBe(HERO_TEXT.kicker.base)
    expect(line(container, 'headline').fontSize).toBe(HERO_TEXT.headline.base)
    expect(line(container, 'pill').fontSize).toBe(HERO_TEXT.pill.base)
    expect(Number(container.querySelector('[data-hero="pill-box"]')!.getAttribute('width'))).toBe(HERO_TEXT.pill.minWidth)
  })
})

describe('VerifiedSeal', () => {
  // Where it is labelled at all (a History row of a record signed with
  // ParkProof's key; verified-seal.test.tsx covers where it is not).
  it.each(LOCALES)('is labelled in %s', async (locale) => {
    await i18n.changeLanguage(locale)
    const label = i18n.t('common.signedSeal')
    render(<VerifiedSeal label={label} />)
    expect(screen.getByRole('img', { name: label })).toBeTruthy()
    if (locale !== 'en') expect(label).not.toBe(i18n.getFixedT('en')('common.signedSeal'))
  })
})
