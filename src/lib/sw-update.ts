// "New version available" (SwUpdateBanner, on Home). ParkProof's service
// worker updates itself: vite-plugin-pwa registers it in autoUpdate mode and
// the worker calls skipWaiting and clients.claim, so the next time the app
// opens it runs the new version. A driver who keeps the installed app open
// can stay on the old version for hours or days, though, and miss the fixes
// a deploy shipped. (The vite:preloadError handler in main.tsx only catches
// the loud case, a lazy chunk that is gone.)
//
// So this watches for a new version installing over the one that runs this
// page, from startup (main.tsx), and keeps the news until Home offers the
// reload. The offer used to float over every screen, fixed to the bottom,
// where it covered each screen's bottom buttons, and its Refresh threw away
// whatever was on screen (a scan result, a record being logged, an appeal
// draft). It now sits in Home's own flow and nowhere else.

/** The parts of a service worker this module reads. */
export interface SwUpdateWorker extends EventTarget {
  readonly state: ServiceWorkerState
}

/** The parts of a ServiceWorkerRegistration this module reads. */
export interface SwUpdateRegistration extends EventTarget {
  readonly installing: SwUpdateWorker | null
  readonly waiting: SwUpdateWorker | null
}

/** The parts of navigator.serviceWorker this module reads, so a test can hand in a fake. */
export interface SwUpdateContainer {
  /** The worker that runs this page. Null on the first install, and after a hard reload. */
  readonly controller: object | null
  readonly ready: Promise<SwUpdateRegistration>
}

/** A new version finished installing while an earlier one ran this page. */
let updateReady = false
/**
 * The driver closed the card. It holds until the next update and is never
 * stored, so every new version is offered. A page load starts it at false.
 */
let dismissed = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/** A new version is in: offer it, even when the card for an earlier one was closed. */
function markUpdateReady(): void {
  updateReady = true
  dismissed = false
  emit()
}

/**
 * navigator.serviceWorker, or null where there is none (an older browser, a
 * page not served over https). Reading it can throw (Firefox does when site
 * data is blocked), and main.tsx calls this before the first render, so a
 * throw here must never stop the app from starting.
 */
function browserContainer(): SwUpdateContainer | null {
  try {
    return (typeof navigator !== 'undefined' && navigator.serviceWorker) || null
  } catch (err) {
    console.warn('[sw-update] navigator.serviceWorker failed:', err)
    return null
  }
}

/**
 * Watch for a new version from now on. main.tsx calls it once, before the
 * first render, with navigator.serviceWorker. Returns the remover.
 */
export function listenForSwUpdate(container: SwUpdateContainer | null = browserContainer()): () => void {
  if (!container) return () => {}
  let stopped = false
  let detach = () => {}

  // A new worker finished installing while another one runs this page: a
  // real update. With no controller it is the first install, and a
  // first-time visitor has nothing to refresh.
  const watch = (worker: SwUpdateWorker | null) => {
    if (!worker) return
    worker.addEventListener('statechange', () => {
      if (!stopped && worker.state === 'installed' && container.controller) markUpdateReady()
    })
  }

  container.ready
    .then((registration) => {
      if (stopped) return
      const onUpdateFound = () => watch(registration.installing)
      registration.addEventListener('updatefound', onUpdateFound)
      detach = () => registration.removeEventListener('updatefound', onUpdateFound)
      // Listening started late: an update already installed and waiting, or
      // one still installing (its updatefound came before this listener).
      if (registration.waiting && container.controller) markUpdateReady()
      watch(registration.installing)
    })
    .catch((err) => {
      // ready never rejects in the normal course, but a hardened browser or
      // an extension could break it. No card then, and the new version still
      // arrives the next time the app opens.
      console.warn('[sw-update] serviceWorker.ready failed:', err)
    })

  return () => {
    stopped = true
    detach()
  }
}

/** For useSyncExternalStore: call `listener` whenever the card comes or goes. */
export function subscribeSwUpdate(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Is there a new version to offer that the driver hasn't closed the card for? */
export function swUpdateAvailable(): boolean {
  return updateReady && !dismissed
}

/**
 * The driver closed the card: gone until the next update, which offers it
 * again. Nothing is stored, and a page load runs the new version anyway.
 */
export function dismissSwUpdate(): void {
  dismissed = true
  emit()
}

/** Test hook, as a page load would: forget a found update and a close. */
export function resetSwUpdateForTests(): void {
  updateReady = false
  dismissed = false
  emit()
}
