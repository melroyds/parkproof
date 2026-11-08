// The photo store (build spec N4): every new photo's bytes live in
// IndexedDB, not in localStorage.
//
// Content-addressed and immutable. A photo's key is `${sessionId}/${sha256}`,
// where sha256 is the hash of the exact JPEG bytes stored (computed with
// `hashDataUrlImage`, the same hash link 0 signs). The role (sign, car,
// condition-front...) is metadata on the record's PhotoRef, never part of
// the key. A key is written once and never overwritten: writing the same
// bytes again is a no-op.
//
// The backend is injectable, so tests run on an in-memory backend
// (`createMemoryPhotoBackend`) while the app uses IndexedDB.
import { decodeDataUrl, encodeDataUrl, hashDataUrlImage } from './hash'

export const PHOTO_DB_NAME = 'parkproof-photos'
export const PHOTO_DB_VERSION = 1
const STORE = 'photos'
const CREATED_INDEX = 'created_at'

/**
 * Startup GC keeps photos of a record that isn't saved (yet) for this long.
 * A logger open in another tab writes its photos before the record exists.
 */
export const ORPHAN_PHOTO_AGE_MS = 24 * 60 * 60 * 1000

const SHA256_RE = /^[0-9a-f]{64}$/

/** One stored photo. `bytes` are the exact bytes `sha256` was computed over. */
export interface StoredPhoto {
  key: string
  session_id: string
  sha256: string
  /** Media type of the bytes, e.g. 'image/jpeg'. */
  type: string
  bytes: ArrayBuffer
  /** When this device wrote it (ms). */
  created_at: number
}

export interface StoredPhotoMeta {
  key: string
  created_at: number
}

/**
 * Where the bytes live. Every method resolves only once its write or read
 * has completed (for IndexedDB: the transaction's `complete` event).
 */
export interface PhotoBackend {
  /** Write `record` unless its key already exists. Never overwrites. */
  add(record: StoredPhoto): Promise<void>
  get(key: string): Promise<StoredPhoto | null>
  /** Every stored key with its write time, without reading the bytes. */
  listMeta(): Promise<StoredPhotoMeta[]>
  delete(keys: readonly string[]): Promise<void>
  /**
   * Can this backend store photos at all? False when the browser has no
   * working IndexedDB (none at all, or the last open failed). A backend
   * without this method counts as available.
   */
  available?(): boolean
}

/** The store key of a record's photo. */
export function photoKey(sessionId: string, sha256: string): string {
  return `${sessionId}/${sha256}`
}

/** The record id and hash in a store key, or null when the key isn't one. */
export function parsePhotoKey(key: string): { sessionId: string; sha256: string } | null {
  const slash = key.lastIndexOf('/')
  if (slash <= 0) return null
  const sessionId = key.slice(0, slash)
  const sha256 = key.slice(slash + 1)
  if (!isValidSessionId(sessionId) || !SHA256_RE.test(sha256)) return null
  return { sessionId, sha256 }
}

function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && !id.includes('/')
}

function assertSessionId(id: unknown): asserts id is string {
  if (!isValidSessionId(id)) throw new Error('photo store: invalid record id')
}

function assertSha256(sha256: unknown): asserts sha256 is string {
  if (typeof sha256 !== 'string' || !SHA256_RE.test(sha256)) throw new Error('photo store: invalid sha256')
}

const prefixOf = (sessionId: string) => `${sessionId}/`

// ─── IndexedDB backend ───────────────────────────────────────────────────

/** Open (and on first use create) the photo database. */
export function openPhotoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const req = indexedDB.open(PHOTO_DB_NAME, PHOTO_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex(CREATED_INDEX, 'created_at')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Could not open the photo store'))
    // `blocked`: another tab still holds an older version open. It closes
    // its connection on `versionchange` (below), after which this succeeds.
  })
}

/** Errors after which the connection is reopened once and the call retried. */
function isReopenableError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name
  return name === 'InvalidStateError' || name === 'UnknownError'
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('photo store transaction failed'))
    tx.onabort = () => reject(tx.error ?? new DOMException('photo store transaction aborted', 'AbortError'))
  })
}

/**
 * The IndexedDB backend. One connection, opened lazily and shared. If an
 * operation fails with InvalidStateError (the connection was closed under
 * us, for example by the browser or another tab's upgrade) or UnknownError
 * (Safari's transient IndexedDB failures), the connection is dropped,
 * reopened once and the operation retried once.
 */
export function createIndexedDbPhotoBackend(open: () => Promise<IDBDatabase> = openPhotoDb): PhotoBackend {
  let connection: Promise<IDBDatabase> | null = null
  // Whether the last attempt to open the database failed (Firefox private
  // windows before v115 and some in-app WebViews fail every open). Cleared
  // by the next successful open.
  let lastOpenFailed = false

  const getDb = (): Promise<IDBDatabase> => {
    if (!connection) {
      const opening = open().then((db) => {
        lastOpenFailed = false
        db.onversionchange = () => {
          db.close()
          if (connection === opening) connection = null
        }
        db.onclose = () => {
          if (connection === opening) connection = null
        }
        return db
      })
      opening.catch(() => {
        lastOpenFailed = true
        if (connection === opening) connection = null
      })
      connection = opening
    }
    return connection
  }

  const run = async <T>(op: (db: IDBDatabase) => Promise<T>): Promise<T> => {
    try {
      return await op(await getDb())
    } catch (err) {
      if (!isReopenableError(err)) throw err
      const stale = connection
      connection = null
      try {
        ;(await stale)?.close()
      } catch {
        /* already closed, or never opened */
      }
      return op(await getDb())
    }
  }

  return {
    available: () => !lastOpenFailed,
    add: (record) =>
      run(async (db) => {
        const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' })
        const finished = done(tx)
        const store = tx.objectStore(STORE)
        const probe = store.count(record.key)
        probe.onsuccess = () => {
          // Content-addressed: an existing key already holds these bytes.
          if (probe.result === 0) store.add(record)
        }
        await finished
      }),
    get: (key) =>
      run(async (db) => {
        const tx = db.transaction(STORE, 'readonly')
        const finished = done(tx)
        const req = tx.objectStore(STORE).get(key)
        await finished
        return (req.result as StoredPhoto | undefined) ?? null
      }),
    listMeta: () =>
      run(async (db) => {
        const tx = db.transaction(STORE, 'readonly')
        const finished = done(tx)
        const out: StoredPhotoMeta[] = []
        const cursor = tx.objectStore(STORE).index(CREATED_INDEX).openKeyCursor()
        cursor.onsuccess = () => {
          const c = cursor.result
          if (!c) return
          out.push({ key: String(c.primaryKey), created_at: Number(c.key) })
          c.continue()
        }
        await finished
        return out
      }),
    delete: (keys) =>
      run(async (db) => {
        if (keys.length === 0) return
        const tx = db.transaction(STORE, 'readwrite', { durability: 'strict' })
        const finished = done(tx)
        const store = tx.objectStore(STORE)
        for (const key of keys) store.delete(key)
        await finished
      }),
  }
}

// ─── In-memory backend (tests) ───────────────────────────────────────────

/** A backend that keeps photos in a Map. Same semantics as IndexedDB's. */
export function createMemoryPhotoBackend(): PhotoBackend & { readonly records: Map<string, StoredPhoto> } {
  const records = new Map<string, StoredPhoto>()
  const copy = (r: StoredPhoto): StoredPhoto => ({ ...r, bytes: r.bytes.slice(0) })
  return {
    records,
    async add(record) {
      if (!records.has(record.key)) records.set(record.key, copy(record))
    },
    async get(key) {
      const r = records.get(key)
      return r ? copy(r) : null
    },
    async listMeta() {
      return [...records.values()].map((r) => ({ key: r.key, created_at: r.created_at }))
    },
    async delete(keys) {
      for (const k of keys) records.delete(k)
    },
  }
}

// ─── The active backend ──────────────────────────────────────────────────

let backend: PhotoBackend | null = null
let persistRequested = false

/**
 * Without IndexedDB at all (some embedded browsers, the test DOM) nothing
 * can have been stored: reads find nothing, deletes have nothing to do, and
 * only a write fails.
 */
const UNAVAILABLE_BACKEND: PhotoBackend = {
  add: async () => {
    throw new Error('IndexedDB is not available')
  },
  get: async () => null,
  listMeta: async () => [],
  delete: async () => {},
  available: () => false,
}

function activeBackend(): PhotoBackend {
  if (!backend) {
    backend = typeof indexedDB === 'undefined' || !indexedDB ? UNAVAILABLE_BACKEND : createIndexedDbPhotoBackend()
  }
  return backend
}

/**
 * Can this browser store photos in the photo store at all? False without
 * IndexedDB, or when the last attempt to open it failed. A write that
 * failed while this is still true was a transient failure, worth a retry;
 * while it is false a retry can't help, so a caller keeps the photo some
 * other way (the logger keeps it in the record's legacy field).
 */
export function isPhotoStoreAvailable(): boolean {
  const active = activeBackend()
  return typeof active.available === 'function' ? active.available() : true
}

/**
 * Test hook: use this backend (null goes back to IndexedDB, opened lazily)
 * and forget that persistent storage was requested.
 */
export function setPhotoBackendForTests(next: PhotoBackend | null): void {
  backend = next
  persistRequested = false
}

/**
 * Ask the browser to keep this site's storage (`navigator.storage.persist()`),
 * so it isn't cleared under storage pressure. Called on the first photo
 * capture; at most once per page. Best-effort: never throws, and the answer
 * changes nothing in the app.
 */
export function requestPersistentStorage(): void {
  if (persistRequested) return
  persistRequested = true
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined
    if (!storage || typeof storage.persist !== 'function') return
    const already = typeof storage.persisted === 'function' ? storage.persisted() : Promise.resolve(false)
    void already
      .then((yes) => (yes ? true : storage.persist()))
      .catch(() => false)
  } catch {
    /* best-effort */
  }
}

// ─── API ─────────────────────────────────────────────────────────────────

/**
 * Store a photo for a record. `dataUrl` must be a base64 data URL (what
 * `resizeImageFile` returns); its bytes are stored and hashed with
 * `hashDataUrlImage`. Resolves with the sha256 once the write has
 * completed, so a PhotoRef made from it always has bytes behind it.
 * Rejects when the bytes couldn't be stored; the caller then shows an
 * error and makes no PhotoRef.
 */
export async function putPhoto(sessionId: string, dataUrl: string): Promise<string> {
  assertSessionId(sessionId)
  const decoded = typeof dataUrl === 'string' ? decodeDataUrl(dataUrl) : null
  if (!decoded) throw new Error('photo store: putPhoto needs a base64 data URL')
  const sha256 = await hashDataUrlImage(dataUrl)
  requestPersistentStorage()
  await activeBackend().add({
    key: photoKey(sessionId, sha256),
    session_id: sessionId,
    sha256,
    type: decoded.type,
    bytes: decoded.bytes.buffer.slice(
      decoded.bytes.byteOffset,
      decoded.bytes.byteOffset + decoded.bytes.byteLength,
    ) as ArrayBuffer,
    created_at: Date.now(),
  })
  return sha256
}

/** A record's stored photo bytes, or null when they aren't on this device. */
export async function getPhotoBytes(
  sessionId: string,
  sha256: string,
): Promise<{ type: string; bytes: Uint8Array } | null> {
  assertSessionId(sessionId)
  assertSha256(sha256)
  const record = await activeBackend().get(photoKey(sessionId, sha256))
  if (!record) return null
  return { type: record.type, bytes: new Uint8Array(record.bytes) }
}

/**
 * A record's stored photo as a data URL (for `<img>` and the PDF), or null
 * when the bytes aren't on this device.
 */
export async function getPhoto(sessionId: string, sha256: string): Promise<string | null> {
  const stored = await getPhotoBytes(sessionId, sha256)
  return stored ? encodeDataUrl(stored.type, stored.bytes) : null
}

/** Every photo stored for a record: its hash and when this device wrote it. */
export async function listSessionPhotos(sessionId: string): Promise<Array<{ sha256: string; created_at: number }>> {
  assertSessionId(sessionId)
  const prefix = prefixOf(sessionId)
  const metas = await activeBackend().listMeta()
  return metas
    .filter((m) => m.key.startsWith(prefix))
    .map((m) => ({ sha256: m.key.slice(prefix.length), created_at: m.created_at }))
    .filter((m) => SHA256_RE.test(m.sha256))
    .sort((a, b) => a.created_at - b.created_at || a.sha256.localeCompare(b.sha256))
}

/** Delete every photo of a record. Resolves with how many were deleted. */
export async function deleteSessionPhotos(sessionId: string): Promise<number> {
  return deleteSessionPhotosExcept(sessionId, [])
}

/**
 * Delete a record's photos except the ones in `keep` (hashes). The logger
 * runs this right after a save, so photos taken and then replaced or
 * removed don't stay on the device. Resolves with how many were deleted.
 */
export async function deleteSessionPhotosExcept(sessionId: string, keep: Iterable<string>): Promise<number> {
  assertSessionId(sessionId)
  const keepSet = new Set(keep)
  const prefix = prefixOf(sessionId)
  const metas = await activeBackend().listMeta()
  const doomed = metas
    .filter((m) => m.key.startsWith(prefix) && !keepSet.has(m.key.slice(prefix.length)))
    .map((m) => m.key)
  if (doomed.length > 0) await activeBackend().delete(doomed)
  return doomed.length
}

/**
 * Delete some of a record's photos, by hash. A screen that took photos for
 * a saved record and then dropped them (a sheet cancelled, a photo
 * retaken) deletes only those, so the record's other photos and any photo
 * another screen is still taking are left alone. Hashes that aren't stored
 * are skipped. Resolves with how many were deleted.
 */
export async function deletePhotos(sessionId: string, sha256s: Iterable<string>): Promise<number> {
  assertSessionId(sessionId)
  const wanted = new Set<string>()
  for (const sha256 of sha256s) {
    assertSha256(sha256)
    wanted.add(photoKey(sessionId, sha256))
  }
  if (wanted.size === 0) return 0
  const metas = await activeBackend().listMeta()
  const doomed = metas.filter((m) => wanted.has(m.key)).map((m) => m.key)
  if (doomed.length > 0) await activeBackend().delete(doomed)
  return doomed.length
}

/**
 * Startup GC: delete photos whose record id isn't in `knownIds` and that
 * were written at least ORPHAN_PHOTO_AGE_MS ago (a logger that hasn't
 * saved yet, in this tab or another, keeps its photos meanwhile). Keys that
 * aren't photo keys are treated as orphans too. Resolves with how many
 * were deleted.
 */
export async function sweepOrphanPhotos(knownIds: Iterable<string>, now: number = Date.now()): Promise<number> {
  const known = new Set(knownIds)
  const cutoff = now - ORPHAN_PHOTO_AGE_MS
  const metas = await activeBackend().listMeta()
  const doomed = metas
    .filter((m) => {
      if (!(m.created_at <= cutoff)) return false
      const parsed = parsePhotoKey(m.key)
      return !parsed || !known.has(parsed.sessionId)
    })
    .map((m) => m.key)
  if (doomed.length > 0) await activeBackend().delete(doomed)
  return doomed.length
}
