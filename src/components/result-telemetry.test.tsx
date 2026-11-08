// @vitest-environment happy-dom
//
// Feedback telemetry from the result screen (spec T9 item 5): the hour is
// the hour at the parking spot, in the zone the answer was read for, and
// is_refresh is true for a re-check answer. Both used to be wrong: the
// hour came from the phone's zone, and is_refresh was always false.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { hourInZone } from '../lib/time-format'
import type { ParkingRules } from '../types'
import ParkingResult from './ParkingResult'

const PERTH = { lat: -31.9523, lng: 115.8613 }
const BRISBANE = { lat: -27.4698, lng: 153.0251 }
const MELBOURNE = { lat: -37.8136, lng: 144.9631 }
// 16:30 UTC on 3 October 2026: 00:30 on the 4th in Perth, 02:30 in
// Brisbane, and 03:30 in Melbourne, where daylight saving starts at 2 am.
const SCAN_AT = '2026-10-03T16:30:00.000Z'

const RESULT: ParkingRules = {
  rules: '2P Mon-Fri 8am-6pm',
  observations: [{ scope: 'Whole sign', items: ['2P'] }],
  can_park_now: true,
  until: '2026-10-04T10:00:00+11:00',
  duration_minutes: 120,
  confidence: 'high',
  clarification: null,
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response('{}'))

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(SCAN_AT))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function show(result: ParkingRules, coords: { lat: number; lng: number } | null) {
  render(
    <ParkingResult
      result={result}
      signPhoto="data:image/jpeg;base64,AAAA"
      coords={coords}
      onScanAnother={vi.fn()}
      onLogSession={vi.fn()}
      onRetake={vi.fn()}
    />,
  )
}

function sentContext(): Record<string, unknown> {
  const feedback = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/feedback'))
  expect(feedback).toHaveLength(1)
  return JSON.parse(String(feedback[0][1]?.body)).context
}

describe('hourInZone', () => {
  it('reads the hour in the given zone, across the daylight saving change', () => {
    expect(hourInZone(SCAN_AT, 'Australia/Perth')).toBe(0)
    expect(hourInZone(SCAN_AT, 'Australia/Brisbane')).toBe(2)
    expect(hourInZone(SCAN_AT, 'Australia/Melbourne')).toBe(3)
    // An hour earlier Melbourne was still on standard time: 01:30, not 02:30.
    expect(hourInZone('2026-10-03T15:30:00Z', 'Australia/Melbourne')).toBe(1)
  })

  it('gives 0 for midnight, falls back for an unknown zone, and null for a bad time', () => {
    expect(hourInZone('2026-10-03T16:00:00Z', 'Australia/Perth')).toBe(0)
    expect(hourInZone(SCAN_AT, 'Not/AZone')).toBe(hourInZone(SCAN_AT, 'Australia/Melbourne'))
    expect(hourInZone('not a time', 'Australia/Perth')).toBeNull()
  })
})

describe('the result screen feedback', () => {
  it.each([
    ['Perth', PERTH, 0],
    ['Brisbane', BRISBANE, 2],
    ['Melbourne', MELBOURNE, 3],
  ])('reports the hour at a spot in %s, whatever zone the phone is in', (_city, coords, hour) => {
    show(RESULT, coords)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('result.verifyYes') }))
    expect(sentContext().scanned_hour_local).toBe(hour)
  })

  it('reports the hour the answer was shown, not the hour of the tap', () => {
    show(RESULT, PERTH)
    vi.setSystemTime(new Date('2026-10-03T19:10:00.000Z')) // 03:10 in Perth
    fireEvent.click(screen.getByRole('button', { name: i18n.t('result.verifyRetake') }))
    expect(sentContext()).toMatchObject({ scanned_hour_local: 0 })
  })

  it('without coordinates uses the same default zone as the answer (Melbourne)', () => {
    show(RESULT, null)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('result.verifyYes') }))
    expect(sentContext().scanned_hour_local).toBe(3)
  })

  it('is_refresh is true for a re-check answer and false for a fresh read', () => {
    show({ ...RESULT, is_refresh: true }, MELBOURNE)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('result.verifyYes') }))
    expect(sentContext().is_refresh).toBe(true)
    cleanup()
    fetchMock.mockClear()

    show(RESULT, MELBOURNE)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('result.verifyRetake') }))
    expect(sentContext().is_refresh).toBe(false)
  })
})
