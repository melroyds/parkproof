import type { ParkingSession, SignatureBundle } from '../types'
import { loadSessions, updateSession } from './storage'

const SIGN_TRANSLATE_PATH = '/sign-translate'

/** Throttle so we don't bang the Lambda repeatedly on app mount. */
const RETRY_THROTTLE_MS = 5 * 60_000 // 5 min
/** Per-session retry cap so a permanent failure doesn't loop forever. */
const MAX_RETRIES_PER_SESSION = 3
/** Sessions older than this give up — the signing window has practically closed. */
const RETRY_HORIZON_MS = 30 * 24 * 60 * 60_000 // 30 days
/** localStorage key for "last attempt" timestamps per session ID. */
const RETRY_LOG_KEY = 'parkproof.signing.retry.v1'

interface RetryRecord {
  attempts: number
  lastAttempt: number
}
type RetryLog = Record<string, RetryRecord>

function loadRetryLog(): RetryLog {
  try {
    const raw = localStorage.getItem(RETRY_LOG_KEY)
    return raw ? (JSON.parse(raw) as RetryLog) : {}
  } catch {
    return {}
  }
}

function saveRetryLog(log: RetryLog): void {
  try {
    localStorage.setItem(RETRY_LOG_KEY, JSON.stringify(log))
  } catch {
    /* swallow — retry tracking is best-effort; worst case is a slightly noisier retry pattern */
  }
}

function signSessionUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined
  if (apiUrl) {
    if (apiUrl.endsWith(SIGN_TRANSLATE_PATH)) {
      return apiUrl.slice(0, -SIGN_TRANSLATE_PATH.length) + '/sign-session'
    }
    return apiUrl.replace(/\/[^/]*$/, '/sign-session')
  }
  return '/api/sign-session'
}

/**
 * SHA-256 of a data-URL image's raw bytes (not the data-URL string itself).
 * Returns lowercase hex.
 */
async function hashDataUrlImage(dataUrl: string): Promise<string> {
  const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Compute photo hashes locally, ship the metadata + hashes to the Lambda,
 * receive a KMS-backed signature. Resolves to null on any failure — this is
 * fire-and-forget evidence-grade enhancement, not a core flow.
 */
export async function signSession(session: ParkingSession): Promise<SignatureBundle | null> {
  try {
    const sign_photo_sha256 = await hashDataUrlImage(session.sign_photo)
    const car_photo_sha256 = session.car_photo
      ? await hashDataUrlImage(session.car_photo)
      : null

    const body = {
      session_id: session.id,
      arrived_at: session.arrived_at,
      expires_at: session.expires_at,
      location: session.location,
      rules: session.rules,
      chosen_label: session.chosen_label ?? null,
      confidence: session.confidence,
      sign_photo_sha256,
      car_photo_sha256,
    }

    const resp = await fetch(signSessionUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      console.warn('signSession failed:', resp.status, await resp.text())
      return null
    }
    return (await resp.json()) as SignatureBundle
  } catch (err) {
    console.warn('signSession error:', err)
    return null
  }
}

/**
 * Sweep localStorage on app start, retrying signing for any session that
 * landed unsigned (typically because the tab closed before signSession's
 * fetch returned). Throttled per-session so a permanent backend failure
 * doesn't burn through CPU/network.
 *
 * Runs in the background — never blocks UI rendering, never throws.
 */
export function retryUnsignedSessions(now: number = Date.now()): void {
  let log: RetryLog
  try {
    log = loadRetryLog()
  } catch {
    log = {}
  }

  const candidates = loadSessions().filter((s) => {
    if (s.signature) return false
    const ageMs = now - new Date(s.arrived_at).getTime()
    if (!Number.isFinite(ageMs) || ageMs > RETRY_HORIZON_MS) return false
    const rec = log[s.id]
    if (rec) {
      if (rec.attempts >= MAX_RETRIES_PER_SESSION) return false
      if (now - rec.lastAttempt < RETRY_THROTTLE_MS) return false
    }
    return true
  })

  if (candidates.length === 0) return

  // Fire each retry independently — failure of one shouldn't block the others.
  for (const session of candidates) {
    log[session.id] = {
      attempts: (log[session.id]?.attempts ?? 0) + 1,
      lastAttempt: now,
    }
    void signSession(session).then((signature) => {
      if (!signature) return
      try {
        updateSession(session.id, { signature })
        // Success — clear the retry record so it doesn't count against the cap
        // if signature is ever invalidated and we resign in future.
        try {
          const fresh = loadRetryLog()
          delete fresh[session.id]
          saveRetryLog(fresh)
        } catch {
          /* best-effort */
        }
      } catch (err) {
        console.warn('[signing] retry persisted but storage write failed:', err)
      }
    })
  }
  saveRetryLog(log)
}
