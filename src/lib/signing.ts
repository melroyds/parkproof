// Client side of the evidence chain (build spec N2).
//
// Every signature for a record goes through ONE in-memory queue per record,
// run inside `navigator.locks.request('pp-sign-' + id)` where the browser
// has Web Locks, so two triggers (or two tabs) never sign the same link
// twice. A drain signs link 0 first, then each pending addendum in seq
// order, each against its parent bundle read fresh from storage. When a
// link gets its bundle the next pending link is tried at once.
//
// Outcomes: HTTP 400 is a rejection (the link is marked and never retried;
// later pending addenda are renumbered after it). 429, 5xx, network errors
// and `navigator.onLine === false` are transient: the link stays pending,
// with no retry cap, and the sweep tries again later.
//
// The sweep runs on mount, on `online`, and when the page becomes visible,
// at most once per 60 s per record, and not at all while the browser is
// offline. It also queues the departure catch-up.
import type {
  AddendumDataByKind,
  AddendumKind,
  LogDraft,
  ParkingSession,
  PermitContext,
  SignatureBundle,
  SignedAddendum,
} from '../types'
import { ADDENDUM_SCHEMA, CAPS, EVIDENCE_V2_SCHEMA, canonicalize } from '../../lambda/addendum-schema.js'
import {
  appendAddendum,
  fillPreviousDepartureHash,
  getSession,
  loadSessions,
  notifyRecordsChanged,
  rejectAddendum,
  setAddendumBundle,
  setArrivalSignature,
} from './storage'
import { isWorkdayEnabled } from './features'
import { legsWaitingOnDeparture, previousDepartureStep } from './workday-chain'
import { endpointUrl } from './api'
import { hashDataUrlImage, sha256HexUtf8 } from './hash'
import { LEGACY_PHOTO_ROLES, legacyPhotoField, photoRefFor } from './session-photos'
import { isPermitSalt } from './permit-answer'
import {
  DEPARTURE_CATCH_UP_GRACE_MS,
  MAX_ADDENDA,
  buildArrivalContext,
  chainKeyForAddenda,
  checkAddendumBundle,
  checkArrivalBundle,
  departureCatchUpData,
  fitText,
  hasPendingAddenda,
  linkZeroSchema,
  needsDepartureCatchUp,
  nextPendingAddendum,
  parentBundleFor,
} from './evidence-chain'

/** The sweep looks at a record at most this often. */
export const SWEEP_THROTTLE_MS = 60_000
/** Records older than this aren't swept any more. */
export const RETRY_HORIZON_MS = 30 * 24 * 60 * 60_000
/**
 * Device-local signing state: when the sweep last looked at each record,
 * link-0 rejections (a 400 on the arrival bundle; link 0 has no `rejected`
 * field on the record itself), which records were ended on this device
 * (only that device adds the departure catch-up), and which records came to
 * this device from the cloud (they never get a link 0 here). Best-effort,
 * except the pulled mark, which is written before the pulled record.
 */
const SIGNING_STATE_KEY = 'parkproof.signing.state.v2'
/** The pre-chain retry log, whose attempt caps no longer apply. Removed on the first sweep. */
const LEGACY_RETRY_LOG_KEY = 'parkproof.signing.retry.v1'

interface SigningStateEntry {
  last?: number
  link0_rejected?: { code: string; at: string }
  ended_here?: true
  pulled?: true
}
type SigningState = Record<string, SigningStateEntry>

function loadSigningState(): SigningState {
  try {
    const raw = localStorage.getItem(SIGNING_STATE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as SigningState) : {}
  } catch {
    return {}
  }
}

function saveSigningState(state: SigningState): void {
  try {
    localStorage.setItem(SIGNING_STATE_KEY, JSON.stringify(state))
  } catch {
    /* best-effort: the worst case is an extra sweep attempt */
  }
}

function updateSigningState(id: string, patch: (entry: SigningStateEntry) => SigningStateEntry | null): void {
  const state = loadSigningState()
  const next = patch(state[id] ?? {})
  if (next === null) delete state[id]
  else state[id] = next
  saveSigningState(state)
}

/** The code the server gave when it refused this record's link 0, or null. */
export function arrivalSigningRejection(sessionId: string): string | null {
  return loadSigningState()[sessionId]?.link0_rejected?.code ?? null
}

/**
 * Remember that the driver ended this record on this device. A record gets
 * its departure catch-up only on the device that ended it, so another copy
 * (which syncs `ended_at` before the departure link reaches it) never adds
 * a departure of its own and forks the chain. `scheduleDepartureCatchUp`
 * calls this; anything else that stamps `ended_at` locally should too.
 */
export function markEndedOnThisDevice(sessionId: string): void {
  updateSigningState(sessionId, (e) => ({ ...e, ended_here: true }))
}

function endedOnThisDevice(state: SigningState, sessionId: string): boolean {
  return state[sessionId]?.ended_here === true
}

/**
 * Was this record ended on this device (`markEndedOnThisDevice`)? The record
 * screen uses it to tell a departure that is still coming from one that
 * never will be (`departureSummary`).
 */
export function isEndedOnThisDevice(sessionId: string): boolean {
  return endedOnThisDevice(loadSigningState(), sessionId)
}

/**
 * Remember that these records came to this device from the cloud (T0b4
 * item 11). A pulled record never gets a link 0 signed here: if its cloud
 * copy is unsigned, the device that saved it may still be signing it (or
 * already has, and the upload hasn't landed), and a second link 0 would
 * leave every addendum signed on the first one without its parent. This
 * device can't vouch for photo hashes it only read from the cloud either.
 * The record's addenda queued on this device are still signed (on top of
 * the link 0 that came with it).
 *
 * Unlike the rest of the signing state this write is strict: returns false
 * when it couldn't be stored, and the caller then doesn't pull the records.
 */
export function markPulledRecords(sessionIds: readonly string[]): boolean {
  if (sessionIds.length === 0) return true
  const state = loadSigningState()
  for (const id of sessionIds) state[id] = { ...state[id], pulled: true }
  try {
    localStorage.setItem(SIGNING_STATE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

/** Did this record come to this device from the cloud (`markPulledRecords`)? */
export function isPulledRecord(sessionId: string): boolean {
  return loadSigningState()[sessionId]?.pulled === true
}

// ─── Hashing ─────────────────────────────────────────────────────────────
// `hashDataUrlImage` (the SHA-256 of a data-URL image's raw bytes, as
// lowercase hex) and `sha256HexUtf8` live in hash.ts so the photo store can
// use them without importing this module. Re-exported here as before.
export { hashDataUrlImage, sha256HexUtf8 }

/** 32 random bytes as 64 lowercase hex characters. */
function randomHex32(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** A new record's chain key: 32 random bytes as 64 lowercase hex characters. */
export function generateChainKey(): string {
  return randomHex32()
}

/**
 * A record's permit salt (N3): 32 random bytes as 64 lowercase hex
 * characters, made when a record with a permit context is saved and kept
 * with the record (this device and the driver's own cloud copy), never sent
 * for signing. It lets the driver reveal the permit details later.
 */
export function generatePermitSalt(): string {
  return randomHex32()
}

/**
 * `chain_key_sha256`: the sha256 hex of the chain key string's UTF-8 bytes
 * (the Lambda's `chainKeyHash` is the same rule).
 */
export function chainKeyHash(chainKey: string): Promise<string> {
  return sha256HexUtf8(chainKey)
}

/**
 * `arrival_context.permit_commitment` (N3): sha256 hex of
 * `permit_salt + canonicalize(permit_context)`. The permit itself is never
 * signed in plain text.
 */
export function permitCommitment(permitSalt: string, context: PermitContext): Promise<string> {
  return sha256HexUtf8(permitSalt + canonicalize(context))
}

/**
 * The `permit_commitment` link 1 signs for a prepared record: the
 * commitment to its stored `permit_context` with its stored `permit_salt`,
 * or null when the record used no permit (or has no usable salt). Never
 * throws: when hashing fails, link 1 signs null rather than failing.
 */
export async function permitCommitmentFor(session: ParkingSession): Promise<string | null> {
  const context = session.permit_context
  if (!context || typeof context !== 'object' || !isPermitSalt(session.permit_salt)) return null
  try {
    return await permitCommitment(session.permit_salt, context)
  } catch (err) {
    console.warn('[signing] could not commit to the permit details:', err)
    return null
  }
}

export interface V1Hashes {
  sign: string | null
  car: string | null
  ambient: string | null
}

/**
 * The link-0 photo hashes of a record. For each of sign, car and ambient:
 * the PhotoRef's sha256 when the record has one for that role (new records
 * keep those photos in the photo store, and the ref's hash was taken from
 * the stored bytes at capture), otherwise the hash of the legacy data-URL
 * field. Null when a legacy photo isn't held on this device as bytes (a
 * cloud URL), so it can't be hashed.
 */
export async function computeV1Hashes(session: ParkingSession): Promise<V1Hashes | null> {
  type Source = { kind: 'ref'; sha256: string } | { kind: 'legacy'; value: string } | { kind: 'none' }
  const sources: Source[] = LEGACY_PHOTO_ROLES.map((role): Source => {
    const ref = photoRefFor(session, role)
    if (ref) return { kind: 'ref', sha256: ref.sha256 }
    const field = session[legacyPhotoField(role)]
    return typeof field === 'string' && field.length > 0 ? { kind: 'legacy', value: field } : { kind: 'none' }
  })
  if (sources.some((s) => s.kind === 'legacy' && !s.value.startsWith('data:'))) return null
  const [sign, car, ambient] = await Promise.all(
    sources.map((s): Promise<string | null> =>
      s.kind === 'ref' ? Promise.resolve(s.sha256) : s.kind === 'legacy' ? hashDataUrlImage(s.value) : Promise.resolve(null),
    ),
  )
  return { sign, car, ambient }
}

/**
 * Get a freshly logged record ready to save: a new chain key and the
 * link-0 photo hashes (`v1_hashes`, stored at save so link 0 can always be
 * signed; for photo-store photos they are the PhotoRefs' hashes). Never
 * throws: if hashing fails, `v1_hashes` is left out and link 0 hashes the
 * photos when it signs.
 *
 * The driver's own text (`driver_name`, `condition_note`) is shaped here
 * the way link 1 signs it (`fitText`: forbidden characters such as
 * newlines become spaces, ends trimmed, cut at the cap), so the stored
 * record and the signed arrival_context say the same thing.
 *
 * A record with a permit context (T4) gets its permit salt here (N3), so
 * the commitment link 1 signs (`permitCommitmentFor`) can be opened later.
 */
export async function prepareNewRecord(session: ParkingSession): Promise<ParkingSession> {
  const chain_key = session.chain_key ?? generateChainKey()
  let v1_hashes = session.v1_hashes
  if (!v1_hashes) {
    try {
      v1_hashes = (await computeV1Hashes(session)) ?? undefined
    } catch (err) {
      console.warn('[signing] could not hash photos at save:', err)
    }
  }
  const prepared: ParkingSession = { ...session, chain_key }
  if (v1_hashes) prepared.v1_hashes = v1_hashes
  if (session.driver_name !== undefined) prepared.driver_name = fitText(session.driver_name, CAPS.driverName)
  if (session.condition_note !== undefined) prepared.condition_note = fitText(session.condition_note, CAPS.note)
  if (session.permit_context && typeof session.permit_context === 'object') {
    if (!isPermitSalt(session.permit_salt)) prepared.permit_salt = generatePermitSalt()
  } else if (session.permit_salt !== undefined) {
    // A salt with nothing to open is noise: no permit, no salt.
    delete prepared.permit_salt
  }
  return prepared
}

// ─── Link 0 request ──────────────────────────────────────────────────────

export interface ArrivalRequest {
  schema?: 'parkproof-evidence-v2'
  session_id: string
  arrived_at: string
  expires_at: string | null
  location: ParkingSession['location']
  rules: string
  chosen_label: string | null
  confidence: string
  no_sign: boolean
  sign_photo_sha256: string | null
  ambient_photo_sha256: string | null
  car_photo_sha256: string | null
  chain_key_sha256?: string
}

/**
 * The /sign-session body for a record's link 0: v2 (with the chain key's
 * hash) when the record has a chain key, v1 for records saved before the
 * chain. Null when the photo hashes aren't available on this device.
 */
export async function buildArrivalRequest(session: ParkingSession): Promise<ArrivalRequest | null> {
  const hashes = session.v1_hashes ?? (await computeV1Hashes(session))
  if (!hashes) return null
  const body: ArrivalRequest = {
    session_id: session.id,
    arrived_at: session.arrived_at,
    expires_at: session.expires_at ?? null,
    location: session.location ?? null,
    rules: session.rules,
    chosen_label: session.chosen_label ?? null,
    confidence: session.confidence,
    no_sign: !!session.no_sign,
    sign_photo_sha256: hashes.sign,
    ambient_photo_sha256: hashes.ambient,
    car_photo_sha256: hashes.car,
  }
  if (!session.chain_key) return body
  return { ...body, schema: EVIDENCE_V2_SCHEMA, chain_key_sha256: await chainKeyHash(session.chain_key) }
}

/** The /sign-session body for an addendum. */
export interface AddendumRequest {
  schema: 'parkproof-addendum-v1'
  addendum_id: string
  kind: AddendumKind
  session_id: string
  seq: number
  captured_at: string
  chain_key: string | null
  parent: { canonical_payload: string; signature_base64: string }
  data: Record<string, unknown>
}

export function buildAddendumRequest(
  session: ParkingSession,
  addendum: SignedAddendum,
  parent: SignatureBundle,
  chainKey: string | null,
): AddendumRequest {
  return {
    schema: ADDENDUM_SCHEMA,
    addendum_id: addendum.id,
    kind: addendum.kind,
    session_id: session.id,
    seq: addendum.seq,
    captured_at: addendum.captured_at,
    chain_key: chainKey,
    parent: { canonical_payload: parent.canonical_payload, signature_base64: parent.signature_base64 },
    data: addendum.data,
  }
}

// ─── Network ─────────────────────────────────────────────────────────────

export type SignOutcome = { ok: SignatureBundle } | { transient: true } | { rejected: string }

function isBundle(v: unknown): v is SignatureBundle {
  if (!v || typeof v !== 'object') return false
  const b = v as Record<string, unknown>
  return ['schema', 'signed_at', 'algorithm', 'key_alias', 'canonical_payload', 'signature_base64'].every(
    (k) => typeof b[k] === 'string' && (b[k] as string).length > 0,
  )
}

/**
 * POST one link to /sign-session. Never throws.
 *   - 200 with a bundle: `{ ok }`
 *   - 400: `{ rejected: code }`, the ERR code from the body
 *   - offline, network error, 429, 5xx, any other status, or a malformed
 *     200: `{ transient: true }`
 */
export async function postSignRequest(body: ArrivalRequest | AddendumRequest): Promise<SignOutcome> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { transient: true }
  let resp: Response
  try {
    resp = await fetch(endpointUrl('/sign-session'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { transient: true }
  }
  if (resp.status === 400) {
    let code = 'ERR_BAD_REQUEST'
    try {
      const json = (await resp.json()) as { error?: unknown }
      if (typeof json?.error === 'string' && /^ERR_[A-Z_]+$/.test(json.error)) code = json.error
    } catch {
      /* not JSON: keep the generic code */
    }
    return { rejected: code }
  }
  if (!resp.ok) return { transient: true }
  try {
    const json = await resp.json()
    if (isBundle(json)) return { ok: json }
  } catch {
    /* fall through */
  }
  return { transient: true }
}

// ─── Mirror hook ─────────────────────────────────────────────────────────

let signedListener: ((sessionId: string) => void) | null = null
/**
 * Records that gained a bundle while no listener was set: the mount sweep
 * can finish before sign-in has resolved. They are handed to the next
 * listener, so their signatures still reach the cloud copy.
 */
const unmirrored = new Set<string>()

/**
 * Called once after a drain stored at least one new bundle for a record.
 * App sets this to the cloud mirror while signed in (and null otherwise),
 * so signatures from the save path and from background retries both reach
 * the user's cloud copy. Setting a listener first replays every record
 * signed while there was none.
 */
export function setSignedRecordListener(listener: ((sessionId: string) => void) | null): void {
  signedListener = listener
  if (!listener) return
  const missed = [...unmirrored]
  unmirrored.clear()
  for (const id of missed) notifySigned(id)
}

function notifySigned(sessionId: string): void {
  if (!signedListener) {
    unmirrored.add(sessionId)
    return
  }
  try {
    signedListener(sessionId)
  } catch (err) {
    console.warn('[signing] signed-record listener failed:', err)
  }
}

// ─── Holding addenda until the first sync ────────────────────────────────
// On a device that is signed in, the first sync after start merges the
// cloud copies in (sync.ts `performInitialSync`): it can adopt links signed
// on another device and renumber this device's pending addenda on top of
// them. An addendum signed before that would be signed at the seq it had
// when it was queued, beside a link another device already signed there,
// and fork the chain. So App holds addendum signing from start until that
// sync settles (or until it is clear nobody is signed in). Link 0 is still
// signed meanwhile: only the device that saved a record signs it.

/** A hold ends on its own after this long, so a sync that never settles can't stall signing. */
export const ADDENDUM_HOLD_MAX_MS = 60_000
let addendaHeld = false
let holdTimer: ReturnType<typeof setTimeout> | null = null

/** Hold addendum signing until `releaseAddendumSigning` (or ADDENDUM_HOLD_MAX_MS). */
export function holdAddendumSigning(maxMs: number = ADDENDUM_HOLD_MAX_MS): void {
  if (addendaHeld) return
  addendaHeld = true
  holdTimer = setTimeout(() => {
    console.warn('[signing] the first sync has not settled; signing addenda anyway')
    releaseAddendumSigning()
  }, maxMs)
}

/** Is addendum signing held (`holdAddendumSigning`)? */
export function addendumSigningHeld(): boolean {
  return addendaHeld
}

/**
 * End the hold and sign what it held back, without waiting for the sweep's
 * throttle: for every record the sweep looks after, the departure catch-up
 * when one is due, then a drain when it has a pending addendum. Does
 * nothing when nothing is held.
 */
export function releaseAddendumSigning(now: number = Date.now()): void {
  if (!addendaHeld) return
  addendaHeld = false
  if (holdTimer !== null) clearTimeout(holdTimer)
  holdTimer = null
  let sessions: ParkingSession[]
  try {
    sessions = loadSessions()
  } catch {
    return
  }
  for (const session of sessions) {
    if (session.shared_from) continue
    const age = now - Date.parse(session.arrived_at)
    if (!Number.isFinite(age) || age > RETRY_HORIZON_MS) continue
    catchUpDeparture(session.id, now)
    const fresh = getSession(session.id)
    if (fresh && hasPendingAddenda(fresh)) void enqueueSigning(session.id)
  }
}

/**
 * A record that came from the cloud with a v2 link 0 but without its
 * arrival_context: the saving device signs that as link 1, and it hasn't
 * reached this device yet. Until it does (signed, or refused), an addendum
 * queued here would take seq 1 and fork link 1, so it waits; the merge
 * that brings link 1 renumbers it onto seq 2.
 */
function awaitingArrivalContext(session: ParkingSession): boolean {
  if (!isPulledRecord(session.id) || linkZeroSchema(session) !== EVIDENCE_V2_SCHEMA) return false
  return !(session.addenda ?? []).some((a) => a.kind === 'arrival_context' && (a.bundle || a.rejected))
}

// ─── The per-record queue ────────────────────────────────────────────────

const drains = new Map<string, Promise<void>>()
const waiting = new Set<string>()

type LockManagerLike = { request: (name: string, cb: () => Promise<void>) => Promise<void> }

function withRecordLock(sessionId: string, fn: () => Promise<void>): Promise<void> {
  const locks =
    typeof navigator !== 'undefined'
      ? ((navigator as Navigator & { locks?: LockManagerLike }).locks ?? null)
      : null
  if (locks && typeof locks.request === 'function') return locks.request('pp-sign-' + sessionId, fn)
  return fn()
}

/**
 * Run a drain for this record on its queue. A drain that is already queued
 * but hasn't started picks up any new work, so a second request then just
 * joins it. Resolves when that drain has finished; never rejects.
 */
export function enqueueSigning(sessionId: string): Promise<void> {
  if (waiting.has(sessionId)) return drains.get(sessionId) ?? Promise.resolve()
  waiting.add(sessionId)
  const previous = drains.get(sessionId) ?? Promise.resolve()
  const run = previous
    .then(() => {
      waiting.delete(sessionId)
      return withRecordLock(sessionId, () => drainRecord(sessionId))
    })
    .catch((err) => {
      waiting.delete(sessionId)
      console.warn('[signing] drain failed:', err)
    })
  drains.set(sessionId, run)
  void run.then(() => {
    if (drains.get(sessionId) === run) drains.delete(sessionId)
  })
  return run
}

/** Resolves once no drain is queued or running (for one record, or all). */
export async function whenSigningIdle(sessionId?: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const pending = sessionId ? [drains.get(sessionId)].filter(Boolean) : [...drains.values()]
    if (pending.length === 0) return
    await Promise.all(pending)
  }
}

/**
 * Sign whatever this record has outstanding, in chain order, until a link
 * is transiently refused or nothing is left. Reads the record fresh before
 * every link.
 */
async function drainRecord(sessionId: string): Promise<void> {
  let signedAny = false
  for (let step = 0; step < MAX_ADDENDA + 3; step++) {
    const session = getSession(sessionId)
    if (!session || session.shared_from) break

    if (!session.signature) {
      if (arrivalSigningRejection(sessionId)) break
      // A record pulled from the cloud: its link 0 is the saving device's.
      if (isPulledRecord(sessionId)) break
      const request = await buildArrivalRequest(session)
      if (!request) break // photo bytes not on this device: nothing to sign here
      const outcome = await postSignRequest(request)
      if ('ok' in outcome) {
        const check = checkArrivalBundle(request, outcome.ok)
        if (!check.ok) {
          // Only an HTTP 400 rejects. A 200 that signs something else (for
          // example a rolled-back server signing v1 for a v2 request) is
          // not stored, and link 0 stays unsigned so a later trigger asks
          // again. The sweep's 60 s throttle bounds the retries.
          console.warn(`[signing] link 0 of ${sessionId} came back signing other data (${check.code}); will retry`)
          break
        }
        // false means another writer signed first; carry on with theirs.
        if (setArrivalSignature(sessionId, outcome.ok)) signedAny = true
        continue
      }
      if ('rejected' in outcome) recordArrivalRejection(sessionId, outcome.rejected)
      break
    }

    // Held until the first sync has merged the cloud copies in (see above).
    if (addendaHeld) break
    const next = nextPendingAddendum(session)
    if (!next) break
    if (awaitingArrivalContext(session)) break
    // A workday stop's arrival_context links to the previous stop's signed
    // departure (T6b item 11). The link is filled here, at sign time, once
    // that departure is signed; until then the arrival_context waits, for
    // at most 24 hours, and is then signed with null.
    if (next.kind === 'arrival_context' && isWorkdayEnabled()) {
      const step = previousDepartureStep(sessionId, next, loadSessions(), Date.now())
      if (step.kind === 'wait') break
      if (step.kind === 'fill') {
        const hash = await sha256HexUtf8(step.payload)
        let filled: SignedAddendum | null = null
        try {
          filled = fillPreviousDepartureHash(sessionId, next.id, hash)
        } catch (err) {
          console.warn('[signing] could not link the workday stop to the previous one:', err)
        }
        if (!filled) break
        // Read again from storage on the next pass, so what is sent is what is stored.
        continue
      }
    }
    const parent = parentBundleFor(session, next.seq)
    if (!parent) break // parent not signed yet: wait for it
    const chainKey = chainKeyForAddenda(session)
    // A v2 chain whose key isn't on this device can't be extended here;
    // leave the addendum pending rather than earn a permanent rejection.
    if (chainKey === undefined) break
    const parentHash = await sha256HexUtf8(parent.canonical_payload)
    const outcome = await postSignRequest(buildAddendumRequest(session, next, parent, chainKey))
    if ('ok' in outcome) {
      const check = checkAddendumBundle(next, session.id, parent, parentHash, outcome.ok)
      if (!check.ok) {
        rejectAddendum(sessionId, next.id, check.code)
        // A refused departure means the next stop signs with a null link now.
        if (next.kind === 'departure') wakeLegsWaitingOn(sessionId)
        continue
      }
      if (setAddendumBundle(sessionId, next.id, outcome.ok)) {
        signedAny = true
        // The next workday stop's arrival_context may be waiting for this departure.
        if (next.kind === 'departure') wakeLegsWaitingOn(sessionId)
      }
      continue
    }
    if ('rejected' in outcome) {
      rejectAddendum(sessionId, next.id, outcome.rejected)
      // The next workday stop's arrival_context was waiting for this
      // departure: refused, it signs with a null link, now rather than at
      // the next sweep.
      if (next.kind === 'departure') wakeLegsWaitingOn(sessionId)
      continue
    }
    break // transient: try again on the next trigger
  }
  if (signedAny) notifySigned(sessionId)
}

/**
 * After a workday stop's departure is signed, or refused: try signing the
 * next stop's arrival_context now, which was waiting for it (T6b item 11),
 * rather than leave it for the next sweep. Never throws.
 */
function wakeLegsWaitingOn(sessionId: string): void {
  if (!isWorkdayEnabled()) return
  try {
    const session = getSession(sessionId)
    if (!session) return
    for (const id of legsWaitingOnDeparture(session, loadSessions())) void enqueueSigning(id)
  } catch (err) {
    console.warn('[signing] could not wake the next workday stop:', err)
  }
}

function recordArrivalRejection(sessionId: string, code: string): void {
  console.warn(`[signing] link 0 of ${sessionId} was refused: ${code}`)
  updateSigningState(sessionId, (e) => ({ ...e, link0_rejected: { code, at: new Date().toISOString() } }))
  // The refusal lives in the signing state, not on the record, so tell open
  // screens to read again: the record screen's arrival part then says it
  // couldn't be signed instead of "Not signed yet".
  notifyRecordsChanged(sessionId)
}

// ─── Public entry points ─────────────────────────────────────────────────

/**
 * Queue a signed addendum for a record and start signing it. The data is
 * normalised (invalid data throws AddendumValidationError) and frozen with
 * its capture time; the seq is assigned from a fresh read. Returns the
 * stored addendum (or, for arrival_context and departure, the record's
 * existing one), or null when the record can't take one.
 */
export function queueAddendum<K extends AddendumKind>(
  sessionId: string,
  kind: K,
  data: AddendumDataByKind[K],
  options: { captured_at?: string; id?: string } = {},
): SignedAddendum | null {
  const added = appendAddendum(sessionId, { kind, data, ...options })
  if (added) void enqueueSigning(sessionId)
  return added
}

/**
 * Start the evidence chain for a record that was just saved: queue its
 * `arrival_context` (link 1, built from the record and the logging draft)
 * and then sign link 0 and link 1 on the record's queue. Call right after
 * `saveSession`.
 */
export function signNewRecord(
  sessionId: string,
  draft: LogDraft,
  extras: { permit_commitment?: string | null } = {},
): void {
  const session = getSession(sessionId)
  if (!session) return
  try {
    queueAddendum(sessionId, 'arrival_context', buildArrivalContext(session, draft, extras))
  } catch (err) {
    console.warn('[signing] could not queue the arrival context:', err)
  }
  // Link 0 matters on its own, so sign it even if link 1 couldn't queue.
  // When it did queue, this joins the drain already waiting.
  void enqueueSigning(sessionId)
}

/**
 * Departure catch-up for one record: queue a location-less departure
 * addendum when it has `ended_at`, no departure addendum, the grace period
 * has passed, and this device may extend its chain (see
 * `needsDepartureCatchUp`). Returns the queued addendum, or null.
 */
export function catchUpDeparture(sessionId: string, now: number = Date.now()): SignedAddendum | null {
  const session = getSession(sessionId)
  const endedHere = endedOnThisDevice(loadSigningState(), sessionId)
  if (!session || !needsDepartureCatchUp(session, now, { endedHere })) return null
  try {
    return queueAddendum(sessionId, 'departure', departureCatchUpData(session), {
      captured_at: new Date(now).toISOString(),
    })
  } catch (err) {
    console.warn('[signing] could not queue the departure catch-up:', err)
    return null
  }
}

/**
 * Run the departure catch-up for a record once the grace period has passed
 * (called when the driver taps I've left). The departure flow can queue its
 * own departure addendum first; the catch-up then finds it and does nothing.
 * Also marks the record as ended on this device (`markEndedOnThisDevice`),
 * so the sweep can still catch it up if the tab closes before the timer.
 * Returns a cancel function (for the timer; the mark stays).
 */
export function scheduleDepartureCatchUp(
  sessionId: string,
  delayMs: number = DEPARTURE_CATCH_UP_GRACE_MS + 1_000,
): () => void {
  markEndedOnThisDevice(sessionId)
  const timer = setTimeout(() => {
    catchUpDeparture(sessionId)
  }, delayMs)
  return () => clearTimeout(timer)
}

/**
 * The signing sweep: for every record (not a shared copy, arrived within the
 * horizon) with signing work outstanding (an unsigned link 0 that wasn't
 * refused, a pending addendum, or a departure to catch up), at most once
 * per SWEEP_THROTTLE_MS per record, queue the catch-up and a drain.
 * Transient failures never count against a record. Never throws.
 *
 * While the browser reports it is offline the sweep does nothing at all: no
 * request could go out, so stamping the throttle would only make the
 * `online` trigger that follows skip every record. While addendum signing
 * is held (`holdAddendumSigning`) it only looks at records whose link 0 is
 * outstanding; `releaseAddendumSigning` sweeps again for the rest.
 */
export function runSigningSweep(now: number = Date.now()): void {
  try {
    localStorage.removeItem(LEGACY_RETRY_LOG_KEY)
  } catch {
    /* best-effort */
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  let sessions: ParkingSession[]
  try {
    sessions = loadSessions()
  } catch {
    return
  }
  const state = loadSigningState()
  const toDrain: string[] = []
  for (const session of sessions) {
    if (session.shared_from) continue
    const age = now - Date.parse(session.arrived_at)
    if (!Number.isFinite(age) || age > RETRY_HORIZON_MS) continue
    const entry = state[session.id] ?? {}
    const linkZeroWork = !session.signature && !entry.link0_rejected && !entry.pulled
    // While held, a record with only addendum work isn't looked at (or
    // throttled), so the sweep at the release takes it.
    const catchUp = !addendaHeld && needsDepartureCatchUp(session, now, { endedHere: entry.ended_here === true })
    const work = linkZeroWork || (!addendaHeld && hasPendingAddenda(session)) || catchUp
    if (!work) continue
    if (entry.last !== undefined && now - entry.last < SWEEP_THROTTLE_MS) continue
    state[session.id] = { ...entry, last: now }
    if (catchUp) {
      try {
        appendAddendum(session.id, {
          kind: 'departure',
          data: departureCatchUpData(session),
          captured_at: new Date(now).toISOString(),
        })
      } catch (err) {
        console.warn('[signing] could not queue the departure catch-up:', err)
      }
    }
    toDrain.push(session.id)
  }
  // Forget records that are gone, so the state doesn't grow forever.
  const known = new Set(sessions.map((s) => s.id))
  for (const id of Object.keys(state)) if (!known.has(id)) delete state[id]
  saveSigningState(state)
  for (const id of toDrain) void enqueueSigning(id)
}

/**
 * Re-run the sweep when the browser comes back online and when the page
 * becomes visible again. Returns the uninstall function.
 */
export function installSigningTriggers(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const onOnline = () => runSigningSweep()
  const onVisibility = () => {
    if (document.visibilityState === 'visible') runSigningSweep()
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}

/** Test-only: forget queued drains, the listener, the records it missed, and any hold. */
export function resetSigningQueueForTests(): void {
  drains.clear()
  waiting.clear()
  signedListener = null
  unmirrored.clear()
  addendaHeld = false
  if (holdTimer !== null) clearTimeout(holdTimer)
  holdTimer = null
}
