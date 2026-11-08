// @vitest-environment node
//
// "Delete record" (SessionDetail) and "Remove" on a shared copy
// (SharedRecordScreen) were text-accent-600 on the vault, about 1.5:1, and
// close to invisible (fix list, after the overnight build). Both now use
// Button's "danger" variant. This reads the real colours from index.css and
// the variant's real classes from Button.tsx, and checks the text clears
// WCAG AA (4.5:1) on every surface it can sit on: the vault, the vault's
// guilloché stripe, and the button's own hover and pressed tints.
import { describe, expect, it } from 'vitest'

interface Fs {
  readFileSync: (p: URL, enc: 'utf8') => string
}
// node:fs through a dynamic import, so the browser tsconfig needs no Node types.
const fs = (await import('node:fs' as string)) as Fs

const SRC = new URL('../', import.meta.url)
const read = (rel: string) => fs.readFileSync(new URL(rel, SRC), 'utf8')

type Rgb = [number, number, number]

const css = read('index.css')
const buttonSrc = read('components/ui/Button.tsx')

/** A #RRGGBB colour token from the @theme block. */
function token(name: string): string {
  const m = css.match(new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`))
  if (!m) throw new Error(`no --color-${name} in index.css`)
  return m[1]
}

const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb

/** `fg` at `alpha` over the opaque `bg`, as the browser composites it. */
const over = (fg: Rgb, alpha: number, bg: Rgb): Rgb => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as Rgb

/** WCAG 2 contrast ratio. */
function contrast(a: Rgb, b: Rgb): number {
  const lum = ([r, g, bl]: Rgb) => {
    const ch = (v: number) => {
      const c = v / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(bl)
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The danger variant's class list, read from Button.tsx's VARIANT map. */
function dangerClasses(): string[] {
  const m = buttonSrc.match(/\n\s*danger:\s*\n?\s*'([^']+)'/)
  if (!m) throw new Error('no danger variant in Button.tsx')
  return m[1].split(/\s+/).filter(Boolean)
}

/** The base text colour token, e.g. text-danger-300 gives danger-300. */
function textToken(classes: string[]): string {
  const text = classes.filter((c) => /^text-[a-z]+-\d{2,3}$/.test(c))
  expect(text).toHaveLength(1)
  return text[0].slice('text-'.length)
}

/** The tint a state prefix paints, e.g. hover:bg-danger-300/10 gives [danger-300, 0.1]. */
function tint(classes: string[], state: 'hover' | 'active'): [string, number] {
  const c = classes.find((x) => x.startsWith(`${state}:bg-`))
  const m = c?.match(/^[a-z]+:bg-([a-z]+-\d{2,3})\/(\d{1,3})$/)
  if (!m) throw new Error(`no ${state} tint with an opacity in the danger variant: ${c}`)
  return [m[1], Number(m[2]) / 100]
}

describe('the danger variant on the vault', () => {
  const vault = rgb(token('brand-800'))
  // The body's guilloché: a 1px mint stripe at 5% over the vault, every 8px.
  const stripeRule = css.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*(0?\.\d+)\)\s*0 1px/)
  if (!stripeRule) throw new Error('the guilloché stripe moved: update this test')
  const stripe = over(
    [Number(stripeRule[1]), Number(stripeRule[2]), Number(stripeRule[3])],
    Number(stripeRule[4]),
    vault,
  )
  const classes = dangerClasses()
  const text = rgb(token(textToken(classes)))

  it('the old accent-600 really was unreadable (the bug this fixes)', () => {
    expect(contrast(rgb(token('accent-600')), vault)).toBeLessThan(1.6)
  })

  it('clears 4.5:1 on the vault and on its stripe', () => {
    const onVault = contrast(text, vault)
    const onStripe = contrast(text, stripe)
    expect(onVault).toBeGreaterThanOrEqual(4.5)
    expect(onStripe).toBeGreaterThanOrEqual(4.5)
    // The figures in index.css's comment and the fix report.
    expect(onVault.toFixed(2)).toBe('7.44')
    expect(onStripe.toFixed(2)).toBe('6.67')
  })

  it('clears 4.5:1 on its own hover and pressed tints, worst case over the stripe', () => {
    for (const state of ['hover', 'active'] as const) {
      const [name, alpha] = tint(classes, state)
      for (const base of [vault, stripe]) {
        expect(contrast(text, over(rgb(token(name)), alpha, base))).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('stays secondary: no solid fill, a faint border, and a 44px target', () => {
    const fills = classes.filter((c) => /^bg-/.test(c))
    expect(fills).toEqual(['bg-transparent'])
    expect(classes).toContain('min-h-[44px]')
    const border = classes.find((c) => /^border-[a-z]+-\d{2,3}\/\d+$/.test(c))
    expect(border).toBeDefined()
    expect(Number(border!.split('/')[1])).toBeLessThanOrEqual(50)
  })
})

describe('the two destructive actions use it', () => {
  const cases = [
    { file: 'components/SessionDetail.tsx', key: 'session.deleteSession' },
    { file: 'components/SharedRecordScreen.tsx', key: 'share.remove' },
  ]

  for (const { file, key } of cases) {
    it(`${file}: ${key} is a danger Button with no text colour of its own`, () => {
      const src = read(file)
      const escaped = key.replace(/\./g, '\\.')
      const m = src.match(new RegExp(`<Button\\b([^>]*)>\\s*\\{t\\('${escaped}'\\)\\}\\s*</Button>`))
      expect(m, `${key} is not rendered by a <Button>`).not.toBeNull()
      const attrs = m![1]
      expect(attrs).toMatch(/variant="danger"/)
      // A second text colour would fight the variant's (stylesheet order wins).
      expect(attrs).not.toMatch(/\btext-(?!xs|sm|base|lg|left|center|right)[a-z]+/)
    })
  }
})
