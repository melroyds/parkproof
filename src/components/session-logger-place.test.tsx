// @vitest-environment happy-dom
//
// SessionLogger saves `place` and `jurisdiction` at capture (build spec T6a
// item 2). The place is the raw reverse-geocode parts of the GPS fix, and the
// jurisdiction is read from its state code alone. A typed address leaves both
// unknown.
// Workday mode decides per leg from that value, so a place from the wrong
// fix, or a jurisdiction from anywhere else, would gate it wrongly.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from '../lib/photo-store'
import type { ReverseGeocodeDetails, ForwardGeocodeResult } from '../lib/geocode'
import type { ParkingRules, ParkingSession } from '../types'
import SessionLogger from './SessionLogger'

const geo = vi.hoisted(() => ({
  reverse: vi.fn<(lat: number, lng: number) => Promise<ReverseGeocodeDetails | null>>(),
  forward: vi.fn<(q: string) => Promise<ForwardGeocodeResult | null>>(),
}))
vi.mock('../lib/geocode', () => ({
  reverseGeocodeDetails: geo.reverse,
  forwardGeocode: geo.forward,
}))

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

const CARLTON: ReverseGeocodeDetails = {
  address: '123 Lygon Street, Carlton Victoria',
  road: 'Lygon Street',
  suburb: 'Carlton',
  state_code: 'AU-VIC',
}

/** Answer the logger's GPS request with this fix. */
function gpsAnswers(accuracy: number, lat = -37.7983, lng = 144.9671) {
  Object.defineProperty(navigator, 'geolocation', {
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition),
    },
    configurable: true,
  })
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  setPhotoBackendForTests(createMemoryPhotoBackend())
  geo.reverse.mockReset()
  geo.forward.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
})

function renderLogger(mode: 'sign' | 'no-sign' = 'sign') {
  const onComplete = vi.fn<(s: ParkingSession) => void>()
  render(
    <SessionLogger
      rules={mode === 'sign' ? RULES : null}
      signPhoto={mode === 'sign' ? SIGN : null}
      mode={mode}
      onComplete={onComplete}
      onCancel={() => {}}
    />,
  )
  return onComplete
}

async function saveAndGet(onComplete: ReturnType<typeof renderLogger>): Promise<ParkingSession> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.saveSession') }))
  })
  await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
  return onComplete.mock.calls[0][0]
}

describe('SessionLogger saves the place and jurisdiction', () => {
  it('saves the GPS fix\'s place and reads VIC from its state code', async () => {
    gpsAnswers(12)
    geo.reverse.mockResolvedValue(CARLTON)
    const onComplete = renderLogger()
    await screen.findByText(/123 Lygon Street, Carlton Victoria/)
    const saved = await saveAndGet(onComplete)
    expect(geo.reverse).toHaveBeenCalledWith(-37.7983, 144.9671)
    expect(saved.place).toEqual({ road: 'Lygon Street', suburb: 'Carlton', state_code: 'AU-VIC' })
    expect(saved.jurisdiction).toBe('VIC')
    expect(saved.location?.address).toBe(CARLTON.address)
  })

  it('a no-sign record gets its place too', async () => {
    gpsAnswers(12, -27.4705, 153.026)
    geo.reverse.mockResolvedValue({ address: 'Queen Street, Brisbane City Queensland', road: 'Queen Street', suburb: 'Brisbane City', state_code: 'AU-QLD' })
    const onComplete = renderLogger('no-sign')
    await screen.findByText(/Queen Street, Brisbane City Queensland/)
    const saved = await saveAndGet(onComplete)
    expect(saved.no_sign).toBe(true)
    expect(saved.place?.state_code).toBe('AU-QLD')
    expect(saved.jurisdiction).toBe('QLD')
  })

  it('a place without a state code saves a null jurisdiction, never a guess', async () => {
    gpsAnswers(12)
    geo.reverse.mockResolvedValue({ ...CARLTON, state_code: null })
    const onComplete = renderLogger()
    await screen.findByText(/123 Lygon Street/)
    const saved = await saveAndGet(onComplete)
    expect(saved.place).toEqual({ road: 'Lygon Street', suburb: 'Carlton', state_code: null })
    expect(saved.jurisdiction).toBeNull()
  })

  it('a failed lookup saves neither field', async () => {
    gpsAnswers(12)
    geo.reverse.mockResolvedValue(null)
    const onComplete = renderLogger()
    await waitFor(() => expect(geo.reverse).toHaveBeenCalled())
    const saved = await saveAndGet(onComplete)
    expect('place' in saved).toBe(false)
    expect('jurisdiction' in saved).toBe(false)
  })

  it('a fix worse than 100 m is not looked up, so it saves neither field', async () => {
    gpsAnswers(250)
    const onComplete = renderLogger()
    await screen.findByText(/±250m/)
    const saved = await saveAndGet(onComplete)
    expect(geo.reverse).not.toHaveBeenCalled()
    expect(saved.place).toBeUndefined()
    expect(saved.jurisdiction).toBeUndefined()
  })

  it('saving before the lookup answers saves neither field', async () => {
    gpsAnswers(12)
    geo.reverse.mockReturnValue(new Promise(() => {}))
    const onComplete = renderLogger()
    await waitFor(() => expect(geo.reverse).toHaveBeenCalled())
    const saved = await saveAndGet(onComplete)
    expect(saved.place).toBeUndefined()
    expect(saved.jurisdiction).toBeUndefined()
  })

  const typeAddress = async (text: string, button = i18n.t('common.edit')) => {
    fireEvent.click(screen.getByRole('button', { name: button }))
    fireEvent.change(screen.getByLabelText(i18n.t('logger.addressPlaceholder')), { target: { value: text } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.update') }))
    })
  }

  // A forward lookup of typed text can land in another state (Nominatim's
  // first "High St" may be in Wodonga for a driver in Albury). The record's
  // jurisdiction gates workday mode, so typed text must never supply it.
  it('a typed address saves no place and no jurisdiction, even when the GPS lookup answers late', async () => {
    gpsAnswers(12)
    let answerGps: (d: ReverseGeocodeDetails) => void = () => {}
    geo.reverse.mockReturnValue(new Promise((resolve) => (answerGps = resolve)))
    geo.forward.mockResolvedValue({ lat: -36.1216, lng: 146.8881, address: 'High Street, Wodonga Victoria' })
    const onComplete = renderLogger()
    await waitFor(() => expect(geo.reverse).toHaveBeenCalled())

    await typeAddress('High St')
    await screen.findByText(/High Street, Wodonga Victoria/)

    // The first fix's lookup lands after the typed address replaced it.
    await act(async () => {
      answerGps(CARLTON)
    })
    expect(screen.queryByText(/123 Lygon Street/)).toBeNull()

    const saved = await saveAndGet(onComplete)
    expect(saved.location).toMatchObject({ source: 'manual', address: 'High Street, Wodonga Victoria' })
    expect(saved.place).toBeUndefined()
    expect(saved.jurisdiction).toBeUndefined()
  })

  it('typing over a looked-up GPS address drops the fix\'s place and jurisdiction too', async () => {
    gpsAnswers(12)
    geo.reverse.mockResolvedValue(CARLTON)
    geo.forward.mockResolvedValue({ lat: -37.7985, lng: 144.9668, address: '125 Lygon Street, Carlton Victoria' })
    const onComplete = renderLogger()
    await screen.findByText(/123 Lygon Street, Carlton Victoria/)

    await typeAddress('125 Lygon St Carlton')
    await screen.findByText(/125 Lygon Street, Carlton Victoria/)

    const saved = await saveAndGet(onComplete)
    expect(saved.location).toMatchObject({ source: 'manual', lat: -37.7985, lng: 144.9668 })
    expect(saved.place).toBeUndefined()
    expect(saved.jurisdiction).toBeUndefined()
  })

  it('a fix with no usable GPS and a typed address saves no jurisdiction', async () => {
    gpsAnswers(250)
    geo.forward.mockResolvedValue({ lat: -36.1216, lng: 146.8881, address: 'High Street, Wodonga Victoria' })
    const onComplete = renderLogger()
    await screen.findByText(/±250m/)

    await typeAddress('High St', i18n.t('logger.enterAddress'))
    await screen.findByText(/High Street, Wodonga Victoria/)

    const saved = await saveAndGet(onComplete)
    expect(saved.location?.source).toBe('manual')
    expect(geo.reverse).not.toHaveBeenCalled()
    expect(saved.place).toBeUndefined()
    expect(saved.jurisdiction).toBeUndefined()
  })
})
