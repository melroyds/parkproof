/**
 * Format a GPS accuracy radius (in metres) into a readable label.
 *
 *   - 5      → "±5m"
 *   - 53     → "±53m"
 *   - 850    → "±850m"
 *   - 1200   → "±1.2km"
 *   - 53000  → "±53km"
 */
export function formatAccuracy(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '±?'
  if (meters < 1000) return `±${Math.round(meters)}m`
  const km = meters / 1000
  if (km < 10) return `±${km.toFixed(1)}km`
  return `±${Math.round(km)}km`
}

/**
 * Above this threshold we treat GPS as unreliable for evidence purposes:
 * - Don't reverse-geocode (the resulting address would be misleading)
 * - Show a prominent warning + push the user to manual address entry
 * - Flag the saved session so the PDF reflects the uncertainty
 */
export const ACCURACY_USABLE_M = 100

/**
 * Above this threshold the GPS reading is essentially useless as a legal
 * locator (could be the wrong suburb, city, or even state).
 */
export const ACCURACY_DANGER_M = 500
