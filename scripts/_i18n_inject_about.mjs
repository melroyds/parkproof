/**
 * Inject the home.seeEverything + common.about i18n keys into the 6
 * non-English locales. The About page itself stays English-only — these
 * are just the entry-point labels (so a translated app doesn't suddenly
 * hit an English nav crumb).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LOC = join(ROOT, 'src', 'locales')

const T = {
  'zh-CN': { about: '它能做什么', seeEverything: '查看 ParkProof 的所有功能 →' },
  vi: { about: 'Ứng dụng làm gì', seeEverything: 'Xem tất cả những gì ParkProof có thể làm →' },
  it: { about: 'Cosa fa', seeEverything: 'Scopri tutto quello che fa ParkProof →' },
  el: { about: 'Τι κάνει', seeEverything: 'Δείτε τα πάντα που μπορεί να κάνει το ParkProof →' },
  hi: { about: 'यह क्या करता है', seeEverything: 'ParkProof की सभी विशेषताएं देखें →' },
  pa: { about: 'ਇਹ ਕੀ ਕਰਦਾ ਹੈ', seeEverything: 'ParkProof ਦੀਆਂ ਸਾਰੀਆਂ ਵਿਸ਼ੇਸ਼ਤਾਵਾਂ ਦੇਖੋ →' },
}

function setIfMissing(target, path, value) {
  const keys = path.split('.')
  let cur = target
  for (let i = 0; i < keys.length - 1; i++) {
    if (!cur[keys[i]] || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {}
    cur = cur[keys[i]]
  }
  const last = keys[keys.length - 1]
  if (cur[last] === undefined) {
    cur[last] = value
    return 1
  }
  return 0
}

let total = 0
for (const [locale, t] of Object.entries(T)) {
  const file = join(LOC, `${locale}.json`)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  let added = 0
  added += setIfMissing(data, 'common.about', t.about)
  added += setIfMissing(data, 'home.seeEverything', t.seeEverything)
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(`${locale}.json: added ${added} keys`)
  total += added
}
console.log(`done — ${total} keys total`)
