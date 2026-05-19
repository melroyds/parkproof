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

interface PresignResponse {
  url: string
  key: string
  bucket: string
}

/**
 * Mint a presigned PUT URL for one photo, then upload the bytes directly to
 * S3 from the browser. Lambda never sees the photo — keeps the request small
 * and sidesteps API Gateway's 6MB payload limit.
 */
async function uploadPhoto(
  sessionId: string,
  role: 'sign' | 'car' | 'ambient',
  dataUrl: string,
): Promise<void> {
  // Decode the data URL → Blob. Splits 'data:image/jpeg;base64,XYZ' into the
  // media type and the base64 payload, then atob → Uint8Array → Blob.
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new Error(`photo for role "${role}" is not a base64 data URL`)
  }
  const [, contentType, b64] = match
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const blob = new Blob([bytes], { type: contentType })

  // Get the presigned URL.
  const presignRes = await authFetch('/photos/presign', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      role,
      content_type: contentType,
    }),
  })
  const { url } = await expectJson<PresignResponse>(presignRes)

  // PUT the blob directly to S3 — no auth header needed because the
  // presigned URL itself carries the signed authorization.
  const putRes = await fetch(url, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': contentType },
  })
  if (!putRes.ok) {
    throw new Error(`S3 PUT failed (${putRes.status}): ${await putRes.text()}`)
  }
}

/**
 * Upload one session to the cloud. Photos go to S3 first (direct browser PUT
 * via presigned URLs), then the metadata-only record goes to DynamoDB via
 * /sessions/upload. The Lambda strips any leftover data URLs server-side as
 * a defence in depth — even if a photo upload failed, the DDB write succeeds
 * with the photo field nulled, and the next /sessions/list will simply omit
 * the missing image without breaking the rest of the session.
 *
 * Photo upload errors are warned-and-swallowed: the metadata is the
 * minimum-viable record (timestamp, GPS, sign rules, signature). Losing a
 * photo is worse than losing the whole session.
 */
export async function uploadSession(session: ParkingSession): Promise<void> {
  // Pre-flight: upload photos in parallel. All three roles fail independently
  // without aborting the metadata upload — see comment block above.
  // 'ambient' role added for the no-sign flow (surroundings photo showing
  // absence of signs).
  await Promise.all(
    (['sign', 'car', 'ambient'] as const).map(async (role) => {
      const field = `${role}_photo` as 'sign_photo' | 'car_photo' | 'ambient_photo'
      const photo = session[field]
      if (!photo || !photo.startsWith('data:')) return
      try {
        await uploadPhoto(session.id, role, photo)
      } catch (err) {
        console.warn(
          `[sync] photo upload (${role}) for ${session.id} failed:`,
          err,
        )
      }
    }),
  )

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
    if (cloudById.has(session.id)) continue
    try {
      await uploadSession(session)
      result.uploaded++
    } catch (err) {
      console.warn(`[sync] upload of ${session.id} failed:`, err)
    }
  }

  // Sessions present on both sides — refresh the photo URLs from the cloud
  // copy ONLY if the local copy doesn't already have a base64 data URL.
  // Logic:
  //   - data URL locally → keep it (self-contained, works offline)
  //   - HTTPS URL locally (older presigned URL, possibly expired) → replace
  //     with the freshly-minted URL from the cloud (1h TTL)
  //   - missing locally → replace from cloud
  // This guarantees a signed-in user always has working <img src> values
  // within an hour of any /sessions/list call.
  for (const cloudSession of cloudSessions) {
    const local = localById.get(cloudSession.id)
    if (!local) continue
    const patch: Partial<ParkingSession> = {}
    for (const field of ['sign_photo', 'car_photo', 'ambient_photo'] as const) {
      const localValue = local[field]
      const cloudValue = cloudSession[field]
      const localIsDataUrl = typeof localValue === 'string' && localValue.startsWith('data:')
      if (localIsDataUrl) continue
      if (cloudValue && cloudValue !== localValue) {
        patch[field] = cloudValue
      }
    }
    if (Object.keys(patch).length > 0) {
      updateSession(cloudSession.id, patch)
    }
    result.alreadyInSync++
  }

  // Cloud-only → merge into local storage. The cloud row's `sign_photo` /
  // `car_photo` fields arrive as short-TTL presigned S3 GET URLs (the Lambda
  // mints them in /sessions/list — see hydrateSessionPhotos in cloud-sync.js).
  // Components consume them as <img src> directly; both data URLs and HTTPS
  // URLs work. The URL expires in 1h, but re-running listCloudSessions on the
  // next app load mints fresh ones (handled in the alreadyInSync branch above).
  for (const session of cloudSessions) {
    if (localById.has(session.id)) continue
    try {
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
