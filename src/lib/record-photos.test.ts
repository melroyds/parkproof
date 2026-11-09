// @vitest-environment happy-dom
//
// Photos added to a saved record (build spec T2, items 5 and 6): each set
// is queued as its own signed part (condition or compliance) with exactly
// the schema's photo shape, the refs join the record's photos, return
// photos go into the departure part (or their own condition part when the
// departure was already queued), and photos a screen dropped are deleted
// without touching anything the record refers to. End to end, the parts
// are signed by the REAL Lambda handler and the whole chain verifies.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession, PhotoRef } from '../types'

vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

import { addCompliancePhoto, addConditionPhotos, addPhotoRefsToRecord, discardUnreferencedPhotos } from './record-photos'
import { completeDeparture, saveDeparture, settleReturnPhotos } from './departure'
import { appendAddendum, endSession, getSession, saveSession } from './storage'
import { emptyLogDraft } from './evidence-chain'
import { createMemoryPhotoBackend, deletePhotos, putPhoto, setPhotoBackendForTests } from './photo-store'
import { hashDataUrlImage } from './hash'
import { prepareNewRecord, resetSigningQueueForTests, signNewRecord, whenSigningIdle } from './signing'
import { storeSessionPhoto } from './session-photos'
import { verifyRecord } from './verify'
import { createTestSigner } from './test-support/test-signer'

const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-photos',
    arrived_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    confidence: 'high',
    ...overrides,
  }
}

async function stored(sessionId: string, role: PhotoRef['role'], text: string, source: PhotoRef['source'] = 'camera_input') {
  const ref = await storeSessionPhoto(sessionId, role, jpeg(text), { captured_at: new Date().toISOString(), source })
  if (!ref) throw new Error('photo not stored')
  return ref
}

let memory: ReturnType<typeof createMemoryPhotoBackend>

beforeEach(() => {
  localStorage.clear()
  resetSigningQueueForTests()
  memory = createMemoryPhotoBackend()
  setPhotoBackendForTests(memory)
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  // No server by default: signing is transient, so queued parts stay pending.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
})

afterEach(async () => {
  await whenSigningIdle()
  setPhotoBackendForTests(null)
  vi.unstubAllGlobals()
})

describe('condition and proof photos after saving', () => {
  it('queues a condition part with the photos (as signed, four keys each), the note, and adds the refs to the record', async () => {
    saveSession(record())
    const front = await stored('rec-photos', 'condition-front', 'front')
    const detail = await stored('rec-photos', 'condition-detail', 'detail', 'library')
    const queued = addConditionPhotos('rec-photos', 'parking', [front, { ...detail, extra: 'x' } as PhotoRef], '  Dent in\nthe door ')
    expect(queued).toMatchObject({ kind: 'condition', seq: 1 })
    expect(queued!.data).toEqual({ when: 'parking', photos: [front, detail], note: 'Dent in the door' })
    const s = getSession('rec-photos')!
    expect(s.photos).toEqual([front, detail])
    expect(s.addenda).toHaveLength(1)
  })

  it('needs at least one photo, and signs at most five', async () => {
    saveSession(record())
    expect(addConditionPhotos('rec-photos', 'parking', [], 'note')).toBeNull()
    expect(getSession('rec-photos')!.addenda ?? []).toEqual([])
    const refs = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => stored('rec-photos', 'condition-front', x)))
    const queued = addConditionPhotos('rec-photos', 'parking', refs, null)!
    expect((queued.data as { photos: unknown[] }).photos).toHaveLength(5)
    expect(getSession('rec-photos')!.photos).toHaveLength(5)
  })

  it('queues a compliance part with the photo and its type', async () => {
    saveSession(record())
    const photo = await stored('rec-photos', 'compliance', 'receipt', 'library')
    const queued = addCompliancePhoto('rec-photos', 'payment_confirmation', photo)
    expect(queued!.data).toEqual({ compliance_type: 'payment_confirmation', photo })
    expect(getSession('rec-photos')!.photos).toEqual([photo])
  })

  it('adds nothing to a shared copy or a missing record', async () => {
    const photo = await stored('rec-photos', 'compliance', 'p')
    expect(addCompliancePhoto('rec-photos', 'other', photo)).toBeNull()
    saveSession(record({ shared_from: { original_session_id: 'o', received_at: 'r', shared_at: null, arrival_bundle: null, snapshot: {} } }))
    expect(addCompliancePhoto('rec-photos', 'other', photo)).toBeNull()
    expect(addPhotoRefsToRecord('rec-photos', [photo])).toBe(false)
    expect(getSession('rec-photos')!.photos).toBeUndefined()
  })

  it('addPhotoRefsToRecord skips refs the record already has', async () => {
    const photo = await stored('rec-photos', 'condition-rear', 'rear')
    saveSession(record({ photos: [photo] }))
    expect(addPhotoRefsToRecord('rec-photos', [photo, photo])).toBe(true)
    expect(getSession('rec-photos')!.photos).toEqual([photo])
  })
})

describe('tidying dropped photos', () => {
  it('deletes only the dropped photos the record does not refer to, keeping the ones on their way in', async () => {
    const kept = await stored('rec-photos', 'car', 'car')
    saveSession(record({ photos: [kept] }))
    const unrelated = await putPhoto('rec-photos', jpeg('another screen'))
    await putPhoto('rec-photos', jpeg('dropped'))
    const incoming = await putPhoto('rec-photos', jpeg('incoming'))
    const n = await discardUnreferencedPhotos('rec-photos', [jpeg('dropped'), jpeg('car'), jpeg('incoming')], [incoming])
    expect(n).toBe(1)
    expect([...memory.records.keys()].sort()).toEqual(
      [kept.sha256, unrelated, incoming].map((sha) => `rec-photos/${sha}`).sort(),
    )
  })

  it('waits for a write still in flight before deleting it', async () => {
    saveSession(record())
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const realAdd = memory.add.bind(memory)
    memory.add = async (r) => {
      await gate
      return realAdd(r)
    }
    const write = storeSessionPhoto('rec-photos', 'condition-front', jpeg('late'), { captured_at: new Date().toISOString(), source: 'camera_input' })
    const tidy = discardUnreferencedPhotos('rec-photos', [jpeg('late')])
    release()
    await write
    expect(await tidy).toBe(1)
    expect(memory.records.size).toBe(0)
  })

  it('deletePhotos deletes by hash for one record only', async () => {
    const a = await putPhoto('rec-a', jpeg('same'))
    const b = await putPhoto('rec-b', jpeg('same'))
    expect(a).toBe(b)
    expect(await deletePhotos('rec-a', [a, await hashDataUrlImage(jpeg('never stored'))])).toBe(1)
    expect([...memory.records.keys()]).toEqual([`rec-b/${b}`])
    await expect(deletePhotos('rec-a', ['not-a-hash'])).rejects.toThrow()
  })
})

describe('return photos on the departure', () => {
  const ENDED = new Date(Date.now() - 60_000).toISOString()

  it('go into the departure part and the record photos', async () => {
    saveSession(record({ ended_at: ENDED }))
    const front = await stored('rec-photos', 'return-front', 'rf')
    const result = saveDeparture('rec-photos', ENDED, null, undefined, [front])
    expect(result.status).toBe('saved')
    const s = getSession('rec-photos')!
    const dep = s.addenda!.find((a) => a.kind === 'departure')!
    expect((dep.data as { return_photos: PhotoRef[] }).return_photos).toEqual([front])
    expect(s.photos).toEqual([front])
    expect(s.departure).toEqual({ ended_at: ENDED, location: null, distance_from_arrival_m: null })
  })

  it('become their own condition part (on return) when the departure was already queued without them', async () => {
    saveSession(record({ ended_at: ENDED }))
    appendAddendum('rec-photos', {
      kind: 'departure',
      data: { ended_at: ENDED, location: null, distance_from_arrival_m: null, return_photos: [] },
    })
    const left = await stored('rec-photos', 'return-left', 'rl')
    saveDeparture('rec-photos', ENDED, null, undefined, [left])
    const s = getSession('rec-photos')!
    expect(s.addenda!.filter((a) => a.kind === 'departure')).toHaveLength(1)
    const cond = s.addenda!.find((a) => a.kind === 'condition')!
    expect(cond.data).toEqual({ when: 'return', photos: [left], note: null })
    expect(s.photos).toEqual([left])
  })

  const V2_WITHOUT_KEY = {
    schema: 'parkproof-evidence-v2',
    signed_at: '2026-11-08T01:00:05.000Z',
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify({ schema: 'parkproof-evidence-v2', chain_key_sha256: 'f'.repeat(64) }),
    signature_base64: 'MEUCIQ',
  }
  const noFix = () => ({
    current: () => ({ status: 'none' as const, reason: 'denied' as const, at: Date.parse(ENDED) }),
    settled: new Promise<never>(() => {}),
    subscribe: () => () => {},
  })

  it('stay on the record, unsigned, when no part can carry them (a chain this device cannot extend)', async () => {
    saveSession(record({ ended_at: ENDED, signature: V2_WITHOUT_KEY }))
    const front = await stored('rec-photos', 'return-front', 'kept-unsigned')
    const result = await completeDeparture('rec-photos', ENDED, noFix(), { returnPhotos: [front] })
    expect(result.status).toBe('saved')
    const s = getSession('rec-photos')!
    expect(s.addenda ?? []).toEqual([])
    expect(s.photos).toEqual([front])
    expect(memory.records.has(`rec-photos/${front.sha256}`)).toBe(true)
  })

  it('another tap ended the record: the sheet\'s photos become its return condition part', async () => {
    const otherTap = new Date(Date.now() - 120_000).toISOString()
    saveSession(record({ ended_at: otherTap }))
    const rear = await stored('rec-photos', 'return-rear', 'other-tap')
    const result = saveDeparture('rec-photos', ENDED, null, undefined, [rear])
    expect(result).toEqual({ status: 'skipped', reason: 'not_this_tap' })
    const s = getSession('rec-photos')!
    expect(s.addenda!.map((a) => [a.kind, (a.data as { when?: string }).when])).toEqual([['condition', 'return']])
    expect(s.photos).toEqual([rear])
  })

  it('a deleted record: completeDeparture tidies the sheet\'s photos away', async () => {
    const front = await stored('rec-photos', 'return-front', 'orphan')
    const result = await completeDeparture('rec-photos', ENDED, noFix(), { returnPhotos: [front] })
    expect(result).toEqual({ status: 'skipped', reason: 'missing' })
    expect(memory.records.size).toBe(0)
  })

  it('settleReturnPhotos: kept on a record ended elsewhere, deleted when the record could not be ended', async () => {
    saveSession(record({ ended_at: ENDED }))
    const kept = await stored('rec-photos', 'return-left', 'ended-elsewhere')
    await settleReturnPhotos('rec-photos', Promise.resolve([kept]))
    expect(getSession('rec-photos')!.addenda!.map((a) => a.kind)).toEqual(['condition'])
    expect(memory.records.has(`rec-photos/${kept.sha256}`)).toBe(true)

    saveSession(record({ id: 'rec-open' }))
    const dropped = await stored('rec-open', 'return-left', 'not-ended')
    await settleReturnPhotos('rec-open', [dropped])
    expect(getSession('rec-open')!.addenda ?? []).toEqual([])
    expect(getSession('rec-open')!.photos).toBeUndefined()
    expect(memory.records.has(`rec-open/${dropped.sha256}`)).toBe(false)
  })

  it('completeDeparture waits for the sheet\'s photos to be stored before saving', async () => {
    saveSession(record({ ended_at: ENDED }))
    const rear = await stored('rec-photos', 'return-rear', 'rr')
    let resolvePhotos!: (refs: PhotoRef[]) => void
    const photos = new Promise<PhotoRef[]>((r) => (resolvePhotos = r))
    const fix = {
      current: () => ({ status: 'none' as const, reason: 'denied' as const, at: Date.parse(ENDED) }),
      settled: new Promise<never>(() => {}),
      subscribe: () => () => {},
    }
    const done = completeDeparture('rec-photos', ENDED, fix, { returnPhotos: photos })
    await new Promise((r) => setTimeout(r, 0))
    expect(getSession('rec-photos')!.departure).toBeUndefined()
    resolvePhotos([rear])
    await done
    const dep = getSession('rec-photos')!.addenda!.find((a) => a.kind === 'departure')!
    expect((dep.data as { return_photos: PhotoRef[] }).return_photos).toEqual([rear])
  })
})

describe('end to end: the photo parts are signed on top of the chain and verify', () => {
  it('link 0, arrival_context, a condition part, a compliance part and the departure with return photos', async () => {
    const signer = await createTestSigner()
    vi.stubGlobal('fetch', vi.fn(signer.fetch))
    const prepared = await prepareNewRecord(record({ sign_photo: jpeg('sign-bytes') }))
    saveSession(prepared)
    signNewRecord(prepared.id, emptyLogDraft())
    await whenSigningIdle(prepared.id)

    const before = await stored(prepared.id, 'condition-front', 'before')
    addConditionPhotos(prepared.id, 'parking', [before], 'Scuff on the front bumper')
    const proof = await stored(prepared.id, 'compliance', 'meter ticket on dash')
    addCompliancePhoto(prepared.id, 'meter_ticket', proof)
    await whenSigningIdle(prepared.id)

    const tap = new Date()
    endSession(prepared.id, tap)
    const after = await stored(prepared.id, 'return-front', 'after')
    const fix = {
      current: () => ({ status: 'none' as const, reason: 'denied' as const, at: tap.getTime() }),
      settled: new Promise<never>(() => {}),
      subscribe: () => () => {},
    }
    await completeDeparture(prepared.id, tap.toISOString(), fix, { returnPhotos: [after] })
    await whenSigningIdle(prepared.id)

    const s = getSession(prepared.id)!
    expect(s.addenda!.map((a) => `${a.kind}#${a.seq}:${a.bundle ? 'signed' : 'pending'}`)).toEqual([
      'arrival_context#1:signed',
      'condition#2:signed',
      'compliance#3:signed',
      'departure#4:signed',
    ])
    const cond = JSON.parse(s.addenda![1].bundle!.canonical_payload) as { data: unknown }
    expect(cond.data).toEqual({ when: 'parking', photos: [before], note: 'Scuff on the front bumper' })
    const dep = JSON.parse(s.addenda![3].bundle!.canonical_payload) as { data: { return_photos: unknown } }
    expect(dep.data.return_photos).toEqual([after])

    const verification = await verifyRecord(s, { publicKeys: [signer.publicKey], arrivalRejection: null })
    expect(verification.overall).toBe('valid')
    // Every condition, proof and return photo is on this device and matches its signed fingerprint.
    const checked = verification.photos.filter((p) => p.sha256 === before.sha256 || p.sha256 === proof.sha256 || p.sha256 === after.sha256)
    expect(checked.map((p) => p.status)).toEqual(['matches', 'matches', 'matches'])
  })
})
