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
  /**
   * True once this device was signed out because its account was deleted (a
   * signed-in call was refused with 410 ERR_ACCOUNT_DELETED), whichever
   * device deleted it, until the driver closes the notice that says so,
   * Delete forever clears this device (in this tab or another), or someone
   * signs in again. The records on this device stay. Optional: only the
   * AuthProvider sets it.
   */
  accountDeletedNotice?: boolean
  /**
   * Close that notice, and raise it no more until someone signs in. Account
   * calls it once Delete forever has cleared this device, whose records the
   * notice would say are still here.
   */
  dismissAccountDeletedNotice?: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
