// @vitest-environment happy-dom
//
// The evidence file (build spec T2, item 9). On a chain signed by the REAL
// Lambda handler (a local test key): every signed link is in the file with
// its exact payload bytes and its signature, which verifies; re-hashing
// each bundled photo's bytes gives the fingerprint a signed payload
// carries, at the field the file names; each link's parent is the link
// whose payload hash it signed. The chain key is never in the file, and
// the permit details (N3) are only in it when the driver ticks "Include
// permit details", in a form a reader can check against the signed
// permit_commitment. Bytes that aren't on the device, or don't match the
// signed fingerprint, are never offered as the photo.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

import type { ParkingSession, PermitContext, PhotoRef } from '../types'
import { emptyLogDraft } from './evidence-chain'
import {
  EVIDENCE_FILE_FORMAT,
  buildEvidenceFile,
  collectEvidenceFile,
  evidenceFileJson,
  evidenceFileName,
  hasEvidenceFile,
  hasPermitDetails,
  signedPhotoHashes,
  type EvidenceFile,
} from './evidence-bundle'
import { sha256HexBytes } from './hash'
import { createMemoryPhotoBackend, deletePhotos, putPhoto, setPhotoBackendForTests } from './photo-store'
import { addCompliancePhoto, addConditionPhotos } from './record-photos'
import { permitCommitment, prepareNewRecord, resetSigningQueueForTests, signNewRecord, whenSigningIdle } from './signing'
import { getSession, saveSession } from './storage'
import { verifySignature } from './verify'
import { createTestSigner, type TestSigner } from './test-support/test-signer'

const ID = '8f14e45f-ceea-467a-9575-1a2b3c4d5e6f'
const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)
const PERMIT: PermitContext = {
  type: 'resident',
  area: 'Area 25',
  holder_present: null,
  sign_exception_applies: true,
  standard_until: null,
  permit_until: null,
  note: null,
}
const SALT = 'a1'.repeat(16)

function ref(role: PhotoRef['role'], sha256: string, source: PhotoRef['source'] = 'camera_input'): PhotoRef {
  return { role, sha256, captured_at: new Date(Date.now() - 60_000).toISOString(), source }
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: ID,
    arrived_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    ...overrides,
  }
}

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const payloadOf = (file: EvidenceFile, name: string) =>
  JSON.parse(file.links.find((l) => l.name === name)!.canonical_payload) as Record<string, unknown>

/** The value a `signed_in.field` points at inside a payload, as a list of photo hashes. */
function hashesAt(payload: Record<string, unknown>, field: string): string[] {
  if (!field.startsWith('data.')) return [payload[field] as string]
  const value = (payload.data as Record<string, unknown>)[field.slice('data.'.length)]
  return (Array.isArray(value) ? value : [value]).map((p) => (p as { sha256: string }).sha256)
}

let signer: TestSigner

/** A record with sign and car photos, signed links 0 and 1, a condition part and a proof part. */
async function signedRecord(options: { permit?: boolean } = {}): Promise<ParkingSession> {
  const sign = await putPhoto(ID, jpeg('sign-bytes'))
  const car = await putPhoto(ID, jpeg('car-bytes'))
  const prepared = await prepareNewRecord(
    record({
      photos: [ref('sign', sign), ref('car', car)],
      ...(options.permit ? { permit_context: PERMIT, permit_salt: SALT } : {}),
    }),
  )
  saveSession(prepared)
  signNewRecord(ID, emptyLogDraft(), options.permit ? { permit_commitment: await permitCommitment(SALT, PERMIT) } : {})
  await whenSigningIdle(ID)
  const front = await putPhoto(ID, jpeg('front-bytes'))
  const rear = await putPhoto(ID, jpeg('rear-bytes'))
  expect(addConditionPhotos(ID, 'parking', [ref('condition-front', front), ref('condition-rear', rear, 'library')], 'Scratch on the bumper')).not.toBeNull()
  await whenSigningIdle(ID)
  const ticket = await putPhoto(ID, jpeg('ticket-bytes'))
  expect(addCompliancePhoto(ID, 'meter_ticket', ref('compliance', ticket))).not.toBeNull()
  await whenSigningIdle(ID)
  return getSession(ID)!
}

beforeAll(async () => {
  signer = await createTestSigner()
})
beforeEach(() => {
  localStorage.clear()
  resetSigningQueueForTests()
  setPhotoBackendForTests(createMemoryPhotoBackend())
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  vi.stubGlobal('fetch', vi.fn(signer.fetch))
})
afterEach(async () => {
  await whenSigningIdle()
  setPhotoBackendForTests(null)
  resetSigningQueueForTests()
  vi.unstubAllGlobals()
})

describe('the evidence file on a chain signed by the real Lambda handler', () => {
  it('carries every signed link exactly as signed, and each signature verifies', async () => {
    const session = await signedRecord()
    const file = await collectEvidenceFile(session, { includePermit: false, now: Date.parse('2026-11-09T01:00:00.000Z') })

    expect(file.format).toBe(EVIDENCE_FILE_FORMAT)
    expect(file.record_id).toBe(ID)
    expect(file.made_at_phone_clock).toBe('2026-11-09T01:00:00.000Z')
    expect(file.public_key_url).toBe('https://www.parkproof.com.au/parkproof-public-key.pem')
    expect(file.links.map((l) => `${l.name}:${l.kind}`)).toEqual(['0:arrival', '1:arrival_context', '2:condition', '3:compliance'])
    expect(file.parts_not_signed).toEqual([])

    const stored = [session.signature!, ...session.addenda!.map((a) => a.bundle!)]
    for (const link of file.links) {
      // The base64 decodes to the exact signed bytes (what base64 -d and certutil -decode give a reader).
      expect(new TextDecoder().decode(b64ToBytes(link.canonical_payload_base64))).toBe(link.canonical_payload)
      expect(stored.some((b) => b.canonical_payload === link.canonical_payload && b.signature_base64 === link.signature_base64)).toBe(true)
      expect(await verifySignature([signer.publicKey], link.canonical_payload, link.signature_base64)).toBe(true)
    }
  })

  it('names each link\'s parent: the SHA-256 of the parent\'s payload bytes is its parent_payload_sha256', async () => {
    const file = await collectEvidenceFile(await signedRecord(), { includePermit: false })
    for (const link of file.links.slice(1)) {
      expect(link.parents).toHaveLength(1)
      const parent = file.links.find((l) => l.name === link.parents[0])!
      expect(parent.seq).toBe(link.seq - 1)
      const parentHash = await sha256HexBytes(b64ToBytes(parent.canonical_payload_base64))
      expect(JSON.parse(link.canonical_payload).parent_payload_sha256).toBe(parentHash)
    }
  })

  it('re-hashing each bundled photo gives the fingerprint the signed payload carries', async () => {
    const file = await collectEvidenceFile(await signedRecord(), { includePermit: false })
    // Sign, car, the two condition photos and the meter ticket, each listed once.
    expect(file.photos.map((p) => p.role).sort()).toEqual(['car', 'compliance', 'condition-front', 'condition-rear', 'sign'])
    for (const photo of file.photos) {
      expect(photo.bytes).toBe('included')
      expect(photo.media_type).toBe('image/jpeg')
      expect(await sha256HexBytes(b64ToBytes(photo.bytes_base64!))).toBe(photo.sha256)
      expect(photo.signed_in.length).toBeGreaterThan(0)
      for (const where of photo.signed_in) {
        expect(hashesAt(payloadOf(file, where.link), where.field)).toContain(photo.sha256)
      }
    }
    // Link 0 signs the sign and car photos by their own fields.
    const sign = file.photos.find((p) => p.role === 'sign')!
    expect(sign.signed_in).toContainEqual({ link: '0', field: 'sign_photo_sha256' })
    const ticket = file.photos.find((p) => p.role === 'compliance')!
    expect(ticket.signed_in).toEqual([{ link: '3', field: 'data.photo' }])
    const front = file.photos.find((p) => p.role === 'condition-front')!
    expect(front.signed_in).toEqual([{ link: '2', field: 'data.photos' }])
  })

  it('every photo fingerprint in a signed payload is in the file', async () => {
    const session = await signedRecord()
    const file = await collectEvidenceFile(session, { includePermit: false })
    const listed = new Set(file.photos.map((p) => p.sha256))
    for (const { sha256 } of signedPhotoHashes(session)) expect(listed.has(sha256)).toBe(true)
    expect(listed.size).toBe(signedPhotoHashes(session).length)
  })

  it('never carries the chain key, only the hash link 0 signed', async () => {
    const session = await signedRecord()
    expect(session.chain_key).toMatch(/^[0-9a-f]{64}$/)
    const text = evidenceFileJson(await collectEvidenceFile(session, { includePermit: true }))
    expect(text).not.toContain(session.chain_key!)
    expect(text).toContain('chain_key_sha256')
  })
})

describe('permit details (N3)', () => {
  it('are left out unless the driver ticks "Include permit details"', async () => {
    const session = await signedRecord({ permit: true })
    expect(hasPermitDetails(session)).toBe(true)
    const file = await collectEvidenceFile(session, { includePermit: false })
    expect(file.permit).toBeNull()
    const text = evidenceFileJson(file)
    expect(text).not.toContain(SALT)
    expect(text).not.toContain('Area 25')
    expect(text).not.toContain('resident')
    // The signed details carry only the commitment.
    expect((payloadOf(file, '1').data as Record<string, unknown>).permit_commitment).toMatch(/^[0-9a-f]{64}$/)
  })

  it('when ticked, the file reveals them in a form that hashes to the signed permit_commitment', async () => {
    const session = await signedRecord({ permit: true })
    const file = await collectEvidenceFile(session, { includePermit: true })
    expect(file.permit).not.toBeNull()
    expect(file.permit!.permit_context).toEqual(PERMIT)
    expect(file.permit!.permit_salt).toBe(SALT)
    expect(file.permit!.signed_in).toBe('1')
    const signed = (payloadOf(file, '1').data as Record<string, unknown>).permit_commitment
    expect(await sha256HexBytes(new TextEncoder().encode(file.permit!.commitment_input))).toBe(signed)
  })

  it('a record without permit details has nothing to include, ticked or not', async () => {
    const session = await signedRecord()
    expect(hasPermitDetails(session)).toBe(false)
    expect((await collectEvidenceFile(session, { includePermit: true })).permit).toBeNull()
  })
})

describe('photos the device can\'t offer as signed', () => {
  it('a signed photo whose bytes aren\'t on this device keeps its fingerprint, without bytes', async () => {
    const session = await signedRecord()
    const ticket = session.photos!.find((p) => p.role === 'compliance')!
    await deletePhotos(ID, [ticket.sha256])
    const file = await collectEvidenceFile(session, { includePermit: false })
    const entry = file.photos.find((p) => p.sha256 === ticket.sha256)!
    expect(entry.bytes).toBe('not_on_this_device')
    expect(entry.bytes_base64).toBeNull()
    expect(entry.media_type).toBeNull()
    expect(entry.signed_in).toEqual([{ link: '3', field: 'data.photo' }])
  })

  it('bytes that don\'t hash to the signed fingerprint are never put in the file', async () => {
    const session = await signedRecord()
    const swapped = new TextEncoder().encode('not the signed photo')
    const file = await collectEvidenceFile(session, {
      includePermit: false,
      readBytes: async () => ({ type: 'image/jpeg', bytes: swapped }),
    })
    expect(file.photos.length).toBeGreaterThan(0)
    for (const photo of file.photos) {
      expect(photo.bytes).toBe('differ_from_fingerprint')
      expect(photo.bytes_base64).toBeNull()
    }
  })
})

describe('records with parts not signed', () => {
  it('lists unsigned parts by kind only, and has no file at all before link 0 is signed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    const sign = await putPhoto(ID, jpeg('sign-bytes'))
    const prepared = await prepareNewRecord(record({ photos: [ref('sign', sign)] }))
    saveSession(prepared)
    signNewRecord(ID, emptyLogDraft())
    await whenSigningIdle(ID)
    const session = getSession(ID)!
    expect(hasEvidenceFile(session)).toBe(false)
    const file = await buildEvidenceFile(session, { photoBytes: new Map(), includePermit: false, now: Date.now() })
    expect(file.links).toEqual([])
    expect(file.photos).toEqual([])
    expect(file.parts_not_signed).toEqual([
      { seq: 0, kind: 'arrival', state: 'pending' },
      { seq: 1, kind: 'arrival_context', state: 'pending' },
    ])
  })

  it('the file name starts with the record id', () => {
    expect(evidenceFileName(ID)).toBe('parkproof-evidence-8f14e45f.json')
  })
})
