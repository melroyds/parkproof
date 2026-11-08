// @vitest-environment happy-dom
//
// Photos in cloud sync (T0b2, then T0b4 items 2, 6, 7 and 9):
//   - a photo ref uploads its photo-store bytes once, under its
//     content-addressed key; a legacy data-URL photo under its role key;
//   - upload markers (per device, per account) are set only after S3
//     answered 2xx, so nothing is uploaded twice and a failure is retried;
//   - the metadata row never carries photo bytes or URLs;
//   - a ref's missing bytes are fetched by sha256, re-hashed, and cached
//     only when they match;
//   - the first sync refreshes legacy URLs and never puts a URL on a ref.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession, PhotoRef } from '../types'

const { getIdToken } = vi.hoisted(() => ({ getIdToken: vi.fn(async (): Promise<string | null> => null) }))
vi.mock('./auth', () => ({ getIdToken }))

import {
  fetchRefPhotoFromCloud,
  legacyUploadMarker,
  performInitialSync,
  refUploadMarker,
  resetSyncForTests,
  uploadSession,
  uploadedPhotoMarkers,
} from './sync'
import { getSession, saveSession } from './storage'
import { createMemoryPhotoBackend, getPhoto, putPhoto, setPhotoBackendForTests } from './photo-store'
import { hashDataUrlImage } from './hash'
import { photoSourceVersion, resolveSessionPhoto, setRemotePhotoFetcher } from './session-photos'
import { createFakeCloud, fakeIdToken, type FakeCloud } from './test-support/fake-cloud'

const ID = '7d1e2f3a-4b5c-4d6e-8f70-1a2b3c4d5e6f'
const USER = 'user-1'
const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)

let cloud: FakeCloud

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

const presigns = () => cloud.calls.filter((c) => c.url.endsWith('/photos/presign')).map((c) => c.body as Record<string, unknown>)

beforeEach(() => {
  localStorage.clear()
  resetSyncForTests()
  cloud = createFakeCloud(USER)
  getIdToken.mockImplementation(async () => fakeIdToken(USER))
  setPhotoBackendForTests(createMemoryPhotoBackend())
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => cloud.fetch(input, init)))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  setPhotoBackendForTests(null)
  setRemotePhotoFetcher(null)
  vi.unstubAllGlobals()
})

describe('uploadSession: photos', () => {
  it('uploads a new record\'s photo-store photos under content-addressed keys, bytes unchanged', async () => {
    const sign = jpeg('store-sign')
    const car = jpeg('store-car')
    const signSha = await putPhoto(ID, sign)
    const carSha = await putPhoto(ID, car)
    saveSession(record({ photos: [ref('sign', signSha), ref('car', carSha)] }))

    expect(await uploadSession(getSession(ID)!)).toEqual({ photoFailed: false })

    expect(presigns().map((b) => b.sha256).sort()).toEqual([signSha, carSha].sort())
    expect(presigns().every((b) => b.role === undefined && b.content_type === 'image/jpeg')).toBe(true)
    expect(cloud.objectDataUrl(`${USER}/${ID}/p/${signSha}.jpg`)).toBe(sign)
    expect(await hashDataUrlImage(cloud.objectDataUrl(`${USER}/${ID}/p/${carSha}.jpg`)!)).toBe(carSha)
    // Nothing went to the per-role keys, and the row carries no photo.
    expect(cloud.objects.has(`${USER}/${ID}/sign.jpg`)).toBe(false)
    const row = cloud.uploads()[0]
    expect(row.sign_photo).toBeNull()
    expect(row.car_photo).toBeNull()
  })

  it('a ref whose bytes are not on this device uploads nothing for it, and is not a failure', async () => {
    saveSession(record({ photos: [ref('sign', 'a'.repeat(64))] }))
    expect(await uploadSession(getSession(ID)!)).toEqual({ photoFailed: false })
    expect(presigns()).toHaveLength(0)
    expect(cloud.uploads()).toHaveLength(1)
  })

  it('an old record uploads its legacy data-URL photos under their role keys, and the row stays photo-free', async () => {
    saveSession(record({ sign_photo: jpeg('legacy-sign'), car_photo: 'https://expired.test/car.jpg' }))
    await uploadSession(getSession(ID)!)
    expect(presigns()).toEqual([{ session_id: ID, role: 'sign', content_type: 'image/jpeg' }])
    expect(cloud.objectDataUrl(`${USER}/${ID}/sign.jpg`)).toBe(jpeg('legacy-sign'))
    const row = cloud.uploads()[0]
    // Neither the data URL nor the (expired) presigned URL is sent.
    expect(row.sign_photo).toBeNull()
    expect(row.car_photo).toBeNull()
    // The local copy keeps its photo.
    expect(getSession(ID)!.sign_photo).toBe(jpeg('legacy-sign'))
  })

  it('never uploads a photo twice: markers are set after the PUT, per account', async () => {
    const sha = await putPhoto(ID, jpeg('once'))
    saveSession(record({ sign_photo: jpeg('legacy-once'), photos: [ref('car', sha)] }))
    await uploadSession(getSession(ID)!)
    expect(cloud.photoPuts()).toHaveLength(2)
    expect(uploadedPhotoMarkers(USER)).toEqual(new Set([refUploadMarker(ID, sha), legacyUploadMarker(ID, 'sign')]))

    await uploadSession(getSession(ID)!)
    expect(cloud.photoPuts()).toHaveLength(2)
    expect(presigns()).toHaveLength(2)
    expect(cloud.uploads()).toHaveLength(2) // the row still goes up

    // Another account on this device has its own S3 prefix: its markers are
    // its own, so both photos are offered to the cloud again.
    getIdToken.mockImplementation(async () => fakeIdToken('user-2'))
    await uploadSession(getSession(ID)!)
    expect(presigns()).toHaveLength(4)
    expect(uploadedPhotoMarkers('user-2').size).toBe(2)
  })

  it('a failed PUT sets no marker and reports photoFailed; the next upload retries it', async () => {
    const sha = await putPhoto(ID, jpeg('flaky'))
    saveSession(record({ photos: [ref('sign', sha)] }))
    cloud.failPut.add(`${USER}/${ID}/p/${sha}.jpg`)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await uploadSession(getSession(ID)!)).toEqual({ photoFailed: true })
    expect(uploadedPhotoMarkers(USER).size).toBe(0)
    expect(cloud.uploads()).toHaveLength(1)

    cloud.failPut.clear()
    expect(await uploadSession(getSession(ID)!)).toEqual({ photoFailed: false })
    expect(cloud.objects.has(`${USER}/${ID}/p/${sha}.jpg`)).toBe(true)
    expect(uploadedPhotoMarkers(USER).has(refUploadMarker(ID, sha))).toBe(true)
  })

  it('a ref the cloud already has is marked without sending the bytes', async () => {
    const photo = jpeg('already-there')
    const sha = await putPhoto(ID, photo)
    cloud.putObject(`${USER}/${ID}/p/${sha}.jpg`, photo)
    saveSession(record({ photos: [ref('sign', sha)] }))
    await uploadSession(getSession(ID)!)
    expect(presigns()).toHaveLength(1)
    expect(cloud.photoPuts()).toHaveLength(0)
    expect(uploadedPhotoMarkers(USER).has(refUploadMarker(ID, sha))).toBe(true)
  })
})

describe('photo_sync_failed stays on the device that set it', () => {
  it('is never uploaded, and clears once every photo of the record is known to be in S3', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sha = await putPhoto(ID, jpeg('flagged'))
    saveSession(record({ photo_sync_failed: true, photos: [ref('car', sha)] }))
    cloud.failPut.add(`${USER}/${ID}/p/${sha}.jpg`)
    expect(await uploadSession(getSession(ID)!)).toEqual({ photoFailed: true })
    expect('photo_sync_failed' in cloud.uploads()[0]).toBe(false)
    expect(getSession(ID)!.photo_sync_failed).toBe(true)

    // A later mirror (a signature landing, say) gets the photo up: the banner goes on its own.
    cloud.failPut.clear()
    expect(await uploadSession(getSession(ID)!)).toEqual({ photoFailed: false })
    expect(getSession(ID)!.photo_sync_failed).toBe(false)
    expect('photo_sync_failed' in cloud.rows.get(ID)!).toBe(false)
  })

  it('stays while a photo of the record is not known to be in S3 (its bytes are not here to send)', async () => {
    saveSession(record({ photo_sync_failed: true, photos: [ref('car', 'c'.repeat(64))] }))
    expect(await uploadSession(getSession(ID)!)).toEqual({ photoFailed: false })
    expect(getSession(ID)!.photo_sync_failed).toBe(true)
  })

  it("a record pulled from the cloud never takes another device's flag", async () => {
    cloud.rows.set(ID, { ...record({ photo_sync_failed: true }) })
    expect((await performInitialSync()).pulled).toBe(1)
    expect(getSession(ID)!.photo_sync_failed).toBeUndefined()
  })
})

describe('a record the cloud no longer has (deleted on another device)', () => {
  it('goes back up with its photos: the delete swept them, so the markers no longer hold', async () => {
    const sha = await putPhoto(ID, jpeg('swept'))
    saveSession(record({ photos: [ref('sign', sha)] }))
    await uploadSession(getSession(ID)!)
    expect(cloud.photoPuts()).toHaveLength(1)

    // Another device deleted it: the row and every object under the record go.
    cloud.rows.delete(ID)
    for (const key of [...cloud.objects.keys()]) cloud.objects.delete(key)
    expect((await performInitialSync()).uploaded).toBe(1)
    expect(cloud.photoPuts()).toHaveLength(2)
    expect(cloud.objects.has(`${USER}/${ID}/p/${sha}.jpg`)).toBe(true)
    expect(uploadedPhotoMarkers(USER).has(refUploadMarker(ID, sha))).toBe(true)

    // Only the row is missing (its upload failed after the photo went up): one presign, no bytes.
    cloud.rows.delete(ID)
    const before = presigns().length
    await performInitialSync()
    expect(presigns()).toHaveLength(before + 1)
    expect(cloud.photoPuts()).toHaveLength(2)
  })

  it('keeps its markers when the cloud could not be listed', async () => {
    const sha = await putPhoto(ID, jpeg('kept-markers'))
    saveSession(record({ photos: [ref('sign', sha)] }))
    await uploadSession(getSession(ID)!)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const realFetch = cloud.fetch
    vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) =>
      input.endsWith('/sessions/list') ? Promise.resolve(new Response('boom', { status: 503 })) : realFetch(input, init),
    ))
    expect((await performInitialSync()).listFailed).toBe(true)
    expect(uploadedPhotoMarkers(USER).has(refUploadMarker(ID, sha))).toBe(true)
    expect(presigns()).toHaveLength(1)
  })
})

describe('fetchRefPhotoFromCloud (missing local bytes)', () => {
  it('never waits behind photo uploads: fetches and uploads have their own limits', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let held = 0
    cloud.beforePut = async () => {
      held++
      await gate
    }
    const uploads: Array<Promise<unknown>> = []
    for (let i = 0; i < 6; i++) {
      const id = `upload-${i}`
      const sha = await putPhoto(id, jpeg(`queued-${i}`))
      saveSession(record({ id, photos: [ref('car', sha)] }))
      uploads.push(uploadSession(getSession(id)!))
    }
    // Every upload place is taken, and two more wait.
    await vi.waitFor(() => expect(held).toBe(4))
    const photo = jpeg('wanted-on-screen')
    const sha = await hashDataUrlImage(photo)
    cloud.putObject(`${USER}/${ID}/p/${sha}.jpg`, photo)
    expect(await fetchRefPhotoFromCloud(ID, sha)).toBe(photo)
    expect(held).toBe(4)
    release()
    await Promise.all(uploads)
    expect(held).toBe(6)
  })

  it('bytes kept here tell the photo readers to look again', async () => {
    const photo = jpeg('kept-for-readers')
    const sha = await hashDataUrlImage(photo)
    cloud.putObject(`${USER}/${ID}/p/${sha}.jpg`, photo)
    const before = photoSourceVersion()
    await fetchRefPhotoFromCloud(ID, sha)
    expect(photoSourceVersion()).toBeGreaterThan(before)
    // A miss changes nothing for them.
    const after = photoSourceVersion()
    await fetchRefPhotoFromCloud(ID, 'f'.repeat(64))
    expect(photoSourceVersion()).toBe(after)
  })

  it('returns matching bytes, caches them in the photo store, and marks them as uploaded', async () => {
    const photo = jpeg('cloud-only')
    const sha = await hashDataUrlImage(photo)
    cloud.putObject(`${USER}/${ID}/p/${sha}.jpg`, photo)
    expect(await fetchRefPhotoFromCloud(ID, sha)).toBe(photo)
    expect(await getPhoto(ID, sha)).toBe(photo)
    expect(uploadedPhotoMarkers(USER).has(refUploadMarker(ID, sha))).toBe(true)
    // Asked by sha256, not by role.
    expect(cloud.calls.find((c) => c.url.endsWith('/photos/materialize'))!.body).toEqual({ session_id: ID, sha256: sha })
  })

  it('bytes that do not hash to the ref are not used and not cached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sha = 'c'.repeat(64)
    cloud.putObject(`${USER}/${ID}/p/${sha}.jpg`, jpeg('some-other-photo'))
    expect(await fetchRefPhotoFromCloud(ID, sha)).toBeNull()
    expect(await getPhoto(ID, sha)).toBeNull()
  })

  it('signed out: null, and no request is made', async () => {
    getIdToken.mockImplementation(async () => null)
    expect(await fetchRefPhotoFromCloud(ID, 'a'.repeat(64))).toBeNull()
    expect(cloud.calls).toEqual([])
  })

  it('concurrent asks share one request; a miss is not asked again straight away', async () => {
    const photo = jpeg('shared-request')
    const sha = await hashDataUrlImage(photo)
    cloud.putObject(`${USER}/${ID}/p/${sha}.jpg`, photo)
    const [a, b] = await Promise.all([fetchRefPhotoFromCloud(ID, sha), fetchRefPhotoFromCloud(ID, sha)])
    expect(a).toBe(photo)
    expect(b).toBe(photo)
    expect(cloud.calls.filter((c) => c.url.endsWith('/photos/materialize'))).toHaveLength(1)

    const absent = 'd'.repeat(64)
    expect(await fetchRefPhotoFromCloud(ID, absent)).toBeNull()
    expect(await fetchRefPhotoFromCloud(ID, absent)).toBeNull()
    expect(cloud.calls.filter((c) => c.url.endsWith('/photos/materialize'))).toHaveLength(2)
  })

  it('never throws: a failed request is null', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    expect(await fetchRefPhotoFromCloud(ID, 'e'.repeat(64))).toBeNull()
  })

  it('installed as the readers\' cloud source, a missing ref resolves from the cloud', async () => {
    const photo = jpeg('reader')
    const sha = await hashDataUrlImage(photo)
    cloud.putObject(`${USER}/${ID}/p/${sha}.jpg`, photo)
    const s = record({ photos: [ref('sign', sha)] })
    expect((await resolveSessionPhoto(s, 'sign')).kind).toBe('missing')
    setRemotePhotoFetcher(fetchRefPhotoFromCloud)
    expect(await resolveSessionPhoto(s, 'sign')).toMatchObject({ kind: 'available', src: photo })
    // A read-only shared copy's photos are in someone else's account.
    const shared = record({
      id: 'shared-copy',
      photos: [ref('sign', sha)],
      shared_from: { original_session_id: ID, received_at: 't', shared_at: null, arrival_bundle: null, snapshot: {} },
    })
    expect((await resolveSessionPhoto(shared, 'sign')).kind).toBe('missing')
  })
})

describe('performInitialSync and photos', () => {
  it('a role without a ref takes the cloud\'s fresh URL; a data URL stays; a ref never gets a URL', async () => {
    const sha = await putPhoto(ID, jpeg('local-sign'))
    // An interim URL left on the ref's role by an earlier sync is dropped.
    saveSession(record({ photos: [ref('sign', sha)], sign_photo: 'https://old.test/sign.jpg', car_photo: 'https://old.test/car.jpg' }))
    cloud.rows.set(ID, { ...record({ photos: [ref('sign', sha)] }) })
    cloud.putObject(`${USER}/${ID}/sign.jpg`, jpeg('interim-sign'))
    cloud.putObject(`${USER}/${ID}/car.jpg`, jpeg('legacy-car'))

    const result = await performInitialSync()

    expect(result.alreadyInSync).toBe(1)
    const local = getSession(ID)!
    expect(local.sign_photo).toBeNull()
    expect(local.car_photo).toBe(`https://s3.test/get/${USER}/${ID}/car.jpg`)

    const legacy = 'f1e2d3c4-0000-4000-8000-000000000001'
    saveSession(record({ id: legacy, sign_photo: jpeg('kept') }))
    cloud.rows.set(legacy, { ...record({ id: legacy }) })
    cloud.putObject(`${USER}/${legacy}/sign.jpg`, jpeg('kept'))
    await performInitialSync()
    expect(getSession(legacy)!.sign_photo).toBe(jpeg('kept'))
  })

  // /sessions/list mints new URLs on every call, and the pull on return can
  // run once a minute: a URL that still has a while to run is kept, so the
  // record isn't rewritten (and its screens re-rendered) on every return.
  it('keeps a presigned legacy URL with time left, and swaps one about to expire', async () => {
    const amzDate = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const presigned = (signedAtMs: number) =>
      `https://bucket.s3.ap-southeast-2.amazonaws.com/${USER}/${ID}/car.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=${amzDate(signedAtMs)}&X-Amz-Expires=3600&X-Amz-Signature=abc`
    const fresh = presigned(Date.now() - 5 * 60_000)
    saveSession(record({ car_photo: fresh }))
    cloud.rows.set(ID, { ...record() })
    cloud.putObject(`${USER}/${ID}/car.jpg`, jpeg('legacy-car'))

    await performInitialSync()
    expect(getSession(ID)!.car_photo).toBe(fresh)

    const old = '7d1e2f3a-4b5c-4d6e-8f70-1a2b3c4d5e70'
    const nearlyExpired = presigned(Date.now() - 55 * 60_000)
    saveSession(record({ id: old, car_photo: nearlyExpired }))
    cloud.rows.set(old, { ...record({ id: old }) })
    cloud.putObject(`${USER}/${old}/car.jpg`, jpeg('legacy-car'))

    await performInitialSync()
    expect(getSession(old)!.car_photo).toBe(`https://s3.test/get/${USER}/${old}/car.jpg`)
  })
})
