// What a share link shows, and the read-only copy it leaves (build spec T7
// items 3, 4 and 6). Pure: no storage, no network, no clock.
//
// The address, coordinates, arrival and expiry come only from the signed
// payload of a bundle the verifier passed. The sender's extras (driver,
// time zone, ended, sign-reading summary, standard limit) are kept apart
// and shown as "From the sender, not signed".
import type { Confidence, ParkingSession, SignatureBundle } from '../types'
import type { LinkCheck } from './verify'
import { DEFAULT_TIMEZONE, timezoneForCoords } from './timezone'
import { fitText } from './evidence-chain'
import { shareExtrasOf, shareTime, type ShareExtras, type SharePayload } from './share-link'

/** How a share link's check came out, as the receive view and the copy's check treat it. */
export type ShareOutcome = 'valid' | 'dev_key' | 'changed'

/**
 * A verifier result for a share link: 'valid'; 'dev_key' for a bundle from
 * the `npm run dev` signer, accepted only when `acceptDevKey` (development
 * builds; a production build treats it as changed, because a development
 * key's signature isn't checked at all); 'changed' for everything else.
 */
export function shareOutcome(check: Pick<LinkCheck, 'status'>, acceptDevKey: boolean = import.meta.env.DEV): ShareOutcome {
  if (check.status === 'valid') return 'valid'
  if (check.status === 'dev_key' && acceptDevKey) return 'dev_key'
  return 'changed'
}

/** The signed location as a share shows it. */
export interface SharedLocation {
  lat: number
  lng: number
  address: string | null
  source?: 'gps' | 'manual'
  accuracy_meters?: number
}

/** What a share link (or a stored copy of one) shows. */
export interface SharedFacts {
  // ── From the signed payload ──
  /** The sender's record id. */
  original_session_id: string
  /** When the record was logged, by the sender's phone clock. */
  arrived_at: string
  expires_at: string | null
  location: SharedLocation | null
  no_sign: boolean
  /** The sign reading as signed ('' for a no-sign record). */
  signed_rules: string
  chosen_label: string | null
  confidence: Confidence
  /** ParkProof's signing time. */
  signed_at: string | null
  // ── Derived ──
  /** The zone to show times in: from the signed coordinates, else the sender's zone, else the default. */
  time_zone: string
  // ── From the sender, not signed ──
  shared_at: string | null
  extras: ShareExtras
}

const SESSION_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/
const CONFIDENCES: readonly Confidence[] = ['low', 'medium', 'high']

function signedLocation(value: unknown): SharedLocation | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  const l = value as Record<string, unknown>
  const lat = l.lat
  const lng = l.lng
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return undefined
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined
  const out: SharedLocation = { lat, lng, address: fitText(l.address, 300) }
  if (l.source === 'gps' || l.source === 'manual') out.source = l.source
  if (typeof l.accuracy_meters === 'number' && Number.isFinite(l.accuracy_meters) && l.accuracy_meters >= 0) {
    out.accuracy_meters = l.accuracy_meters
  }
  return out
}

/**
 * The facts of a share from a VERIFIED signed payload (a LinkCheck's
 * `payload`, which the verifier only fills for a link that checked out)
 * and the sender's extras. Null when the payload lacks what a share shows
 * (a record id, a logged time, a readable location shape).
 */
export function sharedFacts(
  payload: Record<string, unknown> | null,
  extras: ShareExtras,
  sharedAt: string | null,
): SharedFacts | null {
  if (!payload) return null
  const id = payload.session_id
  if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) return null
  const arrived = shareTime(payload.arrived_at)
  if (!arrived || typeof payload.arrived_at !== 'string') return null
  const location = signedLocation(payload.location)
  if (location === undefined) return null
  const expires = payload.expires_at === null || payload.expires_at === undefined ? null : shareTime(payload.expires_at)
  if (payload.expires_at !== null && payload.expires_at !== undefined && !expires) return null
  const time_zone = location
    ? timezoneForCoords(location.lat, location.lng)
    : extras.time_zone ?? DEFAULT_TIMEZONE
  return {
    original_session_id: id,
    // The signed text itself, not a re-formatted copy.
    arrived_at: payload.arrived_at,
    expires_at: typeof payload.expires_at === 'string' ? payload.expires_at : null,
    location,
    no_sign: payload.no_sign === true,
    signed_rules: typeof payload.rules === 'string' ? payload.rules : '',
    chosen_label: typeof payload.chosen_label === 'string' && payload.chosen_label ? payload.chosen_label : null,
    confidence: CONFIDENCES.includes(payload.confidence as Confidence) ? (payload.confidence as Confidence) : 'low',
    signed_at: typeof payload.signed_at === 'string' ? payload.signed_at : null,
    time_zone,
    shared_at: sharedAt,
    extras,
  }
}

/**
 * The read-only copy a verified share link leaves on this device (item 4):
 * a new local id; the sender's bundle in `shared_from.arrival_bundle`
 * (never as `signature`); the sender's extras as `shared_from.snapshot`;
 * the record's own fields only from the signed payload. No photos, no
 * chain key, no addenda, no driver, no ended_at: what the sender said
 * stays in the snapshot, labelled as theirs.
 */
export function sharedCopyRecord(
  facts: SharedFacts,
  bundle: SignatureBundle,
  receivedAt: string,
  id: string,
): ParkingSession {
  const record: ParkingSession = {
    id,
    arrived_at: facts.arrived_at,
    location: facts.location ? { ...facts.location } : null,
    sign_photo: null,
    car_photo: null,
    rules: facts.signed_rules,
    observations: [],
    expires_at: facts.expires_at,
    confidence: facts.confidence,
    shared_from: {
      original_session_id: facts.original_session_id,
      received_at: receivedAt,
      shared_at: facts.shared_at,
      arrival_bundle: bundle,
      snapshot: { ...facts.extras },
    },
  }
  if (facts.no_sign) record.no_sign = true
  if (facts.chosen_label) record.chosen_label = facts.chosen_label
  return record
}

/**
 * The facts of a stored copy, read from the sender's bundle it holds (the
 * payload the verifier passed when the link was opened) and its snapshot.
 * Null for a record that isn't a copy, or whose bundle can't be read.
 */
export function sharedFactsOfCopy(session: ParkingSession): SharedFacts | null {
  const from = session.shared_from
  if (!from || !from.arrival_bundle || typeof from.arrival_bundle.canonical_payload !== 'string') return null
  let payload: unknown
  try {
    payload = JSON.parse(from.arrival_bundle.canonical_payload)
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const facts = sharedFacts(payload as Record<string, unknown>, shareExtrasOf(from.snapshot), shareTime(from.shared_at))
  // A copy's payload signs the sender's id; anything else isn't this copy's bundle.
  return facts && facts.original_session_id === from.original_session_id ? facts : null
}

/** The extras and shared time a decoded link carries, as `sharedFacts` takes them. */
export function linkExtras(payload: SharePayload): { extras: ShareExtras; sharedAt: string } {
  return { extras: shareExtrasOf(payload), sharedAt: payload.shared_at }
}

/**
 * Item 6: the share and handover screens warn about the permit only when
 * the record's park used an accessible parking permit.
 */
export function showsPermitSafeguard(session: Pick<ParkingSession, 'permit_context'>): boolean {
  return session.permit_context?.type === 'accessible'
}
