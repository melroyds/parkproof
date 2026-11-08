// @vitest-environment happy-dom
//
// Street sweeping and weekly reminders on screen (T5a): the recurring view
// (list with the next occurrence; add, edit, pause, delete; the calendar
// file), the home row, and the remind screen's "Remind me every week"
// sheet that opens the editor prefilled from the sign's weekly
// restriction (T3's recurring_restrictions on the saved record).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { deviceTimeZone, todayInZone } from '../lib/recurring'
import { getRecurringRule, loadRecurringRules, saveRecurringRule } from '../lib/storage'
import type { ParkingRules, ParkingSession, RecurringRestriction, RecurringRule } from '../types'
import { hasWeeklyRestriction, signReadingFields } from '../lib/sign-result'
import { useRecurringPushSync } from '../lib/use-recurring-push'
import { useRecurringRules } from '../lib/use-recurring-rules'
import { resetRecurringPushForTests } from '../lib/recurring-push'
import RecurringHomeRow from './RecurringHomeRow'
import RecurringReminders from './RecurringReminders'
import ReminderOptions from './ReminderOptions'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** What App mounts once: the push sync (T5b), which works out each rule's status. */
function PushSyncHarness() {
  useRecurringPushSync(useRecurringRules())
  return null
}

const AUTH: AuthContextValue = {
  user: null,
  loading: false,
  configured: false,
  refresh: async () => {},
  signOut: () => {},
}

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: A,
    label: '',
    kind: 'street_cleaning',
    days: ['TU'],
    start: '07:00',
    end: '09:00',
    frequency: 'weekly',
    nth: [],
    anchor_date: '2026-01-01',
    timezone: 'Australia/Melbourne',
    address: '12 King St',
    remind_evening_before: '20:00',
    remind_minutes_before: 60,
    push: true,
    paused: false,
    sequence: 0,
    ...overrides,
  }
}

const SWEEP: RecurringRestriction = {
  kind: 'street_cleaning',
  days: ['TU'],
  start: '07:00',
  end: '09:00',
  week_of_month: [],
  exceptions_text: 'Except public holidays',
  label: '',
}

function makeSession(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
    sign_photo: 'data:image/jpeg;base64,SIGN',
    car_photo: null,
    rules: '2P 8am-6pm',
    observations: [],
    expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
    confidence: 'high',
    ...overrides,
  }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

/**
 * Make this phone's own time zone `tz` for the test (deviceTimeZone() reads
 * the default DateTimeFormat's zone), so the zone-label tests don't depend
 * on the machine running them. Returns the spy to restore.
 */
function mockPhoneZone(tz: string) {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions
  const system = real.call(new Intl.DateTimeFormat()).timeZone
  return vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    const o = real.call(this)
    return o.timeZone === system ? { ...o, timeZone: tz } : o
  })
}

beforeEach(() => {
  localStorage.clear()
  resetRecurringPushForTests()
  class FakeNotification {
    static permission: NotificationPermission = 'granted'
    static requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
  }
  vi.stubGlobal('Notification', FakeNotification)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const clickSave = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  })
}

describe('RecurringReminders view', () => {
  it('adds a weekly reminder from the empty state', async () => {
    render(<RecurringReminders onBack={() => {}} />)
    expect(screen.getByText('No weekly reminders yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add a weekly reminder' }))
    expect(screen.getByRole('heading', { name: 'New weekly reminder' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Monday' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tuesday' }))
    fireEvent.change(screen.getByLabelText('Where'), { target: { value: 'Lygon St' } })
    await clickSave()

    expect(screen.getByRole('heading', { name: 'Weekly reminders' })).toBeTruthy()
    expect(screen.getByText('Weekly reminder saved.')).toBeTruthy()
    const item = screen.getByRole('listitem')
    expect(within(item).getByRole('heading', { name: 'Street sweeping' })).toBeTruthy()
    expect(within(item).getByText('Every week on Tuesday, 7 to 9 am')).toBeTruthy()
    expect(within(item).getByText(/^(Next: |On now, until)/)).toBeTruthy()
    const [stored] = loadRecurringRules()
    expect(stored).toMatchObject({
      days: ['TU'],
      start: '07:00',
      end: '09:00',
      frequency: 'weekly',
      address: 'Lygon St',
      timezone: deviceTimeZone(),
      push: true,
      sequence: 0,
    })
  })

  it('does not save without a day, and says why', async () => {
    render(<RecurringReminders onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a weekly reminder' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Monday' }))
    await clickSave()
    expect(screen.getByRole('alert').textContent).toBe('Pick at least one day.')
    expect(loadRecurringRules()).toEqual([])
  })

  it('edits a rule, which bumps its calendar sequence', async () => {
    saveRecurringRule(rule())
    render(<RecurringReminders onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Street sweeping' }))
    expect(screen.getByRole('heading', { name: 'Edit weekly reminder' })).toBeTruthy()
    expect((screen.getByLabelText('Starts') as HTMLInputElement).value).toBe('07:00')
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '06:30' } })
    await clickSave()
    expect(getRecurringRule(A)).toMatchObject({ start: '06:30', sequence: 1 })
    expect(screen.getByText('Every week on Tuesday, 6:30 to 9 am')).toBeTruthy()
  })

  it('pauses and resumes from the list', () => {
    saveRecurringRule(rule())
    render(<RecurringReminders onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause: Street sweeping' }))
    expect(getRecurringRule(A)).toMatchObject({ paused: true, sequence: 0 })
    expect(screen.getByText('Paused')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Resume: Street sweeping' }))
    expect(getRecurringRule(A)?.paused).toBe(false)
  })

  it('deletes a rule only after asking', () => {
    saveRecurringRule(rule())
    render(<RecurringReminders onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Street sweeping' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete reminder' }))
    expect(getRecurringRule(A)).toBeTruthy()
    expect(screen.getByText(/Delete this weekly reminder\?/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(loadRecurringRules()).toEqual([])
    expect(screen.getByText('No weekly reminders yet')).toBeTruthy()
  })

  it('asks for the date of the next one every second week, and for weeks of the month', async () => {
    render(<RecurringReminders onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a weekly reminder' }))
    expect(screen.queryByLabelText('Date of the next one')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Every second week' }))
    const date = screen.getByLabelText('Date of the next one') as HTMLInputElement
    expect(date.value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    fireEvent.change(date, { target: { value: '2026-12-07' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Some weeks of the month' }))
    expect((screen.getByRole('checkbox', { name: '1st' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: '3rd' }))
    await clickSave()
    expect(loadRecurringRules()[0]).toMatchObject({ frequency: 'monthly_nth', nth: [1, 3] })
  })

  it('drops a fortnight start date again when the rule goes back to every week', async () => {
    render(<RecurringReminders onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add a weekly reminder' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Every second week' }))
    fireEvent.change(screen.getByLabelText('Date of the next one'), { target: { value: '2027-03-01' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Every week' }))
    await clickSave()
    const [stored] = loadRecurringRules()
    expect(stored.frequency).toBe('weekly')
    // The new rule's own start date (today), not the date picked for the fortnight.
    expect(stored.anchor_date).toBe(todayInZone(deviceTimeZone()))
  })

  it('downloads the calendar file for a rule', async () => {
    saveRecurringRule(rule())
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ics')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    render(<RecurringReminders onBack={() => {}} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add to calendar: Street sweeping' }))
    })
    await waitFor(() => expect(screen.getByText('Downloaded. Open the file to add it.')).toBeTruthy())
    expect(createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('carries the council note and the reliability line', () => {
    render(<RecurringReminders onBack={() => {}} />)
    expect(screen.getByText(/public holidays may be different/)).toBeTruthy()
    expect(
      screen.getByText("Reminders can be delayed or silenced, for example by Focus or battery saving. Don't rely on them alone."),
    ).toBeTruthy()
  })
})

describe('RecurringHomeRow', () => {
  // Mon 9 Nov 2026, 11 am in Melbourne.
  const now = Date.parse('2026-11-09T00:00:00Z')

  it('names the next occurrence when it starts within 24 hours', () => {
    const zone = mockPhoneZone('Australia/Melbourne')
    try {
      const onOpen = vi.fn()
      render(<RecurringHomeRow rules={[rule()]} now={now} onOpen={onOpen} />)
      const row = screen.getByRole('button')
      expect(row.textContent).toContain('Street sweeping and weekly reminders')
      expect(row.textContent).toContain('Next: Street sweeping, 7:00 am, Tue 10/11/2026')
      expect(row.textContent).toContain('1 set')
      fireEvent.click(row)
      expect(onOpen).toHaveBeenCalledTimes(1)
    } finally {
      zone.mockRestore()
    }
  })

  it("names the rule's zone when this phone's clock reads the time differently", () => {
    // A Melbourne sweep seen from a phone in Perth: 7 am there is 4 am here.
    let zone = mockPhoneZone('Australia/Perth')
    try {
      render(<RecurringHomeRow rules={[rule()]} now={now} onOpen={() => {}} />)
      expect(screen.getByRole('button').textContent).toContain('Next: Street sweeping, Tue 10 Nov, 7:00 am AEDT')
    } finally {
      zone.mockRestore()
    }
    cleanup()
    // From Sydney the clock reads the same: no zone name.
    zone = mockPhoneZone('Australia/Sydney')
    try {
      render(<RecurringHomeRow rules={[rule()]} now={now} onOpen={() => {}} />)
      expect(screen.getByRole('button').textContent).not.toContain('AEDT')
    } finally {
      zone.mockRestore()
    }
  })

  it('says nothing about a rule more than 24 hours away, or a paused one', () => {
    render(<RecurringHomeRow rules={[rule({ days: ['TH'] }), rule({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', paused: true })]} now={now} onOpen={() => {}} />)
    expect(screen.getByRole('button').textContent).not.toContain('Next:')
  })

  it('shows one that is on now', () => {
    render(<RecurringHomeRow rules={[rule()]} now={Date.parse('2026-11-09T21:00:00Z')} onOpen={() => {}} />)
    expect(screen.getByRole('button').textContent).toContain('Street sweeping is on now, until 9 am')
  })
})

describe('"Remind me every week" on the remind screen', () => {
  function renderRemind(session: ParkingSession) {
    render(
      <AuthContext.Provider value={AUTH}>
        <ReminderOptions session={session} onDone={() => {}} />
      </AuthContext.Provider>,
    )
  }

  it('is not offered when the record has no weekly restriction', () => {
    renderRemind(makeSession())
    expect(screen.queryByRole('button', { name: 'Remind me every week' })).toBeNull()
  })

  it('opens the editor prefilled from the sign, asking to check it against the sign', () => {
    renderRemind(makeSession({ recurring_restrictions: [SWEEP] }))
    expect(screen.getByText('Weekly restriction on this sign')).toBeTruthy()
    expect(screen.getByText('Street sweeping. Every week on Tuesday, 7 to 9 am.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remind me every week' }))
    const dialog = screen.getByRole('dialog', { name: 'Remind me every week' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(within(dialog).getByText('Check these days and times against the sign')).toBeTruthy()
    expect(within(dialog).getByText('The sign also says: Except public holidays')).toBeTruthy()
    expect((within(dialog).getByRole('checkbox', { name: 'Tuesday' }) as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByRole('checkbox', { name: 'Monday' }) as HTMLInputElement).checked).toBe(false)
    expect((within(dialog).getByLabelText('Starts') as HTMLInputElement).value).toBe('07:00')
    expect((within(dialog).getByLabelText('Where') as HTMLInputElement).value).toBe('12 King St')
    // Escape closes it without saving.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(loadRecurringRules()).toEqual([])
  })

  it('opens the sheet over the whole screen, not inside the clipped card it came from', () => {
    renderRemind(makeSession({ recurring_restrictions: [SWEEP] }))
    const cta = screen.getByRole('button', { name: 'Remind me every week' })
    expect(cta.closest('.gf-card')).not.toBeNull()
    fireEvent.click(cta)
    const dialog = screen.getByRole('dialog', { name: 'Remind me every week' })
    // A .gf-card's filter and clip-path would trap a fixed child inside the card.
    expect(dialog.parentElement).toBe(document.body)
    expect(dialog.className).toContain('fixed inset-0')
  })

  it('after saving, focus lands on the saved line, not on the page body', async () => {
    renderRemind(makeSession({ recurring_restrictions: [SWEEP] }))
    const cta = screen.getByRole('button', { name: 'Remind me every week' })
    cta.focus()
    fireEvent.click(cta)
    await clickSave()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.textContent).toContain('Weekly reminder saved.')
  })

  it("says when this phone can't show the reminder it just saved (the permission prompt was dismissed)", async () => {
    const N = Notification as unknown as { permission: NotificationPermission; requestPermission: () => Promise<NotificationPermission> }
    N.permission = 'default'
    N.requestPermission = vi.fn(async () => 'default' as NotificationPermission)
    render(
      <AuthContext.Provider value={AUTH}>
        <PushSyncHarness />
        <ReminderOptions session={makeSession({ recurring_restrictions: [SWEEP] })} onDone={() => {}} />
      </AuthContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remind me every week' }))
    await clickSave()
    expect(await screen.findByText("This phone can't show this reminder right now. Add it to your calendar.")).toBeTruthy()
  })

  it("is offered on a record saved from a T3 answer whose result screen showed the weekly hint", () => {
    // The result screen's hint ("You can set a reminder after you save")
    // and the record the logger saves both come from T3's sign-result.ts.
    const answer: ParkingRules = {
      rules: '2P 8am-6pm. No stopping Tue 7-9am street sweeping.',
      observations: [],
      can_park_now: true,
      until: null,
      duration_minutes: null,
      confidence: 'high',
      clarification: null,
      sign_status: 'readable',
      sign_issues: [],
      is_area_sign: false,
      permit_exception: [],
      recurring_restrictions: [SWEEP],
    }
    expect(hasWeeklyRestriction(answer)).toBe(true)
    renderRemind(makeSession({ ...signReadingFields(answer) }))
    expect(screen.getByText('Weekly restriction on this sign')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remind me every week' })).toBeTruthy()
  })

  it('is offered on a record with no expiry too (a permit zone outside its hours, a sign that says not now)', () => {
    renderRemind(makeSession({ expires_at: null, recurring_restrictions: [SWEEP] }))
    expect(screen.getByText('Weekly restriction on this sign')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remind me every week' })).toBeTruthy()
  })

  it("names the reminder by its translated kind for a reader in another language, not the sign reading's English label", async () => {
    const labelled = { ...SWEEP, label: 'Street cleaning 1st and 3rd Tue' }
    await i18n.changeLanguage('zh-CN')
    try {
      renderRemind(makeSession({ recurring_restrictions: [labelled] }))
      expect(screen.queryByText(/Street cleaning 1st/)).toBeNull()
      const kind = i18n.t('recurring.kind.street_cleaning')
      expect(screen.getByText((text) => text.startsWith(kind))).toBeTruthy()
    } finally {
      await i18n.changeLanguage('en')
    }
    cleanup()
    renderRemind(makeSession({ recurring_restrictions: [labelled] }))
    expect(screen.getByText((text) => text.startsWith('Street cleaning 1st and 3rd Tue.'))).toBeTruthy()
  })

  it('saves the checked rule and then offers the calendar file', async () => {
    renderRemind(makeSession({ recurring_restrictions: [SWEEP] }))
    fireEvent.click(screen.getByRole('button', { name: 'Remind me every week' }))
    await clickSave()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Weekly reminder saved.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add to calendar: Street sweeping' })).toBeTruthy()
    const [stored] = loadRecurringRules()
    expect(stored).toMatchObject({
      kind: 'street_cleaning',
      days: ['TU'],
      start: '07:00',
      end: '09:00',
      frequency: 'weekly',
      timezone: 'Australia/Melbourne',
      address: '12 King St',
      remind_evening_before: '20:00',
      remind_minutes_before: 60,
    })
  })

  it('does not offer a second copy of a reminder the driver already has', () => {
    saveRecurringRule(rule({ address: '12 King St' }))
    renderRemind(makeSession({ recurring_restrictions: [SWEEP] }))
    expect(screen.queryByRole('button', { name: 'Remind me every week' })).toBeNull()
    expect(screen.getByText('You already have a weekly reminder for this.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add to calendar: Street sweeping' })).toBeTruthy()
  })

  it('offers each restriction on its own, and monthly ones as monthly', () => {
    renderRemind(
      makeSession({
        recurring_restrictions: [SWEEP, { ...SWEEP, kind: 'clearway', days: ['MO', 'TU', 'WE', 'TH', 'FR'], start: '16:30', end: '18:30', week_of_month: [] }],
      }),
    )
    expect(screen.getByRole('button', { name: 'Remind me every week: Street sweeping' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remind me every week: Clearway' })).toBeTruthy()
    expect(screen.getByText('Clearway. Every week on Monday to Friday, 4:30 to 6:30 pm.')).toBeTruthy()
  })

  it('is offered on an expired record too', () => {
    renderRemind(
      makeSession({
        expires_at: new Date(Date.now() - 3600_000).toISOString(),
        recurring_restrictions: [{ ...SWEEP, week_of_month: [1, 3] }],
      }),
    )
    expect(screen.getByText('Street sweeping. The 1st and 3rd Tuesday of each month, 7 to 9 am.')).toBeTruthy()
  })
})
