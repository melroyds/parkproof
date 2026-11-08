// @vitest-environment happy-dom
//
// App wiring for the result screen's permits and the home layout (build
// spec T4 items 4, 6 and 9):
// - a scan with a saved resident permit in a permit zone: the driver says
//   the permit is for this car, logs the park, and the saved record has the
//   gate answers, the permit context and a permit salt, while link 1 is
//   given only the commitment sha256(salt + canonicalize(permit_context));
// - the home screen: History and Settings as glass rows (the weekly
//   reminders row, the workday link and the fine link wait for their
//   branches), Settings open without an account, and the returning-user
//   3-step list gone.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalize } from '../lambda/addendum-schema.js'
import i18n from './lib/i18n'
import { AuthContext, type AuthContextValue } from './lib/auth-context-shape'
import { getSession, saveProfile, saveSession } from './lib/storage'
import { buildArrivalContext } from './lib/evidence-chain'
import { sha256HexUtf8 } from './lib/hash'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from './lib/photo-store'
import type { LogDraft, ParkingRules, ParkingSession } from './types'
import App from './App'

const mocks = vi.hoisted(() => ({
  translateSign: vi.fn(async (): Promise<ParkingRules> => {
    throw new Error('set per test')
  }),
  signNewRecord: vi.fn<(id: string, draft: LogDraft, extras?: { permit_commitment?: string | null }) => void>(),
}))

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
}))
vi.mock('./lib/federated-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/federated-auth')>()),
  handleCallback: vi.fn(async () => false),
}))
vi.mock('./lib/feedback', () => ({ submitFeedback: vi.fn() }))
vi.mock('./lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))
vi.mock('./components/LandingFeatures', () => ({
  default: ({ onScanCta }: { onScanCta: () => void }) => <button onClick={onScanCta}>Fake start scan</button>,
}))
vi.mock('./components/SignScanner', () => ({
  default: (p: { onCapture: (dataUrl: string, mediaType: string, coords: { lat: number; lng: number } | null, meta?: unknown) => void }) => (
    <button
      onClick={() =>
        p.onCapture('data:image/jpeg;base64,' + btoa('a-sign'), 'image/jpeg', { lat: -37.8136, lng: 144.9631 }, {
          captured_at: '2026-11-09T01:00:00.000Z',
          source: 'camera_input',
        })
      }
    >
      Fake capture
    </button>
  ),
}))
vi.mock('./components/SessionLogger', () => ({
  default: (p: { onComplete: (s: ParkingSession) => void }) => (
    <button
      onClick={() =>
        p.onComplete({
          id: 'rec-permit',
          arrived_at: new Date().toISOString(),
          location: { lat: -37.8136, lng: 144.9631, address: '1 Test St' },
          sign_photo: null,
          car_photo: null,
          rules: 'PERMIT ZONE AREA 25',
          observations: [],
          expires_at: null,
          confidence: 'high',
        })
      }
    >
      Fake save
    </button>
  ),
}))
vi.mock('./components/ReminderOptions', () => ({ default: () => <p>Fake reminders</p> }))

const ANON: AuthContextValue = { user: null, loading: false, configured: false, refresh: async () => {}, signOut: () => {} }

function renderApp(auth: AuthContextValue = ANON) {
  return render(
    <AuthContext.Provider value={auth}>
      <App />
    </AuthContext.Provider>,
  )
}

const PERMIT_ZONE: ParkingRules = {
  sign_status: 'readable',
  sign_issues: [],
  rules: 'PERMIT ZONE AREA 25',
  observations: [{ scope: 'Whole sign', items: ['Permit zone', 'Area 25'] }],
  can_park_now: true,
  until: null,
  duration_minutes: null,
  confidence: 'high',
  requires_ticket: false,
  payment_methods: null,
  requires_disabled_permit: false,
  is_permit_zone: true,
  permit_area: '25',
  is_area_sign: false,
  permit_exception: [{ applies: true, permit_type: 'resident', text: 'PERMIT ZONE AREA 25' }],
  recurring_restrictions: [],
  next_transition: null,
  clarification: null,
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/app/')
  for (const m of Object.values(mocks)) m.mockReset()
  setPhotoBackendForTests(createMemoryPhotoBackend())
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn() }, configurable: true })
})

afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
})

describe('a park in a permit zone with a saved resident permit', () => {
  it('saves the permit on the record and gives link 1 only its commitment', async () => {
    saveProfile({ driver_name: null, permits: [{ id: 'p1', type: 'resident', state: 'VIC', area: 'Area 25', expires_on: null }] })
    mocks.translateSign.mockResolvedValueOnce(PERMIT_ZONE)
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Fake start scan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fake capture' }))

    expect(await screen.findByText('Your saved permit for Area 25 matches this zone.')).toBeTruthy()
    const question = screen.getByRole('group', { name: 'Is this permit for this car, and displayed or registered to it?' })
    fireEvent.click(within(question).getByRole('radio', { name: 'Yes' }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('result.logCta') }))
    fireEvent.click(screen.getByRole('button', { name: 'Fake save' }))
    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))

    const saved = getSession('rec-permit')!
    const context = {
      type: 'resident',
      area: 'Area 25',
      holder_present: null,
      sign_exception_applies: true,
      standard_until: null,
      permit_until: null,
      note: null,
    }
    expect(saved.permit_context).toEqual(context)
    expect(saved.permit_salt).toMatch(/^[0-9a-f]{64}$/)
    expect(saved.gate_acks).toEqual({ meter_ticket: null, permit_zone: true, accessible_permit: null })

    const [id, draft, extras] = mocks.signNewRecord.mock.calls[0]
    expect(id).toBe('rec-permit')
    expect(draft.permit_context).toEqual(context)
    expect(extras?.permit_commitment).toBe(await sha256HexUtf8(saved.permit_salt + canonicalize(context)))
    const link1 = buildArrivalContext(saved, draft, extras)
    expect(link1.permit_commitment).toBe(extras?.permit_commitment)
    expect(link1.gate_acks).toEqual({ meter_ticket: null, permit_zone: true, accessible_permit: null })
    expect(JSON.stringify(link1)).not.toContain('Area 25')
  })

  it('saves no permit when the driver has none saved', async () => {
    mocks.translateSign.mockResolvedValueOnce(PERMIT_ZONE)
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Fake start scan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fake capture' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: i18n.t('result.permitZone.ackWithArea', { area: '25' }) }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('result.logCta') }))
    fireEvent.click(screen.getByRole('button', { name: 'Fake save' }))
    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))
    const saved = getSession('rec-permit')!
    expect('permit_context' in saved).toBe(false)
    expect('permit_salt' in saved).toBe(false)
    expect(mocks.signNewRecord.mock.calls[0][2]).toEqual({ permit_commitment: null })
  })
})

describe('the home layout', () => {
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

  it('has History, the weekly reminders and Settings as glass rows, and no 3-step list', () => {
    aSavedRecord()
    renderApp()
    const rows = Array.from(screen.getByRole('navigation').querySelectorAll('button'), (b) => b.textContent)
    // The weekly reminders row is T5a's, wired into this layout at the merge.
    expect(rows).toEqual(['History1 saved', 'Street sweeping and weekly remindersNone yet', 'Settings'])
    for (const key of ['home.steps.translate', 'home.steps.log', 'home.steps.remind']) {
      expect(screen.queryByText(i18n.t(key))).toBeNull()
    }
    // The workday link waits for its handler (T6b, behind VITE_FEATURE_WORKDAY).
    expect(screen.queryByText('Parking all day? Start a workday')).toBeNull()
    // The fine link (T8's notice lookup) is wired, and is the way in to an
    // appeal, so the appeal flow's own link gives way to it.
    expect(screen.getByRole('button', { name: 'Got a fine? Start here' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: i18n.t('home.draftAppeal') })).toBeNull()
  })

  it('opens Settings without an account', () => {
    aSavedRecord()
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
  })

  it('labels Settings "Sign in to sync" where sign-in is set up', () => {
    aSavedRecord()
    renderApp({ ...ANON, configured: true })
    expect(screen.getByRole('button', { name: /Settings/ }).textContent).toBe('SettingsSign in to sync')
  })

  it('shows Settings to a first-time visitor too, but not History', () => {
    renderApp()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy()
    expect(screen.queryByText('History')).toBeNull()
  })
})
