/// <reference lib="webworker" />
/**
 * Custom service worker. Replaces the auto-generated Workbox SW so we can
 * handle `push` and `notificationclick` events — vite-plugin-pwa's
 * `generateSW` strategy doesn't expose those event hooks.
 *
 * Two responsibilities:
 *   1. Precache the build manifest (same behaviour the auto-SW had)
 *   2. Handle Web Push events — render the notification + route the click
 *
 * The Workbox `precacheAndRoute` call below uses `self.__WB_MANIFEST`,
 * which vite-plugin-pwa's `injectManifest` plugin replaces at build-time
 * with the actual list of precachable assets. Keep the literal string —
 * the plugin looks for it.
 */
import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ revision: string | null; url: string }>
}

precacheAndRoute(self.__WB_MANIFEST)

// ─── Web Push event handler ─────────────────────────────────────────────
// Payload shape (server-side, see scripts/send-test-push.mjs):
//   { title: string, body: string, url?: string, tag?: string }
//
// Until the scheduling layer ships, the only sender is the manual test
// script. Once the schedule layer is in, ReminderOptions saves fire-at
// timestamps and an EventBridge-driven Lambda dispatches the push with
// session-specific copy.
self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) {
    // Browser shouldn't deliver dataless pushes when userVisibleOnly is set,
    // but guard anyway — better a generic notification than a silent failure
    // that could trigger Chrome's auto-unsubscribe behaviour.
    event.waitUntil(
      self.registration.showNotification('ParkProof', {
        body: 'You have an update.',
        // Relative paths — Notification.icon resolves against the SW's
        // own URL (/app/service-worker.js), so 'pwa-192x192.png' becomes
        // /app/pwa-192x192.png. Leading-slash absolute paths would 404
        // after the two-app cutover.
        icon: 'pwa-192x192.png',
        badge: 'pwa-64x64.png',
      }),
    )
    return
  }

  let payload: { title?: string; body?: string; url?: string; tag?: string } = {}
  try {
    payload = event.data.json() as typeof payload
  } catch {
    // Non-JSON payload (shouldn't happen from our sender, but be resilient).
    payload = { title: 'ParkProof', body: event.data.text() }
  }

  const title = payload.title || 'ParkProof'
  const options: NotificationOptions = {
    body: payload.body || '',
    // Relative paths — see comment above. Resolves to /app/pwa-*.png
    // because the SW lives at /app/service-worker.js post-cutover.
    icon: 'pwa-192x192.png',
    badge: 'pwa-64x64.png',
    // tag collapses repeat notifications for the same parking session —
    // when the schedule layer fires 30/15/5/0-min reminders, each replaces
    // the previous so the user's notification tray doesn't fill up.
    tag: payload.tag || 'parkproof',
    // data carries the click-through URL into the notificationclick handler.
    data: { url: payload.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ─── Notification click handler ─────────────────────────────────────────
// Opens (or focuses) the app at the URL embedded in the notification's
// data. If a ParkProof tab is already open, focus it instead of spawning
// a new one — feels much less janky on mobile.
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const url =
    (event.notification.data as { url?: string } | undefined)?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Prefer focusing an existing ParkProof window. matchAll returns
      // every window-client; pick the first that matches our origin.
      for (const client of clients) {
        if ('focus' in client) {
          // If they click while looking at a different page in the same
          // origin, navigate to the notification's target URL.
          if (client.url !== url && 'navigate' in client) {
            return (client as WindowClient).navigate(url).then((c) => c?.focus())
          }
          return (client as WindowClient).focus()
        }
      }
      // No existing window — open a new one.
      if (self.clients.openWindow) {
        return self.clients.openWindow(url)
      }
      return undefined
    }),
  )
})

// Activate immediately on update — no stale "old SW still running" state
// when we ship the schedule-layer changes later.
self.addEventListener('install', () => {
  self.skipWaiting()
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
