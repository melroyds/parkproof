// @vitest-environment happy-dom
//
// AppealFlow from the notice lookup (build spec T8 item 5): with an
// `initialNotice` the flow skips capture and drafts from that photo at
// once, exactly once even under StrictMode's double effects; the review
// never shows the model's "Strong evidence" style verdict; and the back
// link can be relabelled for the screen the driver came from.
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import type { AppealDraft, ParkingSession } from '../types'
import AppealFlow from './AppealFlow'

const mocks = vi.hoisted(() => ({
  draftAppeal: vi.fn<(base64: string, mediaType: string, session: unknown) => Promise<AppealDraft>>(),
}))
vi.mock('../lib/claude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/claude')>()),
  draftAppeal: mocks.draftAppeal,
}))
vi.mock('../lib/pdf', () => ({ materializeRemotePhotos: async (s: ParkingSession) => s, downloadAppealPdf: () => {} }))
vi.mock('../lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))

const NOTICE = { dataUrl: 'data:image/png;base64,Tk9USUNF', mediaType: 'image/png' }

function draft(strength: AppealDraft['evidence_strength']): AppealDraft {
  return {
    ticket_summary: 'Notice 123 for overstaying a 2P zone.',
    appeal_subject: 'Request for review of notice 123',
    appeal_letter: 'Dear Sir or Madam, ...',
    evidence_strength: strength,
    notes: 'Mention the time you left.',
  }
}

const SESSION: ParkingSession = {
  id: 'rec-1',
  arrived_at: '2026-10-25T01:31:00.000Z',
  location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
  sign_photo: null,
  car_photo: null,
  rules: '2P',
  observations: [],
  expires_at: null,
  confidence: 'high',
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  mocks.draftAppeal.mockReset()
})
afterEach(() => {
  cleanup()
})

describe('AppealFlow with an initial notice', () => {
  it('skips capture: the first paint is the drafting screen, and it drafts from that photo', async () => {
    const pending = deferred<AppealDraft>()
    mocks.draftAppeal.mockReturnValue(pending.promise)
    render(<AppealFlow session={SESSION} initialNotice={NOTICE} onBack={() => {}} />)
    expect(screen.getByText(i18n.t('appeal.draftingHeader'))).toBeTruthy()
    expect(screen.queryByText(i18n.t('scanner.takePhoto'))).toBeNull()
    expect(mocks.draftAppeal).toHaveBeenCalledTimes(1)
    expect(mocks.draftAppeal).toHaveBeenCalledWith('Tk9USUNF', 'image/png', SESSION)
    await act(async () => pending.resolve(draft('moderate')))
    expect(screen.getByText(i18n.t('appeal.reviewHeader'))).toBeTruthy()
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Dear Sir or Madam, ...')
  })

  it('drafts once under StrictMode, and still shows the result', async () => {
    const pending = deferred<AppealDraft>()
    mocks.draftAppeal.mockReturnValue(pending.promise)
    render(
      <StrictMode>
        <AppealFlow session={null} initialNotice={NOTICE} onBack={() => {}} />
      </StrictMode>,
    )
    expect(mocks.draftAppeal).toHaveBeenCalledTimes(1)
    expect(mocks.draftAppeal).toHaveBeenCalledWith('Tk9USUNF', 'image/png', null)
    await act(async () => pending.resolve(draft('weak')))
    expect(screen.getByText(i18n.t('appeal.reviewHeader'))).toBeTruthy()
    expect(mocks.draftAppeal).toHaveBeenCalledTimes(1)
  })

  it('a failed draft shows the error, and "Try a different photo" goes to capture without drafting again', async () => {
    mocks.draftAppeal.mockRejectedValue(new Error('That photo is too large.'))
    render(<AppealFlow session={SESSION} initialNotice={NOTICE} onBack={() => {}} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('That photo is too large.')
    fireEvent.click(screen.getByRole('button', { name: i18n.t('appeal.tryDifferentPhoto') }))
    expect(screen.getByText(i18n.t('scanner.takePhoto'))).toBeTruthy()
    expect(mocks.draftAppeal).toHaveBeenCalledTimes(1)
  })

  it('without an initial notice it starts at capture and drafts nothing', () => {
    render(<AppealFlow session={SESSION} onBack={() => {}} />)
    expect(screen.getByText(i18n.t('appeal.captureHeader'))).toBeTruthy()
    expect(mocks.draftAppeal).not.toHaveBeenCalled()
  })

  it('a later initialNotice prop does not start a second draft', async () => {
    mocks.draftAppeal.mockResolvedValue(draft('weak'))
    const { rerender } = render(<AppealFlow session={SESSION} initialNotice={NOTICE} onBack={() => {}} />)
    await screen.findByText(i18n.t('appeal.reviewHeader'))
    rerender(<AppealFlow session={SESSION} initialNotice={{ ...NOTICE, dataUrl: 'data:image/png;base64,T1RIRVI=' }} onBack={() => {}} />)
    expect(mocks.draftAppeal).toHaveBeenCalledTimes(1)
  })
})

describe('AppealFlow review', () => {
  it.each(['strong', 'moderate', 'weak'] as const)('never shows a verdict label (%s)', async (strength) => {
    mocks.draftAppeal.mockResolvedValue(draft(strength))
    render(<AppealFlow session={SESSION} initialNotice={NOTICE} onBack={() => {}} />)
    await screen.findByText(i18n.t('appeal.reviewHeader'))
    const text = document.body.textContent ?? ''
    // The old labels ("Strong evidence" and so on), or the model's raw
    // evidence_strength printed in any other form.
    expect(text).not.toMatch(/\b(strong|moderate|weak)\s+evidence\b/i)
    expect(text).not.toMatch(/evidence[_\s]strength/i)
    expect(text.toLowerCase()).not.toContain(strength)
  })
})

describe('AppealFlow back link', () => {
  it('defaults to the record or home, and takes a label from the screen the driver came from', async () => {
    const onBack = vi.fn()
    render(<AppealFlow session={SESSION} onBack={onBack} />)
    expect(screen.getByRole('button', { name: i18n.t('common.backToSession') })).toBeTruthy()
    cleanup()
    render(<AppealFlow session={null} onBack={onBack} />)
    expect(screen.getByRole('button', { name: i18n.t('common.backToHome') })).toBeTruthy()
    cleanup()
    mocks.draftAppeal.mockResolvedValue(draft('weak'))
    render(<AppealFlow session={SESSION} initialNotice={NOTICE} backLabelKey="common.back" onBack={onBack} />)
    await screen.findByText(i18n.t('appeal.reviewHeader'))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.back') }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
