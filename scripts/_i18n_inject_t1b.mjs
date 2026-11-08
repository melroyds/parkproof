/**
 * T1b i18n (roadmap build spec, task T1b: time zones, the PDF, and appeal
 * evidence). Idempotent: running it twice leaves the files byte-identical
 * after the first run.
 *
 * Adds, under `pdf`:
 *   - the record table's new rows (sessionRows in src/lib/pdf.ts): when
 *     ParkProof signed the arrival and the departure (server clock), the
 *     phone's location at the I've left tap and its distance from the
 *     arrival (phone GPS), a coordinates label for a location that isn't a
 *     GPS fix, and the signing states those rows can show;
 *   - the car photo caption's time label (phone clock);
 *   - the chained signature appendix: one heading per link, the fork note,
 *     the "repeat for each link" line and the chain step.
 *
 * Rewrites existing strings through the explicit OVERWRITES list (spec T1b
 * item 5, plus the strings the chained appendix and the phone-clock rule
 * make wrong): the closing statement, the appendix intro, verify steps 1,
 * 2, 6 and 7, the payload and signature block headers (now carry the link's
 * file name), the appendix signing-time label, the arrival labels (phone
 * clock), the full export's intro (it said the appendix was only in the
 * single-record PDF), the GPS notice title (a symbol the PDF fonts can't
 * draw) and about.evidence.items[1].
 *
 * After review it also adds the appendix part names (pdf.signature.kind.*,
 * PDF-only twins of chain.kind.* in characters the PDF fonts have), the AI
 * confidence values, the rough-distance values and the plus-or-minus sign
 * (the hi and pa PDF fonts have no ±); rewrites the chain step for
 * `openssl dgst -sha256`, and, in all 9 locales, the strings T1b now draws
 * in every PDF that broke the copy rules ("session", the surroundings
 * caption's claim, "see appendix", the em-dash empty mark); and, through
 * LOCALE_OVERWRITES, single-locale rewrites: zh-CN and ko strings reworded
 * into their subset fonts, and the em-dashes out of the locales that had them.
 *
 * Phone times are labelled as phone times; only ParkProof's signing times
 * are called signed. Writes nothing unless every locale passes the parity
 * checks (the same rules src/lib/locales.test.ts enforces).
 *
 * Run:   node scripts/_i18n_inject_t1b.mjs
 * List:  node scripts/_i18n_inject_t1b.mjs --list
 *        prints every key this task added or rewrote, for the T10
 *        translation review ('legal' marks the signature and time
 *        statements a lawyer should read, 'overwrite' an existing string
 *        rewritten).
 * Other: node scripts/_i18n_inject_t1b.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

/** Keys whose wording makes a claim about signatures, times or locations: for docs/legal-review-queue.md (T10). */
const LEGAL = new Set([
  'pdf.evidence.statement',
  'pdf.signature.intro',
  'pdf.signature.verifyStep6',
  'pdf.signature.verifyStep7',
  'about.evidence.items[1]',
  'pdf.fullExport.intro',
  'pdf.evidence.field.arrivedAt',
  'pdf.evidence.field.arrivalSigned',
  'pdf.evidence.field.departureSigned',
  'pdf.evidence.field.departureLocation',
  'pdf.evidence.field.departureDistance',
  'pdf.evidence.value.distanceUnavailable',
  'pdf.signature.signedAt',
  'pdf.evidence.ambientPhotoCaption',
  'pdf.evidence.noSignRules',
  'pdf.evidence.value.distanceRough',
  'pdf.evidence.value.distanceRoughNoAccuracy',
  'pdf.evidence.driverNoteUnsigned',
  'pdf.evidence.gpsNoticeBody',
])

// ── New keys, appended inside their parent object ────────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position). Missing parent objects are created,
// appended at the end of their own parent.
const ADDITIONS = {
  // ── Record table rows (sessionRows) ──
  // ParkProof's signing time for link 0 (the arrival), from the signed payload.
  'pdf.evidence.field.arrivalSigned': {
    en: 'Arrival signed by ParkProof (server clock)',
    'zh-CN': '到达部分由 ParkProof 签名的时间(服务器时钟)',
    vi: 'Phần lúc đến được ParkProof ký lúc (đồng hồ máy chủ)',
    id: 'Kedatangan ditandatangani ParkProof (jam server)',
    ko: '도착 부분 ParkProof 서명 시각 (서버 시계)',
    it: 'Parte di arrivo firmata da ParkProof (orologio del server)',
    el: 'Υπογραφή της άφιξης από το ParkProof (ρολόι διακομιστή)',
    hi: 'आगमन पर ParkProof के हस्ताक्षर (सर्वर की घड़ी)',
    pa: "ਆਮਦ 'ਤੇ ParkProof ਦੇ ਹਸਤਾਖਰ (ਸਰਵਰ ਦੀ ਘੜੀ)",
  },
  // ParkProof's signing time for the departure part. Comes right after
  // "Tapped I've left (phone clock)" (pdf.evidence.field.endedAt).
  'pdf.evidence.field.departureSigned': {
    en: 'Departure signed by ParkProof (server clock)',
    'zh-CN': '离开部分由 ParkProof 签名的时间(服务器时钟)',
    vi: 'Phần rời đi được ParkProof ký lúc (đồng hồ máy chủ)',
    id: 'Kepergian ditandatangani ParkProof (jam server)',
    ko: '출차 부분 ParkProof 서명 시각 (서버 시계)',
    it: 'Parte di partenza firmata da ParkProof (orologio del server)',
    el: 'Υπογραφή της αναχώρησης από το ParkProof (ρολόι διακομιστή)',
    hi: 'प्रस्थान पर ParkProof के हस्ताक्षर (सर्वर की घड़ी)',
    pa: "ਰਵਾਨਗੀ 'ਤੇ ParkProof ਦੇ ਹਸਤਾਖਰ (ਸਰਵਰ ਦੀ ਘੜੀ)",
  },
  // Where the PHONE was at the tap, not the car. Quotes each locale's "I've left" button.
  'pdf.evidence.field.departureLocation': {
    en: "Phone location at the I've left tap (GPS)",
    'zh-CN': '点击"我已离开"时手机的位置(GPS)',
    vi: 'Vị trí điện thoại lúc nhấn "Tôi đã đi" (GPS)',
    id: 'Lokasi ponsel saat mengetuk "Sudah pergi" (GPS)',
    ko: '"떠났습니다"를 누를 때 휴대폰 위치 (GPS)',
    it: 'Posizione del telefono al tocco su "Ho lasciato il posto" (GPS)',
    el: 'Θέση κινητού στο πάτημα «Έφυγα» (GPS)',
    hi: '"मैंने जगह खाली कर दी" पर टैप के समय फ़ोन का स्थान (GPS)',
    pa: '"ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" \'ਤੇ ਟੈਪ ਵੇਲੇ ਫ਼ੋਨ ਦਾ ਸਥਾਨ (GPS)',
  },
  // Phone GPS to phone GPS only (departure.ts distanceFromArrival).
  'pdf.evidence.field.departureDistance': {
    en: 'Approx. distance from arrival (phone GPS)',
    'zh-CN': '与到达位置的大约距离(手机 GPS)',
    vi: 'Khoảng cách ước tính từ chỗ đến (GPS điện thoại)',
    id: 'Perkiraan jarak dari lokasi kedatangan (GPS ponsel)',
    ko: '도착 위치와의 대략적 거리 (휴대폰 GPS)',
    it: "Distanza approssimativa dall'arrivo (GPS del telefono)",
    el: 'Κατά προσέγγιση απόσταση από την άφιξη (GPS κινητού)',
    hi: 'आगमन के स्थान से अनुमानित दूरी (फ़ोन GPS)',
    pa: 'ਆਮਦ ਵਾਲੀ ਥਾਂ ਤੋਂ ਅੰਦਾਜ਼ਨ ਦੂਰੀ (ਫ਼ੋਨ GPS)',
  },
  // The arrival coordinates when they aren't a GPS fix (a typed address's
  // map point, or an old record). "Location (GPS)" stays for GPS fixes.
  'pdf.evidence.field.locationCoords': {
    en: 'Location (coordinates)',
    'zh-CN': '位置(坐标)',
    vi: 'Vị trí (tọa độ)',
    id: 'Lokasi (koordinat)',
    ko: '위치 (좌표)',
    it: 'Posizione (coordinate)',
    el: 'Θέση (συντεταγμένες)',
    hi: 'स्थान (निर्देशांक)',
    pa: 'ਸਥਾਨ (ਨਿਰਦੇਸ਼ਾਂਕ)',
  },
  // Values of the two "signed by ParkProof" rows when the part isn't signed
  // by ParkProof's published key. {{time}} is the signing time.
  'pdf.evidence.signing.devKey': {
    en: "{{time}}, with a development key. It can't be checked with ParkProof's published key.",
    'zh-CN': '{{time}},使用开发密钥签名。无法用 ParkProof 公布的公钥核验。',
    vi: '{{time}}, bằng khóa phát triển. Không thể kiểm tra bằng khóa công khai mà ParkProof đã công bố.',
    id: '{{time}}, dengan kunci pengembangan. Tidak bisa dicek dengan kunci publik yang diterbitkan ParkProof.',
    ko: '{{time}}, 개발용 키로 서명됨. ParkProof가 공개한 키로는 확인할 수 없습니다.',
    it: '{{time}}, con una chiave di sviluppo. Non si può verificare con la chiave pubblicata da ParkProof.',
    el: '{{time}}, με κλειδί ανάπτυξης. Δεν μπορεί να ελεγχθεί με το δημοσιευμένο κλειδί του ParkProof.',
    hi: '{{time}}, डेवलपमेंट कुंजी से। इसे ParkProof की प्रकाशित कुंजी से जांचा नहीं जा सकता।',
    pa: '{{time}}, ਡਿਵੈਲਪਮੈਂਟ ਕੁੰਜੀ ਨਾਲ। ਇਸ ਨੂੰ ParkProof ਦੀ ਪ੍ਰਕਾਸ਼ਿਤ ਕੁੰਜੀ ਨਾਲ ਜਾਂਚਿਆ ਨਹੀਂ ਜਾ ਸਕਦਾ।',
  },
  'pdf.evidence.signing.pending': {
    en: 'Not signed yet',
    'zh-CN': '尚未签名',
    vi: 'Chưa được ký',
    id: 'Belum ditandatangani',
    ko: '아직 서명되지 않음',
    it: 'Non ancora firmata',
    el: 'Δεν έχει υπογραφεί ακόμα',
    hi: 'अभी हस्ताक्षर नहीं हुआ है',
    pa: 'ਅਜੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ',
  },
  'pdf.evidence.signing.rejected': {
    en: "This part couldn't be signed",
    'zh-CN': '这部分无法签名',
    vi: 'Không thể ký phần này',
    id: 'Bagian ini tidak bisa ditandatangani',
    ko: '이 부분은 서명할 수 없었습니다',
    it: 'Non è stato possibile firmare questa parte',
    el: 'Αυτό το τμήμα δεν μπόρεσε να υπογραφεί',
    hi: 'इस हिस्से पर हस्ताक्षर नहीं हो सका',
    pa: "ਇਸ ਹਿੱਸੇ 'ਤੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋ ਸਕੇ",
  },
  // A departure no part will be added for (an old record, a chain this
  // device can't add to). Promises nothing either way.
  'pdf.evidence.signing.none': {
    en: 'Not signed',
    'zh-CN': '未签名',
    vi: 'Không được ký',
    id: 'Tidak ditandatangani',
    ko: '서명되지 않음',
    it: 'Non firmata',
    el: 'Χωρίς υπογραφή',
    hi: 'हस्ताक्षरित नहीं',
    pa: 'ਹਸਤਾਖਰਿਤ ਨਹੀਂ',
  },
  // {{coords}} is "-37.813600, 144.963100", {{accuracy}} formatAccuracy's "±12m".
  'pdf.evidence.value.coordsWithAccuracy': {
    en: '{{coords}}, accuracy {{accuracy}}',
    'zh-CN': '{{coords}},精度 {{accuracy}}',
    vi: '{{coords}}, độ chính xác {{accuracy}}',
    id: '{{coords}}, akurasi {{accuracy}}',
    ko: '{{coords}}, 정확도 {{accuracy}}',
    it: '{{coords}}, precisione {{accuracy}}',
    el: '{{coords}}, ακρίβεια {{accuracy}}',
    hi: '{{coords}}, सटीकता {{accuracy}}',
    pa: '{{coords}}, ਸ਼ੁੱਧਤਾ {{accuracy}}',
  },
  // A departure location exists, but the arrival one can't be compared with it.
  'pdf.evidence.value.distanceUnavailable': {
    en: "Not available. The arrival location isn't a phone GPS fix accurate enough to compare.",
    'zh-CN': '无法计算。到达时的位置不是足够精确的手机 GPS 定位,无法比较。',
    vi: 'Không có. Vị trí lúc đến không phải là định vị GPS điện thoại đủ chính xác để so sánh.',
    id: 'Tidak tersedia. Lokasi kedatangan bukan titik GPS ponsel yang cukup akurat untuk dibandingkan.',
    ko: '알 수 없음. 도착 위치가 비교할 만큼 정확한 휴대폰 GPS 위치가 아닙니다.',
    it: "Non disponibile. La posizione all'arrivo non è un rilevamento GPS del telefono abbastanza preciso per il confronto.",
    el: 'Δεν είναι διαθέσιμη. Η θέση της άφιξης δεν είναι εντοπισμός GPS κινητού αρκετά ακριβής για σύγκριση.',
    hi: 'उपलब्ध नहीं। आगमन का स्थान तुलना के लिए पर्याप्त सटीक फ़ोन GPS स्थान नहीं है।',
    pa: 'ਉਪਲਬਧ ਨਹੀਂ। ਆਮਦ ਵਾਲਾ ਸਥਾਨ ਤੁਲਨਾ ਲਈ ਕਾਫ਼ੀ ਸਹੀ ਫ਼ੋਨ GPS ਸਥਾਨ ਨਹੀਂ ਹੈ।',
  },
  // The car photo's caption: the record's logged time, by the phone's clock.
  'pdf.evidence.carPhotoCaptionTime': {
    en: 'Logged {{time}} (phone clock)',
    'zh-CN': '记录时间 {{time}}(手机时钟)',
    vi: 'Ghi lúc {{time}} (đồng hồ điện thoại)',
    id: 'Dicatat {{time}} (jam ponsel)',
    ko: '{{time}} 기록 (휴대폰 시계)',
    it: 'Registrato {{time}} (orologio del telefono)',
    el: 'Καταγραφή {{time}} (ρολόι κινητού)',
    hi: '{{time}} पर दर्ज (फ़ोन की घड़ी)',
    pa: "{{time}} 'ਤੇ ਦਰਜ (ਫ਼ੋਨ ਦੀ ਘੜੀ)",
  },

  // ── The chained signature appendix ──
  // {{link}} is "0", "1", "2a"; {{kind}} the part's name (chain.kind.*).
  'pdf.signature.linkHeading': {
    en: 'Link {{link}}: {{kind}}',
    'zh-CN': '环节 {{link}}:{{kind}}',
    vi: 'Mắt xích {{link}}: {{kind}}',
    id: 'Mata rantai {{link}}: {{kind}}',
    ko: '링크 {{link}}: {{kind}}',
    it: 'Anello {{link}}: {{kind}}',
    el: 'Κρίκος {{link}}: {{kind}}',
    hi: 'कड़ी {{link}}: {{kind}}',
    pa: 'ਕੜੀ {{link}}: {{kind}}',
  },
  // Two signed links at one place in the chain (the verifier's "Added from two devices").
  'pdf.signature.forkNote': {
    en: 'Two parts were added at this point in the record, from two devices. Both are signed and shown here.',
    'zh-CN': '记录的这一处由两台设备分别添加了一部分。两部分都已签名,都列在这里。',
    vi: 'Tại điểm này của bản ghi có hai phần được thêm từ hai thiết bị. Cả hai đều đã được ký và được trình bày ở đây.',
    id: 'Di titik ini dalam catatan, dua bagian ditambahkan dari dua perangkat. Keduanya ditandatangani dan ditampilkan di sini.',
    ko: '기록의 이 지점에 두 기기에서 각각 한 부분이 추가되었습니다. 두 부분 모두 서명되어 여기에 표시됩니다.',
    it: 'In questo punto del record sono state aggiunte due parti, da due dispositivi. Sono entrambe firmate e riportate qui.',
    el: 'Σε αυτό το σημείο της εγγραφής προστέθηκαν δύο τμήματα, από δύο συσκευές. Είναι και τα δύο υπογεγραμμένα και εμφανίζονται εδώ.',
    hi: 'रिकॉर्ड के इस बिंदु पर दो डिवाइसों से दो हिस्से जोड़े गए। दोनों हस्ताक्षरित हैं और यहाँ दिखाए गए हैं।',
    pa: "ਰਿਕਾਰਡ ਦੇ ਇਸ ਬਿੰਦੂ 'ਤੇ ਦੋ ਡਿਵਾਈਸਾਂ ਤੋਂ ਦੋ ਹਿੱਸੇ ਜੋੜੇ ਗਏ। ਦੋਵੇਂ ਹਸਤਾਖਰਿਤ ਹਨ ਅਤੇ ਇੱਥੇ ਦਿਖਾਏ ਗਏ ਹਨ।",
  },
  // After step 6, only when the record has more than one signed link.
  'pdf.signature.verifyRepeat': {
    en: 'Do steps 1, 2, 4, 5 and 6 for each link, with its own file names (link1-payload.b64, link1-sig.b64 and so on).',
    'zh-CN': '对每个环节重复第 1、2、4、5、6 步,使用该环节自己的文件名(例如 link1-payload.b64 和 link1-sig.b64)。',
    vi: 'Làm các bước 1, 2, 4, 5 và 6 cho từng mắt xích, với tên tệp riêng của nó (link1-payload.b64, link1-sig.b64, v.v.).',
    id: 'Lakukan langkah 1, 2, 4, 5, dan 6 untuk setiap mata rantai, dengan nama berkasnya sendiri (link1-payload.b64, link1-sig.b64, dan seterusnya).',
    ko: '각 링크마다 해당 파일 이름(예: link1-payload.b64, link1-sig.b64)으로 1, 2, 4, 5, 6단계를 반복하세요.',
    it: 'Ripeti i passaggi 1, 2, 4, 5 e 6 per ogni anello, con i suoi nomi di file (link1-payload.b64, link1-sig.b64 e così via).',
    el: 'Κάνε τα βήματα 1, 2, 4, 5 και 6 για κάθε κρίκο, με τα δικά του ονόματα αρχείων (link1-payload.b64, link1-sig.b64 κ.ο.κ.).',
    hi: 'हर कड़ी के लिए उसके अपने फ़ाइल नामों (link1-payload.b64, link1-sig.b64 आदि) के साथ चरण 1, 2, 4, 5 और 6 दोहराएँ।',
    pa: 'ਹਰ ਕੜੀ ਲਈ ਉਸ ਦੇ ਆਪਣੇ ਫ਼ਾਈਲ ਨਾਵਾਂ (link1-payload.b64, link1-sig.b64 ਆਦਿ) ਨਾਲ ਕਦਮ 1, 2, 4, 5 ਅਤੇ 6 ਦੁਹਰਾਓ।',
  },
  // The chain step, after step 7, only when there is more than one link.
  // The `openssl dgst -sha256` commands follow it (openssl is what the
  // earlier steps need, so it works wherever they do; sha256sum isn't on
  // Windows or macOS), each with chainEquals (or chainEqualsOneOf).
  'pdf.signature.verifyChain': {
    en: "8. Check the links are joined in order. Each link after link 0 carries parent_payload_sha256, the SHA-256 of the payload of the link before it. Run each command below on the payload.txt files from step 1. It prints the payload's SHA-256 as a hex value after the = sign (sha256sum, where you have it, prints the same value).",
    'zh-CN': '8. 检查环节是否一个接一个相连。环节 0 之后的每个环节都带有 parent_payload_sha256,即前一个环节负载的 SHA-256。对第 1 步得到的 payload.txt 文件运行下面的每一行。它会在 = 号后面打印负载的 SHA-256 值(如果你有 sha256sum,它打印的值相同)。',
    vi: '8. Kiểm tra các mắt xích được nối đúng thứ tự. Mỗi mắt xích sau mắt xích 0 mang parent_payload_sha256, tức SHA-256 của payload của mắt xích trước nó. Chạy từng lệnh dưới đây trên các tệp payload.txt từ bước 1. Lệnh sẽ in SHA-256 của payload dưới dạng giá trị hex sau dấu = (nếu bạn có sha256sum, lệnh đó in ra cùng giá trị).',
    id: '8. Cek bahwa mata rantai tersambung berurutan. Setiap mata rantai setelah mata rantai 0 memuat parent_payload_sha256, yaitu SHA-256 dari payload mata rantai sebelumnya. Jalankan setiap perintah di bawah pada berkas payload.txt dari langkah 1. Perintah itu mencetak SHA-256 payload sebagai nilai hex setelah tanda = (sha256sum, jika kamu punya, mencetak nilai yang sama).',
    ko: '8. 링크가 순서대로 이어져 있는지 확인하세요. 링크 0 다음의 각 링크에는 바로 앞 링크 페이로드의 SHA-256인 parent_payload_sha256이 들어 있습니다. 1단계에서 만든 payload.txt 파일에 아래 줄을 각각 실행하세요. = 기호 뒤에 페이로드의 SHA-256이 16진수 값으로 출력됩니다 (sha256sum이 있다면 동일한 값을 출력합니다).',
    it: "8. Controlla che gli anelli siano collegati in ordine. Ogni anello dopo l'anello 0 contiene parent_payload_sha256, lo SHA-256 del payload dell'anello precedente. Esegui ogni comando qui sotto sui file payload.txt del passaggio 1. Stampa lo SHA-256 del payload come valore esadecimale dopo il segno = (sha256sum, se lo hai, stampa lo stesso valore).",
    el: '8. Έλεγξε ότι οι κρίκοι συνδέονται με τη σειρά. Κάθε κρίκος μετά τον κρίκο 0 περιέχει το parent_payload_sha256, το SHA-256 του payload του προηγούμενου κρίκου. Τρέξε κάθε εντολή παρακάτω στα αρχεία payload.txt από το βήμα 1. Τυπώνει το SHA-256 του payload ως δεκαεξαδική τιμή μετά το σύμβολο = (το sha256sum, αν το έχεις, τυπώνει την ίδια τιμή).',
    hi: '8. जाँचें कि कड़ियाँ क्रम से जुड़ी हैं। कड़ी 0 के बाद की हर कड़ी में parent_payload_sha256 होता है, यानी उससे पहले की कड़ी के पेलोड का SHA-256। चरण 1 की payload.txt फ़ाइलों पर नीचे दिया हर कमांड चलाएँ। यह = चिह्न के बाद पेलोड का SHA-256 हेक्स मान के रूप में दिखाता है (अगर आपके पास sha256sum है, तो वह भी यही मान दिखाता है)।',
    pa: "8. ਜਾਂਚੋ ਕਿ ਕੜੀਆਂ ਤਰਤੀਬ ਨਾਲ ਜੁੜੀਆਂ ਹਨ। ਕੜੀ 0 ਤੋਂ ਬਾਅਦ ਹਰ ਕੜੀ ਵਿੱਚ parent_payload_sha256 ਹੁੰਦਾ ਹੈ, ਯਾਨੀ ਉਸ ਤੋਂ ਪਹਿਲੀ ਕੜੀ ਦੇ ਪੇਲੋਡ ਦਾ SHA-256। ਕਦਮ 1 ਦੀਆਂ payload.txt ਫ਼ਾਈਲਾਂ 'ਤੇ ਹੇਠਾਂ ਦਿੱਤੀ ਹਰ ਕਮਾਂਡ ਚਲਾਓ। ਇਹ = ਚਿੰਨ੍ਹ ਤੋਂ ਬਾਅਦ ਪੇਲੋਡ ਦਾ SHA-256 ਹੈਕਸ ਮੁੱਲ ਵਜੋਂ ਦਿਖਾਉਂਦੀ ਹੈ (ਜੇ ਤੁਹਾਡੇ ਕੋਲ sha256sum ਹੈ, ਤਾਂ ਉਹ ਵੀ ਇਹੀ ਮੁੱਲ ਦਿਖਾਉਂਦੀ ਹੈ)।",
  },
  'pdf.signature.chainEquals': {
    en: 'That hex value must equal parent_payload_sha256 in link {{link}}.',
    'zh-CN': '这个值必须等于环节 {{link}} 中的 parent_payload_sha256。',
    vi: 'Giá trị hex đó phải bằng parent_payload_sha256 trong mắt xích {{link}}.',
    id: 'Nilai hex itu harus sama dengan parent_payload_sha256 di mata rantai {{link}}.',
    ko: '그 16진수 값이 링크 {{link}}의 parent_payload_sha256과 일치해야 합니다.',
    it: "Quel valore esadecimale deve essere uguale a parent_payload_sha256 nell'anello {{link}}.",
    el: 'Αυτή η δεκαεξαδική τιμή πρέπει να είναι ίδια με το parent_payload_sha256 στον κρίκο {{link}}.',
    hi: 'वह हेक्स मान कड़ी {{link}} के parent_payload_sha256 के बराबर होना चाहिए।',
    pa: 'ਉਹ ਹੈਕਸ ਮੁੱਲ ਕੜੀ {{link}} ਵਿਚਲੇ parent_payload_sha256 ਦੇ ਬਰਾਬਰ ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ।',
  },
  // When the link before has two signed copies (a fork), one command per copy.
  'pdf.signature.chainEqualsOneOf': {
    en: 'One of these hex values must equal parent_payload_sha256 in link {{link}}.',
    'zh-CN': '这些值中必须有一个等于环节 {{link}} 中的 parent_payload_sha256。',
    vi: 'Một trong các giá trị hex này phải bằng parent_payload_sha256 trong mắt xích {{link}}.',
    id: 'Salah satu nilai hex ini harus sama dengan parent_payload_sha256 di mata rantai {{link}}.',
    ko: '이 16진수 값 중 하나가 링크 {{link}}의 parent_payload_sha256과 일치해야 합니다.',
    it: "Uno di questi valori esadecimali deve essere uguale a parent_payload_sha256 nell'anello {{link}}.",
    el: 'Μία από αυτές τις δεκαεξαδικές τιμές πρέπει να είναι ίδια με το parent_payload_sha256 στον κρίκο {{link}}.',
    hi: 'इनमें से एक हेक्स मान कड़ी {{link}} के parent_payload_sha256 के बराबर होना चाहिए।',
    pa: 'ਇਨ੍ਹਾਂ ਵਿੱਚੋਂ ਇੱਕ ਹੈਕਸ ਮੁੱਲ ਕੜੀ {{link}} ਵਿਚਲੇ parent_payload_sha256 ਦੇ ਬਰਾਬਰ ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ।',
  },

  // ── Added after review (keep at the end, so a replay from before T1b ──
  // ── appends them in the same order as a run on the current files) ────
  // The appendix's link headings. PDF-only twins of chain.kind.* (the
  // screen's names): the PDF fonts are subsets, so a PDF string may only
  // use characters the subset has (src/lib/pdf-font-coverage.test.ts),
  // while the screen strings can use any.
  'pdf.signature.kind.arrival': {
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
  'pdf.signature.kind.arrivalContext': {
    en: 'Details at parking',
    'zh-CN': '停车时的详细信息',
    vi: 'Thông tin khi đỗ xe',
    id: 'Detail saat parkir',
    ko: '주차할 때의 세부 정보',
    it: 'Dettagli al parcheggio',
    el: 'Στοιχεία κατά τη στάθμευση',
    hi: 'पार्किंग के समय के विवरण',
    pa: 'ਪਾਰਕਿੰਗ ਵੇਲੇ ਦੇ ਵੇਰਵੇ',
  },
  'pdf.signature.kind.condition': {
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
  'pdf.signature.kind.compliance': {
    en: 'Proof of payment or permit',
    'zh-CN': '付款或许可证凭证',
    vi: 'Bằng chứng thanh toán hoặc giấy phép',
    id: 'Bukti pembayaran atau izin',
    ko: '결제 또는 허가증 증명',
    it: 'Prova di pagamento o permesso',
    el: 'Απόδειξη πληρωμής ή άδειας',
    hi: 'भुगतान या परमिट का प्रमाण',
    pa: 'ਭੁਗਤਾਨ ਜਾਂ ਪਰਮਿਟ ਦਾ ਸਬੂਤ',
  },
  'pdf.signature.kind.departure': {
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
  'pdf.signature.kind.handover': {
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
  // The AI confidence cell (the model's 'high' | 'medium' | 'low', never printed raw).
  'pdf.evidence.confidence.high': {
    en: 'High',
    'zh-CN': '高',
    vi: 'Cao',
    id: 'Tinggi',
    ko: '높음',
    it: 'Alta',
    el: 'Υψηλή',
    hi: 'उच्च',
    pa: 'ਉੱਚ',
  },
  'pdf.evidence.confidence.medium': {
    en: 'Medium',
    'zh-CN': '中',
    vi: 'Trung bình',
    id: 'Sedang',
    ko: '보통',
    it: 'Media',
    el: 'Μέτρια',
    hi: 'मध्यम',
    pa: 'ਮੱਧਮ',
  },
  'pdf.evidence.confidence.low': {
    en: 'Low',
    'zh-CN': '低',
    vi: 'Thấp',
    id: 'Rendah',
    ko: '낮음',
    it: 'Bassa',
    el: 'Χαμηλή',
    hi: 'कम',
    pa: 'ਘੱਟ',
  },
  // The distance row when the phone's fix at the tap was rough (worse than
  // ±100 m, ACCURACY_USABLE_M) or gave no accuracy. Phone GPS to phone GPS.
  'pdf.evidence.value.distanceRough': {
    en: "{{distance}}. The phone's location at the tap was only accurate to {{accuracy}}, so this distance is rough.",
    'zh-CN': '{{distance}}。点击时手机位置的精度只有 {{accuracy}},所以这个距离不精确。',
    vi: '{{distance}}. Vị trí của điện thoại lúc nhấn chỉ chính xác trong khoảng {{accuracy}}, nên khoảng cách này chỉ là ước lượng thô.',
    id: '{{distance}}. Lokasi ponsel saat mengetuk hanya akurat sampai {{accuracy}}, jadi jarak ini hanya perkiraan kasar.',
    ko: '{{distance}}. 누를 때 휴대폰 위치의 정확도가 {{accuracy}}에 불과해, 이 거리는 대략적인 값입니다.',
    it: '{{distance}}. Al momento del tocco la posizione del telefono era precisa solo entro {{accuracy}}, quindi questa distanza è approssimativa.',
    el: '{{distance}}. Η θέση του κινητού στο πάτημα είχε ακρίβεια μόνο {{accuracy}}, οπότε η απόσταση αυτή είναι κατά προσέγγιση.',
    hi: '{{distance}}। टैप के समय फ़ोन के स्थान की सटीकता केवल {{accuracy}} थी, इसलिए यह दूरी मोटा अनुमान है।',
    pa: '{{distance}}। ਟੈਪ ਵੇਲੇ ਫ਼ੋਨ ਦੇ ਸਥਾਨ ਦੀ ਸ਼ੁੱਧਤਾ ਸਿਰਫ਼ {{accuracy}} ਸੀ, ਇਸ ਲਈ ਇਹ ਦੂਰੀ ਮੋਟਾ ਅੰਦਾਜ਼ਾ ਹੈ।',
  },
  'pdf.evidence.value.distanceRoughNoAccuracy': {
    en: "{{distance}}. The phone didn't report how accurate its location at the tap was, so this distance is rough.",
    'zh-CN': '{{distance}}。手机没有给出点击时位置的精度,所以这个距离不精确。',
    vi: '{{distance}}. Điện thoại không cho biết vị trí lúc nhấn chính xác đến đâu, nên khoảng cách này chỉ là ước lượng thô.',
    id: '{{distance}}. Ponsel tidak melaporkan seberapa akurat lokasinya saat mengetuk, jadi jarak ini hanya perkiraan kasar.',
    ko: '{{distance}}. 휴대폰이 누를 때 위치의 정확도를 알려 주지 않아, 이 거리는 대략적인 값입니다.',
    it: '{{distance}}. Il telefono non ha indicato quanto fosse precisa la sua posizione al momento del tocco, quindi questa distanza è approssimativa.',
    el: '{{distance}}. Το κινητό δεν ανέφερε πόσο ακριβής ήταν η θέση του στο πάτημα, οπότε η απόσταση αυτή είναι κατά προσέγγιση.',
    hi: '{{distance}}। फ़ोन ने नहीं बताया कि टैप के समय उसका स्थान कितना सटीक था, इसलिए यह दूरी मोटा अनुमान है।',
    pa: '{{distance}}। ਫ਼ੋਨ ਨੇ ਨਹੀਂ ਦੱਸਿਆ ਕਿ ਟੈਪ ਵੇਲੇ ਉਸ ਦਾ ਸਥਾਨ ਕਿੰਨਾ ਸ਼ੁੱਧ ਸੀ, ਇਸ ਲਈ ਇਹ ਦੂਰੀ ਮੋਟਾ ਅੰਦਾਜ਼ਾ ਹੈ।',
  },
  // The plus-or-minus sign in front of a GPS accuracy ("±12m"). The hi and
  // pa PDF fonts (Noto Sans Devanagari, Gurmukhi) have no ± glyph.
  'pdf.common.plusMinus': {
    en: '±',
    'zh-CN': '±',
    vi: '±',
    id: '±',
    ko: '±',
    it: '±',
    el: '±',
    hi: '+/-',
    pa: '+/-',
  },
}

// ── Existing strings this task rewrites (explicit overwrite list) ───────
// Each must already exist in every locale; the script aborts otherwise.
const OVERWRITES = {
  // Spec T1b item 5. The closing statement of every PDF record.
  'pdf.evidence.statement': {
    en: "This is a record of a parking event made with ParkProof. Times marked as phone times come from the driver's phone. Statements marked as the driver's are the driver's own. It is not a legal finding about what happened. The council or court decides that.",
    'zh-CN': '这是一份用 ParkProof 制作的停车记录。标为手机时间的时间来自驾驶员的手机。标为驾驶员说法的内容是驾驶员本人的说法。它不是对所发生事情的法律认定。这由市议会或法院判断。',
    vi: 'Đây là bản ghi một lần đỗ xe được tạo bằng ParkProof. Các thời điểm được ghi là giờ điện thoại lấy từ điện thoại của tài xế. Các nội dung được ghi là lời của tài xế là lời của chính tài xế. Đây không phải là kết luận pháp lý về những gì đã xảy ra. Việc đó do hội đồng địa phương hoặc tòa án quyết định.',
    id: 'Ini adalah catatan sebuah parkir yang dibuat dengan ParkProof. Waktu yang ditandai sebagai waktu ponsel berasal dari ponsel pengemudi. Pernyataan yang ditandai sebagai pernyataan pengemudi adalah pernyataan pengemudi sendiri. Catatan ini bukan putusan hukum tentang apa yang terjadi. Itu diputuskan oleh dewan kota atau pengadilan.',
    ko: '이것은 ParkProof로 만든 주차 기록입니다. 휴대폰 시각으로 표시된 시각은 운전자의 휴대폰 시계에 따른 것입니다. 운전자의 말로 표시된 내용은 운전자 본인의 말입니다. 이 기록은 어떤 일이 있었는지에 대한 법적 판단이 아닙니다. 그 판단은 의회나 법원이 합니다.',
    it: 'Questo è un record di un parcheggio creato con ParkProof. Gli orari indicati come orari del telefono provengono dal telefono del conducente. Le dichiarazioni indicate come del conducente sono dichiarazioni del conducente stesso. Non è un accertamento legale di quanto accaduto. Lo decide il comune o il tribunale.',
    el: 'Αυτή είναι μια εγγραφή στάθμευσης που δημιουργήθηκε με το ParkProof. Οι ώρες που σημειώνονται ως ώρες κινητού προέρχονται από το κινητό του οδηγού. Οι δηλώσεις που σημειώνονται ως δηλώσεις του οδηγού είναι του ίδιου του οδηγού. Δεν αποτελεί νομική κρίση για το τι συνέβη. Αυτό το αποφασίζει ο δήμος ή το δικαστήριο.',
    hi: 'यह ParkProof से बनाया गया एक पार्किंग रिकॉर्ड है। फ़ोन के समय के रूप में चिह्नित समय ड्राइवर के फ़ोन से आते हैं। ड्राइवर के बयान के रूप में चिह्नित बातें ड्राइवर के अपने बयान हैं। यह इस बारे में कोई कानूनी निर्णय नहीं है कि क्या हुआ। यह परिषद या अदालत तय करती है।',
    pa: 'ਇਹ ParkProof ਨਾਲ ਬਣਾਇਆ ਇੱਕ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ ਹੈ। ਫ਼ੋਨ ਦੇ ਸਮੇਂ ਵਜੋਂ ਨਿਸ਼ਾਨਬੱਧ ਸਮੇਂ ਡਰਾਈਵਰ ਦੇ ਫ਼ੋਨ ਤੋਂ ਆਉਂਦੇ ਹਨ। ਡਰਾਈਵਰ ਦੇ ਬਿਆਨ ਵਜੋਂ ਨਿਸ਼ਾਨਬੱਧ ਗੱਲਾਂ ਡਰਾਈਵਰ ਦੇ ਆਪਣੇ ਬਿਆਨ ਹਨ। ਇਹ ਇਸ ਬਾਰੇ ਕੋਈ ਕਾਨੂੰਨੀ ਫ਼ੈਸਲਾ ਨਹੀਂ ਕਿ ਕੀ ਹੋਇਆ। ਇਹ ਕੌਂਸਲ ਜਾਂ ਅਦਾਲਤ ਤੈਅ ਕਰਦੀ ਹੈ।',
  },
  // Spec T1b item 5. Opens the signature appendix.
  'pdf.signature.intro': {
    en: "Each part of this record was signed by ParkProof's server when the server received it, at the signed_at time shown for that part. A valid signature shows the signed details and photo fingerprints have not changed since then. It does not show that they are true, who was driving, or when the car arrived or left.",
    'zh-CN': '这份记录的每一部分都在 ParkProof 服务器收到时由服务器签名,签名时间为该部分所示的 signed_at 时间。有效的签名表明,已签名的内容和照片指纹自那时以来没有改动。它不能说明这些内容属实,也不能说明是谁在开车,或车辆何时到达、何时离开。',
    vi: 'Mỗi phần của bản ghi này được máy chủ của ParkProof ký khi máy chủ nhận được, vào thời điểm signed_at ghi cho phần đó. Chữ ký hợp lệ cho thấy các thông tin đã ký và dấu vân tay của ảnh không thay đổi kể từ lúc đó. Chữ ký không cho thấy các thông tin đó là đúng, ai đang lái xe, hay xe đến và rời đi lúc nào.',
    id: 'Setiap bagian catatan ini ditandatangani oleh server ParkProof saat server menerimanya, pada waktu signed_at yang ditampilkan untuk bagian itu. Tanda tangan yang valid menunjukkan detail yang ditandatangani dan sidik jari foto tidak berubah sejak saat itu. Tanda tangan tidak menunjukkan bahwa isinya benar, siapa yang menyetir, atau kapan mobil tiba atau pergi.',
    ko: '이 기록의 각 부분은 ParkProof 서버가 받은 시점에 서버가 서명했으며, 그 시각은 각 부분에 표시된 signed_at입니다. 유효한 서명은 서명된 내용과 사진 지문이 그 뒤로 변경되지 않았음을 보여 줍니다. 그 내용이 사실인지, 누가 운전했는지, 차가 언제 도착하거나 떠났는지는 보여 주지 않습니다.',
    it: "Ogni parte di questo record è stata firmata dal server di ParkProof quando il server l'ha ricevuta, all'orario signed_at indicato per quella parte. Una firma valida mostra che i dati firmati e le impronte delle foto non sono cambiati da allora. Non mostra che siano veri, chi guidava, né quando l'auto è arrivata o partita.",
    el: 'Κάθε τμήμα αυτής της εγγραφής υπογράφηκε από τον διακομιστή του ParkProof όταν ο διακομιστής το έλαβε, την ώρα signed_at που φαίνεται για εκείνο το τμήμα. Μια έγκυρη υπογραφή δείχνει ότι τα υπογεγραμμένα στοιχεία και τα αποτυπώματα των φωτογραφιών δεν έχουν αλλάξει από τότε. Δεν δείχνει ότι είναι αληθινά, ποιος οδηγούσε ή πότε έφτασε ή έφυγε το αυτοκίνητο.',
    hi: 'इस रिकॉर्ड के हर हिस्से पर ParkProof के सर्वर ने उसे मिलते ही हस्ताक्षर किए, उस हिस्से के लिए दिखाए गए signed_at समय पर। मान्य हस्ताक्षर दिखाता है कि हस्ताक्षरित विवरण और फ़ोटो फ़िंगरप्रिंट तब से नहीं बदले हैं। यह नहीं दिखाता कि वे सच हैं, ड्राइवर कौन था, या कार कब पहुँची या गई।',
    pa: "ਇਸ ਰਿਕਾਰਡ ਦੇ ਹਰ ਹਿੱਸੇ 'ਤੇ ParkProof ਦੇ ਸਰਵਰ ਨੇ ਉਸ ਨੂੰ ਮਿਲਦੇ ਹੀ ਹਸਤਾਖਰ ਕੀਤੇ, ਉਸ ਹਿੱਸੇ ਲਈ ਦਿਖਾਏ signed_at ਸਮੇਂ 'ਤੇ। ਵੈਧ ਹਸਤਾਖਰ ਦਿਖਾਉਂਦਾ ਹੈ ਕਿ ਹਸਤਾਖਰਿਤ ਵੇਰਵੇ ਅਤੇ ਫ਼ੋਟੋ ਫ਼ਿੰਗਰਪ੍ਰਿੰਟ ਉਦੋਂ ਤੋਂ ਨਹੀਂ ਬਦਲੇ। ਇਹ ਨਹੀਂ ਦਿਖਾਉਂਦਾ ਕਿ ਉਹ ਸੱਚ ਹਨ, ਡਰਾਈਵਰ ਕੌਣ ਸੀ, ਜਾਂ ਕਾਰ ਕਦੋਂ ਪਹੁੰਚੀ ਜਾਂ ਗਈ।",
  },
  // The files are now named per link (link0-payload.b64, link1-payload.b64 ...).
  'pdf.signature.verifyStep1': {
    en: '1. Save the base64 payload block of link 0 to a file named link0-payload.b64, then decode it to the exact signed bytes. base64 -d ignores the line wrapping, so you recover the precise bytes with no stray newline:',
    'zh-CN': '1. 将环节 0 的 base64 负载块保存为名为 link0-payload.b64 的文件,然后解码还原出被签名的确切字节。base64 -d 不理会换行,因此你能得到精确的字节,不会多出换行符:',
    vi: '1. Lưu khối payload base64 của mắt xích 0 vào tệp tên link0-payload.b64, sau đó giải mã thành đúng các byte đã được ký. base64 -d bỏ qua việc xuống dòng, nên bạn khôi phục được chính xác các byte mà không có ký tự xuống dòng thừa:',
    id: '1. Simpan blok payload base64 dari mata rantai 0 ke berkas bernama link0-payload.b64, lalu dekode menjadi byte persis yang ditandatangani. base64 -d mengabaikan pembungkusan baris, sehingga kamu memperoleh byte yang tepat tanpa baris baru yang berlebih:',
    ko: '1. 링크 0의 base64 페이로드 블록을 link0-payload.b64라는 파일로 저장하세요. 그런 다음 서명된 정확한 바이트로 디코딩하세요. base64 -d는 줄 구분을 무시하므로 불필요한 개행 없이 정확한 바이트를 복원합니다:',
    it: "1. Salva il blocco payload base64 dell'anello 0 in un file chiamato link0-payload.b64, poi decodificalo nei byte esatti che sono stati firmati. base64 -d ignora gli a capo, quindi recuperi i byte precisi senza alcun a capo finale superfluo:",
    el: '1. Αποθήκευσε το μπλοκ payload σε base64 του κρίκου 0 σε αρχείο με όνομα link0-payload.b64 και έπειτα αποκωδικοποίησέ το στα ακριβή bytes που υπογράφηκαν. Το base64 -d αγνοεί την αναδίπλωση γραμμών, ώστε να ανακτήσεις τα ακριβή bytes χωρίς περιττή αλλαγή γραμμής:',
    hi: '1. कड़ी 0 के base64 पेलोड ब्लॉक को link0-payload.b64 नाम की फ़ाइल में सहेजें, फिर इसे उन्हीं सटीक बाइट्स में डिकोड करें जिन पर हस्ताक्षर किए गए थे। base64 -d लाइन रैपिंग को अनदेखा करता है, इसलिए आपको बिना किसी अतिरिक्त न्यूलाइन के सटीक बाइट्स मिलते हैं:',
    pa: '1. ਕੜੀ 0 ਦੇ base64 ਪੇਲੋਡ ਬਲਾਕ ਨੂੰ link0-payload.b64 ਨਾਂ ਦੀ ਫ਼ਾਈਲ ਵਿੱਚ ਸੰਭਾਲੋ, ਫਿਰ ਇਸ ਨੂੰ ਉਹਨਾਂ ਹੀ ਸਹੀ ਬਾਈਟਾਂ ਵਿੱਚ ਡੀਕੋਡ ਕਰੋ ਜਿਨ੍ਹਾਂ ਉੱਤੇ ਹਸਤਾਖਰ ਕੀਤੇ ਗਏ ਸਨ। base64 -d ਲਾਈਨ ਰੈਪਿੰਗ ਨੂੰ ਅਣਡਿੱਠ ਕਰਦਾ ਹੈ, ਇਸ ਲਈ ਤੁਹਾਨੂੰ ਬਿਨਾਂ ਕਿਸੇ ਵਾਧੂ ਨਿਊਲਾਈਨ ਦੇ ਸਹੀ ਬਾਈਟਾਂ ਮਿਲਦੀਆਂ ਹਨ:',
  },
  'pdf.signature.verifyStep2': {
    en: '2. Save the signature block of link 0 to a file named link0-sig.b64.',
    'zh-CN': '2. 将环节 0 的签名块保存为名为 link0-sig.b64 的文件。',
    vi: '2. Lưu khối chữ ký của mắt xích 0 vào tệp tên link0-sig.b64.',
    id: '2. Simpan blok tanda tangan dari mata rantai 0 ke berkas bernama link0-sig.b64.',
    ko: '2. 링크 0의 서명 블록을 link0-sig.b64라는 파일로 저장하세요.',
    it: "2. Salva il blocco della firma dell'anello 0 in un file chiamato link0-sig.b64.",
    el: '2. Αποθήκευσε το μπλοκ υπογραφής του κρίκου 0 σε αρχείο με όνομα link0-sig.b64.',
    hi: '2. कड़ी 0 के हस्ताक्षर ब्लॉक को link0-sig.b64 नाम की फ़ाइल में सहेजें।',
    pa: '2. ਕੜੀ 0 ਦੇ ਹਸਤਾਖਰ ਬਲਾਕ ਨੂੰ link0-sig.b64 ਨਾਂ ਦੀ ਫ਼ਾਈਲ ਵਿੱਚ ਸੰਭਾਲੋ।',
  },
  // Spec T1b item 5.
  'pdf.signature.verifyStep6': {
    en: '6. Expect "Verified OK". This shows the signed bytes have not changed since ParkProof signed them.',
    'zh-CN': '6. 预期输出:"Verified OK"。这表明已签名的字节自 ParkProof 签名以来没有改动。',
    vi: '6. Kết quả mong đợi: "Verified OK". Điều này cho thấy các byte đã ký không thay đổi kể từ khi ParkProof ký.',
    id: '6. Harapkan keluaran "Verified OK". Ini menunjukkan byte yang ditandatangani tidak berubah sejak ParkProof menandatanganinya.',
    ko: '6. 예상 출력: "Verified OK". 이는 서명된 바이트가 ParkProof가 서명한 뒤로 변경되지 않았음을 보여 줍니다.',
    it: '6. Output atteso: "Verified OK". Mostra che i byte firmati non sono cambiati da quando ParkProof li ha firmati.',
    el: '6. Αναμενόμενη έξοδος: "Verified OK". Αυτό δείχνει ότι τα υπογεγραμμένα bytes δεν έχουν αλλάξει από τότε που τα υπέγραψε το ParkProof.',
    hi: '6. अपेक्षित आउटपुट: "Verified OK"। यह दिखाता है कि हस्ताक्षरित बाइट्स ParkProof के हस्ताक्षर करने के बाद से नहीं बदले हैं।',
    pa: '6. ਉਮੀਦ ਕੀਤਾ ਆਉਟਪੁੱਟ: "Verified OK"। ਇਹ ਦਿਖਾਉਂਦਾ ਹੈ ਕਿ ਹਸਤਾਖਰਿਤ ਬਾਈਟਾਂ ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਨਹੀਂ ਬਦਲੀਆਂ।',
  },
  // Spec T1b item 5: "already proved those values are authentic" becomes
  // "showed those values have not changed since signing". Rewritten whole
  // (el and id now use the εσύ and kamu register, pa ਹਸਤਾਖਰ).
  'pdf.signature.verifyStep7': {
    en: '7. About the photos: the images shown in this PDF are a visual copy, re-encoded for the document, so their bytes differ from the originals and will not reproduce the hashes in the payload. That is expected and is not a sign of tampering. The signature commits to the SHA-256 of each original photo (the sign_photo_sha256, car_photo_sha256 and ambient_photo_sha256 values inside the signed payload), and step 6 showed those values have not changed since signing. To independently confirm a specific image, hash the original captured file (from the ParkProof record or your account export), not the copy printed here, and compare it to the matching value above.',
    'zh-CN': '7. 关于照片:本 PDF 中显示的图像是为文档重新编码的图像，其字节与原始文件不同，因此无法重现负载中的哈希值。这是正常的，并不表示被篡改。签名对应的是每张原始照片的 SHA-256（即签名负载中的 sign_photo_sha256、car_photo_sha256 和 ambient_photo_sha256 值），第 6 步已经表明这些值自签名以来没有改动。若要自行核对某张图像，请对原始拍摄文件（来自 ParkProof 记录或你的账户导出），而不是这里打印的图像，计算哈希，并与上方对应的值进行比较。',
    vi: '7. Về ảnh: các hình trong tệp PDF này là bản sao trực quan, được mã hóa lại cho tài liệu, nên các byte của chúng khác với bản gốc và sẽ không tái tạo được các giá trị băm trong payload. Đây là điều bình thường, không phải dấu hiệu bị giả mạo. Chữ ký cam kết với SHA-256 của từng ảnh gốc (các giá trị sign_photo_sha256, car_photo_sha256 và ambient_photo_sha256 trong payload đã ký), và bước 6 đã cho thấy các giá trị đó không thay đổi kể từ khi ký. Để xác minh độc lập một hình cụ thể, hãy băm tệp ảnh gốc đã chụp (từ bản ghi ParkProof hoặc bản xuất dữ liệu tài khoản của bạn), không phải bản sao in ở đây, và so sánh với giá trị tương ứng ở trên.',
    id: '7. Tentang foto: gambar yang ditampilkan dalam PDF ini adalah salinan visual, dikodekan ulang untuk dokumen, sehingga byte-nya berbeda dari aslinya dan tidak akan menghasilkan hash dalam payload. Itu wajar dan bukan tanda pemalsuan. Tanda tangan berkomitmen pada SHA-256 dari setiap foto asli (nilai sign_photo_sha256, car_photo_sha256, dan ambient_photo_sha256 di dalam payload yang ditandatangani), dan langkah 6 sudah menunjukkan nilai-nilai itu tidak berubah sejak ditandatangani. Untuk memverifikasi gambar tertentu secara independen, hitung hash berkas asli yang diambil (dari catatan ParkProof atau ekspor data akunmu), bukan salinan yang dicetak di sini, lalu bandingkan dengan nilai yang sesuai di atas.',
    ko: '7. 사진에 관하여: 이 PDF에 표시된 이미지는 문서용으로 다시 인코딩된 시각적 사본이므로 바이트가 원본과 달라 페이로드의 해시를 재현하지 못합니다. 이는 정상이며 변조되었다는 뜻이 아닙니다. 서명은 각 원본 사진의 SHA-256(서명된 페이로드 안의 sign_photo_sha256, car_photo_sha256, ambient_photo_sha256 값)에 대한 것이며, 6단계에서 그 값들이 서명 이후 변경되지 않았음을 이미 보여 주었습니다. 어느 이미지를 직접 확인하려면 여기 인쇄된 사본이 아니라 원본 촬영 파일(ParkProof 기록 또는 계정 내보내기에 있는 것)의 해시를 계산하여 위의 해당 값과 비교하세요.',
    it: "7. Riguardo alle foto: le immagini mostrate in questo PDF sono una copia visiva, ricodificata per il documento, quindi i loro byte differiscono dagli originali e non riprodurranno gli hash nel payload. È normale e non è segno di manomissione. La firma vincola lo SHA-256 di ogni foto originale (i valori sign_photo_sha256, car_photo_sha256 e ambient_photo_sha256 all'interno del payload firmato), e il passaggio 6 ha già mostrato che quei valori non sono cambiati dalla firma. Per verificare in modo indipendente una specifica immagine, calcola l'hash del file originale acquisito (dal record ParkProof o dall'esportazione dei dati del tuo account), non della copia stampata qui, e confrontalo con il valore corrispondente sopra.",
    el: '7. Σχετικά με τις φωτογραφίες: οι εικόνες που εμφανίζονται σε αυτό το PDF είναι ένα οπτικό αντίγραφο, επανακωδικοποιημένο για το έγγραφο, επομένως τα bytes τους διαφέρουν από τα πρωτότυπα και δεν θα αναπαραγάγουν τους κατακερματισμούς στο payload. Αυτό είναι αναμενόμενο και δεν αποτελεί ένδειξη παραποίησης. Η υπογραφή δεσμεύεται στο SHA-256 κάθε πρωτότυπης φωτογραφίας (τις τιμές sign_photo_sha256, car_photo_sha256 και ambient_photo_sha256 μέσα στο υπογεγραμμένο payload), και το βήμα 6 έχει ήδη δείξει ότι αυτές οι τιμές δεν έχουν αλλάξει από την υπογραφή. Για να επαληθεύσεις ανεξάρτητα μια συγκεκριμένη εικόνα, υπολόγισε τον κατακερματισμό του πρωτότυπου αρχείου λήψης (από την εγγραφή ParkProof ή την εξαγωγή δεδομένων του λογαριασμού σου), όχι του αντιγράφου που εκτυπώνεται εδώ, και σύγκρινέ τον με την αντίστοιχη τιμή παραπάνω.',
    hi: '7. फ़ोटो के बारे में: इस PDF में दिखाई गई छवियाँ एक दृश्य प्रति हैं, जिन्हें दस्तावेज़ के लिए फिर से एन्कोड किया गया है, इसलिए उनके बाइट्स मूल से भिन्न हैं और पेलोड के हैश को पुनः उत्पन्न नहीं करेंगे। यह सामान्य है और छेड़छाड़ का संकेत नहीं है। हस्ताक्षर प्रत्येक मूल फ़ोटो के SHA-256 (हस्ताक्षरित पेलोड के भीतर sign_photo_sha256, car_photo_sha256 और ambient_photo_sha256 मान) के लिए प्रतिबद्ध है, और चरण 6 पहले ही दिखा चुका है कि वे मान हस्ताक्षर के बाद से नहीं बदले हैं। किसी विशेष छवि को स्वतंत्र रूप से सत्यापित करने के लिए, यहाँ छपी प्रति के बजाय मूल खींची गई फ़ाइल (ParkProof रिकॉर्ड या आपके खाता निर्यात से) का हैश निकालें और ऊपर दिए गए संबंधित मान से उसकी तुलना करें।',
    pa: "7. ਫ਼ੋਟੋਆਂ ਬਾਰੇ: ਇਸ PDF ਵਿੱਚ ਦਿਖਾਈਆਂ ਤਸਵੀਰਾਂ ਇੱਕ ਦ੍ਰਿਸ਼ਟ ਨਕਲ ਹਨ, ਜੋ ਦਸਤਾਵੇਜ਼ ਲਈ ਮੁੜ-ਏਨਕੋਡ ਕੀਤੀਆਂ ਗਈਆਂ ਹਨ, ਇਸ ਲਈ ਉਨ੍ਹਾਂ ਦੀਆਂ ਬਾਈਟਾਂ ਅਸਲ ਨਾਲੋਂ ਵੱਖਰੀਆਂ ਹਨ ਅਤੇ ਪੇਲੋਡ ਦੇ ਹੈਸ਼ ਮੁੜ ਨਹੀਂ ਬਣਾਉਣਗੀਆਂ। ਇਹ ਸਧਾਰਨ ਹੈ ਅਤੇ ਛੇੜਛਾੜ ਦਾ ਸੰਕੇਤ ਨਹੀਂ। ਹਸਤਾਖਰ ਹਰ ਅਸਲ ਫ਼ੋਟੋ ਦੇ SHA-256 (ਹਸਤਾਖਰਿਤ ਪੇਲੋਡ ਵਿੱਚ sign_photo_sha256, car_photo_sha256 ਅਤੇ ambient_photo_sha256 ਮੁੱਲ) ਲਈ ਵਚਨਬੱਧ ਹਨ, ਅਤੇ ਕਦਮ 6 ਪਹਿਲਾਂ ਹੀ ਦਿਖਾ ਚੁੱਕਾ ਹੈ ਕਿ ਉਹ ਮੁੱਲ ਹਸਤਾਖਰ ਤੋਂ ਬਾਅਦ ਨਹੀਂ ਬਦਲੇ। ਕਿਸੇ ਖ਼ਾਸ ਤਸਵੀਰ ਨੂੰ ਸੁਤੰਤਰ ਤੌਰ 'ਤੇ ਤਸਦੀਕ ਕਰਨ ਲਈ, ਇੱਥੇ ਛਪੀ ਨਕਲ ਦੀ ਬਜਾਏ ਅਸਲ ਖਿੱਚੀ ਫ਼ਾਈਲ (ParkProof ਰਿਕਾਰਡ ਜਾਂ ਤੁਹਾਡੇ ਖਾਤਾ ਨਿਰਯਾਤ ਤੋਂ) ਦਾ ਹੈਸ਼ ਕੱਢੋ ਅਤੇ ਉੱਪਰ ਦਿੱਤੇ ਸੰਬੰਧਿਤ ਮੁੱਲ ਨਾਲ ਤੁਲਨਾ ਕਰੋ।",
  },
  // The block headers now name the link's file ({{file}}: link0-payload.b64, link0-sig.b64 ...).
  'pdf.signature.payloadB64Header': {
    en: 'Canonical payload, base64. Save it as {{file}} to check it:',
    'zh-CN': '规范化负载(base64 编码)。保存为 {{file}} 以便核验:',
    vi: 'Payload chuẩn hóa, dạng base64. Lưu thành {{file}} để kiểm tra:',
    id: 'Payload kanonis, base64. Simpan sebagai {{file}} untuk mengeceknya:',
    ko: '정규화된 페이로드, base64. 확인하려면 {{file}} 파일로 저장하세요:',
    it: 'Payload canonico, base64. Salvalo come {{file}} per verificarlo:',
    el: 'Κανονικοποιημένο payload, base64. Αποθήκευσέ το ως {{file}} για να το ελέγξεις:',
    hi: 'कैनॉनिकल पेलोड, base64। जाँचने के लिए इसे {{file}} के रूप में सहेजें:',
    pa: 'ਕੈਨੌਨੀਕਲ ਪੇਲੋਡ, base64। ਜਾਂਚਣ ਲਈ ਇਸ ਨੂੰ {{file}} ਵਜੋਂ ਸੰਭਾਲੋ:',
  },
  'pdf.signature.signatureBlobHeader': {
    en: 'Signature (DER, base64). Save it as {{file}}:',
    'zh-CN': '签名(DER,base64)。保存为 {{file}}:',
    vi: 'Chữ ký (DER, base64). Lưu thành {{file}}:',
    id: 'Tanda tangan (DER, base64). Simpan sebagai {{file}}:',
    ko: '서명 (DER, base64). {{file}} 파일로 저장하세요:',
    it: 'Firma (DER, base64). Salvala come {{file}}:',
    el: 'Υπογραφή (DER, base64). Αποθήκευσέ την ως {{file}}:',
    hi: 'हस्ताक्षर (DER, base64)। इसे {{file}} के रूप में सहेजें:',
    pa: 'ਹਸਤਾਖਰ (DER, base64)। ਇਸ ਨੂੰ {{file}} ਵਜੋਂ ਸੰਭਾਲੋ:',
  },
  // The appendix's per-link signing time is now shown in the record's zone
  // (formatInZone), not as a raw UTC value; the raw value is in the payload.
  'pdf.signature.signedAt': {
    en: 'Signed by ParkProof (server clock)',
    'zh-CN': 'ParkProof 签名时间(服务器时钟)',
    vi: 'ParkProof ký lúc (đồng hồ máy chủ)',
    id: 'Ditandatangani ParkProof (jam server)',
    ko: 'ParkProof 서명 시각 (서버 시계)',
    it: 'Firmato da ParkProof (orologio del server)',
    el: 'Υπογραφή από το ParkProof (ρολόι διακομιστή)',
    hi: 'ParkProof के हस्ताक्षर (सर्वर की घड़ी)',
    pa: 'ParkProof ਦੇ ਹਸਤਾਖਰ (ਸਰਵਰ ਦੀ ਘੜੀ)',
  },
  // arrived_at is the phone's clock when the record was saved (copy rules:
  // phone times are labelled as phone times).
  'pdf.evidence.field.arrivedAt': {
    en: 'Logged (phone clock)',
    'zh-CN': '记录时间(手机时钟)',
    vi: 'Ghi lúc (đồng hồ điện thoại)',
    id: 'Dicatat (jam ponsel)',
    ko: '기록 시각 (휴대폰 시계)',
    it: 'Registrato (orologio del telefono)',
    el: 'Καταγραφή (ρολόι κινητού)',
    hi: 'दर्ज किया गया (फ़ोन की घड़ी)',
    pa: 'ਦਰਜ ਕੀਤਾ (ਫ਼ੋਨ ਦੀ ਘੜੀ)',
  },
  'pdf.fullExport.summaryColArrived': {
    en: 'Logged (phone clock)',
    'zh-CN': '记录时间(手机时钟)',
    vi: 'Ghi lúc (đồng hồ điện thoại)',
    id: 'Dicatat (jam ponsel)',
    ko: '기록 시각 (휴대폰 시계)',
    it: 'Registrato (orologio del telefono)',
    el: 'Καταγραφή (ρολόι κινητού)',
    hi: 'दर्ज किया गया (फ़ोन की घड़ी)',
    pa: 'ਦਰਜ ਕੀਤਾ (ਫ਼ੋਨ ਦੀ ਘੜੀ)',
  },
  // It said to "export the individual record PDF for the full signature
  // appendix"; the export now carries each record's appendix.
  'pdf.fullExport.intro': {
    en: "This document gathers every parking record saved to this ParkProof account, one section per record. Where a record has signed parts, its signature pages follow its section, with the steps to check each signature. A valid signature shows the signed details haven't changed since ParkProof signed them. It doesn't show that they are true.",
    'zh-CN': '本文档收录了该 ParkProof 账户保存的所有停车记录,每条记录一节。记录中有已签名的部分时,签名页就在该节之后,并说明如何核验每个签名。有效的签名表明已签名的内容自 ParkProof 签名以来没有改动。它不能说明这些内容属实。',
    vi: 'Tài liệu này tập hợp mọi bản ghi đỗ xe đã lưu vào tài khoản ParkProof này, mỗi bản ghi một mục. Nếu một bản ghi có các phần đã ký, các trang chữ ký nằm ngay sau mục đó, kèm các bước để kiểm tra từng chữ ký. Chữ ký hợp lệ cho thấy các thông tin đã ký không thay đổi kể từ khi ParkProof ký. Chữ ký không cho thấy các thông tin đó là đúng.',
    id: 'Dokumen ini mengumpulkan setiap catatan parkir yang disimpan ke akun ParkProof ini, satu bagian per catatan. Jika sebuah catatan punya bagian yang ditandatangani, halaman tanda tangannya ada setelah bagiannya, lengkap dengan langkah untuk mengecek setiap tanda tangan. Tanda tangan yang valid menunjukkan detail yang ditandatangani tidak berubah sejak ParkProof menandatanganinya. Tanda tangan tidak menunjukkan bahwa isinya benar.',
    ko: '이 문서는 이 ParkProof 계정에 저장된 모든 주차 기록을 기록마다 섹션 하나로 모은 것입니다. 기록에 서명된 부분이 있으면, 그 섹션 바로 뒤에 서명 페이지와 각 서명을 확인하는 방법이 나옵니다. 유효한 서명은 서명된 내용이 ParkProof가 서명한 뒤로 변경되지 않았음을 보여 줍니다. 그 내용이 사실인지는 보여 주지 않습니다.',
    it: 'Questo documento raccoglie ogni record di parcheggio salvato in questo account ParkProof, una sezione per record. Se un record ha parti firmate, le sue pagine di firma seguono la sezione, con i passaggi per verificare ogni firma. Una firma valida mostra che i dati firmati non sono cambiati da quando ParkProof li ha firmati. Non mostra che siano veri.',
    el: 'Το έγγραφο αυτό συγκεντρώνει κάθε εγγραφή στάθμευσης που έχει αποθηκευτεί σε αυτόν τον λογαριασμό ParkProof, μία ενότητα ανά εγγραφή. Όταν μια εγγραφή έχει υπογεγραμμένα τμήματα, οι σελίδες υπογραφής της ακολουθούν την ενότητά της, με τα βήματα για τον έλεγχο κάθε υπογραφής. Μια έγκυρη υπογραφή δείχνει ότι τα υπογεγραμμένα στοιχεία δεν έχουν αλλάξει από τότε που τα υπέγραψε το ParkProof. Δεν δείχνει ότι είναι αληθινά.',
    hi: 'यह दस्तावेज़ इस ParkProof खाते में सहेजे हर पार्किंग रिकॉर्ड को एकत्र करता है, हर रिकॉर्ड का एक अनुभाग। जिस रिकॉर्ड के हस्ताक्षरित हिस्से हैं, उसके अनुभाग के बाद उसके हस्ताक्षर पृष्ठ आते हैं, हर हस्ताक्षर को जाँचने के चरणों के साथ। मान्य हस्ताक्षर दिखाता है कि हस्ताक्षरित विवरण ParkProof के हस्ताक्षर करने के बाद से नहीं बदले हैं। यह नहीं दिखाता कि वे सच हैं।',
    pa: 'ਇਹ ਦਸਤਾਵੇਜ਼ ਇਸ ParkProof ਖਾਤੇ ਵਿੱਚ ਸੰਭਾਲੇ ਹਰ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ ਨੂੰ ਇਕੱਠਾ ਕਰਦਾ ਹੈ, ਹਰ ਰਿਕਾਰਡ ਦਾ ਇੱਕ ਭਾਗ। ਜਿਸ ਰਿਕਾਰਡ ਦੇ ਹਸਤਾਖਰਿਤ ਹਿੱਸੇ ਹਨ, ਉਸ ਦੇ ਭਾਗ ਤੋਂ ਬਾਅਦ ਉਸ ਦੇ ਹਸਤਾਖਰ ਪੰਨੇ ਆਉਂਦੇ ਹਨ, ਹਰ ਹਸਤਾਖਰ ਨੂੰ ਜਾਂਚਣ ਦੇ ਕਦਮਾਂ ਨਾਲ। ਵੈਧ ਹਸਤਾਖਰ ਦਿਖਾਉਂਦਾ ਹੈ ਕਿ ਹਸਤਾਖਰਿਤ ਵੇਰਵੇ ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਨਹੀਂ ਬਦਲੇ। ਇਹ ਨਹੀਂ ਦਿਖਾਉਂਦਾ ਕਿ ਉਹ ਸੱਚ ਹਨ।',
  },
  // The title had a warning symbol the PDF fonts can't draw (PDF strings: plain text).
  'pdf.evidence.gpsNoticeTitle': {
    en: 'GPS accuracy notice',
    'zh-CN': 'GPS 精度提示',
    vi: 'Thông báo về độ chính xác GPS',
    id: 'Pemberitahuan akurasi GPS',
    ko: 'GPS 정확도 알림',
    it: 'Avviso sulla precisione GPS',
    el: 'Ειδοποίηση ακρίβειας GPS',
    hi: 'GPS सटीकता सूचना',
    pa: 'GPS ਸ਼ੁੱਧਤਾ ਨੋਟਿਸ',
  },
  // Spec T1b item 5. The About page's evidence list.
  'about.evidence.items[1]': {
    en: "Each record is signed, so anyone can check it hasn't been changed since it was signed.",
    'zh-CN': '每条记录都有签名,任何人都可以核对它自签名以来没有被改动。',
    vi: 'Mỗi bản ghi đều được ký, nên ai cũng có thể kiểm tra rằng nó chưa bị thay đổi kể từ khi được ký.',
    id: 'Setiap catatan ditandatangani, jadi siapa pun bisa mengecek bahwa catatan itu tidak diubah sejak ditandatangani.',
    ko: '각 기록에 서명이 되어 있어, 누구나 서명된 뒤로 기록이 바뀌지 않았는지 확인할 수 있습니다.',
    it: 'Ogni record è firmato, così chiunque può controllare che non sia stato modificato da quando è stato firmato.',
    el: 'Κάθε εγγραφή είναι υπογεγραμμένη, οπότε ο καθένας μπορεί να ελέγξει ότι δεν έχει αλλάξει από τότε που υπογράφηκε.',
    hi: 'हर रिकॉर्ड हस्ताक्षरित है, इसलिए कोई भी जाँच सकता है कि हस्ताक्षर के बाद से इसे बदला नहीं गया है।',
    pa: 'ਹਰ ਰਿਕਾਰਡ ਹਸਤਾਖਰਿਤ ਹੈ, ਇਸ ਲਈ ਕੋਈ ਵੀ ਜਾਂਚ ਸਕਦਾ ਹੈ ਕਿ ਹਸਤਾਖਰ ਤੋਂ ਬਾਅਦ ਇਸ ਨੂੰ ਬਦਲਿਆ ਨਹੀਂ ਗਿਆ।',
  },
  // ── Rewritten after review: strings T1b now draws in all three PDFs ──
  // The surroundings photo shows the surroundings. It doesn't show there
  // was no sign (never promise an outcome).
  'pdf.evidence.ambientPhotoCaption': {
    en: "Taken by the driver when the record was logged, to show the surroundings. It doesn't show there was no sign nearby.",
    'zh-CN': '由驾驶员在记录时拍摄,用于显示周围环境。它不能说明附近没有标志。',
    vi: 'Do tài xế chụp lúc tạo bản ghi, để cho thấy khu vực xung quanh. Ảnh này không chứng tỏ gần đó không có biển báo.',
    id: 'Diambil oleh pengemudi saat catatan dibuat, untuk menunjukkan sekitarnya. Foto ini tidak menunjukkan bahwa tidak ada rambu di dekatnya.',
    ko: '기록할 때 운전자가 주변을 보여 주려고 촬영함. 이 사진이 근처에 표지판이 없었다는 것을 보여 주지는 않습니다.',
    it: 'Scattata dal conducente quando è stato registrato il record, per mostrare la zona circostante. Non dimostra che nelle vicinanze non ci fossero cartelli.',
    el: 'Τραβήχτηκε από τον οδηγό όταν καταγράφηκε η εγγραφή, για να δείξει τον γύρω χώρο. Δεν δείχνει ότι δεν υπήρχε πινακίδα κοντά.',
    hi: 'रिकॉर्ड दर्ज करते समय ड्राइवर द्वारा आसपास का दृश्य दिखाने के लिए ली गई तस्वीर। इससे यह नहीं दिखता कि पास में कोई साइन नहीं था।',
    pa: 'ਰਿਕਾਰਡ ਦਰਜ ਕਰਦੇ ਸਮੇਂ ਡਰਾਈਵਰ ਵੱਲੋਂ ਆਲੇ-ਦੁਆਲੇ ਦਾ ਨਜ਼ਾਰਾ ਦਿਖਾਉਣ ਲਈ ਲਈ ਗਈ ਫੋਟੋ। ਇਸ ਤੋਂ ਇਹ ਨਹੀਂ ਦਿਖਦਾ ਕਿ ਨੇੜੇ ਕੋਈ ਚਿੰਨ੍ਹ ਨਹੀਂ ਸੀ।',
  },
  // The no-sign record's "Sign rules" cell: the driver's own statement.
  'pdf.evidence.noSignRules': {
    en: 'No sign was read for this record. The driver said there were no parking signs at this spot.',
    'zh-CN': '此记录没有读取标志。驾驶员说这个地点没有停车标志。',
    vi: 'Không có biển báo nào được đọc cho bản ghi này. Tài xế cho biết chỗ này không có biển báo đỗ xe.',
    id: 'Tidak ada rambu yang dibaca untuk catatan ini. Pengemudi menyatakan tidak ada rambu parkir di lokasi ini.',
    ko: '이 기록에서는 표지판을 읽지 않았습니다. 운전자는 이 장소에 주차 표지판이 없었다고 말했습니다.',
    it: "Per questo record non è stato letto nessun cartello. Il conducente ha detto che in questo punto non c'erano cartelli di sosta.",
    el: 'Δεν διαβάστηκε πινακίδα για αυτή την εγγραφή. Ο οδηγός δήλωσε ότι σε αυτό το σημείο δεν υπήρχαν πινακίδες στάθμευσης.',
    hi: 'इस रिकॉर्ड के लिए कोई साइन नहीं पढ़ा गया। ड्राइवर के अनुसार इस जगह पर पार्किंग का कोई साइन नहीं था।',
    pa: 'ਇਸ ਰਿਕਾਰਡ ਲਈ ਕੋਈ ਸਾਈਨ ਨਹੀਂ ਪੜ੍ਹਿਆ ਗਿਆ। ਡਰਾਈਵਰ ਦੇ ਮੁਤਾਬਕ ਇਸ ਥਾਂ ਪਾਰਕਿੰਗ ਦਾ ਕੋਈ ਸਾਈਨ ਨਹੀਂ ਸੀ।',
  },
  // It pointed at "the appendix", which is the signature pages; the notice is in the record block.
  'pdf.evidence.locationSourceValue.gpsLowAccuracy': {
    en: 'GPS: low accuracy, {{accuracy}} (see the GPS accuracy notice below)',
    'zh-CN': 'GPS:精度偏低,{{accuracy}}(见下方的 GPS 精度提示)',
    vi: 'GPS: độ chính xác thấp, {{accuracy}} (xem thông báo về độ chính xác GPS bên dưới)',
    id: 'GPS: akurasi rendah, {{accuracy}} (lihat pemberitahuan akurasi GPS di bawah)',
    ko: 'GPS: 낮은 정확도, {{accuracy}} (아래 GPS 정확도 알림 참조)',
    it: "GPS: precisione bassa, {{accuracy}} (vedi l'avviso sulla precisione GPS più sotto)",
    el: 'GPS: χαμηλή ακρίβεια, {{accuracy}} (δες την ειδοποίηση ακρίβειας GPS παρακάτω)',
    hi: 'GPS: कम सटीकता, {{accuracy}} (नीचे GPS सटीकता सूचना देखें)',
    pa: 'GPS: ਘੱਟ ਸ਼ੁੱਧਤਾ, {{accuracy}} (ਹੇਠਾਂ GPS ਸ਼ੁੱਧਤਾ ਨੋਟਿਸ ਵੇਖੋ)',
  },
  // Em-dashes out (copy rules): the empty-value mark is the en dash en uses.
  'pdf.evidence.locationSourceValue.none': {
    en: '–',
    'zh-CN': '–',
    vi: '–',
    id: '–',
    ko: '–',
    it: '–',
    el: '–',
    hi: '–',
    pa: '–',
  },
  'pdf.common.dash': {
    en: '–',
    'zh-CN': '–',
    vi: '–',
    id: '–',
    ko: '–',
    it: '–',
    el: '–',
    hi: '–',
    pa: '–',
  },
  // "session" out (the user-facing noun is "record").
  'pdf.evidence.guidanceExpired': {
    en: 'Parking time ended at {{when}}.',
    'zh-CN': '停车时间已于 {{when}} 结束。',
    vi: 'Thời gian đỗ xe đã kết thúc lúc {{when}}.',
    id: 'Waktu parkir berakhir pada {{when}}.',
    ko: '주차 시간이 {{when}}에 끝났습니다.',
    it: 'Tempo di sosta terminato: {{when}}.',
    el: 'Ο χρόνος στάθμευσης έληξε στις {{when}}.',
    hi: 'पार्किंग का समय {{when}} को समाप्त हुआ।',
    pa: "ਪਾਰਕਿੰਗ ਦਾ ਸਮਾਂ {{when}} 'ਤੇ ਖ਼ਤਮ ਹੋਇਆ।",
  },
  'pdf.evidence.noAmbientCaptured': {
    en: 'No surroundings photo was taken for this record.',
    'zh-CN': '此记录没有拍摄周围环境照片。',
    vi: 'Bản ghi này không có ảnh khu vực xung quanh.',
    id: 'Tidak ada foto sekitar yang diambil untuk catatan ini.',
    ko: '이 기록에는 주변 사진이 촬영되지 않았습니다.',
    it: 'Per questo record non è stata scattata nessuna foto della zona circostante.',
    el: 'Δεν τραβήχτηκε φωτογραφία του γύρω χώρου για αυτή την εγγραφή.',
    hi: 'इस रिकॉर्ड के लिए आसपास की कोई तस्वीर नहीं ली गई।',
    pa: 'ਇਸ ਰਿਕਾਰਡ ਲਈ ਆਲੇ-ਦੁਆਲੇ ਦੀ ਕੋਈ ਫੋਟੋ ਨਹੀਂ ਲਈ ਗਈ।',
  },
  'pdf.appeal.linkedSession': {
    en: 'Linked ParkProof record: {{id}}',
    'zh-CN': '关联的 ParkProof 记录:{{id}}',
    vi: 'Bản ghi ParkProof liên kết: {{id}}',
    id: 'Catatan ParkProof terkait: {{id}}',
    ko: '연결된 ParkProof 기록: {{id}}',
    it: 'Record ParkProof collegato: {{id}}',
    el: 'Συνδεδεμένη εγγραφή ParkProof: {{id}}',
    hi: 'जुड़ा हुआ ParkProof रिकॉर्ड: {{id}}',
    pa: 'ਜੁੜਿਆ ParkProof ਰਿਕਾਰਡ: {{id}}',
  },
  'pdf.evidence.sessionId': {
    en: 'Record ID: {{id}}',
    'zh-CN': '记录 ID:{{id}}',
    vi: 'Mã bản ghi: {{id}}',
    id: 'ID catatan: {{id}}',
    ko: '기록 ID: {{id}}',
    it: 'ID record: {{id}}',
    el: 'ID εγγραφής: {{id}}',
    hi: 'रिकॉर्ड ID: {{id}}',
    pa: 'ਰਿਕਾਰਡ ID: {{id}}',
  },
}

// ── Single-locale rewrites (each listed locale only; the others keep their text) ──
// Two reasons, both in strings T1b now draws in all three PDFs:
//   - Font: the zh-CN and ko PDF fonts are subsets
//     (scripts/_subset_pdf_fonts.py) and can't gain glyphs without the full
//     Noto files. A string with a character the subset lacks printed a
//     blank; it is reworded with characters the subset has.
//     src/lib/pdf-font-coverage.test.ts guards this.
//   - Copy rules: em-dashes out of the locales that had them (en had none).
const LOCALE_OVERWRITES = {
  'zh-CN': {
    // 点按 -> 点击 (按 isn't in the subset; departureLocation already says 点击).
    'pdf.evidence.field.endedAt': '点击"我已离开"的时间(手机时钟)',
    'pdf.evidence.field.actualDuration': '从到达到点击"我已离开"的时长(手机时钟)',
    // 覆盖范围 -> 范围 (覆).
    'pdf.evidence.driverNoteUnsigned': '由驾驶员添加。此备注不在加密签名的范围内。',
  },
  ko: {
    // 보호 범위에 포함되지 -> 포함되지 (범).
    'pdf.evidence.driverNoteUnsigned': '운전자가 추가함. 이 메모는 암호학적 서명에 포함되지 않습니다.',
    // 뒷받침 -> 관련 (뒷, 침).
    'pdf.appeal.supportingEvidence': '관련 증거 (ParkProof에서)',
    // 가리킵니다 -> 나타냅니다 (킵).
    'pdf.evidence.gpsNoticeBody':
      '캡처 시점의 GPS 판독값은 {{accuracy}}였습니다. 증거 용도로는 보통보다 넓은 값입니다. 위 좌표는 정확한 한 지점이 아니라 그 반경 안의 한 지점을 나타냅니다. 흔한 원인은 실내 또는 다층 주차장, Starlink나 VPN 연결, 약한 위성 신호입니다. 검토자는 이 반경을 감안해 캡처된 주소를 평가해야 합니다.',
    'pdf.evidence.title': 'ParkProof: 주차 증거',
    'pdf.fullExport.title': 'ParkProof: 계정 내보내기',
    'pdf.evidence.locationSourceValue.gpsWithAccuracy': 'GPS: {{accuracy}}',
  },
  vi: {
    'pdf.evidence.gpsNoticeBody':
      'Tín hiệu GPS khi ghi nhận là {{accuracy}}, rộng hơn mức thông thường dùng làm bằng chứng. Tọa độ phía trên xác định một điểm trong bán kính đó, không phải vị trí chính xác. Nguyên nhân thường gặp: bãi đỗ trong nhà / nhiều tầng, kết nối Starlink hoặc VPN, hoặc tín hiệu vệ tinh yếu. Người xét duyệt nên cân nhắc địa chỉ ghi nhận trong phạm vi bán kính này.',
    'pdf.evidence.title': 'ParkProof: Bằng chứng đỗ xe',
    'pdf.fullExport.title': 'ParkProof: Xuất tài khoản',
    'pdf.evidence.locationSourceValue.gpsWithAccuracy': 'GPS: {{accuracy}}',
  },
  id: {
    'pdf.evidence.gpsNoticeBody':
      'Pembacaan GPS saat penangkapan adalah {{accuracy}}, lebih luas dari biasanya untuk tujuan bukti. Koordinat di atas mengidentifikasi titik dalam radius itu, bukan lokasi tepat. Penyebab umum: parkir dalam ruangan / berlantai, koneksi Starlink atau VPN, atau sinyal satelit lemah. Peninjau harus menimbang alamat yang ditangkap terhadap radius ini.',
    'pdf.evidence.title': 'ParkProof: Bukti Parkir',
    'pdf.fullExport.title': 'ParkProof: Ekspor Akun',
    'pdf.evidence.locationSourceValue.gpsWithAccuracy': 'GPS: {{accuracy}}',
  },
  it: {
    'pdf.evidence.gpsNoticeBody':
      "La lettura GPS al momento dell'acquisizione era {{accuracy}}, più ampia del consueto per scopi probatori. Le coordinate indicate identificano un punto all'interno di tale raggio, non un punto esatto. Cause comuni: parcheggi interni / multipiano, connessioni Starlink o VPN, o segnale satellitare debole. Chi valuta dovrebbe ponderare l'indirizzo registrato in base a questo raggio.",
    'pdf.evidence.title': 'ParkProof: Prova di parcheggio',
    'pdf.fullExport.title': 'ParkProof: Esportazione account',
    'pdf.evidence.locationSourceValue.gpsWithAccuracy': 'GPS: {{accuracy}}',
  },
  el: {
    'pdf.evidence.gpsNoticeBody':
      'Η μέτρηση GPS κατά τη λήψη ήταν {{accuracy}}, ευρύτερη από τη συνηθισμένη για αποδεικτικούς σκοπούς. Οι παραπάνω συντεταγμένες προσδιορίζουν ένα σημείο μέσα σε αυτή την ακτίνα, όχι μια ακριβή θέση. Συνήθεις αιτίες: στεγασμένα / πολυώροφα πάρκινγκ, συνδέσεις Starlink ή VPN, ή ασθενές δορυφορικό σήμα. Οι αξιολογητές πρέπει να σταθμίζουν την καταγεγραμμένη διεύθυνση σε σχέση με αυτή την ακτίνα.',
    'pdf.evidence.title': 'ParkProof: Αποδεικτικά στοιχεία στάθμευσης',
    'pdf.fullExport.title': 'ParkProof: Εξαγωγή λογαριασμού',
    'pdf.evidence.locationSourceValue.gpsWithAccuracy': 'GPS: {{accuracy}}',
  },
  hi: {
    'pdf.evidence.gpsNoticeBody':
      'रिकॉर्ड किए जाते समय GPS रीडिंग {{accuracy}} थी, जो सबूत के तौर पर सामान्य से अधिक चौड़ी है। ऊपर दिए गए निर्देशांक उस त्रिज्या के भीतर एक बिंदु को दर्शाते हैं, सटीक स्थान नहीं। सामान्य कारण: इनडोर / मल्टी-स्टोरी कारपार्क, Starlink या VPN कनेक्शन, या कमज़ोर उपग्रह संकेत। समीक्षकों को इस त्रिज्या के संदर्भ में दर्ज पते का मूल्यांकन करना चाहिए।',
    'pdf.evidence.title': 'ParkProof: पार्किंग सबूत',
    'pdf.fullExport.title': 'ParkProof: खाता निर्यात',
    'pdf.evidence.locationSourceValue.gpsWithAccuracy': 'GPS: {{accuracy}}',
  },
  pa: {
    'pdf.evidence.gpsNoticeBody':
      'ਕੈਪਚਰ ਸਮੇਂ GPS ਰੀਡਿੰਗ {{accuracy}} ਸੀ, ਜੋ ਸਬੂਤ ਦੇ ਮਕਸਦ ਲਈ ਆਮ ਨਾਲੋਂ ਚੌੜੀ ਹੈ। ਉੱਪਰਲੇ ਨਿਰਦੇਸ਼ਾਂਕ ਉਸ ਘੇਰੇ ਦੇ ਅੰਦਰ ਇੱਕ ਬਿੰਦੂ ਦਰਸਾਉਂਦੇ ਹਨ, ਕੋਈ ਸਟੀਕ ਥਾਂ ਨਹੀਂ। ਆਮ ਕਾਰਨ: ਘਰ ਅੰਦਰ / ਬਹੁ-ਮੰਜ਼ਿਲਾ ਕਾਰਪਾਰਕ, Starlink ਜਾਂ VPN ਕਨੈਕਸ਼ਨ, ਜਾਂ ਕਮਜ਼ੋਰ ਸੈਟੇਲਾਈਟ ਸਿਗਨਲ। ਸਮੀਖਿਆਕਾਰਾਂ ਨੂੰ ਦਰਜ ਕੀਤੇ ਪਤੇ ਨੂੰ ਇਸ ਘੇਰੇ ਦੇ ਸੰਦਰਭ ਵਿੱਚ ਵਿਚਾਰਨਾ ਚਾਹੀਦਾ ਹੈ।',
    'pdf.evidence.title': 'ParkProof: ਪਾਰਕਿੰਗ ਸਬੂਤ',
    'pdf.fullExport.title': 'ParkProof: ਖਾਤਾ ਨਿਰਯਾਤ',
    'pdf.evidence.locationSourceValue.gpsWithAccuracy': 'GPS: {{accuracy}}',
  },
}

// ── helpers ─────────────────────────────────────────────────────────────
function fail(msg) {
  console.error(`ABORT (nothing written): ${msg}`)
  process.exit(1)
}

/** "a.b[1].c" -> ['a', 'b', 1, 'c'] */
function segments(path) {
  const out = []
  for (const part of path.split('.')) {
    const m = part.match(/^([^[\]]+)((?:\[\d+\])*)$/)
    if (!m) fail(`bad key path ${path}`)
    out.push(m[1])
    for (const idx of m[2].match(/\d+/g) || []) out.push(Number(idx))
  }
  return out
}

/** The object at `path`'s parent, creating missing objects (appended at the end of their parent). */
function parentOf(root, path, locale) {
  const parts = segments(path)
  const leaf = parts.pop()
  if (typeof leaf !== 'string') fail(`${locale}: new key ${path} can't be an array element`)
  let node = root
  for (const p of parts) {
    if (typeof p === 'number') fail(`${locale}: new key ${path} can't be inside an array`)
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

/** Rewrite an existing string in place (array elements too). Aborts when it isn't there: an overwrite never adds a key. */
function overwrite(root, path, value, locale) {
  const parts = segments(path)
  const leaf = parts.pop()
  let node = root
  for (const p of parts) {
    node = node && typeof node === 'object' ? node[p] : undefined
    if (!node || typeof node !== 'object') fail(`${locale}: ${path} to overwrite is missing`)
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
    if (path.endsWith('_one')) {
      for (const [locale, s] of Object.entries(byLocale)) {
        if (!s.includes('{{count}}')) problems.push(`${locale}: ${path} must use {{count}}`)
      }
    }
    for (const [locale, s] of Object.entries(byLocale)) {
      // Copy rules: no em-dashes. PDF strings: plain text and WinAnsi punctuation, no symbols.
      if (s.includes('—')) problems.push(`${locale}: em-dash in new copy at ${path}`)
      if (/[✓⚠→≈≤\u{1F300}-\u{1FAFF}]/u.test(s)) problems.push(`${locale}: symbol in new copy at ${path}`)
    }
    if (/\bsessions?\b/i.test(byLocale.en)) problems.push(`"session" in en copy at ${path}`)
    if (
      /\b(reset|compliant|compliance proven|admissible|authentic|verified location|accepted by (insurers|council)|strong evidence|proves?|proved)\b/i.test(
        byLocale.en,
      )
    ) {
      problems.push(`banned wording in en copy at ${path}`)
    }
    if (/signed departure at/i.test(byLocale.en)) problems.push(`"signed departure at" in en copy at ${path}`)
    if (/(?<!meter )\btickets?\b/i.test(byLocale.en)) problems.push(`ambiguous "ticket" in en copy at ${path}`)
  }
  for (const [locale, byPath] of Object.entries(LOCALE_OVERWRITES)) {
    if (!LOCALES.includes(locale) || locale === 'en') problems.push(`LOCALE_OVERWRITES: bad locale ${locale}`)
    for (const [path, s] of Object.entries(byPath)) {
      if (path in ADDITIONS || path in OVERWRITES) problems.push(`${locale}: ${path} is also in ADDITIONS or OVERWRITES`)
      if (s.includes('—')) problems.push(`${locale}: em-dash in new copy at ${path}`)
      if (/[✓⚠→≈≤\u{1F300}-\u{1FAFF}]/u.test(s)) problems.push(`${locale}: symbol in new copy at ${path}`)
    }
  }
  return problems
}

// ── --list: keys for the T10 review ─────────────────────────────────────
if (process.argv.includes('--list')) {
  const localeOnly = {}
  for (const [locale, byPath] of Object.entries(LOCALE_OVERWRITES)) {
    for (const path of Object.keys(byPath)) (localeOnly[path] ??= []).push(locale)
  }
  const keys = [...new Set([...Object.keys(ADDITIONS), ...Object.keys(OVERWRITES), ...Object.keys(localeOnly)])].sort()
  for (const k of keys) {
    const tags = [
      k in OVERWRITES ? 'overwrite' : null,
      localeOnly[k] ? `overwrite: ${localeOnly[k].join(', ')} only` : null,
      LEGAL.has(k) ? 'legal' : null,
    ].filter(Boolean)
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
  for (const [path, text] of Object.entries(LOCALE_OVERWRITES[locale] ?? {})) {
    overwrite(data[locale], path, text, locale)
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
