import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { stretchInAreaMode, workdayLegs } from '../lib/workday'
import { workdayCalendarReminders, type WorkdayReadiness } from '../lib/workday-flow'
import { loadSessions } from '../lib/storage'
import Icon from './Icon'

/** The detail line under "Workday reminders need notifications", by reason. */
const DETAIL_KEYS: Partial<Record<WorkdayReadiness, string>> = {
  ask: 'workday.ready.ask',
  ios_install: 'workday.ready.iosInstall',
  denied: 'workday.ready.denied',
  turned_off: 'workday.ready.turnedOff',
}

type Tone = 'paper' | 'vault'

interface Props {
  readiness: WorkdayReadiness
  /** "Turn on notifications" (asks the browser, inside the tap). Shown while readiness is 'ask'. */
  onAllow?: () => void | Promise<void>
  /**
   * The stop whose calendar file is offered while reminders can't be
   * delivered: the same alarms as the push reminders (T6b item 2). No
   * button without one, or when its time limit has passed.
   */
  calendarLeg?: ParkingSession | null
  /** 'paper' on a white card (start screen), 'vault' on the dark home card. */
  tone?: Tone
  /** The full block (start screen) or only what's needed when reminders can't be delivered (home card). */
  compact?: boolean
}

/**
 * Whether workday reminders can reach the driver (build spec T6b item 2):
 * push support and permission, and Home Screen install on an iPhone. When
 * they can't, it says so in the spec's words and offers the stop's calendar
 * file with the same alarms. Notifications not allowed yet ('ask') counts:
 * nothing reaches the phone until the driver turns them on, so the spec's
 * line shows with the "Turn on notifications" button under it. The
 * reliability line goes with every reminder feature.
 */
export default function WorkdayReadinessNote({ readiness, onAllow, calendarLeg = null, tone = 'paper', compact = false }: Props) {
  const { t } = useTranslation()
  const [asking, setAsking] = useState(false)
  const ready = readiness === 'ready'
  const muted = tone === 'paper' ? 'text-ink-700' : 'text-[#A9CFBE]'
  const strong = tone === 'paper' ? 'text-ink-900' : 'text-paper-50'

  if (compact && ready) return null

  const allow = async () => {
    if (!onAllow || asking) return
    setAsking(true)
    try {
      await onAllow()
    } finally {
      setAsking(false)
    }
  }

  const detailKey = DETAIL_KEYS[readiness]
  return (
    <div className="flex flex-col gap-2">
      {ready ? (
        <p className={`text-sm leading-relaxed ${strong}`}>{t('workday.ready.on')}</p>
      ) : (
        <>
          <p role={compact ? undefined : 'status'} className={`text-sm font-semibold leading-relaxed ${strong}`}>
            {t('workday.ready.cantDeliver')}
          </p>
          {detailKey && <p className={`text-xs leading-relaxed ${muted}`}>{t(detailKey)}</p>}
          {readiness === 'ask' && onAllow && (
            <button
              type="button"
              onClick={() => void allow()}
              disabled={asking}
              className="self-start min-h-[44px] inline-flex items-center gap-2 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white text-sm font-semibold transition-colors"
            >
              <Icon name="bell" className="w-4 h-4" strokeWidth={2.25} />
              {t('workday.ready.allow')}
            </button>
          )}
        </>
      )}
      {!ready && calendarLeg && <WorkdayCalendarButton leg={calendarLeg} tone={tone} />}
      {!compact && <p className={`text-xs leading-relaxed ${muted}`}>{t('reminders.reliability')}</p>}
    </div>
  )
}

/**
 * "Add calendar reminders for this stop": the stop's .ics with the same
 * alarms as its push reminders (T6b item 2), for when they can't reach the
 * phone, or couldn't be set. Nothing when the stop's limit has passed.
 */
export function WorkdayCalendarButton({ leg, tone = 'paper' }: { leg: ParkingSession; tone?: Tone }) {
  const { t } = useTranslation()
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const reminders = workdayCalendarReminders(leg)
  if (reminders.length === 0) return null

  const addToCalendar = async () => {
    setCalendarError(null)
    try {
      // Under an area limit carried over from an earlier stop, the
      // calendar text names the whole area, as the push reminders do.
      const legs = leg.workday_id ? workdayLegs(loadSessions(), leg.workday_id) : [leg]
      // Loaded on tap, as ReminderOptions does, so the calendar library
      // (ics, with yup and nanoid) stays out of the main bundle.
      const { downloadWorkdayLegIcs } = await import('../lib/ics')
      downloadWorkdayLegIcs(leg, workdayCalendarReminders(leg), t, {
        area_mode: stretchInAreaMode(legs.length ? legs : [leg]),
      })
    } catch (err) {
      console.warn('[workday] could not make the calendar file:', err)
      setCalendarError(t('errors.somethingWrong'))
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void addToCalendar()}
        className={`self-start min-h-[44px] inline-flex items-center gap-2 px-4 rounded-xl text-sm font-semibold transition-colors ${
          tone === 'paper'
            ? 'bg-white border border-paper-300 hover:border-brand-500 text-ink-900'
            : 'bg-white/20 hover:bg-white/30 active:bg-white/25 text-white'
        }`}
      >
        <Icon name="calendar" className="w-4 h-4" strokeWidth={2.25} />
        {t('workday.ics.button')}
      </button>
      {calendarError && (
        <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {calendarError}
        </p>
      )}
    </>
  )
}
