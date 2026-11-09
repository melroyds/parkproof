// The client side of /read-notice (build spec T8 item 1): readNotice posts
// the photo to the job route, and the route's ERR codes map to their own
// copy (src/lib/api.ts ERROR_CODE_KEYS), with English fallbacks that match
// en.json.
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../locales/en.json'

const { postJsonAndPoll } = vi.hoisted(() => ({ postJsonAndPoll: vi.fn(async () => ({})) }))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api')>()), postJsonAndPoll }))

import { friendlyErrorFor } from './api'
import { NOTICE_ERROR_COPY, readNotice } from './claude'

type I18nHolder = { __parkproof_i18n?: { t: (key: string) => string } }

function lookup(key: string): string {
  let node: unknown = en
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  return typeof node === 'string' ? node : key
}

afterEach(() => {
  delete (globalThis as I18nHolder).__parkproof_i18n
})

describe('readNotice', () => {
  it('posts the photo to /read-notice through the job poller, with the notice\'s own error copy', async () => {
    await readNotice('aGVsbG8=', 'image/png')
    expect(postJsonAndPoll).toHaveBeenCalledWith(
      '/read-notice',
      { image_base64: 'aGVsbG8=', media_type: 'image/png' },
      { copy: NOTICE_ERROR_COPY },
    )
    await readNotice('aGVsbG8=')
    expect(postJsonAndPoll).toHaveBeenLastCalledWith(
      '/read-notice',
      { image_base64: 'aGVsbG8=', media_type: 'image/jpeg' },
      { copy: NOTICE_ERROR_COPY },
    )
  })

  it('has English fallbacks identical to en.json, and none of them talks about a sign or a scan', () => {
    const pairs = [NOTICE_ERROR_COPY.timeout, NOTICE_ERROR_COPY.heavyLoad, ...Object.values(NOTICE_ERROR_COPY.codes ?? {})]
    expect(pairs).toHaveLength(3)
    for (const pair of pairs) {
      const [key, fallback] = pair as [string, string]
      expect(lookup(key), key).toBe(fallback)
      expect(fallback).not.toMatch(/\bsign\b|\bscan\b/i)
    }
  })
})

describe('postJsonAndPoll with the notice copy (the real poller, fetch mocked)', () => {
  type Reply = { status: number; body: unknown }
  const reply = ({ status, body }: Reply) => new Response(JSON.stringify(body), { status })
  async function failureOf(replies: Reply[], copy: typeof NOTICE_ERROR_COPY | undefined): Promise<string> {
    const real = await vi.importActual<typeof import('./api')>('./api')
    const queue = [...replies]
    vi.stubGlobal('fetch', vi.fn(async () => reply(queue.shift() as Reply)))
    vi.useFakeTimers()
    try {
      const outcome = real.postJsonAndPoll('/read-notice', { image_base64: 'aGVsbG8=' }, { copy }).then(
        () => 'resolved',
        (err: Error) => err.message,
      )
      await vi.runAllTimersAsync()
      return await outcome
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  }

  it('a job past its deadline says the notice, not "your scan", didn\'t finish', async () => {
    ;(globalThis as I18nHolder).__parkproof_i18n = { t: lookup }
    const replies: Reply[] = [
      { status: 202, body: { job_id: 'j', status: 'pending' } },
      { status: 200, body: { status: 'error', result: null, error: 'JOB_TIMED_OUT' } },
    ]
    expect(await failureOf(replies, NOTICE_ERROR_COPY)).toBe(en.errors.noticeHeavyLoad)
    expect(await failureOf(replies, undefined)).toBe(en.errors.heavyLoad)
  })

  it('two server errors in a row give the generic line, never "This sign took too long"', async () => {
    ;(globalThis as I18nHolder).__parkproof_i18n = { t: lookup }
    const replies: Reply[] = [
      { status: 500, body: { error: 'ERR_INTERNAL' } },
      { status: 503, body: { message: 'Service Unavailable' } },
    ]
    expect(await failureOf(replies, NOTICE_ERROR_COPY)).toBe(en.errors.genericRetry)
    expect(await failureOf(replies, undefined)).toBe(en.errors.complexSignTimeout)
  })

  it('an oversized photo is described as a notice photo, whether refused up front or by the job', async () => {
    ;(globalThis as I18nHolder).__parkproof_i18n = { t: lookup }
    expect(await failureOf([{ status: 400, body: { error: 'ERR_IMAGE_TOO_LARGE' } }], NOTICE_ERROR_COPY)).toBe(
      en.errors.noticeImageTooLarge,
    )
    const fromJob: Reply[] = [
      { status: 202, body: { job_id: 'j', status: 'pending' } },
      { status: 200, body: { status: 'error', result: null, error: 'ERR_IMAGE_TOO_LARGE' } },
    ]
    expect(await failureOf(fromJob, NOTICE_ERROR_COPY)).toBe(en.errors.noticeImageTooLarge)
    // Other codes keep their shared copy.
    expect(await failureOf([{ status: 400, body: { error: 'ERR_NOT_A_NOTICE' } }], NOTICE_ERROR_COPY)).toBe(en.errors.notANotice)
    expect(await failureOf([{ status: 400, body: { error: 'ERR_IMAGE_TOO_LARGE' } }], undefined)).toBe(en.errors.imageTooLarge)
  })
})

describe('friendlyErrorFor: notice codes', () => {
  it('maps each code to its own string', () => {
    ;(globalThis as I18nHolder).__parkproof_i18n = { t: lookup }
    expect(friendlyErrorFor('ERR_NOTICE_UNREADABLE')).toBe(en.errors.noticeUnreadable)
    expect(friendlyErrorFor('ERR_NOT_A_NOTICE')).toBe(en.errors.notANotice)
    expect(en.errors.noticeUnreadable).not.toBe(en.errors.notANotice)
    // Codes without their own copy fall back to the generic line, never the raw code.
    expect(friendlyErrorFor('ERR_INTERNAL')).toBe(en.errors.genericRetry)
    expect(friendlyErrorFor('ERR_BAD_REQUEST')).toBe(en.errors.genericRetry)
  })

  it('falls back to English text identical to en.json before i18n loads', () => {
    expect(friendlyErrorFor('ERR_NOTICE_UNREADABLE')).toBe(en.errors.noticeUnreadable)
    expect(friendlyErrorFor('ERR_NOT_A_NOTICE')).toBe(en.errors.notANotice)
  })
})
