// @vitest-environment happy-dom
//
// Share links in App's state machine (build spec T7 items 2 to 4): a
// `#share=` link at startup opens the receive view and is cleared from
// the address bar with replaceState; one opened while the app is already
// open (a fragment change, no reload) does too; a shared copy opens its
// own read-only screen, never the driver's record screen, and Remove
// touches nothing but this device; a shared copy is never the home card;
// the home card's Share icon opens the share sheet.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from './lib/i18n'
import { AuthContext, type AuthContextValue } from './lib/auth-context-shape'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from './lib/photo-store'
import { loadSessions, saveSession } from './lib/storage'
import type { ParkingSession, SignatureBundle } from './types'
import en from './locales/en.json'
import App from './App'

const mocks = vi.hoisted(() => ({
  sharedTokens: [] as string[],
  deleteCloudSession: vi.fn(async () => {}),
  cancelPushReminders: vi.fn(async () => ({ ok: true as const, deleted: 0 })),
  cancelInTabReminders: vi.fn(() => 0),
}))

vi.mock('./lib/signing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/signing')>()),
  runSigningSweep: vi.fn(),
  installSigningTriggers: vi.fn(() => () => {}),
  setSignedRecordListener: vi.fn(),
}))
vi.mock('./lib/federated-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/federated-auth')>()),
  handleCallback: vi.fn(async () => false),
}))
vi.mock('./lib/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/sync')>()),
  deleteCloudSession: mocks.deleteCloudSession,
}))
vi.mock('./lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/push')>()),
  cancelPushReminders: mocks.cancelPushReminders,
}))
vi.mock('./lib/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/notifications')>()),
  cancelInTabReminders: mocks.cancelInTabReminders,
}))
vi.mock('./components/LandingFeatures', () => ({ default: () => <p>Fake landing</p> }))
// The receive view itself is covered in components/share.test.tsx.
vi.mock('./components/SharedLinkView', () => ({
  default: (p: { token: string; onDone: () => void }) => {
    mocks.sharedTokens.push(p.token)
    return (
      <div>
        <p>Fake shared {p.token}</p>
        <button onClick={p.onDone}>Fake shared done</button>
      </div>
    )
  },
}))

// A signed user, so the cloud and push paths would run for an own record.
const AUTH: AuthContextValue = {
  user: { userId: 'u-1', email: 'a@b.test' } as AuthContextValue['user'],
  loading: false,
  configured: true,
  refresh: async () => {},
  signOut: () => {},
}

function renderApp() {
  return render(
    <AuthContext.Provider value={AUTH}>
      <App />
    </AuthContext.Provider>,
  )
}

const BUNDLE: SignatureBundle = {
  schema: 'parkproof-evidence-v2',
  signed_at: '2026-10-25T02:31:05.000Z',
  algorithm: 'ECDSA_SHA_256',
  key_alias: 'alias/parkproof-evidence-signing',
  canonical_payload: JSON.stringify({
    schema: 'parkproof-evidence-v2',
    session_id: 'original-1',
    arrived_at: '2026-10-25T02:31:00.000Z',
    expires_at: null,
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
    rules: '2P',
    signed_at: '2026-10-25T02:31:05.000Z',
  }),
  signature_base64: 'MEU=',
}

function record(over: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'own-1',
    arrived_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: new Date(Date.now() + 90 * 60_000).toISOString(),
    confidence: 'high',
    ...over,
  }
}

const copy = (over: Partial<ParkingSession> = {}) =>
  record({
    id: 'copy-1',
    shared_from: {
      original_session_id: 'original-1',
      received_at: new Date().toISOString(),
      shared_at: new Date().toISOString(),
      arrival_bundle: BUNDLE,
      snapshot: { driver: 'Sam' },
    },
    ...over,
  })

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/app/')
  setPhotoBackendForTests(createMemoryPhotoBackend())
  mocks.sharedTokens.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn() }, configurable: true })
})
afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
})

describe('App: share links', () => {
  it('opens the receive view from #share= at startup and clears it from the address bar', () => {
    window.history.replaceState({}, '', '/app/?privacy=open#share=1.abc_-')
    const replace = vi.spyOn(window.history, 'replaceState')
    renderApp()
    expect(screen.getByText('Fake shared 1.abc_-')).toBeTruthy()
    // The share link won over the query param, and both left the address bar without a navigation.
    expect(replace).toHaveBeenCalled()
    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('')
    expect(window.location.pathname).toBe('/app/')
    fireEvent.click(screen.getByText('Fake shared done'))
    expect(screen.queryByText(/Fake shared/)).toBeNull()
  })

  it('opens a link pasted into a tab where the app is already open', () => {
    renderApp()
    expect(mocks.sharedTokens).toEqual([])
    act(() => {
      window.history.replaceState({}, '', '/app/#share=1.second')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(screen.getByText('Fake shared 1.second')).toBeTruthy()
    expect(window.location.hash).toBe('')
  })

  it('a link that arrives mid-flow waits until the driver is back home, then opens', () => {
    // A returning driver (an ended record), so home has its scan button.
    saveSession(record({ ended_at: new Date().toISOString() }))
    renderApp()
    // Mid-flow: the scan screen (a photo being taken, a reading in flight).
    fireEvent.click(screen.getByRole('button', { name: en.home.scanCta }))
    expect(screen.getByRole('button', { name: en.common.back })).toBeTruthy()
    act(() => {
      window.history.replaceState({}, '', '/app/#share=1.later')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    // The scan screen stays; the link is cleared from the address bar and waits.
    expect(screen.queryByText(/Fake shared/)).toBeNull()
    expect(mocks.sharedTokens).toEqual([])
    expect(screen.getByRole('button', { name: en.common.back })).toBeTruthy()
    expect(window.location.hash).toBe('')
    // Back home: the waiting link opens.
    fireEvent.click(screen.getByRole('button', { name: en.common.back }))
    expect(screen.getByText('Fake shared 1.later')).toBeTruthy()
    // Done goes home, and the link doesn't open again.
    fireEvent.click(screen.getByText('Fake shared done'))
    expect(screen.queryByText(/Fake shared/)).toBeNull()
    expect(mocks.sharedTokens.filter((t) => t === '1.later').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: en.home.scanCta })).toBeTruthy()
  })

  it("opens a shared copy on its own read-only screen, and Remove touches nothing but this device", () => {
    saveSession(copy())
    window.history.replaceState({}, '', '/app/?session=copy-1')
    Object.defineProperty(window, 'confirm', { value: vi.fn(() => true), configurable: true, writable: true })
    renderApp()
    expect(screen.getByRole('heading', { name: en.share.badge })).toBeTruthy()
    // None of the driver's own record actions.
    expect(screen.queryByRole('button', { name: en.session.endSession })).toBeNull()
    expect(screen.queryByRole('button', { name: en.share.action })).toBeNull()
    expect(screen.queryByRole('button', { name: en.session.exportAsPdf })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.share.remove }))
    expect(loadSessions()).toEqual([])
    expect(mocks.deleteCloudSession).not.toHaveBeenCalled()
    expect(mocks.cancelPushReminders).not.toHaveBeenCalled()
    expect(mocks.cancelInTabReminders).not.toHaveBeenCalled()
    // Back in History.
    expect(screen.getByRole('heading', { name: en.history.header })).toBeTruthy()
  })

  it('an own record still deletes from the cloud (the shared-copy shortcut is only for copies)', () => {
    saveSession(record())
    window.history.replaceState({}, '', '/app/?session=own-1')
    Object.defineProperty(window, 'confirm', { value: vi.fn(() => true), configurable: true, writable: true })
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: en.session.deleteSession }))
    expect(mocks.deleteCloudSession).toHaveBeenCalledWith('own-1')
  })

  it('a shared copy is never the home card; an own record is, with a Share icon that opens the sheet', () => {
    saveSession(copy())
    renderApp()
    expect(screen.queryByText(en.active.currentlyParked)).toBeNull()
    cleanup()
    saveSession(record())
    renderApp()
    expect(screen.getByText(en.active.currentlyParked)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.share.action }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain(en.share.confirm)
    fireEvent.click(screen.getByRole('button', { name: en.common.cancel }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
