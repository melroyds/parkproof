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
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English', country: 'AU' },
  { code: 'zh-CN', label: 'Chinese (Simplified)', native: '简体中文', country: 'CN' },
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt', country: 'VN' },
  { code: 'id', label: 'Indonesian', native: 'Bahasa Indonesia', country: 'ID' },
  { code: 'ko', label: 'Korean', native: '한국어', country: 'KR' },
  { code: 'it', label: 'Italian', native: 'Italiano', country: 'IT' },
  { code: 'el', label: 'Greek', native: 'Ελληνικά', country: 'GR' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', country: 'IN' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ', country: 'IN' },
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code']

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

// Expose the i18n instance on globalThis so non-React modules (e.g.
// src/lib/api.ts, which builds error messages from the fetch layer outside
// any component tree) can pull localised strings without importing React or
// useTranslation. Kept narrow: only the .t() function and language code are
// stable across i18next versions, so callers should only rely on those.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).__parkproof_i18n = i18n

export default i18n
