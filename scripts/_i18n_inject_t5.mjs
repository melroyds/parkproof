/**
 * T5 i18n (roadmap build spec, tasks T5a and T5b: street sweeping and
 * weekly reminders). Idempotent: running it twice leaves the files
 * byte-identical after the first run. Every unit of T5 extends this one
 * script.
 *
 * T5a adds one top-level object, `recurring`:
 *   - the home row ("Street sweeping and weekly reminders") and the
 *     recurring view (list, next occurrence, pause, delete, calendar file);
 *   - the editor (kind, name, days, times, every week / every second week /
 *     some weeks of the month, where, the evening-before and before-it-starts
 *     reminders, notify on this phone);
 *   - the remind screen's "Remind me every week" card and sheet ("Check
 *     these days and times against the sign");
 *   - the words that build schedule lines ("Every week on Tuesday, 7 to
 *     9 am"): day names, ordinals, ranges. Each locale orders them its own
 *     way through named {{vars}};
 *   - the notification text ("Street sweeping on Tuesday 7 to 9 am. Move the
 *     car tonight.") and the calendar file's text;
 *   - the council note (schedules change, public holidays may differ).
 *
 * The reliability line every reminder feature carries is the shared
 * `reminders.reliability` (scripts/_i18n_inject_fix_push.mjs), shown by
 * ReminderHelp with the Android tips and Reconnect, and written into the
 * calendar file. This script once added its own copy of it,
 * `recurring.reliability`, and now deletes it (REMOVALS).
 *
 * T5b (weekly reminders by push) adds `recurring.pushStatus.*`: the line
 * under each rule in the list saying whether its reminders can alert the
 * phone with ParkProof closed, only while it's open (push unavailable), or
 * not at all right now (no notification support or permission, or Android
 * before push is booked while no service worker controls the page). The
 * push notification words themselves are
 * T5a's `recurring.notify.*`, written on the phone and booked with the
 * server.
 *
 * `recurring.zone.*` names the place a rule's times are local to (the
 * Australian IANA zones), so a zone id is never shown raw.
 *
 * T5b also adds `privacy.anonymousWeeklyPush`, the privacy page's line on
 * weekly reminders by push, rendered after T4's `privacy.anonymousPush`.
 * That line covers a record's one-off reminders, which the server deletes
 * once sent; a weekly reminder's details stay on the server as EventBridge
 * schedules while the rule wants push (lambda/index.js handlePushRecurring),
 * until the rule is paused, deleted or its notifications switched off
 * (reconcileRecurringPush cancels them), and at most RECURRING_SCHEDULE_DAYS
 * (90) after the phone last booked them, which it only does while open.
 *
 * T5a and T5b are one task in this build's plan, so they share this one
 * script (the task brief names it); `--list` covers both for T10.
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces, plus: every `_one` key this
 * script owns carries {{count}} in every locale).
 *
 * Run:   node scripts/_i18n_inject_t5.mjs
 * List:  node scripts/_i18n_inject_t5.mjs --list
 *        prints every key this task added or rewrote, for the T10
 *        translation review.
 * Other: node scripts/_i18n_inject_t5.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

/**
 * Keys a lawyer should read before launch (docs/legal-review-queue.md, T10):
 * the disclaimers. The reliability line is the shared reminders.reliability.
 */
const LEGAL = new Set(['recurring.councilNote', 'privacy.anonymousWeeklyPush'])

/** One string per locale, in LOCALES order. */
const T = (en, zh, vi, id, ko, it, el, hi, pa) => ({ en, 'zh-CN': zh, vi, id, ko, it, el, hi, pa })

// ── New keys, appended inside their parent object ────────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position). Missing parent objects are created,
// appended at the end of their own parent.
const ADDITIONS = {
  // ── The recurring view ──
  'recurring.title': T(
    'Weekly reminders',
    '每周提醒',
    'Nhắc nhở hằng tuần',
    'Pengingat mingguan',
    '매주 알림',
    'Promemoria settimanali',
    'Εβδομαδιαίες υπενθυμίσεις',
    'साप्ताहिक रिमाइंडर',
    'ਹਫ਼ਤਾਵਾਰੀ ਰਿਮਾਈਂਡਰ',
  ),
  'recurring.intro': T(
    'Street sweeping, clearways and other restrictions that come back on the same days. Set them once and get a reminder before each one.',
    '街道清扫、清道和其他在固定日子重复的限制。设置一次,每次开始前都会提醒你。',
    'Quét đường, clearway và các hạn chế khác lặp lại vào cùng những ngày. Đặt một lần là được nhắc trước mỗi lần.',
    'Penyapuan jalan, clearway, dan larangan lain yang berulang di hari yang sama. Atur sekali, lalu dapatkan pengingat sebelum setiap kali dimulai.',
    '도로 청소, 클리어웨이 등 같은 요일마다 반복되는 제한입니다. 한 번 설정하면 매번 시작 전에 알려 드립니다.',
    'Pulizia strade, clearway e altri divieti che si ripetono negli stessi giorni. Impostali una volta e ricevi un promemoria prima di ognuno.',
    'Καθαρισμός δρόμων, clearway και άλλοι περιορισμοί που επαναλαμβάνονται τις ίδιες μέρες. Ρύθμισέ τους μία φορά και θα παίρνεις υπενθύμιση πριν από κάθε φορά.',
    'सड़क की सफ़ाई, क्लियरवे और ऐसी दूसरी पाबंदियाँ जो तय दिनों पर दोहराई जाती हैं। एक बार सेट करें, और हर बार शुरू होने से पहले रिमाइंडर पाएँ।',
    "ਸੜਕ ਦੀ ਸਫ਼ਾਈ, ਕਲੀਅਰਵੇ ਅਤੇ ਹੋਰ ਪਾਬੰਦੀਆਂ ਜੋ ਤੈਅ ਦਿਨਾਂ 'ਤੇ ਦੁਹਰਾਈਆਂ ਜਾਂਦੀਆਂ ਹਨ। ਇੱਕ ਵਾਰ ਸੈੱਟ ਕਰੋ, ਅਤੇ ਹਰ ਵਾਰ ਸ਼ੁਰੂ ਹੋਣ ਤੋਂ ਪਹਿਲਾਂ ਰਿਮਾਈਂਡਰ ਪਾਓ।",
  ),
  // ── The home row (T4's layout places it) ──
  'recurring.homeRow': T(
    'Street sweeping and weekly reminders',
    '街道清扫和每周提醒',
    'Quét đường và nhắc nhở hằng tuần',
    'Penyapuan jalan dan pengingat mingguan',
    '도로 청소 및 매주 알림',
    'Pulizia strade e promemoria settimanali',
    'Καθαρισμός δρόμων και εβδομαδιαίες υπενθυμίσεις',
    'सड़क की सफ़ाई और साप्ताहिक रिमाइंडर',
    'ਸੜਕ ਦੀ ਸਫ਼ਾਈ ਅਤੇ ਹਫ਼ਤਾਵਾਰੀ ਰਿਮਾਈਂਡਰ',
  ),
  // {{what}} is the reminder's name, {{time}} "7:00 am" or "7:00 am, Tue 10/11/2026".
  'recurring.homeNext': T(
    'Next: {{what}}, {{time}}',
    '下一次:{{what}},{{time}}',
    'Lần tới: {{what}}, {{time}}',
    'Berikutnya: {{what}}, {{time}}',
    '다음: {{what}}, {{time}}',
    'Prossimo: {{what}}, {{time}}',
    'Επόμενο: {{what}}, {{time}}',
    'अगला: {{what}}, {{time}}',
    'ਅਗਲਾ: {{what}}, {{time}}',
  ),
  'recurring.homeOnNow': T(
    '{{what}} is on now, until {{time}}',
    '{{what}}正在进行,到 {{time}} 结束',
    '{{what}} đang diễn ra, đến {{time}}',
    '{{what}} sedang berlaku, sampai {{time}}',
    '{{what}} 진행 중, {{time}}까지',
    '{{what}} in corso, fino alle {{time}}',
    '{{what}} σε ισχύ τώρα, έως τις {{time}}',
    '{{what}} अभी लागू है, {{time}} तक',
    '{{what}} ਹੁਣ ਲਾਗੂ ਹੈ, {{time}} ਤੱਕ',
  ),
  // Counts every saved reminder, paused ones too: "set", never "active".
  'recurring.homeCount_one': T(
    '{{count}} set',
    '已设 {{count}} 个',
    '{{count}} đã đặt',
    '{{count}} diatur',
    '{{count}}개 설정됨',
    '{{count}} impostato',
    '{{count}} ρυθμισμένη',
    '{{count}} सेट',
    '{{count}} ਸੈੱਟ',
  ),
  'recurring.homeCount_other': T(
    '{{count}} set',
    '已设 {{count}} 个',
    '{{count}} đã đặt',
    '{{count}} diatur',
    '{{count}}개 설정됨',
    '{{count}} impostati',
    '{{count}} ρυθμισμένες',
    '{{count}} सेट',
    '{{count}} ਸੈੱਟ',
  ),
  'recurring.homeNone': T('None yet', '暂无', 'Chưa có', 'Belum ada', '아직 없음', 'Nessuno', 'Καμία ακόμα', 'अभी कोई नहीं', 'ਹਾਲੇ ਕੋਈ ਨਹੀਂ'),
  'recurring.empty': T(
    'No weekly reminders yet',
    '还没有每周提醒',
    'Chưa có nhắc nhở hằng tuần',
    'Belum ada pengingat mingguan',
    '아직 매주 알림이 없습니다',
    'Nessun promemoria settimanale',
    'Δεν υπάρχουν ακόμα εβδομαδιαίες υπενθυμίσεις',
    'अभी कोई साप्ताहिक रिमाइंडर नहीं',
    'ਹਾਲੇ ਕੋਈ ਹਫ਼ਤਾਵਾਰੀ ਰਿਮਾਈਂਡਰ ਨਹੀਂ',
  ),
  'recurring.emptyHelp': T(
    'Add one for the street sweeping or clearway where you usually park.',
    '为你常停车地方的街道清扫或清道时段添加一个提醒。',
    'Thêm một nhắc nhở cho lịch quét đường hoặc clearway ở nơi bạn hay đỗ xe.',
    'Tambahkan satu untuk penyapuan jalan atau clearway di tempat kamu biasa parkir.',
    '자주 주차하는 곳의 도로 청소나 클리어웨이 알림을 추가하세요.',
    'Aggiungine uno per la pulizia strade o il clearway dove parcheggi di solito.',
    'Πρόσθεσε μία για τον καθαρισμό δρόμου ή το clearway εκεί που παρκάρεις συνήθως.',
    'जहाँ आप आमतौर पर पार्क करते हैं, वहाँ की सड़क सफ़ाई या क्लियरवे के लिए एक जोड़ें।',
    "ਜਿੱਥੇ ਤੁਸੀਂ ਆਮ ਤੌਰ 'ਤੇ ਪਾਰਕ ਕਰਦੇ ਹੋ, ਉੱਥੇ ਦੀ ਸੜਕ ਸਫ਼ਾਈ ਜਾਂ ਕਲੀਅਰਵੇ ਲਈ ਇੱਕ ਜੋੜੋ।",
  ),
  'recurring.add': T(
    'Add a weekly reminder',
    '添加每周提醒',
    'Thêm nhắc nhở hằng tuần',
    'Tambah pengingat mingguan',
    '매주 알림 추가',
    'Aggiungi un promemoria settimanale',
    'Πρόσθεσε εβδομαδιαία υπενθύμιση',
    'साप्ताहिक रिमाइंडर जोड़ें',
    'ਹਫ਼ਤਾਵਾਰੀ ਰਿਮਾਈਂਡਰ ਜੋੜੋ',
  ),
  'recurring.editTitleNew': T(
    'New weekly reminder',
    '新的每周提醒',
    'Nhắc nhở hằng tuần mới',
    'Pengingat mingguan baru',
    '새 매주 알림',
    'Nuovo promemoria settimanale',
    'Νέα εβδομαδιαία υπενθύμιση',
    'नया साप्ताहिक रिमाइंडर',
    'ਨਵਾਂ ਹਫ਼ਤਾਵਾਰੀ ਰਿਮਾਈਂਡਰ',
  ),
  'recurring.editTitle': T(
    'Edit weekly reminder',
    '编辑每周提醒',
    'Sửa nhắc nhở hằng tuần',
    'Ubah pengingat mingguan',
    '매주 알림 수정',
    'Modifica promemoria settimanale',
    'Επεξεργασία εβδομαδιαίας υπενθύμισης',
    'साप्ताहिक रिमाइंडर संपादित करें',
    'ਹਫ਼ਤਾਵਾਰੀ ਰਿਮਾਈਂਡਰ ਸੰਪਾਦਿਤ ਕਰੋ',
  ),
  // ── Kinds (the model's RecurringRestriction.kind, through this key map) ──
  'recurring.kind.street_cleaning': T(
    'Street sweeping',
    '街道清扫',
    'Quét đường',
    'Penyapuan jalan',
    '도로 청소',
    'Pulizia strade',
    'Καθαρισμός δρόμου',
    'सड़क की सफ़ाई',
    'ਸੜਕ ਦੀ ਸਫ਼ਾਈ',
  ),
  // Australian signs print CLEARWAY in English; most locales keep the word.
  'recurring.kind.clearway': T('Clearway', '清道', 'Clearway', 'Clearway', '클리어웨이', 'Clearway', 'Clearway', 'क्लियरवे', 'ਕਲੀਅਰਵੇ'),
  'recurring.kind.no_stopping': T(
    'No stopping',
    '禁止停车',
    'Cấm dừng xe',
    'Dilarang berhenti',
    '정차 금지',
    'Divieto di fermata',
    'Απαγόρευση στάσης',
    'रुकना मना',
    'ਰੁਕਣਾ ਮਨ੍ਹਾ',
  ),
  'recurring.kind.other': T(
    'Other restriction',
    '其他限制',
    'Hạn chế khác',
    'Larangan lain',
    '기타 제한',
    'Altro divieto',
    'Άλλος περιορισμός',
    'दूसरी पाबंदी',
    'ਹੋਰ ਪਾਬੰਦੀ',
  ),
  // ── Editor fields ──
  'recurring.field.kind': T('What is it?', '是什么?', 'Đây là gì?', 'Apa ini?', '어떤 제한인가요?', 'Di cosa si tratta?', 'Τι είναι;', 'यह क्या है?', 'ਇਹ ਕੀ ਹੈ?'),
  'recurring.field.label': T('Name', '名称', 'Tên', 'Nama', '이름', 'Nome', 'Όνομα', 'नाम', 'ਨਾਮ'),
  'recurring.field.days': T('Days', '星期', 'Ngày', 'Hari', '요일', 'Giorni', 'Ημέρες', 'दिन', 'ਦਿਨ'),
  'recurring.field.start': T('Starts', '开始', 'Bắt đầu', 'Mulai', '시작', 'Inizio', 'Έναρξη', 'शुरू', 'ਸ਼ੁਰੂ'),
  'recurring.field.end': T('Ends', '结束', 'Kết thúc', 'Selesai', '종료', 'Fine', 'Λήξη', 'ख़त्म', 'ਖ਼ਤਮ'),
  'recurring.field.frequency': T(
    'How often',
    '频率',
    'Bao lâu một lần',
    'Seberapa sering',
    '반복',
    'Ogni quanto',
    'Πόσο συχνά',
    'कितनी बार',
    'ਕਿੰਨੀ ਵਾਰ',
  ),
  'recurring.field.anchor': T(
    'Date of the next one',
    '下一次的日期',
    'Ngày của lần tới',
    'Tanggal berikutnya',
    '다음 날짜',
    'Data della prossima volta',
    'Ημερομηνία της επόμενης',
    'अगली बार की तारीख़',
    'ਅਗਲੀ ਵਾਰ ਦੀ ਤਾਰੀਖ਼',
  ),
  'recurring.field.nth': T(
    'Which weeks of the month',
    '每月哪几周',
    'Những tuần nào trong tháng',
    'Minggu ke berapa dalam sebulan',
    '매월 몇째 주',
    'Quali settimane del mese',
    'Ποιες εβδομάδες του μήνα',
    'महीने के कौन से हफ़्ते',
    'ਮਹੀਨੇ ਦੇ ਕਿਹੜੇ ਹਫ਼ਤੇ',
  ),
  'recurring.field.address': T('Where', '地点', 'Ở đâu', 'Lokasi', '장소', 'Dove', 'Πού', 'कहाँ', 'ਕਿੱਥੇ'),
  'recurring.field.addressPlaceholder': T(
    'Street or place (optional)',
    '街道或地点(可选)',
    'Đường hoặc địa điểm (không bắt buộc)',
    'Jalan atau tempat (opsional)',
    '도로 또는 장소 (선택)',
    'Via o luogo (facoltativo)',
    'Οδός ή μέρος (προαιρετικό)',
    'सड़क या जगह (वैकल्पिक)',
    'ਸੜਕ ਜਾਂ ਥਾਂ (ਵਿਕਲਪਿਕ)',
  ),
  'recurring.field.remind': T(
    'Remind me',
    '提醒我',
    'Nhắc tôi',
    'Ingatkan saya',
    '알림 시간',
    'Ricordamelo',
    'Υπενθύμισέ μου',
    'मुझे याद दिलाएँ',
    'ਮੈਨੂੰ ਯਾਦ ਕਰਾਓ',
  ),
  'recurring.field.push': T(
    'Notify me on this phone',
    '在这部手机上通知我',
    'Thông báo cho tôi trên điện thoại này',
    'Beri tahu saya di ponsel ini',
    '이 휴대폰에서 알림 받기',
    'Avvisami su questo telefono',
    'Ειδοποίησέ με σε αυτό το κινητό',
    'इस फ़ोन पर मुझे सूचना दें',
    "ਇਸ ਫ਼ੋਨ 'ਤੇ ਮੈਨੂੰ ਸੂਚਨਾ ਦਿਓ",
  ),
  'recurring.frequency.weekly': T(
    'Every week',
    '每周',
    'Hằng tuần',
    'Setiap minggu',
    '매주',
    'Ogni settimana',
    'Κάθε εβδομάδα',
    'हर हफ़्ते',
    'ਹਰ ਹਫ਼ਤੇ',
  ),
  'recurring.frequency.fortnightly': T(
    'Every second week',
    '每两周',
    'Hai tuần một lần',
    'Setiap dua minggu',
    '격주',
    'Ogni due settimane',
    'Κάθε δύο εβδομάδες',
    'हर दूसरे हफ़्ते',
    'ਹਰ ਦੂਜੇ ਹਫ਼ਤੇ',
  ),
  'recurring.frequency.monthly_nth': T(
    'Some weeks of the month',
    '每月某几周',
    'Một số tuần trong tháng',
    'Minggu tertentu tiap bulan',
    '매월 특정 주',
    'Alcune settimane del mese',
    'Ορισμένες εβδομάδες του μήνα',
    'महीने के कुछ हफ़्ते',
    'ਮਹੀਨੇ ਦੇ ਕੁਝ ਹਫ਼ਤੇ',
  ),
  'recurring.remind.evening': T(
    'The evening before, at',
    '前一天晚上,时间',
    'Tối hôm trước, lúc',
    'Malam sebelumnya, pukul',
    '전날 저녁, 시간',
    'La sera prima, alle',
    'Το προηγούμενο βράδυ, στις',
    'एक दिन पहले शाम को, समय',
    'ਇੱਕ ਦਿਨ ਪਹਿਲਾਂ ਸ਼ਾਮ ਨੂੰ, ਸਮਾਂ',
  ),
  'recurring.remind.before': T(
    'Before it starts',
    '开始前',
    'Trước khi bắt đầu',
    'Sebelum dimulai',
    '시작 전',
    'Prima che inizi',
    'Πριν αρχίσει',
    'शुरू होने से पहले',
    'ਸ਼ੁਰੂ ਹੋਣ ਤੋਂ ਪਹਿਲਾਂ',
  ),
  'recurring.remind.minutes_one': T(
    '{{count}} minute before',
    '提前 {{count}} 分钟',
    'Trước {{count}} phút',
    '{{count}} menit sebelumnya',
    '{{count}}분 전',
    '{{count}} minuto prima',
    '{{count}} λεπτό πριν',
    '{{count}} मिनट पहले',
    '{{count}} ਮਿੰਟ ਪਹਿਲਾਂ',
  ),
  'recurring.remind.minutes_other': T(
    '{{count}} minutes before',
    '提前 {{count}} 分钟',
    'Trước {{count}} phút',
    '{{count}} menit sebelumnya',
    '{{count}}분 전',
    '{{count}} minuti prima',
    '{{count}} λεπτά πριν',
    '{{count}} मिनट पहले',
    '{{count}} ਮਿੰਟ ਪਹਿਲਾਂ',
  ),
  'recurring.remind.hours_one': T(
    '{{count}} hour before',
    '提前 {{count}} 小时',
    'Trước {{count}} giờ',
    '{{count}} jam sebelumnya',
    '{{count}}시간 전',
    '{{count}} ora prima',
    '{{count}} ώρα πριν',
    '{{count}} घंटा पहले',
    '{{count}} ਘੰਟਾ ਪਹਿਲਾਂ',
  ),
  'recurring.remind.hours_other': T(
    '{{count}} hours before',
    '提前 {{count}} 小时',
    'Trước {{count}} giờ',
    '{{count}} jam sebelumnya',
    '{{count}}시간 전',
    '{{count}} ore prima',
    '{{count}} ώρες πριν',
    '{{count}} घंटे पहले',
    '{{count}} ਘੰਟੇ ਪਹਿਲਾਂ',
  ),
  'recurring.pushHint': T(
    'For the most reliable reminder, add it to your calendar too.',
    '想要最可靠的提醒,也请把它加到你的日历里。',
    'Để được nhắc chắc chắn nhất, hãy thêm vào lịch của bạn nữa.',
    'Supaya pengingatnya paling andal, tambahkan juga ke kalendermu.',
    '가장 확실하게 알림을 받으려면 캘린더에도 추가하세요.',
    'Per il promemoria più affidabile, aggiungilo anche al calendario.',
    'Για την πιο αξιόπιστη υπενθύμιση, πρόσθεσέ τη και στο ημερολόγιό σου.',
    'सबसे भरोसेमंद रिमाइंडर के लिए इसे अपने कैलेंडर में भी जोड़ें।',
    'ਸਭ ਤੋਂ ਭਰੋਸੇਮੰਦ ਰਿਮਾਈਂਡਰ ਲਈ ਇਸ ਨੂੰ ਆਪਣੇ ਕੈਲੰਡਰ ਵਿੱਚ ਵੀ ਜੋੜੋ।',
  ),
  // {{place}} is recurring.zone.* for the rule's time zone ("Melbourne"), or a short zone name ("GMT+1").
  'recurring.zoneNote': T(
    'Days and times are local time in {{place}}.',
    '日期和时间均为{{place}}当地时间。',
    'Ngày và giờ theo giờ địa phương tại {{place}}.',
    'Hari dan jam mengikuti waktu setempat di {{place}}.',
    '요일과 시간은 {{place}} 현지 시간 기준입니다.',
    "Giorni e orari sono nell'ora locale di {{place}}.",
    'Οι μέρες και οι ώρες είναι σε τοπική ώρα ({{place}}).',
    'दिन और समय {{place}} के स्थानीय समय के हिसाब से हैं।',
    'ਦਿਨ ਅਤੇ ਸਮਾਂ {{place}} ਦੇ ਸਥਾਨਕ ਸਮੇਂ ਮੁਤਾਬਕ ਹਨ।',
  ),
  // The places of Australia's time zones, for zoneNote.
  'recurring.zone.melbourne': T('Melbourne', '墨尔本', 'Melbourne', 'Melbourne', '멜버른', 'Melbourne', 'Μελβούρνη', 'मेलबर्न', 'ਮੈਲਬੌਰਨ'),
  'recurring.zone.sydney': T('Sydney', '悉尼', 'Sydney', 'Sydney', '시드니', 'Sydney', 'Σίδνεϊ', 'सिडनी', 'ਸਿਡਨੀ'),
  'recurring.zone.canberra': T('Canberra', '堪培拉', 'Canberra', 'Canberra', '캔버라', 'Canberra', 'Καμπέρα', 'कैनबरा', 'ਕੈਨਬਰਾ'),
  'recurring.zone.brisbane': T('Brisbane', '布里斯班', 'Brisbane', 'Brisbane', '브리즈번', 'Brisbane', 'Μπρισμπέιν', 'ब्रिस्बेन', 'ਬ੍ਰਿਸਬੇਨ'),
  'recurring.zone.lindeman': T(
    'Lindeman Island',
    '林德曼岛',
    'đảo Lindeman',
    'Pulau Lindeman',
    '린드먼섬',
    'Lindeman',
    'Νήσος Λίντεμαν',
    'लिंडमैन द्वीप',
    'ਲਿੰਡਮੈਨ ਟਾਪੂ',
  ),
  'recurring.zone.adelaide': T('Adelaide', '阿德莱德', 'Adelaide', 'Adelaide', '애들레이드', 'Adelaide', 'Αδελαΐδα', 'एडिलेड', 'ਐਡੀਲੇਡ'),
  'recurring.zone.brokenHill': T('Broken Hill', '布罗肯希尔', 'Broken Hill', 'Broken Hill', '브로큰힐', 'Broken Hill', 'Μπρόκεν Χιλ', 'ब्रोकन हिल', 'ਬ੍ਰੋਕਨ ਹਿੱਲ'),
  'recurring.zone.darwin': T('Darwin', '达尔文', 'Darwin', 'Darwin', '다윈', 'Darwin', 'Ντάργουιν', 'डार्विन', 'ਡਾਰਵਿਨ'),
  'recurring.zone.perth': T('Perth', '珀斯', 'Perth', 'Perth', '퍼스', 'Perth', 'Περθ', 'पर्थ', 'ਪਰਥ'),
  'recurring.zone.eucla': T('Eucla', '尤克拉', 'Eucla', 'Eucla', '유클라', 'Eucla', 'Γιούκλα', 'यूक्ला', 'ਯੂਕਲਾ'),
  'recurring.zone.hobart': T('Hobart', '霍巴特', 'Hobart', 'Hobart', '호바트', 'Hobart', 'Χόμπαρτ', 'होबार्ट', 'ਹੋਬਾਰਟ'),
  'recurring.zone.lordHowe': T(
    'Lord Howe Island',
    '豪勋爵岛',
    'đảo Lord Howe',
    'Pulau Lord Howe',
    '로드하우섬',
    'Lord Howe',
    'Νήσος Λορντ Χάου',
    'लॉर्ड होवे द्वीप',
    'ਲਾਰਡ ਹੋਵ ਟਾਪੂ',
  ),
  // ── Words that build schedule lines ──
  'recurring.days.MO': T('Monday', '星期一', 'Thứ Hai', 'Senin', '월요일', 'lunedì', 'Δευτέρα', 'सोमवार', 'ਸੋਮਵਾਰ'),
  'recurring.days.TU': T('Tuesday', '星期二', 'Thứ Ba', 'Selasa', '화요일', 'martedì', 'Τρίτη', 'मंगलवार', 'ਮੰਗਲਵਾਰ'),
  'recurring.days.WE': T('Wednesday', '星期三', 'Thứ Tư', 'Rabu', '수요일', 'mercoledì', 'Τετάρτη', 'बुधवार', 'ਬੁੱਧਵਾਰ'),
  'recurring.days.TH': T('Thursday', '星期四', 'Thứ Năm', 'Kamis', '목요일', 'giovedì', 'Πέμπτη', 'गुरुवार', 'ਵੀਰਵਾਰ'),
  'recurring.days.FR': T('Friday', '星期五', 'Thứ Sáu', 'Jumat', '금요일', 'venerdì', 'Παρασκευή', 'शुक्रवार', 'ਸ਼ੁੱਕਰਵਾਰ'),
  'recurring.days.SA': T('Saturday', '星期六', 'Thứ Bảy', 'Sabtu', '토요일', 'sabato', 'Σάββατο', 'शनिवार', 'ਸ਼ਨੀਵਾਰ'),
  'recurring.days.SU': T('Sunday', '星期日', 'Chủ Nhật', 'Minggu', '일요일', 'domenica', 'Κυριακή', 'रविवार', 'ਐਤਵਾਰ'),
  'recurring.daysShort.MO': T('Mon', '周一', 'T2', 'Sen', '월', 'lun', 'Δευ', 'सोम', 'ਸੋਮ'),
  'recurring.daysShort.TU': T('Tue', '周二', 'T3', 'Sel', '화', 'mar', 'Τρί', 'मंगल', 'ਮੰਗਲ'),
  'recurring.daysShort.WE': T('Wed', '周三', 'T4', 'Rab', '수', 'mer', 'Τετ', 'बुध', 'ਬੁੱਧ'),
  'recurring.daysShort.TH': T('Thu', '周四', 'T5', 'Kam', '목', 'gio', 'Πέμ', 'गुरु', 'ਵੀਰ'),
  'recurring.daysShort.FR': T('Fri', '周五', 'T6', 'Jum', '금', 'ven', 'Παρ', 'शुक्र', 'ਸ਼ੁੱਕਰ'),
  'recurring.daysShort.SA': T('Sat', '周六', 'T7', 'Sab', '토', 'sab', 'Σάβ', 'शनि', 'ਸ਼ਨੀ'),
  'recurring.daysShort.SU': T('Sun', '周日', 'CN', 'Min', '일', 'dom', 'Κυρ', 'रवि', 'ਐਤ'),
  // Three or more days in a row: "Monday to Friday".
  'recurring.dayRange': T(
    '{{from}} to {{to}}',
    '{{from}}至{{to}}',
    '{{from}} đến {{to}}',
    '{{from}} sampai {{to}}',
    '{{from}}~{{to}}',
    'da {{from}} a {{to}}',
    '{{from}} έως {{to}}',
    '{{from}} से {{to}}',
    '{{from}} ਤੋਂ {{to}}',
  ),
  // Which of the month's weekdays: "the 1st and 3rd Tuesday". In it and el
  // the ordinal agrees with "week" (settimana, εβδομάδα, both feminine)
  // rather than with the day, whose gender varies (domenica, Σάββατο):
  // see schedule.monthly_nth, and the editor's "Which weeks of the month".
  'recurring.nth.n1': T('1st', '第一个', 'thứ nhất', 'pertama', '첫째', '1ª', '1η', 'पहला', 'ਪਹਿਲਾ'),
  'recurring.nth.n2': T('2nd', '第二个', 'thứ hai', 'kedua', '둘째', '2ª', '2η', 'दूसरा', 'ਦੂਜਾ'),
  'recurring.nth.n3': T('3rd', '第三个', 'thứ ba', 'ketiga', '셋째', '3ª', '3η', 'तीसरा', 'ਤੀਜਾ'),
  'recurring.nth.n4': T('4th', '第四个', 'thứ tư', 'keempat', '넷째', '4ª', '4η', 'चौथा', 'ਚੌਥਾ'),
  'recurring.nth.n5': T('5th', '第五个', 'thứ năm', 'kelima', '다섯째', '5ª', '5η', 'पाँचवाँ', 'ਪੰਜਵਾਂ'),
  // {{days}} is one day, "Monday to Friday", or a list ("Monday and Thursday").
  'recurring.schedule.weekly': T(
    'Every week on {{days}}',
    '每周{{days}}',
    'Hằng tuần vào {{days}}',
    'Setiap minggu pada hari {{days}}',
    '매주 {{days}}',
    'Ogni settimana: {{days}}',
    'Κάθε εβδομάδα: {{days}}',
    'हर हफ़्ते {{days}} को',
    'ਹਰ ਹਫ਼ਤੇ {{days}} ਨੂੰ',
  ),
  'recurring.schedule.fortnightly': T(
    'Every second week on {{days}}',
    '每两周{{days}}',
    'Hai tuần một lần vào {{days}}',
    'Setiap dua minggu pada hari {{days}}',
    '격주 {{days}}',
    'Ogni due settimane: {{days}}',
    'Κάθε δύο εβδομάδες: {{days}}',
    'हर दूसरे हफ़्ते {{days}} को',
    'ਹਰ ਦੂਜੇ ਹਫ਼ਤੇ {{days}} ਨੂੰ',
  ),
  // {{nths}} is a list of ordinals ("1st and 3rd").
  'recurring.schedule.monthly_nth': T(
    'The {{nths}} {{days}} of each month',
    '每月{{nths}}{{days}}',
    '{{days}} {{nths}} của mỗi tháng',
    'Hari {{days}} {{nths}} setiap bulan',
    '매월 {{nths}} {{days}}',
    'Ogni mese, {{nths}} settimana: {{days}}',
    'Κάθε μήνα, {{nths}} εβδομάδα: {{days}}',
    'हर महीने का {{nths}} {{days}}',
    'ਹਰ ਮਹੀਨੇ ਦਾ {{nths}} {{days}}',
  ),
  // {{start}} and {{end}} are "7" and "9 am" (one am/pm when both share it), or "11 am" and "1 pm".
  'recurring.timeRange': T(
    '{{start}} to {{end}}',
    '{{start}} 至 {{end}}',
    '{{start}} đến {{end}}',
    '{{start}} sampai {{end}}',
    '{{start}}~{{end}}',
    'dalle {{start}} alle {{end}}',
    '{{start}} έως {{end}}',
    '{{start}} से {{end}} तक',
    '{{start}} ਤੋਂ {{end}} ਤੱਕ',
  ),
  'recurring.summary': T(
    '{{schedule}}, {{range}}',
    '{{schedule}},{{range}}',
    '{{schedule}}, {{range}}',
    '{{schedule}}, {{range}}',
    '{{schedule}}, {{range}}',
    '{{schedule}}, {{range}}',
    '{{schedule}}, {{range}}',
    '{{schedule}}, {{range}}',
    '{{schedule}}, {{range}}',
  ),
  // ── A rule's status line in the list ──
  'recurring.next': T(
    'Next: {{time}}',
    '下一次:{{time}}',
    'Lần tới: {{time}}',
    'Berikutnya: {{time}}',
    '다음: {{time}}',
    'Prossimo: {{time}}',
    'Επόμενο: {{time}}',
    'अगला: {{time}}',
    'ਅਗਲਾ: {{time}}',
  ),
  'recurring.onNow': T(
    'On now, until {{time}}',
    '正在进行,到 {{time}} 结束',
    'Đang diễn ra, đến {{time}}',
    'Sedang berlaku, sampai {{time}}',
    '진행 중, {{time}}까지',
    'In corso, fino alle {{time}}',
    'Σε ισχύ τώρα, έως τις {{time}}',
    'अभी लागू, {{time}} तक',
    'ਹੁਣ ਲਾਗੂ, {{time}} ਤੱਕ',
  ),
  'recurring.paused': T('Paused', '已暂停', 'Đã tạm dừng', 'Dijeda', '일시 중지됨', 'In pausa', 'Σε παύση', 'रोका गया', 'ਰੋਕਿਆ ਗਿਆ'),
  'recurring.noNext': T(
    'No upcoming dates',
    '没有即将到来的日期',
    'Không có ngày sắp tới',
    'Tidak ada tanggal mendatang',
    '예정된 날짜 없음',
    'Nessuna data in arrivo',
    'Δεν υπάρχουν επόμενες ημερομηνίες',
    'आगे कोई तारीख़ नहीं',
    'ਅੱਗੇ ਕੋਈ ਤਾਰੀਖ਼ ਨਹੀਂ',
  ),
  'recurring.pause': T('Pause', '暂停', 'Tạm dừng', 'Jeda', '일시 중지', 'Metti in pausa', 'Παύση', 'रोकें', 'ਰੋਕੋ'),
  'recurring.resume': T('Resume', '恢复', 'Tiếp tục', 'Lanjutkan', '다시 시작', 'Riprendi', 'Συνέχιση', 'फिर से शुरू करें', 'ਮੁੜ ਸ਼ੁਰੂ ਕਰੋ'),
  'recurring.pausedHint': T(
    "Paused reminders don't alert you here. A calendar you added it to keeps its own alarms.",
    '已暂停的提醒不会在这里提醒你。已加到日历里的那份会保留自己的闹钟。',
    'Nhắc nhở đã tạm dừng sẽ không báo bạn ở đây. Lịch mà bạn đã thêm vẫn giữ báo thức của nó.',
    'Pengingat yang dijeda tidak akan memberi tahu kamu di sini. Kalender yang sudah kamu tambahkan tetap menyimpan alarmnya sendiri.',
    '일시 중지된 알림은 여기서 알려 주지 않습니다. 이미 추가한 캘린더에는 자체 알람이 남아 있습니다.',
    "I promemoria in pausa non ti avvisano qui. Un calendario a cui l'hai aggiunto mantiene i suoi avvisi.",
    'Οι υπενθυμίσεις σε παύση δεν σε ειδοποιούν εδώ. Ένα ημερολόγιο όπου την πρόσθεσες κρατά τις δικές του ειδοποιήσεις.',
    'रोके गए रिमाइंडर यहाँ से सूचना नहीं देंगे। जिस कैलेंडर में आपने इसे जोड़ा है, उसमें उसके अपने अलार्म बने रहेंगे।',
    'ਰੋਕੇ ਗਏ ਰਿਮਾਈਂਡਰ ਇੱਥੋਂ ਸੂਚਨਾ ਨਹੀਂ ਦੇਣਗੇ। ਜਿਸ ਕੈਲੰਡਰ ਵਿੱਚ ਤੁਸੀਂ ਇਸ ਨੂੰ ਜੋੜਿਆ ਹੈ, ਉਸ ਵਿੱਚ ਉਸਦੇ ਆਪਣੇ ਅਲਾਰਮ ਰਹਿਣਗੇ।',
  ),
  'recurring.delete': T(
    'Delete reminder',
    '删除提醒',
    'Xóa nhắc nhở',
    'Hapus pengingat',
    '알림 삭제',
    'Elimina promemoria',
    'Διαγραφή υπενθύμισης',
    'रिमाइंडर हटाएँ',
    'ਰਿਮਾਈਂਡਰ ਮਿਟਾਓ',
  ),
  'recurring.deleteConfirm': T(
    'Delete this weekly reminder? A calendar you added it to keeps its copy.',
    '删除这个每周提醒?已加到日历里的那份会保留。',
    'Xóa nhắc nhở hằng tuần này? Lịch mà bạn đã thêm vẫn giữ bản của nó.',
    'Hapus pengingat mingguan ini? Kalender yang sudah kamu tambahkan tetap menyimpan salinannya.',
    '이 매주 알림을 삭제할까요? 이미 추가한 캘린더에는 사본이 남습니다.',
    "Eliminare questo promemoria settimanale? Un calendario a cui l'hai aggiunto ne conserva la copia.",
    'Να διαγραφεί αυτή η εβδομαδιαία υπενθύμιση; Ένα ημερολόγιο όπου την πρόσθεσες κρατά το αντίγραφό του.',
    'यह साप्ताहिक रिमाइंडर हटाएँ? जिस कैलेंडर में आपने इसे जोड़ा है, उसमें इसकी कॉपी बनी रहेगी।',
    'ਇਹ ਹਫ਼ਤਾਵਾਰੀ ਰਿਮਾਈਂਡਰ ਮਿਟਾਉਣਾ ਹੈ? ਜਿਸ ਕੈਲੰਡਰ ਵਿੱਚ ਤੁਸੀਂ ਇਸ ਨੂੰ ਜੋੜਿਆ ਹੈ, ਉਸ ਵਿੱਚ ਇਸਦੀ ਕਾਪੀ ਰਹੇਗੀ।',
  ),
  'recurring.calendar': T(
    'Add to calendar',
    '添加到日历',
    'Thêm vào lịch',
    'Tambah ke kalender',
    '캘린더에 추가',
    'Aggiungi al calendario',
    'Προσθήκη στο ημερολόγιο',
    'कैलेंडर में जोड़ें',
    'ਕੈਲੰਡਰ ਵਿੱਚ ਜੋੜੋ',
  ),
  'recurring.calendarDone': T(
    'Downloaded. Open the file to add it.',
    '已下载。打开文件即可添加。',
    'Đã tải xuống. Mở tệp để thêm vào.',
    'Sudah diunduh. Buka file untuk menambahkannya.',
    '다운로드했습니다. 파일을 열어 추가하세요.',
    'Scaricato. Apri il file per aggiungerlo.',
    'Λήφθηκε. Άνοιξε το αρχείο για να το προσθέσεις.',
    'डाउनलोड हो गया। जोड़ने के लिए फ़ाइल खोलें।',
    'ਡਾਊਨਲੋਡ ਹੋ ਗਿਆ। ਜੋੜਨ ਲਈ ਫ਼ਾਈਲ ਖੋਲ੍ਹੋ।',
  ),
  'recurring.saved': T(
    'Weekly reminder saved.',
    '每周提醒已保存。',
    'Đã lưu nhắc nhở hằng tuần.',
    'Pengingat mingguan disimpan.',
    '매주 알림을 저장했습니다.',
    'Promemoria settimanale salvato.',
    'Η εβδομαδιαία υπενθύμιση αποθηκεύτηκε.',
    'साप्ताहिक रिमाइंडर सेव हो गया।',
    'ਹਫ਼ਤਾਵਾਰੀ ਰਿਮਾਈਂਡਰ ਸੇਵ ਹੋ ਗਿਆ।',
  ),
  // ── Editor problems ──
  'recurring.errors.days': T(
    'Pick at least one day.',
    '请至少选一天。',
    'Hãy chọn ít nhất một ngày.',
    'Pilih setidaknya satu hari.',
    '요일을 하나 이상 고르세요.',
    'Scegli almeno un giorno.',
    'Διάλεξε τουλάχιστον μία μέρα.',
    'कम से कम एक दिन चुनें।',
    'ਘੱਟੋ-ਘੱਟ ਇੱਕ ਦਿਨ ਚੁਣੋ।',
  ),
  'recurring.errors.times': T(
    'Pick a start and an end time that differ.',
    '请选择不同的开始和结束时间。',
    'Hãy chọn giờ bắt đầu và giờ kết thúc khác nhau.',
    'Pilih jam mulai dan jam selesai yang berbeda.',
    '서로 다른 시작 시간과 종료 시간을 고르세요.',
    'Scegli un orario di inizio e uno di fine diversi.',
    'Διάλεξε διαφορετική ώρα έναρξης και λήξης.',
    'शुरू और ख़त्म होने का अलग-अलग समय चुनें।',
    'ਸ਼ੁਰੂ ਅਤੇ ਖ਼ਤਮ ਹੋਣ ਦਾ ਵੱਖਰਾ ਸਮਾਂ ਚੁਣੋ।',
  ),
  'recurring.errors.nth': T(
    'Pick at least one week of the month.',
    '请至少选每月的一周。',
    'Hãy chọn ít nhất một tuần trong tháng.',
    'Pilih setidaknya satu minggu dalam sebulan.',
    '매월 주를 하나 이상 고르세요.',
    'Scegli almeno una settimana del mese.',
    'Διάλεξε τουλάχιστον μία εβδομάδα του μήνα.',
    'महीने का कम से कम एक हफ़्ता चुनें।',
    'ਮਹੀਨੇ ਦਾ ਘੱਟੋ-ਘੱਟ ਇੱਕ ਹਫ਼ਤਾ ਚੁਣੋ।',
  ),
  'recurring.errors.anchor': T(
    'Pick the date of the next one.',
    '请选择下一次的日期。',
    'Hãy chọn ngày của lần tới.',
    'Pilih tanggal berikutnya.',
    '다음 날짜를 고르세요.',
    'Scegli la data della prossima volta.',
    'Διάλεξε την ημερομηνία της επόμενης.',
    'अगली बार की तारीख़ चुनें।',
    'ਅਗਲੀ ਵਾਰ ਦੀ ਤਾਰੀਖ਼ ਚੁਣੋ।',
  ),
  'recurring.errors.saveFailed': T(
    "Couldn't save this reminder. Try again.",
    '无法保存这个提醒。请再试一次。',
    'Không lưu được nhắc nhở này. Hãy thử lại.',
    'Pengingat ini tidak bisa disimpan. Coba lagi.',
    '이 알림을 저장하지 못했습니다. 다시 시도하세요.',
    'Impossibile salvare questo promemoria. Riprova.',
    'Δεν ήταν δυνατή η αποθήκευση της υπενθύμισης. Δοκίμασε ξανά.',
    'यह रिमाइंडर सेव नहीं हो सका। फिर से कोशिश करें।',
    'ਇਹ ਰਿਮਾਈਂਡਰ ਸੇਵ ਨਹੀਂ ਹੋ ਸਕਿਆ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
  ),
  // ── Notes every weekly reminder screen carries (build spec T5a item 5) ──
  'recurring.councilNote': T(
    'Councils change these schedules, and public holidays may be different. Check the signs where you park.',
    '市议会会调整这些时间安排,公众假期也可能不同。请留意你停车处的标志。',
    'Hội đồng có thể thay đổi các lịch này, và ngày lễ có thể khác. Hãy xem biển báo nơi bạn đỗ xe.',
    'Dewan kota bisa mengubah jadwal ini, dan hari libur nasional bisa berbeda. Periksa rambu di tempat kamu parkir.',
    '의회는 이 일정을 바꿀 수 있으며, 공휴일에는 다를 수 있습니다. 주차하는 곳의 표지판을 확인하세요.',
    'I comuni cambiano questi orari e nei giorni festivi possono essere diversi. Controlla i cartelli dove parcheggi.',
    'Οι δήμοι αλλάζουν αυτά τα προγράμματα και τις αργίες μπορεί να διαφέρουν. Έλεγξε τις πινακίδες εκεί που παρκάρεις.',
    'परिषदें ये समय बदलती रहती हैं, और सार्वजनिक छुट्टियों पर ये अलग हो सकते हैं। जहाँ पार्क करें, वहाँ के साइन देख लें।',
    "ਕੌਂਸਲਾਂ ਇਹ ਸਮਾਂ-ਸਾਰਣੀਆਂ ਬਦਲਦੀਆਂ ਰਹਿੰਦੀਆਂ ਹਨ, ਅਤੇ ਜਨਤਕ ਛੁੱਟੀਆਂ 'ਤੇ ਇਹ ਵੱਖਰੀਆਂ ਹੋ ਸਕਦੀਆਂ ਹਨ। ਜਿੱਥੇ ਪਾਰਕ ਕਰੋ, ਉੱਥੇ ਦੇ ਚਿੰਨ੍ਹ ਦੇਖ ਲਓ।",
  ),
  'recurring.notifyDenied': T(
    "Notifications are blocked for ParkProof, so these reminders can't alert you on this phone. Allow notifications in your browser's site settings, or add them to your calendar.",
    'ParkProof 的通知已被阻止,这些提醒无法在这部手机上通知你。请在浏览器的网站设置中允许通知,或把它们加到你的日历里。',
    'Thông báo của ParkProof đang bị chặn, nên các nhắc nhở này không thể báo bạn trên điện thoại này. Hãy cho phép thông báo trong cài đặt trang web của trình duyệt, hoặc thêm chúng vào lịch.',
    'Notifikasi untuk ParkProof diblokir, jadi pengingat ini tidak bisa memberi tahu kamu di ponsel ini. Izinkan notifikasi di pengaturan situs browsermu, atau tambahkan ke kalendermu.',
    'ParkProof 알림이 차단되어 이 휴대폰에서 알려 드릴 수 없습니다. 브라우저의 사이트 설정에서 알림을 허용하거나 캘린더에 추가하세요.',
    'Le notifiche di ParkProof sono bloccate, quindi questi promemoria non possono avvisarti su questo telefono. Consenti le notifiche nelle impostazioni del sito del browser, oppure aggiungili al calendario.',
    'Οι ειδοποιήσεις του ParkProof είναι αποκλεισμένες, οπότε αυτές οι υπενθυμίσεις δεν μπορούν να σε ειδοποιήσουν σε αυτό το κινητό. Επίτρεψε τις ειδοποιήσεις στις ρυθμίσεις ιστότοπου του προγράμματος περιήγησης ή πρόσθεσέ τες στο ημερολόγιό σου.',
    'ParkProof की सूचनाएँ ब्लॉक हैं, इसलिए ये रिमाइंडर इस फ़ोन पर सूचना नहीं दे सकते। ब्राउज़र की साइट सेटिंग में सूचनाएँ चालू करें, या इन्हें अपने कैलेंडर में जोड़ें।',
    "ParkProof ਦੀਆਂ ਸੂਚਨਾਵਾਂ ਬਲੌਕ ਹਨ, ਇਸ ਲਈ ਇਹ ਰਿਮਾਈਂਡਰ ਇਸ ਫ਼ੋਨ 'ਤੇ ਸੂਚਨਾ ਨਹੀਂ ਦੇ ਸਕਦੇ। ਬ੍ਰਾਊਜ਼ਰ ਦੀਆਂ ਸਾਈਟ ਸੈਟਿੰਗਾਂ ਵਿੱਚ ਸੂਚਨਾਵਾਂ ਚਾਲੂ ਕਰੋ, ਜਾਂ ਇਨ੍ਹਾਂ ਨੂੰ ਆਪਣੇ ਕੈਲੰਡਰ ਵਿੱਚ ਜੋੜੋ।",
  ),
  // ── T5b: what a rule's reminders can do on this phone (the list) ──
  // Booked with the server: alerts with the app closed. The server's
  // schedules and the phone's registration end 90 days after the phone last
  // booked them, and opening the app books them again, hence the second
  // sentence (two months leaves a margin).
  'recurring.pushStatus.closed': T(
    'Set to alert this phone even when ParkProof is closed. Open ParkProof at least once every two months to keep it set.',
    '已设置为即使 ParkProof 关闭,也会在这部手机上提醒你。请至少每两个月打开一次 ParkProof,让它保持有效。',
    'Đã đặt để nhắc trên điện thoại này ngay cả khi ParkProof đang đóng. Hãy mở ParkProof ít nhất hai tháng một lần để giữ cài đặt này.',
    'Diatur untuk mengingatkanmu di ponsel ini meskipun ParkProof sedang ditutup. Buka ParkProof setidaknya sekali setiap dua bulan agar tetap aktif.',
    'ParkProof가 닫혀 있어도 이 휴대폰에서 알림을 받도록 설정되었습니다. 계속 유지하려면 적어도 두 달에 한 번은 ParkProof를 여세요.',
    'Impostato per avvisarti su questo telefono anche quando ParkProof è chiuso. Apri ParkProof almeno una volta ogni due mesi per mantenerlo attivo.',
    'Ρυθμίστηκε να σε ειδοποιεί σε αυτό το κινητό ακόμα και όταν το ParkProof είναι κλειστό. Άνοιξε το ParkProof τουλάχιστον μία φορά κάθε δύο μήνες για να μείνει ενεργό.',
    'ParkProof बंद होने पर भी इस फ़ोन पर सूचना देने के लिए सेट है। इसे चालू रखने के लिए कम से कम हर दो महीने में एक बार ParkProof खोलें।',
    "ParkProof ਬੰਦ ਹੋਣ 'ਤੇ ਵੀ ਇਸ ਫ਼ੋਨ 'ਤੇ ਸੂਚਨਾ ਦੇਣ ਲਈ ਸੈੱਟ ਹੈ। ਇਸ ਨੂੰ ਚਾਲੂ ਰੱਖਣ ਲਈ ਘੱਟੋ-ਘੱਟ ਹਰ ਦੋ ਮਹੀਨਿਆਂ ਵਿੱਚ ਇੱਕ ਵਾਰ ParkProof ਖੋਲ੍ਹੋ।",
  ),
  // Push can't work here (no support, no permission or offline) but this
  // browser can alert from an open tab: in-tab only.
  'recurring.pushStatus.openOnly': T(
    'Alerts this phone only while ParkProof is open. Add it to your calendar too.',
    '只有在 ParkProof 打开时才会在这部手机上提醒你。也请把它加到你的日历里。',
    'Chỉ nhắc trên điện thoại này khi ParkProof đang mở. Hãy thêm vào lịch của bạn nữa.',
    'Hanya mengingatkanmu di ponsel ini saat ParkProof terbuka. Tambahkan juga ke kalendermu.',
    'ParkProof가 열려 있을 때만 이 휴대폰에서 알림을 받습니다. 캘린더에도 추가하세요.',
    'Ti avvisa su questo telefono solo mentre ParkProof è aperto. Aggiungilo anche al calendario.',
    'Σε ειδοποιεί σε αυτό το κινητό μόνο όσο το ParkProof είναι ανοιχτό. Πρόσθεσέ το και στο ημερολόγιό σου.',
    'ParkProof खुला होने पर ही इस फ़ोन पर सूचना मिलेगी। इसे अपने कैलेंडर में भी जोड़ें।',
    "ParkProof ਖੁੱਲ੍ਹਾ ਹੋਣ 'ਤੇ ਹੀ ਇਸ ਫ਼ੋਨ 'ਤੇ ਸੂਚਨਾ ਮਿਲੇਗੀ। ਇਸ ਨੂੰ ਆਪਣੇ ਕੈਲੰਡਰ ਵਿੱਚ ਵੀ ਜੋੜੋ।",
  ),
  // Nothing on this phone can alert for the rule right now: no notification
  // support (iPhone Safari outside the Home Screen app), permission not
  // given, or Android (no in-tab alerts) before push is booked.
  'recurring.pushStatus.none': T(
    "This phone can't show this reminder right now. Add it to your calendar.",
    '这部手机目前无法显示这个提醒。请把它加到你的日历里。',
    'Điện thoại này hiện chưa thể báo nhắc nhở này. Hãy thêm vào lịch của bạn.',
    'Ponsel ini belum bisa menampilkan pengingat ini. Tambahkan ke kalendermu.',
    '지금은 이 휴대폰에서 이 알림을 표시할 수 없습니다. 캘린더에 추가하세요.',
    'Al momento questo telefono non può mostrare questo promemoria. Aggiungilo al calendario.',
    'Αυτό το κινητό δεν μπορεί να εμφανίσει αυτή την υπενθύμιση αυτή τη στιγμή. Πρόσθεσέ τη στο ημερολόγιό σου.',
    'यह फ़ोन अभी यह रिमाइंडर नहीं दिखा सकता। इसे अपने कैलेंडर में जोड़ें।',
    'ਇਹ ਫ਼ੋਨ ਹਾਲੇ ਇਹ ਰਿਮਾਈਂਡਰ ਨਹੀਂ ਦਿਖਾ ਸਕਦਾ। ਇਸ ਨੂੰ ਆਪਣੇ ਕੈਲੰਡਰ ਵਿੱਚ ਜੋੜੋ।',
  ),
  // ── The remind screen's card and sheet ──
  'recurring.offer.heading': T(
    'Weekly restriction on this sign',
    '这个标志有每周重复的限制',
    'Biển báo này có hạn chế lặp lại hằng tuần',
    'Rambu ini punya larangan mingguan',
    '이 표지판에 매주 반복되는 제한이 있습니다',
    'Divieto settimanale su questo cartello',
    'Εβδομαδιαίος περιορισμός σε αυτή την πινακίδα',
    'इस साइन पर साप्ताहिक पाबंदी है',
    "ਇਸ ਚਿੰਨ੍ਹ 'ਤੇ ਹਫ਼ਤਾਵਾਰੀ ਪਾਬੰਦੀ ਹੈ",
  ),
  'recurring.offer.body': T(
    'ParkProof can remind you before it starts each time.',
    'ParkProof 可以在每次开始前提醒你。',
    'ParkProof có thể nhắc bạn trước mỗi lần bắt đầu.',
    'ParkProof bisa mengingatkanmu setiap kali sebelum dimulai.',
    'ParkProof가 매번 시작 전에 알려 드릴 수 있습니다.',
    'ParkProof può ricordartelo prima che inizi, ogni volta.',
    'Το ParkProof μπορεί να σου το υπενθυμίζει πριν αρχίσει κάθε φορά.',
    'ParkProof हर बार शुरू होने से पहले आपको याद दिला सकता है।',
    'ParkProof ਹਰ ਵਾਰ ਸ਼ੁਰੂ ਹੋਣ ਤੋਂ ਪਹਿਲਾਂ ਤੁਹਾਨੂੰ ਯਾਦ ਕਰਾ ਸਕਦਾ ਹੈ।',
  ),
  // {{what}} "Street sweeping", {{summary}} "Every week on Tuesday, 7 to 9 am".
  'recurring.offer.line': T(
    '{{what}}. {{summary}}.',
    '{{what}}。{{summary}}。',
    '{{what}}. {{summary}}.',
    '{{what}}. {{summary}}.',
    '{{what}}. {{summary}}.',
    '{{what}}. {{summary}}.',
    '{{what}}. {{summary}}.',
    '{{what}}। {{summary}}।',
    '{{what}}। {{summary}}।',
  ),
  'recurring.offer.cta': T(
    'Remind me every week',
    '每周提醒我',
    'Nhắc tôi hằng tuần',
    'Ingatkan saya setiap minggu',
    '매주 알려 주세요',
    'Ricordamelo ogni settimana',
    'Υπενθύμισέ μου κάθε εβδομάδα',
    'मुझे हर हफ़्ते याद दिलाएँ',
    'ਮੈਨੂੰ ਹਰ ਹਫ਼ਤੇ ਯਾਦ ਕਰਾਓ',
  ),
  'recurring.offer.already': T(
    'You already have a weekly reminder for this.',
    '你已经为此设置了每周提醒。',
    'Bạn đã có nhắc nhở hằng tuần cho việc này.',
    'Kamu sudah punya pengingat mingguan untuk ini.',
    '이미 이 제한에 대한 매주 알림이 있습니다.',
    'Hai già un promemoria settimanale per questo.',
    'Έχεις ήδη εβδομαδιαία υπενθύμιση για αυτό.',
    'इसके लिए आपका साप्ताहिक रिमाइंडर पहले से है।',
    'ਇਸ ਲਈ ਤੁਹਾਡਾ ਹਫ਼ਤਾਵਾਰੀ ਰਿਮਾਈਂਡਰ ਪਹਿਲਾਂ ਹੀ ਹੈ।',
  ),
  'recurring.sheet.title': T(
    'Remind me every week',
    '每周提醒我',
    'Nhắc tôi hằng tuần',
    'Ingatkan saya setiap minggu',
    '매주 알려 주세요',
    'Ricordamelo ogni settimana',
    'Υπενθύμισέ μου κάθε εβδομάδα',
    'मुझे हर हफ़्ते याद दिलाएँ',
    'ਮੈਨੂੰ ਹਰ ਹਫ਼ਤੇ ਯਾਦ ਕਰਾਓ',
  ),
  'recurring.sheet.check': T(
    'Check these days and times against the sign',
    '请对照标志核对这些日子和时间',
    'Hãy đối chiếu những ngày và giờ này với biển báo',
    'Cocokkan hari dan jam ini dengan rambu',
    '이 요일과 시간을 표지판과 대조해 확인하세요',
    'Controlla questi giorni e orari sul cartello',
    'Έλεγξε αυτές τις μέρες και ώρες με την πινακίδα',
    'इन दिनों और समय को साइन से मिलाकर देखें',
    'ਇਨ੍ਹਾਂ ਦਿਨਾਂ ਅਤੇ ਸਮਿਆਂ ਨੂੰ ਚਿੰਨ੍ਹ ਨਾਲ ਮਿਲਾ ਕੇ ਦੇਖੋ',
  ),
  // {{text}} is what the sign prints about exceptions, as read from the photo.
  'recurring.sheet.signSays': T(
    'The sign also says: {{text}}',
    '标志上还写着:{{text}}',
    'Biển báo cũng ghi: {{text}}',
    'Rambu juga bertuliskan: {{text}}',
    '표지판에 이런 내용도 있습니다: {{text}}',
    'Il cartello dice anche: {{text}}',
    'Η πινακίδα γράφει επίσης: {{text}}',
    'साइन पर यह भी लिखा है: {{text}}',
    "ਚਿੰਨ੍ਹ 'ਤੇ ਇਹ ਵੀ ਲਿਖਿਆ ਹੈ: {{text}}",
  ),
  // ── Notifications (absolute times: a late alert stays true) ──
  // The evening before a morning restriction.
  'recurring.notify.moveTonight': T(
    '{{what}} on {{day}} {{range}}. Move the car tonight.',
    '{{what}}:{{day}} {{range}}。今晚就把车挪走。',
    '{{what}} vào {{day}}, {{range}}. Hãy dời xe ngay tối nay.',
    '{{what}} pada hari {{day}}, {{range}}. Pindahkan mobilmu malam ini.',
    '{{day}} {{range}} {{what}}. 오늘 밤에 차를 옮기세요.',
    "{{what}}: {{day}}, {{range}}. Sposta l'auto stasera.",
    '{{what}}: {{day}}, {{range}}. Μετακίνησε το αυτοκίνητο απόψε.',
    '{{what}}: {{day}}, {{range}}। आज रात ही गाड़ी हटा लें।',
    '{{what}}: {{day}}, {{range}}। ਅੱਜ ਰਾਤ ਹੀ ਗੱਡੀ ਹਟਾ ਲਓ।',
  ),
  'recurring.notify.moveBefore': T(
    '{{what}} on {{day}} {{range}}. Move the car before {{start}}.',
    '{{what}}:{{day}} {{range}}。请在 {{start}} 前把车挪走。',
    '{{what}} vào {{day}}, {{range}}. Hãy dời xe trước {{start}}.',
    '{{what}} pada hari {{day}}, {{range}}. Pindahkan mobilmu sebelum {{start}}.',
    '{{day}} {{range}} {{what}}. {{start}} 전에 차를 옮기세요.',
    "{{what}}: {{day}}, {{range}}. Sposta l'auto prima delle {{start}}.",
    '{{what}}: {{day}}, {{range}}. Μετακίνησε το αυτοκίνητο πριν από τις {{start}}.',
    '{{what}}: {{day}}, {{range}}। {{start}} से पहले गाड़ी हटा लें।',
    '{{what}}: {{day}}, {{range}}। {{start}} ਤੋਂ ਪਹਿਲਾਂ ਗੱਡੀ ਹਟਾ ਲਓ।',
  ),
  // ── The calendar file (one repeating event, so "tomorrow" not a day name) ──
  'recurring.ics.alarmTonight': T(
    '{{what}} tomorrow, {{range}}. Move the car tonight.',
    '{{what}}:明天 {{range}}。今晚就把车挪走。',
    '{{what}} vào ngày mai, {{range}}. Hãy dời xe ngay tối nay.',
    '{{what}} besok, {{range}}. Pindahkan mobilmu malam ini.',
    '내일 {{range}} {{what}}. 오늘 밤에 차를 옮기세요.',
    "{{what}}: domani, {{range}}. Sposta l'auto stasera.",
    '{{what}}: αύριο, {{range}}. Μετακίνησε το αυτοκίνητο απόψε.',
    '{{what}}: कल, {{range}}। आज रात ही गाड़ी हटा लें।',
    '{{what}}: ਕੱਲ੍ਹ, {{range}}। ਅੱਜ ਰਾਤ ਹੀ ਗੱਡੀ ਹਟਾ ਲਓ।',
  ),
  'recurring.ics.alarmTomorrow': T(
    '{{what}} tomorrow, {{range}}. Move the car before {{start}}.',
    '{{what}}:明天 {{range}}。请在 {{start}} 前把车挪走。',
    '{{what}} vào ngày mai, {{range}}. Hãy dời xe trước {{start}}.',
    '{{what}} besok, {{range}}. Pindahkan mobilmu sebelum {{start}}.',
    '내일 {{range}} {{what}}. {{start}} 전에 차를 옮기세요.',
    "{{what}}: domani, {{range}}. Sposta l'auto prima delle {{start}}.",
    '{{what}}: αύριο, {{range}}. Μετακίνησε το αυτοκίνητο πριν από τις {{start}}.',
    '{{what}}: कल, {{range}}। {{start}} से पहले गाड़ी हटा लें।',
    '{{what}}: ਕੱਲ੍ਹ, {{range}}। {{start}} ਤੋਂ ਪਹਿਲਾਂ ਗੱਡੀ ਹਟਾ ਲਓ।',
  ),
  'recurring.ics.alarmSoon': T(
    '{{what}} starts at {{start}}. Move the car before then.',
    '{{what}}将于 {{start}} 开始。请在那之前把车挪走。',
    '{{what}} bắt đầu lúc {{start}}. Hãy dời xe trước giờ đó.',
    '{{what}} mulai pukul {{start}}. Pindahkan mobilmu sebelum itu.',
    '{{what}} 시작: {{start}}. 그 전에 차를 옮기세요.',
    "{{what}} inizia alle {{start}}. Sposta l'auto prima.",
    '{{what}} ξεκινά στις {{start}}. Μετακίνησε το αυτοκίνητο πριν από τότε.',
    '{{what}} शुरू होने का समय: {{start}}। उससे पहले गाड़ी हटा लें।',
    '{{what}} ਸ਼ੁਰੂ ਹੋਣ ਦਾ ਸਮਾਂ: {{start}}। ਉਸ ਤੋਂ ਪਹਿਲਾਂ ਗੱਡੀ ਹਟਾ ਲਓ।',
  ),
  'recurring.ics.move': T(
    'Move the car before it starts.',
    '请在开始前把车挪走。',
    'Hãy dời xe trước khi bắt đầu.',
    'Pindahkan mobilmu sebelum dimulai.',
    '시작 전에 차를 옮기세요.',
    "Sposta l'auto prima che inizi.",
    'Μετακίνησε το αυτοκίνητο πριν αρχίσει.',
    'शुरू होने से पहले गाड़ी हटा लें।',
    'ਸ਼ੁਰੂ ਹੋਣ ਤੋਂ ਪਹਿਲਾਂ ਗੱਡੀ ਹਟਾ ਲਓ।',
  ),
  'recurring.ics.footer': T(
    'Reminder set in ParkProof.',
    '在 ParkProof 中设置的提醒。',
    'Nhắc nhở được đặt trong ParkProof.',
    'Pengingat diatur di ParkProof.',
    'ParkProof에서 설정한 알림입니다.',
    'Promemoria impostato in ParkProof.',
    'Υπενθύμιση από το ParkProof.',
    'ParkProof में सेट किया गया रिमाइंडर।',
    'ParkProof ਵਿੱਚ ਸੈੱਟ ਕੀਤਾ ਰਿਮਾਈਂਡਰ।',
  ),
  // ── T5b: the privacy page (PrivacyPolicy renders it after privacy.anonymousPush) ──
  // What POST /push/recurring sends: the title (the address, else the name),
  // the rule's days, times and IANA zone, and the notification text, which
  // names it. Kept while the rule wants push; cancelled when it is paused,
  // deleted or its notifications are switched off; and the schedules end
  // and delete themselves 90 days after the last booking, which only an open
  // app makes (so within 90 days of the last time ParkProof is opened).
  'privacy.anonymousWeeklyPush': T(
    "<strong>Weekly reminders by push</strong>, if you turn them on: each reminder's name and any address you entered, its days, times and time zone, and its notification text go to <strong>ParkProof's server</strong>. The server keeps them while the reminder is on, so the reminder can go out every week. They're deleted when you pause or delete the reminder or switch off its notifications. If you stop opening ParkProof, they're deleted within 90 days.",
    '<strong>每周推送提醒</strong>(如果你开启):每条提醒的名称、你输入的地址(如有)、星期、时间和时区,以及通知内容会发送到 <strong>ParkProof 的服务器</strong>。提醒开启期间,服务器会保留这些信息,以便每周发出提醒。你暂停或删除这条提醒,或关闭它的通知时,这些信息会被删除。如果你不再打开 ParkProof,这些信息会在 90 天内删除。',
    '<strong>Lời nhắc đẩy hằng tuần</strong>, nếu bạn bật: tên của từng lời nhắc và địa chỉ bạn đã nhập (nếu có), các ngày, giờ và múi giờ của lời nhắc, cùng nội dung thông báo được gửi tới <strong>máy chủ của ParkProof</strong>. Máy chủ giữ các thông tin này khi lời nhắc còn bật, để có thể gửi lời nhắc mỗi tuần. Các thông tin này bị xoá khi bạn tạm dừng hoặc xoá lời nhắc, hoặc tắt thông báo của lời nhắc. Nếu bạn không mở ParkProof nữa, chúng sẽ bị xoá trong vòng 90 ngày.',
    '<strong>Pengingat mingguan lewat push</strong>, kalau kamu menyalakannya: nama setiap pengingat dan alamat yang kamu isi (kalau ada), hari, jam, dan zona waktunya, serta teks notifikasinya dikirim ke <strong>server ParkProof</strong>. Server menyimpannya selama pengingat itu aktif, supaya pengingatnya bisa dikirim setiap minggu. Semuanya dihapus saat kamu menjeda atau menghapus pengingat itu, atau mematikan notifikasinya. Kalau kamu berhenti membuka ParkProof, semuanya dihapus dalam 90 hari.',
    '<strong>매주 푸시 알림</strong>을 켜면 각 알림의 이름과 입력한 주소(있는 경우), 요일, 시간, 시간대, 알림 내용이 <strong>ParkProof 서버</strong>로 전송됩니다. 서버는 매주 알림을 보낼 수 있도록 알림이 켜져 있는 동안 이 정보를 보관합니다. 알림을 일시 중지하거나 삭제하거나 알림 받기를 끄면 이 정보는 삭제됩니다. ParkProof를 더 이상 열지 않으면 90일 이내에 삭제됩니다.',
    "<strong>Promemoria settimanali push</strong>, se li attivi: il nome di ogni promemoria e l'eventuale indirizzo che hai inserito, i suoi giorni, orari e fuso orario e il testo della notifica vanno al <strong>server di ParkProof</strong>. Il server li conserva finché il promemoria è attivo, così può inviarlo ogni settimana. Vengono cancellati quando metti in pausa o elimini il promemoria o ne disattivi le notifiche. Se smetti di aprire ParkProof, vengono cancellati entro 90 giorni.",
    '<strong>Εβδομαδιαίες υπενθυμίσεις push</strong>, αν τις ενεργοποιήσεις: το όνομα κάθε υπενθύμισης και όποια διεύθυνση έβαλες, οι μέρες, οι ώρες και η ζώνη ώρας της, και το κείμενο της ειδοποίησης πηγαίνουν στον <strong>server του ParkProof</strong>. Ο server τα κρατά όσο η υπενθύμιση είναι ενεργή, ώστε να στέλνεται κάθε εβδομάδα. Διαγράφονται όταν βάλεις την υπενθύμιση σε παύση, τη διαγράψεις ή απενεργοποιήσεις τις ειδοποιήσεις της. Αν σταματήσεις να ανοίγεις το ParkProof, διαγράφονται μέσα σε 90 ημέρες.',
    '<strong>साप्ताहिक पुश रिमाइंडर</strong>, अगर आप इन्हें चालू करते हैं: हर रिमाइंडर का नाम और आपका डाला गया पता (अगर हो), उसके दिन, समय और टाइम ज़ोन, और सूचना का संदेश <strong>ParkProof के सर्वर</strong> को भेजे जाते हैं। रिमाइंडर चालू रहने तक सर्वर इन्हें रखता है, ताकि रिमाइंडर हर हफ़्ते भेजा जा सके। रिमाइंडर को रोकने या मिटाने, या उसकी सूचनाएँ बंद करने पर ये मिटा दिए जाते हैं। अगर आप ParkProof खोलना बंद कर देते हैं, तो ये 90 दिनों के अंदर मिटा दिए जाते हैं।',
    "<strong>ਹਫ਼ਤਾਵਾਰੀ ਪੁਸ਼ ਰਿਮਾਈਂਡਰ</strong>, ਜੇ ਤੁਸੀਂ ਇਨ੍ਹਾਂ ਨੂੰ ਚਾਲੂ ਕਰਦੇ ਹੋ: ਹਰ ਰਿਮਾਈਂਡਰ ਦਾ ਨਾਮ ਅਤੇ ਤੁਹਾਡਾ ਪਾਇਆ ਪਤਾ (ਜੇ ਹੋਵੇ), ਉਸ ਦੇ ਦਿਨ, ਸਮਾਂ ਅਤੇ ਟਾਈਮ ਜ਼ੋਨ, ਅਤੇ ਸੂਚਨਾ ਦਾ ਸੁਨੇਹਾ <strong>ParkProof ਦੇ ਸਰਵਰ</strong> ਨੂੰ ਭੇਜੇ ਜਾਂਦੇ ਹਨ। ਰਿਮਾਈਂਡਰ ਚਾਲੂ ਰਹਿਣ ਤੱਕ ਸਰਵਰ ਇਨ੍ਹਾਂ ਨੂੰ ਰੱਖਦਾ ਹੈ, ਤਾਂ ਜੋ ਰਿਮਾਈਂਡਰ ਹਰ ਹਫ਼ਤੇ ਭੇਜਿਆ ਜਾ ਸਕੇ। ਰਿਮਾਈਂਡਰ ਨੂੰ ਰੋਕਣ ਜਾਂ ਮਿਟਾਉਣ, ਜਾਂ ਉਸ ਦੀਆਂ ਸੂਚਨਾਵਾਂ ਬੰਦ ਕਰਨ 'ਤੇ ਇਹ ਮਿਟਾ ਦਿੱਤੇ ਜਾਂਦੇ ਹਨ। ਜੇ ਤੁਸੀਂ ParkProof ਖੋਲ੍ਹਣਾ ਬੰਦ ਕਰ ਦਿੰਦੇ ਹੋ, ਤਾਂ ਇਹ 90 ਦਿਨਾਂ ਦੇ ਅੰਦਰ ਮਿਟਾ ਦਿੱਤੇ ਜਾਂਦੇ ਹਨ।",
  ),
}

// ── Existing strings this task rewrites (explicit overwrite list) ───────
// Each must already exist in every locale; the script aborts otherwise.
const OVERWRITES = {}

// ── Keys an earlier version of this script added and T5 no longer uses ──
// Deleted when present, so a re-run over files that have them converges.
// recurring.reliability: T5's screens show the shared ReminderHelp and the
// calendar file uses its key (reminders.reliability), so the line can't
// drift between two copies.
const REMOVALS = ['recurring.reliability']

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

/** Delete a string key this script once added. Nothing happens when it isn't there. */
function remove(root, path) {
  const parts = path.split('.')
  const leaf = parts.pop()
  let node = root
  for (const p of parts) {
    node = node && typeof node === 'object' ? node[p] : undefined
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
  }
  if (typeof node[leaf] === 'string') delete node[leaf]
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
      // Copy rules: no em-dashes; no symbols the PDF fonts can't draw.
      if (s.includes('\u2014')) problems.push(`em-dash in new copy at ${path}: ${s}`)
      if (/[\u2713\u26a0\u2192\u2248\u2264]/u.test(s)) problems.push(`symbol in new copy at ${path}: ${s}`)
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
    // "ticket" alone can read as the fine notice; say "meter ticket".
    if (/(?<!meter )\btickets?\b/i.test(byLocale.en)) problems.push(`ambiguous "ticket" in en copy at ${path}`)
  }
  // The reliability line T5 carries (the shared one) is the spec's wording, exactly.
  const reliability = all.en?.reminders?.reliability
  if (reliability !== "Reminders can be delayed or silenced, for example by Focus or battery saving. Don't rely on them alone.") {
    problems.push('reminders.reliability is not the build spec wording')
  }
  for (const path of REMOVALS) {
    if (path in en) problems.push(`en: ${path} should have been deleted`)
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
  for (const path of REMOVALS) remove(data[locale], path)
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
