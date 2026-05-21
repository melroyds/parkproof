/**
 * Endpoint routing + retry layer.
 *
 * Two front-doors:
 *
 *  1. **CloudFront → Lambda Function URL (OAC, sigv4-signed)** for the SLOW
 *     anonymous routes (sign-translate, draft-appeal, sign-session, feedback).
 *     CloudFront sits at the same origin as the SPA, so requests to
 *     `www.parkproof.com.au/api/*` are same-origin (no CORS), and CloudFront
 *     forwards them sigv4-signed via OAC to a Lambda Function URL with
 *     AuthType=AWS_IAM. The CloudFront origin-response timeout is 60 seconds,
 *     bypassing API Gateway's hard 30-second cap — which is what was breaking
 *     complex multi-variant signs that took the model 30–50s to read. The
 *     Lambda's own 60s timeout is now the effective ceiling.
 *
 *  2. **API Gateway HTTP API (VITE_API_URL)** still fronts the 6 JWT-gated
 *     routes (`/sessions/*`, `/photos/*`, `/me/*`). 30s timeout is fine here
 *     — those calls are DDB queries + presigned-URL minting, all fast. The
 *     gateway also gives us the Cognito JWT authorizer for free, which
 *     CloudFront would require Lambda@Edge to replicate.
 *
 * In dev, both front-doors fall through to the Vite middleware at /api/*.
 *
 * `postJsonWithRetry` retains the single retry-on-5xx layer so any transient
 * gateway hiccup still produces a friendly localised message rather than the
 * raw HTTP detail. The new architecture should make 5xx essentially extinct
 * on the slow routes, but the safety net costs nothing.
 *
 * Earlier attempt note: I tried Lambda Function URL with AuthType=NONE +
 * a Principal:"*" resource policy. Persistent 403 in this account despite
 * no SCPs/RCPs/PAB visible — known AWS quirk. CloudFront OAC sidesteps it
 * entirely by signing requests server-side.
 */

const API_GATEWAY_URL = import.meta.env.VITE_API_URL as string | undefined

/**
 * Resolve the correct URL for a given endpoint.
 *
 * - VITE_API_URL set → API Gateway, with the last URL segment swapped for
 *   the target path (the env var is baked per-route by deploy.sh).
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
 * Status codes that indicate the request didn't really fail in a way the
 * user could fix. Any 5xx falls in here — we retry once and surface a
 * friendly message rather than the raw HTTP detail. AWS API Gateway has
 * been observed returning 500 with body `{"message":"Service Unavailable"}`
 * when Lambda is slow OR when an integration upstream times out, so we
 * treat the whole 5xx range as transient.
 */
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504, 529])

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

/**
 * Async-polling helper. Some endpoints (sign-translate, draft-appeal) take
 * 30–50s on complex inputs — past API Gateway's hard 30s HTTP timeout. The
 * Lambda enqueues a job and returns 202 + job_id; we then poll the status
 * endpoint until the job finishes.
 *
 * Polling interval is intentionally aggressive (1500ms) because Claude
 * returns in a fairly tight window and a snappier user experience matters
 * more than the few extra DDB reads (cents per million).
 */
export async function postJsonAndPoll<T>(
  path: string,
  body: unknown,
): Promise<T> {
  // Step 1: enqueue the job. Returns 202 with { job_id }.
  type EnqueueResp = { job_id: string; status: string }
  const enqueueResp = await postJsonWithRetry<EnqueueResp>(path, body)
  if (!enqueueResp.job_id) {
    // If the server happened to return the result synchronously (e.g., the
    // refresh-mode path on /sign-translate), it isn't shaped like an enqueue
    // response — return as-is. The caller cast handles the type.
    return enqueueResp as unknown as T
  }

  // Step 2: poll the status endpoint until status is 'done' or 'error'.
  // Cap at ~70 seconds total (Lambda's own timeout is 60s) to avoid infinite
  // polling if the work somehow goes missing.
  const POLL_INTERVAL_MS = 1500
  const MAX_POLLS = 50 // 50 × 1500ms = 75s ceiling

  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    await sleep(POLL_INTERVAL_MS)
    const statusUrl = `${endpointUrl(path)}/status/${enqueueResp.job_id}`
    const resp = await fetch(statusUrl, { method: 'GET' })
    if (!resp.ok) {
      if (TRANSIENT_STATUSES.has(resp.status)) {
        // Status endpoint is also fronted by API Gateway; a transient blip
        // on a poll shouldn't fail the whole flow. Keep trying.
        continue
      }
      throw new ApiError(
        await safeReadDetail(resp) || `Status check failed (${resp.status})`,
        resp.status,
        false,
      )
    }
    const payload = (await resp.json()) as {
      status: 'pending' | 'done' | 'error'
      result: T | null
      error: string | null
    }
    if (payload.status === 'done' && payload.result) {
      return payload.result
    }
    if (payload.status === 'error') {
      throw new ApiError(
        payload.error || 'Background job failed',
        500,
        false,
      )
    }
    // 'pending' — keep polling
  }
  throw new ApiError(complexSignMessage(), 504, true)
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
