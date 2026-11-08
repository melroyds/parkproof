// @vitest-environment happy-dom
//
// The sign reader's T3 fields on the phone (build spec T3 items 5 to 7):
// - the clarify merge carries the picked position's area flag and permit
//   exception, and keeps the whole sign's condition, notes and weekly
//   restrictions;
// - a re-check sends what the first reading saw and keeps it, whatever the
//   server answers, and a record saved before T3 still re-checks;
// - a new record keeps rule_flags (with is_area_sign), sign_status,
//   sign_issues and recurring_restrictions as additive fields, so records
//   saved before T3 still load, and a pre-T3 answer stores none of them
//   (never a "no" nobody determined); what is stored is what link 1 signs;
// - 'missing' and 'not_a_parking_sign' route to the "no readable sign"
//   screen, the two unclear statuses to the answer.
import { beforeEach, describe, expect, it } from 'vitest'
import type { ParkingRules, ParkingSession, PermitException, RecurringRestriction, RuleVariant } from '../types'
import { normalizeAddendumData } from '../../lambda/addendum-schema.js'
import { buildArrivalContext, emptyLogDraft } from './evidence-chain'
import { getSession, loadSessions, saveSession } from './storage'
import {
  applyRefreshOverride,
  hasNoReadableSign,
  hasWeeklyRestriction,
  isNoSignReadRecord,
  isUnclearSign,
  mergeChosenVariant,
  noSignReadingFields,
  noSignReadingOf,
  recurringRestrictionsOf,
  refreshPriorOf,
  signIssuesOf,
  signReadingFields,
  signReadingTelemetry,
  signStatusOf,
  viewForReading,
} from './sign-result'

const SWEEP: RecurringRestriction = {
  kind: 'street_cleaning',
  days: ['TU'],
  start: '07:00',
  end: '09:00',
  week_of_month: [],
  exceptions_text: 'PUBLIC HOLIDAYS EXCEPTED',
  label: 'Street cleaning Tue 7am-9am',
}

/** No permits listed: no entries. */
const NO_PERMITS: PermitException[] = []
/** A resident permit listed; the sign prints nothing for it. */
const RESIDENT_NONE: PermitException[] = [{ applies: false, permit_type: 'resident', text: '' }]
/** A resident permit listed; this position's sign excepts Area 12 permits. */
const RESIDENT_AREA_12: PermitException[] = [{ applies: true, permit_type: 'resident', text: 'AREA 12 PERMITS EXCEPTED' }]

function variant(label: string, overrides: Partial<RuleVariant> = {}): RuleVariant {
  return {
    label,
    rules: `2P ${label}`,
    observations: [{ scope: label, items: ['2P'] }],
    can_park_now: true,
    until: '2026-11-03T05:00:00+11:00',
    duration_minutes: 120,
    requires_disabled_permit: false,
    is_permit_zone: false,
    permit_area: null,
    next_transition: null,
    ...overrides,
  }
}

/** A T3 answer: every T3 field present, as normalizeModelOutput returns it. */
function answer(overrides: Partial<ParkingRules> = {}): ParkingRules {
  return {
    sign_status: 'readable',
    sign_issues: [],
    rules: '2P Mon-Fri 8am-6pm',
    observations: [{ scope: 'Whole sign', items: ['2P', 'Mon-Fri 8am-6pm'] }],
    can_park_now: true,
    until: '2026-11-03T05:00:00+11:00',
    duration_minutes: 120,
    confidence: 'high',
    requires_ticket: false,
    payment_methods: null,
    requires_disabled_permit: false,
    is_permit_zone: false,
    permit_area: null,
    is_area_sign: false,
    permit_exception: NO_PERMITS,
    recurring_restrictions: [],
    next_transition: null,
    clarification: null,
    ...overrides,
  }
}

/** An answer from a server older than T3: none of the T3 fields. */
function preT3Answer(overrides: Partial<ParkingRules> = {}): ParkingRules {
  return {
    rules: '2P',
    observations: [],
    can_park_now: true,
    until: null,
    duration_minutes: 120,
    confidence: 'high',
    clarification: null,
    requires_ticket: true,
    payment_methods: ['meter'],
    requires_disabled_permit: false,
    is_permit_zone: false,
    permit_area: null,
    ...overrides,
  }
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-t3',
    arrived_at: '2026-11-02T22:00:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm; 1P AREA',
    observations: [{ scope: 'Whole sign', items: ['2P'] }],
    expires_at: '2026-11-03T00:00:00.000Z',
    confidence: 'medium',
    chosen_label: 'Left side',
    ...overrides,
  }
}

beforeEach(() => localStorage.clear())

describe('routing an answer (T3 item 6)', () => {
  it("'missing' and 'not_a_parking_sign' go to the no-readable-sign screen, never an answer card", () => {
    expect(viewForReading(answer({ sign_status: 'missing', can_park_now: false }))).toBe('noReadableSign')
    expect(viewForReading(answer({ sign_status: 'not_a_parking_sign', can_park_now: false }))).toBe('noReadableSign')
  })

  it('partially_obscured and contradictory keep their answer (with clarify when it has positions)', () => {
    expect(viewForReading(answer({ sign_status: 'partially_obscured' }))).toBe('result')
    expect(viewForReading(answer({ sign_status: 'contradictory', can_park_now: false }))).toBe('result')
    const twoSides = { question: 'Where?', options: [variant('Left side'), variant('Right side')] }
    expect(viewForReading(answer({ sign_status: 'partially_obscured', clarification: twoSides }))).toBe('clarify')
    expect(isUnclearSign(answer({ sign_status: 'partially_obscured' }))).toBe(true)
    expect(isUnclearSign(answer({ sign_status: 'contradictory' }))).toBe(true)
    expect(isUnclearSign(answer({ sign_status: 'missing' }))).toBe(false)
    expect(isUnclearSign(answer())).toBe(false)
  })

  it('a pre-T3 answer, or an unknown status, routes as before (readable)', () => {
    expect(viewForReading(preT3Answer())).toBe('result')
    expect(signStatusOf(preT3Answer())).toBeNull()
    const odd = { ...answer(), sign_status: 'blurry' } as unknown as ParkingRules
    expect(signStatusOf(odd)).toBeNull()
    expect(hasNoReadableSign(odd)).toBe(false)
    expect(isUnclearSign(odd)).toBe(false)
  })
})

describe('mergeChosenVariant: the picked position (T3 item 5)', () => {
  const base = answer({
    sign_status: 'partially_obscured',
    sign_issues: ['Bottom plate faded'],
    is_area_sign: true,
    // The top level's entry applies only when it covers every position.
    permit_exception: RESIDENT_NONE,
    recurring_restrictions: [SWEEP],
    clarification: {
      question: 'Where are you parked?',
      options: [
        variant('Left side', {
          is_area_sign: true,
          permit_exception: RESIDENT_AREA_12,
          is_permit_zone: true,
          permit_area: '12',
        }),
        variant('Right side', { is_area_sign: false, permit_exception: RESIDENT_NONE, requires_disabled_permit: true }),
      ],
    },
  })

  it("carries the picked side's area flag and permit exception, not the whole sign's", () => {
    const right = mergeChosenVariant(base, base.clarification!.options[1])
    expect(right.is_area_sign).toBe(false)
    expect(right.permit_exception).toEqual(RESIDENT_NONE)
    expect(right.requires_disabled_permit).toBe(true)
    expect(right.is_permit_zone).toBe(false)

    const left = mergeChosenVariant(base, base.clarification!.options[0])
    expect(left.is_area_sign).toBe(true)
    expect(left.permit_exception).toEqual(RESIDENT_AREA_12)
    expect(left.is_permit_zone).toBe(true)
    expect(left.permit_area).toBe('12')
    expect(left.rules).toBe('2P Left side')
    expect(left.chosen_label).toBe('Left side')
    expect(left.clarification).toBeNull()
    expect(left.alternate_variants?.map((v) => v.label)).toEqual(['Right side'])
  })

  it("keeps the whole sign's condition, notes and weekly restrictions", () => {
    const merged = mergeChosenVariant(base, base.clarification!.options[1])
    expect(merged.sign_status).toBe('partially_obscured')
    expect(merged.sign_issues).toEqual(['Bottom plate faded'])
    expect(merged.recurring_restrictions).toEqual([SWEEP])
  })

  it('a variant from a pre-T3 server keeps the whole sign values for the T3 fields', () => {
    const old = variant('Bay 3') // no is_area_sign, no permit_exception
    const merged = mergeChosenVariant(
      answer({ is_area_sign: true, permit_exception: RESIDENT_NONE, clarification: { question: 'q', options: [old, variant('Bay 4')] } }),
      old,
    )
    expect(merged.is_area_sign).toBe(true)
    expect(merged.permit_exception).toEqual(RESIDENT_NONE)
  })

  it('the merged answer is what the record keeps', () => {
    const fields = signReadingFields(mergeChosenVariant(base, base.clarification!.options[1]))
    expect(fields.rule_flags).toEqual({
      requires_ticket: false,
      payment_methods: null,
      requires_disabled_permit: true,
      is_permit_zone: false,
      permit_area: null,
      is_area_sign: false,
    })
    expect(fields.sign_status).toBe('partially_obscured')
  })
})

describe('the re-check (refresh) path (T3 item 5)', () => {
  const saved = record({
    sign_status: 'contradictory',
    sign_issues: ['Right arrow plates disagree: 2P and No Parking'],
    rule_flags: {
      requires_ticket: false,
      payment_methods: null,
      requires_disabled_permit: false,
      is_permit_zone: false,
      permit_area: null,
      is_area_sign: true,
    },
    recurring_restrictions: [SWEEP],
  })

  it('sends what the first reading saw', () => {
    expect(refreshPriorOf(saved)).toEqual({
      rules: saved.rules,
      observations: saved.observations,
      chosen_label: 'Left side',
      sign_status: 'contradictory',
      sign_issues: ['Right arrow plates disagree: 2P and No Parking'],
      is_area_sign: true,
    })
  })

  it("keeps the record's sign condition, area flag and weekly restrictions whatever the server answers", () => {
    const fresh = answer({
      sign_status: 'readable',
      sign_issues: [],
      is_area_sign: false,
      recurring_restrictions: [],
      rules: 'model rewrote this',
      confidence: 'low',
      can_park_now: false,
      until: null,
    })
    const result = applyRefreshOverride(fresh, saved)
    expect(result.sign_status).toBe('contradictory')
    expect(result.sign_issues).toEqual(['Right arrow plates disagree: 2P and No Parking'])
    expect(result.is_area_sign).toBe(true)
    expect(result.recurring_restrictions).toEqual([SWEEP])
    // As before T3: the prior reading's text and position, the model's current-time answer.
    expect(result.rules).toBe(saved.rules)
    expect(result.chosen_label).toBe('Left side')
    expect(result.confidence).toBe('high')
    expect(result.can_park_now).toBe(false)
    // So the re-checked record keeps the unclear banner and the hint.
    expect(isUnclearSign(result)).toBe(true)
    expect(hasWeeklyRestriction(result)).toBe(true)
  })

  it("a record saved before T3 re-checks with nothing echoed, and the server's placeholder status is not kept", () => {
    const old = record()
    expect(refreshPriorOf(old)).toMatchObject({ sign_status: null, sign_issues: [], is_area_sign: null })
    // The server answers "readable" for an unrecorded status, but a
    // text-only re-check read no photo: nobody determined that.
    const result = applyRefreshOverride(
      answer({ sign_status: 'readable', sign_issues: [], is_area_sign: true, recurring_restrictions: [SWEEP] }),
      old,
    )
    for (const key of ['sign_status', 'sign_issues', 'is_area_sign', 'recurring_restrictions'] as const) {
      expect(result, key).not.toHaveProperty(key)
    }
    // The current-time answer still comes from the server, on the record's rules.
    expect(result.can_park_now).toBe(true)
    expect(result.rules).toBe(old.rules)
    expect(viewForReading(result)).toBe('result')
    // So a record logged from it keeps the pre-T3 shape, and its signed
    // arrival_context says nothing about the sign's condition.
    expect(signReadingFields(result)).toEqual({})
    const logged = record({ id: 'rec-recheck', ...signReadingFields(result) })
    const context = buildArrivalContext(logged, emptyLogDraft())
    expect(context.sign_status).toBeNull()
    expect(context.rule_flags).toBeNull()
    // A placeholder that says "missing" can't send the re-check to the no-sign screen either.
    expect(viewForReading(applyRefreshOverride(answer({ sign_status: 'missing' }), old))).toBe('result')
    // And a pre-T3 server answer on a pre-T3 record stays status-less.
    expect(applyRefreshOverride(preT3Answer(), old).sign_status).toBeUndefined()
  })
})

describe('what a new record keeps (T3 item 5)', () => {
  it('rule_flags with is_area_sign, the condition, notes and weekly restrictions', () => {
    const fields = signReadingFields(
      answer({
        sign_status: 'partially_obscured',
        sign_issues: ['Top of the sign cut off by the photo', ''],
        requires_ticket: true,
        payment_methods: ['meter', 'easypark'],
        is_permit_zone: true,
        permit_area: '25',
        is_area_sign: true,
        recurring_restrictions: [SWEEP],
      }),
    )
    expect(fields).toEqual({
      sign_status: 'partially_obscured',
      sign_issues: ['Top of the sign cut off by the photo'],
      recurring_restrictions: [SWEEP],
      rule_flags: {
        requires_ticket: true,
        payment_methods: ['meter', 'easypark'],
        requires_disabled_permit: false,
        is_permit_zone: true,
        permit_area: '25',
        is_area_sign: true,
      },
    })
  })

  it('a pre-T3 answer adds nothing: the record looks like one saved before T3', () => {
    expect(signReadingFields(preT3Answer())).toEqual({})
  })

  it('drops malformed weekly restrictions and notes on a readable sign', () => {
    const bad = [
      SWEEP,
      { ...SWEEP, days: ['XX'] },
      { ...SWEEP, start: '7am' },
      { ...SWEEP, kind: 'parade' },
      { ...SWEEP, week_of_month: [6] },
      'street cleaning',
    ]
    const fields = signReadingFields(answer({ sign_issues: ['ignored'], recurring_restrictions: bad as unknown as RecurringRestriction[] }))
    expect(fields.recurring_restrictions).toEqual([SWEEP])
    expect(fields.sign_issues).toEqual([])
  })

  it('a record with the new fields round-trips through storage; an old record still loads', () => {
    const fields = signReadingFields(answer({ sign_status: 'contradictory', sign_issues: ['Plates disagree'], is_area_sign: true, recurring_restrictions: [SWEEP] }))
    saveSession(record({ id: 'new-rec', ...fields }))
    saveSession(record({ id: 'old-rec' }))
    const stored = getSession('new-rec')!
    expect(stored.sign_status).toBe('contradictory')
    expect(stored.sign_issues).toEqual(['Plates disagree'])
    expect(stored.rule_flags?.is_area_sign).toBe(true)
    expect(stored.recurring_restrictions).toEqual([SWEEP])

    const old = loadSessions().find((s) => s.id === 'old-rec')!
    expect('sign_status' in old).toBe(false)
    expect(signStatusOf(old)).toBeNull()
    expect(signIssuesOf(old)).toEqual([])
    expect(recurringRestrictionsOf(old)).toEqual([])
    expect(isNoSignReadRecord(old)).toBe(false)
  })

  it('what the record keeps is what link 1 (arrival_context) signs, and it passes the schema', () => {
    const fields = signReadingFields(answer({ sign_status: 'partially_obscured', sign_issues: ['Faded'], is_area_sign: true, permit_area: '7', is_permit_zone: true }))
    const data = buildArrivalContext(record(fields), emptyLogDraft())
    expect(data.sign_status).toBe('partially_obscured')
    expect(data.sign_issues).toEqual(['Faded'])
    expect(data.rule_flags).toEqual(fields.rule_flags)
    expect(normalizeAddendumData('arrival_context', data)).toEqual(data)
    // An old record signs nulls, as before.
    const old = buildArrivalContext(record(), emptyLogDraft())
    expect(old.sign_status).toBeNull()
    expect(old.rule_flags).toBeNull()
  })
})

describe('the no-sign record from the "no readable sign" screen (T3 item 6)', () => {
  it('keeps the status ParkProof found and its notes', () => {
    const reading = noSignReadingOf(answer({ sign_status: 'not_a_parking_sign', sign_issues: ['Photo shows a speed limit sign'], can_park_now: false }))
    expect(reading).toEqual({ sign_status: 'not_a_parking_sign', sign_issues: ['Photo shows a speed limit sign'] })
    const saved = record({ no_sign: true, rules: '', expires_at: null, ...noSignReadingFields(reading) })
    expect(isNoSignReadRecord(saved)).toBe(true)
    // The ordinary no-sign path keeps nothing extra, and isn't a "no sign read" record.
    expect(noSignReadingFields(null)).toEqual({})
    expect(isNoSignReadRecord(record({ no_sign: true }))).toBe(false)
    // A readable answer has no no-sign reading.
    expect(noSignReadingOf(answer())).toBeNull()
  })
})

describe('feedback telemetry (T3 item 5)', () => {
  it('counts only, and nothing about permits', () => {
    const t = signReadingTelemetry(
      answer({
        sign_status: 'partially_obscured',
        sign_issues: ['Faded', 'Cut off'],
        is_area_sign: true,
        recurring_restrictions: [SWEEP],
        permit_exception: [{ applies: true, permit_type: 'accessible', text: 'EXCEPT DISABLED' }],
      }),
    )
    expect(t).toEqual({ sign_status: 'partially_obscured', sign_issues_count: 2, is_area_sign: true, recurring_restrictions_count: 1 })
    expect(JSON.stringify(t)).not.toMatch(/accessible|Faded/)
    expect(signReadingTelemetry(preT3Answer())).toEqual({})
  })
})
