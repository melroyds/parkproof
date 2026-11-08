// @vitest-environment node
//
// What the record screen shows about the chain (spec T1a): the stored rows
// of the chain panel (order, duplicates, states, signing times from the
// signed payload), the departure row (signed values from the signed
// departure, the phone tap time otherwise), the check summary, and that
// every key the maps point at exists in en.json.
import { describe, expect, it } from 'vitest'
import type { ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import { PHOTO_ROLES } from '../../lambda/addendum-schema.js'
import en from '../locales/en.json'
import {
  CHAIN_KIND_KEYS,
  PHOTO_ROLE_KEYS,
  STORED_STATE_KEYS,
  chainCoversKey,
  chainFingerprint,
  chainRows,
  chainSummary,
  checkSummary,
  departureSummary,
  signedTimeOf,
} from './chain-view'
import { DEPARTURE_CATCH_UP_GRACE_MS, DEV_KEY_ALIAS } from './evidence-chain'

const ENDED = '2026-10-25T02:55:00.000Z'

function bundle(payload: Record<string, unknown>, overrides: Partial<SignatureBundle> = {}): SignatureBundle {
  return {
    schema: String(payload.schema ?? 'parkproof-addendum-v1'),
    signed_at: String(payload.signed_at ?? '2026-10-25T00:00:00.000Z'),
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify(payload),
    signature_base64: `sig-${Math.random()}`,
    ...overrides,
  }
}

function addendum(seq: number, kind: SignedAddendum['kind'], state: 'signed' | 'pending' | 'rejected' | 'dev', extra: Partial<SignedAddendum> = {}): SignedAddendum {
  const id = extra.id ?? `id-${kind}-${seq}-${state}`
  const data = extra.data ?? {}
  const base: SignedAddendum = { id, seq, kind, captured_at: '2026-10-25T01:00:00.000Z', data, ...extra }
  if (state === 'signed' || state === 'dev') {
    base.bundle = bundle(
      { schema: 'parkproof-addendum-v1', addendum_id: id, kind, seq, signed_at: `2026-10-25T01:0${seq}:00.000Z`, data },
      state === 'dev' ? { key_alias: DEV_KEY_ALIAS } : {},
    )
  }
  if (state === 'rejected') base.rejected = { code: 'ERR_BAD_STRING', at: '2026-10-25T01:00:00.000Z' }
  return base
}

function session(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: '2026-10-25T00:00:00.000Z',
    location: null,
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    ...overrides,
  }
}

const LINK0 = bundle({ schema: 'parkproof-evidence-v2', signed_at: '2026-10-25T00:00:02.000Z' }, { schema: 'parkproof-evidence-v2' })
const LINK0_V1 = bundle({ schema: 'parkproof-evidence-v1', signed_at: '2026-10-25T00:00:02.000Z' }, { schema: 'parkproof-evidence-v1' })
const CHAIN_KEY = 'ab'.repeat(32)

describe('chainRows', () => {
  it('link 0 first, then addenda by seq; signing times come from the signed payload', () => {
    const rows = chainRows(
      session({
        signature: LINK0,
        addenda: [addendum(2, 'departure', 'pending'), addendum(1, 'arrival_context', 'signed')],
      }),
      null,
    )
    expect(rows.map((r) => `${r.kind}#${r.seq}:${r.state}`)).toEqual([
      'arrival#0:signed',
      'arrival_context#1:signed',
      'departure#2:pending',
    ])
    expect(rows[0].signed_at).toBe('2026-10-25T00:00:02.000Z')
    expect(rows[1].signed_at).toBe('2026-10-25T01:01:00.000Z')
    expect(rows[2].signed_at).toBeNull()
    expect(new Set(rows.map((r) => r.key)).size).toBe(3)
  })

  it('an unsigned link 0 is pending, or refused when the server said no', () => {
    expect(chainRows(session(), null)[0]).toMatchObject({ kind: 'arrival', state: 'pending', signed_at: null })
    expect(chainRows(session(), 'ERR_BAD_VALUE')[0].state).toBe('rejected')
  })

  it('dev-key bundles are marked as such, never as signed', () => {
    const rows = chainRows(
      session({ signature: { ...LINK0, key_alias: DEV_KEY_ALIAS }, addenda: [addendum(1, 'arrival_context', 'dev')] }),
      null,
    )
    expect(rows.map((r) => r.state)).toEqual(['dev_key', 'dev_key'])
  })

  it('at one seq: signed before refused before pending; a stale pending copy of a signed link is dropped', () => {
    const signed = addendum(1, 'condition', 'signed', { id: '11111111-1111-4111-8111-111111111111' })
    const staleCopy = { ...signed, bundle: undefined }
    const rows = chainRows(
      session({
        signature: LINK0,
        addenda: [
          addendum(2, 'handover', 'pending', { id: '22222222-2222-4222-8222-222222222222' }),
          addendum(2, 'compliance', 'rejected', { id: '33333333-3333-4333-8333-333333333333' }),
          staleCopy,
          signed,
          { ...signed }, // the same signed link stored twice
        ],
      }),
      null,
    )
    expect(rows.map((r) => `${r.kind}#${r.seq}:${r.state}`)).toEqual([
      'arrival#0:signed',
      'condition#1:signed',
      'compliance#2:rejected',
      'handover#2:pending',
    ])
  })

  it('two signed parts at one seq are marked as a fork before any check; refused and pending ones are not', () => {
    const rows = chainRows(
      session({
        signature: LINK0,
        addenda: [
          addendum(1, 'arrival_context', 'signed'),
          addendum(2, 'departure', 'signed', { id: '44444444-4444-4444-8444-444444444444' }),
          addendum(2, 'departure', 'dev', { id: '55555555-5555-4555-8555-555555555555' }),
          addendum(2, 'condition', 'pending', { id: '66666666-6666-4666-8666-666666666666' }),
          addendum(3, 'handover', 'signed'),
          addendum(3, 'compliance', 'rejected'),
        ],
      }),
      null,
    )
    expect(rows.map((r) => `${r.kind}#${r.seq}:${r.state}:${r.forked ? 'fork' : '-'}`)).toEqual([
      'arrival#0:signed:-',
      'arrival_context#1:signed:-',
      'departure#2:signed:fork',
      'departure#2:dev_key:fork',
      'condition#2:pending:-',
      'handover#3:signed:-',
      'compliance#3:rejected:-',
    ])
  })

  it('the collapsed summary counts signed parts, or says none are signed yet', () => {
    expect(chainSummary(chainRows(session(), null))).toEqual({ key: 'verifier.link.pending' })
    const rows = chainRows(
      session({
        signature: { ...LINK0, key_alias: DEV_KEY_ALIAS },
        addenda: [
          addendum(1, 'arrival_context', 'signed'),
          addendum(2, 'departure', 'pending'),
          addendum(3, 'condition', 'rejected'),
        ],
      }),
      null,
    )
    expect(chainSummary(rows)).toEqual({ key: 'chain.summary', count: 2 })
  })

  it("a shared copy shows the sender's link 0 only", () => {
    const rows = chainRows(
      session({
        addenda: [addendum(1, 'arrival_context', 'signed')],
        shared_from: { original_session_id: 'x', received_at: ENDED, shared_at: null, arrival_bundle: LINK0, snapshot: {} },
      }),
      'ERR_IGNORED',
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'arrival', state: 'signed' })
  })

  it('signedTimeOf falls back to the envelope when the payload has none', () => {
    expect(signedTimeOf(bundle({ signed_at: 'A' }))).toBe('A')
    expect(signedTimeOf({ ...LINK0, canonical_payload: 'not json', signed_at: 'B' })).toBe('B')
  })
})

describe('chainFingerprint', () => {
  it('changes when a link is added, signed, refused or renumbered', () => {
    const pending = addendum(1, 'departure', 'pending')
    const base = session({ signature: LINK0, addenda: [pending] })
    const fp = chainFingerprint(base)
    expect(chainFingerprint({ ...base })).toBe(fp)
    expect(chainFingerprint({ ...base, addenda: [{ ...pending, bundle: LINK0 }] })).not.toBe(fp)
    expect(chainFingerprint({ ...base, addenda: [{ ...pending, rejected: { code: 'X', at: ENDED } }] })).not.toBe(fp)
    expect(chainFingerprint({ ...base, addenda: [{ ...pending, seq: 2 }] })).not.toBe(fp)
    expect(chainFingerprint({ ...base, addenda: [pending, addendum(2, 'condition', 'pending')] })).not.toBe(fp)
    expect(chainFingerprint({ ...base, signature: undefined })).not.toBe(fp)
  })
})

describe('departureSummary', () => {
  const data = (overrides: Record<string, unknown> = {}) => ({
    ended_at: ENDED,
    location: { lat: -37.81, lng: 144.96, accuracy_meters: 9, source: 'gps' },
    distance_from_arrival_m: 230,
    return_photos: [],
    ...overrides,
  })

  it('is null until the record has ended', () => {
    expect(departureSummary(session())).toBeNull()
  })

  it('without a departure addendum: the tap time and the field distance and accuracy, not signed yet', () => {
    expect(
      departureSummary(
        session({
          ended_at: ENDED,
          departure: {
            ended_at: ENDED,
            location: { lat: -37.81, lng: 144.96, accuracy_meters: 14, source: 'gps' },
            distance_from_arrival_m: 40,
          },
        }),
      ),
    ).toEqual({
      tapped_at: ENDED,
      signing: { state: 'pending' },
      distance_from_arrival_m: 40,
      location_accuracy_m: 14,
      location: { lat: -37.81, lng: 144.96, accuracy_meters: 14 },
    })
    expect(departureSummary(session({ ended_at: ENDED }))).toEqual({
      tapped_at: ENDED,
      signing: { state: 'pending' },
      distance_from_arrival_m: null,
      location_accuracy_m: null,
      location: null,
    })
  })

  describe("no departure part, and none is coming: 'none'", () => {
    const endedMs = Date.parse(ENDED)
    const afterGrace = endedMs + DEPARTURE_CATCH_UP_GRACE_MS + 1

    it('a v2 chain whose key is not on this device never gets one here', () => {
      const s = session({ ended_at: ENDED, signature: LINK0 })
      expect(departureSummary(s, { now: endedMs + 1_000, endedHere: true })!.signing).toEqual({ state: 'none' })
      expect(departureSummary(s)!.signing).toEqual({ state: 'none' })
    })

    it('right after the tap it is still pending; after the grace period the catch-up decides', () => {
      const s = session({ ended_at: ENDED, signature: LINK0, chain_key: CHAIN_KEY })
      expect(departureSummary(s, { now: endedMs + 5_000, endedHere: true })!.signing).toEqual({ state: 'pending' })
      // Ended here and the catch-up is due: it will add the departure.
      expect(departureSummary(s, { now: afterGrace, endedHere: true })!.signing).toEqual({ state: 'pending' })
      // An old record ended before the ended-here mark existed, or one ended on another device.
      expect(departureSummary(s, { now: afterGrace, endedHere: false })!.signing).toEqual({ state: 'none' })
      expect(
        departureSummary(session({ ended_at: ENDED, signature: LINK0_V1 }), { now: afterGrace })!.signing,
      ).toEqual({ state: 'none' })
      // Without a clock the grace rule is skipped.
      expect(departureSummary(s, { endedHere: false })!.signing).toEqual({ state: 'pending' })
    })

    it('a stored departure part is never "none", whatever the clock', () => {
      const s = session({
        ended_at: ENDED,
        signature: LINK0,
        addenda: [addendum(2, 'departure', 'pending', { data: data() })],
      })
      expect(departureSummary(s, { now: afterGrace, endedHere: false })!.signing).toEqual({ state: 'pending' })
    })
  })

  it('a signed departure: the signed tap time, distance and ParkProof signing time', () => {
    const signedData = data({ ended_at: '2026-10-25T02:54:00.000Z', distance_from_arrival_m: 512 })
    const dep = addendum(2, 'departure', 'signed', { data: signedData })
    // The stored copy claims something else: the signed values win.
    const s = session({
      ended_at: ENDED,
      departure: { ended_at: ENDED, location: null, distance_from_arrival_m: 3 },
      addenda: [{ ...dep, data: data({ distance_from_arrival_m: 3 }) }],
    })
    expect(departureSummary(s)).toEqual({
      tapped_at: '2026-10-25T02:54:00.000Z',
      signing: { state: 'signed', signed_at: '2026-10-25T01:02:00.000Z' },
      distance_from_arrival_m: 512,
      location_accuracy_m: 9,
      location: { lat: -37.81, lng: 144.96, accuracy_meters: 9 },
    })
  })

  it('a dev-key departure, a pending one and a refused one', () => {
    const dev = session({ ended_at: ENDED, addenda: [addendum(2, 'departure', 'dev', { data: data() })] })
    expect(departureSummary(dev)!.signing).toEqual({ state: 'dev_key', signed_at: '2026-10-25T01:02:00.000Z' })

    const pending = session({ ended_at: ENDED, addenda: [addendum(2, 'departure', 'pending', { data: data({ distance_from_arrival_m: 75 }) })] })
    expect(departureSummary(pending)).toEqual({
      tapped_at: ENDED,
      signing: { state: 'pending' },
      distance_from_arrival_m: 75,
      location_accuracy_m: 9,
      location: { lat: -37.81, lng: 144.96, accuracy_meters: 9 },
    })

    const refused = session({ ended_at: ENDED, addenda: [addendum(2, 'departure', 'rejected', { data: data() })] })
    expect(departureSummary(refused)!.signing).toEqual({ state: 'rejected' })
  })

  it('ignores a nonsense distance', () => {
    const s = session({ ended_at: ENDED, addenda: [addendum(2, 'departure', 'pending', { data: data({ distance_from_arrival_m: -4 }) })] })
    expect(departureSummary(s)!.distance_from_arrival_m).toBeNull()
  })

  it('gives the signed departure location, and none for a missing or unreadable one', () => {
    const none = session({ ended_at: ENDED, addenda: [addendum(2, 'departure', 'signed', { data: data({ location: null }) })] })
    expect(departureSummary(none)!.location).toBeNull()
    const garbled = session({
      ended_at: ENDED,
      addenda: [addendum(2, 'departure', 'pending', { data: data({ location: { lat: 'x', lng: 144.96, accuracy_meters: 9, source: 'gps' } }) })],
    })
    expect(departureSummary(garbled)!.location).toBeNull()
    const unknownAccuracy = session({
      ended_at: ENDED,
      addenda: [addendum(2, 'departure', 'pending', { data: data({ location: { lat: -37.8, lng: 144.9, accuracy_meters: null, source: 'gps' } }) })],
    })
    expect(departureSummary(unknownAccuracy)!.location).toEqual({ lat: -37.8, lng: 144.9, accuracy_meters: null })
  })
})

describe('copy keys', () => {
  const has = (key: string) =>
    key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), en)

  it('every kind, covers, state and photo role key exists in en.json', () => {
    for (const key of Object.values(CHAIN_KIND_KEYS)) expect(typeof has(key), key).toBe('string')
    for (const kind of Object.keys(CHAIN_KIND_KEYS) as Array<keyof typeof CHAIN_KIND_KEYS>) {
      expect(typeof has(chainCoversKey(kind, {})), kind).toBe('string')
    }
    expect(chainCoversKey('arrival', { no_sign: true })).toBe('chain.covers.arrivalNoSign')
    for (const key of Object.values(STORED_STATE_KEYS)) expect(typeof has(key), key).toBe('string')
    for (const role of PHOTO_ROLES) {
      const key = PHOTO_ROLE_KEYS[role as keyof typeof PHOTO_ROLE_KEYS]
      expect(typeof has(key), role).toBe('string')
    }
  })

  it('the check summary', () => {
    const counts = { valid: 3, invalid: 0, pending: 1, rejected: 0, dev_key: 0 }
    expect(checkSummary({ overall: 'valid', counts })).toEqual({ key: 'chain.checkValid', count: 3 })
    const photo = { role: 'car' as const, sha256: 'a'.repeat(64), local_sha256: null, signer: 'parkproof' as const, link_indexes: [0] }
    expect(checkSummary({ overall: 'valid', counts, photos: [{ ...photo, status: 'matches' }] })).toEqual({
      key: 'chain.checkValid',
      count: 3,
    })
    // A signed photo whose bytes were never compared: no "haven't changed".
    expect(checkSummary({ overall: 'valid', counts, photos: [{ ...photo, status: 'not_on_device' }] })).toEqual({
      key: 'chain.checkValidPhotosUnchecked',
      count: 3,
    })
    expect(checkSummary({ overall: 'problem', counts })).toEqual({ key: 'chain.checkProblem' })
    expect(checkSummary({ overall: 'dev_key', counts })).toEqual({ key: 'chain.checkDevKey' })
    expect(checkSummary({ overall: 'unsigned', counts })).toEqual({ key: 'chain.checkUnsigned' })
    for (const key of [
      'chain.checkValid_one',
      'chain.checkValid_other',
      'chain.checkValidPhotosUnchecked_one',
      'chain.checkValidPhotosUnchecked_other',
      'chain.checkProblem',
      'chain.checkDevKey',
      'chain.checkUnsigned',
      'chain.checkChanged',
      'chain.summary_one',
      'chain.summary_other',
      'departure.notSigned',
      'session.ended',
    ]) {
      expect(typeof has(key), key).toBe('string')
    }
  })

  it('the success copy is the spec sentence', () => {
    expect(en.chain.checkValid_other).toBe(
      "All {{count}} signatures are valid. The signed details haven't changed since ParkProof signed them. That doesn't show they're true.",
    )
    // Plurals carry {{count}} in both forms.
    expect(en.chain.checkValid_one).toContain('{{count}}')
    expect(en.chain.signedAt).toBe('Signed by ParkProof at {{time}}.')
    expect(en.departure.tapped).toBe("You tapped I've left at {{time}} (phone clock).")
    expect(en.departure.far).toBe(
      "Your phone was {{distance}} from where you parked when you tapped I've left. The record shows when you tapped, not when the car moved.",
    )
  })
})
