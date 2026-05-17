import { useEffect, useRef, useState } from 'react'
import type { ParkingRules, ParkingSession } from '../types'
import { forwardGeocode, reverseGeocode } from '../lib/geocode'
import { resizeImageFile } from '../lib/image'
import {
  ACCURACY_DANGER_M,
  ACCURACY_USABLE_M,
  formatAccuracy,
} from '../lib/accuracy'
import Icon from './Icon'

interface Props {
  rules: ParkingRules
  signPhoto: string
  onComplete: (session: ParkingSession) => void
  onCancel: () => void
}

type GpsState =
  | { status: 'idle' }
  | { status: 'pending' }
  | {
      status: 'ok'
      coords: { lat: number; lng: number }
      accuracy: number
      address: string | null
      addressLoading: boolean
      source: 'gps' | 'manual'
    }
  | { status: 'error'; message: string }

export default function SessionLogger({ rules, signPhoto, onComplete, onCancel }: Props) {
  const [carPhoto, setCarPhoto] = useState<string | null>(null)
  // Initialise the GPS state synchronously based on API availability — avoids
  // setState-in-effect lint by deciding 'pending' vs 'error' here.
  const [gps, setGps] = useState<GpsState>(() => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      return { status: 'pending' }
    }
    return { status: 'error', message: 'Geolocation is not supported by this browser.' }
  })
  const [editMode, setEditMode] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [editStatus, setEditStatus] = useState<'idle' | 'pending'>('idle')
  const [editError, setEditError] = useState<string | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)

  const startEdit = () => {
    if (gps.status !== 'ok') return
    setEditValue(gps.address ?? '')
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
      setEditError('Enter an address first.')
      return
    }
    setEditStatus('pending')
    setEditError(null)
    const result = await forwardGeocode(trimmed)
    if (!result) {
      setEditStatus('idle')
      setEditError("Couldn't find that address. Try adding a suburb or postcode.")
      return
    }
    setGps({
      status: 'ok',
      coords: { lat: result.lat, lng: result.lng },
      accuracy: 0,
      address: result.address,
      addressLoading: false,
      source: 'manual',
    })
    setEditMode(false)
    setEditStatus('idle')
  }

  const requestGps = () => {
    if (!('geolocation' in navigator)) {
      setGps({ status: 'error', message: 'Geolocation is not supported by this browser.' })
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
          addressLoading: trustworthy,
          source: 'gps',
        })
        // Don't reverse-geocode an unreliable coord — Nominatim would return
        // whatever happens to be at the (wrong) point and mislead the user.
        if (trustworthy) {
          reverseGeocode(coords.lat, coords.lng).then((address) => {
            setGps((curr) =>
              curr.status === 'ok' ? { ...curr, address, addressLoading: false } : curr,
            )
          })
        }
      },
      (err) => {
        let message = 'Could not read your GPS.'
        if (err.code === err.PERMISSION_DENIED) {
          message =
            'You declined the location request. To attach GPS to this session, allow location for this site in your browser settings and tap Retry.'
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          message = 'Your device could not determine a location right now.'
        } else if (err.code === err.TIMEOUT) {
          message = 'Location request timed out.'
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

  const handleFile = async (file: File) => {
    const { dataUrl } = await resizeImageFile(file)
    setCarPhoto(dataUrl)
  }

  const saveSession = () => {
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
    const session: ParkingSession = {
      id: crypto.randomUUID(),
      arrived_at: new Date().toISOString(),
      location,
      sign_photo: signPhoto,
      car_photo: carPhoto,
      rules: rules.rules,
      observations: rules.observations,
      expires_at: rules.until,
      confidence: rules.confidence,
      chosen_label: rules.chosen_label,
      alternate_variants: rules.alternate_variants,
    }
    onComplete(session)
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
        Log this parking session
      </h2>
      <p className="text-sm text-ink-600 mb-6 leading-relaxed">
        We'll save a timestamped record with your photo and GPS — useful evidence if you ever
        contest a wrongful ticket.
      </p>

      {/* GPS card */}
      <section className="mb-3 bg-white rounded-2xl border border-paper-300 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm text-ink-900">Location</h3>
          {gps.status === 'pending' && (
            <span className="text-xs text-ink-600">Acquiring GPS…</span>
          )}
          {gps.status === 'ok' && (
            <span className="text-xs text-brand-700 font-medium">Captured ✓</span>
          )}
          {gps.status === 'error' && (
            <button onClick={requestGps} className="text-xs text-accent-600 underline">
              Retry
            </button>
          )}
        </div>
        {gps.status === 'ok' && !editMode && (() => {
          const isGps = gps.source === 'gps'
          const isUnreliable = isGps && gps.accuracy > ACCURACY_USABLE_M
          const isDanger = isGps && gps.accuracy > ACCURACY_DANGER_M

          if (isUnreliable) {
            return (
              <div className="mt-3 bg-accent-50 border-2 border-accent-400 rounded-xl p-3">
                <div className="flex items-start gap-2 mb-2">
                  <Icon name="warning" className="w-5 h-5 text-accent-700 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-display font-bold text-ink-900">
                      GPS is too imprecise to verify your spot
                    </p>
                    <p className="text-xs text-ink-700 mt-0.5 leading-relaxed">
                      Reading is{' '}
                      <span className="font-mono font-semibold">
                        {formatAccuracy(gps.accuracy)}
                      </span>
                      {isDanger
                        ? ' — could be the wrong suburb entirely (common on Starlink, VPN, or indoor GPS).'
                        : ' — fine for finding a coffee shop, not for parking evidence.'}{' '}
                      Enter the street address manually to keep this record reliable.
                    </p>
                  </div>
                </div>
                <button
                  onClick={startEdit}
                  className="w-full bg-accent-600 hover:bg-accent-700 text-white font-semibold py-2.5 rounded-lg text-sm shadow-md shadow-accent-500/20 transition-colors"
                >
                  Enter the address manually
                </button>
              </div>
            )
          }

          return (
            <div className="mt-2 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                {gps.address ? (
                  <p className="text-sm text-ink-900">
                    {gps.address}{' '}
                    <span className="text-xs text-ink-600 font-mono whitespace-nowrap">
                      ({gps.coords.lat.toFixed(5)}, {gps.coords.lng.toFixed(5)})
                    </span>
                  </p>
                ) : gps.addressLoading ? (
                  <p className="text-xs text-ink-600 font-mono">
                    {gps.coords.lat.toFixed(5)}, {gps.coords.lng.toFixed(5)} · resolving address…
                  </p>
                ) : (
                  <p className="text-xs text-ink-600 font-mono">
                    {gps.coords.lat.toFixed(5)}, {gps.coords.lng.toFixed(5)}
                  </p>
                )}
                <p className="text-[10px] text-ink-500 mt-0.5">
                  {gps.source === 'manual'
                    ? 'Manually entered'
                    : `${formatAccuracy(gps.accuracy)} accuracy`}
                </p>
              </div>
              <button
                onClick={startEdit}
                className="text-xs font-medium text-brand-700 hover:text-brand-800 underline shrink-0"
              >
                Edit
              </button>
            </div>
          )
        })()}

        {gps.status === 'ok' && editMode && (
          <div className="mt-3 space-y-2">
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitEdit()
                if (e.key === 'Escape') cancelEdit()
              }}
              placeholder="Street, suburb, state"
              autoFocus
              className="w-full border border-paper-300 rounded-lg px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
            {editError && <p className="text-xs text-accent-700">{editError}</p>}
            <div className="flex gap-2">
              <button
                onClick={cancelEdit}
                disabled={editStatus === 'pending'}
                className="flex-1 bg-paper-200 hover:bg-paper-300 text-ink-700 font-medium py-2 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitEdit}
                disabled={editStatus === 'pending'}
                className="flex-1 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white font-semibold py-2 rounded-lg text-sm transition-colors"
              >
                {editStatus === 'pending' ? 'Looking up…' : 'Update'}
              </button>
            </div>
          </div>
        )}
        {gps.status === 'error' && (
          <div className="mt-2 space-y-1">
            <p className="text-xs text-ink-700 leading-relaxed">{gps.message}</p>
            <p className="text-xs text-ink-600">You can still save this session without GPS.</p>
          </div>
        )}
      </section>

      {/* Car photo */}
      <section className="mb-6">
        <h3 className="font-semibold text-sm text-ink-900 mb-2">Car at the spot</h3>
        {carPhoto ? (
          <>
            <img
              src={carPhoto}
              alt="Your car"
              className="w-full rounded-2xl border border-paper-300 object-contain max-h-[50vh] bg-white"
            />
            <button
              onClick={() => setCarPhoto(null)}
              className="text-sm text-brand-700 hover:text-brand-800 underline mt-2"
            >
              Retake
            </button>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
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
        <p className="text-xs text-ink-500 mt-2 text-center">
          Optional but strongly recommended for evidence
        </p>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
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
            if (f) handleFile(f)
            e.target.value = ''
          }}
        />
      </section>

      <div className="mt-auto flex flex-col gap-2">
        <button
          onClick={saveSession}
          className="bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-semibold py-4 rounded-2xl shadow-lg shadow-brand-500/25 transition-colors"
        >
          Save session
        </button>
        <button
          onClick={onCancel}
          className="text-ink-600 hover:text-ink-900 font-medium py-2 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
