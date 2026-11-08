/**
 * T8 i18n (roadmap build spec, task T8: notice-first lookup, "Got a fine?
 * Start here"). Idempotent: running it twice leaves the files
 * byte-identical after the first run. ONE script for the whole task: each
 * unit of T8 extends ADDITIONS (and OVERWRITES, LEGAL) here rather than
 * adding another script.
 *
 * Unit 1 (server and matching) adds, under `errors`, the copy for the two
 * ERR codes /read-notice answers with (src/lib/api.ts ERROR_CODE_KEYS):
 *   - errors.noticeUnreadable (ERR_NOTICE_UNREADABLE): nothing usable could
 *     be read from the photo;
 *   - errors.notANotice (ERR_NOT_A_NOTICE): the photo isn't a parking
 *     infringement notice.
 * The other codes the route can answer with reuse existing copy:
 * ERR_IMAGE_TOO_LARGE, ERR_IMAGE_TYPE, and the generic retry line for
 * anything else.
 *
 * Unit 2 (view and actions) adds the `notice.*` namespace: the home link,
 * capture, the reading stages, the extracted fields, the matches, every
 * comparison line of item 4 (src/lib/notice-compare.ts; the en text is the
 * spec's wording), the durations they use (plurals), the actions of item 5
 * and the disclaimer. It also adds `loading.stepOf` and
 * `loading.usuallyTen`: LoadingProgress printed both in English only, and
 * the notice view reuses it with its own stages (en text unchanged).
 *
 * Fix round 1 adds: the arrival's signing state after the arrival line,
 * development-key departure and arrival lines, "not signed" lines after an
 * unsigned driver or handover, notice-specific copy for a job past its
 * deadline and an oversized photo, and the scan's two long-wait loading
 * stages (English literals until now). It also rewrites, in it and el,
 * strings that narrowed "around then" to "that moment", and the el
 * handover line so the new driver stays inside "your record says".
 *
 * Fix round 2 adds the signature's limit to notice.compare.arrivalSignedBefore
 * (it showed ParkProof's signing time against the notice with no caveat).
 *
 * "fine" and "infringement notice" follow the verified terminology table
 * in docs/legal-pdf-review-worksheet.md and the appeal flow's existing
 * strings in each locale.
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces, plus: every `_one` key this
 * script owns carries {{count}} in every locale).
 *
 * Run:   node scripts/_i18n_inject_t8.mjs
 * List:  node scripts/_i18n_inject_t8.mjs --list
 *        prints every key this task added or rewrote, for the T10
 *        translation review ('legal' marks the statements a lawyer should
 *        read, 'overwrite' an existing string rewritten).
 * Other: node scripts/_i18n_inject_t8.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

/** Keys whose wording makes a claim about signatures, times, drivers or outcomes: for docs/legal-review-queue.md (T10). */
const LEGAL = new Set([
  'notice.disclaimer',
  'notice.match.repeatedHour',
  'notice.match.skippedHour',
  'notice.compare.departureSignedBefore',
  'notice.compare.departureSignedBeforeClock',
  'notice.compare.departureSignedAfter',
  'notice.compare.departurePending',
  'notice.compare.departureNotSigned',
  'notice.compare.noDeparture',
  'notice.compare.arrivalBefore',
  'notice.compare.arrivalAfter',
  'notice.compare.arrivalSame',
  'notice.compare.driver',
  'notice.compare.handover',
  'notice.compare.checkRegistration',
  'notice.compare.checkDueDate',
  'notice.compare.departureDevKey',
  'notice.compare.arrivalSignedBefore',
  'notice.compare.arrivalSignedAfter',
  'notice.compare.arrivalDevKey',
  'notice.compare.arrivalPending',
  'notice.compare.arrivalNotSigned',
  'notice.compare.driverPending',
  'notice.compare.driverNotSigned',
  'notice.compare.handoverPending',
])

// ── New keys, appended inside their parent object ────────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position). Missing parent objects are created,
// appended at the end of their own parent.
const ADDITIONS = {
  // ── /read-notice errors (unit 1: server and matching) ──
  // ERR_NOTICE_UNREADABLE: the model gave nothing usable (cut off, refused,
  // unparseable), or the notice was unreadable and no field could be read.
  'errors.noticeUnreadable': {
    en: "We couldn't read that notice. Try a clearer photo of the whole notice, flat and in good light.",
    'zh-CN': '我们无法读取这张违章通知。请把整张通知放平,在光线好的地方拍一张更清晰的照片。',
    vi: 'Chúng tôi không đọc được thông báo đó. Hãy chụp lại rõ hơn cả tờ thông báo, đặt phẳng và đủ sáng.',
    id: 'Kami tidak bisa membaca surat denda itu. Coba foto seluruh surat dengan lebih jelas, diletakkan rata dan di tempat yang terang.',
    ko: '그 통지서를 읽지 못했습니다. 통지서 전체가 나오도록 평평하게 놓고 밝은 곳에서 더 선명하게 찍어 주세요.',
    it: 'Non siamo riusciti a leggere quel verbale. Prova con una foto più chiara del verbale intero, ben disteso e con buona luce.',
    el: 'Δεν μπορέσαμε να διαβάσουμε αυτή την κλήση. Δοκίμασε μια πιο καθαρή φωτογραφία ολόκληρης της κλήσης, σε επίπεδη επιφάνεια και με καλό φως.',
    hi: 'हम वह नोटिस नहीं पढ़ सके। पूरे नोटिस को समतल रखकर, अच्छी रोशनी में ज़्यादा साफ़ फोटो लें।',
    pa: 'ਅਸੀਂ ਉਹ ਨੋਟਿਸ ਨਹੀਂ ਪੜ੍ਹ ਸਕੇ। ਪੂਰੇ ਨੋਟਿਸ ਨੂੰ ਪੱਧਰਾ ਰੱਖ ਕੇ, ਚੰਗੀ ਰੋਸ਼ਨੀ ਵਿੱਚ ਹੋਰ ਸਾਫ਼ ਫੋਟੋ ਲਓ।',
  },
  // ERR_NOT_A_NOTICE: the photo isn't a parking infringement notice (a
  // receipt, a pay-and-display meter ticket, something else).
  'errors.notANotice': {
    en: "That photo doesn't look like a parking fine notice. Take a photo of the infringement notice itself.",
    'zh-CN': '这张照片看起来不像停车罚款通知。请直接拍违章通知本身。',
    vi: 'Ảnh đó có vẻ không phải là thông báo phạt đỗ xe. Hãy chụp chính tờ thông báo vi phạm.',
    id: 'Foto itu sepertinya bukan surat denda parkir. Foto langsung surat dendanya.',
    ko: '그 사진은 주차 벌금 통지서로 보이지 않습니다. 위반 통지서 자체를 찍어 주세요.',
    it: 'Quella foto non sembra un verbale di multa per sosta. Fotografa il verbale stesso.',
    el: 'Αυτή η φωτογραφία δεν μοιάζει με κλήση στάθμευσης. Φωτογράφισε την ίδια την κλήση.',
    hi: 'वह फोटो पार्किंग जुर्माने का नोटिस नहीं लगती। सीधे उल्लंघन नोटिस की फोटो लें।',
    pa: 'ਉਹ ਫੋਟੋ ਪਾਰਕਿੰਗ ਜੁਰਮਾਨੇ ਦਾ ਨੋਟਿਸ ਨਹੀਂ ਲੱਗਦੀ। ਸਿੱਧੇ ਉਲੰਘਣਾ ਨੋਟਿਸ ਦੀ ਫੋਟੋ ਲਓ।',
  },
  // The notice's own copy for failures the shared poller would otherwise
  // describe as a sign scan (src/lib/claude.ts NOTICE_ERROR_COPY): a job
  // past its deadline, and ERR_IMAGE_TOO_LARGE. A second 5xx uses the
  // existing errors.genericRetry.
  'errors.noticeHeavyLoad': {
    en: `ParkProof is busy right now and couldn't finish reading the notice in time. Wait a minute and try again.`,
    'zh-CN': `ParkProof 目前繁忙,未能及时读完这张通知。请稍等一分钟后再试。`,
    vi: `ParkProof đang quá tải nên chưa kịp đọc xong thông báo. Hãy đợi một phút rồi thử lại.`,
    id: `ParkProof sedang sibuk saat ini dan tidak sempat selesai membaca surat denda. Tunggu sebentar lalu coba lagi.`,
    ko: `지금 ParkProof에 요청이 많아 통지서를 제때 다 읽지 못했습니다. 1분 후 다시 시도해 주세요.`,
    it: `ParkProof è molto richiesto in questo momento e non è riuscito a finire di leggere il verbale in tempo. Aspetta un minuto e riprova.`,
    el: `Το ParkProof έχει αυξημένη κίνηση αυτή τη στιγμή και δεν πρόλαβε να διαβάσει την κλήση. Περίμενε ένα λεπτό και δοκίμασε ξανά.`,
    hi: `ParkProof अभी व्यस्त है और समय रहते नोटिस पढ़ना पूरा नहीं कर पाया। एक मिनट रुककर दोबारा कोशिश करें।`,
    pa: `ParkProof ਇਸ ਵੇਲੇ ਰੁੱਝਿਆ ਹੋਇਆ ਹੈ ਅਤੇ ਸਮੇਂ ਸਿਰ ਨੋਟਿਸ ਪੜ੍ਹਨਾ ਪੂਰਾ ਨਹੀਂ ਕਰ ਸਕਿਆ। ਇੱਕ ਮਿੰਟ ਉਡੀਕੋ ਅਤੇ ਮੁੜ ਕੋਸ਼ਿਸ਼ ਕਰੋ।`,
  },
  'errors.noticeImageTooLarge': {
    en: `That photo is too large. Try another photo of the notice.`,
    'zh-CN': `这张照片太大了。请换一张通知的照片。`,
    vi: `Ảnh đó quá lớn. Hãy thử một ảnh khác của thông báo.`,
    id: `Foto itu terlalu besar. Coba foto lain dari surat dendanya.`,
    ko: `사진이 너무 큽니다. 통지서를 다른 사진으로 찍어 보세요.`,
    it: `Quella foto è troppo grande. Prova con un'altra foto del verbale.`,
    el: `Αυτή η φωτογραφία είναι πολύ μεγάλη. Δοκίμασε άλλη φωτογραφία της κλήσης.`,
    hi: `वह फोटो बहुत बड़ी है। नोटिस की कोई दूसरी फोटो आज़माएँ।`,
    pa: `ਉਹ ਫੋਟੋ ਬਹੁਤ ਵੱਡੀ ਹੈ। ਨੋਟਿਸ ਦੀ ਕੋਈ ਹੋਰ ਫੋਟੋ ਵਰਤ ਕੇ ਦੇਖੋ।`,
  },

  // ── LoadingProgress (unit 2: the view) ──
  // The step counter and the default hint were English literals in the
  // component; the notice view reuses the component with its own stages, so
  // both now translate. The en text is unchanged.
  'loading.stepOf': {
    en: `Step {{current}} of {{total}}`,
    'zh-CN': `第 {{current}} 步,共 {{total}} 步`,
    vi: `Bước {{current}}/{{total}}`,
    id: `Langkah {{current}} dari {{total}}`,
    ko: `{{total}}단계 중 {{current}}단계`,
    it: `Passo {{current}} di {{total}}`,
    el: `Βήμα {{current}} από {{total}}`,
    hi: `{{total}} में से चरण {{current}}`,
    pa: `{{total}} ਵਿੱਚੋਂ ਕਦਮ {{current}}`,
  },
  'loading.usuallyTen': {
    en: `Usually takes about 10 seconds.`,
    'zh-CN': `通常约需 10 秒。`,
    vi: `Thường mất khoảng 10 giây.`,
    id: `Biasanya sekitar 10 detik.`,
    ko: `보통 10초 정도 걸립니다.`,
    it: `Di solito ci vogliono circa 10 secondi.`,
    el: `Συνήθως παίρνει περίπου 10 δευτερόλεπτα.`,
    hi: `आमतौर पर लगभग 10 सेकंड लगते हैं।`,
    pa: `ਆਮ ਤੌਰ 'ਤੇ ਲਗਭਗ 10 ਸਕਿੰਟ ਲੱਗਦੇ ਹਨ।`,
  },
  // The sign scan's two long-wait stages were English literals in the
  // component (en text unchanged).
  'loading.almostThere': {
    en: `Almost there. This sign is complex…`,
    'zh-CN': `快好了。这个标志比较复杂…`,
    vi: `Sắp xong. Biển báo này khá phức tạp…`,
    id: `Hampir selesai. Rambu ini cukup rumit…`,
    ko: `거의 다 됐습니다. 복잡한 표지판입니다…`,
    it: `Ci siamo quasi. Questo cartello è complesso…`,
    el: `Σχεδόν έτοιμο. Αυτή η πινακίδα είναι σύνθετη…`,
    hi: `बस थोड़ा और। यह साइन जटिल है…`,
    pa: `ਬੱਸ ਥੋੜ੍ਹਾ ਹੋਰ। ਇਹ ਚਿੰਨ੍ਹ ਗੁੰਝਲਦਾਰ ਹੈ…`,
  },
  'loading.stillWorking': {
    en: `Still working. This is taking longer than usual…`,
    'zh-CN': `仍在处理,这次比平时久一些…`,
    vi: `Vẫn đang xử lý. Lần này lâu hơn thường lệ…`,
    id: `Masih diproses. Ini lebih lama dari biasanya…`,
    ko: `아직 처리 중입니다. 평소보다 오래 걸리고 있습니다…`,
    it: `Ancora al lavoro. Ci vuole più del solito…`,
    el: `Ακόμα σε εξέλιξη. Παίρνει περισσότερο από το συνηθισμένο…`,
    hi: `अभी भी काम चल रहा है। इसमें सामान्य से ज़्यादा समय लग रहा है…`,
    pa: `ਅਜੇ ਵੀ ਕੰਮ ਚੱਲ ਰਿਹਾ ਹੈ। ਇਸ ਵਿੱਚ ਆਮ ਨਾਲੋਂ ਵੱਧ ਸਮਾਂ ਲੱਗ ਰਿਹਾ ਹੈ…`,
  },

  // ── The notice view (unit 2: view and actions) ──
  // The home entry point (T4's layout moves it into its own row).
  'notice.homeLink': {
    en: `Got a fine? Start here`,
    'zh-CN': `收到罚款?从这里开始`,
    vi: `Bị phạt? Bắt đầu từ đây`,
    id: `Kena denda? Mulai di sini`,
    ko: `벌금을 받았나요? 여기서 시작하세요`,
    it: `Hai preso una multa? Inizia da qui`,
    el: `Πήρες κλήση; Ξεκίνα εδώ`,
    hi: `जुर्माना मिला? यहाँ से शुरू करें`,
    pa: `ਜੁਰਮਾਨਾ ਮਿਲਿਆ? ਇੱਥੋਂ ਸ਼ੁਰੂ ਕਰੋ`,
  },
  'notice.title': {
    en: `Got a fine?`,
    'zh-CN': `收到罚款?`,
    vi: `Bị phạt?`,
    id: `Kena denda?`,
    ko: `벌금을 받았나요?`,
    it: `Hai preso una multa?`,
    el: `Πήρες κλήση;`,
    hi: `जुर्माना मिला?`,
    pa: `ਜੁਰਮਾਨਾ ਮਿਲਿਆ?`,
  },
  'notice.captureIntro': {
    en: `Take a photo of the infringement notice. ParkProof reads the date, time and place on it and looks for your parking records from around then.`,
    'zh-CN': `拍一张违章通知的照片。ParkProof 会读取上面的日期、时间和地点,并查找你在那段时间前后的停车记录。`,
    vi: `Chụp ảnh thông báo vi phạm. ParkProof đọc ngày, giờ và địa điểm trên đó, rồi tìm các bản ghi đỗ xe của bạn quanh thời điểm đó.`,
    id: `Foto surat denda pelanggaran. ParkProof membaca tanggal, waktu, dan tempat di surat itu, lalu mencari catatan parkirmu di sekitar waktu tersebut.`,
    ko: `위반 통지서 사진을 찍으세요. ParkProof가 통지서의 날짜, 시간, 장소를 읽고 그 무렵의 주차 기록을 찾습니다.`,
    it: `Scatta una foto del verbale. ParkProof legge data, ora e luogo e cerca i tuoi record di parcheggio intorno a quell'ora.`,
    el: `Βγάλε φωτογραφία την κλήση. Το ParkProof διαβάζει την ημερομηνία, την ώρα και το σημείο και αναζητά τις εγγραφές στάθμευσής σου γύρω από εκείνη την ώρα.`,
    hi: `उल्लंघन नोटिस की फोटो लें। ParkProof उस पर लिखी तारीख, समय और जगह पढ़ता है और उस समय के आसपास के आपके पार्किंग रिकॉर्ड खोजता है।`,
    pa: `ਉਲੰਘਣਾ ਨੋਟਿਸ ਦੀ ਫੋਟੋ ਲਓ। ParkProof ਉਸ 'ਤੇ ਲਿਖੀ ਤਾਰੀਖ, ਸਮਾਂ ਅਤੇ ਥਾਂ ਪੜ੍ਹਦਾ ਹੈ ਅਤੇ ਉਸ ਸਮੇਂ ਦੇ ਆਸ-ਪਾਸ ਦੇ ਤੁਹਾਡੇ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ ਲੱਭਦਾ ਹੈ।`,
  },
  // Reading: LoadingProgress stages (the last one only shows when reading runs long).
  'notice.reading.step1': {
    en: `Reading the notice…`,
    'zh-CN': `正在读取通知…`,
    vi: `Đang đọc thông báo…`,
    id: `Membaca surat denda…`,
    ko: `통지서 읽는 중…`,
    it: `Lettura del verbale…`,
    el: `Ανάγνωση της κλήσης…`,
    hi: `नोटिस पढ़ा जा रहा है…`,
    pa: `ਨੋਟਿਸ ਪੜ੍ਹਿਆ ਜਾ ਰਿਹਾ ਹੈ…`,
  },
  'notice.reading.step2': {
    en: `Finding the date, time and place…`,
    'zh-CN': `正在查找日期、时间和地点…`,
    vi: `Đang tìm ngày, giờ và địa điểm…`,
    id: `Mencari tanggal, waktu, dan tempat…`,
    ko: `날짜, 시간, 장소 찾는 중…`,
    it: `Ricerca di data, ora e luogo…`,
    el: `Εύρεση ημερομηνίας, ώρας και σημείου…`,
    hi: `तारीख, समय और जगह खोजी जा रही है…`,
    pa: `ਤਾਰੀਖ, ਸਮਾਂ ਅਤੇ ਥਾਂ ਲੱਭੀ ਜਾ ਰਹੀ ਹੈ…`,
  },
  'notice.reading.step3': {
    en: `Looking for your records…`,
    'zh-CN': `正在查找你的记录…`,
    vi: `Đang tìm các bản ghi của bạn…`,
    id: `Mencari catatanmu…`,
    ko: `기록 찾는 중…`,
    it: `Ricerca dei tuoi record…`,
    el: `Αναζήτηση των εγγραφών σου…`,
    hi: `आपके रिकॉर्ड खोजे जा रहे हैं…`,
    pa: `ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਲੱਭੇ ਜਾ ਰਹੇ ਹਨ…`,
  },
  'notice.reading.slow': {
    en: `Still reading. This can take a little longer…`,
    'zh-CN': `仍在读取,可能还需要一点时间…`,
    vi: `Vẫn đang đọc. Có thể mất thêm một chút thời gian…`,
    id: `Masih membaca. Ini bisa sedikit lebih lama…`,
    ko: `아직 읽는 중입니다. 조금 더 걸릴 수 있습니다…`,
    it: `Ancora in lettura. Potrebbe volerci un po' di più…`,
    el: `Ακόμα διαβάζει. Μπορεί να πάρει λίγο περισσότερο…`,
    hi: `अभी भी पढ़ा जा रहा है। इसमें थोड़ा और समय लग सकता है…`,
    pa: `ਅਜੇ ਵੀ ਪੜ੍ਹਿਆ ਜਾ ਰਿਹਾ ਹੈ। ਇਸ ਵਿੱਚ ਥੋੜ੍ਹਾ ਹੋਰ ਸਮਾਂ ਲੱਗ ਸਕਦਾ ਹੈ…`,
  },
  'notice.reading.hint': {
    en: `Usually takes a few seconds.`,
    'zh-CN': `通常只需几秒钟。`,
    vi: `Thường chỉ mất vài giây.`,
    id: `Biasanya hanya beberapa detik.`,
    ko: `보통 몇 초면 됩니다.`,
    it: `Di solito bastano pochi secondi.`,
    el: `Συνήθως παίρνει λίγα δευτερόλεπτα.`,
    hi: `आमतौर पर कुछ ही सेकंड लगते हैं।`,
    pa: `ਆਮ ਤੌਰ 'ਤੇ ਕੁਝ ਹੀ ਸਕਿੰਟ ਲੱਗਦੇ ਹਨ।`,
  },
  'notice.errorHeader': {
    en: `Couldn't read the notice`,
    'zh-CN': `无法读取通知`,
    vi: `Không đọc được thông báo`,
    id: `Tidak bisa membaca surat denda`,
    ko: `통지서를 읽지 못했습니다`,
    it: `Impossibile leggere il verbale`,
    el: `Δεν ήταν δυνατή η ανάγνωση της κλήσης`,
    hi: `नोटिस नहीं पढ़ा जा सका`,
    pa: `ਨੋਟਿਸ ਪੜ੍ਹਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ`,
  },
  // The extracted fields. Null fields aren't shown; the date and time always are (editable).
  'notice.fields.heading': {
    en: `What the notice says`,
    'zh-CN': `通知上的内容`,
    vi: `Nội dung trên thông báo`,
    id: `Isi surat denda`,
    ko: `통지서 내용`,
    it: `Cosa dice il verbale`,
    el: `Τι γράφει η κλήση`,
    hi: `नोटिस में क्या लिखा है`,
    pa: `ਨੋਟਿਸ ਵਿੱਚ ਕੀ ਲਿਖਿਆ ਹੈ`,
  },
  'notice.fields.intro': {
    en: `Read by AI from your photo. Check each detail against the notice.`,
    'zh-CN': `由 AI 从你的照片中读取。请逐项与通知核对。`,
    vi: `AI đọc từ ảnh của bạn. Hãy đối chiếu từng chi tiết với thông báo.`,
    id: `Dibaca oleh AI dari fotomu. Cocokkan setiap detail dengan surat dendanya.`,
    ko: `AI가 사진에서 읽은 내용입니다. 각 항목을 통지서와 대조해 보세요.`,
    it: `Letto dall'AI dalla tua foto. Controlla ogni dato sul verbale.`,
    el: `Τα διάβασε η τεχνητή νοημοσύνη από τη φωτογραφία σου. Έλεγξε κάθε στοιχείο με την κλήση.`,
    hi: `AI ने आपकी फोटो से पढ़ा है। हर जानकारी को नोटिस से मिलाकर देखें।`,
    pa: `AI ਨੇ ਤੁਹਾਡੀ ਫੋਟੋ ਤੋਂ ਪੜ੍ਹਿਆ ਹੈ। ਹਰ ਜਾਣਕਾਰੀ ਨੂੰ ਨੋਟਿਸ ਨਾਲ ਮਿਲਾ ਕੇ ਦੇਖੋ।`,
  },
  'notice.fields.noticeNumber': {
    en: `Notice number`,
    'zh-CN': `通知编号`,
    vi: `Số thông báo`,
    id: `Nomor surat`,
    ko: `통지서 번호`,
    it: `Numero del verbale`,
    el: `Αριθμός κλήσης`,
    hi: `नोटिस नंबर`,
    pa: `ਨੋਟਿਸ ਨੰਬਰ`,
  },
  'notice.fields.issuedBy': {
    en: `Issued by`,
    'zh-CN': `签发机构`,
    vi: `Cơ quan phát hành`,
    id: `Diterbitkan oleh`,
    ko: `발급 기관`,
    it: `Emesso da`,
    el: `Εκδόθηκε από`,
    hi: `जारीकर्ता`,
    pa: `ਜਾਰੀ ਕਰਨ ਵਾਲਾ`,
  },
  'notice.fields.date': {
    en: `Date on the notice`,
    'zh-CN': `通知上的日期`,
    vi: `Ngày trên thông báo`,
    id: `Tanggal di surat`,
    ko: `통지서의 날짜`,
    it: `Data sul verbale`,
    el: `Ημερομηνία στην κλήση`,
    hi: `नोटिस पर तारीख`,
    pa: `ਨੋਟਿਸ 'ਤੇ ਤਾਰੀਖ`,
  },
  'notice.fields.time': {
    en: `Time on the notice`,
    'zh-CN': `通知上的时间`,
    vi: `Giờ trên thông báo`,
    id: `Waktu di surat`,
    ko: `통지서의 시간`,
    it: `Ora sul verbale`,
    el: `Ώρα στην κλήση`,
    hi: `नोटिस पर समय`,
    pa: `ਨੋਟਿਸ 'ਤੇ ਸਮਾਂ`,
  },
  'notice.fields.location': {
    en: `Place`,
    'zh-CN': `地点`,
    vi: `Địa điểm`,
    id: `Tempat`,
    ko: `장소`,
    it: `Luogo`,
    el: `Σημείο`,
    hi: `जगह`,
    pa: `ਥਾਂ`,
  },
  'notice.fields.offence': {
    en: `Offence`,
    'zh-CN': `违规行为`,
    vi: `Vi phạm`,
    id: `Pelanggaran`,
    ko: `위반 내용`,
    it: `Infrazione`,
    el: `Παράβαση`,
    hi: `उल्लंघन`,
    pa: `ਉਲੰਘਣਾ`,
  },
  'notice.fields.partlyReadable': {
    en: `Some of the notice was hard to read. Check these details against the notice itself.`,
    'zh-CN': `通知的部分内容难以辨认。请对照通知本身核对这些信息。`,
    vi: `Một phần thông báo khó đọc. Hãy đối chiếu các chi tiết này với chính thông báo.`,
    id: `Sebagian surat denda sulit dibaca. Cocokkan detail ini dengan surat dendanya langsung.`,
    ko: `통지서 일부를 읽기 어려웠습니다. 이 내용을 통지서 원본과 대조해 보세요.`,
    it: `Una parte del verbale era difficile da leggere. Controlla questi dati sul verbale stesso.`,
    el: `Ένα μέρος της κλήσης διαβαζόταν δύσκολα. Έλεγξε αυτά τα στοιχεία με την ίδια την κλήση.`,
    hi: `नोटिस का कुछ हिस्सा पढ़ना मुश्किल था। इन जानकारियों को सीधे नोटिस से मिलाकर देखें।`,
    pa: `ਨੋਟਿਸ ਦਾ ਕੁਝ ਹਿੱਸਾ ਪੜ੍ਹਨਾ ਔਖਾ ਸੀ। ਇਹ ਜਾਣਕਾਰੀ ਸਿੱਧੇ ਨੋਟਿਸ ਨਾਲ ਮਿਲਾ ਕੇ ਦੇਖੋ।`,
  },
  // The model's date or time disagrees with the day-first reading of the printed one (notice-match.ts).
  'notice.fields.checkDateTime': {
    en: `Check the date and time against the notice. They may have been misread.`,
    'zh-CN': `请对照通知核对日期和时间,它们可能被读错了。`,
    vi: `Hãy đối chiếu ngày và giờ với thông báo. Có thể chúng đã bị đọc sai.`,
    id: `Cocokkan tanggal dan waktu dengan surat denda. Mungkin salah terbaca.`,
    ko: `날짜와 시간을 통지서와 대조해 보세요. 잘못 읽었을 수 있습니다.`,
    it: `Controlla data e ora sul verbale. Potrebbero essere state lette male.`,
    el: `Έλεγξε την ημερομηνία και την ώρα με την κλήση. Μπορεί να διαβάστηκαν λάθος.`,
    hi: `तारीख और समय को नोटिस से मिलाकर देखें। हो सकता है वे गलत पढ़े गए हों।`,
    pa: `ਤਾਰੀਖ ਅਤੇ ਸਮਾਂ ਨੋਟਿਸ ਨਾਲ ਮਿਲਾ ਕੇ ਦੇਖੋ। ਹੋ ਸਕਦਾ ਹੈ ਇਹ ਗਲਤ ਪੜ੍ਹੇ ਗਏ ਹੋਣ।`,
  },
  'notice.fields.enterDateTime': {
    en: `We couldn't read the date and time. Enter them from the notice to find your records.`,
    'zh-CN': `我们无法读取日期和时间。请按通知上的内容填写,以查找你的记录。`,
    vi: `Chúng tôi không đọc được ngày và giờ. Hãy nhập theo thông báo để tìm các bản ghi của bạn.`,
    id: `Kami tidak bisa membaca tanggal dan waktunya. Masukkan sesuai surat denda untuk mencari catatanmu.`,
    ko: `날짜와 시간을 읽지 못했습니다. 기록을 찾으려면 통지서에 적힌 대로 입력하세요.`,
    it: `Non siamo riusciti a leggere data e ora. Inseriscile dal verbale per trovare i tuoi record.`,
    el: `Δεν μπορέσαμε να διαβάσουμε την ημερομηνία και την ώρα. Συμπλήρωσέ τες από την κλήση για να βρεις τις εγγραφές σου.`,
    hi: `हम तारीख और समय नहीं पढ़ सके। अपने रिकॉर्ड खोजने के लिए उन्हें नोटिस से देखकर भरें।`,
    pa: `ਅਸੀਂ ਤਾਰੀਖ ਅਤੇ ਸਮਾਂ ਨਹੀਂ ਪੜ੍ਹ ਸਕੇ। ਆਪਣੇ ਰਿਕਾਰਡ ਲੱਭਣ ਲਈ ਇਹਨਾਂ ਨੂੰ ਨੋਟਿਸ ਤੋਂ ਦੇਖ ਕੇ ਭਰੋ।`,
  },
  // The matches.
  'notice.matches.heading': {
    en: `Your records from around this time`,
    'zh-CN': `你在这段时间前后的记录`,
    vi: `Các bản ghi của bạn quanh thời điểm này`,
    id: `Catatanmu di sekitar waktu ini`,
    ko: `이 시간 무렵의 기록`,
    it: `I tuoi record intorno a quest'ora`,
    el: `Οι εγγραφές σου γύρω από αυτή την ώρα`,
    hi: `इस समय के आसपास के आपके रिकॉर्ड`,
    pa: `ਇਸ ਸਮੇਂ ਦੇ ਆਸ-ਪਾਸ ਦੇ ਤੁਹਾਡੇ ਰਿਕਾਰਡ`,
  },
  'notice.matches.none': {
    en: `None of your saved parking records are from around this date and time. If the date or time above was misread, correct it.`,
    'zh-CN': `你保存的停车记录中,没有在这个日期和时间前后的记录。如果上面的日期或时间读错了,请改正。`,
    vi: `Không có bản ghi đỗ xe nào đã lưu của bạn ở quanh ngày và giờ này. Nếu ngày hoặc giờ ở trên bị đọc sai, hãy sửa lại.`,
    id: `Tidak ada catatan parkir tersimpan milikmu di sekitar tanggal dan waktu ini. Jika tanggal atau waktu di atas salah terbaca, perbaiki.`,
    ko: `저장된 주차 기록 중 이 날짜와 시간 무렵의 기록이 없습니다. 위의 날짜나 시간이 잘못 읽혔다면 고쳐 주세요.`,
    it: `Nessuno dei tuoi record di parcheggio salvati risale a circa questa data e ora. Se la data o l'ora qui sopra sono state lette male, correggile.`,
    el: `Καμία από τις αποθηκευμένες εγγραφές στάθμευσής σου δεν είναι γύρω από αυτή την ημερομηνία και ώρα. Αν η ημερομηνία ή η ώρα παραπάνω διαβάστηκε λάθος, διόρθωσέ τη.`,
    hi: `आपके सहेजे गए पार्किंग रिकॉर्ड में से कोई भी इस तारीख और समय के आसपास का नहीं है। अगर ऊपर की तारीख या समय गलत पढ़ा गया है, तो उसे ठीक करें।`,
    pa: `ਤੁਹਾਡੇ ਸੰਭਾਲੇ ਹੋਏ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡਾਂ ਵਿੱਚੋਂ ਕੋਈ ਵੀ ਇਸ ਤਾਰੀਖ ਅਤੇ ਸਮੇਂ ਦੇ ਆਸ-ਪਾਸ ਦਾ ਨਹੀਂ ਹੈ। ਜੇ ਉੱਪਰ ਦੀ ਤਾਰੀਖ ਜਾਂ ਸਮਾਂ ਗਲਤ ਪੜ੍ਹਿਆ ਗਿਆ ਹੈ, ਤਾਂ ਇਸ ਨੂੰ ਠੀਕ ਕਰੋ।`,
  },
  'notice.match.compare': {
    en: `Compare with this record`,
    'zh-CN': `与这条记录对比`,
    vi: `So sánh với bản ghi này`,
    id: `Bandingkan dengan catatan ini`,
    ko: `이 기록과 비교`,
    it: `Confronta con questo record`,
    el: `Σύγκριση με αυτή την εγγραφή`,
    hi: `इस रिकॉर्ड से तुलना करें`,
    pa: `ਇਸ ਰਿਕਾਰਡ ਨਾਲ ਤੁਲਨਾ ਕਰੋ`,
  },
  'notice.match.far': {
    en: `This record is about {{distance}} km from the place on the notice.`,
    'zh-CN': `这条记录距离通知上的地点约 {{distance}} 公里。`,
    vi: `Bản ghi này cách địa điểm trên thông báo khoảng {{distance}} km.`,
    id: `Catatan ini berjarak sekitar {{distance}} km dari tempat di surat denda.`,
    ko: `이 기록은 통지서에 적힌 장소에서 약 {{distance}}km 떨어져 있습니다.`,
    it: `Questo record è a circa {{distance}} km dal luogo indicato sul verbale.`,
    el: `Αυτή η εγγραφή είναι περίπου {{distance}} χλμ. από το σημείο της κλήσης.`,
    hi: `यह रिकॉर्ड नोटिस पर लिखी जगह से लगभग {{distance}} किमी दूर है।`,
    pa: `ਇਹ ਰਿਕਾਰਡ ਨੋਟਿਸ 'ਤੇ ਲਿਖੀ ਥਾਂ ਤੋਂ ਲਗਭਗ {{distance}} ਕਿਲੋਮੀਟਰ ਦੂਰ ਹੈ।`,
  },
  // A notice time in the hour repeated or skipped by a daylight saving change (notice-match.ts time_status).
  'notice.match.repeatedHour': {
    en: `Daylight saving ended on this date, so the time on the notice happened twice. This compares the record with {{time}}.`,
    'zh-CN': `这一天夏令时结束,所以通知上的时间出现了两次。这里用 {{time}} 与记录对比。`,
    vi: `Ngày này kết thúc giờ mùa hè, nên giờ trên thông báo xuất hiện hai lần. Bản ghi được so sánh với {{time}}.`,
    id: `Waktu musim panas berakhir pada tanggal ini, jadi waktu di surat denda terjadi dua kali. Catatan ini dibandingkan dengan {{time}}.`,
    ko: `이날 일광 절약 시간이 끝나서 통지서의 시간이 두 번 있었습니다. 기록을 {{time}}과(와) 비교합니다.`,
    it: `In questa data è finita l'ora legale, quindi l'ora sul verbale si è ripetuta due volte. Il record viene confrontato con: {{time}}.`,
    el: `Αυτή την ημερομηνία έληξε η θερινή ώρα, οπότε η ώρα της κλήσης υπήρξε δύο φορές. Η εγγραφή συγκρίνεται με: {{time}}.`,
    hi: `इस तारीख को डेलाइट सेविंग समाप्त हुई, इसलिए नोटिस का समय दो बार आया। रिकॉर्ड की तुलना {{time}} से की गई है।`,
    pa: `ਇਸ ਤਾਰੀਖ ਨੂੰ ਡੇਲਾਈਟ ਸੇਵਿੰਗ ਖਤਮ ਹੋਈ, ਇਸ ਲਈ ਨੋਟਿਸ ਵਾਲਾ ਸਮਾਂ ਦੋ ਵਾਰ ਆਇਆ। ਰਿਕਾਰਡ ਦੀ ਤੁਲਨਾ {{time}} ਨਾਲ ਕੀਤੀ ਗਈ ਹੈ।`,
  },
  'notice.match.skippedHour': {
    en: `Daylight saving started on this date, so the time on the notice didn't exist on the clock. This compares the record with {{time}}.`,
    'zh-CN': `这一天夏令时开始,所以通知上的时间在时钟上并不存在。这里用 {{time}} 与记录对比。`,
    vi: `Ngày này bắt đầu giờ mùa hè, nên giờ trên thông báo không có trên đồng hồ. Bản ghi được so sánh với {{time}}.`,
    id: `Waktu musim panas dimulai pada tanggal ini, jadi waktu di surat denda tidak ada di jam. Catatan ini dibandingkan dengan {{time}}.`,
    ko: `이날 일광 절약 시간이 시작되어 통지서의 시간은 시계에 없었습니다. 기록을 {{time}}과(와) 비교합니다.`,
    it: `In questa data è iniziata l'ora legale, quindi l'ora sul verbale non è esistita sull'orologio. Il record viene confrontato con: {{time}}.`,
    el: `Αυτή την ημερομηνία άρχισε η θερινή ώρα, οπότε η ώρα της κλήσης δεν υπήρξε στο ρολόι. Η εγγραφή συγκρίνεται με: {{time}}.`,
    hi: `इस तारीख को डेलाइट सेविंग शुरू हुई, इसलिए नोटिस का समय घड़ी में था ही नहीं। रिकॉर्ड की तुलना {{time}} से की गई है।`,
    pa: `ਇਸ ਤਾਰੀਖ ਨੂੰ ਡੇਲਾਈਟ ਸੇਵਿੰਗ ਸ਼ੁਰੂ ਹੋਈ, ਇਸ ਲਈ ਨੋਟਿਸ ਵਾਲਾ ਸਮਾਂ ਘੜੀ ਵਿੱਚ ਸੀ ਹੀ ਨਹੀਂ। ਰਿਕਾਰਡ ਦੀ ਤੁਲਨਾ {{time}} ਨਾਲ ਕੀਤੀ ਗਈ ਹੈ।`,
  },
  // The comparison lines (src/lib/notice-compare.ts). The en text is the
  // spec's wording (T8 item 4); the extra cases (a phone clock ahead of the
  // signing time, a departure never signed, no I've left tap, an arrival
  // after or in the same minute as the notice) follow the same rules.
  'notice.compare.heading': {
    en: `Compared with the notice`,
    'zh-CN': `与通知对比`,
    vi: `So với thông báo`,
    id: `Dibandingkan dengan surat denda`,
    ko: `통지서와 비교`,
    it: `Confronto con il verbale`,
    el: `Σε σύγκριση με την κλήση`,
    hi: `नोटिस से तुलना`,
    pa: `ਨੋਟਿਸ ਨਾਲ ਤੁਲਨਾ`,
  },
  'notice.compare.departureSignedBefore': {
    en: `You tapped I've left at {{time}}, {{duration}} before the time on the notice. ParkProof signed that record at {{signedTime}}. The record shows when you tapped, not when the car moved.`,
    'zh-CN': `你在 {{time}} 点击了"我已离开",比通知上的时间早 {{duration}}。ParkProof 在 {{signedTime}} 为这条记录签名。记录显示的是你点击的时间,不是车辆开走的时间。`,
    vi: `Bạn đã nhấn "Tôi đã đi" lúc {{time}}, {{duration}} trước giờ trên thông báo. ParkProof đã ký bản ghi đó lúc {{signedTime}}. Bản ghi cho thấy lúc bạn nhấn, không phải lúc xe di chuyển.`,
    id: `Kamu mengetuk "Sudah pergi" pada {{time}}, {{duration}} sebelum waktu di surat denda. ParkProof menandatangani catatan itu pada {{signedTime}}. Catatan ini menunjukkan kapan kamu mengetuk, bukan kapan mobil bergerak.`,
    ko: `{{time}}에 "떠났습니다"를 눌렀습니다. 통지서의 시간보다 {{duration}} 전입니다. ParkProof는 {{signedTime}}에 그 기록에 서명했습니다. 이 기록은 누른 시각을 보여 줄 뿐, 차가 움직인 시각은 보여 주지 않습니다.`,
    it: `Hai toccato "Ho lasciato il posto": {{time}}, {{duration}} prima dell'ora sul verbale. Firma di ParkProof su quel record: {{signedTime}}. Il record mostra quando hai toccato, non quando l'auto si è spostata.`,
    el: `Πάτησες «Έφυγα» στις {{time}}, {{duration}} πριν από την ώρα της κλήσης. Το ParkProof υπέγραψε αυτή την εγγραφή στις {{signedTime}}. Η εγγραφή δείχνει πότε πάτησες, όχι πότε κινήθηκε το αυτοκίνητο.`,
    hi: `आपने {{time}} पर "मैंने जगह खाली कर दी" पर टैप किया, जो नोटिस के समय से {{duration}} पहले है। ParkProof ने उस रिकॉर्ड पर {{signedTime}} पर हस्ताक्षर किए। रिकॉर्ड दिखाता है कि आपने कब टैप किया, यह नहीं कि कार कब वहाँ से हटी।`,
    pa: `ਤੁਸੀਂ {{time}} 'ਤੇ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" 'ਤੇ ਟੈਪ ਕੀਤਾ, ਜੋ ਨੋਟਿਸ ਦੇ ਸਮੇਂ ਤੋਂ {{duration}} ਪਹਿਲਾਂ ਹੈ। ParkProof ਨੇ ਉਸ ਰਿਕਾਰਡ 'ਤੇ {{signedTime}} 'ਤੇ ਹਸਤਾਖਰ ਕੀਤੇ। ਰਿਕਾਰਡ ਦਿਖਾਉਂਦਾ ਹੈ ਕਿ ਤੁਸੀਂ ਕਦੋਂ ਟੈਪ ਕੀਤਾ, ਇਹ ਨਹੀਂ ਕਿ ਕਾਰ ਕਦੋਂ ਉੱਥੋਂ ਗਈ।`,
  },
  // Signed before the notice, but the phone's clock put the tap at or after it (a clock running fast).
  'notice.compare.departureSignedBeforeClock': {
    en: `You tapped I've left at {{time}} by your phone's clock. ParkProof signed that record at {{signedTime}}, before the time on the notice. The record shows when you tapped, not when the car moved.`,
    'zh-CN': `按你手机的时钟,你在 {{time}} 点击了"我已离开"。ParkProof 在 {{signedTime}} 为这条记录签名,早于通知上的时间。记录显示的是你点击的时间,不是车辆开走的时间。`,
    vi: `Theo đồng hồ điện thoại, bạn đã nhấn "Tôi đã đi" lúc {{time}}. ParkProof đã ký bản ghi đó lúc {{signedTime}}, trước giờ trên thông báo. Bản ghi cho thấy lúc bạn nhấn, không phải lúc xe di chuyển.`,
    id: `Menurut jam ponselmu, kamu mengetuk "Sudah pergi" pada {{time}}. ParkProof menandatangani catatan itu pada {{signedTime}}, sebelum waktu di surat denda. Catatan ini menunjukkan kapan kamu mengetuk, bukan kapan mobil bergerak.`,
    ko: `휴대폰 시계로 {{time}}에 "떠났습니다"를 눌렀습니다. ParkProof는 통지서의 시간 전인 {{signedTime}}에 그 기록에 서명했습니다. 이 기록은 누른 시각을 보여 줄 뿐, 차가 움직인 시각은 보여 주지 않습니다.`,
    it: `Hai toccato "Ho lasciato il posto": {{time}} (orologio del telefono). Firma di ParkProof su quel record: {{signedTime}}, prima dell'ora sul verbale. Il record mostra quando hai toccato, non quando l'auto si è spostata.`,
    el: `Σύμφωνα με το ρολόι του κινητού σου, πάτησες «Έφυγα» στις {{time}}. Το ParkProof υπέγραψε αυτή την εγγραφή στις {{signedTime}}, πριν από την ώρα της κλήσης. Η εγγραφή δείχνει πότε πάτησες, όχι πότε κινήθηκε το αυτοκίνητο.`,
    hi: `आपके फ़ोन की घड़ी के अनुसार, आपने {{time}} पर "मैंने जगह खाली कर दी" पर टैप किया। ParkProof ने उस रिकॉर्ड पर {{signedTime}} पर हस्ताक्षर किए, जो नोटिस के समय से पहले है। रिकॉर्ड दिखाता है कि आपने कब टैप किया, यह नहीं कि कार कब वहाँ से हटी।`,
    pa: `ਤੁਹਾਡੇ ਫ਼ੋਨ ਦੀ ਘੜੀ ਮੁਤਾਬਕ, ਤੁਸੀਂ {{time}} 'ਤੇ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" 'ਤੇ ਟੈਪ ਕੀਤਾ। ParkProof ਨੇ ਉਸ ਰਿਕਾਰਡ 'ਤੇ {{signedTime}} 'ਤੇ ਹਸਤਾਖਰ ਕੀਤੇ, ਜੋ ਨੋਟਿਸ ਦੇ ਸਮੇਂ ਤੋਂ ਪਹਿਲਾਂ ਹੈ। ਰਿਕਾਰਡ ਦਿਖਾਉਂਦਾ ਹੈ ਕਿ ਤੁਸੀਂ ਕਦੋਂ ਟੈਪ ਕੀਤਾ, ਇਹ ਨਹੀਂ ਕਿ ਕਾਰ ਕਦੋਂ ਉੱਥੋਂ ਗਈ।`,
  },
  'notice.compare.departureSignedAfter': {
    en: `You tapped I've left at {{time}} by your phone's clock. ParkProof only signed it at {{signedTime}}, after the time on the notice, so the signature can't show you'd left by {{noticeTime}}.`,
    'zh-CN': `按你手机的时钟,你在 {{time}} 点击了"我已离开"。但 ParkProof 直到 {{signedTime}} 才签名,晚于通知上的时间,所以签名无法表明你在 {{noticeTime}} 之前已经离开。`,
    vi: `Theo đồng hồ điện thoại, bạn đã nhấn "Tôi đã đi" lúc {{time}}. ParkProof chỉ ký lúc {{signedTime}}, sau giờ trên thông báo, nên chữ ký không thể cho thấy bạn đã rời đi trước {{noticeTime}}.`,
    id: `Menurut jam ponselmu, kamu mengetuk "Sudah pergi" pada {{time}}. ParkProof baru menandatanganinya pada {{signedTime}}, setelah waktu di surat denda, jadi tanda tangan itu tidak bisa menunjukkan bahwa kamu sudah pergi pada {{noticeTime}}.`,
    ko: `휴대폰 시계로 {{time}}에 "떠났습니다"를 눌렀습니다. ParkProof는 통지서의 시간 이후인 {{signedTime}}에야 서명했으므로, 이 서명으로는 {{noticeTime}}까지 떠났다는 것을 보여 줄 수 없습니다.`,
    it: `Hai toccato "Ho lasciato il posto": {{time}} (orologio del telefono). ParkProof l'ha firmato solo dopo l'ora sul verbale ({{signedTime}}), quindi la firma non può mostrare che avevi lasciato il posto entro {{noticeTime}}.`,
    el: `Σύμφωνα με το ρολόι του κινητού σου, πάτησες «Έφυγα» στις {{time}}. Το ParkProof την υπέγραψε μόλις στις {{signedTime}}, μετά την ώρα της κλήσης, οπότε η υπογραφή δεν μπορεί να δείξει ότι είχες φύγει ως τις {{noticeTime}}.`,
    hi: `आपके फ़ोन की घड़ी के अनुसार, आपने {{time}} पर "मैंने जगह खाली कर दी" पर टैप किया। ParkProof ने इस पर {{signedTime}} पर ही हस्ताक्षर किए, जो नोटिस के समय के बाद है, इसलिए हस्ताक्षर यह नहीं दिखा सकता कि {{noticeTime}} तक जगह खाली हो चुकी थी।`,
    pa: `ਤੁਹਾਡੇ ਫ਼ੋਨ ਦੀ ਘੜੀ ਮੁਤਾਬਕ, ਤੁਸੀਂ {{time}} 'ਤੇ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" 'ਤੇ ਟੈਪ ਕੀਤਾ। ParkProof ਨੇ ਇਸ 'ਤੇ {{signedTime}} 'ਤੇ ਹੀ ਹਸਤਾਖਰ ਕੀਤੇ, ਜੋ ਨੋਟਿਸ ਦੇ ਸਮੇਂ ਤੋਂ ਬਾਅਦ ਹੈ, ਇਸ ਲਈ ਹਸਤਾਖਰ ਇਹ ਨਹੀਂ ਦਿਖਾ ਸਕਦੇ ਕਿ {{noticeTime}} ਤੱਕ ਥਾਂ ਖਾਲੀ ਹੋ ਚੁੱਕੀ ਸੀ।`,
  },
  'notice.compare.departurePending': {
    en: `You tapped I've left at {{time}}. This hasn't been signed yet.`,
    'zh-CN': `你在 {{time}} 点击了"我已离开"。这还没有签名。`,
    vi: `Bạn đã nhấn "Tôi đã đi" lúc {{time}}. Phần này chưa được ký.`,
    id: `Kamu mengetuk "Sudah pergi" pada {{time}}. Ini belum ditandatangani.`,
    ko: `{{time}}에 "떠났습니다"를 눌렀습니다. 아직 서명되지 않았습니다.`,
    it: `Hai toccato "Ho lasciato il posto": {{time}}. Non è ancora stato firmato.`,
    el: `Πάτησες «Έφυγα» στις {{time}}. Αυτό δεν έχει υπογραφεί ακόμα.`,
    hi: `आपने {{time}} पर "मैंने जगह खाली कर दी" पर टैप किया। इस पर अभी हस्ताक्षर नहीं हुए हैं।`,
    pa: `ਤੁਸੀਂ {{time}} 'ਤੇ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" 'ਤੇ ਟੈਪ ਕੀਤਾ। ਇਸ 'ਤੇ ਅਜੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ।`,
  },
  // The departure was refused by the server, or will never be signed (an older record).
  'notice.compare.departureNotSigned': {
    en: `You tapped I've left at {{time}}. This wasn't signed.`,
    'zh-CN': `你在 {{time}} 点击了"我已离开"。这没有签名。`,
    vi: `Bạn đã nhấn "Tôi đã đi" lúc {{time}}. Phần này không được ký.`,
    id: `Kamu mengetuk "Sudah pergi" pada {{time}}. Ini tidak ditandatangani.`,
    ko: `{{time}}에 "떠났습니다"를 눌렀습니다. 서명되지 않았습니다.`,
    it: `Hai toccato "Ho lasciato il posto": {{time}}. Non è stato firmato.`,
    el: `Πάτησες «Έφυγα» στις {{time}}. Αυτό δεν υπογράφηκε.`,
    hi: `आपने {{time}} पर "मैंने जगह खाली कर दी" पर टैप किया। इस पर हस्ताक्षर नहीं हुए।`,
    pa: `ਤੁਸੀਂ {{time}} 'ਤੇ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" 'ਤੇ ਟੈਪ ਕੀਤਾ। ਇਸ 'ਤੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ।`,
  },
  'notice.compare.noDeparture': {
    en: `You haven't tapped I've left on this record.`,
    'zh-CN': `你还没有在这条记录上点击"我已离开"。`,
    vi: `Bạn chưa nhấn "Tôi đã đi" trên bản ghi này.`,
    id: `Kamu belum mengetuk "Sudah pergi" di catatan ini.`,
    ko: `이 기록에서 "떠났습니다"를 누르지 않았습니다.`,
    it: `Non hai toccato "Ho lasciato il posto" su questo record.`,
    el: `Δεν έχεις πατήσει «Έφυγα» σε αυτή την εγγραφή.`,
    hi: `इस रिकॉर्ड पर "मैंने जगह खाली कर दी" पर टैप नहीं किया गया है।`,
    pa: `ਇਸ ਰਿਕਾਰਡ 'ਤੇ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" 'ਤੇ ਟੈਪ ਨਹੀਂ ਕੀਤਾ ਗਿਆ।`,
  },
  'notice.compare.arrivalBefore': {
    en: `You logged this park at {{time}}, {{duration}} before the time on the notice.`,
    'zh-CN': `你在 {{time}} 记录了这次停车,比通知上的时间早 {{duration}}。`,
    vi: `Bạn đã ghi lại lần đỗ xe này lúc {{time}}, {{duration}} trước giờ trên thông báo.`,
    id: `Kamu mencatat parkir ini pada {{time}}, {{duration}} sebelum waktu di surat denda.`,
    ko: `{{time}}에 이 주차를 기록했습니다. 통지서의 시간보다 {{duration}} 전입니다.`,
    it: `Hai registrato questo parcheggio: {{time}}, {{duration}} prima dell'ora sul verbale.`,
    el: `Κατέγραψες αυτή τη στάθμευση στις {{time}}, {{duration}} πριν από την ώρα της κλήσης.`,
    hi: `आपने यह पार्किंग {{time}} पर दर्ज की, जो नोटिस के समय से {{duration}} पहले है।`,
    pa: `ਤੁਸੀਂ ਇਹ ਪਾਰਕਿੰਗ {{time}} 'ਤੇ ਦਰਜ ਕੀਤੀ, ਜੋ ਨੋਟਿਸ ਦੇ ਸਮੇਂ ਤੋਂ {{duration}} ਪਹਿਲਾਂ ਹੈ।`,
  },
  'notice.compare.arrivalAfter': {
    en: `You logged this park at {{time}}, {{duration}} after the time on the notice.`,
    'zh-CN': `你在 {{time}} 记录了这次停车,比通知上的时间晚 {{duration}}。`,
    vi: `Bạn đã ghi lại lần đỗ xe này lúc {{time}}, {{duration}} sau giờ trên thông báo.`,
    id: `Kamu mencatat parkir ini pada {{time}}, {{duration}} setelah waktu di surat denda.`,
    ko: `{{time}}에 이 주차를 기록했습니다. 통지서의 시간보다 {{duration}} 후입니다.`,
    it: `Hai registrato questo parcheggio: {{time}}, {{duration}} dopo l'ora sul verbale.`,
    el: `Κατέγραψες αυτή τη στάθμευση στις {{time}}, {{duration}} μετά την ώρα της κλήσης.`,
    hi: `आपने यह पार्किंग {{time}} पर दर्ज की, जो नोटिस के समय से {{duration}} बाद है।`,
    pa: `ਤੁਸੀਂ ਇਹ ਪਾਰਕਿੰਗ {{time}} 'ਤੇ ਦਰਜ ਕੀਤੀ, ਜੋ ਨੋਟਿਸ ਦੇ ਸਮੇਂ ਤੋਂ {{duration}} ਬਾਅਦ ਹੈ।`,
  },
  'notice.compare.arrivalSame': {
    en: `You logged this park at {{time}}, the same minute as the time on the notice.`,
    'zh-CN': `你在 {{time}} 记录了这次停车,与通知上的时间在同一分钟。`,
    vi: `Bạn đã ghi lại lần đỗ xe này lúc {{time}}, cùng phút với giờ trên thông báo.`,
    id: `Kamu mencatat parkir ini pada {{time}}, pada menit yang sama dengan waktu di surat denda.`,
    ko: `{{time}}에 이 주차를 기록했습니다. 통지서의 시간과 같은 분입니다.`,
    it: `Hai registrato questo parcheggio: {{time}}, nello stesso minuto dell'ora sul verbale.`,
    el: `Κατέγραψες αυτή τη στάθμευση στις {{time}}, στο ίδιο λεπτό με την ώρα της κλήσης.`,
    hi: `आपने यह पार्किंग {{time}} पर दर्ज की, उसी मिनट में जो नोटिस पर लिखा है।`,
    pa: `ਤੁਸੀਂ ਇਹ ਪਾਰਕਿੰਗ {{time}} 'ਤੇ ਦਰਜ ਕੀਤੀ, ਉਸੇ ਮਿੰਟ ਵਿੱਚ ਜੋ ਨੋਟਿਸ 'ਤੇ ਲਿਖਿਆ ਹੈ।`,
  },
  'notice.compare.driver': {
    en: `Your record says {{driver}} was driving. That's what was entered when the park was logged. ParkProof didn't check it. If someone else was driving, the notice explains how to nominate them. Only nominate the person who was actually driving.`,
    'zh-CN': `你的记录写的是 {{driver}} 在开车。这是记录停车时输入的内容,ParkProof 没有核实。如果当时是别人在开车,通知上会说明如何提名对方。只能提名实际开车的人。`,
    vi: `Bản ghi của bạn nói {{driver}} là người lái xe. Đó là thông tin được nhập khi ghi lại lần đỗ xe. ParkProof không kiểm tra điều này. Nếu người khác lái xe, thông báo có giải thích cách chỉ định người đó. Chỉ được chỉ định người thực sự đã lái xe.`,
    id: `Catatanmu menyebut {{driver}} yang mengemudi. Itu yang dimasukkan saat parkir ini dicatat. ParkProof tidak memeriksanya. Jika orang lain yang mengemudi, surat denda menjelaskan cara menominasikan orang itu. Nominasikan hanya orang yang benar-benar mengemudi.`,
    ko: `기록에는 운전자가 {{driver}}(으)로 되어 있습니다. 주차를 기록할 때 입력된 내용이며, ParkProof가 확인하지 않았습니다. 다른 사람이 운전했다면 통지서에 운전자 지정 방법이 나와 있습니다. 실제로 운전한 사람만 지정하세요.`,
    it: `Il tuo record dice che alla guida c'era {{driver}}. È quanto inserito quando il parcheggio è stato registrato. ParkProof non l'ha verificato. Se alla guida c'era un'altra persona, il verbale spiega come indicarla. Indica solo la persona che era davvero alla guida.`,
    el: `Σύμφωνα με την εγγραφή σου, οδηγός ήταν: {{driver}}. Αυτό καταχωρίστηκε όταν καταγράφηκε η στάθμευση. Το ParkProof δεν το έλεγξε. Αν οδηγούσε άλλο άτομο, η κλήση εξηγεί πώς να το δηλώσεις. Δήλωσε μόνο το άτομο που πραγματικά οδηγούσε.`,
    hi: `आपके रिकॉर्ड में चालक के रूप में {{driver}} का नाम है। यह वही है जो पार्किंग दर्ज करते समय डाला गया था। ParkProof ने इसकी जाँच नहीं की। अगर गाड़ी किसी और ने चलाई थी, तो नोटिस में बताया गया है कि उन्हें कैसे नामित करें। केवल उसी व्यक्ति को नामित करें जिसने सच में गाड़ी चलाई थी।`,
    pa: `ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਵਿੱਚ ਡਰਾਈਵਰ ਵਜੋਂ {{driver}} ਦਾ ਨਾਂ ਹੈ। ਇਹ ਉਹੀ ਹੈ ਜੋ ਪਾਰਕਿੰਗ ਦਰਜ ਕਰਦੇ ਸਮੇਂ ਭਰਿਆ ਗਿਆ ਸੀ। ParkProof ਨੇ ਇਸ ਦੀ ਜਾਂਚ ਨਹੀਂ ਕੀਤੀ। ਜੇ ਗੱਡੀ ਕਿਸੇ ਹੋਰ ਨੇ ਚਲਾਈ ਸੀ, ਤਾਂ ਨੋਟਿਸ ਵਿੱਚ ਦੱਸਿਆ ਗਿਆ ਹੈ ਕਿ ਉਹਨਾਂ ਨੂੰ ਕਿਵੇਂ ਨਾਮਜ਼ਦ ਕਰਨਾ ਹੈ। ਸਿਰਫ਼ ਉਸੇ ਵਿਅਕਤੀ ਨੂੰ ਨਾਮਜ਼ਦ ਕਰੋ ਜਿਸ ਨੇ ਅਸਲ ਵਿੱਚ ਗੱਡੀ ਚਲਾਈ ਸੀ।`,
  },
  'notice.compare.handover': {
    en: `Your record says the car was handed to {{to_driver}} at {{time}}.`,
    'zh-CN': `你的记录写的是,车辆在 {{time}} 交给了 {{to_driver}}。`,
    vi: `Bản ghi của bạn nói xe đã được giao cho {{to_driver}} lúc {{time}}.`,
    id: `Catatanmu menyebut mobil diserahkan kepada {{to_driver}} pada {{time}}.`,
    ko: `기록에는 {{time}}에 차가 {{to_driver}}에게 인계되었다고 되어 있습니다.`,
    it: `Il tuo record dice che l'auto è stata consegnata a {{to_driver}}: {{time}}.`,
    // One sentence: the name stays inside the "your record says" clause.
    el: `Σύμφωνα με την εγγραφή σου, το αυτοκίνητο παραδόθηκε στις {{time}} στο άτομο με όνομα {{to_driver}}.`,
    hi: `आपके रिकॉर्ड के अनुसार कार {{time}} पर {{to_driver}} को सौंपी गई।`,
    pa: `ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਮੁਤਾਬਕ ਕਾਰ {{time}} 'ਤੇ {{to_driver}} ਨੂੰ ਸੌਂਪੀ ਗਈ।`,
  },
  'notice.compare.checkRegistration': {
    en: `Check the registration on the notice is the car in this record. ParkProof doesn't record registrations.`,
    'zh-CN': `请核对通知上的车牌号是否就是这条记录里的车。ParkProof 不记录车牌号。`,
    vi: `Hãy kiểm tra biển số xe trên thông báo có phải là xe trong bản ghi này không. ParkProof không ghi lại biển số xe.`,
    id: `Pastikan nomor registrasi di surat denda adalah mobil dalam catatan ini. ParkProof tidak mencatat nomor registrasi.`,
    ko: `통지서의 차량 등록 번호가 이 기록의 차가 맞는지 확인하세요. ParkProof는 차량 등록 번호를 기록하지 않습니다.`,
    it: `Controlla che la targa sul verbale sia quella dell'auto di questo record. ParkProof non registra le targhe.`,
    el: `Έλεγξε ότι ο αριθμός κυκλοφορίας στην κλήση είναι του αυτοκινήτου αυτής της εγγραφής. Το ParkProof δεν καταγράφει αριθμούς κυκλοφορίας.`,
    hi: `जाँच लें कि नोटिस पर लिखा रजिस्ट्रेशन नंबर इसी रिकॉर्ड वाली कार का है। ParkProof रजिस्ट्रेशन नंबर दर्ज नहीं करता।`,
    pa: `ਜਾਂਚ ਕਰੋ ਕਿ ਨੋਟਿਸ 'ਤੇ ਲਿਖਿਆ ਰਜਿਸਟ੍ਰੇਸ਼ਨ ਨੰਬਰ ਇਸੇ ਰਿਕਾਰਡ ਵਾਲੀ ਕਾਰ ਦਾ ਹੈ। ParkProof ਰਜਿਸਟ੍ਰੇਸ਼ਨ ਨੰਬਰ ਦਰਜ ਨਹੀਂ ਕਰਦਾ।`,
  },
  'notice.compare.checkDueDate': {
    en: `Check the due date on the notice itself.`,
    'zh-CN': `请在通知本身上查看截止日期。`,
    vi: `Hãy xem hạn chót trên chính thông báo.`,
    id: `Periksa tanggal jatuh tempo di surat dendanya langsung.`,
    ko: `기한은 통지서에서 직접 확인하세요.`,
    it: `Controlla la scadenza sul verbale stesso.`,
    el: `Έλεγξε την προθεσμία στην ίδια την κλήση.`,
    hi: `अंतिम तारीख सीधे नोटिस पर ही देखें।`,
    pa: `ਆਖਰੀ ਤਾਰੀਖ ਸਿੱਧੇ ਨੋਟਿਸ 'ਤੇ ਹੀ ਦੇਖੋ।`,
  },
  // A departure signed with a development key (npm run dev): never shown
  // as ParkProof's signing time, and no "before the notice" claim.
  'notice.compare.departureDevKey': {
    en: `You tapped I've left at {{time}} by your phone's clock. It was signed with a development key, not ParkProof's published key, so the signature can't show you'd left by {{noticeTime}}.`,
    'zh-CN': `按你手机的时钟,你在 {{time}} 点击了"我已离开"。这部分使用开发密钥签名,不是 ParkProof 公布的密钥,所以签名无法表明你在 {{noticeTime}} 之前已经离开。`,
    vi: `Theo đồng hồ điện thoại, bạn đã nhấn "Tôi đã đi" lúc {{time}}. Phần này được ký bằng khóa phát triển, không phải khóa mà ParkProof đã công bố, nên chữ ký không thể cho thấy bạn đã rời đi trước {{noticeTime}}.`,
    id: `Menurut jam ponselmu, kamu mengetuk "Sudah pergi" pada {{time}}. Ini ditandatangani dengan kunci pengembangan, bukan kunci yang diterbitkan ParkProof, jadi tanda tangan itu tidak bisa menunjukkan bahwa kamu sudah pergi pada {{noticeTime}}.`,
    ko: `휴대폰 시계로 {{time}}에 "떠났습니다"를 눌렀습니다. 이 부분은 ParkProof가 공개한 키가 아닌 개발용 키로 서명되었으므로, 이 서명으로는 {{noticeTime}}까지 떠났다는 것을 보여 줄 수 없습니다.`,
    it: `Hai toccato "Ho lasciato il posto": {{time}} (orologio del telefono). È stato firmato con una chiave di sviluppo, non con la chiave pubblicata da ParkProof, quindi la firma non può mostrare che avevi lasciato il posto entro {{noticeTime}}.`,
    el: `Σύμφωνα με το ρολόι του κινητού σου, πάτησες «Έφυγα» στις {{time}}. Υπογράφηκε με κλειδί ανάπτυξης, όχι με το δημοσιευμένο κλειδί του ParkProof, οπότε η υπογραφή δεν μπορεί να δείξει ότι είχες φύγει ως τις {{noticeTime}}.`,
    hi: `आपके फ़ोन की घड़ी के अनुसार, आपने {{time}} पर "मैंने जगह खाली कर दी" पर टैप किया। इस पर डेवलपमेंट कुंजी से हस्ताक्षर हुए, ParkProof की प्रकाशित कुंजी से नहीं, इसलिए हस्ताक्षर यह नहीं दिखा सकता कि {{noticeTime}} तक जगह खाली हो चुकी थी।`,
    pa: `ਤੁਹਾਡੇ ਫ਼ੋਨ ਦੀ ਘੜੀ ਮੁਤਾਬਕ, ਤੁਸੀਂ {{time}} 'ਤੇ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" 'ਤੇ ਟੈਪ ਕੀਤਾ। ਇਸ 'ਤੇ ਡਿਵੈਲਪਮੈਂਟ ਕੁੰਜੀ ਨਾਲ ਹਸਤਾਖਰ ਹੋਏ, ParkProof ਦੀ ਪ੍ਰਕਾਸ਼ਿਤ ਕੁੰਜੀ ਨਾਲ ਨਹੀਂ, ਇਸ ਲਈ ਹਸਤਾਖਰ ਇਹ ਨਹੀਂ ਦਿਖਾ ਸਕਦੇ ਕਿ {{noticeTime}} ਤੱਕ ਥਾਂ ਖਾਲੀ ਹੋ ਚੁੱਕੀ ਸੀ।`,
  },
  // After the arrival line: how the record's arrival part (link 0) stands
  // against the notice (N5). Signed before it, shown when the phone's log
  // time is more than 5 minutes off ParkProof's or on the other side of
  // the notice time.
  // The second sentence is the signature's limit (copy rules: say so
  // wherever signed material is presented). It matters most when the
  // phone's log time is after the notice: the signature still doesn't show
  // the car was there by then.
  'notice.compare.arrivalSignedBefore': {
    en: `ParkProof signed this record at {{signedTime}}, before the time on the notice. The signature shows the record existed by then, not when the car arrived or where it was.`,
    'zh-CN': `ParkProof 在 {{signedTime}} 为这条记录签名,早于通知上的时间。签名表明这条记录在那时已经存在,但不能说明车辆何时到达或停在哪里。`,
    vi: `ParkProof đã ký bản ghi này lúc {{signedTime}}, trước giờ trên thông báo. Chữ ký cho thấy bản ghi đã có từ lúc đó, không cho thấy xe đến lúc nào hay xe ở đâu.`,
    id: `ParkProof menandatangani catatan ini pada {{signedTime}}, sebelum waktu di surat denda. Tanda tangan itu menunjukkan bahwa catatan ini sudah ada saat itu, bukan kapan mobil tiba atau di mana mobil berada.`,
    ko: `ParkProof는 통지서의 시간 전인 {{signedTime}}에 이 기록에 서명했습니다. 이 서명은 그때 이 기록이 이미 있었다는 것을 보여 줄 뿐, 차가 언제 도착했는지나 어디에 있었는지는 보여 주지 않습니다.`,
    it: `Firma di ParkProof su questo record: {{signedTime}}, prima dell'ora sul verbale. La firma mostra che il record esisteva già allora, non quando l'auto è arrivata né dove si trovava.`,
    el: `Το ParkProof υπέγραψε αυτή την εγγραφή στις {{signedTime}}, πριν από την ώρα της κλήσης. Η υπογραφή δείχνει ότι η εγγραφή υπήρχε ήδη τότε, όχι πότε έφτασε το αυτοκίνητο ή πού ήταν.`,
    hi: `ParkProof ने इस रिकॉर्ड पर {{signedTime}} पर हस्ताक्षर किए, जो नोटिस के समय से पहले है। हस्ताक्षर दिखाता है कि यह रिकॉर्ड तब तक मौजूद था, यह नहीं कि कार कब पहुँची या कहाँ थी।`,
    pa: `ParkProof ਨੇ ਇਸ ਰਿਕਾਰਡ 'ਤੇ {{signedTime}} 'ਤੇ ਹਸਤਾਖਰ ਕੀਤੇ, ਜੋ ਨੋਟਿਸ ਦੇ ਸਮੇਂ ਤੋਂ ਪਹਿਲਾਂ ਹੈ। ਹਸਤਾਖਰ ਦਿਖਾਉਂਦਾ ਹੈ ਕਿ ਇਹ ਰਿਕਾਰਡ ਉਦੋਂ ਤੱਕ ਮੌਜੂਦ ਸੀ, ਇਹ ਨਹੀਂ ਕਿ ਕਾਰ ਕਦੋਂ ਪਹੁੰਚੀ ਜਾਂ ਕਿੱਥੇ ਸੀ।`,
  },
  'notice.compare.arrivalSignedAfter': {
    en: `ParkProof only signed this record at {{signedTime}}, after the time on the notice, so the signature can't show it existed by {{noticeTime}}.`,
    'zh-CN': `ParkProof 直到 {{signedTime}} 才为这条记录签名,晚于通知上的时间,所以签名无法表明这条记录在 {{noticeTime}} 之前已经存在。`,
    vi: `ParkProof chỉ ký bản ghi này lúc {{signedTime}}, sau giờ trên thông báo, nên chữ ký không thể cho thấy bản ghi đã có trước {{noticeTime}}.`,
    id: `ParkProof baru menandatangani catatan ini pada {{signedTime}}, setelah waktu di surat denda, jadi tanda tangan itu tidak bisa menunjukkan bahwa catatan ini sudah ada pada {{noticeTime}}.`,
    ko: `ParkProof는 통지서의 시간 이후인 {{signedTime}}에야 이 기록에 서명했으므로, 이 서명으로는 이 기록이 {{noticeTime}}에 이미 있었다는 것을 보여 줄 수 없습니다.`,
    it: `ParkProof ha firmato questo record solo dopo l'ora sul verbale ({{signedTime}}), quindi la firma non può mostrare che esisteva già entro {{noticeTime}}.`,
    el: `Το ParkProof υπέγραψε αυτή την εγγραφή μόλις στις {{signedTime}}, μετά την ώρα της κλήσης, οπότε η υπογραφή δεν μπορεί να δείξει ότι η εγγραφή υπήρχε ως τις {{noticeTime}}.`,
    hi: `ParkProof ने इस रिकॉर्ड पर {{signedTime}} पर ही हस्ताक्षर किए, जो नोटिस के समय के बाद है, इसलिए हस्ताक्षर यह नहीं दिखा सकता कि यह रिकॉर्ड {{noticeTime}} तक मौजूद था।`,
    pa: `ParkProof ਨੇ ਇਸ ਰਿਕਾਰਡ 'ਤੇ {{signedTime}} 'ਤੇ ਹੀ ਹਸਤਾਖਰ ਕੀਤੇ, ਜੋ ਨੋਟਿਸ ਦੇ ਸਮੇਂ ਤੋਂ ਬਾਅਦ ਹੈ, ਇਸ ਲਈ ਹਸਤਾਖਰ ਇਹ ਨਹੀਂ ਦਿਖਾ ਸਕਦੇ ਕਿ ਇਹ ਰਿਕਾਰਡ {{noticeTime}} ਤੱਕ ਮੌਜੂਦ ਸੀ।`,
  },
  'notice.compare.arrivalDevKey': {
    en: `This record was signed with a development key, not ParkProof's published key, so the signature can't show it existed by {{noticeTime}}.`,
    'zh-CN': `这条记录使用开发密钥签名,不是 ParkProof 公布的密钥,所以签名无法表明它在 {{noticeTime}} 之前已经存在。`,
    vi: `Bản ghi này được ký bằng khóa phát triển, không phải khóa mà ParkProof đã công bố, nên chữ ký không thể cho thấy bản ghi đã có trước {{noticeTime}}.`,
    id: `Catatan ini ditandatangani dengan kunci pengembangan, bukan kunci yang diterbitkan ParkProof, jadi tanda tangan itu tidak bisa menunjukkan bahwa catatan ini sudah ada pada {{noticeTime}}.`,
    ko: `이 기록은 ParkProof가 공개한 키가 아닌 개발용 키로 서명되었으므로, 이 서명으로는 이 기록이 {{noticeTime}}에 이미 있었다는 것을 보여 줄 수 없습니다.`,
    it: `Questo record è stato firmato con una chiave di sviluppo, non con la chiave pubblicata da ParkProof, quindi la firma non può mostrare che esisteva già entro {{noticeTime}}.`,
    el: `Αυτή η εγγραφή υπογράφηκε με κλειδί ανάπτυξης, όχι με το δημοσιευμένο κλειδί του ParkProof, οπότε η υπογραφή δεν μπορεί να δείξει ότι υπήρχε ως τις {{noticeTime}}.`,
    hi: `इस रिकॉर्ड पर डेवलपमेंट कुंजी से हस्ताक्षर हुए, ParkProof की प्रकाशित कुंजी से नहीं, इसलिए हस्ताक्षर यह नहीं दिखा सकता कि यह रिकॉर्ड {{noticeTime}} तक मौजूद था।`,
    pa: `ਇਸ ਰਿਕਾਰਡ 'ਤੇ ਡਿਵੈਲਪਮੈਂਟ ਕੁੰਜੀ ਨਾਲ ਹਸਤਾਖਰ ਹੋਏ, ParkProof ਦੀ ਪ੍ਰਕਾਸ਼ਿਤ ਕੁੰਜੀ ਨਾਲ ਨਹੀਂ, ਇਸ ਲਈ ਹਸਤਾਖਰ ਇਹ ਨਹੀਂ ਦਿਖਾ ਸਕਦੇ ਕਿ ਇਹ ਰਿਕਾਰਡ {{noticeTime}} ਤੱਕ ਮੌਜੂਦ ਸੀ।`,
  },
  'notice.compare.arrivalPending': {
    en: `ParkProof hasn't signed this record yet.`,
    'zh-CN': `ParkProof 还没有为这条记录签名。`,
    vi: `ParkProof chưa ký bản ghi này.`,
    id: `ParkProof belum menandatangani catatan ini.`,
    ko: `ParkProof가 아직 이 기록에 서명하지 않았습니다.`,
    it: `ParkProof non ha ancora firmato questo record.`,
    el: `Το ParkProof δεν έχει υπογράψει ακόμα αυτή την εγγραφή.`,
    hi: `ParkProof ने अभी इस रिकॉर्ड पर हस्ताक्षर नहीं किए हैं।`,
    pa: `ParkProof ਨੇ ਅਜੇ ਇਸ ਰਿਕਾਰਡ 'ਤੇ ਹਸਤਾਖਰ ਨਹੀਂ ਕੀਤੇ।`,
  },
  // Link 0 was refused by the server.
  'notice.compare.arrivalNotSigned': {
    en: `This record wasn't signed.`,
    'zh-CN': `这条记录没有签名。`,
    vi: `Bản ghi này không được ký.`,
    id: `Catatan ini tidak ditandatangani.`,
    ko: `이 기록은 서명되지 않았습니다.`,
    it: `Questo record non è stato firmato.`,
    el: `Αυτή η εγγραφή δεν υπογράφηκε.`,
    hi: `इस रिकॉर्ड पर हस्ताक्षर नहीं हुए।`,
    pa: `ਇਸ ਰਿਕਾਰਡ 'ਤੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ।`,
  },
  // After the driver or a handover line when that part isn't signed (N2:
  // values not signed yet are labelled).
  'notice.compare.driverPending': {
    en: `The driver's name hasn't been signed yet.`,
    'zh-CN': `驾驶员姓名还没有签名。`,
    vi: `Tên tài xế chưa được ký.`,
    id: `Nama pengemudi belum ditandatangani.`,
    ko: `운전자 이름은 아직 서명되지 않았습니다.`,
    it: `Il nome del conducente non è ancora stato firmato.`,
    el: `Το όνομα του οδηγού δεν έχει υπογραφεί ακόμα.`,
    hi: `चालक के नाम पर अभी हस्ताक्षर नहीं हुए हैं।`,
    pa: `ਡਰਾਈਵਰ ਦੇ ਨਾਂ 'ਤੇ ਅਜੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ।`,
  },
  'notice.compare.driverNotSigned': {
    en: `The driver's name wasn't signed.`,
    'zh-CN': `驾驶员姓名没有签名。`,
    vi: `Tên tài xế không được ký.`,
    id: `Nama pengemudi tidak ditandatangani.`,
    ko: `운전자 이름은 서명되지 않았습니다.`,
    it: `Il nome del conducente non è stato firmato.`,
    el: `Το όνομα του οδηγού δεν υπογράφηκε.`,
    hi: `चालक के नाम पर हस्ताक्षर नहीं हुए।`,
    pa: `ਡਰਾਈਵਰ ਦੇ ਨਾਂ 'ਤੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ।`,
  },
  'notice.compare.handoverPending': {
    en: `This handover hasn't been signed yet.`,
    'zh-CN': `这次车辆交接还没有签名。`,
    vi: `Việc giao xe này chưa được ký.`,
    id: `Serah terima mobil ini belum ditandatangani.`,
    ko: `이 차량 인계는 아직 서명되지 않았습니다.`,
    it: `Questa consegna dell'auto non è ancora stata firmata.`,
    el: `Αυτή η παράδοση του αυτοκινήτου δεν έχει υπογραφεί ακόμα.`,
    hi: `कार सौंपने की इस जानकारी पर अभी हस्ताक्षर नहीं हुए हैं।`,
    pa: `ਕਾਰ ਸੌਂਪਣ ਦੀ ਇਸ ਜਾਣਕਾਰੀ 'ਤੇ ਅਜੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ।`,
  },
  // Durations in the comparison lines: "15 minutes", "1 hour", "1 hour 39 minutes".
  'notice.duration.minutes_one': {
    en: `{{count}} minute`,
    'zh-CN': `{{count}} 分钟`,
    vi: `{{count}} phút`,
    id: `{{count}} menit`,
    ko: `{{count}}분`,
    it: `{{count}} minuto`,
    el: `{{count}} λεπτό`,
    hi: `{{count}} मिनट`,
    pa: `{{count}} ਮਿੰਟ`,
  },
  'notice.duration.minutes_other': {
    en: `{{count}} minutes`,
    'zh-CN': `{{count}} 分钟`,
    vi: `{{count}} phút`,
    id: `{{count}} menit`,
    ko: `{{count}}분`,
    it: `{{count}} minuti`,
    el: `{{count}} λεπτά`,
    hi: `{{count}} मिनट`,
    pa: `{{count}} ਮਿੰਟ`,
  },
  'notice.duration.hours_one': {
    en: `{{count}} hour`,
    'zh-CN': `{{count}} 小时`,
    vi: `{{count}} giờ`,
    id: `{{count}} jam`,
    ko: `{{count}}시간`,
    it: `{{count}} ora`,
    el: `{{count}} ώρα`,
    hi: `{{count}} घंटा`,
    pa: `{{count}} ਘੰਟਾ`,
  },
  'notice.duration.hours_other': {
    en: `{{count}} hours`,
    'zh-CN': `{{count}} 小时`,
    vi: `{{count}} giờ`,
    id: `{{count}} jam`,
    ko: `{{count}}시간`,
    it: `{{count}} ore`,
    el: `{{count}} ώρες`,
    hi: `{{count}} घंटे`,
    pa: `{{count}} ਘੰਟੇ`,
  },
  'notice.duration.hoursMinutes': {
    en: `{{hours}} {{minutes}}`,
    'zh-CN': `{{hours}} {{minutes}}`,
    vi: `{{hours}} {{minutes}}`,
    id: `{{hours}} {{minutes}}`,
    ko: `{{hours}} {{minutes}}`,
    it: `{{hours}} e {{minutes}}`,
    el: `{{hours}} και {{minutes}}`,
    hi: `{{hours}} {{minutes}}`,
    pa: `{{hours}} {{minutes}}`,
  },
  // The actions (item 5).
  'notice.actions.draftAppeal': {
    en: `Draft an appeal with this record`,
    'zh-CN': `用这条记录起草申诉信`,
    vi: `Soạn thư khiếu nại với bản ghi này`,
    id: `Buat draf surat banding dengan catatan ini`,
    ko: `이 기록으로 이의신청서 작성`,
    it: `Redigi un ricorso con questo record`,
    el: `Σύνταξε ένσταση με αυτή την εγγραφή`,
    hi: `इस रिकॉर्ड के साथ अपील का मसौदा तैयार करें`,
    pa: `ਇਸ ਰਿਕਾਰਡ ਨਾਲ ਅਪੀਲ ਦਾ ਖਰੜਾ ਤਿਆਰ ਕਰੋ`,
  },
  'notice.actions.exportPdf': {
    en: `Export evidence PDF`,
    'zh-CN': `导出证据 PDF`,
    vi: `Xuất PDF bằng chứng`,
    id: `Ekspor PDF bukti`,
    ko: `증거 PDF 내보내기`,
    it: `Esporta il PDF delle prove`,
    el: `Εξαγωγή PDF αποδεικτικών`,
    hi: `सबूत PDF निर्यात करें`,
    pa: `ਸਬੂਤ PDF ਨਿਰਯਾਤ ਕਰੋ`,
  },
  'notice.actions.draftAnyway': {
    en: `Draft an appeal anyway`,
    'zh-CN': `仍然起草申诉信`,
    vi: `Vẫn soạn thư khiếu nại`,
    id: `Tetap buat draf surat banding`,
    ko: `그래도 이의신청서 작성`,
    it: `Redigi comunque un ricorso`,
    el: `Σύνταξε ένσταση ούτως ή άλλως`,
    hi: `फिर भी अपील का मसौदा तैयार करें`,
    pa: `ਫਿਰ ਵੀ ਅਪੀਲ ਦਾ ਖਰੜਾ ਤਿਆਰ ਕਰੋ`,
  },
  'notice.disclaimer': {
    en: `This compares your record with what the notice says. It isn't legal advice, and it doesn't say whether the fine should stand. The council or court decides that.`,
    'zh-CN': `这里只是把你的记录与通知上的内容进行对比。这不是法律建议,也不表示这笔罚款是否成立。这由市议会或法院决定。`,
    vi: `Phần này so sánh bản ghi của bạn với nội dung trên thông báo. Đây không phải là tư vấn pháp lý và không cho biết khoản phạt có hợp lệ hay không. Việc đó do hội đồng hoặc tòa án quyết định.`,
    id: `Ini membandingkan catatanmu dengan isi surat denda. Ini bukan nasihat hukum, dan tidak menyatakan apakah dendanya sah. Dewan kota atau pengadilan yang memutuskan.`,
    ko: `이 화면은 기록을 통지서 내용과 비교할 뿐입니다. 법률 조언이 아니며, 벌금이 타당한지 판단하지 않습니다. 그 판단은 의회나 법원이 합니다.`,
    it: `Questo confronta il tuo record con quanto dice il verbale. Non è una consulenza legale e non dice se la multa è fondata. Lo decidono il comune o il tribunale.`,
    el: `Αυτό συγκρίνει την εγγραφή σου με όσα γράφει η κλήση. Δεν είναι νομική συμβουλή και δεν λέει αν το πρόστιμο ισχύει. Αυτό το αποφασίζει ο δήμος ή το δικαστήριο.`,
    hi: `यह आपके रिकॉर्ड की तुलना नोटिस में लिखी बातों से करता है। यह कानूनी सलाह नहीं है, और यह नहीं बताता कि जुर्माना सही है या नहीं। इसका फ़ैसला परिषद या अदालत करती है।`,
    pa: `ਇਹ ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਦੀ ਤੁਲਨਾ ਨੋਟਿਸ ਵਿੱਚ ਲਿਖੀਆਂ ਗੱਲਾਂ ਨਾਲ ਕਰਦਾ ਹੈ। ਇਹ ਕਾਨੂੰਨੀ ਸਲਾਹ ਨਹੀਂ ਹੈ, ਅਤੇ ਇਹ ਨਹੀਂ ਦੱਸਦਾ ਕਿ ਜੁਰਮਾਨਾ ਸਹੀ ਹੈ ਜਾਂ ਨਹੀਂ। ਇਸ ਦਾ ਫ਼ੈਸਲਾ ਕੌਂਸਲ ਜਾਂ ਅਦਾਲਤ ਕਰਦੀ ਹੈ।`,
  },
}

// ── Existing strings this task rewrites (explicit overwrite list) ───────
// Each must already exist in every locale; the script aborts otherwise.
const OVERWRITES = {}

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
      // Copy rules: no em-dashes; PDF-safe symbols only where a PDF could use them.
      if (s.includes(String.fromCharCode(0x2014))) problems.push(`em-dash in new copy at ${path}: ${s}`)
      if (/[✓⚠→≈≤]/u.test(s)) problems.push(`symbol in new copy at ${path}: ${s}`)
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
    // A phone time is never called signed.
    if (/signed departure at/i.test(byLocale.en)) problems.push(`"signed departure at" in en copy at ${path}`)
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
