// The condition and proof photos (build spec T2) as pure rules: the grid's
// roles, which proof the gates call for, where a photo's fingerprint
// stands (read from the signed payloads), what the record screen lists,
// and when photos can still be added after saving.
import { describe, expect, it } from 'vitest'
import type { ParkingSession, PhotoRef, SignatureBundle, SignedAddendum } from '../types'
import {
  ANGLES,
  RECORD_PHOTOS_MAX,
  allowedComplianceType,
  angleRole,
  canAddEvidence,
  canTakeReturnPhotos,
  complianceTypesFor,
  conditionNotes,
  evidencePhotos,
  gridRoles,
  permitPhotoHashes,
  photoSigning,
  preselectedComplianceType,
  proofGates,
  proofInputOf,
  recordHasSignedPhoto,
  recordProofGates,
  referencedPhotoHashes,
  signedPhotoRef,
  withPermitGate,
} from './evidence-photos'
import { MAX_ADDENDA } from './evidence-chain'
import { MAX_PHOTO_REFS } from '../../lambda/cloud-sync.js'

const h = (c: string) => c.repeat(64)
const ref = (role: PhotoRef['role'], c: string, extra: Partial<PhotoRef> = {}): PhotoRef => ({
  role,
  sha256: h(c),
  captured_at: '2026-11-08T01:00:00.000Z',
  source: 'camera_input',
  ...extra,
})

function bundle(payload: Record<string, unknown>, keyAlias = 'alias/parkproof-evidence-signing'): SignatureBundle {
  return {
    schema: String(payload.schema ?? 'parkproof-addendum-v1'),
    signed_at: String(payload.signed_at ?? '2026-11-08T01:05:00.000Z'),
    algorithm: 'ECDSA_SHA_256',
    key_alias: keyAlias,
    canonical_payload: JSON.stringify(payload),
    signature_base64: 'MEUCIQ' + Math.random().toString(36).slice(2),
  }
}

function addendum(kind: SignedAddendum['kind'], seq: number, data: Record<string, unknown>, extra: Partial<SignedAddendum> = {}): SignedAddendum {
  return { id: `00000000-0000-4000-8000-00000000000${seq}`, seq, kind, captured_at: '2026-11-08T01:01:00.000Z', data, ...extra }
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: '2026-11-08T01:00:00.000Z',
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

describe('the angle grid', () => {
  it('has a role per side and a close-up, per phase', () => {
    expect(ANGLES).toEqual(['front', 'rear', 'left', 'right', 'detail'])
    expect(gridRoles('condition')).toEqual([
      'condition-front',
      'condition-rear',
      'condition-left',
      'condition-right',
      'condition-detail',
    ])
    expect(gridRoles('return')).toEqual(['return-front', 'return-rear', 'return-left', 'return-right', 'return-detail'])
    expect(angleRole('return', 'detail')).toBe('return-detail')
  })
})

describe('proof of payment or permit', () => {
  it('a gate asked on the result screen applies whatever the answer', () => {
    expect(proofGates(null, { meter_ticket: true, permit_zone: null, accessible_permit: null })).toEqual(['meter_ticket'])
    expect(proofGates(null, { meter_ticket: false, permit_zone: null, accessible_permit: null })).toEqual(['meter_ticket'])
  })

  it('without acknowledgements, the sign flags decide, the way the result screen asks (only when parking is allowed)', () => {
    expect(proofGates({ requires_ticket: true, can_park_now: true }, null)).toEqual(['meter_ticket'])
    expect(proofGates({ requires_ticket: true, can_park_now: false }, null)).toEqual([])
    expect(proofGates({ is_permit_zone: true }, undefined)).toEqual(['permit_zone'])
    expect(proofGates({}, { meter_ticket: null, permit_zone: null, accessible_permit: null })).toEqual([])
    expect(proofGates(null, null)).toEqual([])
  })

  it('lists gates in the result screen order and preselects from the first', () => {
    const gates = proofGates(
      { requires_ticket: true, requires_disabled_permit: true, is_permit_zone: true, can_park_now: true },
      null,
    )
    expect(gates).toEqual(['accessible_permit', 'permit_zone', 'meter_ticket'])
    expect(preselectedComplianceType(gates)).toBe('permit_displayed')
    expect(preselectedComplianceType(['meter_ticket'])).toBe('meter_ticket')
    expect(preselectedComplianceType(['permit_zone', 'meter_ticket'])).toBe('permit_displayed')
    expect(preselectedComplianceType([])).toBeNull()
  })

  it("a saved record's gates: its acknowledgements decide alone, and a permit it confirmed counts (T4 permit_context)", () => {
    const NOT_ASKED = { meter_ticket: null, permit_zone: null, accessible_permit: null }
    const flags = { requires_ticket: true, is_permit_zone: true, requires_disabled_permit: false }
    // A "can't park" record asked no gate: its flags don't bring one back.
    expect(recordProofGates({ rule_flags: flags, gate_acks: NOT_ASKED })).toEqual([])
    // A record saved without acknowledgements falls back to its flags.
    expect(recordProofGates({ rule_flags: flags })).toEqual(['permit_zone', 'meter_ticket'])
    const permit = (type: 'accessible' | 'resident' | 'business', holder_present: boolean | null = null) => ({
      type,
      holder_present,
    })
    // The permit question answered yes where no gate showed.
    expect(recordProofGates({ rule_flags: flags, gate_acks: NOT_ASKED, permit_context: permit('resident') })).toEqual([
      'permit_zone',
    ])
    expect(
      recordProofGates({ gate_acks: { ...NOT_ASKED, meter_ticket: true }, permit_context: permit('accessible', true) }),
    ).toEqual(['accessible_permit', 'meter_ticket'])
    expect(
      preselectedComplianceType(
        recordProofGates({ gate_acks: { ...NOT_ASKED, meter_ticket: true }, permit_context: permit('business') }),
      ),
    ).toBe('permit_displayed')
    // Already asked as a gate: not listed twice.
    expect(
      recordProofGates({ gate_acks: { ...NOT_ASKED, permit_zone: true }, permit_context: permit('resident') }),
    ).toEqual(['permit_zone'])
    // No permit used, or the accessible permit's holder wasn't there.
    expect(recordProofGates({ gate_acks: NOT_ASKED, permit_context: null })).toEqual([])
    expect(recordProofGates({ gate_acks: NOT_ASKED, permit_context: permit('accessible', false) })).toEqual([])
  })

  it("a confirmed permit adds its gate in the result screen's order, ahead of a ticked paid gate (both screens use this)", () => {
    const permit = (type: 'accessible' | 'resident' | 'business', holder_present: boolean | null = null) => ({
      type,
      holder_present,
    })
    // A "can't park" permit zone where the driver confirmed their resident permit: no gate showed.
    expect(withPermitGate([], permit('resident'))).toEqual(['permit_zone'])
    // A paid sign with an exception for business permits: the permit comes first.
    expect(withPermitGate(['meter_ticket'], permit('business'))).toEqual(['permit_zone', 'meter_ticket'])
    expect(preselectedComplianceType(withPermitGate(['meter_ticket'], permit('business')))).toBe('permit_displayed')
    expect(withPermitGate(['permit_zone', 'meter_ticket'], permit('accessible', true))).toEqual([
      'accessible_permit',
      'permit_zone',
      'meter_ticket',
    ])
    // Already a gate, no permit, or the accessible permit's holder wasn't there: the gates as they were.
    expect(withPermitGate(['permit_zone'], permit('resident'))).toEqual(['permit_zone'])
    expect(withPermitGate(['meter_ticket'], null)).toEqual(['meter_ticket'])
    expect(withPermitGate(['meter_ticket'], undefined)).toEqual(['meter_ticket'])
    expect(withPermitGate(['meter_ticket'], permit('accessible', false))).toEqual(['meter_ticket'])
    // The save screen's gates (from the draft) and the saved record's agree.
    const acks = { meter_ticket: true, permit_zone: null, accessible_permit: null }
    const flags = { requires_ticket: true, is_permit_zone: false, requires_disabled_permit: false, can_park_now: true }
    expect(withPermitGate(proofGates(flags, acks), permit('business'))).toEqual(
      recordProofGates({ rule_flags: flags, gate_acks: acks, permit_context: permit('business') }),
    )
  })

  it('a library photo can only be a payment confirmation', () => {
    expect(complianceTypesFor('library')).toEqual(['payment_confirmation'])
    expect(complianceTypesFor('camera')).toEqual(['meter_ticket', 'payment_confirmation', 'permit_displayed', 'other'])
  })

  it('an old file handed to the camera input counts as a library photo, for the picker and for the saved type', () => {
    expect(proofInputOf('camera', 'camera_input')).toBe('camera')
    expect(proofInputOf('camera', 'library')).toBe('library')
    expect(proofInputOf('library', 'camera_input')).toBe('library')
    expect(allowedComplianceType('library', 'meter_ticket')).toBe('payment_confirmation')
    expect(allowedComplianceType('library', 'permit_displayed')).toBe('payment_confirmation')
    expect(allowedComplianceType('library', 'payment_confirmation')).toBe('payment_confirmation')
    expect(allowedComplianceType('camera_input', 'meter_ticket')).toBe('meter_ticket')
    expect(allowedComplianceType('library', null)).toBeNull()
  })
})

describe('photoSigning: read from the signed payloads', () => {
  it('a photo in a signed link 0 is signed at its signing time', () => {
    const s = record({
      photos: [ref('sign', 'a')],
      signature: bundle({ schema: 'parkproof-evidence-v2', sign_photo_sha256: h('a'), signed_at: '2026-11-08T01:02:00.000Z' }),
    })
    expect(photoSigning(s, h('a'))).toEqual({ state: 'signed', signed_at: '2026-11-08T01:02:00.000Z' })
  })

  it('a condition photo is pending while its part waits, signed once the part is, and the stored data never counts as signed', () => {
    const photo = ref('condition-front', 'b')
    const pending = record({ photos: [photo], addenda: [addendum('condition', 1, { when: 'parking', photos: [photo], note: null })] })
    expect(photoSigning(pending, h('b'))).toEqual({ state: 'pending' })

    // The bundle signs other photos: the stored data's claim doesn't make this one signed.
    const other = ref('condition-front', 'c')
    const mismatched = record({
      photos: [photo],
      addenda: [
        addendum('condition', 1, { when: 'parking', photos: [photo], note: null }, {
          bundle: bundle({ data: { when: 'parking', photos: [other], note: null } }),
        }),
      ],
    })
    expect(photoSigning(mismatched, h('b')).state).toBe('unsigned')

    const signed = record({
      photos: [photo],
      addenda: [
        addendum('condition', 1, { when: 'parking', photos: [photo], note: null }, {
          bundle: bundle({ signed_at: '2026-11-08T01:09:00.000Z', data: { when: 'parking', photos: [photo], note: null } }),
        }),
      ],
    })
    expect(photoSigning(signed, h('b'))).toEqual({ state: 'signed', signed_at: '2026-11-08T01:09:00.000Z' })
  })

  it('prefers ParkProof\'s key over a development key, and the earliest signing time', () => {
    const photo = ref('compliance', 'd')
    const data = { compliance_type: 'meter_ticket', photo }
    const s = record({
      photos: [photo],
      addenda: [
        addendum('compliance', 1, data, { bundle: bundle({ signed_at: '2026-11-08T01:01:00.000Z', data }, 'dev-ephemeral') }),
        addendum('arrival_context', 2, { photos: [photo] }, { bundle: bundle({ signed_at: '2026-11-08T01:30:00.000Z', data: { photos: [photo] } }) }),
        addendum('compliance', 3, data, { bundle: bundle({ signed_at: '2026-11-08T01:20:00.000Z', data }) }),
      ],
    })
    expect(photoSigning(s, h('d'))).toEqual({ state: 'signed', signed_at: '2026-11-08T01:20:00.000Z' })
    const devOnly = record({ photos: [photo], addenda: [s.addenda![0]] })
    expect(photoSigning(devOnly, h('d'))).toEqual({ state: 'dev_key', signed_at: '2026-11-08T01:01:00.000Z' })
  })

  it('a photo only a refused part carries is refused; a photo no part carries is unsigned', () => {
    const photo = ref('return-left', 'e')
    const refused = record({
      photos: [photo],
      addenda: [
        addendum('departure', 1, { ended_at: '2026-11-08T02:00:00.000Z', location: null, distance_from_arrival_m: null, return_photos: [photo] }, {
          rejected: { code: 'ERR_BAD_VALUE', at: '2026-11-08T02:01:00.000Z' },
        }),
      ],
    })
    expect(photoSigning(refused, h('e'))).toEqual({ state: 'rejected' })
    expect(photoSigning(record({ photos: [photo] }), h('e'))).toEqual({ state: 'unsigned' })
  })
})

describe('evidencePhotos: the record screen list', () => {
  it('groups parking, return and proof photos in grid order, leaving sign and car photos out', () => {
    const s = record({
      photos: [
        ref('sign', '1'),
        ref('car', '2'),
        ref('compliance', '3'),
        ref('return-rear', '4'),
        ref('condition-detail', '5'),
        ref('condition-front', '6'),
        ref('return-front', '7'),
      ],
      compliance_type: 'meter_ticket',
    })
    expect(evidencePhotos(s).map((p) => `${p.group}:${p.ref.role}`)).toEqual([
      'parking:condition-front',
      'parking:condition-detail',
      'return:return-front',
      'return:return-rear',
      'compliance:compliance',
    ])
    expect(evidencePhotos(s).find((p) => p.group === 'compliance')!.compliance_type).toBe('meter_ticket')
  })

  it('takes the proof type from the signed part, and lists a signed photo the record list lacks', () => {
    const photo = ref('compliance', '8')
    const signedData = { compliance_type: 'payment_confirmation', photo }
    const s = record({
      photos: [],
      compliance_type: 'meter_ticket',
      addenda: [addendum('compliance', 1, signedData, { bundle: bundle({ data: signedData }) })],
    })
    const list = evidencePhotos(s)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ group: 'compliance', compliance_type: 'payment_confirmation', signing: { state: 'signed' } })
  })

  it('reads the damage notes from the signed parts, labelled by when', () => {
    const photo = ref('condition-front', '9')
    const s = record({
      condition_note: 'unsigned copy on the record',
      addenda: [
        addendum('arrival_context', 1, { condition_note: 'stored text' }, { bundle: bundle({ data: { condition_note: 'Dent in the rear door' } }) }),
        addendum('condition', 2, { when: 'return', photos: [photo], note: 'New scratch on the bonnet' }),
      ],
    })
    expect(conditionNotes(s)).toEqual([
      { when: 'parking', note: 'Dent in the rear door', state: 'signed' },
      { when: 'return', note: 'New scratch on the bonnet', state: 'pending' },
    ])
    // A note only on the record (no part carries it) is not in a signed part at all.
    expect(conditionNotes(record({ condition_note: 'Before signing' }))).toEqual([
      { when: 'parking', note: 'Before signing', state: 'unsigned' },
    ])
  })

  it('a note in a refused part is refused, never "not signed yet"; a development key is told apart', () => {
    const photo = ref('condition-left', 'a')
    const s = record({
      addenda: [
        addendum('arrival_context', 1, { condition_note: 'Scratch at parking' }, {
          rejected: { code: 'ERR_BAD_STRING', at: '2026-11-08T01:02:00.000Z' },
        }),
        addendum('condition', 2, { when: 'parking', photos: [photo], note: 'Later dent' }, {
          bundle: bundle({ data: { when: 'parking', photos: [photo], note: 'Later dent' } }, 'dev-ephemeral'),
        }),
      ],
    })
    expect(conditionNotes(s)).toEqual([
      { when: 'parking', note: 'Scratch at parking', state: 'rejected' },
      { when: 'parking', note: 'Later dent', state: 'dev_key' },
    ])
  })

  it('shows a signed photo with the time and source its signed part carries, not the local copy', () => {
    const signedCopy = ref('condition-front', 'c', { captured_at: '2026-11-08T01:00:00.000Z', source: 'library' })
    const localCopy = { ...signedCopy, captured_at: '2026-11-08T05:00:00.000Z', source: 'camera_input' as const }
    const data = { when: 'parking', photos: [signedCopy], note: null }
    const s = record({
      photos: [localCopy],
      addenda: [addendum('condition', 1, data, { bundle: bundle({ data }) })],
    })
    const list = evidencePhotos(s)
    expect(list).toHaveLength(1)
    expect(list[0].ref).toEqual(signedCopy)
    expect(signedPhotoRef(s, localCopy)).toEqual(signedCopy)
    // Not signed yet: the local copy is all there is.
    const pending = record({ photos: [localCopy], addenda: [addendum('condition', 1, data)] })
    expect(evidencePhotos(pending)[0].ref).toEqual(localCopy)
    expect(signedPhotoRef(pending, localCopy)).toBe(localCopy)
  })

  it('lists a photo a waiting part carries even when the record list lacks it', () => {
    const photo = ref('compliance', 'e')
    const s = record({ photos: [], addenda: [addendum('compliance', 1, { compliance_type: 'meter_ticket', photo })] })
    expect(evidencePhotos(s)).toMatchObject([{ group: 'compliance', compliance_type: 'meter_ticket', signing: { state: 'pending' } }])
  })

  it('permitPhotoHashes: proof photos marked as a displayed permit, by the signed type', () => {
    const permit = ref('compliance', '1')
    const ticket = ref('compliance', '2')
    const permitData = { compliance_type: 'permit_displayed', photo: permit }
    const ticketData = { compliance_type: 'meter_ticket', photo: ticket }
    const s = record({
      photos: [permit, ticket],
      addenda: [
        addendum('compliance', 1, permitData, { bundle: bundle({ data: permitData }) }),
        addendum('compliance', 2, ticketData, { bundle: bundle({ data: ticketData }) }),
      ],
    })
    expect([...permitPhotoHashes(s)]).toEqual([h('1')])
  })
})

describe('adding photos after saving', () => {
  it('only on the driver\'s own record that hasn\'t ended and has room, keeping one part for the departure', () => {
    expect(canAddEvidence(record())).toBe(true)
    expect(canAddEvidence(record({ ended_at: '2026-11-08T03:00:00.000Z' }))).toBe(false)
    expect(
      canAddEvidence(
        record({ shared_from: { original_session_id: 'x', received_at: 'y', shared_at: null, arrival_bundle: null, snapshot: {} } }),
      ),
    ).toBe(false)
    // A v2 chain whose key isn't on this device can't be extended here.
    expect(canAddEvidence(record({ signature: bundle({ schema: 'parkproof-evidence-v2', chain_key_sha256: h('f') }) }))).toBe(false)
    const parts = (n: number) =>
      Array.from({ length: n }, (_, i) => addendum('condition', i + 1, { when: 'parking', photos: [], note: null }, { id: `id-${i}` }))
    expect(canAddEvidence(record({ addenda: parts(MAX_ADDENDA - 2) }))).toBe(true)
    expect(canAddEvidence(record({ addenda: parts(MAX_ADDENDA - 1) }))).toBe(false)
  })

  it('keeps the record within the cloud\'s photo cap, with room for a full part and the return photos', () => {
    expect(RECORD_PHOTOS_MAX).toBe(MAX_PHOTO_REFS)
    const photos = (n: number) => Array.from({ length: n }, (_, i) => ref('condition-front', '0', { sha256: i.toString(16).padStart(64, '0') }))
    // 40 photos + 5 for a new part + 5 return photos = 50: fits.
    expect(canAddEvidence(record({ photos: photos(40) }))).toBe(true)
    expect(canAddEvidence(record({ photos: photos(41) }))).toBe(false)
    // Once the departure is queued, its return photos are already counted.
    const departure = addendum('departure', 1, { ended_at: '2026-11-08T02:00:00.000Z', location: null, distance_from_arrival_m: null, return_photos: [] })
    expect(canAddEvidence(record({ photos: photos(45), addenda: [departure] }))).toBe(true)
  })

  it('the departure sheet offers condition photos only when they can be signed and fit', () => {
    expect(canTakeReturnPhotos(record())).toBe(true)
    // A v2 chain whose key isn't on this device: no part could carry them.
    expect(canTakeReturnPhotos(record({ signature: bundle({ schema: 'parkproof-evidence-v2', chain_key_sha256: h('f') }) }))).toBe(false)
    const parts = (n: number) =>
      Array.from({ length: n }, (_, i) => addendum('condition', i + 1, { when: 'parking', photos: [], note: null }, { id: `id-${i}` }))
    expect(canTakeReturnPhotos(record({ addenda: parts(MAX_ADDENDA - 1) }))).toBe(true)
    expect(canTakeReturnPhotos(record({ addenda: parts(MAX_ADDENDA) }))).toBe(false)
    const many = Array.from({ length: 46 }, (_, i) => ref('car', '0', { sha256: i.toString(16).padStart(64, '0') }))
    expect(canTakeReturnPhotos(record({ photos: many.slice(0, 45) }))).toBe(true)
    expect(canTakeReturnPhotos(record({ photos: many }))).toBe(false)
  })
})

describe('signed photos and references', () => {
  it('recordHasSignedPhoto needs a photo hash inside a stored signature', () => {
    expect(recordHasSignedPhoto(record({ photos: [ref('sign', 'a')] }))).toBe(false)
    expect(recordHasSignedPhoto(record({ signature: bundle({ schema: 'parkproof-evidence-v1', sign_photo_sha256: null }) }))).toBe(false)
    expect(recordHasSignedPhoto(record({ signature: bundle({ schema: 'parkproof-evidence-v1', car_photo_sha256: h('a') }) }))).toBe(true)
    const photo = ref('condition-left', 'b')
    expect(
      recordHasSignedPhoto(record({ addenda: [addendum('condition', 1, {}, { bundle: bundle({ data: { photos: [photo] } }) })] })),
    ).toBe(true)
  })

  it('referencedPhotoHashes covers refs, link-0 hashes and every photo in a part', () => {
    const s = record({
      photos: [ref('car', '1')],
      v1_hashes: { sign: h('2'), car: h('1'), ambient: null },
      addenda: [
        addendum('departure', 1, { return_photos: [ref('return-front', '3')] }),
        addendum('compliance', 2, { photo: ref('compliance', '4') }),
      ],
    })
    expect([...referencedPhotoHashes(s)].sort()).toEqual([h('1'), h('2'), h('3'), h('4')])
  })
})
