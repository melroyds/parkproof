// @vitest-environment node
//
// Workday mode's flow decisions (build spec T6b items 1 to 7 and 10), pure.
//
// Why this file is in the suite: each of these decides something a driver
// can be fined over. The home link and the start gate must never open
// workday mode outside Victoria and Queensland, or on a guess. A car that
// hasn't moved must never get a new arrival time. A park that can't be a
// stop (no readable sign, another state) must never be signed as one. And
// History must show a workday's stops together, but only with the flag on.

import { describe, expect, it } from 'vitest'
import type { LogDraft, ParkingSession, SignedAddendum, WorkdayState } from '../types'
import {
  firstStopOffer,
  historyEntries,
  isFirstWorkday,
  lastOwnRecord,
  legTaggedLater,
  resolveLegSave,
  showStartWorkdayLink,
  startGateFor,
  stopNumber,
  workdayCalendarReminders,
  workdayHome,
  workdayLegDraft,
  workdayReadiness,
  type ReadinessEnv,
} from './workday-flow'
import { MAX_LEG_INDEX } from './workday'

const WD = 'aaaaaaaa-1111-4111-8111-111111111111'
const WD2 = 'bbbbbbbb-2222-4222-8222-222222222222'

function record(id: string, overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id,
    arrived_at: '2026-11-09T22:00:00.000Z',
    location: { lat: -37.81, lng: 144.96, address: '1 Test St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P 8am-6pm',
    observations: [],
    expires_at: '2026-11-10T00:00:00.000Z',
    confidence: 'high',
    sign_status: 'readable',
    place: { road: 'Test St', suburb: 'Carlton', state_code: 'AU-VIC' },
    ...overrides,
  }
}

function workday(overrides: Partial<WorkdayState> = {}): WorkdayState {
  return {
    id: WD,
    started_at: '2026-11-09T21:50:00.000Z',
    jurisdiction: 'VIC',
    status: 'between_moves',
    current_session_id: null,
    previous_session_id: null,
    ended_at: null,
    ...overrides,
  }
}

const draftFor = (w: LogDraft['workday']): Pick<LogDraft, 'workday'> => ({ workday: w })

describe('showStartWorkdayLink (item 1)', () => {
  it('never shows with the flag off, whatever is saved', () => {
    expect(showStartWorkdayLink({ enabled: false, activeWorkday: null, sessions: [] })).toBe(false)
    expect(showStartWorkdayLink({ enabled: false, activeWorkday: null, sessions: [record('a')] })).toBe(false)
  })

  it('shows with the flag on and nothing saved (the start screen checks the location itself)', () => {
    expect(showStartWorkdayLink({ enabled: true, activeWorkday: null, sessions: [] })).toBe(true)
  })

  it('is hidden while a workday is active', () => {
    expect(showStartWorkdayLink({ enabled: true, activeWorkday: workday(), sessions: [record('a')] })).toBe(false)
  })

  it("is hidden when the last record's state is known and isn't VIC or QLD", () => {
    const older = record('vic', { arrived_at: '2026-11-08T22:00:00.000Z' })
    const nsw = record('nsw', { place: { road: 'George St', suburb: 'Sydney', state_code: 'AU-NSW' } })
    expect(showStartWorkdayLink({ enabled: true, activeWorkday: null, sessions: [older, nsw] })).toBe(false)
    // Storage order doesn't matter: the LAST record is the newest arrival.
    expect(showStartWorkdayLink({ enabled: true, activeWorkday: null, sessions: [nsw, older] })).toBe(false)
  })

  it('shows when the last record is in QLD, or its state is unknown', () => {
    const qld = record('qld', { place: { road: 'Queen St', suburb: 'Brisbane City', state_code: 'AU-QLD' } })
    const unknown = record('typed', { place: undefined })
    expect(showStartWorkdayLink({ enabled: true, activeWorkday: null, sessions: [qld] })).toBe(true)
    expect(showStartWorkdayLink({ enabled: true, activeWorkday: null, sessions: [unknown] })).toBe(true)
  })

  it("never lets someone else's shared copy decide", () => {
    const mine = record('mine', { arrived_at: '2026-11-08T22:00:00.000Z' })
    const shared = record('shared', {
      place: { road: 'George St', suburb: 'Sydney', state_code: 'AU-NSW' },
      shared_from: { original_session_id: 'x', received_at: '2026-11-09T22:00:00.000Z', shared_at: null, arrival_bundle: null, snapshot: {} },
    })
    expect(lastOwnRecord([mine, shared])?.id).toBe('mine')
    expect(showStartWorkdayLink({ enabled: true, activeWorkday: null, sessions: [shared, mine] })).toBe(true)
  })
})

describe('startGateFor (item 1)', () => {
  it('opens only for the raw ISO codes of Victoria and Queensland', () => {
    expect(startGateFor('AU-VIC')).toEqual({ gate: 'available', jurisdiction: 'VIC' })
    expect(startGateFor('AU-QLD')).toEqual({ gate: 'available', jurisdiction: 'QLD' })
  })

  it('shuts for every other state and territory', () => {
    for (const code of ['AU-NSW', 'AU-ACT', 'AU-SA', 'AU-WA', 'AU-TAS', 'AU-NT']) {
      expect(startGateFor(code).gate, code).toBe('unavailable')
    }
  })

  it('never guesses: anything else is unknown, not available', () => {
    for (const code of [null, undefined, '', 'VIC', 'Victoria', 'au-vic', 'AU-VIC ', 'NZ-AUK', 42]) {
      expect(startGateFor(code)).toEqual({ gate: 'unknown', jurisdiction: null })
    }
  })
})

describe('workdayReadiness (item 2)', () => {
  const env = (o: Partial<ReadinessEnv>): ReadinessEnv => ({
    iosBrowserTab: false,
    pushSupported: true,
    permission: 'granted',
    pushTurnedOff: false,
    ...o,
  })

  it('is ready only with push supported, permission granted and push not turned off', () => {
    expect(workdayReadiness(env({}))).toBe('ready')
    expect(workdayReadiness(env({ pushTurnedOff: true }))).toBe('turned_off')
  })

  it('asks while the browser has not been asked', () => {
    expect(workdayReadiness(env({ permission: 'default' }))).toBe('ask')
  })

  it('an iPhone browser tab needs the Home Screen, even with a stale grant', () => {
    expect(workdayReadiness(env({ iosBrowserTab: true }))).toBe('ios_install')
    expect(workdayReadiness(env({ iosBrowserTab: true, pushSupported: false, permission: 'unsupported' }))).toBe('ios_install')
  })

  it('no web push, or notifications blocked', () => {
    expect(workdayReadiness(env({ pushSupported: false, permission: 'unsupported' }))).toBe('unsupported')
    expect(workdayReadiness(env({ permission: 'denied' }))).toBe('denied')
  })
})

describe('isFirstWorkday (item 3)', () => {
  it('true only when no workday was ever stored on this device', () => {
    expect(isFirstWorkday([])).toBe(true)
    expect(isFirstWorkday([workday({ status: 'ended', ended_at: '2026-11-08T08:00:00.000Z' })])).toBe(false)
  })
})

describe('firstStopOffer (item 4)', () => {
  it('nothing active: no offer, the workday starts between moves', () => {
    expect(firstStopOffer(null)).toEqual({ kind: 'none' })
    expect(firstStopOffer(record('a', { ended_at: '2026-11-09T23:00:00.000Z' }))).toEqual({ kind: 'none' })
  })

  it('offers an active VIC or QLD park with a readable sign', () => {
    const r = record('a')
    expect(firstStopOffer(r)).toEqual({ kind: 'offer', session: r })
    const qld = record('q', { place: { road: 'Queen St', suburb: null, state_code: 'AU-QLD' }, sign_status: 'partially_obscured' })
    expect(firstStopOffer(qld).kind).toBe('offer')
    // A pre-T3 record has no sign status: its sign was read, so it qualifies.
    expect(firstStopOffer(record('old', { sign_status: undefined })).kind).toBe('offer')
  })

  it('refuses a park with no readable sign, a no-sign park, another state, an unknown state, or another workday\'s stop', () => {
    for (const r of [
      record('missing', { sign_status: 'missing' }),
      record('notsign', { sign_status: 'not_a_parking_sign' }),
      record('nosign', { no_sign: true, expires_at: null }),
      record('nsw', { place: { road: 'George St', suburb: null, state_code: 'AU-NSW' } }),
      record('typed', { place: undefined }),
      record('leg', { workday_id: WD2, leg_index: 2 }),
    ]) {
      expect(firstStopOffer(r).kind, r.id).toBe('ineligible')
    }
  })
})

describe('workdayHome (items 5 and 6)', () => {
  it('parked: the current stop has not ended', () => {
    const leg = record('l0', { workday_id: WD, leg_index: 0 })
    const home = workdayHome(workday({ status: 'parked', current_session_id: 'l0' }), [leg])
    expect(home.phase).toBe('parked')
    expect(home.currentLeg?.id).toBe('l0')
    expect(home.stops).toBe(1)
  })

  it('moving: between moves, and also when the stop ended elsewhere or is gone', () => {
    const ended = record('l0', { workday_id: WD, leg_index: 0, ended_at: '2026-11-09T23:30:00.000Z' })
    expect(workdayHome(workday({ status: 'between_moves', current_session_id: 'l0' }), [ended]).phase).toBe('moving')
    expect(workdayHome(workday({ status: 'parked', current_session_id: 'l0' }), [ended]).phase).toBe('moving')
    expect(workdayHome(workday({ status: 'parked', current_session_id: 'gone' }), []).phase).toBe('moving')
    expect(workdayHome(workday(), []).stops).toBe(0)
  })

  it('stopNumber is the leg index plus one', () => {
    expect(stopNumber({ leg_index: 0 })).toBe(1)
    expect(stopNumber({ leg_index: 4 })).toBe(5)
    expect(stopNumber({ leg_index: null })).toBeNull()
  })
})

describe('workdayLegDraft (item 6)', () => {
  it('only between moves, linking the next index and the stop just left', () => {
    const l0 = record('l0', { workday_id: WD, leg_index: 0, ended_at: '2026-11-09T23:30:00.000Z' })
    expect(workdayLegDraft(workday({ current_session_id: 'l0' }), [l0])).toEqual({
      workday_id: WD,
      leg_index: 1,
      previous_session_id: 'l0',
    })
    expect(workdayLegDraft(workday({ status: 'parked', current_session_id: 'l0' }), [l0])).toBeNull()
    expect(workdayLegDraft(workday({ status: 'ended', ended_at: '2026-11-10T06:00:00.000Z' }), [l0])).toBeNull()
    expect(workdayLegDraft(null, [])).toBeNull()
  })
})

describe('resolveLegSave (item 7)', () => {
  const l0 = record('l0', { workday_id: WD, leg_index: 0, ended_at: '2026-11-09T23:30:00.000Z' })
  const active = workday({ current_session_id: 'l0' })
  const wanted = { workday_id: WD, leg_index: 1, previous_session_id: 'l0' }

  it('a normal scan stays normal', () => {
    expect(resolveLegSave(record('n'), draftFor(null), active, [l0])).toEqual({ kind: 'normal' })
  })

  it('a VIC or QLD park with a readable sign becomes the next stop, its index from the saved stops', () => {
    expect(resolveLegSave(record('n'), draftFor(wanted), active, [l0])).toEqual({ kind: 'leg', workday: wanted })
    // The draft's index is only advisory: a stop saved meanwhile moves it on.
    const l1 = record('l1', { workday_id: WD, leg_index: 1 })
    const decision = resolveLegSave(record('n'), draftFor(wanted), active, [l0, l1])
    expect(decision).toMatchObject({ kind: 'leg', workday: { leg_index: 2 } })
  })

  it("stops the workday when the park isn't in VIC or QLD, or its state is unknown, and tells the two apart", () => {
    const nsw = record('n', { place: { road: 'George St', suburb: null, state_code: 'AU-NSW' } })
    expect(resolveLegSave(nsw, draftFor(wanted), active, [l0])).toEqual({ kind: 'stop', reason: 'jurisdiction', workday_id: WD })
    // No place at all (a typed address, no GPS fix at Save, a fix too rough to look up).
    const typed = record('t', { place: undefined })
    expect(resolveLegSave(typed, draftFor(wanted), active, [l0])).toEqual({ kind: 'stop', reason: 'unknown_state', workday_id: WD })
    // A lookup that answered without a state code.
    const noCode = record('c', { place: { road: 'King St', suburb: 'Melbourne', state_code: null } })
    expect(resolveLegSave(noCode, draftFor(wanted), active, [l0])).toEqual({ kind: 'stop', reason: 'unknown_state', workday_id: WD })
  })

  it('never attaches a park with no readable sign', () => {
    const missing = record('m', { sign_status: 'missing', rules: '' })
    expect(resolveLegSave(missing, draftFor(wanted), active, [l0]).kind).toBe('stop')
  })

  it('never attaches a park to a workday that ended or moved on meanwhile', () => {
    expect(resolveLegSave(record('n'), draftFor(wanted), null, [l0])).toEqual({ kind: 'stop', reason: 'ended', workday_id: null })
    expect(resolveLegSave(record('n'), draftFor(wanted), workday({ status: 'parked', current_session_id: 'x' }), [l0]).kind).toBe('stop')
    expect(resolveLegSave(record('n'), draftFor(wanted), workday({ id: WD2 }), [l0]).kind).toBe('stop')
  })

  it('stops when the workday has the most stops a signed link accepts', () => {
    const legs = Array.from({ length: MAX_LEG_INDEX + 1 }, (_, i) => record(`l${i}`, { workday_id: WD, leg_index: i }))
    expect(resolveLegSave(record('n'), draftFor(wanted), active, legs)).toEqual({ kind: 'stop', reason: 'full', workday_id: WD })
  })
})

describe('historyEntries (item 5)', () => {
  const l0 = record('l0', { workday_id: WD, leg_index: 0, arrived_at: '2026-11-09T22:00:00.000Z' })
  const l1 = record('l1', { workday_id: WD, leg_index: 1, arrived_at: '2026-11-10T00:10:00.000Z' })
  const other = record('other', { arrived_at: '2026-11-09T23:00:00.000Z' })

  it('folds a workday into one row, where its newest stop would be, legs in order', () => {
    // Storage order: newest first.
    const rows = historyEntries([l1, other, l0], true)
    expect(rows.map((r) => (r.kind === 'workday' ? `workday:${r.legs.map((l) => l.id).join(',')}` : r.session.id))).toEqual([
      'workday:l0,l1',
      'other',
    ])
  })

  it('with the flag off every record is its own row', () => {
    const rows = historyEntries([l1, other, l0], false)
    expect(rows.map((r) => (r.kind === 'record' ? r.session.id : 'workday'))).toEqual(['l1', 'other', 'l0'])
  })
})

describe('legTaggedLater', () => {
  const arrival = (workdayLink: unknown): SignedAddendum => ({
    id: 'add-1',
    seq: 1,
    kind: 'arrival_context',
    captured_at: '2026-11-09T22:00:00.000Z',
    data: { workday: workdayLink } as Record<string, unknown>,
  })

  it('true for a stop whose signed arrival details name no workday (leg 0 from an earlier park)', () => {
    expect(legTaggedLater(record('a', { workday_id: WD, leg_index: 0, addenda: [arrival(null)] }))).toBe(true)
    expect(legTaggedLater(record('a', { workday_id: WD, leg_index: 0 }))).toBe(true)
  })

  it('false for a stop logged as one, and for a record that is no stop', () => {
    const link = { workday_id: WD, leg_index: 1, stretch_deadline: null, previous_departure_payload_sha256: null }
    expect(legTaggedLater(record('a', { workday_id: WD, leg_index: 1, addenda: [arrival(link)] }))).toBe(false)
    expect(legTaggedLater(record('a'))).toBe(false)
  })
})

describe('workdayCalendarReminders (item 2)', () => {
  it("uses T6a's schedule: heads-up, go now and the deadline", () => {
    const now = Date.parse('2026-11-09T22:00:00.000Z')
    const reminders = workdayCalendarReminders({ expires_at: '2026-11-10T00:00:00.000Z' }, now)
    expect(reminders.map((r) => [r.kind, r.fire_at])).toEqual([
      ['heads_up', '2026-11-09T23:15:00.000Z'],
      ['go_now', '2026-11-09T23:35:00.000Z'],
      ['at_deadline', '2026-11-10T00:00:00.000Z'],
    ])
  })

  it('nothing for a stop with no deadline, or one that has passed', () => {
    expect(workdayCalendarReminders({ expires_at: null })).toEqual([])
    expect(workdayCalendarReminders({ expires_at: '2026-11-09T21:00:00.000Z' }, Date.parse('2026-11-09T22:00:00.000Z'))).toEqual([])
  })
})
