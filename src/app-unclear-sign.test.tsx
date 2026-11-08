// @vitest-environment happy-dom
//
// App routing for unclear signs (build spec T3 item 6):
// - 'missing' and 'not_a_parking_sign' never reach the answer card: App
//   shows the "no readable sign" screen, with "Retake photo" (back to the
//   scanner) and "Log without a sign" (the no-sign logger, keeping the scan
//   photo, with its capture metadata, as the surroundings photo, and the
//   status ParkProof found; cancelling it comes back to the screen);
// - 'partially_obscured' and 'contradictory' go to the answer as before;
// - a re-check echoes the record's reading and keeps it on the result.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from './lib/i18n'
import { AuthContext, type AuthContextValue } from './lib/auth-context-shape'
import { getSession, saveSession } from './lib/storage'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from './lib/photo-store'
import type { LogDraft, ParkingRules, ParkingSession, RecurringRestriction } from './types'
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

/** The bytes of the photo the fake scanner "captures", and its capture metadata. */
const { SCAN_URL, SCAN_META } = vi.hoisted(() => ({
  SCAN_URL: 'data:image/jpeg;base64,' + btoa('photo-with-no-readable-sign'),
  SCAN_META: { captured_at: '2026-11-02T21:59:00.000Z', source: 'camera_input' as const },
}))
/** Props each render of the fake logger and fake result screen received (latest last). */
const { loggerProps, resultProps } = vi.hoisted(() => ({
  loggerProps: [] as Array<Record<string, unknown>>,
  resultProps: [] as Array<{ result: ParkingRules }>,
}))

vi.mock('./lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/push')>()),
  cancelPushReminders: vi.fn(async () => ({ ok: true, deleted: 0 })),
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
    onCapture: (
      dataUrl: string,
      mediaType: string,
      coords: { lat: number; lng: number } | null,
      meta?: { captured_at: string; source: 'camera_input' | 'library' },
    ) => void
  }) => (
    <button onClick={() => p.onCapture(SCAN_URL, 'image/jpeg', { lat: -37.81, lng: 144.96 }, SCAN_META)}>Fake capture</button>
  ),
}))
vi.mock('./components/ParkingResult', () => ({
  default: (p: { result: ParkingRules }) => (
    <p ref={() => void resultProps.push(p)}>Fake result</p>
  ),
}))
vi.mock('./components/SessionLogger', () => ({
  default: (p: {
    mode?: 'sign' | 'no-sign'
    noSignReading?: { sign_status: ParkingSession['sign_status']; sign_issues: string[] } | null
    onComplete: (s: ParkingSession) => void
    onCancel: () => void
  }) => (
    <div ref={() => void loggerProps.push(p as unknown as Record<string, unknown>)}>
      <button
        onClick={() =>
          p.onComplete({
            id: 'unread-1',
            arrived_at: new Date().toISOString(),
            location: { lat: -37.81, lng: 144.96, address: '1 Test St' },
            sign_photo: null,
            car_photo: null,
            rules: '',
            observations: [],
            expires_at: null,
            confidence: 'low',
            no_sign: true,
            ...(p.noSignReading ?? {}),
          })
        }
      >
        Fake save
      </button>
      <button onClick={p.onCancel}>Fake cancel logging</button>
    </div>
  ),
}))
vi.mock('./components/ReminderOptions', () => ({ default: () => <p>Fake reminders</p> }))

const AUTH: AuthContextValue = { user: null, loading: false, configured: false, refresh: async () => {}, signOut: () => {} }

function renderApp() {
  return render(
    <AuthContext.Provider value={AUTH}>
      <App />
    </AuthContext.Provider>,
  )
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

const SWEEP: RecurringRestriction = {
  kind: 'street_cleaning',
  days: ['TU'],
  start: '07:00',
  end: '09:00',
  week_of_month: [],
  exceptions_text: '',
  label: 'Street cleaning Tue 7am-9am',
}

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

const MISSING = answer({
  sign_status: 'missing',
  sign_issues: ['Empty pole, no plates in view'],
  rules: '',
  can_park_now: false,
  duration_minutes: null,
  confidence: 'low',
})

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/app/')
  for (const m of Object.values(mocks)) m.mockReset()
  loggerProps.length = 0
  resultProps.length = 0
  setPhotoBackendForTests(createMemoryPhotoBackend())
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn() }, configurable: true })
})

afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
})

async function scanTo(result: ParkingRules) {
  mocks.translateSign.mockResolvedValueOnce(result)
  renderApp()
  click('Fake start scan')
  click('Fake capture')
}

describe('a photo with no readable parking sign', () => {
  it.each(['missing', 'not_a_parking_sign'] as const)('%s: the "no readable sign" screen, never an answer', async (status) => {
    await scanTo({ ...MISSING, sign_status: status })
    expect(await screen.findByRole('heading', { name: i18n.t('unclearSign.noSignTitle') })).toBeTruthy()
    expect(
      screen.getByText(
        "We couldn't find a readable parking sign in this photo. That doesn't mean there are no rules here. General road rules still apply, such as no parking within 10 metres of an intersection without traffic lights, and some areas have time limits without a sign on every street.",
      ),
    ).toBeTruthy()
    expect(screen.queryByText('Fake result')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retake photo' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Log without a sign' })).toBeTruthy()
  })

  it('"Retake photo" goes back to the scanner', async () => {
    await scanTo(MISSING)
    fireEvent.click(await screen.findByRole('button', { name: 'Retake photo' }))
    expect(screen.getByRole('button', { name: 'Fake capture' })).toBeTruthy()
  })

  it('"Log without a sign" opens the no-sign logger with the scan photo as the surroundings photo', async () => {
    await scanTo(MISSING)
    fireEvent.click(await screen.findByRole('button', { name: 'Log without a sign' }))
    await screen.findByRole('button', { name: 'Fake save' })
    const props = loggerProps.at(-1)!
    expect(props.mode).toBe('no-sign')
    expect(props.signPhoto).toBeNull()
    expect(props.ambientPhoto).toBe(SCAN_URL)
    expect(props.ambientPhotoMeta).toEqual(SCAN_META)
    expect(props.noSignReading).toEqual({ sign_status: 'missing', sign_issues: ['Empty pole, no plates in view'] })

    // Cancel comes back to the screen, not home.
    click('Fake cancel logging')
    expect(await screen.findByRole('heading', { name: i18n.t('unclearSign.noSignTitle') })).toBeTruthy()

    // Saving keeps the status on the record, with the scan's draft.
    click('Log without a sign')
    click('Fake save')
    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))
    const saved = getSession('unread-1')!
    expect(saved.no_sign).toBe(true)
    expect(saved.sign_status).toBe('missing')
    expect(saved.sign_issues).toEqual(['Empty pole, no plates in view'])
    expect(await screen.findByText('Fake reminders')).toBeTruthy()
  })
})

describe('an unclear sign keeps its answer', () => {
  it.each(['partially_obscured', 'contradictory'] as const)('%s goes to the result screen', async (status) => {
    await scanTo(answer({ sign_status: status, sign_issues: ['Faded'], can_park_now: false }))
    expect(await screen.findByText('Fake result')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: i18n.t('unclearSign.noSignTitle') })).toBeNull()
    expect(resultProps.at(-1)!.result.sign_status).toBe(status)
  })
})

describe('a re-check keeps what the first reading saw', () => {
  it('echoes the reading and the result keeps the condition, area flag and weekly restrictions', async () => {
    const sha = await putPhoto('rec-recheck', SCAN_URL)
    saveSession({
      id: 'rec-recheck',
      arrived_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
      sign_photo: null,
      car_photo: null,
      rules: '2P; 1P AREA',
      observations: [],
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      confidence: 'medium',
      photos: [{ role: 'sign', sha256: sha, captured_at: SCAN_META.captured_at, source: 'camera_input' }],
      sign_status: 'partially_obscured',
      sign_issues: ['Bottom plate faded'],
      rule_flags: {
        requires_ticket: false,
        payment_methods: null,
        requires_disabled_permit: false,
        is_permit_zone: false,
        permit_area: null,
        is_area_sign: true,
      },
      recurring_restrictions: [SWEEP],
    })
    mocks.refreshInterpretation.mockResolvedValueOnce(answer({ sign_status: 'readable', is_area_sign: false }))
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('active.recheckSub') }))
    expect(await screen.findByText('Fake result')).toBeTruthy()

    const [prior] = mocks.refreshInterpretation.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(prior).toMatchObject({ sign_status: 'partially_obscured', sign_issues: ['Bottom plate faded'], is_area_sign: true })
    const shown = resultProps.at(-1)!.result
    expect(shown.sign_status).toBe('partially_obscured')
    expect(shown.sign_issues).toEqual(['Bottom plate faded'])
    expect(shown.is_area_sign).toBe(true)
    expect(shown.recurring_restrictions).toEqual([SWEEP])
  })
})
