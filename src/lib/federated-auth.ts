/**
 * Federated sign-in via Cognito's hosted UI.
 *
 * Two halves:
 *   1. redirectToProvider(provider) — sends the user to the hosted-UI
 *      authorize endpoint with the IdP pre-selected. Cognito handles the
 *      OAuth dance with Google/Apple/etc. and redirects back to our
 *      /auth/callback with a `code` query parameter.
 *   2. handleCallback() — exchanges the `code` for tokens via the hosted-UI
 *      /oauth2/token endpoint, then writes them into localStorage in the
 *      exact format amazon-cognito-identity-js expects. After that, the
 *      existing useAuth() pipeline picks the user up on next refresh().
 *
 * The IdPs must be registered with Cognito (see docs/federation-setup.md)
 * before these buttons do anything useful. Cognito surfaces a configuration
 * error on the hosted-UI page if you click an unregistered provider.
 */

const APP_CLIENT_ID = import.meta.env.VITE_COGNITO_APP_CLIENT_ID as string | undefined
const HOSTED_UI_DOMAIN = import.meta.env.VITE_COGNITO_HOSTED_UI_DOMAIN as string | undefined

export type FederatedProvider = 'Google' | 'SignInWithApple'

export function federationConfigured(): boolean {
  return Boolean(APP_CLIENT_ID && HOSTED_UI_DOMAIN)
}

function callbackUrl(): string {
  // Match what setup-auth.sh registered as a callback URL on the App Client.
  // Cognito rejects redirects that don't appear in the allow-list.
  return `${window.location.origin}/auth/callback`
}

/**
 * Redirects the current tab to the Cognito hosted-UI authorize endpoint.
 * Cognito immediately bounces to the chosen IdP (skipping the email/password
 * form). On return, our callback handler kicks in.
 */
export function redirectToProvider(provider: FederatedProvider): void {
  if (!federationConfigured()) {
    throw new Error('Federated sign-in is not configured for this build.')
  }
  const params = new URLSearchParams({
    client_id: APP_CLIENT_ID!,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: callbackUrl(),
    identity_provider: provider,
  })
  window.location.href = `https://${HOSTED_UI_DOMAIN}/oauth2/authorize?${params.toString()}`
}

/**
 * If the current URL has a `?code=` query parameter, exchange it for Cognito
 * tokens and persist them in the format amazon-cognito-identity-js consumes.
 * Returns true when a callback was consumed (caller should clean up the URL),
 * false when there's nothing to do.
 *
 * Safe to call on every app mount — it no-ops when there's no code parameter.
 */
export async function handleCallback(): Promise<boolean> {
  if (!federationConfigured()) return false
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  if (!code) return false

  // Exchange the code for tokens.
  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: APP_CLIENT_ID!,
    code,
    redirect_uri: callbackUrl(),
  })
  const res = await fetch(`https://${HOSTED_UI_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody.toString(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }
  const tokens = (await res.json()) as {
    id_token: string
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
  }

  // Decode the id_token to extract `sub` — used as the localStorage user key
  // and matches how amazon-cognito-identity-js identifies the active user.
  const idClaims = decodeJwtPayload(tokens.id_token)
  const sub = idClaims?.sub
  if (typeof sub !== 'string') {
    throw new Error('id_token has no sub claim')
  }

  // Persist in the exact key layout the SDK expects so subsequent
  // getCurrentUser() / getIdToken() calls work transparently.
  const keyPrefix = `CognitoIdentityServiceProvider.${APP_CLIENT_ID}`
  localStorage.setItem(`${keyPrefix}.LastAuthUser`, sub)
  localStorage.setItem(`${keyPrefix}.${sub}.idToken`, tokens.id_token)
  localStorage.setItem(`${keyPrefix}.${sub}.accessToken`, tokens.access_token)
  if (tokens.refresh_token) {
    localStorage.setItem(`${keyPrefix}.${sub}.refreshToken`, tokens.refresh_token)
  }
  // Some SDK versions check for clockDrift; default to 0.
  localStorage.setItem(`${keyPrefix}.${sub}.clockDrift`, '0')

  return true
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(payload)
  } catch {
    return null
  }
}
