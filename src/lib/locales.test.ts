// Locale parity: every translation file has exactly the keys en.json has,
// with the same shape, the same {{vars}} and <tags>, and plural pairs that
// i18next can resolve in every language.
//
// Why each rule exists:
//   - A missing key silently falls back to English mid-screen.
//   - A missing or renamed {{var}} prints the raw placeholder, or drops a
//     time or address from the sentence. A missing <tag> breaks the Trans
//     components that bold or link part of a string.
//   - zh-CN, vi, id and ko have only an _other plural form. A concept split
//     across two base names (hourLeft_one + hoursLeft_other) has no _other
//     for its singular, so those locales fell back to English for "1 hour".
//   - hi and pa use their _one form for 0 as well as 1, so a _one string
//     that hardcodes "1" shows "1 minute" when the count is 0.
//
// The script that writes locale keys (scripts/_i18n_inject_<task>.mjs)
// applies the same checks before writing; this test keeps them true.
import { describe, it, expect } from 'vitest'
import en from '../locales/en.json'
import zhCN from '../locales/zh-CN.json'
import vi from '../locales/vi.json'
import id from '../locales/id.json'
import ko from '../locales/ko.json'
import it_ from '../locales/it.json'
import el from '../locales/el.json'
import hi from '../locales/hi.json'
import pa from '../locales/pa.json'

const LOCALES: Record<string, unknown> = {
  en,
  'zh-CN': zhCN,
  vi,
  id,
  ko,
  it: it_,
  el,
  hi,
  pa,
}
const NON_EN = Object.keys(LOCALES).filter((l) => l !== 'en')

type Leaf = string | number | boolean | null | { array: number }

/** Flatten to dotted paths; arrays become `path[i]` plus a `path` length entry. */
function flatten(value: unknown, prefix = '', out: Record<string, Leaf> = {}): Record<string, Leaf> {
  if (Array.isArray(value)) {
    out[prefix] = { array: value.length }
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out))
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  } else {
    out[prefix] = value as Leaf
  }
  return out
}

const FLAT: Record<string, Record<string, Leaf>> = Object.fromEntries(
  Object.entries(LOCALES).map(([l, data]) => [l, flatten(data)]),
)
const EN = FLAT.en

function stringEntries(flat: Record<string, Leaf>): [string, string][] {
  return Object.entries(flat).filter((e): e is [string, string] => typeof e[1] === 'string')
}

function varsOf(s: string, key: string): string[] {
  const names = new Set((s.match(/\{\{\s*[\w.]+\s*\}\}/g) ?? []).map((m) => m.replace(/[{}\s]/g, '')))
  // A language may write its singular without the number ("1 hour", "an
  // hour"), so {{count}} is not compared on _one keys. The hi/pa rule below
  // covers the languages where that would be a bug.
  if (key.endsWith('_one')) names.delete('count')
  return [...names].sort()
}

function tagsOf(s: string): string[] {
  return [...new Set(s.match(/<\/?[a-zA-Z][\w-]*\s*\/?>/g) ?? [])].sort()
}

describe('locale parity with en.json', () => {
  it.each(NON_EN)('%s has exactly the same flattened keys as en', (locale) => {
    const keys = Object.keys(FLAT[locale])
    const missing = Object.keys(EN).filter((k) => !(k in FLAT[locale]))
    const extra = keys.filter((k) => !(k in EN))
    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  it.each(NON_EN)('%s has arrays of the same length as en', (locale) => {
    const mismatched = Object.entries(EN)
      .filter(([, v]) => v !== null && typeof v === 'object')
      .filter(([k, v]) => {
        const other = FLAT[locale][k]
        return !(other && typeof other === 'object' && other.array === (v as { array: number }).array)
      })
      .map(([k]) => k)
    expect(mismatched).toEqual([])
  })

  it.each(NON_EN)('%s uses the same {{vars}} as en in every string', (locale) => {
    const mismatched = stringEntries(EN)
      .filter(([k]) => typeof FLAT[locale][k] === 'string')
      .filter(([k, v]) => varsOf(FLAT[locale][k] as string, k).join() !== varsOf(v, k).join())
      .map(([k]) => `${k}: en {${varsOf(EN[k] as string, k)}} vs {${varsOf(FLAT[locale][k] as string, k)}}`)
    expect(mismatched).toEqual([])
  })

  it.each(NON_EN)('%s uses the same <tags> as en in every string', (locale) => {
    const mismatched = stringEntries(EN)
      .filter(([k]) => typeof FLAT[locale][k] === 'string')
      .filter(([k, v]) => tagsOf(FLAT[locale][k] as string).join() !== tagsOf(v).join())
      .map(([k]) => k)
    expect(mismatched).toEqual([])
  })
})

describe('plural keys', () => {
  it.each(Object.keys(LOCALES))('%s: every _one key has an _other sibling with the same base', (locale) => {
    const flat = FLAT[locale]
    const orphans = Object.keys(flat)
      .filter((k) => k.endsWith('_one'))
      .filter((k) => !(`${k.slice(0, -'_one'.length)}_other` in flat))
    expect(orphans).toEqual([])
  })

  it.each(['hi', 'pa'])('%s: every _one string contains {{count}} (its _one form also covers 0)', (locale) => {
    const hardcoded = stringEntries(FLAT[locale])
      .filter(([k]) => k.endsWith('_one'))
      .filter(([, v]) => !v.includes('{{count}}'))
      .map(([k, v]) => `${k}: ${v}`)
    expect(hardcoded).toEqual([])
  })

  it('the hour plurals use one base name each (the split-base keys are gone)', () => {
    for (const locale of Object.keys(LOCALES)) {
      const flat = FLAT[locale]
      for (const base of ['time.hoursLeft', 'time.parkedForHours', 'time.hoursAgo', 'pdf.duration.hoursOnly']) {
        expect(flat[`${base}_one`], `${locale} ${base}_one`).toEqual(expect.any(String))
        expect(flat[`${base}_other`], `${locale} ${base}_other`).toEqual(expect.any(String))
      }
      for (const gone of ['time.hourLeft_one', 'time.parkedForHour_one', 'time.hourAgo_one', 'pdf.duration.hourOnly_one']) {
        expect(flat[gone], `${locale} ${gone}`).toBeUndefined()
      }
    }
  })
})

describe('the parity checks catch what they claim to', () => {
  it('varsOf ignores {{count}} only on _one keys', () => {
    expect(varsOf('{{count}} min left', 'time.minLeft_one')).toEqual([])
    expect(varsOf('{{count}} min left', 'time.minLeft_other')).toEqual(['count'])
    expect(varsOf('at {{time}}, {{ when }}', 'x')).toEqual(['time', 'when'])
  })

  it('tagsOf collects opening, closing and self-closing tags', () => {
    expect(tagsOf('Parking made <accent>simple.</accent>')).toEqual(['</accent>', '<accent>'])
    expect(tagsOf('line<br/>break')).toEqual(['<br/>'])
  })

  it('flatten records array lengths and indexed items', () => {
    expect(flatten({ a: { items: ['x', 'y'] } })).toEqual({
      'a.items': { array: 2 },
      'a.items[0]': 'x',
      'a.items[1]': 'y',
    })
  })
})
