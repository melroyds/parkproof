/**
 * Endpoint routing + retry layer.
 *
 * All routes go through the API Gateway HTTP API (VITE_API_URL). In dev,
 * VITE_API_URL is unset and everything falls through to the Vite middleware
 * at /api/*.
 *
 * Architectural note: I attempted to add a second front-door — a Lambda
 * Function URL — for the slow anonymous routes (sign-translate, draft-appeal)
 * to bypass API Gateway's 30-second hard timeout on HTTP APIs. The Function
 * URL was created successfully and signed (SigV4 / AWS_IAM) invocations
 * returned the expected 204. BUT unauthenticated invocations (AuthType:NONE
 * with a Principal:"*" resource policy) consistently returned 403, despite
 * no SCPs / RCPs / public-access-block at the account or org level. AWS
 * forum threads describe the same symptom without a documented fix. Reverted
 * to the API Gateway-only approach.
 *
 * `postJsonWithRetry` bolts a single retry-on-503/504 onto every request so
 * transient gateway hiccups don't bubble up as "Service Unavailable" to the
 * user. Two attempts × ~30s ≈ 60s worst case. After the second failure we
 * surface a friendly, action-oriented error rather than the raw HTTP status
 * — important for genuinely-too-complex signs that AWS will never fit inside
 * the 30s window.
 */

const API_GATEWAY_URL = import.meta.env.VITE_API_URL as string | undefined

/**
 * Resolve the correct base+path for a given endpoint.
 *
 * - VITE_API_URL set → API Gateway, with the last URL segment swapped for the
 *   target path (the env var is baked per-route by deploy.sh).
 * - VITE_API_URL unset → /api/<path> for the dev middleware.
 */
export function endpointUrl(path: string): string {
  if (API_GATEWAY_URL) {
    if (API_GATEWAY_URL.endsWith(path)) return API_GATEWAY_URL
    return API_GATEWAY_URL.replace(/\/[^/]*$/, path)
  }
  return `/api${path}`
}

/**
 * Custom error class so callers can branch on "the request never got a real
 * response" vs "the server returned an explicit error message". The App.tsx
 * error view renders the message directly to the user, so the .message field
 * is the user-facing string.
 */
export class ApiError extends Error {
  status: number
  isTimeout: boolean
  constructor(message: string, status: number, isTimeout: boolean) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.isTimeout = isTimeout
  }
}

/**
 * Status codes that indicate the request didn't really fail — the backend
 * either timed out (504), the gateway upstream wasn't ready (503), or some
 * transient infrastructure hiccup happened. We retry these once.
 */
const TRANSIENT_STATUSES = new Set([502, 503, 504])

/** POST JSON with one automatic retry on transient failures. */
export async function postJsonWithRetry<T>(
  path: string,
  body: unknown,
  opts: { authHeader?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const url = endpointUrl(path)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.authHeader) headers.Authorization = opts.authHeader

  let lastErr: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: opts.signal,
      })

      if (resp.ok) {
        return (await resp.json()) as T
      }

      // Transient → retry once
      if (TRANSIENT_STATUSES.has(resp.status) && attempt === 0) {
        await sleep(1500)
        continue
      }

      // Permanent / second-attempt failure → throw with a useful message
      const detail = await safeReadDetail(resp)
      const isTimeout = TRANSIENT_STATUSES.has(resp.status)
      throw new ApiError(
        isTimeout ? complexSignMessage() : detail || `Request failed (${resp.status})`,
        resp.status,
        isTimeout,
      )
    } catch (err) {
      lastErr = err
      if (err instanceof ApiError) throw err
      // Network errors (TypeError on fetch) → also retry once
      if (attempt === 0) {
        await sleep(1500)
        continue
      }
      const message =
        err instanceof Error ? err.message : 'Network error — check your connection.'
      throw new ApiError(message, 0, false)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Unreachable')
}

async function safeReadDetail(resp: Response): Promise<string> {
  try {
    const parsed = await resp.json()
    return parsed.error || JSON.stringify(parsed)
  } catch {
    try {
      return await resp.text()
    } catch {
      return ''
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

/**
 * Loads the friendly-error string for the timeout case. Pulled via the
 * react-i18next instance so the wording stays localised — but called from
 * non-React code, so we read it imperatively here rather than going through
 * the hook.
 */
function complexSignMessage(): string {
  // Lazy import the i18n instance — keeps this module free of React deps
  // and lets callers run it in a worker if they ever want to.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const i18n = (globalThis as any).__parkproof_i18n
  if (i18n && typeof i18n.t === 'function') {
    const translated = i18n.t('errors.complexSignTimeout') as string
    if (translated && translated !== 'errors.complexSignTimeout') return translated
  }
  // English fallback — matches the en.json copy. Keep them in sync.
  return "This sign took too long to process — usually means it has lots of stacked rules. Try a clearer photo, or crop to just the part you need decoded."
}
