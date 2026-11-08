/**
 * T7 i18n (roadmap build spec, task T7: sharing the record and handing the
 * car over). Idempotent: running it twice leaves the files byte-identical
 * after the first run. ONE script for the whole task: each unit of T7
 * extends ADDITIONS (and OVERWRITES, LEGAL) here rather than adding another
 * script.
 *
 * Unit 1 (share and receive, items 1 to 4) adds:
 *   - logger.driver.*: the "Who's driving?" line in the logger (item 1);
 *   - share.*: the share sheet with the confirm copy (item 2, the en text
 *     is the spec's wording), the receive view `shared` with the snapshot
 *     banner, the signed details and their caveat, the sender's extras
 *     ("From the sender, not signed"), the tampered and newer-version
 *     messages (item 3, the spec's wording, without a full stop as the
 *     spec gives them), and the read-only copy's badge, record screen,
 *     check and Remove (item 4);
 *   - share.permitSafeguard: item 6's line, shown on the share sheet (the
 *     handover unit reuses it on its screen);
 *   - pdf.shared.*: the PDF line of item 4 ("This record was made on
 *     someone else's phone.").
 *
 * Unit 2 (handover and PDF, items 5 to 7) adds:
 *   - handover.*: "Hand the car over" on the record screen of an active
 *     record, its sheet (the next driver's name, what the signature does
 *     and doesn't show, the outcome and the share offer) and the record
 *     screen's handover line (phone clock). The sheet reuses
 *     share.permitSafeguard for item 6;
 *   - pdf.evidence.field.driver ("Driver (entered on the phone, not
 *     checked)", the spec's wording), pdf.evidence.field.handover,
 *     pdf.evidence.field.handoverSigned and pdf.evidence.value.handover*:
 *     the PDF's driver row and handover section (item 7). PDF strings use
 *     only characters each locale's PDF font has (WinAnsi for en, it and
 *     id; the Noto subsets otherwise, see src/lib/pdf-font-coverage.test.ts).
 *
 * Fix round 1 rewrites some of these keys (listed in REVISED) and adds:
 *   - share.field.limitRecorded and share.permitTimeNote: a permit-adjusted
 *     share labels its signed limit neutrally and says the sign's standard
 *     limit applies without the permit;
 *   - handover.fromDriver, handover.doneFromTo and handover.lineFromTo: who
 *     the handover says handed the car over, shown before the tap, in the
 *     outcome and on the record screen.
 *
 * "accessible parking permit", "driver", "parking record" and "signature"
 * follow the verified terminology table in docs/legal-pdf-review-worksheet.md
 * and each locale's existing strings (result.permitRequired.*,
 * notice.compare.driver, chain.*). Register: el εσύ, id kamu, zh 你. hi and
 * pa avoid gendered verb forms ("चालक कौन था", honorific plural).
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces, plus the copy rules).
 *
 * Run:   node scripts/_i18n_inject_t7.mjs
 * List:  node scripts/_i18n_inject_t7.mjs --list
 *        prints every key this task added or rewrote, for the T10
 *        translation review ('legal' marks the statements a lawyer should
 *        read, 'overwrite' an existing string rewritten).
 * Other: node scripts/_i18n_inject_t7.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

/** Keys whose wording makes a claim about signatures, times, drivers, permits or sharing: for docs/legal-review-queue.md (T10). */
const LEGAL = new Set([
  'logger.driver.help',
  'share.confirm',
  'share.permitSafeguard',
  'share.banner',
  'share.bannerNoDriver',
  'share.bannerNoTime',
  'share.tampered',
  'share.signedNote',
  'share.signedNoteNoTime',
  'share.unsignedHeading',
  'share.endedValue',
  'share.checkValid',
  'share.field.limitRecorded',
  'share.permitTimeNote',
  'pdf.shared.madeElsewhere',
  'handover.intro',
  'handover.done',
  'handover.doneFromTo',
  'handover.fromDriver',
  'handover.line',
  'handover.lineFromTo',
  'pdf.evidence.field.driver',
  'pdf.evidence.field.handover',
  'pdf.evidence.field.handoverSigned',
  'pdf.evidence.value.handoverTo',
  'pdf.evidence.value.handoverFromTo',
])

// ── Keys this script added and later rewrote ────────────────────────────
// A re-run replaces an ADDITIONS key's existing text only when the key is
// listed here: its old text is this script's own earlier wording. Any
// other ADDITIONS key that already holds different text aborts the run, so
// a key another task added at the same path is never rewritten silently
// (an existing string of another task goes in OVERWRITES instead).
const REVISED = new Set([
  // Fix round 1: the full signature caveat (copy rules) on shared records.
  'share.signedNote',
  'share.signedNoteNoTime',
  'share.checkValid',
  // Fix round 1: the handover line worded as what the record says.
  'handover.line',
  // Fix round 1: zh-CN 驾驶员 (the base term for driver), and vi/zh-CN
  // "the record stays active" in each locale's base term for active.
  'share.field.driver',
  'handover.nameLabel',
  'handover.nameRequired',
  'handover.intro',
  'handover.done',
])

// ── New keys, appended inside their parent object ────────────────────────
// This script owns these keys: a re-run with the same text is a no-op, and
// a key in REVISED is rewritten to the text below (in place, keeping its
// position). Missing parent objects are created, appended at the end of
// their own parent.
const ADDITIONS = {
  // ── Item 1: "Who's driving?" in the logger ──
  'logger.driver.label': {
    en: "Who's driving? (optional)",
    'zh-CN': '谁在开车？（可选）',
    vi: 'Ai đang lái xe? (tùy chọn)',
    id: 'Siapa yang mengemudi? (opsional)',
    ko: '누가 운전하나요? (선택 사항)',
    it: 'Chi è alla guida? (facoltativo)',
    el: 'Ποιος οδηγεί; (προαιρετικό)',
    hi: 'चालक कौन है? (वैकल्पिक)',
    pa: 'ਡਰਾਈਵਰ ਕੌਣ ਹੈ? (ਵਿਕਲਪਿਕ)',
  },
  'logger.driver.placeholder': {
    en: 'Name',
    'zh-CN': '姓名',
    vi: 'Tên',
    id: 'Nama',
    ko: '이름',
    it: 'Nome',
    el: 'Όνομα',
    hi: 'नाम',
    pa: 'ਨਾਂ',
  },
  // The driver's own statement: never worded as something the app confirmed.
  'logger.driver.help': {
    en: "Saved with this record. ParkProof doesn't check it.",
    'zh-CN': '与这条记录一起保存。ParkProof 不会核实。',
    vi: 'Được lưu cùng bản ghi này. ParkProof không kiểm tra thông tin này.',
    id: 'Disimpan bersama catatan ini. ParkProof tidak memeriksanya.',
    ko: '이 기록과 함께 저장됩니다. ParkProof는 이를 확인하지 않습니다.',
    it: 'Salvato con questo record. ParkProof non lo verifica.',
    el: 'Αποθηκεύεται μαζί με αυτή την εγγραφή. Το ParkProof δεν το ελέγχει.',
    hi: 'यह इस रिकॉर्ड के साथ सहेजा जाता है। ParkProof इसकी जाँच नहीं करता।',
    pa: 'ਇਹ ਇਸ ਰਿਕਾਰਡ ਨਾਲ ਸੰਭਾਲਿਆ ਜਾਂਦਾ ਹੈ। ParkProof ਇਸ ਦੀ ਜਾਂਚ ਨਹੀਂ ਕਰਦਾ।',
  },

  // ── Item 2: the share sheet (record screen, home card Share icon) ──
  'share.action': {
    en: 'Share where the car is',
    'zh-CN': '分享车辆位置',
    vi: 'Chia sẻ vị trí xe',
    id: 'Bagikan lokasi mobil',
    ko: '차 위치 공유',
    it: "Condividi dove si trova l'auto",
    el: 'Κοινοποίησε πού είναι το αυτοκίνητο',
    hi: 'कार कहाँ है, यह साझा करें',
    pa: 'ਕਾਰ ਕਿੱਥੇ ਹੈ, ਇਹ ਸਾਂਝਾ ਕਰੋ',
  },
  // The spec's confirm, shown before any link is made.
  'share.confirm': {
    en: "Anyone with this link can see where the car is parked, who parked it and until when. It works for anyone it's forwarded to, and you can't switch it off.",
    'zh-CN': '任何拿到这个链接的人都能看到车停在哪里、谁停的车以及可以停到几点。链接转发给谁,谁就能打开,而且你无法关闭它。',
    vi: 'Bất kỳ ai có liên kết này đều xem được xe đang đỗ ở đâu, ai đã đỗ và được đỗ đến khi nào. Liên kết dùng được với bất kỳ ai nhận được khi bị chuyển tiếp, và bạn không thể tắt nó.',
    id: 'Siapa pun yang punya tautan ini bisa melihat di mana mobil diparkir, siapa yang memarkirnya, dan sampai kapan. Tautan ini bisa dibuka oleh siapa pun yang menerimanya dari terusan, dan kamu tidak bisa mematikannya.',
    ko: '이 링크가 있는 사람은 누구나 차가 어디에 주차되어 있는지, 누가 주차했는지, 언제까지인지 볼 수 있습니다. 전달받은 사람도 누구나 열 수 있으며, 링크를 끌 수 없습니다.',
    it: "Chiunque abbia questo link può vedere dove è parcheggiata l'auto, chi l'ha parcheggiata e fino a quando. Funziona per chiunque lo riceva inoltrato e non puoi disattivarlo.",
    el: 'Όποιος έχει αυτόν τον σύνδεσμο μπορεί να δει πού είναι σταθμευμένο το αυτοκίνητο, ποιος το στάθμευσε και μέχρι πότε. Λειτουργεί για όποιον τον λάβει με προώθηση και δεν μπορείς να τον απενεργοποιήσεις.',
    hi: 'इस लिंक वाला कोई भी व्यक्ति देख सकता है कि कार कहाँ पार्क है, किसने पार्क की और कब तक। यह लिंक जिसे भी आगे भेजा जाए, उसके लिए काम करता है, और आप इसे बंद नहीं कर सकते।',
    pa: 'ਇਸ ਲਿੰਕ ਵਾਲਾ ਕੋਈ ਵੀ ਵਿਅਕਤੀ ਦੇਖ ਸਕਦਾ ਹੈ ਕਿ ਕਾਰ ਕਿੱਥੇ ਪਾਰਕ ਹੈ, ਕਿਸ ਨੇ ਪਾਰਕ ਕੀਤੀ ਅਤੇ ਕਦੋਂ ਤੱਕ। ਇਹ ਲਿੰਕ ਜਿਸ ਨੂੰ ਵੀ ਅੱਗੇ ਭੇਜਿਆ ਜਾਵੇ, ਉਸ ਲਈ ਕੰਮ ਕਰਦਾ ਹੈ, ਅਤੇ ਤੁਸੀਂ ਇਸ ਨੂੰ ਬੰਦ ਨਹੀਂ ਕਰ ਸਕਦੇ।',
  },
  'share.shareButton': {
    en: 'Share link',
    'zh-CN': '分享链接',
    vi: 'Chia sẻ liên kết',
    id: 'Bagikan tautan',
    ko: '링크 공유',
    it: 'Condividi il link',
    el: 'Κοινοποίηση συνδέσμου',
    hi: 'लिंक साझा करें',
    pa: 'ਲਿੰਕ ਸਾਂਝਾ ਕਰੋ',
  },
  // The text the system share sheet sends with the link.
  'share.shareText': {
    en: 'Where the car is parked, from ParkProof.',
    'zh-CN': '车停在哪里,来自 ParkProof。',
    vi: 'Xe đang đỗ ở đâu, từ ParkProof.',
    id: 'Lokasi parkir mobil, dari ParkProof.',
    ko: 'ParkProof에서 보낸 차 주차 위치입니다.',
    it: "Dove è parcheggiata l'auto, da ParkProof.",
    el: 'Πού είναι σταθμευμένο το αυτοκίνητο, από το ParkProof.',
    hi: 'कार कहाँ पार्क है, ParkProof से।',
    pa: 'ਕਾਰ ਕਿੱਥੇ ਪਾਰਕ ਹੈ, ParkProof ਤੋਂ।',
  },
  'share.notSigned': {
    en: "This record isn't signed yet. You can share it once ParkProof has signed it.",
    'zh-CN': '这条记录还没有签名。ParkProof 签名后你就可以分享。',
    vi: 'Bản ghi này chưa được ký. Bạn có thể chia sẻ sau khi ParkProof đã ký.',
    id: 'Catatan ini belum ditandatangani. Kamu bisa membagikannya setelah ParkProof menandatanganinya.',
    ko: '이 기록은 아직 서명되지 않았습니다. ParkProof가 서명하면 공유할 수 있습니다.',
    it: 'Questo record non è ancora firmato. Potrai condividerlo quando ParkProof lo avrà firmato.',
    el: 'Αυτή η εγγραφή δεν έχει υπογραφεί ακόμη. Μπορείς να την κοινοποιήσεις μόλις την υπογράψει το ParkProof.',
    hi: 'इस रिकॉर्ड पर अभी हस्ताक्षर नहीं हुए हैं। ParkProof के हस्ताक्षर करने के बाद आप इसे साझा कर सकते हैं।',
    pa: "ਇਸ ਰਿਕਾਰਡ 'ਤੇ ਅਜੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੋਏ। ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਤੁਸੀਂ ਇਸ ਨੂੰ ਸਾਂਝਾ ਕਰ ਸਕਦੇ ਹੋ।",
  },
  'share.tooLarge': {
    en: 'This record is too big to share as a link.',
    'zh-CN': '这条记录太大,无法用链接分享。',
    vi: 'Bản ghi này quá lớn để chia sẻ bằng liên kết.',
    id: 'Catatan ini terlalu besar untuk dibagikan sebagai tautan.',
    ko: '이 기록은 너무 커서 링크로 공유할 수 없습니다.',
    it: 'Questo record è troppo grande per condividerlo con un link.',
    el: 'Αυτή η εγγραφή είναι πολύ μεγάλη για να κοινοποιηθεί ως σύνδεσμος.',
    hi: 'यह रिकॉर्ड लिंक के रूप में साझा करने के लिए बहुत बड़ा है।',
    pa: 'ਇਹ ਰਿਕਾਰਡ ਲਿੰਕ ਵਜੋਂ ਸਾਂਝਾ ਕਰਨ ਲਈ ਬਹੁਤ ਵੱਡਾ ਹੈ।',
  },
  'share.copied': {
    en: 'Link copied. Paste it into a message to share it.',
    'zh-CN': '链接已复制。粘贴到消息里即可分享。',
    vi: 'Đã sao chép liên kết. Dán vào tin nhắn để chia sẻ.',
    id: 'Tautan disalin. Tempelkan ke pesan untuk membagikannya.',
    ko: '링크를 복사했습니다. 메시지에 붙여 넣어 공유하세요.',
    it: 'Link copiato. Incollalo in un messaggio per condividerlo.',
    el: 'Ο σύνδεσμος αντιγράφηκε. Επικόλλησέ τον σε ένα μήνυμα για να τον κοινοποιήσεις.',
    hi: 'लिंक कॉपी हो गया। साझा करने के लिए इसे किसी संदेश में पेस्ट करें।',
    pa: 'ਲਿੰਕ ਕਾਪੀ ਹੋ ਗਿਆ। ਸਾਂਝਾ ਕਰਨ ਲਈ ਇਸ ਨੂੰ ਕਿਸੇ ਸੁਨੇਹੇ ਵਿੱਚ ਪੇਸਟ ਕਰੋ।',
  },
  'share.copyManually': {
    en: 'Copy this link and send it.',
    'zh-CN': '复制这个链接并发送出去。',
    vi: 'Hãy sao chép liên kết này và gửi đi.',
    id: 'Salin tautan ini lalu kirimkan.',
    ko: '이 링크를 복사해서 보내세요.',
    it: 'Copia questo link e invialo.',
    el: 'Αντίγραψε αυτόν τον σύνδεσμο και στείλε τον.',
    hi: 'यह लिंक कॉपी करके भेजें।',
    pa: 'ਇਹ ਲਿੰਕ ਕਾਪੀ ਕਰਕੇ ਭੇਜੋ।',
  },
  'share.linkFieldLabel': {
    en: 'Link to share',
    'zh-CN': '要分享的链接',
    vi: 'Liên kết để chia sẻ',
    id: 'Tautan untuk dibagikan',
    ko: '공유할 링크',
    it: 'Link da condividere',
    el: 'Σύνδεσμος για κοινοποίηση',
    hi: 'साझा करने के लिए लिंक',
    pa: 'ਸਾਂਝਾ ਕਰਨ ਲਈ ਲਿੰਕ',
  },
  // Item 6, on the share sheet (and, from the handover unit, its screen).
  'share.permitSafeguard': {
    en: "This park used an accessible parking permit. If the permit holder won't be in the car, take the permit off the dash before anyone drives it.",
    'zh-CN': '这次停车使用了无障碍停车许可证。如果持证人不会在车上,请在任何人开走这辆车之前,把许可证从仪表台上取下来。',
    vi: 'Lần đỗ xe này đã dùng giấy phép đỗ xe tiếp cận. Nếu người có giấy phép sẽ không ở trên xe, hãy lấy giấy phép ra khỏi bảng điều khiển trước khi có ai lái xe đi.',
    id: 'Parkir ini memakai izin parkir aksesibel. Jika pemegang izin tidak akan berada di mobil, ambil izin itu dari dasbor sebelum ada yang mengemudikan mobilnya.',
    ko: '이번 주차에는 장애인 주차 허가증을 사용했습니다. 허가증 소지자가 차에 타지 않는다면, 누가 운전하기 전에 대시보드에서 허가증을 치우세요.',
    it: "Per questo parcheggio è stato usato un permesso di parcheggio accessibile. Se il titolare del permesso non sarà in auto, togli il permesso dal cruscotto prima che qualcuno guidi l'auto.",
    el: 'Για αυτή τη στάθμευση χρησιμοποιήθηκε άδεια προσβάσιμης στάθμευσης. Αν ο κάτοχος της άδειας δεν θα είναι στο αυτοκίνητο, βγάλε την άδεια από το ταμπλό πριν το οδηγήσει κάποιος.',
    hi: 'इस पार्किंग में सुलभ पार्किंग परमिट का इस्तेमाल हुआ था। अगर परमिट धारक कार में मौजूद नहीं रहेंगे, तो किसी के भी कार चलाने से पहले परमिट को डैशबोर्ड से हटा दें।',
    pa: 'ਇਸ ਪਾਰਕਿੰਗ ਵਿੱਚ ਪਹੁੰਚਯੋਗ ਪਾਰਕਿੰਗ ਪਰਮਿਟ ਵਰਤਿਆ ਗਿਆ ਸੀ। ਜੇ ਪਰਮਿਟ ਧਾਰਕ ਕਾਰ ਵਿੱਚ ਮੌਜੂਦ ਨਹੀਂ ਰਹਿਣਗੇ, ਤਾਂ ਕਿਸੇ ਦੇ ਵੀ ਕਾਰ ਚਲਾਉਣ ਤੋਂ ਪਹਿਲਾਂ ਪਰਮਿਟ ਨੂੰ ਡੈਸ਼ਬੋਰਡ ਤੋਂ ਹਟਾ ਦਿਓ।',
  },

  // ── Item 3: the receive view `shared` ──
  'share.receivedTitle': {
    en: 'Where the car is',
    'zh-CN': '车辆位置',
    vi: 'Vị trí xe',
    id: 'Lokasi mobil',
    ko: '차 위치',
    it: "Dove si trova l'auto",
    el: 'Πού είναι το αυτοκίνητο',
    hi: 'कार कहाँ है',
    pa: 'ਕਾਰ ਕਿੱਥੇ ਹੈ',
  },
  'share.checking': {
    en: 'Checking the link…',
    'zh-CN': '正在检查链接…',
    vi: 'Đang kiểm tra liên kết…',
    id: 'Memeriksa tautan…',
    ko: '링크를 확인하는 중…',
    it: 'Controllo del link…',
    el: 'Έλεγχος του συνδέσμου…',
    hi: 'लिंक की जाँच हो रही है…',
    pa: 'ਲਿੰਕ ਦੀ ਜਾਂਚ ਹੋ ਰਹੀ ਹੈ…',
  },
  // The spec's banner.
  'share.banner': {
    en: "Shared by {{driver}} at {{time}}. This is a snapshot and doesn't update. The car may have moved.",
    'zh-CN': '由 {{driver}} 于 {{time}} 分享。这是一份快照,不会更新。车辆可能已经移动。',
    vi: '{{driver}} đã chia sẻ lúc {{time}}. Đây là ảnh chụp tại thời điểm đó và không tự cập nhật. Xe có thể đã được di chuyển.',
    id: 'Dibagikan oleh {{driver}} pada {{time}}. Ini cuplikan dan tidak diperbarui. Mobilnya mungkin sudah dipindahkan.',
    ko: '{{driver}}님이 {{time}}에 공유했습니다. 이 내용은 그 시점의 기록이며 업데이트되지 않습니다. 차가 이동했을 수 있습니다.',
    it: "Condiviso da {{driver}}: {{time}}. È un'istantanea e non si aggiorna. L'auto potrebbe essere stata spostata.",
    el: 'Κοινοποιήθηκε από: {{driver}}, στις {{time}}. Είναι στιγμιότυπο και δεν ενημερώνεται. Το αυτοκίνητο μπορεί να έχει μετακινηθεί.',
    hi: '{{driver}} ने {{time}} पर साझा किया। यह उस समय की झलक है और अपडेट नहीं होती। हो सकता है कार हटाई जा चुकी हो।',
    pa: "{{driver}} ਨੇ {{time}} 'ਤੇ ਸਾਂਝਾ ਕੀਤਾ। ਇਹ ਉਸ ਸਮੇਂ ਦੀ ਝਲਕ ਹੈ ਅਤੇ ਅੱਪਡੇਟ ਨਹੀਂ ਹੁੰਦੀ। ਹੋ ਸਕਦਾ ਹੈ ਕਾਰ ਹਟਾਈ ਜਾ ਚੁੱਕੀ ਹੋਵੇ।",
  },
  // The banner when the sender named no driver.
  'share.bannerNoDriver': {
    en: "Shared at {{time}}. This is a snapshot and doesn't update. The car may have moved.",
    'zh-CN': '于 {{time}} 分享。这是一份快照,不会更新。车辆可能已经移动。',
    vi: 'Được chia sẻ lúc {{time}}. Đây là ảnh chụp tại thời điểm đó và không tự cập nhật. Xe có thể đã được di chuyển.',
    id: 'Dibagikan pada {{time}}. Ini cuplikan dan tidak diperbarui. Mobilnya mungkin sudah dipindahkan.',
    ko: '{{time}}에 공유되었습니다. 이 내용은 그 시점의 기록이며 업데이트되지 않습니다. 차가 이동했을 수 있습니다.',
    it: "Condiviso: {{time}}. È un'istantanea e non si aggiorna. L'auto potrebbe essere stata spostata.",
    el: 'Κοινοποιήθηκε στις {{time}}. Είναι στιγμιότυπο και δεν ενημερώνεται. Το αυτοκίνητο μπορεί να έχει μετακινηθεί.',
    hi: '{{time}} पर साझा किया गया। यह उस समय की झलक है और अपडेट नहीं होती। हो सकता है कार हटाई जा चुकी हो।',
    pa: "{{time}} 'ਤੇ ਸਾਂਝਾ ਕੀਤਾ ਗਿਆ। ਇਹ ਉਸ ਸਮੇਂ ਦੀ ਝਲਕ ਹੈ ਅਤੇ ਅੱਪਡੇਟ ਨਹੀਂ ਹੁੰਦੀ। ਹੋ ਸਕਦਾ ਹੈ ਕਾਰ ਹਟਾਈ ਜਾ ਚੁੱਕੀ ਹੋਵੇ।",
  },
  // A stored copy without a readable share time.
  'share.bannerNoTime': {
    en: "This is a snapshot and doesn't update. The car may have moved.",
    'zh-CN': '这是一份快照,不会更新。车辆可能已经移动。',
    vi: 'Đây là ảnh chụp tại thời điểm đó và không tự cập nhật. Xe có thể đã được di chuyển.',
    id: 'Ini cuplikan dan tidak diperbarui. Mobilnya mungkin sudah dipindahkan.',
    ko: '이 내용은 그 시점의 기록이며 업데이트되지 않습니다. 차가 이동했을 수 있습니다.',
    it: "È un'istantanea e non si aggiorna. L'auto potrebbe essere stata spostata.",
    el: 'Είναι στιγμιότυπο και δεν ενημερώνεται. Το αυτοκίνητο μπορεί να έχει μετακινηθεί.',
    hi: 'यह उस समय की झलक है और अपडेट नहीं होती। हो सकता है कार हटाई जा चुकी हो।',
    pa: 'ਇਹ ਉਸ ਸਮੇਂ ਦੀ ਝਲਕ ਹੈ ਅਤੇ ਅੱਪਡੇਟ ਨਹੀਂ ਹੁੰਦੀ। ਹੋ ਸਕਦਾ ਹੈ ਕਾਰ ਹਟਾਈ ਜਾ ਚੁੱਕੀ ਹੋਵੇ।',
  },
  // The spec's message when the bundle doesn't verify (no full stop, as the spec gives it).
  'share.tampered': {
    en: 'This link has been changed since it was shared',
    'zh-CN': '这个链接在分享后被改动过',
    vi: 'Liên kết này đã bị thay đổi kể từ khi được chia sẻ',
    id: 'Tautan ini sudah diubah sejak dibagikan',
    ko: '이 링크는 공유된 뒤 변경되었습니다',
    it: 'Questo link è stato modificato da quando è stato condiviso',
    el: 'Αυτός ο σύνδεσμος έχει αλλάξει από τότε που κοινοποιήθηκε',
    hi: 'साझा किए जाने के बाद से यह लिंक बदला गया है',
    pa: 'ਸਾਂਝਾ ਕੀਤੇ ਜਾਣ ਤੋਂ ਬਾਅਦ ਇਹ ਲਿੰਕ ਬਦਲਿਆ ਗਿਆ ਹੈ',
  },
  // The spec's message for an unknown version prefix.
  'share.newerVersion': {
    en: 'This link was made by a newer version of ParkProof',
    'zh-CN': '这个链接是用更新版本的 ParkProof 生成的',
    vi: 'Liên kết này được tạo bằng phiên bản ParkProof mới hơn',
    id: 'Tautan ini dibuat oleh versi ParkProof yang lebih baru',
    ko: '이 링크는 더 새로운 버전의 ParkProof로 만들어졌습니다',
    it: 'Questo link è stato creato da una versione più recente di ParkProof',
    el: 'Αυτός ο σύνδεσμος δημιουργήθηκε από νεότερη έκδοση του ParkProof',
    hi: 'यह लिंक ParkProof के नए संस्करण से बनाया गया था',
    pa: 'ਇਹ ਲਿੰਕ ParkProof ਦੇ ਨਵੇਂ ਸੰਸਕਰਣ ਨਾਲ ਬਣਾਇਆ ਗਿਆ ਸੀ',
  },
  // A link that isn't a share link (bad encoding, over 16 KB, missing parts).
  'share.unreadable': {
    en: "This share link can't be read. Ask the sender to share it again.",
    'zh-CN': '无法读取这个分享链接。请让发送者重新分享。',
    vi: 'Không đọc được liên kết chia sẻ này. Hãy nhờ người gửi chia sẻ lại.',
    id: 'Tautan berbagi ini tidak bisa dibaca. Minta pengirimnya membagikannya lagi.',
    ko: '이 공유 링크를 읽을 수 없습니다. 보낸 사람에게 다시 공유해 달라고 하세요.',
    it: "Questo link di condivisione non si può leggere. Chiedi a chi l'ha inviato di condividerlo di nuovo.",
    el: 'Αυτός ο σύνδεσμος κοινοποίησης δεν μπορεί να διαβαστεί. Ζήτα από τον αποστολέα να τον κοινοποιήσει ξανά.',
    hi: 'यह साझा लिंक पढ़ा नहीं जा सका। भेजने वाले से इसे दोबारा साझा करने को कहें।',
    pa: 'ਇਹ ਸਾਂਝਾ ਲਿੰਕ ਪੜ੍ਹਿਆ ਨਹੀਂ ਜਾ ਸਕਿਆ। ਭੇਜਣ ਵਾਲੇ ਨੂੰ ਇਸ ਨੂੰ ਦੁਬਾਰਾ ਸਾਂਝਾ ਕਰਨ ਲਈ ਕਹੋ।',
  },
  'share.signedHeading': {
    en: 'Signed details',
    'zh-CN': '已签名的详情',
    vi: 'Thông tin đã ký',
    id: 'Detail yang ditandatangani',
    ko: '서명된 내용',
    it: 'Dettagli firmati',
    el: 'Υπογεγραμμένα στοιχεία',
    hi: 'हस्ताक्षरित विवरण',
    pa: 'ਹਸਤਾਖਰਿਤ ਵੇਰਵੇ',
  },
  // What a signature does and doesn't show, wherever signed material is presented.
  'share.signedNote': {
    en: "ParkProof signed these details at {{time}}. The signature shows they haven't changed since then. It doesn't show they are true, who was driving, where the car was, or when it arrived or left.",
    'zh-CN': 'ParkProof 于 {{time}} 对这些详情签名。签名说明它们从那以后没有改动,但不能说明它们属实,也不能说明是谁在开车、车停在哪里,或车辆何时到达、何时离开。',
    vi: 'ParkProof đã ký các thông tin này lúc {{time}}. Chữ ký cho thấy chúng không thay đổi kể từ đó. Chữ ký không cho thấy chúng là đúng, ai là người lái xe, xe ở đâu, hay xe đến và rời đi lúc nào.',
    id: 'ParkProof menandatangani detail ini pada {{time}}. Tanda tangan menunjukkan detail ini tidak berubah sejak itu. Tanda tangan tidak menunjukkan bahwa detail ini benar, siapa yang mengemudi, di mana mobil berada, atau kapan mobil tiba atau pergi.',
    ko: 'ParkProof가 {{time}}에 이 내용에 서명했습니다. 서명은 그 뒤로 내용이 바뀌지 않았음을 보여 줍니다. 내용이 사실인지, 누가 운전했는지, 차가 어디에 있었는지, 언제 도착하거나 떠났는지는 보여 주지 않습니다.',
    it: "ParkProof ha firmato questi dettagli: {{time}}. La firma mostra che da allora non sono cambiati. Non mostra che siano veri, chi guidava, dove si trovava l'auto, né quando è arrivata o partita.",
    el: 'Το ParkProof υπέγραψε αυτά τα στοιχεία στις {{time}}. Η υπογραφή δείχνει ότι δεν έχουν αλλάξει από τότε. Δεν δείχνει ότι είναι αληθινά, ποιος οδηγούσε, πού ήταν το αυτοκίνητο ή πότε έφτασε ή έφυγε.',
    hi: 'ParkProof ने {{time}} पर इन विवरणों पर हस्ताक्षर किए। हस्ताक्षर दिखाता है कि तब से इनमें कोई बदलाव नहीं हुआ। यह नहीं दिखाता कि ये सच हैं, चालक कौन था, कार कहाँ थी, या वह कब पहुँची या कब गई।',
    pa: "ParkProof ਨੇ {{time}} 'ਤੇ ਇਨ੍ਹਾਂ ਵੇਰਵਿਆਂ 'ਤੇ ਹਸਤਾਖਰ ਕੀਤੇ। ਹਸਤਾਖਰ ਦਿਖਾਉਂਦੇ ਹਨ ਕਿ ਉਦੋਂ ਤੋਂ ਇਨ੍ਹਾਂ ਵਿੱਚ ਕੋਈ ਬਦਲਾਅ ਨਹੀਂ ਹੋਇਆ। ਇਹ ਨਹੀਂ ਦਿਖਾਉਂਦੇ ਕਿ ਇਹ ਸੱਚ ਹਨ, ਡਰਾਈਵਰ ਕੌਣ ਸੀ, ਕਾਰ ਕਿੱਥੇ ਸੀ, ਜਾਂ ਉਹ ਕਦੋਂ ਪਹੁੰਚੀ ਜਾਂ ਗਈ।",
  },
  'share.signedNoteNoTime': {
    en: "The signature shows these details haven't changed since ParkProof signed them. It doesn't show they are true, who was driving, where the car was, or when it arrived or left.",
    'zh-CN': '签名说明这些详情自 ParkProof 签名以来没有改动,但不能说明它们属实,也不能说明是谁在开车、车停在哪里,或车辆何时到达、何时离开。',
    vi: 'Chữ ký cho thấy các thông tin này không thay đổi kể từ khi ParkProof ký. Chữ ký không cho thấy chúng là đúng, ai là người lái xe, xe ở đâu, hay xe đến và rời đi lúc nào.',
    id: 'Tanda tangan menunjukkan detail ini tidak berubah sejak ParkProof menandatanganinya. Tanda tangan tidak menunjukkan bahwa detail ini benar, siapa yang mengemudi, di mana mobil berada, atau kapan mobil tiba atau pergi.',
    ko: '서명은 ParkProof가 서명한 뒤로 이 내용이 바뀌지 않았음을 보여 줍니다. 내용이 사실인지, 누가 운전했는지, 차가 어디에 있었는지, 언제 도착하거나 떠났는지는 보여 주지 않습니다.',
    it: "La firma mostra che questi dettagli non sono cambiati da quando ParkProof li ha firmati. Non mostra che siano veri, chi guidava, dove si trovava l'auto, né quando è arrivata o partita.",
    el: 'Η υπογραφή δείχνει ότι αυτά τα στοιχεία δεν έχουν αλλάξει από τότε που τα υπέγραψε το ParkProof. Δεν δείχνει ότι είναι αληθινά, ποιος οδηγούσε, πού ήταν το αυτοκίνητο ή πότε έφτασε ή έφυγε.',
    hi: 'हस्ताक्षर दिखाता है कि ParkProof के हस्ताक्षर करने के बाद से इन विवरणों में कोई बदलाव नहीं हुआ। यह नहीं दिखाता कि ये सच हैं, चालक कौन था, कार कहाँ थी, या वह कब पहुँची या कब गई।',
    pa: 'ਹਸਤਾਖਰ ਦਿਖਾਉਂਦੇ ਹਨ ਕਿ ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਇਨ੍ਹਾਂ ਵੇਰਵਿਆਂ ਵਿੱਚ ਕੋਈ ਬਦਲਾਅ ਨਹੀਂ ਹੋਇਆ। ਇਹ ਨਹੀਂ ਦਿਖਾਉਂਦੇ ਕਿ ਇਹ ਸੱਚ ਹਨ, ਡਰਾਈਵਰ ਕੌਣ ਸੀ, ਕਾਰ ਕਿੱਥੇ ਸੀ, ਜਾਂ ਉਹ ਕਦੋਂ ਪਹੁੰਚੀ ਜਾਂ ਗਈ।',
  },
  'share.field.place': {
    en: 'Where it was logged',
    'zh-CN': '记录地点',
    vi: 'Nơi ghi lại',
    id: 'Lokasi saat dicatat',
    ko: '기록한 위치',
    it: 'Dove è stato registrato',
    el: 'Πού καταγράφηκε',
    hi: 'जहाँ दर्ज किया गया',
    pa: 'ਜਿੱਥੇ ਦਰਜ ਕੀਤਾ ਗਿਆ',
  },
  'share.field.arrived': {
    en: 'Logged at',
    'zh-CN': '记录时间',
    vi: 'Thời điểm ghi lại',
    id: 'Dicatat pada',
    ko: '기록 시각',
    it: 'Registrato',
    el: 'Ώρα καταγραφής',
    hi: 'दर्ज करने का समय',
    pa: 'ਦਰਜ ਕਰਨ ਦਾ ਸਮਾਂ',
  },
  'share.field.limit': {
    en: 'Limit read from the sign',
    'zh-CN': '从标志读取的时限',
    vi: 'Giới hạn đọc từ biển báo',
    id: 'Batas waktu dari rambu',
    ko: '표지판에서 읽은 제한 시각',
    it: 'Limite letto dal cartello',
    el: 'Όριο από την πινακίδα',
    hi: 'साइन से पढ़ी गई सीमा',
    pa: 'ਚਿੰਨ੍ਹ ਤੋਂ ਪੜ੍ਹੀ ਗਈ ਸੀਮਾ',
  },
  // The signed limit when the link also carries the sign's standard limit: it
  // is then the permit time, so never labelled "read from the sign".
  'share.field.limitRecorded': {
    en: 'Limit on this record',
    'zh-CN': '这条记录上的时限',
    vi: 'Giới hạn trong bản ghi này',
    id: 'Batas waktu pada catatan ini',
    ko: '이 기록의 제한 시각',
    it: 'Limite in questo record',
    el: 'Όριο σε αυτή την εγγραφή',
    hi: 'इस रिकॉर्ड में दर्ज सीमा',
    pa: 'ਇਸ ਰਿਕਾਰਡ ਵਿੱਚ ਦਰਜ ਸੀਮਾ',
  },
  // Under the countdown when the link carries the sign's standard limit (a
  // permit-adjusted park). The time is the sender's, not signed.
  'share.permitTimeNote': {
    en: "This limit includes extra time from a permit. Without the permit, the sign's standard limit applies. The sender says it ends at {{time}}.",
    'zh-CN': '这个时限包含许可证带来的额外时间。没有许可证时,适用标志上的标准时限。发送者说标准时限在 {{time}} 结束。',
    vi: 'Giới hạn này gồm thời gian thêm nhờ giấy phép. Nếu không có giấy phép, giới hạn tiêu chuẩn trên biển báo được áp dụng. Người gửi cho biết giới hạn đó kết thúc lúc {{time}}.',
    id: 'Batas waktu ini termasuk waktu tambahan dari izin. Tanpa izin itu, yang berlaku adalah batas standar pada rambu. Menurut pengirim, batas itu berakhir pada {{time}}.',
    ko: '이 제한 시각에는 허가증으로 받은 추가 시간이 포함되어 있습니다. 허가증이 없으면 표지판의 기본 제한 시각이 적용됩니다. 보낸 사람에 따르면 기본 제한 시각은 {{time}}입니다.',
    it: 'Questo limite include tempo in più dato da un permesso. Senza il permesso vale il limite standard del cartello. Secondo chi ha inviato il link, termina: {{time}}.',
    el: 'Αυτό το όριο περιλαμβάνει επιπλέον χρόνο από άδεια. Χωρίς την άδεια ισχύει το κανονικό όριο της πινακίδας. Σύμφωνα με τον αποστολέα, λήγει: {{time}}.',
    hi: 'इस सीमा में परमिट से मिला अतिरिक्त समय शामिल है। परमिट के बिना साइन की मानक सीमा लागू होती है। भेजने वाले के अनुसार वह {{time}} पर ख़त्म होती है।',
    pa: "ਇਸ ਸੀਮਾ ਵਿੱਚ ਪਰਮਿਟ ਤੋਂ ਮਿਲਿਆ ਵਾਧੂ ਸਮਾਂ ਸ਼ਾਮਲ ਹੈ। ਪਰਮਿਟ ਤੋਂ ਬਿਨਾਂ ਚਿੰਨ੍ਹ ਦੀ ਮਿਆਰੀ ਸੀਮਾ ਲਾਗੂ ਹੁੰਦੀ ਹੈ। ਭੇਜਣ ਵਾਲੇ ਦੇ ਅਨੁਸਾਰ ਇਹ {{time}} 'ਤੇ ਖ਼ਤਮ ਹੁੰਦੀ ਹੈ।",
  },
  'share.field.driver': {
    en: 'Driver',
    'zh-CN': '驾驶员',
    vi: 'Người lái xe',
    id: 'Pengemudi',
    ko: '운전자',
    it: 'Conducente',
    el: 'Οδηγός',
    hi: 'चालक',
    pa: 'ਡਰਾਈਵਰ',
  },
  'share.field.rules': {
    en: 'Sign reading',
    'zh-CN': '标志解读',
    vi: 'Nội dung biển báo',
    id: 'Bacaan rambu',
    ko: '표지판 내용',
    it: 'Lettura del cartello',
    el: 'Ανάγνωση πινακίδας',
    hi: 'साइन की जानकारी',
    pa: 'ਚਿੰਨ੍ਹ ਦੀ ਜਾਣਕਾਰੀ',
  },
  'share.field.standardLimit': {
    en: 'Standard limit on the sign',
    'zh-CN': '标志上的标准时限',
    vi: 'Giới hạn tiêu chuẩn trên biển báo',
    id: 'Batas standar pada rambu',
    ko: '표지판의 기본 제한 시각',
    it: 'Limite standard del cartello',
    el: 'Κανονικό όριο της πινακίδας',
    hi: 'साइन पर मानक सीमा',
    pa: "ਚਿੰਨ੍ਹ 'ਤੇ ਮਿਆਰੀ ਸੀਮਾ",
  },
  'share.field.ended': {
    en: 'Departure',
    'zh-CN': '离开',
    vi: 'Rời đi',
    id: 'Keberangkatan',
    ko: '출발',
    it: 'Partenza',
    el: 'Αναχώρηση',
    hi: 'प्रस्थान',
    pa: 'ਰਵਾਨਗੀ',
  },
  'share.phoneClock': {
    en: '{{time}} (phone clock)',
    'zh-CN': '{{time}}(手机时钟)',
    vi: '{{time}} (đồng hồ điện thoại)',
    id: '{{time}} (jam ponsel)',
    ko: '{{time}} (휴대폰 시계)',
    it: '{{time}} (orologio del telefono)',
    el: '{{time}} (ρολόι κινητού)',
    hi: '{{time}} (फ़ोन की घड़ी)',
    pa: '{{time}} (ਫ਼ੋਨ ਦੀ ਘੜੀ)',
  },
  'share.noLimit': {
    en: 'No limit recorded',
    'zh-CN': '没有记录时限',
    vi: 'Không ghi nhận giới hạn',
    id: 'Tidak ada batas waktu yang dicatat',
    ko: '기록된 제한 시각 없음',
    it: 'Nessun limite registrato',
    el: 'Δεν καταγράφηκε όριο',
    hi: 'कोई सीमा दर्ज नहीं',
    pa: 'ਕੋਈ ਸੀਮਾ ਦਰਜ ਨਹੀਂ',
  },
  'share.noPlace': {
    en: 'No location recorded',
    'zh-CN': '没有记录位置',
    vi: 'Không ghi nhận vị trí',
    id: 'Tidak ada lokasi yang dicatat',
    ko: '기록된 위치 없음',
    it: 'Nessuna posizione registrata',
    el: 'Δεν καταγράφηκε τοποθεσία',
    hi: 'कोई स्थान दर्ज नहीं',
    pa: 'ਕੋਈ ਟਿਕਾਣਾ ਦਰਜ ਨਹੀਂ',
  },
  'share.directions': {
    en: 'Directions',
    'zh-CN': '路线',
    vi: 'Chỉ đường',
    id: 'Petunjuk arah',
    ko: '길찾기',
    it: 'Indicazioni',
    el: 'Οδηγίες διαδρομής',
    hi: 'रास्ता देखें',
    pa: 'ਰਸਤਾ ਦੇਖੋ',
  },
  // The spec's label for the unsigned extras.
  'share.unsignedHeading': {
    en: 'From the sender, not signed',
    'zh-CN': '来自发送者,未签名',
    vi: 'Từ người gửi, chưa được ký',
    id: 'Dari pengirim, tidak ditandatangani',
    ko: '보낸 사람이 입력, 서명되지 않음',
    it: 'Dal mittente, non firmato',
    el: 'Από τον αποστολέα, χωρίς υπογραφή',
    hi: 'भेजने वाले की ओर से, हस्ताक्षरित नहीं',
    pa: 'ਭੇਜਣ ਵਾਲੇ ਵੱਲੋਂ, ਹਸਤਾਖਰਿਤ ਨਹੀਂ',
  },
  // A phone time, labelled as one; never called signed.
  'share.endedValue': {
    en: "The sender tapped I've left at {{time}} (phone clock).",
    'zh-CN': '发送者于 {{time}} 点击了"我已离开"(手机时钟)。',
    vi: 'Người gửi đã nhấn "Tôi đã đi" lúc {{time}} (đồng hồ điện thoại).',
    id: 'Pengirim mengetuk "Sudah pergi" pada {{time}} (jam ponsel).',
    ko: '보낸 사람이 {{time}}에 "떠났습니다"를 눌렀습니다 (휴대폰 시계).',
    it: 'Il mittente ha toccato "Ho lasciato il posto": {{time}} (orologio del telefono).',
    el: 'Ο αποστολέας πάτησε «Έφυγα» στις {{time}} (ρολόι κινητού).',
    hi: 'भेजने वाले ने {{time}} पर "मैंने जगह खाली कर दी" पर टैप किया (फ़ोन की घड़ी)।',
    pa: 'ਭੇਜਣ ਵਾਲੇ ਨੇ {{time}} \'ਤੇ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" \'ਤੇ ਟੈਪ ਕੀਤਾ (ਫ਼ੋਨ ਦੀ ਘੜੀ)।',
  },
  'share.saved': {
    en: 'Saved in your parking records as "Shared with you". Opening the link again updates it.',
    'zh-CN': '已保存到你的停车记录,标为"分享给你的"。再次打开链接会更新它。',
    vi: 'Đã lưu vào bản ghi đỗ xe của bạn với nhãn "Được chia sẻ với bạn". Mở lại liên kết sẽ cập nhật bản ghi.',
    id: 'Disimpan di catatan parkirmu sebagai "Dibagikan kepadamu". Membuka tautan lagi akan memperbaruinya.',
    ko: '주차 기록에 "공유받은 기록"으로 저장했습니다. 링크를 다시 열면 업데이트됩니다.',
    it: 'Salvato nei tuoi record di parcheggio come "Condiviso con te". Se riapri il link, viene aggiornato.',
    el: 'Αποθηκεύτηκε στα αρχεία στάθμευσής σου ως «Κοινοποιήθηκε σε σένα». Αν ανοίξεις ξανά τον σύνδεσμο, θα ενημερωθεί.',
    hi: 'आपके पार्किंग रिकॉर्ड में "आपके साथ साझा" के रूप में सहेजा गया। लिंक दोबारा खोलने पर यह अपडेट हो जाएगा।',
    pa: 'ਤੁਹਾਡੇ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡਾਂ ਵਿੱਚ "ਤੁਹਾਡੇ ਨਾਲ ਸਾਂਝਾ" ਵਜੋਂ ਸੰਭਾਲਿਆ ਗਿਆ। ਲਿੰਕ ਦੁਬਾਰਾ ਖੋਲ੍ਹਣ \'ਤੇ ਇਹ ਅੱਪਡੇਟ ਹੋ ਜਾਵੇਗਾ।',
  },
  'share.keptNewer': {
    en: 'You already have a later copy of this record from a newer link, so that one was kept.',
    'zh-CN': '你已经有一份来自更新链接的这条记录的副本,所以保留了那一份。',
    vi: 'Bạn đã có một bản sao mới hơn của bản ghi này từ một liên kết mới hơn, nên bản đó được giữ lại.',
    id: 'Kamu sudah punya salinan catatan ini yang lebih baru dari tautan yang lebih baru, jadi salinan itu yang disimpan.',
    ko: '더 새로운 링크에서 받은 이 기록의 사본이 이미 있어서 그 사본을 유지했습니다.',
    it: 'Hai già una copia più recente di questo record da un link più nuovo, quindi è stata mantenuta quella.',
    el: 'Έχεις ήδη ένα πιο πρόσφατο αντίγραφο αυτής της εγγραφής από νεότερο σύνδεσμο, οπότε κρατήθηκε εκείνο.',
    hi: 'आपके पास पहले से इस रिकॉर्ड की एक नई कॉपी है जो बाद वाले लिंक से आई थी, इसलिए वही रखी गई।',
    pa: 'ਤੁਹਾਡੇ ਕੋਲ ਪਹਿਲਾਂ ਹੀ ਇਸ ਰਿਕਾਰਡ ਦੀ ਇੱਕ ਨਵੀਂ ਕਾਪੀ ਹੈ ਜੋ ਬਾਅਦ ਵਾਲੇ ਲਿੰਕ ਤੋਂ ਆਈ ਸੀ, ਇਸ ਲਈ ਉਹੀ ਰੱਖੀ ਗਈ।',
  },
  'share.ownRecord': {
    en: "This link is for a record saved on this phone, so it wasn't added again.",
    'zh-CN': '这个链接对应的记录已经保存在这部手机上,所以没有再添加一次。',
    vi: 'Liên kết này dành cho một bản ghi đã lưu trên điện thoại này, nên không được thêm lại.',
    id: 'Tautan ini untuk catatan yang sudah tersimpan di ponsel ini, jadi tidak ditambahkan lagi.',
    ko: '이 링크는 이 휴대폰에 저장된 기록의 링크라서 다시 추가하지 않았습니다.',
    it: 'Questo link è di un record già salvato su questo telefono, quindi non è stato aggiunto di nuovo.',
    el: 'Αυτός ο σύνδεσμος αφορά εγγραφή που είναι ήδη αποθηκευμένη σε αυτό το τηλέφωνο, οπότε δεν προστέθηκε ξανά.',
    hi: 'यह लिंक इस फ़ोन पर पहले से सहेजे गए रिकॉर्ड का है, इसलिए इसे दोबारा नहीं जोड़ा गया।',
    pa: "ਇਹ ਲਿੰਕ ਇਸ ਫ਼ੋਨ 'ਤੇ ਪਹਿਲਾਂ ਤੋਂ ਸੰਭਾਲੇ ਗਏ ਰਿਕਾਰਡ ਦਾ ਹੈ, ਇਸ ਲਈ ਇਸ ਨੂੰ ਦੁਬਾਰਾ ਨਹੀਂ ਜੋੜਿਆ ਗਿਆ।",
  },
  'share.saveFailed': {
    en: "A copy couldn't be saved on this phone.",
    'zh-CN': '无法在这部手机上保存副本。',
    vi: 'Không thể lưu bản sao trên điện thoại này.',
    id: 'Salinan tidak bisa disimpan di ponsel ini.',
    ko: '이 휴대폰에 사본을 저장하지 못했습니다.',
    it: 'Non è stato possibile salvare una copia su questo telefono.',
    el: 'Δεν ήταν δυνατό να αποθηκευτεί αντίγραφο σε αυτό το τηλέφωνο.',
    hi: 'इस फ़ोन पर कॉपी सहेजी नहीं जा सकी।',
    pa: "ਇਸ ਫ਼ੋਨ 'ਤੇ ਕਾਪੀ ਸੰਭਾਲੀ ਨਹੀਂ ਜਾ ਸਕੀ।",
  },

  // ── Item 4: the read-only copy (History badge, record screen) ──
  'share.badge': {
    en: 'Shared with you',
    'zh-CN': '分享给你的',
    vi: 'Được chia sẻ với bạn',
    id: 'Dibagikan kepadamu',
    ko: '공유받은 기록',
    it: 'Condiviso con te',
    el: 'Κοινοποιήθηκε σε σένα',
    hi: 'आपके साथ साझा',
    pa: 'ਤੁਹਾਡੇ ਨਾਲ ਸਾਂਝਾ',
  },
  'share.check': {
    en: 'Check the signature',
    'zh-CN': '核验签名',
    vi: 'Kiểm tra chữ ký',
    id: 'Cek tanda tangan',
    ko: '서명 확인',
    it: 'Verifica la firma',
    el: 'Έλεγχος υπογραφής',
    hi: 'हस्ताक्षर जांचें',
    pa: 'ਹਸਤਾਖਰ ਜਾਂਚੋ',
  },
  'share.checkValid': {
    en: "The signature is valid. Nothing has changed since ParkProof signed it. That doesn't show the details are true, who was driving, where the car was, or when it arrived or left.",
    'zh-CN': '签名有效。自 ParkProof 签名以来没有任何改动。但这不能说明这些内容属实,也不能说明是谁在开车、车停在哪里,或车辆何时到达、何时离开。',
    vi: 'Chữ ký hợp lệ. Không có gì thay đổi kể từ khi ParkProof ký. Điều đó không cho thấy nội dung bản ghi là đúng, ai là người lái xe, xe ở đâu, hay xe đến và rời đi lúc nào.',
    id: 'Tanda tangan valid. Tidak ada yang berubah sejak ParkProof menandatanganinya. Itu tidak menunjukkan bahwa isi catatan ini benar, siapa yang mengemudi, di mana mobil berada, atau kapan mobil tiba atau pergi.',
    ko: '서명이 유효합니다. ParkProof가 서명한 뒤로 바뀐 것이 없습니다. 그렇다고 기록 내용이 사실인지, 누가 운전했는지, 차가 어디에 있었는지, 언제 도착하거나 떠났는지를 보여 주는 것은 아닙니다.',
    it: "La firma è valida. Nulla è cambiato da quando ParkProof ha firmato. Questo non mostra che quanto dice il record sia vero, chi guidava, dove si trovava l'auto, né quando è arrivata o partita.",
    el: 'Η υπογραφή είναι έγκυρη. Τίποτα δεν έχει αλλάξει από τότε που υπέγραψε το ParkProof. Αυτό δεν δείχνει ότι όσα λέει η εγγραφή είναι αληθινά, ποιος οδηγούσε, πού ήταν το αυτοκίνητο ή πότε έφτασε ή έφυγε.',
    hi: 'हस्ताक्षर मान्य है। ParkProof के हस्ताक्षर करने के बाद से कुछ नहीं बदला है। इससे यह पता नहीं चलता कि रिकॉर्ड में लिखी बातें सच हैं, चालक कौन था, कार कहाँ थी, या वह कब पहुँची या कब गई।',
    pa: 'ਹਸਤਾਖਰ ਵੈਧ ਹੈ। ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਕੁਝ ਨਹੀਂ ਬਦਲਿਆ। ਇਸ ਤੋਂ ਇਹ ਪਤਾ ਨਹੀਂ ਲੱਗਦਾ ਕਿ ਰਿਕਾਰਡ ਵਿੱਚ ਲਿਖੀਆਂ ਗੱਲਾਂ ਸੱਚ ਹਨ, ਡਰਾਈਵਰ ਕੌਣ ਸੀ, ਕਾਰ ਕਿੱਥੇ ਸੀ, ਜਾਂ ਉਹ ਕਦੋਂ ਪਹੁੰਚੀ ਜਾਂ ਗਈ।',
  },
  'share.remove': {
    en: 'Remove',
    'zh-CN': '移除',
    vi: 'Xoá',
    id: 'Hapus',
    ko: '삭제',
    it: 'Rimuovi',
    el: 'Αφαίρεση',
    hi: 'हटाएँ',
    pa: 'ਹਟਾਓ',
  },
  'share.removeConfirm': {
    en: 'Remove this shared record from this phone? You can open the link again to get it back.',
    'zh-CN': '要从这部手机上移除这条分享的记录吗？再次打开链接即可找回。',
    vi: 'Xoá bản ghi được chia sẻ này khỏi điện thoại? Bạn có thể mở lại liên kết để lấy lại.',
    id: 'Hapus catatan yang dibagikan ini dari ponsel ini? Kamu bisa membuka tautannya lagi untuk mendapatkannya kembali.',
    ko: '공유받은 이 기록을 이 휴대폰에서 삭제할까요? 링크를 다시 열면 되돌릴 수 있습니다.',
    it: 'Rimuovere questo record condiviso da questo telefono? Puoi riaprire il link per recuperarlo.',
    el: 'Να αφαιρεθεί αυτή η κοινοποιημένη εγγραφή από αυτό το τηλέφωνο; Μπορείς να ανοίξεις ξανά τον σύνδεσμο για να την ανακτήσεις.',
    hi: 'इस साझा रिकॉर्ड को इस फ़ोन से हटाएँ? इसे वापस पाने के लिए आप लिंक दोबारा खोल सकते हैं।',
    pa: 'ਕੀ ਇਸ ਸਾਂਝੇ ਰਿਕਾਰਡ ਨੂੰ ਇਸ ਫ਼ੋਨ ਤੋਂ ਹਟਾਉਣਾ ਹੈ? ਇਸ ਨੂੰ ਵਾਪਸ ਲੈਣ ਲਈ ਤੁਸੀਂ ਲਿੰਕ ਦੁਬਾਰਾ ਖੋਲ੍ਹ ਸਕਦੇ ਹੋ।',
  },

  // ── Item 4: the PDF line for a shared copy (sessionRows). PDF-safe text. ──
  'pdf.shared.field': {
    en: 'Shared with you',
    'zh-CN': '他人分享',
    vi: 'Được chia sẻ với bạn',
    id: 'Dibagikan kepadamu',
    ko: '공유받은 기록',
    it: 'Condiviso con te',
    el: 'Κοινοποιήθηκε σε σένα',
    hi: 'आपके साथ साझा',
    pa: 'ਤੁਹਾਡੇ ਨਾਲ ਸਾਂਝਾ',
  },
  'pdf.shared.madeElsewhere': {
    en: "This record was made on someone else's phone.",
    'zh-CN': '这条记录是在他人的手机上创建的。',
    vi: 'Bản ghi này được tạo trên điện thoại của người khác.',
    id: 'Catatan ini dibuat di ponsel orang lain.',
    ko: '이 기록은 다른 사람의 휴대폰에서 만들어졌습니다.',
    it: "Questo record è stato creato sul telefono di un'altra persona.",
    el: 'Αυτή η εγγραφή δημιουργήθηκε στο τηλέφωνο άλλου ατόμου.',
    hi: 'यह रिकॉर्ड किसी और के फ़ोन पर बनाया गया था।',
    pa: "ਇਹ ਰਿਕਾਰਡ ਕਿਸੇ ਹੋਰ ਦੇ ਫ਼ੋਨ 'ਤੇ ਬਣਾਇਆ ਗਿਆ ਸੀ।",
  },

  // ── Item 5: "Hand the car over" (record screen of an active record) ──
  'handover.action': {
    en: 'Hand the car over',
    'zh-CN': '交接车辆',
    vi: 'Giao xe cho người khác',
    id: 'Serahkan mobil',
    ko: '차량 인계하기',
    it: "Consegna l'auto",
    el: 'Παράδωσε το αυτοκίνητο',
    hi: 'कार सौंपें',
    pa: 'ਕਾਰ ਸੌਂਪੋ',
  },
  // The driver's own statement, signed but not checked; the record stays active.
  'handover.intro': {
    en: "Enter who's taking the car next. ParkProof signs it with this record, as your own statement. ParkProof doesn't check it, and the signature doesn't show who was driving. The record stays active.",
    'zh-CN': '填写接下来开车的人。ParkProof 会把它作为你本人的陈述,随这条记录一起签名。ParkProof 不会核实,签名也不能说明是谁在开车。这条记录仍在进行中。',
    vi: 'Nhập người sẽ lái xe tiếp theo. ParkProof ký thông tin này cùng bản ghi, như lời khai của chính bạn. ParkProof không kiểm tra, và chữ ký không cho thấy ai đã lái xe. Bản ghi vẫn đang hoạt động.',
    id: 'Masukkan siapa yang akan mengemudikan mobil berikutnya. ParkProof menandatanganinya bersama catatan ini, sebagai pernyataanmu sendiri. ParkProof tidak memeriksanya, dan tanda tangan tidak menunjukkan siapa yang mengemudi. Catatan ini tetap aktif.',
    ko: '다음에 차를 운전할 사람을 입력하세요. ParkProof는 이를 본인의 진술로서 이 기록과 함께 서명합니다. ParkProof는 이를 확인하지 않으며, 서명은 누가 운전했는지 보여 주지 않습니다. 기록은 계속 활성 상태로 유지됩니다.',
    it: "Inserisci chi prenderà l'auto dopo. ParkProof lo firma con questo record, come tua dichiarazione. ParkProof non lo verifica, e la firma non mostra chi era alla guida. Il record resta attivo.",
    el: 'Γράψε ποιος θα πάρει το αυτοκίνητο μετά. Το ParkProof το υπογράφει μαζί με αυτή την εγγραφή, ως δική σου δήλωση. Το ParkProof δεν το ελέγχει, και η υπογραφή δεν δείχνει ποιος οδηγούσε. Η εγγραφή παραμένει ενεργή.',
    hi: 'अगले चालक का नाम दर्ज करें। ParkProof इसे आपके अपने कथन के रूप में इस रिकॉर्ड के साथ हस्ताक्षरित करता है। ParkProof इसकी जाँच नहीं करता, और हस्ताक्षर से यह पता नहीं चलता कि चालक कौन था। रिकॉर्ड सक्रिय रहता है।',
    pa: 'ਅਗਲੇ ਡਰਾਈਵਰ ਦਾ ਨਾਂ ਦਰਜ ਕਰੋ। ParkProof ਇਸ ਨੂੰ ਤੁਹਾਡੇ ਆਪਣੇ ਬਿਆਨ ਵਜੋਂ ਇਸ ਰਿਕਾਰਡ ਨਾਲ ਹਸਤਾਖਰਿਤ ਕਰਦਾ ਹੈ। ParkProof ਇਸ ਦੀ ਜਾਂਚ ਨਹੀਂ ਕਰਦਾ, ਅਤੇ ਹਸਤਾਖਰ ਇਹ ਨਹੀਂ ਦਿਖਾਉਂਦੇ ਕਿ ਡਰਾਈਵਰ ਕੌਣ ਸੀ। ਰਿਕਾਰਡ ਸਰਗਰਮ ਰਹਿੰਦਾ ਹੈ।',
  },
  'handover.nameLabel': {
    en: "Next driver's name",
    'zh-CN': '下一位驾驶员的姓名',
    vi: 'Tên người lái tiếp theo',
    id: 'Nama pengemudi berikutnya',
    ko: '다음 운전자 이름',
    it: 'Nome del prossimo conducente',
    el: 'Όνομα επόμενου οδηγού',
    hi: 'अगले चालक का नाम',
    pa: 'ਅਗਲੇ ਡਰਾਈਵਰ ਦਾ ਨਾਂ',
  },
  'handover.nameRequired': {
    en: "Enter the next driver's name.",
    'zh-CN': '请填写下一位驾驶员的姓名。',
    vi: 'Hãy nhập tên người lái tiếp theo.',
    id: 'Masukkan nama pengemudi berikutnya.',
    ko: '다음 운전자 이름을 입력하세요.',
    it: 'Inserisci il nome del prossimo conducente.',
    el: 'Γράψε το όνομα του επόμενου οδηγού.',
    hi: 'अगले चालक का नाम दर्ज करें।',
    pa: 'ਅਗਲੇ ਡਰਾਈਵਰ ਦਾ ਨਾਂ ਦਰਜ ਕਰੋ।',
  },
  'handover.submit': {
    en: 'Record the handover',
    'zh-CN': '记录交接',
    vi: 'Ghi lại việc giao xe',
    id: 'Catat serah terima',
    ko: '인계 기록하기',
    it: 'Registra la consegna',
    el: 'Καταγραφή παράδοσης',
    hi: 'कार सौंपना दर्ज करें',
    pa: 'ਕਾਰ ਸੌਂਪਣਾ ਦਰਜ ਕਰੋ',
  },
  'handover.failed': {
    en: "The handover couldn't be added to this record.",
    'zh-CN': '无法把这次交接添加到这条记录。',
    vi: 'Không thể thêm việc giao xe vào bản ghi này.',
    id: 'Serah terima tidak bisa ditambahkan ke catatan ini.',
    ko: '이 기록에 인계를 추가하지 못했습니다.',
    it: 'Non è stato possibile aggiungere la consegna a questo record.',
    el: 'Δεν ήταν δυνατό να προστεθεί η παράδοση σε αυτή την εγγραφή.',
    hi: 'कार सौंपने की जानकारी इस रिकॉर्ड में नहीं जोड़ी जा सकी।',
    pa: 'ਕਾਰ ਸੌਂਪਣ ਦੀ ਜਾਣਕਾਰੀ ਇਸ ਰਿਕਾਰਡ ਵਿੱਚ ਨਹੀਂ ਜੋੜੀ ਜਾ ਸਕੀ।',
  },
  // The outcome: what the record now says, never that anything was confirmed.
  'handover.done': {
    en: 'Your record now says the car was handed to {{to_driver}}. ParkProof signs it when your phone is online. The record stays active.',
    'zh-CN': '你的记录现在写的是,车辆已交给 {{to_driver}}。手机联网时,ParkProof 会为它签名。这条记录仍在进行中。',
    vi: 'Bản ghi của bạn giờ ghi rằng xe đã được giao cho {{to_driver}}. ParkProof sẽ ký khi điện thoại của bạn có mạng. Bản ghi vẫn đang hoạt động.',
    id: 'Catatanmu sekarang menyebut mobil diserahkan kepada {{to_driver}}. ParkProof menandatanganinya saat ponselmu online. Catatan ini tetap aktif.',
    ko: '이제 기록에는 차가 {{to_driver}}에게 인계되었다고 되어 있습니다. 휴대폰이 온라인일 때 ParkProof가 서명합니다. 기록은 계속 활성 상태로 유지됩니다.',
    it: "Il tuo record ora dice che l'auto è stata consegnata a {{to_driver}}. ParkProof lo firma quando il telefono è online. Il record resta attivo.",
    el: 'Η εγγραφή σου λέει τώρα ότι το αυτοκίνητο παραδόθηκε στο άτομο με όνομα {{to_driver}}. Το ParkProof την υπογράφει όταν το κινητό σου είναι συνδεδεμένο. Η εγγραφή παραμένει ενεργή.',
    hi: 'आपके रिकॉर्ड में अब लिखा है कि कार {{to_driver}} को सौंपी गई। फ़ोन ऑनलाइन होने पर ParkProof इस पर हस्ताक्षर करता है। रिकॉर्ड सक्रिय रहता है।',
    pa: "ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਵਿੱਚ ਹੁਣ ਲਿਖਿਆ ਹੈ ਕਿ ਕਾਰ {{to_driver}} ਨੂੰ ਸੌਂਪੀ ਗਈ। ਫ਼ੋਨ ਆਨਲਾਈਨ ਹੋਣ 'ਤੇ ParkProof ਇਸ 'ਤੇ ਹਸਤਾਖਰ ਕਰਦਾ ਹੈ। ਰਿਕਾਰਡ ਸਰਗਰਮ ਰਹਿੰਦਾ ਹੈ।",
  },
  // The outcome when the record names who handed the car over.
  'handover.doneFromTo': {
    en: 'Your record now says {{from_driver}} handed the car to {{to_driver}}. ParkProof signs it when your phone is online. The record stays active.',
    'zh-CN': '你的记录现在写的是,{{from_driver}} 把车交给了 {{to_driver}}。手机联网时,ParkProof 会为它签名。这条记录仍在进行中。',
    vi: 'Bản ghi của bạn giờ ghi rằng {{from_driver}} đã giao xe cho {{to_driver}}. ParkProof sẽ ký khi điện thoại của bạn có mạng. Bản ghi vẫn đang hoạt động.',
    id: 'Catatanmu sekarang menyebut {{from_driver}} menyerahkan mobil kepada {{to_driver}}. ParkProof menandatanganinya saat ponselmu online. Catatan ini tetap aktif.',
    ko: '이제 기록에는 {{from_driver}} 님이 차를 {{to_driver}} 님에게 인계했다고 되어 있습니다. 휴대폰이 온라인일 때 ParkProof가 서명합니다. 기록은 계속 활성 상태로 유지됩니다.',
    it: "Il tuo record ora dice che {{from_driver}} ha consegnato l'auto a {{to_driver}}. ParkProof lo firma quando il telefono è online. Il record resta attivo.",
    el: 'Η εγγραφή σου λέει τώρα: παράδοση από {{from_driver}} σε {{to_driver}}. Το ParkProof την υπογράφει όταν το κινητό σου είναι συνδεδεμένο. Η εγγραφή παραμένει ενεργή.',
    hi: 'आपके रिकॉर्ड में अब लिखा है कि {{from_driver}} ने कार {{to_driver}} को सौंपी। फ़ोन ऑनलाइन होने पर ParkProof इस पर हस्ताक्षर करता है। रिकॉर्ड सक्रिय रहता है।',
    pa: "ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਵਿੱਚ ਹੁਣ ਲਿਖਿਆ ਹੈ ਕਿ {{from_driver}} ਨੇ ਕਾਰ {{to_driver}} ਨੂੰ ਸੌਂਪੀ। ਫ਼ੋਨ ਆਨਲਾਈਨ ਹੋਣ 'ਤੇ ParkProof ਇਸ 'ਤੇ ਹਸਤਾਖਰ ਕਰਦਾ ਹੈ। ਰਿਕਾਰਡ ਸਰਗਰਮ ਰਹਿੰਦਾ ਹੈ।",
  },
  // On the sheet before the tap: who the signed handover will say handed the
  // car over (the record's current driver), so the driver sees it first.
  'handover.fromDriver': {
    en: 'Handed over by {{from_driver}}, the driver this record names now.',
    'zh-CN': '交出车辆的人:{{from_driver}},即这条记录目前写明的驾驶员。',
    vi: 'Người giao xe: {{from_driver}}, người lái mà bản ghi này hiện đang ghi.',
    id: 'Diserahkan oleh {{from_driver}}, pengemudi yang sekarang tercatat di catatan ini.',
    ko: '인계하는 사람: {{from_driver}} (현재 이 기록에 적힌 운전자).',
    it: 'Consegnata da: {{from_driver}}, il conducente indicato ora in questo record.',
    el: 'Παράδοση από: {{from_driver}}. Αυτό είναι το όνομα οδηγού που αναφέρει τώρα αυτή η εγγραφή.',
    hi: 'सौंपने वाले: {{from_driver}}, जिन्हें यह रिकॉर्ड अभी चालक बताता है।',
    pa: 'ਸੌਂਪਣ ਵਾਲੇ: {{from_driver}}, ਜਿਨ੍ਹਾਂ ਨੂੰ ਇਹ ਰਿਕਾਰਡ ਹੁਣ ਡਰਾਈਵਰ ਦੱਸਦਾ ਹੈ।',
  },
  'handover.offerShare': {
    en: 'You can send them a link to where the car is.',
    'zh-CN': '你可以把车辆位置的链接发给对方。',
    vi: 'Bạn có thể gửi cho người đó một liên kết đến vị trí xe.',
    id: 'Kamu bisa mengirim tautan lokasi mobil kepada orang itu.',
    ko: '상대에게 차 위치 링크를 보낼 수 있습니다.',
    it: "Puoi inviare a questa persona un link a dove si trova l'auto.",
    el: 'Μπορείς να στείλεις σε αυτό το άτομο έναν σύνδεσμο για το πού είναι το αυτοκίνητο.',
    hi: 'आप उन्हें कार की जगह का लिंक भेज सकते हैं।',
    pa: 'ਤੁਸੀਂ ਉਹਨਾਂ ਨੂੰ ਕਾਰ ਦੀ ਥਾਂ ਦਾ ਲਿੰਕ ਭੇਜ ਸਕਦੇ ਹੋ।',
  },
  // A handover on the record screen: the phone's time, labelled as such.
  'handover.line': {
    en: 'Your record says the car was handed to {{to_driver}} at {{time}} (phone clock).',
    'zh-CN': '你的记录写的是,车辆在 {{time}} 交给了 {{to_driver}}(手机时钟)。',
    vi: 'Bản ghi của bạn nói xe đã được giao cho {{to_driver}} lúc {{time}} (đồng hồ điện thoại).',
    id: 'Catatanmu menyebut mobil diserahkan kepada {{to_driver}} pada {{time}} (jam ponsel).',
    ko: '기록에는 {{time}}에 차가 {{to_driver}}에게 인계되었다고 되어 있습니다 (휴대폰 시계).',
    it: "Il tuo record dice che l'auto è stata consegnata a {{to_driver}}: {{time}} (orologio del telefono).",
    el: 'Σύμφωνα με την εγγραφή σου, το αυτοκίνητο παραδόθηκε στις {{time}} στο άτομο με όνομα {{to_driver}} (ρολόι κινητού).',
    hi: 'आपके रिकॉर्ड के अनुसार कार {{time}} पर {{to_driver}} को सौंपी गई (फ़ोन की घड़ी)।',
    pa: "ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਮੁਤਾਬਕ ਕਾਰ {{time}} 'ਤੇ {{to_driver}} ਨੂੰ ਸੌਂਪੀ ਗਈ (ਫ਼ੋਨ ਦੀ ਘੜੀ)।",
  },
  // The same, when the record names who handed the car over.
  'handover.lineFromTo': {
    en: 'Your record says {{from_driver}} handed the car to {{to_driver}} at {{time}} (phone clock).',
    'zh-CN': '你的记录写的是,{{from_driver}} 在 {{time}} 把车交给了 {{to_driver}}(手机时钟)。',
    vi: 'Bản ghi của bạn nói {{from_driver}} đã giao xe cho {{to_driver}} lúc {{time}} (đồng hồ điện thoại).',
    id: 'Catatanmu menyebut {{from_driver}} menyerahkan mobil kepada {{to_driver}} pada {{time}} (jam ponsel).',
    ko: '기록에는 {{time}}에 {{from_driver}} 님이 차를 {{to_driver}} 님에게 인계했다고 되어 있습니다 (휴대폰 시계).',
    it: "Il tuo record dice che {{from_driver}} ha consegnato l'auto a {{to_driver}}: {{time}} (orologio del telefono).",
    el: 'Σύμφωνα με την εγγραφή σου: παράδοση από {{from_driver}} σε {{to_driver}}. Ώρα: {{time}} (ρολόι κινητού).',
    hi: 'आपके रिकॉर्ड के अनुसार {{from_driver}} ने {{time}} पर कार {{to_driver}} को सौंपी (फ़ोन की घड़ी)।',
    pa: "ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਮੁਤਾਬਕ {{from_driver}} ਨੇ {{time}} 'ਤੇ ਕਾਰ {{to_driver}} ਨੂੰ ਸੌਂਪੀ (ਫ਼ੋਨ ਦੀ ਘੜੀ)।",
  },

  // ── Item 7: the PDF's driver row and handover section (sessionRows). PDF-safe text. ──
  // The spec's label.
  'pdf.evidence.field.driver': {
    en: 'Driver (entered on the phone, not checked)',
    'zh-CN': '驾驶员(在手机上填写,未经核实)',
    vi: 'Tài xế (nhập trên điện thoại, không được kiểm tra)',
    id: 'Pengemudi (dimasukkan di ponsel, tidak diperiksa)',
    ko: '운전자 (휴대폰에 입력, 확인되지 않음)',
    it: 'Conducente (inserito sul telefono, non verificato)',
    el: 'Οδηγός (καταχωρίστηκε στο κινητό, δεν ελέγχθηκε)',
    hi: 'चालक (फ़ोन पर दर्ज किया गया, जाँचा नहीं गया)',
    pa: "ਡਰਾਈਵਰ (ਫ਼ੋਨ 'ਤੇ ਦਰਜ ਕੀਤਾ, ਜਾਂਚਿਆ ਨਹੀਂ ਗਿਆ)",
  },
  'pdf.evidence.field.handover': {
    en: 'Handover (entered on the phone, not checked)',
    'zh-CN': '车辆交接(在手机上填写,未经核实)',
    vi: 'Giao xe (nhập trên điện thoại, không được kiểm tra)',
    id: 'Serah terima mobil (dimasukkan di ponsel, tidak diperiksa)',
    ko: '차량 인계 (휴대폰에 입력, 확인되지 않음)',
    it: "Consegna dell'auto (inserita sul telefono, non verificata)",
    el: 'Παράδοση αυτοκινήτου (καταχωρίστηκε στο κινητό, δεν ελέγχθηκε)',
    hi: 'कार सौंपना (फ़ोन पर दर्ज किया गया, जाँचा नहीं गया)',
    pa: "ਕਾਰ ਸੌਂਪਣਾ (ਫ਼ੋਨ 'ਤੇ ਦਰਜ ਕੀਤਾ, ਜਾਂਚਿਆ ਨਹੀਂ ਗਿਆ)",
  },
  'pdf.evidence.field.handoverSigned': {
    en: 'Handover signed by ParkProof (server clock)',
    'zh-CN': '交接部分由 ParkProof 签名的时间(服务器时钟)',
    vi: 'Thời điểm ParkProof ký phần giao xe (đồng hồ máy chủ)',
    id: 'Serah terima ditandatangani ParkProof (jam server)',
    ko: 'ParkProof가 인계 부분에 서명한 시각 (서버 시계)',
    it: 'Parte di consegna firmata da ParkProof (orologio del server)',
    el: 'Υπογραφή της παράδοσης από το ParkProof (ρολόι διακομιστή)',
    hi: 'कार सौंपने के विवरण पर ParkProof के हस्ताक्षर (सर्वर की घड़ी)',
    pa: 'ਕਾਰ ਸੌਂਪਣ ਵਾਲਾ ਹਿੱਸਾ ParkProof ਵੱਲੋਂ ਹਸਤਾਖਰਿਤ (ਸਰਵਰ ਦੀ ਘੜੀ)',
  },
  'pdf.evidence.value.handoverTo': {
    en: 'Handed to {{to_driver}} at {{time}} (phone clock).',
    'zh-CN': '于 {{time}} 交给 {{to_driver}}(手机时钟)。',
    vi: 'Giao cho {{to_driver}} lúc {{time}} (đồng hồ điện thoại).',
    id: 'Diserahkan kepada {{to_driver}} pada {{time}} (jam ponsel).',
    ko: '인계받은 사람: {{to_driver}}. 시각: {{time}} (휴대폰 시계).',
    it: 'Consegnata a {{to_driver}}: {{time}} (orologio del telefono).',
    el: 'Παραδόθηκε σε: {{to_driver}}. Ώρα: {{time}} (ρολόι κινητού).',
    hi: '{{time}} पर {{to_driver}} को सौंपी गई (फ़ोन की घड़ी)।',
    pa: "{{time}} 'ਤੇ {{to_driver}} ਨੂੰ ਸੌਂਪੀ ਗਈ (ਫ਼ੋਨ ਦੀ ਘੜੀ)।",
  },
  'pdf.evidence.value.handoverFromTo': {
    en: '{{from_driver}} handed the car to {{to_driver}} at {{time}} (phone clock).',
    'zh-CN': '{{from_driver}} 于 {{time}} 把车交给 {{to_driver}}(手机时钟)。',
    vi: '{{from_driver}} giao xe cho {{to_driver}} lúc {{time}} (đồng hồ điện thoại).',
    id: '{{from_driver}} menyerahkan mobil kepada {{to_driver}} pada {{time}} (jam ponsel).',
    ko: '인계한 사람: {{from_driver}}. 인계받은 사람: {{to_driver}}. 시각: {{time}} (휴대폰 시계).',
    it: "{{from_driver}} ha consegnato l'auto a {{to_driver}}: {{time}} (orologio del telefono).",
    el: 'Παράδοση από: {{from_driver}}. Σε: {{to_driver}}. Ώρα: {{time}} (ρολόι κινητού).',
    hi: '{{from_driver}} ने {{time}} पर कार {{to_driver}} को सौंपी (फ़ोन की घड़ी)।',
    pa: "{{from_driver}} ਨੇ {{time}} 'ਤੇ ਕਾਰ {{to_driver}} ਨੂੰ ਸੌਂਪੀ (ਫ਼ੋਨ ਦੀ ਘੜੀ)।",
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

/**
 * Set a key this script owns: appended when new. When present with other
 * text it is rewritten in place only if it is in REVISED (this script's own
 * earlier wording); otherwise it may be another task's key, so the run
 * aborts before writing anything.
 */
function setOwned(root, path, value, locale) {
  const { node, leaf } = parentOf(root, path, locale)
  const current = node[leaf]
  if (current !== undefined && typeof current !== 'string') fail(`${locale}: ${path} is not a string`)
  if (typeof current === 'string' && current !== value && !REVISED.has(path)) {
    fail(
      `${locale}: ${path} already holds other text. If another task added it, rewrite it through OVERWRITES; ` +
        "if it is this script's own earlier wording, list it in REVISED.",
    )
  }
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
    // Every locale has text, and no locale has a key the others lack.
    const have = Object.keys(byLocale).sort().join(',')
    if (have !== [...LOCALES].sort().join(',')) problems.push(`locales at ${path}: ${have}`)
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

for (const path of REVISED) {
  if (!(path in ADDITIONS)) fail(`REVISED lists ${path}, which isn't one of this script's ADDITIONS`)
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
