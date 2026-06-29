import { Fragment, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'
import {
  getPushPermissionState,
  subscribeToPush,
  getDeviceId,
  hasActiveSubscription,
} from '../lib/push'

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
 * Style guide (preserved across all 9 locales):
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
  const [pushStatus, setPushStatus] = useState<
    'idle' | 'requesting' | 'subscribed' | 'denied' | 'unsupported' | 'error'
  >(() => {
    // Initial sync state — only the cheaply-knowable things. We deliberately
    // do NOT shortcut to 'subscribed' based on Notification.permission alone,
    // because that permission survives "Clear site data" while the actual
    // PushSubscription doesn't — showing "subscribed" when there's no real
    // subscription leaves users stuck with no way to re-enrol.
    const state = getPushPermissionState()
    if (state === 'unsupported') return 'unsupported'
    if (state === 'denied') return 'denied'
    return 'idle'
  })

  // On mount, async-check whether an actual push subscription exists. Only
  // flip to "subscribed" if BOTH permission is granted AND the SW has a
  // real subscription object. This survives "Clear site data" honestly —
  // permission stays granted, but the missing subscription keeps the
  // Enable button visible so the user can re-enrol.
  useEffect(() => {
    let cancelled = false
    hasActiveSubscription().then((has) => {
      if (cancelled) return
      if (has) setPushStatus('subscribed')
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleEnablePush() {
    setPushStatus('requesting')
    const result = await subscribeToPush()
    if (result.ok) {
      setPushStatus('subscribed')
      // Convenience: log the device id so it's easy to copy into a test
      // push call. Removed once the dispatch layer ships.
      // eslint-disable-next-line no-console
      console.log('[ParkProof] push device_id:', getDeviceId())
    } else if (result.reason === 'denied') {
      setPushStatus('denied')
    } else if (result.reason === 'unsupported') {
      setPushStatus('unsupported')
    } else {
      setPushStatus('error')
    }
  }

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
        <Fragment key={id}>
          <Section
            emoji={emoji}
            title={t(`about.${id}.title`)}
            lead={t(`about.${id}.lead`)}
            items={
              t(`about.${id}.items`, { returnObjects: true }) as unknown as string[]
            }
          />
          {/* Push-subscribe block rendered as a child of the reminders
              section. Pre-grants browser notification permission so when
              the user later sets a reminder in the actual logging flow,
              the OS doesn't interrupt mid-flow with a permission prompt.
              Web Push is fully shipped (EventBridge scheduler + dispatch
              Lambda), so the previous "(preview)" framing is gone — this
              is the real feature. Skipped entirely on browsers without
              push support so the UI stays honest. */}
          {id === 'reminders' && pushStatus !== 'unsupported' && (
            <PushSubscribeBlock
              pushStatus={pushStatus}
              onEnable={handleEnablePush}
            />
          )}
          {/* Plain-English caveat under the evidence section. The seal proves
              the record hasn't been altered since it was made — it does NOT
              prove the AI read the sign correctly, nor does it oblige a
              council to accept the appeal. Muted, indented to align with the
              section text column so it informs without undercutting the
              feature it sits beneath. */}
          {id === 'evidence' && (
            <p className="-mt-6 mb-10 ml-14 text-xs text-ink-600 leading-relaxed">
              {t('about.sealCaveat')}
            </p>
          )}
        </Fragment>
      ))}

      {/* Buy-me-a-coffee block. Free-forever tipping surface, opt-in by
          definition — anyone who's read this far has used the app, liked
          it enough to come back to /about, and is browsing leisurely. The
          right moment for a soft ask. New tab so the user doesn't lose
          their place; rel='noopener' for the usual security reason.
          Brand-tinted to match the push-subscribe block above without
          being shouty. The coffee emoji works across all 9 locales — BMC
          is globally recognised as a tipping platform. */}
      <div className="mb-8 p-5 rounded-2xl bg-brand-50 border border-brand-100">
        <p className="text-sm font-semibold text-ink-900 mb-1">
          {t('about.support.title')}
        </p>
        <p className="text-xs text-ink-700 leading-relaxed mb-3">
          {t('about.support.body')}
        </p>
        <a
          href="https://buymeacoffee.com/parkproof"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center text-sm font-semibold text-white bg-ink-900 hover:bg-ink-800 px-4 py-2 rounded-xl transition-colors"
        >
          {t('about.support.button')}
        </a>
      </div>

      {/* Build-in-the-open footer — minimal, no personal identity. GitHub
          link intentionally removed: the linked profile/repo carries name +
          photo, and ParkProof's surface should stay free of that for the
          regular-user audience. People who want to reach the maker can use
          the in-app Feedback form or the listed support email. */}
      <div className="mb-8 pt-4 border-t border-paper-300">
        <p className="text-xs text-ink-600 leading-relaxed">
          {t('about.footerNote')}
        </p>
      </div>

      <button
        onClick={onTryIt}
        className="w-full bg-gradient-to-r from-brand-500 via-brand-500 to-brand-700 hover:brightness-110 active:brightness-95 disabled:bg-none disabled:bg-brand-300 text-white text-lg font-semibold py-5 rounded-2xl shadow-lg shadow-brand-500/25 flex items-center justify-center gap-3 transition-colors mb-4"
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

/**
 * Push-subscribe callout, rendered inline as a visual child of the
 * Reminders Section. Indented (ml-14) to align with the section's text
 * column, brand-tinted to signal "related to reminders," and uses a
 * negative top margin (-mt-4) to sit immediately under its parent
 * without leaving the rhythm of the surrounding sections.
 *
 * Branching:
 *   subscribed → green confirmation
 *   denied     → instructions for changing the browser permission
 *   error      → retry button
 *   idle / requesting → "Enable notifications" CTA
 */
interface PushSubscribeBlockProps {
  pushStatus: 'idle' | 'requesting' | 'subscribed' | 'denied' | 'unsupported' | 'error'
  onEnable: () => void
}

function PushSubscribeBlock({ pushStatus, onEnable }: PushSubscribeBlockProps) {
  const { t } = useTranslation()
  return (
    <div className="-mt-4 mb-10 ml-14 p-4 rounded-2xl bg-brand-50 border border-brand-100">
      <p className="text-sm font-semibold text-ink-900 mb-1">
        🔔 {t('about.push.title')}
      </p>
      <p className="text-xs text-ink-700 leading-relaxed mb-3">
        {t('about.push.body')}
      </p>
      {pushStatus === 'subscribed' ? (
        <p className="text-xs text-emerald-700 font-medium">
          {t('about.push.subscribed')}
        </p>
      ) : pushStatus === 'denied' ? (
        <p className="text-xs text-ink-600 leading-relaxed">
          {t('about.push.denied')}
        </p>
      ) : pushStatus === 'error' ? (
        <button
          onClick={onEnable}
          className="text-xs bg-white hover:bg-paper-50 text-ink-800 px-3 py-1.5 rounded-lg border border-paper-300"
        >
          {t('about.push.errorRetry')}
        </button>
      ) : (
        <button
          onClick={onEnable}
          disabled={pushStatus === 'requesting'}
          className="text-xs bg-brand-500 hover:bg-brand-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 font-medium"
        >
          {pushStatus === 'requesting' ? t('about.push.requesting') : t('about.push.enable')}
        </button>
      )}
    </div>
  )
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
