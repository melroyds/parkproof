// @vitest-environment happy-dom
//
// Merge check (polish/copy-and-leftovers into integration/roadmap-2): T4
// moved push management into Settings (PushManagementSection), and the
// polish branch made turning push off set a marker (push.ts
// isPushTurnedOff) that the weekly reminders read, so a rule booked for
// push stops saying it alerts with ParkProof closed. Turning push off in
// Settings, with the real push.ts, must set that marker and tell the
// weekly reminders. (A registration reaching the server clears it again:
// push.ts writeRegistrationSent, covered in recurring-push.test.ts.)
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { PUSH_STATE_EVENT, isPushTurnedOff } from '../lib/push'
import { alertEnvironment } from '../lib/recurring-push'
import PushManagementSection from './PushManagementSection'

const ENDPOINT = 'https://push.example/endpoint-1'

let subscription: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  Object.defineProperty(window, 'confirm', { value: vi.fn(() => true), configurable: true, writable: true })
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('Notification', { permission: 'granted' })
  subscription = {
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: 'p256', auth: 'auth' } }),
    unsubscribe: vi.fn(async () => {
      subscription = null
      return true
    }),
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }) },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('turning push off in Settings', () => {
  it('sets the turned-off marker the weekly reminders read, and says so on window', async () => {
    const events: Event[] = []
    const listener = (e: Event) => events.push(e)
    window.addEventListener(PUSH_STATE_EVENT, listener)
    try {
      render(<PushManagementSection />)
      const off = await screen.findByRole('button', { name: i18n.t('settings.pushDisable') })
      expect(isPushTurnedOff()).toBe(false)
      fireEvent.click(off)
      await waitFor(() => expect(isPushTurnedOff()).toBe(true))
      expect(alertEnvironment().pushOff).toBe(true)
      expect(events).toHaveLength(1)
      expect(await screen.findByRole('button', { name: i18n.t('settings.pushEnable') })).toBeTruthy()
    } finally {
      window.removeEventListener(PUSH_STATE_EVENT, listener)
    }
  })
})
