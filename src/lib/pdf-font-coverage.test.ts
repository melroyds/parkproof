// @vitest-environment node
//
// Every character a PDF draws must be in the font that draws it. The Noto
// fonts in public/fonts are subsets built by scripts/_subset_pdf_fonts.py
// from the locale strings of the day, and a subset can't gain glyphs: a new
// PDF string with a character the subset lacks prints a blank in that
// locale's PDF. en, it and id use jsPDF's built-in Helvetica, which only
// has the WinAnsi (cp1252) characters.
//
// The PDF strings are the pdf.* keys: every string a PDF draws goes
// through one (the appendix's link headings use pdf.signature.kind.*, the
// PDF-only twins of the screen's chain.kind.*). A string that needs a
// character its subset lacks is reworded (scripts/_i18n_inject_t1b.mjs
// LOCALE_OVERWRITES shows how) or the fonts are re-subset from the full
// Noto files (scripts/_subset_pdf_fonts.py).
//
// KNOWN_GAPS would allowlist a gap by key AND character, so a gap in one
// string never hides the same character in another. It is empty: keep it so.
import { describe, expect, it } from 'vitest'
import en from '../locales/en.json'
import it_ from '../locales/it.json'
import id from '../locales/id.json'
import zhCN from '../locales/zh-CN.json'
import ko from '../locales/ko.json'
import vi from '../locales/vi.json'
import el from '../locales/el.json'
import hi from '../locales/hi.json'
import pa from '../locales/pa.json'
import { formatInZone } from './time-format'

/** locale -> key path -> the characters allowed to be missing in that one string. */
const KNOWN_GAPS: Record<string, Record<string, string>> = {}

const isKnownGap = (locale: string, path: string, ch: string): boolean =>
  (KNOWN_GAPS[locale]?.[path] ?? '').includes(ch)

const NOTO: Array<[string, unknown, string]> = [
  ['zh-CN', zhCN, 'NotoSansSC.ttf'],
  ['ko', ko, 'NotoSansKR.ttf'],
  ['vi', vi, 'NotoSans.ttf'],
  ['el', el, 'NotoSans.ttf'],
  ['hi', hi, 'NotoSansDevanagari.ttf'],
  ['pa', pa, 'NotoSansGurmukhi.ttf'],
]

/** Every string a PDF draws for a locale: the pdf.* keys. */
function pdfStrings(data: unknown): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      if (path.startsWith('pdf.')) out.push([path, value])
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k)
    }
  }
  walk(data, '')
  return out
}

/** The code points a TrueType font maps to a glyph (its best Unicode cmap subtable, format 4 or 12). */
function cmapCodePoints(bytes: Uint8Array): Set<number> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const numTables = view.getUint16(4)
  let cmap = -1
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + 16 * i
    const tag = String.fromCharCode(...bytes.subarray(rec, rec + 4))
    if (tag === 'cmap') cmap = view.getUint32(rec + 8)
  }
  if (cmap < 0) throw new Error('no cmap table')
  const subtables: Array<{ platform: number; encoding: number; offset: number }> = []
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const rec = cmap + 4 + 8 * i
    subtables.push({ platform: view.getUint16(rec), encoding: view.getUint16(rec + 2), offset: cmap + view.getUint32(rec + 4) })
  }
  const pick =
    subtables.find((s) => s.platform === 3 && s.encoding === 10) ??
    subtables.find((s) => s.platform === 0 && view.getUint16(s.offset) === 12) ??
    subtables.find((s) => s.platform === 3 && s.encoding === 1) ??
    subtables.find((s) => s.platform === 0)
  if (!pick) throw new Error('no Unicode cmap')
  const at = pick.offset
  const format = view.getUint16(at)
  const points = new Set<number>()
  if (format === 12) {
    const groups = view.getUint32(at + 12)
    for (let g = 0; g < groups; g++) {
      const start = view.getUint32(at + 16 + 12 * g)
      const end = view.getUint32(at + 20 + 12 * g)
      const glyph = view.getUint32(at + 24 + 12 * g)
      for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) points.add(c)
    }
  } else if (format === 4) {
    const segs = view.getUint16(at + 6) / 2
    const ends = at + 14
    const starts = ends + 2 * segs + 2
    const deltas = starts + 2 * segs
    const rangeOffsets = deltas + 2 * segs
    for (let s = 0; s < segs; s++) {
      const end = view.getUint16(ends + 2 * s)
      const start = view.getUint16(starts + 2 * s)
      const delta = view.getInt16(deltas + 2 * s)
      const rangeOffset = view.getUint16(rangeOffsets + 2 * s)
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph: number
        if (rangeOffset === 0) glyph = (c + delta) & 0xffff
        else {
          const raw = view.getUint16(rangeOffsets + 2 * s + rangeOffset + 2 * (c - start))
          glyph = raw === 0 ? 0 : (raw + delta) & 0xffff
        }
        if (glyph !== 0) points.add(c)
      }
    }
  } else {
    throw new Error(`cmap format ${format} not handled`)
  }
  return points
}

async function readFont(name: string): Promise<Uint8Array> {
  // node:fs through a dynamic import, so the browser tsconfig needs no Node types.
  const fs = (await import('node:fs' as string)) as { readFileSync: (p: URL) => Uint8Array }
  return fs.readFileSync(new URL(`../../public/fonts/${name}`, import.meta.url))
}

/** jsPDF's Helvetica: WinAnsi (cp1252) printable characters. */
const WIN_ANSI_EXTRA = new Set(Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ', (c) => c.codePointAt(0)!))
const inWinAnsi = (cp: number) => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp)

/**
 * Characters the PDF code draws outside the locale strings: times
 * (formatInZone, en-AU in every locale), coordinates, distances, the
 * accuracy figures after their plus-or-minus sign (a locale string), record
 * ids, the map link, and the signed payloads' JSON.
 */
function runtimeCharacters(): Set<string> {
  const chars = new Set<string>()
  for (let c = 0x21; c <= 0x7e; c++) chars.add(String.fromCharCode(c))
  const zones = ['Australia/Melbourne', 'Australia/Sydney', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Darwin', 'Australia/Perth', 'Australia/Hobart', 'Australia/Lord_Howe']
  for (const tz of zones) {
    for (let month = 0; month < 12; month++) {
      for (const hour of [0, 13]) {
        for (const ch of formatInZone(Date.UTC(2026, month, 15, hour, 5), tz, { withYear: true })) chars.add(ch)
      }
    }
  }
  return chars
}

describe('PDF strings are covered by the PDF fonts', () => {
  for (const [locale, data, font] of NOTO) {
    it(`${locale}: every character is in ${font}`, async () => {
      const points = cmapCodePoints(await readFont(font))
      const gaps: string[] = []
      for (const [path, s] of pdfStrings(data)) {
        for (const ch of s) {
          const cp = ch.codePointAt(0)!
          if (/\s/.test(ch) || points.has(cp) || isKnownGap(locale, path, ch)) continue
          gaps.push(`${path}: ${ch} (U+${cp.toString(16).toUpperCase()})`)
        }
      }
      expect(gaps).toEqual([])
    })
  }

  it('no known gaps are allowlisted', () => {
    expect(KNOWN_GAPS).toEqual({})
  })

  for (const [locale, , font] of NOTO) {
    it(`${locale}: the characters the PDF code inserts (times, numbers, ids, JSON) are in ${font}`, async () => {
      const points = cmapCodePoints(await readFont(font))
      const missing = [...runtimeCharacters()].filter((ch) => !/\s/.test(ch) && !points.has(ch.codePointAt(0)!))
      expect(missing).toEqual([])
    })
  }

  it('the PDF times are plain ASCII, so the built-in Helvetica draws them too', () => {
    expect([...runtimeCharacters()].filter((ch) => !inWinAnsi(ch.codePointAt(0)!))).toEqual([])
  })

  it('the hi and pa fonts have no ± (the reason for pdf.common.plusMinus)', async () => {
    for (const font of ['NotoSansDevanagari.ttf', 'NotoSansGurmukhi.ttf']) {
      expect(cmapCodePoints(await readFont(font)).has(0xb1)).toBe(false)
    }
    expect((hi as { pdf: { common: { plusMinus: string } } }).pdf.common.plusMinus).not.toContain('±')
    expect((pa as { pdf: { common: { plusMinus: string } } }).pdf.common.plusMinus).not.toContain('±')
  })

  for (const [locale, data] of [['en', en], ['it', it_], ['id', id]] as const) {
    it(`${locale}: every character is a WinAnsi character (jsPDF Helvetica)`, () => {
      const gaps = pdfStrings(data).flatMap(([path, s]) =>
        Array.from(s).filter((ch) => !inWinAnsi(ch.codePointAt(0)!)).map((ch) => `${path}: ${ch}`),
      )
      expect(gaps).toEqual([])
    })
  }

  it('the cmap reader agrees with the font on a few known characters', async () => {
    const sc = cmapCodePoints(await readFont('NotoSansSC.ttf'))
    expect(sc.has('签'.codePointAt(0)!)).toBe(true)
    expect(sc.has('A'.codePointAt(0)!)).toBe(true)
    expect(sc.has('按'.codePointAt(0)!)).toBe(false)
  })
})

describe('PDF strings follow the copy rules for PDFs', () => {
  const ALL: Array<[string, unknown]> = [['en', en], ['it', it_], ['id', id], ...NOTO.map(([l, d]) => [l, d] as [string, unknown])]
  for (const [locale, data] of ALL) {
    it(`${locale}: no em-dash and no symbol the PDF fonts can't draw`, () => {
      const bad = pdfStrings(data)
        .filter(([, s]) => /[—✓⚠→≈≤]|[\u{1F300}-\u{1FAFF}]/u.test(s))
        .map(([path]) => path)
      expect(bad).toEqual([])
    })
  }
})
