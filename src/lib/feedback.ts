// AI feedback telemetry.
//
// Layer 1 (Aug 2026): just the verdict — "did the user accept the AI's read".
// Layer 2 (now):       verdict + the model's confidence, the rules shape,
//                      whether clarification fired, time-of-day. Lets us
//                      slice failures by failure mode (high-confidence-but-
//                      wrong, stacked-sign, night-scan, etc.) instead of
//                      just tracking accept-rate over time.
// Layer 3 (later):     opt-in photo capture for systematic failures, builds
//                      a private training set. Not yet — requires a privacy
//                      toggle UI + S3 bucket.
//
// All Layer-2 fields are non-PII. The random feedback_id (per render) +
// public-sign rule text + an enum + a number + an hour-of-day — none of it
// identifies a user. Fire-and-forget: never blocks UI, never surfaces errors.

const SIGN_TRANSLATE_PATH = '/sign-translate'

function feedbackUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined
  if (apiUrl) {
    // Prod: derive from the configured API endpoint by swapping the path.
    if (apiUrl.endsWith(SIGN_TRANSLATE_PATH)) {
      return apiUrl.slice(0, -SIGN_TRANSLATE_PATH.length) + '/feedback'
    }
    return apiUrl.replace(/\/[^/]*$/, '/feedback')
  }
  // Dev: Vite middleware mirrors the same routes under /api/.
  return '/api/feedback'
}

export type FeedbackVerdict = 'correct' | 'retake'

export interface FeedbackContext {
  /** Model's self-reported confidence on this read. Surfaces wrongly-confident failures. */
  confidence?: 'low' | 'medium' | 'high'
  /** True when the AI flagged position-dependent rules (arrows / stacked / EV-only). */
  had_clarification?: boolean
  /** Which variant the user picked at the clarify step, if any. e.g. "Right side". */
  chosen_label?: string | null
  /** Returned duration_minutes from the model — short signs (1/4P) skew differently to long ones (4P). */
  duration_minutes?: number | null
  /** How many observation groups the model emitted. Proxy for sign complexity. */
  observations_count?: number
  /** First ~120 chars of the rules string — anonymous, public-sign text. Enables grouping by pattern. */
  rules_excerpt?: string
  /** Local hour-of-day at scan time (0–23). Surfaces failure modes tied to lighting. */
  scanned_hour_local?: number
  /** Whether the result came from the text-only refresh path vs a fresh vision read. */
  is_refresh?: boolean
}

export function submitFeedback(payload: {
  verdict: FeedbackVerdict
  feedback_id: string
  context?: FeedbackContext
}): void {
  // Fire-and-forget. We don't await, don't retry, don't surface errors.
  // Telemetry shouldn't slow down the user.
  fetch(feedbackUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    /* swallow — telemetry should never break the app */
  })
}
