// Notice matching (build spec T8 item 3). Times are checked as UTC
// instants, so every expectation states exactly which moment a printed
// local time was read as.
//
// Daylight saving in Melbourne: it ends at 03:00 AEDT on Sunday
// 4 April 2027 (2027-04-03T16:00Z), when the clocks go back to 02:00 AEST,
// so 02:30 happens twice. It starts at 02:00 AEST on Sunday 4 October 2026
// (2026-10-03T16:00Z), when the clocks go forward to 03:00 AEDT, so 02:30
// never happens. Brisbane has no daylight saving.
import { describe, expect, it } from 'vitest'
import type { NoticeFields, ParkingSession, SignedAddendum } from '../types'
import {
  ALL_AUSTRALIAN_ZONES,
  FAR_FROM_NOTICE_M,
  STATE_ZONES,
  formatWallClock,
  inferIssuingState,
  matchNotice,
  noticeFallbackZones,
  noticeGeocodeQuery,
  noticeLocalTime,
  parseClockTime,
  parseDayFirstDate,
  parseWallClock,
  recordWindow,
  stateForPostcode,
  wallClockAt,
  wallClockStatus,
  zonedWallClockToUtc,
  type WallClock,
} from './notice-match'

const MEL = 'Australia/Melbourne'
const BNE = 'Australia/Brisbane'

const wc = (year: number, month: number, day: number, hour: number, minute: number): WallClock => ({
  year,
  month,
  day,
  hour,
  minute,
})
const isoList = (ms: number[]) => ms.map((m) => new Date(m).toISOString())

// ─── zonedWallClockToUtc ──────────────────────────────────────────────────

describe('zonedWallClockToUtc', () => {
  it('reads an ordinary Melbourne time as one instant', () => {
    expect(isoList(zonedWallClockToUtc(wc(2026, 11, 8, 14, 10), MEL))).toEqual(['2026-11-08T03:10:00.000Z'])
    expect(isoList(zonedWallClockToUtc(wc(2026, 7, 1, 9, 0), MEL))).toEqual(['2026-06-30T23:00:00.000Z'])
  })

  it('returns both instants for 02:30 on 4 April 2027 in Melbourne (the repeated hour)', () => {
    const instants = zonedWallClockToUtc(wc(2027, 4, 4, 2, 30), MEL)
    expect(isoList(instants)).toEqual(['2027-04-03T15:30:00.000Z', '2027-04-03T16:30:00.000Z'])
    for (const at of instants) expect(wallClockAt(at, MEL)).toEqual(wc(2027, 4, 4, 2, 30))
    expect(wallClockStatus(wc(2027, 4, 4, 2, 30), MEL)).toBe('repeated')
  })

  it('returns one instant either side of the repeated hour', () => {
    expect(isoList(zonedWallClockToUtc(wc(2027, 4, 4, 1, 59), MEL))).toEqual(['2027-04-03T14:59:00.000Z'])
    expect(isoList(zonedWallClockToUtc(wc(2027, 4, 4, 3, 0), MEL))).toEqual(['2027-04-03T17:00:00.000Z'])
    expect(wallClockStatus(wc(2027, 4, 4, 3, 0), MEL)).toBe('normal')
  })

  it('moves 02:30 on 4 October 2026 in Melbourne (the skipped hour) forward to 03:30 AEDT', () => {
    const instants = zonedWallClockToUtc(wc(2026, 10, 4, 2, 30), MEL)
    expect(isoList(instants)).toEqual(['2026-10-03T16:30:00.000Z'])
    expect(wallClockAt(instants[0], MEL)).toEqual(wc(2026, 10, 4, 3, 30))
    expect(wallClockStatus(wc(2026, 10, 4, 2, 30), MEL)).toBe('skipped')
  })

  it('returns one instant either side of the skipped hour', () => {
    expect(isoList(zonedWallClockToUtc(wc(2026, 10, 4, 1, 59), MEL))).toEqual(['2026-10-03T15:59:00.000Z'])
    expect(isoList(zonedWallClockToUtc(wc(2026, 10, 4, 3, 0), MEL))).toEqual(['2026-10-03T16:00:00.000Z'])
  })

  it('reads Brisbane, which has no daylight saving, the same on both dates', () => {
    expect(isoList(zonedWallClockToUtc(wc(2026, 10, 4, 2, 30), BNE))).toEqual(['2026-10-03T16:30:00.000Z'])
    expect(isoList(zonedWallClockToUtc(wc(2027, 4, 4, 2, 30), BNE))).toEqual(['2027-04-03T16:30:00.000Z'])
    expect(wallClockStatus(wc(2026, 10, 4, 2, 30), BNE)).toBe('normal')
    expect(wallClockStatus(wc(2027, 4, 4, 2, 30), BNE)).toBe('normal')
  })

  it('handles half-hour zones: Adelaide skips 02:30 to 03:30 ACDT', () => {
    expect(isoList(zonedWallClockToUtc(wc(2026, 10, 4, 2, 30), 'Australia/Adelaide'))).toEqual(['2026-10-03T17:00:00.000Z'])
    expect(isoList(zonedWallClockToUtc(wc(2026, 11, 8, 14, 10), 'Australia/Darwin'))).toEqual(['2026-11-08T04:40:00.000Z'])
  })

  it('returns nothing for an impossible date or time, or an unknown zone', () => {
    expect(zonedWallClockToUtc(wc(2027, 2, 29, 10, 0), MEL)).toEqual([])
    expect(zonedWallClockToUtc(wc(2027, 13, 1, 10, 0), MEL)).toEqual([])
    expect(zonedWallClockToUtc(wc(2027, 4, 31, 10, 0), MEL)).toEqual([])
    expect(zonedWallClockToUtc(wc(2027, 4, 4, 24, 0), MEL)).toEqual([])
    expect(zonedWallClockToUtc(wc(2027, 4, 4, 10, 60), MEL)).toEqual([])
    expect(zonedWallClockToUtc(wc(2027, 4, 4, 10, 0), 'Mars/Olympus_Mons')).toEqual([])
    expect(wallClockStatus(wc(2027, 2, 29, 10, 0), MEL)).toBe('invalid')
  })
})

describe('formatWallClock and parseWallClock', () => {
  it('round-trip the YYYY-MM-DDTHH:MM shape and refuse anything else', () => {
    expect(formatWallClock(wc(2027, 4, 4, 2, 5))).toBe('2027-04-04T02:05')
    expect(parseWallClock('2027-04-04T02:05')).toEqual(wc(2027, 4, 4, 2, 5))
    expect(parseWallClock('2027-02-29T10:00')).toBeNull()
    expect(parseWallClock('2027-04-04T02:05+10:00')).toBeNull()
    expect(parseWallClock('2027-04-04')).toBeNull()
    expect(parseWallClock(null)).toBeNull()
  })
})

// ─── Reading the printed date and time ────────────────────────────────────

describe('parseDayFirstDate', () => {
  it('reads numeric dates day first, as Australian notices print them', () => {
    expect(parseDayFirstDate('04/05/2027')).toEqual({ year: 2027, month: 5, day: 4 })
    expect(parseDayFirstDate('4/5/27')).toEqual({ year: 2027, month: 5, day: 4 })
    expect(parseDayFirstDate('04-05-2027')).toEqual({ year: 2027, month: 5, day: 4 })
    expect(parseDayFirstDate('04.05.2027')).toEqual({ year: 2027, month: 5, day: 4 })
    expect(parseDayFirstDate('Tue 04/05/2027 14:10')).toEqual({ year: 2027, month: 5, day: 4 })
    expect(parseDayFirstDate('13/04/2027')).toEqual({ year: 2027, month: 4, day: 13 })
  })

  it('never reads a numeric date month first', () => {
    // Month first, 04/13/2027 would be 13 April; day first it is no date at all.
    expect(parseDayFirstDate('04/13/2027')).toBeNull()
  })

  it('reads year-first ISO dates and dates with a month name', () => {
    expect(parseDayFirstDate('2027-05-04')).toEqual({ year: 2027, month: 5, day: 4 })
    expect(parseDayFirstDate('2027/05/04')).toEqual({ year: 2027, month: 5, day: 4 })
    expect(parseDayFirstDate('Tuesday, 4 May 2027')).toEqual({ year: 2027, month: 5, day: 4 })
    expect(parseDayFirstDate('4th May 2027')).toEqual({ year: 2027, month: 5, day: 4 })
    expect(parseDayFirstDate('04-May-2027')).toEqual({ year: 2027, month: 5, day: 4 })
    expect(parseDayFirstDate('4 Sept 2026')).toEqual({ year: 2026, month: 9, day: 4 })
    expect(parseDayFirstDate('May 4, 2027')).toEqual({ year: 2027, month: 5, day: 4 })
  })

  it('returns null for impossible or missing dates', () => {
    expect(parseDayFirstDate('31/02/2027')).toBeNull()
    expect(parseDayFirstDate('29/02/2027')).toBeNull()
    expect(parseDayFirstDate('29/02/2028')).toEqual({ year: 2028, month: 2, day: 29 })
    expect(parseDayFirstDate('4 Smarch 2027')).toBeNull()
    expect(parseDayFirstDate('')).toBeNull()
    expect(parseDayFirstDate(null)).toBeNull()
    expect(parseDayFirstDate('illegible')).toBeNull()
  })
})

describe('parseClockTime', () => {
  it('reads 12-hour times', () => {
    expect(parseClockTime('2:10 PM')).toEqual({ hour: 14, minute: 10 })
    expect(parseClockTime('2.10pm')).toEqual({ hour: 14, minute: 10 })
    expect(parseClockTime('02:10 p.m.')).toEqual({ hour: 14, minute: 10 })
    expect(parseClockTime('12:05 am')).toEqual({ hour: 0, minute: 5 })
    expect(parseClockTime('12:30pm')).toEqual({ hour: 12, minute: 30 })
    expect(parseClockTime('2pm')).toEqual({ hour: 14, minute: 0 })
    expect(parseClockTime('11 AM')).toEqual({ hour: 11, minute: 0 })
  })

  it('reads 24-hour times, with or without a colon', () => {
    expect(parseClockTime('14:10')).toEqual({ hour: 14, minute: 10 })
    expect(parseClockTime('14:10:32')).toEqual({ hour: 14, minute: 10 })
    expect(parseClockTime('02:30')).toEqual({ hour: 2, minute: 30 })
    expect(parseClockTime('1410')).toEqual({ hour: 14, minute: 10 })
    expect(parseClockTime('1410 hrs')).toEqual({ hour: 14, minute: 10 })
    expect(parseClockTime('14:30 PM')).toEqual({ hour: 14, minute: 30 })
    expect(parseClockTime('noon')).toEqual({ hour: 12, minute: 0 })
    expect(parseClockTime('Midnight')).toEqual({ hour: 0, minute: 0 })
  })

  it('returns null for impossible or contradictory times', () => {
    expect(parseClockTime('25:00')).toBeNull()
    expect(parseClockTime('14:60')).toBeNull()
    expect(parseClockTime('13:00 am')).toBeNull()
    expect(parseClockTime('2460')).toBeNull()
    expect(parseClockTime('')).toBeNull()
    expect(parseClockTime(null)).toBeNull()
  })
})

function noticeFields(overrides: Partial<NoticeFields> = {}): NoticeFields {
  return {
    legibility: 'clear',
    notice_number: '1234567890',
    issuing_authority: 'City of Yarra',
    offence_date_raw: '04/05/2027',
    offence_time_raw: '2:10 PM',
    offence_datetime_local: '2027-05-04T14:10',
    location_text: 'Lygon St, Carlton VIC 3053',
    offence_code: '702',
    offence_description: 'Stop longer than permitted',
    amount: '$99.00',
    due_date: '01/06/2027',
    ...overrides,
  }
}

describe('noticeLocalTime', () => {
  it('uses the printed date and time and agrees with the model when they match', () => {
    const t = noticeLocalTime(noticeFields())
    expect(t.local).toEqual(wc(2027, 5, 4, 14, 10))
    expect(t.date_source).toBe('printed')
    expect(t.time_source).toBe('printed')
    expect(t.disagrees).toBe(false)
  })

  it('flags a model that read 04/05/2027 month first, and keeps the day-first reading', () => {
    const t = noticeLocalTime(noticeFields({ offence_datetime_local: '2027-04-05T14:10' }))
    expect(t.local).toEqual(wc(2027, 5, 4, 14, 10))
    expect(t.model).toEqual(wc(2027, 4, 5, 14, 10))
    expect(t.date_disagrees).toBe(true)
    expect(t.time_disagrees).toBe(false)
    expect(t.disagrees).toBe(true)
  })

  it('flags a different time too', () => {
    const t = noticeLocalTime(noticeFields({ offence_datetime_local: '2027-05-04T02:10' }))
    expect(t.local).toEqual(wc(2027, 5, 4, 14, 10))
    expect(t.time_disagrees).toBe(true)
    expect(t.disagrees).toBe(true)
  })

  it("falls back to the model's reading for a part that wasn't printed legibly", () => {
    const t = noticeLocalTime(noticeFields({ offence_date_raw: null, offence_time_raw: 'smudged' }))
    expect(t.local).toEqual(wc(2027, 5, 4, 14, 10))
    expect(t.date_source).toBe('model')
    expect(t.time_source).toBe('model')
    expect(t.disagrees).toBe(false)
  })

  it('reads a time printed in the date field, without mistaking a dotted date for a time', () => {
    const inDate = noticeLocalTime(
      noticeFields({ offence_date_raw: '04.05.2027 2:10 PM', offence_time_raw: null, offence_datetime_local: null }),
    )
    expect(inDate.local).toEqual(wc(2027, 5, 4, 14, 10))
    const dateOnly = noticeLocalTime(noticeFields({ offence_date_raw: '04.05.2027', offence_time_raw: null, offence_datetime_local: null }))
    expect(dateOnly.raw_time).toBeNull()
    expect(dateOnly.local).toBeNull()
  })

  it('a printed time without am or pm takes the model\'s half of the day when the model read the same time', () => {
    // "2:10" printed, the PM in another box; the model read 14:10.
    const t = noticeLocalTime(noticeFields({ offence_time_raw: '2:10', offence_datetime_local: '2027-05-04T14:10' }))
    expect(t.local).toEqual(wc(2027, 5, 4, 14, 10))
    expect(t.raw_time).toEqual({ hour: 2, minute: 10 })
    expect(t.time_source).toBe('model')
    expect(t.time_disagrees).toBe(false)
    // "12:10" printed, the model read ten past midnight.
    const midnight = noticeLocalTime(noticeFields({ offence_time_raw: '12:10', offence_datetime_local: '2027-05-04T00:10' }))
    expect(midnight.local).toEqual(wc(2027, 5, 4, 0, 10))
    // In the date field too.
    const inDate = noticeLocalTime(
      noticeFields({ offence_date_raw: '04/05/2027 2:10', offence_time_raw: null, offence_datetime_local: '2027-05-04T14:10' }),
    )
    expect(inDate.local).toEqual(wc(2027, 5, 4, 14, 10))
  })

  it('keeps the printed time when it is unambiguous, or when the model read a different time', () => {
    // An explicit am wins over the model's pm, and is flagged.
    const am = noticeLocalTime(noticeFields({ offence_time_raw: '2:10 am', offence_datetime_local: '2027-05-04T14:10' }))
    expect(am.local).toEqual(wc(2027, 5, 4, 2, 10))
    expect(am.time_disagrees).toBe(true)
    // A 24-hour "02:10 hrs" style four-digit time is not ambiguous.
    const military = noticeLocalTime(noticeFields({ offence_time_raw: '0210', offence_datetime_local: '2027-05-04T14:10' }))
    expect(military.local).toEqual(wc(2027, 5, 4, 2, 10))
    expect(military.time_disagrees).toBe(true)
    // Different minutes: not the same time read in the other half of the day.
    const other = noticeLocalTime(noticeFields({ offence_time_raw: '2:10', offence_datetime_local: '2027-05-04T14:25' }))
    expect(other.local).toEqual(wc(2027, 5, 4, 2, 10))
    expect(other.time_disagrees).toBe(true)
  })

  it('a zero-padded 24-hour "02:10" is 2:10 am: a model reading of 14:10 is flagged, not taken (polish list)', () => {
    for (const offence_time_raw of ['02:10', '02.10', '02:10:00']) {
      const t = noticeLocalTime(noticeFields({ offence_time_raw, offence_datetime_local: '2027-05-04T14:10' }))
      expect(t.local, offence_time_raw).toEqual(wc(2027, 5, 4, 2, 10))
      expect(t.time_source, offence_time_raw).toBe('printed')
      expect(t.time_disagrees, offence_time_raw).toBe(true)
      expect(t.disagrees, offence_time_raw).toBe(true)
    }
    // In the date field too.
    const inDate = noticeLocalTime(
      noticeFields({ offence_date_raw: '04/05/2027 02:10', offence_time_raw: null, offence_datetime_local: '2027-05-04T14:10' }),
    )
    expect(inDate.local).toEqual(wc(2027, 5, 4, 2, 10))
    expect(inDate.time_disagrees).toBe(true)
    // An unpadded "2:10" and a two-digit "12:10" still leave the half of the day open.
    expect(noticeLocalTime(noticeFields({ offence_time_raw: '2:10', offence_datetime_local: '2027-05-04T14:10' })).time_disagrees).toBe(false)
    expect(noticeLocalTime(noticeFields({ offence_time_raw: '12:10', offence_datetime_local: '2027-05-04T00:10' })).time_disagrees).toBe(false)
    // A padded time that agrees with the model is simply right.
    expect(noticeLocalTime(noticeFields({ offence_time_raw: '02:10', offence_datetime_local: '2027-05-04T02:10' })).disagrees).toBe(false)
  })

  it('has no local time without both a date and a time', () => {
    const t = noticeLocalTime(noticeFields({ offence_time_raw: null, offence_datetime_local: null }))
    expect(t.raw_date).toEqual({ year: 2027, month: 5, day: 4 })
    expect(t.local).toBeNull()
    expect(t.disagrees).toBe(false)
  })
})

// ─── Where the notice was issued ──────────────────────────────────────────

describe('inferIssuingState', () => {
  const state = (issuing_authority: string | null, location_text: string | null) =>
    inferIssuingState({ issuing_authority, location_text })

  it('reads a state abbreviation or postcode in the location', () => {
    expect(state(null, 'Lygon St, Carlton VIC 3053')).toBe('VIC')
    expect(state(null, 'Queen St, Brisbane City Qld')).toBe('QLD')
    expect(state(null, 'Rundle Mall, Adelaide 5000')).toBe('SA')
    expect(state(null, 'Smith St, Darwin NT 0800')).toBe('NT')
    expect(state(null, 'Northbourne Ave, Braddon ACT 2612')).toBe('ACT')
  })

  it('never reads a street or bay name as the state', () => {
    // Sydney Road is in Melbourne; with no state in the location, the authority decides.
    expect(state('Merri-bek City Council', 'Sydney Rd, Brunswick')).toBeNull()
    expect(state('Fines Victoria', 'Sydney Rd, Brunswick')).toBe('VIC')
    // A trailing bay or meter number is not a postcode.
    expect(state(null, 'Lygon St, Carlton, Bay 3021')).toBeNull()
    expect(state(null, 'Meter 4001')).toBeNull()
  })

  it('reads a state or capital city in the issuing authority', () => {
    expect(state('Fines Victoria', null)).toBe('VIC')
    expect(state('City of Melbourne', 'Collins St')).toBe('VIC')
    expect(state('Revenue NSW', null)).toBe('NSW')
    expect(state('City of Sydney', null)).toBe('NSW')
    expect(state('Brisbane City Council', null)).toBe('QLD')
    expect(state('Access Canberra', null)).toBe('ACT')
    expect(state('City of Perth', null)).toBe('WA')
    expect(state('City of Hobart', null)).toBe('TAS')
  })

  it('returns null when the clues disagree or there are none', () => {
    expect(state(null, 'Corner of VIC and NSW border')).toBeNull()
    expect(state('City of Yarra', 'Smith St, Fitzroy')).toBeNull()
    expect(state('Town of Victoria Park', null)).toBeNull()
    expect(state(null, null)).toBeNull()
  })

  it('maps postcodes to states', () => {
    expect(stateForPostcode(3000)).toBe('VIC')
    expect(stateForPostcode(2000)).toBe('NSW')
    expect(stateForPostcode(2600)).toBe('ACT')
    expect(stateForPostcode(2620)).toBe('NSW')
    expect(stateForPostcode(4000)).toBe('QLD')
    expect(stateForPostcode(800)).toBe('NT')
    expect(stateForPostcode(7000)).toBe('TAS')
    expect(stateForPostcode(6000)).toBe('WA')
    expect(stateForPostcode(99)).toBeNull()
  })
})

describe('noticeGeocodeQuery', () => {
  it('adds the state and the country when the location lacks them', () => {
    expect(noticeGeocodeQuery({ location_text: 'Lygon St, Carlton' }, 'VIC')).toBe('Lygon St, Carlton, VIC, Australia')
    expect(noticeGeocodeQuery({ location_text: 'Lygon St, Carlton VIC 3053' }, 'VIC')).toBe('Lygon St, Carlton VIC 3053, Australia')
    expect(noticeGeocodeQuery({ location_text: 'Lygon St, Carlton, Australia' }, null)).toBe('Lygon St, Carlton, Australia')
    expect(noticeGeocodeQuery({ location_text: '  ' }, 'VIC')).toBeNull()
    expect(noticeGeocodeQuery({ location_text: null })).toBeNull()
  })
})

describe('noticeFallbackZones', () => {
  it("prefers the zone of the notice's geocoded location", () => {
    expect(noticeFallbackZones({ noticePoint: { lat: -31.9523, lng: 115.8613 }, issuingState: 'VIC' })).toEqual({
      zones: ['Australia/Perth'],
      source: 'notice_location',
    })
  })

  it('uses the issuing state when the location is missing or outside Australia', () => {
    expect(noticeFallbackZones({ noticePoint: null, issuingState: 'QLD' })).toEqual({ zones: [BNE], source: 'issuing_state' })
    expect(noticeFallbackZones({ noticePoint: { lat: 51.5074, lng: -0.1278 }, issuingState: 'SA' })).toEqual({
      zones: ['Australia/Adelaide'],
      source: 'issuing_state',
    })
  })

  it('uses every Australian zone when nothing is known', () => {
    const r = noticeFallbackZones({})
    expect(r.source).toBe('all_zones')
    expect(r.zones).toEqual([...ALL_AUSTRALIAN_ZONES])
    for (const zone of Object.values(STATE_ZONES)) expect(r.zones).toContain(zone)
  })
})

// ─── Records ──────────────────────────────────────────────────────────────

const MELBOURNE_CBD = { lat: -37.8136, lng: 144.9631 }
const BRISBANE_CBD = { lat: -27.4698, lng: 153.0251 }
const PERTH_CBD = { lat: -31.9523, lng: 115.8613 }
const LYGON_ST = { lat: -37.798, lng: 144.9675 }

function record(id: string, overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id,
    arrived_at: '2026-11-08T02:00:00.000Z',
    location: { ...MELBOURNE_CBD, source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    ...overrides,
  }
}

function departureAddendum(ended_at: string, signed_at: string | null, key_alias = 'alias/parkproof-evidence-signing'): SignedAddendum {
  const data = { ended_at, location: null, distance_from_arrival_m: null, return_photos: [] }
  const addendum: SignedAddendum = { id: `dep-${ended_at}`, seq: 1, kind: 'departure', captured_at: ended_at, data }
  if (signed_at) {
    const payload = {
      schema: 'parkproof-addendum-v1',
      addendum_id: addendum.id,
      kind: 'departure',
      session_id: 'rec',
      seq: 1,
      parent_payload_sha256: '0'.repeat(64),
      chain_key_sha256: null,
      captured_at: ended_at,
      signed_at,
      data,
    }
    addendum.bundle = {
      schema: 'parkproof-addendum-v1',
      signed_at,
      algorithm: 'ECDSA_SHA_256',
      key_alias,
      canonical_payload: JSON.stringify(payload),
      signature_base64: 'MEUCIQ',
    }
  }
  return addendum
}

describe('recordWindow', () => {
  it("ends at ParkProof's signing time of the departure when it is signed", () => {
    const w = recordWindow(
      record('r', {
        ended_at: '2026-11-08T02:55:00.000Z',
        expires_at: '2026-11-08T04:00:00.000Z',
        addenda: [departureAddendum('2026-11-08T02:55:00.000Z', '2026-11-08T04:12:00.000Z')],
      }),
    )
    expect(w?.end_source).toBe('departure_signed')
    expect(new Date(w!.end_ms).toISOString()).toBe('2026-11-08T04:12:00.000Z')
    expect(new Date(w!.start_ms).toISOString()).toBe('2026-11-08T01:50:00.000Z')
    expect(new Date(w!.until_ms).toISOString()).toBe('2026-11-08T10:12:00.000Z')
    // The span it is ranked on ends at the tap, not the later signing time.
    expect(new Date(w!.span_end_ms).toISOString()).toBe('2026-11-08T02:55:00.000Z')
  })

  it('ends the ranked span at the signing time when the phone clock put the tap later', () => {
    // A phone clock running fast: tap 3:05 pm, ParkProof signed at 3:00 pm.
    const w = recordWindow(
      record('r', {
        ended_at: '2026-11-08T04:05:00.000Z',
        addenda: [departureAddendum('2026-11-08T04:05:00.000Z', '2026-11-08T04:00:00.000Z')],
      }),
    )
    expect(new Date(w!.span_end_ms).toISOString()).toBe('2026-11-08T04:00:00.000Z')
    // Without a tap the span ends where the window does.
    const open = recordWindow(record('r', { expires_at: '2026-11-08T04:00:00.000Z' }))
    expect(open!.span_end_ms).toBe(open!.end_ms)
  })

  it('counts a development-key signature as signed for the window', () => {
    const w = recordWindow(
      record('r', {
        ended_at: '2026-11-08T02:55:00.000Z',
        addenda: [departureAddendum('2026-11-08T02:55:00.000Z', '2026-11-08T03:00:00.000Z', 'dev-ephemeral')],
      }),
    )
    expect(w?.end_source).toBe('departure_signed')
  })

  it('ends at the I\'ve left tap when the departure is not signed yet', () => {
    const w = recordWindow(
      record('r', {
        ended_at: '2026-11-08T02:55:00.000Z',
        expires_at: '2026-11-08T04:00:00.000Z',
        addenda: [departureAddendum('2026-11-08T02:55:00.000Z', null)],
      }),
    )
    expect(w?.end_source).toBe('ended')
    expect(new Date(w!.end_ms).toISOString()).toBe('2026-11-08T02:55:00.000Z')
  })

  it('ends at the expiry without a departure, and 24 hours after arrival without either', () => {
    const expiring = recordWindow(record('r', { expires_at: '2026-11-08T04:00:00.000Z' }))
    expect(expiring?.end_source).toBe('expires')
    expect(new Date(expiring!.end_ms).toISOString()).toBe('2026-11-08T04:00:00.000Z')
    const open = recordWindow(record('r', { expires_at: null }))
    expect(open?.end_source).toBe('arrived_plus_24h')
    expect(new Date(open!.end_ms).toISOString()).toBe('2026-11-09T02:00:00.000Z')
  })

  it('has no window when the arrival time cannot be read', () => {
    expect(recordWindow(record('r', { arrived_at: 'garbage' }))).toBeNull()
  })
})

// ─── matchNotice ──────────────────────────────────────────────────────────

describe('matchNotice: the window', () => {
  // 2:10 pm AEDT on 8 November 2026 is 03:10Z.
  const local = wc(2026, 11, 8, 14, 10)

  it('starts 10 minutes before the record was logged', () => {
    const nine = record('nine', { arrived_at: '2026-11-08T03:19:00.000Z' })
    const eleven = record('eleven', { arrived_at: '2026-11-08T03:21:00.000Z' })
    const matches = matchNotice({ local, records: [nine, eleven] })
    expect(matches.map((m) => m.session_id)).toEqual(['nine'])
    expect(matches[0].inside).toBe(false)
    expect(matches[0].time_distance_ms).toBe(9 * 60_000)
    expect(matches[0].notice_at).toBe('2026-11-08T03:10:00.000Z')
  })

  it("ends 6 hours after the record's end", () => {
    const within = record('within', { arrived_at: '2026-11-07T20:00:00.000Z', expires_at: '2026-11-07T21:11:00.000Z' })
    const past = record('past', { arrived_at: '2026-11-07T20:00:00.000Z', expires_at: '2026-11-07T21:09:00.000Z' })
    const matches = matchNotice({ local, records: [within, past] })
    expect(matches.map((m) => m.session_id)).toEqual(['within'])
    expect(matches[0].record_end).toEqual({ at: '2026-11-07T21:11:00.000Z', source: 'expires' })
  })

  it('keeps a record signed after the notice in the window, but ranks it from the I\'ve left tap', () => {
    // Tapped I've left at 1:55 pm, signed at 3:12 pm, notice at 2:10 pm.
    const signedLate = record('signed-late', {
      ended_at: '2026-11-08T02:55:00.000Z',
      addenda: [departureAddendum('2026-11-08T02:55:00.000Z', '2026-11-08T04:12:00.000Z')],
    })
    const [m] = matchNotice({ local, records: [signedLate] })
    expect(m.record_end.source).toBe('departure_signed')
    expect(m.inside).toBe(false)
    expect(m.time_distance_ms).toBe(15 * 60_000)

    const unsigned = record('unsigned', { ended_at: '2026-11-08T02:55:00.000Z' })
    const [u] = matchNotice({ local, records: [unsigned] })
    expect(u.record_end.source).toBe('ended')
    expect(u.inside).toBe(false)
    expect(u.time_distance_ms).toBe(15 * 60_000)
  })

  it('never ranks a record whose departure was signed a day late above the record that spans the notice', () => {
    // A: parked Mon 9 to 10 am on this street; its departure was only signed Tue 6 pm (the next app open).
    // B: parked Tue 12 noon, left and signed Tue 2:05 pm. Notice: Tue 2:20 pm. All times AEDT.
    const a = record('a-signed-late', {
      arrived_at: '2026-11-08T22:00:00.000Z',
      expires_at: '2026-11-09T00:00:00.000Z',
      ended_at: '2026-11-08T23:00:00.000Z',
      addenda: [departureAddendum('2026-11-08T23:00:00.000Z', '2026-11-10T07:00:00.000Z')],
    })
    const b = record('b-spans', {
      arrived_at: '2026-11-10T01:00:00.000Z',
      expires_at: '2026-11-10T03:00:00.000Z',
      ended_at: '2026-11-10T03:05:00.000Z',
      addenda: [departureAddendum('2026-11-10T03:05:00.000Z', '2026-11-10T03:05:30.000Z')],
    })
    const tuesday = wc(2026, 11, 10, 14, 20)
    for (const noticePoint of [null, { lat: -37.8136, lng: 144.9631 }]) {
      const matches = matchNotice({ local: tuesday, records: [a, b], noticePoint })
      expect(matches.map((m) => m.session_id)).toEqual(['b-spans', 'a-signed-late'])
      const stale = matches[1]
      // Still in A's window (its signing time plus 6 hours), but 28 h 20 min after its tap.
      expect(stale.record_end.source).toBe('departure_signed')
      expect(stale.inside).toBe(false)
      expect(stale.time_distance_ms).toBe((28 * 60 + 20) * 60_000)
      expect(matches[0].time_distance_ms).toBe(15 * 60_000)
    }
  })

  it('skips records it cannot read and returns nothing for an impossible time', () => {
    expect(matchNotice({ local, records: [record('bad', { arrived_at: 'garbage' })] })).toEqual([])
    expect(matchNotice({ local: wc(2027, 2, 29, 14, 10), records: [record('r')] })).toEqual([])
  })
})

describe('matchNotice: daylight saving', () => {
  it('matches the second 02:30 on 4 April 2027 to a record from the repeated hour', () => {
    // Logged at 02:05 AEST (after the clocks went back), left at 02:50 AEST.
    const r = record('second-pass', { arrived_at: '2027-04-03T16:05:00.000Z', ended_at: '2027-04-03T16:50:00.000Z' })
    const [m] = matchNotice({ local: wc(2027, 4, 4, 2, 30), records: [r] })
    expect(m.time_status).toBe('repeated')
    expect(m.notice_at).toBe('2027-04-03T16:30:00.000Z')
    // The first 02:30 (AEDT) is before this record's window.
    expect(m.candidates).toEqual(['2027-04-03T16:30:00.000Z'])
    expect(m.inside).toBe(true)
  })

  it('picks the reading inside the record when both readings fall in its window', () => {
    // Logged 02:20 AEDT, left 02:40 AEDT: the first 02:30 is inside, the second is 50 minutes after.
    const r = record('first-pass', { arrived_at: '2027-04-03T15:20:00.000Z', ended_at: '2027-04-03T15:40:00.000Z' })
    const [m] = matchNotice({ local: wc(2027, 4, 4, 2, 30), records: [r] })
    expect(m.notice_at).toBe('2027-04-03T15:30:00.000Z')
    expect(m.candidates).toEqual(['2027-04-03T15:30:00.000Z', '2027-04-03T16:30:00.000Z'])
    expect(m.inside).toBe(true)

    // Across the whole repeated hour both are inside: the earlier is shown.
    const span = record('span', { arrived_at: '2027-04-03T15:00:00.000Z', ended_at: '2027-04-03T17:00:00.000Z' })
    const [s] = matchNotice({ local: wc(2027, 4, 4, 2, 30), records: [span] })
    expect(s.notice_at).toBe('2027-04-03T15:30:00.000Z')
    expect(s.candidates).toHaveLength(2)
  })

  it('reads the skipped 02:30 on 4 October 2026 as 03:30 AEDT', () => {
    const r = record('after-change', { arrived_at: '2026-10-03T16:00:00.000Z', ended_at: '2026-10-03T16:45:00.000Z' })
    const [m] = matchNotice({ local: wc(2026, 10, 4, 2, 30), records: [r] })
    expect(m.time_status).toBe('skipped')
    expect(m.notice_at).toBe('2026-10-03T16:30:00.000Z')
    expect(m.inside).toBe(true)
  })

  it("reads a Brisbane record's notice in Brisbane time, not Melbourne's", () => {
    // Noon AEST in Brisbane is 02:00Z; in Melbourne that day it would be 01:00Z.
    const r = record('brisbane', {
      arrived_at: '2026-10-04T01:50:00.000Z',
      ended_at: '2026-10-04T02:20:00.000Z',
      location: { ...BRISBANE_CBD, source: 'gps' },
    })
    const [m] = matchNotice({ local: wc(2026, 10, 4, 12, 0), records: [r] })
    expect(m.zone).toBe(BNE)
    expect(m.zone_source).toBe('record')
    expect(m.notice_at).toBe('2026-10-04T02:00:00.000Z')
    expect(m.inside).toBe(true)
    expect(m.time_status).toBe('normal')

    // 02:30 on the Melbourne change day is an ordinary time in Brisbane.
    const night = record('brisbane-night', {
      arrived_at: '2026-10-03T16:20:00.000Z',
      ended_at: '2026-10-03T16:40:00.000Z',
      location: { ...BRISBANE_CBD, source: 'gps' },
    })
    const [n] = matchNotice({ local: wc(2026, 10, 4, 2, 30), records: [night] })
    expect(n.time_status).toBe('normal')
    expect(n.notice_at).toBe('2026-10-03T16:30:00.000Z')
    const [a] = matchNotice({
      local: wc(2027, 4, 4, 2, 30),
      records: [record('bne-april', { arrived_at: '2027-04-03T16:00:00.000Z', location: { ...BRISBANE_CBD, source: 'gps' } })],
    })
    expect(a.time_status).toBe('normal')
    expect(a.candidates).toEqual(['2027-04-03T16:30:00.000Z'])
  })
})

describe('matchNotice: records without a location', () => {
  // 2:10 pm AWST in Perth is 06:10Z. Every other Australian zone reads it before 05:40Z.
  const local = wc(2026, 11, 8, 14, 10)
  const noLocation = () =>
    record('no-location', { arrived_at: '2026-11-08T05:50:00.000Z', ended_at: '2026-11-08T06:30:00.000Z', location: null })

  it("use the zone of the notice's geocoded location first", () => {
    const [m] = matchNotice({ local, records: [noLocation()], noticePoint: PERTH_CBD, issuingState: 'VIC' })
    expect(m.zone).toBe('Australia/Perth')
    expect(m.zone_source).toBe('notice_location')
    expect(m.inside).toBe(true)
    // Located in Melbourne, the notice reads as 03:10Z: no match, even though the state says WA.
    expect(matchNotice({ local, records: [noLocation()], noticePoint: MELBOURNE_CBD, issuingState: 'WA' })).toEqual([])
  })

  it('then the issuing state', () => {
    const [m] = matchNotice({ local, records: [noLocation()], noticePoint: null, issuingState: 'WA' })
    expect(m.zone).toBe('Australia/Perth')
    expect(m.zone_source).toBe('issuing_state')
    expect(matchNotice({ local, records: [noLocation()], issuingState: 'NSW' })).toEqual([])
  })

  it('then every Australian zone', () => {
    const [m] = matchNotice({ local, records: [noLocation()] })
    expect(m.zone_source).toBe('all_zones')
    expect(m.zone).toBe('Australia/Perth')
    expect(m.notice_at).toBe('2026-11-08T06:10:00.000Z')
    expect(m.distance_m).toBeNull()
  })

  it("never override a located record's own zone", () => {
    const located = record('located', { arrived_at: '2026-11-08T02:00:00.000Z', expires_at: '2026-11-08T04:00:00.000Z' })
    const [m] = matchNotice({ local, records: [located], noticePoint: PERTH_CBD, issuingState: 'WA' })
    expect(m.zone).toBe(MEL)
    expect(m.zone_source).toBe('record')
    expect(m.notice_at).toBe('2026-11-08T03:10:00.000Z')
  })
})

describe('matchNotice: ranking', () => {
  const local = wc(2026, 11, 8, 14, 10) // 03:10Z
  const near = { lat: LYGON_ST.lat + 0.0018, lng: LYGON_ST.lng } // about 200 m
  const stKilda = { lat: -37.8676, lng: 144.981 } // about 8 km

  const insideNear = record('inside-near', { expires_at: '2026-11-08T04:00:00.000Z', location: { ...near, source: 'gps' } })
  const insideFar = record('inside-far', { expires_at: '2026-11-08T04:00:00.000Z', location: { ...stKilda, source: 'gps' } })
  const afterSameSpot = record('after-same-spot', {
    arrived_at: '2026-11-08T01:30:00.000Z',
    ended_at: '2026-11-08T02:30:00.000Z',
    location: { ...LYGON_ST, source: 'gps' },
  })
  const insideUnknown = record('inside-unknown', { expires_at: '2026-11-08T04:00:00.000Z', location: null })

  it('ranks by time from the record plus distance from the notice, unknown distance in between', () => {
    const matches = matchNotice({
      local,
      records: [insideFar, afterSameSpot, insideUnknown, insideNear],
      noticePoint: LYGON_ST,
      issuingState: 'VIC',
    })
    expect(matches.map((m) => m.session_id)).toEqual(['inside-near', 'inside-unknown', 'after-same-spot', 'inside-far'])

    const byId = Object.fromEntries(matches.map((m) => [m.session_id, m]))
    expect(byId['inside-near'].distance_m).toBeGreaterThan(150)
    expect(byId['inside-near'].distance_m).toBeLessThan(250)
    expect(byId['inside-near'].far).toBe(false)
    expect(byId['inside-far'].distance_m).toBeGreaterThan(FAR_FROM_NOTICE_M)
    expect(byId['inside-far'].far).toBe(true)
    expect(byId['after-same-spot'].time_distance_ms).toBe(40 * 60_000)
    expect(byId['after-same-spot'].distance_m).toBeLessThan(1)
    expect(byId['inside-unknown'].distance_m).toBeNull()
  })

  it('ranks by time alone when the notice location is unknown', () => {
    const matches = matchNotice({ local, records: [afterSameSpot, insideFar] })
    expect(matches.map((m) => m.session_id)).toEqual(['inside-far', 'after-same-spot'])
    expect(matches.every((m) => m.distance_m === null)).toBe(true)
  })

  it('breaks a tie with the later record', () => {
    const early = record('early', { arrived_at: '2026-11-08T01:00:00.000Z', expires_at: '2026-11-08T05:00:00.000Z' })
    const late = record('late', { arrived_at: '2026-11-08T02:30:00.000Z', expires_at: '2026-11-08T05:00:00.000Z' })
    expect(matchNotice({ local, records: [early, late] }).map((m) => m.session_id)).toEqual(['late', 'early'])
  })

  it('reports the window it used', () => {
    const [m] = matchNotice({ local, records: [insideNear], noticePoint: LYGON_ST })
    expect(m.window).toEqual({ start: '2026-11-08T01:50:00.000Z', end: '2026-11-08T10:00:00.000Z' })
    expect(m.record_end).toEqual({ at: '2026-11-08T04:00:00.000Z', source: 'expires' })
  })
})
