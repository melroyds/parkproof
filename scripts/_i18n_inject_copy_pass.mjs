/**
 * Copy pass i18n (polish/copy-and-leftovers): the legal and plain-English
 * pass over existing English strings, the same changes in the other 8
 * locales, and the em-dash sweep (no em-dashes anywhere in user-facing
 * copy). Idempotent: running it twice leaves the files byte-identical after
 * the first run.
 *
 * The changes live in data files, one per locale, not in this script:
 *   scripts/copy-pass/<locale>.json
 * Each is a flat object of dotted key -> new string. A numeric segment
 * indexes into an array: `about.scan.items.0` is the first item of the
 * `about.scan.items` list. Every entry is an explicit OVERWRITE of a string
 * that already exists: this script never adds, removes or re-sorts a key,
 * so each file keeps its key order.
 *
 * Run order: after every task's inject script, and before
 * scripts/_i18n_inject_t10_review.mjs (the T10 translation review), which
 * runs last. A key both overwrite carries the reviewed text in both files
 * (the review script checks), so running this again after the review
 * changes nothing. The keys T4 rewrites
 * to the spec's exact wording (scripts/_i18n_inject_t4.mjs OVERWRITES:
 * home.history, privacy.anonymousIntro, privacy.anonymousThings and
 * privacy.anonymousAnthropic) are not in the copy-pass files, so T4's text
 * stands in every locale. Keep them out.
 *
 * en.json is applied first. Every other locale's overwrite is then checked
 * against en's value for the same key after en's own overwrites, so a
 * translation of a changed English string carries the new string's {{vars}}
 * and <tags>.
 *
 * Writes nothing (exit 1) when:
 *   - a copy-pass file isn't a flat object of strings, has a duplicate key,
 *     or is named for a locale ParkProof doesn't ship;
 *   - an overwrite key isn't an existing string in the locale it overwrites;
 *   - a non-en overwrite key has no string at the same path in en;
 *   - an overwrite's {{vars}} or <tags> differ from en's value for that key;
 *   - an overwrite contains an em-dash, or a pdf.* overwrite a symbol the PDF
 *     fonts can't draw;
 *   - an en overwrite says "session" (the record noun is "record") or uses
 *     wording the copy rules ban. src/lib/copy-lint.test.ts holds the full
 *     list and checks every string on every build; this is the subset that
 *     stops a bad pass before it is written;
 *   - after applying, any locale fails the parity checks
 *     src/lib/locales.test.ts enforces.
 *
 * Run:   node scripts/_i18n_inject_copy_pass.mjs
 * List:  node scripts/_i18n_inject_copy_pass.mjs --list
 *        prints every overwritten key and the locales that overwrite it, for
 *        the T10 translation review.
 * Other: node scripts/_i18n_inject_copy_pass.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 *        --pass <copy-pass dir> reads the overwrites from another folder.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const passArg = process.argv.indexOf('--pass')
const PASS = passArg > -1 ? resolve(process.argv[passArg + 1]) : join(ROOT, 'scripts', 'copy-pass')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

// ── helpers ─────────────────────────────────────────────────────────────
function fail(msg) {
  console.error(`ABORT (nothing written): ${msg}`)
  process.exit(1)
}

/**
 * The container holding `path`'s leaf and the leaf's key, or null when any
 * step is missing. Object steps must be own keys; array steps must be an
 * index inside the array.
 */
function locate(root, path) {
  const parts = path.split('.')
  const leaf = parts.pop()
  let node = root
  for (const p of parts) {
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(p) || Number(p) >= node.length) return null
      node = node[Number(p)]
    } else if (node && typeof node === 'object' && Object.hasOwn(node, p)) {
      node = node[p]
    } else {
      return null
    }
  }
  if (Array.isArray(node)) {
    if (!/^\d+$/.test(leaf) || Number(leaf) >= node.length) return null
    return { node, leaf: Number(leaf) }
  }
  if (!node || typeof node !== 'object' || !Object.hasOwn(node, leaf)) return null
  return { node, leaf }
}

/** The string at `path`, or undefined when there is no string there. */
function stringAt(root, path) {
  const at = locate(root, path)
  return at && typeof at.node[at.leaf] === 'string' ? at.node[at.leaf] : undefined
}

/** Rewrite an existing string in place. Aborts when the key isn't an existing string. */
function overwrite(root, path, value, locale) {
  const at = locate(root, path)
  if (!at || typeof at.node[at.leaf] !== 'string') fail(`${locale}: overwrite ${path} is not an existing string`)
  at.node[at.leaf] = value
}

function flatten(value, prefix = '', out = {}) {
  if (Array.isArray(value)) {
    out[prefix] = { array: value.length }
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out))
  } else if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) flatten(value[k], prefix ? `${prefix}.${k}` : k, out)
  } else {
    out[prefix] = value
  }
  return out
}

const varsOf = (s, isOne) =>
  [...new Set((s.match(/\{\{\s*[\w.]+\s*\}\}/g) || []).map((m) => m.replace(/[{}\s]/g, '')))]
    .filter((v) => !(isOne && v === 'count'))
    .sort()
    .join(',')
const tagsOf = (s) => [...new Set(s.match(/<\/?[a-zA-Z][\w-]*\s*\/?>/g) || [])].sort().join(',')

// ── read the pass ───────────────────────────────────────────────────────
/** { locale: { dottedKey: newString } } in file order, en first. */
function readPass() {
  const files = readdirSync(PASS).filter((f) => f.endsWith('.json'))
  for (const f of files) {
    if (!LOCALES.includes(f.slice(0, -'.json'.length))) fail(`scripts/copy-pass/${f} is not a ParkProof locale`)
  }
  const pass = {}
  for (const locale of LOCALES) {
    if (!files.includes(`${locale}.json`)) {
      pass[locale] = {}
      continue
    }
    const raw = readFileSync(join(PASS, `${locale}.json`), 'utf8')
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      fail(`scripts/copy-pass/${locale}.json is not valid JSON: ${e.message}`)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail(`scripts/copy-pass/${locale}.json must be an object of dotted key -> string`)
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string') fail(`scripts/copy-pass/${locale}.json: ${k} is not a string`)
    }
    // JSON.parse keeps the last of two equal keys without a word. The files
    // are one key per line, so count the key lines.
    const keyLines = raw.match(/^\s*"(?:[^"\\]|\\.)*"\s*:/gm) || []
    if (keyLines.length !== Object.keys(parsed).length) {
      fail(`scripts/copy-pass/${locale}.json has a duplicate key`)
    }
    pass[locale] = parsed
  }
  return pass
}

// ── checks ──────────────────────────────────────────────────────────────
/** Problems with the overwrites themselves, checked against en after en's overwrites. */
function checkPass(pass, enAfter) {
  const problems = []
  for (const locale of LOCALES) {
    for (const [path, s] of Object.entries(pass[locale])) {
      const ref = stringAt(enAfter, path)
      if (ref === undefined) {
        problems.push(`${locale}: ${path} has no string in en`)
        continue
      }
      const isOne = path.endsWith('_one')
      if (varsOf(s, isOne) !== varsOf(ref, isOne)) problems.push(`${locale}: {{vars}} differ from en at ${path}`)
      if (tagsOf(s) !== tagsOf(ref)) problems.push(`${locale}: <tags> differ from en at ${path}`)
      // Copy rules: no em-dashes; PDF strings without symbols the PDF fonts can't draw.
      if (s.includes('\u2014')) problems.push(`${locale}: em-dash at ${path}: ${s}`)
      if (path.startsWith('pdf.') && /[✓⚠→≈≤]|\p{Extended_Pictographic}/u.test(s)) {
        problems.push(`${locale}: symbol in PDF copy at ${path}: ${s}`)
      }
    }
  }
  for (const [path, s] of Object.entries(pass.en)) {
    // The en record noun is "record", never "session".
    if (/\bsessions?\b/i.test(s)) problems.push(`en: "session" at ${path}`)
    // Words and claims the copy rules ban outright (subset of copy-lint.test.ts).
    if (
      /\b(reset|compliant|compliance proven|admissible|authentic|verified (record|location)|accepted by (insurers|council)|council-ready|strong (evidence|case)|re-?verify|writ(e|es|ing) (the |a |your )?((dispute|appeal) )?letters? for you)\b/i.test(
        s,
      )
    ) {
      problems.push(`en: banned wording at ${path}: ${s}`)
    }
  }
  return problems
}

/** The parity rules src/lib/locales.test.ts enforces, on the result. */
function checkParity(all) {
  const problems = []
  const en = flatten(all.en)
  for (const locale of LOCALES) {
    const flat = flatten(all[locale])
    for (const k of Object.keys(en)) if (!(k in flat)) problems.push(`${locale}: missing ${k}`)
    for (const k of Object.keys(flat)) if (!(k in en)) problems.push(`${locale}: extra ${k}`)
    for (const [k, v] of Object.entries(flat)) {
      if (!(k in en)) continue
      const ref = en[k]
      if (ref && typeof ref === 'object') {
        if (!v || typeof v !== 'object' || v.array !== ref.array) problems.push(`${locale}: array length ${k}`)
        continue
      }
      if (typeof ref !== 'string' || typeof v !== 'string') continue
      const isOne = k.endsWith('_one')
      if (varsOf(v, isOne) !== varsOf(ref, isOne)) problems.push(`${locale}: {{vars}} differ at ${k}`)
      if (tagsOf(v) !== tagsOf(ref)) problems.push(`${locale}: <tags> differ at ${k}`)
      if (isOne && !(`${k.slice(0, -'_one'.length)}_other` in flat)) problems.push(`${locale}: ${k} has no _other`)
      if (isOne && (locale === 'hi' || locale === 'pa') && !v.includes('{{count}}')) {
        problems.push(`${locale}: ${k} must use {{count}} (its _one form also covers 0)`)
      }
    }
  }
  return problems
}

// ── --list: keys for the T10 review ─────────────────────────────────────
const pass = readPass()

if (process.argv.includes('--list')) {
  const byKey = new Map()
  for (const locale of LOCALES) {
    for (const k of Object.keys(pass[locale])) byKey.set(k, [...(byKey.get(k) ?? []), locale])
  }
  for (const k of [...byKey.keys()].sort()) console.log(`      ${k}  (${byKey.get(k).join(', ')})`)
  process.exit(0)
}

// ── run ─────────────────────────────────────────────────────────────────
const original = {}
const data = {}
for (const locale of LOCALES) {
  original[locale] = readFileSync(join(LOC, `${locale}.json`), 'utf8')
  data[locale] = JSON.parse(original[locale])
}

// en first, so the other locales are checked against the new English.
for (const locale of LOCALES) {
  for (const [path, value] of Object.entries(pass[locale])) overwrite(data[locale], path, value, locale)
}

const problems = [...checkPass(pass, data.en), ...checkParity(data)]
if (problems.length) fail(`\n  ${problems.join('\n  ')}`)

for (const locale of LOCALES) {
  const next = JSON.stringify(data[locale], null, 2) + '\n'
  if (next === original[locale]) {
    console.log(`unchanged ${locale}.json`)
    continue
  }
  writeFileSync(join(LOC, `${locale}.json`), next, 'utf8')
  console.log(`updated   ${locale}.json (${Object.keys(pass[locale]).length} overwrites)`)
}
