// @vitest-environment happy-dom
//
// The PDF's driver row and handover section (build spec T7 item 7), both
// in sessionRows, the one evidence table all three PDFs draw: "Driver
// (entered on the phone, not checked)" read from the signed arrival
// details once signed, and each handover from its signed part (phone
// clock for when it was entered, ParkProof's signing time in its own
// server-clock row). Names lose the symbols and emoji no PDF font draws,
// and the rows render in every locale with only that locale's PDF
// characters (en, it and id: WinAnsi for jsPDF's Helvetica).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import i18n from './i18n'
import type { ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import { driverRows, handoverRows, sessionRows } from './pdf'
import type { RecordTimesContext } from './record-times'

const TZ = 'Australia/Melbourne'
const CTX: RecordTimesContext = { now: Date.parse('2026-10-26T00:00:00.000Z'), endedHere: false, arrivalRejection: null }
const AT = '2026-10-25T02:30:00.000Z' // 1:30 pm AEDT

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

function context(driver: string | null, state: 'signed' | 'pending' | 'rejected', storedDriver = driver): SignedAddendum {
  const a: SignedAddendum = { id: 'ctx-1', seq: 1, kind: 'arrival_context', captured_at: '2026-10-25T01:00:00.000Z', data: { driver_name: storedDriver } }
  if (state === 'signed') {
    a.bundle = bundle({
      schema: 'parkproof-addendum-v1',
      kind: 'arrival_context',
      seq: 1,
      signed_at: '2026-10-25T01:00:05.000Z',
      data: { driver_name: driver },
    })
  }
  if (state === 'rejected') a.rejected = { code: 'ERR_BAD_STRING', at: '2026-10-25T01:00:06.000Z' }
  return a
}

function handover(
  id: string,
  seq: number,
  to: string,
  at: string,
  state: 'signed' | 'pending' | 'rejected' | 'dev',
  from: string | null = null,
): SignedAddendum {
  const data = { from_driver: from, to_driver: to, handed_over_at: at, location: null }
  const a: SignedAddendum = { id, seq, kind: 'handover', captured_at: at, data }
  if (state === 'signed' || state === 'dev') {
    a.bundle = bundle(
      { schema: 'parkproof-addendum-v1', addendum_id: id, kind: 'handover', seq, signed_at: '2026-10-25T02:31:10.000Z', data },
      state === 'dev' ? { key_alias: 'dev-ephemeral' } : {},
    )
  }
  if (state === 'rejected') a.rejected = { code: 'ERR_FUTURE_TIME', at }
  return a
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-pdf-hand',
    arrived_at: '2026-10-25T01:00:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: '2026-10-25T03:00:00.000Z',
    confidence: 'high',
    chain_key: 'c0'.repeat(32),
    ...overrides,
  }
}

const t = i18n.t.bind(i18n)

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
afterAll(async () => {
  await i18n.changeLanguage('en')
})

describe('the driver row', () => {
  it("uses the spec's label and the name from the signed arrival details, with nothing after it", () => {
    // The stored copy says otherwise: the signed payload is what counts (N2).
    const rows = driverRows(record({ driver_name: 'Sam', addenda: [context('Sam', 'signed', 'Samuel')] }), t)
    expect(rows).toEqual([['Driver (entered on the phone, not checked)', 'Sam']])
  })

  it('says when the name is not signed yet, or was not signed', () => {
    expect(driverRows(record({ driver_name: 'Sam', addenda: [context('Sam', 'pending')] }), t)).toEqual([
      ['Driver (entered on the phone, not checked)', 'Sam (not signed yet)'],
    ])
    expect(driverRows(record({ driver_name: 'Sam', addenda: [context('Sam', 'rejected')] }), t)).toEqual([
      ['Driver (entered on the phone, not checked)', 'Sam (not signed)'],
    ])
  })

  it('has no row when nobody was named, or on a shared copy', () => {
    expect(driverRows(record({ driver_name: null }), t)).toEqual([])
    // A signed arrival naming nobody wins over a name stored later.
    expect(driverRows(record({ driver_name: 'Sam', addenda: [context(null, 'signed')] }), t)).toEqual([])
    const copy = record({
      driver_name: 'Sam',
      shared_from: { original_session_id: 'x', received_at: AT, shared_at: null, arrival_bundle: null, snapshot: { driver: 'Sam' } },
    })
    expect(driverRows(copy, t)).toEqual([])
  })

  it('drops the emoji and symbols no PDF font draws', () => {
    expect(driverRows(record({ driver_name: 'Sam 🚗 ★', addenda: [] }), t)).toEqual([
      ['Driver (entered on the phone, not checked)', 'Sam (not signed)'],
    ])
    expect(driverRows(record({ driver_name: '🚗', addenda: [] }), t)).toEqual([])
  })
})

describe('the handover section', () => {
  it('one pair of rows per handover, oldest first: what the driver entered (phone clock), then ParkProof\'s signing (server clock)', () => {
    const rows = handoverRows(
      record({
        addenda: [
          handover('h-2', 3, 'Kim', '2026-10-25T02:40:00.000Z', 'pending', 'Alex'),
          handover('h-1', 2, 'Alex', AT, 'signed', 'Sam'),
        ],
      }),
      TZ,
      t,
    )
    expect(rows).toEqual([
      ['Handover (entered on the phone, not checked)', 'Sam handed the car to Alex at Sun 25 Oct 2026, 1:30 pm AEDT (phone clock).'],
      ['Handover signed by ParkProof (server clock)', 'Sun 25 Oct 2026, 1:31 pm AEDT'],
      ['Handover (entered on the phone, not checked)', 'Alex handed the car to Kim at Sun 25 Oct 2026, 1:40 pm AEDT (phone clock).'],
      ['Handover signed by ParkProof (server clock)', 'Not signed yet'],
    ])
  })

  it('without a from-driver, a refused part, and a development key', () => {
    const rows = handoverRows(
      record({
        addenda: [handover('h-1', 2, 'Alex', AT, 'rejected'), handover('h-2', 3, 'Kim', '2026-10-25T02:45:00.000Z', 'dev')],
      }),
      TZ,
      t,
    )
    expect(rows).toEqual([
      ['Handover (entered on the phone, not checked)', 'Handed to Alex at Sun 25 Oct 2026, 1:30 pm AEDT (phone clock).'],
      ['Handover signed by ParkProof (server clock)', "This part couldn't be signed"],
      ['Handover (entered on the phone, not checked)', 'Handed to Kim at Sun 25 Oct 2026, 1:45 pm AEDT (phone clock).'],
      [
        'Handover signed by ParkProof (server clock)',
        "Sun 25 Oct 2026, 1:31 pm AEDT, with a development key. It can't be checked with ParkProof's published key.",
      ],
    ])
  })

  it('reads a signed handover from its signed payload', () => {
    const signed = handover('h-1', 2, 'Alex', AT, 'signed', 'Sam')
    signed.data = { ...(signed.data as object), to_driver: 'Someone else' }
    expect(handoverRows(record({ addenda: [signed] }), TZ, t)[0][1]).toBe(
      'Sam handed the car to Alex at Sun 25 Oct 2026, 1:30 pm AEDT (phone clock).',
    )
  })
})

describe('sessionRows carries both, after the evidence rows', () => {
  it('ends with the driver row and the handover section; a record without them keeps its shape', () => {
    const plain = sessionRows(record(), TZ, t, CTX)
    const full = sessionRows(
      record({ driver_name: 'Sam', addenda: [context('Sam', 'signed'), handover('h-1', 2, 'Alex', AT, 'signed', 'Sam')] }),
      TZ,
      t,
      CTX,
    )
    expect(full.slice(0, plain.length).map(([label]) => label)).toEqual(plain.map(([label]) => label))
    expect(full.slice(plain.length).map(([label]) => label)).toEqual([
      'Driver (entered on the phone, not checked)',
      'Handover (entered on the phone, not checked)',
      'Handover signed by ParkProof (server clock)',
    ])
    expect(plain.some(([label]) => /Driver|Handover/.test(label))).toBe(false)
  })
})

// jsPDF's Helvetica draws WinAnsi (cp1252) only.
// The printable cp1252 characters in 0x80 to 0x9F, as code points.
const WIN_ANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
])
const inWinAnsi = (cp: number) => cp === 10 || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp)

describe('in every locale', () => {
  const session = record({
    driver_name: 'Sam',
    addenda: [context('Sam', 'pending'), handover('h-1', 2, 'Alex', AT, 'signed', 'Sam'), handover('h-2', 3, 'Kim', '2026-10-25T02:40:00.000Z', 'pending')],
  })

  for (const locale of ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']) {
    it(`${locale}: translated, every variable filled, the names and phone times in place`, async () => {
      await i18n.changeLanguage(locale)
      const rows = [...driverRows(session, t), ...handoverRows(session, TZ, t)]
      expect(rows).toHaveLength(5)
      const text = rows.flat().join('\n')
      expect(text).not.toMatch(/\{\{|\}\}|pdf\.evidence/)
      expect(rows[0][1]).toContain('Sam')
      expect(rows[1][1]).toContain('Alex')
      expect(rows[1][1]).toContain('Sun 25 Oct 2026, 1:30 pm AEDT')
      expect(rows[3][1]).toContain('Kim')
      if (locale !== 'en') {
        expect(rows[0][0]).not.toBe('Driver (entered on the phone, not checked)')
        expect(rows[1][0]).not.toBe('Handover (entered on the phone, not checked)')
      }
      if (locale === 'en' || locale === 'it' || locale === 'id') {
        expect([...text].filter((ch) => !inWinAnsi(ch.codePointAt(0)!))).toEqual([])
      }
    })
  }
})
