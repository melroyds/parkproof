import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Jurisdiction, ParkingSession } from '../types'
import { requestDepartureFix, type DepartureFixRequest } from '../lib/departure'
import { reverseGeocodeDetails, type ReverseGeocodeDetails } from '../lib/geocode'
import { subscribeToPush } from '../lib/push'
import { readinessEnvNow, useWorkdayReadiness } from '../lib/use-workday-readiness'
import { firstStopOffer, startGateFor, type ReadinessEnv, type StartGate } from '../lib/workday-flow'
import WorkdayReadinessNote from './WorkdayReadinessNote'
import Icon from './Icon'
import Button from './ui/Button'
import BackButton from './ui/BackButton'
import Card from './ui/Card'

/** What App needs to start the workday: where (from the start fix) and the first stop, if any. */
export interface WorkdayStartInput {
  jurisdiction: Jurisdiction
  /** The active record that becomes leg 0 ("Use the car's current park as the first stop"), or null. */
  firstStopId: string | null
}

interface Props {
  /** The record home shows as active right now (its main card), or null. */
  activeRecord: ParkingSession | null
  /** No workday has been started on this device yet: the explainer is shown in full. */
  firstWorkday: boolean
  onStart: (input: WorkdayStartInput) => void
  onBack: () => void
  /** Tests inject these. Defaults: one high-accuracy GPS fix, the Nominatim lookup, the browser's push state. */
  locate?: () => DepartureFixRequest
  lookup?: (lat: number, lng: number) => Promise<ReverseGeocodeDetails | null>
  readinessEnv?: () => ReadinessEnv
  enableNotifications?: () => Promise<unknown>
}

type Check = { status: 'locating' } | { status: 'done'; gate: StartGate; jurisdiction: Jurisdiction | null }

/**
 * "Start a workday" (build spec T6b items 1 to 4). In this order:
 *   1. A GPS fix and its reverse geocode decide where the phone is. Only
 *      Victoria and Queensland pass. Elsewhere, or when the state can't be
 *      told, nothing below shows and nothing can start.
 *   2. Readiness: can workday reminders reach the driver (push support and
 *      permission, Home Screen on an iPhone)? If not, it says so and offers
 *      the calendar file.
 *   3. The explainer: in full on the first workday, one line after that,
 *      with the reliability line.
 *   4. Start. With a record active, the only way in is "Use the car's
 *      current park as the first stop", so a car that hasn't moved never
 *      gets a new arrival time. A park that can't be a stop says why.
 */
export default function WorkdayStart({
  activeRecord,
  firstWorkday,
  onStart,
  onBack,
  locate = requestDepartureFix,
  lookup = reverseGeocodeDetails,
  readinessEnv = readinessEnvNow,
  enableNotifications = subscribeToPush,
}: Props) {
  const { t } = useTranslation()
  const [attempt, setAttempt] = useState(0)
  const [check, setCheck] = useState<Check>({ status: 'locating' })
  const [readiness, refreshReadiness] = useWorkdayReadiness(readinessEnv)
  const offer = useMemo(() => firstStopOffer(activeRecord), [activeRecord])
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let cancelled = false
    const request = locate()
    void request.settled.then(async (fix) => {
      if (cancelled) return
      // A fix too rough to place (or none at all) can't tell the state:
      // the gate stays shut rather than guess.
      if (fix.status !== 'ok') {
        setCheck({ status: 'done', gate: 'unknown', jurisdiction: null })
        return
      }
      let details: ReverseGeocodeDetails | null
      try {
        details = await lookup(fix.fix.lat, fix.fix.lng)
      } catch {
        details = null
      }
      if (cancelled) return
      setCheck({ status: 'done', ...startGateFor(details?.state_code ?? null) })
    })
    return () => {
      cancelled = true
    }
    // Runs once per attempt ("Retry" bumps it); the injected functions are fixed for the screen's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  const retry = () => {
    setCheck({ status: 'locating' })
    setAttempt((a) => a + 1)
  }

  const allowNotifications = async () => {
    try {
      await enableNotifications()
    } catch (err) {
      console.warn('[workday] could not turn on notifications:', err)
    }
    refreshReadiness()
  }

  const available = check.status === 'done' && check.gate === 'available' && check.jurisdiction !== null
  const start = (firstStopId: string | null) => {
    if (!available || starting || check.status !== 'done' || !check.jurisdiction) return
    setStarting(true)
    onStart({ jurisdiction: check.jurisdiction, firstStopId })
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <BackButton onClick={onBack}>{t('common.back')}</BackButton>

      <h2 className="font-display text-3xl font-extrabold text-paper-50 mb-1">{t('workday.start.title')}</h2>
      <p className="text-sm mb-6 leading-relaxed" style={{ color: '#A9CFBE' }}>
        {t('workday.start.intro')}
      </p>

      {check.status === 'locating' && (
        <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-semibold text-paper-50">
          <span aria-hidden className="relative flex w-4 h-4 items-center justify-center shrink-0">
            <span className="absolute inline-flex h-3 w-3 rounded-full bg-[#7BE3A4] opacity-60 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7BE3A4]" />
          </span>
          {t('workday.start.locating')}
        </p>
      )}

      {check.status === 'done' && check.gate === 'unavailable' && (
        <Card pad="sm">
          <p role="alert" className="text-sm text-ink-900 leading-relaxed">
            {t('workday.start.unavailable')}
          </p>
        </Card>
      )}

      {check.status === 'done' && check.gate === 'unknown' && (
        <Card pad="sm">
          <div className="flex items-start gap-2">
            <Icon name="pin" className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" strokeWidth={2.25} />
            <p role="alert" className="text-sm text-ink-900 leading-relaxed">
              {t('workday.start.unknown')}
            </p>
          </div>
          <button
            type="button"
            onClick={retry}
            className="mt-3 min-h-[44px] inline-flex items-center px-4 rounded-xl bg-white border border-paper-300 hover:border-brand-500 text-ink-900 text-sm font-semibold transition-colors"
          >
            {t('common.retry')}
          </button>
        </Card>
      )}

      {available && (
        <>
          <Card pad="sm" className="mb-3">
            <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-600 mb-1.5">
              {t('workday.explainer.heading')}
            </h3>
            <p className="text-sm text-ink-900 leading-relaxed">
              {firstWorkday ? t('workday.explainer.full') : t('workday.explainer.short')}
            </p>
          </Card>

          <Card pad="sm" className="mb-3">
            <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-600 mb-1.5">
              {t('workday.ready.heading')}
            </h3>
            <WorkdayReadinessNote
              readiness={readiness}
              onAllow={allowNotifications}
              calendarLeg={offer.kind === 'offer' ? offer.session : null}
            />
          </Card>

          <div className="mt-auto pt-3 flex flex-col gap-2">
            {offer.kind === 'offer' ? (
              <>
                <Button onClick={() => start(offer.session.id)} disabled={starting}>
                  {t('workday.start.useCurrent')}
                </Button>
                <p className="text-xs leading-relaxed" style={{ color: '#A9CFBE' }}>
                  {t('workday.start.useCurrentHelp')}
                </p>
              </>
            ) : offer.kind === 'ineligible' ? (
              <Card pad="sm">
                <p role="status" className="text-sm text-ink-900 leading-relaxed">
                  {t('workday.start.currentIneligible')}
                </p>
              </Card>
            ) : (
              <Button onClick={() => start(null)} disabled={starting}>
                {t('workday.start.button')}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
