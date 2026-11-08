import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { useNow } from '../lib/use-now'
import { formatExpiryAbsolute } from '../lib/time-format'
import { sessionTimezone } from '../lib/timezone'
import { reminderCopy } from '../lib/reminder-copy'
import { sessionLink } from '../lib/deep-link'
import {
  cancelPushReminders,
  hasPushDeviceId,
  schedulePushReminders,
  type ScheduledReminder,
} from '../lib/push'
import { cancelInTabReminders, scheduleAbsoluteReminders } from '../lib/notifications'
import { remindMe, summariseRemindMe, type RemindMeSummary } from '../lib/remind-me'
import { updateSession } from '../lib/storage'
import { useLiveRecord } from '../lib/use-records-version'
import { useAuth } from '../lib/use-auth'
import { mirrorSessionUpdateToCloud } from '../lib/sync'
import Icon from './Icon'
import Button from './ui/Button'
import Card from './ui/Card'
import { ReminderHelp, RemindMeOutcome } from './ReminderStatus'

/**
 * Per-session reminder management surface — closes the loop on the user's
 * three explicit gaps:
 *
 *   1. "I don't know WHEN the pushes will fire" — lists every scheduled
 *      fire_at as a human-readable line ("4:30 PM — 15 min before expiry").
 *   2. "Push state isn't visible from the screens I actually visit" — this
 *      section lives in SessionDetail (the natural place to think about
 *      a specific session). The ReminderOptions screen handles the
 *      subscription-state-banner part of that gap.
 *   3. "Let people change their reminders themselves" — per-row × cancel,
 *      "+ Add reminder" with smart-filtered chips (greyed when offset is
 *      already past), and "Cancel all" as a nuclear option.
 *
 * Adding uses the same one-tap "Remind me" as ReminderOptions (field-test
 * fix list, item 2): pick chips, tap Remind me, and remindMe() asks for
 * permission, registers push, books the server reminders and arms the
 * in-tab ones. When push can't work here it says the new reminders only
 * work while ParkProof is open, and why. The reliability line sits at the
 * bottom of the section.
 *
 * Architecture:
 *   - session.push_reminders[] is the cached truth for display. Authoritative
 *     truth is EventBridge Scheduler server-side, but reading it on every
 *     render would be wasteful. We re-call /push/schedule (replace-all)
 *     on every mutation, then overwrite the cached array with the response.
 *   - "Add" uses the SAME chip offsets as ReminderOptions (30/15/10/5/2/0
 *     before expiry, OR 30m/1h/2h/4h/8h from-now for no-sign sessions).
 *   - Per-row cancel: client-side filters the existing list to exclude the
 *     row being cancelled, then re-calls /push/schedule with the difference.
 *     Server's deletePushSchedulesForSession runs first, then creates the
 *     smaller new set — atomic from the user's perspective.
 *   - "Cancel all" calls /push/cancel (the dedicated endpoint), then clears
 *     the local push_reminders array, only when the cancel succeeded.
 *   - In-tab copies follow the list: a removed reminder's in-tab timer is
 *     disarmed with it, "Cancel all" disarms every one for the record, and
 *     a Remind me refused as another device's disarms the ones it armed.
 *   - Push schedules belong to the device that created them (spec N6).
 *     push_reminders syncs through the cloud, so another device can show
 *     them. There a change gets 403 ERR_NOT_OWNER (or the browser has no
 *     device id at all): the list is left exactly as it is, the screen says
 *     the reminders were set on another device, and the change controls
 *     are hidden, because a retry here can never work.
 *   - The list is read from the live stored record, so a change made
 *     elsewhere (App's "I've left" clears it after a successful cancel)
 *     shows straight away.
 *
 * Renders nothing when session.push_reminders is empty AND it's a past /
 * ended session (no point offering to add reminders to a session that's
 * already done). The "add" CTA still shows for active sessions even when
 * push_reminders is empty — that's how users discover the surface.
 */

// Same offsets as ReminderOptions — kept in sync by convention. If we ever
// extract to a shared const this is the consumer to update too.
const EXPIRY_OFFSETS_MIN = [30, 15, 10, 5, 2, 0] as const
const NOSIGN_DURATIONS_MIN = [30, 60, 120, 240, 480] as const
const SAFETY_MARGIN_MS = 30 * 1000
// The server books at most 6 reminders per record (PUSH_MAX_REMINDERS_PER_SESSION).
const MAX_REMINDERS = 6

// ----- helpers --------------------------------------------------------------

/**
 * Returns the future-fire reminders in chronological order. Stale past
 * reminders (e.g. session that's been open for a while + reminders that
 * already fired) get dropped from display so the list stays honest.
 */
function selectFuture(
  reminders: ParkingSession['push_reminders'] | undefined,
  nowMs: number,
): Array<{ fire_at: string; fireAt: Date }> {
  if (!reminders || reminders.length === 0) return []
  const items: Array<{ fire_at: string; fireAt: Date }> = []
  for (const r of reminders) {
    const d = new Date(r.fire_at)
    if (!Number.isFinite(d.getTime())) continue
    // Treat already-fired reminders as past (they may still be in EventBridge
    // for a few seconds after fire due to action-after-completion lag but
    // the user shouldn't see them as upcoming).
    if (d.getTime() <= nowMs) continue
    items.push({ fire_at: r.fire_at, fireAt: d })
  }
  items.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime())
  return items
}

interface Props {
  session: ParkingSession
}

export default function ScheduledRemindersSection({ session: initialSession }: Props) {
  const { t } = useTranslation()
  const { user } = useAuth()
  // 30s tick aligns with SAFETY_MARGIN_MS — a row that crosses into "past"
  // disappears from the list on the next tick rather than lingering until
  // page reload.
  const now = useNow(30_000)
  // The live stored copy: this section's own writes, App's end path and a
  // cloud pull all land in storage, and the list re-reads it.
  const session = useLiveRecord(initialSession)
  const timeZone = useMemo(() => sessionTimezone(session.location), [session.location])
  const reminders = session.push_reminders
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when the server said another device owns these schedules.
  const [notOwner, setNotOwner] = useState(false)
  // Chips picked in the add picker, and what the last "Remind me" did.
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [outcome, setOutcome] = useState<RemindMeSummary | null>(null)
  // In-tab reminders armed by a Remind me tap that left the picker open for
  // a retry (push failed): the retry replaces them rather than doubling them.
  const armedByLastTry = useRef<Date[]>([])

  const futureReminders = useMemo(
    () => selectFuture(reminders, now),
    [reminders, now],
  )
  // Reminders this device can't change: the server said so, or this browser
  // has no push device id (scheduling always creates one, so the listed
  // reminders came from another device through the cloud).
  const fromOtherDevice = futureReminders.length > 0 && (notOwner || !hasPushDeviceId())

  // Hide entirely if there's nothing to show AND the session can't accept
  // new reminders (ended, or expiry is past + no-sign isn't applicable).
  // For active sessions WITH no scheduled reminders, we still show the
  // "+ Add reminder" affordance so the surface is discoverable.
  const isEnded = !!session.ended_at
  const expiryMs = session.expires_at ? new Date(session.expires_at).getTime() : null
  const isExpiryPast = expiryMs !== null && expiryMs < now
  const isNoSign = !!session.no_sign
  const canAdd = !isEnded && (isNoSign || !isExpiryPast)
  // Add, remove and cancel all change this device's schedules only.
  const canChange = canAdd && !fromOtherDevice

  // Compute the chip options viable right now — same logic as ReminderOptions
  // but shifted from "user picks" to "user picks ON TOP OF existing list".
  // For expiry-bearing sessions, offsets convert to fire_at via expires_at - offset.
  // For no-sign sessions, durations convert via now + duration.
  // Any fire_at that's already past (incl. safety margin) is greyed.
  const chipOptions = useMemo(() => {
    type Chip = {
      key: string
      label: string
      fireAt: Date
      /** No-sign chips: minutes from now, recomputed at the tap. */
      fromNowMin: number | null
      /** True if this exact fire_at is already in the list. */
      alreadyScheduled: boolean
      /** True if would fire before now + safety margin. */
      isPast: boolean
    }
    const chips: Chip[] = []
    const existingFireAtMs = new Set(
      futureReminders.map((r) => Math.round(r.fireAt.getTime() / 1000))
    )
    if (isNoSign) {
      for (const dur of NOSIGN_DURATIONS_MIN) {
        const fireAt = new Date(now + dur * 60 * 1000)
        const ms = fireAt.getTime()
        chips.push({
          key: `nosign-${dur}`,
          label:
            dur < 60
              ? t('reminders.noSign.chipMin', { count: dur })
              : t('reminders.noSign.chipHour', { count: dur / 60 }),
          fireAt,
          fromNowMin: dur,
          alreadyScheduled: existingFireAtMs.has(Math.round(ms / 1000)),
          isPast: ms - now < SAFETY_MARGIN_MS,
        })
      }
    } else if (expiryMs !== null) {
      for (const off of EXPIRY_OFFSETS_MIN) {
        const fireAt = new Date(expiryMs - off * 60 * 1000)
        const ms = fireAt.getTime()
        chips.push({
          key: `expiry-${off}`,
          label:
            off === 0
              ? t('reminders.chipAtExpiry')
              : t('reminders.chipMin', { count: off }),
          fireAt,
          fromNowMin: null,
          alreadyScheduled: existingFireAtMs.has(Math.round(ms / 1000)),
          isPast: ms - now < SAFETY_MARGIN_MS,
        })
      }
    }
    return chips
  }, [futureReminders, now, isNoSign, expiryMs, t])

  const anyChipViable = chipOptions.some((c) => !c.isPast && !c.alreadyScheduled)
  // Picks still usable after the 30-second tick (a chip can slide into the past).
  const pickedChips = chipOptions.filter((c) => picked.has(c.key) && !c.isPast && !c.alreadyScheduled)
  const roomLeft = MAX_REMINDERS - futureReminders.length

  /**
   * Compute the notification body for a given fire-at, per-reminder.
   *
   * Bug this fixes: the add and remove paths previously used a single body
   * string for the WHOLE batch when re-calling /push/schedule. For expiry-
   * bearing sessions that meant retained reminders lost their original
   * "X min until your parking expires" copy and inherited whatever body was
   * convenient at the call site. Result: after editing your reminders, the
   * remaining ones could fire with "Your parking expires now" even when
   * they're set to fire 30 min before. Same per-reminder logic as
   * ReminderOptions.tsx — keep them in lock-step. If they diverge, the
   * first edit silently rewrites the body text the user originally chose.
   * reminderCopy() is the single source for that copy.
   */
  const copyForFireAt = (fireAt: Date) => reminderCopy(session, fireAt, t)

  /**
   * Persist the new fire-at list to localStorage + cloud, then notify parent.
   * Wraps the two write paths in one place — every add/remove/cancel-all
   * funnels through here so they stay consistent.
   */
  const persistReminders = (newReminders: Array<{ fire_at: string }>) => {
    try {
      // The write fires records-changed, which re-reads the list above.
      updateSession(session.id, { push_reminders: newReminders })
      if (user) mirrorSessionUpdateToCloud(session.id)
    } catch (err) {
      console.warn('[reminders] could not persist:', err)
      setError(t('scheduledReminders.errorRetry'))
    }
  }

  /** Another device owns these schedules: say so and change nothing. */
  const showOtherDevice = () => {
    setNotOwner(true)
    setPicking(false)
    setError(t('scheduledReminders.otherDevice'))
  }

  /**
   * "Remind me" for the picked chips: book the UNION of the existing future
   * reminders and the new ones (/push/schedule is replace-all) and arm the
   * new ones in this tab. remindMe() opens with the permission prompt, so
   * nothing is awaited before it (iOS only prompts from a tap).
   */
  const handleRemindMe = async () => {
    if (busy || pickedChips.length === 0) return
    setBusy(true)
    setError(null)
    setOutcome(null)
    const tapped = Date.now()
    const newFireAts = pickedChips.map((c) =>
      c.fromNowMin === null ? c.fireAt : new Date(tapped + c.fromNowMin * 60 * 1000),
    )
    // Each entry gets its OWN body from its own fire_at: one shared body for
    // the batch (an old bug) would rewrite existing reminders' copy.
    const desired: ScheduledReminder[] = [
      ...futureReminders.map((r) => ({
        fire_at: r.fire_at,
        ...copyForFireAt(r.fireAt),
        url: sessionLink(session.id),
      })),
      ...newFireAts.map((fireAt) => ({
        fire_at: fireAt.toISOString(),
        ...copyForFireAt(fireAt),
        url: sessionLink(session.id),
      })),
    ]
    try {
      const result = await remindMe({
        sessionId: session.id,
        pushReminders: desired,
        expiresAt: session.expires_at,
        // Only the new times: earlier reminders were armed when they were set.
        armInTab: async () => {
          cancelInTabReminders(session.id, armedByLastTry.current)
          armedByLastTry.current = []
          const armedNow = await scheduleAbsoluteReminders(session, newFireAts, copyForFireAt)
          armedByLastTry.current = armedNow.firesAt
          return armedNow
        },
      })
      if (!result.background.ok && result.background.reason === 'not_owner') {
        // Nothing changes here: disarm the in-tab copies this tap just armed.
        cancelInTabReminders(session.id, armedByLastTry.current)
        armedByLastTry.current = []
        showOtherDevice()
        return
      }
      if (result.background.ok) {
        persistReminders(result.background.created.map((c) => ({ fire_at: c.fire_at })))
      }
      const summary = summariseRemindMe(result)
      setOutcome(summary)
      // Keep the picker open, with the picks, when nothing was set or when
      // the step says to tap Remind me again (push failed but the in-tab
      // reminders were set), so a retry is one tap.
      const retry = summary.kind === 'none' || (summary.kind === 'openOnly' && summary.step === 'failed')
      if (!retry) {
        armedByLastTry.current = []
        setPicking(false)
        setPicked(new Set())
      }
    } catch (err) {
      console.error('[reminders] add failed:', err)
      setError(t('scheduledReminders.errorRetry'))
    } finally {
      setBusy(false)
    }
  }

  const togglePick = (key: string) => {
    setOutcome(null)
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else if (next.size < roomLeft) next.add(key)
      return next
    })
  }

  /**
   * Remove one reminder by re-scheduling the DIFFERENCE of existing − this one.
   */
  const handleRemove = async (fire_at_iso: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const remaining = futureReminders.filter((r) => r.fire_at !== fire_at_iso)
      if (remaining.length === 0) {
        // No remaining → call /push/cancel instead. Schedule API rejects empty
        // reminders[] with a 400; cancel is the right verb here. Clear the
        // list only when the schedules are really gone.
        const cancelled = await cancelPushReminders(session.id)
        if (cancelled.ok) {
          persistReminders([])
          cancelInTabReminders(session.id, [new Date(fire_at_iso)])
        } else if (cancelled.reason === 'network') setError(t('scheduledReminders.errorRetry'))
        else showOtherDevice()
        return
      }
      // Per-reminder body, same bug-fix as handleRemindMe. Removing one row
      // shouldn't rewrite the surviving ones' "X min before expiry" copy
      // to a generic "Your parking expires now". Server stores whatever
      // body we send (no server-side rebuild), so we have to compute the
      // honest body for each retained fire_at here.
      const desired: ScheduledReminder[] = remaining.map((r) => ({
        fire_at: r.fire_at,
        ...copyForFireAt(r.fireAt),
        url: sessionLink(session.id),
      }))
      const result = await schedulePushReminders(session.id, desired, session.expires_at)
      if (!result.ok) {
        if (result.reason === 'not_owner') showOtherDevice()
        else setError(t('scheduledReminders.errorRetry'))
        return
      }
      persistReminders(result.created.map((c) => ({ fire_at: c.fire_at })))
      // The in-tab copy of the removed reminder too, or it still alerts
      // while ParkProof is open.
      cancelInTabReminders(session.id, [new Date(fire_at_iso)])
    } catch (err) {
      console.error('[reminders] remove failed:', err)
      setError(t('scheduledReminders.errorRetry'))
    } finally {
      setBusy(false)
    }
  }

  const handleCancelAll = async () => {
    if (busy) return
    if (!window.confirm(t('scheduledReminders.cancelAllConfirm'))) return
    setBusy(true)
    setError(null)
    try {
      // Clear the list only when the schedules are really gone. Clearing it
      // after a 403 would mirror an empty list to the cloud while the other
      // device's reminders keep firing.
      const cancelled = await cancelPushReminders(session.id)
      if (cancelled.ok) {
        persistReminders([])
        // Every in-tab reminder for this record too.
        cancelInTabReminders(session.id)
        armedByLastTry.current = []
      } else if (cancelled.reason === 'network') setError(t('scheduledReminders.errorRetry'))
      else showOtherDevice()
    } catch (err) {
      console.error('[reminders] cancel-all failed:', err)
      setError(t('scheduledReminders.errorRetry'))
    } finally {
      setBusy(false)
    }
  }

  // ----- render decisions ---------------------------------------------------

  if (futureReminders.length === 0 && !canAdd) {
    // Hide section entirely — nothing to show + nothing to add.
    return null
  }

  return (
    <Card className="mb-3">
      <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-600 mb-3">
        {t('scheduledReminders.header')}
      </h3>

      {futureReminders.length === 0 ? (
        <p className="text-sm text-ink-600 mb-3">
          {t('scheduledReminders.noneYet')}
        </p>
      ) : (
        <ul className="space-y-2 mb-3">
          {futureReminders.map(({ fire_at, fireAt }) => {
            const absolute = formatExpiryAbsolute(fireAt, {
              now: new Date(now),
              timeZone,
            }).combined
            // Label format: "4:30 PM — 30 min before expiry" or "in 30 min"
            let label = absolute
            if (!isNoSign && expiryMs !== null) {
              const offsetMins = Math.round((expiryMs - fireAt.getTime()) / 60_000)
              if (offsetMins <= 0) {
                label = t('scheduledReminders.firesAtExpiry', { when: absolute })
              } else {
                label = t('scheduledReminders.firesBefore', {
                  when: absolute,
                  count: offsetMins,
                })
              }
            } else if (isNoSign) {
              const arrivedMs = new Date(session.arrived_at).getTime()
              const minsFromArrival = Math.round(
                (fireAt.getTime() - arrivedMs) / 60_000,
              )
              if (minsFromArrival > 0) {
                label = t('scheduledReminders.firesFromNow', {
                  when: absolute,
                  count: minsFromArrival,
                })
              } else {
                label = t('scheduledReminders.firesAbsolute', { when: absolute })
              }
            }
            return (
              <li
                key={fire_at}
                className="flex items-center gap-3 text-sm text-ink-800"
              >
                <Icon name="bell" className="w-4 h-4 text-brand-500 shrink-0" />
                <span className="flex-1 leading-snug">{label}</span>
                {canChange && (
                  <button
                    type="button"
                    onClick={() => void handleRemove(fire_at)}
                    disabled={busy}
                    aria-label={t('scheduledReminders.cancelOne')}
                    className="text-ink-600 hover:text-ink-900 disabled:opacity-40 leading-none text-lg px-1 min-w-[44px] min-h-[44px] inline-flex items-center justify-center -my-1.5"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {(error ?? (fromOtherDevice ? t('scheduledReminders.otherDevice') : null)) && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
          {error ?? t('scheduledReminders.otherDevice')}
        </p>
      )}

      {canChange && !picking && (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setError(null)
              setOutcome(null)
              setPicked(new Set())
              armedByLastTry.current = []
              setPicking(true)
            }}
            disabled={busy || !anyChipViable}
            className="text-sm bg-brand-50 hover:bg-brand-100 disabled:opacity-50 text-brand-700 font-semibold px-3 py-2.5 rounded-lg border border-brand-200 min-h-[44px] inline-flex items-center justify-center"
          >
            {busy ? t('scheduledReminders.saving') : t('scheduledReminders.addAnother')}
          </button>
          {futureReminders.length > 0 && (
            <button
              type="button"
              onClick={() => void handleCancelAll()}
              disabled={busy}
              className="text-sm text-ink-600 hover:text-ink-900 disabled:opacity-50 font-medium px-3 py-2.5 min-h-[44px] inline-flex items-center justify-center"
            >
              {t('scheduledReminders.cancelAll')}
            </button>
          )}
        </div>
      )}

      {canChange && picking && (
        <div className="mt-2 p-3 rounded-xl bg-paper-50 border border-paper-200">
          <p className="text-xs font-semibold text-ink-700 mb-2">
            {t('scheduledReminders.pickHeader')}
          </p>
          {!anyChipViable ? (
            <p className="text-xs text-ink-600 leading-relaxed">
              {t('scheduledReminders.tooLateAll')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {chipOptions.map((chip) => {
                const isPicked = picked.has(chip.key)
                const full = !isPicked && picked.size >= roomLeft
                const unavailable = chip.isPast || chip.alreadyScheduled
                const disabled = unavailable || busy || full
                const base =
                  'px-3 py-2.5 min-h-[44px] inline-flex items-center justify-center rounded-full text-xs font-semibold border-2 transition-colors min-w-[72px] text-center'
                const cls = unavailable
                  ? `${base} bg-paper-100 border-paper-200 text-ink-400 ${chip.isPast ? 'line-through' : ''} cursor-not-allowed`
                  : isPicked
                    ? `${base} bg-brand-500 border-brand-500 text-white`
                    : `${base} bg-white border-brand-300 text-brand-700 hover:bg-brand-50 active:bg-brand-100 disabled:opacity-50`
                const tip = chip.alreadyScheduled
                  ? t('scheduledReminders.chipAlreadySet')
                  : chip.isPast
                    ? t('reminders.chipPast')
                    : t('reminders.chipFiresAt', {
                        when: formatExpiryAbsolute(chip.fireAt, {
                          now: new Date(now),
                          timeZone,
                        }).combined,
                      })
                return (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => !disabled && togglePick(chip.key)}
                    disabled={disabled}
                    aria-pressed={isPicked}
                    title={tip}
                    aria-label={`${chip.label}, ${tip}`}
                    className={cls}
                  >
                    {chip.label}
                  </button>
                )
              })}
            </div>
          )}
          {anyChipViable && (
            <>
              <Button
                className="w-full gap-2 mt-3 min-h-[44px]"
                onClick={() => void handleRemindMe()}
                disabled={busy || pickedChips.length === 0}
              >
                <Icon name="bell" className="w-5 h-5" />
                {busy ? t('reminders.remindMe.busy') : t('reminders.remindMe.cta')}
              </Button>
            </>
          )}
          <button
            type="button"
            onClick={() => setPicking(false)}
            className="mt-3 text-xs text-ink-600 hover:text-ink-900 font-medium min-h-[44px] py-2.5 inline-flex items-center"
          >
            {t('scheduledReminders.pickCancel')}
          </button>
        </div>
      )}

      <RemindMeOutcome summary={outcome} timeZone={timeZone} className={outcome ? 'mt-3' : ''} />
      <ReminderHelp tone="card" className="mt-3" />
    </Card>
  )
}
