// The browser verifier (build spec T0b3).
//
// Checks a record's evidence chain on this device, with no network call:
//   - every signature, with WebCrypto against ParkProof's published P-256
//     key: `crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key,
//     raw, utf8(canonical_payload))`, over the payload bytes (not a
//     digest). KMS returns DER signatures; WebCrypto wants raw r||s, so
//     `derToRawSignature` converts, strictly (see there);
//   - the chain: each link's schema, session_id and seq, the parent's
//     payload hash, and the chain key hash carried forward from link 0;
//   - forks: two signed links with the same seq ("Added from two devices");
//   - every photo whose bytes are on this device, re-hashed and compared
//     with the fingerprint a signed link carries.
//
// Per link the result is valid, invalid, pending, rejected or dev key; per
// photo matches, differs or not on this device. A development-key link
// (`npm run dev`) is never reported as valid, and a photo whose bytes
// aren't here is never reported as matching.
//
// A valid signature shows only that the signed bytes existed, unchanged,
// by ParkProof's signing time. It doesn't show that what they say is true,
// who was driving, where the car was, or when it arrived or left. Screens
// that show these results must say so (copy rules).
import type { TFunction } from 'i18next'
import type { AddendumKind, ParkingSession, PhotoRole, SignatureBundle, SignedAddendum } from '../types'
import {
  ADDENDUM_KINDS,
  ADDENDUM_SCHEMA,
  EVIDENCE_V1_SCHEMA,
  EVIDENCE_V2_SCHEMA,
  HEX64_RE,
  PHOTO_ROLES,
  canonicalize,
} from '../../lambda/addendum-schema.js'
import { DEV_KEY_ALIAS } from './evidence-chain'
import { hashDataUrlImage, sha256HexBytes, sha256HexUtf8 } from './hash'
import { getPhotoBytes } from './photo-store'
import { isLegacyPhotoRole, legacyPhotoValue, photoRefFor, shortFingerprint } from './session-photos'
import { arrivalSigningRejection } from './signing'

/**
 * ParkProof's published evidence-signing public key: the same key as
 * public/parkproof-public-key.pem and the Lambda's PARKPROOF_PUBLIC_KEY_PEM
 * (verify.test.ts keeps all three equal). Embedded so records can be
 * checked offline.
 */
export const PARKPROOF_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEyJg5vltZqi2tUU+ZMwmjfO/g3H3B
1qS6tXZGe9Iyrnlopiy23AoRQ5JSUnol0YK4w6bSHQdYbLGoub//Xazv1Q==
-----END PUBLIC KEY-----
`

/** The `algorithm` every ParkProof bundle carries (KMS ECDSA_SHA_256). */
export const SIGNATURE_ALGORITHM = 'ECDSA_SHA_256'

const ECDSA_P256 = { name: 'ECDSA', namedCurve: 'P-256' } as const
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

// ─── Errors ──────────────────────────────────────────────────────────────

/** A signature that isn't a well-formed DER ECDSA P-256 signature. */
export class DerSignatureError extends Error {
  constructor(message: string) {
    super(`DER signature: ${message}`)
    this.name = 'DerSignatureError'
  }
}

/**
 * The browser can't run the verifier: no WebCrypto (for example a page
 * served over plain http from a LAN address), or the key wouldn't import.
 * Nothing was checked, so a screen must not show any result.
 */
export class VerifierUnavailableError extends Error {
  constructor(message = 'WebCrypto is not available, so signatures cannot be checked here') {
    super(message)
    this.name = 'VerifierUnavailableError'
  }
}

export function isVerifierUnavailable(err: unknown): err is VerifierUnavailableError {
  return err instanceof VerifierUnavailableError || (err as { name?: unknown } | null)?.name === 'VerifierUnavailableError'
}

function subtleCrypto(): SubtleCrypto {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined
  if (!subtle) throw new VerifierUnavailableError()
  return subtle
}

// ─── DER to raw ──────────────────────────────────────────────────────────

/** One DER INTEGER at `offset`: its value without the sign byte, and where the next element starts. */
function readDerInteger(der: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  if (offset + 2 > der.length) throw new DerSignatureError('truncated')
  if (der[offset] !== 0x02) throw new DerSignatureError('expected an INTEGER')
  const len = der[offset + 1]
  if (len & 0x80) throw new DerSignatureError('long-form integer length')
  if (len === 0) throw new DerSignatureError('empty integer')
  const start = offset + 2
  const end = start + len
  if (end > der.length) throw new DerSignatureError('truncated integer')
  let value = der.subarray(start, end)
  if (value[0] & 0x80) throw new DerSignatureError('negative integer')
  if (value[0] === 0x00) {
    // DER puts one 0x00 in front only when the next byte's top bit is set
    // (so the value reads as positive). Any other leading zero isn't DER.
    if (value.length === 1) throw new DerSignatureError('zero integer')
    if (!(value[1] & 0x80)) throw new DerSignatureError('non-minimal integer')
    value = value.subarray(1)
  }
  if (value.length > 32) throw new DerSignatureError('integer longer than 32 bytes')
  return { value, next: end }
}

/**
 * Convert a DER ECDSA P-256 signature (what KMS, OpenSSL and the Lambda
 * produce) to the 64-byte raw r||s form WebCrypto verifies. Drops the one
 * leading 0x00 DER adds to an integer whose top bit is set, left-pads each
 * integer to 32 bytes, and rejects anything longer.
 *
 * Strict DER, the same rule OpenSSL applies when it verifies: a SEQUENCE of
 * exactly two positive, minimally encoded INTEGERs, short-form lengths, no
 * trailing bytes. Throws DerSignatureError otherwise, so a signature the
 * published `openssl dgst -verify` walkthrough would refuse is refused here
 * too.
 */
export function derToRawSignature(der: Uint8Array): Uint8Array<ArrayBuffer> {
  if (der.length < 8) throw new DerSignatureError('too short')
  if (der[0] !== 0x30) throw new DerSignatureError('expected a SEQUENCE')
  const seqLen = der[1]
  if (seqLen & 0x80) throw new DerSignatureError('long-form sequence length')
  if (seqLen !== der.length - 2) throw new DerSignatureError('sequence length mismatch')
  const r = readDerInteger(der, 2)
  const s = readDerInteger(der, r.next)
  if (s.next !== der.length) throw new DerSignatureError('trailing bytes')
  const raw = new Uint8Array(64)
  raw.set(r.value, 32 - r.value.length)
  raw.set(s.value, 64 - s.value.length)
  return raw
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> | null {
  if (typeof b64 !== 'string' || b64.length === 0 || b64.length % 4 !== 0 || !BASE64_RE.test(b64)) return null
  try {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

// ─── Keys ────────────────────────────────────────────────────────────────

/** The DER SubjectPublicKeyInfo bytes inside a PEM public key. */
export function pemToSpki(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '')
  const bytes = base64ToBytes(body)
  if (!bytes) throw new Error('not a PEM public key')
  return bytes
}

/** Import a PEM P-256 public key for verifying. */
export async function importPublicKeyPem(pem: string): Promise<CryptoKey> {
  return subtleCrypto().importKey('spki', pemToSpki(pem), ECDSA_P256, false, ['verify'])
}

let publishedKey: Promise<CryptoKey> | null = null

/** ParkProof's published key, imported once per page. */
export function parkProofPublicKey(): Promise<CryptoKey> {
  if (!publishedKey) {
    publishedKey = importPublicKeyPem(PARKPROOF_PUBLIC_KEY_PEM).catch((err) => {
      publishedKey = null
      throw isVerifierUnavailable(err) ? err : new VerifierUnavailableError(`could not import the published key: ${err}`)
    })
  }
  return publishedKey
}

/** A key to trust: an imported CryptoKey, or a PEM string. */
export type TrustedKey = CryptoKey | string

async function resolveKeys(keys: readonly TrustedKey[] | undefined): Promise<CryptoKey[]> {
  if (!keys) return [await parkProofPublicKey()]
  return Promise.all(keys.map((k) => (typeof k === 'string' ? importPublicKeyPem(k) : Promise.resolve(k))))
}

/**
 * Does `signatureBase64` (DER) sign `canonicalPayload`'s UTF-8 bytes under
 * any of `keys`? False for a malformed signature. Throws
 * VerifierUnavailableError only when there is no WebCrypto at all.
 */
export async function verifySignature(
  keys: readonly CryptoKey[],
  canonicalPayload: string,
  signatureBase64: string,
): Promise<boolean> {
  const subtle = subtleCrypto()
  const der = base64ToBytes(signatureBase64)
  if (!der || typeof canonicalPayload !== 'string') return false
  let raw: Uint8Array<ArrayBuffer>
  try {
    raw = derToRawSignature(der)
  } catch {
    return false
  }
  const message = new TextEncoder().encode(canonicalPayload)
  for (const key of keys) {
    try {
      if (await subtle.verify(ECDSA_SHA256, key, raw, message)) return true
    } catch {
      /* a key of the wrong type: try the next one */
    }
  }
  return false
}

// ─── Result types ────────────────────────────────────────────────────────

export type LinkStatus = 'valid' | 'invalid' | 'pending' | 'rejected' | 'dev_key'

/** Why a signed link is invalid. More than one can apply. */
export type LinkProblem =
  /** The bundle, or its canonical payload, can't be read. */
  | 'unreadable'
  /** The wrong schema for its place in the chain, or the bundle and its payload disagree on it. */
  | 'schema'
  /** The payload signs a different record. */
  | 'session_id'
  /** The payload's seq isn't a whole number from 1. */
  | 'seq'
  /** The stored addendum (id, kind, seq, capture time, data) isn't the one its bundle signs. */
  | 'entry_mismatch'
  /** The bundle's `signed_at` isn't the signed one. */
  | 'signed_at'
  /** Not an ECDSA_SHA_256 bundle. */
  | 'algorithm'
  /** No signed link at seq - 1 on this device, so the chain can't be followed. */
  | 'parent_missing'
  /** No signed link at seq - 1 has the payload hash this link commits to. */
  | 'parent_hash'
  /** The chain key hash isn't the one carried forward from link 0. */
  | 'chain_key'
  /** The signature doesn't verify with ParkProof's published key. */
  | 'signature'

export interface LinkCheck {
  /** 0 for the arrival bundle; the signed seq for a signed addendum, the stored seq otherwise. */
  seq: number
  kind: 'arrival' | AddendumKind
  /** The addendum id; null for link 0. */
  addendum_id: string | null
  status: LinkStatus
  /** Why it is invalid; empty for every other status. */
  problems: LinkProblem[]
  /**
   * Does this link's own signature verify with a trusted key? true or false
   * when it was checked; null when it couldn't be (not signed, unreadable,
   * or a development key). It is checked even when the link has a chain
   * problem, so an invalid link can have signature_ok true: for example
   * when the part signed before it is missing from this device. Screens
   * word that case with `linkStatusText`, never as a changed part.
   */
  signature_ok: boolean | null
  /** True when another signed link has the same seq (a fork: "Added from two devices"). */
  forked: boolean
  /** The stored bundle, or null when the link isn't signed. */
  bundle: SignatureBundle | null
  /**
   * The parsed signed payload, for showing signed facts. Only for 'valid'
   * and 'dev_key' links; null otherwise, so a screen never shows values
   * from a payload that doesn't check out.
   */
  payload: Record<string, unknown> | null
  /** ParkProof's signing time from the signed payload ('valid' and 'dev_key' only). */
  signed_at: string | null
  /** The addendum's client capture time (signed for 'valid' and 'dev_key', stored otherwise); null for link 0. */
  captured_at: string | null
  /** The server's ERR code for a 'rejected' link. */
  rejected_code: string | null
}

export type PhotoStatus = 'matches' | 'differs' | 'not_on_device'

export interface PhotoCheck {
  role: PhotoRole
  /** The fingerprint a signed link carries. */
  sha256: string
  status: PhotoStatus
  /** The fingerprint of the bytes on this device, when they could be hashed. */
  local_sha256: string | null
  /** 'parkproof' when a valid link signs it; 'dev_key' when only development-key links do. */
  signer: 'parkproof' | 'dev_key'
  /** Indexes into `links` of the links that sign this photo. */
  link_indexes: number[]
}

export interface ForkCheck {
  seq: number
  /** Indexes into `links` of the signed links that share this seq. */
  link_indexes: number[]
}

export interface RecordVerification {
  /** The record id the signed payloads must carry (the sender's id for a shared copy). */
  session_id: string
  /**
   * 'problem': at least one link is invalid or a photo differs.
   * 'dev_key': no problem, but at least one link has a development-key signature.
   * 'valid': every signed link is valid and no photo differs.
   * 'unsigned': nothing is signed yet.
   * Pending and rejected links, photos not on this device and forks don't
   * change it; screens show them alongside.
   */
  overall: 'valid' | 'problem' | 'dev_key' | 'unsigned'
  counts: Record<LinkStatus, number>
  /** Link 0 first, then by seq; at one seq, signed before rejected before pending. */
  links: LinkCheck[]
  /** One entry per signed (role, fingerprint), from valid and dev-key links only. */
  photos: PhotoCheck[]
  /** Seqs with more than one signed link. */
  forks: ForkCheck[]
  /**
   * For a v2 chain: does this device hold the chain key link 0 committed
   * to? 'differs' means addenda added here would be refused. Informational.
   */
  chain_key_on_device: 'matches' | 'differs' | 'absent' | 'not_applicable'
}

export interface VerifyOptions {
  /** Keys to trust instead of ParkProof's published key (tests and tooling). */
  publicKeys?: readonly TrustedKey[]
  /**
   * The server's ERR code when it refused link 0, or null. Defaults to the
   * signing queue's record of it (`arrivalSigningRejection`).
   */
  arrivalRejection?: string | null
}

// ─── Link checks ─────────────────────────────────────────────────────────

const LINK_ZERO_SCHEMAS: readonly string[] = [EVIDENCE_V1_SCHEMA, EVIDENCE_V2_SCHEMA]

function isBundleShape(v: unknown): v is SignatureBundle {
  if (!v || typeof v !== 'object') return false
  const b = v as Record<string, unknown>
  return ['schema', 'signed_at', 'algorithm', 'key_alias', 'canonical_payload', 'signature_base64'].every(
    (k) => typeof b[k] === 'string',
  )
}

function parsePayloadText(canonicalPayload: string): Record<string, unknown> | null {
  try {
    const p = JSON.parse(canonicalPayload)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function parsePayload(bundle: SignatureBundle): Record<string, unknown> | null {
  return parsePayloadText(bundle.canonical_payload)
}

const SHARE_BUNDLE_FIELDS = ['canonical_payload', 'signature_base64', 'signed_at', 'key_alias'] as const

/**
 * Link 0 as a share link carries it (T7 item 2): canonical_payload,
 * signature_base64, signed_at and key_alias. schema and algorithm may be
 * left out there. A missing schema is read from the signed payload (it must
 * still be v1 or v2, which `linkZeroProblems` checks); a missing algorithm
 * is ECDSA_SHA_256. When either is present it must still match, as for a
 * stored bundle. A full six-field bundle reads as itself.
 *
 * Returns the bundle with every field filled in, or null when the shape
 * can't be read (a required field missing or not a string, or schema or
 * algorithm present but not a string).
 */
function readShareBundle(v: unknown): SignatureBundle | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const b = v as Record<string, unknown>
  if (!SHARE_BUNDLE_FIELDS.every((k) => typeof b[k] === 'string')) return null
  if (b.schema !== undefined && typeof b.schema !== 'string') return null
  if (b.algorithm !== undefined && typeof b.algorithm !== 'string') return null
  const canonical_payload = b.canonical_payload as string
  let schema = b.schema as string | undefined
  if (schema === undefined) {
    const parsed = parsePayloadText(canonical_payload)
    // '' when the payload has no readable schema: linkZeroProblems then
    // reports 'unreadable' (no payload) or 'schema'.
    schema = parsed && typeof parsed.schema === 'string' ? parsed.schema : ''
  }
  return {
    schema,
    signed_at: b.signed_at as string,
    algorithm: (b.algorithm as string | undefined) ?? SIGNATURE_ALGORITHM,
    key_alias: b.key_alias as string,
    canonical_payload,
    signature_base64: b.signature_base64 as string,
  }
}

/** The chain key hash a signed link carries forward: null for v1, hex for v2 and addenda, undefined when malformed. */
function carriedChainHash(payload: Record<string, unknown>): string | null | undefined {
  if (payload.schema === EVIDENCE_V1_SCHEMA) return null
  const h = payload.chain_key_sha256
  if (h === null && payload.schema === ADDENDUM_SCHEMA) return null
  return typeof h === 'string' && HEX64_RE.test(h) ? h : undefined
}

/** The checks shared by every signed link: envelope, schema, record. */
function envelopeProblems(
  bundle: SignatureBundle,
  payload: Record<string, unknown>,
  schemas: readonly string[],
  sessionId: string | null,
): LinkProblem[] {
  const problems: LinkProblem[] = []
  if (!schemas.includes(bundle.schema) || payload.schema !== bundle.schema) problems.push('schema')
  if (sessionId !== null && payload.session_id !== sessionId) problems.push('session_id')
  if (typeof payload.signed_at !== 'string' || payload.signed_at !== bundle.signed_at) problems.push('signed_at')
  if (bundle.algorithm !== SIGNATURE_ALGORITHM) problems.push('algorithm')
  return problems
}

function linkZeroProblems(
  bundle: SignatureBundle,
  payload: Record<string, unknown> | null,
  sessionId: string | null,
): LinkProblem[] {
  if (!payload) return ['unreadable']
  const problems = envelopeProblems(bundle, payload, LINK_ZERO_SCHEMAS, sessionId)
  if (payload.schema === EVIDENCE_V2_SCHEMA && carriedChainHash(payload) === undefined) problems.push('chain_key')
  return problems
}

/**
 * Settle a signed link's status once its structural problems are known.
 *
 * The signature is tried even when there are structural problems, so a
 * link whose only problem is the chain around it (its parent missing from
 * this device, say) still says whether its own signature is good
 * (`signature_ok`), and its copy never claims the part itself changed.
 */
async function settleSigned(
  bundle: SignatureBundle,
  problems: LinkProblem[],
  keys: readonly CryptoKey[],
): Promise<{ status: LinkStatus; problems: LinkProblem[]; signature_ok: boolean | null }> {
  // Nothing more can be checked about a payload that can't be read.
  if (problems.includes('unreadable')) return { status: 'invalid', problems, signature_ok: null }
  // A development-key bundle (`npm run dev`) can't be checked with the
  // published key, so its signature isn't tried: it is reported as a dev-key
  // link, which is never valid. Its place in the chain was still checked.
  if (bundle.key_alias === DEV_KEY_ALIAS) {
    return problems.length > 0
      ? { status: 'invalid', problems, signature_ok: null }
      : { status: 'dev_key', problems: [], signature_ok: null }
  }
  const ok = await verifySignature(keys, bundle.canonical_payload, bundle.signature_base64)
  const all: LinkProblem[] = ok ? problems : [...problems, 'signature']
  return { status: all.length > 0 ? 'invalid' : 'valid', problems: all, signature_ok: ok }
}

const trusted = (status: LinkStatus) => status === 'valid' || status === 'dev_key'

function emptyCounts(): Record<LinkStatus, number> {
  return { valid: 0, invalid: 0, pending: 0, rejected: 0, dev_key: 0 }
}

function finishLink(
  base: Omit<LinkCheck, 'payload' | 'signed_at' | 'captured_at'>,
  payload: Record<string, unknown> | null,
  storedCapturedAt: string | null,
): LinkCheck {
  const ok = trusted(base.status)
  const signedCapturedAt = ok && payload && typeof payload.captured_at === 'string' ? payload.captured_at : null
  return {
    ...base,
    payload: ok ? payload : null,
    signed_at: ok && payload && typeof payload.signed_at === 'string' ? payload.signed_at : null,
    captured_at: base.kind === 'arrival' ? null : ok ? signedCapturedAt : storedCapturedAt,
  }
}

/**
 * Check one arrival bundle (link 0) on its own: the shape, the schema
 * (v1 or v2), the envelope, the v2 chain hash shape, the record id when
 * `sessionId` is given, and the signature. For a share link (T7), where
 * there is no stored record to compare with.
 *
 * Takes the share-link shape as it is parsed from the link: only
 * canonical_payload, signature_base64, signed_at and key_alias are
 * required. A missing schema is read from the signed payload and a missing
 * algorithm is ECDSA_SHA_256; when present they must match (see
 * `readShareBundle`). A full stored bundle works too. The result's `bundle`
 * has every field filled in.
 */
export async function verifyArrivalBundle(
  bundle: unknown,
  options: { sessionId?: string | null; publicKeys?: readonly TrustedKey[] } = {},
): Promise<LinkCheck> {
  subtleCrypto()
  const keys = await resolveKeys(options.publicKeys)
  const base = { seq: 0, kind: 'arrival' as const, addendum_id: null, forked: false, rejected_code: null }
  const read = readShareBundle(bundle)
  if (!read) {
    return finishLink(
      { ...base, status: 'invalid', problems: ['unreadable'], signature_ok: null, bundle: null },
      null,
      null,
    )
  }
  const payload = parsePayload(read)
  const settled = await settleSigned(read, linkZeroProblems(read, payload, options.sessionId ?? null), keys)
  return finishLink({ ...base, ...settled, bundle: read }, payload, null)
}

// ─── Photos ──────────────────────────────────────────────────────────────

const PHOTO_ROLE_SET: ReadonlySet<string> = new Set(PHOTO_ROLES)
const LINK_ZERO_PHOTO_FIELDS: ReadonlyArray<[PhotoRole, string]> = [
  ['sign', 'sign_photo_sha256'],
  ['car', 'car_photo_sha256'],
  ['ambient', 'ambient_photo_sha256'],
]

/** Every `{ role, sha256 }` photo reference inside signed addendum data. */
function collectSignedPhotos(value: unknown, out: Array<{ role: PhotoRole; sha256: string }>, depth = 0): void {
  if (depth > 6 || !value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const v of value) collectSignedPhotos(v, out, depth + 1)
    return
  }
  const o = value as Record<string, unknown>
  if (typeof o.role === 'string' && PHOTO_ROLE_SET.has(o.role) && typeof o.sha256 === 'string' && HEX64_RE.test(o.sha256)) {
    out.push({ role: o.role as PhotoRole, sha256: o.sha256 })
  }
  for (const v of Object.values(o)) collectSignedPhotos(v, out, depth + 1)
}

function signedPhotosOf(link: LinkCheck): Array<{ role: PhotoRole; sha256: string }> {
  const out: Array<{ role: PhotoRole; sha256: string }> = []
  const p = link.payload
  if (!p) return out
  if (link.kind === 'arrival') {
    for (const [role, field] of LINK_ZERO_PHOTO_FIELDS) {
      const h = p[field]
      if (typeof h === 'string' && HEX64_RE.test(h)) out.push({ role, sha256: h })
    }
  } else {
    collectSignedPhotos(p.data, out)
  }
  return out
}

/** What the bytes on this device hash to: a hex fingerprint, 'unreadable', or null when there are none. */
type LocalHash = string | 'unreadable' | null

/**
 * Hash the photo this device holds for a signed (role, fingerprint).
 *
 * Sign, car and ambient have one photo each per record, so their check is
 * of the photo the record actually shows (its PhotoRef's bytes, else the
 * legacy data URL): a record whose shown photo was swapped reads 'differs'
 * even if the signed bytes are still in the store. An HTTPS URL (a cloud
 * copy) isn't bytes on this device.
 *
 * Every other role can have several photos, so the store is read by the
 * signed fingerprint itself (it is content-addressed), and the bytes found
 * are re-hashed.
 */
function makeLocalHasher(session: ParkingSession): (role: PhotoRole, signedSha: string) => Promise<LocalHash> {
  const cache = new Map<string, Promise<string | null>>()
  const storeHash = (sha256: string): Promise<string | null> => {
    let hit = cache.get(sha256)
    if (!hit) {
      hit = (async () => {
        try {
          const stored = await getPhotoBytes(session.id, sha256)
          return stored ? await sha256HexBytes(stored.bytes) : null
        } catch {
          return null
        }
      })()
      cache.set(sha256, hit)
    }
    return hit
  }
  return async (role, signedSha) => {
    if (!isLegacyPhotoRole(role)) return storeHash(signedSha)
    const ref = photoRefFor(session, role)
    if (ref) {
      const fromStore = await storeHash(ref.sha256)
      if (fromStore) return fromStore
    }
    const legacy = legacyPhotoValue(session, role)
    if (legacy && legacy.startsWith('data:')) {
      try {
        return await hashDataUrlImage(legacy)
      } catch {
        return 'unreadable'
      }
    }
    return null
  }
}

async function checkPhotos(session: ParkingSession, links: readonly LinkCheck[]): Promise<PhotoCheck[]> {
  const entries = new Map<string, { role: PhotoRole; sha256: string; link_indexes: number[]; parkproof: boolean }>()
  links.forEach((link, index) => {
    if (!trusted(link.status)) return
    for (const { role, sha256 } of signedPhotosOf(link)) {
      const key = `${role}/${sha256}`
      const entry = entries.get(key) ?? { role, sha256, link_indexes: [], parkproof: false }
      if (!entry.link_indexes.includes(index)) entry.link_indexes.push(index)
      if (link.status === 'valid') entry.parkproof = true
      entries.set(key, entry)
    }
  })
  const localHash = makeLocalHasher(session)
  return Promise.all(
    [...entries.values()].map(async (e): Promise<PhotoCheck> => {
      const local = await localHash(e.role, e.sha256)
      const status: PhotoStatus = local === null ? 'not_on_device' : local === e.sha256 ? 'matches' : 'differs'
      return {
        role: e.role,
        sha256: e.sha256,
        status,
        local_sha256: local === null || local === 'unreadable' ? null : local,
        signer: e.parkproof ? 'parkproof' : 'dev_key',
        link_indexes: e.link_indexes,
      }
    }),
  )
}

// ─── The record ──────────────────────────────────────────────────────────

interface Working {
  check: Omit<LinkCheck, 'payload' | 'signed_at' | 'captured_at'>
  payload: Record<string, unknown> | null
  storedCapturedAt: string | null
  /** sha256 hex of the canonical payload, for signed links. */
  hash: string | null
  /** The signed seq when readable, for parent lookup. */
  signedSeq: number | null
  addendum: SignedAddendum | null
}

const STATUS_ORDER: Record<LinkStatus, number> = { valid: 0, dev_key: 0, invalid: 0, rejected: 1, pending: 2 }

function sortKey(w: Working): [number, number, string, string] {
  return [
    w.check.seq,
    STATUS_ORDER[w.check.status],
    w.check.bundle?.signed_at ?? w.storedCapturedAt ?? '',
    w.check.addendum_id ?? '',
  ]
}

function compareWorking(a: Working, b: Working): number {
  if (a.check.kind === 'arrival' && b.check.kind !== 'arrival') return -1
  if (b.check.kind === 'arrival' && a.check.kind !== 'arrival') return 1
  const ka = sortKey(a)
  const kb = sortKey(b)
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]) || ka[3].localeCompare(kb[3])
}

/**
 * Verify a record's whole evidence chain on this device: every link's
 * signature and place in the chain, forks, and every signed photo whose
 * bytes are here. Never makes a network request. Throws
 * VerifierUnavailableError when the browser has no WebCrypto; otherwise
 * never throws.
 *
 * A shared copy (T7) is checked against the sender's bundle
 * (`shared_from.arrival_bundle`) and the sender's record id. That bundle
 * may have the share-link shape (four fields; see `verifyArrivalBundle`).
 */
export async function verifyRecord(session: ParkingSession, options: VerifyOptions = {}): Promise<RecordVerification> {
  subtleCrypto()
  const keys = await resolveKeys(options.publicKeys)
  const shared = session.shared_from ?? null
  const sessionId = shared ? shared.original_session_id : session.id
  const linkZeroRaw: unknown = shared ? shared.arrival_bundle : session.signature
  // This device's own link 0 is always a full stored bundle; a shared copy's
  // may have come from a share link without schema and algorithm.
  const linkZero: SignatureBundle | null =
    linkZeroRaw === undefined || linkZeroRaw === null
      ? null
      : shared
        ? readShareBundle(linkZeroRaw)
        : isBundleShape(linkZeroRaw)
          ? linkZeroRaw
          : null

  const working: Working[] = []

  // Link 0.
  const zeroBase = {
    seq: 0,
    kind: 'arrival' as const,
    addendum_id: null,
    forked: false,
    problems: [] as LinkProblem[],
    signature_ok: null,
  }
  if (linkZeroRaw === undefined || linkZeroRaw === null) {
    const code =
      options.arrivalRejection !== undefined
        ? options.arrivalRejection
        : shared
          ? null
          : arrivalSigningRejection(session.id)
    working.push({
      check: { ...zeroBase, status: code ? 'rejected' : 'pending', bundle: null, rejected_code: code ?? null },
      payload: null,
      storedCapturedAt: null,
      hash: null,
      signedSeq: null,
      addendum: null,
    })
  } else if (!linkZero) {
    working.push({
      check: { ...zeroBase, status: 'invalid', problems: ['unreadable'], bundle: null, rejected_code: null },
      payload: null,
      storedCapturedAt: null,
      hash: null,
      signedSeq: null,
      addendum: null,
    })
  } else {
    const payload = parsePayload(linkZero)
    working.push({
      check: {
        ...zeroBase,
        status: 'invalid',
        problems: linkZeroProblems(linkZero, payload, sessionId),
        bundle: linkZero,
        rejected_code: null,
      },
      payload,
      storedCapturedAt: null,
      hash: await sha256HexUtf8(linkZero.canonical_payload),
      signedSeq: 0,
      addendum: null,
    })
  }

  // Addenda. A null bundle means not signed, like an absent one. A pending
  // or rejected copy of an addendum that is also stored signed (a sync
  // merge can leave both) is the signed one.
  const addenda = (Array.isArray(session.addenda) ? session.addenda : []).filter(
    (a): a is SignedAddendum => !!a && typeof a === 'object',
  )
  const hasBundle = (a: SignedAddendum) => a.bundle !== undefined && a.bundle !== null
  const signedIds = new Set(addenda.filter(hasBundle).map((a) => a.id))
  const seen = new Set<string>()
  for (const a of addenda) {
    if (!hasBundle(a) && signedIds.has(a.id)) continue
    const storedSeq = Number.isInteger(a.seq) ? a.seq : 0
    const storedCapturedAt = typeof a.captured_at === 'string' ? a.captured_at : null
    const base = {
      seq: storedSeq,
      kind: a.kind,
      addendum_id: typeof a.id === 'string' ? a.id : null,
      forked: false,
      problems: [] as LinkProblem[],
      signature_ok: null,
    }
    if (hasBundle(a)) {
      if (!isBundleShape(a.bundle)) {
        working.push({
          check: { ...base, status: 'invalid', problems: ['unreadable'], bundle: null, rejected_code: null },
          payload: null,
          storedCapturedAt,
          hash: null,
          signedSeq: null,
          addendum: a,
        })
        continue
      }
      // The same signed link stored twice (a sync merge) counts once.
      const dupKey = `${a.bundle.canonical_payload}\u0000${a.bundle.signature_base64}`
      if (seen.has(dupKey)) continue
      seen.add(dupKey)
      const payload = parsePayload(a.bundle)
      const signedSeq =
        payload && Number.isInteger(payload.seq) && (payload.seq as number) >= 1 ? (payload.seq as number) : null
      working.push({
        check: { ...base, seq: signedSeq ?? storedSeq, status: 'invalid', bundle: a.bundle, rejected_code: null },
        payload,
        storedCapturedAt,
        hash: await sha256HexUtf8(a.bundle.canonical_payload),
        signedSeq,
        addendum: a,
      })
    } else if (a.rejected) {
      const code = typeof a.rejected.code === 'string' ? a.rejected.code : null
      working.push({
        check: { ...base, status: 'rejected', bundle: null, rejected_code: code },
        payload: null,
        storedCapturedAt,
        hash: null,
        signedSeq: null,
        addendum: a,
      })
    } else {
      working.push({
        check: { ...base, status: 'pending', bundle: null, rejected_code: null },
        payload: null,
        storedCapturedAt,
        hash: null,
        signedSeq: null,
        addendum: a,
      })
    }
  }

  // Structural checks for signed addenda, then every signature. The
  // parent of seq N is a signed link at seq N - 1 (link 0 for seq 1),
  // matched by the payload hash the child commits to, so a fork's
  // children find their own branch.
  const signedLinksAt = (seq: number) =>
    working.filter(
      (w) => w.check.bundle && w.hash !== null && w.signedSeq === seq && (seq === 0) === (w.check.kind === 'arrival'),
    )
  await Promise.all(
    working.map(async (w) => {
      const bundle = w.check.bundle
      if (!bundle || w.hash === null) return
      let problems = w.check.problems
      if (w.check.kind !== 'arrival') {
        problems = addendumProblems(w, sessionId, signedLinksAt)
      }
      const settled = await settleSigned(bundle, problems, keys)
      w.check = { ...w.check, ...settled }
    }),
  )

  working.sort(compareWorking)
  const links = working.map((w) => finishLink(w.check, w.payload, w.storedCapturedAt))

  // Forks: two signed links (valid or dev key) at one seq.
  const bySeq = new Map<number, number[]>()
  links.forEach((link, index) => {
    if (link.kind === 'arrival' || !trusted(link.status)) return
    bySeq.set(link.seq, [...(bySeq.get(link.seq) ?? []), index])
  })
  const forks: ForkCheck[] = []
  for (const [seq, indexes] of [...bySeq.entries()].sort((a, b) => a[0] - b[0])) {
    if (indexes.length < 2) continue
    forks.push({ seq, link_indexes: indexes })
    for (const i of indexes) links[i] = { ...links[i], forked: true }
  }

  const photos = await checkPhotos(session, links)

  const counts = emptyCounts()
  for (const link of links) counts[link.status]++
  const problem = counts.invalid > 0 || photos.some((p) => p.status === 'differs')
  const overall: RecordVerification['overall'] = problem
    ? 'problem'
    : counts.dev_key > 0
      ? 'dev_key'
      : counts.valid > 0
        ? 'valid'
        : 'unsigned'

  return {
    session_id: sessionId,
    overall,
    counts,
    links,
    photos,
    forks,
    chain_key_on_device: await chainKeyOnDevice(session, links[0] ?? null, shared !== null),
  }
}

/** The chain checks for one signed addendum (N2): identity, seq, parent hash, chain key hash. */
function addendumProblems(w: Working, sessionId: string, signedLinksAt: (seq: number) => Working[]): LinkProblem[] {
  const bundle = w.check.bundle as SignatureBundle
  const payload = w.payload
  if (!payload) return ['unreadable']
  const problems = envelopeProblems(bundle, payload, [ADDENDUM_SCHEMA], sessionId)
  if (typeof payload.kind !== 'string' || !(ADDENDUM_KINDS as readonly string[]).includes(payload.kind)) {
    if (!problems.includes('schema')) problems.push('schema')
  }
  const a = w.addendum
  if (
    !a ||
    payload.addendum_id !== a.id ||
    payload.kind !== a.kind ||
    payload.seq !== a.seq ||
    payload.captured_at !== a.captured_at ||
    !sameJson(payload.data, a.data)
  ) {
    problems.push('entry_mismatch')
  }
  if (w.signedSeq === null) {
    problems.push('seq')
    return problems
  }
  const parents = signedLinksAt(w.signedSeq - 1)
  if (parents.length === 0) {
    problems.push('parent_missing')
    return problems
  }
  const parent = parents.find((p) => p.hash === payload.parent_payload_sha256)
  if (!parent) {
    problems.push('parent_hash')
    return problems
  }
  const expected = parent.payload ? carriedChainHash(parent.payload) : undefined
  if (expected === undefined || payload.chain_key_sha256 !== expected) problems.push('chain_key')
  return problems
}

/** Same JSON value, key order aside. False when either side isn't plain JSON. */
function sameJson(a: unknown, b: unknown): boolean {
  try {
    return canonicalize(JSON.parse(JSON.stringify(a))) === canonicalize(JSON.parse(JSON.stringify(b)))
  } catch {
    return false
  }
}

async function chainKeyOnDevice(
  session: ParkingSession,
  linkZero: LinkCheck | null,
  shared: boolean,
): Promise<RecordVerification['chain_key_on_device']> {
  if (shared || !linkZero || linkZero.kind !== 'arrival' || !trusted(linkZero.status)) return 'not_applicable'
  const p = linkZero.payload
  if (!p || p.schema !== EVIDENCE_V2_SCHEMA) return 'not_applicable'
  if (typeof session.chain_key !== 'string' || session.chain_key.length === 0) return 'absent'
  return (await sha256HexUtf8(session.chain_key)) === p.chain_key_sha256 ? 'matches' : 'differs'
}

// ─── Copy ────────────────────────────────────────────────────────────────
// Statuses are code values; screens show them through these keys, never raw.

export const LINK_STATUS_KEYS: Readonly<Record<LinkStatus, string>> = {
  valid: 'verifier.link.valid',
  invalid: 'verifier.link.invalid',
  pending: 'verifier.link.pending',
  rejected: 'verifier.link.rejected',
  dev_key: 'verifier.link.devKey',
}

export const PHOTO_STATUS_KEYS: Readonly<Record<PhotoStatus, string>> = {
  matches: 'verifier.photo.matches',
  differs: 'verifier.photo.differs',
  // The one bytes-missing state (N4), shared with the record screen.
  not_on_device: 'session.photoNotOnDevice',
}

export const FORK_KEY = 'verifier.fork'

/**
 * An invalid link whose only problems are the chain around it: the part
 * signed before it is missing from this device, or isn't the one it was
 * signed on top of, or doesn't carry the same chain key hash. The part
 * itself may be exactly what ParkProof signed (see `signature_ok`), so its
 * copy says its place can't be checked, never that it changed.
 */
export const LINK_CHAIN_BROKEN_KEY = 'verifier.link.chainBroken'

/** A photo not on this device that only development-key links sign. */
export const PHOTO_NOT_ON_DEVICE_DEV_KEY = 'verifier.photo.notOnDeviceDevKey'

const CHAIN_ONLY_PROBLEMS: ReadonlySet<LinkProblem> = new Set<LinkProblem>(['parent_missing', 'parent_hash', 'chain_key'])

/** True when an invalid link's only problems are the chain around it, and its own signature didn't fail. */
export function isChainOnlyProblem(link: Pick<LinkCheck, 'status' | 'problems' | 'signature_ok'>): boolean {
  return (
    link.status === 'invalid' &&
    link.signature_ok !== false &&
    link.problems.length > 0 &&
    link.problems.every((p) => CHAIN_ONLY_PROBLEMS.has(p))
  )
}

/** The locale key for a link's result, problem-aware for invalid links. */
export function linkStatusKey(link: Pick<LinkCheck, 'status' | 'problems' | 'signature_ok'>): string {
  return isChainOnlyProblem(link) ? LINK_CHAIN_BROKEN_KEY : LINK_STATUS_KEYS[link.status]
}

/**
 * "Signature valid. ...", "Not signed yet", "This part couldn't be signed"
 * and so on. An invalid link whose only problem is the chain around it
 * reads "Its place in the record can't be checked. ..." rather than
 * "Signature not valid".
 */
export function linkStatusText(link: Pick<LinkCheck, 'status' | 'problems' | 'signature_ok'>, t: TFunction): string {
  return t(linkStatusKey(link))
}

/**
 * A photo's result. A photo whose bytes aren't here reads exactly as on
 * the record screen ("Photo not on this device. Signed fingerprint
 * 3f9a…c21b."); when only development-key links sign it, it says so
 * ("... Signed with a development key.").
 */
export function photoStatusText(photo: Pick<PhotoCheck, 'status' | 'sha256' | 'signer'>, t: TFunction): string {
  if (photo.status === 'not_on_device') {
    const fingerprint = shortFingerprint(photo.sha256)
    return photo.signer === 'parkproof'
      ? t(PHOTO_STATUS_KEYS.not_on_device, { fingerprint })
      : t(PHOTO_NOT_ON_DEVICE_DEV_KEY, { fingerprint })
  }
  return t(PHOTO_STATUS_KEYS[photo.status])
}

/** "Added from two devices". */
export function forkText(t: TFunction): string {
  return t(FORK_KEY)
}

/** Test hook: forget the imported published key. */
export function resetVerifierForTests(): void {
  publishedKey = null
}
