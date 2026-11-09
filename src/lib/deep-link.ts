/**
 * Deep links into the PWA.
 *
 * The app lives at BASE_URL ('/app/' in builds), with the marketing landing at
 * '/'. Links from notifications, share sheets and the landing must point
 * inside the PWA scope, or they open the landing page instead of the app.
 * There is no router: App reads these params once at startup, then removes
 * them from the URL so a refresh doesn't replay the link.
 *
 * Share links (T7) live in the fragment, `#share=1.<base64url(JSON)>`, so the
 * snapshot never reaches a server or its logs. App reads the fragment at
 * startup (and on `hashchange`, for a link opened in a tab where the app is
 * already open) and clears it with replaceState.
 *
 * Never use the param names `code` or `state` here: App treats those as an
 * OAuth callback.
 */
export type DeepLink =
  | { kind: 'session'; sessionId: string }
  | { kind: 'privacy' }
  | { kind: 'feedback' }
  | { kind: 'recurring' }
  /** A share link (T7). `token` is the raw text after `#share=`; decodeShareToken reads it. */
  | { kind: 'share'; token: string }

const DEEP_LINK_PARAMS = ['session', 'privacy', 'feedback', 'recurring'] as const

/** The fragment parameter a share link uses (T7): `#share=<token>`. */
export const SHARE_PARAM = 'share'

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

/**
 * The full share link for a token (T7): `<origin>/app/#share=<token>`.
 * Absolute, because it leaves the app (a message, an email).
 */
export function shareLink(token: string, origin: string = typeof window === 'undefined' ? '' : window.location.origin): string {
  return `${origin}${import.meta.env.BASE_URL}#${SHARE_PARAM}=${token}`
}

/** The share token in a fragment ("#share=..."), or null when there is none. */
export function shareTokenFromHash(hash: string): string | null {
  if (!hash || hash.length < 2) return null
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const token = params.get(SHARE_PARAM)
  return token === null ? null : token
}

/**
 * Parse the deep link in a query string, and the share link in a fragment,
 * if any. A share link wins over a query param.
 */
export function parseDeepLink(search: string, hash: string = ''): DeepLink | null {
  const token = shareTokenFromHash(hash)
  if (token !== null) return { kind: 'share', token }
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

/**
 * Remove deep-link params from the address bar, and a share link from the
 * fragment, without a navigation (replaceState), so a refresh or a copied
 * address bar doesn't carry the link on.
 */
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
  let hash = url.hash
  if (shareTokenFromHash(hash) !== null) {
    hash = ''
    changed = true
  }
  if (changed) window.history.replaceState({}, '', url.pathname + url.search + hash)
}
