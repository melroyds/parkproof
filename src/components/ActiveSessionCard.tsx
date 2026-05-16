import type { ParkingSession } from '../types'
import { formatCountdown } from '../lib/countdown'
import { useNow } from '../lib/use-now'
import Icon from './Icon'

interface Props {
  session: ParkingSession
  /** How many *additional* active sessions exist beyond this one. 0 hides the pill. */
  extraCount: number
  onOpen: (session: ParkingSession) => void
}

/**
 * Per-urgency styling. We use the same Emerald/Amber/Red palette as the answer
 * card on ParkingResult so the colour grammar stays consistent ("green = go,
 * red = stop") — distinct from brand-* / accent-* which mean "ParkProof"
 * rather than "is parking OK right now".
 */
const URGENCY_STYLES = {
  normal: {
    surface: 'bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-emerald-600/30',
    iconRing: 'bg-white/20',
  },
  warning: {
    surface: 'bg-gradient-to-br from-amber-400 to-amber-600 shadow-amber-500/30',
    iconRing: 'bg-white/25',
  },
  urgent: {
    surface: 'bg-gradient-to-br from-red-600 to-red-800 shadow-red-600/30',
    iconRing: 'bg-white/20',
  },
  expired: {
    surface: 'bg-gradient-to-br from-ink-700 to-ink-900 shadow-ink-900/40',
    iconRing: 'bg-white/15',
  },
} as const

function fmtExpiry(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Australia/Melbourne',
  })
}

export default function ActiveSessionCard({ session, extraCount, onOpen }: Props) {
  // 30s tick is enough granularity for minute-level countdowns; the totalMinutes
  // value only ever shifts by ±1 per tick at the boundary, which matches what a
  // human glancing at the card cares about.
  const now = useNow(30_000)
  if (!session.expires_at) return null
  const expiresMs = new Date(session.expires_at).getTime()
  const countdown = formatCountdown(expiresMs - now)
  const style = URGENCY_STYLES[countdown.urgency]

  const addressLine =
    session.location?.address ??
    (session.location
      ? `${session.location.lat.toFixed(4)}, ${session.location.lng.toFixed(4)}`
      : 'Last logged spot')

  return (
    <button
      onClick={() => onOpen(session)}
      className={`w-full text-left rounded-3xl p-5 text-white shadow-xl transition-transform active:scale-[0.98] ${style.surface}`}
      aria-label={`Active parking session at ${addressLine}, ${countdown.label}. Tap for details.`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${style.iconRing}`}
        >
          <Icon name="pin" className="w-6 h-6" strokeWidth={2.25} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-white/80">
            Currently parked
          </p>
          <p className="font-display text-base font-bold leading-tight truncate mt-0.5">
            {addressLine}
          </p>
        </div>
        {extraCount > 0 && (
          <span className="text-[10px] font-semibold uppercase tracking-wider bg-white/20 rounded-full px-2 py-0.5 shrink-0">
            +{extraCount} more
          </span>
        )}
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-3">
        <p className="font-display text-3xl font-extrabold tracking-tight">
          {countdown.label}
        </p>
        <p className="text-sm text-white/90 font-semibold whitespace-nowrap">
          Move by {fmtExpiry(session.expires_at)}
        </p>
      </div>

      <p className="mt-3 text-xs text-white/75 inline-flex items-center gap-1.5">
        Tap for evidence record
        <span aria-hidden>→</span>
      </p>
    </button>
  )
}
