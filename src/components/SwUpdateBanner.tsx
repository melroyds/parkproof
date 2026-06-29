import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Service-worker update banner.
 *
 * Problem: vite-plugin-pwa runs in `autoUpdate` mode, which means a new SW
 * activates seamlessly the next time a user closes + reopens the tab. But
 * users who keep ParkProof open as a PWA (and many will — the active-
 * session card is meant to be glanceable) can stay on the OLD shell for
 * hours/days, missing post-deploy fixes. The `vite:preloadError` handler
 * in main.tsx catches the loud failure case (lazy chunk 404s after a
 * deploy), but doesn't catch the silent case where the cached shell
 * keeps working without ever attempting to load a new chunk.
 *
 * Fix: subscribe to the SW's `updatefound` event. When a new worker
 * finishes installing AND a controller already exists (= this isn't the
 * first install), a real update has shipped — surface a small "New
 * version — refresh" pill at the bottom. One tap = `location.reload()`,
 * which the now-active new SW serves with fresh chunks.
 *
 * Bottom-center placement (not top) keeps it out of the LanguageSelector
 * + nav real estate at the top. Dismissable for the rare case where the
 * user explicitly doesn't want to interrupt their session — banner stays
 * dismissed until the NEXT update lands (every fresh updatefound event
 * resets visibility).
 *
 * No localStorage flag — we WANT this to reappear on every new deploy.
 * Unlike the language-detect chip (one-time onboarding nudge), the
 * update banner is an ongoing-relevance signal.
 */
export default function SwUpdateBanner() {
  const { t } = useTranslation()
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    let cancelled = false

    navigator.serviceWorker.ready
      .then((registration) => {
        if (cancelled) return

        // `updatefound` fires when a new SW starts installing — could be
        // the initial install (no prior controller) or a real update
        // (prior controller exists). We only show the banner in the
        // second case, otherwise first-time visitors get a confusing
        // "refresh" prompt before they've even used the app.
        const onUpdateFound = () => {
          const newWorker = registration.installing
          if (!newWorker) return
          const onStateChange = () => {
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // A new SW finished installing while another one was already
              // controlling this page → real update. Show banner + reset
              // dismissed (so a user who dismissed an earlier update sees
              // the new one).
              setUpdateAvailable(true)
              setDismissed(false)
            }
          }
          newWorker.addEventListener('statechange', onStateChange)
        }

        registration.addEventListener('updatefound', onUpdateFound)
      })
      .catch((err) => {
        // navigator.serviceWorker.ready never rejects in normal flow, but
        // be defensive — a hardened browser or extension could break it.
        console.warn('[sw-update] serviceWorker.ready failed:', err)
      })

    return () => {
      cancelled = true
      // No explicit removeEventListener — `ready` resolves once per
      // mount and the listener captures the registration; unmounting
      // the whole component is rare (it lives at root). Acceptable.
    }
  }, [])

  if (!updateAvailable || dismissed) return null

  const handleRefresh = () => {
    // Hard reload — bypasses HTTP cache and forces the new SW to take
    // control of the next page navigation. The SW has already activated
    // by this point (autoUpdate + skipWaiting), so the new shell is
    // ready; we just need the browser to navigate to it.
    window.location.reload()
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-1.5rem)]">
      <div className="bg-brand-600 text-white rounded-full border border-brand-900/10 shadow-sm px-4 py-2.5 flex items-center gap-3 text-sm whitespace-nowrap">
        <span className="font-semibold">{t('swUpdate.available')}</span>
        <button
          type="button"
          onClick={handleRefresh}
          className="bg-white text-brand-700 hover:bg-brand-50 active:bg-brand-100 font-semibold rounded-full px-3 py-1 text-xs transition-colors"
        >
          {t('swUpdate.refresh')}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t('common.close')}
          className="text-brand-100 hover:text-white leading-none text-base min-w-[44px] min-h-[44px] inline-flex items-center justify-center -my-2.5"
        >
          ×
        </button>
      </div>
    </div>
  )
}
