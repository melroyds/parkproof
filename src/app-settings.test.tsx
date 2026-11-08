// @vitest-environment happy-dom
//
// App wiring for Settings (build spec T4 items 1, 3 and 7):
// - a fresh scan sends the saved permits (type, and the area of a resident
//   or business permit; never expired ones) and the parking state, and
//   leaves out what there is none of;
// - a re-check sends them too, with the record's state;
// - the saved name becomes the draft's driver and the new record's
//   driver_name, which link 1 (arrival_context) signs; a no-sign record gets
//   it too;
// - the signed-in home row opens Settings, Settings opens Account, and
//   Account and the privacy policy come back to where they were opened.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from './lib/i18n'
import { AuthContext, type AuthContextValue } from './lib/auth-context-shape'
import { getSession, saveProfile, saveSession } from './lib/storage'
import { buildArrivalContext } from './lib/evidence-chain'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from './lib/photo-store'
import type { LogDraft, ParkingRules, ParkingSession } from './types'
import App from './App'

const mocks = vi.hoisted(() => ({
  translateSign: vi.fn(async (): Promise<ParkingRules> => {
    throw new Error('set per test')
  }),
  refreshInterpretation: vi.fn(async (): Promise<ParkingRules> => {
    throw new Error('set per test')
  }),
  signNewRecord: vi.fn<(id: string, draft: LogDraft) => void>(),
}))

const { SCAN_URL, SCAN_META, scan } = vi.hoisted(() => ({
  SCAN_URL: 'data:image/jpeg;base64,' + btoa('a-sign'),
  SCAN_META: { captured_at: '2026-11-09T01:00:00.000Z', source: 'camera_input' as const },
  /** Where the fake scanner says the phone is. */
  scan: { coords: { lat: -37.8136, lng: 144.9631 } as { lat: number; lng: number } | null },
}))
/** What the fake logger saves; `driver_name` left out unless a test sets it. */
const logged = vi.hoisted(() => ({ extra: {} as Partial<ParkingSession> }))

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
  signNewRecord: mocks.signNewRecord,
}))
vi.mock('./lib/claude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/claude')>()),
  translateSign: mocks.translateSign,
  refreshInterpretation: mocks.refreshInterpretation,
}))
vi.mock('./lib/federated-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/federated-auth')>()),
  handleCallback: vi.fn(async () => false),
}))
vi.mock('./lib/pdf', () => ({
  materializeRemotePhotos: async (s: ParkingSession) => s,
  pdfPhotoRoles: (s: ParkingSession) => [s.no_sign ? 'ambient' : 'sign', 'car'],
  downloadPdf: () => {},
}))
vi.mock('./lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))
vi.mock('./components/LandingFeatures', () => ({
  default: ({ onScanCta }: { onScanCta: () => void }) => <button onClick={onScanCta}>Fake start scan</button>,
}))
vi.mock('./components/SignScanner', () => ({
  default: (p: {
    onCapture: (dataUrl: string, mediaType: string, coords: { lat: number; lng: number } | null, meta?: unknown) => void
    onNoSignScan: (coords: { lat: number; lng: number } | null, ambient: string | null, meta: unknown) => void
  }) => (
    <>
      <button onClick={() => p.onCapture(SCAN_URL, 'image/jpeg', scan.coords, SCAN_META)}>Fake capture</button>
      <button onClick={() => p.onNoSignScan(scan.coords, null, null)}>Fake no sign</button>
    </>
  ),
}))
vi.mock('./components/ParkingResult', () => ({
  default: (p: { onLogSession: () => void }) => <button onClick={p.onLogSession}>Fake log this park</button>,
}))
vi.mock('./components/SessionLogger', () => ({
  default: (p: { mode?: 'sign' | 'no-sign'; onComplete: (s: ParkingSession) => void }) => (
    <button
      onClick={() =>
        p.onComplete({
          id: p.mode === 'no-sign' ? 'rec-no-sign' : 'rec-new',
          arrived_at: new Date().toISOString(),
          location: { lat: -37.8136, lng: 144.9631, address: '1 Test St' },
          sign_photo: null,
          car_photo: null,
          rules: p.mode === 'no-sign' ? '' : '2P',
          observations: [],
          expires_at: null,
          confidence: p.mode === 'no-sign' ? 'low' : 'high',
          ...(p.mode === 'no-sign' ? { no_sign: true } : {}),
          ...logged.extra,
        })
      }
    >
      Fake save
    </button>
  ),
}))
vi.mock('./components/ReminderOptions', () => ({ default: () => <p>Fake reminders</p> }))

const ANON: AuthContextValue = { user: null, loading: false, configured: false, refresh: async () => {}, signOut: () => {} }
const SIGNED_IN: AuthContextValue = {
  ...ANON,
  configured: true,
  user: { userId: 'u-1', email: 'sam@example.com' } as AuthContextValue['user'],
}

function renderApp(auth: AuthContextValue = ANON) {
  return render(
    <AuthContext.Provider value={auth}>
      <App />
    </AuthContext.Provider>,
  )
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

function answer(overrides: Partial<ParkingRules> = {}): ParkingRules {
  return {
    sign_status: 'readable',
    sign_issues: [],
    rules: '2P',
    observations: [],
    can_park_now: true,
    until: null,
    duration_minutes: 120,
    confidence: 'high',
    requires_ticket: false,
    payment_methods: null,
    requires_disabled_permit: false,
    is_permit_zone: false,
    permit_area: null,
    is_area_sign: false,
    permit_exception: [],
    recurring_restrictions: [],
    next_transition: null,
    clarification: null,
    ...overrides,
  }
}

function savePermitsAndName() {
  saveProfile({
    driver_name: 'Sam Lee',
    permits: [
      { id: 'p1', type: 'resident', state: 'VIC', area: 'Area 25', expires_on: '2099-12-31' },
      { id: 'p2', type: 'accessible', state: 'NSW', area: null, expires_on: null },
      { id: 'p3', type: 'business', state: 'VIC', area: 'B7', expires_on: '2020-01-01' },
    ],
  })
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/app/')
  for (const m of Object.values(mocks)) m.mockReset()
  scan.coords = { lat: -37.8136, lng: 144.9631 }
  logged.extra = {}
  setPhotoBackendForTests(createMemoryPhotoBackend())
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn() }, configurable: true })
})

afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
})

describe('a fresh scan', () => {
  it('sends the usable saved permits and the parking state', async () => {
    savePermitsAndName()
    mocks.translateSign.mockResolvedValueOnce(answer())
    renderApp()
    click('Fake start scan')
    click('Fake capture')
    await screen.findByRole('button', { name: 'Fake log this park' })

    expect(mocks.translateSign).toHaveBeenCalledTimes(1)
    const [, , coords, extras] = mocks.translateSign.mock.calls[0] as unknown as [string, string, unknown, unknown]
    expect(coords).toEqual({ lat: -37.8136, lng: 144.9631 })
    // The expired business permit stays home; the accessible one has no area.
    expect(extras).toEqual({
      user_permits: [{ type: 'resident', area: 'Area 25' }, { type: 'accessible' }],
      parking_state: 'VIC',
    })
  })

  it('leaves out permits and the state when there are none to send', async () => {
    scan.coords = { lat: -35.2809, lng: 149.13 } // Canberra: Sydney time, NSW or ACT
    mocks.translateSign.mockResolvedValueOnce(answer())
    renderApp()
    click('Fake start scan')
    click('Fake capture')
    await screen.findByRole('button', { name: 'Fake log this park' })
    const [, , , extras] = mocks.translateSign.mock.calls[0] as unknown as [string, string, unknown, unknown]
    expect(extras).toEqual({})
  })

  it('gives the new record the saved name as its driver, signed in link 1', async () => {
    savePermitsAndName()
    mocks.translateSign.mockResolvedValueOnce(answer())
    renderApp()
    click('Fake start scan')
    click('Fake capture')
    fireEvent.click(await screen.findByRole('button', { name: 'Fake log this park' }))
    click('Fake save')
    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))

    const [id, draft] = mocks.signNewRecord.mock.calls[0]
    expect(id).toBe('rec-new')
    expect(draft.driver_name).toBe('Sam Lee')
    const saved = getSession('rec-new')!
    expect(saved.driver_name).toBe('Sam Lee')
    expect(buildArrivalContext(saved, draft).driver_name).toBe('Sam Lee')
  })

  it("keeps the logger's own answer when it says who was driving", async () => {
    savePermitsAndName()
    logged.extra = { driver_name: null }
    mocks.translateSign.mockResolvedValueOnce(answer())
    renderApp()
    click('Fake start scan')
    click('Fake capture')
    fireEvent.click(await screen.findByRole('button', { name: 'Fake log this park' }))
    click('Fake save')
    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))
    expect(getSession('rec-new')!.driver_name).toBeNull()
  })

  it('adds no driver when no name is saved', async () => {
    mocks.translateSign.mockResolvedValueOnce(answer())
    renderApp()
    click('Fake start scan')
    click('Fake capture')
    fireEvent.click(await screen.findByRole('button', { name: 'Fake log this park' }))
    click('Fake save')
    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))
    expect(mocks.signNewRecord.mock.calls[0][1].driver_name).toBeNull()
    expect('driver_name' in getSession('rec-new')!).toBe(false)
  })
})

describe('a park logged without a sign', () => {
  it('also takes the saved name', async () => {
    saveProfile({ driver_name: 'Sam Lee', permits: [] })
    renderApp()
    click('Fake start scan')
    click('Fake no sign')
    click('Fake save')
    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))
    expect(mocks.signNewRecord.mock.calls[0][1].driver_name).toBe('Sam Lee')
    expect(getSession('rec-no-sign')!.driver_name).toBe('Sam Lee')
  })
})

describe('a re-check', () => {
  it("sends the saved permits and the record's parking state, and starts a draft with the saved name", async () => {
    savePermitsAndName()
    const sha = await putPhoto('rec-bne', SCAN_URL)
    saveSession({
      id: 'rec-bne',
      arrived_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      location: { lat: -27.4698, lng: 153.0251, address: '1 Queen St' },
      sign_photo: null,
      car_photo: null,
      rules: '2P',
      observations: [],
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      confidence: 'high',
      photos: [{ role: 'sign', sha256: sha, captured_at: SCAN_META.captured_at, source: 'camera_input' }],
    })
    mocks.refreshInterpretation.mockResolvedValueOnce(answer())
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('active.recheckSub') }))
    fireEvent.click(await screen.findByRole('button', { name: 'Fake log this park' }))

    const [, location, extras] = mocks.refreshInterpretation.mock.calls[0] as unknown as [unknown, unknown, unknown]
    expect(location).toMatchObject({ lat: -27.4698, lng: 153.0251 })
    expect(extras).toEqual({
      user_permits: [{ type: 'resident', area: 'Area 25' }, { type: 'accessible' }],
      parking_state: 'QLD',
    })

    click('Fake save')
    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))
    expect(mocks.signNewRecord.mock.calls[0][1].driver_name).toBe('Sam Lee')
  })
})

describe('Settings and Account', () => {
  /** A saved record, so home shows the returning-user layout with the account row. */
  function aSavedRecord() {
    saveSession({
      id: 'old',
      arrived_at: '2026-11-01T01:00:00.000Z',
      location: null,
      sign_photo: null,
      car_photo: null,
      rules: '',
      observations: [],
      expires_at: null,
      confidence: 'low',
      no_sign: true,
      ended_at: '2026-11-01T02:00:00.000Z',
    })
  }

  it('the signed-in row opens Settings, which opens Account, which comes back to Settings', async () => {
    aSavedRecord()
    renderApp(SIGNED_IN)
    fireEvent.click(await screen.findByRole('button', { name: /sam@example\.com/ }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByText('Push notifications on this device')).toBeTruthy()

    click('Open account')
    expect(screen.getByRole('heading', { name: 'Account' })).toBeTruthy()
    expect(screen.queryByText('Push notifications on this device')).toBeNull()

    click(/Back/)
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
  })

  it('the privacy policy opened from Settings comes back to Settings', async () => {
    aSavedRecord()
    renderApp(SIGNED_IN)
    fireEvent.click(await screen.findByRole('button', { name: /sam@example\.com/ }))
    click('Open privacy policy')
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeTruthy()
    click(/Back/)
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
  })

  it('the privacy policy opened from Account comes back to Account', async () => {
    aSavedRecord()
    renderApp(SIGNED_IN)
    fireEvent.click(await screen.findByRole('button', { name: /sam@example\.com/ }))
    click('Open account')
    click('Open privacy policy')
    click(/Back/)
    expect(screen.getByRole('heading', { name: 'Account' })).toBeTruthy()
  })
})
