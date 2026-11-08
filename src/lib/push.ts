// Web Push helpers: the browser subscription, its registration on the
// server (/push/subscribe), and the server-side reminder schedules
// (/push/schedule, /push/cancel). The "Remind me" flow that ties these to
// the in-tab notifications lives in remind-me.ts.
//
// Keeping the server registration alive (field-test fix list, item 1): the
// server forgets a device after PUSH_TTL_DAYS, or never heard of it when the
// first save failed, while the browser still holds its subscription. So the
// app re-sends the registration when it opens (installPushRegistrationRefresh)
// and before every booking, and a booking the server refuses with
// ERR_NOT_SUBSCRIBED re-registers once and retries once.
//
// A registration the push service has answered 410 Gone for is dead, but
// the browser can keep reporting it. The server keeps a tombstone for it and
// refuses it with 409 ERR_ENDPOINT_GONE; the app then drops it and registers
// a fresh one (subscribeToPush), instead of re-sending the dead one forever.
//
// Every request to the push API, and every browser push step that goes over
// the network (subscribe, unsubscribe), gives up after
// PUSH_REQUEST_TIMEOUT_MS. On a weak signal a request can hang for minutes,
// and "Remind me" must still finish and say what it set.

import { endpointUrl } from './api'

const DEVICE_ID_KEY = 'parkproof.device_id.v1'

/** When this browser last sent its registration to the server, and which endpoint. */
const REGISTRATION_SENT_KEY = 'parkproof.push.registration_sent.v1'
/** App open (and coming back to the screen) re-sends at most this often. */
export const REGISTRATION_RESYNC_INTERVAL_MS = 60 * 60 * 1000
/** A booking skips its own re-send when one went out this recently. */
const REGISTRATION_FRESH_FOR_BOOKING_MS = 60 * 1000
/** How long to wait for the service worker before giving up on push. */
const SW_READY_TIMEOUT_MS = 10_000
/** How long one push request (or browser subscribe / unsubscribe) may take. */
export const PUSH_REQUEST_TIMEOUT_MS = 10_000

/** The server error code for "no live registration for this device". */
export const ERR_NOT_SUBSCRIBED = 'ERR_NOT_SUBSCRIBED'
/** The server error code for "this endpoint is dead (the push service said 410 Gone)". */
export const ERR_ENDPOINT_GONE = 'ERR_ENDPOINT_GONE'

/**
 * The active service worker registration, or null when there is none.
 * `navigator.serviceWorker.ready` never settles without a registration (the
 * dev server registers no service worker), so check for one first and cap
 * the wait: a reminder screen must never spin forever.
 */
async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    const sw = navigator.serviceWorker
    if (typeof sw.getRegistration === 'function' && !(await sw.getRegistration())) return null
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), SW_READY_TIMEOUT_MS)
    })
    try {
      return await Promise.race([sw.ready, timeout])
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return null
  }
}

const TIMED_OUT: unique symbol = Symbol('timed out')

/** `work`, or TIMED_OUT when it hasn't settled within `ms`. Rejects as `work` does. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms)
  })
  try {
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * A signal that aborts a request after `ms`: AbortSignal.timeout where the
 * browser has it, else an AbortController the caller aborts when its own
 * timer runs out (`abort`). No signal at all on a browser with neither:
 * the caller's timer still stops the wait.
 */
function timeoutSignal(ms: number): { signal?: AbortSignal; abort: () => void } {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return { signal: AbortSignal.timeout(ms), abort: () => {} }
  }
  if (typeof AbortController === 'function') {
    const controller = new AbortController()
    return { signal: controller.signal, abort: () => controller.abort() }
  }
  return { abort: () => {} }
}

/** What one request to the push API came back with. */
type PushReply =
  /** The server answered. `body` is its JSON, or null when there was none. */
  | { kind: 'reply'; status: number; ok: boolean; body: unknown }
  /** No answer within PUSH_REQUEST_TIMEOUT_MS. */
  | { kind: 'timeout' }
  /** The request failed (offline, CORS, DNS). */
  | { kind: 'error'; error: unknown }

/**
 * POST `payload` as JSON to a push route and read the JSON reply, giving up
 * after PUSH_REQUEST_TIMEOUT_MS. The timer covers the whole exchange,
 * reading the reply included, and also stops the wait when a browser's
 * fetch ignores the signal. Never throws.
 */
async function pushPost(path: string, payload: unknown): Promise<PushReply> {
  const { signal, abort } = timeoutSignal(PUSH_REQUEST_TIMEOUT_MS)
  const request = (async (): Promise<PushReply> => {
    try {
      const resp = await fetch(endpointUrl(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
      let body: unknown = null
      try {
        body = await resp.json()
      } catch {
        /* no JSON reply (a 204, or an error page) */
      }
      return { kind: 'reply', status: resp.status, ok: resp.ok, body }
    } catch (error) {
      return signal?.aborted ? { kind: 'timeout' } : { kind: 'error', error }
    }
  })()
  const reply = await within(request, PUSH_REQUEST_TIMEOUT_MS)
  if (reply !== TIMED_OUT) return reply
  abort()
  return { kind: 'timeout' }
}

/** The `error` code in a reply body, or null. */
function errorCodeOf(body: unknown): string | null {
  const code = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
  return typeof code === 'string' ? code : null
}

interface RegistrationSent {
  at: number
  endpoint: string
}

function readRegistrationSent(): RegistrationSent | null {
  try {
    const raw = localStorage.getItem(REGISTRATION_SENT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RegistrationSent>
    return typeof parsed.at === 'number' && typeof parsed.endpoint === 'string'
      ? { at: parsed.at, endpoint: parsed.endpoint }
      : null
  } catch {
    return null
  }
}

function writeRegistrationSent(endpoint: string): void {
  try {
    localStorage.setItem(REGISTRATION_SENT_KEY, JSON.stringify({ at: Date.now(), endpoint }))
  } catch {
    /* storage blocked: the next sync just sends again */
  }
}

function clearRegistrationSent(): void {
  try {
    localStorage.removeItem(REGISTRATION_SENT_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Send this browser's subscription to /push/subscribe under this browser's
 * device id: 'stored' when the server stored it, 'gone' when the server
 * refused it as a dead endpoint (409 ERR_ENDPOINT_GONE), 'timeout' when no
 * answer came in time, else 'failed'.
 */
async function postRegistration(subscription: PushSubscription): Promise<'stored' | 'gone' | 'timeout' | 'failed'> {
  // toJSON() gives the wire shape (endpoint + keys.p256dh + keys.auth as base64).
  let json: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  try {
    json = subscription.toJSON()
  } catch {
    return 'failed'
  }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return 'failed'
  let device_id: string
  try {
    device_id = getOrCreateDeviceId()
  } catch {
    return 'failed' // storage blocked
  }
  const reply = await pushPost('/push/subscribe', {
    device_id,
    subscription: {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    },
  })
  if (reply.kind === 'timeout') {
    console.error('[push] backend persist timed out')
    return 'timeout'
  }
  if (reply.kind === 'error') {
    console.error('[push] backend persist threw:', reply.error)
    return 'failed'
  }
  if (!reply.ok) {
    if (reply.status === 409 && errorCodeOf(reply.body) === ERR_ENDPOINT_GONE) return 'gone'
    console.error('[push] backend persist failed:', reply.status)
    return 'failed'
  }
  writeRegistrationSent(json.endpoint)
  return 'stored'
}

/** Returns true if the browser supports the APIs we need. iOS Safari < 16.4
 *  doesn't ship PushManager at all; this gate is the kindest UX. */
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** Permission state without prompting. */
export function getPushPermissionState(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission
}

/**
 * Does this browser actually have a live push subscription?
 *
 * Distinct from `getPushPermissionState() === 'granted'` — permission is
 * a long-lived browser grant that survives "Clear site data" + SW
 * unregistration. The subscription itself is a separate object held by
 * the SW registration; it can be gone while permission remains granted.
 *
 * Returns false (not throws) on any error — safe to call from a useEffect
 * that just wants to gate UI on "real subscribed state".
 */
export async function hasActiveSubscription(): Promise<boolean> {
  if (!isPushSupported()) return false
  if (Notification.permission !== 'granted') return false
  try {
    const reg = await swRegistration()
    if (!reg) return false
    const sub = await reg.pushManager.getSubscription()
    return sub !== null
  } catch {
    return false
  }
}

const DEVICE_ID_PATTERN = /^[a-f0-9-]{8,64}$/i

/** The stored device id, or null when this browser never made one. */
function peekDeviceId(): string | null {
  try {
    const id = localStorage.getItem(DEVICE_ID_KEY)
    return id && DEVICE_ID_PATTERN.test(id) ? id : null
  } catch {
    return null
  }
}

/**
 * True when this browser holds a push device id. Scheduling a reminder always
 * creates one, so a browser without one cannot own any push schedule: synced
 * reminders it shows were set on another device.
 */
export function hasPushDeviceId(): boolean {
  return peekDeviceId() !== null
}

/** Generate or fetch a stable device id (UUID) per browser. Persisted in
 *  localStorage. Used as the partition key for the push-subscriptions
 *  table — keeps the data anonymous (no Cognito sub required). */
function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (id && DEVICE_ID_PATTERN.test(id)) return id
  // Use crypto.randomUUID if available, otherwise a Math.random fallback
  // (PWA targets all support randomUUID via secure-context).
  id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  localStorage.setItem(DEVICE_ID_KEY, id)
  return id
}

/** Convert URL-safe-base64 VAPID public key into a Uint8Array for the
 *  PushManager.subscribe applicationServerKey param. Web Crypto needs this
 *  exact shape — base64 strings don't work directly.
 *
 *  Allocates a fresh ArrayBuffer (not SharedArrayBuffer) so the result is
 *  acceptable as a BufferSource to PushManager.subscribe in strict TS.
 */
function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalised)
  const buffer = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return buffer
}

export interface SubscribeResult {
  ok: boolean
  /**
   * Reason the subscribe didn't succeed, for UI display. 'network': the
   * server didn't store the registration. 'timeout': the browser's push
   * service or the server didn't answer within PUSH_REQUEST_TIMEOUT_MS.
   */
  reason?: 'unsupported' | 'denied' | 'no_vapid' | 'subscribe_failed' | 'network' | 'timeout'
  /** The active subscription, if ok. */
  subscription?: PushSubscription
}

/** A fresh push subscription from the browser, or TIMED_OUT. Rejects as subscribe() does. */
function newSubscription(reg: ServiceWorkerRegistration, vapid: string): Promise<PushSubscription | typeof TIMED_OUT> {
  // userVisibleOnly: true is mandatory: the user must see a notification
  // for every push (browsers enforce this).
  return within(
    reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapid) }),
    PUSH_REQUEST_TIMEOUT_MS,
  )
}

/** Drop a subscription, waiting at most PUSH_REQUEST_TIMEOUT_MS. Never throws. */
async function dropSubscription(subscription: PushSubscription, why: string): Promise<void> {
  try {
    if ((await within(subscription.unsubscribe(), PUSH_REQUEST_TIMEOUT_MS)) === TIMED_OUT) {
      console.warn(`[push] unsubscribe ${why} timed out`)
    }
  } catch (err) {
    console.warn(`[push] unsubscribe ${why} failed:`, err)
  }
}

/** Request notification permission + create a push subscription + persist
 *  it to the backend. Returns the result rather than throwing, so the
 *  caller can branch on the failure mode without try/catch. */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }

  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
  if (!vapid) return { ok: false, reason: 'no_vapid' }

  // Permission first. Notification.requestPermission resolves with the
  // user's choice ('granted' / 'denied' / 'default'). 'default' is what
  // you get if they dismiss the prompt — treat as denied for our purposes.
  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }
  if (permission !== 'granted') {
    return { ok: false, reason: 'denied' }
  }

  // Get a SW registration. vite-plugin-pwa registers one at the /app/
  // scope; it is null when there is none (the dev server) or it never
  // became ready.
  const reg = await swRegistration()
  if (!reg) return { ok: false, reason: 'subscribe_failed' }

  // Create a push subscription, re-using one already on this registration.
  // Making one asks the browser's push service over the network.
  let subscription: PushSubscription
  try {
    const existing = await reg.pushManager.getSubscription()
    const made = existing ?? (await newSubscription(reg, vapid))
    if (made === TIMED_OUT) {
      console.error('[push] subscribe timed out')
      return { ok: false, reason: 'timeout' }
    }
    subscription = made
  } catch (err) {
    console.error('[push] subscribe failed:', err)
    return { ok: false, reason: 'subscribe_failed' }
  }

  // Persist to the backend every time, even for a reused subscription: the
  // server may have lost this device (expired row, failed first save).
  let posted = await postRegistration(subscription)
  if (posted === 'gone') {
    // The server knows this endpoint is dead (the push service answered 410
    // Gone for it). Drop it and register a fresh one, once.
    await dropSubscription(subscription, 'of a dead registration')
    clearRegistrationSent()
    try {
      const made = await newSubscription(reg, vapid)
      if (made === TIMED_OUT) {
        console.error('[push] subscribe after a dead registration timed out')
        return { ok: false, reason: 'timeout' }
      }
      subscription = made
    } catch (err) {
      console.error('[push] subscribe after a dead registration failed:', err)
      return { ok: false, reason: 'subscribe_failed' }
    }
    posted = await postRegistration(subscription)
  }
  if (posted === 'timeout') return { ok: false, reason: 'timeout', subscription }
  if (posted !== 'stored') return { ok: false, reason: 'network', subscription }
  return { ok: true, subscription }
}

export type RegistrationSyncResult =
  /** The server stored this browser's registration just now. */
  | 'sent'
  /** Skipped: the same registration went out within `maxAgeMs`. */
  | 'fresh'
  /** Nothing to send: no push support, permission not granted, or no subscription. */
  | 'no_subscription'
  /** The server didn't store it (offline, a server error, or a dead
   *  registration that couldn't be replaced). */
  | 'failed'
  /** No answer within PUSH_REQUEST_TIMEOUT_MS: the connection is too weak
   *  for push right now. */
  | 'timeout'

/**
 * Re-send this browser's existing push registration to the server. Never
 * prompts and never creates a subscription: it only refreshes what the
 * browser already holds, so the server row exists and its expiry moves out.
 *
 * `maxAgeMs` skips the request when the same endpoint was sent that
 * recently (0, the default, always sends). A changed endpoint (the browser
 * rotated it) always sends. When the server refuses the endpoint as dead
 * (ERR_ENDPOINT_GONE), this registers a fresh one instead: permission is
 * already granted, so that never prompts.
 */
export async function syncPushRegistration(
  opts: { maxAgeMs?: number } = {},
): Promise<RegistrationSyncResult> {
  if (!isPushSupported() || Notification.permission !== 'granted') return 'no_subscription'
  let subscription: PushSubscription | null
  try {
    const reg = await swRegistration()
    subscription = reg ? await reg.pushManager.getSubscription() : null
  } catch {
    subscription = null
  }
  if (!subscription) return 'no_subscription'
  const maxAgeMs = opts.maxAgeMs ?? 0
  if (maxAgeMs > 0) {
    const last = readRegistrationSent()
    const age = last ? Date.now() - last.at : Infinity
    if (last && last.endpoint === subscription.endpoint && age >= 0 && age < maxAgeMs) return 'fresh'
  }
  const posted = await postRegistration(subscription)
  if (posted === 'gone') {
    const fresh = await subscribeToPush()
    return fresh.ok ? 'sent' : fresh.reason === 'timeout' ? 'timeout' : 'failed'
  }
  if (posted === 'timeout') return 'timeout'
  return posted === 'stored' ? 'sent' : 'failed'
}

let resyncInFlight = false

/** Re-send the registration in the background, at most once an hour. */
function resyncRegistrationIfDue(): void {
  if (resyncInFlight || !isPushSupported() || Notification.permission !== 'granted') return
  resyncInFlight = true
  void syncPushRegistration({ maxAgeMs: REGISTRATION_RESYNC_INTERVAL_MS })
    .catch(() => 'failed')
    .finally(() => {
      resyncInFlight = false
    })
}

/**
 * App start: re-send this browser's push registration now and whenever the
 * app comes back to the screen (an installed app is usually resumed, not
 * reloaded). Fire-and-forget, only when notifications are allowed and the
 * browser holds a subscription, and at most once an hour unless the
 * endpoint changed. Returns the cleanup for a React effect.
 */
export function installPushRegistrationRefresh(): () => void {
  if (typeof document === 'undefined') return () => {}
  resyncRegistrationIfDue()
  const onVisible = () => {
    if (document.visibilityState === 'visible') resyncRegistrationIfDue()
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => document.removeEventListener('visibilitychange', onVisible)
}

/**
 * "Reminders not arriving? Reconnect" (field-test fix list, item 5). A push
 * registration can go bad at the push service's end: it keeps accepting
 * messages but delivers them late or never, and only a fresh registration
 * fixes it. This drops the browser's subscription, makes a new one and
 * sends it to the server under the same device id.
 *
 * Reminders already booked need no re-booking: each schedule names the
 * device id, and the sender looks up the device's current registration
 * when the reminder fires, so they go to the new one.
 */
export async function reconnectPush(): Promise<SubscribeResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }
  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }
  // Not asked yet: ask first, while the tap's user gesture is still live
  // (WebKit shows the prompt only from one).
  if (Notification.permission === 'default' && (await Notification.requestPermission()) !== 'granted') {
    return { ok: false, reason: 'denied' }
  }
  const reg = await swRegistration()
  if (!reg) return { ok: false, reason: 'subscribe_failed' }
  try {
    const old = await reg.pushManager.getSubscription()
    // Carry on whatever happens: subscribe() below still asks for a
    // registration, and a failure there is reported.
    if (old) await dropSubscription(old, 'before reconnect')
  } catch (err) {
    console.warn('[push] reading the registration before reconnect failed:', err)
  }
  clearRegistrationSent()
  return subscribeToPush()
}

/** Returns the device id (creating one if needed). Exposed for the test
 *  script — backend test push needs to know which sub to fire at. */
export function getDeviceId(): string {
  return getOrCreateDeviceId()
}

/**
 * Unsubscribe this device from push notifications.
 *
 * Tears down the browser's PushSubscription (so the endpoint is invalidated
 * for any future EventBridge → dispatch attempts) and resolves to true on
 * success. On the next push dispatch the server gets HTTP 410 from the
 * gateway and the dispatch Lambda replaces the DDB row with a tombstone
 * for that endpoint (no keys), so the cloud subscription record
 * self-cleans without a dedicated /push/unsubscribe endpoint. Acceptable
 * lag: at most one stale-push attempt before the row goes.
 *
 * Returns false on:
 *   - Push unsupported (iOS Safari < 16.4)
 *   - No active subscription to unsubscribe from
 *   - Browser API threw (rare; permission revoked mid-call, etc.)
 *
 * Permission state is NOT cleared by this call — that's a per-site browser
 * grant, not a per-subscription state. To fully revoke, the user has to
 * change the browser's site settings. The Account UI should mention this.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false
  try {
    const reg = await swRegistration()
    if (!reg) return false
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return false
    clearRegistrationSent()
    return await sub.unsubscribe()
  } catch (err) {
    console.error('[push] unsubscribe failed:', err)
    return false
  }
}

/**
 * Why a push call changed nothing.
 *   - not_owner: the server returned 403 ERR_NOT_OWNER. The schedules were
 *     created by another device (spec N6). Retrying here can never work.
 *   - no_device: this browser has no device id, so it owns no schedules.
 *   - unsupported: push can't run on this browser.
 *   - not_subscribed: this browser holds no push subscription, or the
 *     server still had no registration for it (409 ERR_NOT_SUBSCRIBED)
 *     after one re-registration and one retry. Nothing was booked: never
 *     treat it as success.
 *   - network: offline, or any other server failure. A retry may work.
 */
export type PushFailureReason = 'not_owner' | 'no_device' | 'unsupported' | 'not_subscribed' | 'network'

export type PushCancelResult =
  | { ok: true; deleted: number }
  | { ok: false; reason: Extract<PushFailureReason, 'not_owner' | 'no_device' | 'network'> }

export type PushScheduleResult =
  | { ok: true; created: ScheduledFire[]; skipped: number }
  | { ok: false; reason: Extract<PushFailureReason, 'not_owner' | 'unsupported' | 'not_subscribed' | 'network'> }

/** True when a failed reply is the server's 403 ERR_NOT_OWNER. */
function isNotOwnerReply(reply: { status: number; body: unknown }): boolean {
  return reply.status === 403 && errorCodeOf(reply.body) === 'ERR_NOT_OWNER'
}

export interface ScheduledReminder {
  /** ISO timestamp (with offset or Z) — when to fire the push. */
  fire_at: string
  /** Notification title. Defaults server-side to "ParkProof". */
  title?: string
  /** Notification body — the user-facing message. */
  body: string
  /** Path to navigate to on notification click. Defaults to "/". */
  url?: string
}

/**
 * Cancel every scheduled push notification for a parking session.
 *
 * Called when the user signals "I've left" before parking expires — pushes
 * for that session would otherwise still fire at their scheduled times,
 * which would be annoying ("30 min until your parking expires" arriving
 * after the car's already gone).
 *
 * Best-effort: never throws. The end-session path can ignore the result,
 * since the local "ended_at" stamp is the source of truth. Screens that
 * manage reminders must check it: only `ok` means the schedules are gone.
 *
 * NOTE: not gated by `hasActiveSubscription()` — even if the user's
 * subscription has rotated/expired since they scheduled, the schedules
 * themselves still exist server-side and we want them gone.
 *
 * Push schedules belong to the device that created them: the server cancels
 * only when this device's id matches the one stored with each schedule
 * (`not_owner` from a 403 ERR_NOT_OWNER, and nothing changes). A browser
 * with no device id owns no schedules, so no request is sent (`no_device`).
 */
export async function cancelPushReminders(session_id: string): Promise<PushCancelResult> {
  if (typeof fetch === 'undefined') return { ok: false, reason: 'network' }
  const device_id = peekDeviceId()
  if (!device_id) return { ok: false, reason: 'no_device' }
  const reply = await pushPost('/push/cancel', { device_id, session_id })
  if (reply.kind === 'timeout') {
    console.error('[push] cancel timed out')
    return { ok: false, reason: 'network' }
  }
  if (reply.kind === 'error') {
    console.error('[push] cancel threw:', reply.error)
    return { ok: false, reason: 'network' }
  }
  if (!reply.ok) {
    if (isNotOwnerReply(reply)) return { ok: false, reason: 'not_owner' }
    console.error('[push] cancel failed:', reply.status)
    return { ok: false, reason: 'network' }
  }
  if (!reply.body || typeof reply.body !== 'object') {
    console.error('[push] cancel answered without a body')
    return { ok: false, reason: 'network' }
  }
  const deleted = (reply.body as { deleted?: unknown }).deleted
  return { ok: true, deleted: typeof deleted === 'number' ? deleted : 0 }
}

export interface ScheduledFire {
  /** Server-side schedule name (parkproof-push-<session_id>-<slot>). */
  name: string
  /** ISO 8601 timestamp when EventBridge will fire. */
  fire_at: string
}

type ScheduleAttempt =
  | { kind: 'ok'; created: ScheduledFire[]; skipped: number }
  | { kind: 'not_owner' | 'not_subscribed' | 'network' }

/** One POST to /push/schedule. Never throws. */
async function postSchedule(payload: unknown): Promise<ScheduleAttempt> {
  const reply = await pushPost('/push/schedule', payload)
  if (reply.kind === 'timeout') {
    console.error('[push] schedule timed out')
    return { kind: 'network' }
  }
  if (reply.kind === 'error') {
    console.error('[push] schedule threw:', reply.error)
    return { kind: 'network' }
  }
  if (!reply.ok) {
    const code = errorCodeOf(reply.body)
    if (reply.status === 403 && code === 'ERR_NOT_OWNER') return { kind: 'not_owner' }
    if (reply.status === 409 && code === ERR_NOT_SUBSCRIBED) return { kind: 'not_subscribed' }
    console.error('[push] schedule failed:', reply.status)
    return { kind: 'network' }
  }
  if (!reply.body || typeof reply.body !== 'object') {
    console.error('[push] schedule answered without a body')
    return { kind: 'network' }
  }
  const result = reply.body as {
    created?: Array<{ name?: unknown; fire_at?: unknown }>
    skipped?: unknown[]
  }
  // Defensive shape narrowing: the server's contract is {created: [{name, fire_at}], skipped: [...]}
  // but a future Lambda change could rearrange. Filter to entries that
  // actually have both fields rather than passing through garbage.
  const created: ScheduledFire[] = (Array.isArray(result.created) ? result.created : [])
    .filter(
      (c): c is { name: string; fire_at: string } =>
        typeof c?.name === 'string' && typeof c?.fire_at === 'string',
    )
    .map((c) => ({ name: c.name, fire_at: c.fire_at }))
  const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0
  return { kind: 'ok', created, skipped }
}

/**
 * Schedule a batch of push notifications for a saved record.
 *
 * Server-side semantics: REPLACE-ALL. /push/schedule first deletes every
 * existing schedule for the given session_id, then creates the new set.
 * The one exception: a schedule due within 30 s that the new set still
 * asks for is left in place (it can't be booked again that late) and comes
 * back in `created`. Callers wanting to ADD or REMOVE a single reminder
 * pass the full desired union/difference, not just the delta.
 *
 * Before booking it re-sends this browser's registration to the server
 * (skipped when one went out in the last minute), so a server that forgot
 * the device learns it again. If the server still answers 409
 * ERR_NOT_SUBSCRIBED, it registers once more and retries once.
 *
 * Never throws. Only `ok` means reminders were booked. Every other result
 * is a failure the caller must show: `not_subscribed` (no subscription in
 * this browser, or the server refused it even after the retry) is NOT a
 * quiet skip, because a reminder that can't be sent is worse than none.
 * `not_owner` (403 ERR_NOT_OWNER) means another device created this
 * record's schedules and nothing changed.
 */
export async function schedulePushReminders(
  session_id: string,
  reminders: ScheduledReminder[],
  /** The session's parking expiry. Lets the server give each push a TTL
   *  that ends shortly after the parking does. Null for no-sign sessions. */
  expires_at: string | null = null,
): Promise<PushScheduleResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }
  const subscribed = await hasActiveSubscription()
  if (!subscribed) return { ok: false, reason: 'not_subscribed' }
  // The server rejects an empty reminders[] with a 400, so short-circuit.
  // Removing the last reminder uses /push/cancel instead.
  if (reminders.length === 0) return { ok: true, created: [], skipped: 0 }

  // Re-send the registration before booking (fix list item 1). A failure
  // here isn't final: the server decides below. No answer in time is: the
  // booking would only wait out another timeout on the same weak signal.
  if ((await syncPushRegistration({ maxAgeMs: REGISTRATION_FRESH_FOR_BOOKING_MS })) === 'timeout') {
    return { ok: false, reason: 'network' }
  }

  let device_id: string
  try {
    device_id = getOrCreateDeviceId()
  } catch (err) {
    console.error('[push] no device id (storage blocked):', err)
    return { ok: false, reason: 'network' }
  }
  const payload = { device_id, session_id, reminders, expires_at }
  let attempt = await postSchedule(payload)
  if (attempt.kind === 'not_subscribed') {
    // The server has no live registration for this device. Register once
    // more (ignoring the recent-send skip) and retry once.
    clearRegistrationSent()
    const resent = await syncPushRegistration()
    if (resent === 'timeout') return { ok: false, reason: 'network' }
    if (resent !== 'sent') return { ok: false, reason: 'not_subscribed' }
    attempt = await postSchedule(payload)
  }
  switch (attempt.kind) {
    case 'ok':
      return { ok: true, created: attempt.created, skipped: attempt.skipped }
    case 'not_owner':
      return { ok: false, reason: 'not_owner' }
    case 'not_subscribed':
      console.error('[push] schedule refused: the server has no registration for this device')
      return { ok: false, reason: 'not_subscribed' }
    default:
      return { ok: false, reason: 'network' }
  }
}
