// The signed departure (build spec T1a).
//
// "I've left" opens the departure sheet, which starts one high-accuracy GPS
// fix straight away (the same request the logger makes at arrival:
// enableHighAccuracy, maximumAge 0). "Confirm I've left" stamps `ended_at`
// with the tap time and closes the sheet at once. App then keeps waiting in
// the background, up to DEPARTURE_FIX_WAIT_MS, for the fix, saves the
// record's `departure` and queues the departure addendum: the tap time, the
// phone's location (or null) and its distance from where the car was
// logged. If the tab closes before that, the departure catch-up in
// signing.ts queues a departure without a location instead.
//
// The location is where the PHONE was when the driver tapped. It doesn't
// show where the car was or when it moved, and the screens say so.
import type { DepartureData, GpsLocation, ParkingSession, PhotoRef, SignedAddendum } from '../types'
import { CAPS } from '../../lambda/addendum-schema.js'
import { ACCURACY_USABLE_M } from './accuracy'
import { chainKeyForAddenda } from './evidence-chain'
import { RECORD_PHOTOS_MAX, photoRefData } from './evidence-photos'
import { haversineMeters } from './geo'
import { addConditionPhotos, addPhotoRefsToRecord, discardUnreferencedRefs } from './record-photos'
import { queueAddendum } from './signing'
import { getSession, updateSession } from './storage'

/** The geolocation request's own timeout. */
export const DEPARTURE_FIX_TIMEOUT_MS = 8_000
/** After Confirm, how long App keeps waiting for the fix before saving without one. */
export const DEPARTURE_FIX_WAIT_MS = 8_000
/**
 * A failed attempt more than this far from the Confirm tap is tried again
 * (the sheet was open a long time, so it may work now), and a fix that
 * came in more than this long after the tap is not used.
 */
export const DEPARTURE_FIX_MAX_AGE_MS = 60_000
/**
 * A fix taken more than this long BEFORE the Confirm tap doesn't say where
 * the phone was at the tap: the sheet's fix is taken when it opens, and a
 * driver who opens it at the bay and confirms from a moving car a minute
 * later would sign the bay. Confirm then starts a fresh fix (inside the
 * click, while the GPS is still warm) and waits for that.
 */
export const DEPARTURE_FIX_PRE_TAP_MAX_MS = 15_000
/**
 * Over this distance from the arrival spot, the record screen says so, once
 * both fixes' error is taken off (`farFromArrival`).
 */
export const DEPARTURE_FAR_M = 150

export interface DepartureFix {
  lat: number
  lng: number
  accuracy_meters: number
  /** Date.now() when the fix arrived. With maximumAge 0 it is a fix from then. */
  received_at: number
}

/**
 * Why there is no location: no geolocation API, permission refused, no
 * position, the request timed out, a fix too rough to keep (worse than
 * ACCURACY_USABLE_M, for example a desktop browser's network location), or
 * anything else.
 */
export type DepartureFixFailure = 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'inaccurate' | 'error'

export type DepartureFixState =
  | { status: 'pending' }
  | { status: 'ok'; fix: DepartureFix }
  | { status: 'none'; reason: DepartureFixFailure; at: number }

export type SettledFixState = Exclude<DepartureFixState, { status: 'pending' }>

/** One GPS fix in flight. Its state changes once, from pending to ok or none. */
export interface DepartureFixRequest {
  /** The latest state. The same object until it changes (for useSyncExternalStore). */
  current(): DepartureFixState
  /** Resolves once the request settles. Never rejects. */
  readonly settled: Promise<SettledFixState>
  /** Be told when the state changes. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
}

export type GeolocationLike = Pick<Geolocation, 'getCurrentPosition'>

function defaultGeolocation(): GeolocationLike | null {
  if (typeof navigator === 'undefined') return null
  const geo = (navigator as Navigator & { geolocation?: Geolocation }).geolocation
  return geo && typeof geo.getCurrentPosition === 'function' ? geo : null
}

/** The fix state for a position the browser returned (pure). */
export function fixFromPosition(
  pos: { coords: Pick<GeolocationCoordinates, 'latitude' | 'longitude' | 'accuracy'> },
  receivedAt: number,
): SettledFixState {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { status: 'none', reason: 'error', at: receivedAt }
  }
  // A fix this rough isn't kept: signing a point that may be in the wrong
  // suburb as the phone's location would mislead whoever reads the record.
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > ACCURACY_USABLE_M) {
    return { status: 'none', reason: 'inaccurate', at: receivedAt }
  }
  return { status: 'ok', fix: { lat, lng, accuracy_meters: accuracy, received_at: receivedAt } }
}

/** GeolocationPositionError codes (1, 2, 3) as a failure reason (pure). */
export function fixFailureReason(err: { code?: number } | null | undefined): DepartureFixFailure {
  switch (err?.code) {
    case 1:
      return 'denied'
    case 2:
      return 'unavailable'
    case 3:
      return 'timeout'
    default:
      return 'error'
  }
}

/**
 * Start one high-accuracy GPS fix for the departure (logic from
 * SessionLogger.requestGps: enableHighAccuracy, maximumAge 0). Never
 * throws; without a geolocation API it settles at once as 'unsupported'.
 */
export function requestDepartureFix(
  options: { geolocation?: GeolocationLike | null; timeoutMs?: number; now?: () => number } = {},
): DepartureFixRequest {
  const geolocation = options.geolocation === undefined ? defaultGeolocation() : options.geolocation
  const now = options.now ?? Date.now
  let state: DepartureFixState = { status: 'pending' }
  const listeners = new Set<() => void>()
  let resolveSettled: (s: SettledFixState) => void = () => {}
  const settled = new Promise<SettledFixState>((resolve) => {
    resolveSettled = resolve
  })
  const settle = (next: SettledFixState) => {
    if (state.status !== 'pending') return
    state = next
    resolveSettled(next)
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (err) {
        console.warn('[departure] a location listener failed:', err)
      }
    }
  }

  if (!geolocation) {
    settle({ status: 'none', reason: 'unsupported', at: now() })
  } else {
    try {
      geolocation.getCurrentPosition(
        (pos) => settle(fixFromPosition(pos, now())),
        (err) => settle({ status: 'none', reason: fixFailureReason(err), at: now() }),
        { enableHighAccuracy: true, timeout: options.timeoutMs ?? DEPARTURE_FIX_TIMEOUT_MS, maximumAge: 0 },
      )
    } catch {
      settle({ status: 'none', reason: 'error', at: now() })
    }
  }

  return {
    current: () => state,
    settled,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/**
 * Was this fix taken close enough to the tap to say where the phone was
 * then? At most DEPARTURE_FIX_PRE_TAP_MAX_MS before the tap (a car can be
 * hundreds of metres away a minute later), or up to
 * DEPARTURE_FIX_MAX_AGE_MS after it (the background wait is shorter).
 */
export function fixUsableAt(fix: DepartureFix, tapMs: number): boolean {
  if (!Number.isFinite(tapMs)) return false
  const before = tapMs - fix.received_at
  return before <= DEPARTURE_FIX_PRE_TAP_MAX_MS && -before <= DEPARTURE_FIX_MAX_AGE_MS
}

/**
 * Should Confirm start a new fix instead of using this one? Yes when the
 * fix isn't usable at the tap (`fixUsableAt`: taken more than
 * DEPARTURE_FIX_PRE_TAP_MAX_MS before it), or a failed attempt that might
 * succeed now is more than DEPARTURE_FIX_MAX_AGE_MS from it. A request
 * still in flight is waited for, and a refused permission or a browser
 * without geolocation isn't asked again.
 */
export function needsFreshFix(state: DepartureFixState, tapMs: number): boolean {
  if (state.status === 'pending') return false
  if (state.status === 'ok') return !fixUsableAt(state.fix, tapMs)
  if (state.reason === 'unsupported' || state.reason === 'denied') return false
  return !Number.isFinite(tapMs) || Math.abs(tapMs - state.at) > DEPARTURE_FIX_MAX_AGE_MS
}

/** The request's settled state, or null when it doesn't settle within `waitMs`. */
export function waitForFix(request: DepartureFixRequest, waitMs: number): Promise<SettledFixState | null> {
  const now = request.current()
  if (now.status !== 'pending') return Promise.resolve(now)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), waitMs)
    void request.settled.then((s) => {
      clearTimeout(timer)
      resolve(s)
    })
  })
}

/** A fix as the signed departure location (N2 `Location`). */
export function departureLocation(fix: DepartureFix): GpsLocation {
  return { lat: fix.lat, lng: fix.lng, accuracy_meters: fix.accuracy_meters, source: 'gps' }
}

/**
 * Whole metres from where the car was logged to where the phone was at the
 * tap, or null when the two can't be compared fairly: no departure
 * location, no arrival location, an arrival address typed in by hand (its
 * point came from a map search, not the phone), or an arrival fix rougher
 * than ACCURACY_USABLE_M. So the distance is always phone GPS to phone GPS.
 */
export function distanceFromArrival(
  session: Pick<ParkingSession, 'location'>,
  location: GpsLocation | null,
): number | null {
  const arrival = session.location
  if (!location || !arrival || arrival.source !== 'gps') return null
  if (!Number.isFinite(arrival.lat) || !Number.isFinite(arrival.lng)) return null
  const accuracy = arrival.accuracy_meters
  if (typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy > ACCURACY_USABLE_M) return null
  const meters = haversineMeters(arrival, location)
  return Number.isFinite(meters) ? Math.round(meters) : null
}

/**
 * Should the record screen say the phone was far from where the car was
 * logged? Only when the distance still exceeds DEPARTURE_FAR_M after taking
 * off both fixes' error, so two rough fixes (say ±95 m each, common in a
 * CBD street) of a phone that never left the bay don't read as "180 m
 * away". An accuracy that isn't known counts as the worst usable one
 * (ACCURACY_USABLE_M). The signed distance itself is never changed.
 */
export function farFromArrival(
  distanceM: number | null,
  arrivalAccuracyM: number | null | undefined,
  departureAccuracyM: number | null | undefined,
): boolean {
  if (distanceM === null || !Number.isFinite(distanceM)) return false
  const error = (a: number | null | undefined) =>
    typeof a === 'number' && Number.isFinite(a) && a >= 0 ? a : ACCURACY_USABLE_M
  return distanceM - (error(arrivalAccuracyM) + error(departureAccuracyM)) > DEPARTURE_FAR_M
}

/**
 * The departure addendum's data for a tap (pure). `returnPhotos` are the
 * condition photos taken on the departure sheet (return-* roles), at most
 * five.
 */
export function buildDepartureData(
  session: Pick<ParkingSession, 'location'>,
  endedAt: string,
  location: GpsLocation | null,
  returnPhotos: readonly PhotoRef[] = [],
): DepartureData {
  return {
    ended_at: endedAt,
    location,
    distance_from_arrival_m: distanceFromArrival(session, location),
    return_photos: returnPhotos.slice(0, CAPS.returnPhotos).map(photoRefData),
  }
}

/** The record's own `departure` field for departure data. */
export function departureField(data: DepartureData): NonNullable<ParkingSession['departure']> {
  return {
    ended_at: data.ended_at,
    location: data.location,
    distance_from_arrival_m: data.distance_from_arrival_m,
  }
}

export type DepartureResult =
  | { status: 'saved'; data: DepartureData; addendum: SignedAddendum | null }
  | { status: 'skipped'; reason: 'missing' | 'shared' | 'not_this_tap' }

/**
 * Keep return photos that no departure part of this tap carries: signed as
 * their own condition part (`when: 'return'`) when the chain can take one,
 * else listed on the record unsigned (the record screen says they aren't
 * in a signed part) when there is room for their refs. Returns false when
 * neither worked; the caller then tidies their bytes away. Never throws.
 */
function keepReturnPhotos(sessionId: string, canExtend: boolean, returnPhotos: readonly PhotoRef[]): boolean {
  const photos = returnPhotos.slice(0, CAPS.returnPhotos).map(photoRefData)
  try {
    if (canExtend && addConditionPhotos(sessionId, 'return', photos, null)) return true
  } catch (err) {
    console.warn('[departure] could not sign the return photos:', err)
  }
  try {
    const session = getSession(sessionId)
    if (!session || session.shared_from) return false
    const listed = Array.isArray(session.photos) ? session.photos.length : 0
    if (listed + photos.length > RECORD_PHOTOS_MAX) return false
    console.warn('[departure] no part could carry the return photos; they are kept on the record, unsigned')
    return addPhotoRefsToRecord(sessionId, photos)
  } catch (err) {
    console.warn('[departure] could not keep the return photos:', err)
    return false
  }
}

/**
 * Store the departure for a tap: the record's `departure` field (unless it
 * already has one) and the departure addendum, queued for signing on the
 * record's queue. Skipped when the record is gone, is a shared copy, or no
 * longer carries this tap's `ended_at` (another tap or device ended it).
 *
 * When the record already has a departure addendum (the catch-up got there
 * first), no second one is queued, and the field, if missing, copies that
 * addendum's data so the record says what is signed. An addendum is queued
 * only when this device can extend the chain (`chainKeyForAddenda`), the
 * same rule the catch-up follows. Never throws.
 *
 * `returnPhotos` (the departure sheet's condition photos) go into the
 * departure addendum and the record's `photos`. When no departure part of
 * this tap can carry them (one was already queued, another tap ended the
 * record, or the record can't take the part), they are signed as their own
 * condition part (`when: 'return'`), or failing that listed on the record
 * unsigned, so they never silently disappear. `completeDeparture` tidies
 * the bytes of any the record ends up not referring to.
 */
export function saveDeparture(
  sessionId: string,
  endedAt: string,
  location: GpsLocation | null,
  onRecordUpdated?: (sessionId: string) => void,
  returnPhotos: readonly PhotoRef[] = [],
): DepartureResult {
  const session = getSession(sessionId)
  if (!session) return { status: 'skipped', reason: 'missing' }
  if (session.shared_from) return { status: 'skipped', reason: 'shared' }
  if (session.ended_at !== endedAt) {
    // Another tap or device ended the record. Photos taken on this sheet
    // are still the car's condition on return.
    if (returnPhotos.length > 0 && keepReturnPhotos(sessionId, chainKeyForAddenda(session) !== undefined, returnPhotos)) {
      notifyUpdated(sessionId, onRecordUpdated)
    }
    return { status: 'skipped', reason: 'not_this_tap' }
  }

  const existing = (session.addenda ?? []).find((a) => a.kind === 'departure') ?? null
  const data = existing
    ? (existing.data as unknown as DepartureData)
    : buildDepartureData(session, endedAt, location, returnPhotos)
  const canExtend = chainKeyForAddenda(session) !== undefined
  let changed = false
  if (session.departure === undefined) {
    try {
      updateSession(sessionId, { departure: departureField(data) })
      changed = true
    } catch (err) {
      console.warn('[departure] could not save the departure:', err)
    }
  }
  let addendum: SignedAddendum | null = existing
  if (!existing && canExtend) {
    try {
      addendum = queueAddendum(sessionId, 'departure', data)
      if (addendum) changed = true
    } catch (err) {
      console.warn('[departure] could not queue the departure addendum:', err)
    }
  }
  if (returnPhotos.length > 0) {
    if (addendum && !existing) {
      // Signed in the departure part just queued, which carries them (so
      // their bytes are kept even if listing them fails).
      try {
        addPhotoRefsToRecord(sessionId, data.return_photos)
        changed = true
      } catch (err) {
        console.warn('[departure] the return photos are in the departure part, but could not be listed on the record:', err)
      }
    } else if (keepReturnPhotos(sessionId, canExtend, returnPhotos)) {
      // The departure part was already queued without them, or none could be.
      changed = true
    }
  }
  if (changed) notifyUpdated(sessionId, onRecordUpdated)
  return { status: 'saved', data, addendum }
}

function notifyUpdated(sessionId: string, onRecordUpdated?: (sessionId: string) => void): void {
  try {
    onRecordUpdated?.(sessionId)
  } catch (err) {
    console.warn('[departure] record-updated callback failed:', err)
  }
}

export interface CompleteDepartureOptions {
  /** How long to keep waiting for the fix after the tap. Default DEPARTURE_FIX_WAIT_MS. */
  waitMs?: number
  /**
   * The departure sheet's condition photos (return-* roles): their refs once
   * their writes have settled (each within PHOTO_WRITE_TIMEOUT_MS). Waited
   * for alongside the fix.
   */
  returnPhotos?: Promise<PhotoRef[]> | readonly PhotoRef[]
  /** Starts a fresh fix when the sheet's one is too old (tests inject a fake). */
  requestFix?: () => DepartureFixRequest
  /** Called after the record was written (App mirrors it to the cloud when signed in). */
  onRecordUpdated?: (sessionId: string) => void
}

/**
 * App's departure orchestrator, run after "Confirm I've left" stamped
 * `endedAt`: wait (up to `waitMs`) for the sheet's fix, or a fresh one when
 * that is too far from the tap, then `saveDeparture` with the location,
 * or with none when there is no usable fix in time. Never rejects.
 *
 * Call it from the Confirm click itself: a fresh fix is requested before
 * the first await, so it starts inside the user gesture.
 */
export async function completeDeparture(
  sessionId: string,
  endedAt: string,
  request: DepartureFixRequest | null,
  options: CompleteDepartureOptions = {},
): Promise<DepartureResult> {
  const tapMs = Date.parse(endedAt)
  const requestFix = options.requestFix ?? (() => requestDepartureFix())
  const photos: Promise<readonly PhotoRef[]> = Promise.resolve(options.returnPhotos ?? []).catch((err) => {
    console.warn('[departure] could not keep the return photos:', err)
    return []
  })
  let location: GpsLocation | null = null
  try {
    let active = request ?? requestFix()
    if (needsFreshFix(active.current(), tapMs)) active = requestFix()
    const state = await waitForFix(active, options.waitMs ?? DEPARTURE_FIX_WAIT_MS)
    if (state?.status === 'ok' && fixUsableAt(state.fix, tapMs)) location = departureLocation(state.fix)
  } catch (err) {
    console.warn('[departure] could not get a location:', err)
  }
  const returnPhotos = await photos
  const result = saveDeparture(sessionId, endedAt, location, options.onRecordUpdated, returnPhotos)
  // Return photos the record doesn't refer to after all (it's gone, or no
  // part and no room could take them) don't stay on the device.
  await discardUnreferencedRefs(sessionId, returnPhotos)
  return result
}

/**
 * The departure sheet's photos after a Confirm that didn't end the record
 * (it was ended meanwhile, by another tap or device, or it's gone, or the
 * end couldn't be stored): kept on the record as return photos when it
 * exists and has ended (see keepReturnPhotos), else tidied away. Never
 * rejects.
 */
export async function settleReturnPhotos(
  sessionId: string,
  returnPhotos: Promise<PhotoRef[]> | readonly PhotoRef[] | undefined,
  onRecordUpdated?: (sessionId: string) => void,
): Promise<void> {
  let refs: readonly PhotoRef[]
  try {
    refs = await Promise.resolve(returnPhotos ?? [])
  } catch (err) {
    console.warn('[departure] could not keep the return photos:', err)
    return
  }
  if (refs.length === 0) return
  const session = getSession(sessionId)
  // Only an ended record has a return; one that couldn't be ended (storage full) keeps nothing.
  if (session && !session.shared_from && session.ended_at && keepReturnPhotos(sessionId, chainKeyForAddenda(session) !== undefined, refs)) {
    notifyUpdated(sessionId, onRecordUpdated)
  }
  await discardUnreferencedRefs(sessionId, refs)
}
