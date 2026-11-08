import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import en from '../locales/en.json'
import zhCN from '../locales/zh-CN.json'
import vi from '../locales/vi.json'
import it from '../locales/it.json'
import el from '../locales/el.json'
import hi from '../locales/hi.json'
import pa from '../locales/pa.json'
import id from '../locales/id.json'
import ko from '../locales/ko.json'

/**
 * Supported languages — the source of truth that the LanguageSelector
 * iterates over and that i18next initialises resources for. Adding a new
 * language is: drop the locale JSON, append the entry here, done.
 *
 * Picks based on the 2021 ABS Census for the City of Melbourne LGA, top
 * non-English languages spoken at home:
 *   Mandarin (#1) · Cantonese (#2) · Indonesian (#3) · Vietnamese (#4) ·
 *   Hindi (#5) · Korean (#6) · Thai · Spanish · Arabic · Malay …
 * Italian + Greek + Punjabi are kept for Melbourne cultural identity
 * (Lygon St, the Greek community, the outer-Melbourne Punjabi community)
 * even though they're further down the LGA-specific stats.
 *
 * Note on the flag for Hindi + Punjabi: both use the India flag. Hindi is
 * written in Devanagari, Punjabi (in India) in Gurmukhi — they look very
 * different so the native-name column in the dropdown disambiguates them
 * cleanly even though the flag's the same.
 *
 * `dir` is the writing direction set on <html dir> with the language: all
 * nine are left to right. A right-to-left language (Arabic, say) would set
 * 'rtl' here.
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English', country: 'AU', dir: 'ltr' },
  { code: 'zh-CN', label: 'Chinese (Simplified)', native: '简体中文', country: 'CN', dir: 'ltr' },
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt', country: 'VN', dir: 'ltr' },
  { code: 'id', label: 'Indonesian', native: 'Bahasa Indonesia', country: 'ID', dir: 'ltr' },
  { code: 'ko', label: 'Korean', native: '한국어', country: 'KR', dir: 'ltr' },
  { code: 'it', label: 'Italian', native: 'Italiano', country: 'IT', dir: 'ltr' },
  { code: 'el', label: 'Greek', native: 'Ελληνικά', country: 'GR', dir: 'ltr' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', country: 'IN', dir: 'ltr' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ', country: 'IN', dir: 'ltr' },
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code']

/**
 * The supported code for a language tag: an exact match, else the first
 * supported code with the same base language ('en-AU' is 'en', 'zh' and
 * 'zh-Hans-CN' are 'zh-CN', the same way i18next picks one), else English.
 */
export function supportedLanguageFor(lng: string | null | undefined): LanguageCode {
  const exact = SUPPORTED_LANGUAGES.find((l) => l.code === lng)
  if (exact) return exact.code
  const base = (lng ?? '').toLowerCase().split(/[-_]/)[0]
  const sameBase = base ? SUPPORTED_LANGUAGES.find((l) => l.code.toLowerCase().split('-')[0] === base) : undefined
  return sameBase?.code ?? 'en'
}

/**
 * Set <html lang> and <html dir> to the language on screen. Screen readers
 * pick their voice from lang: left at index.html's "en", Greek and Hindi
 * were read with an English voice (fix list, after the overnight build).
 * Codes are the app's own, so zh-CN stays zh-CN.
 */
export function applyDocumentLanguage(lng: string | null | undefined): void {
  if (typeof document === 'undefined') return
  const code = supportedLanguageFor(lng)
  const root = document.documentElement
  root.lang = code
  root.dir = SUPPORTED_LANGUAGES.find((l) => l.code === code)?.dir ?? 'ltr'
}

// Every language change, including the first one i18next makes while it
// starts up (from ?lng=, the saved choice or the browser's language).
i18n.on('languageChanged', (lng: string) => applyDocumentLanguage(i18n.resolvedLanguage ?? lng))

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
      vi: { translation: vi },
      id: { translation: id },
      ko: { translation: ko },
      it: { translation: it },
      el: { translation: el },
      hi: { translation: hi },
      pa: { translation: pa },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    interpolation: {
      // React already escapes; double-escaping breaks legitimate symbols like →.
      escapeValue: false,
    },
    detection: {
      // querystring FIRST — `?lng=ko` is how the marketing landing's
      // auto-detect chip hands off the user's stated language to the
      // React app. Without this entry, i18next ignores the URL param and
      // falls through to localStorage (which holds the user's PREVIOUS
      // choice, typically English), and the Korean / Mandarin / etc.
      // visitor lands in English despite explicitly clicking the chip.
      // Default lookup param is 'lng' — matches what the landing emits.
      //
      // localStorage second so a user's subsequent in-app pick still wins
      // on reload; browser language third for first-time visitors with
      // no querystring; HTML lang last as the ultimate fallback. All
      // resolved values get cached back to localStorage.
      order: ['querystring', 'localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'parkproof.language',
    },
    returnNull: false,
  })

// With the resources bundled, init has already settled the language by
// here. Set it again in case the startup change was missed.
if (i18n.isInitialized) applyDocumentLanguage(i18n.resolvedLanguage ?? i18n.language)

// Expose the i18n instance on globalThis so non-React modules (e.g.
// src/lib/api.ts, which builds error messages from the fetch layer outside
// any component tree) can pull localised strings without importing React or
// useTranslation. Kept narrow: only the .t() function and language code are
// stable across i18next versions, so callers should only rely on those.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).__parkproof_i18n = i18n

export default i18n
