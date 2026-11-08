import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { BoundaryAnswer, ComplianceType, LogDraft, ParkingRules, ParkingSession, PhotoRef, PlaceParts } from '../types'
import { forwardGeocode, reverseGeocodeDetails } from '../lib/geocode'
import { jurisdictionOfPlace } from '../lib/jurisdiction'
import { resizeImageFile } from '../lib/image'
import { deleteSessionPhotos, isPhotoStoreAvailable } from '../lib/photo-store'
import {
  captureMetaFor,
  storeSessionPhoto,
  whenPhotoWritesSettle,
  type PhotoCaptureMeta,
} from '../lib/session-photos'
import {
  ACCURACY_DANGER_M,
  ACCURACY_USABLE_M,
  formatAccuracy,
} from '../lib/accuracy'
import { noSignReadingFields, signReadingFields, type NoSignReading } from '../lib/sign-result'
import { fitText } from '../lib/evidence-chain'
import {
  CONDITION_NOTE_MAX,
  allowedComplianceType,
  gridRoles,
  preselectedComplianceType,
  proofGates,
  withPermitGate,
} from '../lib/evidence-photos'
import { discardUnreferencedPhotos } from '../lib/record-photos'
import { DRIVER_NAME_MAX, defaultDriverName, driverBadgeText, savedDriverName } from '../lib/driver-name'
import { usePhotoSlots } from '../lib/use-photo-slots'
import { useNow } from '../lib/use-now'
import { loadSessions } from '../lib/storage'
import { isWorkdayEnabled } from '../lib/features'
import { timezoneForCoords } from '../lib/timezone'
import {
  answerStartsNewLimit,
  offeredAnswer,
  stopBoundaryCheck,
  stopBoundaryStatement,
  stopContext,
  stopDeadlinePassed,
  stopOutcome,
  type StopContext,
} from '../lib/workday-boundary'
import BoundaryQuestion from './BoundaryQuestion'
import CollapsibleSection from './CollapsibleSection'
import PhotoAngleGrid from './PhotoAngleGrid'
import ProofPhotoSection from './ProofPhotoSection'
import Icon from './Icon'
import Button from './ui/Button'
import BackButton from './ui/BackButton'
import Card from './ui/Card'
import Input from './ui/Input'

interface Props {
  /**
   * Sign-translation result. `null` only when `mode === 'no-sign'` — the user
   * is logging an unsigned spot and there's nothing for the AI to have
   * returned.
   */
  rules: ParkingRules | null
  /**
   * Sign photo. `null` only when `mode === 'no-sign'`.
   */
  signPhoto: string | null
  /**
   * When and how the sign photo was captured on the scan screen (for its
   * PhotoRef). Missing: the time the logger opened, and 'library'.
   */
  signPhotoMeta?: PhotoCaptureMeta | null
  /**
   * Surroundings photo for no-sign sessions, demonstrating that no signs
   * were visible. Opt-in by the user on the scan screen.
   */
  ambientPhoto?: string | null
  /** Capture metadata for the surroundings photo, as for `signPhotoMeta`. */
  ambientPhotoMeta?: PhotoCaptureMeta | null
  /**
   * No-sign mode from the "no readable sign" screen (T3): the sign reader
   * found no readable parking sign in the scan photo, which is now the
   * surroundings photo. The record keeps that status, and the photo gets
   * its own caption.
   */
  noSignReading?: NoSignReading | null
  /**
   * Pre-seeded coords from a prior screen. When null, SessionLogger fetches
   * GPS itself. Currently unused — geolocation requests cache anyway, so
   * re-fetching is fast — but kept here for the future no-sign deeplink case.
   */
  coords?: { lat: number; lng: number } | null
  /**
   * Drives the rendering differences:
   *  - 'sign'    → normal flow (header copy, rules summary at top, reminder next)
   *  - 'no-sign' → simplified flow (no rules, ambient-photo evidence, save → home)
   */
  mode?: 'sign' | 'no-sign'
  /**
   * What the scan views carried for this record (the result screen's gate
   * acknowledgements, later the permit and the driver). The gates decide
   * whether the proof-of-payment section opens with a preselected type;
   * `gate_acks` is saved on the record. Missing: an empty draft.
   */
  draft?: LogDraft | null
  onComplete: (session: ParkingSession) => void
  onCancel: () => void
}

/**
 * The car photo taken in the logger. Its bytes go into the photo store as
 * soon as it is taken; `ref` exists only once that write has completed.
 * 'inRecord': this browser has no working photo store (no IndexedDB, or it
 * can't be opened), so a retry can't help. The photo is then kept in the
 * record itself on save, as the scan's sign and surroundings photos are.
 */
type CarPhoto =
  | { status: 'saving'; dataUrl: string; meta: PhotoCaptureMeta }
  | { status: 'saved'; dataUrl: string; meta: PhotoCaptureMeta; ref: PhotoRef }
  | { status: 'inRecord'; dataUrl: string; meta: PhotoCaptureMeta }
  | { status: 'failed'; dataUrl: string; meta: PhotoCaptureMeta }

/**
 * How a car photo write ended: its PhotoRef; 'inRecord' when there is no
 * working photo store; null when the write failed or timed out (a retry
 * may work).
 */
type CarWriteResult = PhotoRef | 'inRecord' | null

/**
 * How long Save waits for the reverse lookup of the GPS fix still in flight,
 * on a workday stop only (T6b item 7): the stop's state comes from that
 * lookup alone, and without it the park can't be a stop. It is then saved as
 * a normal record that keeps the running limit the driver was shown, and
 * the workday stops. Other records save at once, as before.
 */
export const WORKDAY_PLACE_WAIT_MS = 5_000

/** Input types that take typing: focus is never pulled away from one. */
const NON_TYPING_INPUTS = new Set(['radio', 'checkbox', 'button', 'submit', 'reset', 'file', 'image', 'range', 'color'])

/** Whether the driver is typing in this element (a text field, a text area, an editable region). */
function isTypingTarget(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) return !NON_TYPING_INPUTS.has(el.type)
  return el instanceof HTMLElement && el.isContentEditable
}

type GpsState =
  | { status: 'idle' }
  | { status: 'pending' }
  | {
      status: 'ok'
      coords: { lat: number; lng: number }
      accuracy: number
      address: string | null
      /**
       * Raw reverse-geocode parts for the record's `place` (T6a), from the
       * reverse lookup of this GPS fix only. Null until it arrives, for a
       * fix too inaccurate to look up, and always for a typed address (a
       * typed address never supplies a place or a jurisdiction).
       */
      place: PlaceParts | null
      addressLoading: boolean
      source: 'gps' | 'manual'
    }
  | { status: 'error'; message: string }

export default function SessionLogger({
  rules,
  signPhoto,
  signPhotoMeta = null,
  ambientPhoto = null,
  ambientPhotoMeta = null,
  noSignReading = null,
  mode = 'sign',
  draft = null,
  onComplete,
  onCancel,
}: Props) {
  const isNoSign = mode === 'no-sign'
  const { t } = useTranslation()
  // The record's id is minted when the logger opens, because its photos are
  // stored under it as they are taken (photo-store key `${id}/${sha256}`).
  const [recordId] = useState(() => crypto.randomUUID())
  const [carPhoto, setCarPhoto] = useState<CarPhoto | null>(null)
  const [carReadError, setCarReadError] = useState<string | null>(null)
  // Every photo-store write this logger started (including photos replaced
  // since), so save and cancel can wait for them all before tidying up.
  // Each one settles within PHOTO_WRITE_TIMEOUT_MS.
  const photoWrites = useRef<Promise<unknown>[]>([])
  // The scan screen's photos, written once when the logger opens.
  const scanPhotoWrites = useRef<{ sign?: Promise<PhotoRef | null>; ambient?: Promise<PhotoRef | null> }>({})
  // The data URL of every sign, surroundings and car photo this logger
  // wrote. After Save, only these (minus the ones the record keeps) are
  // tidied away: once saved, the record can gain photos from other screens
  // (the add-photo sheets, the departure sheet), and those must stay.
  const writtenUrls = useRef<string[]>([])
  // The current car photo's write. Null when there is no car photo; a
  // newer photo (or Retake) replaces it, so a late result for an older
  // photo is ignored.
  const carWrite = useRef<{ result: Promise<CarWriteResult>; dataUrl: string } | null>(null)
  // Set once the logger is cancelled or its Save has started: a photo still
  // being resized then is dropped, and Retry and Retake do nothing, so no
  // write starts after the record's photos were deleted (cancel) or tidied
  // (save).
  const closed = useRef(false)
  // Set once Save has started. The record id is minted once per logger, so
  // saving twice would store the same record twice (saveSession refuses
  // that), and from then on the record is being kept: Cancel and Back do
  // nothing (and are disabled). The ref is the real guard (synchronous);
  // the state disables the buttons visually.
  const submittedRef = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  // Initialise the GPS state synchronously based on API availability — avoids
  // setState-in-effect lint by deciding 'pending' vs 'error' here.
  const [gps, setGps] = useState<GpsState>(() => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      return { status: 'pending' }
    }
    return { status: 'error', message: t('logger.gpsErrorUnsupported') }
  })
  // The reverse lookup in flight for the latest GPS fix, so a workday
  // stop's Save can wait for its place (see WORKDAY_PLACE_WAIT_MS).
  const placeLookup = useRef<{ coords: { lat: number; lng: number }; place: Promise<PlaceParts | null> } | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [editStatus, setEditStatus] = useState<'idle' | 'pending'>('idle')
  const [editError, setEditError] = useState<string | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  // "Record the car's condition (optional)": collapsed until the driver
  // opens it. Its photos and the damage note go into the arrival_context.
  const trackWrite = (write: Promise<unknown>) => {
    photoWrites.current.push(write)
  }
  const conditionSlots = usePhotoSlots(recordId, trackWrite)
  const [conditionOpen, setConditionOpen] = useState(false)
  const [conditionNote, setConditionNote] = useState('')
  // Proof of payment or permit. When the result screen asked a gate (or the
  // sign reading calls for one, or the driver confirmed a saved permit
  // there), the section is open with one button and the type preselected
  // from the gate; otherwise it is collapsed. The record screen reads its
  // gates the same way (recordProofGates), so both preselect the same type.
  const gates = withPermitGate(proofGates(rules, draft?.gate_acks), draft?.permit_context)
  const proofGated = gates.length > 0
  const proofSlots = usePhotoSlots(recordId, trackWrite)
  const [proofOpen, setProofOpen] = useState(false)
  const [proofType, setProofType] = useState<ComplianceType | null>(() => preselectedComplianceType(gates))
  // "Who's driving?" (T7): optional, prefilled from the draft, else the
  // name saved in Settings (T4; see defaultDriverName). Saved on the record
  // and signed in the arrival_context.
  const [driverName, setDriverName] = useState(() => defaultDriverName(draft))
  // Collapsed by default (an optional step); the closed toggle shows the
  // name that will be saved, so a prefilled name is never hidden.
  const [driverOpen, setDriverOpen] = useState(false)
  const driverBadge = driverBadgeText(driverName)
  // The boundary question (T6b item 8), on a workday stop only (never with
  // VITE_FEATURE_WORKDAY off). The workday's saved legs are read once, when
  // the logger opens; the first stop has no question.
  const [stop] = useState<StopContext | null>(() =>
    draft?.workday && !isNoSign && rules && isWorkdayEnabled()
      ? stopContext(loadSessions(), draft.workday.workday_id)
      : null,
  )
  const [boundaryAnswer, setBoundaryAnswer] = useState<BoundaryAnswer | null>(null)
  // Save was tapped while the question needed an answer: show it even if
  // the location is still coming in, and say an answer is needed.
  const [boundaryBlocked, setBoundaryBlocked] = useState(false)
  const [boundaryRequired, setBoundaryRequired] = useState(false)
  const [focusNotSure, setFocusNotSure] = useState(0)
  const notSureRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusNotSure > 0) notSureRef.current?.focus()
  }, [focusNotSure])
  // A workday stop's Save can wait a few seconds for the place lookup
  // (WORKDAY_PLACE_WAIT_MS); Save, Back and Cancel are disabled meanwhile.
  const checkingRef = useRef(false)
  const [checking, setChecking] = useState(false)
  const busy = submitting || checking
  // Ticks the "still runs" and deadline-passed lines while the logger is
  // open. A Save that found the time already ended moves it on at once, so
  // the screen agrees with what Save found.
  const ticked = useNow(30_000)
  const [blockedAt, setBlockedAt] = useState(0)
  const now = Math.max(ticked, blockedAt)

  const startEdit = () => {
    if (gps.status !== 'ok' && gps.status !== 'error') return
    setEditValue(gps.status === 'ok' ? gps.address ?? '' : '')
    setEditError(null)
    setEditStatus('idle')
    setEditMode(true)
  }

  const cancelEdit = () => {
    setEditMode(false)
    setEditValue('')
    setEditError(null)
    setEditStatus('idle')
  }

  const submitEdit = async () => {
    const trimmed = editValue.trim()
    if (!trimmed) {
      setEditError(t('logger.enterAddressFirst'))
      return
    }
    setEditStatus('pending')
    setEditError(null)
    const result = await forwardGeocode(trimmed)
    if (!result) {
      setEditStatus('idle')
      setEditError(t('logger.addressNotFound'))
      return
    }
    setGps({
      status: 'ok',
      coords: { lat: result.lat, lng: result.lng },
      accuracy: 0,
      address: result.address,
      // The record's place and jurisdiction come only from the reverse
      // lookup of a GPS fix (T6a item 2), so a typed address leaves both
      // unknown, and drops any place the earlier fix had.
      place: null,
      addressLoading: false,
      source: 'manual',
    })
    setEditMode(false)
    setEditStatus('idle')
  }

  const requestGps = () => {
    if (!('geolocation' in navigator)) {
      setGps({ status: 'error', message: t('logger.gpsErrorUnsupported') })
      return
    }
    // Mark pending only when this is a retry (after an error) — the initial
    // pending state was set synchronously via useState's lazy init.
    setGps((curr) => (curr.status === 'pending' ? curr : { status: 'pending' }))
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        const accuracy = pos.coords.accuracy
        const trustworthy = accuracy <= ACCURACY_USABLE_M
        setGps({
          status: 'ok',
          coords,
          accuracy,
          address: null,
          place: null,
          addressLoading: trustworthy,
          source: 'gps',
        })
        // Don't reverse-geocode an unreliable coord — Nominatim would return
        // whatever happens to be at the (wrong) point and mislead the user.
        if (trustworthy) {
          const lookup = reverseGeocodeDetails(coords.lat, coords.lng)
          placeLookup.current = {
            coords,
            place: lookup.then(
              (d) => (d ? { road: d.road, suburb: d.suburb, state_code: d.state_code } : null),
              () => null,
            ),
          }
          void lookup.then((details) => {
            // Only onto this fix: a typed address or a newer fix entered
            // meanwhile keeps its own address and place.
            setGps((curr) =>
              curr.status === 'ok' && curr.coords === coords
                ? {
                    ...curr,
                    address: details?.address ?? null,
                    place: details
                      ? { road: details.road, suburb: details.suburb, state_code: details.state_code }
                      : null,
                    addressLoading: false,
                  }
                : curr,
            )
          })
        }
      },
      (err) => {
        let message = t('logger.gpsErrorDefault')
        if (err.code === err.PERMISSION_DENIED) {
          message = t('logger.gpsErrorDenied')
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          message = t('logger.gpsErrorUnavailable')
        } else if (err.code === err.TIMEOUT) {
          message = t('logger.gpsErrorTimeout')
        }
        setGps({ status: 'error', message })
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    )
  }

  useEffect(() => {
    // Mount-only GPS bootstrap. The synchronous "pending" state was set in
    // the useState initialiser above so the visible state at first paint is
    // already 'pending' — this effect only kicks off the async
    // navigator.geolocation call. Its callback eventually transitions state
    // to 'ok' or 'error'. The functional-update inside requestGps is a no-op
    // when already pending, but lint can't see that.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (gps.status === 'pending') requestGps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The photos from the scan screen go into the photo store when the logger
  // opens (once, even under StrictMode's double effect run).
  useEffect(() => {
    const writes = scanPhotoWrites.current
    const fallback: PhotoCaptureMeta = { captured_at: new Date().toISOString(), source: 'library' }
    if (!isNoSign && signPhoto && !writes.sign) {
      writes.sign = storeSessionPhoto(recordId, 'sign', signPhoto, signPhotoMeta ?? fallback)
      photoWrites.current.push(writes.sign)
      writtenUrls.current.push(signPhoto)
    }
    if (isNoSign && ambientPhoto && !writes.ambient) {
      writes.ambient = storeSessionPhoto(recordId, 'ambient', ambientPhoto, ambientPhotoMeta ?? fallback)
      photoWrites.current.push(writes.ambient)
      writtenUrls.current.push(ambientPhoto)
    }
    // Mount-only: the scan photos can't change while the logger is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Write the car photo's bytes; the tile shows saving, then saved or an error. */
  const writeCarPhoto = (dataUrl: string, meta: PhotoCaptureMeta) => {
    // After Save started (or Cancel) the record's photos were snapshotted
    // and tidied: a write now would leave bytes nothing refers to.
    if (closed.current) return
    setCarPhoto({ status: 'saving', dataUrl, meta })
    const result: Promise<CarWriteResult> = storeSessionPhoto(recordId, 'car', dataUrl, meta).then(
      (ref) => ref ?? (isPhotoStoreAvailable() ? null : 'inRecord'),
    )
    const entry = { result, dataUrl }
    carWrite.current = entry
    photoWrites.current.push(result)
    writtenUrls.current.push(dataUrl)
    void result.then((r) => {
      if (carWrite.current !== entry) return // replaced or removed meanwhile
      setCarPhoto(
        r === null
          ? { status: 'failed', dataUrl, meta }
          : r === 'inRecord'
            ? { status: 'inRecord', dataUrl, meta }
            : { status: 'saved', dataUrl, meta, ref: r },
      )
    })
  }

  const handleFile = async (file: File, input: 'camera' | 'library') => {
    // Capture time and source are taken when the file arrives, before the resize.
    const meta = captureMetaFor(file, input)
    setCarReadError(null)
    let dataUrl: string
    try {
      ;({ dataUrl } = await resizeImageFile(file))
    } catch (err) {
      console.warn('[logger] could not read the car photo:', err)
      setCarReadError(t('scanner.couldntReadPhoto'))
      return
    }
    if (closed.current) return
    writeCarPhoto(dataUrl, meta)
  }

  const removeCarPhoto = () => {
    if (closed.current) return
    carWrite.current = null
    setCarPhoto(null)
  }

  /**
   * Run a photo clean-up for this record once `writes` have settled, and
   * again once any write that timed out has landed as well (those bytes
   * have no PhotoRef). Never throws.
   */
  const tidyPhotos = (writes: readonly Promise<unknown>[], cleanUp: () => Promise<number>, what: string) => {
    void Promise.allSettled(writes)
      .then(async () => {
        await cleanUp()
        if (await whenPhotoWritesSettle(recordId)) await cleanUp()
      })
      .catch((err) => console.warn(`[logger] could not ${what}:`, err))
  }

  /**
   * Leave without saving: the record never existed, so its photos are
   * deleted (after any write still in flight has landed). Once Save has
   * started the record is being kept, so this does nothing.
   */
  const cancel = () => {
    if (submittedRef.current || closed.current || checkingRef.current) return
    closed.current = true
    conditionSlots.close()
    proofSlots.close()
    tidyPhotos([...photoWrites.current], () => deleteSessionPhotos(recordId), 'delete the photos of a cancelled record')
    onCancel()
  }

  // The boundary question as it stands (T6b item 8). It shows when the
  // same-stretch check asks, once the location has settled (the GPS fix and
  // its place lookup), so it doesn't flash up and vanish as the fix comes
  // in; or at once when Save was tapped. An answer is kept only while the
  // question offers it (the area question has other answers).
  const liveLocation =
    gps.status === 'ok'
      ? {
          lat: gps.coords.lat,
          lng: gps.coords.lng,
          source: gps.source,
          accuracy_meters: gps.source === 'gps' ? gps.accuracy : null,
        }
      : null
  const livePlace = gps.status === 'ok' && gps.source === 'gps' ? gps.place : null
  const liveCheck = stop && rules ? stopBoundaryCheck(stop, rules, liveLocation, livePlace) : null
  const locationSettling = gps.status === 'pending' || (gps.status === 'ok' && gps.addressLoading)
  const boundaryShown = !!liveCheck?.ask && (!locationSettling || boundaryBlocked)
  const liveAnswer = boundaryShown && liveCheck ? offeredAnswer(liveCheck, boundaryAnswer) : null
  const liveStatement = stop && liveAnswer ? stopBoundaryStatement(stop, liveCheck, liveAnswer) : null
  const liveBoundary = liveStatement && liveStatement !== 'unanswered' ? liveStatement : null
  const liveOutcome = stop && rules && liveBoundary ? stopOutcome(stop, liveBoundary, rules.until, now) : null
  const liveStartsNew = answerStartsNewLimit(liveBoundary)
  // The time on this stretch has already ended: "Save anyway" and "Don't
  // save this stop" take the place of Save and Cancel.
  const boundaryDeadlinePassed = boundaryShown && stopDeadlinePassed(liveAnswer, liveStartsNew, liveOutcome)
  // "I'm not sure" is focused by default (T6b item 8): once, when the
  // question first shows. Focus only, never checked, because the answer is
  // signed as the driver's own statement. Not while the driver is typing in
  // a field (an address, their name), and without scrolling the page under
  // them. A blocked Save focuses it again (above), scrolling it into view.
  const boundaryFocused = useRef(false)
  useEffect(() => {
    if (!boundaryShown || boundaryFocused.current) return
    boundaryFocused.current = true
    if (isTypingTarget(document.activeElement)) return
    notSureRef.current?.focus({ preventScroll: true })
  }, [boundaryShown])
  const stopTimeZone = liveLocation
    ? timezoneForCoords(liveLocation.lat, liveLocation.lng)
    : timezoneForCoords(stop?.previous?.location?.lat, stop?.previous?.location?.lng)

  const saveSession = async (options: { acceptPassedDeadline?: boolean } = {}) => {
    if (submittedRef.current || closed.current || checkingRef.current) return
    // The answer counts only if the question was on screen when Save was tapped.
    const answerAtTap = boundaryShown ? boundaryAnswer : null
    // Arrival time is the tap, as before; the photo writes (milliseconds)
    // are awaited after it.
    const arrived_at = new Date().toISOString()
    const location =
      gps.status === 'ok'
        ? {
            lat: gps.coords.lat,
            lng: gps.coords.lng,
            address: gps.address,
            source: gps.source,
            accuracy_meters: gps.source === 'gps' ? gps.accuracy : undefined,
          }
        : null
    // The raw reverse-geocode parts of the GPS fix, and the jurisdiction read
    // from their state code alone (T6a). Left off when the lookup hadn't
    // answered, and for a typed address.
    let place = gps.status === 'ok' && gps.source === 'gps' ? gps.place : null
    // A workday stop's state comes only from this lookup (T6b item 7): when
    // it hasn't answered yet, wait a little for it rather than end the
    // workday because the state couldn't be told.
    const pending = placeLookup.current
    if (draft?.workday && !place && gps.status === 'ok' && gps.source === 'gps' && pending?.coords === gps.coords) {
      checkingRef.current = true
      setChecking(true)
      try {
        place = await Promise.race([
          pending.place,
          new Promise<null>((resolve) => setTimeout(() => resolve(null), WORKDAY_PLACE_WAIT_MS)),
        ])
      } finally {
        checkingRef.current = false
        setChecking(false)
      }
      if (closed.current) return
    }
    // The boundary question (T6b item 8), the only step that may block
    // Save. Asked from where the phone is at the tap: a GPS fix that isn't
    // in yet is an unreliable location, so the check asks. A required
    // answer that hasn't been given blocks Save and moves focus to "I'm not
    // sure"; an answer that keeps the running limit after it has ended
    // offers only "Save anyway" and "Don't save this stop".
    let boundaryFields: Pick<ParkingSession, 'boundary'> = {}
    if (stop && rules) {
      const check = stopBoundaryCheck(stop, rules, location, place)
      const statement = stopBoundaryStatement(stop, check, answerAtTap)
      if (statement === 'unanswered') {
        setBoundaryBlocked(true)
        setBoundaryRequired(true)
        setFocusNotSure((n) => n + 1)
        return
      }
      if (statement && !options.acceptPassedDeadline) {
        const outcome = stopOutcome(stop, statement, rules.until, Date.now())
        if (stopDeadlinePassed(statement.answer, answerStartsNewLimit(statement), outcome)) {
          setBoundaryBlocked(true)
          setBlockedAt(Date.now())
          return
        }
      }
      boundaryFields = { boundary: statement }
    }
    submittedRef.current = true
    closed.current = true
    conditionSlots.close()
    proofSlots.close()
    setSubmitting(true)
    const placeFields: Pick<ParkingSession, 'place' | 'jurisdiction'> = place
      ? { place, jurisdiction: jurisdictionOfPlace(place) }
      : {}
    // Wait for every photo write to land, so each ref has its bytes stored.
    // Each write settles within PHOTO_WRITE_TIMEOUT_MS (a stuck IndexedDB
    // write counts as failed), so Save never hangs.
    const currentCar = carWrite.current
    await Promise.allSettled(photoWrites.current)
    const signRef = (await scanPhotoWrites.current.sign) ?? null
    const ambientRef = (await scanPhotoWrites.current.ambient) ?? null
    const carResult = currentCar ? await currentCar.result : null
    // A car photo whose write failed isn't saved (its tile showed the error
    // and offered a retry). Without a working photo store it is kept in the
    // record itself instead, like the scan photos below.
    const carRef = carResult && carResult !== 'inRecord' ? carResult : null
    const carInRecord = carResult === 'inRecord' && currentCar ? currentCar.dataUrl : null
    // Condition and proof photos are part of the record only when stored
    // (a failed one showed its error on the tile).
    const conditionRefs = await conditionSlots.settle(gridRoles('condition'))
    const proofRefs = await proofSlots.settle(['compliance'])
    const photos = [signRef, carRef, ambientRef, ...conditionRefs, ...proofRefs].filter(
      (r): r is PhotoRef => r !== null,
    )
    // Facts captured at parking, signed in the arrival_context (link 1).
    const conditionNoteText = fitText(conditionNote, CONDITION_NOTE_MAX)
    const extras: Partial<ParkingSession> = {}
    if (conditionNoteText) extras.condition_note = conditionNoteText
    // A library photo can only be a payment confirmation, whatever was picked.
    if (proofRefs.length > 0) extras.compliance_type = allowedComplianceType(proofRefs[0].source, proofType)
    if (draft) extras.gate_acks = { ...draft.gate_acks }
    // Always set, null when empty: a cleared field signs "nobody named",
    // never the draft's default (buildArrivalContext reads the record first).
    extras.driver_name = savedDriverName(driverName)
    // A workday stop's boundary statement (null for the first stop). App
    // works out its limit from it when it saves the stop (stopLimitFields).
    Object.assign(extras, boundaryFields)
    // The legacy fields stay null for photo-store photos. Only when the
    // store couldn't take a scan photo (no IndexedDB, a failed or timed-out
    // write) is it kept in the legacy field instead, so the record still has
    // the photo it was read from.
    const session: ParkingSession = isNoSign
      ? {
          // No-sign session — minimal evidence record. No rules, no expiry,
          // no countdown. The cryptographic signature still covers what's
          // here: location + time + optional ambient + optional car photo.
          id: recordId,
          arrived_at,
          location,
          sign_photo: null,
          car_photo: carInRecord,
          rules: '',
          observations: [],
          expires_at: null,
          confidence: 'low',
          no_sign: true,
          ambient_photo: ambientRef ? null : ambientPhoto,
          photos,
          ...placeFields,
          // T3: the status ParkProof found in the scan photo, when the
          // driver came from the "no readable sign" screen.
          ...noSignReadingFields(noSignReading),
          ...extras,
        }
      : {
          id: recordId,
          arrived_at,
          location,
          sign_photo: signRef ? null : signPhoto,
          car_photo: carInRecord,
          rules: rules!.rules,
          observations: rules!.observations,
          expires_at: rules!.until,
          confidence: rules!.confidence,
          chosen_label: rules!.chosen_label,
          alternate_variants: rules!.alternate_variants,
          photos,
          ...placeFields,
          // T3: the sign's condition, the rule flags and the weekly
          // restrictions from the answer (nothing from a pre-T3 answer).
          ...signReadingFields(rules!),
          ...extras,
        }
    onComplete(session)
    // Photos taken and then replaced or removed don't stay on the device,
    // nor do the bytes of a write that timed out and landed later. Only
    // this logger's own photos are looked at, once every write for the
    // record has settled: a photo another screen adds to the saved record
    // meanwhile is never touched.
    const keep = photos.map((p) => p.sha256)
    void discardUnreferencedPhotos(
      recordId,
      [...writtenUrls.current, ...conditionSlots.captured(), ...proofSlots.captured()],
      keep,
    )
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <BackButton onClick={cancel} disabled={busy}>
        {t('common.back')}
      </BackButton>

      <h2 className="font-display text-3xl font-extrabold text-paper-50 mb-1">
        {isNoSign ? t('logger.noSignHeader') : t('logger.header')}
      </h2>
      <p className="text-sm mb-6 leading-relaxed" style={{ color: '#A9CFBE' }}>
        {noSignReading ? t('unclearSign.loggerIntro') : isNoSign ? t('logger.noSignIntro') : t('logger.intro')}
      </p>

      {/* No-sign banner — makes the evidentiary framing explicit. The user
          is asserting the spot had no signs; the cryptographic signature
          covers "this record existed at this moment", not the underlying
          claim. Helpful to spell out so the user understands what they're
          actually capturing. */}
      {isNoSign && (
        <div className="gf-card mb-3 bg-brand-50 p-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-brand-500 text-white flex items-center justify-center shrink-0 mt-0.5">
              <Icon name="warning" className="w-4 h-4" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">
                {t('logger.noSignKicker')}
              </p>
              <p className="text-sm text-ink-900 mt-1 leading-relaxed">
                {/* From the "no readable sign" screen the driver isn't saying
                    there was no sign here, only logging without one (T3). */}
                {noSignReading ? t('unclearSign.loggerBanner') : t('logger.noSignBanner')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Ambient photo of surroundings — already captured on the scan screen
          when the user opted into "show no signs were visible". Shown here
          as part of the evidence summary, with a clear caption so it's not
          mistaken for the (absent) sign photo. */}
      {isNoSign && ambientPhoto && (
        <Card pad="sm" className="mb-3">
          <h3 className="font-semibold text-sm text-ink-900 mb-2">
            {t('logger.ambientHeader')}
          </h3>
          <img
            src={ambientPhoto}
            alt={t('logger.ambientHeader')}
            className="w-full rounded-xl border border-paper-300 object-contain max-h-[40vh] bg-paper-50"
          />
          <p className="text-xs text-ink-600 mt-2">
            {noSignReading ? t('unclearSign.photoCaption') : t('logger.ambientCaption')}
          </p>
        </Card>
      )}

      {/* GPS card */}
      <Card pad="sm" className="mb-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-ink-900">{t('logger.location')}</h3>
          <div role="status" aria-live="polite">
            {gps.status === 'pending' && (
              <span className="text-xs text-ink-600">{t('logger.acquiringGps')}</span>
            )}
            {gps.status === 'ok' && (
              <span className="text-xs text-brand-700 font-medium">{t('logger.captured')}</span>
            )}
            {gps.status === 'error' && (
              <button onClick={requestGps} className="min-h-[44px] inline-flex items-center -my-2.5 text-xs text-accent-600 underline">
                {t('common.retry')}
              </button>
            )}
          </div>
        </div>
        {/* Why location is used + that it stays on-device — sets expectations
            before the GPS prompt's consequences (address, accuracy) land. */}
        <p className="text-xs text-ink-600 mt-1 leading-relaxed">
          {t('logger.locationContext')}
        </p>
        {gps.status === 'ok' && !editMode && (() => {
          const isGps = gps.source === 'gps'
          const isUnreliable = isGps && gps.accuracy > ACCURACY_USABLE_M
          const isDanger = isGps && gps.accuracy > ACCURACY_DANGER_M

          if (isUnreliable) {
            return (
              <div className="mt-3 bg-amber-50 border border-amber-300 rounded-lg p-3">
                <div className="flex items-start gap-2 mb-2">
                  <Icon name="warning" className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-display font-bold text-ink-900">
                      {t('logger.gpsImprecise')}
                    </p>
                    <p className="text-xs text-ink-700 mt-0.5 leading-relaxed">
                      {/* <strong> in the JSON is rendered as a monospace span here —
                          measurement reads as data, not prose, which mirrors the
                          pre-i18n styling. */}
                      <Trans
                        i18nKey={isDanger ? 'logger.gpsImpreciseDanger' : 'logger.gpsImpreciseCopy'}
                        values={{ accuracy: formatAccuracy(gps.accuracy) }}
                        components={{ strong: <span className="font-mono font-semibold" /> }}
                      />
                    </p>
                  </div>
                </div>
                <button
                  onClick={startEdit}
                  className="w-full bg-brand-500 hover:bg-brand-600 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
                >
                  {t('logger.enterAddress')}
                </button>
              </div>
            )
          }

          return (
            <div className="mt-2 flex items-start gap-3">
              <div className="flex-1 min-w-0" role="status" aria-live="polite">
                {gps.address ? (
                  <p className="text-sm text-ink-900">
                    {gps.address}{' '}
                    <span className="text-xs text-ink-600 font-mono whitespace-nowrap">
                      ({gps.coords.lat.toFixed(5)}, {gps.coords.lng.toFixed(5)})
                    </span>
                  </p>
                ) : gps.addressLoading ? (
                  <p className="text-xs text-ink-600 font-mono">
                    {gps.coords.lat.toFixed(5)}, {gps.coords.lng.toFixed(5)}{' '}
                    <span aria-hidden="true">·</span> {t('logger.resolvingAddress')}
                  </p>
                ) : (
                  <p className="text-xs text-ink-600 font-mono">
                    {gps.coords.lat.toFixed(5)}, {gps.coords.lng.toFixed(5)}
                  </p>
                )}
                <p className="text-2xs text-ink-600 mt-0.5">
                  {gps.source === 'manual'
                    ? t('logger.manuallyEntered')
                    : t('logger.accuracyLabel', { accuracy: formatAccuracy(gps.accuracy) })}
                </p>
              </div>
              <button
                onClick={startEdit}
                className="text-xs font-medium text-brand-700 hover:text-brand-800 underline shrink-0"
              >
                {t('common.edit')}
              </button>
            </div>
          )
        })()}

        {(gps.status === 'ok' || gps.status === 'error') && editMode && (
          <div className="mt-3 space-y-2">
            <label htmlFor="logger-address-input" className="sr-only">
              {t('logger.addressPlaceholder')}
            </label>
            <input
              id="logger-address-input"
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitEdit()
                if (e.key === 'Escape') cancelEdit()
              }}
              placeholder={t('logger.addressPlaceholder')}
              autoComplete="street-address"
              autoFocus
              aria-invalid={editError ? true : undefined}
              aria-describedby={editError ? 'logger-address-error' : undefined}
              className="w-full border border-paper-300 rounded-lg px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            {editError && (
              <p id="logger-address-error" role="alert" className="text-xs text-accent-700">
                {editError}
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={cancelEdit}
                disabled={editStatus === 'pending'}
                className="flex-1 bg-paper-200 hover:bg-paper-300 text-ink-700 font-medium py-2 rounded-lg text-sm transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={submitEdit}
                disabled={editStatus === 'pending'}
                className="flex-1 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
              >
                {editStatus === 'pending' ? t('logger.lookingUp') : t('logger.update')}
              </button>
            </div>
          </div>
        )}
        {gps.status === 'error' && !editMode && (
          <div className="mt-2 space-y-2">
            <p role="alert" className="text-xs text-ink-700 leading-relaxed">{gps.message}</p>
            <p className="text-xs text-ink-600">{t('logger.canSaveWithoutGps')}</p>
            {/* Even with GPS down, the driver can type the address ("corner of
                Collins and Swanston") and keep a located record — reuses the
                same forwardGeocode edit flow as the imprecise-GPS branch. */}
            <button
              onClick={startEdit}
              className="w-full bg-brand-500 hover:bg-brand-600 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors"
            >
              {t('logger.enterAddress')}
            </button>
          </div>
        )}
      </Card>

      {/* Car photo */}
      <section className="mb-6">
        <h3 className="font-semibold text-sm text-paper-50 mb-2">{t('logger.carAtSpot')}</h3>
        {carPhoto ? (
          <>
            <img
              src={carPhoto.dataUrl}
              alt={t('logger.carAtSpot')}
              className="w-full rounded-lg border border-white/10 object-contain max-h-[50vh] bg-white"
            />
            {/* The photo is only part of the record once its bytes are
                stored on the phone. If that failed, say so: no ref is made. */}
            {carPhoto.status === 'failed' && (
              <div role="alert" className="mt-2 bg-amber-50 border border-amber-300 rounded-lg p-3">
                <p className="text-xs text-ink-900 leading-relaxed">{t('logger.photoSaveFailed')}</p>
                <button
                  onClick={() => writeCarPhoto(carPhoto.dataUrl, carPhoto.meta)}
                  disabled={submitting}
                  className="mt-1 min-h-[44px] inline-flex items-center text-xs font-semibold text-brand-700 hover:text-brand-800 underline"
                >
                  {t('common.retry')}
                </button>
              </div>
            )}
            <button
              onClick={removeCarPhoto}
              disabled={submitting}
              className="text-sm text-[#7BE3A4] hover:text-[#7BE3A4]/80 underline mt-2 min-h-[44px] inline-flex items-center"
            >
              {t('logger.carRetake')}
            </button>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="border-2 border-dashed border-brand-300 hover:border-brand-500 hover:bg-brand-50/50 bg-white rounded-lg py-8 px-4 flex flex-col items-center text-brand-600 transition-colors"
            >
              <Icon name="camera" className="w-10 h-10 mb-2" />
              <span className="text-sm font-semibold text-ink-900">{t('scanner.takePhoto')}</span>
              <span className="text-xs text-ink-600 mt-1 text-center">{t('scanner.takePhotoSub')}</span>
            </button>
            <button
              onClick={() => libraryInputRef.current?.click()}
              className="border-2 border-dashed border-accent-300 hover:border-accent-500 hover:bg-accent-50/50 bg-white rounded-lg py-8 px-4 flex flex-col items-center text-accent-700 transition-colors"
            >
              <Icon name="gallery" className="w-10 h-10 mb-2" />
              <span className="text-sm font-semibold text-ink-900">{t('scanner.fromLibrary')}</span>
              <span className="text-xs text-ink-600 mt-1 text-center">{t('scanner.fromLibrarySub')}</span>
            </button>
          </div>
        )}
        {carReadError && !carPhoto && (
          <p role="alert" className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {carReadError}
          </p>
        )}
        <p className="text-xs mt-2 text-center" style={{ color: '#A9CFBE' }}>
          {t('logger.carOptionalHelp')}
        </p>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f, 'camera')
            e.target.value = ''
          }}
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f, 'library')
            e.target.value = ''
          }}
        />
      </section>

      {/* Section order (build spec T2 item 2, fixed for every later task):
          location, car photo, driver line, condition, proof of payment or
          permit, boundary question, Save. Only the boundary question may
          block Save; every other section is optional. */}

      {/* Driver line (T7, "Who's driving?"): between the car photo and the
          condition section. An optional step, so collapsed by default; the
          closed toggle shows the name that will be saved. The driver's own
          statement: ParkProof doesn't check it. */}
      <CollapsibleSection
        className="mb-3"
        title={t('logger.driver.label')}
        open={driverOpen}
        onToggle={() => setDriverOpen((o) => !o)}
        badge={driverBadge}
        disabled={submitting}
      >
        <Card pad="sm">
          <label htmlFor={`${recordId}-driver`} className="block text-xs uppercase tracking-widest font-semibold text-ink-600 mb-1">
            {t('logger.driver.label')}
          </label>
          <Input
            id={`${recordId}-driver`}
            type="text"
            value={driverName}
            onChange={(e) => setDriverName(e.target.value.slice(0, DRIVER_NAME_MAX))}
            maxLength={DRIVER_NAME_MAX}
            disabled={submitting}
            autoComplete="name"
            placeholder={t('logger.driver.placeholder')}
            aria-describedby={`${recordId}-driver-help`}
          />
          <p id={`${recordId}-driver-help`} className="text-xs text-ink-600 mt-1.5 leading-relaxed">
            {t('logger.driver.help')}
          </p>
        </Card>
      </CollapsibleSection>

      {/* Record the car's condition (optional): collapsed by default. The
          grid's photos and the damage note go into the arrival_context. */}
      <CollapsibleSection
        className="mb-3"
        title={t('logger.condition.toggle')}
        open={conditionOpen}
        onToggle={() => setConditionOpen((o) => !o)}
        badge={conditionSlots.savedCount > 0 ? t('photoGrid.count', { count: conditionSlots.savedCount }) : null}
      >
        <Card pad="sm">
          <PhotoAngleGrid phase="condition" slots={conditionSlots} disabled={submitting} />
          <label htmlFor={`${recordId}-damage`} className="block text-xs uppercase tracking-widest font-semibold text-ink-600 mt-4 mb-1">
            {t('logger.condition.noteLabel')}
          </label>
          <textarea
            id={`${recordId}-damage`}
            value={conditionNote}
            onChange={(e) => setConditionNote(e.target.value.slice(0, CONDITION_NOTE_MAX))}
            maxLength={CONDITION_NOTE_MAX}
            rows={2}
            disabled={submitting}
            placeholder={t('logger.condition.notePlaceholder')}
            aria-describedby={`${recordId}-damage-count`}
            className="w-full text-sm text-ink-900 bg-paper-50 border border-paper-300 rounded-xl p-3 leading-relaxed focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 resize-y"
          />
          <p id={`${recordId}-damage-count`} className="text-2xs text-ink-600 font-mono text-right">
            {conditionNote.length}/{CONDITION_NOTE_MAX}
          </p>
        </Card>
      </CollapsibleSection>

      {/* Proof of payment or permit. Open with one button when a gate
          applies (its type preselected); collapsed otherwise. */}
      {proofGated ? (
        <section className="mb-3">
          <h3 className="font-semibold text-sm text-paper-50 mb-2">{t('logger.proof.heading')}</h3>
          <Card pad="sm">
            <ProofPhotoSection
              slots={proofSlots}
              type={proofType}
              onTypeChange={setProofType}
              addLabel={t('logger.proof.addMeterTicketOrPermit')}
              disabled={submitting}
            />
          </Card>
        </section>
      ) : (
        <CollapsibleSection
          className="mb-3"
          title={t('logger.proof.toggle')}
          open={proofOpen}
          onToggle={() => setProofOpen((o) => !o)}
          badge={proofSlots.savedCount > 0 ? t('photoGrid.count', { count: proofSlots.savedCount }) : null}
        >
          <Card pad="sm">
            <ProofPhotoSection
              slots={proofSlots}
              type={proofType}
              onTypeChange={setProofType}
              addLabel={t('logger.proof.addMeterTicketOrPermit')}
              disabled={submitting}
            />
          </Card>
        </CollapsibleSection>
      )}

      {/* Boundary question (T6b item 8, workday stops only), right above
          Save: the only section that may block it. */}
      {boundaryShown && liveCheck && (
        <BoundaryQuestion
          check={liveCheck}
          answer={liveAnswer}
          onAnswer={(answer) => {
            setBoundaryAnswer(answer)
            setBoundaryRequired(false)
          }}
          outcome={liveOutcome}
          startsNewLimit={liveStartsNew}
          required={boundaryRequired}
          notSureRef={notSureRef}
          timeZone={stopTimeZone}
          now={now}
          disabled={busy}
          onSaveAnyway={() => void saveSession({ acceptPassedDeadline: true })}
          onDontSave={cancel}
        />
      )}

      {!boundaryDeadlinePassed && (
        <div className="mt-auto pt-3 flex flex-col gap-2">
          <Button
            onClick={() => void saveSession()}
            disabled={busy}
            className="disabled:cursor-not-allowed"
          >
            {busy ? t('logger.saving') : t('logger.saveSession')}
          </Button>
          <button
            onClick={cancel}
            disabled={busy}
            className="text-paper-50 hover:text-[#7BE3A4] font-medium py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('common.cancel')}
          </button>
        </div>
      )}
    </div>
  )
}
