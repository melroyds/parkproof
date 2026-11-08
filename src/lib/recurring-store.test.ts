// @vitest-environment happy-dom
//
// The weekly reminder store (T5a): `parkproof.recurring.v1` in
// localStorage, written only through the storage.ts helpers. They keep the
// list valid, own the calendar SEQUENCE (bumped on every edit the calendar
// file carries, never taken from the caller) and tell listeners.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecurringRule } from '../types'
import {
  InvalidRecurringRuleError,
  RECURRING_CHANGED_EVENT,
  StorageFullError,
  deleteRecurringRule,
  getRecurringRule,
  loadRecurringRules,
  saveRecurringRule,
  setRecurringRulePaused,
} from './storage'

const KEY = 'parkproof.recurring.v1'
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: A,
    label: 'Street sweeping',
    kind: 'street_cleaning',
    days: ['TU'],
    start: '07:00',
    end: '09:00',
    frequency: 'weekly',
    nth: [],
    anchor_date: '2026-11-02',
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

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('recurring rule store', () => {
  it('stores the exact shape under parkproof.recurring.v1', () => {
    saveRecurringRule(rule())
    const raw = JSON.parse(localStorage.getItem(KEY)!)
    expect(raw).toEqual([rule()])
    expect(Object.keys(raw[0]).sort()).toEqual(
      [
        'id',
        'label',
        'kind',
        'days',
        'start',
        'end',
        'frequency',
        'nth',
        'anchor_date',
        'timezone',
        'address',
        'remind_evening_before',
        'remind_minutes_before',
        'push',
        'paused',
        'sequence',
      ].sort(),
    )
  })

  it('starts a new rule at sequence 0 whatever the caller says', () => {
    expect(saveRecurringRule(rule({ sequence: 7 })).sequence).toBe(0)
  })

  it('bumps the sequence on an edit the calendar carries, from the stored copy', () => {
    saveRecurringRule(rule())
    expect(saveRecurringRule(rule({ days: ['WE'] })).sequence).toBe(1)
    // A stale caller copy (sequence 0) still gets 2, not 1.
    expect(saveRecurringRule(rule({ days: ['WE'], start: '06:30', sequence: 0 })).sequence).toBe(2)
    expect(getRecurringRule(A)).toMatchObject({ days: ['WE'], start: '06:30', sequence: 2 })
  })

  it('leaves the sequence alone when nothing the calendar carries changed', () => {
    saveRecurringRule(rule())
    expect(saveRecurringRule(rule()).sequence).toBe(0)
    expect(setRecurringRulePaused(A, true)).toMatchObject({ paused: true, sequence: 0 })
    expect(saveRecurringRule({ ...getRecurringRule(A)!, push: false }).sequence).toBe(0)
    expect(setRecurringRulePaused(A, false)).toMatchObject({ paused: false, sequence: 0 })
  })

  it('keeps several rules in the order they were added and replaces by id', () => {
    saveRecurringRule(rule())
    saveRecurringRule(rule({ id: B, days: ['FR'] }))
    saveRecurringRule(rule({ label: 'Renamed' }))
    expect(loadRecurringRules().map((r) => [r.id, r.label])).toEqual([
      [A, 'Renamed'],
      [B, 'Street sweeping'],
    ])
  })

  it('deletes one rule and reports a missing one', () => {
    saveRecurringRule(rule())
    saveRecurringRule(rule({ id: B }))
    expect(deleteRecurringRule(A)).toBe(true)
    expect(deleteRecurringRule(A)).toBe(false)
    expect(loadRecurringRules().map((r) => r.id)).toEqual([B])
    expect(setRecurringRulePaused(A, true)).toBeNull()
  })

  it('refuses a rule that does not fit the shape and writes nothing', () => {
    expect(() => saveRecurringRule(rule({ days: [] }))).toThrow(InvalidRecurringRuleError)
    expect(() => saveRecurringRule(rule({ id: 'not-a-uuid' }))).toThrow(InvalidRecurringRuleError)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('skips stored entries that are not valid instead of losing the list', () => {
    localStorage.setItem(KEY, JSON.stringify([rule(), { id: B, days: 'TU' }, 'junk', rule()]))
    expect(loadRecurringRules().map((r) => r.id)).toEqual([A])
    localStorage.setItem(KEY, '{not json')
    expect(loadRecurringRules()).toEqual([])
  })

  it('keeps what a newer version stored when this one writes (entries and fields it does not know)', () => {
    // Saved by a newer build: a kind this one can't read, and an extra field.
    const future = { ...rule({ id: B }), kind: 'event_clearway', source_record_id: 'rec-9' }
    localStorage.setItem(KEY, JSON.stringify([{ ...rule(), source_record_id: 'rec-1' }, future]))
    expect(loadRecurringRules().map((r) => r.id)).toEqual([A])

    setRecurringRulePaused(A, true)
    saveRecurringRule(rule({ paused: true, start: '06:00' }))
    let raw = JSON.parse(localStorage.getItem(KEY)!)
    expect(raw).toHaveLength(2)
    expect(raw[0]).toMatchObject({ id: A, paused: true, start: '06:00', sequence: 1, source_record_id: 'rec-1' })
    expect(raw[1]).toEqual(future)

    saveRecurringRule(rule({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }))
    deleteRecurringRule(A)
    raw = JSON.parse(localStorage.getItem(KEY)!)
    expect(raw.map((r: { id: string }) => r.id)).toEqual([B, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'])
    expect(raw[0]).toEqual(future)
  })

  it('tells listeners after every write, with the rule id', () => {
    const seen: unknown[] = []
    const listener = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener(RECURRING_CHANGED_EVENT, listener)
    try {
      saveRecurringRule(rule())
      setRecurringRulePaused(A, true)
      deleteRecurringRule(A)
    } finally {
      window.removeEventListener(RECURRING_CHANGED_EVENT, listener)
    }
    expect(seen).toEqual([{ id: A }, { id: A }, { id: A }])
  })

  it('turns a full storage into StorageFullError', () => {
    const real = globalThis.localStorage
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: full })
    try {
      expect(() => saveRecurringRule(rule())).toThrow(StorageFullError)
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: real })
    }
  })
})
