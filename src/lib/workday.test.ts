// @vitest-environment node
//
// Workday mode's safety maths (build spec T6a items 3 to 5).
//
// Why this file is in the suite: moving a few bays along the same signed
// stretch doesn't restart the limit (Road Rules r205(2), r332), and under an
// area sign the car must leave the whole area (r335). If the same-stretch
// check stays quiet when it should ask, or the deadline maths starts a new
// limit after "I'm not sure", the app tells a driver they have time they
// don't have, and the signed record is evidence of the breach. Every
// boundary and every answer is pinned here.

import { describe, expect, it } from 'vitest'
import i18next, { type TFunction } from 'i18next'
import en from '../locales/en.json'
import type { BoundaryAnswer, BoundaryAskedBecause, ParkingSession } from '../types'
import { ISO_TIME_RE } from '../../lambda/addendum-schema.js'
import { formatExpiryAbsolute } from './time-format'
import { sessionLink } from './deep-link'
import {
  DEFAULT_WALK_MIN,
  HEADS_UP_BEFORE_MIN,
  MAX_LEG_INDEX,
  MIN_SCHEDULE_LEAD_MS,
  SAME_ROAD_M,
  SAME_SIGN_TEXT_M,
  SAME_SPOT_M,
  SEARCH_AND_MARGIN_MIN,
  STRETCH_BOUNDARY_ANSWERS,
  UNRELIABLE_ACCURACY_M,
  WORKDAY_AREA_REMINDER_KEYS,
  WORKDAY_REMINDER_KEYS,
  boundaryOptions,
  buildBoundaryStatement,
  isAreaSignLeg,
  isReliableLocation,
  legDeadline,
  legInAreaMode,
  nextLegIndex,
  normaliseRoad,
  normaliseSignText,
  previousStretchLeg,
  sameStretchCheck,
  startsNewLimit,
  stretchLegFromReading,
  stretchLegFromRecord,
  stretchInAreaMode,
  stretchStartedAt,
  walkAllowanceMinutes,
  workdayLegs,
  workdayPushReminders,
  workdayReminderCopy,
  workdayReminderSchedule,
  type AreaModeLeg,
  type StretchLeg,
  type StretchLocation,
  type WorkdayReminder,
} from './workday'

const MIN = 60_000
const MELB = { lat: -37.7983, lng: 144.9671 } // Carlton
const BRIS = { lat: -27.4698, lng: 153.0251 } // Brisbane CBD (no daylight saving)

const gps = (accuracy: number | null = 8, at = MELB): StretchLocation => ({
  lat: at.lat,
  lng: at.lng,
  source: 'gps',
  accuracy_meters: accuracy,
})

/**
 * A leg with nothing in common with the other one unless a test says so:
 * a reliable fix, a known road, its own sign text, not an area sign.
 */
const leg = (over: Partial<StretchLeg> = {}): StretchLeg => ({
  location: gps(),
  road: 'Lygon Street',
  sign_text: '2P Mon-Fri 8am-6pm',
  is_area_sign: false,
  ...over,
})
const prevLeg = (over: Partial<StretchLeg> = {}) => leg(over)
const nextLeg = (over: Partial<StretchLeg> = {}) =>
  leg({ road: 'Drummond Street', sign_text: '1P Mon-Sat 7:30am-6:30pm', ...over })

/** Pin the distance the check sees, so boundaries are exact. */
const at = (m: number) => ({ distance: () => m })

const reasons = (p: StretchLeg, n: StretchLeg, m: number) => sameStretchCheck(p, n, at(m)).asked_because

// ─── 3. Same-stretch check ─────────────────────────────────────────────────

describe('sameStretchCheck: nothing in common', () => {
  it('does not ask when the parks are far apart on different roads with different signs', () => {
    const check = sameStretchCheck(prevLeg(), nextLeg(), at(450))
    expect(check).toEqual({ ask: false, area_mode: false, asked_because: [], distance_from_previous_m: 450 })
  })

  it('pins the thresholds the spec sets', () => {
    expect([SAME_SPOT_M, SAME_ROAD_M, SAME_SIGN_TEXT_M, UNRELIABLE_ACCURACY_M]).toEqual([30, 150, 300, 100])
  })
})

describe('sameStretchCheck: within 30 m', () => {
  it('asks at 29.9 m, on its own', () => {
    expect(reasons(prevLeg(), nextLeg(), 29.9)).toEqual(['within_30m'])
  })
  it('asks at exactly 30 m (inclusive)', () => {
    expect(reasons(prevLeg(), nextLeg(), 30)).toEqual(['within_30m'])
  })
  it('does not ask at 30.1 m when nothing else matches', () => {
    expect(sameStretchCheck(prevLeg(), nextLeg(), at(30.1)).ask).toBe(false)
  })
  it('asks at 0 m (the very same bay)', () => {
    expect(reasons(prevLeg(), nextLeg(), 0)).toEqual(['within_30m'])
  })
  it('uses the real distance between the fixes by default', () => {
    // 1e-4 degrees of latitude is about 11.1 m.
    const near = gps(8, { lat: MELB.lat + 0.00018, lng: MELB.lng }) // about 20 m
    const far = gps(8, { lat: MELB.lat + 0.00036, lng: MELB.lng }) // about 40 m
    const a = sameStretchCheck(prevLeg(), nextLeg({ location: near }))
    expect(a.asked_because).toEqual(['within_30m'])
    expect(a.distance_from_previous_m).toBeGreaterThan(19)
    expect(a.distance_from_previous_m).toBeLessThan(21)
    expect(sameStretchCheck(prevLeg(), nextLeg({ location: far })).ask).toBe(false)
  })
})

describe('sameStretchCheck: same road within 150 m', () => {
  const sameRoad = { road: 'Lygon Street' }
  it('asks at 149.9 m and at exactly 150 m, on its own', () => {
    expect(reasons(prevLeg(), nextLeg(sameRoad), 149.9)).toEqual(['same_street'])
    expect(reasons(prevLeg(), nextLeg(sameRoad), 150)).toEqual(['same_street'])
  })
  it('does not ask at 150.1 m', () => {
    expect(sameStretchCheck(prevLeg(), nextLeg(sameRoad), at(150.1)).ask).toBe(false)
  })
  it('matches road names however they are written', () => {
    expect(reasons(prevLeg({ road: 'Lygon St.' }), nextLeg({ road: 'LYGON  STREET' }), 120)).toEqual(['same_street'])
    expect(normaliseRoad('St Kilda Rd')).toBe(normaliseRoad('St. Kilda Road'))
    expect(normaliseRoad('Smith Street')).not.toBe(normaliseRoad('Smith Lane'))
    expect(normaliseRoad('  ')).toBeNull()
    expect(normaliseRoad(null)).toBeNull()
  })
  it('different roads within 150 m do not count as the same street', () => {
    expect(reasons(prevLeg(), nextLeg(), 100)).toEqual([])
  })
  it('an unknown road finds no same-street match and adds no reason of its own', () => {
    // asked_because is signed: with two good GPS fixes, "location_unreliable"
    // would be a false statement, so an unknown road only means no match.
    expect(reasons(prevLeg({ road: null }), nextLeg(), 149)).toEqual([])
    expect(reasons(prevLeg(), nextLeg({ road: null }), 150)).toEqual([])
    expect(reasons(prevLeg({ road: null }), nextLeg({ road: null }), 60)).toEqual([])
    // The other tests still run without a road.
    expect(reasons(prevLeg({ road: null }), nextLeg({ road: null }), 20)).toEqual(['within_30m'])
    expect(reasons(prevLeg({ road: null }), nextLeg({ road: null, sign_text: '2P Mon-Fri 8am-6pm' }), 200)).toEqual([
      'same_sign_text',
    ])
  })
  it('an unknown road beyond 150 m does not ask', () => {
    expect(sameStretchCheck(prevLeg({ road: null }), nextLeg({ road: null }), at(150.1)).ask).toBe(false)
  })
})

describe('sameStretchCheck: same sign text within 300 m', () => {
  const sameSign = { sign_text: '2P Mon-Fri 8am-6pm' }
  it('asks at 299.9 m and at exactly 300 m, on its own', () => {
    expect(reasons(prevLeg(), nextLeg(sameSign), 299.9)).toEqual(['same_sign_text'])
    expect(reasons(prevLeg(), nextLeg(sameSign), 300)).toEqual(['same_sign_text'])
  })
  it('does not ask at 300.1 m', () => {
    expect(sameStretchCheck(prevLeg(), nextLeg(sameSign), at(300.1)).ask).toBe(false)
  })
  it('matches two readings of the same sign written differently', () => {
    const variants = [
      '2P Mon–Fri 8:00 am – 6:00 pm',
      '2P  8am-6pm Monday to Friday',
      '2 hour, Mon-Fri, 8 a.m. to 6 p.m.',
      '2p MON-FRI 8AM-6PM.',
    ]
    for (const v of variants) {
      expect(reasons(prevLeg(), nextLeg({ sign_text: v }), 250), v).toEqual(['same_sign_text'])
    }
  })
  it('does not match a sign with a different limit, days or hours', () => {
    for (const v of ['1P Mon-Fri 8am-6pm', '2P Mon-Sat 8am-6pm', '2P Mon-Fri 8am-7pm', '2P Mon-Fri 8:30am-6pm']) {
      expect(sameStretchCheck(prevLeg(), nextLeg({ sign_text: v }), at(250)).ask, v).toBe(false)
    }
  })
  it('empty or missing sign text never matches', () => {
    expect(sameStretchCheck(prevLeg({ sign_text: '' }), nextLeg({ sign_text: '' }), at(200)).ask).toBe(false)
    expect(sameStretchCheck(prevLeg({ sign_text: null }), nextLeg({ sign_text: null }), at(200)).ask).toBe(false)
    expect(normaliseSignText(' - . ')).toBeNull()
  })
})

describe('sameStretchCheck: area signs (area mode always asks)', () => {
  it('asks when only the previous leg has an area sign, however far away', () => {
    const check = sameStretchCheck(prevLeg({ is_area_sign: true }), nextLeg(), at(5000))
    expect(check).toMatchObject({ ask: true, area_mode: true, asked_because: ['area_sign'] })
  })
  it('asks when only the new leg has an area sign', () => {
    const check = sameStretchCheck(prevLeg(), nextLeg({ is_area_sign: true }), at(5000))
    expect(check).toMatchObject({ ask: true, area_mode: true, asked_because: ['area_sign'] })
  })
  it('an unknown flag (before T3) counts as an area sign when the sign text names an area', () => {
    const areaText = '2P Parking Area 8am-6pm Mon-Fri'
    for (const [p, n] of [
      [prevLeg({ is_area_sign: null, sign_text: areaText }), nextLeg({ is_area_sign: null })],
      [prevLeg({ is_area_sign: null }), nextLeg({ is_area_sign: null, sign_text: 'AREA 1P' })],
    ]) {
      const check = sameStretchCheck(p, n, at(5000))
      expect(check).toMatchObject({ ask: true, area_mode: true, asked_because: ['area_sign'] })
    }
  })
  it('an unknown flag with sign text that names no area is not an area sign', () => {
    const check = sameStretchCheck(prevLeg({ is_area_sign: null }), nextLeg({ is_area_sign: null }), at(5000))
    expect(check.area_mode).toBe(false)
    expect(check.ask).toBe(false)
    expect(isAreaSignLeg({ is_area_sign: null, sign_text: null })).toBe(false)
    expect(isAreaSignLeg({ is_area_sign: null, sign_text: '2P Mon-Fri, Clearway 4:30pm-6:30pm' })).toBe(false)
  })
  it('a known flag (T3) decides, whatever the text says', () => {
    expect(isAreaSignLeg({ is_area_sign: false, sign_text: 'Permit Area 25 excepted' })).toBe(false)
    expect(isAreaSignLeg({ is_area_sign: true, sign_text: '2P' })).toBe(true)
    const check = sameStretchCheck(prevLeg({ is_area_sign: false, sign_text: '2P Area' }), nextLeg(), at(5000))
    expect(check.ask).toBe(false)
  })
  it('offers the area question in area mode and the stretch question otherwise', () => {
    expect(boundaryOptions({ area_mode: true })).toEqual(['left_parking_area', 'not_sure'])
    expect(boundaryOptions({ area_mode: false })).toEqual([
      'opposite_direction_sign',
      'yellow_edge_line',
      't_intersection_or_dead_end',
      'not_sure',
    ])
  })
})

describe('sameStretchCheck: location missing, typed in, unknown or poor accuracy', () => {
  const unreliable: Array<[string, StretchLocation | null]> = [
    ['missing', null],
    ['typed in (manual)', { ...MELB, source: 'manual' }],
    ['typed in with an accuracy', { ...MELB, source: 'manual', accuracy_meters: 0 }],
    ['unknown accuracy (null)', gps(null)],
    ['unknown accuracy (absent)', { ...MELB, source: 'gps' }],
    ['no source (an older record)', { ...MELB, accuracy_meters: 5 }],
    ['worse than 100 m', gps(100.1)],
    ['far worse than 100 m', gps(2500)],
    ['a negative accuracy', gps(-1)],
    ['not a number', { lat: Number.NaN, lng: MELB.lng, source: 'gps', accuracy_meters: 5 }],
    ['off the globe', { lat: -137, lng: MELB.lng, source: 'gps', accuracy_meters: 5 }],
  ]
  for (const [label, location] of unreliable) {
    it(`asks when the previous leg's location is ${label}`, () => {
      const check = sameStretchCheck(prevLeg({ location }), nextLeg(), at(4000))
      expect(check.asked_because).toContain('location_unreliable')
      expect(check.ask).toBe(true)
      expect(isReliableLocation(location)).toBe(false)
    })
    it(`asks when the new leg's location is ${label}`, () => {
      const check = sameStretchCheck(prevLeg(), nextLeg({ location }), at(4000))
      expect(check.asked_because).toContain('location_unreliable')
    })
  }

  it('accuracy of exactly 100 m is still reliable', () => {
    expect(isReliableLocation(gps(100))).toBe(true)
    expect(sameStretchCheck(prevLeg({ location: gps(100) }), nextLeg({ location: gps(100) }), at(4000)).ask).toBe(false)
  })

  it('reports no distance unless both locations are phone GPS', () => {
    expect(sameStretchCheck(prevLeg({ location: null }), nextLeg(), at(10)).distance_from_previous_m).toBeNull()
    const typed = { ...MELB, source: 'manual' as const }
    const check = sameStretchCheck(prevLeg({ location: typed }), nextLeg({ location: typed, road: 'Lygon Street' }), at(10))
    expect(check.distance_from_previous_m).toBeNull()
    // The distance tests can't run on a typed address, so only "unreliable" is recorded.
    expect(check.asked_because).toEqual(['location_unreliable'])
  })

  it('still measures a poor GPS fix, and records every reason that holds', () => {
    const check = sameStretchCheck(
      prevLeg({ is_area_sign: true }),
      nextLeg({ location: gps(150), road: 'Lygon St', sign_text: '2P Mon-Fri 8am-6pm' }),
      at(12.345),
    )
    expect(check.asked_because).toEqual<BoundaryAskedBecause[]>([
      'within_30m',
      'same_street',
      'same_sign_text',
      'area_sign',
      'location_unreliable',
    ])
    expect(check.distance_from_previous_m).toBe(12.3)
    expect(check.area_mode).toBe(true)
  })

  it('a distance function that returns nonsense counts as no distance', () => {
    const check = sameStretchCheck(prevLeg(), nextLeg({ road: 'Lygon Street' }), at(Number.NaN))
    expect(check.distance_from_previous_m).toBeNull()
    expect(check.asked_because).toEqual(['location_unreliable'])
  })
})

describe('legs from records and readings', () => {
  const record = {
    location: { ...MELB, source: 'gps' as const, accuracy_meters: 9, address: '1 Lygon St' },
    place: { road: 'Lygon Street', suburb: 'Carlton', state_code: 'AU-VIC' },
    rules: '2P Mon-Fri 8am-6pm',
    rule_flags: {
      requires_ticket: false,
      payment_methods: null,
      requires_disabled_permit: false,
      is_permit_zone: false,
      permit_area: null,
      is_area_sign: true,
    },
  } as Pick<ParkingSession, 'location' | 'place' | 'rules' | 'rule_flags'>

  it('reads location, road, sign text and the area flag from a saved record', () => {
    expect(stretchLegFromRecord(record)).toEqual({
      location: record.location,
      road: 'Lygon Street',
      sign_text: '2P Mon-Fri 8am-6pm',
      is_area_sign: true,
      area_limit: true,
    })
  })

  it('a record from before T3 (no rule_flags, no place) has unknown road and area flag', () => {
    const leg0 = stretchLegFromRecord({ location: null, rules: '' } as Pick<ParkingSession, 'location' | 'place' | 'rules' | 'rule_flags'>)
    expect(leg0).toEqual({ location: null, road: null, sign_text: null, is_area_sign: null, area_limit: false })
  })

  it('reads the new leg from the fresh reading and the logger state', () => {
    const l = stretchLegFromReading({ rules: '1P', until: null, is_area_sign: true }, gps(), { road: 'Elgin Street' })
    expect(l).toEqual({ location: gps(), road: 'Elgin Street', sign_text: '1P', is_area_sign: true })
    expect(stretchLegFromReading({ rules: '1P', until: null }, null, null).is_area_sign).toBeNull()
  })
})

describe('buildBoundaryStatement', () => {
  const asked = sameStretchCheck(prevLeg(), nextLeg(), at(12))
  const quiet = sameStretchCheck(prevLeg(), nextLeg(), at(800))

  it('records the driver\'s answer, the reasons and the distance when it asked', () => {
    expect(buildBoundaryStatement('prev-1', asked, 'yellow_edge_line')).toEqual({
      previous_session_id: 'prev-1',
      asked_because: ['within_30m'],
      answer: 'yellow_edge_line',
      distance_from_previous_m: 12,
    })
  })

  it('records not_asked when the check did not ask, whatever answer is passed', () => {
    expect(buildBoundaryStatement('prev-1', quiet, 'yellow_edge_line').answer).toBe('not_asked')
    expect(buildBoundaryStatement('prev-1', quiet, 'not_sure').answer).toBe('not_asked')
  })

  it('caps the previous id at the signed limit and copies the reasons', () => {
    const s = buildBoundaryStatement('x'.repeat(80), asked, 'not_sure')
    expect(s.previous_session_id).toHaveLength(64)
    s.asked_because.push('area_sign')
    expect(asked.asked_because).toEqual(['within_30m'])
  })
})

// ─── 4. Deadline maths ─────────────────────────────────────────────────────

const NORMAL: BoundaryAskedBecause[] = ['within_30m']
const AREA: BoundaryAskedBecause[] = ['area_sign']
const b = (asked_because: BoundaryAskedBecause[], answer: BoundaryAnswer) => ({ asked_because, answer })

describe('startsNewLimit', () => {
  it('a missing or malformed statement keeps the original limit', () => {
    expect(startsNewLimit(null)).toBe(false)
    expect(startsNewLimit(undefined)).toBe(false)
    expect(startsNewLimit({ asked_because: 'within_30m', answer: 'yellow_edge_line' } as never)).toBe(false)
  })

  it('not asked: a new limit, unless the driver said not sure', () => {
    expect(startsNewLimit(b([], 'not_asked'))).toBe(true)
    expect(startsNewLimit(b([], 'yellow_edge_line'))).toBe(true)
    expect(startsNewLimit(b([], 'not_sure'))).toBe(false)
  })

  it('stretch question: only the three r332 boundaries start a new limit', () => {
    for (const answer of STRETCH_BOUNDARY_ANSWERS) expect(startsNewLimit(b(NORMAL, answer)), answer).toBe(true)
    for (const answer of ['not_sure', 'not_asked', 'left_parking_area'] as BoundaryAnswer[]) {
      expect(startsNewLimit(b(NORMAL, answer)), answer).toBe(false)
    }
  })

  it('area question: only left_parking_area starts a new limit', () => {
    expect(startsNewLimit(b(AREA, 'left_parking_area'))).toBe(true)
    for (const answer of [...STRETCH_BOUNDARY_ANSWERS, 'not_sure', 'not_asked'] as BoundaryAnswer[]) {
      expect(startsNewLimit(b(AREA, answer)), answer).toBe(false)
      expect(startsNewLimit(b(['within_30m', 'same_street', 'area_sign'], answer)), answer).toBe(false)
    }
  })
})

// Melbourne, November (AEDT, UTC+11). Leg 0: 2P from 9:00, so 11:00.
const LEG0_EXPIRES = '2026-11-09T11:00:00+11:00'
const LEG0_EXPIRES_Z = '2026-11-09T00:00:00.000Z'
const prev0 = { expires_at: LEG0_EXPIRES, stretch_deadline: null }
const OWN_LATER = '2026-11-09T12:30:00+11:00' // the new sign's own 2P from 10:30
const OWN_EARLIER = '2026-11-09T10:45:00+11:00' // the new sign has a clearway from 10:45
const T_1030 = Date.parse('2026-11-09T10:30:00+11:00')

describe('legDeadline: the first leg', () => {
  it('runs on its own sign, with no stretch deadline', () => {
    expect(legDeadline({ previous: null, sign_until: OWN_LATER, boundary: null, now: T_1030 })).toEqual({
      starts_new_limit: true,
      stretch_deadline: null,
      expires_at: OWN_LATER,
      limited_by: 'sign',
      deadline_passed: false,
    })
  })
  it('a boundary statement on leg 0 changes nothing', () => {
    const r = legDeadline({ previous: null, sign_until: OWN_LATER, boundary: b(NORMAL, 'not_sure'), now: T_1030 })
    expect(r.starts_new_limit).toBe(true)
    expect(r.expires_at).toBe(OWN_LATER)
  })
  it('no limit on the sign gives no expiry', () => {
    const r = legDeadline({ previous: null, sign_until: null, boundary: null })
    expect(r).toMatchObject({ expires_at: null, limited_by: null, stretch_deadline: null })
  })
})

describe('legDeadline: answers that keep the original limit running', () => {
  const continuing: Array<[string, ReturnType<typeof b> | null]> = [
    ['not_sure', b(NORMAL, 'not_sure')],
    ['the question fired and was not answered (null)', null],
    ['not_asked after the question fired', b(NORMAL, 'not_asked')],
    ['left_parking_area on the stretch question', b(NORMAL, 'left_parking_area')],
    ['a stretch boundary in area mode', b(AREA, 'yellow_edge_line')],
    ['opposite_direction_sign in area mode', b(AREA, 'opposite_direction_sign')],
    ['t_intersection_or_dead_end in area mode', b(AREA, 't_intersection_or_dead_end')],
    ['not_sure in area mode', b(AREA, 'not_sure')],
    ['not_sure when the question did not fire', b([], 'not_sure')],
  ]
  for (const [label, boundary] of continuing) {
    it(`${label}: the previous leg's deadline carries over and caps the new leg`, () => {
      const r = legDeadline({ previous: prev0, sign_until: OWN_LATER, boundary, now: T_1030 })
      expect(r).toEqual({
        starts_new_limit: false,
        stretch_deadline: LEG0_EXPIRES_Z,
        expires_at: LEG0_EXPIRES_Z,
        limited_by: 'stretch',
        deadline_passed: false,
      })
    })
  }

  it('the new sign\'s own earlier time wins, and the stretch deadline is still kept', () => {
    const r = legDeadline({ previous: prev0, sign_until: OWN_EARLIER, boundary: b(NORMAL, 'not_sure'), now: T_1030 })
    expect(r).toEqual({
      starts_new_limit: false,
      stretch_deadline: LEG0_EXPIRES_Z,
      expires_at: OWN_EARLIER,
      limited_by: 'sign',
      deadline_passed: false,
    })
  })

  it('a tie goes to the stretch deadline', () => {
    const r = legDeadline({ previous: prev0, sign_until: LEG0_EXPIRES, boundary: b(NORMAL, 'not_sure'), now: T_1030 })
    expect(r).toMatchObject({ expires_at: LEG0_EXPIRES_Z, limited_by: 'stretch' })
  })

  it('a new sign with no limit still ends at the stretch deadline', () => {
    const r = legDeadline({ previous: prev0, sign_until: null, boundary: b(NORMAL, 'not_sure'), now: T_1030 })
    expect(r).toMatchObject({ expires_at: LEG0_EXPIRES_Z, limited_by: 'stretch', stretch_deadline: LEG0_EXPIRES_Z })
  })

  it('carries the deadline in force on the previous leg: its own earlier expiry beats its stretch deadline', () => {
    // Leg 1 continued leg 0's stretch (deadline 11:00) and its own sign had a 10:45 clearway,
    // so 10:45 was the deadline in force on leg 1. Unsure again: 10:45 still binds.
    const leg1 = { expires_at: OWN_EARLIER, stretch_deadline: LEG0_EXPIRES_Z }
    const r = legDeadline({ previous: leg1, sign_until: '2026-11-09T12:50:00+11:00', boundary: b(NORMAL, 'not_sure'), now: T_1030 })
    expect(r).toEqual({
      starts_new_limit: false,
      stretch_deadline: '2026-11-08T23:45:00.000Z',
      expires_at: '2026-11-08T23:45:00.000Z',
      limited_by: 'stretch',
      deadline_passed: false,
    })
  })

  it('carries the stretch deadline when it is the earlier of the two, or the only one readable', () => {
    const notSure = b(NORMAL, 'not_sure')
    const earlierStretch = { expires_at: OWN_LATER, stretch_deadline: LEG0_EXPIRES_Z }
    expect(legDeadline({ previous: earlierStretch, sign_until: OWN_LATER, boundary: notSure }).stretch_deadline).toBe(LEG0_EXPIRES_Z)
    const noExpiry = { expires_at: 'not a time', stretch_deadline: LEG0_EXPIRES_Z }
    expect(legDeadline({ previous: noExpiry, sign_until: OWN_LATER, boundary: notSure }).stretch_deadline).toBe(LEG0_EXPIRES_Z)
  })

  it('falls back to the previous expiry when its stretch deadline is unreadable', () => {
    const r = legDeadline({
      previous: { expires_at: LEG0_EXPIRES, stretch_deadline: 'not a time' },
      sign_until: OWN_LATER,
      boundary: b(NORMAL, 'not_sure'),
    })
    expect(r.stretch_deadline).toBe(LEG0_EXPIRES_Z)
  })

  it('when the previous leg had no limit there is nothing to carry, and no new limit is claimed', () => {
    const r = legDeadline({ previous: { expires_at: null, stretch_deadline: null }, sign_until: OWN_LATER, boundary: b(NORMAL, 'not_sure') })
    expect(r).toEqual({ starts_new_limit: false, stretch_deadline: null, expires_at: OWN_LATER, limited_by: 'sign', deadline_passed: false })
  })

  it('writes the stretch deadline in the signed time format (UTC, Z)', () => {
    const r = legDeadline({ previous: prev0, sign_until: OWN_LATER, boundary: b(NORMAL, 'not_sure') })
    expect(r.stretch_deadline).toMatch(ISO_TIME_RE)
  })
})

describe('legDeadline: answers that start the new leg\'s own limit', () => {
  const fresh: Array<[string, ReturnType<typeof b>]> = [
    ['opposite_direction_sign', b(NORMAL, 'opposite_direction_sign')],
    ['yellow_edge_line', b(NORMAL, 'yellow_edge_line')],
    ['t_intersection_or_dead_end', b(NORMAL, 't_intersection_or_dead_end')],
    ['left_parking_area in area mode', b(AREA, 'left_parking_area')],
    ['left_parking_area in area mode with other reasons', b(['within_30m', 'area_sign', 'location_unreliable'], 'left_parking_area')],
    ['not asked', b([], 'not_asked')],
  ]
  for (const [label, boundary] of fresh) {
    it(`${label}: the new sign's own limit, no stretch deadline`, () => {
      const r = legDeadline({ previous: prev0, sign_until: OWN_LATER, boundary, now: T_1030 })
      expect(r).toEqual({
        starts_new_limit: true,
        stretch_deadline: null,
        expires_at: OWN_LATER,
        limited_by: 'sign',
        deadline_passed: false,
      })
    })
  }

  it('a new limit is never reported as passed, even after the old deadline', () => {
    const r = legDeadline({ previous: prev0, sign_until: OWN_LATER, boundary: b(NORMAL, 'yellow_edge_line'), now: Date.parse(LEG0_EXPIRES) + 5 * MIN })
    expect(r.deadline_passed).toBe(false)
  })
})

describe('legDeadline: a deadline that has already passed', () => {
  const notSure = b(NORMAL, 'not_sure')
  it('is passed one minute after the deadline', () => {
    const r = legDeadline({ previous: prev0, sign_until: OWN_LATER, boundary: notSure, now: Date.parse(LEG0_EXPIRES) + MIN })
    expect(r.deadline_passed).toBe(true)
  })
  it('is passed at the deadline itself', () => {
    expect(legDeadline({ previous: prev0, sign_until: OWN_LATER, boundary: notSure, now: new Date(LEG0_EXPIRES) }).deadline_passed).toBe(true)
  })
  it('is not passed one minute before', () => {
    expect(legDeadline({ previous: prev0, sign_until: OWN_LATER, boundary: notSure, now: Date.parse(LEG0_EXPIRES) - MIN }).deadline_passed).toBe(false)
  })
})

describe('legDeadline across a day of legs', () => {
  it('chains: unsure twice keeps 11:00, a yellow line then starts 2P from the new park', () => {
    const leg1 = legDeadline({ previous: prev0, sign_until: OWN_LATER, boundary: b(NORMAL, 'not_sure') })
    const leg2 = legDeadline({
      previous: { expires_at: leg1.expires_at, stretch_deadline: leg1.stretch_deadline },
      sign_until: '2026-11-09T12:50:00+11:00',
      boundary: b(['same_street'], 'not_sure'),
    })
    expect(leg2.expires_at).toBe(LEG0_EXPIRES_Z)
    const leg3 = legDeadline({
      previous: { expires_at: leg2.expires_at, stretch_deadline: leg2.stretch_deadline },
      sign_until: '2026-11-09T12:55:00+11:00',
      boundary: b(['within_30m'], 'yellow_edge_line'),
    })
    expect(leg3).toMatchObject({ starts_new_limit: true, expires_at: '2026-11-09T12:55:00+11:00', stretch_deadline: null })
    // Unsure again after the yellow line: leg 3's own limit is the one running now.
    const leg4 = legDeadline({
      previous: { expires_at: leg3.expires_at, stretch_deadline: leg3.stretch_deadline },
      sign_until: '2026-11-09T14:30:00+11:00',
      boundary: b(['within_30m'], 'not_sure'),
    })
    expect(leg4.expires_at).toBe('2026-11-09T01:55:00.000Z')
  })

  it('2P, then 1P, then the same 1P a few bays along: the 1P limit from leg 1 still binds leg 2', () => {
    // Leg 0 at 9:00 under 2P (11:00). Leg 1 at 9:30 under a 1P sign, unsure: its own 1P ends 10:30.
    const leg1 = legDeadline({ previous: prev0, sign_until: '2026-11-09T10:30:00+11:00', boundary: b(NORMAL, 'not_sure') })
    expect(leg1).toMatchObject({ stretch_deadline: LEG0_EXPIRES_Z, expires_at: '2026-11-09T10:30:00+11:00', limited_by: 'sign' })
    // Leg 2 at 10:00, 10 m along under the same 1P sign: the check asks.
    const oneP = '1P 8am-6pm Mon-Fri'
    const check = sameStretchCheck(
      leg({ sign_text: oneP, road: 'Elgin Street' }),
      leg({ sign_text: '1P Mon-Fri 8:00 am to 6:00 pm', road: 'Elgin St' }),
      at(10),
    )
    expect(check.asked_because).toEqual(['within_30m', 'same_street', 'same_sign_text'])
    // Leg 2's own reading counts 1P from 10:00 (11:00). Unsure: continuous parking on
    // leg 1's 1P length since 9:30 ends at 10:30, so that is the deadline, not 11:00.
    const leg2 = legDeadline({
      previous: { expires_at: leg1.expires_at, stretch_deadline: leg1.stretch_deadline },
      sign_until: '2026-11-09T11:00:00+11:00',
      boundary: buildBoundaryStatement('leg-1', check, 'not_sure'),
      now: Date.parse('2026-11-09T10:00:00+11:00'),
    })
    expect(leg2).toEqual({
      starts_new_limit: false,
      stretch_deadline: '2026-11-08T23:30:00.000Z',
      expires_at: '2026-11-08T23:30:00.000Z',
      limited_by: 'stretch',
      deadline_passed: false,
    })
    // Its reminders aim at 10:30, not 11:00.
    const rs = workdayReminderSchedule({ deadline: leg2.expires_at, now: Date.parse('2026-11-09T10:00:00+11:00') })
    expect(rs.map((x) => x.deadline)).toEqual(['2026-11-08T23:30:00.000Z', '2026-11-08T23:30:00.000Z'])
  })
})

describe('stretchStartedAt', () => {
  const l = (arrived_at: string, boundary: ReturnType<typeof b> | null = null) => ({ arrived_at, boundary })
  it('is null for no legs, and leg 0\'s arrival for one', () => {
    expect(stretchStartedAt([])).toBeNull()
    expect(stretchStartedAt([l('09:00')])).toBe('09:00')
  })
  it('walks back over legs that kept the limit running', () => {
    expect(stretchStartedAt([l('09:00'), l('10:30', b(NORMAL, 'not_sure'))])).toBe('09:00')
    expect(stretchStartedAt([l('09:00'), l('10:30', b(NORMAL, 'not_sure')), l('10:50', null)])).toBe('09:00')
  })
  it('stops at the last leg that started a new limit', () => {
    const legs = [l('09:00'), l('10:30', b(NORMAL, 'yellow_edge_line')), l('12:00', b(NORMAL, 'not_sure')), l('12:20', b(AREA, 'not_sure'))]
    expect(stretchStartedAt(legs)).toBe('10:30')
    expect(stretchStartedAt([l('09:00'), l('10:30', b([], 'not_asked'))])).toBe('10:30')
  })
  it('a stretch boundary under an area sign does not start a stretch', () => {
    expect(stretchStartedAt([l('09:00'), l('10:30', b(AREA, 'yellow_edge_line'))])).toBe('09:00')
  })
  it('ignores a boundary on leg 0', () => {
    expect(stretchStartedAt([l('09:00', b(NORMAL, 'not_sure'))])).toBe('09:00')
  })
})

describe('workdayLegs and nextLegIndex', () => {
  const W = '11111111-2222-4333-8444-555555555555'
  const rec = (id: string, over: Partial<ParkingSession>): ParkingSession =>
    ({ id, arrived_at: '2026-11-09T09:00:00+11:00', location: null, sign_photo: null, car_photo: null, rules: '', observations: [], expires_at: null, confidence: 'high', ...over }) as ParkingSession

  it('lists a workday\'s legs in leg order, without other records or shared copies', () => {
    const sessions = [
      rec('c', { workday_id: W, leg_index: 2 }),
      rec('x', { workday_id: 'other', leg_index: 0 }),
      rec('a', { workday_id: W, leg_index: 0 }),
      rec('s', { workday_id: W, leg_index: 1, shared_from: { original_session_id: 'o', received_at: 'r', shared_at: null, arrival_bundle: null, snapshot: {} } }),
      rec('b', { workday_id: W, leg_index: 1 }),
      rec('n', { workday_id: W, leg_index: null }),
    ]
    expect(workdayLegs(sessions, W).map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(nextLegIndex(sessions, W)).toBe(3)
    expect(nextLegIndex(sessions, 'none')).toBe(0)
  })

  it('stops at the highest leg index the signed link accepts', () => {
    expect(MAX_LEG_INDEX).toBe(50)
    expect(nextLegIndex([rec('a', { workday_id: W, leg_index: 49 })], W)).toBe(50)
    expect(nextLegIndex([rec('a', { workday_id: W, leg_index: 50 })], W)).toBeNull()
  })
})

// ─── 5. Reminder schedule ──────────────────────────────────────────────────

const D = Date.parse(LEG0_EXPIRES)
const iso = (ms: number) => new Date(ms).toISOString()
const kinds = (rs: WorkdayReminder[]) => rs.map((r) => r.kind)

describe('workdayReminderSchedule', () => {
  it('pins the offsets the spec sets, and the lead the push route needs', () => {
    expect([HEADS_UP_BEFORE_MIN, SEARCH_AND_MARGIN_MIN, DEFAULT_WALK_MIN]).toEqual([45, 15, 10])
    // /push/schedule skips anything less than 30 s ahead; plan with room to spare.
    expect(MIN_SCHEDULE_LEAD_MS).toBeGreaterThan(30_000)
  })

  it('heads-up at deadline - 45, go-now at deadline - (10 + 15) when the walk is unknown, then the deadline', () => {
    const rs = workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - 3 * 60 * MIN, walk_minutes: null })
    expect(rs).toEqual([
      { kind: 'heads_up', fire_at: iso(D - 45 * MIN), deadline: LEG0_EXPIRES_Z },
      { kind: 'go_now', fire_at: iso(D - 25 * MIN), deadline: LEG0_EXPIRES_Z },
      { kind: 'at_deadline', fire_at: iso(D), deadline: LEG0_EXPIRES_Z },
    ])
    // Absolute instants, signable format.
    for (const r of rs) expect(r.fire_at).toMatch(ISO_TIME_RE)
  })

  const goAt = (walk: number | null | undefined) =>
    workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - 5 * 60 * MIN, walk_minutes: walk }).find((r) => r.kind === 'go_now')!.fire_at

  it('go-now uses the walk time from walk-back.ts, rounded up, with no upper cap', () => {
    expect(goAt(12)).toBe(iso(D - 27 * MIN))
    expect(goAt(12.01)).toBe(iso(D - 28 * MIN)) // part minutes round up
    // A long walk is never cut short: leaving later than walk + 15 would arrive late.
    expect(goAt(90)).toBe(iso(D - 105 * MIN))
    expect(goAt(240)).toBe(iso(D - 255 * MIN))
    expect([walkAllowanceMinutes(12.01), walkAllowanceMinutes(90), walkAllowanceMinutes(600)]).toEqual([13, 90, 600])
  })

  it('go-now never allows less than the 10-minute default walk', () => {
    // Saved at the car, walk-back.ts measures about 1 minute. That is not the
    // walk the driver will make, so go-now stays at the deadline - 25.
    for (const walk of [0, 1, 7, 9.5, 10, undefined, null, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(goAt(walk), String(walk)).toBe(iso(D - 25 * MIN))
    }
    expect([walkAllowanceMinutes(null), walkAllowanceMinutes(0), walkAllowanceMinutes(1)]).toEqual([10, 10, 10])
  })

  it('keeps the heads-up when a long walk puts it after go-now, and merges them only at the same instant', () => {
    const plan = (walk: number) =>
      workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - 5 * 60 * MIN, walk_minutes: walk }).map((r) => [r.kind, r.fire_at])
    expect(plan(29)).toEqual([
      ['heads_up', iso(D - 45 * MIN)],
      ['go_now', iso(D - 44 * MIN)],
      ['at_deadline', iso(D)],
    ])
    // 30 + 15 = 45: one push at that instant, the more urgent one.
    expect(plan(30)).toEqual([
      ['go_now', iso(D - 45 * MIN)],
      ['at_deadline', iso(D)],
    ])
    // A 45-minute walk: go-now at D - 60, then the heads-up as a second nudge.
    expect(plan(45)).toEqual([
      ['go_now', iso(D - 60 * MIN)],
      ['heads_up', iso(D - 45 * MIN)],
      ['at_deadline', iso(D)],
    ])
  })

  it('drops a heads-up that is already due, and plans nothing closer than the push route accepts', () => {
    expect(kinds(workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - 47 * MIN }))).toEqual(['heads_up', 'go_now', 'at_deadline'])
    // 45.5 minutes out, the heads-up would be less than a minute ahead.
    expect(kinds(workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - 45.5 * MIN }))).toEqual(['go_now', 'at_deadline'])
    expect(kinds(workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - 30 * MIN }))).toEqual(['go_now', 'at_deadline'])
    for (let now = D - 6 * 60 * MIN; now < D + 5 * MIN; now += 7_919) {
      for (const r of workdayReminderSchedule({ deadline: LEG0_EXPIRES, now, walk_minutes: 20 })) {
        expect(Date.parse(r.fire_at) - now).toBeGreaterThanOrEqual(MIN_SCHEDULE_LEAD_MS)
        expect(Date.parse(r.fire_at)).toBeLessThanOrEqual(D)
      }
    }
  })

  it('a go-now whose time has passed fires as soon as it can, while the deadline is still ahead', () => {
    // The driver moved bays at 10:40, said "not sure", and the stretch
    // deadline carried over is 11:00: 20 minutes, less than walk + 15.
    const now = D - 20 * MIN
    expect(workdayReminderSchedule({ deadline: LEG0_EXPIRES, now })).toEqual([
      { kind: 'go_now', fire_at: iso(now + MIN_SCHEDULE_LEAD_MS), deadline: LEG0_EXPIRES_Z },
      { kind: 'at_deadline', fire_at: iso(D), deadline: LEG0_EXPIRES_Z },
    ])
    expect(kinds(workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - 25 * MIN }))).toEqual(['go_now', 'at_deadline'])
    expect(kinds(workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - 2 * MIN }))).toEqual(['go_now', 'at_deadline'])
    // A long walk that is already overdue still gets its go-now first.
    const late = workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - 50 * MIN, walk_minutes: 60 })
    expect(late.map((r) => [r.kind, r.fire_at])).toEqual([
      ['go_now', iso(D - 50 * MIN + MIN_SCHEDULE_LEAD_MS)],
      ['heads_up', iso(D - 45 * MIN)],
      ['at_deadline', iso(D)],
    ])
  })

  it('within a minute of the deadline only the at-deadline line can still be planned, then nothing', () => {
    expect(kinds(workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - MIN }))).toEqual(['at_deadline'])
    expect(workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - 30_000 })).toEqual([])
    expect(workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - 1 })).toEqual([])
  })

  it('a deadline that has already passed gives no reminders', () => {
    expect(workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D })).toEqual([])
    expect(workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D + 10 * MIN })).toEqual([])
  })

  it('nothing to schedule without a readable deadline', () => {
    expect(workdayReminderSchedule({ deadline: null, now: 0 })).toEqual([])
    expect(workdayReminderSchedule({ deadline: 'soon', now: 0 })).toEqual([])
    expect(workdayReminderSchedule({ deadline: new Date(Number.NaN), now: 0 })).toEqual([])
  })

  it('takes a Date deadline', () => {
    expect(workdayReminderSchedule({ deadline: new Date(D), now: D - 60 * MIN })[0].fire_at).toBe(iso(D - 45 * MIN))
  })
})

describe('workdayReminderSchedule across the Melbourne daylight saving changes', () => {
  const TZ = 'Australia/Melbourne'
  const local = (ms: number) => formatExpiryAbsolute(new Date(ms), { timeZone: TZ, now: new Date(ms) }).time

  it('clocks forward (4 Oct 2026, 2:00 AEST becomes 3:00 AEDT): fires 45 and 25 real minutes before', () => {
    const deadline = '2026-10-04T03:10:00+11:00' // 3:10 am AEDT, 16:10Z on the 3rd
    const ms = Date.parse(deadline)
    const rs = workdayReminderSchedule({ deadline, now: ms - 5 * 60 * MIN })
    expect(rs.map((r) => r.fire_at)).toEqual(['2026-10-03T15:25:00.000Z', '2026-10-03T15:45:00.000Z', '2026-10-03T16:10:00.000Z'])
    // On the wall clock the heads-up is 1:25 am AEST, an hour and 45 minutes "before" 3:10 am AEDT.
    expect(local(Date.parse(rs[0].fire_at))).toMatch(/^1:25\s?am$/i)
    expect(local(Date.parse(rs[1].fire_at))).toMatch(/^1:45\s?am$/i)
    expect(local(ms)).toMatch(/^3:10\s?am$/i)
  })

  it('clocks back (4 Apr 2027, 3:00 AEDT becomes 2:00 AEST): the second 2:20 am gets its reminders in real time', () => {
    const deadline = '2027-04-04T02:20:00+10:00' // the second 2:20 am (AEST), 16:20Z on the 3rd
    const ms = Date.parse(deadline)
    const rs = workdayReminderSchedule({ deadline, now: ms - 5 * 60 * MIN })
    expect(rs.map((r) => r.fire_at)).toEqual(['2027-04-03T15:35:00.000Z', '2027-04-03T15:55:00.000Z', '2027-04-03T16:20:00.000Z'])
    // The heads-up reads 2:35 am (AEDT), later on the wall clock than the 2:20 am deadline it warns about.
    expect(local(Date.parse(rs[0].fire_at))).toMatch(/^2:35\s?am$/i)
    expect(local(ms)).toMatch(/^2:20\s?am$/i)
  })

  it('clocks back: the first 2:20 am is an hour earlier and gets its own reminders', () => {
    const rs = workdayReminderSchedule({ deadline: '2027-04-04T02:20:00+11:00', now: Date.parse('2027-04-03T10:00:00Z') })
    expect(rs.map((r) => r.fire_at)).toEqual(['2027-04-03T14:35:00.000Z', '2027-04-03T14:55:00.000Z', '2027-04-03T15:20:00.000Z'])
  })

  it('a deadline across the change from a leg parked before it is still counted in real minutes', () => {
    // Parked 1:00 am AEST, 2P: the deadline is 4:00 am AEDT (two real hours later).
    const parked = Date.parse('2026-10-04T01:00:00+10:00')
    const deadline = iso(parked + 120 * MIN)
    expect(local(Date.parse(deadline))).toMatch(/^4:00\s?am$/i)
    const rs = workdayReminderSchedule({ deadline, now: parked })
    expect(rs[0].fire_at).toBe(iso(parked + 75 * MIN))
    expect(local(Date.parse(rs[0].fire_at))).toMatch(/^3:15\s?am$/i)
  })
})

// ─── Reminder copy ─────────────────────────────────────────────────────────

const echo = ((key: string, opts?: Record<string, unknown>) => `${key}|${JSON.stringify(opts ?? {})}`) as unknown as TFunction

const RULE_FLAGS = {
  requires_ticket: false,
  payment_methods: null,
  requires_disabled_permit: false,
  is_permit_zone: false,
  permit_area: null,
}
const legAt = (
  where: { lat: number; lng: number },
  address: string | null = '12 Lygon St, Carlton VIC',
  over: Partial<ParkingSession> = {},
) =>
  ({ id: 'leg-1', location: { ...where, address }, rules: '2P Mon-Fri 8am-6pm', ...over }) as Pick<
    ParkingSession,
    'id' | 'location' | 'rules' | 'rule_flags' | 'boundary'
  >
const r = (kind: WorkdayReminder['kind'], fire_at: string, deadline = LEG0_EXPIRES_Z): WorkdayReminder => ({ kind, fire_at, deadline })
const areaFlags = (is_area_sign: boolean) => ({ rule_flags: { ...RULE_FLAGS, is_area_sign } })
const boundaryOf = (asked_because: BoundaryAskedBecause[], answer: BoundaryAnswer) => ({
  boundary: { previous_session_id: 'leg-0', asked_because, answer, distance_from_previous_m: 12 },
})

describe('legInAreaMode and stretchInAreaMode', () => {
  const leg = (over: Partial<ParkingSession> = {}): AreaModeLeg => ({ rules: '2P Mon-Fri 8am-6pm', ...over })

  it('a leg is in area mode when its own sign is an area sign', () => {
    expect(legInAreaMode(leg(areaFlags(true)))).toBe(true)
    expect(legInAreaMode(leg(areaFlags(false)))).toBe(false)
    // Before T3 the flag is unknown, and the sign text decides.
    expect(legInAreaMode(leg({ rules: '2P Parking Area' }))).toBe(true)
    expect(legInAreaMode(leg())).toBe(false)
  })

  it('a leg is in area mode when it kept an area limit running, and not when it left the area', () => {
    expect(legInAreaMode(leg({ ...areaFlags(false), ...boundaryOf(['area_sign'], 'not_sure') }))).toBe(true)
    expect(legInAreaMode(leg({ ...areaFlags(false), ...boundaryOf(['within_30m', 'area_sign'], 'yellow_edge_line') }))).toBe(true)
    expect(legInAreaMode(leg({ ...areaFlags(false), ...boundaryOf(['area_sign'], 'left_parking_area') }))).toBe(false)
    expect(legInAreaMode(leg({ ...areaFlags(false), ...boundaryOf(['within_30m'], 'not_sure') }))).toBe(false)
  })

  it('follows an area limit carried over more than one move', () => {
    const leg0 = leg(areaFlags(true))
    const leg1 = leg({ ...areaFlags(false), ...boundaryOf(['area_sign'], 'not_sure') })
    // Leg 2's check was in area mode (leg 1 carried the area limit), and
    // neither unsure nor a yellow edge line inside the area ends it.
    const leg2 = leg({ ...areaFlags(false), ...boundaryOf(['within_30m', 'area_sign'], 'not_sure') })
    const leg2Line = leg({ ...areaFlags(false), ...boundaryOf(['within_30m', 'area_sign'], 'yellow_edge_line') })
    expect(legInAreaMode(leg2)).toBe(true)
    expect(stretchInAreaMode([leg0, leg1, leg2])).toBe(true)
    expect(stretchInAreaMode([leg0, leg1, leg2Line])).toBe(true)
    // A statement without the area reason (a check that missed the carried
    // area limit) is still caught by walking back to the leg that has it.
    const leg2NoReason = leg({ ...areaFlags(false), ...boundaryOf(['within_30m'], 'not_sure') })
    expect(legInAreaMode(leg2NoReason)).toBe(false)
    expect(stretchInAreaMode([leg0, leg1, leg2NoReason])).toBe(true)
    // Leaving the area started a new limit, which ends the walk back.
    const leg1Left = leg({ ...areaFlags(false), ...boundaryOf(['area_sign'], 'left_parking_area') })
    expect(stretchInAreaMode([leg0, leg1Left, leg2NoReason])).toBe(false)
    expect(stretchInAreaMode([leg(areaFlags(false))])).toBe(false)
    expect(stretchInAreaMode([])).toBe(false)
  })
})

describe('sameStretchCheck: an area limit carried over a move', () => {
  // Leg 0 is under an area sign. Leg 1 moved to another street inside the
  // area, under a sign that isn't an area sign, and the driver wasn't sure
  // they had left the area, so the area limit kept running. The next park is
  // 400 m away on another road under another sign, with good fixes, so only
  // the area limit can make the check ask.
  const W = '11111111-2222-4333-8444-555555555555'
  const rec = (leg_index: number, over: Partial<ParkingSession>): ParkingSession =>
    ({
      id: `leg-${leg_index}`,
      workday_id: W,
      leg_index,
      arrived_at: '2026-11-09T09:00:00+11:00',
      location: { ...MELB, source: 'gps', accuracy_meters: 9, address: '1 Lygon St' },
      place: { road: 'Lygon Street', suburb: 'Carlton', state_code: 'AU-VIC' },
      sign_photo: null,
      car_photo: null,
      rules: '2P Mon-Fri 8am-6pm',
      observations: [],
      expires_at: null,
      confidence: 'high',
      ...over,
    }) as ParkingSession
  const leg0 = rec(0, { ...areaFlags(true), rules: '2P Parking Area', expires_at: LEG0_EXPIRES })
  const leg1 = rec(1, {
    ...areaFlags(false),
    rules: '1P Mon-Sat 7:30am-6:30pm',
    place: { road: 'Elgin Street', suburb: 'Carlton', state_code: 'AU-VIC' },
    ...boundaryOf(['area_sign'], 'not_sure'),
    expires_at: LEG0_EXPIRES_Z,
    stretch_deadline: LEG0_EXPIRES_Z,
  })
  const next = stretchLegFromReading({ rules: '3P Mon-Sun', until: null, is_area_sign: false }, gps(), { road: 'Faraday Street' })
  const OWN_3P = '2026-11-09T13:30:00+11:00'

  it('the move after leg 1 gets the area question, though neither sign is an area sign', () => {
    const check = sameStretchCheck(stretchLegFromRecord(leg1), next, at(400))
    expect(check).toMatchObject({ ask: true, area_mode: true, asked_because: ['area_sign'] })
    expect(boundaryOptions(check)).toEqual(['left_parking_area', 'not_sure'])
  })

  it('a yellow edge line inside the area does not start a new limit; leaving the area does', () => {
    const check = sameStretchCheck(stretchLegFromRecord(leg1), next, at(400))
    const line = buildBoundaryStatement(leg1.id, check, 'yellow_edge_line')
    expect(startsNewLimit(line)).toBe(false)
    expect(legDeadline({ previous: leg1, sign_until: OWN_3P, boundary: line, now: T_1030 })).toMatchObject({
      starts_new_limit: false,
      expires_at: LEG0_EXPIRES_Z,
      limited_by: 'stretch',
    })
    const left = buildBoundaryStatement(leg1.id, check, 'left_parking_area')
    expect(legDeadline({ previous: leg1, sign_until: OWN_3P, boundary: left, now: T_1030 })).toMatchObject({
      starts_new_limit: true,
      expires_at: OWN_3P,
      stretch_deadline: null,
    })
  })

  it('unsure again keeps area mode for the move after that', () => {
    const check = sameStretchCheck(stretchLegFromRecord(leg1), next, at(400))
    const leg2 = rec(2, {
      ...areaFlags(false),
      rules: '3P Mon-Sun',
      place: { road: 'Faraday Street', suburb: 'Carlton', state_code: 'AU-VIC' },
      boundary: buildBoundaryStatement(leg1.id, check, 'not_sure'),
    })
    expect(stretchLegFromRecord(leg2).area_limit).toBe(true)
    const leg3 = stretchLegFromReading({ rules: '4P', until: null, is_area_sign: false }, gps(), { road: 'Grattan Street' })
    expect(sameStretchCheck(stretchLegFromRecord(leg2), leg3, at(400)).area_mode).toBe(true)
  })

  it('previousStretchLeg carries the area limit over the whole workday, even where the last record cannot show it', () => {
    const leg2NoReason = rec(2, { ...areaFlags(false), rules: '3P Mon-Sun', ...boundaryOf(['within_30m'], 'not_sure') })
    expect(stretchLegFromRecord(leg2NoReason).area_limit).toBe(false)
    const prev = previousStretchLeg(workdayLegs([leg2NoReason, leg0, leg1], W))
    expect(prev).toMatchObject({ area_limit: true, road: 'Lygon Street', sign_text: '3P Mon-Sun' })
    expect(sameStretchCheck(prev!, next, at(400))).toMatchObject({ ask: true, area_mode: true })
    expect(previousStretchLeg([])).toBeNull()
  })

  it('a caller can add area mode but never take it away', () => {
    expect(stretchLegFromRecord(leg1, { area_limit: false }).area_limit).toBe(true)
    const plain = rec(1, { ...areaFlags(false), ...boundaryOf(['within_30m'], 'not_sure') })
    expect(stretchLegFromRecord(plain).area_limit).toBe(false)
    expect(stretchLegFromRecord(plain, { area_limit: true }).area_limit).toBe(true)
  })

  it('after the driver left the area, the next move is checked as a normal stretch again', () => {
    const leg1Left = rec(1, { ...areaFlags(false), rules: '1P Mon-Sat 7:30am-6:30pm', ...boundaryOf(['area_sign'], 'left_parking_area') })
    const prev = previousStretchLeg([leg0, leg1Left])
    expect(prev?.area_limit).toBe(false)
    expect(sameStretchCheck(prev!, next, at(400))).toMatchObject({ ask: false, area_mode: false, asked_because: [] })
  })
})

describe('workdayReminderCopy', () => {

  it('uses one key per kind, with the deadline (not the fire time) as {{time}}', () => {
    expect(WORKDAY_REMINDER_KEYS).toEqual({
      heads_up: 'workday.reminder.headsUp',
      go_now: 'workday.reminder.goNow',
      at_deadline: 'workday.reminder.ended',
    })
    const headsUp = workdayReminderCopy(r('heads_up', iso(D - 45 * MIN)), legAt(MELB), echo)
    expect(headsUp.title).toBe('12 Lygon St, Carlton VIC')
    expect(headsUp.body).toMatch(/^workday\.reminder\.headsUp\|\{"time":"11:00\s?am"\}$/i)
    expect(workdayReminderCopy(r('go_now', iso(D - 25 * MIN)), legAt(MELB), echo).body).toMatch(/^workday\.reminder\.goNow\|\{"time":"11:00\s?am"\}$/i)
    expect(workdayReminderCopy(r('at_deadline', iso(D)), legAt(MELB), echo).body).toMatch(/^workday\.reminder\.ended\|\{"time":"11:00\s?am"\}$/i)
  })

  it('names the time in the leg\'s own zone (Brisbane has no daylight saving)', () => {
    // 00:00Z is 11:00 am in Melbourne (AEDT) and 10:00 am in Brisbane (AEST).
    expect(workdayReminderCopy(r('at_deadline', iso(D)), legAt(BRIS), echo).body).toMatch(/"time":"10:00\s?am"/i)
  })

  it('adds the day when the deadline is on a different day from the reminder', () => {
    const deadline = '2026-11-09T13:20:00.000Z' // 12:20 am on Tue 10 Nov in Melbourne
    const body = workdayReminderCopy(r('heads_up', '2026-11-09T12:35:00.000Z', deadline), legAt(MELB), echo).body
    expect(body).toMatch(/"time":"12:20\s?am, Tue 10\/11\/2026"/i)
  })

  it('under an area sign, the heads-up and at-deadline lines say to leave the whole area', () => {
    expect(WORKDAY_AREA_REMINDER_KEYS).toEqual({
      heads_up: 'workday.reminder.headsUpArea',
      go_now: 'workday.reminder.goNow',
      at_deadline: 'workday.reminder.endedArea',
    })
    const bodies = (leg: ReturnType<typeof legAt>, options?: { area_mode?: boolean }) =>
      (['heads_up', 'go_now', 'at_deadline'] as const).map((k) => workdayReminderCopy(r(k, iso(D - 45 * MIN)), leg, echo, options).body.split('|')[0])
    const AREA_KEYS = ['workday.reminder.headsUpArea', 'workday.reminder.goNow', 'workday.reminder.endedArea']
    const STRETCH_KEYS = ['workday.reminder.headsUp', 'workday.reminder.goNow', 'workday.reminder.ended']
    expect(bodies(legAt(MELB, null, areaFlags(true)))).toEqual(AREA_KEYS)
    expect(bodies(legAt(MELB, null, { rules: '2P Parking Area' }))).toEqual(AREA_KEYS)
    expect(bodies(legAt(MELB, null, { ...areaFlags(false), ...boundaryOf(['area_sign'], 'not_sure') }))).toEqual(AREA_KEYS)
    expect(bodies(legAt(MELB, null, areaFlags(false)))).toEqual(STRETCH_KEYS)
    expect(bodies(legAt(MELB, null, { ...areaFlags(false), ...boundaryOf(['area_sign'], 'left_parking_area') }))).toEqual(STRETCH_KEYS)
    // The caller can add the area wording (a limit carried over several moves), never remove it.
    expect(bodies(legAt(MELB, null, areaFlags(false)), { area_mode: true })).toEqual(AREA_KEYS)
    expect(bodies(legAt(MELB, null, areaFlags(true)), { area_mode: false })).toEqual(AREA_KEYS)
    const pushes = workdayPushReminders(legAt(MELB, null, areaFlags(true)), [r('heads_up', iso(D - 45 * MIN))], echo)
    expect(pushes[0].body).toContain('workday.reminder.headsUpArea')
  })

  it('names the zone when a daylight saving change falls between the reminder and the deadline', () => {
    const body = (kind: WorkdayReminder['kind'], fire_at: string, deadline: string) =>
      workdayReminderCopy(r(kind, fire_at, deadline), legAt(MELB), echo).body.replace(/\u202f/g, ' ')
    // Clocks back, 4 Apr 2027: the deadline is the second 2:20 am (AEST).
    const second = '2027-04-03T16:20:00.000Z'
    expect(body('heads_up', '2027-04-03T15:35:00.000Z', second)).toMatch(/"time":"2:20 am AEST"/i)
    expect(body('go_now', '2027-04-03T15:55:00.000Z', second)).toMatch(/"time":"2:20 am AEST"/i)
    expect(body('at_deadline', second, second)).toMatch(/"time":"2:20 am"/i)
    // The first 2:20 am (AEDT): no change between, so no zone name.
    const first = '2027-04-03T15:20:00.000Z'
    expect(body('heads_up', '2027-04-03T14:35:00.000Z', first)).toMatch(/"time":"2:20 am"/i)
    // Clocks forward, 4 Oct 2026: a heads-up at 1:25 am AEST for 3:10 am AEDT.
    expect(body('heads_up', '2026-10-03T15:25:00.000Z', '2026-10-03T16:10:00.000Z')).toMatch(/"time":"3:10 am AEDT"/i)
    // Brisbane has no daylight saving, so never a zone name.
    const bris = workdayReminderCopy(r('heads_up', '2026-10-03T15:25:00.000Z', '2026-10-03T16:10:00.000Z'), legAt(BRIS), echo).body
    expect(bris).toMatch(/"time":"2:10\s?am"/i)
  })

  it('falls back to the generic title without an address', () => {
    expect(workdayReminderCopy(r('go_now', iso(D - 25 * MIN)), legAt(MELB, null), echo).title).toContain('reminders.pushTitleFallback')
  })

  it('reads as the copy rules want in English: absolute time, the stretch, no distance', async () => {
    const t = await i18next.createInstance().init({ lng: 'en', resources: { en: { translation: en } } })
    const rs = workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - 3 * 60 * MIN })
    const bodies = rs.map((x) => workdayReminderCopy(x, legAt(MELB), t).body.replace(/\u202f/g, ' '))
    expect(bodies).toEqual([
      'Your time limit on this stretch ends at 11:00 am. Move off this signed stretch, not just to another bay.',
      'Leave now to move the car before 11:00 am.',
      'Your time on this stretch ended at 11:00 am.',
    ])
    for (const body of bodies) {
      expect(body).not.toMatch(/\u2014|reset|restart|compliant|\bin \d+ min/i)
    }
    const areaBodies = rs.map((x) => workdayReminderCopy(x, legAt(MELB, '12 Lygon St', areaFlags(true)), t).body.replace(/\u202f/g, ' '))
    expect(areaBodies).toEqual([
      'Your time limit in this parking area ends at 11:00 am. Move the car out of the whole area, not just to another street inside it.',
      'Leave now to move the car before 11:00 am.',
      'Your time in this parking area ended at 11:00 am.',
    ])
    for (const body of areaBodies) {
      expect(body).not.toMatch(/\u2014|reset|restart|compliant|\bin \d+ min|stretch/i)
    }
  })

  it('builds /push/schedule entries that open the leg\'s record', () => {
    const rs = workdayReminderSchedule({ deadline: LEG0_EXPIRES, now: D - 3 * 60 * MIN })
    const pushes = workdayPushReminders(legAt(MELB), rs, echo)
    expect(pushes).toHaveLength(3)
    expect(pushes.map((p) => p.fire_at)).toEqual(rs.map((x) => x.fire_at))
    for (const p of pushes) {
      expect(p.url).toBe(sessionLink('leg-1'))
      expect(p.title).toBe('12 Lygon St, Carlton VIC')
    }
    expect(pushes[2].body).toContain('workday.reminder.ended')
  })
})
