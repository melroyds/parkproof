// @vitest-environment happy-dom
//
// One end-session path (T0a): the home card and the record screen only ASK
// App to end a record; neither writes storage, mirrors or cancels reminders
// itself. Also covers "ending after expiry": an expired record that hasn't
// been ended shows "Expired at ..." with "I've left" as the primary action,
// and the record screen offers "I've left" on any record without ended_at.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { getSession, saveSession, updateSession } from '../lib/storage'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from '../lib/photo-store'
import type { ParkingSession, SignatureBundle } from '../types'
import ActiveSessionCard from './ActiveSessionCard'
import SessionDetail from './SessionDetail'

// The record screen warms the PDF chunk on mount; keep jsPDF out of the test.
vi.mock('../lib/pdf', () => ({
  materializeRemotePhotos: async (s: ParkingSession) => s,
  downloadPdf: () => {},
}))
vi.mock('../lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))

const mocks = vi.hoisted(() => ({
  cancelPushReminders: vi.fn(async () => ({ ok: true as const, deleted: 0 })),
  cancelInTabReminders: vi.fn(() => 0),
}))
vi.mock('../lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/push')>()),
  cancelPushReminders: mocks.cancelPushReminders,
}))
vi.mock('../lib/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/notifications')>()),
  cancelInTabReminders: mocks.cancelInTabReminders,
}))

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

const SIGNATURE: SignatureBundle = {
  schema: 'parkproof-evidence-v1',
  signed_at: '2026-05-21T08:00:03.000Z',
  algorithm: 'ECDSA_SHA_256',
  key_alias: 'alias/parkproof-evidence-signing',
  canonical_payload: '{}',
  signature_base64: 'MEUCIQDexample',
}

function makeSession(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne VIC' },
    sign_photo: 'data:image/jpeg;base64,SIGN',
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: new Date(Date.now() + 90 * 60_000).toISOString(),
    confidence: 'high',
    ...overrides,
  }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

/** happy-dom has no window.confirm; install one that answers `answer`. */
function setConfirm(answer: boolean) {
  const confirm = vi.fn((message?: string) => {
    void message
    return answer
  })
  Object.defineProperty(window, 'confirm', {
    value: confirm,
    configurable: true,
    writable: true,
  })
  return confirm
}

let confirmMock: ReturnType<typeof setConfirm>

beforeEach(() => {
  localStorage.clear()
  confirmMock = setConfirm(true)
  mocks.cancelPushReminders.mockClear()
  mocks.cancelInTabReminders.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('ActiveSessionCard', () => {
  it('asks App to end the record and writes nothing itself', () => {
    const session = makeSession()
    saveSession(session)
    const onEndSession = vi.fn()
    render(<ActiveSessionCard session={session} extraCount={0} onOpen={() => {}} onEndSession={onEndSession} />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))

    expect(onEndSession).toHaveBeenCalledTimes(1)
    expect(onEndSession).toHaveBeenCalledWith(session)
    expect(getSession(session.id)?.ended_at).toBeUndefined()
  })

  it('does nothing when the driver cancels the confirm', () => {
    setConfirm(false)
    const onEndSession = vi.fn()
    render(<ActiveSessionCard session={makeSession()} extraCount={0} onOpen={() => {}} onEndSession={onEndSession} />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))
    expect(onEndSession).not.toHaveBeenCalled()
  })

  it('shows an expired, un-ended record as "Expired at" with I\'ve left as the primary action', () => {
    const session = makeSession({ expires_at: new Date(Date.now() - 20 * 60_000).toISOString() })
    const onEndSession = vi.fn()
    const onRecheck = vi.fn()
    render(
      <ActiveSessionCard
        session={session}
        extraCount={0}
        onOpen={() => {}}
        onEndSession={onEndSession}
        onRecheck={onRecheck}
      />,
    )

    expect(screen.getByText(/^Expired at /)).toBeTruthy()
    expect(screen.getByText(i18n.t('active.expiredHint'))).toBeTruthy()
    // Exactly one I've left control, and no re-check for a car that may not have moved.
    const leftButtons = screen.getAllByRole('button', { name: i18n.t('active.iveLeftAria') })
    expect(leftButtons).toHaveLength(1)
    expect(screen.queryByText(i18n.t('active.recheckNow'))).toBeNull()

    fireEvent.click(leftButtons[0])
    expect(onEndSession).toHaveBeenCalledWith(session)
    // A late tap: the confirm names the phone time that will be recorded.
    const asked = confirmMock.mock.calls[0][0] as string
    expect(asked).toMatch(/^Mark this record as ended now\? It will record /)
    expect(asked).toMatch(/won't show when the car actually left/)
  })

  it('keeps the expired big label to the time only (no date that would wrap)', () => {
    // 8 am Melbourne; expired at 10 pm the night before. The date goes on
    // its own line, not into the big slot.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-25T08:00:00+11:00'))
    try {
      const session = makeSession({
        arrived_at: '2026-10-24T20:00:00+11:00',
        expires_at: '2026-10-24T22:00:00+11:00',
      })
      render(<ActiveSessionCard session={session} extraCount={0} onOpen={() => {}} onEndSession={() => {}} />)
      const big = screen.getByText(/^Expired at /)
      expect(big.textContent).toBe('Expired at 10:00 pm')
      expect(screen.getByText(/24\/10\/2026/)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('an on-time tap asks with the phone-clock confirm', () => {
    render(<ActiveSessionCard session={makeSession()} extraCount={0} onOpen={() => {}} onEndSession={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('active.iveLeftAria') }))
    expect(confirmMock).toHaveBeenCalledWith(i18n.t('active.iveLeftConfirm'))
  })

  it("the I've left button's accessible name starts with its visible label", () => {
    render(<ActiveSessionCard session={makeSession()} extraCount={0} onOpen={() => {}} onEndSession={() => {}} />)
    const button = screen.getByRole('button', { name: i18n.t('active.iveLeftAria') })
    expect(i18n.t('active.iveLeftAria').startsWith(i18n.t('active.iveLeft'))).toBe(true)
    expect(button.textContent).toContain(i18n.t('active.iveLeft'))
  })

  it('translates the address fallback and the walk-back link name', () => {
    const session = makeSession({ location: { lat: -37.8136, lng: 144.9631 } })
    render(<ActiveSessionCard session={session} extraCount={0} onOpen={() => {}} />)
    expect(screen.getByRole('link', { name: i18n.t('active.walkBackAria') })).toBeTruthy()
    cleanup()
    render(<ActiveSessionCard session={makeSession({ location: null })} extraCount={0} onOpen={() => {}} />)
    expect(screen.getByText(i18n.t('active.lastLoggedSpot'))).toBeTruthy()
  })

  it('keeps the countdown and re-check for a record that has not expired', () => {
    render(
      <ActiveSessionCard
        session={makeSession()}
        extraCount={0}
        onOpen={() => {}}
        onEndSession={() => {}}
        onRecheck={() => {}}
      />,
    )
    expect(screen.queryByText(/^Expired at /)).toBeNull()
    expect(screen.getByText(i18n.t('active.recheckNow'))).toBeTruthy()
  })
})

describe('SessionDetail', () => {
  function renderDetail(session: ParkingSession, onEndSession = vi.fn()) {
    render(
      withAuth(
        <SessionDetail
          session={session}
          onBack={() => {}}
          onDelete={() => {}}
          onDraftAppeal={() => {}}
          onEndSession={onEndSession}
        />,
      ),
    )
    return onEndSession
  }

  it('offers I\'ve left on a record past its expiry, and only asks App to end it', () => {
    const session = makeSession({ expires_at: new Date(Date.now() - 2 * 3600_000).toISOString() })
    saveSession(session)
    const onEndSession = renderDetail(session)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('session.endSession') }))

    expect(onEndSession).toHaveBeenCalledTimes(1)
    expect(onEndSession).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }))
    // The screen didn't stamp ended_at itself: App.handleEndSession owns that.
    expect(getSession(session.id)?.ended_at).toBeUndefined()
    // Past expiry: the confirm names the tap time that will be stored.
    expect(confirmMock.mock.calls[0][0]).toMatch(/^Mark this record as ended now\? It will record /)
  })

  it('a weeks-old record gets the late confirm, naming today, not the record day', () => {
    const session = makeSession({
      arrived_at: new Date(Date.now() - 21 * 24 * 3600_000).toISOString(),
      expires_at: new Date(Date.now() - 21 * 24 * 3600_000 + 2 * 3600_000).toISOString(),
    })
    saveSession(session)
    renderDetail(session)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('session.endSession') }))
    const today = new Date().toLocaleString('en-AU', {
      timeZone: 'Australia/Melbourne',
      day: 'numeric',
      month: 'short',
    })
    expect(confirmMock.mock.calls[0][0]).toContain(today)
  })

  it('an on-time tap asks with the phone-clock confirm', () => {
    const session = makeSession()
    saveSession(session)
    renderDetail(session)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('session.endSession') }))
    expect(confirmMock).toHaveBeenCalledWith(i18n.t('session.endConfirm'))
  })

  it('Delete only asks App to delete the record, after the confirm (App.handleDeleteRecord owns it)', () => {
    const session = makeSession()
    saveSession(session)
    const onDelete = vi.fn()
    render(
      withAuth(
        <SessionDetail
          session={session}
          onBack={() => {}}
          onDelete={onDelete}
          onDraftAppeal={() => {}}
          onEndSession={() => {}}
        />,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: i18n.t('session.deleteSession') }))

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: session.id }))
    // The screen didn't delete, cancel or mirror anything itself.
    expect(getSession(session.id)).toBeDefined()
    expect(mocks.cancelPushReminders).not.toHaveBeenCalled()
    expect(mocks.cancelInTabReminders).not.toHaveBeenCalled()
  })

  it('Delete does nothing when the confirm is declined', () => {
    const session = makeSession()
    saveSession(session)
    setConfirm(false)
    const onDelete = vi.fn()
    render(
      withAuth(
        <SessionDetail
          session={session}
          onBack={() => {}}
          onDelete={onDelete}
          onDraftAppeal={() => {}}
          onEndSession={() => {}}
        />,
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: i18n.t('session.deleteSession') }))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('offers I\'ve left on a record with no expiry that is not a no-sign record', () => {
    const session = makeSession({ expires_at: null })
    saveSession(session)
    renderDetail(session)
    expect(screen.getByRole('button', { name: i18n.t('session.endSession') })).toBeTruthy()
  })

  it('shows "Ended" and hides I\'ve left as soon as storage has ended_at (no re-navigation)', () => {
    const session = makeSession()
    saveSession(session)
    renderDetail(session)
    expect(screen.getByRole('button', { name: i18n.t('session.endSession') })).toBeTruthy()

    act(() => {
      updateSession(session.id, { ended_at: new Date().toISOString() })
    })

    expect(screen.queryByRole('button', { name: i18n.t('session.endSession') })).toBeNull()
    expect(screen.getByText(/^Ended /)).toBeTruthy()
  })

  it('shows a signature that lands in the background while the screen is open', () => {
    const session = makeSession()
    saveSession(session)
    renderDetail(session)
    expect(screen.queryByText(i18n.t('session.cryptoSigned'))).toBeNull()

    act(() => {
      updateSession(session.id, { signature: SIGNATURE })
    })

    expect(screen.getByText(i18n.t('session.cryptoSigned'))).toBeTruthy()
  })

  it('never presents a dev-key signature as a ParkProof signature (no glow, says so)', () => {
    const session = makeSession({ signature: SIGNATURE })
    saveSession(session)
    renderDetail(session)
    // The published key: the mint glow ring and the plain claim.
    expect(document.querySelector('circle[stroke="#7BE3A4"]')).not.toBeNull()
    expect(screen.getByText(i18n.t('session.cryptoSigned'))).toBeTruthy()

    act(() => {
      updateSession(session.id, { signature: { ...SIGNATURE, key_alias: 'dev-ephemeral' } })
    })

    expect(screen.queryByText(i18n.t('session.cryptoSigned'))).toBeNull()
    expect(screen.getByText(i18n.t('session.devKeySigned'))).toBeTruthy()
    expect(document.querySelector('circle[stroke="#7BE3A4"]')).toBeNull()
  })
})

describe('SessionDetail photos (T0b2)', () => {
  const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)
  const ref = (role: 'sign' | 'car' | 'ambient', sha256: string) => ({
    role,
    sha256,
    captured_at: '2026-10-25T00:58:00.000Z',
    source: 'camera_input' as const,
  })
  beforeEach(() => setPhotoBackendForTests(createMemoryPhotoBackend()))
  afterEach(() => setPhotoBackendForTests(null))

  function renderDetail(session: ParkingSession) {
    saveSession(session)
    render(
      withAuth(
        <SessionDetail session={session} onBack={() => {}} onDelete={() => {}} onDraftAppeal={() => {}} onEndSession={() => {}} />,
      ),
    )
  }

  it('alt text describes each photo instead of repeating its heading', async () => {
    const sign = await putPhoto('rec-alt', jpeg('sign'))
    const car = await putPhoto('rec-alt', jpeg('car'))
    renderDetail(makeSession({ id: 'rec-alt', sign_photo: null, photos: [ref('sign', sign), ref('car', car)] }))
    expect(await screen.findByRole('img', { name: i18n.t('session.signPhotoAlt') })).toBeTruthy()
    expect(await screen.findByRole('img', { name: i18n.t('session.carPhotoAlt') })).toBeTruthy()
    expect(i18n.t('session.signPhotoAlt')).not.toBe(i18n.t('session.signPhotoLabel'))
  })

  it('the surroundings caption shows under the photo, not under the "not on this device" note', async () => {
    const caption = i18n.t('session.ambientPhotoCaption')
    renderDetail(
      makeSession({ id: 'rec-gone', no_sign: true, sign_photo: null, expires_at: null, photos: [ref('ambient', 'a'.repeat(64))] }),
    )
    expect(await screen.findByText(/Photo not on this device/)).toBeTruthy()
    expect(screen.queryByText(caption)).toBeNull()
    cleanup()

    const sha = await putPhoto('rec-here', jpeg('surroundings'))
    renderDetail(makeSession({ id: 'rec-here', no_sign: true, sign_photo: null, expires_at: null, photos: [ref('ambient', sha)] }))
    expect(await screen.findByText(caption)).toBeTruthy()
  })
})
