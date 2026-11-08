// @vitest-environment happy-dom
//
// A workday stop's Save waits a little for the place lookup still in flight
// (build spec T6b item 7). The stop's state comes from that lookup alone,
// and a stop with no known state is saved as a normal record and ends the
// workday, so a driver who taps Save a second after the fix would otherwise
// lose the workday for nothing. The arrival time stays the tap. Other
// records save at once, as before (session-logger-place.test.tsx).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from '../lib/photo-store'
import type { ReverseGeocodeDetails } from '../lib/geocode'
import type { LogDraft, ParkingRules, ParkingSession } from '../types'
import SessionLogger, { WORKDAY_PLACE_WAIT_MS } from './SessionLogger'

const geo = vi.hoisted(() => ({ reverse: vi.fn<(lat: number, lng: number) => Promise<ReverseGeocodeDetails | null>>() }))
vi.mock('../lib/geocode', () => ({ reverseGeocodeDetails: geo.reverse, forwardGeocode: vi.fn() }))

const RULES: ParkingRules = {
  rules: '2P Mon-Fri 8am-6pm',
  observations: [],
  can_park_now: true,
  until: '2026-11-09T02:00:00.000Z',
  duration_minutes: 120,
  confidence: 'high',
  clarification: null,
}
const SIGN = 'data:image/jpeg;base64,' + btoa('scan-sign-bytes')
const CARLTON: ReverseGeocodeDetails = { address: '123 Lygon Street, Carlton Victoria', road: 'Lygon Street', suburb: 'Carlton', state_code: 'AU-VIC' }

function draft(workday: LogDraft['workday']): LogDraft {
  return {
    gate_acks: { meter_ticket: null, permit_zone: null, accessible_permit: null },
    permit_context: null,
    workday,
    driver_name: null,
  }
}
const STOP = { workday_id: 'aaaaaaaa-1111-4111-8111-111111111111', leg_index: 1, previous_session_id: 'l0' }

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  setPhotoBackendForTests(createMemoryPhotoBackend())
  geo.reverse.mockReset()
  Object.defineProperty(navigator, 'geolocation', {
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: -37.7983, longitude: 144.9671, accuracy: 12 } } as GeolocationPosition),
    },
    configurable: true,
  })
})
afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
  vi.useRealTimers()
})

function renderLogger(d: LogDraft) {
  const onComplete = vi.fn<(s: ParkingSession) => void>()
  render(<SessionLogger rules={RULES} signPhoto={SIGN} draft={d} onComplete={onComplete} onCancel={() => {}} />)
  return onComplete
}

describe('a workday stop waits for its place before it saves', () => {
  it('saves the place that answers after the tap, with the tap as the arrival time', async () => {
    let answer: (d: ReverseGeocodeDetails) => void = () => {}
    geo.reverse.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const onComplete = renderLogger(draft(STOP))
    await waitFor(() => expect(geo.reverse).toHaveBeenCalled())

    const tapped = Date.now()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.saveSession') }))
    })
    // Still waiting for the lookup.
    expect(onComplete).not.toHaveBeenCalled()
    await act(async () => {
      answer(CARLTON)
    })
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const saved = onComplete.mock.calls[0][0]
    expect(saved.place).toEqual({ road: 'Lygon Street', suburb: 'Carlton', state_code: 'AU-VIC' })
    expect(saved.jurisdiction).toBe('VIC')
    expect(Date.parse(saved.arrived_at)).toBeLessThanOrEqual(tapped + 50)
  })

  it(`gives up after ${WORKDAY_PLACE_WAIT_MS} ms and saves with no place (the workday then stops)`, async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    geo.reverse.mockReturnValue(new Promise(() => {}))
    const onComplete = renderLogger(draft(STOP))
    await waitFor(() => expect(geo.reverse).toHaveBeenCalled())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.saveSession') }))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORKDAY_PLACE_WAIT_MS - 500)
    })
    expect(onComplete).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete.mock.calls[0][0].place).toBeUndefined()
  })

  it('an ordinary record never waits', async () => {
    geo.reverse.mockReturnValue(new Promise(() => {}))
    const onComplete = renderLogger(draft(null))
    await waitFor(() => expect(geo.reverse).toHaveBeenCalled())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.saveSession') }))
    })
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete.mock.calls[0][0].place).toBeUndefined()
  })
})
