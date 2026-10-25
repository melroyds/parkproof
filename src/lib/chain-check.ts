// "Check signatures" on the record screen (build spec T1a), as a function
// with its dependencies passed in, so the chain panel stays thin and the
// rules below are tested on their own:
//
//   - Photos whose bytes aren't on this device are fetched from the
//     signed-in driver's cloud copy first, at most CHECK_PHOTO_CONCURRENCY
//     at a time (the account's Lambda concurrency is small, and a throttled
//     fetch would read as "Photo not on this device"), then the record is
//     checked again.
//   - A photo ref's bytes are fetched by fingerprint (checked and kept in
//     the photo store by the fetcher). An older record's sign, car or
//     ambient photo with no ref is held on a second device only as a cloud
//     URL, so its bytes are fetched by role and handed to the verifier as
//     `localPhotos`, never written into the record.
//   - The record is read again after each check. When its chain changed
//     meanwhile (a part got signed while the check ran), the check runs
//     again on the new copy, up to CHECK_MAX_PASSES times, so a result
//     always describes one stored chain.
//
// verify.ts itself stays network-free; the fetchers do the network.
import type { ParkingSession, PhotoRole } from '../types'
import { chainFingerprint } from './chain-view'
import { createLimiter } from './concurrency'
import { isLegacyPhotoRole, photoRefFor, type LegacyPhotoRole } from './session-photos'
import type { RecordVerification, VerifyOptions } from './verify'

/** Cloud photo fetches in flight at once during a check (the PDF's limit too). */
export const CHECK_PHOTO_CONCURRENCY = 4
/** Checks run at most this many times when the chain keeps changing underneath. */
export const CHECK_MAX_PASSES = 2

export interface ChainCheckDeps {
  /** verify.ts `verifyRecord`. */
  verify: (session: ParkingSession, options?: VerifyOptions) => Promise<RecordVerification>
  /** The stored copy of the record now, or null when it isn't stored. */
  reread: () => ParkingSession | null
  /** A ref's bytes from the cloud, by fingerprint (data URL), or null. Never throws. */
  fetchRef: (sessionId: string, sha256: string) => Promise<string | null>
  /** A legacy photo's bytes from the cloud, by role (data URL), or null. May throw. */
  fetchLegacy: (sessionId: string, role: LegacyPhotoRole) => Promise<string | null>
  /** Fetches in flight at once. Default CHECK_PHOTO_CONCURRENCY. */
  concurrency?: number
}

export interface ChainCheckOutcome {
  result: RecordVerification
  /** `chainFingerprint` of the copy that was checked. */
  fingerprint: string
  /** True when the stored chain still differed from the checked one after the last pass. */
  stale: boolean
}

/**
 * Fetch the bytes of the photos the check couldn't find on this device.
 * Returns true when anything came back (the record is worth checking again).
 */
async function fetchMissingPhotos(
  session: ParkingSession,
  result: RecordVerification,
  deps: ChainCheckDeps,
  localPhotos: Map<PhotoRole, string>,
): Promise<boolean> {
  if (session.shared_from) return false
  const missing = result.photos.filter((p) => p.status === 'not_on_device')
  if (missing.length === 0) return false
  const limit = createLimiter(deps.concurrency ?? CHECK_PHOTO_CONCURRENCY)
  const fetched = await Promise.all(
    missing.map((photo) =>
      limit(async () => {
        try {
          if (isLegacyPhotoRole(photo.role) && !photoRefFor(session, photo.role)) {
            if (localPhotos.has(photo.role)) return false
            const dataUrl = await deps.fetchLegacy(session.id, photo.role)
            if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return false
            localPhotos.set(photo.role, dataUrl)
            return true
          }
          const dataUrl = await deps.fetchRef(session.id, photo.sha256)
          return typeof dataUrl === 'string'
        } catch (err) {
          console.warn('[verify] could not fetch a photo from the cloud:', err)
          return false
        }
      }),
    ),
  )
  return fetched.some(Boolean)
}

/**
 * Run "Check signatures" for a record. Throws only what `verify` throws
 * (VerifierUnavailableError without WebCrypto).
 */
export async function runChainCheck(session: ParkingSession, deps: ChainCheckDeps): Promise<ChainCheckOutcome> {
  let current = session
  const localPhotos = new Map<PhotoRole, string>()
  const verifyOnce = (s: ParkingSession) => (localPhotos.size > 0 ? deps.verify(s, { localPhotos }) : deps.verify(s))
  let outcome: ChainCheckOutcome | null = null
  for (let pass = 0; pass < CHECK_MAX_PASSES; pass++) {
    let result = await verifyOnce(current)
    if (await fetchMissingPhotos(current, result, deps, localPhotos)) {
      current = deps.reread() ?? current
      result = await verifyOnce(current)
    }
    const fingerprint = chainFingerprint(current)
    const latest = deps.reread() ?? current
    const stale = chainFingerprint(latest) !== fingerprint
    outcome = { result, fingerprint, stale }
    if (!stale) break
    current = latest
  }
  return outcome as ChainCheckOutcome
}
