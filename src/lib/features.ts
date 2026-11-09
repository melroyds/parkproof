/**
 * Feature flags read from Vite's build-time env.
 *
 * VITE_FEATURE_WORKDAY gates the whole of workday mode (build spec T6a).
 * It is on in `npm run dev` and off in production builds unless the build
 * sets it, because the workday copy must be read by a lawyer before it
 * ships (docs/legal-review-queue.md).
 *
 *   VITE_FEATURE_WORKDAY=1 | true | on | yes   on, in any build
 *   VITE_FEATURE_WORKDAY=0 | false | off | no  off, in any build (dev too)
 *   unset or empty                             on in dev, off in production
 *   anything else                              off (a typo never turns it on)
 */

/** The parts of `import.meta.env` the flags read. */
export interface FlagEnv {
  DEV?: boolean
  VITE_FEATURE_WORKDAY?: string | boolean
}

const ON = new Set(['1', 'true', 'on', 'yes'])
const OFF = new Set(['0', 'false', 'off', 'no'])

/** Pure: whether workday mode is on for a given env. */
export function workdayFlagFrom(env: FlagEnv): boolean {
  const raw = env.VITE_FEATURE_WORKDAY
  if (typeof raw === 'boolean') return raw
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (value === '') return env.DEV === true
  if (ON.has(value)) return true
  if (OFF.has(value)) return false
  return false
}

const WORKDAY_ENABLED = workdayFlagFrom({
  DEV: import.meta.env.DEV,
  VITE_FEATURE_WORKDAY: import.meta.env.VITE_FEATURE_WORKDAY as string | undefined,
})

/** Whether workday mode is available in this build. Every workday entry point checks it. */
export function isWorkdayEnabled(): boolean {
  return WORKDAY_ENABLED
}
