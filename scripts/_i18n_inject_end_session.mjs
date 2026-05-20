/**
 * One-off: merge the End-session i18n keys into the 6 non-English locales.
 * Adds three groups:
 *   active.*  — noPostedRestrictions, iveLeft, iveLeftAria, iveLeftConfirm
 *   session.* — endSession, endConfirm, endedAt, noExpiryRecorded
 *   time.*    — parkedForMin/Hour/Hours/HoursMins (formatElapsedLocalized)
 *
 * Idempotent — only writes keys that are missing, so re-running won't
 * clobber any hand-tuned translation.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LOC = join(ROOT, 'src', 'locales')

const T = {
  'zh-CN': {
    active: {
      noPostedRestrictions: '无标牌限制',
      iveLeft: '我已离开',
      iveLeftAria: '标记您已离开此停车位',
      iveLeftConfirm: '现在结束此停车记录?会移至历史并记录离开时间。',
    },
    session: {
      endSession: '结束停车',
      endConfirm: '现在结束此停车记录?证据记录将保留在历史中,并记录您的离开时间。',
      endedAt: '已结束 {{when}}',
      noExpiryRecorded: '未记录到期时间',
    },
    time: {
      parkedForMin_one: '已停 1 分钟',
      parkedForMin_other: '已停 {{count}} 分钟',
      parkedForHour_one: '已停 1 小时',
      parkedForHours_other: '已停 {{count}} 小时',
      parkedForHoursMins: '已停 {{hours}} 小时 {{mins}} 分钟',
    },
  },
  vi: {
    active: {
      noPostedRestrictions: 'Không có biển cấm',
      iveLeft: 'Tôi đã đi',
      iveLeftAria: 'Báo hiệu bạn đã rời khỏi chỗ đậu xe này',
      iveLeftConfirm:
        'Kết thúc phiên đậu xe này ngay? Phiên sẽ chuyển sang lịch sử với thời gian rời được ghi lại.',
    },
    session: {
      endSession: 'Kết thúc phiên',
      endConfirm:
        'Kết thúc phiên đậu xe này ngay? Bản ghi bằng chứng vẫn được lưu trong lịch sử với thời gian bạn rời đi.',
      endedAt: 'Đã kết thúc {{when}}',
      noExpiryRecorded: 'Chưa ghi nhận thời hạn',
    },
    time: {
      parkedForMin_one: 'Đã đậu 1 phút',
      parkedForMin_other: 'Đã đậu {{count}} phút',
      parkedForHour_one: 'Đã đậu 1 giờ',
      parkedForHours_other: 'Đã đậu {{count}} giờ',
      parkedForHoursMins: 'Đã đậu {{hours}} giờ {{mins}} phút',
    },
  },
  it: {
    active: {
      noPostedRestrictions: 'Nessuna restrizione segnalata',
      iveLeft: 'Sono andato',
      iveLeftAria: 'Segnala che hai lasciato questo parcheggio',
      iveLeftConfirm:
        "Terminare questa sessione di parcheggio ora? Verrà spostata nella cronologia con l'ora di partenza registrata.",
    },
    session: {
      endSession: 'Termina sessione',
      endConfirm:
        "Terminare questa sessione ora? Il record di prova resta nella cronologia con l'ora di partenza registrata.",
      endedAt: 'Terminata {{when}}',
      noExpiryRecorded: 'Nessuna scadenza registrata',
    },
    time: {
      parkedForMin_one: 'Parcheggiato da 1 min',
      parkedForMin_other: 'Parcheggiato da {{count}} min',
      parkedForHour_one: 'Parcheggiato da 1 ora',
      parkedForHours_other: 'Parcheggiato da {{count}} ore',
      parkedForHoursMins: 'Parcheggiato da {{hours}}h {{mins}}m',
    },
  },
  el: {
    active: {
      noPostedRestrictions: 'Καμία αναγραμμένη απαγόρευση',
      iveLeft: 'Έφυγα',
      iveLeftAria: 'Δηλώστε ότι φύγατε από αυτή τη θέση στάθμευσης',
      iveLeftConfirm:
        'Τερματισμός αυτής της στάθμευσης τώρα; Θα μεταφερθεί στο ιστορικό με καταγεγραμμένη την ώρα αναχώρησης.',
    },
    session: {
      endSession: 'Τερματισμός στάθμευσης',
      endConfirm:
        'Τερματισμός αυτής της στάθμευσης τώρα; Το αποδεικτικό παραμένει στο ιστορικό με καταγεγραμμένη την ώρα αναχώρησης.',
      endedAt: 'Έληξε {{when}}',
      noExpiryRecorded: 'Δεν έχει καταγραφεί λήξη',
    },
    time: {
      parkedForMin_one: 'Στάθμευση για 1 λεπτό',
      parkedForMin_other: 'Στάθμευση για {{count}} λεπτά',
      parkedForHour_one: 'Στάθμευση για 1 ώρα',
      parkedForHours_other: 'Στάθμευση για {{count}} ώρες',
      parkedForHoursMins: 'Στάθμευση για {{hours}}ω {{mins}}λ',
    },
  },
  hi: {
    active: {
      noPostedRestrictions: 'कोई प्रतिबंध नहीं लगा',
      iveLeft: 'मैं जा चुका/चुकी हूं',
      iveLeftAria: 'संकेत दें कि आप इस पार्किंग स्थान से जा चुके हैं',
      iveLeftConfirm:
        'अभी इस पार्किंग सत्र को समाप्त करें? यह आपके जाने के समय के साथ इतिहास में चला जाएगा।',
    },
    session: {
      endSession: 'सत्र समाप्त करें',
      endConfirm:
        'अभी इस पार्किंग सत्र को समाप्त करें? साक्ष्य रिकॉर्ड आपके जाने के समय के साथ इतिहास में बना रहेगा।',
      endedAt: '{{when}} पर समाप्त',
      noExpiryRecorded: 'कोई समाप्ति समय दर्ज नहीं',
    },
    time: {
      parkedForMin_one: '1 मिनट से पार्क है',
      parkedForMin_other: '{{count}} मिनट से पार्क है',
      parkedForHour_one: '1 घंटे से पार्क है',
      parkedForHours_other: '{{count}} घंटे से पार्क है',
      parkedForHoursMins: '{{hours}} घंटे {{mins}} मिनट से पार्क है',
    },
  },
  pa: {
    active: {
      noPostedRestrictions: 'ਕੋਈ ਪਾਬੰਦੀ ਦਰਜ ਨਹੀਂ',
      iveLeft: 'ਮੈਂ ਚਲਾ/ਚਲੀ ਗਿਆ/ਗਈ ਹਾਂ',
      iveLeftAria: 'ਸੰਕੇਤ ਦਿਓ ਕਿ ਤੁਸੀਂ ਇਸ ਪਾਰਕਿੰਗ ਥਾਂ ਤੋਂ ਚਲੇ ਗਏ ਹੋ',
      iveLeftConfirm:
        'ਹੁਣ ਇਸ ਪਾਰਕਿੰਗ ਸੈਸ਼ਨ ਨੂੰ ਖ਼ਤਮ ਕਰੋ? ਇਹ ਜਾਣ ਦੇ ਸਮੇਂ ਨਾਲ ਇਤਿਹਾਸ ਵਿੱਚ ਚਲਾ ਜਾਵੇਗਾ।',
    },
    session: {
      endSession: 'ਸੈਸ਼ਨ ਖ਼ਤਮ ਕਰੋ',
      endConfirm:
        'ਹੁਣ ਇਸ ਪਾਰਕਿੰਗ ਸੈਸ਼ਨ ਨੂੰ ਖ਼ਤਮ ਕਰੋ? ਸਬੂਤ ਰਿਕਾਰਡ ਤੁਹਾਡੇ ਜਾਣ ਦੇ ਸਮੇਂ ਨਾਲ ਇਤਿਹਾਸ ਵਿੱਚ ਰਹੇਗਾ।',
      endedAt: '{{when}} ਨੂੰ ਖ਼ਤਮ',
      noExpiryRecorded: 'ਕੋਈ ਮਿਆਦ ਦਰਜ ਨਹੀਂ',
    },
    time: {
      parkedForMin_one: '1 ਮਿੰਟ ਤੋਂ ਪਾਰਕ ਹੈ',
      parkedForMin_other: '{{count}} ਮਿੰਟ ਤੋਂ ਪਾਰਕ ਹੈ',
      parkedForHour_one: '1 ਘੰਟੇ ਤੋਂ ਪਾਰਕ ਹੈ',
      parkedForHours_other: '{{count}} ਘੰਟੇ ਤੋਂ ਪਾਰਕ ਹੈ',
      parkedForHoursMins: '{{hours}} ਘੰਟੇ {{mins}} ਮਿੰਟ ਤੋਂ ਪਾਰਕ ਹੈ',
    },
  },
}

let touched = 0
for (const [locale, groups] of Object.entries(T)) {
  const file = join(LOC, `${locale}.json`)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  let added = 0
  for (const [group, keys] of Object.entries(groups)) {
    if (!data[group] || typeof data[group] !== 'object') data[group] = {}
    for (const [k, v] of Object.entries(keys)) {
      if (data[group][k] === undefined) {
        data[group][k] = v
        added++
      }
    }
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(`${locale}.json: added ${added} keys`)
  touched += added
}
console.log(`done — ${touched} keys total`)
