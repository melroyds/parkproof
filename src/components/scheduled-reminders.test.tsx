// @vitest-environment happy-dom
//
// ScheduledRemindersSection and push ownership (spec N6). push_reminders
// syncs through the cloud, so a second device can show the first device's
// reminders. There every change is refused with 403 ERR_NOT_OWNER: the list
// must stay exactly as it is (clearing it would mirror an empty list to the
// cloud while the other device's pushes keep firing), the screen must say the
// reminders belong to another device, and the change controls must go.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { getSession, saveSession } from '../lib/storage'
import type { PushCancelResult, PushScheduleResult } from '../lib/push'
import type { ParkingSession } from '../types'
import ScheduledRemindersSection from './ScheduledRemindersSection'

const mocks = vi.hoisted(() => ({
  cancelPushReminders: vi.fn(),
  schedulePushReminders: vi.fn(),
}))
vi.mock('../lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/push')>()),
  cancelPushReminders: mocks.cancelPushReminders,
  schedulePushReminders: mocks.schedulePushReminders,
}))

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

/** Flush the awaited push call and the state updates after it. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
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
})

afterEach(() => {
  cleanup()
})

const otherDevice = () => i18n.t('scheduledReminders.otherDevice')
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
  }

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

  it('without push on this browser: asks to enable push', async () => {
    scheduleResult({ ok: false, reason: 'not_subscribed' })
    renderSection(makeSession({ push_reminders: [] }))

    addFifteenMinutes()
    await settle()

    expect(screen.getByText(i18n.t('scheduledReminders.pushNotEnabled'))).toBeTruthy()
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
