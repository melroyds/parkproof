// @vitest-environment node
//
// Jurisdiction (build spec T6a item 2): decided per record from the raw
// ISO3166-2-lvl4 value only, with no fallback that can produce VIC or QLD.
// Workday mode is available only in VIC and QLD, where the rule 205 text was
// read. A fallback that guessed "VIC" from a time zone, a state name or an
// address would switch it on in a state nobody has checked.

import { describe, expect, it } from 'vitest'
import type { ParkingSession } from '../types'
import {
  WORKDAY_JURISDICTIONS,
  isWorkdayJurisdiction,
  jurisdictionFromStateCode,
  jurisdictionOfPlace,
  jurisdictionOfRecord,
} from './jurisdiction'

describe('jurisdictionFromStateCode', () => {
  it('maps the eight Australian ISO 3166-2 codes', () => {
    const codes = ['AU-VIC', 'AU-QLD', 'AU-NSW', 'AU-ACT', 'AU-SA', 'AU-WA', 'AU-TAS', 'AU-NT']
    expect(codes.map(jurisdictionFromStateCode)).toEqual(['VIC', 'QLD', 'NSW', 'ACT', 'SA', 'WA', 'TAS', 'NT'])
  })

  it('anything else is null: no guessing from names, short codes, case or other countries', () => {
    const others: unknown[] = [
      null,
      undefined,
      '',
      'VIC',
      'QLD',
      'Victoria',
      'Queensland',
      'au-vic',
      ' AU-VIC',
      'AU-VIC ',
      'AU-QLD-1',
      'AU-JBT',
      'NZ-AUK',
      'US-VA',
      'Australia/Melbourne',
      'AU-',
      'toString',
      '__proto__',
      42,
      { code: 'AU-VIC' },
    ]
    for (const v of others) expect(jurisdictionFromStateCode(v), String(v)).toBeNull()
  })
})

describe('jurisdiction of a place or record', () => {
  it('reads the place\'s state code and nothing else', () => {
    expect(jurisdictionOfPlace({ road: 'Lygon Street', suburb: 'Carlton', state_code: 'AU-VIC' })).toBe('VIC')
    expect(jurisdictionOfPlace({ road: 'Queen Street', suburb: 'Brisbane City', state_code: 'AU-QLD' })).toBe('QLD')
    expect(jurisdictionOfPlace({ road: 'Queen Street', suburb: 'Brisbane City', state_code: null })).toBeNull()
    expect(jurisdictionOfPlace(null)).toBeNull()
    expect(jurisdictionOfPlace(undefined)).toBeNull()
  })

  it('ignores a record\'s stored jurisdiction, its address and its coordinates', () => {
    const melbourneButUnknown = {
      place: { road: 'Swanston Street', suburb: 'Melbourne', state_code: null },
      jurisdiction: 'VIC',
      location: { lat: -37.81, lng: 144.96, address: '1 Swanston St, Melbourne VIC' },
    } as unknown as ParkingSession
    expect(jurisdictionOfRecord(melbourneButUnknown)).toBeNull()
    expect(jurisdictionOfRecord({ jurisdiction: 'QLD' } as unknown as ParkingSession)).toBeNull()
    expect(jurisdictionOfRecord({ place: { road: null, suburb: null, state_code: 'AU-NSW' } } as ParkingSession)).toBe('NSW')
  })
})

describe('where workday mode is available', () => {
  it('is Victoria and Queensland only', () => {
    expect(WORKDAY_JURISDICTIONS).toEqual(['VIC', 'QLD'])
    expect(isWorkdayJurisdiction('VIC')).toBe(true)
    expect(isWorkdayJurisdiction('QLD')).toBe(true)
    for (const j of ['NSW', 'ACT', 'SA', 'WA', 'TAS', 'NT', null, undefined] as const) {
      expect(isWorkdayJurisdiction(j), String(j)).toBe(false)
    }
  })
})
