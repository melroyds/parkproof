// @vitest-environment happy-dom
//
// "New version available" sits in Home's own flow and on no other screen.
// Fixed to the bottom of every screen, it covered each screen's bottom
// buttons, and its Refresh (a page reload) threw away whatever was on
// screen: a scan result, a record being logged, an appeal draft. On Home a
// reload loses nothing. An update that lands while another screen is open
// waits for Home, and a close outlasts Home's remounts until the next update.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from './lib/i18n'
import { AuthContext, type AuthContextValue } from './lib/auth-context-shape'
import { listenForSwUpdate, resetSwUpdateForTests } from './lib/sw-update'
import type { ParkingSession } from './types'
import App from './App'

vi.mock('./lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/push')>()),
  cancelPushReminders: vi.fn(async () => ({ ok: true, deleted: 0 })),
  getPushPermissionState: () => 'unsupported',
  hasActiveSubscription: async () => false,
}))
vi.mock('./lib/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/sync')>()),
  mirrorSessionUpdateToCloud: vi.fn(),
  mirrorSessionToCloud: vi.fn(async () => ({ photoFailed: false })),
  performInitialSync: vi.fn(async () => ({ uploaded: 0, pulled: 0, alreadyInSync: 0, listFailed: false })),
}))
vi.mock('./lib/signing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/signing')>()),
  runSigningSweep: vi.fn(),
  installSigningTriggers: vi.fn(() => () => {}),
  setSignedRecordListener: vi.fn(),
  signNewRecord: vi.fn(),
}))
vi.mock('./lib/federated-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/federated-auth')>()),
  handleCallback: vi.fn(async () => false),
}))
vi.mock('./lib/pdf', () => ({
  materializeRemotePhotos: async (s: ParkingSession) => s,
  pdfPhotoRoles: () => ['sign', 'car'],
  downloadPdf: () => {},
}))
vi.mock('./lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))
vi.mock('./components/LandingFeatures', () => ({
  default: ({ onScanCta }: { onScanCta: () => void }) => <button onClick={onScanCta}>Fake start scan</button>,
}))
vi.mock('./components/SignScanner', () => ({
  default: () => <p>Fake scanner</p>,
}))

const ANON: AuthContextValue = { user: null, loading: false, configured: false, refresh: async () => {}, signOut: () => {} }

/** A saved, ended record: Home is the returning driver's, with the History row. */
const SAVED_RECORD: ParkingSession = {
  id: 'rec-1',
  arrived_at: '2026-11-14T08:00:00.000Z',
  ended_at: '2026-11-14T09:30:00.000Z',
  location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne VIC' },
  sign_photo: null,
  car_photo: null,
  rules: '2P Mon-Fri 8am-6pm',
  observations: [],
  expires_at: '2026-11-14T10:00:00.000Z',
  confidence: 'high',
}

type FakeWorker = EventTarget & { state: ServiceWorkerState }

/**
 * navigator.serviceWorker with an earlier version running this page.
 * deploy() is a new version arriving: the browser finds it and installs it.
 */
function fakeServiceWorker() {
  const registration = Object.assign(new EventTarget(), {
    installing: null as FakeWorker | null,
    waiting: null as FakeWorker | null,
  })
  const container = { controller: {} as object | null, ready: Promise.resolve(registration) }
  const deploy = () => {
    const worker: FakeWorker = Object.assign(new EventTarget(), { state: 'installing' as ServiceWorkerState })
    registration.installing = worker
    registration.dispatchEvent(new Event('updatefound'))
    registration.installing = null
    registration.waiting = worker
    worker.state = 'installed'
    worker.dispatchEvent(new Event('statechange'))
  }
  return { container, deploy }
}

function renderApp() {
  return render(
    <AuthContext.Provider value={ANON}>
      <App />
    </AuthContext.Provider>,
  )
}

const available = () => i18n.t('swUpdate.available')

/** A new version arrives while the app is open. */
function deploy() {
  act(() => {
    sw.deploy()
  })
}

/** Home's Settings row, then Settings' back button. */
function visitSettings(check: () => void) {
  fireEvent.click(screen.getByText(i18n.t('home.settings')))
  expect(screen.getByRole('heading', { name: i18n.t('prefs.header') })).toBeTruthy()
  check()
  fireEvent.click(screen.getByRole('button', { name: i18n.t('common.back') }))
}

/** Home's History row, then History's back button. */
function visitHistory(check: () => void) {
  fireEvent.click(screen.getByText(i18n.t('home.history')))
  expect(screen.getByRole('heading', { name: i18n.t('history.header') })).toBeTruthy()
  check()
  fireEvent.click(screen.getByRole('button', { name: i18n.t('common.backToHome') }))
}

const notShown = () => expect(screen.queryByText(available())).toBeNull()

let sw: ReturnType<typeof fakeServiceWorker>
let stop: () => void

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('parkproof.sessions.v1', JSON.stringify([SAVED_RECORD]))
  resetSwUpdateForTests()
  sw = fakeServiceWorker()
  stop = listenForSwUpdate(sw.container)
  // Let ready settle, so the listener is on the registration.
  await new Promise((resolve) => setTimeout(resolve, 0))
})

afterEach(() => {
  cleanup()
  stop()
  resetSwUpdateForTests()
  vi.restoreAllMocks()
})

describe('the new version card', () => {
  it('is on Home, in its flow, and on no other screen (Settings, History)', () => {
    renderApp()
    expect(screen.getByRole('button', { name: i18n.t('home.scanCta') })).toBeTruthy()
    notShown()

    deploy()
    const card = screen.getByText(available())
    expect(card.closest('.fixed')).toBeNull()
    expect(screen.getByRole('button', { name: i18n.t('swUpdate.refresh') })).toBeTruthy()

    visitSettings(notShown)
    expect(screen.getByText(available())).toBeTruthy()
    visitHistory(notShown)
    expect(screen.getByText(available())).toBeTruthy()
  })

  it('an update that lands while another screen is open waits for Home', () => {
    renderApp()
    visitSettings(() => {
      deploy()
      notShown()
    })
    expect(screen.getByText(available())).toBeTruthy()
  })

  it('Refresh reloads the page, which loads the new version', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    renderApp()
    deploy()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('swUpdate.refresh') }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('closing it keeps it closed when Home comes back, until the next update', () => {
    renderApp()
    deploy()
    const card = screen.getByText(available()).parentElement!
    fireEvent.click(within(card).getByRole('button', { name: i18n.t('common.close') }))
    notShown()

    visitSettings(notShown)
    notShown()

    deploy()
    expect(screen.getByText(available())).toBeTruthy()
  })
})
