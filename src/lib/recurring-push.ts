/**
 * Weekly reminders by push (T5b), the phone's side.
 *
 * The rules in `parkproof.recurring.v1` are the source of truth. This
 * module keeps the server's cron schedules in step with them: after every
 * create, edit, pause, resume or delete (the store's change event), when
 * the app opens, and when the phone comes back online, `reconcile` books
 * each rule that wants push (POST /push/recurring, replace-all for one
 * rule) and cancels the schedules of every rule that no longer does (POST
 * /push/recurring/cancel). What it booked is remembered per rule in
 * `parkproof.recurring.push.v1` as a fingerprint of the exact request, so
 * nothing is sent again until the rule, its words or the language change,
 * or a week has passed (the server's schedules end after 90 days, so a
 * phone that is still used keeps them alive).
 *
 * Push is extra, never required: the in-tab reminders (T5a) run whatever
 * happens here. When push can't work on this phone (no support, no
 * permission, no registration, another device owns the schedules) the rule
 * is "on this device only" and the screen says so.
 */
import type { TFunction } from 'i18next'
import type { RecurringRule, Weekday } from '../types'
import { RECURRING_SCHEDULE_DAYS } from '../../lambda/recurring-schedule.js'
import { endpointUrl } from './api'
import { recurringLink } from './deep-link'
import { canShowInTabNotifications } from './notifications'
import { getDeviceId, hasActiveSubscription, hasPushDeviceId, isPushSupported, subscribeToPush } from './push'
import { recurringNotificationCopy } from './recurring-copy'

export const RECURRING_PUSH_STATE_KEY = 'parkproof.recurring.push.v1'
/** Fired on `window` when a rule's push status changes. */
export const RECURRING_PUSH_EVENT = 'parkproof:recurring-push-changed'
const DAY_MS = 24 * 60 * 60 * 1000
/** Book again after this long even when nothing changed (the server's schedules last 90 days). */
export const RECURRING_PUSH_RESYNC_MS = 7 * DAY_MS
/**
 * How long a confirmed booking is trusted to still be on the server. Its
 * schedules end RECURRING_SCHEDULE_DAYS after booking (EndDate, then
 * ActionAfterCompletion DELETE); five days less leaves room for a phone
 * clock that disagrees with the server's. Past this, the phone no longer
 * says the rule alerts with ParkProof closed until a new booking goes through.
 */
export const RECURRING_PUSH_LAPSE_MS = (RECURRING_SCHEDULE_DAYS - 5) * DAY_MS

/**
 * Is a booking confirmed at `bookedAt` still standing on the server at
 * `now`? A booking time in the future (the phone's clock went back) has an
 * unknown age, so it doesn't count: the reconcile pass books it again.
 */
export function recurringBookingStands(bookedAt: number, now: number): boolean {
  const age = now - bookedAt
  return age >= 0 && age < RECURRING_PUSH_LAPSE_MS
}
/** A registration re-sent this recently is good enough for a booking. */
const REGISTRATION_FRESH_MS = 10 * 60 * 1000
/** navigator.serviceWorker.ready never settles without a service worker: don't wait for ever. */
const READY_TIMEOUT_MS = 5_000
/** A whole registration (service worker, push service, then our server): longer, but never for ever. */
export const REGISTER_TIMEOUT_MS = 15_000

/**
 * Where a rule stands with the server:
 *  - 'push': booked with the server, so they alert even when ParkProof is closed;
 *  - 'device': push can't work here, so only this tab's own alerts are left
 *    (which some browsers can't show either: see recurringAlertReach);
 *  - 'pending': push should work but the booking hasn't gone through yet
 *    (offline, or a server error); it is tried again.
 */
export type RecurringPushStatus = 'push' | 'device' | 'pending'

/** The body of POST /push/recurring, less device_id. */
export interface RecurringPushRequest {
  rule: Pick<
    RecurringRule,
    'id' | 'days' | 'start' | 'frequency' | 'nth' | 'anchor_date' | 'timezone' | 'remind_evening_before' | 'remind_minutes_before'
  >
  copy: {
    title: string
    url: string
    evening: Partial<Record<Weekday, string>> | null
    before: Partial<Record<Weekday, string>> | null
  }
}

/** True when the rule should have server schedules: notifications on, not paused, at least one reminder. */
export function wantsServerPush(rule: RecurringRule): boolean {
  return rule.push && !rule.paused && (rule.remind_evening_before !== null || rule.remind_minutes_before !== null)
}

/**
 * The request that books a rule. The notification words are written here,
 * in the reader's language, one body per reminder per rule day ("Street
 * sweeping on Tuesday, 7 to 9 am. Move the car tonight."): the server only
 * picks the one for the occurrence's day.
 */
export function recurringPushRequest(rule: RecurringRule, t: TFunction): RecurringPushRequest {
  const byDay = (kind: 'evening' | 'before') =>
    Object.fromEntries(rule.days.map((weekday) => [weekday, recurringNotificationCopy(rule, { weekday }, kind, t).body]))
  return {
    rule: {
      id: rule.id,
      days: rule.days,
      start: rule.start,
      frequency: rule.frequency,
      nth: rule.nth,
      anchor_date: rule.anchor_date,
      timezone: rule.timezone,
      remind_evening_before: rule.remind_evening_before,
      remind_minutes_before: rule.remind_minutes_before,
    },
    copy: {
      title: recurringNotificationCopy(rule, { weekday: rule.days[0] }, 'before', t).title,
      url: recurringLink(),
      evening: rule.remind_evening_before !== null ? byDay('evening') : null,
      before: rule.remind_minutes_before !== null ? byDay('before') : null,
    },
  }
}

/** A short fingerprint of a request (FNV-1a over its JSON): "has this exact booking been made?". */
export function recurringPushSignature(request: RecurringPushRequest): string {
  const text = JSON.stringify(request)
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `v1-${(h >>> 0).toString(16).padStart(8, '0')}-${text.length}`
}

// ── What has been booked (per device, in localStorage) ──────────────────

interface BookedEntry {
  sig: string
  synced_at: number
}

type BookedState = Record<string, BookedEntry>

/**
 * The `sig` of an entry written just before a booking request goes out,
 * when the server's answer isn't known yet. The server may have created
 * schedules even when the phone never heard back (a lost response, a
 * partial result), so such a rule is still cancelled when it is deleted,
 * paused or switched off. Real signatures start with 'v1-'.
 */
const UNCONFIRMED_SIG = 'unconfirmed'

function loadBooked(): BookedState {
  try {
    const raw = localStorage.getItem(RECURRING_PUSH_STATE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: BookedState = {}
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      const e = v as Partial<BookedEntry> | null
      if (e && typeof e.sig === 'string' && typeof e.synced_at === 'number') out[id] = { sig: e.sig, synced_at: e.synced_at }
    }
    return out
  } catch {
    return {}
  }
}

/** Returns false when storage refused the write. */
function saveBooked(state: BookedState): boolean {
  try {
    localStorage.setItem(RECURRING_PUSH_STATE_KEY, JSON.stringify(state))
    return true
  } catch (err) {
    // Storage full. A confirmed booking that can't be remembered is booked
    // again next time (replace-all), and its unconfirmed entry, written
    // before the request, still lets it be cancelled.
    console.warn('[recurring-push] could not remember a booking:', err)
    return false
  }
}

/** The ids of rules this phone has booked with the server and seen confirmed (and not yet cancelled). */
export function bookedRecurringRuleIds(): string[] {
  return Object.entries(loadBooked())
    .filter(([, e]) => e.sig !== UNCONFIRMED_SIG)
    .map(([id]) => id)
}

// ── Status for the screen ────────────────────────────────────────────────

/** `bookedAt` is set with a 'push' status: when the booking it rests on was confirmed. */
const statuses = new Map<string, { sig: string; status: RecurringPushStatus; bookedAt?: number }>()
let statusRevision = 0

function setStatus(id: string, sig: string, status: RecurringPushStatus, bookedAt?: number): void {
  const prev = statuses.get(id)
  if (prev && prev.sig === sig && prev.status === status && prev.bookedAt === bookedAt) return
  statuses.set(id, { sig, status, bookedAt })
  statusRevision++
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent(RECURRING_PUSH_EVENT, { detail: { id } }))
    } catch {
      /* a listener threw */
    }
  }
}

export function getRecurringPushRevision(): number {
  return statusRevision
}

export function subscribeRecurringPushStatus(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
  window.addEventListener(RECURRING_PUSH_EVENT, listener)
  return () => window.removeEventListener(RECURRING_PUSH_EVENT, listener)
}

/**
 * The rule's push status as the screen shows it, or null when there is
 * nothing to say (notifications off, paused, no reminders) or it hasn't
 * been worked out yet. A booking remembered for this exact rule and
 * language counts as 'push' straight away, before any request, but only
 * while it is still standing on the server (recurringBookingStands): once
 * the server's schedules have ended it is 'pending' after a pass, and not
 * yet worked out before one.
 */
export function recurringPushStatusOf(rule: RecurringRule, t: TFunction, now: number = Date.now()): RecurringPushStatus | null {
  if (!wantsServerPush(rule)) return null
  const sig = recurringPushSignature(recurringPushRequest(rule, t))
  const known = statuses.get(rule.id)
  if (known && known.sig === sig) {
    if (known.status !== 'push') return known.status
    return known.bookedAt !== undefined && recurringBookingStands(known.bookedAt, now) ? 'push' : 'pending'
  }
  const stored = loadBooked()[rule.id]
  return stored?.sig === sig && recurringBookingStands(stored.synced_at, now) ? 'push' : null
}

/**
 * What the line under a rule can truthfully say about this phone:
 *  - 'closed': booked for push and notifications are allowed, so it alerts
 *    even when ParkProof is closed;
 *  - 'open_only': not on push, but this browser can show an alert while
 *    ParkProof is open;
 *  - 'none': nothing on this phone can alert for it right now (no
 *    notification support, permission not granted, or Android before its
 *    push booking went through, since Android refuses in-tab alerts).
 */
export type RecurringAlertReach = 'closed' | 'open_only' | 'none'

export interface AlertEnvironment {
  /** Notification.permission, or 'unsupported' when there is no Notification API. */
  permission: NotificationPermission | 'unsupported'
  /** canShowInTabNotifications(): can an open tab show an alert here? */
  inTab: boolean
}

export function alertEnvironment(): AlertEnvironment {
  const permission = typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  return { permission, inTab: canShowInTabNotifications() }
}

/**
 * The rule's reach on this phone, or null when there is nothing to say
 * (notifications off, paused, no reminders) or its push status hasn't been
 * worked out yet. A booked rule only counts as 'closed' while notification
 * permission is still granted: a revoked permission silences push too.
 */
export function recurringAlertReach(
  rule: RecurringRule,
  t: TFunction,
  env: AlertEnvironment = alertEnvironment(),
  now: number = Date.now(),
): RecurringAlertReach | null {
  const status = recurringPushStatusOf(rule, t, now)
  if (status === null) return null
  if (status === 'push' && env.permission === 'granted') return 'closed'
  if (env.inTab) return 'open_only'
  return 'none'
}

// ── Talking to the server ────────────────────────────────────────────────

/** Can this phone receive a booked push right now? */
export type PushReadiness = 'ready' | 'unsupported' | 'not_allowed' | 'network'

export type RecurringPushCallResult =
  | { ok: true }
  | { ok: false; reason: 'not_owner' | 'not_subscribed' | 'no_device' | 'rate_limited' | 'network' }

async function errorCode(resp: Response): Promise<string | null> {
  try {
    const body = (await resp.json()) as { error?: unknown }
    return typeof body?.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

async function failureOf(resp: Response): Promise<RecurringPushCallResult> {
  if (resp.status === 429) return { ok: false, reason: 'rate_limited' }
  const code = await errorCode(resp)
  if (resp.status === 403 && code === 'ERR_NOT_OWNER') return { ok: false, reason: 'not_owner' }
  // The registration check the field-test fixes give /push/schedule (409
  // ERR_NOT_SUBSCRIBED): understood here already, so a server that adds it
  // to /push/recurring gets a fresh registration and one retry.
  if (resp.status === 409 && code === 'ERR_NOT_SUBSCRIBED') return { ok: false, reason: 'not_subscribed' }
  return { ok: false, reason: 'network' }
}

/**
 * POST /push/recurring: book one rule's schedules (replace-all). `ok` only
 * when the server created every schedule. Never throws.
 */
export async function bookRecurringPush(request: RecurringPushRequest): Promise<RecurringPushCallResult> {
  try {
    const resp = await fetch(endpointUrl('/push/recurring'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: getDeviceId(), ...request }),
    })
    if (!resp.ok) return failureOf(resp)
    const result = (await resp.json()) as { skipped?: unknown }
    return Array.isArray(result.skipped) && result.skipped.length > 0 ? { ok: false, reason: 'network' } : { ok: true }
  } catch (err) {
    console.warn('[recurring-push] booking failed:', err)
    return { ok: false, reason: 'network' }
  }
}

/**
 * POST /push/recurring/cancel: delete one rule's schedules. A browser with
 * no device id owns no schedules, so nothing is sent (`no_device`). Never
 * throws.
 */
export async function cancelRecurringPush(ruleId: string): Promise<RecurringPushCallResult> {
  if (!hasPushDeviceId()) return { ok: false, reason: 'no_device' }
  try {
    const resp = await fetch(endpointUrl('/push/recurring/cancel'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: getDeviceId(), rule_id: ruleId }),
    })
    if (!resp.ok) return failureOf(resp)
    return { ok: true }
  } catch (err) {
    console.warn('[recurring-push] cancel failed:', err)
    return { ok: false, reason: 'network' }
  }
}

function vapidConfigured(): boolean {
  return Boolean(import.meta.env.VITE_VAPID_PUBLIC_KEY)
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}

let registration: { at: number; result: Promise<PushReadiness> } | null = null

function readinessOf(reason: string | undefined): PushReadiness {
  if (reason === 'network') return 'network'
  if (reason === 'denied') return 'not_allowed'
  return 'unsupported'
}

/**
 * Register this phone for push from a tap: the editor's Save with
 * "Notify me on this phone" on, after notification permission was asked.
 * Creates the browser's push subscription when there isn't one (never
 * prompts again: permission is already granted) and sends it to the server.
 * Shared with the background sync, which reuses the result for a while.
 */
export function registerForRecurringPush(): Promise<PushReadiness> {
  if (!isPushSupported() || !vapidConfigured()) return Promise.resolve('unsupported')
  if (Notification.permission !== 'granted') return Promise.resolve('not_allowed')
  // subscribeToPush waits on navigator.serviceWorker.ready, which never
  // settles when no service worker becomes active. Every later pass awaits
  // this cached result, so it must settle: give up as 'network' (tried
  // again on a later pass) rather than hold the sync queue for ever.
  const result = withTimeout<PushReadiness>(
    subscribeToPush().then(
      (r) => (r.ok ? 'ready' : readinessOf(r.reason)),
      () => 'network' as const,
    ),
    REGISTER_TIMEOUT_MS,
    'network',
  )
  registration = { at: Date.now(), result }
  return result
}

/**
 * Background check before a booking. Never prompts and never creates a
 * subscription (only a tap does that): it re-sends the registration the
 * browser already holds, so the server knows this device, at most every
 * 10 minutes.
 */
export async function pushReadiness(opts: { force?: boolean } = {}): Promise<PushReadiness> {
  if (!isPushSupported() || !vapidConfigured()) return 'unsupported'
  if (Notification.permission !== 'granted') return 'not_allowed'
  if (!opts.force && registration && Date.now() - registration.at < REGISTRATION_FRESH_MS) {
    const recent = await registration.result
    if (recent === 'ready') return recent
  }
  const subscribed = await withTimeout(hasActiveSubscription(), READY_TIMEOUT_MS, false)
  if (!subscribed) return 'not_allowed'
  return registerForRecurringPush()
}

// ── Keeping the server in step ───────────────────────────────────────────

export interface RecurringPushDeps {
  readiness: (opts?: { force?: boolean }) => Promise<PushReadiness>
  book: (request: RecurringPushRequest) => Promise<RecurringPushCallResult>
  cancel: (ruleId: string) => Promise<RecurringPushCallResult>
  now: () => number
}

const DEFAULT_DEPS: RecurringPushDeps = {
  readiness: pushReadiness,
  book: bookRecurringPush,
  cancel: cancelRecurringPush,
  now: () => Date.now(),
}

export interface ReconcileReport {
  booked: string[]
  cancelled: string[]
  statuses: Record<string, RecurringPushStatus>
}

/**
 * Before a booking request goes out, make sure the rule has an entry in the
 * booked state, so it is cancelled later even if the answer never arrives.
 * An existing entry (an earlier booking) already does that and is kept.
 * Returns false when the entry couldn't be stored.
 */
function markAttempt(ruleId: string): boolean {
  const state = loadBooked()
  if (state[ruleId]) return true
  state[ruleId] = { sig: UNCONFIRMED_SIG, synced_at: 0 }
  return saveBooked(state)
}

/**
 * One pass of keeping the server in step with `rules`:
 *  1. every rule the phone booked, or tried to book, that no longer wants
 *     push (deleted, paused, notifications or both reminders switched off)
 *     is cancelled; a failed cancel is kept and tried again next time;
 *  2. every rule that wants push and whose request differs from what was
 *     booked (or was booked over a week ago) is booked, after checking
 *     push can work here at all. A 409 ERR_NOT_SUBSCRIBED gets a fresh
 *     registration and one retry.
 * Statuses go to the screen as they are worked out.
 */
export async function reconcileRecurringPush(
  rules: readonly RecurringRule[],
  t: TFunction,
  deps: RecurringPushDeps = DEFAULT_DEPS,
): Promise<ReconcileReport> {
  const report: ReconcileReport = { booked: [], cancelled: [], statuses: {} }
  const wanted = rules.filter(wantsServerPush)
  const wantedIds = new Set(wanted.map((r) => r.id))

  for (const id of Object.keys(loadBooked())) {
    if (wantedIds.has(id)) continue
    const res = await deps.cancel(id)
    // Gone, never ours, or not this browser's to cancel: nothing to retry.
    if (res.ok || res.reason === 'not_owner' || res.reason === 'no_device') {
      const state = loadBooked()
      delete state[id]
      saveBooked(state)
      if (res.ok) report.cancelled.push(id)
    }
  }

  const now = deps.now()
  const due: { rule: RecurringRule; request: RecurringPushRequest; sig: string; booked: BookedEntry | undefined }[] = []
  for (const rule of wanted) {
    const request = recurringPushRequest(rule, t)
    const sig = recurringPushSignature(request)
    const booked = loadBooked()[rule.id]
    if (booked && booked.sig === sig && now - booked.synced_at < RECURRING_PUSH_RESYNC_MS && booked.synced_at <= now) {
      setStatus(rule.id, sig, 'push', booked.synced_at)
      report.statuses[rule.id] = 'push'
    } else {
      due.push({ rule, request, sig, booked })
    }
  }
  if (due.length === 0) return report

  let readiness = await deps.readiness()
  for (const item of due) {
    // An identical booking from earlier that is still standing on the server
    // keeps the rule on push when a refresh fails. One past the server's
    // EndDate has deleted itself, so it doesn't.
    const standing =
      item.booked !== undefined && item.booked.sig === item.sig && recurringBookingStands(item.booked.synced_at, now)
        ? item.booked.synced_at
        : undefined
    const fallback: RecurringPushStatus = standing !== undefined ? 'push' : 'pending'
    let bookedAt = standing
    let status: RecurringPushStatus
    if (readiness === 'unsupported' || readiness === 'not_allowed') {
      status = 'device'
    } else if (readiness === 'network') {
      status = fallback
    } else if (!markAttempt(item.rule.id)) {
      // Storage refused the entry that lets this booking be cancelled later.
      // Booking anyway could leave schedules the phone can never stop, so
      // wait for a later pass (the in-tab reminders still run).
      status = fallback
    } else {
      let res = await deps.book(item.request)
      if (!res.ok && res.reason === 'not_subscribed') {
        readiness = await deps.readiness({ force: true })
        if (readiness === 'ready') res = await deps.book(item.request)
      }
      if (res.ok) {
        bookedAt = deps.now()
        const state = loadBooked()
        state[item.rule.id] = { sig: item.sig, synced_at: bookedAt }
        saveBooked(state)
        report.booked.push(item.rule.id)
        status = 'push'
      } else if (res.reason === 'not_owner') {
        // Another device's schedules hold this rule's names (N6): nothing
        // this phone can change. Its in-tab reminders still run.
        const state = loadBooked()
        delete state[item.rule.id]
        saveBooked(state)
        status = 'device'
      } else if (res.reason === 'not_subscribed') {
        status = 'device'
      } else {
        status = fallback
      }
    }
    setStatus(item.rule.id, item.sig, status, status === 'push' ? bookedAt : undefined)
    report.statuses[item.rule.id] = status
  }
  return report
}

// One pass at a time: a change during a pass runs one more pass after it,
// with the newest rules (the same pattern as uploadSession's dirty flag).
let running: Promise<void> | null = null
let queued: { rules: readonly RecurringRule[]; t: TFunction; deps: RecurringPushDeps } | null = null

/** Ask for a reconcile pass. Resolves when no pass is waiting. Never rejects. */
export function requestRecurringPushSync(
  rules: readonly RecurringRule[],
  t: TFunction,
  deps: RecurringPushDeps = DEFAULT_DEPS,
): Promise<void> {
  queued = { rules, t, deps }
  if (!running) {
    running = (async () => {
      while (queued) {
        const job = queued
        queued = null
        try {
          await reconcileRecurringPush(job.rules, job.t, job.deps)
        } catch (err) {
          console.warn('[recurring-push] sync failed:', err)
        }
      }
      running = null
    })()
  }
  return running
}

/** Test hook: forget statuses and the cached registration. */
export function resetRecurringPushForTests(): void {
  statuses.clear()
  statusRevision = 0
  registration = null
  queued = null
}
