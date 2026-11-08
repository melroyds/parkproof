// @vitest-environment happy-dom
//
// Handing the car over (build spec T7 item 5), the data side: which
// records can take a handover, who is driving now, the handover data as
// the schema signs it, and queueing it as a real signed part (the REAL
// Lambda handler signs with a local test key). The record stays active.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParkingSession, SignatureBundle, SignedAddendum } from '../types'

vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

import { normalizeAddendumData } from '../../lambda/addendum-schema.js'
import { MAX_ADDENDA } from './evidence-chain'
import { canHandOver, currentDriver, handoverData, handoverParts, queueHandover } from './handover'
import { getSession, saveSession } from './storage'
import { resetSigningQueueForTests, whenSigningIdle } from './signing'
import { createTestSigner, type TestSigner } from './test-support/test-signer'
import { signedOwnRecord } from './test-support/share-fixtures'

const AT = '2026-10-25T02:30:00.000Z'

function bundle(payload: Record<string, unknown>, overrides: Partial<SignatureBundle> = {}): SignatureBundle {
  return {
    schema: String(payload.schema),
    signed_at: String(payload.signed_at),
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify(payload),
    signature_base64: 'MEUCIQ',
    ...overrides,
  }
}

function handover(
  id: string,
  data: { from_driver?: string | null; to_driver: string; handed_over_at: string },
  state: 'signed' | 'pending' | 'rejected' | 'dev' = 'signed',
  seq = 2,
  signedData?: Record<string, unknown>,
): SignedAddendum {
  const stored = { from_driver: data.from_driver ?? null, to_driver: data.to_driver, handed_over_at: data.handed_over_at, location: null }
  const a: SignedAddendum = { id, seq, kind: 'handover', captured_at: data.handed_over_at, data: stored }
  if (state === 'signed' || state === 'dev') {
    a.bundle = bundle(
      {
        schema: 'parkproof-addendum-v1',
        addendum_id: id,
        kind: 'handover',
        seq,
        signed_at: new Date(Date.parse(data.handed_over_at) + 20_000).toISOString(),
        data: signedData ?? stored,
      },
      state === 'dev' ? { key_alias: 'dev-ephemeral' } : {},
    )
  }
  if (state === 'rejected') a.rejected = { code: 'ERR_FUTURE_TIME', at: data.handed_over_at }
  return a
}

function arrivalContext(driver: string | null, signed: boolean): SignedAddendum {
  const data = { driver_name: driver }
  return {
    id: 'ctx-1',
    seq: 1,
    kind: 'arrival_context',
    captured_at: '2026-10-25T01:00:00.000Z',
    data,
    ...(signed
      ? { bundle: bundle({ schema: 'parkproof-addendum-v1', kind: 'arrival_context', seq: 1, signed_at: '2026-10-25T01:00:05.000Z', data }) }
      : {}),
  }
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-hand',
    arrived_at: '2026-10-25T01:00:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: '2026-10-25T03:00:00.000Z',
    confidence: 'high',
    chain_key: 'c0'.repeat(32),
    ...overrides,
  }
}

describe('handoverParts', () => {
  it('reads a signed handover from the signed payload, not the stored copy', () => {
    const signed = handover('h-1', { from_driver: 'Sam', to_driver: 'Alex', handed_over_at: AT }, 'signed', 2, {
      from_driver: 'Sam',
      to_driver: 'Alexandra',
      handed_over_at: AT,
      location: null,
    })
    expect(handoverParts(record({ addenda: [signed] }))).toEqual([
      {
        addendum_id: 'h-1',
        from_driver: 'Sam',
        to_driver: 'Alexandra',
        handed_over_at: AT,
        state: 'signed',
        signed_at: '2026-10-25T02:30:20.000Z',
      },
    ])
  })

  it('keeps one entry per handover (signed over waiting over refused), oldest first, with every state', () => {
    const later = '2026-10-25T02:40:00.000Z'
    const parts = handoverParts(
      record({
        addenda: [
          handover('h-2', { to_driver: 'Kim', handed_over_at: later }, 'pending', 3),
          handover('h-1', { to_driver: 'Alex', handed_over_at: AT }, 'pending', 2),
          handover('h-1', { to_driver: 'Alex', handed_over_at: AT }, 'signed', 2),
          handover('h-3', { to_driver: 'Pat', handed_over_at: '2026-10-25T02:50:00.000Z' }, 'rejected', 4),
          handover('h-4', { to_driver: 'Jo', handed_over_at: '2026-10-25T02:55:00.000Z' }, 'dev', 5),
        ],
      }),
    )
    expect(parts.map((p) => `${p.addendum_id}:${p.to_driver}:${p.state}`)).toEqual([
      'h-1:Alex:signed',
      'h-2:Kim:pending',
      'h-3:Pat:rejected',
      'h-4:Jo:dev_key',
    ])
    expect(parts[1].signed_at).toBeNull()
    expect(parts[3].signed_at).toBe('2026-10-25T02:55:20.000Z')
  })

  it('has none on a shared copy, someone else\'s record', () => {
    const copy = record({
      addenda: [handover('h-1', { to_driver: 'Alex', handed_over_at: AT })],
      shared_from: { original_session_id: 'x', received_at: AT, shared_at: null, arrival_bundle: null, snapshot: {} },
    })
    expect(handoverParts(copy)).toEqual([])
  })
})

describe('currentDriver', () => {
  it('is the latest handover that wasn\'t refused, else the driver entered at parking', () => {
    expect(currentDriver(record({ driver_name: 'Sam' }))).toBe('Sam')
    expect(currentDriver(record({ driver_name: 'Sam', addenda: [arrivalContext('Jo', true)] }))).toBe('Jo')
    expect(currentDriver(record({ driver_name: null }))).toBeNull()
    const withHandovers = record({
      driver_name: 'Sam',
      addenda: [
        handover('h-1', { to_driver: 'Alex', handed_over_at: AT }, 'signed', 2),
        handover('h-2', { to_driver: 'Kim', handed_over_at: '2026-10-25T02:40:00.000Z' }, 'pending', 3),
        handover('h-3', { to_driver: 'Pat', handed_over_at: '2026-10-25T02:50:00.000Z' }, 'rejected', 4),
      ],
    })
    expect(currentDriver(withHandovers)).toBe('Kim')
  })
})

describe('canHandOver', () => {
  // The record() fixture was logged at 01:00 UTC with a limit at 03:00 UTC.
  const NOW = Date.parse(AT)
  const HOUR = 60 * 60 * 1000

  it("only on an active record of the driver's own whose chain this device can extend, with room left", () => {
    expect(canHandOver(record(), NOW)).toBe(true)
    expect(canHandOver(record({ ended_at: AT }), NOW)).toBe(false)
    expect(
      canHandOver(
        record({ shared_from: { original_session_id: 'x', received_at: AT, shared_at: null, arrival_bundle: null, snapshot: {} } }),
        NOW,
      ),
    ).toBe(false)
    // A v2 chain whose key isn't on this device can't take another part.
    const v2 = bundle({ schema: 'parkproof-evidence-v2', session_id: 'rec-hand', signed_at: '2026-10-25T01:00:04.000Z' })
    expect(canHandOver(record({ signature: v2, chain_key: undefined }), NOW)).toBe(false)
  })

  it('follows the home screen: lapsed under 12 hours yes, longer ago no, an open-ended no-sign park yes', () => {
    const expiry = Date.parse('2026-10-25T03:00:00.000Z')
    // Lapsed but still on home (its card asks "I've left").
    expect(canHandOver(record(), expiry + 11 * HOUR)).toBe(true)
    // Off home: never ended, but its limit passed 12 hours or more ago.
    expect(canHandOver(record(), expiry + 12 * HOUR)).toBe(false)
    expect(canHandOver(record(), expiry + 3 * 24 * HOUR)).toBe(false)
    // A no-sign record with no limit stays active until I've left.
    expect(canHandOver(record({ no_sign: true, expires_at: null }), expiry + 3 * 24 * HOUR)).toBe(true)
    // A record with no limit that isn't a no-sign park is never on home.
    expect(canHandOver(record({ expires_at: null }), NOW)).toBe(false)
  })

  it('leaves room for the departure part, unless the departure is already there', () => {
    const fill = (n: number, withDeparture = false): SignedAddendum[] =>
      Array.from({ length: n }, (_, i) =>
        withDeparture && i === 0
          ? { id: `d-${i}`, seq: i + 1, kind: 'departure' as const, captured_at: AT, data: {} }
          : handover(`h-${i}`, { to_driver: 'Alex', handed_over_at: AT }, 'pending', i + 1),
      )
    expect(canHandOver(record({ addenda: fill(MAX_ADDENDA - 2) }), NOW)).toBe(true)
    expect(canHandOver(record({ addenda: fill(MAX_ADDENDA - 1) }), NOW)).toBe(false)
    // With the departure part already queued, the last slot can take a handover.
    expect(canHandOver(record({ addenda: fill(MAX_ADDENDA - 1, true) }), NOW)).toBe(true)
    expect(canHandOver(record({ addenda: fill(MAX_ADDENDA, true) }), NOW)).toBe(false)
  })
})

describe('handoverData', () => {
  const NOW = Date.parse('2026-10-25T02:30:00.000Z')

  it('names the current driver as from_driver, the phone time, and no location; it passes the schema', () => {
    const data = handoverData(record({ driver_name: 'Sam' }), '  Alex  ', NOW)
    expect(data).toEqual({ from_driver: 'Sam', to_driver: 'Alex', handed_over_at: '2026-10-25T02:30:00.000Z', location: null })
    expect(normalizeAddendumData('handover', data)).toEqual(data)
  })

  it('fits the name to the signed field and refuses an empty one', () => {
    const data = handoverData(record(), `Al‮ex${'y'.repeat(80)}`, NOW)
    expect(data!.to_driver).not.toMatch(/‮/)
    expect(data!.to_driver.length).toBe(60)
    expect(data!.from_driver).toBeNull()
    expect(() => normalizeAddendumData('handover', data)).not.toThrow()
    expect(handoverData(record(), '   ', NOW)).toBeNull()
  })
})

describe('queueHandover (signed by the real Lambda handler)', () => {
  let signer: TestSigner

  beforeAll(async () => {
    signer = await createTestSigner()
  })
  beforeEach(() => {
    localStorage.clear()
    resetSigningQueueForTests()
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    vi.stubGlobal('fetch', signer.fetch)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(async () => {
    await whenSigningIdle()
    vi.unstubAllGlobals()
  })

  it('queues a handover part that ParkProof signs, and the record stays active', async () => {
    const own = await signedOwnRecord(signer)
    saveSession(own)
    const first = queueHandover(own.id, 'Alex')
    expect(first?.kind).toBe('handover')
    await whenSigningIdle(own.id)
    const second = queueHandover(own.id, 'Kim')
    await whenSigningIdle(own.id)

    const stored = getSession(own.id)!
    expect(stored.ended_at).toBeUndefined()
    const parts = handoverParts(stored)
    expect(parts.map((p) => [p.from_driver, p.to_driver, p.state])).toEqual([
      ['Sam', 'Alex', 'signed'],
      ['Alex', 'Kim', 'signed'],
    ])
    // What was signed is what was stored, and the chain runs link 1, 2 (no arrival_context was queued here).
    const signedParts = (stored.addenda ?? []).filter((a) => a.kind === 'handover')
    for (const a of signedParts) {
      const payload = JSON.parse(a.bundle!.canonical_payload) as Record<string, unknown>
      expect(payload.kind).toBe('handover')
      expect(payload.data).toEqual(a.data)
      expect(payload.session_id).toBe(own.id)
    }
    expect(signedParts.map((a) => a.seq)).toEqual([first!.seq, second!.seq])
    expect(second!.seq).toBe(first!.seq + 1)
    const sent = signer.calls.filter((c) => c.kind === 'handover')
    expect(sent).toHaveLength(2)
  })

  it('adds nothing to a park whose limit passed more than 12 hours ago', async () => {
    const old = await signedOwnRecord(signer, {}, Date.now() - 2 * 24 * 60 * 60_000)
    saveSession(old)
    expect(queueHandover(old.id, 'Alex')).toBeNull()
    expect(getSession(old.id)!.addenda ?? []).toEqual([])
    // The same record, at a time it was still on home, takes one.
    expect(queueHandover(old.id, 'Alex', Date.parse(old.expires_at!) + 60_000)?.kind).toBe('handover')
  })

  it('adds nothing to an ended record, a missing record or with no name', async () => {
    const own = await signedOwnRecord(signer, { ended_at: new Date().toISOString() })
    saveSession(own)
    expect(queueHandover(own.id, 'Alex')).toBeNull()
    expect(queueHandover('no-such-record', 'Alex')).toBeNull()
    const active = await signedOwnRecord(signer)
    saveSession(active)
    expect(queueHandover(active.id, '  ')).toBeNull()
    expect(getSession(own.id)!.addenda ?? []).toEqual([])
    expect(getSession(active.id)!.addenda ?? []).toEqual([])
  })
})
