// @vitest-environment happy-dom
//
// The scanner's re-check offers (the proximity "reuse this read" card and
// the recent-scans picker) never offer a read-only shared copy (T7 item 4):
// it is someone else's sign reading, and re-checking it would make it look
// like the driver's own. The driver's own fresh record nearby is offered,
// which shows each check could fire.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from '../lib/photo-store'
import { saveSession } from '../lib/storage'
import type { ParkingSession } from '../types'
import en from '../locales/en.json'
import SignScanner from './SignScanner'

const HERE = { lat: -37.8136, lng: 144.9631 }

function record(over: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'own-1',
    arrived_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    location: { ...HERE, address: '12 King St, Melbourne' },
    sign_photo: 'data:image/jpeg;base64,' + btoa('sign'),
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: new Date(Date.now() + 115 * 60_000).toISOString(),
    confidence: 'high',
    ...over,
  }
}

const copy = () =>
  record({
    id: 'copy-1',
    rules: '1P',
    location: { ...HERE, address: '14 King St, Melbourne' },
    shared_from: {
      original_session_id: 'theirs-1',
      received_at: new Date().toISOString(),
      shared_at: new Date().toISOString(),
      arrival_bundle: null,
      snapshot: {},
    },
  })

function stubLocation(state: 'granted' | 'denied') {
  Object.defineProperty(navigator, 'permissions', {
    value: { query: vi.fn(async () => ({ state })) },
    configurable: true,
  })
  Object.defineProperty(navigator, 'geolocation', {
    value: {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: HERE.lat, longitude: HERE.lng, accuracy: 10 } } as GeolocationPosition),
    },
    configurable: true,
  })
}

function renderScanner() {
  render(<SignScanner onCapture={vi.fn()} onReuseSession={vi.fn()} onNoSignScan={vi.fn()} onCancel={vi.fn()} />)
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  localStorage.clear()
  setPhotoBackendForTests(createMemoryPhotoBackend())
})
afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
})

describe('the scanner never offers a shared copy for a re-check', () => {
  it('the proximity card: a fresh shared copy right here is not offered, the own record is', async () => {
    stubLocation('granted')
    saveSession(copy())
    renderScanner()
    // The GPS check settles (the picker would show next if there were any own record).
    await waitFor(() => expect(navigator.permissions.query).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText(en.reuse.matchCopy)).toBeNull()
    expect(screen.queryByText(en.reuse.pickerHeader)).toBeNull()
    cleanup()

    saveSession(record())
    renderScanner()
    expect(await screen.findByText(en.reuse.matchCopy)).toBeTruthy()
    expect(screen.queryByText(/14 King St/)).toBeNull()
  })

  it('the recent-scans picker: lists the own record only', async () => {
    stubLocation('denied')
    saveSession(copy())
    saveSession(record())
    renderScanner()
    expect(await screen.findByText(en.reuse.pickerHeader)).toBeTruthy()
    expect(screen.getByText(/12 King St/)).toBeTruthy()
    expect(screen.queryByText(/14 King St/)).toBeNull()
  })
})
