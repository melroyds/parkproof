/**
 * One-off: merge the PDF-side End-session keys into the 6 non-English
 * locales. Two groups:
 *   pdf.evidence.field.endedAt / actualDuration  — table row labels
 *   pdf.duration.*                               — bare-duration formatter
 *
 * Idempotent — only writes missing keys.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LOC = join(ROOT, 'src', 'locales')

const T = {
  'zh-CN': {
    field: { endedAt: '驾驶员标记的离开时间', actualDuration: '实际停车时长' },
    duration: {
      minOnly_one: '1 分钟',
      minOnly_other: '{{count}} 分钟',
      hourOnly_one: '1 小时',
      hoursOnly_other: '{{count}} 小时',
      hoursAndMins: '{{hours}} 小时 {{mins}} 分钟',
    },
  },
  vi: {
    field: { endedAt: 'Đã rời (do tài xế xác nhận)', actualDuration: 'Thời gian đậu thực tế' },
    duration: {
      minOnly_one: '1 phút',
      minOnly_other: '{{count}} phút',
      hourOnly_one: '1 giờ',
      hoursOnly_other: '{{count}} giờ',
      hoursAndMins: '{{hours}} giờ {{mins}} phút',
    },
  },
  it: {
    field: {
      endedAt: 'Uscita (segnalata dal conducente)',
      actualDuration: 'Durata effettiva',
    },
    duration: {
      minOnly_one: '1 min',
      minOnly_other: '{{count}} min',
      hourOnly_one: '1 ora',
      hoursOnly_other: '{{count}} ore',
      hoursAndMins: '{{hours}}h {{mins}}m',
    },
  },
  el: {
    field: {
      endedAt: 'Αποχώρηση (δήλωση οδηγού)',
      actualDuration: 'Πραγματική διάρκεια',
    },
    duration: {
      minOnly_one: '1 λεπτό',
      minOnly_other: '{{count}} λεπτά',
      hourOnly_one: '1 ώρα',
      hoursOnly_other: '{{count}} ώρες',
      hoursAndMins: '{{hours}}ω {{mins}}λ',
    },
  },
  hi: {
    field: {
      endedAt: 'जाने का समय (चालक-द्वारा दर्ज)',
      actualDuration: 'वास्तविक अवधि',
    },
    duration: {
      minOnly_one: '1 मिनट',
      minOnly_other: '{{count}} मिनट',
      hourOnly_one: '1 घंटा',
      hoursOnly_other: '{{count}} घंटे',
      hoursAndMins: '{{hours}} घंटे {{mins}} मिनट',
    },
  },
  pa: {
    field: {
      endedAt: 'ਜਾਣ ਦਾ ਸਮਾਂ (ਡਰਾਈਵਰ ਵੱਲੋਂ ਦਰਜ)',
      actualDuration: 'ਅਸਲ ਸਮਾਂ-ਮਿਆਦ',
    },
    duration: {
      minOnly_one: '1 ਮਿੰਟ',
      minOnly_other: '{{count}} ਮਿੰਟ',
      hourOnly_one: '1 ਘੰਟਾ',
      hoursOnly_other: '{{count}} ਘੰਟੇ',
      hoursAndMins: '{{hours}} ਘੰਟੇ {{mins}} ਮਿੰਟ',
    },
  },
}

let touched = 0
for (const [locale, blocks] of Object.entries(T)) {
  const file = join(LOC, `${locale}.json`)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  let added = 0
  // pdf.evidence.field.*
  if (!data.pdf || typeof data.pdf !== 'object') data.pdf = {}
  if (!data.pdf.evidence || typeof data.pdf.evidence !== 'object') data.pdf.evidence = {}
  if (!data.pdf.evidence.field || typeof data.pdf.evidence.field !== 'object')
    data.pdf.evidence.field = {}
  for (const [k, v] of Object.entries(blocks.field)) {
    if (data.pdf.evidence.field[k] === undefined) {
      data.pdf.evidence.field[k] = v
      added++
    }
  }
  // pdf.duration.*
  if (!data.pdf.duration || typeof data.pdf.duration !== 'object') data.pdf.duration = {}
  for (const [k, v] of Object.entries(blocks.duration)) {
    if (data.pdf.duration[k] === undefined) {
      data.pdf.duration[k] = v
      added++
    }
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(`${locale}.json: added ${added} keys`)
  touched += added
}
console.log(`done — ${touched} keys total`)
