// The evidence file (build spec T2, item 9): one JSON file per record that
// lets anyone check the record without ParkProof. It carries every signed
// link's canonical payload (as text and as base64 of its exact UTF-8
// bytes) and signature, and the original bytes of every signed photo in
// base64, so a reader can re-hash each photo and compare it with the
// fingerprint inside a signed payload. The /verify pages show the
// commands.
//
// What it never carries: the chain key (secret; the payloads carry only
// its hash), and the permit details (N3) unless the driver ticks "Include
// permit details". The same tick covers the bytes of a proof photo marked
// as a displayed permit (an accessible permit is health information): its
// fingerprint is always listed, its bytes only when ticked. Pending and
// refused parts have no signature; they are listed by kind only, so a
// reader knows the record has parts that aren't signed yet.
import type { ParkingSession, PermitContext, PhotoRole } from '../types'
import { HEX64_RE, PHOTO_ROLES, canonicalize } from '../../lambda/addendum-schema.js'
import { chainRows, isSignedState, type ChainLinkKind } from './chain-view'
import { permitPhotoHashes } from './evidence-photos'
import { decodeDataUrl, sha256HexBytes } from './hash'
import { getPhotoBytes } from './photo-store'
import { fetchRemotePhoto, isLegacyPhotoRole, legacyPhotoValue, type LegacyPhotoRole } from './session-photos'
import { base64Utf8, signedLinks } from './signed-links'

export const EVIDENCE_FILE_FORMAT = 'parkproof-evidence-file-v1'
export const PUBLIC_KEY_URL = 'https://www.parkproof.com.au/parkproof-public-key.pem'
export const VERIFY_PAGE_URL = 'https://www.parkproof.com.au/verify/'
/**
 * What a signature shows and doesn't, said in the file itself (copy rules:
 * wherever signed material is presented). Fixed English, like the field
 * names; the same claims as the PDF's pdf.signature.intro.
 */
export const ABOUT_SIGNATURES =
  "Each link was signed by ParkProof's server when the server received it, at the signed_at time inside that link's payload. " +
  "A valid signature shows the signed details and photo fingerprints haven't changed since then. " +
  "It doesn't show that they are true, who was driving, where the car was, or when it arrived or left. " +
  "Times marked as phone times come from the driver's phone. " +
  'Everything outside the signed payloads, such as sha256, signed_in and bytes under photos, was added when this file was made and is not signed: ' +
  'check each photo against a fingerprint inside a signed payload.'

/** One signed link, exactly as signed. */
export interface EvidenceFileLink {
  /** "0", "1", "2a": the same names as the PDF's signature appendix. */
  name: string
  seq: number
  kind: ChainLinkKind
  schema: string
  key_alias: string
  algorithm: string
  /** ParkProof's signing time (server clock), from the bundle. The payload carries the signed copy. */
  signed_at: string
  /** The exact text that was signed. */
  canonical_payload: string
  /** Base64 of the payload's UTF-8 bytes: decode it to get the signed bytes. */
  canonical_payload_base64: string
  /** The DER signature, base64. */
  signature_base64: string
  /** The links one of which must be this link's parent: SHA-256 of its payload = parent_payload_sha256 here. */
  parents: string[]
}

/** Where a photo's fingerprint is signed. */
export interface PhotoSignedIn {
  link: string
  /** The payload field that carries it: 'sign_photo_sha256' (link 0), or 'data.photos', 'data.photo', 'data.return_photos'. */
  field: string
}

/**
 * 'withheld_permit': a proof photo marked as a displayed permit, left out
 * because the driver didn't tick "Include permit details".
 */
export type PhotoBytesState = 'included' | 'not_on_this_device' | 'differ_from_fingerprint' | 'withheld_permit'

export interface EvidenceFilePhoto {
  /** The fingerprint a signed payload carries (lowercase hex). */
  sha256: string
  role: PhotoRole
  signed_in: PhotoSignedIn[]
  /** 'included' only when the bytes below hash to `sha256`. */
  bytes: PhotoBytesState
  media_type: string | null
  /** The original photo's bytes, base64. Null unless `bytes` is 'included'. */
  bytes_base64: string | null
}

export interface EvidenceFilePermit {
  permit_context: PermitContext
  permit_salt: string
  /** permit_salt followed by the canonical JSON of permit_context. Its SHA-256 is permit_commitment in the signed details. */
  commitment_input: string
  /** The link whose payload carries permit_commitment, or null when none does. */
  signed_in: string | null
}

export interface EvidenceFile {
  format: typeof EVIDENCE_FILE_FORMAT
  record_id: string
  /** When this file was made, by the phone's clock. */
  made_at_phone_clock: string
  public_key_url: string
  how_to_check: string
  /** What a signature shows and what it doesn't (ABOUT_SIGNATURES). */
  about_signatures: string
  links: EvidenceFileLink[]
  /** Parts of the record that aren't signed: waiting to be signed, or refused by the server. */
  parts_not_signed: Array<{ seq: number; kind: ChainLinkKind; state: 'pending' | 'rejected' }>
  photos: EvidenceFilePhoto[]
  /** Only when the driver ticked "Include permit details" (N3). */
  permit: EvidenceFilePermit | null
}

const PHOTO_ROLE_SET: ReadonlySet<string> = new Set(PHOTO_ROLES)
const LINK_ZERO_FIELDS: ReadonlyArray<[PhotoRole, string]> = [
  ['sign', 'sign_photo_sha256'],
  ['car', 'car_photo_sha256'],
  ['ambient', 'ambient_photo_sha256'],
]

function parsePayload(text: string): Record<string, unknown> | null {
  try {
    const p = JSON.parse(text)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const isPhotoData = (p: unknown): p is { role: PhotoRole; sha256: string } =>
  !!p &&
  typeof p === 'object' &&
  PHOTO_ROLE_SET.has((p as { role?: unknown }).role as string) &&
  typeof (p as { sha256?: unknown }).sha256 === 'string' &&
  HEX64_RE.test((p as { sha256: string }).sha256)

/** The photos one signed payload carries, with the field each is in, in payload order. */
export function signedPhotosOfPayload(
  kind: ChainLinkKind,
  payload: Record<string, unknown> | null,
): Array<{ role: PhotoRole; sha256: string; field: string }> {
  if (!payload) return []
  if (kind === 'arrival') {
    return LINK_ZERO_FIELDS.flatMap(([role, field]) => {
      const h = payload[field]
      return typeof h === 'string' && HEX64_RE.test(h) ? [{ role, sha256: h, field }] : []
    })
  }
  const data = payload.data
  if (!data || typeof data !== 'object') return []
  const d = data as Record<string, unknown>
  const out: Array<{ role: PhotoRole; sha256: string; field: string }> = []
  for (const key of ['photos', 'photo', 'return_photos']) {
    const value = d[key]
    for (const p of Array.isArray(value) ? value : [value]) {
      if (isPhotoData(p)) out.push({ role: p.role, sha256: p.sha256, field: `data.${key}` })
    }
  }
  return out
}

/** A photo's bytes as this device holds them. */
export type PhotoBytes = { type: string; bytes: Uint8Array }

export interface BuildEvidenceFileOptions {
  /** The bytes found for each signed fingerprint (by sha256); absent or null when there are none. */
  photoBytes: ReadonlyMap<string, PhotoBytes | null>
  /** "Include permit details" was ticked: the permit details and the bytes of photos of a displayed permit go in. */
  includePermit: boolean
  /** The phone's clock, for made_at_phone_clock. */
  now: number
  /** The server's ERR code when it refused link 0 on this device, or null. */
  arrivalRejection?: string | null
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}

/** The permit reveal (N3), or null when the record has no permit details to reveal. */
function permitPart(session: ParkingSession, links: EvidenceFileLink[]): EvidenceFilePermit | null {
  const context = session.permit_context
  const salt = session.permit_salt
  if (!context || typeof context !== 'object' || typeof salt !== 'string' || !salt) return null
  const commitment_input = salt + canonicalize(context)
  let signed_in: string | null = null
  for (const link of links) {
    if (link.kind !== 'arrival_context') continue
    const data = parsePayload(link.canonical_payload)?.data as Record<string, unknown> | undefined
    if (data && typeof data.permit_commitment === 'string') {
      signed_in = link.name
      break
    }
  }
  return { permit_context: context, permit_salt: salt, commitment_input, signed_in }
}

/**
 * The evidence file for a record (pure). `photoBytes` holds whatever bytes
 * this device found for each signed fingerprint; a photo's bytes go in only
 * when they hash to that fingerprint (checked here), so the file never
 * offers bytes that don't match what was signed.
 */
export async function buildEvidenceFile(session: ParkingSession, options: BuildEvidenceFileOptions): Promise<EvidenceFile> {
  const links: EvidenceFileLink[] = signedLinks(session).map((link) => ({
    name: link.name,
    seq: link.seq,
    kind: link.kind,
    schema: link.bundle.schema,
    key_alias: link.bundle.key_alias,
    algorithm: link.bundle.algorithm,
    signed_at: link.bundle.signed_at,
    canonical_payload: link.bundle.canonical_payload,
    canonical_payload_base64: base64Utf8(link.bundle.canonical_payload),
    signature_base64: link.bundle.signature_base64,
    parents: link.parents,
  }))

  const byHash = new Map<string, { role: PhotoRole; signed_in: PhotoSignedIn[] }>()
  for (const link of links) {
    for (const p of signedPhotosOfPayload(link.kind, parsePayload(link.canonical_payload))) {
      const entry = byHash.get(p.sha256) ?? { role: p.role, signed_in: [] }
      if (!entry.signed_in.some((s) => s.link === link.name && s.field === p.field)) {
        entry.signed_in.push({ link: link.name, field: p.field })
      }
      byHash.set(p.sha256, entry)
    }
  }

  const withheld = options.includePermit ? new Set<string>() : permitPhotoHashes(session)
  const photos: EvidenceFilePhoto[] = []
  for (const [sha256, entry] of byHash) {
    const found = withheld.has(sha256) ? null : options.photoBytes.get(sha256) ?? null
    let state: PhotoBytesState = withheld.has(sha256) ? 'withheld_permit' : 'not_on_this_device'
    if (found) state = (await sha256HexBytes(found.bytes)) === sha256 ? 'included' : 'differ_from_fingerprint'
    photos.push({
      sha256,
      role: entry.role,
      signed_in: entry.signed_in,
      bytes: state,
      media_type: state === 'included' ? found!.type : null,
      bytes_base64: state === 'included' ? bytesToBase64(found!.bytes) : null,
    })
  }

  const parts_not_signed = session.shared_from
    ? []
    : chainRows(session, options.arrivalRejection ?? null)
        .filter((row) => !isSignedState(row.state))
        .map((row) => ({ seq: row.seq, kind: row.kind, state: row.state as 'pending' | 'rejected' }))

  return {
    format: EVIDENCE_FILE_FORMAT,
    record_id: session.id,
    made_at_phone_clock: new Date(options.now).toISOString(),
    public_key_url: PUBLIC_KEY_URL,
    how_to_check: VERIFY_PAGE_URL,
    about_signatures: ABOUT_SIGNATURES,
    links,
    parts_not_signed,
    photos,
    permit: options.includePermit ? permitPart(session, links) : null,
  }
}

/** The fingerprints the evidence file looks for bytes of, with each one's role (the first signed role). */
export function signedPhotoHashes(session: ParkingSession): Array<{ sha256: string; role: PhotoRole }> {
  const seen = new Map<string, PhotoRole>()
  for (const link of signedLinks(session)) {
    for (const p of signedPhotosOfPayload(link.kind, parsePayload(link.bundle.canonical_payload))) {
      if (!seen.has(p.sha256)) seen.set(p.sha256, p.role)
    }
  }
  return [...seen].map(([sha256, role]) => ({ sha256, role }))
}

/** Reads one photo's bytes for the evidence file. Resolves null when this device can't get them. */
export type PhotoBytesReader = (session: ParkingSession, sha256: string, role: PhotoRole) => Promise<PhotoBytes | null>

/**
 * The bytes of a signed photo: the photo store first (content-addressed by
 * the fingerprint), then a sign, car or surroundings photo held in its
 * legacy field (a data URL, or a cloud copy's URL fetched through the API),
 * then the signed-in driver's cloud copy of a stored photo. Never throws.
 */
export const readPhotoBytes: PhotoBytesReader = async (session, sha256, role) => {
  try {
    const stored = await getPhotoBytes(session.id, sha256)
    if (stored) return stored
  } catch (err) {
    console.warn('[evidence-file] could not read a stored photo:', err)
  }
  if (isLegacyPhotoRole(role)) {
    const legacy = await legacyBytes(session, role)
    if (legacy) return legacy
  }
  if (session.shared_from) return null
  const remote = await fetchRemotePhoto(session.id, sha256)
  return remote ? decodeDataUrl(remote) : null
}

async function legacyBytes(session: ParkingSession, role: LegacyPhotoRole): Promise<PhotoBytes | null> {
  const value = legacyPhotoValue(session, role)
  if (!value) return null
  if (value.startsWith('data:')) return decodeDataUrl(value)
  if (!/^https?:/i.test(value) || session.shared_from) return null
  try {
    const { materializePhotoFromCloud } = await import('./sync')
    const dataUrl = await materializePhotoFromCloud(session.id, role)
    return dataUrl ? decodeDataUrl(dataUrl) : null
  } catch (err) {
    console.warn('[evidence-file] could not fetch a photo from the cloud:', err)
    return null
  }
}

export interface CollectEvidenceFileOptions {
  includePermit: boolean
  now?: number
  arrivalRejection?: string | null
  /** Tests inject a reader; the default is `readPhotoBytes`. */
  readBytes?: PhotoBytesReader
}

/** Gather every signed photo's bytes (four at a time), then build the file. */
export async function collectEvidenceFile(session: ParkingSession, options: CollectEvidenceFileOptions): Promise<EvidenceFile> {
  const read = options.readBytes ?? readPhotoBytes
  // A withheld permit photo's bytes aren't read at all.
  const withheld = options.includePermit ? new Set<string>() : permitPhotoHashes(session)
  const wanted = signedPhotoHashes(session).filter((w) => !withheld.has(w.sha256))
  const photoBytes = new Map<string, PhotoBytes | null>()
  for (let i = 0; i < wanted.length; i += 4) {
    const batch = wanted.slice(i, i + 4)
    const found = await Promise.all(batch.map((w) => read(session, w.sha256, w.role).catch(() => null)))
    batch.forEach((w, j) => photoBytes.set(w.sha256, found[j]))
  }
  return buildEvidenceFile(session, {
    photoBytes,
    includePermit: options.includePermit,
    now: options.now ?? Date.now(),
    arrivalRejection: options.arrivalRejection ?? null,
  })
}

/** The file's text: pretty JSON with a final newline. */
export function evidenceFileJson(file: EvidenceFile): string {
  return JSON.stringify(file, null, 2) + '\n'
}

/** The file name: parkproof-evidence- and the start of the record id. */
export function evidenceFileName(sessionId: string): string {
  return `parkproof-evidence-${sessionId.slice(0, 8)}.json`
}

/** Is there anything to put in the file? At least one signed link. */
export function hasEvidenceFile(session: ParkingSession): boolean {
  return signedLinks(session).length > 0
}

/** Does the record hold permit details the driver could choose to include? */
export function hasPermitDetails(session: ParkingSession): boolean {
  return !!session.permit_context && typeof session.permit_salt === 'string' && session.permit_salt.length > 0
}

/** Does the record have a signed proof photo marked as a displayed permit (left out unless the driver ticks)? */
export function hasPermitPhoto(session: ParkingSession): boolean {
  const permit = permitPhotoHashes(session)
  return permit.size > 0 && signedPhotoHashes(session).some((p) => permit.has(p.sha256))
}

/** Save the file through the browser (the same Blob and link pattern as the .ics download). */
export function saveEvidenceFile(file: EvidenceFile): void {
  const blob = new Blob([evidenceFileJson(file)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = evidenceFileName(file.record_id)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
