// @vitest-environment happy-dom
//
// Reading a record's photos however they are held (T0b2): legacy data-URL
// fields for old records, the photo store behind PhotoRefs for new ones,
// and the one "bytes missing" state.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession, PhotoRef, SignatureBundle, SignedAddendum } from '../types'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from './photo-store'
import {
  LIBRARY_AGE_MS,
  PHOTO_WRITE_TIMEOUT_MS,
  captureMetaFor,
  getSessionPhoto,
  hasSessionPhoto,
  legacyPhotoValue,
  makePhotoRef,
  photoHashSigned,
  photoRefFor,
  photoSourceFor,
  resolveSessionPhoto,
  reusedPhotoMeta,
  setRemotePhotoFetcher,
  settleSessionPhoto,
  shortFingerprint,
  storeSessionPhoto,
  whenPhotoWritesSettle,
} from './session-photos'

const ID = '3a9b5c7d-1e2f-4a6b-8c9d-0e1f2a3b4c5d'
const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: ID,
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

function ref(role: PhotoRef['role'], sha256: string, extra: Partial<PhotoRef> = {}): PhotoRef {
  return { role, sha256, captured_at: '2026-10-20T00:59:00.000Z', source: 'camera_input', ...extra }
}

function bundle(payload: Record<string, unknown>, key_alias = 'alias/parkproof-evidence-signing'): SignatureBundle {
  return {
    schema: String(payload.schema ?? 'parkproof-evidence-v2'),
    signed_at: '2026-10-20T01:00:05.000Z',
    algorithm: 'ECDSA_SHA_256',
    key_alias,
    canonical_payload: JSON.stringify(payload),
    signature_base64: 'MEUCIQ',
  }
}

let memory: ReturnType<typeof createMemoryPhotoBackend>
beforeEach(() => {
  memory = createMemoryPhotoBackend()
  setPhotoBackendForTests(memory)
})
afterEach(() => {
  setPhotoBackendForTests(null)
  vi.useRealTimers()
})

describe('photoSourceFor (N1 source rule)', () => {
  const now = Date.parse('2026-10-20T01:00:00.000Z')
  it('the library input is always library', () => {
    expect(photoSourceFor({ lastModified: now }, 'library', now)).toBe('library')
  })
  it('a fresh camera file is camera_input', () => {
    expect(photoSourceFor({ lastModified: now - 5_000 }, 'camera', now)).toBe('camera_input')
    expect(photoSourceFor({ lastModified: now - LIBRARY_AGE_MS }, 'camera', now)).toBe('camera_input')
  })
  it('a camera-input file modified more than 2 min ago counts as library (desktop ignores capture)', () => {
    expect(photoSourceFor({ lastModified: now - LIBRARY_AGE_MS - 1 }, 'camera', now)).toBe('library')
  })
  it('an unknown or zero lastModified keeps the input\'s answer', () => {
    expect(photoSourceFor({}, 'camera', now)).toBe('camera_input')
    expect(photoSourceFor({ lastModified: 0 }, 'camera', now)).toBe('camera_input')
  })
  it('captureMetaFor stamps the pick time as an ISO Z time', () => {
    expect(captureMetaFor({ lastModified: now }, 'camera', now)).toEqual({
      captured_at: '2026-10-20T01:00:00.000Z',
      source: 'camera_input',
    })
  })
})

describe('makePhotoRef', () => {
  it('keeps a schema-valid capture time and source', () => {
    expect(makePhotoRef('car', 'a'.repeat(64), { captured_at: '2026-10-20T01:00:00.000Z', source: 'library' })).toEqual({
      role: 'car',
      sha256: 'a'.repeat(64),
      captured_at: '2026-10-20T01:00:00.000Z',
      source: 'library',
    })
  })
  it('normalises a parseable time to ISO Z, and an unusable one to the fallback', () => {
    const fallback = Date.parse('2026-01-01T00:00:00.000Z')
    expect(makePhotoRef('sign', 'a'.repeat(64), { captured_at: '2026-10-20T12:00:00+11:00', source: 'camera_input' }).captured_at).toBe(
      '2026-10-20T01:00:00.000Z',
    )
    expect(makePhotoRef('sign', 'a'.repeat(64), { captured_at: 'nope', source: 'camera_input' }, fallback).captured_at).toBe(
      '2026-01-01T00:00:00.000Z',
    )
  })
})

describe('storeSessionPhoto', () => {
  it('stores the bytes, then makes the ref from the stored hash', async () => {
    const meta = { captured_at: '2026-10-20T00:58:00.000Z', source: 'camera_input' as const }
    const r = await storeSessionPhoto(ID, 'sign', jpeg('sign'), meta)
    expect(r).toEqual({ role: 'sign', sha256: expect.stringMatching(/^[0-9a-f]{64}$/), ...meta })
    expect(memory.records.has(`${ID}/${r!.sha256}`)).toBe(true)
  })
  it('resolves null (no ref) when the write fails', async () => {
    setPhotoBackendForTests({ ...memory, add: async () => Promise.reject(new Error('disk')) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await storeSessionPhoto(ID, 'car', jpeg('car'), { captured_at: '2026-10-20T00:58:00.000Z', source: 'library' })).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('a write that never settles (a stuck IndexedDB) resolves null after the timeout', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    setPhotoBackendForTests({ ...memory, add: () => new Promise<void>(() => {}) })
    let settled: PhotoRef | null | 'pending' = 'pending'
    void storeSessionPhoto('stuck-1', 'sign', jpeg('stuck'), { captured_at: '2026-10-20T00:58:00.000Z', source: 'camera_input' }).then(
      (r) => (settled = r),
    )
    await vi.advanceTimersByTimeAsync(PHOTO_WRITE_TIMEOUT_MS - 1)
    expect(settled).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBeNull()
  })

  it('bytes that land after a timeout: whenPhotoWritesSettle waits for them and says so', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    setPhotoBackendForTests({
      ...memory,
      add: async (r) => {
        await gate
        await memory.add(r)
      },
    })
    const meta = { captured_at: '2026-10-20T00:58:00.000Z', source: 'camera_input' as const }
    const result = storeSessionPhoto('late-1', 'car', jpeg('late'), meta)
    await vi.advanceTimersByTimeAsync(PHOTO_WRITE_TIMEOUT_MS)
    expect(await result).toBeNull() // timed out: no ref
    let waited: boolean | 'pending' = 'pending'
    void whenPhotoWritesSettle('late-1').then((w) => (waited = w))
    await vi.advanceTimersByTimeAsync(0)
    expect(waited).toBe('pending')
    release()
    await vi.waitFor(() => expect(waited).toBe(true))
    expect([...memory.records.keys()].some((k) => k.startsWith('late-1/'))).toBe(true) // the late bytes
    expect(await whenPhotoWritesSettle('late-1')).toBe(false) // nothing in flight any more
  })

  it('whenPhotoWritesSettle is false at once when nothing is in flight', async () => {
    await storeSessionPhoto('quick-1', 'car', jpeg('quick'), { captured_at: '2026-10-20T00:58:00.000Z', source: 'library' })
    expect(await whenPhotoWritesSettle('quick-1')).toBe(false)
    expect(await whenPhotoWritesSettle('never-written')).toBe(false)
  })
})

describe('photoRefFor / legacyPhotoValue / hasSessionPhoto', () => {
  it('finds the last ref of a role, ignoring malformed entries', () => {
    const s = record({
      photos: [ref('sign', '1'.repeat(64)), { role: 'sign', sha256: 'bad' } as PhotoRef, ref('sign', '2'.repeat(64)), ref('car', '3'.repeat(64))],
    })
    expect(photoRefFor(s, 'sign')?.sha256).toBe('2'.repeat(64))
    expect(photoRefFor(s, 'car')?.sha256).toBe('3'.repeat(64))
    expect(photoRefFor(s, 'ambient')).toBeNull()
  })
  it('legacy values only for sign, car and ambient, and never an empty string', () => {
    const s = record({ sign_photo: '', car_photo: jpeg('c'), ambient_photo: 'https://x/a.jpg' })
    expect(legacyPhotoValue(s, 'sign')).toBeNull()
    expect(legacyPhotoValue(s, 'car')).toBe(jpeg('c'))
    expect(legacyPhotoValue(s, 'ambient')).toBe('https://x/a.jpg')
    expect(legacyPhotoValue(s, 'condition-front')).toBeNull()
  })
  it('hasSessionPhoto is true for a ref or a legacy value', () => {
    expect(hasSessionPhoto(record({ sign_photo: jpeg('s') }), 'sign')).toBe(true)
    expect(hasSessionPhoto(record({ photos: [ref('car', '4'.repeat(64))] }), 'car')).toBe(true)
    expect(hasSessionPhoto(record(), 'sign')).toBe(false)
    // A quota-stripped legacy photo ('') is no photo.
    expect(hasSessionPhoto(record({ sign_photo: '' }), 'sign')).toBe(false)
  })
})

describe('getSessionPhoto / resolveSessionPhoto', () => {
  it('an old record: the legacy data URL (or cloud URL) as it is', async () => {
    const s = record({ sign_photo: jpeg('old-sign'), car_photo: 'https://cdn/car.jpg' })
    expect(await getSessionPhoto(s, 'sign')).toBe(jpeg('old-sign'))
    expect(await getSessionPhoto(s, 'car')).toBe('https://cdn/car.jpg')
    expect(await getSessionPhoto(s, 'ambient')).toBeNull()
  })

  it('a new record: the photo-store bytes behind its ref', async () => {
    const url = jpeg('new-sign')
    const sha = await putPhoto(ID, url)
    const s = record({ photos: [ref('sign', sha)] })
    expect(await getSessionPhoto(s, 'sign')).toBe(url)
    expect(await resolveSessionPhoto(s, 'sign')).toEqual({ kind: 'available', src: url, ref: ref('sign', sha) })
  })

  it('a ref whose bytes are not on this device is "missing" (and getSessionPhoto null)', async () => {
    const s = record({ photos: [ref('car', '5'.repeat(64))] })
    expect(await resolveSessionPhoto(s, 'car')).toEqual({ kind: 'missing', ref: ref('car', '5'.repeat(64)) })
    expect(await getSessionPhoto(s, 'car')).toBeNull()
  })

  it('a ref without bytes falls back to a legacy data URL, but never to a URL (refs are never hydrated, T0b4)', async () => {
    const withData = record({ photos: [ref('sign', '6'.repeat(64))], sign_photo: jpeg('kept-in-field') })
    expect(await getSessionPhoto(withData, 'sign')).toBe(jpeg('kept-in-field'))
    const withUrl = record({ photos: [ref('sign', '6'.repeat(64))], sign_photo: 'https://cdn/sign.jpg' })
    expect(await resolveSessionPhoto(withUrl, 'sign')).toEqual({ kind: 'missing', ref: ref('sign', '6'.repeat(64)) })
  })

  it('missing bytes come from the cloud source when one is set; shared copies never ask', async () => {
    const sha = '9'.repeat(64)
    const fetcher = vi.fn(async (sessionId: string, wanted: string) => (sessionId === ID && wanted === sha ? jpeg('from-cloud') : null))
    setRemotePhotoFetcher(fetcher)
    try {
      expect(await getSessionPhoto(record({ photos: [ref('car', sha)] }), 'car')).toBe(jpeg('from-cloud'))
      expect(fetcher).toHaveBeenCalledWith(ID, sha)
      const shared = record({
        photos: [ref('car', sha)],
        shared_from: { original_session_id: 'x', received_at: 't', shared_at: null, arrival_bundle: null, snapshot: {} },
      })
      fetcher.mockClear()
      expect(await getSessionPhoto(shared, 'car')).toBeNull()
      expect(fetcher).not.toHaveBeenCalled()
      // A source that throws reads as missing.
      setRemotePhotoFetcher(async () => Promise.reject(new Error('offline')))
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect((await resolveSessionPhoto(record({ photos: [ref('car', sha)] }), 'car')).kind).toBe('missing')
      // Bytes on this device are never fetched again.
      const local = jpeg('local-bytes')
      const localSha = await putPhoto(ID, local)
      fetcher.mockClear()
      setRemotePhotoFetcher(fetcher)
      expect(await getSessionPhoto(record({ photos: [ref('car', localSha)] }), 'car')).toBe(local)
      expect(fetcher).not.toHaveBeenCalled()
    } finally {
      setRemotePhotoFetcher(null)
    }
  })

  it('the ref wins over a legacy value when the bytes are here', async () => {
    const url = jpeg('ref-wins')
    const sha = await putPhoto(ID, url)
    const s = record({ photos: [ref('sign', sha)], sign_photo: 'https://cdn/old.jpg' })
    expect(await getSessionPhoto(s, 'sign')).toBe(url)
  })

  it('never throws: a failing store reads as missing', async () => {
    setPhotoBackendForTests({ ...memory, get: async () => Promise.reject(new Error('io')) })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const s = record({ photos: [ref('sign', '7'.repeat(64))] })
    expect((await resolveSessionPhoto(s, 'sign')).kind).toBe('missing')
  })

  it('settleSessionPhoto is the same decision, pure', () => {
    const s = record({ photos: [ref('sign', '8'.repeat(64))] })
    expect(settleSessionPhoto(s, 'sign', 'data:x')).toMatchObject({ kind: 'available', src: 'data:x' })
    expect(settleSessionPhoto(s, 'sign', null)).toMatchObject({ kind: 'missing' })
    expect(settleSessionPhoto(record(), 'sign', null)).toEqual({ kind: 'none' })
  })
})

describe('photoHashSigned (read from the signed payloads only)', () => {
  const sha = 'f'.repeat(64)
  it('true when link 0 signs the hash', () => {
    const s = record({ signature: bundle({ schema: 'parkproof-evidence-v2', car_photo_sha256: sha }) })
    expect(photoHashSigned(s, sha)).toBe(true)
    expect(photoHashSigned(s, 'e'.repeat(64))).toBe(false)
  })
  it('true when a signed addendum\'s data has the photo', () => {
    const addendum: SignedAddendum = {
      id: 'a1',
      seq: 1,
      kind: 'condition',
      captured_at: '2026-10-20T01:00:00.000Z',
      data: { when: 'parking', photos: [ref('condition-front', sha)], note: null },
      bundle: bundle({ schema: 'parkproof-addendum-v1', data: { when: 'parking', photos: [ref('condition-front', sha)], note: null } }),
    }
    expect(photoHashSigned(record({ addenda: [addendum] }), sha)).toBe(true)
  })
  it('false for a pending addendum, an unsigned record, or a development-key signature', () => {
    const pending: SignedAddendum = {
      id: 'a2',
      seq: 1,
      kind: 'compliance',
      captured_at: '2026-10-20T01:00:00.000Z',
      data: { compliance_type: 'meter_ticket', photo: ref('compliance', sha) },
    }
    expect(photoHashSigned(record({ addenda: [pending] }), sha)).toBe(false)
    expect(photoHashSigned(record({ photos: [ref('sign', sha)] }), sha)).toBe(false)
    const dev = record({ signature: bundle({ sign_photo_sha256: sha }, 'dev-ephemeral') })
    expect(photoHashSigned(dev, sha)).toBe(false)
  })
  it('an unreadable payload is not signed', () => {
    const s = record({ signature: { ...bundle({}), canonical_payload: '{oops' } })
    expect(photoHashSigned(s, sha)).toBe(false)
  })
})

describe('shortFingerprint and reusedPhotoMeta', () => {
  it('first and last four characters', () => {
    expect(shortFingerprint('3f9a' + '0'.repeat(56) + 'c21b')).toBe('3f9a…c21b')
    expect(shortFingerprint('3f9a' + '0'.repeat(56) + 'c21b', '...')).toBe('3f9a...c21b')
    expect(shortFingerprint('abc')).toBe('abc')
  })
  it('a reused photo keeps its ref\'s time and source', () => {
    const s = record({ photos: [ref('sign', '1'.repeat(64), { source: 'library', captured_at: '2026-10-19T10:00:00.000Z' })] })
    expect(reusedPhotoMeta(s, 'sign')).toEqual({ captured_at: '2026-10-19T10:00:00.000Z', source: 'library' })
  })
  it('a reused legacy photo takes the old record\'s arrival time and claims only "library"', () => {
    const s = record({ sign_photo: jpeg('old'), arrived_at: '2026-10-19T10:00:00.000Z' })
    expect(reusedPhotoMeta(s, 'sign')).toEqual({ captured_at: '2026-10-19T10:00:00.000Z', source: 'library' })
  })
})
