// Layer-1 AI feedback: ship a verdict ('correct' | 'retake') to the Lambda,
// which logs it as a structured CloudWatch line for Logs Insights aggregation.
// Fire-and-forget: never blocks UI, never surfaces errors to the user.

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

export function submitFeedback(payload: {
  verdict: FeedbackVerdict
  feedback_id: string
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
