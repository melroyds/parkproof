// @vitest-environment happy-dom
//
// PDF materialisation reads photos through the photo store (T0b2): a new
// record's photos come from IndexedDB onto the in-flight PDF copy, and a
// photo whose bytes aren't on this device is drawn as the one "not on
// this device" line with its full SHA-256 fingerprint (signed only when a
// stored signature contains it), never as a blank. A signed-in user's
// cloud copy stands in for missing bytes when it hashes to the ref.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The cloud copy lookup (the real one is tested in sync-photos.test.ts).
const { materializeRefPhotoFromCloud } = vi.hoisted(() => ({
  materializeRefPhotoFromCloud: vi.fn(async (): Promise<string | null> => null),
}))
vi.mock('./sync', () => ({ materializeRefPhotoFromCloud }))

// Every string drawn into a PDF, and no real download.
const { drawn } = vi.hoisted(() => ({ drawn: [] as string[] }))
vi.mock('jspdf', async (importOriginal) => {
  const mod = await importOriginal<typeof import('jspdf')>()
  type Doc = InstanceType<typeof mod.jsPDF>
  function Recording(...args: ConstructorParameters<typeof mod.jsPDF>): Doc {
    const doc = new mod.jsPDF(...args)
    const realText = doc.text.bind(doc) as (...a: unknown[]) => Doc
    ;(doc as unknown as { text: (...a: unknown[]) => Doc }).text = (...a: unknown[]) => {
      const value = a[0]
      drawn.push(...(Array.isArray(value) ? (value as string[]) : [String(value)]))
      return realText(...a)
    }
    ;(doc as unknown as { save: () => Doc }).save = () => doc
    return doc
  }
  Recording.API = mod.jsPDF.API
  return { ...mod, jsPDF: Recording, default: Recording }
})
import i18n from './i18n'
import type { ParkingSession, PhotoRef, SignatureBundle } from '../types'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from './photo-store'
import {
  downloadPdf,
  materializeRemotePhotos,
  missingPhotoMarker,
  missingPhotoText,
  parseMissingPhotoMarker,
} from './pdf'

const ID = '5c4b3a29-1807-4f6e-9d5c-4b3a29180716'
const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)
const ref = (role: PhotoRef['role'], sha256: string): PhotoRef => ({
  role,
  sha256,
  captured_at: '2026-10-20T00:59:00.000Z',
  source: 'camera_input',
})

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: ID,
    arrived_at: '2026-10-20T01:00:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: '2026-10-20T03:00:00.000Z',
    confidence: 'high',
    ...overrides,
  }
}

function link0(payload: Record<string, unknown>): SignatureBundle {
  return {
    schema: 'parkproof-evidence-v2',
    signed_at: '2026-10-20T01:00:04.000Z',
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify({ schema: 'parkproof-evidence-v2', ...payload }),
    signature_base64: 'MEUCIQ',
  }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  setPhotoBackendForTests(createMemoryPhotoBackend())
  materializeRefPhotoFromCloud.mockReset()
  materializeRefPhotoFromCloud.mockImplementation(async () => null)
})
afterEach(() => setPhotoBackendForTests(null))

describe('materializeRemotePhotos and the photo store', () => {
  it('puts a new record\'s photo-store photos on the PDF copy (the record itself is untouched)', async () => {
    const sign = jpeg('pdf-sign')
    const car = jpeg('pdf-car')
    const s = record({ photos: [ref('sign', await putPhoto(ID, sign)), ref('car', await putPhoto(ID, car))] })
    const out = await materializeRemotePhotos(s)
    expect(out.sign_photo).toBe(sign)
    expect(out.car_photo).toBe(car)
    expect(out.ambient_photo).toBeUndefined()
    expect(s.sign_photo).toBeNull()
  })

  it('a photo whose bytes are missing becomes a marker, signed when link 0 signs its hash', async () => {
    const signed = 'a'.repeat(64)
    const unsigned = 'b'.repeat(64)
    const s = record({
      photos: [ref('sign', signed), ref('car', unsigned)],
      signature: link0({ sign_photo_sha256: signed, car_photo_sha256: null, ambient_photo_sha256: null }),
    })
    const out = await materializeRemotePhotos(s)
    expect(parseMissingPhotoMarker(out.sign_photo!)).toEqual({ sha256: signed, signed: true })
    expect(parseMissingPhotoMarker(out.car_photo!)).toEqual({ sha256: unsigned, signed: false })
  })

  it('an old record keeps its legacy data URLs as they are', async () => {
    const s = record({ sign_photo: jpeg('legacy') })
    const out = await materializeRemotePhotos(s)
    expect(out.sign_photo).toBe(jpeg('legacy'))
    expect(out.car_photo).toBeNull()
    expect(materializeRefPhotoFromCloud).not.toHaveBeenCalled()
  })

  it('missing bytes: the cloud copy is used when it matches the ref (looked up by role and sha256)', async () => {
    const sha = 'e'.repeat(64)
    materializeRefPhotoFromCloud.mockImplementation(async () => jpeg('from-cloud'))
    const out = await materializeRemotePhotos(record({ photos: [ref('sign', sha)] }))
    expect(out.sign_photo).toBe(jpeg('from-cloud'))
    expect(materializeRefPhotoFromCloud).toHaveBeenCalledWith(ID, 'sign', sha)
  })

  it('a ref shown from a cloud URL (put there by the first sync) embeds only bytes that match the ref', async () => {
    const sha = 'f'.repeat(64)
    const s = record({ sign_photo: 'https://cdn.test/sign.jpg', photos: [ref('sign', sha)] })
    const out = await materializeRemotePhotos(s)
    expect(materializeRefPhotoFromCloud).toHaveBeenCalledWith(ID, 'sign', sha)
    expect(parseMissingPhotoMarker(out.sign_photo!)).toEqual({ sha256: sha, signed: false })
  })
})

describe('the missing-photo marker and line', () => {
  it('round-trips and rejects other strings', () => {
    expect(parseMissingPhotoMarker(missingPhotoMarker('c'.repeat(64), true))).toEqual({ sha256: 'c'.repeat(64), signed: true })
    expect(parseMissingPhotoMarker(jpeg('x'))).toBeNull()
    expect(parseMissingPhotoMarker('parkproof-missing-photo:maybe:abc')).toBeNull()
  })

  it('gives the full SHA-256 (matchable against the signature appendix), signed only when it is', () => {
    const sha = '3f9a' + '0'.repeat(56) + 'c21b'
    expect(missingPhotoText({ sha256: sha, signed: true }, i18n.t)).toBe(
      `Photo not on the device that made this PDF. Its signed SHA-256 fingerprint is ${sha}.`,
    )
    expect(missingPhotoText({ sha256: sha, signed: false }, i18n.t)).toBe(
      `Photo not on the device that made this PDF. Its SHA-256 fingerprint is ${sha}. Not signed yet.`,
    )
  })

  it('downloadPdf draws the line in place of the photo instead of failing', async () => {
    const sha = 'd'.repeat(64)
    const s = await materializeRemotePhotos(record({ photos: [ref('sign', sha)] }))
    drawn.length = 0
    downloadPdf(s, i18n.t, 'en')
    const text = drawn.join('')
    expect(text).toContain('Photo not on the device that made this PDF.')
    expect(text).toContain(sha)
    expect(text).not.toContain(i18n.t('pdf.common.imageEmbedFailed'))
  })

  it('no surroundings caption under the missing-photo line; the caption stays under a photo', async () => {
    const caption = i18n.t('pdf.evidence.ambientPhotoCaption')
    const missing = await materializeRemotePhotos(
      record({ no_sign: true, rules: '', expires_at: null, photos: [ref('ambient', 'c'.repeat(64))] }),
    )
    drawn.length = 0
    downloadPdf(missing, i18n.t, 'en')
    expect(drawn.join('')).toContain('Photo not on the device that made this PDF.')
    expect(drawn.join(' ')).not.toContain(caption)

    drawn.length = 0
    downloadPdf(record({ no_sign: true, rules: '', expires_at: null, ambient_photo: jpeg('surroundings') }), i18n.t, 'en')
    expect(drawn.join(' ')).toContain(caption)
  })
})
