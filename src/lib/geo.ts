/**
 * Haversine distance between two lat/lng pairs, in metres.
 * Used to decide whether a saved session is "near here" for the smart-rescan feature.
 */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371e3
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const φ1 = toRad(a.lat)
  const φ2 = toRad(b.lat)
  const Δφ = toRad(b.lat - a.lat)
  const Δλ = toRad(b.lng - a.lng)
  const x =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}
