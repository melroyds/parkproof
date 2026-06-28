import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { formatCountdownLocalized, formatElapsedLocalized } from '../lib/countdown'
import { useNow } from '../lib/use-now'
import { formatExpiryAbsolute } from '../lib/time-format'
import { sessionTimezone } from '../lib/timezone'
import Icon from './Icon'

interface Props {
  sessions: ParkingSession[]
  onBack: () => void
  onOpen: (session: ParkingSession) => void
}

/**
 * Per-urgency pill styling. Mirrors ActiveSessionCard's URGENCY_STYLES but
 * tuned for the compact list-row variant — fills the entire row's left edge
 * as a coloured stripe + matching subtle background tint.
 */
const URGENCY_STYLES = {
  normal: { stripe: 'bg-emerald-500', tint: 'bg-emerald-50', text: 'text-emerald-900' },
  warning: { stripe: 'bg-amber-500', tint: 'bg-amber-50', text: 'text-amber-900' },
  urgent: { stripe: 'bg-red-600', tint: 'bg-red-50', text: 'text-red-900' },
  expired: { stripe: 'bg-ink-700', tint: 'bg-paper-100', text: 'text-ink-900' },
} as const

/**
 * Full-screen view listing every active parking session (expires_at in the
 * future). Reached from the "+N more" pill on ActiveSessionCard when the user
 * has more than one car parked simultaneously.
 *
 * Each row is a compact mirror of the home-screen Active card — same urgency
 * colour grammar (green > 1h, amber 15–60min, red < 15min), address, and
 * countdown — so the home → list → home glance pattern stays consistent.
 * Tapping a row opens that session's detail screen.
 */
export default function ActiveSessionsList({ sessions, onBack, onOpen }: Props) {
  const { t } = useTranslation()
  const now = useNow(30_000)

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <button
        onClick={onBack}
        className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4 transition-colors"
      >
        {t('common.back')}
      </button>

      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">
        {t('active.allActiveHeader', {
          defaultValue: 'Currently parked',
        })}
      </h2>
      <p className="text-sm text-ink-600 mb-6 leading-relaxed">
        {t('active.allActiveIntro', {
          count: sessions.length,
          defaultValue:
            '{{count}} active parking sessions. Tap any one to open its evidence record.',
        })}
      </p>

      <ul className="space-y-3">
        {sessions.map((session) => {
          // Branch on whether the session has an expiry. Open-ended (no-sign)
          // sessions render in the neutral 'normal' palette with elapsed-time
          // copy; expiry-bearing ones get the urgency colour grammar.
          const hasExpiry = !!session.expires_at
          const expiresMs = hasExpiry
            ? new Date(session.expires_at as string).getTime()
            : null
          const countdown = hasExpiry
            ? formatCountdownLocalized((expiresMs as number) - now, t)
            : null
          const elapsed = !hasExpiry
            ? formatElapsedLocalized(now - new Date(session.arrived_at).getTime(), t)
            : null
          const style = URGENCY_STYLES[countdown?.urgency ?? 'normal']
          const timeZone = sessionTimezone(session.location)
          const expiryLabel = hasExpiry
            ? formatExpiryAbsolute(session.expires_at as string, {
                now: new Date(now),
                timeZone,
              })
            : null
          const addressLine =
            session.location?.address ??
            (session.location
              ? `${session.location.lat.toFixed(4)}, ${session.location.lng.toFixed(4)}`
              : t('active.lastLoggedSpot', { defaultValue: 'Last logged spot' }))

          return (
            <li key={session.id}>
              <button
                onClick={() => onOpen(session)}
                className={`w-full text-left rounded-2xl border border-paper-300 ${style.tint} hover:brightness-95 active:brightness-90 transition-all overflow-hidden flex items-stretch`}
                aria-label={t('active.listCardAria', {
                  address: addressLine,
                  status: hasExpiry ? countdown!.label : elapsed!.label,
                })}
              >
                {/* Coloured urgency stripe — at-a-glance grammar matches the home card */}
                <div className={`${style.stripe} w-1.5 shrink-0`} aria-hidden />
                <div className="flex-1 min-w-0 p-4 flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl bg-white flex items-center justify-center shrink-0 ${style.text}`}
                  >
                    <Icon name="pin" className="w-5 h-5" strokeWidth={2.25} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-display text-base font-bold text-ink-900 truncate leading-tight">
                      {addressLine}
                    </p>
                    <p className={`text-sm font-semibold mt-0.5 ${style.text}`}>
                      {hasExpiry ? countdown!.label : elapsed!.label}
                    </p>
                    <p className="text-xs text-ink-600 mt-0.5">
                      {hasExpiry
                        ? t('active.moveBy', { time: expiryLabel!.combined })
                        : t('active.noPostedRestrictions')}
                    </p>
                  </div>
                  <Icon
                    name="check"
                    className="w-4 h-4 text-ink-500 rotate-[-45deg] shrink-0"
                    strokeWidth={2}
                  />
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
