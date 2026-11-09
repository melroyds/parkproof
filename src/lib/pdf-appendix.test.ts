// @vitest-environment happy-dom
//
// The chained signature appendix and the three PDF entry points (spec T1b
// items 2 to 5). The appendix prints link 0 and every signed addendum, each
// with its heading and its own file names (link0-payload.b64, link1-...),
// and the chain step (`openssl dgst -sha256 link0-payload.txt` prints the
// hex that must equal `parent_payload_sha256` in link 1). On a chain signed by the REAL Lambda
// handler the printed base64 decodes to the signed bytes and the chain step
// holds. The evidence PDF, the appeal PDF and the full export all draw the
// same record block (with the departure rows) and the appendix, and every
// time in them carries its zone name.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

// Every string drawn into a PDF, every page count, and no real download.
const { drawn, docs } = vi.hoisted(() => ({ drawn: [] as string[], docs: [] as Array<{ getNumberOfPages: () => number }> }))
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
    docs.push(doc)
    return doc
  }
  Recording.API = mod.jsPDF.API
  return { ...mod, jsPDF: Recording, default: Recording }
})

import i18n from './i18n'
import type { ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import { DEV_KEY_ALIAS, emptyLogDraft } from './evidence-chain'
import {
  appendixFileNames,
  appendixLinks,
  base64Utf8,
  downloadAppealPdf,
  downloadFullExportPdf,
  downloadPdf,
} from './pdf'
import { completeDeparture, type DepartureFixRequest } from './departure'
import { endSession, getSession, saveSession } from './storage'
import { prepareNewRecord, resetSigningQueueForTests, signNewRecord, whenSigningIdle } from './signing'
import { createTestSigner } from './test-support/test-signer'

const GPS = { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps' as const, accuracy_meters: 8 }

function bundle(payload: Record<string, unknown>, overrides: Partial<SignatureBundle> = {}): SignatureBundle {
  return {
    schema: String(payload.schema),
    signed_at: String(payload.signed_at),
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify(payload),
    signature_base64: `MEUCI-${String(payload.addendum_id ?? 'link0')}-${String(payload.signed_at)}`,
    ...overrides,
  }
}

const LINK0 = bundle({ schema: 'parkproof-evidence-v1', session_id: 'rec-app', arrived_at: '2026-10-24T23:55:00.000Z', signed_at: '2026-10-24T23:55:04.000Z' })

function addendum(
  id: string,
  seq: number,
  kind: SignedAddendum['kind'],
  state: 'signed' | 'pending' | 'rejected' | 'dev' = 'signed',
  signedAt = `2026-10-25T00:0${seq}:00.000Z`,
): SignedAddendum {
  const a: SignedAddendum = { id, seq, kind, captured_at: '2026-10-25T00:00:00.000Z', data: {} }
  if (state === 'signed' || state === 'dev') {
    a.bundle = bundle(
      { schema: 'parkproof-addendum-v1', addendum_id: id, kind, seq, signed_at: signedAt, data: {} },
      { schema: 'parkproof-addendum-v1', ...(state === 'dev' ? { key_alias: DEV_KEY_ALIAS } : {}) },
    )
  }
  if (state === 'rejected') a.rejected = { code: 'ERR_BAD_STRING', at: '2026-10-25T00:00:00.000Z' }
  return a
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-app',
    arrived_at: '2026-10-24T23:55:00.000Z',
    location: GPS,
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: '2026-10-25T01:55:00.000Z',
    confidence: 'high',
    ...overrides,
  }
}

const text = () => drawn.join(' ')
const DRAFT = {
  ticket_summary: 'Notice 123',
  appeal_subject: 'Appeal: Infringement Notice 123',
  appeal_letter: 'To the council.',
  evidence_strength: 'moderate' as const,
  notes: '',
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  drawn.length = 0
  docs.length = 0
})
afterEach(() => {
  localStorage.clear()
  resetSigningQueueForTests()
  vi.unstubAllGlobals()
})

describe('appendixLinks', () => {
  it('nothing for an unsigned record or a shared copy', () => {
    expect(appendixLinks(record())).toEqual([])
    const shared = record({
      signature: LINK0,
      shared_from: { original_session_id: 'x', received_at: '2026-10-25T00:00:00.000Z', shared_at: null, arrival_bundle: LINK0, snapshot: {} },
    })
    expect(appendixLinks(shared)).toEqual([])
  })

  it('link 0, then every signed addendum by seq, each naming the link before it', () => {
    const s = record({
      signature: LINK0,
      addenda: [addendum('dep', 2, 'departure'), addendum('ctx', 1, 'arrival_context'), addendum('cond', 3, 'condition', 'pending')],
    })
    expect(appendixLinks(s).map((l) => ({ name: l.name, kind: l.kind, forked: l.forked, parents: l.parents }))).toEqual([
      { name: '0', kind: 'arrival', forked: false, parents: [] },
      { name: '1', kind: 'arrival_context', forked: false, parents: ['0'] },
      { name: '2', kind: 'departure', forked: false, parents: ['1'] },
    ])
  })

  it('leaves out refused and incomplete parts and prints a duplicated signed copy once', () => {
    const ctx = addendum('ctx', 1, 'arrival_context')
    const broken = addendum('dep', 2, 'departure')
    broken.bundle = { ...broken.bundle!, signature_base64: '' }
    const s = record({ signature: LINK0, addenda: [ctx, { ...ctx }, addendum('x', 2, 'condition', 'rejected'), broken] })
    expect(appendixLinks(s).map((l) => l.name)).toEqual(['0', '1'])
  })

  it('an incomplete link 0 (the deploy-bug empty object) is left out, the addenda stay', () => {
    const s = record({ signature: {} as SignatureBundle, addenda: [addendum('ctx', 1, 'arrival_context')] })
    expect(appendixLinks(s).map((l) => `${l.name}<${l.parents.join(',')}>`)).toEqual(['1<>'])
  })

  it('a fork: two signed links at one seq are printed as 2a and 2b, and link 3 names both', () => {
    const s = record({
      signature: LINK0,
      addenda: [
        addendum('ctx', 1, 'arrival_context'),
        addendum('cond-b', 2, 'condition', 'signed', '2026-10-25T00:05:00.000Z'),
        addendum('cond-a', 2, 'compliance', 'signed', '2026-10-25T00:04:00.000Z'),
        addendum('dep', 3, 'departure'),
      ],
    })
    expect(appendixLinks(s).map((l) => `${l.name}:${l.kind}:${l.forked ? 'fork' : '-'}<${l.parents.join(',')}>`)).toEqual([
      '0:arrival:-<>',
      '1:arrival_context:-<0>',
      '2a:compliance:fork<1>',
      '2b:condition:fork<1>',
      '3:departure:-<2a,2b>',
    ])
  })

  it('uses the seq the payload signs, and skips a kind no screen knows', () => {
    const renumbered = addendum('ctx', 1, 'arrival_context')
    const odd = addendum('odd', 2, 'departure')
    ;(odd as { kind: string }).kind = 'mystery'
    const s = record({ signature: LINK0, addenda: [{ ...renumbered, seq: 7 }, odd] })
    expect(appendixLinks(s).map((l) => `${l.name}:${l.seq}`)).toEqual(['0:0', '1:1'])
  })

  it('file names follow the link name', () => {
    expect(appendixFileNames('0')).toEqual({
      payloadB64: 'link0-payload.b64',
      payloadTxt: 'link0-payload.txt',
      sigB64: 'link0-sig.b64',
      sigBin: 'link0-sig.bin',
    })
    expect(appendixFileNames('2b').payloadB64).toBe('link2b-payload.b64')
  })
})

describe('the appendix in the evidence PDF', () => {
  it('prints a heading, the file names and the chain step for each link', () => {
    downloadPdf(record({ signature: LINK0, addenda: [addendum('ctx', 1, 'arrival_context'), addendum('dep', 2, 'departure')] }), i18n.t, 'en')
    const all = text()
    for (const heading of ['Link 0: Arrival', 'Link 1: Details at parking', 'Link 2: Departure']) expect(all).toContain(heading)
    for (const file of ['link0-payload.b64', 'link1-payload.b64', 'link2-payload.b64', 'link0-sig.b64', 'link2-sig.b64']) {
      expect(all).toContain(file)
    }
    expect(all).toContain('base64 -d link0-payload.b64 > link0-payload.txt')
    expect(all).toContain('-signature link0-sig.bin link0-payload.txt')
    expect(all).toContain('openssl dgst -sha256 link0-payload.txt')
    expect(all).toContain('That hex value must equal parent_payload_sha256 in link 1.')
    expect(all).toContain('openssl dgst -sha256 link1-payload.txt')
    expect(all).toContain('That hex value must equal parent_payload_sha256 in link 2.')
    expect(all).toContain('sha256sum, where you have it, prints the same value')
    expect(all).toContain('Do steps 1, 2, 4, 5 and 6 for each link')
    // The new copy, not the old.
    expect(all).toContain('This shows the signed bytes have not changed since ParkProof signed them.')
    // T2 rewrote the photo step (pdf.signature.verifyStep7 and verifyPhotoMatch); the T1b wording stays out.
    expect(all).toContain('Step 6 showed the signed values have not changed since ParkProof signed them.')
    expect(all).not.toMatch(/authentic|proved/)
  })

  it('a single-link record gets no chain step and no repeat line', () => {
    downloadPdf(record({ signature: LINK0 }), i18n.t, 'en')
    expect(text()).toContain('Link 0: Arrival')
    expect(text()).not.toContain('dgst -sha256 link0-payload.txt')
    expect(text()).not.toContain('Check the links are joined')
    expect(text()).not.toContain('for each link')
  })

  it('a fork lists both candidate parents with "one of these"', () => {
    downloadPdf(
      record({
        signature: LINK0,
        addenda: [
          addendum('ctx', 1, 'arrival_context'),
          addendum('a', 2, 'condition'),
          addendum('b', 2, 'compliance'),
          addendum('dep', 3, 'departure'),
        ],
      }),
      i18n.t,
      'en',
    )
    expect(text()).toContain('Two parts were added at this point in the record, from two devices.')
    expect(text()).toContain('openssl dgst -sha256 link2a-payload.txt')
    expect(text()).toContain('openssl dgst -sha256 link2b-payload.txt')
    expect(text()).toContain('One of these hex values must equal parent_payload_sha256 in link 3.')
  })

  it('opens with the development-key line for a dev-key chain', () => {
    downloadPdf(record({ signature: { ...LINK0, key_alias: DEV_KEY_ALIAS } }), i18n.t, 'en')
    expect(text()).toContain("Signed with a development key. It can't be checked with ParkProof's published key.")
  })

  it('an unsigned record gets no appendix page', () => {
    downloadPdf(record(), i18n.t, 'en')
    expect(text()).not.toContain(i18n.t('pdf.signature.title'))
    expect(docs[0].getNumberOfPages()).toBe(1)
  })

  it('the record page: the new statement, the departure rows, and only zoned times', () => {
    downloadPdf(
      record({
        signature: LINK0,
        ended_at: '2026-10-25T01:30:00.000Z',
        addenda: [
          {
            id: 'dep',
            seq: 1,
            kind: 'departure',
            captured_at: '2026-10-25T01:30:00.000Z',
            data: { ended_at: '2026-10-25T01:30:00.000Z', location: { lat: -37.8118, lng: 144.9631, accuracy_meters: 11, source: 'gps' }, distance_from_arrival_m: 200, return_photos: [] },
          },
        ],
      }),
      i18n.t,
      'en',
    )
    const all = text()
    expect(all).toContain('This is a record of a parking event made with ParkProof.')
    expect(all).toContain('The council or court decides that.')
    expect(all).not.toContain('contemporaneous evidence record')
    expect(all).toContain('-37.811800, 144.963100, accuracy ±11m')
    expect(all).toContain('200 m')
    expect(all).toContain('Not signed yet')
    expect(all).toContain('Sun 25 Oct 2026, 12:30 pm AEDT')
    // No device-format date like "25/10/2026, 11:00:00 am".
    expect(all).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
  })
})

describe('the appeal PDF and the full export get the block and the appendix (T1b items 2 and 4)', () => {
  const signed = () => record({ signature: LINK0, addenda: [addendum('ctx', 1, 'arrival_context')] })

  it('the appeal PDF: the record table, the statement and the appendix', () => {
    downloadAppealPdf({ session: signed(), draft: DRAFT, editedLetter: 'To the council.', ticketPhoto: 'data:image/jpeg;base64,AAAA', t: i18n.t, locale: 'en' })
    const all = text()
    expect(all).toContain('Logged (phone clock)')
    expect(all).toContain('This is a record of a parking event made with ParkProof.')
    expect(all).toContain('Link 0: Arrival')
    expect(all).toContain('Link 1: Details at parking')
    expect(all).toContain('openssl dgst -sha256 link0-payload.txt')
    expect(all).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
  })

  it('the full export: one appendix per signed record, titled with the record', () => {
    downloadFullExportPdf(
      {
        exported_at: '2026-10-26T00:00:00.000Z',
        schema: 'parkproof-export-v1',
        account: { user_id: 'u-1', email: null, created_at: null },
        sessions: [signed(), record({ id: 'rec-2' })],
      },
      i18n.t,
      'en',
    )
    const all = text()
    expect(all).toContain('Record 1 of 2')
    expect(all).toContain('Record 2 of 2')
    expect(drawn.filter((s) => s === i18n.t('pdf.signature.title'))).toHaveLength(1)
    expect(all).toContain('Link 1: Details at parking')
    expect(all).toContain('Cryptographically signed at Sun 25 Oct 2026, 10:55 am AEDT')
    expect(all).toContain('Logged (phone clock)')
    expect(all).not.toContain('export the individual record PDF')
    expect(all).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
  })
})

describe('the car photo caption', () => {
  // A valid 1x1 JPEG: drawn square, so 200 pt wide in the export.
  const JPEG =
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='

  it('labels the logged time as the phone clock and wraps inside a narrow photo', () => {
    downloadFullExportPdf(
      {
        exported_at: '2026-10-26T00:00:00.000Z',
        schema: 'parkproof-export-v1',
        account: { user_id: 'u-1', email: null, created_at: null },
        sessions: [record({ car_photo: JPEG })],
      },
      i18n.t,
      'en',
    )
    expect(text()).toContain('Logged Sun 25 Oct 2026, 10:55 am AEDT (phone clock)')
    const doc = docs[0] as unknown as { setFont: (f: string, s: string) => void; setFontSize: (n: number) => void; getTextWidth: (s: string) => number }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const captionLines = drawn.filter((s) => s.includes('Logged') || s.includes('(phone clock)') || s.includes('AEDT ('))
    expect(captionLines.length).toBeGreaterThan(1)
    // The pill is the photo's width less 20 pt, with 8 pt padding each side.
    for (const line of captionLines.filter((s) => !s.startsWith('Logged (phone'))) {
      expect(doc.getTextWidth(line)).toBeLessThanOrEqual(200 - 20 - 16)
    }
  })
})

describe('on a chain signed by the real Lambda handler', () => {
  it('the printed base64 is the signed bytes, and the chain step holds for every link', async () => {
    const signer = await createTestSigner()
    vi.stubGlobal('fetch', vi.fn(signer.fetch))
    const prepared = await prepareNewRecord(
      record({ id: 'rec-real', arrived_at: new Date(Date.now() - 30 * 60_000).toISOString(), sign_photo: 'data:image/jpeg;base64,' + btoa('sign-bytes'), expires_at: null }),
    )
    saveSession(prepared)
    signNewRecord(prepared.id, emptyLogDraft())
    await whenSigningIdle(prepared.id)
    const tap = new Date()
    endSession(prepared.id, tap)
    const fix = { lat: -37.8118, lng: 144.9631, accuracy_meters: 11, received_at: tap.getTime() }
    const request: DepartureFixRequest = {
      current: () => ({ status: 'ok', fix }),
      settled: Promise.resolve({ status: 'ok', fix }),
      subscribe: () => () => {},
    }
    await completeDeparture(prepared.id, tap.toISOString(), request)
    await whenSigningIdle(prepared.id)
    const s = getSession(prepared.id)!

    const links = appendixLinks(s)
    expect(links.map((l) => `${l.name}:${l.kind}`)).toEqual(['0:arrival', '1:arrival_context', '2:departure'])
    for (const link of links.slice(1)) {
      const parent = links.find((p) => p.name === link.parents[0])!
      // What `openssl dgst -sha256 linkN-payload.txt` prints, after `base64 -d` of the printed block.
      const decoded = Uint8Array.from(atob(base64Utf8(parent.bundle.canonical_payload)), (c) => c.charCodeAt(0))
      expect(new TextDecoder().decode(decoded)).toBe(parent.bundle.canonical_payload)
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', decoded))
      const sha = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
      expect(JSON.parse(link.bundle.canonical_payload).parent_payload_sha256).toBe(sha)
    }

    downloadPdf(s, i18n.t, 'en')
    const joined = drawn.join('')
    for (const link of links) {
      expect(joined).toContain(base64Utf8(link.bundle.canonical_payload))
      expect(joined).toContain(link.bundle.signature_base64)
    }
    expect(text()).toContain('Link 2: Departure')
    expect(text()).toContain('Departure signed by ParkProof')
  })
})
