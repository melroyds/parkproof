// @vitest-environment happy-dom
//
// Reminders on a record whose permit allows a later time (build spec T4
// item 6): the sign prints an exception for the permit the driver used, and
// they typed in a later permit time from the sign. The reminders count down
// to that permit time, and one more fires at the standard limit with the
// spec's words: "The standard limit on this sign ends now. Your permit time
// runs to {{time}}." A record without one keeps today's reminders.
//
// Since the merge with the field-test fix list, both screens set reminders
// with the one "Remind me" tap (src/lib/remind-me.ts): permission, the
// in-tab reminders, then push. Notifications are allowed here and the push
// registration succeeds, so every tap reaches schedulePushReminders.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TFunction } from 'i18next'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { getSession, saveSession } from '../lib/storage'
import { reminderCopy } from '../lib/reminder-copy'
import type { ReminderCopy } from '../lib/reminder-copy'
import { formatExpiryAbsolute } from '../lib/time-format'
import type { ScheduledReminder } from '../lib/push'
import type { ParkingSession, PermitContext } from '../types'
import ReminderOptions from './ReminderOptions'
import ScheduledRemindersSection from './ScheduledRemindersSection'

const mocks = vi.hoisted(() => ({
  scheduleAbsoluteReminders: vi.fn(),
  scheduleParkingReminders: vi.fn(),
  schedulePushReminders: vi.fn(),
  subscribeToPush: vi.fn(),
}))
vi.mock('../lib/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/notifications')>()),
  scheduleAbsoluteReminders: mocks.scheduleAbsoluteReminders,
  scheduleParkingReminders: mocks.scheduleParkingReminders,
}))
vi.mock('../lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/push')>()),
  getPushPermissionState: () => 'unsupported',
  hasActiveSubscription: async () => false,
  schedulePushReminders: mocks.schedulePushReminders,
  subscribeToPush: mocks.subscribeToPush,
}))

/** Notifications allowed, so Remind me goes on to push. */
class FakeNotification {
  static permission = 'granted'
  static requestPermission = async () => 'granted'
}

const AUTH: AuthContextValue = { user: null, loading: false, configured: false, refresh: async () => {}, signOut: () => {} }
const RELIABILITY = "Reminders can be delayed or silenced, for example by Focus or battery saving. Don't rely on them alone."
const minus = (iso: string, minutes: number) => new Date(Date.parse(iso) - minutes * 60_000).toISOString()

// Whole minutes, so the reminder chips land on round times.
const BASE = Math.ceil(Date.now() / 60_000) * 60_000
const STANDARD = new Date(BASE + 60 * 60_000).toISOString()
const PERMIT = new Date(BASE + 3 * 60 * 60_000).toISOString()

const CONTEXT: PermitContext = {
  type: 'accessible',
  area: null,
  holder_present: true,
  sign_exception_applies: true,
  standard_until: STANDARD,
  permit_until: PERMIT,
  note: null,
}

function record(over: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-permit',
    arrived_at: new Date(BASE - 10 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
    sign_photo: null,
    car_photo: null,
    rules: '1P. DISABLED PERMIT HOLDERS 4P',
    observations: [],
    expires_at: STANDARD,
    confidence: 'high',
    permit_context: CONTEXT,
    permit_salt: 'a'.repeat(64),
    ...over,
  }
}

/** A time as the reminder screen and copy show it (Melbourne, the record's place). */
const label = (iso: string) =>
  formatExpiryAbsolute(iso, { timeZone: 'Australia/Melbourne', now: new Date() }).combined

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  localStorage.clear()
  for (const m of Object.values(mocks)) m.mockReset()
  mocks.scheduleAbsoluteReminders.mockResolvedValue({ status: 'scheduled', scheduledCount: 3, pastCount: 0, totalSelected: 3, firesAt: [] })
  mocks.scheduleParkingReminders.mockResolvedValue({ status: 'scheduled', scheduledCount: 2, pastCount: 0, totalSelected: 2, firesAt: [] })
  mocks.schedulePushReminders.mockResolvedValue({ ok: false, reason: 'not_subscribed' })
  mocks.subscribeToPush.mockResolvedValue({ ok: true })
  vi.stubGlobal('Notification', FakeNotification)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The one "Remind me" button (field-test fix list, item 2). */
const remindMe = () => fireEvent.click(screen.getByRole('button', { name: i18n.t('reminders.remindMe.cta') }))

function renderReminders(session: ParkingSession) {
  render(
    <AuthContext.Provider value={AUTH}>
      <ReminderOptions session={session} onDone={() => {}} />
    </AuthContext.Provider>,
  )
}

describe('the reminder screen', () => {
  it('counts down to the permit time and adds the standard-limit reminder', async () => {
    renderReminders(record())
    expect(screen.getByText(/^Your permit time runs to/).textContent).toBe(
      `Your permit time runs to ${label(PERMIT)}, the time you entered from the sign. Pick when you want to be reminded, choose as many as you like.`,
    )
    expect(screen.getByText(/^You'll also get a reminder at/).textContent).toBe(
      `You'll also get a reminder at ${label(STANDARD)}, when the standard limit on this sign ends.`,
    )

    remindMe()
    await waitFor(() => expect(mocks.scheduleAbsoluteReminders).toHaveBeenCalledTimes(1))
    expect(mocks.scheduleParkingReminders).not.toHaveBeenCalled()

    const [, fireAts, copyFor] = mocks.scheduleAbsoluteReminders.mock.calls[0] as [ParkingSession, Date[], (d: Date) => ReminderCopy]
    const times = fireAts.map((d) => d.toISOString()).sort()
    // The default picks (30 and 5 min before) count down to the permit time.
    expect(times).toEqual(
      [STANDARD, new Date(Date.parse(PERMIT) - 30 * 60_000).toISOString(), new Date(Date.parse(PERMIT) - 5 * 60_000).toISOString()].sort(),
    )
    expect(copyFor(new Date(STANDARD)).body).toBe(
      `The standard limit on this sign ends now. Your permit time runs to ${label(PERMIT)}.`,
    )
    expect(copyFor(new Date(Date.parse(PERMIT) - 30 * 60_000)).body).toContain(label(PERMIT))

    // The push copies carry the same fire times, the server's delivery window follows the permit time.
    await waitFor(() => expect(mocks.schedulePushReminders).toHaveBeenCalledTimes(1))
    const [id, pushes, anchor] = mocks.schedulePushReminders.mock.calls[0] as [string, ScheduledReminder[], string]
    expect(id).toBe('rec-permit')
    expect(pushes.map((p) => p.fire_at).sort()).toEqual(times)
    expect(anchor).toBe(PERMIT)
  })

  it('carries the reliability line', () => {
    renderReminders(record())
    expect(screen.getByText(RELIABILITY)).toBeTruthy()
  })

  it('never asks push for more than 6 reminders: with the standard-limit one, only 5 chips can be picked', async () => {
    renderReminders(record())
    // Defaults are 30 and 5 min; pick three more.
    for (const name of ['15 min', '10 min', '2 min']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name},`) }))
    }
    const atPermit = screen.getByRole('button', { name: /^At permit time,/ }) as HTMLButtonElement
    expect(atPermit.disabled).toBe(true)
    expect(screen.getByText('You can pick up to 5 reminders here, plus the one when the standard limit ends.')).toBeTruthy()
    fireEvent.click(atPermit)
    expect(atPermit.getAttribute('aria-pressed')).toBe('false')

    remindMe()
    await waitFor(() => expect(mocks.schedulePushReminders).toHaveBeenCalledTimes(1))
    const pushes = mocks.schedulePushReminders.mock.calls[0][1] as ScheduledReminder[]
    expect(pushes).toHaveLength(6)
    expect(new Set(pushes.map((p) => p.fire_at)).size).toBe(6)
    expect(pushes.map((p) => p.fire_at)).toContain(STANDARD)
  })

  it('sets one reminder when a chip lands on the standard limit, with the standard-limit words', async () => {
    // Permit time 30 min after the standard limit: the 30 min chip fires at the standard limit.
    const permit = new Date(Date.parse(STANDARD) + 30 * 60_000).toISOString()
    renderReminders(record({ permit_context: { ...CONTEXT, permit_until: permit } }))
    remindMe()
    await waitFor(() => expect(mocks.schedulePushReminders).toHaveBeenCalledTimes(1))
    const pushes = mocks.schedulePushReminders.mock.calls[0][1] as ScheduledReminder[]
    // The default picks (30 and 5 min) plus the standard limit, which the 30 min chip shares.
    expect(pushes.map((p) => p.fire_at).sort()).toEqual([STANDARD, minus(permit, 5)].sort())
    expect(pushes.find((p) => p.fire_at === STANDARD)?.body).toBe(
      `The standard limit on this sign ends now. Your permit time runs to ${label(permit)}.`,
    )
    const [, fireAts] = mocks.scheduleAbsoluteReminders.mock.calls[0] as [ParkingSession, Date[]]
    expect(fireAts).toHaveLength(2)
  })

  it('names the last chip after the permit time, never the expiry', () => {
    renderReminders(record())
    expect(screen.getByRole('button', { name: /^At permit time,/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^At expiry,/ })).toBeNull()
  })

  it('stays on the expiry for a record without a later permit time', async () => {
    renderReminders(record({ permit_context: { ...CONTEXT, permit_until: null } }))
    expect(screen.queryByText(/permit time/)).toBeNull()
    expect(screen.queryByText(/You'll also get a reminder/)).toBeNull()
    remindMe()
    await waitFor(() => expect(mocks.scheduleParkingReminders).toHaveBeenCalledTimes(1))
    expect(mocks.scheduleAbsoluteReminders).not.toHaveBeenCalled()
    await waitFor(() => expect(mocks.schedulePushReminders).toHaveBeenCalledTimes(1))
    expect(mocks.schedulePushReminders.mock.calls[0][2]).toBe(STANDARD)
  })
})

describe('the reminder copy', () => {
  const t = ((key: string, opts?: Record<string, unknown>) => `${key}|${JSON.stringify(opts ?? {})}`) as unknown as TFunction

  it('uses the spec wording at the standard limit, and the permit time for the rest', () => {
    const s = record()
    expect(reminderCopy(s, new Date(STANDARD), t).body).toMatch(/^reminders\.permitStandardEnds\|/)
    const before = reminderCopy(s, new Date(Date.parse(PERMIT) - 15 * 60_000), t).body
    expect(before).toMatch(/^reminders\.permitBodyBefore\|/)
    expect(before).toContain('"count":15')
    expect(reminderCopy(s, new Date(PERMIT), t).body).toMatch(/^reminders\.permitBodyAt\|/)
  })

  it('calls the permit time the time the driver entered, never the parking expiry', () => {
    const s = record()
    const at = reminderCopy(s, new Date(PERMIT), i18n.t).body
    expect(at).toBe(`The permit time you entered from the sign ends at ${label(PERMIT)}. Time to move the car.`)
    const before = reminderCopy(s, new Date(minus(PERMIT, 15)), i18n.t).body
    expect(before).toBe(
      `The permit time you entered from the sign ends at ${label(PERMIT)}. This is your 15-minute reminder.`,
    )
    for (const body of [at, before]) expect(body).not.toMatch(/parking expires/i)
  })

  it('is unchanged for a record whose permit gives no later time', () => {
    const s = record({ permit_context: { ...CONTEXT, sign_exception_applies: false } })
    expect(reminderCopy(s, new Date(STANDARD), t).body).toMatch(/^reminders\.pushBodyAtExpiry\|/)
  })
})

function renderRecordScreen(session: ParkingSession) {
  saveSession(session)
  render(
    <AuthContext.Provider value={AUTH}>
      <ScheduledRemindersSection session={getSession(session.id)!} />
    </AuthContext.Provider>,
  )
}

describe('the record screen', () => {
  it('names the standard-limit reminder as such, and the others after the permit time entered', () => {
    renderRecordScreen(
      record({ push_reminders: [{ fire_at: STANDARD }, { fire_at: minus(PERMIT, 30) }, { fire_at: PERMIT }] }),
    )
    expect(screen.getByText(/: the standard limit ends$/)).toBeTruthy()
    expect(screen.getByText(/: 30 min before the permit time you entered$/)).toBeTruthy()
    expect(screen.getByText(/: when the permit time you entered ends$/)).toBeTruthy()
    expect(screen.queryByText(/expiry/)).toBeNull()
    expect(screen.getByText(RELIABILITY)).toBeTruthy()
  })

  it('adds the standard-limit reminder along with the first reminder added there', async () => {
    mocks.schedulePushReminders.mockImplementation(async (_id: string, reminders: ScheduledReminder[]) => ({
      ok: true,
      created: reminders.map((r, i) => ({ name: `n-${i}`, fire_at: r.fire_at })),
      skipped: 0,
    }))
    renderRecordScreen(record())
    fireEvent.click(screen.getByRole('button', { name: '+ Add reminder' }))
    fireEvent.click(screen.getByRole('button', { name: /^15 min,/ }))
    remindMe()

    await waitFor(() => expect(mocks.schedulePushReminders).toHaveBeenCalledTimes(1))
    const [, pushes, anchor] = mocks.schedulePushReminders.mock.calls[0] as [string, ScheduledReminder[], string]
    expect(pushes.map((p) => p.fire_at)).toEqual([STANDARD, minus(PERMIT, 15)])
    expect(pushes[0].body).toMatch(/^The standard limit on this sign ends now\./)
    expect(pushes[1].body).toMatch(/^The permit time you entered from the sign ends at /)
    expect(anchor).toBe(PERMIT)
    await waitFor(() => expect(getSession('rec-permit')?.push_reminders).toHaveLength(2))
  })

  it('offers no add that would take the record past 6 push reminders', () => {
    localStorage.setItem('parkproof.device_id.v1', '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e')
    renderRecordScreen(
      record({
        push_reminders: [STANDARD, ...[30, 15, 10, 5, 2].map((m) => minus(PERMIT, m))].map((fire_at) => ({ fire_at })),
      }),
    )
    // Five chips are already set; the sixth would make seven with the standard-limit reminder.
    expect((screen.getByRole('button', { name: '+ Add reminder' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
