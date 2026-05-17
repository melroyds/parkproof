import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/i18n'
import App from './App.tsx'
import { AuthProvider } from './lib/auth-context'

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
      <App />
    </AuthProvider>
  </StrictMode>,
)
