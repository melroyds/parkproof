// @vitest-environment node
//
// time-format — relative ("X mins ago"), absolute ("Move by …"), reminder
// time-line composition. Skeleton — fill in tomorrow.
//
// This file is in the suite because timezone-aware date formatting is the
// #1 silent breaker in any app that crosses a DST boundary. ParkProof
// pins display to the *parking spot's* timezone (not the device's), so any
// drift here corrupts the evidence PDF, the .ics calendar event, AND the
// home countdown card — three failure modes from one bug.

import { describe, it } from 'vitest'

describe('formatRelative (en-AU, untranslated)', () => {
  it.todo('"just now" for < 1 minute')
  it.todo('singular "1 min ago" at exactly 1 minute')
  it.todo('plural "5 min ago" at 5 minutes')
  it.todo('rolls up to "1 hour ago" at 60 min (round, not floor)')
  it.todo('"yesterday" at ~24h, not "1 days ago"')
  it.todo('"3 days ago" plural, beyond a day')
})

describe('formatRelativeLocalized', () => {
  it.todo('defers each case to the matching i18n key (justNow, minAgo, hourAgo, hoursAgo, yesterday, daysAgo)')
  it.todo('passes the count opt for plural-aware keys')
  it.todo('no count opt on justNow / yesterday (they are singular by definition)')
})

describe('formatExpiryAbsolute — same-day vs cross-day', () => {
  it.todo('returns time + null dayDate when expiry is the same calendar day as now (in TZ)')
  it.todo('returns time + dayDate when expiry is on a different calendar day')
  it.todo('respects the supplied timeZone — "now" in Sydney TZ vs Melbourne TZ at midnight may produce different same-day decisions')
  it.todo('handles ISO string input')
  it.todo('handles Date object input')
  it.todo('combined field reads "10:00 am" same-day, "10:00 am, Mon 18/05/2026" cross-day')
  it.todo('survives a DST forward jump without losing an hour')
  it.todo('survives a DST backward jump without doubling up')
})

describe('formatReminderTimesLine', () => {
  it.todo('empty list returns ""')
  it.todo('single time, today: just the time ("9:30 am")')
  it.todo('multi-time, today: comma-separated ("9:30 am, 9:45 am")')
  it.todo('multi-time, future day: "9:30 am, 9:45 am on Mon 18/05/2026" — suffix once')
  it.todo('mixed-day (rare): each time tagged with its own (Day DD/MM/YYYY)')
  it.todo('uses Australia/Melbourne when timeZone option not provided')
  it.todo('preserves order of the input list — does not auto-sort')
})
