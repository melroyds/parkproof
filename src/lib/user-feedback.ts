// Free-text user feedback. Distinct from the AI-verdict telemetry in
// feedback.ts — that one is "did we read the sign right?", this one is
// "did the app work for you?" and goes to a different Lambda route.
//
// Backend stores to CloudWatch (primary, queryable via Logs Insights) plus
// an S3 mirror keyed by date/uuid (durable, queryable offline). No email
// forwarding by design — a 200-message Reddit day shouldn't flood your inbox.

import { endpointUrl } from './api'

export interface UserFeedbackContext {
  /** Which view the user was on when they opened the modal. e.g. "home", "session-detail". */
  page?: string
  /** Browser UA string — helps debug "the button doesn't work on iOS Safari 16". */
  user_agent?: string
  /** App build / commit SHA. Currently the build's git SHA shortened. */
  app_version?: string
  /** UI locale at submission time — for cross-referencing translation issues. */
  locale?: string
  /** Count of locally-stored sessions — proxy for engagement depth. */
  sessions_count?: number
  /** Whether the user is signed in (no PII; just yes/no). */
  is_signed_in?: boolean
}

export interface UserFeedbackPayload {
  /** Free-text message. Required. Server caps at 5000 chars. */
  message: string
  /** Optional contact email. Server validates loosely. */
  email?: string | null
  /** Optional structured context — UA, page, etc. */
  context?: UserFeedbackContext
}

export class UserFeedbackError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'UserFeedbackError'
    this.status = status
  }
}

/**
 * Submit a free-text feedback message. Resolves on 204 No Content; throws
 * UserFeedbackError on any non-2xx response. Network failures throw with
 * status=0 so the UI can show a "check your connection" message.
 *
 * NOT fire-and-forget — the user clicked Send and is watching for a result,
 * so we want a real success/failure signal back. The submitFeedback() in
 * feedback.ts is fire-and-forget because that's telemetry the user doesn't
 * see; this one is interactive.
 */
export async function submitUserFeedback(payload: UserFeedbackPayload): Promise<void> {
  const message = payload.message?.trim()
  if (!message) {
    throw new UserFeedbackError('Message is required', 400)
  }
  if (message.length > 5000) {
    throw new UserFeedbackError('Message must be 5000 characters or fewer', 400)
  }

  const body: UserFeedbackPayload = {
    message,
    email: payload.email?.trim() || null,
    context: payload.context,
  }

  let resp: Response
  try {
    resp = await fetch(endpointUrl('/user-feedback'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new UserFeedbackError(
      err instanceof Error ? err.message : 'Network error — check your connection',
      0,
    )
  }

  if (resp.ok) return

  let detail = ''
  try {
    const parsed = await resp.json()
    detail = parsed.error || ''
  } catch {
    /* ignore */
  }
  throw new UserFeedbackError(
    detail || `Submission failed (HTTP ${resp.status})`,
    resp.status,
  )
}
