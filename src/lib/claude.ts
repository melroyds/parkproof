import type { AppealDraft, NoticeFields, ObservationGroup, ParkingRules, ParkingSession } from '../types'
import { postJsonAndPoll, type ErrorCopy } from './api'
import { appealEvidence, deviceRecordContext } from './record-times'

/**
 * Read a `dev_time` URL parameter and return it as an ISO 8601 string the
 * Lambda's `current_datetime` field will accept. Lets the user spoof "what
 * time is it?" for testing — e.g. visiting www.parkproof.com.au/?dev_time=
 * 2026-05-21T10:30 lets a meter-zone scan run as if it were Thursday morning,
 * even when the real wall-clock time is well outside any paid window.
 *
 * Returns undefined when no dev_time is set OR the value doesn't parse — the
 * Lambda then falls back to its own `new Date()`. The check is intentionally
 * loose; this is a debug shim, not a security boundary.
 *
 * Accepts:
 *   ?dev_time=2026-05-21T10:30          → assumed +10:00 / +11:00 (spot tz)
 *   ?dev_time=2026-05-21T10:30:00+10:00 → passed through as-is
 */
function readDevTimeFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = new URLSearchParams(window.location.search).get('dev_time')
    if (!raw) return undefined
    // If the user already supplied a timezone offset, pass through verbatim.
    if (/[+-]\d{2}:?\d{2}$/.test(raw) || raw.endsWith('Z')) return raw
    // Otherwise normalise common short forms to a parseable shape. The Lambda
    // resolves the proper offset from lat/lng anyway — supplying a naive
    // local time is fine and arguably more honest (the model uses it as
    // "what time it currently is in the parking spot's local timezone").
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/)
    if (m) {
      const [, y, mo, d, h, mi, s = '00'] = m
      // Append seconds + a placeholder offset; Lambda treats current_datetime
      // as a string label, not a Date — the offset is decorative for the
      // model. Use +10:00 (Melbourne winter / Brisbane year-round) as the
      // pragmatic default for an AU-focused app.
      return `${y}-${mo}-${d}T${h}:${mi}:${s}+10:00`
    }
    return raw // last-ditch: let the model parse whatever the user typed
  } catch {
    return undefined
  }
}

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
  const devTime = readDevTimeFromUrl()
  if (devTime) body.current_datetime = devTime
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
  const devTime = readDevTimeFromUrl()
  if (devTime) body.current_datetime = devTime
  return postJsonAndPoll<ParkingRules>('/sign-translate', body)
}

/**
 * The record as the appeal drafter receives it. `evidence` carries the
 * separately labelled times (build spec T1b): when the record was logged and
 * when I've left was tapped (phone clock), and when ParkProof's server signed
 * each part (server clock), each pre-formatted in the record's zone with the
 * zone name, plus `location_source` (gps or manual). The Lambda turns them
 * into labelled lines and never presents a phone time as signed.
 */
export function appealSessionBody(session: ParkingSession, now: number = Date.now()) {
  return {
    arrived_at: session.arrived_at,
    expires_at: session.expires_at,
    location: session.location,
    rules: session.rules,
    observations: session.observations,
    chosen_label: session.chosen_label,
    confidence: session.confidence,
    evidence: appealEvidence(session, deviceRecordContext(session.id, now)),
  }
}

export async function draftAppeal(
  ticketImageBase64: string,
  ticketMediaType: string,
  session: ParkingSession | null,
): Promise<AppealDraft> {
  // session is null on the standalone entry — a user who got a ticket but never
  // logged a ParkProof park for the spot. The Lambda drafts from the notice
  // alone and is instructed not to fabricate evidence the user doesn't have.
  const body = {
    ticket_image_base64: ticketImageBase64,
    ticket_media_type: ticketMediaType,
    session: session ? appealSessionBody(session) : null,
  }
  return postJsonAndPoll<AppealDraft>('/draft-appeal', body)
}

/**
 * Failures of /read-notice in the notice's own words: the shared defaults
 * talk about "this sign" and "your scan". The English fallbacks match
 * en.json.
 */
export const NOTICE_ERROR_COPY: ErrorCopy = {
  timeout: ['errors.genericRetry', 'Something went wrong. Please try again in a moment.'],
  heavyLoad: [
    'errors.noticeHeavyLoad',
    "ParkProof is busy right now and couldn't finish reading the notice in time. Wait a minute and try again.",
  ],
  codes: {
    ERR_IMAGE_TOO_LARGE: ['errors.noticeImageTooLarge', 'That photo is too large. Try another photo of the notice.'],
  },
}

/**
 * Read a parking fine notice from a photo (build spec T8). Server-side this
 * is the /draft-appeal job pattern: 202 + job id, then polling
 * /read-notice/status/{job_id}, whose row is deleted once the result is
 * handed back. In dev the Vite proxy answers synchronously. Errors arrive
 * as ApiError with localised copy (ERR_NOT_A_NOTICE, ERR_NOTICE_UNREADABLE,
 * ERR_IMAGE_TOO_LARGE, ERR_IMAGE_TYPE map to their own messages; a timeout
 * or server error uses NOTICE_ERROR_COPY, never the sign scan's copy).
 */
export async function readNotice(imageBase64: string, mediaType = 'image/jpeg'): Promise<NoticeFields> {
  return postJsonAndPoll<NoticeFields>(
    '/read-notice',
    { image_base64: imageBase64, media_type: mediaType },
    { copy: NOTICE_ERROR_COPY },
  )
}
