// @vitest-environment node
//
// The calendar code loads on demand, never with the first page.
//
// src/lib/ics.ts imports the `ics` package, which brings yup and nanoid
// with it (about 70 kB, 22 kB gzipped). Every caller loads it inside the
// tap that makes the file (`await import('../lib/ics')`), so Vite puts it
// in its own chunk. One static import anywhere in the app is enough to
// pull all of it into the main bundle for every visitor: Vite then only
// warns (INEFFECTIVE_DYNAMIC_IMPORT) and the build still passes. That is
// how T6b's workday calendar button once added it to the main chunk of a
// production build where workday mode can't even be reached.
import { describe, expect, it } from 'vitest'

interface Fs {
  readFileSync: (p: string, enc: 'utf8') => string
  readdirSync: (p: string, opts: { withFileTypes: true }) => { name: string; isDirectory: () => boolean }[]
}
interface PathMod {
  join: (...parts: string[]) => string
  dirname: (p: string) => string
  resolve: (...parts: string[]) => string
  relative: (from: string, to: string) => string
}
// Node through dynamic imports, so the browser tsconfig needs no Node types.
const fs = (await import('node:fs' as string)) as Fs
const path = (await import('node:path' as string)) as PathMod
const { fileURLToPath } = (await import('node:url' as string)) as { fileURLToPath: (u: URL) => string }

const SRC = fileURLToPath(new URL('../', import.meta.url))
const ICS_MODULE = path.resolve(SRC, 'lib', 'ics')

/** Every non-test .ts and .tsx file under src/. */
function appSources(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== '__fixtures__' && entry.name !== 'locales') walk(full)
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(full)
      }
    }
  }
  walk(SRC)
  return out
}

/**
 * The module specifiers a source file imports or re-exports statically,
 * leaving out `import type` and `export type` (erased at build) and
 * `import('...')` calls (on demand).
 */
function staticSpecifiers(source: string): string[] {
  const out: string[] = []
  // The clause holds only names, braces, commas, `*` and `as`, so a match
  // never runs on from an `export function` into later code.
  const declaration = /(?:^|\n)\s*(import|export)\s+([\w\s{},*$]*?)\bfrom\s*['"]([^'"]+)['"]/g
  for (const m of source.matchAll(declaration)) {
    const clause = m[2].trim()
    if (clause.startsWith('type ') || clause.startsWith('type{')) continue
    out.push(m[3])
  }
  // Side-effect imports: import './x'
  for (const m of source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1])
  return out
}

/** Where a relative specifier points, without its extension; null for a package. */
function resolveRelative(file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  return path.resolve(path.dirname(file), specifier).replace(/\.(tsx?|js)$/, '')
}

describe('the calendar code (src/lib/ics.ts) stays out of the main bundle', () => {
  it('reads static imports and leaves type-only and on-demand ones out', () => {
    const sample = [
      "import { downloadIcs } from '../lib/ics'",
      "import type { Thing } from '../lib/ics'",
      'import {',
      '  downloadWorkdayLegIcs,',
      "} from '../lib/ics'",
      "export { buildIcs } from './ics'",
      "const mod = await import('../lib/ics')",
      "import './side-effect'",
    ].join('\n')
    expect(staticSpecifiers(sample)).toEqual(['../lib/ics', '../lib/ics', './ics', './side-effect'])
  })

  it('no app module imports it statically: every caller loads it on the tap', () => {
    const offenders = appSources()
      .filter((file) => staticSpecifiers(fs.readFileSync(file, 'utf8')).some((s) => resolveRelative(file, s) === ICS_MODULE))
      .map((file) => path.relative(SRC, file).replace(/\\/g, '/'))
    expect(offenders).toEqual([])
  })

  it('the workday calendar button is one of the callers that loads it on demand', () => {
    const note = fs.readFileSync(path.join(SRC, 'components', 'WorkdayReadinessNote.tsx'), 'utf8')
    expect(note).toMatch(/await import\(['"]\.\.\/lib\/ics['"]\)/)
  })

  it('only src/lib/ics.ts imports the ics package itself', () => {
    const importers = appSources()
      .filter((file) => staticSpecifiers(fs.readFileSync(file, 'utf8')).includes('ics'))
      .map((file) => path.relative(SRC, file).replace(/\\/g, '/'))
    expect(importers).toEqual(['lib/ics.ts'])
  })
})
