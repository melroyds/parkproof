// @vitest-environment happy-dom
//
// The workday record PDF (build spec T6c). The cover table's rows (leg,
// arrived and left by the phone's clock, ParkProof's signing times, the
// address, the distance from the previous leg, the driver's statement read
// from the signed details), the chain steps between legs, and the drawn
// PDF: the header, the footer on every page, the council line on every
// leg's rule sheet, only the legs the picker chose, no permit details or
// salt anywhere, and nothing at all with workday mode off.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

const flag = vi.hoisted(() => ({ on: true }))
vi.mock('./features', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./features')>()),
  isWorkdayEnabled: () => flag.on,
}))

// Every string drawn, with its page, font and size; every document; no real download.
type Drawn = { text: string; page: number; font: string; size: number }
const { drawn, docs, saved } = vi.hoisted(() => ({
  drawn: [] as Drawn[],
  docs: [] as Array<{ getNumberOfPages: () => number }>,
  saved: [] as string[],
}))
vi.mock('jspdf', async (importOriginal) => {
  const mod = await importOriginal<typeof import('jspdf')>()
  type Doc = InstanceType<typeof mod.jsPDF>
  function Recording(...args: ConstructorParameters<typeof mod.jsPDF>): Doc {
    const doc = new mod.jsPDF(...args)
    const realText = doc.text.bind(doc) as (...a: unknown[]) => Doc
    ;(doc as unknown as { text: (...a: unknown[]) => Doc }).text = (...a: unknown[]) => {
      const value = a[0]
      const page = doc.getCurrentPageInfo().pageNumber
      for (const text of Array.isArray(value) ? (value as string[]) : [String(value)]) {
        drawn.push({ text, page, font: doc.getFont().fontName, size: doc.getFontSize() })
      }
      return realText(...a)
    }
    ;(doc as unknown as { save: (name: string) => Doc }).save = (name: string) => {
      saved.push(name)
      return doc
    }
    docs.push(doc)
    return doc
  }
  Recording.API = mod.jsPDF.API
  return { ...mod, jsPDF: Recording, default: Recording }
})

import i18n from './i18n'
import en from '../locales/en.json'
import type { BoundaryStatement, ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import {
  WORKDAY_COVER_COLUMNS,
  downloadWorkdayPdf,
  legBoundary,
  legDistanceText,
  legStatementText,
  workdayChainChecks,
  workdayCoverRows,
} from './pdf-workday'
import { chosenWorkdayLegs } from './workday-flow'
import { evidenceTime } from './record-times'
import { prefetchPdfFont } from './pdf-fonts'

// Bound, so it follows i18n.changeLanguage in the hi test.
const t = i18n.t.bind(i18n)
const MEL = 'Australia/Melbourne'
const WD = 'aaaaaaaa-1111-4111-8111-111111111111'
const SALT = 'f00dfacecafebeef'.repeat(4)
const AREA = 'ZZAREA77'
const NOTE = 'SECRET-NOTE-42'
const COMMITMENT = 'ab'.repeat(32)
const PREV_DEPARTURE_HASH = 'cd'.repeat(32)

function bundle(payload: Record<string, unknown>, overrides: Partial<SignatureBundle> = {}): SignatureBundle {
  return {
    schema: String(payload.schema),
    signed_at: String(payload.signed_at),
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify(payload),
    signature_base64: `MEUCI-${String(payload.addendum_id ?? payload.session_id)}-${String(payload.signed_at)}`,
    ...overrides,
  }
}

function linkZero(id: string, arrived: string, expires: string, signedAt: string): SignatureBundle {
  return bundle({
    schema: 'parkproof-evidence-v2',
    session_id: id,
    arrived_at: arrived,
    expires_at: expires,
    chain_key_sha256: '11'.repeat(32),
    signed_at: signedAt,
  })
}

/** An arrival_context (link 1) naming the workday, signed unless `pending`. */
function context(
  id: string,
  legIndex: number,
  boundary: BoundaryStatement | null,
  options: { previous?: string | null; pending?: boolean; signedAt?: string } = {},
): SignedAddendum {
  const data = {
    driver_name: null,
    sign_status: 'readable',
    sign_issues: [],
    rule_flags: null,
    gate_acks: null,
    permit_commitment: COMMITMENT,
    photos: [],
    condition_note: null,
    compliance_type: null,
    jurisdiction: 'VIC',
    workday: {
      workday_id: WD,
      leg_index: legIndex,
      stretch_deadline: null,
      previous_departure_payload_sha256: options.previous ?? null,
    },
    boundary,
  }
  const a: SignedAddendum = { id: `${id}-ctx`, seq: 1, kind: 'arrival_context', captured_at: '2026-10-26T22:00:00.000Z', data }
  if (!options.pending) {
    a.bundle = bundle(
      {
        schema: 'parkproof-addendum-v1',
        addendum_id: a.id,
        kind: 'arrival_context',
        session_id: id,
        seq: 1,
        signed_at: options.signedAt ?? '2026-10-26T22:00:05.000Z',
        data,
      },
      { schema: 'parkproof-addendum-v1' },
    )
  }
  return a
}

function departure(id: string, seq: number, endedAt: string, signedAt: string, suffix = ''): SignedAddendum {
  const data = { ended_at: endedAt, location: null, distance_from_arrival_m: null, return_photos: [] }
  return {
    id: `${id}-dep${suffix}`,
    seq,
    kind: 'departure',
    captured_at: endedAt,
    data,
    bundle: bundle(
      { schema: 'parkproof-addendum-v1', addendum_id: `${id}-dep${suffix}`, kind: 'departure', session_id: id, seq, signed_at: signedAt, data },
      { schema: 'parkproof-addendum-v1' },
    ),
  }
}

const GPS = (address: string) => ({ lat: -37.8, lng: 144.96, address, source: 'gps' as const, accuracy_meters: 8 })

/** Leg 1 (index 0): signed arrival, details and departure; an accessible permit with its salt. */
function leg0(): ParkingSession {
  return {
    id: 'leg-0',
    arrived_at: '2026-10-26T22:00:00.000Z',
    location: GPS('1 First St, Carlton VIC'),
    sign_photo: null,
    car_photo: null,
    rules: '2P 8am-6pm',
    observations: [],
    expires_at: '2026-10-27T00:00:00.000Z',
    confidence: 'high',
    workday_id: WD,
    leg_index: 0,
    ended_at: '2026-10-26T23:50:00.000Z',
    signature: linkZero('leg-0', '2026-10-26T22:00:00.000Z', '2026-10-27T00:00:00.000Z', '2026-10-26T22:00:04.000Z'),
    addenda: [context('leg-0', 0, null), departure('leg-0', 2, '2026-10-26T23:50:00.000Z', '2026-10-26T23:50:09.000Z')],
    permit_context: {
      type: 'accessible',
      area: AREA,
      holder_present: true,
      sign_exception_applies: false,
      standard_until: null,
      permit_until: null,
      note: NOTE,
    },
    permit_salt: SALT,
  }
}

const YELLOW: BoundaryStatement = {
  previous_session_id: 'leg-0',
  asked_because: ['same_street'],
  answer: 'yellow_edge_line',
  distance_from_previous_m: 240.4,
}
const NOT_SURE_AREA: BoundaryStatement = {
  previous_session_id: 'leg-1',
  asked_because: ['area_sign', 'location_unreliable'],
  answer: 'not_sure',
  distance_from_previous_m: null,
}

/** Leg 2 (index 1): signed, says it passed a yellow edge line, linked to leg 1's departure. */
function leg1(): ParkingSession {
  return {
    id: 'leg-1',
    arrived_at: '2026-10-27T00:05:00.000Z',
    location: GPS('2 Second St, Carlton VIC'),
    sign_photo: null,
    car_photo: null,
    rules: '2P 8am-6pm',
    observations: [],
    expires_at: '2026-10-27T02:05:00.000Z',
    confidence: 'high',
    workday_id: WD,
    leg_index: 1,
    ended_at: '2026-10-27T01:58:00.000Z',
    boundary: YELLOW,
    signature: linkZero('leg-1', '2026-10-27T00:05:00.000Z', '2026-10-27T02:05:00.000Z', '2026-10-27T00:05:03.000Z'),
    addenda: [
      context('leg-1', 1, YELLOW, { previous: PREV_DEPARTURE_HASH, signedAt: '2026-10-27T00:05:06.000Z' }),
      departure('leg-1', 2, '2026-10-27T01:58:00.000Z', '2026-10-27T01:58:07.000Z'),
    ],
  }
}

/** Leg 3 (index 2): not signed yet, "I'm not sure" to the area question, still parked. */
function leg2(): ParkingSession {
  return {
    id: 'leg-2',
    arrived_at: '2026-10-27T02:10:00.000Z',
    location: GPS('3 Third St, Carlton VIC'),
    sign_photo: null,
    car_photo: null,
    rules: '2P Parking Area',
    observations: [],
    expires_at: '2026-10-27T02:05:00.000Z',
    confidence: 'high',
    workday_id: WD,
    leg_index: 2,
    boundary: NOT_SURE_AREA,
    chain_key: '22'.repeat(32),
    addenda: [context('leg-2', 2, NOT_SURE_AREA, { pending: true })],
  }
}

const legs = () => [leg0(), leg1(), leg2()]
const text = () => drawn.map((d) => d.text).join(' ')
const pageText = (page: number) =>
  drawn
    .filter((d) => d.page === page)
    .map((d) => d.text)
    .join(' ')
const SIGNED_CONTEXT = { now: Date.parse('2026-10-27T03:00:00.000Z'), endedHere: false, arrivalRejection: null }

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  flag.on = true
  drawn.length = 0
  docs.length = 0
  saved.length = 0
})
afterEach(() => {
  localStorage.clear()
})

describe('the leg picker', () => {
  it('keeps only the chosen legs of the workday, in leg order', () => {
    const [a, b, c] = legs()
    const shared = { ...leg1(), id: 'shared', shared_from: { original_session_id: 'x', received_at: '', shared_at: null, arrival_bundle: null, snapshot: {} } }
    expect(chosenWorkdayLegs([c, a, b, shared], ['leg-2', 'leg-0', 'shared', 'nope']).map((l) => l.id)).toEqual(['leg-0', 'leg-2'])
    expect(chosenWorkdayLegs([c, a, b], [])).toEqual([])
    expect(chosenWorkdayLegs([c, a, b], new Set(['leg-1', 'leg-0', 'leg-2'])).map((l) => l.leg_index)).toEqual([0, 1, 2])
  })
})

describe('the cover table', () => {
  it('has the spec columns, in order', () => {
    expect(WORKDAY_COVER_COLUMNS.map((k) => t(k))).toEqual([
      'Leg',
      'Arrived (phone clock)',
      'Left (phone clock)',
      'Signed by ParkProof (server clock)',
      'Address',
      'Approx. distance from previous leg (phone GPS)',
      "Driver's statement",
    ])
  })

  it('one row per leg: phone times, signing times, address, distance and the signed statement', () => {
    const rows = workdayCoverRows(legs(), t, () => SIGNED_CONTEXT)
    expect(rows[0]).toEqual([
      '1',
      'Tue 27 Oct 2026, 9:00 am AEDT',
      'Tue 27 Oct 2026, 10:50 am AEDT',
      `Arrival: ${evidenceTime('2026-10-26T22:00:04.000Z', MEL)}\nDeparture: ${evidenceTime('2026-10-26T23:50:09.000Z', MEL)}`,
      '1 First St, Carlton VIC',
      '–',
      'None. This is the first leg.',
    ])
    expect(rows[1]).toEqual([
      '2',
      evidenceTime('2026-10-27T00:05:00.000Z', MEL),
      evidenceTime('2026-10-27T01:58:00.000Z', MEL),
      `Arrival: ${evidenceTime('2026-10-27T00:05:03.000Z', MEL)}\nDeparture: ${evidenceTime('2026-10-27T01:58:07.000Z', MEL)}`,
      '2 Second St, Carlton VIC',
      '240 m',
      'The driver said they passed a yellow edge line.',
    ])
    // Not signed yet, not left: said so, never a signed time or a guess.
    expect(rows[2]).toEqual([
      '3',
      evidenceTime('2026-10-27T02:10:00.000Z', MEL),
      'Not recorded',
      'Arrival: Not signed yet',
      '3 Third St, Carlton VIC',
      'Not measured. It needs a phone GPS fix at both legs.',
      "Asked whether they had left the parking area, the driver answered: I'm not sure. (not signed yet)",
    ])
  })

  it('reads the statement and distance from the signed details, not the record, once signed (N2)', () => {
    const leg = leg1()
    // The record's own field says something else; the signed payload wins.
    leg.boundary = { ...YELLOW, answer: 'not_sure', distance_from_previous_m: 5 }
    expect(legBoundary(leg)).toEqual({ boundary: YELLOW, signing: 'signed' })
    expect(legStatementText(leg, t)).toBe('The driver said they passed a yellow edge line.')
    expect(legDistanceText(leg, t)).toBe('240 m')
  })

  it.each([
    ['opposite_direction_sign', ['within_30m'], 'The driver said they passed a sign showing this zone had ended.'],
    ['yellow_edge_line', ['same_street'], 'The driver said they passed a yellow edge line.'],
    ['t_intersection_or_dead_end', ['same_sign_text'], 'The driver said they passed the end of the road at a T-intersection or dead end.'],
    ['left_parking_area', ['area_sign'], 'The driver said they drove out of the parking area, past a sign saying it ends.'],
    ['not_sure', ['within_30m'], "Asked whether they had left the signed stretch, the driver answered: I'm not sure."],
    ['not_sure', ['area_sign'], "Asked whether they had left the parking area, the driver answered: I'm not sure."],
    ['not_asked', [], "Not asked. ParkProof didn't ask about this move."],
  ] as const)('the statement for %s (asked because %j) is the driver\'s, in a whole sentence', (answer, because, expected) => {
    const boundary: BoundaryStatement = { previous_session_id: 'leg-0', asked_because: [...because], answer, distance_from_previous_m: 12 }
    const leg = { ...leg1(), boundary, addenda: [context('leg-1', 1, boundary)] }
    expect(legStatementText(leg, t)).toBe(expected)
  })

  it('marks a statement ParkProof refused to sign, or never will', () => {
    const refused = leg2()
    refused.addenda = [{ ...context('leg-2', 2, NOT_SURE_AREA, { pending: true }), rejected: { code: 'ERR_BAD_STRING', at: '' } }]
    expect(legStatementText(refused, t)).toMatch(/\(this part couldn't be signed\)$/)
    // A v2 record whose chain key isn't on this device: no details at parking will be added here.
    const elsewhere: ParkingSession = { ...leg1(), addenda: [], signature: linkZero('leg-1', '2026-10-27T00:05:00.000Z', '2026-10-27T02:05:00.000Z', 'x') }
    expect(legStatementText(elsewhere, t)).toBe('The driver said they passed a yellow edge line. (not signed)')
  })
})

describe('the chain between legs', () => {
  it("names the previous leg's signed departure payload file, inside that leg's folder", () => {
    expect(workdayChainChecks(legs(), legs())).toEqual([
      { kind: 'pair', leg: 2, link: '1', previous: 1, files: ['leg1/link2-payload.txt'] },
    ])
  })

  it('lists both payloads when the previous departure forked', () => {
    const first = leg0()
    first.addenda = [...(first.addenda ?? []), departure('leg-0', 2, '2026-10-26T23:50:00.000Z', '2026-10-26T23:51:00.000Z', 'b')]
    expect(workdayChainChecks([first, leg1()], [first, leg1()])).toEqual([
      { kind: 'pair', leg: 2, link: '1', previous: 1, files: ['leg1/link2a-payload.txt', 'leg1/link2b-payload.txt'] },
    ])
  })

  it('says so when the previous leg is left out, or its departure was never signed in time', () => {
    expect(workdayChainChecks([leg1()], legs())).toEqual([{ kind: 'not_in_pdf', leg: 2, link: '1' }])
    const unlinked = { ...leg1(), addenda: [context('leg-1', 1, YELLOW, { previous: null })] }
    expect(workdayChainChecks([leg0(), unlinked], [leg0(), unlinked])).toEqual([{ kind: 'not_linked', leg: 2, link: '1' }])
  })
})

describe('downloadWorkdayPdf', () => {
  const COUNCIL = en.pdf.workday.councilLine
  const FOOTER = en.pdf.workday.footer
  const TITLE = en.pdf.workday.title
  const run = (chosen: ParkingSession[], all: ParkingSession[] = legs()) =>
    downloadWorkdayPdf({ legs: chosen, allLegs: all, workday: { id: WD, started_at: '2026-10-26T21:58:00.000Z', ended_at: null }, t, locale: 'en' })

  it('the spec wording, exactly', () => {
    expect(TITLE).toBe('Record of parking events.')
    expect(FOOTER).toBe('This records what you did and what you told us. It is not a legal finding that you complied. Your council decides that.')
    expect(COUNCIL).toBe("Councils may interpret this rule more strictly. Check your council's parking page.")
    expect(en.workday.pdf.warning).toBe(
      'This PDF includes every leg you choose, with distances between them and what you told us at each move. Councils can read it.',
    )
  })

  it('header on page 1 and at the top of every later page; the footer on every page', () => {
    expect(run(legs())).toBe(true)
    const pages = docs[0].getNumberOfPages()
    expect(pages).toBeGreaterThan(4)
    expect(drawn.find((d) => d.page === 1 && d.text === TITLE)?.size).toBe(22)
    for (let page = 1; page <= pages; page++) {
      expect(pageText(page), `page ${page}`).toContain(FOOTER)
      if (page > 1) expect(drawn.some((d) => d.page === page && d.text === TITLE), `page ${page}`).toBe(true)
    }
    expect(saved).toEqual(['parkproof-workday-aaaaaaaa.pdf'])
  })

  it('the cover: start time, the table with every column, the closing statement', () => {
    run(legs())
    const cover = pageText(1)
    expect(cover).toContain(`Workday started ${evidenceTime('2026-10-26T21:58:00.000Z', MEL)} (phone clock)`)
    expect(cover).toContain('Legs in this PDF: 3 of 3')
    for (const key of WORKDAY_COVER_COLUMNS) expect(cover).toContain(t(key))
    expect(cover).toContain('The driver said they passed a yellow edge line.')
    expect(cover).toContain(en.pdf.evidence.statement)
    expect(cover).not.toContain(en.pdf.workday.partial)
  })

  it("every leg's rule sheet starts with its heading and the council line, once per leg", () => {
    run(legs())
    const councilPages = drawn.filter((d) => d.text.startsWith('Councils may interpret')).map((d) => d.page)
    expect(councilPages).toHaveLength(3)
    for (const [i, page] of councilPages.entries()) {
      expect(drawn.some((d) => d.page === page && d.text === `Leg ${i + 1}` && d.size === 16)).toBe(true)
      // On the same page as the leg's sign rules.
      expect(pageText(page)).toContain(t('pdf.evidence.field.signRules'))
    }
  })

  it('prints only the chosen legs, says not every leg is in, and keeps distances about the leg before', () => {
    run([leg0(), leg2()])
    const all = text()
    expect(all).toContain('1 First St, Carlton VIC')
    expect(all).toContain('3 Third St, Carlton VIC')
    expect(all).not.toContain('2 Second St, Carlton VIC')
    expect(pageText(1)).toContain('Legs in this PDF: 2 of 3')
    expect(pageText(1)).toContain(en.pdf.workday.partial)
    expect(drawn.filter((d) => d.text.startsWith('Councils may interpret'))).toHaveLength(2)
    expect(drawn.some((d) => d.text === 'Leg 2')).toBe(false)
  })

  it('chained appendices: each leg\'s signature pages, then the step between legs', () => {
    run(legs())
    const all = text()
    // Leg 1 and leg 2 are signed: their pages carry their leg as the subtitle.
    expect(drawn.filter((d) => d.text === t('pdf.signature.title'))).toHaveLength(2)
    expect(drawn.filter((d) => d.text === 'Leg 1' && d.size === 11)).toHaveLength(1)
    expect(drawn.filter((d) => d.text === 'Leg 2' && d.size === 11)).toHaveLength(1)
    expect(all).toContain(en.pdf.workday.chain.heading)
    expect(all).toContain('openssl dgst -sha256 leg1/link2-payload.txt')
    expect(all).toContain('That hex value must equal previous_departure_payload_sha256 in leg 2, link 1.')
  })

  it('never prints permit details or the permit salt', () => {
    run(legs())
    const all = drawn.map((d) => d.text).join('')
    expect(all).not.toContain(SALT)
    expect(all).not.toContain(SALT.slice(0, 16))
    expect(all).not.toContain(AREA)
    expect(all).not.toContain(NOTE)
    // The signed details carry only the commitment (a hash), as in every PDF.
    expect(all).toContain(COMMITMENT)
  })

  it('draws and saves nothing with workday mode off', () => {
    flag.on = false
    expect(run(legs())).toBe(false)
    expect(docs).toHaveLength(0)
    expect(saved).toEqual([])
  })

  it('draws nothing for no legs, or for legs of another workday', () => {
    expect(run([])).toBe(false)
    const other = { ...leg0(), workday_id: 'bbbbbbbb-2222-4222-8222-222222222222' }
    expect(downloadWorkdayPdf({ legs: [other], workday: { id: WD, started_at: '', ended_at: null }, t, locale: 'en' })).toBe(false)
    expect(docs).toHaveLength(0)
  })
})

describe('downloadWorkdayPdf in a locale with its own PDF font', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('hi: drawn in Noto Sans Devanagari, the translated footer on every page', async () => {
    const fs = (await import('node:fs' as string)) as { readFileSync: (p: string) => Uint8Array }
    const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
    const bytes = fs.readFileSync(`${cwd}/public/fonts/NotoSansDevanagari.ttf`)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      })),
    )
    await prefetchPdfFont('hi')
    vi.unstubAllGlobals()
    await i18n.changeLanguage('hi')
    expect(downloadWorkdayPdf({ legs: legs(), workday: null, t, locale: 'hi' })).toBe(true)
    const footer = i18n.t('pdf.workday.footer')
    expect(footer).not.toBe(FOOTER_EN)
    const pages = docs[0].getNumberOfPages()
    for (let page = 1; page <= pages; page++) {
      const lines = drawn.filter((d) => d.page === page && footer.includes(d.text.trim()) && d.text.trim().length > 3)
      expect(lines.length, `page ${page}`).toBeGreaterThan(0)
      expect(lines.every((d) => d.font === 'NotoSansDevanagari')).toBe(true)
    }
    expect(drawn.some((d) => d.text.startsWith(i18n.t('pdf.workday.councilLine').slice(0, 10)))).toBe(true)
  })
})

const FOOTER_EN = en.pdf.workday.footer
