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
 */
const DISMISS_KEY = 'parkproof.iosInstallHint.dismissed'

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
  let dismissed = false
  try {
    dismissed = localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    /* storage blocked (private mode) — treat as not dismissed */
  }
  return !dismissed && isIosSafari() && !isStandalone()
}

export default function IosInstallHint() {
  const { t } = useTranslation()
  // Computed once via a lazy initializer. This is a client-only SPA and the
  // detection helpers guard for a missing window/navigator, so reading the
  // environment during the initial render is safe — and it avoids the
  // setState-in-effect cascade the lint rule (rightly) flags.
  const [show, setShow] = useState(shouldShowHint)

  if (!show) return null

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore — worst case the hint shows again next visit */
    }
    setShow(false)
  }

  return (
    <div className="fixed bottom-4 inset-x-4 z-50 max-w-md mx-auto bg-white border border-brand-900/10 rounded-lg shadow-sm p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-ink-900 text-sm">
            {t('installPrompt.iosTitle')}
          </p>
          <p className="text-xs text-ink-600 mt-1 leading-relaxed">
            {t('installPrompt.iosBody')}
          </p>
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 min-h-[44px] py-2.5 inline-flex items-center text-xs font-semibold text-brand-700 hover:text-brand-800 underline px-2"
        >
          {t('installPrompt.iosDismiss')}
        </button>
      </div>
    </div>
  )
}
