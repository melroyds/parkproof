// @vitest-environment happy-dom
//
// "Hand the car over" (build spec T7 items 5 and 6) on the record screen:
// offered only on an active record of the driver's own; asks for the next
// driver's name; queues a signed handover part (signed here by the REAL
// Lambda handler with a local test key); offers the share link; the record
// stays active. The accessible-permit safeguard shows on the handover
// sheet only when the park used an accessible permit (fixtures, until T4
// saves permit_context). And end to end: a driver named in the logger and
// a handover made on the record screen feed the notice screen's driver
// and handover comparison lines (T8), signed.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { getSession, saveSession } from '../lib/storage'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from '../lib/photo-store'
import { emptyLogDraft } from '../lib/evidence-chain'
import { prepareNewRecord, resetSigningQueueForTests, signNewRecord, whenSigningIdle } from '../lib/signing'
import { handoverParts } from '../lib/handover'
import { formatInZone } from '../lib/time-format'
import { createTestSigner, type TestSigner } from '../lib/test-support/test-signer'
import { signedOwnRecord } from '../lib/test-support/share-fixtures'
import type { NoticeSnapshot } from '../lib/notice-read'
import type { NoticeFields, ParkingRules, ParkingSession, PermitContext } from '../types'
import en from '../locales/en.json'
import SessionDetail from './SessionDetail'
import SessionLogger from './SessionLogger'
import NoticeLookup from './NoticeLookup'

vi.mock('../lib/pdf', () => ({ materializeRemotePhotos: async (s: ParkingSession) => s, downloadPdf: () => {} }))
vi.mock('../lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))
vi.mock('../lib/geocode', () => ({
  reverseGeocode: async () => null,
  reverseGeocodeDetails: async () => null,
  forwardGeocode: async () => ({ lat: -37.8136, lng: 144.9631, address: 'King St, Melbourne' }),
}))

const AUTH: AuthContextValue = { user: null, loading: false, configured: false, refresh: async () => {}, signOut: () => {} }
const TZ = 'Australia/Melbourne'

let signer: TestSigner
/** True: /sign-session goes to the test signer. False: the server is down, so parts stay pending. */
let serverUp = true

beforeAll(async () => {
  await i18n.changeLanguage('en')
  signer = await createTestSigner()
})

beforeEach(() => {
  localStorage.clear()
  resetSigningQueueForTests()
  setPhotoBackendForTests(createMemoryPhotoBackend())
  serverUp = true
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn() }, configurable: true })
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) =>
    serverUp && String(input).endsWith('/sign-session') ? signer.fetch(input, init) : new Response('{}', { status: 503 }),
  )
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  cleanup()
  await whenSigningIdle()
  await new Promise((r) => setTimeout(r, 20))
  setPhotoBackendForTests(null)
  vi.unstubAllGlobals()
})

function renderDetail(session: ParkingSession) {
  const wrap = (children: ReactNode) => <AuthContext.Provider value={AUTH}>{children}</AuthContext.Provider>
  return render(
    wrap(
      <SessionDetail session={session} onBack={() => {}} onDelete={() => {}} onDraftAppeal={() => {}} onEndSession={() => {}} />,
    ),
  )
}

const permit = (type: PermitContext['type']): PermitContext => ({
  type,
  area: null,
  holder_present: type === 'accessible' ? true : null,
  sign_exception_applies: false,
  standard_until: null,
  permit_until: null,
  note: null,
})

const handOverButton = () => screen.queryByRole('button', { name: en.handover.action })

async function openSheet(): Promise<HTMLElement> {
  fireEvent.click(handOverButton()!)
  return screen.findByRole('dialog', { name: en.handover.action })
}

async function handOverTo(dialog: HTMLElement, name: string) {
  fireEvent.change(within(dialog).getByLabelText(en.handover.nameLabel), { target: { value: name } })
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: en.handover.submit }))
  })
}

describe('"Hand the car over" on the record screen', () => {
  it('is offered on an active record of the driver\'s own, not on an ended one', async () => {
    const active = await signedOwnRecord(signer)
    saveSession(active)
    renderDetail(active)
    expect(handOverButton()).toBeTruthy()
    cleanup()

    const ended = await signedOwnRecord(signer, { ended_at: new Date().toISOString() })
    saveSession(ended)
    renderDetail(ended)
    expect(handOverButton()).toBeNull()
  })

  it("is not offered on a park that finished long ago without an I've left tap (not active any more)", async () => {
    // Logged two days ago: its limit passed more than 12 hours ago, so it
    // is off home, and a handover dated now would misdescribe it.
    const old = await signedOwnRecord(signer, {}, Date.now() - 2 * 24 * 60 * 60_000)
    expect(old.ended_at).toBeUndefined()
    saveSession(old)
    renderDetail(old)
    expect(screen.getByRole('button', { name: en.session.endSession })).toBeTruthy()
    expect(handOverButton()).toBeNull()
  })

  it('asks for the next driver, queues a signed handover part, keeps the record active and offers the share link', async () => {
    const own = await signedOwnRecord(signer)
    saveSession(own)
    renderDetail(own)
    const dialog = await openSheet()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(dialog).getByText(en.handover.intro)).toBeTruthy()
    // Who the signed handover will say handed the car over, before the tap.
    expect(within(dialog).getByText('Handed over by Sam, the driver this record names now.')).toBeTruthy()

    // No name: nothing is added.
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: en.handover.submit }))
    })
    expect(within(dialog).getByRole('alert').textContent).toBe(en.handover.nameRequired)
    expect(getSession(own.id)!.addenda ?? []).toEqual([])

    await handOverTo(dialog, '  Alex  ')
    expect(within(dialog).getByRole('status').textContent).toBe(
      'Your record now says Sam handed the car to Alex. ParkProof signs it when your phone is online. The record stays active.',
    )
    // One tap, one part, from the record's driver, and the record stays active.
    await whenSigningIdle(own.id)
    const stored = getSession(own.id)!
    expect(stored.ended_at).toBeUndefined()
    const handovers = (stored.addenda ?? []).filter((a) => a.kind === 'handover')
    expect(handovers).toHaveLength(1)
    expect(handovers[0].data).toMatchObject({ from_driver: 'Sam', to_driver: 'Alex', location: null })
    const payload = JSON.parse(handovers[0].bundle!.canonical_payload) as { kind: string; data: unknown }
    expect(payload.kind).toBe('handover')
    expect(payload.data).toEqual(handovers[0].data)

    // The record screen shows it as what the record says, signed (no "not
    // signed yet" line), with the "not checked" line, and still offers I've left.
    const at = formatInZone(handoverParts(stored)[0].handed_over_at, TZ)
    const line = await screen.findByText(`Your record says Sam handed the car to Alex at ${at} (phone clock).`)
    expect(line.parentElement!.textContent).toContain(en.logger.driver.help)
    expect(screen.queryByText(en.notice.compare.handoverPending)).toBeNull()
    expect(screen.getByRole('button', { name: en.session.endSession })).toBeTruthy()

    // The share offer replaces this sheet with the share sheet (one dialog at a time).
    expect(within(dialog).getByText(en.handover.offerShare)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: en.share.action }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: en.handover.action })).toBeNull())
    const share = screen.getByRole('dialog', { name: en.share.action })
    expect(within(share).getByText(en.share.confirm)).toBeTruthy()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('with nobody named as driving, the sheet names no one handing over and nothing is signed for them', async () => {
    const own = await signedOwnRecord(signer, { driver_name: null })
    saveSession(own)
    renderDetail(own)
    const dialog = await openSheet()
    expect(within(dialog).queryByText(/^Handed over by /)).toBeNull()
    await handOverTo(dialog, 'Alex')
    expect(within(dialog).getByRole('status').textContent).toBe(
      'Your record now says the car was handed to Alex. ParkProof signs it when your phone is online. The record stays active.',
    )
    await whenSigningIdle(own.id)
    const stored = getSession(own.id)!
    expect((stored.addenda ?? []).find((a) => a.kind === 'handover')!.data).toMatchObject({ from_driver: null, to_driver: 'Alex' })
    const at = formatInZone(handoverParts(stored)[0].handed_over_at, TZ)
    expect(await screen.findByText(`Your record says the car was handed to Alex at ${at} (phone clock).`)).toBeTruthy()
  })

  it('says a handover is not signed yet while the server is unreachable', async () => {
    serverUp = false
    const own = await signedOwnRecord(signer)
    saveSession(own)
    renderDetail(own)
    await handOverTo(await openSheet(), 'Alex')
    fireEvent.click(screen.getByRole('button', { name: en.common.done }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText(en.notice.compare.handoverPending)).toBeTruthy()
    expect(handoverParts(getSession(own.id)!).map((h) => h.state)).toEqual(['pending'])
  })

  it('Cancel and Escape close the sheet without adding anything', async () => {
    const own = await signedOwnRecord(signer)
    saveSession(own)
    renderDetail(own)
    const dialog = await openSheet()
    fireEvent.change(within(dialog).getByLabelText(en.handover.nameLabel), { target: { value: 'Alex' } })
    fireEvent.click(within(dialog).getByRole('button', { name: en.common.cancel }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const again = await openSheet()
    // A fresh sheet: the cancelled name is gone.
    expect((within(again).getByLabelText(en.handover.nameLabel) as HTMLInputElement).value).toBe('')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(getSession(own.id)!.addenda ?? []).toEqual([])
  })
})

describe('the accessible-permit safeguard on the handover sheet (item 6)', () => {
  const SAFEGUARD = en.share.permitSafeguard

  it("shows the spec's line only when the park used an accessible permit", async () => {
    expect(SAFEGUARD).toBe(
      "This park used an accessible parking permit. If the permit holder won't be in the car, take the permit off the dash before anyone drives it.",
    )
    for (const [context, shown] of [
      [permit('accessible'), true],
      [permit('resident'), false],
      [permit('business'), false],
      [null, false],
    ] as const) {
      const own = await signedOwnRecord(signer, { permit_context: context })
      saveSession(own)
      renderDetail(own)
      const dialog = await openSheet()
      expect(!!within(dialog).queryByText(SAFEGUARD)).toBe(shown)
      // Still there once the handover is recorded, next to the share offer.
      await handOverTo(dialog, 'Alex')
      expect(!!within(dialog).queryByText(SAFEGUARD)).toBe(shown)
      cleanup()
      await whenSigningIdle()
    }
  })
})

// ─── T8: the notice screen's driver and handover lines, from this data ────

const RULES: ParkingRules = {
  rules: '2P Mon-Fri 8am-6pm',
  observations: [],
  can_park_now: true,
  until: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
  duration_minutes: 120,
  confidence: 'high',
  clarification: null,
}
const SIGN = 'data:image/jpeg;base64,' + btoa('scan-sign-for-handover')

/** A Melbourne wall-clock date and time ('YYYY-MM-DD', 'HH:MM'), as the notice screen keeps them. */
function melbourneLocal(ms: number): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

describe('the notice comparison reads the driver and the handover this build records (T8)', () => {
  it('a driver named in the logger and a handover from the record screen give the signed driver and handover lines', async () => {
    // GPS at King St, so the record has a place the notice can match.
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: -37.8136, longitude: 144.9631, accuracy: 8 } } as GeolocationPosition),
      },
      configurable: true,
    })

    // 1. Log the park with "Who's driving?" filled in, then save it as App does.
    const onComplete = vi.fn<(s: ParkingSession) => void>()
    render(
      <SessionLogger
        rules={RULES}
        signPhoto={SIGN}
        signPhotoMeta={{ captured_at: new Date().toISOString(), source: 'camera_input' }}
        draft={emptyLogDraft()}
        onComplete={onComplete}
        onCancel={() => {}}
      />,
    )
    // The driver line is collapsed by default (an optional step): open it, then type.
    fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + en.logger.driver.label.replace(/[?()]/g, '\\$&')) }))
    fireEvent.change(screen.getByLabelText(en.logger.driver.label), { target: { value: 'Sam' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.logger.saveSession }))
    })
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const logged = await prepareNewRecord(onComplete.mock.calls[0][0])
    saveSession(logged)
    signNewRecord(logged.id, emptyLogDraft())
    await whenSigningIdle(logged.id)
    cleanup()

    // 2. Hand the car over on the record screen.
    renderDetail(getSession(logged.id)!)
    await handOverTo(await openSheet(), 'Alex')
    await whenSigningIdle(logged.id)
    cleanup()

    const stored = getSession(logged.id)!
    expect(stored.signature).toBeTruthy()
    const kinds = (stored.addenda ?? []).map((a) => `${a.kind}:${a.bundle ? 'signed' : 'pending'}`)
    expect(kinds).toEqual(['arrival_context:signed', 'handover:signed'])
    const handedAt = handoverParts(stored)[0].handed_over_at

    // 3. A notice 30 minutes after the park was logged, at King St.
    const notice = melbourneLocal(Date.parse(stored.arrived_at) + 30 * 60_000)
    const fields: NoticeFields = {
      legibility: 'clear',
      notice_number: 'PIN 1',
      issuing_authority: 'City of Melbourne',
      offence_date_raw: notice.date.split('-').reverse().join('/'),
      offence_time_raw: notice.time,
      offence_datetime_local: `${notice.date}T${notice.time}`,
      location_text: 'King St, Melbourne VIC 3000',
      offence_code: '702',
      offence_description: 'Stopped longer than permitted',
      amount: '$99.00',
      due_date: '22/12/2026',
    }
    const snapshot: NoticeSnapshot = {
      photo: { dataUrl: 'data:image/jpeg;base64,Tk9USUNF', mediaType: 'image/jpeg' },
      fields,
      date: notice.date,
      time: notice.time,
      noticePoint: { lat: -37.8136, lng: 144.9631 },
      issuingState: 'VIC',
      selectedId: null,
    }
    render(<NoticeLookup initial={snapshot} onBack={() => {}} onDraftAppeal={() => {}} />)
    const lines = within(await screen.findByTestId('notice-comparison'))
      .getAllByRole('listitem')
      .map((li) => li.textContent)

    expect(lines).toContain(
      "Your record says Sam was driving. That's what was entered when the park was logged. ParkProof didn't check it. If someone else was driving, the notice explains how to nominate them. Only nominate the person who was actually driving.",
    )
    expect(lines).toContain(`Your record says the car was handed to Alex at ${formatInZone(handedAt, TZ)}.`)
    // Both are read from signed parts: neither says it isn't signed.
    expect(lines).not.toContain(en.notice.compare.driverPending)
    expect(lines).not.toContain(en.notice.compare.driverNotSigned)
    expect(lines).not.toContain(en.notice.compare.handoverPending)
  })
})
