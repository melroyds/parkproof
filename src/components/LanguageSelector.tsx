import { useTranslation } from 'react-i18next'
import AU from 'country-flag-icons/react/3x2/AU'
import CN from 'country-flag-icons/react/3x2/CN'
import VN from 'country-flag-icons/react/3x2/VN'
import IT from 'country-flag-icons/react/3x2/IT'
import GR from 'country-flag-icons/react/3x2/GR'
import { SUPPORTED_LANGUAGES, type LanguageCode } from '../lib/i18n'

const FLAG_COMPONENTS: Record<string, typeof AU> = {
  AU,
  CN,
  VN,
  IT,
  GR,
}

/**
 * Flag-strip language selector. Five SVG flags in a row; the active one has
 * a brand-coloured ring + slightly larger scale. Tapping a flag changes
 * i18next's language and persists the choice to localStorage (via the
 * detector config in lib/i18n.ts).
 *
 * The Australian flag is used for English-AU per spec — explicitly distinct
 * from the British / US flag people sometimes assume for "English".
 */
export default function LanguageSelector() {
  const { t, i18n } = useTranslation()
  const current = (i18n.resolvedLanguage ?? 'en') as LanguageCode

  return (
    <nav
      className="flex items-center justify-center gap-3"
      aria-label={t('language.title')}
    >
      {SUPPORTED_LANGUAGES.map((lang) => {
        const Flag = FLAG_COMPONENTS[lang.country]
        const isActive = current === lang.code
        return (
          <button
            key={lang.code}
            type="button"
            onClick={() => void i18n.changeLanguage(lang.code)}
            aria-pressed={isActive}
            aria-label={`${t('language.tooltipPrefix')} ${lang.native}`}
            title={lang.native}
            className={[
              'rounded-md overflow-hidden border-2 transition-all',
              isActive
                ? 'border-brand-500 scale-110 shadow-md shadow-brand-500/30'
                : 'border-paper-300 opacity-60 hover:opacity-100 hover:border-paper-500',
            ].join(' ')}
          >
            {/* 3x2 aspect ratio. Sized so the strip fits five flags on a 320px viewport with gaps. */}
            <Flag className="block w-9 h-6" title={lang.native} />
          </button>
        )
      })}
    </nav>
  )
}
