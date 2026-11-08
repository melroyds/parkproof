// Merging a record's evidence between this device and the cloud (build
// spec T0b4). Pure: no storage, no network, no clock.
//
// The rules mirror the server's (`mergeSessionRows` in lambda/cloud-sync.js),
// with this device's copy in the place of the stored row:
//   - addenda: union by id. A signed addendum this device holds is never
//     dropped or replaced; otherwise the copy with a bundle wins. A cloud
//     addendum that is still pending is never adopted: a pending link
//     belongs to the device that queued it (only that device signs it), so
//     another copy signing it too would give one link two signatures.
//   - signature, chain_key, v1_hashes: this device's value when it has one
//     (link 0 is first-write-wins; the addenda signed here hang off it).
//   - ended_at, departure: this device's value, or the cloud's when this
//     device has none.
//   - photos: union by role and sha256.
//   - everything else: this device's copy (it is the source of truth here;
//     the next upload makes the cloud match it).
// After a merge the pending addenda are renumbered to follow the highest
// signed link, so a link queued here goes on top of links signed elsewhere
// instead of forking beside them.
import type { ParkingSession, PhotoRef, SignedAddendum } from '../types'
import { MAX_ADDENDA, compactPendingSeqs } from './evidence-chain'

const isSigned = (a: SignedAddendum): boolean => !!a.bundle
const isRejected = (a: SignedAddendum): boolean => !a.bundle && !!a.rejected
const isPending = (a: SignedAddendum): boolean => !a.bundle && !a.rejected

function isAddendum(a: unknown): a is SignedAddendum {
  if (!a || typeof a !== 'object') return false
  const x = a as Record<string, unknown>
  return typeof x.id === 'string' && typeof x.seq === 'number' && typeof x.kind === 'string' && typeof x.captured_at === 'string'
}

function isPhotoRef(p: unknown): p is PhotoRef {
  if (!p || typeof p !== 'object') return false
  const x = p as Record<string, unknown>
  return typeof x.role === 'string' && typeof x.sha256 === 'string'
}

const byQueueOrder = (a: SignedAddendum, b: SignedAddendum): number =>
  a.seq - b.seq || a.captured_at.localeCompare(b.captured_at) || a.id.localeCompare(b.id)

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * The shape /sessions/upload accepts (`readAddenda` in lambda/cloud-sync.js
 * refuses the whole upload otherwise), so one malformed entry can't stop a
 * record from ever syncing again.
 */
function hasUploadShape(a: SignedAddendum): boolean {
  if (a.id.length === 0 || a.id.length > 64) return false
  if (!Number.isInteger(a.seq) || a.seq < 1 || a.seq > 100) return false
  if (!isPlainObject(a.data)) return false
  const b = a.bundle as unknown
  if (b !== undefined && (!isPlainObject(b) || typeof b.canonical_payload !== 'string' || typeof b.signature_base64 !== 'string')) {
    return false
  }
  const r = a.rejected as unknown
  if (r !== undefined && (!isPlainObject(r) || typeof r.code !== 'string')) return false
  return true
}

/**
 * The addenda that go to the cloud: signed and rejected ones (in the shape
 * the server accepts). Pending addenda stay on the device that queued them
 * until they are signed (see the module comment). Undefined stays
 * undefined.
 */
export function uploadableAddenda(addenda: SignedAddendum[] | undefined): SignedAddendum[] | undefined {
  if (!Array.isArray(addenda)) return addenda
  return addenda.filter((a) => isAddendum(a) && !isPending(a) && hasUploadShape(a))
}

const SHA256_HEX_RE = /^[0-9a-f]{64}$/

/** The photo refs that go to the cloud: the ones the server accepts (a role and a sha256). */
export function uploadablePhotoRefs(photos: PhotoRef[] | undefined): PhotoRef[] | undefined {
  if (!Array.isArray(photos)) return photos
  return photos.filter((p) => isPlainObject(p) && typeof p.role === 'string' && typeof p.sha256 === 'string' && SHA256_HEX_RE.test(p.sha256))
}

/**
 * Union of this device's addenda with the cloud's (rules in the module
 * comment), pending ones renumbered after the highest signed link, capped
 * at MAX_ADDENDA. This device's entries keep their order; adopted ones
 * follow in chain order. Returns `local` itself when nothing was adopted.
 */
export function mergeAddenda(
  local: SignedAddendum[] | undefined,
  cloud: SignedAddendum[] | undefined,
): SignedAddendum[] | undefined {
  const mine = (Array.isArray(local) ? local : []).filter(isAddendum)
  const merged = new Map<string, SignedAddendum>()
  for (const a of mine) if (!merged.has(a.id)) merged.set(a.id, a)
  const adopted = new Set<string>()
  let changed = false
  const theirs = (Array.isArray(cloud) ? cloud : []).filter(isAddendum).sort(byQueueOrder)
  for (const c of theirs) {
    if (isPending(c)) continue
    const l = merged.get(c.id)
    if (!l) {
      merged.set(c.id, c)
      adopted.add(c.id)
      changed = true
      continue
    }
    if (isSigned(l)) continue
    if (isSigned(c) || (isRejected(c) && !isRejected(l))) {
      merged.set(c.id, c)
      changed = true
    }
  }
  if (!changed) return local

  const ordered = [
    ...mine.filter((a, i) => mine.findIndex((b) => b.id === a.id) === i).map((a) => merged.get(a.id)!),
    ...[...adopted].map((id) => merged.get(id)!),
  ]
  const compacted = compactPendingSeqs(ordered)
  if (compacted.length <= MAX_ADDENDA) return compacted
  // Over the cap: this device's signed links, then signed links from the
  // cloud, then this device's pending links, then rejections.
  const localIds = new Set(mine.map((a) => a.id))
  const tier = (a: SignedAddendum): number =>
    isSigned(a) ? (localIds.has(a.id) && !adopted.has(a.id) ? 0 : 1) : isPending(a) ? 2 : 3
  const ranked = [...compacted].sort((a, b) => tier(a) - tier(b) || byQueueOrder(a, b))
  const mustKeep = ranked.filter((a) => tier(a) === 0)
  const rest = ranked.filter((a) => tier(a) !== 0)
  const keep = new Set([...mustKeep, ...rest.slice(0, Math.max(0, MAX_ADDENDA - mustKeep.length))].map((a) => a.id))
  return compacted.filter((a) => keep.has(a.id))
}

/** Union of photo refs by role and sha256, this device's first. Returns `local` when nothing was added. */
export function mergePhotoRefs(local: PhotoRef[] | undefined, cloud: PhotoRef[] | undefined): PhotoRef[] | undefined {
  const mine = Array.isArray(local) ? local : []
  const seen = new Set(mine.filter(isPhotoRef).map((p) => `${p.role}/${p.sha256}`))
  const added: PhotoRef[] = []
  for (const p of Array.isArray(cloud) ? cloud : []) {
    if (!isPhotoRef(p)) continue
    const key = `${p.role}/${p.sha256}`
    if (seen.has(key)) continue
    seen.add(key)
    added.push(p)
  }
  return added.length === 0 ? local : [...mine, ...added]
}

const isNone = (v: unknown): boolean => v === undefined || v === null

/** Fields this device keeps when it has them, and takes from the cloud when it doesn't. */
const FILL_FROM_CLOUD = ['signature', 'chain_key', 'v1_hashes', 'ended_at', 'departure'] as const

/**
 * This device's record with the cloud copy's evidence merged in (rules in
 * the module comment). Pure; returns a new object (or `local` itself for a
 * read-only shared copy, which never syncs).
 */
export function mergeEvidence(local: ParkingSession, cloud: ParkingSession): ParkingSession {
  if (local.shared_from) return local
  const out: ParkingSession = { ...local }
  const target = out as unknown as Record<string, unknown>
  const source = cloud as unknown as Record<string, unknown>
  for (const f of FILL_FROM_CLOUD) {
    if (isNone(target[f]) && !isNone(source[f])) target[f] = source[f]
  }
  const addenda = mergeAddenda(local.addenda, cloud.addenda)
  if (addenda !== local.addenda) out.addenda = addenda
  const photos = mergePhotoRefs(local.photos, cloud.photos)
  if (photos !== local.photos) out.photos = photos
  return out
}

/** The evidence fields `mergeEvidence` can change. */
const EVIDENCE_FIELDS = [...FILL_FROM_CLOUD, 'addenda', 'photos'] as const

/** Do two copies of a record hold the same evidence? (A false "different" only costs an extra write.) */
export function sameEvidence(a: ParkingSession, b: ParkingSession): boolean {
  const ra = a as unknown as Record<string, unknown>
  const rb = b as unknown as Record<string, unknown>
  return EVIDENCE_FIELDS.every((f) => JSON.stringify(ra[f] ?? null) === JSON.stringify(rb[f] ?? null))
}

/**
 * Does this device's (merged) copy hold evidence the cloud copy lacks: a
 * link 0, chain key, photo hashes, end or departure the cloud has none of,
 * a signed or rejected addendum it doesn't have (or has only pending), or
 * a photo ref it doesn't list? Then the record is uploaded again.
 */
export function cloudLacksEvidence(merged: ParkingSession, cloud: ParkingSession): boolean {
  const m = merged as unknown as Record<string, unknown>
  const c = cloud as unknown as Record<string, unknown>
  for (const f of FILL_FROM_CLOUD) if (!isNone(m[f]) && isNone(c[f])) return true
  const cloudAddenda = new Map((Array.isArray(cloud.addenda) ? cloud.addenda : []).filter(isAddendum).map((a) => [a.id, a]))
  for (const a of uploadableAddenda(merged.addenda) ?? []) {
    const there = cloudAddenda.get(a.id)
    if (!there) return true
    if (isSigned(a) && !isSigned(there)) return true
    if (isRejected(a) && isPending(there)) return true
  }
  const cloudPhotos = new Set((Array.isArray(cloud.photos) ? cloud.photos : []).filter(isPhotoRef).map((p) => `${p.role}/${p.sha256}`))
  for (const p of uploadablePhotoRefs(merged.photos) ?? []) {
    if (!cloudPhotos.has(`${p.role}/${p.sha256}`)) return true
  }
  return false
}

/**
 * A cloud record as it is first stored on this device: its pending addenda
 * (from an older client that uploaded them) are left out, for the reason
 * in the module comment, and so is `photo_sync_failed`, which only ever
 * describes the device that set it.
 */
export function pulledRecord(cloud: ParkingSession): ParkingSession {
  const out: ParkingSession = { ...cloud }
  delete out.photo_sync_failed
  if (Array.isArray(cloud.addenda)) out.addenda = cloud.addenda.filter((a) => isAddendum(a) && !isPending(a))
  return out
}
