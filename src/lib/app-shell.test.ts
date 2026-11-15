// @vitest-environment node
//
// App shell guards from the 8 Nov 2026 field test (docs/build/fix-list.md).
//
// Item 3: index.html draws the installed iPhone app under the status bar
// (viewport-fit=cover plus the black-translucent status bar). The shell
// (#root) pads itself back inside the safe area, but fixed layers are
// placed against the viewport, so each one has to clear the insets itself
// with the safe-* utilities in index.css.
//
// Item 4: BackButton owns its colour. With two text colour utilities on one
// element, Tailwind's stylesheet order picks the winner, not the className
// order, which is how a grey default beat every caller's override and left
// the back buttons at about 1.4:1 on the vault.
//
// Also the Android install offer: main.tsx must catch the browser's install
// prompt from startup, before the first render. And the new version card:
// main.tsx watches for an update from startup, and no update pill floats
// over the screens from the root any more (Home shows the card).
import { describe, it, expect } from 'vitest'

interface Fs {
  readFileSync: (p: URL, enc: 'utf8') => string
  readdirSync: (p: URL, opts: { withFileTypes: true }) => { name: string; isDirectory: () => boolean }[]
}
// node:fs through a dynamic import, so the browser tsconfig needs no Node types.
const fs = (await import('node:fs' as string)) as Fs

const SRC = new URL('../', import.meta.url)
const read = (rel: string) => fs.readFileSync(new URL(rel, SRC), 'utf8')

/** Every non-test .tsx file under src/, as [path relative to src, source]. */
function componentSources(): [string, string][] {
  const out: [string, string][] = []
  const walk = (dir: URL, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(new URL(`${e.name}/`, dir), `${rel}${e.name}/`)
      else if (e.name.endsWith('.tsx') && !e.name.includes('.test.')) {
        out.push([`${rel}${e.name}`, fs.readFileSync(new URL(e.name, dir), 'utf8')])
      }
    }
  }
  walk(SRC, '')
  return out
}

// className="..." or className={`...`} (the template may be followed by .trim()).
const CLASS_ATTR = /className=(?:"([^"]*)"|\{`([^`]*)`)/

/** The literal class lists in className="..." and className={`...`}. */
function classNameLiterals(src: string): { line: number; classes: string[] }[] {
  const out: { line: number; classes: string[] }[] = []
  for (const m of src.matchAll(new RegExp(CLASS_ATTR.source, 'g'))) {
    const raw = (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ')
    out.push({ line: src.slice(0, m.index).split('\n').length, classes: raw.split(/\s+/).filter(Boolean) })
  }
  return out
}

/** The attribute text of each opening tag of a component, nested {...} kept intact. */
function openingTags(src: string, name: string): { line: number; attrs: string }[] {
  const out: { line: number; attrs: string }[] = []
  for (const m of src.matchAll(new RegExp(`<${name}\\b`, 'g'))) {
    let i = m.index + m[0].length
    let depth = 0
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    out.push({ line: src.slice(0, m.index).split('\n').length, attrs: src.slice(m.index, i) })
  }
  return out
}

// A text-* utility that sets a colour (sizes and alignment are fine).
const TEXT_COLOUR =
  /^(?:[a-z0-9-]+:)*!?text-(?!(?:2xs|xs|sm|base|lg|[2-9]?xl|left|center|right|start|end|justify|wrap|nowrap|balance|pretty|ellipsis|clip)$)/

/** WCAG 2 contrast ratio between two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * `src` with comments and string literals blanked out (same length, newlines
 * kept), so a commented-out call doesn't count and brackets in text don't
 * skew the bracket counts.
 */
function codeOnly(src: string): string {
  return src.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g,
    (m) => m.replace(/[^\n]/g, ' '),
  )
}

describe('safe areas (installed iPhone app)', () => {
  const css = read('index.css')
  const html = fs.readFileSync(new URL('../index.html', SRC), 'utf8')

  it('draws under the status bar, which is why the shell pads itself', () => {
    expect(html).toMatch(/viewport-fit=cover/)
    expect(html).toMatch(/black-translucent/)
  })

  it('pads the app shell on all four sides', () => {
    const root = css.match(/#root\s*\{([^}]*)\}/)?.[1] ?? ''
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(root).toMatch(new RegExp(`padding-${side}:\\s*env\\(safe-area-inset-${side}`))
    }
  })

  it('keeps full-height screens inside the padded shell from overflowing', () => {
    const rule = css.match(/#root \.min-h-screen\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/100vh - env\(safe-area-inset-top, 0px\) - env\(safe-area-inset-bottom, 0px\)/)
  })

  it('keeps the vault background on body, so it still draws under the status bar', () => {
    const body = css.match(/\nbody\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(body).toMatch(/background-color:\s*var\(--color-brand-800\)/)
    expect(css.match(/#root\s*\{([^}]*)\}/)?.[1] ?? '').not.toMatch(/background/)
  })

  it('puts every fixed or sticky layer on a safe-* utility', () => {
    const offenders: string[] = []
    let layers = 0
    for (const [file, src] of componentSources()) {
      for (const { line, classes } of classNameLiterals(src)) {
        if (!classes.some((c) => c === 'fixed' || c === 'sticky')) continue
        layers++
        if (!classes.some((c) => /^(?:[a-z0-9-]+:)*safe-/.test(c))) offenders.push(`${file}:${line}`)
      }
    }
    expect(offenders).toEqual([])
    // The toast, the feedback modal, the backup prompt and the departure,
    // share, handover and add-evidence sheets, among others (the install
    // offers and the new version card sit in Home's flow now, not fixed). A
    // drop below 6 means the scan stopped finding them.
    expect(layers).toBeGreaterThanOrEqual(6)
  })

  it('defines every safe-* utility the components use', () => {
    const used = new Set<string>()
    for (const [, src] of componentSources()) {
      for (const { classes } of classNameLiterals(src)) {
        for (const c of classes) {
          const m = c.match(/^(?:[a-z0-9-]+:)*(safe-[a-z0-9-]+)$/)
          if (m) used.add(m[1])
        }
      }
    }
    expect(used.size).toBeGreaterThan(0)
    for (const name of used) expect(css).toContain(`@utility ${name} {`)
  })
})

describe('BackButton colour', () => {
  const VAULT = '#073B25'
  const SAGE = '#A9CFBE'
  const PAPER_50 = '#F8FBF9'

  it('defaults to sage on the vault, with a brighter hover', () => {
    const src = read('components/ui/BackButton.tsx')
    const classes = classNameLiterals(src).flatMap((l) => l.classes)
    const base = classes.filter((c) => TEXT_COLOUR.test(c) && !c.includes(':'))
    const hover = classes.filter((c) => TEXT_COLOUR.test(c) && c.startsWith('hover:'))
    expect(base).toEqual([`text-[${SAGE}]`])
    expect(hover).toEqual(['hover:text-paper-50'])
  })

  it('clears WCAG AA, and AAA for the resting colour', () => {
    expect(contrast(SAGE, VAULT)).toBeGreaterThan(7)
    expect(contrast(PAPER_50, VAULT)).toBeGreaterThan(contrast(SAGE, VAULT))
  })

  it('is never handed a text colour through className', () => {
    const offenders: string[] = []
    let sites = 0
    for (const [file, src] of componentSources()) {
      for (const { line, attrs } of openingTags(src, 'BackButton')) {
        sites++
        const cls = attrs.match(CLASS_ATTR)
        if (!cls) continue
        const colours = (cls[1] ?? cls[2]).split(/\s+/).filter((c) => TEXT_COLOUR.test(c))
        if (colours.length) offenders.push(`${file}:${line} ${colours.join(' ')}`)
      }
    }
    expect(offenders).toEqual([])
    expect(sites).toBeGreaterThan(10)
  })
})

/**
 * Where `name(` is called at the start of a line in main.tsx's code, outside
 * any function body or call, and before createRoot: at module level, as the
 * module loads, before the first render.
 */
function expectModuleLevelCall(name: string): void {
  const code = codeOnly(read('main.tsx'))
  const call = code.search(new RegExp(`^${name}\\(`, 'm'))
  expect(call, 'a call at the start of a line').toBeGreaterThanOrEqual(0)
  const before = code.slice(0, call)
  const open = (o: string, c: string) => before.split(o).length - before.split(c).length
  expect([open('{', '}'), open('(', ')')], 'no function body or call still open around it').toEqual([0, 0])
  expect(code.search(/\bcreateRoot\(/), 'createRoot comes after it').toBeGreaterThan(call)
}

describe('install offer at startup', () => {
  // The browser can fire beforeinstallprompt before Home is on screen (a
  // reminder tap opens a record first, a scan is in progress), and an event
  // nobody is listening for is lost. So main.tsx listens as the module loads,
  // before the first render. Dropped, or moved into an effect that runs after
  // the event, the offer never reaches Android drivers, and the install tests
  // can't tell: they start the listener themselves.
  it('main.tsx calls listenForInstallOffer at module level, before createRoot', () => {
    expectModuleLevelCall('listenForInstallOffer')
  })
})

describe('new version card', () => {
  // A new version can install while a scan or a record is on screen, and the
  // browser tells the page once (updatefound, then the worker's statechange).
  // So main.tsx watches as the module loads, and Home offers the reload when
  // the driver gets there. Dropped, the card never shows, and the card's
  // tests can't tell: they start the listener themselves.
  it('main.tsx calls listenForSwUpdate at module level, before createRoot', () => {
    expectModuleLevelCall('listenForSwUpdate')
  })

  // Rendered at the root, the old pill floated over every screen, covered
  // its bottom buttons, and its Refresh reloaded mid-flow, losing the work on
  // screen. The card is Home's (App.tsx) and sits in the page flow.
  it('no update pill is rendered at the root, and the card is never a fixed layer', () => {
    expect(codeOnly(read('main.tsx')), 'main.tsx neither imports nor renders it').not.toMatch(/\bSwUpdateBanner\b/)
    const src = read('components/SwUpdateBanner.tsx')
    const classes = classNameLiterals(src).flatMap((l) => l.classes)
    expect(classes.length, 'the scan found its classes').toBeGreaterThan(0)
    expect(classes.filter((c) => /^(?:[a-z0-9-]+:)*(?:fixed|absolute|sticky)$/.test(c))).toEqual([])
  })
})
