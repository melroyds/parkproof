// @vitest-environment happy-dom
//
// A device still signed in to an account that was deleted (on another
// device, in another tab, or by this device's own Delete forever whose
// answer was lost): its next signed-in call is refused with 410
// ERR_ACCOUNT_DELETED, authFetch fires ACCOUNT_DELETED_EVENT
// (sync-account-deleted.test.ts), and the AuthProvider signs this device
// out, the way Sign out does, and raises the notice. The records on this
// device are never cleared for it, nor their photos, and nothing is sent:
// they stay until the driver deletes them. Once Delete forever clears the
// device in another tab, the notice, which says they are still here, closes.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession } from '../types'

const cognito = vi.hoisted(() => {
  const state = { signedIn: true }
  return {
    state,
    authConfigured: vi.fn(() => true),
    getCurrentUser: vi.fn(async () => (state.signedIn ? { userId: 'user-1', email: 'sam@example.com' } : null)),
    signOut: vi.fn(() => {
      state.signedIn = false
    }),
    getIdToken: vi.fn(async (): Promise<string | null> => null),
  }
})
vi.mock('./auth', () => ({
  authConfigured: cognito.authConfigured,
  getCurrentUser: cognito.getCurrentUser,
  signOut: cognito.signOut,
  getIdToken: cognito.getIdToken,
}))
vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

import { AuthProvider } from './auth-context'
import { useAuth } from './use-auth'
import { ACCOUNT_DELETED_EVENT, WIPED_AT_KEY, listCloudSessions, resetSyncForTests } from './sync'
import { loadSessions, saveSession } from './storage'
import { createMemoryPhotoBackend, getPhotoBytes, photoKey, putPhoto, setPhotoBackendForTests } from './photo-store'
import { fakeIdToken } from './test-support/fake-cloud'

const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const SIGNED_IN = 'Signed in as sam@example.com'
const PHOTO = 'data:image/jpeg;base64,' + btoa('photo bytes')

function record(): ParkingSession {
  return {
    id: ID,
    arrived_at: '2026-11-15T01:00:00.000Z',
    location: null,
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
  }
}

/** What the screens see of the auth state, and the account-deleted notice with its close button. */
function Who() {
  const { user, loading, accountDeletedNotice, dismissAccountDeletedNotice, refresh } = useAuth()
  if (loading) return <p>Checking</p>
  return (
    <div>
      <p>{user ? `Signed in as ${user.email}` : 'Signed out'}</p>
      {accountDeletedNotice && <p>Account deleted</p>}
      <button onClick={dismissAccountDeletedNotice}>Close</button>
      <button onClick={() => void refresh()}>Refresh</button>
    </div>
  )
}

async function renderSignedIn() {
  const view = render(
    <AuthProvider>
      <Who />
    </AuthProvider>,
  )
  expect(await screen.findByText(SIGNED_IN)).toBeTruthy()
  return view
}

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  resetSyncForTests()
  cognito.state.signedIn = true
  cognito.getIdToken.mockImplementation(async () => (cognito.state.signedIn ? fakeIdToken('user-1') : null))
  saveSession(record())
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
  vi.unstubAllGlobals()
})

/** Another tab of this browser cleared the device: what its clearLocalRecords stores reaches this tab as a storage event. */
function anotherTabClearedTheDevice() {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: WIPED_AT_KEY, newValue: String(Date.now()) }))
  })
}

describe('an account that was deleted', () => {
  it('signs this device out, the way Sign out does, keeps its records and their photos, and sends nothing', async () => {
    const api = vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', api)
    const photos = createMemoryPhotoBackend()
    setPhotoBackendForTests(photos)
    const sha256 = await putPhoto(ID, PHOTO)
    // Written long ago: even the startup GC run as if no record were saved here would delete it.
    photos.records.get(photoKey(ID, sha256))!.created_at = 0
    await renderSignedIn()
    await act(async () => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT, { detail: { path: '/sessions/list', account: 'user-1' } }))
    })
    expect(await screen.findByText('Signed out')).toBeTruthy()
    expect(cognito.signOut).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[auth\] /))
    expect(loadSessions().map((s) => s.id)).toEqual([ID])
    expect(await getPhotoBytes(ID, sha256)).not.toBeNull()
    // Not even a delete of the account: whoever deleted it, this device only signs out.
    expect(api).not.toHaveBeenCalled()
  })

  it('a call refused with 410 ERR_ACCOUNT_DELETED signs out, and the next call stops before the network', async () => {
    const api = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'ERR_ACCOUNT_DELETED' }), {
          status: 410,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', api)
    await renderSignedIn()
    await act(async () => {
      await expect(listCloudSessions()).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
    })
    expect(await screen.findByText('Signed out')).toBeTruthy()
    expect(cognito.signOut).toHaveBeenCalledTimes(1)
    // Signed out, sync stops on its own: no token, no request.
    await expect(listCloudSessions()).rejects.toThrow('Not signed in')
    expect(api).toHaveBeenCalledTimes(1)
    expect(loadSessions().map((s) => s.id)).toEqual([ID])
  })

  it('stops listening once the provider is gone', async () => {
    const { unmount } = await renderSignedIn()
    unmount()
    window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT, { detail: { path: '/sessions/list' } }))
    expect(cognito.signOut).not.toHaveBeenCalled()
  })

  it('any other window event signs nothing out', async () => {
    await renderSignedIn()
    await act(async () => {
      window.dispatchEvent(new CustomEvent('parkproof:records-changed', { detail: { id: ID } }))
    })
    expect(screen.getByText(SIGNED_IN)).toBeTruthy()
    expect(cognito.signOut).not.toHaveBeenCalled()
    expect(screen.queryByText('Account deleted')).toBeNull()
  })

  // Home and Account read accountDeletedNotice to say why this device was
  // signed out (settings.accountDeletedNotice): without it the driver only
  // saw "You're signed out.", or a "Couldn't load your saved records" banner.
  it('keeps the reason for the screens until the driver closes it', async () => {
    await renderSignedIn()
    expect(screen.queryByText('Account deleted')).toBeNull()
    await act(async () => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT, { detail: { path: '/sessions/list' } }))
    })
    expect(await screen.findByText('Signed out')).toBeTruthy()
    expect(screen.getByText('Account deleted')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText('Account deleted')).toBeNull()
    // A refusal still in flight then (an upload's row) doesn't bring it back.
    await act(async () => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT, { detail: { path: '/sessions/upload' } }))
    })
    expect(screen.queryByText('Account deleted')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('a sign-in clears it, and a later deletion raises it again', async () => {
    await renderSignedIn()
    await act(async () => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT, { detail: { path: '/sessions/list' } }))
    })
    expect(await screen.findByText('Account deleted')).toBeTruthy()

    // Someone signs in again (another account, or this one if only part of it was deleted).
    cognito.state.signedIn = true
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText(SIGNED_IN)).toBeTruthy()
    expect(screen.queryByText('Account deleted')).toBeNull()

    await act(async () => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT, { detail: { path: '/sessions/list' } }))
    })
    expect(await screen.findByText('Account deleted')).toBeTruthy()
    expect(cognito.signOut).toHaveBeenCalledTimes(2)
  })

  // Delete forever in another tab of this browser: a refusal here while it
  // ran raised the notice. When it answers, that tab signs the browser out
  // and clears the records and photos both tabs share, so the notice would
  // say they are still here above an empty list.
  it('closes once another tab has cleared this device', async () => {
    await renderSignedIn()
    await act(async () => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT, { detail: { path: '/sessions/list', account: 'user-1' } }))
    })
    expect(await screen.findByText('Account deleted')).toBeTruthy()
    // Anything else another tab writes (a record it saved) leaves it alone.
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'parkproof.sessions.v1', newValue: '[]' }))
    })
    expect(screen.getByText('Account deleted')).toBeTruthy()

    anotherTabClearedTheDevice()
    expect(screen.queryByText('Account deleted')).toBeNull()
    expect(screen.getByText('Signed out')).toBeTruthy()
  })

  // The other order: the refusal of a call this tab sent before the other
  // tab cleared the device arrives only after the clear.
  it('a refusal that reaches this tab after another tab cleared the device signs out without it, until someone signs in', async () => {
    await renderSignedIn()
    // The other tab signed the browser out (the tokens are shared), then cleared the device.
    cognito.state.signedIn = false
    anotherTabClearedTheDevice()
    await act(async () => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT, { detail: { path: '/sessions/list', account: 'user-1' } }))
    })
    expect(await screen.findByText('Signed out')).toBeTruthy()
    expect(screen.queryByText('Account deleted')).toBeNull()

    // After a sign-in, the next deletion raises it as before.
    cognito.state.signedIn = true
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText(SIGNED_IN)).toBeTruthy()
    await act(async () => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT, { detail: { path: '/sessions/list', account: 'user-1' } }))
    })
    expect(await screen.findByText('Account deleted')).toBeTruthy()
  })
})
