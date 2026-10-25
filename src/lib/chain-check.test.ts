// @vitest-environment node
//
// "Check signatures" as a function (spec T1a): the record is checked again
// when its chain changed while the check ran (at most CHECK_MAX_PASSES
// times), missing photos are fetched at most CHECK_PHOTO_CONCURRENCY at a
// time, a photo ref by fingerprint and an older record's legacy photo by
// role (its bytes handed to the verifier, never written to the record), and
// a shared copy never fetches anything.
import { describe, expect, it, vi } from 'vitest'
import type { ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import { CHECK_MAX_PASSES, CHECK_PHOTO_CONCURRENCY, runChainCheck, type ChainCheckDeps } from './chain-check'
import { chainFingerprint } from './chain-view'
import type { PhotoCheck, RecordVerification } from './verify'

function bundle(sig: string): SignatureBundle {
  return {
    schema: 'parkproof-addendum-v1',
    signed_at: '2026-10-25T00:00:00.000Z',
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: '{}',
    signature_base64: sig,
  }
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: '2026-10-25T00:00:00.000Z',
    location: null,
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    signature: bundle('link-0'),
    ...overrides,
  }
}

const departure = (signed: boolean): SignedAddendum => ({
  id: 'dep',
  seq: 1,
  kind: 'departure',
  captured_at: '2026-10-25T00:00:00.000Z',
  data: {},
  ...(signed ? { bundle: bundle('dep-sig') } : {}),
})

function result(photos: PhotoCheck[] = []): RecordVerification {
  return {
    session_id: 'rec-1',
    overall: 'valid',
    counts: { valid: 1, invalid: 0, pending: 0, rejected: 0, dev_key: 0 },
    links: [],
    photos,
    forks: [],
    chain_key_on_device: 'not_applicable',
  }
}

const missing = (role: PhotoCheck['role'], sha256: string): PhotoCheck => ({
  role,
  sha256,
  status: 'not_on_device',
  local_sha256: null,
  signer: 'parkproof',
  link_indexes: [0],
})

function deps(overrides: Partial<ChainCheckDeps> = {}): ChainCheckDeps {
  return {
    verify: vi.fn(async () => result()),
    reread: () => null,
    fetchRef: vi.fn(async () => null),
    fetchLegacy: vi.fn(async () => null),
    ...overrides,
  }
}

describe('runChainCheck', () => {
  it('checks once when nothing changes and every photo is here', async () => {
    const s = record()
    const d = deps({ reread: () => s })
    const out = await runChainCheck(s, d)
    expect(d.verify).toHaveBeenCalledTimes(1)
    expect(out).toEqual({ result: result(), fingerprint: chainFingerprint(s), stale: false })
  })

  it('a part signed while the check ran: checks the new copy, and the result describes it', async () => {
    const before = record({ addenda: [departure(false)] })
    const after = record({ addenda: [departure(true)] })
    let stored = before
    const verify = vi.fn<ChainCheckDeps['verify']>(async () => {
      // The departure lands while the first check runs.
      if (verify.mock.calls.length === 1) stored = after
      return result()
    })
    const out = await runChainCheck(before, deps({ verify, reread: () => stored }))
    expect(verify).toHaveBeenCalledTimes(2)
    expect(verify.mock.calls[1][0]).toBe(after)
    expect(out.fingerprint).toBe(chainFingerprint(after))
    expect(out.stale).toBe(false)
  })

  it(`stops after ${CHECK_MAX_PASSES} passes when the chain keeps changing, and says the result is stale`, async () => {
    let n = 0
    const verify = vi.fn(async () => result())
    const reread = () => record({ addenda: [{ ...departure(true), bundle: bundle(`sig-${n++}`) }] })
    const out = await runChainCheck(record(), deps({ verify, reread }))
    expect(verify).toHaveBeenCalledTimes(CHECK_MAX_PASSES)
    expect(out.stale).toBe(true)
  })

  it('a photo ref is fetched by fingerprint, then the stored copy is checked again', async () => {
    const s = record({ photos: [{ role: 'car', sha256: 'a'.repeat(64), captured_at: '2026-10-25T00:00:00.000Z', source: 'camera_input' }] })
    const verify = vi.fn(async () => result([missing('car', 'a'.repeat(64))]))
    const fetchRef = vi.fn(async () => 'data:image/jpeg;base64,AAAA')
    const fetchLegacy = vi.fn(async () => null)
    await runChainCheck(s, deps({ verify, fetchRef, fetchLegacy, reread: () => s }))
    expect(fetchRef).toHaveBeenCalledWith('rec-1', 'a'.repeat(64))
    expect(fetchLegacy).not.toHaveBeenCalled()
    expect(verify).toHaveBeenCalledTimes(2)
    expect(verify.mock.calls[1]).toEqual([s])
  })

  it("an older record's legacy photo is fetched by role and handed to the verifier, not written to the record", async () => {
    const s = record({ car_photo: 'https://bucket.example/car.jpg' })
    const verify = vi.fn(async () => result([missing('car', 'b'.repeat(64))]))
    const fetchLegacy = vi.fn(async () => 'data:image/jpeg;base64,Q0FS')
    const fetchRef = vi.fn(async () => null)
    await runChainCheck(s, deps({ verify, fetchLegacy, fetchRef, reread: () => s }))
    expect(fetchLegacy).toHaveBeenCalledWith('rec-1', 'car')
    expect(fetchRef).not.toHaveBeenCalled()
    const [checked, options] = verify.mock.calls[1] as unknown as [ParkingSession, { localPhotos: Map<string, string> }]
    expect(checked.car_photo).toBe('https://bucket.example/car.jpg')
    expect([...options.localPhotos]).toEqual([['car', 'data:image/jpeg;base64,Q0FS']])
  })

  it('a failed or non-image fetch counts as nothing fetched: one check only', async () => {
    const s = record()
    const verify = vi.fn(async () => result([missing('sign', 'c'.repeat(64)), missing('ambient', 'd'.repeat(64))]))
    const fetchLegacy = vi.fn(async (_id: string, role: string) => {
      if (role === 'sign') throw new Error('Not signed in')
      return 'https://not-bytes.example/'
    })
    const out = await runChainCheck(s, deps({ verify, fetchLegacy }))
    expect(fetchLegacy).toHaveBeenCalledTimes(2)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(out.stale).toBe(false)
  })

  it(`fetches at most ${CHECK_PHOTO_CONCURRENCY} photos at once`, async () => {
    const photos = Array.from({ length: 13 }, (_, i) => missing('condition-detail', i.toString(16).padStart(64, '0')))
    let inFlight = 0
    let max = 0
    const fetchRef = vi.fn(async () => {
      inFlight++
      max = Math.max(max, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return null
    })
    await runChainCheck(record(), deps({ verify: vi.fn(async () => result(photos)), fetchRef }))
    expect(fetchRef).toHaveBeenCalledTimes(13)
    expect(max).toBe(CHECK_PHOTO_CONCURRENCY)
    expect(CHECK_PHOTO_CONCURRENCY).toBe(4)
  })

  it('a shared copy never fetches photos (they are in someone else\'s cloud)', async () => {
    const s = record({
      shared_from: { original_session_id: 'x', received_at: '2026-10-25T00:00:00.000Z', shared_at: null, arrival_bundle: null, snapshot: {} },
    })
    const fetchRef = vi.fn(async () => 'data:image/jpeg;base64,AAAA')
    const fetchLegacy = vi.fn(async () => 'data:image/jpeg;base64,AAAA')
    await runChainCheck(s, deps({ verify: vi.fn(async () => result([missing('condition-front', 'e'.repeat(64)), missing('car', 'f'.repeat(64))])), fetchRef, fetchLegacy }))
    expect(fetchRef).not.toHaveBeenCalled()
    expect(fetchLegacy).not.toHaveBeenCalled()
  })
})
