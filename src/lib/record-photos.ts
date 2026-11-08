// Adding condition and proof photos to a saved record (build spec T2,
// items 5 and 6), and tidying away photos a screen took and then dropped.
//
// A photo added after saving is signed as its own part of the record: a
// `condition` addendum (one to five photos and the driver's note) or a
// `compliance` addendum (one photo and what it shows). Its PhotoRef also
// goes into the record's `photos`, so every screen, the PDF and cloud sync
// find it like any other photo (N1).
import type { ComplianceType, PhotoRef, SignedAddendum } from '../types'
import { CAPS } from '../../lambda/addendum-schema.js'
import { fitText } from './evidence-chain'
import { photoRefData, referencedPhotoHashes } from './evidence-photos'
import { hashDataUrlImage } from './hash'
import { deletePhotos } from './photo-store'
import { whenPhotoWritesSettle } from './session-photos'
import { queueAddendum } from './signing'
import { getSession, updateSession } from './storage'

/**
 * Add photo refs to a record's `photos`, skipping any it already has (same
 * role and hash). Reads the record fresh. Returns false when the record is
 * missing or a read-only shared copy. Can throw StorageFullError.
 */
export function addPhotoRefsToRecord(sessionId: string, refs: readonly PhotoRef[]): boolean {
  const session = getSession(sessionId)
  if (!session || session.shared_from) return false
  const current = Array.isArray(session.photos) ? session.photos : []
  const have = new Set(current.map((r) => `${r?.role}/${r?.sha256}`))
  const added = refs.filter((r) => !have.has(`${r.role}/${r.sha256}`)).map(photoRefData)
  if (added.length === 0) return true
  updateSession(sessionId, { photos: [...current, ...added] })
  return true
}

/**
 * Add the refs of photos a part was just queued with to the record's list.
 * The part is queued either way, and it carries the photos (so their bytes
 * are kept: the record refers to them through it), so a failure here (the
 * device's storage is full) is logged, never thrown: the caller must not
 * offer to queue the same photos a second time.
 */
function listQueuedPhotos(sessionId: string, refs: readonly PhotoRef[]): void {
  try {
    addPhotoRefsToRecord(sessionId, refs)
  } catch (err) {
    console.warn('[photos] a part was queued, but its photos could not be listed on the record:', err)
  }
}

/**
 * Sign condition photos taken after saving (`when: 'parking'`), or on return
 * when the departure part was already queued without them (`'return'`):
 * queue a `condition` addendum with the photos (at most five) and the
 * driver's note, then add the refs to the record. Returns the queued
 * addendum, or null when nothing could be queued (no photos, the record
 * can't take another part). Throws AddendumValidationError for data the
 * schema refuses, and StorageFullError when the part itself can't be
 * stored (then nothing was queued).
 */
export function addConditionPhotos(
  sessionId: string,
  when: 'parking' | 'return',
  refs: readonly PhotoRef[],
  note: string | null,
): SignedAddendum | null {
  const photos = refs.slice(0, CAPS.conditionPhotosMax).map(photoRefData)
  if (photos.length < CAPS.conditionPhotosMin) return null
  const queued = queueAddendum(sessionId, 'condition', { when, photos, note: fitText(note, CAPS.note) })
  if (queued) listQueuedPhotos(sessionId, photos)
  return queued
}

/**
 * Sign a proof photo taken after saving: queue a `compliance` addendum with
 * the photo and what it shows, then add the ref to the record. Returns the
 * queued addendum, or null when the record can't take another part. Throws
 * StorageFullError only when the part itself can't be stored.
 */
export function addCompliancePhoto(
  sessionId: string,
  complianceType: ComplianceType,
  ref: PhotoRef,
): SignedAddendum | null {
  const photo = photoRefData(ref)
  const queued = queueAddendum(sessionId, 'compliance', { compliance_type: complianceType, photo })
  if (queued) listQueuedPhotos(sessionId, [photo])
  return queued
}

/**
 * Delete photos a screen took for a saved record and then dropped (a sheet
 * cancelled, a photo retaken): once every photo write for the record has
 * settled, the bytes of these data URLs, unless the record refers to them
 * or their hash is in `keep` (photos on their way into the record). Only
 * these hashes are touched, so the record's other photos and photos another
 * screen is taking stay. Never throws; resolves with how many were deleted.
 */
export async function discardUnreferencedPhotos(
  sessionId: string,
  dataUrls: readonly string[],
  keep: Iterable<string> = [],
): Promise<number> {
  if (dataUrls.length === 0) return 0
  try {
    await whenPhotoWritesSettle(sessionId)
    const hashes = new Set<string>()
    for (const url of new Set(dataUrls)) {
      try {
        hashes.add(await hashDataUrlImage(url))
      } catch {
        /* not a data URL: nothing of it was stored */
      }
    }
    return await deleteUnreferenced(sessionId, hashes, keep)
  } catch (err) {
    console.warn('[photos] could not tidy dropped photos:', err)
    return 0
  }
}

/**
 * The same tidy for photos known by their refs (the departure sheet's
 * photos when no part of the record could take them): once every photo
 * write for the record has settled, delete these hashes unless the record
 * refers to them. Never throws; resolves with how many were deleted.
 */
export async function discardUnreferencedRefs(sessionId: string, refs: readonly PhotoRef[]): Promise<number> {
  if (refs.length === 0) return 0
  try {
    await whenPhotoWritesSettle(sessionId)
    return await deleteUnreferenced(sessionId, new Set(refs.map((r) => r.sha256)), [])
  } catch (err) {
    console.warn('[photos] could not tidy dropped photos:', err)
    return 0
  }
}

async function deleteUnreferenced(sessionId: string, hashes: ReadonlySet<string>, keep: Iterable<string>): Promise<number> {
  const kept = new Set(keep)
  const session = getSession(sessionId)
  const referenced = session ? referencedPhotoHashes(session) : new Set<string>()
  return deletePhotos(
    sessionId,
    [...hashes].filter((h) => !referenced.has(h) && !kept.has(h)),
  )
}
