// N3 on a new record (build spec T4 item 6): a record with a permit context
// gets its permit salt when it is prepared for saving, link 1 signs only
// sha256(permit_salt + canonicalize(permit_context)), and the permit itself
// never appears in what is signed. A record without a permit has no salt and
// signs a null commitment.
import { describe, expect, it } from 'vitest'
import { canonicalize, normalizeAddendumData } from '../../lambda/addendum-schema.js'
import { applyLogDraftDefaults, buildArrivalContext, emptyLogDraft } from './evidence-chain'
import { sha256HexUtf8 } from './hash'
import { withResultAnswers, type ResultAnswers } from './permit-answer'
import { generatePermitSalt, permitCommitmentFor, prepareNewRecord } from './signing'
import type { ParkingSession, PermitContext } from '../types'

/** The sign's flags for an accessible bay, as T3 stores them on the record. */
const ACCESSIBLE_BAY: NonNullable<ParkingSession['rule_flags']> = {
  requires_ticket: false,
  payment_methods: null,
  requires_disabled_permit: true,
  is_permit_zone: false,
  permit_area: null,
  is_area_sign: false,
}

const CONTEXT: PermitContext = {
  type: 'accessible',
  area: null,
  holder_present: true,
  sign_exception_applies: true,
  standard_until: '2026-11-09T05:00:00.000Z',
  permit_until: '2026-11-09T07:00:00.000Z',
  note: null,
}

function record(over: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: '2026-11-09T03:00:00.000Z',
    location: null,
    sign_photo: null,
    car_photo: null,
    rules: 'DISABLED 4P',
    observations: [],
    expires_at: '2026-11-09T05:00:00.000Z',
    confidence: 'high',
    ...over,
  }
}

describe('the permit salt', () => {
  it('is 32 random bytes as lowercase hex, different each time', () => {
    const a = generatePermitSalt()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(generatePermitSalt()).not.toBe(a)
  })

  it('is added when a record with a permit is prepared, and kept when it already has one', async () => {
    const prepared = await prepareNewRecord(record({ permit_context: CONTEXT }))
    expect(prepared.permit_salt).toMatch(/^[0-9a-f]{64}$/)
    expect(prepared.permit_context).toEqual(CONTEXT)
    const salt = 'b'.repeat(64)
    expect((await prepareNewRecord(record({ permit_context: CONTEXT, permit_salt: salt }))).permit_salt).toBe(salt)
  })

  it('is never on a record without a permit', async () => {
    expect('permit_salt' in (await prepareNewRecord(record()))).toBe(false)
    expect('permit_salt' in (await prepareNewRecord(record({ permit_context: null, permit_salt: 'c'.repeat(64) })))).toBe(
      false,
    )
  })
})

describe('the commitment link 1 signs', () => {
  it('is sha256 of the salt followed by the canonical permit context', async () => {
    const prepared = await prepareNewRecord(record({ permit_context: CONTEXT }))
    const commitment = await permitCommitmentFor(prepared)
    expect(commitment).toBe(await sha256HexUtf8(prepared.permit_salt + canonicalize(CONTEXT)))
    // Anyone holding the context and the salt can open it again later.
    const revealed = JSON.parse(JSON.stringify(prepared.permit_context)) as PermitContext
    expect(await sha256HexUtf8(prepared.permit_salt + canonicalize(revealed))).toBe(commitment)
  })

  it('changes with any detail of the permit', async () => {
    const salt = 'd'.repeat(64)
    const a = await permitCommitmentFor(record({ permit_context: CONTEXT, permit_salt: salt }))
    const b = await permitCommitmentFor(record({ permit_context: { ...CONTEXT, permit_until: null }, permit_salt: salt }))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(b).not.toBe(a)
  })

  it('is null without a permit or without a usable salt', async () => {
    expect(await permitCommitmentFor(record())).toBeNull()
    expect(await permitCommitmentFor(record({ permit_context: CONTEXT }))).toBeNull()
    expect(await permitCommitmentFor(record({ permit_context: CONTEXT, permit_salt: 'not-hex' }))).toBeNull()
  })

  it('is all link 1 carries about the permit details, on the draft the result screen really hands on', async () => {
    // What the result screen hands the logger when the driver answers "Yes"
    // to the accessible-permit safeguard: the gate answer and the permit.
    const draft = withResultAnswers(emptyLogDraft(), {
      gate_acks: { meter_ticket: null, permit_zone: null, accessible_permit: true },
      permit_context: CONTEXT,
    } satisfies ResultAnswers)
    const logged = applyLogDraftDefaults(record({ rule_flags: ACCESSIBLE_BAY }), draft)
    const prepared = await prepareNewRecord(logged)
    const commitment = await permitCommitmentFor(prepared)
    const data = buildArrivalContext(prepared, draft, { permit_commitment: commitment })
    expect(data.permit_commitment).toBe(commitment)
    // Valid as signed data, and none of the permit details in plain text:
    // not its type, holder, times or salt.
    expect(normalizeAddendumData('arrival_context', data)).toEqual(data)
    const text = JSON.stringify(data)
    for (const leak of [
      '"accessible"',
      'holder_present',
      'permit_until',
      'standard_until',
      'sign_exception_applies',
      prepared.permit_salt as string,
      '07:00:00',
    ]) {
      expect(text).not.toContain(leak)
    }
    // The gate answer itself is signed, as N2 lists it in arrival_context
    // (gate_acks.accessible_permit), next to the sign's own rule flag. That
    // says a permit holder's bay was used; N3 keeps the permit details out.
    // Whether this answer should be signed at all is for the spec owner
    // (an N2 and N3 question), so this test pins today's behaviour.
    expect(data.gate_acks).toEqual({ meter_ticket: null, permit_zone: null, accessible_permit: true })
    expect((data.rule_flags as { requires_disabled_permit: boolean }).requires_disabled_permit).toBe(true)
  })
})
