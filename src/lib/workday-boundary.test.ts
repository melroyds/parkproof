// The boundary question's decisions for a workday stop (build spec T6b
// item 8), on top of T6a's maths. Each test pins a fail-safe rule: when the
// app can't tell whether the car left the signed stretch it asks, an answer
// is required before the stop is saved, and only an answer that names a
// boundary starts the stop's own limit.
import { describe, expect, it } from 'vitest'
import type { BoundaryStatement, ParkingSession, RuleFlags } from '../types'
import {
  answerStartsNewLimit,
  offeredAnswer,
  stopBoundaryCheck,
  stopBoundaryStatement,
  stopContext,
  stopDeadlinePassed,
  stopLimitFields,
  stopOutcome,
  withoutStopLimit,
} from './workday-boundary'

const W = '0f0e0d0c-1111-4111-8111-111111111111'
const T0 = Date.parse('2026-11-09T00:00:00.000Z') // 11:00 am in Melbourne (AEDT)
const iso = (ms: number) => new Date(ms).toISOString()
const MIN = 60_000

const FLAGS = (is_area_sign: boolean): RuleFlags => ({
  requires_ticket: false,
  payment_methods: null,
  requires_disabled_permit: false,
  is_permit_zone: false,
  permit_area: null,
  is_area_sign,
})

function leg(id: string, index: number, overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id,
    arrived_at: iso(T0 + index * 60 * MIN),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P 8am-6pm Mon-Fri',
    observations: [],
    expires_at: iso(T0 + index * 60 * MIN + 120 * MIN),
    confidence: 'high',
    rule_flags: FLAGS(false),
    place: { road: 'King St', suburb: 'Melbourne', state_code: 'AU-VIC' },
    workday_id: W,
    leg_index: index,
    ...overrides,
  }
}

/** A reading for the stop being logged. */
const reading = (overrides: { rules?: string; until?: string | null; is_area_sign?: boolean } = {}) => ({
  rules: overrides.rules ?? '1P 8am-6pm Mon-Fri',
  until: overrides.until === undefined ? iso(T0 + 200 * MIN) : overrides.until,
  is_area_sign: overrides.is_area_sign ?? false,
  sign_status: 'readable' as const,
})

// About 10 m north of the first leg, and about 1 km away.
const NEAR = { lat: -37.81351, lng: 144.9631, source: 'gps' as const, accuracy_meters: 6 }
const FAR = { lat: -37.8046, lng: 144.9631, source: 'gps' as const, accuracy_meters: 6 }

describe('stopContext', () => {
  it('the first stop has nothing to compare with', () => {
    const ctx = stopContext([], W)
    expect(ctx).toEqual({ legs: [], previous: null })
    expect(stopBoundaryCheck(ctx, reading(), NEAR, { road: 'King St' })).toBeNull()
    expect(stopBoundaryStatement(ctx, null, null)).toBeNull()
  })

  it('compares with the last saved leg, in leg order, and only this workday', () => {
    const a = leg('a', 0)
    const b = leg('b', 1)
    const other = leg('x', 5, { workday_id: '0f0e0d0c-2222-4222-8222-222222222222' })
    const ctx = stopContext([b, other, a], W)
    expect(ctx.legs.map((l) => l.id)).toEqual(['a', 'b'])
    expect(ctx.previous?.id).toBe('b')
  })
})

describe('when the question asks', () => {
  const ctx = stopContext([leg('a', 0)], W)

  it('asks when the GPS fix is not in (an unreliable location), whatever else', () => {
    const check = stopBoundaryCheck(ctx, reading(), null, null)!
    expect(check.ask).toBe(true)
    expect(check.asked_because).toContain('location_unreliable')
    expect(check.distance_from_previous_m).toBeNull()
  })

  it('asks a few metres along the same road, with the reasons that are true', () => {
    const check = stopBoundaryCheck(ctx, reading(), NEAR, { road: 'King Street' })!
    expect(check.ask).toBe(true)
    expect(check.asked_because).toEqual(['within_30m', 'same_street'])
    expect(check.area_mode).toBe(false)
  })

  it("doesn't ask a kilometre away on another road with another sign", () => {
    const check = stopBoundaryCheck(ctx, reading(), FAR, { road: 'Lygon St' })!
    expect(check.ask).toBe(false)
    expect(stopBoundaryStatement(ctx, check, null)).toEqual({
      previous_session_id: 'a',
      asked_because: [],
      answer: 'not_asked',
      distance_from_previous_m: check.distance_from_previous_m,
    })
  })

  it('always asks the area question under an area sign, even far away', () => {
    const area = stopContext([leg('a', 0, { rules: '2P Parking Area', rule_flags: FLAGS(true) })], W)
    const check = stopBoundaryCheck(area, reading(), FAR, { road: 'Lygon St' })!
    expect(check.ask).toBe(true)
    expect(check.area_mode).toBe(true)
  })
})

describe('the answer, as the driver gave it', () => {
  const ctx = stopContext([leg('a', 0)], W)
  const check = stopBoundaryCheck(ctx, reading(), NEAR, { road: 'King St' })!

  it('blocks Save until an offered answer is given', () => {
    expect(stopBoundaryStatement(ctx, check, null)).toBe('unanswered')
    // The area answer isn't on the stretch question: still unanswered.
    expect(offeredAnswer(check, 'left_parking_area')).toBeNull()
    expect(stopBoundaryStatement(ctx, check, 'left_parking_area')).toBe('unanswered')
  })

  it('records the answer and why it was asked, as the driver statement', () => {
    expect(stopBoundaryStatement(ctx, check, 'yellow_edge_line')).toEqual({
      previous_session_id: 'a',
      asked_because: ['within_30m', 'same_street'],
      answer: 'yellow_edge_line',
      distance_from_previous_m: check.distance_from_previous_m,
    })
  })
})

describe('the limit a stop gets', () => {
  const first = leg('a', 0) // arrived T0, 2P until T0 + 120 min
  const ctx = stopContext([first], W)
  const check = stopBoundaryCheck(ctx, reading(), NEAR, { road: 'King St' })!
  const answered = (a: BoundaryStatement['answer']) => stopBoundaryStatement(ctx, check, a) as BoundaryStatement

  it('"I\'m not sure" keeps the first limit running, from the first arrival', () => {
    const notSure = answered('not_sure')
    const out = stopOutcome(ctx, notSure, iso(T0 + 200 * MIN), T0 + 70 * MIN)
    expect(out.deadline.starts_new_limit).toBe(false)
    expect(out.deadline.stretch_deadline).toBe(first.expires_at)
    // The new sign's own limit is later, so the stretch's ends it.
    expect(out.deadline.expires_at).toBe(first.expires_at)
    expect(out.stretch_start).toBe(first.arrived_at)
    expect(answerStartsNewLimit(notSure)).toBe(false)
    expect(stopLimitFields({ expires_at: iso(T0 + 200 * MIN), boundary: notSure }, ctx)).toEqual({
      boundary: notSure,
      stretch_deadline: first.expires_at,
      expires_at: first.expires_at,
    })
  })

  it(`"I'm not sure" under a new sign that ends first: the time to move by is the sign's, the one the stop is saved with`, () => {
    const notSure = answered('not_sure')
    // The stretch's limit ends at T0 + 120 min; the new sign's own at T0 + 90 min.
    const out = stopOutcome(ctx, notSure, iso(T0 + 90 * MIN), T0 + 70 * MIN)
    expect(out.deadline.stretch_deadline).toBe(first.expires_at)
    expect(out.deadline.limited_by).toBe('sign')
    expect(out.move_by).toBe(iso(T0 + 90 * MIN))
    expect(out.move_by).toBe(stopLimitFields({ expires_at: iso(T0 + 90 * MIN), boundary: notSure }, ctx).expires_at)
    expect(out.move_by_passed).toBe(false)
    // Past the sign's time but before the stretch's: the time is already up.
    const later = stopOutcome(ctx, notSure, iso(T0 + 90 * MIN), T0 + 95 * MIN)
    expect(later.deadline.deadline_passed).toBe(false)
    expect(later.move_by_passed).toBe(true)
    expect(stopDeadlinePassed('not_sure', false, later)).toBe(true)
  })

  it('a named boundary has no time to move by on this stretch', () => {
    const out = stopOutcome(ctx, answered('yellow_edge_line'), iso(T0 + 90 * MIN), T0 + 70 * MIN)
    expect(out.move_by).toBeNull()
    expect(out.move_by_passed).toBe(false)
  })

  it('a named boundary starts the stop own limit', () => {
    const passed = answered('t_intersection_or_dead_end')
    const out = stopOutcome(ctx, passed, iso(T0 + 200 * MIN), T0 + 70 * MIN)
    expect(out.deadline.starts_new_limit).toBe(true)
    expect(out.stretch_start).toBeNull()
    expect(answerStartsNewLimit(passed)).toBe(true)
    expect(stopLimitFields({ expires_at: iso(T0 + 200 * MIN), boundary: passed }, ctx)).toEqual({
      boundary: passed,
      stretch_deadline: null,
      expires_at: iso(T0 + 200 * MIN),
    })
  })

  it('a stop the question did not ask about runs on its own sign, with no "new limit" line', () => {
    const far = stopBoundaryCheck(ctx, reading(), FAR, { road: 'Lygon St' })!
    const notAsked = stopBoundaryStatement(ctx, far, null) as BoundaryStatement
    expect(answerStartsNewLimit(notAsked)).toBe(false)
    expect(stopLimitFields({ expires_at: iso(T0 + 200 * MIN), boundary: notAsked }, ctx).expires_at).toBe(iso(T0 + 200 * MIN))
  })

  it('a later stop with no statement keeps the running limit (fail safe)', () => {
    expect(stopLimitFields({ expires_at: iso(T0 + 200 * MIN), boundary: undefined }, ctx)).toEqual({
      boundary: null,
      stretch_deadline: first.expires_at,
      expires_at: first.expires_at,
    })
  })

  it('the first stop runs on its own sign and carries no statement', () => {
    expect(stopLimitFields({ expires_at: iso(T0 + 200 * MIN), boundary: answered('not_sure') }, stopContext([], W))).toEqual({
      boundary: null,
      stretch_deadline: null,
      expires_at: iso(T0 + 200 * MIN),
    })
  })

  it('under an area sign, only leaving the area starts a new limit', () => {
    const areaCtx = stopContext([leg('a', 0, { rules: '2P Parking Area', rule_flags: FLAGS(true) })], W)
    const areaCheck = stopBoundaryCheck(areaCtx, reading(), FAR, { road: 'Lygon St' })!
    const left = stopBoundaryStatement(areaCtx, areaCheck, 'left_parking_area') as BoundaryStatement
    const unsure = stopBoundaryStatement(areaCtx, areaCheck, 'not_sure') as BoundaryStatement
    expect(stopOutcome(areaCtx, left, iso(T0 + 200 * MIN), T0).deadline.starts_new_limit).toBe(true)
    expect(stopOutcome(areaCtx, unsure, iso(T0 + 200 * MIN), T0).deadline.starts_new_limit).toBe(false)
    // A stretch answer can't be given to the area question.
    expect(stopBoundaryStatement(areaCtx, areaCheck, 'yellow_edge_line')).toBe('unanswered')
  })

  it('the time on the stretch has ended: only an answer that keeps it running offers Save anyway', () => {
    const late = T0 + 121 * MIN
    const notSure = answered('not_sure')
    const outNotSure = stopOutcome(ctx, notSure, iso(T0 + 200 * MIN), late)
    expect(outNotSure.deadline.deadline_passed).toBe(true)
    expect(stopDeadlinePassed('not_sure', false, outNotSure)).toBe(true)
    const line = answered('yellow_edge_line')
    const outLine = stopOutcome(ctx, line, iso(T0 + 200 * MIN), late)
    expect(stopDeadlinePassed('yellow_edge_line', true, outLine)).toBe(false)
    // One minute before the end it hasn't passed.
    expect(stopDeadlinePassed('not_sure', false, stopOutcome(ctx, notSure, iso(T0 + 200 * MIN), T0 + 119 * MIN))).toBe(false)
  })

  it('"still runs from" names the arrival of the stop that started the running limit', () => {
    // Leg b continued a's limit (not sure); the new stop continues it again.
    const b = leg('b', 1, {
      boundary: { previous_session_id: 'a', asked_because: ['within_30m'], answer: 'not_sure', distance_from_previous_m: 9 },
      stretch_deadline: first.expires_at,
      expires_at: first.expires_at,
    })
    const ctx2 = stopContext([first, b], W)
    const check2 = stopBoundaryCheck(ctx2, reading(), NEAR, { road: 'King St' })!
    const notSure = stopBoundaryStatement(ctx2, check2, 'not_sure') as BoundaryStatement
    const out = stopOutcome(ctx2, notSure, iso(T0 + 300 * MIN), T0 + 100 * MIN)
    expect(out.stretch_start).toBe(first.arrived_at)
    expect(out.deadline.stretch_deadline).toBe(first.expires_at)
  })
})

describe('withoutStopLimit', () => {
  it('a record that is not a stop after all keeps its own sign and no statement', () => {
    const r = leg('n', 2, {
      boundary: { previous_session_id: 'a', asked_because: [], answer: 'not_asked', distance_from_previous_m: null },
      stretch_deadline: iso(T0),
    })
    const plain = withoutStopLimit(r)
    expect('boundary' in plain).toBe(false)
    expect('stretch_deadline' in plain).toBe(false)
    expect(plain.expires_at).toBe(r.expires_at)
    const untouched = leg('m', 0)
    expect(withoutStopLimit(untouched)).toBe(untouched)
  })
})
