import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { formatCountdown } from '../lib/countdown'
import { useNow } from '../lib/use-now'
import { formatExpiryAbsolute } from '../lib/time-format'
import { sessionTimezone } from '../lib/timezone'
import { estimateWalkBack, navigationUrl, type WalkBackEstimate } from '../lib/walk-back'
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

/**
 * Best-effort current-position fetch with a short timeout and cached fallback.
 * If the browser denies or times out, returns null — the card then hides the
 * distance line but the deep-link button still works (navigation app handles
 * the routing once it has the user's location).
 */
function useCurrentPosition(): { lat: number; lng: number } | null {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return
    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!cancelled) setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      // Silent failure — the card degrades gracefully without coords.
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    )
    return () => {
      cancelled = true
    }
  }, [])
  return coords
}

export default function ActiveSessionCard({ session, extraCount, onOpen }: Props) {
  const { t } = useTranslation()
  // 30s tick is enough granularity for minute-level countdowns; the totalMinutes
  // value only ever shifts by ±1 per tick at the boundary, which matches what a
  // human glancing at the card cares about.
  const now = useNow(30_000)
  const currentPosition = useCurrentPosition()

  if (!session.expires_at) return null
  const expiresMs = new Date(session.expires_at).getTime()
  const countdown = formatCountdown(expiresMs - now)
  const style = URGENCY_STYLES[countdown.urgency]
  // Date-aware: same day → "Move by 3:45 pm"; multi-day → "Move by 10:00 am, Mon 18/05/2026"
  // TZ pinned to the parking spot's location, not the user's current device locale.
  const timeZone = sessionTimezone(session.location)
  const expiryLabel = formatExpiryAbsolute(session.expires_at, {
    now: new Date(now),
    timeZone,
  })

  const addressLine =
    session.location?.address ??
    (session.location
      ? `${session.location.lat.toFixed(4)}, ${session.location.lng.toFixed(4)}`
      : 'Last logged spot')

  // Only show a useful walk-back when we have both the user's current position
  // AND the session's saved location.
  const walkBack: WalkBackEstimate | null = currentPosition
    ? estimateWalkBack(session, currentPosition)
    : null
  // Hide the line at very small distances (≤30m) — "you're basically there"
  // doesn't need its own UI element.
  const walkBackVisible = walkBack && walkBack.distanceMeters > 30
  const mapsUrl = navigationUrl(session)

  return (
    <div
      className={`w-full rounded-3xl p-5 text-white shadow-xl ${style.surface}`}
    >
      {/* Top region — primary tap target = view session details */}
      <button
        type="button"
        onClick={() => onOpen(session)}
        className="w-full text-left rounded-xl -m-1 p-1 transition-transform active:scale-[0.99]"
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
              {t('active.currentlyParked')}
            </p>
            <p className="font-display text-base font-bold leading-tight truncate mt-0.5">
              {addressLine}
            </p>
          </div>
          {extraCount > 0 && (
            <span className="text-[10px] font-semibold uppercase tracking-wider bg-white/20 rounded-full px-2 py-0.5 shrink-0">
              {t('active.morePill', { count: extraCount })}
            </span>
          )}
        </div>

        <div className="mt-4">
          <p className="font-display text-3xl font-extrabold tracking-tight">
            {countdown.label}
          </p>
          <p className="mt-1 text-sm text-white/90 font-semibold">
            {t('active.moveBy', { time: expiryLabel.combined })}
          </p>
        </div>
      </button>

      {/* Walk-back footer — distance + deep-link to navigation app. Anchor
          element so screen readers announce it as a link and the click opens
          the user's default maps app rather than a new tab. */}
      {mapsUrl && (
        <div className="mt-4 pt-4 border-t border-white/20 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {walkBackVisible ? (
              <>
                <p className="font-display text-lg font-bold leading-none">
                  {t('active.distanceAway', { distance: walkBack!.distanceLabel })}
                </p>
                <p className="text-xs text-white/85 mt-1">
                  {t('active.walkMinutes', { count: walkBack!.minutes })}
                </p>
              </>
            ) : (
              <>
                <p className="font-display text-base font-bold leading-tight">
                  {t('active.walkBack')}
                </p>
                <p className="text-xs text-white/75 mt-0.5">
                  {walkBack
                    ? t('active.alreadyThere')
                    : t('active.walkBackOpens')}
                </p>
              </>
            )}
          </div>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="bg-white/20 hover:bg-white/30 active:bg-white/25 text-white font-semibold text-sm px-4 py-2.5 rounded-xl whitespace-nowrap transition-colors"
            aria-label={
              walkBackVisible
                ? `Open walking directions to your car (${walkBack!.distanceLabel}, about ${walkBack!.minutesLabel})`
                : 'Open walking directions to your car'
            }
          >
            {t('active.walkBackButton')}
          </a>
        </div>
      )}
    </div>
  )
}
