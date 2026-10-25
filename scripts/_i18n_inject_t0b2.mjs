/**
 * T0b2 i18n (roadmap build spec, task T0b2). Idempotent: running it twice
 * leaves the files byte-identical after the first run.
 *
 * Since T0b2, new records keep their photos in IndexedDB (the photo store,
 * spec N4). Two new situations need copy:
 *   - `session.photoNotOnDevice` / `session.photoNotOnDeviceUnsigned`: the
 *     one "bytes missing" state, shown wherever a photo would be when the
 *     record has the photo's PhotoRef but its bytes aren't on this device.
 *     The fingerprint is called signed only when a stored ParkProof
 *     signature contains it; otherwise it says it isn't signed yet.
 *   - `pdf.common.photoNotOnDevice` / `pdf.common.photoNotOnDeviceUnsigned`:
 *     the same state in a PDF. A council officer reads the PDF, so "this
 *     device" becomes "the device that made this PDF" (a full export can be
 *     made on a laptop). The PDF gives the full SHA-256 fingerprint, so it
 *     can be matched against the photo hashes in the signature appendix.
 *     PDF strings are plain text.
 *   - `logger.photoSaveFailed`: the car photo's tile when its bytes couldn't
 *     be stored. No PhotoRef is made for it.
 *   - `logger.saving`: the Save button while the record's photo writes
 *     finish (normally milliseconds, at most a few seconds).
 *   - `session.signPhotoAlt` / `session.carPhotoAlt`: alt text for the
 *     record screen's photos, adding to the heading above each one instead
 *     of repeating it.
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces).
 *
 * Run:   node scripts/_i18n_inject_t0b2.mjs
 * List:  node scripts/_i18n_inject_t0b2.mjs --list
 *        prints every key this task added, for the T10 translation review.
 * Other: node scripts/_i18n_inject_t0b2.mjs --dir <locales dir>
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
const ADDITIONS = {
  'session.photoNotOnDevice': {
    en: 'Photo not on this device. Signed fingerprint {{fingerprint}}.',
    'zh-CN': '这台设备上没有这张照片。已签名的指纹 {{fingerprint}}。',
    vi: 'Ảnh này không có trên thiết bị này. Dấu vân tay số đã ký: {{fingerprint}}.',
    id: 'Foto ini tidak ada di perangkat ini. Sidik jari yang ditandatangani: {{fingerprint}}.',
    ko: '이 기기에 사진이 없습니다. 서명된 디지털 지문: {{fingerprint}}.',
    it: 'Foto non presente su questo dispositivo. Impronta digitale firmata: {{fingerprint}}.',
    el: 'Η φωτογραφία δεν υπάρχει σε αυτή τη συσκευή. Υπογεγραμμένο αποτύπωμα: {{fingerprint}}.',
    hi: 'यह फोटो इस डिवाइस पर नहीं है। हस्ताक्षरित फिंगरप्रिंट: {{fingerprint}}।',
    pa: "ਇਹ ਫੋਟੋ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਨਹੀਂ ਹੈ। ਦਸਤਖ਼ਤ ਕੀਤਾ ਫਿੰਗਰਪ੍ਰਿੰਟ: {{fingerprint}}।",
  },
  'session.photoNotOnDeviceUnsigned': {
    en: 'Photo not on this device. Fingerprint {{fingerprint}}. Not signed yet.',
    'zh-CN': '这台设备上没有这张照片。指纹 {{fingerprint}}。尚未签名。',
    vi: 'Ảnh này không có trên thiết bị này. Dấu vân tay số: {{fingerprint}}. Chưa được ký.',
    id: 'Foto ini tidak ada di perangkat ini. Sidik jari: {{fingerprint}}. Belum ditandatangani.',
    ko: '이 기기에 사진이 없습니다. 디지털 지문: {{fingerprint}}. 아직 서명되지 않았습니다.',
    it: 'Foto non presente su questo dispositivo. Impronta digitale: {{fingerprint}}. Non ancora firmata.',
    el: 'Η φωτογραφία δεν υπάρχει σε αυτή τη συσκευή. Αποτύπωμα: {{fingerprint}}. Δεν έχει υπογραφεί ακόμα.',
    hi: 'यह फोटो इस डिवाइस पर नहीं है। फिंगरप्रिंट: {{fingerprint}}। अभी हस्ताक्षर नहीं हुआ है।',
    pa: "ਇਹ ਫੋਟੋ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਨਹੀਂ ਹੈ। ਫਿੰਗਰਪ੍ਰਿੰਟ: {{fingerprint}}। ਅਜੇ ਦਸਤਖ਼ਤ ਨਹੀਂ ਹੋਏ।",
  },
  'session.signPhotoAlt': {
    en: 'Photo of the parking sign you scanned',
    'zh-CN': '你扫描的停车标志的照片',
    vi: 'Ảnh biển báo đỗ xe bạn đã quét',
    id: 'Foto rambu parkir yang kamu pindai',
    ko: '스캔한 주차 표지판 사진',
    it: 'Foto del cartello di sosta che hai scansionato',
    el: 'Φωτογραφία της πινακίδας στάθμευσης που σάρωσες',
    hi: 'आपके द्वारा स्कैन किए गए पार्किंग साइन की फोटो',
    pa: 'ਤੁਹਾਡੇ ਵੱਲੋਂ ਸਕੈਨ ਕੀਤੇ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਦੀ ਫੋਟੋ',
  },
  'session.carPhotoAlt': {
    en: 'Photo of your car where you parked',
    'zh-CN': '你的车停在车位上的照片',
    vi: 'Ảnh xe của bạn tại chỗ bạn đã đỗ',
    id: 'Foto mobilmu di tempat kamu parkir',
    ko: '주차한 곳에 있는 차량 사진',
    it: 'Foto della tua auto dove hai parcheggiato',
    el: 'Φωτογραφία του αμαξιού σου εκεί που πάρκαρες',
    hi: 'जहाँ आपने पार्क किया, वहाँ आपकी कार की फोटो',
    pa: 'ਜਿੱਥੇ ਤੁਸੀਂ ਪਾਰਕ ਕੀਤਾ, ਉੱਥੇ ਤੁਹਾਡੀ ਕਾਰ ਦੀ ਫੋਟੋ',
  },
  'logger.photoSaveFailed': {
    en: "This photo couldn't be saved on your phone. Try again, or save the record without it.",
    'zh-CN': '这张照片没能保存在你的手机上。请重试,或者不带这张照片保存记录。',
    vi: 'Không lưu được ảnh này trên điện thoại của bạn. Hãy thử lại, hoặc lưu bản ghi mà không có ảnh này.',
    id: 'Foto ini tidak bisa disimpan di ponselmu. Coba lagi, atau simpan catatan tanpa foto ini.',
    ko: '이 사진을 휴대폰에 저장하지 못했습니다. 다시 시도하거나, 이 사진 없이 기록을 저장하세요.',
    it: 'Non è stato possibile salvare questa foto sul telefono. Riprova, oppure salva il record senza.',
    el: 'Δεν ήταν δυνατή η αποθήκευση αυτής της φωτογραφίας στο κινητό σου. Δοκίμασε ξανά ή αποθήκευσε το αρχείο χωρίς αυτήν.',
    hi: 'यह फोटो आपके फोन पर सहेजी नहीं जा सकी। फिर से कोशिश करें, या इस फोटो के बिना रिकॉर्ड सहेजें।',
    pa: "ਇਹ ਫੋਟੋ ਤੁਹਾਡੇ ਫ਼ੋਨ 'ਤੇ ਸੰਭਾਲੀ ਨਹੀਂ ਜਾ ਸਕੀ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ, ਜਾਂ ਇਸ ਫੋਟੋ ਤੋਂ ਬਿਨਾਂ ਰਿਕਾਰਡ ਸੰਭਾਲੋ।",
  },
  'logger.saving': {
    en: 'Saving…',
    'zh-CN': '正在保存…',
    vi: 'Đang lưu…',
    id: 'Menyimpan…',
    ko: '저장 중…',
    it: 'Salvataggio…',
    el: 'Αποθήκευση…',
    hi: 'सहेजा जा रहा है…',
    pa: 'ਸੰਭਾਲਿਆ ਜਾ ਰਿਹਾ ਹੈ…',
  },
  // PDF strings: plain text, WinAnsi punctuation only (Noto fonts for the
  // non-Latin locales).
  'pdf.common.photoNotOnDevice': {
    en: 'Photo not on the device that made this PDF. Its signed SHA-256 fingerprint is {{fingerprint}}.',
    'zh-CN': '生成此 PDF 的设备上没有这张照片。它已签名的 SHA-256 指纹是 {{fingerprint}}。',
    vi: 'Ảnh này không có trên thiết bị đã tạo tệp PDF này. Dấu vân tay số SHA-256 đã ký của ảnh là {{fingerprint}}.',
    id: 'Foto ini tidak ada di perangkat yang membuat PDF ini. Sidik jari SHA-256 yang ditandatangani: {{fingerprint}}.',
    ko: '이 PDF를 만든 기기에 사진이 없습니다. 서명된 SHA-256 디지털 지문: {{fingerprint}}.',
    it: 'Foto non presente sul dispositivo che ha creato questo PDF. La sua impronta digitale SHA-256 firmata è {{fingerprint}}.',
    el: 'Η φωτογραφία δεν υπάρχει στη συσκευή που δημιούργησε αυτό το PDF. Το υπογεγραμμένο αποτύπωμα SHA-256 της είναι {{fingerprint}}.',
    hi: 'यह फोटो उस डिवाइस पर नहीं है जिससे यह PDF बनाई गई। इसका हस्ताक्षरित SHA-256 फिंगरप्रिंट {{fingerprint}} है।',
    pa: "ਇਹ ਫੋਟੋ ਉਸ ਡਿਵਾਈਸ 'ਤੇ ਨਹੀਂ ਹੈ ਜਿਸ ਨਾਲ ਇਹ PDF ਬਣਾਈ ਗਈ। ਇਸਦਾ ਦਸਤਖ਼ਤ ਕੀਤਾ SHA-256 ਫਿੰਗਰਪ੍ਰਿੰਟ {{fingerprint}} ਹੈ।",
  },
  'pdf.common.photoNotOnDeviceUnsigned': {
    en: 'Photo not on the device that made this PDF. Its SHA-256 fingerprint is {{fingerprint}}. Not signed yet.',
    'zh-CN': '生成此 PDF 的设备上没有这张照片。它的 SHA-256 指纹是 {{fingerprint}}。尚未签名。',
    vi: 'Ảnh này không có trên thiết bị đã tạo tệp PDF này. Dấu vân tay số SHA-256 của ảnh là {{fingerprint}}. Chưa được ký.',
    id: 'Foto ini tidak ada di perangkat yang membuat PDF ini. Sidik jari SHA-256: {{fingerprint}}. Belum ditandatangani.',
    ko: '이 PDF를 만든 기기에 사진이 없습니다. SHA-256 디지털 지문: {{fingerprint}}. 아직 서명되지 않았습니다.',
    it: 'Foto non presente sul dispositivo che ha creato questo PDF. La sua impronta digitale SHA-256 è {{fingerprint}}. Non ancora firmata.',
    el: 'Η φωτογραφία δεν υπάρχει στη συσκευή που δημιούργησε αυτό το PDF. Το αποτύπωμα SHA-256 της είναι {{fingerprint}}. Δεν έχει υπογραφεί ακόμα.',
    hi: 'यह फोटो उस डिवाइस पर नहीं है जिससे यह PDF बनाई गई। इसका SHA-256 फिंगरप्रिंट {{fingerprint}} है। अभी हस्ताक्षर नहीं हुआ है।',
    pa: "ਇਹ ਫੋਟੋ ਉਸ ਡਿਵਾਈਸ 'ਤੇ ਨਹੀਂ ਹੈ ਜਿਸ ਨਾਲ ਇਹ PDF ਬਣਾਈ ਗਈ। ਇਸਦਾ SHA-256 ਫਿੰਗਰਪ੍ਰਿੰਟ {{fingerprint}} ਹੈ। ਅਜੇ ਦਸਤਖ਼ਤ ਨਹੀਂ ਹੋਏ।",
  },
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
      if (path.startsWith('pdf.') && /[✓⚠→≈≤…]/u.test(s)) problems.push(`symbol in PDF copy at ${path}: ${s}`)
      if (path.startsWith('pdf.') && /[‘’“”]/u.test(s)) problems.push(`curly quote in PDF copy at ${path}: ${s}`)
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
