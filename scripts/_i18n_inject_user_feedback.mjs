/**
 * One-off: merge the user-feedback i18n keys into the 6 non-English locales.
 * Translations checked against native-speaker-grade sources for register —
 * casual but respectful, matches existing voice in each locale.
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
    common: { close: '关闭', sendFeedback: '发送反馈' },
    feedback: {
      title: '发送反馈',
      intro: '告诉我们什么有效、什么有问题，或您希望 ParkProof 能做什么。我们会阅读每条消息。',
      messageLabel: '您的留言',
      messagePlaceholder: '发现 bug、有想法，或只是想打个招呼？请在这里告诉我们……',
      emailLabel: '电子邮件',
      emailOptional: '（可选）',
      emailPlaceholder: 'you@example.com',
      emailHelp: '仅在我们需要回复时使用。留空即可匿名提交。',
      send: '发送',
      sending: '发送中……',
      successTitle: '谢谢！',
      successBody: '您的反馈已送达。我们回到键盘前会立即阅读。',
      error: { generic: '无法发送 — 请稍后再试。' },
    },
  },
  vi: {
    common: { close: 'Đóng', sendFeedback: 'Gửi phản hồi' },
    feedback: {
      title: 'Gửi phản hồi',
      intro: 'Hãy cho chúng tôi biết điều gì hoạt động tốt, điều gì hỏng, hoặc bạn mong ParkProof làm được gì. Chúng tôi đọc mọi tin nhắn.',
      messageLabel: 'Tin nhắn của bạn',
      messagePlaceholder: 'Phát hiện lỗi, có ý tưởng, hay chỉ muốn chào? Cho chúng tôi biết tại đây…',
      emailLabel: 'Email',
      emailOptional: '(tùy chọn)',
      emailPlaceholder: 'you@example.com',
      emailHelp: 'Chỉ dùng nếu chúng tôi cần liên hệ lại. Để trống để gửi ẩn danh.',
      send: 'Gửi',
      sending: 'Đang gửi…',
      successTitle: 'Cảm ơn!',
      successBody: 'Phản hồi của bạn đã được nhận. Chúng tôi sẽ đọc ngay khi trở lại bàn phím.',
      error: { generic: 'Không thể gửi — vui lòng thử lại sau.' },
    },
  },
  it: {
    common: { close: 'Chiudi', sendFeedback: 'Invia feedback' },
    feedback: {
      title: 'Invia feedback',
      intro: 'Dicci cosa ha funzionato, cosa si è rotto, o cosa vorresti che ParkProof facesse. Leggiamo ogni messaggio.',
      messageLabel: 'Il tuo messaggio',
      messagePlaceholder: 'Hai trovato un bug, hai un\'idea, o vuoi solo salutare? Scrivici qui…',
      emailLabel: 'Email',
      emailOptional: '(opzionale)',
      emailPlaceholder: 'tu@esempio.com',
      emailHelp: 'Usata solo se dobbiamo risponderti. Lascia vuoto per inviare in modo anonimo.',
      send: 'Invia',
      sending: 'Invio…',
      successTitle: 'Grazie!',
      successBody: 'Il tuo feedback è arrivato. Lo leggeremo appena torniamo alla tastiera.',
      error: { generic: 'Invio non riuscito — riprova tra poco.' },
    },
  },
  el: {
    common: { close: 'Κλείσιμο', sendFeedback: 'Αποστολή σχολίων' },
    feedback: {
      title: 'Αποστολή σχολίων',
      intro: 'Πείτε μας τι λειτούργησε, τι χάλασε, ή τι θα θέλατε να κάνει το ParkProof. Διαβάζουμε κάθε μήνυμα.',
      messageLabel: 'Το μήνυμά σας',
      messagePlaceholder: 'Βρήκατε σφάλμα, έχετε ιδέα, ή θέλετε απλώς να πείτε γεια; Πείτε μας εδώ…',
      emailLabel: 'Email',
      emailOptional: '(προαιρετικό)',
      emailPlaceholder: 'esy@paradeigma.com',
      emailHelp: 'Χρησιμοποιείται μόνο αν χρειαστεί να σας απαντήσουμε. Αφήστε κενό για ανώνυμη υποβολή.',
      send: 'Αποστολή',
      sending: 'Αποστολή…',
      successTitle: 'Ευχαριστούμε!',
      successBody: 'Τα σχόλιά σας ελήφθησαν. Θα τα διαβάσουμε μόλις επιστρέψουμε στο πληκτρολόγιο.',
      error: { generic: 'Δεν στάλθηκε — δοκιμάστε ξανά σε λίγο.' },
    },
  },
  hi: {
    common: { close: 'बंद करें', sendFeedback: 'फीडबैक भेजें' },
    feedback: {
      title: 'फीडबैक भेजें',
      intro: 'हमें बताएं क्या काम किया, क्या टूटा, या आप ParkProof से क्या चाहते हैं। हम हर संदेश पढ़ते हैं।',
      messageLabel: 'आपका संदेश',
      messagePlaceholder: 'कोई बग मिला, कोई विचार है, या बस नमस्ते कहना है? यहां बताएं…',
      emailLabel: 'ईमेल',
      emailOptional: '(वैकल्पिक)',
      emailPlaceholder: 'aap@udaharan.com',
      emailHelp: 'केवल तभी उपयोग किया जाएगा जब हमें जवाब देने की आवश्यकता हो। गुमनाम भेजने के लिए खाली छोड़ें।',
      send: 'भेजें',
      sending: 'भेज रहे हैं…',
      successTitle: 'धन्यवाद!',
      successBody: 'आपका फीडबैक मिल गया। हम कीबोर्ड पर वापस आते ही पढ़ेंगे।',
      error: { generic: 'भेजा नहीं जा सका — कृपया कुछ देर में पुनः प्रयास करें।' },
    },
  },
  pa: {
    common: { close: 'ਬੰਦ ਕਰੋ', sendFeedback: 'ਫੀਡਬੈਕ ਭੇਜੋ' },
    feedback: {
      title: 'ਫੀਡਬੈਕ ਭੇਜੋ',
      intro: 'ਸਾਨੂੰ ਦੱਸੋ ਕੀ ਕੰਮ ਕੀਤਾ, ਕੀ ਟੁੱਟਿਆ, ਜਾਂ ਤੁਸੀਂ ParkProof ਤੋਂ ਕੀ ਚਾਹੁੰਦੇ ਹੋ। ਅਸੀਂ ਹਰ ਸੁਨੇਹਾ ਪੜ੍ਹਦੇ ਹਾਂ।',
      messageLabel: 'ਤੁਹਾਡਾ ਸੁਨੇਹਾ',
      messagePlaceholder: 'ਕੋਈ ਬੱਗ ਮਿਲਿਆ, ਕੋਈ ਵਿਚਾਰ ਹੈ, ਜਾਂ ਬੱਸ ਹੈਲੋ ਕਹਿਣਾ ਹੈ? ਇੱਥੇ ਦੱਸੋ…',
      emailLabel: 'ਈਮੇਲ',
      emailOptional: '(ਚੋਣਵੀਂ)',
      emailPlaceholder: 'tuhada@misal.com',
      emailHelp: 'ਸਿਰਫ਼ ਉਦੋਂ ਵਰਤੀ ਜਾਵੇਗੀ ਜਦੋਂ ਸਾਨੂੰ ਜਵਾਬ ਦੇਣ ਦੀ ਲੋੜ ਹੋਵੇ। ਗੁਮਨਾਮ ਭੇਜਣ ਲਈ ਖਾਲੀ ਛੱਡੋ।',
      send: 'ਭੇਜੋ',
      sending: 'ਭੇਜ ਰਹੇ ਹਾਂ…',
      successTitle: 'ਧੰਨਵਾਦ!',
      successBody: 'ਤੁਹਾਡਾ ਫੀਡਬੈਕ ਮਿਲ ਗਿਆ। ਅਸੀਂ ਜਿਵੇਂ ਹੀ ਕੀਬੋਰਡ \'ਤੇ ਵਾਪਸ ਆਉਂਦੇ ਹਾਂ, ਪੜ੍ਹਾਂਗੇ।',
      error: { generic: 'ਭੇਜਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ — ਕਿਰਪਾ ਕਰਕੇ ਥੋੜੀ ਦੇਰ ਬਾਅਦ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।' },
    },
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
for (const [locale, blocks] of Object.entries(T)) {
  const file = join(LOC, `${locale}.json`)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  let added = 0
  // common.* (close, sendFeedback)
  for (const [k, v] of Object.entries(blocks.common)) {
    added += setIfMissing(data, `common.${k}`, v)
  }
  // feedback.* (full block)
  for (const [k, v] of Object.entries(blocks.feedback)) {
    if (typeof v === 'object' && v !== null) {
      for (const [k2, v2] of Object.entries(v)) {
        added += setIfMissing(data, `feedback.${k}.${k2}`, v2)
      }
    } else {
      added += setIfMissing(data, `feedback.${k}`, v)
    }
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(`${locale}.json: added ${added} keys`)
  total += added
}
console.log(`done — ${total} keys total`)
