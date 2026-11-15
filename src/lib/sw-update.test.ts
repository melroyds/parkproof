// @vitest-environment happy-dom
//
// "New version available" (sw-update.ts): a new service worker that finishes
// installing while an earlier one runs the page is an update, and the first
// install is not. An update that installed, or started installing, before
// the listener was on still counts. Closing the card hides it until the next
// update, which offers it again, and nothing is stored. Without service
// worker support, or when the browser refuses it, nothing is offered and
// nothing throws (main.tsx calls this before the first render).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dismissSwUpdate,
  listenForSwUpdate,
  resetSwUpdateForTests,
  subscribeSwUpdate,
  swUpdateAvailable,
} from './sw-update'

/** A service worker as the module sees it: a state, and statechange events. */
class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing'

  /** The browser moves the worker on and tells the page. */
  moveTo(state: ServiceWorkerState): void {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}

/** A registration as the module sees it: its installing and waiting workers, and updatefound. */
class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null
  waiting: FakeWorker | null = null

  /** The browser found a new version and starts installing it. */
  findUpdate(): FakeWorker {
    const worker = new FakeWorker()
    this.installing = worker
    this.dispatchEvent(new Event('updatefound'))
    return worker
  }

  /** The new version finished installing. */
  install(worker: FakeWorker): void {
    this.installing = null
    this.waiting = worker
    worker.moveTo('installed')
  }

  /** A whole deploy: found, then installed. */
  deploy(): FakeWorker {
    const worker = this.findUpdate()
    this.install(worker)
    return worker
  }
}

/** navigator.serviceWorker as the module reads it. `controlled`: an earlier version runs this page. */
function fakeContainer(controlled = true) {
  const registration = new FakeRegistration()
  return {
    registration,
    controller: (controlled ? {} : null) as object | null,
    ready: Promise.resolve(registration),
  }
}

/** Lets `ready` settle, so the listener is on the registration (or the failure is logged). */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

let stop: () => void

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetSwUpdateForTests()
  stop = () => {}
})

afterEach(() => {
  stop()
  resetSwUpdateForTests()
  vi.restoreAllMocks()
})

describe('new version available', () => {
  it('is offered once a new version installs over the one running this page, and listeners are told', async () => {
    const sw = fakeContainer()
    stop = listenForSwUpdate(sw)
    await settle()
    const listener = vi.fn()
    const unsubscribe = subscribeSwUpdate(listener)

    const worker = sw.registration.findUpdate()
    expect(swUpdateAvailable(), 'still installing').toBe(false)
    sw.registration.install(worker)
    expect(swUpdateAvailable()).toBe(true)
    expect(listener).toHaveBeenCalled()

    unsubscribe()
    listener.mockClear()
    dismissSwUpdate()
    expect(listener).not.toHaveBeenCalled()
  })

  it('the first install (nothing runs this page yet) is not offered, even once the new worker takes over', async () => {
    const sw = fakeContainer(false)
    stop = listenForSwUpdate(sw)
    await settle()
    const worker = sw.registration.deploy()
    expect(swUpdateAvailable()).toBe(false)

    // clients.claim: the new worker takes over the page as it activates.
    // That is still the first install, with nothing to refresh.
    sw.controller = worker
    worker.moveTo('activating')
    worker.moveTo('activated')
    expect(swUpdateAvailable()).toBe(false)
  })

  it('an update that installed before the listener was on is offered', async () => {
    const sw = fakeContainer()
    const waiting = new FakeWorker()
    waiting.state = 'installed'
    sw.registration.waiting = waiting
    stop = listenForSwUpdate(sw)
    await settle()
    expect(swUpdateAvailable()).toBe(true)
  })

  it('a waiting worker on a page nothing controls (a hard reload) is not offered', async () => {
    const sw = fakeContainer(false)
    const waiting = new FakeWorker()
    waiting.state = 'installed'
    sw.registration.waiting = waiting
    stop = listenForSwUpdate(sw)
    await settle()
    expect(swUpdateAvailable()).toBe(false)
  })

  it('an update still installing when the listener went on (its updatefound came first) is offered once installed', async () => {
    const sw = fakeContainer()
    const worker = sw.registration.findUpdate()
    stop = listenForSwUpdate(sw)
    await settle()
    expect(swUpdateAvailable()).toBe(false)
    sw.registration.install(worker)
    expect(swUpdateAvailable()).toBe(true)
  })

  it('closing the card hides it until the next update, which offers it again, and stores nothing', async () => {
    const sw = fakeContainer()
    stop = listenForSwUpdate(sw)
    await settle()
    const worker = sw.registration.deploy()
    dismissSwUpdate()
    expect(swUpdateAvailable()).toBe(false)

    // The same worker moving on is the same update: still closed.
    worker.moveTo('activating')
    worker.moveTo('activated')
    expect(swUpdateAvailable()).toBe(false)
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)

    // The next deploy is offered, close or no close.
    sw.registration.deploy()
    expect(swUpdateAvailable()).toBe(true)
  })

  it('once stopped, nothing more is offered: not a found update, an update in flight or a waiting one', async () => {
    const sw = fakeContainer()
    const stopNow = listenForSwUpdate(sw)
    await settle()
    const inFlight = sw.registration.findUpdate()
    stopNow()
    sw.registration.install(inFlight)
    sw.registration.deploy()
    expect(swUpdateAvailable()).toBe(false)

    // Stopped before ready settled: the listener never goes on.
    const late = fakeContainer()
    const waiting = new FakeWorker()
    waiting.state = 'installed'
    late.registration.waiting = waiting
    listenForSwUpdate(late)()
    await settle()
    late.registration.deploy()
    expect(swUpdateAvailable()).toBe(false)
  })

  it('without service worker support (an older browser, plain http) it does nothing', async () => {
    // happy-dom has no navigator.serviceWorker, like those browsers.
    expect('serviceWorker' in navigator).toBe(false)
    stop = listenForSwUpdate()
    await settle()
    expect(swUpdateAvailable()).toBe(false)
    expect(() => listenForSwUpdate(null)()).not.toThrow()
  })

  it('a browser that refuses navigator.serviceWorker (site data blocked) gets a warning, and the app still starts', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
    try {
      expect(() => {
        stop = listenForSwUpdate()
      }).not.toThrow()
      expect(warn).toHaveBeenCalledWith('[sw-update] navigator.serviceWorker failed:', expect.anything())
      expect(swUpdateAvailable()).toBe(false)
    } finally {
      Reflect.deleteProperty(navigator, 'serviceWorker')
    }
  })

  it('a ready that rejects gets a warning, and no card', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    stop = listenForSwUpdate({ controller: {}, ready: Promise.reject(new Error('blocked by an extension')) })
    await settle()
    expect(warn).toHaveBeenCalledWith('[sw-update] serviceWorker.ready failed:', expect.any(Error))
    expect(swUpdateAvailable()).toBe(false)
  })
})
