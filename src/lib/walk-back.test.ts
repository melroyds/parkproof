// @vitest-environment node
//
// walk-back distance + ETA + navigation deep-link. Skeleton — fill in
// tomorrow. Each it.todo names the exact case to write.
//
// Why this file is in the suite: a distance-formatting regression sends
// the user the wrong block at night. A deep-link regression on iOS opens
// nothing instead of Apple Maps. Both are silent in dev; loud in the wild.

import { describe, it } from 'vitest'

describe('formatDistance (private — exercised via estimateWalkBack)', () => {
  it.todo('"120 m" for sub-kilometre values (rounded integer)')
  it.todo('"0.4 km" at exactly 1000 m boundary — never "1000 m"')
  it.todo('"1.2 km" with one decimal for multi-km distances')
  it.todo('handles 0 m without negative or empty output')
})

describe('estimateWalkBack', () => {
  it.todo('returns null when session.location is null')
  it.todo('floors min walk time at 1 — "30s of walking" reads as "1 min walk"')
  it.todo('singular "1 min walk" for the 1-min case')
  it.todo('plural "5 min walk" for multi-min cases')
  it.todo('uses Haversine for distance — sanity-check against a known Melbourne pair')
  it.todo('produces both distanceMeters (raw) and distanceLabel (formatted) for UI flexibility')
})

describe('navigationUrl', () => {
  it.todo('returns null when session.location is null')
  it.todo('returns Google Maps URL with walking mode when navigator is undefined (SSR / non-browser)')
  it.todo('returns Apple Maps URL with dirflg=w when UA matches iPhone')
  it.todo('returns Apple Maps URL with dirflg=w when UA matches iPad')
  it.todo('returns Apple Maps URL with dirflg=w when UA matches Macintosh (desktop Safari users hit "Open in Maps")')
  it.todo('returns Google Maps URL with travelmode=walking on Android UA')
  it.todo('coordinates are interpolated into the URL with their actual precision (not toFixed-rounded)')
})
