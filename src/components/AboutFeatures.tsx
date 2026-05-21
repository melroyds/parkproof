import { useEffect, useState } from 'react'
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

      {/* Web Push preview — foundation only tonight. Subscription happens
          on click; backend stores the subscription; no auto-firing of
          notifications yet (scheduling layer ships next session). Until
          that lands, this button mainly proves the subscribe pipe works.
          Quietly placed in the About footer rather than promoted — opt-in
          discovery for testers without confusing regular users. */}
      {pushStatus !== 'unsupported' && (
        <div className="mb-6 pt-4 border-t border-paper-300">
          <p className="text-xs font-semibold text-ink-700 mb-1">
            🔔 Notifications (preview)
          </p>
          <p className="text-xs text-ink-500 leading-relaxed mb-3">
            We're wiring up push notifications so reminders work even when
            ParkProof isn't open. Tap to enable on this device — the auto-firing
            schedule arrives in the next update.
          </p>
          {pushStatus === 'subscribed' ? (
            <p className="text-xs text-emerald-700 font-medium">
              ✓ This device is subscribed. You'll get a test push once we send one.
            </p>
          ) : pushStatus === 'denied' ? (
            <p className="text-xs text-ink-500">
              You've blocked notifications for this site. To enable, change the
              permission in your browser's site settings.
            </p>
          ) : pushStatus === 'error' ? (
            <button
              onClick={handleEnablePush}
              className="text-xs bg-paper-100 hover:bg-paper-200 text-ink-800 px-3 py-1.5 rounded-lg border border-paper-300"
            >
              Something went wrong — try again
            </button>
          ) : (
            <button
              onClick={handleEnablePush}
              disabled={pushStatus === 'requesting'}
              className="text-xs bg-brand-50 hover:bg-brand-100 text-brand-700 px-3 py-1.5 rounded-lg border border-brand-200 disabled:opacity-50"
            >
              {pushStatus === 'requesting'
                ? 'Asking your browser…'
                : 'Enable notifications on this device'}
            </button>
          )}
        </div>
      )}

      {/* Build-in-the-open footer — minimal, friendly. Single GitHub link
          (open-source credibility); LinkedIn intentionally NOT linked from
          here — keeps the in-app surface free of personal identity for the
          regular-user audience. People who care to find the maker can still
          do so via the README on GitHub. */}
      <div className="mb-8 pt-4 border-t border-paper-300">
        <p className="text-xs text-ink-500 leading-relaxed mb-3">
          {t('about.footerNote')}
        </p>
        <a
          href="https://github.com/melroyds/parkproof"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-brand-600 hover:text-brand-700 underline"
        >
          {t('about.sourceOnGitHub')}
        </a>
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
