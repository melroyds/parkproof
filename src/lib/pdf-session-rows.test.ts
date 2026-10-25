// @vitest-environment happy-dom
//
// sessionRows (pdf.ts, spec T1b items 1 to 3): the one evidence table all
// three PDFs draw. Phone times are labelled as phone times, ParkProof's
// signing time for each part sits in its own "server clock" row read from
// the signed payload, every time is in the record's zone with the zone name,
// and an ended record gets the departure rows: the tap (phone clock), its
// signing, the phone's location and accuracy, and the approximate distance
// from the arrival (phone GPS). A late tap still gets no duration row.
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from './i18n'
import type { ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import { DEV_KEY_ALIAS } from './evidence-chain'
import { endedRows, pdfAccuracy, sessionRows, signingValue, withLocalEvidence } from './pdf'
import type { RecordTimesContext } from './record-times'

const TZ = 'Australia/Melbourne'
const GPS = { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne', source: 'gps' as const, accuracy_meters: 8 }
const CTX: RecordTimesContext = { now: Date.parse('2026-10-26T00:00:00.000Z'), endedHere: true, arrivalRejection: null }

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

const LINK0 = bundle({
  schema: 'parkproof-evidence-v1',
  session_id: 'rec-rows',
  arrived_at: '2026-10-24T23:55:00.000Z',
  expires_at: '2026-10-25T01:55:00.000Z',
  signed_at: '2026-10-24T23:55:04.000Z',
})

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-rows',
    arrived_at: '2026-10-24T23:55:00.000Z',
    location: GPS,
    sign_photo: null,
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: '2026-10-25T01:55:00.000Z',
    confidence: 'high',
    ...overrides,
  }
}

function departure(state: 'signed' | 'pending' | 'rejected' | 'dev', data: Record<string, unknown> = {}): SignedAddendum {
  const d = {
    ended_at: '2026-10-25T01:30:00.000Z',
    location: { lat: -37.8118, lng: 144.9631, accuracy_meters: 11, source: 'gps' },
    distance_from_arrival_m: 200,
    return_photos: [],
    ...data,
  }
  const a: SignedAddendum = { id: 'dep-1', seq: 1, kind: 'departure', captured_at: d.ended_at as string, data: d }
  if (state === 'signed' || state === 'dev') {
    a.bundle = bundle(
      { schema: 'parkproof-addendum-v1', addendum_id: 'dep-1', kind: 'departure', seq: 1, signed_at: '2026-10-25T01:31:10.000Z', data: d },
      state === 'dev' ? { key_alias: DEV_KEY_ALIAS } : {},
    )
  }
  if (state === 'rejected') a.rejected = { code: 'ERR_BAD_STRING', at: '2026-10-25T01:31:00.000Z' }
  return a
}

const t = (...args: Parameters<typeof i18n.t>) => i18n.t(...args)
const rows = (s: ParkingSession, ctx = CTX) => Object.fromEntries(sessionRows(s, TZ, i18n.t, ctx))
const labels = (s: ParkingSession, ctx = CTX) => sessionRows(s, TZ, i18n.t, ctx).map(([label]) => label)

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

describe('sessionRows: the arrival', () => {
  it('labels the logged time as the phone clock and the signing time as the server clock, in zone', () => {
    const r = rows(record({ signature: LINK0 }))
    expect(r['Logged (phone clock)']).toBe('Sun 25 Oct 2026, 10:55 am AEDT')
    expect(r['Arrival signed by ParkProof (server clock)']).toBe('Sun 25 Oct 2026, 10:55 am AEDT')
    expect(r['Expires at']).toBe('Sun 25 Oct 2026, 12:55 pm AEDT')
  })

  it('the signed arrival time wins over a stored copy that differs', () => {
    const r = rows(record({ signature: LINK0, arrived_at: '2026-10-24T20:00:00.000Z' }))
    expect(r['Logged (phone clock)']).toBe('Sun 25 Oct 2026, 10:55 am AEDT')
  })

  it('not signed yet, refused, and a development key', () => {
    expect(rows(record())['Arrival signed by ParkProof (server clock)']).toBe('Not signed yet')
    expect(rows(record(), { ...CTX, arrivalRejection: 'ERR_BAD_TIME' })['Arrival signed by ParkProof (server clock)']).toBe(
      "This part couldn't be signed",
    )
    expect(rows(record({ signature: { ...LINK0, key_alias: DEV_KEY_ALIAS } }))['Arrival signed by ParkProof (server clock)']).toBe(
      "Sun 25 Oct 2026, 10:55 am AEDT, with a development key. It can't be checked with ParkProof's published key.",
    )
  })

  it('a winter record is in AEST and a Brisbane one in AEST without DST', () => {
    expect(rows(record({ arrived_at: '2026-07-01T02:00:00.000Z', expires_at: null }))['Logged (phone clock)']).toBe(
      'Wed 1 July 2026, 12:00 pm AEST',
    )
    const brisbane = sessionRows(
      record({ location: { lat: -27.4698, lng: 153.0251, source: 'gps', accuracy_meters: 9 } }),
      'Australia/Brisbane',
      i18n.t,
      CTX,
    )
    expect(Object.fromEntries(brisbane)['Logged (phone clock)']).toBe('Sun 25 Oct 2026, 9:55 am AEST')
  })

  it('only a phone GPS fix is labelled GPS', () => {
    expect(labels(record())).toContain('Location (GPS)')
    const manual = labels(record({ location: { lat: -37.8, lng: 144.9, address: '1 Main St', source: 'manual' } }))
    expect(manual).toContain('Location (coordinates)')
    expect(manual).not.toContain('Location (GPS)')
    expect(rows(record({ location: { lat: -37.8, lng: 144.9, source: 'manual' } }))['Location source']).toBe('Manually entered')
  })

  it('an open record has no departure rows; the rows keep the table order', () => {
    expect(labels(record())).toEqual([
      'Logged (phone clock)',
      'Arrival signed by ParkProof (server clock)',
      'Expires at',
      'ParkProof Guidance',
      'Address',
      'Location (GPS)',
      'Location source',
      'Map link',
      'Side / Variant selected',
      'Sign rules',
      'AI confidence',
    ])
  })
})

describe('sessionRows: the departure (T1b item 3)', () => {
  const ended = (addenda: SignedAddendum[], extra: Partial<ParkingSession> = {}) =>
    record({ signature: LINK0, ended_at: '2026-10-25T01:30:00.000Z', addenda, ...extra })

  it('a signed departure: tap (phone clock), signing (server clock), location with accuracy, distance (phone GPS)', () => {
    const s = ended([departure('signed')])
    const l = labels(s)
    const at = l.indexOf("Tapped I've left (phone clock)")
    expect(l.slice(at, at + 5)).toEqual([
      "Tapped I've left (phone clock)",
      "Time from arrival to the I've left tap (phone clock)",
      'Departure signed by ParkProof (server clock)',
      "Phone location at the I've left tap (GPS)",
      'Approx. distance from arrival (phone GPS)',
    ])
    const r = rows(s)
    expect(r["Tapped I've left (phone clock)"]).toBe('Sun 25 Oct 2026, 12:30 pm AEDT')
    expect(r['Departure signed by ParkProof (server clock)']).toBe('Sun 25 Oct 2026, 12:31 pm AEDT')
    expect(r["Phone location at the I've left tap (GPS)"]).toBe('-37.811800, 144.963100, accuracy ±11m')
    expect(r['Approx. distance from arrival (phone GPS)']).toBe('200 m')
  })

  it('reads the signed departure, not the stored field', () => {
    const s = ended([departure('signed')], {
      departure: { ended_at: '2026-10-25T01:30:00.000Z', location: null, distance_from_arrival_m: 3 },
    })
    expect(rows(s)['Approx. distance from arrival (phone GPS)']).toBe('200 m')
  })

  it('a departure still being signed shows its stored location under "Not signed yet"', () => {
    const r = rows(ended([departure('pending', { distance_from_arrival_m: 1250 })]))
    expect(r['Departure signed by ParkProof (server clock)']).toBe('Not signed yet')
    expect(r['Approx. distance from arrival (phone GPS)']).toBe('1.3 km')
  })

  it('refused, development key, and a departure that will never be signed', () => {
    expect(rows(ended([departure('rejected')]))['Departure signed by ParkProof (server clock)']).toBe("This part couldn't be signed")
    expect(rows(ended([departure('dev')]))['Departure signed by ParkProof (server clock)']).toBe(
      "Sun 25 Oct 2026, 12:31 pm AEDT, with a development key. It can't be checked with ParkProof's published key.",
    )
    // An old v1 record ended elsewhere: no departure part is coming.
    const r = rows(ended([]), { ...CTX, endedHere: false })
    expect(r['Departure signed by ParkProof (server clock)']).toBe('Not signed')
    expect(r["Phone location at the I've left tap (GPS)"]).toBe('Not captured')
    expect(labels(ended([]), { ...CTX, endedHere: false })).not.toContain('Approx. distance from arrival (phone GPS)')
  })

  it('no location: "Not captured" and no distance row; a location without a comparable arrival: distance not available', () => {
    const none = ended([departure('signed', { location: null, distance_from_arrival_m: null })])
    expect(rows(none)["Phone location at the I've left tap (GPS)"]).toBe('Not captured')
    expect(labels(none)).not.toContain('Approx. distance from arrival (phone GPS)')

    const typedArrival = ended([departure('signed', { distance_from_arrival_m: null })], {
      location: { lat: -37.8, lng: 144.9, source: 'manual' },
    })
    expect(rows(typedArrival)['Approx. distance from arrival (phone GPS)']).toBe(
      "Not available. The arrival location isn't a phone GPS fix accurate enough to compare.",
    )
  })

  it('a location of unknown accuracy is printed without one', () => {
    const s = ended([departure('signed', { location: { lat: -37.8118, lng: 144.9631, accuracy_meters: null, source: 'gps' } })])
    expect(rows(s)["Phone location at the I've left tap (GPS)"]).toBe('-37.811800, 144.963100')
  })

  it('keeps the late-tap rule: no duration row for a tap after expiry', () => {
    const late = record({ ended_at: '2026-10-25T05:00:00.000Z' })
    expect(labels(late)).toContain("Tapped I've left (phone clock)")
    expect(labels(late)).not.toContain("Time from arrival to the I've left tap (phone clock)")
  })

  it('endedRows takes the tap time from the signed departure', () => {
    const s = record({
      ended_at: '2026-10-25T01:30:00.000Z',
      addenda: [departure('signed', { ended_at: '2026-10-25T01:29:00.000Z' })],
    })
    expect(endedRows(s, TZ, i18n.t)[0][1]).toBe('Sun 25 Oct 2026, 12:29 pm AEDT')
  })
})

describe('signingValue', () => {
  it('never prints a phone time and covers every state', () => {
    expect(signingValue({ state: 'signed', signed_at: '2026-10-25T01:31:10.000Z' }, TZ, i18n.t)).toBe('Sun 25 Oct 2026, 12:31 pm AEDT')
    expect(signingValue({ state: 'signed', signed_at: null }, TZ, i18n.t)).toBe(t('pdf.common.dash'))
    expect(signingValue({ state: 'pending' }, TZ, i18n.t)).toBe('Not signed yet')
    expect(signingValue({ state: 'rejected' }, TZ, i18n.t)).toBe("This part couldn't be signed")
    expect(signingValue({ state: 'none' }, TZ, i18n.t)).toBe('Not signed')
  })
})

describe('sessionRows: review fixes', () => {
  const ended = (addenda: SignedAddendum[], extra: Partial<ParkingSession> = {}) =>
    record({ signature: LINK0, ended_at: '2026-10-25T01:30:00.000Z', addenda, ...extra })
  const DIST = 'Approx. distance from arrival (phone GPS)'

  it('the AI confidence goes through a key map, never printed raw', async () => {
    expect(rows(record())['AI confidence']).toBe('High')
    expect(rows(record({ confidence: 'medium' }))['AI confidence']).toBe('Medium')
    expect(rows(record({ confidence: 'low' }))['AI confidence']).toBe('Low')
    expect(rows(record({ confidence: 'certain' as ParkingSession['confidence'] }))['AI confidence']).toBe(t('pdf.common.dash'))
    expect(rows(record({ no_sign: true }))['AI confidence']).toBe('Not applicable (no sign was read)')
    await i18n.changeLanguage('zh-CN')
    try {
      const zh = sessionRows(record(), TZ, i18n.t, CTX)
      expect(zh.find(([label]) => label === i18n.t('pdf.evidence.field.aiConfidence'))?.[1]).toBe('高')
      expect(zh.flat().join(' ')).not.toMatch(/\bhigh\b/)
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('a rough or unknown tap fix makes the distance rough; a good fix prints it plain', () => {
    const rough = ended([departure('signed', { location: { lat: -37.84, lng: 144.9631, accuracy_meters: 3000, source: 'gps' }, distance_from_arrival_m: 2900 })])
    expect(rows(rough)[DIST]).toBe("2.9 km. The phone's location at the tap was only accurate to ±3.0km, so this distance is rough.")
    const unknown = ended([departure('signed', { location: { lat: -37.8118, lng: 144.9631, accuracy_meters: null, source: 'gps' } })])
    expect(rows(unknown)[DIST]).toBe("200 m. The phone didn't report how accurate its location at the tap was, so this distance is rough.")
    const edge = ended([departure('signed', { location: { lat: -37.8118, lng: 144.9631, accuracy_meters: 100, source: 'gps' } })])
    expect(rows(edge)[DIST]).toBe('200 m')
    expect(rows(ended([departure('signed')]))[DIST]).toBe('200 m')
  })

  it('hi and pa print +/- before an accuracy (their PDF fonts have no ± glyph); the rest keep ±', async () => {
    for (const locale of ['hi', 'pa']) {
      await i18n.changeLanguage(locale)
      try {
        const values = sessionRows(ended([departure('signed')]), TZ, i18n.t, CTX).map(([, v]) => v).join(' | ')
        expect(values).toContain('+/-11m')
        expect(values).toContain('+/-8m')
        expect(values).not.toContain('±')
        expect(pdfAccuracy(1200, i18n.t)).toBe('+/-1.2km')
      } finally {
        await i18n.changeLanguage('en')
      }
    }
    expect(pdfAccuracy(1200, i18n.t)).toBe('±1.2km')
    expect(pdfAccuracy(Number.NaN, i18n.t)).toBe('±?')
  })

  it('says "record", not "session", and the low-accuracy source points at the notice below', () => {
    const r = rows(record({ no_sign: true, rules: undefined }))
    expect(r['Sign rules']).toBe('No sign was read for this record. The driver said there were no parking signs at this spot.')
    expect(r['ParkProof Guidance']).toBe('Parking time ended at Sun 25 Oct 2026, 12:55 pm AEDT.')
    const low = rows(record({ location: { ...GPS, accuracy_meters: 450 } }))
    expect(low['Location source']).toBe('GPS: low accuracy, ±450m (see the GPS accuracy notice below)')
    for (const s of [record(), record({ no_sign: true }), ended([departure('pending')])]) {
      expect(sessionRows(s, TZ, i18n.t, CTX).flat().join(' ')).not.toMatch(/session|appendix/i)
    }
  })
})

describe('withLocalEvidence (the full export)', () => {
  const V2 = bundle({
    schema: 'parkproof-evidence-v2',
    session_id: 'rec-rows',
    arrived_at: '2026-10-24T23:55:00.000Z',
    expires_at: '2026-10-25T01:55:00.000Z',
    chain_key_sha256: 'ab'.repeat(32),
    signed_at: '2026-10-24T23:55:04.000Z',
  })
  // What /me/export returns: no chain_key, only the uploaded addenda.
  const exported = () => record({ signature: V2, ended_at: '2026-10-25T01:30:00.000Z', addenda: [] })
  const SIGNED = 'Departure signed by ParkProof (server clock)'

  it('a departure still being signed on this device reads "Not signed yet", not "Not signed"', () => {
    // The bug: the stripped chain key reads as "no departure will ever come".
    expect(rows(exported())[SIGNED]).toBe('Not signed')
    const local = { ...exported(), chain_key: 'cd'.repeat(32), addenda: [departure('pending')] }
    const [merged] = withLocalEvidence([exported()], () => [local])
    expect(merged.chain_key).toBe('cd'.repeat(32))
    expect(rows(merged)[SIGNED]).toBe('Not signed yet')
    // Tapped here, no departure part yet (the catch-up will add one): still "Not signed yet".
    const [tappedHere] = withLocalEvidence([exported()], () => [{ ...exported(), chain_key: 'cd'.repeat(32) }])
    expect(rows(tappedHere)[SIGNED]).toBe('Not signed yet')
  })

  it('a departure signed here but not yet uploaded is in the export', () => {
    const local = { ...exported(), chain_key: 'cd'.repeat(32), addenda: [departure('signed')] }
    const [merged] = withLocalEvidence([exported()], () => [local])
    expect(rows(merged)[SIGNED]).toBe('Sun 25 Oct 2026, 12:31 pm AEDT')
  })

  it('a record this device does not have, or an unreadable store, is left as the cloud sent it', () => {
    const row = exported()
    expect(withLocalEvidence([row], () => [record({ id: 'other' })])[0]).toBe(row)
    expect(
      withLocalEvidence([row], () => {
        throw new Error('storage blocked')
      })[0],
    ).toBe(row)
  })
})
