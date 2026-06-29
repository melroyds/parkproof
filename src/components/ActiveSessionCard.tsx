import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { formatCountdownLocalized, formatElapsedLocalized } from '../lib/countdown'
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
  /**
   * Tapped when the user wants to re-verify "am I still legal?" without walking
   * back to the sign. Runs the smart re-scan (text-only refresh) on this
   * session's prior reading. Only meaningful for sign-bearing sessions, so the
   * card hides the button for no-sign / photo-less sessions.
   */
  onRecheck?: (session: ParkingSession) => void
}

/**
 * Per-urgency styling. The calm/normal tier is now a translucent "glass" panel
 * that sits on the dark-vault home surface — premium register A. Its countdown
 * numerals glow mint (the jewel). Amber + red urgency tiers stay as genuine
 * solid warning/stop hues for the <=60min / <=15min / expired boundaries, with
 * white numerals for contrast — urgency must never be muted into glass.
 *
 * `glass` flags the normal tier so the JSX can opt the numerals + live dot into
 * mint and apply the inline translucent panel style.
 */
const URGENCY_STYLES = {
  normal: {
    surface: '',
    glass: true,
    iconRing: 'bg-white/10',
  },
  warning: {
    surface: 'bg-amber-700',
    glass: false,
    iconRing: 'bg-white/25',
  },
  urgent: {
    surface: 'bg-red-700',
    glass: false,
    iconRing: 'bg-white/20',
  },
  expired: {
    surface: 'bg-ink-900',
    glass: false,
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
  onRecheck,
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
  // Localized variant — gives us "{{hours}}h {{mins}}m left" translated to
  // the active locale (zh-CN renders "剩余 {{hours}} 小时 {{mins}} 分钟" etc).
  // Was previously the legacy English-only formatCountdown, which left the
  // word "left" untranslated on every non-English home screen.
  const countdown = hasExpiry ? formatCountdownLocalized((expiresMs as number) - now, t) : null
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
          aria-label={t('active.morePillAria', { count: extraCount })}
          className="absolute top-3 right-3 text-2xs font-semibold uppercase tracking-wider bg-white/20 hover:bg-white/30 active:bg-white/25 rounded-full px-2.5 min-h-[44px] min-w-[44px] inline-flex items-center justify-center transition-colors shrink-0"
        >
          {t('active.morePill', { count: extraCount })}
        </button>
      ) : (
        // Render as a non-interactive badge when no handler is wired in — keeps
        // the count visible without pretending to be tappable.
        <span
          aria-hidden
          className="absolute top-5 right-5 text-2xs font-semibold uppercase tracking-wider bg-white/20 rounded-full px-2.5 py-1 shrink-0"
        >
          {t('active.morePill', { count: extraCount })}
        </span>
      )
    ) : null

  return (
    <div
      className={`w-full rounded-2xl p-5 text-white relative border ${style.surface}`}
      style={
        style.glass
          ? {
              background: 'rgba(255,255,255,0.055)',
              borderColor: 'rgba(123,227,164,0.22)',
            }
          : { borderColor: 'transparent' }
      }
    >
      {morePill}
      {/* Top region — primary tap target = view session details. Right-pad
          the heading text when the pill is present so they don't collide. */}
      <button
        type="button"
        onClick={() => onOpen(session)}
        className="w-full text-left rounded-xl -m-1 p-1 transition-transform active:scale-[0.99]"
        aria-label={t('active.cardAria', {
          address: addressLine,
          status: hasExpiry ? countdown!.label : elapsed!.label,
        })}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${style.iconRing}`}
          >
            <Icon name="pin" className="w-6 h-6" strokeWidth={2.25} />
          </div>
          <div className={`flex-1 min-w-0 ${extraCount > 0 ? 'pr-16' : ''}`}>
            <p className="text-xs font-semibold uppercase tracking-widest text-white inline-flex items-center gap-1.5">
              {/* Pulsing live-indicator dot, matched to the urgency colour
                  via white-on-gradient. The card is the most-glanced surface
                  for a parked user — a static "CURRENTLY PARKED" reads as
                  stale even when the countdown below is ticking. The dot's
                  ping animation says "this is a live session, the data
                  underneath is moving." Reduced-motion users get the
                  static dot via the global media query in index.css. */}
              <span className="relative flex w-2 h-2">
                <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-[ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite] ${style.glass ? 'bg-[#7BE3A4]' : 'bg-white'}`} />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${style.glass ? 'bg-[#7BE3A4]' : 'bg-white'}`} />
              </span>
              {t('active.currentlyParked')}
            </p>
            <p className="font-display text-base font-bold leading-tight truncate mt-0.5">
              {addressLine}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <p
            className={`font-display tnum text-3xl font-extrabold tracking-tight ${style.glass ? 'text-[#7BE3A4]' : ''}`}
            style={style.glass ? { textShadow: '0 0 18px rgba(123,227,164,0.45)' } : undefined}
          >
            {hasExpiry ? countdown!.label : elapsed!.label}
          </p>
          <p className="mt-1 text-sm text-white font-semibold">
            {hasExpiry
              ? t('active.moveBy', { time: expiryLabel!.combined })
              : t('active.noPostedRestrictions')}
          </p>
          {/* "🔔 Next ping: 4:25 PM" — closes the visibility gap the user
              flagged: previously, after setting reminders, the only way to
              see WHEN they'd fire was opening the calendar app. Now the
              soonest future scheduled push is visible right on the most-
              glanced surface. Hidden when no future reminders are queued. */}
          {(() => {
            if (!session.push_reminders || session.push_reminders.length === 0)
              return null
            const upcoming = session.push_reminders
              .map((r) => new Date(r.fire_at))
              .filter((d) => Number.isFinite(d.getTime()) && d.getTime() > now)
              .sort((a, b) => a.getTime() - b.getTime())[0]
            if (!upcoming) return null
            const label = formatExpiryAbsolute(upcoming, {
              now: new Date(now),
              timeZone,
            }).combined
            return (
              <p className="mt-1 text-xs text-white font-medium inline-flex items-center gap-1">
                <Icon name="bell" className="w-3 h-3" strokeWidth={2.25} />
                {t('active.nextPing', { when: label })}
              </p>
            )
          })()}
        </div>
      </button>

      {/* Re-check now — delivers the landing page's "one-tap re-check ... no
          walking back to the sign" promise from the most-glanced surface,
          instead of burying it three taps deep inside the scan screen. Only
          for sign-bearing sessions: the smart re-scan reuses the prior sign
          reading, which no-sign / photo-less sessions don't have. */}
      {onRecheck && session.sign_photo && !session.no_sign && (
        <button
          type="button"
          onClick={() => onRecheck(session)}
          aria-label={t('active.recheckSub')}
          className="mt-4 w-full bg-white/20 hover:bg-white/30 active:bg-white/25 text-white font-semibold text-sm px-4 py-2.5 rounded-xl transition-colors inline-flex items-center justify-center gap-2"
        >
          <Icon name="camera" className="w-4 h-4" strokeWidth={2.25} />
          {t('active.recheckNow')}
        </button>
      )}

      {/* Walk-back footer — distance + deep-link to navigation app. Anchor
          element so screen readers announce it as a link and the click opens
          the user's default maps app rather than a new tab. */}
      {mapsUrl && (
        <div className="mt-4 pt-4 border-t border-white/20 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            {walkBackVisible ? (
              <>
                <p className="font-display tnum text-lg font-bold leading-none">
                  {t('active.distanceAway', { distance: walkBack!.distanceLabel })}
                </p>
                <p className="text-xs text-white mt-1">
                  {t('active.walkMinutes', { count: walkBack!.minutes })}
                </p>
              </>
            ) : (
              <>
                <p className="font-display text-base font-bold leading-tight">
                  {t('active.walkBack')}
                </p>
                <p className="text-xs text-white mt-0.5">
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
            className="text-white hover:text-white text-xs font-semibold uppercase tracking-wider px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/15 transition-colors inline-flex items-center gap-1.5"
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
