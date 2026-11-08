import { useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import {
  cancelInTabReminders,
  scheduleAbsoluteReminders,
  scheduleParkingReminders,
} from '../lib/notifications'
import type { ScheduledFire, ScheduledReminder } from '../lib/push'
import { remindMe, summariseRemindMe, type RemindMeSummary } from '../lib/remind-me'
import { useNow } from '../lib/use-now'
import { updateSession } from '../lib/storage'
import { useAuth } from '../lib/use-auth'
import { mirrorSessionUpdateToCloud } from '../lib/sync'
import { formatExpiryAbsolute, formatReminderTimesLine } from '../lib/time-format'
import { reminderCopy } from '../lib/reminder-copy'
import { sessionLink } from '../lib/deep-link'
import { sessionTimezone } from '../lib/timezone'
import { isNoSignReadRecord } from '../lib/sign-result'
import Icon from './Icon'
import Button from './ui/Button'
import Card from './ui/Card'
import { ReminderHelp, RemindMeOutcome } from './ReminderStatus'

/**
 * Offsets the user can pick from, in minutes before expiry. Covers the realistic
 * range from a leisurely 30-min "head back to the car" prompt down to a frantic
 * "you're about to time out right now" ping. 0 = exactly at expiry, useful on
 * very short stays where every other offset is already in the past.
 */
const REMINDER_OFFSETS = [30, 15, 10, 5, 2, 0] as const
type Offset = (typeof REMINDER_OFFSETS)[number]

// If a reminder would fire in under 30s, treat it as past, which keeps the UX
// honest. Mirrors SAFETY_MARGIN_MS in notifications.ts.
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
  // it's separately fireable. This covers both long stays (30 + 5) and short
  // ones (e.g., 10 + 5 or just 2 / 0 if that's all that's left).
  const result = new Set<Offset>([fireable[0].offset])
  const five = fireable.find((o) => o.offset === 5)
  if (five && five.offset !== fireable[0].offset) result.add(5)
  return result
}

/**
 * Store the push reminders the server booked on the record, so the record
 * screen can list them ("Scheduled reminders"), and mirror it when signed in.
 */
function persistPushReminders(sessionId: string, created: ScheduledFire[], signedIn: boolean): void {
  try {
    updateSession(sessionId, { push_reminders: created.map((c) => ({ fire_at: c.fire_at })) })
    if (signedIn) mirrorSessionUpdateToCloud(sessionId)
  } catch (err) {
    console.warn('[reminders] could not persist push_reminders:', err)
  }
}

/**
 * The one primary "Remind me" button (field-test fix list, item 2). The
 * caller's onClick must call remindMe() before any other await: it asks
 * for notification permission, and iOS only shows that prompt from a tap.
 */
function RemindMeButton({
  onClick,
  busy,
  disabled,
}: {
  onClick: () => void
  busy: boolean
  disabled: boolean
}) {
  const { t } = useTranslation()
  return (
    <Button size="lg" className="w-full gap-2" onClick={onClick} disabled={busy || disabled}>
      <Icon name="bell" className="w-5 h-5" />
      {busy ? t('reminders.remindMe.busy') : t('reminders.remindMe.cta')}
    </Button>
  )
}

/** The calendar (.ics) option. Secondary to "Remind me", and survives anything. */
function CalendarCard({
  copy,
  state,
  count,
  onDownload,
}: {
  copy: string
  state: 'idle' | 'downloaded' | 'error' | 'empty'
  count: number
  onDownload: () => void
}) {
  const { t } = useTranslation()
  return (
    <Card className="mb-6">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
          <Icon name="calendar" className="w-6 h-6" />
        </div>
        <div>
          <h3 className="font-display font-bold text-ink-900">{t('reminders.calendarHeader')}</h3>
          <p className="text-xs text-ink-600 mt-1 leading-relaxed">{copy}</p>
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={onDownload}
        disabled={state === 'downloaded' || count === 0}
        className="w-full min-h-[44px]"
      >
        {state === 'downloaded'
          ? t('reminders.calendarDownloaded')
          : state === 'error'
            ? t('reminders.calendarError')
            : state === 'empty'
              ? t('reminders.calendarPickAtLeastOne')
              : t('reminders.calendarCta', { count })}
      </Button>
    </Card>
  )
}

function DoneButton({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  return (
    <Button variant="outline" size="lg" onClick={onDone} className="mt-auto w-full">
      {t('common.done')}
    </Button>
  )
}

export default function ReminderOptions({ session, onDone }: Props) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [icsState, setIcsState] = useState<'idle' | 'downloaded' | 'error' | 'empty'>('idle')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<RemindMeSummary | null>(null)

  const chipLabel = (offset: Offset): string =>
    offset === 0 ? t('reminders.chipAtExpiry') : t('reminders.chipMin', { count: offset })

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
    // Any earlier result is now stale.
    setIcsState('idle')
    setOutcome(null)
  }

  // Sorted highest to lowest so summaries and downstream lists read
  // left-to-right in chronological order ("3:30 PM, 3:40 PM, 3:43 PM").
  const selectedList = useMemo(() => [...selected].sort((a, b) => b - a), [selected])

  // The selected offsets' fire times, in chronological order.
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
        : formatReminderTimesLine(selectedFireAtList, { now: new Date(now), timeZone, t }),
    [selectedFireAtList, now, timeZone, t],
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

  const handleRemindMe = async () => {
    if (busy || selectedList.length === 0) return
    setBusy(true)
    setOutcome(null)
    const copyFor = (fireAt: Date) => reminderCopy(session, fireAt, t)
    // Title = the address (most useful thing on the lock screen), body =
    // the absolute expiry time. Same copy for push and in-tab.
    const pushReminders: ScheduledReminder[] = selectedFireAtList.map((fireAt) => ({
      fire_at: fireAt.toISOString(),
      ...copyFor(fireAt),
      url: sessionLink(session.id),
    }))
    try {
      // No await before this call: it opens with the permission prompt.
      const result = await remindMe({
        sessionId: session.id,
        pushReminders,
        expiresAt: session.expires_at,
        armInTab: () => {
          // A second tap replaces the first tap's in-tab reminders instead
          // of doubling them. The server side is replace-all too.
          cancelInTabReminders(session.id)
          return scheduleParkingReminders(session, selectedList, copyFor)
        },
      })
      if (result.background.ok) persistPushReminders(session.id, result.background.created, Boolean(user))
      setOutcome(summariseRemindMe(result))
    } catch (err) {
      console.error('[reminders] remind me failed:', err)
      setOutcome({ kind: 'none', times: [], step: 'failed' })
    } finally {
      setBusy(false)
    }
  }

  // === Empty states ===
  if (!session.expires_at) {
    // No expiry = no-sign / free-park record. Different picker shape:
    // "remind me in N hours from now" instead of "X min before expiry".
    return <NoSignReminderPicker session={session} onDone={onDone} />
  }

  if (!anyFireable) {
    return (
      <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
        <h2 className="font-display text-3xl font-extrabold text-paper-50 mb-2">{t('reminders.header')}</h2>
        <p className="text-sm mb-6 leading-relaxed" style={{ color: '#A9CFBE' }}>
          {/* <Trans> renders the <strong> placeholder inside the JSON as a
              real React element, so the expiry time stays visually anchored. */}
          <Trans
            i18nKey="reminders.expired"
            values={{ when: expiresLabel }}
            components={{ strong: <span className="font-display font-bold text-paper-50" /> }}
          />
        </p>
        <DoneButton onDone={onDone} />
      </div>
    )
  }

  // === Main flow ===
  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <h2 className="font-display text-3xl font-extrabold text-paper-50 mb-1">{t('reminders.header')}</h2>
      <p className="text-sm mb-6 leading-relaxed" style={{ color: '#A9CFBE' }}>
        <Trans
          i18nKey="reminders.intro"
          values={{ when: expiresLabel }}
          components={{ strong: <span className="font-display font-bold text-paper-50" /> }}
        />
      </p>

      {/* Chip selector */}
      <div className="flex flex-wrap gap-2 mb-3">
        {offsets.map(({ offset, isPast, fireAt }) => {
          const isSelected = selected.has(offset)
          const base =
            'px-4 py-2.5 min-h-[44px] rounded-full text-sm font-semibold border-2 transition-colors min-w-[88px] text-center'
          let cls: string
          if (isPast) {
            cls = `${base} bg-paper-100 border-paper-200 text-ink-400 line-through cursor-not-allowed`
          } else if (isSelected) {
            cls = `${base} bg-brand-500 border-brand-500 text-white`
          } else {
            cls = `${base} bg-white border-paper-300 text-ink-700 hover:border-brand-300`
          }
          // Date-aware tooltip so a chip for tomorrow says "Fires at
          // 10:00 am, Mon 18/05/2026" rather than the ambiguous "10:00 am".
          const tip = isPast
            ? t('reminders.chipPast')
            : t('reminders.chipFiresAt', {
                when: formatExpiryAbsolute(fireAt, { now: new Date(now), timeZone }).combined,
              })
          return (
            <button
              key={offset}
              type="button"
              onClick={() => !isPast && toggle(offset)}
              disabled={isPast}
              aria-pressed={isSelected}
              aria-label={`${chipLabel(offset)}, ${tip}`}
              title={tip}
              className={cls}
            >
              {chipLabel(offset)}
            </button>
          )
        })}
      </div>

      {/* Live summary of selected fire-times */}
      <p className="text-xs mb-6 leading-relaxed min-h-[2.25rem]" style={{ color: '#A9CFBE' }}>
        {selectedTimesLabel ? (
          <Trans
            i18nKey="reminders.summaryWithSelections"
            values={{ times: selectedTimesLabel }}
            components={{ strong: <span className="font-display font-bold text-paper-50" /> }}
          />
        ) : (
          <span className="italic" style={{ color: '#A9CFBE' }}>
            {t('reminders.summaryEmpty')}
          </span>
        )}
      </p>

      <RemindMeButton onClick={handleRemindMe} busy={busy} disabled={selectedList.length === 0} />
      <RemindMeOutcome summary={outcome} timeZone={timeZone} className="mt-3" />
      <ReminderHelp tone="vault" className="mt-3 mb-6" />

      <CalendarCard
        copy={t('reminders.calendarCopy')}
        state={icsState}
        count={selectedList.length}
        onDownload={handleIcs}
      />

      <DoneButton onDone={onDone} />
    </div>
  )
}

/**
 * Picker for OPEN-ENDED records: the no-sign / free-park case where
 * there's no posted expiry. Different chips: instead of "X min before
 * expiry", offer durations from now ("remind me in 1h / 2h / 4h / 8h").
 * "Remind me" books push and in-tab reminders just like the expiry path,
 * with absolute fire times; the calendar option stays.
 *
 * The driver still has to hit "I've left" to end the record (the no-sign
 * open-ended model). These reminders are "come check on your car", not
 * "your parking is about to expire". Copy reflects that.
 */
const NOSIGN_DURATIONS_MIN = [30, 60, 120, 240, 480] as const
type NoSignDurationMin = (typeof NOSIGN_DURATIONS_MIN)[number]

function NoSignReminderPicker({ session, onDone }: Props) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [selected, setSelected] = useState<Set<NoSignDurationMin>>(
    () => new Set<NoSignDurationMin>([60]),
  )
  const [icsState, setIcsState] = useState<'idle' | 'downloaded' | 'error' | 'empty'>('idle')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<RemindMeSummary | null>(null)
  const now = useNow(30_000)
  const timeZone = useMemo(() => sessionTimezone(session.location), [session.location])

  const toggle = (duration: NoSignDurationMin) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(duration)) next.delete(duration)
      else next.add(duration)
      return next
    })
    setIcsState('idle')
    setOutcome(null)
  }

  // Sorted shortest to longest so the summary reads "1h, 2h, 4h" not "4h, 1h, 2h".
  const selectedList = useMemo(() => [...selected].sort((a, b) => a - b), [selected])

  const selectedFireAtList = useMemo(
    () => selectedList.map((mins) => new Date(now + mins * 60 * 1000)),
    [selectedList, now],
  )

  const selectedTimesLabel = useMemo(
    () =>
      selectedFireAtList.length === 0
        ? null
        : formatReminderTimesLine(selectedFireAtList, { now: new Date(now), timeZone, t }),
    [selectedFireAtList, now, timeZone, t],
  )

  const handleIcs = async () => {
    if (selectedFireAtList.length === 0) {
      setIcsState('empty')
      return
    }
    try {
      const { downloadIcsAbsolute } = await import('../lib/ics')
      downloadIcsAbsolute(session, selectedFireAtList)
      setIcsState('downloaded')
    } catch {
      setIcsState('error')
    }
  }

  const handleRemindMe = async () => {
    if (busy || selectedList.length === 0) return
    setBusy(true)
    setOutcome(null)
    const copyFor = (fireAt: Date) => reminderCopy(session, fireAt, t)
    // From the moment of the tap, not the last 30-second tick.
    const tapped = Date.now()
    const fireAts = selectedList.map((mins) => new Date(tapped + mins * 60 * 1000))
    const pushReminders: ScheduledReminder[] = fireAts.map((fireAt) => ({
      fire_at: fireAt.toISOString(),
      ...copyFor(fireAt),
      url: sessionLink(session.id),
    }))
    try {
      // No await before this call: it opens with the permission prompt.
      const result = await remindMe({
        sessionId: session.id,
        pushReminders,
        expiresAt: null,
        armInTab: () => {
          cancelInTabReminders(session.id)
          return scheduleAbsoluteReminders(session, fireAts, copyFor)
        },
      })
      if (result.background.ok) persistPushReminders(session.id, result.background.created, Boolean(user))
      setOutcome(summariseRemindMe(result))
    } catch (err) {
      console.error('[reminders] remind me failed:', err)
      setOutcome({ kind: 'none', times: [], step: 'failed' })
    } finally {
      setBusy(false)
    }
  }

  const chipLabel = (duration: NoSignDurationMin): string => {
    if (duration < 60) return t('reminders.noSign.chipMin', { count: duration })
    return t('reminders.noSign.chipHour', { count: duration / 60 })
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <h2 className="font-display text-3xl font-extrabold text-paper-50 mb-1">
        {t('reminders.header')}
      </h2>
      <p className="text-sm mb-6 leading-relaxed" style={{ color: '#A9CFBE' }}>
        {isNoSignReadRecord(session) ? t('unclearSign.remindIntro') : t('reminders.noSign.intro')}
      </p>

      {/* Chip selector */}
      <div className="flex flex-wrap gap-2 mb-3">
        {NOSIGN_DURATIONS_MIN.map((duration) => {
          const isSelected = selected.has(duration)
          const base =
            'px-4 py-2.5 min-h-[44px] rounded-full text-sm font-semibold border-2 transition-colors min-w-[88px] text-center'
          const cls = isSelected
            ? `${base} bg-brand-500 border-brand-500 text-white`
            : `${base} bg-white border-paper-300 text-ink-700 hover:border-brand-300`
          return (
            <button
              key={duration}
              type="button"
              onClick={() => toggle(duration)}
              aria-pressed={isSelected}
              className={cls}
            >
              {chipLabel(duration)}
            </button>
          )
        })}
      </div>

      {/* Live summary of selected fire-times */}
      <p className="text-xs mb-6 leading-relaxed min-h-[2.25rem]" style={{ color: '#A9CFBE' }}>
        {selectedTimesLabel ? (
          <Trans
            i18nKey="reminders.summaryWithSelections"
            values={{ times: selectedTimesLabel }}
            components={{ strong: <span className="font-display font-bold text-paper-50" /> }}
          />
        ) : (
          <span className="italic" style={{ color: '#A9CFBE' }}>{t('reminders.summaryEmpty')}</span>
        )}
      </p>

      <RemindMeButton onClick={handleRemindMe} busy={busy} disabled={selectedList.length === 0} />
      <RemindMeOutcome summary={outcome} timeZone={timeZone} className="mt-3" />
      <ReminderHelp tone="vault" className="mt-3 mb-6" />

      <CalendarCard
        copy={t('reminders.noSign.calendarCopy')}
        state={icsState}
        count={selectedList.length}
        onDownload={handleIcs}
      />

      <DoneButton onDone={onDone} />
    </div>
  )
}
