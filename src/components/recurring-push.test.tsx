// @vitest-environment happy-dom
//
// Weekly reminders by push (T5b), wired end to end on the phone: the
// editor's "Notify me on this phone" registers the phone for push on Save,
// and the sync App mounts (useRecurringPushSync) keeps the server in step
// as rules are created, edited, paused, resumed and deleted. Each rule in
// the list says whether it can alert with ParkProof closed, or only while
// it's open when push can't work here. The browser's push APIs and the
// network are faked; everything else is the real code.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { resetRecurringPushForTests } from '../lib/recurring-push'
import { useRecurringPushSync } from '../lib/use-recurring-push'
import { useRecurringRules } from '../lib/use-recurring-rules'
import { getRecurringRule, loadRecurringRules } from '../lib/storage'
import RecurringReminders from './RecurringReminders'

const CLOSED = 'Set to alert this phone even when ParkProof is closed. Open ParkProof at least once every two months to keep it set.'
const OPEN_ONLY = 'Alerts this phone only while ParkProof is open. Add it to your calendar too.'
const NONE = "This phone can't show this reminder right now. Add it to your calendar."
const BLOCKED = /Notifications are blocked for ParkProof/

const SAVED_RULE = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  label: '',
  kind: 'street_cleaning',
  days: ['TU'],
  start: '07:00',
  end: '09:00',
  frequency: 'weekly',
  nth: [],
  anchor_date: '2026-01-01',
  timezone: 'Australia/Melbourne',
  address: null,
  remind_evening_before: '20:00',
  remind_minutes_before: 60,
  push: true,
  paused: false,
  sequence: 0,
}

interface Call {
  path: string
  body: Record<string, unknown>
}

let calls: Call[] = []
let subscribed = true

function Harness() {
  const rules = useRecurringRules()
  useRecurringPushSync(rules)
  return <RecurringReminders onBack={() => {}} />
}

function installPush() {
  const subscription = {
    endpoint: 'https://push.example/abc',
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p256', auth: 'auth' } }),
  }
  const registration = {
    pushManager: {
      getSubscription: async () => (subscribed ? subscription : null),
      subscribe: async () => {
        subscribed = true
        return subscription
      },
    },
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration) },
  })
  vi.stubGlobal('PushManager', class {})
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'BKtestVapidKeyForTheRecurringPushWiringTestOnly0000000000000000000')
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  resetRecurringPushForTests()
  calls = []
  subscribed = true
  class FakeNotification {
    static permission: NotificationPermission = 'granted'
    static requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
  }
  vi.stubGlobal('Notification', FakeNotification)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://localhost').pathname.replace(/^\/api/, '')
      calls.push({ path, body: init?.body ? JSON.parse(init.body as string) : {} })
      if (path === '/push/subscribe') return new Response(null, { status: 204 })
      if (path === '/push/recurring') {
        return new Response(JSON.stringify({ created: [{}, {}], skipped: [] }), { status: 200 })
      }
      if (path === '/push/recurring/cancel') return new Response(JSON.stringify({ deleted: 2 }), { status: 200 })
      return new Response('{}', { status: 404 })
    }),
  )
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  delete (navigator as unknown as Record<string, unknown>).serviceWorker
})

const bookings = () => calls.filter((c) => c.path === '/push/recurring')
const cancels = () => calls.filter((c) => c.path === '/push/recurring/cancel')

async function addTuesdayRule() {
  fireEvent.click(screen.getByRole('button', { name: 'Add a weekly reminder' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Monday' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Tuesday' }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  })
}

describe('the push toggle keeps the server in step', () => {
  it('create, edit, pause, resume and delete each reach the server', async () => {
    installPush()
    render(<Harness />)

    // Create: Save registers the phone, then the rule is booked.
    await addTuesdayRule()
    await waitFor(() => expect(bookings()).toHaveLength(1))
    expect(calls.findIndex((c) => c.path === '/push/subscribe')).toBeLessThan(calls.findIndex((c) => c.path === '/push/recurring'))
    const [rule] = loadRecurringRules()
    const deviceId = bookings()[0].body.device_id
    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(bookings()[0].body).toMatchObject({
      rule: { id: rule.id, days: ['TU'], start: '07:00', frequency: 'weekly', remind_evening_before: '20:00', remind_minutes_before: 60 },
      copy: { evening: { TU: expect.stringMatching(/^Street sweeping on Tuesday/) } },
    })
    expect(await screen.findByText(CLOSED)).toBeTruthy()

    // Edit: booked again with the new start (replace-all on the server).
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Street sweeping' }))
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '06:30' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    await waitFor(() => expect(bookings()).toHaveLength(2))
    expect(bookings()[1].body).toMatchObject({ device_id: deviceId, rule: { id: rule.id, start: '06:30' } })

    // Pause: cancelled on the server, and the push line goes.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Pause: Street sweeping' }))
    })
    await waitFor(() => expect(cancels()).toHaveLength(1))
    expect(cancels()[0].body).toEqual({ device_id: deviceId, rule_id: rule.id })
    expect(screen.queryByText(CLOSED)).toBeNull()

    // Resume: booked again.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resume: Street sweeping' }))
    })
    await waitFor(() => expect(bookings()).toHaveLength(3))
    expect(await screen.findByText(CLOSED)).toBeTruthy()

    // Delete: cancelled on the server.
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Street sweeping' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete reminder' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    })
    await waitFor(() => expect(cancels()).toHaveLength(2))
    expect(getRecurringRule(rule.id)).toBeUndefined()
  })

  it('Save registers a phone that has no push subscription yet, then books the rule', async () => {
    installPush()
    subscribed = false
    render(<Harness />)
    await addTuesdayRule()
    await waitFor(() => expect(bookings()).toHaveLength(1))
    expect(subscribed).toBe(true)
    expect(calls[0].path).toBe('/push/subscribe')
    expect(await screen.findByText(CLOSED)).toBeTruthy()
  })

  it('switching "Notify me on this phone" off cancels; nothing is booked for it', async () => {
    installPush()
    render(<Harness />)
    await addTuesdayRule()
    await waitFor(() => expect(bookings()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Street sweeping' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Notify me on this phone' }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    })
    await waitFor(() => expect(cancels()).toHaveLength(1))
    expect(bookings()).toHaveLength(1)
    expect(screen.queryByText(CLOSED)).toBeNull()
    expect(screen.queryByText(OPEN_ONLY)).toBeNull()
  })
})

describe('a server that has forgotten the phone', () => {
  it('re-sends the registration once and books again (409 ERR_NOT_SUBSCRIBED), through push.ts', async () => {
    installPush()
    localStorage.setItem('parkproof.recurring.v1', JSON.stringify([SAVED_RULE]))
    type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
    const base = fetch as unknown as ReturnType<typeof vi.fn<FetchLike>>
    const real = base.getMockImplementation()!
    let refused = false
    base.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://localhost').pathname.replace(/^\/api/, '')
      if (path === '/push/recurring' && !refused) {
        refused = true
        calls.push({ path, body: init?.body ? JSON.parse(init.body as string) : {} })
        return new Response(JSON.stringify({ error: 'ERR_NOT_SUBSCRIBED' }), { status: 409 })
      }
      return real(url, init)
    })
    render(<Harness />)
    await waitFor(() => expect(bookings()).toHaveLength(2))
    const paths = calls.map((c) => c.path)
    // The refused booking, then a fresh registration, then the one retry.
    const refusedAt = paths.indexOf('/push/recurring')
    expect(paths.slice(refusedAt)).toEqual(['/push/recurring', '/push/subscribe', '/push/recurring'])
    expect(await screen.findByText(CLOSED)).toBeTruthy()
  })
})

describe('coming back online', () => {
  it('books a rule left pending at start straight away, even within the first minute', async () => {
    installPush()
    localStorage.setItem('parkproof.recurring.v1', JSON.stringify([SAVED_RULE]))
    let offline = true
    type FetchLike = (url: string, init?: RequestInit) => Promise<Response>
    const base = fetch as unknown as ReturnType<typeof vi.fn<FetchLike>>
    const real = base.getMockImplementation()!
    base.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://localhost').pathname.replace(/^\/api/, '')
      if (offline && path === '/push/recurring') {
        calls.push({ path, body: init?.body ? JSON.parse(init.body as string) : {} })
        throw new TypeError('Failed to fetch')
      }
      return real(url, init)
    })
    render(<Harness />)
    await waitFor(() => expect(bookings()).toHaveLength(1))
    expect(screen.queryByText(CLOSED)).toBeNull()
    offline = false
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(bookings()).toHaveLength(2))
    expect(await screen.findByText(CLOSED)).toBeTruthy()
  })
})

describe('when push is not available', () => {
  it('saves the rule for this device only, says so, and books nothing', async () => {
    // No PushManager (for example iPhone Safari outside the Home Screen app).
    render(<Harness />)
    await addTuesdayRule()
    expect(await screen.findByText(OPEN_ONLY)).toBeTruthy()
    expect(bookings()).toEqual([])
    expect(loadRecurringRules()).toHaveLength(1)
  })

  it("a browser with no notifications at all (iPhone Safari tab) is told nothing can alert, never 'while open'", async () => {
    Reflect.deleteProperty(globalThis, 'Notification')
    expect('Notification' in window).toBe(false)
    localStorage.setItem('parkproof.recurring.v1', JSON.stringify([SAVED_RULE]))
    render(<Harness />)
    expect(await screen.findByText(NONE)).toBeTruthy()
    expect(screen.queryByText(OPEN_ONLY)).toBeNull()
  })

  it('a dismissed permission prompt: nothing can alert, and the line says so', async () => {
    ;(Notification as unknown as { permission: NotificationPermission }).permission = 'default'
    localStorage.setItem('parkproof.recurring.v1', JSON.stringify([SAVED_RULE]))
    render(<Harness />)
    expect(await screen.findByText(NONE)).toBeTruthy()
    expect(screen.queryByText(OPEN_ONLY)).toBeNull()
    expect(screen.queryByText(BLOCKED)).toBeNull()
  })

  it('blocked notifications: the banner says so, and no line under the rule contradicts it', async () => {
    ;(Notification as unknown as { permission: NotificationPermission }).permission = 'denied'
    localStorage.setItem('parkproof.recurring.v1', JSON.stringify([SAVED_RULE]))
    render(<Harness />)
    expect(await screen.findByText(BLOCKED)).toBeTruthy()
    // Give the sync its pass, then check no rule line was added.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.queryByText(OPEN_ONLY)).toBeNull()
    expect(screen.queryByText(NONE)).toBeNull()
  })

  it('Android without push: no "while open" promise, since Android shows no in-tab alerts', async () => {
    const ua = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130 Mobile')
    try {
      localStorage.setItem('parkproof.recurring.v1', JSON.stringify([SAVED_RULE]))
      render(<Harness />)
      expect(await screen.findByText(NONE)).toBeTruthy()
      expect(screen.queryByText(OPEN_ONLY)).toBeNull()
    } finally {
      ua.mockRestore()
    }
  })

  it('never creates a push subscription in the background: only the Save tap may', async () => {
    installPush()
    subscribed = false
    // A rule saved earlier (no tap now): the sync finds no subscription.
    localStorage.setItem(
      'parkproof.recurring.v1',
      JSON.stringify([
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          label: '',
          kind: 'street_cleaning',
          days: ['TU'],
          start: '07:00',
          end: '09:00',
          frequency: 'weekly',
          nth: [],
          anchor_date: '2026-01-01',
          timezone: 'Australia/Melbourne',
          address: null,
          remind_evening_before: '20:00',
          remind_minutes_before: 60,
          push: true,
          paused: false,
          sequence: 0,
        },
      ]),
    )
    render(<Harness />)
    expect(await screen.findByText(OPEN_ONLY)).toBeTruthy()
    expect(subscribed).toBe(false)
    expect(calls).toEqual([])
  })
})
