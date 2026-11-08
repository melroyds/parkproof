// @vitest-environment node
//
// reverseGeocodeDetails (build spec T6a item 2): the address plus the raw
// parts saved on a record as `place`. The state code is Nominatim's raw
// ISO3166-2-lvl4 value and nothing else, because a record's jurisdiction is
// read from it alone. The road feeds the workday same-stretch check.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearGeocodeCacheForTests,
  detailsFromNominatim,
  forwardGeocode,
  placeFromNominatim,
  reverseGeocode,
  reverseGeocodeDetails,
} from './geocode'

/** A Nominatim jsonv2 reverse result for a Carlton bay, trimmed. */
const CARLTON = {
  place_id: 1,
  display_name: '123, Lygon Street, Carlton, Melbourne, City of Melbourne, Victoria, 3053, Australia',
  address: {
    house_number: '123',
    road: 'Lygon Street',
    suburb: 'Carlton',
    city: 'Melbourne',
    municipality: 'City of Melbourne',
    state: 'Victoria',
    'ISO3166-2-lvl4': 'AU-VIC',
    postcode: '3053',
    country: 'Australia',
    country_code: 'au',
  },
}

const BRISBANE = {
  lat: '-27.4705',
  lon: '153.0260',
  display_name: 'Queen Street, Brisbane City, Brisbane, Queensland, 4000, Australia',
  address: {
    road: 'Queen Street',
    suburb: 'Brisbane City',
    city: 'Brisbane',
    state: 'Queensland',
    'ISO3166-2-lvl4': 'AU-QLD',
    country_code: 'au',
  },
}

const withAddress = (address: Record<string, unknown>) => ({ address })

describe('placeFromNominatim', () => {
  it('takes the road, the suburb and the raw ISO3166-2-lvl4 code', () => {
    expect(placeFromNominatim(CARLTON)).toEqual({ road: 'Lygon Street', suburb: 'Carlton', state_code: 'AU-VIC' })
    expect(placeFromNominatim(BRISBANE)).toEqual({ road: 'Queen Street', suburb: 'Brisbane City', state_code: 'AU-QLD' })
  })

  it('never derives the state code from anything but ISO3166-2-lvl4', () => {
    expect(placeFromNominatim(withAddress({ state: 'Victoria' })).state_code).toBeNull()
    expect(placeFromNominatim(withAddress({ state_code: 'VIC', state: 'Victoria' })).state_code).toBeNull()
    expect(placeFromNominatim(withAddress({ 'ISO3166-2-lvl3': 'AU-QLD' })).state_code).toBeNull()
    expect(placeFromNominatim(withAddress({ 'ISO3166-2-lvl4': 'au-vic' })).state_code).toBeNull()
    expect(placeFromNominatim(withAddress({ 'ISO3166-2-lvl4': 'Victoria' })).state_code).toBeNull()
    expect(placeFromNominatim(withAddress({ 'ISO3166-2-lvl4': 42 })).state_code).toBeNull()
    // Kept as given when it is an ISO 3166-2 code, even outside Australia (jurisdiction.ts maps it to null).
    expect(placeFromNominatim(withAddress({ 'ISO3166-2-lvl4': 'NZ-AUK' })).state_code).toBe('NZ-AUK')
  })

  it('uses the same locality as the address line when there is no suburb', () => {
    expect(placeFromNominatim(withAddress({ town: 'Geelong' })).suburb).toBe('Geelong')
    expect(placeFromNominatim(withAddress({ village: 'Mount Macedon', county: 'Shire' })).suburb).toBe('Mount Macedon')
  })

  it('trims, drops empty parts and caps long ones', () => {
    expect(placeFromNominatim(withAddress({ road: '  ', suburb: ' Carlton ' }))).toEqual({ road: null, suburb: 'Carlton', state_code: null })
    expect(placeFromNominatim(withAddress({ road: 'x'.repeat(400) })).road).toHaveLength(120)
  })

  it('anything that isn\'t a result gives empty parts', () => {
    for (const v of [null, undefined, 'x', 42, {}, { address: 'nope' }]) {
      expect(placeFromNominatim(v)).toEqual({ road: null, suburb: null, state_code: null })
    }
  })
})

describe('detailsFromNominatim', () => {
  it('keeps the one-line address the logger always showed', () => {
    expect(detailsFromNominatim(CARLTON)).toEqual({
      address: '123 Lygon Street, Carlton Victoria',
      road: 'Lygon Street',
      suburb: 'Carlton',
      state_code: 'AU-VIC',
    })
  })
})

describe('reverseGeocodeDetails and reverseGeocode', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const okJson = (body: unknown) => ({ ok: true, json: async () => body })

  beforeEach(() => {
    clearGeocodeCacheForTests()
    fetchMock = vi.fn(async () => okJson(CARLTON))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks Nominatim for an address-level reverse lookup and returns the details', async () => {
    const details = await reverseGeocodeDetails(-37.79831, 144.96712)
    expect(details).toEqual(detailsFromNominatim(CARLTON))
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/reverse')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: 'jsonv2',
      lat: '-37.79831',
      lon: '144.96712',
      addressdetails: '1',
      zoom: '18',
    })
  })

  it('one request serves the address and the place, and a nearby repeat is cached', async () => {
    const [details, address] = await Promise.all([reverseGeocodeDetails(-37.7983, 144.9671), reverseGeocode(-37.7983, 144.9671)])
    expect(address).toBe('123 Lygon Street, Carlton Victoria')
    expect(details?.state_code).toBe('AU-VIC')
    await reverseGeocodeDetails(-37.79831, 144.96709) // same to 4 decimal places
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a failed lookup is null and isn\'t cached, so trying again can work', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    expect(await reverseGeocodeDetails(-37.7983, 144.9671)).toBeNull()
    expect(await reverseGeocode(-37.7983, 144.9671)).toBe('123 Lygon Street, Carlton Victoria')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a network error is null, never a throw', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    expect(await reverseGeocodeDetails(-27.47, 153.03)).toBeNull()
    expect(await reverseGeocode(-27.47, 153.03)).toBe('123 Lygon Street, Carlton Victoria')
  })
})

describe('forwardGeocode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [BRISBANE] })))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the point and address of a typed address, and no place parts', async () => {
    // A record's place and jurisdiction come only from the reverse lookup of
    // a GPS fix. A typed address must not be able to supply a state code.
    const result = await forwardGeocode('Queen St Brisbane')
    expect(result).toEqual({
      lat: -27.4705,
      lng: 153.026,
      address: 'Queen Street, Brisbane City Queensland',
    })
    expect(result).not.toHaveProperty('place')
  })
})
