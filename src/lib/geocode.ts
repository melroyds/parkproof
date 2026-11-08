import type { PlaceParts } from '../types'

type Address = string | null

/** Nominatim's `address` object: string parts keyed by OSM tag name. */
type NominatimAddress = Record<string, unknown>

function addressParts(data: unknown): NominatimAddress {
  if (!data || typeof data !== 'object') return {}
  const a = (data as { address?: unknown }).address
  return a && typeof a === 'object' ? (a as NominatimAddress) : {}
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** The locality the formatted address shows: suburb, else city, town, village, municipality, county. */
function localityOf(a: NominatimAddress): string | undefined {
  return str(a.suburb) || str(a.city) || str(a.town) || str(a.village) || str(a.municipality) || str(a.county)
}

function formatAddress(data: unknown): Address {
  if (!data || typeof data !== 'object') return null
  const d = data as { display_name?: string }
  const a = addressParts(data)

  const street = [str(a.house_number), str(a.road)].filter(Boolean).join(' ')
  const locality = localityOf(a)
  const state = str(a.state_code) || str(a.state)
  const parts = [street, [locality, state].filter(Boolean).join(' ').trim()].filter(Boolean)

  if (parts.length > 0) return parts.join(', ')
  return d.display_name ?? null
}

/** Longest road or suburb name kept in `place`. */
const PLACE_PART_MAX = 120

/** An ISO 3166-2 subdivision code as Nominatim writes it ("AU-VIC", "NZ-AUK"). */
const ISO_3166_2_RE = /^[A-Z]{2}-[A-Z0-9]{1,3}$/

const placePart = (v: unknown): string | null => {
  const s = str(v)
  return s ? s.slice(0, PLACE_PART_MAX) : null
}

/**
 * The raw parts saved on a record as `place` (T6a), from one Nominatim
 * result. `state_code` is the raw `ISO3166-2-lvl4` value, kept only when it
 * looks like an ISO 3166-2 code; it is never derived from the state's name
 * or anything else, so a record's jurisdiction comes from that value alone.
 */
export function placeFromNominatim(data: unknown): PlaceParts {
  const a = addressParts(data)
  const iso = a['ISO3166-2-lvl4']
  return {
    road: placePart(a.road),
    suburb: placePart(localityOf(a)),
    state_code: typeof iso === 'string' && ISO_3166_2_RE.test(iso) ? iso : null,
  }
}

export interface ReverseGeocodeDetails extends PlaceParts {
  /** The one-line address the logger shows ("12 King St, Melbourne VIC"). */
  address: string | null
}

/** Pure: the details for one Nominatim reverse result. Exported for tests. */
export function detailsFromNominatim(data: unknown): ReverseGeocodeDetails {
  return { address: formatAddress(data), ...placeFromNominatim(data) }
}

// Successful lookups only, keyed to about 11 m. A failed lookup isn't
// cached, so trying again can work. A lookup in flight is shared, so the
// address and the place for one fix cost one request.
const reverseCache = new Map<string, Promise<ReverseGeocodeDetails | null>>()

/**
 * Reverse-geocode a fix: the display address plus the raw parts saved as
 * `place` (road, suburb and the `ISO3166-2-lvl4` state code). Null when the
 * lookup failed (network, rate limit, bad response), so a caller can tell
 * "couldn't check" apart from "no road here".
 */
export function reverseGeocodeDetails(lat: number, lng: number): Promise<ReverseGeocodeDetails | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
  const cached = reverseCache.get(key)
  if (cached) return cached

  const lookup = (async (): Promise<ReverseGeocodeDetails | null> => {
    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        lat: lat.toString(),
        lon: lng.toString(),
        addressdetails: '1',
        zoom: '18',
      })
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) return null
      return detailsFromNominatim(await res.json())
    } catch {
      return null
    }
  })()
  reverseCache.set(key, lookup)
  void lookup.then((details) => {
    if (details === null && reverseCache.get(key) === lookup) reverseCache.delete(key)
  })
  return lookup
}

/** The one-line address for a fix, or null. Shares its lookup with reverseGeocodeDetails. */
export async function reverseGeocode(lat: number, lng: number): Promise<Address> {
  const details = await reverseGeocodeDetails(lat, lng)
  return details?.address ?? null
}

/** Drop every cached lookup. Tests only. */
export function clearGeocodeCacheForTests(): void {
  reverseCache.clear()
}

/**
 * A typed address's lookup. It carries no `place`: a record's `place` (and
 * so its jurisdiction) comes only from the reverse lookup of a phone GPS
 * fix, never from text the driver typed (build spec T6a item 2, N1).
 */
export interface ForwardGeocodeResult {
  lat: number
  lng: number
  address: string
}

export async function forwardGeocode(query: string): Promise<ForwardGeocodeResult | null> {
  const trimmed = query.trim()
  if (!trimmed) return null

  try {
    const params = new URLSearchParams({
      q: trimmed,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '1',
    })
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null
    const first = data[0]
    const lat = parseFloat(first.lat)
    const lng = parseFloat(first.lon)
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null
    const formatted = formatAddress(first) ?? first.display_name ?? trimmed
    return { lat, lng, address: formatted }
  } catch {
    return null
  }
}
