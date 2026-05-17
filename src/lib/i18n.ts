import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import en from '../locales/en.json'
import zhCN from '../locales/zh-CN.json'
import vi from '../locales/vi.json'
import it from '../locales/it.json'
import el from '../locales/el.json'

/**
 * Supported languages — the source of truth that the LanguageSelector
 * iterates over and that i18next initialises resources for. Adding a new
 * language is: drop the locale JSON, append the entry here, done.
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', native: 'English', country: 'AU' },
  { code: 'zh-CN', label: 'Chinese (Simplified)', native: '简体中文', country: 'CN' },
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt', country: 'VN' },
  { code: 'it', label: 'Italian', native: 'Italiano', country: 'IT' },
  { code: 'el', label: 'Greek', native: 'Ελληνικά', country: 'GR' },
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
      it: { translation: it },
      el: { translation: el },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    interpolation: {
      // React already escapes; double-escaping breaks legitimate symbols like →.
      escapeValue: false,
    },
    detection: {
      // localStorage first so the user's previous choice wins; browser
      // language second for first-time visitors; HTML lang last as the
      // ultimate fallback. Persist the choice back to localStorage.
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'parkproof.language',
    },
    returnNull: false,
  })

export default i18n
