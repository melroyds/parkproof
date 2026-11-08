/**
 * T0a i18n (roadmap build spec, task T0a). Idempotent: running it twice
 * leaves the files byte-identical after the first run.
 *
 *   1. One plural base name per concept. `time.hourLeft_one` sat beside
 *      `time.hoursLeft_other` (same for parkedForHour, hourAgo and
 *      pdf.duration.hourOnly), so zh-CN, vi, id and ko, whose only plural
 *      form is _other, fell back to English for "1 hour". Each _one key is
 *      renamed IN PLACE (same position in its parent object) to the _other
 *      key's base. Code now calls the single base (countdown.ts,
 *      time-format.ts, pdf.ts).
 *   2. hi and pa use their _one form for 0 as well as 1, so a hardcoded "1"
 *      showed "1 minute" for 0 minutes. Every hi and pa _one string is
 *      rewritten with {{count}}. The scheduled-reminder lines in hi and pa
 *      also drop the em-dash (copy rule), _other siblings and firesAtExpiry
 *      included so every line of that list reads the same way.
 *   3. Ending after expiry. New keys for the home card of a record past its
 *      expiry that the driver hasn't ended (`active.expiredAt`,
 *      `active.expiredHint`) and a stronger confirm for a late "I've left"
 *      tap (`session.endConfirmLate`). The "I've left" confirms and the PDF
 *      end-time rows now say the stored time is the phone's tap time, not
 *      when the car left. In id, el, hi and pa "expired" and "ended" used to
 *      read the same, so those strings are rewritten to differ. hi drops its
 *      gendered first person ("मैं जा चुका/चुकी हूं").
 *   4. Push ownership: `scheduledReminders.otherDevice` for reminders that
 *      another device created (403 ERR_NOT_OWNER).
 *   5. Storage: `errors.storageFull` (typed error, was hardcoded English) and
 *      `errors.storageEvicted` (whole records deleted, not just photos).
 *   6. Accessibility: the walk-back link's aria-labels (were hardcoded
 *      English), and the "I've left" aria-label now starts with the visible
 *      label (WCAG 2.5.3 Label in Name).
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces).
 *
 * Run:   node scripts/_i18n_inject_t0a.mjs
 * List:  node scripts/_i18n_inject_t0a.mjs --list
 *        prints every key this task added or changed, for the T10
 *        translation review, and marks the ones for docs/legal-review-queue.md.
 * Other: node scripts/_i18n_inject_t0a.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

// ── 1. Renames: [old path, new leaf] ────────────────────────────────────
const RENAMES = [
  ['time.hourLeft_one', 'hoursLeft_one'],
  ['time.parkedForHour_one', 'parkedForHours_one'],
  ['time.hourAgo_one', 'hoursAgo_one'],
  ['pdf.duration.hourOnly_one', 'hoursOnly_one'],
]

// ── 2. Overwrites of existing strings (paths are post-rename) ───────────
// Per-locale overwrites.
const OVERWRITES = {
  hi: {
    'active.walkMinutes_one': '≈ {{count}} मिनट पैदल',
    'reminders.calendarCta_one': '{{count}} अलार्म के साथ .ics डाउनलोड करें',
    'reminders.browserCta_one': '{{count}} ब्राउज़र सूचना सक्षम करें',
    'reminders.browserScheduled_one': '✓ {{count}} सूचना निर्धारित',
    'reminders.noSign.chipHour_one': '{{count}} घंटा',
    'scheduledReminders.firesAtExpiry': '{{when}}: समाप्ति पर',
    'scheduledReminders.firesBefore_one': '{{when}}: समाप्ति से {{count}} मिनट पहले',
    'scheduledReminders.firesBefore_other': '{{when}}: समाप्ति से {{count}} मिनट पहले',
    'scheduledReminders.firesFromNow_one': '{{when}}: पहुंचने के {{count}} मिनट बाद',
    'scheduledReminders.firesFromNow_other': '{{when}}: पहुंचने के {{count}} मिनट बाद',
    'errors.storageRecovered_one':
      'आपके डिवाइस का स्टोरेज भर गया था, इसलिए जगह बनाने के लिए {{count}} पुराने पार्किंग रिकॉर्ड की फोटो हटा दी गई। क्लाउड में साक्ष्य सुरक्षित रखने के लिए साइन इन करें।',
    'pdf.duration.minOnly_one': '{{count}} मिनट',
    'pdf.duration.hoursOnly_one': '{{count}} घंटा',
    'time.minLeft_one': '{{count}} मिनट बाकी',
    'time.hoursLeft_one': '{{count}} घंटा बाकी',
    'time.parkedForMin_one': '{{count}} मिनट से पार्क है',
    'time.parkedForHours_one': '{{count}} घंटे से पार्क है',
    'time.minAgo_one': '{{count}} मिनट पहले',
    'time.hoursAgo_one': '{{count}} घंटा पहले',
    // "I've left" without a gendered first person: the verb agrees with
    // जगह (the spot), not the speaker.
    'active.iveLeft': 'मैंने जगह खाली कर दी',
    'session.endSession': 'मैंने जगह खाली कर दी',
    // "Expired" said "ended" (समाप्त), the same as session.endedAt.
    'history.expired': 'समय खत्म',
  },
  pa: {
    'active.walkMinutes_one': '≈ {{count}} ਮਿੰਟ ਪੈਦਲ',
    'reminders.calendarCta_one': '{{count}} ਅਲਾਰਮ ਨਾਲ .ics ਡਾਊਨਲੋਡ ਕਰੋ',
    'reminders.browserCta_one': '{{count}} ਬ੍ਰਾਊਜ਼ਰ ਸੂਚਨਾ ਚਾਲੂ ਕਰੋ',
    'reminders.browserScheduled_one': '✓ {{count}} ਸੂਚਨਾ ਨਿਰਧਾਰਤ',
    'reminders.noSign.chipHour_one': '{{count}} ਘੰਟਾ',
    'scheduledReminders.firesAtExpiry': "{{when}}: ਸਮਾਪਤੀ 'ਤੇ",
    'scheduledReminders.firesBefore_one': '{{when}}: ਸਮਾਪਤੀ ਤੋਂ {{count}} ਮਿੰਟ ਪਹਿਲਾਂ',
    'scheduledReminders.firesBefore_other': '{{when}}: ਸਮਾਪਤੀ ਤੋਂ {{count}} ਮਿੰਟ ਪਹਿਲਾਂ',
    'scheduledReminders.firesFromNow_one': '{{when}}: ਪਹੁੰਚਣ ਤੋਂ {{count}} ਮਿੰਟ ਬਾਅਦ',
    'scheduledReminders.firesFromNow_other': '{{when}}: ਪਹੁੰਚਣ ਤੋਂ {{count}} ਮਿੰਟ ਬਾਅਦ',
    'errors.storageRecovered_one':
      'ਤੁਹਾਡੇ ਡਿਵਾਈਸ ਦੀ ਸਟੋਰੇਜ ਭਰ ਗਈ ਸੀ, ਇਸ ਲਈ ਥਾਂ ਬਣਾਉਣ ਵਾਸਤੇ {{count}} ਪੁਰਾਣੇ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ ਦੀ ਫੋਟੋ ਹਟਾ ਦਿੱਤੀ ਗਈ। ਸਬੂਤ ਨੂੰ ਕਲਾਊਡ ਵਿੱਚ ਸੁਰੱਖਿਅਤ ਰੱਖਣ ਲਈ ਸਾਈਨ ਇਨ ਕਰੋ।',
    'pdf.duration.minOnly_one': '{{count}} ਮਿੰਟ',
    'pdf.duration.hoursOnly_one': '{{count}} ਘੰਟਾ',
    'time.minLeft_one': '{{count}} ਮਿੰਟ ਬਾਕੀ',
    'time.hoursLeft_one': '{{count}} ਘੰਟਾ ਬਾਕੀ',
    'time.parkedForMin_one': '{{count}} ਮਿੰਟ ਤੋਂ ਪਾਰਕ ਹੈ',
    'time.parkedForHours_one': '{{count}} ਘੰਟੇ ਤੋਂ ਪਾਰਕ ਹੈ',
    'time.minAgo_one': '{{count}} ਮਿੰਟ ਪਹਿਲਾਂ',
    'time.hoursAgo_one': '{{count}} ਘੰਟਾ ਪਹਿਲਾਂ',
    // "Expired" (ਸਮਾਪਤ) and "ended" (ਖ਼ਤਮ) read the same; now "time's up"
    // versus "ended on ...".
    'history.expired': 'ਸਮਾਂ ਖ਼ਤਮ',
    'session.endedAt': '{{when}} ਨੂੰ ਸਮਾਪਤ ਕੀਤਾ',
  },
  id: {
    // All three said "Berakhir" (ended).
    'history.expired': 'Waktu habis',
    'session.endedAt': 'Selesai {{when}}',
  },
  el: {
    // "Έληξε" is "expired"; an ended record needs its own word.
    'session.endedAt': 'Τερματίστηκε {{when}}',
  },
  ko: {
    // Same label as the home card button (active.iveLeft), which the new
    // hint and PDF rows quote.
    'session.endSession': '떠났습니다',
  },
}

// Overwrites applied in every locale: { path: { locale: text } }.
const OVERWRITES_ALL = {
  // The stored time is the phone's tap time, not when the car left.
  'active.iveLeftConfirm': {
    en: "Mark this record as ended now? It saves the time you tap, from your phone's clock. If you left earlier, that earlier time isn't recorded.",
    'zh-CN': '现在将此记录标记为已结束?会保存你点按的时间(手机时钟)。如果你更早就离开了,更早的时间不会被记录。',
    vi: 'Đánh dấu bản ghi này là đã kết thúc ngay bây giờ? Bản ghi sẽ lưu lúc bạn nhấn, theo đồng hồ điện thoại. Nếu bạn đã rời đi sớm hơn, thời điểm đó sẽ không được ghi lại.',
    id: 'Tandai catatan ini selesai sekarang? Waktu kamu mengetuk akan disimpan, dari jam ponselmu. Jika kamu pergi lebih awal, waktu itu tidak tercatat.',
    ko: '지금 이 기록을 종료로 표시할까요? 누른 시각이 휴대폰 시계 기준으로 저장됩니다. 더 일찍 떠났다면 그 시각은 기록되지 않습니다.',
    it: "Vuoi segnare questo record come concluso ora? Verrà salvato l'orario del tocco, secondo l'orologio del telefono. Un'eventuale partenza precedente non viene registrata.",
    el: 'Να σημειωθεί τώρα ότι το αρχείο ολοκληρώθηκε; Θα αποθηκευτεί η ώρα που πατάς, από το ρολόι του κινητού σου. Αν έφυγες νωρίτερα, εκείνη η ώρα δεν καταγράφεται.',
    hi: 'इस रिकॉर्ड को अभी समाप्त के रूप में चिह्नित करें? टैप करने का समय आपके फ़ोन की घड़ी के अनुसार सेव होगा। अगर जगह पहले ही खाली हो गई थी, तो वह समय दर्ज नहीं होगा।',
    pa: 'ਕੀ ਇਸ ਰਿਕਾਰਡ ਨੂੰ ਹੁਣ ਸਮਾਪਤ ਵਜੋਂ ਨਿਸ਼ਾਨਬੱਧ ਕਰਨਾ ਹੈ? ਟੈਪ ਕਰਨ ਦਾ ਸਮਾਂ ਤੁਹਾਡੇ ਫ਼ੋਨ ਦੀ ਘੜੀ ਮੁਤਾਬਕ ਸੇਵ ਹੋਵੇਗਾ। ਜੇ ਥਾਂ ਪਹਿਲਾਂ ਹੀ ਖਾਲੀ ਹੋ ਗਈ ਸੀ, ਤਾਂ ਉਹ ਸਮਾਂ ਦਰਜ ਨਹੀਂ ਹੋਵੇਗਾ।',
  },
  'session.endConfirm': {
    en: "Mark this record as ended now? It saves the time you tap, from your phone's clock. If you left earlier, that earlier time isn't recorded.",
    'zh-CN': '现在将此记录标记为已结束?会保存你点按的时间(手机时钟)。如果你更早就离开了,更早的时间不会被记录。',
    vi: 'Đánh dấu bản ghi này là đã kết thúc ngay bây giờ? Bản ghi sẽ lưu lúc bạn nhấn, theo đồng hồ điện thoại. Nếu bạn đã rời đi sớm hơn, thời điểm đó sẽ không được ghi lại.',
    id: 'Tandai catatan ini selesai sekarang? Waktu kamu mengetuk akan disimpan, dari jam ponselmu. Jika kamu pergi lebih awal, waktu itu tidak tercatat.',
    ko: '지금 이 기록을 종료로 표시할까요? 누른 시각이 휴대폰 시계 기준으로 저장됩니다. 더 일찍 떠났다면 그 시각은 기록되지 않습니다.',
    it: "Vuoi segnare questo record come concluso ora? Verrà salvato l'orario del tocco, secondo l'orologio del telefono. Un'eventuale partenza precedente non viene registrata.",
    el: 'Να σημειωθεί τώρα ότι το αρχείο ολοκληρώθηκε; Θα αποθηκευτεί η ώρα που πατάς, από το ρολόι του κινητού σου. Αν έφυγες νωρίτερα, εκείνη η ώρα δεν καταγράφεται.',
    hi: 'इस रिकॉर्ड को अभी समाप्त के रूप में चिह्नित करें? टैप करने का समय आपके फ़ोन की घड़ी के अनुसार सेव होगा। अगर जगह पहले ही खाली हो गई थी, तो वह समय दर्ज नहीं होगा।',
    pa: 'ਕੀ ਇਸ ਰਿਕਾਰਡ ਨੂੰ ਹੁਣ ਸਮਾਪਤ ਵਜੋਂ ਨਿਸ਼ਾਨਬੱਧ ਕਰਨਾ ਹੈ? ਟੈਪ ਕਰਨ ਦਾ ਸਮਾਂ ਤੁਹਾਡੇ ਫ਼ੋਨ ਦੀ ਘੜੀ ਮੁਤਾਬਕ ਸੇਵ ਹੋਵੇਗਾ। ਜੇ ਥਾਂ ਪਹਿਲਾਂ ਹੀ ਖਾਲੀ ਹੋ ਗਈ ਸੀ, ਤਾਂ ਉਹ ਸਮਾਂ ਦਰਜ ਨਹੀਂ ਹੋਵੇਗਾ।',
  },
  // Starts with the visible label (WCAG 2.5.3), so voice control works.
  'active.iveLeftAria': {
    en: "I've left. Ends this parking record.",
    'zh-CN': '我已离开。结束这条停车记录。',
    vi: 'Tôi đã đi. Kết thúc bản ghi đỗ xe này.',
    id: 'Sudah pergi. Mengakhiri catatan parkir ini.',
    ko: '떠났습니다. 이 주차 기록을 종료합니다.',
    it: 'Ho lasciato il posto. Chiude questo record di parcheggio.',
    el: 'Έφυγα. Κλείνει αυτό το αρχείο στάθμευσης.',
    hi: 'मैंने जगह खाली कर दी। यह पार्किंग रिकॉर्ड समाप्त करता है।',
    pa: 'ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ। ਇਹ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ ਸਮਾਪਤ ਕਰਦਾ ਹੈ।',
  },
  // PDF rows (plain text, WinAnsi punctuation). ended_at is the phone's tap
  // time; T1b rewrites these rows inside sessionRows.
  'pdf.evidence.field.endedAt': {
    en: "Tapped I've left (phone clock)",
    'zh-CN': '点按"我已离开"的时间(手机时钟)',
    vi: 'Lúc nhấn "Tôi đã đi" (đồng hồ điện thoại)',
    id: 'Waktu mengetuk "Sudah pergi" (jam ponsel)',
    ko: '"떠났습니다"를 누른 시각 (휴대폰 시계)',
    it: 'Tocco su "Ho lasciato il posto" (orologio del telefono)',
    el: 'Πάτημα «Έφυγα» (ρολόι κινητού)',
    hi: '"मैंने जगह खाली कर दी" पर टैप का समय (फ़ोन की घड़ी)',
    pa: '"ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" \'ਤੇ ਟੈਪ ਦਾ ਸਮਾਂ (ਫ਼ੋਨ ਦੀ ਘੜੀ)',
  },
  'pdf.evidence.field.actualDuration': {
    en: "Time from arrival to the I've left tap (phone clock)",
    'zh-CN': '从到达到点按"我已离开"的时长(手机时钟)',
    vi: 'Thời gian từ lúc đến tới lúc nhấn "Tôi đã đi" (đồng hồ điện thoại)',
    id: 'Waktu dari tiba sampai mengetuk "Sudah pergi" (jam ponsel)',
    ko: '도착부터 "떠났습니다"를 누를 때까지 (휴대폰 시계)',
    it: 'Tempo dall\'arrivo al tocco su "Ho lasciato il posto" (orologio del telefono)',
    el: 'Χρόνος από την άφιξη έως το πάτημα «Έφυγα» (ρολόι κινητού)',
    hi: 'पहुँचने से "मैंने जगह खाली कर दी" पर टैप तक का समय (फ़ोन की घड़ी)',
    pa: 'ਪਹੁੰਚਣ ਤੋਂ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" \'ਤੇ ਟੈਪ ਤੱਕ ਦਾ ਸਮਾਂ (ਫ਼ੋਨ ਦੀ ਘੜੀ)',
  },
}

// ── 3. New keys, appended inside their parent object ────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position) instead of skipping existing ones.
const ADDITIONS = {
  // "Expired at" must mean the parking time ran out, never "ended".
  'active.expiredAt': {
    en: 'Expired at {{time}}',
    'zh-CN': '已于 {{time}} 到期',
    vi: 'Đã hết hạn lúc {{time}}',
    id: 'Waktu parkir habis pukul {{time}}',
    ko: '{{time}}에 만료됨',
    it: 'Scaduta alle {{time}}',
    el: 'Έληξε στις {{time}}',
    hi: 'पार्किंग का समय {{time}} पर खत्म हो गया',
    pa: "ਪਾਰਕਿੰਗ ਦਾ ਸਮਾਂ {{time}} 'ਤੇ ਖ਼ਤਮ ਹੋ ਗਿਆ",
  },
  'active.expiredHint': {
    en: "Still here? Move now. Already moved? Tap I've left.",
    'zh-CN': '还在这里?请立即移车。已经开走了?点按「我已离开」。',
    vi: 'Vẫn còn đỗ ở đây? Hãy di chuyển xe ngay. Đã di chuyển rồi? Nhấn "Tôi đã đi".',
    id: 'Masih di sini? Pindahkan sekarang. Sudah pindah? Ketuk "Sudah pergi".',
    ko: '아직 여기 있나요? 지금 이동하세요. 이미 이동했나요? "떠났습니다"를 누르세요.',
    it: 'Sei ancora qui? Sposta l\'auto ora. Hai già spostato l\'auto? Tocca "Ho lasciato il posto".',
    el: 'Είσαι ακόμα εδώ; Μετακίνησε το αμάξι τώρα. Το μετακίνησες ήδη; Πάτα «Έφυγα».',
    hi: 'अभी भी यहीं हैं? अभी गाड़ी हटा लें। गाड़ी पहले ही हटा ली? "मैंने जगह खाली कर दी" पर टैप करें।',
    pa: 'ਹਾਲੇ ਵੀ ਇੱਥੇ ਹੋ? ਹੁਣੇ ਗੱਡੀ ਹਟਾ ਲਵੋ। ਗੱਡੀ ਪਹਿਲਾਂ ਹੀ ਹਟਾ ਲਈ? "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" \'ਤੇ ਟੈਪ ਕਰੋ।',
  },
  'active.walkBackAria': {
    en: 'Walk back. Opens walking directions to your car.',
    'zh-CN': '走回。打开前往你车辆的步行路线。',
    vi: 'Đi bộ về. Mở chỉ đường đi bộ đến xe của bạn.',
    id: 'Jalan kembali. Membuka petunjuk jalan kaki ke mobilmu.',
    ko: '걸어 돌아가기. 차까지 가는 도보 경로를 엽니다.',
    it: 'Torna a piedi. Apre le indicazioni a piedi per la tua auto.',
    el: 'Επιστροφή. Ανοίγει οδηγίες με τα πόδια προς το αμάξι σου.',
    hi: 'वापस चलें। आपकी कार तक पैदल रास्ता खोलता है।',
    pa: 'ਵਾਪਸ ਚੱਲੋ। ਤੁਹਾਡੀ ਕਾਰ ਤੱਕ ਪੈਦਲ ਰਸਤਾ ਖੋਲ੍ਹਦਾ ਹੈ।',
  },
  'active.walkBackAriaDistance_one': {
    en: 'Walk back. Opens walking directions to your car, {{distance}} away, about {{count}} minute on foot.',
    'zh-CN': '走回。打开前往你车辆的步行路线,距离 {{distance}},步行约 {{count}} 分钟。',
    vi: 'Đi bộ về. Mở chỉ đường đi bộ đến xe của bạn, cách {{distance}}, khoảng {{count}} phút đi bộ.',
    id: 'Jalan kembali. Membuka petunjuk jalan kaki ke mobilmu, berjarak {{distance}}, sekitar {{count}} menit jalan kaki.',
    ko: '걸어 돌아가기. 차까지 가는 도보 경로를 엽니다. {{distance}} 거리, 걸어서 약 {{count}}분.',
    it: 'Torna a piedi. Apre le indicazioni a piedi per la tua auto, a {{distance}}, circa {{count}} minuto a piedi.',
    el: 'Επιστροφή. Ανοίγει οδηγίες με τα πόδια προς το αμάξι σου, σε απόσταση {{distance}}, περίπου {{count}} λεπτό με τα πόδια.',
    hi: 'वापस चलें। आपकी कार तक पैदल रास्ता खोलता है, {{distance}} दूर, लगभग {{count}} मिनट पैदल।',
    pa: 'ਵਾਪਸ ਚੱਲੋ। ਤੁਹਾਡੀ ਕਾਰ ਤੱਕ ਪੈਦਲ ਰਸਤਾ ਖੋਲ੍ਹਦਾ ਹੈ, {{distance}} ਦੂਰ, ਲਗਭਗ {{count}} ਮਿੰਟ ਪੈਦਲ।',
  },
  'active.walkBackAriaDistance_other': {
    en: 'Walk back. Opens walking directions to your car, {{distance}} away, about {{count}} minutes on foot.',
    'zh-CN': '走回。打开前往你车辆的步行路线,距离 {{distance}},步行约 {{count}} 分钟。',
    vi: 'Đi bộ về. Mở chỉ đường đi bộ đến xe của bạn, cách {{distance}}, khoảng {{count}} phút đi bộ.',
    id: 'Jalan kembali. Membuka petunjuk jalan kaki ke mobilmu, berjarak {{distance}}, sekitar {{count}} menit jalan kaki.',
    ko: '걸어 돌아가기. 차까지 가는 도보 경로를 엽니다. {{distance}} 거리, 걸어서 약 {{count}}분.',
    it: 'Torna a piedi. Apre le indicazioni a piedi per la tua auto, a {{distance}}, circa {{count}} minuti a piedi.',
    el: 'Επιστροφή. Ανοίγει οδηγίες με τα πόδια προς το αμάξι σου, σε απόσταση {{distance}}, περίπου {{count}} λεπτά με τα πόδια.',
    hi: 'वापस चलें। आपकी कार तक पैदल रास्ता खोलता है, {{distance}} दूर, लगभग {{count}} मिनट पैदल।',
    pa: 'ਵਾਪਸ ਚੱਲੋ। ਤੁਹਾਡੀ ਕਾਰ ਤੱਕ ਪੈਦਲ ਰਸਤਾ ਖੋਲ੍ਹਦਾ ਹੈ, {{distance}} ਦੂਰ, ਲਗਭਗ {{count}} ਮਿੰਟ ਪੈਦਲ।',
  },
  // A late "I've left" (record past its expiry, or open for over 12 h):
  // names the tap time that will be stored.
  'session.endConfirmLate': {
    en: "Mark this record as ended now? It will record {{time}}, the time you tap, from your phone's clock. It won't show when the car actually left.",
    'zh-CN': '现在将此记录标记为已结束?记录的将是你点按的时间 {{time}}(手机时钟),而不是车辆实际离开的时间。',
    vi: 'Đánh dấu bản ghi này là đã kết thúc ngay bây giờ? Bản ghi sẽ lưu {{time}}, là lúc bạn nhấn, theo đồng hồ điện thoại. Bản ghi sẽ không cho thấy lúc xe thực sự rời đi.',
    id: 'Tandai catatan ini selesai sekarang? Catatan akan menyimpan {{time}}, waktu kamu mengetuk, dari jam ponselmu. Catatan tidak menunjukkan kapan mobil benar-benar pergi.',
    ko: '지금 이 기록을 종료로 표시할까요? 누른 시각인 {{time}}(휴대폰 시계 기준)으로 기록됩니다. 차가 실제로 떠난 시각은 기록되지 않습니다.',
    it: "Vuoi segnare questo record come concluso ora? Verrà registrato l'orario del tocco, {{time}}, secondo l'orologio del telefono. Non mostrerà quando l'auto è partita davvero.",
    el: 'Να σημειωθεί τώρα ότι το αρχείο ολοκληρώθηκε; Θα καταγραφεί η ώρα που πατάς, {{time}}, από το ρολόι του κινητού σου. Δεν θα δείχνει πότε έφυγε πραγματικά το αυτοκίνητο.',
    hi: 'इस रिकॉर्ड को अभी समाप्त के रूप में चिह्नित करें? इसमें {{time}} दर्ज होगा, यानी टैप करने का समय, आपके फ़ोन की घड़ी के अनुसार। इससे यह पता नहीं चलेगा कि कार असल में कब गई।',
    pa: 'ਕੀ ਇਸ ਰਿਕਾਰਡ ਨੂੰ ਹੁਣ ਸਮਾਪਤ ਵਜੋਂ ਨਿਸ਼ਾਨਬੱਧ ਕਰਨਾ ਹੈ? ਇਸ ਵਿੱਚ {{time}} ਦਰਜ ਹੋਵੇਗਾ, ਯਾਨੀ ਟੈਪ ਕਰਨ ਦਾ ਸਮਾਂ, ਤੁਹਾਡੇ ਫ਼ੋਨ ਦੀ ਘੜੀ ਮੁਤਾਬਕ। ਇਸ ਤੋਂ ਇਹ ਪਤਾ ਨਹੀਂ ਲੱਗੇਗਾ ਕਿ ਕਾਰ ਅਸਲ ਵਿੱਚ ਕਦੋਂ ਗਈ।',
  },
  'scheduledReminders.otherDevice': {
    en: 'These reminders were set on another device. Change them on that device.',
    'zh-CN': '这些提醒是在另一台设备上设置的。请在那台设备上更改。',
    vi: 'Các lời nhắc này được đặt trên một thiết bị khác. Hãy thay đổi chúng trên thiết bị đó.',
    id: 'Pengingat ini diatur di perangkat lain. Ubah di perangkat itu.',
    ko: '이 알림은 다른 기기에서 설정되었습니다. 해당 기기에서 변경하세요.',
    it: 'Questi promemoria sono stati impostati su un altro dispositivo. Modificali da quel dispositivo.',
    el: 'Αυτές οι υπενθυμίσεις ορίστηκαν σε άλλη συσκευή. Άλλαξέ τες από εκείνη τη συσκευή.',
    hi: 'ये रिमाइंडर किसी दूसरे डिवाइस पर सेट किए गए थे। इन्हें उसी डिवाइस पर बदलें।',
    pa: "ਇਹ ਰਿਮਾਈਂਡਰ ਕਿਸੇ ਹੋਰ ਡਿਵਾਈਸ 'ਤੇ ਸੈੱਟ ਕੀਤੇ ਗਏ ਸਨ। ਇਨ੍ਹਾਂ ਨੂੰ ਉਸੇ ਡਿਵਾਈਸ 'ਤੇ ਬਦਲੋ।",
  },
  'errors.storageFull': {
    en: "ParkProof's storage on this device is full. Current records and records still waiting for a signature are kept. Open History, delete an old record you no longer need, then try again.",
    'zh-CN': 'ParkProof 在此设备上的存储空间已满。当前记录和仍在等待签名的记录都会保留。请打开记录列表,删除一条不再需要的旧记录,然后重试。',
    vi: 'Bộ nhớ của ParkProof trên thiết bị này đã đầy. Các bản ghi hiện tại và bản ghi đang chờ chữ ký vẫn được giữ lại. Hãy mở Lịch sử, xoá một bản ghi cũ không còn cần, rồi thử lại.',
    id: 'Penyimpanan ParkProof di perangkat ini penuh. Catatan yang sedang berjalan dan catatan yang masih menunggu tanda tangan tetap disimpan. Buka Riwayat, hapus catatan lama yang tidak kamu perlukan lagi, lalu coba lagi.',
    ko: '이 기기의 ParkProof 저장 공간이 가득 찼습니다. 현재 기록과 서명을 기다리는 기록은 유지됩니다. 기록 목록을 열어 더 이상 필요 없는 오래된 기록을 삭제한 뒤 다시 시도하세요.',
    it: 'Lo spazio di ParkProof su questo dispositivo è pieno. I record in corso e quelli ancora in attesa di firma vengono conservati. Apri la cronologia, elimina un record vecchio che non ti serve più e riprova.',
    el: 'Ο χώρος αποθήκευσης του ParkProof σε αυτή τη συσκευή είναι γεμάτος. Τα τρέχοντα αρχεία και όσα περιμένουν ακόμα υπογραφή διατηρούνται. Άνοιξε το ιστορικό, διάγραψε ένα παλιό αρχείο που δεν χρειάζεσαι πια και δοκίμασε ξανά.',
    hi: 'इस डिवाइस पर ParkProof का स्टोरेज भर गया है। मौजूदा रिकॉर्ड और हस्ताक्षर का इंतज़ार कर रहे रिकॉर्ड सुरक्षित रखे गए हैं। इतिहास खोलें, कोई पुराना रिकॉर्ड हटाएं जिसकी अब ज़रूरत नहीं है, फिर दोबारा कोशिश करें।',
    pa: "ਇਸ ਡਿਵਾਈਸ 'ਤੇ ParkProof ਦੀ ਸਟੋਰੇਜ ਭਰ ਗਈ ਹੈ। ਮੌਜੂਦਾ ਰਿਕਾਰਡ ਅਤੇ ਦਸਤਖ਼ਤ ਦੀ ਉਡੀਕ ਕਰ ਰਹੇ ਰਿਕਾਰਡ ਸੰਭਾਲ ਕੇ ਰੱਖੇ ਗਏ ਹਨ। ਇਤਿਹਾਸ ਖੋਲ੍ਹੋ, ਕੋਈ ਪੁਰਾਣਾ ਰਿਕਾਰਡ ਮਿਟਾਓ ਜਿਸ ਦੀ ਹੁਣ ਲੋੜ ਨਹੀਂ, ਫਿਰ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  'errors.storageEvicted_one': {
    en: 'Your device storage was full, so {{count}} older parking record was deleted to make space. Sign in to keep records safe in the cloud.',
    'zh-CN': '你的设备存储已满,因此为了腾出空间,删除了 {{count}} 条较旧的停车记录。登录即可把记录安全保存在云端。',
    vi: 'Bộ nhớ thiết bị của bạn đã đầy, nên {{count}} bản ghi đỗ xe cũ đã bị xoá để lấy chỗ trống. Đăng nhập để giữ bản ghi an toàn trên đám mây.',
    id: 'Penyimpanan perangkatmu penuh, jadi {{count}} catatan parkir lama dihapus untuk memberi ruang. Masuk untuk menjaga catatan tetap aman di cloud.',
    ko: '기기 저장 공간이 가득 차서, 공간 확보를 위해 오래된 주차 기록 {{count}}개가 삭제되었습니다. 기록을 클라우드에 안전하게 보관하려면 로그인하세요.',
    it: 'Lo storage del dispositivo era pieno, quindi {{count}} vecchio record di parcheggio è stato eliminato per fare spazio. Accedi per tenere i record al sicuro nel cloud.',
    el: 'Ο αποθηκευτικός χώρος της συσκευής σου ήταν γεμάτος, οπότε {{count}} παλαιότερο αρχείο στάθμευσης διαγράφηκε για να ελευθερωθεί χώρος. Συνδέσου για να κρατήσεις τα αρχεία σου ασφαλή στο cloud.',
    hi: 'आपके डिवाइस का स्टोरेज भर गया था, इसलिए जगह बनाने के लिए {{count}} पुराना पार्किंग रिकॉर्ड हटा दिया गया। क्लाउड में रिकॉर्ड सुरक्षित रखने के लिए साइन इन करें।',
    pa: 'ਤੁਹਾਡੇ ਡਿਵਾਈਸ ਦੀ ਸਟੋਰੇਜ ਭਰ ਗਈ ਸੀ, ਇਸ ਲਈ ਥਾਂ ਬਣਾਉਣ ਵਾਸਤੇ {{count}} ਪੁਰਾਣਾ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ ਮਿਟਾ ਦਿੱਤਾ ਗਿਆ। ਰਿਕਾਰਡ ਕਲਾਊਡ ਵਿੱਚ ਸੁਰੱਖਿਅਤ ਰੱਖਣ ਲਈ ਸਾਈਨ ਇਨ ਕਰੋ।',
  },
  'errors.storageEvicted_other': {
    en: 'Your device storage was full, so {{count}} older parking records were deleted to make space. Sign in to keep records safe in the cloud.',
    'zh-CN': '你的设备存储已满,因此为了腾出空间,删除了 {{count}} 条较旧的停车记录。登录即可把记录安全保存在云端。',
    vi: 'Bộ nhớ thiết bị của bạn đã đầy, nên {{count}} bản ghi đỗ xe cũ đã bị xoá để lấy chỗ trống. Đăng nhập để giữ bản ghi an toàn trên đám mây.',
    id: 'Penyimpanan perangkatmu penuh, jadi {{count}} catatan parkir lama dihapus untuk memberi ruang. Masuk untuk menjaga catatan tetap aman di cloud.',
    ko: '기기 저장 공간이 가득 차서, 공간 확보를 위해 오래된 주차 기록 {{count}}개가 삭제되었습니다. 기록을 클라우드에 안전하게 보관하려면 로그인하세요.',
    it: 'Lo storage del dispositivo era pieno, quindi {{count}} vecchi record di parcheggio sono stati eliminati per fare spazio. Accedi per tenere i record al sicuro nel cloud.',
    el: 'Ο αποθηκευτικός χώρος της συσκευής σου ήταν γεμάτος, οπότε {{count}} παλαιότερα αρχεία στάθμευσης διαγράφηκαν για να ελευθερωθεί χώρος. Συνδέσου για να κρατήσεις τα αρχεία σου ασφαλή στο cloud.',
    hi: 'आपके डिवाइस का स्टोरेज भर गया था, इसलिए जगह बनाने के लिए {{count}} पुराने पार्किंग रिकॉर्ड हटा दिए गए। क्लाउड में रिकॉर्ड सुरक्षित रखने के लिए साइन इन करें।',
    pa: 'ਤੁਹਾਡੇ ਡਿਵਾਈਸ ਦੀ ਸਟੋਰੇਜ ਭਰ ਗਈ ਸੀ, ਇਸ ਲਈ ਥਾਂ ਬਣਾਉਣ ਵਾਸਤੇ {{count}} ਪੁਰਾਣੇ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ ਮਿਟਾ ਦਿੱਤੇ ਗਏ। ਰਿਕਾਰਡ ਕਲਾਊਡ ਵਿੱਚ ਸੁਰੱਖਿਅਤ ਰੱਖਣ ਲਈ ਸਾਈਨ ਇਨ ਕਰੋ।',
  },
}

// Keys a lawyer should read before launch (docs/legal-review-queue.md, T10):
// statements about what the record and its PDF show.
const LEGAL_REVIEW = new Set([
  'pdf.evidence.field.endedAt',
  'pdf.evidence.field.actualDuration',
  'active.iveLeftConfirm',
  'session.endConfirm',
  'session.endConfirmLate',
])

// ── helpers ─────────────────────────────────────────────────────────────
function fail(msg) {
  console.error(`ABORT (nothing written): ${msg}`)
  process.exit(1)
}

function parentOf(root, path, locale, { create = false } = {}) {
  const parts = path.split('.')
  const leaf = parts.pop()
  let node = root
  for (const p of parts) {
    if (node[p] === undefined && create) node[p] = {}
    if (!node[p] || typeof node[p] !== 'object' || Array.isArray(node[p])) {
      fail(`${locale}: no object at "${parts.join('.')}" for ${path}`)
    }
    node = node[p]
  }
  return { node, leaf }
}

/** Rename `leaf` to `newLeaf` keeping its position among its siblings. */
function renameInPlace(root, path, newLeaf, locale) {
  const { node, leaf } = parentOf(root, path, locale)
  const hasOld = Object.prototype.hasOwnProperty.call(node, leaf)
  const hasNew = Object.prototype.hasOwnProperty.call(node, newLeaf)
  if (!hasOld && hasNew) return false // already renamed
  if (!hasOld) fail(`${locale}: ${path} missing and ${newLeaf} absent too`)
  if (hasNew) fail(`${locale}: both ${path} and ${newLeaf} exist`)
  const entries = Object.entries(node).map(([k, v]) => (k === leaf ? [newLeaf, v] : [k, v]))
  for (const k of Object.keys(node)) delete node[k]
  for (const [k, v] of entries) node[k] = v
  return true
}

function overwrite(root, path, value, locale) {
  const { node, leaf } = parentOf(root, path, locale)
  if (typeof node[leaf] !== 'string') fail(`${locale}: overwrite target ${path} is not an existing string`)
  node[leaf] = value
}

/** Set a key this script owns: appended when new, rewritten in place when present. */
function setOwned(root, path, value, locale) {
  const { node, leaf } = parentOf(root, path, locale, { create: true })
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
    // A language may spell its singular without the number ("1 hour"), so
    // {{count}} is not compared on _one keys. hi and pa are checked below.
    .filter((v) => !(isOne && v === 'count'))
    .sort()
    .join(',')
const tagsOf = (s) => [...new Set(s.match(/<\/?[a-zA-Z][\w-]*\s*\/?>/g) || [])].sort().join(',')

function overwritesFor(locale) {
  const out = { ...(OVERWRITES[locale] ?? {}) }
  for (const [path, byLocale] of Object.entries(OVERWRITES_ALL)) {
    if (typeof byLocale[locale] !== 'string') fail(`no ${locale} text for overwrite ${path}`)
    if (path in out) fail(`${locale}: ${path} is in both OVERWRITES and OVERWRITES_ALL`)
    out[path] = byLocale[locale]
  }
  return out
}

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
  // Everything this script writes must follow the copy rules.
  const written = [
    ...Object.values(OVERWRITES).flatMap((m) => Object.values(m)),
    ...Object.values(OVERWRITES_ALL).flatMap((m) => Object.values(m)),
    ...Object.values(ADDITIONS).flatMap((m) => Object.values(m)),
  ]
  for (const s of written) if (s.includes('—')) problems.push(`em-dash in new copy: ${s}`)
  // PDF strings: plain text, no symbols the PDF fonts can't draw.
  for (const [path, byLocale] of Object.entries(OVERWRITES_ALL)) {
    if (!path.startsWith('pdf.')) continue
    for (const s of Object.values(byLocale)) if (/[✓⚠→≈≤]/u.test(s)) problems.push(`symbol in PDF copy: ${s}`)
  }
  // The en record noun is "record", never "session".
  for (const m of [OVERWRITES_ALL, ADDITIONS]) {
    for (const [path, byLocale] of Object.entries(m)) {
      if (/\bsessions?\b/i.test(byLocale.en)) problems.push(`"session" in en copy at ${path}`)
    }
  }
  return problems
}

// ── --list: keys for the T10 review ─────────────────────────────────────
if (process.argv.includes('--list')) {
  const keys = new Set([
    ...RENAMES.map(([p, leaf]) => `${p.split('.').slice(0, -1).join('.')}.${leaf}`),
    ...Object.values(OVERWRITES).flatMap((m) => Object.keys(m)),
    ...Object.keys(OVERWRITES_ALL),
    ...Object.keys(ADDITIONS),
  ])
  for (const k of [...keys].sort()) console.log(`${LEGAL_REVIEW.has(k) ? 'legal ' : '      '}${k}`)
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
  for (const [path, newLeaf] of RENAMES) renameInPlace(data[locale], path, newLeaf, locale)
  for (const [path, value] of Object.entries(overwritesFor(locale))) overwrite(data[locale], path, value, locale)
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
