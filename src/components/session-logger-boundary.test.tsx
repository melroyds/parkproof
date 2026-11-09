// @vitest-environment happy-dom
//
// The boundary question in the logger (build spec T6b item 8): the only
// step that may block a workday stop's Save. Moving a few bays doesn't
// restart a time limit (Road Rules r205(2), r332) and under an area sign
// the whole area counts (r335), so the copy is the spec's own, nothing is
// answered for the driver, and an answer that names no boundary keeps the
// original limit running. With VITE_FEATURE_WORKDAY off none of it shows.
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from '../lib/photo-store'
import { saveSession } from '../lib/storage'
import { formatInZone, isSameDayInZone, zoneNameInZone } from '../lib/time-format'
import type { ReverseGeocodeDetails } from '../lib/geocode'
import type { StretchCheck } from '../lib/workday'
import type { StopOutcome } from '../lib/workday-boundary'
import type { LogDraft, ParkingRules, ParkingSession, RuleFlags } from '../types'
import BoundaryQuestion from './BoundaryQuestion'
import SessionLogger from './SessionLogger'

const flag = vi.hoisted(() => ({ on: true }))
const geo = vi.hoisted(() => ({ reverse: vi.fn<(lat: number, lng: number) => Promise<ReverseGeocodeDetails | null>>() }))
vi.mock('../lib/geocode', () => ({ reverseGeocodeDetails: geo.reverse, forwardGeocode: vi.fn() }))
vi.mock('../lib/features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/features')>()),
  isWorkdayEnabled: () => flag.on,
}))

const W = '0f0e0d0c-1111-4111-8111-111111111111'
const MIN = 60_000
const ZONE = 'Australia/Melbourne'
const SIGN = 'data:image/jpeg;base64,' + btoa('scan-sign-bytes')
const KING: ReverseGeocodeDetails = { address: '14 King Street, Melbourne Victoria', road: 'King Street', suburb: 'Melbourne', state_code: 'AU-VIC' }
const LYGON: ReverseGeocodeDetails = { address: '300 Lygon Street, Carlton Victoria', road: 'Lygon Street', suburb: 'Carlton', state_code: 'AU-VIC' }

/** The spec's wording (build spec T6b item 8), to the letter. */
const SPEC = {
  title: 'This may be the same signed stretch.',
  body: "Moving bays doesn't restart the time limit. Did you pass one of these on the way here?",
  options: [
    "A sign showing this zone had ended (a two-way arrow sign in the middle of the block doesn't count)",
    'A yellow edge line',
    'The end of the road at a T-intersection or dead end',
    "I'm not sure",
  ],
  area: "This is a parking area. Moving to another street inside it doesn't count. You need to leave the whole area.",
  areaOptions: ['I drove out of the parking area, past a sign saying it ends', "I'm not sure"],
  footer: "If you're not sure, your original time limit is still running.",
  saveAnyway: 'Save anyway',
  dontSave: "Don't save this stop",
}

const FLAGS = (is_area_sign: boolean): RuleFlags => ({
  requires_ticket: false,
  payment_methods: null,
  requires_disabled_permit: false,
  is_permit_zone: false,
  permit_area: null,
  is_area_sign,
})

let now = 0
function previousLeg(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'leg-0',
    arrived_at: new Date(now - 60 * MIN).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P 8am-6pm Mon-Fri',
    observations: [],
    expires_at: new Date(now + 60 * MIN).toISOString(),
    confidence: 'high',
    rule_flags: FLAGS(false),
    place: { road: 'King St', suburb: 'Melbourne', state_code: 'AU-VIC' },
    workday_id: W,
    leg_index: 0,
    ...overrides,
  }
}

const rules = (): ParkingRules => ({
  rules: '1P 8am-6pm Mon-Fri',
  observations: [],
  can_park_now: true,
  until: new Date(now + 3 * 60 * MIN).toISOString(),
  duration_minutes: 60,
  confidence: 'high',
  clarification: null,
  sign_status: 'readable',
  is_area_sign: false,
})

const draft = (): LogDraft => ({
  gate_acks: { meter_ticket: null, permit_zone: null, accessible_permit: null },
  permit_context: null,
  workday: { workday_id: W, leg_index: 1, previous_session_id: 'leg-0' },
  driver_name: null,
})

type Fix = { lat: number; lng: number; accuracy: number } | 'pending'
function setGps(fix: Fix) {
  Object.defineProperty(navigator, 'geolocation', {
    value: {
      getCurrentPosition: (ok: PositionCallback) => {
        if (fix !== 'pending') ok({ coords: { latitude: fix.lat, longitude: fix.lng, accuracy: fix.accuracy } } as GeolocationPosition)
      },
    },
    configurable: true,
  })
}
const NEAR: Fix = { lat: -37.81351, lng: 144.9631, accuracy: 6 } // about 10 m along King St
const FAR: Fix = { lat: -37.8046, lng: 144.9631, accuracy: 6 } // about 1 km away

let photos: ReturnType<typeof createMemoryPhotoBackend>
beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  now = Date.now()
  flag.on = true
  localStorage.clear()
  photos = createMemoryPhotoBackend()
  setPhotoBackendForTests(photos)
  geo.reverse.mockReset()
  geo.reverse.mockResolvedValue(KING)
  setGps(NEAR)
})
afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
})

function renderLogger(r: ParkingRules = rules()) {
  const onComplete = vi.fn<(s: ParkingSession) => void>()
  const onCancel = vi.fn()
  render(<SessionLogger rules={r} signPhoto={SIGN} draft={draft()} onComplete={onComplete} onCancel={onCancel} />)
  return { onComplete, onCancel }
}
const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.saveSession') }))
  })
}
const question = () => screen.queryByTestId('boundary-question')
const radioNames = () => within(question()!).getAllByRole('radio').map((r) => r.closest('label')!.textContent)
/** A time as the lines name it: the day only when it isn't today, the zone only across a daylight saving change. */
const at = (iso: string) =>
  formatInZone(iso, ZONE, {
    withDate: !isSameDayInZone(iso, now, ZONE),
    withZone: zoneNameInZone(iso, ZONE) !== zoneNameInZone(now, ZONE),
  })

describe('the boundary question', () => {
  it('asks a few metres along the same road, in the spec words, and blocks Save until answered', async () => {
    saveSession(previousLeg())
    const { onComplete } = renderLogger()
    await waitFor(() => expect(question()).not.toBeNull())

    const q = within(question()!)
    expect(q.getByText(SPEC.title)).toBeTruthy()
    expect(q.getByText(SPEC.body)).toBeTruthy()
    expect(q.getByText(SPEC.footer)).toBeTruthy()
    expect(radioNames()).toEqual(SPEC.options)
    // Nothing is answered for the driver.
    expect(q.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false)

    await save()
    expect(onComplete).not.toHaveBeenCalled()
    expect(q.getByRole('alert').textContent).toBe(i18n.t('workday.boundary.required'))
    // "I'm not sure" is where focus goes.
    await waitFor(() => expect(document.activeElement).toBe(q.getByRole('radio', { name: "I'm not sure" })))
  })

  it(`"I'm not sure" is focused by default when the question shows, and never checked`, async () => {
    saveSession(previousLeg())
    const { onComplete } = renderLogger()
    await waitFor(() => expect(question()).not.toBeNull())
    const notSure = screen.getByRole('radio', { name: "I'm not sure" }) as HTMLInputElement
    // Before any Save: focus is on it, and nothing is answered for the driver.
    await waitFor(() => expect(document.activeElement).toBe(notSure))
    expect(notSure.checked).toBe(false)
    expect(within(question()!).getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('never pulls focus out of a field the driver is typing in', async () => {
    saveSession(previousLeg())
    let answerLookup: (d: ReverseGeocodeDetails) => void = () => {}
    geo.reverse.mockImplementation(() => new Promise((resolve) => (answerLookup = resolve)))
    renderLogger()
    const label = i18n.t('logger.driver.label')
    fireEvent.click(screen.getByRole('button', { name: (n) => n.startsWith(label) }))
    const name = screen.getByLabelText(i18n.t('logger.driver.label'), { selector: 'input' })
    name.focus()
    expect(document.activeElement).toBe(name)
    // The place lookup answers: the question shows, and focus stays in the field.
    await act(async () => answerLookup(KING))
    await waitFor(() => expect(question()).not.toBeNull())
    expect(document.activeElement).toBe(name)
  })

  it(`"I'm not sure" under a new sign whose own limit ends first: the line names that time, the one the stop is saved with`, async () => {
    const prev = previousLeg() // the stretch's limit ends in 60 minutes
    saveSession(prev)
    const signFirst = new Date(now + 30 * MIN).toISOString()
    renderLogger({ ...rules(), until: signFirst })
    await waitFor(() => expect(question()).not.toBeNull())
    fireEvent.click(screen.getByRole('radio', { name: "I'm not sure" }))
    expect(
      screen.getByText(`Your limit on this stretch still runs from ${at(prev.arrived_at)}. Move the car off this stretch by ${at(signFirst)}.`),
    ).toBeTruthy()
    expect(screen.queryByText(new RegExp(`by ${at(prev.expires_at!)}`))).toBeNull()
  })

  it('a named boundary: the new-limit line, and the statement saved as the driver gave it', async () => {
    saveSession(previousLeg())
    const { onComplete } = renderLogger()
    await waitFor(() => expect(question()).not.toBeNull())
    fireEvent.click(screen.getByRole('radio', { name: 'A yellow edge line' }))
    expect(screen.getByText('New limit based on what you told us: you passed a yellow edge line.')).toBeTruthy()

    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const saved = onComplete.mock.calls[0][0]
    expect(saved.boundary).toMatchObject({
      previous_session_id: 'leg-0',
      answer: 'yellow_edge_line',
      asked_because: ['within_30m', 'same_street'],
    })
    expect(saved.boundary!.distance_from_previous_m).toBeGreaterThan(5)
    expect(saved.boundary!.distance_from_previous_m).toBeLessThan(30)
    // The logger keeps the sign's own limit; App works out the stop's (stopLimitFields).
    expect(saved.expires_at).toBe(rules().until)
  })

  it('"I\'m not sure": the original limit still runs, from when it started, until it ends', async () => {
    const prev = previousLeg()
    saveSession(prev)
    const { onComplete } = renderLogger()
    await waitFor(() => expect(question()).not.toBeNull())
    fireEvent.click(screen.getByRole('radio', { name: "I'm not sure" }))
    expect(
      screen.getByText(
        `Your limit on this stretch still runs from ${at(prev.arrived_at)}. Move the car off this stretch by ${at(prev.expires_at!)}.`,
      ),
    ).toBeTruthy()
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete.mock.calls[0][0].boundary).toMatchObject({ answer: 'not_sure' })
  })

  it('time already up on the stretch: only "Save anyway" or "Don\'t save this stop", which keeps nothing', async () => {
    saveSession(previousLeg({ expires_at: new Date(now - 5 * MIN).toISOString() }))
    const { onComplete, onCancel } = renderLogger()
    await waitFor(() => expect(question()).not.toBeNull())
    await waitFor(() => expect(photos.records.size).toBe(1)) // the sign photo, stored when the logger opened
    fireEvent.click(screen.getByRole('radio', { name: "I'm not sure" }))

    const ended = at(new Date(now - 5 * MIN).toISOString())
    expect(screen.getByText(`Your time on this stretch ended at ${ended}. Move the car off this stretch now.`)).toBeTruthy()
    expect(screen.queryByRole('button', { name: i18n.t('logger.saveSession') })).toBeNull()
    expect(screen.queryByRole('button', { name: i18n.t('common.cancel') })).toBeNull()
    expect(screen.getByRole('button', { name: SPEC.saveAnyway })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: SPEC.dontSave }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onComplete).not.toHaveBeenCalled()
    await waitFor(() => expect(photos.records.size).toBe(0))
  })

  it('"Save anyway" saves the stop with the driver\'s answer', async () => {
    saveSession(previousLeg({ expires_at: new Date(now - 5 * MIN).toISOString() }))
    const { onComplete } = renderLogger()
    await waitFor(() => expect(question()).not.toBeNull())
    fireEvent.click(screen.getByRole('radio', { name: "I'm not sure" }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: SPEC.saveAnyway }))
    })
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete.mock.calls[0][0].boundary).toMatchObject({ answer: 'not_sure' })
  })

  it('under an area sign: the area question, with only its two answers, even far away', async () => {
    saveSession(previousLeg({ rules: '2P Parking Area', rule_flags: FLAGS(true) }))
    setGps(FAR)
    geo.reverse.mockResolvedValue(LYGON)
    const { onComplete } = renderLogger()
    await waitFor(() => expect(question()).not.toBeNull())
    const q = within(question()!)
    expect(q.getByText(SPEC.area)).toBeTruthy()
    expect(q.queryByText(SPEC.title)).toBeNull()
    expect(radioNames()).toEqual(SPEC.areaOptions)
    fireEvent.click(screen.getByRole('radio', { name: SPEC.areaOptions[1] }))
    expect(screen.getByText(/^Your limit in this parking area still runs from /)).toBeTruthy()
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete.mock.calls[0][0].boundary!.asked_because).toContain('area_sign')
  })

  it("GPS not in when Save is tapped: treated as unreliable, so it asks", async () => {
    saveSession(previousLeg())
    setGps('pending')
    const { onComplete } = renderLogger()
    // Nothing shows while the fix is still coming in.
    expect(question()).toBeNull()
    await save()
    expect(onComplete).not.toHaveBeenCalled()
    await waitFor(() => expect(question()).not.toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('radio', { name: "I'm not sure" })))
    fireEvent.click(screen.getByRole('radio', { name: "I'm not sure" }))
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const saved = onComplete.mock.calls[0][0]
    expect(saved.location).toBeNull()
    expect(saved.boundary).toMatchObject({ answer: 'not_sure', asked_because: ['location_unreliable'], distance_from_previous_m: null })
  })

  it("doesn't ask a kilometre away on another road: saved as not asked", async () => {
    saveSession(previousLeg())
    setGps(FAR)
    geo.reverse.mockResolvedValue(LYGON)
    const { onComplete } = renderLogger()
    await waitFor(() => expect(screen.getByText(/300 Lygon Street/)).toBeTruthy())
    expect(question()).toBeNull()
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete.mock.calls[0][0].boundary).toMatchObject({ answer: 'not_asked', asked_because: [] })
  })

  it('the first stop has no question and no statement', async () => {
    const { onComplete } = renderLogger()
    await waitFor(() => expect(screen.getByText(/14 King Street/)).toBeTruthy())
    expect(question()).toBeNull()
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete.mock.calls[0][0].boundary).toBeNull()
  })

  it('with VITE_FEATURE_WORKDAY off, no question shows and nothing workday is saved', async () => {
    flag.on = false
    saveSession(previousLeg())
    const { onComplete } = renderLogger()
    await waitFor(() => expect(screen.getByText(/14 King Street/)).toBeTruthy())
    expect(question()).toBeNull()
    expect(screen.queryByText(SPEC.title)).toBeNull()
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect('boundary' in onComplete.mock.calls[0][0]).toBe(false)
  })
})

describe('the times the lines name, with a fixed clock (literal text)', () => {
  const CHECK: StretchCheck = { ask: true, area_mode: false, asked_because: ['within_30m'], distance_from_previous_m: 8 }
  /** The outcome of "I'm not sure" with the running limit from `start`, to move by `moveBy`. */
  const outcome = (start: string, moveBy: string, at: number): StopOutcome => ({
    deadline: {
      starts_new_limit: false,
      stretch_deadline: moveBy,
      expires_at: moveBy,
      limited_by: 'stretch',
      deadline_passed: Date.parse(moveBy) <= at,
    },
    stretch_start: start,
    move_by: moveBy,
    move_by_passed: Date.parse(moveBy) <= at,
  })
  const show = (timeZone: string, start: string, moveBy: string, nowIso: string) => {
    const at = Date.parse(nowIso)
    render(
      <BoundaryQuestion
        check={CHECK}
        answer="not_sure"
        onAnswer={vi.fn()}
        outcome={outcome(start, moveBy, at)}
        startsNewLimit={false}
        required={false}
        notSureRef={createRef<HTMLInputElement>()}
        timeZone={timeZone}
        now={at}
        onSaveAnyway={vi.fn()}
        onDontSave={vi.fn()}
      />,
    )
  }

  it('Melbourne, the night daylight saving starts (2026-10-04): the zone only on the time past the change', () => {
    // Now 1:30 am AEST; the limit started at 12:30 am AEST and ends at 3:30 am AEDT.
    show(ZONE, '2026-10-03T14:30:00Z', '2026-10-03T16:30:00Z', '2026-10-03T15:30:00Z')
    expect(screen.getByText('Your limit on this stretch still runs from 12:30 am. Move the car off this stretch by 3:30 am AEDT.')).toBeTruthy()
  })

  it('Melbourne, the night daylight saving ends (2027-04-04): AEST on the time past the change', () => {
    // Now 1:30 am AEDT; the limit started at 12:30 am AEDT and ends at 3:30 am AEST.
    show(ZONE, '2027-04-03T13:30:00Z', '2027-04-03T17:30:00Z', '2027-04-03T14:30:00Z')
    expect(screen.getByText('Your limit on this stretch still runs from 12:30 am. Move the car off this stretch by 3:30 am AEST.')).toBeTruthy()
  })

  it('Brisbane, the same night: no daylight saving, so no zone name at all', () => {
    show('Australia/Brisbane', '2026-10-03T14:30:00Z', '2026-10-03T16:30:00Z', '2026-10-03T15:30:00Z')
    expect(screen.getByText('Your limit on this stretch still runs from 12:30 am. Move the car off this stretch by 2:30 am.')).toBeTruthy()
  })

  it('a time on another day carries the day, and none on the same side of a change carries a zone', () => {
    // Now 11:30 pm AEDT on Monday 9 November; the limit ends at 12:30 am on Tuesday.
    show(ZONE, '2026-11-09T11:30:00Z', '2026-11-09T13:30:00Z', '2026-11-09T12:30:00Z')
    expect(
      screen.getByText('Your limit on this stretch still runs from 10:30 pm. Move the car off this stretch by Tue 10 Nov, 12:30 am.'),
    ).toBeTruthy()
  })

  it('a deadline already passed, across the change: the time with its zone', () => {
    // Now 3:45 am AEDT; the time ran out at 1:45 am AEST.
    show(ZONE, '2026-10-03T13:45:00Z', '2026-10-03T15:45:00Z', '2026-10-03T16:45:00Z')
    expect(screen.getByText('Your time on this stretch ended at 1:45 am AEST. Move the car off this stretch now.')).toBeTruthy()
  })
})
