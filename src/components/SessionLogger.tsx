import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { ParkingRules, ParkingSession, PhotoRef, PlaceParts } from '../types'
import { forwardGeocode, reverseGeocodeDetails } from '../lib/geocode'
import { jurisdictionOfPlace } from '../lib/jurisdiction'
import { resizeImageFile } from '../lib/image'
import { deleteSessionPhotos, deleteSessionPhotosExcept, isPhotoStoreAvailable } from '../lib/photo-store'
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
import Icon from './Icon'
import Button from './ui/Button'
import BackButton from './ui/BackButton'
import Card from './ui/Card'

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
  mode = 'sign',
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
  const [editMode, setEditMode] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [editStatus, setEditStatus] = useState<'idle' | 'pending'>('idle')
  const [editError, setEditError] = useState<string | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)

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
          void reverseGeocodeDetails(coords.lat, coords.lng).then((details) => {
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
    }
    if (isNoSign && ambientPhoto && !writes.ambient) {
      writes.ambient = storeSessionPhoto(recordId, 'ambient', ambientPhoto, ambientPhotoMeta ?? fallback)
      photoWrites.current.push(writes.ambient)
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
    if (submittedRef.current || closed.current) return
    closed.current = true
    tidyPhotos([...photoWrites.current], () => deleteSessionPhotos(recordId), 'delete the photos of a cancelled record')
    onCancel()
  }

  const saveSession = async () => {
    if (submittedRef.current || closed.current) return
    submittedRef.current = true
    closed.current = true
    setSubmitting(true)
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
    const place = gps.status === 'ok' && gps.source === 'gps' ? gps.place : null
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
    const photos = [signRef, carRef, ambientRef].filter((r): r is PhotoRef => r !== null)
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
        }
    onComplete(session)
    // Photos taken and then replaced or removed don't stay on the device,
    // nor do the bytes of a write that timed out and landed later.
    const keep = photos.map((p) => p.sha256)
    tidyPhotos([], () => deleteSessionPhotosExcept(recordId, keep), 'tidy replaced photos')
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <BackButton
        onClick={cancel}
        disabled={submitting}
        className="text-paper-50 hover:text-[#7BE3A4] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t('common.back')}
      </BackButton>

      <h2 className="font-display text-3xl font-extrabold text-paper-50 mb-1">
        {isNoSign ? t('logger.noSignHeader') : t('logger.header')}
      </h2>
      <p className="text-sm mb-6 leading-relaxed" style={{ color: '#A9CFBE' }}>
        {isNoSign ? t('logger.noSignIntro') : t('logger.intro')}
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
                {t('logger.noSignBanner')}
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
            {t('logger.ambientCaption')}
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

      <div className="mt-auto flex flex-col gap-2">
        <Button
          onClick={() => void saveSession()}
          disabled={submitting}
          className="disabled:cursor-not-allowed"
        >
          {submitting ? t('logger.saving') : t('logger.saveSession')}
        </Button>
        <button
          onClick={cancel}
          disabled={submitting}
          className="text-paper-50 hover:text-[#7BE3A4] font-medium py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
