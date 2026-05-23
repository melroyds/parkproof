/**
 * Service-worker eviction shim — DEPLOYED AT /sw.js
 *
 * This file replaces the old `/sw.js` after the two-app-architecture cutover.
 * It exists for ONE reason: clean up after browsers that registered the old
 * root-scope SW (the one vite-plugin-pwa generated when the React PWA lived
 * at `/`) before we moved the PWA to `/app/`.
 *
 * Without this shim, those browsers would keep the old SW registered, it
 * would intercept fetches to `/`, and serve stale precached HTML from the
 * cache instead of the new marketing landing. The "live" production count
 * of such browsers should be small (~3 friends who tried the POC) but the
 * cost of leaving them broken is "they never see the new site."
 *
 * What this shim does, in order, on every visit:
 *   1. Install immediately (skipWaiting) — no waiting for old tabs to close.
 *   2. On activate: nuke every Cache Storage entry our origin had.
 *   3. Unregister itself so the browser stops invoking us for future fetches.
 *   4. Reload every controlled window so users see the new site immediately
 *      instead of having to refresh manually.
 *
 * After this shim has run once in a browser, that browser is clean — there
 * is no SW registered at scope `/` anymore. New visits to `/app/` will
 * register the new React-app SW with scope `/app/`, no conflict.
 *
 * For brand-new visitors who never had an SW: nothing happens (this file
 * is fetched, parsed, but only runs in browsers where it's being installed
 * AS an update to an existing registration).
 *
 * Lifespan: leave this in place for ~30 days post-cutover. After that,
 * any browser still carrying the old SW has effectively stopped opening
 * the site, so the eviction work is done. Then you can remove this file
 * and let `/sw.js` 404.
 */

self.addEventListener('install', () => {
  // Skip the "waiting" phase. We want the shim active on the first visit
  // post-deploy, not after every old controlled tab closes (which on an
  // installed PWA might be never).
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 1. Wipe every Cache Storage entry. The old workbox precache, any
      //    runtime caches — all gone. This prevents the next page load
      //    from being served from the stale shell.
      try {
        const cacheNames = await caches.keys()
        await Promise.all(cacheNames.map((name) => caches.delete(name)))
      } catch (err) {
        // Storage quota errors, permission errors — log and continue.
        // We still want to unregister even if cache deletion failed.
        console.warn('[sw-shim] cache deletion failed:', err)
      }

      // 2. Unregister this service worker. Browser stops invoking us for
      //    future fetches. Combined with the cache wipe above, the next
      //    page load goes straight to the network like a fresh visitor.
      try {
        await self.registration.unregister()
      } catch (err) {
        console.warn('[sw-shim] self-unregister failed:', err)
      }

      // 3. Force every controlled window to reload. Without this, the user
      //    sees the old cached content from the now-deleted cache one more
      //    time before the unregister takes effect. With it, they see the
      //    new site immediately.
      try {
        const clients = await self.clients.matchAll({
          type: 'window',
          includeUncontrolled: false,
        })
        for (const client of clients) {
          // navigate() preserves the user's current path, which means if
          // they were on `/` (now the marketing landing) they see the
          // marketing landing. If they had an installed PWA opened at
          // start_url `/`, the manifest will redirect them to the new
          // `/app/` on their NEXT cold-launch — the running tab just
          // sees the marketing page for this session.
          if ('navigate' in client) {
            await client.navigate(client.url)
          }
        }
      } catch (err) {
        console.warn('[sw-shim] client reload failed:', err)
      }
    })(),
  )
})

// Fall-through fetch handler: pass everything to the network without
// intercepting. While we're in the brief window between install + activate
// (when this SW briefly controls clients), we don't want to serve from
// the soon-to-be-deleted cache. Plain network fetches are correct.
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
