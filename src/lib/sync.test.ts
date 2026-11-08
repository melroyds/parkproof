// @vitest-environment happy-dom
//
// Cloud sync of the evidence chain (T0b4 items 3, 4, 5, 11): one upload in
// flight per record (with one follow-up for calls made meanwhile, reading
// the record again right before the metadata POST), the first sync merging
// the cloud copy's links into this device's, pulled records never getting
// a second link 0, and only the ending device adding a departure. Uploads
// go through the real server merge (test-support/fake-cloud.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession, SignatureBundle, SignedAddendum } from '../types'

const { getIdToken } = vi.hoisted(() => ({ getIdToken: vi.fn(async (): Promise<string | null> => null) }))
vi.mock('./auth', () => ({ getIdToken }))
vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

import {
  deleteCloudSession,
  mirrorSessionUpdateToCloud,
  performInitialSync,
  refUploadMarker,
  resetSyncForTests,
  uploadSession,
  uploadedPhotoMarkers,
} from './sync'
import { getSession, loadSessions, saveSession, updateSession } from './storage'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from './photo-store'
import { sha256HexUtf8 } from './hash'
import {
  SWEEP_THROTTLE_MS,
  isPulledRecord,
  markEndedOnThisDevice,
  queueAddendum,
  resetSigningQueueForTests,
  runSigningSweep,
  whenSigningIdle,
} from './signing'
import { createFakeCloud, fakeIdToken, type FakeCloud } from './test-support/fake-cloud'

// happy-dom's localStorage can't be spied on (see CLAUDE.md), so this file
// swaps in a Map-backed Storage whose writes can be made to fail per key.
const backing = new Map<string, string>()
const failWrites = new Set<string>()
const fakeLocalStorage: Storage = {
  get length() {
    return backing.size
  },
  clear() {
    backing.clear()
  },
  getItem(key: string) {
    return backing.has(key) ? backing.get(key)! : null
  },
  key(index: number) {
    return Array.from(backing.keys())[index] ?? null
  },
  removeItem(key: string) {
    backing.delete(key)
  },
  setItem(key: string, value: string) {
    if (failWrites.has(key)) throw new DOMException('Quota exceeded', 'QuotaExceededError')
    backing.set(key, String(value))
  },
}
Object.defineProperty(globalThis, 'localStorage', { value: fakeLocalStorage, configurable: true, writable: true })

const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const USER = 'user-1'
const KEY = 'parkproof.sessions.v1'
const CHAIN_KEY = 'c'.repeat(64)
let cloud: FakeCloud

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: ID,
    arrived_at: new Date(Date.now() - 60 * 60_000).toISOString(),
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

function bundle(tag: string, payload: Record<string, unknown> = {}, schema = 'parkproof-addendum-v1'): SignatureBundle {
  return {
    schema,
    signed_at: '2026-10-20T01:00:05.000Z',
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify({ schema, tag, ...payload }),
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

const seqs = (s: ParkingSession | undefined) => (s?.addenda ?? []).map((a) => `${a.id}#${a.seq}${a.bundle ? '' : a.rejected ? 'x' : '?'}`).sort()
const signCalls = () => cloud.calls.filter((c) => c.url.endsWith('/sign-session'))

beforeEach(() => {
  localStorage.clear()
  resetSyncForTests()
  resetSigningQueueForTests()
  cloud = createFakeCloud(USER)
  getIdToken.mockImplementation(async () => fakeIdToken(USER))
  setPhotoBackendForTests(createMemoryPhotoBackend())
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => cloud.fetch(input, init)))
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  await whenSigningIdle()
  setPhotoBackendForTests(null)
  vi.unstubAllGlobals()
})

describe('uploadSession serialisation (item 5)', () => {
  it('one upload in flight per record; calls made meanwhile run ONE more, with the latest copy', async () => {
    saveSession(record({ note: 'v1' }))
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let held = false
    cloud.beforeUpload = async () => {
      if (held) return
      held = true
      await gate
    }
    const first = uploadSession(getSession(ID)!)
    await vi.waitFor(() => expect(held).toBe(true))
    updateSession(ID, { note: 'v2' })
    const second = uploadSession(getSession(ID)!)
    mirrorSessionUpdateToCloud(ID)
    updateSession(ID, { note: 'v3' })
    const third = uploadSession(record({ note: 'a stale copy' }))
    release()
    await expect(first).resolves.toEqual({ photoFailed: false })
    await expect(second).resolves.toEqual({ photoFailed: false })
    await expect(third).resolves.toEqual({ photoFailed: false })
    // Two uploads in all; the follow-up read the record itself, not a caller's copy.
    expect(cloud.uploads().map((r) => r.note)).toEqual(['v1', 'v3'])
    expect(cloud.rows.get(ID)!.note).toBe('v3')
  })

  it('reads the record again right before the metadata POST', async () => {
    const sha = await putPhoto(ID, 'data:image/jpeg;base64,' + btoa('slow-photo'))
    saveSession(record({ photos: [{ role: 'car', sha256: sha, captured_at: '2026-10-20T00:59:00.000Z', source: 'camera_input' }] }))
    cloud.beforePut = () => {
      // While the photo is uploading, link 0 lands.
      updateSession(ID, { signature: bundle('link0', {}, 'parkproof-evidence-v2') })
    }
    await uploadSession(getSession(ID)!)
    expect((cloud.uploads()[0].signature as SignatureBundle).signature_base64).toBe('sig-link0')
  })

  it('sends signed and rejected addenda only; pending ones stay on this device', async () => {
    saveSession(record({ addenda: [addendum('s1', 1, 'signed'), addendum('p2', 2), addendum('r2', 2, 'rejected')] }))
    await uploadSession(getSession(ID)!)
    expect((cloud.uploads()[0].addenda as SignedAddendum[]).map((a) => a.id)).toEqual(['s1', 'r2'])
    expect(getSession(ID)!.addenda).toHaveLength(3)
  })

  it('a record gone from this device, or a read-only shared copy, is not uploaded', async () => {
    await uploadSession(record())
    saveSession(record({ shared_from: { original_session_id: 'x', received_at: 't', shared_at: null, arrival_bundle: null, snapshot: {} } }))
    await uploadSession(getSession(ID)!)
    expect(cloud.uploads()).toHaveLength(0)
  })

  it('an upload overlapping a delete never re-creates the row, and the delete forgets its markers', async () => {
    const sha = await putPhoto(ID, 'data:image/jpeg;base64,' + btoa('doomed'))
    saveSession(record({ photos: [{ role: 'sign', sha256: sha, captured_at: '2026-10-20T00:59:00.000Z', source: 'camera_input' }] }))
    cloud.beforePut = async () => {
      cloud.beforePut = null
      await deleteCloudSession(ID)
    }
    await uploadSession(getSession(ID)!)
    expect(cloud.uploads()).toHaveLength(0)
    expect(uploadedPhotoMarkers(USER).has(refUploadMarker(ID, sha))).toBe(false)
  })
})

describe('performInitialSync: records on both sides (item 4)', () => {
  it('adopts links signed elsewhere and chains this device\'s pending link on top', async () => {
    saveSession(record({ chain_key: CHAIN_KEY, addenda: [addendum('a1', 1, 'signed'), addendum('mine', 2)] }))
    cloud.rows.set(ID, { ...record({ chain_key: CHAIN_KEY, addenda: [addendum('a1', 1, 'signed'), addendum('theirs', 2, 'signed')] }) })

    const result = await performInitialSync()

    expect(result).toMatchObject({ alreadyInSync: 1, merged: 1, uploaded: 0, pulled: 0 })
    expect(seqs(getSession(ID))).toEqual(['a1#1', 'mine#3?', 'theirs#2'])
    // Nothing signed here that the cloud lacks: no upload.
    expect(cloud.uploads()).toHaveLength(0)
  })

  it('uploads when this device has links (or an end) the cloud copy lacks; the server keeps the union', async () => {
    saveSession(record({ addenda: [addendum('a1', 1, 'signed'), addendum('a2', 2, 'signed')], ended_at: '2026-10-20T02:00:00.000Z' }))
    cloud.rows.set(ID, { ...record({ addenda: [addendum('a1', 1, 'signed'), addendum('b9', 2, 'signed')] }) })

    await performInitialSync()

    expect(cloud.uploads()).toHaveLength(1)
    const row = cloud.rows.get(ID)!
    expect((row.addenda as SignedAddendum[]).map((a) => a.id).sort()).toEqual(['a1', 'a2', 'b9'])
    expect(row.ended_at).toBe('2026-10-20T02:00:00.000Z')
    // And this device took the cloud's link too.
    expect(seqs(getSession(ID))).toEqual(['a1#1', 'a2#2', 'b9#2'])
  })

  it('a record already in step is neither rewritten nor uploaded', async () => {
    const same = record({ signature: bundle('l0', {}, 'parkproof-evidence-v2'), addenda: [addendum('a1', 1, 'signed')] })
    saveSession(same)
    cloud.rows.set(ID, structuredClone(same) as unknown as Record<string, unknown>)
    const result = await performInitialSync()
    expect(result.merged).toBe(0)
    expect(cloud.uploads()).toHaveLength(0)
  })

  it('takes the end and link 0 from the cloud when this device has none, never replacing its own', async () => {
    saveSession(record({ signature: bundle('mine', {}, 'parkproof-evidence-v2') }))
    cloud.rows.set(ID, { ...record({ signature: bundle('theirs', {}, 'parkproof-evidence-v2'), ended_at: '2026-10-20T02:00:00.000Z' }) })
    await performInitialSync()
    const local = getSession(ID)!
    expect(local.signature!.signature_base64).toBe('sig-mine')
    expect(local.ended_at).toBe('2026-10-20T02:00:00.000Z')
    // The server never replaces its stored link 0 either.
    expect((cloud.rows.get(ID)!.signature as SignatureBundle).signature_base64).toBe('sig-theirs')
  })

  it('a copy pulled before chain keys synced is marked pulled; the cloud key is taken only when it fits link 0', async () => {
    const fits = bundle('l0', { chain_key_sha256: await sha256HexUtf8(CHAIN_KEY) }, 'parkproof-evidence-v2')
    saveSession(record({ signature: fits }))
    cloud.rows.set(ID, { ...record({ signature: fits, chain_key: CHAIN_KEY }) })
    await performInitialSync()
    expect(getSession(ID)!.chain_key).toBe(CHAIN_KEY)
    expect(isPulledRecord(ID)).toBe(true)

    const other = '0a1b2c3d-4e5f-4a6b-8c7d-000000000002'
    const mismatch = bundle('l0', { chain_key_sha256: 'f'.repeat(64) }, 'parkproof-evidence-v2')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    saveSession(record({ id: other, signature: mismatch }))
    cloud.rows.set(other, { ...record({ id: other, signature: mismatch, chain_key: CHAIN_KEY }) })
    await performInitialSync()
    expect(getSession(other)!.chain_key).toBeUndefined()
  })

  it('an end that came from the cloud never makes this device add a departure (only the ending device does)', async () => {
    const ended = new Date(Date.now() - 10 * 60_000).toISOString()
    saveSession(record({ chain_key: CHAIN_KEY, signature: bundle('l0', {}, 'parkproof-evidence-v1') }))
    cloud.rows.set(ID, { ...record({ chain_key: CHAIN_KEY, signature: bundle('l0', {}, 'parkproof-evidence-v1'), ended_at: ended }) })
    await performInitialSync()
    expect(getSession(ID)!.ended_at).toBe(ended)
    runSigningSweep(Date.now() + SWEEP_THROTTLE_MS)
    await whenSigningIdle()
    expect(getSession(ID)!.addenda ?? []).toHaveLength(0)
    expect(signCalls()).toHaveLength(0)

    // Ended on this device: then it does.
    markEndedOnThisDevice(ID)
    runSigningSweep(Date.now() + 3 * SWEEP_THROTTLE_MS)
    await whenSigningIdle()
    expect(getSession(ID)!.addenda!.some((a) => a.kind === 'departure')).toBe(true)
  })
})

describe('performInitialSync and signing', () => {
  it('a pending link the merge renumbered onto a link signed elsewhere is signed straight away', async () => {
    const link0 = bundle('l0', {}, 'parkproof-evidence-v1')
    saveSession(record({ signature: link0, addenda: [addendum('mine', 1)] }))
    cloud.rows.set(ID, { ...record({ signature: link0, addenda: [addendum('theirs', 1, 'signed')] }) })

    await performInitialSync()
    await whenSigningIdle()

    expect(seqs(getSession(ID))).toEqual(['mine#2?', 'theirs#1'])
    // No sweep trigger needed: the merge asked for it (the fake signer answers 503).
    expect(signCalls().map((c) => c.body)).toEqual([expect.objectContaining({ addendum_id: 'mine', seq: 2 })])
  })

  it("a pulled v2 record signs nothing of its own until the saving device's arrival_context reaches it", async () => {
    const link0 = bundle('l0', { chain_key_sha256: await sha256HexUtf8(CHAIN_KEY) }, 'parkproof-evidence-v2')
    cloud.rows.set(ID, { ...record({ chain_key: CHAIN_KEY, signature: link0 }) })
    expect((await performInitialSync()).pulled).toBe(1)

    // The driver taps I've left on this device before link 1 has arrived.
    const ended_at = new Date(Date.now() - 60_000).toISOString()
    const departure = queueAddendum(ID, 'departure', { ended_at, location: null, distance_from_arrival_m: null, return_photos: [] })!
    expect(departure.seq).toBe(1)
    await whenSigningIdle()
    runSigningSweep(Date.now() + SWEEP_THROTTLE_MS)
    await whenSigningIdle()
    expect(signCalls()).toHaveLength(0)

    // The saving device's link 1 reaches the cloud; the next sync puts the departure on top of it.
    const arrival: SignedAddendum = { ...addendum('arrival', 1, 'signed'), kind: 'arrival_context' }
    cloud.rows.set(ID, { ...cloud.rows.get(ID)!, addenda: [arrival] })
    await performInitialSync()
    await whenSigningIdle()
    expect(seqs(getSession(ID))).toEqual(['arrival#1', `${departure.id}#2?`].sort())
    expect(signCalls().map((c) => c.body)).toEqual([
      expect.objectContaining({ addendum_id: departure.id, kind: 'departure', seq: 2, chain_key: CHAIN_KEY }),
    ])
  })

  it('a record saved on this device never waits for an arrival_context from elsewhere', async () => {
    const link0 = bundle('l0', { chain_key_sha256: await sha256HexUtf8(CHAIN_KEY) }, 'parkproof-evidence-v2')
    saveSession(record({ chain_key: CHAIN_KEY, signature: link0 }))
    queueAddendum(ID, 'departure', { ended_at: new Date().toISOString(), location: null, distance_from_arrival_m: null, return_photos: [] })
    await whenSigningIdle()
    expect(signCalls()).toHaveLength(1)
  })
})

describe('performInitialSync: records only in the cloud (item 11)', () => {
  it('are stored without pending links, marked pulled, and never get a link 0 here', async () => {
    cloud.rows.set(ID, {
      ...record({
        chain_key: CHAIN_KEY,
        v1_hashes: { sign: 'a'.repeat(64), car: null, ambient: null },
        photos: [{ role: 'sign', sha256: 'a'.repeat(64), captured_at: '2026-10-20T00:59:00.000Z', source: 'camera_input' }],
        addenda: [addendum('p1', 1)],
      }),
    })
    const result = await performInitialSync()
    expect(result.pulled).toBe(1)
    const pulled = getSession(ID)!
    expect(pulled.chain_key).toBe(CHAIN_KEY)
    expect(pulled.addenda).toEqual([])
    expect(isPulledRecord(ID)).toBe(true)

    runSigningSweep(Date.now() + SWEEP_THROTTLE_MS)
    await whenSigningIdle()
    expect(signCalls()).toHaveLength(0)
    expect(getSession(ID)!.signature).toBeUndefined()
  })

  it('a record saved on this device still gets its link 0 (the sweep asks for it)', async () => {
    saveSession(record({ v1_hashes: { sign: null, car: null, ambient: null } }))
    runSigningSweep(Date.now() + SWEEP_THROTTLE_MS)
    await whenSigningIdle()
    expect(signCalls()).toHaveLength(1)
  })

  it('pulls nothing when the pulled mark cannot be stored', async () => {
    cloud.rows.set(ID, { ...record() })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    failWrites.add('parkproof.signing.state.v2')
    try {
      const result = await performInitialSync()
      expect(result.pulled).toBe(0)
      expect(loadSessions()).toHaveLength(0)
      expect(localStorage.getItem(KEY)).toBeNull()
    } finally {
      failWrites.clear()
    }
    // Next time it can be marked, it is pulled.
    expect((await performInitialSync()).pulled).toBe(1)
    expect(isPulledRecord(ID)).toBe(true)
  })

  it("a pulled record replaces this device's shared copy of itself (T7: the driver opened their own link here first)", async () => {
    const copyOfOwn = record({
      id: 'copy-of-own',
      shared_from: { original_session_id: ID, received_at: new Date().toISOString(), shared_at: null, arrival_bundle: null, snapshot: {} },
    })
    const otherCopy = record({
      id: 'copy-of-theirs',
      shared_from: { original_session_id: 'someone-else', received_at: new Date().toISOString(), shared_at: null, arrival_bundle: null, snapshot: {} },
    })
    saveSession(copyOfOwn)
    saveSession(otherCopy)
    cloud.rows.set(ID, { ...record() })
    expect((await performInitialSync()).pulled).toBe(1)
    // One park, once: the record itself, with no "Shared with you" twin. Other copies stay.
    expect(loadSessions().map((s) => s.id).sort()).toEqual([ID, 'copy-of-theirs'].sort())
    expect(getSession(ID)!.shared_from).toBeUndefined()
  })

  it('local-only records upload; shared copies never do', async () => {
    saveSession(record())
    saveSession(record({ id: 'shared-1', shared_from: { original_session_id: 'x', received_at: 't', shared_at: null, arrival_bundle: null, snapshot: {} } }))
    const result = await performInitialSync()
    expect(result.uploaded).toBe(1)
    expect([...cloud.rows.keys()]).toEqual([ID])
  })
})
