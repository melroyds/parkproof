/**
 * T3 i18n (roadmap build spec, task T3: model upgrades and unclear signs).
 * Idempotent: running it twice leaves the files byte-identical after the
 * first run.
 *
 * Adds:
 *   - `unclearSign`: the unclear-sign banner on the result screen
 *     (partially_obscured and contradictory: the answer card keeps the most
 *     restrictive answer), the "no readable sign" screen (missing and
 *     not_a_parking_sign) with "Retake photo" and "Log without a sign", the
 *     caption of the scan photo kept as the surroundings photo, the no-sign
 *     logger's intro and banner on that path, the record screen's
 *     "No sign read" line, and the "No sign read" label and remind-screen
 *     intro such a record gets where an ordinary no-sign record says
 *     "No posted restrictions".
 *   - `result.weeklyRestrictionHint` (T3 item 7).
 *   - Under `pdf.evidence`: the "Sign condition" row (sessionRows) and its
 *     values (the model's sign_status through a key map, never raw), the
 *     AI's notes, and the "No sign read" sign rules text. PDF strings are plain text
 *     with WinAnsi punctuation, and en, it and id use only characters
 *     jsPDF's Helvetica can draw (checked below); the Noto subsets are
 *     checked by src/lib/pdf-font-coverage.test.ts (the zh-CN
 *     "contradictory" and ko "not a parking sign" values are worded in
 *     characters their subsets have).
 *
 * Changes no existing string. Deletes only keys an earlier draft of this
 * script added (REMOVALS).
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces).
 *
 * Run:   node scripts/_i18n_inject_t3.mjs
 * List:  node scripts/_i18n_inject_t3.mjs --list
 *        prints every key this task added, for the T10 translation review
 *        ('legal' marks the statements a lawyer should read).
 * Other: node scripts/_i18n_inject_t3.mjs --dir <locales dir>
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
  'unclearSign.strictest',
  'unclearSign.noSignBody',
  'unclearSign.photoCaption',
  'unclearSign.loggerBanner',
  'unclearSign.recordNoSignRead',
  'pdf.evidence.noSignRead',
])

// ── New keys, appended inside their parent object ────────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position). Missing parent objects are created,
// appended at the end of their own parent.
const ADDITIONS = {
  // ── The unclear-sign banner on the result screen ──
  // partially_obscured: part of the sign is faded, covered or cut off.
  'unclearSign.obscuredTitle': {
    en: 'Part of this sign is hard to read',
    'zh-CN': '这个标志有一部分看不清',
    vi: 'Một phần biển báo này khó đọc',
    id: 'Sebagian rambu ini sulit dibaca',
    ko: '이 표지판의 일부를 읽기 어렵습니다',
    it: 'Parte di questo cartello è difficile da leggere',
    el: 'Ένα μέρος αυτής της πινακίδας διαβάζεται δύσκολα',
    hi: 'इस साइन का कुछ हिस्सा पढ़ना मुश्किल है',
    pa: 'ਇਸ ਚਿੰਨ੍ਹ ਦਾ ਕੁਝ ਹਿੱਸਾ ਪੜ੍ਹਨਾ ਔਖਾ ਹੈ',
  },
  // contradictory: two plates for the same spot and time can't both be followed.
  'unclearSign.contradictoryTitle': {
    en: 'Parts of this sign disagree',
    'zh-CN': '这个标志的各部分内容不一致',
    vi: 'Các phần của biển báo này mâu thuẫn nhau',
    id: 'Bagian-bagian rambu ini saling bertentangan',
    ko: '이 표지판의 내용이 서로 맞지 않습니다',
    it: 'Alcune parti di questo cartello si contraddicono',
    el: 'Κάποια μέρη αυτής της πινακίδας αντιφάσκουν',
    hi: 'इस साइन के कुछ हिस्से आपस में मेल नहीं खाते',
    pa: 'ਇਸ ਚਿੰਨ੍ਹ ਦੇ ਕੁਝ ਹਿੱਸੇ ਆਪਸ ਵਿੱਚ ਮੇਲ ਨਹੀਂ ਖਾਂਦੇ',
  },
  'unclearSign.strictest': {
    en: 'The answer above uses the most restrictive reading. Check the sign yourself before you leave the car.',
    'zh-CN': '上面的答案采用了最严格的解读。离开车之前,请你亲自看一下标志。',
    vi: 'Câu trả lời ở trên dùng cách hiểu nghiêm ngặt nhất. Hãy tự kiểm tra biển báo trước khi rời xe.',
    id: 'Jawaban di atas memakai bacaan yang paling ketat. Periksa sendiri rambunya sebelum kamu meninggalkan mobil.',
    ko: '위의 답은 가장 엄격한 해석을 따른 것입니다. 차를 떠나기 전에 표지판을 직접 확인하세요.',
    it: "La risposta qui sopra usa la lettura più restrittiva. Controlla il cartello di persona prima di lasciare l'auto.",
    el: 'Η παραπάνω απάντηση ακολουθεί την πιο αυστηρή ανάγνωση. Έλεγξε την πινακίδα με τα μάτια σου πριν φύγεις από το αυτοκίνητο.',
    hi: 'ऊपर दिया जवाब सबसे सख़्त व्याख्या पर आधारित है। कार छोड़ने से पहले साइन को खुद देख लें।',
    pa: "ਉੱਪਰ ਦਿੱਤਾ ਜਵਾਬ ਸਭ ਤੋਂ ਸਖ਼ਤ ਅਰਥ 'ਤੇ ਅਧਾਰਿਤ ਹੈ। ਕਾਰ ਛੱਡਣ ਤੋਂ ਪਹਿਲਾਂ ਚਿੰਨ੍ਹ ਨੂੰ ਖ਼ੁਦ ਦੇਖ ਲਓ।",
  },
  // Spec T3 item 6, exact.
  'unclearSign.worthRecording': {
    en: "A sign that can't be read clearly is worth keeping a record of.",
    'zh-CN': '看不清的标志,值得留下记录。',
    vi: 'Một biển báo không đọc rõ được thì đáng để lưu lại bản ghi.',
    id: 'Rambu yang tidak bisa dibaca dengan jelas layak dicatat.',
    ko: '또렷하게 읽을 수 없는 표지판은 기록해 둘 만합니다.',
    it: 'Vale la pena tenere un record di un cartello che non si legge bene.',
    el: 'Αξίζει να κρατήσεις εγγραφή για μια πινακίδα που δεν διαβάζεται καθαρά.',
    hi: 'जो साइन साफ़ पढ़ा न जा सके, उसका रिकॉर्ड रखना फ़ायदेमंद है।',
    pa: 'ਜੋ ਚਿੰਨ੍ਹ ਸਾਫ਼ ਪੜ੍ਹਿਆ ਨਾ ਜਾ ਸਕੇ, ਉਸ ਦਾ ਰਿਕਾਰਡ ਰੱਖਣਾ ਫ਼ਾਇਦੇਮੰਦ ਹੈ।',
  },
  // Heads the model's own notes (sign_issues), shown as written.
  'unclearSign.notesLabel': {
    en: 'What the AI noticed',
    'zh-CN': 'AI 注意到的情况',
    vi: 'Những gì AI nhận thấy',
    id: 'Yang dilihat AI',
    ko: 'AI가 확인한 내용',
    it: "Cosa ha notato l'AI",
    el: 'Τι παρατήρησε το AI',
    hi: 'AI ने क्या देखा',
    pa: 'AI ਨੇ ਕੀ ਦੇਖਿਆ',
  },

  // ── The "no readable sign" screen (missing, not_a_parking_sign) ──
  'unclearSign.noSignTitle': {
    en: 'No readable parking sign',
    'zh-CN': '没有可读的停车标志',
    vi: 'Không có biển báo đỗ xe đọc được',
    id: 'Tidak ada rambu parkir yang terbaca',
    ko: '읽을 수 있는 주차 표지판이 없습니다',
    it: 'Nessun cartello di sosta leggibile',
    el: 'Δεν βρέθηκε πινακίδα στάθμευσης που να διαβάζεται',
    hi: 'पढ़ने लायक कोई पार्किंग साइन नहीं मिला',
    pa: 'ਪੜ੍ਹਨਯੋਗ ਕੋਈ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਨਹੀਂ ਮਿਲਿਆ',
  },
  // Spec T3 item 6, exact.
  'unclearSign.noSignBody': {
    en: "We couldn't find a readable parking sign in this photo. That doesn't mean there are no rules here. General road rules still apply, such as no parking within 10 metres of an intersection without traffic lights, and some areas have time limits without a sign on every street.",
    'zh-CN':
      '我们在这张照片里找不到可读的停车标志。这并不代表这里没有规定。一般道路规则仍然适用,例如在没有交通信号灯的路口 10 米以内不得停车。有些区域即使不是每条街都有标志,也有停车时限。',
    vi: 'Chúng tôi không tìm thấy biển báo đỗ xe nào đọc được trong ảnh này. Điều đó không có nghĩa là ở đây không có quy định. Các luật giao thông chung vẫn áp dụng, chẳng hạn không được đỗ xe trong phạm vi 10 mét tính từ giao lộ không có đèn giao thông, và một số khu vực có giới hạn thời gian dù không phải con đường nào cũng có biển báo.',
    id: 'Kami tidak menemukan rambu parkir yang bisa dibaca di foto ini. Itu tidak berarti tidak ada aturan di sini. Aturan lalu lintas umum tetap berlaku, misalnya dilarang parkir dalam jarak 10 meter dari persimpangan tanpa lampu lalu lintas, dan beberapa kawasan punya batas waktu parkir walaupun tidak setiap jalan ada rambunya.',
    ko: '이 사진에서 읽을 수 있는 주차 표지판을 찾지 못했습니다. 그렇다고 이곳에 규칙이 없다는 뜻은 아닙니다. 일반 도로 규칙은 그대로 적용됩니다. 예를 들어 신호등이 없는 교차로에서 10미터 이내에는 주차할 수 없고, 어떤 지역은 거리마다 표지판이 없어도 주차 시간 제한이 있습니다.',
    it: 'Non abbiamo trovato in questa foto un cartello di sosta leggibile. Questo non significa che qui non ci siano regole. Le regole generali della strada valgono comunque, per esempio il divieto di sosta entro 10 metri da un incrocio senza semaforo, e in alcune zone ci sono limiti di tempo anche senza un cartello in ogni strada.',
    el: 'Δεν βρήκαμε πινακίδα στάθμευσης που να διαβάζεται σε αυτή τη φωτογραφία. Αυτό δεν σημαίνει ότι δεν υπάρχουν κανόνες εδώ. Οι γενικοί κανόνες οδικής κυκλοφορίας εξακολουθούν να ισχύουν, όπως η απαγόρευση στάθμευσης σε απόσταση 10 μέτρων από διασταύρωση χωρίς φανάρια, και σε κάποιες περιοχές υπάρχουν χρονικά όρια χωρίς πινακίδα σε κάθε δρόμο.',
    hi: 'हमें इस फोटो में पढ़ने लायक कोई पार्किंग साइन नहीं मिला। इसका मतलब यह नहीं कि यहाँ कोई नियम नहीं हैं। सामान्य सड़क नियम फिर भी लागू होते हैं, जैसे बिना ट्रैफ़िक लाइट वाले चौराहे से 10 मीटर के भीतर पार्किंग नहीं, और कुछ इलाकों में हर सड़क पर साइन न होने पर भी समय सीमा लागू होती है।',
    pa: "ਸਾਨੂੰ ਇਸ ਫੋਟੋ ਵਿੱਚ ਪੜ੍ਹਨਯੋਗ ਕੋਈ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਨਹੀਂ ਮਿਲਿਆ। ਇਸ ਦਾ ਮਤਲਬ ਇਹ ਨਹੀਂ ਕਿ ਇੱਥੇ ਕੋਈ ਨਿਯਮ ਨਹੀਂ ਹਨ। ਆਮ ਸੜਕ ਨਿਯਮ ਫਿਰ ਵੀ ਲਾਗੂ ਹੁੰਦੇ ਹਨ, ਜਿਵੇਂ ਬਿਨਾਂ ਟ੍ਰੈਫ਼ਿਕ ਲਾਈਟਾਂ ਵਾਲੇ ਚੌਰਾਹੇ ਤੋਂ 10 ਮੀਟਰ ਦੇ ਅੰਦਰ ਪਾਰਕਿੰਗ ਨਹੀਂ, ਅਤੇ ਕੁਝ ਇਲਾਕਿਆਂ ਵਿੱਚ ਹਰ ਗਲੀ 'ਤੇ ਚਿੰਨ੍ਹ ਨਾ ਹੋਣ 'ਤੇ ਵੀ ਸਮਾਂ ਸੀਮਾ ਹੁੰਦੀ ਹੈ।",
  },
  'unclearSign.photoAlt': {
    en: 'The photo you took',
    'zh-CN': '你拍的照片',
    vi: 'Ảnh bạn đã chụp',
    id: 'Foto yang kamu ambil',
    ko: '촬영한 사진',
    it: 'La foto che hai scattato',
    el: 'Η φωτογραφία που τράβηξες',
    hi: 'आपकी ली गई फोटो',
    pa: 'ਤੁਹਾਡੀ ਖਿੱਚੀ ਫੋਟੋ',
  },
  // Same words as result.verifyRetake in each locale.
  'unclearSign.retake': {
    en: 'Retake photo',
    'zh-CN': '重拍照片',
    vi: 'Chụp lại ảnh',
    id: 'Foto ulang',
    ko: '다시 찍기',
    it: 'Rifai la foto',
    el: 'Ξανατράβα φωτογραφία',
    hi: 'फोटो दोबारा लें',
    pa: 'ਫੋਟੋ ਮੁੜ ਲਓ',
  },
  'unclearSign.logWithoutSign': {
    en: 'Log without a sign',
    'zh-CN': '不用标志直接记录',
    vi: 'Ghi nhận mà không có biển báo',
    id: 'Catat tanpa rambu',
    ko: '표지판 없이 기록하기',
    it: 'Registra senza cartello',
    el: 'Κατάγραψε χωρίς πινακίδα',
    hi: 'बिना साइन के दर्ज करें',
    pa: 'ਬਿਨਾਂ ਚਿੰਨ੍ਹ ਦੇ ਦਰਜ ਕਰੋ',
  },
  // Spec T3 item 6, exact: the caption of the scan photo, kept as the
  // surroundings photo (no-sign logger and record screen).
  'unclearSign.photoCaption': {
    en: 'Photo taken where you parked. ParkProof found no readable parking sign in it.',
    'zh-CN': '在你停车的地方拍的照片。ParkProof 在照片里没有找到可读的停车标志。',
    vi: 'Ảnh chụp tại chỗ bạn đỗ xe. ParkProof không tìm thấy biển báo đỗ xe nào đọc được trong ảnh.',
    id: 'Foto diambil di tempat kamu parkir. ParkProof tidak menemukan rambu parkir yang bisa dibaca di foto ini.',
    ko: '주차한 곳에서 찍은 사진입니다. ParkProof는 이 사진에서 읽을 수 있는 주차 표지판을 찾지 못했습니다.',
    it: 'Foto scattata dove hai parcheggiato. ParkProof non ci ha trovato nessun cartello di sosta leggibile.',
    el: 'Φωτογραφία από το σημείο όπου πάρκαρες. Το ParkProof δεν βρήκε σε αυτήν πινακίδα στάθμευσης που να διαβάζεται.',
    hi: 'जहाँ आपने पार्क किया, वहाँ ली गई फोटो। ParkProof को इसमें पढ़ने लायक कोई पार्किंग साइन नहीं मिला।',
    pa: 'ਜਿੱਥੇ ਤੁਸੀਂ ਪਾਰਕ ਕੀਤਾ, ਉੱਥੇ ਖਿੱਚੀ ਫੋਟੋ। ParkProof ਨੂੰ ਇਸ ਵਿੱਚ ਪੜ੍ਹਨਯੋਗ ਕੋਈ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਨਹੀਂ ਮਿਲਿਆ।',
  },
  // The no-sign logger's intro and banner when the driver came from the
  // "no readable sign" screen: the driver isn't saying there was no sign,
  // only logging without one.
  'unclearSign.loggerIntro': {
    en: "We'll save when and where you parked, with the photo you took.",
    'zh-CN': '我们会保存你停车的时间和地点,以及你拍的照片。',
    vi: 'Chúng tôi sẽ lưu thời gian và địa điểm bạn đỗ xe, cùng với ảnh bạn đã chụp.',
    id: 'Kami akan menyimpan kapan dan di mana kamu parkir, beserta foto yang kamu ambil.',
    ko: '주차한 시간과 장소를 촬영한 사진과 함께 저장합니다.',
    it: 'Salveremo quando e dove hai parcheggiato, con la foto che hai scattato.',
    el: 'Θα αποθηκεύσουμε πότε και πού πάρκαρες, μαζί με τη φωτογραφία που τράβηξες.',
    hi: 'आपने कब और कहाँ पार्क किया, यह आपकी ली गई फोटो के साथ सहेजा जाएगा।',
    pa: 'ਤੁਸੀਂ ਕਦੋਂ ਅਤੇ ਕਿੱਥੇ ਪਾਰਕ ਕੀਤਾ, ਇਹ ਤੁਹਾਡੀ ਖਿੱਚੀ ਫੋਟੋ ਦੇ ਨਾਲ ਸੰਭਾਲਿਆ ਜਾਵੇਗਾ।',
  },
  'unclearSign.loggerBanner': {
    en: "The record will say ParkProof found no readable parking sign in your photo and you logged this park without one. It doesn't show there was no sign here.",
    'zh-CN':
      '这条记录会写明:ParkProof 在你的照片里没有找到可读的停车标志,你在没有标志的情况下记录了这次停车。它不能说明这里没有标志。',
    vi: 'Bản ghi sẽ nêu rằng ParkProof không tìm thấy biển báo đỗ xe nào đọc được trong ảnh của bạn và bạn đã ghi nhận lần đỗ xe này mà không có biển báo. Bản ghi không chứng tỏ ở đây không có biển báo.',
    id: 'Catatan ini akan menyebutkan bahwa ParkProof tidak menemukan rambu parkir yang bisa dibaca di fotomu dan kamu mencatat parkir ini tanpa rambu. Catatan ini tidak menunjukkan bahwa di sini tidak ada rambu.',
    // ko: two facts, so the logging stays the driver's (직접), not ParkProof's.
    ko: '이 기록에는 ParkProof가 사진에서 읽을 수 있는 주차 표지판을 찾지 못했다는 것과, 표지판 없이 이번 주차를 직접 기록했다는 것이 남습니다. 이곳에 표지판이 없었다는 것을 보여 주지는 않습니다.',
    it: 'Il record dirà che ParkProof non ha trovato un cartello di sosta leggibile nella tua foto e che hai registrato questo parcheggio senza cartello. Non mostra che qui non ci fosse un cartello.',
    el: 'Η εγγραφή θα αναφέρει ότι το ParkProof δεν βρήκε πινακίδα στάθμευσης που να διαβάζεται στη φωτογραφία σου και ότι κατέγραψες αυτή τη στάθμευση χωρίς πινακίδα. Δεν δείχνει ότι δεν υπήρχε πινακίδα εδώ.',
    hi: 'रिकॉर्ड में लिखा होगा कि ParkProof को आपकी फोटो में पढ़ने लायक कोई पार्किंग साइन नहीं मिला और आपने यह पार्किंग बिना साइन के दर्ज की। इससे यह नहीं दिखता कि यहाँ कोई साइन नहीं था।',
    pa: 'ਰਿਕਾਰਡ ਵਿੱਚ ਲਿਖਿਆ ਹੋਵੇਗਾ ਕਿ ParkProof ਨੂੰ ਤੁਹਾਡੀ ਫੋਟੋ ਵਿੱਚ ਪੜ੍ਹਨਯੋਗ ਕੋਈ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਨਹੀਂ ਮਿਲਿਆ ਅਤੇ ਤੁਸੀਂ ਇਹ ਪਾਰਕਿੰਗ ਬਿਨਾਂ ਚਿੰਨ੍ਹ ਦੇ ਦਰਜ ਕੀਤੀ। ਇਸ ਤੋਂ ਇਹ ਨਹੀਂ ਦਿਖਦਾ ਕਿ ਇੱਥੇ ਕੋਈ ਚਿੰਨ੍ਹ ਨਹੀਂ ਸੀ।',
  },
  // The record screen's sign rules line and no-sign description for such a
  // record (second person; the PDF's twin is pdf.evidence.noSignRead).
  'unclearSign.recordNoSignRead': {
    en: 'No sign read. ParkProof found no readable parking sign in the photo, and you logged this park without one.',
    'zh-CN': '未读取标志。ParkProof 在照片里没有找到可读的停车标志,你在没有标志的情况下记录了这次停车。',
    vi: 'Không đọc được biển báo. ParkProof không tìm thấy biển báo đỗ xe nào đọc được trong ảnh, và bạn đã ghi nhận lần đỗ xe này mà không có biển báo.',
    id: 'Tidak ada rambu yang terbaca. ParkProof tidak menemukan rambu parkir yang bisa dibaca di foto, dan kamu mencatat parkir ini tanpa rambu.',
    // ko: a sentence of its own, so the logging stays the driver's (직접), not ParkProof's.
    ko: '읽은 표지판 없음. ParkProof가 사진에서 읽을 수 있는 주차 표지판을 찾지 못했습니다. 이번 주차는 표지판 없이 직접 기록했습니다.',
    it: 'Nessun cartello letto. ParkProof non ha trovato un cartello di sosta leggibile nella foto, e hai registrato questo parcheggio senza cartello.',
    el: 'Δεν διαβάστηκε πινακίδα. Το ParkProof δεν βρήκε πινακίδα στάθμευσης που να διαβάζεται στη φωτογραφία, και κατέγραψες αυτή τη στάθμευση χωρίς πινακίδα.',
    hi: 'कोई साइन नहीं पढ़ा गया। ParkProof को फोटो में पढ़ने लायक कोई पार्किंग साइन नहीं मिला, और आपने यह पार्किंग बिना साइन के दर्ज की।',
    pa: 'ਕੋਈ ਚਿੰਨ੍ਹ ਨਹੀਂ ਪੜ੍ਹਿਆ ਗਿਆ। ParkProof ਨੂੰ ਫੋਟੋ ਵਿੱਚ ਪੜ੍ਹਨਯੋਗ ਕੋਈ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਨਹੀਂ ਮਿਲਿਆ, ਅਤੇ ਤੁਸੀਂ ਇਹ ਪਾਰਕਿੰਗ ਬਿਨਾਂ ਚਿੰਨ੍ਹ ਦੇ ਦਰਜ ਕੀਤੀ।',
  },
  // The short label for such a record where the ordinary no-sign record
  // says "No posted restrictions": the record screen's heading, the home
  // card and the History row. ParkProof only found no readable sign in the
  // photo; that doesn't mean there are no rules here.
  'unclearSign.noSignReadLabel': {
    en: 'No sign read',
    'zh-CN': '未读取标志',
    vi: 'Không đọc được biển báo',
    id: 'Tidak ada rambu yang terbaca',
    ko: '읽은 표지판 없음',
    it: 'Nessun cartello letto',
    el: 'Δεν διαβάστηκε πινακίδα',
    hi: 'कोई साइन नहीं पढ़ा गया',
    pa: 'ਕੋਈ ਚਿੰਨ੍ਹ ਨਹੀਂ ਪੜ੍ਹਿਆ ਗਿਆ',
  },
  // The remind screen's intro for such a record (the ordinary one says
  // "No posted expiry here").
  'unclearSign.remindIntro': {
    en: "No sign was read for this park, so there's no expiry to remind you of. You can still ask for a check-in reminder. Pick how long from now, choose as many as you like.",
    'zh-CN': '这次停车没有读取到标志,所以没有到期时间可以提醒你。你仍然可以设一个查看提醒。挑一下从现在起多久后提醒,可以多选。',
    vi: 'Lần đỗ xe này không đọc được biển báo nào, nên không có giờ hết hạn để nhắc bạn. Bạn vẫn có thể đặt nhắc kiểm tra. Chọn sau bao lâu kể từ bây giờ, chọn bao nhiêu cũng được.',
    id: 'Tidak ada rambu yang terbaca untuk parkir ini, jadi tidak ada waktu berakhir untuk diingatkan. Kamu tetap bisa minta pengingat untuk mengecek. Pilih berapa lama lagi dari sekarang, sebanyak yang kamu mau.',
    ko: '이번 주차에서는 읽은 표지판이 없어서 알려 드릴 만료 시간이 없습니다. 그래도 확인 알림은 받을 수 있어요. 지금부터 얼마 뒤에 받을지 고르세요. 원하는 만큼 선택해도 됩니다.',
    it: "Per questo parcheggio non è stato letto nessun cartello, quindi non c'è una scadenza da ricordarti. Puoi comunque chiedere un promemoria di controllo. Scegli tra quanto tempo, quante volte vuoi.",
    el: 'Για αυτή τη στάθμευση δεν διαβάστηκε πινακίδα, οπότε δεν υπάρχει λήξη για να σου υπενθυμίσουμε. Μπορείς όμως να ζητήσεις υπενθύμιση ελέγχου. Διάλεξε σε πόση ώρα από τώρα, όσες θέλεις.',
    hi: 'इस पार्किंग के लिए कोई साइन नहीं पढ़ा गया, इसलिए याद दिलाने के लिए कोई समाप्ति समय नहीं है। फिर भी आप जाँच के लिए रिमाइंडर सेट कर सकते हैं। चुनें कि अभी से कितनी देर बाद, जितने चाहें उतने।',
    pa: 'ਇਸ ਪਾਰਕਿੰਗ ਲਈ ਕੋਈ ਚਿੰਨ੍ਹ ਨਹੀਂ ਪੜ੍ਹਿਆ ਗਿਆ, ਇਸ ਲਈ ਯਾਦ ਕਰਵਾਉਣ ਲਈ ਕੋਈ ਸਮਾਪਤੀ ਸਮਾਂ ਨਹੀਂ। ਫਿਰ ਵੀ ਤੁਸੀਂ ਜਾਂਚ ਲਈ ਰਿਮਾਈਂਡਰ ਲਾ ਸਕਦੇ ਹੋ। ਚੁਣੋ ਹੁਣ ਤੋਂ ਕਿੰਨੀ ਦੇਰ ਬਾਅਦ, ਜਿੰਨੇ ਚਾਹੋ।',
  },

  // ── The weekly restriction hint on the result screen (spec T3 item 7, exact) ──
  'result.weeklyRestrictionHint': {
    en: 'This sign has a weekly restriction. You can set a reminder after you save.',
    'zh-CN': '这个标志有每周重复的限制。保存后,你可以设置提醒。',
    vi: 'Biển báo này có hạn chế lặp lại hằng tuần. Bạn có thể đặt lời nhắc sau khi lưu.',
    id: 'Rambu ini punya larangan mingguan. Kamu bisa memasang pengingat setelah menyimpan.',
    ko: '이 표지판에는 매주 반복되는 제한이 있습니다. 저장한 뒤 알림을 설정할 수 있습니다.',
    it: 'Questo cartello ha una restrizione settimanale. Puoi impostare un promemoria dopo aver salvato.',
    el: 'Αυτή η πινακίδα έχει εβδομαδιαίο περιορισμό. Μπορείς να βάλεις υπενθύμιση αφού αποθηκεύσεις.',
    hi: 'इस साइन पर हर हफ़्ते लागू होने वाला प्रतिबंध है। सहेजने के बाद आप रिमाइंडर सेट कर सकते हैं।',
    pa: "ਇਸ ਚਿੰਨ੍ਹ 'ਤੇ ਹਰ ਹਫ਼ਤੇ ਲਾਗੂ ਹੋਣ ਵਾਲੀ ਪਾਬੰਦੀ ਹੈ। ਸੰਭਾਲਣ ਤੋਂ ਬਾਅਦ ਤੁਸੀਂ ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਕਰ ਸਕਦੇ ਹੋ।",
  },

  // ── PDF: the "Sign condition" row (sessionRows) ──
  'pdf.evidence.field.signCondition': {
    en: 'Sign condition',
    'zh-CN': '标志状况',
    vi: 'Tình trạng biển báo',
    id: 'Kondisi rambu',
    ko: '표지판 상태',
    it: 'Condizione del cartello',
    el: 'Κατάσταση πινακίδας',
    hi: 'साइन की स्थिति',
    pa: 'ਚਿੰਨ੍ਹ ਦੀ ਹਾਲਤ',
  },
  // The model's sign_status, one key per value (never printed raw).
  'pdf.evidence.signCondition.readable': {
    en: 'Readable in the photo',
    'zh-CN': '照片中可以读清',
    vi: 'Đọc được trong ảnh',
    id: 'Terbaca di foto',
    ko: '사진에서 읽을 수 있음',
    it: 'Leggibile nella foto',
    el: 'Διαβάζεται στη φωτογραφία',
    hi: 'फोटो में पढ़ा जा सकता है',
    pa: 'ਫੋਟੋ ਵਿੱਚ ਪੜ੍ਹਿਆ ਜਾ ਸਕਦਾ ਹੈ',
  },
  'pdf.evidence.signCondition.partiallyObscured': {
    en: 'Partly hard to read in the photo',
    'zh-CN': '照片中有一部分看不清',
    vi: 'Một phần khó đọc trong ảnh',
    id: 'Sebagian sulit dibaca di foto',
    ko: '사진에서 일부를 읽기 어려움',
    it: 'In parte difficile da leggere nella foto',
    el: 'Εν μέρει δυσανάγνωστη στη φωτογραφία',
    hi: 'फोटो में कुछ हिस्सा पढ़ना मुश्किल',
    pa: 'ਫੋਟੋ ਵਿੱਚ ਕੁਝ ਹਿੱਸਾ ਪੜ੍ਹਨਾ ਔਖਾ',
  },
  'pdf.evidence.signCondition.contradictory': {
    en: 'Parts of the sign disagree',
    'zh-CN': '标志的各部分内容不一致',
    vi: 'Các phần của biển báo mâu thuẫn nhau',
    id: 'Bagian-bagian rambu saling bertentangan',
    ko: '표지판 내용이 서로 맞지 않음',
    it: 'Alcune parti del cartello si contraddicono',
    el: 'Κάποια μέρη της πινακίδας αντιφάσκουν',
    hi: 'साइन के कुछ हिस्से आपस में मेल नहीं खाते',
    pa: 'ਚਿੰਨ੍ਹ ਦੇ ਕੁਝ ਹਿੱਸੇ ਆਪਸ ਵਿੱਚ ਮੇਲ ਨਹੀਂ ਖਾਂਦੇ',
  },
  'pdf.evidence.signCondition.missing': {
    en: 'No parking sign found in the photo',
    'zh-CN': '照片中没有找到停车标志',
    vi: 'Không tìm thấy biển báo đỗ xe trong ảnh',
    id: 'Tidak ditemukan rambu parkir di foto',
    ko: '사진에서 주차 표지판을 찾지 못함',
    it: 'Nessun cartello di sosta trovato nella foto',
    el: 'Δεν βρέθηκε πινακίδα στάθμευσης στη φωτογραφία',
    hi: 'फोटो में कोई पार्किंग साइन नहीं मिला',
    pa: 'ਫੋਟੋ ਵਿੱਚ ਕੋਈ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਨਹੀਂ ਮਿਲਿਆ',
  },
  'pdf.evidence.signCondition.notAParkingSign': {
    en: 'The photo shows something other than a parking sign',
    'zh-CN': '照片拍到的不是停车标志',
    vi: 'Ảnh chụp thứ khác, không phải biển báo đỗ xe',
    id: 'Foto menunjukkan hal lain, bukan rambu parkir',
    ko: '사진에 주차 표지판 대신 다른 것이 있음',
    it: 'La foto mostra qualcosa che non è un cartello di sosta',
    el: 'Η φωτογραφία δείχνει κάτι άλλο, όχι πινακίδα στάθμευσης',
    hi: 'फोटो में पार्किंग साइन के बजाय कुछ और है',
    pa: 'ਫੋਟੋ ਵਿੱਚ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਦੀ ਥਾਂ ਕੁਝ ਹੋਰ ਹੈ',
  },
  // The model's notes (sign_issues), joined with '; ', as written.
  'pdf.evidence.signCondition.notes': {
    en: 'AI notes: {{notes}}',
    'zh-CN': 'AI 备注:{{notes}}',
    vi: 'Ghi chú của AI: {{notes}}',
    id: 'Catatan AI: {{notes}}',
    ko: 'AI 메모: {{notes}}',
    it: "Note dell'AI: {{notes}}",
    el: 'Σημειώσεις του AI: {{notes}}',
    hi: 'AI की टिप्पणियाँ: {{notes}}',
    pa: 'AI ਦੀਆਂ ਟਿੱਪਣੀਆਂ: {{notes}}',
  },
  // Spec T3 item 6, exact: the sign rules cell of a no-sign record logged
  // from the "no readable sign" screen.
  'pdf.evidence.noSignRead': {
    en: 'No sign read. ParkProof found no readable parking sign in the photo, and the driver logged this park without one.',
    'zh-CN': '未读取标志。ParkProof 在照片里没有找到可读的停车标志,驾驶员在没有标志的情况下记录了这次停车。',
    vi: 'Không đọc được biển báo. ParkProof không tìm thấy biển báo đỗ xe nào đọc được trong ảnh, và tài xế đã ghi nhận lần đỗ xe này mà không có biển báo.',
    id: 'Tidak ada rambu yang terbaca. ParkProof tidak menemukan rambu parkir yang bisa dibaca di foto, dan pengemudi mencatat parkir ini tanpa rambu.',
    ko: '읽은 표지판 없음. ParkProof가 사진에서 읽을 수 있는 주차 표지판을 찾지 못했고, 운전자는 표지판 없이 이번 주차를 기록했습니다.',
    it: 'Nessun cartello letto. ParkProof non ha trovato un cartello di sosta leggibile nella foto, e il conducente ha registrato questo parcheggio senza cartello.',
    el: 'Δεν διαβάστηκε πινακίδα. Το ParkProof δεν βρήκε πινακίδα στάθμευσης που να διαβάζεται στη φωτογραφία, και ο οδηγός κατέγραψε αυτή τη στάθμευση χωρίς πινακίδα.',
    hi: 'कोई साइन नहीं पढ़ा गया। ParkProof को फोटो में पढ़ने लायक कोई पार्किंग साइन नहीं मिला, और चालक ने यह पार्किंग बिना साइन के दर्ज की।',
    pa: 'ਕੋਈ ਚਿੰਨ੍ਹ ਨਹੀਂ ਪੜ੍ਹਿਆ ਗਿਆ। ParkProof ਨੂੰ ਫੋਟੋ ਵਿੱਚ ਪੜ੍ਹਨਯੋਗ ਕੋਈ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਨਹੀਂ ਮਿਲਿਆ, ਅਤੇ ਡਰਾਈਵਰ ਨੇ ਇਹ ਪਾਰਕਿੰਗ ਬਿਨਾਂ ਚਿੰਨ੍ਹ ਦੇ ਦਰਜ ਕੀਤੀ।',
  },
}

// ── Existing strings this task rewrites (explicit overwrite list) ───────
// None: every T3 string is new.
const OVERWRITES = {}

// ── Keys an earlier draft of this script added and T3 no longer uses ────
// Deleted when present, so a re-run over files that have them converges.
// pdf.evidence.noSignReadPhotoCaption: the PDF now keeps the existing
// surroundings caption (pdf.evidence.ambientPhotoCaption), which says the
// driver took the photo and that it doesn't show there was no sign nearby.
const REMOVALS = ['pdf.evidence.noSignReadPhotoCaption']

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
