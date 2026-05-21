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
