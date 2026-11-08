// @vitest-environment happy-dom
//
// Opening a share link (build spec T7 items 3 and 4), against bundles the
// REAL Lambda handler signed with a local test key: the place, arrival and
// expiry come from the verified signed payload; a changed link, a bundle
// from another key or a development key in a production build shows
// nothing and keeps nothing; a link that checks out leaves exactly one
// read-only copy per original record (opening it again updates that copy),
// which never becomes active, never needs signing and checks out again
// with the in-browser verifier.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession } from '../types'
import { createTestSigner, type TestSigner } from './test-support/test-signer'
import { signedOwnRecord } from './test-support/share-fixtures'
import { decodeShareToken, makeShareToken, type SharePayload } from './share-link'
import { openShareLink, type ShareOpenResult } from './share-receive'
import { sharedFactsOfCopy } from './shared-record'
import { appendAddendum, hasUnsignedEvidence, loadActiveSessions, loadSessions, saveSession, upsertSharedCopy } from './storage'
import { verifyArrivalBundle, verifyRecord } from './verify'

let signer: TestSigner
let devSigner: TestSigner
let otherSigner: TestSigner

beforeAll(async () => {
  signer = await createTestSigner()
  devSigner = await createTestSigner({ keyAlias: 'dev-ephemeral' })
  otherSigner = await createTestSigner()
})

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const trust = () => ({ publicKeys: [signer.publicKey], acceptDevKey: false })

/** The link a record makes, as the receiving phone decodes it. */
function linkOf(session: ParkingSession, now = new Date()): SharePayload {
  const built = makeShareToken(session, { now })
  if (!built.ok) throw new Error(`no link: ${built.error}`)
  const read = decodeShareToken(built.token)
  if (!read.ok) throw new Error(`unreadable link: ${read.error}`)
  return read.payload
}

function shown(result: ShareOpenResult) {
  if (result.kind !== 'shown') throw new Error(`expected the link to show, got ${result.kind}`)
  return result
}

describe('a link that checks out', () => {
  it('shows the place, coordinates, arrival and expiry from the signed payload', async () => {
    const original = await signedOwnRecord(signer)
    // The sender's phone changed its copy after signing: the link still
    // carries only what was signed.
    const edited = { ...original, location: { ...original.location!, address: '99 Fake St' }, expires_at: null }
    const result = shown(await openShareLink(linkOf(edited), trust()))
    expect(result.outcome).toBe('valid')
    expect(result.facts.location).toMatchObject({ address: '12 King St, Melbourne', lat: -37.8136, lng: 144.9631 })
    expect(result.facts.arrived_at).toBe(original.arrived_at)
    expect(result.facts.expires_at).toBe(original.expires_at)
    expect(result.facts.original_session_id).toBe(original.id)
    expect(result.facts.time_zone).toBe('Australia/Melbourne')
    expect(result.facts.signed_at).toBe(JSON.parse(original.signature!.canonical_payload).signed_at)
    // The extras stay apart, as the sender's.
    expect(result.facts.extras).toMatchObject({ driver: 'Sam', rules: '2P Mon-Fri 8am-6pm' })
  })

  it('keeps a read-only copy: a new local id, the sender bundle in shared_from, nothing of the sender device', async () => {
    const original = await signedOwnRecord(signer, { ended_at: new Date().toISOString() })
    const now = new Date()
    const result = shown(await openShareLink(linkOf(original, now), { ...trust(), now, newId: 'copy-1' }))
    expect(result.saved).toBe('created')
    expect(result.recordId).toBe('copy-1')
    const stored = loadSessions()
    expect(stored).toHaveLength(1)
    const copy = stored[0]
    expect(copy.id).toBe('copy-1')
    expect(copy.id).not.toBe(original.id)
    expect(copy.signature).toBeUndefined()
    expect(copy.chain_key).toBeUndefined()
    expect(copy.photos).toBeUndefined()
    expect(copy.addenda).toBeUndefined()
    // The sender's say-so stays in the snapshot, never on the record itself.
    expect(copy.driver_name).toBeUndefined()
    expect(copy.ended_at).toBeUndefined()
    expect(copy.shared_from).toMatchObject({
      original_session_id: original.id,
      received_at: now.toISOString(),
      shared_at: now.toISOString(),
      snapshot: { driver: 'Sam', ended_at: original.ended_at, rules: '2P Mon-Fri 8am-6pm', standard_until: null },
    })
    expect(copy.shared_from!.arrival_bundle!.signature_base64).toBe(original.signature!.signature_base64)
    expect(copy.shared_from!.arrival_bundle!.canonical_payload).toBe(original.signature!.canonical_payload)
    // The record's own fields are the signed ones.
    expect(copy.location?.address).toBe('12 King St, Melbourne')
    expect(copy.expires_at).toBe(original.expires_at)
    expect(copy.rules).toBe('2P Mon-Fri 8am-6pm')
  })

  it('updates the same copy when the link is opened again (deduplicated on the original id)', async () => {
    const original = await signedOwnRecord(signer)
    const first = new Date(Date.now() - 60_000)
    shown(await openShareLink(linkOf(original, first), { ...trust(), now: first, newId: 'copy-1' }))
    const again = new Date()
    const handedOver = { ...original, driver_name: 'Alex' }
    const second = shown(await openShareLink(linkOf(handedOver, again), { ...trust(), now: again, newId: 'copy-2' }))
    expect(second.saved).toBe('updated')
    expect(second.recordId).toBe('copy-1')
    const copies = loadSessions().filter((s) => s.shared_from?.original_session_id === original.id)
    expect(copies.map((c) => c.id)).toEqual(['copy-1'])
    expect(copies[0].shared_from?.snapshot).toMatchObject({ driver: 'Alex' })
    expect(copies[0].shared_from?.received_at).toBe(again.toISOString())
  })

  it('keeps a copy from a later link when an older link is opened', async () => {
    const original = await signedOwnRecord(signer)
    const later = new Date()
    shown(await openShareLink(linkOf({ ...original, driver_name: 'Alex' }, later), { ...trust(), newId: 'copy-1' }))
    const older = new Date(later.getTime() - 3_600_000)
    const result = shown(await openShareLink(linkOf(original, older), { ...trust(), newId: 'copy-2' }))
    expect(result.saved).toBe('kept_newer')
    // The link still shows its own snapshot; the stored copy keeps the later one.
    expect(result.facts.extras.driver).toBe('Sam')
    expect(loadSessions()).toHaveLength(1)
    expect(loadSessions()[0].shared_from?.snapshot).toMatchObject({ driver: 'Alex' })
  })

  it("never shadows the driver's own record with a copy of itself", async () => {
    const original = await signedOwnRecord(signer)
    saveSession(original)
    const result = shown(await openShareLink(linkOf(original), trust()))
    expect(result.saved).toBe('own_record')
    expect(result.recordId).toBe(original.id)
    expect(loadSessions().map((s) => s.id)).toEqual([original.id])
  })

  it('a copy is never active, never waits for signing, never takes addenda, and checks out again', async () => {
    const original = await signedOwnRecord(signer)
    shown(await openShareLink(linkOf(original), { ...trust(), newId: 'copy-1' }))
    const copy = loadSessions()[0]
    // Its limit is 90 minutes away, but it is someone else's park.
    expect(loadActiveSessions()).toEqual([])
    saveSession({ ...original, id: crypto.randomUUID(), signature: undefined })
    expect(loadActiveSessions()).toHaveLength(1)
    expect(hasUnsignedEvidence(copy)).toBe(false)
    expect(appendAddendum(copy.id, { kind: 'departure', data: { ended_at: new Date().toISOString(), location: null, distance_from_arrival_m: null, return_photos: [] } })).toBeNull()
    // "Check the signature": the sender's bundle against the sender's id.
    const check = await verifyArrivalBundle(copy.shared_from!.arrival_bundle, {
      sessionId: copy.shared_from!.original_session_id,
      publicKeys: [signer.publicKey],
    })
    expect(check.status).toBe('valid')
    const record = await verifyRecord(copy, { publicKeys: [signer.publicKey] })
    expect(record.overall).toBe('valid')
    // The copy's screen reads the same facts back from its stored bundle.
    expect(sharedFactsOfCopy(copy)).toMatchObject({
      original_session_id: original.id,
      arrived_at: original.arrived_at,
      expires_at: original.expires_at,
      extras: { driver: 'Sam' },
    })
  })

  it('upsertSharedCopy refuses a record that is not a shared copy', () => {
    expect(() => upsertSharedCopy({ id: 'x', arrived_at: '', location: null, sign_photo: null, car_photo: null, rules: '', observations: [], expires_at: null, confidence: 'low' })).toThrow()
  })
})

describe('a link that does not check out', () => {
  it('a changed payload shows nothing and keeps nothing', async () => {
    const original = await signedOwnRecord(signer)
    const link = linkOf(original)
    const changed: SharePayload = {
      ...link,
      bundle: { ...link.bundle, canonical_payload: link.bundle.canonical_payload.replace('12 King St', '14 King St') },
    }
    expect(await openShareLink(changed, trust())).toEqual({ kind: 'changed' })
    expect(loadSessions()).toEqual([])
  })

  it('a changed signing time is a changed link', async () => {
    const link = linkOf(await signedOwnRecord(signer))
    expect(await openShareLink({ ...link, bundle: { ...link.bundle, signed_at: new Date(0).toISOString() } }, trust())).toEqual({
      kind: 'changed',
    })
  })

  it('a bundle signed by any other key is a changed link', async () => {
    const link = linkOf(await signedOwnRecord(otherSigner))
    expect(await openShareLink(link, trust())).toEqual({ kind: 'changed' })
    expect(loadSessions()).toEqual([])
  })

  it('a development-key bundle shows only in development builds', async () => {
    const link = linkOf(await signedOwnRecord(devSigner))
    // Production: a development key's signature isn't checked at all, so anyone could forge one.
    expect(await openShareLink(link, { publicKeys: [signer.publicKey], acceptDevKey: false })).toEqual({ kind: 'changed' })
    expect(loadSessions()).toEqual([])
    const dev = shown(await openShareLink(link, { publicKeys: [signer.publicKey], acceptDevKey: true }))
    expect(dev.outcome).toBe('dev_key')
  })

  it('a signed payload without what a share shows is unreadable, and nothing is kept', async () => {
    // The server signs any non-empty record id; a share needs one a record could have.
    const odd = await signedOwnRecord(signer, { id: 'not a record id!' })
    expect(await openShareLink(linkOf(odd), trust())).toEqual({ kind: 'unreadable' })
    expect(loadSessions()).toEqual([])
  })
})

describe('time zones', () => {
  it("shows a record logged without a location in the sender's zone", async () => {
    const noLocation = await signedOwnRecord(signer, { location: null })
    const link = { ...linkOf(noLocation), time_zone: 'Australia/Perth' }
    const result = shown(await openShareLink(link, trust()))
    expect(result.facts.location).toBeNull()
    expect(result.facts.time_zone).toBe('Australia/Perth')
  })

  it('reads the zone from the signed coordinates, never from the sender', async () => {
    const link = { ...linkOf(await signedOwnRecord(signer)), time_zone: 'Australia/Perth' }
    expect(shown(await openShareLink(link, trust())).facts.time_zone).toBe('Australia/Melbourne')
  })
})

describe('a browser that cannot check signatures', () => {
  it('says so, rather than calling the link changed, and keeps nothing', async () => {
    const link = linkOf(await signedOwnRecord(signer))
    vi.stubGlobal('crypto', {})
    expect(await openShareLink(link, { ...trust(), newId: 'copy-1' })).toEqual({ kind: 'unavailable' })
    vi.unstubAllGlobals()
    expect(loadSessions()).toEqual([])
  })
})
