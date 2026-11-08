// @vitest-environment node
//
// Workday readiness (T6b item 2, workday-flow.ts) and the shared "can this
// phone alert" check (fix list, alert-reach.ts) answer overlapping
// questions from the same inputs: notification permission and whether push
// was turned off in Settings. They must never disagree: "Notifications are
// on, so workday reminders can reach this phone while ParkProof is closed"
// ('ready') may show only when a push-booked reminder reaches the phone
// while ParkProof is closed (alertReach 'closed'), and wherever a
// push-booked reminder would reach it (on a browser with web push, outside
// an iPhone browser tab), the workday screens must say so.
import { describe, expect, it } from 'vitest'
import { alertReach, type AlertEnvironment } from './alert-reach'
import { workdayReadiness, type ReadinessEnv } from './workday-flow'

const PERMISSIONS: ReadinessEnv['permission'][] = ['granted', 'default', 'denied', 'unsupported']

/** Every combination of the inputs both checks read. */
function environments(): { readiness: ReadinessEnv; alert: AlertEnvironment }[] {
  const out: { readiness: ReadinessEnv; alert: AlertEnvironment }[] = []
  for (const permission of PERMISSIONS) {
    for (const pushTurnedOff of [false, true]) {
      for (const pushSupported of [true, false]) {
        for (const iosBrowserTab of [false, true]) {
          for (const inTab of [false, true]) {
            out.push({
              readiness: { iosBrowserTab, pushSupported, permission, pushTurnedOff },
              alert: { permission, inTab, pushOff: pushTurnedOff },
            })
          }
        }
      }
    }
  }
  return out
}

describe('workday readiness agrees with the shared alert-reach check', () => {
  it("'ready' only where a push-booked reminder reaches the phone while ParkProof is closed", () => {
    const disagree = environments()
      .filter(({ readiness, alert }) => workdayReadiness(readiness) === 'ready' && alertReach(true, alert) !== 'closed')
      .map((e) => JSON.stringify(e))
    expect(disagree).toEqual([])
  })

  it("wherever push works and a push-booked reminder would reach the phone closed, readiness is 'ready'", () => {
    const disagree = environments()
      .filter(
        ({ readiness, alert }) =>
          readiness.pushSupported &&
          !readiness.iosBrowserTab &&
          alertReach(true, alert) === 'closed' &&
          workdayReadiness(readiness) !== 'ready',
      )
      .map((e) => JSON.stringify(e))
    expect(disagree).toEqual([])
  })

  it('push turned off in Settings or a blocked permission is never ready, as alert-reach never says closed', () => {
    for (const { readiness, alert } of environments()) {
      if (readiness.pushTurnedOff || readiness.permission === 'denied') {
        expect(workdayReadiness(readiness)).not.toBe('ready')
        expect(alertReach(true, alert)).not.toBe('closed')
      }
    }
  })
})
