// Share links (build spec T7 item 2). Pure: no storage, no network, no
// clock unless one is passed in.
//
// A share link is `/app/#share=1.<base64url(JSON)>`, uncompressed. The
// leading "1." is the format version; a link with any other version is
// refused with "This link was made by a newer version of ParkProof". The
// token after `#share=` may be at most 16 KB.
//
// The JSON carries the record's arrival bundle (link 0) as four fields,
// canonical_payload, signature_base64, signed_at and key_alias, plus these
// unsigned extras from the sender: shared_at, driver, time_zone, ended_at,
// rules (a summary of the sign reading) and standard_until (only when the
// park was permit-adjusted). Nothing else: no photos, no chain key, no
// permit status, no addenda. The receiver checks the bundle with the
// in-browser verifier and takes the address, coordinates, arrival and
// expiry only from its signed payload; the extras are shown as "From the
// sender, not signed".
import type { ParkingSession } from '../types'
import { CAPS } from '../../lambda/addendum-schema.js'
import { fitText } from './evidence-chain'
import { permitAdjustedUntil } from './permit-answer'
import { isCompleteBundle } from './signed-links'
import { timezoneForCoords } from './timezone'

/** The format version this build writes and reads. */
export const SHARE_LINK_VERSION = '1'

/** The longest token (the text after `#share=`) a link may carry: 16 KB. */
export const SHARE_LINK_MAX_BYTES = 16 * 1024

/** The longest sign-reading summary a link carries. */
export const SHARE_RULES_MAX = 500

/** Link 0 as a share link carries it (verify.ts reads this shape). */
export interface ShareBundle {
  canonical_payload: string
  signature_base64: string
  signed_at: string
  key_alias: string
}

/** The unsigned extras from the sender. Every one is shown as "From the sender, not signed". */
export interface ShareExtras {
  /** Who the sender says was driving, or null. */
  driver: string | null
  /** The record's IANA zone on the sender's phone, or null. */
  time_zone: string | null
  /** When the sender tapped I've left (phone clock, ISO), or null. */
  ended_at: string | null
  /** A summary of the sign reading, or null (no-sign records). */
  rules: string | null
  /** The sign's standard limit (ISO) when the park was permit-adjusted, else null. */
  standard_until: string | null
}

/** The whole JSON of a share link. */
export interface SharePayload extends ShareExtras {
  bundle: ShareBundle
  /** When the sender made the link (phone clock, ISO). */
  shared_at: string
}

/** Exactly the keys a share link's JSON carries, in the order it writes them. */
export const SHARE_PAYLOAD_KEYS = [
  'bundle',
  'shared_at',
  'driver',
  'time_zone',
  'ended_at',
  'rules',
  'standard_until',
] as const

/** Exactly the link-0 fields a share link carries. */
export const SHARE_BUNDLE_KEYS = ['canonical_payload', 'signature_base64', 'signed_at', 'key_alias'] as const

export type ShareDecodeError = 'malformed' | 'version' | 'too_large'

export type ShareDecode = { ok: true; payload: SharePayload } | { ok: false; error: ShareDecodeError }

/** The message a screen shows for each reason a link can't be opened. */
export const SHARE_DECODE_ERROR_KEYS: Readonly<Record<ShareDecodeError, string>> = {
  malformed: 'share.unreadable',
  version: 'share.newerVersion',
  too_large: 'share.unreadable',
}

export type ShareBuildError = 'unsigned' | 'too_large'

export type ShareBuild = { ok: true; token: string; payload: SharePayload } | { ok: false; error: ShareBuildError }

// ─── Small validators ─────────────────────────────────────────────────────

/** A time as ISO UTC, or null when it isn't one. Accepts any parseable time up to 40 characters. */
export function shareTime(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** An IANA zone name the browser knows, or null. */
export function shareTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return null
  if (!/^[A-Za-z0-9_+\-/]+$/.test(value)) return null
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: value })
    return value
  } catch {
    return null
  }
}

function deviceTimeZone(): string | null {
  try {
    return shareTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  } catch {
    return null
  }
}

/** The four link-0 fields, each a non-empty string, or null. Any other field is dropped. */
function shareBundleOf(value: unknown): ShareBundle | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const b = value as Record<string, unknown>
  if (!SHARE_BUNDLE_KEYS.every((k) => typeof b[k] === 'string' && (b[k] as string).length > 0)) return null
  return {
    canonical_payload: b.canonical_payload as string,
    signature_base64: b.signature_base64 as string,
    signed_at: b.signed_at as string,
    key_alias: b.key_alias as string,
  }
}

/**
 * The extras as a receiver may use them: each one shaped (control and
 * bidi characters removed, lengths capped, times and zones checked) or
 * null. Also used on a stored copy's snapshot.
 */
export function shareExtrasOf(value: unknown): ShareExtras {
  const o = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    driver: fitText(o.driver, CAPS.driverName),
    time_zone: shareTimeZone(o.time_zone),
    ended_at: shareTime(o.ended_at),
    rules: fitText(o.rules, SHARE_RULES_MAX),
    standard_until: shareTime(o.standard_until),
  }
}

// ─── Building a link ──────────────────────────────────────────────────────

/**
 * The sign's standard limit to share when the park was permit-adjusted.
 * Null otherwise. The permit itself (its type, area, holder answer and the
 * permit's own later time) is never shared.
 *
 * T4's records keep `expires_at`, which link 0 signs, as the sign's
 * standard limit, and put a permit exception's later time in
 * `permit_context.permit_until`. Such a park is permit-adjusted exactly
 * when T4's `permitAdjustedUntil` says so (the sign prints an exception
 * for the permit the driver confirmed, the holder isn't absent, and the
 * permit time is later than the standard limit): the standard limit then
 * equals the signed limit. A record whose own limit isn't its permit
 * context's `standard_until` (a sign exception gave the permit more time
 * in the signed limit itself) is permit-adjusted too.
 */
export function permitAdjustedStandardUntil(session: ParkingSession): string | null {
  const standard = shareTime(session.permit_context?.standard_until)
  if (permitAdjustedUntil(session) !== null) return standard ?? shareTime(session.expires_at)
  if (!standard) return null
  return standard === shareTime(session.expires_at) ? null : standard
}

export interface BuildShareOptions {
  /** When the link is made; defaults to now. */
  now?: Date
  /**
   * The driver to name instead of the record's `driver_name` (the handover
   * flow can name the person the car was handed to). Omit to use the record's.
   */
  driver?: string | null
}

/**
 * The JSON a share link carries for a record, or null when its arrival
 * (link 0) isn't signed yet: a link needs the signed bundle.
 */
export function buildSharePayload(session: ParkingSession, options: BuildShareOptions = {}): SharePayload | null {
  if (!isCompleteBundle(session.signature)) return null
  const sig = session.signature
  const now = options.now ?? new Date()
  const zone = session.location ? timezoneForCoords(session.location.lat, session.location.lng) : deviceTimeZone()
  return {
    bundle: {
      canonical_payload: sig.canonical_payload,
      signature_base64: sig.signature_base64,
      signed_at: sig.signed_at,
      key_alias: sig.key_alias,
    },
    shared_at: now.toISOString(),
    driver: fitText(options.driver !== undefined ? options.driver : session.driver_name, CAPS.driverName),
    time_zone: shareTimeZone(zone),
    ended_at: shareTime(session.ended_at),
    rules: session.no_sign ? null : fitText(session.rules, SHARE_RULES_MAX),
    standard_until: permitAdjustedStandardUntil(session),
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

/** The token after `#share=`: "1." and the base64url of the JSON's UTF-8, uncompressed. */
export function encodeShareToken(payload: SharePayload): string {
  // A fresh object, so the JSON has exactly these keys in this order.
  const json = JSON.stringify({
    bundle: {
      canonical_payload: payload.bundle.canonical_payload,
      signature_base64: payload.bundle.signature_base64,
      signed_at: payload.bundle.signed_at,
      key_alias: payload.bundle.key_alias,
    },
    shared_at: payload.shared_at,
    driver: payload.driver,
    time_zone: payload.time_zone,
    ended_at: payload.ended_at,
    rules: payload.rules,
    standard_until: payload.standard_until,
  })
  return `${SHARE_LINK_VERSION}.${base64UrlEncode(new TextEncoder().encode(json))}`
}

/**
 * The share token for a record: refused when link 0 isn't signed yet
 * ('unsigned') or the token would be over SHARE_LINK_MAX_BYTES ('too_large').
 */
export function makeShareToken(session: ParkingSession, options: BuildShareOptions = {}): ShareBuild {
  const payload = buildSharePayload(session, options)
  if (!payload) return { ok: false, error: 'unsigned' }
  const token = encodeShareToken(payload)
  if (token.length > SHARE_LINK_MAX_BYTES) return { ok: false, error: 'too_large' }
  return { ok: true, token, payload }
}

// ─── Reading a link ───────────────────────────────────────────────────────

/**
 * Read the token after `#share=`. Checked in this order: the version
 * prefix (anything but "1." is 'version' when it is a number, 'malformed'
 * otherwise), the size (over 16 KB is 'too_large'), then the base64url,
 * UTF-8 and JSON, and the shape: the four link-0 fields as non-empty
 * strings and `shared_at` as a time. The extras are shaped as
 * `shareExtrasOf` does; unknown keys are dropped. Nothing here says the
 * bundle is genuine: the caller verifies it.
 */
export function decodeShareToken(token: unknown): ShareDecode {
  if (typeof token !== 'string') return { ok: false, error: 'malformed' }
  const prefix = /^(\d{1,9})\./.exec(token)
  if (!prefix) return { ok: false, error: 'malformed' }
  if (prefix[1] !== SHARE_LINK_VERSION) return { ok: false, error: 'version' }
  if (token.length > SHARE_LINK_MAX_BYTES) return { ok: false, error: 'too_large' }
  const body = token.slice(prefix[0].length)
  if (!/^[A-Za-z0-9_-]+$/.test(body)) return { ok: false, error: 'malformed' }
  const bytes = base64UrlDecode(body)
  if (!bytes) return { ok: false, error: 'malformed' }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return { ok: false, error: 'malformed' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'malformed' }
  const o = parsed as Record<string, unknown>
  const bundle = shareBundleOf(o.bundle)
  const shared_at = shareTime(o.shared_at)
  if (!bundle || !shared_at) return { ok: false, error: 'malformed' }
  return { ok: true, payload: { bundle, shared_at, ...shareExtrasOf(o) } }
}
