import type { ParkingSession } from '../types'
import { getIdToken } from './auth'
import { loadSessions, updateSession } from './storage'

/**
 * Local↔cloud sync layer.
 *
 * Model: localStorage stays as the source of truth for the current device.
 * The cloud is a mirror that allows multi-device coverage. Conflict resolution
 * is last-write-wins on `arrived_at` — fine in practice because (a) a session
 * is only ever mutated by the original device anyway (notes, signatures), and
 * (b) sessions are append-only once the parking session finishes.
 *
 * All cloud calls go through fetch directly — the Cognito SDK gives us the
 * JWT and we attach it as the Authorization header. API Gateway's JWT
 * authorizer validates server-side. No persistence concerns on this layer
 * beyond the in-flight fetch.
 */

function apiBase(): string {
  // Prefer the prod URL baked in at build time. Fall back to /api for local dev.
  const url = import.meta.env.VITE_API_URL as string | undefined
  if (!url) return '/api'
  // VITE_API_URL points at the /sign-translate endpoint; strip the trailing path
  // segment so we can append /sessions/upload etc.
  return url.replace(/\/[^/]*$/, '')
}

async function authFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getIdToken()
  if (!token) throw new Error('Not signed in')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(apiBase() + path, { ...init, headers })
}

async function expectJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text()
    let detail = text
    try {
      const json = JSON.parse(text)
      detail = json.error ?? text
    } catch {
      /* not JSON, use raw text */
    }
    throw new Error(`API ${res.status}: ${detail}`)
  }
  return (await res.json()) as T
}

// ─── Operations ──────────────────────────────────────────────────────────

/** Upload one session to the cloud (DDB write — does NOT carry the photo blobs). */
export async function uploadSession(session: ParkingSession): Promise<void> {
  const res = await authFetch('/sessions/upload', {
    method: 'POST',
    body: JSON.stringify({ session }),
  })
  await expectJson<{ ok: true }>(res)
}

/** List all sessions stored in the cloud for the signed-in user. */
export async function listCloudSessions(): Promise<ParkingSession[]> {
  const res = await authFetch('/sessions/list', { method: 'GET' })
  const data = await expectJson<{ sessions: ParkingSession[] }>(res)
  return data.sessions
}

/** Delete one session from the cloud (DDB row + S3 photos, best-effort). */
export async function deleteCloudSession(sessionId: string): Promise<void> {
  const res = await authFetch('/sessions/delete', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId }),
  })
  await expectJson<{ ok: true }>(res)
}

/** Export everything the cloud holds about the signed-in user. */
export async function exportCloudData(): Promise<unknown> {
  const res = await authFetch('/me/export', { method: 'GET' })
  return expectJson<unknown>(res)
}

/** Permanently delete the user's account + every byte of their data. */
export async function deleteAccount(): Promise<void> {
  const res = await authFetch('/me/delete', { method: 'POST' })
  await expectJson<{ ok: true }>(res)
}

// ─── First-time sync ─────────────────────────────────────────────────────

export interface InitialSyncResult {
  uploaded: number // local sessions newly uploaded to the cloud
  pulled: number // cloud sessions newly added to the local store
  alreadyInSync: number // sessions present on both sides with the same id
}

/**
 * Called once after sign-in. Merges local + cloud:
 *   - local-only sessions → uploaded to the cloud
 *   - cloud-only sessions → written into local storage
 *   - sessions present on both sides → kept as-is (the local copy wins because
 *     it's likely to have unsaved signatures + notes)
 */
export async function performInitialSync(): Promise<InitialSyncResult> {
  const [localSessions, cloudSessions] = await Promise.all([
    Promise.resolve(loadSessions()),
    listCloudSessions().catch((err) => {
      console.warn('[sync] list failed, treating cloud as empty:', err)
      return [] as ParkingSession[]
    }),
  ])
  const localById = new Map(localSessions.map((s) => [s.id, s]))
  const cloudById = new Map(cloudSessions.map((s) => [s.id, s]))

  const result: InitialSyncResult = { uploaded: 0, pulled: 0, alreadyInSync: 0 }

  // Local-only → upload to cloud.
  for (const session of localSessions) {
    if (cloudById.has(session.id)) {
      result.alreadyInSync++
      continue
    }
    try {
      await uploadSession(session)
      result.uploaded++
    } catch (err) {
      console.warn(`[sync] upload of ${session.id} failed:`, err)
    }
  }

  // Cloud-only → merge into local storage. Photos won't be present on the
  // cloud row (we strip them server-side) — that's intentional. The user
  // sees the metadata + visits a "download photos" affordance later if they
  // want the bytes back on this device.
  for (const session of cloudSessions) {
    if (localById.has(session.id)) continue
    try {
      // Use updateSession to insert: if the id doesn't exist, it no-ops, so
      // we fall through to a raw localStorage write.
      writeNewLocalSession(session)
      result.pulled++
    } catch (err) {
      console.warn(`[sync] pull of ${session.id} failed:`, err)
    }
  }

  console.log(
    `[sync] initial sync: uploaded=${result.uploaded} pulled=${result.pulled} already=${result.alreadyInSync}`,
  )
  return result
}

/**
 * Insert a session into localStorage at index 0 (newest-first ordering),
 * preserving the rest. Used by the cloud-pull path during initial sync.
 */
function writeNewLocalSession(session: ParkingSession): void {
  const KEY = 'parkproof.sessions.v1'
  try {
    const raw = localStorage.getItem(KEY)
    const all: ParkingSession[] = raw ? JSON.parse(raw) : []
    all.unshift(session)
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch (err) {
    console.warn('[sync] writeNewLocalSession failed:', err)
  }
}

// ─── Background mirror ───────────────────────────────────────────────────

/**
 * Fire-and-forget mirror of a newly-saved local session to the cloud. Called
 * from App after saveSession, only when signed in. Never throws to the
 * caller — sync is best-effort, the local copy is the source of truth.
 */
export function mirrorSessionToCloud(session: ParkingSession): void {
  void uploadSession(session).catch((err) => {
    console.warn('[sync] mirror failed (will retry on next app load):', err)
  })
}

/**
 * Fire-and-forget mirror of a session UPDATE (e.g. note edit, signature
 * enrichment) to the cloud. Same semantics as mirrorSessionToCloud — the
 * cloud row gets overwritten with the latest local copy.
 */
export function mirrorSessionUpdateToCloud(sessionId: string): void {
  // Re-read from storage so we get the freshest copy with any patch applied.
  const sessions = loadSessions()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) return
  void uploadSession(session).catch((err) => {
    console.warn('[sync] mirror update failed:', err)
  })
}

// Re-export updateSession so callers can do `updateSession + mirror` in one
// import statement without juggling two paths.
export { updateSession }
