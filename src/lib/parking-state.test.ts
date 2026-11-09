// parking_state from the scan's coordinates (build spec T4 item 3): a
// state only where both the core-region box and the time zone agree, and
// null near every border, in the ACT, offshore and overseas. A wrong state
// would steer the sign reader towards another state's sign styles, so the
// border cases matter more than the cities.
import { describe, expect, it } from 'vitest'
import tzlookup from 'tz-lookup'
import { coreRegionState, parkingStateForCoords, parkingStateForRecord, statesForZone } from './parking-state'
import type { Jurisdiction } from '../types'

type Place = [name: string, lat: number, lng: number]

const CITIES: Array<[Jurisdiction, Place[]]> = [
  [
    'VIC',
    [
      ['Melbourne CBD', -37.8136, 144.9631],
      ['St Kilda', -37.8676, 144.9809],
      ['Geelong', -38.1499, 144.3617],
      ['Ballarat', -37.5622, 143.8503],
      ['Bendigo', -36.757, 144.2794],
      ['Warrnambool', -38.3818, 142.4823],
      ['Traralgon', -38.1953, 146.5415],
    ],
  ],
  [
    'NSW',
    [
      ['Sydney CBD', -33.8688, 151.2093],
      ['Parramatta', -33.815, 151.0011],
      ['Wollongong', -34.4278, 150.8931],
      ['Newcastle', -32.9283, 151.7817],
      ['Dubbo', -32.2569, 148.6011],
      ['Wagga Wagga', -35.1082, 147.3598],
      ['Broken Hill', -31.9505, 141.4533],
      ['Batemans Bay', -35.7082, 150.1744],
    ],
  ],
  [
    'QLD',
    [
      ['Brisbane CBD', -27.4698, 153.0251],
      ['Toowoomba', -27.5598, 151.9507],
      ['Cairns', -16.9186, 145.7781],
      ['Townsville', -19.259, 146.8169],
      ['Mount Isa', -20.7256, 139.4927],
    ],
  ],
  [
    'SA',
    [
      ['Adelaide', -34.9285, 138.6007],
      ['Port Augusta', -32.4936, 137.7653],
    ],
  ],
  [
    'WA',
    [
      ['Perth', -31.9505, 115.8605],
      ['Broome', -17.9614, 122.2359],
      ['Albany', -35.0269, 117.8837],
    ],
  ],
  [
    'NT',
    [
      ['Darwin', -12.4634, 130.8456],
      ['Alice Springs', -23.698, 133.8807],
    ],
  ],
  [
    'TAS',
    [
      ['Hobart', -42.8821, 147.3272],
      ['Launceston', -41.4332, 147.1441],
      ['King Island (Currie)', -39.9306, 143.8518],
    ],
  ],
]

describe('parkingStateForCoords: places well inside a state', () => {
  for (const [state, places] of CITIES) {
    for (const [name, lat, lng] of places) {
      it(`${name} is ${state}`, () => {
        expect(parkingStateForCoords({ lat, lng })).toBe(state)
      })
    }
  }
})

// Each of these is within reach of another state or territory, or in a
// place where tz-lookup is known to name the wrong side's zone. A state for
// any of them would be a guess.
const AMBIGUOUS: Place[] = [
  ['Canberra (ACT, Sydney time like NSW)', -35.2809, 149.13],
  ['Queanbeyan (NSW, beside the ACT)', -35.3533, 149.2343],
  ['Gungahlin (ACT)', -35.183, 149.133],
  ['Jervis Bay Territory', -35.15, 150.69],
  ['Huskisson (NSW, beside Jervis Bay Territory)', -35.04, 150.67],
  ['Albury (NSW, across the Murray from Wodonga)', -36.0737, 146.9135],
  ['Wodonga (VIC)', -36.1218, 146.8818],
  ['Echuca (VIC)', -36.13, 144.75],
  ['Moama (NSW)', -36.11, 144.76],
  ['Mildura (VIC)', -34.1855, 142.1625],
  ['Wentworth (NSW)', -34.11, 141.92],
  ['Bordertown (SA, tz-lookup says Melbourne)', -36.31, 140.77],
  ['Nhill (VIC, north of the core box)', -36.33, 141.65],
  ['Western VIC, 25 km from the SA border', -37.5, 141.25],
  ['Mount Gambier side of the SA border', -37.83, 140.85],
  ['Coolangatta (QLD)', -28.1681, 153.536],
  ['Tweed Heads (NSW)', -28.1782, 153.5434],
  ['Goondiwindi (QLD, on the NSW border)', -28.5469, 150.3074],
  ['Boggabilla (NSW)', -28.6, 150.36],
  ['Mungindi', -28.98, 148.98],
  ['QLD side of 29 S where tz-lookup says Sydney', -28.6, 144.5],
  ['NT side of 129 E where tz-lookup says Perth', -20.0, 129.2],
  ['Kununurra (WA, near the NT)', -15.7736, 128.7386],
  ['Eucla (WA, near SA)', -31.677, 128.883],
  ['Birdsville (QLD, near SA)', -25.8989, 139.3517],
  ['Camooweal (QLD, near the NT)', -19.9213, 138.1206],
  ['Wilsons Promontory (VIC) by the Tasmanian islands', -39.2, 146.4],
  ['Lord Howe Island', -31.5553, 159.0821],
  ['Bass Strait', -39.3, 145.5],
  ['Auckland', -36.8485, 174.7633],
  ['London', 51.5074, -0.1278],
]

describe('parkingStateForCoords: never guesses', () => {
  for (const [name, lat, lng] of AMBIGUOUS) {
    it(`${name} is null`, () => {
      expect(parkingStateForCoords({ lat, lng })).toBeNull()
    })
  }

  it('is null without usable coordinates', () => {
    expect(parkingStateForCoords(null)).toBeNull()
    expect(parkingStateForCoords(undefined)).toBeNull()
    expect(parkingStateForCoords({ lat: Number.NaN, lng: 144.96 })).toBeNull()
    expect(parkingStateForCoords({ lat: -37.81, lng: Number.POSITIVE_INFINITY })).toBeNull()
    expect(parkingStateForCoords({ lat: '-37.81', lng: 144.96 } as unknown as { lat: number; lng: number })).toBeNull()
  })

  it('needs the time zone to agree with the box', () => {
    // Bordertown sits in the SA box, but tz-lookup puts it in Melbourne
    // time: the disagreement means null, not SA and not VIC.
    expect(coreRegionState(-36.31, 140.77)).toBe('SA')
    expect(tzlookup(-36.31, 140.77)).toBe('Australia/Melbourne')
    expect(parkingStateForCoords({ lat: -36.31, lng: 140.77 })).toBeNull()
  })

  it('leaves every point of the ACT and its surrounds out of the NSW boxes', () => {
    // A grid over the ACT's full extent (35.12 to 35.92 S, 148.76 to 149.40 E).
    for (let lat = -35.92; lat <= -35.12; lat += 0.04) {
      for (let lng = 148.76; lng <= 149.4; lng += 0.04) {
        expect(coreRegionState(lat, lng)).toBeNull()
      }
    }
  })
})

describe('statesForZone', () => {
  it('maps Australian zones to the states that use them', () => {
    expect(statesForZone('Australia/Melbourne')).toEqual(['VIC'])
    expect(statesForZone('Australia/Sydney')).toEqual(['NSW', 'ACT'])
    expect(statesForZone('Australia/Broken_Hill')).toEqual(['NSW'])
    expect(statesForZone('Australia/Brisbane')).toEqual(['QLD'])
    expect(statesForZone('Australia/Eucla')).toEqual(['WA', 'SA'])
    expect(statesForZone('Australia/Currie')).toEqual(['TAS'])
  })

  it('has no state for ocean zones, other countries or inherited keys', () => {
    expect(statesForZone('Etc/GMT-10')).toEqual([])
    expect(statesForZone('Pacific/Auckland')).toEqual([])
    expect(statesForZone('toString')).toEqual([])
  })
})

describe('parkingStateForRecord', () => {
  it("prefers the record's own jurisdiction", () => {
    expect(parkingStateForRecord({ jurisdiction: 'ACT', location: { lat: -37.8136, lng: 144.9631 } })).toBe('ACT')
  })

  it('falls back to the saved location, and ignores an unknown jurisdiction', () => {
    expect(parkingStateForRecord({ location: { lat: -37.8136, lng: 144.9631 } })).toBe('VIC')
    expect(parkingStateForRecord({ jurisdiction: null, location: { lat: -27.4698, lng: 153.0251 } })).toBe('QLD')
    expect(
      parkingStateForRecord({
        jurisdiction: 'AU-VIC' as unknown as Jurisdiction,
        location: { lat: -35.2809, lng: 149.13 },
      }),
    ).toBeNull()
  })

  it('is null for a record without a location', () => {
    expect(parkingStateForRecord({ location: null })).toBeNull()
  })
})
