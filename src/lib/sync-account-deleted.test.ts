// @vitest-environment happy-dom
//
// An account deleted on another device, in another tab, or by this device's
// own Delete forever whose answer was lost, leaves this device signed in to
// it, and the signed-in routes then refuse it with HTTP 410 and
// {"error":"ERR_ACCOUNT_DELETED"}. Every signed-in call goes through
// authFetch, which tells the app (ACCOUNT_DELETED_EVENT) once per refused
// call, the same way whoever deleted the account, so the AuthProvider signs
// this device out and keeps its records (auth-context.test.tsx). The caller
// still gets its own error from the same answer, and no other answer fires
// the event. Nor does a refusal of this tab's own Delete forever while it
// runs, nor one of an account this device has left. Nothing here sends a
// delete again (account-deleted-flows.test.tsx).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession } from '../types'

const { getIdToken } = vi.hoisted(() => ({ getIdToken: vi.fn(async (): Promise<string | null> => null) }))
vi.mock('./auth', () => ({ getIdToken }))
vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

import {
  ACCOUNT_DELETED_EVENT,
  deleteAccount,
  exportCloudData,
  fetchRefPhotoFromCloud,
  listCloudSessions,
  materializePhotoFromCloud,
  performInitialSync,
  resetSyncForTests,
  uploadSession,
  type AccountDeletedDetail,
} from './sync'
import { getSession, saveSession } from './storage'
import { resetSigningQueueForTests, whenSigningIdle } from './signing'
import { fakeIdToken } from './test-support/fake-cloud'

const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const SHA = 'a'.repeat(64)

/** A promise the test opens when it wants. */
function gate(): { opened: Promise<void>; open: () => void } {
  let open!: () => void
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

const answerWith = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': typeof body === 'string' ? 'text/plain' : 'application/json' },
  })
const accountDeleted = () => answerWith(410, { error: 'ERR_ACCOUNT_DELETED' })

/** What the API answers next, for every request (by its URL, for a test that tells the routes apart). */
let answer: (url: string) => Response | Promise<Response>
/** Every ACCOUNT_DELETED_EVENT fired during a test. */
let events: CustomEvent<AccountDeletedDetail>[] = []
const onAccountDeleted = (e: Event) => {
  events.push(e as CustomEvent<AccountDeletedDetail>)
}
const api = vi.fn(async (input: string, init?: RequestInit) => {
  void init
  return answer(input)
})

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: ID,
    arrived_at: '2026-11-15T01:00:00.000Z',
    location: null,
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  resetSyncForTests()
  resetSigningQueueForTests()
  getIdToken.mockImplementation(async () => fakeIdToken('user-1'))
  answer = accountDeleted
  events = []
  vi.stubGlobal('fetch', api)
  window.addEventListener(ACCOUNT_DELETED_EVENT, onAccountDeleted)
  // The photo paths log what they couldn't fetch or send.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  window.removeEventListener(ACCOUNT_DELETED_EVENT, onAccountDeleted)
  await whenSigningIdle()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a signed-in call refused because the account was deleted', () => {
  it('tells the app once, and the caller still gets its error from the same answer', async () => {
    await expect(listCloudSessions()).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
    expect(api).toHaveBeenCalledTimes(1)
    expect(events).toHaveLength(1)
    expect(events[0].detail).toEqual({ path: '/sessions/list', account: 'user-1' })
  })

  it.each([
    ['GET /me/export', () => exportCloudData()],
    ['POST /photos/materialize (a legacy photo)', () => materializePhotoFromCloud(ID, 'sign')],
  ])('%s: once, and the caller still fails', async (_route, call) => {
    await expect(call()).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
    expect(events).toHaveLength(1)
  })

  it('a photo fetch from the cloud: once, and it still answers null without throwing', async () => {
    await expect(fetchRefPhotoFromCloud(ID, SHA)).resolves.toBeNull()
    expect(api).toHaveBeenCalledTimes(1)
    expect(events).toHaveLength(1)
    expect(events[0].detail).toEqual({ path: '/photos/materialize', account: 'user-1' })
  })

  it('an upload: once for its photo and once for its row, and the record stays on this device', async () => {
    saveSession(record({ sign_photo: 'data:image/jpeg;base64,' + btoa('the sign') }))
    await expect(uploadSession(getSession(ID)!)).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
    expect(events.map((e) => e.detail.path)).toEqual(['/photos/presign', '/sessions/upload'])
    expect(getSession(ID)).toBeDefined()
  })
})

describe('every other answer tells the app nothing', () => {
  it.each([
    ['a 410 with another error', () => answerWith(410, { error: 'ERR_GONE' }), 'API 410: ERR_GONE'],
    ['a 410 that is not JSON', () => answerWith(410, 'Gone'), 'API 410: Gone'],
    ['a 401', () => answerWith(401, { message: 'Unauthorized' }), 'API 401'],
    ['a 500', () => answerWith(500, { error: 'ERR_INTERNAL' }), 'API 500: ERR_INTERNAL'],
    ['a 403 carrying the same code', () => answerWith(403, { error: 'ERR_ACCOUNT_DELETED' }), 'API 403: ERR_ACCOUNT_DELETED'],
  ])('%s', async (_name, next, error) => {
    answer = next
    await expect(listCloudSessions()).rejects.toThrow(error)
    expect(api).toHaveBeenCalledTimes(1)
    expect(events).toEqual([])
  })

  it('a 200', async () => {
    answer = () => answerWith(200, { sessions: [] })
    await expect(listCloudSessions()).resolves.toEqual([])
    expect(events).toEqual([])
  })

  it('signed out, nothing is asked at all', async () => {
    getIdToken.mockImplementation(async () => null)
    await expect(listCloudSessions()).rejects.toThrow('Not signed in')
    expect(api).not.toHaveBeenCalled()
    expect(events).toEqual([])
  })
})

const meDeleteFailed = () => answerWith(500, { error: 'Could not delete every photo. Please try again.' })
const meDeleteWorked = () => answerWith(200, { ok: true, deleted_rows: 0, deleted_objects: 0 })

// The device that runs Delete forever is refused too while /me/delete runs:
// the server writes its marker first. Those refusals come from its own
// delete, so they tell the app nothing (the AuthProvider never signs it
// out for them): a refusal of a call that went out before the delete ended
// and was answered after it started. When a later step fails, the server
// removes its marker before it answers, so nothing is refused afterwards.
describe('a delete running on this device', () => {

  /**
   * /me/delete reaches the server (`reached`) and its answer is held until
   * `settle`. Every other route answers `others`: 410 while the marker stands.
   */
  function holdMeDelete(others: (url: string) => Response | Promise<Response>) {
    let entered!: () => void
    const reached = new Promise<void>((resolve) => {
      entered = resolve
    })
    let settle!: (res: Response) => void
    const settled = new Promise<Response>((resolve) => {
      settle = resolve
    })
    answer = (url) => {
      if (!url.endsWith('/me/delete')) return others(url)
      entered()
      return settled
    }
    return { reached, settle }
  }

  it('its own calls refused while /me/delete runs tell the app nothing; a call for another account still does', async () => {
    const meDelete = holdMeDelete(accountDeleted)
    const deletion = deleteAccount()
    await meDelete.reached

    // A pull on return, a photo fetch and an export, while the marker stands.
    await expect(listCloudSessions()).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
    await expect(fetchRefPhotoFromCloud(ID, SHA)).resolves.toBeNull()
    await expect(exportCloudData()).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
    expect(api).toHaveBeenCalledTimes(4)
    expect(events).toEqual([])

    // The window is for the account being deleted, and no other.
    getIdToken.mockImplementation(async () => fakeIdToken('user-2'))
    await expect(listCloudSessions()).rejects.toThrow('API 410')
    expect(events).toHaveLength(1)

    meDelete.settle(meDeleteWorked())
    await deletion
  })

  it('one at a time: a second Delete forever while one runs shares it, and one /me/delete goes', async () => {
    const meDelete = holdMeDelete(accountDeleted)
    const first = deleteAccount()
    // A second call while the first runs (another tap, or another caller).
    const second = deleteAccount()
    expect(second).toBe(first)
    await meDelete.reached
    meDelete.settle(meDeleteWorked())
    await Promise.all([first, second])
    expect(api.mock.calls.filter(([url]) => url.endsWith('/me/delete'))).toHaveLength(1)
  })

  it('deletes only the account it started with: signed in to another one by the time /me/delete would go, it sends nothing', async () => {
    answer = meDeleteWorked
    // user-1 taps Delete forever, and user-2 is signed in when the uploads
    // already running have ended.
    getIdToken.mockImplementationOnce(async () => fakeIdToken('user-1'))
    getIdToken.mockImplementation(async () => fakeIdToken('user-2'))
    await expect(deleteAccount()).rejects.toThrow('Not signed in')
    expect(api).not.toHaveBeenCalled()
  })

  it('a call sent while it runs, refused, whose answer arrives after the delete failed, tells the app nothing either', async () => {
    let listingSent!: () => void
    const listingOut = new Promise<void>((resolve) => {
      listingSent = resolve
    })
    let releaseListing!: () => void
    const listingHeld = new Promise<void>((resolve) => {
      releaseListing = resolve
    })
    const meDelete = holdMeDelete(async (url) => {
      if (!url.endsWith('/sessions/list')) return accountDeleted()
      // Refused at once, while the marker stands, but the answer reaches
      // this device only after the delete's own answer.
      const refusal = accountDeleted()
      listingSent()
      await listingHeld
      return refusal
    })
    const deletion = deleteAccount()
    await meDelete.reached
    const listing = listCloudSessions()
    await listingOut

    // A step after the marker fails: the server removes the marker and answers 500.
    meDelete.settle(meDeleteFailed())
    await expect(deletion).rejects.toThrow('API 500')
    releaseListing()
    await expect(listing).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
    expect(events).toEqual([])
  })

  it.each([
    ['failed', meDeleteFailed],
    ['worked', meDeleteWorked],
    ['was refused before it ran (an expired token, 401)', () => answerWith(401, { message: 'Unauthorized' })],
  ])(
    'once /me/delete has answered (it %s), the window is closed: a refusal of a call sent after that tells the app',
    async (outcome, meDeleteAnswer) => {
      answer = (url) => (url.endsWith('/me/delete') ? meDeleteAnswer() : accountDeleted())
      if (outcome === 'worked') await deleteAccount()
      else await expect(deleteAccount()).rejects.toThrow(/^API (500|401)/)
      expect(events).toEqual([])

      await expect(listCloudSessions()).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
      expect(events.map((e) => e.detail)).toEqual([{ path: '/sessions/list', account: 'user-1' }])
    },
  )

  // A call sent just before Delete forever starts (a pull on return, a photo
  // fetch) can reach the server after the marker went in, a cold Lambda
  // while /me/delete runs warm, and its refusal can arrive at any point
  // after: it is still this device's own.
  describe('a call sent just before it starts', () => {
    /**
     * Delete forever with /me/delete held until `meDeleteAnswered` opens, and
     * a listing sent just before it, refused by the server while the marker
     * stands and held on its way back until `listingAnswered` opens.
     */
    function startWithListingInFlight(meDeleteAnswer: () => Response) {
      const listingReached = gate()
      const listingAnswered = gate()
      const meDeleteReached = gate()
      const meDeleteAnswered = gate()
      answer = async (url) => {
        if (url.endsWith('/me/delete')) {
          meDeleteReached.open()
          await meDeleteAnswered.opened
          return meDeleteAnswer()
        }
        listingReached.open()
        const refusal = accountDeleted()
        await listingAnswered.opened
        return refusal
      }
      const listing = listCloudSessions()
      return { listing, listingReached, listingAnswered, meDeleteReached, meDeleteAnswered }
    }

    it('refused while Delete forever still waits for the uploads already running: tells the app nothing, and the delete goes ahead', async () => {
      // Already deleted (on another device, say): signing out now would leave
      // /me/delete with no token, and this device never cleared.
      saveSession(record({ sign_photo: 'data:image/jpeg;base64,' + btoa('the sign') }))
      const putSent = gate()
      const putLands = gate()
      answer = async (url) => {
        if (url.endsWith('/photos/presign')) return answerWith(200, { url: 'https://s3.test/put/sign', key: 'k', bucket: 'b' })
        if (url.startsWith('https://s3.test/')) {
          putSent.open()
          await putLands.opened
          return new Response('', { status: 200 })
        }
        if (url.endsWith('/me/delete')) return meDeleteWorked()
        return accountDeleted()
      }
      const upload = uploadSession(getSession(ID)!)
      await putSent.opened
      const deletion = deleteAccount()
      await expect(listCloudSessions()).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
      expect(events).toEqual([])
      putLands.open()
      await upload
      await deletion
      expect(api.mock.calls.filter(([url]) => url.endsWith('/me/delete'))).toHaveLength(1)
    })

    it('refused while /me/delete runs: tells the app nothing', async () => {
      const run = startWithListingInFlight(meDeleteWorked)
      await run.listingReached.opened
      const deletion = deleteAccount()
      await run.meDeleteReached.opened
      run.listingAnswered.open()
      await expect(run.listing).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
      expect(events).toEqual([])
      run.meDeleteAnswered.open()
      await deletion
    })

    it.each([
      ['worked', meDeleteWorked],
      ['failed', meDeleteFailed],
    ])('refused, its answer arriving after /me/delete answered (it %s): tells the app nothing', async (outcome, meDeleteAnswer) => {
      const run = startWithListingInFlight(meDeleteAnswer)
      await run.listingReached.opened
      const deletion = deleteAccount()
      await run.meDeleteReached.opened
      run.meDeleteAnswered.open()
      if (outcome === 'worked') await deletion
      else await expect(deletion).rejects.toThrow('API 500')
      run.listingAnswered.open()
      await expect(run.listing).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
      expect(events).toEqual([])
    })
  })
})

// The answer to /me/delete can be lost: the connection drops, the app is
// suspended, or API Gateway gives up after 30 s while the Lambda carries on.
// The server may have deleted everything and kept its marker. This device
// can't tell, so it keeps nothing about it: the delete failed as far as it
// knows, and the next refusal of the account tells the app the same way as
// one caused by another device. Nothing sends the delete again.
describe('a Delete forever whose answer is lost', () => {
  it.each([
    ['the connection drops (no answer)', (): Response => {
      throw new TypeError('Failed to fetch')
    }],
    ['API Gateway gives up (503)', () => answerWith(503, { message: 'Service Unavailable' })],
    ['API Gateway times out (504)', () => answerWith(504, { message: 'Endpoint request timed out' })],
    ['the Lambda crashed (a 500 without its error)', () => answerWith(500, { message: 'Internal Server Error' })],
  ])(
    '%s: a later refusal of the account tells the app like any other, and the delete is not sent again',
    async (_how, lost) => {
      saveSession(record())
      answer = (url) => (url.endsWith('/me/delete') ? lost() : accountDeleted())
      await expect(deleteAccount()).rejects.toThrow()
      expect(events).toEqual([])

      await expect(listCloudSessions()).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
      await expect(exportCloudData()).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
      expect(events.map((e) => e.detail)).toEqual([
        { path: '/sessions/list', account: 'user-1' },
        { path: '/me/export', account: 'user-1' },
      ])
      // Delete forever sent it once, and nothing here sent it again.
      expect(api.mock.calls.filter(([url]) => url.endsWith('/me/delete'))).toHaveLength(1)
      expect(getSession(ID)).toBeDefined()
    },
  )
})

// A refusal can arrive for an account this device has since left: an
// upload's row goes out with the token the upload started with, and a call
// sent before a sign-out can be answered after the next sign-in.
describe('a refusal of an account this device has left', () => {
  it.each([
    ['another account is signed in now: tells the app nothing', fakeIdToken('user-2'), 0],
    ['no one is signed in now: still tells the app', null, 1],
  ])('%s', async (_who, nowSignedIn, told) => {
    const reached = gate()
    const answered = gate()
    answer = async () => {
      reached.open()
      await answered.opened
      return accountDeleted()
    }
    const listing = listCloudSessions()
    await reached.opened
    getIdToken.mockImplementation(async () => nowSignedIn)
    answered.open()
    await expect(listing).rejects.toThrow('API 410: ERR_ACCOUNT_DELETED')
    expect(events).toHaveLength(told)
  })
})

describe('a sync whose listing is refused because the account was deleted', () => {
  it('says so, and sends nothing else: every upload would be refused too', async () => {
    saveSession(record({ sign_photo: 'data:image/jpeg;base64,' + btoa('the sign') }))
    const res = await performInitialSync()
    expect(res).toMatchObject({ listFailed: true, accountDeleted: true, uploaded: 0, pulled: 0 })
    expect(api).toHaveBeenCalledTimes(1)
    expect(getSession(ID)).toBeDefined()
  })

  it('a listing that fails any other way is only a failed listing', async () => {
    answer = () => answerWith(503, { message: 'Service Unavailable' })
    const res = await performInitialSync()
    expect(res).toMatchObject({ listFailed: true, accountDeleted: false })
  })
})
