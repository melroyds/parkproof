import { useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import {
  scheduleAbsoluteReminders,
  scheduleParkingReminders,
  type ScheduleResult,
} from '../lib/notifications'
import {
  getPushPermissionState,
  hasActiveSubscription,
  schedulePushReminders,
  subscribeToPush,
  type ScheduledReminder,
} from '../lib/push'
import { useNow } from '../lib/use-now'
import { updateSession } from '../lib/storage'
import { useAuth } from '../lib/use-auth'
import { mirrorSessionUpdateToCloud } from '../lib/sync'
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

/**
 * Push-subscription status pill that lives at the top of both ReminderOptions
 * picker variants. Subscribers see a green confirmation; non-subscribers get
 * an inline "Enable push" button — the same flow as the About page's
 * PushSubscribeBlock, but with copy contextualised to the reminders-setting
 * moment ("without push, reminders only fire while this tab is open").
 *
 * Surfaces gap #2 from the user's feedback ("I don't even know if the device
 * is subscribed for push notifications") right where the user is about to
 * commit to a set of reminders — the highest-stakes moment to know.
 */
type PushBannerStatus =
  | 'idle'
  | 'requesting'
  | 'subscribed'
  | 'denied'
  | 'unsupported'
  | 'error'

function PushSubscriptionBanner({
  onStatusChange,
}: {
  /** Notified when subscription transitions to/from 'subscribed'. The parent
   *  uses this to hide the push-reminders section entirely when not subscribed
   *  (no point offering chips that can't ping anyone). */
  onStatusChange?: (subscribed: boolean) => void
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<PushBannerStatus>(() => {
    // Initial sync state — only the cheaply-knowable things, same approach
    // as AboutFeatures. Async hasActiveSubscription() check upgrades to
    // 'subscribed' below.
    const permState = getPushPermissionState()
    if (permState === 'unsupported') return 'unsupported'
    if (permState === 'denied') return 'denied'
    return 'idle'
  })

  useEffect(() => {
    let cancelled = false
    void hasActiveSubscription().then((has) => {
      if (cancelled) return
      if (has) {
        setStatus('subscribed')
        onStatusChange?.(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [onStatusChange])

  const handleEnable = async () => {
    setStatus('requesting')
    const result = await subscribeToPush()
    if (result.ok) {
      setStatus('subscribed')
      onStatusChange?.(true)
    } else if (result.reason === 'denied') {
      setStatus('denied')
    } else if (result.reason === 'unsupported') {
      setStatus('unsupported')
    } else {
      setStatus('error')
    }
  }

  if (status === 'unsupported') return null // No banner = no false signal that push is possible.

  if (status === 'subscribed') {
    return (
      <div className="mb-4 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
        <Icon name="check" className="w-4 h-4 shrink-0" strokeWidth={2.5} />
        <span className="leading-snug">{t('reminders.pushStatus.subscribed')}</span>
      </div>
    )
  }

  return (
    <div className="mb-4 p-3 rounded-xl bg-brand-50 border border-brand-100 flex items-start gap-3">
      <Icon name="bell" className="w-5 h-5 text-brand-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-ink-700 leading-relaxed mb-2">
          {status === 'denied'
            ? t('reminders.pushStatus.denied')
            : t('reminders.pushStatus.notSubscribed')}
        </p>
        {status !== 'denied' && (
          <button
            type="button"
            onClick={handleEnable}
            disabled={status === 'requesting'}
            className="text-xs bg-brand-500 hover:bg-brand-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 font-semibold"
          >
            {status === 'requesting'
              ? t('reminders.pushStatus.requesting')
              : status === 'error'
                ? t('reminders.pushStatus.errorRetry')
                : t('reminders.pushStatus.enable')}
          </button>
        )}
      </div>
    </div>
  )
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
  const { user } = useAuth()
  const [icsState, setIcsState] = useState<'idle' | 'downloaded' | 'error' | 'empty'>('idle')
  const [notifResult, setNotifResult] = useState<ScheduleResult | null>(null)
  const [notifBusy, setNotifBusy] = useState(false)
  // True only when the user IS push-subscribed but the server-side schedule
  // POST returned null (a real network/server failure). The not-subscribed
  // case also returns null, but that's a legitimate skip — not a warning.
  const [pushScheduleFailed, setPushScheduleFailed] = useState(false)

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
    setPushScheduleFailed(false)
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
    setPushScheduleFailed(false)
    const result = await scheduleParkingReminders(session, selectedList)
    setNotifResult(result)
    setNotifBusy(false)

    // Fire-and-forget: also schedule server-side Web Push reminders via the
    // backend (EventBridge Scheduler → /push/dispatch). This is the only path
    // that fires when the tab is closed or the browser isn't running. The
    // in-tab scheduler above is a redundant best-effort for users who keep
    // the tab open. If push isn't supported / subscribed, schedulePushReminders
    // returns null silently — we don't pop a UI error because in-tab worked.
    //
    // Title = the address (most useful thing the OS surfaces on the lockscreen;
    // concrete location beats a generic "ParkProof reminder"). Falls back to
    // the localized generic when no address was captured (e.g., no-sign
    // sessions or geocode failure). Body = just the time-left, since the
    // title already carries the where.
    const title = session.location?.address
      ? session.location.address
      : t('reminders.pushTitleFallback')
    const reminders: ScheduledReminder[] = selectedFireAtList.map((fireAt, i) => {
      const offset = selectedList[i]
      const body =
        offset === 0
          ? t('reminders.pushBodyAtExpiry')
          : t('reminders.pushBodyBefore', { count: offset })
      return {
        fire_at: fireAt.toISOString(),
        title,
        body,
        url: `/?session=${session.id}`,
      }
    })
    if (reminders.length > 0) {
      // Await so we can persist the actual fire times to session.push_reminders
      // for later display in SessionDetail. Without persisting, the user has
      // no way to see "when will my reminders fire?" after leaving this
      // screen — gap #1 the user explicitly flagged.
      //
      // The user doesn't WAIT on this — the in-tab notification scheduler
      // above already ran synchronously and the success state is rendered.
      // We just take a beat longer to fetch the server-confirmed times.
      const pushResult = await schedulePushReminders(session.id, reminders)
      if (pushResult && pushResult.created.length > 0) {
        try {
          updateSession(session.id, {
            push_reminders: pushResult.created.map((c) => ({
              fire_at: c.fire_at,
            })),
          })
          if (user) mirrorSessionUpdateToCloud(session.id)
        } catch (err) {
          console.warn('[reminders] could not persist push_reminders:', err)
        }
      } else if (pushResult === null) {
        // null from schedulePushReminders is ambiguous: it's a legitimate skip
        // when push isn't subscribed, but a real failure when it IS. Only the
        // latter deserves a warning — otherwise the user trusts a background
        // reminder that silently never got scheduled. Disambiguate by asking
        // whether this device actually holds an active subscription.
        const subscribed = await hasActiveSubscription()
        if (subscribed) setPushScheduleFailed(true)
      }
    }
  }

  // === Empty states ===
  if (!session.expires_at) {
    // No expiry = no-sign / free-park session. Different picker shape:
    // "remind me in N hours from now" instead of "X min before expiry".
    return <NoSignReminderPicker session={session} onDone={onDone} />
  }

  if (!anyFireable) {
    return (
      <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
        <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-2">{t('reminders.header')}</h2>
        <p className="text-sm text-ink-700 mb-6 leading-relaxed">
          {/* <Trans> renders the <strong> placeholder inside the JSON as a
              real React element, so the expiry-time stays visually anchored
              the way it was before i18n flattened everything. */}
          <Trans
            i18nKey="reminders.expired"
            values={{ when: expiresLabel }}
            components={{ strong: <span className="font-display font-bold text-ink-900" /> }}
          />
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
        <Trans
          i18nKey="reminders.intro"
          values={{ when: expiresLabel }}
          components={{ strong: <span className="font-display font-bold text-ink-900" /> }}
        />
      </p>

      {/* Subscription status banner — at top of picker so user knows whether
          push will actually fire BEFORE they commit to a set of reminders.
          Visible upfront because otherwise users have no idea their device's
          subscription state without navigating to About. */}
      <PushSubscriptionBanner />

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
          <Trans
            i18nKey="reminders.summaryWithSelections"
            values={{ times: selectedTimesLabel }}
            components={{ strong: <span className="font-display font-semibold text-ink-900" /> }}
          />
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
          className="w-full bg-accent-500 hover:bg-accent-600 disabled:opacity-60 text-ink-900 font-semibold py-3 rounded-xl shadow-md shadow-accent-500/20 transition-colors"
        >
          {notifBusy ? (
            <span>{t('reminders.browserRequesting')}</span>
          ) : notifResult ? (
            <span role="status" aria-live="polite">
              <NotifStatusLine result={notifResult} />
            </span>
          ) : selectedList.length === 0 ? (
            <span>{t('reminders.browserNothingSelected')}</span>
          ) : (
            <span>{t('reminders.browserCta', { count: selectedList.length })}</span>
          )}
        </button>
        {/* Subscribed-but-failed: the only rail that fires with the tab closed
            silently didn't get scheduled. The in-tab button above may read
            "scheduled", so this warning is essential to avoid false confidence. */}
        {pushScheduleFailed && (
          <p
            role="alert"
            className="mt-3 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium leading-snug"
          >
            {t('reminders.pushScheduleFailed')}
          </p>
        )}
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

/**
 * Picker for OPEN-ENDED sessions — the no-sign / free-park case where
 * there's no posted expiry. Different chips: instead of "X min before
 * expiry", offer absolute durations from now ("remind me in 1h / 2h /
 * 4h / 8h"). All three rails (.ics + in-tab + Web Push) fire just like
 * the expiry path, with absolute fire-at times instead of computed
 * offsets-before-expiry.
 *
 * The driver still has to hit "I've left" to actually end the session
 * (per the no-sign open-ended model) — the reminders are just "come
 * check on your car", not "you'll get a ticket". Copy reflects that.
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
  const [notifResult, setNotifResult] = useState<ScheduleResult | null>(null)
  const [notifBusy, setNotifBusy] = useState(false)
  // See the expiry-path picker above for the subscribed-but-null rationale.
  const [pushScheduleFailed, setPushScheduleFailed] = useState(false)
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
    setNotifResult(null)
    setPushScheduleFailed(false)
  }

  // Sorted shortest → longest so the summary reads "1h, 2h, 4h" not "4h, 1h, 2h".
  const selectedList = useMemo(
    () => [...selected].sort((a, b) => a - b),
    [selected],
  )

  const selectedFireAtList = useMemo(
    () => selectedList.map((mins) => new Date(now + mins * 60 * 1000)),
    [selectedList, now],
  )

  const selectedTimesLabel = useMemo(
    () =>
      selectedFireAtList.length === 0
        ? null
        : formatReminderTimesLine(selectedFireAtList, { now: new Date(now), timeZone }),
    [selectedFireAtList, now, timeZone],
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

  const handleNotify = async () => {
    setNotifBusy(true)
    setPushScheduleFailed(false)
    const result = await scheduleAbsoluteReminders(session, selectedFireAtList)
    setNotifResult(result)
    setNotifBusy(false)

    // Fire-and-forget: also schedule server-side Web Push at the same
    // absolute times so the user gets the reminder even with the tab
    // closed. Same pattern as the expiry-path handleNotify above.
    const title = session.location?.address
      ? session.location.address
      : t('reminders.pushTitleFallback')
    const reminders: ScheduledReminder[] = selectedFireAtList.map((fireAt) => ({
      fire_at: fireAt.toISOString(),
      title,
      body: t('reminders.pushBodyCheckOn'),
      url: `/?session=${session.id}`,
    }))
    if (reminders.length > 0) {
      // Same persistence as the expiry-path handleNotify above — see comment
      // there for why we await rather than fire-and-forget.
      const pushResult = await schedulePushReminders(session.id, reminders)
      if (pushResult && pushResult.created.length > 0) {
        try {
          updateSession(session.id, {
            push_reminders: pushResult.created.map((c) => ({
              fire_at: c.fire_at,
            })),
          })
          if (user) mirrorSessionUpdateToCloud(session.id)
        } catch (err) {
          console.warn('[reminders] could not persist push_reminders:', err)
        }
      } else if (pushResult === null) {
        // Subscribed-but-null = real failure; not-subscribed null is a skip.
        // Same disambiguation as the expiry-path handleNotify above.
        const subscribed = await hasActiveSubscription()
        if (subscribed) setPushScheduleFailed(true)
      }
    }
  }

  const chipLabel = (duration: NoSignDurationMin): string => {
    if (duration < 60) return t('reminders.noSign.chipMin', { count: duration })
    return t('reminders.noSign.chipHour', { count: duration / 60 })
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">
        {t('reminders.header')}
      </h2>
      <p className="text-sm text-ink-700 mb-6 leading-relaxed">
        {t('reminders.noSign.intro')}
      </p>

      <PushSubscriptionBanner />

      {/* Chip selector */}
      <div className="flex flex-wrap gap-2 mb-3">
        {NOSIGN_DURATIONS_MIN.map((duration) => {
          const isSelected = selected.has(duration)
          const base =
            'px-4 py-2.5 min-h-[44px] rounded-full text-sm font-semibold border-2 transition-colors min-w-[88px] text-center'
          const cls = isSelected
            ? `${base} bg-brand-500 border-brand-500 text-white shadow-sm shadow-brand-500/30`
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
      <p className="text-xs text-ink-600 mb-6 leading-relaxed min-h-[2.25rem]">
        {selectedTimesLabel ? (
          <Trans
            i18nKey="reminders.summaryWithSelections"
            values={{ times: selectedTimesLabel }}
            components={{ strong: <span className="font-display font-semibold text-ink-900" /> }}
          />
        ) : (
          <span className="italic text-ink-500">{t('reminders.summaryEmpty')}</span>
        )}
      </p>

      {/* Calendar */}
      <section className="mb-3 bg-white rounded-2xl border border-paper-300 p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
            <Icon name="calendar" className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-display font-bold text-ink-900">
              {t('reminders.calendarHeader')}
            </h3>
            <p className="text-xs text-ink-600 mt-1 leading-relaxed">
              {t('reminders.noSign.calendarCopy')}
            </p>
          </div>
        </div>
        <button
          onClick={handleIcs}
          disabled={icsState === 'downloaded' || selectedList.length === 0}
          className="w-full bg-gradient-to-r from-brand-500 via-brand-500 to-purple-600 hover:brightness-110 active:brightness-95 disabled:bg-none disabled:bg-brand-200 disabled:text-white/70 text-white font-semibold py-3 rounded-xl shadow-md shadow-brand-500/20 transition-[filter]"
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
            <h3 className="font-display font-bold text-ink-900">
              {t('reminders.browserHeader')}
            </h3>
            <p className="text-xs text-ink-600 mt-1 leading-relaxed">
              {t('reminders.noSign.browserCopy')}
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
          className="w-full bg-accent-500 hover:bg-accent-600 disabled:opacity-60 text-ink-900 font-semibold py-3 rounded-xl shadow-md shadow-accent-500/20 transition-colors"
        >
          {notifBusy ? (
            <span>{t('reminders.browserRequesting')}</span>
          ) : notifResult ? (
            <span role="status" aria-live="polite">
              <NotifStatusLine result={notifResult} />
            </span>
          ) : selectedList.length === 0 ? (
            <span>{t('reminders.browserNothingSelected')}</span>
          ) : (
            <span>{t('reminders.browserCta', { count: selectedList.length })}</span>
          )}
        </button>
        {/* Subscribed-but-failed warning — see the expiry-path picker above. */}
        {pushScheduleFailed && (
          <p
            role="alert"
            className="mt-3 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium leading-snug"
          >
            {t('reminders.pushScheduleFailed')}
          </p>
        )}
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
