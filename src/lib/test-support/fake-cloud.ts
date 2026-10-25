// Test-only: an in-memory stand-in for the signed-in API (/sessions/*,
// /photos/*) and the evidence bucket, for the client sync tests. Uploads go
// through the REAL server merge (readIncomingSession + mergeSessionRows from
// lambda/cloud-sync.js), so a test sees what the server would store.
// /sessions/list hydrates legacy photos the way the server does (a URL for
// every per-role object that exists, never for a role with a ref).
import { mergeSessionRows, readIncomingSession } from '../../../lambda/cloud-sync.js'
import { decodeDataUrl, encodeDataUrl } from '../hash'

export interface FakeCall {
  url: string
  method: string
  body: unknown
}

type Row = Record<string, unknown>

const b64url = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** An id token whose payload carries `sub` (the client only reads the sub). */
export function fakeIdToken(sub: string): string {
  return `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ sub }))}.sig`
}

export interface FakeCloud {
  userId: string
  /** Stored rows by record id, as the server stores them (without pk/sk). */
  rows: Map<string, Row>
  /** Evidence bucket objects by key. */
  objects: Map<string, { type: string; bytes: Uint8Array }>
  calls: FakeCall[]
  /** S3 keys whose PUT answers 500. */
  failPut: Set<string>
  /** Runs before a /sessions/upload is merged (to hold it open or interleave). */
  beforeUpload: ((row: Row) => Promise<void> | void) | null
  /** Runs before a photo PUT is stored. */
  beforePut: ((key: string) => Promise<void> | void) | null
  /** Answers /api/sign-session; default 503 (transient). */
  signSession: ((body: unknown) => Promise<Response> | Response) | null
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  /** Store a photo object the way an upload would (for cloud-side fixtures). */
  putObject: (key: string, dataUrl: string) => void
  /** The data URL of a stored object, or null. */
  objectDataUrl: (key: string) => string | null
  uploads: () => Row[]
  photoPuts: () => string[]
}

export function createFakeCloud(userId = 'user-1'): FakeCloud {
  const cloud: FakeCloud = {
    userId,
    rows: new Map(),
    objects: new Map(),
    calls: [],
    failPut: new Set(),
    beforeUpload: null,
    beforePut: null,
    signSession: null,
    fetch: async () => new Response('not set up', { status: 500 }),
    putObject(key, dataUrl) {
      const decoded = decodeDataUrl(dataUrl)
      if (!decoded) throw new Error('fake cloud: putObject needs a data URL')
      cloud.objects.set(key, decoded)
    },
    objectDataUrl(key) {
      const o = cloud.objects.get(key)
      return o ? encodeDataUrl(o.type, o.bytes) : null
    },
    uploads: () =>
      cloud.calls.filter((c) => c.url.endsWith('/sessions/upload')).map((c) => (c.body as { session: Row }).session),
    photoPuts: () => cloud.calls.filter((c) => c.method === 'PUT').map((c) => c.url.replace('https://s3.test/put/', '')),
  }

  const legacyKey = (sid: string, role: string) => `${userId}/${sid}/${role}.jpg`
  const refKey = (sid: string, sha: string) => `${userId}/${sid}/p/${sha}.jpg`
  const targetKey = (body: Row): string =>
    typeof body.sha256 === 'string' ? refKey(String(body.session_id), body.sha256) : legacyKey(String(body.session_id), String(body.role))
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

  cloud.fetch = async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    let body: unknown = init.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        /* leave as text */
      }
    }
    cloud.calls.push({ url: input, method, body })

    if (input.startsWith('https://s3.test/put/')) {
      const key = input.slice('https://s3.test/put/'.length)
      if (cloud.beforePut) await cloud.beforePut(key)
      if (cloud.failPut.has(key)) return new Response('boom', { status: 500 })
      const blob = init.body as Blob
      cloud.objects.set(key, { type: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) })
      return new Response('', { status: 200 })
    }
    if (input.endsWith('/sign-session')) {
      return cloud.signSession ? cloud.signSession(body) : new Response('{}', { status: 503 })
    }
    const b = (body ?? {}) as Row
    if (input.endsWith('/sessions/upload')) {
      const session = (b.session ?? {}) as Row
      if (cloud.beforeUpload) await cloud.beforeUpload(session)
      let incoming: Row
      try {
        incoming = readIncomingSession(session)
      } catch (err) {
        return json({ error: (err as Error).message }, 400)
      }
      const id = String(incoming.id)
      cloud.rows.set(id, structuredClone(mergeSessionRows(cloud.rows.get(id) ?? null, incoming)))
      return json({ ok: true, session_id: id })
    }
    if (input.endsWith('/sessions/list')) {
      const sessions = [...cloud.rows.values()].map((row) => {
        const out = structuredClone(row)
        const photos = Array.isArray(out.photos) ? (out.photos as Array<{ role?: unknown }>) : []
        for (const role of ['sign', 'car', 'ambient']) {
          const field = `${role}_photo`
          const key = legacyKey(String(out.id), role)
          if (!photos.some((p) => p?.role === role) && cloud.objects.has(key)) out[field] = `https://s3.test/get/${key}`
          else if (out[field] !== undefined) out[field] = null
        }
        return out
      })
      return json({ sessions })
    }
    if (input.endsWith('/sessions/delete')) {
      const id = String(b.session_id)
      cloud.rows.delete(id)
      for (const key of [...cloud.objects.keys()]) if (key.startsWith(`${userId}/${id}/`)) cloud.objects.delete(key)
      return json({ ok: true })
    }
    if (input.endsWith('/photos/presign')) {
      const key = targetKey(b)
      if (typeof b.sha256 === 'string' && cloud.objects.has(key)) return json({ exists: true, key, bucket: 'b' })
      return json({ url: `https://s3.test/put/${key}`, key, bucket: 'b' })
    }
    if (input.endsWith('/photos/materialize')) {
      return json({ data_url: cloud.objectDataUrl(targetKey(b)) })
    }
    return new Response('not found', { status: 404 })
  }
  return cloud
}
