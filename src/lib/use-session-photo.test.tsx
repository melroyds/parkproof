// @vitest-environment happy-dom
//
// useSessionPhoto and the photo source (T0b4 review): a photo that came
// out missing is asked for again when the photo source changes, so a
// screen that mounted before the cloud source was installed, or before
// sign-in, or before another reader kept the bytes here, catches up on its
// own. Thumbnails (remote: false) never ask the cloud themselves.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession } from '../types'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from './photo-store'
import { hashDataUrlImage } from './hash'
import { notifyPhotoSourceChanged, setRemotePhotoFetcher, subscribePhotoSource } from './session-photos'
import { useSessionPhoto } from './use-session-photo'

const ID = 'rec-photo-hook'
const PHOTO = 'data:image/jpeg;base64,' + btoa('the-sign-photo')
let sha = ''
let backend: ReturnType<typeof createMemoryPhotoBackend>

function record(): ParkingSession {
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
    photos: [{ role: 'sign', sha256: sha, captured_at: '2026-10-20T00:59:00.000Z', source: 'camera_input' }],
  }
}

beforeEach(async () => {
  sha = await hashDataUrlImage(PHOTO)
  backend = createMemoryPhotoBackend()
  setPhotoBackendForTests(backend)
  setRemotePhotoFetcher(null)
})

afterEach(() => {
  cleanup()
  setRemotePhotoFetcher(null)
  setPhotoBackendForTests(null)
})

describe('useSessionPhoto asks again when the photo source changes', () => {
  it('a cloud source installed after the first paint still brings the photo', async () => {
    const session = record()
    const { result } = renderHook(() => useSessionPhoto(session, 'sign'))
    await waitFor(() => expect(result.current.status).toBe('missing'))
    const fetcher = vi.fn(async () => PHOTO)
    act(() => setRemotePhotoFetcher(fetcher))
    await waitFor(() => expect(result.current).toEqual({ status: 'available', src: PHOTO }))
    expect(fetcher).toHaveBeenCalledWith(ID, sha)
  })

  it('a sign-in (a source change) makes a missing photo ask the cloud again', async () => {
    let signedIn = false
    const fetcher = vi.fn(async () => (signedIn ? PHOTO : null))
    setRemotePhotoFetcher(fetcher)
    const session = record()
    const { result } = renderHook(() => useSessionPhoto(session, 'sign'))
    await waitFor(() => expect(result.current.status).toBe('missing'))
    signedIn = true
    act(() => notifyPhotoSourceChanged())
    await waitFor(() => expect(result.current).toEqual({ status: 'available', src: PHOTO }))
  })

  it('thumbnails (remote: false) never ask the cloud, but show bytes another reader kept here', async () => {
    const fetcher = vi.fn(async () => PHOTO)
    setRemotePhotoFetcher(fetcher)
    const session = record()
    const { result } = renderHook(() => useSessionPhoto(session, 'sign', { remote: false }))
    await waitFor(() => expect(result.current.status).toBe('missing'))
    // The record screen fetched and kept the bytes, which bumps the source.
    await putPhoto(ID, PHOTO)
    act(() => notifyPhotoSourceChanged())
    await waitFor(() => expect(result.current).toEqual({ status: 'available', src: PHOTO }))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('a photo already shown is not read again on a source change', async () => {
    await putPhoto(ID, PHOTO)
    const get = vi.spyOn(backend, 'get')
    const session = record()
    const { result } = renderHook(() => useSessionPhoto(session, 'sign'))
    await waitFor(() => expect(result.current.status).toBe('available'))
    const reads = get.mock.calls.length
    act(() => notifyPhotoSourceChanged())
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(get.mock.calls.length).toBe(reads)
    expect(result.current.status).toBe('available')
  })

  it('setting the same source again is not a change', () => {
    const fetcher = vi.fn(async () => null)
    const listener = vi.fn()
    setRemotePhotoFetcher(fetcher)
    const unsubscribe = subscribePhotoSource(listener)
    setRemotePhotoFetcher(fetcher)
    expect(listener).not.toHaveBeenCalled()
    setRemotePhotoFetcher(null)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
