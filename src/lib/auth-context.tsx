import { useEffect, useState, type ReactNode } from 'react'
import { authConfigured, getCurrentUser, signOut as cognitoSignOut } from './auth'
import { AuthContext, type AuthContextValue } from './auth-context-shape'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthContextValue['user']>(null)
  // Start loading only when Cognito is actually configured — otherwise this
  // would briefly render a loading state on the home screen of an anonymous
  // build (no auth wired in), which is needless flicker.
  const [loading, setLoading] = useState<boolean>(authConfigured())

  const refresh = async () => {
    if (!authConfigured()) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const next = await getCurrentUser()
      setUser(next)
    } catch (err) {
      console.warn('[auth] failed to read current user:', err)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  // Mount-only fetch — this is the canonical "subscribe to an external auth
  // system" pattern. setState here is necessary (we're hydrating from
  // Cognito's tokens in localStorage), so the lint pedantry doesn't apply.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [])

  const value: AuthContextValue = {
    user,
    loading,
    configured: authConfigured(),
    refresh,
    signOut: () => {
      cognitoSignOut()
      void refresh()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
