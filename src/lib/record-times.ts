// The times a record carries wherever it leaves the app: the three PDFs and
// the appeal draft (build spec T1b, N5). Phone times (when the record was
// logged, when I've left was tapped) and ParkProof's signing times are kept
// apart, each part with its signing state, so nothing downstream can label
// a phone time as signed. Signed values are read from the signed payload
// (N2); values not signed yet come from the stored record.
//
// recordTimes and appealEvidence are pure: the caller passes this device's
// signing state in (deviceRecordContext reads it).
import type { ParkingSession, SignatureBundle } from '../types'
import { departureSummary, signedTimeOf, type DepartureSummary } from './chain-view'
import { DEV_KEY_ALIAS } from './evidence-chain'
import { arrivalSigningRejection, isEndedOnThisDevice } from './signing'
import { formatInZone } from './time-format'
import { sessionTimezone } from './timezone'

/** Link 0's state as stored: signed (ParkProof's key or a development key), refused, or not signed yet. */
export type ArrivalSigning =
  | { state: 'signed'; signed_at: string | null }
  | { state: 'dev_key'; signed_at: string | null }
  | { state: 'pending' }
  | { state: 'rejected' }

/** What the time helpers need to know about this device. */
export interface RecordTimesContext {
  /** The clock now (ms), for the departure's "none" rule (see departureSummary). */
  now?: number
  /** The driver tapped I've left on this device. */
  endedHere?: boolean
  /** The code ParkProof's server refused link 0 with on this device, or null. */
  arrivalRejection?: string | null
}

export interface RecordTimes {
  /** The record's own IANA zone, from where it was logged. */
  time_zone: string
  /** When the record was logged, by the phone's clock: the signed value once link 0 is signed. */
  arrived_at: string
  /** The sign's limit as read at parking: the signed value once link 0 is signed. */
  expires_at: string | null
  arrival_signing: ArrivalSigning
  /** The departure (tap time, signing, location), or null while the record hasn't ended. */
  departure: DepartureSummary | null
}

function payloadOf(bundle: SignatureBundle | null | undefined): Record<string, unknown> | null {
  if (!bundle || typeof bundle.canonical_payload !== 'string') return null
  try {
    const p = JSON.parse(bundle.canonical_payload)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** A record's link 0: a shared copy's is the sender's bundle (as in chainRows). */
function linkZeroOf(session: ParkingSession): SignatureBundle | null {
  const bundle = session.shared_from ? session.shared_from.arrival_bundle : session.signature
  return bundle && typeof bundle === 'object' && typeof bundle.signature_base64 === 'string' ? bundle : null
}

/** A record's phone and signing times (pure). */
export function recordTimes(session: ParkingSession, context: RecordTimesContext = {}): RecordTimes {
  const linkZero = linkZeroOf(session)
  const payload = payloadOf(linkZero)
  const signedArrived = typeof payload?.arrived_at === 'string' ? payload.arrived_at : null
  const signedExpires =
    payload && 'expires_at' in payload && (payload.expires_at === null || typeof payload.expires_at === 'string')
      ? (payload.expires_at as string | null)
      : undefined
  let arrival_signing: ArrivalSigning
  if (linkZero) {
    const signed_at = signedTimeOf(linkZero)
    arrival_signing = linkZero.key_alias === DEV_KEY_ALIAS ? { state: 'dev_key', signed_at } : { state: 'signed', signed_at }
  } else {
    arrival_signing = !session.shared_from && context.arrivalRejection ? { state: 'rejected' } : { state: 'pending' }
  }
  return {
    time_zone: sessionTimezone(session.location),
    arrived_at: signedArrived ?? session.arrived_at,
    expires_at: signedExpires !== undefined ? signedExpires : session.expires_at ?? null,
    arrival_signing,
    departure: departureSummary(session, { now: context.now, endedHere: context.endedHere }),
  }
}

/**
 * This device's signing state for a record: whether the driver ended it
 * here, and link 0's refusal code if the server refused it. Never throws.
 */
export function deviceRecordContext(sessionId: string, now: number = Date.now()): Required<RecordTimesContext> {
  let endedHere = false
  let arrivalRejection: string | null = null
  try {
    endedHere = isEndedOnThisDevice(sessionId)
    arrivalRejection = arrivalSigningRejection(sessionId)
  } catch (err) {
    console.warn('[record-times] could not read the signing state:', err)
  }
  return { now, endedHere, arrivalRejection }
}

/**
 * A time as every PDF and the appeal draft show it (N5): in the record's
 * zone, with the year and the zone's short name, e.g. "Sun 25 Oct 2026,
 * 1:55 pm AEDT".
 */
export function evidenceTime(value: string | number | Date, timeZone: string): string {
  return formatInZone(value, timeZone, { withYear: true })
}

// ─── The appeal draft ─────────────────────────────────────────────────────

/** How a part of the record stands, as the appeal drafter is told it. */
export type AppealSigning = 'signed' | 'dev_key' | 'pending' | 'rejected' | 'none'

/**
 * The separately labelled times sent with an appeal draft (`session.evidence`
 * in the /draft-appeal body). Every time is pre-formatted in the record's
 * zone with the zone name; the Lambda labels each one (phone clock or
 * server clock) and never reformats it.
 */
export interface AppealEvidence {
  time_zone: string
  /** When the record was logged (phone clock). */
  arrival_phone: string
  /** When ParkProof's server signed the arrival (server clock), or null when it isn't signed. */
  arrival_signed: string | null
  arrival_signing: Exclude<AppealSigning, 'none'>
  /** The sign's limit as read at parking, or null. */
  expires: string | null
  /** When I've left was tapped (phone clock), or null while the record hasn't ended. */
  departure_tapped: string | null
  /** When ParkProof's server signed the departure (server clock), or null when it isn't signed. */
  departure_signed: string | null
  /** Null while the record hasn't ended. */
  departure_signing: AppealSigning | null
  /** 'gps' only for a phone GPS fix, 'manual' for a typed address, null when unknown. */
  location_source: 'gps' | 'manual' | null
}

/** The appeal draft's times for a record (pure). */
export function appealEvidence(session: ParkingSession, context: RecordTimesContext = {}): AppealEvidence {
  const times = recordTimes(session, context)
  const tz = times.time_zone
  const arrivalSigned =
    times.arrival_signing.state === 'signed' || times.arrival_signing.state === 'dev_key'
      ? times.arrival_signing.signed_at
      : null
  const departure = times.departure
  const departureSigning = departure ? departure.signing : null
  const departureSigned =
    departureSigning && (departureSigning.state === 'signed' || departureSigning.state === 'dev_key')
      ? departureSigning.signed_at
      : null
  const source = session.location?.source
  return {
    time_zone: tz,
    arrival_phone: evidenceTime(times.arrived_at, tz),
    arrival_signed: arrivalSigned ? evidenceTime(arrivalSigned, tz) : null,
    arrival_signing: times.arrival_signing.state,
    expires: times.expires_at ? evidenceTime(times.expires_at, tz) : null,
    departure_tapped: departure ? evidenceTime(departure.tapped_at, tz) : null,
    departure_signed: departureSigned ? evidenceTime(departureSigned, tz) : null,
    departure_signing: departureSigning ? departureSigning.state : null,
    location_source: session.location ? (source === 'gps' ? 'gps' : source === 'manual' ? 'manual' : null) : null,
  }
}
