import type { ParkingSession } from '../types'

const KEY = 'parkproof.sessions.v1'

export function loadSessions(): ParkingSession[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as ParkingSession[]) : []
  } catch {
    return []
  }
}

export function saveSession(session: ParkingSession): void {
  const sessions = loadSessions()
  sessions.unshift(session)
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions))
  } catch (err) {
    // Surface QuotaExceededError with an actionable message instead of letting
    // it bubble as a silent click-handler crash.
    if (
      err instanceof DOMException &&
      (err.name === 'QuotaExceededError' || err.code === 22)
    ) {
      throw new Error(
        'Your device storage is full. Open History and delete a few older sessions, then try again.',
      )
    }
    throw err
  }
}

export function deleteSession(id: string): void {
  const sessions = loadSessions().filter((s) => s.id !== id)
  localStorage.setItem(KEY, JSON.stringify(sessions))
}

/**
 * Patch fields onto an existing session in place. Used for async enrichment
 * like adding a signature bundle after a session has already been persisted.
 */
export function updateSession(id: string, patch: Partial<ParkingSession>): void {
  const sessions = loadSessions()
  const idx = sessions.findIndex((s) => s.id === id)
  if (idx === -1) return
  sessions[idx] = { ...sessions[idx], ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions))
  } catch {
    /* swallow — best-effort enrichment */
  }
}

export function getSession(id: string): ParkingSession | undefined {
  return loadSessions().find((s) => s.id === id)
}
