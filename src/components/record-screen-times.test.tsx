// @vitest-environment happy-dom
//
// The record screen says which record it is (field-test fix list, item 6):
// the arrival day and time near the top, and "Ended 5:23 pm AEDT" on the
// status line, both in the record's own zone (not the device's). An open
// screen picks up an end that a cloud merge brings in, without leaving it.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { mergeCloudEvidence, saveSession } from '../lib/storage'
import { RECORD_STATUS_ID } from '../lib/focus-targets'
import type { ParkingSession } from '../types'
import SessionDetail from './SessionDetail'

// The record screen warms the PDF chunk on mount; keep jsPDF out of the test.
vi.mock('../lib/pdf', () => ({
  materializeRemotePhotos: async (s: ParkingSession) => s,
  downloadPdf: () => {},
}))
vi.mock('../lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))

const AUTH: AuthContextValue = {
  user: null,
  loading: false,
  configured: false,
  refresh: async () => {},
  signOut: () => {},
}

function withAuth(children: ReactNode) {
  return <AuthContext.Provider value={AUTH}>{children}</AuthContext.Provider>
}

const MELBOURNE = { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne VIC' }
const PERTH = { lat: -31.9523, lng: 115.8613, address: '1 Hay St, Perth WA' }

// Test D: 4e53e51d arrived 5:08:11 pm and ended 5:23:23 pm AEDT.
function testD(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: '4e53e51d-0000-4000-8000-000000000001',
    arrived_at: '2026-11-08T06:08:11.000Z',
    ended_at: '2026-11-08T06:23:23.000Z',
    location: MELBOURNE,
    sign_photo: null,
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: '2026-11-08T08:08:11.000Z',
    confidence: 'high',
    ...overrides,
  }
}

function renderDetail(session: ParkingSession) {
  return render(
    withAuth(
      <SessionDetail
        session={session}
        onBack={() => {}}
        onDelete={() => {}}
        onDraftAppeal={() => {}}
        onEndSession={() => {}}
      />,
    ),
  )
}

const statusText = () => document.getElementById(RECORD_STATUS_ID)?.textContent ?? ''

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('the record screen names its record (fix list item 6)', () => {
  it('shows the arrival day and time near the top, and the I\'ve left tap time on the status line', () => {
    const session = testD()
    saveSession(session)
    renderDetail(session)
    expect(screen.getByText('Logged Sun 8 Nov 2026, 5:08 pm AEDT (phone clock)')).toBeTruthy()
    expect(statusText()).toBe('Ended 5:23 pm AEDT')
    // The departure row below still labels the same time as the phone's tap.
    expect(screen.getByText(/You tapped I've left at Sun 8 Nov, 5:23 pm AEDT \(phone clock\)/)).toBeTruthy()
  })

  it('tells two records from the same afternoon apart', () => {
    const earlier = testD({
      id: 'e11bc03b-0000-4000-8000-000000000002',
      arrived_at: '2026-11-08T06:02:47.000Z',
      ended_at: '2026-11-08T06:03:02.000Z',
    })
    saveSession(earlier)
    renderDetail(earlier)
    expect(screen.getByText('Logged Sun 8 Nov 2026, 5:02 pm AEDT (phone clock)')).toBeTruthy()
    expect(statusText()).toBe('Ended 5:03 pm AEDT')
  })

  it("uses the record's own zone when it differs from the device's", () => {
    const session = testD({ location: PERTH })
    saveSession(session)
    renderDetail(session)
    expect(screen.getByText('Logged Sun 8 Nov 2026, 2:08 pm AWST (phone clock)')).toBeTruthy()
    expect(statusText()).toBe('Ended 2:23 pm AWST')
    // Not the device's reading of the same instants (when the device isn't in Perth).
    const deviceTime = new Date(session.ended_at as string).toLocaleTimeString('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
    })
    if (deviceTime !== '2:23 pm') expect(statusText()).not.toContain(deviceTime)
  })

  it('adds the day when the record ended on a later day than it arrived', () => {
    const session = testD({ ended_at: '2026-11-08T22:05:00.000Z' })
    saveSession(session)
    renderDetail(session)
    expect(statusText()).toBe('Ended Mon 9 Nov, 9:05 am AEDT')
  })

  it('an open screen shows the end as soon as a cloud merge stores it', () => {
    const local = testD({ ended_at: undefined, expires_at: '2099-01-01T00:00:00.000Z' })
    saveSession(local)
    renderDetail(local)
    expect(statusText()).not.toMatch(/^Ended/)

    act(() => {
      mergeCloudEvidence(local.id, { ...local, ended_at: '2026-11-08T06:23:23.000Z' })
    })
    expect(statusText()).toBe('Ended 5:23 pm AEDT')
  })
})
