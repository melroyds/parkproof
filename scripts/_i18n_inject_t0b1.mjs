/**
 * T0b1 i18n (roadmap build spec, task T0b1). Idempotent: running it twice
 * leaves the files byte-identical after the first run.
 *
 * Since T0b1, `npm run dev` signs records with an ephemeral local key
 * (key_alias 'dev-ephemeral'). Such a signature can't be checked with
 * ParkProof's published key, so the record screen and the PDF appendix
 * must never present it as a ParkProof signature (spec N2):
 *   - `session.devKeySigned` replaces "Cryptographically signed" on the
 *     record screen's vault panel (and the seal loses its mint glow).
 *   - `pdf.signature.devKey` opens the PDF signature appendix, above the
 *     KMS wording and the openssl steps that don't apply to it.
 * Both say the same thing. The verifier's own dev-key state is T0b3's.
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces).
 *
 * Run:   node scripts/_i18n_inject_t0b1.mjs
 * List:  node scripts/_i18n_inject_t0b1.mjs --list
 *        prints every key this task added, for the T10 translation review.
 * Other: node scripts/_i18n_inject_t0b1.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

const DEV_KEY = {
  en: "Signed with a development key. It can't be checked with ParkProof's published key.",
  'zh-CN': '此记录使用开发密钥签名。无法用 ParkProof 公布的公钥核验。',
  vi: 'Đã ký bằng khóa phát triển. Không thể kiểm tra chữ ký này bằng khóa công khai mà ParkProof đã công bố.',
  id: 'Ditandatangani dengan kunci pengembangan. Tanda tangan ini tidak bisa dicek dengan kunci publik yang diterbitkan ParkProof.',
  ko: '개발용 키로 서명되었습니다. ParkProof가 공개한 키로는 확인할 수 없습니다.',
  it: 'Firmato con una chiave di sviluppo. Non si può verificare con la chiave pubblicata da ParkProof.',
  el: 'Υπογράφηκε με κλειδί ανάπτυξης. Δεν μπορεί να ελεγχθεί με το δημοσιευμένο κλειδί του ParkProof.',
  hi: 'डेवलपमेंट कुंजी से हस्ताक्षरित। इसे ParkProof की प्रकाशित कुंजी से जांचा नहीं जा सकता।',
  pa: 'ਡਿਵੈਲਪਮੈਂਟ ਕੁੰਜੀ ਨਾਲ ਹਸਤਾਖਰਿਤ। ਇਸ ਨੂੰ ParkProof ਦੀ ਪ੍ਰਕਾਸ਼ਿਤ ਕੁੰਜੀ ਨਾਲ ਜਾਂਚਿਆ ਨਹੀਂ ਜਾ ਸਕਦਾ।',
}

// ── New keys, appended inside their parent object ────────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position) instead of skipping existing ones.
const ADDITIONS = {
  'session.devKeySigned': DEV_KEY,
  // PDF string: plain text, WinAnsi punctuation only.
  'pdf.signature.devKey': DEV_KEY,
}

// ── helpers ─────────────────────────────────────────────────────────────
function fail(msg) {
  console.error(`ABORT (nothing written): ${msg}`)
  process.exit(1)
}

function parentOf(root, path, locale) {
  const parts = path.split('.')
  const leaf = parts.pop()
  let node = root
  for (const p of parts) {
    if (!node[p] || typeof node[p] !== 'object' || Array.isArray(node[p])) {
      fail(`${locale}: no object at "${parts.join('.')}" for ${path}`)
    }
    node = node[p]
  }
  return { node, leaf }
}

/** Set a key this script owns: appended when new, rewritten in place when present. */
function setOwned(root, path, value, locale) {
  const { node, leaf } = parentOf(root, path, locale)
  if (node[leaf] !== undefined && typeof node[leaf] !== 'string') fail(`${locale}: ${path} is not a string`)
  node[leaf] = value
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

function validate(all) {
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
  for (const [path, byLocale] of Object.entries(ADDITIONS)) {
    for (const s of Object.values(byLocale)) {
      // Copy rules: no em-dashes; PDF strings without symbols the PDF fonts can't draw.
      if (s.includes('—')) problems.push(`em-dash in new copy at ${path}: ${s}`)
      if (path.startsWith('pdf.') && /[✓⚠→≈≤]/u.test(s)) problems.push(`symbol in PDF copy at ${path}: ${s}`)
    }
    // The en record noun is "record", never "session".
    if (/\bsessions?\b/i.test(byLocale.en)) problems.push(`"session" in en copy at ${path}`)
  }
  return problems
}

// ── --list: keys for the T10 review ─────────────────────────────────────
if (process.argv.includes('--list')) {
  for (const k of Object.keys(ADDITIONS).sort()) console.log(`      ${k}`)
  process.exit(0)
}

// ── run ─────────────────────────────────────────────────────────────────
const original = {}
const data = {}
for (const locale of LOCALES) {
  original[locale] = readFileSync(join(LOC, `${locale}.json`), 'utf8')
  data[locale] = JSON.parse(original[locale])
}

for (const locale of LOCALES) {
  for (const [path, byLocale] of Object.entries(ADDITIONS)) {
    if (typeof byLocale[locale] !== 'string') fail(`no ${locale} text for new key ${path}`)
    setOwned(data[locale], path, byLocale[locale], locale)
  }
}

const problems = validate(data)
if (problems.length) fail(`\n  ${problems.join('\n  ')}`)

for (const locale of LOCALES) {
  const next = JSON.stringify(data[locale], null, 2) + '\n'
  if (next === original[locale]) {
    console.log(`unchanged ${locale}.json`)
    continue
  }
  writeFileSync(join(LOC, `${locale}.json`), next, 'utf8')
  console.log(`updated   ${locale}.json`)
}
