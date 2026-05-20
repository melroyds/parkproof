// @vitest-environment node
//
// formatCountdown / formatCountdownLocalized / formatElapsedLocalized.
//
// These pure functions drive every minute-level UI moment in the app: the
// home active-session card's urgency colour, the result card's "x min left"
// label, the reminder picker's auto-disabling past offsets. A regression at
// any of the boundary conditions (1 min, 15 min, 60 min) silently produces
// the wrong urgency tier — which means green/amber/red on the card mislead
// the user. That's the failure surface this test file defends.

import { describe, expect, it } from 'vitest'
import {
  formatCountdown,
  formatCountdownLocalized,
  formatElapsedLocalized,
  type Urgency,
} from './countdown'

const min = (n: number) => n * 60_000
const hr = (n: number) => n * 60 * 60_000

// A minimal stub of i18next's `t` function. We don't need real translation —
// we just need to capture what KEY was requested + what variables were
// passed. The label-shape assertions inspect the captured call so the test
// stays decoupled from the actual en.json copy (which can change without
// breaking logic-level tests).
function makeT() {
  const calls: Array<{ key: string; opts?: Record<string, unknown> }> = []
  const t = ((key: string, opts?: Record<string, unknown>) => {
    calls.push({ key, opts })
    // Return a deterministic stub so any downstream string-handling sees a
    // real value. The actual content isn't asserted — the key+opts are.
    if (opts && 'count' in opts) return `${key}[${opts.count}]`
    if (opts && 'hours' in opts && 'mins' in opts) {
      return `${key}[${opts.hours}h${opts.mins}m]`
    }
    return key
    // The 4-arg overload of TFunction is fine to satisfy with `as any` here;
    // we don't need real i18next types in tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
  return { t, calls }
}

describe('formatCountdown — urgency tiers and labels', () => {
  describe('expired tier', () => {
    it('returns expired when msUntil is exactly 0', () => {
      const r = formatCountdown(0)
      expect(r.urgency).toBe<Urgency>('expired')
      expect(r.totalMinutes).toBe(0)
      expect(r.label).toBe('Move now')
    })

    it('returns expired when msUntil is negative (already past)', () => {
      const r = formatCountdown(-min(5))
      expect(r.urgency).toBe<Urgency>('expired')
      expect(r.totalMinutes).toBe(0)
    })
  })

  describe('urgent tier (≤ 15 min)', () => {
    it('treats sub-minute remainders as 1 min (ceil), not 0', () => {
      // 30s left should NOT show "Move now" — it should show "1 min left"
      // so the user knows they're at the edge but still inside the window.
      // Math.ceil(30_000 / 60_000) = 1; Math.max(1, …) handles the boundary.
      const r = formatCountdown(30_000)
      expect(r.totalMinutes).toBe(1)
      expect(r.urgency).toBe<Urgency>('urgent')
      expect(r.label).toBe('1 min left')
    })

    it('returns urgent at exactly 15 min', () => {
      const r = formatCountdown(min(15))
      expect(r.totalMinutes).toBe(15)
      expect(r.urgency).toBe<Urgency>('urgent')
      expect(r.label).toBe('15 min left')
    })

    it('singular "1 min" for the 1-min case', () => {
      const r = formatCountdown(min(1))
      expect(r.label).toBe('1 min left')
    })

    it('ceils sub-minute fractions up — 14m30s shows as "15 min left"', () => {
      const r = formatCountdown(min(14) + 30_000)
      expect(r.totalMinutes).toBe(15)
      expect(r.urgency).toBe<Urgency>('urgent')
    })
  })

  describe('warning tier (16-59 min)', () => {
    it('flips to warning at 16 min — one tick past urgent', () => {
      const r = formatCountdown(min(16))
      expect(r.totalMinutes).toBe(16)
      expect(r.urgency).toBe<Urgency>('warning')
      expect(r.label).toBe('16 min left')
    })

    it('stays warning at 59 min', () => {
      const r = formatCountdown(min(59))
      expect(r.urgency).toBe<Urgency>('warning')
      expect(r.label).toBe('59 min left')
    })
  })

  describe('normal tier (≥ 60 min)', () => {
    it('flips to normal at exactly 60 min, shown as "1 hour left"', () => {
      const r = formatCountdown(min(60))
      expect(r.totalMinutes).toBe(60)
      expect(r.urgency).toBe<Urgency>('normal')
      expect(r.label).toBe('1 hour left')
    })

    it('singular "1 hour" not "1 hours"', () => {
      const r = formatCountdown(hr(1))
      expect(r.label).toBe('1 hour left')
    })

    it('plural for 2+ hours when no minute remainder', () => {
      const r = formatCountdown(hr(3))
      expect(r.label).toBe('3 hours left')
    })

    it('uses "Xh Ym left" shape when both hours and mins are non-zero', () => {
      const r = formatCountdown(hr(2) + min(34))
      expect(r.totalMinutes).toBe(154)
      expect(r.label).toBe('2h 34m left')
      expect(r.urgency).toBe<Urgency>('normal')
    })

    it('handles a very long window without surprises (24h)', () => {
      const r = formatCountdown(hr(24))
      expect(r.totalMinutes).toBe(1440)
      expect(r.urgency).toBe<Urgency>('normal')
      expect(r.label).toBe('24 hours left')
    })
  })
})

describe('formatCountdownLocalized — defers labels to i18n', () => {
  it('requests time.moveNow on expired', () => {
    const { t, calls } = makeT()
    const r = formatCountdownLocalized(0, t)
    expect(r.urgency).toBe<Urgency>('expired')
    expect(calls).toEqual([{ key: 'time.moveNow', opts: undefined }])
  })

  it('requests time.minLeft with count for sub-hour readouts', () => {
    const { t, calls } = makeT()
    formatCountdownLocalized(min(7), t)
    expect(calls).toEqual([{ key: 'time.minLeft', opts: { count: 7 } }])
  })

  it('requests time.hourLeft singular on exactly 1h', () => {
    const { t, calls } = makeT()
    formatCountdownLocalized(hr(1), t)
    expect(calls).toEqual([{ key: 'time.hourLeft', opts: { count: 1 } }])
  })

  it('requests time.hoursLeft plural on whole-hour ≥ 2', () => {
    const { t, calls } = makeT()
    formatCountdownLocalized(hr(5), t)
    expect(calls).toEqual([{ key: 'time.hoursLeft', opts: { count: 5 } }])
  })

  it('requests time.hoursMinsLeft when there is a minute remainder', () => {
    const { t, calls } = makeT()
    formatCountdownLocalized(hr(2) + min(15), t)
    expect(calls).toEqual([{ key: 'time.hoursMinsLeft', opts: { hours: 2, mins: 15 } }])
  })

  it('preserves urgency + totalMinutes from raw formatCountdown', () => {
    const { t } = makeT()
    const r = formatCountdownLocalized(min(45), t)
    expect(r.urgency).toBe<Urgency>('warning')
    expect(r.totalMinutes).toBe(45)
  })
})

describe('formatElapsedLocalized — open-ended (no-sign) sessions', () => {
  it('returns 0 min on a freshly-started session', () => {
    const { t } = makeT()
    const r = formatElapsedLocalized(0, t)
    expect(r.totalMinutes).toBe(0)
  })

  it('floors fractional minutes — 90s elapsed is "1 min", not 2', () => {
    // Elapsed time uses FLOOR (you've been parked AT LEAST N minutes),
    // unlike countdown which uses CEIL (you have AT LEAST N minutes left).
    // Different semantic — different rounding. The test pins the contract.
    const { t } = makeT()
    const r = formatElapsedLocalized(90_000, t)
    expect(r.totalMinutes).toBe(1)
  })

  it('clamps negative elapsed (clock skew) to 0 min', () => {
    const { t } = makeT()
    const r = formatElapsedLocalized(-min(5), t)
    expect(r.totalMinutes).toBe(0)
  })

  it('uses time.parkedForMin for sub-hour elapsed', () => {
    const { t, calls } = makeT()
    formatElapsedLocalized(min(23), t)
    expect(calls).toEqual([{ key: 'time.parkedForMin', opts: { count: 23 } }])
  })

  it('uses time.parkedForHour singular at exactly 1 hour', () => {
    const { t, calls } = makeT()
    formatElapsedLocalized(hr(1), t)
    expect(calls).toEqual([{ key: 'time.parkedForHour', opts: { count: 1 } }])
  })

  it('uses time.parkedForHours plural at 2+ hours whole', () => {
    const { t, calls } = makeT()
    formatElapsedLocalized(hr(4), t)
    expect(calls).toEqual([{ key: 'time.parkedForHours', opts: { count: 4 } }])
  })

  it('uses time.parkedForHoursMins when both hours and mins present', () => {
    const { t, calls } = makeT()
    formatElapsedLocalized(hr(2) + min(14), t)
    expect(calls).toEqual([
      { key: 'time.parkedForHoursMins', opts: { hours: 2, mins: 14 } },
    ])
  })
})
