// @vitest-environment happy-dom
//
// Layout checks on the real jsPDF output (T1b review): the GPS accuracy
// notice's box grows with its wrapped body, so the last line stays inside
// it in en and in vi (drawn with the self-hosted Noto Sans), and the
// signature appendix draws a readable payload that courier can't draw in
// the locale's font, while the base64 blocks and commands stay in courier.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./api', () => ({ endpointUrl: (p: string) => `/api${p}` }))

type TextCall = { kind: 'text'; value: string | string[]; x: number; y: number; font: string; size: number; page: number }
type RectCall = { kind: 'rect'; x: number; y: number; w: number; h: number; page: number }
type DocLike = { getLineHeightFactor: () => number }

// Every text and rounded box drawn, with the font, size and page at the time.
const { calls, docs } = vi.hoisted(() => ({ calls: [] as Array<TextCall | RectCall>, docs: [] as unknown[] }))
vi.mock('jspdf', async (importOriginal) => {
  const mod = await importOriginal<typeof import('jspdf')>()
  type Doc = InstanceType<typeof mod.jsPDF>
  function Recording(...args: ConstructorParameters<typeof mod.jsPDF>): Doc {
    const doc = new mod.jsPDF(...args)
    const page = () => doc.getCurrentPageInfo().pageNumber
    const realText = doc.text.bind(doc) as (...a: unknown[]) => Doc
    ;(doc as unknown as { text: (...a: unknown[]) => Doc }).text = (...a: unknown[]) => {
      calls.push({
        kind: 'text',
        value: a[0] as string | string[],
        x: a[1] as number,
        y: a[2] as number,
        font: doc.getFont().fontName,
        size: doc.getFontSize(),
        page: page(),
      })
      return realText(...a)
    }
    const realRect = doc.roundedRect.bind(doc) as (...a: unknown[]) => Doc
    ;(doc as unknown as { roundedRect: (...a: unknown[]) => Doc }).roundedRect = (...a: unknown[]) => {
      calls.push({ kind: 'rect', x: a[0] as number, y: a[1] as number, w: a[2] as number, h: a[3] as number, page: page() })
      return realRect(...a)
    }
    ;(doc as unknown as { save: () => Doc }).save = () => doc
    docs.push(doc)
    return doc
  }
  Recording.API = mod.jsPDF.API
  return { ...mod, jsPDF: Recording, default: Recording }
})

import i18n from './i18n'
import type { ParkingSession, SignatureBundle } from '../types'
import { base64Utf8, downloadPdf } from './pdf'
import { prefetchPdfFont } from './pdf-fonts'

async function readFont(name: string): Promise<Uint8Array> {
  // node:fs through a dynamic import, so the browser tsconfig needs no Node types.
  // happy-dom gives import.meta.url an http URL, so resolve from the project root vitest runs in.
  const fs = (await import('node:fs' as string)) as { readFileSync: (p: string) => Uint8Array }
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
  return fs.readFileSync(`${cwd}/public/fonts/${name}`)
}

/** Load a locale's self-hosted PDF font the way the app does, from public/fonts. */
async function loadFont(locale: string, file: string): Promise<void> {
  const bytes = await readFont(file)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    })),
  )
  await prefetchPdfFont(locale)
  vi.unstubAllGlobals()
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-layout',
    arrived_at: '2026-10-24T23:55:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 450 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: '2026-10-25T01:55:00.000Z',
    confidence: 'high',
    ...overrides,
  }
}

function linkZero(payload: Record<string, unknown>): SignatureBundle {
  return {
    schema: 'parkproof-evidence-v1',
    signed_at: '2026-10-24T23:55:04.000Z',
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify({ schema: 'parkproof-evidence-v1', session_id: 'rec-layout', signed_at: '2026-10-24T23:55:04.000Z', ...payload }),
    signature_base64: 'MEUCIQDsig',
  }
}

const texts = () => calls.filter((c): c is TextCall => c.kind === 'text')
const rects = () => calls.filter((c): c is RectCall => c.kind === 'rect')

beforeAll(async () => {
  await loadFont('vi', 'NotoSans.ttf')
  await loadFont('zh-CN', 'NotoSansSC.ttf')
})
afterEach(async () => {
  calls.length = 0
  docs.length = 0
  localStorage.clear()
  await i18n.changeLanguage('en')
})

describe('the GPS accuracy notice', () => {
  for (const [locale, font] of [
    ['en', 'helvetica'],
    ['vi', 'NotoSans'],
  ] as const) {
    it(`${locale}: the box holds every line of the body, and the next text starts below it`, async () => {
      await i18n.changeLanguage(locale)
      downloadPdf(record(), i18n.t, locale)
      const title = i18n.t('pdf.evidence.gpsNoticeTitle')
      const titleCall = texts().find((c) => c.value === title)!
      expect(titleCall).toBeDefined()
      const box = rects().find((r) => r.page === titleCall.page && r.y < titleCall.y && titleCall.y < r.y + r.h)!
      expect(box).toBeDefined()
      const body = texts().find((c) => Array.isArray(c.value) && c.page === box.page && c.y > titleCall.y)!
      const lines = body.value as string[]
      expect(body.font).toBe(font)
      expect(lines.join(' ')).toContain(i18n.t('pdf.evidence.gpsNoticeBody', { accuracy: '±450m' }).slice(0, 20))
      expect(lines.length).toBeGreaterThanOrEqual(locale === 'vi' ? 4 : 3)
      // The last baseline plus the descent stays inside the box.
      const lineHeight = body.size * (docs[0] as DocLike).getLineHeightFactor()
      const lastBaseline = body.y + (lines.length - 1) * lineHeight
      expect(lastBaseline + body.size * 0.3).toBeLessThanOrEqual(box.y + box.h)
      // The closing statement comes after the box, not over it.
      const statement = texts().find((c) => c.page === box.page && c.y > box.y && String(c.value).startsWith(i18n.t('pdf.evidence.statement').slice(0, 12)))!
      expect(statement).toBeDefined()
      expect(statement.y).toBeGreaterThan(box.y + box.h)
    })
  }
})

describe("the appendix's readable payload", () => {
  it('stays in courier when courier can draw it; base64 and commands are always courier', async () => {
    downloadPdf(record({ signature: linkZero({ address: '12 King St' }) }), i18n.t, 'en')
    const payloadLine = texts().find((c) => typeof c.value === 'string' && c.value.startsWith('{"schema":"parkproof-evidence-v1"'))!
    expect(payloadLine.font).toBe('courier')
    const b64 = base64Utf8(linkZero({ address: '12 King St' }).canonical_payload)
    expect(texts().find((c) => typeof c.value === 'string' && b64.startsWith(c.value) && c.value.length > 20)?.font).toBe('courier')
    expect(texts().find((c) => typeof c.value === 'string' && c.value.includes('base64 -d link0-payload.b64'))?.font).toBe('courier')
  })

  it("a non-Latin address (zh-CN) is drawn in the locale's font, not as courier garbage", async () => {
    await i18n.changeLanguage('zh-CN')
    const bundle = linkZero({ address: '墨尔本 King St 12 号' })
    downloadPdf(record({ signature: bundle }), i18n.t, 'zh-CN')
    const payloadLines = texts().filter((c) => typeof c.value === 'string' && c.size === 7 && bundle.canonical_payload.includes(c.value as string) && (c.value as string).length > 10)
    expect(payloadLines.length).toBeGreaterThan(0)
    for (const line of payloadLines) expect(line.font).toBe('NotoSansSC')
    // The base64 copy (what the check decodes) is still courier.
    const b64 = base64Utf8(bundle.canonical_payload)
    const b64Lines = texts().filter((c) => typeof c.value === 'string' && (c.value as string).length > 20 && b64.includes(c.value as string))
    expect(b64Lines.length).toBeGreaterThan(0)
    for (const line of b64Lines) expect(line.font).toBe('courier')
    // The heading uses the PDF-only part name, in characters the subset font has.
    expect(texts().some((c) => c.value === `环节 0:${i18n.t('pdf.signature.kind.arrival')}`)).toBe(true)
  })
})
