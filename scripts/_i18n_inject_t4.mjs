/**
 * T4 i18n (roadmap build spec, task T4: settings, permits, driver name,
 * privacy, home layout). Idempotent: running it twice leaves the files
 * byte-identical after the first run.
 *
 * Adds:
 *   - `prefs`: the new anonymous Settings view (items 1 and 2): the driver
 *     name ("Your name on records you share"), My permits (type, issuing
 *     state, area or zone, expiry), the accessible-permit warning shown
 *     before such a permit is saved (spec wording), the notifications
 *     section's extra lines (the reminder reliability line, and what an
 *     unsupported browser can still do), and the way to Account or sign-in.
 *     The state and permit-type names are key maps (prefs.state.*,
 *     prefs.permitType.*), never raw codes.
 *   - `privacy.anonymousFineNotice` (item 8): infringement notice photos sent
 *     to the AI.
 *   - `result.permit.*` (items 4 and 5): the standard answer's label, the
 *     permit answer card (the sign's own exception words), the area match,
 *     "Your permit may allow more time under {{state}} rules..." (spec
 *     wording, plus a variant for when the state isn't known for sure), the
 *     accessible-permit safeguard and its "no" (spec wording), the
 *     resident and business question (spec wording), and the optional
 *     later permit time the driver types in from the sign (item 6).
 *   - `reminders.permit*`, `scheduledReminders.firesAtStandardEnd` (item 6):
 *     reminders on a record whose permit allows a later time, including the
 *     spec's "The standard limit on this sign ends now..." reminder.
 *   - `home.weeklyReminders`, `home.settings`, `home.settingsSignIn`,
 *     `home.startWorkday`, `home.fineStart`, `active.shareAria` (item 9):
 *     the home layout's rows and links, and the home card's Share icon.
 *   - Review fixes: `prefs.privacyCta` (Settings' own key);
 *     `reminders.reliability` (the copy rule's reliability line on every
 *     reminder screen); `reminders.chipAtPermitTime`,
 *     `reminders.permitBody*`, `reminders.calendarPermit*`,
 *     `scheduledReminders.fires*PermitTime*` (a permit time is the time the
 *     driver entered, never called an expiry); `reminders.permitChipLimit*`
 *     (push takes at most 6 reminders a record); `privacy.anonymousPush`,
 *     `privacy.anonymousPermits`, `privacy.signedInPermits` (what happens
 *     to push text and to the permit details kept with a record).
 *
 * Changes (OVERWRITES, item 8):
 *   - `privacy.anonymousIntro`: the spec wording (no account; records in
 *     this browser; what signing sends and that the server keeps no copy).
 *   - `privacy.anonymousThings`: no longer "Three things".
 *   - `privacy.anonymousAnthropic`: what is sent to the AI with each scan:
 *     the photo, its location and the saved permit types (and the area of a
 *     resident or business permit), and what is kept.
 *   - `home.history` (item 9): "History", not "Session history".
 *
 * Later units of T4 extend this script (one script per task); keep each
 * unit's keys in its own block below.
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces).
 *
 * Run:   node scripts/_i18n_inject_t4.mjs
 * List:  node scripts/_i18n_inject_t4.mjs --list
 *        prints every key this task added or changed, for the T10
 *        translation review ('legal' marks the statements a lawyer should read).
 * Other: node scripts/_i18n_inject_t4.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']
/** Locales whose PDFs use jsPDF's built-in Helvetica (WinAnsi only). */
const HELVETICA_LOCALES = ['en', 'it', 'id']

/** Keys whose wording makes a claim a lawyer should read (docs/legal-review-queue.md, T10). */
const LEGAL = new Set([
  'prefs.accessibleWarning',
  'prefs.permitsIntro',
  'privacy.anonymousIntro',
  'privacy.anonymousAnthropic',
  'privacy.anonymousFineNotice',
  'result.permit.areaMatch',
  'result.permit.areaMismatch',
  'result.permit.mayAllowMore',
  'result.permit.mayAllowMoreNoState',
  'result.permit.accessibleQuestion',
  'result.permit.accessibleNo',
  'result.permit.forThisCarQuestion',
  'result.permit.forThisCarNo',
  'result.permit.noStandardApplies',
  'result.permit.checkConditions',
  'result.permit.timeHint',
  'reminders.permitStandardEnds',
  'reminders.permitBodyAt',
  'reminders.permitBodyBefore_one',
  'reminders.permitBodyBefore_other',
  'reminders.calendarPermitSummary',
  'privacy.anonymousPush',
  'privacy.anonymousPermits',
  'privacy.signedInPermits',
])

// ── New keys, appended inside their parent object ────────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position). Missing parent objects are created,
// appended at the end of their own parent.
const ADDITIONS = {
  // ═══ Unit: settings and privacy (items 1, 2, 3, 7, 8) ═══════════════════
  'prefs.header': {
    en: 'Settings',
    'zh-CN': '设置',
    vi: 'Cài đặt',
    id: 'Pengaturan',
    ko: '설정',
    it: 'Impostazioni',
    el: 'Ρυθμίσεις',
    hi: 'सेटिंग्स',
    pa: 'ਸੈਟਿੰਗਾਂ',
  },
  'prefs.intro': {
    en: 'Saved in this browser only, not in your account.',
    'zh-CN': '只保存在这个浏览器里,不会存进你的账户。',
    vi: 'Chỉ được lưu trong trình duyệt này, không lưu vào tài khoản của bạn.',
    id: 'Hanya disimpan di browser ini, tidak di akunmu.',
    ko: '이 브라우저에만 저장되며 계정에는 저장되지 않습니다.',
    it: 'Salvate solo in questo browser, non nel tuo account.',
    el: 'Αποθηκεύονται μόνο σε αυτόν τον browser, όχι στον λογαριασμό σου.',
    hi: 'ये सिर्फ़ इसी ब्राउज़र में सहेजी जाती हैं, आपके खाते में नहीं।',
    pa: 'ਇਹ ਸਿਰਫ਼ ਇਸੇ ਬ੍ਰਾਊਜ਼ਰ ਵਿੱਚ ਸੰਭਾਲੀਆਂ ਜਾਂਦੀਆਂ ਹਨ, ਤੁਹਾਡੇ ਖਾਤੇ ਵਿੱਚ ਨਹੀਂ।',
  },
  // Spec T4 item 2, exact.
  'prefs.driverNameLabel': {
    en: 'Your name on records you share',
    'zh-CN': '你分享的记录上显示的名字',
    vi: 'Tên của bạn trên các bản ghi bạn chia sẻ',
    id: 'Namamu di catatan yang kamu bagikan',
    ko: '공유하는 기록에 표시될 이름',
    it: 'Il tuo nome sui record che condividi',
    el: 'Το όνομά σου στα αρχεία που μοιράζεσαι',
    hi: 'आपके साझा किए गए रिकॉर्ड पर आपका नाम',
    pa: "ਤੁਹਾਡੇ ਸਾਂਝੇ ਕੀਤੇ ਰਿਕਾਰਡਾਂ 'ਤੇ ਤੁਹਾਡਾ ਨਾਮ",
  },
  'prefs.driverNameHint': {
    en: 'New parking records list this as the driver. Leave it blank to leave it off.',
    'zh-CN': '新的停车记录会把这个名字填为驾驶员。留空就不会填写。',
    vi: 'Các bản ghi đỗ xe mới sẽ ghi tên này là tài xế. Để trống nếu bạn không muốn ghi.',
    id: 'Catatan parkir baru mencantumkan nama ini sebagai pengemudi. Kosongkan kalau tidak mau dicantumkan.',
    ko: '새 주차 기록에 이 이름이 운전자로 표시됩니다. 표시하지 않으려면 비워 두세요.',
    it: 'I nuovi record di parcheggio indicano questo nome come conducente. Lascia vuoto per non indicarlo.',
    el: 'Τα νέα αρχεία στάθμευσης γράφουν αυτό το όνομα ως οδηγό. Άφησέ το κενό για να μη γράφεται.',
    hi: 'नए पार्किंग रिकॉर्ड में यही नाम चालक के रूप में लिखा जाएगा। नाम न लिखवाना हो, तो इसे खाली छोड़ दें।',
    pa: 'ਨਵੇਂ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡਾਂ ਵਿੱਚ ਇਹੀ ਨਾਮ ਡਰਾਈਵਰ ਵਜੋਂ ਲਿਖਿਆ ਜਾਵੇਗਾ। ਨਾਮ ਨਾ ਲਿਖਵਾਉਣਾ ਹੋਵੇ, ਤਾਂ ਇਸ ਨੂੰ ਖ਼ਾਲੀ ਛੱਡ ਦਿਓ।',
  },
  'prefs.saveName': {
    en: 'Save name',
    'zh-CN': '保存名字',
    vi: 'Lưu tên',
    id: 'Simpan nama',
    ko: '이름 저장',
    it: 'Salva nome',
    el: 'Αποθήκευση ονόματος',
    hi: 'नाम सहेजें',
    pa: 'ਨਾਮ ਸੰਭਾਲੋ',
  },
  'prefs.saved': {
    en: 'Saved',
    'zh-CN': '已保存',
    vi: 'Đã lưu',
    id: 'Tersimpan',
    ko: '저장됨',
    it: 'Salvato',
    el: 'Αποθηκεύτηκε',
    hi: 'सहेज लिया गया',
    pa: 'ਸੰਭਾਲ ਲਿਆ ਗਿਆ',
  },
  'prefs.saveFailed': {
    en: "Couldn't save. Try again.",
    'zh-CN': '无法保存。请再试一次。',
    vi: 'Không lưu được. Hãy thử lại.',
    id: 'Gagal menyimpan. Coba lagi.',
    ko: '저장하지 못했습니다. 다시 시도해 주세요.',
    it: 'Impossibile salvare. Riprova.',
    el: 'Δεν αποθηκεύτηκε. Δοκίμασε ξανά.',
    hi: 'सहेजा नहीं जा सका। फिर से कोशिश करें।',
    pa: 'ਸੰਭਾਲਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
  },
  'prefs.permitsHeader': {
    en: 'My permits',
    'zh-CN': '我的许可证',
    vi: 'Giấy phép của tôi',
    id: 'Izin saya',
    ko: '내 허가증',
    it: 'I miei permessi',
    el: 'Οι άδειές μου',
    hi: 'मेरे परमिट',
    pa: 'ਮੇਰੇ ਪਰਮਿਟ',
  },
  'prefs.permitsIntro': {
    en: 'Saved permits are sent with each sign you scan or re-check, so the answer can include what the sign says about them. Only the permit type is sent, plus the area or zone of a resident or business permit.',
    'zh-CN':
      '已保存的许可证会随你扫描或重新检查的每个标志一起发送,这样答案就能包含标志上关于这些许可证的内容。只会发送许可证类型,居民或商户许可证还会附上区域。',
    vi: 'Giấy phép đã lưu được gửi kèm mỗi biển báo bạn quét hoặc kiểm tra lại, để câu trả lời có thể nêu những gì biển báo ghi về chúng. Chỉ loại giấy phép được gửi, cùng với khu vực của giấy phép cư dân hoặc doanh nghiệp.',
    id: 'Izin yang tersimpan dikirim bersama setiap rambu yang kamu pindai atau cek ulang, supaya jawabannya bisa menyebut apa yang tertulis di rambu tentang izin itu. Hanya jenis izin yang dikirim, ditambah area atau zona untuk izin penghuni atau usaha.',
    ko: '저장한 허가증은 스캔하거나 다시 확인하는 표지판마다 함께 전송되어, 답에 표지판이 그 허가증에 대해 적은 내용이 포함될 수 있습니다. 허가증 종류만 전송되며, 거주자 또는 사업자 허가증은 구역도 함께 전송됩니다.',
    it: "I permessi salvati vengono inviati con ogni cartello che scansioni o ricontrolli, così la risposta può dire cosa riporta il cartello su di loro. Viene inviato solo il tipo di permesso, più l'area o zona di un permesso per residenti o per attività.",
    el: "Οι αποθηκευμένες άδειες στέλνονται μαζί με κάθε πινακίδα που σαρώνεις ή ελέγχεις ξανά, ώστε η απάντηση να μπορεί να λέει τι γράφει η πινακίδα γι' αυτές. Στέλνεται μόνο ο τύπος της άδειας, και η περιοχή ή ζώνη μιας άδειας κατοίκων ή επιχειρήσεων.",
    hi: 'सहेजे गए परमिट हर स्कैन किए या दोबारा जाँचे गए साइन के साथ भेजे जाते हैं, ताकि जवाब में बताया जा सके कि साइन पर उनके बारे में क्या लिखा है। सिर्फ़ परमिट का प्रकार भेजा जाता है, और निवासी या व्यावसायिक परमिट का क्षेत्र या ज़ोन भी।',
    pa: "ਸੰਭਾਲੇ ਪਰਮਿਟ ਹਰ ਸਕੈਨ ਕੀਤੇ ਜਾਂ ਮੁੜ ਜਾਂਚੇ ਚਿੰਨ੍ਹ ਨਾਲ ਭੇਜੇ ਜਾਂਦੇ ਹਨ, ਤਾਂ ਜੋ ਜਵਾਬ ਵਿੱਚ ਦੱਸਿਆ ਜਾ ਸਕੇ ਕਿ ਚਿੰਨ੍ਹ 'ਤੇ ਉਨ੍ਹਾਂ ਬਾਰੇ ਕੀ ਲਿਖਿਆ ਹੈ। ਸਿਰਫ਼ ਪਰਮਿਟ ਦੀ ਕਿਸਮ ਭੇਜੀ ਜਾਂਦੀ ਹੈ, ਅਤੇ ਨਿਵਾਸੀ ਜਾਂ ਕਾਰੋਬਾਰੀ ਪਰਮਿਟ ਦਾ ਖੇਤਰ ਜਾਂ ਜ਼ੋਨ ਵੀ।",
  },
  'prefs.permitsEmpty': {
    en: 'No permits saved.',
    'zh-CN': '还没有保存许可证。',
    vi: 'Chưa lưu giấy phép nào.',
    id: 'Belum ada izin yang disimpan.',
    ko: '저장된 허가증이 없습니다.',
    it: 'Nessun permesso salvato.',
    el: 'Δεν έχεις αποθηκεύσει άδειες.',
    hi: 'कोई परमिट सहेजा नहीं गया है।',
    pa: 'ਕੋਈ ਪਰਮਿਟ ਸੰਭਾਲਿਆ ਨਹੀਂ ਗਿਆ।',
  },
  'prefs.addPermit': {
    en: 'Add a permit',
    'zh-CN': '添加许可证',
    vi: 'Thêm giấy phép',
    id: 'Tambah izin',
    ko: '허가증 추가',
    it: 'Aggiungi un permesso',
    el: 'Πρόσθεσε άδεια',
    hi: 'परमिट जोड़ें',
    pa: 'ਪਰਮਿਟ ਜੋੜੋ',
  },
  'prefs.permitsLimit_one': {
    en: 'You can save up to {{count}} permit.',
    'zh-CN': '最多可以保存 {{count}} 个许可证。',
    vi: 'Bạn có thể lưu tối đa {{count}} giấy phép.',
    id: 'Kamu bisa menyimpan paling banyak {{count}} izin.',
    ko: '허가증은 최대 {{count}}개까지 저장할 수 있습니다.',
    it: 'Puoi salvare al massimo {{count}} permesso.',
    el: 'Μπορείς να αποθηκεύσεις έως {{count}} άδεια.',
    hi: 'ज़्यादा से ज़्यादा {{count}} परमिट सहेजे जा सकते हैं।',
    pa: 'ਵੱਧ ਤੋਂ ਵੱਧ {{count}} ਪਰਮਿਟ ਸੰਭਾਲੇ ਜਾ ਸਕਦੇ ਹਨ।',
  },
  'prefs.permitsLimit_other': {
    en: 'You can save up to {{count}} permits.',
    'zh-CN': '最多可以保存 {{count}} 个许可证。',
    vi: 'Bạn có thể lưu tối đa {{count}} giấy phép.',
    id: 'Kamu bisa menyimpan paling banyak {{count}} izin.',
    ko: '허가증은 최대 {{count}}개까지 저장할 수 있습니다.',
    it: 'Puoi salvare al massimo {{count}} permessi.',
    el: 'Μπορείς να αποθηκεύσεις έως {{count}} άδειες.',
    hi: 'ज़्यादा से ज़्यादा {{count}} परमिट सहेजे जा सकते हैं।',
    pa: 'ਵੱਧ ਤੋਂ ਵੱਧ {{count}} ਪਰਮਿਟ ਸੰਭਾਲੇ ਜਾ ਸਕਦੇ ਹਨ।',
  },
  'prefs.permitTypeLabel': {
    en: 'Permit type',
    'zh-CN': '许可证类型',
    vi: 'Loại giấy phép',
    id: 'Jenis izin',
    ko: '허가증 종류',
    it: 'Tipo di permesso',
    el: 'Τύπος άδειας',
    hi: 'परमिट का प्रकार',
    pa: 'ਪਰਮਿਟ ਦੀ ਕਿਸਮ',
  },
  // Terminology table: accessible parking permit.
  'prefs.permitType.accessible': {
    en: 'Accessible parking permit',
    'zh-CN': '无障碍停车许可证',
    vi: 'Giấy phép đỗ xe tiếp cận',
    id: 'Izin parkir aksesibel',
    ko: '장애인 주차 허가증',
    it: 'Permesso di parcheggio accessibile',
    el: 'Άδεια προσβάσιμης στάθμευσης',
    hi: 'सुलभ पार्किंग परमिट',
    pa: 'ਪਹੁੰਚਯੋਗ ਪਾਰਕਿੰਗ ਪਰਮਿਟ',
  },
  'prefs.permitType.resident': {
    en: 'Resident parking permit',
    'zh-CN': '居民停车许可证',
    vi: 'Giấy phép đỗ xe cho cư dân',
    id: 'Izin parkir penghuni',
    ko: '거주자 주차 허가증',
    it: 'Permesso di parcheggio per residenti',
    el: 'Άδεια στάθμευσης κατοίκων',
    hi: 'निवासी पार्किंग परमिट',
    pa: 'ਨਿਵਾਸੀ ਪਾਰਕਿੰਗ ਪਰਮਿਟ',
  },
  'prefs.permitType.business': {
    en: 'Business parking permit',
    'zh-CN': '商户停车许可证',
    vi: 'Giấy phép đỗ xe cho doanh nghiệp',
    id: 'Izin parkir usaha',
    ko: '사업자 주차 허가증',
    it: 'Permesso di parcheggio per attività',
    el: 'Άδεια στάθμευσης επιχειρήσεων',
    hi: 'व्यावसायिक पार्किंग परमिट',
    pa: 'ਕਾਰੋਬਾਰੀ ਪਾਰਕਿੰਗ ਪਰਮਿਟ',
  },
  'prefs.issuingStateLabel': {
    en: 'State or territory that issued it',
    'zh-CN': '签发的州或领地',
    vi: 'Bang hoặc vùng lãnh thổ cấp giấy phép',
    id: 'Negara bagian atau wilayah penerbit',
    ko: '발급한 주 또는 준주',
    it: "Stato o territorio che l'ha rilasciato",
    el: 'Πολιτεία ή επικράτεια έκδοσης',
    hi: 'जारी करने वाला राज्य या टेरिटरी',
    pa: 'ਜਾਰੀ ਕਰਨ ਵਾਲਾ ਰਾਜ ਜਾਂ ਟੈਰੀਟਰੀ',
  },
  'prefs.stateNotSet': {
    en: 'Not set',
    'zh-CN': '未设置',
    vi: 'Chưa chọn',
    id: 'Belum dipilih',
    ko: '선택 안 함',
    it: 'Non indicato',
    el: 'Δεν ορίστηκε',
    hi: 'चुना नहीं गया',
    pa: 'ਚੁਣਿਆ ਨਹੀਂ ਗਿਆ',
  },
  'prefs.state.VIC': {
    en: 'Victoria',
    'zh-CN': '维多利亚州',
    vi: 'Victoria',
    id: 'Victoria',
    ko: '빅토리아주',
    it: 'Victoria',
    el: 'Βικτώρια',
    hi: 'विक्टोरिया',
    pa: 'ਵਿਕਟੋਰੀਆ',
  },
  'prefs.state.NSW': {
    en: 'New South Wales',
    'zh-CN': '新南威尔士州',
    vi: 'New South Wales',
    id: 'New South Wales',
    ko: '뉴사우스웨일스주',
    it: 'Nuovo Galles del Sud',
    el: 'Νέα Νότια Ουαλία',
    hi: 'न्यू साउथ वेल्स',
    pa: 'ਨਿਊ ਸਾਊਥ ਵੇਲਜ਼',
  },
  'prefs.state.QLD': {
    en: 'Queensland',
    'zh-CN': '昆士兰州',
    vi: 'Queensland',
    id: 'Queensland',
    ko: '퀸즐랜드주',
    it: 'Queensland',
    el: 'Κουίνσλαντ',
    hi: 'क्वींसलैंड',
    pa: 'ਕੁਈਨਜ਼ਲੈਂਡ',
  },
  'prefs.state.ACT': {
    en: 'Australian Capital Territory',
    'zh-CN': '澳大利亚首都领地',
    vi: 'Lãnh thổ Thủ đô Úc',
    id: 'Wilayah Ibu Kota Australia',
    ko: '오스트레일리아 수도 준주',
    it: 'Territorio della Capitale Australiana',
    el: 'Επικράτεια Αυστραλιανής Πρωτεύουσας',
    hi: 'ऑस्ट्रेलियन कैपिटल टेरिटरी',
    pa: 'ਆਸਟ੍ਰੇਲੀਅਨ ਕੈਪੀਟਲ ਟੈਰੀਟਰੀ',
  },
  'prefs.state.SA': {
    en: 'South Australia',
    'zh-CN': '南澳大利亚州',
    vi: 'Nam Úc',
    id: 'Australia Selatan',
    ko: '사우스오스트레일리아주',
    it: 'Australia Meridionale',
    el: 'Νότια Αυστραλία',
    hi: 'साउथ ऑस्ट्रेलिया',
    pa: 'ਸਾਊਥ ਆਸਟ੍ਰੇਲੀਆ',
  },
  'prefs.state.WA': {
    en: 'Western Australia',
    'zh-CN': '西澳大利亚州',
    vi: 'Tây Úc',
    id: 'Australia Barat',
    ko: '웨스턴오스트레일리아주',
    it: 'Australia Occidentale',
    el: 'Δυτική Αυστραλία',
    hi: 'वेस्टर्न ऑस्ट्रेलिया',
    pa: 'ਵੈਸਟਰਨ ਆਸਟ੍ਰੇਲੀਆ',
  },
  'prefs.state.TAS': {
    en: 'Tasmania',
    'zh-CN': '塔斯马尼亚州',
    vi: 'Tasmania',
    id: 'Tasmania',
    ko: '태즈메이니아주',
    it: 'Tasmania',
    el: 'Τασμανία',
    hi: 'तस्मानिया',
    pa: 'ਤਸਮਾਨੀਆ',
  },
  'prefs.state.NT': {
    en: 'Northern Territory',
    'zh-CN': '北领地',
    vi: 'Lãnh thổ Bắc Úc',
    id: 'Wilayah Utara',
    ko: '노던 준주',
    it: 'Territorio del Nord',
    el: 'Βόρεια Επικράτεια',
    hi: 'नॉर्दर्न टेरिटरी',
    pa: 'ਨਾਰਦਰਨ ਟੈਰੀਟਰੀ',
  },
  'prefs.areaLabel': {
    en: 'Area or zone on the permit',
    'zh-CN': '许可证上的区域',
    vi: 'Khu vực ghi trên giấy phép',
    id: 'Area atau zona di izin',
    ko: '허가증에 적힌 구역',
    it: 'Area o zona sul permesso',
    el: 'Περιοχή ή ζώνη στην άδεια',
    hi: 'परमिट पर लिखा क्षेत्र या ज़ोन',
    pa: "ਪਰਮਿਟ 'ਤੇ ਲਿਖਿਆ ਖੇਤਰ ਜਾਂ ਜ਼ੋਨ",
  },
  // "Area 25" stays as printed on Australian permits.
  'prefs.areaPlaceholder': {
    en: 'For example, Area 25',
    'zh-CN': '例如 Area 25',
    vi: 'Ví dụ: Area 25',
    id: 'Contoh: Area 25',
    ko: '예: Area 25',
    it: 'Ad esempio, Area 25',
    el: 'Για παράδειγμα, Area 25',
    hi: 'उदाहरण: Area 25',
    pa: 'ਉਦਾਹਰਨ: Area 25',
  },
  'prefs.expiryLabel': {
    en: 'Expiry date',
    'zh-CN': '到期日期',
    vi: 'Ngày hết hạn',
    id: 'Tanggal kedaluwarsa',
    ko: '만료일',
    it: 'Data di scadenza',
    el: 'Ημερομηνία λήξης',
    hi: 'समाप्ति तिथि',
    pa: 'ਮਿਆਦ ਖ਼ਤਮ ਹੋਣ ਦੀ ਤਾਰੀਖ਼',
  },
  'prefs.savePermit': {
    en: 'Save permit',
    'zh-CN': '保存许可证',
    vi: 'Lưu giấy phép',
    id: 'Simpan izin',
    ko: '허가증 저장',
    it: 'Salva permesso',
    el: 'Αποθήκευση άδειας',
    hi: 'परमिट सहेजें',
    pa: 'ਪਰਮਿਟ ਸੰਭਾਲੋ',
  },
  // Spec T4 item 2, exact. Shown before an accessible permit is saved.
  'prefs.accessibleWarning': {
    en: 'Saving this permit means its type is sent with each sign photo you scan, so the answer can include what the sign says about permits. Accessible permit details are health information. You can delete them any time.',
    'zh-CN':
      '保存这个许可证后,你扫描的每张标志照片都会附带发送它的类型,这样答案就能包含标志上关于许可证的内容。无障碍停车许可证的信息属于健康信息。你可以随时删除这些信息。',
    vi: 'Lưu giấy phép này nghĩa là loại giấy phép sẽ được gửi kèm mỗi ảnh biển báo bạn quét, để câu trả lời có thể nêu những gì biển báo ghi về giấy phép. Thông tin về giấy phép đỗ xe tiếp cận là thông tin sức khỏe. Bạn có thể xoá chúng bất cứ lúc nào.',
    id: 'Menyimpan izin ini berarti jenisnya dikirim bersama setiap foto rambu yang kamu pindai, supaya jawabannya bisa menyebut apa yang tertulis di rambu tentang izin. Detail izin parkir aksesibel adalah informasi kesehatan. Kamu bisa menghapusnya kapan saja.',
    ko: '이 허가증을 저장하면 스캔하는 표지판 사진마다 허가증 종류가 함께 전송되어, 답에 표지판이 허가증에 대해 적은 내용이 포함될 수 있습니다. 장애인 주차 허가증 정보는 건강 정보입니다. 언제든지 삭제할 수 있습니다.',
    it: 'Salvare questo permesso significa che il suo tipo viene inviato con ogni foto di cartello che scansioni, così la risposta può dire cosa riporta il cartello sui permessi. I dati del permesso di parcheggio accessibile sono informazioni sulla salute. Puoi eliminarli in qualsiasi momento.',
    el: 'Αν αποθηκεύσεις αυτή την άδεια, ο τύπος της στέλνεται με κάθε φωτογραφία πινακίδας που σαρώνεις, ώστε η απάντηση να μπορεί να λέει τι γράφει η πινακίδα για άδειες. Τα στοιχεία της άδειας προσβάσιμης στάθμευσης είναι πληροφορίες υγείας. Μπορείς να τα διαγράψεις όποτε θέλεις.',
    hi: 'इस परमिट को सहेजने का मतलब है कि हर स्कैन की गई साइन फ़ोटो के साथ इसका प्रकार भेजा जाएगा, ताकि जवाब में बताया जा सके कि साइन पर परमिट के बारे में क्या लिखा है। सुलभ पार्किंग परमिट की जानकारी स्वास्थ्य से जुड़ी जानकारी है। इसे कभी भी हटाया जा सकता है।',
    pa: "ਇਸ ਪਰਮਿਟ ਨੂੰ ਸੰਭਾਲਣ ਦਾ ਮਤਲਬ ਹੈ ਕਿ ਹਰ ਸਕੈਨ ਕੀਤੀ ਚਿੰਨ੍ਹ ਫੋਟੋ ਨਾਲ ਇਸ ਦੀ ਕਿਸਮ ਭੇਜੀ ਜਾਵੇਗੀ, ਤਾਂ ਜੋ ਜਵਾਬ ਵਿੱਚ ਦੱਸਿਆ ਜਾ ਸਕੇ ਕਿ ਚਿੰਨ੍ਹ 'ਤੇ ਪਰਮਿਟਾਂ ਬਾਰੇ ਕੀ ਲਿਖਿਆ ਹੈ। ਪਹੁੰਚਯੋਗ ਪਾਰਕਿੰਗ ਪਰਮਿਟ ਦੀ ਜਾਣਕਾਰੀ ਸਿਹਤ ਨਾਲ ਜੁੜੀ ਜਾਣਕਾਰੀ ਹੈ। ਇਸ ਨੂੰ ਕਦੇ ਵੀ ਮਿਟਾਇਆ ਜਾ ਸਕਦਾ ਹੈ।",
  },
  'prefs.accessibleConfirm': {
    en: 'Save this permit',
    'zh-CN': '保存这个许可证',
    vi: 'Lưu giấy phép này',
    id: 'Simpan izin ini',
    ko: '이 허가증 저장',
    it: 'Salva questo permesso',
    el: 'Αποθήκευση αυτής της άδειας',
    hi: 'यह परमिट सहेजें',
    pa: 'ਇਹ ਪਰਮਿਟ ਸੰਭਾਲੋ',
  },
  'prefs.permitArea': {
    en: 'Area or zone: {{area}}',
    'zh-CN': '区域:{{area}}',
    vi: 'Khu vực: {{area}}',
    id: 'Area atau zona: {{area}}',
    ko: '구역: {{area}}',
    it: 'Area o zona: {{area}}',
    el: 'Περιοχή ή ζώνη: {{area}}',
    hi: 'क्षेत्र या ज़ोन: {{area}}',
    pa: 'ਖੇਤਰ ਜਾਂ ਜ਼ੋਨ: {{area}}',
  },
  'prefs.permitExpires': {
    en: 'Expires {{date}}',
    'zh-CN': '{{date}} 到期',
    vi: 'Hết hạn ngày {{date}}',
    id: 'Berlaku sampai {{date}}',
    ko: '{{date}} 만료',
    it: 'Scade il {{date}}',
    el: 'Λήγει στις {{date}}',
    hi: '{{date}} को समाप्त होगा',
    pa: '{{date}} ਨੂੰ ਮਿਆਦ ਖ਼ਤਮ ਹੋਵੇਗੀ',
  },
  'prefs.permitExpired': {
    en: "Expired {{date}}. It isn't sent with your scans.",
    'zh-CN': '已于 {{date}} 到期。扫描时不会再发送它。',
    vi: 'Đã hết hạn ngày {{date}}. Giấy phép này không được gửi khi bạn quét.',
    id: 'Kedaluwarsa sejak {{date}}. Izin ini tidak dikirim saat kamu memindai.',
    ko: '{{date}}에 만료되었습니다. 스캔할 때 전송되지 않습니다.',
    it: 'Scaduto il {{date}}. Non viene inviato con le tue scansioni.',
    el: 'Έληξε στις {{date}}. Δεν στέλνεται με τις σαρώσεις σου.',
    hi: '{{date}} को समाप्त हो गया। अब इसे स्कैन के साथ नहीं भेजा जाता।',
    pa: '{{date}} ਨੂੰ ਮਿਆਦ ਖ਼ਤਮ ਹੋ ਗਈ। ਹੁਣ ਇਸ ਨੂੰ ਸਕੈਨ ਨਾਲ ਨਹੀਂ ਭੇਜਿਆ ਜਾਂਦਾ।',
  },
  // {{permit}} is the permit type's name (prefs.permitType.*).
  'prefs.deletePermitLabel': {
    en: 'Delete {{permit}}',
    'zh-CN': '删除{{permit}}',
    vi: 'Xoá {{permit}}',
    id: 'Hapus {{permit}}',
    ko: '{{permit}} 삭제',
    it: 'Elimina {{permit}}',
    el: 'Διαγραφή: {{permit}}',
    hi: '{{permit}} हटाएँ',
    pa: '{{permit}} ਮਿਟਾਓ',
  },
  'prefs.pushUnsupported': {
    en: "This browser can't show reminders while ParkProof is closed. On an iPhone, add ParkProof to your Home Screen first. Calendar reminders still work.",
    'zh-CN': '这个浏览器无法在 ParkProof 关闭时显示提醒。在 iPhone 上,请先把 ParkProof 添加到主屏幕。日历提醒仍然可以使用。',
    vi: 'Trình duyệt này không thể hiện nhắc nhở khi ParkProof đang đóng. Trên iPhone, hãy thêm ParkProof vào Màn hình chính trước. Nhắc nhở trong lịch vẫn hoạt động.',
    id: 'Browser ini tidak bisa menampilkan pengingat saat ParkProof ditutup. Di iPhone, tambahkan ParkProof ke Layar Utama dulu. Pengingat kalender tetap berfungsi.',
    ko: '이 브라우저에서는 ParkProof가 닫혀 있을 때 알림을 표시할 수 없습니다. iPhone에서는 먼저 ParkProof를 홈 화면에 추가하세요. 캘린더 알림은 계속 사용할 수 있습니다.',
    it: 'Questo browser non può mostrare promemoria quando ParkProof è chiuso. Su iPhone, aggiungi prima ParkProof alla schermata Home. I promemoria nel calendario funzionano comunque.',
    el: 'Αυτός ο browser δεν μπορεί να δείχνει υπενθυμίσεις όταν το ParkProof είναι κλειστό. Σε iPhone, πρόσθεσε πρώτα το ParkProof στην οθόνη Αφετηρίας. Οι υπενθυμίσεις ημερολογίου λειτουργούν κανονικά.',
    hi: 'यह ब्राउज़र ParkProof बंद होने पर रिमाइंडर नहीं दिखा सकता। iPhone पर, पहले ParkProof को होम स्क्रीन पर जोड़ें। कैलेंडर रिमाइंडर फिर भी काम करते हैं।',
    pa: "ਇਹ ਬ੍ਰਾਊਜ਼ਰ ParkProof ਬੰਦ ਹੋਣ 'ਤੇ ਰਿਮਾਈਂਡਰ ਨਹੀਂ ਦਿਖਾ ਸਕਦਾ। iPhone 'ਤੇ, ਪਹਿਲਾਂ ParkProof ਨੂੰ ਹੋਮ ਸਕ੍ਰੀਨ 'ਤੇ ਜੋੜੋ। ਕੈਲੰਡਰ ਰਿਮਾਈਂਡਰ ਫਿਰ ਵੀ ਕੰਮ ਕਰਦੇ ਹਨ।",
  },
  // The reliability line every reminder feature carries (copy rules).
  'prefs.remindersReliability': {
    en: "Reminders can be delayed or silenced, for example by Focus or battery saving. Don't rely on them alone.",
    'zh-CN': '提醒可能会延迟或被静音,例如因为专注模式或省电模式。不要只依赖提醒。',
    vi: 'Nhắc nhở có thể bị trễ hoặc bị tắt tiếng, ví dụ do chế độ Tập trung hoặc tiết kiệm pin. Đừng chỉ dựa vào nhắc nhở.',
    id: 'Pengingat bisa tertunda atau dibisukan, misalnya oleh mode Fokus atau penghemat baterai. Jangan hanya mengandalkan pengingat.',
    ko: '알림은 집중 모드나 배터리 절약 등으로 늦어지거나 무음이 될 수 있습니다. 알림에만 의존하지 마세요.',
    it: 'I promemoria possono arrivare in ritardo o essere silenziati, per esempio da Full immersion o dal risparmio energetico. Non affidarti solo a loro.',
    el: 'Οι υπενθυμίσεις μπορεί να καθυστερήσουν ή να σιγήσουν, για παράδειγμα λόγω Εστίασης ή εξοικονόμησης μπαταρίας. Μη βασίζεσαι μόνο σε αυτές.',
    hi: 'रिमाइंडर में देरी हो सकती है या वे बंद हो सकते हैं, जैसे फ़ोकस या बैटरी सेवर की वजह से। सिर्फ़ इन पर निर्भर न रहें।',
    pa: "ਰਿਮਾਈਂਡਰ ਲੇਟ ਹੋ ਸਕਦੇ ਹਨ ਜਾਂ ਚੁੱਪ ਹੋ ਸਕਦੇ ਹਨ, ਜਿਵੇਂ ਫ਼ੋਕਸ ਜਾਂ ਬੈਟਰੀ ਸੇਵਰ ਕਾਰਨ। ਸਿਰਫ਼ ਇਨ੍ਹਾਂ 'ਤੇ ਨਿਰਭਰ ਨਾ ਰਹੋ।",
  },
  'prefs.accountHeader': {
    en: 'Account',
    'zh-CN': '账户',
    vi: 'Tài khoản',
    id: 'Akun',
    ko: '계정',
    it: 'Account',
    el: 'Λογαριασμός',
    hi: 'खाता',
    pa: 'ਖਾਤਾ',
  },
  'prefs.accountCopy': {
    en: 'Cloud sync, data export, signing out and deleting your account.',
    'zh-CN': '云同步、导出数据、退出登录和删除账户。',
    vi: 'Đồng bộ đám mây, xuất dữ liệu, đăng xuất và xoá tài khoản.',
    id: 'Sinkronisasi cloud, ekspor data, keluar, dan menghapus akun.',
    ko: '클라우드 동기화, 데이터 내보내기, 로그아웃, 계정 삭제.',
    it: "Sincronizzazione cloud, esportazione dei dati, uscita ed eliminazione dell'account.",
    el: 'Συγχρονισμός στο cloud, εξαγωγή δεδομένων, αποσύνδεση και διαγραφή λογαριασμού.',
    hi: 'क्लाउड सिंक, डेटा एक्सपोर्ट, साइन आउट और खाता हटाना।',
    pa: 'ਕਲਾਊਡ ਸਿੰਕ, ਡਾਟਾ ਐਕਸਪੋਰਟ, ਸਾਈਨ ਆਊਟ ਅਤੇ ਖਾਤਾ ਮਿਟਾਉਣਾ।',
  },
  'prefs.openAccount': {
    en: 'Open account',
    'zh-CN': '打开账户',
    vi: 'Mở tài khoản',
    id: 'Buka akun',
    ko: '계정 열기',
    it: 'Apri account',
    el: 'Άνοιγμα λογαριασμού',
    hi: 'खाता खोलें',
    pa: 'ਖਾਤਾ ਖੋਲ੍ਹੋ',
  },
  'prefs.signInCopy': {
    en: 'Sign in to back up your records and see them on your other devices. Nothing on this page needs an account.',
    'zh-CN': '登录后可以备份你的记录,并在你的其他设备上查看。这个页面上的设置都不需要账户。',
    vi: 'Đăng nhập để sao lưu các bản ghi và xem chúng trên các thiết bị khác của bạn. Mọi thứ trên trang này đều dùng được mà không cần tài khoản.',
    id: 'Masuk untuk mencadangkan catatanmu dan melihatnya di perangkatmu yang lain. Semua yang ada di halaman ini bisa dipakai tanpa akun.',
    ko: '로그인하면 기록을 백업하고 다른 기기에서도 볼 수 있습니다. 이 페이지의 설정은 계정 없이도 사용할 수 있습니다.',
    it: 'Accedi per fare il backup dei tuoi record e vederli sugli altri dispositivi. Niente in questa pagina richiede un account.',
    el: 'Συνδέσου για να κρατάς αντίγραφο των αρχείων σου και να τα βλέπεις στις άλλες συσκευές σου. Τίποτα σε αυτή τη σελίδα δεν χρειάζεται λογαριασμό.',
    hi: 'साइन इन करके अपने रिकॉर्ड का बैकअप रखें और उन्हें अपने दूसरे डिवाइस पर भी देखें। इस पेज की किसी भी चीज़ के लिए खाते की ज़रूरत नहीं है।',
    pa: "ਸਾਈਨ ਇਨ ਕਰਕੇ ਆਪਣੇ ਰਿਕਾਰਡਾਂ ਦਾ ਬੈਕਅੱਪ ਰੱਖੋ ਅਤੇ ਉਨ੍ਹਾਂ ਨੂੰ ਆਪਣੇ ਦੂਜੇ ਡਿਵਾਈਸਾਂ 'ਤੇ ਵੀ ਦੇਖੋ। ਇਸ ਪੰਨੇ ਦੀ ਕਿਸੇ ਵੀ ਚੀਜ਼ ਲਈ ਖਾਤੇ ਦੀ ਲੋੜ ਨਹੀਂ।",
  },
  'prefs.signIn': {
    en: 'Sign in',
    'zh-CN': '登录',
    vi: 'Đăng nhập',
    id: 'Masuk',
    ko: '로그인',
    it: 'Accedi',
    el: 'Σύνδεση',
    hi: 'साइन इन',
    pa: 'ਸਾਈਨ ਇਨ',
  },
  // Item 8: infringement notice photos (the appeal draft today, the notice lookup in T8).
  'privacy.anonymousFineNotice': {
    en: "<strong>Photos of an infringement notice</strong> (a parking fine) are sent to <strong>Anthropic</strong> to read the notice, for example when you draft an appeal. Drafting an appeal also sends the details of the parking record you chose. We don't keep the photo.",
    'zh-CN':
      '<strong>违章通知书的照片</strong>(停车罚款)会发送给 <strong>Anthropic</strong> 来读取通知书,例如在你起草申诉时。起草申诉还会发送你所选停车记录的详细信息。我们不保留照片。',
    vi: '<strong>Ảnh thông báo vi phạm</strong> (tiền phạt đỗ xe) được gửi tới <strong>Anthropic</strong> để đọc thông báo, ví dụ khi bạn soạn đơn xem xét. Khi soạn đơn, chi tiết của bản ghi đỗ xe bạn chọn cũng được gửi đi. Chúng tôi không giữ ảnh.',
    id: '<strong>Foto surat denda</strong> (denda parkir) dikirim ke <strong>Anthropic</strong> untuk membaca suratnya, misalnya saat kamu menyusun banding. Menyusun banding juga mengirim detail catatan parkir yang kamu pilih. Kami tidak menyimpan fotonya.',
    ko: '<strong>위반 통지서 사진</strong>(주차 벌금)은 통지서를 읽기 위해 <strong>Anthropic</strong>으로 전송됩니다. 예를 들어 이의신청서를 작성할 때입니다. 이의신청서를 작성하면 선택한 주차 기록의 세부 정보도 함께 전송됩니다. 사진은 보관하지 않습니다.',
    it: 'Le <strong>foto di un verbale di contravvenzione</strong> (una multa per il parcheggio) vengono inviate ad <strong>Anthropic</strong> per leggere il verbale, per esempio quando prepari un ricorso. Preparare un ricorso invia anche i dettagli del record di parcheggio che hai scelto. Non conserviamo la foto.',
    el: 'Οι <strong>φωτογραφίες μιας ειδοποίησης παράβασης</strong> (πρόστιμο στάθμευσης) στέλνονται στην <strong>Anthropic</strong> για να διαβαστεί η ειδοποίηση, για παράδειγμα όταν συντάσσεις ένσταση. Η σύνταξη ένστασης στέλνει επίσης τα στοιχεία του αρχείου στάθμευσης που διάλεξες. Δεν κρατάμε τη φωτογραφία.',
    hi: '<strong>उल्लंघन नोटिस की फ़ोटो</strong> (पार्किंग जुर्माना) नोटिस पढ़ने के लिए <strong>Anthropic</strong> को भेजी जाती हैं, जैसे समीक्षा का अनुरोध तैयार करते समय। समीक्षा का अनुरोध तैयार करने पर चुने गए पार्किंग रिकॉर्ड का ब्योरा भी भेजा जाता है। हम फ़ोटो नहीं रखते।',
    pa: "<strong>ਉਲੰਘਣਾ ਨੋਟਿਸ ਦੀਆਂ ਫੋਟੋਆਂ</strong> (ਪਾਰਕਿੰਗ ਜੁਰਮਾਨਾ) ਨੋਟਿਸ ਪੜ੍ਹਨ ਲਈ <strong>Anthropic</strong> ਨੂੰ ਭੇਜੀਆਂ ਜਾਂਦੀਆਂ ਹਨ, ਜਿਵੇਂ ਸਮੀਖਿਆ ਦੀ ਬੇਨਤੀ ਤਿਆਰ ਕਰਦੇ ਸਮੇਂ। ਸਮੀਖਿਆ ਦੀ ਬੇਨਤੀ ਤਿਆਰ ਕਰਨ 'ਤੇ ਚੁਣੇ ਗਏ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ ਦਾ ਵੇਰਵਾ ਵੀ ਭੇਜਿਆ ਜਾਂਦਾ ਹੈ। ਅਸੀਂ ਫੋਟੋ ਨਹੀਂ ਰੱਖਦੇ।",
  },
  // ═══ Unit: result screen and home (items 4, 5, 6 and 9) ══════════════════
  // Item 4: the standard answer, labelled when a permit answer shows apart from it.
  'result.permit.standardKicker': {
    en: 'Standard answer',
    'zh-CN': '标准答复',
    vi: 'Câu trả lời tiêu chuẩn',
    id: 'Jawaban standar',
    ko: '일반 기준 답변',
    it: 'Risposta standard',
    el: 'Βασική απάντηση',
    hi: 'सामान्य जवाब',
    pa: 'ਆਮ ਜਵਾਬ',
  },
  'result.permit.kicker': {
    en: 'With your permit',
    'zh-CN': '使用你的许可证',
    vi: 'Với giấy phép của bạn',
    id: 'Dengan izinmu',
    ko: '내 허가증으로',
    it: 'Con il tuo permesso',
    el: 'Με την άδειά σου',
    hi: 'आपके परमिट के साथ',
    pa: 'ਤੁਹਾਡੇ ਪਰਮਿਟ ਨਾਲ',
  },
  // Followed by the sign's own exception words, quoted as the model copied them.
  'result.permit.signPrints': {
    en: 'The sign prints an exception for this permit:',
    'zh-CN': '标志上印有针对这类许可证的例外:',
    vi: 'Biển báo có in một ngoại lệ cho loại giấy phép này:',
    id: 'Rambu ini mencantumkan pengecualian untuk izin ini:',
    ko: '표지판에 이 허가증에 대한 예외가 적혀 있습니다:',
    it: "Il cartello riporta un'eccezione per questo permesso:",
    el: 'Η πινακίδα αναγράφει εξαίρεση για αυτή την άδεια:',
    hi: 'साइन पर इस परमिट के लिए छूट लिखी है:',
    pa: "ਚਿੰਨ੍ਹ 'ਤੇ ਇਸ ਪਰਮਿਟ ਲਈ ਛੋਟ ਲਿਖੀ ਹੈ:",
  },
  'result.permit.checkConditions': {
    en: 'ParkProof only reads what the sign prints. Check the conditions on your permit too.',
    'zh-CN': 'ParkProof 只读取标志上印的内容。也请查看你许可证上的使用条件。',
    vi: 'ParkProof chỉ đọc những gì in trên biển báo. Hãy xem cả các điều kiện ghi trên giấy phép của bạn.',
    id: 'ParkProof hanya membaca apa yang tercetak di rambu. Periksa juga ketentuan di izinmu.',
    ko: 'ParkProof는 표지판에 적힌 내용만 읽습니다. 허가증의 사용 조건도 확인하세요.',
    it: 'ParkProof legge solo ciò che è scritto sul cartello. Controlla anche le condizioni del tuo permesso.',
    el: 'Το ParkProof διαβάζει μόνο ό,τι αναγράφει η πινακίδα. Έλεγξε και τους όρους της άδειάς σου.',
    hi: 'ParkProof सिर्फ़ वही पढ़ता है जो साइन पर लिखा है। अपने परमिट की शर्तें भी जाँच लें।',
    pa: "ParkProof ਸਿਰਫ਼ ਉਹੀ ਪੜ੍ਹਦਾ ਹੈ ਜੋ ਚਿੰਨ੍ਹ 'ਤੇ ਲਿਖਿਆ ਹੈ। ਆਪਣੇ ਪਰਮਿਟ ਦੀਆਂ ਸ਼ਰਤਾਂ ਵੀ ਜਾਂਚ ਲਓ।",
  },
  // Spec T4 item 4 (the deterministic area match): {{area}} is the label as saved, e.g. "Area 25".
  'result.permit.areaMatch': {
    en: 'Your saved permit for {{area}} matches this zone.',
    'zh-CN': '你保存的 {{area}} 许可证与这个区域相符。',
    vi: 'Giấy phép bạn đã lưu cho {{area}} khớp với khu vực này.',
    id: 'Izin yang kamu simpan untuk {{area}} cocok dengan zona ini.',
    ko: '저장한 {{area}} 허가증이 이 구역과 일치합니다.',
    it: 'Il permesso salvato per {{area}} corrisponde a questa zona.',
    el: 'Η αποθηκευμένη άδειά σου για {{area}} ταιριάζει με αυτή τη ζώνη.',
    hi: '{{area}} के लिए सहेजा गया आपका परमिट इस ज़ोन से मेल खाता है।',
    pa: '{{area}} ਲਈ ਸੰਭਾਲਿਆ ਤੁਹਾਡਾ ਪਰਮਿਟ ਇਸ ਜ਼ੋਨ ਨਾਲ ਮੇਲ ਖਾਂਦਾ ਹੈ।',
  },
  // {{zone}} is the sign's permit area identifier, e.g. "25" (as in result.permitZone.headerWithArea).
  'result.permit.areaMismatch': {
    en: 'Your saved permit is for {{area}}. This zone is Permit Area {{zone}}.',
    'zh-CN': '你保存的许可证适用于 {{area}}。这个区域是许可证区域 {{zone}}。',
    vi: 'Giấy phép bạn đã lưu dành cho {{area}}. Khu này là Khu vực Giấy phép {{zone}}.',
    id: 'Izin yang kamu simpan berlaku untuk {{area}}. Zona ini adalah Area Izin {{zone}}.',
    ko: '저장한 허가증은 {{area}}용입니다. 이 구역은 허가 구역 {{zone}}입니다.',
    it: "Il permesso salvato è per {{area}}. Questa zona è l'Area Permesso {{zone}}.",
    el: 'Η αποθηκευμένη άδειά σου είναι για {{area}}. Αυτή η ζώνη είναι η Περιοχή Άδειας {{zone}}.',
    hi: 'आपका सहेजा गया परमिट {{area}} के लिए है। यह ज़ोन परमिट क्षेत्र {{zone}} है।',
    pa: 'ਤੁਹਾਡਾ ਸੰਭਾਲਿਆ ਪਰਮਿਟ {{area}} ਲਈ ਹੈ। ਇਹ ਜ਼ੋਨ ਪਰਮਿਟ ਖੇਤਰ {{zone}} ਹੈ।',
  },
  // Spec T4 item 4, exact. {{state}} is the full state name (prefs.state.*); it and el
  // put it in brackets so no article is needed before it.
  'result.permit.mayAllowMore': {
    en: "Your permit may allow more time under {{state}} rules. ParkProof doesn't calculate that. Check the conditions on your permit or with your council.",
    'zh-CN': '根据{{state}}的规定,你的许可证可能允许停更长时间。ParkProof 不会计算这一点。请查看许可证上的条件,或向你的市议会咨询。',
    vi: 'Theo quy định của {{state}}, giấy phép của bạn có thể cho phép đỗ lâu hơn. ParkProof không tính điều đó. Hãy xem các điều kiện trên giấy phép của bạn hoặc hỏi hội đồng địa phương.',
    id: 'Menurut aturan {{state}}, izinmu mungkin membolehkan waktu lebih lama. ParkProof tidak menghitungnya. Periksa ketentuan di izinmu atau tanyakan ke dewan kota.',
    ko: '{{state}} 규정에 따라 허가증으로 더 오래 주차할 수 있을지도 모릅니다. ParkProof는 이를 계산하지 않습니다. 허가증의 조건을 확인하거나 의회에 문의하세요.',
    it: 'Il tuo permesso potrebbe consentire più tempo secondo le regole in vigore qui ({{state}}). ParkProof non lo calcola. Controlla le condizioni del permesso o chiedi al tuo comune.',
    el: 'Η άδειά σου μπορεί να επιτρέπει περισσότερο χρόνο σύμφωνα με τους κανόνες που ισχύουν εδώ ({{state}}). Το ParkProof δεν το υπολογίζει. Έλεγξε τους όρους της άδειάς σου ή ρώτα τον δήμο σου.',
    hi: '{{state}} के नियमों के तहत आपका परमिट ज़्यादा समय दे सकता है। ParkProof इसका हिसाब नहीं लगाता। अपने परमिट की शर्तें देखें या अपनी परिषद से पूछें।',
    pa: '{{state}} ਦੇ ਨਿਯਮਾਂ ਅਧੀਨ ਤੁਹਾਡਾ ਪਰਮਿਟ ਵੱਧ ਸਮਾਂ ਦੇ ਸਕਦਾ ਹੈ। ParkProof ਇਸ ਦਾ ਹਿਸਾਬ ਨਹੀਂ ਲਗਾਉਂਦਾ। ਆਪਣੇ ਪਰਮਿਟ ਦੀਆਂ ਸ਼ਰਤਾਂ ਦੇਖੋ ਜਾਂ ਆਪਣੀ ਕੌਂਸਲ ਤੋਂ ਪੁੱਛੋ।',
  },
  // The same line when the phone can't tell the state for sure (never guessed).
  'result.permit.mayAllowMoreNoState': {
    en: "Your permit may allow more time under the rules where you've parked. ParkProof doesn't calculate that. Check the conditions on your permit or with your council.",
    'zh-CN': '根据你停车所在地的规定,你的许可证可能允许停更长时间。ParkProof 不会计算这一点。请查看许可证上的条件,或向你的市议会咨询。',
    vi: 'Theo quy định tại nơi bạn đỗ xe, giấy phép của bạn có thể cho phép đỗ lâu hơn. ParkProof không tính điều đó. Hãy xem các điều kiện trên giấy phép của bạn hoặc hỏi hội đồng địa phương.',
    id: 'Menurut aturan di tempatmu parkir, izinmu mungkin membolehkan waktu lebih lama. ParkProof tidak menghitungnya. Periksa ketentuan di izinmu atau tanyakan ke dewan kota.',
    ko: '주차한 곳의 규정에 따라 허가증으로 더 오래 주차할 수 있을지도 모릅니다. ParkProof는 이를 계산하지 않습니다. 허가증의 조건을 확인하거나 의회에 문의하세요.',
    it: 'Il tuo permesso potrebbe consentire più tempo secondo le regole del luogo in cui hai parcheggiato. ParkProof non lo calcola. Controlla le condizioni del permesso o chiedi al tuo comune.',
    el: 'Η άδειά σου μπορεί να επιτρέπει περισσότερο χρόνο σύμφωνα με τους κανόνες του σημείου όπου πάρκαρες. Το ParkProof δεν το υπολογίζει. Έλεγξε τους όρους της άδειάς σου ή ρώτα τον δήμο σου.',
    hi: 'जहाँ आपने पार्क किया है, वहाँ के नियमों के तहत आपका परमिट ज़्यादा समय दे सकता है। ParkProof इसका हिसाब नहीं लगाता। अपने परमिट की शर्तें देखें या अपनी परिषद से पूछें।',
    pa: 'ਜਿੱਥੇ ਤੁਸੀਂ ਪਾਰਕ ਕੀਤਾ ਹੈ, ਉੱਥੋਂ ਦੇ ਨਿਯਮਾਂ ਅਧੀਨ ਤੁਹਾਡਾ ਪਰਮਿਟ ਵੱਧ ਸਮਾਂ ਦੇ ਸਕਦਾ ਹੈ। ParkProof ਇਸ ਦਾ ਹਿਸਾਬ ਨਹੀਂ ਲਗਾਉਂਦਾ। ਆਪਣੇ ਪਰਮਿਟ ਦੀਆਂ ਸ਼ਰਤਾਂ ਦੇਖੋ ਜਾਂ ਆਪਣੀ ਕੌਂਸਲ ਤੋਂ ਪੁੱਛੋ।',
  },
  // Spec T4 item 5, exact: the accessible-permit gate with a saved accessible permit.
  // The driver's own statement; gender-neutral holder (hi/pa: no gendered first person).
  'result.permit.accessibleQuestion': {
    en: 'The permit holder is in the car with me and getting out here, and their permit is displayed.',
    'zh-CN': '许可证持有人和我同在车上,会在这里下车,而且其许可证已展示。',
    vi: 'Người có giấy phép đang ở trong xe cùng tôi và sẽ xuống xe tại đây, và giấy phép của họ đang được trưng bày.',
    id: 'Pemegang izin ada di mobil bersamaku dan turun di sini, dan izinnya terpasang dan terlihat.',
    ko: '허가증 소지자가 저와 함께 차에 타고 있고 여기서 내리며, 그 허가증이 보이게 놓여 있습니다.',
    it: 'La persona titolare del permesso è in auto con me e scende qui, e il suo permesso è esposto.',
    el: 'Το άτομο που έχει την άδεια είναι στο αυτοκίνητο μαζί μου και κατεβαίνει εδώ, και η άδειά του είναι σε κοινή θέα.',
    hi: 'परमिट धारक मेरे साथ गाड़ी में हैं और यहीं उतर रहे हैं, और उनका परमिट दिखाई दे रहा है।',
    pa: 'ਪਰਮਿਟ ਧਾਰਕ ਮੇਰੇ ਨਾਲ ਕਾਰ ਵਿੱਚ ਹਨ ਅਤੇ ਇੱਥੇ ਉਤਰ ਰਹੇ ਹਨ, ਅਤੇ ਉਨ੍ਹਾਂ ਦਾ ਪਰਮਿਟ ਦਿਖਾਈ ਦੇ ਰਿਹਾ ਹੈ।',
  },
  // Spec T4 item 5, exact: the "No" answer to the question above.
  'result.permit.accessibleNo': {
    en: "Then the permit can't be used for this park. Don't park in the accessible bay.",
    'zh-CN': '那么这次停车不能使用该许可证。请不要停在无障碍车位。',
    vi: 'Vậy thì không thể dùng giấy phép cho lần đỗ xe này. Đừng đỗ vào chỗ đỗ xe tiếp cận.',
    id: 'Kalau begitu, izin ini tidak bisa dipakai untuk parkir kali ini. Jangan parkir di tempat parkir aksesibel.',
    ko: '그렇다면 이번 주차에는 허가증을 사용할 수 없습니다. 장애인 주차 구역에 주차하지 마세요.',
    it: 'Allora il permesso non può essere usato per questo parcheggio. Non parcheggiare nel posto accessibile.',
    el: 'Τότε η άδεια δεν μπορεί να χρησιμοποιηθεί για αυτή τη στάθμευση. Μην παρκάρεις στη θέση προσβάσιμης στάθμευσης.',
    hi: 'तो इस पार्किंग के लिए परमिट का इस्तेमाल नहीं हो सकता। सुलभ पार्किंग की जगह में पार्क न करें।',
    pa: 'ਤਾਂ ਇਸ ਪਾਰਕਿੰਗ ਲਈ ਪਰਮਿਟ ਵਰਤਿਆ ਨਹੀਂ ਜਾ ਸਕਦਾ। ਪਹੁੰਚਯੋਗ ਪਾਰਕਿੰਗ ਵਾਲੀ ਥਾਂ ਵਿੱਚ ਪਾਰਕ ਨਾ ਕਰੋ।',
  },
  // Spec T4 item 5, exact: resident and business permits.
  'result.permit.forThisCarQuestion': {
    en: 'Is this permit for this car, and displayed or registered to it?',
    'zh-CN': '这张许可证是给这辆车的吗?它是否展示在车上,或登记在这辆车名下?',
    vi: 'Giấy phép này có dành cho chiếc xe này không, và có đang được trưng bày hoặc đăng ký cho xe này không?',
    id: 'Apakah izin ini untuk mobil ini, dan dipasang di mobil atau terdaftar untuk mobil ini?',
    ko: '이 허가증이 이 차량용이며, 차량에 보이게 놓여 있거나 이 차량으로 등록되어 있나요?',
    it: "Questo permesso è per quest'auto, ed è esposto o registrato per quest'auto?",
    el: 'Είναι αυτή η άδεια για αυτό το αυτοκίνητο, και είναι σε κοινή θέα ή καταχωρισμένη σε αυτό;',
    hi: 'क्या यह परमिट इसी गाड़ी के लिए है, और गाड़ी पर दिखाया गया है या इसी गाड़ी के नाम पंजीकृत है?',
    pa: "ਕੀ ਇਹ ਪਰਮਿਟ ਇਸੇ ਕਾਰ ਲਈ ਹੈ, ਅਤੇ ਕਾਰ 'ਤੇ ਦਿਖਾਇਆ ਗਿਆ ਹੈ ਜਾਂ ਇਸੇ ਕਾਰ ਦੇ ਨਾਮ ਰਜਿਸਟਰਡ ਹੈ?",
  },
  // "No" to the question above, in the permit-zone gate.
  'result.permit.forThisCarNo': {
    en: "Then the permit can't be used for this park. Don't park in this permit zone without a valid permit for it.",
    'zh-CN': '那么这次停车不能使用该许可证。没有适用于这个许可证区域的有效许可证,请不要在这里停车。',
    vi: 'Vậy thì không thể dùng giấy phép cho lần đỗ xe này. Đừng đỗ trong khu vực giấy phép này nếu không có giấy phép hợp lệ cho khu vực đó.',
    id: 'Kalau begitu, izin ini tidak bisa dipakai untuk parkir kali ini. Jangan parkir di zona izin ini tanpa izin yang berlaku untuk zona ini.',
    ko: '그렇다면 이번 주차에는 허가증을 사용할 수 없습니다. 이 허가 구역에 유효한 허가증 없이 주차하지 마세요.',
    it: 'Allora il permesso non può essere usato per questo parcheggio. Non parcheggiare in questa zona a permesso senza un permesso valido per la zona.',
    el: 'Τότε η άδεια δεν μπορεί να χρησιμοποιηθεί για αυτή τη στάθμευση. Μην παρκάρεις σε αυτή τη ζώνη αδειών χωρίς έγκυρη άδεια για αυτήν.',
    hi: 'तो इस पार्किंग के लिए परमिट का इस्तेमाल नहीं हो सकता। इस परमिट क्षेत्र के लिए मान्य परमिट के बिना यहाँ पार्क न करें।',
    pa: 'ਤਾਂ ਇਸ ਪਾਰਕਿੰਗ ਲਈ ਪਰਮਿਟ ਵਰਤਿਆ ਨਹੀਂ ਜਾ ਸਕਦਾ। ਇਸ ਪਰਮਿਟ ਜ਼ੋਨ ਲਈ ਵੈਧ ਪਰਮਿਟ ਤੋਂ ਬਿਨਾਂ ਇੱਥੇ ਪਾਰਕ ਨਾ ਕਰੋ।',
  },
  // "No" in the permit card, where no gate shows: parking is still allowed by the standard answer.
  'result.permit.noStandardApplies': {
    en: "Then the permit can't be used for this park. Only the standard answer applies.",
    'zh-CN': '那么这次停车不能使用该许可证。只适用标准答复。',
    vi: 'Vậy thì không thể dùng giấy phép cho lần đỗ xe này. Chỉ câu trả lời tiêu chuẩn được áp dụng.',
    id: 'Kalau begitu, izin ini tidak bisa dipakai untuk parkir kali ini. Hanya jawaban standar yang berlaku.',
    ko: '그렇다면 이번 주차에는 허가증을 사용할 수 없습니다. 일반 기준 답변만 적용됩니다.',
    it: 'Allora il permesso non può essere usato per questo parcheggio. Vale solo la risposta standard.',
    el: 'Τότε η άδεια δεν μπορεί να χρησιμοποιηθεί για αυτή τη στάθμευση. Ισχύει μόνο η βασική απάντηση.',
    hi: 'तो इस पार्किंग के लिए परमिट का इस्तेमाल नहीं हो सकता। सिर्फ़ सामान्य जवाब लागू होता है।',
    pa: 'ਤਾਂ ਇਸ ਪਾਰਕਿੰਗ ਲਈ ਪਰਮਿਟ ਵਰਤਿਆ ਨਹੀਂ ਜਾ ਸਕਦਾ। ਸਿਰਫ਼ ਆਮ ਜਵਾਬ ਲਾਗੂ ਹੁੰਦਾ ਹੈ।',
  },
  // Item 6: the optional later permit time, typed in by the driver from the sign.
  'result.permit.timeToggle': {
    en: 'Does the sign give your permit a later time?',
    'zh-CN': '标志是否给你的许可证更晚的时限?',
    vi: 'Biển báo có cho giấy phép của bạn thời hạn muộn hơn không?',
    id: 'Apakah rambu ini memberi izinmu batas waktu yang lebih lama?',
    ko: '표지판에 허가증 소지자를 위한 더 늦은 시간이 적혀 있나요?',
    it: 'Il cartello dà al tuo permesso un orario più tardo?',
    el: 'Δίνει η πινακίδα στην άδειά σου μεταγενέστερη ώρα;',
    hi: 'क्या साइन आपके परमिट को बाद तक का समय देता है?',
    pa: 'ਕੀ ਚਿੰਨ੍ਹ ਤੁਹਾਡੇ ਪਰਮਿਟ ਨੂੰ ਬਾਅਦ ਤੱਕ ਦਾ ਸਮਾਂ ਦਿੰਦਾ ਹੈ?',
  },
  'result.permit.timeLabel': {
    en: 'Your permit time on this sign ends at',
    'zh-CN': '按这块标志,你的许可证时间截止于',
    vi: 'Thời gian theo giấy phép của bạn trên biển này kết thúc lúc',
    id: 'Waktu izinmu di rambu ini berakhir pukul',
    ko: '이 표지판에서 허가증 주차 시간이 끝나는 시각',
    it: 'Il tempo del tuo permesso su questo cartello finisce alle',
    el: 'Ο χρόνος της άδειάς σου σε αυτή την πινακίδα λήγει στις',
    hi: 'इस साइन पर आपके परमिट का समय इतने बजे खत्म होता है',
    pa: "ਇਸ ਚਿੰਨ੍ਹ 'ਤੇ ਤੁਹਾਡੇ ਪਰਮਿਟ ਦਾ ਸਮਾਂ ਇੰਨੇ ਵਜੇ ਖ਼ਤਮ ਹੁੰਦਾ ਹੈ",
  },
  'result.permit.timeHint': {
    en: "Read it from the sign. ParkProof doesn't work out permit times.",
    'zh-CN': '请从标志上读取。ParkProof 不计算许可证时间。',
    vi: 'Hãy đọc thời gian này trên biển báo. ParkProof không tính thời gian theo giấy phép.',
    id: 'Baca dari rambunya. ParkProof tidak menghitung waktu izin.',
    ko: '표지판을 보고 입력하세요. ParkProof는 허가증 주차 시간을 계산하지 않습니다.',
    it: 'Leggilo sul cartello. ParkProof non calcola gli orari dei permessi.',
    el: 'Διάβασέ τη στην πινακίδα. Το ParkProof δεν υπολογίζει χρόνους αδειών.',
    hi: 'इसे साइन पर पढ़ें। ParkProof परमिट का समय नहीं निकालता।',
    pa: 'ਇਸ ਨੂੰ ਚਿੰਨ੍ਹ ਤੋਂ ਪੜ੍ਹੋ। ParkProof ਪਰਮਿਟ ਦਾ ਸਮਾਂ ਨਹੀਂ ਕੱਢਦਾ।',
  },
  'result.permit.timeSet': {
    en: 'Your reminders will count down to {{time}}, the time you entered, with one more when the standard limit ends.',
    'zh-CN': '你的提醒会以你输入的 {{time}} 为准,并在标准时限结束时再提醒一次。',
    vi: 'Lời nhắc của bạn sẽ đếm ngược đến {{time}}, thời gian bạn đã nhập, và có thêm một lời nhắc khi hết giới hạn tiêu chuẩn.',
    id: 'Pengingatmu akan menghitung mundur ke {{time}}, waktu yang kamu isi, ditambah satu pengingat saat batas standar berakhir.',
    ko: '알림은 입력한 시각 {{time}}까지를 기준으로 하며, 일반 기준 시간이 끝날 때 한 번 더 알려 드립니다.',
    it: "I promemoria conteranno fino alle {{time}}, l'orario che hai inserito, più uno quando finisce il limite standard.",
    el: 'Οι υπενθυμίσεις σου θα μετρούν αντίστροφα μέχρι τις {{time}}, την ώρα που έβαλες, και θα υπάρχει μία ακόμη όταν λήγει το βασικό όριο.',
    hi: 'आपके रिमाइंडर आपके डाले गए समय {{time}} तक गिने जाएँगे, और सामान्य सीमा खत्म होने पर एक और रिमाइंडर मिलेगा।',
    pa: "ਤੁਹਾਡੇ ਰਿਮਾਈਂਡਰ ਤੁਹਾਡੇ ਪਾਏ ਸਮੇਂ {{time}} ਤੱਕ ਗਿਣੇ ਜਾਣਗੇ, ਅਤੇ ਆਮ ਸੀਮਾ ਖ਼ਤਮ ਹੋਣ 'ਤੇ ਇੱਕ ਹੋਰ ਰਿਮਾਈਂਡਰ ਮਿਲੇਗਾ।",
  },
  'result.permit.timeNotLater': {
    en: "That time isn't later than the standard limit, so your reminders stay with the standard limit.",
    'zh-CN': '这个时间不晚于标准时限,所以提醒仍按标准时限设置。',
    vi: 'Thời gian đó không muộn hơn giới hạn tiêu chuẩn, nên lời nhắc vẫn theo giới hạn tiêu chuẩn.',
    id: 'Waktu itu tidak lebih lama dari batas standar, jadi pengingatmu tetap mengikuti batas standar.',
    ko: '그 시각은 일반 기준 시간보다 늦지 않으므로 알림은 일반 기준 시간에 맞춰집니다.',
    it: "Quell'orario non è più tardo del limite standard, quindi i promemoria restano sul limite standard.",
    el: 'Αυτή η ώρα δεν είναι μετά το βασικό όριο, οπότε οι υπενθυμίσεις μένουν στο βασικό όριο.',
    hi: 'यह समय सामान्य सीमा के बाद का नहीं है, इसलिए रिमाइंडर सामान्य सीमा के हिसाब से ही रहेंगे।',
    pa: 'ਇਹ ਸਮਾਂ ਆਮ ਸੀਮਾ ਤੋਂ ਬਾਅਦ ਦਾ ਨਹੀਂ ਹੈ, ਇਸ ਲਈ ਰਿਮਾਈਂਡਰ ਆਮ ਸੀਮਾ ਮੁਤਾਬਕ ਹੀ ਰਹਿਣਗੇ।',
  },
  // Item 6, the reminder screen on a record whose permit allows a later time.
  'reminders.permitIntro': {
    en: 'Your permit time runs to <strong>{{when}}</strong>, the time you entered from the sign. Pick when you want to be reminded, choose as many as you like.',
    'zh-CN': '你的许可证时间到 <strong>{{when}}</strong>,这是你根据标志输入的时间。挑一下你想什么时候收到提醒,可以多选。',
    vi: 'Thời gian theo giấy phép của bạn kéo dài đến <strong>{{when}}</strong>, là thời gian bạn đã nhập từ biển báo. Chọn lúc bạn muốn được nhắc, chọn bao nhiêu cũng được.',
    id: 'Waktu izinmu berlaku sampai <strong>{{when}}</strong>, waktu yang kamu isi dari rambu. Pilih kapan kamu mau diingatkan, sebanyak yang kamu mau.',
    ko: '허가증 주차 시간은 표지판을 보고 입력한 <strong>{{when}}</strong>까지입니다. 언제 알림을 받을지 고르세요. 원하는 만큼 여러 개 선택해도 됩니다.',
    it: "Il tempo del tuo permesso dura fino alle <strong>{{when}}</strong>, l'orario che hai inserito leggendo il cartello. Scegli quando ricevere un promemoria, quante volte vuoi.",
    el: 'Ο χρόνος της άδειάς σου διαρκεί μέχρι τις <strong>{{when}}</strong>, την ώρα που έβαλες από την πινακίδα. Διάλεξε πότε θες να σου το θυμίσουμε, όσες φορές θες.',
    hi: 'आपके परमिट का समय <strong>{{when}}</strong> तक है, जो समय आपने साइन से पढ़कर डाला। चुनें कि आपको कब याद दिलाया जाए, जितनी बार चाहें।',
    pa: 'ਤੁਹਾਡੇ ਪਰਮਿਟ ਦਾ ਸਮਾਂ <strong>{{when}}</strong> ਤੱਕ ਹੈ, ਜੋ ਸਮਾਂ ਤੁਸੀਂ ਚਿੰਨ੍ਹ ਤੋਂ ਪੜ੍ਹ ਕੇ ਪਾਇਆ। ਚੁਣੋ ਕਿ ਤੁਹਾਨੂੰ ਕਦੋਂ ਰਿਮਾਈਂਡਰ ਚਾਹੀਦਾ ਹੈ, ਜਿੰਨੇ ਚਾਹੋ ਚੁਣੋ।',
  },
  'reminders.permitExtra': {
    en: "You'll also get a reminder at {{time}}, when the standard limit on this sign ends.",
    'zh-CN': '在 {{time}},也就是这块标志的标准时限结束时,你还会收到一条提醒。',
    vi: 'Bạn cũng sẽ nhận một lời nhắc lúc {{time}}, khi giới hạn tiêu chuẩn trên biển này kết thúc.',
    id: 'Kamu juga akan mendapat pengingat pukul {{time}}, saat batas standar di rambu ini berakhir.',
    ko: '{{time}}, 이 표지판의 일반 기준 시간이 끝날 때도 알림을 받습니다.',
    it: 'Riceverai anche un promemoria alle {{time}}, quando finisce il limite standard di questo cartello.',
    el: 'Θα λάβεις επίσης υπενθύμιση στις {{time}}, όταν λήγει το βασικό όριο αυτής της πινακίδας.',
    hi: '{{time}} पर, जब इस साइन की सामान्य सीमा खत्म होगी, आपको एक और रिमाइंडर भी मिलेगा।',
    pa: "{{time}} 'ਤੇ, ਜਦੋਂ ਇਸ ਚਿੰਨ੍ਹ ਦੀ ਆਮ ਸੀਮਾ ਖ਼ਤਮ ਹੋਵੇਗੀ, ਤੁਹਾਨੂੰ ਇੱਕ ਹੋਰ ਰਿਮਾਈਂਡਰ ਵੀ ਮਿਲੇਗਾ।",
  },
  // Spec T4 item 6, exact: the reminder at standard_until. {{time}} is the permit time.
  'reminders.permitStandardEnds': {
    en: 'The standard limit on this sign ends now. Your permit time runs to {{time}}.',
    'zh-CN': '这块标志的标准时限现在结束。你的许可证时间到 {{time}}。',
    vi: 'Giới hạn tiêu chuẩn trên biển này kết thúc bây giờ. Thời gian theo giấy phép của bạn kéo dài đến {{time}}.',
    id: 'Batas standar di rambu ini berakhir sekarang. Waktu izinmu berlaku sampai {{time}}.',
    ko: '이 표지판의 일반 기준 시간이 지금 끝납니다. 허가증 주차 시간은 {{time}}까지입니다.',
    it: 'Il limite standard di questo cartello finisce ora. Il tempo del tuo permesso dura fino alle {{time}}.',
    el: 'Το βασικό όριο αυτής της πινακίδας λήγει τώρα. Ο χρόνος της άδειάς σου διαρκεί μέχρι τις {{time}}.',
    hi: 'इस साइन की सामान्य सीमा अभी खत्म हो रही है। आपके परमिट का समय {{time}} तक है।',
    pa: 'ਇਸ ਚਿੰਨ੍ਹ ਦੀ ਆਮ ਸੀਮਾ ਹੁਣ ਖ਼ਤਮ ਹੋ ਰਹੀ ਹੈ। ਤੁਹਾਡੇ ਪਰਮਿਟ ਦਾ ਸਮਾਂ {{time}} ਤੱਕ ਹੈ।',
  },
  'scheduledReminders.firesAtStandardEnd': {
    en: '{{when}}: the standard limit ends',
    'zh-CN': '{{when}}:标准时限结束',
    vi: '{{when}}: hết giới hạn tiêu chuẩn',
    id: '{{when}}: batas standar berakhir',
    ko: '{{when}}: 일반 기준 시간 종료',
    it: '{{when}}: finisce il limite standard',
    el: '{{when}}: λήγει το βασικό όριο',
    hi: '{{when}}: सामान्य सीमा खत्म',
    pa: '{{when}}: ਆਮ ਸੀਮਾ ਖ਼ਤਮ',
  },
  // Item 9, the home layout. The row T5a fills in.
  'home.weeklyReminders': {
    en: 'Street sweeping and weekly reminders',
    'zh-CN': '街道清扫和每周提醒',
    vi: 'Quét đường và nhắc nhở hằng tuần',
    id: 'Penyapuan jalan dan pengingat mingguan',
    ko: '거리 청소 및 매주 알림',
    it: 'Pulizia strade e promemoria settimanali',
    el: 'Καθαρισμός δρόμων και εβδομαδιαίες υπενθυμίσεις',
    hi: 'सड़क सफ़ाई और साप्ताहिक रिमाइंडर',
    pa: 'ਸੜਕ ਸਫ਼ਾਈ ਅਤੇ ਹਫ਼ਤਾਵਾਰੀ ਰਿਮਾਈਂਡਰ',
  },
  'home.settings': {
    en: 'Settings',
    'zh-CN': '设置',
    vi: 'Cài đặt',
    id: 'Pengaturan',
    ko: '설정',
    it: 'Impostazioni',
    el: 'Ρυθμίσεις',
    hi: 'सेटिंग्स',
    pa: 'ਸੈਟਿੰਗਾਂ',
  },
  // Settings' right-hand label while nobody is signed in (the email when someone is).
  'home.settingsSignIn': {
    en: 'Sign in to sync',
    'zh-CN': '登录以同步',
    vi: 'Đăng nhập để đồng bộ',
    id: 'Masuk untuk sinkronisasi',
    ko: '동기화하려면 로그인',
    it: 'Accedi per sincronizzare',
    el: 'Συνδέσου για συγχρονισμό',
    hi: 'सिंक के लिए साइन इन करें',
    pa: 'ਸਿੰਕ ਲਈ ਸਾਈਨ ਇਨ ਕਰੋ',
  },
  // The link T6b shows (workday mode).
  'home.startWorkday': {
    en: 'Parking all day? Start a workday',
    'zh-CN': '要停一整天?开始工作日',
    vi: 'Đỗ xe cả ngày? Bắt đầu một ngày làm việc',
    id: 'Parkir seharian? Mulai hari kerja',
    ko: '하루 종일 주차하나요? 근무일 시작하기',
    it: 'Parcheggi tutto il giorno? Inizia una giornata di lavoro',
    el: 'Παρκάρεις όλη μέρα; Ξεκίνα μια εργάσιμη μέρα',
    hi: 'पूरे दिन पार्किंग? वर्कडे शुरू करें',
    pa: 'ਸਾਰਾ ਦਿਨ ਪਾਰਕਿੰਗ? ਵਰਕਡੇ ਸ਼ੁਰੂ ਕਰੋ',
  },
  // The link to T8's notice lookup.
  'home.fineStart': {
    en: 'Got a fine? Start here',
    'zh-CN': '收到罚款?从这里开始',
    vi: 'Bị phạt? Bắt đầu từ đây',
    id: 'Kena denda? Mulai di sini',
    ko: '벌금을 받았나요? 여기서 시작하세요',
    it: 'Hai preso una multa? Inizia da qui',
    el: 'Πήρες πρόστιμο; Ξεκίνα από εδώ',
    hi: 'जुर्माना मिला? यहाँ से शुरू करें',
    pa: 'ਜੁਰਮਾਨਾ ਮਿਲਿਆ? ਇੱਥੋਂ ਸ਼ੁਰੂ ਕਰੋ',
  },
  // The home card's Share icon (T7 wires it).
  'active.shareAria': {
    en: 'Share where the car is',
    'zh-CN': '分享车停在哪里',
    vi: 'Chia sẻ vị trí xe',
    id: 'Bagikan lokasi mobil',
    ko: '차량 위치 공유',
    it: "Condividi dov'è l'auto",
    el: 'Κοινοποίηση του σημείου όπου είναι το αυτοκίνητο',
    hi: 'शेयर करें कि गाड़ी कहाँ है',
    pa: 'ਸਾਂਝਾ ਕਰੋ ਕਿ ਕਾਰ ਕਿੱਥੇ ਹੈ',
  },
  // ═══ Review fixes (round 1) ═════════════════════════════════════════════
  // Settings' own privacy link (prefs.* namespace, spec T4 item 1).
  'prefs.privacyCta': {
    en: 'Open privacy policy',
    'zh-CN': '打开隐私政策',
    vi: 'Mở chính sách bảo mật',
    id: 'Buka kebijakan privasi',
    ko: '개인정보 정책 열기',
    it: 'Apri policy sulla privacy',
    el: 'Άνοιγμα πολιτικής απορρήτου',
    hi: 'गोपनीयता नीति खोलें',
    pa: 'ਨਿੱਜਤਾ ਨੀਤੀ ਖੋਲ੍ਹੋ',
  },
  // Copy rule, exact: the reliability line on the reminder screens (same text as prefs.remindersReliability).
  'reminders.reliability': {
    en: "Reminders can be delayed or silenced, for example by Focus or battery saving. Don't rely on them alone.",
    'zh-CN': '提醒可能会延迟或被静音,例如因为专注模式或省电模式。不要只依赖提醒。',
    vi: 'Nhắc nhở có thể bị trễ hoặc bị tắt tiếng, ví dụ do chế độ Tập trung hoặc tiết kiệm pin. Đừng chỉ dựa vào nhắc nhở.',
    id: 'Pengingat bisa tertunda atau dibisukan, misalnya oleh mode Fokus atau penghemat baterai. Jangan hanya mengandalkan pengingat.',
    ko: '알림은 집중 모드나 배터리 절약 등으로 늦어지거나 무음이 될 수 있습니다. 알림에만 의존하지 마세요.',
    it: 'I promemoria possono arrivare in ritardo o essere silenziati, per esempio da Full immersion o dal risparmio energetico. Non affidarti solo a loro.',
    el: 'Οι υπενθυμίσεις μπορεί να καθυστερήσουν ή να σιγήσουν, για παράδειγμα λόγω Εστίασης ή εξοικονόμησης μπαταρίας. Μη βασίζεσαι μόνο σε αυτές.',
    hi: 'रिमाइंडर में देरी हो सकती है या वे बंद हो सकते हैं, जैसे फ़ोकस या बैटरी सेवर की वजह से। सिर्फ़ इन पर निर्भर न रहें।',
    pa: "ਰਿਮਾਈਂਡਰ ਲੇਟ ਹੋ ਸਕਦੇ ਹਨ ਜਾਂ ਚੁੱਪ ਹੋ ਸਕਦੇ ਹਨ, ਜਿਵੇਂ ਫ਼ੋਕਸ ਜਾਂ ਬੈਟਰੀ ਸੇਵਰ ਕਾਰਨ। ਸਿਰਫ਼ ਇਨ੍ਹਾਂ 'ਤੇ ਨਿਰਭਰ ਨਾ ਰਹੋ।",
  },
  // The 0-minute chip on a record whose reminders count down to the permit time the driver entered.
  'reminders.chipAtPermitTime': {
    en: 'At permit time',
    'zh-CN': '许可证时间结束时',
    vi: 'Lúc hết thời gian giấy phép',
    id: 'Saat waktu izin berakhir',
    ko: '허가증 시간 종료 시점',
    it: 'Alla fine del permesso',
    el: 'Στη λήξη του χρόνου άδειας',
    hi: 'परमिट का समय खत्म होने पर',
    pa: "ਪਰਮਿਟ ਦਾ ਸਮਾਂ ਖ਼ਤਮ ਹੋਣ 'ਤੇ",
  },
  // Push takes at most 6 reminders a record; one is the standard-limit reminder. {{count}} is 5.
  'reminders.permitChipLimit_one': {
    en: 'You can pick up to {{count}} reminder here, plus the one when the standard limit ends.',
    'zh-CN': '这里最多可以选 {{count}} 个提醒,另外还有标准时限结束时的那一个。',
    vi: 'Bạn có thể chọn tối đa {{count}} lời nhắc ở đây, cộng thêm lời nhắc lúc hết giới hạn tiêu chuẩn.',
    id: 'Kamu bisa memilih sampai {{count}} pengingat di sini, ditambah satu saat batas standar berakhir.',
    ko: '여기서는 알림을 최대 {{count}}개까지 고를 수 있으며, 일반 기준 시간이 끝날 때의 알림이 따로 하나 더 있습니다.',
    it: 'Qui puoi scegliere al massimo {{count}} promemoria, più quello alla fine del limite standard.',
    el: 'Εδώ μπορείς να διαλέξεις έως {{count}} υπενθύμιση, συν αυτήν όταν λήγει το βασικό όριο.',
    hi: 'यहाँ आप ज़्यादा से ज़्यादा {{count}} रिमाइंडर चुन सकते हैं, इसके अलावा एक रिमाइंडर सामान्य सीमा खत्म होने पर मिलेगा।',
    pa: "ਇੱਥੇ ਤੁਸੀਂ ਵੱਧ ਤੋਂ ਵੱਧ {{count}} ਰਿਮਾਈਂਡਰ ਚੁਣ ਸਕਦੇ ਹੋ, ਇਸ ਤੋਂ ਇਲਾਵਾ ਇੱਕ ਰਿਮਾਈਂਡਰ ਆਮ ਸੀਮਾ ਖ਼ਤਮ ਹੋਣ 'ਤੇ ਮਿਲੇਗਾ।",
  },
  'reminders.permitChipLimit_other': {
    en: 'You can pick up to {{count}} reminders here, plus the one when the standard limit ends.',
    'zh-CN': '这里最多可以选 {{count}} 个提醒,另外还有标准时限结束时的那一个。',
    vi: 'Bạn có thể chọn tối đa {{count}} lời nhắc ở đây, cộng thêm lời nhắc lúc hết giới hạn tiêu chuẩn.',
    id: 'Kamu bisa memilih sampai {{count}} pengingat di sini, ditambah satu saat batas standar berakhir.',
    ko: '여기서는 알림을 최대 {{count}}개까지 고를 수 있으며, 일반 기준 시간이 끝날 때의 알림이 따로 하나 더 있습니다.',
    it: 'Qui puoi scegliere al massimo {{count}} promemoria, più quello alla fine del limite standard.',
    el: 'Εδώ μπορείς να διαλέξεις έως {{count}} υπενθυμίσεις, συν αυτήν όταν λήγει το βασικό όριο.',
    hi: 'यहाँ आप ज़्यादा से ज़्यादा {{count}} रिमाइंडर चुन सकते हैं, इसके अलावा एक रिमाइंडर सामान्य सीमा खत्म होने पर मिलेगा।',
    pa: "ਇੱਥੇ ਤੁਸੀਂ ਵੱਧ ਤੋਂ ਵੱਧ {{count}} ਰਿਮਾਈਂਡਰ ਚੁਣ ਸਕਦੇ ਹੋ, ਇਸ ਤੋਂ ਇਲਾਵਾ ਇੱਕ ਰਿਮਾਈਂਡਰ ਆਮ ਸੀਮਾ ਖ਼ਤਮ ਹੋਣ 'ਤੇ ਮਿਲੇਗਾ।",
  },
  // Reminders on a permit-adjusted record: the time is the driver's own reading off the sign,
  // so it is never called the parking expiry (copy rule: driver statements). {{time}} is the permit time.
  'reminders.permitBodyAt': {
    en: 'The permit time you entered from the sign ends at {{time}}. Time to move the car.',
    'zh-CN': '你根据标志输入的许可证时间在 {{time}} 结束。该挪车了。',
    vi: 'Thời gian theo giấy phép mà bạn đã nhập từ biển báo kết thúc lúc {{time}}. Đã đến lúc dời xe.',
    id: 'Waktu izin yang kamu isi dari rambu berakhir pukul {{time}}. Saatnya memindahkan mobil.',
    ko: '표지판을 보고 입력한 허가증 주차 시간이 {{time}}에 끝납니다. 이제 차를 옮길 시간입니다.',
    it: "Il tempo del permesso che hai inserito leggendo il cartello finisce alle {{time}}. È ora di spostare l'auto.",
    el: 'Ο χρόνος της άδειας που έβαλες από την πινακίδα λήγει στις {{time}}. Ώρα να μετακινήσεις το αυτοκίνητο.',
    hi: 'साइन से पढ़कर डाला गया आपके परमिट का समय {{time}} पर खत्म हो रहा है। अब गाड़ी हटाने का समय है।',
    pa: "ਚਿੰਨ੍ਹ ਤੋਂ ਪੜ੍ਹ ਕੇ ਪਾਇਆ ਤੁਹਾਡੇ ਪਰਮਿਟ ਦਾ ਸਮਾਂ {{time}} 'ਤੇ ਖ਼ਤਮ ਹੋ ਰਿਹਾ ਹੈ। ਹੁਣ ਕਾਰ ਹਟਾਉਣ ਦਾ ਸਮਾਂ ਹੈ।",
  },
  'reminders.permitBodyBefore_one': {
    en: 'The permit time you entered from the sign ends at {{time}}. This is your {{count}}-minute reminder.',
    'zh-CN': '你根据标志输入的许可证时间将于 {{time}} 结束。这是提前 {{count}} 分钟的提醒。',
    vi: 'Thời gian theo giấy phép mà bạn đã nhập từ biển báo kết thúc lúc {{time}}. Đây là lời nhắc trước {{count}} phút.',
    id: 'Waktu izin yang kamu isi dari rambu berakhir pukul {{time}}. Ini pengingat {{count}} menit sebelumnya.',
    ko: '표지판을 보고 입력한 허가증 주차 시간이 {{time}}에 끝납니다. {{count}}분 전 알림입니다.',
    it: 'Il tempo del permesso che hai inserito leggendo il cartello finisce alle {{time}}. Questo è il promemoria di {{count}} minuto prima.',
    el: 'Ο χρόνος της άδειας που έβαλες από την πινακίδα λήγει στις {{time}}. Αυτή είναι η υπενθύμισή σου {{count}} λεπτό πριν.',
    hi: 'साइन से पढ़कर डाला गया आपके परमिट का समय {{time}} पर खत्म होगा। यह {{count}} मिनट पहले का रिमाइंडर है।',
    pa: "ਚਿੰਨ੍ਹ ਤੋਂ ਪੜ੍ਹ ਕੇ ਪਾਇਆ ਤੁਹਾਡੇ ਪਰਮਿਟ ਦਾ ਸਮਾਂ {{time}} 'ਤੇ ਖ਼ਤਮ ਹੋਵੇਗਾ। ਇਹ {{count}} ਮਿੰਟ ਪਹਿਲਾਂ ਦਾ ਰਿਮਾਈਂਡਰ ਹੈ।",
  },
  'reminders.permitBodyBefore_other': {
    en: 'The permit time you entered from the sign ends at {{time}}. This is your {{count}}-minute reminder.',
    'zh-CN': '你根据标志输入的许可证时间将于 {{time}} 结束。这是提前 {{count}} 分钟的提醒。',
    vi: 'Thời gian theo giấy phép mà bạn đã nhập từ biển báo kết thúc lúc {{time}}. Đây là lời nhắc trước {{count}} phút.',
    id: 'Waktu izin yang kamu isi dari rambu berakhir pukul {{time}}. Ini pengingat {{count}} menit sebelumnya.',
    ko: '표지판을 보고 입력한 허가증 주차 시간이 {{time}}에 끝납니다. {{count}}분 전 알림입니다.',
    it: 'Il tempo del permesso che hai inserito leggendo il cartello finisce alle {{time}}. Questo è il promemoria di {{count}} minuti prima.',
    el: 'Ο χρόνος της άδειας που έβαλες από την πινακίδα λήγει στις {{time}}. Αυτή είναι η υπενθύμισή σου {{count}} λεπτά πριν.',
    hi: 'साइन से पढ़कर डाला गया आपके परमिट का समय {{time}} पर खत्म होगा। यह {{count}} मिनट पहले का रिमाइंडर है।',
    pa: "ਚਿੰਨ੍ਹ ਤੋਂ ਪੜ੍ਹ ਕੇ ਪਾਇਆ ਤੁਹਾਡੇ ਪਰਮਿਟ ਦਾ ਸਮਾਂ {{time}} 'ਤੇ ਖ਼ਤਮ ਹੋਵੇਗਾ। ਇਹ {{count}} ਮਿੰਟ ਪਹਿਲਾਂ ਦਾ ਰਿਮਾਈਂਡਰ ਹੈ।",
  },
  // The calendar file for a permit-adjusted record: its event title and description.
  'reminders.calendarPermitTitle': {
    en: 'ParkProof: the permit time you entered ends',
    'zh-CN': 'ParkProof:你输入的许可证时间结束',
    vi: 'ParkProof: hết thời gian giấy phép bạn đã nhập',
    id: 'ParkProof: waktu izin yang kamu isi berakhir',
    ko: 'ParkProof: 입력한 허가증 주차 시간 종료',
    it: 'ParkProof: finisce il tempo del permesso che hai inserito',
    el: 'ParkProof: λήγει ο χρόνος άδειας που έβαλες',
    hi: 'ParkProof: आपका डाला गया परमिट समय खत्म',
    pa: 'ParkProof: ਤੁਹਾਡਾ ਪਾਇਆ ਪਰਮਿਟ ਸਮਾਂ ਖ਼ਤਮ',
  },
  'reminders.calendarPermitSummary': {
    en: "The permit time you entered from the sign ends at {{time}}. ParkProof doesn't work out permit times.",
    'zh-CN': '你根据标志输入的许可证时间在 {{time}} 结束。ParkProof 不计算许可证时间。',
    vi: 'Thời gian theo giấy phép mà bạn đã nhập từ biển báo kết thúc lúc {{time}}. ParkProof không tính thời gian theo giấy phép.',
    id: 'Waktu izin yang kamu isi dari rambu berakhir pukul {{time}}. ParkProof tidak menghitung waktu izin.',
    ko: '표지판을 보고 입력한 허가증 주차 시간이 {{time}}에 끝납니다. ParkProof는 허가증 주차 시간을 계산하지 않습니다.',
    it: 'Il tempo del permesso che hai inserito leggendo il cartello finisce alle {{time}}. ParkProof non calcola gli orari dei permessi.',
    el: 'Ο χρόνος της άδειας που έβαλες από την πινακίδα λήγει στις {{time}}. Το ParkProof δεν υπολογίζει χρόνους αδειών.',
    hi: 'साइन से पढ़कर डाला गया आपके परमिट का समय {{time}} पर खत्म होता है। ParkProof परमिट का समय नहीं निकालता।',
    pa: "ਚਿੰਨ੍ਹ ਤੋਂ ਪੜ੍ਹ ਕੇ ਪਾਇਆ ਤੁਹਾਡੇ ਪਰਮਿਟ ਦਾ ਸਮਾਂ {{time}} 'ਤੇ ਖ਼ਤਮ ਹੁੰਦਾ ਹੈ। ParkProof ਪਰਮਿਟ ਦਾ ਸਮਾਂ ਨਹੀਂ ਕੱਢਦਾ।",
  },
  // The record screen's reminder list on a permit-adjusted record.
  'scheduledReminders.firesAtPermitTime': {
    en: '{{when}}: when the permit time you entered ends',
    'zh-CN': '{{when}}:你输入的许可证时间结束时',
    vi: '{{when}}: khi hết thời gian giấy phép bạn đã nhập',
    id: '{{when}}: saat waktu izin yang kamu isi berakhir',
    ko: '{{when}}: 입력한 허가증 주차 시간 종료 시점',
    it: '{{when}}: alla fine del tempo del permesso che hai inserito',
    el: '{{when}}: όταν λήγει ο χρόνος άδειας που έβαλες',
    hi: '{{when}}: आपके डाले गए परमिट समय के खत्म होने पर',
    pa: "{{when}}: ਤੁਹਾਡੇ ਪਾਏ ਪਰਮਿਟ ਸਮੇਂ ਦੇ ਖ਼ਤਮ ਹੋਣ 'ਤੇ",
  },
  'scheduledReminders.firesBeforePermitTime_one': {
    en: '{{when}}: {{count}} min before the permit time you entered',
    'zh-CN': '{{when}}:你输入的许可证时间结束前 {{count}} 分钟',
    vi: '{{when}}: {{count}} phút trước khi hết thời gian giấy phép bạn đã nhập',
    id: '{{when}}: {{count}} menit sebelum waktu izin yang kamu isi berakhir',
    ko: '{{when}}: 입력한 허가증 주차 시간 종료 {{count}}분 전',
    it: '{{when}}: {{count}} min prima della fine del tempo del permesso che hai inserito',
    el: '{{when}}: {{count}} λεπτό πριν λήξει ο χρόνος άδειας που έβαλες',
    hi: '{{when}}: आपके डाले गए परमिट समय के खत्म होने से {{count}} मिनट पहले',
    pa: '{{when}}: ਤੁਹਾਡੇ ਪਾਏ ਪਰਮਿਟ ਸਮੇਂ ਦੇ ਖ਼ਤਮ ਹੋਣ ਤੋਂ {{count}} ਮਿੰਟ ਪਹਿਲਾਂ',
  },
  'scheduledReminders.firesBeforePermitTime_other': {
    en: '{{when}}: {{count}} min before the permit time you entered',
    'zh-CN': '{{when}}:你输入的许可证时间结束前 {{count}} 分钟',
    vi: '{{when}}: {{count}} phút trước khi hết thời gian giấy phép bạn đã nhập',
    id: '{{when}}: {{count}} menit sebelum waktu izin yang kamu isi berakhir',
    ko: '{{when}}: 입력한 허가증 주차 시간 종료 {{count}}분 전',
    it: '{{when}}: {{count}} min prima della fine del tempo del permesso che hai inserito',
    el: '{{when}}: {{count}} λεπτά πριν λήξει ο χρόνος άδειας που έβαλες',
    hi: '{{when}}: आपके डाले गए परमिट समय के खत्म होने से {{count}} मिनट पहले',
    pa: '{{when}}: ਤੁਹਾਡੇ ਪਾਏ ਪਰਮਿਟ ਸਮੇਂ ਦੇ ਖ਼ਤਮ ਹੋਣ ਤੋਂ {{count}} ਮਿੰਟ ਪਹਿਲਾਂ',
  },
  // Privacy (item 8): push reminders are stored on the server until sent, and their text can
  // mention a permit time (EventBridge deletes each schedule after it fires).
  'privacy.anonymousPush': {
    en: "<strong>Push reminders</strong>, if you turn them on: the record's address, each reminder's time and its text (which can mention a permit time you entered) go to <strong>ParkProof's server</strong>, which keeps each one until it is sent, then deletes it.",
    'zh-CN':
      '<strong>推送提醒</strong>(如果你开启):记录的地址、每条提醒的时间和内容(内容可能提到你输入的许可证时间)会发送到 <strong>ParkProof 的服务器</strong>。服务器会保留每条提醒直到发出,然后删除。',
    vi: '<strong>Lời nhắc đẩy</strong>, nếu bạn bật: địa chỉ của bản ghi, thời gian và nội dung của từng lời nhắc (có thể nhắc tới thời gian giấy phép bạn đã nhập) được gửi tới <strong>máy chủ của ParkProof</strong>. Máy chủ giữ từng lời nhắc cho đến khi gửi đi, rồi xoá.',
    id: '<strong>Pengingat push</strong>, kalau kamu menyalakannya: alamat catatan, waktu setiap pengingat dan isinya (yang bisa menyebut waktu izin yang kamu isi) dikirim ke <strong>server ParkProof</strong>, yang menyimpan setiap pengingat sampai terkirim, lalu menghapusnya.',
    ko: '<strong>푸시 알림</strong>을 켜면 기록의 주소, 각 알림의 시간과 내용(입력한 허가증 주차 시간이 언급될 수 있음)이 <strong>ParkProof 서버</strong>로 전송됩니다. 서버는 각 알림을 보낼 때까지 보관한 뒤 삭제합니다.',
    it: "<strong>Promemoria push</strong>, se li attivi: l'indirizzo del record, l'orario di ogni promemoria e il suo testo (che può citare un tempo del permesso che hai inserito) vanno al <strong>server di ParkProof</strong>, che conserva ciascuno finché non viene inviato, poi lo cancella.",
    el: '<strong>Υπενθυμίσεις push</strong>, αν τις ενεργοποιήσεις: η διεύθυνση του αρχείου, η ώρα κάθε υπενθύμισης και το κείμενό της (που μπορεί να αναφέρει χρόνο άδειας που έβαλες) πηγαίνουν στον <strong>server του ParkProof</strong>, που κρατά την καθεμία μέχρι να σταλεί και μετά τη διαγράφει.',
    hi: '<strong>पुश रिमाइंडर</strong>, अगर आप इन्हें चालू करते हैं: रिकॉर्ड का पता, हर रिमाइंडर का समय और उसका संदेश (जिसमें आपके डाले गए परमिट समय का ज़िक्र हो सकता है) <strong>ParkProof के सर्वर</strong> को भेजे जाते हैं, जो हर रिमाइंडर को भेजे जाने तक रखता है और फिर मिटा देता है।',
    pa: '<strong>ਪੁਸ਼ ਰਿਮਾਈਂਡਰ</strong>, ਜੇ ਤੁਸੀਂ ਇਨ੍ਹਾਂ ਨੂੰ ਚਾਲੂ ਕਰਦੇ ਹੋ: ਰਿਕਾਰਡ ਦਾ ਪਤਾ, ਹਰ ਰਿਮਾਈਂਡਰ ਦਾ ਸਮਾਂ ਅਤੇ ਉਸ ਦਾ ਸੁਨੇਹਾ (ਜਿਸ ਵਿੱਚ ਤੁਹਾਡੇ ਪਾਏ ਪਰਮਿਟ ਸਮੇਂ ਦਾ ਜ਼ਿਕਰ ਹੋ ਸਕਦਾ ਹੈ) <strong>ParkProof ਦੇ ਸਰਵਰ</strong> ਨੂੰ ਭੇਜੇ ਜਾਂਦੇ ਹਨ, ਜੋ ਹਰ ਰਿਮਾਈਂਡਰ ਨੂੰ ਭੇਜੇ ਜਾਣ ਤੱਕ ਰੱਖਦਾ ਹੈ ਅਤੇ ਫਿਰ ਮਿਟਾ ਦਿੰਦਾ ਹੈ।',
  },
  // Privacy (items 6 and 8, N3): the permit details kept with a record, what signing sends
  // (a commitment, plus the gate answers in arrival_context), and that deleting a saved
  // permit in Settings leaves records already saved as they are.
  'privacy.anonymousPermits': {
    en: "<strong>A permit you use for a park</strong>: its type, its area or zone and any permit time you entered are kept with that record. Signing the record sends a fingerprint of these details, not the details, along with your answers to the permit questions. Deleting a permit in Settings doesn't change records already saved. Deleting the record removes them.",
    'zh-CN':
      '<strong>你在某次停车中使用的许可证</strong>:它的类型、区域以及你输入的许可证时间会和这条记录保存在一起。为记录签名时,发送的是这些信息的指纹,而不是信息本身,同时还会发送你对许可证问题的回答。在设置里删除许可证不会改变已保存的记录。删除这条记录才会删除这些信息。',
    vi: '<strong>Giấy phép bạn dùng cho một lần đỗ xe</strong>: loại, khu vực và thời gian giấy phép bạn đã nhập được lưu cùng bản ghi đó. Khi ký bản ghi, điện thoại gửi dấu vân tay của các chi tiết này, không phải bản thân chi tiết, cùng với câu trả lời của bạn cho các câu hỏi về giấy phép. Xoá giấy phép trong Cài đặt không thay đổi các bản ghi đã lưu. Xoá bản ghi sẽ xoá các chi tiết này.',
    id: '<strong>Izin yang kamu pakai untuk suatu parkir</strong>: jenisnya, area atau zonanya, dan waktu izin yang kamu isi disimpan bersama catatan itu. Saat catatan ditandatangani, yang dikirim adalah sidik jari detail ini, bukan detailnya, bersama jawabanmu atas pertanyaan tentang izin. Menghapus izin di Pengaturan tidak mengubah catatan yang sudah disimpan. Menghapus catatannya akan menghapus detail ini.',
    ko: '<strong>주차에 사용한 허가증</strong>: 허가증 종류, 구역, 입력한 허가증 주차 시간이 그 기록과 함께 보관됩니다. 기록에 서명할 때는 이 세부 정보 자체가 아니라 그 지문이 전송되며, 허가증 질문에 대한 답도 함께 전송됩니다. 설정에서 허가증을 삭제해도 이미 저장된 기록은 바뀌지 않습니다. 기록을 삭제하면 이 정보도 삭제됩니다.',
    it: "<strong>Un permesso che usi per un parcheggio</strong>: il tipo, l'area o zona e l'eventuale tempo del permesso che hai inserito restano con quel record. Firmando il record si invia un'impronta di questi dettagli, non i dettagli, insieme alle tue risposte alle domande sul permesso. Eliminare un permesso nelle Impostazioni non cambia i record già salvati. Eliminando il record si eliminano anche questi dettagli.",
    el: '<strong>Μια άδεια που χρησιμοποιείς για μια στάθμευση</strong>: ο τύπος της, η περιοχή ή ζώνη της και όποιος χρόνος άδειας έβαλες κρατιούνται μαζί με εκείνο το αρχείο. Η υπογραφή του αρχείου στέλνει ένα αποτύπωμα αυτών των στοιχείων, όχι τα ίδια τα στοιχεία, μαζί με τις απαντήσεις σου στις ερωτήσεις για την άδεια. Η διαγραφή μιας άδειας στις Ρυθμίσεις δεν αλλάζει αρχεία που έχουν ήδη αποθηκευτεί. Η διαγραφή του αρχείου τα διαγράφει.',
    hi: '<strong>किसी पार्किंग में इस्तेमाल किया गया परमिट</strong>: उसका प्रकार, क्षेत्र या ज़ोन, और आपका डाला गया परमिट समय उस रिकॉर्ड के साथ रखे जाते हैं। रिकॉर्ड पर हस्ताक्षर के लिए इन ब्योरों का फ़िंगरप्रिंट भेजा जाता है, ब्योरे नहीं, और साथ में परमिट वाले सवालों के आपके जवाब भी। सेटिंग्स में परमिट मिटाने से पहले से सहेजे गए रिकॉर्ड नहीं बदलते। रिकॉर्ड मिटाने पर ये ब्योरे भी मिट जाते हैं।',
    pa: "<strong>ਕਿਸੇ ਪਾਰਕਿੰਗ ਵਿੱਚ ਵਰਤਿਆ ਪਰਮਿਟ</strong>: ਉਸ ਦੀ ਕਿਸਮ, ਖੇਤਰ ਜਾਂ ਜ਼ੋਨ, ਅਤੇ ਤੁਹਾਡਾ ਪਾਇਆ ਪਰਮਿਟ ਸਮਾਂ ਉਸ ਰਿਕਾਰਡ ਨਾਲ ਰੱਖੇ ਜਾਂਦੇ ਹਨ। ਰਿਕਾਰਡ 'ਤੇ ਹਸਤਾਖਰ ਲਈ ਇਨ੍ਹਾਂ ਵੇਰਵਿਆਂ ਦਾ ਫਿੰਗਰਪ੍ਰਿੰਟ ਭੇਜਿਆ ਜਾਂਦਾ ਹੈ, ਵੇਰਵੇ ਨਹੀਂ, ਅਤੇ ਨਾਲ ਹੀ ਪਰਮਿਟ ਵਾਲੇ ਸਵਾਲਾਂ ਦੇ ਤੁਹਾਡੇ ਜਵਾਬ ਵੀ। ਸੈਟਿੰਗਾਂ ਵਿੱਚ ਪਰਮਿਟ ਮਿਟਾਉਣ ਨਾਲ ਪਹਿਲਾਂ ਤੋਂ ਸੰਭਾਲੇ ਰਿਕਾਰਡ ਨਹੀਂ ਬਦਲਦੇ। ਰਿਕਾਰਡ ਮਿਟਾਉਣ 'ਤੇ ਇਹ ਵੇਰਵੇ ਵੀ ਮਿਟ ਜਾਂਦੇ ਹਨ।",
  },
  // permit_context and permit_salt sync with the record (ALLOWED_SESSION_FIELDS); the Settings profile never does.
  'privacy.signedInPermits': {
    en: "<strong>Permit details</strong> kept with a record (the type, area or zone and any permit time you entered, for a park where you used a saved permit) are stored with that record in AWS DynamoDB. Your saved permits in Settings aren't. Deleting the record removes them.",
    'zh-CN':
      '记录里保存的<strong>许可证信息</strong>(你在某次停车中使用已保存许可证时的类型、区域以及你输入的许可证时间)会随这条记录存储在 AWS DynamoDB 中。设置里保存的许可证不会上传。删除这条记录就会删除这些信息。',
    vi: '<strong>Chi tiết giấy phép</strong> lưu cùng một bản ghi (loại, khu vực và thời gian giấy phép bạn đã nhập, cho lần đỗ xe bạn dùng giấy phép đã lưu) được lưu cùng bản ghi đó trong AWS DynamoDB. Các giấy phép bạn lưu trong Cài đặt thì không. Xoá bản ghi sẽ xoá các chi tiết này.',
    id: '<strong>Detail izin</strong> yang disimpan bersama catatan (jenis, area atau zona, dan waktu izin yang kamu isi, untuk parkir yang memakai izin tersimpan) disimpan bersama catatan itu di AWS DynamoDB. Izin yang kamu simpan di Pengaturan tidak. Menghapus catatannya akan menghapus detail ini.',
    ko: '기록과 함께 보관되는 <strong>허가증 세부 정보</strong>(저장한 허가증을 사용한 주차의 허가증 종류, 구역, 입력한 허가증 주차 시간)는 그 기록과 함께 AWS DynamoDB에 저장됩니다. 설정에 저장한 허가증은 저장되지 않습니다. 기록을 삭제하면 이 정보도 삭제됩니다.',
    it: 'I <strong>dettagli del permesso</strong> tenuti con un record (tipo, area o zona ed eventuale tempo del permesso che hai inserito, per un parcheggio in cui hai usato un permesso salvato) vengono memorizzati con quel record in AWS DynamoDB. I permessi salvati nelle Impostazioni no. Eliminando il record si eliminano anche questi dettagli.',
    el: 'Τα <strong>στοιχεία άδειας</strong> που κρατιούνται με ένα αρχείο (ο τύπος, η περιοχή ή ζώνη και όποιος χρόνος άδειας έβαλες, για μια στάθμευση όπου χρησιμοποίησες αποθηκευμένη άδεια) αποθηκεύονται μαζί με εκείνο το αρχείο στο AWS DynamoDB. Οι άδειες που έχεις αποθηκεύσει στις Ρυθμίσεις όχι. Η διαγραφή του αρχείου τα διαγράφει.',
    hi: 'किसी रिकॉर्ड के साथ रखे गए <strong>परमिट के ब्योरे</strong> (जिस पार्किंग में आपने सहेजा गया परमिट इस्तेमाल किया, उसका प्रकार, क्षेत्र या ज़ोन, और आपका डाला गया परमिट समय) उस रिकॉर्ड के साथ AWS DynamoDB में सहेजे जाते हैं। सेटिंग्स में सहेजे गए आपके परमिट नहीं। रिकॉर्ड मिटाने पर ये ब्योरे भी मिट जाते हैं।',
    pa: "ਕਿਸੇ ਰਿਕਾਰਡ ਨਾਲ ਰੱਖੇ <strong>ਪਰਮਿਟ ਦੇ ਵੇਰਵੇ</strong> (ਜਿਸ ਪਾਰਕਿੰਗ ਵਿੱਚ ਤੁਸੀਂ ਸੰਭਾਲਿਆ ਪਰਮਿਟ ਵਰਤਿਆ, ਉਸ ਦੀ ਕਿਸਮ, ਖੇਤਰ ਜਾਂ ਜ਼ੋਨ, ਅਤੇ ਤੁਹਾਡਾ ਪਾਇਆ ਪਰਮਿਟ ਸਮਾਂ) ਉਸ ਰਿਕਾਰਡ ਨਾਲ AWS DynamoDB ਵਿੱਚ ਸੰਭਾਲੇ ਜਾਂਦੇ ਹਨ। ਸੈਟਿੰਗਾਂ ਵਿੱਚ ਸੰਭਾਲੇ ਤੁਹਾਡੇ ਪਰਮਿਟ ਨਹੀਂ। ਰਿਕਾਰਡ ਮਿਟਾਉਣ 'ਤੇ ਇਹ ਵੇਰਵੇ ਵੀ ਮਿਟ ਜਾਂਦੇ ਹਨ।",
  },
}

// ── Existing strings this task rewrites (explicit list; all 9 locales) ──
const OVERWRITES = {
  // ═══ Unit: settings and privacy (item 8) ═════════════════════════════════
  // Spec T4 item 8, exact. Drops the <code>localStorage</code> tag in every locale.
  'privacy.anonymousIntro': {
    en: "ParkProof works without an account. Your records are stored in this browser. To sign a record, your phone sends its details (times, location, what you entered, and photo fingerprints, not the photos) to ParkProof's server, which signs them and doesn't keep a copy.",
    'zh-CN':
      'ParkProof 不需要账户也能使用。你的记录保存在这个浏览器里。为了给记录签名,你的手机会把记录的详细信息(时间、位置、你填写的内容,以及照片指纹,但不包括照片本身)发送到 ParkProof 的服务器,服务器签名后不会保留副本。',
    vi: 'ParkProof dùng được mà không cần tài khoản. Các bản ghi của bạn được lưu trong trình duyệt này. Để ký một bản ghi, điện thoại của bạn gửi các chi tiết của bản ghi (thời gian, vị trí, những gì bạn đã nhập và dấu vân tay của ảnh, không phải bản thân ảnh) tới máy chủ của ParkProof. Máy chủ ký các chi tiết đó và không giữ lại bản sao.',
    id: 'ParkProof bisa dipakai tanpa akun. Catatanmu disimpan di browser ini. Untuk menandatangani catatan, ponselmu mengirim detailnya (waktu, lokasi, apa yang kamu isi, dan sidik jari foto, bukan fotonya) ke server ParkProof, yang menandatanganinya dan tidak menyimpan salinannya.',
    ko: 'ParkProof는 계정 없이도 작동합니다. 기록은 이 브라우저에 저장됩니다. 기록에 서명하기 위해 휴대폰이 기록의 세부 정보(시간, 위치, 입력한 내용, 그리고 사진 자체가 아닌 사진 지문)를 ParkProof 서버로 보내며, 서버는 서명한 뒤 사본을 보관하지 않습니다.',
    it: 'ParkProof funziona senza account. I tuoi record sono salvati in questo browser. Per firmare un record, il telefono invia i suoi dettagli (orari, posizione, ciò che hai inserito e le impronte delle foto, non le foto) al server di ParkProof, che li firma e non ne conserva una copia.',
    el: 'Το ParkProof λειτουργεί χωρίς λογαριασμό. Τα αρχεία σου αποθηκεύονται σε αυτόν τον browser. Για να υπογραφεί ένα αρχείο, το τηλέφωνό σου στέλνει τα στοιχεία του (ώρες, τοποθεσία, ό,τι συμπλήρωσες και τα αποτυπώματα των φωτογραφιών, όχι τις φωτογραφίες) στον server του ParkProof, που τα υπογράφει και δεν κρατά αντίγραφο.',
    hi: 'ParkProof बिना खाते के भी काम करता है। आपके रिकॉर्ड इसी ब्राउज़र में सहेजे जाते हैं। किसी रिकॉर्ड पर हस्ताक्षर के लिए आपका फ़ोन उसका ब्योरा (समय, स्थान, भरी गई जानकारी, और फ़ोटो के फ़िंगरप्रिंट, फ़ोटो नहीं) ParkProof के सर्वर को भेजता है, जो उन पर हस्ताक्षर करता है और उनकी कोई कॉपी नहीं रखता।',
    pa: "ParkProof ਬਿਨਾਂ ਖਾਤੇ ਦੇ ਵੀ ਕੰਮ ਕਰਦਾ ਹੈ। ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਇਸੇ ਬ੍ਰਾਊਜ਼ਰ ਵਿੱਚ ਸੰਭਾਲੇ ਜਾਂਦੇ ਹਨ। ਕਿਸੇ ਰਿਕਾਰਡ 'ਤੇ ਹਸਤਾਖਰ ਲਈ ਤੁਹਾਡਾ ਫ਼ੋਨ ਉਸ ਦਾ ਵੇਰਵਾ (ਸਮਾਂ, ਸਥਾਨ, ਭਰੀ ਗਈ ਜਾਣਕਾਰੀ, ਅਤੇ ਫੋਟੋਆਂ ਦੇ ਫਿੰਗਰਪ੍ਰਿੰਟ, ਫੋਟੋਆਂ ਨਹੀਂ) ParkProof ਦੇ ਸਰਵਰ ਨੂੰ ਭੇਜਦਾ ਹੈ, ਜੋ ਉਨ੍ਹਾਂ 'ਤੇ ਹਸਤਾਖਰ ਕਰਦਾ ਹੈ ਅਤੇ ਉਨ੍ਹਾਂ ਦੀ ਕੋਈ ਕਾਪੀ ਨਹੀਂ ਰੱਖਦਾ।",
  },
  // Was "Three things do leave your device, even in anonymous mode:"; the list is now four.
  'privacy.anonymousThings': {
    en: 'These also leave your device, even without an account:',
    'zh-CN': '即使没有账户,下面这些也会离开你的设备:',
    vi: 'Những thứ sau cũng rời khỏi thiết bị của bạn, kể cả khi không có tài khoản:',
    id: 'Hal-hal ini juga meninggalkan perangkatmu, bahkan tanpa akun:',
    ko: '계정이 없어도 다음 항목은 기기 밖으로 전송됩니다:',
    it: 'Anche queste cose lasciano il tuo dispositivo, pure senza account:',
    el: 'Αυτά φεύγουν επίσης από τη συσκευή σου, ακόμα και χωρίς λογαριασμό:',
    hi: 'बिना खाते के भी ये चीज़ें आपके डिवाइस से बाहर जाती हैं:',
    pa: 'ਬਿਨਾਂ ਖਾਤੇ ਦੇ ਵੀ ਇਹ ਚੀਜ਼ਾਂ ਤੁਹਾਡੇ ਡਿਵਾਈਸ ਤੋਂ ਬਾਹਰ ਜਾਂਦੀਆਂ ਹਨ:',
  },
  // Item 8: what is sent to the AI with each scan.
  'privacy.anonymousAnthropic': {
    en: "<strong>Each sign photo you scan</strong> is sent to <strong>Anthropic</strong> (Claude) to read the sign, with its location and the type of each permit you've saved (plus the area or zone of a resident or business permit). A re-check sends the earlier reading instead of the photo. We don't keep the photo or the location. The answer, which can mention your permit types, stays on our server briefly so your phone can collect it. Anthropic's retention policy applies.",
    'zh-CN':
      '<strong>你扫描的每张标志照片</strong>都会发送给 <strong>Anthropic</strong>(Claude)来读取标志,同时发送拍摄位置和你保存的每个许可证的类型(居民或商户许可证还会附上区域)。重新检查时发送的是之前的读取结果,而不是照片。我们不保留照片或位置。答案中可能提到你的许可证类型,它会在我们的服务器上短暂保留,好让你的手机取回。适用 Anthropic 的保留政策。',
    vi: '<strong>Mỗi ảnh biển báo bạn quét</strong> được gửi tới <strong>Anthropic</strong> (Claude) để đọc biển báo, kèm vị trí chụp và loại của từng giấy phép bạn đã lưu (cùng khu vực của giấy phép cư dân hoặc doanh nghiệp). Khi kiểm tra lại, kết quả đọc trước đó được gửi thay cho ảnh. Chúng tôi không giữ ảnh hay vị trí. Câu trả lời, có thể nhắc tới loại giấy phép của bạn, được lưu ngắn hạn trên máy chủ của chúng tôi để điện thoại của bạn nhận về. Chính sách lưu trữ của Anthropic được áp dụng.',
    id: '<strong>Setiap foto rambu yang kamu pindai</strong> dikirim ke <strong>Anthropic</strong> (Claude) untuk membaca rambunya, bersama lokasinya dan jenis setiap izin yang kamu simpan (ditambah area atau zona untuk izin penghuni atau usaha). Cek ulang mengirim hasil bacaan sebelumnya, bukan fotonya. Kami tidak menyimpan foto atau lokasinya. Jawabannya, yang bisa menyebut jenis izinmu, disimpan sebentar di server kami supaya ponselmu bisa mengambilnya. Kebijakan penyimpanan Anthropic yang berlaku.',
    ko: '<strong>스캔하는 표지판 사진</strong>은 표지판을 읽기 위해 <strong>Anthropic</strong>(Claude)으로 전송되며, 촬영 위치와 저장한 허가증의 종류(거주자 또는 사업자 허가증은 구역 포함)도 함께 전송됩니다. 다시 확인할 때는 사진 대신 이전 판독 결과가 전송됩니다. 사진과 위치는 보관하지 않습니다. 허가증 종류가 언급될 수 있는 답은 휴대폰이 가져갈 수 있도록 서버에 잠시 보관됩니다. Anthropic의 보관 정책이 적용됩니다.',
    it: "<strong>Ogni foto di cartello che scansioni</strong> viene inviata ad <strong>Anthropic</strong> (Claude) per leggere il cartello, insieme alla posizione e al tipo di ogni permesso che hai salvato (più l'area o zona di un permesso per residenti o per attività). Un ricontrollo invia la lettura precedente al posto della foto. Non conserviamo né la foto né la posizione. La risposta, che può citare i tipi dei tuoi permessi, resta per poco sul nostro server così il telefono può recuperarla. Si applica la policy di conservazione di Anthropic.",
    el: 'Κάθε <strong>φωτογραφία πινακίδας που σαρώνεις</strong> στέλνεται στην <strong>Anthropic</strong> (Claude) για να διαβαστεί η πινακίδα, μαζί με την τοποθεσία της και τον τύπο κάθε άδειας που έχεις αποθηκεύσει (και την περιοχή ή ζώνη μιας άδειας κατοίκων ή επιχειρήσεων). Ένας νέος έλεγχος στέλνει την προηγούμενη ανάγνωση αντί για τη φωτογραφία. Δεν κρατάμε τη φωτογραφία ούτε την τοποθεσία. Η απάντηση, που μπορεί να αναφέρει τους τύπους των αδειών σου, μένει για λίγο στον server μας ώστε να την πάρει το τηλέφωνό σου. Ισχύει η πολιτική διατήρησης της Anthropic.',
    hi: 'हर <strong>स्कैन की गई साइन फ़ोटो</strong> साइन पढ़ने के लिए <strong>Anthropic</strong> (Claude) को भेजी जाती है, साथ में उसका स्थान और सहेजे गए हर परमिट का प्रकार भी (निवासी या व्यावसायिक परमिट का क्षेत्र या ज़ोन भी)। दोबारा जाँच करने पर फ़ोटो की जगह पिछली रीडिंग भेजी जाती है। हम फ़ोटो या स्थान नहीं रखते। जवाब, जिसमें आपके परमिट के प्रकार का ज़िक्र हो सकता है, थोड़ी देर हमारे सर्वर पर रहता है ताकि आपका फ़ोन उसे ले सके। Anthropic की रिटेंशन नीति लागू होती है।',
    pa: "ਹਰ <strong>ਸਕੈਨ ਕੀਤੀ ਚਿੰਨ੍ਹ ਫੋਟੋ</strong> ਚਿੰਨ੍ਹ ਪੜ੍ਹਨ ਲਈ <strong>Anthropic</strong> (Claude) ਨੂੰ ਭੇਜੀ ਜਾਂਦੀ ਹੈ, ਨਾਲ ਹੀ ਉਸ ਦਾ ਸਥਾਨ ਅਤੇ ਸੰਭਾਲੇ ਗਏ ਹਰ ਪਰਮਿਟ ਦੀ ਕਿਸਮ ਵੀ (ਨਿਵਾਸੀ ਜਾਂ ਕਾਰੋਬਾਰੀ ਪਰਮਿਟ ਦਾ ਖੇਤਰ ਜਾਂ ਜ਼ੋਨ ਵੀ)। ਮੁੜ ਜਾਂਚ ਕਰਨ 'ਤੇ ਫੋਟੋ ਦੀ ਥਾਂ ਪਿਛਲੀ ਰੀਡਿੰਗ ਭੇਜੀ ਜਾਂਦੀ ਹੈ। ਅਸੀਂ ਫੋਟੋ ਜਾਂ ਸਥਾਨ ਨਹੀਂ ਰੱਖਦੇ। ਜਵਾਬ, ਜਿਸ ਵਿੱਚ ਤੁਹਾਡੇ ਪਰਮਿਟ ਦੀ ਕਿਸਮ ਦਾ ਜ਼ਿਕਰ ਹੋ ਸਕਦਾ ਹੈ, ਥੋੜ੍ਹੀ ਦੇਰ ਸਾਡੇ ਸਰਵਰ 'ਤੇ ਰਹਿੰਦਾ ਹੈ ਤਾਂ ਜੋ ਤੁਹਾਡਾ ਫ਼ੋਨ ਉਸ ਨੂੰ ਲੈ ਸਕੇ। Anthropic ਦੀ ਰਿਟੈਂਸ਼ਨ ਨੀਤੀ ਲਾਗੂ ਹੁੰਦੀ ਹੈ।",
  },
  // ═══ Unit: result screen and home (item 9) ═══════════════════════════════
  // The home row is "History" (spec T4 item 9); the record noun is never "session".
  // zh-CN and hi already said "parking records" / "record history" and keep their text.
  'home.history': {
    en: 'History',
    'zh-CN': '停车记录',
    vi: 'Lịch sử',
    id: 'Riwayat',
    ko: '주차 기록',
    it: 'Cronologia',
    el: 'Ιστορικό',
    hi: 'रिकॉर्ड इतिहास',
    pa: 'ਰਿਕਾਰਡ ਇਤਿਹਾਸ',
  },
}

// ── Keys an earlier draft of this script added and T4 no longer uses ────
// Deleted when present, so a re-run over files that have them converges.
const REMOVALS = []

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

/** Delete a key this script once added, when present. Never touches anything else. */
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

/** U+2014, which the copy rules ban. */
const EM_DASH = String.fromCharCode(0x2014)

// The characters jsPDF's built-in Helvetica draws: WinAnsi (cp1252).
const CP1252_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
])
const isWinAnsi = (s) =>
  [...s].every((ch) => {
    const cp = ch.codePointAt(0)
    return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || CP1252_EXTRAS.has(cp)
  })

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
    for (const [locale, s] of Object.entries(byLocale)) {
      // Copy rules: no em-dashes. PDF strings: plain text and WinAnsi punctuation, no symbols.
      if (s.includes(EM_DASH)) problems.push(`${locale}: em-dash in new copy at ${path}`)
      if (/[✓⚠→≈≤±\u{1F300}-\u{1FAFF}]/u.test(s)) problems.push(`${locale}: symbol in new copy at ${path}`)
      if (path.startsWith('pdf.') && HELVETICA_LOCALES.includes(locale) && !isWinAnsi(s)) {
        problems.push(`${locale}: ${path} has a character Helvetica (WinAnsi) can't draw`)
      }
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
