// The client merge of a record's evidence (T0b4 item 4): pure rules,
// mirroring the server's mergeSessionRows with this device's copy in the
// place of the stored row.
import { describe, expect, it } from 'vitest'
import type { ParkingSession, PhotoRef, SignatureBundle, SignedAddendum } from '../types'
import {
  cloudLacksEvidence,
  mergeAddenda,
  mergeEvidence,
  mergePhotoRefs,
  pulledRecord,
  sameEvidence,
  uploadableAddenda,
  uploadablePhotoRefs,
} from './evidence-merge'
import { MAX_ADDENDA } from './evidence-chain'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)

function bundle(tag: string, schema = 'parkproof-addendum-v1'): SignatureBundle {
  return {
    schema,
    signed_at: '2026-10-20T01:00:05.000Z',
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify({ tag }),
    signature_base64: `sig-${tag}`,
  }
}

function addendum(id: string, seq: number, state: 'pending' | 'signed' | 'rejected' = 'pending'): SignedAddendum {
  const a: SignedAddendum = {
    id,
    seq,
    kind: 'condition',
    captured_at: `2026-10-20T01:${String(seq).padStart(2, '0')}:00.000Z`,
    data: { n: seq },
  }
  if (state === 'signed') a.bundle = bundle(id)
  if (state === 'rejected') a.rejected = { code: 'ERR_BAD_VALUE', at: '2026-10-20T02:00:00.000Z' }
  return a
}

const ref = (role: PhotoRef['role'], sha256: string): PhotoRef => ({
  role,
  sha256,
  captured_at: '2026-10-20T00:59:00.000Z',
  source: 'camera_input',
})

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: '2026-10-20T01:00:00.000Z',
    location: null,
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    ...overrides,
  }
}

const ids = (list: SignedAddendum[] | undefined) => (list ?? []).map((a) => `${a.id}#${a.seq}`)

describe('mergeAddenda', () => {
  it('adopts links signed elsewhere and keeps the local ones', () => {
    const out = mergeAddenda([addendum('a1', 1, 'signed')], [addendum('a1', 1, 'signed'), addendum('b2', 2, 'signed')])
    expect(ids(out)).toEqual(['a1#1', 'b2#2'])
  })

  it('never replaces a signed local link, even with another bundle for the same id', () => {
    const local = addendum('a1', 1, 'signed')
    const theirs = { ...addendum('a1', 1), bundle: bundle('other') }
    const mine = [local]
    const out = mergeAddenda(mine, [theirs])
    expect(out).toBe(mine) // nothing adopted
    expect(out![0].bundle).toEqual(local.bundle)
  })

  it('prefers the copy with a bundle, and a rejection over a pending copy', () => {
    expect(mergeAddenda([addendum('a1', 1)], [addendum('a1', 1, 'signed')])![0].bundle).toBeDefined()
    expect(mergeAddenda([addendum('a1', 1)], [addendum('a1', 1, 'rejected')])![0].rejected).toBeDefined()
  })

  it('never adopts a pending link from the cloud (it belongs to the device that queued it)', () => {
    const local = [addendum('a1', 1, 'signed')]
    expect(mergeAddenda(local, [addendum('p2', 2)])).toBe(local)
    expect(mergeAddenda(undefined, [addendum('p1', 1)])).toBeUndefined()
  })

  it('renumbers local pending links to follow the highest signed link, so they chain on top', () => {
    // Local: link 1 signed, its own link pending at seq 2. The cloud brings
    // another device's link 2, signed.
    const out = mergeAddenda([addendum('a1', 1, 'signed'), addendum('mine', 2)], [addendum('theirs', 2, 'signed')])
    expect(ids(out).sort()).toEqual(['a1#1', 'mine#3', 'theirs#2'])
  })

  it('a fork (two signed links at one seq) keeps both', () => {
    const out = mergeAddenda([addendum('a1', 1, 'signed'), addendum('mine', 2, 'signed')], [addendum('theirs', 2, 'signed')])
    expect(ids(out)).toEqual(['a1#1', 'mine#2', 'theirs#2'])
  })

  it(`caps at ${MAX_ADDENDA}: local signed first, then signed from the cloud, then local pending, then rejections`, () => {
    const local = [
      ...Array.from({ length: 12 }, (_, i) => addendum(`l${i}`, i + 1, 'signed')),
      addendum('lp', 13),
      addendum('lr', 13, 'rejected'),
    ]
    const cloud = Array.from({ length: 8 }, (_, i) => addendum(`c${i}`, 13 + i, 'signed'))
    const out = mergeAddenda(local, cloud)!
    expect(out).toHaveLength(MAX_ADDENDA)
    expect(out.filter((a) => a.id.startsWith('l') && a.bundle)).toHaveLength(12)
    expect(out.filter((a) => a.id.startsWith('c'))).toHaveLength(8)
    expect(out.some((a) => a.id === 'lp' || a.id === 'lr')).toBe(false)
  })
})

describe('mergeEvidence', () => {
  it('takes link 0, chain key, hashes, end and departure only when this device has none', () => {
    const departure = { ended_at: '2026-10-20T02:00:00.000Z', location: null, distance_from_arrival_m: null }
    const cloud = record({
      signature: bundle('cloud-link0', 'parkproof-evidence-v2'),
      chain_key: 'f'.repeat(64),
      v1_hashes: { sign: SHA_A, car: null, ambient: null },
      ended_at: '2026-10-20T02:00:00.000Z',
      departure,
      note: 'cloud note',
    })
    const filled = mergeEvidence(record({ note: 'local note' }), cloud)
    expect(filled.signature?.signature_base64).toBe('sig-cloud-link0')
    expect(filled.chain_key).toBe('f'.repeat(64))
    expect(filled.v1_hashes?.sign).toBe(SHA_A)
    expect(filled.ended_at).toBe('2026-10-20T02:00:00.000Z')
    expect(filled.departure).toEqual(departure)
    // Everything else: this device's copy.
    expect(filled.note).toBe('local note')

    const local = record({ signature: bundle('local-link0', 'parkproof-evidence-v2'), ended_at: '2026-10-20T01:55:00.000Z' })
    const kept = mergeEvidence(local, cloud)
    expect(kept.signature?.signature_base64).toBe('sig-local-link0')
    expect(kept.ended_at).toBe('2026-10-20T01:55:00.000Z')
  })

  it('unions photo refs', () => {
    const out = mergeEvidence(record({ photos: [ref('sign', SHA_A)] }), record({ photos: [ref('sign', SHA_A), ref('car', SHA_B)] }))
    expect(out.photos?.map((p) => p.role)).toEqual(['sign', 'car'])
    expect(mergePhotoRefs(undefined, undefined)).toBeUndefined()
  })

  it('leaves a read-only shared copy alone', () => {
    const shared = record({ shared_from: { original_session_id: 'x', received_at: 't', shared_at: null, arrival_bundle: null, snapshot: {} } })
    expect(mergeEvidence(shared, record({ ended_at: '2026-10-20T02:00:00.000Z' }))).toBe(shared)
  })

  it('sameEvidence sees only the evidence fields', () => {
    const a = record({ addenda: [addendum('a1', 1, 'signed')] })
    expect(sameEvidence(a, { ...a, note: 'different' })).toBe(true)
    expect(sameEvidence(a, mergeEvidence(a, record({ addenda: [addendum('b2', 2, 'signed')] })))).toBe(false)
  })
})

describe('cloudLacksEvidence', () => {
  it('true when this copy has a link, an end or a photo the cloud lacks', () => {
    const cloud = record({ signature: bundle('l0'), addenda: [addendum('a1', 1, 'signed')], photos: [ref('sign', SHA_A)] })
    expect(cloudLacksEvidence(cloud, cloud)).toBe(false)
    expect(cloudLacksEvidence({ ...cloud, addenda: [...cloud.addenda!, addendum('a2', 2, 'signed')] }, cloud)).toBe(true)
    expect(cloudLacksEvidence({ ...cloud, ended_at: '2026-10-20T02:00:00.000Z' }, cloud)).toBe(true)
    expect(cloudLacksEvidence({ ...cloud, photos: [...cloud.photos!, ref('car', SHA_B)] }, cloud)).toBe(true)
    expect(cloudLacksEvidence(cloud, record())).toBe(true)
    // Only pending links extra: nothing to upload (they don't go to the cloud).
    expect(cloudLacksEvidence({ ...cloud, addenda: [...cloud.addenda!, addendum('p2', 2)] }, cloud)).toBe(false)
    // Signed here, pending in the cloud copy (an older client uploaded it).
    expect(cloudLacksEvidence(record({ addenda: [addendum('a1', 1, 'signed')] }), record({ addenda: [addendum('a1', 1)] }))).toBe(true)
  })
})

describe('what goes to and comes from the cloud', () => {
  it('uploadableAddenda keeps signed and rejected links only', () => {
    const list = [addendum('s', 1, 'signed'), addendum('p', 2), addendum('r', 2, 'rejected')]
    expect(ids(uploadableAddenda(list))).toEqual(['s#1', 'r#2'])
    expect(uploadableAddenda(undefined)).toBeUndefined()
  })

  it('leaves out entries the server would refuse, so one bad entry never blocks a record\'s sync', () => {
    const bad = [
      { ...addendum('x', 1, 'signed'), seq: 0 },
      { ...addendum('y', 2, 'signed'), data: null },
      { ...addendum('z'.repeat(65), 3, 'signed') },
      { ...addendum('w', 4), bundle: 'not-a-bundle' },
      { ...addendum('v', 5), rejected: { at: 'no code' } },
    ] as unknown as SignedAddendum[]
    expect(uploadableAddenda([addendum('ok', 1, 'signed'), ...bad])!.map((a) => a.id)).toEqual(['ok'])
    const photos = [ref('sign', SHA_A), { role: 'car', sha256: 'XYZ' }, null] as unknown as PhotoRef[]
    expect(uploadablePhotoRefs(photos)).toEqual([ref('sign', SHA_A)])
    expect(uploadablePhotoRefs(undefined)).toBeUndefined()
  })

  it('pulledRecord drops pending links and the other device\'s photo_sync_failed flag', () => {
    const cloud = record({ addenda: [addendum('s', 1, 'signed'), addendum('p', 2)] })
    expect(ids(pulledRecord(cloud).addenda)).toEqual(['s#1'])
    const plain = record()
    expect(pulledRecord(plain)).toEqual(plain)
    expect(pulledRecord(plain)).not.toBe(plain)
    const flagged = pulledRecord(record({ photo_sync_failed: true }))
    expect('photo_sync_failed' in flagged).toBe(false)
  })
})
