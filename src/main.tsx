import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/i18n'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { AuthProvider } from './lib/auth-context'
import { listenForInstallOffer } from './lib/install-offer'
import { listenForSwUpdate } from './lib/sw-update'

// The browser's install prompt can come before Home is on screen; catch it
// from the start. Home offers it (InstallPromptBanner).
listenForInstallOffer()
// A new version can install while a scan or a record is on screen, so watch
// for it from the start too. Home offers the reload (SwUpdateBanner), the one
// screen where a reload loses nothing.
listenForSwUpdate()

/**
 * Self-heal on stale-chunk errors after a deploy.
 *
 * When a new build replaces a code-split chunk's hash, the cached
 * index.html in the user's browser still references the OLD hashed
 * filename. Tapping anything that lazy-loads (PDF export, ICS, draft
 * appeal) triggers a dynamic import → 404 → "Failed to fetch
 * dynamically imported module".
 *
 * Vite fires a `vite:preloadError` event for exactly this case. We
 * intercept it, hard-reload the page (bypassing the SW cache), and the
 * user gets the new index.html + new chunk hashes. Costs one extra
 * navigation per deploy window per device, but the alternative is a
 * permanently-broken Export PDF button until the user manually clears
 * cache. The reload is preferable.
 */
window.addEventListener('vite:preloadError', () => {
  // Pass a cache-busting query so HTTP caches between the user and S3
  // also miss; the SW takeover handles the rest.
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      {/* Top-level boundary: turns a full-tree render crash into a friendly,
          reloadable fallback instead of a blank white screen. */}
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
      {/* Nothing floats over the screens from here. The update card
          (SwUpdateBanner) and the install offers (InstallPromptBanner,
          IosInstallHint) are on Home, in its own flow. Fixed here, they
          covered every screen's bottom buttons until closed, and the update
          pill's Refresh reloaded the page mid-flow, which lost the work on
          screen (a scan result, a record being logged, an appeal draft). */}
    </AuthProvider>
  </StrictMode>,
)
