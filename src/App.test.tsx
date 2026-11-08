// @vitest-environment happy-dom
//
// App.handleEndSession is the ONE end-session path (T0a): whichever screen
// the driver taps "I've left" on, App stamps ended_at, mirrors to the cloud
// when signed in, and cancels both push and in-tab reminders, exactly once.
// Since T1a the tap opens App's departure sheet first: its GPS fix starts at
// once, "Confirm I've left" ends the record and closes the sheet, and the
// departure (location, distance) is saved and queued for signing after.
//
// Also the save path (T0b1): the LogDraft made for a scan travels through
// clarify, result and logging (and a logging cancel) to the save, the
// record is prepared (chain key, v1_hashes) before it is stored, and the
// same draft reaches signNewRecord after the save.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from './lib/i18n'
import { AuthContext, type AuthContextValue } from './lib/auth-context-shape'
import { appendAddendum, getSession, saveSession, setArrivalSignature } from './lib/storage'
import { ORPHAN_PHOTO_AGE_MS, createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from './lib/photo-store'
import { endedStatusTime } from './lib/record-status'
import { SYNC_ON_RETURN_INTERVAL_MS } from './lib/sync'
import type { PushCancelResult } from './lib/push'
import type { AddendumKind, LogDraft, ParkingRules, ParkingSession, SignatureBundle, SignedAddendum } from './types'
import App from './App'

const mocks = vi.hoisted(() => ({
  cancelPushReminders: vi.fn(async (): Promise<PushCancelResult> => ({ ok: true, deleted: 0 })),
  cancelInTabReminders: vi.fn(() => 0),
  mirrorSessionUpdateToCloud: vi.fn(),
  mirrorSessionToCloud: vi.fn(async () => ({ photoFailed: false })),
  deleteCloudSession: vi.fn(async () => {}),
  refreshInterpretation: vi.fn(async (): Promise<ParkingRules> => {
    throw new Error('set per test')
  }),
  performInitialSync: vi.fn(async () => ({ uploaded: 0, pulled: 0, alreadyInSync: 0, listFailed: false })),
  runSigningSweep: vi.fn(),
  uninstallSigningTriggers: vi.fn(),
  installSigningTriggers: vi.fn(),
  setSignedRecordListener: vi.fn(),
  signNewRecord: vi.fn<(id: string, draft: LogDraft) => void>(),
  scheduleDepartureCatchUp: vi.fn(),
  // Stores the addendum (real appendAddendum) without starting a signing drain.
  queueAddendum: vi.fn(
    (id: string, kind: AddendumKind, data: unknown, options: { captured_at?: string; id?: string } = {}): SignedAddendum | null => {
      void id
      void kind
      void data
      void options
      return null
    },
  ),
  emptyLogDraft: vi.fn((): LogDraft => {
    throw new Error('replaced in beforeEach')
  }),
  translateSign: vi.fn(async (): Promise<ParkingRules> => {
    throw new Error('set per test')
  }),
}))

/** The bytes of the sign photo the fake scanner "captures". */
const { SIGN_BYTES } = vi.hoisted(() => ({ SIGN_BYTES: 'fake-sign-photo-bytes' }))
/** The props each render of the fake logger received (latest last). */
const { loggerProps } = vi.hoisted(() => ({ loggerProps: [] as Array<Record<string, unknown>> }))

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
  deleteCloudSession: mocks.deleteCloudSession,
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
  queueAddendum: mocks.queueAddendum,
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
  refreshInterpretation: mocks.refreshInterpretation,
}))
// Stand-ins for the scan-to-save screens: each exposes the callbacks App
// passes it as plain buttons.
vi.mock('./components/LandingFeatures', () => ({
  default: ({ onScanCta }: { onScanCta: () => void }) => <button onClick={onScanCta}>Fake start scan</button>,
}))
vi.mock('./components/SignScanner', () => ({
  default: (p: {
    onCapture: (
      dataUrl: string,
      mediaType: string,
      coords: { lat: number; lng: number } | null,
      meta?: { captured_at: string; source: 'camera_input' | 'library' },
    ) => void
    onNoSignScan: (
      coords: { lat: number; lng: number } | null,
      ambientPhoto: string | null,
      ambientMeta: { captured_at: string; source: 'camera_input' | 'library' } | null,
    ) => void
  }) => (
    <div>
      <button onClick={() => p.onCapture('data:image/jpeg;base64,' + btoa(SIGN_BYTES), 'image/jpeg', { lat: -37.81, lng: 144.96 })}>
        Fake capture
      </button>
      <button
        onClick={() =>
          p.onCapture('data:image/jpeg;base64,' + btoa(SIGN_BYTES), 'image/jpeg', null, {
            captured_at: '2026-10-20T00:58:00.000Z',
            source: 'camera_input',
          })
        }
      >
        Fake capture with meta
      </button>
      <button onClick={() => p.onNoSignScan({ lat: -37.81, lng: 144.96 }, null, null)}>Fake no sign</button>
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
    signPhotoMeta?: unknown
    mode?: 'sign' | 'no-sign'
    rules: ParkingRules | null
    signPhoto: string | null
    onComplete: (s: ParkingSession) => void
    onCancel: () => void
  }) => (
    <div ref={() => void loggerProps.push(p as unknown as Record<string, unknown>)}>
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
  // A cloud URL stays on the copy: as if the proxy couldn't fetch it.
  materializeRemotePhotos: async (s: ParkingSession) => s,
  pdfPhotoRoles: (s: ParkingSession) => [s.no_sign ? 'ambient' : 'sign', 'car'],
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
  loggerProps.length = 0
  mocks.installSigningTriggers.mockImplementation(() => mocks.uninstallSigningTriggers)
  mocks.scheduleDepartureCatchUp.mockImplementation(() => () => {})
  mocks.queueAddendum.mockImplementation((id, kind, data, options = {}) => appendAddendum(id, { kind, data, ...options }))
  // By default the phone refuses the location (the departure saves at once without one).
  geo.next = (_ok, fail) => fail({ code: 1 })
  geo.calls = 0
  Object.defineProperty(navigator, 'geolocation', { value: geo.api, configurable: true })
})

afterEach(() => {
  cleanup()
})

/**
 * The fake geolocation. `next` answers each high-accuracy request (the
 * departure fix); the home card's low-accuracy walk-back request is never
 * answered, so the card just shows no distance.
 */
type PositionAnswer = (
  ok: (pos: { coords: { latitude: number; longitude: number; accuracy: number } }) => void,
  fail: (err: { code: number }) => void,
) => void
const geo: {
  next: PositionAnswer
  calls: number
  api: { getCurrentPosition: (ok: never, fail: never, options?: PositionOptions) => void }
} = {
  next: () => {},
  calls: 0,
  api: {
    getCurrentPosition: (ok, fail, options) => {
      if (!options?.enableHighAccuracy) return
      geo.calls++
      geo.next(ok, fail)
    },
  },
}

/** "Confirm I've left" on the departure sheet. */
const confirmLeft = () => fireEvent.click(screen.getByRole('button', { name: i18n.t('departure.confirm') }))

describe('App.handleEndSession — one end path', () => {
  it('from the home card: stamps ended_at and cancels push + in-tab reminders once', () => {
    saveSession(makeSession())
    renderApp(false)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))
    // The departure sheet asks first; nothing is stored yet.
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(getSession('rec-1')?.ended_at).toBeUndefined()
    expect(mocks.cancelPushReminders).not.toHaveBeenCalled()
    confirmLeft()

    expect(getSession('rec-1')?.ended_at).toEqual(expect.any(String))
    // The sheet closes at once.
    expect(screen.queryByRole('dialog')).toBeNull()
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
    // A late tap: the sheet names the phone time that will be recorded.
    expect(screen.getByRole('dialog').textContent).toMatch(/It will record .*won't show when the car actually left/)
    confirmLeft()

    expect(getSession('rec-1')?.ended_at).toEqual(expect.any(String))
    expect(mocks.cancelPushReminders).toHaveBeenCalledTimes(1)
  })

  it('mirrors the end to the cloud when signed in, then the saved departure', async () => {
    saveSession(makeSession())
    renderApp(true)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))
    confirmLeft()
    expect(mocks.mirrorSessionUpdateToCloud).toHaveBeenCalledTimes(1)
    expect(mocks.mirrorSessionUpdateToCloud).toHaveBeenCalledWith('rec-1')
    await waitFor(() => expect(getSession('rec-1')?.departure).toBeDefined())
    expect(mocks.mirrorSessionUpdateToCloud).toHaveBeenCalledTimes(2)
  })

  it('after Confirm the opener is gone: focus goes to the home scan button, not <body>', () => {
    saveSession(makeSession())
    renderApp(false)
    const leave = screen.getByRole('button', { name: i18n.t('active.iveLeftAria') })
    expect(leave.getAttribute('aria-haspopup')).toBe('dialog')
    leave.focus()
    fireEvent.click(leave)
    confirmLeft()
    expect(leave.isConnected).toBe(false)
    expect(document.activeElement?.id).toBe('home-scan')
  })

  it('after Confirm on the record screen, focus goes to its status ("Ended")', () => {
    saveSession(makeSession())
    window.history.replaceState({}, '', '/app/?session=rec-1')
    renderApp(false)
    const leave = screen.getByRole('button', { name: i18n.t('session.endSession') })
    expect(leave.getAttribute('aria-haspopup')).toBe('dialog')
    leave.focus()
    fireEvent.click(leave)
    confirmLeft()
    expect(document.activeElement?.id).toBe('record-status')
    // "Ended" with the tap time (fix list item 6).
    expect(document.activeElement?.textContent).toBe(
      i18n.t('session.endedAt', { when: endedStatusTime(getSession('rec-1')!, 'Australia/Melbourne') }),
    )
  })

  it('Cancel, Escape or a tap outside the sheet records nothing', () => {
    saveSession(makeSession())
    renderApp(false)
    const open = () => fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))

    open()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
    expect(screen.queryByRole('dialog')).toBeNull()
    open()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    open()
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).toBeNull()

    expect(getSession('rec-1')?.ended_at).toBeUndefined()
    expect(getSession('rec-1')?.departure).toBeUndefined()
    expect(mocks.cancelPushReminders).not.toHaveBeenCalled()
    expect(mocks.scheduleDepartureCatchUp).not.toHaveBeenCalled()
    expect(mocks.queueAddendum).not.toHaveBeenCalled()
  })

  it('from the record screen: the same path runs once and the screen shows "Ended"', () => {
    saveSession(makeSession())
    // Open the record directly (notification deep link).
    window.history.replaceState({}, '', '/app/?session=rec-1')
    renderApp(false)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('session.endSession') }))
    expect(getSession('rec-1')?.ended_at).toBeUndefined()
    confirmLeft()

    expect(getSession('rec-1')?.ended_at).toEqual(expect.any(String))
    expect(mocks.cancelPushReminders).toHaveBeenCalledTimes(1)
    expect(mocks.cancelInTabReminders).toHaveBeenCalledTimes(1)
    expect(
      screen.getByText(
        i18n.t('session.endedAt', { when: endedStatusTime(getSession('rec-1')!, 'Australia/Melbourne') }),
      ),
    ).toBeTruthy()
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

    // The record is already ended: no sheet opens, nothing changes.
    fireEvent.click(screen.getByRole('button', { name: i18n.t('session.endSession') }))
    expect(screen.queryByRole('dialog')).toBeNull()

    expect(getSession('rec-1')?.ended_at).toBe(firstTap)
    expect(mocks.cancelPushReminders).not.toHaveBeenCalled()
    expect(mocks.scheduleDepartureCatchUp).not.toHaveBeenCalled()
  })

  it('a record ended in another tab while the sheet is open: Confirm changes nothing', () => {
    const firstTap = '2026-05-21T09:00:00.000Z'
    saveSession(makeSession())
    renderApp(false)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))
    const raw = JSON.parse(localStorage.getItem('parkproof.sessions.v1')!) as ParkingSession[]
    raw[0].ended_at = firstTap
    localStorage.setItem('parkproof.sessions.v1', JSON.stringify(raw))

    confirmLeft()

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getSession('rec-1')?.ended_at).toBe(firstTap)
    expect(mocks.cancelPushReminders).not.toHaveBeenCalled()
    expect(mocks.queueAddendum).not.toHaveBeenCalled()
  })

  it('clears the cached reminder list once the push cancel succeeded', async () => {
    const fireAt = new Date(Date.now() + 50 * 60_000).toISOString()
    mocks.cancelPushReminders.mockResolvedValueOnce({ ok: true, deleted: 1 })
    saveSession(makeSession({ push_reminders: [{ fire_at: fireAt }] }))
    renderApp(true)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))
    confirmLeft()

    await waitFor(() => expect(getSession('rec-1')?.push_reminders).toEqual([]))
    // Mirrored three times: the end, the cleared list and the saved departure.
    await waitFor(() => expect(mocks.mirrorSessionUpdateToCloud).toHaveBeenCalledTimes(3))
  })

  it('keeps the reminder list when another device owns the schedules (they may still fire)', async () => {
    const fireAt = new Date(Date.now() + 50 * 60_000).toISOString()
    mocks.cancelPushReminders.mockResolvedValueOnce({ ok: false, reason: 'not_owner' })
    saveSession(makeSession({ push_reminders: [{ fire_at: fireAt }] }))
    renderApp(false)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))
    confirmLeft()
    await waitFor(() => expect(mocks.cancelPushReminders).toHaveBeenCalledTimes(1))
    // Let the cancel's .then() run before asserting nothing was cleared.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getSession('rec-1')?.ended_at).toEqual(expect.any(String))
    expect(getSession('rec-1')?.push_reminders).toEqual([{ fire_at: fireAt }])
  })
})

describe('App departure flow (T1a)', () => {
  /** Hold the next fix until the test answers it. */
  function holdFix() {
    const held: { answer: Parameters<PositionAnswer>[0] | null } = { answer: null }
    geo.next = (ok) => {
      held.answer = ok
    }
    return held
  }
  const GPS_ARRIVAL = { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps' as const, accuracy_meters: 8 }

  it('the sheet starts one GPS fix when it opens and shows its status line', () => {
    const held = holdFix()
    saveSession(makeSession())
    renderApp(false)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))

    expect(geo.calls).toBe(1)
    expect(screen.getByRole('status').textContent).toBe(i18n.t('departure.locating'))
    act(() => held.answer!({ coords: { latitude: -37.8136, longitude: 144.9631, accuracy: 12 } }))
    expect(screen.getByRole('status').textContent).toBe('Location captured, ±12m')
  })

  it('a refused location reads "No location", and Confirm still ends the record', async () => {
    saveSession(makeSession())
    renderApp(false)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))
    expect(screen.getByRole('status').textContent).toBe(i18n.t('departure.noLocation'))
    confirmLeft()
    const endedAt = getSession('rec-1')?.ended_at
    expect(endedAt).toEqual(expect.any(String))
    await waitFor(() => expect(getSession('rec-1')?.departure).toBeDefined())
    expect(getSession('rec-1')?.departure).toEqual({ ended_at: endedAt, location: null, distance_from_arrival_m: null })
  })

  it('Confirm closes the sheet at once; the departure waits for the fix, then is saved and queued for signing', async () => {
    const held = holdFix()
    saveSession(makeSession({ location: GPS_ARRIVAL }))
    renderApp(false)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))
    confirmLeft()

    expect(screen.queryByRole('dialog')).toBeNull()
    const endedAt = getSession('rec-1')?.ended_at as string
    expect(endedAt).toEqual(expect.any(String))
    // Still waiting for the fix in the background.
    expect(getSession('rec-1')?.departure).toBeUndefined()
    expect(mocks.queueAddendum).not.toHaveBeenCalled()

    // About 200 m north of where the car was logged.
    act(() => held.answer!({ coords: { latitude: -37.8118, longitude: 144.9631, accuracy: 12 } }))
    await waitFor(() => expect(getSession('rec-1')?.departure).toBeDefined())

    const departure = getSession('rec-1')!.departure!
    expect(departure.ended_at).toBe(endedAt)
    expect(departure.location).toEqual({ lat: -37.8118, lng: 144.9631, accuracy_meters: 12, source: 'gps' })
    expect(departure.distance_from_arrival_m).toBeGreaterThan(190)
    expect(departure.distance_from_arrival_m).toBeLessThan(210)
    expect(mocks.queueAddendum).toHaveBeenCalledTimes(1)
    expect(mocks.queueAddendum).toHaveBeenCalledWith('rec-1', 'departure', {
      ended_at: endedAt,
      location: departure.location,
      distance_from_arrival_m: departure.distance_from_arrival_m,
      return_photos: [],
    })
    const stored = getSession('rec-1')!.addenda!.filter((a) => a.kind === 'departure')
    expect(stored).toHaveLength(1)
    expect(stored[0].bundle).toBeUndefined()
    // The catch-up is still scheduled for a tab that closes first.
    expect(mocks.scheduleDepartureCatchUp).toHaveBeenCalledWith('rec-1')
  })

  it('the record screen shows the tap (phone clock), "Not signed yet", and the distance line over 150 m', async () => {
    const held = holdFix()
    saveSession(makeSession({ location: GPS_ARRIVAL }))
    window.history.replaceState({}, '', '/app/?session=rec-1')
    renderApp(false)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('session.endSession') }))
    confirmLeft()
    act(() => held.answer!({ coords: { latitude: -37.8118, longitude: 144.9631, accuracy: 12 } }))

    expect(await screen.findByText(/^Your phone was 2\d\d m from where you parked/)).toBeTruthy()
    expect(screen.getByText(/^You tapped I've left at .* \(phone clock\)\.$/)).toBeTruthy()
    expect(screen.getAllByText(i18n.t('verifier.link.pending')).length).toBeGreaterThan(0)
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

describe('App and the photo store (T0b2)', () => {
  let photos: ReturnType<typeof createMemoryPhotoBackend>
  const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)
  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
  const photoKeys = (id: string) => [...photos.records.keys()].filter((k) => k.startsWith(`${id}/`))
  const RESULT: ParkingRules = {
    rules: '2P',
    observations: [],
    can_park_now: true,
    until: null,
    duration_minutes: 120,
    confidence: 'high',
    clarification: null,
  }

  beforeEach(() => {
    photos = createMemoryPhotoBackend()
    setPhotoBackendForTests(photos)
  })
  afterEach(() => setPhotoBackendForTests(null))

  it('Delete on the record screen runs the one delete path: record, photos, cloud copy, reminders', async () => {
    const sha = await putPhoto('rec-1', jpeg('sign'))
    await putPhoto('other', jpeg('other'))
    saveSession(
      makeSession({
        sign_photo: null,
        photos: [{ role: 'sign', sha256: sha, captured_at: '2026-10-20T00:58:00.000Z', source: 'camera_input' }],
      }),
    )
    window.history.replaceState({}, '', '/app/?session=rec-1')
    renderApp(true)

    click(i18n.t('session.deleteSession'))

    expect(getSession('rec-1')).toBeUndefined()
    await waitFor(() => expect(photoKeys('rec-1')).toEqual([]))
    expect(photoKeys('other')).toHaveLength(1)
    expect(mocks.deleteCloudSession).toHaveBeenCalledWith('rec-1')
    expect(mocks.cancelPushReminders).toHaveBeenCalledWith('rec-1')
    expect(mocks.cancelInTabReminders).toHaveBeenCalledWith('rec-1')
    // Back to History.
    expect(await screen.findByText(i18n.t('history.header'))).toBeTruthy()
  })

  it('signed out, Delete leaves the cloud alone', () => {
    saveSession(makeSession())
    window.history.replaceState({}, '', '/app/?session=rec-1')
    renderApp(false)
    click(i18n.t('session.deleteSession'))
    expect(getSession('rec-1')).toBeUndefined()
    expect(mocks.deleteCloudSession).not.toHaveBeenCalled()
  })

  it('startup GC deletes old photos of records that no longer exist, and nothing else', async () => {
    saveSession(makeSession({ id: 'rec-1' }))
    const old = Date.now() - ORPHAN_PHOTO_AGE_MS - 60_000
    const seeds: Array<[string, number]> = [
      [`rec-1/${'1'.repeat(64)}`, old],
      [`gone/${'2'.repeat(64)}`, old],
      [`logging-now/${'3'.repeat(64)}`, Date.now()],
    ]
    for (const [key, created_at] of seeds) {
      photos.records.set(key, {
        key,
        session_id: key.split('/')[0],
        sha256: key.split('/')[1],
        type: 'image/jpeg',
        bytes: new Uint8Array([1]).buffer,
        created_at,
      })
    }
    renderApp(false)
    await waitFor(() => expect(photos.records.has(`gone/${'2'.repeat(64)}`)).toBe(false))
    expect(photos.records.has(`rec-1/${'1'.repeat(64)}`)).toBe(true)
    expect(photos.records.has(`logging-now/${'3'.repeat(64)}`)).toBe(true)
  })

  it('startup GC is skipped when the saved records cannot be read: unreadable is not "no records"', async () => {
    localStorage.setItem('parkproof.sessions.v1', '{"truncated": [')
    const key = `rec-unreadable/${'4'.repeat(64)}`
    photos.records.set(key, {
      key,
      session_id: 'rec-unreadable',
      sha256: '4'.repeat(64),
      type: 'image/jpeg',
      bytes: new Uint8Array([1]).buffer,
      created_at: Date.now() - ORPHAN_PHOTO_AGE_MS - 60_000,
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderApp(false)
      await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('startup sweep skipped')))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(photos.records.has(key)).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('the scan capture metadata reaches the logger', async () => {
    mocks.translateSign.mockResolvedValueOnce(RESULT)
    renderApp(false)
    click('Fake start scan')
    click('Fake capture with meta')
    fireEvent.click(await screen.findByRole('button', { name: 'Fake log' }))
    await screen.findByRole('button', { name: 'Fake save' })
    expect(loggerProps.at(-1)?.signPhotoMeta).toEqual({ captured_at: '2026-10-20T00:58:00.000Z', source: 'camera_input' })
  })

  it("the scan's draft reaches the logger (for its gates), and the same draft is signed after the save", async () => {
    mocks.translateSign.mockResolvedValueOnce(RESULT)
    renderApp(false)
    click('Fake start scan')
    click('Fake capture with meta')
    fireEvent.click(await screen.findByRole('button', { name: 'Fake log' }))
    await screen.findByRole('button', { name: 'Fake save' })
    const draft = loggerProps.at(-1)?.draft as LogDraft
    expect(draft).toEqual(realEmptyLogDraft())
    click('Fake save')
    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))
    expect(mocks.signNewRecord.mock.calls[0][1]).toBe(draft)
  })

  it('return photos taken on the departure sheet go into the departure part and the record (T2)', async () => {
    saveSession(makeSession())
    const { container } = renderApp(false)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))
    const toggleName = i18n.t('departure.condition.toggle').replace(/[()]/g, '\\$&')
    fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + toggleName) }))
    const input = container.querySelector<HTMLInputElement>('input[data-role="return-front"]')!
    fireEvent.change(input, { target: { files: [new File(['after'], 'after.jpg', { type: 'image/jpeg', lastModified: Date.now() })] } })
    await screen.findByText(i18n.t('photoGrid.saved'))
    confirmLeft()
    expect(getSession('rec-1')!.ended_at).toBeDefined()
    await waitFor(() => expect(getSession('rec-1')!.addenda?.some((a) => a.kind === 'departure')).toBe(true))
    const s = getSession('rec-1')!
    const dep = s.addenda!.find((a) => a.kind === 'departure')!
    const returnPhotos = (dep.data as { return_photos: Array<{ role: string; sha256: string }> }).return_photos
    expect(returnPhotos.map((p) => p.role)).toEqual(['return-front'])
    expect(s.photos).toEqual(returnPhotos)
    expect(photoKeys('rec-1')).toEqual([`rec-1/${returnPhotos[0].sha256}`])
  })

  it('without capture metadata only "library" is claimed for the sign photo', async () => {
    mocks.translateSign.mockResolvedValueOnce(RESULT)
    renderApp(false)
    click('Fake start scan')
    click('Fake capture')
    fireEvent.click(await screen.findByRole('button', { name: 'Fake log' }))
    await screen.findByRole('button', { name: 'Fake save' })
    expect(loggerProps.at(-1)?.signPhotoMeta).toMatchObject({ source: 'library' })
  })

  it('Re-check reads the sign photo through the photo store and keeps its capture metadata', async () => {
    const url = jpeg('stored-sign')
    const sha = await putPhoto('rec-1', url)
    const ref = { role: 'sign' as const, sha256: sha, captured_at: '2026-10-20T00:58:00.000Z', source: 'camera_input' as const }
    saveSession(makeSession({ sign_photo: null, photos: [ref] }))
    mocks.refreshInterpretation.mockResolvedValueOnce({ ...RESULT, rules: 'x' })
    renderApp(false)

    // Offered once the photo has loaded (T0b4: loading can include a cloud fetch).
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('active.recheckSub') }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fake log' }))
    await screen.findByRole('button', { name: 'Fake save' })
    const props = loggerProps.at(-1)!
    expect(props.signPhoto).toBe(url)
    expect(props.signPhotoMeta).toEqual({ captured_at: ref.captured_at, source: 'camera_input' })
  })

  it('Re-check of a record whose sign photo bytes are gone by the tap goes to a fresh scan', async () => {
    const sha = await putPhoto('rec-1', jpeg('soon-gone'))
    saveSession(
      makeSession({
        sign_photo: null,
        photos: [{ role: 'sign', sha256: sha, captured_at: '2026-10-20T00:58:00.000Z', source: 'camera_input' }],
      }),
    )
    renderApp(false)
    const button = await screen.findByRole('button', { name: i18n.t('active.recheckSub') })
    // The bytes go (another tab deleted the record's photos) after the card showed the button.
    photos.records.delete(`rec-1/${sha}`)
    fireEvent.click(button)
    expect(await screen.findByRole('button', { name: 'Fake capture' })).toBeTruthy()
    expect(mocks.refreshInterpretation).not.toHaveBeenCalled()
  })

  it('the home card offers Re-check only once the sign photo has loaded, never while it loads', async () => {
    const sha = await putPhoto('rec-1', jpeg('slow-sign'))
    saveSession(
      makeSession({
        sign_photo: null,
        photos: [{ role: 'sign', sha256: sha, captured_at: '2026-10-20T00:58:00.000Z', source: 'camera_input' }],
      }),
    )
    renderApp(false)
    // First paint: the photo is still loading, so there is no button to tap.
    expect(screen.queryByRole('button', { name: i18n.t('active.recheckSub') })).toBeNull()
    expect(await screen.findByRole('button', { name: i18n.t('active.recheckSub') })).toBeTruthy()
  })

  it("the record screen's cloud-photo warning shows only once an older record's cloud photo failed to load", async () => {
    saveSession(makeSession({ sign_photo: 'https://s3.test/get/user-1/rec-1/sign.jpg' }))
    window.history.replaceState({}, '', '/app/?session=rec-1')
    renderApp(true)
    const img = await screen.findByRole('img', { name: i18n.t('session.signPhotoAlt') })
    // A freshly minted URL normally loads: no warning above a photo that is there.
    expect(screen.queryByText(i18n.t('session.exportPhotoWarning'))).toBeNull()
    fireEvent.error(img)
    expect(await screen.findByText(i18n.t('session.exportPhotoWarning'))).toBeTruthy()
  })

  it('the cloud-photo warning also shows after an export that could not fetch a photo it draws', async () => {
    // The surroundings photo isn't drawn for a sign record, so its URL doesn't count.
    saveSession(makeSession({ ambient_photo: 'https://s3.test/get/user-1/rec-1/ambient.jpg' }))
    window.history.replaceState({}, '', '/app/?session=rec-1')
    renderApp(true)
    click(i18n.t('session.exportAsPdf'))
    await waitFor(() => expect(screen.getByRole('button', { name: i18n.t('session.exportAsPdf') })).toBeTruthy())
    expect(screen.queryByText(i18n.t('session.exportPhotoWarning'))).toBeNull()
    cleanup()

    saveSession({ ...makeSession({ car_photo: 'https://s3.test/get/user-1/rec-1/car.jpg' }), id: 'rec-2' })
    window.history.replaceState({}, '', '/app/?session=rec-2')
    renderApp(true)
    click(i18n.t('session.exportAsPdf'))
    expect(await screen.findByText(i18n.t('session.exportPhotoWarning'))).toBeTruthy()
  })

  it('the home card stops offering Re-check once it knows the sign photo bytes are not on this device', async () => {
    saveSession(
      makeSession({
        sign_photo: null,
        photos: [{ role: 'sign', sha256: '8'.repeat(64), captured_at: '2026-10-20T00:58:00.000Z', source: 'camera_input' }],
      }),
    )
    renderApp(false)
    await waitFor(() => expect(screen.queryByRole('button', { name: i18n.t('active.recheckSub') })).toBeNull())
  })

  it('a double tap on Re-check starts one refresh', async () => {
    saveSession(makeSession())
    mocks.refreshInterpretation.mockResolvedValueOnce({ ...RESULT, rules: 'x' })
    renderApp(false)
    const button = screen.getByRole('button', { name: i18n.t('active.recheckSub') })
    fireEvent.click(button)
    fireEvent.click(button)
    await screen.findByRole('button', { name: 'Fake log' })
    expect(mocks.refreshInterpretation).toHaveBeenCalledTimes(1)
  })

  it('a second save of the same record id moves on like a save: no error screen, the first save stands', async () => {
    saveSession(makeSession({ id: 'new-no-sign', rules: 'first' }))
    const sha = await putPhoto('new-no-sign', jpeg('kept'))
    renderApp(false)
    click(i18n.t('home.scanAnother'))
    click('Fake no sign')
    click('Fake save')
    // On to the saved record's reminders, not stuck on a logger whose Save is disabled.
    expect(await screen.findByText('Fake reminders')).toBeTruthy()
    expect(screen.queryByText(i18n.t('errors.somethingWrong'))).toBeNull()
    expect(getSession('new-no-sign')?.rules).toBe('first')
    expect(mocks.signNewRecord).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(photos.records.has(`new-no-sign/${sha}`)).toBe(true)
  })
})

// Review of the field-test build: before the pull on return there was no
// automatic re-sync, so the banner was always accurate until Retry. Now a
// later pull can reach the cloud by itself, and the banner must go then.
describe("The 'couldn't load your records' banner", () => {
  it('clears once a later pull on return reaches the cloud', async () => {
    const result = { uploaded: 0, pulled: 0, alreadyInSync: 0, merged: 0 }
    mocks.performInitialSync
      .mockResolvedValueOnce({ ...result, listFailed: true })
      .mockResolvedValueOnce({ ...result, listFailed: false })
    renderApp(true)
    expect(await screen.findByText(i18n.t('errors.syncFailed'))).toBeTruthy()

    // The driver comes back to the app more than a minute later.
    const realNow = Date.now.bind(Date)
    const now = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + SYNC_ON_RETURN_INTERVAL_MS + 1_000)
    try {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await waitFor(() => expect(screen.queryByText(i18n.t('errors.syncFailed'))).toBeNull())
      expect(mocks.performInitialSync).toHaveBeenCalledTimes(2)
    } finally {
      now.mockRestore()
    }
  })
})

describe('The one-time backup prompt (T2)', () => {
  it("waits while the record screen's add-photo sheet is open, so one Escape can't also cancel the sheet", async () => {
    saveSession(makeSession({ signature: undefined }))
    window.history.replaceState({}, '', '/app/?session=rec-1')
    renderApp(false)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('evidence.addCondition') }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    // Link 0 is signed in the background while the sheet is open (signal came back).
    act(() => {
      setArrivalSignature('rec-1', {
        ...SIGNATURE,
        schema: 'parkproof-evidence-v1',
        canonical_payload: JSON.stringify({ schema: 'parkproof-evidence-v1', sign_photo_sha256: 'a'.repeat(64) }),
      })
    })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByText(i18n.t('backupPrompt.title'))).toBeNull()
    // Closing the sheet lets the prompt show.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findByText(i18n.t('backupPrompt.title'))).toBeTruthy()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})
