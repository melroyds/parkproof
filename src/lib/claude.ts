import type { AppealDraft, ObservationGroup, ParkingRules, ParkingSession } from '../types'
import { postJsonWithRetry } from './api'

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
  return postJsonWithRetry<ParkingRules>('/sign-translate', body)
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
  return postJsonWithRetry<ParkingRules>('/sign-translate', body)
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
  return postJsonWithRetry<AppealDraft>('/draft-appeal', body)
}
