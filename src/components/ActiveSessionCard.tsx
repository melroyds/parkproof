import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { formatCountdown, formatElapsedLocalized } from '../lib/countdown'
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
  /**
   * Tapped when the "+N more" pill is clicked. Required when `extraCount > 0`;
   * without it the pill renders as a non-interactive badge (still informative,
   * but no longer a UX lie pretending to be a tap target).
   */
  onShowMore?: () => void
  /**
   * Tapped when the user signals "I've left". The card calls this with the
   * session ID; App.tsx handles the actual storage + cloud mirror so the
   * card stays pure-presentation.
   */
  onEndSession?: (session: ParkingSession) => void
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

export default function ActiveSessionCard({
  session,
  extraCount,
  onOpen,
  onShowMore,
  onEndSession,
}: Props) {
  const { t } = useTranslation()
  // 30s tick is enough granularity for minute-level countdowns; the totalMinutes
  // value only ever shifts by ±1 per tick at the boundary, which matches what a
  // human glancing at the card cares about.
  const now = useNow(30_000)
  const currentPosition = useCurrentPosition()

  // Two flavours of active session:
  //  - expiry-bearing: countdown + "Move by" line, traditional urgency colours
  //  - open-ended (no-sign, no expires_at): elapsed time + "no posted restrictions",
  //    always rendered in the neutral 'normal' colour because there's no urgency
  const hasExpiry = !!session.expires_at
  const expiresMs = hasExpiry ? new Date(session.expires_at as string).getTime() : null
  const countdown = hasExpiry ? formatCountdown((expiresMs as number) - now) : null
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

  // The `+N more` affordance has to live OUTSIDE the outer "open details" button —
  // a button-inside-button is invalid HTML AND silently makes the pill un-clickable
  // (the outer button swallows the event). Absolute-positioning over the top-right
  // gives us the same visual layout while keeping the two tap targets independent.
  const morePill =
    extraCount > 0 ? (
      onShowMore ? (
        <button
          type="button"
          onClick={onShowMore}
          aria-label={t('active.morePillAria', { count: extraCount, defaultValue: 'View {{count}} more active session' })}
          className="absolute top-5 right-5 text-[10px] font-semibold uppercase tracking-wider bg-white/20 hover:bg-white/30 active:bg-white/25 rounded-full px-2.5 py-1 transition-colors shrink-0"
        >
          {t('active.morePill', { count: extraCount })}
        </button>
      ) : (
        // Render as a non-interactive badge when no handler is wired in — keeps
        // the count visible without pretending to be tappable.
        <span
          aria-hidden
          className="absolute top-5 right-5 text-[10px] font-semibold uppercase tracking-wider bg-white/20 rounded-full px-2.5 py-1 shrink-0"
        >
          {t('active.morePill', { count: extraCount })}
        </span>
      )
    ) : null

  return (
    <div
      className={`w-full rounded-3xl p-5 text-white shadow-xl relative ${style.surface}`}
    >
      {morePill}
      {/* Top region — primary tap target = view session details. Right-pad
          the heading text when the pill is present so they don't collide. */}
      <button
        type="button"
        onClick={() => onOpen(session)}
        className="w-full text-left rounded-xl -m-1 p-1 transition-transform active:scale-[0.99]"
        aria-label={`Active parking session at ${addressLine}, ${hasExpiry ? countdown!.label : elapsed!.label}. Tap for details.`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${style.iconRing}`}
          >
            <Icon name="pin" className="w-6 h-6" strokeWidth={2.25} />
          </div>
          <div className={`flex-1 min-w-0 ${extraCount > 0 ? 'pr-16' : ''}`}>
            <p className="text-xs font-semibold uppercase tracking-widest text-white/80">
              {t('active.currentlyParked')}
            </p>
            <p className="font-display text-base font-bold leading-tight truncate mt-0.5">
              {addressLine}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <p className="font-display text-3xl font-extrabold tracking-tight">
            {hasExpiry ? countdown!.label : elapsed!.label}
          </p>
          <p className="mt-1 text-sm text-white/90 font-semibold">
            {hasExpiry
              ? t('active.moveBy', { time: expiryLabel!.combined })
              : t('active.noPostedRestrictions')}
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

      {/* "I've left" — explicit end-of-session affordance. Required for
          no-sign sessions (they have no natural expiry) but useful on
          expiry-bearing sessions too when the user leaves early. Sits below
          walk-back so it's discoverable without competing with the more-
          frequent "find my car" intent. confirm() rather than a full modal
          because the action is undoable (the session record stays in
          history, just with ended_at set). */}
      {onEndSession && (
        <div
          className={`flex justify-end ${
            mapsUrl ? 'mt-3 pt-3 border-t border-white/20' : 'mt-4 pt-4 border-t border-white/20'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              if (window.confirm(t('active.iveLeftConfirm'))) {
                onEndSession(session)
              }
            }}
            className="text-white/90 hover:text-white text-xs font-semibold uppercase tracking-wider px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/15 transition-colors inline-flex items-center gap-1.5"
            aria-label={t('active.iveLeftAria')}
          >
            <Icon name="check" className="w-3.5 h-3.5" strokeWidth={2.5} />
            {t('active.iveLeft')}
          </button>
        </div>
      )}
    </div>
  )
}
