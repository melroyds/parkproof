// Street sweeping and weekly reminders (T5a): the pure maths. Every day
// and time is a wall-clock time in the rule's own zone, so these pin the
// instants across both Melbourne daylight saving changes of the coming
// year (clocks forward 2026-10-04 at 2 am, back 2027-04-04 at 3 am) and
// in Brisbane, which has none.
import { describe, expect, it } from 'vitest'
import type { RecurringRestriction, RecurringRule } from '../types'
import {
  changesCalendar,
  eveningLeadMinutes,
  firstOccurrence,
  localDateInZone,
  nextDateOnDays,
  nextOccurrence,
  nextOccurrenceWithin,
  normalizeRecurringRule,
  occursOn,
  recurringReminderTag,
  recurringRestrictionsOf,
  reminderFireTimes,
  sameSchedule,
  rruleFor,
  ruleFromRestriction,
  upcomingOccurrences,
  upcomingReminderFires,
  zonedWallClock,
  zonedWallClockToUtc,
} from './recurring'

const MEL = 'Australia/Melbourne'
const BNE = 'Australia/Brisbane'
const ID = '0b0e7f4e-3c3a-4d5e-9f00-1a2b3c4d5e6f'
const HOUR = 3600_000

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: ID,
    label: '',
    kind: 'street_cleaning',
    days: ['TU'],
    start: '07:00',
    end: '09:00',
    frequency: 'weekly',
    nth: [],
    anchor_date: '2026-01-01',
    timezone: MEL,
    address: null,
    remind_evening_before: null,
    remind_minutes_before: null,
    push: false,
    paused: false,
    sequence: 0,
    ...overrides,
  }
}

const iso = (d: Date | undefined | null) => d?.toISOString()

describe('zonedWallClockToUtc', () => {
  it('reads a Melbourne wall-clock time with the offset in force that day', () => {
    // Winter, AEST (+10).
    expect(iso(zonedWallClockToUtc({ year: 2026, month: 7, day: 14, hour: 7, minute: 0 }, MEL))).toBe('2026-07-13T21:00:00.000Z')
    // Summer, AEDT (+11).
    expect(iso(zonedWallClockToUtc({ year: 2027, month: 1, day: 12, hour: 7, minute: 0 }, MEL))).toBe('2027-01-11T20:00:00.000Z')
  })

  it('shifts a time in the skipped hour forward by the gap (2:30 am on 4 Oct 2026 is 3:30 am AEDT)', () => {
    const at = zonedWallClockToUtc({ year: 2026, month: 10, day: 4, hour: 2, minute: 30 }, MEL)
    expect(iso(at)).toBe('2026-10-03T16:30:00.000Z')
    expect(zonedWallClock(at, MEL)).toMatchObject({ day: 4, hour: 3, minute: 30 })
  })

  it('takes the earlier instant for a time that happens twice (2:30 am on 4 Apr 2027)', () => {
    // 2:30 am AEDT comes first (15:30Z); 2:30 am AEST an hour later (16:30Z).
    expect(iso(zonedWallClockToUtc({ year: 2027, month: 4, day: 4, hour: 2, minute: 30 }, MEL))).toBe('2027-04-03T15:30:00.000Z')
  })

  it('handles the hours either side of each change', () => {
    expect(iso(zonedWallClockToUtc({ year: 2026, month: 10, day: 4, hour: 1, minute: 59 }, MEL))).toBe('2026-10-03T15:59:00.000Z')
    expect(iso(zonedWallClockToUtc({ year: 2026, month: 10, day: 4, hour: 3, minute: 0 }, MEL))).toBe('2026-10-03T16:00:00.000Z')
    expect(iso(zonedWallClockToUtc({ year: 2027, month: 4, day: 4, hour: 3, minute: 0 }, MEL))).toBe('2027-04-03T17:00:00.000Z')
  })

  it('never shifts in Brisbane (AEST all year)', () => {
    expect(iso(zonedWallClockToUtc({ year: 2026, month: 10, day: 4, hour: 2, minute: 30 }, BNE))).toBe('2026-10-03T16:30:00.000Z')
    expect(iso(zonedWallClockToUtc({ year: 2027, month: 1, day: 12, hour: 7, minute: 0 }, BNE))).toBe('2027-01-11T21:00:00.000Z')
  })

  it('reads the local date in the zone, not UTC', () => {
    // 21:00Z on the 13th is 7 am on the 14th in Melbourne.
    expect(localDateInZone(new Date('2026-07-13T21:00:00Z'), MEL)).toBe('2026-07-14')
  })
})

describe('next occurrence, weekly', () => {
  const sunday = rule({ days: ['SU'] })

  it('keeps a Sunday 7 am sweep at 7 am local across the October 2026 change', () => {
    // Sat 19 Sep, 10 pm in Melbourne.
    const occ = upcomingOccurrences(sunday, new Date('2026-09-19T12:00:00Z'), 3)
    expect(occ.map((o) => o.date)).toEqual(['2026-09-20', '2026-09-27', '2026-10-04'])
    expect(occ.map((o) => iso(o.start))).toEqual([
      '2026-09-19T21:00:00.000Z', // AEST
      '2026-09-26T21:00:00.000Z', // AEST
      '2026-10-03T20:00:00.000Z', // AEDT, the morning the clocks went forward
    ])
    for (const o of occ) expect(zonedWallClock(o.start, MEL)).toMatchObject({ hour: 7, minute: 0 })
  })

  it('keeps it at 7 am local across the April 2027 change', () => {
    const occ = upcomingOccurrences(sunday, new Date('2027-03-27T00:00:00Z'), 2)
    expect(occ.map((o) => iso(o.start))).toEqual([
      '2027-03-27T20:00:00.000Z', // Sun 28 Mar, AEDT
      '2027-04-03T21:00:00.000Z', // Sun 4 Apr, AEST again
    ])
  })

  it('in Brisbane, the same rule is 21:00Z the day before every week', () => {
    const occ = upcomingOccurrences({ ...sunday, timezone: BNE }, new Date('2026-09-26T00:00:00Z'), 2)
    expect(occ.map((o) => iso(o.start))).toEqual(['2026-09-26T21:00:00.000Z', '2026-10-03T21:00:00.000Z'])
  })

  it('returns the occurrence still running, then the next one once it has ended', () => {
    const tue = rule()
    // Tue 3 Nov 2026 7:00 to 9:00 AEDT = 20:00Z to 22:00Z on the 2nd.
    const during = nextOccurrence(tue, new Date('2026-11-02T21:00:00Z'))
    expect(iso(during?.start)).toBe('2026-11-02T20:00:00.000Z')
    expect(iso(during?.end)).toBe('2026-11-02T22:00:00.000Z')
    const after = nextOccurrence(tue, new Date('2026-11-02T22:00:00Z'))
    expect(after?.date).toBe('2026-11-10')
  })

  it('ends an overnight restriction on the next day, and finds it running after midnight', () => {
    const overnight = rule({ days: ['FR'], start: '22:00', end: '06:00' })
    // Fri 6 Nov 2026 10 pm AEDT to Sat 7 Nov 6 am AEDT.
    const occ = nextOccurrence(overnight, new Date('2026-11-06T16:00:00Z')) // Sat 3 am local
    expect(occ?.date).toBe('2026-11-06')
    expect(iso(occ?.start)).toBe('2026-11-06T11:00:00.000Z')
    expect(iso(occ?.end)).toBe('2026-11-06T19:00:00.000Z')
  })

  it('lists several days in week order', () => {
    // Sun 1 Nov, 11 pm in Melbourne.
    const occ = upcomingOccurrences(rule({ days: ['MO', 'TH'] }), new Date('2026-11-01T12:00:00Z'), 3)
    expect(occ.map((o) => `${o.weekday} ${o.date}`)).toEqual(['MO 2026-11-02', 'TH 2026-11-05', 'MO 2026-11-09'])
  })

  it('never returns a date before the anchor date', () => {
    const r = rule({ anchor_date: '2026-11-11' })
    expect(nextOccurrence(r, new Date('2026-11-01T00:00:00Z'))?.date).toBe('2026-11-17')
    expect(occursOn(r, '2026-11-10')).toBe(false)
  })
})

describe('fortnightly (anchor_date)', () => {
  it('occurs in the anchor week and every second week after it, never in between', () => {
    const r = rule({ frequency: 'fortnightly', anchor_date: '2026-10-06' })
    expect(upcomingOccurrences(r, new Date('2026-09-28T00:00:00Z'), 3).map((o) => o.date)).toEqual([
      '2026-10-06',
      '2026-10-20',
      '2026-11-03',
    ])
    expect(occursOn(r, '2026-10-13')).toBe(false)
    // Two weeks before the anchor is an even week too, but before the anchor.
    expect(occursOn(r, '2026-09-22')).toBe(false)
  })

  it('counts weeks Monday to Sunday: an anchor mid-week makes that whole week an "on" week', () => {
    // Anchor Wednesday 7 Oct; the rule is Thursdays and Mondays.
    const r = rule({ frequency: 'fortnightly', anchor_date: '2026-10-07', days: ['MO', 'TH'] })
    expect(upcomingOccurrences(r, new Date('2026-10-01T00:00:00Z'), 4).map((o) => o.date)).toEqual([
      '2026-10-08', // Thu of the anchor week (its Monday, 5 Oct, is before the anchor)
      '2026-10-19',
      '2026-10-22',
      '2026-11-02',
    ])
  })

  it('stays at 7 am local across both daylight saving changes', () => {
    const r = rule({ frequency: 'fortnightly', anchor_date: '2026-09-27', days: ['SU'] })
    const occ = upcomingOccurrences(r, new Date('2026-09-26T00:00:00Z'), 2)
    expect(occ.map((o) => iso(o.start))).toEqual(['2026-09-26T21:00:00.000Z', '2026-10-10T20:00:00.000Z'])
    const april = rule({ frequency: 'fortnightly', anchor_date: '2027-03-28', days: ['SU'] })
    expect(upcomingOccurrences(april, new Date('2027-03-27T00:00:00Z'), 2).map((o) => iso(o.start))).toEqual([
      '2027-03-27T20:00:00.000Z',
      '2027-04-10T21:00:00.000Z',
    ])
  })

  it('in Brisbane, keeps the same UTC time every fortnight', () => {
    const r = rule({ frequency: 'fortnightly', anchor_date: '2026-09-27', days: ['SU'], timezone: BNE })
    expect(upcomingOccurrences(r, new Date('2026-09-26T00:00:00Z'), 2).map((o) => iso(o.start))).toEqual([
      '2026-09-26T21:00:00.000Z',
      '2026-10-10T21:00:00.000Z',
    ])
  })
})

describe('monthly_nth', () => {
  it('picks the 1st and 3rd Tuesday of each month', () => {
    const r = rule({ frequency: 'monthly_nth', nth: [1, 3] })
    expect(upcomingOccurrences(r, new Date('2026-10-31T00:00:00Z'), 4).map((o) => o.date)).toEqual([
      '2026-11-03',
      '2026-11-17',
      '2026-12-01',
      '2026-12-15',
    ])
  })

  it('skips months without a fifth weekday', () => {
    const r = rule({ frequency: 'monthly_nth', nth: [5] })
    // Fifth Tuesdays: 29 Sep 2026, 29 Dec 2026, 30 Mar 2027.
    expect(upcomingOccurrences(r, new Date('2026-09-01T00:00:00Z'), 3).map((o) => o.date)).toEqual([
      '2026-09-29',
      '2026-12-29',
      '2027-03-30',
    ])
  })

  it('keeps the first Sunday at 7 am local on the day the clocks change', () => {
    const r = rule({ frequency: 'monthly_nth', nth: [1], days: ['SU'] })
    const occ = upcomingOccurrences(r, new Date('2026-09-15T00:00:00Z'), 1)[0]
    expect(occ.date).toBe('2026-10-04')
    expect(iso(occ.start)).toBe('2026-10-03T20:00:00.000Z')
    const april = upcomingOccurrences(r, new Date('2027-03-15T00:00:00Z'), 1)[0]
    expect(april.date).toBe('2027-04-04')
    expect(iso(april.start)).toBe('2027-04-03T21:00:00.000Z')
  })
})

describe('reminder fire times', () => {
  const r = rule({ days: ['SU'], remind_evening_before: '20:00', remind_minutes_before: 60 })

  it('fires the evening before at 8 pm local and an hour before the start, on the night the clocks go forward', () => {
    const occ = nextOccurrence(r, new Date('2026-10-01T00:00:00Z'))!
    expect(occ.date).toBe('2026-10-04')
    const fires = reminderFireTimes(r, occ)
    expect(fires.map((f) => [f.kind, iso(f.fireAt)])).toEqual([
      ['evening', '2026-10-03T10:00:00.000Z'], // Sat 8 pm AEST
      ['before', '2026-10-03T19:00:00.000Z'], // Sun 6 am AEDT
    ])
    expect(zonedWallClock(fires[0].fireAt, MEL)).toMatchObject({ day: 3, hour: 20, minute: 0 })
  })

  it('fires the evening before at 8 pm local on the night the clocks go back', () => {
    const occ = nextOccurrence(r, new Date('2027-04-01T00:00:00Z'))!
    expect(occ.date).toBe('2027-04-04')
    const [evening] = reminderFireTimes(r, occ)
    expect(iso(evening.fireAt)).toBe('2027-04-03T09:00:00.000Z') // Sat 8 pm AEDT
  })

  it('lists only the fires inside the horizon, earliest first, and none for a paused rule', () => {
    const now = new Date('2026-10-03T00:00:00Z')
    const fires = upcomingReminderFires(r, now, 24 * HOUR)
    expect(fires.map((f) => iso(f.fireAt))).toEqual(['2026-10-03T10:00:00.000Z', '2026-10-03T19:00:00.000Z'])
    expect(upcomingReminderFires(r, new Date('2026-10-03T11:00:00Z'), 24 * HOUR).map((f) => f.kind)).toEqual(['before'])
    expect(upcomingReminderFires({ ...r, paused: true }, now, 24 * HOUR)).toEqual([])
  })

  it('gives each reminder its own notification tag', () => {
    const at = new Date('2026-10-03T10:00:00Z')
    expect(recurringReminderTag(ID, at)).toBe(`pp-r-${ID}-${at.getTime()}`)
  })

  it('works out the calendar lead time for the evening reminder', () => {
    expect(eveningLeadMinutes(r)).toBe(11 * 60)
    expect(eveningLeadMinutes(rule({ start: '13:30', remind_evening_before: '19:00' }))).toBe(18 * 60 + 30)
    expect(eveningLeadMinutes(rule())).toBeNull()
  })
})

describe('nextOccurrenceWithin (the home row)', () => {
  const now = new Date('2026-11-02T00:00:00Z') // Mon 11 am AEDT

  it('names the soonest active rule starting within the window', () => {
    const tue = rule({ id: '11111111-1111-4111-8111-111111111111' }) // Tue 7 am = in 9 h
    const mon = rule({ id: '22222222-2222-4222-8222-222222222222', days: ['MO'], start: '18:00', end: '19:00' }) // in 7 h
    const pausedSooner = rule({ id: '33333333-3333-4333-8333-333333333333', days: ['MO'], start: '12:00', end: '13:00', paused: true })
    const soon = nextOccurrenceWithin([tue, mon, pausedSooner], now, 24 * HOUR)
    expect(soon?.rule.id).toBe(mon.id)
    expect(iso(soon?.occurrence.start)).toBe('2026-11-02T07:00:00.000Z')
  })

  it('is null when nothing starts within the window', () => {
    expect(nextOccurrenceWithin([rule({ days: ['TH'] })], now, 24 * HOUR)).toBeNull()
    expect(nextOccurrenceWithin([], now, 24 * HOUR)).toBeNull()
  })
})

describe('calendar pieces', () => {
  it('writes the RRULE for each frequency', () => {
    expect(rruleFor(rule())).toBe('FREQ=WEEKLY;BYDAY=TU')
    expect(rruleFor(rule({ days: ['TH', 'MO'] }))).toBe('FREQ=WEEKLY;BYDAY=MO,TH')
    expect(rruleFor(rule({ frequency: 'fortnightly' }))).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;WKST=MO')
    expect(rruleFor(rule({ frequency: 'monthly_nth', nth: [3, 1] }))).toBe('FREQ=MONTHLY;BYDAY=1TU,3TU')
  })

  it('starts the event at the first occurrence on or after the anchor date', () => {
    expect(firstOccurrence(rule({ anchor_date: '2026-11-04' }))?.date).toBe('2026-11-10')
    expect(firstOccurrence(rule({ frequency: 'monthly_nth', nth: [3], anchor_date: '2026-11-04' }))?.date).toBe('2026-11-17')
  })

  it('knows two rules for the same restriction at the same place', () => {
    const other = '99999999-9999-4999-8999-999999999999'
    expect(sameSchedule(rule({ address: '12 King St' }), rule({ id: other, address: ' 12  king st ', label: 'x', paused: true }))).toBe(true)
    expect(sameSchedule(rule({ address: '12 King St' }), rule({ address: '14 King St' }))).toBe(false)
    expect(sameSchedule(rule(), rule({ days: ['TU', 'TH'] }))).toBe(false)
    expect(sameSchedule(rule(), rule({ end: '10:00' }))).toBe(false)
    expect(sameSchedule(rule(), rule({ frequency: 'fortnightly' }))).toBe(false)
  })

  it('treats only calendar fields as changes to the event', () => {
    expect(changesCalendar(rule(), rule({ paused: true, push: true }))).toBe(false)
    expect(changesCalendar(rule(), rule({ days: ['WE'] }))).toBe(true)
    expect(changesCalendar(rule(), rule({ remind_minutes_before: 30 }))).toBe(true)
  })

  it('picks the next of the chosen days for a fortnightly start date', () => {
    // Mon 2 Nov 2026, 11 am in Melbourne.
    expect(nextDateOnDays(['TU'], MEL, new Date('2026-11-02T00:00:00Z'))).toBe('2026-11-03')
    expect(nextDateOnDays(['MO'], MEL, new Date('2026-11-02T00:00:00Z'))).toBe('2026-11-02')
  })
})

describe('normalizeRecurringRule', () => {
  it('accepts a valid rule and cleans it', () => {
    const cleaned = normalizeRecurringRule({
      ...rule({ days: ['TH', 'MO'], frequency: 'weekly', nth: [1] }),
      label: '  Street\u0007 sweeping\u202e  ',
      address: '   ',
    })
    expect(cleaned).toMatchObject({ days: ['MO', 'TH'], nth: [], label: 'Street sweeping', address: null })
  })

  it.each<[string, Partial<RecurringRule> | Record<string, unknown>]>([
    ['a non-uuid id', { id: 'rule-1' }],
    ['no days', { days: [] }],
    ['an unknown day', { days: ['XX'] }],
    ['the same start and end', { end: '07:00' }],
    ['a bad time', { start: '7am' }],
    ['a monthly rule without weeks', { frequency: 'monthly_nth', nth: [] }],
    ['an impossible date', { anchor_date: '2026-02-30' }],
    ['an unknown zone', { timezone: 'Mars/Olympus' }],
    ['an unknown kind', { kind: 'parking_party' }],
    ['a zero lead time', { remind_minutes_before: 0 }],
    ['a bad evening time', { remind_evening_before: '25:00' }],
  ])('rejects %s', (_label, patch) => {
    expect(normalizeRecurringRule({ ...rule(), ...patch })).toBeNull()
  })
})

describe('reading recurring_restrictions (T3 seam)', () => {
  const restriction: RecurringRestriction = {
    kind: 'street_cleaning',
    days: ['TU'],
    start: '07:00',
    end: '09:00',
    week_of_month: [],
    exceptions_text: 'Except public holidays',
    label: 'Street cleaning',
  }

  it('reads the optional field from a record or a result, and nothing when it is absent', () => {
    expect(recurringRestrictionsOf({ recurring_restrictions: [restriction] })).toEqual([restriction])
    expect(recurringRestrictionsOf({})).toEqual([])
    expect(recurringRestrictionsOf(null)).toEqual([])
    expect(recurringRestrictionsOf({ recurring_restrictions: 'yes' })).toEqual([])
  })

  it('drops entries without a usable day or time and maps unknown kinds to other', () => {
    const read = recurringRestrictionsOf({
      recurring_restrictions: [
        { ...restriction, days: [] },
        { ...restriction, start: 'morning' },
        { ...restriction, kind: 'parade', week_of_month: [4, 2] },
      ],
    })
    expect(read).toEqual([{ ...restriction, kind: 'other', week_of_month: [2, 4] }])
  })

  it('drops a restriction whose weeks of the month it cannot read, rather than misdescribe the sign', () => {
    // "Last Tuesday" (-1), a 0, a 9, or a mix with a good week: none may
    // turn into "every week" or "the 2nd Tuesday" on the screen that asks
    // the driver to check it against the sign.
    for (const week_of_month of [[-1], [0], [9], [2, -1], [1.5], ['1'], 'first']) {
      const read = recurringRestrictionsOf({ recurring_restrictions: [{ ...restriction, week_of_month }] })
      expect(read, JSON.stringify(week_of_month)).toEqual([])
    }
    // No weeks at all is a weekly restriction.
    expect(recurringRestrictionsOf({ recurring_restrictions: [{ ...restriction, week_of_month: [] }] })).toHaveLength(1)
    expect(recurringRestrictionsOf({ recurring_restrictions: [{ ...restriction, week_of_month: undefined }] })).toHaveLength(1)
  })

  it('prefills a rule from a restriction: weekly, or monthly_nth when the sign names weeks', () => {
    const ctx = { timezone: MEL, address: '12 King St', now: new Date('2026-11-02T00:00:00Z'), id: ID }
    const weekly = ruleFromRestriction(restriction, ctx)
    expect(weekly).toMatchObject({
      id: ID,
      kind: 'street_cleaning',
      label: 'Street cleaning',
      days: ['TU'],
      frequency: 'weekly',
      nth: [],
      anchor_date: '2026-11-02',
      timezone: MEL,
      address: '12 King St',
      // A morning restriction: remind the evening before, and an hour before.
      remind_evening_before: '20:00',
      remind_minutes_before: 60,
    })
    expect(normalizeRecurringRule(weekly)).toEqual(weekly)
    const monthly = ruleFromRestriction({ ...restriction, week_of_month: [3, 1], start: '13:00', end: '15:00' }, ctx)
    expect(monthly).toMatchObject({ frequency: 'monthly_nth', nth: [1, 3], remind_evening_before: null })
  })

  it("leaves the sign's English label out for a reader in another language, so the translated kind names it", () => {
    const ctx = { timezone: MEL, address: '12 King St', now: new Date('2026-11-02T00:00:00Z'), id: ID }
    expect(ruleFromRestriction(restriction, { ...ctx, labelFromSign: false }).label).toBe('')
    expect(ruleFromRestriction(restriction, { ...ctx, labelFromSign: true }).label).toBe('Street cleaning')
  })
})
