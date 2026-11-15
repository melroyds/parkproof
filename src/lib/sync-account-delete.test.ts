// @vitest-environment happy-dom
//
// Deleting the account and clearing this device (local-wipe.ts) must not be
// undone by a sync that was already running: an upload overlapping
// /me/delete never puts a row or a photo back under the deleted account,
// and a listing or a cloud photo fetch that started before this device was
// cleared (in this tab or another) writes nothing back into it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession, PhotoRef } from '../types'

const { getIdToken } = vi.hoisted(() => ({ getIdToken: vi.fn(async (): Promise<string | null> => null) }))
vi.mock('./auth', () => ({ getIdToken }))
vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

import {
  ACCOUNT_DELETE_UPLOAD_WAIT_MS,
  deleteAccount,
  fetchRefPhotoFromCloud,
  noteLocalRecordsWiped,
  performInitialSync,
  resetSyncForTests,
  uploadSession,
} from './sync'
import { clearLocalRecords } from './local-wipe'
import { deleteSession, getSession, loadSessions, saveSession } from './storage'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from './photo-store'
import { hashDataUrlImage } from './hash'
import { resetSigningQueueForTests, whenSigningIdle } from './signing'
import { createFakeCloud, fakeIdToken, type FakeCloud } from './test-support/fake-cloud'

const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const CLOUD_ONLY = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const USER = 'user-1'
const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)
let cloud: FakeCloud
let photos: ReturnType<typeof createMemoryPhotoBackend>
/** How many times /me/delete was called, and whether it answers 500. */
let meDeletes = 0
let failMeDelete = false
/** Answers held on their way back to this device, by route. */
const held = new Map<string, { entered: () => void; released: Promise<void> }>()

/**
 * Hold the next answer on `route`: the server answers at once (the fake
 * cloud reads or changes its state then), and the answer reaches this
 * device only when released. `entered` resolves once it is held.
 */
function holdNextAnswer(route: string): { entered: Promise<void>; release: () => void } {
  let signal!: () => void
  const entered = new Promise<void>((resolve) => {
    signal = resolve
  })
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  held.set(route, { entered: signal, released })
  return { entered, release }
}

/** Hold the photo store's next listing (where clearing it starts) until released. */
function holdPhotoStoreClearing(): { release: () => void } {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const listMeta = photos.listMeta
  photos.listMeta = async () => {
    photos.listMeta = listMeta
    await released
    return listMeta()
  }
  return { release }
}

/** The evidence bucket's objects under the account's prefix. */
const accountObjects = () => [...cloud.objects.keys()].filter((key) => key.startsWith(`${USER}/`))

const ref = (sha256: string, role: PhotoRef['role'] = 'sign'): PhotoRef => ({
  role,
  sha256,
  captured_at: '2026-11-12T00:59:00.000Z',
  source: 'camera_input',
})

function record(id: string, overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id,
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

beforeEach(() => {
  localStorage.clear()
  resetSyncForTests()
  resetSigningQueueForTests()
  cloud = createFakeCloud(USER)
  meDeletes = 0
  failMeDelete = false
  held.clear()
  getIdToken.mockImplementation(async () => fakeIdToken(USER))
  photos = createMemoryPhotoBackend()
  setPhotoBackendForTests(photos)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input.endsWith('/me/delete')) {
        meDeletes++
        if (failMeDelete) return new Response(JSON.stringify({ error: 'ERR_INTERNAL' }), { status: 500 })
        // What /me/delete does: every row of the account, and every object
        // under its prefix in the evidence bucket.
        cloud.rows.clear()
        for (const key of accountObjects()) cloud.objects.delete(key)
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      for (const [route, hold] of held) {
        if (!input.endsWith(route)) continue
        held.delete(route)
        const answer = await cloud.fetch(input, init)
        hold.entered()
        await hold.released
        return answer
      }
      return cloud.fetch(input, init)
    }),
  )
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  await whenSigningIdle()
  setPhotoBackendForTests(null)
  vi.unstubAllGlobals()
})

describe('deleting the account while a sync runs', () => {
  it('an upload overlapping the account delete never puts a row or a photo back under it', async () => {
    const sha = await putPhoto(ID, jpeg('doomed'))
    saveSession(record(ID, { photos: [ref(sha)] }))
    const deletions: Promise<void>[] = []
    cloud.beforePut = async () => {
      cloud.beforePut = null
      // Delete forever is tapped while this photo is on its way to S3.
      deletions.push(deleteAccount())
      // The delete gets as far as it can before the photo lands.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await uploadSession(getSession(ID)!)
    await Promise.all(deletions)
    expect(deletions).toHaveLength(1)
    expect(cloud.photoPuts()).toHaveLength(1)
    expect(cloud.uploads()).toHaveLength(0)
    expect(cloud.rows.has(ID)).toBe(false)
    // The photo landed before /me/delete swept the account's photos, not after.
    expect(accountObjects()).toEqual([])
  })

  it('photos still waiting their turn when the account delete starts are never sent', async () => {
    const roles: PhotoRef['role'][] = ['sign', 'car', 'ambient', 'condition-front', 'condition-rear', 'condition-left']
    const refs: PhotoRef[] = []
    for (const role of roles) refs.push(ref(await putPhoto(ID, jpeg(`photo of the ${role}`)), role))
    saveSession(record(ID, { photos: refs }))
    const deletions: Promise<void>[] = []
    cloud.beforePut = async () => {
      if (deletions.length === 0) deletions.push(deleteAccount())
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await uploadSession(getSession(ID)!)
    await Promise.all(deletions)
    // Four photos go at once (PHOTO_TRANSFER_CONCURRENCY); those were on
    // their way and landed before the sweep. The other two never went.
    expect(cloud.photoPuts()).toHaveLength(4)
    expect(cloud.calls.filter((c) => c.url.endsWith('/photos/presign'))).toHaveLength(4)
    expect(cloud.uploads()).toHaveLength(0)
    expect(accountObjects()).toEqual([])
  })

  it('waits for an upload already running before it deletes the account, for ACCOUNT_DELETE_UPLOAD_WAIT_MS at most', async () => {
    const sha = await putPhoto(ID, jpeg('on a dead connection'))
    saveSession(record(ID, { photos: [ref(sha)] }))
    let putEntered!: () => void
    const putStarted = new Promise<void>((resolve) => {
      putEntered = resolve
    })
    let releasePut!: () => void
    const putHeld = new Promise<void>((resolve) => {
      releasePut = resolve
    })
    cloud.beforePut = async () => {
      putEntered()
      await putHeld
    }
    const upload = uploadSession(getSession(ID)!)
    await putStarted
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const deletion = deleteAccount()
      await vi.advanceTimersByTimeAsync(ACCOUNT_DELETE_UPLOAD_WAIT_MS - 1)
      expect(meDeletes).toBe(0)
      // A photo that never lands holds the delete this long, and no longer.
      await vi.advanceTimersByTimeAsync(1)
      vi.useRealTimers()
      await deletion
      expect(meDeletes).toBe(1)
    } finally {
      vi.useRealTimers()
      // Let the held photo go, so its upload doesn't keep a place in the
      // photo queue from the tests after this one.
      releasePut()
      await upload
    }
    expect(cloud.uploads()).toHaveLength(0)
  })

  it('a listing answered before this device was cleared pulls nothing back', async () => {
    cloud.rows.set(CLOUD_ONLY, { ...record(CLOUD_ONLY) })
    const listing = holdNextAnswer('/sessions/list')
    // Clearing the photo store takes a while, so the answer arrives while
    // this device is still being cleared.
    const photoStore = holdPhotoStoreClearing()
    const sync = performInitialSync()
    await listing.entered
    // The account is deleted and this device cleared while the answer is on its way.
    const wipe = clearLocalRecords()
    listing.release()
    const result = await sync
    photoStore.release()
    await wipe
    expect(result.pulled).toBe(0)
    expect(loadSessions()).toEqual([])
  })

  it('a listing that started before another open tab cleared the device pulls nothing back', async () => {
    // The clock is driven, so the listing's start, the other tab's wipe and
    // the moment the answer lands are strictly in that order.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const started = Date.parse('2026-11-15T01:00:00.000Z')
      vi.setSystemTime(started)
      cloud.rows.set(CLOUD_ONLY, { ...record(CLOUD_ONLY) })
      const listing = holdNextAnswer('/sessions/list')
      const sync = performInitialSync()
      await listing.entered
      // Another tab deleted the account and cleared the records both tabs
      // share. This tab's own barrier never moved: only the wipe time that
      // tab stored tells it.
      localStorage.setItem('parkproof.sync.wiped_at.v1', String(started + 1_000))
      vi.setSystemTime(started + 2_000)
      listing.release()
      const result = await sync
      expect(result.pulled).toBe(0)
      expect(loadSessions()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a stored wipe time ahead of the clock (the clock went back) stops nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const now = Date.parse('2026-11-15T01:00:00.000Z')
      vi.setSystemTime(now)
      // Written while the phone's clock was an hour fast, then corrected.
      localStorage.setItem('parkproof.sync.wiped_at.v1', String(now + 60 * 60_000))
      cloud.rows.set(CLOUD_ONLY, { ...record(CLOUD_ONLY) })
      const result = await performInitialSync()
      expect(result.pulled).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a listing that starts after the device was cleared pulls as usual', async () => {
    noteLocalRecordsWiped()
    cloud.rows.set(CLOUD_ONLY, { ...record(CLOUD_ONLY) })
    const result = await performInitialSync()
    expect(result.pulled).toBe(1)
    expect(getSession(CLOUD_ONLY)).toBeDefined()
  })

  it('a failed account delete throws, and leaves the records here and their rows alone', async () => {
    saveSession(record(ID))
    cloud.rows.set(ID, { ...record(ID) })
    failMeDelete = true
    await expect(deleteAccount()).rejects.toThrow()
    expect(meDeletes).toBe(1)
    expect(getSession(ID)).toBeDefined()
    expect(cloud.rows.has(ID)).toBe(true)
  })
})

describe('a cloud photo fetch overlapping a delete', () => {
  it('keeps nothing when its answer arrives after this device was cleared', async () => {
    const photo = jpeg('pulled from the cloud')
    const sha = await hashDataUrlImage(photo)
    cloud.putObject(`${USER}/${ID}/p/${sha}.jpg`, photo)
    // A record pulled from the cloud: its photo isn't on this device yet.
    saveSession(record(ID, { photos: [ref(sha)] }))
    const answer = holdNextAnswer('/photos/materialize')
    const fetching = fetchRefPhotoFromCloud(ID, sha)
    await answer.entered
    await clearLocalRecords()
    answer.release()
    // Whoever asked (a PDF being built) still gets it; this device keeps nothing.
    expect(await fetching).toBe(photo)
    expect(photos.records.size).toBe(0)
    expect(localStorage.getItem('parkproof.sync.uploaded.v1')).toBeNull()
  })

  it('keeps nothing of a record only in the cloud either, once this device was cleared', async () => {
    const photo = jpeg('never pulled')
    const sha = await hashDataUrlImage(photo)
    cloud.putObject(`${USER}/${CLOUD_ONLY}/p/${sha}.jpg`, photo)
    const answer = holdNextAnswer('/photos/materialize')
    const fetching = fetchRefPhotoFromCloud(CLOUD_ONLY, sha)
    await answer.entered
    await clearLocalRecords()
    answer.release()
    expect(await fetching).toBe(photo)
    expect(photos.records.size).toBe(0)
    expect(localStorage.getItem('parkproof.sync.uploaded.v1')).toBeNull()
  })

  it('keeps nothing for a record deleted here while its photo was on the way', async () => {
    const photo = jpeg('deleted meanwhile')
    const sha = await hashDataUrlImage(photo)
    cloud.putObject(`${USER}/${ID}/p/${sha}.jpg`, photo)
    saveSession(record(ID, { photos: [ref(sha)] }))
    const answer = holdNextAnswer('/photos/materialize')
    const fetching = fetchRefPhotoFromCloud(ID, sha)
    await answer.entered
    deleteSession(ID)
    answer.release()
    expect(await fetching).toBe(photo)
    expect(photos.records.size).toBe(0)
    expect(localStorage.getItem('parkproof.sync.uploaded.v1')).toBeNull()
  })
})
