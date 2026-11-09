// Test-only: records signed by the REAL Lambda handler (via createTestSigner)
// and the share links made from them, for the T7 share and receive tests.
import type { ParkingSession, SignatureBundle } from '../../types'
import { EVIDENCE_V2_SCHEMA } from '../../../lambda/addendum-schema.js'
import { sha256HexUtf8 } from '../hash'
import type { TestSigner } from './test-signer'

export const SIGN_SHA = 'aa'.repeat(32)

/** Sign a link-0 body with the test signer, as /api/sign-session would. */
export async function signArrival(signer: TestSigner, body: Record<string, unknown>): Promise<SignatureBundle> {
  const res = await signer.fetch('/api/sign-session', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`signing failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as SignatureBundle
}

/**
 * The driver's own record with a signed v2 link 0 (arrived 30 min ago,
 * limit in 90 min, at 12 King St, Melbourne), not saved anywhere.
 */
export async function signedOwnRecord(
  signer: TestSigner,
  over: Partial<ParkingSession> = {},
  now: number = Date.now(),
): Promise<ParkingSession> {
  const session: ParkingSession = {
    id: crypto.randomUUID(),
    arrived_at: new Date(now - 30 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne', source: 'gps', accuracy_meters: 9 },
    sign_photo: null,
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: new Date(now + 90 * 60_000).toISOString(),
    confidence: 'high',
    chain_key: 'c0'.repeat(32),
    photos: [{ role: 'sign', sha256: SIGN_SHA, captured_at: new Date(now - 31 * 60_000).toISOString(), source: 'camera_input' }],
    driver_name: 'Sam',
    ...over,
  }
  session.signature = await signArrival(signer, {
    schema: EVIDENCE_V2_SCHEMA,
    session_id: session.id,
    arrived_at: session.arrived_at,
    expires_at: session.expires_at,
    location: session.location,
    rules: session.rules,
    chosen_label: session.chosen_label ?? null,
    confidence: session.confidence,
    no_sign: !!session.no_sign,
    sign_photo_sha256: session.no_sign ? null : SIGN_SHA,
    ambient_photo_sha256: null,
    car_photo_sha256: null,
    chain_key_sha256: await sha256HexUtf8(session.chain_key as string),
  })
  return session
}
