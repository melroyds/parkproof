import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * iOS "Add to Home Screen" hint.
 *
 * Android/Chrome installs are handled by InstallPromptBanner via the
 * `beforeinstallprompt` event, but iOS Safari never fires that event, so the
 * largest mobile cohort among Australian drivers was never told how to install,
 * losing the offline / reminders / fast-recheck retention loop. This surfaces a
 * one-time, dismissible hint pointing at Share -> Add to Home Screen.
 *
 * Shown only when: iOS Safari, not already installed (standalone), and not
 * previously dismissed.
 *
 * Home renders it in its own flow, under the menu. It used to float over
 * every screen, fixed to the bottom, where it covered each screen's bottom
 * buttons until it was dismissed.
 */
export const IOS_INSTALL_HINT_DISMISSED_KEY = 'parkproof.iosInstallHint.dismissed'

/**
 * "Got it" was tapped during this visit. Home mounts the hint again on every
 * return, so this keeps it closed for the visit even when the storage write
 * failed. A page load starts it at false.
 */
let dismissedThisVisit = false

/** Test hook, as a page load would: forget a "Got it" from this visit. */
// eslint-disable-next-line react-refresh/only-export-components -- a test hook, not a component
export function resetIosInstallHintForTests(): void {
  dismissedThisVisit = false
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const ua = navigator.userAgent
  const isIos =
    /iP(hone|ad|od)/.test(ua) ||
    // iPadOS 13+ reports as a Mac but is touch-capable.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!isIos) return false
  // Add-to-Home-Screen via Share only exists in Safari, not the in-app /
  // alternative-engine iOS browsers (Chrome, Firefox, Edge, Opera on iOS).
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  )
}

function shouldShowHint(): boolean {
  if (dismissedThisVisit) return false
  let dismissed = false
  try {
    dismissed = localStorage.getItem(IOS_INSTALL_HINT_DISMISSED_KEY) === '1'
  } catch {
    /* storage blocked (private mode): treat as not dismissed */
  }
  return !dismissed && isIosSafari() && !isStandalone()
}

export default function IosInstallHint() {
  const { t } = useTranslation()
  // Computed once per mount via a lazy initializer. This is a client-only SPA
  // and the detection helpers guard for a missing window/navigator, so
  // reading the environment during the initial render is safe, and it avoids
  // the setState-in-effect cascade the lint rule (rightly) flags.
  const [show, setShow] = useState(shouldShowHint)

  if (!show) return null

  const dismiss = () => {
    dismissedThisVisit = true
    try {
      localStorage.setItem(IOS_INSTALL_HINT_DISMISSED_KEY, '1')
    } catch {
      /* storage blocked or full: closed for this visit only (dismissedThisVisit) */
    }
    setShow(false)
  }

  return (
    <div className="gf-card w-full mt-4 text-paper-50 pl-5 pr-2 py-3" style={{ background: 'rgba(255,255,255,0.055)' }}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-paper-50 text-sm">
            {t('installPrompt.iosTitle')}
          </p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: '#A9CFBE' }}>
            {t('installPrompt.iosBody')}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 min-h-[44px] py-2.5 inline-flex items-center text-xs font-semibold text-[#7BE3A4] hover:text-paper-50 underline px-2"
        >
          {t('installPrompt.iosDismiss')}
        </button>
      </div>
    </div>
  )
}
