import type { AppealDraft, ObservationGroup, ParkingRules, ParkingSession } from '../types'

// In dev, falls through to the Vite middleware. In prod, baked in at build time
// via `VITE_API_URL=https://...execute-api... npm run build`.
const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? '/api/sign-translate'

export async function translateSign(
  imageBase64: string,
  mediaType = 'image/jpeg',
  coords?: { lat: number; lng: number } | null,
): Promise<ParkingRules> {
  const body: Record<string, unknown> = {
    image_base64: imageBase64,
    media_type: mediaType,
  }
  if (coords) {
    body.lat = coords.lat
    body.lng = coords.lng
  }
  return postJson(body)
}

/**
 * Smart re-scan path. Skips the vision call entirely — sends the
 * previously-read sign rules to Claude and asks it to compute current-time
 * fields (can_park_now / until / duration_minutes) only. Roughly 3× faster
 * and 3–4× cheaper per scan vs the full translate path.
 */
export async function refreshInterpretation(
  prior: {
    rules: string
    observations: ObservationGroup[]
    chosen_label?: string
  },
  coords?: { lat: number; lng: number } | null,
): Promise<ParkingRules> {
  const body: Record<string, unknown> = {
    prior_rules: prior.rules,
    prior_observations: prior.observations,
  }
  if (prior.chosen_label) body.prior_chosen_label = prior.chosen_label
  if (coords) {
    body.lat = coords.lat
    body.lng = coords.lng
  }
  return postJson(body)
}

function appealUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined
  if (apiUrl) {
    return apiUrl.replace(/\/[^/]*$/, '/draft-appeal')
  }
  return '/api/draft-appeal'
}

export async function draftAppeal(
  ticketImageBase64: string,
  ticketMediaType: string,
  session: ParkingSession,
): Promise<AppealDraft> {
  const body = {
    ticket_image_base64: ticketImageBase64,
    ticket_media_type: ticketMediaType,
    session: {
      arrived_at: session.arrived_at,
      expires_at: session.expires_at,
      location: session.location,
      rules: session.rules,
      observations: session.observations,
      chosen_label: session.chosen_label,
      confidence: session.confidence,
    },
  }
  const resp = await fetch(appealUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    let detail: string
    try {
      detail = (await resp.json()).error
    } catch {
      detail = await resp.text()
    }
    throw new Error(detail || `Appeal draft failed (${resp.status})`)
  }
  return resp.json()
}

async function postJson(body: Record<string, unknown>): Promise<ParkingRules> {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    let detail: string
    try {
      const parsed = await resp.json()
      detail = parsed.error || JSON.stringify(parsed)
    } catch {
      detail = await resp.text()
    }
    throw new Error(detail || `Request failed (${resp.status})`)
  }

  return resp.json()
}
