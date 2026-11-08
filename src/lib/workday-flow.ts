import type { Jurisdiction, LogDraft, ParkingSession, WorkdayState } from '../types'
import { isWorkdayJurisdiction, jurisdictionFromStateCode, jurisdictionOfRecord } from './jurisdiction'
import { hasNoReadableSign } from './sign-result'
import { MAX_LEG_INDEX, nextLegIndex, workdayLegs, workdayReminderSchedule, type WorkdayReminder } from './workday'

/**
 * Workday mode's screens and flow (build spec T6b items 1 to 7 and 10),
 * the decisions they make, kept pure so each can be tested on its own. No
 * storage reads, no clock unless one is passed in, no network. App and the
 * workday screens call these with what they read from storage.
 *
 * Every caller checks `isWorkdayEnabled()` first (VITE_FEATURE_WORKDAY):
 * with the flag off, none of this runs and no workday UI shows.
 */

// ─── 1. The home link ──────────────────────────────────────────────────────

/** The driver's own records (never a read-only shared copy), newest arrival first. */
export function ownRecordsNewestFirst(sessions: readonly ParkingSession[]): ParkingSession[] {
  return sessions
    .filter((s) => !s.shared_from)
    .sort((a, b) => (Date.parse(b.arrived_at) || 0) - (Date.parse(a.arrived_at) || 0))
}

/** The driver's most recent own record, or null when there is none. */
export function lastOwnRecord(sessions: readonly ParkingSession[]): ParkingSession | null {
  return ownRecordsNewestFirst(sessions)[0] ?? null
}

export interface StartLinkInput {
  /** `isWorkdayEnabled()`. */
  enabled: boolean
  /** The active workday, or null. */
  activeWorkday: WorkdayState | null
  sessions: readonly ParkingSession[]
}

/**
 * Whether home shows "Parking all day? Start a workday" (T6b item 1):
 * never with the flag off, never while a workday is active, and not when
 * the last record's jurisdiction is known and isn't Victoria or
 * Queensland. An unknown jurisdiction (no record yet, a typed address, a
 * lookup that failed) still shows it: the start screen checks the phone's
 * own location before anything can start.
 */
export function showStartWorkdayLink(input: StartLinkInput): boolean {
  if (!input.enabled || input.activeWorkday) return false
  const last = lastOwnRecord(input.sessions)
  if (!last) return true
  const j = jurisdictionOfRecord(last)
  return j === null || isWorkdayJurisdiction(j)
}

// ─── 1. The start gate ─────────────────────────────────────────────────────

/**
 * Where the start fix puts the phone:
 *   - available: Victoria or Queensland, from the reverse geocode's ISO
 *     3166-2 state code;
 *   - unavailable: another Australian state or territory;
 *   - unknown: no usable fix, a failed lookup, or no state code. Never
 *     treated as available: there is no fallback that can produce VIC or
 *     QLD (T6a item 2).
 */
export type StartGate = 'available' | 'unavailable' | 'unknown'

export function startGateFor(stateCode: unknown): { gate: StartGate; jurisdiction: Jurisdiction | null } {
  const jurisdiction = jurisdictionFromStateCode(stateCode)
  if (jurisdiction === null) return { gate: 'unknown', jurisdiction: null }
  return { gate: isWorkdayJurisdiction(jurisdiction) ? 'available' : 'unavailable', jurisdiction }
}

// ─── 2. Readiness ──────────────────────────────────────────────────────────

/**
 * Can workday reminders reach the driver while ParkProof is closed?
 *   - ready: push works here and notifications are allowed;
 *   - ask: push works here and the browser hasn't asked yet;
 *   - ios_install: an iPhone browser tab (Apple allows web notifications
 *     only for a site added to the Home Screen);
 *   - unsupported: no web push in this browser;
 *   - denied: notifications are blocked;
 *   - turned_off: the driver turned notifications off in Settings.
 * Anything but 'ready' means "Workday reminders need notifications" and
 * the calendar file is offered.
 */
export type WorkdayReadiness = 'ready' | 'ask' | 'ios_install' | 'unsupported' | 'denied' | 'turned_off'

export interface ReadinessEnv {
  iosBrowserTab: boolean
  pushSupported: boolean
  permission: NotificationPermission | 'unsupported'
  pushTurnedOff: boolean
}

export function workdayReadiness(env: ReadinessEnv): WorkdayReadiness {
  if (env.iosBrowserTab) return 'ios_install'
  if (!env.pushSupported || env.permission === 'unsupported') return 'unsupported'
  if (env.permission === 'denied') return 'denied'
  if (env.pushTurnedOff) return 'turned_off'
  return env.permission === 'granted' ? 'ready' : 'ask'
}

// ─── 3. The explainer ──────────────────────────────────────────────────────

/** The full explainer shows on the first workday on this device, one line after that. */
export function isFirstWorkday(stored: readonly WorkdayState[]): boolean {
  return stored.length === 0
}

// ─── 4. The car's current park as the first stop ──────────────────────────

/**
 * What the start screen offers for a record that is active when the driver
 * taps Start (T6b item 4):
 *   - none: no record is active, so the workday starts between moves and
 *     the next scan makes the first stop;
 *   - offer: "Use the car's current park as the first stop". It is the
 *     only way to start: starting fresh would let the next scan give a car
 *     that hasn't moved a new arrival time;
 *   - ineligible: the active park can't be a stop (no readable sign, a
 *     no-sign park, not in Victoria or Queensland by its own place, or
 *     already a stop of another workday). The driver taps I've left on it
 *     first.
 */
export type FirstStopOffer =
  | { kind: 'none' }
  | { kind: 'offer'; session: ParkingSession }
  | { kind: 'ineligible'; session: ParkingSession }

export function firstStopOffer(active: ParkingSession | null | undefined): FirstStopOffer {
  if (!active || active.ended_at || active.shared_from) return { kind: 'none' }
  const eligible =
    !active.no_sign &&
    !hasNoReadableSign(active) &&
    typeof active.workday_id !== 'string' &&
    isWorkdayJurisdiction(jurisdictionOfRecord(active))
  return eligible ? { kind: 'offer', session: active } : { kind: 'ineligible', session: active }
}

// ─── 5 and 6. The workday on home ─────────────────────────────────────────

/**
 * The active workday as home shows it:
 *   - parked: the car is at `currentLeg`, which hasn't ended;
 *   - moving: between moves. Also when the store still says parked but the
 *     current leg has ended (I've left tapped on the record screen, or on
 *     another device) or isn't on this device: either way the next thing
 *     to do is scan the new sign.
 * `stops` counts the legs saved so far.
 */
export interface WorkdayHome {
  workday: WorkdayState
  phase: 'parked' | 'moving'
  currentLeg: ParkingSession | null
  legs: ParkingSession[]
  stops: number
}

export function workdayHome(workday: WorkdayState, sessions: readonly ParkingSession[]): WorkdayHome {
  const legs = workdayLegs(sessions as ParkingSession[], workday.id)
  const currentLeg = workday.current_session_id
    ? (sessions.find((s) => s.id === workday.current_session_id && !s.shared_from) ?? null)
    : null
  const parked = workday.status === 'parked' && !!currentLeg && !currentLeg.ended_at
  return { workday, phase: parked ? 'parked' : 'moving', currentLeg, legs, stops: legs.length }
}

/** A leg's number on screen ("Stop 3"): its leg index plus one. */
export function stopNumber(leg: Pick<ParkingSession, 'leg_index'>): number | null {
  return Number.isInteger(leg.leg_index) && (leg.leg_index as number) >= 0 ? (leg.leg_index as number) + 1 : null
}

/**
 * The workday link a scan made between moves carries in its draft (T6b
 * item 6). The leg index is worked out again when the record is saved
 * (`resolveLegSave`); here it is only what the logger can show. Null when
 * no workday is between moves, so the scan is an ordinary one.
 */
export function workdayLegDraft(
  workday: WorkdayState | null,
  sessions: readonly ParkingSession[],
): NonNullable<LogDraft['workday']> | null {
  if (!workday || workday.status !== 'between_moves') return null
  return {
    workday_id: workday.id,
    leg_index: nextLegIndex(sessions as ParkingSession[], workday.id) ?? MAX_LEG_INDEX,
    previous_session_id: workday.current_session_id,
  }
}

// ─── 7. Saving a leg ───────────────────────────────────────────────────────

/**
 * What a record logged from a workday scan becomes (T6b item 7):
 *   - normal: not a workday scan;
 *   - leg: the next stop, with its index worked out from the saved legs;
 *   - stop: saved as a normal record and the workday stops:
 *       - 'jurisdiction': the park's own place puts it in a state other
 *         than Victoria or Queensland (also the backstop for a park with
 *         no readable sign);
 *       - 'unknown_state': the park's own place has no state code (no GPS
 *         fix at Save, a fix too rough to look up, a typed address, a
 *         lookup that failed or came too late). There is no fallback that
 *         can produce Victoria or Queensland, so it can't be a stop, but
 *         it isn't known to be elsewhere either: App keeps the running
 *         limit the driver was shown (fail safe) and says the state
 *         couldn't be told;
 *       - 'full': the workday already has the most stops a signed link
 *         accepts;
 *       - 'ended': the workday ended or changed while the scan was in
 *         progress (another tab).
 *     'jurisdiction' and 'unknown_state' tell the driver why.
 */
export type LegSaveDecision =
  | { kind: 'normal' }
  | { kind: 'leg'; workday: NonNullable<LogDraft['workday']> }
  | { kind: 'stop'; reason: 'jurisdiction' | 'unknown_state' | 'full' | 'ended'; workday_id: string | null }

export function resolveLegSave(
  record: Pick<ParkingSession, 'place' | 'no_sign' | 'sign_status'>,
  draft: Pick<LogDraft, 'workday'>,
  activeWorkday: WorkdayState | null,
  sessions: readonly ParkingSession[],
): LegSaveDecision {
  const wanted = draft.workday
  if (!wanted) return { kind: 'normal' }
  if (!activeWorkday || activeWorkday.id !== wanted.workday_id || activeWorkday.status !== 'between_moves') {
    // The workday this scan was for has ended or is parked on another
    // stop: never attach a record to it after the fact.
    return { kind: 'stop', reason: 'ended', workday_id: null }
  }
  if (record.no_sign || hasNoReadableSign(record)) {
    // Legs need a readable sign; the screens never get here, this is the backstop.
    return { kind: 'stop', reason: 'jurisdiction', workday_id: activeWorkday.id }
  }
  const jurisdiction = jurisdictionOfRecord(record)
  if (jurisdiction === null) return { kind: 'stop', reason: 'unknown_state', workday_id: activeWorkday.id }
  if (!isWorkdayJurisdiction(jurisdiction)) {
    return { kind: 'stop', reason: 'jurisdiction', workday_id: activeWorkday.id }
  }
  const index = nextLegIndex(sessions as ParkingSession[], activeWorkday.id)
  if (index === null) return { kind: 'stop', reason: 'full', workday_id: activeWorkday.id }
  return {
    kind: 'leg',
    workday: {
      workday_id: activeWorkday.id,
      leg_index: index,
      previous_session_id: activeWorkday.current_session_id,
    },
  }
}

// ─── 5. History ────────────────────────────────────────────────────────────

/** One History row: a record, or a whole workday ("Workday, 3 stops"). */
export type HistoryEntry =
  | { kind: 'record'; session: ParkingSession }
  | { kind: 'workday'; workday_id: string; legs: ParkingSession[] }

const isLeg = (s: ParkingSession): boolean =>
  typeof s.workday_id === 'string' && s.workday_id !== '' && Number.isInteger(s.leg_index) && !s.shared_from

/**
 * History's rows, in the order given (storage keeps newest first). With
 * `groupWorkdays`, every leg of a workday folds into one row where its
 * newest leg would be; without it (the flag off), every record is its own
 * row, as before.
 */
export function historyEntries(sessions: readonly ParkingSession[], groupWorkdays: boolean): HistoryEntry[] {
  if (!groupWorkdays) return sessions.map((session) => ({ kind: 'record', session }))
  const out: HistoryEntry[] = []
  const seen = new Set<string>()
  for (const s of sessions) {
    if (!isLeg(s)) {
      out.push({ kind: 'record', session: s })
      continue
    }
    const id = s.workday_id as string
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ kind: 'workday', workday_id: id, legs: workdayLegs(sessions as ParkingSession[], id) })
  }
  return out
}

// ─── The workday view ──────────────────────────────────────────────────────

/**
 * A leg added to the workday after it was logged ("Use the car's current
 * park as the first stop"): it was tagged on this device, never re-signed,
 * so its signed arrival details don't name the workday. True when no
 * arrival_context link names this workday.
 */
export function legTaggedLater(leg: Pick<ParkingSession, 'workday_id' | 'addenda'>): boolean {
  if (typeof leg.workday_id !== 'string') return false
  const arrival = (leg.addenda ?? []).find((a) => a.kind === 'arrival_context')
  const signedWorkday = (arrival?.data as { workday?: { workday_id?: unknown } | null } | undefined)?.workday
  return !signedWorkday || signedWorkday.workday_id !== leg.workday_id
}

// ─── 2. The calendar file ──────────────────────────────────────────────────

/**
 * The same alarms the push reminders use (T6a's schedule), for the calendar
 * file offered when reminders can't be delivered: heads-up, go now, and at
 * the deadline. [] when the leg has no deadline or it has passed.
 */
export function workdayCalendarReminders(
  leg: Pick<ParkingSession, 'expires_at'>,
  now: number | Date = Date.now(),
): WorkdayReminder[] {
  return workdayReminderSchedule({ deadline: leg.expires_at ?? null, now })
}

// ─── The workday PDF's leg picker (T6c item 1) ─────────────────────────────

/**
 * The legs the picker chose, in leg order: those of `legs` (a workday's
 * saved legs) whose id is chosen. An id that isn't one of them is ignored,
 * so the PDF only ever holds this workday's own legs, and a read-only
 * shared copy is never one. Kept here, not in pdf-workday.ts, so the
 * picker doesn't load the PDF code.
 */
export function chosenWorkdayLegs(legs: readonly ParkingSession[], chosenIds: Iterable<string>): ParkingSession[] {
  const ids = new Set(chosenIds)
  return legs
    .filter((l) => isLeg(l) && ids.has(l.id))
    .sort((a, b) => (a.leg_index as number) - (b.leg_index as number) || Date.parse(a.arrived_at) - Date.parse(b.arrived_at))
}
