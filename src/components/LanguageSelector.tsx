import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AU from 'country-flag-icons/react/3x2/AU'
import CN from 'country-flag-icons/react/3x2/CN'
import VN from 'country-flag-icons/react/3x2/VN'
import ID from 'country-flag-icons/react/3x2/ID'
import KR from 'country-flag-icons/react/3x2/KR'
import IT from 'country-flag-icons/react/3x2/IT'
import GR from 'country-flag-icons/react/3x2/GR'
import IN from 'country-flag-icons/react/3x2/IN'
import { SUPPORTED_LANGUAGES, type LanguageCode } from '../lib/i18n'

/**
 * Map of ISO 3166-1 alpha-2 country code → flag component. Centralised so
 * adding another language is just two lines: add to `SUPPORTED_LANGUAGES`,
 * import the flag, register here.
 */
const FLAG_COMPONENTS: Record<string, typeof AU> = {
  AU,
  CN,
  VN,
  ID,
  KR,
  IT,
  GR,
  IN,
}

/**
 * Dropdown language selector. Replaced the 5-flag strip when the language
 * list grew to 7 — flags-in-a-row wraps awkwardly on a 320px viewport at
 * that point. The trigger button shows the active language's flag + native
 * name; tapping opens a popover-styled list with all options, native name
 * + flag per row. Click anywhere outside the popover (or pick an option)
 * to close.
 *
 * Native names disambiguate Hindi vs Punjabi (both use the India flag —
 * Devanagari script for Hindi, Gurmukhi for Punjabi).
 */
export default function LanguageSelector() {
  const { t, i18n } = useTranslation()
  const current = (i18n.resolvedLanguage ?? 'en') as LanguageCode
  const activeLang =
    SUPPORTED_LANGUAGES.find((l) => l.code === current) ?? SUPPORTED_LANGUAGES[0]
  const ActiveFlag = FLAG_COMPONENTS[activeLang.country]

  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside-click. Also close on Escape so keyboard users have a
  // clean exit without having to find the trigger button again.
  useEffect(() => {
    if (!open) return
    const handleDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleDocClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleDocClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const handlePick = (code: LanguageCode) => {
    void i18n.changeLanguage(code)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('language.title')}
        className="inline-flex items-center gap-2 bg-white hover:bg-paper-50 border border-paper-300 rounded-full pl-1.5 pr-3 py-1 text-sm font-medium text-ink-900 transition-colors shadow-sm"
      >
        <ActiveFlag className="block w-6 h-4 rounded-sm overflow-hidden" />
        <span>{activeLang.native}</span>
        {/* Chevron — flips when open for affordance. */}
        <svg
          className={`w-3 h-3 text-ink-600 transition-transform ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden
        >
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t('language.title')}
          className="absolute left-1/2 -translate-x-1/2 mt-2 z-20 w-56 bg-white border border-paper-300 rounded-2xl shadow-lg shadow-ink-900/10 py-1 overflow-hidden"
        >
          {SUPPORTED_LANGUAGES.map((lang) => {
            const Flag = FLAG_COMPONENTS[lang.country]
            const isActive = current === lang.code
            return (
              <li key={lang.code} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onClick={() => handlePick(lang.code)}
                  className={[
                    'w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-800 font-semibold'
                      : 'hover:bg-paper-50 text-ink-800',
                  ].join(' ')}
                >
                  <Flag className="block w-6 h-4 rounded-sm overflow-hidden shrink-0" />
                  <span className="flex-1">{lang.native}</span>
                  {isActive && (
                    <svg className="w-4 h-4 text-brand-600 shrink-0" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
