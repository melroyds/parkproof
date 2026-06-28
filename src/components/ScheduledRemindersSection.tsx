import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { useNow } from '../lib/use-now'
import { formatExpiryAbsolute } from '../lib/time-format'
import { sessionTimezone } from '../lib/timezone'
import {
  cancelPushReminders,
  schedulePushReminders,
  type ScheduledReminder,
} from '../lib/push'
import { updateSession } from '../lib/storage'
import { useAuth } from '../lib/use-auth'
import { mirrorSessionUpdateToCloud } from '../lib/sync'
import Icon from './Icon'

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
 *     the local push_reminders array.
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

export default function ScheduledRemindersSection({ session }: Props) {
  const { t } = useTranslation()
  const { user } = useAuth()
  // 30s tick aligns with SAFETY_MARGIN_MS — a row that crosses into "past"
  // disappears from the list on the next tick rather than lingering until
  // page reload.
  const now = useNow(30_000)
  const timeZone = useMemo(() => sessionTimezone(session.location), [session.location])

  // Internal mirror of session.push_reminders. The section OWNS mutations
  // (add / remove / cancel-all) — we update localStorage + cloud and reflect
  // the change locally without needing the parent to refresh. Initialized
  // from props once; props changes after mount are ignored (which matches
  // reality — only this surface touches push_reminders, so external changes
  // can't happen mid-mount).
  const [reminders, setReminders] = useState<NonNullable<ParkingSession['push_reminders']>>(
    () => session.push_reminders ?? [],
  )
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const futureReminders = useMemo(
    () => selectFuture(reminders, now),
    [reminders, now],
  )

  // Hide entirely if there's nothing to show AND the session can't accept
  // new reminders (ended, or expiry is past + no-sign isn't applicable).
  // For active sessions WITH no scheduled reminders, we still show the
  // "+ Add reminder" affordance so the surface is discoverable.
  const isEnded = !!session.ended_at
  const expiryMs = session.expires_at ? new Date(session.expires_at).getTime() : null
  const isExpiryPast = expiryMs !== null && expiryMs < now
  const isNoSign = !!session.no_sign
  const canAdd = !isEnded && (isNoSign || !isExpiryPast)

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
          alreadyScheduled: existingFireAtMs.has(Math.round(ms / 1000)),
          isPast: ms - now < SAFETY_MARGIN_MS,
        })
      }
    }
    return chips
  }, [futureReminders, now, isNoSign, expiryMs, t])

  const anyChipViable = chipOptions.some((c) => !c.isPast && !c.alreadyScheduled)

  /**
   * Compute the notification body for a given fire-at, per-reminder.
   *
   * Bug this fixes: handleAdd and handleRemove previously used a single body
   * string for the WHOLE batch when re-calling /push/schedule. For expiry-
   * bearing sessions that meant retained reminders lost their original
   * "X min until your parking expires" copy and inherited whatever body was
   * convenient at the call site. Result: after editing your reminders, the
   * remaining ones could fire with "Your parking expires now" even when
   * they're set to fire 30 min before. Same per-reminder logic as
   * ReminderOptions.tsx — keep them in lock-step. If they diverge, the
   * first edit silently rewrites the body text the user originally chose.
   */
  const bodyForFireAt = (fireAt: Date): string => {
    if (isNoSign || expiryMs === null) {
      return t('reminders.pushBodyCheckOn')
    }
    const minsBefore = Math.round((expiryMs - fireAt.getTime()) / 60_000)
    if (minsBefore <= 0) return t('reminders.pushBodyAtExpiry')
    return t('reminders.pushBodyBefore', { count: minsBefore })
  }

  /**
   * Persist the new fire-at list to localStorage + cloud, then notify parent.
   * Wraps the two write paths in one place — every add/remove/cancel-all
   * funnels through here so they stay consistent.
   */
  const persistReminders = (newReminders: Array<{ fire_at: string }>) => {
    try {
      updateSession(session.id, { push_reminders: newReminders })
      if (user) mirrorSessionUpdateToCloud(session.id)
      setReminders(newReminders)
    } catch (err) {
      console.warn('[reminders] could not persist:', err)
      setError(t('scheduledReminders.errorRetry'))
    }
  }

  /**
   * Add one reminder by re-scheduling the UNION of existing + this new fire_at.
   * /push/schedule is replace-all, so we always send the full desired list.
   */
  const handleAdd = async (fireAt: Date) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const title = session.location?.address
        ? session.location.address
        : t('reminders.pushTitleFallback')
      // Build the union: existing future fire-times + the new one. Each entry
      // gets its OWN body string computed from its own fire_at — using one
      // shared body for the batch (the previous bug) would have rewritten
      // existing reminders' copy on every add. bodyForFireAt keeps each
      // entry honest to its actual offset.
      const desired: ScheduledReminder[] = [
        ...futureReminders.map((r) => ({
          fire_at: r.fire_at,
          title,
          body: bodyForFireAt(r.fireAt),
          url: `/?session=${session.id}`,
        })),
        {
          fire_at: fireAt.toISOString(),
          title,
          body: bodyForFireAt(fireAt),
          url: `/?session=${session.id}`,
        },
      ]
      const result = await schedulePushReminders(session.id, desired)
      if (result === null) {
        setError(t('scheduledReminders.pushNotEnabled'))
        setBusy(false)
        return
      }
      persistReminders(result.created.map((c) => ({ fire_at: c.fire_at })))
      setPicking(false)
    } catch (err) {
      console.error('[reminders] add failed:', err)
      setError(t('scheduledReminders.errorRetry'))
    } finally {
      setBusy(false)
    }
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
        // reminders[] with a 400; cancel is the right verb here.
        await cancelPushReminders(session.id)
        persistReminders([])
        return
      }
      const title = session.location?.address
        ? session.location.address
        : t('reminders.pushTitleFallback')
      // Per-reminder body — same bug-fix as handleAdd. Removing one row
      // shouldn't rewrite the surviving ones' "X min before expiry" copy
      // to a generic "Your parking expires now". Server stores whatever
      // body we send (no server-side rebuild), so we have to compute the
      // honest body for each retained fire_at here.
      const desired: ScheduledReminder[] = remaining.map((r) => ({
        fire_at: r.fire_at,
        title,
        body: bodyForFireAt(r.fireAt),
        url: `/?session=${session.id}`,
      }))
      const result = await schedulePushReminders(session.id, desired)
      if (result === null) {
        setError(t('scheduledReminders.errorRetry'))
        return
      }
      persistReminders(result.created.map((c) => ({ fire_at: c.fire_at })))
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
      await cancelPushReminders(session.id)
      persistReminders([])
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
    <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-3">
      <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-500 mb-3">
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
                {canAdd && (
                  <button
                    type="button"
                    onClick={() => void handleRemove(fire_at)}
                    disabled={busy}
                    aria-label={t('scheduledReminders.cancelOne')}
                    className="text-ink-500 hover:text-red-600 disabled:opacity-40 leading-none text-lg px-1 min-w-[44px] min-h-[44px] inline-flex items-center justify-center -my-1.5"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
          {error}
        </p>
      )}

      {canAdd && !picking && (
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setError(null)
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
              className="text-sm text-ink-600 hover:text-red-700 disabled:opacity-50 font-medium px-3 py-2.5 min-h-[44px] inline-flex items-center justify-center"
            >
              {t('scheduledReminders.cancelAll')}
            </button>
          )}
        </div>
      )}

      {canAdd && picking && (
        <div className="mt-2 p-3 rounded-xl bg-paper-50 border border-paper-200">
          <p className="text-xs font-semibold text-ink-700 mb-2">
            {t('scheduledReminders.pickHeader')}
          </p>
          {!anyChipViable ? (
            <p className="text-xs text-ink-500 leading-relaxed">
              {t('scheduledReminders.tooLateAll')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {chipOptions.map((chip) => {
                const disabled = chip.isPast || chip.alreadyScheduled || busy
                const base =
                  'px-3 py-2.5 min-h-[44px] inline-flex items-center justify-center rounded-full text-xs font-semibold border-2 transition-colors min-w-[72px] text-center'
                const cls = disabled
                  ? `${base} bg-paper-100 border-paper-200 text-ink-400 ${chip.isPast ? 'line-through' : ''} cursor-not-allowed`
                  : `${base} bg-white border-brand-300 text-brand-700 hover:bg-brand-50 active:bg-brand-100`
                const tip = chip.alreadyScheduled
                  ? 'Already scheduled'
                  : chip.isPast
                    ? 'Already past — would fire before now'
                    : `Fires at ${formatExpiryAbsolute(chip.fireAt, {
                        now: new Date(now),
                        timeZone,
                      }).combined}`
                return (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => !disabled && void handleAdd(chip.fireAt)}
                    disabled={disabled}
                    title={tip}
                    aria-label={`${chip.label} — ${tip}`}
                    className={cls}
                  >
                    {chip.label}
                  </button>
                )
              })}
            </div>
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
    </section>
  )
}
