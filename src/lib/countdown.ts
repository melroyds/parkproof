import type { TFunction } from 'i18next'

export type Urgency = 'normal' | 'warning' | 'urgent' | 'expired'

export interface CountdownReadout {
  /** English label — kept for backwards compatibility with callers that
   *  haven't migrated to the i18n variant yet. New code should prefer
   *  formatCountdownLocalized(). */
  label: string
  urgency: Urgency
  totalMinutes: number
}

/**
 * Format "ms-until-expiry" into a human label + urgency level.
 *
 *   - expired or about to expire   → 'expired'
 *   - ≤ 15 min                     → 'urgent'
 *   - ≤ 60 min                     → 'warning'
 *   - more                         → 'normal'
 */
export function formatCountdown(msUntil: number): CountdownReadout {
  if (msUntil <= 0) {
    return { label: 'Move now', urgency: 'expired', totalMinutes: 0 }
  }
  const totalMinutes = Math.max(1, Math.ceil(msUntil / 60_000))
  if (totalMinutes <= 15) {
    return {
      label: totalMinutes === 1 ? '1 min left' : `${totalMinutes} min left`,
      urgency: 'urgent',
      totalMinutes,
    }
  }
  if (totalMinutes < 60) {
    return {
      label: `${totalMinutes} min left`,
      urgency: 'warning',
      totalMinutes,
    }
  }
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  if (mins === 0) {
    return {
      label: hours === 1 ? '1 hour left' : `${hours} hours left`,
      urgency: 'normal',
      totalMinutes,
    }
  }
  return {
    label: `${hours}h ${mins}m left`,
    urgency: 'normal',
    totalMinutes,
  }
}

/**
 * Locale-aware version of formatCountdown — produces the same structured
 * readout but the `label` is translated via i18next. Callers pass their own
 * `t` (from useTranslation) so this library file stays React-agnostic.
 *
 * Translation keys consumed: time.moveNow, time.minLeft (plural),
 * time.hourLeft (plural), time.hoursLeft (plural), time.hoursMinsLeft.
 */
export function formatCountdownLocalized(
  msUntil: number,
  t: TFunction,
): CountdownReadout {
  const raw = formatCountdown(msUntil)
  let label: string
  if (raw.urgency === 'expired') {
    label = t('time.moveNow')
  } else if (raw.totalMinutes < 60) {
    label = t('time.minLeft', { count: raw.totalMinutes })
  } else {
    const hours = Math.floor(raw.totalMinutes / 60)
    const mins = raw.totalMinutes % 60
    if (mins === 0) {
      label =
        hours === 1
          ? t('time.hourLeft', { count: hours })
          : t('time.hoursLeft', { count: hours })
    } else {
      label = t('time.hoursMinsLeft', { hours, mins })
    }
  }
  return { ...raw, label }
}

/**
 * Format "ms-since-arrival" into a human label for open-ended (no-sign)
 * sessions. These have no expiry, so there's no urgency — the value is just
 * a "how long you've been parked" indicator. Always returns urgency: 'normal'.
 *
 * Translation keys consumed: time.parkedForMin (plural), time.parkedForHour
 * (plural), time.parkedForHours (plural), time.parkedForHoursMins.
 */
export function formatElapsedLocalized(
  msSince: number,
  t: TFunction,
): { label: string; totalMinutes: number } {
  const totalMinutes = Math.max(0, Math.floor(msSince / 60_000))
  if (totalMinutes < 60) {
    return {
      label: t('time.parkedForMin', { count: totalMinutes }),
      totalMinutes,
    }
  }
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  if (mins === 0) {
    return {
      label:
        hours === 1
          ? t('time.parkedForHour', { count: hours })
          : t('time.parkedForHours', { count: hours }),
      totalMinutes,
    }
  }
  return {
    label: t('time.parkedForHoursMins', { hours, mins }),
    totalMinutes,
  }
}
