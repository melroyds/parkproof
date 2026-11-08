/**
 * T0b3 i18n (roadmap build spec, task T0b3: the browser verifier).
 * Idempotent: running it twice leaves the files byte-identical after the
 * first run.
 *
 * src/lib/verify.ts reports a status per link (valid, invalid, pending,
 * rejected, dev key), per photo (matches, differs, not on this device) and
 * forks ("Added from two devices"). Statuses are code values, so screens
 * show them through the key maps in verify.ts (LINK_STATUS_KEYS,
 * PHOTO_STATUS_KEYS, FORK_KEY), never raw. This script adds those keys
 * under a new top-level `verifier` object:
 *   - verifier.link.pending and verifier.link.rejected are the T1a chain
 *     panel's own wording ("Not signed yet", "This part couldn't be signed");
 *   - verifier.link.devKey says what session.devKeySigned (T0b1) says, about
 *     one part of the record rather than the record (so zh-CN says 这部分
 *     and it agrees with the feminine "parte");
 *   - verifier.link.chainBroken is for an invalid link whose only problem
 *     is the chain around it (parent missing, parent hash, chain key): it
 *     says its place can't be checked, never that the part changed;
 *   - a photo not on this device reuses session.photoNotOnDevice (T0b2),
 *     the one bytes-missing state (N4); verifier.photo.notOnDeviceDevKey is
 *     its form for a photo only development-key links sign.
 *
 * OVERWRITES changes existing strings from earlier tasks (explicit list,
 * spec i18n rules): pa session.photoNotOnDevice and
 * session.photoNotOnDeviceUnsigned move from ਦਸਤਖ਼ਤ to ਹਸਤਾਖਰ, the
 * signature term the verifier panel and pdf.signature.title use.
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces).
 *
 * Run:   node scripts/_i18n_inject_t0b3.mjs
 * List:  node scripts/_i18n_inject_t0b3.mjs --list
 *        prints every key this task added, for the T10 translation review.
 * Other: node scripts/_i18n_inject_t0b3.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

// ── New keys, appended inside their parent object ────────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position) instead of skipping existing ones.
// Missing parent objects (`verifier`, `verifier.link`, `verifier.photo`)
// are created, appended at the end of their own parent.
const ADDITIONS = {
  // About the signed details only: a photo can still read "differs" on a
  // valid link, and link 0's stored fields aren't compared with its payload.
  'verifier.link.valid': {
    en: "Signature valid. The signed details haven't changed since ParkProof signed them.",
    'zh-CN': '签名有效。已签名的内容自 ParkProof 签名以来没有改动。',
    vi: 'Chữ ký hợp lệ. Các thông tin đã ký chưa thay đổi kể từ khi ParkProof ký.',
    id: 'Tanda tangan valid. Detail yang ditandatangani tidak berubah sejak ParkProof menandatanganinya.',
    ko: '서명이 유효합니다. 서명된 내용은 ParkProof가 서명한 뒤로 바뀌지 않았습니다.',
    it: 'Firma valida. I dati firmati non sono cambiati da quando ParkProof li ha firmati.',
    el: 'Η υπογραφή είναι έγκυρη. Τα υπογεγραμμένα στοιχεία δεν έχουν αλλάξει από τότε που τα υπέγραψε το ParkProof.',
    hi: 'हस्ताक्षर मान्य है। ParkProof के हस्ताक्षर करने के बाद से हस्ताक्षरित विवरणों में कोई बदलाव नहीं हुआ है।',
    pa: 'ਹਸਤਾਖਰ ਵੈਧ ਹੈ। ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਹਸਤਾਖਰਿਤ ਵੇਰਵਿਆਂ ਵਿੱਚ ਕੋਈ ਬਦਲਾਅ ਨਹੀਂ ਹੋਇਆ।',
  },
  // Doesn't say which happened (changed, or never signed by ParkProof, or
  // signed for another record): the verifier can't always tell.
  'verifier.link.invalid': {
    en: "Signature not valid. This part isn't what ParkProof signed for this record.",
    'zh-CN': '签名无效。这部分不是 ParkProof 为这条记录签名的内容。',
    vi: 'Chữ ký không hợp lệ. Phần này không phải là nội dung ParkProof đã ký cho bản ghi này.',
    id: 'Tanda tangan tidak valid. Bagian ini bukan yang ditandatangani ParkProof untuk catatan ini.',
    ko: '서명이 유효하지 않습니다. 이 부분은 ParkProof가 이 기록에 서명한 내용이 아닙니다.',
    it: 'Firma non valida. Questa parte non è quella che ParkProof ha firmato per questo record.',
    el: 'Η υπογραφή δεν είναι έγκυρη. Αυτό το τμήμα δεν είναι αυτό που υπέγραψε το ParkProof για αυτή την εγγραφή.',
    hi: 'हस्ताक्षर मान्य नहीं है। यह हिस्सा वह नहीं है जिस पर ParkProof ने इस रिकॉर्ड के लिए हस्ताक्षर किए थे।',
    pa: "ਹਸਤਾਖਰ ਵੈਧ ਨਹੀਂ ਹੈ। ਇਹ ਹਿੱਸਾ ਉਹ ਨਹੀਂ ਹੈ ਜਿਸ 'ਤੇ ParkProof ਨੇ ਇਸ ਰਿਕਾਰਡ ਲਈ ਹਸਤਾਖਰ ਕੀਤੇ ਸਨ।",
  },
  'verifier.link.pending': {
    en: 'Not signed yet',
    'zh-CN': '尚未签名',
    vi: 'Chưa được ký',
    id: 'Belum ditandatangani',
    ko: '아직 서명되지 않음',
    it: 'Non ancora firmata',
    el: 'Δεν έχει υπογραφεί ακόμα',
    hi: 'अभी हस्ताक्षर नहीं हुआ है',
    pa: 'ਅਜੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ',
  },
  'verifier.link.rejected': {
    en: "This part couldn't be signed",
    'zh-CN': '这部分无法签名',
    vi: 'Không thể ký phần này',
    id: 'Bagian ini tidak bisa ditandatangani',
    ko: '이 부분은 서명할 수 없었습니다',
    it: 'Non è stato possibile firmare questa parte',
    el: 'Αυτό το τμήμα δεν μπόρεσε να υπογραφεί',
    hi: 'इस हिस्से पर हस्ताक्षर नहीं हो सका',
    pa: "ਇਸ ਹਿੱਸੇ 'ਤੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋ ਸਕੇ",
  },
  // session.devKeySigned (scripts/_i18n_inject_t0b1.mjs) about one part:
  // the same text, except zh-CN (这部分, not 此记录) and it (feminine, to
  // agree with "parte" like the panel's other statuses).
  'verifier.link.devKey': {
    en: "Signed with a development key. It can't be checked with ParkProof's published key.",
    'zh-CN': '这部分使用开发密钥签名。无法用 ParkProof 公布的公钥核验。',
    vi: 'Đã ký bằng khóa phát triển. Không thể kiểm tra chữ ký này bằng khóa công khai mà ParkProof đã công bố.',
    id: 'Ditandatangani dengan kunci pengembangan. Tanda tangan ini tidak bisa dicek dengan kunci publik yang diterbitkan ParkProof.',
    ko: '개발용 키로 서명되었습니다. ParkProof가 공개한 키로는 확인할 수 없습니다.',
    it: 'Firmata con una chiave di sviluppo. Non si può verificare con la chiave pubblicata da ParkProof.',
    el: 'Υπογράφηκε με κλειδί ανάπτυξης. Δεν μπορεί να ελεγχθεί με το δημοσιευμένο κλειδί του ParkProof.',
    hi: 'डेवलपमेंट कुंजी से हस्ताक्षरित। इसे ParkProof की प्रकाशित कुंजी से जांचा नहीं जा सकता।',
    pa: 'ਡਿਵੈਲਪਮੈਂਟ ਕੁੰਜੀ ਨਾਲ ਹਸਤਾਖਰਿਤ। ਇਸ ਨੂੰ ParkProof ਦੀ ਪ੍ਰਕਾਸ਼ਿਤ ਕੁੰਜੀ ਨਾਲ ਜਾਂਚਿਆ ਨਹੀਂ ਜਾ ਸਕਦਾ।',
  },
  // An invalid link whose only problems are the chain around it (verify.ts
  // LINK_CHAIN_BROKEN_KEY). Makes no claim about the part's own signature,
  // so it is true for a development-key link too. Kept after devKey so a
  // replay on locales without `verifier` gives the same key order.
  'verifier.link.chainBroken': {
    en: "Its place in the record can't be checked. The part signed before it is missing from this device or doesn't match.",
    'zh-CN': '无法核对这部分在记录中的位置。在它之前签名的那部分不在这台设备上,或者对不上。',
    vi: 'Không thể kiểm tra vị trí của phần này trong bản ghi. Phần được ký trước nó không có trên thiết bị này hoặc không khớp.',
    id: 'Posisi bagian ini dalam catatan tidak bisa dicek. Bagian yang ditandatangani sebelum bagian ini tidak ada di perangkat ini atau tidak cocok.',
    ko: '기록에서 이 부분의 위치를 확인할 수 없습니다. 바로 앞에 서명된 부분이 이 기기에 없거나 일치하지 않습니다.',
    it: 'Non si può verificare la posizione di questa parte nel record. La parte firmata prima di questa non è su questo dispositivo o non corrisponde.',
    el: 'Η θέση αυτού του τμήματος στην εγγραφή δεν μπορεί να ελεγχθεί. Το τμήμα που υπογράφηκε πριν από αυτό λείπει από αυτή τη συσκευή ή δεν ταιριάζει.',
    hi: 'रिकॉर्ड में इस हिस्से की जगह जांची नहीं जा सकती। इससे पहले हस्ताक्षरित हिस्सा इस डिवाइस पर नहीं है या मेल नहीं खाता।',
    pa: "ਰਿਕਾਰਡ ਵਿੱਚ ਇਸ ਹਿੱਸੇ ਦੀ ਥਾਂ ਜਾਂਚੀ ਨਹੀਂ ਜਾ ਸਕਦੀ। ਇਸ ਤੋਂ ਪਹਿਲਾਂ ਹਸਤਾਖਰਿਤ ਹਿੱਸਾ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਨਹੀਂ ਹੈ ਜਾਂ ਮੇਲ ਨਹੀਂ ਖਾਂਦਾ।",
  },
  'verifier.fork': {
    en: 'Added from two devices',
    'zh-CN': '从两台设备添加',
    vi: 'Được thêm từ hai thiết bị',
    id: 'Ditambahkan dari dua perangkat',
    ko: '두 기기에서 추가됨',
    it: 'Aggiunta da due dispositivi',
    el: 'Προστέθηκε από δύο συσκευές',
    hi: 'दो डिवाइस से जोड़ा गया',
    pa: 'ਦੋ ਡਿਵਾਈਸਾਂ ਤੋਂ ਜੋੜਿਆ ਗਿਆ',
  },
  'verifier.photo.matches': {
    en: 'This photo matches its signed fingerprint.',
    'zh-CN': '这张照片与已签名的指纹一致。',
    vi: 'Ảnh này khớp với dấu vân tay số đã ký.',
    id: 'Foto ini cocok dengan sidik jari yang ditandatangani.',
    ko: '이 사진은 서명된 디지털 지문과 일치합니다.',
    it: 'Questa foto corrisponde alla sua impronta digitale firmata.',
    el: 'Αυτή η φωτογραφία ταιριάζει με το υπογεγραμμένο αποτύπωμά της.',
    hi: 'यह फोटो अपने हस्ताक्षरित फिंगरप्रिंट से मेल खाती है।',
    pa: 'ਇਹ ਫੋਟੋ ਆਪਣੇ ਹਸਤਾਖਰਿਤ ਫਿੰਗਰਪ੍ਰਿੰਟ ਨਾਲ ਮੇਲ ਖਾਂਦੀ ਹੈ।',
  },
  'verifier.photo.differs': {
    en: "This isn't the photo that was signed. Its fingerprint doesn't match.",
    'zh-CN': '这不是签名时的那张照片。指纹对不上。',
    vi: 'Đây không phải là ảnh đã được ký. Dấu vân tay số không khớp.',
    id: 'Ini bukan foto yang ditandatangani. Sidik jarinya tidak cocok.',
    ko: '서명된 사진이 아닙니다. 디지털 지문이 일치하지 않습니다.',
    it: "Questa non è la foto che è stata firmata. L'impronta digitale non corrisponde.",
    el: 'Αυτή δεν είναι η φωτογραφία που υπογράφηκε. Το αποτύπωμα δεν ταιριάζει.',
    hi: 'यह वह फोटो नहीं है जिस पर हस्ताक्षर हुए थे। इसका फिंगरप्रिंट मेल नहीं खाता।',
    pa: "ਇਹ ਉਹ ਫੋਟੋ ਨਹੀਂ ਹੈ ਜਿਸ 'ਤੇ ਹਸਤਾਖਰ ਹੋਏ ਸਨ। ਇਸ ਦਾ ਫਿੰਗਰਪ੍ਰਿੰਟ ਮੇਲ ਨਹੀਂ ਖਾਂਦਾ।",
  },
  // session.photoNotOnDeviceUnsigned's form for a photo that only
  // development-key links sign (it is signed, just not with ParkProof's key).
  'verifier.photo.notOnDeviceDevKey': {
    en: 'Photo not on this device. Fingerprint {{fingerprint}}. Signed with a development key.',
    'zh-CN': '这台设备上没有这张照片。指纹 {{fingerprint}}。使用开发密钥签名。',
    vi: 'Ảnh này không có trên thiết bị này. Dấu vân tay số: {{fingerprint}}. Đã ký bằng khóa phát triển.',
    id: 'Foto ini tidak ada di perangkat ini. Sidik jari: {{fingerprint}}. Ditandatangani dengan kunci pengembangan.',
    ko: '이 기기에 사진이 없습니다. 디지털 지문: {{fingerprint}}. 개발용 키로 서명되었습니다.',
    it: 'Foto non presente su questo dispositivo. Impronta digitale: {{fingerprint}}. Firmata con una chiave di sviluppo.',
    el: 'Η φωτογραφία δεν υπάρχει σε αυτή τη συσκευή. Αποτύπωμα: {{fingerprint}}. Υπογράφηκε με κλειδί ανάπτυξης.',
    hi: 'यह फोटो इस डिवाइस पर नहीं है। फिंगरप्रिंट: {{fingerprint}}। डेवलपमेंट कुंजी से हस्ताक्षरित।',
    pa: "ਇਹ ਫੋਟੋ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਨਹੀਂ ਹੈ। ਫਿੰਗਰਪ੍ਰਿੰਟ: {{fingerprint}}। ਡਿਵੈਲਪਮੈਂਟ ਕੁੰਜੀ ਨਾਲ ਹਸਤਾਖਰਿਤ।",
  },
}

// ── Changed existing strings (explicit overwrite list) ──────────────────
// Keys from earlier tasks. Each must already exist; it is rewritten in
// place. The verifier panel shows session.photoNotOnDevice next to the
// verifier.* lines, so pa uses one word for signature there (ਹਸਤਾਖਰ, as in
// pdf.signature.title "ਕ੍ਰਿਪਟੋਗ੍ਰਾਫਿਕ ਹਸਤਾਖਰ").
const OVERWRITES = {
  pa: {
    'session.photoNotOnDevice': "ਇਹ ਫੋਟੋ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਨਹੀਂ ਹੈ। ਹਸਤਾਖਰਿਤ ਫਿੰਗਰਪ੍ਰਿੰਟ: {{fingerprint}}।",
    'session.photoNotOnDeviceUnsigned': "ਇਹ ਫੋਟੋ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਨਹੀਂ ਹੈ। ਫਿੰਗਰਪ੍ਰਿੰਟ: {{fingerprint}}। ਅਜੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ।",
  },
}

// ── helpers ─────────────────────────────────────────────────────────────
function fail(msg) {
  console.error(`ABORT (nothing written): ${msg}`)
  process.exit(1)
}

/** The object at `path`'s parent, creating missing objects (appended at the end of their parent). */
function parentOf(root, path, locale) {
  const parts = path.split('.')
  const leaf = parts.pop()
  let node = root
  for (const p of parts) {
    if (node[p] === undefined) node[p] = {}
    if (!node[p] || typeof node[p] !== 'object' || Array.isArray(node[p])) {
      fail(`${locale}: "${p}" in ${path} is not an object`)
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

/** Rewrite an existing string in place (OVERWRITES). Aborts when the key is missing. */
function overwrite(root, path, value, locale) {
  let node = root
  const parts = path.split('.')
  const leaf = parts.pop()
  for (const p of parts) {
    node = node?.[p]
    if (!node || typeof node !== 'object' || Array.isArray(node)) fail(`${locale}: overwrite ${path} has no parent object`)
  }
  if (typeof node[leaf] !== 'string') fail(`${locale}: overwrite ${path} is not an existing string`)
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
    // Words the copy rules ban outright.
    if (/\b(reset|compliant|admissible|authentic|verified location)\b/i.test(byLocale.en)) {
      problems.push(`banned word in en copy at ${path}`)
    }
  }
  for (const [locale, entries] of Object.entries(OVERWRITES)) {
    for (const [path, s] of Object.entries(entries)) {
      if (s.includes('—')) problems.push(`em-dash in overwritten copy at ${locale} ${path}: ${s}`)
    }
  }
  return problems
}

// ── --list: keys for the T10 review ─────────────────────────────────────
if (process.argv.includes('--list')) {
  for (const k of Object.keys(ADDITIONS).sort()) console.log(`      ${k}`)
  for (const [locale, entries] of Object.entries(OVERWRITES)) {
    for (const k of Object.keys(entries).sort()) console.log(`      ${k} (${locale}, overwritten)`)
  }
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
  for (const [path, value] of Object.entries(OVERWRITES[locale] ?? {})) {
    overwrite(data[locale], path, value, locale)
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
