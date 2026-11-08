/**
 * Deep links into the PWA.
 *
 * The app lives at BASE_URL ('/app/' in builds), with the marketing landing at
 * '/'. Links from notifications, share sheets and the landing must point
 * inside the PWA scope, or they open the landing page instead of the app.
 * There is no router: App reads these params once at startup, then removes
 * them from the URL so a refresh doesn't replay the link.
 *
 * Never use the param names `code` or `state` here: App treats those as an
 * OAuth callback.
 */

export type DeepLink =
  | { kind: 'session'; sessionId: string }
  | { kind: 'privacy' }
  | { kind: 'feedback' }
  | { kind: 'recurring' }

const DEEP_LINK_PARAMS = ['session', 'privacy', 'feedback', 'recurring'] as const

/** App-relative URL carrying the given query params. */
export function appUrl(params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString()
  return `${import.meta.env.BASE_URL}${query ? `?${query}` : ''}`
}

/** Link that opens one parking record. Used as the push notification target. */
export function sessionLink(sessionId: string): string {
  return appUrl({ session: sessionId })
}

/**
 * Link that opens the street sweeping and weekly reminders view: the
 * target of a weekly reminder's notification (T5b's push uses it too).
 */
export function recurringLink(): string {
  return appUrl({ recurring: 'open' })
}

/** Parse the deep link in a query string, if any. */
export function parseDeepLink(search: string): DeepLink | null {
  const params = new URLSearchParams(search)
  const session = params.get('session')
  if (session && /^[a-zA-Z0-9._-]{1,64}$/.test(session)) {
    return { kind: 'session', sessionId: session }
  }
  if (params.get('privacy') === 'open') return { kind: 'privacy' }
  if (params.get('feedback') === 'open') return { kind: 'feedback' }
  if (params.get('recurring') === 'open') return { kind: 'recurring' }
  return null
}

/** Remove deep-link params from the address bar without a navigation. */
export function clearDeepLinkParams(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  let changed = false
  for (const key of DEEP_LINK_PARAMS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key)
      changed = true
    }
  }
  if (changed) window.history.replaceState({}, '', url.pathname + url.search + url.hash)
}
