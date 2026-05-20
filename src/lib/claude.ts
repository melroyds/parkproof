import type { AppealDraft, ObservationGroup, ParkingRules, ParkingSession } from '../types'
import { postJsonAndPoll } from './api'

/**
 * Fresh sign translate from an image. Server-side this enqueues a job and
 * polls — see src/lib/api.ts for the async-job flow. Takes ~7-20s on
 * normal signs, up to ~50s on monstrous multi-variant signs (the kind
 * that previously hit API Gateway's 30s ceiling and 503'd).
 */
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
  return postJsonAndPoll<ParkingRules>('/sign-translate', body)
}

/**
 * Smart re-scan path. Skips the vision call entirely — sends the
 * previously-read sign rules to Claude and asks it to compute current-time
 * fields (can_park_now / until / duration_minutes) only. Roughly 3× faster
 * and 3–4× cheaper per scan vs the full translate path.
 *
 * Server-side this branches inside /sign-translate: if `prior_rules` is
 * present the Lambda runs it synchronously (fast enough to fit the 30s
 * gateway window), so the 202+poll flow degrades gracefully into a
 * normal sync response. `postJsonAndPoll` handles both shapes.
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
  return postJsonAndPoll<ParkingRules>('/sign-translate', body)
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
  return postJsonAndPoll<AppealDraft>('/draft-appeal', body)
}
