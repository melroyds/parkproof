import { useTranslation } from 'react-i18next'
import Icon from './Icon'

interface Props {
  onBack: () => void
  onTryIt: () => void
}

/**
 * In-app feature showcase, in plain English. Audience: a regular user
 * who just landed on the app and is wondering what's in here. NOT a
 * Reddit tech-bro and NOT a hiring manager — that audience has
 * docs/features.md for the technical inventory.
 *
 * Style guide (preserved across all 7 locales):
 *   - Sentence case headings, second person ("you / your")
 *   - One short sentence per bullet — read aloud, if you stumble, shorten
 *   - Benefits, not features ("get a receipt for your parking spot",
 *     not "cryptographic evidence chain")
 *   - Zero acronyms (no AWS / KMS / API / JSON / etc.)
 *   - One emoji per section, used as a visual anchor, not decoration
 *
 * All content is i18n-driven via the `about.*` namespace. Adding a new
 * language requires translating the keys in src/locales/<lang>.json;
 * no component edits.
 */
export default function AboutFeatures({ onBack, onTryIt }: Props) {
  const { t } = useTranslation()

  // Section ids — order matters (it's the visible order on the page).
  // Each id maps to `about.<id>.title`, `about.<id>.lead`, `about.<id>.items`
  // (array of strings) in the locale file.
  const sections: { id: string; emoji: string }[] = [
    { id: 'scan', emoji: '📸' },
    { id: 'evidence', emoji: '🧾' },
    { id: 'reminders', emoji: '⏰' },
    { id: 'gates', emoji: '🛑' },
    { id: 'appeal', emoji: '✉️' },
    { id: 'kindnesses', emoji: '🌏' },
    { id: 'signIn', emoji: '☁️' },
  ]

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-2xl mx-auto w-full">
      <button
        onClick={onBack}
        className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4"
      >
        {t('common.back')}
      </button>

      <header className="mb-10">
        <h1 className="font-display text-4xl font-extrabold text-ink-900 leading-tight mb-3">
          {t('about.title')}
        </h1>
        <p className="text-base text-ink-700 leading-relaxed max-w-prose">
          {t('about.lead')}
        </p>
      </header>

      {sections.map(({ id, emoji }) => (
        <Section
          key={id}
          emoji={emoji}
          title={t(`about.${id}.title`)}
          lead={t(`about.${id}.lead`)}
          items={
            t(`about.${id}.items`, { returnObjects: true }) as unknown as string[]
          }
        />
      ))}

      {/* Build-in-the-open footer — minimal, friendly */}
      <div className="mb-8 pt-4 border-t border-paper-300">
        <p className="text-xs text-ink-500 leading-relaxed mb-3">
          {t('about.footerNote')}
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="https://github.com/melroyds/parkproof"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand-600 hover:text-brand-700 underline"
          >
            {t('about.sourceOnGitHub')}
          </a>
          <a
            href="https://www.linkedin.com/in/melroyds/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand-600 hover:text-brand-700 underline"
          >
            {t('about.connectOnLinkedIn')}
          </a>
        </div>
      </div>

      <button
        onClick={onTryIt}
        className="w-full bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white text-lg font-semibold py-5 rounded-2xl shadow-lg shadow-brand-500/25 flex items-center justify-center gap-3 transition-colors mb-4"
      >
        <Icon name="camera" className="w-6 h-6" />
        {t('about.cta')}
      </button>
    </div>
  )
}

interface SectionProps {
  emoji: string
  title: string
  lead: string
  items: string[]
}

function Section({ emoji, title, lead, items }: SectionProps) {
  // Defensive — if a translator hasn't filled in the items array yet,
  // render nothing for the list rather than crashing on .map().
  const list = Array.isArray(items) ? items : []
  return (
    <section className="mb-10">
      <header className="flex items-start gap-3 mb-3">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-brand-50 shrink-0 mt-0.5 text-xl">
          <span aria-hidden>{emoji}</span>
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-xl font-extrabold text-ink-900 leading-tight">
            {title}
          </h2>
          <p className="text-sm text-ink-600 leading-relaxed mt-1">{lead}</p>
        </div>
      </header>
      <ul className="space-y-2 mt-3">
        {list.map((item) => (
          <li
            key={item}
            className="flex items-start gap-2 text-sm text-ink-700 leading-relaxed"
          >
            <span className="text-brand-500 shrink-0 mt-0.5" aria-hidden>
              ✓
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
