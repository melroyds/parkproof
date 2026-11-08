import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { getWorkday, isActiveRecord } from '../lib/storage'
import { formatInZone } from '../lib/time-format'
import { sessionTimezone } from '../lib/timezone'
import { useLiveRecords, useRecordsVersion } from '../lib/use-records-version'
import { workdayLegs } from '../lib/workday'
import { legTaggedLater, stopNumber } from '../lib/workday-flow'
import Icon from './Icon'
import WorkdayPdfExport from './WorkdayPdfExport'
import BackButton from './ui/BackButton'

interface Props {
  workdayId: string
  onBack: () => void
  /** The back link's label: "← Home" from the home card, "← Back to history" from History. */
  backLabelKey: 'common.backToHome' | 'common.backToHistory'
  /** Open one stop's record screen. */
  onOpenStop: (leg: ParkingSession) => void
  /** "End workday", offered while the workday is active on this device. */
  onEnd?: () => void
}

/**
 * One workday (build spec T6b item 5): when it started and ended (phone
 * clock), and every stop in order, each opening its record screen. The
 * stops are ordinary records carrying the workday's id, so a workday whose
 * state isn't on this device (its stops came from the driver's cloud copy)
 * still lists them. A first stop that was an earlier park says its signed
 * details don't mention the workday.
 */
export default function WorkdayView({ workdayId, onBack, backLabelKey, onOpenStop, onEnd }: Props) {
  const { t } = useTranslation()
  const sessions = useLiveRecords()
  const version = useRecordsVersion()
  // The workday's state (on this device only), re-read when anything changes.
  const workday = useMemo(() => {
    void version
    return getWorkday(workdayId)
  }, [workdayId, version])
  const legs = useMemo(() => workdayLegs(sessions, workdayId), [sessions, workdayId])
  const zone = sessionTimezone(legs[0]?.location ?? null)
  const active = workday ? workday.status !== 'ended' : legs.some((l) => isActiveRecord(l))
  // When the workday started, from its state on this device only. Its stops
  // can come from the cloud without it; the first stop's arrival is not the
  // workday's start (it may be an earlier park), so then there is no line.
  const startedAt = workday?.started_at ?? null

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <BackButton onClick={onBack}>{t(backLabelKey)}</BackButton>

      <h2 className="font-display text-3xl font-extrabold text-paper-50 mb-1">{t('workday.view.title')}</h2>
      <div className="text-sm mb-6 leading-relaxed" style={{ color: '#A9CFBE' }}>
        {startedAt && <p>{t('workday.view.started', { time: formatInZone(startedAt, zone) })}</p>}
        {workday?.ended_at ? (
          <p>{t('workday.view.ended', { time: formatInZone(workday.ended_at, zone) })}</p>
        ) : (
          <p className="font-semibold text-[#7BE3A4]">{active ? t('workday.status.active') : t('workday.status.ended')}</p>
        )}
      </div>

      {/* The workday record PDF (T6c): a leg picker, then downloadWorkdayPdf.
          Renders nothing with workday mode off. */}
      <WorkdayPdfExport legs={legs} workday={workday} />

      <h3 className="text-xs uppercase tracking-widest font-semibold mb-2" style={{ color: '#A9CFBE' }}>
        {t('workday.view.stopsHeading')}
      </h3>
      {legs.length === 0 ? (
        <p className="text-sm text-paper-50">{t('workday.view.noStops')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {legs.map((leg) => {
            const tz = sessionTimezone(leg.location)
            const number = stopNumber(leg)
            return (
              <li key={leg.id}>
                <button
                  type="button"
                  onClick={() => onOpenStop(leg)}
                  className="gf-card w-full text-left bg-white hover:bg-paper-50 p-4 min-h-[44px] transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className="w-9 h-9 rounded-full bg-brand-50 text-brand-800 font-display font-bold flex items-center justify-center shrink-0">
                      {number}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink-900">{t('workday.card.stop', { number })}</p>
                      {leg.location?.address && <p className="text-xs text-ink-700 mt-0.5 truncate">{leg.location.address}</p>}
                      <p className="text-xs text-ink-600 mt-0.5">
                        {t('session.arrived', { when: formatInZone(leg.arrived_at, tz) })}
                      </p>
                      {leg.ended_at && (
                        <p className="text-xs text-ink-600 mt-0.5">
                          {t('departure.tapped', { time: formatInZone(leg.ended_at, tz) })}
                        </p>
                      )}
                      {legTaggedLater(leg) && (
                        <p className="text-xs text-ink-600 mt-1 italic leading-relaxed">{t('workday.view.tagged')}</p>
                      )}
                    </div>
                    <Icon name="chevron" className="w-5 h-5 text-ink-400 -rotate-90 shrink-0 mt-2" />
                  </div>
                </button>
              </li>
            )
          })}
        </ol>
      )}

      {active && onEnd && workday && workday.status !== 'ended' && (
        <button
          type="button"
          onClick={onEnd}
          aria-haspopup="dialog"
          className="mt-6 w-full min-h-[44px] bg-white/10 hover:bg-white/20 text-paper-50 font-semibold text-sm rounded-xl transition-colors"
        >
          {t('workday.card.end')}
        </button>
      )}
    </div>
  )
}
