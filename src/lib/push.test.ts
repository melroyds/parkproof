// @vitest-environment happy-dom
//
// cancelPushReminders / schedulePushReminders: push schedules belong to the
// device that created them (spec N6), so requests carry this browser's
// device id, and a 403 ERR_NOT_OWNER comes back as its own reason so screens
// never mistake "another device owns these" for success or a network blip.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelPushReminders, hasPushDeviceId, schedulePushReminders } from './push'

const DEVICE_ID_KEY = 'parkproof.device_id.v1'
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

  /** A browser with push support and a live subscription. */
  function withSubscribedPush() {
    vi.stubGlobal('PushManager', class {})
    vi.stubGlobal('Notification', { permission: 'granted' })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => ({}) } }) },
    })
  }

  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
  })

  it('reports unsupported when the browser has no push', async () => {
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: false, reason: 'unsupported' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the created fires on success', async () => {
    withSubscribedPush()
    localStorage.setItem(DEVICE_ID_KEY, DEVICE)
    fetchMock.mockResolvedValue(
      jsonResponse(200, { created: [{ name: 'parkproof-push-session-1-0', fire_at: REMINDER.fire_at }], skipped: [] }),
    )
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({
      ok: true,
      created: [{ name: 'parkproof-push-session-1-0', fire_at: REMINDER.fire_at }],
      skipped: 0,
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string).device_id).toBe(DEVICE)
  })

  it('reports not_owner on 403 ERR_NOT_OWNER', async () => {
    withSubscribedPush()
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'ERR_NOT_OWNER' }))
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: false, reason: 'not_owner' })
  })

  it('reports network on any other failure', async () => {
    withSubscribedPush()
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }))
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: false, reason: 'network' })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await schedulePushReminders('session-1', [REMINDER])).toEqual({ ok: false, reason: 'network' })
  })
})
