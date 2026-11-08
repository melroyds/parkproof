// @vitest-environment happy-dom
//
// cancelPushReminders / schedulePushReminders: push schedules belong to the
// device that created them (spec N6), so requests carry this browser's
// device id, and a 403 ERR_NOT_OWNER comes back as its own reason so screens
// never mistake "another device owns these" for success or a network blip.
//
// Keeping the server registration alive (field-test fix list, items 1 and
// 5): every booking re-sends this browser's registration first, a 409
// ERR_NOT_SUBSCRIBED re-registers once and retries once, "not registered"
// is never reported as success, the app re-sends on start (at most hourly),
// and Reconnect swaps in a fresh registration under the same device id.
//
// A dead registration: when the server refuses the endpoint with 409
// ERR_ENDPOINT_GONE (the push service said 410 Gone for it), the app drops
// it and registers a fresh one, rather than re-sending the dead one.
//
// A weak signal: every push request (and the browser's subscribe) gives up
// after PUSH_REQUEST_TIMEOUT_MS, with AbortSignal.timeout or an
// AbortController fallback, so "Remind me" always finishes and says what it
// set; a booking stops at the first timeout instead of waiting out another.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ERR_ENDPOINT_GONE,
  PUSH_REQUEST_TIMEOUT_MS,
  cancelPushReminders,
  hasPushDeviceId,
  installPushRegistrationRefresh,
  reconnectPush,
  schedulePushReminders,
  subscribeToPush,
  syncPushRegistration,
} from './push'

const DEVICE_ID_KEY = 'parkproof.device_id.v1'
const REGISTRATION_SENT_KEY = 'parkproof.push.registration_sent.v1'
const DEVICE = '11111111-1111-4111-8111-111111111111'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A browser push subscription with the shape the code reads. */
function fakeSubscription(endpoint: string) {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256', auth: 'auth' } }),
    unsubscribe: vi.fn(async () => true),
  }
}

/** Push supported, permission granted, and this subscription (or none). */
function stubSubscribedBrowser(endpoint: string | null) {
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('Notification', { permission: 'granted' })
  const subscription = endpoint ? fakeSubscription(endpoint) : null
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }) },
  })
}

describe('cancelPushReminders', () => {
  it('sends this device id with the session id', async () => {
    localStorage.setItem(DEVICE_ID_KEY, DEVICE)
    fetchMock.mockResolvedValue(jsonResponse(200, { deleted: 2 }))

    const result = await cancelPushReminders('session-1')

    expect(result).toEqual({ ok: true, deleted: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/push\/cancel$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ device_id: DEVICE, session_id: 'session-1' })
  })

  it('sends no request when this browser has no device id (it owns no schedules)', async () => {
    const result = await cancelPushReminders('session-1')
    expect(result).toEqual({ ok: false, reason: 'no_device' })
    expect(fetchMock).not.toHaveBeenCalled()
    // And it doesn't mint a device id as a side effect.
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBeNull()
  })

  it('ignores a malformed stored device id', async () => {
    localStorage.setItem(DEVICE_ID_KEY, 'not a device id!')
    const result = await cancelPushReminders('session-1')
    expect(result).toEqual({ ok: false, reason: 'no_device' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports not_owner when the server says another device owns the reminders', async () => {
    localStorage.setItem(DEVICE_ID_KEY, DEVICE)
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'ERR_NOT_OWNER' }))
    expect(await cancelPushReminders('session-1')).toEqual({ ok: false, reason: 'not_owner' })
  })

  it('treats a 403 without the owner code as a plain failure', async () => {
    localStorage.setItem(DEVICE_ID_KEY, DEVICE)
    fetchMock.mockResolvedValue(jsonResponse(403, { message: 'Forbidden' }))
    expect(await cancelPushReminders('session-1')).toEqual({ ok: false, reason: 'network' })
  })

  it('reports network on a server error or a failed fetch instead of throwing', async () => {
    localStorage.setItem(DEVICE_ID_KEY, DEVICE)
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }))
    expect(await cancelPushReminders('session-1')).toEqual({ ok: false, reason: 'network' })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await cancelPushReminders('session-1')).toEqual({ ok: false, reason: 'network' })
  })
})

describe('hasPushDeviceId', () => {
  it('is true only for a well-formed stored id, and never creates one', () => {
    expect(hasPushDeviceId()).toBe(false)
    localStorage.setItem(DEVICE_ID_KEY, 'bad id')
    expect(hasPushDeviceId()).toBe(false)
    localStorage.setItem(DEVICE_ID_KEY, DEVICE)
    expect(hasPushDeviceId()).toBe(true)
  })
})

describe('schedulePushReminders', () => {
  const REMINDER = { fire_at: '2099-01-01T00:00:00.000Z', body: 'Your parking ends soon' }
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'
  const CREATED = { name: 'parkproof-push-session-1-0', fire_at: REMINDER.fire_at }

  /** A browser with push support and a live subscription. */
  function withSubscribedPush(endpoint = ENDPOINT) {
    stubSubscribedBrowser(endpoint)
  }

  /**
   * Answer /push/subscribe with `subscribe` and each /push/schedule call
   * with the next of `schedule` (a fresh Response per call).
   */
  function route(subscribe: () => Response, schedule: Array<() => Response>) {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/push/subscribe')) return subscribe()
      const next = schedule.shift()
      if (!next) throw new Error('unexpected /push/schedule call')
      return next()
    })
  }
  const ok204 = () => new Response(null, { status: 204 })
  const booked = () => jsonResponse(200, { created: [CREATED], skipped: [] })
  const notSubscribed = () => jsonResponse(409, { error: 'ERR_NOT_SUBSCRIBED' })
  const paths = () => fetchMock.mock.calls.map(([url]) => String(url).replace(/^.*\/push\//, ''))

  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
  })

  it('reports unsupported when the browser has no push', async () => {
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: false, reason: 'unsupported' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('re-sends the registration, then books, and returns the created fires', async () => {
    withSubscribedPush()
    localStorage.setItem(DEVICE_ID_KEY, DEVICE)
    route(ok204, [booked])
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: true, created: [CREATED], skipped: 0 })
    expect(paths()).toEqual(['subscribe', 'schedule'])
    const [, subInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(subInit.body as string)).toEqual({
      device_id: DEVICE,
      subscription: { endpoint: ENDPOINT, keys: { p256dh: 'p256', auth: 'auth' } },
    })
    const [, schedInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(schedInit.body as string).device_id).toBe(DEVICE)
  })

  it('skips the re-send when the same registration went out in the last minute', async () => {
    withSubscribedPush()
    localStorage.setItem(REGISTRATION_SENT_KEY, JSON.stringify({ at: Date.now() - 10_000, endpoint: ENDPOINT }))
    route(ok204, [booked])
    expect((await schedulePushReminders('session-1', [REMINDER])).ok).toBe(true)
    expect(paths()).toEqual(['schedule'])
  })

  it('on 409 ERR_NOT_SUBSCRIBED: registers once more and retries once', async () => {
    withSubscribedPush()
    // A recent send would normally skip the re-send; the retry must not.
    localStorage.setItem(REGISTRATION_SENT_KEY, JSON.stringify({ at: Date.now(), endpoint: ENDPOINT }))
    route(ok204, [notSubscribed, booked])
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: true, created: [CREATED], skipped: 0 })
    expect(paths()).toEqual(['schedule', 'subscribe', 'schedule'])
  })

  it('still refused after the retry: not_subscribed, never success, and no third try', async () => {
    withSubscribedPush()
    route(ok204, [notSubscribed, notSubscribed])
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: false, reason: 'not_subscribed' })
    expect(paths()).toEqual(['subscribe', 'schedule', 'subscribe', 'schedule'])
  })

  it('when the re-registration itself fails: no retry, not_subscribed', async () => {
    withSubscribedPush()
    route(() => jsonResponse(500, { error: 'boom' }), [notSubscribed])
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: false, reason: 'not_subscribed' })
    expect(paths()).toEqual(['subscribe', 'schedule', 'subscribe'])
  })

  it('a browser with no subscription is not_subscribed (never a quiet success) and sends nothing', async () => {
    stubSubscribedBrowser(null)
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: false, reason: 'not_subscribed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports not_owner on 403 ERR_NOT_OWNER', async () => {
    withSubscribedPush()
    route(ok204, [() => jsonResponse(403, { error: 'ERR_NOT_OWNER' })])
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: false, reason: 'not_owner' })
  })

  it('reports network on any other failure, including a 409 without the code', async () => {
    withSubscribedPush()
    route(ok204, [() => jsonResponse(500, { error: 'boom' })])
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: false, reason: 'network' })
    route(ok204, [() => jsonResponse(409, { error: 'ERR_SOMETHING_ELSE' })])
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: false, reason: 'network' })
    fetchMock.mockReset()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: false, reason: 'network' })
  })
})

describe('syncPushRegistration', () => {
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'

  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
  })

  it('sends nothing without permission or without a subscription', async () => {
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('Notification', { permission: 'default' })
    expect(await syncPushRegistration()).toBe('no_subscription')
    stubSubscribedBrowser(null)
    expect(await syncPushRegistration()).toBe('no_subscription')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends, then skips within maxAgeMs, then sends again for a new endpoint', async () => {
    stubSubscribedBrowser(ENDPOINT)
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }))
    expect(await syncPushRegistration({ maxAgeMs: 60_000 })).toBe('sent')
    expect(await syncPushRegistration({ maxAgeMs: 60_000 })).toBe('fresh')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The browser rotated its endpoint: send at once.
    stubSubscribedBrowser('https://fcm.googleapis.com/fcm/send/rotated')
    expect(await syncPushRegistration({ maxAgeMs: 60_000 })).toBe('sent')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('one re-send at a time: calls made meanwhile share it, and a forced one sends again after it (polish list)', async () => {
    stubSubscribedBrowser(ENDPOINT)
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    fetchMock.mockImplementation(async () => {
      await held
      return new Response(null, { status: 204 })
    })
    const hourly = syncPushRegistration({ maxAgeMs: 60 * 60_000 })
    const tenMinutes = syncPushRegistration({ maxAgeMs: 10 * 60_000 })
    const forced = syncPushRegistration()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    release()
    expect(await hourly).toBe('sent')
    expect(await tenMinutes).toBe('sent')
    // The re-register half of "re-register once and retry once" always sends.
    expect(await forced).toBe('sent')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports failed when the server does not store it, and does not mark it sent', async () => {
    stubSubscribedBrowser(ENDPOINT)
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'boom' }))
    expect(await syncPushRegistration({ maxAgeMs: 60_000 })).toBe('failed')
    expect(localStorage.getItem(REGISTRATION_SENT_KEY)).toBeNull()
  })
})

describe('installPushRegistrationRefresh (app start)', () => {
  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
  })

  it('re-sends on start, and not again on coming back within the hour', async () => {
    stubSubscribedBrowser('https://fcm.googleapis.com/fcm/send/abc')
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }))
    const cleanup = installPushRegistrationRefresh()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/push\/subscribe$/)
    await vi.waitFor(() => expect(localStorage.getItem(REGISTRATION_SENT_KEY)).not.toBeNull())

    document.dispatchEvent(new Event('visibilitychange'))
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('does nothing without notification permission', async () => {
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('Notification', { permission: 'denied' })
    const cleanup = installPushRegistrationRefresh()
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
    cleanup()
  })
})

describe('reconnectPush (fix list item 5)', () => {
  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
    vi.unstubAllEnvs()
  })

  it('drops the old registration, makes a fresh one and sends it under the same device id', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'AAAA')
    localStorage.setItem(DEVICE_ID_KEY, DEVICE)
    const old = fakeSubscription('https://fcm.googleapis.com/fcm/send/old')
    const fresh = fakeSubscription('https://fcm.googleapis.com/fcm/send/new')
    let current: ReturnType<typeof fakeSubscription> | null = old
    old.unsubscribe.mockImplementation(async () => {
      current = null
      return true
    })
    const subscribe = vi.fn(async () => {
      current = fresh
      return fresh
    })
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('Notification', { permission: 'granted' })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => current, subscribe } }) },
    })
    fetchMock.mockImplementation(async () => new Response(null, { status: 204 }))

    const result = await reconnectPush()

    expect(result.ok).toBe(true)
    expect(old.unsubscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/push\/subscribe$/)
    expect(JSON.parse(init.body as string)).toMatchObject({
      device_id: DEVICE,
      subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/new' },
    })
  })

  it('refuses without touching the subscription when notifications are blocked', async () => {
    stubSubscribedBrowser('https://fcm.googleapis.com/fcm/send/abc')
    vi.stubGlobal('Notification', { permission: 'denied' })
    expect(await reconnectPush()).toEqual({ ok: false, reason: 'denied' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('not asked yet: asks first, inside the tap, before anything is awaited', async () => {
    stubSubscribedBrowser('https://fcm.googleapis.com/fcm/send/abc')
    const requestPermission = vi.fn(async () => 'denied' as const)
    vi.stubGlobal('Notification', { permission: 'default', requestPermission })

    const pending = reconnectPush()
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(await pending).toEqual({ ok: false, reason: 'denied' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('every push request gives up after PUSH_REQUEST_TIMEOUT_MS', () => {
  const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'
  const REMINDER = { fire_at: '2099-01-01T00:00:00.000Z', body: 'Your parking ends soon' }

  /** A server that never answers; the request ends only when its signal aborts. */
  function serverNeverAnswers() {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit = {}) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
        }),
    )
  }

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.setItem(DEVICE_ID_KEY, DEVICE)
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
    vi.unstubAllEnvs()
  })

  it('is about 10 s', () => {
    expect(PUSH_REQUEST_TIMEOUT_MS).toBe(10_000)
  })

  it('a cancel that never answers ends as network after the timeout, with an abort signal on the request', async () => {
    serverNeverAnswers()
    let settled = false
    const pending = cancelPushReminders('session-1').finally(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(PUSH_REQUEST_TIMEOUT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    expect(await pending).toEqual({ ok: false, reason: 'network' })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('uses AbortSignal.timeout where the browser has it', async () => {
    const native = new AbortController().signal
    const timeout = vi.fn(() => native)
    const original = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')
    Object.defineProperty(AbortSignal, 'timeout', { value: timeout, configurable: true, writable: true })
    try {
      fetchMock.mockResolvedValue(jsonResponse(200, { deleted: 1 }))
      expect(await cancelPushReminders('session-1')).toEqual({ ok: true, deleted: 1 })
      expect(timeout).toHaveBeenCalledWith(PUSH_REQUEST_TIMEOUT_MS)
      expect((fetchMock.mock.calls[0] as [string, RequestInit])[1].signal).toBe(native)
    } finally {
      if (original) Object.defineProperty(AbortSignal, 'timeout', original)
      else delete (AbortSignal as { timeout?: unknown }).timeout
    }
  })

  it('falls back to an AbortController (aborted at the timeout) where AbortSignal.timeout is missing', async () => {
    const original = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true, writable: true })
    try {
      serverNeverAnswers()
      const pending = cancelPushReminders('session-1')
      await vi.advanceTimersByTimeAsync(PUSH_REQUEST_TIMEOUT_MS)
      expect(await pending).toEqual({ ok: false, reason: 'network' })
      const signal = (fetchMock.mock.calls[0] as [string, RequestInit])[1].signal
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal?.aborted).toBe(true)
    } finally {
      if (original) Object.defineProperty(AbortSignal, 'timeout', original)
      else delete (AbortSignal as { timeout?: unknown }).timeout
    }
  })

  it('still stops waiting when a fetch ignores the signal', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}))
    const pending = cancelPushReminders('session-1')
    await vi.advanceTimersByTimeAsync(PUSH_REQUEST_TIMEOUT_MS)
    expect(await pending).toEqual({ ok: false, reason: 'network' })
  })

  it('registration that never answers: subscribeToPush says timeout and does not mark it sent', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'AAAA')
    stubSubscribedBrowser(ENDPOINT)
    serverNeverAnswers()

    const pending = subscribeToPush()
    await vi.advanceTimersByTimeAsync(PUSH_REQUEST_TIMEOUT_MS)

    expect(await pending).toMatchObject({ ok: false, reason: 'timeout' })
    expect(localStorage.getItem(REGISTRATION_SENT_KEY)).toBeNull()
  })

  it("a browser push service that never answers subscribe(): timeout, and nothing is sent", async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'AAAA')
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('Notification', { permission: 'granted' })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: { getSubscription: async () => null, subscribe: () => new Promise(() => {}) },
        }),
      },
    })

    const pending = subscribeToPush()
    await vi.advanceTimersByTimeAsync(PUSH_REQUEST_TIMEOUT_MS)

    expect(await pending).toEqual({ ok: false, reason: 'timeout' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('booking: a registration re-send that never answers stops there, without a booking request', async () => {
    stubSubscribedBrowser(ENDPOINT)
    serverNeverAnswers()

    const pending = schedulePushReminders('session-1', [REMINDER])
    await vi.advanceTimersByTimeAsync(PUSH_REQUEST_TIMEOUT_MS)

    expect(await pending).toEqual({ ok: false, reason: 'network' })
    expect(fetchMock.mock.calls.map(([url]) => String(url).replace(/^.*\/push\//, ''))).toEqual(['subscribe'])
  })

  it('booking: a schedule request that never answers is network, never success', async () => {
    stubSubscribedBrowser(ENDPOINT)
    localStorage.setItem(REGISTRATION_SENT_KEY, JSON.stringify({ at: Date.now(), endpoint: ENDPOINT }))
    serverNeverAnswers()

    const pending = schedulePushReminders('session-1', [REMINDER])
    await vi.advanceTimersByTimeAsync(PUSH_REQUEST_TIMEOUT_MS)

    expect(await pending).toEqual({ ok: false, reason: 'network' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('a dead registration (409 ERR_ENDPOINT_GONE)', () => {
  const DEAD = 'https://fcm.googleapis.com/fcm/send/dead'
  const FRESH = 'https://fcm.googleapis.com/fcm/send/fresh'

  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
    vi.unstubAllEnvs()
  })

  /** A browser still holding the dead subscription; subscribe() hands out a fresh one. */
  function browserWithDeadSubscription() {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', 'AAAA')
    localStorage.setItem(DEVICE_ID_KEY, DEVICE)
    const dead = fakeSubscription(DEAD)
    const fresh = fakeSubscription(FRESH)
    let current: ReturnType<typeof fakeSubscription> | null = dead
    dead.unsubscribe.mockImplementation(async () => {
      current = null
      return true
    })
    const subscribe = vi.fn(async () => {
      current = fresh
      return fresh
    })
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('Notification', { permission: 'granted' })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => current, subscribe } }) },
    })
    return { dead, subscribe }
  }

  /** /push/subscribe refuses the dead endpoint and stores any other. */
  function serverRefusingDead() {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string) as { subscription: { endpoint: string } }
      return sent.subscription.endpoint === DEAD
        ? jsonResponse(409, { error: ERR_ENDPOINT_GONE })
        : new Response(null, { status: 204 })
    })
  }
  const sentEndpoints = () =>
    fetchMock.mock.calls.map(([, init]) => (JSON.parse((init as RequestInit).body as string) as { subscription: { endpoint: string } }).subscription.endpoint)

  it('the app-open re-send drops the dead registration and registers a fresh one', async () => {
    const { dead, subscribe } = browserWithDeadSubscription()
    serverRefusingDead()

    expect(await syncPushRegistration()).toBe('sent')

    expect(dead.unsubscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(sentEndpoints()).toEqual([DEAD, DEAD, FRESH])
    expect(JSON.parse(localStorage.getItem(REGISTRATION_SENT_KEY)!).endpoint).toBe(FRESH)
  })

  it('subscribeToPush (Remind me) swaps in a fresh registration once', async () => {
    const { subscribe } = browserWithDeadSubscription()
    serverRefusingDead()

    const result = await subscribeToPush()

    expect(result.ok).toBe(true)
    expect(result.subscription?.endpoint).toBe(FRESH)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(sentEndpoints()).toEqual([DEAD, FRESH])
  })

  it('a fresh registration refused too is a failure, with no loop', async () => {
    const { subscribe } = browserWithDeadSubscription()
    fetchMock.mockImplementation(async () => jsonResponse(409, { error: ERR_ENDPOINT_GONE }))

    const result = await subscribeToPush()

    expect(result).toMatchObject({ ok: false, reason: 'network' })
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
