// @vitest-environment happy-dom
//
// The calendar files in the reader's language (fix list clean-ups, item 1).
// Every word a calendar shows comes from the locale files: a record's event
// title and description, the no-sign "check on your car" event, every alarm
// (the same words the push and in-tab reminder at that moment show), and
// the errors. The times and alarm triggers stay exactly as they were
// (ics-permit.test.ts and recurring-ics.test.ts cover those in detail).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TFunction } from 'i18next'
import i18n from './i18n'
import { buildRecurringIcs, buildWorkdayLegIcs, downloadIcs, downloadIcsAbsolute } from './ics'
import { workdayReminderCopy, workdayReminderSchedule } from './workday'
import { reminderCopy } from './reminder-copy'
import { zonePlace } from './recurring-copy'
import { formatInZone, formatReminderTimesLine } from './time-format'
import type { ParkingSession, RecurringRule } from '../types'

const ics = vi.hoisted(() => ({ fail: false }))
vi.mock('ics', async (importOriginal) => {
  const real = await importOriginal<typeof import('ics')>()
  return {
    ...real,
    createEvent: ((attributes: Parameters<typeof real.createEvent>[0]) =>
      ics.fail ? { error: new Error('package says no'), value: undefined } : real.createEvent(attributes)) as typeof real.createEvent,
  }
})

const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa'] as const
const TZ = 'Australia/Melbourne'
const EXPIRES = '2026-11-09T05:00:00.000Z' // 4:00 pm AEDT
const record = {
  id: 'rec-ics-i18n',
  arrived_at: '2026-11-09T03:00:00.000Z',
  location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
  expires_at: EXPIRES,
} as unknown as ParkingSession
const noSign = {
  id: 'rec-ics-nosign',
  arrived_at: '2026-11-09T03:00:00.000Z',
  location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
  expires_at: null,
  no_sign: true,
} as unknown as ParkingSession

beforeAll(() => {
  vi.stubEnv('TZ', TZ)
})
afterAll(() => {
  vi.unstubAllEnvs()
})
afterEach(() => {
  ics.fail = false
  vi.restoreAllMocks()
})

/** Run a download and read back the calendar text it handed the browser, unfolded. */
async function icsText(run: () => void): Promise<string> {
  let blob: Blob | null = null
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blob = b as Blob
    return 'blob:test'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  run()
  expect(blob).not.toBeNull()
  return (await (blob as unknown as Blob).text()).replace(/\r\n[ \t]/g, '')
}

/** A TEXT value as RFC 5545 writes it (what the ics package does to SUMMARY and DESCRIPTION). */
const escaped = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')

/** Every DESCRIPTION inside a VALARM, in file order. */
const alarmDescriptions = (text: string) =>
  [...text.matchAll(/BEGIN:VALARM\r\n([\s\S]*?)END:VALARM/g)].map((m) => /DESCRIPTION:(.*)\r\n/.exec(m[1])?.[1] ?? null)

const fixedT = (locale: string): TFunction => i18n.getFixedT(locale)

describe('a record with a sign: downloadIcs', () => {
  it.each(LOCALES)('every word is in %s', async (locale) => {
    const t = fixedT(locale)
    const text = await icsText(() => downloadIcs(record, [15, 0], t))
    const expires = new Date(EXPIRES)
    const fires = [new Date(expires.getTime() - 15 * 60_000), expires]

    expect(text).toContain(`SUMMARY:${escaped(t('reminders.ics.expiresTitle'))}\r\n`)
    const description = [
      t('reminders.ics.expiresAt', { time: formatInZone(expires, TZ, { withZone: false }), place: zonePlace(TZ, t) }),
      t('reminders.ics.remindersAt', { times: formatReminderTimesLine(fires, { timeZone: TZ, t }) }),
      t('reminders.ics.recordId', { id: record.id }),
    ].join('\n')
    expect(text).toContain(`\r\nDESCRIPTION:${escaped(description)}\r\n`)
    // Each alarm says what the push and in-tab reminder at that moment say.
    expect(alarmDescriptions(text)).toEqual(fires.map((at) => escaped(reminderCopy(record, at, t).body)))
    // The triggers are unchanged: 15 minutes before, and at the expiry instant.
    expect(text).toContain('TRIGGER:-PT15M')
    expect(text).toContain('TRIGGER;VALUE=DATE-TIME:20261109T050000Z')
    if (locale !== 'en') {
      // None of the old English text is left.
      expect(text).not.toMatch(/Parking expires|Move your car|Reminders:|ParkProof record|check on your car/i)
    }
  })

  it('escapes the commas a translated alarm can carry', async () => {
    const t = fixedT('en')
    // Expiry at 12:05 am, so the 15-minute reminder fires the evening before
    // and its text names the day: "12:05 am, Tue 10/11/2026".
    const pastMidnight = { ...record, expires_at: '2026-11-09T13:05:00.000Z' } as ParkingSession
    const text = await icsText(() => downloadIcs(pastMidnight, [15], t))
    const body = reminderCopy(pastMidnight, new Date('2026-11-09T12:50:00.000Z'), t).body
    expect(body).toContain(',')
    expect(alarmDescriptions(text)).toEqual([escaped(body)])
    expect(alarmDescriptions(text)[0]).not.toMatch(/(^|[^\\]),/)
  })

  it.each(['en', 'el', 'zh-CN'])('its errors are in %s', (locale) => {
    const t = fixedT(locale)
    expect(() => downloadIcs({ ...record, expires_at: null } as ParkingSession, [15], t)).toThrow(t('reminders.noExpiry'))
    expect(() => downloadIcs(record, [], t)).toThrow(t('reminders.calendarPickAtLeastOne'))
    ics.fail = true
    let caught: unknown = null
    try {
      downloadIcs(record, [15], t)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe(t('reminders.ics.buildFailed'))
    // The package's own error stays attached for the console.
    expect(((caught as Error).cause as Error).message).toBe('package says no')
  })
})

describe('a record with no sign: downloadIcsAbsolute', () => {
  it.each(LOCALES)('every word is in %s', async (locale) => {
    const t = fixedT(locale)
    const fires = [new Date('2026-11-09T05:30:00.000Z'), new Date('2026-11-09T04:00:00.000Z')]
    const text = await icsText(() => downloadIcsAbsolute(noSign, fires, t))
    const sorted = [...fires].sort((a, b) => a.getTime() - b.getTime())

    expect(text).toContain(`SUMMARY:${escaped(t('reminders.ics.checkOnTitle'))}\r\n`)
    const description = [
      t('reminders.ics.checkOnAt', { address: '12 King St', place: zonePlace(TZ, t) }),
      t('reminders.ics.remindersAt', { times: formatReminderTimesLine(sorted, { timeZone: TZ, t }) }),
      t('reminders.ics.recordId', { id: noSign.id }),
    ].join('\n')
    expect(text).toContain(`\r\nDESCRIPTION:${escaped(description)}\r\n`)
    expect(alarmDescriptions(text)).toEqual(sorted.map((at) => escaped(reminderCopy(noSign, at, t).body)))
    expect(text).toContain('TRIGGER;VALUE=DATE-TIME:20261109T040000Z')
    expect(text).toContain('TRIGGER;VALUE=DATE-TIME:20261109T053000Z')
    if (locale !== 'en') expect(text).not.toMatch(/Check on your car|Reminders:|ParkProof record/i)
  })

  it('says where you parked it when the record has no address', async () => {
    const t = fixedT('it')
    const noAddress = { ...noSign, location: { lat: -37.8136, lng: 144.9631, address: null } } as unknown as ParkingSession
    const text = await icsText(() => downloadIcsAbsolute(noAddress, [new Date('2026-11-09T04:00:00.000Z')], t))
    expect(text).toContain(`DESCRIPTION:${escaped(t('reminders.ics.checkOnHere', { place: zonePlace(TZ, t) }))}\\n`)
  })

  it('its error is in the reader\'s language', () => {
    const t = fixedT('ko')
    expect(() => downloadIcsAbsolute(noSign, [], t)).toThrow(t('reminders.calendarPickAtLeastOne'))
  })
})

describe('a weekly reminder: buildRecurringIcs', () => {
  const rule = {
    id: '0b0e7f4e-3c3a-4d5e-9f00-1a2b3c4d5e6f',
    label: '',
    kind: 'street_cleaning',
    days: [],
    start: '07:00',
    end: '09:00',
    frequency: 'weekly',
    nth: [],
    anchor_date: '2026-11-04',
    timezone: TZ,
    address: null,
    remind_evening_before: null,
    remind_minutes_before: 60,
    push: false,
    paused: false,
    sequence: 0,
  } as unknown as RecurringRule

  it.each(['en', 'hi', 'vi'])('a rule with no dates fails in %s', (locale) => {
    const t = fixedT(locale)
    expect(() => buildRecurringIcs(rule, t, locale)).toThrow(t('recurring.ics.noDates'))
  })

  it('a refused event fails in the reader\'s language', () => {
    const t = fixedT('pa')
    ics.fail = true
    expect(() => buildRecurringIcs({ ...rule, days: ['TU'] } as RecurringRule, t, 'pa')).toThrow(t('reminders.ics.buildFailed'))
  })
})

describe('a workday stop: buildWorkdayLegIcs (T6b, merged after the fix list)', () => {
  const leg = {
    id: 'rec-ics-workday',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
  } as unknown as ParkingSession
  const reminders = workdayReminderSchedule({ deadline: EXPIRES, now: new Date('2026-11-09T03:00:00.000Z') })

  it.each(LOCALES)('every word is in %s', (locale) => {
    const t = fixedT(locale)
    expect(reminders.length).toBeGreaterThan(0)
    const text = buildWorkdayLegIcs(leg, reminders, t).replace(/\r\n[ \t]/g, '')
    const deadline = formatInZone(new Date(EXPIRES), TZ, { withDate: true })
    expect(text).toContain(`SUMMARY:${escaped(t('workday.ics.title', { time: deadline }))}\r\n`)
    expect(text).toContain(`\r\nDESCRIPTION:${escaped(t('reminders.reliability'))}\r\n`)
    expect(alarmDescriptions(text)).toEqual(reminders.map((r) => escaped(workdayReminderCopy(r, leg, t).body)))
  })

  it.each(['en', 'el', 'zh-CN'])('its errors are in %s', (locale) => {
    const t = fixedT(locale)
    expect(() => buildWorkdayLegIcs(leg, [], t)).toThrow(t('workday.reminders.notSet'))
    ics.fail = true
    let caught: unknown = null
    try {
      buildWorkdayLegIcs(leg, reminders, t)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe(t('reminders.ics.buildFailed'))
    expect(((caught as Error).cause as Error).message).toBe('package says no')
  })
})

describe('the keys exist in every locale', () => {
  it.each(LOCALES)('%s has its own text for every calendar key', (locale) => {
    const keys = [
      'reminders.ics.expiresTitle',
      'reminders.ics.expiresAt',
      'reminders.ics.remindersAt',
      'reminders.ics.recordId',
      'reminders.ics.checkOnTitle',
      'reminders.ics.checkOnAt',
      'reminders.ics.checkOnHere',
      'reminders.ics.buildFailed',
      'recurring.ics.noDates',
    ]
    for (const key of keys) {
      expect(i18n.exists(key, { lng: locale, fallbackLng: false })).toBe(true)
      if (locale !== 'en') expect(i18n.getFixedT(locale)(key)).not.toBe(i18n.getFixedT('en')(key))
    }
  })
})
