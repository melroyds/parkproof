// @vitest-environment happy-dom
//
// The notice view in App's state machine (build spec T8 items 5 and 6):
// the home "Got a fine? Start here" link opens it; "Draft an appeal with
// this record" opens the appeal flow with the stored copy of the record and
// the notice photo (so it skips capture), labelled to go back; "Draft an
// appeal anyway" opens it without a record; and Back from the appeal flow
// returns to the notice screen with what it had read, not to capture.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from './lib/i18n'
import { AuthContext, type AuthContextValue } from './lib/auth-context-shape'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from './lib/photo-store'
import { saveSession } from './lib/storage'
import type { ParkingSession } from './types'
import type { NoticeSnapshot } from './lib/notice-read'
import App from './App'

const { SNAPSHOT, noticeProps, appealProps } = vi.hoisted(() => ({
  SNAPSHOT: {
    photo: { dataUrl: 'data:image/jpeg;base64,Tk9USUNF', mediaType: 'image/jpeg' },
    fields: {
      legibility: 'clear',
      notice_number: 'PIN 1',
      issuing_authority: 'City of Melbourne',
      offence_date_raw: '25/10/2026',
      offence_time_raw: '2:10 PM',
      offence_datetime_local: '2026-10-25T14:10',
      location_text: 'King St, Melbourne VIC 3000',
      offence_code: null,
      offence_description: null,
      amount: null,
      due_date: null,
    },
    date: '2026-10-25',
    time: '14:10',
    noticePoint: null,
    issuingState: 'VIC',
    selectedId: 'rec-1',
  } as NoticeSnapshot,
  noticeProps: [] as Array<Record<string, unknown>>,
  appealProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('./lib/signing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/signing')>()),
  runSigningSweep: vi.fn(),
  installSigningTriggers: vi.fn(() => () => {}),
  setSignedRecordListener: vi.fn(),
}))
vi.mock('./lib/federated-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/federated-auth')>()),
  handleCallback: vi.fn(async () => false),
}))
vi.mock('./components/LandingFeatures', () => ({ default: () => <p>Fake landing</p> }))
vi.mock('./components/NoticeLookup', () => ({
  default: (p: {
    initial: NoticeSnapshot | null
    onBack: () => void
    onDraftAppeal: (session: ParkingSession | null, snapshot: NoticeSnapshot) => void
  }) => {
    noticeProps.push(p as unknown as Record<string, unknown>)
    // A stale copy of the record, as the screen drew it before it was signed.
    const stale = { id: 'rec-1', rules: 'stale copy' } as ParkingSession
    return (
      <div>
        <p>Fake notice {p.initial ? 'read' : 'empty'}</p>
        <button onClick={() => p.onDraftAppeal(stale, SNAPSHOT)}>Fake draft with record</button>
        <button onClick={() => p.onDraftAppeal(null, SNAPSHOT)}>Fake draft anyway</button>
        <button onClick={p.onBack}>Fake notice back</button>
      </div>
    )
  },
}))
vi.mock('./components/AppealFlow', () => ({
  default: (p: { session: ParkingSession | null; onBack: () => void }) => {
    appealProps.push(p as unknown as Record<string, unknown>)
    return (
      <div>
        <p>Fake appeal {p.session ? p.session.rules : 'no record'}</p>
        <button onClick={p.onBack}>Fake appeal back</button>
      </div>
    )
  },
}))

const AUTH: AuthContextValue = { user: null, loading: false, configured: false, refresh: async () => {}, signOut: () => {} }

function renderApp() {
  return render(
    <AuthContext.Provider value={AUTH}>
      <App />
    </AuthContext.Provider>,
  )
}

const STORED: ParkingSession = {
  id: 'rec-1',
  arrived_at: '2026-10-25T01:31:20.000Z',
  location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
  sign_photo: null,
  car_photo: null,
  rules: 'stored copy',
  observations: [],
  expires_at: '2026-10-25T03:31:20.000Z',
  confidence: 'high',
  ended_at: '2026-10-25T02:55:40.000Z',
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/app/')
  setPhotoBackendForTests(createMemoryPhotoBackend())
  noticeProps.length = 0
  appealProps.length = 0
})
afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
})

const openNotice = () => fireEvent.click(screen.getByRole('button', { name: i18n.t('notice.homeLink') }))

describe('App: the notice view', () => {
  it('the home link opens an empty notice screen, and its Back returns home', () => {
    renderApp()
    openNotice()
    expect(screen.getByText('Fake notice empty')).toBeTruthy()
    expect(noticeProps.at(-1)?.initial).toBeNull()
    fireEvent.click(screen.getByText('Fake notice back'))
    expect(screen.getByRole('button', { name: i18n.t('notice.homeLink') })).toBeTruthy()
  })

  it('the home link is there for a returning driver too', () => {
    saveSession(STORED)
    renderApp()
    openNotice()
    expect(screen.getByText('Fake notice empty')).toBeTruthy()
  })

  it('"Draft an appeal with this record": the stored record, the notice photo, a Back label, and Back to the read notice', () => {
    saveSession(STORED)
    renderApp()
    openNotice()
    fireEvent.click(screen.getByText('Fake draft with record'))
    expect(screen.getByText('Fake appeal stored copy')).toBeTruthy()
    const props = appealProps.at(-1)!
    expect(props.initialNotice).toEqual(SNAPSHOT.photo)
    expect(props.backLabelKey).toBe('common.back')

    fireEvent.click(screen.getByText('Fake appeal back'))
    // Back on the notice screen with what it had read: no second reading.
    expect(screen.getByText('Fake notice read')).toBeTruthy()
    expect(noticeProps.at(-1)?.initial).toEqual(SNAPSHOT)
  })

  it('"Draft an appeal anyway": no record, still the notice photo', () => {
    renderApp()
    openNotice()
    fireEvent.click(screen.getByText('Fake draft anyway'))
    expect(screen.getByText('Fake appeal no record')).toBeTruthy()
    expect(appealProps.at(-1)?.initialNotice).toEqual(SNAPSHOT.photo)
    fireEvent.click(screen.getByText('Fake appeal back'))
    expect(screen.getByText('Fake notice read')).toBeTruthy()
  })

  // T4's home layout: with the notice lookup wired, "Got a fine? Start here"
  // takes the place of the old standalone "Got a ticket? Draft an appeal"
  // link, and is the way in to an appeal with no record ("Draft an appeal
  // anyway"). Back from that appeal returns to the notice, and from there home.
  it('the fine link replaces the standalone appeal link as the way in to an appeal, and Back leads home', () => {
    renderApp()
    expect(screen.queryByRole('button', { name: i18n.t('home.draftAppeal') })).toBeNull()
    openNotice()
    fireEvent.click(screen.getByText('Fake draft anyway'))
    const props = appealProps.at(-1)!
    expect(props.session).toBeNull()
    expect(props.initialNotice).toEqual(SNAPSHOT.photo)
    expect(props.backLabelKey).toBe('common.back')
    fireEvent.click(screen.getByText('Fake appeal back'))
    fireEvent.click(screen.getByText('Fake notice back'))
    expect(screen.getByRole('button', { name: i18n.t('notice.homeLink') })).toBeTruthy()
  })
})
