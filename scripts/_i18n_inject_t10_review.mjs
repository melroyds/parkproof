/**
 * T10 translation review i18n (roadmap build spec, T10 item 1): one
 * reviewer per non-English locale read every key added or changed in this
 * build against the terminology table in docs/legal-pdf-review-worksheet.md,
 * the register (el εσύ, id kamu, zh 你), gender-neutral hi and pa, and the
 * English, and rewrote the strings that said more or less than the English
 * says. Idempotent: running it twice leaves the files byte-identical after
 * the first run.
 *
 * The corrections live in data files, one per reviewed locale, not in this
 * script:
 *   scripts/t10-review/<locale>.json
 * Each is a flat object of dotted key -> new string, the same shape as
 * scripts/copy-pass/<locale>.json. A numeric segment indexes into an array:
 * `about.scan.items.0` is the first item of the `about.scan.items` list.
 * Every entry is an explicit OVERWRITE of a whole string that already
 * exists: this script never adds, removes or re-sorts a key, so each file
 * keeps its key order. English is not reviewed, so there is no en file.
 * The verify-<locale>.json files in the same folder are the review of the
 * /verify pages; they go into scripts/_build_verify_pages.py, not here.
 *
 * Run order: LAST, after scripts/_i18n_inject_copy_pass.mjs. The full chain
 * is fix_push, t6a, t8, t3, t5, t2, t4, t7, t6bc, fixlist_final, copy_pass,
 * then this script. Never re-run the T0a to T1b scripts.
 * So the order can't matter for the copy pass, a reviewed key that the copy
 * pass also overwrites must carry the reviewed text in
 * scripts/copy-pass/<locale>.json too (checked below): running the copy
 * pass again after this script then changes nothing. For that reason
 * `privacy.rightsAnonymous` in el also carries the reviewed text in
 * scripts/_i18n_inject_fixlist_final.mjs, which checks that the copy pass
 * agrees with it.
 *
 * Replay: the chain above, run on the locale files at 09d5c24 (before this
 * review), gives these files byte for byte. The earlier scripts don't know
 * the reviewed text: run again on files this review has touched, most of
 * them rewrite their own keys back (this script then restores the review),
 * and scripts/_i18n_inject_t7.mjs aborts on its own-key guard (for example
 * zh-CN pdf.shared.field), which rewrites only the keys in its REVISED.
 *
 * Writes nothing (exit 1) when:
 *   - a review file isn't a flat object of strings, has a duplicate key, is
 *     named for a locale ParkProof doesn't ship, or is named en.json;
 *   - a key isn't dotted (`items[0]`: write `items.0`), isn't an existing
 *     string in the locale it overwrites, or has no string at the same path
 *     in en;
 *   - a value's {{vars}} or <tags> differ from en's value for that key;
 *   - a value contains an em-dash, or a pdf.* value a symbol the PDF fonts
 *     can't draw;
 *   - the copy-pass file for that locale overwrites the same key with other
 *     text (the copy pass would undo the review);
 *   - after applying, any locale fails the parity checks
 *     src/lib/locales.test.ts enforces.
 *
 * Run:   node scripts/_i18n_inject_t10_review.mjs
 * List:  node scripts/_i18n_inject_t10_review.mjs --list
 *        prints every reviewed key and the locales that rewrite it.
 * Other: node scripts/_i18n_inject_t10_review.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 *        --review <review dir> reads the corrections from another folder.
 *        --pass <copy-pass dir> reads the copy-pass files from another folder.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const reviewArg = process.argv.indexOf('--review')
const REVIEW = reviewArg > -1 ? resolve(process.argv[reviewArg + 1]) : join(ROOT, 'scripts', 't10-review')
const passArg = process.argv.indexOf('--pass')
const PASS = passArg > -1 ? resolve(process.argv[passArg + 1]) : join(ROOT, 'scripts', 'copy-pass')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']
const REVIEWED = LOCALES.filter((l) => l !== 'en')

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
  if (!at || typeof at.node[at.leaf] !== 'string') fail(`${locale}: reviewed key ${path} is not an existing string`)
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

/** A flat object of dotted key -> string, with no duplicate key. Aborts otherwise. */
function readFlat(file, label) {
  const raw = readFileSync(file, 'utf8')
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    fail(`${label} is not valid JSON: ${e.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${label} must be an object of dotted key -> string`)
  }
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== 'string') fail(`${label}: ${k} is not a string`)
  }
  // JSON.parse keeps the last of two equal keys without a word. The files
  // are one key per line, so count the key lines.
  const keyLines = raw.match(/^\s*"(?:[^"\\]|\\.)*"\s*:/gm) || []
  if (keyLines.length !== Object.keys(parsed).length) fail(`${label} has a duplicate key`)
  return parsed
}

// ── read the review ─────────────────────────────────────────────────────
/** { locale: { dottedKey: newString } } in file order. */
function readReview() {
  const files = readdirSync(REVIEW).filter((f) => f.endsWith('.json'))
  for (const f of files) {
    const name = f.slice(0, -'.json'.length)
    // verify-<locale>.json: the /verify pages' review (scripts/_build_verify_pages.py).
    if (name.startsWith('verify-') && REVIEWED.includes(name.slice('verify-'.length))) continue
    if (!REVIEWED.includes(name)) fail(`scripts/t10-review/${f} is not a reviewed ParkProof locale`)
  }
  const review = {}
  for (const locale of REVIEWED) {
    review[locale] = files.includes(`${locale}.json`)
      ? readFlat(join(REVIEW, `${locale}.json`), `scripts/t10-review/${locale}.json`)
      : {}
  }
  return review
}

// ── checks ──────────────────────────────────────────────────────────────
/** Problems with the corrections themselves, checked against en. */
function checkReview(review, en) {
  const problems = []
  for (const locale of REVIEWED) {
    for (const [path, s] of Object.entries(review[locale])) {
      if (/[[\]]/.test(path)) {
        problems.push(`${locale}: ${path} must be dotted (write items.0, not items[0])`)
        continue
      }
      const ref = stringAt(en, path)
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
  return problems
}

/**
 * The copy pass ran before this script. If it ran again it would rewrite
 * every key in its files, so a reviewed key there must carry the reviewed
 * text, or the copy pass would undo the review.
 */
function copyPassProblems(review) {
  const problems = []
  for (const locale of REVIEWED) {
    const file = join(PASS, `${locale}.json`)
    if (!existsSync(file)) continue
    const pass = readFlat(file, `scripts/copy-pass/${locale}.json`)
    for (const [path, s] of Object.entries(review[locale])) {
      if (path in pass && pass[path] !== s) {
        problems.push(`${locale}: scripts/copy-pass/${locale}.json has other text for ${path}, which would undo the review`)
      }
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

// ── --list: the reviewed keys ───────────────────────────────────────────
const review = readReview()

if (process.argv.includes('--list')) {
  const byKey = new Map()
  for (const locale of REVIEWED) {
    for (const k of Object.keys(review[locale])) byKey.set(k, [...(byKey.get(k) ?? []), locale])
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

const before = [...checkReview(review, data.en), ...copyPassProblems(review)]
if (before.length) fail(`\n  ${before.join('\n  ')}`)

for (const locale of REVIEWED) {
  for (const [path, value] of Object.entries(review[locale])) overwrite(data[locale], path, value, locale)
}

const problems = checkParity(data)
if (problems.length) fail(`\n  ${problems.join('\n  ')}`)

for (const locale of LOCALES) {
  const next = JSON.stringify(data[locale], null, 2) + '\n'
  if (next === original[locale]) {
    console.log(`unchanged ${locale}.json`)
    continue
  }
  writeFileSync(join(LOC, `${locale}.json`), next, 'utf8')
  console.log(`updated   ${locale}.json (${Object.keys(review[locale]).length} reviewed)`)
}
