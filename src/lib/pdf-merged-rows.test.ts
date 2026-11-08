// @vitest-environment happy-dom
//
// One record carrying every task's rows in sessionRows, the evidence table
// all three PDFs draw: T3's sign condition, T2's proof of payment or
// permit, condition photos and damage note, T4's permit (saved on the
// record, signed only as a commitment, so never printed), and T7's
// "Driver (entered on the phone, not checked)" row and handover section.
// Each task's rows keep their place, and the permit details stay off the
// page.
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from './i18n'
import type { ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import { buildArrivalContext, emptyLogDraft } from './evidence-chain'
import { sessionRows } from './pdf'
import type { RecordTimesContext } from './record-times'

const TZ = 'Australia/Melbourne'
const CTX: RecordTimesContext = { now: Date.parse('2026-10-26T00:00:00.000Z'), endedHere: false, arrivalRejection: null }
const AT = '2026-10-25T02:30:00.000Z'
const SALT = 'ef'.repeat(32)
const COMMITMENT = 'ab'.repeat(32)

function bundle(payload: Record<string, unknown>): SignatureBundle {
  return {
    schema: String(payload.schema),
    signed_at: String(payload.signed_at),
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify(payload),
    signature_base64: 'MEUCIQ',
  }
}

function handover(id: string, seq: number, from: string, to: string, at: string): SignedAddendum {
  const data = { from_driver: from, to_driver: to, handed_over_at: at, location: null }
  return {
    id,
    seq,
    kind: 'handover',
    captured_at: at,
    data,
    bundle: bundle({ schema: 'parkproof-addendum-v1', addendum_id: id, kind: 'handover', seq, signed_at: '2026-10-25T02:31:10.000Z', data }),
  }
}

function fullRecord(): ParkingSession {
  const record: ParkingSession = {
    id: 'rec-all-tasks',
    arrived_at: '2026-10-25T01:00:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: '2026-10-25T03:00:00.000Z',
    confidence: 'high',
    chain_key: 'c0'.repeat(32),
    // T3: what the reading saw.
    sign_status: 'partially_obscured',
    sign_issues: ['Top corner bent'],
    // T2: a condition photo, a proof photo and its type, a damage note.
    photos: [
      { role: 'condition-front', sha256: '11'.repeat(32), captured_at: '2026-10-25T00:59:00.000Z', source: 'camera_input' },
      { role: 'compliance', sha256: '22'.repeat(32), captured_at: '2026-10-25T00:59:30.000Z', source: 'camera_input' },
    ],
    compliance_type: 'permit_displayed',
    condition_note: 'Scratch on the rear bumper',
    // T4: the permit the driver confirmed, and its salt.
    gate_acks: { meter_ticket: null, permit_zone: true, accessible_permit: null },
    permit_context: {
      type: 'resident',
      area: 'Area 25',
      holder_present: null,
      sign_exception_applies: true,
      standard_until: '2026-10-25T03:00:00.000Z',
      permit_until: '2026-10-25T05:00:00.000Z',
      note: null,
    },
    permit_salt: SALT,
    // T7: who was driving.
    driver_name: 'Sam',
  }
  // Link 1 as App queues it (still pending), then a signed handover.
  const context: SignedAddendum = {
    id: 'ctx-1',
    seq: 1,
    kind: 'arrival_context',
    captured_at: record.arrived_at,
    data: buildArrivalContext(record, emptyLogDraft(), { permit_commitment: COMMITMENT }) as unknown as Record<string, unknown>,
  }
  record.addenda = [context, handover('h-1', 2, 'Sam', 'Alex', AT)]
  return record
}

const t = i18n.t.bind(i18n)

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

describe('sessionRows with every task on one record', () => {
  it("keeps each task's rows, in order: sign condition (T3), proof, photos and note (T2), then driver and handover (T7)", () => {
    const labels = sessionRows(fullRecord(), TZ, t, CTX).map(([label]) => label)
    const expected = [
      t('pdf.evidence.field.signRules'),
      t('pdf.evidence.field.signCondition'),
      t('pdf.evidence.field.aiConfidence'),
      t('pdf.evidence.field.proof'),
      t('pdf.evidence.field.conditionPhotos'),
      t('pdf.evidence.field.damageNote'),
      t('pdf.evidence.field.driver'),
      t('pdf.evidence.field.handover'),
      t('pdf.evidence.field.handoverSigned'),
    ]
    const at = expected.map((label) => labels.indexOf(label))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    // The driver row and the handover section close the table.
    expect(labels.slice(-3)).toEqual(expected.slice(-3))
  })

  it("prints the driver (not signed yet) and the handover, and none of T4's permit details", () => {
    const rows = sessionRows(fullRecord(), TZ, t, CTX)
    const value = (key: string) => rows.find(([label]) => label === t(key))?.[1]
    expect(value('pdf.evidence.field.driver')).toBe(`Sam ${t('pdf.evidence.value.notSignedYet')}`)
    expect(value('pdf.evidence.field.handover')).toContain('Sam handed the car to Alex')
    expect(value('pdf.evidence.field.signCondition')).toContain('Top corner bent')
    const text = rows.flat().join('\n')
    // permit_until (05:00 UTC) is 4:00 pm AEDT.
    for (const secret of ['Area 25', 'resident', SALT, COMMITMENT, '4:00 pm']) {
      expect(text).not.toContain(secret)
    }
  })
})
