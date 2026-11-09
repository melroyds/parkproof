// @vitest-environment node
//
// The inject chain's last three steps, held in place. The chain is fix_push,
// t6a, t8, t3, t5, t2, t4, t7, t6bc, fixlist_final, copy_pass, t10_review,
// last_lows (scripts/_i18n_inject_*.mjs). The copy pass and the T10 review
// keep their text in data files (scripts/copy-pass/<locale>.json and
// scripts/t10-review/<locale>.json) and overwrite whole strings from them.
//   - Every entry in those files is the string the locale has now, so running
//     either again changes nothing, and neither can undo a later script
//     (scripts/_i18n_inject_last_lows.mjs runs after both).
//   - The empty-note line's old split keys (session.noNote,
//     session.noteHelp) stay deleted: no inject script or data file writes
//     one, and no app code reads one.
import { describe, expect, it } from 'vitest'
import en from '../locales/en.json'
import zhCN from '../locales/zh-CN.json'
import vi from '../locales/vi.json'
import id from '../locales/id.json'
import ko from '../locales/ko.json'
import it_ from '../locales/it.json'
import el from '../locales/el.json'
import hi from '../locales/hi.json'
import pa from '../locales/pa.json'

interface Fs {
  readFileSync: (p: URL, enc: 'utf8') => string
  existsSync: (p: URL) => boolean
  readdirSync: (p: URL, opts: { withFileTypes: true }) => { name: string; isDirectory: () => boolean }[]
}
// node:fs through a dynamic import, so the browser tsconfig needs no Node types.
const fs = (await import('node:fs' as string)) as Fs

const REPO = new URL('../../', import.meta.url)
const LOCALES: Record<string, unknown> = { en, 'zh-CN': zhCN, vi, id, ko, it: it_, el, hi, pa }

/** The string at a dotted path (a numeric segment indexes an array), or undefined. */
function at(root: unknown, path: string): unknown {
  let node = root
  for (const p of path.split('.')) {
    if (Array.isArray(node) && /^\d+$/.test(p)) node = node[Number(p)]
    else if (node && typeof node === 'object' && Object.hasOwn(node, p)) node = (node as Record<string, unknown>)[p]
    else return undefined
  }
  return node
}

/** Every file under `dir` whose name passes `keep`, as [path relative to the repo, source]. */
function filesUnder(dir: URL, keep: (name: string) => boolean): [string, string][] {
  const out: [string, string][] = []
  const walk = (d: URL) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(new URL(`${e.name}/`, d))
      } else if (keep(e.name)) {
        const url = new URL(e.name, d)
        out.push([decodeURIComponent(url.pathname.slice(REPO.pathname.length)), fs.readFileSync(url, 'utf8')])
      }
    }
  }
  walk(dir)
  return out
}

const DATA_DIRS = ['scripts/copy-pass/', 'scripts/t10-review/']

describe('the copy pass and the T10 review, run again', () => {
  for (const dir of DATA_DIRS) {
    it.each(Object.keys(LOCALES))(`${dir}%s.json matches the locale file, so it changes nothing`, (locale) => {
      const file = new URL(`${dir}${locale}.json`, REPO)
      if (!fs.existsSync(file)) return
      const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>
      expect(Object.keys(data).length).toBeGreaterThan(0)
      const differ = Object.entries(data)
        .filter(([path, text]) => at(LOCALES[locale], path) !== text)
        .map(([path]) => path)
      expect(differ).toEqual([])
    })
  }
})

describe('the empty-note line', () => {
  const OLD = ['session.noNote', 'session.noteHelp']

  it.each(Object.keys(LOCALES))('%s has one sentence and no split keys', (locale) => {
    expect(typeof at(LOCALES[locale], 'session.noteEmpty')).toBe('string')
    expect(typeof at(LOCALES[locale], 'session.addNote')).toBe('string')
    for (const key of OLD) expect(at(LOCALES[locale], key), key).toBeUndefined()
  })

  it('no inject script or data file writes a split key again, and no app code reads one', () => {
    const scripts = filesUnder(new URL('scripts/', REPO), (n) => /^_i18n_inject_.*\.(mjs|py)$/.test(n) || /\.json$/.test(n))
    expect(scripts.some(([p]) => p === 'scripts/_i18n_inject_last_lows.mjs')).toBe(true)
    const sources = filesUnder(new URL('src/', REPO), (n) => /\.tsx?$/.test(n) && !n.includes('.test.') && !n.endsWith('.d.ts'))
    expect(sources.length).toBeGreaterThan(50)
    const hits: string[] = []
    for (const [path, src] of scripts) {
      // The last-lows script lists them to delete them.
      if (path === 'scripts/_i18n_inject_last_lows.mjs') continue
      for (const key of OLD) {
        const leaf = key.split('.').pop() as string
        if (new RegExp(`['"\`]${key.replace(/\./g, '\\.')}['"\`]\\s*:|['"\`]?\\b${leaf}['"\`]?\\s*:`).test(src)) hits.push(`${key} in ${path}`)
      }
    }
    for (const [path, src] of sources) for (const key of OLD) if (src.includes(key)) hits.push(`${key} in ${path}`)
    expect(hits).toEqual([])
  })
})
