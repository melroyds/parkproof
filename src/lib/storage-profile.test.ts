// @vitest-environment happy-dom
//
// loadProfile and saveProfile (build spec T4 item 2): the Settings profile
// lives under parkproof.profile.v1, separate from the records, is checked
// on every read and write, and a full storage never clears records to
// make room for it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isStorageFullError, loadProfile, loadSessions, saveProfile } from './storage'
import { PROFILE_KEY } from './profile'
import type { DriverProfile } from '../types'

const SESSIONS_KEY = 'parkproof.sessions.v1'

const PROFILE: DriverProfile = {
  driver_name: 'Sam Lee',
  permits: [
    { id: 'p1', type: 'resident', state: 'VIC', area: 'Area 25', expires_on: '2027-06-30' },
    { id: 'p2', type: 'accessible', state: 'NSW', area: null, expires_on: null },
  ],
}

/** A Storage stand-in whose setItem can be made to throw (happy-dom's own can't be spied on reliably). */
function installStorage() {
  const map = new Map<string, string>()
  const state = { failWith: null as unknown }
  const storage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (state.failWith) throw state.failWith
      map.set(k, String(v))
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
  return { map, state }
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let store: ReturnType<typeof installStorage>

beforeEach(() => {
  store = installStorage()
})
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original)
})

describe('loadProfile', () => {
  it('is the empty profile when nothing is saved', () => {
    expect(loadProfile()).toEqual({ driver_name: null, permits: [] })
  })

  it('reads back what saveProfile stored, under parkproof.profile.v1', () => {
    saveProfile(PROFILE)
    expect(PROFILE_KEY).toBe('parkproof.profile.v1')
    expect(JSON.parse(store.map.get(PROFILE_KEY)!)).toEqual(PROFILE)
    expect(loadProfile()).toEqual(PROFILE)
  })

  it('reads a damaged value as the empty profile', () => {
    store.map.set(PROFILE_KEY, '{not json')
    expect(loadProfile()).toEqual({ driver_name: null, permits: [] })
  })

  it('re-checks a stored value written by something else', () => {
    store.map.set(
      PROFILE_KEY,
      JSON.stringify({
        driver_name: 'Sam\nLee',
        permits: [{ id: 'x', type: 'accessible', state: 'VIC', area: 'Area 9', expires_on: 'soon' }, { id: 'y' }],
      }),
    )
    expect(loadProfile()).toEqual({
      driver_name: 'Sam Lee',
      permits: [{ id: 'x', type: 'accessible', state: 'VIC', area: null, expires_on: null }],
    })
  })

  it('reads as empty when storage itself throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    expect(loadProfile()).toEqual({ driver_name: null, permits: [] })
  })
})

describe('saveProfile', () => {
  it('stores the shaped profile and returns it', () => {
    const stored = saveProfile({
      driver_name: '  Sam  ',
      permits: [
        ...PROFILE.permits,
        { id: 'p3', type: 'business', state: null, area: 'Zone 3', expires_on: null },
        { id: 'p4', type: 'business', state: null, area: 'Zone 4', expires_on: null },
      ],
    })
    expect(stored.driver_name).toBe('Sam')
    expect(stored.permits.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(loadProfile()).toEqual(stored)
  })

  it('never touches the saved records', () => {
    store.map.set(SESSIONS_KEY, JSON.stringify([{ id: 'r1' }]))
    saveProfile(PROFILE)
    saveProfile({ driver_name: null, permits: [] })
    expect(loadSessions()).toEqual([{ id: 'r1' }])
  })

  it('throws the storage-full error on a quota error, leaving the old profile', () => {
    saveProfile(PROFILE)
    store.state.failWith = new DOMException('full', 'QuotaExceededError')
    let caught: unknown
    try {
      saveProfile({ driver_name: 'Someone else', permits: [] })
    } catch (err) {
      caught = err
    }
    expect(isStorageFullError(caught)).toBe(true)
    expect(loadProfile()).toEqual(PROFILE)
  })

  it('passes other storage errors on', () => {
    store.state.failWith = new DOMException('blocked', 'SecurityError')
    expect(() => saveProfile(PROFILE)).toThrow('blocked')
  })
})
