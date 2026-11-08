// Share links (build spec T7 item 2): the exact format, what the JSON
// carries and leaves out, the 16 KB limit on both sides, and the version
// prefix.
import { describe, expect, it } from 'vitest'
import type { ParkingSession, SignatureBundle } from '../types'
import {
  SHARE_BUNDLE_KEYS,
  SHARE_DECODE_ERROR_KEYS,
  SHARE_LINK_MAX_BYTES,
  SHARE_PAYLOAD_KEYS,
  buildSharePayload,
  decodeShareToken,
  encodeShareToken,
  makeShareToken,
  permitAdjustedStandardUntil,
  shareExtrasOf,
  type SharePayload,
} from './share-link'
import en from '../locales/en.json'

const BUNDLE: SignatureBundle = {
  schema: 'parkproof-evidence-v2',
  signed_at: '2026-10-25T02:31:05.000Z',
  algorithm: 'ECDSA_SHA_256',
  key_alias: 'alias/parkproof-evidence-signing',
  canonical_payload: '{"address":"12 King St","schema":"parkproof-evidence-v2"}',
  signature_base64: 'MEUCIQDabc+/def==',
}

function record(over: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    arrived_at: '2026-10-25T02:31:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: 'data:image/jpeg;base64,U0lHTg==',
    car_photo: 'data:image/jpeg;base64,Q0FS',
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: '2026-10-25T04:31:00.000Z',
    confidence: 'high',
    signature: BUNDLE,
    chain_key: 'ab'.repeat(32),
    photos: [{ role: 'sign', sha256: 'cd'.repeat(32), captured_at: '2026-10-25T02:30:00.000Z', source: 'camera_input' }],
    driver_name: 'Sam',
    permit_context: {
      type: 'accessible',
      area: null,
      holder_present: true,
      sign_exception_applies: true,
      standard_until: '2026-10-25T04:31:00.000Z',
      permit_until: null,
      note: 'blue card 1234',
    },
    permit_salt: 'ef'.repeat(16),
    ...over,
  }
}

const NOW = new Date('2026-10-25T03:00:00.000Z')

/** The JSON inside a token, read the way a third party would: base64url, UTF-8, no decompression. */
function jsonOf(token: string): Record<string, unknown> {
  const body = token.slice(2).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(body + '='.repeat((4 - (body.length % 4)) % 4))
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
}

describe('making a share link', () => {
  it('is "1." and the base64url of the JSON, uncompressed', () => {
    const built = makeShareToken(record(), { now: NOW })
    if (!built.ok) throw new Error('expected a token')
    expect(built.token.startsWith('1.')).toBe(true)
    // base64url: no +, / or padding, so it survives a URL fragment untouched.
    expect(built.token.slice(2)).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(jsonOf(built.token).shared_at).toBe(NOW.toISOString())
  })

  it('carries the arrival bundle as four fields and the listed extras, nothing else', () => {
    const built = makeShareToken(record({ ended_at: '2026-10-25T02:55:00.000Z' }), { now: NOW })
    if (!built.ok) throw new Error('expected a token')
    const json = jsonOf(built.token)
    expect(Object.keys(json)).toEqual([...SHARE_PAYLOAD_KEYS])
    expect(Object.keys(json.bundle as object)).toEqual([...SHARE_BUNDLE_KEYS])
    expect(json.bundle).toEqual({
      canonical_payload: BUNDLE.canonical_payload,
      signature_base64: BUNDLE.signature_base64,
      signed_at: BUNDLE.signed_at,
      key_alias: BUNDLE.key_alias,
    })
    expect(json).toMatchObject({
      driver: 'Sam',
      time_zone: 'Australia/Melbourne',
      ended_at: '2026-10-25T02:55:00.000Z',
      rules: '2P Mon-Fri 8am-6pm',
      standard_until: null,
    })
    // No photos, no chain key, no permit details or salt, anywhere in the link.
    const text = JSON.stringify(json)
    for (const secret of ['U0lHTg==', 'Q0FS', 'ab'.repeat(32), 'cd'.repeat(32), 'blue card 1234', 'ef'.repeat(16), 'accessible', 'permit']) {
      expect(text).not.toContain(secret)
    }
  })

  it('names the handover driver instead of the record driver when asked', () => {
    const payload = buildSharePayload(record(), { now: NOW, driver: 'Alex' })
    expect(payload?.driver).toBe('Alex')
    expect(buildSharePayload(record({ driver_name: null }), { now: NOW })?.driver).toBeNull()
  })

  it('shares standard_until only when the park was permit-adjusted', () => {
    // The permit gave more time than the sign's standard limit.
    const adjusted = record({
      expires_at: '2026-10-25T06:31:00.000Z',
      permit_context: { ...record().permit_context!, standard_until: '2026-10-25T15:31:00+11:00', permit_until: '2026-10-25T06:31:00.000Z' },
    })
    expect(permitAdjustedStandardUntil(adjusted)).toBe('2026-10-25T04:31:00.000Z')
    expect(buildSharePayload(adjusted, { now: NOW })?.standard_until).toBe('2026-10-25T04:31:00.000Z')
    // Same limit either way, or no permit, or no standard time: nothing shared.
    expect(permitAdjustedStandardUntil(record())).toBeNull()
    expect(permitAdjustedStandardUntil(record({ permit_context: null }))).toBeNull()
    expect(permitAdjustedStandardUntil(record({ permit_context: { ...record().permit_context!, standard_until: null } }))).toBeNull()
  })

  it('needs a signed arrival: an unsigned record makes no link', () => {
    expect(makeShareToken(record({ signature: undefined }))).toEqual({ ok: false, error: 'unsigned' })
    expect(makeShareToken(record({ signature: { ...BUNDLE, signature_base64: '' } }))).toEqual({ ok: false, error: 'unsigned' })
  })

  it('refuses to make a link over 16 KB', () => {
    const huge = record({ signature: { ...BUNDLE, canonical_payload: 'x'.repeat(13_000) } })
    expect(makeShareToken(huge)).toEqual({ ok: false, error: 'too_large' })
    const fits = record({ signature: { ...BUNDLE, canonical_payload: 'x'.repeat(11_000) } })
    expect(makeShareToken(fits).ok).toBe(true)
  })

  it('leaves the sign reading out of a no-sign record and caps a long one', () => {
    expect(buildSharePayload(record({ no_sign: true, rules: '' }), { now: NOW })?.rules).toBeNull()
    expect(buildSharePayload(record({ rules: 'r'.repeat(900) }), { now: NOW })?.rules).toHaveLength(500)
  })
})

describe('reading a share link', () => {
  const payload = (): SharePayload => buildSharePayload(record(), { now: NOW })!

  it('round-trips', () => {
    const p = payload()
    expect(decodeShareToken(encodeShareToken(p))).toEqual({ ok: true, payload: p })
  })

  it('round-trips text in any script', () => {
    const p = { ...payload(), driver: '王小明 Ελένη ਸਿੰਘ', rules: '2P 8am–6pm ✓' }
    const read = decodeShareToken(encodeShareToken(p))
    expect(read.ok && read.payload.driver).toBe('王小明 Ελένη ਸਿੰਘ')
    expect(read.ok && read.payload.rules).toBe('2P 8am–6pm ✓')
  })

  it('refuses an unknown version prefix with the newer-version message', () => {
    const body = encodeShareToken(payload()).slice(2)
    expect(decodeShareToken(`2.${body}`)).toEqual({ ok: false, error: 'version' })
    expect(decodeShareToken(`10.${body}`)).toEqual({ ok: false, error: 'version' })
    expect(SHARE_DECODE_ERROR_KEYS.version).toBe('share.newerVersion')
    expect(en.share.newerVersion).toBe('This link was made by a newer version of ParkProof')
  })

  it('refuses a token over 16 KB without decoding it', () => {
    const big = `1.${'A'.repeat(SHARE_LINK_MAX_BYTES)}`
    expect(decodeShareToken(big)).toEqual({ ok: false, error: 'too_large' })
    expect(SHARE_DECODE_ERROR_KEYS.too_large).toBe('share.unreadable')
  })

  it('refuses anything that is not a version 1 share link', () => {
    const good = encodeShareToken(payload())
    const cases: unknown[] = [
      '',
      'abc',
      '1.',
      '1.not base64!',
      `1.${good.slice(2, -3)}`,
      `x${good}`,
      null,
      42,
      // Valid base64url, but not JSON / not an object / missing parts.
      `1.${btoa('not json').replace(/=+$/, '')}`,
      `1.${btoa('[1,2]').replace(/=+$/, '')}`,
      encodeShareToken({ ...payload(), shared_at: 'yesterday' }),
      encodeShareToken({ ...payload(), bundle: { ...payload().bundle, signature_base64: '' } }),
    ]
    for (const c of cases) expect(decodeShareToken(c)).toEqual({ ok: false, error: 'malformed' })
  })

  it('shapes the unsigned extras and drops unknown keys', () => {
    const extras = shareExtrasOf({
      driver: `Sam‮\n${'x'.repeat(100)}`,
      time_zone: 'Mars/Olympus',
      ended_at: 'not a time',
      rules: '\u0000 2P ',
      standard_until: '2026-10-25T15:31:00+11:00',
      photo: 'data:image/jpeg;base64,AAAA',
    })
    expect(extras.driver?.startsWith('Sam')).toBe(true)
    expect(extras.driver).not.toMatch(/[‮\n]/)
    expect(extras.driver!.length).toBeLessThanOrEqual(60)
    expect(extras.time_zone).toBeNull()
    expect(extras.ended_at).toBeNull()
    expect(extras.rules).toBe('2P')
    expect(extras.standard_until).toBe('2026-10-25T04:31:00.000Z')
    expect(Object.keys(extras).sort()).toEqual(['driver', 'ended_at', 'rules', 'standard_until', 'time_zone'])
  })
})
