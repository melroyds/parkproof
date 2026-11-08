import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { RecurringRule } from '../types'
import { getRecurringPushRevision, requestRecurringPushSync, subscribeRecurringPushStatus } from './recurring-push'
import { loadRecurringRules } from './storage'

/** At most one catch-up pass a minute from coming back to the app (coming back online always runs one). */
const WAKE_THROTTLE_MS = 60_000

/**
 * Keep the server's weekly push schedules in step with the rules (T5b):
 * a reconcile pass on start, after every change to the rules (create,
 * edit, pause, resume, delete, here or in another tab), when the language
 * changes (the notification words are booked in it), and when the phone
 * comes back online or to the app. Mounted once, in App.
 */
export function useRecurringPushSync(rules: readonly RecurringRule[]): void {
  const { t } = useTranslation()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => {
    void requestRecurringPushSync(rules, t)
  }, [rules, t])

  useEffect(() => {
    if (typeof window === 'undefined') return
    // The start pass (the effect above) has just run, so the throttle starts now.
    let last = Date.now()
    const sync = () => {
      last = Date.now()
      void requestRecurringPushSync(loadRecurringRules(), tRef.current)
    }
    // Coming back online is rare and is exactly when a booking or a cancel
    // left pending by the start pass can go through: never throttled.
    const onOnline = () => sync()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last >= WAKE_THROTTLE_MS) sync()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}

/** Re-render when any rule's push status changes. Returns a revision number. */
export function useRecurringPushRevision(): number {
  return useSyncExternalStore(subscribeRecurringPushStatus, getRecurringPushRevision, getRecurringPushRevision)
}
