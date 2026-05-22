import { useTranslation } from 'react-i18next'
import Icon from './Icon'

/**
 * First-time-visitor landing experience. Renders ONLY for users with no
 * active session AND no saved sessions — returning users see the original
 * compact home layout. Owns its own hero (App.tsx hides the default
 * "ParkProof + tagline" header when this component is shown).
 *
 * Three blocks:
 *   1. Hero — split-colour "Parking made simple." headline, subhead with
 *      bolded "10 seconds", three checkmark value props, gradient CTA,
 *      "Built for Aussie drivers" reassurance line.
 *   2. "How it works" — three numbered cards in a horizontal row.
 *   3. "Defensible evidence" callout — the one feature that genuinely
 *      sets ParkProof apart (cryptographic signing of every record).
 *
 * The CTA inside this component fires the same `onScanCta` callback as
 * the home-screen scan button, so the parent doesn't render two buttons.
 *
 * Layout is mobile-first 2-column (text 55% / hero illustration 45%) for
 * the hero block — the mockup keeps this column split even on narrow
 * iPhone widths because the illustration is iconic and stays legible at
 * small sizes.
 */
export default function LandingFeatures({ onScanCta }: { onScanCta: () => void }) {
  const { t } = useTranslation()

  const bullets: { key: string }[] = [
    { key: 'plainEnglish' },
    { key: 'photoEvidence' },
    { key: 'defensible' },
  ]

  const steps: { num: string; tone: 'brand' | 'purple' | 'accent'; key: 'snap' | 'analyse' | 'answer'; icon: 'camera' | 'check' | 'warning' }[] = [
    { num: '1', tone: 'brand', key: 'snap', icon: 'camera' },
    { num: '2', tone: 'purple', key: 'analyse', icon: 'warning' },
    { num: '3', tone: 'accent', key: 'answer', icon: 'check' },
  ]

  const stepToneClasses: Record<'brand' | 'purple' | 'accent', string> = {
    brand: 'bg-brand-500 text-white',
    // Tailwind built-in purple — Tailwind v4 ships the full default palette,
    // so this works without adding a custom token in index.css.
    purple: 'bg-purple-500 text-white',
    accent: 'bg-accent-500 text-white',
  }

  return (
    <div className="w-full">
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="flex flex-row items-center gap-3 mb-10">
        <div className="flex-1 min-w-0">
          {/* Split-colour headline. Three explicit lines so the brand-blue
              "simple." sits below the navy "Parking / made" — the visual
              rhythm of the mockup depends on this exact line break. */}
          <h1 className="font-display text-5xl sm:text-6xl font-extrabold text-ink-900 tracking-tight leading-[0.95]">
            <span className="block">{t('landing.heroTitle1')}</span>
            <span className="block">{t('landing.heroTitle2')}</span>
            <span className="block text-brand-500">{t('landing.heroTitle3')}</span>
          </h1>
          <p className="text-sm text-ink-700 mt-4 leading-relaxed max-w-[20rem]">
            {t('landing.heroSubhead')}{' '}
            <span className="text-brand-600 font-bold">{t('landing.heroSubheadAccent')}</span>
            {t('landing.heroSubheadTail')}
          </p>
        </div>
        {/* Hero illustration — kept inline-right for the visual rhythm of
            the mockup. Decorative; alt="" is intentional. */}
        <img
          src="/hero-illustration.svg"
          alt=""
          aria-hidden
          className="w-[140px] sm:w-[180px] shrink-0 select-none pointer-events-none"
        />
      </div>

      {/* ── Three checkmark value props ─────────────────────────────── */}
      <ul className="mb-6 space-y-3">
        {bullets.map(({ key }) => (
          <li key={key} className="flex items-center gap-2.5 text-base text-ink-800">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border-2 border-brand-500 text-brand-500 shrink-0">
              <Icon name="check" className="w-3.5 h-3.5" strokeWidth={3} />
            </span>
            <span>{t(`landing.bullet.${key}`)}</span>
          </li>
        ))}
      </ul>

      {/* ── Gradient CTA. Brand-blue → purple. Larger than the standard
          home-screen scan button to anchor the page; the camera icon
          and the bigger padding read as "this is the thing you do". */}
      <button
        onClick={onScanCta}
        className="w-full bg-gradient-to-r from-brand-500 via-brand-500 to-purple-600 hover:brightness-110 active:brightness-95 text-white text-lg font-semibold py-5 rounded-2xl shadow-xl shadow-brand-500/30 flex items-center justify-center gap-3 transition-[filter] mb-3"
      >
        <Icon name="camera" className="w-6 h-6" strokeWidth={2} />
        {t('landing.cta')}
      </button>

      {/* Reassurance line under the CTA — small shield + line. Echoes the
          civic, "we're on your side" tone of the brand. */}
      <div className="flex items-center justify-center gap-2 text-xs text-ink-600 mb-12">
        <ShieldIcon className="w-4 h-4 text-brand-500" />
        <span>{t('landing.builtFor')}</span>
      </div>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <h2 className="font-display text-2xl font-extrabold text-ink-900 text-center mb-5">
        {t('landing.howItWorks.heading')}
      </h2>
      <div className="grid grid-cols-3 gap-2 mb-10">
        {steps.map(({ num, tone, key, icon }, idx) => (
          <div key={num} className="relative">
            <div className="bg-white border border-paper-300 rounded-2xl p-3 flex flex-col items-center text-center shadow-sm h-full">
              <div className={`relative w-12 h-12 rounded-full ${stepToneClasses[tone]} flex items-center justify-center mb-2`}>
                <Icon name={icon} className="w-5 h-5" strokeWidth={2.25} />
                {/* Numbered badge in the bottom-right corner of the icon
                    circle — matches the mockup's "1 / 2 / 3" pill. */}
                <span className="absolute -bottom-1 -left-1 bg-white border border-paper-300 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold text-ink-800">
                  {num}
                </span>
              </div>
              <h3 className="font-display text-xs font-extrabold text-ink-900 leading-tight mb-1">
                {t(`landing.howItWorks.${key}Title`)}
              </h3>
              <p className="text-[11px] text-ink-600 leading-relaxed">
                {t(`landing.howItWorks.${key}Desc`)}
              </p>
            </div>
            {idx < steps.length - 1 && (
              <span
                aria-hidden
                className="hidden sm:block absolute top-9 -right-3 text-ink-400 text-lg font-light pointer-events-none"
              >
                ›
              </span>
            )}
          </div>
        ))}
      </div>

      {/* ── Defensible evidence callout ──────────────────────────────── */}
      <div className="bg-brand-50 border border-brand-100 rounded-2xl p-4 flex items-start gap-3 mb-10">
        <div className="w-10 h-10 rounded-xl bg-brand-500 text-white flex items-center justify-center shrink-0">
          <ShieldIcon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-base font-extrabold text-ink-900 leading-tight">
            {t('landing.evidenceCallout.title')}
          </h3>
          <p className="text-xs text-ink-700 mt-1 leading-relaxed">
            {t('landing.evidenceCallout.body')}
          </p>
        </div>
        <span aria-hidden className="text-ink-400 text-xl shrink-0 leading-none mt-1">›</span>
      </div>
    </div>
  )
}

/**
 * Inline shield icon. Not in the Icon set because the standard icon stroke
 * weight reads thin at the small sizes used here ("Built for Aussie drivers"
 * subline). Filled-shape SVG renders crisper at 16px and below.
 */
function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M12 2L4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5l-8-3zm-1 13l-3-3 1.4-1.4L11 12.2l4.6-4.6L17 9l-6 6z" />
    </svg>
  )
}
