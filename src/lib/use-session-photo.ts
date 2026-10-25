import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ParkingSession, PhotoRole } from '../types'
import { getPhoto } from './photo-store'
import {
  fetchRemotePhoto,
  photoHashSigned,
  photoRefFor,
  photoSourceVersion,
  settleSessionPhoto,
  subscribePhotoSource,
} from './session-photos'

export type SessionPhotoState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'available'; src: string }
  /** The record has a PhotoRef but its bytes aren't on this device. */
  | { status: 'missing'; sha256: string; signed: boolean }

export interface SessionPhotoOptions {
  /**
   * Fetch missing bytes from the signed-in user's cloud copy (default
   * true). A list of thumbnails passes false, so it never queues one cloud
   * fetch per record; it still shows bytes another screen kept here.
   */
  remote?: boolean
}

/**
 * A record's photo for a role, for rendering. Legacy photos (data URL or
 * cloud URL in the record) are available at once; photo-store photos load
 * from IndexedDB, showing 'loading' until then. A ref whose bytes aren't on
 * this device is fetched from the signed-in user's cloud copy when there is
 * one (checked against its sha256 and cached; see `fetchRemotePhoto`), and
 * is otherwise 'missing', with whether its hash is in a stored ParkProof
 * signature ("Signed fingerprint ..." versus "Not signed yet").
 *
 * A photo it hasn't got is asked for again whenever the photo source
 * changes (a cloud source installed, a sign-in, bytes kept here by another
 * reader), so a screen that mounted before then catches up on its own.
 */
export function useSessionPhoto(
  session: ParkingSession | null | undefined,
  role: PhotoRole,
  options: SessionPhotoOptions = {},
): SessionPhotoState {
  const remote = options.remote !== false
  const ref = session ? photoRefFor(session, role) : null
  const sessionId = session?.id ?? null
  const sha256 = ref?.sha256 ?? null
  const shared = !!session?.shared_from
  const key = sessionId && sha256 ? `${sessionId}/${sha256}` : null
  const [loaded, setLoaded] = useState<{ key: string; src: string | null } | null>(null)
  const sourceVersion = useSyncExternalStore(subscribePhotoSource, photoSourceVersion, photoSourceVersion)
  // The photo whose bytes are already shown: a source change can't improve on them.
  const shownKey = useRef<string | null>(null)

  useEffect(() => {
    if (!sessionId || !sha256) return
    const loadedKey = `${sessionId}/${sha256}`
    if (shownKey.current === loadedKey) return
    let cancelled = false
    getPhoto(sessionId, sha256)
      .catch((err) => {
        console.warn('[photos] could not read a photo:', err)
        return null
      })
      .then((src) => (src || shared || !remote ? src : fetchRemotePhoto(sessionId, sha256)))
      .then((src) => {
        if (cancelled) return
        shownKey.current = src ? loadedKey : null
        setLoaded({ key: loadedKey, src })
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, sha256, shared, remote, sourceVersion])

  if (!session) return { status: 'none' }
  if (ref && (!loaded || loaded.key !== key)) return { status: 'loading' }
  const settled = settleSessionPhoto(session, role, ref && loaded ? loaded.src : null)
  if (settled.kind === 'available') return { status: 'available', src: settled.src }
  if (settled.kind === 'missing') {
    return { status: 'missing', sha256: settled.ref.sha256, signed: photoHashSigned(session, settled.ref.sha256) }
  }
  return { status: 'none' }
}
