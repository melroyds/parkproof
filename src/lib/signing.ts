import type { ParkingSession, SignatureBundle } from '../types'

const SIGN_TRANSLATE_PATH = '/sign-translate'

function signSessionUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined
  if (apiUrl) {
    if (apiUrl.endsWith(SIGN_TRANSLATE_PATH)) {
      return apiUrl.slice(0, -SIGN_TRANSLATE_PATH.length) + '/sign-session'
    }
    return apiUrl.replace(/\/[^/]*$/, '/sign-session')
  }
  return '/api/sign-session'
}

/**
 * SHA-256 of a data-URL image's raw bytes (not the data-URL string itself).
 * Returns lowercase hex.
 */
async function hashDataUrlImage(dataUrl: string): Promise<string> {
  const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Compute photo hashes locally, ship the metadata + hashes to the Lambda,
 * receive a KMS-backed signature. Resolves to null on any failure — this is
 * fire-and-forget evidence-grade enhancement, not a core flow.
 */
export async function signSession(session: ParkingSession): Promise<SignatureBundle | null> {
  try {
    const sign_photo_sha256 = await hashDataUrlImage(session.sign_photo)
    const car_photo_sha256 = session.car_photo
      ? await hashDataUrlImage(session.car_photo)
      : null

    const body = {
      session_id: session.id,
      arrived_at: session.arrived_at,
      expires_at: session.expires_at,
      location: session.location,
      rules: session.rules,
      chosen_label: session.chosen_label ?? null,
      confidence: session.confidence,
      sign_photo_sha256,
      car_photo_sha256,
    }

    const resp = await fetch(signSessionUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      console.warn('signSession failed:', resp.status, await resp.text())
      return null
    }
    return (await resp.json()) as SignatureBundle
  } catch (err) {
    console.warn('signSession error:', err)
    return null
  }
}
