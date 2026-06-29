// Trust-critical Lambda logic: the evidence-signature canonicalization and the
// EventBridge-safety helpers. These were the highest-value untested gap in the
// codebase (see docs/testing.md) — a silent drift in canonicalize() invalidates
// EVERY signature without throwing, because the openssl verifier re-hashes
// `payload.txt` and the bytes must match exactly.
//
// We test the deterministic LOGIC here. The KMS round-trip itself is an AWS
// call (out of unit scope, covered by scripts/smoke-test-auth.mjs); the
// handleSignSession cases below all assert validation that throws BEFORE the
// KMS call, so no AWS mock is needed.
import { describe, it, expect, beforeAll } from 'vitest'
import {
  canonicalize,
  isSafeSessionId,
  toSchedulerAtExpr,
  handleSignSession,
} from './index.js'

describe('canonicalize() — the signer/verifier byte contract', () => {
  it('sorts object keys (so signer and verifier agree regardless of insertion order)', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it('is invariant to input key order — the heart of signature consistency', () => {
    const a = canonicalize({ session_id: 'x', arrived_at: 't', confidence: 'high' })
    const b = canonicalize({ confidence: 'high', arrived_at: 't', session_id: 'x' })
    expect(a).toBe(b)
  })

  it('emits no whitespace', () => {
    const out = canonicalize({ a: 1, nested: { b: 2 }, arr: [1, 2] })
    expect(out).not.toMatch(/\s/)
  })

  it('encodes null as the literal null (the payload builder coerces undefined → null)', () => {
    expect(canonicalize(null)).toBe('null')
    expect(canonicalize({ expires_at: null })).toBe('{"expires_at":null}')
  })

  it('encodes booleans and numbers like JSON', () => {
    expect(canonicalize(true)).toBe('true')
    expect(canonicalize(false)).toBe('false')
    // float trailing-zero stripping is consistent on both sides (both use JS number semantics)
    expect(canonicalize(-37.798)).toBe('-37.798')
    expect(canonicalize(-37.7980)).toBe('-37.798')
  })

  it('escapes strings exactly like JSON.stringify', () => {
    const tricky = 'a"b\n\tc\\d'
    expect(canonicalize(tricky)).toBe(JSON.stringify(tricky))
  })

  it('handles nested objects and arrays with sorted keys throughout', () => {
    expect(
      canonicalize({ location: { lat: -37.8, address: '12 King St' }, items: [1, 'a', true] }),
    ).toBe('{"items":[1,"a",true],"location":{"address":"12 King St","lat":-37.8}}')
  })

  it('GOLDEN VECTOR — a representative signed payload pins the exact canonical bytes', () => {
    // If this string ever has to change, that is a signature-format break:
    // re-verify the openssl walkthrough and bump the signing schema version.
    const payload = {
      schema: 'parkproof-sig-v1',
      session_id: 'sess_123',
      arrived_at: '2026-05-20T14:30:00+10:00',
      expires_at: null,
      confidence: 'high',
      no_sign: false,
      sign_photo_sha256: 'a'.repeat(64),
    }
    expect(canonicalize(payload)).toBe(
      '{"arrived_at":"2026-05-20T14:30:00+10:00","confidence":"high","expires_at":null,' +
        '"no_sign":false,"schema":"parkproof-sig-v1","session_id":"sess_123",' +
        '"sign_photo_sha256":"' + 'a'.repeat(64) + '"}',
    )
  })

  it('throws on an unsupported (undefined) value — guards against an accidental undefined field', () => {
    expect(() => canonicalize(undefined)).toThrow(/unsupported type/)
  })
})

describe('handleSignSession() — validation that must throw before any KMS call', () => {
  beforeAll(() => {
    process.env.KMS_KEY_ID = 'test-key-id'
  })
  const call = (body) => handleSignSession({ body: JSON.stringify(body) })
  const base = { session_id: 's1', arrived_at: '2026-05-20T10:00:00Z', rules: '2P', confidence: 'high' }

  it('rejects a non-64-char photo hash', async () => {
    await expect(call({ ...base, no_sign: false, sign_photo_sha256: 'tooshort' })).rejects.toThrow(
      /sign_photo_sha256 must be 64-char hex/,
    )
  })

  it('requires a sign-photo hash for a translated (non-no_sign) session', async () => {
    await expect(call({ ...base, no_sign: false, sign_photo_sha256: null })).rejects.toThrow(
      /required for translated sessions/,
    )
  })

  it('requires session_id', async () => {
    await expect(call({ ...base, session_id: '', no_sign: true })).rejects.toThrow(/session_id required/)
  })

  it('rejects a bad car-photo hash even on a no_sign session', async () => {
    await expect(call({ ...base, no_sign: true, sign_photo_sha256: null, car_photo_sha256: 'xyz' })).rejects.toThrow(
      /car_photo_sha256 must be 64-char hex/,
    )
  })
})

describe('isSafeSessionId() — EventBridge schedule-name boundary', () => {
  it('accepts the allowed charset up to 47 chars', () => {
    expect(isSafeSessionId('abc-123_4.5')).toBe(true)
    expect(isSafeSessionId('a')).toBe(true)
    expect(isSafeSessionId('a'.repeat(47))).toBe(true)
  })
  it('rejects over-length, empty, bad chars, and non-strings', () => {
    expect(isSafeSessionId('a'.repeat(48))).toBe(false) // would overflow the 64-char name
    expect(isSafeSessionId('')).toBe(false)
    expect(isSafeSessionId('has space')).toBe(false)
    expect(isSafeSessionId('slash/here')).toBe(false)
    expect(isSafeSessionId('semi;colon')).toBe(false)
    expect(isSafeSessionId(123)).toBe(false)
    expect(isSafeSessionId(null)).toBe(false)
    expect(isSafeSessionId(undefined)).toBe(false)
  })
})

describe('toSchedulerAtExpr() — UTC at(...) with no offset or Z', () => {
  it('converts an offset time to UTC and formats without a trailing Z', () => {
    expect(toSchedulerAtExpr('2026-05-20T14:30:00+10:00')).toBe('at(2026-05-20T04:30:00)')
  })
  it('strips the Z from an already-UTC instant', () => {
    expect(toSchedulerAtExpr('2026-05-20T04:30:00Z')).toBe('at(2026-05-20T04:30:00)')
  })
  it('never emits an offset or Z (a stray one makes every push fail to schedule)', () => {
    expect(toSchedulerAtExpr('2026-12-31T23:59:59-05:00')).toMatch(
      /^at\(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\)$/,
    )
  })
  it('throws on an invalid date', () => {
    expect(() => toSchedulerAtExpr('not-a-date')).toThrow(/invalid fire_at/)
  })
})
