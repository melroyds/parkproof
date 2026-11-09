// Pure evidence-chain helpers (spec N2): the arrival_context builder, seq
// assignment and renumbering, parent lookup, the departure catch-up rule,
// and the post-signing checks that keep "stored" equal to "signed".
import { describe, expect, it } from 'vitest'
import { normalizeAddendumData } from '../../lambda/addendum-schema.js'
import type { LogDraft, ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import {
  DEPARTURE_CATCH_UP_GRACE_MS,
  ERR_SIGNED_DATA_MISMATCH,
  buildArrivalContext,
  chainKeyForAddenda,
  chainKeyHashOf,
  checkAddendumBundle,
  checkArrivalBundle,
  compactPendingSeqs,
  departureCatchUpData,
  draftWithGateAcks,
  emptyLogDraft,
  fitText,
  hasPendingAddenda,
  needsDepartureCatchUp,
  nextAddendumSeq,
  nextPendingAddendum,
  parentBundleFor,
} from './evidence-chain'

const ch = (n: number) => String.fromCharCode(n)
const T = '2026-05-21T08:00:00.000Z'
const UUID = '0b6f7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e'
const H = (c: string) => c.repeat(64)

function bundle(payload: Record<string, unknown>, signed_at = '2026-05-21T08:00:05.000Z'): SignatureBundle {
  return {
    schema: String(payload.schema),
    signed_at,
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'test',
    canonical_payload: JSON.stringify(payload),
    signature_base64: 'MEUCIQ==',
  }
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: T,
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

function addendum(seq: number, state: 'pending' | 'signed' | 'rejected', id = `a${seq}-${state}`): SignedAddendum {
  return {
    id,
    seq,
    kind: 'condition',
    captured_at: `2026-05-21T08:0${seq}:00.000Z`,
    data: {},
    ...(state === 'signed' ? { bundle: bundle({ schema: 'parkproof-addendum-v1', seq, addendum_id: id }) } : {}),
    ...(state === 'rejected' ? { rejected: { code: 'ERR_BAD_STRING', at: T } } : {}),
  }
}

describe('emptyLogDraft', () => {
  it('has every LogDraft field, all empty', () => {
    const d: LogDraft = emptyLogDraft()
    expect(d).toEqual({
      gate_acks: { meter_ticket: null, permit_zone: null, accessible_permit: null },
      permit_context: null,
      workday: null,
      driver_name: null,
    })
    expect(emptyLogDraft()).not.toBe(d)
  })
})

describe('draftWithGateAcks', () => {
  it('puts the result screen acknowledgements on a new draft and keeps the other fields', () => {
    const d: LogDraft = { ...emptyLogDraft(), driver_name: 'Sam' }
    const acks = { meter_ticket: true, permit_zone: null, accessible_permit: null }
    const next = draftWithGateAcks(d, acks)
    expect(next).not.toBe(d)
    expect(next).toEqual({ ...d, gate_acks: acks })
    expect(next.gate_acks).not.toBe(acks)
    // The draft it came from is left alone.
    expect(d.gate_acks).toEqual(emptyLogDraft().gate_acks)
  })

  it('returns the same draft when nothing changed', () => {
    const d = emptyLogDraft()
    expect(draftWithGateAcks(d, { meter_ticket: null, permit_zone: null, accessible_permit: null })).toBe(d)
    const ticked = draftWithGateAcks(d, { meter_ticket: true, permit_zone: true, accessible_permit: null })
    expect(draftWithGateAcks(ticked, { meter_ticket: true, permit_zone: true, accessible_permit: null })).toBe(ticked)
  })
})

describe('fitText', () => {
  it('turns forbidden characters into spaces and trims', () => {
    expect(fitText('  Sam' + ch(10) + 'Lee' + ch(0x202e) + ' ', 60)).toBe('Sam Lee')
  })
  it('cuts to the cap without splitting a surrogate pair', () => {
    const emoji = String.fromCodePoint(0x1f697) // two UTF-16 units
    expect(fitText('abc' + emoji, 4)).toBe('abc')
    expect(fitText('abcdef', 4)).toBe('abcd')
  })
  it('returns null for non-strings and empty results', () => {
    expect(fitText(42, 10)).toBeNull()
    expect(fitText(undefined, 10)).toBeNull()
    expect(fitText(ch(10) + ch(9), 10)).toBeNull()
  })
})

describe('buildArrivalContext', () => {
  it('is all null for a plain record and an empty draft, and passes the schema', () => {
    const data = buildArrivalContext(record(), emptyLogDraft())
    expect(data).toEqual({
      driver_name: null,
      sign_status: null,
      sign_issues: [],
      rule_flags: null,
      gate_acks: null,
      permit_commitment: null,
      photos: [],
      condition_note: null,
      compliance_type: null,
      jurisdiction: null,
      workday: null,
      boundary: null,
    })
    expect(normalizeAddendumData('arrival_context', data)).toEqual(data)
  })

  it('fills from the record first and the draft second', () => {
    const draft: LogDraft = {
      gate_acks: { meter_ticket: true, permit_zone: null, accessible_permit: null },
      permit_context: null,
      workday: { workday_id: UUID, leg_index: 1, previous_session_id: 'rec-0' },
      driver_name: 'Draft Name',
    }
    const photo = { role: 'condition-front' as const, sha256: H('a'), captured_at: T, source: 'camera_input' as const }
    const s = record({
      driver_name: 'Record Name',
      sign_status: 'contradictory',
      sign_issues: ['Two plates disagree'],
      rule_flags: {
        requires_ticket: true,
        payment_methods: ['meter'],
        requires_disabled_permit: false,
        is_permit_zone: true,
        permit_area: '25',
        is_area_sign: false,
      },
      photos: [photo, { ...photo, role: 'return-rear' }],
      condition_note: 'Dent on the left door',
      compliance_type: 'meter_ticket',
      jurisdiction: 'VIC',
      stretch_deadline: '2026-05-21T10:00:00.000Z',
      boundary: { previous_session_id: 'rec-0', asked_because: ['within_30m'], answer: 'not_sure', distance_from_previous_m: 12 },
    })
    const data = buildArrivalContext(s, draft, { permit_commitment: H('c') })
    expect(data.driver_name).toBe('Record Name')
    expect(data.gate_acks).toEqual({ meter_ticket: true, permit_zone: null, accessible_permit: null })
    expect(data.photos).toEqual([photo]) // return photos belong to the departure
    expect(data.workday).toEqual({
      workday_id: UUID,
      leg_index: 1,
      stretch_deadline: '2026-05-21T10:00:00.000Z',
      previous_departure_payload_sha256: null,
    })
    expect(data.permit_commitment).toBe(H('c'))
    expect(data.rule_flags?.permit_area).toBe('25')
    expect(data.boundary?.answer).toBe('not_sure')
    expect(normalizeAddendumData('arrival_context', data)).toEqual(data)

    // Fields the record doesn't have at all come from the draft.
    const fromDraft = buildArrivalContext(record(), draft)
    expect(fromDraft.driver_name).toBe('Draft Name')
    expect(fromDraft.workday).toEqual({
      workday_id: UUID,
      leg_index: 1,
      stretch_deadline: null,
      previous_departure_payload_sha256: null,
    })
  })

  it('signs a field the record cleared (null) as null, never the draft value', () => {
    const draft: LogDraft = {
      gate_acks: { meter_ticket: true, permit_zone: true, accessible_permit: null },
      permit_context: null,
      workday: { workday_id: UUID, leg_index: 2, previous_session_id: 'rec-0' },
      driver_name: 'Draft Name',
    }
    // The driver cleared the prefilled "Who's driving?", and the leg was
    // saved as a normal record.
    const data = buildArrivalContext(record({ driver_name: null, workday_id: null }), draft)
    expect(data.driver_name).toBeNull()
    expect(data.workday).toBeNull()
    // The workday is a unit: a record leg_index never mixes with the draft's id.
    expect(buildArrivalContext(record({ leg_index: 4 }), draft).workday?.leg_index).toBe(2)
    expect(buildArrivalContext(record({ workday_id: UUID }), draft).workday).toBeNull()
    // gate_acks the same way.
    const acks = { meter_ticket: false, permit_zone: null, accessible_permit: null }
    expect(buildArrivalContext(record({ gate_acks: acks }), draft).gate_acks).toEqual(acks)
    expect(buildArrivalContext(record({ gate_acks: null as never }), draft).gate_acks).toBeNull()
  })

  it('leaves out what does not fit, so link 1 always queues', () => {
    const messy = record({
      driver_name: 'x'.repeat(200) + ch(10),
      sign_status: 'blurry' as never,
      sign_issues: Array(9).fill('Faded' + ch(0x2028) + 'plate'),
      condition_note: 'y'.repeat(400),
      compliance_type: 'bribe' as never,
      jurisdiction: 'NZ' as never,
      photos: [{ role: 'selfie', sha256: 'nope', captured_at: 'now', source: 'camera_input' } as never],
      boundary: { previous_session_id: '', asked_because: [], answer: 'not_sure', distance_from_previous_m: null },
      workday_id: 'not-a-uuid',
      leg_index: 3,
      rule_flags: { payment_methods: Array(10).fill('m'.repeat(30)) } as never,
    })
    const data = buildArrivalContext(messy, emptyLogDraft(), { permit_commitment: 'short' })
    expect(data.driver_name).toHaveLength(60)
    expect(data.sign_status).toBeNull()
    expect(data.sign_issues).toHaveLength(5)
    expect(data.sign_issues[0]).toBe('Faded plate')
    expect(data.condition_note).toHaveLength(280)
    expect(data.compliance_type).toBeNull()
    expect(data.jurisdiction).toBeNull()
    expect(data.photos).toEqual([])
    expect(data.boundary).toBeNull()
    expect(data.workday).toBeNull()
    expect(data.permit_commitment).toBeNull()
    // A partial rule_flags object is not signed as four "no"s.
    expect(data.rule_flags).toBeNull()
    expect(() => normalizeAddendumData('arrival_context', data)).not.toThrow()

    const flags = buildArrivalContext(
      record({
        rule_flags: {
          requires_ticket: true,
          payment_methods: Array(10).fill('m'.repeat(30)),
          requires_disabled_permit: false,
          is_permit_zone: false,
          permit_area: null,
          is_area_sign: false,
        },
      }),
      emptyLogDraft(),
    ).rule_flags
    expect(flags?.payment_methods).toHaveLength(6)
    expect(flags?.payment_methods?.[0]).toHaveLength(20)
    expect(flags?.requires_ticket).toBe(true)
  })

  it('signs rule_flags only when all four yes/no flags are booleans', () => {
    const complete = { requires_ticket: false, payment_methods: null, requires_disabled_permit: false, is_permit_zone: false, permit_area: null, is_area_sign: false }
    expect(buildArrivalContext(record({ rule_flags: complete }), emptyLogDraft()).rule_flags).toEqual(complete)
    for (const key of ['requires_ticket', 'requires_disabled_permit', 'is_permit_zone', 'is_area_sign'] as const) {
      const broken = { ...complete, [key]: 'false' } as never
      expect(buildArrivalContext(record({ rule_flags: broken }), emptyLogDraft()).rule_flags).toBeNull()
      const { [key]: _gone, ...missing } = complete
      void _gone
      expect(buildArrivalContext(record({ rule_flags: missing as never }), emptyLogDraft()).rule_flags).toBeNull()
    }
  })

  it('never puts a permit in plain text, only the commitment', () => {
    const s = record({
      permit_context: {
        type: 'accessible',
        area: null,
        holder_present: true,
        sign_exception_applies: true,
        standard_until: null,
        permit_until: null,
        note: null,
      },
    })
    const text = JSON.stringify(buildArrivalContext(s, emptyLogDraft()))
    expect(text).not.toContain('accessible')
    expect(text).not.toContain('holder_present')
  })
})

describe('seq assignment and renumbering', () => {
  it('nextAddendumSeq: one more than the highest seq that is not rejected', () => {
    expect(nextAddendumSeq(undefined)).toBe(1)
    expect(nextAddendumSeq([])).toBe(1)
    expect(nextAddendumSeq([addendum(1, 'signed'), addendum(2, 'pending')])).toBe(3)
    expect(nextAddendumSeq([addendum(1, 'signed'), addendum(2, 'rejected')])).toBe(2)
  })

  it('compactPendingSeqs closes the gap a rejection leaves, keeping order', () => {
    const list = [
      addendum(1, 'signed'),
      addendum(2, 'rejected'),
      addendum(3, 'pending', 'p3'),
      addendum(4, 'pending', 'p4'),
    ]
    const out = compactPendingSeqs(list)
    expect(out.map((a) => [a.id, a.seq])).toEqual([
      ['a1-signed', 1],
      ['a2-rejected', 2],
      ['p3', 2],
      ['p4', 3],
    ])
    // Unchanged entries are the same objects; the input isn't mutated.
    expect(out[0]).toBe(list[0])
    expect(list[2].seq).toBe(3)
  })

  it('compactPendingSeqs with nothing signed starts pending links at 1', () => {
    const out = compactPendingSeqs([addendum(1, 'rejected'), addendum(2, 'pending', 'p')])
    expect(out.find((a) => a.id === 'p')!.seq).toBe(1)
  })

  it('nextPendingAddendum picks the lowest pending seq', () => {
    const s = record({ addenda: [addendum(1, 'signed'), addendum(3, 'pending', 'late'), addendum(2, 'pending', 'early')] })
    expect(nextPendingAddendum(s)?.id).toBe('early')
    expect(hasPendingAddenda(s)).toBe(true)
    expect(nextPendingAddendum(record({ addenda: [addendum(1, 'signed'), addendum(2, 'rejected')] }))).toBeNull()
    expect(hasPendingAddenda(record())).toBe(false)
  })
})

describe('parents and chain keys', () => {
  const link0v2 = bundle({ schema: 'parkproof-evidence-v2', session_id: 'rec-1', chain_key_sha256: H('9') })
  const link0v1 = bundle({ schema: 'parkproof-evidence-v1', session_id: 'rec-1' })

  it('parentBundleFor: link 0 for seq 1, the signed seq-1 addendum otherwise', () => {
    const a1 = addendum(1, 'signed')
    const s = record({ signature: link0v2, addenda: [a1, addendum(2, 'pending')] })
    expect(parentBundleFor(s, 1)).toBe(link0v2)
    expect(parentBundleFor(s, 2)).toBe(a1.bundle)
    expect(parentBundleFor(s, 3)).toBeNull()
    expect(parentBundleFor(record(), 1)).toBeNull()
  })

  it('parentBundleFor picks the earliest signed of two links at the same seq', () => {
    const early = { ...addendum(1, 'signed', 'early'), bundle: bundle({ seq: 1, schema: 'parkproof-addendum-v1' }, '2026-05-21T08:00:01.000Z') }
    const late = { ...addendum(1, 'signed', 'late'), bundle: bundle({ seq: 1, schema: 'parkproof-addendum-v1' }, '2026-05-21T08:00:09.000Z') }
    expect(parentBundleFor(record({ addenda: [late, early] }), 2)).toBe(early.bundle)
  })

  it('chainKeyForAddenda: the key for v2, null for v1, undefined when the key is missing', () => {
    expect(chainKeyForAddenda(record({ signature: link0v2, chain_key: H('e') }))).toBe(H('e'))
    expect(chainKeyForAddenda(record({ signature: link0v2 }))).toBeUndefined()
    expect(chainKeyForAddenda(record({ signature: link0v1, chain_key: H('e') }))).toBeNull()
    expect(chainKeyHashOf(link0v2)).toBe(H('9'))
    expect(chainKeyHashOf(link0v1)).toBeNull()
  })
})

describe('departure catch-up rule', () => {
  const ended = '2026-05-21T09:00:00.000Z'
  const endedMs = Date.parse(ended)

  const link0v2 = bundle({ schema: 'parkproof-evidence-v2', session_id: 'rec-1', chain_key_sha256: H('9') })
  const link0v1 = bundle({ schema: 'parkproof-evidence-v1', session_id: 'rec-1' })

  it('is due once the grace period has passed after ended_at', () => {
    const here = { endedHere: true }
    const s = record({ ended_at: ended, chain_key: H('e'), signature: link0v2 })
    expect(needsDepartureCatchUp(s, endedMs + DEPARTURE_CATCH_UP_GRACE_MS - 1, here)).toBe(false)
    expect(needsDepartureCatchUp(s, endedMs + DEPARTURE_CATCH_UP_GRACE_MS, here)).toBe(true)
    // A record with its chain key here, link 0 not signed yet.
    expect(needsDepartureCatchUp(record({ ended_at: ended, chain_key: H('e') }), endedMs + DEPARTURE_CATCH_UP_GRACE_MS, here)).toBe(true)
    expect(departureCatchUpData(s)).toEqual({ ended_at: ended, location: null, distance_from_arrival_m: null, return_photos: [] })
  })

  it('holding the chain key is not enough: only the device that ended the record adds its departure (T0b4)', () => {
    // A synced copy: chain key, link 0 and ended_at all came from the cloud,
    // while the departure is still pending on the device that ended it.
    const synced = record({ ended_at: ended, chain_key: H('e'), signature: link0v2 })
    const later = endedMs + 10 * DEPARTURE_CATCH_UP_GRACE_MS
    expect(needsDepartureCatchUp(synced, later)).toBe(false)
    expect(needsDepartureCatchUp(synced, later, { endedHere: false })).toBe(false)
    expect(needsDepartureCatchUp(synced, later, { endedHere: true })).toBe(true)
  })

  it('is never due without ended_at, with any departure addendum, or on a shared copy', () => {
    const later = endedMs + 10 * DEPARTURE_CATCH_UP_GRACE_MS
    const here = { endedHere: true }
    expect(needsDepartureCatchUp(record(), later, here)).toBe(false)
    const rejectedDeparture = { ...addendum(1, 'rejected'), kind: 'departure' as const }
    expect(needsDepartureCatchUp(record({ ended_at: ended, addenda: [rejectedDeparture] }), later, here)).toBe(false)
    const shared = record({
      ended_at: ended,
      shared_from: { original_session_id: 'x', received_at: T, shared_at: null, arrival_bundle: null, snapshot: {} },
    })
    expect(needsDepartureCatchUp(shared, later, here)).toBe(false)
    expect(needsDepartureCatchUp(record({ ended_at: 'yesterday' }), later, here)).toBe(false)
  })

  it('is never due on a v2 copy whose chain key is not on this device', () => {
    const later = endedMs + 10 * DEPARTURE_CATCH_UP_GRACE_MS
    // A cloud copy keeps signature and ended_at but not chain_key.
    const pulled = record({ ended_at: ended, signature: link0v2 })
    expect(needsDepartureCatchUp(pulled, later)).toBe(false)
    expect(needsDepartureCatchUp(pulled, later, { endedHere: true })).toBe(false)
  })

  it('without a chain key, is due only on the device that ended the record', () => {
    const later = endedMs + 10 * DEPARTURE_CATCH_UP_GRACE_MS
    const v1 = record({ ended_at: ended, signature: link0v1 })
    expect(needsDepartureCatchUp(v1, later)).toBe(false)
    expect(needsDepartureCatchUp(v1, later, { endedHere: false })).toBe(false)
    expect(needsDepartureCatchUp(v1, later, { endedHere: true })).toBe(true)
    // Unsigned, no chain key: the same rule.
    expect(needsDepartureCatchUp(record({ ended_at: ended }), later)).toBe(false)
    expect(needsDepartureCatchUp(record({ ended_at: ended }), later, { endedHere: true })).toBe(true)
  })
})

describe('post-signing checks', () => {
  const request = {
    schema: 'parkproof-evidence-v2',
    session_id: 'rec-1',
    sign_photo_sha256: H('a'),
    ambient_photo_sha256: null,
    car_photo_sha256: null,
    chain_key_sha256: H('9'),
  }
  const good = bundle({ ...request })

  it('checkArrivalBundle accepts a bundle that signs what was asked', () => {
    expect(checkArrivalBundle(request, good)).toEqual({ ok: true })
  })

  it('checkArrivalBundle refuses a bundle for other photos, another record or another schema', () => {
    const bad = { ok: false, code: ERR_SIGNED_DATA_MISMATCH }
    expect(checkArrivalBundle(request, bundle({ ...request, sign_photo_sha256: H('b') }))).toEqual(bad)
    expect(checkArrivalBundle(request, bundle({ ...request, session_id: 'rec-2' }))).toEqual(bad)
    expect(checkArrivalBundle(request, bundle({ ...request, chain_key_sha256: H('8') }))).toEqual(bad)
    expect(checkArrivalBundle(request, bundle({ ...request, schema: 'parkproof-evidence-v1' }))).toEqual(bad)
    expect(checkArrivalBundle(request, { ...good, canonical_payload: 'not json' })).toEqual(bad)
  })

  it('checkAddendumBundle compares ids, seq, times, parent hash, chain hash and canonical data', () => {
    const parent = good
    const a: SignedAddendum = {
      id: UUID,
      seq: 1,
      kind: 'departure',
      captured_at: T,
      data: { ended_at: T, location: null, distance_from_arrival_m: null, return_photos: [] },
    }
    const payload = {
      schema: 'parkproof-addendum-v1',
      addendum_id: UUID,
      kind: 'departure',
      session_id: 'rec-1',
      seq: 1,
      parent_payload_sha256: H('1'),
      chain_key_sha256: H('9'),
      captured_at: T,
      signed_at: T,
      // Same data, different key order: canonical forms match.
      data: { return_photos: [], distance_from_arrival_m: null, location: null, ended_at: T },
    }
    expect(checkAddendumBundle(a, 'rec-1', parent, H('1'), bundle(payload))).toEqual({ ok: true })
    const bad = { ok: false, code: ERR_SIGNED_DATA_MISMATCH }
    expect(checkAddendumBundle(a, 'rec-1', parent, H('2'), bundle(payload))).toEqual(bad)
    expect(checkAddendumBundle(a, 'rec-2', parent, H('1'), bundle(payload))).toEqual(bad)
    expect(checkAddendumBundle(a, 'rec-1', parent, H('1'), bundle({ ...payload, seq: 2 }))).toEqual(bad)
    expect(checkAddendumBundle(a, 'rec-1', parent, H('1'), bundle({ ...payload, chain_key_sha256: null }))).toEqual(bad)
    expect(
      checkAddendumBundle(a, 'rec-1', parent, H('1'), bundle({ ...payload, data: { ...payload.data, distance_from_arrival_m: 5 } })),
    ).toEqual(bad)
    expect(checkAddendumBundle(a, 'rec-1', parent, H('1'), bundle({ ...payload, captured_at: '2026-05-21T08:00:01.000Z' }))).toEqual(bad)
  })
})
