// @vitest-environment happy-dom
//
// <html lang> follows the language on screen (fix list, after the
// overnight build). It stayed "en" in every language, so screen readers
// read Greek and Hindi with an English voice. lang and dir are set at
// startup and on every change, with the app's own codes (zh-CN stays
// zh-CN), and dir is ltr for all nine.
import { afterEach, describe, expect, it, vi } from 'vitest'
import i18n, { SUPPORTED_LANGUAGES, applyDocumentLanguage, supportedLanguageFor } from './i18n'

const STORAGE_KEY = 'parkproof.language'

afterEach(async () => {
  localStorage.removeItem(STORAGE_KEY)
  window.history.replaceState(null, '', '/')
  await i18n.changeLanguage('en')
})

describe('changing the language', () => {
  it('sets lang to the app code and dir to ltr, for all nine languages', async () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toEqual(['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa'])
    for (const { code } of SUPPORTED_LANGUAGES) {
      // Start from something else, so a lang that never changed can't pass.
      document.documentElement.lang = 'xx'
      document.documentElement.dir = 'rtl'
      await i18n.changeLanguage(code)
      expect({ code, lang: document.documentElement.lang, dir: document.documentElement.dir }).toEqual({
        code,
        lang: code,
        dir: 'ltr',
      })
    }
  })

  it('keeps zh-CN as zh-CN, never zh or zh-cn', async () => {
    await i18n.changeLanguage('zh-CN')
    expect(document.documentElement.lang).toBe('zh-CN')
    expect(document.documentElement.getAttribute('lang')).toBe('zh-CN')
  })

  it('a language the app does not have leaves lang on the one shown (English)', async () => {
    await i18n.changeLanguage('el')
    await i18n.changeLanguage('fr')
    expect(i18n.resolvedLanguage).toBe('en')
    expect(document.documentElement.lang).toBe('en')
  })
})

describe('supportedLanguageFor()', () => {
  it('maps a browser tag to the code the app uses', () => {
    expect(supportedLanguageFor('el')).toBe('el')
    expect(supportedLanguageFor('en-AU')).toBe('en')
    expect(supportedLanguageFor('zh')).toBe('zh-CN')
    expect(supportedLanguageFor('zh-Hans-CN')).toBe('zh-CN')
    expect(supportedLanguageFor('hi-IN')).toBe('hi')
    expect(supportedLanguageFor('pa_IN')).toBe('pa')
    expect(supportedLanguageFor('fr')).toBe('en')
    expect(supportedLanguageFor('')).toBe('en')
    expect(supportedLanguageFor(undefined)).toBe('en')
    expect(supportedLanguageFor('cimode')).toBe('en')
  })

  it('applyDocumentLanguage writes both attributes', () => {
    applyDocumentLanguage('ko-KR')
    expect(document.documentElement.lang).toBe('ko')
    expect(document.documentElement.dir).toBe('ltr')
  })
})

describe('at startup', () => {
  async function freshStart(): Promise<void> {
    // index.html ships lang="en" and no dir.
    document.documentElement.lang = 'en'
    document.documentElement.removeAttribute('dir')
    vi.resetModules()
    await import('./i18n')
  }

  it('uses the saved language before anything is tapped', async () => {
    localStorage.setItem(STORAGE_KEY, 'hi')
    await freshStart()
    expect(document.documentElement.lang).toBe('hi')
    expect(document.documentElement.dir).toBe('ltr')
  })

  it('uses ?lng= from the landing page hand-off', async () => {
    window.history.replaceState(null, '', '/app/?lng=zh-CN')
    await freshStart()
    expect(document.documentElement.lang).toBe('zh-CN')
  })
})
