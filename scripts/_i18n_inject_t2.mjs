/**
 * T2 i18n (roadmap build spec, task T2: the signed before-photo and the
 * compliance photo). Idempotent: running it twice leaves the files
 * byte-identical after the first run. Later units of T2 extend this same
 * script (one script per task).
 *
 * Adds:
 *   - `photoGrid`: the angle grid (front, rear, left, right, close-up),
 *     its tile states, the photo count on a closed section, and the copy
 *     from item 11 ("A signed photo shows the photo existed by the time it
 *     was signed. It doesn't show who caused any damage.").
 *   - `logger.condition` and `logger.proof`: the logger's collapsed
 *     "Record the car's condition (optional)" section with the "Damage you
 *     noticed" note, and the proof of payment or permit section.
 *   - `proof` and `complianceType`: the library link for payment
 *     confirmations and the type picker (code values go through
 *     `complianceType.*`, never printed raw).
 *   - `departure.condition.toggle`: the departure sheet's collapsed
 *     "Record the car's condition now (optional)".
 *   - `evidence`: the record screen's condition and proof photos (time from
 *     the phone clock, fingerprint, the exact library label from item 7),
 *     and the after-saving sheets ("Add condition photos", "Add a photo of
 *     your ticket or permit").
 *   - `backupPrompt`: the one-time prompt after the first signed photo
 *     (item 12): add to Home Screen or sign in to back up, with Safari's
 *     7-day reason.
 *   - `evidenceFile`: the record screen's evidence file download (item 9),
 *     with the "Include permit details" tick (N3).
 *   - `pdf.evidence.field.*` / `pdf.evidence.value.*`: the PDF rows for the
 *     proof photo, the condition photos and the driver's damage notes
 *     (item 8); `pdf.complianceType.*` and `pdf.photos.*`, PDF-only twins
 *     of the screen strings (the PDF fonts are subsets, see
 *     src/lib/pdf-font-coverage.test.ts); `pdf.signature.verifyPhotoMatch`
 *     and `pdf.signature.verifyWindows` (certutil, for cmd and PowerShell).
 *
 * Rewrites (OVERWRITES): `pdf.signature.verifyStep7`, the photo re-hash
 * step, now pointing at the originals in the evidence file and at the
 * photo fingerprints in every link, not only link 0.
 *
 * Review fix round 1 (keys this script owns, so rewritten in place):
 * `evidence.addIntro` (fingerprints are signed, the photos aren't sent),
 * `evidenceFile.help` (the file contains the record's location and times;
 * what a signature shows), `evidenceFile.permitHelp` (photos marked as a
 * displayed permit go in only when ticked), `backupPrompt.homeScreenIos`
 * (records saved in Safari don't move to the Home Screen app), and Greek
 * εγγραφή for "record" in the evidence.* strings and backupPrompt.body.
 * Added: `evidence.cantAddNow`, `evidence.complianceDescribed`,
 * `evidence.noteNotSigned`, `evidenceFile.photosDiffer_one/_other` and
 * `pdf.evidence.value.notSigned`.
 *
 * Review fix round 2: `evidenceFile.help` lists everything a signature
 * doesn't show (true, who was driving, where the car was, when it arrived
 * or left), worded as `chain.intro` already is in each locale.
 *
 * Phone times are labelled as phone times. A photo is only ever described
 * as signed through the existing chain.signedAt / verifier keys, which the
 * screen picks from the signed payload.
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces, plus: every `_one` key this
 * script owns carries {{count}} in every locale).
 *
 * Run:   node scripts/_i18n_inject_t2.mjs
 * List:  node scripts/_i18n_inject_t2.mjs --list
 *        prints every key this task added or rewrote, for the T10
 *        translation review ('legal' marks statements about signatures,
 *        photos or times a lawyer should read).
 * Other: node scripts/_i18n_inject_t2.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

/** Keys whose wording makes a claim about signatures, photos or times: for docs/legal-review-queue.md (T10). */
const LEGAL = new Set([
  'photoGrid.signedNote',
  'evidence.addedAt',
  'evidence.library',
  'evidence.notSigned',
  'evidence.addIntro',
  'evidence.noteLabel',
  'backupPrompt.body',
  'evidenceFile.help',
  'evidenceFile.permitHelp',
  'evidenceFile.photosMissing_one',
  'evidenceFile.photosMissing_other',
  'pdf.evidence.value.complianceDescribed',
  'pdf.evidence.value.noteWhenParked',
  'pdf.evidence.value.noteOnReturn',
  'pdf.photos.added',
  'pdf.photos.library',
  'pdf.photos.signedAt',
  'pdf.photos.signedNote',
  'pdf.signature.verifyStep7',
  'pdf.signature.verifyPhotoMatch',
  // Fix round 1
  'evidence.complianceDescribed',
  'evidence.noteNotSigned',
  'backupPrompt.homeScreenIos',
  'evidenceFile.photosDiffer_one',
  'evidenceFile.photosDiffer_other',
  'pdf.evidence.value.notSigned',
])

/**
 * English copy the build spec gives word for word. "ticket" is ambiguous
 * on its own (it can read as a fine notice), so the checks below flag it;
 * these strings keep the spec's wording, and their key names say
 * meterTicket. The translations name a parking ticket explicitly.
 */
const SPEC_COPY = new Set(['logger.proof.addMeterTicketOrPermit', 'evidence.addMeterTicketOrPermit'])

// ── New keys, appended inside their parent object ────────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position). Missing parent objects are created,
// appended at the end of their own parent.
const ADDITIONS = {
  // ── The angle grid (PhotoAngleGrid) ──
  'photoGrid.front': {
    en: 'Front',
    'zh-CN': '车头',
    vi: 'Phía trước',
    id: 'Depan',
    ko: '앞',
    it: 'Davanti',
    el: 'Μπροστά',
    hi: 'आगे का हिस्सा',
    pa: 'ਅਗਲਾ ਪਾਸਾ',
  },
  'photoGrid.rear': {
    en: 'Rear',
    'zh-CN': '车尾',
    vi: 'Phía sau',
    id: 'Belakang',
    ko: '뒤',
    it: 'Dietro',
    el: 'Πίσω',
    hi: 'पीछे का हिस्सा',
    pa: 'ਪਿਛਲਾ ਪਾਸਾ',
  },
  'photoGrid.left': {
    en: 'Left side',
    'zh-CN': '左侧',
    vi: 'Bên trái',
    id: 'Sisi kiri',
    ko: '왼쪽',
    it: 'Lato sinistro',
    el: 'Αριστερή πλευρά',
    hi: 'बायाँ हिस्सा',
    pa: 'ਖੱਬਾ ਪਾਸਾ',
  },
  'photoGrid.right': {
    en: 'Right side',
    'zh-CN': '右侧',
    vi: 'Bên phải',
    id: 'Sisi kanan',
    ko: '오른쪽',
    it: 'Lato destro',
    el: 'Δεξιά πλευρά',
    hi: 'दायाँ हिस्सा',
    pa: 'ਸੱਜਾ ਪਾਸਾ',
  },
  'photoGrid.detail': {
    en: 'Close-up (optional)',
    'zh-CN': '特写（可选）',
    vi: 'Cận cảnh (tùy chọn)',
    id: 'Jarak dekat (opsional)',
    ko: '근접 촬영 (선택 사항)',
    it: 'Dettaglio (facoltativo)',
    el: 'Κοντινό (προαιρετικό)',
    hi: 'क्लोज़-अप (वैकल्पिक)',
    pa: 'ਨੇੜਿਓਂ (ਵਿਕਲਪਿਕ)',
  },
  // The empty tile's accessible name. {{angle}} is one of the tile names above.
  'photoGrid.take': {
    en: 'Take a photo: {{angle}}',
    'zh-CN': '拍照：{{angle}}',
    vi: 'Chụp ảnh: {{angle}}',
    id: 'Ambil foto: {{angle}}',
    ko: '사진 촬영: {{angle}}',
    it: 'Scatta una foto: {{angle}}',
    el: 'Φωτογράφισε: {{angle}}',
    hi: 'फोटो लें: {{angle}}',
    pa: 'ਫੋਟੋ ਲਓ: {{angle}}',
  },
  // A filled tile's Retake button, as read by a screen reader.
  'photoGrid.retake': {
    en: 'Retake: {{angle}}',
    'zh-CN': '重拍：{{angle}}',
    vi: 'Chụp lại: {{angle}}',
    id: 'Foto ulang: {{angle}}',
    ko: '다시 찍기: {{angle}}',
    it: 'Rifai: {{angle}}',
    el: 'Νέα φωτογραφία: {{angle}}',
    hi: 'दोबारा लें: {{angle}}',
    pa: 'ਮੁੜ ਲਓ: {{angle}}',
  },
  'photoGrid.saving': {
    en: 'Saving photo…',
    'zh-CN': '正在保存照片…',
    vi: 'Đang lưu ảnh…',
    id: 'Menyimpan foto…',
    ko: '사진 저장 중…',
    it: 'Salvataggio della foto…',
    el: 'Αποθήκευση φωτογραφίας…',
    hi: 'फोटो सहेजी जा रही है…',
    pa: 'ਫੋਟੋ ਸੰਭਾਲੀ ਜਾ ਰਹੀ ਹੈ…',
  },
  'photoGrid.saved': {
    en: 'Saved on your phone',
    'zh-CN': '已保存在你的手机上',
    vi: 'Đã lưu trên điện thoại của bạn',
    id: 'Tersimpan di ponselmu',
    ko: '휴대폰에 저장됨',
    it: 'Salvata sul telefono',
    el: 'Αποθηκεύτηκε στο κινητό σου',
    hi: 'आपके फ़ोन पर सहेजी गई',
    pa: "ਤੁਹਾਡੇ ਫ਼ੋਨ 'ਤੇ ਸੰਭਾਲੀ ਗਈ",
  },
  'photoGrid.failed': {
    en: "This photo couldn't be saved on your phone.",
    'zh-CN': '这张照片没能保存在你的手机上。',
    vi: 'Không lưu được ảnh này trên điện thoại của bạn.',
    id: 'Foto ini tidak bisa disimpan di ponselmu.',
    ko: '이 사진을 휴대폰에 저장하지 못했습니다.',
    it: 'Non è stato possibile salvare questa foto sul telefono.',
    el: 'Δεν ήταν δυνατή η αποθήκευση αυτής της φωτογραφίας στο κινητό σου.',
    hi: 'यह फोटो आपके फोन पर सहेजी नहीं जा सकी।',
    pa: "ਇਹ ਫੋਟੋ ਤੁਹਾਡੇ ਫ਼ੋਨ 'ਤੇ ਸੰਭਾਲੀ ਨਹੀਂ ਜਾ ਸਕੀ।",
  },
  'photoGrid.hint': {
    en: 'Walk around the car and take a photo of each side. Add a close-up of any damage.',
    'zh-CN': '绕车走一圈，给每一面各拍一张照片。如有损伤，再拍一张特写。',
    vi: 'Đi một vòng quanh xe và chụp mỗi phía một ảnh. Nếu có hư hỏng, chụp thêm ảnh cận cảnh.',
    id: 'Kelilingi mobil dan foto setiap sisinya. Jika ada kerusakan, tambahkan foto jarak dekat.',
    ko: '차 주위를 돌며 각 면을 한 장씩 찍으세요. 손상이 있으면 근접 사진도 추가하세요.',
    it: "Fai il giro dell'auto e scatta una foto per ogni lato. Aggiungi un dettaglio degli eventuali danni.",
    el: 'Κάνε τον γύρο του αυτοκινήτου και βγάλε μια φωτογραφία από κάθε πλευρά. Πρόσθεσε ένα κοντινό για τυχόν ζημιά.',
    hi: 'कार के चारों ओर घूमकर हर तरफ़ की एक फोटो लें। कोई नुकसान हो तो उसकी क्लोज़-अप फोटो भी लें।',
    pa: 'ਕਾਰ ਦੇ ਦੁਆਲੇ ਘੁੰਮ ਕੇ ਹਰ ਪਾਸੇ ਦੀ ਇੱਕ ਫੋਟੋ ਲਓ। ਜੇ ਕੋਈ ਨੁਕਸਾਨ ਹੈ ਤਾਂ ਉਸ ਦੀ ਨੇੜਿਓਂ ਫੋਟੋ ਵੀ ਲਓ।',
  },
  // Item 11, word for word. Shown with every place photos of the car's condition are taken or shown.
  'photoGrid.signedNote': {
    en: "A signed photo shows the photo existed by the time it was signed. It doesn't show who caused any damage.",
    'zh-CN': '已签名的照片表明，这张照片在签名时已经存在。它不能说明损伤是谁造成的。',
    vi: 'Ảnh đã ký cho thấy ảnh này đã tồn tại vào lúc được ký. Nó không cho thấy ai đã gây ra hư hỏng.',
    id: 'Foto yang ditandatangani menunjukkan foto itu sudah ada saat ditandatangani. Foto itu tidak menunjukkan siapa yang menyebabkan kerusakan.',
    ko: '서명된 사진은 서명 시점에 그 사진이 이미 있었다는 것을 보여 줍니다. 누가 손상을 입혔는지는 보여 주지 않습니다.',
    it: 'Una foto firmata mostra che la foto esisteva già al momento della firma. Non mostra chi abbia causato un eventuale danno.',
    el: 'Μια υπογεγραμμένη φωτογραφία δείχνει ότι η φωτογραφία υπήρχε ήδη τη στιγμή της υπογραφής. Δεν δείχνει ποιος προκάλεσε τυχόν ζημιά.',
    hi: 'हस्ताक्षरित फोटो दिखाती है कि हस्ताक्षर के समय तक यह फोटो मौजूद थी। यह नहीं दिखाती कि नुकसान किसने किया।',
    pa: 'ਹਸਤਾਖਰਿਤ ਫੋਟੋ ਦਿਖਾਉਂਦੀ ਹੈ ਕਿ ਹਸਤਾਖਰ ਹੋਣ ਤੱਕ ਇਹ ਫੋਟੋ ਮੌਜੂਦ ਸੀ। ਇਹ ਨਹੀਂ ਦਿਖਾਉਂਦੀ ਕਿ ਨੁਕਸਾਨ ਕਿਸ ਨੇ ਕੀਤਾ।',
  },
  // On a closed section's toggle: how many photos it holds. hi and pa use _one for 0 too.
  'photoGrid.count_one': {
    en: '{{count}} photo',
    'zh-CN': '{{count}} 张照片',
    vi: '{{count}} ảnh',
    id: '{{count}} foto',
    ko: '사진 {{count}}장',
    it: '{{count}} foto',
    el: '{{count}} φωτογραφία',
    hi: '{{count}} फोटो',
    pa: '{{count}} ਫੋਟੋ',
  },
  'photoGrid.count_other': {
    en: '{{count}} photos',
    'zh-CN': '{{count}} 张照片',
    vi: '{{count}} ảnh',
    id: '{{count}} foto',
    ko: '사진 {{count}}장',
    it: '{{count}} foto',
    el: '{{count}} φωτογραφίες',
    hi: '{{count}} फोटो',
    pa: '{{count}} ਫੋਟੋਆਂ',
  },

  // ── The logger: condition and proof sections ──
  'logger.condition.toggle': {
    en: "Record the car's condition (optional)",
    'zh-CN': '记录车况（可选）',
    vi: 'Ghi lại tình trạng xe (tùy chọn)',
    id: 'Catat kondisi mobil (opsional)',
    ko: '차량 상태 기록 (선택 사항)',
    it: "Registra le condizioni dell'auto (facoltativo)",
    el: 'Κατάγραψε την κατάσταση του αυτοκινήτου (προαιρετικό)',
    hi: 'कार की हालत दर्ज करें (वैकल्पिक)',
    pa: 'ਕਾਰ ਦੀ ਹਾਲਤ ਦਰਜ ਕਰੋ (ਵਿਕਲਪਿਕ)',
  },
  'logger.condition.noteLabel': {
    en: 'Damage you noticed',
    'zh-CN': '你注意到的损伤',
    vi: 'Hư hỏng bạn nhận thấy',
    id: 'Kerusakan yang kamu lihat',
    ko: '발견한 손상',
    it: 'Danni che hai notato',
    el: 'Ζημιές που πρόσεξες',
    hi: 'आपको दिखा नुकसान',
    pa: 'ਤੁਹਾਨੂੰ ਦਿਸਿਆ ਨੁਕਸਾਨ',
  },
  'logger.condition.notePlaceholder': {
    en: 'For example, a scratch on the rear bumper',
    'zh-CN': '例如：后保险杠上有一道划痕',
    vi: 'Ví dụ: một vết xước trên cản sau',
    id: 'Misalnya, goresan di bemper belakang',
    ko: '예: 뒤 범퍼의 긁힘',
    it: 'Per esempio, un graffio sul paraurti posteriore',
    el: 'Για παράδειγμα, μια γρατζουνιά στον πίσω προφυλακτήρα',
    hi: 'उदाहरण के लिए, पीछे के बंपर पर खरोंच',
    pa: "ਜਿਵੇਂ, ਪਿਛਲੇ ਬੰਪਰ 'ਤੇ ਝਰੀਟ",
  },
  // The section's heading when a result-screen gate applies (the section is open then).
  'logger.proof.heading': {
    en: 'Proof of payment or permit',
    'zh-CN': '付款或许可证凭证',
    vi: 'Bằng chứng thanh toán hoặc giấy phép',
    id: 'Bukti pembayaran atau izin',
    ko: '결제 또는 허가증 증빙',
    it: 'Prova di pagamento o permesso',
    el: 'Απόδειξη πληρωμής ή άδειας',
    hi: 'भुगतान या परमिट का प्रमाण',
    pa: 'ਭੁਗਤਾਨ ਜਾਂ ਪਰਮਿਟ ਦਾ ਸਬੂਤ',
  },
  // The collapsed toggle when no gate applies.
  'logger.proof.toggle': {
    en: 'Proof of payment or permit (optional)',
    'zh-CN': '付款或许可证凭证（可选）',
    vi: 'Bằng chứng thanh toán hoặc giấy phép (tùy chọn)',
    id: 'Bukti pembayaran atau izin (opsional)',
    ko: '결제 또는 허가증 증빙 (선택 사항)',
    it: 'Prova di pagamento o permesso (facoltativo)',
    el: 'Απόδειξη πληρωμής ή άδειας (προαιρετικό)',
    hi: 'भुगतान या परमिट का प्रमाण (वैकल्पिक)',
    pa: 'ਭੁਗਤਾਨ ਜਾਂ ਪਰਮਿਟ ਦਾ ਸਬੂਤ (ਵਿਕਲਪਿਕ)',
  },
  // The one button (item 4, word for word). "ticket" is the parking (meter) ticket.
  'logger.proof.addMeterTicketOrPermit': {
    en: 'Add a photo of your ticket or permit (optional)',
    'zh-CN': '添加停车票或许可证的照片（可选）',
    vi: 'Thêm ảnh vé đỗ xe hoặc giấy phép của bạn (tùy chọn)',
    id: 'Tambahkan foto tiket parkir atau izinmu (opsional)',
    ko: '주차권 또는 허가증 사진 추가 (선택 사항)',
    it: 'Aggiungi una foto del biglietto del parcheggio o del permesso (facoltativo)',
    el: 'Πρόσθεσε φωτογραφία του εισιτηρίου στάθμευσης ή της άδειάς σου (προαιρετικό)',
    hi: 'अपने पार्किंग टिकट या परमिट की फोटो जोड़ें (वैकल्पिक)',
    pa: 'ਆਪਣੀ ਪਾਰਕਿੰਗ ਟਿਕਟ ਜਾਂ ਪਰਮਿਟ ਦੀ ਫੋਟੋ ਜੋੜੋ (ਵਿਕਲਪਿਕ)',
  },

  // ── Proof photo: library link and type picker ──
  'proof.fromLibrary': {
    en: 'Paid in an app? Add the payment confirmation from your photos',
    'zh-CN': '在应用里付的款？从相册添加付款确认',
    vi: 'Trả tiền qua ứng dụng? Thêm xác nhận thanh toán từ ảnh của bạn',
    id: 'Bayar lewat aplikasi? Tambahkan konfirmasi pembayaran dari galerimu',
    ko: '앱으로 결제했나요? 사진에서 결제 확인 화면을 추가하세요',
    it: "Hai pagato con un'app? Aggiungi la conferma di pagamento dalle tue foto",
    el: 'Πλήρωσες μέσω εφαρμογής; Πρόσθεσε την επιβεβαίωση πληρωμής από τις φωτογραφίες σου',
    hi: 'ऐप से भुगतान किया? अपनी फ़ोटो से भुगतान की पुष्टि जोड़ें',
    pa: 'ਐਪ ਰਾਹੀਂ ਭੁਗਤਾਨ ਕੀਤਾ? ਆਪਣੀਆਂ ਫੋਟੋਆਂ ਵਿੱਚੋਂ ਭੁਗਤਾਨ ਦੀ ਪੁਸ਼ਟੀ ਜੋੜੋ',
  },
  'proof.typeLegend': {
    en: 'What the photo shows',
    'zh-CN': '照片的内容',
    vi: 'Ảnh này cho thấy gì',
    id: 'Isi foto ini',
    ko: '사진 내용',
    it: 'Cosa mostra la foto',
    el: 'Τι δείχνει η φωτογραφία',
    hi: 'फोटो में क्या है',
    pa: 'ਫੋਟੋ ਵਿੱਚ ਕੀ ਹੈ',
  },
  // compliance_type values (meter_ticket, payment_confirmation, permit_displayed, other).
  'complianceType.meterTicket': {
    en: 'Meter ticket on the dash',
    'zh-CN': '仪表台上的停车票',
    vi: 'Vé đỗ xe đặt trên taplo',
    id: 'Tiket parkir di dasbor',
    ko: '대시보드 위 주차권',
    it: 'Biglietto del parchimetro sul cruscotto',
    el: 'Εισιτήριο στάθμευσης στο ταμπλό',
    hi: 'डैशबोर्ड पर पार्किंग टिकट',
    pa: "ਡੈਸ਼ਬੋਰਡ 'ਤੇ ਪਾਰਕਿੰਗ ਟਿਕਟ",
  },
  'complianceType.paymentConfirmation': {
    en: 'Payment confirmation',
    'zh-CN': '付款确认',
    vi: 'Xác nhận thanh toán',
    id: 'Konfirmasi pembayaran',
    ko: '결제 확인',
    it: 'Conferma di pagamento',
    el: 'Επιβεβαίωση πληρωμής',
    hi: 'भुगतान की पुष्टि',
    pa: 'ਭੁਗਤਾਨ ਦੀ ਪੁਸ਼ਟੀ',
  },
  'complianceType.permitDisplayed': {
    en: 'Permit displayed',
    'zh-CN': '已展示的许可证',
    vi: 'Giấy phép được đặt trên xe',
    id: 'Izin dipajang di mobil',
    ko: '차에 비치한 허가증',
    it: 'Permesso esposto',
    el: 'Άδεια σε εμφανές σημείο',
    hi: 'कार में लगा परमिट',
    pa: 'ਕਾਰ ਵਿੱਚ ਲੱਗਿਆ ਪਰਮਿਟ',
  },
  'complianceType.other': {
    en: 'Other',
    'zh-CN': '其他',
    vi: 'Khác',
    id: 'Lainnya',
    ko: '기타',
    it: 'Altro',
    el: 'Άλλο',
    hi: 'अन्य',
    pa: 'ਹੋਰ',
  },

  // ── The departure sheet ──
  'departure.condition.toggle': {
    en: "Record the car's condition now (optional)",
    'zh-CN': '现在记录车况（可选）',
    vi: 'Ghi lại tình trạng xe ngay bây giờ (tùy chọn)',
    id: 'Catat kondisi mobil sekarang (opsional)',
    ko: '지금 차량 상태 기록 (선택 사항)',
    it: "Registra ora le condizioni dell'auto (facoltativo)",
    el: 'Κατάγραψε τώρα την κατάσταση του αυτοκινήτου (προαιρετικό)',
    hi: 'अभी कार की हालत दर्ज करें (वैकल्पिक)',
    pa: 'ਹੁਣ ਕਾਰ ਦੀ ਹਾਲਤ ਦਰਜ ਕਰੋ (ਵਿਕਲਪਿਕ)',
  },

  // ── The record screen: condition and proof photos ──
  'evidence.group.parking': {
    en: 'Condition when parked',
    'zh-CN': '停车时车况',
    vi: 'Tình trạng khi đỗ',
    id: 'Kondisi saat parkir',
    ko: '주차 시 상태',
    it: "Condizioni all'arrivo",
    el: 'Κατάσταση στη στάθμευση',
    hi: 'पार्क करते समय हालत',
    pa: 'ਪਾਰਕ ਕਰਦੇ ਸਮੇਂ ਹਾਲਤ',
  },
  'evidence.group.return': {
    en: 'Condition on return',
    'zh-CN': '返回时车况',
    vi: 'Tình trạng khi quay lại',
    id: 'Kondisi saat kembali',
    ko: '돌아왔을 때 상태',
    it: 'Condizioni al ritorno',
    el: 'Κατάσταση στην επιστροφή',
    hi: 'लौटने पर हालत',
    pa: "ਵਾਪਸ ਆਉਣ 'ਤੇ ਹਾਲਤ",
  },
  'evidence.group.compliance': {
    en: 'Proof of payment or permit',
    'zh-CN': '付款或许可证凭证',
    vi: 'Bằng chứng thanh toán hoặc giấy phép',
    id: 'Bukti pembayaran atau izin',
    ko: '결제 또는 허가증 증빙',
    it: 'Prova di pagamento o permesso',
    el: 'Απόδειξη πληρωμής ή άδειας',
    hi: 'भुगतान या परमिट का प्रमाण',
    pa: 'ਭੁਗਤਾਨ ਜਾਂ ਪਰਮਿਟ ਦਾ ਸਬੂਤ',
  },
  // The driver's own statement, never something the app confirmed.
  'evidence.noteLabel': {
    en: 'Damage you noticed, in your own words',
    'zh-CN': '你注意到的损伤（你自己的描述）',
    vi: 'Hư hỏng bạn nhận thấy, theo lời của bạn',
    id: 'Kerusakan yang kamu lihat, dengan kata-katamu sendiri',
    ko: '발견한 손상 (직접 작성한 내용)',
    it: 'Danni che hai notato, con parole tue',
    el: 'Ζημιές που πρόσεξες, με δικά σου λόγια',
    hi: 'आपको दिखा नुकसान, आपके अपने शब्दों में',
    pa: 'ਤੁਹਾਨੂੰ ਦਿਸਿਆ ਨੁਕਸਾਨ, ਤੁਹਾਡੇ ਆਪਣੇ ਸ਼ਬਦਾਂ ਵਿੱਚ',
  },
  // A phone time: when the photo came into the app.
  'evidence.addedAt': {
    en: 'Added at {{time}} (phone clock).',
    'zh-CN': '于 {{time}} 添加（手机时钟）。',
    vi: 'Thêm lúc {{time}} (đồng hồ điện thoại).',
    id: 'Ditambahkan pada {{time}} (jam ponsel).',
    ko: '{{time}}에 추가됨 (휴대폰 시계).',
    it: 'Aggiunta: {{time}} (orologio del telefono).',
    el: 'Προστέθηκε στις {{time}} (ρολόι κινητού).',
    hi: '{{time}} पर जोड़ी गई (फ़ोन की घड़ी)।',
    pa: "{{time}} 'ਤੇ ਜੋੜੀ ਗਈ (ਫ਼ੋਨ ਦੀ ਘੜੀ)।",
  },
  'evidence.fingerprint': {
    en: 'Fingerprint {{fingerprint}}',
    'zh-CN': '指纹 {{fingerprint}}',
    vi: 'Dấu vân tay số: {{fingerprint}}',
    id: 'Sidik jari: {{fingerprint}}',
    ko: '디지털 지문: {{fingerprint}}',
    it: 'Impronta digitale: {{fingerprint}}',
    el: 'Αποτύπωμα: {{fingerprint}}',
    hi: 'फिंगरप्रिंट: {{fingerprint}}',
    pa: 'ਫਿੰਗਰਪ੍ਰਿੰਟ: {{fingerprint}}',
  },
  // Item 7, word for word.
  'evidence.library': {
    en: 'Added from the photo library. The signature shows when it was added, not when it was taken.',
    'zh-CN': '从相册添加。签名显示的是添加的时间，而不是拍摄的时间。',
    vi: 'Được thêm từ thư viện ảnh. Chữ ký cho thấy thời điểm ảnh được thêm, không phải thời điểm ảnh được chụp.',
    id: 'Ditambahkan dari galeri foto. Tanda tangan menunjukkan kapan foto ditambahkan, bukan kapan foto diambil.',
    ko: '사진 보관함에서 추가했습니다. 서명은 사진을 추가한 시점을 보여 줄 뿐, 촬영한 시점은 보여 주지 않습니다.',
    it: 'Aggiunta dalla libreria foto. La firma mostra quando è stata aggiunta, non quando è stata scattata.',
    el: 'Προστέθηκε από τη βιβλιοθήκη φωτογραφιών. Η υπογραφή δείχνει πότε προστέθηκε, όχι πότε τραβήχτηκε.',
    hi: 'फोटो लाइब्रेरी से जोड़ी गई। हस्ताक्षर दिखाता है कि इसे कब जोड़ा गया, यह नहीं कि इसे कब लिया गया।',
    pa: 'ਫੋਟੋ ਲਾਇਬ੍ਰੇਰੀ ਤੋਂ ਜੋੜੀ ਗਈ। ਹਸਤਾਖਰ ਦਿਖਾਉਂਦਾ ਹੈ ਕਿ ਇਹ ਕਦੋਂ ਜੋੜੀ ਗਈ, ਇਹ ਨਹੀਂ ਕਿ ਕਦੋਂ ਖਿੱਚੀ ਗਈ।',
  },
  // A photo no part of the record carries (for example on a chain this device can't extend).
  'evidence.notSigned': {
    en: "This photo isn't in a signed part of the record.",
    'zh-CN': '这张照片不在记录的任何已签名部分中。',
    vi: 'Ảnh này không nằm trong phần nào đã ký của bản ghi.',
    id: 'Foto ini tidak ada di bagian catatan yang ditandatangani.',
    ko: '이 사진은 기록의 서명된 부분에 포함되어 있지 않습니다.',
    it: 'Questa foto non è in una parte firmata del record.',
    el: "Αυτή η φωτογραφία δεν βρίσκεται σε υπογεγραμμένο μέρος της εγγραφής.",
    hi: 'यह फोटो रिकॉर्ड के किसी हस्ताक्षरित हिस्से में नहीं है।',
    pa: 'ਇਹ ਫੋਟੋ ਰਿਕਾਰਡ ਦੇ ਕਿਸੇ ਹਸਤਾਖਰਿਤ ਹਿੱਸੇ ਵਿੱਚ ਨਹੀਂ ਹੈ।',
  },
  // The bytes-missing state for a photo whose part was refused or which no part carries.
  'evidence.photoNotOnDevice': {
    en: 'Photo not on this device. Fingerprint {{fingerprint}}.',
    'zh-CN': '这台设备上没有这张照片。指纹 {{fingerprint}}。',
    vi: 'Ảnh này không có trên thiết bị này. Dấu vân tay số: {{fingerprint}}.',
    id: 'Foto ini tidak ada di perangkat ini. Sidik jari: {{fingerprint}}.',
    ko: '이 기기에 사진이 없습니다. 디지털 지문: {{fingerprint}}.',
    it: 'Foto non presente su questo dispositivo. Impronta digitale: {{fingerprint}}.',
    el: 'Η φωτογραφία δεν υπάρχει σε αυτή τη συσκευή. Αποτύπωμα: {{fingerprint}}.',
    hi: 'यह फोटो इस डिवाइस पर नहीं है। फिंगरप्रिंट: {{fingerprint}}।',
    pa: "ਇਹ ਫੋਟੋ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਨਹੀਂ ਹੈ। ਫਿੰਗਰਪ੍ਰਿੰਟ: {{fingerprint}}।",
  },
  // After saving, on a record that hasn't ended (item 5).
  'evidence.addCondition': {
    en: 'Add condition photos',
    'zh-CN': '添加车况照片',
    vi: 'Thêm ảnh tình trạng xe',
    id: 'Tambahkan foto kondisi mobil',
    ko: '차량 상태 사진 추가',
    it: 'Aggiungi foto delle condizioni',
    el: 'Πρόσθεσε φωτογραφίες κατάστασης',
    hi: 'कार की हालत की फोटो जोड़ें',
    pa: 'ਕਾਰ ਦੀ ਹਾਲਤ ਦੀਆਂ ਫੋਟੋਆਂ ਜੋੜੋ',
  },
  // Item 5, word for word. "ticket" is the parking (meter) ticket.
  'evidence.addMeterTicketOrPermit': {
    en: 'Add a photo of your ticket or permit',
    'zh-CN': '添加停车票或许可证的照片',
    vi: 'Thêm ảnh vé đỗ xe hoặc giấy phép của bạn',
    id: 'Tambahkan foto tiket parkir atau izinmu',
    ko: '주차권 또는 허가증 사진 추가',
    it: 'Aggiungi una foto del biglietto del parcheggio o del permesso',
    el: 'Πρόσθεσε φωτογραφία του εισιτηρίου στάθμευσης ή της άδειάς σου',
    hi: 'अपने पार्किंग टिकट या परमिट की फोटो जोड़ें',
    pa: 'ਆਪਣੀ ਪਾਰਕਿੰਗ ਟਿਕਟ ਜਾਂ ਪਰਮਿਟ ਦੀ ਫੋਟੋ ਜੋੜੋ',
  },
  'evidence.addIntro': {
    en: "ParkProof signs each photo's fingerprint as a new part of this record. The photos themselves aren't sent for signing.",
    'zh-CN': "ParkProof 会把每张照片的指纹作为这条记录的新部分进行签名。照片本身不会被发送去签名。",
    vi: "ParkProof ký dấu vân tay số của từng ảnh thành một phần mới của bản ghi này. Bản thân các ảnh không được gửi đi để ký.",
    id: "ParkProof menandatangani sidik jari setiap foto sebagai bagian baru dari catatan ini. Fotonya sendiri tidak dikirim untuk ditandatangani.",
    ko: "ParkProof는 각 사진의 디지털 지문을 이 기록의 새 부분으로 서명합니다. 사진 자체는 서명을 위해 전송되지 않습니다.",
    it: "ParkProof firma l'impronta digitale di ogni foto come nuova parte di questo record. Le foto in sé non vengono inviate per la firma.",
    el: "Το ParkProof υπογράφει το αποτύπωμα κάθε φωτογραφίας ως νέο μέρος αυτής της εγγραφής. Οι ίδιες οι φωτογραφίες δεν αποστέλλονται για υπογραφή.",
    hi: "ParkProof हर फोटो के फिंगरप्रिंट पर इस रिकॉर्ड के नए हिस्से के रूप में हस्ताक्षर करता है। फोटो खुद हस्ताक्षर के लिए नहीं भेजी जातीं।",
    pa: "ParkProof ਹਰ ਫੋਟੋ ਦੇ ਫਿੰਗਰਪ੍ਰਿੰਟ 'ਤੇ ਇਸ ਰਿਕਾਰਡ ਦੇ ਨਵੇਂ ਹਿੱਸੇ ਵਜੋਂ ਹਸਤਾਖਰ ਕਰਦਾ ਹੈ। ਫੋਟੋਆਂ ਖੁਦ ਹਸਤਾਖਰ ਲਈ ਨਹੀਂ ਭੇਜੀਆਂ ਜਾਂਦੀਆਂ।",
  },
  'evidence.addToRecord': {
    en: 'Add to record',
    'zh-CN': '添加到记录',
    vi: 'Thêm vào bản ghi',
    id: 'Tambahkan ke catatan',
    ko: '기록에 추가',
    it: 'Aggiungi al record',
    el: "Προσθήκη στην εγγραφή",
    hi: 'रिकॉर्ड में जोड़ें',
    pa: 'ਰਿਕਾਰਡ ਵਿੱਚ ਜੋੜੋ',
  },
  'evidence.adding': {
    en: 'Adding…',
    'zh-CN': '正在添加…',
    vi: 'Đang thêm…',
    id: 'Menambahkan…',
    ko: '추가하는 중…',
    it: 'Aggiunta in corso…',
    el: 'Προσθήκη…',
    hi: 'जोड़ा जा रहा है…',
    pa: 'ਜੋੜਿਆ ਜਾ ਰਿਹਾ ਹੈ…',
  },
  'evidence.needPhoto': {
    en: 'Take at least one photo first.',
    'zh-CN': '请先至少拍一张照片。',
    vi: 'Hãy chụp ít nhất một ảnh trước.',
    id: 'Ambil setidaknya satu foto dulu.',
    ko: '먼저 사진을 한 장 이상 찍으세요.',
    it: 'Prima scatta almeno una foto.',
    el: 'Βγάλε πρώτα τουλάχιστον μία φωτογραφία.',
    hi: 'पहले कम से कम एक फोटो लें।',
    pa: 'ਪਹਿਲਾਂ ਘੱਟੋ-ਘੱਟ ਇੱਕ ਫੋਟੋ ਲਓ।',
  },
  'evidence.needType': {
    en: 'Choose what the photo shows.',
    'zh-CN': '请选择照片的内容。',
    vi: 'Hãy chọn ảnh này cho thấy gì.',
    id: 'Pilih isi foto ini.',
    ko: '사진 내용을 선택하세요.',
    it: 'Scegli cosa mostra la foto.',
    el: 'Διάλεξε τι δείχνει η φωτογραφία.',
    hi: 'चुनें कि फोटो में क्या है।',
    pa: 'ਚੁਣੋ ਕਿ ਫੋਟੋ ਵਿੱਚ ਕੀ ਹੈ।',
  },
  'evidence.addFailed': {
    en: "These photos couldn't be added to the record. Try again.",
    'zh-CN': '这些照片没能添加到记录中。请重试。',
    vi: 'Không thêm được những ảnh này vào bản ghi. Hãy thử lại.',
    id: 'Foto-foto ini tidak bisa ditambahkan ke catatan. Coba lagi.',
    ko: '이 사진들을 기록에 추가하지 못했습니다. 다시 시도하세요.',
    it: 'Non è stato possibile aggiungere queste foto al record. Riprova.',
    el: "Δεν ήταν δυνατή η προσθήκη αυτών των φωτογραφιών στην εγγραφή. Δοκίμασε ξανά.",
    hi: 'ये फोटो रिकॉर्ड में नहीं जोड़ी जा सकीं। फिर से कोशिश करें।',
    pa: 'ਇਹ ਫੋਟੋਆਂ ਰਿਕਾਰਡ ਵਿੱਚ ਨਹੀਂ ਜੋੜੀਆਂ ਜਾ ਸਕੀਆਂ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
  },
  // The record ended (or filled up) while the add sheet was open.
  'evidence.cantAddNow': {
    en: "These photos can't be added now. The record may have ended, or it has no room for another part.",
    'zh-CN': "现在无法添加这些照片。这条记录可能已经结束，或者已经没有空间再添加新的部分。",
    vi: "Hiện không thể thêm những ảnh này. Bản ghi có thể đã kết thúc, hoặc không còn chỗ cho phần mới.",
    id: "Foto-foto ini tidak bisa ditambahkan sekarang. Catatan ini mungkin sudah berakhir, atau tidak ada ruang untuk bagian baru.",
    ko: "지금은 이 사진들을 추가할 수 없습니다. 기록이 이미 끝났거나 새 부분을 추가할 공간이 없을 수 있습니다.",
    it: "Non è possibile aggiungere queste foto ora. Il record potrebbe essere terminato, oppure non ha spazio per un'altra parte.",
    el: "Αυτές οι φωτογραφίες δεν μπορούν να προστεθούν τώρα. Η εγγραφή μπορεί να έχει ολοκληρωθεί ή να μην έχει χώρο για άλλο μέρος.",
    hi: "ये फोटो अभी नहीं जोड़ी जा सकतीं। हो सकता है रिकॉर्ड खत्म हो चुका हो, या उसमें नए हिस्से के लिए जगह न हो।",
    pa: "ਇਹ ਫੋਟੋਆਂ ਹੁਣ ਨਹੀਂ ਜੋੜੀਆਂ ਜਾ ਸਕਦੀਆਂ। ਹੋ ਸਕਦਾ ਹੈ ਰਿਕਾਰਡ ਖਤਮ ਹੋ ਚੁੱਕਾ ਹੋਵੇ, ਜਾਂ ਉਸ ਵਿੱਚ ਨਵੇਂ ਹਿੱਸੇ ਲਈ ਥਾਂ ਨਾ ਹੋਵੇ।",
  },
  // What a proof photo shows is the driver's own statement, never something the app confirmed.
  'evidence.complianceDescribed': {
    en: "{{type}} (as you described it)",
    'zh-CN': "{{type}}（你自己的描述）",
    vi: "{{type}} (theo mô tả của bạn)",
    id: "{{type}} (sesuai keteranganmu)",
    ko: "{{type}} (직접 선택한 내용)",
    it: "{{type}} (secondo la tua descrizione)",
    el: "{{type}} (σύμφωνα με την περιγραφή σου)",
    hi: "{{type}} (आपके बताए अनुसार)",
    pa: "{{type}} (ਤੁਹਾਡੇ ਦੱਸੇ ਅਨੁਸਾਰ)",
  },
  // A damage note no part of the record carries (pending and refused notes use verifier.link.*).
  'evidence.noteNotSigned': {
    en: "This note isn't in a signed part of the record.",
    'zh-CN': "这条备注不在记录的任何已签名部分中。",
    vi: "Ghi chú này không nằm trong phần nào đã ký của bản ghi.",
    id: "Keterangan ini tidak ada di bagian catatan yang ditandatangani.",
    ko: "이 메모는 기록의 서명된 부분에 포함되어 있지 않습니다.",
    it: "Questa nota non è in una parte firmata del record.",
    el: "Αυτή η σημείωση δεν βρίσκεται σε υπογεγραμμένο μέρος της εγγραφής.",
    hi: "यह नोट रिकॉर्ड के किसी हस्ताक्षरित हिस्से में नहीं है।",
    pa: "ਇਹ ਨੋਟ ਰਿਕਾਰਡ ਦੇ ਕਿਸੇ ਹਸਤਾਖਰਿਤ ਹਿੱਸੇ ਵਿੱਚ ਨਹੀਂ ਹੈ।",
  },

  // ── The one-time backup prompt (item 12) ──
  'backupPrompt.title': {
    en: 'Back up your photos',
    'zh-CN': '备份你的照片',
    vi: 'Sao lưu ảnh của bạn',
    id: 'Cadangkan fotomu',
    ko: '사진 백업하기',
    it: 'Fai un backup delle tue foto',
    el: 'Κράτα αντίγραφο των φωτογραφιών σου',
    hi: 'अपनी फोटो का बैकअप लें',
    pa: 'ਆਪਣੀਆਂ ਫੋਟੋਆਂ ਦਾ ਬੈਕਅੱਪ ਲਓ',
  },
  'backupPrompt.body': {
    en: "Your records and their signed photos are kept only in this browser. Safari can clear a site's data after 7 days without a visit.",
    'zh-CN': '你的记录和已签名的照片只保存在这个浏览器里。如果 7 天没有访问，Safari 可能会清除网站的数据。',
    vi: 'Các bản ghi và ảnh đã ký của bạn chỉ được lưu trong trình duyệt này. Safari có thể xóa dữ liệu của một trang web sau 7 ngày không truy cập.',
    id: 'Catatan dan foto bertanda tanganmu hanya disimpan di browser ini. Safari bisa menghapus data situs setelah 7 hari tidak dikunjungi.',
    ko: '기록과 서명된 사진은 이 브라우저에만 저장됩니다. Safari는 7일 동안 방문하지 않은 사이트의 데이터를 지울 수 있습니다.',
    it: 'I tuoi record e le relative foto firmate sono salvati solo in questo browser. Safari può cancellare i dati di un sito dopo 7 giorni senza visite.',
    el: "Οι εγγραφές σου και οι υπογεγραμμένες φωτογραφίες τους φυλάσσονται μόνο σε αυτό το πρόγραμμα περιήγησης. Το Safari μπορεί να διαγράψει τα δεδομένα ενός ιστότοπου μετά από 7 ημέρες χωρίς επίσκεψη.",
    hi: 'आपके रिकॉर्ड और उनकी हस्ताक्षरित फोटो सिर्फ़ इसी ब्राउज़र में रखी हैं। अगर 7 दिन तक साइट न खोली जाए, तो Safari उसका डेटा मिटा सकता है।',
    pa: 'ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਅਤੇ ਉਨ੍ਹਾਂ ਦੀਆਂ ਹਸਤਾਖਰਿਤ ਫੋਟੋਆਂ ਸਿਰਫ਼ ਇਸੇ ਬ੍ਰਾਊਜ਼ਰ ਵਿੱਚ ਰੱਖੀਆਂ ਹਨ। ਜੇ 7 ਦਿਨ ਸਾਈਟ ਨਾ ਖੋਲ੍ਹੀ ਜਾਵੇ, ਤਾਂ Safari ਉਸ ਦਾ ਡੇਟਾ ਮਿਟਾ ਸਕਦਾ ਹੈ।',
  },
  // iPhone and iPad. The menu names quote installPrompt.iosBody in each locale.
  'backupPrompt.homeScreenIos': {
    en: "Add ParkProof to your Home Screen: tap Share, then Add to Home Screen. Records you save from the Home Screen app stay with the app. Records already saved in Safari stay in Safari and don't move to the app.",
    'zh-CN': "把 ParkProof 添加到主屏幕：点击分享按钮，然后选择“添加到主屏幕”。从主屏幕应用保存的记录会留在应用中。已经在 Safari 中保存的记录仍留在 Safari 中，不会转到应用里。",
    vi: "Thêm ParkProof vào Màn hình chính: nhấn Chia sẻ, rồi chọn 'Thêm vào Màn hình chính'. Các bản ghi bạn lưu từ ứng dụng trên Màn hình chính sẽ ở lại trong ứng dụng. Các bản ghi đã lưu trong Safari vẫn ở trong Safari và không chuyển sang ứng dụng.",
    id: "Tambahkan ParkProof ke Layar Utama: ketuk Share, lalu pilih 'Add to Home Screen'. Catatan yang kamu simpan dari aplikasi di Layar Utama tetap ada di aplikasi itu. Catatan yang sudah tersimpan di Safari tetap di Safari dan tidak pindah ke aplikasi.",
    ko: "ParkProof를 홈 화면에 추가하세요. 공유 버튼을 누른 다음 '홈 화면에 추가'를 선택하세요. 홈 화면 앱에서 저장한 기록은 앱에 보관됩니다. Safari에 이미 저장된 기록은 Safari에 남아 있으며 앱으로 옮겨지지 않습니다.",
    it: "Aggiungi ParkProof alla schermata Home: tocca Condividi, poi \"Aggiungi alla schermata Home\". I record che salvi dall'app nella schermata Home restano nell'app. I record già salvati in Safari restano in Safari e non passano all'app.",
    el: "Πρόσθεσε το ParkProof στην οθόνη Αφετηρίας: πάτα Κοινοποίηση και μετά 'Προσθήκη στην οθόνη Αφετηρίας'. Οι εγγραφές που αποθηκεύεις από την εφαρμογή της οθόνης Αφετηρίας μένουν στην εφαρμογή. Οι εγγραφές που έχεις ήδη αποθηκεύσει στο Safari μένουν στο Safari και δεν μεταφέρονται στην εφαρμογή.",
    hi: "ParkProof को अपनी होम स्क्रीन पर जोड़ें: Share पर टैप करें, फिर 'Add to Home Screen' चुनें। होम स्क्रीन ऐप से सहेजे गए रिकॉर्ड उसी ऐप में रहते हैं। Safari में पहले से सहेजे गए रिकॉर्ड Safari में ही रहते हैं और ऐप में नहीं आते।",
    pa: "ParkProof ਨੂੰ ਆਪਣੀ ਹੋਮ ਸਕਰੀਨ 'ਤੇ ਜੋੜੋ: ਸ਼ੇਅਰ 'ਤੇ ਟੈਪ ਕਰੋ, ਫਿਰ 'Add to Home Screen' ਚੁਣੋ। ਹੋਮ ਸਕਰੀਨ ਐਪ ਤੋਂ ਸੰਭਾਲੇ ਰਿਕਾਰਡ ਉਸੇ ਐਪ ਵਿੱਚ ਰਹਿੰਦੇ ਹਨ। Safari ਵਿੱਚ ਪਹਿਲਾਂ ਤੋਂ ਸੰਭਾਲੇ ਰਿਕਾਰਡ Safari ਵਿੱਚ ਹੀ ਰਹਿੰਦੇ ਹਨ ਅਤੇ ਐਪ ਵਿੱਚ ਨਹੀਂ ਜਾਂਦੇ।",
  },
  'backupPrompt.homeScreenOther': {
    en: "Add ParkProof to your Home Screen from your browser's menu (Install app, or Add to Home screen).",
    'zh-CN': '从浏览器菜单把 ParkProof 添加到主屏幕（“安装应用”或“添加到主屏幕”）。',
    vi: "Thêm ParkProof vào Màn hình chính từ menu của trình duyệt ('Cài đặt ứng dụng' hoặc 'Thêm vào Màn hình chính').",
    id: "Tambahkan ParkProof ke Layar Utama dari menu browser ('Instal aplikasi' atau 'Tambahkan ke Layar utama').",
    ko: "브라우저 메뉴에서 ParkProof를 홈 화면에 추가하세요 ('앱 설치' 또는 '홈 화면에 추가').",
    it: 'Aggiungi ParkProof alla schermata Home dal menu del browser ("Installa app" o "Aggiungi a schermata Home").',
    el: "Πρόσθεσε το ParkProof στην αρχική οθόνη από το μενού του προγράμματος περιήγησης ('Εγκατάσταση εφαρμογής' ή 'Προσθήκη στην αρχική οθόνη').",
    hi: "अपने ब्राउज़र के मेन्यू से ParkProof को होम स्क्रीन पर जोड़ें ('Install app' या 'Add to Home screen')।",
    pa: "ਆਪਣੇ ਬ੍ਰਾਊਜ਼ਰ ਦੇ ਮੀਨੂ ਤੋਂ ParkProof ਨੂੰ ਹੋਮ ਸਕਰੀਨ 'ਤੇ ਜੋੜੋ ('Install app' ਜਾਂ 'Add to Home screen')।",
  },
  'backupPrompt.signIn': {
    en: 'Sign in to back up',
    'zh-CN': '登录以备份',
    vi: 'Đăng nhập để sao lưu',
    id: 'Masuk untuk mencadangkan',
    ko: '로그인하여 백업',
    it: 'Accedi per fare il backup',
    el: 'Συνδέσου για αντίγραφο ασφαλείας',
    hi: 'बैकअप के लिए साइन इन करें',
    pa: 'ਬੈਕਅੱਪ ਲਈ ਸਾਈਨ ਇਨ ਕਰੋ',
  },
  'backupPrompt.dismiss': {
    en: 'Not now',
    'zh-CN': '以后再说',
    vi: 'Để sau',
    id: 'Nanti saja',
    ko: '나중에',
    it: 'Non ora',
    el: 'Όχι τώρα',
    hi: 'अभी नहीं',
    pa: 'ਹੁਣੇ ਨਹੀਂ',
  },
  // ── Items 8 to 10: the record screen's evidence file and the PDF ──
  // Every pdf.* string here uses only characters the committed PDF font
  // subsets already have (pdf-font-coverage.test.ts), so no subset had to
  // be rebuilt and no other branch's fonts are touched. That is why some
  // PDF twins differ from their screen strings (zh-CN 车况问题 for 损伤,
  // 放在车内显眼处 for 仪表台; ko 적은 for 쓴, 일치해야 for 같아야).
  'evidenceFile.download': {
    en: 'Download evidence file',
    'zh-CN': '下载证据文件',
    vi: 'Tải tệp bằng chứng',
    id: 'Unduh berkas bukti',
    ko: '증거 파일 다운로드',
    it: 'Scarica il file delle prove',
    el: 'Λήψη αρχείου αποδεικτικών',
    hi: 'साक्ष्य फ़ाइल डाउनलोड करें',
    pa: 'ਸਬੂਤ ਫ਼ਾਈਲ ਡਾਊਨਲੋਡ ਕਰੋ',
  },
  'evidenceFile.busy': {
    en: 'Preparing the file…',
    'zh-CN': '正在准备文件…',
    vi: 'Đang chuẩn bị tệp…',
    id: 'Menyiapkan berkas…',
    ko: '파일 준비 중…',
    it: 'Preparazione del file…',
    el: 'Προετοιμασία αρχείου…',
    hi: 'फ़ाइल तैयार की जा रही है…',
    pa: 'ਫ਼ਾਈਲ ਤਿਆਰ ਕੀਤੀ ਜਾ ਰਹੀ ਹੈ…',
  },
  'evidenceFile.help': {
    en: "A .json file with every signature and the original photos, so anyone can check this record without ParkProof. A signature shows the details haven't changed since ParkProof signed them. It doesn't show they're true, who was driving, where the car was, or when it arrived or left. The file contains the location and times saved in this record, so share it only with people who need it.",
    'zh-CN': "一个 .json 文件，包含所有签名和原始照片，任何人都可以不用 ParkProof 核对这条记录。签名只表明这些详情自 ParkProof 签名以来没有改动。它不能说明这些内容属实，也不能说明是谁在开车、车停在哪里，或车辆何时到达、何时离开。文件包含这条记录中保存的位置和时间，所以只发给需要的人。",
    vi: "Một tệp .json gồm mọi chữ ký và các ảnh gốc, để bất kỳ ai cũng có thể kiểm tra bản ghi này mà không cần ParkProof. Chữ ký cho thấy các thông tin chưa thay đổi kể từ khi ParkProof ký. Chữ ký không cho thấy các thông tin đó là đúng, ai là người lái xe, xe ở đâu, hay xe đến và rời đi lúc nào. Tệp chứa vị trí và thời gian đã lưu trong bản ghi này, nên chỉ chia sẻ với người cần đến nó.",
    id: "Berkas .json berisi semua tanda tangan dan foto asli, sehingga siapa pun bisa mengecek catatan ini tanpa ParkProof. Tanda tangan menunjukkan detailnya tidak berubah sejak ditandatangani ParkProof. Tanda tangan tidak menunjukkan bahwa isinya benar, siapa yang mengemudi, di mana mobil berada, atau kapan mobil tiba atau pergi. Berkas ini memuat lokasi dan waktu yang tersimpan di catatan ini, jadi bagikan hanya kepada orang yang memerlukannya.",
    ko: "모든 서명과 원본 사진이 담긴 .json 파일로, 누구나 ParkProof 없이 이 기록을 확인할 수 있습니다. 서명은 ParkProof가 서명한 이후 내용이 바뀌지 않았음을 보여 줍니다. 그 내용이 사실인지, 누가 운전했는지, 차가 어디에 있었는지, 언제 도착하거나 떠났는지는 보여 주지 않습니다. 이 기록에 저장된 위치와 시간이 들어 있으므로 꼭 필요한 사람에게만 공유하세요.",
    it: "Un file .json con tutte le firme e le foto originali, così chiunque può verificare questo record senza ParkProof. Una firma mostra che i dati non sono cambiati da quando ParkProof li ha firmati. Non mostra che siano veri, chi guidava, dove si trovava l'auto, né quando è arrivata o partita. Il file contiene il luogo e gli orari salvati in questo record, quindi condividilo solo con chi ne ha bisogno.",
    el: "Ένα αρχείο .json με όλες τις υπογραφές και τις πρωτότυπες φωτογραφίες, ώστε οποιοσδήποτε να μπορεί να ελέγξει αυτή την εγγραφή χωρίς το ParkProof. Μια υπογραφή δείχνει ότι τα στοιχεία δεν έχουν αλλάξει από τότε που τα υπέγραψε το ParkProof. Δεν δείχνει ότι είναι αληθινά, ποιος οδηγούσε, πού ήταν το αυτοκίνητο ή πότε έφτασε ή έφυγε. Το αρχείο περιέχει την τοποθεσία και τις ώρες που είναι αποθηκευμένες σε αυτή την εγγραφή, γι' αυτό μοιράσου το μόνο με όσους το χρειάζονται.",
    hi: "एक .json फ़ाइल, जिसमें हर हस्ताक्षर और मूल फ़ोटो हैं, ताकि कोई भी ParkProof के बिना इस रिकॉर्ड की जाँच कर सके। हस्ताक्षर दिखाता है कि ParkProof के हस्ताक्षर करने के बाद से विवरण नहीं बदला है। यह नहीं दिखाता कि विवरण सच है, चालक कौन था, कार कहाँ थी, या वह कब पहुँची या कब गई। फ़ाइल में इस रिकॉर्ड में सहेजी गई जगह और समय हैं, इसलिए इसे सिर्फ़ उन्हीं से साझा करें जिन्हें इसकी ज़रूरत है।",
    pa: "ਇੱਕ .json ਫ਼ਾਈਲ, ਜਿਸ ਵਿੱਚ ਹਰ ਹਸਤਾਖਰ ਅਤੇ ਅਸਲ ਫੋਟੋਆਂ ਹਨ, ਤਾਂ ਜੋ ਕੋਈ ਵੀ ParkProof ਤੋਂ ਬਿਨਾਂ ਇਸ ਰਿਕਾਰਡ ਦੀ ਜਾਂਚ ਕਰ ਸਕੇ। ਹਸਤਾਖਰ ਦਿਖਾਉਂਦਾ ਹੈ ਕਿ ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਵੇਰਵੇ ਨਹੀਂ ਬਦਲੇ। ਇਹ ਨਹੀਂ ਦਿਖਾਉਂਦਾ ਕਿ ਵੇਰਵੇ ਸੱਚ ਹਨ, ਡਰਾਈਵਰ ਕੌਣ ਸੀ, ਕਾਰ ਕਿੱਥੇ ਸੀ, ਜਾਂ ਉਹ ਕਦੋਂ ਪਹੁੰਚੀ ਜਾਂ ਗਈ। ਫ਼ਾਈਲ ਵਿੱਚ ਇਸ ਰਿਕਾਰਡ ਵਿੱਚ ਸੰਭਾਲੀ ਗਈ ਥਾਂ ਅਤੇ ਸਮੇਂ ਹਨ, ਇਸ ਲਈ ਇਸ ਨੂੰ ਸਿਰਫ਼ ਉਨ੍ਹਾਂ ਨਾਲ ਸਾਂਝਾ ਕਰੋ ਜਿਨ੍ਹਾਂ ਨੂੰ ਇਸ ਦੀ ਲੋੜ ਹੈ।",
  },
  'evidenceFile.includePermit': {
    en: 'Include permit details',
    'zh-CN': '包含许可证详情',
    vi: 'Bao gồm thông tin giấy phép',
    id: 'Sertakan detail izin',
    ko: '허가증 정보 포함',
    it: 'Includi i dettagli del permesso',
    el: 'Συμπερίληψη στοιχείων άδειας',
    hi: 'परमिट का विवरण शामिल करें',
    pa: 'ਪਰਮਿਟ ਦੇ ਵੇਰਵੇ ਸ਼ਾਮਲ ਕਰੋ',
  },
  'evidenceFile.permitHelp': {
    en: "Your permit details, and any photo marked \"Permit displayed\", are only in the file if you tick this. The signed record holds only their fingerprints, which they can be checked against. Accessible permit details are health information.",
    'zh-CN': "只有勾选此项，文件中才会包含你的许可证详情，以及标为“已展示的许可证”的照片。已签名的记录只保存它们的指纹，可以用它们来核对。无障碍停车许可证的详情属于健康信息。",
    vi: "Thông tin giấy phép của bạn, và mọi ảnh được đánh dấu là 'Giấy phép được đặt trên xe', chỉ có trong tệp nếu bạn đánh dấu ô này. Bản ghi đã ký chỉ giữ dấu vân tay số của chúng, có thể dùng để đối chiếu. Thông tin về giấy phép đỗ xe tiếp cận là thông tin sức khỏe.",
    id: "Detail izinmu, dan foto apa pun yang ditandai 'Izin dipajang di mobil', hanya masuk ke berkas jika kamu mencentang ini. Catatan yang ditandatangani hanya menyimpan sidik jarinya, yang bisa dipakai untuk mencocokkannya. Detail izin parkir aksesibel adalah informasi kesehatan.",
    ko: "이 항목을 선택해야만 허가증 정보와 '차에 비치한 허가증'으로 표시한 사진이 파일에 들어갑니다. 서명된 기록에는 그 디지털 지문만 담겨 있으며, 이를 대조해 확인할 수 있습니다. 장애인 주차 허가증 정보는 건강 정보입니다.",
    it: "I dettagli del permesso, e ogni foto indicata come \"Permesso esposto\", sono nel file solo se selezioni questa opzione. Il record firmato contiene solo le loro impronte digitali, con cui si possono confrontare. I dettagli del permesso di parcheggio accessibile sono informazioni sanitarie.",
    el: "Τα στοιχεία της άδειάς σου, και κάθε φωτογραφία που έχει σημειωθεί ως 'Άδεια σε εμφανές σημείο', μπαίνουν στο αρχείο μόνο αν το επιλέξεις. Η υπογεγραμμένη εγγραφή κρατά μόνο τα αποτυπώματά τους, με τα οποία μπορούν να συγκριθούν. Τα στοιχεία άδειας προσβάσιμης στάθμευσης είναι πληροφορίες υγείας.",
    hi: "आपके परमिट का विवरण, और 'कार में लगा परमिट' के रूप में चिह्नित कोई भी फ़ोटो, फ़ाइल में तभी होंगे जब आप इसे चुनेंगे। हस्ताक्षरित रिकॉर्ड में इनका सिर्फ़ फिंगरप्रिंट होता है, जिससे इनका मिलान किया जा सकता है। सुलभ पार्किंग परमिट का विवरण स्वास्थ्य जानकारी है।",
    pa: "ਤੁਹਾਡੇ ਪਰਮਿਟ ਦੇ ਵੇਰਵੇ, ਅਤੇ 'ਕਾਰ ਵਿੱਚ ਲੱਗਿਆ ਪਰਮਿਟ' ਵਜੋਂ ਚਿੰਨ੍ਹਿਤ ਕੋਈ ਵੀ ਫੋਟੋ, ਫ਼ਾਈਲ ਵਿੱਚ ਤਾਂ ਹੀ ਹੋਣਗੇ ਜੇ ਤੁਸੀਂ ਇਸ ਨੂੰ ਚੁਣੋਗੇ। ਹਸਤਾਖਰਿਤ ਰਿਕਾਰਡ ਵਿੱਚ ਇਨ੍ਹਾਂ ਦਾ ਸਿਰਫ਼ ਫਿੰਗਰਪ੍ਰਿੰਟ ਹੁੰਦਾ ਹੈ, ਜਿਸ ਨਾਲ ਇਨ੍ਹਾਂ ਦਾ ਮਿਲਾਨ ਕੀਤਾ ਜਾ ਸਕਦਾ ਹੈ। ਪਹੁੰਚਯੋਗ ਪਾਰਕਿੰਗ ਪਰਮਿਟ ਦੇ ਵੇਰਵੇ ਸਿਹਤ ਸੰਬੰਧੀ ਜਾਣਕਾਰੀ ਹਨ।",
  },
  'evidenceFile.error': {
    en: 'The evidence file couldn\'t be made. Try again.',
    'zh-CN': '无法生成证据文件。请重试。',
    vi: 'Không thể tạo tệp bằng chứng. Hãy thử lại.',
    id: 'Berkas bukti tidak bisa dibuat. Coba lagi.',
    ko: '증거 파일을 만들 수 없었습니다. 다시 시도하세요.',
    it: 'Non è stato possibile creare il file delle prove. Riprova.',
    el: 'Δεν ήταν δυνατή η δημιουργία του αρχείου αποδεικτικών. Δοκίμασε ξανά.',
    hi: 'साक्ष्य फ़ाइल नहीं बन सकी। फिर से कोशिश करें।',
    pa: 'ਸਬੂਤ ਫ਼ਾਈਲ ਨਹੀਂ ਬਣ ਸਕੀ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
  },
  'evidenceFile.photosMissing_one': {
    en: '{{count}} signed photo isn\'t on this device, so it isn\'t in the file. Its signed fingerprint is.',
    'zh-CN': '有 {{count}} 张已签名的照片不在这台设备上，所以文件中没有这张照片，只有它已签名的指纹。',
    vi: '{{count}} ảnh đã ký không có trên thiết bị này nên không có trong tệp. Tệp chỉ có dấu vân tay số đã ký của ảnh.',
    id: '{{count}} foto yang ditandatangani tidak ada di perangkat ini, jadi fotonya tidak ada di berkas. Sidik jarinya yang ditandatangani ada di berkas.',
    ko: '서명된 사진 {{count}}장이 이 기기에 없어 파일에 들어가지 않았습니다. 서명된 디지털 지문은 파일에 있습니다.',
    it: '{{count}} foto firmata non è su questo dispositivo, quindi non è nel file. La sua impronta digitale firmata sì.',
    el: '{{count}} υπογεγραμμένη φωτογραφία δεν βρίσκεται σε αυτή τη συσκευή, οπότε δεν είναι στο αρχείο. Το υπογεγραμμένο αποτύπωμά της είναι.',
    hi: '{{count}} हस्ताक्षरित फ़ोटो इस डिवाइस पर नहीं है, इसलिए वह फ़ाइल में नहीं है। उसका हस्ताक्षरित फिंगरप्रिंट फ़ाइल में है।',
    pa: '{{count}} ਹਸਤਾਖਰਿਤ ਫੋਟੋ ਇਸ ਡਿਵਾਈਸ \'ਤੇ ਨਹੀਂ ਹੈ, ਇਸ ਲਈ ਉਹ ਫ਼ਾਈਲ ਵਿੱਚ ਨਹੀਂ ਹੈ। ਉਸ ਦਾ ਹਸਤਾਖਰਿਤ ਫਿੰਗਰਪ੍ਰਿੰਟ ਫ਼ਾਈਲ ਵਿੱਚ ਹੈ।',
  },
  'evidenceFile.photosMissing_other': {
    en: '{{count}} signed photos aren\'t on this device, so they aren\'t in the file. Their signed fingerprints are.',
    'zh-CN': '有 {{count}} 张已签名的照片不在这台设备上，所以文件中没有这些照片，只有它们已签名的指纹。',
    vi: '{{count}} ảnh đã ký không có trên thiết bị này nên không có trong tệp. Tệp chỉ có dấu vân tay số đã ký của các ảnh.',
    id: '{{count}} foto yang ditandatangani tidak ada di perangkat ini, jadi fotonya tidak ada di berkas. Sidik jarinya yang ditandatangani ada di berkas.',
    ko: '서명된 사진 {{count}}장이 이 기기에 없어 파일에 들어가지 않았습니다. 서명된 디지털 지문은 파일에 있습니다.',
    it: '{{count}} foto firmate non sono su questo dispositivo, quindi non sono nel file. Le loro impronte digitali firmate sì.',
    el: '{{count}} υπογεγραμμένες φωτογραφίες δεν βρίσκονται σε αυτή τη συσκευή, οπότε δεν είναι στο αρχείο. Τα υπογεγραμμένα αποτυπώματά τους είναι.',
    hi: '{{count}} हस्ताक्षरित फ़ोटो इस डिवाइस पर नहीं हैं, इसलिए वे फ़ाइल में नहीं हैं। उनके हस्ताक्षरित फिंगरप्रिंट फ़ाइल में हैं।',
    pa: '{{count}} ਹਸਤਾਖਰਿਤ ਫੋਟੋਆਂ ਇਸ ਡਿਵਾਈਸ \'ਤੇ ਨਹੀਂ ਹਨ, ਇਸ ਲਈ ਉਹ ਫ਼ਾਈਲ ਵਿੱਚ ਨਹੀਂ ਹਨ। ਉਨ੍ਹਾਂ ਦੇ ਹਸਤਾਖਰਿਤ ਫਿੰਗਰਪ੍ਰਿੰਟ ਫ਼ਾਈਲ ਵਿੱਚ ਹਨ।',
  },
  // Bytes on the device that hash to something other than the signed fingerprint (differ_from_fingerprint).
  'evidenceFile.photosDiffer_one': {
    en: "{{count}} photo on this device doesn't match its signed fingerprint, so it isn't in the file. Its signed fingerprint is.",
    'zh-CN': "这台设备上有 {{count}} 张照片与它已签名的指纹不一致，所以文件中没有这张照片，只有它已签名的指纹。",
    vi: "{{count}} ảnh trên thiết bị này không khớp với dấu vân tay số đã ký của nó nên không có trong tệp. Tệp chỉ có dấu vân tay số đã ký của ảnh.",
    id: "{{count}} foto di perangkat ini tidak cocok dengan sidik jarinya yang ditandatangani, jadi fotonya tidak ada di berkas. Sidik jarinya yang ditandatangani ada di berkas.",
    ko: "이 기기의 사진 {{count}}장이 서명된 디지털 지문과 일치하지 않아 파일에 들어가지 않았습니다. 서명된 디지털 지문은 파일에 있습니다.",
    it: "{{count}} foto su questo dispositivo non corrisponde alla sua impronta digitale firmata, quindi non è nel file. La sua impronta digitale firmata sì.",
    el: "{{count}} φωτογραφία σε αυτή τη συσκευή δεν ταιριάζει με το υπογεγραμμένο αποτύπωμά της, οπότε δεν είναι στο αρχείο. Το υπογεγραμμένο αποτύπωμά της είναι.",
    hi: "इस डिवाइस पर {{count}} फ़ोटो अपने हस्ताक्षरित फिंगरप्रिंट से मेल नहीं खाती, इसलिए वह फ़ाइल में नहीं है। उसका हस्ताक्षरित फिंगरप्रिंट फ़ाइल में है।",
    pa: "ਇਸ ਡਿਵਾਈਸ 'ਤੇ {{count}} ਫੋਟੋ ਆਪਣੇ ਹਸਤਾਖਰਿਤ ਫਿੰਗਰਪ੍ਰਿੰਟ ਨਾਲ ਮੇਲ ਨਹੀਂ ਖਾਂਦੀ, ਇਸ ਲਈ ਉਹ ਫ਼ਾਈਲ ਵਿੱਚ ਨਹੀਂ ਹੈ। ਉਸ ਦਾ ਹਸਤਾਖਰਿਤ ਫਿੰਗਰਪ੍ਰਿੰਟ ਫ਼ਾਈਲ ਵਿੱਚ ਹੈ।",
  },
  'evidenceFile.photosDiffer_other': {
    en: "{{count}} photos on this device don't match their signed fingerprints, so they aren't in the file. Their signed fingerprints are.",
    'zh-CN': "这台设备上有 {{count}} 张照片与它们已签名的指纹不一致，所以文件中没有这些照片，只有它们已签名的指纹。",
    vi: "{{count}} ảnh trên thiết bị này không khớp với dấu vân tay số đã ký của chúng nên không có trong tệp. Tệp chỉ có dấu vân tay số đã ký của các ảnh.",
    id: "{{count}} foto di perangkat ini tidak cocok dengan sidik jarinya yang ditandatangani, jadi fotonya tidak ada di berkas. Sidik jarinya yang ditandatangani ada di berkas.",
    ko: "이 기기의 사진 {{count}}장이 서명된 디지털 지문과 일치하지 않아 파일에 들어가지 않았습니다. 서명된 디지털 지문은 파일에 있습니다.",
    it: "{{count}} foto su questo dispositivo non corrispondono alle loro impronte digitali firmate, quindi non sono nel file. Le loro impronte digitali firmate sì.",
    el: "{{count}} φωτογραφίες σε αυτή τη συσκευή δεν ταιριάζουν με τα υπογεγραμμένα αποτυπώματά τους, οπότε δεν είναι στο αρχείο. Τα υπογεγραμμένα αποτυπώματά τους είναι.",
    hi: "इस डिवाइस पर {{count}} फ़ोटो अपने हस्ताक्षरित फिंगरप्रिंट से मेल नहीं खातीं, इसलिए वे फ़ाइल में नहीं हैं। उनके हस्ताक्षरित फिंगरप्रिंट फ़ाइल में हैं।",
    pa: "ਇਸ ਡਿਵਾਈਸ 'ਤੇ {{count}} ਫੋਟੋਆਂ ਆਪਣੇ ਹਸਤਾਖਰਿਤ ਫਿੰਗਰਪ੍ਰਿੰਟਾਂ ਨਾਲ ਮੇਲ ਨਹੀਂ ਖਾਂਦੀਆਂ, ਇਸ ਲਈ ਉਹ ਫ਼ਾਈਲ ਵਿੱਚ ਨਹੀਂ ਹਨ। ਉਨ੍ਹਾਂ ਦੇ ਹਸਤਾਖਰਿਤ ਫਿੰਗਰਪ੍ਰਿੰਟ ਫ਼ਾਈਲ ਵਿੱਚ ਹਨ।",
  },
  'pdf.evidence.field.proof': {
    en: 'Proof of payment or permit',
    'zh-CN': '付款或许可证凭证',
    vi: 'Bằng chứng thanh toán hoặc giấy phép',
    id: 'Bukti pembayaran atau izin',
    ko: '결제 또는 허가증 증빙',
    it: 'Prova di pagamento o permesso',
    el: 'Απόδειξη πληρωμής ή άδειας',
    hi: 'भुगतान या परमिट का प्रमाण',
    pa: 'ਭੁਗਤਾਨ ਜਾਂ ਪਰਮਿਟ ਦਾ ਸਬੂਤ',
  },
  'pdf.evidence.field.conditionPhotos': {
    en: 'Car condition photos',
    'zh-CN': '车况照片',
    vi: 'Ảnh tình trạng xe',
    id: 'Foto kondisi mobil',
    ko: '차량 상태 사진',
    it: 'Foto delle condizioni dell\'auto',
    el: 'Φωτογραφίες κατάστασης αυτοκινήτου',
    hi: 'कार की हालत की फ़ोटो',
    pa: 'ਕਾਰ ਦੀ ਹਾਲਤ ਦੀਆਂ ਫੋਟੋਆਂ',
  },
  'pdf.evidence.field.damageNote': {
    en: 'Damage the driver noted',
    'zh-CN': '驾驶员注明的车况问题',
    vi: 'Hư hỏng tài xế ghi nhận',
    id: 'Kerusakan yang dicatat pengemudi',
    ko: '운전자가 적은 손상',
    it: 'Danni annotati dal conducente',
    el: 'Ζημιές που σημείωσε ο οδηγός',
    hi: 'चालक द्वारा नोट किया गया नुकसान',
    pa: 'ਡਰਾਈਵਰ ਵੱਲੋਂ ਨੋਟ ਕੀਤਾ ਨੁਕਸਾਨ',
  },
  'pdf.evidence.value.complianceDescribed': {
    en: '{{type}} (as the driver described it)',
    'zh-CN': '{{type}}(按驾驶员的描述)',
    vi: '{{type}} (theo mô tả của tài xế)',
    id: '{{type}} (menurut keterangan pengemudi)',
    ko: '{{type}} (운전자가 밝힌 내용)',
    it: '{{type}} (come descritto dal conducente)',
    el: '{{type}} (όπως το περιέγραψε ο οδηγός)',
    hi: '{{type}} (जैसा चालक ने बताया)',
    pa: '{{type}} (ਜਿਵੇਂ ਡਰਾਈਵਰ ਨੇ ਦੱਸਿਆ)',
  },
  'pdf.evidence.value.complianceNoType': {
    en: 'A photo was added. The driver didn\'t say what it shows.',
    'zh-CN': '已添加一张照片。驾驶员没有说明照片的内容。',
    vi: 'Đã thêm một ảnh. Tài xế không nói ảnh cho thấy gì.',
    id: 'Sebuah foto ditambahkan. Pengemudi tidak menyebutkan isi foto itu.',
    ko: '사진이 추가되었습니다. 운전자가 사진의 내용을 밝히지 않았습니다.',
    it: 'È stata aggiunta una foto. Il conducente non ha indicato cosa mostra.',
    el: 'Προστέθηκε μια φωτογραφία. Ο οδηγός δεν είπε τι δείχνει.',
    hi: 'एक फ़ोटो जोड़ी गई। चालक ने नहीं बताया कि उसमें क्या है।',
    pa: 'ਇੱਕ ਫੋਟੋ ਜੋੜੀ ਗਈ। ਡਰਾਈਵਰ ਨੇ ਨਹੀਂ ਦੱਸਿਆ ਕਿ ਉਸ ਵਿੱਚ ਕੀ ਹੈ।',
  },
  'pdf.evidence.value.conditionCounts': {
    en: 'When parked: {{parking}}. On return: {{returned}}.',
    'zh-CN': '停车时:{{parking}} 张。返回时:{{returned}} 张。',
    vi: 'Khi đỗ: {{parking}}. Khi quay lại: {{returned}}.',
    id: 'Saat parkir: {{parking}}. Saat kembali: {{returned}}.',
    ko: '주차 시: {{parking}}장. 돌아왔을 때: {{returned}}장.',
    it: 'All\'arrivo: {{parking}}. Al ritorno: {{returned}}.',
    el: 'Στη στάθμευση: {{parking}}. Στην επιστροφή: {{returned}}.',
    hi: 'पार्क करते समय: {{parking}}। लौटने पर: {{returned}}।',
    pa: 'ਪਾਰਕ ਕਰਦੇ ਸਮੇਂ: {{parking}}। ਵਾਪਸ ਆਉਣ \'ਤੇ: {{returned}}।',
  },
  'pdf.evidence.value.noteWhenParked': {
    en: 'When parked, in the driver\'s own words: {{note}}',
    'zh-CN': '停车时，驾驶员的原话:{{note}}',
    vi: 'Khi đỗ, theo lời của tài xế: {{note}}',
    id: 'Saat parkir, dengan kata-kata pengemudi sendiri: {{note}}',
    ko: '주차 시, 운전자가 직접 적은 내용: {{note}}',
    it: 'All\'arrivo, con le parole del conducente: {{note}}',
    el: 'Στη στάθμευση, με τα λόγια του οδηγού: {{note}}',
    hi: 'पार्क करते समय, चालक के अपने शब्दों में: {{note}}',
    pa: 'ਪਾਰਕ ਕਰਦੇ ਸਮੇਂ, ਡਰਾਈਵਰ ਦੇ ਆਪਣੇ ਸ਼ਬਦਾਂ ਵਿੱਚ: {{note}}',
  },
  'pdf.evidence.value.noteOnReturn': {
    en: 'On return, in the driver\'s own words: {{note}}',
    'zh-CN': '返回时，驾驶员的原话:{{note}}',
    vi: 'Khi quay lại, theo lời của tài xế: {{note}}',
    id: 'Saat kembali, dengan kata-kata pengemudi sendiri: {{note}}',
    ko: '돌아왔을 때, 운전자가 직접 적은 내용: {{note}}',
    it: 'Al ritorno, con le parole del conducente: {{note}}',
    el: 'Στην επιστροφή, με τα λόγια του οδηγού: {{note}}',
    hi: 'लौटने पर, चालक के अपने शब्दों में: {{note}}',
    pa: 'ਵਾਪਸ ਆਉਣ \'ਤੇ, ਡਰਾਈਵਰ ਦੇ ਆਪਣੇ ਸ਼ਬਦਾਂ ਵਿੱਚ: {{note}}',
  },
  'pdf.evidence.value.notSignedYet': {
    en: '(not signed yet)',
    'zh-CN': '(尚未签名)',
    vi: '(chưa được ký)',
    id: '(belum ditandatangani)',
    ko: '(아직 서명되지 않음)',
    it: '(non ancora firmato)',
    el: '(δεν έχει υπογραφεί ακόμα)',
    hi: '(अभी हस्ताक्षर नहीं हुआ है)',
    pa: '(ਅਜੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ)',
  },
  'pdf.evidence.value.partRejected': {
    en: '(this part couldn\'t be signed)',
    'zh-CN': '(这部分无法签名)',
    vi: '(không thể ký phần này)',
    id: '(bagian ini tidak bisa ditandatangani)',
    ko: '(이 부분은 서명할 수 없었음)',
    it: '(non è stato possibile firmare questa parte)',
    el: '(αυτό το τμήμα δεν μπόρεσε να υπογραφεί)',
    hi: '(इस हिस्से पर हस्ताक्षर नहीं हो सका)',
    pa: '(ਇਸ ਹਿੱਸੇ \'ਤੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋ ਸਕੇ)',
  },
  // A value no part of the record carries (as against one waiting to be signed).
  'pdf.evidence.value.notSigned': {
    en: "(not signed)",
    'zh-CN': "(未签名)",
    vi: "(không được ký)",
    id: "(tidak ditandatangani)",
    ko: "(서명되지 않음)",
    it: "(non firmato)",
    el: "(δεν έχει υπογραφεί)",
    hi: "(हस्ताक्षर नहीं हुआ है)",
    pa: "(ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ)",
  },
  'pdf.complianceType.meterTicket': {
    en: 'Meter ticket on the dash',
    'zh-CN': '放在车内显眼处的停车票',
    vi: 'Vé đỗ xe đặt trên taplo',
    id: 'Tiket parkir di dasbor',
    ko: '대시보드 위 주차권',
    it: 'Biglietto del parchimetro sul cruscotto',
    el: 'Εισιτήριο στάθμευσης στο ταμπλό',
    hi: 'डैशबोर्ड पर पार्किंग टिकट',
    pa: 'ਡੈਸ਼ਬੋਰਡ \'ਤੇ ਪਾਰਕਿੰਗ ਟਿਕਟ',
  },
  'pdf.complianceType.paymentConfirmation': {
    en: 'Payment confirmation',
    'zh-CN': '付款确认',
    vi: 'Xác nhận thanh toán',
    id: 'Konfirmasi pembayaran',
    ko: '결제 확인',
    it: 'Conferma di pagamento',
    el: 'Επιβεβαίωση πληρωμής',
    hi: 'भुगतान की पुष्टि',
    pa: 'ਭੁਗਤਾਨ ਦੀ ਪੁਸ਼ਟੀ',
  },
  'pdf.complianceType.permitDisplayed': {
    en: 'Permit displayed',
    'zh-CN': '已展示的许可证',
    vi: 'Giấy phép được đặt trên xe',
    id: 'Izin dipajang di mobil',
    ko: '차에 비치한 허가증',
    it: 'Permesso esposto',
    el: 'Άδεια σε εμφανές σημείο',
    hi: 'कार में लगा परमिट',
    pa: 'ਕਾਰ ਵਿੱਚ ਲੱਗਿਆ ਪਰਮਿਟ',
  },
  'pdf.complianceType.other': {
    en: 'Other',
    'zh-CN': '其他',
    vi: 'Khác',
    id: 'Lainnya',
    ko: '기타',
    it: 'Altro',
    el: 'Άλλο',
    hi: 'अन्य',
    pa: 'ਹੋਰ',
  },
  'pdf.photos.complianceHeader': {
    en: 'Proof of payment or permit',
    'zh-CN': '付款或许可证凭证',
    vi: 'Bằng chứng thanh toán hoặc giấy phép',
    id: 'Bukti pembayaran atau izin',
    ko: '결제 또는 허가증 증빙',
    it: 'Prova di pagamento o permesso',
    el: 'Απόδειξη πληρωμής ή άδειας',
    hi: 'भुगतान या परमिट का प्रमाण',
    pa: 'ਭੁਗਤਾਨ ਜਾਂ ਪਰਮਿਟ ਦਾ ਸਬੂਤ',
  },
  'pdf.photos.conditionHeader': {
    en: 'Car condition photos',
    'zh-CN': '车况照片',
    vi: 'Ảnh tình trạng xe',
    id: 'Foto kondisi mobil',
    ko: '차량 상태 사진',
    it: 'Foto delle condizioni dell\'auto',
    el: 'Φωτογραφίες κατάστασης αυτοκινήτου',
    hi: 'कार की हालत की फ़ोटो',
    pa: 'ਕਾਰ ਦੀ ਹਾਲਤ ਦੀਆਂ ਫੋਟੋਆਂ',
  },
  'pdf.photos.whenParked': {
    en: 'When parked',
    'zh-CN': '停车时',
    vi: 'Khi đỗ',
    id: 'Saat parkir',
    ko: '주차 시',
    it: 'All\'arrivo',
    el: 'Στη στάθμευση',
    hi: 'पार्क करते समय',
    pa: 'ਪਾਰਕ ਕਰਦੇ ਸਮੇਂ',
  },
  'pdf.photos.onReturn': {
    en: 'On return',
    'zh-CN': '返回时',
    vi: 'Khi quay lại',
    id: 'Saat kembali',
    ko: '돌아왔을 때',
    it: 'Al ritorno',
    el: 'Στην επιστροφή',
    hi: 'लौटने पर',
    pa: 'ਵਾਪਸ ਆਉਣ \'ਤੇ',
  },
  'pdf.photos.role.front': {
    en: 'Front',
    'zh-CN': '车头',
    vi: 'Phía trước',
    id: 'Depan',
    ko: '앞',
    it: 'Davanti',
    el: 'Μπροστά',
    hi: 'आगे का हिस्सा',
    pa: 'ਅਗਲਾ ਪਾਸਾ',
  },
  'pdf.photos.role.rear': {
    en: 'Rear',
    'zh-CN': '车尾',
    vi: 'Phía sau',
    id: 'Belakang',
    ko: '뒤',
    it: 'Dietro',
    el: 'Πίσω',
    hi: 'पीछे का हिस्सा',
    pa: 'ਪਿਛਲਾ ਪਾਸਾ',
  },
  'pdf.photos.role.left': {
    en: 'Left side',
    'zh-CN': '左侧',
    vi: 'Bên trái',
    id: 'Sisi kiri',
    ko: '왼쪽',
    it: 'Lato sinistro',
    el: 'Αριστερή πλευρά',
    hi: 'बायाँ हिस्सा',
    pa: 'ਖੱਬਾ ਪਾਸਾ',
  },
  'pdf.photos.role.right': {
    en: 'Right side',
    'zh-CN': '右侧',
    vi: 'Bên phải',
    id: 'Sisi kanan',
    ko: '오른쪽',
    it: 'Lato destro',
    el: 'Δεξιά πλευρά',
    hi: 'दायाँ हिस्सा',
    pa: 'ਸੱਜਾ ਪਾਸਾ',
  },
  'pdf.photos.role.detail': {
    en: 'Close-up',
    'zh-CN': '特写',
    vi: 'Cận cảnh',
    id: 'Jarak dekat',
    ko: '근접 촬영',
    it: 'Dettaglio',
    el: 'Κοντινό',
    hi: 'क्लोज़-अप',
    pa: 'ਨੇੜਿਓਂ',
  },
  'pdf.photos.added': {
    en: 'Added {{time}} (phone clock)',
    'zh-CN': '添加于 {{time}}(手机时钟)',
    vi: 'Thêm lúc {{time}} (đồng hồ điện thoại)',
    id: 'Ditambahkan {{time}} (jam ponsel)',
    ko: '{{time}}에 추가됨 (휴대폰 시계)',
    it: 'Aggiunta: {{time}} (orologio del telefono)',
    el: 'Προστέθηκε στις {{time}} (ρολόι κινητού)',
    hi: '{{time}} पर जोड़ी गई (फ़ोन की घड़ी)',
    pa: '{{time}} \'ਤੇ ਜੋੜੀ ਗਈ (ਫ਼ੋਨ ਦੀ ਘੜੀ)',
  },
  'pdf.photos.library': {
    en: 'Added from the photo library. The signature shows when it was added, not when it was taken.',
    'zh-CN': '从相册添加。签名显示的是添加的时间，而不是拍摄的时间。',
    vi: 'Được thêm từ thư viện ảnh. Chữ ký cho thấy thời điểm ảnh được thêm, không phải thời điểm ảnh được chụp.',
    id: 'Ditambahkan dari galeri foto. Tanda tangan menunjukkan kapan foto ditambahkan, bukan kapan foto diambil.',
    ko: '사진 보관함에서 추가했습니다. 서명은 사진을 추가한 시점을 보여 줄 뿐, 촬영한 시점은 보여 주지 않습니다.',
    it: 'Aggiunta dalla libreria foto. La firma mostra quando è stata aggiunta, non quando è stata scattata.',
    el: 'Προστέθηκε από τη βιβλιοθήκη φωτογραφιών. Η υπογραφή δείχνει πότε προστέθηκε, όχι πότε τραβήχτηκε.',
    hi: 'फ़ोटो लाइब्रेरी से जोड़ी गई। हस्ताक्षर दिखाता है कि इसे कब जोड़ा गया, यह नहीं कि इसे कब लिया गया।',
    pa: 'ਫੋਟੋ ਲਾਇਬ੍ਰੇਰੀ ਤੋਂ ਜੋੜੀ ਗਈ। ਹਸਤਾਖਰ ਦਿਖਾਉਂਦਾ ਹੈ ਕਿ ਇਹ ਕਦੋਂ ਜੋੜੀ ਗਈ, ਇਹ ਨਹੀਂ ਕਿ ਕਦੋਂ ਖਿੱਚੀ ਗਈ।',
  },
  'pdf.photos.signedAt': {
    en: 'Fingerprint signed by ParkProof at {{time}} (server clock)',
    'zh-CN': 'ParkProof 于 {{time}} 签名了指纹(服务器时钟)',
    vi: 'ParkProof đã ký dấu vân tay số lúc {{time}} (đồng hồ máy chủ)',
    id: 'Sidik jari ditandatangani ParkProof pada {{time}} (jam server)',
    ko: 'ParkProof가 {{time}}에 디지털 지문에 서명함 (서버 시계)',
    it: 'Impronta digitale firmata da ParkProof: {{time}} (orologio del server)',
    el: 'Το αποτύπωμα υπογράφηκε από το ParkProof στις {{time}} (ρολόι διακομιστή)',
    hi: 'ParkProof ने {{time}} पर फिंगरप्रिंट पर हस्ताक्षर किए (सर्वर की घड़ी)',
    pa: 'ParkProof ਨੇ {{time}} \'ਤੇ ਫਿੰਗਰਪ੍ਰਿੰਟ \'ਤੇ ਹਸਤਾਖਰ ਕੀਤੇ (ਸਰਵਰ ਦੀ ਘੜੀ)',
  },
  'pdf.photos.devKey': {
    en: 'Fingerprint signed with a development key at {{time}}. It can\'t be checked with ParkProof\'s published key.',
    'zh-CN': '指纹于 {{time}} 使用开发密钥签名。无法用 ParkProof 公布的公钥核验。',
    vi: 'Dấu vân tay số được ký bằng khóa phát triển lúc {{time}}. Không thể kiểm tra bằng khóa công khai mà ParkProof đã công bố.',
    id: 'Sidik jari ditandatangani dengan kunci pengembangan pada {{time}}. Tidak bisa dicek dengan kunci publik yang diterbitkan ParkProof.',
    ko: '{{time}}에 개발용 키로 디지털 지문에 서명함. ParkProof가 공개한 키로는 확인할 수 없습니다.',
    it: 'Impronta digitale firmata con una chiave di sviluppo: {{time}}. Non si può verificare con la chiave pubblicata da ParkProof.',
    el: 'Το αποτύπωμα υπογράφηκε με κλειδί ανάπτυξης στις {{time}}. Δεν μπορεί να ελεγχθεί με το δημοσιευμένο κλειδί του ParkProof.',
    hi: '{{time}} पर डेवलपमेंट कुंजी से फिंगरप्रिंट पर हस्ताक्षर हुए। इसे ParkProof की प्रकाशित कुंजी से जांचा नहीं जा सकता।',
    pa: '{{time}} \'ਤੇ ਡਿਵੈਲਪਮੈਂਟ ਕੁੰਜੀ ਨਾਲ ਫਿੰਗਰਪ੍ਰਿੰਟ \'ਤੇ ਹਸਤਾਖਰ ਹੋਏ। ਇਸ ਨੂੰ ParkProof ਦੀ ਪ੍ਰਕਾਸ਼ਿਤ ਕੁੰਜੀ ਨਾਲ ਜਾਂਚਿਆ ਨਹੀਂ ਜਾ ਸਕਦਾ।',
  },
  'pdf.photos.notSignedYet': {
    en: 'Fingerprint not signed yet',
    'zh-CN': '指纹尚未签名',
    vi: 'Dấu vân tay số chưa được ký',
    id: 'Sidik jari belum ditandatangani',
    ko: '디지털 지문이 아직 서명되지 않음',
    it: 'Impronta digitale non ancora firmata',
    el: 'Το αποτύπωμα δεν έχει υπογραφεί ακόμα',
    hi: 'फिंगरप्रिंट पर अभी हस्ताक्षर नहीं हुआ है',
    pa: 'ਫਿੰਗਰਪ੍ਰਿੰਟ \'ਤੇ ਅਜੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ',
  },
  'pdf.photos.notSigned': {
    en: 'Fingerprint not signed',
    'zh-CN': '指纹未签名',
    vi: 'Dấu vân tay số không được ký',
    id: 'Sidik jari tidak ditandatangani',
    ko: '디지털 지문이 서명되지 않음',
    it: 'Impronta digitale non firmata',
    el: 'Το αποτύπωμα δεν έχει υπογραφεί',
    hi: 'फिंगरप्रिंट पर हस्ताक्षर नहीं हुआ है',
    pa: 'ਫਿੰਗਰਪ੍ਰਿੰਟ \'ਤੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ',
  },
  'pdf.photos.rejected': {
    en: 'This part couldn\'t be signed',
    'zh-CN': '这部分无法签名',
    vi: 'Không thể ký phần này',
    id: 'Bagian ini tidak bisa ditandatangani',
    ko: '이 부분은 서명할 수 없었습니다',
    it: 'Non è stato possibile firmare questa parte',
    el: 'Αυτό το τμήμα δεν μπόρεσε να υπογραφεί',
    hi: 'इस हिस्से पर हस्ताक्षर नहीं हो सका',
    pa: 'ਇਸ ਹਿੱਸੇ \'ਤੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋ ਸਕੇ',
  },
  'pdf.photos.signedNote': {
    en: 'A signed photo shows the photo existed by the time it was signed. It doesn\'t show who caused any damage.',
    'zh-CN': '已签名的照片表明，这张照片在签名时已经存在。它不能说明车况问题是谁造成的。',
    vi: 'Ảnh đã ký cho thấy ảnh này đã tồn tại vào lúc được ký. Nó không cho thấy ai đã gây ra hư hỏng.',
    id: 'Foto yang ditandatangani menunjukkan foto itu sudah ada saat ditandatangani. Foto itu tidak menunjukkan siapa yang menyebabkan kerusakan.',
    ko: '서명된 사진은 서명 시점에 그 사진이 이미 있었다는 것을 보여 줍니다. 누가 손상을 입혔는지는 보여 주지 않습니다.',
    it: 'Una foto firmata mostra che la foto esisteva già al momento della firma. Non mostra chi abbia causato un eventuale danno.',
    el: 'Μια υπογεγραμμένη φωτογραφία δείχνει ότι η φωτογραφία υπήρχε ήδη τη στιγμή της υπογραφής. Δεν δείχνει ποιος προκάλεσε τυχόν ζημιά.',
    hi: 'हस्ताक्षरित फ़ोटो दिखाती है कि हस्ताक्षर के समय तक यह फ़ोटो मौजूद थी। यह नहीं दिखाती कि नुकसान किसने किया।',
    pa: 'ਹਸਤਾਖਰਿਤ ਫੋਟੋ ਦਿਖਾਉਂਦੀ ਹੈ ਕਿ ਹਸਤਾਖਰ ਹੋਣ ਤੱਕ ਇਹ ਫੋਟੋ ਮੌਜੂਦ ਸੀ। ਇਹ ਨਹੀਂ ਦਿਖਾਉਂਦੀ ਕਿ ਨੁਕਸਾਨ ਕਿਸ ਨੇ ਕੀਤਾ।',
  },
  'pdf.signature.verifyPhotoMatch': {
    en: 'The hex value must equal that photo\'s sha256 inside a signed payload above, not just the sha256 next to it in the evidence file, which isn\'t signed. Step 6 showed the signed values have not changed since ParkProof signed them. Do the same for each photo.',
    'zh-CN': '这个十六进制值必须等于上方某个已签名负载中这张照片的 sha256，而不只是证据文件中与照片一起列出的 sha256，后者没有签名。第 6 步已经表明已签名的值自 ParkProof 签名以来没有改动。对每张照片都这样做。',
    vi: 'Giá trị hex này phải bằng sha256 của ảnh đó trong một payload đã ký ở trên, chứ không chỉ bằng sha256 đặt cạnh ảnh trong tệp bằng chứng, vốn không được ký. Bước 6 đã cho thấy các giá trị đã ký không thay đổi kể từ khi ParkProof ký. Làm như vậy với từng ảnh.',
    id: 'Nilai hex itu harus sama dengan sha256 foto tersebut di dalam payload yang ditandatangani di atas, bukan hanya sha256 di sebelahnya dalam berkas bukti, yang tidak ditandatangani. Langkah 6 sudah menunjukkan nilai yang ditandatangani tidak berubah sejak ParkProof menandatanganinya. Lakukan hal yang sama untuk setiap foto.',
    ko: '이 16진수 값은 위의 서명된 페이로드에 있는 해당 사진의 sha256과 일치해야 합니다. 증거 파일에서 사진 옆에 있는 sha256은 서명되지 않았으므로 그것과만 비교해서는 안 됩니다. 6단계에서 서명된 값이 ParkProof의 서명 이후 변경되지 않았음을 보여 주었습니다. 각 사진을 이 방법으로 확인하세요.',
    it: 'Il valore esadecimale deve essere uguale allo sha256 di quella foto in un payload firmato qui sopra, non solo allo sha256 accanto alla foto nel file delle prove, che non è firmato. Il passaggio 6 ha mostrato che i valori firmati non sono cambiati da quando ParkProof li ha firmati. Fai lo stesso per ogni foto.',
    el: 'Η δεκαεξαδική τιμή πρέπει να είναι ίση με το sha256 αυτής της φωτογραφίας μέσα σε ένα υπογεγραμμένο payload παραπάνω, όχι μόνο με το sha256 δίπλα της στο αρχείο αποδεικτικών, το οποίο δεν είναι υπογεγραμμένο. Το βήμα 6 έδειξε ότι οι υπογεγραμμένες τιμές δεν έχουν αλλάξει από τότε που τις υπέγραψε το ParkProof. Κάνε το ίδιο για κάθε φωτογραφία.',
    hi: 'यह हेक्स मान ऊपर किसी हस्ताक्षरित पेलोड में उस फ़ोटो के sha256 के बराबर होना चाहिए, न कि सिर्फ़ साक्ष्य फ़ाइल में उसके पास लिखे sha256 के, जिस पर हस्ताक्षर नहीं है। चरण 6 ने दिखाया कि हस्ताक्षरित मान ParkProof के हस्ताक्षर करने के बाद से नहीं बदले हैं। हर फ़ोटो के लिए यही करें।',
    pa: 'ਇਹ ਹੈਕਸ ਮੁੱਲ ਉੱਪਰ ਕਿਸੇ ਹਸਤਾਖਰਿਤ ਪੇਲੋਡ ਵਿੱਚ ਉਸ ਫੋਟੋ ਦੇ sha256 ਦੇ ਬਰਾਬਰ ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ, ਨਾ ਕਿ ਸਿਰਫ਼ ਸਬੂਤ ਫ਼ਾਈਲ ਵਿੱਚ ਉਸ ਦੇ ਕੋਲ ਲਿਖੇ sha256 ਦੇ, ਜਿਸ \'ਤੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹਨ। ਕਦਮ 6 ਨੇ ਦਿਖਾਇਆ ਕਿ ਹਸਤਾਖਰਿਤ ਮੁੱਲ ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਨਹੀਂ ਬਦਲੇ। ਹਰ ਫੋਟੋ ਲਈ ਇਹੀ ਕਰੋ।',
  },
  'pdf.signature.verifyWindows': {
    en: 'On Windows, cmd and PowerShell have no base64 -d. Use certutil -decode in its place, and certutil -hashfile to print a file\'s SHA-256, as below. In PowerShell, type curl.exe in place of curl. openssl comes with Git for Windows, and its Git Bash runs the commands above as written.',
    'zh-CN': '在 Windows 上，cmd 和 PowerShell 没有 base64 -d。请改用 certutil -decode，并用 certutil -hashfile 打印文件的 SHA-256，如下所示。在 PowerShell 中，请输入 curl.exe 而不是 curl。Git for Windows 自带 openssl，它的 Git Bash 也可以按原样运行上面的命令。',
    vi: 'Trên Windows, cmd và PowerShell không có base64 -d. Hãy dùng certutil -decode thay thế, và dùng certutil -hashfile để in SHA-256 của một tệp, như bên dưới. Trong PowerShell, hãy gõ curl.exe thay cho curl. openssl đi kèm Git for Windows, và Git Bash của nó chạy được các lệnh ở trên đúng như đã viết.',
    id: 'Di Windows, cmd dan PowerShell tidak punya base64 -d. Gunakan certutil -decode sebagai gantinya, dan certutil -hashfile untuk mencetak SHA-256 sebuah berkas, seperti di bawah. Di PowerShell, ketik curl.exe sebagai ganti curl. openssl disertakan dalam Git for Windows, dan Git Bash-nya menjalankan perintah di atas persis seperti tertulis.',
    ko: 'Windows의 cmd와 PowerShell에는 base64 -d가 없습니다. 아래처럼 대신 certutil -decode를 사용하고, 파일의 SHA-256을 출력하려면 certutil -hashfile을 사용하세요. PowerShell에서는 curl 대신 curl.exe를 입력하세요. openssl은 Git for Windows에 포함되어 있으며, Git Bash에서는 위의 명령을 그대로 실행할 수 있습니다.',
    it: 'Su Windows, cmd e PowerShell non hanno base64 -d. Usa al suo posto certutil -decode, e certutil -hashfile per stampare lo SHA-256 di un file, come qui sotto. In PowerShell, digita curl.exe al posto di curl. openssl è incluso in Git for Windows, e il suo Git Bash esegue i comandi qui sopra così come sono scritti.',
    el: 'Στα Windows, το cmd και το PowerShell δεν έχουν base64 -d. Χρησιμοποίησε στη θέση του το certutil -decode, και το certutil -hashfile για να τυπώσεις το SHA-256 ενός αρχείου, όπως παρακάτω. Στο PowerShell, πληκτρολόγησε curl.exe αντί για curl. Το openssl περιλαμβάνεται στο Git for Windows, και το Git Bash του τρέχει τις παραπάνω εντολές όπως είναι γραμμένες.',
    hi: 'Windows पर cmd और PowerShell में base64 -d नहीं होता। उसकी जगह certutil -decode का उपयोग करें, और किसी फ़ाइल का SHA-256 दिखाने के लिए certutil -hashfile का, जैसा नीचे दिया है। PowerShell में curl की जगह curl.exe टाइप करें। openssl, Git for Windows के साथ आता है, और उसका Git Bash ऊपर दिए कमांड वैसे ही चलाता है जैसे लिखे हैं।',
    pa: 'Windows \'ਤੇ cmd ਅਤੇ PowerShell ਵਿੱਚ base64 -d ਨਹੀਂ ਹੁੰਦਾ। ਉਸ ਦੀ ਥਾਂ certutil -decode ਵਰਤੋ, ਅਤੇ ਕਿਸੇ ਫ਼ਾਈਲ ਦਾ SHA-256 ਦਿਖਾਉਣ ਲਈ certutil -hashfile, ਜਿਵੇਂ ਹੇਠਾਂ ਦਿੱਤਾ ਹੈ। PowerShell ਵਿੱਚ curl ਦੀ ਥਾਂ curl.exe ਟਾਈਪ ਕਰੋ। openssl, Git for Windows ਨਾਲ ਆਉਂਦਾ ਹੈ, ਅਤੇ ਉਸ ਦਾ Git Bash ਉੱਪਰ ਦਿੱਤੀਆਂ ਕਮਾਂਡਾਂ ਨੂੰ ਉਵੇਂ ਹੀ ਚਲਾਉਂਦਾ ਹੈ ਜਿਵੇਂ ਲਿਖੀਆਂ ਹਨ।',
  },
}

// ── Existing strings this task rewrites (explicit overwrite list) ───────
// Each must already exist in every locale; the script aborts otherwise.
const OVERWRITES = {
  'pdf.signature.verifyStep7': {
    en: '7. About the photos: the images printed in this PDF are copies, re-encoded for the document, so their bytes differ from the originals and won\'t match the signed fingerprints. That is expected and isn\'t a sign of tampering. The signed payloads carry the SHA-256 of each original photo: sign_photo_sha256, car_photo_sha256 and ambient_photo_sha256 in link 0, and each sha256 under photos, photo or return_photos in later links. The originals are in the record\'s evidence file, a .json file the driver can download from the record in ParkProof. To check a photo, save its bytes_base64 value from that file as photo1.b64, then decode it and print its SHA-256:',
    'zh-CN': '7. 关于照片:本 PDF 中打印的图像是为文档重新编码的副本，其字节与原始文件不同，因此与已签名的指纹不一致。这是正常的，并不表示被篡改。已签名的负载带有每张原始照片的 SHA-256:环节 0 中的 sign_photo_sha256、car_photo_sha256 和 ambient_photo_sha256，以及后续环节中 photos、photo 或 return_photos 下的每个 sha256。原始照片在这条记录的证据文件中，这是驾驶员可以在 ParkProof 的记录页面下载的 .json 文件。要核对一张照片，请把该文件中这张照片的 bytes_base64 值保存为 photo1.b64，然后解码并打印它的 SHA-256:',
    vi: '7. Về ảnh: các hình in trong tệp PDF này là bản sao, được mã hóa lại cho tài liệu, nên các byte của chúng khác với bản gốc và sẽ không khớp với dấu vân tay số đã ký. Đây là điều bình thường, không phải dấu hiệu bị giả mạo. Các payload đã ký mang SHA-256 của từng ảnh gốc: sign_photo_sha256, car_photo_sha256 và ambient_photo_sha256 trong mắt xích 0, và từng sha256 trong photos, photo hoặc return_photos ở các mắt xích sau. Ảnh gốc nằm trong tệp bằng chứng của bản ghi, một tệp .json mà tài xế có thể tải về từ bản ghi trong ParkProof. Để kiểm tra một ảnh, hãy lưu giá trị bytes_base64 của ảnh đó từ tệp này thành photo1.b64, rồi giải mã và in SHA-256 của nó:',
    id: '7. Tentang foto: gambar yang dicetak dalam PDF ini adalah salinan yang dikodekan ulang untuk dokumen, sehingga byte-nya berbeda dari aslinya dan tidak akan cocok dengan sidik jari yang ditandatangani. Itu wajar dan bukan tanda pemalsuan. Payload yang ditandatangani memuat SHA-256 setiap foto asli: sign_photo_sha256, car_photo_sha256, dan ambient_photo_sha256 di mata rantai 0, serta setiap sha256 di bawah photos, photo, atau return_photos di mata rantai berikutnya. Foto aslinya ada di berkas bukti catatan ini, berkas .json yang bisa diunduh pengemudi dari catatan di ParkProof. Untuk mengecek sebuah foto, simpan nilai bytes_base64 foto itu dari berkas tersebut sebagai photo1.b64, lalu dekode dan cetak SHA-256-nya:',
    ko: '7. 사진에 관하여: 이 PDF에 인쇄된 이미지는 문서용으로 다시 인코딩된 사본이므로 바이트가 원본과 달라 서명된 디지털 지문과 일치하지 않습니다. 이는 정상이며 변조의 징후가 아닙니다. 서명된 페이로드에는 각 원본 사진의 SHA-256이 들어 있습니다. 링크 0의 sign_photo_sha256, car_photo_sha256, ambient_photo_sha256, 그리고 이후 링크의 photos, photo, return_photos 아래 각 sha256입니다. 원본 사진은 이 기록의 증거 파일에 있습니다. 운전자가 ParkProof의 기록 화면에서 다운로드할 수 있는 .json 파일입니다. 사진을 확인하려면 그 파일에서 해당 사진의 bytes_base64 값을 photo1.b64로 저장한 다음, 디코딩하고 SHA-256을 출력하세요:',
    it: '7. Riguardo alle foto: le immagini stampate in questo PDF sono copie, ricodificate per il documento, quindi i loro byte differiscono dagli originali e non corrisponderanno alle impronte digitali firmate. È normale e non è segno di manomissione. I payload firmati contengono lo SHA-256 di ogni foto originale: sign_photo_sha256, car_photo_sha256 e ambient_photo_sha256 nell\'anello 0, e ogni sha256 sotto photos, photo o return_photos negli anelli successivi. Gli originali sono nel file delle prove del record, un file .json che il conducente può scaricare dal record in ParkProof. Per verificare una foto, salva il suo valore bytes_base64 da quel file come photo1.b64, poi decodificalo e stampa il suo SHA-256:',
    el: '7. Σχετικά με τις φωτογραφίες: οι εικόνες που τυπώνονται σε αυτό το PDF είναι αντίγραφα, επανακωδικοποιημένα για το έγγραφο, επομένως τα bytes τους διαφέρουν από τα πρωτότυπα και δεν θα ταιριάξουν με τα υπογεγραμμένα αποτυπώματα. Αυτό είναι αναμενόμενο και δεν αποτελεί ένδειξη παραποίησης. Τα υπογεγραμμένα payload περιέχουν το SHA-256 κάθε πρωτότυπης φωτογραφίας: τα sign_photo_sha256, car_photo_sha256 και ambient_photo_sha256 στον κρίκο 0, και κάθε sha256 κάτω από τα photos, photo ή return_photos στους επόμενους κρίκους. Τα πρωτότυπα βρίσκονται στο αρχείο αποδεικτικών της εγγραφής, ένα αρχείο .json που ο οδηγός μπορεί να κατεβάσει από την εγγραφή στο ParkProof. Για να ελέγξεις μια φωτογραφία, αποθήκευσε την τιμή bytes_base64 της από εκείνο το αρχείο ως photo1.b64 και έπειτα αποκωδικοποίησέ την και τύπωσε το SHA-256 της:',
    hi: '7. फ़ोटो के बारे में: इस PDF में छपी छवियाँ दस्तावेज़ के लिए फिर से एन्कोड की गई प्रतियाँ हैं, इसलिए उनके बाइट्स मूल से भिन्न हैं और हस्ताक्षरित फिंगरप्रिंट से मेल नहीं खाएँगे। यह सामान्य है और छेड़छाड़ का संकेत नहीं है। हस्ताक्षरित पेलोड में हर मूल फ़ोटो का SHA-256 होता है: कड़ी 0 में sign_photo_sha256, car_photo_sha256 और ambient_photo_sha256, और बाद की कड़ियों में photos, photo या return_photos के नीचे हर sha256। मूल फ़ोटो इस रिकॉर्ड की साक्ष्य फ़ाइल में हैं, जो एक .json फ़ाइल है जिसे ParkProof में रिकॉर्ड से डाउनलोड किया जा सकता है। किसी फ़ोटो की जाँच के लिए, उस फ़ाइल से उसका bytes_base64 मान photo1.b64 के रूप में सहेजें, फिर उसे डिकोड करें और उसका SHA-256 दिखाएँ:',
    pa: '7. ਫੋਟੋਆਂ ਬਾਰੇ: ਇਸ PDF ਵਿੱਚ ਛਪੀਆਂ ਤਸਵੀਰਾਂ ਦਸਤਾਵੇਜ਼ ਲਈ ਮੁੜ-ਏਨਕੋਡ ਕੀਤੀਆਂ ਨਕਲਾਂ ਹਨ, ਇਸ ਲਈ ਉਨ੍ਹਾਂ ਦੀਆਂ ਬਾਈਟਾਂ ਅਸਲ ਨਾਲੋਂ ਵੱਖਰੀਆਂ ਹਨ ਅਤੇ ਹਸਤਾਖਰਿਤ ਫਿੰਗਰਪ੍ਰਿੰਟਾਂ ਨਾਲ ਮੇਲ ਨਹੀਂ ਖਾਣਗੀਆਂ। ਇਹ ਸਧਾਰਨ ਹੈ ਅਤੇ ਛੇੜਛਾੜ ਦਾ ਸੰਕੇਤ ਨਹੀਂ। ਹਸਤਾਖਰਿਤ ਪੇਲੋਡਾਂ ਵਿੱਚ ਹਰ ਅਸਲ ਫੋਟੋ ਦਾ SHA-256 ਹੁੰਦਾ ਹੈ: ਕੜੀ 0 ਵਿੱਚ sign_photo_sha256, car_photo_sha256 ਅਤੇ ambient_photo_sha256, ਅਤੇ ਬਾਅਦ ਦੀਆਂ ਕੜੀਆਂ ਵਿੱਚ photos, photo ਜਾਂ return_photos ਹੇਠ ਹਰ sha256। ਅਸਲ ਫੋਟੋਆਂ ਇਸ ਰਿਕਾਰਡ ਦੀ ਸਬੂਤ ਫ਼ਾਈਲ ਵਿੱਚ ਹਨ, ਜੋ ਇੱਕ .json ਫ਼ਾਈਲ ਹੈ ਜਿਸ ਨੂੰ ParkProof ਵਿੱਚ ਰਿਕਾਰਡ ਤੋਂ ਡਾਊਨਲੋਡ ਕੀਤਾ ਜਾ ਸਕਦਾ ਹੈ। ਕਿਸੇ ਫੋਟੋ ਦੀ ਜਾਂਚ ਲਈ, ਉਸ ਫ਼ਾਈਲ ਵਿੱਚੋਂ ਉਸ ਦਾ bytes_base64 ਮੁੱਲ photo1.b64 ਵਜੋਂ ਸੰਭਾਲੋ, ਫਿਰ ਉਸ ਨੂੰ ਡੀਕੋਡ ਕਰੋ ਅਤੇ ਉਸ ਦਾ SHA-256 ਦਿਖਾਓ:',
  },
}

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
      if (s.includes('\u2014')) problems.push(`em-dash in new copy at ${path}: ${s}`)
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
    if (!SPEC_COPY.has(path) && /(?<!meter )\btickets?\b/i.test(byLocale.en)) {
      problems.push(`ambiguous "ticket" in en copy at ${path}`)
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
