import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { RecurringRule } from '../types'
import { getRecurringRevision, loadRecurringRules, subscribeRecurringChanged } from './storage'
import { armRecurringInTabReminders } from './recurring-reminders'
import { useNow } from './use-now'

/** Every saved weekly reminder, re-read whenever one is saved, paused or deleted (here or in another tab). */
export function useRecurringRules(): RecurringRule[] {
  const version = useSyncExternalStore(subscribeRecurringChanged, getRecurringRevision, getRecurringRevision)
  return useMemo(() => readRulesAt(version), [version])
}

function readRulesAt(version: number): RecurringRule[] {
  void version
  return loadRecurringRules()
}

/** How often the in-tab window rolls forward while the app stays open. */
const REARM_MS = 15 * 60 * 1000

/**
 * Keep the weekly reminders of the next 24 hours armed while the app is
 * open: on start, on every change to the rules, when the language changes
 * (the text is armed with it) and every 15 minutes as the window rolls on.
 */
export function useRecurringInTabReminders(rules: readonly RecurringRule[]): void {
  const { t } = useTranslation()
  const tick = useNow(REARM_MS)
  useEffect(() => {
    // The tick only re-runs this; the timers are worked out from the real
    // clock, since a change to the rules can land minutes after the tick.
    void tick
    armRecurringInTabReminders(rules, t, Date.now())
  }, [rules, t, tick])
}
