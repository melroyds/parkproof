/**
 * T1a i18n (roadmap build spec, task T1a: the signed departure and the
 * chain on screen). Idempotent: running it twice leaves the files
 * byte-identical after the first run.
 *
 * Adds two top-level objects:
 *   - `departure`: the departure sheet that replaces the browser confirm
 *     behind "I've left" (its location status line and "Confirm I've
 *     left"; the sheet's title and body reuse active.iveLeft and the
 *     existing confirm texts), and the departure row on the record screen
 *     ("You tapped I've left at ... (phone clock).", the distance line).
 *   - `chain`: the chain panel on the record screen. What each signed part
 *     covers, ParkProof's signing time ("Signed by ParkProof at ...", shared
 *     with the departure row), the "Check signatures" results, the collapsed
 *     panel's one-line state and the photo role names. Pending and refused
 *     parts reuse verifier.link.pending and verifier.link.rejected (T0b3).
 *   - `departure.notSigned` and `session.ended` (the record screen's status
 *     for an ended record; its times are in the departure row).
 *
 * Phone times are labelled as phone times; only ParkProof's signing time is
 * called signed. The intro says what a signature does not show.
 *
 * Changes one existing string, through the explicit OVERWRITES list:
 * `about.sealCaveat` (it said the seal "proves" the record wasn't changed
 * after saving, right above the chain panel that says otherwise).
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces, plus: every `_one` key this
 * script owns carries {{count}} in every locale).
 *
 * Run:   node scripts/_i18n_inject_t1a.mjs
 * List:  node scripts/_i18n_inject_t1a.mjs --list
 *        prints every key this task added or rewrote, for the T10
 *        translation review ('legal' marks the signature statements a
 *        lawyer should read, 'overwrite' an existing string rewritten).
 * Other: node scripts/_i18n_inject_t1a.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

/** Keys whose wording makes a claim about signatures or times: for docs/legal-review-queue.md (T10). */
const LEGAL = new Set([
  'departure.tapped',
  'departure.far',
  'departure.notSigned',
  'chain.intro',
  'chain.signedAt',
  'chain.covers.arrival',
  'chain.covers.arrivalNoSign',
  'chain.covers.arrivalContext',
  'chain.covers.departure',
  'chain.covers.handover',
  'chain.checkValid_one',
  'chain.checkValid_other',
  'chain.checkValidPhotosUnchecked_one',
  'chain.checkValidPhotosUnchecked_other',
  'about.sealCaveat',
])

// ── New keys, appended inside their parent object ────────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position). Missing parent objects are created,
// appended at the end of their own parent.
const ADDITIONS = {
  // ── The departure sheet ──
  'departure.locating': {
    en: 'Getting your location',
    'zh-CN': '正在获取你的位置',
    vi: 'Đang lấy vị trí của bạn',
    id: 'Mencari lokasimu',
    ko: '위치를 확인하는 중',
    it: 'Rilevamento della posizione',
    el: 'Εντοπισμός της τοποθεσίας σου',
    hi: 'आपकी लोकेशन ली जा रही है',
    pa: 'ਤੁਹਾਡਾ ਸਥਾਨ ਲਿਆ ਜਾ ਰਿਹਾ ਹੈ',
  },
  // {{accuracy}} is formatAccuracy's "±12m".
  'departure.located': {
    en: 'Location captured, {{accuracy}}',
    'zh-CN': '已获取位置,{{accuracy}}',
    vi: 'Đã lấy được vị trí, {{accuracy}}',
    id: 'Lokasi didapat, {{accuracy}}',
    ko: '위치 확인됨, {{accuracy}}',
    it: 'Posizione rilevata, {{accuracy}}',
    el: 'Η τοποθεσία καταγράφηκε, {{accuracy}}',
    hi: 'लोकेशन मिल गई, {{accuracy}}',
    pa: 'ਸਥਾਨ ਮਿਲ ਗਿਆ, {{accuracy}}',
  },
  'departure.noLocation': {
    en: 'No location',
    'zh-CN': '没有位置信息',
    vi: 'Không có vị trí',
    id: 'Tidak ada lokasi',
    ko: '위치 없음',
    it: 'Nessuna posizione',
    el: 'Χωρίς τοποθεσία',
    hi: 'कोई लोकेशन नहीं',
    pa: 'ਕੋਈ ਸਥਾਨ ਨਹੀਂ',
  },
  // The button. Quotes the home card's "I've left" (active.iveLeft) in each locale.
  'departure.confirm': {
    en: "Confirm I've left",
    'zh-CN': '确认我已离开',
    vi: 'Xác nhận tôi đã đi',
    id: 'Konfirmasi sudah pergi',
    ko: '떠났음 확인',
    it: 'Conferma: ho lasciato il posto',
    el: 'Επιβεβαίωση: Έφυγα',
    hi: 'पुष्टि करें: मैंने जगह खाली कर दी',
    pa: 'ਪੁਸ਼ਟੀ ਕਰੋ: ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ',
  },
  // ── The departure row on the record screen ──
  // A field label like session.status: upper case where the script has it.
  'departure.heading': {
    en: 'DEPARTURE',
    'zh-CN': '离开',
    vi: 'RỜI ĐI',
    id: 'SAAT PERGI',
    ko: '출차',
    it: 'PARTENZA',
    el: 'ΑΝΑΧΩΡΗΣΗ',
    hi: 'प्रस्थान',
    pa: 'ਰਵਾਨਗੀ',
  },
  // The tap time, from the phone. Never "signed departure at".
  'departure.tapped': {
    en: "You tapped I've left at {{time}} (phone clock).",
    'zh-CN': '你在 {{time}} 点按了"我已离开"(手机时钟)。',
    vi: 'Bạn đã nhấn "Tôi đã đi" lúc {{time}} (đồng hồ điện thoại).',
    id: 'Kamu mengetuk "Sudah pergi" pada {{time}} (jam ponsel).',
    ko: '{{time}}에 "떠났습니다"를 눌렀습니다 (휴대폰 시계).',
    it: 'Hai toccato "Ho lasciato il posto": {{time}} (orologio del telefono).',
    el: 'Πάτησες «Έφυγα»: {{time}} (ρολόι κινητού).',
    hi: 'आपने {{time}} पर "मैंने जगह खाली कर दी" पर टैप किया (फ़ोन की घड़ी)।',
    pa: 'ਤੁਸੀਂ {{time}} \'ਤੇ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" \'ਤੇ ਟੈਪ ਕੀਤਾ (ਫ਼ੋਨ ਦੀ ਘੜੀ)।',
  },
  // Over 150 m from where the car was logged. {{distance}} is "180 m" / "1.2 km".
  'departure.far': {
    en: "Your phone was {{distance}} from where you parked when you tapped I've left. The record shows when you tapped, not when the car moved.",
    'zh-CN': '你点按"我已离开"时,手机距离你停车的地方 {{distance}}。记录显示的是你点按的时间,不是车辆移动的时间。',
    vi: 'Khi bạn nhấn "Tôi đã đi", điện thoại của bạn cách chỗ bạn đỗ xe {{distance}}. Bản ghi cho thấy lúc bạn nhấn, không phải lúc xe di chuyển.',
    id: 'Saat kamu mengetuk "Sudah pergi", ponselmu berjarak {{distance}} dari tempat kamu parkir. Catatan ini menunjukkan kapan kamu mengetuk, bukan kapan mobil bergerak.',
    ko: '"떠났습니다"를 눌렀을 때 휴대폰은 주차한 곳에서 {{distance}} 떨어져 있었습니다. 이 기록은 누른 시각을 보여 줄 뿐, 차가 움직인 시각은 보여 주지 않습니다.',
    it: 'Quando hai toccato "Ho lasciato il posto", il telefono era a {{distance}} da dove avevi parcheggiato. Il record mostra quando hai toccato, non quando l\'auto si è spostata.',
    el: 'Όταν πάτησες «Έφυγα», το κινητό σου ήταν {{distance}} από το σημείο όπου πάρκαρες. Η εγγραφή δείχνει πότε πάτησες, όχι πότε κινήθηκε το αυτοκίνητο.',
    hi: 'जब आपने "मैंने जगह खाली कर दी" पर टैप किया, तब आपका फ़ोन पार्किंग की जगह से {{distance}} दूर था। रिकॉर्ड दिखाता है कि आपने कब टैप किया, यह नहीं कि कार कब हिली।',
    pa: 'ਜਦੋਂ ਤੁਸੀਂ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" \'ਤੇ ਟੈਪ ਕੀਤਾ, ਤਾਂ ਤੁਹਾਡਾ ਫ਼ੋਨ ਪਾਰਕ ਕੀਤੀ ਥਾਂ ਤੋਂ {{distance}} ਦੂਰ ਸੀ। ਰਿਕਾਰਡ ਦਿਖਾਉਂਦਾ ਹੈ ਕਿ ਤੁਸੀਂ ਕਦੋਂ ਟੈਪ ਕੀਤਾ, ਇਹ ਨਹੀਂ ਕਿ ਕਾਰ ਕਦੋਂ ਹਿੱਲੀ।',
  },

  // ── The chain panel ──
  'chain.heading': {
    en: 'SIGNED PARTS OF THIS RECORD',
    'zh-CN': '这条记录的已签名部分',
    vi: 'CÁC PHẦN ĐÃ KÝ CỦA BẢN GHI NÀY',
    id: 'BAGIAN CATATAN YANG DITANDATANGANI',
    ko: '이 기록의 서명된 부분',
    it: 'PARTI FIRMATE DI QUESTO RECORD',
    el: 'ΥΠΟΓΕΓΡΑΜΜΕΝΑ ΤΜΗΜΑΤΑ ΑΥΤΗΣ ΤΗΣ ΕΓΓΡΑΦΗΣ',
    hi: 'इस रिकॉर्ड के हस्ताक्षरित हिस्से',
    pa: 'ਇਸ ਰਿਕਾਰਡ ਦੇ ਹਸਤਾਖਰਿਤ ਹਿੱਸੇ',
  },
  // What a signature does and doesn't show (copy rules).
  'chain.intro': {
    en: "ParkProof's server signs each part when it receives it. A valid signature shows the signed details haven't changed since then. It doesn't show they are true, who was driving, where the car was, or when it arrived or left.",
    'zh-CN': 'ParkProof 的服务器在收到每一部分时为其签名。有效的签名表明已签名的内容自那以后没有改动。它不能说明这些内容属实,也不能说明是谁在开车、车停在哪里,或车辆何时到达、何时离开。',
    vi: 'Máy chủ của ParkProof ký từng phần khi nhận được. Chữ ký hợp lệ cho thấy các thông tin đã ký không thay đổi kể từ lúc đó. Chữ ký không cho thấy các thông tin đó là đúng, ai đang lái xe, xe ở đâu, hay xe đến và rời đi lúc nào.',
    id: 'Server ParkProof menandatangani setiap bagian saat menerimanya. Tanda tangan yang valid menunjukkan detail yang ditandatangani tidak berubah sejak saat itu. Tanda tangan tidak menunjukkan bahwa isinya benar, siapa yang menyetir, di mana mobilnya, atau kapan mobil tiba atau pergi.',
    ko: 'ParkProof 서버는 각 부분을 받는 즉시 서명합니다. 유효한 서명은 서명된 내용이 그 뒤로 바뀌지 않았음을 보여 줍니다. 그 내용이 사실인지, 누가 운전했는지, 차가 어디에 있었는지, 언제 도착하거나 떠났는지는 보여 주지 않습니다.',
    it: 'Il server di ParkProof firma ogni parte quando la riceve. Una firma valida mostra che i dati firmati non sono cambiati da allora. Non mostra che siano veri, chi guidava, dove si trovava l\'auto, né quando è arrivata o partita.',
    el: 'Ο διακομιστής του ParkProof υπογράφει κάθε τμήμα όταν το λαμβάνει. Μια έγκυρη υπογραφή δείχνει ότι τα υπογεγραμμένα στοιχεία δεν έχουν αλλάξει από τότε. Δεν δείχνει ότι είναι αληθινά, ποιος οδηγούσε, πού ήταν το αυτοκίνητο ή πότε έφτασε ή έφυγε.',
    hi: 'ParkProof का सर्वर हर हिस्से को मिलते ही उस पर हस्ताक्षर करता है। मान्य हस्ताक्षर दिखाता है कि हस्ताक्षरित विवरण तब से नहीं बदले हैं। यह नहीं दिखाता कि वे सच हैं, ड्राइवर कौन था, कार कहाँ थी, या वह कब पहुँची या गई।',
    pa: 'ParkProof ਦਾ ਸਰਵਰ ਹਰ ਹਿੱਸੇ ਨੂੰ ਮਿਲਦੇ ਹੀ ਉਸ \'ਤੇ ਹਸਤਾਖਰ ਕਰਦਾ ਹੈ। ਵੈਧ ਹਸਤਾਖਰ ਦਿਖਾਉਂਦਾ ਹੈ ਕਿ ਹਸਤਾਖਰਿਤ ਵੇਰਵੇ ਉਦੋਂ ਤੋਂ ਨਹੀਂ ਬਦਲੇ। ਇਹ ਨਹੀਂ ਦਿਖਾਉਂਦਾ ਕਿ ਉਹ ਸੱਚ ਹਨ, ਡਰਾਈਵਰ ਕੌਣ ਸੀ, ਕਾਰ ਕਿੱਥੇ ਸੀ, ਜਾਂ ਉਹ ਕਦੋਂ ਪਹੁੰਚੀ ਜਾਂ ਗਈ।',
  },
  // Link kinds (chain-view.ts CHAIN_KIND_KEYS).
  'chain.kind.arrival': {
    en: 'Arrival',
    'zh-CN': '到达',
    vi: 'Lúc đến',
    id: 'Kedatangan',
    ko: '도착',
    it: 'Arrivo',
    el: 'Άφιξη',
    hi: 'आगमन',
    pa: 'ਆਮਦ',
  },
  'chain.kind.arrivalContext': {
    en: 'Details at parking',
    'zh-CN': '停车时的补充信息',
    vi: 'Thông tin khi đỗ xe',
    id: 'Detail saat parkir',
    ko: '주차할 때의 세부 정보',
    it: 'Dettagli al parcheggio',
    el: 'Στοιχεία κατά τη στάθμευση',
    hi: 'पार्किंग के समय के विवरण',
    pa: 'ਪਾਰਕਿੰਗ ਵੇਲੇ ਦੇ ਵੇਰਵੇ',
  },
  'chain.kind.condition': {
    en: 'Condition photos',
    'zh-CN': '车况照片',
    vi: 'Ảnh tình trạng xe',
    id: 'Foto kondisi mobil',
    ko: '차량 상태 사진',
    it: "Foto delle condizioni dell'auto",
    el: 'Φωτογραφίες κατάστασης αυτοκινήτου',
    hi: 'कार की हालत की फोटो',
    pa: 'ਕਾਰ ਦੀ ਹਾਲਤ ਦੀਆਂ ਫੋਟੋਆਂ',
  },
  // Not "ticket": on the record screen that can read as the fine notice. T2
  // names this section "Proof of payment or permit".
  'chain.kind.compliance': {
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
  'chain.kind.departure': {
    en: 'Departure',
    'zh-CN': '离开',
    vi: 'Rời đi',
    id: 'Saat pergi',
    ko: '출차',
    it: 'Partenza',
    el: 'Αναχώρηση',
    hi: 'प्रस्थान',
    pa: 'ਰਵਾਨਗੀ',
  },
  'chain.kind.handover': {
    en: 'Handover',
    'zh-CN': '交车',
    vi: 'Giao xe',
    id: 'Serah terima mobil',
    ko: '차량 인계',
    it: "Passaggio dell'auto",
    el: 'Παράδοση αυτοκινήτου',
    hi: 'कार सौंपना',
    pa: 'ਕਾਰ ਸੌਂਪਣਾ',
  },
  // What each part covers. Phone-recorded values are worded as what the
  // driver logged on the phone, and driver entries as the driver's own,
  // never as facts about where or when the car was (copy rules).
  'chain.covers.arrival': {
    en: 'The time and place you logged on your phone, the sign reading and the photo fingerprints.',
    'zh-CN': '你在手机上记录的时间和地点、标志的解读结果,以及照片指纹。',
    vi: 'Thời gian và địa điểm bạn ghi lại trên điện thoại, kết quả đọc biển báo và dấu vân tay số của ảnh.',
    id: 'Waktu dan tempat yang kamu catat di ponselmu, hasil baca rambu, dan sidik jari foto.',
    ko: '휴대폰에 기록한 시각과 장소, 표지판 판독 결과, 사진의 디지털 지문.',
    it: "L'ora e il luogo che hai registrato sul telefono, la lettura del cartello e le impronte digitali delle foto.",
    el: 'Η ώρα και το σημείο που κατέγραψες στο κινητό σου, η ανάγνωση της πινακίδας και τα αποτυπώματα των φωτογραφιών.',
    hi: 'आपने फ़ोन पर जो समय और जगह दर्ज की, साइन की रीडिंग और फोटो के फिंगरप्रिंट।',
    pa: "ਤੁਸੀਂ ਫ਼ੋਨ 'ਤੇ ਜੋ ਸਮਾਂ ਅਤੇ ਥਾਂ ਦਰਜ ਕੀਤੀ, ਚਿੰਨ੍ਹ ਦੀ ਰੀਡਿੰਗ ਅਤੇ ਫੋਟੋਆਂ ਦੇ ਫਿੰਗਰਪ੍ਰਿੰਟ।",
  },
  'chain.covers.arrivalNoSign': {
    en: 'The time and place you logged on your phone, and the photo fingerprints.',
    'zh-CN': '你在手机上记录的时间和地点,以及照片指纹。',
    vi: 'Thời gian và địa điểm bạn ghi lại trên điện thoại, và dấu vân tay số của ảnh.',
    id: 'Waktu dan tempat yang kamu catat di ponselmu, dan sidik jari foto.',
    ko: '휴대폰에 기록한 시각과 장소, 사진의 디지털 지문.',
    it: "L'ora e il luogo che hai registrato sul telefono, e le impronte digitali delle foto.",
    el: 'Η ώρα και το σημείο που κατέγραψες στο κινητό σου, και τα αποτυπώματα των φωτογραφιών.',
    hi: 'आपने फ़ोन पर जो समय और जगह दर्ज की, और फोटो के फिंगरप्रिंट।',
    pa: "ਤੁਸੀਂ ਫ਼ੋਨ 'ਤੇ ਜੋ ਸਮਾਂ ਅਤੇ ਥਾਂ ਦਰਜ ਕੀਤੀ, ਅਤੇ ਫੋਟੋਆਂ ਦੇ ਫਿੰਗਰਪ੍ਰਿੰਟ।",
  },
  'chain.covers.arrivalContext': {
    en: 'What you added when you parked, such as who you said was driving, your answers and photo fingerprints.',
    'zh-CN': '你停车时补充的内容,例如你填写的驾驶员、你的回答和照片指纹。',
    vi: 'Những gì bạn thêm khi đỗ xe, ví dụ tài xế mà bạn đã ghi, câu trả lời của bạn và dấu vân tay số của ảnh.',
    id: 'Yang kamu tambahkan saat parkir, misalnya pengemudi yang kamu sebutkan, jawabanmu, dan sidik jari foto.',
    ko: '주차할 때 추가한 내용(예: 직접 적은 운전자, 답변, 사진의 디지털 지문).',
    it: 'Quello che hai aggiunto quando hai parcheggiato, ad esempio chi hai indicato come conducente, le tue risposte e le impronte digitali delle foto.',
    el: 'Ό,τι πρόσθεσες όταν πάρκαρες, όπως ποιον δήλωσες ως οδηγό, οι απαντήσεις σου και τα αποτυπώματα των φωτογραφιών.',
    hi: 'पार्क करते समय आपने जो जोड़ा, जैसे आपने चालक के रूप में किसका नाम लिखा, आपके जवाब और फोटो के फिंगरप्रिंट।',
    pa: 'ਪਾਰਕ ਕਰਦੇ ਸਮੇਂ ਤੁਸੀਂ ਜੋ ਜੋੜਿਆ, ਜਿਵੇਂ ਤੁਸੀਂ ਡਰਾਈਵਰ ਵਜੋਂ ਕਿਸ ਦਾ ਨਾਮ ਲਿਖਿਆ, ਤੁਹਾਡੇ ਜਵਾਬ ਅਤੇ ਫੋਟੋਆਂ ਦੇ ਫਿੰਗਰਪ੍ਰਿੰਟ।',
  },
  'chain.covers.condition': {
    en: "Fingerprints of your photos of the car's condition, and your note.",
    'zh-CN': '你拍摄的车况照片的指纹,以及你的备注。',
    vi: 'Dấu vân tay số của các ảnh tình trạng xe bạn chụp, và ghi chú của bạn.',
    id: 'Sidik jari foto kondisi mobil yang kamu ambil, dan catatanmu.',
    ko: '직접 찍은 차량 상태 사진의 디지털 지문과 메모.',
    it: "Le impronte digitali delle tue foto delle condizioni dell'auto e la tua nota.",
    el: 'Τα αποτυπώματα των φωτογραφιών σου για την κατάσταση του αυτοκινήτου, και η σημείωσή σου.',
    hi: 'कार की हालत की आपकी फोटो के फिंगरप्रिंट, और आपका नोट।',
    pa: 'ਕਾਰ ਦੀ ਹਾਲਤ ਦੀਆਂ ਤੁਹਾਡੀਆਂ ਫੋਟੋਆਂ ਦੇ ਫਿੰਗਰਪ੍ਰਿੰਟ, ਅਤੇ ਤੁਹਾਡਾ ਨੋਟ।',
  },
  'chain.covers.compliance': {
    en: 'The fingerprint of your photo of a meter ticket, payment confirmation or permit.',
    'zh-CN': '你拍摄的停车缴费票据、付款确认或许可证照片的指纹。',
    vi: 'Dấu vân tay số của ảnh bạn chụp vé máy đỗ xe, xác nhận thanh toán hoặc giấy phép.',
    id: 'Sidik jari foto karcis meteran parkir, bukti pembayaran, atau izin yang kamu ambil.',
    ko: '직접 찍은 주차 미터기 영수증, 결제 확인 또는 허가증 사진의 디지털 지문.',
    it: "L'impronta digitale della tua foto di un tagliando del parchimetro, di una conferma di pagamento o di un permesso.",
    el: 'Το αποτύπωμα της φωτογραφίας σου με ένα απόκομμα από το μηχάνημα στάθμευσης, μια επιβεβαίωση πληρωμής ή μια άδεια.',
    hi: 'पार्किंग मीटर की पर्ची, भुगतान की पुष्टि या परमिट की आपकी फोटो का फिंगरप्रिंट।',
    pa: 'ਪਾਰਕਿੰਗ ਮੀਟਰ ਦੀ ਪਰਚੀ, ਭੁਗਤਾਨ ਦੀ ਪੁਸ਼ਟੀ ਜਾਂ ਪਰਮਿਟ ਦੀ ਤੁਹਾਡੀ ਫੋਟੋ ਦਾ ਫਿੰਗਰਪ੍ਰਿੰਟ।',
  },
  // A departure signed without a location (catch-up, refused or rough GPS) covers no place.
  'chain.covers.departure': {
    en: "When you tapped I've left (phone clock), and where your phone was if a location was captured.",
    'zh-CN': '你点按"我已离开"的时间(手机时钟),以及手机当时的位置(如果获取到了位置)。',
    vi: 'Lúc bạn nhấn "Tôi đã đi" (đồng hồ điện thoại), và vị trí của điện thoại khi đó nếu đã lấy được vị trí.',
    id: 'Kapan kamu mengetuk "Sudah pergi" (jam ponsel), dan di mana ponselmu saat itu jika lokasinya didapat.',
    ko: '"떠났습니다"를 누른 시각(휴대폰 시계)과, 위치를 확인한 경우 그때 휴대폰의 위치.',
    it: 'Quando hai toccato "Ho lasciato il posto" (orologio del telefono) e dove si trovava il telefono, se la posizione è stata rilevata.',
    el: 'Πότε πάτησες «Έφυγα» (ρολόι κινητού), και πού ήταν το κινητό σου, αν καταγράφηκε τοποθεσία.',
    hi: 'आपने "मैंने जगह खाली कर दी" पर कब टैप किया (फ़ोन की घड़ी), और लोकेशन मिलने पर तब आपका फ़ोन कहाँ था।',
    pa: 'ਤੁਸੀਂ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" \'ਤੇ ਕਦੋਂ ਟੈਪ ਕੀਤਾ (ਫ਼ੋਨ ਦੀ ਘੜੀ), ਅਤੇ ਸਥਾਨ ਮਿਲਣ \'ਤੇ ਉਦੋਂ ਤੁਹਾਡਾ ਫ਼ੋਨ ਕਿੱਥੇ ਸੀ।',
  },
  'chain.covers.handover': {
    en: 'Who you said you handed the car to, and when you recorded it.',
    'zh-CN': '你填写的接车人,以及你记录交车的时间。',
    vi: 'Người mà bạn ghi là đã nhận xe, và lúc bạn ghi lại việc đó.',
    id: 'Siapa yang kamu sebut menerima mobil, dan kapan kamu mencatatnya.',
    ko: '직접 적은 차량 인수자와, 그것을 기록한 시각.',
    it: "A chi hai indicato di aver passato l'auto, e quando l'hai registrato.",
    el: 'Σε ποιον δήλωσες ότι έδωσες το αυτοκίνητο, και πότε το κατέγραψες.',
    hi: 'आपने कार किसे सौंपने की बात बताई, और आपने यह कब दर्ज किया।',
    pa: 'ਤੁਸੀਂ ਕਾਰ ਕਿਸ ਨੂੰ ਸੌਂਪਣ ਦੀ ਗੱਲ ਦੱਸੀ, ਅਤੇ ਤੁਸੀਂ ਇਹ ਕਦੋਂ ਦਰਜ ਕੀਤਾ।',
  },
  // ParkProof's server time. Also the departure row's signing line.
  'chain.signedAt': {
    en: 'Signed by ParkProof at {{time}}.',
    'zh-CN': 'ParkProof 签名时间:{{time}}。',
    vi: 'ParkProof đã ký lúc {{time}}.',
    id: 'Ditandatangani ParkProof pada {{time}}.',
    ko: 'ParkProof 서명 시각: {{time}}.',
    it: 'Firma di ParkProof: {{time}}.',
    el: 'Υπογραφή ParkProof: {{time}}.',
    hi: 'ParkProof ने {{time}} पर हस्ताक्षर किए।',
    pa: "ParkProof ਨੇ {{time}} 'ਤੇ ਹਸਤਾਖਰ ਕੀਤੇ।",
  },
  // A `npm run dev` signature: never "Signed by ParkProof".
  'chain.devKeySignedAt': {
    en: "Signed at {{time}} with a development key, not ParkProof's published key.",
    'zh-CN': '于 {{time}} 使用开发密钥签名,不是 ParkProof 公布的密钥。',
    vi: 'Đã ký lúc {{time}} bằng khóa phát triển, không phải khóa công khai mà ParkProof đã công bố.',
    id: 'Ditandatangani pada {{time}} dengan kunci pengembangan, bukan kunci publik yang diterbitkan ParkProof.',
    ko: '{{time}}에 개발용 키로 서명됨. ParkProof가 공개한 키가 아닙니다.',
    it: 'Firma con una chiave di sviluppo, non con quella pubblicata da ParkProof: {{time}}.',
    el: 'Υπογραφή με κλειδί ανάπτυξης, όχι με το δημοσιευμένο κλειδί του ParkProof: {{time}}.',
    hi: '{{time}} पर डेवलपमेंट कुंजी से हस्ताक्षरित, ParkProof की प्रकाशित कुंजी से नहीं।',
    pa: "{{time}} 'ਤੇ ਡਿਵੈਲਪਮੈਂਟ ਕੁੰਜੀ ਨਾਲ ਹਸਤਾਖਰਿਤ, ParkProof ਦੀ ਪ੍ਰਕਾਸ਼ਿਤ ਕੁੰਜੀ ਨਾਲ ਨਹੀਂ।",
  },
  'chain.check': {
    en: 'Check signatures',
    'zh-CN': '核验签名',
    vi: 'Kiểm tra chữ ký',
    id: 'Cek tanda tangan',
    ko: '서명 확인',
    it: 'Verifica le firme',
    el: 'Έλεγχος υπογραφών',
    hi: 'हस्ताक्षर जांचें',
    pa: 'ਹਸਤਾਖਰ ਜਾਂਚੋ',
  },
  'chain.checking': {
    en: 'Checking…',
    'zh-CN': '正在核验…',
    vi: 'Đang kiểm tra…',
    id: 'Mengecek…',
    ko: '확인 중…',
    it: 'Verifica in corso…',
    el: 'Έλεγχος…',
    hi: 'जांच हो रही है…',
    pa: 'ਜਾਂਚ ਹੋ ਰਹੀ ਹੈ…',
  },
  // Every signed part checks out. zh-CN, vi, id and ko only use _other, so
  // their _other reads right for one signature too. Both forms carry
  // {{count}} in every locale (i18n rules).
  'chain.checkValid_one': {
    en: "{{count}} signature is valid. Nothing has changed since ParkProof signed it. That doesn't show what the record says is true.",
    'zh-CN': '{{count}} 个签名有效。自 ParkProof 签名以来没有任何改动。但这不能说明记录的内容属实。',
    vi: 'Tất cả chữ ký đều hợp lệ ({{count}}). Không có gì thay đổi kể từ khi ParkProof ký. Điều đó không cho thấy nội dung bản ghi là đúng.',
    id: 'Semua tanda tangan valid ({{count}}). Tidak ada yang berubah sejak ParkProof menandatanganinya. Itu tidak menunjukkan isi catatan ini benar.',
    ko: '서명이 모두 유효합니다({{count}}개). ParkProof가 서명한 뒤로 바뀐 것이 없습니다. 그렇다고 기록 내용이 사실이라는 뜻은 아닙니다.',
    it: "{{count}} firma è valida. Nulla è cambiato da quando ParkProof l'ha firmato. Questo non mostra che quanto dice il record sia vero.",
    el: '{{count}} υπογραφή είναι έγκυρη. Τίποτα δεν έχει αλλάξει από τότε που την υπέγραψε το ParkProof. Αυτό δεν δείχνει ότι όσα λέει η εγγραφή είναι αληθινά.',
    hi: '{{count}} हस्ताक्षर मान्य है। ParkProof के हस्ताक्षर करने के बाद से कुछ नहीं बदला है। इससे यह पता नहीं चलता कि रिकॉर्ड में लिखी बातें सच हैं।',
    pa: '{{count}} ਹਸਤਾਖਰ ਵੈਧ ਹੈ। ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਕੁਝ ਨਹੀਂ ਬਦਲਿਆ। ਇਸ ਤੋਂ ਇਹ ਪਤਾ ਨਹੀਂ ਲੱਗਦਾ ਕਿ ਰਿਕਾਰਡ ਵਿੱਚ ਲਿਖੀਆਂ ਗੱਲਾਂ ਸੱਚ ਹਨ।',
  },
  'chain.checkValid_other': {
    en: "All {{count}} signatures are valid. Nothing has changed since ParkProof signed it. That doesn't show what the record says is true.",
    'zh-CN': '{{count}} 个签名均有效。自 ParkProof 签名以来没有任何改动。但这不能说明记录的内容属实。',
    vi: 'Tất cả chữ ký đều hợp lệ ({{count}}). Không có gì thay đổi kể từ khi ParkProof ký. Điều đó không cho thấy nội dung bản ghi là đúng.',
    id: 'Semua tanda tangan valid ({{count}}). Tidak ada yang berubah sejak ParkProof menandatanganinya. Itu tidak menunjukkan isi catatan ini benar.',
    ko: '서명이 모두 유효합니다({{count}}개). ParkProof가 서명한 뒤로 바뀐 것이 없습니다. 그렇다고 기록 내용이 사실이라는 뜻은 아닙니다.',
    it: "Tutte le {{count}} firme sono valide. Nulla è cambiato da quando ParkProof l'ha firmato. Questo non mostra che quanto dice il record sia vero.",
    el: 'Και οι {{count}} υπογραφές είναι έγκυρες. Τίποτα δεν έχει αλλάξει από τότε που την υπέγραψε το ParkProof. Αυτό δεν δείχνει ότι όσα λέει η εγγραφή είναι αληθινά.',
    hi: 'सभी {{count}} हस्ताक्षर मान्य हैं। ParkProof के हस्ताक्षर करने के बाद से कुछ नहीं बदला है। इससे यह पता नहीं चलता कि रिकॉर्ड में लिखी बातें सच हैं।',
    pa: 'ਸਾਰੇ {{count}} ਹਸਤਾਖਰ ਵੈਧ ਹਨ। ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਕੁਝ ਨਹੀਂ ਬਦਲਿਆ। ਇਸ ਤੋਂ ਇਹ ਪਤਾ ਨਹੀਂ ਲੱਗਦਾ ਕਿ ਰਿਕਾਰਡ ਵਿੱਚ ਲਿਖੀਆਂ ਗੱਲਾਂ ਸੱਚ ਹਨ।',
  },
  // Signed photos not on this device were never compared, so no "Nothing has changed".
  'chain.checkValidPhotosUnchecked_one': {
    en: "{{count}} signature is valid. Some photos aren't on this device, so they couldn't be compared with their fingerprints. That doesn't show what the record says is true.",
    'zh-CN': '{{count}} 个签名有效。有些照片不在这台设备上,无法与其指纹比对。但这不能说明记录的内容属实。',
    vi: 'Tất cả chữ ký đều hợp lệ ({{count}}). Một số ảnh không có trên thiết bị này nên không thể so với dấu vân tay số của chúng. Điều đó không cho thấy nội dung bản ghi là đúng.',
    id: 'Semua tanda tangan valid ({{count}}). Beberapa foto tidak ada di perangkat ini, jadi tidak bisa dicocokkan dengan sidik jarinya. Itu tidak menunjukkan isi catatan ini benar.',
    ko: '서명이 모두 유효합니다({{count}}개). 일부 사진이 이 기기에 없어 디지털 지문과 비교하지 못했습니다. 그렇다고 기록 내용이 사실이라는 뜻은 아닙니다.',
    it: "{{count}} firma è valida. Alcune foto non sono su questo dispositivo, quindi non è stato possibile confrontarle con le loro impronte digitali. Questo non mostra che quanto dice il record sia vero.",
    el: '{{count}} υπογραφή είναι έγκυρη. Κάποιες φωτογραφίες δεν βρίσκονται σε αυτή τη συσκευή, οπότε δεν ήταν δυνατό να συγκριθούν με τα αποτυπώματά τους. Αυτό δεν δείχνει ότι όσα λέει η εγγραφή είναι αληθινά.',
    hi: '{{count}} हस्ताक्षर मान्य है। कुछ फोटो इस डिवाइस पर नहीं हैं, इसलिए उनका मिलान उनके फिंगरप्रिंट से नहीं किया जा सका। इससे यह पता नहीं चलता कि रिकॉर्ड में लिखी बातें सच हैं।',
    pa: "{{count}} ਹਸਤਾਖਰ ਵੈਧ ਹੈ। ਕੁਝ ਫੋਟੋਆਂ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਨਹੀਂ ਹਨ, ਇਸ ਲਈ ਉਨ੍ਹਾਂ ਦਾ ਮਿਲਾਨ ਉਨ੍ਹਾਂ ਦੇ ਫਿੰਗਰਪ੍ਰਿੰਟ ਨਾਲ ਨਹੀਂ ਹੋ ਸਕਿਆ। ਇਸ ਤੋਂ ਇਹ ਪਤਾ ਨਹੀਂ ਲੱਗਦਾ ਕਿ ਰਿਕਾਰਡ ਵਿੱਚ ਲਿਖੀਆਂ ਗੱਲਾਂ ਸੱਚ ਹਨ।",
  },
  'chain.checkValidPhotosUnchecked_other': {
    en: "All {{count}} signatures are valid. Some photos aren't on this device, so they couldn't be compared with their fingerprints. That doesn't show what the record says is true.",
    'zh-CN': '{{count}} 个签名均有效。有些照片不在这台设备上,无法与其指纹比对。但这不能说明记录的内容属实。',
    vi: 'Tất cả chữ ký đều hợp lệ ({{count}}). Một số ảnh không có trên thiết bị này nên không thể so với dấu vân tay số của chúng. Điều đó không cho thấy nội dung bản ghi là đúng.',
    id: 'Semua tanda tangan valid ({{count}}). Beberapa foto tidak ada di perangkat ini, jadi tidak bisa dicocokkan dengan sidik jarinya. Itu tidak menunjukkan isi catatan ini benar.',
    ko: '서명이 모두 유효합니다({{count}}개). 일부 사진이 이 기기에 없어 디지털 지문과 비교하지 못했습니다. 그렇다고 기록 내용이 사실이라는 뜻은 아닙니다.',
    it: 'Tutte le {{count}} firme sono valide. Alcune foto non sono su questo dispositivo, quindi non è stato possibile confrontarle con le loro impronte digitali. Questo non mostra che quanto dice il record sia vero.',
    el: 'Και οι {{count}} υπογραφές είναι έγκυρες. Κάποιες φωτογραφίες δεν βρίσκονται σε αυτή τη συσκευή, οπότε δεν ήταν δυνατό να συγκριθούν με τα αποτυπώματά τους. Αυτό δεν δείχνει ότι όσα λέει η εγγραφή είναι αληθινά.',
    hi: 'सभी {{count}} हस्ताक्षर मान्य हैं। कुछ फोटो इस डिवाइस पर नहीं हैं, इसलिए उनका मिलान उनके फिंगरप्रिंट से नहीं किया जा सका। इससे यह पता नहीं चलता कि रिकॉर्ड में लिखी बातें सच हैं।',
    pa: "ਸਾਰੇ {{count}} ਹਸਤਾਖਰ ਵੈਧ ਹਨ। ਕੁਝ ਫੋਟੋਆਂ ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਨਹੀਂ ਹਨ, ਇਸ ਲਈ ਉਨ੍ਹਾਂ ਦਾ ਮਿਲਾਨ ਉਨ੍ਹਾਂ ਦੇ ਫਿੰਗਰਪ੍ਰਿੰਟ ਨਾਲ ਨਹੀਂ ਹੋ ਸਕਿਆ। ਇਸ ਤੋਂ ਇਹ ਪਤਾ ਨਹੀਂ ਲੱਗਦਾ ਕਿ ਰਿਕਾਰਡ ਵਿੱਚ ਲਿਖੀਆਂ ਗੱਲਾਂ ਸੱਚ ਹਨ।",
  },
  // No direction: photo results sit below the summary, part results above it.
  'chain.checkProblem': {
    en: "At least one part or photo didn't pass the check. The result for each one is shown here.",
    'zh-CN': '至少有一个部分或一张照片没有通过核验。每一项的结果都显示在这里。',
    vi: 'Có ít nhất một phần hoặc một ảnh không vượt qua bước kiểm tra. Kết quả của từng mục được hiển thị tại đây.',
    id: 'Setidaknya satu bagian atau foto tidak lolos pengecekan. Hasil masing-masing ditampilkan di sini.',
    ko: '확인을 통과하지 못한 부분이나 사진이 하나 이상 있습니다. 각 항목의 결과가 여기에 표시됩니다.',
    it: 'Almeno una parte o una foto non ha superato la verifica. Il risultato di ciascuna è mostrato qui.',
    el: 'Τουλάχιστον ένα τμήμα ή μία φωτογραφία δεν πέρασε τον έλεγχο. Το αποτέλεσμα για το καθένα φαίνεται εδώ.',
    hi: 'कम से कम एक हिस्से या फोटो की जांच सफल नहीं रही। हर एक का नतीजा यहाँ दिखाया गया है।',
    pa: 'ਘੱਟੋ-ਘੱਟ ਇੱਕ ਹਿੱਸੇ ਜਾਂ ਫੋਟੋ ਦੀ ਜਾਂਚ ਸਫਲ ਨਹੀਂ ਰਹੀ। ਹਰ ਇੱਕ ਦਾ ਨਤੀਜਾ ਇੱਥੇ ਦਿਖਾਇਆ ਗਿਆ ਹੈ।',
  },
  // A result for a chain that changed since (a part got signed meanwhile).
  'chain.checkChanged': {
    en: 'The record changed after the check started. Check again.',
    'zh-CN': '核验开始后这条记录有了变化。请重新核验。',
    vi: 'Bản ghi đã thay đổi sau khi bắt đầu kiểm tra. Hãy kiểm tra lại.',
    id: 'Catatan ini berubah setelah pengecekan dimulai. Cek lagi.',
    ko: '확인을 시작한 뒤 기록이 바뀌었습니다. 다시 확인하세요.',
    it: "Il record è cambiato dopo l'inizio della verifica. Verifica di nuovo.",
    el: 'Η εγγραφή άλλαξε αφού ξεκίνησε ο έλεγχος. Έλεγξε ξανά.',
    hi: 'जांच शुरू होने के बाद रिकॉर्ड बदल गया। फिर से जांचें।',
    pa: 'ਜਾਂਚ ਸ਼ੁਰੂ ਹੋਣ ਤੋਂ ਬਾਅਦ ਰਿਕਾਰਡ ਬਦਲ ਗਿਆ। ਦੁਬਾਰਾ ਜਾਂਚੋ।',
  },
  // The collapsed panel's one-line state (verifier.link.pending when none are signed).
  'chain.summary_one': {
    en: '{{count}} part signed',
    'zh-CN': '已签名 {{count}} 个部分',
    vi: 'Đã ký {{count}} phần',
    id: '{{count}} bagian ditandatangani',
    ko: '서명된 부분 {{count}}개',
    it: '{{count}} parte firmata',
    el: '{{count}} τμήμα υπογεγραμμένο',
    hi: '{{count}} हिस्सा हस्ताक्षरित',
    pa: '{{count}} ਹਿੱਸਾ ਹਸਤਾਖਰਿਤ',
  },
  'chain.summary_other': {
    en: '{{count}} parts signed',
    'zh-CN': '已签名 {{count}} 个部分',
    vi: 'Đã ký {{count}} phần',
    id: '{{count}} bagian ditandatangani',
    ko: '서명된 부분 {{count}}개',
    it: '{{count}} parti firmate',
    el: '{{count}} τμήματα υπογεγραμμένα',
    hi: '{{count}} हिस्से हस्ताक्षरित',
    pa: '{{count}} ਹਿੱਸੇ ਹਸਤਾਖਰਿਤ',
  },
  'chain.checkDevKey': {
    en: "Parts of this record were signed with a development key. They can't be checked with ParkProof's published key.",
    'zh-CN': '这条记录有部分使用开发密钥签名。无法用 ParkProof 公布的公钥核验。',
    vi: 'Một số phần của bản ghi này được ký bằng khóa phát triển. Không thể kiểm tra chúng bằng khóa công khai mà ParkProof đã công bố.',
    id: 'Sebagian catatan ini ditandatangani dengan kunci pengembangan. Bagian itu tidak bisa dicek dengan kunci publik yang diterbitkan ParkProof.',
    ko: '이 기록의 일부는 개발용 키로 서명되었습니다. ParkProof가 공개한 키로는 확인할 수 없습니다.',
    it: 'Alcune parti di questo record sono firmate con una chiave di sviluppo. Non si possono verificare con la chiave pubblicata da ParkProof.',
    el: 'Τμήματα αυτής της εγγραφής υπογράφηκαν με κλειδί ανάπτυξης. Δεν μπορούν να ελεγχθούν με το δημοσιευμένο κλειδί του ParkProof.',
    hi: 'इस रिकॉर्ड के कुछ हिस्से डेवलपमेंट कुंजी से हस्ताक्षरित हैं। उन्हें ParkProof की प्रकाशित कुंजी से जांचा नहीं जा सकता।',
    pa: 'ਇਸ ਰਿਕਾਰਡ ਦੇ ਕੁਝ ਹਿੱਸੇ ਡਿਵੈਲਪਮੈਂਟ ਕੁੰਜੀ ਨਾਲ ਹਸਤਾਖਰਿਤ ਹਨ। ਉਨ੍ਹਾਂ ਨੂੰ ParkProof ਦੀ ਪ੍ਰਕਾਸ਼ਿਤ ਕੁੰਜੀ ਨਾਲ ਜਾਂਚਿਆ ਨਹੀਂ ਜਾ ਸਕਦਾ।',
  },
  'chain.checkUnsigned': {
    en: 'Nothing on this record is signed yet.',
    'zh-CN': '这条记录还没有任何已签名的部分。',
    vi: 'Bản ghi này chưa có phần nào được ký.',
    id: 'Belum ada bagian catatan ini yang ditandatangani.',
    ko: '이 기록에는 아직 서명된 부분이 없습니다.',
    it: "In questo record non c'è ancora nulla di firmato.",
    el: 'Τίποτα σε αυτή την εγγραφή δεν έχει υπογραφεί ακόμα.',
    hi: 'इस रिकॉर्ड पर अभी कुछ भी हस्ताक्षरित नहीं है।',
    pa: "ਇਸ ਰਿਕਾਰਡ 'ਤੇ ਅਜੇ ਕੁਝ ਵੀ ਹਸਤਾਖਰਿਤ ਨਹੀਂ ਹੈ।",
  },
  'chain.checkUnavailable': {
    en: "This browser can't check signatures. Try an up-to-date browser.",
    'zh-CN': '这个浏览器无法核验签名。请使用最新版本的浏览器。',
    vi: 'Trình duyệt này không thể kiểm tra chữ ký. Hãy dùng một trình duyệt mới hơn.',
    id: 'Browser ini tidak bisa mengecek tanda tangan. Coba browser versi terbaru.',
    ko: '이 브라우저에서는 서명을 확인할 수 없습니다. 최신 브라우저를 사용해 보세요.',
    it: 'Questo browser non può verificare le firme. Prova con un browser aggiornato.',
    el: 'Αυτό το πρόγραμμα περιήγησης δεν μπορεί να ελέγξει υπογραφές. Δοκίμασε ένα ενημερωμένο πρόγραμμα περιήγησης.',
    hi: 'यह ब्राउज़र हस्ताक्षर नहीं जांच सकता। कोई अपडेटेड ब्राउज़र आज़माएँ।',
    pa: 'ਇਹ ਬ੍ਰਾਊਜ਼ਰ ਹਸਤਾਖਰ ਨਹੀਂ ਜਾਂਚ ਸਕਦਾ। ਕੋਈ ਅੱਪਡੇਟ ਕੀਤਾ ਬ੍ਰਾਊਜ਼ਰ ਵਰਤ ਕੇ ਦੇਖੋ।',
  },
  'chain.checkFailed': {
    en: "The check didn't finish. Try again.",
    'zh-CN': '核验没有完成。请重试。',
    vi: 'Việc kiểm tra chưa hoàn tất. Hãy thử lại.',
    id: 'Pengecekan belum selesai. Coba lagi.',
    ko: '확인을 마치지 못했습니다. 다시 시도하세요.',
    it: 'La verifica non è terminata. Riprova.',
    el: 'Ο έλεγχος δεν ολοκληρώθηκε. Δοκίμασε ξανά.',
    hi: 'जांच पूरी नहीं हुई। फिर से कोशिश करें।',
    pa: 'ਜਾਂਚ ਪੂਰੀ ਨਹੀਂ ਹੋਈ। ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
  },
  'chain.photosHeading': {
    en: 'PHOTOS',
    'zh-CN': '照片',
    vi: 'ẢNH',
    id: 'FOTO',
    ko: '사진',
    it: 'FOTO',
    el: 'ΦΩΤΟΓΡΑΦΙΕΣ',
    hi: 'फोटो',
    pa: 'ਫੋਟੋਆਂ',
  },
  // Photo roles (chain-view.ts PHOTO_ROLE_KEYS). The condition and return
  // roles are filled in by T2.
  'chain.photoRole.sign': {
    en: 'Sign photo',
    'zh-CN': '标志照片',
    vi: 'Ảnh biển báo',
    id: 'Foto rambu',
    ko: '표지판 사진',
    it: 'Foto del cartello',
    el: 'Φωτογραφία πινακίδας',
    hi: 'साइन की फोटो',
    pa: 'ਚਿੰਨ੍ਹ ਦੀ ਫੋਟੋ',
  },
  'chain.photoRole.car': {
    en: 'Car photo',
    'zh-CN': '车辆照片',
    vi: 'Ảnh xe',
    id: 'Foto mobil',
    ko: '차량 사진',
    it: "Foto dell'auto",
    el: 'Φωτογραφία αυτοκινήτου',
    hi: 'कार की फोटो',
    pa: 'ਕਾਰ ਦੀ ਫੋਟੋ',
  },
  'chain.photoRole.ambient': {
    en: 'Surroundings photo',
    'zh-CN': '周边环境照片',
    vi: 'Ảnh xung quanh',
    id: 'Foto sekitar',
    ko: '주변 사진',
    it: 'Foto dei dintorni',
    el: 'Φωτογραφία περιοχής',
    hi: 'आसपास की फोटो',
    pa: 'ਆਲੇ-ਦੁਆਲੇ ਦੀ ਫੋਟੋ',
  },
  'chain.photoRole.conditionFront': {
    en: 'Condition when parked, front',
    'zh-CN': '停车时车况:车头',
    vi: 'Tình trạng khi đỗ, phía trước',
    id: 'Kondisi saat parkir, depan',
    ko: '주차 시 상태, 앞',
    it: 'Condizioni al parcheggio, davanti',
    el: 'Κατάσταση στη στάθμευση, μπροστά',
    hi: 'पार्क करते समय हालत, आगे',
    pa: 'ਪਾਰਕ ਕਰਦੇ ਸਮੇਂ ਹਾਲਤ, ਅੱਗੇ',
  },
  'chain.photoRole.conditionRear': {
    en: 'Condition when parked, rear',
    'zh-CN': '停车时车况:车尾',
    vi: 'Tình trạng khi đỗ, phía sau',
    id: 'Kondisi saat parkir, belakang',
    ko: '주차 시 상태, 뒤',
    it: 'Condizioni al parcheggio, dietro',
    el: 'Κατάσταση στη στάθμευση, πίσω',
    hi: 'पार्क करते समय हालत, पीछे',
    pa: 'ਪਾਰਕ ਕਰਦੇ ਸਮੇਂ ਹਾਲਤ, ਪਿੱਛੇ',
  },
  'chain.photoRole.conditionLeft': {
    en: 'Condition when parked, left side',
    'zh-CN': '停车时车况:左侧',
    vi: 'Tình trạng khi đỗ, bên trái',
    id: 'Kondisi saat parkir, sisi kiri',
    ko: '주차 시 상태, 왼쪽',
    it: 'Condizioni al parcheggio, lato sinistro',
    el: 'Κατάσταση στη στάθμευση, αριστερή πλευρά',
    hi: 'पार्क करते समय हालत, बायाँ हिस्सा',
    pa: 'ਪਾਰਕ ਕਰਦੇ ਸਮੇਂ ਹਾਲਤ, ਖੱਬਾ ਪਾਸਾ',
  },
  'chain.photoRole.conditionRight': {
    en: 'Condition when parked, right side',
    'zh-CN': '停车时车况:右侧',
    vi: 'Tình trạng khi đỗ, bên phải',
    id: 'Kondisi saat parkir, sisi kanan',
    ko: '주차 시 상태, 오른쪽',
    it: 'Condizioni al parcheggio, lato destro',
    el: 'Κατάσταση στη στάθμευση, δεξιά πλευρά',
    hi: 'पार्क करते समय हालत, दायाँ हिस्सा',
    pa: 'ਪਾਰਕ ਕਰਦੇ ਸਮੇਂ ਹਾਲਤ, ਸੱਜਾ ਪਾਸਾ',
  },
  'chain.photoRole.conditionDetail': {
    en: 'Condition when parked, close-up',
    'zh-CN': '停车时车况:特写',
    vi: 'Tình trạng khi đỗ, cận cảnh',
    id: 'Kondisi saat parkir, jarak dekat',
    ko: '주차 시 상태, 근접',
    it: 'Condizioni al parcheggio, dettaglio',
    el: 'Κατάσταση στη στάθμευση, κοντινό',
    hi: 'पार्क करते समय हालत, क्लोज़-अप',
    pa: 'ਪਾਰਕ ਕਰਦੇ ਸਮੇਂ ਹਾਲਤ, ਨੇੜਿਓਂ',
  },
  'chain.photoRole.returnFront': {
    en: 'Condition on return, front',
    'zh-CN': '返回时车况:车头',
    vi: 'Tình trạng khi quay lại, phía trước',
    id: 'Kondisi saat kembali, depan',
    ko: '돌아왔을 때 상태, 앞',
    it: 'Condizioni al ritorno, davanti',
    el: 'Κατάσταση στην επιστροφή, μπροστά',
    hi: 'लौटने पर हालत, आगे',
    pa: "ਵਾਪਸ ਆਉਣ 'ਤੇ ਹਾਲਤ, ਅੱਗੇ",
  },
  'chain.photoRole.returnRear': {
    en: 'Condition on return, rear',
    'zh-CN': '返回时车况:车尾',
    vi: 'Tình trạng khi quay lại, phía sau',
    id: 'Kondisi saat kembali, belakang',
    ko: '돌아왔을 때 상태, 뒤',
    it: 'Condizioni al ritorno, dietro',
    el: 'Κατάσταση στην επιστροφή, πίσω',
    hi: 'लौटने पर हालत, पीछे',
    pa: "ਵਾਪਸ ਆਉਣ 'ਤੇ ਹਾਲਤ, ਪਿੱਛੇ",
  },
  'chain.photoRole.returnLeft': {
    en: 'Condition on return, left side',
    'zh-CN': '返回时车况:左侧',
    vi: 'Tình trạng khi quay lại, bên trái',
    id: 'Kondisi saat kembali, sisi kiri',
    ko: '돌아왔을 때 상태, 왼쪽',
    it: 'Condizioni al ritorno, lato sinistro',
    el: 'Κατάσταση στην επιστροφή, αριστερή πλευρά',
    hi: 'लौटने पर हालत, बायाँ हिस्सा',
    pa: "ਵਾਪਸ ਆਉਣ 'ਤੇ ਹਾਲਤ, ਖੱਬਾ ਪਾਸਾ",
  },
  'chain.photoRole.returnRight': {
    en: 'Condition on return, right side',
    'zh-CN': '返回时车况:右侧',
    vi: 'Tình trạng khi quay lại, bên phải',
    id: 'Kondisi saat kembali, sisi kanan',
    ko: '돌아왔을 때 상태, 오른쪽',
    it: 'Condizioni al ritorno, lato destro',
    el: 'Κατάσταση στην επιστροφή, δεξιά πλευρά',
    hi: 'लौटने पर हालत, दायाँ हिस्सा',
    pa: "ਵਾਪਸ ਆਉਣ 'ਤੇ ਹਾਲਤ, ਸੱਜਾ ਪਾਸਾ",
  },
  'chain.photoRole.returnDetail': {
    en: 'Condition on return, close-up',
    'zh-CN': '返回时车况:特写',
    vi: 'Tình trạng khi quay lại, cận cảnh',
    id: 'Kondisi saat kembali, jarak dekat',
    ko: '돌아왔을 때 상태, 근접',
    it: 'Condizioni al ritorno, dettaglio',
    el: 'Κατάσταση στην επιστροφή, κοντινό',
    hi: 'लौटने पर हालत, क्लोज़-अप',
    pa: "ਵਾਪਸ ਆਉਣ 'ਤੇ ਹਾਲਤ, ਨੇੜਿਓਂ",
  },
  'chain.photoRole.compliance': {
    en: 'Proof of payment or permit photo',
    'zh-CN': '付款或许可证凭证照片',
    vi: 'Ảnh bằng chứng thanh toán hoặc giấy phép',
    id: 'Foto bukti pembayaran atau izin',
    ko: '결제 또는 허가증 증빙 사진',
    it: 'Foto della prova di pagamento o del permesso',
    el: 'Φωτογραφία απόδειξης πληρωμής ή άδειας',
    hi: 'भुगतान या परमिट के प्रमाण की फोटो',
    pa: 'ਭੁਗਤਾਨ ਜਾਂ ਪਰਮਿਟ ਦੇ ਸਬੂਤ ਦੀ ਫੋਟੋ',
  },

  // ── The departure row, when no departure part is coming ──
  // An old record ended before departures were signed, or a chain this
  // device can't add to. Unlike "Not signed yet", it promises nothing.
  'departure.notSigned': {
    en: "This departure isn't signed.",
    'zh-CN': '这次离开没有签名。',
    vi: 'Lần rời đi này không được ký.',
    id: 'Kepergian ini tidak ditandatangani.',
    ko: '이 출차 기록은 서명되지 않았습니다.',
    it: 'Questa partenza non è firmata.',
    el: 'Αυτή η αναχώρηση δεν είναι υπογεγραμμένη.',
    hi: 'यह प्रस्थान हस्ताक्षरित नहीं है।',
    pa: 'ਇਹ ਰਵਾਨਗੀ ਹਸਤਾਖਰਿਤ ਨਹੀਂ ਹੈ।',
  },

  // ── The record screen's STATUS for an ended record ──
  // The times are in the departure row below it (phone clock and
  // ParkProof's signing time), so the status itself carries no time.
  // Same word as session.endedAt in each locale.
  'session.ended': {
    en: 'Ended',
    'zh-CN': '已结束',
    vi: 'Đã kết thúc',
    id: 'Selesai',
    ko: '종료',
    it: 'Terminata',
    el: 'Τερματίστηκε',
    hi: 'समाप्त',
    pa: 'ਸਮਾਪਤ',
  },
}

// ── Existing strings this task rewrites (explicit overwrite list) ───────
// Each must already exist in every locale; the script aborts otherwise.
const OVERWRITES = {
  // Shown on the record screen's vault panel right above the chain panel,
  // and on About. The old text said the seal "proves" the record wasn't
  // changed "after you saved it"; records gain signed parts after saving
  // and are signed when the server receives them, which can be later.
  'about.sealCaveat': {
    en: "The seal shows the signed details haven't changed since ParkProof signed them. It doesn't show the AI read the sign correctly, or that a council will accept it.",
    'zh-CN': '数字签名表明,已签名的内容自 ParkProof 签名以来没有改动。它不能说明 AI 把标志读对了,也不能说明市议会一定会采信。',
    vi: 'Dấu niêm phong cho thấy các thông tin đã ký không thay đổi kể từ khi ParkProof ký. Nó không cho thấy AI đọc đúng biển báo, cũng không cho thấy hội đồng địa phương sẽ chấp nhận.',
    id: 'Segel ini menunjukkan detail yang ditandatangani tidak berubah sejak ParkProof menandatanganinya. Segel ini tidak menunjukkan AI membaca rambu dengan benar, atau bahwa dewan kota akan menerimanya.',
    ko: '이 봉인은 서명된 내용이 ParkProof가 서명한 뒤로 바뀌지 않았음을 보여 줍니다. AI가 표지판을 제대로 읽었는지, 의회가 받아들일지는 보여 주지 않습니다.',
    it: "Il sigillo mostra che i dati firmati non sono cambiati da quando ParkProof li ha firmati. Non mostra che l'AI abbia letto bene il cartello, né che un comune lo accetterà.",
    el: 'Η σφραγίδα δείχνει ότι τα υπογεγραμμένα στοιχεία δεν έχουν αλλάξει από τότε που τα υπέγραψε το ParkProof. Δεν δείχνει ότι το AI διάβασε σωστά την πινακίδα, ούτε ότι ένας δήμος θα την αποδεχτεί.',
    hi: 'यह मुहर दिखाती है कि हस्ताक्षरित विवरण ParkProof के हस्ताक्षर करने के बाद से नहीं बदले हैं। यह नहीं दिखाती कि AI ने साइन सही पढ़ा, या कि कोई परिषद इसे मानेगी।',
    pa: 'ਇਹ ਮੋਹਰ ਦਿਖਾਉਂਦੀ ਹੈ ਕਿ ਹਸਤਾਖਰਿਤ ਵੇਰਵੇ ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਨਹੀਂ ਬਦਲੇ। ਇਹ ਨਹੀਂ ਦਿਖਾਉਂਦੀ ਕਿ AI ਨੇ ਚਿੰਨ੍ਹ ਸਹੀ ਪੜ੍ਹਿਆ, ਜਾਂ ਕਿ ਕੋਈ ਕੌਂਸਲ ਇਸ ਨੂੰ ਮੰਨ ਲਵੇਗੀ।',
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
      if (s.includes('—')) problems.push(`em-dash in new copy at ${path}: ${s}`)
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
