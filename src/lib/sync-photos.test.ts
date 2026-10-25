// @vitest-environment happy-dom
//
// Cloud sync reads photos through the photo store (T0b2): a new record's
// sign, car and ambient photos live in IndexedDB with the legacy fields
// null, and still upload under their per-role keys. The first sync never
// copies a cloud URL into the legacy field of a photo-store photo whose
// bytes are on this device; when they aren't, the cloud copy is used
// (the PDF checks its bytes against the ref's sha256).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession, PhotoRef } from '../types'

const { getIdToken } = vi.hoisted(() => ({ getIdToken: vi.fn(async (): Promise<string | null> => 'test-token') }))
vi.mock('./auth', () => ({ getIdToken }))

import { materializeRefPhotoFromCloud, performInitialSync, uploadSession } from './sync'
import { getSession, saveSession } from './storage'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from './photo-store'
import { hashDataUrlImage } from './hash'

const ID = '7d1e2f3a-4b5c-4d6e-8f70-1a2b3c4d5e6f'
const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)

interface Call {
  url: string
  method: string
  body: unknown
}
let calls: Call[]
let cloudRows: ParkingSession[]
/** What /photos/materialize returns, by role. */
let cloudPhotos: Record<string, string | null>

async function fakeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? 'GET'
  let body: unknown = init.body
  if (typeof body === 'string') body = JSON.parse(body)
  calls.push({ url: input, method, body })
  if (input.endsWith('/photos/presign')) {
    const role = (body as { role: string }).role
    return Response.json({ url: `https://s3.test/${role}`, key: `u/${ID}/${role}.jpg`, bucket: 'b' })
  }
  if (input.startsWith('https://s3.test/')) return new Response('', { status: 200 })
  if (input.endsWith('/sessions/upload')) return Response.json({ ok: true })
  if (input.endsWith('/sessions/list')) return Response.json({ sessions: cloudRows })
  if (input.endsWith('/photos/materialize')) {
    return Response.json({ data_url: cloudPhotos[(body as { role: string }).role] ?? null })
  }
  return new Response('not found', { status: 404 })
}

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

const ref = (role: PhotoRef['role'], sha256: string): PhotoRef => ({
  role,
  sha256,
  captured_at: '2026-10-20T00:59:00.000Z',
  source: 'camera_input',
})

beforeEach(() => {
  localStorage.clear()
  calls = []
  cloudRows = []
  cloudPhotos = {}
  getIdToken.mockImplementation(async () => 'test-token')
  setPhotoBackendForTests(createMemoryPhotoBackend())
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  setPhotoBackendForTests(null)
  vi.unstubAllGlobals()
})

describe('uploadSession reads photos through the photo store', () => {
  it('uploads a new record\'s photo-store sign and car photos under their roles, bytes unchanged', async () => {
    const sign = jpeg('store-sign')
    const car = jpeg('store-car')
    const s = record({ photos: [ref('sign', await putPhoto(ID, sign)), ref('car', await putPhoto(ID, car))] })

    expect(await uploadSession(s)).toEqual({ photoFailed: false })

    const presigned = calls.filter((c) => c.url.endsWith('/photos/presign')).map((c) => (c.body as { role: string }).role)
    expect(presigned.sort()).toEqual(['car', 'sign'])
    const put = calls.find((c) => c.url === 'https://s3.test/sign')!
    const uploaded = new Uint8Array(await (put.body as Blob).arrayBuffer())
    const hex = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', uploaded)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
    expect(hex).toBe(await hashDataUrlImage(sign))
    // The metadata row still carries null legacy fields.
    const row = calls.find((c) => c.url.endsWith('/sessions/upload'))!.body as { session: ParkingSession }
    expect(row.session.sign_photo).toBeNull()
    expect(row.session.car_photo).toBeNull()
  })

  it('a ref whose bytes are not on this device uploads nothing for that role', async () => {
    const s = record({ photos: [ref('sign', 'a'.repeat(64))] })
    expect(await uploadSession(s)).toEqual({ photoFailed: false })
    expect(calls.some((c) => c.url.endsWith('/photos/presign'))).toBe(false)
    expect(calls.some((c) => c.url.endsWith('/sessions/upload'))).toBe(true)
  })

  it('an old record still uploads its legacy data-URL photos', async () => {
    await uploadSession(record({ sign_photo: jpeg('legacy-sign') }))
    expect(calls.filter((c) => c.url.endsWith('/photos/presign')).map((c) => (c.body as { role: string }).role)).toEqual(['sign'])
  })
})

describe('performInitialSync and photo-store photos', () => {
  it('keeps a photo-store photo\'s legacy field null; other roles still take the cloud URL', async () => {
    const sha = await putPhoto(ID, jpeg('local-sign'))
    saveSession(record({ photos: [ref('sign', sha)] }))
    cloudRows = [record({ sign_photo: 'https://cdn.test/sign.jpg', car_photo: 'https://cdn.test/car.jpg' })]

    const result = await performInitialSync()

    expect(result.alreadyInSync).toBe(1)
    const local = getSession(ID)!
    expect(local.sign_photo).toBeNull()
    expect(local.car_photo).toBe('https://cdn.test/car.jpg')
  })

  it('a photo-store photo whose bytes are not on this device takes the cloud URL, so it still shows', async () => {
    saveSession(record({ photos: [ref('sign', 'a'.repeat(64))] }))
    cloudRows = [record({ sign_photo: 'https://cdn.test/sign.jpg' })]
    await performInitialSync()
    expect(getSession(ID)!.sign_photo).toBe('https://cdn.test/sign.jpg')
  })
})

describe('materializeRefPhotoFromCloud (interim, until T0b4)', () => {
  it('returns the cloud copy only when its bytes match the ref', async () => {
    const sign = jpeg('cloud-sign')
    cloudPhotos = { sign, car: jpeg('some-other-photo') }
    const sha = await hashDataUrlImage(sign)
    expect(await materializeRefPhotoFromCloud(ID, 'sign', sha)).toBe(sign)
    expect(await materializeRefPhotoFromCloud(ID, 'car', sha)).toBeNull()
    expect(await materializeRefPhotoFromCloud(ID, 'ambient', sha)).toBeNull() // no cloud copy
  })

  it('signed out: null, and no request is made', async () => {
    getIdToken.mockImplementation(async () => null)
    expect(await materializeRefPhotoFromCloud(ID, 'sign', 'a'.repeat(64))).toBeNull()
    expect(calls).toEqual([])
  })

  it('never throws: a failed request is null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    expect(await materializeRefPhotoFromCloud(ID, 'sign', 'a'.repeat(64))).toBeNull()
  })
})
