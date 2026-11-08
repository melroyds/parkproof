import { useMemo, useSyncExternalStore } from 'react'
import type { ParkingSession } from '../types'
import { getRecordsRevision, getSession, loadSessions, subscribeRecordsChanged } from './storage'

/**
 * A number that changes whenever the saved records change (the
 * `parkproof:records-changed` event, or a write from another tab). Use it as
 * a memo key so a screen re-reads storage after background work such as a
 * signature landing or a cloud pull.
 */
export function useRecordsVersion(): number {
  return useSyncExternalStore(subscribeRecordsChanged, getRecordsRevision, getRecordsRevision)
}

/**
 * The latest stored copy of a record, re-read on every records change. Falls
 * back to `initial` when the record isn't in storage (just deleted, or not
 * saved yet), so a screen never loses its record mid-render.
 */
export function useLiveRecord(initial: ParkingSession): ParkingSession {
  const version = useRecordsVersion()
  return useMemo(() => readRecordAt(version, initial), [version, initial])
}

/** Every saved record, newest first, re-read on every records change. */
export function useLiveRecords(): ParkingSession[] {
  const version = useRecordsVersion()
  return useMemo(() => readRecordsAt(version), [version])
}

// The `version` argument keys the memos above (a new version means storage
// changed, so read again). The reads themselves always go to storage.
function readRecordAt(version: number, initial: ParkingSession): ParkingSession {
  void version
  return getSession(initial.id) ?? initial
}

function readRecordsAt(version: number): ParkingSession[] {
  void version
  return loadSessions()
}
