// @vitest-environment happy-dom
//
// Weekly reminders in words and in the calendar file (T5a items 4 and 5):
// schedule lines, notification text, and the .ics with floating local
// time, an RRULE per frequency, relative alarms, a stable UID, SEQUENCE
// from the store and text in the reader's language.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import i18n from './i18n'
import type { RecurringRule } from '../types'
import { buildRecurringIcs } from './ics'
import { nextOccurrence } from './recurring'
import {
  daysText,
  formatClock,
  recurringNotificationCopy,
  ruleStatusText,
  ruleSummary,
  scheduleText,
  timeRangeText,
  zonePlace,
} from './recurring-copy'
import { saveRecurringRule } from './storage'

const ID = '0b0e7f4e-3c3a-4d5e-9f00-1a2b3c4d5e6f'

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
    anchor_date: '2026-11-04',
    timezone: 'Australia/Melbourne',
    address: '12 King St, Carlton',
    remind_evening_before: '20:00',
    remind_minutes_before: 60,
    push: true,
    paused: false,
    sequence: 0,
    ...overrides,
  }
}

let t: TFunction
beforeAll(async () => {
  await i18n.changeLanguage('en')
  t = i18n.getFixedT('en')
})
beforeEach(() => localStorage.clear())

/** RFC 5545 unfolding: a CRLF followed by a space or tab continues the line. */
const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, '')
const lines = (ics: string) => unfold(ics).split('\r\n')
const prop = (ics: string, name: string) => lines(ics).filter((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`))

describe('schedule words', () => {
  it('writes times the way the app does, sharing am/pm across a range when it can', () => {
    expect(formatClock('07:00')).toBe('7 am')
    expect(formatClock('09:30')).toBe('9:30 am')
    expect(formatClock('12:00')).toBe('12 pm')
    expect(formatClock('00:15')).toBe('12:15 am')
    expect(timeRangeText('07:00', '09:00', t)).toBe('7 to 9 am')
    expect(timeRangeText('11:00', '13:00', t)).toBe('11 am to 1 pm')
    expect(timeRangeText('22:00', '06:00', t)).toBe('10 pm to 6 am')
  })

  it('names days as a single day, a run, or a list', () => {
    expect(daysText(['TU'], t, 'en')).toBe('Tuesday')
    expect(daysText(['MO', 'TU', 'WE', 'TH', 'FR'], t, 'en')).toBe('Monday to Friday')
    expect(daysText(['TH', 'MO'], t, 'en')).toBe('Monday and Thursday')
  })

  it('describes each frequency', () => {
    expect(scheduleText(rule(), t, 'en')).toBe('Every week on Tuesday')
    expect(scheduleText(rule({ frequency: 'fortnightly' }), t, 'en')).toBe('Every second week on Tuesday')
    expect(scheduleText(rule({ frequency: 'monthly_nth', nth: [3, 1] }), t, 'en')).toBe(
      'The 1st and 3rd Tuesday of each month',
    )
    expect(ruleSummary(rule(), t, 'en')).toBe('Every week on Tuesday, 7 to 9 am')
  })

  it('says what the reminder is for and what to do (spec T5a item 5)', () => {
    const r = rule()
    const occ = nextOccurrence(r, new Date('2026-11-09T00:00:00Z'))!
    expect(recurringNotificationCopy(r, occ, 'evening', t)).toEqual({
      title: '12 King St, Carlton',
      body: 'Street sweeping on Tuesday 7 to 9 am. Move the car tonight.',
    })
    expect(recurringNotificationCopy(r, occ, 'before', t).body).toBe(
      'Street sweeping on Tuesday 7 to 9 am. Move the car before 7 am.',
    )
    // An afternoon restriction isn't "tonight".
    const pm = rule({ start: '13:00', end: '15:00', label: 'Clearway on Smith St', address: null })
    const pmOcc = nextOccurrence(pm, new Date('2026-11-09T00:00:00Z'))!
    expect(recurringNotificationCopy(pm, pmOcc, 'evening', t)).toEqual({
      title: 'Clearway on Smith St',
      body: 'Clearway on Smith St on Tuesday 1 to 3 pm. Move the car before 1 pm.',
    })
  })

  it('shows the next occurrence, a running one, or paused', () => {
    // Mon 9 Nov 2026, 11 am in Melbourne: the next sweep is Tue 10 Nov at 7 am.
    expect(ruleStatusText(rule(), Date.parse('2026-11-09T00:00:00Z'), t)).toMatch(/^Next: Tue 10 Nov, 7:00 am/)
    // Tue 10 Nov, 8 am: it's on.
    expect(ruleStatusText(rule(), Date.parse('2026-11-09T21:00:00Z'), t)).toBe('On now, until 9 am')
    expect(ruleStatusText(rule({ paused: true }), Date.parse('2026-11-09T00:00:00Z'), t)).toBe('Paused')
  })

  it('translates the words in every part', () => {
    const tIt = i18n.getFixedT('it')
    expect(ruleSummary(rule(), tIt, 'it')).toBe('Ogni settimana: martedì, dalle 7 alle 9 am')
  })

  it('in Italian and Greek, the ordinals agree with "week", whatever the day', () => {
    // A feminine Sunday (it) and a neuter Saturday (el) once got masculine
    // and feminine ordinals: "1° domenica", "1η και 3η Σάββατο".
    const monthly = (days: RecurringRule['days']) => rule({ frequency: 'monthly_nth', nth: [1, 3], days })
    expect(scheduleText(monthly(['SU']), i18n.getFixedT('it'), 'it')).toBe('Ogni mese, 1ª e 3ª settimana: domenica')
    expect(scheduleText(monthly(['SA']), i18n.getFixedT('el'), 'el')).toBe('Κάθε μήνα, 1η και 3η εβδομάδα: Σάββατο')
  })

  it('names the place a rule is local to in the reader language, never the raw zone id', () => {
    expect(zonePlace('Australia/Melbourne', t)).toBe('Melbourne')
    expect(zonePlace('Australia/Lord_Howe', t)).toBe('Lord Howe Island')
    expect(zonePlace('Australia/ACT', t)).toBe('Canberra')
    expect(zonePlace('Australia/Melbourne', i18n.getFixedT('zh-CN'))).toBe('墨尔本')
    expect(zonePlace('Australia/Perth', i18n.getFixedT('ko'))).toBe('퍼스')
    // Outside Australia: the zone's short name, not "Europe/Rome" or "Rome".
    const rome = zonePlace('Europe/Rome', t)
    expect(rome).toMatch(/^(GMT|UTC|CE)/)
    expect(rome).not.toContain('Rome')
  })
})

describe('buildRecurringIcs', () => {
  it('writes one repeating event in floating local time, never UTC or a zone', () => {
    const ics = buildRecurringIcs(rule(), t, 'en')
    // The first Tuesday on or after the anchor (Wed 4 Nov) is 10 Nov.
    expect(prop(ics, 'DTSTART')).toEqual(['DTSTART:20261110T070000'])
    expect(prop(ics, 'DTEND')).toEqual(['DTEND:20261110T090000'])
    expect(ics).not.toMatch(/TZID/)
    expect(prop(ics, 'RRULE')).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=TU'])
    expect(lines(ics).filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1)
    expect(prop(ics, 'TRANSP')).toEqual(['TRANSP:TRANSPARENT'])
  })

  it('ends an overnight restriction on the next day', () => {
    const ics = buildRecurringIcs(rule({ days: ['FR'], start: '22:00', end: '06:00' }), t, 'en')
    expect(prop(ics, 'DTSTART')).toEqual(['DTSTART:20261106T220000'])
    expect(prop(ics, 'DTEND')).toEqual(['DTEND:20261107T060000'])
  })

  it('repeats every second week and on the nth weekdays of the month', () => {
    const fortnight = buildRecurringIcs(rule({ frequency: 'fortnightly', anchor_date: '2026-11-17' }), t, 'en')
    expect(prop(fortnight, 'RRULE')).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;WKST=MO'])
    expect(prop(fortnight, 'DTSTART')).toEqual(['DTSTART:20261117T070000'])
    const monthly = buildRecurringIcs(rule({ frequency: 'monthly_nth', nth: [1, 3] }), t, 'en')
    expect(prop(monthly, 'RRULE')).toEqual(['RRULE:FREQ=MONTHLY;BYDAY=1TU,3TU'])
    // 3 Nov is before the anchor; the 3rd Tuesday (17 Nov) is the first.
    expect(prop(monthly, 'DTSTART')).toEqual(['DTSTART:20261117T070000'])
  })

  it('carries relative alarms: the evening before and the minutes before', () => {
    const ics = buildRecurringIcs(rule(), t, 'en')
    expect(prop(ics, 'TRIGGER')).toEqual(['TRIGGER:-PT11H', 'TRIGGER:-PT1H'])
    expect(lines(ics).filter((l) => l.startsWith('DESCRIPTION:Street sweeping'))).toEqual([
      'DESCRIPTION:Street sweeping tomorrow\\, 7 to 9 am. Move the car tonight.',
      'DESCRIPTION:Street sweeping starts at 7 am. Move the car before then.',
    ])
    expect(prop(buildRecurringIcs(rule({ remind_evening_before: null, remind_minutes_before: 90 }), t, 'en'), 'TRIGGER')).toEqual([
      'TRIGGER:-PT1H30M',
    ])
    expect(buildRecurringIcs(rule({ remind_evening_before: null, remind_minutes_before: null }), t, 'en')).not.toMatch(
      /BEGIN:VALARM/,
    )
  })

  it('keeps the same UID for a rule and takes SEQUENCE from the store, bumped on edit', () => {
    const first = saveRecurringRule(rule())
    const before = buildRecurringIcs(first, t, 'en')
    const edited = saveRecurringRule({ ...first, start: '06:00' })
    const after = buildRecurringIcs(edited, t, 'en')
    expect(prop(before, 'UID')).toEqual([`UID:parkproof-recurring-${ID}@parkproof.local`])
    expect(prop(after, 'UID')).toEqual(prop(before, 'UID'))
    expect(prop(before, 'SEQUENCE')).toEqual(['SEQUENCE:0'])
    expect(prop(after, 'SEQUENCE')).toEqual(['SEQUENCE:1'])
  })

  it('says what it is, where, and carries the council note and the reliability line', () => {
    const ics = unfold(buildRecurringIcs(rule(), t, 'en'))
    expect(prop(ics, 'SUMMARY')).toEqual(['SUMMARY:Street sweeping'])
    expect(prop(ics, 'LOCATION')).toEqual(['LOCATION:12 King St\\, Carlton'])
    const description = prop(ics, 'DESCRIPTION')[0]
    expect(description).toContain('Every week on Tuesday\\, 7 to 9 am.')
    expect(description).toContain('public holidays may be different')
    expect(description).toContain("Reminders can be delayed or silenced\\, for example by Focus or battery saving. Don't rely on them alone.")
  })

  it('writes the text in the reader language', () => {
    const ics = unfold(buildRecurringIcs(rule(), i18n.getFixedT('it'), 'it'))
    expect(prop(ics, 'SUMMARY')).toEqual(['SUMMARY:Pulizia strade'])
    expect(prop(ics, 'DESCRIPTION')[0]).toContain('I comuni cambiano questi orari')
  })
})
