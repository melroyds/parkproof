// The condition and proof photos of a record (build spec T2), as pure
// helpers: the angle grid's roles, which proof photo the gates call for,
// what the record screen lists, and whether a photo's fingerprint has been
// signed. No storage, no network, no clock.
//
// A photo's role is metadata on its PhotoRef (N1, N4). At parking the
// condition photos (condition-*) and the proof photo (compliance) go into
// the record's `photos` and so into its arrival_context (link 1). Photos
// added after saving are signed as their own condition or compliance
// addendum. Photos taken on the departure sheet (return-*) go into the
// departure addendum's `return_photos`.
//
// Signed facts come from the signed payload (N2): a photo counts as signed
// only when its fingerprint is inside a stored bundle's canonical payload.
import type {
  ComplianceType,
  GateAcks,
  ParkingSession,
  PhotoRef,
  PhotoRole,
  SignatureBundle,
  SignedAddendum,
} from '../types'
import { CAPS, COMPLIANCE_TYPES, HEX64_RE, PHOTO_ROLES, PHOTO_SOURCES, isIsoTime } from '../../lambda/addendum-schema.js'
import { DEV_KEY_ALIAS, MAX_ADDENDA, chainKeyForAddenda } from './evidence-chain'

// ─── The angle grid ──────────────────────────────────────────────────────

export type Angle = 'front' | 'rear' | 'left' | 'right' | 'detail'

/** Grid order: the four sides, then the optional close-up. */
export const ANGLES: readonly Angle[] = ['front', 'rear', 'left', 'right', 'detail']

/** 'condition' at parking and after saving; 'return' on the departure sheet. */
export type GridPhase = 'condition' | 'return'

/** The photo role of one tile, for example 'condition-front' or 'return-detail'. */
export function angleRole(phase: GridPhase, angle: Angle): PhotoRole {
  return `${phase}-${angle}` as PhotoRole
}

/** Every role of a phase's grid, in grid order. */
export function gridRoles(phase: GridPhase): PhotoRole[] {
  return ANGLES.map((angle) => angleRole(phase, angle))
}

/** The tile names, never printed raw. */
export const ANGLE_KEYS: Readonly<Record<Angle, string>> = {
  front: 'photoGrid.front',
  rear: 'photoGrid.rear',
  left: 'photoGrid.left',
  right: 'photoGrid.right',
  detail: 'photoGrid.detail',
}

// ─── Proof of payment or permit ──────────────────────────────────────────

/** Compliance types in picker order. */
export const COMPLIANCE_TYPE_ORDER: readonly ComplianceType[] = [
  'meter_ticket',
  'payment_confirmation',
  'permit_displayed',
  'other',
]

export const COMPLIANCE_TYPE_KEYS: Readonly<Record<ComplianceType, string>> = {
  meter_ticket: 'complianceType.meterTicket',
  payment_confirmation: 'complianceType.paymentConfirmation',
  permit_displayed: 'complianceType.permitDisplayed',
  other: 'complianceType.other',
}

export function isComplianceType(value: unknown): value is ComplianceType {
  return typeof value === 'string' && COMPLIANCE_TYPES.includes(value)
}

/**
 * The types a proof photo can be given. A photo from the photo library can
 * only be a payment confirmation (a screenshot of a parking app): a meter
 * ticket or a permit on the dash is photographed with the camera, now.
 */
export function complianceTypesFor(input: 'camera' | 'library'): readonly ComplianceType[] {
  return input === 'library' ? ['payment_confirmation'] : COMPLIANCE_TYPE_ORDER
}

/**
 * Which picker a proof photo gets: 'library' when it came through the
 * library link, and also when it came through the camera input but is
 * recorded as a library photo (N1: a file more than 2 minutes old, which is
 * what a desktop browser or Android's Files option hands the camera input).
 */
export function proofInputOf(input: 'camera' | 'library', source: PhotoRef['source']): 'camera' | 'library' {
  return input === 'library' || source === 'library' ? 'library' : 'camera'
}

/**
 * The type saved for a stored proof photo: the driver's choice when the
 * photo's source allows it, else payment confirmation (the only type a
 * library photo can have). Null stays null (no type chosen).
 */
export function allowedComplianceType(
  source: PhotoRef['source'],
  chosen: ComplianceType | null,
): ComplianceType | null {
  if (chosen === null) return null
  return complianceTypesFor(source === 'library' ? 'library' : 'camera').includes(chosen) ? chosen : 'payment_confirmation'
}

/** A gate on the result screen that asks for something to be displayed or paid. */
export type ProofGate = 'accessible_permit' | 'permit_zone' | 'meter_ticket'

/** What the proof gates are read from: the sign reading's flags (ParkingRules or a record's rule_flags). */
export interface ProofFlags {
  requires_ticket?: boolean | null
  is_permit_zone?: boolean | null
  requires_disabled_permit?: boolean | null
  /** False when the answer was "you can't park": the result screen asks no gate then. Absent counts as true. */
  can_park_now?: boolean | null
}

/**
 * Which proof gates apply to a park, in the result screen's order (the
 * accessible permit first, then the permit zone, then paying). A gate
 * applies when it was asked (its acknowledgement in the logging draft is
 * not null), or when the sign reading's flags call for it the way the
 * result screen decides to ask (the flag is set and parking is allowed now).
 */
export function proofGates(flags: ProofFlags | null | undefined, acks: GateAcks | null | undefined): ProofGate[] {
  const canPark = flags?.can_park_now !== false
  const asked = (ack: boolean | null | undefined, flag: boolean | null | undefined) =>
    (ack !== null && ack !== undefined) || (!!flag && canPark)
  const out: ProofGate[] = []
  if (asked(acks?.accessible_permit, flags?.requires_disabled_permit)) out.push('accessible_permit')
  if (asked(acks?.permit_zone, flags?.is_permit_zone)) out.push('permit_zone')
  if (asked(acks?.meter_ticket, flags?.requires_ticket)) out.push('meter_ticket')
  return out
}

/** The proof type to preselect for the first gate, or null when no gate applies. */
export function preselectedComplianceType(gates: readonly ProofGate[]): ComplianceType | null {
  const first = gates[0]
  if (!first) return null
  return first === 'meter_ticket' ? 'meter_ticket' : 'permit_displayed'
}

// ─── Photo refs ──────────────────────────────────────────────────────────

export function isPhotoRef(p: unknown): p is PhotoRef {
  if (!p || typeof p !== 'object') return false
  const r = p as Record<string, unknown>
  return (
    typeof r.role === 'string' &&
    PHOTO_ROLES.includes(r.role) &&
    typeof r.sha256 === 'string' &&
    HEX64_RE.test(r.sha256) &&
    isIsoTime(r.captured_at) &&
    typeof r.source === 'string' &&
    PHOTO_SOURCES.includes(r.source)
  )
}

/** A photo ref as signed: exactly the four PhotoRefData keys (the schema rejects any other). */
export function photoRefData(p: PhotoRef): PhotoRef {
  return { role: p.role, sha256: p.sha256, captured_at: p.captured_at, source: p.source }
}

export type EvidenceGroup = 'parking' | 'return' | 'compliance'

/** Which list a role belongs to on the record screen, or null for sign, car and surroundings photos. */
export function evidenceGroupOf(role: PhotoRole): EvidenceGroup | null {
  if (role.startsWith('condition-')) return 'parking'
  if (role.startsWith('return-')) return 'return'
  if (role === 'compliance') return 'compliance'
  return null
}

// ─── Signed payloads ─────────────────────────────────────────────────────

function payloadOf(bundle: SignatureBundle | null | undefined): Record<string, unknown> | null {
  if (!bundle || typeof bundle.canonical_payload !== 'string') return null
  try {
    const p = JSON.parse(bundle.canonical_payload)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const hasBundle = (a: SignedAddendum): boolean => !!a && !!a.bundle

function addendaOf(session: ParkingSession): SignedAddendum[] {
  return (Array.isArray(session.addenda) ? session.addenda : []).filter(
    (a): a is SignedAddendum => !!a && typeof a === 'object' && typeof a.id === 'string',
  )
}

/** Every photo ref inside addendum data (arrival photos, condition photos, the proof photo, return photos). */
export function photoRefsInData(data: unknown): PhotoRef[] {
  if (!data || typeof data !== 'object') return []
  const d = data as Record<string, unknown>
  const out: PhotoRef[] = []
  for (const list of [d.photos, d.return_photos]) {
    if (Array.isArray(list)) for (const p of list) if (isPhotoRef(p)) out.push(p)
  }
  if (isPhotoRef(d.photo)) out.push(d.photo)
  return out
}

/** The data an addendum signs: from its signed payload when signed, else as stored. */
function linkData(a: SignedAddendum): unknown {
  if (hasBundle(a)) return payloadOf(a.bundle)?.data
  return a.data
}

const LINK0_HASH_FIELDS = ['sign_photo_sha256', 'car_photo_sha256', 'ambient_photo_sha256'] as const

/** The photo hashes link 0 commits to: from its payload when signed, else the hashes it will sign. */
function linkZeroHashes(session: ParkingSession): string[] {
  const p = payloadOf(session.signature)
  if (p) {
    return LINK0_HASH_FIELDS.map((f) => p[f]).filter((h): h is string => typeof h === 'string' && HEX64_RE.test(h))
  }
  const v1 = session.v1_hashes
  const fromV1 = v1 ? [v1.sign, v1.car, v1.ambient] : []
  const fromRefs = (Array.isArray(session.photos) ? session.photos : [])
    .filter((r) => isPhotoRef(r) && (r.role === 'sign' || r.role === 'car' || r.role === 'ambient'))
    .map((r) => r.sha256)
  return [...fromV1, ...fromRefs].filter((h): h is string => typeof h === 'string' && HEX64_RE.test(h))
}

/** Where a photo's fingerprint stands: signed (by ParkProof's key or a development key), waiting, refused, or in no part at all. */
export type PhotoSigning =
  | { state: 'signed'; signed_at: string | null }
  | { state: 'dev_key'; signed_at: string | null }
  | { state: 'pending' }
  | { state: 'rejected' }
  | { state: 'unsigned' }

function signedAtOf(bundle: SignatureBundle): string | null {
  const p = payloadOf(bundle)
  if (p && typeof p.signed_at === 'string') return p.signed_at
  return typeof bundle.signed_at === 'string' ? bundle.signed_at : null
}

/**
 * Where a photo's fingerprint stands. Signed when a stored bundle's payload
 * carries it (the earliest such signing time; ParkProof's key before a
 * development key). Otherwise pending when a part that will carry it is
 * waiting to be signed, refused when only refused parts carry it, and
 * 'unsigned' when no part carries it.
 */
export function photoSigning(session: ParkingSession, sha256: string): PhotoSigning {
  const signed: Array<{ dev: boolean; at: string | null }> = []
  let pending = false
  let rejected = false

  if (session.signature) {
    const p = payloadOf(session.signature)
    if (p && LINK0_HASH_FIELDS.some((f) => p[f] === sha256)) {
      signed.push({ dev: session.signature.key_alias === DEV_KEY_ALIAS, at: signedAtOf(session.signature) })
    }
  } else if (!session.shared_from && linkZeroHashes(session).includes(sha256)) {
    pending = true
  }

  for (const a of addendaOf(session)) {
    if (!photoRefsInData(linkData(a)).some((r) => r.sha256 === sha256)) continue
    if (hasBundle(a)) signed.push({ dev: a.bundle!.key_alias === DEV_KEY_ALIAS, at: signedAtOf(a.bundle!) })
    else if (a.rejected) rejected = true
    else pending = true
  }

  const byTime = (x: { at: string | null }, y: { at: string | null }) => (x.at ?? '').localeCompare(y.at ?? '')
  const prod = signed.filter((s) => !s.dev).sort(byTime)[0]
  if (prod) return { state: 'signed', signed_at: prod.at }
  const dev = signed.sort(byTime)[0]
  if (dev) return { state: 'dev_key', signed_at: dev.at }
  if (pending) return { state: 'pending' }
  if (rejected) return { state: 'rejected' }
  return { state: 'unsigned' }
}

/** Is any photo of this record inside a stored signature (ParkProof's key or a development key)? */
export function recordHasSignedPhoto(session: ParkingSession): boolean {
  if (session.shared_from) return false
  const p = payloadOf(session.signature)
  if (p && LINK0_HASH_FIELDS.some((f) => typeof p[f] === 'string' && HEX64_RE.test(p[f] as string))) return true
  return addendaOf(session).some((a) => hasBundle(a) && photoRefsInData(payloadOf(a.bundle)?.data).length > 0)
}

/**
 * Every photo hash the record refers to: its photo refs, the link-0 hashes
 * and every photo inside an addendum. Bytes with one of these hashes must
 * never be deleted while the record exists.
 */
export function referencedPhotoHashes(session: ParkingSession): Set<string> {
  const out = new Set<string>()
  for (const r of Array.isArray(session.photos) ? session.photos : []) {
    if (r && typeof r.sha256 === 'string') out.add(r.sha256)
  }
  for (const h of linkZeroHashes(session)) out.add(h)
  for (const a of addendaOf(session)) {
    for (const r of photoRefsInData(a.data)) out.add(r.sha256)
    if (hasBundle(a)) for (const r of photoRefsInData(payloadOf(a.bundle)?.data)) out.add(r.sha256)
  }
  return out
}

// ─── The record screen's list ────────────────────────────────────────────

export interface EvidencePhoto {
  ref: PhotoRef
  group: EvidenceGroup
  /** For a proof photo: what the driver said it shows (signed value when signed), else null. */
  compliance_type: ComplianceType | null
  signing: PhotoSigning
}

const GROUP_ORDER: Record<EvidenceGroup, number> = { parking: 0, return: 1, compliance: 2 }

function angleIndex(role: PhotoRole): number {
  const angle = role.slice(role.indexOf('-') + 1) as Angle
  const i = ANGLES.indexOf(angle)
  return i === -1 ? ANGLES.length : i
}

/** What the driver said a proof photo shows: the part that carries it (signed data first), else the record's own field. */
function complianceTypeFor(session: ParkingSession, sha256: string): ComplianceType | null {
  const carriers = addendaOf(session)
    .filter((a) => (a.kind === 'compliance' || a.kind === 'arrival_context') && photoRefsInData(linkData(a)).some((r) => r.sha256 === sha256))
    .sort((x, y) => Number(hasBundle(y)) - Number(hasBundle(x)))
  for (const a of carriers) {
    const data = linkData(a) as Record<string, unknown> | undefined
    if (data && isComplianceType(data.compliance_type)) return data.compliance_type
  }
  return isComplianceType(session.compliance_type) ? session.compliance_type : null
}

/**
 * A photo ref as a signed part carries it (same role and fingerprint), so
 * its time and source are shown as signed (N2); else the ref as given.
 */
export function signedPhotoRef(session: ParkingSession, ref: PhotoRef): PhotoRef {
  for (const a of addendaOf(session)) {
    if (!hasBundle(a)) continue
    const signed = photoRefsInData(payloadOf(a.bundle)?.data).find((r) => r.role === ref.role && r.sha256 === ref.sha256)
    if (signed) return photoRefData(signed)
  }
  return ref
}

/**
 * The condition and proof photos the record screen lists: every such photo
 * a part of the record carries or the record's `photos` lists. A photo in a
 * signed part is taken from the signed payload (its time and source are
 * the signed ones, N2); the others from the record's list or the part
 * waiting to be signed. Grouped (when parked, on return, proof), in grid
 * order within a group, then by capture time.
 */
export function evidencePhotos(session: ParkingSession): EvidencePhoto[] {
  const seen = new Set<string>()
  const refs: PhotoRef[] = []
  const take = (r: PhotoRef) => {
    if (evidenceGroupOf(r.role) === null) return
    const key = `${r.role}/${r.sha256}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push(photoRefData(r))
  }
  const addenda = addendaOf(session)
  for (const a of addenda) if (hasBundle(a)) for (const r of photoRefsInData(payloadOf(a.bundle)?.data)) take(r)
  for (const r of Array.isArray(session.photos) ? session.photos : []) if (isPhotoRef(r)) take(r)
  for (const a of addenda) if (!hasBundle(a)) for (const r of photoRefsInData(a.data)) take(r)

  return refs
    .map((ref) => ({
      ref,
      group: evidenceGroupOf(ref.role) as EvidenceGroup,
      compliance_type: ref.role === 'compliance' ? complianceTypeFor(session, ref.sha256) : null,
      signing: photoSigning(session, ref.sha256),
    }))
    .sort(
      (x, y) =>
        GROUP_ORDER[x.group] - GROUP_ORDER[y.group] ||
        angleIndex(x.ref.role) - angleIndex(y.ref.role) ||
        x.ref.captured_at.localeCompare(y.ref.captured_at),
    )
}

/**
 * Where a part of the record stands: signed (by ParkProof's key or a
 * development key), waiting to be signed, refused by the server, or (for a
 * value no part carries) not in any signed part.
 */
export type PartSigning = 'signed' | 'dev_key' | 'pending' | 'rejected' | 'unsigned'

function partSigning(a: SignedAddendum): PartSigning {
  if (hasBundle(a)) return a.bundle!.key_alias === DEV_KEY_ALIAS ? 'dev_key' : 'signed'
  return a.rejected ? 'rejected' : 'pending'
}

export interface ConditionNote {
  when: 'parking' | 'return'
  /** The driver's own words. */
  note: string
  /** Where the part carrying the note stands. Signed text is read from the signed payload. */
  state: PartSigning
}

/**
 * The driver's damage notes: the one written at parking (arrival_context,
 * else the record's own field, which no part carries) and any from
 * condition parts added later. Signed text is read from the signed payload.
 */
export function conditionNotes(session: ParkingSession): ConditionNote[] {
  const out: ConditionNote[] = []
  const arrival = addendaOf(session)
    .filter((a) => a.kind === 'arrival_context')
    .sort((x, y) => Number(hasBundle(y)) - Number(hasBundle(x)))[0]
  const arrivalData = arrival ? (linkData(arrival) as Record<string, unknown> | undefined) : undefined
  const arrivalNote = arrivalData && typeof arrivalData.condition_note === 'string' ? arrivalData.condition_note : null
  if (arrival && arrivalNote) out.push({ when: 'parking', note: arrivalNote, state: partSigning(arrival) })
  else if (!arrival && typeof session.condition_note === 'string' && session.condition_note.trim()) {
    out.push({ when: 'parking', note: session.condition_note.trim(), state: 'unsigned' })
  }
  for (const a of addendaOf(session)) {
    if (a.kind !== 'condition') continue
    const data = linkData(a) as Record<string, unknown> | undefined
    if (!data || typeof data.note !== 'string' || !data.note) continue
    out.push({ when: data.when === 'return' ? 'return' : 'parking', note: data.note, state: partSigning(a) })
  }
  return out
}

/**
 * The proof photos marked as a displayed permit (the signed type first).
 * An accessible permit is health information (N3): the evidence file holds
 * their bytes only when the driver ticks "Include permit details".
 */
export function permitPhotoHashes(session: ParkingSession): Set<string> {
  return new Set(
    evidencePhotos(session)
      .filter((p) => p.group === 'compliance' && p.compliance_type === 'permit_displayed')
      .map((p) => p.ref.sha256),
  )
}

/** The most photos one condition part carries. */
export const CONDITION_PHOTOS_MAX = CAPS.conditionPhotosMax
/** The most return photos the departure part carries. */
export const RETURN_PHOTOS_MAX = CAPS.returnPhotos
/** The longest damage note. */
export const CONDITION_NOTE_MAX = CAPS.note
/**
 * The most photo refs a record may list: the cloud refuses an upload with
 * more (MAX_PHOTO_REFS in lambda/cloud-sync.js; a test keeps them equal),
 * and then the record and every signature added later stop syncing.
 */
export const RECORD_PHOTOS_MAX = 50

const photoCountOf = (session: ParkingSession): number => (Array.isArray(session.photos) ? session.photos.length : 0)
const hasDepartureQueued = (session: ParkingSession): boolean =>
  (session.addenda ?? []).some((a) => a?.kind === 'departure')

/**
 * Can condition or proof photos be added to this record after saving? Only
 * a record of the driver's own that hasn't ended, whose chain this device
 * can extend, and that has room for another part and its photos, with one
 * part and its return photos left over for the departure.
 */
export function canAddEvidence(session: ParkingSession): boolean {
  if (session.shared_from || session.ended_at) return false
  if (chainKeyForAddenda(session) === undefined) return false
  const count = Array.isArray(session.addenda) ? session.addenda.length : 0
  const forDeparture = hasDepartureQueued(session) ? 0 : 1
  if (count >= MAX_ADDENDA - forDeparture) return false
  return photoCountOf(session) + CONDITION_PHOTOS_MAX + forDeparture * RETURN_PHOTOS_MAX <= RECORD_PHOTOS_MAX
}

/**
 * Can the departure sheet offer condition photos for this record? Only
 * when they can be signed: a record of the driver's own whose chain this
 * device can extend, with room for the part that carries them (the
 * departure, or a condition part when the departure is already queued)
 * and for their refs.
 */
export function canTakeReturnPhotos(session: ParkingSession): boolean {
  if (session.shared_from) return false
  if (chainKeyForAddenda(session) === undefined) return false
  const count = Array.isArray(session.addenda) ? session.addenda.length : 0
  if (count >= MAX_ADDENDA) return false
  return photoCountOf(session) + RETURN_PHOTOS_MAX <= RECORD_PHOTOS_MAX
}
