// @vitest-environment happy-dom
//
// The Android install offer's state (install-offer.ts): the browser's
// `beforeinstallprompt` is caught whenever it comes (so Home can offer it
// later), the browser's own infobar is suppressed, and the offer goes for
// good once ParkProof is installed or the offer dismissed (for this visit
// when the browser can't store that), and for this visit once the dialog is
// declined, even when the browser offers again at once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INSTALL_DISMISSED_KEY,
  dismissInstallOffer,
  installOfferAvailable,
  listenForInstallOffer,
  promptInstall,
  resetInstallOfferForTests,
  subscribeInstallOffer,
} from './install-offer'

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted', prompt = vi.fn(async () => {})) {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  Object.assign(event, { platforms: ['web'], prompt, userChoice: Promise.resolve({ outcome }) })
  return { event, prompt }
}

/** Runs `fn` with a localStorage that refuses every write, as a full quota or blocked site data does. */
function withUnwritableStorage(fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
  const unwritable = {
    getItem: () => null,
    setItem: () => {
      throw new DOMException('full', 'QuotaExceededError')
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  }
  Object.defineProperty(globalThis, 'localStorage', { value: unwritable, configurable: true, writable: true })
  try {
    fn()
  } finally {
    Object.defineProperty(globalThis, 'localStorage', original)
  }
}

let stop: () => void

beforeEach(() => {
  localStorage.clear()
  resetInstallOfferForTests()
  stop = listenForInstallOffer(window)
})

afterEach(() => {
  stop()
  resetInstallOfferForTests()
})

describe('install offer', () => {
  it('is caught whenever the browser offers, and stops the browser infobar', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeInstallOffer(listener)
    expect(installOfferAvailable()).toBe(false)
    const { event } = installEvent()
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(installOfferAvailable()).toBe(true)
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })

  it('accepted: the browser installs it, and it is never offered again', async () => {
    const { event, prompt } = installEvent('accepted')
    window.dispatchEvent(event)
    await expect(promptInstall()).resolves.toBe('accepted')
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(installOfferAvailable()).toBe(false)
    expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe('1')
  })

  it('declined: gone for this visit, even when the browser offers again at once', async () => {
    window.dispatchEvent(installEvent('dismissed').event)
    await expect(promptInstall()).resolves.toBe('dismissed')
    expect(installOfferAvailable()).toBe(false)
    // The browser can fire a fresh event as soon as its dialog closes. It is
    // still caught (no infobar) but not offered on this visit. Nothing is
    // stored, so a later visit may offer it again.
    const again = installEvent().event
    window.dispatchEvent(again)
    expect(again.defaultPrevented).toBe(true)
    expect(installOfferAvailable()).toBe(false)
    expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBeNull()
  })

  it('a prompt that throws leaves the browser menu as the way in, and the offer goes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const prompt = vi.fn(async () => {
      throw new Error('already used')
    })
    window.dispatchEvent(installEvent('accepted', prompt).event)
    await expect(promptInstall()).resolves.toBe('unavailable')
    expect(installOfferAvailable()).toBe(false)
  })

  it('without a caught prompt there is nothing to show', async () => {
    await expect(promptInstall()).resolves.toBe('unavailable')
  })

  it('dismissed: never offered again on this browser', () => {
    window.dispatchEvent(installEvent().event)
    dismissInstallOffer()
    expect(installOfferAvailable()).toBe(false)
    expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe('1')
    window.dispatchEvent(installEvent().event)
    expect(installOfferAvailable()).toBe(false)
  })

  it("dismissed: gone for this visit even when the browser can't store that", () => {
    window.dispatchEvent(installEvent().event)
    withUnwritableStorage(() => {
      dismissInstallOffer()
      expect(installOfferAvailable()).toBe(false)
      window.dispatchEvent(installEvent().event)
      expect(installOfferAvailable()).toBe(false)
    })
  })

  it('installed some other way (the browser menu): the offer goes for good', () => {
    window.dispatchEvent(installEvent().event)
    window.dispatchEvent(new Event('appinstalled'))
    expect(installOfferAvailable()).toBe(false)
    expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe('1')
  })

  it('a page load (the test reset) offers it again after a decline, or a close that was not stored', async () => {
    window.dispatchEvent(installEvent('dismissed').event)
    await promptInstall()
    window.dispatchEvent(installEvent().event)
    expect(installOfferAvailable()).toBe(false)
    resetInstallOfferForTests()
    window.dispatchEvent(installEvent().event)
    expect(installOfferAvailable()).toBe(true)

    withUnwritableStorage(() => {
      dismissInstallOffer()
      window.dispatchEvent(installEvent().event)
      expect(installOfferAvailable()).toBe(false)
      resetInstallOfferForTests()
      window.dispatchEvent(installEvent().event)
      expect(installOfferAvailable()).toBe(true)
    })
  })
})
