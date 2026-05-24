import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'

/**
 * Android / Chrome PWA install prompt — surfaces the browser's native
 * "Install ParkProof" affordance via the `beforeinstallprompt` event.
 *
 * What this fixes:
 *   - Chrome desktop + Android Chrome / Edge / Samsung Internet fire
 *     `beforeinstallprompt` when a PWA meets the installability criteria
 *     (manifest + SW + served over HTTPS + visited at least twice with
 *     30s+ engagement). Without intercepting it, the browser shows a
 *     small mini-infobar at the bottom of the address-bar area — a
 *     visual element ~80% of users ignore because they don't recognise
 *     it as "you can install this app."
 *   - By calling event.preventDefault() in the listener, we hide the
 *     default infobar AND keep the event object live so we can fire it
 *     ourselves from a clearly-branded CTA.
 *
 * iOS Safari does NOT fire this event (Apple's limitation). iOS users
 * still install via Share → Add to Home Screen, but there's no
 * programmatic API and we don't have device access to verify the
 * hand-rolled iOS hint UX. iOS Safari users get nothing from this
 * component — acceptable. The Android / Chrome path is the larger
 * surface area anyway (~70% of mobile web traffic in AU).
 *
 * Lifecycle:
 *   1. On mount, listen for `beforeinstallprompt`. preventDefault + cache
 *      the event in state. This unlocks the banner.
 *   2. On `appinstalled` event (fires after a successful install), hide
 *      the banner permanently for this session — no point offering to
 *      install an already-installed app.
 *   3. Also check localStorage `parkproof.install-dismissed.v1` so users
 *      who explicitly close the banner don't see it again.
 *   4. Tapping Install → call event.prompt() → wait for userChoice.
 *      If accepted, the browser installs the PWA; if dismissed, hide
 *      the banner for this session (next visit will re-offer).
 *
 * Placement: bottom-center, fixed, same pattern as SwUpdateBanner.
 * Higher z-index than the SW banner so a fresh-deploy + installable
 * combination doesn't visually conflict (the SW banner takes priority).
 */

const DISMISSED_KEY = 'parkproof.install-dismissed.v1'

/**
 * The standard event shape. TypeScript doesn't ship this type yet (the
 * `beforeinstallprompt` event is a non-standardised Chromium API), so we
 * declare what we actually use.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function InstallPromptBanner() {
  const { t } = useTranslation()
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return localStorage.getItem(DISMISSED_KEY) === '1'
    } catch {
      return false
    }
  })
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const onBeforeInstallPrompt = (e: Event) => {
      // Stop the default mini-infobar — we want our own clearly-branded UI.
      e.preventDefault()
      // Type assertion: the event IS a BeforeInstallPromptEvent on supporting
      // browsers; TS just doesn't know that. We narrow defensively before
      // calling .prompt() so a future spec change doesn't crash.
      setDeferred(e as BeforeInstallPromptEvent)
    }

    const onAppInstalled = () => {
      // Fires once after a successful install. The user no longer needs the
      // banner — clear the event reference + remember they're installed.
      setDeferred(null)
      try {
        localStorage.setItem(DISMISSED_KEY, '1')
      } catch {
        // Private mode or quota — degrade silently. Banner will re-offer
        // next session, which is harmless on an already-installed app
        // because the browser won't re-fire beforeinstallprompt.
      }
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // Same fallback as above — ephemeral dismissal is fine.
    }
    setDismissed(true)
  }

  const handleInstall = async () => {
    if (!deferred || installing) return
    setInstalling(true)
    try {
      await deferred.prompt()
      const { outcome } = await deferred.userChoice
      if (outcome === 'accepted') {
        // appinstalled will fire shortly; clear locally too in case the
        // event lags.
        setDeferred(null)
        try {
          localStorage.setItem(DISMISSED_KEY, '1')
        } catch {
          // ignore
        }
      } else {
        // User explicitly declined → respect that for this session,
        // re-offer on a future visit (don't write to localStorage).
        setDeferred(null)
      }
    } catch (err) {
      // .prompt() can throw if the event has been consumed already or if
      // the user is in an installation state that Chrome doesn't expect.
      // Worst case the user falls back to the browser's own menu.
      console.warn('[install-prompt] prompt() failed:', err)
      setDeferred(null)
    } finally {
      setInstalling(false)
    }
  }

  // Nothing to do if the browser never fired the event (iOS Safari, already
  // installed, Firefox, etc.) OR the user explicitly dismissed.
  if (!deferred || dismissed) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-[calc(100vw-1.5rem)]">
      <div className="bg-ink-900 text-white rounded-full shadow-xl shadow-ink-900/30 px-4 py-2.5 flex items-center gap-3 text-sm whitespace-nowrap">
        <Icon name="bell" className="w-4 h-4 text-brand-300 shrink-0" />
        <span className="font-semibold">{t('installPrompt.available')}</span>
        <button
          type="button"
          onClick={handleInstall}
          disabled={installing}
          className="bg-brand-500 hover:bg-brand-600 active:bg-brand-700 disabled:opacity-50 text-white font-semibold rounded-full px-3 py-1 text-xs transition-colors"
        >
          {installing ? t('installPrompt.installing') : t('installPrompt.install')}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('common.close')}
          className="text-ink-400 hover:text-white leading-none text-base px-1"
        >
          ×
        </button>
      </div>
    </div>
  )
}
