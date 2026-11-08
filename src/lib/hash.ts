// SHA-256 helpers shared by the signing queue (signing.ts) and the photo
// store (photo-store.ts). They live here, not in signing.ts, so the photo
// store doesn't import the signing queue (which imports storage, which
// imports the photo store). signing.ts re-exports `hashDataUrlImage` and
// `sha256HexUtf8`, its public names for them.

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** The media type and raw bytes of a base64 data URL, or null when it isn't one. */
export function decodeDataUrl(dataUrl: string): { type: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) return null
  let raw: string
  try {
    raw = atob(match[2])
  } catch {
    return null
  }
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return { type: match[1], bytes }
}

/** A base64 data URL for these bytes. Encodes in chunks, so large photos don't overflow the call stack. */
export function encodeDataUrl(type: string, bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${type};base64,${btoa(binary)}`
}

/** SHA-256 hex of raw bytes. */
export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

/**
 * SHA-256 of a data-URL image's raw bytes (not the data-URL string itself).
 * Returns lowercase hex. Link 0's photo hashes and the photo store's
 * content address both use it, so the two always agree.
 */
export async function hashDataUrlImage(dataUrl: string): Promise<string> {
  const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return sha256HexBytes(bytes)
}

/** SHA-256 hex of a string's UTF-8 bytes. */
export async function sha256HexUtf8(text: string): Promise<string> {
  return sha256HexBytes(new TextEncoder().encode(text))
}
