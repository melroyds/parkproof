// @vitest-environment happy-dom
//
// The workday screens and the workday variants of shared screens (build
// spec T6b items 1 to 7 and 10), one at a time:
//   - the scanner for a stop takes a fresh camera photo only: no re-check
//     offers, no photo library, no "No sign here". Without the prop (every
//     scan when the flag is off) it is the ordinary scanner;
//   - the result screen for a stop has Back and no "Scan another";
//   - the no-readable-sign screen for a stop offers only Retake photo and
//     End workday, with the spec's words;
//   - the start screen gates on the state from the phone's location before
//     any Start button, and asks for notifications;
//   - the workday view lists the stops and says when a first stop was an
//     earlier park whose signed details don't name the workday.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from '../lib/photo-store'
import { saveSession, startWorkday } from '../lib/storage'
import type { DepartureFixRequest, SettledFixState } from '../lib/departure'
import type { ParkingRules, ParkingSession } from '../types'
import type { ReadinessEnv } from '../lib/workday-flow'
import SignScanner from './SignScanner'
import ParkingResult from './ParkingResult'
import NoReadableSign from './NoReadableSign'
import WorkdayStart from './WorkdayStart'
import WorkdayView from './WorkdayView'

vi.mock('../lib/feedback', () => ({ submitFeedback: vi.fn() }))

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts)
const PHOTO = 'data:image/jpeg;base64,' + btoa('scan-photo')
const HERE = { lat: -37.8136, lng: 144.9631 }

function record(id: string, over: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id,
    arrived_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    location: { ...HERE, address: '12 King St, Melbourne', source: 'gps', accuracy_meters: 8 },
    sign_photo: PHOTO,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: new Date(Date.now() + 115 * 60_000).toISOString(),
    confidence: 'high',
    sign_status: 'readable',
    place: { road: 'King St', suburb: 'Melbourne', state_code: 'AU-VIC' },
    ...over,
  }
}

function answer(over: Partial<ParkingRules> = {}): ParkingRules {
  return {
    sign_status: 'readable',
    sign_issues: [],
    rules: '2P',
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
    ...over,
  }
}

/** A GPS fix request that settles at once with `state`. */
function settledFix(state: SettledFixState): () => DepartureFixRequest {
  return () => ({ current: () => state, settled: Promise.resolve(state), subscribe: () => () => {} })
}
const okFix = settledFix({ status: 'ok', fix: { lat: -27.47, lng: 153.02, accuracy_meters: 9, received_at: Date.now() } })

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  localStorage.clear()
  setPhotoBackendForTests(createMemoryPhotoBackend())
  Object.defineProperty(navigator, 'permissions', {
    value: { query: vi.fn(async () => ({ state: 'granted' })) },
    configurable: true,
  })
  Object.defineProperty(navigator, 'geolocation', {
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: HERE.lat, longitude: HERE.lng, accuracy: 10 } } as GeolocationPosition),
    },
    configurable: true,
  })
})
afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
})

describe('SignScanner for a workday stop', () => {
  const renderScanner = (workdayLeg?: boolean) =>
    render(
      <SignScanner onCapture={vi.fn()} onReuseSession={vi.fn()} onNoSignScan={vi.fn()} onCancel={vi.fn()} workdayLeg={workdayLeg} />,
    )

  it('a stop: camera only, no re-check offer for the record right here, no library, no "No sign here"', async () => {
    saveSession(record('own-1'))
    renderScanner(true)
    await waitFor(() => expect(navigator.permissions.query).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByText(t('workday.scan.fresh'))).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(t('scanner.takePhoto')) })).toBeTruthy()
    expect(screen.queryByRole('button', { name: new RegExp(t('scanner.fromLibrary')) })).toBeNull()
    expect(screen.queryByRole('button', { name: t('scanner.noSignHere') })).toBeNull()
    expect(screen.queryByText(t('reuse.matchCopy'))).toBeNull()
    expect(screen.queryByText(t('reuse.pickerHeader'))).toBeNull()
  })

  it('a stop refuses a photo from the camera input that was not taken just now, and says why', async () => {
    const onCapture = vi.fn()
    const { container } = render(
      <SignScanner onCapture={onCapture} onReuseSession={vi.fn()} onNoSignScan={vi.fn()} onCancel={vi.fn()} workdayLeg />,
    )
    // The sign photo's camera input (the surroundings one comes first and is never shown for a stop).
    const cameraInputs = container.querySelectorAll<HTMLInputElement>('input[capture="environment"]')
    const signCamera = cameraInputs[cameraInputs.length - 1]
    // A desktop file chooser, or an Android chooser's Gallery: a file from ten minutes ago.
    const old = new File(['old-jpeg'], 'sign.jpg', { type: 'image/jpeg', lastModified: Date.now() - 10 * 60_000 })
    fireEvent.change(signCamera, { target: { files: [old] } })
    expect(await screen.findByText(t('workday.scan.notFresh'))).toBeTruthy()
    // Never read, never offered for translation.
    expect(screen.queryByRole('button', { name: t('scanner.translate') })).toBeNull()
    expect(screen.queryByRole('button', { name: t('scanner.translateAnyway') })).toBeNull()
    expect(onCapture).not.toHaveBeenCalled()
  })

  it('an ordinary scan takes the same old file (the refusal is for workday stops only)', async () => {
    const { container } = renderScanner()
    const cameraInputs = container.querySelectorAll<HTMLInputElement>('input[capture="environment"]')
    const old = new File(['old-jpeg'], 'sign.jpg', { type: 'image/jpeg', lastModified: Date.now() - 10 * 60_000 })
    fireEvent.change(cameraInputs[cameraInputs.length - 1], { target: { files: [old] } })
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText(t('workday.scan.notFresh'))).toBeNull()
  })

  it('the ordinary scanner never offers a workday stop for a re-check, here or in the recent scans', async () => {
    const leg = record('leg-1', {
      workday_id: '0f0e0d0c-1111-4111-8111-111111111111',
      leg_index: 1,
      location: { ...HERE, address: '5 Stop Lane, Melbourne', source: 'gps', accuracy_meters: 8 },
    })
    saveSession(leg)
    renderScanner()
    await waitFor(() => expect(navigator.permissions.query).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText(t('reuse.matchCopy'))).toBeNull()
    expect(screen.queryByText(t('reuse.pickerHeader'))).toBeNull()
    cleanup()

    // The same place with an ordinary record as well: that one is offered,
    // so the check that skipped the stop could fire.
    saveSession(record('own-1', { arrived_at: new Date(Date.now() - 10 * 60_000).toISOString() }))
    renderScanner()
    expect(await screen.findByText(t('reuse.matchCopy'))).toBeTruthy()
    cleanup()

    // No usable location: the recent-scans picker offers the ordinary record only.
    Object.defineProperty(navigator, 'permissions', {
      value: { query: vi.fn(async () => ({ state: 'denied' })) },
      configurable: true,
    })
    renderScanner()
    expect(await screen.findByText(t('reuse.pickerHeader'))).toBeTruthy()
    expect(screen.getAllByRole('button').some((b) => b.textContent?.includes('12 King St'))).toBe(true)
    expect(screen.queryAllByRole('button').some((b) => b.textContent?.includes('5 Stop Lane'))).toBe(false)
  })

  it('without the prop (any scan with the flag off): the ordinary scanner, re-check offer included', async () => {
    saveSession(record('own-1'))
    renderScanner()
    expect(await screen.findByText(t('reuse.matchCopy'))).toBeTruthy()
    expect(screen.queryByText(t('workday.scan.fresh'))).toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(t('scanner.fromLibrary')) })).toBeTruthy()
    expect(screen.getByRole('button', { name: t('scanner.noSignHere') })).toBeTruthy()
  })
})

describe('ParkingResult for a workday stop', () => {
  it('Back instead of "Scan another"', () => {
    const onBack = vi.fn()
    render(
      <ParkingResult result={answer()} signPhoto={PHOTO} coords={HERE} onBack={onBack} onLogSession={vi.fn()} onRetake={vi.fn()} />,
    )
    expect(screen.queryByRole('button', { name: t('result.scanAnother') })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: t('common.back') }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('an ordinary scan keeps "Scan another" and has no Back', () => {
    render(
      <ParkingResult result={answer()} signPhoto={PHOTO} coords={HERE} onScanAnother={vi.fn()} onLogSession={vi.fn()} onRetake={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: t('result.scanAnother') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: t('common.back') })).toBeNull()
  })
})

describe('NoReadableSign for a workday stop', () => {
  const missing = answer({ sign_status: 'missing', rules: '', can_park_now: false, until: null })

  it('only Retake photo and End workday, with the spec copy', () => {
    const onEnd = vi.fn()
    render(
      <NoReadableSign result={missing} signPhoto={PHOTO} onRetake={vi.fn()} onLogWithoutSign={vi.fn()} onBack={vi.fn()} onEndWorkday={onEnd} />,
    )
    expect(screen.getByText(t('workday.noSign.body'))).toBeTruthy()
    expect(screen.queryByText(t('unclearSign.noSignBody'))).toBeNull()
    expect(screen.queryByRole('button', { name: t('unclearSign.logWithoutSign') })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: t('workday.card.end') }))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('without it: the ordinary screen', () => {
    render(<NoReadableSign result={missing} signPhoto={PHOTO} onRetake={vi.fn()} onLogWithoutSign={vi.fn()} onBack={vi.fn()} />)
    expect(screen.getByRole('button', { name: t('unclearSign.logWithoutSign') })).toBeTruthy()
    expect(screen.queryByRole('button', { name: t('workday.card.end') })).toBeNull()
  })
})

describe('WorkdayStart', () => {
  const env = (over: Partial<ReadinessEnv> = {}) => () => ({
    iosBrowserTab: false,
    pushSupported: true,
    permission: 'granted' as NotificationPermission,
    pushTurnedOff: false,
    ...over,
  })

  it('QLD passes the gate; Start hands App the jurisdiction from the fix', async () => {
    const onStart = vi.fn()
    render(
      <WorkdayStart
        activeRecord={null}
        firstWorkday
        onStart={onStart}
        onBack={vi.fn()}
        locate={okFix}
        lookup={async () => ({ address: 'Queen St', road: 'Queen St', suburb: 'Brisbane City', state_code: 'AU-QLD' })}
        readinessEnv={env()}
      />,
    )
    // Before the gate settles there is no Start button.
    expect(screen.queryByRole('button', { name: t('workday.start.button') })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: t('workday.start.button') }))
    expect(onStart).toHaveBeenCalledWith({ jurisdiction: 'QLD', firstStopId: null })
    // Push works here: no "need notifications" line.
    expect(screen.getByText(t('workday.ready.on'))).toBeTruthy()
    expect(screen.queryByText(t('workday.ready.cantDeliver'))).toBeNull()
  })

  it('a failed lookup never opens the gate', async () => {
    render(
      <WorkdayStart activeRecord={null} firstWorkday onStart={vi.fn()} onBack={vi.fn()} locate={okFix} lookup={async () => null} readinessEnv={env()} />,
    )
    expect(await screen.findByText(t('workday.start.unknown'))).toBeTruthy()
    expect(screen.queryByRole('button', { name: t('workday.start.button') })).toBeNull()
  })

  it('asks for notifications, then reads the permission again', async () => {
    let permission: NotificationPermission = 'default'
    const enable = vi.fn(async () => {
      permission = 'granted'
    })
    render(
      <WorkdayStart
        activeRecord={null}
        firstWorkday={false}
        onStart={vi.fn()}
        onBack={vi.fn()}
        locate={okFix}
        lookup={async () => ({ address: 'x', road: 'x', suburb: 'x', state_code: 'AU-VIC' })}
        readinessEnv={() => ({ iosBrowserTab: false, pushSupported: true, permission, pushTurnedOff: false })}
        enableNotifications={enable}
      />,
    )
    const allow = await screen.findByRole('button', { name: t('workday.ready.allow') })
    // Not allowed yet: nothing can reach the phone, so the spec's line shows (T6b item 2), with the way to fix it.
    expect(screen.getByText(t('workday.ready.cantDeliver'))).toBeTruthy()
    expect(screen.getByText(t('workday.ready.ask'))).toBeTruthy()
    fireEvent.click(allow)
    await screen.findByText(t('workday.ready.on'))
    expect(screen.queryByText(t('workday.ready.cantDeliver'))).toBeNull()
    expect(enable).toHaveBeenCalledTimes(1)
  })

  it('an iPhone browser tab: the spec line and the Home Screen step', async () => {
    render(
      <WorkdayStart
        activeRecord={null}
        firstWorkday={false}
        onStart={vi.fn()}
        onBack={vi.fn()}
        locate={okFix}
        lookup={async () => ({ address: 'x', road: 'x', suburb: 'x', state_code: 'AU-VIC' })}
        readinessEnv={env({ iosBrowserTab: true })}
      />,
    )
    expect(await screen.findByText(t('workday.ready.cantDeliver'))).toBeTruthy()
    expect(screen.getByText(t('workday.ready.iosInstall'))).toBeTruthy()
  })
})

describe('WorkdayView', () => {
  it('lists the stops in order, notes a first stop tagged from an earlier park, and offers End while active', () => {
    const workday = startWorkday({ jurisdiction: 'VIC', current_session_id: 'l1' })
    saveSession(record('l0', { workday_id: workday.id, leg_index: 0, ended_at: new Date().toISOString(), location: { ...HERE, address: '1 First St' } }))
    saveSession(
      record('l1', {
        workday_id: workday.id,
        leg_index: 1,
        location: { ...HERE, address: '2 Second St' },
        addenda: [
          {
            id: 'a1',
            seq: 1,
            kind: 'arrival_context',
            captured_at: new Date().toISOString(),
            data: { workday: { workday_id: workday.id, leg_index: 1, stretch_deadline: null, previous_departure_payload_sha256: null } },
          },
        ],
      }),
    )
    const onEnd = vi.fn()
    const onOpenStop = vi.fn()
    render(<WorkdayView workdayId={workday.id} onBack={vi.fn()} backLabelKey="common.backToHome" onOpenStop={onOpenStop} onEnd={onEnd} />)
    const stops = screen.getAllByRole('listitem')
    expect(stops.map((li) => li.textContent?.includes('1 First St') ? 'first' : 'second')).toEqual(['first', 'second'])
    // Leg 0 was never signed with the workday link; leg 1 was.
    expect(stops[0].textContent).toContain(t('workday.view.tagged'))
    expect(stops[1].textContent).not.toContain(t('workday.view.tagged'))
    fireEvent.click(screen.getByRole('button', { name: /2 Second St/ }))
    expect(onOpenStop).toHaveBeenCalledWith(expect.objectContaining({ id: 'l1' }))
    fireEvent.click(screen.getByRole('button', { name: t('workday.card.end') }))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })
  it("says when the workday started only from its own state, never from a first stop's earlier arrival", () => {
    const W = '0f0e0d0c-2222-4222-8222-222222222222'
    // Stops pulled from the cloud: no workday state on this device. Stop 1 was an earlier park.
    saveSession(record('c0', { workday_id: W, leg_index: 0, arrived_at: new Date(Date.now() - 3 * 3_600_000).toISOString() }))
    const { unmount } = render(<WorkdayView workdayId={W} onBack={vi.fn()} backLabelKey="common.backToHistory" onOpenStop={vi.fn()} />)
    expect(screen.queryByText(/^Started /)).toBeNull()
    expect(screen.getByText(t('workday.status.active'))).toBeTruthy()
    unmount()

    // With the state here, its own start time.
    const workday = startWorkday({ jurisdiction: 'VIC', current_session_id: 'c1' })
    saveSession(record('c1', { workday_id: workday.id, leg_index: 0 }))
    render(<WorkdayView workdayId={workday.id} onBack={vi.fn()} backLabelKey="common.backToHistory" onOpenStop={vi.fn()} />)
    expect(screen.getByText(/^Started .+ \(phone clock\)$/)).toBeTruthy()
  })
})
