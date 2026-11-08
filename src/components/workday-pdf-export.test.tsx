// @vitest-environment happy-dom
//
// The workday PDF's leg picker (build spec T6c item 1). It shows the
// spec's warning before export, starts with every leg ticked, exports only
// the legs left ticked (in leg order), won't export none, and is a modal
// dialog as FeedbackModal. With workday mode off (VITE_FEATURE_WORKDAY)
// there is no button, no picker, and the PDF code is never called.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from '../lib/photo-store'
import { saveSession, startWorkday } from '../lib/storage'
import type { ParkingSession } from '../types'
import WorkdayPdfExport from './WorkdayPdfExport'
import WorkdayView from './WorkdayView'

const flag = vi.hoisted(() => ({ on: true }))
vi.mock('../lib/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/features')>()),
  isWorkdayEnabled: () => flag.on,
}))
const pdf = vi.hoisted(() => ({
  downloadWorkdayPdf: vi.fn((input: unknown): boolean => {
    void input
    return true
  }),
  materializeRemotePhotosBatch: vi.fn(async (legs: ParkingSession[]) => legs.map((l) => ({ ...l, car_photo: 'materialised' }))),
}))
vi.mock('../lib/pdf-workday', () => pdf)
vi.mock('../lib/pdf-fonts', () => ({ prefetchPdfFont: vi.fn(async () => {}) }))

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts)
const WD = 'aaaaaaaa-1111-4111-8111-111111111111'

function leg(index: number, address: string): ParkingSession {
  return {
    id: `leg-${index}`,
    arrived_at: new Date(Date.parse('2026-10-26T22:00:00.000Z') + index * 2 * 3_600_000).toISOString(),
    location: { lat: -37.8, lng: 144.96, address, source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    workday_id: WD,
    leg_index: index,
  }
}
const LEGS = [leg(0, '1 First St'), leg(1, '2 Second St'), leg(2, '3 Third St')]
const WORKDAY = { id: WD, started_at: '2026-10-26T21:58:00.000Z', jurisdiction: 'VIC' as const, status: 'ended' as const, current_session_id: null, previous_session_id: null, ended_at: '2026-10-27T06:00:00.000Z' }

/** Tap the export button (focused first, as a tap focuses it in a browser). */
const openPicker = () => {
  const button = screen.getByRole('button', { name: t('workday.pdf.open') })
  button.focus()
  fireEvent.click(button)
}
const box = (n: number) => screen.getByRole('checkbox', { name: new RegExp(`^${t('workday.pdf.leg', { number: n })}`) }) as HTMLInputElement
const exportButton = () => screen.getByRole('button', { name: t('session.exportAsPdf') }) as HTMLButtonElement

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  flag.on = true
  pdf.downloadWorkdayPdf.mockClear()
  pdf.downloadWorkdayPdf.mockImplementation(() => true)
  pdf.materializeRemotePhotosBatch.mockClear()
  setPhotoBackendForTests(createMemoryPhotoBackend())
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  setPhotoBackendForTests(null)
})

describe('the leg picker, workday mode on', () => {
  it('opens a modal with the exact warning before export and every leg ticked', () => {
    render(<WorkdayPdfExport legs={LEGS} workday={WORKDAY} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    openPicker()
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const warning = document.getElementById(dialog.getAttribute('aria-describedby') as string)
    expect(warning?.textContent).toBe(
      'This PDF includes every leg you choose, with distances between them and what you told us at each move. Councils can read it.',
    )
    expect([box(1), box(2), box(3)].map((b) => b.checked)).toEqual([true, true, true])
    expect(within(dialog).getByText('2 Second St')).toBeTruthy()
    expect(exportButton().disabled).toBe(false)
    // Focus starts on the title, inside the dialog.
    expect(document.activeElement?.id).toBe('workday-pdf-title')
  })

  it('exports only the ticked legs, in leg order, with every leg for the chain, then closes', async () => {
    render(<WorkdayPdfExport legs={[LEGS[2], LEGS[0], LEGS[1]]} workday={WORKDAY} />)
    openPicker()
    fireEvent.click(box(2))
    expect(box(2).checked).toBe(false)
    fireEvent.click(exportButton())
    await waitFor(() => expect(pdf.downloadWorkdayPdf).toHaveBeenCalledTimes(1))
    expect(pdf.materializeRemotePhotosBatch.mock.calls[0][0].map((l) => l.id)).toEqual(['leg-0', 'leg-2'])
    const input = pdf.downloadWorkdayPdf.mock.calls[0][0] as {
      legs: ParkingSession[]
      allLegs: ParkingSession[]
      workday: unknown
      locale: string
    }
    // The materialised copies of the chosen legs go to the PDF.
    expect(input.legs.map((l) => [l.id, l.car_photo])).toEqual([
      ['leg-0', 'materialised'],
      ['leg-2', 'materialised'],
    ])
    expect(input.allLegs.map((l) => l.id).sort()).toEqual(['leg-0', 'leg-1', 'leg-2'])
    expect(input.workday).toBe(WORKDAY)
    expect(input.locale).toBe('en')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('never exports no legs: Export is disabled and the picker says to choose one', () => {
    render(<WorkdayPdfExport legs={LEGS} workday={null} />)
    openPicker()
    expect(screen.queryByText(t('workday.pdf.noneChosen'))).toBeNull()
    for (const n of [1, 2, 3]) fireEvent.click(box(n))
    expect(exportButton().disabled).toBe(true)
    expect(screen.getByText(t('workday.pdf.noneChosen'))).toBeTruthy()
    fireEvent.click(exportButton())
    expect(pdf.downloadWorkdayPdf).not.toHaveBeenCalled()
    // Ticking one again lets it export.
    fireEvent.click(box(3))
    expect(exportButton().disabled).toBe(false)
  })

  it('Escape and Cancel close it without exporting; reopening starts with every leg ticked', () => {
    render(<WorkdayPdfExport legs={LEGS} workday={null} />)
    openPicker()
    fireEvent.click(box(1))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: t('workday.pdf.open') }))
    openPicker()
    expect(box(1).checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: t('common.cancel') }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(pdf.downloadWorkdayPdf).not.toHaveBeenCalled()
  })

  it('a failed export says so and keeps the picker open', async () => {
    pdf.downloadWorkdayPdf.mockImplementation(() => {
      throw new Error('boom')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<WorkdayPdfExport legs={LEGS} workday={null} />)
    openPicker()
    fireEvent.click(exportButton())
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain(t('session.pdfErrorHeader'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    error.mockRestore()
  })

  it('sits on the workday view, above the stops', () => {
    for (const l of LEGS) saveSession(l)
    startWorkday({ jurisdiction: 'VIC', id: WD })
    render(<WorkdayView workdayId={WD} backLabelKey="common.backToHistory" onBack={() => {}} onOpenStop={() => {}} />)
    const button = screen.getByRole('button', { name: t('workday.pdf.open') })
    const stops = screen.getByText(t('workday.view.stopsHeading'))
    expect(button.compareDocumentPosition(stops) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('workday mode off', () => {
  beforeEach(() => {
    flag.on = false
  })

  it('no export button and no picker, so the PDF code is never reached', () => {
    const { container } = render(<WorkdayPdfExport legs={LEGS} workday={WORKDAY} />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('button', { name: t('workday.pdf.open') })).toBeNull()
    expect(screen.queryByText(t('workday.pdf.warning'))).toBeNull()
    expect(pdf.downloadWorkdayPdf).not.toHaveBeenCalled()
    expect(pdf.materializeRemotePhotosBatch).not.toHaveBeenCalled()
  })

  it('the workday view (unreachable from App with the flag off) has no export button either', () => {
    for (const l of LEGS) saveSession(l)
    render(<WorkdayView workdayId={WD} backLabelKey="common.backToHistory" onBack={() => {}} onOpenStop={() => {}} />)
    expect(screen.queryByRole('button', { name: t('workday.pdf.open') })).toBeNull()
  })
})
