// @vitest-environment happy-dom
//
// The notice view (build spec T8 items 4 and 5): capture, reading (the
// notice stages on LoadingProgress), the fields read from the notice with
// an editable date and time, the matching records with the comparison
// lines, and the actions: "Draft an appeal with this record", "Export
// evidence PDF", and "Draft an appeal anyway" when nothing matches.
//
// Times: Melbourne on Sunday 25 October 2026 is AEDT (UTC+11).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { saveSession } from '../lib/storage'
import type { NoticeFields, ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import { NOTICE_READING_STAGES, type NoticeSnapshot } from '../lib/notice-read'
import NoticeLookup from './NoticeLookup'

const mocks = vi.hoisted(() => ({
  readNotice: vi.fn<(base64: string, mediaType?: string) => Promise<NoticeFields>>(),
  forwardGeocode: vi.fn<(q: string) => Promise<{ lat: number; lng: number; address: string } | null>>(),
  resizeImageFile: vi.fn(async () => ({ dataUrl: 'data:image/jpeg;base64,Tk9USUNF', mediaType: 'image/jpeg' })),
  downloadPdf: vi.fn(),
  materializeRemotePhotos: vi.fn(async (s: ParkingSession) => s),
}))
vi.mock('../lib/claude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/claude')>()),
  readNotice: mocks.readNotice,
}))
vi.mock('../lib/geocode', () => ({ forwardGeocode: mocks.forwardGeocode, reverseGeocode: async () => null }))
vi.mock('../lib/image', () => ({ resizeImageFile: mocks.resizeImageFile }))
vi.mock('../lib/pdf', () => ({ materializeRemotePhotos: mocks.materializeRemotePhotos, downloadPdf: mocks.downloadPdf }))
vi.mock('../lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))

const ARRIVED = '2026-10-25T01:31:20.000Z' // 12:31 pm AEDT
const TAPPED = '2026-10-25T02:55:40.000Z' // 1:55 pm AEDT
const SIGNED = '2026-10-25T02:56:02.000Z' // 1:56 pm AEDT
const KING_ST = { lat: -37.8136, lng: 144.9631 }

const FIELDS: NoticeFields = {
  legibility: 'clear',
  notice_number: 'PIN 4471-2290',
  issuing_authority: 'City of Melbourne',
  offence_date_raw: '25/10/2026',
  offence_time_raw: '2:10 PM',
  offence_datetime_local: '2026-10-25T14:10',
  location_text: 'King St, Melbourne VIC 3000',
  offence_code: '702',
  offence_description: 'Stopped longer than permitted',
  amount: '$99.00',
  due_date: '22/11/2026',
}

function bundle(payload: Record<string, unknown>): SignatureBundle {
  return {
    schema: String(payload.schema),
    signed_at: String(payload.signed_at),
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify(payload),
    signature_base64: `sig-${String(payload.signed_at)}-${String(payload.seq ?? 0)}`,
  }
}

function departure(): SignedAddendum {
  const data = { ended_at: TAPPED, location: null, distance_from_arrival_m: null, return_photos: [] }
  return {
    id: 'dep-1',
    seq: 2,
    kind: 'departure',
    captured_at: TAPPED,
    data,
    bundle: bundle({ schema: 'parkproof-addendum-v1', kind: 'departure', seq: 2, signed_at: SIGNED, data }),
  }
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: ARRIVED,
    location: { ...KING_ST, address: '12 King St, Melbourne VIC', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: '2026-10-25T03:31:20.000Z',
    confidence: 'high',
    signature: bundle({
      schema: 'parkproof-evidence-v2',
      session_id: 'rec-1',
      arrived_at: ARRIVED,
      expires_at: '2026-10-25T03:31:20.000Z',
      signed_at: '2026-10-25T01:31:25.000Z',
    }),
    chain_key: 'ab'.repeat(32),
    ended_at: TAPPED,
    addenda: [departure()],
    ...overrides,
  }
}

function snapshot(overrides: Partial<NoticeSnapshot> = {}): NoticeSnapshot {
  return {
    photo: { dataUrl: 'data:image/jpeg;base64,Tk9USUNF', mediaType: 'image/jpeg' },
    fields: FIELDS,
    date: '2026-10-25',
    time: '14:10',
    noticePoint: KING_ST,
    issuingState: 'VIC',
    selectedId: null,
    ...overrides,
  }
}

const SPEC_DEPARTURE =
  "You tapped I've left at Sun 25 Oct, 1:55 pm AEDT, 15 minutes before the time on the notice. ParkProof signed that record at Sun 25 Oct, 1:56 pm AEDT. The record shows when you tapped, not when the car moved."

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const comparison = () => within(screen.getByTestId('notice-comparison')).getAllByRole('listitem').map((li) => li.textContent)

function pickFile() {
  const file = new File(['notice'], 'notice.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByTestId('notice-camera-input'), { target: { files: [file] } })
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  localStorage.clear()
  for (const m of Object.values(mocks)) m.mockClear()
  mocks.readNotice.mockReset()
  mocks.forwardGeocode.mockReset()
  mocks.forwardGeocode.mockResolvedValue({ ...KING_ST, address: 'King St' })
})
afterEach(() => {
  cleanup()
})

describe('NoticeLookup: capture and reading', () => {
  it('reads the photo, geocodes the place, and shows the fields, the date and time, and the matching record', async () => {
    saveSession(record())
    const pending = deferred<NoticeFields>()
    mocks.readNotice.mockReturnValue(pending.promise)
    render(<NoticeLookup onBack={() => {}} onDraftAppeal={() => {}} />)
    expect(screen.getByText(i18n.t('notice.captureIntro'))).toBeTruthy()

    pickFile()
    // Reading: the notice's own stages on the progress screen.
    expect(await screen.findByText(i18n.t(NOTICE_READING_STAGES[0].labelKey))).toBeTruthy()
    expect(screen.getByText(i18n.t('notice.reading.hint'))).toBeTruthy()
    await waitFor(() => expect(mocks.readNotice).toHaveBeenCalledWith('Tk9USUNF', 'image/jpeg'))
    expect(mocks.resizeImageFile).toHaveBeenCalledTimes(1)

    await act(async () => pending.resolve(FIELDS))
    await screen.findByText(i18n.t('notice.fields.heading'))
    expect(mocks.forwardGeocode).toHaveBeenCalledWith('King St, Melbourne VIC 3000, Australia')
    for (const value of ['PIN 4471-2290', 'City of Melbourne', 'King St, Melbourne VIC 3000', '702 Stopped longer than permitted']) {
      expect(screen.getByText(value)).toBeTruthy()
    }
    // Neither the amount nor the due date is shown: the driver checks those on the notice.
    expect(screen.queryByText('$99.00')).toBeNull()
    expect(screen.queryByText('22/11/2026')).toBeNull()
    expect((screen.getByLabelText(i18n.t('notice.fields.date')) as HTMLInputElement).value).toBe('2026-10-25')
    expect((screen.getByLabelText(i18n.t('notice.fields.time')) as HTMLInputElement).value).toBe('14:10')

    expect(screen.getByText(i18n.t('notice.matches.heading'))).toBeTruthy()
    expect(screen.getByText('12 King St, Melbourne VIC')).toBeTruthy()
    expect(comparison()).toEqual([
      SPEC_DEPARTURE,
      'You logged this park at Sun 25 Oct, 12:31 pm AEDT, 1 hour 39 minutes before the time on the notice.',
      "Check the registration on the notice is the car in this record. ParkProof doesn't record registrations.",
      'Check the due date on the notice itself.',
    ])
    expect(screen.getByText(i18n.t('notice.disclaimer'))).toBeTruthy()
  })

  it('matches without the place when geocoding fails', async () => {
    saveSession(record())
    mocks.readNotice.mockResolvedValue(FIELDS)
    mocks.forwardGeocode.mockRejectedValue(new Error('offline'))
    render(<NoticeLookup onBack={() => {}} onDraftAppeal={() => {}} />)
    pickFile()
    await screen.findByText(i18n.t('notice.fields.heading'))
    expect(comparison()[0]).toBe(SPEC_DEPARTURE)
  })

  it('a reading error shows the message, and "Try a different photo" goes back to capture', async () => {
    mocks.readNotice.mockRejectedValue(new Error("That photo doesn't look like a parking fine notice."))
    render(<NoticeLookup onBack={() => {}} onDraftAppeal={() => {}} />)
    pickFile()
    expect((await screen.findByRole('alert')).textContent).toBe("That photo doesn't look like a parking fine notice.")
    expect(screen.getByText(i18n.t('notice.errorHeader'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('appeal.tryDifferentPhoto') }))
    expect(screen.getByText(i18n.t('notice.captureIntro'))).toBeTruthy()
  })
})

describe('NoticeLookup: the fields', () => {
  it('flags a date the model read differently from the printed date (day first)', () => {
    // Printed 04/05/2027 is 4 May; the model said 5 April.
    const fields = { ...FIELDS, offence_date_raw: '04/05/2027', offence_datetime_local: '2027-04-05T14:10' }
    render(<NoticeLookup initial={snapshot({ fields, date: '2027-05-04' })} onBack={() => {}} onDraftAppeal={() => {}} />)
    expect(screen.getByText(i18n.t('notice.fields.checkDateTime'))).toBeTruthy()
  })

  it('no flag when the readings agree; a hard-to-read notice says so', () => {
    render(<NoticeLookup initial={snapshot({ fields: { ...FIELDS, legibility: 'partly_readable' } })} onBack={() => {}} onDraftAppeal={() => {}} />)
    expect(screen.queryByText(i18n.t('notice.fields.checkDateTime'))).toBeNull()
    expect(screen.getByText(i18n.t('notice.fields.partlyReadable'))).toBeTruthy()
  })

  it('without a date and time it asks for them, matches nothing, and offers "Draft an appeal anyway"', () => {
    saveSession(record())
    const onDraftAppeal = vi.fn()
    render(<NoticeLookup initial={snapshot({ date: '', time: '' })} onBack={() => {}} onDraftAppeal={onDraftAppeal} />)
    expect(screen.getByText(i18n.t('notice.fields.enterDateTime'))).toBeTruthy()
    expect(screen.queryByText(i18n.t('notice.matches.heading'))).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('notice.actions.draftAnyway') }))
    expect(onDraftAppeal).toHaveBeenCalledWith(null, expect.objectContaining({ date: '', time: '' }))
  })

  it('editing the time re-matches: outside every record, "Draft an appeal anyway" with the notice photo', () => {
    saveSession(record())
    const onDraftAppeal = vi.fn()
    render(<NoticeLookup initial={snapshot()} onBack={() => {}} onDraftAppeal={onDraftAppeal} />)
    expect(comparison()[0]).toBe(SPEC_DEPARTURE)
    expect(screen.queryByRole('button', { name: i18n.t('notice.actions.draftAnyway') })).toBeNull()

    // 11:50 pm is past the window (the signed departure plus 6 hours).
    fireEvent.change(screen.getByLabelText(i18n.t('notice.fields.time')), { target: { value: '23:50' } })
    expect(screen.queryByTestId('notice-comparison')).toBeNull()
    expect(screen.getByText(i18n.t('notice.matches.none'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('notice.actions.draftAnyway') }))
    expect(onDraftAppeal).toHaveBeenCalledTimes(1)
    const [session, snap] = onDraftAppeal.mock.calls[0]
    expect(session).toBeNull()
    expect(snap.time).toBe('23:50')
    expect(snap.photo).toEqual({ dataUrl: 'data:image/jpeg;base64,Tk9USUNF', mediaType: 'image/jpeg' })

    // Back to 2:25 pm: the departure is now 30 minutes before.
    fireEvent.change(screen.getByLabelText(i18n.t('notice.fields.time')), { target: { value: '14:25' } })
    expect(comparison()[0]).toContain('30 minutes before the time on the notice')
  })
})

describe('NoticeLookup: matches and actions', () => {
  it('"Draft an appeal with this record" hands App the record and the notice', () => {
    saveSession(record())
    const onDraftAppeal = vi.fn()
    render(<NoticeLookup initial={snapshot()} onBack={() => {}} onDraftAppeal={onDraftAppeal} />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('notice.actions.draftAppeal') }))
    const [session, snap] = onDraftAppeal.mock.calls[0]
    expect(session.id).toBe('rec-1')
    expect(snap.selectedId).toBe('rec-1')
    expect(snap.photo.dataUrl).toBe('data:image/jpeg;base64,Tk9USUNF')
  })

  it('"Export evidence PDF" builds the record\'s evidence PDF', async () => {
    saveSession(record())
    render(<NoticeLookup initial={snapshot()} onBack={() => {}} onDraftAppeal={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('notice.actions.exportPdf') }))
    await waitFor(() => expect(mocks.downloadPdf).toHaveBeenCalledTimes(1))
    expect(mocks.downloadPdf.mock.calls[0][0].id).toBe('rec-1')
    expect(mocks.downloadPdf.mock.calls[0][2]).toBe('en')
  })

  it('a failed export says so', async () => {
    saveSession(record())
    mocks.downloadPdf.mockImplementationOnce(() => {
      throw new Error('jsPDF failed')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<NoticeLookup initial={snapshot()} onBack={() => {}} onDraftAppeal={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('notice.actions.exportPdf') }))
    expect(await screen.findByText(i18n.t('session.pdfErrorHeader'))).toBeTruthy()
    error.mockRestore()
  })

  it('several matches: the best is compared first, and another can be chosen', () => {
    // rec-1 left before the notice; rec-2 (a later park nearby) is still running at 2:10 pm.
    saveSession(record())
    saveSession(
      record({
        id: 'rec-2',
        arrived_at: '2026-10-25T03:05:00.000Z',
        signature: undefined,
        chain_key: undefined,
        ended_at: undefined,
        addenda: [],
        location: { lat: -37.8146, lng: 144.9651, address: '30 Queen St, Melbourne VIC', source: 'gps', accuracy_meters: 10 },
      }),
    )
    const onDraftAppeal = vi.fn()
    render(<NoticeLookup initial={snapshot()} onBack={() => {}} onDraftAppeal={onDraftAppeal} />)
    // rec-2 contains the notice time, so it ranks first.
    expect(comparison()).toContain("You haven't tapped I've left on this record.")
    expect(screen.getAllByRole('button', { name: i18n.t('notice.match.compare') })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('notice.match.compare') }))
    expect(comparison()[0]).toBe(SPEC_DEPARTURE)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('notice.actions.draftAppeal') }))
    expect(onDraftAppeal.mock.calls[0][0].id).toBe('rec-1')
  })

  it('"Compare with this record" moves focus to the comparison it opens', () => {
    saveSession(record())
    saveSession(
      record({
        id: 'rec-2',
        arrived_at: '2026-10-25T03:05:00.000Z',
        signature: undefined,
        chain_key: undefined,
        ended_at: undefined,
        addenda: [],
        location: { lat: -37.8146, lng: 144.9651, address: '30 Queen St, Melbourne VIC', source: 'gps', accuracy_meters: 10 },
      }),
    )
    render(<NoticeLookup initial={snapshot()} onBack={() => {}} onDraftAppeal={() => {}} />)
    // Nothing moves focus on first paint.
    expect(document.activeElement).toBe(document.body)
    const compare = screen.getByRole('button', { name: i18n.t('notice.match.compare') })
    compare.focus()
    fireEvent.click(compare)
    // The button is gone; focus is on the newly opened card's heading, not lost to the page.
    expect(screen.queryByRole('button', { name: i18n.t('notice.match.compare') })).not.toBe(compare)
    const focused = document.activeElement as HTMLElement
    expect(focused.tagName).toBe('H4')
    expect(focused.textContent).toBe(i18n.t('notice.compare.heading'))
    expect(focused.closest('li')?.textContent).toContain('12 King St, Melbourne VIC')
  })

  it('renders no <main> of its own at any stage (App provides the one landmark)', async () => {
    const { container, unmount } = render(<NoticeLookup initial={snapshot()} onBack={() => {}} onDraftAppeal={() => {}} />)
    expect(container.querySelector('main')).toBeNull()
    unmount()
    const pending = deferred<NoticeFields>()
    mocks.readNotice.mockReturnValue(pending.promise)
    const view = render(<NoticeLookup onBack={() => {}} onDraftAppeal={() => {}} />)
    expect(view.container.querySelector('main')).toBeNull()
    pickFile()
    expect(await screen.findByText(i18n.t(NOTICE_READING_STAGES[0].labelKey))).toBeTruthy()
    expect(view.container.querySelector('main')).toBeNull()
    await act(async () => pending.resolve(FIELDS))
    await screen.findByText(i18n.t('notice.fields.heading'))
    expect(view.container.querySelector('main')).toBeNull()
    view.unmount()
    mocks.readNotice.mockRejectedValue(new Error('nope'))
    const failed = render(<NoticeLookup onBack={() => {}} onDraftAppeal={() => {}} />)
    pickFile()
    await screen.findByRole('alert')
    expect(failed.container.querySelector('main')).toBeNull()
  })

  it('shows the driver and handover lines only when the record has them', () => {
    const handoverData = { from_driver: 'Sam', to_driver: 'Alex', handed_over_at: '2026-10-25T02:30:00.000Z', location: null }
    saveSession(
      record({
        driver_name: 'Sam',
        addenda: [
          departure(),
          { id: 'h-1', seq: 3, kind: 'handover', captured_at: handoverData.handed_over_at, data: handoverData },
        ],
      }),
    )
    render(<NoticeLookup initial={snapshot()} onBack={() => {}} onDraftAppeal={() => {}} />)
    const lines = comparison()
    expect(lines).toContain(
      "Your record says Sam was driving. That's what was entered when the park was logged. ParkProof didn't check it. If someone else was driving, the notice explains how to nominate them. Only nominate the person who was actually driving.",
    )
    expect(lines).toContain('Your record says the car was handed to Alex at Sun 25 Oct, 1:30 pm AEDT.')
  })

  it('leaves out records shared from someone else', () => {
    saveSession(
      record({
        id: 'shared-1',
        shared_from: {
          original_session_id: 'other-phone-1',
          received_at: TAPPED,
          shared_at: null,
          arrival_bundle: null,
          snapshot: {},
        },
      }),
    )
    render(<NoticeLookup initial={snapshot()} onBack={() => {}} onDraftAppeal={() => {}} />)
    expect(screen.getByText(i18n.t('notice.matches.none'))).toBeTruthy()
  })

  it('Back leaves the screen', () => {
    const onBack = vi.fn()
    render(<NoticeLookup initial={snapshot()} onBack={onBack} onDraftAppeal={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.backToHome') }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
