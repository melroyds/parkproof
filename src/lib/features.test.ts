// @vitest-environment node
//
// VITE_FEATURE_WORKDAY (build spec T6a): workday mode is on in dev and off
// in production builds unless the build sets it. The workday copy hasn't
// been read by a lawyer yet, so a production build that showed it by
// default, or a typo that switched it on, would ship unreviewed legal copy.

import { describe, expect, it } from 'vitest'
import { isWorkdayEnabled, workdayFlagFrom } from './features'

describe('workdayFlagFrom', () => {
  it('unset: on in dev, off in a production build', () => {
    expect(workdayFlagFrom({ DEV: true })).toBe(true)
    expect(workdayFlagFrom({ DEV: false })).toBe(false)
    expect(workdayFlagFrom({})).toBe(false)
    expect(workdayFlagFrom({ DEV: true, VITE_FEATURE_WORKDAY: '' })).toBe(true)
    expect(workdayFlagFrom({ DEV: false, VITE_FEATURE_WORKDAY: '   ' })).toBe(false)
  })

  it('set on: on in any build', () => {
    for (const v of ['1', 'true', 'TRUE', ' on ', 'yes', true]) {
      expect(workdayFlagFrom({ DEV: false, VITE_FEATURE_WORKDAY: v }), String(v)).toBe(true)
      expect(workdayFlagFrom({ DEV: true, VITE_FEATURE_WORKDAY: v }), String(v)).toBe(true)
    }
  })

  it('set off: off in any build, dev included', () => {
    for (const v of ['0', 'false', 'Off', 'no', false]) {
      expect(workdayFlagFrom({ DEV: true, VITE_FEATURE_WORKDAY: v }), String(v)).toBe(false)
      expect(workdayFlagFrom({ DEV: false, VITE_FEATURE_WORKDAY: v }), String(v)).toBe(false)
    }
  })

  it('an unrecognised value is off, so a typo never switches it on', () => {
    for (const v of ['ture', 'enabled', '2', 'workday']) {
      expect(workdayFlagFrom({ DEV: false, VITE_FEATURE_WORKDAY: v }), v).toBe(false)
      expect(workdayFlagFrom({ DEV: true, VITE_FEATURE_WORKDAY: v }), v).toBe(false)
    }
  })
})

describe('isWorkdayEnabled', () => {
  it('reads this build\'s env through the same rule', () => {
    expect(isWorkdayEnabled()).toBe(
      workdayFlagFrom({ DEV: import.meta.env.DEV, VITE_FEATURE_WORKDAY: import.meta.env.VITE_FEATURE_WORKDAY }),
    )
  })

  it('is on in the test run, which is a dev build with the flag unset', () => {
    // Side checkouts have no .env, so the flag is unset here.
    if (import.meta.env.VITE_FEATURE_WORKDAY === undefined) {
      expect(import.meta.env.DEV).toBe(true)
      expect(isWorkdayEnabled()).toBe(true)
    }
  })
})
