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
  formatInZone,
  isSameDayInZone,
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

  it('defers each case to the matching i18n key (justNow, minAgo, hoursAgo, yesterday, daysAgo)', () => {
    const t = mockT()
    expect(formatRelativeLocalized(0, t)).toBe('time.justNow')
    expect(formatRelativeLocalized(5 * MIN, t)).toBe('time.minAgo:5')
    // One plural base for every hour count; i18next picks _one or _other.
    expect(formatRelativeLocalized(HOUR, t)).toBe('time.hoursAgo:1')
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

  it('with t, the future-day join comes from reminders.timesOnDay (no English "on" in other languages)', () => {
    const now = new Date('2026-05-21T08:00:00+10:00')
    const t = vi.fn((key: string, opts: { times: string; day: string }) => `[${key}] ${opts.day} / ${opts.times}`)
    const result = formatReminderTimesLine(
      [new Date('2026-05-22T09:30:00+10:00'), new Date('2026-05-22T09:45:00+10:00')],
      { timeZone: TZ, now, t: t as unknown as TFunction },
    )
    expect(t).toHaveBeenCalledTimes(1)
    expect(result).toMatch(/^\[reminders\.timesOnDay\] \w{3} 22\/05\/2026 \/ 9:30 am, 9:45 am$/i)
    expect(result).not.toContain(' on ')
    // Today needs no join, so no key.
    formatReminderTimesLine([new Date('2026-05-21T09:30:00+10:00')], { timeZone: TZ, now, t: t as unknown as TFunction })
    expect(t).toHaveBeenCalledTimes(1)
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

describe('formatInZone (N5): the record zone, with its short name', () => {
  it('names the zone either side of the Melbourne DST change (4 Oct 2026, 2 am)', () => {
    // 3 Oct 2026, 11:30 pm AEST (UTC+10) and 4 Oct 2026, 3:30 am AEDT (UTC+11).
    expect(formatInZone('2026-10-03T13:30:00.000Z', 'Australia/Melbourne')).toBe('Sat 3 Oct, 11:30 pm AEST')
    expect(formatInZone('2026-10-03T16:30:00.000Z', 'Australia/Melbourne')).toBe('Sun 4 Oct, 3:30 am AEDT')
    // The same instant in Brisbane, which has no DST.
    expect(formatInZone('2026-10-03T16:30:00.000Z', 'Australia/Brisbane')).toBe('Sun 4 Oct, 2:30 am AEST')
  })

  it('adds the year on request, and drops the zone on request', () => {
    expect(formatInZone('2026-10-25T02:55:00.000Z', 'Australia/Melbourne', { withYear: true })).toBe(
      'Sun 25 Oct 2026, 1:55 pm AEDT',
    )
    expect(formatInZone('2026-10-25T02:55:00.000Z', 'Australia/Melbourne', { withZone: false })).toBe('Sun 25 Oct, 1:55 pm')
    expect(formatInZone(Date.parse('2026-10-25T02:55:00.000Z'), 'Australia/Perth')).toBe('Sun 25 Oct, 10:55 am AWST')
    expect(formatInZone(new Date('2026-06-01T00:05:00.000Z'), 'Australia/Adelaide')).toBe('Mon 1 June, 9:35 am ACST')
  })

  it('midnight and noon read as 12', () => {
    expect(formatInZone('2026-10-25T13:00:00.000Z', 'Australia/Melbourne')).toBe('Mon 26 Oct, 12:00 am AEDT')
    expect(formatInZone('2026-10-25T01:00:00.000Z', 'Australia/Melbourne')).toBe('Sun 25 Oct, 12:00 pm AEDT')
  })

  it('a bad value shows as text; an unknown zone falls back to Melbourne', () => {
    expect(formatInZone('not a time', 'Australia/Melbourne')).toBe('not a time')
    expect(formatInZone('2026-10-25T02:55:00.000Z', 'Mars/Olympus')).toBe('Sun 25 Oct, 1:55 pm AEDT')
  })
})

describe('formatInZone without the date, and isSameDayInZone (fix list item 6)', () => {
  it('withDate false gives only the time, with the zone unless dropped', () => {
    expect(formatInZone('2026-11-08T06:23:23.000Z', 'Australia/Melbourne', { withDate: false })).toBe('5:23 pm AEDT')
    expect(formatInZone('2026-11-08T06:23:23.000Z', 'Australia/Perth', { withDate: false })).toBe('2:23 pm AWST')
    expect(formatInZone('2026-11-08T06:23:23.000Z', 'Australia/Melbourne', { withDate: false, withZone: false })).toBe(
      '5:23 pm',
    )
    // The year needs the date: asking for it without the date changes nothing.
    expect(formatInZone('2026-11-08T06:23:23.000Z', 'Australia/Melbourne', { withDate: false, withYear: true })).toBe(
      '5:23 pm AEDT',
    )
  })

  it('compares calendar days in the given zone, not the device zone', () => {
    // 11:30 pm and 11:50 pm AEDT on Sun 8 Nov are the same Melbourne day...
    expect(isSameDayInZone('2026-11-08T12:30:00.000Z', '2026-11-08T12:50:00.000Z', 'Australia/Melbourne')).toBe(true)
    // ...but 12:30 am AEDT on Mon 9 Nov is the next one, while in Perth
    // (9:30 pm AWST, Sun 8 Nov) it is still the same day.
    expect(isSameDayInZone('2026-11-08T12:30:00.000Z', '2026-11-08T13:30:00.000Z', 'Australia/Melbourne')).toBe(false)
    expect(isSameDayInZone('2026-11-08T12:30:00.000Z', '2026-11-08T13:30:00.000Z', 'Australia/Perth')).toBe(true)
  })

  it('answers false for an unreadable time or an unknown zone', () => {
    expect(isSameDayInZone('not a time', '2026-11-08T06:00:00.000Z', 'Australia/Melbourne')).toBe(false)
    expect(isSameDayInZone('2026-11-08T06:00:00.000Z', '2026-11-08T06:01:00.000Z', 'Mars/Olympus')).toBe(false)
  })
})
