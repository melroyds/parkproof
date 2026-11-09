// @vitest-environment happy-dom
//
// ScheduledRemindersSection and push ownership (spec N6). push_reminders
// syncs through the cloud, so a second device can show the first device's
// reminders. There every change is refused with 403 ERR_NOT_OWNER: the list
// must stay exactly as it is (clearing it would mirror an empty list to the
// cloud while the other device's pushes keep firing), the screen must say the
// reminders belong to another device, and the change controls must go.
//
// Adding goes through the one-tap "Remind me" (field-test fix list, item
// 2): pick chips, tap Remind me. When the server still refuses this
// device's registration the screen says the reminder only works while
// ParkProof is open; it never claims a background reminder it didn't book.
//
// In-tab reminders (review of the field-test build): a reminder removed or
// cancelled here, or refused as another device's, must not still alert from
// its in-tab timer; and when push failed but the in-tab reminder was set,
// the picker stays open for the "tap Remind me again" the screen asks for,
// and the retry replaces the in-tab reminder rather than doubling it.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { getSession, saveSession } from '../lib/storage'
import { cancelInTabReminders, scheduleAbsoluteReminders } from '../lib/notifications'
import type { PushCancelResult, PushScheduleResult } from '../lib/push'
import type { ParkingSession } from '../types'
import ScheduledRemindersSection from './ScheduledRemindersSection'

const mocks = vi.hoisted(() => ({
  cancelPushReminders: vi.fn(),
  schedulePushReminders: vi.fn(),
  subscribeToPush: vi.fn(),
}))
vi.mock('../lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/push')>()),
  cancelPushReminders: mocks.cancelPushReminders,
  schedulePushReminders: mocks.schedulePushReminders,
  subscribeToPush: mocks.subscribeToPush,
}))

/** Notifications allowed; in-tab reminders are recorded, not shown. */
class FakeNotification {
  static permission = 'granted'
  static requestPermission = async () => 'granted'
}

const DEVICE_ID_KEY = 'parkproof.device_id.v1'
const DEVICE = '22222222-2222-4222-8222-222222222222'

const AUTH: AuthContextValue = {
  user: null,
  loading: false,
  configured: false,
  refresh: async () => {},
  signOut: () => {},
}

const EXPIRES = new Date(Date.now() + 90 * 60_000)
const FIRE_AT = new Date(EXPIRES.getTime() - 10 * 60_000).toISOString()

function makeSession(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631 },
    sign_photo: 'data:image/jpeg;base64,SIGN',
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: EXPIRES.toISOString(),
    confidence: 'high',
    push_reminders: [{ fire_at: FIRE_AT }],
    ...overrides,
  }
}

function renderSection(session: ParkingSession) {
  saveSession(session)
  render(
    <AuthContext.Provider value={AUTH}>
      <ScheduledRemindersSection session={session} />
    </AuthContext.Provider>,
  )
}

const cancelResult = (r: PushCancelResult) => mocks.cancelPushReminders.mockResolvedValue(r)
const scheduleResult = (r: PushScheduleResult) => mocks.schedulePushReminders.mockResolvedValue(r)

/** Flush the awaited push calls and the state updates after them. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(DEVICE_ID_KEY, DEVICE)
  Object.defineProperty(window, 'confirm', { value: vi.fn(() => true), configurable: true, writable: true })
  mocks.cancelPushReminders.mockReset()
  mocks.schedulePushReminders.mockReset()
  mocks.subscribeToPush.mockReset()
  mocks.subscribeToPush.mockResolvedValue({ ok: true })
  vi.stubGlobal('Notification', FakeNotification)
})

afterEach(() => {
  cleanup()
  cancelInTabReminders('rec-1')
  vi.unstubAllGlobals()
})

const otherDevice = () => i18n.t('scheduledReminders.otherDevice')
const copy = () => ({ title: 'Parking reminder', body: 'b' })
/** Arm in-tab reminders for rec-1 at these times, as Remind me did earlier. */
const armInTab = (session: ParkingSession, isoTimes: string[]) =>
  scheduleAbsoluteReminders(session, isoTimes.map((iso) => new Date(iso)), copy)
/** How many in-tab reminders rec-1 still has armed (disarms them). */
const armedCount = () => cancelInTabReminders('rec-1')
const cancelAllButton = () => screen.queryByRole('button', { name: i18n.t('scheduledReminders.cancelAll') })
const removeButton = () => screen.queryByRole('button', { name: i18n.t('scheduledReminders.cancelOne') })

describe('Cancel all', () => {
  it('on 403 ERR_NOT_OWNER: keeps the list, says another device set them, hides the controls', async () => {
    cancelResult({ ok: false, reason: 'not_owner' })
    renderSection(makeSession())

    fireEvent.click(cancelAllButton()!)
    await settle()

    expect(mocks.cancelPushReminders).toHaveBeenCalledWith('rec-1')
    expect(getSession('rec-1')?.push_reminders).toEqual([{ fire_at: FIRE_AT }])
    expect(screen.getByText(otherDevice())).toBeTruthy()
    expect(cancelAllButton()).toBeNull()
    expect(removeButton()).toBeNull()
    expect(screen.queryByText(i18n.t('scheduledReminders.addAnother'))).toBeNull()
  })

  it('on success: clears the stored list', async () => {
    cancelResult({ ok: true, deleted: 1 })
    renderSection(makeSession())

    fireEvent.click(cancelAllButton()!)
    await settle()

    expect(getSession('rec-1')?.push_reminders).toEqual([])
    expect(screen.getByText(i18n.t('scheduledReminders.noneYet'))).toBeTruthy()
  })

  it('on a network failure: keeps the list and offers a retry', async () => {
    cancelResult({ ok: false, reason: 'network' })
    renderSection(makeSession())

    fireEvent.click(cancelAllButton()!)
    await settle()

    expect(getSession('rec-1')?.push_reminders).toEqual([{ fire_at: FIRE_AT }])
    expect(screen.getByText(i18n.t('scheduledReminders.errorRetry'))).toBeTruthy()
    expect(cancelAllButton()).toBeTruthy()
  })
})

describe('Remove the last reminder', () => {
  it('on 403 ERR_NOT_OWNER: keeps the list and says another device set them', async () => {
    cancelResult({ ok: false, reason: 'not_owner' })
    renderSection(makeSession())

    fireEvent.click(removeButton()!)
    await settle()

    expect(getSession('rec-1')?.push_reminders).toEqual([{ fire_at: FIRE_AT }])
    expect(screen.getByText(otherDevice())).toBeTruthy()
    expect(removeButton()).toBeNull()
  })
})

describe('Add a reminder', () => {
  function addFifteenMinutes() {
    fireEvent.click(screen.getByText(i18n.t('scheduledReminders.addAnother')))
    fireEvent.click(screen.getByText(i18n.t('reminders.chipMin', { count: 15 })))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('reminders.remindMe.cta') }))
  }
  const statusText = () => screen.getByRole('status').textContent ?? ''

  it('picking a chip books nothing until Remind me is tapped', async () => {
    renderSection(makeSession())
    fireEvent.click(screen.getByText(i18n.t('scheduledReminders.addAnother')))
    fireEvent.click(screen.getByText(i18n.t('reminders.chipMin', { count: 15 })))
    await settle()
    expect(mocks.schedulePushReminders).not.toHaveBeenCalled()
  })

  it('on 403 ERR_NOT_OWNER: says another device set them, not "enable push"', async () => {
    scheduleResult({ ok: false, reason: 'not_owner' })
    renderSection(makeSession())

    addFifteenMinutes()
    await settle()

    expect(mocks.schedulePushReminders).toHaveBeenCalledTimes(1)
    expect(getSession('rec-1')?.push_reminders).toEqual([{ fire_at: FIRE_AT }])
    expect(screen.getByText(otherDevice())).toBeTruthy()
    expect(screen.queryByText(i18n.t('scheduledReminders.pushNotEnabled'))).toBeNull()
  })

  it('server refuses the registration even after the retry: says it only works while ParkProof is open', async () => {
    scheduleResult({ ok: false, reason: 'not_subscribed' })
    renderSection(makeSession({ push_reminders: [] }))

    addFifteenMinutes()
    await settle()

    // Never a quiet success: no background reminder is claimed or stored.
    expect(getSession('rec-1')?.push_reminders).toEqual([])
    expect(statusText()).toContain('only works while ParkProof is open')
    expect(statusText()).toContain(i18n.t('reminders.remindMe.stepRetry'))
    expect(statusText()).not.toContain('sent to this device even when ParkProof is closed')
  })

  it('books the existing reminders plus the new one, and confirms with the times', async () => {
    const added = new Date(EXPIRES.getTime() - 15 * 60_000).toISOString()
    scheduleResult({
      ok: true,
      created: [
        { name: 'parkproof-push-rec-1-0', fire_at: FIRE_AT },
        { name: 'parkproof-push-rec-1-1', fire_at: added },
      ],
      skipped: 0,
    })
    renderSection(makeSession())

    addFifteenMinutes()
    await settle()

    const [, desired] = mocks.schedulePushReminders.mock.calls[0] as [string, Array<{ fire_at: string }>]
    expect(desired.map((r) => r.fire_at).sort()).toEqual([added, FIRE_AT].sort())
    expect(statusText()).toContain('2 reminders set for')
    expect(statusText()).toContain('sent to this device even when ParkProof is closed')
  })

  it('on success: stores what the server created', async () => {
    const added = new Date(EXPIRES.getTime() - 15 * 60_000).toISOString()
    scheduleResult({
      ok: true,
      created: [
        { name: 'parkproof-push-rec-1-0', fire_at: added },
        { name: 'parkproof-push-rec-1-1', fire_at: FIRE_AT },
      ],
      skipped: 0,
    })
    renderSection(makeSession())

    addFifteenMinutes()
    await settle()

    expect(getSession('rec-1')?.push_reminders).toEqual([{ fire_at: added }, { fire_at: FIRE_AT }])
  })
})

describe('A browser with no push device id', () => {
  it('shows synced reminders as set on another device, with no change controls', () => {
    localStorage.removeItem(DEVICE_ID_KEY)
    renderSection(makeSession())

    expect(screen.getByText(otherDevice())).toBeTruthy()
    expect(cancelAllButton()).toBeNull()
    expect(removeButton()).toBeNull()
    expect(mocks.cancelPushReminders).not.toHaveBeenCalled()
  })

  it('can still add reminders to a record that has none', () => {
    localStorage.removeItem(DEVICE_ID_KEY)
    renderSection(makeSession({ push_reminders: [] }))

    expect(screen.queryByText(otherDevice())).toBeNull()
    expect(screen.getByText(i18n.t('scheduledReminders.addAnother'))).toBeTruthy()
  })
})

describe('In-tab reminders follow the list', () => {
  const EARLIER = new Date(EXPIRES.getTime() - 30 * 60_000).toISOString()

  it('removing the last reminder disarms its in-tab copy', async () => {
    cancelResult({ ok: true, deleted: 1 })
    const session = makeSession()
    await armInTab(session, [FIRE_AT])
    renderSection(session)

    fireEvent.click(removeButton()!)
    await settle()

    expect(getSession('rec-1')?.push_reminders).toEqual([])
    expect(armedCount()).toBe(0)
  })

  it('removing one of two disarms only that one', async () => {
    scheduleResult({ ok: true, created: [{ name: 'parkproof-push-rec-1-0', fire_at: EARLIER }], skipped: 0 })
    const session = makeSession({ push_reminders: [{ fire_at: EARLIER }, { fire_at: FIRE_AT }] })
    await armInTab(session, [EARLIER, FIRE_AT])
    renderSection(session)

    // The rows are in time order: the second is FIRE_AT.
    fireEvent.click(screen.getAllByRole('button', { name: i18n.t('scheduledReminders.cancelOne') })[1])
    await settle()

    expect(getSession('rec-1')?.push_reminders).toEqual([{ fire_at: EARLIER }])
    expect(armedCount()).toBe(1)
  })

  it('cancel all disarms every in-tab reminder for the record', async () => {
    cancelResult({ ok: true, deleted: 2 })
    const session = makeSession({ push_reminders: [{ fire_at: EARLIER }, { fire_at: FIRE_AT }] })
    await armInTab(session, [EARLIER, FIRE_AT])
    renderSection(session)

    fireEvent.click(cancelAllButton()!)
    await settle()

    expect(armedCount()).toBe(0)
  })

  it('a refused cancel (another device) leaves the in-tab reminders alone', async () => {
    cancelResult({ ok: false, reason: 'not_owner' })
    const session = makeSession()
    await armInTab(session, [FIRE_AT])
    renderSection(session)

    fireEvent.click(cancelAllButton()!)
    await settle()

    expect(armedCount()).toBe(1)
  })

  it("a booking refused as another device's disarms the in-tab reminder the tap armed", async () => {
    scheduleResult({ ok: false, reason: 'not_owner' })
    renderSection(makeSession())

    fireEvent.click(screen.getByText(i18n.t('scheduledReminders.addAnother')))
    fireEvent.click(screen.getByText(i18n.t('reminders.chipMin', { count: 15 })))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('reminders.remindMe.cta') }))
    await settle()

    expect(screen.getByText(otherDevice())).toBeTruthy()
    expect(armedCount()).toBe(0)
  })

  it('push failed but the in-tab reminder was set: the picker stays open, and a retry replaces it', async () => {
    scheduleResult({ ok: false, reason: 'network' })
    renderSection(makeSession({ push_reminders: [] }))

    fireEvent.click(screen.getByText(i18n.t('scheduledReminders.addAnother')))
    fireEvent.click(screen.getByText(i18n.t('reminders.chipMin', { count: 15 })))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('reminders.remindMe.cta') }))
    await settle()

    const status = screen.getByRole('status').textContent ?? ''
    expect(status).toContain('only works while ParkProof is open')
    expect(status).toContain(i18n.t('reminders.remindMe.stepRetry'))
    // The step says to tap Remind me again: the button is still there, with the pick.
    const remindMe = screen.getByRole('button', { name: i18n.t('reminders.remindMe.cta') }) as HTMLButtonElement
    expect(remindMe.disabled).toBe(false)

    scheduleResult({
      ok: true,
      created: [{ name: 'parkproof-push-rec-1-0', fire_at: new Date(EXPIRES.getTime() - 15 * 60_000).toISOString() }],
      skipped: 0,
    })
    fireEvent.click(remindMe)
    await settle()

    expect(screen.getByRole('status').textContent ?? '').toContain('sent to this device even when ParkProof is closed')
    // One in-tab reminder for the one time, not one per tap.
    expect(armedCount()).toBe(1)
    // Booked: the picker closes.
    expect(screen.queryByRole('button', { name: i18n.t('reminders.remindMe.cta') })).toBeNull()
  })
})
