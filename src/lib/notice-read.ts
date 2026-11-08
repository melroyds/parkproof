// Reading a fine notice photo for the notice screen (build spec T8 item 4):
// the /read-notice call, the issuing state, the best-effort forward
// geocode of the notice's place, and the date and time as notice-match
// reads them (the printed date day first). Kept out of the component so
// the screen file exports components only.
import type { LoadingStage } from '../components/LoadingProgress'
import type { Jurisdiction, NoticeFields } from '../types'
import { readNotice } from './claude'
import { forwardGeocode } from './geocode'
import {
  formatWallClock,
  inferIssuingState,
  noticeGeocodeQuery,
  noticeLocalTime,
  type LatLng,
  type WallClock,
} from './notice-match'

/** A notice photo already resized for upload (a data URL and its media type). */
export interface CapturedNotice {
  dataUrl: string
  mediaType: string
}

/**
 * Everything the notice screen knows once a notice has been read: kept by
 * App while the driver is in the appeal flow, so Back returns to the same
 * screen without reading the notice again. Lives in memory only; the
 * notice photo is never stored on the device.
 */
export interface NoticeSnapshot {
  photo: CapturedNotice
  fields: NoticeFields
  /** The date on the notice as the driver last left it: 'YYYY-MM-DD', or '' when unknown. */
  date: string
  /** The time on the notice as the driver last left it: 'HH:MM', or '' when unknown. */
  time: string
  /** The forward geocode of the notice's location, or null. */
  noticePoint: LatLng | null
  issuingState: Jurisdiction | null
  /** The record the driver chose to compare with; null for the best match. */
  selectedId: string | null
}

/** The reading screen's steps (LoadingProgress). The last shows only when reading runs long. */
export const NOTICE_READING_STAGES: readonly LoadingStage[] = [
  { ms: 0, labelKey: 'notice.reading.step1', translated: true },
  { ms: 3000, labelKey: 'notice.reading.step2', translated: true },
  { ms: 6000, labelKey: 'notice.reading.step3', translated: true },
  { ms: 14000, labelKey: 'notice.reading.slow', translated: true, overflow: true },
]

/** The forward geocode of the notice's place waits this long at most; matching works without it. */
export const NOTICE_GEOCODE_TIMEOUT_MS = 6000

/** The date and time inputs' values ('YYYY-MM-DD', 'HH:MM') for a wall-clock time, or '' for both. */
export function noticeInputValues(local: WallClock | null): { date: string; time: string } {
  if (!local) return { date: '', time: '' }
  const [date, time] = formatWallClock(local).split('T')
  return { date, time }
}

/** The geocoded point of `query`, or null when there is none, it fails, or it takes longer than `ms`. */
export async function geocodeWithin(query: string, ms: number): Promise<LatLng | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  try {
    const hit = await Promise.race([forwardGeocode(query).catch(() => null), timeout])
    return hit ? { lat: hit.lat, lng: hit.lng } : null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Read a notice photo into a snapshot. Throws what readNotice throws (an
 * ApiError with localised copy). The geocode never throws: without it the
 * records are matched by time alone, in the issuing state's zone.
 */
export async function readNoticeSnapshot(photo: CapturedNotice): Promise<NoticeSnapshot> {
  const base64 = photo.dataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
  const fields = await readNotice(base64, photo.mediaType)
  const issuingState = inferIssuingState(fields)
  const query = noticeGeocodeQuery(fields, issuingState)
  const noticePoint = query ? await geocodeWithin(query, NOTICE_GEOCODE_TIMEOUT_MS) : null
  const { date, time } = noticeInputValues(noticeLocalTime(fields).local)
  return { photo, fields, date, time, noticePoint, issuingState, selectedId: null }
}
