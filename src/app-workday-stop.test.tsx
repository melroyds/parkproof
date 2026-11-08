// @vitest-environment happy-dom
//
// Saving a workday stop in App (build spec T6b items 8 and 9): the stop's
// limit comes from the logger's boundary statement (its own sign's limit,
// or the stretch's still running after "I'm not sure"), the stop skips the
// reminder screen, and its reminders are set at once and shown on the
// workday card with the reliability line. With VITE_FEATURE_WORKDAY off
// none of this happens: a record saves as a normal one, to the reminder
// screen, and no workday reminder is set or armed.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from './lib/i18n'
import { AuthContext, type AuthContextValue } from './lib/auth-context-shape'
import { getSession, markWorkdayMoving, saveSession, startWorkday } from './lib/storage'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from './lib/photo-store'
import { HOME_SCAN_ID } from './lib/focus-targets'
import type { RemindMeSummary } from './lib/remind-me'
import type { BoundaryStatement, LogDraft, ParkingRules, ParkingSession } from './types'
import App from './App'

const flag = vi.hoisted(() => ({ on: true }))
/** Notification permission as the push module reports it. */
const perm = vi.hoisted(() => ({ state: 'granted' as NotificationPermission }))
const ics = vi.hoisted(() => ({ download: vi.fn() }))
const mocks = vi.hoisted(() => ({
  translateSign: vi.fn(async (): Promise<ParkingRules> => {
    throw new Error('set per test')
  }),
  signNewRecord: vi.fn<(id: string, draft: LogDraft) => void>(),
  book: vi.fn(),
  rearm: vi.fn(),
}))
/** What the fake logger saves on top of its record: the boundary statement and anything else. */
const loggerOut = vi.hoisted(() => ({ extra: {} as Partial<ParkingSession>, id: 1 }))

vi.mock('./lib/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/features')>()),
  isWorkdayEnabled: () => flag.on,
}))
vi.mock('./lib/geocode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/geocode')>()),
  reverseGeocodeDetails: async () => ({ address: '12 King St', road: 'King St', suburb: 'Melbourne', state_code: 'AU-VIC' }),
}))
vi.mock('./lib/workday-reminders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/workday-reminders')>()),
  bookWorkdayLegReminders: mocks.book,
  rearmWorkdayLegInTab: mocks.rearm,
}))
// Push works here and notifications are allowed: workday reminders are 'ready'.
vi.mock('./lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/push')>()),
  cancelPushReminders: vi.fn(async () => ({ ok: true, deleted: 0 })),
  isPushSupported: () => true,
  getPushPermissionState: () => perm.state,
  isPushTurnedOff: () => false,
  installPushRegistrationRefresh: () => () => {},
}))
vi.mock('./lib/ics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/ics')>()),
  downloadWorkdayLegIcs: ics.download,
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
    onCapture: (d: string, m: string, c: { lat: number; lng: number } | null, meta?: { captured_at: string; source: 'camera_input' }) => void
  }) => (
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
  ),
}))
vi.mock('./components/ParkingResult', () => ({
  default: (p: { onLogSession: (a: { gate_acks: LogDraft['gate_acks']; permit_context: null }) => void }) => (
    <button
      onClick={() =>
        p.onLogSession({ gate_acks: { meter_ticket: null, permit_zone: null, accessible_permit: null }, permit_context: null })
      }
    >
      Fake log
    </button>
  ),
}))
vi.mock('./components/SessionLogger', () => ({
  default: (p: { rules: ParkingRules | null; onComplete: (s: ParkingSession) => void }) => (
    <button
      onClick={() =>
        p.onComplete({
          id: `new-${loggerOut.id++}`,
          arrived_at: new Date().toISOString(),
          location: { lat: -37.81, lng: 144.96, address: '9 King St', source: 'gps', accuracy_meters: 6 },
          sign_photo: null,
          car_photo: null,
          rules: p.rules?.rules ?? '',
          observations: [],
          expires_at: p.rules?.until ?? null,
          confidence: 'high',
          sign_status: 'readable',
          place: { road: 'King St', suburb: 'Melbourne', state_code: 'AU-VIC' },
          ...loggerOut.extra,
        })
      }
    >
      Fake save
    </button>
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
const MIN = 60_000

function record(id: string, overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id,
    arrived_at: new Date(Date.now() - 60 * MIN).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne VIC', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P 8am-6pm',
    observations: [],
    expires_at: new Date(Date.now() + 60 * MIN).toISOString(),
    confidence: 'high',
    sign_status: 'readable',
    place: { road: 'King St', suburb: 'Melbourne', state_code: 'AU-VIC' },
    ...overrides,
  }
}

const OWN_UNTIL = () => new Date(Date.now() + 3 * 60 * MIN).toISOString()
function answer(): ParkingRules {
  return {
    sign_status: 'readable',
    sign_issues: [],
    rules: '1P 8am-6pm',
    observations: [],
    can_park_now: true,
    until: OWN_UNTIL(),
    duration_minutes: 180,
    confidence: 'high',
    is_area_sign: false,
    clarification: null,
  }
}

const statement = (answer: BoundaryStatement['answer']): BoundaryStatement => ({
  previous_session_id: 'l0',
  asked_because: ['within_30m'],
  answer,
  distance_from_previous_m: 8,
})

const WORKDAY = 'aaaaaaaa-1111-4111-8111-111111111111'
/** A workday between moves, after stop 1 (`l0`) ended. */
function betweenMoves(prev: ParkingSession) {
  saveSession({ ...prev, workday_id: WORKDAY, leg_index: 0, ended_at: new Date().toISOString() })
  startWorkday({ jurisdiction: 'VIC', current_session_id: prev.id, id: WORKDAY })
  markWorkdayMoving(WORKDAY)
}

/** Scan, log and save the next stop through the (fake) screens. */
async function logNextStop() {
  click(t('workday.card.scanNext'))
  click('Fake capture')
  await screen.findByRole('button', { name: 'Fake log' })
  click('Fake log')
  click('Fake save')
  await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))
  return getSession(mocks.signNewRecord.mock.calls[0][0])!
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/app/')
  flag.on = true
  perm.state = 'granted'
  ics.download.mockReset()
  loggerOut.extra = {}
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.translateSign.mockResolvedValue(answer())
  mocks.book.mockResolvedValue(null)
  setPhotoBackendForTests(createMemoryPhotoBackend())
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: -37.8136, longitude: 144.9631, accuracy: 8 } }),
    },
  })
})
afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
})

describe('saving a workday stop (flag on)', () => {
  it('"I\'m not sure": the running limit, no reminder screen, and its reminders set at once', async () => {
    const prev = record('l0')
    betweenMoves(prev)
    loggerOut.extra = { boundary: statement('not_sure') }
    const failed: RemindMeSummary = { kind: 'none', times: [], step: 'failed' }
    mocks.book.mockResolvedValue(failed)
    renderApp()

    const saved = await logNextStop()
    expect(saved).toMatchObject({
      workday_id: WORKDAY,
      leg_index: 1,
      boundary: statement('not_sure'),
      // The first stop's limit still runs, so the new sign's later one doesn't count.
      stretch_deadline: prev.expires_at,
      expires_at: prev.expires_at,
    })
    // The arrival_context is built from this record and the stop's draft.
    expect(mocks.signNewRecord.mock.calls[0][1].workday).toEqual({ workday_id: WORKDAY, leg_index: 1, previous_session_id: 'l0' })

    // Home, not the reminder screen.
    expect(screen.queryByText('Fake reminders')).toBeNull()
    const card = await screen.findByTestId('workday-card')

    // Reminders were set for the saved stop, with the workday's legs for the wording.
    await waitFor(() => expect(mocks.book).toHaveBeenCalledTimes(1))
    const [leg, legs, , options] = mocks.book.mock.calls[0]
    expect(leg.id).toBe(saved.id)
    expect(leg.expires_at).toBe(prev.expires_at)
    expect((legs as ParkingSession[]).map((l) => l.id)).toEqual(['l0', saved.id])
    expect(options).toMatchObject({ fromTap: false })

    // They couldn't be set: the card says so, offers Retry, and carries the reliability line.
    expect(await within(card).findByText(t('workday.reminders.notSet'))).toBeTruthy()
    expect(within(card).getByText(t('reminders.reliability'))).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: t('common.retry') }))
    await waitFor(() => expect(mocks.book).toHaveBeenCalledTimes(2))
    expect(mocks.book.mock.calls[1][3]).toMatchObject({ fromTap: true })
  })

  it('a named boundary starts the stop own limit', async () => {
    betweenMoves(record('l0'))
    loggerOut.extra = { boundary: statement('yellow_edge_line') }
    renderApp()
    const saved = await logNextStop()
    expect(saved.boundary).toEqual(statement('yellow_edge_line'))
    expect(saved.stretch_deadline).toBeNull()
    expect(Date.parse(saved.expires_at!)).toBeGreaterThan(Date.now() + 2 * 60 * MIN)
  })

  it('a stop that turns out not to be one keeps its own sign and no statement', async () => {
    betweenMoves(record('l0'))
    // The fake logger's place says New South Wales: saved as a normal record.
    loggerOut.extra = { boundary: statement('not_sure'), place: { road: 'George St', suburb: 'Sydney', state_code: 'AU-NSW' } }
    renderApp()
    const saved = await logNextStop()
    expect(saved.workday_id).toBeUndefined()
    expect('boundary' in saved).toBe(false)
    expect('stretch_deadline' in saved).toBe(false)
    expect(Date.parse(saved.expires_at!)).toBeGreaterThan(Date.now() + 2 * 60 * MIN)
    expect(await screen.findByText('Fake reminders')).toBeTruthy()
    expect(mocks.book).not.toHaveBeenCalled()
  })

  it("a stop whose state couldn't be told keeps the running limit and the driver's answer, and says why", async () => {
    // Melbourne CBD, a 150 m fix: no place lookup, so no state. The driver answered "I'm not sure".
    const prev = record('l0')
    betweenMoves(prev)
    loggerOut.extra = {
      boundary: { previous_session_id: 'l0', asked_because: ['location_unreliable'], answer: 'not_sure', distance_from_previous_m: null },
      place: undefined,
      location: { lat: -37.81, lng: 144.96, address: null, source: 'gps', accuracy_meters: 150 },
    }
    renderApp()
    const saved = await logNextStop()
    // Not a stop (there is no fallback that can make it Victoria)...
    expect(saved.workday_id).toBeUndefined()
    expect(mocks.signNewRecord.mock.calls[0][1].workday).toBeNull()
    // ...but never a fresh limit: the first stop's limit still runs, and the answer is kept for link 1 to sign.
    expect(saved.boundary).toMatchObject({ answer: 'not_sure', previous_session_id: 'l0' })
    expect(saved.stretch_deadline).toBe(prev.expires_at)
    expect(saved.expires_at).toBe(prev.expires_at)
    // The reminder screen says the state couldn't be told, not that workday mode isn't available here.
    expect(await screen.findByText(t('workday.stopped.unknownState'))).toBeTruthy()
    expect(screen.queryByText(t('workday.stopped.notAvailable'))).toBeNull()
    expect(screen.getByText('Fake reminders')).toBeTruthy()
    expect(mocks.book).not.toHaveBeenCalled()
  })

  it("an unknown state with a named boundary gets the new sign's own limit", async () => {
    betweenMoves(record('l0'))
    loggerOut.extra = {
      boundary: { previous_session_id: 'l0', asked_because: ['location_unreliable'], answer: 'yellow_edge_line', distance_from_previous_m: null },
      place: undefined,
    }
    renderApp()
    const saved = await logNextStop()
    expect(saved.stretch_deadline).toBeNull()
    expect(Date.parse(saved.expires_at!)).toBeGreaterThan(Date.now() + 2 * 60 * MIN)
    expect(await screen.findByText(t('workday.stopped.unknownState'))).toBeTruthy()
  })

  it("notifications not asked yet: the card says reminders can't reach the phone, and its button asks, then books", async () => {
    perm.state = 'default'
    betweenMoves(record('l0'))
    loggerOut.extra = { boundary: statement('yellow_edge_line') }
    const booked: RemindMeSummary = { kind: 'background', times: [new Date(Date.now() + 100 * MIN)], step: null }
    mocks.book.mockImplementation(async (_leg, _legs, _t, options: { fromTap?: boolean }) => {
      if (!options.fromTap) return null
      perm.state = 'granted'
      return booked
    })
    renderApp()
    const saved = await logNextStop()
    const card = await screen.findByTestId('workday-card')
    // The save itself never asks (no tap), so nothing was booked.
    await waitFor(() => expect(mocks.book).toHaveBeenCalledTimes(1))
    expect(mocks.book.mock.calls[0][3]).toMatchObject({ fromTap: false })
    // The spec's line, why, the button, and the calendar file with the same alarms.
    expect(await within(card).findByText(t('workday.ready.cantDeliver'))).toBeTruthy()
    expect(within(card).getByText(t('workday.ready.ask'))).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: t('workday.ics.button') }))
    // The calendar code loads on the tap, so the file comes a moment later.
    await waitFor(() => expect(ics.download).toHaveBeenCalledTimes(1))
    expect(ics.download.mock.calls[0][0].id).toBe(saved.id)

    fireEvent.click(within(card).getByRole('button', { name: t('workday.ready.allow') }))
    await waitFor(() => expect(mocks.book).toHaveBeenCalledTimes(2))
    expect(mocks.book.mock.calls[1][0].id).toBe(saved.id)
    expect(mocks.book.mock.calls[1][3]).toMatchObject({ fromTap: true })
    // Allowed now: the line goes.
    await waitFor(() => expect(within(card).queryByText(t('workday.ready.cantDeliver'))).toBeNull())
  })

  it('allowed later but never booked (a reload, or turned on in Settings): Retry and the calendar file', async () => {
    // Reminders were never booked for this stop, and nothing was tried in this page.
    saveSession({ ...record('l1'), workday_id: WORKDAY, leg_index: 0 })
    startWorkday({ jurisdiction: 'VIC', current_session_id: 'l1', id: WORKDAY })
    renderApp()
    const card = screen.getByTestId('workday-card')
    expect(within(card).getByText(t('workday.reminders.notSet'))).toBeTruthy()
    expect(within(card).getByRole('button', { name: t('workday.ics.button') })).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: t('common.retry') }))
    await waitFor(() => expect(mocks.book).toHaveBeenCalledTimes(1))
    expect(mocks.book.mock.calls[0][3]).toMatchObject({ fromTap: true })
  })

  it("while a stop's reminders are being set, the card says nothing about them yet", async () => {
    betweenMoves(record('l0'))
    loggerOut.extra = { boundary: statement('yellow_edge_line') }
    let finish: (s: RemindMeSummary | null) => void = () => {}
    mocks.book.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    renderApp()
    await logNextStop()
    const card = await screen.findByTestId('workday-card')
    await waitFor(() => expect(mocks.book).toHaveBeenCalledTimes(1))
    expect(within(card).queryByText(t('workday.reminders.notSet'))).toBeNull()
    expect(within(card).queryByRole('button', { name: t('common.retry') })).toBeNull()
    await act(async () => finish({ kind: 'none', times: [], step: 'failed' }))
    expect(await within(card).findByText(t('workday.reminders.notSet'))).toBeTruthy()
  })

  it("the car's current park as the first stop gets the workday reminders too", async () => {
    saveSession(record('here'))
    renderApp()
    click(t('home.startWorkday'))
    click((await screen.findByRole('button', { name: t('workday.start.useCurrent') })).textContent!)
    await waitFor(() => expect(mocks.book).toHaveBeenCalledTimes(1))
    const [leg] = mocks.book.mock.calls[0]
    expect(leg).toMatchObject({ id: 'here', leg_index: 0 })
    expect(screen.getByTestId('workday-card')).toBeTruthy()
  })

  it('the parked stop: booked times and the reliability line on the card, its in-tab reminders armed again', async () => {
    const leg = record('l1', { push_reminders: [{ fire_at: new Date(Date.now() + 20 * MIN).toISOString() }] })
    saveSession({ ...leg, workday_id: WORKDAY, leg_index: 0 })
    startWorkday({ jurisdiction: 'VIC', current_session_id: 'l1', id: WORKDAY })
    renderApp()
    const card = screen.getByTestId('workday-card')
    const reminders = within(card).getByTestId('workday-stop-reminders')
    expect(reminders.textContent).toMatch(/^1 reminder set for .+\. It's sent to this device even when ParkProof is closed\./)
    expect(within(reminders).getByText(t('reminders.reliability'))).toBeTruthy()
    expect(within(card).queryByRole('button', { name: t('common.retry') })).toBeNull()
    await waitFor(() => expect(mocks.rearm).toHaveBeenCalledTimes(1))
    expect(mocks.rearm.mock.calls[0][0].id).toBe('l1')
  })
})

describe('with VITE_FEATURE_WORKDAY off', () => {
  it('a record saves as a normal one: its own sign, no statement, the reminder screen, no workday reminders', async () => {
    flag.on = false
    saveSession(record('old', { ended_at: new Date().toISOString() }))
    // A workday left in the store from a build with the flag on changes nothing.
    startWorkday({ jurisdiction: 'VIC', id: WORKDAY })
    loggerOut.extra = { boundary: statement('not_sure'), stretch_deadline: new Date().toISOString() }
    renderApp()
    expect(screen.queryByTestId('workday-card')).toBeNull()
    fireEvent.click(document.getElementById(HOME_SCAN_ID)!)
    click('Fake capture')
    await screen.findByRole('button', { name: 'Fake log' })
    click('Fake log')
    click('Fake save')
    await waitFor(() => expect(mocks.signNewRecord).toHaveBeenCalledTimes(1))
    const saved = getSession(mocks.signNewRecord.mock.calls[0][0])!
    expect(mocks.signNewRecord.mock.calls[0][1].workday).toBeNull()
    expect(saved.workday_id).toBeUndefined()
    expect('boundary' in saved).toBe(false)
    expect('stretch_deadline' in saved).toBe(false)
    // Its own sign's limit, not a stretch deadline.
    expect(Date.parse(saved.expires_at!)).toBeGreaterThan(Date.now() + 2 * 60 * MIN)
    expect(await screen.findByText('Fake reminders')).toBeTruthy()
    expect(mocks.book).not.toHaveBeenCalled()
    expect(mocks.rearm).not.toHaveBeenCalled()
  })

  it('a parked workday in the store arms nothing and shows no card', () => {
    flag.on = false
    saveSession(record('l1', { workday_id: WORKDAY, leg_index: 0 }))
    startWorkday({ jurisdiction: 'VIC', current_session_id: 'l1', id: WORKDAY })
    renderApp()
    expect(screen.queryByTestId('workday-card')).toBeNull()
    expect(screen.queryByTestId('workday-stop-reminders')).toBeNull()
    expect(mocks.rearm).not.toHaveBeenCalled()
  })
})
