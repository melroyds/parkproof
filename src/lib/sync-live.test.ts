// @vitest-environment happy-dom
//
// Records from other devices reach open screens while the sync runs, and
// the app pulls again when it comes back (field-test fix list, item 6 and
// Tier 2):
//   - scheduleRecordsChanged collapses a synchronous burst into ONE
//     records-changed notification on the next microtask;
//   - performInitialSync tells screens about pulled records as they land
//     (one notification for a whole pull), and merges and pulls land before
//     any local-only upload is waited on;
//   - createSyncRunner runs one sync at a time (a call made meanwhile gets
//     one follow-up), and the pull on return is skipped while a sync runs,
//     while offline, and within a minute of the last start;
//   - installSyncOnReturn pulls on visibilitychange to visible and on online.
//
// Review of that build:
//   - a pull on return uploads no local-only record: one missing from the
//     listing then was most likely deleted on another device, and uploading
//     it again would undo the delete (the app start and sign-in syncs still
//     upload, as before);
//   - a return inside the minute is not dropped: one pull follows when the
//     minute ends, if the page is still on screen;
//   - a record deleted here while a pull's listing is in flight is not
//     written back (its tombstone), so the next app start can't upload it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession } from '../types'

const { getIdToken } = vi.hoisted(() => ({ getIdToken: vi.fn(async (): Promise<string | null> => null) }))
vi.mock('./auth', () => ({ getIdToken }))
vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

import {
  SYNC_ON_RETURN_INTERVAL_MS,
  createSyncRunner,
  deleteCloudSession,
  installSyncOnReturn,
  performInitialSync,
  resetSyncForTests,
  type InitialSyncResult,
  type SyncOptions,
} from './sync'
import {
  RECORDS_CHANGED_EVENT,
  deleteSession,
  getSession,
  loadSessions,
  saveSession,
  scheduleRecordsChanged,
} from './storage'
import { resetSigningQueueForTests, whenSigningIdle } from './signing'
import { createFakeCloud, fakeIdToken, type FakeCloud } from './test-support/fake-cloud'

const USER = 'user-1'
let cloud: FakeCloud

function record(id: string, overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id,
    arrived_at: '2026-11-08T06:08:11.000Z',
    location: null,
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    ...overrides,
  }
}

/** Every records-changed notification's `id`, in order. */
function listenForChanges(): { ids: Array<string | null>; stop: () => void } {
  const ids: Array<string | null> = []
  const listener = (e: Event) => ids.push((e as CustomEvent<{ id: string | null }>).detail.id)
  window.addEventListener(RECORDS_CHANGED_EVENT, listener)
  return { ids, stop: () => window.removeEventListener(RECORDS_CHANGED_EVENT, listener) }
}

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  localStorage.clear()
  resetSyncForTests()
  resetSigningQueueForTests()
  cloud = createFakeCloud(USER)
  getIdToken.mockImplementation(async () => fakeIdToken(USER))
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => cloud.fetch(input, init)))
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  await whenSigningIdle()
  vi.unstubAllGlobals()
})

describe('scheduleRecordsChanged', () => {
  it('collapses a synchronous burst into one notification, after the burst', async () => {
    const heard = listenForChanges()
    try {
      scheduleRecordsChanged('a')
      scheduleRecordsChanged('b')
      scheduleRecordsChanged('c')
      expect(heard.ids).toEqual([])
      await flushMicrotasks()
      expect(heard.ids).toEqual([null])
    } finally {
      heard.stop()
    }
  })

  it('names the record when only one changed, and starts afresh after a flush', async () => {
    const heard = listenForChanges()
    try {
      scheduleRecordsChanged('a')
      scheduleRecordsChanged('a')
      await flushMicrotasks()
      scheduleRecordsChanged('b')
      await flushMicrotasks()
      expect(heard.ids).toEqual(['a', 'b'])
    } finally {
      heard.stop()
    }
  })
})

describe('performInitialSync: records land on open screens as they arrive', () => {
  it('a pull of 50 records stores them all and notifies once, not 50 times', async () => {
    const ids = Array.from({ length: 50 }, () => crypto.randomUUID())
    for (const id of ids) cloud.rows.set(id, { ...record(id) })
    const heard = listenForChanges()
    try {
      const result = await performInitialSync()
      await flushMicrotasks()
      expect(result.pulled).toBe(50)
      expect(loadSessions()).toHaveLength(50)
      expect(heard.ids).toEqual([null])
    } finally {
      heard.stop()
    }
  })

  it('pulled records and merged ends land before a local-only upload is waited on', async () => {
    const pulledId = crypto.randomUUID()
    const mergedId = crypto.randomUUID()
    const localOnlyId = crypto.randomUUID()
    // On another device: a new record, and the end of a record this phone has open.
    cloud.rows.set(pulledId, { ...record(pulledId) })
    cloud.rows.set(mergedId, { ...record(mergedId, { ended_at: '2026-11-08T06:23:23.000Z' }) })
    saveSession(record(mergedId))
    saveSession(record(localOnlyId))

    let releaseUpload!: () => void
    const uploadHeld = new Promise<void>((resolve) => {
      releaseUpload = resolve
    })
    let uploadStarted = false
    cloud.beforeUpload = async (row) => {
      if (row.id !== localOnlyId) return
      uploadStarted = true
      await uploadHeld
    }

    const heard = listenForChanges()
    try {
      const run = performInitialSync()
      await vi.waitFor(() => expect(uploadStarted).toBe(true))
      await flushMicrotasks()
      // The local-only upload is still open, yet both arrivals are stored and announced.
      expect(getSession(pulledId)).toBeDefined()
      expect(getSession(mergedId)?.ended_at).toBe('2026-11-08T06:23:23.000Z')
      expect(heard.ids).toEqual(expect.arrayContaining([pulledId, mergedId]))

      releaseUpload()
      const result = await run
      expect(result).toMatchObject({ pulled: 1, merged: 1, uploaded: 1, listFailed: false })
    } finally {
      heard.stop()
    }
  })
})

// ─── createSyncRunner ─────────────────────────────────────────────────────

const RESULT: InitialSyncResult = { uploaded: 0, pulled: 0, alreadyInSync: 0, merged: 0, listFailed: false }

/** A stand-in sync whose runs finish only when the test says so. */
function controllableSync() {
  const finishers: Array<() => void> = []
  const sync = vi.fn(
    () =>
      new Promise<InitialSyncResult>((resolve) => {
        finishers.push(() => resolve(RESULT))
      }),
  )
  return {
    sync,
    /** Finish the oldest unfinished run. */
    finishNext: async () => {
      finishers.shift()?.()
      await flushMicrotasks()
    },
  }
}

describe('createSyncRunner: one sync at a time', () => {
  it('a call made while a sync runs gets one follow-up, shared by every such call', async () => {
    const { sync, finishNext } = controllableSync()
    const runner = createSyncRunner(sync)
    const first = runner.now()
    const second = runner.now()
    const third = runner.now()
    expect(sync).toHaveBeenCalledTimes(1)
    expect(second).toBe(third)
    expect(second).not.toBe(first)

    await finishNext()
    await expect(first).resolves.toEqual(RESULT)
    // The follow-up starts only once the first has settled.
    expect(sync).toHaveBeenCalledTimes(2)
    await finishNext()
    await expect(second).resolves.toEqual(RESULT)
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('a failed run still lets the follow-up start', async () => {
    let fail = true
    const sync = vi.fn(async () => {
      if (fail) {
        fail = false
        throw new Error('list failed')
      }
      return RESULT
    })
    const runner = createSyncRunner(sync)
    const first = runner.now()
    const second = runner.now()
    await expect(first).rejects.toThrow('list failed')
    await expect(second).resolves.toEqual(RESULT)
    expect(sync).toHaveBeenCalledTimes(2)
  })
})

describe('createSyncRunner: pull on return', () => {
  it('is skipped while a sync runs or is queued, and never starts a second one', async () => {
    const { sync, finishNext } = controllableSync()
    const runner = createSyncRunner(sync)
    const t0 = Date.now()
    void runner.now()
    expect(runner.onReturn(t0 + SYNC_ON_RETURN_INTERVAL_MS * 2)).toBeNull()
    void runner.now() // queued follow-up
    await finishNext()
    expect(runner.onReturn(t0 + SYNC_ON_RETURN_INTERVAL_MS * 2)).toBeNull()
    await finishNext()
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('runs at most once a minute, counted from the last start', async () => {
    const sync = vi.fn(async () => RESULT)
    const runner = createSyncRunner(sync)
    const t0 = 1_000_000
    const first = runner.onReturn(t0)
    expect(first).not.toBeNull()
    await first
    expect(runner.onReturn(t0 + 1_000)).toBeNull()
    expect(runner.onReturn(t0 + SYNC_ON_RETURN_INTERVAL_MS - 1)).toBeNull()
    const second = runner.onReturn(t0 + SYNC_ON_RETURN_INTERVAL_MS)
    expect(second).not.toBeNull()
    await second
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('the app-start sync counts: coming back within the minute pulls nothing', async () => {
    const sync = vi.fn(async () => RESULT)
    const runner = createSyncRunner(sync)
    await runner.now()
    expect(runner.onReturn(Date.now() + 1_000)).toBeNull()
    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('is skipped while offline, without using up the minute', async () => {
    const sync = vi.fn(async () => RESULT)
    const runner = createSyncRunner(sync)
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
    expect(runner.onReturn(1_000_000)).toBeNull()
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    const run = runner.onReturn(1_000_001)
    expect(run).not.toBeNull()
    await run
    expect(sync).toHaveBeenCalledTimes(1)
  })
})

describe('installSyncOnReturn', () => {
  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('pulls when the page becomes visible or the browser comes back online, until removed', async () => {
    const sync = vi.fn(async () => RESULT)
    const runner = createSyncRunner(sync, 0)
    const onRun = vi.fn((run: Promise<InitialSyncResult>) => void run)
    const uninstall = installSyncOnReturn(runner, onRun)
    try {
      setVisibility('hidden')
      expect(onRun).not.toHaveBeenCalled()

      setVisibility('visible')
      expect(onRun).toHaveBeenCalledTimes(1)
      await onRun.mock.calls[0][0]

      window.dispatchEvent(new Event('online'))
      expect(onRun).toHaveBeenCalledTimes(2)
      await onRun.mock.calls[1][0]
    } finally {
      uninstall()
    }
    setVisibility('visible')
    window.dispatchEvent(new Event('online'))
    expect(onRun).toHaveBeenCalledTimes(2)
    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('hands over nothing when the pull is skipped (a sync is still running)', () => {
    const { sync } = controllableSync()
    const runner = createSyncRunner(sync, 0)
    void runner.now()
    const onRun = vi.fn()
    const uninstall = installSyncOnReturn(runner, onRun)
    try {
      setVisibility('visible')
      expect(onRun).not.toHaveBeenCalled()
      expect(sync).toHaveBeenCalledTimes(1)
    } finally {
      uninstall()
    }
  })
})

describe('pull on return: a record deleted on another device stays deleted', () => {
  it('performInitialSync({ uploadLocalOnly: false }) pulls and merges but uploads no local-only record', async () => {
    const deletedElsewhere = crypto.randomUUID()
    const pulledId = crypto.randomUUID()
    saveSession(record(deletedElsewhere))
    cloud.rows.set(pulledId, { ...record(pulledId) })

    const result = await performInitialSync({ uploadLocalOnly: false })

    expect(result).toMatchObject({ pulled: 1, uploaded: 0, listFailed: false })
    expect(cloud.rows.has(deletedElsewhere)).toBe(false)
    expect(getSession(pulledId)).toBeDefined()
    // Still on this device: only the next full sync decides about it.
    expect(getSession(deletedElsewhere)).toBeDefined()
  })

  it('the full sync (app start, sign-in, retry) still uploads a local-only record', async () => {
    const localOnly = crypto.randomUUID()
    saveSession(record(localOnly))
    const result = await performInitialSync()
    expect(result.uploaded).toBe(1)
    expect(cloud.rows.has(localOnly)).toBe(true)
  })

  it('a record deleted here while the listing is in flight is not pulled back, nor uploaded at the next start', async () => {
    const deleted = crypto.randomUUID()
    const kept = crypto.randomUUID()
    for (const id of [deleted, kept]) {
      cloud.rows.set(id, { ...record(id) })
      saveSession(record(id))
    }
    // The listing is read on the server first, then held on its way back.
    let releaseList!: () => void
    const listHeld = new Promise<void>((resolve) => {
      releaseList = resolve
    })
    let listRead = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        const response = await cloud.fetch(input, init)
        if (input.endsWith('/sessions/list')) {
          listRead = true
          await listHeld
        }
        return response
      }),
    )

    const run = performInitialSync({ uploadLocalOnly: false })
    await vi.waitFor(() => expect(listRead).toBe(true))
    // The driver deletes the record now, the way App does: here, then in the cloud.
    deleteSession(deleted)
    await deleteCloudSession(deleted)
    expect(cloud.rows.has(deleted)).toBe(false)
    releaseList()
    const result = await run

    expect(getSession(deleted)).toBeUndefined()
    expect(getSession(kept)).toBeDefined()
    expect(result.pulled).toBe(0)

    // The next app start (a full sync) has nothing to put back.
    await performInitialSync()
    expect(getSession(deleted)).toBeUndefined()
    expect(cloud.rows.has(deleted)).toBe(false)
    expect(cloud.uploads().some((row) => row.id === deleted)).toBe(false)
  })

  it('the runner asks for no local-only upload on a pull on return, and a full sync otherwise', async () => {
    const asked: Array<SyncOptions | undefined> = []
    const sync = vi.fn(async (options?: SyncOptions) => {
      asked.push(options)
      return RESULT
    })
    const runner = createSyncRunner(sync)
    await runner.now()
    expect(asked[0]?.uploadLocalOnly).not.toBe(false)
    await runner.onReturn(Date.now() + SYNC_ON_RETURN_INTERVAL_MS + 1)
    expect(asked[1]).toEqual({ uploadLocalOnly: false })
  })
})

describe('installSyncOnReturn: a return inside the minute', () => {
  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('pulls once when the minute ends, if the page is still on screen', async () => {
    vi.useFakeTimers()
    const sync = vi.fn(async () => RESULT)
    const runner = createSyncRunner(sync)
    const onRun = vi.fn((run: Promise<InitialSyncResult>) => void run)
    await runner.now()
    expect(runner.nextReturnAt()).toBe(Date.now() + SYNC_ON_RETURN_INTERVAL_MS)
    const uninstall = installSyncOnReturn(runner, onRun)
    try {
      vi.advanceTimersByTime(20_000)
      setVisibility('visible')
      expect(onRun).not.toHaveBeenCalled()

      vi.advanceTimersByTime(SYNC_ON_RETURN_INTERVAL_MS - 20_000 - 1)
      expect(onRun).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(onRun).toHaveBeenCalledTimes(1)
      expect(sync).toHaveBeenCalledTimes(2)
      // Once: nothing more without another return.
      vi.advanceTimersByTime(5 * SYNC_ON_RETURN_INTERVAL_MS)
      expect(onRun).toHaveBeenCalledTimes(1)
    } finally {
      uninstall()
    }
  })

  it('does not pull when the page has gone to the background by then, or after removal', async () => {
    vi.useFakeTimers()
    const sync = vi.fn(async () => RESULT)
    const runner = createSyncRunner(sync)
    const onRun = vi.fn()
    await runner.now()
    const uninstall = installSyncOnReturn(runner, onRun)
    try {
      setVisibility('visible')
      setVisibility('hidden')
      vi.advanceTimersByTime(SYNC_ON_RETURN_INTERVAL_MS)
      expect(onRun).not.toHaveBeenCalled()

      setVisibility('visible')
      expect(onRun).toHaveBeenCalledTimes(1)
    } finally {
      uninstall()
    }
    // A pending pull dies with the listeners.
    const runner2 = createSyncRunner(sync)
    await runner2.now()
    const onRun2 = vi.fn()
    const uninstall2 = installSyncOnReturn(runner2, onRun2)
    setVisibility('visible')
    uninstall2()
    vi.advanceTimersByTime(SYNC_ON_RETURN_INTERVAL_MS)
    expect(onRun2).not.toHaveBeenCalled()
  })
})
