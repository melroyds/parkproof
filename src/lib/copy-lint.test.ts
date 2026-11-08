// @vitest-environment node
//
// Copy lint: the copy rules in docs/build/roadmap-build-spec.md ("Copy
// rules") that a machine can check, run on every build so a later change
// can't quietly bring back wording the legal and copy passes took out.
//
//   1. No em-dash (U+2014) in any string of any of the 9 locales.
//   2. No banned wording in any English string (BANNED below).
//   3. No em-dash in a hardcoded string in src/**/*.tsx: JSX text, attribute
//      values and other string literals (comments are fine). No banned
//      wording in JSX text or in the attributes a user reads or hears.
//   4. The landing pages (the app shell index.html and every page deployed
//      from the marketing landing folder) carry no em-dash and never say
//      "verified record", outside comments.
//
// The locale strings are written by scripts/_i18n_inject_*.mjs; the copy
// pass (scripts/_i18n_inject_copy_pass.mjs) runs the same em-dash and
// banned-wording checks before it writes.
import { describe, it, expect } from 'vitest'
import ts from 'typescript'
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
  readdirSync: (p: URL, opts: { withFileTypes: true }) => { name: string; isDirectory: () => boolean }[]
}
// node:fs through a dynamic import, so the browser tsconfig needs no Node types.
const fs = (await import('node:fs' as string)) as Fs

const SRC = new URL('../', import.meta.url)
const REPO = new URL('../../', import.meta.url)
const LANDING = new URL('migrations/two-app-architecture/landing-from-claude-design/', REPO)

const EM_DASH = '\u2014'

const LOCALES: Record<string, unknown> = { en, 'zh-CN': zhCN, vi, id, ko, it: it_, el, hi, pa }

/** Every string in a locale file as [dotted key, value]; array items read `items[0]`. */
function strings(value: unknown, prefix = '', out: [string, string][] = []): [string, string][] {
  if (typeof value === 'string') out.push([prefix, value])
  else if (Array.isArray(value)) value.forEach((v, i) => strings(v, `${prefix}[${i}]`, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) strings(v, prefix ? `${prefix}.${k}` : k, out)
  }
  return out
}

// ── Banned English wording ──────────────────────────────────────────────
// Spec copy rules and the legal pass first, then what the English copy pass
// took out. Case-insensitive.
const BANNED: { id: string; re: RegExp }[] = [
  // Spec copy rules.
  { id: 'reset', re: /\breset\b/i },
  { id: 'compliant', re: /\bcompliant\b/i },
  { id: 'compliance proven', re: /\bcompliance proven\b/i },
  { id: 'admissible', re: /\badmissible\b/i },
  { id: 'authentic', re: /\bauthentic\b/i },
  { id: 'verified location', re: /\bverified location\b/i },
  { id: 'accepted by insurers', re: /\baccepted by insurers\b/i },
  { id: 'accepted by council', re: /\baccepted by (the )?councils?\b/i },
  // Legal pass: a signature is not a verification, and no verdicts.
  { id: 'verified record', re: /\bverified record\b/i },
  { id: 'council-ready', re: /\bcouncil[- ]ready\b/i },
  { id: 'strong evidence', re: /\bstrong evidence\b/i },
  { id: 'strong case', re: /\bstrong case\b/i },
  // English pass. The record noun is "record", never "session".
  { id: 'session', re: /\bsessions?\b/i },
  // "Re-verify" and "verify this record": only signatures can be checked,
  // never the record's truth or the car's spot.
  { id: 're-verify', re: /\bre-?verif(y|ies|ied|ying)\b/i },
  { id: 'verify a record', re: /\bverif(y|ies|ied|ying) (a |the |this |your )?(record|evidence|spot|location)\b/i },
  // Checking a sign needs a connection, so the app doesn't "work offline".
  // "Saved records work offline" is true and stays allowed.
  { id: 'works offline', re: /\bworks (fully )?offline\b/i },
  // Outcome and strength claims about the record.
  { id: 'your proof', re: /\byour proof\b/i },
  { id: 'tamper-proof', re: /\btamper[- ]proof\b/i },
  { id: 'strengthens evidence', re: /\bstrengthens? (your |the )?(evidence|case)\b/i },
  // A record logged with no sign is still cryptographically signed.
  { id: 'unsigned park', re: /\bunsigned (park|parking|spot)\b/i },
  // The app drafts a dispute letter for the driver to check; the driver is
  // responsible for the letter they send (appeal.captureDisclaimer).
  { id: 'writes the letter for you', re: /\bwrit(e|es|ing) (the |a |your )?((dispute|appeal) )?letters? for you\b/i },
  // A signature covers the signed details only: "the signed details haven't
  // changed since ParkProof signed them", never "nothing has changed since".
  { id: 'nothing has changed', re: /\bnothing (has )?changed since\b/i },
]

// Keys allowed to trip one banned rule. Keep this short: every entry must
// still exist and still trip its rule, or the test asks for it to be removed.
const ALLOWED: Record<string, { rule: string; unused?: true }> = {
  // Sign-in: "reset" here is resetting a password, the flow's own name for it.
  'auth.forgotIntro': { rule: 'reset' },
  'auth.resetHeader': { rule: 'reset' },
  'auth.sendResetCode': { rule: 'reset' },
  'auth.resetPasswordBtn': { rule: 'reset' },
  'auth.resetCodeSent': { rule: 'reset' },
  'auth.passwordReset': { rule: 'reset' },
  'privacy.signedInEmail': { rule: 'reset' }, // "used ... for password reset"
  // Never rendered (no code reads them), left with their old wording until a
  // cleanup deletes them from all 9 locales. Checked unused below.
  'appeal.strongEvidence': { rule: 'strong evidence', unused: true },
  'reminders.browserNoExpiry': { rule: 'session', unused: true },
}

function bannedIn(text: string): string[] {
  return BANNED.filter((b) => b.re.test(text)).map((b) => b.id)
}

// ── Source files ────────────────────────────────────────────────────────
/** Files under `dir` whose name passes `keep`, as [path relative to `base`, source]. */
function filesUnder(dir: URL, base: URL, keep: (name: string) => boolean): [string, string][] {
  const out: [string, string][] = []
  const walk = (d: URL) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(new URL(`${e.name}/`, d))
      } else if (keep(e.name)) {
        const url = new URL(e.name, d)
        out.push([decodeURIComponent(url.pathname.slice(base.pathname.length)), fs.readFileSync(url, 'utf8')])
      }
    }
  }
  walk(dir)
  return out
}

const isAppSource = (name: string) => /\.tsx?$/.test(name) && !name.includes('.test.') && !name.endsWith('.d.ts')
const TSX = filesUnder(SRC, REPO, (n) => n.endsWith('.tsx') && isAppSource(n))

interface Literal {
  line: number
  text: string
  /** JSX text, or the value of an attribute a user reads or hears. */
  shown: boolean
}

const SHOWN_ATTRIBUTES = new Set(['aria-label', 'aria-description', 'aria-roledescription', 'alt', 'title', 'placeholder'])

/** Every string literal, template piece and JSX text in a source file (comments aren't nodes). */
function literals(fileName: string, source: string, kind: ts.ScriptKind): Literal[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
  const out: Literal[] = []
  const visit = (node: ts.Node) => {
    let text: string | null = null
    let shown = false
    if (ts.isJsxText(node)) {
      text = node.text
      shown = true
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = node.text
      const attr = node.parent
      shown = ts.isJsxAttribute(attr) && SHOWN_ATTRIBUTES.has(attr.name.getText(sf))
    }
    if (text !== null && text.trim()) {
      out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text, shown })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** A page's text outside comments, plus the string literals of its inline scripts. */
function pageText(html: string, fileName: string): { text: string; scriptStrings: string[] } {
  const scriptStrings: string[] = []
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_, body: string) => {
      for (const l of literals(fileName, body, ts.ScriptKind.JS)) scriptStrings.push(l.text)
      return ' '
    })
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css: string) => css.replace(/\/\*[\s\S]*?\*\//g, ' '))
  return { text, scriptStrings }
}

const PAGES: [string, string][] = [
  ['index.html', fs.readFileSync(new URL('index.html', REPO), 'utf8')],
  ...filesUnder(LANDING, REPO, (n) => n.endsWith('.html')),
]

// ── Tests ───────────────────────────────────────────────────────────────
describe('locale strings', () => {
  it.each(Object.keys(LOCALES))('%s has no em-dash', (locale) => {
    const hits = strings(LOCALES[locale]).filter(([, v]) => v.includes(EM_DASH))
    expect(hits.map(([k, v]) => `${k}: ${v}`)).toEqual([])
  })

  it('no English string uses banned wording', () => {
    const hits: string[] = []
    for (const [key, value] of strings(en)) {
      for (const rule of bannedIn(value)) {
        if (ALLOWED[key]?.rule !== rule) hits.push(`${key} (${rule}): ${value}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('every allowlist entry still exists and still needs its exemption', () => {
    const en_ = Object.fromEntries(strings(en))
    const stale = Object.entries(ALLOWED)
      .filter(([key, { rule }]) => !(key in en_) || !bannedIn(en_[key]).includes(rule))
      .map(([key, { rule }]) => `${key} (${rule})`)
    expect(stale).toEqual([])
  })

  it('the unused keys in the allowlist are still unused', () => {
    const sources = filesUnder(SRC, REPO, isAppSource)
    const used: string[] = []
    for (const [key, entry] of Object.entries(ALLOWED)) {
      if (!entry.unused) continue
      const leaf = key.split('.').pop() as string
      for (const [path, src] of sources) if (src.includes(leaf)) used.push(`${key} in ${path}`)
    }
    // A key that is rendered again needs its wording fixed, not an exemption.
    expect(used).toEqual([])
  })
})

describe('hardcoded strings in src/**/*.tsx', () => {
  it('found the component sources', () => {
    expect(TSX.length).toBeGreaterThan(20)
  })

  it('no hardcoded string has an em-dash', () => {
    const hits: string[] = []
    for (const [path, src] of TSX) {
      for (const l of literals(path, src, ts.ScriptKind.TSX)) {
        if (l.text.includes(EM_DASH)) hits.push(`${path}:${l.line}: ${l.text.trim()}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('no JSX text or shown attribute uses banned wording', () => {
    const hits: string[] = []
    for (const [path, src] of TSX) {
      for (const l of literals(path, src, ts.ScriptKind.TSX)) {
        if (!l.shown) continue
        for (const rule of bannedIn(l.text)) hits.push(`${path}:${l.line} (${rule}): ${l.text.trim()}`)
      }
    }
    expect(hits).toEqual([])
  })
})

describe('landing pages', () => {
  it('found the app shell and the landing pages', () => {
    const names = PAGES.map(([p]) => p)
    expect(names).toContain('index.html')
    expect(names).toContain('migrations/two-app-architecture/landing-from-claude-design/index.html')
  })

  it.each(PAGES.map(([p]) => p))('%s has no em-dash and never says "verified record"', (path) => {
    const html = PAGES.find(([p]) => p === path)?.[1] ?? ''
    const { text, scriptStrings } = pageText(html, path)
    const hits: string[] = []
    for (const s of [text, ...scriptStrings]) {
      for (const line of s.split('\n')) {
        if (line.includes(EM_DASH)) hits.push(`em-dash: ${line.trim()}`)
        if (/\bverified record\b/i.test(line)) hits.push(`verified record: ${line.trim()}`)
      }
    }
    expect(hits).toEqual([])
  })
})
