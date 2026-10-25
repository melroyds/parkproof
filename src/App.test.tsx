// @vitest-environment happy-dom
//
// App.handleEndSession is the ONE end-session path (T0a): whichever screen
// the driver taps "I've left" on, App stamps ended_at, mirrors to the cloud
// when signed in, and cancels both push and in-tab reminders, exactly once.
//
// Also the save path (T0b1): the LogDraft made for a scan travels through
// clarify, result and logging (and a logging cancel) to the save, the
// record is prepared (chain key, v1_hashes) before it is stored, and the
// same draft reaches signNewRecord after the save.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from './lib/i18n'
import { AuthContext, type AuthContextValue } from './lib/auth-context-shape'
import { getSession, saveSession } from './lib/storage'
import type { PushCancelResult } from './lib/push'
import type { LogDraft, ParkingRules, ParkingSession, SignatureBundle } from './types'
import App from './App'

const mocks = vi.hoisted(() => ({
  cancelPushReminders: vi.fn(async (): Promise<PushCancelResult> => ({ ok: true, deleted: 0 })),
  cancelInTabReminders: vi.fn(() => 0),
  mirrorSessionUpdateToCloud: vi.fn(),
  mirrorSessionToCloud: vi.fn(async () => ({ photoFailed: false })),
  performInitialSync: vi.fn(async () => ({ uploaded: 0, pulled: 0, alreadyInSync: 0, listFailed: false })),
  runSigningSweep: vi.fn(),
  uninstallSigningTriggers: vi.fn(),
  installSigningTriggers: vi.fn(),
  setSignedRecordListener: vi.fn(),
  signNewRecord: vi.fn<(id: string, draft: LogDraft) => void>(),
  scheduleDepartureCatchUp: vi.fn(),
  emptyLogDraft: vi.fn((): LogDraft => {
    throw new Error('replaced in beforeEach')
  }),
  translateSign: vi.fn(async (): Promise<ParkingRules> => {
    throw new Error('set per test')
  }),
}))

/** The bytes of the sign photo the fake scanner "captures". */
const { SIGN_BYTES } = vi.hoisted(() => ({ SIGN_BYTES: 'fake-sign-photo-bytes' }))

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
// prepareNewRecord is the real one (chain key + photo hashes, no network).
vi.mock('./lib/signing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/signing')>()),
  runSigningSweep: mocks.runSigningSweep,
  installSigningTriggers: mocks.installSigningTriggers,
  setSignedRecordListener: mocks.setSignedRecordListener,
  signNewRecord: mocks.signNewRecord,
  scheduleDepartureCatchUp: mocks.scheduleDepartureCatchUp,
}))
// emptyLogDraft is the real one behind a spy, so a test can tell which
// draft object reached the save.
vi.mock('./lib/evidence-chain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/evidence-chain')>()),
  emptyLogDraft: mocks.emptyLogDraft,
}))
vi.mock('./lib/claude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/claude')>()),
  translateSign: mocks.translateSign,
}))
// Stand-ins for the scan-to-save screens: each exposes the callbacks App
// passes it as plain buttons.
vi.mock('./components/LandingFeatures', () => ({
  default: ({ onScanCta }: { onScanCta: () => void }) => <button onClick={onScanCta}>Fake start scan</button>,
}))
vi.mock('./components/SignScanner', () => ({
  default: (p: {
    onCapture: (dataUrl: string, mediaType: string, coords: { lat: number; lng: number } | null) => void
    onNoSignScan: (coords: { lat: number; lng: number } | null, ambientPhoto: string | null) => void
  }) => (
    <div>
      <button onClick={() => p.onCapture('data:image/jpeg;base64,' + btoa(SIGN_BYTES), 'image/jpeg', { lat: -37.81, lng: 144.96 })}>
        Fake capture
      </button>
      <button onClick={() => p.onNoSignScan({ lat: -37.81, lng: 144.96 }, null)}>Fake no sign</button>
    </div>
  ),
}))
vi.mock('./components/Clarify', () => ({
  default: (p: { clarification: { options: unknown[] }; onPick: (v: unknown) => void }) => (
    <button onClick={() => p.onPick(p.clarification.options[0])}>Fake pick</button>
  ),
}))
vi.mock('./components/ParkingResult', () => ({
  default: (p: { onLogSession: () => void }) => <button onClick={p.onLogSession}>Fake log</button>,
}))
vi.mock('./components/SessionLogger', () => ({
  default: (p: {
    mode?: 'sign' | 'no-sign'
    rules: ParkingRules | null
    signPhoto: string | null
    onComplete: (s: ParkingSession) => void
    onCancel: () => void
  }) => (
    <div>
      <button
        onClick={() =>
          p.onComplete({
            id: p.mode === 'no-sign' ? 'new-no-sign' : 'new-1',
            arrived_at: new Date().toISOString(),
            location: { lat: -37.81, lng: 144.96, address: '1 Test St' },
            sign_photo: p.signPhoto,
            car_photo: null,
            rules: p.rules?.rules ?? '',
            observations: [],
            expires_at: null,
            confidence: p.rules?.confidence ?? 'low',
            ...(p.mode === 'no-sign' ? { no_sign: true } : {}),
          })
        }
      >
        Fake save
      </button>
      <button onClick={p.onCancel}>Fake cancel logging</button>
    </div>
  ),
}))
vi.mock('./components/ReminderOptions', () => ({
  default: () => <p>Fake reminders</p>,
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

let realEmptyLogDraft: () => LogDraft

beforeAll(async () => {
  await i18n.changeLanguage('en')
  realEmptyLogDraft = (await vi.importActual<typeof import('./lib/evidence-chain')>('./lib/evidence-chain')).emptyLogDraft
  mocks.emptyLogDraft.mockImplementation(() => realEmptyLogDraft())
})

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/app/')
  Object.defineProperty(window, 'confirm', { value: vi.fn(() => true), configurable: true, writable: true })
  for (const m of Object.values(mocks)) m.mockClear()
  mocks.installSigningTriggers.mockImplementation(() => mocks.uninstallSigningTriggers)
  mocks.scheduleDepartureCatchUp.mockImplementation(() => () => {})
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
    // The departure is signed once the grace period has passed.
    expect(mocks.scheduleDepartureCatchUp).toHaveBeenCalledTimes(1)
    expect(mocks.scheduleDepartureCatchUp).toHaveBeenCalledWith('rec-1')
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
    expect(mocks.scheduleDepartureCatchUp).not.toHaveBeenCalled()
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

describe('App and the signing queue', () => {
  it('runs the signing sweep on mount, installs its triggers, and removes them on unmount', () => {
    const { unmount } = renderApp(false)
    expect(mocks.runSigningSweep).toHaveBeenCalledTimes(1)
    expect(mocks.installSigningTriggers).toHaveBeenCalledTimes(1)
    unmount()
    expect(mocks.uninstallSigningTriggers).toHaveBeenCalledTimes(1)
  })

  it('mirrors newly signed records to the cloud only while signed in', () => {
    renderApp(true)
    const listener = mocks.setSignedRecordListener.mock.calls.at(-1)?.[0] as ((id: string) => void) | null
    expect(typeof listener).toBe('function')
    listener!('rec-9')
    expect(mocks.mirrorSessionUpdateToCloud).toHaveBeenCalledWith('rec-9')
    cleanup()

    mocks.setSignedRecordListener.mockClear()
    renderApp(false)
    expect(mocks.setSignedRecordListener).toHaveBeenCalledWith(null)
    expect(mocks.setSignedRecordListener.mock.calls.every((c) => c[0] === null)).toBe(true)
  })
})

describe('App save path: the draft and the prepared record', () => {
  const variant = (label: string) => ({
    label,
    rules: `2P ${label}`,
    observations: [],
    can_park_now: true,
    until: null,
    duration_minutes: 120,
  })
  const RESULT: ParkingRules = {
    rules: '2P left, 1P right',
    observations: [],
    can_park_now: true,
    until: null,
    duration_minutes: 120,
    confidence: 'high',
    clarification: { question: 'Which side?', options: [variant('Left side'), variant('Right side')] },
  }
  const HEX64 = /^[0-9a-f]{64}$/
  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

  /** At the moment signNewRecord runs, the prepared record must already be stored. */
  const storedAtSignTime: Array<ParkingSession | undefined> = []
  beforeEach(() => {
    storedAtSignTime.length = 0
    mocks.signNewRecord.mockImplementation((id: string) => {
      storedAtSignTime.push(getSession(id))
    })
  })

  it('scan, clarify, result, logging (cancel and back), save: one draft all the way to signNewRecord', async () => {
    mocks.translateSign.mockResolvedValueOnce(RESULT)
    renderApp(false)
    click('Fake start scan')
    click('Fake capture')
    // handleCapture makes the scan's draft once.
    await screen.findByRole('button', { name: 'Fake pick' })
    expect(mocks.emptyLogDraft).toHaveBeenCalledTimes(1)
    const scanDraft = mocks.emptyLogDraft.mock.results[0].value as LogDraft

    click('Fake pick') // clarify -> result
    click('Fake log') // result -> logging
    click('Fake cancel logging') // logging -> result
    click('Fake log') // result -> logging again
    click('Fake save')

    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))
    const [id, draft] = mocks.signNewRecord.mock.calls[0]
    expect(id).toBe('new-1')
    // The very draft made for this scan, still empty.
    expect(draft).toBe(scanDraft)
    expect(draft).toEqual(realEmptyLogDraft())
    expect(mocks.emptyLogDraft).toHaveBeenCalledTimes(1)

    // Prepared before it was stored: chain key and link-0 photo hashes.
    const stored = storedAtSignTime[0]
    expect(stored?.chain_key).toMatch(HEX64)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SIGN_BYTES)))
    const signHash = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
    expect(stored?.v1_hashes).toEqual({ sign: signHash, car: null, ambient: null })
    // The picked side reached the logger.
    expect(stored?.rules).toBe('2P Left side')
    expect(getSession('new-1')?.chain_key).toBe(stored?.chain_key)
    await screen.findByText('Fake reminders')
  })

  it('the no-sign path saves a prepared record with an empty draft', async () => {
    renderApp(false)
    click('Fake start scan')
    click('Fake no sign')
    click('Fake save')

    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))
    const [id, draft] = mocks.signNewRecord.mock.calls[0]
    expect(id).toBe('new-no-sign')
    expect(draft).toEqual(realEmptyLogDraft())
    const stored = storedAtSignTime[0]
    expect(stored?.no_sign).toBe(true)
    expect(stored?.chain_key).toMatch(HEX64)
    expect(stored?.v1_hashes).toEqual({ sign: null, car: null, ambient: null })
  })
})
