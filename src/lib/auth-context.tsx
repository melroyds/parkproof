import { useEffect, useRef, useState, type ReactNode } from 'react'
import { authConfigured, getCurrentUser, signOut as cognitoSignOut } from './auth'
import { AuthContext, type AuthContextValue } from './auth-context-shape'
import { ACCOUNT_DELETED_EVENT, WIPED_AT_KEY } from './sync'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthContextValue['user']>(null)
  // Start loading only when Cognito is actually configured — otherwise this
  // would briefly render a loading state on the home screen of an anonymous
  // build (no auth wired in), which is needless flicker.
  const [loading, setLoading] = useState<boolean>(authConfigured())
  // This device was signed out because its account was deleted: Home and
  // Account say so until it's closed, this device is cleared, or someone
  // signs in.
  const [accountDeletedNotice, setAccountDeletedNotice] = useState(false)
  // Set at that sign-out, or when the notice is closed or this device
  // cleared, and cleared at the next sign-in, so a refusal still in flight
  // then (an upload's row) doesn't raise a closed notice again, nor one that
  // says a cleared device still has its records.
  const signedOutForDeletion = useRef(false)

  // Close the notice, and raise it no more until someone signs in.
  const closeNotice = () => {
    signedOutForDeletion.current = true
    setAccountDeletedNotice(false)
  }

  const refresh = async () => {
    if (!authConfigured()) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const next = await getCurrentUser()
      setUser(next)
      // Signed in (again): the notice was about an account that is gone.
      if (next) {
        signedOutForDeletion.current = false
        setAccountDeletedNotice(false)
      }
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

  // A signed-in call here was refused with 410 ERR_ACCOUNT_DELETED (sync.ts
  // authFetch, which never fires this for this tab's own Delete forever
  // while it runs, nor while another account is signed in here). Whoever deleted
  // the account, another device or this one when the answer to its Delete
  // forever was lost, this does one thing: sign out on this device only, as
  // signOut below does, so it stops syncing, and keep the reason for Home and
  // Account to show. The records on this device are never cleared for this,
  // and nothing is sent: they stay until the driver deletes them.
  useEffect(() => {
    const onAccountDeleted = () => {
      cognitoSignOut()
      if (!signedOutForDeletion.current) {
        signedOutForDeletion.current = true
        console.warn('[auth] this account was deleted: signing out on this device. Its records stay here.')
        setAccountDeletedNotice(true)
      }
      void refresh()
    }
    window.addEventListener(ACCOUNT_DELETED_EVENT, onAccountDeleted)
    return () => window.removeEventListener(ACCOUNT_DELETED_EVENT, onAccountDeleted)
  }, [])

  // Another tab cleared this device: its Delete forever answered, and
  // clearLocalRecords stored when (WIPED_AT_KEY in sync.ts), after signing
  // the browser out. The records the notice says are still here are gone, so
  // close it, and a refusal that reaches this tab later raises none. The tab
  // that cleared the device gets no storage event: Account closes it there
  // (AuthSettings).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === WIPED_AT_KEY) closeNotice()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
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
    accountDeletedNotice,
    dismissAccountDeletedNotice: closeNotice,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
