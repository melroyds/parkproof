// Opening a share link (build spec T7 items 3 and 4): verify the sender's
// arrival bundle with the in-browser verifier (verify.ts), then keep a
// read-only copy of the record on this device.
import type { SharePayload } from './share-link'
import { isStorageFullError, upsertSharedCopy, type SharedCopyResult } from './storage'
import type { TrustedKey } from './verify'
import { linkExtras, sharedCopyRecord, sharedFacts, shareOutcome, type SharedFacts } from './shared-record'

export type ShareSaveStatus = SharedCopyResult['status'] | 'storage_full' | 'failed'

/** What the receive view shows once the check has run. */
export type ShareOpenResult =
  /** The bundle checked out: these facts, and what happened to the copy. */
  | { kind: 'shown'; outcome: 'valid' | 'dev_key'; facts: SharedFacts; saved: ShareSaveStatus; recordId: string | null }
  /** The bundle doesn't check out: "This link has been changed since it was shared". Nothing is stored. */
  | { kind: 'changed' }
  /** The signed payload checked out but lacks what a share shows. Nothing is stored. */
  | { kind: 'unreadable' }
  /** This browser can't run the verifier. Nothing was checked or stored. */
  | { kind: 'unavailable' }

export interface OpenShareOptions {
  /** Keys to trust instead of ParkProof's published key (tests). */
  publicKeys?: readonly TrustedKey[]
  /** Accept a development-key bundle (default: development builds only). */
  acceptDevKey?: boolean
  /** The receive time; defaults to now. */
  now?: Date
  /** The copy's new local id; defaults to a fresh uuid. */
  newId?: string
}

/**
 * Check a decoded share link and, when it checks out, store (or update)
 * the read-only copy. Never throws: a storage failure is reported in
 * `saved`, and the facts still show.
 */
export async function openShareLink(payload: SharePayload, options: OpenShareOptions = {}): Promise<ShareOpenResult> {
  let check
  let verifier: typeof import('./verify') | null = null
  try {
    // The verifier is its own chunk (as for the record screen's chain
    // panel): a share link is the only thing on this path that needs it.
    verifier = await import('./verify')
    check = await verifier.verifyArrivalBundle(payload.bundle, { publicKeys: options.publicKeys })
  } catch (err) {
    // The verifier couldn't load, or can't run here: nothing was checked,
    // which is not the same as a changed link.
    if (!verifier || verifier.isVerifierUnavailable(err)) return { kind: 'unavailable' }
    console.warn('[share] the link could not be checked:', err)
    return { kind: 'changed' }
  }
  const outcome = shareOutcome(check, options.acceptDevKey)
  if (outcome === 'changed' || !check.bundle) return { kind: 'changed' }
  const { extras, sharedAt } = linkExtras(payload)
  const facts = sharedFacts(check.payload, extras, sharedAt)
  if (!facts) return { kind: 'unreadable' }

  const receivedAt = (options.now ?? new Date()).toISOString()
  const copy = sharedCopyRecord(facts, check.bundle, receivedAt, options.newId ?? crypto.randomUUID())
  let saved: ShareSaveStatus
  let recordId: string | null = null
  try {
    const result = upsertSharedCopy(copy)
    saved = result.status
    recordId = result.record.id
  } catch (err) {
    console.warn('[share] could not keep a copy of the shared record:', err)
    saved = isStorageFullError(err) ? 'storage_full' : 'failed'
  }
  return { kind: 'shown', outcome, facts, saved, recordId }
}
