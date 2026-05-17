import { createContext } from 'react'
import type { AuthUser } from './auth'

/**
 * Auth context shape — separated from the provider component so the
 * react-refresh lint rule (one-component-per-file) doesn't have to ignore
 * the context export.
 */
export interface AuthContextValue {
  /** The signed-in user, or null. While checking on first render, `loading` is true. */
  user: AuthUser | null
  loading: boolean
  /** Whether the build has Cognito credentials baked in at all. */
  configured: boolean
  /** Re-read the current user from Cognito. Call after sign-in / sign-out / sign-up confirmation. */
  refresh: () => Promise<void>
  /** Sign out + drop tokens. Triggers refresh so the UI flips immediately. */
  signOut: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
