import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resizeImageFile } from '../lib/image'
import { haversineMeters } from '../lib/geo'
import { loadSessions } from '../lib/storage'
import { analyseSignPhoto, type QualityResult } from '../lib/photo-quality'
import Icon from './Icon'
import ReuseCard from './ReuseCard'
import RecentScansPicker from './RecentScansPicker'
import type { ParkingSession } from '../types'

interface Props {
  onCapture: (
    dataUrl: string,
    mediaType: string,
    coords: { lat: number; lng: number } | null,
  ) => void
  onReuseSession: (session: ParkingSession) => void
  /**
   * Triggered when the user picks "No sign here" instead of the camera/
   * library path. Skips Claude entirely and routes the App.tsx state machine
   * straight to the SessionLogger in `no-sign` mode.
   *
   * `ambientPhoto` is optional — null when the user explicitly chose to
   * skip the surroundings photo.
   */
  onNoSignScan: (
    coords: { lat: number; lng: number } | null,
    ambientPhoto: string | null,
  ) => void
  onCancel: () => void
}

const PROXIMITY_METERS = 40
const FRESHNESS_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MAX_ACCURACY_M = 100 // anything coarser is treated as "no usable GPS" (covers IP-based desktop geo)
const PICKER_LIMIT = 3

type GpsState = 'pending' | 'proximity-checked' | 'unavailable'

interface ProximityMatch {
  session: ParkingSession
  distanceMeters: number
}

function findRecentMatch(
  coords: { lat: number; lng: number },
  now: number = Date.now(),
): ProximityMatch | null {
  const sessions = loadSessions()
  let best: ProximityMatch | null = null
  for (const s of sessions) {
    if (!s.location) continue
    // No-sign sessions have no rules to refresh — offering "reuse this read"
    // for them would be a UX lie. Skip.
    if (s.no_sign) continue
    if (now - new Date(s.arrived_at).getTime() > FRESHNESS_MS) continue
    const distance = haversineMeters(coords, s.location)
    if (distance > PROXIMITY_METERS) continue
    if (!best || new Date(s.arrived_at).getTime() > new Date(best.session.arrived_at).getTime()) {
      best = { session: s, distanceMeters: distance }
    }
  }
  return best
}

function loadRecentSessions(): ParkingSession[] {
  const now = Date.now()
  return loadSessions()
    // Same filter as the proximity match — picker offers "reuse a recent
    // scan", and there's nothing to reuse from a no-sign session.
    .filter((s) => !s.no_sign && now - new Date(s.arrived_at).getTime() <= FRESHNESS_MS)
    .sort(
      (a, b) => new Date(b.arrived_at).getTime() - new Date(a.arrived_at).getTime(),
    )
    .slice(0, PICKER_LIMIT)
}

export default function SignScanner({ onCapture, onReuseSession, onNoSignScan, onCancel }: Props) {
  const { t } = useTranslation()
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  // Hidden file inputs for the "no sign here" ambient-photo capture path.
  // Separate refs from the sign-photo inputs so the two flows can't bleed
  // into each other via stale state.
  const ambientCameraRef = useRef<HTMLInputElement>(null)
  const ambientLibraryRef = useRef<HTMLInputElement>(null)
  // Drives the inline panel that asks "want to photograph the surroundings?"
  // after the user picks "No sign here". 'idle' = panel hidden; 'choosing' =
  // shown; 'captured' = ambient photo taken, preview shown with Save Now
  // button. Keeping it in component state (not a separate view) keeps the
  // SignScanner the single source of truth for the scan screen UX.
  const [noSignStage, setNoSignStage] = useState<'idle' | 'choosing' | 'captured'>('idle')
  const [ambientPhoto, setAmbientPhoto] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<string>('image/jpeg')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [match, setMatch] = useState<ProximityMatch | null>(null)
  const [matchDismissed, setMatchDismissed] = useState(false)
  // Initialise gpsState synchronously based on API availability — avoids the
  // pattern of an effect immediately setting state, which the rules-of-hooks
  // lint correctly flags as wasted work.
  const [gpsState, setGpsState] = useState<GpsState>(() =>
    typeof navigator !== 'undefined' &&
    'geolocation' in navigator &&
    'permissions' in navigator
      ? 'pending'
      : 'unavailable',
  )
  const [recentSessions] = useState<ParkingSession[]>(() => loadRecentSessions())
  const [pickerDismissed, setPickerDismissed] = useState(false)
  const [quality, setQuality] = useState<QualityResult | null>(null)

  useEffect(() => {
    // Recent-sessions list is initialised lazily via useState above — no need
    // to fetch it again here. This effect is now purely GPS bootstrap.
    // If the lazy-init above already set unavailable, this effect short-circuits.
    if (gpsState === 'unavailable') return
    let cancelled = false
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then((status) => {
        if (cancelled) return
        if (status.state !== 'granted') {
          setGpsState('unavailable')
          return
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (cancelled) return
            const c = { lat: pos.coords.latitude, lng: pos.coords.longitude }
            setCoords(c)
            // Desktop browsers often return IP-based coords with accuracy of
            // several kilometres. Treat anything coarser than MAX_ACCURACY_M
            // as "no usable GPS" so we don't render a misleading proximity
            // miss and instead show the manual picker.
            if (pos.coords.accuracy <= MAX_ACCURACY_M) {
              const found = findRecentMatch(c)
              if (found) setMatch(found)
              setGpsState('proximity-checked')
            } else {
              setGpsState('unavailable')
            }
          },
          () => {
            if (cancelled) return
            setGpsState('unavailable')
          },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
        )
      })
      .catch(() => {
        if (!cancelled) setGpsState('unavailable')
      })
    return () => {
      cancelled = true
    }
    // Mount-only bootstrap; gpsState is read once as a fast-exit. Re-running on
    // gpsState transitions would re-fire the GPS request unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showProximityCard = match && !matchDismissed && !preview
  // Show the picker whenever we don't have a stronger proximity match to
  // display. Covers: desktop (no real GPS), mobile away from saved spots,
  // and the "dismissed the proximity card but want another option" case.
  // Wait for the GPS check to settle first to avoid flicker.
  const showPicker =
    gpsState !== 'pending' &&
    !showProximityCard &&
    !preview &&
    !pickerDismissed &&
    recentSessions.length > 0

  const handleFile = async (file: File) => {
    // Run the quality check on the ORIGINAL file (full resolution) — the
    // resize step we do for storage drops detail we want to evaluate against.
    // The two operations run in parallel so the user sees the preview at the
    // normal speed; quality just lands a tick later.
    const [{ dataUrl, mediaType: mt }, qualityResult] = await Promise.all([
      resizeImageFile(file),
      analyseSignPhoto(file).catch((err) => {
        console.warn('[photo-quality] analysis error, continuing:', err)
        return null
      }),
    ])
    setMediaType(mt)
    setPreview(dataUrl)
    setQuality(qualityResult)
  }

  const confirm = () => {
    if (preview) onCapture(preview, mediaType, coords)
  }

  // ── No-sign flow handlers ─────────────────────────────────────────────
  // The user has pressed "No sign here" — open the inline confirmation
  // panel so they can choose between (a) taking an ambient photo of the
  // surroundings, or (b) skipping the photo and saving GPS+time only.
  const handleNoSignStart = () => {
    setNoSignStage('choosing')
  }

  // Used by both the camera and library inputs to ingest a file as an
  // ambient (surroundings) photo. Runs the same resize pipeline as the
  // sign-photo path so storage stays under the 5MB localStorage ceiling.
  const handleAmbientFile = async (file: File) => {
    const { dataUrl } = await resizeImageFile(file)
    setAmbientPhoto(dataUrl)
    setNoSignStage('captured')
  }

  // User chose to skip the ambient photo. Hand off straight to SessionLogger
  // with no ambient evidence — only GPS + time. The user is asserting "no
  // signs were here" without visual backup; that's a valid evidence record,
  // just a weaker one in a dispute scenario.
  const handleNoSignSkip = () => {
    onNoSignScan(coords, null)
  }

  // User captured an ambient photo and is ready to save. Hand off both the
  // coords and the photo to SessionLogger.
  const handleNoSignSave = () => {
    onNoSignScan(coords, ambientPhoto)
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <button
        onClick={onCancel}
        className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4 transition-colors"
      >
        {t('common.back')}
      </button>

      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">
        {t('scanner.header')}
      </h2>
      <p className="text-sm text-ink-600 mb-6 leading-relaxed">
        {t('scanner.instructions')}
      </p>

      {showProximityCard && match && (
        <ReuseCard
          session={match.session}
          distanceMeters={match.distanceMeters}
          onReuse={() => onReuseSession(match.session)}
          onDismiss={() => setMatchDismissed(true)}
        />
      )}

      {showPicker && (
        <RecentScansPicker
          sessions={recentSessions}
          onPick={onReuseSession}
          onDismiss={() => setPickerDismissed(true)}
        />
      )}

      {preview ? (
        <>
          <img
            src={preview}
            alt="Captured parking sign"
            className="w-full rounded-2xl mb-4 border border-paper-300 object-contain max-h-[60vh] bg-white"
          />
          {/* Pre-flight quality warning — doesn't block, just informs.
              Saves a wasted Claude call on obvious bad input AND helps the
              user understand why a result might be low-confidence. */}
          {quality && quality.verdict !== 'ok' && (
            <div className="mb-3 bg-amber-50 border-2 border-amber-400 rounded-xl p-3">
              <div className="flex items-start gap-2">
                <Icon
                  name="warning"
                  className="w-5 h-5 text-amber-700 shrink-0 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-display font-bold text-ink-900">
                    {t('scanner.qualityHeader')}
                  </p>
                  <p className="text-xs text-ink-700 mt-0.5 leading-relaxed">
                    {/* Verdict → translation key — keeps the quality lib pure
                        (no React/i18n imports there). */}
                    {t(
                      `scanner.quality${quality.verdict.charAt(0).toUpperCase()}${quality.verdict.slice(1)}`,
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-auto">
            <button
              onClick={() => {
                setPreview(null)
                setQuality(null)
              }}
              className="flex-1 bg-paper-200 hover:bg-paper-300 text-ink-900 font-medium py-3 rounded-xl transition-colors"
            >
              {t('scanner.retake')}
            </button>
            <button
              onClick={confirm}
              className="flex-1 bg-gradient-to-r from-brand-500 via-brand-500 to-purple-600 hover:brightness-110 active:brightness-95 disabled:bg-none text-white font-semibold py-3 rounded-xl shadow-md shadow-brand-500/20 transition-colors"
            >
              {quality && quality.verdict !== 'ok' ? t('scanner.translateAnyway') : t('scanner.translate')}
            </button>
          </div>
        </>
      ) : noSignStage === 'idle' ? (
        <>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="border-2 border-dashed border-brand-300 hover:border-brand-500 hover:bg-brand-50/50 bg-white rounded-2xl py-8 px-4 flex flex-col items-center text-brand-600 transition-colors"
            >
              <Icon name="camera" className="w-10 h-10 mb-2" />
              <span className="text-sm font-semibold text-ink-900">{t('scanner.takePhoto')}</span>
              <span className="text-xs text-ink-600 mt-1 text-center">{t('scanner.takePhotoSub')}</span>
            </button>
            <button
              onClick={() => libraryInputRef.current?.click()}
              className="border-2 border-dashed border-accent-300 hover:border-accent-500 hover:bg-accent-50/50 bg-white rounded-2xl py-8 px-4 flex flex-col items-center text-accent-700 transition-colors"
            >
              <Icon name="gallery" className="w-10 h-10 mb-2" />
              <span className="text-sm font-semibold text-ink-900">{t('scanner.fromLibrary')}</span>
              <span className="text-xs text-ink-600 mt-1 text-center">{t('scanner.fromLibrarySub')}</span>
            </button>
          </div>
          {/* "No sign here" affordance — secondary in visual weight (text
              link, not a button) so it doesn't compete with the primary
              scan CTAs above. The user who lands here knows what they're
              looking for. */}
          <button
            onClick={handleNoSignStart}
            className="mt-6 text-sm text-ink-600 hover:text-ink-900 underline self-center transition-colors"
          >
            {t('scanner.noSignHere')}
          </button>
        </>
      ) : noSignStage === 'choosing' ? (
        // Inline panel: ask the user whether to strengthen the evidence with
        // a surroundings photo. Either path commits — the choice is purely
        // about evidence weight, not whether the session gets saved.
        <div className="flex flex-col gap-3">
          <div className="bg-brand-50 border border-brand-200 rounded-2xl p-5">
            <h3 className="font-display font-bold text-ink-900 mb-1">
              {t('scanner.noSignChooseHeader')}
            </h3>
            <p className="text-sm text-ink-700 leading-relaxed">
              {t('scanner.noSignChooseCopy')}
            </p>
          </div>
          <button
            onClick={() => ambientCameraRef.current?.click()}
            className="border-2 border-dashed border-brand-300 hover:border-brand-500 hover:bg-brand-50/50 bg-white rounded-2xl py-6 px-4 flex flex-col items-center text-brand-600 transition-colors"
          >
            <Icon name="camera" className="w-8 h-8 mb-2" />
            <span className="text-sm font-semibold text-ink-900">
              {t('scanner.noSignTakeAmbient')}
            </span>
            <span className="text-xs text-ink-600 mt-1 text-center">
              {t('scanner.noSignTakeAmbientSub')}
            </span>
          </button>
          <button
            onClick={() => ambientLibraryRef.current?.click()}
            className="border-2 border-dashed border-accent-300 hover:border-accent-500 hover:bg-accent-50/50 bg-white rounded-2xl py-6 px-4 flex flex-col items-center text-accent-700 transition-colors"
          >
            <Icon name="gallery" className="w-8 h-8 mb-2" />
            <span className="text-sm font-semibold text-ink-900">
              {t('scanner.noSignFromLibrary')}
            </span>
          </button>
          <button
            onClick={handleNoSignSkip}
            className="mt-1 bg-paper-200 hover:bg-paper-300 text-ink-900 font-medium py-3 rounded-2xl transition-colors"
          >
            {t('scanner.noSignSkip')}
          </button>
          <button
            onClick={() => setNoSignStage('idle')}
            className="text-sm text-ink-600 hover:text-ink-900 underline self-center transition-colors"
          >
            {t('common.back')}
          </button>
        </div>
      ) : (
        // 'captured' — ambient photo taken, show preview + save button.
        <div className="flex flex-col gap-3">
          {ambientPhoto && (
            <img
              src={ambientPhoto}
              alt={t('scanner.noSignAmbientAlt')}
              className="w-full rounded-2xl border border-paper-300 object-contain max-h-[55vh] bg-white"
            />
          )}
          <p className="text-xs text-ink-600 text-center">
            {t('scanner.noSignAmbientCaption')}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setAmbientPhoto(null)
                setNoSignStage('choosing')
              }}
              className="flex-1 bg-paper-200 hover:bg-paper-300 text-ink-900 font-medium py-3 rounded-xl transition-colors"
            >
              {t('scanner.retake')}
            </button>
            <button
              onClick={handleNoSignSave}
              className="flex-1 bg-gradient-to-r from-brand-500 via-brand-500 to-purple-600 hover:brightness-110 active:brightness-95 disabled:bg-none text-white font-semibold py-3 rounded-xl shadow-md shadow-brand-500/20 transition-colors"
            >
              {t('scanner.noSignContinue')}
            </button>
          </div>
        </div>
      )}

      {/* Ambient-photo hidden inputs — separate from the sign-photo inputs
          so the no-sign and translate flows can't accidentally share a file
          handle via stale state. */}
      <input
        ref={ambientCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleAmbientFile(file)
          e.target.value = ''
        }}
      />
      <input
        ref={ambientLibraryRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleAmbientFile(file)
          e.target.value = ''
        }}
      />


      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}
