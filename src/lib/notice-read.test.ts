// Reading a notice photo into the notice screen's snapshot (build spec T8
// item 4): the photo goes to /read-notice without its data-URL prefix, the
// place is geocoded with the issuing state and country added, a geocode
// that fails or hangs never blocks the screen, and the date and time come
// from the printed date read day first, not from the model's reading.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeFields } from '../types'

const mocks = vi.hoisted(() => ({
  readNotice: vi.fn<(base64: string, mediaType?: string) => Promise<NoticeFields>>(),
  forwardGeocode: vi.fn<(q: string) => Promise<{ lat: number; lng: number; address: string } | null>>(),
}))
vi.mock('./claude', () => ({ readNotice: mocks.readNotice }))
vi.mock('./geocode', () => ({ forwardGeocode: mocks.forwardGeocode }))

import { NOTICE_GEOCODE_TIMEOUT_MS, noticeInputValues, readNoticeSnapshot } from './notice-read'

const FIELDS: NoticeFields = {
  legibility: 'clear',
  notice_number: 'PIN 1',
  issuing_authority: 'Fines Victoria',
  offence_date_raw: '04/05/2027',
  offence_time_raw: '2:10 PM',
  // The model read the date month first: 5 April.
  offence_datetime_local: '2027-04-05T14:10',
  location_text: 'Lygon St, Carlton',
  offence_code: null,
  offence_description: null,
  amount: null,
  due_date: null,
}
const PHOTO = { dataUrl: 'data:image/png;base64,Tk9USUNF', mediaType: 'image/png' }

beforeEach(() => {
  mocks.readNotice.mockReset()
  mocks.forwardGeocode.mockReset()
  mocks.readNotice.mockResolvedValue(FIELDS)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('readNoticeSnapshot', () => {
  it('sends the bare base64, geocodes the place with the state and country, and reads the date day first', async () => {
    mocks.forwardGeocode.mockResolvedValue({ lat: -37.8, lng: 144.97, address: 'Lygon St' })
    const snap = await readNoticeSnapshot(PHOTO)
    expect(mocks.readNotice).toHaveBeenCalledWith('Tk9USUNF', 'image/png')
    expect(mocks.forwardGeocode).toHaveBeenCalledWith('Lygon St, Carlton, VIC, Australia')
    expect(snap).toEqual({
      photo: PHOTO,
      fields: FIELDS,
      date: '2027-05-04',
      time: '14:10',
      noticePoint: { lat: -37.8, lng: 144.97 },
      issuingState: 'VIC',
      selectedId: null,
    })
  })

  it('a geocode that fails leaves the place unknown', async () => {
    mocks.forwardGeocode.mockRejectedValue(new Error('offline'))
    expect((await readNoticeSnapshot(PHOTO)).noticePoint).toBeNull()
  })

  it('a geocode that hangs is given up after the timeout', async () => {
    vi.useFakeTimers()
    mocks.forwardGeocode.mockReturnValue(new Promise(() => {}))
    const pending = readNoticeSnapshot(PHOTO)
    await vi.advanceTimersByTimeAsync(NOTICE_GEOCODE_TIMEOUT_MS)
    const snap = await pending
    expect(snap.noticePoint).toBeNull()
    expect(snap.date).toBe('2027-05-04')
  })

  it('no place on the notice: no geocode; no date or time: empty inputs', async () => {
    mocks.readNotice.mockResolvedValue({
      ...FIELDS,
      location_text: null,
      offence_date_raw: null,
      offence_time_raw: null,
      offence_datetime_local: null,
    })
    const snap = await readNoticeSnapshot(PHOTO)
    expect(mocks.forwardGeocode).not.toHaveBeenCalled()
    expect([snap.date, snap.time, snap.noticePoint]).toEqual(['', '', null])
  })

  it('passes a reading error through', async () => {
    mocks.readNotice.mockRejectedValue(new Error("We couldn't read that notice."))
    await expect(readNoticeSnapshot(PHOTO)).rejects.toThrow("We couldn't read that notice.")
  })
})

describe('noticeInputValues', () => {
  it('formats a wall-clock time for the date and time inputs', () => {
    expect(noticeInputValues({ year: 2027, month: 5, day: 4, hour: 9, minute: 5 })).toEqual({ date: '2027-05-04', time: '09:05' })
    expect(noticeInputValues(null)).toEqual({ date: '', time: '' })
  })
})
