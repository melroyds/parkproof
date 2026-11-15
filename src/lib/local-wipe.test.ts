// @vitest-environment happy-dom
//
// Clearing this device after the account is deleted (settings.deleteCopy:
// "Local records on this device are also cleared as part of the sign-out
// that follows"): every record and every photo goes, the reminders booked
// for them are cancelled, the per-record device state goes, and the
// browser's own settings (never in the account) stay.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession } from '../types'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from './photo-store'
import { RECORDS_CHANGED_EVENT, loadSessions } from './storage'

const mocks = vi.hoisted(() => ({
  cancelPushReminders: vi.fn(async (id: string) => {
    void id
    return { ok: true as const, deleted: 1 }
  }),
  cancelInTabReminders: vi.fn((id: string) => {
    void id
    return 0
  }),
}))
vi.mock('./push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./push')>()),
  cancelPushReminders: mocks.cancelPushReminders,
}))
vi.mock('./notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./notifications')>()),
  cancelInTabReminders: mocks.cancelInTabReminders,
}))

import { clearLocalRecords } from './local-wipe'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
/** An ISO time `ms` from now. */
const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString()

/** Parked now, its limit two hours away. Its reminders are booked, but none were cached (the booking's answer was lost). */
const ACTIVE = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
/** Left an hour ago: every reminder time cached for it has passed. */
const ENDED = '1a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
/** Someone else's park (T7): it never books reminders, whatever its cache says. */
const SHARED = '2a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
/** Photos in the store, no record. */
const ORPHAN = '3a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
/** Left early, but a cached reminder time is still ahead (the cancel on "I've left" failed). */
const ENDED_PENDING = '4a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

function record(id: string, overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id,
    arrived_at: fromNow(-HOUR),
    location: null,
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: fromNow(HOUR),
    confidence: 'high',
    ...overrides,
  }
}

function seed(records: ParkingSession[]): void {
  localStorage.setItem('parkproof.sessions.v1', JSON.stringify(records))
}

/** The browser's own settings and device state, never in the account: they must survive. */
const KEPT: Record<string, string> = {
  'parkproof.profile.v1': JSON.stringify({ driver_name: 'Sam', permits: [] }),
  'parkproof.recurring.v1': JSON.stringify([{ id: 'r1', label: 'Sweep' }]),
  'parkproof.recurring.push.v1': '{"fp":"x"}',
  'parkproof.language': 'en',
  'parkproof.device_id.v1': 'device-1',
  'parkproof.backupPrompt.v1': '1',
}

let backend: ReturnType<typeof createMemoryPhotoBackend>

beforeEach(() => {
  localStorage.clear()
  mocks.cancelPushReminders.mockClear()
  mocks.cancelInTabReminders.mockClear()
  backend = createMemoryPhotoBackend()
  setPhotoBackendForTests(backend)
  seed([
    record(ACTIVE, { expires_at: fromNow(2 * HOUR), push_reminders: [] }),
    record(ENDED, {
      arrived_at: fromNow(-3 * HOUR),
      expires_at: fromNow(-HOUR),
      ended_at: fromNow(-HOUR),
      push_reminders: [{ fire_at: fromNow(-90 * MINUTE) }, { fire_at: fromNow(-HOUR) }],
    }),
    record(ENDED_PENDING, {
      ended_at: fromNow(-10 * MINUTE),
      push_reminders: [{ fire_at: fromNow(-20 * MINUTE) }, { fire_at: fromNow(50 * MINUTE) }],
    }),
    record(SHARED, {
      shared_from: { original_session_id: 'orig' } as ParkingSession['shared_from'],
      push_reminders: [{ fire_at: fromNow(30 * MINUTE) }],
    }),
  ])
  localStorage.setItem('parkproof.workday.v1', JSON.stringify([{ id: 'w1', status: 'parked' }]))
  localStorage.setItem('parkproof.signing.state.v2', JSON.stringify({ [ENDED]: { last: 1 } }))
  localStorage.setItem('parkproof.signing.retry.v1', '{}')
  localStorage.setItem('parkproof.sync.uploaded.v1', JSON.stringify({ 'user-1': [`${ENDED}/abc`] }))
  for (const [k, v] of Object.entries(KEPT)) localStorage.setItem(k, v)
})

afterEach(() => {
  setPhotoBackendForTests(null)
})

describe('clearLocalRecords', () => {
  it('removes every record, shared copies too, and tells open screens', async () => {
    const changed = vi.fn()
    window.addEventListener(RECORDS_CHANGED_EVENT, changed)
    try {
      const result = await clearLocalRecords()
      expect(result.records).toBe(4)
      expect(loadSessions()).toEqual([])
      expect(localStorage.getItem('parkproof.sessions.v1')).toBeNull()
      expect(changed).toHaveBeenCalled()
    } finally {
      window.removeEventListener(RECORDS_CHANGED_EVENT, changed)
    }
  })

  it('deletes every photo in the store, orphans included', async () => {
    await putPhoto(ACTIVE, 'data:image/jpeg;base64,' + btoa('sign'))
    await putPhoto(ENDED, 'data:image/jpeg;base64,' + btoa('car'))
    await putPhoto(ORPHAN, 'data:image/jpeg;base64,' + btoa('left over'))
    expect(backend.records.size).toBe(3)
    const result = await clearLocalRecords()
    expect(result.photos).toBe(3)
    expect(backend.records.size).toBe(0)
  })

  it('cancels the in-tab reminders of every record, and the push ones that may still fire', async () => {
    const result = await clearLocalRecords()
    expect(mocks.cancelInTabReminders.mock.calls.map((c) => c[0]).sort()).toEqual(
      [ACTIVE, ENDED, ENDED_PENDING, SHARED].sort(),
    )
    expect(mocks.cancelPushReminders.mock.calls.map((c) => c[0]).sort()).toEqual([ACTIVE, ENDED_PENDING].sort())
    expect(result.pushCancels).toHaveLength(2)
    await Promise.all(result.pushCancels)
  })

  it('an active record gets a push cancel even with nothing in its reminder cache', async () => {
    // Remind me booked the push, but its answer never came back, so the
    // record says nothing about it (ReminderOptions only caches a success).
    seed([record(ACTIVE, { expires_at: fromNow(2 * HOUR), push_reminders: [] })])
    const result = await clearLocalRecords()
    expect(mocks.cancelPushReminders.mock.calls.map((c) => c[0])).toEqual([ACTIVE])
    expect(result.pushCancels).toHaveLength(1)
    await Promise.all(result.pushCancels)
  })

  it('an ended record whose cached reminder times have all passed gets no push cancel', async () => {
    seed([
      record(ENDED, {
        arrived_at: fromNow(-3 * HOUR),
        expires_at: fromNow(-HOUR),
        ended_at: fromNow(-HOUR),
        push_reminders: [{ fire_at: fromNow(-90 * MINUTE) }, { fire_at: fromNow(-HOUR) }],
      }),
    ])
    const result = await clearLocalRecords()
    expect(mocks.cancelPushReminders).not.toHaveBeenCalled()
    expect(result.pushCancels).toEqual([])
  })

  it('a push cancel that fails stays a warning, and never fails the wipe', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.cancelPushReminders.mockRejectedValueOnce(new Error('offline'))
    const result = await clearLocalRecords()
    await expect(Promise.all(result.pushCancels)).resolves.toBeDefined()
    expect(loadSessions()).toEqual([])
  })

  it('forgets the state kept only for records: workday, signing, upload markers', async () => {
    await clearLocalRecords()
    expect(localStorage.getItem('parkproof.workday.v1')).toBeNull()
    expect(localStorage.getItem('parkproof.signing.state.v2')).toBeNull()
    expect(localStorage.getItem('parkproof.signing.retry.v1')).toBeNull()
    expect(localStorage.getItem('parkproof.sync.uploaded.v1')).toBeNull()
  })

  it('stores when it happened, so a sync in another open tab writes nothing back', async () => {
    const before = Date.now()
    await clearLocalRecords()
    const after = Date.now()
    const stored = Number(localStorage.getItem('parkproof.sync.wiped_at.v1'))
    expect(stored).toBeGreaterThanOrEqual(before)
    expect(stored).toBeLessThanOrEqual(after)
  })

  it("keeps this browser's own settings, which were never in the account", async () => {
    await clearLocalRecords()
    for (const [k, v] of Object.entries(KEPT)) expect(localStorage.getItem(k)).toBe(v)
  })

  it('still clears the records when the photo store fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    backend.listMeta = async () => {
      throw new Error('IndexedDB broke')
    }
    const result = await clearLocalRecords()
    expect(result.photos).toBeNull()
    expect(loadSessions()).toEqual([])
  })
})
