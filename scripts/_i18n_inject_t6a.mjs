/**
 * T6a i18n (roadmap build spec, task T6a: workday mode's state,
 * jurisdiction and safety maths, no screens). Idempotent: running it twice
 * leaves the files byte-identical after the first run.
 *
 * Adds the `workday` top-level object with the reminder copy that
 * src/lib/workday.ts (workdayReminderCopy) sends for each workday leg:
 *   - workday.reminder.headsUp       45 minutes before the deadline
 *   - workday.reminder.goNow         the walk time (at least 10 minutes)
 *                                    plus 15 minutes before it
 *   - workday.reminder.ended         at the deadline
 *   - workday.reminder.headsUpArea   the heads-up under an area sign
 *   - workday.reminder.endedArea     the at-deadline line under an area sign
 * Each takes {{time}}: the deadline as an absolute local time (with the
 * day when it isn't the day the reminder fires, and the zone's name when a
 * daylight saving change falls in between), never "in 10 minutes".
 *
 * The copy says the car has to leave the signed stretch, or the whole area
 * under an area sign, never that moving restarts anything, and never names
 * a distance. The heads-up and go-now lines are the reminder copy of build
 * spec T6b item 9, added here because workdayReminderCopy (T6a) sends them;
 * the heads-up says "Your time limit" where the spec says "Your 2P" (see
 * docs/legal-review-queue.md). Workday mode is behind
 * VITE_FEATURE_WORKDAY until a lawyer has read every workday string; each
 * key is listed in docs/legal-review-queue.md. T6b's screen copy goes in
 * its own script and extends the same `workday` object.
 *
 * Changes no existing string (OVERWRITES is empty).
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces, plus the copy rules for the
 * en text of every key this script owns).
 *
 * Run:   node scripts/_i18n_inject_t6a.mjs
 * List:  node scripts/_i18n_inject_t6a.mjs --list
 *        prints every key this task added, for the T10 translation review
 *        ('legal' marks the keys a lawyer must read before the flag is
 *        turned on in production).
 * Other: node scripts/_i18n_inject_t6a.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

/** Keys a lawyer must read before VITE_FEATURE_WORKDAY is on in production (docs/legal-review-queue.md). */
const LEGAL = new Set([
  'workday.reminder.headsUp',
  'workday.reminder.goNow',
  'workday.reminder.ended',
  'workday.reminder.headsUpArea',
  'workday.reminder.endedArea',
])

// ── New keys, appended inside their parent object ────────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position). Missing parent objects are created,
// appended at the end of their own parent.
const ADDITIONS = {
  // Heads-up, 45 minutes before the deadline. The deadline can be the
  // stretch's original limit (the driver wasn't sure they left the signed
  // stretch) or this sign's own, so the copy names neither a "2P" nor a
  // reason, only the time and what counts as moving.
  'workday.reminder.headsUp': {
    en: 'Your time limit on this stretch ends at {{time}}. Move off this signed stretch, not just to another bay.',
    'zh-CN': '你在此路段的停车时限于 {{time}} 结束。请把车开出该标志适用的路段,不要只是换到另一个车位。',
    vi: 'Thời hạn đỗ xe của bạn trên đoạn đường này kết thúc lúc {{time}}. Hãy dời xe ra khỏi đoạn đường có biển báo này, không chỉ sang một chỗ đỗ khác.',
    id: 'Batas waktu parkirmu di ruas jalan ini berakhir pukul {{time}}. Pindahkan mobil keluar dari ruas jalan yang diatur rambu ini, bukan hanya ke petak parkir lain.',
    ko: '이 구간의 주차 시간 제한이 {{time}}에 끝납니다. 다른 주차 칸으로 옮기는 것만으로는 안 되며, 표지판이 적용되는 이 구간을 벗어나야 합니다.',
    it: "Il limite di tempo su questo tratto scade alle {{time}}. Sposta l'auto fuori dal tratto indicato dal cartello, non solo in un altro posto.",
    el: 'Το χρονικό όριο σε αυτό το τμήμα του δρόμου λήγει στις {{time}}. Μετακίνησε το αυτοκίνητο έξω από το τμήμα που καλύπτει η πινακίδα, όχι απλώς σε άλλη θέση.',
    hi: 'सड़क के इस हिस्से पर आपकी पार्किंग की समय सीमा {{time}} पर खत्म होती है। गाड़ी को सड़क के उस पूरे हिस्से से बाहर ले जाएं जिस पर यह साइन लागू होता है, सिर्फ़ किसी दूसरी पार्किंग जगह पर नहीं।',
    pa: "ਸੜਕ ਦੇ ਇਸ ਹਿੱਸੇ 'ਤੇ ਤੁਹਾਡੀ ਪਾਰਕਿੰਗ ਦੀ ਸਮਾਂ ਸੀਮਾ {{time}} 'ਤੇ ਖ਼ਤਮ ਹੁੰਦੀ ਹੈ। ਕਾਰ ਨੂੰ ਸੜਕ ਦੇ ਉਸ ਪੂਰੇ ਹਿੱਸੇ ਤੋਂ ਬਾਹਰ ਲੈ ਜਾਓ ਜਿਸ 'ਤੇ ਇਹ ਚਿੰਨ੍ਹ ਲਾਗੂ ਹੁੰਦਾ ਹੈ, ਸਿਰਫ਼ ਕਿਸੇ ਹੋਰ ਪਾਰਕਿੰਗ ਥਾਂ 'ਤੇ ਨਹੀਂ।",
  },
  // Go now: the walk time (10 minutes when unknown) plus 15 minutes before
  // the deadline. {{time}} is the deadline, not the fire time.
  'workday.reminder.goNow': {
    en: 'Leave now to move the car before {{time}}.',
    'zh-CN': '现在就出发,在 {{time}} 前把车移走。',
    vi: 'Hãy đi ngay để dời xe trước {{time}}.',
    id: 'Berangkat sekarang untuk memindahkan mobil sebelum pukul {{time}}.',
    ko: '지금 출발해서 {{time}} 전에 차를 옮기세요.',
    it: "Parti ora per spostare l'auto prima delle {{time}}.",
    el: 'Φύγε τώρα για να μετακινήσεις το αυτοκίνητο πριν από τις {{time}}.',
    hi: '{{time}} से पहले गाड़ी हटाने के लिए अभी निकलें।',
    pa: '{{time}} ਤੋਂ ਪਹਿਲਾਂ ਕਾਰ ਹਟਾਉਣ ਲਈ ਹੁਣੇ ਨਿਕਲੋ।',
  },
  // At the deadline. Only this line (build spec T6a item 5): no advice,
  // no outcome.
  'workday.reminder.ended': {
    en: 'Your time on this stretch ended at {{time}}.',
    'zh-CN': '你在此路段的停车时间已于 {{time}} 结束。',
    vi: 'Thời gian đỗ xe của bạn trên đoạn đường này đã kết thúc lúc {{time}}.',
    id: 'Waktu parkirmu di ruas jalan ini sudah berakhir pukul {{time}}.',
    ko: '이 구간에서의 주차 시간이 {{time}}에 끝났습니다.',
    it: 'Il tuo tempo su questo tratto è scaduto alle {{time}}.',
    el: 'Ο χρόνος σου σε αυτό το τμήμα του δρόμου έληξε στις {{time}}.',
    hi: 'सड़क के इस हिस्से पर आपका समय {{time}} पर खत्म हो गया।',
    pa: "ਸੜਕ ਦੇ ਇਸ ਹਿੱਸੇ 'ਤੇ ਤੁਹਾਡਾ ਸਮਾਂ {{time}} 'ਤੇ ਖ਼ਤਮ ਹੋ ਗਿਆ।",
  },
  // Area-sign variants (r335). Under an area sign the car has to leave the
  // whole area: moving to another street inside it doesn't end the limit.
  // workdayReminderCopy sends these for a leg in area mode (legInAreaMode,
  // or the caller's area_mode). Go-now names no place, so it is shared.
  'workday.reminder.headsUpArea': {
    en: 'Your time limit in this parking area ends at {{time}}. Move the car out of the whole area, not just to another street inside it.',
    'zh-CN': '你在此停车区域的停车时限于 {{time}} 结束。请把车开出整个区域,不要只是换到区域内的另一条街。',
    vi: 'Thời hạn đỗ xe của bạn trong khu vực đỗ xe này kết thúc lúc {{time}}. Hãy dời xe ra khỏi toàn bộ khu vực, không chỉ sang một con đường khác trong khu vực.',
    id: 'Batas waktu parkirmu di area parkir ini berakhir pukul {{time}}. Pindahkan mobil keluar dari seluruh area, bukan hanya ke jalan lain di dalamnya.',
    ko: '이 주차 구역의 주차 시간 제한이 {{time}}에 끝납니다. 구역 안의 다른 거리로 옮기는 것만으로는 안 되며, 구역 전체를 벗어나야 합니다.',
    it: "Il limite di tempo in quest'area di parcheggio scade alle {{time}}. Sposta l'auto fuori da tutta l'area, non solo in un'altra via al suo interno.",
    el: 'Το χρονικό όριο σε αυτή την περιοχή στάθμευσης λήγει στις {{time}}. Μετακίνησε το αυτοκίνητο έξω από όλη την περιοχή, όχι απλώς σε άλλο δρόμο μέσα σε αυτήν.',
    hi: 'इस पार्किंग क्षेत्र में आपकी पार्किंग की समय सीमा {{time}} पर खत्म होती है। गाड़ी को पूरे क्षेत्र से बाहर ले जाएं, सिर्फ़ क्षेत्र के अंदर किसी दूसरी सड़क पर नहीं।',
    pa: "ਇਸ ਪਾਰਕਿੰਗ ਖੇਤਰ ਵਿੱਚ ਤੁਹਾਡੀ ਪਾਰਕਿੰਗ ਦੀ ਸਮਾਂ ਸੀਮਾ {{time}} 'ਤੇ ਖ਼ਤਮ ਹੁੰਦੀ ਹੈ। ਕਾਰ ਨੂੰ ਪੂਰੇ ਖੇਤਰ ਤੋਂ ਬਾਹਰ ਲੈ ਜਾਓ, ਸਿਰਫ਼ ਖੇਤਰ ਦੇ ਅੰਦਰ ਕਿਸੇ ਹੋਰ ਸੜਕ 'ਤੇ ਨਹੀਂ।",
  },
  // At the deadline under an area limit. The same single line as
  // workday.reminder.ended, naming the area instead of the stretch.
  'workday.reminder.endedArea': {
    en: 'Your time in this parking area ended at {{time}}.',
    'zh-CN': '你在此停车区域的停车时间已于 {{time}} 结束。',
    vi: 'Thời gian đỗ xe của bạn trong khu vực đỗ xe này đã kết thúc lúc {{time}}.',
    id: 'Waktu parkirmu di area parkir ini sudah berakhir pukul {{time}}.',
    ko: '이 주차 구역에서의 주차 시간이 {{time}}에 끝났습니다.',
    it: "Il tuo tempo in quest'area di parcheggio è scaduto alle {{time}}.",
    el: 'Ο χρόνος σου σε αυτή την περιοχή στάθμευσης έληξε στις {{time}}.',
    hi: 'इस पार्किंग क्षेत्र में आपका समय {{time}} पर खत्म हो गया।',
    pa: "ਇਸ ਪਾਰਕਿੰਗ ਖੇਤਰ ਵਿੱਚ ਤੁਹਾਡਾ ਸਮਾਂ {{time}} 'ਤੇ ਖ਼ਤਮ ਹੋ ਗਿਆ।",
  },
}

// ── Existing strings this task rewrites (explicit overwrite list) ───────
// Each must already exist in every locale; the script aborts otherwise.
const OVERWRITES = {}

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

/** Rewrite an existing string in place. Aborts when it isn't there: an overwrite never adds a key. */
function overwrite(root, path, value, locale) {
  const parts = path.split('.')
  const leaf = parts.pop()
  let node = root
  for (const p of parts) {
    node = node && typeof node === 'object' ? node[p] : undefined
    if (!node || typeof node !== 'object' || Array.isArray(node)) fail(`${locale}: ${path} to overwrite is missing`)
  }
  if (typeof node[leaf] !== 'string') fail(`${locale}: ${path} to overwrite is missing`)
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
  for (const [path, byLocale] of [...Object.entries(ADDITIONS), ...Object.entries(OVERWRITES)]) {
    // Plurals carry {{count}} in both forms (i18n rules), checked here for every key this script writes.
    if (path.endsWith('_one')) {
      for (const [locale, s] of Object.entries(byLocale)) {
        if (!s.includes('{{count}}')) problems.push(`${locale}: ${path} must use {{count}}`)
      }
    }
    for (const s of Object.values(byLocale)) {
      // Copy rules: no em-dashes; PDF-safe symbols only where a PDF could use them.
      if (s.includes('\u2014')) problems.push(`em-dash in new copy at ${path}: ${s}`)
      if (/[✓⚠→≈≤]/u.test(s)) problems.push(`symbol in new copy at ${path}: ${s}`)
    }
    // The en record noun is "record", never "session".
    if (/\bsessions?\b/i.test(byLocale.en)) problems.push(`"session" in en copy at ${path}`)
    // Words and claims the copy rules ban outright.
    if (
      /\b(reset|compliant|compliance proven|admissible|authentic|verified location|accepted by (insurers|council)|strong evidence)\b/i.test(
        byLocale.en,
      )
    ) {
      problems.push(`banned wording in en copy at ${path}`)
    }
    // A phone time is never called signed.
    if (/signed departure at/i.test(byLocale.en)) problems.push(`"signed departure at" in en copy at ${path}`)
    // "ticket" alone can read as the fine notice; say "meter ticket".
    if (/(?<!meter )\btickets?\b/i.test(byLocale.en)) problems.push(`ambiguous "ticket" in en copy at ${path}`)
    // Workday copy never names a distance (no rule sets a minimum re-parking
    // distance) and never says or implies that moving restarts the limit.
    if (/\d\s*(m|metres?|meters?|km)\b/i.test(byLocale.en)) problems.push(`distance in workday en copy at ${path}`)
    if (/\b(restarts?|new limit starts|fresh limit)\b/i.test(byLocale.en)) {
      problems.push(`restart wording in workday en copy at ${path}`)
    }
    // Absolute times only: no "in 10 minutes" style relative time.
    if (/\bin \d+\s*(min|minutes?|hours?)\b/i.test(byLocale.en)) problems.push(`relative time in en copy at ${path}`)
    if (!byLocale.en.includes('{{time}}')) problems.push(`workday reminder without {{time}} at ${path}`)
  }
  return problems
}

// ── --list: keys for the T10 review ─────────────────────────────────────
if (process.argv.includes('--list')) {
  const keys = [...Object.keys(ADDITIONS), ...Object.keys(OVERWRITES)].sort()
  for (const k of keys) {
    const tags = [k in OVERWRITES ? 'overwrite' : null, LEGAL.has(k) ? 'legal' : null].filter(Boolean)
    console.log(`      ${k}${tags.length ? `  (${tags.join(', ')})` : ''}`)
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
  for (const [path, byLocale] of Object.entries(OVERWRITES)) {
    if (typeof byLocale[locale] !== 'string') fail(`no ${locale} text for overwritten key ${path}`)
    overwrite(data[locale], path, byLocale[locale], locale)
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
