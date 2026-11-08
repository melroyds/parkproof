// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { IN_TAB_STALE_MS, cancelInTabReminders, scheduleAbsoluteReminders, scheduleParkingReminders } from './notifications'
import { saveSession, updateSession } from './storage'
import type { ParkingSession } from '../types'

describe('in-tab reminders', () => {
  const shown: string[] = []
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T01:00:00.000Z'))
    shown.length = 0
    class FakeNotification {
      static permission = 'granted'
      static requestPermission = async () => 'granted'
      constructor(title: string) {
        shown.push(title)
      }
    }
    vi.stubGlobal('Notification', FakeNotification)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const session = {
    id: 'trip-1',
    arrived_at: '2026-10-25T00:00:00.000Z',
    expires_at: '2026-10-25T02:00:00.000Z',
    location: null,
  } as unknown as ParkingSession
  const copy = () => ({ title: 'Move the car', body: 'b' })

  it('fires when not cancelled', async () => {
    await scheduleParkingReminders(session, [15], copy)
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(shown).toEqual(['Move the car'])
  })

  it('stays silent after the driver says they have left', async () => {
    await scheduleParkingReminders(session, [15, 5], copy)
    expect(cancelInTabReminders('trip-1')).toBe(2)
    vi.advanceTimersByTime(2 * 60 * 60 * 1000)
    expect(shown).toEqual([])
  })
})

// Review of the field-test build: the Android service-worker fallback made
// in-tab reminders show on phones, where a backgrounded page is frozen and
// every overdue timer runs at once on resume.
describe('in-tab reminders: stale, ended, one at a time', () => {
  const shown: string[] = []
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T01:00:00.000Z'))
    shown.length = 0
    localStorage.clear()
    class FakeNotification {
      static permission = 'granted'
      static requestPermission = async () => 'granted'
      constructor(title: string) {
        shown.push(title)
      }
    }
    vi.stubGlobal('Notification', FakeNotification)
  })
  afterEach(() => {
    cancelInTabReminders('trip-2')
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const session = {
    id: 'trip-2',
    arrived_at: '2026-10-25T00:00:00.000Z',
    expires_at: '2026-10-25T02:00:00.000Z',
    location: null,
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    confidence: 'high',
  } as unknown as ParkingSession
  const copy = (fireAt: Date) => ({ title: `at ${fireAt.toISOString()}`, body: 'b' })

  it('drops a timer that fires long after its time (a frozen page resumed)', async () => {
    await scheduleParkingReminders(session, [30, 5], copy)
    // The page is frozen: the clock moves 70 minutes on while no timer
    // runs, so each one runs 70 minutes after its time.
    vi.setSystemTime(Date.now() + 70 * 60 * 1000)
    vi.advanceTimersByTime(2 * 60 * 60 * 1000)
    expect(shown).toEqual([])
  })

  it('still shows a timer that runs a little late', async () => {
    await scheduleParkingReminders(session, [30], copy)
    vi.setSystemTime(Date.now() + IN_TAB_STALE_MS - 1_000)
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(shown).toEqual(['at 2026-10-25T01:30:00.000Z'])
  })

  it('stays silent once the record has ended, here or on another device', async () => {
    saveSession(session)
    await scheduleParkingReminders(session, [15], copy)
    updateSession('trip-2', { ended_at: '2026-10-25T01:20:00.000Z' })
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(shown).toEqual([])
  })

  it('cancels only the reminders at the given times', async () => {
    const at = (iso: string) => new Date(iso)
    await scheduleAbsoluteReminders(session, [at('2026-10-25T01:30:00.000Z'), at('2026-10-25T01:45:00.000Z')], copy)
    expect(cancelInTabReminders('trip-2', [at('2026-10-25T01:30:00.000Z')])).toBe(1)
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(shown).toEqual(['at 2026-10-25T01:45:00.000Z'])
    expect(cancelInTabReminders('trip-2')).toBe(0)
  })

  it('falls back to the service worker, marking the copy as in-tab so the push copy replaces it quietly', async () => {
    vi.stubGlobal(
      'Notification',
      class {
        static permission = 'granted'
        static requestPermission = async () => 'granted'
        constructor() {
          throw new TypeError('Illegal constructor')
        }
      },
    )
    const showNotification = vi.fn(async () => {})
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: async () => ({ showNotification }) },
    })
    try {
      await scheduleParkingReminders(session, [15], copy)
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
      expect(showNotification).toHaveBeenCalledTimes(1)
      const [, options] = showNotification.mock.calls[0] as unknown as [string, NotificationOptions & { data: Record<string, unknown> }]
      expect(options.tag).toBe(`pp-trip-2-${new Date('2026-10-25T01:45:00.000Z').getTime()}`)
      expect(options.data).toMatchObject({ session_id: 'trip-2', in_tab: true })
    } finally {
      delete (navigator as { serviceWorker?: unknown }).serviceWorker
    }
  })
})
