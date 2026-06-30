import { Trans, useTranslation } from 'react-i18next'
import Icon from './Icon'
import VerifiedSeal from './VerifiedSeal'
import HeroAnswer from './HeroAnswer'

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
 *   3. "Tamper-proof evidence" callout — the one feature that genuinely
 *      sets ParkProof apart (cryptographic signing of every record).
 *      The i18n key for the third bullet is still `defensible` for
 *      historical reasons (renaming the key would mean editing every
 *      locale file); the displayed *value* is now "Tamper-proof if
 *      you're ticketed" everywhere. See `src/locales/en.json` →
 *      `landing.bullet.defensible`.
 *
 * The CTA inside this component fires the same `onScanCta` callback as
 * the home-screen scan button, so the parent doesn't render two buttons.
 *
 * Layout is mobile-first 2-column (text 55% / hero illustration 45%) for
 * the hero block — the mockup keeps this column split even on narrow
 * iPhone widths because the illustration is iconic and stays legible at
 * small sizes.
 */
interface Props {
  onScanCta: () => void
  /**
   * Optional sign-in handler. When provided, renders a secondary white
   * button directly below the gradient scan CTA labelled "Sign in to
   * sync". App.tsx only passes this for first-time visitors who AREN'T
   * already signed in — the returning-user / signed-in cases handle
   * their own auth surfaces elsewhere. Closes the "I have an account
   * on another device and can't reach the sign-in screen" gap that
   * was hidden by the first-time-visitor short-circuit before launch.
   */
  onSignInCta?: () => void
}

export default function LandingFeatures({ onScanCta, onSignInCta }: Props) {
  const { t } = useTranslation()

  const bullets: { key: string }[] = [
    { key: 'plainEnglish' },
    { key: 'photoEvidence' },
    { key: 'defensible' },
  ]

  const steps: { num: string; tone: 'brand' | 'ink' | 'accent'; key: 'snap' | 'analyse' | 'answer'; icon: 'camera' | 'check' | 'warning' }[] = [
    { num: '1', tone: 'brand', key: 'snap', icon: 'camera' },
    { num: '2', tone: 'ink', key: 'analyse', icon: 'warning' },
    { num: '3', tone: 'accent', key: 'answer', icon: 'check' },
  ]

  // Three step badges, now sitting on the dark vault how-it-works cards.
  // Kept as translucent paper-tinted discs so the mint stays a rare spark
  // (it lives only on the index notch / hairlines on this surface).
  const stepToneClasses: Record<'brand' | 'ink' | 'accent', string> = {
    brand: 'bg-white/10 text-paper-50',
    ink: 'bg-white/10 text-paper-50',
    accent: 'bg-white/10 text-paper-50',
  }

  return (
    <div className="w-full">
      {/* ── Hero — a fully-designed illustration: an Aussie parking sign
          resolving into a stamped, tamper-evident verdict record. Says what
          ParkProof IS (a verified answer) in one image, and animates once on
          mount (scan -> record rises -> seal stamps). Replaces the old
          composited stock photo. */}
      <div className="w-full mb-8">
        <HeroAnswer className="w-full h-auto select-none pointer-events-none" />
      </div>

      {/* ── Headline + value bullets, now BELOW the hero ─────────────── */}
      <div className="mb-6">
        {/* Split-colour headline. One key with an <accent> tag instead of
            three positional keys, so each locale places the emphasised word
            and its line break where its own grammar wants it. The accent span
            is `block`, so the brand-blue word drops onto its own line (the
            "simple." rhythm) wherever the translation puts it. */}
        <h1 className="font-display text-5xl sm:text-6xl font-extrabold text-paper-50 tracking-tight leading-[0.95]">
          <Trans
            i18nKey="landing.heroTitle"
            components={{ accent: <span className="block text-[#7BE3A4]" /> }}
          />
        </h1>
        <p className="text-sm mt-4 leading-relaxed max-w-[22rem]" style={{ color: '#A9CFBE' }}>
          <Trans
            i18nKey="landing.heroSubhead"
            components={{ accent: <span className="text-paper-50 font-bold" /> }}
          />
        </p>
      </div>

      {/* ── Three checkmark value props ─────────────────────────────── */}
      <ul className="mb-6 space-y-3">
        {bullets.map(({ key }) => (
          <li key={key} className="flex items-center gap-2.5 text-base text-paper-50">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full border-2 border-[#7BE3A4] text-[#7BE3A4] shrink-0">
              <Icon name="check" className="w-3.5 h-3.5" strokeWidth={3} />
            </span>
            <span>{t(`landing.bullet.${key}`)}</span>
          </li>
        ))}
      </ul>

      {/* ── Accuracy caveat. Quiet, muted. Sets the expectation that the
          AI read is a helpful first pass, not legal advice, BEFORE the
          first-timer hands over a photo + GPS. */}
      <p className="text-xs leading-relaxed mb-6 max-w-[24rem]" style={{ color: '#A9CFBE' }}>
        {t('landing.accuracyNote')}
      </p>

      {/* ── Primary CTA. Flat pine (Greenfield). Larger than the standard
          home-screen scan button to anchor the page; the camera icon
          and the bigger padding read as "this is the thing you do". */}
      <button
        type="button"
        onClick={onScanCta}
        className="w-full inline-flex items-center justify-center gap-3 mb-3 bg-paper-50 hover:bg-white active:bg-paper-100 text-brand-800 text-lg font-semibold py-4 rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.25)] transition-colors"
      >
        <Icon name="camera" className="w-6 h-6" strokeWidth={2} />
        {t('landing.cta')}
      </button>

      {/* ── Secondary sign-in CTA. Renders ONLY for first-time visitors
          who aren't already signed in (App.tsx gates the prop). Returning
          users on a new device land here, see this button right under the
          primary scan CTA, and can reach their cloud-synced sessions in
          one tap instead of being forced to create a dummy session first.

          Visual hierarchy: white-on-paper, smaller padding than the
          gradient above. The gradient still wins the eye — this reads
          as "second option" without disappearing.

          Reuses the existing `home.signInToSync` i18n key (translated in
          all 9 locales) to avoid translation churn. "Sign in to sync
          across devices" wraps slightly long on Hindi/Punjabi in some
          viewports; if that becomes a real visual problem we can add a
          shorter `landing.signInCta` key later. */}
      {onSignInCta && (
        <button
          type="button"
          onClick={onSignInCta}
          className="w-full border text-paper-50 font-semibold py-3 rounded-xl transition-colors mb-3 hover:brightness-110"
          style={{ background: 'rgba(255,255,255,0.055)', borderColor: 'rgba(123,227,164,0.22)' }}
        >
          {t('home.signInToSync')}
        </button>
      )}

      {/* Reassurance line under the CTA — small shield + line. Echoes the
          civic, "we're on your side" tone of the brand. */}
      <div className="flex items-center justify-center gap-2 text-xs mb-4" style={{ color: '#A9CFBE' }}>
        <ShieldIcon className="w-4 h-4 text-[#7BE3A4]" />
        <span>{t('landing.builtFor')}</span>
      </div>

      {/* ── Trust strip. Mirrors the marketing hero's "Free · No account ·
          Works offline" so direct entrants (PWA / bookmark / /app/ deep
          link) who never see the marketing site get the same reassurance.
          Dot-separated chips, centred, muted. */}
      <div className="flex items-center justify-center flex-wrap gap-x-2.5 gap-y-1 text-xs font-medium mb-2" style={{ color: '#A9CFBE' }}>
        <span>{t('landing.trustFree')}</span>
        <span aria-hidden style={{ color: 'rgba(123,227,164,0.4)' }}>·</span>
        <span>{t('landing.trustNoAccount')}</span>
        <span aria-hidden style={{ color: 'rgba(123,227,164,0.4)' }}>·</span>
        <span>{t('landing.trustOffline')}</span>
      </div>

      {/* Location-optional reassurance — privacy-wary users can decline GPS
          without breaking the app. */}
      <p className="text-center text-2xs leading-relaxed mb-12" style={{ color: '#A9CFBE' }}>
        {t('landing.locationOptional')}
      </p>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <h2 className="font-display text-2xl font-extrabold text-paper-50 text-center mb-5">
        {t('landing.howItWorks.heading')}
      </h2>
      <div className="grid grid-cols-3 gap-2 mb-10">
        {steps.map(({ num, tone, key, icon }, idx) => (
          <div key={num} className="relative">
            <div
              className="gf-card p-3 flex flex-col items-center text-center h-full"
              style={{ background: 'rgba(255,255,255,0.055)' }}
            >
              <div className={`relative w-12 h-12 rounded-full ${stepToneClasses[tone]} flex items-center justify-center mb-2`}>
                <Icon name={icon} className="w-5 h-5" strokeWidth={2.25} />
                {/* Numbered badge in the bottom-right corner of the icon
                    circle — matches the mockup's "1 / 2 / 3" pill. */}
                <span
                  className="absolute -bottom-1 -left-1 border rounded-full w-5 h-5 flex items-center justify-center text-2xs font-bold text-brand-800 bg-paper-50"
                  style={{ borderColor: 'rgba(123,227,164,0.22)' }}
                >
                  {num}
                </span>
              </div>
              <h3 className="font-display text-xs font-extrabold text-paper-50 leading-tight mb-1">
                {t(`landing.howItWorks.${key}Title`)}
              </h3>
              <p className="text-2xs leading-relaxed" style={{ color: '#A9CFBE' }}>
                {t(`landing.howItWorks.${key}Desc`)}
              </p>
            </div>
            {idx < steps.length - 1 && (
              <span
                aria-hidden
                className="hidden sm:block absolute top-9 -right-3 text-lg pointer-events-none"
                style={{ color: 'rgba(123,227,164,0.5)' }}
              >
                ›
              </span>
            )}
          </div>
        ))}
      </div>

      {/* ── Tamper-proof evidence callout ────────────────────────────── */}
      <div
        className="gf-card-lg p-4 flex items-start gap-3 mb-10"
        style={{
          background: 'rgba(255,255,255,0.055)',
          backgroundImage:
            'repeating-linear-gradient(115deg, rgba(123,227,164,0.07) 0 1px, transparent 1px 8px)',
        }}
      >
        <div className="shrink-0">
          <VerifiedSeal size={40} glow />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-base font-extrabold text-paper-50 leading-tight">
            {t('landing.evidenceCallout.title')}
          </h3>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: '#A9CFBE' }}>
            {t('landing.evidenceCallout.body')}
          </p>
        </div>
        <span aria-hidden className="text-xl shrink-0 leading-none mt-3 mr-1" style={{ color: 'rgba(123,227,164,0.5)' }}>›</span>
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
