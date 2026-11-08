import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { formatCountdownLocalized } from '../lib/countdown'
import { useNow } from '../lib/use-now'
import { formatExpiryAbsolute, formatInZone } from '../lib/time-format'
import { sessionTimezone } from '../lib/timezone'
import { navigationUrl } from '../lib/walk-back'
import { WORKDAY_SCAN_ID } from '../lib/focus-targets'
import { stopNumber, type WorkdayHome, type WorkdayReadiness } from '../lib/workday-flow'
import type { RemindMeSummary } from '../lib/remind-me'
import WorkdayStopReminders from './WorkdayStopReminders'
import Icon from './Icon'

interface Props {
  home: WorkdayHome
  /** Whether workday reminders can reach the driver (T6b item 2). Not 'ready': the calendar file is offered. */
  readiness: WorkdayReadiness
  /** Other active records (not this workday's stop), behind the "+N more" pill. */
  extraCount: number
  onShowMore?: () => void
  /** Open the workday view (every stop). */
  onOpen: () => void
  /** "I'm moving the car now": App runs the departure flow for this stop. */
  onMove: (leg: ParkingSession) => void
  /** "Parked again? Scan the new sign" (or the first stop's scan). */
  onScan: () => void
  /** "End workday". */
  onEnd: () => void
  /** "Share where the car is" for the current stop (T7). */
  onShare?: (leg: ParkingSession) => void
  /**
   * What setting the current stop's reminders did, when it was tried in
   * this page (T6b item 9: they are set when the stop is saved).
   */
  reminderSummary?: RemindMeSummary | null
  /** Booking the current stop's reminders is under way in this page. */
  reminderBooking?: boolean
  /** "Retry" when the current stop's reminders aren't booked. */
  onRetryReminders?: () => void
  /** "Turn on notifications" (asks inside the tap, then books the current stop's reminders). */
  onAllowReminders?: () => void | Promise<void>
}

const GLASS = { background: 'rgba(255,255,255,0.055)', borderColor: 'rgba(123,227,164,0.22)' }

/**
 * The workday card (build spec T6b items 5 and 6). It replaces the active
 * card on home while a workday is active, whether or not the stop's limit
 * has passed. Workday stops never offer "Re-check now": a re-check would
 * give a car that hasn't moved a new arrival time. Two states:
 *   - parked: the stop's countdown, and "I'm moving the car now" ("Tap
 *     before you drive off"), which runs the departure flow for the stop;
 *   - moving: "Parked again? Scan the new sign", which opens the scanner
 *     for a fresh photo.
 * "End workday" is always there.
 */
export default function WorkdayCard({
  home,
  readiness,
  extraCount,
  onShowMore,
  onOpen,
  onMove,
  onScan,
  onEnd,
  onShare,
  reminderSummary,
  reminderBooking = false,
  onRetryReminders,
  onAllowReminders,
}: Props) {
  const { t } = useTranslation()
  const now = useNow(30_000)
  const leg = home.currentLeg
  const parked = home.phase === 'parked' && leg !== null
  const timeZone = sessionTimezone(leg?.location ?? null)
  const number = leg ? stopNumber(leg) : null

  const expiresMs = parked && leg.expires_at ? Date.parse(leg.expires_at) : NaN
  const hasExpiry = Number.isFinite(expiresMs)
  const countdown = hasExpiry ? formatCountdownLocalized(expiresMs - now, t) : null
  const expiry = hasExpiry ? formatExpiryAbsolute(leg!.expires_at as string, { now: new Date(now), timeZone }) : null
  const isExpired = countdown?.urgency === 'expired'
  const urgent = countdown && countdown.urgency !== 'normal'
  const surface = isExpired ? 'bg-ink-900' : countdown?.urgency === 'urgent' ? 'bg-red-700' : countdown?.urgency === 'warning' ? 'bg-amber-700' : ''

  const address =
    leg?.location?.address ??
    (leg?.location ? `${leg.location.lat.toFixed(4)}, ${leg.location.lng.toFixed(4)}` : t('active.lastLoggedSpot'))
  const status = parked
    ? isExpired
      ? t('active.expiredAt', { time: expiry!.combined })
      : countdown
        ? countdown.label
        : address
    : home.stops === 0
      ? t('workday.card.noStops')
      : leg?.ended_at && number !== null
        ? t('workday.card.moved', { number, time: formatInZone(leg.ended_at, timeZone, { withDate: false }) })
        : null
  const mapsUrl = parked ? navigationUrl(leg) : null

  return (
    <div
      className={`gf-card-lg w-full p-5 text-white relative ${surface}`}
      style={urgent ? { borderColor: 'transparent' } : GLASS}
      data-testid="workday-card"
    >
      {(extraCount > 0 || (parked && onShare)) && (
        <div className="absolute top-5 right-5 flex items-center gap-2">
          {parked && onShare && (
            <button
              type="button"
              onClick={() => onShare(leg)}
              aria-label={t('share.action')}
              aria-haspopup="dialog"
              className="bg-white/10 hover:bg-white/20 active:bg-white/15 rounded-full min-h-[44px] min-w-[44px] inline-flex items-center justify-center transition-colors shrink-0"
            >
              <Icon name="share" className="w-5 h-5" strokeWidth={2.25} />
            </button>
          )}
          {extraCount > 0 && onShowMore && (
            <button
              type="button"
              onClick={onShowMore}
              aria-label={t('active.morePillAria', { count: extraCount })}
              className="text-2xs font-semibold uppercase tracking-wider bg-white/20 hover:bg-white/30 active:bg-white/25 rounded-full px-2.5 min-h-[44px] min-w-[44px] inline-flex items-center justify-center transition-colors shrink-0"
            >
              {t('active.morePill', { count: extraCount })}
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left rounded-xl -m-1 p-1 transition-transform active:scale-[0.99]"
        aria-label={status ? t('workday.card.openAria', { status }) : t('workday.card.open')}
      >
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-white/10">
            <Icon name="briefcase" className="w-6 h-6" strokeWidth={2.25} />
          </div>
          <div className={`flex-1 min-w-0 ${extraCount > 0 || (parked && onShare) ? 'pr-24' : ''}`}>
            <p className="text-xs font-semibold uppercase tracking-widest text-white inline-flex items-center gap-1.5">
              <span className="relative flex w-2 h-2">
                <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-[ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite] ${urgent ? 'bg-white' : 'bg-[#7BE3A4]'}`} />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${urgent ? 'bg-white' : 'bg-[#7BE3A4]'}`} />
              </span>
              {t('workday.card.kicker')}
              {parked && number !== null && (
                <>
                  <span aria-hidden="true">·</span>
                  {t('workday.card.stop', { number })}
                </>
              )}
            </p>
            {parked && <p className="font-display text-base font-bold leading-tight truncate mt-0.5">{address}</p>}
          </div>
        </div>

        {parked ? (
          <div className="mt-4">
            {countdown && (
              <p
                className={`font-display tnum text-3xl font-extrabold tracking-tight ${urgent ? '' : 'text-[#7BE3A4]'}`}
                style={urgent ? undefined : { textShadow: '0 0 18px rgba(123,227,164,0.45)' }}
              >
                {isExpired ? t('active.expiredAt', { time: expiry!.time }) : countdown.label}
              </p>
            )}
            {isExpired && expiry!.dayDate && <p className="mt-1 text-sm text-white font-semibold tnum">{expiry!.dayDate}</p>}
            <p className="mt-1 text-sm text-white font-semibold">
              {isExpired ? t('workday.card.expiredHint') : expiry ? t('active.moveBy', { time: expiry.combined }) : null}
            </p>
          </div>
        ) : status ? (
          <p className="mt-3 text-sm text-white leading-relaxed">{status}</p>
        ) : null}
      </button>

      {parked ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => onMove(leg)}
            aria-haspopup="dialog"
            aria-describedby="workday-move-hint"
            className="w-full bg-paper-50 hover:bg-white active:bg-paper-100 text-ink-900 font-semibold text-base px-4 py-3 min-h-[44px] rounded-xl transition-colors inline-flex items-center justify-center gap-2"
          >
            <Icon name="pin" className="w-5 h-5" strokeWidth={2.25} />
            {t('workday.card.move')}
          </button>
          <p id="workday-move-hint" className="mt-1.5 text-xs text-white text-center">
            {t('workday.card.moveHint')}
          </p>
        </div>
      ) : (
        <button
          type="button"
          id={WORKDAY_SCAN_ID}
          onClick={onScan}
          className="mt-4 w-full bg-paper-50 hover:bg-white active:bg-paper-100 text-ink-900 font-semibold text-base px-4 py-3 min-h-[44px] rounded-xl transition-colors inline-flex items-center justify-center gap-2"
        >
          <Icon name="camera" className="w-5 h-5" strokeWidth={2.25} />
          {home.stops === 0 ? t('workday.card.scanFirst') : t('workday.card.scanNext')}
        </button>
      )}

      {/* The stop's reminders, set when it was saved (T6b item 9), or why
          they can't reach the phone and the calendar file instead (item 2),
          with the reliability line. */}
      {parked && (
        <WorkdayStopReminders
          leg={leg}
          legs={home.legs}
          readiness={readiness}
          summary={reminderSummary}
          booking={reminderBooking}
          onRetry={onRetryReminders}
          onAllow={onAllowReminders}
          timeZone={timeZone}
          now={now}
        />
      )}

      <div className="mt-4 pt-3 border-t border-white/20 flex items-center justify-between gap-3">
        {mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="bg-white/10 hover:bg-white/20 text-white font-semibold text-xs uppercase tracking-wider px-3 min-h-[44px] rounded-lg inline-flex items-center transition-colors"
            aria-label={t('active.walkBackAria')}
          >
            {t('active.walkBackButton')}
          </a>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onEnd}
          aria-haspopup="dialog"
          className="text-white text-xs font-semibold uppercase tracking-wider px-3 min-h-[44px] rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/15 transition-colors inline-flex items-center gap-1.5"
        >
          {t('workday.card.end')}
        </button>
      </div>
    </div>
  )
}
