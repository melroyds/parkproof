// @vitest-environment happy-dom
//
// The PDF's T3 rows (build spec T3 item 6), through sessionRows so all
// three PDFs get them:
// - "Sign condition": the reading's status through a key map (never the raw
//   enum), with the AI's notes. Only for records read since T3, so older
//   records keep their table shape. It is a signed fact (arrival_context,
//   link 1), so it comes from the signed payload once signed, and says
//   "Not signed yet" (or that it couldn't be signed) until then (N2).
// - A no-sign record logged from the "no readable sign" screen reads "No
//   sign read. ParkProof found no readable parking sign in the photo, and
//   the driver logged this park without one." instead of the driver saying
//   there were no signs. Its surroundings photo (the scan photo) keeps the
//   caption that attributes it to the driver and says it doesn't show there
//   was no sign nearby, and no no-sign record gets "Free to park" guidance.
import { beforeAll, describe, expect, it, vi } from 'vitest'

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
import type { ArrivalContextData, ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import type { RecordTimesContext } from './record-times'
import { DEV_KEY_ALIAS } from './evidence-chain'
import { downloadPdf, isWinAnsiText, sessionRows } from './pdf'

const TZ = 'Australia/Melbourne'
const CTX: RecordTimesContext = { now: Date.parse('2026-11-03T00:00:00.000Z'), endedHere: false, arrivalRejection: null }
const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-pdf-t3',
    arrived_at: '2026-11-02T22:00:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: '2026-11-03T00:00:00.000Z',
    confidence: 'low',
    ...overrides,
  }
}

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

/** The record's arrival_context (link 1) in a given state. */
function arrivalContext(state: 'signed' | 'dev' | 'pending' | 'rejected', data: Partial<ArrivalContextData>): SignedAddendum {
  const d: ArrivalContextData = {
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
    ...data,
  }
  const a: SignedAddendum = {
    id: 'ctx-1',
    seq: 1,
    kind: 'arrival_context',
    captured_at: '2026-11-02T22:00:01.000Z',
    data: d as unknown as Record<string, unknown>,
  }
  if (state === 'signed' || state === 'dev') {
    a.bundle = bundle(
      {
        schema: 'parkproof-addendum-v1',
        addendum_id: 'ctx-1',
        kind: 'arrival_context',
        session_id: 'rec-pdf-t3',
        seq: 1,
        signed_at: '2026-11-02T22:00:05.000Z',
        data: d,
      },
      state === 'dev' ? { key_alias: DEV_KEY_ALIAS } : {},
    )
  }
  if (state === 'rejected') a.rejected = { code: 'ERR_BAD_STRING', at: '2026-11-02T22:00:06.000Z' }
  return a
}

/** A record whose arrival_context is signed with what the record says. */
function signedRecord(overrides: Partial<ParkingSession> = {}): ParkingSession {
  const r = record(overrides)
  return { ...r, addenda: [arrivalContext('signed', { sign_status: r.sign_status ?? null, sign_issues: r.sign_issues ?? [] })] }
}

const rows = (s: ParkingSession) => sessionRows(s, TZ, i18n.t, CTX)
const cell = (s: ParkingSession, field: string) => rows(s).find(([k]) => k === field)?.[1]
const SIGN_CONDITION = () => i18n.t('pdf.evidence.field.signCondition')
const SIGN_RULES = () => i18n.t('pdf.evidence.field.signRules')

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

describe('the "Sign condition" row', () => {
  it('names each status through its key, never the raw enum', () => {
    const expected: Record<string, string> = {
      readable: 'Readable in the photo',
      partially_obscured: 'Partly hard to read in the photo',
      contradictory: 'Parts of the sign disagree',
      missing: 'No parking sign found in the photo',
      not_a_parking_sign: 'The photo shows something other than a parking sign',
    }
    for (const [status, text] of Object.entries(expected)) {
      const value = cell(signedRecord({ sign_status: status as ParkingSession['sign_status'] }), SIGN_CONDITION())
      expect(value).toBe(text)
      expect(value).not.toContain(status)
    }
  })

  it("adds the AI's notes under the condition", () => {
    const value = cell(
      signedRecord({ sign_status: 'contradictory', sign_issues: ['Right arrow plates disagree', 'Most restrictive applied'] }),
      SIGN_CONDITION(),
    )
    expect(value).toBe('Parts of the sign disagree\nAI notes: Right arrow plates disagree; Most restrictive applied')
  })

  it('reads the condition and notes from the signed arrival_context, not the stored record (N2)', () => {
    const s = record({
      sign_status: 'readable',
      sign_issues: [],
      addenda: [arrivalContext('signed', { sign_status: 'partially_obscured', sign_issues: ['Bottom plate faded'] })],
    })
    expect(cell(s, SIGN_CONDITION())).toBe('Partly hard to read in the photo\nAI notes: Bottom plate faded')
    // A development-key signature is still the signed value; the appendix says whose key it was.
    const dev = { ...s, addenda: [arrivalContext('dev', { sign_status: 'contradictory', sign_issues: [] })] }
    expect(cell(dev, SIGN_CONDITION())).toBe('Parts of the sign disagree')
    // Signed with no condition: no row, whatever the stored record says.
    const none = { ...s, sign_status: 'partially_obscured' as const, addenda: [arrivalContext('signed', { sign_status: null })] }
    expect(rows(none).map(([k]) => k)).not.toContain(SIGN_CONDITION())
  })

  it('says "Not signed yet" until the arrival_context is signed', () => {
    const notes = { sign_status: 'partially_obscured' as const, sign_issues: ['Bottom plate faded'] }
    // Queued but not signed: the stored arrival_context's values.
    const pending = record({ ...notes, addenda: [arrivalContext('pending', notes)] })
    expect(cell(pending, SIGN_CONDITION())).toBe('Partly hard to read in the photo\nAI notes: Bottom plate faded\nNot signed yet')
    // Not even queued on this device yet: the record's values.
    expect(cell(record(notes), SIGN_CONDITION())).toBe('Partly hard to read in the photo\nAI notes: Bottom plate faded\nNot signed yet')
  })

  it('says "Not signed" when the chain is held on another device and none is coming here', () => {
    // A v2 link 0 whose chain key this device doesn't have: no arrival_context can be added here.
    const v2 = bundle({ schema: 'parkproof-evidence-v2', session_id: 'rec-pdf-t3', signed_at: '2026-11-02T22:00:04.000Z' })
    const s = record({ sign_status: 'partially_obscured', sign_issues: [], signature: v2 })
    expect(cell(s, SIGN_CONDITION())).toBe('Partly hard to read in the photo\nNot signed')
  })

  it('says when the arrival_context could not be signed', () => {
    const notes = { sign_status: 'contradictory' as const, sign_issues: [] }
    expect(cell(record({ ...notes, addenda: [arrivalContext('rejected', notes)] }), SIGN_CONDITION())).toBe(
      "Parts of the sign disagree\nThis part couldn't be signed",
    )
  })

  it('prints arrows in the notes as plain characters Helvetica can draw', () => {
    const s = signedRecord({ sign_status: 'partially_obscured', sign_issues: ['\u2192 plate faded \u26A0'] })
    const value = cell(s, SIGN_CONDITION())!
    expect(value).toBe('Partly hard to read in the photo\nAI notes: -> plate faded')
    expect(isWinAnsiText(value.replace(/\n/g, ' '))).toBe(true)
  })

  it('sits right after the sign rules row', () => {
    const fields = rows(signedRecord({ sign_status: 'partially_obscured' })).map(([k]) => k)
    expect(fields.indexOf(SIGN_CONDITION())).toBe(fields.indexOf(SIGN_RULES()) + 1)
  })

  it('a record read before T3 has no such row (same table as before)', () => {
    const old = rows(record())
    expect(old.map(([k]) => k)).not.toContain(SIGN_CONDITION())
    const garbled = rows(record({ sign_status: 'blurry' as unknown as ParkingSession['sign_status'] }))
    expect(garbled.map(([k]) => k)).not.toContain(SIGN_CONDITION())
  })
})

describe('the "No sign read" record', () => {
  const noSignRead = signedRecord({
    no_sign: true,
    rules: '',
    expires_at: null,
    sign_status: 'missing',
    sign_issues: ['Empty pole, no plates'],
    ambient_photo: jpeg('scan-photo-as-surroundings'),
  })
  const GUIDANCE = () => i18n.t('pdf.evidence.field.guidance')

  it('says ParkProof found no readable sign, not that the driver said there was none', () => {
    expect(cell(noSignRead, SIGN_RULES())).toBe(
      'No sign read. ParkProof found no readable parking sign in the photo, and the driver logged this park without one.',
    )
    expect(cell(noSignRead, SIGN_CONDITION())).toBe('No parking sign found in the photo\nAI notes: Empty pole, no plates')
    // An ordinary no-sign record keeps its wording and gets no condition row.
    const plain = record({ no_sign: true, rules: '', expires_at: null })
    expect(cell(plain, SIGN_RULES())).toBe(i18n.t('pdf.evidence.noSignRules'))
    expect(rows(plain).map(([k]) => k)).not.toContain(SIGN_CONDITION())
  })

  it("gives no \"Free to park\" guidance: there was no sign to give it from", () => {
    const freeToPark = i18n.t('pdf.evidence.guidanceFreeNoExpiry')
    expect(cell(noSignRead, GUIDANCE())).toBe('Not applicable (no sign was read)')
    // An ordinary no-sign record has no reading either.
    expect(cell(record({ no_sign: true, rules: '', expires_at: null }), GUIDANCE())).toBe('Not applicable (no sign was read)')
    // A sign that was read and shows no expiry keeps its guidance.
    expect(cell(record({ expires_at: null }), GUIDANCE())).toBe(freeToPark)

    drawn.length = 0
    downloadPdf(noSignRead, i18n.t, 'en')
    expect(drawn.join(' ')).not.toContain(freeToPark)
  })

  it('captions the scan photo as a photo the driver took, which does not show there was no sign', () => {
    const caption = i18n.t('pdf.evidence.ambientPhotoCaption')
    expect(caption).toContain("It doesn't show there was no sign nearby.")
    drawn.length = 0
    downloadPdf(noSignRead, i18n.t, 'en')
    const text = drawn.join(' ')
    expect(text).toContain(caption)
    expect(text).not.toContain('Photo taken where the driver parked')
    expect(i18n.exists('pdf.evidence.noSignReadPhotoCaption')).toBe(false)

    drawn.length = 0
    downloadPdf(record({ no_sign: true, rules: '', expires_at: null, ambient_photo: jpeg('surroundings') }), i18n.t, 'en')
    expect(drawn.join(' ')).toContain(caption)
  })
})
