// @vitest-environment happy-dom
//
// The reminder screen after logging a record (field-test fix list, item 2,
// and the Tier 2 Android tips). One primary "Remind me" replaces "Enable
// push" and "Enable N browser notifications"; the calendar option stays;
// the reliability line is always there; the Android tips show on Android
// only. A tap books push and in-tab reminders and confirms with the times,
// or says plainly that the reminder only works while ParkProof is open.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { getSession, saveSession } from '../lib/storage'
import { cancelInTabReminders } from '../lib/notifications'
import type { ParkingSession } from '../types'
import ReminderOptions from './ReminderOptions'

const mocks = vi.hoisted(() => ({
  schedulePushReminders: vi.fn(),
  subscribeToPush: vi.fn(),
}))
vi.mock('../lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/push')>()),
  schedulePushReminders: mocks.schedulePushReminders,
  subscribeToPush: mocks.subscribeToPush,
}))

const AUTH: AuthContextValue = {
  user: null,
  loading: false,
  configured: false,
  refresh: async () => {},
  signOut: () => {},
}

class FakeNotification {
  static permission = 'granted'
  static requestPermission = async () => 'granted'
}

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'

const EXPIRES = new Date(Date.now() + 90 * 60_000)

function makeSession(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-r',
    arrived_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: EXPIRES.toISOString(),
    confidence: 'high',
    ...overrides,
  }
}

function renderScreen(session: ParkingSession) {
  saveSession(session)
  render(
    <AuthContext.Provider value={AUTH}>
      <ReminderOptions session={session} onDone={() => {}} />
    </AuthContext.Provider>,
  )
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const remindMeButton = () => screen.getByRole('button', { name: i18n.t('reminders.remindMe.cta') })
const statusText = () => screen.getByRole('status').textContent ?? ''

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  mocks.schedulePushReminders.mockReset()
  mocks.subscribeToPush.mockReset()
  mocks.subscribeToPush.mockResolvedValue({ ok: true })
  vi.stubGlobal('Notification', FakeNotification)
})

afterEach(() => {
  cleanup()
  cancelInTabReminders('rec-r')
  cancelInTabReminders('rec-n')
  vi.unstubAllGlobals()
})

describe('ReminderOptions', () => {
  it('has one Remind me action, no separate Enable push, and keeps the calendar and the reliability line', () => {
    renderScreen(makeSession())
    expect(remindMeButton()).toBeTruthy()
    expect(screen.queryByText(i18n.t('reminders.pushStatus.enable'))).toBeNull()
    expect(screen.queryByText(/browser notification/i)).toBeNull()
    expect(screen.getByText(i18n.t('reminders.calendarHeader'))).toBeTruthy()
    expect(screen.getByText(i18n.t('reminders.reliability'))).toBeTruthy()
    // Not Android: no Android tips.
    expect(screen.queryByText(i18n.t('reminders.androidTips.summary'))).toBeNull()
  })

  it('shows the Android tips on Android, collapsed', () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: ANDROID_UA })
    renderScreen(makeSession())
    const summary = screen.getByText(i18n.t('reminders.androidTips.summary'))
    expect(summary.tagName).toBe('SUMMARY')
    expect((summary.parentElement as HTMLDetailsElement).open).toBe(false)
    expect(screen.getByText(i18n.t('reminders.androidTips.spam'))).toBeTruthy()
    expect(screen.getByText(i18n.t('reminders.androidTips.battery'))).toBeTruthy()
  })

  it('one tap books push and stores the server times, then confirms them', async () => {
    const thirty = new Date(EXPIRES.getTime() - 30 * 60_000).toISOString()
    const five = new Date(EXPIRES.getTime() - 5 * 60_000).toISOString()
    mocks.schedulePushReminders.mockResolvedValue({
      ok: true,
      created: [
        { name: 'parkproof-push-rec-r-0', fire_at: thirty },
        { name: 'parkproof-push-rec-r-1', fire_at: five },
      ],
      skipped: 0,
    })
    renderScreen(makeSession())

    fireEvent.click(remindMeButton())
    await settle()

    expect(mocks.subscribeToPush).toHaveBeenCalledTimes(1)
    const [sessionId, reminders, expiresAt] = mocks.schedulePushReminders.mock.calls[0]
    expect(sessionId).toBe('rec-r')
    expect((reminders as Array<{ fire_at: string }>).map((r) => r.fire_at)).toEqual([thirty, five])
    expect(expiresAt).toBe(EXPIRES.toISOString())
    expect(getSession('rec-r')?.push_reminders).toEqual([{ fire_at: thirty }, { fire_at: five }])
    expect(statusText()).toContain('2 reminders set for')
    expect(statusText()).toContain('sent to this device even when ParkProof is closed')
  })

  it('push refused even after the retry: says it only works while ParkProof is open, stores nothing', async () => {
    mocks.schedulePushReminders.mockResolvedValue({ ok: false, reason: 'not_subscribed' })
    renderScreen(makeSession())

    fireEvent.click(remindMeButton())
    await settle()

    expect(getSession('rec-r')?.push_reminders).toBeUndefined()
    expect(statusText()).toContain('only work while ParkProof is open')
    expect(statusText()).toContain(i18n.t('reminders.remindMe.stepRetry'))
  })

  it('notifications blocked: nothing set, and the next step is to allow them', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission: async () => 'denied' })
    renderScreen(makeSession())

    fireEvent.click(remindMeButton())
    await settle()

    expect(mocks.schedulePushReminders).not.toHaveBeenCalled()
    expect(statusText()).toContain(i18n.t('reminders.remindMe.notSet'))
    expect(statusText()).toContain(i18n.t('reminders.remindMe.stepAllow'))
  })

  it('a no-sign record books from the moment of the tap, with no expiry', async () => {
    mocks.schedulePushReminders.mockImplementation(async (_id: string, reminders: Array<{ fire_at: string }>) => ({
      ok: true,
      created: reminders.map((r, i) => ({ name: `n-${i}`, fire_at: r.fire_at })),
      skipped: 0,
    }))
    renderScreen(makeSession({ id: 'rec-n', expires_at: null, no_sign: true }))

    const before = Date.now()
    fireEvent.click(remindMeButton())
    await settle()

    const [, reminders, expiresAt] = mocks.schedulePushReminders.mock.calls[0]
    expect(expiresAt).toBeNull()
    const fire = new Date((reminders as Array<{ fire_at: string }>)[0].fire_at).getTime()
    // The default chip is one hour.
    expect(fire).toBeGreaterThanOrEqual(before + 60 * 60_000)
    expect(fire).toBeLessThanOrEqual(Date.now() + 60 * 60_000)
    expect(statusText()).toContain('1 reminder set for')
  })
})
