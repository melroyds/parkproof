import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  CognitoUserSession,
} from 'amazon-cognito-identity-js'

/**
 * Thin wrapper over amazon-cognito-identity-js. Promises in, plain values out.
 *
 * The SDK is callback-based, has aggressive global state, and pre-dates ES
 * modules — wrapping it cleanly here means the rest of the app never sees
 * those rough edges.
 */

// ─── Configuration ───────────────────────────────────────────────────────
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined
const APP_CLIENT_ID = import.meta.env.VITE_COGNITO_APP_CLIENT_ID as string | undefined

/** True when the build was wired with Cognito credentials. False on a bare local clone. */
export function authConfigured(): boolean {
  return Boolean(USER_POOL_ID && APP_CLIENT_ID)
}

let _pool: CognitoUserPool | null = null
function pool(): CognitoUserPool {
  if (!_pool) {
    if (!USER_POOL_ID || !APP_CLIENT_ID) {
      throw new Error(
        'Cognito is not configured. Build the frontend with VITE_COGNITO_USER_POOL_ID + VITE_COGNITO_APP_CLIENT_ID set (deploy.sh does this automatically once scripts/.aws-resources is present).',
      )
    }
    _pool = new CognitoUserPool({
      UserPoolId: USER_POOL_ID,
      ClientId: APP_CLIENT_ID,
    })
  }
  return _pool
}

// ─── Public surface ──────────────────────────────────────────────────────

export interface AuthUser {
  userId: string // Cognito `sub` — stable per user, used as DynamoDB partition key
  email: string
}

/** Sign up with email + password. Cognito sends a verification code via email. */
export async function signUp(email: string, password: string): Promise<{ userSub: string }> {
  const attrs = [new CognitoUserAttribute({ Name: 'email', Value: email })]
  return new Promise((resolve, reject) => {
    pool().signUp(email, password, attrs, [], (err, result) => {
      if (err) return reject(err)
      if (!result) return reject(new Error('Sign-up returned no result'))
      resolve({ userSub: result.userSub })
    })
  })
}

/** Confirm a sign-up using the verification code that arrived by email. */
export async function confirmSignUp(email: string, code: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool() })
  return new Promise((resolve, reject) => {
    user.confirmRegistration(code, true, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

/** Re-send the verification code email — useful if the first didn't arrive. */
export async function resendConfirmationCode(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool() })
  return new Promise((resolve, reject) => {
    user.resendConfirmationCode((err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

/** Sign in with email + password. Returns the authenticated user. */
export async function signIn(email: string, password: string): Promise<AuthUser> {
  const user = new CognitoUser({ Username: email, Pool: pool() })
  const details = new AuthenticationDetails({ Username: email, Password: password })
  return new Promise((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(claimsToUser(session)),
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        reject(
          new Error(
            'This account requires a new password. Please open the email Cognito sent and follow the link there.',
          ),
        )
      },
    })
  })
}

/** Sign out the currently-signed-in user (frees tokens from localStorage). */
export function signOut(): void {
  const user = pool().getCurrentUser()
  user?.signOut()
}

/**
 * Returns the current signed-in user, or null. Refreshes the session if the
 * cached one is expired — Cognito SDK handles refresh tokens for us.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  if (!authConfigured()) return null
  const user = pool().getCurrentUser()
  if (!user) return null
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) {
        resolve(null)
        return
      }
      resolve(claimsToUser(session))
    })
  })
}

/**
 * Get a fresh JWT (idToken) for the current user — used as the
 * Authorization header value on every authenticated API call.
 * Returns null if not signed in.
 */
export async function getIdToken(): Promise<string | null> {
  if (!authConfigured()) return null
  const user = pool().getCurrentUser()
  if (!user) return null
  return new Promise((resolve) => {
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) {
        resolve(null)
        return
      }
      resolve(session.getIdToken().getJwtToken())
    })
  })
}

/** Send a password-reset code to the email. */
export async function forgotPassword(email: string): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool() })
  return new Promise((resolve, reject) => {
    user.forgotPassword({
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    })
  })
}

/** Complete a password reset with the code + new password. */
export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  const user = new CognitoUser({ Username: email, Pool: pool() })
  return new Promise((resolve, reject) => {
    user.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: (err) => reject(err),
    })
  })
}

// ─── Internal helpers ────────────────────────────────────────────────────

function claimsToUser(session: CognitoUserSession): AuthUser {
  const payload = session.getIdToken().decodePayload()
  const userId = payload.sub
  const email = payload.email ?? ''
  if (typeof userId !== 'string') {
    throw new Error("Cognito session is missing a 'sub' claim")
  }
  return { userId, email }
}
