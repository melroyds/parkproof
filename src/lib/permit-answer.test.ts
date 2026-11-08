// The driver's saved permits as data (build spec T4 items 4 to 6): the
// deterministic area match, which saved permit a park may use and where its
// question sits, when "may allow more time under {{state}} rules" shows, the
// later permit time typed in from the sign, the permit context saved on the
// record, the draft the result screen hands on, and the reminders on a
// record whose permit allows a later time.
import { describe, expect, it } from 'vitest'
import {
  areaKey,
  buildPermitContext,
  exceptionFor,
  isPermitSalt,
  isStandardLimitReminder,
  laterPermitTime,
  MAX_PUSH_REMINDERS,
  matchPermitArea,
  nextWallClockTime,
  permitAdjustedUntil,
  permitAnswerFor,
  permitsForSign,
  printedExceptions,
  reminderAnchor,
  reminderFireTimes,
  showsMayAllowMore,
  withResultAnswers,
  zoneAreaCheck,
  type PermitAnswer,
} from './permit-answer'
import { applyLogDraftDefaults, emptyLogDraft } from './evidence-chain'
import type { ParkingRules, ParkingSession, PermitContext, PermitException, SavedPermit } from '../types'

const permit = (over: Partial<SavedPermit> = {}): SavedPermit => ({
  id: 'p-res',
  type: 'resident',
  state: 'VIC',
  area: 'Area 25',
  expires_on: null,
  ...over,
})
const ACCESSIBLE = permit({ id: 'p-acc', type: 'accessible', area: null })
const RESIDENT = permit()

const exception = (type: PermitException['permit_type'], applies: boolean, text = ''): PermitException => ({
  applies,
  permit_type: type,
  text,
})

function answer(over: Partial<ParkingRules> = {}): ParkingRules {
  return {
    sign_status: 'readable',
    sign_issues: [],
    rules: '2P',
    observations: [],
    can_park_now: true,
    until: '2026-11-09T05:00:00+11:00',
    duration_minutes: 120,
    confidence: 'high',
    requires_ticket: false,
    payment_methods: null,
    requires_disabled_permit: false,
    is_permit_zone: false,
    permit_area: null,
    is_area_sign: false,
    permit_exception: [],
    recurring_restrictions: [],
    next_transition: null,
    clarification: null,
    ...over,
  }
}

describe('the area match', () => {
  it('reads the identifier out of an area label', () => {
    expect(areaKey('Area 25')).toBe('25')
    expect(areaKey('PERMIT AREA 25')).toBe('25')
    expect(areaKey('25')).toBe('25')
    expect(areaKey('area25')).toBe('25')
    expect(areaKey('Area 025')).toBe('25')
    expect(areaKey('Zone 2A')).toBe('2A')
    expect(areaKey('Permit zone no. 7')).toBe('7')
    // "NO" is only a label word on its own: North stays North.
    expect(areaKey('Area North')).toBe('NORTH')
  })

  it('has nothing to compare for an empty or label-only area', () => {
    expect(areaKey('Area')).toBeNull()
    expect(areaKey('  ')).toBeNull()
    expect(areaKey(null)).toBeNull()
    expect(areaKey(25)).toBeNull()
  })

  it('matches "Area 25" with the sign\'s "25", and tells other areas apart', () => {
    expect(matchPermitArea('Area 25', '25')).toBe('match')
    expect(matchPermitArea('area 25', 'AREA 25')).toBe('match')
    expect(matchPermitArea('Area 12', '25')).toBe('mismatch')
    expect(matchPermitArea('Area 2', '25')).toBe('mismatch')
    expect(matchPermitArea('Area 25', null)).toBeNull()
    expect(matchPermitArea(null, '25')).toBeNull()
  })
})

describe('which saved permit a park may use', () => {
  it('reads only exceptions that apply, for the right type', () => {
    const result = answer({
      permit_exception: [exception('resident', false), exception('accessible', true, 'DISABLED 4P')],
    })
    expect(exceptionFor(result, 'resident')).toBeNull()
    expect(exceptionFor(result, 'accessible')?.text).toBe('DISABLED 4P')
    expect(exceptionFor(answer({ permit_exception: undefined }), 'accessible')).toBeNull()
  })

  it('puts the accessible permit question in the accessible-permit gate', () => {
    const got = permitAnswerFor(answer({ requires_disabled_permit: true }), [RESIDENT, ACCESSIBLE])
    expect(got).toMatchObject({ permit: { id: 'p-acc' }, gate: 'accessible', exception: null, areaMatch: null })
  })

  it('asks in the permit card when the sign prints an exception but no gate shows', () => {
    const text = '[accessible parking symbol] 4P'
    const got = permitAnswerFor(answer({ permit_exception: [exception('accessible', true, text)] }), [ACCESSIBLE])
    expect(got?.gate).toBeNull()
    expect(got?.exception?.text).toBe(text)
  })

  it('uses a resident permit in a permit zone, with the area compared', () => {
    const got = permitAnswerFor(answer({ is_permit_zone: true, permit_area: '25', until: null }), [ACCESSIBLE, RESIDENT])
    expect(got).toMatchObject({ permit: { id: 'p-res' }, gate: 'permit_zone', areaMatch: 'match' })
  })

  it('prefers the permit whose area matches the sign, then saved order', () => {
    const other = permit({ id: 'p-12', area: 'Area 12' })
    const business = permit({ id: 'p-biz', type: 'business', area: 'Zone 25' })
    const zone = answer({ is_permit_zone: true, permit_area: '25' })
    expect(permitAnswerFor(zone, [other, business])?.permit.id).toBe('p-biz')
    const noArea = permit({ id: 'p-none', type: 'business', area: null })
    expect(permitAnswerFor(zone, [noArea, other])).toMatchObject({ permit: { id: 'p-none' }, areaMatch: null })
  })

  it('never uses a permit the code has found is for another area', () => {
    const other = permit({ id: 'p-12', area: 'Area 12' })
    // In a permit zone: the gate keeps its own tick box.
    expect(permitAnswerFor(answer({ is_permit_zone: true, permit_area: '25' }), [other])).toBeNull()
    // Nor through an exception the sign prints for its type.
    const printed = answer({ permit_area: '25', permit_exception: [exception('resident', true, 'PERMIT HOLDERS EXCEPTED AREA 25')] })
    expect(permitAnswerFor(printed, [other])).toBeNull()
    expect(permitsForSign(printed, [other, ACCESSIBLE])).toEqual([ACCESSIBLE])
    // Without an area on the sign there is nothing to tell it apart.
    expect(permitAnswerFor(answer({ is_permit_zone: true }), [other])?.permit.id).toBe('p-12')
  })

  it('has no permit question when the gate is not showing and the sign prints nothing', () => {
    // A permit zone whose answer is "can't park now" shows no gate.
    expect(permitAnswerFor(answer({ is_permit_zone: true, can_park_now: false }), [RESIDENT])).toBeNull()
    expect(permitAnswerFor(answer(), [RESIDENT, ACCESSIBLE])).toBeNull()
    expect(permitAnswerFor(answer({ requires_disabled_permit: true }), [])).toBeNull()
    // An accessible bay is no use to a resident permit.
    expect(permitAnswerFor(answer({ requires_disabled_permit: true }), [RESIDENT])).toBeNull()
  })
})

describe('what the result screen shows about the other saved permits', () => {
  it('quotes every printed exception for a saved permit type, whichever permit the park uses', () => {
    const result = answer({
      requires_disabled_permit: true,
      permit_exception: [exception('resident', true, 'PERMIT HOLDERS EXCEPTED AREA 5'), exception('accessible', false)],
    })
    const resident5 = permit({ area: 'Area 5' })
    // The accessible gate takes the accessible permit...
    expect(permitAnswerFor(result, [ACCESSIBLE, resident5])?.permit.type).toBe('accessible')
    // ...and the resident exception still shows.
    expect(printedExceptions(result, [ACCESSIBLE, resident5])).toEqual([
      { type: 'resident', exception: exception('resident', true, 'PERMIT HOLDERS EXCEPTED AREA 5') },
    ])
  })

  it('quotes each type once, and none for a permit for another area or a type not saved', () => {
    const result = answer({
      permit_area: '5',
      permit_exception: [exception('resident', true, 'RESIDENTS AREA 5'), exception('business', true, 'BUSINESS AREA 5')],
    })
    expect(printedExceptions(result, [permit({ area: 'Area 5' }), permit({ id: 'p-2', area: '5' })])).toHaveLength(1)
    expect(printedExceptions(result, [permit({ area: 'Area 12' })])).toEqual([])
    expect(printedExceptions(result, [ACCESSIBLE])).toEqual([])
  })

  it('compares the zone with the saved resident and business permits, whatever the accessible gate uses', () => {
    const zone = answer({ is_permit_zone: true, permit_area: '25', requires_disabled_permit: true })
    const twelve = permit({ id: 'p-12', area: 'Area 12' })
    expect(zoneAreaCheck(zone, [ACCESSIBLE, twelve, RESIDENT])).toEqual({ permit: RESIDENT, match: 'match' })
    expect(zoneAreaCheck(zone, [ACCESSIBLE, twelve])).toEqual({ permit: twelve, match: 'mismatch' })
    expect(zoneAreaCheck(zone, [ACCESSIBLE, permit({ area: null })])).toBeNull()
    expect(zoneAreaCheck(answer({ is_permit_zone: true }), [RESIDENT])).toBeNull()
  })
})

describe('"Your permit may allow more time under {{state}} rules"', () => {
  it('shows for a permit holder on a time limit that prints nothing for their permit', () => {
    expect(showsMayAllowMore(answer(), [RESIDENT])).toBe(true)
  })

  it("doesn't show when the sign prints an exception, there is no permit, or no time limit", () => {
    expect(showsMayAllowMore(answer({ permit_exception: [exception('resident', true, 'PERMIT HOLDERS EXCEPTED')] }), [RESIDENT])).toBe(false)
    expect(showsMayAllowMore(answer(), [])).toBe(false)
    expect(showsMayAllowMore(answer({ until: null }), [RESIDENT])).toBe(false)
    expect(showsMayAllowMore(answer({ can_park_now: false }), [RESIDENT])).toBe(false)
  })

  it("doesn't show for a permit the code has found is for another area", () => {
    const zone25 = answer({ permit_area: '25' })
    expect(showsMayAllowMore(zone25, [permit({ area: 'Area 12' })])).toBe(false)
    expect(showsMayAllowMore(zone25, [permit({ area: 'Area 12' }), ACCESSIBLE])).toBe(true)
    // A printed exception for the other area's permit type doesn't hide it for the accessible permit.
    const printed = answer({ permit_area: '25', permit_exception: [exception('resident', true, 'AREA 25 EXCEPTED')] })
    expect(showsMayAllowMore(printed, [permit({ area: 'Area 12' }), ACCESSIBLE])).toBe(true)
  })
})

describe('the permit time typed in from the sign', () => {
  const MELBOURNE = 'Australia/Melbourne'

  it('is the next time the spot\'s clock reads it', () => {
    // 14:00 AEDT on 9 November.
    const now = new Date('2026-11-09T03:00:00Z')
    expect(nextWallClockTime('18:00', MELBOURNE, now)?.toISOString()).toBe('2026-11-09T07:00:00.000Z')
    // 10:00 has passed today, so tomorrow.
    expect(nextWallClockTime('10:00', MELBOURNE, now)?.toISOString()).toBe('2026-11-09T23:00:00.000Z')
    // Brisbane has no daylight saving: 12:00 AEST is 02:00Z.
    expect(nextWallClockTime('12:00', 'Australia/Brisbane', new Date('2026-11-09T00:00:00Z'))?.toISOString()).toBe(
      '2026-11-09T02:00:00.000Z',
    )
  })

  it('reads the clock across a daylight saving change', () => {
    // Midnight AEST on 4 October 2026; at 2:00 the clocks go to 3:00 AEDT.
    const now = new Date('2026-10-03T14:00:00Z')
    expect(nextWallClockTime('09:00', MELBOURNE, now)?.toISOString()).toBe('2026-10-03T22:00:00.000Z')
    // 2:30 doesn't exist that night: it comes out as 3:30 AEDT.
    expect(nextWallClockTime('02:30', MELBOURNE, now)?.toISOString()).toBe('2026-10-03T16:30:00.000Z')
  })

  it('takes the first still to come of the two times the clock reads in the hour repeated when daylight saving ends', () => {
    // 4 April 2027 in Melbourne: at 3:00 AEDT (16:00Z) the clocks go back to
    // 2:00 AEST, so 2:00 to 2:59 happens twice: 15:xxZ (AEDT), then 16:xxZ (AEST).
    // 8 pm AEDT the evening before: the first 2:30 is next.
    expect(nextWallClockTime('02:30', MELBOURNE, new Date('2027-04-03T09:00:00Z'))?.toISOString()).toBe(
      '2027-04-03T15:30:00.000Z',
    )
    // 2:40 AEDT, the first pass: 2:50 is ten minutes away, not an hour and ten.
    expect(nextWallClockTime('02:50', MELBOURNE, new Date('2027-04-03T15:40:00Z'))?.toISOString()).toBe(
      '2027-04-03T15:50:00.000Z',
    )
    // 2:45 AEDT: the first 2:30 has gone, the second (AEST) is still to come.
    expect(nextWallClockTime('02:30', MELBOURNE, new Date('2027-04-03T15:45:00Z'))?.toISOString()).toBe(
      '2027-04-03T16:30:00.000Z',
    )
    // 2:40 AEST, the second pass: 2:50 is the AEST one.
    expect(nextWallClockTime('02:50', MELBOURNE, new Date('2027-04-03T16:40:00Z'))?.toISOString()).toBe(
      '2027-04-03T16:50:00.000Z',
    )
    // Outside the repeated hour nothing changes that day.
    expect(nextWallClockTime('09:00', MELBOURNE, new Date('2027-04-03T09:00:00Z'))?.toISOString()).toBe(
      '2027-04-03T23:00:00.000Z',
    )
  })

  it('takes only a real 24-hour time', () => {
    const now = new Date('2026-11-09T03:00:00Z')
    expect(nextWallClockTime('25:00', MELBOURNE, now)).toBeNull()
    expect(nextWallClockTime('7:00', MELBOURNE, now)).toBeNull()
    expect(nextWallClockTime('', MELBOURNE, now)).toBeNull()
  })

  it('counts only when it is later than the standard limit', () => {
    const now = new Date('2026-11-09T03:00:00Z') // 14:00 AEDT
    const standard = '2026-11-09T16:00:00+11:00' // 16:00 AEDT
    expect(laterPermitTime('18:00', standard, MELBOURNE, now)?.toISOString()).toBe('2026-11-09T07:00:00.000Z')
    expect(laterPermitTime('15:00', standard, MELBOURNE, now)).toBeNull()
    expect(laterPermitTime('16:00', standard, MELBOURNE, now)).toBeNull()
    expect(laterPermitTime('18:00', null, MELBOURNE, now)).toBeNull()
  })
})

describe('the permit context saved on the record', () => {
  const STANDARD = '2026-11-09T16:00:00+11:00'
  const LATER = new Date('2026-11-09T07:00:00Z')
  const accessibleWithException: PermitAnswer = {
    permit: ACCESSIBLE,
    exception: exception('accessible', true, 'DISABLED 4P'),
    gate: null,
    areaMatch: null,
  }

  it('is null unless the driver said yes', () => {
    expect(buildPermitContext(accessibleWithException, { until: STANDARD }, null, LATER)).toBeNull()
    expect(buildPermitContext(accessibleWithException, { until: STANDARD }, 'no', LATER)).toBeNull()
  })

  it('records an accessible permit with the holder present and no area', () => {
    expect(buildPermitContext(accessibleWithException, { until: STANDARD }, 'yes', LATER)).toEqual({
      type: 'accessible',
      area: null,
      holder_present: true,
      sign_exception_applies: true,
      standard_until: '2026-11-09T05:00:00.000Z',
      permit_until: '2026-11-09T07:00:00.000Z',
      note: null,
    })
  })

  it('records a resident permit with its area and holder_present null', () => {
    const zone: PermitAnswer = { permit: RESIDENT, exception: null, gate: 'permit_zone', areaMatch: 'match' }
    expect(buildPermitContext(zone, { until: null }, 'yes', null)).toEqual({
      type: 'resident',
      area: 'Area 25',
      holder_present: null,
      sign_exception_applies: false,
      standard_until: null,
      permit_until: null,
      note: null,
    })
  })

  it('keeps a later permit time only when the sign prints an exception and it is later', () => {
    const noException: PermitAnswer = { ...accessibleWithException, exception: null, gate: 'accessible' }
    expect(buildPermitContext(noException, { until: STANDARD }, 'yes', LATER)?.permit_until).toBeNull()
    const earlier = new Date('2026-11-09T04:00:00Z')
    expect(buildPermitContext(accessibleWithException, { until: STANDARD }, 'yes', earlier)?.permit_until).toBeNull()
  })
})

describe('the draft the result screen hands to the logger', () => {
  const context: PermitContext = {
    type: 'resident',
    area: 'Area 25',
    holder_present: null,
    sign_exception_applies: false,
    standard_until: null,
    permit_until: null,
    note: null,
  }

  it('takes the gate answers and the permit context', () => {
    const draft = emptyLogDraft()
    const next = withResultAnswers(draft, {
      gate_acks: { meter_ticket: true, permit_zone: true, accessible_permit: null },
      permit_context: context,
    })
    expect(next).not.toBe(draft)
    expect(next.gate_acks).toEqual({ meter_ticket: true, permit_zone: true, accessible_permit: null })
    expect(next.permit_context).toEqual(context)
    expect(draft.permit_context).toBeNull()
  })

  it('leaves the draft alone for anything else, such as a click event', () => {
    const draft = emptyLogDraft()
    expect(withResultAnswers(draft, { type: 'click', target: {} })).toBe(draft)
    expect(withResultAnswers(draft, undefined)).toBe(draft)
    // A malformed permit is never taken.
    expect(withResultAnswers(draft, { permit_context: { ...context, type: 'disabled' } })).toBe(draft)
    expect(withResultAnswers(draft, { gate_acks: { meter_ticket: 'yes' } })).toBe(draft)
  })

  it('reaches the record: gate answers and permit context, never over what the record says itself', () => {
    const draft = withResultAnswers(emptyLogDraft(), {
      gate_acks: { meter_ticket: null, permit_zone: true, accessible_permit: null },
      permit_context: context,
    })
    const logged = { id: 'r', rules: '2P' } as ParkingSession
    const out = applyLogDraftDefaults(logged, draft)
    expect(out.gate_acks).toEqual({ meter_ticket: null, permit_zone: true, accessible_permit: null })
    expect(out.permit_context).toEqual(context)
    expect(logged.permit_context).toBeUndefined()

    const own = applyLogDraftDefaults({ ...logged, permit_context: null, gate_acks: draft.gate_acks }, draft)
    expect(own.permit_context).toBeNull()
    // Nothing asked: no gate answers on the record.
    expect('gate_acks' in applyLogDraftDefaults(logged, emptyLogDraft())).toBe(false)
  })
})

describe('reminders on a record whose permit allows a later time', () => {
  const STANDARD = '2026-11-09T05:00:00.000Z'
  const PERMIT = '2026-11-09T07:00:00.000Z'
  const record = (pc: Partial<PermitContext> | null, expires_at: string | null = STANDARD) =>
    ({
      expires_at,
      permit_context:
        pc === null
          ? null
          : {
              type: 'accessible',
              area: null,
              holder_present: true,
              sign_exception_applies: true,
              standard_until: STANDARD,
              permit_until: PERMIT,
              note: null,
              ...pc,
            },
    }) as ParkingSession

  it('count down to the permit time, with the standard limit as its own reminder', () => {
    const s = record({})
    expect(permitAdjustedUntil(s)).toBe(PERMIT)
    expect(reminderAnchor(s)).toBe(PERMIT)
    expect(isStandardLimitReminder(s, new Date(STANDARD))).toBe(true)
    expect(isStandardLimitReminder(s, new Date('2026-11-09T06:45:00Z'))).toBe(false)
  })

  it('stay on the expiry otherwise', () => {
    for (const s of [
      record(null),
      record({ sign_exception_applies: false }),
      record({ holder_present: false }),
      record({ permit_until: null }),
      record({ permit_until: '2026-11-09T04:00:00.000Z' }),
    ]) {
      expect(permitAdjustedUntil(s)).toBeNull()
      expect(reminderAnchor(s)).toBe(STANDARD)
      expect(isStandardLimitReminder(s, new Date(STANDARD))).toBe(false)
    }
    expect(reminderAnchor(record(null, null))).toBeNull()
  })

  it('set one reminder per moment, with the standard-limit reminder among them', () => {
    const s = record({})
    const now = Date.parse('2026-11-09T03:00:00Z')
    const at = (iso: string) => new Date(iso)
    const times = reminderFireTimes(s, [at('2026-11-09T06:30:00Z'), at('2026-11-09T06:55:00Z')], now).map((d) =>
      d.toISOString(),
    )
    expect(times).toEqual([STANDARD, '2026-11-09T06:30:00.000Z', '2026-11-09T06:55:00.000Z'])
    // A picked time at the standard limit (or 20 s off it) is covered by the standard-limit reminder.
    expect(reminderFireTimes(s, [at(STANDARD), at('2026-11-09T05:00:20Z')], now).map((d) => d.toISOString())).toEqual([
      STANDARD,
    ])
    // Two picks at the same moment are one reminder.
    expect(reminderFireTimes(s, [at('2026-11-09T06:30:00Z'), at('2026-11-09T06:30:00Z')], now)).toHaveLength(2)
  })

  it('leave the standard-limit reminder out once it is too close or past, and on other records', () => {
    const pick = [new Date('2026-11-09T06:30:00Z')]
    expect(reminderFireTimes(record({}), pick, Date.parse(STANDARD) - 10_000)).toHaveLength(1)
    expect(reminderFireTimes(record({}), pick, Date.parse(STANDARD) + 60_000)).toHaveLength(1)
    expect(reminderFireTimes(record(null), pick, Date.parse('2026-11-09T03:00:00Z'))).toHaveLength(1)
  })

  it('keep to the push limit: six picks with the standard-limit reminder would be seven', () => {
    const permitMs = Date.parse(PERMIT)
    const six = [30, 15, 10, 5, 2, 0].map((m) => new Date(permitMs - m * 60_000))
    expect(MAX_PUSH_REMINDERS).toBe(6)
    expect(reminderFireTimes(record({}), six, Date.parse('2026-11-09T03:00:00Z'))).toHaveLength(7)
    expect(reminderFireTimes(record({}), six.slice(0, 5), Date.parse('2026-11-09T03:00:00Z'))).toHaveLength(6)
  })
})

it('a permit salt is 64 lowercase hex characters', () => {
  expect(isPermitSalt('a'.repeat(64))).toBe(true)
  expect(isPermitSalt('A'.repeat(64))).toBe(false)
  expect(isPermitSalt('a'.repeat(63))).toBe(false)
  expect(isPermitSalt(null)).toBe(false)
})
