import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cancelInTabReminders, scheduleParkingReminders } from './notifications'
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
