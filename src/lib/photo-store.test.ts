// @vitest-environment happy-dom
//
// The photo store (build spec N4, T0b2): content-addressed, immutable,
// keyed `${sessionId}/${sha256}`, on an injected backend. The IndexedDB
// adapter is exercised against a small in-test fake of the IndexedDB API
// (only what the adapter uses), including the reopen-once rule.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ORPHAN_PHOTO_AGE_MS,
  createIndexedDbPhotoBackend,
  createMemoryPhotoBackend,
  deleteSessionPhotos,
  deleteSessionPhotosExcept,
  getPhoto,
  getPhotoBytes,
  isPhotoStoreAvailable,
  listSessionPhotos,
  parsePhotoKey,
  photoKey,
  putPhoto,
  requestPersistentStorage,
  setPhotoBackendForTests,
  sweepOrphanPhotos,
  type PhotoBackend,
  type StoredPhoto,
} from './photo-store'
import { hashDataUrlImage } from './hash'

const REC = '6f1c2a40-2b8e-4c7d-9a51-0d3e5f7a9b11'
const OTHER = '0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b'

function jpeg(text: string): string {
  return 'data:image/jpeg;base64,' + btoa(text)
}

let memory: ReturnType<typeof createMemoryPhotoBackend>

beforeEach(() => {
  memory = createMemoryPhotoBackend()
  setPhotoBackendForTests(memory)
})

afterEach(() => {
  setPhotoBackendForTests(null)
  vi.useRealTimers()
})

describe('keys', () => {
  it('photoKey and parsePhotoKey round-trip; role is never part of the key', () => {
    const sha = 'a'.repeat(64)
    expect(photoKey(REC, sha)).toBe(`${REC}/${sha}`)
    expect(parsePhotoKey(photoKey(REC, sha))).toEqual({ sessionId: REC, sha256: sha })
  })

  it('parsePhotoKey rejects anything that is not `${id}/${hex64}`', () => {
    expect(parsePhotoKey('no-slash')).toBeNull()
    expect(parsePhotoKey(`/${'a'.repeat(64)}`)).toBeNull()
    expect(parsePhotoKey(`${REC}/ABC`)).toBeNull()
    expect(parsePhotoKey(`${REC}/${'A'.repeat(64)}`)).toBeNull()
  })
})

describe('putPhoto / getPhoto', () => {
  it('stores the bytes under `${id}/${sha256}` and returns the hashDataUrlImage hash', async () => {
    const url = jpeg('sign-bytes')
    const sha = await putPhoto(REC, url)
    expect(sha).toBe(await hashDataUrlImage(url))
    expect([...memory.records.keys()]).toEqual([`${REC}/${sha}`])
    const stored = memory.records.get(`${REC}/${sha}`)!
    expect(stored.session_id).toBe(REC)
    expect(stored.type).toBe('image/jpeg')
    expect(new TextDecoder().decode(stored.bytes)).toBe('sign-bytes')
  })

  it('getPhoto returns the same data URL; getPhotoBytes returns the exact bytes', async () => {
    const url = jpeg('car-bytes ÿ\u0000\u0001')
    const sha = await putPhoto(REC, url)
    expect(await getPhoto(REC, sha)).toBe(url)
    const bytes = await getPhotoBytes(REC, sha)
    expect(bytes?.type).toBe('image/jpeg')
    expect(await crypto.subtle.digest('SHA-256', bytes!.bytes as BufferSource).then((d) =>
      Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join(''),
    )).toBe(sha)
  })

  it('round-trips a large photo (chunked base64)', async () => {
    const big = 'x'.repeat(300_000)
    const url = jpeg(big)
    const sha = await putPhoto(REC, url)
    expect(await getPhoto(REC, sha)).toBe(url)
  })

  it('getPhoto is null when the bytes are not on this device', async () => {
    expect(await getPhoto(REC, 'b'.repeat(64))).toBeNull()
    expect(await getPhotoBytes(REC, 'b'.repeat(64))).toBeNull()
  })

  it('never overwrites a key: the same bytes again keep the first write', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'))
    const url = jpeg('same')
    const sha = await putPhoto(REC, url)
    const first = memory.records.get(`${REC}/${sha}`)!.created_at
    vi.setSystemTime(new Date('2026-10-02T00:00:00.000Z'))
    expect(await putPhoto(REC, url)).toBe(sha)
    expect(memory.records.size).toBe(1)
    expect(memory.records.get(`${REC}/${sha}`)!.created_at).toBe(first)
  })

  it('the same bytes on two records are two keys (one record never shares another\'s photos)', async () => {
    const url = jpeg('shared')
    const a = await putPhoto(REC, url)
    const b = await putPhoto(OTHER, url)
    expect(a).toBe(b)
    expect(memory.records.size).toBe(2)
  })

  it('rejects input that is not a base64 data URL, and invalid record ids', async () => {
    await expect(putPhoto(REC, 'https://example.com/a.jpg')).rejects.toThrow(/data URL/)
    await expect(putPhoto(REC, 'data:image/jpeg;base64,***')).rejects.toThrow(/data URL/)
    await expect(putPhoto('a/b', jpeg('x'))).rejects.toThrow(/record id/)
    await expect(putPhoto('', jpeg('x'))).rejects.toThrow(/record id/)
    await expect(getPhoto(REC, 'not-a-hash')).rejects.toThrow(/sha256/)
    expect(memory.records.size).toBe(0)
  })

  it('rejects when the backend write fails, so no PhotoRef can be made', async () => {
    const failing: PhotoBackend = { ...memory, add: async () => Promise.reject(new DOMException('full', 'QuotaExceededError')) }
    setPhotoBackendForTests(failing)
    await expect(putPhoto(REC, jpeg('x'))).rejects.toThrow('full')
  })

  it('resolves only after the backend write has completed', async () => {
    let finish!: () => void
    const order: string[] = []
    const slow: PhotoBackend = {
      ...memory,
      add: (record) =>
        new Promise<void>((resolve) => {
          finish = () => {
            void memory.add(record).then(() => {
              order.push('written')
              resolve()
            })
          }
        }),
    }
    setPhotoBackendForTests(slow)
    const put = putPhoto(REC, jpeg('slow')).then(() => order.push('resolved'))
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(order).toEqual([])
    finish()
    await put
    expect(order).toEqual(['written', 'resolved'])
  })
})

describe('listing and deleting', () => {
  it('listSessionPhotos lists one record\'s photos only', async () => {
    const a = await putPhoto(REC, jpeg('a'))
    const b = await putPhoto(REC, jpeg('b'))
    await putPhoto(OTHER, jpeg('c'))
    const listed = await listSessionPhotos(REC)
    expect(listed.map((p) => p.sha256).sort()).toEqual([a, b].sort())
    expect(listed.every((p) => typeof p.created_at === 'number')).toBe(true)
  })

  it('deleteSessionPhotos deletes every photo of that record and nothing else', async () => {
    await putPhoto(REC, jpeg('a'))
    await putPhoto(REC, jpeg('b'))
    const keep = await putPhoto(OTHER, jpeg('c'))
    expect(await deleteSessionPhotos(REC)).toBe(2)
    expect([...memory.records.keys()]).toEqual([`${OTHER}/${keep}`])
    expect(await deleteSessionPhotos(REC)).toBe(0)
  })

  it('deleteSessionPhotosExcept keeps the listed hashes', async () => {
    const a = await putPhoto(REC, jpeg('a'))
    await putPhoto(REC, jpeg('replaced'))
    expect(await deleteSessionPhotosExcept(REC, [a])).toBe(1)
    expect((await listSessionPhotos(REC)).map((p) => p.sha256)).toEqual([a])
  })
})

describe('sweepOrphanPhotos (startup GC)', () => {
  const now = Date.parse('2026-10-20T00:00:00.000Z')
  function seed(key: string, ageMs: number): void {
    const parsed = parsePhotoKey(key)
    const record: StoredPhoto = {
      key,
      session_id: parsed?.sessionId ?? 'x',
      sha256: parsed?.sha256 ?? 'x',
      type: 'image/jpeg',
      bytes: new Uint8Array([1, 2, 3]).buffer,
      created_at: now - ageMs,
    }
    memory.records.set(key, record)
  }

  it('deletes photos of absent records older than 24 h, and keeps everything else', async () => {
    const sha = 'c'.repeat(64)
    seed(`${REC}/${sha}`, ORPHAN_PHOTO_AGE_MS + 1) // known record, old: kept
    seed(`${OTHER}/${sha}`, ORPHAN_PHOTO_AGE_MS + 1) // absent, old: deleted
    seed(`young-logger/${sha}`, ORPHAN_PHOTO_AGE_MS - 60_000) // absent, young: kept (a logger may still save)
    seed(`edge/${sha}`, ORPHAN_PHOTO_AGE_MS) // exactly 24 h: deleted
    seed('garbage-key', ORPHAN_PHOTO_AGE_MS + 1) // not a photo key, old: deleted
    expect(await sweepOrphanPhotos([REC], now)).toBe(3)
    expect([...memory.records.keys()].sort()).toEqual([`${REC}/${sha}`, `young-logger/${sha}`].sort())
  })

  it('accepts any iterable of ids and deletes nothing when every record is known', async () => {
    seed(`${REC}/${'d'.repeat(64)}`, ORPHAN_PHOTO_AGE_MS * 3)
    expect(await sweepOrphanPhotos(new Set([REC]), now)).toBe(0)
    expect(memory.records.size).toBe(1)
  })
})

describe('navigator.storage.persist() on the first capture', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'storage')
  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'storage', original)
    else delete (navigator as unknown as Record<string, unknown>).storage
  })

  function stubStorage(persisted: boolean) {
    const storage = { persist: vi.fn(async () => true), persisted: vi.fn(async () => persisted) }
    Object.defineProperty(navigator, 'storage', { value: storage, configurable: true })
    return storage
  }

  it('asks once per page, on the first putPhoto', async () => {
    const storage = stubStorage(false)
    setPhotoBackendForTests(memory) // resets the once-per-page flag
    await putPhoto(REC, jpeg('one'))
    await putPhoto(REC, jpeg('two'))
    await vi.waitFor(() => expect(storage.persist).toHaveBeenCalledTimes(1))
    requestPersistentStorage()
    await new Promise((r) => setTimeout(r, 0))
    expect(storage.persist).toHaveBeenCalledTimes(1)
  })

  it('does not ask again when storage is already persisted', async () => {
    const storage = stubStorage(true)
    setPhotoBackendForTests(memory)
    await putPhoto(REC, jpeg('one'))
    await vi.waitFor(() => expect(storage.persisted).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(storage.persist).not.toHaveBeenCalled()
  })

  it('is harmless without navigator.storage', async () => {
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })
    setPhotoBackendForTests(memory)
    await expect(putPhoto(REC, jpeg('one'))).resolves.toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('without IndexedDB (the default backend in this test DOM)', () => {
  it('reads find nothing, deletes have nothing to do, and a write fails', async () => {
    expect(typeof indexedDB).toBe('undefined')
    setPhotoBackendForTests(null)
    await expect(putPhoto(REC, jpeg('x'))).rejects.toThrow(/IndexedDB/)
    expect(await getPhoto(REC, 'e'.repeat(64))).toBeNull()
    expect(await deleteSessionPhotos(REC)).toBe(0)
    expect(await sweepOrphanPhotos([], Date.now())).toBe(0)
    expect(await listSessionPhotos(REC)).toEqual([])
  })
})

// ─── The IndexedDB adapter against a fake IndexedDB ─────────────────────

class FakeRequest<T = unknown> {
  result: T | undefined = undefined
  error: DOMException | null = null
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
}

interface FakeRecord {
  key: string
  created_at: number
  [k: string]: unknown
}

class FakeDb {
  closed = false
  failNext: DOMException[] = []
  onversionchange: (() => void) | null = null
  onclose: (() => void) | null = null
  transactions: Array<{ mode: string; durability?: string }> = []
  readonly data: Map<string, FakeRecord>
  constructor(data: Map<string, FakeRecord>) {
    this.data = data
  }

  close() {
    this.closed = true
  }

  transaction(_store: string, mode: string, options?: { durability?: string }) {
    if (this.closed) throw new DOMException('The database connection is closing.', 'InvalidStateError')
    const fail = this.failNext.shift()
    if (fail) throw fail
    this.transactions.push({ mode, durability: options?.durability })
    return new FakeTx(this)
  }
}

class FakeTx {
  oncomplete: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  error: DOMException | null = null
  readonly db: FakeDb
  constructor(db: FakeDb) {
    this.db = db
    setTimeout(() => (this.error ? this.onabort?.() : this.oncomplete?.()), 0)
  }

  request<T>(fn: () => T): FakeRequest<T> {
    const req = new FakeRequest<T>()
    queueMicrotask(() => {
      try {
        req.result = fn()
        req.onsuccess?.()
      } catch (err) {
        req.error = err as DOMException
        this.error = err as DOMException
        req.onerror?.()
      }
    })
    return req
  }

  objectStore() {
    const data = this.db.data
    return {
      count: (key: string) => this.request(() => (data.has(key) ? 1 : 0)),
      add: (record: FakeRecord) =>
        this.request(() => {
          if (data.has(record.key)) throw new DOMException('Key already exists', 'ConstraintError')
          data.set(record.key, structuredClone(record))
          return record.key
        }),
      get: (key: string) => this.request(() => (data.has(key) ? structuredClone(data.get(key)) : undefined)),
      delete: (key: string) => this.request(() => void data.delete(key)),
      index: () => ({
        openKeyCursor: () => {
          const rows = [...data.values()].sort((a, b) => a.created_at - b.created_at)
          let i = 0
          const req = new FakeRequest<{ key: number; primaryKey: string; continue: () => void } | null>()
          const step = () =>
            queueMicrotask(() => {
              const row = rows[i++]
              req.result = row ? { key: row.created_at, primaryKey: row.key, continue: step } : null
              req.onsuccess?.()
            })
          step()
          return req
        },
      }),
    }
  }
}

function fakeIdb() {
  const data = new Map<string, FakeRecord>()
  const dbs: FakeDb[] = []
  const open = vi.fn(async () => {
    const db = new FakeDb(data)
    dbs.push(db)
    return db as unknown as IDBDatabase
  })
  return { data, dbs, open }
}

function photo(key: string, created_at: number, fill = 7): StoredPhoto {
  return {
    key,
    session_id: key.split('/')[0],
    sha256: key.split('/')[1] ?? '',
    type: 'image/jpeg',
    bytes: new Uint8Array([fill, fill, fill]).buffer,
    created_at,
  }
}

describe('createIndexedDbPhotoBackend', () => {
  const k1 = `${REC}/${'1'.repeat(64)}`
  const k2 = `${REC}/${'2'.repeat(64)}`

  it('add, get, listMeta and delete, with strict durability on writes', async () => {
    const idb = fakeIdb()
    const backend = createIndexedDbPhotoBackend(idb.open)
    await backend.add(photo(k1, 10))
    await backend.add(photo(k2, 5))
    expect((await backend.get(k1))?.created_at).toBe(10)
    expect(await backend.get(`${REC}/${'9'.repeat(64)}`)).toBeNull()
    expect(await backend.listMeta()).toEqual([
      { key: k2, created_at: 5 },
      { key: k1, created_at: 10 },
    ])
    await backend.delete([k1])
    expect([...idb.data.keys()]).toEqual([k2])
    expect(idb.open).toHaveBeenCalledTimes(1)
    const writes = idb.dbs[0].transactions.filter((t) => t.mode === 'readwrite')
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((t) => t.durability === 'strict')).toBe(true)
  })

  it('never overwrites an existing key (no ConstraintError either)', async () => {
    const idb = fakeIdb()
    const backend = createIndexedDbPhotoBackend(idb.open)
    await backend.add(photo(k1, 10, 1))
    await expect(backend.add(photo(k1, 99, 2))).resolves.toBeUndefined()
    const kept = await backend.get(k1)
    expect(kept?.created_at).toBe(10)
    expect([...new Uint8Array(kept!.bytes)]).toEqual([1, 1, 1])
  })

  it.each(['InvalidStateError', 'UnknownError'])('reopens once and retries after %s', async (name) => {
    const idb = fakeIdb()
    const backend = createIndexedDbPhotoBackend(idb.open)
    await backend.add(photo(k1, 10))
    idb.dbs[0].failNext.push(new DOMException('boom', name))
    expect((await backend.get(k1))?.key).toBe(k1)
    expect(idb.open).toHaveBeenCalledTimes(2)
    expect(idb.dbs[0].closed).toBe(true)
  })

  it('retries only once: a second failure after the reopen rejects', async () => {
    const idb = fakeIdb()
    let opened = 0
    const open = vi.fn(async () => {
      const db = new FakeDb(idb.data)
      db.failNext.push(new DOMException('still broken', 'UnknownError'))
      opened++
      return db as unknown as IDBDatabase
    })
    const backend = createIndexedDbPhotoBackend(open)
    await expect(backend.get(k1)).rejects.toThrow('still broken')
    expect(opened).toBe(2)
  })

  it('does not reopen for other errors', async () => {
    const idb = fakeIdb()
    const backend = createIndexedDbPhotoBackend(idb.open)
    await backend.listMeta()
    idb.dbs[0].failNext.push(new DOMException('nope', 'QuotaExceededError'))
    await expect(backend.add(photo(k1, 1))).rejects.toThrow('nope')
    expect(idb.open).toHaveBeenCalledTimes(1)
  })

  it('a connection closed by the browser is reopened on the next call', async () => {
    const idb = fakeIdb()
    const backend = createIndexedDbPhotoBackend(idb.open)
    await backend.add(photo(k1, 1))
    idb.dbs[0].close()
    idb.dbs[0].onclose?.()
    expect((await backend.get(k1))?.key).toBe(k1)
    expect(idb.open).toHaveBeenCalledTimes(2)
  })

  it('closes on versionchange (another tab upgrading) and reopens next time', async () => {
    const idb = fakeIdb()
    const backend = createIndexedDbPhotoBackend(idb.open)
    await backend.listMeta()
    idb.dbs[0].onversionchange?.()
    expect(idb.dbs[0].closed).toBe(true)
    await backend.listMeta()
    expect(idb.open).toHaveBeenCalledTimes(2)
  })

  it('a failed open is not cached: the next call opens again', async () => {
    let attempt = 0
    const idb = fakeIdb()
    const open = vi.fn(async () => {
      attempt++
      if (attempt === 1) throw new DOMException('no', 'NotAllowedError')
      return new FakeDb(idb.data) as unknown as IDBDatabase
    })
    const backend = createIndexedDbPhotoBackend(open)
    await expect(backend.listMeta()).rejects.toThrow('no')
    await expect(backend.listMeta()).resolves.toEqual([])
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('works behind the public API (putPhoto, getPhoto, deleteSessionPhotos)', async () => {
    const idb = fakeIdb()
    setPhotoBackendForTests(createIndexedDbPhotoBackend(idb.open))
    const url = jpeg('via-idb')
    const sha = await putPhoto(REC, url)
    expect(idb.data.has(`${REC}/${sha}`)).toBe(true)
    expect(await getPhoto(REC, sha)).toBe(url)
    expect(await deleteSessionPhotos(REC)).toBe(1)
    expect(idb.data.size).toBe(0)
  })
})

describe('isPhotoStoreAvailable', () => {
  it('false without IndexedDB, true for a working backend', () => {
    setPhotoBackendForTests(null) // this test DOM has no indexedDB
    expect(isPhotoStoreAvailable()).toBe(false)
    setPhotoBackendForTests(createMemoryPhotoBackend())
    expect(isPhotoStoreAvailable()).toBe(true)
  })

  it('IndexedDB: true until an open fails, false after it, true again after a successful open', async () => {
    const idb = fakeIdb()
    let failOpen = true
    const open = vi.fn(async () => {
      if (failOpen) throw new DOMException('A mutation operation was attempted on a database that did not allow mutations.', 'InvalidStateError')
      return new FakeDb(idb.data) as unknown as IDBDatabase
    })
    setPhotoBackendForTests(createIndexedDbPhotoBackend(open))
    expect(isPhotoStoreAvailable()).toBe(true) // never tried yet
    await expect(putPhoto(REC, jpeg('private-window'))).rejects.toThrow()
    expect(isPhotoStoreAvailable()).toBe(false)
    failOpen = false
    await putPhoto(REC, jpeg('works-now'))
    expect(isPhotoStoreAvailable()).toBe(true)
  })

  it('a failed write on a working connection is transient: still available', async () => {
    const idb = fakeIdb()
    setPhotoBackendForTests(createIndexedDbPhotoBackend(idb.open))
    await putPhoto(REC, jpeg('first'))
    idb.dbs[0].failNext.push(new DOMException('full', 'QuotaExceededError'))
    await expect(putPhoto(REC, jpeg('second'))).rejects.toThrow('full')
    expect(isPhotoStoreAvailable()).toBe(true)
  })
})
