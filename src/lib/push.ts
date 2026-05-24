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

/** Generate or fetch a stable device id (UUID) per browser. Persisted in
 *  localStorage. Used as the partition key for the push-subscriptions
 *  table — keeps the data anonymous (no Cognito sub required). */
function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (id && /^[a-f0-9-]{8,64}$/i.test(id)) return id
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
 * Best-effort: silent failure if push isn't supported or the backend errors.
 * Caller can ignore the return value. The local "ended_at" mutation is the
 * source of truth — server cancel is just user-experience polish.
 *
 * NOTE: not gated by `hasActiveSubscription()` — even if the user's
 * subscription has rotated/expired since they scheduled, the schedules
 * themselves still exist server-side and we want them gone.
 */
export async function cancelPushReminders(
  session_id: string,
): Promise<{ deleted: number } | null> {
  if (typeof fetch === 'undefined') return null
  try {
    const resp = await fetch(endpointUrl('/push/cancel'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id }),
    })
    if (!resp.ok) {
      console.error('[push] cancel failed:', resp.status)
      return null
    }
    const result = (await resp.json()) as { deleted: unknown }
    return {
      deleted: typeof result.deleted === 'number' ? result.deleted : 0,
    }
  } catch (err) {
    console.error('[push] cancel threw:', err)
    return null
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
 * Returns null on any failure (network / unsupported / not subscribed)
 * rather than throwing, so callers can fire-and-forget OR await and persist.
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
): Promise<{ created: ScheduledFire[]; skipped: number } | null> {
  if (!isPushSupported()) return null
  const subscribed = await hasActiveSubscription()
  if (!subscribed) return null
  // Allow the empty case to reach the server — that's how the SessionDetail
  // "remove last reminder" path works (POST with reminders=[] effectively
  // cancels all without using /push/cancel). The server enforces a
  // reminders.length === 0 → 400 guard, so we short-circuit here instead.
  if (reminders.length === 0) return { created: [], skipped: 0 }

  try {
    const resp = await fetch(endpointUrl('/push/schedule'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: getOrCreateDeviceId(),
        session_id,
        reminders,
      }),
    })
    if (!resp.ok) {
      console.error('[push] schedule failed:', resp.status)
      return null
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
    return { created, skipped }
  } catch (err) {
    console.error('[push] schedule threw:', err)
    return null
  }
}
