import { useCallback, useEffect, useState } from 'react'
import { getPushPermissionState, isPushSupported, isPushTurnedOff, PUSH_STATE_EVENT } from './push'
import { isIosBrowserTab } from './platform'
import { workdayReadiness, type ReadinessEnv, type WorkdayReadiness } from './workday-flow'

/** This browser's push support and notification permission, read now (T6b item 2). */
export function readinessEnvNow(): ReadinessEnv {
  return {
    iosBrowserTab: isIosBrowserTab(),
    pushSupported: isPushSupported(),
    permission: getPushPermissionState(),
    pushTurnedOff: isPushTurnedOff(),
  }
}

/**
 * Whether workday reminders can reach the driver while ParkProof is
 * closed, kept current: read again when notifications are turned on or off
 * in Settings (PUSH_STATE_EVENT), when the app comes back to the screen
 * (the driver may have changed the permission in the browser's settings),
 * and when the caller asks (after its own "Turn on notifications").
 */
export function useWorkdayReadiness(env: () => ReadinessEnv = readinessEnvNow): [WorkdayReadiness, () => void] {
  const [readiness, setReadiness] = useState<WorkdayReadiness>(() => workdayReadiness(env()))
  const refresh = useCallback(() => setReadiness(workdayReadiness(env())), [env])
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener(PUSH_STATE_EVENT, refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener(PUSH_STATE_EVENT, refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])
  return [readiness, refresh]
}
