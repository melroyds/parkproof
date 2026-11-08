// @vitest-environment happy-dom
//
// The result screen's gate acknowledgements reach the logger (spec T2 item
// 4): Save hands App what the driver ticked, true for a ticked gate and
// null for a gate the screen didn't ask, so the record saves and signs
// them as gate_acks instead of "not asked".
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import type { GateAcks, ParkingRules } from '../types'
import ParkingResult from './ParkingResult'

const RESULT: ParkingRules = {
  rules: '2P Ticket Mon-Fri 8am-6pm',
  observations: [{ scope: 'Whole sign', items: ['2P', 'Ticket'] }],
  can_park_now: true,
  until: null,
  duration_minutes: 120,
  confidence: 'high',
  clarification: null,
}

const NOT_ASKED: GateAcks = { meter_ticket: null, permit_zone: null, accessible_permit: null }

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function show(result: ParkingRules) {
  const onLogSession = vi.fn<(acks: GateAcks) => void>()
  render(
    <ParkingResult
      result={result}
      signPhoto="data:image/jpeg;base64,AAAA"
      coords={{ lat: -37.8136, lng: 144.9631 }}
      onScanAnother={vi.fn()}
      onLogSession={onLogSession}
      onRetake={vi.fn()}
    />,
  )
  return onLogSession
}

const tick = (label: string) => fireEvent.click(screen.getByLabelText(label))
const save = () => fireEvent.click(screen.getByRole('button', { name: i18n.t('result.logCta') }))

describe('ParkingResult gate acknowledgements', () => {
  it('a ticked pay gate reaches the logger as meter_ticket: true, the gates not asked as null', () => {
    const onLogSession = show({ ...RESULT, requires_ticket: true })
    // Save stays blocked until the driver ticks it.
    const blocked = screen.getByRole('button', { name: i18n.t('result.logCtaBlocked') }) as HTMLButtonElement
    expect(blocked.disabled).toBe(true)
    tick(i18n.t('result.payRequired.ack'))
    save()
    expect(onLogSession).toHaveBeenCalledTimes(1)
    expect(onLogSession).toHaveBeenCalledWith({ meter_ticket: true, permit_zone: null, accessible_permit: null })
  })

  it('every gate asked and ticked reaches the logger as true', () => {
    const onLogSession = show({
      ...RESULT,
      requires_ticket: true,
      is_permit_zone: true,
      permit_area: null,
      requires_disabled_permit: true,
    })
    tick(i18n.t('result.permitRequired.ack'))
    tick(i18n.t('result.permitZone.ack'))
    tick(i18n.t('result.payRequired.ack'))
    save()
    expect(onLogSession).toHaveBeenCalledWith({ meter_ticket: true, permit_zone: true, accessible_permit: true })
  })

  it('a sign with no gate logs every gate as not asked', () => {
    const onLogSession = show(RESULT)
    save()
    expect(onLogSession).toHaveBeenCalledWith(NOT_ASKED)
  })

  it("the can't-park override asks no gate, whatever the flags say", () => {
    const onLogSession = show({
      ...RESULT,
      can_park_now: false,
      duration_minutes: null,
      requires_ticket: true,
      is_permit_zone: true,
      requires_disabled_permit: true,
    })
    expect(screen.queryByLabelText(i18n.t('result.payRequired.ack'))).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('result.cantParkOverrideCta') }))
    expect(onLogSession).toHaveBeenCalledWith(NOT_ASKED)
  })
})
