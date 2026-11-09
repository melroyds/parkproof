/**
 * FIXLIST i18n (docs/build/fix-list.md, "Status after the overnight build
 * (9 Nov 2026)", the open items). Idempotent: running it twice leaves the
 * files byte-identical after the first run. ONE script for the whole task:
 * each unit of FIXLIST extends ADDITIONS, OVERWRITES and DELETIONS here
 * rather than adding another script.
 *
 * Run order: after every task's script and BEFORE
 * scripts/_i18n_inject_copy_pass.mjs, which runs last and wins on any key
 * it overwrites. So a key this script overwrites that the copy pass also
 * overwrites must carry the same text in the copy-pass file, and a key this
 * script deletes must not be in any copy-pass file (the copy pass aborts on
 * an overwrite of a missing key). Both are checked below before anything is
 * written. Never re-run the T0a to T1b scripts.
 *
 * Clean-ups unit:
 *   - `reminders.ics.*`, `recurring.ics.noDates` (item 1): the calendar
 *     files' titles, descriptions and errors (src/lib/ics.ts), which were
 *     English only. The alarms reuse the reminder bodies every push and
 *     in-tab reminder already shows (src/lib/reminder-copy.ts), and the
 *     "no expiry" and "pick at least one" errors reuse
 *     `reminders.noExpiry` and `reminders.calendarPickAtLeastOne`.
 *   - `landing.hero.*`, `common.signedSeal` (item 2): the landing hero's
 *     SVG text and description (HeroAnswer.tsx; its time pill reuses
 *     `result.until`, as the real answer card does) and the signed seal's
 *     label (VerifiedSeal.tsx).
 *   - DELETIONS (item 3): keys no code reads, proven by grep over src
 *     including dynamic key building: the AppealFlow verdict labels
 *     `appeal.strongEvidence`, `appeal.moderateEvidence` and
 *     `appeal.weakEvidence`; the old landing feature cards
 *     `landing.feature.*`; T4's `prefs.remindersReliability` (Settings
 *     shows `reminders.reliability`) and `active.shareAria` (the home
 *     card's Share icon uses T7's own label); T8's `notice.homeLink`.
 *     The scripts that added them no longer do: scripts/_i18n_inject_t4.mjs
 *     and scripts/_i18n_inject_t8.mjs (their ADDITIONS), and
 *     scripts/_i18n_inject_landing.mjs is gone (it only added
 *     `landing.feature.*`). The copy pass's `landing.feature.translateDesc`
 *     entries are gone too.
 *   - DELETIONS (item 4): the two home rows each keep one key. The weekly
 *     reminders row now reads T5's `recurring.homeRow` (reviewed wording,
 *     the same words as the recurring screen's own street sweeping term in
 *     ko, hi and pa), so T4's `home.weeklyReminders` goes. The fine row
 *     keeps T4's `home.fineStart`: T8's `notice.homeLink` matched it in
 *     every locale but el, where it used κλήση, not the verified term for
 *     "fine" (πρόστιμο, docs/legal-pdf-review-worksheet.md).
 *   - OVERWRITES (item 6): `privacy.anonymousWeeklyPush` and
 *     `privacy.rightsAnonymous`, rewritten in all 9 locales so both say
 *     what the code keeps and for how long (lambda/index.js push handlers,
 *     lambda/push-tombstone.js, lambda/recurring-schedule.js,
 *     src/lib/push.ts and src/lib/recurring-push.ts):
 *       a record's push reminder: an EventBridge schedule, deleted after it
 *         fires (ActionAfterCompletion DELETE) or when the app cancels it;
 *       a weekly reminder by push: cron schedules with EndDate 90 days
 *         after each booking (RECURRING_SCHEDULE_DAYS), deleted by the
 *         app's cancel when the rule is paused, deleted or has push off;
 *         the app books again when opened (at most weekly unless changed);
 *       the device's push registration (device id, endpoint, keys, times):
 *         a DynamoDB row with a 90-day TTL (PUSH_TTL_DAYS), renewed when
 *         the app opens with push on and when any reminder is booked (to at
 *         least a day after the last booked reminder can fire). Switching
 *         push off (in the app or the browser) tells the server nothing,
 *         but a reminder booked earlier that fires afterwards gets 410 or
 *         404 from the push service, which turns the row into a tombstone
 *         at once (fix round 1: the old "doesn't delete it sooner" wasn't
 *         always true);
 *       a dead endpoint: the row becomes a tombstone (device id, the
 *         endpoint's SHA-256, when) with its own 90-day TTL;
 *       the Lambda's logs: the device id, the push service's host, the
 *         record's or weekly rule's random id, and when reminders were set,
 *         sent or skipped (the [parkproof.push.*] lines; the weekly rule's
 *         pattern and zone are no longer logged). Kept 90 days once
 *         scripts/setup-log-retention.sh has run (deploy checklist, stage
 *         6, a stop condition for shipping this text).
 *     `privacy.rightsAnonymous` is also in the copy-pass files, so those
 *     carry the same new text.
 *
 * Fix round 1:
 *   - `scanner.previewAlt`: the scan preview's alt text (SignScanner.tsx),
 *     which was hardcoded English. The toast's close button reuses
 *     `common.close` (App.tsx).
 *   - `common.signedSeal` is now given only where it is true (see below).
 *   - `privacy.rightsAnonymous`: switching push off, the dead-address case
 *     and the server logs, as above.
 *
 * Fix round 2:
 *   - OVERWRITES `privacy.anonymousCloudwatch`: it said only a random ID
 *     and a correct/retake verdict were logged, "No PII". The
 *     [parkproof.feedback] line (handleFeedback in lambda/index.js, fed by
 *     buildFeedbackContext in src/components/ParkingResult.tsx) also logs
 *     when, the first 120 characters of the reading's rules text, its
 *     confidence, time limit, payment methods, the sign's permit area, the
 *     position the driver picked, counts of rule groups, reading problems
 *     and weekly restrictions, whether the sign was readable, a re-check or
 *     an area sign, the paid parking, permit zone and accessible bay flags,
 *     the hour at the sign, and the driver's answers so far to the paid
 *     parking, permit zone and accessible parking permit questions. The
 *     text now says all of that, says nothing identifies the driver or the
 *     device, and gives the 90-day log retention. The server no longer
 *     accepts `no_sign` on /feedback (no client sends it), so the text
 *     needn't mention it. src/lib/privacy-feedback-log.test.tsx holds the
 *     text, the client and the server's log line together.
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces).
 *
 * Run:   node scripts/_i18n_inject_fixlist_final.mjs
 * List:  node scripts/_i18n_inject_fixlist_final.mjs --list
 *        prints every key this task added, rewrote or deleted, for the T10
 *        translation review ('legal' marks the statements a lawyer should
 *        read).
 * Other: node scripts/_i18n_inject_fixlist_final.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 *        --pass <copy-pass dir> reads the copy-pass files from another folder.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const passArg = process.argv.indexOf('--pass')
const PASS = passArg > -1 ? resolve(process.argv[passArg + 1]) : join(ROOT, 'scripts', 'copy-pass')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

/** Keys whose wording makes a claim a lawyer should read (docs/legal-review-queue.md, T10). */
const LEGAL = new Set([
  'privacy.anonymousWeeklyPush',
  'privacy.rightsAnonymous',
  'privacy.anonymousCloudwatch',
  'common.signedSeal',
])

// ── New keys, appended inside their parent object ────────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position). Missing parent objects are created,
// appended at the end of their own parent.
const ADDITIONS = {
  // ═══ Clean-ups, item 1: the calendar files (src/lib/ics.ts) ═════════════
  // A record's calendar event: its title and its description's three lines.
  'reminders.ics.expiresTitle': {
    en: 'ParkProof: parking expires',
    'zh-CN': 'ParkProof：停车时间到期',
    vi: 'ParkProof: hết giờ đỗ xe',
    id: 'ParkProof: waktu parkir berakhir',
    ko: 'ParkProof: 주차 만료',
    it: 'ParkProof: il parcheggio scade',
    el: 'ParkProof: λήγει η στάθμευση',
    hi: 'ParkProof: पार्किंग खत्म हो रही है',
    pa: 'ParkProof: ਪਾਰਕਿੰਗ ਖ਼ਤਮ ਹੋ ਰਹੀ ਹੈ',
  },
  // {{time}} is a day and a time ("Mon 9 Nov, 4:00 pm"), {{place}} where
  // that time is local ("Melbourne", recurring.zone.*).
  'reminders.ics.expiresAt': {
    en: 'Your parking expires at {{time}} ({{place}}).',
    'zh-CN': '停车到期时间：{{time}}（{{place}}）。',
    vi: 'Giờ đỗ xe của bạn hết vào {{time}} ({{place}}).',
    id: 'Waktu parkirmu berakhir: {{time}} ({{place}}).',
    ko: '주차 만료 시각: {{time}} ({{place}})',
    it: 'Il tuo parcheggio scade: {{time}} ({{place}}).',
    el: 'Η στάθμευσή σου λήγει: {{time}} ({{place}}).',
    hi: 'आपकी पार्किंग खत्म होने का समय: {{time}} ({{place}})।',
    pa: 'ਤੁਹਾਡੀ ਪਾਰਕਿੰਗ ਖ਼ਤਮ ਹੋਣ ਦਾ ਸਮਾਂ: {{time}} ({{place}})।',
  },
  // {{times}}: the reminder times as the reminder screen lists them.
  'reminders.ics.remindersAt': {
    en: 'Reminders: {{times}}.',
    'zh-CN': '提醒时间：{{times}}。',
    vi: 'Nhắc nhở: {{times}}.',
    id: 'Pengingat: {{times}}.',
    ko: '알림 시각: {{times}}',
    it: 'Promemoria: {{times}}.',
    el: 'Υπενθυμίσεις: {{times}}.',
    hi: 'रिमाइंडर: {{times}}।',
    pa: 'ਰਿਮਾਈਂਡਰ: {{times}}।',
  },
  'reminders.ics.recordId': {
    en: 'ParkProof record: {{id}}',
    'zh-CN': 'ParkProof 记录：{{id}}',
    vi: 'Bản ghi ParkProof: {{id}}',
    id: 'Catatan ParkProof: {{id}}',
    ko: 'ParkProof 기록: {{id}}',
    it: 'Record ParkProof: {{id}}',
    el: 'Αρχείο ParkProof: {{id}}',
    hi: 'ParkProof रिकॉर्ड: {{id}}',
    pa: 'ParkProof ਰਿਕਾਰਡ: {{id}}',
  },
  // A record with no sign: "check on your car" reminders.
  'reminders.ics.checkOnTitle': {
    en: 'ParkProof: check on your car',
    'zh-CN': 'ParkProof：去看看你的车',
    vi: 'ParkProof: kiểm tra xe của bạn',
    id: 'ParkProof: cek mobilmu',
    ko: 'ParkProof: 차 확인하기',
    it: 'ParkProof: controlla la tua auto',
    el: 'ParkProof: έλεγξε το αυτοκίνητό σου',
    hi: 'ParkProof: अपनी गाड़ी देख आएँ',
    pa: 'ParkProof: ਆਪਣੀ ਕਾਰ ਵੇਖ ਆਓ',
  },
  'reminders.ics.checkOnAt': {
    en: 'Check on your car at {{address}} ({{place}}).',
    'zh-CN': '去 {{address}}（{{place}}）看看你的车。',
    vi: 'Kiểm tra xe của bạn tại {{address}} ({{place}}).',
    id: 'Cek mobilmu di {{address}} ({{place}}).',
    ko: '{{address}}({{place}})에 있는 차를 확인하세요.',
    it: 'Controlla la tua auto in {{address}} ({{place}}).',
    el: 'Έλεγξε το αυτοκίνητό σου στη διεύθυνση {{address}} ({{place}}).',
    hi: '{{address}} ({{place}}) पर अपनी गाड़ी देख आएँ।',
    pa: "{{address}} ({{place}}) 'ਤੇ ਆਪਣੀ ਕਾਰ ਵੇਖ ਆਓ।",
  },
  // The same with no address on the record.
  'reminders.ics.checkOnHere': {
    en: 'Check on your car where you parked it ({{place}}).',
    'zh-CN': '去你停车的地方看看你的车（{{place}}）。',
    vi: 'Kiểm tra xe của bạn ở nơi bạn đã đỗ ({{place}}).',
    id: 'Cek mobilmu di tempat kamu memarkirnya ({{place}}).',
    ko: '주차한 곳에서 차를 확인하세요({{place}}).',
    it: "Controlla la tua auto dove l'hai parcheggiata ({{place}}).",
    el: 'Έλεγξε το αυτοκίνητό σου εκεί που το πάρκαρες ({{place}}).',
    hi: 'जहाँ गाड़ी पार्क की थी, वहाँ जाकर उसे देख आएँ ({{place}})।',
    pa: 'ਜਿੱਥੇ ਕਾਰ ਪਾਰਕ ਕੀਤੀ ਸੀ, ਉੱਥੇ ਜਾ ਕੇ ਉਸ ਨੂੰ ਵੇਖ ਆਓ ({{place}})।',
  },
  // The calendar package refused the event (all three calendar files).
  'reminders.ics.buildFailed': {
    en: "Couldn't make the calendar file. Try again.",
    'zh-CN': '无法生成日历文件，请重试。',
    vi: 'Không tạo được tệp lịch. Hãy thử lại.',
    id: 'Gagal membuat file kalender. Coba lagi.',
    ko: '캘린더 파일을 만들지 못했습니다. 다시 시도하세요.',
    it: 'Impossibile creare il file del calendario. Riprova.',
    el: 'Δεν ήταν δυνατή η δημιουργία του αρχείου ημερολογίου. Δοκίμασε ξανά.',
    hi: 'कैलेंडर फ़ाइल नहीं बन सकी। फिर से कोशिश करें।',
    pa: 'ਕੈਲੰਡਰ ਫ਼ਾਈਲ ਨਹੀਂ ਬਣ ਸਕੀ। ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
  },
  // A weekly reminder whose rule gives no date (buildRecurringIcs).
  'recurring.ics.noDates': {
    en: 'This weekly reminder has no dates to add.',
    'zh-CN': '这条每周提醒没有可添加的日期。',
    vi: 'Lời nhắc hằng tuần này không có ngày nào để thêm.',
    id: 'Pengingat mingguan ini tidak punya tanggal untuk ditambahkan.',
    ko: '이 매주 알림에는 추가할 날짜가 없습니다.',
    it: 'Questo promemoria settimanale non ha date da aggiungere.',
    el: 'Αυτή η εβδομαδιαία υπενθύμιση δεν έχει ημερομηνίες για προσθήκη.',
    hi: 'इस साप्ताहिक रिमाइंडर में जोड़ने के लिए कोई तारीख नहीं है।',
    pa: 'ਇਸ ਹਫ਼ਤਾਵਾਰੀ ਰਿਮਾਈਂਡਰ ਵਿੱਚ ਜੋੜਨ ਲਈ ਕੋਈ ਤਾਰੀਖ਼ ਨਹੀਂ ਹੈ।',
  },

  // ═══ Clean-ups, item 2: the landing hero and the signed seal ═══════════
  // HeroAnswer.tsx: the illustration's description for screen readers.
  // {{time}} is the time in its pill, written as the app writes clock times.
  'landing.hero.aria': {
    en: 'A parking sign turning into a signed parking record: you can park until {{time}}.',
    'zh-CN': '一块停车标志变成一条已签名的停车记录：你可以停到 {{time}}。',
    vi: 'Một biển đỗ xe biến thành bản ghi đỗ xe đã ký: bạn có thể đỗ đến {{time}}.',
    id: 'Rambu parkir yang berubah menjadi catatan parkir bertanda tangan: kamu bisa parkir sampai {{time}}.',
    ko: '주차 표지판이 서명된 주차 기록으로 바뀌는 모습: {{time}}까지 주차할 수 있습니다.',
    it: 'Un cartello di parcheggio che diventa un record di parcheggio firmato: puoi parcheggiare fino alle {{time}}.',
    el: 'Μια πινακίδα στάθμευσης που γίνεται υπογεγραμμένο αρχείο στάθμευσης: μπορείς να παρκάρεις μέχρι τις {{time}}.',
    hi: 'एक पार्किंग साइन, जो हस्ताक्षरित पार्किंग रिकॉर्ड में बदल रहा है: आप {{time}} तक पार्क कर सकते हैं।',
    pa: 'ਇੱਕ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ, ਜੋ ਹਸਤਾਖਰਿਤ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ ਵਿੱਚ ਬਦਲ ਰਿਹਾ ਹੈ: ਤੁਸੀਂ {{time}} ਤੱਕ ਪਾਰਕ ਕਰ ਸਕਦੇ ਹੋ।',
  },
  // The card's small monospace label, written in capitals where the script has them.
  'landing.hero.kicker': {
    en: 'SIGNED RECORD',
    'zh-CN': '已签名记录',
    vi: 'BẢN GHI ĐÃ KÝ',
    id: 'CATATAN BERTANDA TANGAN',
    ko: '서명된 기록',
    it: 'RECORD FIRMATO',
    el: 'ΥΠΟΓΕΓΡΑΜΜΕΝΟ ΑΡΧΕΙΟ',
    hi: 'हस्ताक्षरित रिकॉर्ड',
    pa: 'ਹਸਤਾਖਰਿਤ ਰਿਕਾਰਡ',
  },
  // The card's headline, the answer.
  'landing.hero.canPark': {
    en: 'You can park',
    'zh-CN': '可以停车',
    vi: 'Bạn có thể đỗ xe',
    id: 'Kamu bisa parkir',
    ko: '주차 가능합니다',
    it: 'Puoi parcheggiare',
    el: 'Μπορείς να παρκάρεις',
    hi: 'आप पार्क कर सकते हैं',
    pa: 'ਤੁਸੀਂ ਪਾਰਕ ਕਰ ਸਕਦੇ ਹੋ',
  },
  // ═══ Fix round 1: hardcoded English labels ═════════════════════════════
  // SignScanner.tsx: the photo just taken or picked, before it is read.
  'scanner.previewAlt': {
    en: 'Your photo of the parking sign',
    'zh-CN': '你的停车标志照片',
    vi: 'Ảnh biển báo đỗ xe của bạn',
    id: 'Foto rambu parkirmu',
    ko: '주차 표지판 사진',
    it: 'La tua foto del cartello di sosta',
    el: 'Η φωτογραφία σου της πινακίδας στάθμευσης',
    hi: 'पार्किंग साइन की आपकी फोटो',
    pa: 'ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਦੀ ਤੁਹਾਡੀ ਫੋਟੋ',
  },
  // VerifiedSeal.tsx: the seal's label, given only on a History row of a
  // record signed with ParkProof's key (a development-key signature gets
  // session.devKeySigned). Everywhere else the seal is decorative: the
  // result card after "correct" (nothing is signed yet), the record
  // screen's signature panel (its own text says which key) and the landing
  // callout (fix round 1).
  'common.signedSeal': {
    en: 'Signed, tamper-evident record',
    'zh-CN': '已签名、可核对是否被改动的记录',
    vi: 'Bản ghi đã ký, phát hiện được nếu bị sửa',
    id: 'Catatan bertanda tangan, perubahannya bisa terdeteksi',
    ko: '서명되어 변조 여부를 확인할 수 있는 기록',
    it: 'Record firmato, con manomissione rilevabile',
    el: 'Υπογεγραμμένο αρχείο με ανιχνεύσιμη αλλοίωση',
    hi: 'हस्ताक्षरित रिकॉर्ड, जिसमें छेड़छाड़ पकड़ी जा सकती है',
    pa: 'ਹਸਤਾਖਰਿਤ, ਛੇੜਛਾੜ-ਪਛਾਣਯੋਗ ਰਿਕਾਰਡ',
  },
}

// ── Existing strings rewritten in place ──────────────────────────────────
const OVERWRITES = {
  // ═══ Clean-ups, item 6: how long push data is kept ════════════════════
  // The weekly push list item: what goes to the server, how long it stays.
  'privacy.anonymousWeeklyPush': {
    en: "<strong>Weekly reminders by push</strong>, if you turn them on: each reminder's name and any address you entered, its days, times, repeat pattern and time zone, when it should remind you, and its notification text go to <strong>ParkProof's server</strong>, with a random ID for this device. The server keeps them while the reminder is on, so it can go out every week. They're deleted when you pause or delete the reminder or switch off its notifications, the next time ParkProof is open and online. Each time ParkProof sends them, the server keeps them for 90 days at most. ParkProof sends them again from time to time while you keep opening it, so if you stop, they're deleted within 90 days of the last time you opened ParkProof.",
    'zh-CN':
      '<strong>每周推送提醒</strong>（如果你开启）：每条提醒的名称、你输入的地址（如有）、星期、时间、重复方式和时区、何时提醒你，以及通知内容，会连同这台设备的随机 ID 一起发送到 <strong>ParkProof 的服务器</strong>。提醒开启期间，服务器会保留这些信息，以便每周发出提醒。你暂停或删除这条提醒，或关闭它的通知后，ParkProof 下次打开并联网时会删除这些信息。ParkProof 每次发送这些信息后，服务器最多保留 90 天。只要你继续打开 ParkProof，它就会不时重新发送；如果你不再打开，这些信息会在你最后一次打开 ParkProof 后的 90 天内删除。',
    vi: '<strong>Lời nhắc đẩy hằng tuần</strong>, nếu bạn bật: tên của từng lời nhắc và địa chỉ bạn đã nhập (nếu có), các ngày, giờ, cách lặp lại và múi giờ của lời nhắc, thời điểm nhắc bạn, cùng nội dung thông báo được gửi tới <strong>máy chủ của ParkProof</strong>, kèm một mã ngẫu nhiên của thiết bị này. Máy chủ giữ các thông tin này khi lời nhắc còn bật, để có thể gửi lời nhắc mỗi tuần. Các thông tin này bị xoá khi bạn tạm dừng hoặc xoá lời nhắc, hoặc tắt thông báo của lời nhắc, vào lần tới ParkProof được mở và có kết nối mạng. Mỗi lần ParkProof gửi các thông tin này, máy chủ giữ chúng tối đa 90 ngày. ParkProof thỉnh thoảng gửi lại khi bạn vẫn mở ứng dụng, nên nếu bạn ngừng mở, chúng sẽ bị xoá trong vòng 90 ngày kể từ lần cuối bạn mở ParkProof.',
    id: '<strong>Pengingat mingguan lewat push</strong>, kalau kamu menyalakannya: nama setiap pengingat dan alamat yang kamu isi (kalau ada), hari, jam, pola pengulangan, dan zona waktunya, kapan kamu ingin diingatkan, serta teks notifikasinya dikirim ke <strong>server ParkProof</strong>, bersama ID acak untuk perangkat ini. Server menyimpannya selama pengingat itu aktif, supaya pengingatnya bisa dikirim setiap minggu. Semuanya dihapus saat kamu menjeda atau menghapus pengingat itu, atau mematikan notifikasinya, begitu ParkProof terbuka dan tersambung ke internet. Setiap kali ParkProof mengirimnya, server menyimpannya paling lama 90 hari. ParkProof mengirimnya lagi sesekali selama kamu terus membukanya, jadi kalau kamu berhenti, semuanya dihapus dalam 90 hari sejak terakhir kali kamu membuka ParkProof.',
    ko: '<strong>매주 푸시 알림</strong>을 켜면 각 알림의 이름과 입력한 주소(있는 경우), 요일, 시간, 반복 방식, 시간대, 알림을 받을 시점, 알림 내용이 이 기기의 임의 ID와 함께 <strong>ParkProof 서버</strong>로 전송됩니다. 서버는 매주 알림을 보낼 수 있도록 알림이 켜져 있는 동안 이 정보를 보관합니다. 알림을 일시 중지하거나 삭제하거나 알림 받기를 끄면, 다음에 ParkProof가 열려 있고 인터넷에 연결되었을 때 이 정보가 삭제됩니다. ParkProof가 이 정보를 보낼 때마다 서버는 최대 90일 동안 보관합니다. ParkProof를 계속 열면 이 정보를 때때로 다시 보내므로, 더 이상 열지 않으면 마지막으로 ParkProof를 연 날부터 90일 이내에 삭제됩니다.',
    it: "<strong>Promemoria settimanali push</strong>, se li attivi: il nome di ogni promemoria e l'eventuale indirizzo che hai inserito, i suoi giorni, orari, ripetizione e fuso orario, quando deve avvisarti e il testo della notifica vanno al <strong>server di ParkProof</strong>, insieme a un ID casuale di questo dispositivo. Il server li conserva finché il promemoria è attivo, così può inviarlo ogni settimana. Vengono cancellati quando metti in pausa o elimini il promemoria o ne disattivi le notifiche, la prossima volta che ParkProof è aperto e online. Ogni volta che ParkProof li invia, il server li conserva al massimo 90 giorni. ParkProof li invia di nuovo di tanto in tanto finché continui ad aprirlo, quindi se smetti vengono cancellati entro 90 giorni dall'ultima volta che hai aperto ParkProof.",
    el: '<strong>Εβδομαδιαίες υπενθυμίσεις push</strong>, αν τις ενεργοποιήσεις: το όνομα κάθε υπενθύμισης και όποια διεύθυνση έβαλες, οι μέρες, οι ώρες, η επανάληψη και η ζώνη ώρας της, πότε να σε ειδοποιεί, και το κείμενο της ειδοποίησης πηγαίνουν στον <strong>server του ParkProof</strong>, μαζί με ένα τυχαίο αναγνωριστικό αυτής της συσκευής. Ο server τα κρατά όσο η υπενθύμιση είναι ενεργή, ώστε να στέλνεται κάθε εβδομάδα. Διαγράφονται όταν βάλεις την υπενθύμιση σε παύση, τη διαγράψεις ή απενεργοποιήσεις τις ειδοποιήσεις της, την επόμενη φορά που το ParkProof είναι ανοιχτό και συνδεδεμένο στο διαδίκτυο. Κάθε φορά που το ParkProof τα στέλνει, ο server τα κρατά για 90 ημέρες το πολύ. Το ParkProof τα στέλνει ξανά κατά διαστήματα όσο συνεχίζεις να το ανοίγεις, οπότε αν σταματήσεις, διαγράφονται μέσα σε 90 ημέρες από την τελευταία φορά που άνοιξες το ParkProof.',
    hi: '<strong>साप्ताहिक पुश रिमाइंडर</strong>, अगर आप इन्हें चालू करते हैं: हर रिमाइंडर का नाम और आपका डाला गया पता (अगर हो), उसके दिन, समय, दोहराने का तरीका और टाइम ज़ोन, आपको कब याद दिलाना है, और सूचना का संदेश, इस डिवाइस की एक रैंडम ID के साथ <strong>ParkProof के सर्वर</strong> को भेजे जाते हैं। रिमाइंडर चालू रहने तक सर्वर इन्हें रखता है, ताकि रिमाइंडर हर हफ़्ते भेजा जा सके। रिमाइंडर को रोकने या मिटाने, या उसकी सूचनाएँ बंद करने पर, अगली बार ParkProof के खुले होने और इंटरनेट से जुड़े होने पर ये मिटा दिए जाते हैं। ParkProof जब भी इन्हें भेजता है, सर्वर इन्हें ज़्यादा से ज़्यादा 90 दिन तक रखता है। जब तक आप ParkProof खोलते रहते हैं, यह इन्हें समय-समय पर फिर से भेजता है, इसलिए अगर आप खोलना बंद कर देते हैं, तो आपके आखिरी बार ParkProof खोलने के 90 दिनों के अंदर ये मिटा दिए जाते हैं।',
    pa: "<strong>ਹਫ਼ਤਾਵਾਰੀ ਪੁਸ਼ ਰਿਮਾਈਂਡਰ</strong>, ਜੇ ਤੁਸੀਂ ਇਨ੍ਹਾਂ ਨੂੰ ਚਾਲੂ ਕਰਦੇ ਹੋ: ਹਰ ਰਿਮਾਈਂਡਰ ਦਾ ਨਾਮ ਅਤੇ ਤੁਹਾਡਾ ਪਾਇਆ ਪਤਾ (ਜੇ ਹੋਵੇ), ਉਸ ਦੇ ਦਿਨ, ਸਮਾਂ, ਦੁਹਰਾਉਣ ਦਾ ਤਰੀਕਾ ਅਤੇ ਟਾਈਮ ਜ਼ੋਨ, ਤੁਹਾਨੂੰ ਕਦੋਂ ਯਾਦ ਕਰਵਾਉਣਾ ਹੈ, ਅਤੇ ਸੂਚਨਾ ਦਾ ਸੁਨੇਹਾ, ਇਸ ਡਿਵਾਈਸ ਦੀ ਇੱਕ ਰੈਂਡਮ ID ਦੇ ਨਾਲ <strong>ParkProof ਦੇ ਸਰਵਰ</strong> ਨੂੰ ਭੇਜੇ ਜਾਂਦੇ ਹਨ। ਰਿਮਾਈਂਡਰ ਚਾਲੂ ਰਹਿਣ ਤੱਕ ਸਰਵਰ ਇਨ੍ਹਾਂ ਨੂੰ ਰੱਖਦਾ ਹੈ, ਤਾਂ ਜੋ ਰਿਮਾਈਂਡਰ ਹਰ ਹਫ਼ਤੇ ਭੇਜਿਆ ਜਾ ਸਕੇ। ਰਿਮਾਈਂਡਰ ਨੂੰ ਰੋਕਣ ਜਾਂ ਮਿਟਾਉਣ, ਜਾਂ ਉਸ ਦੀਆਂ ਸੂਚਨਾਵਾਂ ਬੰਦ ਕਰਨ 'ਤੇ, ਅਗਲੀ ਵਾਰ ParkProof ਦੇ ਖੁੱਲ੍ਹੇ ਹੋਣ ਅਤੇ ਇੰਟਰਨੈੱਟ ਨਾਲ ਜੁੜੇ ਹੋਣ 'ਤੇ ਇਹ ਮਿਟਾ ਦਿੱਤੇ ਜਾਂਦੇ ਹਨ। ParkProof ਜਦੋਂ ਵੀ ਇਨ੍ਹਾਂ ਨੂੰ ਭੇਜਦਾ ਹੈ, ਸਰਵਰ ਇਨ੍ਹਾਂ ਨੂੰ ਵੱਧ ਤੋਂ ਵੱਧ 90 ਦਿਨ ਤੱਕ ਰੱਖਦਾ ਹੈ। ਜਦੋਂ ਤੱਕ ਤੁਸੀਂ ParkProof ਖੋਲ੍ਹਦੇ ਰਹਿੰਦੇ ਹੋ, ਇਹ ਇਨ੍ਹਾਂ ਨੂੰ ਸਮੇਂ-ਸਮੇਂ 'ਤੇ ਦੁਬਾਰਾ ਭੇਜਦਾ ਹੈ, ਇਸ ਲਈ ਜੇ ਤੁਸੀਂ ਖੋਲ੍ਹਣਾ ਬੰਦ ਕਰ ਦਿੰਦੇ ਹੋ, ਤਾਂ ਤੁਹਾਡੇ ਆਖਰੀ ਵਾਰ ParkProof ਖੋਲ੍ਹਣ ਦੇ 90 ਦਿਨਾਂ ਦੇ ਅੰਦਰ ਇਹ ਮਿਟਾ ਦਿੱਤੇ ਜਾਂਦੇ ਹਨ।",
  },
  // "Your rights" for a driver who doesn't sign in: what stays on the
  // server after clearing the browser, and for how long. The same text is in
  // scripts/copy-pass/<locale>.json (checked below).
  'privacy.rightsAnonymous': {
    en: "If you don't sign in, your parking records are only on this device. Clear your browser storage to delete them. That doesn't delete what's already on our servers. A push reminder you set for a record is kept until it's sent or you cancel it. A weekly reminder by push is deleted within 90 days of the last time you opened ParkProof. This device's push registration (a random ID for this device, the push address and encryption keys your browser gave us, and when they were last renewed) is kept for about 90 days after ParkProof last renewed it. ParkProof renews it when you open the app with push reminders on and when you set a reminder. Switching push reminders off, in ParkProof or in your browser, doesn't tell our server, so the registration is kept as above. If the push service tells us the address no longer works (this can happen when a reminder you set earlier is sent after you switched them off), we delete the address and keys at once. We keep only this device's ID, a fingerprint of the address and when we found out, for about 90 days, so the address isn't stored again. Our server's logs also record this device's ID when it registers for push, sets a reminder or is sent one, with the push service it uses, the random ID of the record or weekly reminder, and when each reminder was set, sent or skipped. The logs are deleted after 90 days. Feedback you send, with your email if you add one, is kept for up to two years.",
    'zh-CN':
      '如果你不登录，你的停车记录只保存在这台设备上。清除浏览器存储即可删除它们。但这不会删除已经在我们服务器上的数据。你为某条记录设置的推送提醒会保留到发出或你取消为止。每周推送提醒会在你最后一次打开 ParkProof 后的 90 天内删除。这台设备的推送注册（这台设备的随机 ID、你的浏览器提供给我们的推送地址和加密密钥，以及它们最后一次更新的时间）会在 ParkProof 最后一次更新它之后保留约 90 天。你在开启推送提醒的情况下打开 ParkProof，或设置提醒时，ParkProof 都会更新它。在 ParkProof 或浏览器中关闭推送提醒不会通知我们的服务器，所以推送注册仍按上述方式保留。如果推送服务告诉我们这个地址已经失效（你关闭推送提醒后，之前设置的提醒发出时就可能出现这种情况），我们会立即删除这个地址和密钥。我们只保留这台设备的 ID、这个地址的指纹和我们得知的时间，保留约 90 天，以免再次存储这个地址。这台设备注册推送、设置提醒或收到提醒时，我们服务器的日志还会记录这台设备的 ID，以及它使用的推送服务、相关记录或每周提醒的随机 ID，和每条提醒的设置、发送或跳过时间。这些日志会在 90 天后删除。你发送的反馈以及你填写的电子邮件（如有）最多保留两年。',
    vi: 'Nếu bạn không đăng nhập, các bản ghi đỗ xe của bạn chỉ nằm trên thiết bị này. Hãy xoá bộ nhớ trình duyệt để xoá chúng. Việc đó không xoá những gì đã có trên máy chủ của chúng tôi. Lời nhắc đẩy bạn đặt cho một bản ghi được giữ đến khi được gửi đi hoặc bạn huỷ. Lời nhắc đẩy hằng tuần bị xoá trong vòng 90 ngày kể từ lần cuối bạn mở ParkProof. Đăng ký nhận thông báo đẩy của thiết bị này (một mã ngẫu nhiên của thiết bị, địa chỉ nhận thông báo đẩy và khoá mã hoá mà trình duyệt của bạn cung cấp cho chúng tôi, cùng thời điểm chúng được gia hạn lần cuối) được giữ khoảng 90 ngày sau lần cuối ParkProof gia hạn nó. ParkProof gia hạn đăng ký này khi bạn mở ứng dụng trong lúc đang bật lời nhắc đẩy và khi bạn đặt lời nhắc. Tắt lời nhắc đẩy, trong ParkProof hay trong trình duyệt, không báo cho máy chủ của chúng tôi, nên đăng ký này vẫn được giữ như trên. Nếu dịch vụ thông báo đẩy báo cho chúng tôi rằng địa chỉ đó không còn hoạt động (điều này có thể xảy ra khi một lời nhắc bạn đặt trước đó được gửi đi sau khi bạn đã tắt lời nhắc đẩy), chúng tôi xoá ngay địa chỉ và khoá mã hoá đó. Chúng tôi chỉ giữ mã của thiết bị này, dấu vân tay số của địa chỉ đó và thời điểm chúng tôi biết, trong khoảng 90 ngày, để địa chỉ đó không bị lưu lại. Nhật ký máy chủ của chúng tôi cũng ghi lại mã của thiết bị này khi thiết bị đăng ký nhận thông báo đẩy, đặt lời nhắc hoặc nhận một lời nhắc, cùng với dịch vụ thông báo đẩy mà thiết bị dùng, mã ngẫu nhiên của bản ghi hoặc lời nhắc hằng tuần, và thời điểm mỗi lời nhắc được đặt, gửi đi hoặc bỏ qua. Nhật ký này bị xoá sau 90 ngày. Phản hồi bạn gửi, kèm email nếu bạn có ghi, được giữ tối đa hai năm.',
    id: 'Jika kamu tidak masuk, catatan parkirmu hanya ada di perangkat ini. Hapus penyimpanan browsermu untuk menghapusnya. Itu tidak menghapus data yang sudah ada di server kami. Pengingat push yang kamu atur untuk sebuah catatan disimpan sampai terkirim atau kamu membatalkannya. Pengingat mingguan lewat push dihapus dalam 90 hari sejak terakhir kali kamu membuka ParkProof. Pendaftaran push perangkat ini (ID acak untuk perangkat ini, alamat push dan kunci enkripsi yang diberikan browsermu kepada kami, serta kapan semua itu terakhir diperbarui) disimpan sekitar 90 hari sejak ParkProof terakhir memperbaruinya. ParkProof memperbaruinya saat kamu membuka aplikasi dengan pengingat push menyala dan saat kamu mengatur pengingat. Mematikan pengingat push, di ParkProof atau di browsermu, tidak memberi tahu server kami, jadi pendaftaran itu tetap disimpan seperti di atas. Kalau layanan push memberi tahu kami bahwa alamat itu sudah tidak berfungsi (ini bisa terjadi saat pengingat yang kamu atur sebelumnya dikirim setelah kamu mematikan pengingat push), kami langsung menghapus alamat dan kunci itu. Kami hanya menyimpan ID perangkat ini, sidik jari alamat itu, dan waktu kami mengetahuinya, selama sekitar 90 hari, supaya alamat itu tidak disimpan lagi. Log server kami juga mencatat ID perangkat ini saat perangkat ini mendaftar push, mengatur pengingat, atau menerima pengingat, beserta layanan push yang dipakainya, ID acak catatan atau pengingat mingguan terkait, dan kapan setiap pengingat diatur, dikirim, atau dilewati. Log ini dihapus setelah 90 hari. Masukan yang kamu kirim, beserta emailmu kalau kamu mengisinya, disimpan paling lama dua tahun.',
    ko: '로그인하지 않으면 주차 기록은 이 기기에만 있습니다. 삭제하려면 브라우저 저장소를 지우세요. 다만 이미 저희 서버에 있는 데이터는 지워지지 않습니다. 기록에 설정한 푸시 알림은 발송되거나 취소할 때까지 보관됩니다. 매주 푸시 알림은 마지막으로 ParkProof를 연 날부터 90일 이내에 삭제됩니다. 이 기기의 푸시 등록 정보(이 기기의 임의 ID, 브라우저가 제공한 푸시 주소와 암호화 키, 마지막 갱신 시각)는 ParkProof가 마지막으로 갱신한 뒤 약 90일간 보관됩니다. 푸시 알림이 켜진 상태로 앱을 열거나 알림을 설정하면 ParkProof가 이를 갱신합니다. ParkProof나 브라우저에서 푸시 알림을 꺼도 저희 서버에는 알려지지 않으므로, 등록 정보는 위와 같이 보관됩니다. 푸시 서비스가 그 주소가 더 이상 작동하지 않는다고 알려 오면(푸시 알림을 끈 뒤에 전에 설정한 알림이 발송될 때 그럴 수 있습니다), 그 주소와 암호화 키를 즉시 삭제합니다. 그 주소가 다시 저장되지 않도록 이 기기의 ID, 주소의 디지털 지문, 이를 알게 된 시각만 약 90일간 보관합니다. 이 기기가 푸시에 등록하거나 알림을 설정하거나 알림을 받을 때, 저희 서버 로그에는 이 기기의 ID와 함께 사용하는 푸시 서비스, 해당 기록이나 매주 알림의 임의 ID, 각 알림이 설정, 발송 또는 건너뛰어진 시각도 기록됩니다. 이 로그는 90일 후 삭제됩니다. 보내 주신 피드백과 입력하신 이메일은 최대 2년간 보관됩니다.',
    it: "Se non accedi, i tuoi record di parcheggio sono solo su questo dispositivo. Per eliminarli, svuota lo spazio di archiviazione del browser. Questo non elimina ciò che è già sui nostri server. Un promemoria push che hai impostato per un record viene conservato finché non viene inviato o finché non lo annulli. Un promemoria settimanale push viene cancellato entro 90 giorni dall'ultima volta che hai aperto ParkProof. La registrazione push di questo dispositivo (un ID casuale del dispositivo, l'indirizzo push e le chiavi di crittografia che il tuo browser ci ha dato, e quando sono stati rinnovati l'ultima volta) viene conservata per circa 90 giorni dall'ultimo rinnovo da parte di ParkProof. ParkProof la rinnova quando apri l'app con i promemoria push attivi e quando imposti un promemoria. Disattivare i promemoria push, in ParkProof o nel browser, non lo comunica al nostro server, quindi la registrazione viene conservata come sopra. Se il servizio push ci dice che quell'indirizzo non funziona più (può succedere quando un promemoria che hai impostato prima viene inviato dopo che li hai disattivati), cancelliamo subito l'indirizzo e le chiavi. Conserviamo solo l'ID di questo dispositivo, un'impronta digitale dell'indirizzo e il momento in cui l'abbiamo saputo, per circa 90 giorni, così l'indirizzo non viene salvato di nuovo. I log del nostro server registrano anche l'ID di questo dispositivo quando si registra per le notifiche push, imposta un promemoria o ne riceve uno, insieme al servizio push che usa, all'ID casuale del record o del promemoria settimanale e al momento in cui ogni promemoria è stato impostato, inviato o saltato. I log vengono cancellati dopo 90 giorni. Un feedback che ci invii, con la tua email se la indichi, viene conservato fino a due anni.",
    el: 'Αν δεν συνδεθείς, τα αρχεία στάθμευσής σου βρίσκονται μόνο σε αυτή τη συσκευή. Για να τα διαγράψεις, καθάρισε τον αποθηκευτικό χώρο του browser. Αυτό δεν διαγράφει όσα υπάρχουν ήδη στους server μας. Μια υπενθύμιση push που όρισες για ένα αρχείο κρατιέται μέχρι να σταλεί ή να την ακυρώσεις. Μια εβδομαδιαία υπενθύμιση push διαγράφεται μέσα σε 90 ημέρες από την τελευταία φορά που άνοιξες το ParkProof. Η εγγραφή push αυτής της συσκευής (ένα τυχαίο αναγνωριστικό της συσκευής, η διεύθυνση push και τα κλειδιά κρυπτογράφησης που μας έδωσε ο browser σου, και πότε ανανεώθηκαν τελευταία φορά) κρατιέται περίπου 90 ημέρες αφού την ανανέωσε τελευταία φορά το ParkProof. Το ParkProof την ανανεώνει όταν ανοίγεις την εφαρμογή με ενεργές τις υπενθυμίσεις push και όταν ορίζεις μια υπενθύμιση. Αν απενεργοποιήσεις τις υπενθυμίσεις push, στο ParkProof ή στον browser σου, ο server μας δεν ενημερώνεται, οπότε η εγγραφή κρατιέται όπως περιγράφεται παραπάνω. Αν η υπηρεσία push μάς πει ότι αυτή η διεύθυνση δεν λειτουργεί πια (μπορεί να συμβεί όταν μια υπενθύμιση που όρισες νωρίτερα σταλεί αφού τις απενεργοποίησες), διαγράφουμε αμέσως τη διεύθυνση και τα κλειδιά. Κρατάμε μόνο το αναγνωριστικό της συσκευής, ένα αποτύπωμα της διεύθυνσης και το πότε το μάθαμε, για περίπου 90 ημέρες, ώστε η διεύθυνση να μην αποθηκευτεί ξανά. Τα αρχεία καταγραφής του server μας σημειώνουν επίσης το αναγνωριστικό αυτής της συσκευής όταν εγγράφεται για push, ορίζει μια υπενθύμιση ή λαμβάνει μία, μαζί με την υπηρεσία push που χρησιμοποιεί, το τυχαίο αναγνωριστικό του αρχείου στάθμευσης ή της εβδομαδιαίας υπενθύμισης, και πότε ορίστηκε, στάλθηκε ή παραλείφθηκε κάθε υπενθύμιση. Τα αρχεία καταγραφής διαγράφονται μετά από 90 ημέρες. Σχόλια που μας στέλνεις, μαζί με το email σου αν το δώσεις, κρατιούνται έως δύο χρόνια.',
    hi: 'अगर आप साइन इन नहीं करते, तो आपके पार्किंग रिकॉर्ड सिर्फ़ इसी डिवाइस पर रहते हैं। इन्हें हटाने के लिए अपने ब्राउज़र का स्टोरेज साफ़ करें। इससे वह डेटा नहीं हटता जो पहले से हमारे सर्वर पर है। किसी रिकॉर्ड के लिए आपका सेट किया पुश रिमाइंडर भेजे जाने या आपके रद्द करने तक रखा जाता है। साप्ताहिक पुश रिमाइंडर आपके आखिरी बार ParkProof खोलने के 90 दिनों के अंदर मिटा दिया जाता है। इस डिवाइस का पुश पंजीकरण (इस डिवाइस की एक रैंडम ID, आपके ब्राउज़र का दिया पुश पता और एन्क्रिप्शन कुंजियाँ, और इन्हें आखिरी बार कब नवीनीकृत किया गया) ParkProof के आखिरी बार इसे नवीनीकृत करने के बाद करीब 90 दिन तक रखा जाता है। पुश रिमाइंडर चालू रहते हुए ऐप खोलने पर और रिमाइंडर सेट करने पर ParkProof इसे नवीनीकृत करता है। ParkProof में या ब्राउज़र में पुश रिमाइंडर बंद करने से हमारे सर्वर को इसकी सूचना नहीं जाती, इसलिए पंजीकरण ऊपर बताए अनुसार रखा जाता है। अगर पुश सेवा बताती है कि वह पता अब काम नहीं करता (ऐसा तब हो सकता है जब पुश रिमाइंडर बंद करने के बाद पहले से सेट किया गया कोई रिमाइंडर भेजा जाए), तो वह पता और कुंजियाँ तुरंत मिटा दी जाती हैं। सिर्फ़ इस डिवाइस की ID, उस पते का फिंगरप्रिंट और यह जानकारी मिलने का समय करीब 90 दिन तक रखे जाते हैं, ताकि वह पता दोबारा सेव न हो। जब यह डिवाइस पुश के लिए पंजीकरण करता है, रिमाइंडर सेट करता है या उसे कोई रिमाइंडर भेजा जाता है, तब हमारे सर्वर के लॉग में भी इस डिवाइस की ID दर्ज होती है, साथ में इसकी पुश सेवा, संबंधित रिकॉर्ड या साप्ताहिक रिमाइंडर की रैंडम ID, और हर रिमाइंडर के सेट होने, भेजे जाने या छोड़े जाने का समय। ये लॉग 90 दिन बाद मिटा दिए जाते हैं। आपका भेजा फीडबैक, अगर आपने ईमेल दिया हो तो उसके साथ, ज़्यादा से ज़्यादा दो साल तक रखा जाता है।',
    pa: "ਜੇ ਤੁਸੀਂ ਸਾਈਨ ਇਨ ਨਹੀਂ ਕਰਦੇ, ਤਾਂ ਤੁਹਾਡੇ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ ਸਿਰਫ਼ ਇਸੇ ਡਿਵਾਈਸ 'ਤੇ ਹਨ। ਇਨ੍ਹਾਂ ਨੂੰ ਮਿਟਾਉਣ ਲਈ ਆਪਣੇ ਬ੍ਰਾਊਜ਼ਰ ਦੀ ਸਟੋਰੇਜ ਸਾਫ਼ ਕਰੋ। ਇਸ ਨਾਲ ਉਹ ਡੇਟਾ ਨਹੀਂ ਮਿਟਦਾ ਜੋ ਪਹਿਲਾਂ ਹੀ ਸਾਡੇ ਸਰਵਰਾਂ 'ਤੇ ਹੈ। ਕਿਸੇ ਰਿਕਾਰਡ ਲਈ ਤੁਹਾਡਾ ਸੈੱਟ ਕੀਤਾ ਪੁਸ਼ ਰਿਮਾਈਂਡਰ ਭੇਜੇ ਜਾਣ ਜਾਂ ਤੁਹਾਡੇ ਰੱਦ ਕਰਨ ਤੱਕ ਰੱਖਿਆ ਜਾਂਦਾ ਹੈ। ਹਫ਼ਤਾਵਾਰੀ ਪੁਸ਼ ਰਿਮਾਈਂਡਰ ਤੁਹਾਡੇ ਆਖਰੀ ਵਾਰ ParkProof ਖੋਲ੍ਹਣ ਦੇ 90 ਦਿਨਾਂ ਦੇ ਅੰਦਰ ਮਿਟਾ ਦਿੱਤਾ ਜਾਂਦਾ ਹੈ। ਇਸ ਡਿਵਾਈਸ ਦੀ ਪੁਸ਼ ਰਜਿਸਟ੍ਰੇਸ਼ਨ (ਇਸ ਡਿਵਾਈਸ ਦੀ ਇੱਕ ਰੈਂਡਮ ID, ਤੁਹਾਡੇ ਬ੍ਰਾਊਜ਼ਰ ਦਾ ਦਿੱਤਾ ਪੁਸ਼ ਪਤਾ ਅਤੇ ਐਨਕ੍ਰਿਪਸ਼ਨ ਕੁੰਜੀਆਂ, ਅਤੇ ਇਨ੍ਹਾਂ ਨੂੰ ਆਖਰੀ ਵਾਰ ਕਦੋਂ ਨਵਿਆਇਆ ਗਿਆ) ParkProof ਵੱਲੋਂ ਆਖਰੀ ਵਾਰ ਨਵਿਆਉਣ ਤੋਂ ਬਾਅਦ ਲਗਭਗ 90 ਦਿਨ ਤੱਕ ਰੱਖੀ ਜਾਂਦੀ ਹੈ। ਪੁਸ਼ ਰਿਮਾਈਂਡਰ ਚਾਲੂ ਹੋਣ 'ਤੇ ਐਪ ਖੋਲ੍ਹਣ ਅਤੇ ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਕਰਨ 'ਤੇ ParkProof ਇਸ ਨੂੰ ਨਵਿਆਉਂਦਾ ਹੈ। ParkProof ਵਿੱਚ ਜਾਂ ਬ੍ਰਾਊਜ਼ਰ ਵਿੱਚ ਪੁਸ਼ ਰਿਮਾਈਂਡਰ ਬੰਦ ਕਰਨ ਨਾਲ ਸਾਡੇ ਸਰਵਰ ਨੂੰ ਇਸ ਦੀ ਸੂਚਨਾ ਨਹੀਂ ਜਾਂਦੀ, ਇਸ ਲਈ ਰਜਿਸਟ੍ਰੇਸ਼ਨ ਉੱਪਰ ਦੱਸੇ ਅਨੁਸਾਰ ਰੱਖੀ ਜਾਂਦੀ ਹੈ। ਜੇ ਪੁਸ਼ ਸੇਵਾ ਦੱਸਦੀ ਹੈ ਕਿ ਉਹ ਪਤਾ ਹੁਣ ਕੰਮ ਨਹੀਂ ਕਰਦਾ (ਅਜਿਹਾ ਉਦੋਂ ਹੋ ਸਕਦਾ ਹੈ ਜਦੋਂ ਪੁਸ਼ ਰਿਮਾਈਂਡਰ ਬੰਦ ਕਰਨ ਤੋਂ ਬਾਅਦ ਪਹਿਲਾਂ ਸੈੱਟ ਕੀਤਾ ਕੋਈ ਰਿਮਾਈਂਡਰ ਭੇਜਿਆ ਜਾਵੇ), ਤਾਂ ਉਹ ਪਤਾ ਅਤੇ ਕੁੰਜੀਆਂ ਤੁਰੰਤ ਮਿਟਾ ਦਿੱਤੀਆਂ ਜਾਂਦੀਆਂ ਹਨ। ਸਿਰਫ਼ ਇਸ ਡਿਵਾਈਸ ਦੀ ID, ਉਸ ਪਤੇ ਦਾ ਫਿੰਗਰਪ੍ਰਿੰਟ ਅਤੇ ਇਹ ਜਾਣਕਾਰੀ ਮਿਲਣ ਦਾ ਸਮਾਂ ਲਗਭਗ 90 ਦਿਨ ਤੱਕ ਰੱਖੇ ਜਾਂਦੇ ਹਨ, ਤਾਂ ਜੋ ਉਹ ਪਤਾ ਦੁਬਾਰਾ ਸੇਵ ਨਾ ਹੋਵੇ। ਜਦੋਂ ਇਹ ਡਿਵਾਈਸ ਪੁਸ਼ ਲਈ ਰਜਿਸਟਰ ਕਰਦੀ ਹੈ, ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਕਰਦੀ ਹੈ ਜਾਂ ਇਸ ਨੂੰ ਕੋਈ ਰਿਮਾਈਂਡਰ ਭੇਜਿਆ ਜਾਂਦਾ ਹੈ, ਤਾਂ ਸਾਡੇ ਸਰਵਰ ਦੇ ਲੌਗ ਵਿੱਚ ਵੀ ਇਸ ਡਿਵਾਈਸ ਦੀ ID ਦਰਜ ਹੁੰਦੀ ਹੈ, ਨਾਲ ਹੀ ਇਸ ਦੀ ਪੁਸ਼ ਸੇਵਾ, ਸਬੰਧਤ ਰਿਕਾਰਡ ਜਾਂ ਹਫ਼ਤਾਵਾਰੀ ਰਿਮਾਈਂਡਰ ਦੀ ਰੈਂਡਮ ID, ਅਤੇ ਹਰ ਰਿਮਾਈਂਡਰ ਦੇ ਸੈੱਟ ਹੋਣ, ਭੇਜੇ ਜਾਣ ਜਾਂ ਛੱਡੇ ਜਾਣ ਦਾ ਸਮਾਂ। ਇਹ ਲੌਗ 90 ਦਿਨਾਂ ਬਾਅਦ ਮਿਟਾ ਦਿੱਤੇ ਜਾਂਦੇ ਹਨ। ਤੁਹਾਡਾ ਭੇਜਿਆ ਫੀਡਬੈਕ, ਜੇ ਤੁਸੀਂ ਈਮੇਲ ਦਿੱਤੀ ਹੋਵੇ ਤਾਂ ਉਸ ਸਮੇਤ, ਵੱਧ ਤੋਂ ਵੱਧ ਦੋ ਸਾਲ ਤੱਕ ਰੱਖਿਆ ਜਾਂਦਾ ਹੈ।",
  },
  // ═══ Fix round 2: what the "did we read this right?" log holds ═════════
  // Every field of the [parkproof.feedback] line, named in plain words
  // (src/lib/privacy-feedback-log.test.tsx pins the field list), and the
  // log group's retention (scripts/setup-log-retention.sh).
  'privacy.anonymousCloudwatch': {
    en: "<strong>When you tell us whether we read a sign right</strong>, ParkProof's server logs your answer in <strong>AWS CloudWatch</strong>, with when you gave it and a random ID for that answer. With it go details of the reading: the first 120 characters of its description of the sign's rules, how sure it was, the time limit, any payment methods and permit area, whether it asked where you parked and the option you picked, and how many groups of rules, reading problems and weekly restrictions it found. They also say whether the sign was readable, whether the reading was a re-check, and whether it found an area sign, paid parking, a permit zone or an accessible parking bay, and give the hour of day where the sign is. Your answers so far to the paid parking, permit zone and accessible parking permit questions are logged too, so a log line can show that you said an accessible parking permit was displayed. The log doesn't include the photo, its GPS location, or an ID for you or this device. We use it to find where sign readings go wrong. It's deleted after 90 days.",
    'zh-CN':
      '<strong>当你告诉我们标志读得对不对时</strong>，ParkProof 的服务器会把你的回答记录到 <strong>AWS CloudWatch</strong>，同时记录你回答的时间和这个回答的随机 ID。一起记录的还有这次读取的详情：它对标志规则的描述的前 120 个字符、它有多确定、时间限制、标志上的付款方式和许可证区域编号（如有）、它是否问过你停在哪个位置以及你选了哪个选项，以及它找到的规则组数、读取问题数和每周限制数。这些详情还会说明标志是否可读、这次读取是不是重新检查、是否发现适用于整片停车区域的标志、收费停车、许可证区域或无障碍车位，并给出标志所在地当时是几点。你当时对收费停车、许可证区域和无障碍停车许可证这几个问题已经作出的回答也会被记录，所以一条日志可能显示你表示已展示无障碍停车许可证。日志不包含照片、照片的 GPS 位置，也不包含识别你或这台设备的 ID。我们用这些日志找出标志读取在哪里出错。日志会在 90 天后删除。',
    vi: '<strong>Khi bạn cho chúng tôi biết chúng tôi đọc biển báo có đúng không</strong>, máy chủ của ParkProof ghi câu trả lời của bạn vào <strong>AWS CloudWatch</strong>, kèm thời điểm bạn trả lời và một mã ngẫu nhiên cho câu trả lời đó. Cùng với đó là các chi tiết của lần đọc: 120 ký tự đầu tiên trong phần mô tả các quy định của biển báo, mức độ chắc chắn, giới hạn thời gian, các cách thanh toán và khu vực giấy phép (nếu có), việc có hỏi bạn đỗ ở vị trí nào không và lựa chọn của bạn, cùng số nhóm quy định, số vấn đề khi đọc và số hạn chế hằng tuần tìm thấy. Các chi tiết này cũng cho biết biển báo có đọc được không, lần đọc có phải là kiểm tra lại không, có phát hiện biển báo áp dụng cho cả một khu vực đỗ xe, chỗ đỗ xe trả phí, khu vực giấy phép hay chỗ đỗ xe tiếp cận không, và lúc đó là mấy giờ tại nơi có biển báo. Các câu trả lời bạn đã đưa ra đến lúc đó cho các câu hỏi về đỗ xe trả phí, khu vực giấy phép và giấy phép đỗ xe tiếp cận cũng được ghi lại, nên một dòng nhật ký có thể cho thấy bạn đã nói có giấy phép đỗ xe tiếp cận được hiển thị. Nhật ký không có ảnh, vị trí GPS của ảnh, hay mã nào nhận dạng bạn hoặc thiết bị này. Chúng tôi dùng nhật ký này để tìm ra chỗ đọc biển báo bị sai. Nhật ký bị xoá sau 90 ngày.',
    id: '<strong>Saat kamu memberi tahu kami apakah rambu terbaca dengan benar</strong>, server ParkProof mencatat jawabanmu di <strong>AWS CloudWatch</strong>, beserta waktu kamu menjawab dan ID acak untuk jawaban itu. Bersamanya dicatat juga rincian bacaannya: 120 karakter pertama dari deskripsi aturan rambu, seberapa yakin bacaannya, batas waktunya, cara pembayaran dan area izin (kalau ada), apakah kamu ditanya di posisi mana kamu parkir dan pilihan yang kamu ambil, serta berapa kelompok aturan, masalah saat membaca, dan larangan mingguan yang ditemukan. Rincian itu juga menyebut apakah rambunya bisa dibaca, apakah bacaan itu cek ulang, apakah ditemukan rambu untuk seluruh area parkir, parkir berbayar, zona izin, atau tempat parkir aksesibel, serta jam berapa saat itu di lokasi rambu. Jawabanmu sampai saat itu untuk pertanyaan parkir berbayar, zona izin, dan izin parkir aksesibel juga dicatat, jadi satu baris log bisa menunjukkan bahwa kamu menyatakan izin parkir aksesibel ditampilkan. Log ini tidak memuat foto, lokasi GPS foto, atau ID untuk kamu maupun perangkat ini. Kami memakainya untuk menemukan di mana pembacaan rambu salah. Log ini dihapus setelah 90 hari.',
    ko: '<strong>표지판을 제대로 읽었는지 알려 주시면</strong> ParkProof 서버가 그 답을 답한 시각, 그 답에 붙인 임의 ID와 함께 <strong>AWS CloudWatch</strong>에 기록합니다. 판독 내용도 함께 기록됩니다. 표지판 규칙 설명의 처음 120자, 판독의 확신 정도, 시간 제한, 결제 방법과 허가 구역 번호(있는 경우), 주차 위치를 물었는지와 고른 선택지, 찾아낸 규칙 묶음, 판독 문제, 매주 반복되는 제한의 개수입니다. 표지판을 읽을 수 있었는지, 다시 확인한 판독인지, 주차 구역 전체에 적용되는 표지판, 유료 주차, 허가 구역, 장애인 주차 구역을 찾았는지, 표지판이 있는 곳의 당시 시각(시 단위)도 기록됩니다. 유료 주차, 허가 구역, 장애인 주차 허가증 질문에 그때까지 한 답도 기록되므로, 로그 한 줄에서 장애인 주차 허가증을 표시해 두었다고 답한 사실이 드러날 수 있습니다. 로그에는 사진, 사진의 GPS 위치, 본인이나 이 기기를 식별하는 ID가 들어가지 않습니다. 이 로그는 표지판 판독이 어디서 틀리는지 찾는 데 씁니다. 로그는 90일 후 삭제됩니다.',
    it: "<strong>Quando ci dici se abbiamo letto bene un cartello</strong>, il server di ParkProof registra la tua risposta su <strong>AWS CloudWatch</strong>, insieme a quando l'hai data e a un ID casuale per quella risposta. Con essa vengono registrati i dettagli della lettura: i primi 120 caratteri della descrizione delle regole del cartello, quanto era sicura la lettura, il limite di tempo, gli eventuali metodi di pagamento e l'area del permesso, se ti ha chiesto dove hai parcheggiato e l'opzione che hai scelto, e quanti gruppi di regole, problemi di lettura e restrizioni settimanali ha trovato. Dicono anche se il cartello era leggibile, se la lettura era un ricontrollo, se ha trovato un cartello valido per un'intera area di parcheggio, un parcheggio a pagamento, una zona a permesso o un posto accessibile, e l'ora del giorno nel luogo del cartello. Vengono registrate anche le risposte che avevi dato fino a quel momento alle domande sul parcheggio a pagamento, sulla zona a permesso e sul permesso di parcheggio accessibile, quindi una riga del log può mostrare che hai detto che era esposto un permesso di parcheggio accessibile. Il log non contiene la foto, la sua posizione GPS né un ID tuo o di questo dispositivo. Lo usiamo per capire dove sbaglia la lettura dei cartelli. Viene cancellato dopo 90 giorni.",
    el: '<strong>Όταν μας λες αν διαβάσαμε σωστά μια πινακίδα</strong>, ο server του ParkProof καταγράφει την απάντησή σου στο <strong>AWS CloudWatch</strong>, μαζί με το πότε την έδωσες και ένα τυχαίο αναγνωριστικό για αυτή την απάντηση. Μαζί της καταγράφονται λεπτομέρειες της ανάγνωσης: οι πρώτοι 120 χαρακτήρες της περιγραφής των κανόνων της πινακίδας, πόσο σίγουρη ήταν η ανάγνωση, το χρονικό όριο, όποιοι τρόποι πληρωμής και όποια περιοχή άδειας υπάρχουν, αν σε ρώτησε πού πάρκαρες και ποια επιλογή διάλεξες, και πόσες ομάδες κανόνων, πόσα προβλήματα ανάγνωσης και πόσους εβδομαδιαίους περιορισμούς βρήκε. Λένε επίσης αν η πινακίδα διαβαζόταν, αν η ανάγνωση ήταν νέος έλεγχος, αν βρήκε πινακίδα για ολόκληρη περιοχή στάθμευσης, στάθμευση με πληρωμή, ζώνη άδειας ή θέση προσβάσιμης στάθμευσης, και τι ώρα ήταν εκεί που βρίσκεται η πινακίδα. Καταγράφονται επίσης όσες απαντήσεις είχες δώσει ως τότε στις ερωτήσεις για τη στάθμευση με πληρωμή, τη ζώνη άδειας και την άδεια προσβάσιμης στάθμευσης, οπότε μια γραμμή καταγραφής μπορεί να δείχνει ότι είπες πως μια άδεια προσβάσιμης στάθμευσης ήταν σε εμφανές σημείο. Η καταγραφή δεν περιέχει τη φωτογραφία, τη θέση GPS της ούτε κάποιο αναγνωριστικό για σένα ή για αυτή τη συσκευή. Τη χρησιμοποιούμε για να βρίσκουμε πού κάνει λάθη η ανάγνωση των πινακίδων. Διαγράφεται μετά από 90 ημέρες.',
    hi: '<strong>जब आप बताते हैं कि हमने साइन सही पढ़ा या नहीं</strong>, तो ParkProof का सर्वर आपका जवाब <strong>AWS CloudWatch</strong> में दर्ज करता है, साथ में जवाब देने का समय और उस जवाब की एक रैंडम ID। इसके साथ रीडिंग का ब्योरा भी दर्ज होता है: साइन के नियमों के विवरण के पहले 120 अक्षर, रीडिंग कितनी पक्की थी, समय सीमा, भुगतान के तरीके और परमिट क्षेत्र (अगर हों), क्या आपसे पूछा गया कि आपने कहाँ पार्क किया और आपने कौन-सा विकल्प चुना, और कितने नियम-समूह, पढ़ने में आई दिक्कतें और साप्ताहिक प्रतिबंध मिले। इसमें यह भी दर्ज होता है कि साइन पढ़ने लायक था या नहीं, रीडिंग दोबारा जाँच थी या नहीं, क्या पूरे पार्किंग इलाके का साइन, भुगतान वाली पार्किंग, परमिट क्षेत्र या सुलभ पार्किंग की जगह मिली, और साइन वाली जगह पर उस समय कितने बजे थे। भुगतान वाली पार्किंग, परमिट क्षेत्र और सुलभ पार्किंग परमिट के सवालों के उस समय तक दिए गए आपके जवाब भी दर्ज होते हैं, इसलिए लॉग की एक पंक्ति से यह पता चल सकता है कि आपने कहा था कि सुलभ पार्किंग परमिट प्रदर्शित है। लॉग में फ़ोटो, उसका GPS स्थान, या आपकी या इस डिवाइस की पहचान करने वाली कोई ID नहीं होती। इन लॉग का इस्तेमाल यह पता लगाने के लिए किया जाता है कि साइन पढ़ने में गलती कहाँ होती है। ये लॉग 90 दिन बाद मिटा दिए जाते हैं।',
    pa: "<strong>ਜਦੋਂ ਤੁਸੀਂ ਦੱਸਦੇ ਹੋ ਕਿ ਅਸੀਂ ਚਿੰਨ੍ਹ ਸਹੀ ਪੜ੍ਹਿਆ ਜਾਂ ਨਹੀਂ</strong>, ਤਾਂ ParkProof ਦਾ ਸਰਵਰ ਤੁਹਾਡਾ ਜਵਾਬ <strong>AWS CloudWatch</strong> ਵਿੱਚ ਦਰਜ ਕਰਦਾ ਹੈ, ਨਾਲ ਹੀ ਜਵਾਬ ਦੇਣ ਦਾ ਸਮਾਂ ਅਤੇ ਉਸ ਜਵਾਬ ਦੀ ਇੱਕ ਰੈਂਡਮ ID। ਇਸ ਦੇ ਨਾਲ ਰੀਡਿੰਗ ਦਾ ਵੇਰਵਾ ਵੀ ਦਰਜ ਹੁੰਦਾ ਹੈ: ਚਿੰਨ੍ਹ ਦੇ ਨਿਯਮਾਂ ਦੇ ਵੇਰਵੇ ਦੇ ਪਹਿਲੇ 120 ਅੱਖਰ, ਰੀਡਿੰਗ ਕਿੰਨੀ ਪੱਕੀ ਸੀ, ਸਮਾਂ ਸੀਮਾ, ਭੁਗਤਾਨ ਦੇ ਤਰੀਕੇ ਅਤੇ ਪਰਮਿਟ ਖੇਤਰ (ਜੇ ਹੋਣ), ਕੀ ਤੁਹਾਡੇ ਤੋਂ ਪੁੱਛਿਆ ਗਿਆ ਕਿ ਤੁਸੀਂ ਕਿੱਥੇ ਪਾਰਕ ਕੀਤਾ ਅਤੇ ਤੁਸੀਂ ਕਿਹੜਾ ਵਿਕਲਪ ਚੁਣਿਆ, ਅਤੇ ਕਿੰਨੇ ਨਿਯਮ-ਸਮੂਹ, ਪੜ੍ਹਨ ਵਿੱਚ ਆਈਆਂ ਦਿੱਕਤਾਂ ਅਤੇ ਹਫ਼ਤਾਵਾਰੀ ਪਾਬੰਦੀਆਂ ਮਿਲੀਆਂ। ਇਸ ਵਿੱਚ ਇਹ ਵੀ ਦਰਜ ਹੁੰਦਾ ਹੈ ਕਿ ਚਿੰਨ੍ਹ ਪੜ੍ਹਨਯੋਗ ਸੀ ਜਾਂ ਨਹੀਂ, ਰੀਡਿੰਗ ਮੁੜ ਜਾਂਚ ਸੀ ਜਾਂ ਨਹੀਂ, ਕੀ ਪੂਰੇ ਪਾਰਕਿੰਗ ਇਲਾਕੇ ਦਾ ਚਿੰਨ੍ਹ, ਭੁਗਤਾਨ ਵਾਲੀ ਪਾਰਕਿੰਗ, ਪਰਮਿਟ ਜ਼ੋਨ ਜਾਂ ਪਹੁੰਚਯੋਗ ਪਾਰਕਿੰਗ ਵਾਲੀ ਥਾਂ ਮਿਲੀ, ਅਤੇ ਚਿੰਨ੍ਹ ਵਾਲੀ ਥਾਂ 'ਤੇ ਉਸ ਸਮੇਂ ਕਿੰਨੇ ਵੱਜੇ ਸਨ। ਭੁਗਤਾਨ ਵਾਲੀ ਪਾਰਕਿੰਗ, ਪਰਮਿਟ ਜ਼ੋਨ ਅਤੇ ਪਹੁੰਚਯੋਗ ਪਾਰਕਿੰਗ ਪਰਮਿਟ ਦੇ ਸਵਾਲਾਂ ਦੇ ਉਸ ਸਮੇਂ ਤੱਕ ਦਿੱਤੇ ਤੁਹਾਡੇ ਜਵਾਬ ਵੀ ਦਰਜ ਹੁੰਦੇ ਹਨ, ਇਸ ਲਈ ਲੌਗ ਦੀ ਇੱਕ ਲਾਈਨ ਤੋਂ ਇਹ ਪਤਾ ਲੱਗ ਸਕਦਾ ਹੈ ਕਿ ਤੁਸੀਂ ਕਿਹਾ ਸੀ ਕਿ ਪਹੁੰਚਯੋਗ ਪਾਰਕਿੰਗ ਪਰਮਿਟ ਦਿਖਾਇਆ ਗਿਆ ਹੈ। ਲੌਗ ਵਿੱਚ ਫੋਟੋ, ਉਸ ਦਾ GPS ਸਥਾਨ, ਜਾਂ ਤੁਹਾਡੀ ਜਾਂ ਇਸ ਡਿਵਾਈਸ ਦੀ ਪਛਾਣ ਕਰਨ ਵਾਲੀ ਕੋਈ ID ਨਹੀਂ ਹੁੰਦੀ। ਇਨ੍ਹਾਂ ਲੌਗਾਂ ਦੀ ਵਰਤੋਂ ਇਹ ਪਤਾ ਲਗਾਉਣ ਲਈ ਕੀਤੀ ਜਾਂਦੀ ਹੈ ਕਿ ਚਿੰਨ੍ਹ ਪੜ੍ਹਨ ਵਿੱਚ ਗਲਤੀ ਕਿੱਥੇ ਹੁੰਦੀ ਹੈ। ਇਹ ਲੌਗ 90 ਦਿਨਾਂ ਬਾਅਦ ਮਿਟਾ ਦਿੱਤੇ ਜਾਂਦੇ ਹਨ।",
  },
}

// ── Keys deleted from all 9 locales ──────────────────────────────────────
// Each one has no reader in src (grep, including keys built at run time),
// and no script adds it any more. Deleted when present, so a re-run over
// files that no longer have them changes nothing. A parent object the
// deletions leave empty (landing.feature) goes too.
const DELETIONS = [
  // Item 3: never rendered.
  'appeal.strongEvidence',
  'appeal.moderateEvidence',
  'appeal.weakEvidence',
  'landing.feature.translateTitle',
  'landing.feature.translateDesc',
  'landing.feature.evidenceTitle',
  'landing.feature.evidenceDesc',
  'landing.feature.appealTitle',
  'landing.feature.appealDesc',
  'prefs.remindersReliability',
  'active.shareAria',
  'notice.homeLink',
  // Item 4: the weekly reminders home row reads recurring.homeRow.
  'home.weeklyReminders',
]

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

/**
 * Delete a string key when present, then every parent object the deletion
 * left empty. Never deletes an object key or anything else.
 */
function remove(root, path, locale) {
  const parts = path.split('.')
  const leaf = parts.pop()
  const chain = [root]
  for (const p of parts) {
    const node = chain[chain.length - 1]
    const next = node && typeof node === 'object' && !Array.isArray(node) ? node[p] : undefined
    if (!next || typeof next !== 'object' || Array.isArray(next)) return
    chain.push(next)
  }
  const holder = chain[chain.length - 1]
  if (!(leaf in holder)) return
  if (typeof holder[leaf] !== 'string') fail(`${locale}: ${path} to delete is not a string`)
  delete holder[leaf]
  for (let i = chain.length - 1; i > 0; i--) {
    if (Object.keys(chain[i]).length > 0) break
    delete chain[i - 1][parts[i - 1]]
  }
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

/** U+2014, which the copy rules ban. */
const EM_DASH = String.fromCharCode(0x2014)

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
    for (const path of DELETIONS) if (path in flat) problems.push(`${locale}: ${path} is still there after deleting it`)
  }
  for (const [path, byLocale] of [...Object.entries(ADDITIONS), ...Object.entries(OVERWRITES)]) {
    if (DELETIONS.includes(path)) problems.push(`${path} is both written and deleted`)
    if (path.endsWith('_one')) {
      for (const [locale, s] of Object.entries(byLocale)) {
        if (!s.includes('{{count}}')) problems.push(`${locale}: ${path} must use {{count}}`)
      }
    }
    for (const [locale, s] of Object.entries(byLocale)) {
      // Copy rules: no em-dashes, and no symbols or emoji in new copy.
      if (s.includes(EM_DASH)) problems.push(`${locale}: em-dash in new copy at ${path}`)
      if (/[✓⚠→≈≤±\u{1F300}-\u{1FAFF}]/u.test(s)) problems.push(`${locale}: symbol in new copy at ${path}`)
    }
    // The en record noun is "record", never "session".
    if (/\bsessions?\b/i.test(byLocale.en)) problems.push(`"session" in en copy at ${path}`)
    // Words and claims the copy rules ban outright.
    if (
      /\b(reset|compliant|compliance proven|admissible|authentic|verified location|accepted by (insurers|council)|strong evidence|proves?|proved)\b/i.test(
        byLocale.en,
      )
    ) {
      problems.push(`banned wording in en copy at ${path}`)
    }
    // "ticket" alone can read as the fine notice; say "meter ticket".
    if (/(?<!meter )\btickets?\b/i.test(byLocale.en)) problems.push(`ambiguous "ticket" in en copy at ${path}`)
  }
  return problems
}

/**
 * The copy pass runs after this script and wins on every key it
 * overwrites, so: a key this script overwrites or adds that the copy pass
 * also overwrites must carry this script's text there, and a key this
 * script deletes must not be in any copy-pass file.
 */
function copyPassProblems() {
  const problems = []
  for (const locale of LOCALES) {
    const file = join(PASS, `${locale}.json`)
    if (!existsSync(file)) continue
    const pass = JSON.parse(readFileSync(file, 'utf8'))
    for (const [path, byLocale] of [...Object.entries(ADDITIONS), ...Object.entries(OVERWRITES)]) {
      if (path in pass && pass[path] !== byLocale[locale]) {
        problems.push(`${locale}: scripts/copy-pass/${locale}.json has other text for ${path}, which would undo this script`)
      }
    }
    for (const path of DELETIONS) {
      if (path in pass) problems.push(`${locale}: scripts/copy-pass/${locale}.json still overwrites deleted key ${path}`)
    }
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
  for (const k of DELETIONS) console.log(`      ${k}  (deleted)`)
  process.exit(0)
}

// ── run ─────────────────────────────────────────────────────────────────
const passProblems = copyPassProblems()
if (passProblems.length) fail(`\n  ${passProblems.join('\n  ')}`)

const original = {}
const data = {}
for (const locale of LOCALES) {
  original[locale] = readFileSync(join(LOC, `${locale}.json`), 'utf8')
  data[locale] = JSON.parse(original[locale])
}

for (const locale of LOCALES) {
  for (const path of DELETIONS) remove(data[locale], path, locale)
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
