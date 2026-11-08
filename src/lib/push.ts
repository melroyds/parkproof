// Web Push subscription helpers.
//
// FOUNDATION ONLY tonight: this file handles the SUBSCRIBE side — getting
// a PushSubscription from the browser and persisting it to our backend.
//
// What's NOT here yet (deferred to next session):
//   - The service-worker push event handler (until that ships, pushes show
//     as the browser's default "site updated" notification, not branded
//     ParkProof copy)
//   - The dispatch / scheduling layer (no automatic firing of pushes at
//     parking-expiry times yet — manual curl is the only way to fire one)
//   - i18n for the user-facing copy
//
// Once Reminders are wired up the user-facing flow will be: pick reminder
// offsets → app asks for notification permission → SW push event renders
// a nice notification at fire-time. Tonight it's just the plumbing.

import { endpointUrl } from './api'

const DEVICE_ID_KEY = 'parkproof.device_id.v1'

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
    const reg = await navigator.serviceWorker.ready
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
  /** Reason the subscribe didn't succeed — for UI display. */
  reason?: 'unsupported' | 'denied' | 'no_vapid' | 'subscribe_failed' | 'network'
  /** The active subscription, if ok. */
  subscription?: PushSubscription
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

  // Get a SW registration. vite-plugin-pwa registers one at root scope —
  // navigator.serviceWorker.ready resolves to it once active.
  const reg = await navigator.serviceWorker.ready

  // Create a push subscription. userVisibleOnly: true is mandatory — the
  // user must see a notification for every push (browsers enforce this).
  let subscription: PushSubscription
  try {
    // Re-use an existing subscription if one's already on this registration.
    const existing = await reg.pushManager.getSubscription()
    subscription =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      }))
  } catch (err) {
    console.error('[push] subscribe failed:', err)
    return { ok: false, reason: 'subscribe_failed' }
  }

  // Persist to backend. Use the subscription's toJSON() to get the wire
  // shape (endpoint + keys.p256dh + keys.auth as base64 strings).
  const json = subscription.toJSON() as {
    endpoint: string
    keys: { p256dh: string; auth: string }
  }
  try {
    const resp = await fetch(endpointUrl('/push/subscribe'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: getOrCreateDeviceId(),
        subscription: {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        },
      }),
    })
    if (!resp.ok) {
      console.error('[push] backend persist failed:', resp.status)
      return { ok: false, reason: 'network', subscription }
    }
  } catch (err) {
    console.error('[push] backend persist threw:', err)
    return { ok: false, reason: 'network', subscription }
  }

  return { ok: true, subscription }
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
 * gateway and the dispatch Lambda's existing reaper deletes the DDB row,
 * so the cloud subscription record self-cleans without a dedicated
 * /push/unsubscribe endpoint. Acceptable lag — at most one stale-push
 * attempt before the row goes away.
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
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return false
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
 *   - unsupported / not_subscribed: push can't run on this browser right now.
 *   - network: offline, or any other server failure. A retry may work.
 */
export type PushFailureReason = 'not_owner' | 'no_device' | 'unsupported' | 'not_subscribed' | 'network'

export type PushCancelResult =
  | { ok: true; deleted: number }
  | { ok: false; reason: Extract<PushFailureReason, 'not_owner' | 'no_device' | 'network'> }

export type PushScheduleResult =
  | { ok: true; created: ScheduledFire[]; skipped: number }
  | { ok: false; reason: Extract<PushFailureReason, 'not_owner' | 'unsupported' | 'not_subscribed' | 'network'> }

/** True when a failed response is the server's 403 ERR_NOT_OWNER. */
async function isNotOwnerResponse(resp: Response): Promise<boolean> {
  if (resp.status !== 403) return false
  try {
    const body = (await resp.json()) as { error?: unknown }
    return body?.error === 'ERR_NOT_OWNER'
  } catch {
    return false
  }
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
  try {
    const resp = await fetch(endpointUrl('/push/cancel'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id, session_id }),
    })
    if (!resp.ok) {
      if (await isNotOwnerResponse(resp)) return { ok: false, reason: 'not_owner' }
      console.error('[push] cancel failed:', resp.status)
      return { ok: false, reason: 'network' }
    }
    const result = (await resp.json()) as { deleted: unknown }
    return {
      ok: true,
      deleted: typeof result.deleted === 'number' ? result.deleted : 0,
    }
  } catch (err) {
    console.error('[push] cancel threw:', err)
    return { ok: false, reason: 'network' }
  }
}

/**
 * Schedule a batch of push notifications for a saved session.
 *
 * Server-side semantics: REPLACE-ALL. /push/schedule first deletes every
 * existing schedule for the given session_id, then creates the new set.
 * Callers wanting to ADD or REMOVE a single reminder pass the full desired
 * union/difference, not just the delta.
 *
 * Never throws. Returns `{ ok: false, reason }` on any failure, so callers
 * can fire-and-forget OR await and persist. `not_owner` (403 ERR_NOT_OWNER)
 * means another device created this record's schedules and nothing changed.
 *
 * Best-effort by default — when push isn't subscribed, the call is skipped
 * silently because the .ics + in-tab paths still fire from the same caller.
 * The first caller (ReminderOptions, initial set) doesn't need the return
 * value. Newer callers (SessionDetail add/remove) DO — they need the
 * created[] fire_at list so they can persist the truth back to the session
 * for display in the "Scheduled reminders" section.
 */
export interface ScheduledFire {
  /** Server-side schedule name (parkproof-push-<session_id>-<slot>). */
  name: string
  /** ISO 8601 timestamp when EventBridge will fire. */
  fire_at: string
}

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
  // Allow the empty case to reach the server — that's how the SessionDetail
  // "remove last reminder" path works (POST with reminders=[] effectively
  // cancels all without using /push/cancel). The server enforces a
  // reminders.length === 0 → 400 guard, so we short-circuit here instead.
  if (reminders.length === 0) return { ok: true, created: [], skipped: 0 }

  try {
    const resp = await fetch(endpointUrl('/push/schedule'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: getOrCreateDeviceId(),
        session_id,
        reminders,
        expires_at,
      }),
    })
    if (!resp.ok) {
      if (await isNotOwnerResponse(resp)) return { ok: false, reason: 'not_owner' }
      console.error('[push] schedule failed:', resp.status)
      return { ok: false, reason: 'network' }
    }
    const result = (await resp.json()) as {
      created?: Array<{ name?: unknown; fire_at?: unknown }>
      skipped?: unknown[]
    }
    // Defensive shape narrowing — the server's contract is {created: [{name, fire_at}], skipped: [...]}
    // but a future Lambda change could rearrange. Filter to entries that
    // actually have both fields rather than passing through garbage.
    const created: ScheduledFire[] = (result.created ?? [])
      .filter(
        (c): c is { name: string; fire_at: string } =>
          typeof c?.name === 'string' && typeof c?.fire_at === 'string',
      )
      .map((c) => ({ name: c.name, fire_at: c.fire_at }))
    const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0
    return { ok: true, created, skipped }
  } catch (err) {
    console.error('[push] schedule threw:', err)
    return { ok: false, reason: 'network' }
  }
}
