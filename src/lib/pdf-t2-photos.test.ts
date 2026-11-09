// @vitest-environment happy-dom
//
// The PDF's condition and proof photos (build spec T2, item 8): the rows
// sessionRows adds (what the proof photo shows, as the driver described
// it; the condition photo counts; the driver's damage notes in their own
// words, marked when not signed yet), addImageGrid laying photos out inside
// the x and width it is given, the condition photos when parked and on
// return side by side by angle, the proof photo straight after the sign
// photo, and the appendix's photo re-hash step pointing at the evidence
// file, with the Windows alternative (certutil).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))
vi.mock('./sync', () => ({ materializePhotoFromCloud: vi.fn(async () => null) }))

type TextCall = { value: string; x: number; y: number; page: number }
type ImageCall = { src: string; x: number; y: number; w: number; h: number; page: number }

// Every text and image drawn, with its position and page, and no real download.
const { texts, images, docs } = vi.hoisted(() => ({
  texts: [] as TextCall[],
  images: [] as ImageCall[],
  docs: [] as unknown[],
}))
vi.mock('jspdf', async (importOriginal) => {
  const mod = await importOriginal<typeof import('jspdf')>()
  type Doc = InstanceType<typeof mod.jsPDF>
  function Recording(...args: ConstructorParameters<typeof mod.jsPDF>): Doc {
    const doc = new mod.jsPDF(...args)
    const page = () => doc.getCurrentPageInfo().pageNumber
    const realText = doc.text.bind(doc) as (...a: unknown[]) => Doc
    ;(doc as unknown as { text: (...a: unknown[]) => Doc }).text = (...a: unknown[]) => {
      const value = a[0]
      for (const v of Array.isArray(value) ? (value as string[]) : [String(value)]) {
        texts.push({ value: v, x: a[1] as number, y: a[2] as number, page: page() })
      }
      return realText(...a)
    }
    const realImage = doc.addImage.bind(doc) as (...a: unknown[]) => Doc
    ;(doc as unknown as { addImage: (...a: unknown[]) => Doc }).addImage = (...a: unknown[]) => {
      images.push({ src: a[0] as string, x: a[2] as number, y: a[3] as number, w: a[4] as number, h: a[5] as number, page: page() })
      return realImage(...a)
    }
    ;(doc as unknown as { save: () => Doc }).save = () => doc
    docs.push(doc)
    return doc
  }
  Recording.API = mod.jsPDF.API
  return { ...mod, jsPDF: Recording, default: Recording }
})

import { jsPDF } from 'jspdf'
import i18n from './i18n'
import type { ParkingSession, PhotoRef, SignatureBundle, SignedAddendum } from '../types'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from './photo-store'
import {
  addImageGrid,
  downloadPdf,
  evidenceRows,
  materializeRemotePhotos,
  missingPhotoMarker,
  pairConditionPhotos,
  sessionRows,
} from './pdf'
import { evidencePhotos } from './evidence-photos'

const ID = '3c59dc04-8e4f-4c2a-9b1d-2f6e7a8b9c0d'
const MARGIN = 40
const A4_WIDTH = 595.28
const CONTENT = A4_WIDTH - 2 * MARGIN
const tz = 'Australia/Melbourne'
const t = i18n.t.bind(i18n)

// A valid 1x1 JPEG; trailing bytes make each copy a different photo (content-addressed).
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
function jpeg(n: number): string {
  const base = Uint8Array.from(atob(JPEG_B64), (c) => c.charCodeAt(0))
  const bytes = new Uint8Array(base.length + 1)
  bytes.set(base)
  bytes[base.length] = n
  return 'data:image/jpeg;base64,' + btoa(String.fromCharCode(...bytes))
}

const ref = (role: PhotoRef['role'], sha256: string, source: PhotoRef['source'] = 'camera_input'): PhotoRef => ({
  role,
  sha256,
  captured_at: '2026-11-08T01:02:00.000Z',
  source,
})

function signedAddendum(id: string, seq: number, kind: SignedAddendum['kind'], data: Record<string, unknown>): SignedAddendum {
  const payload = { schema: 'parkproof-addendum-v1', addendum_id: id, kind, session_id: ID, seq, signed_at: `2026-11-08T01:0${seq}:30.000Z`, data }
  const bundle: SignatureBundle = {
    schema: 'parkproof-addendum-v1',
    signed_at: payload.signed_at,
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify(payload),
    signature_base64: `MEUCIQ-${id}`,
  }
  return { id, seq, kind, captured_at: '2026-11-08T01:02:00.000Z', data, bundle }
}

function pending(id: string, seq: number, kind: SignedAddendum['kind'], data: Record<string, unknown>, rejected = false): SignedAddendum {
  return {
    id,
    seq,
    kind,
    captured_at: '2026-11-08T01:02:00.000Z',
    data,
    ...(rejected ? { rejected: { code: 'ERR_BAD_STRING', at: '2026-11-08T01:03:00.000Z' } } : {}),
  }
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: ID,
    arrived_at: '2026-11-08T01:00:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: '2026-11-08T03:00:00.000Z',
    confidence: 'high',
    ...overrides,
  }
}

const H = (c: string) => c.repeat(64)
const rowValue = (rows: [string, string][], label: string) => rows.find(([l]) => l === label)?.[1]

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  texts.length = 0
  images.length = 0
  docs.length = 0
  setPhotoBackendForTests(createMemoryPhotoBackend())
})
afterEach(() => {
  setPhotoBackendForTests(null)
  localStorage.clear()
})

describe('the T2 rows in sessionRows', () => {
  it('a record without condition or proof photos gets no new rows', () => {
    const s = record()
    expect(evidenceRows(s, t)).toEqual([])
    expect(sessionRows(s, tz, t).map(([label]) => label)).not.toContain('Proof of payment or permit')
  })

  it('the proof row is the driver\'s description, from the signed part', () => {
    const photo = ref('compliance', H('c'))
    const s = record({
      photos: [photo],
      compliance_type: 'other', // the record's own field loses to the signed value
      addenda: [signedAddendum('a-1', 1, 'compliance', { compliance_type: 'meter_ticket', photo })],
    })
    const rows = sessionRows(s, tz, t)
    expect(rowValue(rows, 'Proof of payment or permit')).toBe('Meter ticket on the dash (as the driver described it)')
  })

  it('says when the proof part isn\'t signed yet, or couldn\'t be signed', () => {
    const photo = ref('compliance', H('c'))
    const waiting = record({ photos: [photo], addenda: [pending('a-1', 1, 'compliance', { compliance_type: 'permit_displayed', photo })] })
    expect(rowValue(evidenceRows(waiting, t), 'Proof of payment or permit')).toBe('Permit displayed (as the driver described it) (not signed yet)')
    const refused = record({ photos: [photo], addenda: [pending('a-1', 1, 'compliance', { compliance_type: 'permit_displayed', photo }, true)] })
    expect(rowValue(evidenceRows(refused, t), 'Proof of payment or permit')).toBe(
      "Permit displayed (as the driver described it) (this part couldn't be signed)",
    )
  })

  it('counts the condition photos when parked and on return', () => {
    const s = record({
      photos: [ref('condition-front', H('1')), ref('condition-rear', H('2')), ref('return-front', H('3'))],
    })
    expect(rowValue(evidenceRows(s, t), 'Car condition photos')).toBe('When parked: 2. On return: 1.')
  })

  it('gives the damage notes as the driver\'s own words, marking the one not signed yet', () => {
    const front = ref('condition-front', H('1'))
    const back = ref('return-rear', H('2'))
    const s = record({
      photos: [front, back],
      addenda: [
        signedAddendum('a-1', 1, 'condition', { when: 'parking', photos: [front], note: 'Scratch on the bumper' }),
        pending('a-2', 2, 'condition', { when: 'return', photos: [back], note: 'Dent in the door' }),
      ],
    })
    expect(rowValue(evidenceRows(s, t), 'Damage the driver noted')).toBe(
      "When parked, in the driver's own words: Scratch on the bumper\nOn return, in the driver's own words: Dent in the door (not signed yet)",
    )
  })

  it('a note in a refused part says so (never "not signed yet"); one no part carries says "not signed"', () => {
    const back = ref('return-rear', H('2'))
    const refused = record({
      photos: [back],
      addenda: [pending('a-2', 1, 'condition', { when: 'return', photos: [back], note: 'Dent in the door' }, true)],
    })
    expect(rowValue(evidenceRows(refused, t), 'Damage the driver noted')).toBe(
      "On return, in the driver's own words: Dent in the door (this part couldn't be signed)",
    )
    const onlyOnRecord = record({ condition_note: 'Scratch on the bumper' })
    expect(rowValue(evidenceRows(onlyOnRecord, t), 'Damage the driver noted')).toBe(
      "When parked, in the driver's own words: Scratch on the bumper (not signed)",
    )
  })
})

describe('pairConditionPhotos', () => {
  it('pairs the photos when parked and on return by angle, in grid order', () => {
    const p = (role: PhotoRef['role'], id: string) => ({ ref: ref(role, H(id)) })
    const parking = [p('condition-front', '1'), p('condition-rear', '2'), p('condition-left', '3')]
    const returned = [p('return-front', '4'), p('return-right', '5'), p('return-front', '6')]
    const rows = pairConditionPhotos(parking, returned).map(([l, r]) => [l?.ref.sha256[0] ?? '-', r?.ref.sha256[0] ?? '-'])
    expect(rows).toEqual([
      ['1', '4'],
      ['-', '6'],
      ['2', '-'],
      ['3', '-'],
      ['-', '5'],
    ])
  })
})

describe('addImageGrid', () => {
  const doc = () => new jsPDF({ unit: 'pt', format: 'a4' })
  const cell = (n: number, label = `Photo ${n}`) => ({ src: jpeg(n), caption: [label], fingerprint: H(String(n)) })

  it('lays the cells out inside the x and width it is given, columns left to right', () => {
    const d = doc()
    const y = addImageGrid(d, [cell(1), cell(2), cell(3)], 100, { x: 100, width: 300, columns: 2, cellMaxHeight: 120, font: 'helvetica', t })
    expect(images).toHaveLength(3)
    const cellW = (300 - 12) / 2
    expect(images.map((i) => i.x)).toEqual([100, 100 + cellW + 12, 100])
    for (const image of images) {
      expect(image.x).toBeGreaterThanOrEqual(100)
      expect(image.x + image.w).toBeLessThanOrEqual(400 + 0.001)
      expect(image.w).toBeLessThanOrEqual(cellW + 0.001)
    }
    // The second row starts below the first row's photo and caption.
    expect(images[2].y).toBeGreaterThan(images[0].y + images[0].h)
    expect(y).toBeGreaterThan(images[2].y + images[2].h)
    // Each photo's full fingerprint is printed under it, in its own column (wrapped in a narrow one).
    const column = texts
      .filter((c) => c.x === 100 && c.y > images[0].y && c.y < images[2].y)
      .map((c) => c.value)
      .join('')
    expect(column.replace(/\s/g, '')).toContain(`SHA-256${H('1')}`)
  })

  it('leaves a null cell empty, keeping the other column in place', () => {
    addImageGrid(doc(), [cell(1), null, null, cell(2)], 60, { x: 40, width: 500, columns: 2, cellMaxHeight: 100, font: 'helvetica', t })
    const cellW = (500 - 12) / 2
    expect(images.map((i) => i.x)).toEqual([40, 40 + cellW + 12])
    expect(images[1].y).toBeGreaterThan(images[0].y)
  })

  it('draws a missing photo as the "not on this device" line with its full fingerprint, and no image', () => {
    addImageGrid(doc(), [{ src: missingPhotoMarker(H('a'), true), caption: ['Front'], fingerprint: H('a') }], 60, {
      x: 40,
      width: 500,
      columns: 2,
      cellMaxHeight: 100,
      font: 'helvetica',
      t,
    })
    expect(images).toEqual([])
    const all = texts.map((c) => c.value).join(' ')
    expect(all).toContain('Photo not on the device that made this PDF')
    expect(all).toContain(H('a').slice(0, 20))
    // Not printed a second time as the fingerprint line.
    expect(texts.some((c) => c.value.startsWith('SHA-256 '))).toBe(false)
  })

  it('never splits a row across pages, and keeps the title and column headings with it', () => {
    const d = doc()
    const bottom = d.internal.pageSize.getHeight() - MARGIN
    addImageGrid(d, [cell(1), cell(2)], bottom - 40, {
      x: 40,
      width: 500,
      columns: 2,
      cellMaxHeight: 150,
      font: 'helvetica',
      t,
      title: 'Car condition photos',
      headings: ['When parked', 'On return'],
    })
    expect(images.map((i) => i.page)).toEqual([2, 2])
    for (const label of ['Car condition photos', 'When parked', 'On return']) {
      expect(texts.find((c) => c.value === label)?.page).toBe(2)
    }
  })
})

describe('the evidence PDF', () => {
  async function t2Record(): Promise<ParkingSession> {
    const sign = ref('sign', await putPhoto(ID, jpeg(1)))
    const car = ref('car', await putPhoto(ID, jpeg(2)))
    const front = ref('condition-front', await putPhoto(ID, jpeg(3)))
    const rear = ref('condition-rear', await putPhoto(ID, jpeg(4)), 'library')
    const backFront = ref('return-front', await putPhoto(ID, jpeg(5)))
    const ticket = ref('compliance', await putPhoto(ID, jpeg(6)))
    return record({
      photos: [sign, car, front, rear, backFront, ticket],
      addenda: [
        signedAddendum('a-1', 1, 'condition', { when: 'parking', photos: [front, rear], note: null }),
        pending('a-2', 2, 'compliance', { compliance_type: 'meter_ticket', photo: ticket }),
        pending('a-3', 3, 'departure', { ended_at: '2026-11-08T02:00:00.000Z', location: null, distance_from_arrival_m: null, return_photos: [backFront] }),
      ],
      ended_at: '2026-11-08T02:00:00.000Z',
    })
  }

  it('draws the proof photo after the sign photo and the condition photos side by side after the car photo', async () => {
    const s = await t2Record()
    const copy = await materializeRemotePhotos(s)
    downloadPdf(copy, t, 'en')
    // The section headings, after the table (which has rows with the same labels).
    const after = (label: string, from: number) => texts.findIndex((c, i) => i > from && c.value === label)
    const sign = after('Sign photo', -1)
    const proof = after('Proof of payment or permit', sign)
    const car = after('Car at the spot', proof)
    const condition = after('Car condition photos', car)
    expect(sign).toBeGreaterThan(-1)
    expect(proof).toBeGreaterThan(sign)
    expect(car).toBeGreaterThan(proof)
    expect(condition).toBeGreaterThan(car)
    expect(after('When parked', condition)).toBeGreaterThan(condition)
    expect(after('On return', condition)).toBeGreaterThan(condition)
    // In a half-page cell the full fingerprint fits on one line.
    const frontSha = s.photos!.find((r) => r.role === 'condition-front')!.sha256
    expect(texts.some((c) => c.value === `SHA-256 ${frontSha}`)).toBe(true)

    // Side by side: the front photo when parked on the left, on return on the right, in one row.
    const left = images.find((i) => i.src === jpeg(3))!
    const right = images.find((i) => i.src === jpeg(5))!
    expect(left.x).toBe(MARGIN)
    expect(right.x).toBeGreaterThan(MARGIN + CONTENT / 2)
    expect(right.y).toBe(left.y)
    expect(right.page).toBe(left.page)
    // The rear photo has no return partner: it starts the next row, on the left (on this page or the next).
    const rear = images.find((i) => i.src === jpeg(4))!
    expect(rear.x).toBe(MARGIN)
    expect(rear.page > left.page || (rear.page === left.page && rear.y > left.y)).toBe(true)
  })

  it('labels each photo with its phone-clock time, where its fingerprint stands, and the library line', async () => {
    downloadPdf(await materializeRemotePhotos(await t2Record()), t, 'en')
    // Captions wrap at spaces, so joining with spaces gives each sentence back.
    const all = texts.map((c) => c.value).join(' ')
    expect(all).toContain('Added Sun 8 Nov 2026, 12:02 pm AEDT (phone clock)')
    expect(all).toContain('Fingerprint signed by ParkProof at Sun 8 Nov 2026, 12:01 pm AEDT (server clock)')
    expect(all).toContain('Fingerprint not signed yet')
    expect(all).toContain('Added from the photo library.')
    expect(all).toContain('Meter ticket on the dash (as the driver described it)')
    expect(all).toContain("A signed photo shows the photo existed by the time it was signed. It doesn't show who caused any damage.")
  })

  it('a condition photo whose bytes aren\'t on the device is the missing line with its fingerprint', async () => {
    const front = ref('condition-front', H('d'))
    const s = record({ photos: [front], addenda: [signedAddendum('a-1', 1, 'condition', { when: 'parking', photos: [front], note: null })] })
    downloadPdf(await materializeRemotePhotos(s), t, 'en')
    const all = texts.map((c) => c.value).join(' ')
    expect(all).toContain('Photo not on the device that made this PDF. Its signed SHA-256')
    expect(images).toEqual([])
  })

  it('materialises the condition and proof photos for the PDF copy only', async () => {
    const s = await t2Record()
    expect(evidencePhotos(s)).toHaveLength(4)
    const copy = await materializeRemotePhotos(s)
    expect(copy).not.toBe(s)
    downloadPdf(s, t, 'en') // the stored record itself: no bytes were put on it
    expect(images.some((i) => i.src === jpeg(3))).toBe(false)
    images.length = 0
    downloadPdf(copy, t, 'en')
    expect(images.some((i) => i.src === jpeg(3))).toBe(true)
  })
})

describe('the appendix\'s photo and Windows steps', () => {
  it('re-hashes an original from the evidence file, and gives certutil for cmd and PowerShell', () => {
    const link0: SignatureBundle = {
      schema: 'parkproof-evidence-v2',
      signed_at: '2026-11-08T01:00:04.000Z',
      algorithm: 'ECDSA_SHA_256',
      key_alias: 'alias/parkproof-evidence-signing',
      canonical_payload: JSON.stringify({ schema: 'parkproof-evidence-v2', session_id: ID, signed_at: '2026-11-08T01:00:04.000Z' }),
      signature_base64: 'MEUCIQ-link0',
    }
    downloadPdf(record({ signature: link0 }), t, 'en')
    const lines = texts.map((c) => c.value.trim())
    const all = texts.map((c) => c.value).join(' ')
    expect(all).toContain('evidence file')
    expect(all).toContain('bytes_base64')
    expect(lines).toContain('base64 -d photo1.b64 > photo1.jpg')
    expect(lines).toContain('openssl dgst -sha256 photo1.jpg')
    expect(all).toContain('not just the sha256 next to it in the evidence file')
    expect(lines).toContain('certutil -decode link0-payload.b64 link0-payload.txt')
    expect(lines).toContain('certutil -decode link0-sig.b64 link0-sig.bin')
    expect(lines).toContain('certutil -hashfile photo1.jpg SHA256')
    expect(all).toContain('curl.exe')
    // The photo step comes after the openssl verify, and the Windows note after it.
    const verify = lines.indexOf('openssl dgst -sha256 -verify parkproof-public-key.pem \\')
    expect(verify).toBeGreaterThan(-1)
    expect(lines.indexOf('base64 -d photo1.b64 > photo1.jpg')).toBeGreaterThan(verify)
    expect(lines.indexOf('certutil -hashfile photo1.jpg SHA256')).toBeGreaterThan(lines.indexOf('openssl dgst -sha256 photo1.jpg'))
  })
})
