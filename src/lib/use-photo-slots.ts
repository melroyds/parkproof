// Photos taken on one screen for one record, one per role (build spec T2):
// the angle grid's tiles and the proof photo. Every capture goes through
// `resizeImageFile`, then `putPhoto` (via `storeSessionPhoto`), and only
// then gets a PhotoRef (N4): a tile shows saving, then saved or an error
// with a retry. A newer photo for a role replaces the older one, whose late
// result is ignored.
import { useRef, useState } from 'react'
import type { PhotoRef, PhotoRole } from '../types'
import { resizeImageFile } from './image'
import { captureMetaFor, storeSessionPhoto, type PhotoCaptureMeta } from './session-photos'

export interface PhotoSlot {
  status: 'saving' | 'saved' | 'failed'
  dataUrl: string
  meta: PhotoCaptureMeta
  /** Which input the photo came through ('library' only from an explicit library button). */
  input: 'camera' | 'library'
  /** Set once the bytes are stored. */
  ref: PhotoRef | null
}

interface Entry {
  result: Promise<PhotoRef | null>
  dataUrl: string
}

export interface PhotoSlots {
  slots: Partial<Record<PhotoRole, PhotoSlot>>
  /** The role whose last file couldn't be read, or null. */
  readError: PhotoRole | null
  /**
   * Resize and store a picked file for a role. Ignored once closed.
   * Resolves with the photo's capture metadata once its write has started,
   * or null when nothing was stored (closed, or the file couldn't be read).
   */
  capture(role: PhotoRole, file: File, input: 'camera' | 'library'): Promise<PhotoCaptureMeta | null>
  /** Try storing a failed photo again. */
  retry(role: PhotoRole): void
  /** Drop a role's photo (its bytes are tidied by whoever owns the screen). */
  remove(role: PhotoRole): void
  /** No more captures, retries or removals: save or cancel has started. */
  close(): void
  /** Take captures, retries and removals again (an add that failed, so the driver can retake or retry). */
  reopen(): void
  /** Wait for each role's current write; the refs of the stored photos, in `order`. */
  settle(order: readonly PhotoRole[]): Promise<PhotoRef[]>
  /** Every data URL this screen tried to store, for tidying after a cancel. */
  captured(): string[]
  /** True while any photo is still being stored. */
  saving: boolean
  /** How many photos are stored. */
  savedCount: number
}

/**
 * Photo slots for one record. `onWrite` is told about every write started,
 * so a screen that tidies by record (the logger) can wait for them all.
 */
export function usePhotoSlots(sessionId: string, onWrite?: (write: Promise<unknown>) => void): PhotoSlots {
  const [slots, setSlots] = useState<Partial<Record<PhotoRole, PhotoSlot>>>({})
  const [readError, setReadError] = useState<PhotoRole | null>(null)
  const current = useRef(new Map<PhotoRole, Entry>())
  const all = useRef<string[]>([])
  const closed = useRef(false)

  const write = (role: PhotoRole, dataUrl: string, meta: PhotoCaptureMeta, input: 'camera' | 'library') => {
    if (closed.current) return
    setSlots((prev) => ({ ...prev, [role]: { status: 'saving', dataUrl, meta, input, ref: null } }))
    const result = storeSessionPhoto(sessionId, role, dataUrl, meta)
    const entry: Entry = { result, dataUrl }
    current.current.set(role, entry)
    all.current.push(dataUrl)
    onWrite?.(result)
    void result.then((ref) => {
      if (current.current.get(role) !== entry) return // replaced or removed meanwhile
      setSlots((prev) => ({
        ...prev,
        [role]: { status: ref ? 'saved' : 'failed', dataUrl, meta, input, ref },
      }))
    })
  }

  const capture = async (role: PhotoRole, file: File, input: 'camera' | 'library'): Promise<PhotoCaptureMeta | null> => {
    if (closed.current) return null
    // Time and source are taken when the file arrives, before the resize.
    const meta = captureMetaFor(file, input)
    setReadError(null)
    let dataUrl: string
    try {
      ;({ dataUrl } = await resizeImageFile(file))
    } catch (err) {
      console.warn('[photos] could not read a photo:', err)
      setReadError(role)
      return null
    }
    if (closed.current) return null
    write(role, dataUrl, meta, input)
    return meta
  }

  const retry = (role: PhotoRole) => {
    const slot = slots[role]
    if (!slot || slot.status !== 'failed') return
    write(role, slot.dataUrl, slot.meta, slot.input)
  }

  const remove = (role: PhotoRole) => {
    if (closed.current) return
    current.current.delete(role)
    setSlots((prev) => {
      const next = { ...prev }
      delete next[role]
      return next
    })
  }

  const settle = async (order: readonly PhotoRole[]): Promise<PhotoRef[]> => {
    const refs: PhotoRef[] = []
    for (const role of order) {
      const entry = current.current.get(role)
      if (!entry) continue
      const ref = await entry.result.catch(() => null)
      if (ref) refs.push(ref)
    }
    return refs
  }

  const values = Object.values(slots) as PhotoSlot[]
  return {
    slots,
    readError,
    capture,
    retry,
    remove,
    close: () => {
      closed.current = true
    },
    reopen: () => {
      closed.current = false
    },
    settle,
    captured: () => [...all.current],
    saving: values.some((s) => s.status === 'saving'),
    savedCount: values.filter((s) => s.status === 'saved').length,
  }
}
