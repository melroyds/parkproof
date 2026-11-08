// @vitest-environment happy-dom
//
// The unclear-sign screens (build spec T3 items 5 to 7):
// - ParkingResult: 'partially_obscured' and 'contradictory' keep the most
//   restrictive answer on the card, with a banner explaining the problem
//   (the AI's notes and "A sign that can't be read clearly is worth keeping
//   a record of."); the weekly restriction hint shows only when the sign has
//   one; the feedback telemetry carries the T3 fields.
// - NoReadableSign: the spec's exact copy and its two actions.
// - SessionLogger: a record logged from a T3 answer keeps rule_flags (with
//   is_area_sign), sign_status, sign_issues and recurring_restrictions; one
//   from a pre-T3 answer keeps none; the no-sign logger from the "no
//   readable sign" screen keeps the status and captions the photo.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from '../lib/photo-store'
import type { ParkingRules, ParkingSession, RecurringRestriction } from '../types'
import NoReadableSign from './NoReadableSign'
import ParkingResult from './ParkingResult'
import SessionLogger from './SessionLogger'

vi.mock('../lib/image', () => ({
  resizeImageFile: async (file: File) => ({
    dataUrl: 'data:image/jpeg;base64,' + btoa(await file.text()),
    mediaType: 'image/jpeg',
  }),
}))
vi.mock('../lib/geocode', () => ({ reverseGeocode: async () => null, forwardGeocode: async () => null }))

const PHOTO = 'data:image/jpeg;base64,' + btoa('scan-photo')
const WORTH_RECORDING = "A sign that can't be read clearly is worth keeping a record of."
const WEEKLY_HINT = 'This sign has a weekly restriction. You can set a reminder after you save.'

const SWEEP: RecurringRestriction = {
  kind: 'street_cleaning',
  days: ['TU'],
  start: '07:00',
  end: '09:00',
  week_of_month: [],
  exceptions_text: '',
  label: 'Street cleaning Tue 7am-9am',
}

function answer(overrides: Partial<ParkingRules> = {}): ParkingRules {
  return {
    sign_status: 'readable',
    sign_issues: [],
    rules: '2P Mon-Fri 8am-6pm',
    observations: [{ scope: 'Whole sign', items: ['2P'] }],
    can_park_now: true,
    until: new Date(Date.now() + 2 * 3600_000).toISOString(),
    duration_minutes: 120,
    confidence: 'high',
    requires_ticket: false,
    payment_methods: null,
    requires_disabled_permit: false,
    is_permit_zone: false,
    permit_area: null,
    is_area_sign: false,
    permit_exception: [],
    recurring_restrictions: [],
    next_transition: null,
    clarification: null,
    ...overrides,
  }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => cleanup())

function renderResult(result: ParkingRules) {
  return render(
    <ParkingResult
      result={result}
      signPhoto={PHOTO}
      coords={{ lat: -37.8136, lng: 144.9631 }}
      onScanAnother={vi.fn()}
      onLogSession={vi.fn()}
      onRetake={vi.fn()}
    />,
  )
}

describe('ParkingResult and an unclear sign', () => {
  it('partially obscured: the most restrictive answer stays on the card, with the banner and the notes', () => {
    renderResult(
      answer({
        sign_status: 'partially_obscured',
        sign_issues: ['Bottom plate faded', 'Top cut off by the photo'],
        can_park_now: false,
        until: null,
        duration_minutes: null,
        confidence: 'low',
      }),
    )
    // The answer card is still there, with the (restrictive) answer.
    expect(screen.getByRole('heading', { level: 2, name: i18n.t('result.cantPark') })).toBeTruthy()
    const banner = screen.getByRole('region', { name: i18n.t('unclearSign.obscuredTitle') })
    expect(banner.textContent).toContain(i18n.t('unclearSign.strictest'))
    expect(banner.textContent).toContain('Bottom plate faded')
    expect(banner.textContent).toContain('Top cut off by the photo')
    expect(banner.textContent).toContain(WORTH_RECORDING)
  })

  it('contradictory: the banner names the disagreement', () => {
    renderResult(answer({ sign_status: 'contradictory', sign_issues: ['Right arrow plates disagree'] }))
    expect(screen.getByRole('region', { name: i18n.t('unclearSign.contradictoryTitle') })).toBeTruthy()
    expect(screen.getByText(WORTH_RECORDING)).toBeTruthy()
    // The answer itself is unchanged.
    expect(screen.getByRole('heading', { level: 2, name: i18n.t('result.canPark') })).toBeTruthy()
  })

  it('a readable sign, or a pre-T3 answer, has no banner', () => {
    renderResult(answer())
    expect(screen.queryByText(WORTH_RECORDING)).toBeNull()
    cleanup()
    const { sign_status: _s, sign_issues: _i, ...preT3 } = answer()
    void _s
    void _i
    renderResult(preT3 as ParkingRules)
    expect(screen.queryByText(WORTH_RECORDING)).toBeNull()
  })

  it('the weekly restriction hint shows only when the sign has a weekly restriction', () => {
    renderResult(answer({ recurring_restrictions: [SWEEP] }))
    expect(screen.getByText(WEEKLY_HINT)).toBeTruthy()
    cleanup()
    renderResult(answer())
    expect(screen.queryByText(WEEKLY_HINT)).toBeNull()
  })

  it('the feedback telemetry carries the T3 fields (counts only)', () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      renderResult(answer({ sign_status: 'partially_obscured', sign_issues: ['Faded'], is_area_sign: true, recurring_restrictions: [SWEEP] }))
      fireEvent.click(screen.getByRole('button', { name: i18n.t('result.verifyYes') }))
      const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
      const body = JSON.parse(String(init.body))
      expect(body.context).toMatchObject({
        sign_status: 'partially_obscured',
        sign_issues_count: 1,
        is_area_sign: true,
        recurring_restrictions_count: 1,
      })
      expect(String(init.body)).not.toContain('Faded')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('NoReadableSign', () => {
  it("shows the spec's copy, the AI's notes and the photo; each action is wired", () => {
    const onRetake = vi.fn()
    const onLogWithoutSign = vi.fn()
    const onBack = vi.fn()
    render(
      <NoReadableSign
        result={answer({ sign_status: 'not_a_parking_sign', sign_issues: ['Photo shows a street name sign'], can_park_now: false })}
        signPhoto={PHOTO}
        onRetake={onRetake}
        onLogWithoutSign={onLogWithoutSign}
        onBack={onBack}
      />,
    )
    const heading = screen.getByRole('heading', { level: 2, name: 'No readable parking sign' })
    expect(document.activeElement).toBe(heading)
    expect(
      screen.getByText(
        "We couldn't find a readable parking sign in this photo. That doesn't mean there are no rules here. General road rules still apply, such as no parking within 10 metres of an intersection without traffic lights, and some areas have time limits without a sign on every street.",
      ),
    ).toBeTruthy()
    expect(screen.getByText('Photo shows a street name sign')).toBeTruthy()
    expect(screen.getByRole('img', { name: i18n.t('unclearSign.photoAlt') }).getAttribute('src')).toBe(PHOTO)
    // Never an answer: no "You can park" or "Don't park here".
    expect(screen.queryByText(i18n.t('result.canPark'))).toBeNull()
    expect(screen.queryByText(i18n.t('result.cantPark'))).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retake photo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Log without a sign' }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.back') }))
    expect(onRetake).toHaveBeenCalledTimes(1)
    expect(onLogWithoutSign).toHaveBeenCalledTimes(1)
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('SessionLogger keeps the reading on the record', () => {
  beforeEach(() => {
    setPhotoBackendForTests(createMemoryPhotoBackend())
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn() }, configurable: true })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => setPhotoBackendForTests(null))

  async function saveFrom(props: Partial<Parameters<typeof SessionLogger>[0]>): Promise<ParkingSession> {
    const onComplete = vi.fn<(s: ParkingSession) => void>()
    render(<SessionLogger rules={answer()} signPhoto={PHOTO} onComplete={onComplete} onCancel={vi.fn()} {...props} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.saveSession') }))
    })
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    return onComplete.mock.calls[0][0]
  }

  it('from a T3 answer: rule_flags with is_area_sign, the condition, notes and weekly restrictions', async () => {
    const saved = await saveFrom({
      rules: answer({
        sign_status: 'partially_obscured',
        sign_issues: ['Faded'],
        is_area_sign: true,
        requires_ticket: true,
        payment_methods: ['meter'],
        recurring_restrictions: [SWEEP],
      }),
    })
    expect(saved.sign_status).toBe('partially_obscured')
    expect(saved.sign_issues).toEqual(['Faded'])
    expect(saved.recurring_restrictions).toEqual([SWEEP])
    expect(saved.rule_flags).toEqual({
      requires_ticket: true,
      payment_methods: ['meter'],
      requires_disabled_permit: false,
      is_permit_zone: false,
      permit_area: null,
      is_area_sign: true,
    })
  })

  it('from a pre-T3 answer: none of the T3 fields', async () => {
    const { sign_status: _s, sign_issues: _i, is_area_sign: _a, recurring_restrictions: _r, ...preT3 } = answer()
    void [_s, _i, _a, _r]
    const saved = await saveFrom({ rules: preT3 as ParkingRules })
    for (const key of ['sign_status', 'sign_issues', 'rule_flags', 'recurring_restrictions']) {
      expect(saved).not.toHaveProperty(key)
    }
  })

  it('no-sign from the "no readable sign" screen: the status, the notes and the photo caption', async () => {
    const onComplete = vi.fn<(s: ParkingSession) => void>()
    render(
      <SessionLogger
        mode="no-sign"
        rules={null}
        signPhoto={null}
        ambientPhoto={PHOTO}
        ambientPhotoMeta={{ captured_at: '2026-11-02T21:59:00.000Z', source: 'camera_input' }}
        noSignReading={{ sign_status: 'missing', sign_issues: ['Empty pole'] }}
        onComplete={onComplete}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText('Photo taken where you parked. ParkProof found no readable parking sign in it.')).toBeTruthy()
    expect(screen.queryByText(i18n.t('logger.ambientCaption'))).toBeNull()
    // The driver isn't saying there was no sign, only logging without one.
    expect(screen.getByText(i18n.t('unclearSign.loggerBanner'))).toBeTruthy()
    expect(screen.queryByText(i18n.t('logger.noSignBanner'))).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.saveSession') }))
    })
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const saved = onComplete.mock.calls[0][0]
    expect(saved.no_sign).toBe(true)
    expect(saved.sign_status).toBe('missing')
    expect(saved.sign_issues).toEqual(['Empty pole'])
    expect(saved.photos?.map((p) => p.role)).toEqual(['ambient'])
  })

  it('the ordinary no-sign path keeps its own caption and adds no status', async () => {
    const onComplete = vi.fn<(s: ParkingSession) => void>()
    render(
      <SessionLogger mode="no-sign" rules={null} signPhoto={null} ambientPhoto={PHOTO} onComplete={onComplete} onCancel={vi.fn()} />,
    )
    expect(screen.getByText(i18n.t('logger.ambientCaption'))).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.saveSession') }))
    })
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete.mock.calls[0][0]).not.toHaveProperty('sign_status')
  })
})
