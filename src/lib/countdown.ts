export type Urgency = 'normal' | 'warning' | 'urgent' | 'expired'

export interface CountdownReadout {
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
