import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { scheduleParkingReminders, type ScheduleResult } from '../lib/notifications'
import { useNow } from '../lib/use-now'
import { formatExpiryAbsolute, formatReminderTimesLine } from '../lib/time-format'
import { sessionTimezone } from '../lib/timezone'
import Icon from './Icon'

/**
 * Offsets the user can pick from, in minutes before expiry. Covers the realistic
 * range from a leisurely 30-min "head back to the car" prompt down to a frantic
 * "you're about to time out right now" ping. 0 = exactly at expiry — useful on
 * very short tickets where every other offset is already in the past.
 */
const REMINDER_OFFSETS = [30, 15, 10, 5, 2, 0] as const
type Offset = (typeof REMINDER_OFFSETS)[number]

// If a reminder would fire in under 30s, treat it as past — keeps the UX honest.
// Mirrors SAFETY_MARGIN_MS in notifications.ts.
const SAFETY_MARGIN_MS = 30 * 1000

interface Props {
  session: ParkingSession
  onDone: () => void
}

interface OffsetInfo {
  offset: Offset
  /** Wall-clock time this offset would fire at. */
  fireAt: Date
  /** True if this offset is already past (incl. safety margin). */
  isPast: boolean
}

/** Pick sensible defaults given which offsets are fireable. */
function pickDefaults(fireable: OffsetInfo[]): Set<Offset> {
  if (fireable.length === 0) return new Set()
  // Longest available lead time + the 5-min ping (a useful "final warning") if
  // it's separately fireable. This covers both long tickets (30 + 5) and short
  // ones (e.g., 10 + 5 or just 2 / 0 if that's all that's left).
  const result = new Set<Offset>([fireable[0].offset])
  const five = fireable.find((o) => o.offset === 5)
  if (five && five.offset !== fireable[0].offset) result.add(5)
  return result
}

function NotifStatusLine({ result }: { result: ScheduleResult }) {
  const { t } = useTranslation()
  switch (result.status) {
    case 'scheduled': {
      const skipped = result.totalSelected - result.scheduledCount
      return (
        <span>
          {skipped > 0
            ? t('reminders.browserScheduledSkipped', {
                count: result.scheduledCount,
                skipped,
              })
            : t('reminders.browserScheduled', { count: result.scheduledCount })}
        </span>
      )
    }
    case 'denied':
      return <span>{t('reminders.browserDenied')}</span>
    case 'unsupported':
      return <span>{t('reminders.browserUnsupported')}</span>
    case 'no-expiry':
      return <span>{t('reminders.browserNoExpiry')}</span>
    case 'all-past':
      return <span>{t('reminders.browserAllPast')}</span>
    case 'all-too-far':
      return <span>{t('reminders.browserTooFar')}</span>
    case 'nothing-selected':
      return <span>{t('reminders.browserNothingSelected')}</span>
  }
}

export default function ReminderOptions({ session, onDone }: Props) {
  const { t } = useTranslation()
  const [icsState, setIcsState] = useState<'idle' | 'downloaded' | 'error' | 'empty'>('idle')
  const [notifResult, setNotifResult] = useState<ScheduleResult | null>(null)
  const [notifBusy, setNotifBusy] = useState(false)

  const chipLabel = (offset: Offset): string =>
    offset === 0
      ? t('reminders.chipAtExpiry')
      : t('reminders.chipMin', { count: offset })

  // Re-tick every 30s so chips that slide into the past auto-disable without
  // requiring the user to re-enter the screen. Matches SAFETY_MARGIN_MS exactly,
  // so the moment a chip becomes "fireable in <30s" it flips to disabled.
  const now = useNow(30_000)

  const timeZone = useMemo(() => sessionTimezone(session.location), [session.location])

  const { offsets, expiresLabel, anyFireable } = useMemo(() => {
    if (!session.expires_at) {
      return { offsets: [] as OffsetInfo[], expiresLabel: null as string | null, anyFireable: false }
    }
    const expires = new Date(session.expires_at)
    const nowDate = new Date(now)
    const offsets: OffsetInfo[] = REMINDER_OFFSETS.map((offset) => {
      const fireAt = new Date(expires.getTime() - offset * 60 * 1000)
      return {
        offset,
        fireAt,
        isPast: fireAt.getTime() - now < SAFETY_MARGIN_MS,
      }
    })
    return {
      offsets,
      // "3:45 pm" for today's expiry; "10:00 am, Mon 18/05/2026" for a
      // multi-day-future one. Same rule as the result screen so both
      // surfaces stay consistent. TZ is anchored to the parking spot.
      expiresLabel: formatExpiryAbsolute(expires, { now: nowDate, timeZone }).combined,
      anyFireable: offsets.some((o) => !o.isPast),
    }
  }, [session.expires_at, now, timeZone])

  const [selected, setSelected] = useState<Set<Offset>>(() =>
    pickDefaults(offsets.filter((o) => !o.isPast)),
  )

  const toggle = (offset: Offset) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(offset)) next.delete(offset)
      else next.add(offset)
      return next
    })
    // Any prior submission state is now stale — reset so buttons re-enable.
    setIcsState('idle')
    setNotifResult(null)
  }

  // Sorted highest → lowest so summaries and downstream lists read left-to-right
  // in chronological order ("3:30 PM, 3:40 PM, 3:43 PM").
  const selectedList = useMemo(
    () => [...selected].sort((a, b) => b - a),
    [selected],
  )

  // Reminder summary that says e.g. "9:30 am, 9:45 am" (today) or
  // "9:30 am, 9:45 am on Mon 18/05/2026" (future day). Computed off the
  // selected offsets' fireAt times, in chronological order.
  const selectedFireAtList = useMemo(
    () =>
      selectedList
        .map((o) => offsets.find((x) => x.offset === o))
        .filter((x): x is OffsetInfo => Boolean(x))
        .map((x) => x.fireAt),
    [selectedList, offsets],
  )
  const selectedTimesLabel = useMemo(
    () =>
      selectedFireAtList.length === 0
        ? null
        : formatReminderTimesLine(selectedFireAtList, { now: new Date(now), timeZone }),
    [selectedFireAtList, now, timeZone],
  )

  const handleIcs = async () => {
    if (selectedList.length === 0) {
      setIcsState('empty')
      return
    }
    try {
      const { downloadIcs } = await import('../lib/ics')
      downloadIcs(session, selectedList)
      setIcsState('downloaded')
    } catch {
      setIcsState('error')
    }
  }

  const handleNotify = async () => {
    setNotifBusy(true)
    const result = await scheduleParkingReminders(session, selectedList)
    setNotifResult(result)
    setNotifBusy(false)
  }

  // === Empty states ===
  if (!session.expires_at) {
    return (
      <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
        <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-2">{t('reminders.header')}</h2>
        <p className="text-sm text-ink-700 mb-6 leading-relaxed">
          {t('reminders.noExpiry')}
        </p>
        <button
          onClick={onDone}
          className="mt-auto bg-ink-900 hover:bg-ink-800 text-white font-semibold py-4 rounded-2xl shadow-md transition-colors"
        >
          {t('common.done')}
        </button>
      </div>
    )
  }

  if (!anyFireable) {
    return (
      <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
        <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-2">{t('reminders.header')}</h2>
        <p className="text-sm text-ink-700 mb-6 leading-relaxed">
          {t('reminders.expired', { when: expiresLabel })}
        </p>
        <button
          onClick={onDone}
          className="mt-auto bg-ink-900 hover:bg-ink-800 text-white font-semibold py-4 rounded-2xl shadow-md transition-colors"
        >
          {t('common.done')}
        </button>
      </div>
    )
  }

  // === Main flow ===
  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">{t('reminders.header')}</h2>
      <p className="text-sm text-ink-700 mb-6 leading-relaxed">
        {t('reminders.intro', { when: expiresLabel })}
      </p>

      {/* Chip selector */}
      <div className="flex flex-wrap gap-2 mb-3">
        {offsets.map(({ offset, isPast, fireAt }) => {
          const isSelected = selected.has(offset)
          const base =
            'px-4 py-2 rounded-full text-sm font-semibold border-2 transition-colors min-w-[88px] text-center'
          let cls: string
          if (isPast) {
            cls = `${base} bg-paper-100 border-paper-200 text-ink-400 line-through cursor-not-allowed`
          } else if (isSelected) {
            cls = `${base} bg-brand-500 border-brand-500 text-white shadow-sm shadow-brand-500/30`
          } else {
            cls = `${base} bg-white border-paper-300 text-ink-700 hover:border-brand-300`
          }
          // Date-aware tooltip so a chip for tomorrow says "would fire at
          // 10:00 am, Mon 18/05/2026" rather than the ambiguous "10:00 am".
          const fireDescription = formatExpiryAbsolute(fireAt, {
            now: new Date(now),
            timeZone,
          }).combined
          return (
            <button
              key={offset}
              type="button"
              onClick={() => !isPast && toggle(offset)}
              disabled={isPast}
              aria-pressed={isSelected}
              aria-label={
                isPast
                  ? `${chipLabel(offset)} — already past`
                  : `${chipLabel(offset)} — would fire at ${fireDescription}`
              }
              title={isPast ? 'Already in the past' : `Fires at ${fireDescription}`}
              className={cls}
            >
              {chipLabel(offset)}
            </button>
          )
        })}
      </div>

      {/* Live summary of selected fire-times */}
      <p className="text-xs text-ink-600 mb-6 leading-relaxed min-h-[2.25rem]">
        {selectedTimesLabel ? (
          t('reminders.summaryWithSelections', { times: selectedTimesLabel })
        ) : (
          <span className="italic text-ink-500">
            {t('reminders.summaryEmpty')}
          </span>
        )}
      </p>

      {/* Calendar */}
      <section className="mb-3 bg-white rounded-2xl border border-paper-300 p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
            <Icon name="calendar" className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-display font-bold text-ink-900">{t('reminders.calendarHeader')}</h3>
            <p className="text-xs text-ink-600 mt-1 leading-relaxed">
              {t('reminders.calendarCopy')}
            </p>
          </div>
        </div>
        <button
          onClick={handleIcs}
          disabled={icsState === 'downloaded' || selectedList.length === 0}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:bg-brand-200 disabled:text-white/70 text-white font-semibold py-3 rounded-xl shadow-md shadow-brand-500/20 transition-colors"
        >
          {icsState === 'downloaded'
            ? t('reminders.calendarDownloaded')
            : icsState === 'error'
              ? t('reminders.calendarError')
              : icsState === 'empty'
                ? t('reminders.calendarPickAtLeastOne')
                : t('reminders.calendarCta', { count: selectedList.length })}
        </button>
      </section>

      {/* Push */}
      <section className="mb-6 bg-white rounded-2xl border border-paper-300 p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-accent-50 text-accent-700 flex items-center justify-center shrink-0">
            <Icon name="bell" className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-display font-bold text-ink-900">{t('reminders.browserHeader')}</h3>
            <p className="text-xs text-ink-600 mt-1 leading-relaxed">
              {t('reminders.browserCopy')}
            </p>
          </div>
        </div>
        <button
          onClick={handleNotify}
          disabled={
            notifBusy ||
            notifResult?.status === 'scheduled' ||
            selectedList.length === 0
          }
          className="w-full bg-accent-500 hover:bg-accent-600 disabled:opacity-60 text-white font-semibold py-3 rounded-xl shadow-md shadow-accent-500/20 transition-colors"
        >
          {notifBusy ? (
            <span>{t('reminders.browserRequesting')}</span>
          ) : notifResult ? (
            <NotifStatusLine result={notifResult} />
          ) : selectedList.length === 0 ? (
            <span>{t('reminders.browserNothingSelected')}</span>
          ) : (
            <span>{t('reminders.browserCta', { count: selectedList.length })}</span>
          )}
        </button>
      </section>

      <button
        onClick={onDone}
        className="mt-auto bg-ink-900 hover:bg-ink-800 text-white font-semibold py-4 rounded-2xl shadow-md transition-colors"
      >
        {t('common.done')}
      </button>
    </div>
  )
}
