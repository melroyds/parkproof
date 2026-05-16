import { useEffect, useRef, useState } from 'react'
import { resizeImageFile } from '../lib/image'
import { haversineMeters } from '../lib/geo'
import { loadSessions } from '../lib/storage'
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
    .filter((s) => now - new Date(s.arrived_at).getTime() <= FRESHNESS_MS)
    .sort(
      (a, b) => new Date(b.arrived_at).getTime() - new Date(a.arrived_at).getTime(),
    )
    .slice(0, PICKER_LIMIT)
}

export default function SignScanner({ onCapture, onReuseSession, onCancel }: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [mediaType, setMediaType] = useState<string>('image/jpeg')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [match, setMatch] = useState<ProximityMatch | null>(null)
  const [matchDismissed, setMatchDismissed] = useState(false)
  const [gpsState, setGpsState] = useState<GpsState>('pending')
  const [recentSessions, setRecentSessions] = useState<ParkingSession[]>([])
  const [pickerDismissed, setPickerDismissed] = useState(false)

  useEffect(() => {
    // Always compute the recent-sessions list so we can offer the picker fallback
    // when GPS isn't available (desktop, denied, or too imprecise).
    setRecentSessions(loadRecentSessions())

    if (!('geolocation' in navigator) || !('permissions' in navigator)) {
      setGpsState('unavailable')
      return
    }
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
    const { dataUrl, mediaType: mt } = await resizeImageFile(file)
    setMediaType(mt)
    setPreview(dataUrl)
  }

  const confirm = () => {
    if (preview) onCapture(preview, mediaType, coords)
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <button
        onClick={onCancel}
        className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4 transition-colors"
      >
        ← Back
      </button>

      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">
        Scan parking sign
      </h2>
      <p className="text-sm text-ink-600 mb-6 leading-relaxed">
        Take a clear photo of the sign(s). If signs are stacked, include them all in one shot.
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
          <div className="flex gap-2 mt-auto">
            <button
              onClick={() => setPreview(null)}
              className="flex-1 bg-paper-200 hover:bg-paper-300 text-ink-900 font-medium py-3 rounded-xl transition-colors"
            >
              Retake
            </button>
            <button
              onClick={confirm}
              className="flex-1 bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-semibold py-3 rounded-xl shadow-md shadow-brand-500/20 transition-colors"
            >
              Translate
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="border-2 border-dashed border-brand-300 hover:border-brand-500 hover:bg-brand-50/50 bg-white rounded-2xl py-8 px-4 flex flex-col items-center text-brand-600 transition-colors"
          >
            <Icon name="camera" className="w-10 h-10 mb-2" />
            <span className="text-sm font-semibold text-ink-900">Take a photo</span>
            <span className="text-xs text-ink-600 mt-1 text-center">Live, with your camera</span>
          </button>
          <button
            onClick={() => libraryInputRef.current?.click()}
            className="border-2 border-dashed border-accent-300 hover:border-accent-500 hover:bg-accent-50/50 bg-white rounded-2xl py-8 px-4 flex flex-col items-center text-accent-700 transition-colors"
          >
            <Icon name="gallery" className="w-10 h-10 mb-2" />
            <span className="text-sm font-semibold text-ink-900">From library</span>
            <span className="text-xs text-ink-600 mt-1 text-center">Pick a saved image</span>
          </button>
        </div>
      )}

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
