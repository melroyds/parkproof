import tzlookup from 'tz-lookup'
import type { ParkingSession } from '../types'

/**
 * Last-resort default when we have no coordinates and can't ask the browser
 * either. Matches the primary use-case region; any actual scan with GPS
 * will override this via tzlookup().
 */
export const DEFAULT_TIMEZONE = 'Australia/Melbourne'

/**
 * Derive the IANA timezone for a saved session from its GPS coordinates.
 *
 * Used by every surface that formats a session time for display — ensures
 * someone who scanned a sign in Sydney sees Sydney time, not Melbourne time
 * offset by 1h during DST. Falls back to DEFAULT_TIMEZONE when no location
 * was captured (rare — happens only when the user denied GPS at log time
 * AND didn't enter a manual address).
 */
export function sessionTimezone(
  location: ParkingSession['location'] | null | undefined,
): string {
  if (!location) return DEFAULT_TIMEZONE
  return timezoneForCoords(location.lat, location.lng)
}

/**
 * Variant for the pre-save flow (ParkingResult), where we have coords but
 * haven't yet created a ParkingSession. Same logic; different argument shape.
 */
export function timezoneForCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string {
  if (typeof lat !== 'number' || typeof lng !== 'number') return DEFAULT_TIMEZONE
  try {
    return tzlookup(lat, lng) || DEFAULT_TIMEZONE
  } catch {
    // tz-lookup throws on out-of-range coords. Treat that the same as "no
    // useful location" — fall back to the default rather than crash a render.
    return DEFAULT_TIMEZONE
  }
}
