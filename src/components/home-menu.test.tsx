// @vitest-environment happy-dom
//
// The home layout T4 owns (build spec T4 item 9), below the scan button:
// History, "Street sweeping and weekly reminders" and Settings as glass rows
// in that order, then "Parking all day? Start a workday", then "Got a fine?
// Start here". Rows and links whose screens live on other branches (T5a,
// T6b, T8) render only when their handler is passed. Plus the home card's
// Share icon (T7), shown only when its handler is passed.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import type { ParkingSession } from '../types'
import HomeMenu from './HomeMenu'
import ActiveSessionCard from './ActiveSessionCard'

vi.mock('../lib/use-session-photo', () => ({ useSessionPhoto: () => ({ status: 'missing' }) }))

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
afterEach(() => cleanup())

type MenuProps = Parameters<typeof HomeMenu>[0]

function renderMenu(over: Partial<MenuProps> = {}) {
  const props: MenuProps = {
    showHistory: true,
    recordCount: 3,
    onOpenHistory: vi.fn(),
    onOpenSettings: vi.fn(),
    syncAvailable: true,
    accountEmail: null,
    ...over,
  }
  render(<HomeMenu {...props} />)
  return props
}

const rowNames = () => Array.from(screen.getByRole('navigation').querySelectorAll('button'), (b) => b.textContent)

describe('the three glass rows', () => {
  it('are History, the weekly reminders and Settings, in that order', () => {
    const onOpenWeeklyReminders = vi.fn()
    renderMenu({ onOpenWeeklyReminders })
    expect(rowNames()).toEqual(['History3 saved', 'Street sweeping and weekly reminders', 'SettingsSign in to sync'])
  })

  it('leave out the weekly reminders until T5a passes its handler', () => {
    renderMenu()
    expect(screen.queryByText('Street sweeping and weekly reminders')).toBeNull()
    expect(rowNames()).toEqual(['History3 saved', 'SettingsSign in to sync'])
  })

  it('show the next weekly restriction inline, and open the weekly reminders', () => {
    const onOpenWeeklyReminders = vi.fn()
    renderMenu({ onOpenWeeklyReminders, weeklyRemindersNext: 'Street cleaning, tomorrow 7:00 am', weeklyRemindersDetail: '2 set' })
    const row = screen.getByRole('button', { name: /Street sweeping and weekly reminders/ })
    expect(row.textContent).toBe('Street sweeping and weekly remindersStreet cleaning, tomorrow 7:00 am2 set')
    fireEvent.click(row)
    expect(onOpenWeeklyReminders).toHaveBeenCalledTimes(1)
  })

  it('hide History for a first-time visitor but always offer Settings', () => {
    const props = renderMenu({ showHistory: false })
    expect(screen.queryByText('History')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Settings/ }))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it("label Settings with the signed-in email, or \"Sign in to sync\", or nothing where sign-in isn't set up", () => {
    renderMenu({ accountEmail: 'sam@example.com' })
    expect(screen.getByRole('button', { name: /Settings/ }).textContent).toBe('Settingssam@example.com')
    cleanup()
    renderMenu({ syncAvailable: false })
    expect(screen.getByRole('button', { name: /Settings/ }).textContent).toBe('Settings')
  })

  it('open History', () => {
    const props = renderMenu({ recordCount: 0 })
    const row = screen.getByRole('button', { name: /History/ })
    expect(row.textContent).toBe('Historyempty')
    fireEvent.click(row)
    expect(props.onOpenHistory).toHaveBeenCalledTimes(1)
  })
})

describe('the links under the rows', () => {
  it('show the workday link, then the fine link, each only with its handler', () => {
    const onStartWorkday = vi.fn()
    const onOpenNoticeLookup = vi.fn()
    const onDraftAppeal = vi.fn()
    renderMenu({ onStartWorkday, onOpenNoticeLookup, onDraftAppeal })
    const workday = screen.getByRole('button', { name: 'Parking all day? Start a workday' })
    const fine = screen.getByRole('button', { name: 'Got a fine? Start here' })
    expect(workday.compareDocumentPosition(fine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // With the notice lookup in, it is the way in to an appeal too.
    expect(screen.queryByRole('button', { name: i18n.t('home.draftAppeal') })).toBeNull()
    fireEvent.click(workday)
    fireEvent.click(fine)
    expect(onStartWorkday).toHaveBeenCalledTimes(1)
    expect(onOpenNoticeLookup).toHaveBeenCalledTimes(1)
  })

  it('keep the appeal flow reachable until the notice lookup is wired', () => {
    const onDraftAppeal = vi.fn()
    renderMenu({ onDraftAppeal })
    expect(screen.queryByText('Parking all day? Start a workday')).toBeNull()
    expect(screen.queryByText('Got a fine? Start here')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('home.draftAppeal') }))
    expect(onDraftAppeal).toHaveBeenCalledTimes(1)
  })
})

describe("the home card's Share icon", () => {
  const record: ParkingSession = {
    id: 'rec-1',
    arrived_at: new Date(Date.now() - 600_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    confidence: 'high',
  }

  it('shows only once T7 passes its handler, and shares this record', () => {
    render(<ActiveSessionCard session={record} extraCount={0} onOpen={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Share where the car is' })).toBeNull()
    cleanup()

    const onShare = vi.fn()
    render(<ActiveSessionCard session={record} extraCount={2} onOpen={() => {}} onShowMore={() => {}} onShare={onShare} />)
    fireEvent.click(screen.getByRole('button', { name: 'Share where the car is' }))
    expect(onShare).toHaveBeenCalledWith(record)
    // The "+2 more" pill stays tappable beside it.
    expect(screen.getByRole('button', { name: i18n.t('active.morePillAria', { count: 2 }) })).toBeTruthy()
  })
})
