// @vitest-environment happy-dom
//
// A photo part queued after saving stays queued once, even when listing its
// photos on the record then fails because the device's storage is full
// (build spec T2, item 5). The part carries the photos, so the add counts
// as done: a second tap must never queue the same photos as another part.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PhotoRef } from '../types'

const failListing = vi.hoisted(() => ({ on: false }))

vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))
vi.mock('./storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('./storage')>()
  return {
    ...real,
    // Only record-photos' own write (listing the refs) goes through this
    // export; queueing the part writes inside storage.ts itself.
    updateSession: (...args: Parameters<typeof real.updateSession>) => {
      if (failListing.on) throw new real.StorageFullError()
      return real.updateSession(...args)
    },
  }
})

import { addCompliancePhoto, addConditionPhotos } from './record-photos'
import { getSession, saveSession } from './storage'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from './photo-store'
import { referencedPhotoHashes } from './evidence-photos'
import { resetSigningQueueForTests, whenSigningIdle } from './signing'

const photo = (role: PhotoRef['role'], c: string): PhotoRef => ({
  role,
  sha256: c.repeat(64),
  captured_at: '2026-11-08T01:02:00.000Z',
  source: 'camera_input',
})

beforeEach(() => {
  localStorage.clear()
  resetSigningQueueForTests()
  setPhotoBackendForTests(createMemoryPhotoBackend())
  failListing.on = false
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
})

afterEach(async () => {
  await whenSigningIdle()
  setPhotoBackendForTests(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('storage full after the part was queued', () => {
  it('addConditionPhotos still returns the queued part; the record refers to the photos through it', () => {
    saveSession({
      id: 'rec-full',
      arrived_at: '2026-11-08T01:00:00.000Z',
      location: null,
      sign_photo: null,
      car_photo: null,
      rules: '2P',
      observations: [],
      expires_at: null,
      confidence: 'high',
    })
    failListing.on = true
    const front = photo('condition-front', 'a')
    const queued = addConditionPhotos('rec-full', 'parking', [front], 'Dent')
    expect(queued).toMatchObject({ kind: 'condition' })
    const s = getSession('rec-full')!
    expect(s.addenda).toHaveLength(1)
    expect(s.photos).toBeUndefined() // the listing failed
    expect(referencedPhotoHashes(s).has(front.sha256)).toBe(true) // the bytes stay protected

    const proof = photo('compliance', 'b')
    expect(addCompliancePhoto('rec-full', 'meter_ticket', proof)).toMatchObject({ kind: 'compliance' })
    expect(getSession('rec-full')!.addenda).toHaveLength(2)
  })
})
