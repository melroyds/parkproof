// @vitest-environment happy-dom
//
// Workday mode's screens and flow in App (build spec T6b items 1 to 7 and
// 10), with VITE_FEATURE_WORKDAY on, and with it off.
//
// Why this file is in the suite: workday mode stays off in production until
// a lawyer has read its copy, so with the flag off not one workday screen,
// link, card, scan rule or grouping may appear. With it on, the flow is the
// legal safety design: the start gate (Victoria and Queensland only, from
// the phone's location), a car that hasn't moved never gets a new arrival
// time, every move is a fresh photo of a readable sign, a stop elsewhere is
// saved as a normal record, and backing out never changes the workday.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from './lib/i18n'
import { AuthContext, type AuthContextValue } from './lib/auth-context-shape'
import { appendAddendum, getActiveWorkday, getSession, loadSessions, loadWorkdays, saveSession, startWorkday } from './lib/storage'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from './lib/photo-store'
import type { AddendumKind, LogDraft, ParkingRules, ParkingSession, SignedAddendum } from './types'
import App from './App'

const flag = vi.hoisted(() => ({ on: true }))
const mocks = vi.hoisted(() => ({
  translateSign: vi.fn(async (): Promise<ParkingRules> => {
    throw new Error('set per test')
  }),
  signNewRecord: vi.fn<(id: string, draft: LogDraft) => void>(),
  reverseGeocodeDetails: vi.fn(),
  downloadWorkdayLegIcs: vi.fn(),
  queueAddendum: vi.fn((id: string, kind: AddendumKind, data: unknown, options: { captured_at?: string } = {}): SignedAddendum | null => {
    void id
    void kind
    void data
    void options
    return null
  }),
}))
/** What the fakes saw, latest last. */
const seen = vi.hoisted(() => ({
  scanner: [] as Array<{ workdayLeg?: boolean }>,
  result: [] as Array<{ onBack?: unknown; onScanAnother?: unknown }>,
  logger: [] as Array<{ draft?: LogDraft | null }>,
}))
/** The state code the fake logger's reverse geocode found for the park it saves. */
const loggerPlace = vi.hoisted(() => ({ state: 'AU-VIC' as string | null, id: 1 }))

vi.mock('./lib/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/features')>()),
  isWorkdayEnabled: () => flag.on,
}))
vi.mock('./lib/geocode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/geocode')>()),
  reverseGeocodeDetails: mocks.reverseGeocodeDetails,
}))
vi.mock('./lib/ics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/ics')>()),
  downloadWorkdayLegIcs: mocks.downloadWorkdayLegIcs,
}))
// Push isn't available in this browser: workday reminders can't be delivered.
vi.mock('./lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/push')>()),
  cancelPushReminders: vi.fn(async () => ({ ok: true, deleted: 0 })),
  isPushSupported: () => false,
  getPushPermissionState: () => 'unsupported',
  installPushRegistrationRefresh: () => () => {},
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
  scheduleDepartureCatchUp: vi.fn(() => () => {}),
  queueAddendum: mocks.queueAddendum,
}))
vi.mock('./lib/claude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/claude')>()),
  translateSign: mocks.translateSign,
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
  default: (p: {
    workdayLeg?: boolean
    onCapture: (d: string, m: string, c: { lat: number; lng: number } | null, meta?: { captured_at: string; source: 'camera_input' }) => void
    onCancel: () => void
  }) => (
    <div ref={() => void seen.scanner.push({ workdayLeg: p.workdayLeg })}>
      <button
        onClick={() =>
          p.onCapture('data:image/jpeg;base64,' + btoa('sign'), 'image/jpeg', { lat: -37.81, lng: 144.96 }, {
            captured_at: new Date().toISOString(),
            source: 'camera_input',
          })
        }
      >
        Fake capture
      </button>
      <button
        onClick={() =>
          p.onCapture('data:image/jpeg;base64,' + btoa('old-sign'), 'image/jpeg', { lat: -37.81, lng: 144.96 }, {
            captured_at: new Date().toISOString(),
            source: 'library',
          } as never)
        }
      >
        Fake old capture
      </button>
      <button onClick={p.onCancel}>Fake scan back</button>
    </div>
  ),
}))
vi.mock('./components/ParkingResult', () => ({
  default: (p: {
    onLogSession: (a: { gate_acks: LogDraft['gate_acks']; permit_context: null }) => void
    onBack?: () => void
    onScanAnother?: () => void
  }) => (
    <div ref={() => void seen.result.push({ onBack: p.onBack, onScanAnother: p.onScanAnother })}>
      <button
        onClick={() =>
          p.onLogSession({ gate_acks: { meter_ticket: null, permit_zone: null, accessible_permit: null }, permit_context: null })
        }
      >
        Fake log
      </button>
      {p.onBack && <button onClick={p.onBack}>Fake result back</button>}
      {p.onScanAnother && <button onClick={p.onScanAnother}>Fake scan another</button>}
    </div>
  ),
}))
vi.mock('./components/SessionLogger', () => ({
  default: (p: { rules: ParkingRules | null; draft?: LogDraft | null; onComplete: (s: ParkingSession) => void; onCancel: () => void }) => (
    <div ref={() => void seen.logger.push({ draft: p.draft })}>
      <button
        onClick={() =>
          p.onComplete({
            id: `new-${loggerPlace.id++}`,
            arrived_at: new Date().toISOString(),
            location: { lat: -37.81, lng: 144.96, address: '9 New St', source: 'gps', accuracy_meters: 6 },
            sign_photo: null,
            car_photo: null,
            rules: p.rules?.rules ?? '',
            observations: [],
            expires_at: p.rules?.until ?? null,
            confidence: 'high',
            sign_status: 'readable',
            ...(loggerPlace.state ? { place: { road: 'New St', suburb: 'Carlton', state_code: loggerPlace.state } } : {}),
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
const renderApp = () =>
  render(
    <AuthContext.Provider value={AUTH}>
      <App />
    </AuthContext.Provider>,
  )
const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts)
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

const VIC = { road: 'King St', suburb: 'Melbourne', state_code: 'AU-VIC' }
const NSW = { road: 'George St', suburb: 'Sydney', state_code: 'AU-NSW' }

function record(id: string, overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id,
    arrived_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne VIC', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P 8am-6pm',
    observations: [],
    expires_at: new Date(Date.now() + 90 * 60_000).toISOString(),
    confidence: 'high',
    sign_status: 'readable',
    place: VIC,
    ...overrides,
  }
}

function answer(overrides: Partial<ParkingRules> = {}): ParkingRules {
  return {
    sign_status: 'readable',
    sign_issues: [],
    rules: '2P 8am-6pm',
    observations: [],
    can_park_now: true,
    until: new Date(Date.now() + 120 * 60_000).toISOString(),
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

/** The phone's GPS: high-accuracy requests get `fix` (null: refused). */
const gps = vi.hoisted(() => ({ fix: null as { latitude: number; longitude: number; accuracy: number } | null }))

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/app/')
  flag.on = true
  loggerPlace.state = 'AU-VIC'
  seen.scanner.length = 0
  seen.result.length = 0
  seen.logger.length = 0
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.queueAddendum.mockImplementation((id, kind, data, options = {}) => appendAddendum(id, { kind, data, ...options }))
  mocks.reverseGeocodeDetails.mockImplementation(async () => ({ address: '1 Test St', ...VIC }))
  gps.fix = { latitude: -37.81, longitude: 144.96, accuracy: 10 }
  setPhotoBackendForTests(createMemoryPhotoBackend())
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: (p: unknown) => void, fail: (e: { code: number }) => void, options?: PositionOptions) => {
        if (!options?.enableHighAccuracy) return
        if (gps.fix) ok({ coords: gps.fix })
        else fail({ code: 1 })
      },
    },
  })
})

afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
})

/** An active workday between moves (no current stop), stored directly. */
function startedBetweenMoves(): string {
  return startWorkday({ jurisdiction: 'VIC' }).id
}

/** A workday parked on a stop that is saved as leg `index`. */
function parkedOn(leg: ParkingSession, index = 0): string {
  const id = 'aaaaaaaa-1111-4111-8111-111111111111'
  saveSession({ ...leg, workday_id: id, leg_index: index })
  startWorkday({ jurisdiction: 'VIC', current_session_id: leg.id, id })
  return id
}

describe('workday mode with VITE_FEATURE_WORKDAY on', () => {
  it('Start: the GPS gate, the full explainer with the reliability line, readiness, then a workday between moves', async () => {
    saveSession(record('old', { ended_at: new Date().toISOString() }))
    renderApp()
    click(t('home.startWorkday'))

    // The gate passes only after the fix and the lookup.
    await screen.findByText(t('workday.explainer.full'))
    expect(mocks.reverseGeocodeDetails).toHaveBeenCalledWith(-37.81, 144.96)
    expect(screen.getByText(t('reminders.reliability'))).toBeTruthy()
    // Push isn't available here: the spec's line.
    expect(screen.getByText(t('workday.ready.cantDeliver'))).toBeTruthy()
    // No record is active, so there is no first stop to offer.
    expect(screen.queryByRole('button', { name: t('workday.start.useCurrent') })).toBeNull()

    click(t('workday.start.button'))
    const workday = getActiveWorkday()
    expect(workday).toMatchObject({ jurisdiction: 'VIC', status: 'between_moves', current_session_id: null })
    // Home: the workday card, its first scan, and no ordinary scan button or link.
    const card = screen.getByTestId('workday-card')
    expect(within(card).getByRole('button', { name: t('workday.card.scanFirst') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: t('home.scanAnother') })).toBeNull()
    expect(screen.queryByRole('button', { name: t('home.scanCta') })).toBeNull()
    expect(screen.queryByRole('button', { name: t('home.startWorkday') })).toBeNull()
  })

  it('the explainer is one line after the first workday', async () => {
    saveSession(record('old', { ended_at: new Date().toISOString() }))
    const id = startedBetweenMoves()
    // End it through the store, leaving one ended workday on the device.
    const { endWorkday } = await import('./lib/storage')
    endWorkday(id)
    renderApp()
    click(t('home.startWorkday'))
    await screen.findByText(t('workday.explainer.short'))
    expect(screen.queryByText(t('workday.explainer.full'))).toBeNull()
  })

  it('Start elsewhere: the exact gate copy and no way to start', async () => {
    mocks.reverseGeocodeDetails.mockImplementation(async () => ({ address: 'x', ...NSW }))
    saveSession(record('old', { ended_at: new Date().toISOString() }))
    renderApp()
    click(t('home.startWorkday'))
    await screen.findByText(t('workday.start.unavailable'))
    expect(screen.queryByRole('button', { name: t('workday.start.button') })).toBeNull()
    expect(screen.queryByText(t('workday.explainer.full'))).toBeNull()
    expect(getActiveWorkday()).toBeNull()
  })

  it('Start without a usable fix: never a guess, a retry, no way to start', async () => {
    gps.fix = null
    saveSession(record('old', { ended_at: new Date().toISOString() }))
    renderApp()
    click(t('home.startWorkday'))
    await screen.findByText(t('workday.start.unknown'))
    expect(mocks.reverseGeocodeDetails).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: t('workday.start.button') })).toBeNull()
    // Retry with a fix now: the gate opens.
    gps.fix = { latitude: -37.81, longitude: 144.96, accuracy: 10 }
    click(t('common.retry'))
    await screen.findByRole('button', { name: t('workday.start.button') })
  })

  it("hides the link when the last record's state is known and isn't VIC or QLD", () => {
    saveSession(record('old', { ended_at: new Date().toISOString(), place: NSW }))
    renderApp()
    expect(screen.queryByRole('button', { name: t('home.startWorkday') })).toBeNull()
  })

  it("Use the car's current park: leg 0 is the record as logged, tagged, not re-signed, no new arrival", async () => {
    const active = record('here')
    saveSession(active)
    renderApp()
    click(t('home.startWorkday'))
    await screen.findByRole('button', { name: t('workday.start.useCurrent') })
    // The only way in: no plain Start while the car is parked.
    expect(screen.queryByRole('button', { name: t('workday.start.button') })).toBeNull()
    // Reminders can't be delivered here: the calendar file for that stop.
    click(t('workday.ics.button'))
    // The calendar code loads on the tap, so the file comes a moment later.
    await waitFor(() => expect(mocks.downloadWorkdayLegIcs).toHaveBeenCalledTimes(1))
    expect(mocks.downloadWorkdayLegIcs.mock.calls[0][0].id).toBe('here')
    expect(mocks.downloadWorkdayLegIcs.mock.calls[0][1].map((r: { kind: string }) => r.kind)).toEqual([
      'heads_up',
      'go_now',
      'at_deadline',
    ])

    click(t('workday.start.useCurrent'))
    const workday = getActiveWorkday()!
    expect(workday).toMatchObject({ status: 'parked', current_session_id: 'here' })
    const leg = getSession('here')!
    expect(leg).toMatchObject({ workday_id: workday.id, leg_index: 0 })
    expect(leg.arrived_at).toBe(active.arrived_at)
    expect(leg.expires_at).toBe(active.expires_at)
    expect(loadSessions()).toHaveLength(1)
    expect(mocks.signNewRecord).not.toHaveBeenCalled()
    expect(mocks.queueAddendum).not.toHaveBeenCalled()

    // The workday card replaces the active card: no Re-check, no Scan another.
    const card = screen.getByTestId('workday-card')
    expect(within(card).getByRole('button', { name: t('workday.card.move') })).toBeTruthy()
    expect(within(card).getByText(t('workday.card.moveHint'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: t('active.recheckSub') })).toBeNull()
    expect(screen.queryByRole('button', { name: t('active.iveLeftAria') })).toBeNull()
    expect(screen.queryByRole('button', { name: t('home.scanAnother') })).toBeNull()
  })

  it('an active park that cannot be a stop says why and offers no way to start', async () => {
    saveSession(record('nosign', { no_sign: true, expires_at: null, rules: '' }))
    renderApp()
    click(t('home.startWorkday'))
    await screen.findByText(t('workday.start.currentIneligible'))
    expect(screen.queryByRole('button', { name: t('workday.start.button') })).toBeNull()
    expect(screen.queryByRole('button', { name: t('workday.start.useCurrent') })).toBeNull()
  })

  it('the workday card stays in place of the active card after the stop has expired', () => {
    parkedOn(record('l0', { expires_at: new Date(Date.now() - 20 * 60_000).toISOString() }))
    renderApp()
    const card = screen.getByTestId('workday-card')
    expect(within(card).getByText(t('workday.card.expiredHint'))).toBeTruthy()
    expect(within(card).getByRole('button', { name: t('workday.card.move') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: t('active.iveLeftAria') })).toBeNull()
  })

  it("I'm moving the car now: the departure flow for the stop, then between moves", async () => {
    const id = parkedOn(record('l0'))
    renderApp()
    click(t('workday.card.move'))
    // The departure sheet asks; nothing is stored yet.
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(getSession('l0')?.ended_at).toBeUndefined()
    const before = Date.now()
    click(t('departure.confirm'))
    const ended = Date.parse(getSession('l0')!.ended_at!)
    expect(ended).toBeGreaterThanOrEqual(before)
    expect(getActiveWorkday()).toMatchObject({ id, status: 'between_moves', current_session_id: 'l0' })
    expect(within(screen.getByTestId('workday-card')).getByRole('button', { name: t('workday.card.scanNext') })).toBeTruthy()
    // The departure (GPS at the old bay; refused here) is saved and queued for signing.
    await waitFor(() => expect(getSession('l0')?.departure).toBeTruthy())
  })

  it('a stop ended elsewhere (its record screen, another device): the card offers the next scan, which moves the workday on first', () => {
    const id = parkedOn(record('l0', { ended_at: new Date().toISOString() }))
    renderApp()
    const card = screen.getByTestId('workday-card')
    expect(within(card).queryByRole('button', { name: t('workday.card.move') })).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: t('workday.card.scanNext') }))
    expect(getActiveWorkday()).toMatchObject({ id, status: 'between_moves', current_session_id: 'l0' })
    expect(seen.scanner.at(-1)?.workdayLeg).toBe(true)
  })

  it('between moves: a fresh-photo scan, Back from result and logging changes nothing, Save makes the next stop', async () => {
    const id = parkedOn(record('l0', { ended_at: new Date().toISOString() }))
    const { markWorkdayMoving } = await import('./lib/storage')
    markWorkdayMoving(id)
    const before = JSON.stringify(getActiveWorkday())
    mocks.translateSign.mockResolvedValue(answer())
    renderApp()

    click(t('workday.card.scanNext'))
    expect(seen.scanner.at(-1)?.workdayLeg).toBe(true)
    // Back out of the scanner.
    click('Fake scan back')
    expect(JSON.stringify(getActiveWorkday())).toBe(before)

    // Back out of the result: home, unchanged. No "Scan another" offered.
    click(t('workday.card.scanNext'))
    click('Fake capture')
    await screen.findByRole('button', { name: 'Fake log' })
    expect(seen.result.at(-1)?.onScanAnother).toBeUndefined()
    click('Fake result back')
    expect(screen.getByTestId('workday-card')).toBeTruthy()
    expect(JSON.stringify(getActiveWorkday())).toBe(before)

    // Back out of the logger: home, unchanged.
    click(t('workday.card.scanNext'))
    click('Fake capture')
    await screen.findByRole('button', { name: 'Fake log' })
    click('Fake log')
    expect(seen.logger.at(-1)?.draft?.workday).toEqual({ workday_id: id, leg_index: 1, previous_session_id: 'l0' })
    click('Fake cancel logging')
    expect(screen.getByTestId('workday-card')).toBeTruthy()
    expect(JSON.stringify(getActiveWorkday())).toBe(before)
    expect(loadSessions()).toHaveLength(1)

    // Save: the next stop, with the workday link on the record and in the draft link 1 signs.
    click(t('workday.card.scanNext'))
    click('Fake capture')
    await screen.findByRole('button', { name: 'Fake log' })
    click('Fake log')
    click('Fake save')
    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))
    const [savedId, draft] = mocks.signNewRecord.mock.calls[0]
    expect(getSession(savedId)).toMatchObject({ workday_id: id, leg_index: 1 })
    expect(draft.workday).toEqual({ workday_id: id, leg_index: 1, previous_session_id: 'l0' })
    expect(getActiveWorkday()).toMatchObject({ status: 'parked', current_session_id: savedId, previous_session_id: 'l0' })
    // A stop goes home to the workday card, not to the reminder screen.
    expect(screen.queryByText('Fake reminders')).toBeNull()
    expect(within(screen.getByTestId('workday-card')).getByRole('button', { name: t('workday.card.move') })).toBeTruthy()
  })

  it("a stop outside VIC and QLD is saved as a normal record and the workday stops, with the spec's words", async () => {
    const id = startedBetweenMoves()
    loggerPlace.state = 'AU-NSW'
    mocks.translateSign.mockResolvedValue(answer())
    renderApp()
    click(t('workday.card.scanFirst'))
    click('Fake capture')
    await screen.findByRole('button', { name: 'Fake log' })
    click('Fake log')
    click('Fake save')
    await screen.findByText(t('workday.stopped.notAvailable'))
    expect(screen.getByText('Fake reminders')).toBeTruthy()
    const [savedId, draft] = mocks.signNewRecord.mock.calls[0]
    const saved = getSession(savedId)!
    expect(saved.workday_id).toBeUndefined()
    expect(saved.leg_index).toBeUndefined()
    expect(draft.workday).toBeNull()
    expect(getActiveWorkday()).toBeNull()
    expect(loadWorkdays().find((w) => w.id === id)?.status).toBe('ended')
  })

  it("a stop whose state is unknown is never a stop either, and the driver is told the state couldn't be told", async () => {
    const id = startedBetweenMoves()
    loggerPlace.state = null
    mocks.translateSign.mockResolvedValue(answer())
    renderApp()
    click(t('workday.card.scanFirst'))
    click('Fake capture')
    await screen.findByRole('button', { name: 'Fake log' })
    click('Fake log')
    click('Fake save')
    await screen.findByText(t('workday.stopped.unknownState'))
    // Never the "isn't available here" line: the park may well be in Victoria.
    expect(screen.queryByText(t('workday.stopped.notAvailable'))).toBeNull()
    expect(getSession(mocks.signNewRecord.mock.calls[0][0])?.workday_id).toBeUndefined()
    expect(loadWorkdays().find((w) => w.id === id)?.status).toBe('ended')
  })

  it('between moves, a photo that was not taken just now never becomes a stop: back to the camera', async () => {
    const id = startedBetweenMoves()
    mocks.translateSign.mockResolvedValue(answer())
    renderApp()
    click(t('workday.card.scanFirst'))
    const scans = seen.scanner.length
    click('Fake old capture')
    // Not read, not logged: the scanner again, for the same stop.
    expect(mocks.translateSign).not.toHaveBeenCalled()
    expect(seen.scanner.length).toBeGreaterThan(scans)
    expect(seen.scanner.at(-1)?.workdayLeg).toBe(true)
    expect(getActiveWorkday()).toMatchObject({ id, status: 'between_moves' })
  })

  it("with the car at a stop, About's \"Try it\" goes to the workday card, never to a scan of the same spot", () => {
    parkedOn(record('l0'))
    renderApp()
    click(t('common.about'))
    click(t('about.cta'))
    expect(seen.scanner).toHaveLength(0)
    expect(screen.getByTestId('workday-card')).toBeTruthy()
    expect(within(screen.getByTestId('workday-card')).getByRole('button', { name: t('workday.card.move') })).toBeTruthy()
  })

  it("between moves, About's \"Try it\" is the next stop's scan", () => {
    startedBetweenMoves()
    renderApp()
    click(t('common.about'))
    click(t('about.cta'))
    expect(seen.scanner.at(-1)?.workdayLeg).toBe(true)
  })

  it('no readable sign between moves: only Retake photo and End workday, with the spec copy', async () => {
    const id = startedBetweenMoves()
    mocks.translateSign.mockResolvedValue(answer({ sign_status: 'missing', rules: '', can_park_now: false, until: null }))
    renderApp()
    click(t('workday.card.scanFirst'))
    click('Fake capture')
    await screen.findByText(t('workday.noSign.body'))
    expect(screen.queryByText(t('unclearSign.noSignBody'))).toBeNull()
    expect(screen.queryByRole('button', { name: t('unclearSign.logWithoutSign') })).toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(t('unclearSign.retake')) })).toBeTruthy()
    click(t('workday.card.end'))
    expect(loadWorkdays().find((w) => w.id === id)?.status).toBe('ended')
    expect(screen.queryByTestId('workday-card')).toBeNull()
  })

  it('End workday between moves asks, then ends; Cancel changes nothing', () => {
    const id = startedBetweenMoves()
    renderApp()
    click(t('workday.card.end'))
    expect(screen.getByRole('dialog', { name: t('workday.end.title') })).toBeTruthy()
    click(t('common.cancel'))
    expect(getActiveWorkday()?.id).toBe(id)
    click(t('workday.card.end'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('workday.card.end') }))
    expect(getActiveWorkday()).toBeNull()
    expect(screen.queryByTestId('workday-card')).toBeNull()
  })

  it('End workday at a stop runs its departure flow first, then ends the workday', () => {
    const id = parkedOn(record('l0'))
    renderApp()
    click(t('workday.card.end'))
    // The departure sheet, not the end dialog.
    expect(screen.getByRole('dialog').textContent).toContain(t('departure.confirm'))
    click(t('departure.confirm'))
    expect(getSession('l0')?.ended_at).toEqual(expect.any(String))
    expect(loadWorkdays().find((w) => w.id === id)).toMatchObject({ status: 'ended' })
  })

  it('History: one row per workday, opening the workday view of its stops', () => {
    const id = 'aaaaaaaa-1111-4111-8111-111111111111'
    saveSession(record('l0', { workday_id: id, leg_index: 0, ended_at: new Date().toISOString(), location: { lat: -37.81, lng: 144.96, address: '1 First St' } }))
    saveSession(record('other', { ended_at: new Date().toISOString(), location: { lat: -37.81, lng: 144.96, address: '5 Other St' } }))
    saveSession(record('l1', { workday_id: id, leg_index: 1, ended_at: new Date().toISOString(), location: { lat: -37.81, lng: 144.96, address: '2 Second St' } }))
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t('home.history')}`) }))
    const workdayRow = screen.getByRole('button', { name: new RegExp(t('workday.history.row', { count: 2 })) })
    expect(screen.getAllByText(t('workday.history.row', { count: 2 }))).toHaveLength(1)
    // The other record keeps its own row; the stops have none of their own.
    expect(screen.getByText('5 Other St')).toBeTruthy()
    expect(screen.queryByText('1 First St')).toBeNull()
    fireEvent.click(workdayRow)
    expect(screen.getByRole('heading', { name: t('workday.view.title') })).toBeTruthy()
    expect(screen.getByText('1 First St')).toBeTruthy()
    expect(screen.getByText('2 Second St')).toBeTruthy()
    expect(screen.getAllByText(/^Stop [12]$/).map((n) => n.textContent)).toEqual(['Stop 1', 'Stop 2'])
  })

  it('the workday view offers the workday PDF (T6c), behind the leg picker and its warning', () => {
    const id = 'aaaaaaaa-1111-4111-8111-111111111111'
    saveSession(record('l0', { workday_id: id, leg_index: 0, ended_at: new Date().toISOString() }))
    saveSession(record('l1', { workday_id: id, leg_index: 1, ended_at: new Date().toISOString() }))
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t('home.history')}`) }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t('workday.history.row', { count: 2 })) }))
    const open = screen.getByRole('button', { name: t('workday.pdf.open') })
    // Nothing is exported from the view itself: the picker comes first, with the warning.
    expect(screen.queryByText(t('workday.pdf.warning'))).toBeNull()
    fireEvent.click(open)
    expect(within(screen.getByRole('dialog')).getByText(t('workday.pdf.warning'))).toBeTruthy()
  })
})

describe('workday mode with VITE_FEATURE_WORKDAY off', () => {
  beforeEach(() => {
    flag.on = false
  })

  it('home: no link, no workday card (even with a workday stored), the ordinary card and scan button', () => {
    parkedOn(record('l0'))
    renderApp()
    expect(screen.queryByRole('button', { name: t('home.startWorkday') })).toBeNull()
    expect(screen.queryByTestId('workday-card')).toBeNull()
    expect(screen.queryByRole('button', { name: t('workday.card.move') })).toBeNull()
    expect(screen.queryByRole('button', { name: t('workday.card.end') })).toBeNull()
    expect(screen.getByRole('button', { name: t('active.iveLeftAria') })).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(t('home.scanAnother')) })).toBeTruthy()
  })

  it("About's \"Try it\" and old photos behave as before, even with a workday stored", async () => {
    parkedOn(record('l0'))
    renderApp()
    click(t('common.about'))
    click(t('about.cta'))
    // The ordinary scanner, not the workday card.
    expect(seen.scanner.at(-1)?.workdayLeg).toBe(false)
    mocks.translateSign.mockResolvedValue(answer())
    click('Fake old capture')
    await waitFor(() => expect(mocks.translateSign).toHaveBeenCalledTimes(1))
  })

  it('a first visit shows no workday link either', () => {
    renderApp()
    expect(screen.queryByRole('button', { name: t('home.startWorkday') })).toBeNull()
  })

  it('a scan with a workday stored between moves is an ordinary scan, saved as an ordinary record', async () => {
    startedBetweenMoves()
    mocks.translateSign.mockResolvedValue(answer())
    saveSession(record('old', { ended_at: new Date().toISOString() }))
    renderApp()
    click(t('home.scanCta'))
    expect(seen.scanner.at(-1)?.workdayLeg).toBe(false)
    click('Fake capture')
    await screen.findByRole('button', { name: 'Fake log' })
    expect(seen.result.at(-1)?.onBack).toBeUndefined()
    expect(seen.result.at(-1)?.onScanAnother).toEqual(expect.any(Function))
    click('Fake log')
    expect(seen.logger.at(-1)?.draft?.workday).toBeNull()
    click('Fake save')
    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))
    const [savedId, draft] = mocks.signNewRecord.mock.calls[0]
    expect(draft.workday).toBeNull()
    expect(getSession(savedId)?.workday_id).toBeUndefined()
    // To the reminder screen, as always, and no workday message.
    expect(screen.getByText('Fake reminders')).toBeTruthy()
    expect(screen.queryByText(t('workday.stopped.notAvailable'))).toBeNull()
  })

  it('no readable sign: the ordinary screen, with Log without a sign and no End workday', async () => {
    startedBetweenMoves()
    saveSession(record('old', { ended_at: new Date().toISOString() }))
    mocks.translateSign.mockResolvedValue(answer({ sign_status: 'missing', rules: '', can_park_now: false, until: null }))
    renderApp()
    click(t('home.scanCta'))
    click('Fake capture')
    await screen.findByText(t('unclearSign.noSignBody'))
    expect(screen.getByRole('button', { name: t('unclearSign.logWithoutSign') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: t('workday.card.end') })).toBeNull()
    expect(screen.queryByText(t('workday.noSign.body'))).toBeNull()
  })

  it('History lists every stop as its own record and never groups a workday', () => {
    const id = 'aaaaaaaa-1111-4111-8111-111111111111'
    saveSession(record('l0', { workday_id: id, leg_index: 0, ended_at: new Date().toISOString(), location: { lat: -37.81, lng: 144.96, address: '1 First St' } }))
    saveSession(record('l1', { workday_id: id, leg_index: 1, ended_at: new Date().toISOString(), location: { lat: -37.81, lng: 144.96, address: '2 Second St' } }))
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t('home.history')}`) }))
    expect(screen.queryByText(t('workday.history.row', { count: 2 }))).toBeNull()
    expect(screen.getByText('1 First St')).toBeTruthy()
    expect(screen.getByText('2 Second St')).toBeTruthy()
  })

  it('no workday PDF anywhere: a stored stop opens its ordinary record screen and record PDF only', () => {
    const id = 'aaaaaaaa-1111-4111-8111-111111111111'
    saveSession(record('l0', { workday_id: id, leg_index: 0, ended_at: new Date().toISOString(), location: { lat: -37.81, lng: 144.96, address: '1 First St' } }))
    saveSession(record('l1', { workday_id: id, leg_index: 1, ended_at: new Date().toISOString(), location: { lat: -37.81, lng: 144.96, address: '2 Second St' } }))
    renderApp()
    expect(screen.queryByRole('button', { name: t('workday.pdf.open') })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t('home.history')}`) }))
    expect(screen.queryByRole('button', { name: t('workday.pdf.open') })).toBeNull()
    fireEvent.click(screen.getByText('2 Second St'))
    expect(screen.getByRole('button', { name: t('session.exportAsPdf') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: t('workday.pdf.open') })).toBeNull()
    expect(screen.queryByText(t('workday.pdf.warning'))).toBeNull()
  })

  it('confirming I\'ve left on a stored workday\'s stop leaves the workday alone', () => {
    const id = parkedOn(record('l0'))
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: t('active.iveLeftAria') }))
    click(t('departure.confirm'))
    expect(getSession('l0')?.ended_at).toEqual(expect.any(String))
    // The store isn't touched with the flag off.
    expect(loadWorkdays().find((w) => w.id === id)?.status).toBe('parked')
  })
})
