// @vitest-environment happy-dom
//
// App.handleEndSession is the ONE end-session path (T0a): whichever screen
// the driver taps "I've left" on, App stamps ended_at, mirrors to the cloud
// when signed in, and cancels both push and in-tab reminders, exactly once.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from './lib/i18n'
import { AuthContext, type AuthContextValue } from './lib/auth-context-shape'
import { getSession, saveSession } from './lib/storage'
import type { PushCancelResult } from './lib/push'
import type { ParkingSession, SignatureBundle } from './types'
import App from './App'

const mocks = vi.hoisted(() => ({
  cancelPushReminders: vi.fn(async (): Promise<PushCancelResult> => ({ ok: true, deleted: 0 })),
  cancelInTabReminders: vi.fn(() => 0),
  mirrorSessionUpdateToCloud: vi.fn(),
  mirrorSessionToCloud: vi.fn(async () => ({ photoFailed: false })),
  performInitialSync: vi.fn(async () => ({ uploaded: 0, pulled: 0, alreadyInSync: 0, listFailed: false })),
}))

vi.mock('./lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/push')>()),
  cancelPushReminders: mocks.cancelPushReminders,
}))
vi.mock('./lib/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/notifications')>()),
  cancelInTabReminders: mocks.cancelInTabReminders,
}))
vi.mock('./lib/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/sync')>()),
  mirrorSessionUpdateToCloud: mocks.mirrorSessionUpdateToCloud,
  mirrorSessionToCloud: mocks.mirrorSessionToCloud,
  performInitialSync: mocks.performInitialSync,
}))
// No network on mount: the signing sweep and the OAuth callback are inert.
vi.mock('./lib/signing', () => ({
  retryUnsignedSessions: vi.fn(),
  signSession: vi.fn(async () => null),
}))
vi.mock('./lib/federated-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/federated-auth')>()),
  handleCallback: vi.fn(async () => false),
}))
vi.mock('./lib/pdf', () => ({
  materializeRemotePhotos: async (s: ParkingSession) => s,
  downloadPdf: () => {},
}))
vi.mock('./lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))

function auth(signedIn: boolean): AuthContextValue {
  return {
    user: signedIn ? ({ userId: 'user-1', email: 'driver@example.com' } as AuthContextValue['user']) : null,
    loading: false,
    configured: signedIn,
    refresh: async () => {},
    signOut: () => {},
  }
}

const SIGNATURE: SignatureBundle = {
  schema: 'parkproof-evidence-v1',
  signed_at: '2026-05-21T08:00:03.000Z',
  algorithm: 'ECDSA_SHA_256',
  key_alias: 'alias/parkproof-evidence-signing',
  canonical_payload: '{}',
  signature_base64: 'MEUCIQDexample',
}

function makeSession(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne VIC' },
    sign_photo: 'data:image/jpeg;base64,SIGN',
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    confidence: 'high',
    signature: SIGNATURE,
    ...overrides,
  }
}

function renderApp(signedIn = false) {
  return render(
    <AuthContext.Provider value={auth(signedIn)}>
      <App />
    </AuthContext.Provider>,
  )
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/app/')
  Object.defineProperty(window, 'confirm', { value: vi.fn(() => true), configurable: true, writable: true })
  for (const m of Object.values(mocks)) m.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('App.handleEndSession — one end path', () => {
  it('from the home card: stamps ended_at and cancels push + in-tab reminders once', () => {
    saveSession(makeSession())
    renderApp(false)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))

    expect(getSession('rec-1')?.ended_at).toEqual(expect.any(String))
    expect(mocks.cancelPushReminders).toHaveBeenCalledTimes(1)
    expect(mocks.cancelPushReminders).toHaveBeenCalledWith('rec-1')
    expect(mocks.cancelInTabReminders).toHaveBeenCalledTimes(1)
    expect(mocks.cancelInTabReminders).toHaveBeenCalledWith('rec-1')
    // Signed out: no cloud mirror.
    expect(mocks.mirrorSessionUpdateToCloud).not.toHaveBeenCalled()
    // The card leaves home straight away (records-changed re-derive).
    expect(screen.queryByRole('button', { name: i18n.t('active.iveLeftAria') })).toBeNull()
  })

  it('from the home card of an EXPIRED record that was never ended', () => {
    saveSession(makeSession({ expires_at: new Date(Date.now() - 30 * 60_000).toISOString() }))
    renderApp(false)

    expect(screen.getByText(/^Expired at /)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))

    expect(getSession('rec-1')?.ended_at).toEqual(expect.any(String))
    expect(mocks.cancelPushReminders).toHaveBeenCalledTimes(1)
  })

  it('mirrors the end to the cloud when signed in', () => {
    saveSession(makeSession())
    renderApp(true)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))
    expect(mocks.mirrorSessionUpdateToCloud).toHaveBeenCalledTimes(1)
    expect(mocks.mirrorSessionUpdateToCloud).toHaveBeenCalledWith('rec-1')
  })

  it('from the record screen: the same path runs once and the screen shows "Ended"', () => {
    saveSession(makeSession())
    // Open the record directly (notification deep link).
    window.history.replaceState({}, '', '/app/?session=rec-1')
    renderApp(false)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('session.endSession') }))

    expect(getSession('rec-1')?.ended_at).toEqual(expect.any(String))
    expect(mocks.cancelPushReminders).toHaveBeenCalledTimes(1)
    expect(mocks.cancelInTabReminders).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/^Ended /)).toBeTruthy()
    expect(screen.queryByRole('button', { name: i18n.t('session.endSession') })).toBeNull()
  })

  it('keeps the first tap time: ending an already-ended record changes nothing', () => {
    // Two copies of the home card can't both be tapped, but a stale view
    // (record ended in another tab) can still ask. Simulate that.
    const firstTap = '2026-05-21T09:00:00.000Z'
    saveSession(makeSession())
    window.history.replaceState({}, '', '/app/?session=rec-1')
    renderApp(false)
    // Another tab ends the record without this screen re-rendering first.
    const raw = JSON.parse(localStorage.getItem('parkproof.sessions.v1')!) as ParkingSession[]
    raw[0].ended_at = firstTap
    localStorage.setItem('parkproof.sessions.v1', JSON.stringify(raw))

    fireEvent.click(screen.getByRole('button', { name: i18n.t('session.endSession') }))

    expect(getSession('rec-1')?.ended_at).toBe(firstTap)
    expect(mocks.cancelPushReminders).not.toHaveBeenCalled()
  })

  it('clears the cached reminder list once the push cancel succeeded', async () => {
    const fireAt = new Date(Date.now() + 50 * 60_000).toISOString()
    mocks.cancelPushReminders.mockResolvedValueOnce({ ok: true, deleted: 1 })
    saveSession(makeSession({ push_reminders: [{ fire_at: fireAt }] }))
    renderApp(true)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))

    await waitFor(() => expect(getSession('rec-1')?.push_reminders).toEqual([]))
    // Mirrored twice: the end, then the cleared list.
    expect(mocks.mirrorSessionUpdateToCloud).toHaveBeenCalledTimes(2)
  })

  it('keeps the reminder list when another device owns the schedules (they may still fire)', async () => {
    const fireAt = new Date(Date.now() + 50 * 60_000).toISOString()
    mocks.cancelPushReminders.mockResolvedValueOnce({ ok: false, reason: 'not_owner' })
    saveSession(makeSession({ push_reminders: [{ fire_at: fireAt }] }))
    renderApp(false)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))
    await waitFor(() => expect(mocks.cancelPushReminders).toHaveBeenCalledTimes(1))
    // Let the cancel's .then() run before asserting nothing was cleared.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getSession('rec-1')?.ended_at).toEqual(expect.any(String))
    expect(getSession('rec-1')?.push_reminders).toEqual([{ fire_at: fireAt }])
  })
})

describe('Home card order', () => {
  it('a live countdown is the main card; an expired, un-ended record waits behind "+1 more"', () => {
    saveSession(
      makeSession({
        id: 'stale',
        arrived_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
        expires_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
      }),
    )
    saveSession(makeSession({ id: 'live' }))
    renderApp(false)

    expect(screen.queryByText(/^Expired at /)).toBeNull()
    expect(screen.getByText(i18n.t('active.morePill', { count: 1 }))).toBeTruthy()
  })
})
