// @vitest-environment node
//
// walk-back distance + ETA + navigation deep-link.
//
// Why this file is in the suite: a distance-formatting regression sends
// the user the wrong block at night. A deep-link regression on iOS opens
// nothing instead of Apple Maps. Both are silent in dev; loud in the wild.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { estimateWalkBack, navigationUrl } from './walk-back'
import type { ParkingSession } from '../types'

// Minimal session factory — only the fields walk-back actually reads. Keeps
// the test from breaking when unrelated session shape evolves.
function sessionAt(lat: number, lng: number): ParkingSession {
  return {
    id: 'test-session',
    arrived_at: '2026-05-21T10:00:00+10:00',
    location: { lat, lng },
    sign_photo: null,
    car_photo: null,
    rules: '',
    observations: [],
    expires_at: null,
    confidence: 'high',
  }
}

// Real Melbourne anchor used across multiple cases for sanity.
const FLINDERS_ST_STATION = { lat: -37.8183, lng: 144.9671 }
const FED_SQUARE = { lat: -37.8175, lng: 144.9690 } // ≈ 200m away
const SOUTHERN_CROSS_STATION = { lat: -37.8184, lng: 144.9526 } // ≈ 1.27km away

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('formatDistance (private — exercised via estimateWalkBack)', () => {
  it('"120 m" for sub-kilometre values (rounded integer)', () => {
    const e = estimateWalkBack(sessionAt(FED_SQUARE.lat, FED_SQUARE.lng), FLINDERS_ST_STATION)
    expect(e).not.toBeNull()
    expect(e!.distanceLabel).toMatch(/^\d+ m$/)
    // Sanity bound — Flinders St to Fed Square is roughly 100-300m.
    expect(e!.distanceMeters).toBeGreaterThan(50)
    expect(e!.distanceMeters).toBeLessThan(500)
  })

  it('"0.4 km" at the 1000 m boundary — never "1000 m"', () => {
    // Build a pair ~1000m apart along latitude. 1 deg lat ≈ 111_320 m, so
    // ~0.009 deg ≈ 1000 m. Slightly over to land us past the boundary.
    const a = sessionAt(0, 0)
    const e = estimateWalkBack(a, { lat: 0.00905, lng: 0 })
    expect(e).not.toBeNull()
    expect(e!.distanceMeters).toBeGreaterThanOrEqual(1000)
    // The format should switch units — must have "km", not raw " m".
    expect(e!.distanceLabel).toMatch(/km$/)
  })

  it('"1.3 km" with one decimal for multi-km distances', () => {
    const e = estimateWalkBack(
      sessionAt(SOUTHERN_CROSS_STATION.lat, SOUTHERN_CROSS_STATION.lng),
      FLINDERS_ST_STATION,
    )
    expect(e).not.toBeNull()
    expect(e!.distanceLabel).toMatch(/^\d+\.\d km$/)
  })

  it('handles 0 m without negative or empty output', () => {
    const here = { lat: -37.8136, lng: 144.9631 }
    const e = estimateWalkBack(sessionAt(here.lat, here.lng), here)
    expect(e).not.toBeNull()
    expect(e!.distanceMeters).toBeCloseTo(0, 1)
    expect(e!.distanceLabel).toBe('0 m')
    // minutes floors to 1 even at 0 distance (covered in its own test below).
    expect(e!.minutes).toBe(1)
  })
})

describe('estimateWalkBack', () => {
  it('returns null when session.location is null', () => {
    const noLoc: ParkingSession = {
      ...sessionAt(0, 0),
      location: null,
    }
    expect(estimateWalkBack(noLoc, FLINDERS_ST_STATION)).toBeNull()
  })

  it('floors walking time at 1 min — "30s of walking" reads as "1 min walk"', () => {
    // ~30 m away from the same spot — under 1 min of walking at 1.4 m/s.
    const e = estimateWalkBack(
      sessionAt(FLINDERS_ST_STATION.lat + 0.0003, FLINDERS_ST_STATION.lng),
      FLINDERS_ST_STATION,
    )
    expect(e).not.toBeNull()
    expect(e!.distanceMeters).toBeLessThan(60)
    expect(e!.minutes).toBe(1)
    expect(e!.minutesLabel).toBe('1 min walk')
  })

  it('singular "1 min walk" for the 1-min case', () => {
    // Exactly at the saved spot — Math.max(1, 0) === 1.
    const here = FLINDERS_ST_STATION
    const e = estimateWalkBack(sessionAt(here.lat, here.lng), here)
    expect(e!.minutes).toBe(1)
    expect(e!.minutesLabel).toBe('1 min walk')
  })

  it('plural "N min walk" for multi-min cases', () => {
    // Southern Cross → Flinders St ≈ 1.27 km ≈ ~15 min walk at 1.4 m/s.
    const e = estimateWalkBack(
      sessionAt(SOUTHERN_CROSS_STATION.lat, SOUTHERN_CROSS_STATION.lng),
      FLINDERS_ST_STATION,
    )
    expect(e!.minutes).toBeGreaterThan(1)
    expect(e!.minutesLabel).toMatch(/^\d+ min walk$/)
    expect(e!.minutesLabel).not.toBe('1 min walk')
  })

  it('uses Haversine for distance — sanity-check against a known Melbourne pair', () => {
    // Flinders St Station to Southern Cross Station is ~1.27 km in straight-
    // line Haversine. Allow ±200m to absorb the rough rounding of the chosen
    // lat/lng anchors above.
    const e = estimateWalkBack(
      sessionAt(SOUTHERN_CROSS_STATION.lat, SOUTHERN_CROSS_STATION.lng),
      FLINDERS_ST_STATION,
    )
    expect(e!.distanceMeters).toBeGreaterThan(1070)
    expect(e!.distanceMeters).toBeLessThan(1470)
  })

  it('produces both distanceMeters (raw) and distanceLabel (formatted) for UI flexibility', () => {
    const e = estimateWalkBack(sessionAt(FED_SQUARE.lat, FED_SQUARE.lng), FLINDERS_ST_STATION)
    expect(typeof e!.distanceMeters).toBe('number')
    expect(typeof e!.distanceLabel).toBe('string')
    expect(typeof e!.minutes).toBe('number')
    expect(typeof e!.minutesLabel).toBe('string')
  })
})

describe('navigationUrl', () => {
  it('returns null when session.location is null', () => {
    const noLoc: ParkingSession = {
      ...sessionAt(0, 0),
      location: null,
    }
    expect(navigationUrl(noLoc)).toBeNull()
  })

  it('returns Google Maps URL with walking mode when navigator is undefined (SSR / non-browser)', () => {
    // Default node env — navigator is undefined here. No stubbing needed.
    const url = navigationUrl(sessionAt(-37.8136, 144.9631))
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//)
    expect(url).toContain('travelmode=walking')
    expect(url).toContain('destination=-37.8136,144.9631')
  })

  it('returns Apple Maps URL with dirflg=w when UA matches iPhone', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    })
    const url = navigationUrl(sessionAt(-37.8136, 144.9631))
    expect(url).toMatch(/^https:\/\/maps\.apple\.com\//)
    expect(url).toContain('dirflg=w')
    expect(url).toContain('daddr=-37.8136,144.9631')
  })

  it('returns Apple Maps URL with dirflg=w when UA matches iPad', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    })
    const url = navigationUrl(sessionAt(-37.8136, 144.9631))
    expect(url).toMatch(/^https:\/\/maps\.apple\.com\//)
    expect(url).toContain('dirflg=w')
  })

  it('returns Apple Maps URL with dirflg=w when UA matches Macintosh (desktop Safari users hit "Open in Maps")', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    })
    const url = navigationUrl(sessionAt(-37.8136, 144.9631))
    expect(url).toMatch(/^https:\/\/maps\.apple\.com\//)
  })

  it('returns Google Maps URL with travelmode=walking on Android UA', () => {
    vi.stubGlobal('navigator', {
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0',
    })
    const url = navigationUrl(sessionAt(-37.8136, 144.9631))
    expect(url).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//)
    expect(url).toContain('travelmode=walking')
  })

  it('coordinates are interpolated into the URL with their actual precision (not toFixed-rounded)', () => {
    // Six significant figures — the kind of coordinate GPS actually emits.
    // Regression guard for a previous version that toFixed(4)'d coords and
    // landed the user a few buildings away.
    const url = navigationUrl(sessionAt(-37.81363456, 144.96314789))
    expect(url).toContain('-37.81363456')
    expect(url).toContain('144.96314789')
  })
})
