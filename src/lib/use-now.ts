import { useEffect, useState } from 'react'

/**
 * Returns the current epoch ms, re-rendering the caller on a fixed interval.
 * Used by countdown UIs that need to tick down without a manual refresh.
 *
 * Default tick = 30s — fine-grained enough for minute-level countdowns,
 * coarse enough to not waste battery on background renders.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
