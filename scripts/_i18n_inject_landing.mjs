/**
 * One-off: merge the LandingFeatures i18n keys into the 6 non-English
 * locales. Same idempotent pattern as scripts/_i18n_inject_*.
 *
 * Tone match: each locale's existing voice (zh-CN compact + direct;
 * vi conversational; it confident; el formal-friendly; hi+pa
 * respectful-modern). Where the English uses idiom ("wrongful ticket"),
 * each locale gets the closest natural rendering.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LOC = join(ROOT, 'src', 'locales')

const T = {
  'zh-CN': {
    translateTitle: '通俗的解读',
    translateDesc: '拍下任何澳洲停车标志 — 10 秒内告诉你"现在能不能停"。',
    evidenceTitle: '可作证据',
    evidenceDesc: '每次停车都有加密签名的时间戳、GPS 和照片记录。',
    appealTitle: 'AI 申诉信',
    appealDesc: '收到不合理的罚单？拍下来，我们帮你起草正式申诉。',
  },
  vi: {
    translateTitle: 'Câu trả lời rõ ràng',
    translateDesc: 'Chụp ảnh bất kỳ biển đỗ xe nào của Úc — nhận câu trả lời "có thể đỗ không?" trong 10 giây.',
    evidenceTitle: 'Bằng chứng vững chắc',
    evidenceDesc: 'Mỗi lần đỗ xe đều có dấu thời gian, GPS và ảnh được ký mã hóa.',
    appealTitle: 'Thư khiếu nại AI',
    appealDesc: 'Bị phạt oan? Chụp ảnh và chúng tôi sẽ soạn thư khiếu nại chính thức.',
  },
  it: {
    translateTitle: 'Risposte in italiano semplice',
    translateDesc: "Fotografa qualsiasi cartello di parcheggio australiano — verdetto 'posso parcheggiare?' in 10 secondi.",
    evidenceTitle: 'Prove difendibili',
    evidenceDesc: 'Ogni parcheggio ottiene un timestamp firmato crittograficamente, GPS e foto.',
    appealTitle: 'Lettere di ricorso AI',
    appealDesc: 'Multa ingiusta? Fotografala e prepariamo un ricorso formale.',
  },
  el: {
    translateTitle: 'Σαφείς απαντήσεις',
    translateDesc: 'Φωτογραφίστε οποιαδήποτε αυστραλιανή πινακίδα στάθμευσης — απάντηση «μπορώ να παρκάρω;» σε 10 δευτερόλεπτα.',
    evidenceTitle: 'Αξιόπιστα στοιχεία',
    evidenceDesc: 'Κάθε στάθμευση παίρνει κρυπτογραφικά υπογεγραμμένη χρονοσφραγίδα, GPS και φωτογραφία.',
    appealTitle: 'Επιστολές προσφυγής με AI',
    appealDesc: 'Λάβατε άδικη κλήση; Φωτογραφίστε την και θα συντάξουμε επίσημη ένσταση.',
  },
  hi: {
    translateTitle: 'सरल भाषा में जवाब',
    translateDesc: 'किसी भी ऑस्ट्रेलियाई पार्किंग साइन की फोटो लें — 10 सेकंड में "क्या मैं अभी पार्क कर सकता हूं?" का जवाब।',
    evidenceTitle: 'पुख्ता सबूत',
    evidenceDesc: 'हर पार्किंग को क्रिप्टोग्राफिक रूप से हस्ताक्षरित समय-मुहर, GPS और फोटो रिकॉर्ड मिलता है।',
    appealTitle: 'AI अपील पत्र',
    appealDesc: 'गलत चालान मिला? उसकी फोटो लें और हम औपचारिक विवाद का मसौदा तैयार करेंगे।',
  },
  pa: {
    translateTitle: 'ਸਾਫ਼ ਜਵਾਬ',
    translateDesc: 'ਕਿਸੇ ਵੀ ਆਸਟ੍ਰੇਲੀਅਨ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਦੀ ਫੋਟੋ ਲਓ — 10 ਸਕਿੰਟਾਂ ਵਿੱਚ "ਕੀ ਮੈਂ ਪਾਰਕ ਕਰ ਸਕਦਾ ਹਾਂ?" ਦਾ ਜਵਾਬ।',
    evidenceTitle: 'ਮਜ਼ਬੂਤ ਸਬੂਤ',
    evidenceDesc: 'ਹਰ ਪਾਰਕਿੰਗ ਨੂੰ ਕ੍ਰਿਪਟੋਗ੍ਰਾਫਿਕ ਤੌਰ \'ਤੇ ਦਸਤਖਤ ਕੀਤਾ ਟਾਈਮਸਟੈਂਪ, GPS ਅਤੇ ਫੋਟੋ ਰਿਕਾਰਡ ਮਿਲਦਾ ਹੈ।',
    appealTitle: 'AI ਅਪੀਲ ਪੱਤਰ',
    appealDesc: 'ਗਲਤ ਟਿਕਟ ਮਿਲੀ? ਉਸਦੀ ਫੋਟੋ ਲਓ ਅਤੇ ਅਸੀਂ ਰਸਮੀ ਅਪੀਲ ਦਾ ਖਰੜਾ ਤਿਆਰ ਕਰਾਂਗੇ।',
  },
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
  for (const [k, v] of Object.entries(t)) {
    added += setIfMissing(data, `landing.feature.${k}`, v)
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(`${locale}.json: added ${added} keys`)
  total += added
}
console.log(`done — ${total} keys total`)
