// @vitest-environment happy-dom
//
// The install offers (Android's "Install ParkProof", iPhone Safari's "Add to
// Home Screen" hint) sit in Home's own flow and on no other screen. Fixed to
// the bottom of every screen, they covered its bottom buttons (Translate,
// Done) until closed. The Android offer still works when the browser's
// prompt came before Home was on screen. Home mounts them again on every
// return, so a close has to outlast the mount it happened in.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from './lib/i18n'
import { AuthContext, type AuthContextValue } from './lib/auth-context-shape'
import { listenForInstallOffer, resetInstallOfferForTests } from './lib/install-offer'
import { IOS_INSTALL_HINT_DISMISSED_KEY, resetIosInstallHintForTests } from './components/IosInstallHint'
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
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

function renderApp() {
  return render(
    <AuthContext.Provider value={ANON}>
      <App />
    </AuthContext.Provider>,
  )
}

/** The browser offers the install; the driver will decline its dialog. Returns the event's prompt(). */
function offerAndroidInstall() {
  const prompt = vi.fn(async () => {})
  const event = new Event('beforeinstallprompt', { cancelable: true })
  Object.assign(event, {
    platforms: ['web'],
    prompt,
    userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
  })
  act(() => {
    window.dispatchEvent(event)
  })
  return { prompt }
}

/** Runs `fn` with localStorage refusing writes to `key` (a full quota), and working as usual otherwise. */
function withWritesRefused(key: string, fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
  const real = localStorage
  const refusing = {
    getItem: (k: string) => real.getItem(k),
    setItem: (k: string, v: string) => {
      if (k === key) throw new DOMException('full', 'QuotaExceededError')
      real.setItem(k, v)
    },
    removeItem: (k: string) => real.removeItem(k),
    clear: () => real.clear(),
    key: (i: number) => real.key(i),
    get length() {
      return real.length
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: refusing, configurable: true, writable: true })
  try {
    fn()
  } finally {
    Object.defineProperty(globalThis, 'localStorage', original)
  }
}

/** A saved, ended record: Home is the returning driver's (scan button, menu), not the first-visit page. */
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

let stop: () => void
const realUserAgent = navigator.userAgent

beforeEach(() => {
  localStorage.clear()
  resetInstallOfferForTests()
  resetIosInstallHintForTests()
  stop = listenForInstallOffer(window)
})

afterEach(() => {
  cleanup()
  stop()
  resetInstallOfferForTests()
  resetIosInstallHintForTests()
  Object.defineProperty(navigator, 'userAgent', { value: realUserAgent, configurable: true })
})

describe('the Android install offer', () => {
  it('is on Home, in its flow, and on no other screen', () => {
    renderApp()
    offerAndroidInstall()
    const offer = screen.getByText(i18n.t('installPrompt.available'))
    expect(offer.closest('.fixed')).toBeNull()
    expect(screen.getByRole('button', { name: i18n.t('installPrompt.install') })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Fake start scan' }))
    expect(screen.getByText('Fake scanner')).toBeTruthy()
    expect(screen.queryByText(i18n.t('installPrompt.available'))).toBeNull()
  })

  it('a prompt that came before Home was on screen is still offered there', () => {
    offerAndroidInstall()
    renderApp()
    expect(screen.getByText(i18n.t('installPrompt.available'))).toBeTruthy()
  })

  it('closing it keeps it closed, when Home comes back and the browser offers again', () => {
    renderApp()
    offerAndroidInstall()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.close') }))
    expect(screen.queryByText(i18n.t('installPrompt.available'))).toBeNull()

    cleanup()
    renderApp()
    offerAndroidInstall()
    expect(screen.queryByText(i18n.t('installPrompt.available'))).toBeNull()
  })

  it('on the returning Home, Install opens the browser dialog once, and after a decline the card stays away this visit', async () => {
    localStorage.setItem('parkproof.sessions.v1', JSON.stringify([SAVED_RECORD]))
    renderApp()
    expect(screen.getByRole('button', { name: i18n.t('home.scanCta') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Fake start scan' })).toBeNull()

    const { prompt } = offerAndroidInstall()
    expect(screen.getByText(i18n.t('installPrompt.available'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('installPrompt.install') }))
    await waitFor(() => expect(screen.queryByText(i18n.t('installPrompt.available'))).toBeNull())
    expect(prompt).toHaveBeenCalledTimes(1)

    // The browser can offer again as soon as its dialog closes: not on this visit.
    offerAndroidInstall()
    expect(screen.queryByText(i18n.t('installPrompt.available'))).toBeNull()
  })
})

describe('the iPhone Safari install hint', () => {
  it('is on Home, in its flow, and on no other screen', () => {
    Object.defineProperty(navigator, 'userAgent', { value: IPHONE_SAFARI, configurable: true })
    renderApp()
    const hint = screen.getByText(i18n.t('installPrompt.iosTitle'))
    expect(hint.closest('.fixed')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Fake start scan' }))
    expect(screen.getByText('Fake scanner')).toBeTruthy()
    expect(screen.queryByText(i18n.t('installPrompt.iosTitle'))).toBeNull()
  })

  it("Got it keeps it closed when Home comes back, even when the browser can't store that", () => {
    Object.defineProperty(navigator, 'userAgent', { value: IPHONE_SAFARI, configurable: true })
    withWritesRefused(IOS_INSTALL_HINT_DISMISSED_KEY, () => {
      renderApp()
      fireEvent.click(screen.getByRole('button', { name: i18n.t('installPrompt.iosDismiss') }))
      expect(screen.queryByText(i18n.t('installPrompt.iosTitle'))).toBeNull()

      cleanup()
      renderApp()
      expect(screen.queryByText(i18n.t('installPrompt.iosTitle'))).toBeNull()
    })
  })
})
