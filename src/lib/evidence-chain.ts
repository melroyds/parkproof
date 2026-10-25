// Pure helpers for the evidence chain (build spec N2). No storage, no
// network, no clock: every function takes what it needs, so the ordering
// rules can be unit-tested on their own.
//
// The chain: link 0 is the record's arrival bundle (`signature`). Links
// 1, 2, 3... are addenda. The parent of seq N is the signed link with seq
// N - 1. An addendum is sent for signing only when its parent is signed.
// A rejected addendum (HTTP 400) is never signed, so the pending addenda
// after it are renumbered to close the gap.
import type {
  AddendumKind,
  ArrivalContextData,
  BoundaryStatement,
  DepartureData,
  GateAcks,
  LogDraft,
  ParkingSession,
  PhotoRef,
  RuleFlags,
  SignatureBundle,
  SignedAddendum,
} from '../types'
import {
  ADDENDUM_SCHEMA,
  BOUNDARY_ANSWERS,
  BOUNDARY_ASKED_BECAUSE,
  CAPS,
  COMPLIANCE_TYPES,
  EVIDENCE_V1_SCHEMA,
  EVIDENCE_V2_SCHEMA,
  FORBIDDEN_CHARS_RE,
  HEX64_RE,
  JURISDICTIONS,
  PHOTO_ROLES,
  PHOTO_SOURCES,
  SIGN_STATUSES,
  UUID_RE,
  canonicalize,
  isIsoTime,
} from '../../lambda/addendum-schema.js'

/** Most addenda one record can hold (the cloud row keeps at most this many, T0b4). */
export const MAX_ADDENDA = 20

/** Kinds a record has at most one of, whatever state it is in. */
export const SINGLETON_KINDS: ReadonlySet<AddendumKind> = new Set<AddendumKind>(['arrival_context', 'departure'])

/**
 * How long after `ended_at` the departure catch-up waits before queueing a
 * location-less departure addendum. The departure flow (T1a) waits up to
 * 8 s for a GPS fix and queues its own addendum first; the catch-up only
 * covers a tab that closed before that happened.
 */
export const DEPARTURE_CATCH_UP_GRACE_MS = 30_000

/** Rejection code when the server's signed payload doesn't match what was sent. */
export const ERR_SIGNED_DATA_MISMATCH = 'ERR_SIGNED_DATA_MISMATCH'

/**
 * The `key_alias` of bundles signed by the `npm run dev` signer (the
 * ephemeral local key in vite.config.ts). Such a bundle can't be checked
 * with ParkProof's published key, so screens and PDFs never present it as
 * a ParkProof signature.
 */
export const DEV_KEY_ALIAS = 'dev-ephemeral'

/** A draft with nothing in it yet: what every new scan starts with. */
export function emptyLogDraft(): LogDraft {
  return {
    gate_acks: { meter_ticket: null, permit_zone: null, accessible_permit: null },
    permit_context: null,
    workday: null,
    driver_name: null,
  }
}

const FORBIDDEN_GLOBAL = new RegExp(FORBIDDEN_CHARS_RE.source, 'g')

/**
 * Shape a user- or model-supplied string to fit a signed string field:
 * characters the schema forbids (newlines, tabs, other controls, bidi
 * controls) become spaces, the ends are trimmed, and anything over `max`
 * is cut without splitting a surrogate pair. Empty becomes null. This is
 * how a builder prepares data; the schema itself never repairs.
 */
export function fitText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  let s = value.replace(FORBIDDEN_GLOBAL, ' ').trim()
  if (s.length > max) {
    s = s.slice(0, max)
    const last = s.charCodeAt(s.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1)
    s = s.trimEnd()
  }
  return s.length > 0 ? s : null
}

function oneOf<T extends string>(values: readonly string[], value: unknown): T | null {
  return typeof value === 'string' && values.includes(value) ? (value as T) : null
}

function isPhotoRef(p: unknown): p is PhotoRef {
  if (!p || typeof p !== 'object') return false
  const r = p as Record<string, unknown>
  return (
    oneOf(PHOTO_ROLES, r.role) !== null &&
    typeof r.sha256 === 'string' &&
    HEX64_RE.test(r.sha256) &&
    isIsoTime(r.captured_at) &&
    oneOf(PHOTO_SOURCES, r.source) !== null
  )
}

/** A photo ref as signed: exactly the four PhotoRefData keys. */
function photoRefData(p: PhotoRef): PhotoRef {
  return { role: p.role, sha256: p.sha256, captured_at: p.captured_at, source: p.source }
}

/**
 * The signed rule flags, or null unless all four yes/no flags are real
 * booleans. A partial or garbled object would otherwise sign "no" for facts
 * nobody determined.
 */
function ruleFlagsData(flags: unknown): RuleFlags | null {
  if (!flags || typeof flags !== 'object') return null
  const f = flags as Record<string, unknown>
  if (
    typeof f.requires_ticket !== 'boolean' ||
    typeof f.requires_disabled_permit !== 'boolean' ||
    typeof f.is_permit_zone !== 'boolean' ||
    typeof f.is_area_sign !== 'boolean'
  ) {
    return null
  }
  const methods = Array.isArray(f.payment_methods)
    ? f.payment_methods
        .map((m) => fitText(m, CAPS.paymentMethod))
        .filter((m): m is string => m !== null)
        .slice(0, CAPS.paymentMethods)
    : null
  return {
    requires_ticket: f.requires_ticket,
    payment_methods: methods,
    requires_disabled_permit: f.requires_disabled_permit,
    is_permit_zone: f.is_permit_zone,
    permit_area: fitText(f.permit_area, CAPS.permitArea),
    is_area_sign: f.is_area_sign,
  }
}

function gateAcksData(acks: unknown): GateAcks | null {
  if (!acks || typeof acks !== 'object') return null
  const a = acks as Record<string, unknown>
  const pick = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
  const out: GateAcks = {
    meter_ticket: pick(a.meter_ticket),
    permit_zone: pick(a.permit_zone),
    accessible_permit: pick(a.accessible_permit),
  }
  // No gate was asked: say so with null rather than three nulls.
  return out.meter_ticket === null && out.permit_zone === null && out.accessible_permit === null ? null : out
}

function boundaryData(boundary: unknown): BoundaryStatement | null {
  if (!boundary || typeof boundary !== 'object') return null
  const b = boundary as Record<string, unknown>
  const previous = fitText(b.previous_session_id, CAPS.previousSessionId)
  const answer = oneOf<BoundaryStatement['answer']>(BOUNDARY_ANSWERS, b.answer)
  if (previous === null || answer === null) return null
  const asked = Array.isArray(b.asked_because)
    ? b.asked_because
        .map((x) => oneOf<BoundaryStatement['asked_because'][number]>(BOUNDARY_ASKED_BECAUSE, x))
        .filter((x): x is BoundaryStatement['asked_because'][number] => x !== null)
        .slice(0, CAPS.askedBecause)
    : []
  const d = b.distance_from_previous_m
  return {
    previous_session_id: previous,
    asked_because: asked,
    answer,
    distance_from_previous_m: typeof d === 'number' && Number.isFinite(d) && d >= 0 ? d : null,
  }
}

/**
 * The `arrival_context` data for a new record: link 1, queued right after
 * the record is saved and before link 0 is signed. It carries the facts
 * captured at parking. Fields no task fills in yet are null (or []). Pure,
 * and the result always passes `normalizeAddendumData('arrival_context',
 * ...)`: values that don't fit the schema are left out rather than failing
 * link 1.
 *
 * The saved record is the source of truth: whenever it has a field at all,
 * null included, that value is signed, and the logging draft is used only
 * for fields the record doesn't have. So a driver who clears a prefilled
 * "Who's driving?" signs null, not the settings default. The workday is
 * taken as a unit: the record's `workday_id` and `leg_index` when the record
 * has `workday_id`, otherwise the draft's workday.
 *
 * `permit_commitment` is computed by the caller (it needs SubtleCrypto; see
 * `permitCommitment` in signing.ts) and passed in `extras`.
 */
export function buildArrivalContext(
  session: ParkingSession,
  draft: LogDraft,
  extras: { permit_commitment?: string | null } = {},
): ArrivalContextData {
  const workdayFromRecord = session.workday_id !== undefined
  const workdayId = workdayFromRecord ? session.workday_id ?? null : draft.workday?.workday_id ?? null
  const legIndex = workdayFromRecord ? session.leg_index ?? null : draft.workday?.leg_index ?? null
  const driverName = session.driver_name !== undefined ? session.driver_name : draft.driver_name
  const gateAcks = session.gate_acks !== undefined ? session.gate_acks : draft.gate_acks
  const workday =
    typeof workdayId === 'string' &&
    UUID_RE.test(workdayId) &&
    Number.isInteger(legIndex) &&
    (legIndex as number) >= 0 &&
    (legIndex as number) <= CAPS.legIndexMax
      ? {
          workday_id: workdayId,
          leg_index: legIndex as number,
          stretch_deadline: isIsoTime(session.stretch_deadline) ? session.stretch_deadline : null,
          // Filled at sign time by the workday flow (T6b).
          previous_departure_payload_sha256: null,
        }
      : null

  const commitment = extras.permit_commitment
  return {
    driver_name: fitText(driverName, CAPS.driverName),
    sign_status: oneOf(SIGN_STATUSES, session.sign_status),
    sign_issues: (Array.isArray(session.sign_issues) ? session.sign_issues : [])
      .map((s) => fitText(s, CAPS.signIssue))
      .filter((s): s is string => s !== null)
      .slice(0, CAPS.signIssues),
    rule_flags: ruleFlagsData(session.rule_flags),
    gate_acks: gateAcksData(gateAcks),
    permit_commitment: typeof commitment === 'string' && HEX64_RE.test(commitment) ? commitment : null,
    // Photos captured at parking. Return photos belong to the departure.
    photos: (Array.isArray(session.photos) ? session.photos : [])
      .filter(isPhotoRef)
      .filter((p) => !p.role.startsWith('return-'))
      .slice(0, CAPS.arrivalPhotos)
      .map(photoRefData),
    condition_note: fitText(session.condition_note, CAPS.note),
    compliance_type: oneOf(COMPLIANCE_TYPES, session.compliance_type),
    jurisdiction: oneOf(JURISDICTIONS, session.jurisdiction),
    workday,
    boundary: boundaryData(session.boundary),
  }
}

const isPending = (a: SignedAddendum): boolean => !a.bundle && !a.rejected

/**
 * The seq a new addendum gets: one more than the highest seq that isn't
 * rejected (link 0 counts as 0). Read from storage, never from a caller.
 */
export function nextAddendumSeq(addenda: readonly SignedAddendum[] | undefined): number {
  let top = 0
  for (const a of addenda ?? []) if (!a.rejected && a.seq > top) top = a.seq
  return top + 1
}

const byQueueOrder = (a: SignedAddendum, b: SignedAddendum): number =>
  a.seq - b.seq || a.captured_at.localeCompare(b.captured_at) || a.id.localeCompare(b.id)

/**
 * Renumber the pending addenda so they follow the highest signed link
 * without gaps, keeping their order. Run after a rejection: if seq 2 is
 * rejected, pending 3 and 4 become 2 and 3, so the next one to sign has a
 * signed parent. Signed and rejected entries keep their seq. Returns a new
 * array in the original storage order.
 */
export function compactPendingSeqs(addenda: readonly SignedAddendum[]): SignedAddendum[] {
  let top = 0
  for (const a of addenda) if (a.bundle && a.seq > top) top = a.seq
  const pending = addenda.filter(isPending).sort(byQueueOrder)
  const newSeq = new Map(pending.map((a, i) => [a.id, top + 1 + i]))
  return addenda.map((a) => (newSeq.has(a.id) && newSeq.get(a.id) !== a.seq ? { ...a, seq: newSeq.get(a.id)! } : a))
}

/** The pending addendum to sign next (lowest seq), or null. */
export function nextPendingAddendum(session: ParkingSession): SignedAddendum | null {
  const pending = (session.addenda ?? []).filter(isPending).sort(byQueueOrder)
  return pending[0] ?? null
}

export function hasPendingAddenda(session: ParkingSession): boolean {
  return (session.addenda ?? []).some(isPending)
}

/**
 * The signed parent of the link at `seq`: link 0 for seq 1, otherwise the
 * signed addendum at seq - 1 (the earliest signed, should two devices both
 * have signed one). Null while the parent isn't signed.
 */
export function parentBundleFor(session: ParkingSession, seq: number): SignatureBundle | null {
  if (seq === 1) return session.signature ?? null
  const candidates = (session.addenda ?? [])
    .filter((a) => a.bundle && a.seq === seq - 1)
    .sort((a, b) => a.bundle!.signed_at.localeCompare(b.bundle!.signed_at))
  return candidates[0]?.bundle ?? null
}

function parsePayload(bundle: SignatureBundle): Record<string, unknown> | null {
  try {
    const p = JSON.parse(bundle.canonical_payload)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The schema of a record's link 0, or null when it isn't signed or can't be read. */
export function linkZeroSchema(session: ParkingSession): string | null {
  if (!session.signature) return null
  const p = parsePayload(session.signature)
  return typeof p?.schema === 'string' ? p.schema : null
}

/**
 * What an addendum request sends as `chain_key`: the record's key when its
 * link 0 is a v2 bundle, null for a v1 chain. `undefined` means the chain
 * has a key this device doesn't hold, so addenda can't be signed here.
 */
export function chainKeyForAddenda(session: ParkingSession): string | null | undefined {
  const schema = linkZeroSchema(session)
  if (schema === EVIDENCE_V2_SCHEMA) return session.chain_key ? session.chain_key : undefined
  return null
}

/**
 * True when a record has `ended_at` but no departure addendum (in any
 * state), the grace period has passed, and this device is the one that
 * should add it. Shared copies never qualify. Neither does:
 *   - a v2 chain whose chain key isn't on this device (a pulled cloud
 *     copy): its departure could never be signed here, and would stay
 *     pending forever;
 *   - a record without a chain key (saved before the chain, or a v1 copy
 *     pulled from the cloud) unless `device.endedHere`: the departure
 *     belongs to the device where the driver tapped I've left, and a copy
 *     elsewhere adding its own would fork the chain.
 */
export function needsDepartureCatchUp(
  session: ParkingSession,
  now: number,
  device: { endedHere?: boolean } = {},
): boolean {
  if (session.shared_from || !isIsoTime(session.ended_at)) return false
  if ((session.addenda ?? []).some((a) => a.kind === 'departure')) return false
  if (chainKeyForAddenda(session) === undefined) return false
  if (!session.chain_key && device.endedHere !== true) return false
  return Date.parse(session.ended_at) + DEPARTURE_CATCH_UP_GRACE_MS <= now
}

/** The departure catch-up's data: the tap time, no location, no photos. */
export function departureCatchUpData(session: ParkingSession): DepartureData {
  return {
    ended_at: session.ended_at as string,
    location: null,
    distance_from_arrival_m: null,
    return_photos: [],
  }
}

export type BundleCheck = { ok: true } | { ok: false; code: string }

/** The link-0 fields a request commits to (what checkArrivalBundle compares). */
export interface ArrivalRequestFields {
  schema?: string
  session_id: string
  sign_photo_sha256: string | null
  ambient_photo_sha256: string | null
  car_photo_sha256: string | null
  chain_key_sha256?: string
}

/** Does the returned link-0 bundle sign what was asked for? */
export function checkArrivalBundle(request: ArrivalRequestFields, bundle: SignatureBundle): BundleCheck {
  const p = parsePayload(bundle)
  const schema = request.schema ?? EVIDENCE_V1_SCHEMA
  const same =
    !!p &&
    bundle.schema === schema &&
    p.schema === schema &&
    p.session_id === request.session_id &&
    p.sign_photo_sha256 === request.sign_photo_sha256 &&
    p.ambient_photo_sha256 === request.ambient_photo_sha256 &&
    p.car_photo_sha256 === request.car_photo_sha256 &&
    (schema !== EVIDENCE_V2_SCHEMA || p.chain_key_sha256 === request.chain_key_sha256) &&
    typeof bundle.signature_base64 === 'string' &&
    bundle.signature_base64.length > 0
  return same ? { ok: true } : { ok: false, code: ERR_SIGNED_DATA_MISMATCH }
}

/**
 * The chain key hash a link carries forward: null for a v1 link 0, the
 * payload's `chain_key_sha256` otherwise. Undefined when unreadable.
 */
export function chainKeyHashOf(bundle: SignatureBundle): string | null | undefined {
  const p = parsePayload(bundle)
  if (!p) return undefined
  if (p.schema === EVIDENCE_V1_SCHEMA) return null
  const h = p.chain_key_sha256
  return typeof h === 'string' ? h : h === null ? null : undefined
}

/**
 * Does the returned addendum bundle sign exactly the stored addendum on
 * top of this parent? Compares every identifying field, the parent hash,
 * the chain key hash carried forward from the parent, and
 * `canonicalize(stored data) === canonicalize(signed data)`, so what is
 * stored is what was signed.
 */
export function checkAddendumBundle(
  addendum: SignedAddendum,
  sessionId: string,
  parent: SignatureBundle,
  parentPayloadSha256: string,
  bundle: SignatureBundle,
): BundleCheck {
  const p = parsePayload(bundle)
  const expectedChainHash = chainKeyHashOf(parent)
  const same =
    !!p &&
    expectedChainHash !== undefined &&
    (p.chain_key_sha256 ?? null) === expectedChainHash &&
    bundle.schema === ADDENDUM_SCHEMA &&
    p.schema === ADDENDUM_SCHEMA &&
    p.addendum_id === addendum.id &&
    p.kind === addendum.kind &&
    p.session_id === sessionId &&
    p.seq === addendum.seq &&
    p.captured_at === addendum.captured_at &&
    p.parent_payload_sha256 === parentPayloadSha256 &&
    p.data !== undefined &&
    canonicalize(p.data) === canonicalize(addendum.data) &&
    typeof bundle.signature_base64 === 'string' &&
    bundle.signature_base64.length > 0
  return same ? { ok: true } : { ok: false, code: ERR_SIGNED_DATA_MISMATCH }
}

/** The addendum id and seq a bundle signs, or null when unreadable. */
export function signedAddendumIdentity(bundle: SignatureBundle): { addendum_id: unknown; seq: unknown } | null {
  const p = parsePayload(bundle)
  return p ? { addendum_id: p.addendum_id, seq: p.seq } : null
}
