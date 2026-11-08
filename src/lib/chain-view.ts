// What the record screen shows about a record's evidence chain (build spec
// T1a): the chain panel's rows before "Check signatures" runs, the
// departure row, and the key maps that turn code values (link kinds, photo
// roles, check outcomes) into copy. Pure: no storage, no network, no clock
// (callers pass the time and this device's signing state in).
//
// Signed facts come from the signed payload (N2): a signing time is the
// payload's `signed_at`, a departure's tap time and distance are the signed
// departure data's. Values not signed yet come from the stored record and
// sit under "Not signed yet".
import type { AddendumKind, DepartureData, ParkingSession, PhotoRole, SignatureBundle, SignedAddendum } from '../types'
import { DEPARTURE_CATCH_UP_GRACE_MS, DEV_KEY_ALIAS, chainKeyForAddenda, needsDepartureCatchUp } from './evidence-chain'
import type { RecordVerification } from './verify'

export type ChainLinkKind = 'arrival' | AddendumKind

/** A link's state as stored, before any check: signed (ParkProof's key or a development key), pending or refused. */
export type StoredLinkState = 'signed' | 'dev_key' | 'pending' | 'rejected'

export interface ChainRow {
  /** Stable React key. */
  key: string
  /** 0 for the arrival bundle, the stored seq for an addendum. */
  seq: number
  kind: ChainLinkKind
  addendum_id: string | null
  state: StoredLinkState
  /** ParkProof's signing time, from the signed payload. Null unless signed. */
  signed_at: string | null
  /**
   * Another signed link (ParkProof's key or a development key) is stored at
   * the same seq: two devices each added a part there ("Added from two
   * devices"). Only signed rows are ever forked.
   */
  forked: boolean
}

function parsePayload(bundle: SignatureBundle | null | undefined): Record<string, unknown> | null {
  if (!bundle || typeof bundle.canonical_payload !== 'string') return null
  try {
    const p = JSON.parse(bundle.canonical_payload)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const hasBundle = (a: SignedAddendum): boolean => a.bundle !== undefined && a.bundle !== null

/** The signing time a bundle's payload carries (the envelope's when the payload can't be read). */
export function signedTimeOf(bundle: SignatureBundle): string | null {
  const p = parsePayload(bundle)
  if (p && typeof p.signed_at === 'string') return p.signed_at
  return typeof bundle.signed_at === 'string' ? bundle.signed_at : null
}

function signedState(bundle: SignatureBundle): StoredLinkState {
  return bundle.key_alias === DEV_KEY_ALIAS ? 'dev_key' : 'signed'
}

const STATE_ORDER: Record<StoredLinkState, number> = { signed: 0, dev_key: 0, rejected: 1, pending: 2 }

/**
 * The chain panel's rows as stored: link 0 (the arrival bundle; a shared
 * copy's is the sender's), then each addendum by seq, signed before refused
 * before pending at one seq. A pending or refused copy of an addendum that
 * is also stored signed (a sync merge can leave both) is left out, and so
 * is a second copy of the same signed link. Same order as `verifyRecord`.
 */
export function chainRows(session: ParkingSession, arrivalRejection: string | null): ChainRow[] {
  const shared = session.shared_from ?? null
  const linkZero = shared ? shared.arrival_bundle : session.signature ?? null
  const rows: ChainRow[] = [
    {
      key: 'link-0',
      seq: 0,
      kind: 'arrival',
      addendum_id: null,
      state: linkZero ? signedState(linkZero) : !shared && arrivalRejection ? 'rejected' : 'pending',
      signed_at: linkZero ? signedTimeOf(linkZero) : null,
      forked: false,
    },
  ]
  if (shared) return rows

  const addenda = (Array.isArray(session.addenda) ? session.addenda : []).filter(
    (a): a is SignedAddendum => !!a && typeof a === 'object' && typeof a.id === 'string',
  )
  const signedIds = new Set(addenda.filter(hasBundle).map((a) => a.id))
  const seen = new Set<string>()
  const entries: Array<{ row: ChainRow; sortAt: string }> = []
  for (const a of addenda) {
    if (!hasBundle(a) && signedIds.has(a.id)) continue
    const bundle = hasBundle(a) ? (a.bundle as SignatureBundle) : null
    const dupKey = bundle ? `${a.id}\u0000${bundle.signature_base64}` : `${a.id}\u0000${a.rejected ? 'r' : 'p'}`
    if (seen.has(dupKey)) continue
    seen.add(dupKey)
    const state: StoredLinkState = bundle ? signedState(bundle) : a.rejected ? 'rejected' : 'pending'
    const signed_at = bundle ? signedTimeOf(bundle) : null
    entries.push({
      row: {
        key: `${a.id}:${entries.length}`,
        seq: Number.isInteger(a.seq) ? a.seq : 0,
        kind: a.kind,
        addendum_id: a.id,
        state,
        signed_at,
        forked: false,
      },
      sortAt: signed_at ?? (typeof a.captured_at === 'string' ? a.captured_at : ''),
    })
  }
  // Forks, as the verifier reports them after a check: two signed links at one seq.
  const signedAtSeq = new Map<number, number>()
  for (const { row } of entries) {
    if (isSignedState(row.state)) signedAtSeq.set(row.seq, (signedAtSeq.get(row.seq) ?? 0) + 1)
  }
  for (const entry of entries) {
    if (isSignedState(entry.row.state) && (signedAtSeq.get(entry.row.seq) ?? 0) > 1) {
      entry.row = { ...entry.row, forked: true }
    }
  }
  entries.sort(
    (x, y) =>
      x.row.seq - y.row.seq ||
      STATE_ORDER[x.row.state] - STATE_ORDER[y.row.state] ||
      x.sortAt.localeCompare(y.sortAt) ||
      (x.row.addendum_id ?? '').localeCompare(y.row.addendum_id ?? ''),
  )
  return [...rows, ...entries.map((e) => e.row)]
}

/** Signed with ParkProof's key or a development key. */
export function isSignedState(state: StoredLinkState): state is 'signed' | 'dev_key' {
  return state === 'signed' || state === 'dev_key'
}

/**
 * The chain panel's one-line state while it is collapsed: how many parts
 * are signed (a plural, `count` set), or "Not signed yet" when none are.
 * Development-key parts count as signed parts here; their rows say which key.
 */
export function chainSummary(rows: readonly ChainRow[]): { key: string; count?: number } {
  const signed = rows.filter((r) => isSignedState(r.state)).length
  return signed > 0 ? { key: 'chain.summary', count: signed } : { key: 'verifier.link.pending' }
}

/**
 * A short fingerprint of the stored chain: it changes whenever a link is
 * added, signed, refused or renumbered. The chain panel drops a check
 * result once it no longer describes the stored record.
 */
export function chainFingerprint(session: ParkingSession): string {
  const zero = session.shared_from ? session.shared_from.arrival_bundle : session.signature
  const parts = [zero ? zero.signature_base64 : '-']
  for (const a of Array.isArray(session.addenda) ? session.addenda : []) {
    if (!a) continue
    parts.push(`${a.id}:${a.seq}:${a.bundle ? a.bundle.signature_base64 : a.rejected ? 'r' : 'p'}`)
  }
  return parts.join('|')
}

// ─── The departure row ────────────────────────────────────────────────────

/**
 * The departure's signing state. 'none': there is no departure part and
 * this device will never add one (an old record ended before departures
 * were signed, a chain whose key isn't on this device, or a record ended on
 * another device whose departure hasn't arrived after the grace period).
 * 'pending' is kept for the window right after a tap and for a stored
 * departure part still being signed.
 */
export type DepartureSigning =
  | { state: 'signed'; signed_at: string | null }
  | { state: 'dev_key'; signed_at: string | null }
  | { state: 'pending' }
  | { state: 'rejected' }
  | { state: 'none' }

export interface DepartureSummary {
  /** The phone's time of the I've left tap: the signed one once the departure is signed. */
  tapped_at: string
  signing: DepartureSigning
  /** Metres from the arrival spot to the phone at the tap (signed once signed), or null. */
  distance_from_arrival_m: number | null
  /** The departure fix's accuracy in metres (signed once signed), or null without a location. */
  location_accuracy_m: number | null
  /** Where the phone was at the tap (signed once signed), or null without a location. */
  location: { lat: number; lng: number; accuracy_meters: number | null } | null
}

/** What departureSummary needs to know about this device. */
export interface DepartureContext {
  /** The clock now (ms). Without it, the grace-period rule for 'none' is skipped. */
  now?: number
  /** The driver tapped I've left on this device (`isEndedOnThisDevice`). */
  endedHere?: boolean
}

function departureDataOf(value: unknown): Partial<DepartureData> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<DepartureData>) : null
}

const finiteDistance = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null

function accuracyOf(data: Partial<DepartureData> | null): number | null {
  const location = data?.location
  if (!location || typeof location !== 'object') return null
  return finiteDistance((location as { accuracy_meters?: unknown }).accuracy_meters)
}

/** The departure's phone location, or null when there is none or it can't be read. */
function locationOf(data: Partial<DepartureData> | null): DepartureSummary['location'] {
  const location = data?.location
  if (!location || typeof location !== 'object') return null
  const { lat, lng } = location as { lat?: unknown; lng?: unknown }
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng, accuracy_meters: accuracyOf(data) }
}

/**
 * True when no departure part will ever be added on this device: the chain
 * has a key this device doesn't hold (`saveDeparture` and the catch-up queue
 * nothing then), or the catch-up's grace period is over and the catch-up
 * won't add one (an old record ended before the ended-here mark existed, or
 * a record ended on another device).
 */
function departureNeverAdded(session: ParkingSession, context: DepartureContext): boolean {
  if (chainKeyForAddenda(session) === undefined) return true
  const { now } = context
  if (typeof now !== 'number' || !Number.isFinite(now)) return false
  const endedMs = Date.parse(session.ended_at as string)
  if (!Number.isFinite(endedMs) || now < endedMs + DEPARTURE_CATCH_UP_GRACE_MS) return false
  return !needsDepartureCatchUp(session, now, { endedHere: context.endedHere === true })
}

/**
 * The departure row for an ended record, or null when it hasn't ended.
 * Uses the record's departure addendum: a signed one (the earliest signed,
 * should there be two) gives the signed tap time, location, distance,
 * accuracy and signing time; a refused or pending one gives its stored data. Without
 * one, the record's own `departure` field and `ended_at`: 'pending' while
 * a departure may still be added, 'none' once it won't be.
 */
export function departureSummary(session: ParkingSession, context: DepartureContext = {}): DepartureSummary | null {
  if (typeof session.ended_at !== 'string' || session.ended_at.length === 0) return null
  const departures = (Array.isArray(session.addenda) ? session.addenda : []).filter(
    (a): a is SignedAddendum => !!a && a.kind === 'departure',
  )
  const signed = departures
    .filter(hasBundle)
    .map((a) => ({ a, at: signedTimeOf(a.bundle as SignatureBundle) ?? '' }))
    .sort((x, y) => x.at.localeCompare(y.at))[0]?.a
  const field = departureDataOf(session.departure)
  const fallbackDistance = finiteDistance(field?.distance_from_arrival_m)
  const fallbackAccuracy = accuracyOf(field)
  const fallbackLocation = locationOf(field)

  if (signed) {
    const bundle = signed.bundle as SignatureBundle
    const data = departureDataOf(parsePayload(bundle)?.data)
    const state = signedState(bundle)
    return {
      tapped_at: typeof data?.ended_at === 'string' ? data.ended_at : session.ended_at,
      signing: { state: state === 'dev_key' ? 'dev_key' : 'signed', signed_at: signedTimeOf(bundle) },
      distance_from_arrival_m: data ? finiteDistance(data.distance_from_arrival_m) : fallbackDistance,
      location_accuracy_m: data ? accuracyOf(data) : fallbackAccuracy,
      location: data ? locationOf(data) : fallbackLocation,
    }
  }
  // A pending departure is still on its way; only when every one was refused is it "couldn't be signed".
  const stored = departures.find((a) => !a.rejected) ?? departures[0] ?? null
  const data = departureDataOf(stored?.data)
  const allRefused = departures.length > 0 && departures.every((a) => !!a.rejected)
  const signing: DepartureSigning = allRefused
    ? { state: 'rejected' }
    : departures.length === 0 && departureNeverAdded(session, context)
      ? { state: 'none' }
      : { state: 'pending' }
  return {
    tapped_at: typeof data?.ended_at === 'string' ? data.ended_at : session.ended_at,
    signing,
    distance_from_arrival_m: data ? finiteDistance(data.distance_from_arrival_m) : fallbackDistance,
    location_accuracy_m: data ? accuracyOf(data) : fallbackAccuracy,
    location: data ? locationOf(data) : fallbackLocation,
  }
}

/**
 * How the record's arrival_context (link 1) stands, for screens and PDFs
 * that show a fact it signs (N2), such as the sign's condition (T3).
 * 'none': there is no arrival_context and none will be added on this
 * device (the chain's key isn't here).
 */
export type ArrivalContextSigning = 'signed' | 'dev_key' | 'pending' | 'rejected' | 'none'

export interface ArrivalContextView {
  signing: ArrivalContextSigning
  /**
   * Once signed, the signed data parsed from the payload (the earliest
   * signed copy, should there be two). Otherwise the stored data of a
   * pending or refused arrival_context, or null when there is none.
   */
  data: Record<string, unknown> | null
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function arrivalContextView(session: ParkingSession): ArrivalContextView {
  const contexts = (Array.isArray(session.addenda) ? session.addenda : []).filter(
    (a): a is SignedAddendum => !!a && a.kind === 'arrival_context',
  )
  const signed = contexts
    .filter(hasBundle)
    .map((a) => ({ a, at: signedTimeOf(a.bundle as SignatureBundle) ?? '' }))
    .sort((x, y) => x.at.localeCompare(y.at))[0]?.a
  if (signed) {
    const bundle = signed.bundle as SignatureBundle
    return { signing: signedState(bundle) === 'dev_key' ? 'dev_key' : 'signed', data: objectOrNull(parsePayload(bundle)?.data) }
  }
  if (contexts.length === 0) {
    return { signing: chainKeyForAddenda(session) === undefined ? 'none' : 'pending', data: null }
  }
  const stored = contexts.find((a) => !a.rejected) ?? contexts[0]
  return {
    signing: contexts.every((a) => !!a.rejected) ? 'rejected' : 'pending',
    data: objectOrNull(stored.data),
  }
}

// ─── Copy keys ────────────────────────────────────────────────────────────
// Code values are shown through these maps, never printed raw.

export const CHAIN_KIND_KEYS: Readonly<Record<ChainLinkKind, string>> = {
  arrival: 'chain.kind.arrival',
  arrival_context: 'chain.kind.arrivalContext',
  condition: 'chain.kind.condition',
  compliance: 'chain.kind.compliance',
  departure: 'chain.kind.departure',
  handover: 'chain.kind.handover',
}

const CHAIN_COVERS_KEYS: Readonly<Record<ChainLinkKind, string>> = {
  arrival: 'chain.covers.arrival',
  arrival_context: 'chain.covers.arrivalContext',
  condition: 'chain.covers.condition',
  compliance: 'chain.covers.compliance',
  departure: 'chain.covers.departure',
  handover: 'chain.covers.handover',
}

/** What a link covers. Link 0 of a no-sign record has no sign reading. */
export function chainCoversKey(kind: ChainLinkKind, session: Pick<ParkingSession, 'no_sign'>): string {
  if (kind === 'arrival' && session.no_sign) return 'chain.covers.arrivalNoSign'
  return CHAIN_COVERS_KEYS[kind]
}

/** The stored-state line's key ("Signed by ParkProof at ...", "Not signed yet" ...). */
export const STORED_STATE_KEYS: Readonly<Record<StoredLinkState, string>> = {
  signed: 'chain.signedAt',
  dev_key: 'chain.devKeySignedAt',
  pending: 'verifier.link.pending',
  rejected: 'verifier.link.rejected',
}

export const PHOTO_ROLE_KEYS: Readonly<Record<PhotoRole, string>> = {
  sign: 'chain.photoRole.sign',
  car: 'chain.photoRole.car',
  ambient: 'chain.photoRole.ambient',
  'condition-front': 'chain.photoRole.conditionFront',
  'condition-rear': 'chain.photoRole.conditionRear',
  'condition-left': 'chain.photoRole.conditionLeft',
  'condition-right': 'chain.photoRole.conditionRight',
  'condition-detail': 'chain.photoRole.conditionDetail',
  'return-front': 'chain.photoRole.returnFront',
  'return-rear': 'chain.photoRole.returnRear',
  'return-left': 'chain.photoRole.returnLeft',
  'return-right': 'chain.photoRole.returnRight',
  'return-detail': 'chain.photoRole.returnDetail',
  compliance: 'chain.photoRole.compliance',
}

/**
 * The summary line after "Check signatures". `count` (the number of valid
 * signatures) is set for the all-valid lines, plurals. When a signed photo
 * isn't on this device its bytes were never compared, so the all-valid
 * line says so instead of "Nothing has changed" (N4).
 */
export function checkSummary(
  result: Pick<RecordVerification, 'overall' | 'counts'> & { photos?: RecordVerification['photos'] },
): { key: string; count?: number } {
  switch (result.overall) {
    case 'valid':
      return (result.photos ?? []).some((p) => p.status === 'not_on_device')
        ? { key: 'chain.checkValidPhotosUnchecked', count: result.counts.valid }
        : { key: 'chain.checkValid', count: result.counts.valid }
    case 'problem':
      return { key: 'chain.checkProblem' }
    case 'dev_key':
      return { key: 'chain.checkDevKey' }
    default:
      return { key: 'chain.checkUnsigned' }
  }
}
