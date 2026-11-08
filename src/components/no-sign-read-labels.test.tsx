// @vitest-environment happy-dom
//
// A record logged from the "no readable sign" screen (build spec T3 item 6)
// is not a spot with no rules: ParkProof only found no readable parking
// sign in the photo ("That doesn't mean there are no rules here"). So the
// places that call an ordinary no-sign record "No posted restrictions" say
// "No sign read" for it instead: the home card, the active records list,
// History, the record screen's heading and the remind screen's intro. An
// ordinary no-sign record keeps its wording.
//
// Also the "no readable sign" screen's Back link uses the vault's muted
// sage with a light hover, as the other vault screens do (never mint, which
// is for the verified seal and active states).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { saveSession } from '../lib/storage'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from '../lib/photo-store'
import type { ParkingRules, ParkingSession } from '../types'
import ActiveSessionCard from './ActiveSessionCard'
import ActiveSessionsList from './ActiveSessionsList'
import NoReadableSign from './NoReadableSign'
import ReminderOptions from './ReminderOptions'
import SessionDetail from './SessionDetail'
import SessionHistory from './SessionHistory'

// The record screen warms the PDF chunk on mount; keep jsPDF out of the test.
vi.mock('../lib/pdf', () => ({
  materializeRemotePhotos: async (s: ParkingSession) => s,
  downloadPdf: () => {},
}))
vi.mock('../lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))
vi.mock('../lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/push')>()),
  getPushPermissionState: () => 'default',
  hasActiveSubscription: async () => false,
}))

const AUTH: AuthContextValue = { user: null, loading: false, configured: false, refresh: async () => {}, signOut: () => {} }
const withAuth = (children: ReactNode) => <AuthContext.Provider value={AUTH}>{children}</AuthContext.Provider>

const NO_SIGN_READ = 'No sign read'

function noSignRecord(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-no-sign',
    arrived_at: new Date(Date.now() - 20 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne VIC' },
    sign_photo: null,
    car_photo: null,
    rules: '',
    observations: [],
    expires_at: null,
    confidence: 'low',
    no_sign: true,
    ...overrides,
  }
}

/** Logged from the "no readable sign" screen: ParkProof found no readable sign in the photo. */
const unread = (status: 'missing' | 'not_a_parking_sign' = 'not_a_parking_sign') =>
  noSignRecord({ id: `rec-unread-${status}`, sign_status: status, sign_issues: ['A shop sign'] })

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

describe('"No sign read" instead of "No posted restrictions"', () => {
  const posted = () => i18n.t('active.noPostedRestrictions')

  it('the home card', () => {
    render(<ActiveSessionCard session={unread()} extraCount={0} onOpen={() => {}} />)
    expect(screen.getByText(NO_SIGN_READ)).toBeTruthy()
    expect(screen.queryByText(posted())).toBeNull()
    cleanup()
    render(<ActiveSessionCard session={noSignRecord()} extraCount={0} onOpen={() => {}} />)
    expect(screen.getByText(posted())).toBeTruthy()
    expect(screen.queryByText(NO_SIGN_READ)).toBeNull()
  })

  it('the active records list', () => {
    render(<ActiveSessionsList sessions={[unread('missing'), noSignRecord()]} onBack={() => {}} onOpen={() => {}} />)
    expect(screen.getAllByText(NO_SIGN_READ)).toHaveLength(1)
    expect(screen.getAllByText(posted())).toHaveLength(1)
  })

  it('the History row', () => {
    saveSession(unread())
    saveSession(noSignRecord({ arrived_at: new Date(Date.now() - 60 * 60_000).toISOString() }))
    render(<SessionHistory onBack={() => {}} onOpen={() => {}} />)
    expect(screen.getAllByText(NO_SIGN_READ)).toHaveLength(1)
    expect(screen.getAllByText(i18n.t('history.noSignBadge'))).toHaveLength(1)
  })

  it("the record screen's heading, above the record's own line", () => {
    const record = unread()
    saveSession(record)
    render(withAuth(<SessionDetail session={record} onBack={() => {}} onDelete={() => {}} onDraftAppeal={() => {}} onEndSession={() => {}} />))
    expect(screen.getByRole('heading', { name: NO_SIGN_READ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: i18n.t('session.noSignLabel') })).toBeNull()
    expect(screen.getAllByText(i18n.t('unclearSign.recordNoSignRead')).length).toBeGreaterThan(0)
  })

  it('the ordinary no-sign record keeps its heading', () => {
    const record = noSignRecord()
    saveSession(record)
    render(withAuth(<SessionDetail session={record} onBack={() => {}} onDelete={() => {}} onDraftAppeal={() => {}} onEndSession={() => {}} />))
    expect(screen.getByRole('heading', { name: i18n.t('session.noSignLabel') })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: NO_SIGN_READ })).toBeNull()
  })

  it("the remind screen's intro", () => {
    render(withAuth(<ReminderOptions session={unread()} onDone={() => {}} />))
    expect(screen.getByText(i18n.t('unclearSign.remindIntro'))).toBeTruthy()
    expect(screen.queryByText(i18n.t('reminders.noSign.intro'))).toBeNull()
    expect(i18n.t('unclearSign.remindIntro')).not.toMatch(/No posted/)
    cleanup()
    render(withAuth(<ReminderOptions session={noSignRecord()} onDone={() => {}} />))
    expect(screen.getByText(i18n.t('reminders.noSign.intro'))).toBeTruthy()
  })
})

describe('NoReadableSign Back link', () => {
  it('uses the vault pattern: sage, lightening on hover, never mint', () => {
    const result: ParkingRules = {
      rules: '',
      observations: [],
      can_park_now: false,
      until: null,
      duration_minutes: null,
      confidence: 'low',
      clarification: null,
      sign_status: 'missing',
      sign_issues: [],
    }
    render(<NoReadableSign result={result} signPhoto="data:image/jpeg;base64,AA" onRetake={() => {}} onLogWithoutSign={() => {}} onBack={() => {}} />)
    const back = screen.getByRole('button', { name: i18n.t('common.back') })
    // BackButton owns its colour (fix list item 4): sage, paper-50 on hover.
    expect(back.className).toContain('text-[#A9CFBE]')
    expect(back.className).toContain('hover:text-paper-50')
    expect(back.className).not.toMatch(/7BE3A4/i)
  })
})
