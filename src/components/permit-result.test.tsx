// @vitest-environment happy-dom
//
// The result screen with saved permits (build spec T4 items 4 to 6):
// - the deterministic area match in a permit zone, which never ticks a gate;
// - the accessible-permit safeguard, worded as the spec gives it, with its
//   "no" path that keeps Save blocked;
// - the resident and business question, with holder_present null;
// - a printed exception shown as a permit answer apart from the standard
//   answer, and the later permit time the driver may type in from the sign;
// - "Your permit may allow more time under {{state}} rules..." when the sign
//   prints nothing for the driver's permit;
// - what the screen hands to the logging draft (gate answers, permit context).
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import type { Jurisdiction, ParkingRules, PermitException, SavedPermit } from '../types'
import type { ResultAnswers } from '../lib/permit-answer'
import ParkingResult from './ParkingResult'

vi.mock('../lib/feedback', () => ({ submitFeedback: vi.fn() }))

const PHOTO = 'data:image/jpeg;base64,' + btoa('scan-photo')
const MELBOURNE = { lat: -37.8136, lng: 144.9631 }

const ACCESSIBLE: SavedPermit = { id: 'p-acc', type: 'accessible', state: 'VIC', area: null, expires_on: null }
const RESIDENT: SavedPermit = { id: 'p-res', type: 'resident', state: 'VIC', area: 'Area 25', expires_on: null }

const SAVE = 'Save & remind me'
const SAFEGUARD = 'The permit holder is in the car with me and getting out here, and their permit is displayed.'
const SAFEGUARD_NO = "Then the permit can't be used for this park. Don't park in the accessible bay."
const FOR_THIS_CAR = 'Is this permit for this car, and displayed or registered to it?'

function answer(over: Partial<ParkingRules> = {}): ParkingRules {
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
    ...over,
  }
}

function renderResult(
  result: ParkingRules,
  permits: SavedPermit[],
  parkingState: Jurisdiction | null = 'VIC',
): { onLogSession: ReturnType<typeof vi.fn<(a: ResultAnswers) => void>> } {
  const onLogSession = vi.fn<(a: ResultAnswers) => void>()
  render(
    <ParkingResult
      result={result}
      signPhoto={PHOTO}
      coords={MELBOURNE}
      onScanAnother={() => {}}
      onLogSession={onLogSession}
      onRetake={() => {}}
      permits={permits}
      parkingState={parkingState}
    />,
  )
  return { onLogSession }
}

const saveButton = () => screen.getByRole('button', { name: /save|confirm/i })

/** 'HH:MM' on a Melbourne clock, `ms` from now. */
function melbourneClock(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Melbourne',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(Date.now() + ms))
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => cleanup())

describe('the accessible-permit gate', () => {
  it('asks the safeguard question with a saved accessible permit, and only "Yes" lets the driver save', () => {
    const { onLogSession } = renderResult(answer({ requires_disabled_permit: true }), [ACCESSIBLE])
    // The tick box is replaced by the question.
    expect(screen.queryByText(i18n.t('result.permitRequired.ack'))).toBeNull()
    const question = screen.getByRole('group', { name: SAFEGUARD })
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(question).getByRole('radio', { name: 'No' }))
    expect(screen.getByRole('alert').textContent).toBe(SAFEGUARD_NO)
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(question).getByRole('radio', { name: 'Yes' }))
    expect(screen.queryByText(SAFEGUARD_NO)).toBeNull()
    const save = screen.getByRole('button', { name: SAVE })
    expect((save as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(save)

    expect(onLogSession).toHaveBeenCalledTimes(1)
    expect(onLogSession.mock.calls[0][0]).toEqual({
      gate_acks: { meter_ticket: null, permit_zone: null, accessible_permit: true },
      permit_context: {
        type: 'accessible',
        area: null,
        holder_present: true,
        sign_exception_applies: false,
        standard_until: expect.stringMatching(/Z$/),
        permit_until: null,
        note: null,
      },
    })
  })

  it('keeps its tick box when no accessible permit is saved, and records no permit', () => {
    const { onLogSession } = renderResult(answer({ requires_disabled_permit: true }), [RESIDENT])
    expect(screen.queryByRole('group', { name: SAFEGUARD })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: i18n.t('result.permitRequired.ack') }))
    fireEvent.click(screen.getByRole('button', { name: SAVE }))
    expect(onLogSession.mock.calls[0][0]).toEqual({
      gate_acks: { meter_ticket: null, permit_zone: null, accessible_permit: true },
      permit_context: null,
    })
  })
})

describe('the permit-zone gate', () => {
  it('compares the saved area without ticking anything, then asks whether the permit is for this car', () => {
    const { onLogSession } = renderResult(answer({ is_permit_zone: true, permit_area: '25', until: null }), [RESIDENT])
    expect(screen.getByText('Your saved permit for Area 25 matches this zone.')).toBeTruthy()
    // A match never answers for the driver.
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('checkbox')).toBeNull()

    const question = screen.getByRole('group', { name: FOR_THIS_CAR })
    fireEvent.click(within(question).getByRole('radio', { name: 'No' }))
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('result.permit.forThisCarNo'))
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(question).getByRole('radio', { name: 'Yes' }))
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: SAVE }))
    expect(onLogSession.mock.calls[0][0]).toEqual({
      gate_acks: { meter_ticket: null, permit_zone: true, accessible_permit: null },
      permit_context: {
        type: 'resident',
        area: 'Area 25',
        holder_present: null,
        sign_exception_applies: false,
        standard_until: null,
        permit_until: null,
        note: null,
      },
    })
  })

  it('says so when the saved permit is for another area, and keeps the zone\'s own tick box', () => {
    const { onLogSession } = renderResult(answer({ is_permit_zone: true, permit_area: '25' }), [
      { ...RESIDENT, area: 'Area 12' },
    ])
    expect(screen.getByText('Your saved permit is for Area 12. This zone is Permit Area 25.')).toBeTruthy()
    expect(screen.queryByText(/matches this zone/)).toBeNull()
    // The saved permit isn't offered: no "for this car" question to say yes to.
    expect(screen.queryByRole('group', { name: FOR_THIS_CAR })).toBeNull()
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)

    // Only the driver's own tick for this zone passes the gate, and no permit is recorded.
    fireEvent.click(screen.getByRole('checkbox', { name: i18n.t('result.permitZone.ackWithArea', { area: '25' }) }))
    fireEvent.click(screen.getByRole('button', { name: SAVE }))
    expect(onLogSession.mock.calls[0][0]).toEqual({
      gate_acks: { meter_ticket: null, permit_zone: true, accessible_permit: null },
      permit_context: null,
    })
  })

  it('after "No" to a matched permit, offers the zone\'s own tick box for another valid permit, and records no permit', () => {
    const { onLogSession } = renderResult(answer({ is_permit_zone: true, permit_area: '25' }), [RESIDENT])
    const ack = i18n.t('result.permitZone.ackWithArea', { area: '25' })
    const question = screen.getByRole('group', { name: FOR_THIS_CAR })
    fireEvent.click(within(question).getByRole('radio', { name: 'No' }))
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('result.permit.forThisCarNo'))

    // Never ticked for the driver: Save stays blocked until they tick it.
    const tick = screen.getByRole('checkbox', { name: ack }) as HTMLInputElement
    expect(tick.checked).toBe(false)
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(tick)
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)

    // Back to "Yes": the matched permit passes on its own, and the tick box goes.
    fireEvent.click(within(question).getByRole('radio', { name: 'Yes' }))
    expect(screen.queryByRole('checkbox', { name: ack })).toBeNull()
    fireEvent.click(within(question).getByRole('radio', { name: 'No' }))
    expect((screen.getByRole('checkbox', { name: ack }) as HTMLInputElement).checked).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: SAVE }))
    expect(onLogSession.mock.calls[0][0]).toEqual({
      gate_acks: { meter_ticket: null, permit_zone: true, accessible_permit: null },
      permit_context: null,
    })
  })

  it('after "No" to a permit with no area, a tick given before the answer does not carry over', () => {
    const { onLogSession } = renderResult(answer({ is_permit_zone: true, permit_area: '25' }), [
      { ...RESIDENT, area: null },
    ])
    const ack = i18n.t('result.permitZone.ackWithArea', { area: '25' })
    fireEvent.click(screen.getByRole('checkbox', { name: ack }))
    const question = screen.getByRole('group', { name: FOR_THIS_CAR })
    fireEvent.click(within(question).getByRole('radio', { name: 'No' }))

    // One tick box only, below the answer, and unticked.
    const ticks = screen.getAllByRole('checkbox', { name: ack }) as HTMLInputElement[]
    expect(ticks).toHaveLength(1)
    expect(ticks[0].checked).toBe(false)
    expect(question.compareDocumentPosition(ticks[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(ticks[0])
    fireEvent.click(screen.getByRole('button', { name: SAVE }))
    expect(onLogSession.mock.calls[0][0]).toEqual({
      gate_acks: { meter_ticket: null, permit_zone: true, accessible_permit: null },
      permit_context: null,
    })
  })

  it('asks for the zone tick as well when the saved permit has no area to compare', () => {
    const { onLogSession } = renderResult(answer({ is_permit_zone: true, permit_area: '25' }), [
      { ...RESIDENT, area: null },
    ])
    const tick = screen.getByRole('checkbox', { name: i18n.t('result.permitZone.ackWithArea', { area: '25' }) })
    const question = screen.getByRole('group', { name: FOR_THIS_CAR })

    // "Yes" alone says only that the permit is for this car: not enough.
    fireEvent.click(within(question).getByRole('radio', { name: 'Yes' }))
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(tick)
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: SAVE }))
    expect(onLogSession.mock.calls[0][0]).toMatchObject({
      gate_acks: { permit_zone: true },
      permit_context: { type: 'resident', area: null, holder_present: null },
    })
  })

  it('shows the area line in the zone even when the accessible gate takes the accessible permit', () => {
    renderResult(answer({ is_permit_zone: true, permit_area: '25', requires_disabled_permit: true }), [ACCESSIBLE, RESIDENT])
    expect(screen.getByRole('group', { name: SAFEGUARD })).toBeTruthy()
    expect(screen.getByText('Your saved permit for Area 25 matches this zone.')).toBeTruthy()
    // One permit per park: the zone keeps its tick box.
    expect(screen.getByRole('checkbox', { name: i18n.t('result.permitZone.ackWithArea', { area: '25' }) })).toBeTruthy()
  })
})

describe('a permit exception printed on the sign', () => {
  const PRINTED: PermitException[] = [{ applies: true, permit_type: 'accessible', text: 'DISABLED PERMIT HOLDERS 4P' }]

  it('shows the permit answer apart from the standard answer, in the sign\'s own words', () => {
    renderResult(answer({ permit_exception: PRINTED }), [ACCESSIBLE])
    expect(screen.getByText('Standard answer')).toBeTruthy()
    const card = screen.getByRole('region', { name: 'Accessible parking permit' })
    expect(within(card).getByText('With your permit')).toBeTruthy()
    expect(within(card).getByText('DISABLED PERMIT HOLDERS 4P')).toBeTruthy()
    // The standard answer is unchanged, and no "may allow more time" line.
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(i18n.t('result.canPark'))
    expect(screen.queryByText(/may allow more time/)).toBeNull()
    // No gate here: the standard answer allows parking, so Save is open.
    expect((screen.getByRole('button', { name: SAVE }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('records no permit until the driver says yes in the card', () => {
    const { onLogSession } = renderResult(answer({ permit_exception: PRINTED }), [ACCESSIBLE])
    fireEvent.click(screen.getByRole('button', { name: SAVE }))
    expect(onLogSession.mock.calls[0][0].permit_context).toBeNull()
  })

  it('"No" says only the standard answer applies, and records no permit', () => {
    const { onLogSession } = renderResult(answer({ permit_exception: PRINTED }), [ACCESSIBLE])
    const card = screen.getByRole('region', { name: 'Accessible parking permit' })
    fireEvent.click(within(within(card).getByRole('group', { name: SAFEGUARD })).getByRole('radio', { name: 'No' }))
    expect(within(card).getByRole('alert').textContent).toBe(i18n.t('result.permit.noStandardApplies'))
    fireEvent.click(screen.getByRole('button', { name: SAVE }))
    expect(onLogSession.mock.calls[0][0].permit_context).toBeNull()
  })

  it('takes a later permit time the driver reads off the sign', () => {
    const { onLogSession } = renderResult(answer({ permit_exception: PRINTED }), [ACCESSIBLE])
    const card = screen.getByRole('region', { name: 'Accessible parking permit' })
    // Only once the driver says the permit is in use.
    expect(within(card).queryByLabelText(i18n.t('result.permit.timeLabel'))).toBeNull()
    fireEvent.click(within(card).getByRole('radio', { name: 'Yes' }))

    const input = within(card).getByLabelText(i18n.t('result.permit.timeLabel')) as HTMLInputElement
    const fourHours = melbourneClock(4 * 3600_000)
    fireEvent.change(input, { target: { value: fourHours } })
    expect(within(card).getByRole('status').textContent).toMatch(/^Your reminders will count down to /)

    fireEvent.click(screen.getByRole('button', { name: SAVE }))
    const pc = onLogSession.mock.calls[0][0].permit_context!
    expect(pc).toMatchObject({ type: 'accessible', holder_present: true, sign_exception_applies: true })
    // About four hours from now (the typed time has no seconds).
    const ahead = Date.parse(pc.permit_until!) - Date.now()
    expect(ahead).toBeGreaterThan(4 * 3600_000 - 61_000)
    expect(ahead).toBeLessThanOrEqual(4 * 3600_000)
  })

  it("quotes a printed exception for the driver's other permit while the accessible gate asks about the accessible one", () => {
    const resident5 = { ...RESIDENT, area: 'Area 5' }
    renderResult(
      answer({
        requires_disabled_permit: true,
        permit_exception: [{ applies: true, permit_type: 'resident', text: 'PERMIT HOLDERS EXCEPTED AREA 5' }],
      }),
      [ACCESSIBLE, resident5],
    )
    expect(screen.getByRole('group', { name: SAFEGUARD })).toBeTruthy()
    const card = screen.getByRole('region', { name: 'Resident parking permit' })
    expect(within(card).getByText('PERMIT HOLDERS EXCEPTED AREA 5')).toBeTruthy()
    // That card asks nothing: the park uses one permit, asked in the gate.
    expect(within(card).queryByRole('group')).toBeNull()
    expect(screen.getByText('Standard answer')).toBeTruthy()
  })

  it('ignores a permit time that is not later than the standard limit', () => {
    const { onLogSession } = renderResult(answer({ permit_exception: PRINTED }), [ACCESSIBLE])
    const card = screen.getByRole('region', { name: 'Accessible parking permit' })
    fireEvent.click(within(card).getByRole('radio', { name: 'Yes' }))
    fireEvent.change(within(card).getByLabelText(i18n.t('result.permit.timeLabel')), {
      target: { value: melbourneClock(3600_000) },
    })
    expect(within(card).getByRole('status').textContent).toBe(i18n.t('result.permit.timeNotLater'))
    fireEvent.click(screen.getByRole('button', { name: SAVE }))
    const pc = onLogSession.mock.calls[0][0].permit_context!
    expect(pc.sign_exception_applies).toBe(true)
    expect(pc.permit_until).toBeNull()
  })
})

describe('"Your permit may allow more time under {{state}} rules"', () => {
  it('shows the spec wording with the state where the car is parked', () => {
    renderResult(answer(), [RESIDENT], 'VIC')
    expect(
      screen.getByText(
        "Your permit may allow more time under Victoria rules. ParkProof doesn't calculate that. Check the conditions on your permit or with your council.",
      ),
    ).toBeTruthy()
  })

  it("never guesses the state when the place doesn't show it", () => {
    renderResult(answer(), [ACCESSIBLE], null)
    expect(screen.getByText(i18n.t('result.permit.mayAllowMoreNoState'))).toBeTruthy()
    expect(screen.queryByText(/under Victoria rules/)).toBeNull()
  })

  it("doesn't show without a saved permit", () => {
    renderResult(answer(), [])
    expect(screen.queryByText(/may allow more time/)).toBeNull()
    expect(screen.queryByText('Standard answer')).toBeNull()
  })
})

it('hands the pay gate answer to the draft', () => {
  const { onLogSession } = renderResult(answer({ requires_ticket: true, payment_methods: ['meter'] }), [])
  fireEvent.click(screen.getByRole('checkbox', { name: i18n.t('result.payRequired.ack') }))
  fireEvent.click(screen.getByRole('button', { name: SAVE }))
  expect(onLogSession.mock.calls[0][0]).toEqual({
    gate_acks: { meter_ticket: true, permit_zone: null, accessible_permit: null },
    permit_context: null,
  })
})
