// @vitest-environment node
//
// time-format — relative ("X mins ago"), absolute ("Move by …"), reminder
// time-line composition.
//
// This file is in the suite because timezone-aware date formatting is the
// #1 silent breaker in any app that crosses a DST boundary. ParkProof
// pins display to the *parking spot's* timezone (not the device's), so any
// drift here corrupts the evidence PDF, the .ics calendar event, AND the
// home countdown card — three failure modes from one bug.

import { describe, it, expect, vi } from 'vitest'
import type { TFunction } from 'i18next'
import {
  formatRelative,
  formatRelativeLocalized,
  formatExpiryAbsolute,
  formatReminderTimesLine,
} from './time-format'

// Convenience — ms in higher units.
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('formatRelative (en-AU, untranslated)', () => {
  it('"just now" for < 1 minute', () => {
    expect(formatRelative(0)).toBe('just now')
    expect(formatRelative(29_000)).toBe('just now') // 29s rounds to 0 min
  })

  it('singular "1 min ago" at exactly 1 minute', () => {
    expect(formatRelative(MIN)).toBe('1 min ago')
  })

  it('plural "5 min ago" at 5 minutes', () => {
    expect(formatRelative(5 * MIN)).toBe('5 min ago')
  })

  it('rolls up to "1 hour ago" at 60 min (round, not floor)', () => {
    expect(formatRelative(HOUR)).toBe('1 hour ago')
    // 5 hours — plural
    expect(formatRelative(5 * HOUR)).toBe('5 hours ago')
  })

  it('"yesterday" at ~24h, not "1 days ago"', () => {
    expect(formatRelative(DAY)).toBe('yesterday')
  })

  it('"3 days ago" plural, beyond a day', () => {
    expect(formatRelative(3 * DAY)).toBe('3 days ago')
  })
})

describe('formatRelativeLocalized', () => {
  // Mock TFunction that just echoes the key + count for assertion convenience.
  // Real i18next.t() returns translated strings; we only need to confirm the
  // RIGHT KEY is being called with the RIGHT count for the right input.
  function mockT(): TFunction {
    return ((key: string, opts?: { count?: number }) => {
      if (opts && 'count' in opts) return `${key}:${opts.count}`
      return key
    }) as unknown as TFunction
  }

  it('defers each case to the matching i18n key (justNow, minAgo, hourAgo, hoursAgo, yesterday, daysAgo)', () => {
    const t = mockT()
    expect(formatRelativeLocalized(0, t)).toBe('time.justNow')
    expect(formatRelativeLocalized(5 * MIN, t)).toBe('time.minAgo:5')
    expect(formatRelativeLocalized(HOUR, t)).toBe('time.hourAgo:1')
    expect(formatRelativeLocalized(5 * HOUR, t)).toBe('time.hoursAgo:5')
    expect(formatRelativeLocalized(DAY, t)).toBe('time.yesterday')
    expect(formatRelativeLocalized(3 * DAY, t)).toBe('time.daysAgo:3')
  })

  it('passes the count opt for plural-aware keys', () => {
    const t = vi.fn((key: string, opts?: { count?: number }) => `${key}|count=${opts?.count}`)
    formatRelativeLocalized(7 * MIN, t as unknown as TFunction)
    expect(t).toHaveBeenCalledWith('time.minAgo', { count: 7 })
    formatRelativeLocalized(2 * HOUR, t as unknown as TFunction)
    expect(t).toHaveBeenCalledWith('time.hoursAgo', { count: 2 })
    formatRelativeLocalized(4 * DAY, t as unknown as TFunction)
    expect(t).toHaveBeenCalledWith('time.daysAgo', { count: 4 })
  })

  it('no count opt on justNow / yesterday (they are singular by definition)', () => {
    const t = vi.fn((key: string) => key)
    formatRelativeLocalized(0, t as unknown as TFunction)
    expect(t).toHaveBeenLastCalledWith('time.justNow')
    formatRelativeLocalized(DAY, t as unknown as TFunction)
    expect(t).toHaveBeenLastCalledWith('time.yesterday')
  })
})

describe('formatExpiryAbsolute — same-day vs cross-day', () => {
  it('returns time + null dayDate when expiry is the same calendar day as now (in TZ)', () => {
    const now = new Date('2026-05-21T01:00:00+10:00') // 1am AEST
    const expiry = '2026-05-21T15:30:00+10:00' // 3:30pm AEST same day
    const r = formatExpiryAbsolute(expiry, { timeZone: 'Australia/Melbourne', now })
    expect(r.dayDate).toBeNull()
    expect(r.time).toMatch(/3:30 pm/i)
    expect(r.combined).toBe(r.time)
  })

  it('returns time + dayDate when expiry is on a different calendar day', () => {
    const now = new Date('2026-05-21T23:00:00+10:00') // Wed 11pm AEST
    const expiry = '2026-05-22T08:00:00+10:00' // Thu 8am AEST — next day
    const r = formatExpiryAbsolute(expiry, { timeZone: 'Australia/Melbourne', now })
    expect(r.dayDate).not.toBeNull()
    // en-AU short weekday for 22 May 2026 is "Fri" (May 22 2026 = Friday)
    expect(r.dayDate).toMatch(/^[A-Z][a-z]{2} \d{1,2}\/\d{1,2}\/\d{4}$/)
    expect(r.combined).toContain(r.time)
    expect(r.combined).toContain(r.dayDate as string)
  })

  it('respects the supplied timeZone — same UTC instants, different TZ → different same-day decision', () => {
    // Same UTC instants for expiry + now. In Melbourne (+10) both fall on
    // May 21 evening (same day). In Honolulu (-10) expiry is May 20 10pm
    // and now is May 21 2am (different days — the local midnight falls
    // between them).
    const expiry = new Date('2026-05-21T08:00:00Z') // UTC 8am
    const now = new Date('2026-05-21T12:00:00Z') // UTC noon — 4h later

    const rMel = formatExpiryAbsolute(expiry, { timeZone: 'Australia/Melbourne', now })
    const rHST = formatExpiryAbsolute(expiry, { timeZone: 'Pacific/Honolulu', now })

    expect(rMel.dayDate).toBeNull()
    expect(rHST.dayDate).not.toBeNull()
  })

  it('handles ISO string input', () => {
    const r = formatExpiryAbsolute('2026-05-21T15:00:00+10:00', {
      now: new Date('2026-05-21T10:00:00+10:00'),
    })
    expect(r.time).toMatch(/3:00 pm/i)
  })

  it('handles Date object input', () => {
    const r = formatExpiryAbsolute(new Date('2026-05-21T15:00:00+10:00'), {
      now: new Date('2026-05-21T10:00:00+10:00'),
    })
    expect(r.time).toMatch(/3:00 pm/i)
  })

  it('combined reads "TIME" same-day, "TIME, Day DD/MM/YYYY" cross-day', () => {
    const sameDay = formatExpiryAbsolute('2026-05-21T15:30:00+10:00', {
      timeZone: 'Australia/Melbourne',
      now: new Date('2026-05-21T08:00:00+10:00'),
    })
    expect(sameDay.combined).not.toContain(',')

    const crossDay = formatExpiryAbsolute('2026-05-22T15:30:00+10:00', {
      timeZone: 'Australia/Melbourne',
      now: new Date('2026-05-21T08:00:00+10:00'),
    })
    expect(crossDay.combined).toContain(',')
  })

  it('survives a DST forward jump without losing an hour', () => {
    // Australia/Melbourne forward jump: first Sun of Oct, 2am AEST → 3am AEDT.
    // For 2026 that's 2026-10-04. Scan before, expire after.
    // 2026-10-03T23:00:00+10:00 = Sat 11pm AEST
    // 2026-10-04T10:00:00+11:00 = Sun 10am AEDT (same UTC = 23:00 UTC Sat)
    // The expiry is 12 wall-clock hours later but only 11 elapsed (DST ate one).
    const now = new Date('2026-10-03T23:00:00+10:00')
    const expiry = '2026-10-04T10:00:00+11:00'
    const r = formatExpiryAbsolute(expiry, { timeZone: 'Australia/Melbourne', now })
    // The dayDate should be set (cross-day) and the time should read 10:00 am.
    expect(r.dayDate).not.toBeNull()
    expect(r.time).toMatch(/10:00 am/i)
  })

  it('survives a DST backward jump without doubling up', () => {
    // Australia/Melbourne backward jump: first Sun of Apr, 3am AEDT → 2am AEST.
    // For 2026 that's 2026-04-05. The 2:30 am happens TWICE that morning.
    // Use the unambiguous +11:00 instance (the first 2:30 am, in AEDT).
    const now = new Date('2026-04-04T20:00:00+11:00') // Sat 8pm AEDT
    const expiry = '2026-04-05T02:30:00+11:00' // first 2:30am AEDT (before fallback)
    const r = formatExpiryAbsolute(expiry, { timeZone: 'Australia/Melbourne', now })
    // The output should not crash, should still emit a valid time string.
    expect(r.time).toMatch(/^\d{1,2}:\d{2} (am|pm)$/i)
    expect(r.dayDate).not.toBeNull()
  })
})

describe('formatReminderTimesLine', () => {
  const TZ = 'Australia/Melbourne'

  it('empty list returns ""', () => {
    expect(formatReminderTimesLine([])).toBe('')
  })

  it('single time, today: just the time ("9:30 am")', () => {
    const now = new Date('2026-05-21T08:00:00+10:00')
    const result = formatReminderTimesLine([new Date('2026-05-21T09:30:00+10:00')], {
      timeZone: TZ,
      now,
    })
    expect(result).toMatch(/^9:30 am$/i)
  })

  it('multi-time, today: comma-separated ("9:30 am, 9:45 am")', () => {
    const now = new Date('2026-05-21T08:00:00+10:00')
    const result = formatReminderTimesLine(
      [new Date('2026-05-21T09:30:00+10:00'), new Date('2026-05-21T09:45:00+10:00')],
      { timeZone: TZ, now },
    )
    expect(result).toMatch(/^9:30 am, 9:45 am$/i)
  })

  it('multi-time, future day: "9:30 am, 9:45 am on Day DD/MM/YYYY" — suffix once', () => {
    const now = new Date('2026-05-21T08:00:00+10:00')
    const result = formatReminderTimesLine(
      [new Date('2026-05-22T09:30:00+10:00'), new Date('2026-05-22T09:45:00+10:00')],
      { timeZone: TZ, now },
    )
    // Suffix appears exactly once.
    expect(result).toMatch(/9:30 am, 9:45 am on /i)
    // The day-date appears at the end, not inline.
    expect((result.match(/\d{1,2}\/\d{1,2}\/\d{4}/g) ?? []).length).toBe(1)
  })

  it('mixed-day (rare): each time tagged with its own (Day DD/MM/YYYY)', () => {
    const now = new Date('2026-05-21T08:00:00+10:00')
    const result = formatReminderTimesLine(
      [new Date('2026-05-21T22:00:00+10:00'), new Date('2026-05-22T08:00:00+10:00')],
      { timeZone: TZ, now },
    )
    // Two parenthesised day-date annotations, one per time.
    expect((result.match(/\(/g) ?? []).length).toBe(2)
    expect((result.match(/\)/g) ?? []).length).toBe(2)
  })

  it('uses Australia/Melbourne when timeZone option not provided', () => {
    // Provide a now/expiry pair where the AEDT/AEST default matters. We use
    // a UTC moment that's "still today" in Melbourne but "tomorrow" in UTC.
    // 2026-05-21 23:30 +10:00 = 13:30 UTC = same day in UTC, same day in Melbourne.
    // Pick something tighter: same day in Melbourne, different day if treated as UTC.
    // 2026-05-21 09:30 +10:00 = 23:30 May 20 UTC. So a "now" of 2026-05-21 09:00 +10:00.
    const now = new Date('2026-05-21T09:00:00+10:00')
    const expiry = new Date('2026-05-21T09:30:00+10:00')
    const r = formatReminderTimesLine([expiry], { now })
    // Should treat as same day (Melbourne default), so just the time, no day-date.
    expect(r).toMatch(/^9:30 am$/i)
  })

  it('preserves order of the input list — does not auto-sort', () => {
    const now = new Date('2026-05-21T08:00:00+10:00')
    const result = formatReminderTimesLine(
      [new Date('2026-05-21T10:00:00+10:00'), new Date('2026-05-21T09:30:00+10:00')],
      { timeZone: TZ, now },
    )
    // Caller passed 10:00 first, then 9:30. The function must NOT reorder
    // — the ReminderOptions UI sometimes emits a specific display order
    // (e.g. "fire at expiry first, then earlier warnings") that callers rely on.
    expect(result.indexOf('10:00 am')).toBeLessThan(result.indexOf('9:30 am'))
  })
})
