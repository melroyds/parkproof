import type { Jurisdiction, ParkingSession, PlaceParts } from '../types'

/**
 * Which Australian state or territory a record was made in (T6a).
 *
 * The only input is the raw ISO 3166-2 code Nominatim returns as
 * `ISO3166-2-lvl4` ("AU-VIC"), saved on the record as `place.state_code`.
 * Nothing else is consulted: not the state name, not the address text,
 * not the time zone, not the coordinates, not the record's `jurisdiction`
 * field. When the code is missing or isn't one of the eight below, the
 * answer is null. There is deliberately no fallback, because a guess that
 * produced VIC or QLD would switch workday mode on in a state whose rules
 * nobody has checked.
 */
const ISO_TO_JURISDICTION: Readonly<Record<string, Jurisdiction>> = Object.freeze({
  'AU-VIC': 'VIC',
  'AU-QLD': 'QLD',
  'AU-NSW': 'NSW',
  'AU-ACT': 'ACT',
  'AU-SA': 'SA',
  'AU-WA': 'WA',
  'AU-TAS': 'TAS',
  'AU-NT': 'NT',
})

/**
 * The jurisdiction for a raw `ISO3166-2-lvl4` value. Exact match only (the
 * code as Nominatim writes it); anything else is null.
 */
export function jurisdictionFromStateCode(stateCode: unknown): Jurisdiction | null {
  if (typeof stateCode !== 'string') return null
  return Object.prototype.hasOwnProperty.call(ISO_TO_JURISDICTION, stateCode)
    ? ISO_TO_JURISDICTION[stateCode]
    : null
}

/** The jurisdiction of a record's saved `place`, from its state code only. */
export function jurisdictionOfPlace(place: PlaceParts | null | undefined): Jurisdiction | null {
  return jurisdictionFromStateCode(place?.state_code)
}

/**
 * A record's jurisdiction, decided per record from `place.state_code` only
 * (build spec T6a item 2). The stored `jurisdiction` field is derived from
 * the same value at capture and is not read here, so a value that came
 * from anywhere else can never switch workday mode on.
 */
export function jurisdictionOfRecord(session: Pick<ParkingSession, 'place'>): Jurisdiction | null {
  return jurisdictionOfPlace(session.place)
}

/**
 * Where workday mode is available. Victoria and Queensland only, where the
 * authorised rule 205 text was read (docs/research/03-workday-shuffle.md).
 * NSW waits for its authorised text; WA uses different legislation.
 */
export const WORKDAY_JURISDICTIONS: readonly Jurisdiction[] = Object.freeze(['VIC', 'QLD'])

/** True only for a known jurisdiction where workday mode is available. */
export function isWorkdayJurisdiction(j: Jurisdiction | null | undefined): j is 'VIC' | 'QLD' {
  return j === 'VIC' || j === 'QLD'
}
