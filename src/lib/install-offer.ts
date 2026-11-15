// "Install ParkProof" on Android Chrome, Edge and Samsung Internet
// (InstallPromptBanner, on Home). Those browsers fire `beforeinstallprompt`
// once the page meets their install criteria, which can happen before Home
// is on screen (a reminder tap opens a record, a scan is in progress). So
// the event is caught here from startup (main.tsx) and kept until Home
// offers it. Catching it (preventDefault) also stops the browser's own
// mini-infobar; the browser menu's Install app stays.
//
// The offer used to float over every screen, fixed to the bottom, where it
// covered each screen's bottom buttons (Translate, Done) until it was closed.
// It now sits in Home's own flow and nowhere else.

/** Set once the offer was dismissed or ParkProof installed, so it isn't offered again. */
export const INSTALL_DISMISSED_KEY = 'parkproof.install-dismissed.v1'

/** The standard event shape (Chromium only; TypeScript doesn't ship the type). */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: ReadonlyArray<string>
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
/**
 * The driver closed the offer during this visit. Kept in memory as well as
 * under INSTALL_DISMISSED_KEY, so the close still works when that write
 * fails. Module state: the next visit (a page load) starts it at false.
 */
let dismissedThisVisit = false
/**
 * The driver declined the browser's dialog during this visit. The browser can
 * offer again straight after. That event is still caught (so no infobar), but
 * Home doesn't offer it until the next visit, which starts this at false.
 */
let declinedThisVisit = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function isDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function rememberDismissed(): void {
  try {
    localStorage.setItem(INSTALL_DISMISSED_KEY, '1')
  } catch {
    // Private mode or a full quota: nothing is stored, so the offer can come
    // back on a later visit. A close still holds for this visit
    // (dismissedThisVisit), and the browser stops offering once ParkProof is
    // installed.
  }
}

/**
 * Catch `beforeinstallprompt` and `appinstalled` on `target` from now on.
 * main.tsx calls it once, before the first render. Returns the remover.
 */
export function listenForInstallOffer(target: Window = window): () => void {
  const onBeforeInstallPrompt = (event: Event) => {
    // Every event is caught, a decline's follow-up too, so the browser's
    // infobar stays away. installOfferAvailable decides whether Home offers it.
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    emit()
  }
  const onAppInstalled = () => {
    deferred = null
    rememberDismissed()
    emit()
  }
  target.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  target.addEventListener('appinstalled', onAppInstalled)
  return () => {
    target.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    target.removeEventListener('appinstalled', onAppInstalled)
  }
}

/** For useSyncExternalStore: call `listener` whenever the offer comes or goes. */
export function subscribeInstallOffer(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Is there an install to offer: the browser gave its prompt, the driver
 * hasn't closed the offer or installed ParkProof, and hasn't declined the
 * browser's dialog during this visit?
 */
export function installOfferAvailable(): boolean {
  return deferred !== null && !dismissedThisVisit && !declinedThisVisit && !isDismissed()
}

/**
 * Show the browser's install dialog. Accepted: not offered again. Declined:
 * gone for the rest of this visit, even when the browser offers again at
 * once, and offered again on a later visit. A prompt can be used once, so
 * the offer goes either way. When the dialog can't be shown at all, the
 * offer goes too, and comes back only if the browser offers again.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred
  if (!event) return 'unavailable'
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'accepted') rememberDismissed()
    else if (outcome === 'dismissed') declinedThisVisit = true
    return outcome
  } catch (err) {
    // prompt() throws when the event was already used, or the browser is in
    // a state it doesn't expect. The browser menu's Install app still works.
    console.warn('[install-offer] prompt() failed:', err)
    return 'unavailable'
  } finally {
    deferred = null
    emit()
  }
}

/**
 * The driver closed the offer: never offer it again on this browser. When
 * the browser can't store that, it still stays closed for this visit.
 */
export function dismissInstallOffer(): void {
  dismissedThisVisit = true
  rememberDismissed()
  emit()
}

/** Test hook, as a page load would: forget the caught event and this visit's close and decline. */
export function resetInstallOfferForTests(): void {
  deferred = null
  dismissedThisVisit = false
  declinedThisVisit = false
  emit()
}
