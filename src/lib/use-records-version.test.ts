// @vitest-environment happy-dom
//
// useRecordsVersion / useLiveRecord: screens that show a record re-render
// when storage changes underneath them (a signature landing in the
// background, the end-session path, a cloud pull), without navigating away.
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteSession, notifyRecordsChanged, saveSession, updateSession } from './storage'
import { useLiveRecord, useLiveRecords, useRecordsVersion } from './use-records-version'
import type { ParkingSession, SignatureBundle } from '../types'

function makeSession(id: string, overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id,
    arrived_at: '2026-05-21T08:00:00+10:00',
    location: { lat: -37.8136, lng: 144.9631 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: '2026-05-21T10:00:00+10:00',
    confidence: 'high',
    ...overrides,
  }
}

const SIGNATURE: SignatureBundle = {
  schema: 'parkproof-evidence-v1',
  signed_at: '2026-05-21T08:00:03.000Z',
  algorithm: 'ECDSA_SHA_256',
  key_alias: 'alias/parkproof-evidence-signing',
  canonical_payload: '{}',
  signature_base64: 'MEUCIQ==',
}

beforeEach(() => {
  localStorage.clear()
})

describe('useRecordsVersion', () => {
  it('changes when a record is saved, updated or deleted', () => {
    const { result } = renderHook(() => useRecordsVersion())
    const v0 = result.current
    act(() => {
      saveSession(makeSession('a'))
    })
    const v1 = result.current
    expect(v1).not.toBe(v0)
    act(() => {
      updateSession('a', { note: 'x' })
    })
    expect(result.current).not.toBe(v1)
    const v2 = result.current
    act(() => {
      deleteSession('a')
    })
    expect(result.current).not.toBe(v2)
  })

  it('changes on an explicit notifyRecordsChanged (e.g. after a cloud pull)', () => {
    const { result } = renderHook(() => useRecordsVersion())
    const before = result.current
    act(() => notifyRecordsChanged())
    expect(result.current).not.toBe(before)
  })
})

describe('useLiveRecord', () => {
  it('shows a signature that lands after the screen opened', () => {
    const initial = makeSession('a')
    saveSession(initial)
    const { result } = renderHook(() => useLiveRecord(initial))
    expect(result.current.signature).toBeUndefined()

    act(() => {
      updateSession('a', { signature: SIGNATURE })
    })
    expect(result.current.signature).toEqual(SIGNATURE)
  })

  it('shows ended_at as soon as the end path stores it', () => {
    const initial = makeSession('a')
    saveSession(initial)
    const { result } = renderHook(() => useLiveRecord(initial))
    act(() => {
      updateSession('a', { ended_at: '2026-05-21T09:00:00.000Z' })
    })
    expect(result.current.ended_at).toBe('2026-05-21T09:00:00.000Z')
  })

  it('falls back to the starting copy when the record is not in storage', () => {
    const initial = makeSession('ghost', { note: 'kept' })
    const { result } = renderHook(() => useLiveRecord(initial))
    expect(result.current).toBe(initial)
    act(() => notifyRecordsChanged())
    expect(result.current).toBe(initial)
  })

  it('keeps the same object between unrelated renders (memoised)', () => {
    const initial = makeSession('a')
    saveSession(initial)
    const { result, rerender } = renderHook(() => useLiveRecord(initial))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})

describe('useLiveRecords', () => {
  it('re-reads the list when records change', () => {
    const { result } = renderHook(() => useLiveRecords())
    expect(result.current).toEqual([])
    act(() => {
      saveSession(makeSession('a'))
      saveSession(makeSession('b'))
    })
    expect(result.current.map((s) => s.id)).toEqual(['b', 'a'])
  })
})
