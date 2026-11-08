/**
 * Small platform checks for the reminder screens. Each one guards for a
 * missing window or navigator (tests, prerender) and answers false there.
 */

/** iPhone, iPad or iPod, in any browser (they all run WebKit). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return (
    /iP(hone|ad|od)/.test(ua) ||
    // iPadOS 13+ reports as a Mac but is touch-capable.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** Android, in any browser. */
export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent || '')
}

/** Running as an installed app (Home Screen on iOS, installed PWA elsewhere). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return (
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
      (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
    )
  } catch {
    return false
  }
}

/**
 * An iPhone or iPad browser tab. Apple only allows web notifications (in-tab
 * or push) for a site added to the Home Screen and opened from there.
 */
export function isIosBrowserTab(): boolean {
  return isIos() && !isStandalone()
}
