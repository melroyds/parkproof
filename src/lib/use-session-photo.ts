import { useEffect, useState } from 'react'
import type { ParkingSession, PhotoRole } from '../types'
import { getPhoto } from './photo-store'
import { photoHashSigned, photoRefFor, settleSessionPhoto } from './session-photos'

export type SessionPhotoState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'available'; src: string }
  /** The record has a PhotoRef but its bytes aren't on this device. */
  | { status: 'missing'; sha256: string; signed: boolean }

/**
 * A record's photo for a role, for rendering. Legacy photos (data URL or
 * cloud URL in the record) are available at once; photo-store photos load
 * from IndexedDB, showing 'loading' until then. A ref whose bytes aren't
 * on this device is 'missing', with whether its hash is in a stored
 * ParkProof signature ("Signed fingerprint ..." versus "Not signed yet").
 */
export function useSessionPhoto(session: ParkingSession | null | undefined, role: PhotoRole): SessionPhotoState {
  const ref = session ? photoRefFor(session, role) : null
  const sessionId = session?.id ?? null
  const sha256 = ref?.sha256 ?? null
  const key = sessionId && sha256 ? `${sessionId}/${sha256}` : null
  const [loaded, setLoaded] = useState<{ key: string; src: string | null } | null>(null)

  useEffect(() => {
    if (!sessionId || !sha256) return
    let cancelled = false
    const loadedKey = `${sessionId}/${sha256}`
    getPhoto(sessionId, sha256)
      .catch((err) => {
        console.warn('[photos] could not read a photo:', err)
        return null
      })
      .then((src) => {
        if (!cancelled) setLoaded({ key: loadedKey, src })
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, sha256])

  if (!session) return { status: 'none' }
  if (ref && (!loaded || loaded.key !== key)) return { status: 'loading' }
  const settled = settleSessionPhoto(session, role, ref && loaded ? loaded.src : null)
  if (settled.kind === 'available') return { status: 'available', src: settled.src }
  if (settled.kind === 'missing') {
    return { status: 'missing', sha256: settled.ref.sha256, signed: photoHashSigned(session, settled.ref.sha256) }
  }
  return { status: 'none' }
}
