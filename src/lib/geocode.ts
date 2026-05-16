type Address = string | null

const reverseCache = new Map<string, Address>()

function formatAddress(data: unknown): Address {
  if (!data || typeof data !== 'object') return null
  const d = data as { address?: Record<string, string>; display_name?: string }
  const a = d.address ?? {}

  const street = [a.house_number, a.road].filter(Boolean).join(' ')
  const locality = a.suburb || a.city || a.town || a.village || a.municipality || a.county
  const state = a.state_code || a.state
  const parts = [street, [locality, state].filter(Boolean).join(' ').trim()].filter(Boolean)

  if (parts.length > 0) return parts.join(', ')
  return d.display_name ?? null
}

export async function reverseGeocode(lat: number, lng: number): Promise<Address> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
  if (reverseCache.has(key)) return reverseCache.get(key)!

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
    if (!res.ok) {
      reverseCache.set(key, null)
      return null
    }
    const formatted = formatAddress(await res.json())
    reverseCache.set(key, formatted)
    return formatted
  } catch {
    return null
  }
}

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
