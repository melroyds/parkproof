import tzlookup from 'tz-lookup'
import { JURISDICTIONS } from '../../lambda/addendum-schema.js'
import type { Jurisdiction, ParkingSession } from '../types'

/**
 * The state or territory a car is parked in, worked out on the phone from
 * the scan's coordinates with no network call (build spec T4 item 3). The
 * sign reader gets it as `parking_state` and uses it only to recognise that
 * state's sign styles, so the rule here is: never guess. Anything unsure is
 * null, and the reader then works from the photo alone, as before.
 *
 * Two independent checks have to agree:
 *
 * 1. CORE_REGIONS: hand-drawn boxes, each lying wholly inside one state and
 *    kept at least about 15 km (0.15 degrees, usually 0.3 to 0.4) from every
 *    state or territory border. A car within that distance of a border is
 *    left as null rather than placed on the nearer side. There is no box for
 *    the ACT: Canberra and Queanbeyan are a few kilometres apart in different
 *    jurisdictions, so the ACT and the NSW land around it (and the Jervis Bay
 *    Territory) are left out.
 * 2. The IANA time zone (tz-lookup, which the app already uses for every
 *    time it shows) must be one that state uses. tz-lookup is coarse away
 *    from cities (its zone edges can sit 50 to 100 km off a border), so it
 *    is never used on its own; it only catches a box drawn wrongly.
 *
 * Seam: T6a adds `reverseGeocodeDetails` and the record's `jurisdiction`
 * (from the reverse-geocoded ISO 3166-2 state code). Where a record has one,
 * `parkingStateForRecord` already prefers it; a fresh scan has only
 * coordinates until the logger geocodes them.
 */

interface CoreRegion {
  state: Jurisdiction
  south: number
  north: number
  west: number
  east: number
}

/**
 * Boxes inside one state, at least about 15 km from any border (degrees;
 * south and north are latitudes, west and east longitudes). Borders used:
 * WA at 129 E; NT and SA at 26 S; QLD at 138 E (north of 26 S), 141 E
 * (26 to 29 S) and 29 S then the Dumaresq and McPherson Range (north of
 * 28.9 S, reaching 28.16 S at Point Danger); SA at 141 E and 140.97 E; VIC
 * along the Murray (south of 34 S in the west, 35.8 to 36.2 S further east,
 * 36.8 S at its source near 148.2 E) and the straight line from there to
 * Cape Howe (37.5 S, 149.98 E); the ACT within 35.12 to 35.92 S and 148.76
 * to 149.40 E.
 */
const CORE_REGIONS: readonly CoreRegion[] = [
  // Melbourne, Geelong, Ballarat, Bendigo, the west and Gippsland. Shepparton,
  // Wodonga and the Murray towns are within reach of NSW.
  { state: 'VIC', south: -39.15, north: -36.6, west: 141.3, east: 148.0 },
  // Sydney, the Hunter, the north coast, the tablelands and the west.
  { state: 'NSW', south: -35.5, north: -29.4, west: 144.5, east: 153.7 },
  // Broken Hill and the far west, north of the Murray.
  { state: 'NSW', south: -33.7, north: -29.4, west: 141.4, east: 144.5 },
  // The south coast, from Batemans Bay to Eden.
  { state: 'NSW', south: -37.2, north: -35.5, west: 149.6, east: 150.5 },
  // Brisbane, Toowoomba and the south-west (not the Gold Coast's southern end).
  { state: 'QLD', south: -28.0, north: -25.6, west: 141.4, east: 154.0 },
  // Everything north of the SA border, east of the NT.
  { state: 'QLD', south: -25.6, north: -10.0, west: 138.4, east: 154.0 },
  { state: 'SA', south: -38.1, north: -26.4, west: 129.4, east: 140.8 },
  { state: 'WA', south: -35.2, north: -13.6, west: 112.5, east: 128.6 },
  { state: 'NT', south: -25.6, north: -10.8, west: 129.4, east: 137.6 },
  // Including King Island and Flinders Island.
  { state: 'TAS', south: -43.8, north: -39.45, west: 143.5, east: 148.6 },
]

/**
 * Land the NSW boxes contain but must never call NSW: the ACT (whose
 * neighbour Queanbeyan is in NSW) and the Jervis Bay Territory, with
 * margins.
 */
const NOT_NSW: readonly Omit<CoreRegion, 'state'>[] = [
  { south: -36.1, north: -34.95, west: 148.55, east: 149.6 },
  { south: -35.35, north: -34.95, west: 150.45, east: 151.0 },
]

/**
 * The states each Australian IANA zone is used in. Anything not listed
 * (an ocean zone such as Etc/GMT-10, or another country) has none.
 */
const ZONE_STATES: Readonly<Record<string, readonly Jurisdiction[]>> = {
  'Australia/Melbourne': ['VIC'],
  'Australia/Sydney': ['NSW', 'ACT'],
  'Australia/Broken_Hill': ['NSW'],
  'Australia/Lord_Howe': ['NSW'],
  'Australia/Brisbane': ['QLD'],
  'Australia/Lindeman': ['QLD'],
  'Australia/Adelaide': ['SA'],
  'Australia/Perth': ['WA'],
  'Australia/Eucla': ['WA', 'SA'],
  'Australia/Darwin': ['NT'],
  'Australia/Hobart': ['TAS'],
  'Australia/Currie': ['TAS'],
}

/** The states and territories an IANA zone is used in; [] for any other zone. */
export function statesForZone(zone: string): readonly Jurisdiction[] {
  return Object.prototype.hasOwnProperty.call(ZONE_STATES, zone) ? ZONE_STATES[zone] : []
}

const inside = (lat: number, lng: number, box: Omit<CoreRegion, 'state'>): boolean =>
  lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east

/** The state whose core region holds the point, or null (near a border, the ACT, outside Australia). */
export function coreRegionState(lat: number, lng: number): Jurisdiction | null {
  const region = CORE_REGIONS.find((r) => inside(lat, lng, r))
  if (!region) return null
  if (region.state === 'NSW' && NOT_NSW.some((box) => inside(lat, lng, box))) return null
  return region.state
}

/**
 * The state or territory the car is parked in, from the scan's coordinates
 * alone: the core region's state when the time zone agrees, otherwise null.
 * Null for missing or invalid coordinates. Never throws.
 */
export function parkingStateForCoords(coords: { lat: number; lng: number } | null | undefined): Jurisdiction | null {
  if (!coords) return null
  const { lat, lng } = coords
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const state = coreRegionState(lat, lng)
  if (!state) return null
  let zone: string
  try {
    zone = tzlookup(lat, lng)
  } catch {
    return null
  }
  return statesForZone(zone).includes(state) ? state : null
}

/**
 * The parking state for a re-check of a saved record: the record's own
 * jurisdiction when it has one (T6a sets it from the reverse-geocoded state
 * code), otherwise from its saved location.
 */
export function parkingStateForRecord(session: Pick<ParkingSession, 'location' | 'jurisdiction'>): Jurisdiction | null {
  const own = session.jurisdiction
  if (typeof own === 'string' && (JURISDICTIONS as readonly string[]).includes(own)) return own
  return parkingStateForCoords(session.location)
}
