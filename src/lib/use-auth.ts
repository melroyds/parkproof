import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './auth-context-shape'

/**
 * Read the current auth state. Throws if used outside the AuthProvider —
 * indicates a wiring bug, not a runtime user-facing error.
 *
 * Split into its own file so AuthContext / AuthProvider can live with the
 * provider component while this hook stays alongside other lib helpers.
 * Keeps Fast Refresh happy (one-component-per-file rule).
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
