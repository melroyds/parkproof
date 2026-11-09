/**
 * Field-test fix list i18n: items 1, 2 and 5 (push reminders) and the
 * Tier 2 Android tips. Idempotent: running it twice leaves the files
 * byte-identical after the first run.
 *
 * Adds, under `reminders`:
 *   - `remindMe.*`: the one "Remind me" button that replaces "Enable push"
 *     and "Enable N browser notifications" on every reminder surface, its
 *     busy label, the confirmation with the booked times (works with
 *     ParkProof closed, or only while it's open), "No reminder was set",
 *     and the one next step for each reason push isn't working (install to
 *     the Home Screen on iPhone, allow notifications, unsupported browser,
 *     try again, times already passed);
 *   - `reliability`: the line every reminder feature carries;
 *   - `androidTips.*`: the collapsed Android-only help (Chrome's spam
 *     warning, Samsung battery use);
 *   - `chipFiresAt`, `chipPast`: the chip tooltips, which were hardcoded
 *     English;
 *   - `reconnect.*`: "Reminders not arriving? Reconnect" in the push
 *     management blocks (About, account settings), in the Android tips on
 *     the reminder screens, and its results;
 *   - `timesOnDay`: the join in "9:00 am, 9:30 am on Mon 09/11/2026", which
 *     was the hardcoded English " on " inside translated sentences.
 * And `scheduledReminders.chipAlreadySet` (a chip tooltip, was hardcoded).
 *
 * Rewrites three existing strings (OVERWRITES below): the About push block
 * and the account settings push copy said allowing notifications made
 * future reminders "fire", but nothing is booked until Remind me is tapped
 * on a parking record. Keys the reminder screens no longer use
 * (reminders.pushStatus.*, reminders.browser*, reminders.pushScheduleFailed,
 * reminders.noSign.browserCopy, scheduledReminders.pushNotEnabled) are left
 * in place.
 *
 * On-screen labels quoted in the copy follow what each platform shows in
 * that language where it's known (iOS Share / Add to Home Screen, Chrome's
 * Allow, Samsung's Unrestricted). id, hi and pa keep the English iOS
 * labels, as installPrompt.iosBody already does; hi and pa add the English
 * Samsung label in brackets.
 *
 * Writes nothing unless every locale passes the parity checks (the same
 * rules src/lib/locales.test.ts enforces, plus: every `_one` key this
 * script owns carries {{count}} in every locale, and no new string has an
 * em-dash).
 *
 * Run:   node scripts/_i18n_inject_fix_push.mjs
 * List:  node scripts/_i18n_inject_fix_push.mjs --list
 * Other: node scripts/_i18n_inject_fix_push.mjs --dir <locales dir>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

// ── New keys, appended inside their parent object ────────────────────────
const ADDITIONS = {
  // ── The one primary action ──
  'reminders.remindMe.cta': {
    en: 'Remind me',
    'zh-CN': '提醒我',
    vi: 'Nhắc tôi',
    id: 'Ingatkan saya',
    ko: '알림 받기',
    it: 'Ricordamelo',
    el: 'Υπενθύμισέ μου',
    hi: 'मुझे याद दिलाएं',
    pa: 'ਮੈਨੂੰ ਯਾਦ ਕਰਵਾਓ',
  },
  'reminders.remindMe.busy': {
    en: 'Setting up…',
    'zh-CN': '正在设置…',
    vi: 'Đang thiết lập…',
    id: 'Sedang menyiapkan…',
    ko: '설정하는 중…',
    it: 'Impostazione in corso…',
    el: 'Γίνεται ρύθμιση…',
    hi: 'सेट किया जा रहा है…',
    pa: 'ਸੈੱਟ ਕੀਤਾ ਜਾ ਰਿਹਾ ਹੈ…',
  },
  // Push reminders booked: they are sent to this device with ParkProof
  // closed. Says what the app does, not that the driver will get them: the
  // field test saw a booked reminder arrive late or never (fix list item 5),
  // and the reliability line sits right under this.
  // {{times}} is formatReminderTimesLine ("4:30 pm, 4:45 pm").
  'reminders.remindMe.setBackground_one': {
    en: "{{count}} reminder set for <strong>{{times}}</strong>. It's sent to this device even when ParkProof is closed.",
    'zh-CN': '已为 <strong>{{times}}</strong> 设置 {{count}} 个提醒。即使 ParkProof 已关闭,提醒也会发送到此设备。',
    vi: 'Đã đặt {{count}} lời nhắc lúc <strong>{{times}}</strong>. Lời nhắc vẫn được gửi đến thiết bị này kể cả khi ParkProof đã đóng.',
    id: '{{count}} pengingat diatur untuk <strong>{{times}}</strong>. Pengingat tetap dikirim ke perangkat ini walaupun ParkProof ditutup.',
    ko: '<strong>{{times}}</strong>에 알림 {{count}}개를 설정했습니다. ParkProof를 닫아도 알림은 이 기기로 전송됩니다.',
    it: '{{count}} promemoria impostato per le <strong>{{times}}</strong>. Viene inviato a questo dispositivo anche con ParkProof chiuso.',
    el: 'Ορίστηκε {{count}} υπενθύμιση για τις <strong>{{times}}</strong>. Στέλνεται σε αυτή τη συσκευή ακόμα κι αν το ParkProof είναι κλειστό.',
    hi: '<strong>{{times}}</strong> के लिए {{count}} रिमाइंडर सेट हो गया। ParkProof बंद होने पर भी यह इस डिवाइस पर भेजा जाएगा।',
    pa: "<strong>{{times}}</strong> ਲਈ {{count}} ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਹੋ ਗਿਆ। ParkProof ਬੰਦ ਹੋਣ 'ਤੇ ਵੀ ਇਹ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਭੇਜਿਆ ਜਾਵੇਗਾ।",
  },
  'reminders.remindMe.setBackground_other': {
    en: "{{count}} reminders set for <strong>{{times}}</strong>. They're sent to this device even when ParkProof is closed.",
    'zh-CN': '已为 <strong>{{times}}</strong> 设置 {{count}} 个提醒。即使 ParkProof 已关闭,提醒也会发送到此设备。',
    vi: 'Đã đặt {{count}} lời nhắc lúc <strong>{{times}}</strong>. Lời nhắc vẫn được gửi đến thiết bị này kể cả khi ParkProof đã đóng.',
    id: '{{count}} pengingat diatur untuk <strong>{{times}}</strong>. Pengingat tetap dikirim ke perangkat ini walaupun ParkProof ditutup.',
    ko: '<strong>{{times}}</strong>에 알림 {{count}}개를 설정했습니다. ParkProof를 닫아도 알림은 이 기기로 전송됩니다.',
    it: '{{count}} promemoria impostati per le <strong>{{times}}</strong>. Vengono inviati a questo dispositivo anche con ParkProof chiuso.',
    el: 'Ορίστηκαν {{count}} υπενθυμίσεις για τις <strong>{{times}}</strong>. Στέλνονται σε αυτή τη συσκευή ακόμα κι αν το ParkProof είναι κλειστό.',
    hi: '<strong>{{times}}</strong> के लिए {{count}} रिमाइंडर सेट हो गए। ParkProof बंद होने पर भी ये इस डिवाइस पर भेजे जाएंगे।',
    pa: "<strong>{{times}}</strong> ਲਈ {{count}} ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਹੋ ਗਏ। ParkProof ਬੰਦ ਹੋਣ 'ਤੇ ਵੀ ਇਹ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਭੇਜੇ ਜਾਣਗੇ।",
  },
  // Only in-tab reminders: they work while ParkProof is open.
  'reminders.remindMe.setOpenOnly_one': {
    en: '{{count}} reminder set for <strong>{{times}}</strong>, but it only works while ParkProof is open.',
    'zh-CN': '已为 <strong>{{times}}</strong> 设置 {{count}} 个提醒,但只有 ParkProof 开着时才有效。',
    vi: 'Đã đặt {{count}} lời nhắc lúc <strong>{{times}}</strong>, nhưng chỉ hoạt động khi ParkProof đang mở.',
    id: '{{count}} pengingat diatur untuk <strong>{{times}}</strong>, tapi cuma berfungsi selama ParkProof terbuka.',
    ko: '<strong>{{times}}</strong>에 알림 {{count}}개를 설정했지만, ParkProof가 열려 있을 때만 작동합니다.',
    it: '{{count}} promemoria impostato per le <strong>{{times}}</strong>, ma funziona solo finché ParkProof è aperto.',
    el: 'Ορίστηκε {{count}} υπενθύμιση για τις <strong>{{times}}</strong>, αλλά λειτουργεί μόνο όσο το ParkProof είναι ανοιχτό.',
    hi: '<strong>{{times}}</strong> के लिए {{count}} रिमाइंडर सेट हो गया, लेकिन यह सिर्फ़ तभी काम करेगा जब ParkProof खुला हो।',
    pa: '<strong>{{times}}</strong> ਲਈ {{count}} ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਹੋ ਗਿਆ, ਪਰ ਇਹ ਸਿਰਫ਼ ਉਦੋਂ ਹੀ ਕੰਮ ਕਰੇਗਾ ਜਦੋਂ ParkProof ਖੁੱਲ੍ਹਾ ਹੋਵੇ।',
  },
  'reminders.remindMe.setOpenOnly_other': {
    en: '{{count}} reminders set for <strong>{{times}}</strong>, but they only work while ParkProof is open.',
    'zh-CN': '已为 <strong>{{times}}</strong> 设置 {{count}} 个提醒,但只有 ParkProof 开着时才有效。',
    vi: 'Đã đặt {{count}} lời nhắc lúc <strong>{{times}}</strong>, nhưng chỉ hoạt động khi ParkProof đang mở.',
    id: '{{count}} pengingat diatur untuk <strong>{{times}}</strong>, tapi cuma berfungsi selama ParkProof terbuka.',
    ko: '<strong>{{times}}</strong>에 알림 {{count}}개를 설정했지만, ParkProof가 열려 있을 때만 작동합니다.',
    it: '{{count}} promemoria impostati per le <strong>{{times}}</strong>, ma funzionano solo finché ParkProof è aperto.',
    el: 'Ορίστηκαν {{count}} υπενθυμίσεις για τις <strong>{{times}}</strong>, αλλά λειτουργούν μόνο όσο το ParkProof είναι ανοιχτό.',
    hi: '<strong>{{times}}</strong> के लिए {{count}} रिमाइंडर सेट हो गए, लेकिन ये सिर्फ़ तभी काम करेंगे जब ParkProof खुला हो।',
    pa: '<strong>{{times}}</strong> ਲਈ {{count}} ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਹੋ ਗਏ, ਪਰ ਇਹ ਸਿਰਫ਼ ਉਦੋਂ ਹੀ ਕੰਮ ਕਰਨਗੇ ਜਦੋਂ ParkProof ਖੁੱਲ੍ਹਾ ਹੋਵੇ।',
  },
  'reminders.remindMe.notSet': {
    en: 'No reminder was set.',
    'zh-CN': '未设置任何提醒。',
    vi: 'Chưa đặt được lời nhắc nào.',
    id: 'Tidak ada pengingat yang diatur.',
    ko: '알림이 설정되지 않았습니다.',
    it: 'Nessun promemoria impostato.',
    el: 'Δεν ορίστηκε καμία υπενθύμιση.',
    hi: 'कोई रिमाइंडर सेट नहीं हुआ।',
    pa: 'ਕੋਈ ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਨਹੀਂ ਹੋਇਆ।',
  },
  // Next steps. Each quotes the Remind me label above.
  'reminders.remindMe.stepInstall': {
    en: 'On iPhone, reminders need ParkProof on your Home Screen. Tap Share, then Add to Home Screen, then open ParkProof from there and tap Remind me again.',
    'zh-CN': '在 iPhone 上,提醒需要把 ParkProof 添加到主屏幕。点击分享按钮,选择“添加到主屏幕”,然后从主屏幕打开 ParkProof,再点一次“提醒我”。',
    vi: "Trên iPhone, lời nhắc cần ParkProof nằm trên Màn hình chính. Nhấn Chia sẻ, chọn 'Thêm vào Màn hình chính', rồi mở ParkProof từ đó và nhấn lại 'Nhắc tôi'.",
    id: "Di iPhone, pengingat butuh ParkProof ada di Layar Utama. Ketuk Share, pilih 'Add to Home Screen', lalu buka ParkProof dari sana dan ketuk 'Ingatkan saya' lagi.",
    ko: "iPhone에서는 ParkProof를 홈 화면에 추가해야 알림을 받을 수 있습니다. 공유 버튼을 누르고 '홈 화면에 추가'를 선택한 다음, 홈 화면에서 ParkProof를 열고 '알림 받기'를 다시 누르세요.",
    it: 'Su iPhone, i promemoria richiedono ParkProof nella schermata Home. Tocca Condividi, poi "Aggiungi alla schermata Home", apri ParkProof da lì e tocca di nuovo Ricordamelo.',
    el: "Στο iPhone, οι υπενθυμίσεις χρειάζονται το ParkProof στην οθόνη Αφετηρίας. Πάτα Κοινοποίηση, μετά 'Προσθήκη στην οθόνη Αφετηρίας', άνοιξε το ParkProof από εκεί και πάτα ξανά 'Υπενθύμισέ μου'.",
    hi: "iPhone पर रिमाइंडर के लिए ParkProof का होम स्क्रीन पर होना ज़रूरी है। Share पर टैप करें, फिर 'Add to Home Screen' चुनें, फिर वहीं से ParkProof खोलें और दोबारा 'मुझे याद दिलाएं' पर टैप करें।",
    pa: "iPhone 'ਤੇ ਰਿਮਾਈਂਡਰਾਂ ਲਈ ParkProof ਦਾ ਹੋਮ ਸਕਰੀਨ 'ਤੇ ਹੋਣਾ ਜ਼ਰੂਰੀ ਹੈ। ਸ਼ੇਅਰ 'ਤੇ ਟੈਪ ਕਰੋ, ਫਿਰ 'Add to Home Screen' ਚੁਣੋ, ਫਿਰ ਉੱਥੋਂ ParkProof ਖੋਲ੍ਹੋ ਅਤੇ ਦੁਬਾਰਾ 'ਮੈਨੂੰ ਯਾਦ ਕਰਵਾਓ' 'ਤੇ ਟੈਪ ਕਰੋ।",
  },
  'reminders.remindMe.stepAllow': {
    en: "Notifications are off for ParkProof. Allow them when your browser asks, or in your browser's site settings, then tap Remind me again.",
    'zh-CN': 'ParkProof 的通知已关闭。请在浏览器询问时允许,或在浏览器的站点设置中允许,然后再点一次“提醒我”。',
    vi: "Thông báo của ParkProof đang tắt. Hãy cho phép khi trình duyệt hỏi, hoặc trong cài đặt trang của trình duyệt, rồi nhấn lại 'Nhắc tôi'.",
    id: "Notifikasi ParkProof sedang mati. Izinkan saat browsermu bertanya, atau di pengaturan situs browsermu, lalu ketuk 'Ingatkan saya' lagi.",
    ko: "ParkProof 알림이 꺼져 있습니다. 브라우저가 물어볼 때 허용하거나 브라우저의 사이트 설정에서 허용한 다음, '알림 받기'를 다시 누르세요.",
    it: 'Le notifiche di ParkProof sono disattivate. Consentile quando il browser te lo chiede, oppure nelle impostazioni del sito del browser, poi tocca di nuovo Ricordamelo.',
    el: "Οι ειδοποιήσεις του ParkProof είναι απενεργοποιημένες. Επίτρεψέ τες όταν σε ρωτήσει ο browser ή στις ρυθμίσεις ιστότοπου του browser σου και μετά πάτα ξανά 'Υπενθύμισέ μου'.",
    hi: "ParkProof की सूचनाएं बंद हैं। जब ब्राउज़र पूछे तब अनुमति दें, या ब्राउज़र की साइट सेटिंग्स में अनुमति दें, फिर दोबारा 'मुझे याद दिलाएं' पर टैप करें।",
    pa: "ParkProof ਦੀਆਂ ਸੂਚਨਾਵਾਂ ਬੰਦ ਹਨ। ਜਦੋਂ ਬ੍ਰਾਊਜ਼ਰ ਪੁੱਛੇ ਤਾਂ ਇਜਾਜ਼ਤ ਦਿਓ, ਜਾਂ ਬ੍ਰਾਊਜ਼ਰ ਦੀਆਂ ਸਾਈਟ ਸੈਟਿੰਗਾਂ ਵਿੱਚ ਇਜਾਜ਼ਤ ਦਿਓ, ਫਿਰ ਦੁਬਾਰਾ 'ਮੈਨੂੰ ਯਾਦ ਕਰਵਾਓ' 'ਤੇ ਟੈਪ ਕਰੋ।",
  },
  'reminders.remindMe.stepUnsupported': {
    en: "This browser can't send reminders when ParkProof is closed. Use a calendar reminder instead.",
    'zh-CN': '这个浏览器无法在 ParkProof 关闭时发送提醒。请改用日历提醒。',
    vi: 'Trình duyệt này không gửi được lời nhắc khi ParkProof đã đóng. Hãy dùng nhắc nhở qua lịch.',
    id: 'Browser ini tidak bisa mengirim pengingat saat ParkProof ditutup. Gunakan pengingat kalender saja.',
    ko: '이 브라우저는 ParkProof가 닫혀 있을 때 알림을 보낼 수 없습니다. 대신 캘린더 알림을 이용하세요.',
    it: 'Questo browser non può inviare promemoria quando ParkProof è chiuso. Usa invece un promemoria nel calendario.',
    el: 'Αυτός ο browser δεν μπορεί να στείλει υπενθυμίσεις όταν το ParkProof είναι κλειστό. Χρησιμοποίησε καλύτερα μια υπενθύμιση στο ημερολόγιο.',
    hi: 'यह ब्राउज़र ParkProof बंद होने पर रिमाइंडर नहीं भेज सकता। इसके बजाय कैलेंडर रिमाइंडर का उपयोग करें।',
    pa: "ਇਹ ਬ੍ਰਾਊਜ਼ਰ ParkProof ਬੰਦ ਹੋਣ 'ਤੇ ਰਿਮਾਈਂਡਰ ਨਹੀਂ ਭੇਜ ਸਕਦਾ। ਇਸ ਦੀ ਥਾਂ ਕੈਲੰਡਰ ਰਿਮਾਈਂਡਰ ਵਰਤੋ।",
  },
  'reminders.remindMe.stepRetry': {
    en: "Reminders for when ParkProof is closed couldn't be set up. Check your connection, then tap Remind me again.",
    'zh-CN': '无法设置 ParkProof 关闭时的提醒。请检查网络连接,然后再点一次“提醒我”。',
    vi: "Không thiết lập được lời nhắc cho lúc ParkProof đã đóng. Hãy kiểm tra kết nối, rồi nhấn lại 'Nhắc tôi'.",
    id: "Pengingat untuk saat ParkProof ditutup tidak bisa diatur. Cek koneksimu, lalu ketuk 'Ingatkan saya' lagi.",
    ko: "ParkProof가 닫혀 있을 때의 알림을 설정하지 못했습니다. 연결 상태를 확인한 다음 '알림 받기'를 다시 누르세요.",
    it: 'Non è stato possibile impostare i promemoria per quando ParkProof è chiuso. Controlla la connessione, poi tocca di nuovo Ricordamelo.',
    el: "Δεν ήταν δυνατό να οριστούν υπενθυμίσεις για όταν το ParkProof είναι κλειστό. Έλεγξε τη σύνδεσή σου και πάτα ξανά 'Υπενθύμισέ μου'.",
    hi: "ParkProof बंद होने के समय के लिए रिमाइंडर सेट नहीं हो सके। अपना कनेक्शन जांचें, फिर दोबारा 'मुझे याद दिलाएं' पर टैप करें।",
    pa: "ParkProof ਬੰਦ ਹੋਣ ਵੇਲੇ ਲਈ ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਨਹੀਂ ਹੋ ਸਕੇ। ਆਪਣਾ ਕਨੈਕਸ਼ਨ ਜਾਂਚੋ, ਫਿਰ ਦੁਬਾਰਾ 'ਮੈਨੂੰ ਯਾਦ ਕਰਵਾਓ' 'ਤੇ ਟੈਪ ਕਰੋ।",
  },
  'reminders.remindMe.stepAllPast': {
    en: 'The times you picked have passed. Pick a later one.',
    'zh-CN': '你选的时间已经过了。请选一个更晚的时间。',
    vi: 'Thời điểm bạn chọn đã qua. Hãy chọn thời điểm muộn hơn.',
    id: 'Waktu yang kamu pilih sudah lewat. Pilih waktu yang lebih lambat.',
    ko: '선택한 시간이 이미 지났습니다. 더 늦은 시간을 선택하세요.',
    it: 'Gli orari che hai scelto sono già passati. Scegline uno più tardi.',
    el: 'Οι ώρες που διάλεξες έχουν περάσει. Διάλεξε μια μεταγενέστερη ώρα.',
    hi: 'आपके चुने हुए समय निकल चुके हैं। कोई बाद का समय चुनें।',
    pa: 'ਤੁਹਾਡੇ ਚੁਣੇ ਸਮੇਂ ਲੰਘ ਚੁੱਕੇ ਹਨ। ਕੋਈ ਬਾਅਦ ਦਾ ਸਮਾਂ ਚੁਣੋ।',
  },
  // ── The reliability line (build spec copy rules) ──
  'reminders.reliability': {
    en: "Reminders can be delayed or silenced, for example by Focus or battery saving. Don't rely on them alone.",
    'zh-CN': '提醒可能会延迟或被静音,例如受专注模式或省电模式影响。不要只依赖提醒。',
    vi: 'Lời nhắc có thể bị chậm hoặc bị tắt tiếng, chẳng hạn do chế độ Tập trung hoặc tiết kiệm pin. Đừng chỉ dựa vào lời nhắc.',
    id: 'Pengingat bisa tertunda atau dibisukan, misalnya oleh mode Fokus atau penghemat baterai. Jangan hanya mengandalkan pengingat.',
    ko: '알림은 집중 모드나 절전 모드 등으로 늦어지거나 무음 처리될 수 있습니다. 알림에만 의존하지 마세요.',
    it: 'I promemoria possono arrivare in ritardo o essere silenziati, per esempio da Full immersion o dal risparmio energetico. Non affidarti solo a loro.',
    el: 'Οι υπενθυμίσεις μπορεί να καθυστερήσουν ή να σιγαστούν, για παράδειγμα από την Εστίαση ή την εξοικονόμηση μπαταρίας. Μη βασίζεσαι μόνο σε αυτές.',
    hi: 'रिमाइंडर देर से आ सकते हैं या म्यूट हो सकते हैं, जैसे फ़ोकस या बैटरी सेवर की वजह से। सिर्फ़ इन्हीं पर निर्भर न रहें।',
    pa: "ਰਿਮਾਈਂਡਰ ਦੇਰ ਨਾਲ ਆ ਸਕਦੇ ਹਨ ਜਾਂ ਮਿਊਟ ਹੋ ਸਕਦੇ ਹਨ, ਜਿਵੇਂ ਫੋਕਸ ਜਾਂ ਬੈਟਰੀ ਸੇਵਰ ਕਰਕੇ। ਸਿਰਫ਼ ਇਨ੍ਹਾਂ 'ਤੇ ਹੀ ਭਰੋਸਾ ਨਾ ਕਰੋ।",
  },
  // ── Android-only collapsed help (Samsung S26 Ultra, Test C) ──
  'reminders.androidTips.summary': {
    en: 'Tips for Android phones',
    'zh-CN': '安卓手机小贴士',
    vi: 'Mẹo cho điện thoại Android',
    id: 'Tips untuk ponsel Android',
    ko: 'Android 휴대폰 팁',
    it: 'Consigli per telefoni Android',
    el: 'Συμβουλές για κινητά Android',
    hi: 'Android फ़ोन के लिए सुझाव',
    pa: 'Android ਫ਼ੋਨਾਂ ਲਈ ਸੁਝਾਅ',
  },
  'reminders.androidTips.spam': {
    en: 'If Chrome marks a reminder as possible spam, tap Allow.',
    'zh-CN': '如果 Chrome 把提醒标记为可能的垃圾信息,请点击“允许”。',
    vi: 'Nếu Chrome cảnh báo lời nhắc có thể là thư rác, hãy nhấn Cho phép.',
    id: 'Kalau Chrome menandai pengingat sebagai kemungkinan spam, ketuk Izinkan.',
    ko: "Chrome이 알림을 스팸일 수 있다고 표시하면 '허용'을 누르세요.",
    it: 'Se Chrome segnala un promemoria come possibile spam, tocca Consenti.',
    el: 'Αν το Chrome επισημάνει μια υπενθύμιση ως πιθανό spam, πάτα Να επιτρέπεται.',
    hi: "अगर Chrome किसी रिमाइंडर को संभावित स्पैम बताए, तो 'अनुमति दें' पर टैप करें।",
    pa: "ਜੇ Chrome ਕਿਸੇ ਰਿਮਾਈਂਡਰ ਨੂੰ ਸੰਭਾਵੀ ਸਪੈਮ ਦੱਸੇ, ਤਾਂ 'ਇਜਾਜ਼ਤ ਦਿਓ' 'ਤੇ ਟੈਪ ਕਰੋ।",
  },
  'reminders.androidTips.battery': {
    en: "On Samsung, set Chrome's battery use to Unrestricted.",
    'zh-CN': '在三星手机上,把 Chrome 的电池使用设为“无限制”。',
    vi: 'Trên Samsung, đặt mức dùng pin của Chrome thành Không hạn chế.',
    id: 'Di Samsung, atur penggunaan baterai Chrome ke Tidak dibatasi.',
    ko: "삼성 휴대폰에서는 Chrome의 배터리 사용을 '제한 없음'으로 설정하세요.",
    it: "Sui Samsung, imposta l'uso della batteria di Chrome su Senza restrizioni.",
    el: 'Σε Samsung, όρισε τη χρήση μπαταρίας του Chrome σε Χωρίς περιορισμούς.',
    hi: "Samsung पर, Chrome के बैटरी उपयोग को 'अप्रतिबंधित' (Unrestricted) पर सेट करें।",
    pa: "Samsung 'ਤੇ, Chrome ਦੀ ਬੈਟਰੀ ਵਰਤੋਂ ਨੂੰ 'ਬਿਨਾਂ ਪਾਬੰਦੀ' (Unrestricted) 'ਤੇ ਸੈੱਟ ਕਰੋ।",
  },
  // ── Chip tooltips and aria labels (were hardcoded English) ──
  'reminders.chipFiresAt': {
    en: 'Fires at {{when}}',
    'zh-CN': '{{when}} 提醒',
    vi: 'Nhắc lúc {{when}}',
    id: 'Berbunyi pukul {{when}}',
    ko: '{{when}}에 알림',
    it: 'Suona alle {{when}}',
    el: 'Ειδοποίηση στις {{when}}',
    hi: '{{when}} पर बजेगा',
    pa: "{{when}} 'ਤੇ ਵੱਜੇਗਾ",
  },
  'reminders.chipPast': {
    en: 'Already passed',
    'zh-CN': '时间已过',
    vi: 'Đã qua',
    id: 'Sudah lewat',
    ko: '이미 지남',
    it: 'Già passato',
    el: 'Έχει ήδη περάσει',
    hi: 'समय निकल चुका है',
    pa: 'ਸਮਾਂ ਲੰਘ ਚੁੱਕਾ ਹੈ',
  },
  // ── "Reminders not arriving? Reconnect" (fix list item 5) ──
  'reminders.reconnect.cta': {
    en: 'Reminders not arriving? Reconnect',
    'zh-CN': '收不到提醒?重新连接',
    vi: 'Không nhận được lời nhắc? Kết nối lại',
    id: 'Pengingat tidak masuk? Sambungkan ulang',
    ko: '알림이 오지 않나요? 다시 연결',
    it: 'I promemoria non arrivano? Riconnetti',
    el: 'Δεν έρχονται οι υπενθυμίσεις; Επανασύνδεση',
    hi: 'रिमाइंडर नहीं आ रहे? फिर से कनेक्ट करें',
    pa: 'ਰਿਮਾਈਂਡਰ ਨਹੀਂ ਆ ਰਹੇ? ਮੁੜ ਕਨੈਕਟ ਕਰੋ',
  },
  'reminders.reconnect.busy': {
    en: 'Reconnecting…',
    'zh-CN': '正在重新连接…',
    vi: 'Đang kết nối lại…',
    id: 'Menyambungkan ulang…',
    ko: '다시 연결하는 중…',
    it: 'Riconnessione in corso…',
    el: 'Γίνεται επανασύνδεση…',
    hi: 'फिर से कनेक्ट हो रहा है…',
    pa: 'ਮੁੜ ਕਨੈਕਟ ਹੋ ਰਿਹਾ ਹੈ…',
  },
  'reminders.reconnect.done': {
    en: 'Reconnected. Your upcoming reminders on this device will use the new connection.',
    'zh-CN': '已重新连接。此设备上即将到来的提醒会使用新的连接。',
    vi: 'Đã kết nối lại. Các lời nhắc sắp tới trên thiết bị này sẽ dùng kết nối mới.',
    id: 'Tersambung ulang. Pengingat berikutnya di perangkat ini akan memakai sambungan baru.',
    ko: '다시 연결했습니다. 이 기기의 예정된 알림은 새 연결을 사용합니다.',
    it: 'Riconnesso. I prossimi promemoria su questo dispositivo useranno la nuova connessione.',
    el: 'Η επανασύνδεση έγινε. Οι επόμενες υπενθυμίσεις σε αυτή τη συσκευή θα χρησιμοποιούν τη νέα σύνδεση.',
    hi: 'फिर से कनेक्ट हो गया। इस डिवाइस के आने वाले रिमाइंडर नए कनेक्शन का उपयोग करेंगे।',
    pa: 'ਮੁੜ ਕਨੈਕਟ ਹੋ ਗਿਆ। ਇਸ ਡਿਵਾਈਸ ਦੇ ਆਉਣ ਵਾਲੇ ਰਿਮਾਈਂਡਰ ਨਵਾਂ ਕਨੈਕਸ਼ਨ ਵਰਤਣਗੇ।',
  },
  'reminders.reconnect.failed': {
    en: "Couldn't reconnect. Check your connection and try again.",
    'zh-CN': '无法重新连接。请检查网络连接后重试。',
    vi: 'Không kết nối lại được. Hãy kiểm tra kết nối rồi thử lại.',
    id: 'Tidak bisa menyambung ulang. Cek koneksimu lalu coba lagi.',
    ko: '다시 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.',
    it: 'Impossibile riconnettersi. Controlla la connessione e riprova.',
    el: 'Η επανασύνδεση απέτυχε. Έλεγξε τη σύνδεσή σου και δοκίμασε ξανά.',
    hi: 'फिर से कनेक्ट नहीं हो सका। अपना कनेक्शन जांचें और दोबारा कोशिश करें।',
    pa: 'ਮੁੜ ਕਨੈਕਟ ਨਹੀਂ ਹੋ ਸਕਿਆ। ਆਪਣਾ ਕਨੈਕਸ਼ਨ ਜਾਂਚੋ ਅਤੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
  },
  'reminders.reconnect.denied': {
    en: "Notifications are blocked for ParkProof. Allow them in your browser's site settings, then try again.",
    'zh-CN': 'ParkProof 的通知已被阻止。请在浏览器的站点设置中允许通知,然后重试。',
    vi: 'Thông báo của ParkProof đang bị chặn. Hãy cho phép trong cài đặt trang của trình duyệt, rồi thử lại.',
    id: 'Notifikasi ParkProof diblokir. Izinkan di pengaturan situs browsermu, lalu coba lagi.',
    ko: 'ParkProof 알림이 차단되어 있습니다. 브라우저의 사이트 설정에서 허용한 다음 다시 시도하세요.',
    it: 'Le notifiche di ParkProof sono bloccate. Consentile nelle impostazioni del sito del browser, poi riprova.',
    el: 'Οι ειδοποιήσεις του ParkProof είναι αποκλεισμένες. Επίτρεψέ τες στις ρυθμίσεις ιστότοπου του browser σου και δοκίμασε ξανά.',
    hi: 'ParkProof की सूचनाएं ब्लॉक हैं। ब्राउज़र की साइट सेटिंग्स में अनुमति दें, फिर दोबारा कोशिश करें।',
    pa: 'ParkProof ਦੀਆਂ ਸੂਚਨਾਵਾਂ ਬਲਾਕ ਹਨ। ਬ੍ਰਾਊਜ਼ਰ ਦੀਆਂ ਸਾਈਟ ਸੈਟਿੰਗਾਂ ਵਿੱਚ ਇਜਾਜ਼ਤ ਦਿਓ, ਫਿਰ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
  },
  // ── The day join in a reminder times line (was the English " on ") ──
  // {{times}} is "9:00 am, 9:30 am"; {{day}} is "Mon 09/11/2026". Used only
  // when every reminder falls on one day that isn't today.
  'reminders.timesOnDay': {
    en: '{{times}} on {{day}}',
    'zh-CN': '{{day}} {{times}}',
    vi: '{{times}} ngày {{day}}',
    id: '{{times}} pada {{day}}',
    ko: '{{day}} {{times}}',
    it: '{{times}} di {{day}}',
    el: '{{times}} την {{day}}',
    hi: '{{day}} को {{times}}',
    pa: '{{day}} ਨੂੰ {{times}}',
  },
  // ── "+ Add reminder" chip tooltip (was hardcoded English) ──
  'scheduledReminders.chipAlreadySet': {
    en: 'Already set',
    'zh-CN': '已设置',
    vi: 'Đã đặt',
    id: 'Sudah diatur',
    ko: '이미 설정됨',
    it: 'Già impostato',
    el: 'Έχει ήδη οριστεί',
    hi: 'पहले से सेट है',
    pa: 'ਪਹਿਲਾਂ ਹੀ ਸੈੱਟ ਹੈ',
  },
}

// ── Existing strings rewritten whole (each must already exist) ──────────
// The About push block and the account settings push copy promised that
// allowing notifications made future reminders fire, "silently in the
// background". Nothing is booked until Remind me is tapped on a record
// (fix list item 2), and the reliability line now sits under both blocks.
// Rewriting them also drops the em-dashes the old vi and it bodies had.
const OVERWRITES = {
  'about.push.body': {
    en: 'Allowing notifications now saves you a prompt later. Nothing is set until you tap Remind me on a parking record.',
    'zh-CN': '现在允许通知,之后就不会再弹出询问。在停车记录上点击“提醒我”之前,不会设置任何提醒。',
    vi: "Cho phép thông báo ngay bây giờ thì sau này bạn sẽ không bị hỏi lại. Chỉ khi bạn nhấn 'Nhắc tôi' trên một bản ghi đỗ xe thì lời nhắc mới được đặt.",
    id: "Izinkan notifikasi sekarang supaya nanti kamu tidak ditanya lagi. Pengingat baru diatur setelah kamu mengetuk 'Ingatkan saya' di catatan parkir.",
    ko: "지금 알림을 허용해 두면 나중에 권한 요청을 받지 않습니다. 주차 기록에서 '알림 받기'를 눌러야 알림이 설정됩니다.",
    it: 'Se consenti le notifiche ora, dopo non ti verrà più chiesto. Nessun promemoria viene impostato finché non tocchi Ricordamelo su un record di parcheggio.',
    el: "Αν επιτρέψεις τις ειδοποιήσεις τώρα, δεν θα σου ζητηθεί άδεια αργότερα. Καμία υπενθύμιση δεν ορίζεται μέχρι να πατήσεις 'Υπενθύμισέ μου' σε ένα αρχείο στάθμευσης.",
    hi: "अभी सूचनाओं की अनुमति देने से बाद में अनुमति नहीं मांगी जाएगी। जब तक आप किसी पार्किंग रिकॉर्ड पर 'मुझे याद दिलाएं' पर टैप नहीं करते, तब तक कोई रिमाइंडर सेट नहीं होता।",
    pa: "ਹੁਣੇ ਸੂਚਨਾਵਾਂ ਦੀ ਇਜਾਜ਼ਤ ਦੇਣ ਨਾਲ ਬਾਅਦ ਵਿੱਚ ਇਜਾਜ਼ਤ ਨਹੀਂ ਮੰਗੀ ਜਾਵੇਗੀ। ਜਦੋਂ ਤੱਕ ਤੁਸੀਂ ਕਿਸੇ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ 'ਤੇ 'ਮੈਨੂੰ ਯਾਦ ਕਰਵਾਓ' 'ਤੇ ਟੈਪ ਨਹੀਂ ਕਰਦੇ, ਉਦੋਂ ਤੱਕ ਕੋਈ ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਨਹੀਂ ਹੁੰਦਾ।",
  },
  'about.push.subscribed': {
    en: '✓ Notifications are on for this device. To set a reminder, tap Remind me on a parking record.',
    'zh-CN': '✓ 此设备已开启通知。要设置提醒,请在停车记录上点击“提醒我”。',
    vi: "✓ Thông báo đã bật trên thiết bị này. Để đặt lời nhắc, hãy nhấn 'Nhắc tôi' trên một bản ghi đỗ xe.",
    id: "✓ Notifikasi sudah aktif di perangkat ini. Untuk mengatur pengingat, ketuk 'Ingatkan saya' di catatan parkir.",
    ko: "✓ 이 기기에서 알림이 켜져 있습니다. 알림을 설정하려면 주차 기록에서 '알림 받기'를 누르세요.",
    it: '✓ Le notifiche sono attive su questo dispositivo. Per impostare un promemoria, tocca Ricordamelo su un record di parcheggio.',
    el: "✓ Οι ειδοποιήσεις είναι ενεργές σε αυτή τη συσκευή. Για να ορίσεις υπενθύμιση, πάτα 'Υπενθύμισέ μου' σε ένα αρχείο στάθμευσης.",
    hi: "✓ इस डिवाइस पर सूचनाएं चालू हैं। रिमाइंडर सेट करने के लिए किसी पार्किंग रिकॉर्ड पर 'मुझे याद दिलाएं' पर टैप करें।",
    pa: "✓ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਸੂਚਨਾਵਾਂ ਚਾਲੂ ਹਨ। ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਕਰਨ ਲਈ ਕਿਸੇ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ 'ਤੇ 'ਮੈਨੂੰ ਯਾਦ ਕਰਵਾਓ' 'ਤੇ ਟੈਪ ਕਰੋ।",
  },
  'settings.pushCopy': {
    en: "Push lets reminders reach this device when ParkProof is closed. Turning it on sets no reminder by itself. Tap Remind me on a parking record to set one. It's set up per browser on each device, separate from your account.",
    'zh-CN': '推送让提醒在 ParkProof 关闭时也能发送到此设备。开启推送本身不会设置任何提醒。要设置提醒,请在停车记录上点击“提醒我”。推送按浏览器和设备分别设置,与你的账户无关。',
    vi: "Thông báo đẩy giúp lời nhắc đến được thiết bị này khi ParkProof đã đóng. Bật đẩy không tự đặt lời nhắc nào. Hãy nhấn 'Nhắc tôi' trên một bản ghi đỗ xe để đặt lời nhắc. Đẩy được thiết lập riêng cho từng trình duyệt trên mỗi thiết bị, độc lập với tài khoản của bạn.",
    id: "Push memungkinkan pengingat sampai ke perangkat ini saat ParkProof ditutup. Mengaktifkan push saja tidak mengatur pengingat apa pun. Ketuk 'Ingatkan saya' di catatan parkir untuk mengaturnya. Push diatur per browser di setiap perangkat, terpisah dari akunmu.",
    ko: "푸시를 켜면 ParkProof가 닫혀 있어도 알림이 이 기기로 전달될 수 있습니다. 푸시를 켜는 것만으로는 알림이 설정되지 않습니다. 주차 기록에서 '알림 받기'를 눌러 알림을 설정하세요. 푸시는 기기마다 브라우저별로 설정되며 계정과는 별개입니다.",
    it: 'Il push permette ai promemoria di arrivare su questo dispositivo quando ParkProof è chiuso. Attivarlo non imposta nessun promemoria da solo. Tocca Ricordamelo su un record di parcheggio per impostarne uno. Si attiva per ogni browser su ciascun dispositivo, separatamente dal tuo account.',
    el: "Οι ειδοποιήσεις push επιτρέπουν στις υπενθυμίσεις να φτάνουν σε αυτή τη συσκευή όταν το ParkProof είναι κλειστό. Η ενεργοποίησή τους δεν ορίζει από μόνη της καμία υπενθύμιση. Πάτα 'Υπενθύμισέ μου' σε ένα αρχείο στάθμευσης για να ορίσεις μία. Ρυθμίζονται ανά browser σε κάθε συσκευή, ξεχωριστά από τον λογαριασμό σου.",
    hi: "पुश से ParkProof बंद होने पर भी रिमाइंडर इस डिवाइस तक पहुंच सकते हैं। सिर्फ़ पुश चालू करने से कोई रिमाइंडर सेट नहीं होता। रिमाइंडर सेट करने के लिए किसी पार्किंग रिकॉर्ड पर 'मुझे याद दिलाएं' पर टैप करें। पुश हर डिवाइस पर हर ब्राउज़र के लिए अलग से सेट होता है, आपके खाते से अलग।",
    pa: "ਪੁਸ਼ ਨਾਲ ParkProof ਬੰਦ ਹੋਣ 'ਤੇ ਵੀ ਰਿਮਾਈਂਡਰ ਇਸ ਡਿਵਾਈਸ ਤੱਕ ਪਹੁੰਚ ਸਕਦੇ ਹਨ। ਸਿਰਫ਼ ਪੁਸ਼ ਚਾਲੂ ਕਰਨ ਨਾਲ ਕੋਈ ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਨਹੀਂ ਹੁੰਦਾ। ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਕਰਨ ਲਈ ਕਿਸੇ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ 'ਤੇ 'ਮੈਨੂੰ ਯਾਦ ਕਰਵਾਓ' 'ਤੇ ਟੈਪ ਕਰੋ। ਪੁਸ਼ ਹਰ ਡਿਵਾਈਸ 'ਤੇ ਹਰ ਬ੍ਰਾਊਜ਼ਰ ਲਈ ਵੱਖਰਾ ਸੈੱਟ ਹੁੰਦਾ ਹੈ, ਤੁਹਾਡੇ ਖਾਤੇ ਤੋਂ ਵੱਖਰਾ।",
  },
}

// ── helpers ─────────────────────────────────────────────────────────────
function fail(msg) {
  console.error(`ABORT (nothing written): ${msg}`)
  process.exit(1)
}

/** "a.b.c" -> ['a', 'b', 'c'] (no array paths in this script). */
function segments(path) {
  const parts = path.split('.')
  if (parts.some((p) => !p || /[[\]]/.test(p))) fail(`bad key path ${path}`)
  return parts
}

/** Set a key this script owns: appended when new (creating parent objects at the end of theirs), rewritten in place when present. */
function setOwned(root, path, value, locale) {
  const parts = segments(path)
  const leaf = parts.pop()
  let node = root
  for (const p of parts) {
    if (node[p] === undefined) node[p] = {}
    if (!node[p] || typeof node[p] !== 'object' || Array.isArray(node[p])) {
      fail(`${locale}: "${p}" in ${path} is not an object`)
    }
    node = node[p]
  }
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

const EM_DASH = String.fromCharCode(0x2014)

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
    for (const [locale, s] of Object.entries(byLocale)) {
      if (!LOCALES.includes(locale)) problems.push(`${path}: unknown locale ${locale}`)
      if (path.endsWith('_one') && !s.includes('{{count}}')) problems.push(`${locale}: ${path} must use {{count}}`)
      if (s.includes(EM_DASH)) problems.push(`${locale}: em-dash in new copy at ${path}`)
    }
    if (/\bsessions?\b/i.test(byLocale.en)) problems.push(`"session" in en copy at ${path}`)
    if (/\b(reset|compliant|admissible|authentic|guarantee[sd]?)\b/i.test(byLocale.en)) {
      problems.push(`banned wording in en copy at ${path}`)
    }
    if (/(?<!meter )\btickets?\b/i.test(byLocale.en)) problems.push(`ambiguous "ticket" in en copy at ${path}`)
  }
  return problems
}

// ── --list ──────────────────────────────────────────────────────────────
if (process.argv.includes('--list')) {
  for (const k of Object.keys(ADDITIONS).sort()) console.log(`      ${k}`)
  for (const k of Object.keys(OVERWRITES).sort()) console.log(`      ${k} (rewritten)`)
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
    if (typeof byLocale[locale] !== 'string') fail(`no ${locale} text for rewritten key ${path}`)
    // A rewrite never creates a key: it must be there already.
    let node = data[locale]
    for (const p of segments(path)) node = node && typeof node === 'object' ? node[p] : undefined
    if (typeof node !== 'string') fail(`${locale}: ${path} to rewrite is missing`)
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
