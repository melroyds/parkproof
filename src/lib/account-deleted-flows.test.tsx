// @vitest-environment happy-dom
//
// Delete forever on the phone, end to end: the real AuthProvider, Account
// (AuthSettings), the sync runner and the pull on return, with only Cognito
// and fetch faked. The fake server keeps a deletion marker the way
// lambda/cloud-sync.js does: /me/delete writes it first and removes it again
// when a later step fails, and while it stands, every signed-in route but
// /me/delete is refused with 410 ERR_ACCOUNT_DELETED.
//
// - This device's own delete: a pull on return refused while it runs signs
//   nothing out. When the delete fails, the server has removed its marker:
//   the device stays signed in, with the error and Delete forever on screen
//   and no notice, its next pull is served, and the retry the error asks for
//   clears the device. When the delete went through but its answer was lost,
//   the device can't tell: it shows the same error, and its next pull is
//   refused, which signs it out the way another device is signed out, with
//   the notice that the account was deleted. Nothing sends the delete again,
//   and every record stays, with its photos, those saved after the error
//   included. When the delete answers, it clears the device, and a refusal
//   reaching the device after that never says its records are still here.
// - Another device, while the marker stands: its first refused call signs it
//   out, and Account says the account was deleted. An upload caught there
//   still sends its row after its photos, with the token it started with, so
//   the server sweeps the account's photos again after the last one landed.
//   That late refusal never signs out an account signed in since.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession, PhotoRef } from '../types'

const cognito = vi.hoisted(() => {
  // Who is signed in: user-1 (sam), or user-2 (kim) after a sign-in to another account.
  const state = { signedIn: true, who: 'user-1' }
  return {
    state,
    authConfigured: vi.fn(() => true),
    getCurrentUser: vi.fn(async () =>
      state.signedIn ? { userId: state.who, email: state.who === 'user-1' ? 'sam@example.com' : 'kim@example.com' } : null,
    ),
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

import i18n from './i18n'
import { AuthProvider } from './auth-context'
import { useAuth } from './use-auth'
import AuthSettings from '../components/AuthSettings'
import {
  ACCOUNT_DELETED_EVENT,
  createSyncRunner,
  installSyncOnReturn,
  performInitialSync,
  resetSyncForTests,
  uploadSession,
} from './sync'
import { getSession, loadSessions, saveSession } from './storage'
import { createMemoryPhotoBackend, getPhotoBytes, photoKey, putPhoto, setPhotoBackendForTests } from './photo-store'
import { resetSigningQueueForTests, whenSigningIdle } from './signing'
import { fakeIdToken } from './test-support/fake-cloud'

const en = (key: string) => i18n.t(key, { lng: 'en' })
const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
/** A record saved after Delete forever said it failed. */
const LATER = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e'
const PHOTO = 'data:image/jpeg;base64,' + btoa('photo bytes')
const TOKEN = fakeIdToken('user-1')

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const refused = () => json(410, { error: 'ERR_ACCOUNT_DELETED' })

/** The account (sub) a request's Authorization header is for. */
function accountOf(auth: string | null): string | null {
  const payload = auth?.replace(/^Bearer /, '').split('.')[1]
  if (!payload) return null
  return (JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string }).sub ?? null
}

/** Every request the fake server and S3 saw, and S3 PUTs landing, in order. */
let log: string[] = []
/** The Authorization header of each signed-in request, by route. */
let auths: { route: string; auth: string | null }[] = []
/** S3 PUTs held until the test lets them land. */
const held = new Map<string, () => void>()
/** The fake server's deletion marker for user-1's account (the only one deleted here). */
let marker = false
/**
 * How /me/delete ends once its marker is in: 'ok' keeps the marker, 'fail'
 * removes it again and answers 500 with its error. 'lost' and 'gateway'
 * delete everything and keep the marker, but the phone never hears it: the
 * request fails, or API Gateway answers 503 on its own.
 */
let meDeleteEnds: 'ok' | 'fail' | 'lost' | 'gateway' = 'ok'
/** When set, /me/delete waits for it after writing its marker: the sweeps are still running. */
let meDeleteSweeps: Promise<void> | null = null
/** When set, answers /photos/presign whatever the marker (a photo presigned before it went in). */
let presign: ((body: { role?: string }) => Response) | null = null

const ROUTES = ['/me/delete', '/sessions/list', '/sessions/upload', '/photos/presign', '/photos/materialize', '/me/export']

const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  if (url.startsWith('https://s3.test/put/')) {
    const role = url.slice('https://s3.test/put/'.length)
    log.push(`PUT ${role} sent`)
    await new Promise<void>((resolve) => held.set(role, resolve))
    log.push(`PUT ${role} landed`)
    return new Response('', { status: 200 })
  }
  const route = ROUTES.find((r) => url.endsWith(r)) ?? url
  const auth = new Headers(init?.headers).get('Authorization')
  log.push(route)
  auths.push({ route, auth })
  if (route === '/me/delete') {
    marker = true
    if (meDeleteSweeps) await meDeleteSweeps
    if (meDeleteEnds === 'fail') {
      marker = false
      return json(500, { error: 'Could not delete every photo. Please try again.' })
    }
    if (meDeleteEnds === 'lost') throw new TypeError('Failed to fetch')
    if (meDeleteEnds === 'gateway') return json(503, { message: 'Service Unavailable' })
    return json(200, { ok: true, deleted_rows: 1, deleted_objects: 0 })
  }
  if (route === '/photos/presign' && presign) return presign(JSON.parse(String(init?.body ?? '{}')) as { role?: string })
  if (marker && accountOf(auth) === 'user-1') return refused()
  if (route === '/sessions/list') return json(200, { sessions: [] })
  if (route === '/sessions/upload') return json(200, { ok: true })
  return json(404, { error: 'not in this fake' })
})

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
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
    ...overrides,
  }
}

const button = (key: string) => screen.getByRole('button', { name: en(key) }) as HTMLButtonElement

/** The photo store of the test running (in memory). */
let photos = createMemoryPhotoBackend()

/**
 * Store a photo of record `id` in the photo store, and give the record's ref
 * to it. `old` writes it as if long ago, so even the startup GC run as if no
 * record were saved here would delete it.
 */
async function storePhoto(id: string, { old = false } = {}): Promise<PhotoRef> {
  const sha256 = await putPhoto(id, PHOTO)
  if (old) photos.records.get(photoKey(id, sha256))!.created_at = 0
  return { role: 'sign', sha256, captured_at: '2026-11-15T01:00:00.000Z', source: 'camera_input' }
}

/** Account, signed in, with "DELETE" typed in. */
async function openAccount(onDeleted = vi.fn()) {
  render(
    <AuthProvider>
      <AuthSettings onBack={vi.fn()} onOpenPrivacy={vi.fn()} onDeleted={onDeleted} />
    </AuthProvider>,
  )
  await screen.findByText('sam@example.com')
  fireEvent.click(button('settings.deleteStart'))
  fireEvent.change(screen.getByLabelText(en('settings.deleteConfirmLabel')), { target: { value: 'DELETE' } })
  return { onDeleted }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  resetSyncForTests()
  resetSigningQueueForTests()
  photos = createMemoryPhotoBackend()
  setPhotoBackendForTests(photos)
  cognito.state.signedIn = true
  cognito.state.who = 'user-1'
  cognito.signOut.mockClear()
  cognito.getIdToken.mockImplementation(async () => (cognito.state.signedIn ? fakeIdToken(cognito.state.who) : null))
  log = []
  auths = []
  held.clear()
  marker = false
  meDeleteEnds = 'ok'
  meDeleteSweeps = null
  presign = null
  vi.stubGlobal('fetch', api)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  for (const release of held.values()) release()
  cleanup()
  await whenSigningIdle()
  setPhotoBackendForTests(null)
  vi.unstubAllGlobals()
})

describe('Delete forever on this device', () => {
  it('a pull on return refused while it runs signs nothing out; it fails, and the device stays signed in, with no notice, for the retry', async () => {
    saveSession(record())
    const { onDeleted } = await openAccount()
    const runner = createSyncRunner(performInitialSync)
    const pulls: Promise<unknown>[] = []
    const uninstall = installSyncOnReturn(runner, (run) => {
      pulls.push(run.catch(() => {}))
    })
    let finishSweeps!: () => void
    meDeleteSweeps = new Promise<void>((resolve) => {
      finishSweeps = resolve
    })
    meDeleteEnds = 'fail'
    try {
      fireEvent.click(button('settings.deleteForever'))
      await waitFor(() => expect(log).toEqual(['/me/delete']))
      // The marker is in and the sweeps are running when the browser comes
      // back online and pulls: the listing is refused.
      await act(async () => {
        window.dispatchEvent(new Event('online'))
      })
      await waitFor(() => expect(pulls).toHaveLength(1))
      await act(async () => {
        await Promise.all(pulls)
      })
    } finally {
      uninstall()
    }
    expect(log).toEqual(['/me/delete', '/sessions/list'])
    expect(cognito.signOut).not.toHaveBeenCalled()
    expect(screen.getByText('sam@example.com')).toBeTruthy()

    // A later step fails: the server removes its marker and answers 500.
    await act(async () => {
      finishSweeps()
    })
    expect(await screen.findByText(en('errors.deleteAccountFailed'))).toBeTruthy()
    expect(screen.getByText('sam@example.com')).toBeTruthy()
    expect(screen.queryByText(en('settings.accountDeletedNotice'))).toBeNull()
    expect(cognito.signOut).not.toHaveBeenCalled()
    expect(button('settings.deleteForever').disabled).toBe(false)

    // Nothing refuses the account now: the next pull is served, and the device stays signed in.
    let pull: Awaited<ReturnType<typeof performInitialSync>> | undefined
    await act(async () => {
      pull = await performInitialSync({ uploadLocalOnly: false })
    })
    expect(pull).toMatchObject({ listFailed: false, accountDeleted: false })
    expect(cognito.signOut).not.toHaveBeenCalled()
    expect(getSession(ID)).toBeDefined()

    // The retry the error asks for deletes the account, and then the device is cleared.
    meDeleteSweeps = null
    meDeleteEnds = 'ok'
    fireEvent.click(button('settings.deleteForever'))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(log).toEqual(['/me/delete', '/sessions/list', '/sessions/list', '/me/delete'])
    expect(cognito.signOut).toHaveBeenCalledTimes(1)
    expect(loadSessions()).toEqual([])
  })

  it.each([
    ['the connection drops', 'lost'],
    ['API Gateway gives up (503)', 'gateway'],
  ] as const)(
    'its answer is lost (%s) after it deleted everything: the next pull signs the device out like any other, sends nothing more and keeps every record and photo',
    async (_how, lost) => {
      const photo = await storePhoto(ID, { old: true })
      saveSession(record({ photos: [photo] }))
      const { onDeleted } = await openAccount()
      const runner = createSyncRunner(performInitialSync)
      const pulls: Promise<unknown>[] = []
      const uninstall = installSyncOnReturn(runner, (run) => {
        pulls.push(run.catch(() => {}))
      })
      meDeleteEnds = lost
      let laterPhoto!: PhotoRef
      try {
        fireEvent.click(button('settings.deleteForever'))
        // The server deleted everything and kept its marker, unheard: the
        // error says the records on this device are still here, and asks the
        // driver to check the connection and try again.
        expect(await screen.findByText(en('errors.deleteAccountFailed'))).toBeTruthy()
        expect(cognito.signOut).not.toHaveBeenCalled()
        // Trusting that, the driver saves another record, with a photo.
        laterPhoto = await storePhoto(LATER)
        saveSession(record({ id: LATER, photos: [laterPhoto] }))

        // The connection is back: the pull is refused, as on any device
        // still signed in to the account.
        await act(async () => {
          window.dispatchEvent(new Event('online'))
        })
        await waitFor(() => expect(pulls).toHaveLength(1))
        await act(async () => {
          await Promise.all(pulls)
        })
      } finally {
        uninstall()
      }
      // Signed out, and Account says the account was deleted, without saying where.
      expect(await screen.findByText(en('settings.accountDeletedNotice'))).toBeTruthy()
      expect(cognito.signOut).toHaveBeenCalledTimes(1)
      // Delete forever asked once, and nothing asked again.
      expect(log).toEqual(['/me/delete', '/sessions/list'])
      // Nothing was cleared: the record from before and the one saved since
      // are both here, and so are their photos.
      expect(loadSessions().map((s) => s.id).sort()).toEqual([ID, LATER].sort())
      expect(await getPhotoBytes(ID, photo.sha256)).not.toBeNull()
      expect(await getPhotoBytes(LATER, laterPhoto.sha256)).not.toBeNull()
      expect(onDeleted).not.toHaveBeenCalled()
    },
  )

  it('when it answers, it clears the device, and a refusal that reaches this tab afterwards never says the records are still here', async () => {
    saveSession(record())
    const { onDeleted } = await openAccount()
    fireEvent.click(button('settings.deleteForever'))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(loadSessions()).toEqual([])
    expect(await screen.findByText(en('settings.youSignedOut'))).toBeTruthy()

    // A call that went out as the delete ended, after its window here closed
    // and before the sign-out, is refused only now.
    await act(async () => {
      window.dispatchEvent(new CustomEvent(ACCOUNT_DELETED_EVENT, { detail: { path: '/sessions/list', account: 'user-1' } }))
    })
    expect(screen.getByText(en('settings.youSignedOut'))).toBeTruthy()
    expect(screen.queryByText(en('settings.accountDeletedNotice'))).toBeNull()
  })
})

/** What the screens see of the auth state, the notice's close button, and a re-read of who is signed in. */
function Who() {
  const { user, loading, accountDeletedNotice, dismissAccountDeletedNotice, refresh } = useAuth()
  if (loading) return <p>Checking</p>
  return (
    <div>
      <p>{user ? `Signed in as ${user.email}` : 'Signed out'}</p>
      {accountDeletedNotice && <button onClick={dismissAccountDeletedNotice}>Close the notice</button>}
      <button onClick={() => void refresh()}>Refresh</button>
    </div>
  )
}

describe('another device, while the marker stands', () => {
  beforeEach(() => {
    // Delete forever is running, or has run, on the first device.
    marker = true
  })

  it('its first refused call signs it out, Account says the account was deleted, and its records stay', async () => {
    saveSession(record())
    render(
      <AuthProvider>
        <AuthSettings onBack={vi.fn()} onOpenPrivacy={vi.fn()} onDeleted={vi.fn()} />
      </AuthProvider>,
    )
    await screen.findByText('sam@example.com')
    const runner = createSyncRunner(performInitialSync)
    let result: Awaited<ReturnType<typeof performInitialSync>> | undefined
    await act(async () => {
      result = await runner.now()
    })
    expect(result).toMatchObject({ listFailed: true, accountDeleted: true, uploaded: 0 })
    expect(await screen.findByText(en('settings.accountDeletedNotice'))).toBeTruthy()
    expect(screen.queryByText('sam@example.com')).toBeNull()
    expect(cognito.signOut).toHaveBeenCalledTimes(1)
    // The listing was refused, and nothing was sent after it.
    expect(log).toEqual(['/sessions/list'])
    expect(loadSessions().map((s) => s.id)).toEqual([ID])
  })

  it('its upload: the row goes out after its last photo landed, with the token it started with, though the device was signed out', async () => {
    saveSession(record({ sign_photo: PHOTO, car_photo: PHOTO }))
    // The sign photo was presigned before the marker went in; the car
    // photo's presign comes after it, is refused, and signs the device out.
    presign = (body) =>
      body.role === 'sign' ? json(200, { url: 'https://s3.test/put/sign', key: `user-1/${ID}/sign.jpg`, bucket: 'b' }) : refused()
    render(
      <AuthProvider>
        <Who />
      </AuthProvider>,
    )
    expect(await screen.findByText('Signed in as sam@example.com')).toBeTruthy()

    let upload!: Promise<unknown>
    await act(async () => {
      upload = uploadSession(getSession(ID)!)
      upload.catch(() => {})
      await vi.waitFor(() => {
        expect(log).toContain('PUT sign sent')
        expect(cognito.state.signedIn).toBe(false)
      })
    })
    expect(await screen.findByText('Signed out')).toBeTruthy()
    // The driver closes the notice before the late photo lands.
    fireEvent.click(screen.getByRole('button', { name: 'Close the notice' }))

    held.get('sign')!()
    let error: unknown
    await act(async () => {
      error = await upload.then(
        () => null,
        (e: unknown) => e,
      )
    })
    expect((error as Error).message).toBe('API 410: ERR_ACCOUNT_DELETED')
    // The row came after the late photo, so the server's sweep on refusing it catches that photo.
    expect(log.indexOf('/sessions/upload')).toBeGreaterThan(log.indexOf('PUT sign landed'))
    expect(auths.find((a) => a.route === '/sessions/upload')?.auth).toBe(`Bearer ${TOKEN}`)
    // Signed out, nothing else was asked, and the closed notice stays closed.
    expect(log.filter((l) => l === '/sessions/upload')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Close the notice' })).toBeNull()
    expect(cognito.signOut).toHaveBeenCalledTimes(2)
    expect(loadSessions().map((s) => s.id)).toEqual([ID])
  })

  it("its upload's late refusal, once another account signed in there, signs that account out of nothing and tells it nothing", async () => {
    saveSession(record({ sign_photo: PHOTO, car_photo: PHOTO }))
    presign = (body) =>
      body.role === 'sign' ? json(200, { url: 'https://s3.test/put/sign', key: `user-1/${ID}/sign.jpg`, bucket: 'b' }) : refused()
    render(
      <AuthProvider>
        <Who />
      </AuthProvider>,
    )
    expect(await screen.findByText('Signed in as sam@example.com')).toBeTruthy()

    let upload!: Promise<unknown>
    await act(async () => {
      upload = uploadSession(getSession(ID)!)
      upload.catch(() => {})
      await vi.waitFor(() => {
        expect(log).toContain('PUT sign sent')
        expect(cognito.state.signedIn).toBe(false)
      })
    })
    expect(await screen.findByText('Signed out')).toBeTruthy()

    // The driver signs in to another account, with email and password: no
    // reload, so the upload is still running.
    cognito.state.who = 'user-2'
    cognito.state.signedIn = true
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Signed in as kim@example.com')).toBeTruthy()

    // The late photo lands, and the row goes to the account the upload
    // started with, which refuses it.
    held.get('sign')!()
    let error: unknown
    await act(async () => {
      error = await upload.then(
        () => null,
        (e: unknown) => e,
      )
    })
    expect((error as Error).message).toBe('API 410: ERR_ACCOUNT_DELETED')
    expect(auths.find((a) => a.route === '/sessions/upload')?.auth).toBe(`Bearer ${TOKEN}`)
    // The account signed in now stays signed in, and is told nothing.
    expect(screen.getByText('Signed in as kim@example.com')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Close the notice' })).toBeNull()
    expect(cognito.signOut).toHaveBeenCalledTimes(1)
  })
})

// An upload sends each call with the current id token while it is still the
// same account's (Cognito refreshes it when it runs out mid-upload, and
// API Gateway refuses an expired one), and with the token it started with
// otherwise: signed out meanwhile (above), or signed in to another account.
describe("an upload's token", () => {
  it('a token refreshed mid-upload: the row goes out with the fresh one', async () => {
    saveSession(record({ sign_photo: PHOTO }))
    presign = () => json(200, { url: 'https://s3.test/put/sign', key: `user-1/${ID}/sign.jpg`, bucket: 'b' })
    const fresh = fakeIdToken('user-1', { exp: 2 })
    expect(fresh).not.toBe(TOKEN)

    const upload = uploadSession(getSession(ID)!)
    await vi.waitFor(() => expect(log).toContain('PUT sign sent'))
    // The token the upload started with runs out while the photo is on its
    // way, and Cognito refreshes it: the same account, a new token.
    cognito.getIdToken.mockImplementation(async () => fresh)
    held.get('sign')!()
    await expect(upload).resolves.toEqual({ photoFailed: false })

    expect(auths.map((a) => [a.route, a.auth])).toEqual([
      ['/photos/presign', `Bearer ${TOKEN}`],
      ['/sessions/upload', `Bearer ${fresh}`],
    ])
  })
})
