import type { ParkingSession } from '../types'
import { haversineMeters } from './geo'

/**
 * Average walking speed used for the ETA estimate. 1.4 m/s ≈ 5 km/h matches
 * the figure traffic engineers use for "casual urban pedestrian". Couriers,
 * commuters and runners are faster; this errs slightly on the cautious side
 * so the user has time in hand.
 */
const WALKING_M_PER_S = 1.4

export interface WalkBackEstimate {
  distanceMeters: number
  /** "0.4 km" / "120 m" — pick the right unit for legibility. */
  distanceLabel: string
  /** Estimated walking time, integer minutes. Always ≥ 1. */
  minutes: number
  minutesLabel: string
}

/**
 * Format a distance as either "120 m" or "0.4 km" — whichever reads cleaner
 * at the given size. The < 1000 m threshold is a UX choice, not a precision
 * one: people picture "850 m" fine but "1.2 km" is a comfier mental unit.
 */
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

/** Estimate walking distance + time from `from` to the session's saved location. */
export function estimateWalkBack(
  session: ParkingSession,
  from: { lat: number; lng: number },
): WalkBackEstimate | null {
  if (!session.location) return null
  const distanceMeters = haversineMeters(from, session.location)
  const seconds = distanceMeters / WALKING_M_PER_S
  const minutes = Math.max(1, Math.round(seconds / 60))
  return {
    distanceMeters,
    distanceLabel: formatDistance(distanceMeters),
    minutes,
    minutesLabel: minutes === 1 ? '1 min walk' : `${minutes} min walk`,
  }
}

/**
 * Build a maps deep-link to walking directions toward the session location.
 * iOS prefers Apple Maps (maps://), every other platform handles the Google
 * Maps universal URL fine — so we route by UA platform. Both URLs request
 * walking mode explicitly.
 */
export function navigationUrl(session: ParkingSession): string | null {
  if (!session.location) return null
  const { lat, lng } = session.location
  if (typeof navigator !== 'undefined') {
    // Apple platforms — use the maps:// scheme which respects the user's
    // default mapping app (Apple Maps installed by default; some users swap
    // to Google Maps, which also handles maps:// on iOS).
    const ua = navigator.userAgent || ''
    const isApple = /iPhone|iPad|iPod|Macintosh/.test(ua)
    if (isApple) {
      return `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=w`
    }
  }
  // Default — Google Maps universal URL, works on Android, desktop, and even
  // iOS if the user has Google Maps installed.
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`
}
