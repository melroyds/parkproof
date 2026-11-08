// @vitest-environment happy-dom
//
// The workday store (build spec T6a item 1): `parkproof.workday.v1`, at most
// one active workday, and the moves between 'parked', 'between_moves' and
// 'ended'.
//
// Why this file is in the suite: the home screen, the logger and the
// reminders all read the active workday. Two active workdays, a workday
// that silently restarts after it ended, or a leg recorded against the wrong
// previous leg would put the wrong deadline on a driver's screen. And a
// workday must never start where its rules haven't been checked.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkdayState } from '../types'
import {
  ERR_WORKDAY_ACTIVE,
  ERR_WORKDAY_JURISDICTION,
  MAX_ENDED_WORKDAYS,
  RECORDS_CHANGED_EVENT,
  StorageFullError,
  WORKDAY_KEY,
  WorkdayError,
  endWorkday,
  getActiveWorkday,
  getWorkday,
  loadWorkdays,
  markWorkdayMoving,
  setWorkdayLeg,
  startWorkday,
  subscribeRecordsChanged,
} from './storage'

// happy-dom's localStorage is a Proxy that can't simulate a full disk, so
// this file swaps in its own (the same approach as storage.test.ts).
let quotaThrows = 0
const backing = new Map<string, string>()
const fakeLocalStorage: Storage = {
  get length() {
    return backing.size
  },
  clear: () => backing.clear(),
  getItem: (k: string) => (backing.has(k) ? backing.get(k)! : null),
  key: (i: number) => [...backing.keys()][i] ?? null,
  removeItem: (k: string) => void backing.delete(k),
  setItem: (k: string, v: string) => {
    if (quotaThrows > 0) {
      quotaThrows--
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    }
    backing.set(k, String(v))
  },
}
Object.defineProperty(globalThis, 'localStorage', { value: fakeLocalStorage, writable: false, configurable: true })

const T0 = new Date('2026-11-09T08:45:00+11:00')
const ID_A = 'aaaaaaaa-1111-4111-8111-111111111111'
const ID_B = 'bbbbbbbb-2222-4222-8222-222222222222'

const stored = (): unknown => JSON.parse(backing.get(WORKDAY_KEY) ?? 'null')

function workday(over: Partial<WorkdayState> = {}): WorkdayState {
  return {
    id: ID_A,
    started_at: T0.toISOString(),
    jurisdiction: 'VIC',
    status: 'parked',
    current_session_id: 'leg-0',
    previous_session_id: null,
    ended_at: null,
    ...over,
  }
}

function errorCode(fn: () => unknown): string | null {
  try {
    fn()
  } catch (err) {
    return err instanceof WorkdayError ? err.code : `other: ${String(err)}`
  }
  return null
}

beforeEach(() => {
  quotaThrows = 0
  backing.clear()
})

describe('reading the store', () => {
  it('is empty when nothing is stored, the JSON is corrupt, or it is not a list', () => {
    expect(loadWorkdays()).toEqual([])
    backing.set(WORKDAY_KEY, '{{nope')
    expect(loadWorkdays()).toEqual([])
    backing.set(WORKDAY_KEY, JSON.stringify(workday()))
    expect(loadWorkdays()).toEqual([])
    expect(getActiveWorkday()).toBeNull()
  })

  it('drops entries it cannot trust, keeping the rest', () => {
    const good = workday({ id: ID_B })
    backing.set(
      WORKDAY_KEY,
      JSON.stringify([
        workday({ id: 'not-a-uuid' }),
        workday({ id: 'AAAAAAAA-1111-4111-8111-111111111111' }),
        workday({ jurisdiction: 'NSW' }),
        workday({ jurisdiction: 'WA' }),
        workday({ jurisdiction: null as never }),
        workday({ status: 'paused' as never }),
        workday({ started_at: 'yesterday' }),
        workday({ status: 'ended', ended_at: null }),
        workday({ status: 'parked', ended_at: T0.toISOString() }),
        workday({ current_session_id: 42 as never }),
        null,
        'x',
        good,
      ]),
    )
    expect(loadWorkdays()).toEqual([good])
  })

  it('lists newest first, and the active workday is the newest one not ended', () => {
    const older = workday({ id: ID_A, started_at: '2026-11-08T08:00:00.000Z', status: 'ended', ended_at: '2026-11-08T17:00:00.000Z' })
    const newer = workday({ id: ID_B, started_at: '2026-11-09T08:00:00.000Z' })
    backing.set(WORKDAY_KEY, JSON.stringify([older, newer]))
    expect(loadWorkdays().map((w) => w.id)).toEqual([ID_B, ID_A])
    expect(getActiveWorkday()?.id).toBe(ID_B)
    expect(getWorkday(ID_A)?.status).toBe('ended')
    expect(getWorkday('cccccccc-3333-4333-8333-333333333333')).toBeNull()
  })

  it('should two active workdays ever be stored, the newest is the active one and no third can start', () => {
    const a = workday({ id: ID_A, started_at: '2026-11-09T08:00:00.000Z' })
    const b = workday({ id: ID_B, started_at: '2026-11-09T08:00:01.000Z' })
    backing.set(WORKDAY_KEY, JSON.stringify([a, b]))
    expect(getActiveWorkday()?.id).toBe(ID_B)
    expect(errorCode(() => startWorkday({ jurisdiction: 'VIC' }))).toBe(ERR_WORKDAY_ACTIVE)
  })
})

describe('startWorkday', () => {
  it('starts between moves when the car is not parked yet', () => {
    const w = startWorkday({ jurisdiction: 'VIC', now: T0 })
    expect(w).toEqual({
      id: w.id,
      started_at: '2026-11-08T21:45:00.000Z',
      jurisdiction: 'VIC',
      status: 'between_moves',
      current_session_id: null,
      previous_session_id: null,
      ended_at: null,
    })
    expect(w.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(stored()).toEqual([w])
    expect(getActiveWorkday()).toEqual(w)
  })

  it('starts parked on the car\'s current park when one is given (leg 0)', () => {
    const w = startWorkday({ jurisdiction: 'QLD', current_session_id: 'existing-record', now: T0, id: ID_A })
    expect(w).toMatchObject({ id: ID_A, jurisdiction: 'QLD', status: 'parked', current_session_id: 'existing-record', previous_session_id: null })
  })

  it('refuses while a workday is active, and writes nothing', () => {
    startWorkday({ jurisdiction: 'VIC', now: T0, id: ID_A })
    const before = backing.get(WORKDAY_KEY)
    expect(errorCode(() => startWorkday({ jurisdiction: 'VIC', id: ID_B }))).toBe(ERR_WORKDAY_ACTIVE)
    expect(backing.get(WORKDAY_KEY)).toBe(before)
  })

  it('refuses outside Victoria and Queensland, or when the jurisdiction is unknown, and writes nothing', () => {
    for (const j of ['NSW', 'ACT', 'SA', 'WA', 'TAS', 'NT', null, undefined, 'vic', 'AU-VIC'] as never[]) {
      expect(errorCode(() => startWorkday({ jurisdiction: j })), String(j)).toBe(ERR_WORKDAY_JURISDICTION)
    }
    expect(backing.has(WORKDAY_KEY)).toBe(false)
  })

  it('refuses an id the signed workday link would reject', () => {
    expect(() => startWorkday({ jurisdiction: 'VIC', id: 'Workday-1' })).toThrow()
    expect(backing.has(WORKDAY_KEY)).toBe(false)
  })

  it('can start a new one once the last has ended, keeping the ended one', () => {
    startWorkday({ jurisdiction: 'VIC', now: T0, id: ID_A })
    endWorkday(ID_A, new Date('2026-11-09T17:30:00+11:00'))
    const next = startWorkday({ jurisdiction: 'VIC', now: new Date('2026-11-10T08:30:00+11:00'), id: ID_B })
    expect(getActiveWorkday()?.id).toBe(next.id)
    expect(loadWorkdays().map((w) => [w.id, w.status])).toEqual([
      [ID_B, 'between_moves'],
      [ID_A, 'ended'],
    ])
  })

  it('throws StorageFullError when the disk is full, and stores nothing', () => {
    quotaThrows = 1
    expect(() => startWorkday({ jurisdiction: 'VIC' })).toThrow(StorageFullError)
    expect(backing.has(WORKDAY_KEY)).toBe(false)
  })
})

describe('a day of moves', () => {
  it('records each leg against the leg before it', () => {
    startWorkday({ jurisdiction: 'VIC', now: T0, id: ID_A })

    expect(setWorkdayLeg(ID_A, 'leg-0')).toMatchObject({ status: 'parked', current_session_id: 'leg-0', previous_session_id: null })
    expect(markWorkdayMoving(ID_A)).toMatchObject({ status: 'between_moves', current_session_id: 'leg-0', previous_session_id: null })
    expect(setWorkdayLeg(ID_A, 'leg-1')).toMatchObject({ status: 'parked', current_session_id: 'leg-1', previous_session_id: 'leg-0' })
    expect(markWorkdayMoving(ID_A)).toMatchObject({ status: 'between_moves', current_session_id: 'leg-1' })
    expect(setWorkdayLeg(ID_A, 'leg-2')).toMatchObject({ current_session_id: 'leg-2', previous_session_id: 'leg-1' })
    // Every change is stored, not only returned.
    expect(getWorkday(ID_A)).toMatchObject({ status: 'parked', current_session_id: 'leg-2', previous_session_id: 'leg-1' })
  })

  it('saving the same leg again changes nothing and writes nothing', () => {
    startWorkday({ jurisdiction: 'VIC', current_session_id: 'leg-0', now: T0, id: ID_A })
    setWorkdayLeg(ID_A, 'leg-1')
    const before = backing.get(WORKDAY_KEY)
    const listener = vi.fn()
    const off = subscribeRecordsChanged(listener)
    expect(setWorkdayLeg(ID_A, 'leg-1')).toMatchObject({ current_session_id: 'leg-1', previous_session_id: 'leg-0' })
    off()
    expect(backing.get(WORKDAY_KEY)).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('saving the leg the car just left again keeps the workday between moves', () => {
    startWorkday({ jurisdiction: 'VIC', current_session_id: 'leg-0', now: T0, id: ID_A })
    setWorkdayLeg(ID_A, 'leg-1')
    markWorkdayMoving(ID_A)
    const before = backing.get(WORKDAY_KEY)
    const listener = vi.fn()
    const off = subscribeRecordsChanged(listener)
    // A re-run of leg 1's save path after "I'm moving the car now".
    expect(setWorkdayLeg(ID_A, 'leg-1')).toMatchObject({
      status: 'between_moves',
      current_session_id: 'leg-1',
      previous_session_id: 'leg-0',
    })
    off()
    expect(backing.get(WORKDAY_KEY)).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    expect(getActiveWorkday()?.status).toBe('between_moves')
  })

  it('moving is refused with no current leg, and is idempotent', () => {
    startWorkday({ jurisdiction: 'VIC', now: T0, id: ID_A })
    expect(markWorkdayMoving(ID_A)).toBeNull()
    setWorkdayLeg(ID_A, 'leg-0')
    markWorkdayMoving(ID_A)
    expect(markWorkdayMoving(ID_A)).toMatchObject({ status: 'between_moves', current_session_id: 'leg-0' })
  })

  it('ending stamps the phone time; ending again keeps the first time', () => {
    startWorkday({ jurisdiction: 'VIC', current_session_id: 'leg-0', now: T0, id: ID_A })
    const end = new Date('2026-11-09T17:05:00+11:00')
    expect(endWorkday(ID_A, end)).toMatchObject({ status: 'ended', ended_at: end.toISOString() })
    expect(endWorkday(ID_A, new Date('2026-11-09T18:00:00+11:00'))?.ended_at).toBe(end.toISOString())
    expect(getActiveWorkday()).toBeNull()
  })

  it('an ended workday gains no legs and no moves', () => {
    startWorkday({ jurisdiction: 'VIC', current_session_id: 'leg-0', now: T0, id: ID_A })
    endWorkday(ID_A, T0)
    const before = backing.get(WORKDAY_KEY)
    expect(setWorkdayLeg(ID_A, 'leg-1')).toBeNull()
    expect(markWorkdayMoving(ID_A)).toBeNull()
    expect(backing.get(WORKDAY_KEY)).toBe(before)
  })

  it('an unknown workday is null for every change', () => {
    expect(setWorkdayLeg(ID_B, 'leg-0')).toBeNull()
    expect(markWorkdayMoving(ID_B)).toBeNull()
    expect(endWorkday(ID_B)).toBeNull()
    expect(backing.has(WORKDAY_KEY)).toBe(false)
  })
})

describe('keeping the store small', () => {
  it(`keeps every active workday and the ${MAX_ENDED_WORKDAYS} newest ended ones`, () => {
    const ended = Array.from({ length: MAX_ENDED_WORKDAYS + 5 }, (_, i) =>
      workday({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        started_at: new Date(Date.UTC(2026, 9, 1 + i, 22)).toISOString(),
        status: 'ended',
        ended_at: new Date(Date.UTC(2026, 9, 2 + i, 7)).toISOString(),
      }),
    )
    backing.set(WORKDAY_KEY, JSON.stringify(ended))
    const active = startWorkday({ jurisdiction: 'QLD', now: new Date('2026-12-01T08:00:00+10:00'), id: ID_A })
    const kept = loadWorkdays()
    expect(kept).toHaveLength(MAX_ENDED_WORKDAYS + 1)
    expect(kept[0]).toEqual(active)
    // The oldest five ended workdays went.
    const keptIds = new Set(kept.map((w) => w.id))
    for (const w of ended.slice(0, 5)) expect(keptIds.has(w.id)).toBe(false)
    for (const w of ended.slice(5)) expect(keptIds.has(w.id)).toBe(true)
  })
})

describe('change notifications', () => {
  it('every workday write tells records-changed listeners', () => {
    const seen: unknown[] = []
    const listener = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener(RECORDS_CHANGED_EVENT, listener)
    try {
      startWorkday({ jurisdiction: 'VIC', now: T0, id: ID_A })
      setWorkdayLeg(ID_A, 'leg-0')
      markWorkdayMoving(ID_A)
      endWorkday(ID_A, T0)
    } finally {
      window.removeEventListener(RECORDS_CHANGED_EVENT, listener)
    }
    expect(seen).toEqual([{ id: null }, { id: null }, { id: null }, { id: null }])
  })

  it('a workday changed in another tab reaches subscribers', () => {
    const listener = vi.fn()
    const off = subscribeRecordsChanged(listener)
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: WORKDAY_KEY }))
      expect(listener).toHaveBeenCalledTimes(1)
      window.dispatchEvent(new StorageEvent('storage', { key: 'parkproof.something-else' }))
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      off()
    }
  })
})
