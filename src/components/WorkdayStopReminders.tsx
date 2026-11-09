import type { ReactNode } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import type { RemindMeSummary } from '../lib/remind-me'
import { formatReminderTimesLine } from '../lib/time-format'
import { workdayLegPlan } from '../lib/workday-reminders'
import type { WorkdayReadiness } from '../lib/workday-flow'
import WorkdayReadinessNote, { WorkdayCalendarButton } from './WorkdayReadinessNote'

interface Props {
  /** The stop the car is at. */
  leg: ParkingSession
  /** The workday's saved legs in leg order (for the area wording). */
  legs: ParkingSession[]
  readiness: WorkdayReadiness
  /** What booking this stop's reminders set, when it was tried in this page; undefined otherwise. */
  summary?: RemindMeSummary | null
  /** Booking this stop's reminders is under way in this page: nothing is said about them yet. */
  booking?: boolean
  /** "Retry" when the stop's reminders aren't booked. */
  onRetry?: () => void
  /**
   * "Turn on notifications" while the browser hasn't been asked: asks inside
   * the tap, then books this stop's reminders.
   */
  onAllow?: () => void | Promise<void>
  timeZone: string
  now: number
}

/**
 * The stop's reminders on the workday card (build spec T6b item 9).
 * Workday stops skip the reminder screen and their reminders are set when
 * the stop is saved, so the card says what was set: the times booked, or
 * that they aren't set (with Retry and the calendar file). When reminders
 * can't reach the phone at all, including before notifications are turned
 * on, it shows the spec's line, the way to turn them on where there is one,
 * and the calendar file instead (item 2). Wherever reminders are set or
 * offered it carries the reliability line.
 */
export default function WorkdayStopReminders({ leg, legs, readiness, summary, booking = false, onRetry, onAllow, timeZone, now }: Props) {
  const { t } = useTranslation()
  const plan = workdayLegPlan(leg, legs, now)
  const ahead = (d: Date) => Number.isFinite(d.getTime()) && d.getTime() > now
  // The push times the server booked, from the record; or, before the record
  // shows them, from the booking just done in this page.
  const stored = (leg.push_reminders ?? []).map((r) => new Date(r.fire_at)).filter(ahead)
  const booked = (stored.length > 0 ? stored : summary?.kind === 'background' ? summary.times.filter(ahead) : []).sort(
    (a, b) => a.getTime() - b.getTime(),
  )
  const planned = plan.reminders.length > 0 || booked.length > 0
  const strong = { strong: <span className="font-semibold text-paper-50" /> }
  const times = (list: Date[]) => formatReminderTimesLine(list, { now: new Date(now), timeZone, t })
  // Notifications work here, but none of this stop's reminders is booked to
  // reach the phone while ParkProof is closed: the booking failed, only the
  // in-tab copies were set, or it was never tried (notifications were turned
  // on after the stop was saved, or this page was reloaded after a failure).
  const notBooked = readiness === 'ready' && !booking && booked.length === 0 && plan.reminders.length > 0

  let status: ReactNode = null
  if (readiness === 'ready') {
    if (booked.length > 0) {
      status = <Trans i18nKey="reminders.remindMe.setBackground" count={booked.length} values={{ times: times(booked) }} components={strong} />
    } else if (summary?.kind === 'openOnly' && notBooked) {
      status = <Trans i18nKey="reminders.remindMe.setOpenOnly" count={summary.times.length} values={{ times: times(summary.times) }} components={strong} />
    } else if (notBooked) {
      status = t('workday.reminders.notSet')
    }
  }

  if (readiness === 'ready' && !planned) return null

  return (
    <div className="mt-4 pt-4 border-t border-white/20 flex flex-col gap-2" data-testid="workday-stop-reminders">
      {readiness !== 'ready' ? (
        <WorkdayReadinessNote readiness={readiness} onAllow={onAllow} calendarLeg={leg} tone="vault" compact />
      ) : (
        <div role="status" aria-live="polite" aria-atomic="true">
          {status && <p className="text-sm text-white leading-relaxed">{status}</p>}
        </div>
      )}
      {notBooked && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="self-start min-h-[44px] inline-flex items-center px-4 rounded-xl bg-white/20 hover:bg-white/30 active:bg-white/25 text-white text-sm font-semibold transition-colors"
        >
          {t('common.retry')}
        </button>
      )}
      {/* Nothing booked to reach the phone: the same alarms as a calendar file (T6b item 2). */}
      {notBooked && <WorkdayCalendarButton leg={leg} tone="vault" />}
      {planned && (
        <p className="text-xs leading-relaxed" style={{ color: '#A9CFBE' }}>
          {t('reminders.reliability')}
        </p>
      )}
    </div>
  )
}
