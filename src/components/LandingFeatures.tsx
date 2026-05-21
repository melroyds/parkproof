import { useTranslation } from 'react-i18next'
import Icon, { type IconName } from './Icon'

/**
 * Three-card landing feature row. Renders ONLY for first-time visitors
 * (no saved sessions, no active session) — surfaces the unique value
 * props without forcing returning users to scroll past them on every
 * home-screen visit.
 *
 * Distinct from `home.steps.*` (the numbered "translate → log → remind"
 * list at the bottom): that's a sequential how-to. These are PARALLEL
 * value props, the "wait, this does WHAT?" moment of recognition for a
 * Reddit / HN visitor who's just clicked through from a thumbnail.
 *
 * Position: between the hero header and the scan CTA. The scan button
 * itself is the CTA — no separate "Get started" button here.
 */
export default function LandingFeatures() {
  const { t } = useTranslation()

  const features: { icon: IconName; title: string; desc: string }[] = [
    {
      icon: 'camera',
      title: t('landing.feature.translateTitle'),
      desc: t('landing.feature.translateDesc'),
    },
    {
      icon: 'pin',
      title: t('landing.feature.evidenceTitle'),
      desc: t('landing.feature.evidenceDesc'),
    },
    {
      icon: 'warning',
      title: t('landing.feature.appealTitle'),
      desc: t('landing.feature.appealDesc'),
    },
  ]

  return (
    <div className="w-full mb-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
      {features.map(({ icon, title, desc }) => (
        <div
          key={title}
          className="bg-white border border-paper-300 rounded-2xl p-4 flex flex-col items-start gap-2 shadow-sm"
        >
          <div className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-brand-50 text-brand-600">
            <Icon name={icon} className="w-5 h-5" strokeWidth={2.25} />
          </div>
          <h3 className="font-display text-base font-extrabold text-ink-900 leading-tight">
            {title}
          </h3>
          <p className="text-xs text-ink-600 leading-relaxed">{desc}</p>
        </div>
      ))}
    </div>
  )
}
