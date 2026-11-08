// @vitest-environment node
//
// The seam between T3 (the sign reader's answer and what a record keeps of
// it) and T6a (workday mode's same-stretch check). Workday mode reads the
// area flag from T3's real fields: `is_area_sign` on the answer for the leg
// being logged, and `rule_flags.is_area_sign` on a saved leg. If either
// stopped reaching the check, an area sign would read as an ordinary
// length of road and a move inside the area would restart the limit.

import { describe, expect, it } from 'vitest'
import type { ParkingRules, ParkingSession, RuleVariant } from '../types'
import { mergeChosenVariant, signReadingFields } from './sign-result'
import { stretchLegFromReading, stretchLegFromRecord, type WorkdaySignReading } from './workday'

const gps = { lat: -37.8, lng: 144.97, source: 'gps' as const, accuracy_meters: 8 }

function answer(over: Partial<ParkingRules> = {}): ParkingRules {
  return {
    sign_status: 'readable',
    sign_issues: [],
    rules: '1P Ticket Area 8am-6pm',
    observations: [{ scope: 'Whole sign', items: ['1P', 'Ticket Area'] }],
    can_park_now: true,
    until: '2026-11-09T11:00:00+11:00',
    duration_minutes: 60,
    confidence: 'high',
    requires_ticket: true,
    payment_methods: ['meter'],
    requires_disabled_permit: false,
    is_permit_zone: false,
    permit_area: null,
    is_area_sign: true,
    permit_exception: [],
    recurring_restrictions: [],
    next_transition: null,
    clarification: null,
    ...over,
  }
}

/** A record logged from an answer, as SessionLogger saves one. */
function recordFrom(result: ParkingRules): Pick<ParkingSession, 'location' | 'place' | 'rules' | 'rule_flags' | 'boundary'> {
  return {
    location: gps,
    place: { road: 'Grattan Street', suburb: 'Carlton', state_code: 'AU-VIC' },
    rules: result.rules,
    ...signReadingFields(result),
  }
}

describe('workday mode reads T3 area flags', () => {
  it('takes a T3 answer as the reading for the leg being logged', () => {
    const reading: WorkdaySignReading = answer()
    expect(stretchLegFromReading(reading, gps, { road: 'Grattan Street' }).is_area_sign).toBe(true)
    expect(stretchLegFromReading(answer({ is_area_sign: false }), gps, null).is_area_sign).toBe(false)
  })

  it('uses the picked position on a clarify sign, not the whole sign', () => {
    const left: RuleVariant = {
      label: 'Left side',
      rules: '2P 8am-6pm',
      observations: [],
      can_park_now: true,
      until: '2026-11-09T12:00:00+11:00',
      duration_minutes: 120,
      is_area_sign: false,
    }
    const merged = mergeChosenVariant(answer({ clarification: { question: 'Where are you parked?', options: [left] } }), left)
    expect(stretchLegFromReading(merged, gps, null).is_area_sign).toBe(false)
  })

  it('reads a saved leg from rule_flags, as T3 keeps it', () => {
    const area = stretchLegFromRecord(recordFrom(answer()))
    expect(area.is_area_sign).toBe(true)
    expect(area.area_limit).toBe(true)
    const road = stretchLegFromRecord(recordFrom(answer({ rules: '2P 8am-6pm', is_area_sign: false })))
    expect(road.is_area_sign).toBe(false)
    expect(road.area_limit).toBe(false)
  })

  it('an answer from a server older than T3 leaves the flag unknown, so the sign text decides', () => {
    const old = answer({ sign_status: undefined, is_area_sign: undefined })
    expect(stretchLegFromReading(old, gps, null).is_area_sign).toBeNull()
    const saved = recordFrom(old)
    expect(saved.rule_flags).toBeUndefined()
    const leg = stretchLegFromRecord(saved)
    expect(leg.is_area_sign).toBeNull()
    // "1P Ticket Area" names an area: the fail-safe reading asks the area question.
    expect(leg.area_limit).toBe(true)
  })
})
