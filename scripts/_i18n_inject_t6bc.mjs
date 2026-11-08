/**
 * T6b and T6c i18n (roadmap build spec, tasks T6b "Workday mode: screens
 * and flow" and T6c "Workday record PDF"). ONE script for both tasks: each
 * unit of T6b or T6c extends ADDITIONS (and LEGAL, EXACT) here rather than
 * adding a script. Idempotent: running it twice leaves the files
 * byte-identical after the first run.
 *
 * Run order: after every other task's inject script and BEFORE
 * scripts/_i18n_inject_copy_pass.mjs, which runs last. None of the keys
 * here may appear in scripts/copy-pass/*.json (checked below), so the copy
 * pass never rewrites workday copy. Never re-run the T0a to T1b scripts.
 *
 * Unit t6b-flow (items 1 to 7 and 10) adds, under the `workday` object T6a
 * created:
 *   - workday.start.*      the start screen: the location gate, the first
 *                          stop offer ("Use the car's current park as the
 *                          first stop") and why a park can't be one
 *   - workday.ready.*      readiness: can reminders reach the driver
 *   - workday.ics.*        the calendar file with the same alarms
 *   - workday.explainer.*  the explainer, in full and in one line
 *   - workday.card.*       the home card: moving, scanning, ending
 *   - workday.end.*        "End this workday?" between moves
 *   - workday.history.*    History's one row per workday (plural)
 *   - workday.status.*     in progress or ended
 *   - workday.view.*       the workday view: its stops
 *   - workday.noSign.*     a stop's photo had no readable sign
 *   - workday.stopped.*    a stop outside Victoria and Queensland, or
 *                          whose state couldn't be told
 *   - workday.scan.*       the scanner's fresh-photo lines
 *
 * Unit t6b-boundary-reminders (items 8, 9 and 11) adds:
 *   - workday.boundary.*   the boundary question in the logger: title,
 *                          body, the area text, the options, footer, the
 *                          lines after an answer, the deadline-passed
 *                          choice ("Save anyway", "Don't save this stop")
 *   - workday.reminders.*  the home card, when a stop's reminders couldn't
 *                          be set
 *
 * Unit t6c-pdf (T6c, the workday record PDF) adds:
 *   - workday.pdf.*        the workday view's export button and the leg
 *                          picker, with the spec's warning before export
 *   - pdf.workday.*        everything the workday PDF prints: the header,
 *                          the footer on every page, the cover table, the
 *                          driver's statement per answer, the council line
 *                          on every rule sheet, and the chain between legs.
 *                          These are pdf.* keys, so pdf-font-coverage.test.ts
 *                          checks every character against the locale's PDF
 *                          font subset (re-cut with scripts/_subset_pdf_fonts.py
 *                          after this script, from full sources in fonts-src/).
 *
 * Workday mode is behind VITE_FEATURE_WORKDAY (off in production builds)
 * until a lawyer has read every key LEGAL lists; docs/legal-review-queue.md
 * lists them. The en text of every key in EXACT is the spec's own wording
 * and the script refuses to write if it drifts.
 *
 * Changes no existing string (OVERWRITES is empty).
 *
 * Writes nothing unless every locale passes the parity checks below (the
 * same rules src/lib/locales.test.ts enforces, plus the copy rules for the
 * en text of every key this script owns).
 *
 * Run:   node scripts/_i18n_inject_t6bc.mjs
 * List:  node scripts/_i18n_inject_t6bc.mjs --list
 *        prints every key this script adds, for the T10 translation review
 *        ('legal' marks the keys a lawyer must read before the flag is
 *        turned on in production, 'exact' the spec's own wording).
 * Other: node scripts/_i18n_inject_t6bc.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const dirArg = process.argv.indexOf('--dir')
const LOC = dirArg > -1 ? resolve(process.argv[dirArg + 1]) : join(ROOT, 'src', 'locales')
const COPY_PASS = join(ROOT, 'scripts', 'copy-pass')
/** U+2014, written as an escape so this file carries none. */
const EM_DASH = String.fromCharCode(0x2014)
const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

/** Keys a lawyer must read before VITE_FEATURE_WORKDAY is on in production (docs/legal-review-queue.md). */
const LEGAL = new Set([
  'workday.start.intro',
  'workday.start.unavailable',
  'workday.start.unknown',
  'workday.start.useCurrent',
  'workday.start.useCurrentHelp',
  'workday.start.currentIneligible',
  'workday.explainer.full',
  'workday.explainer.short',
  'workday.ready.on',
  'workday.ready.ask',
  'workday.ready.cantDeliver',
  'workday.ics.title',
  'workday.ics.titleArea',
  'workday.card.noStops',
  'workday.card.moved',
  'workday.card.expiredHint',
  'workday.card.move',
  'workday.card.moveHint',
  'workday.card.scanFirst',
  'workday.card.scanNext',
  'workday.end.body',
  'workday.view.started',
  'workday.view.ended',
  'workday.view.tagged',
  'workday.noSign.body',
  'workday.stopped.notAvailable',
  'workday.stopped.unknownState',
  'workday.scan.fresh',
  'workday.scan.cameraDenied',
  'workday.scan.notFresh',
  // Unit t6b-boundary-reminders (items 8, 9 and 11).
  'workday.boundary.title',
  'workday.boundary.body',
  'workday.boundary.area',
  'workday.boundary.option.oppositeDirectionSign',
  'workday.boundary.option.yellowEdgeLine',
  'workday.boundary.option.tIntersectionOrDeadEnd',
  'workday.boundary.option.leftParkingArea',
  'workday.boundary.option.notSure',
  'workday.boundary.footer',
  'workday.boundary.required',
  'workday.boundary.newLimit',
  'workday.boundary.passed.oppositeDirectionSign',
  'workday.boundary.passed.yellowEdgeLine',
  'workday.boundary.passed.tIntersectionOrDeadEnd',
  'workday.boundary.passed.leftParkingArea',
  'workday.boundary.notSure',
  'workday.boundary.notSureArea',
  'workday.boundary.notSureNoDeadline',
  'workday.boundary.notSureNoDeadlineArea',
  'workday.boundary.passedDeadline',
  'workday.boundary.passedDeadlineArea',
  'workday.boundary.saveAnyway',
  'workday.boundary.dontSave',
  'workday.reminders.notSet',
  // Unit t6c-pdf (T6c): the warning before export and every string the
  // workday PDF prints, because councils read it.
  'workday.pdf.warning',
  'pdf.workday.title',
  'pdf.workday.footer',
  'pdf.workday.councilLine',
  'pdf.workday.started',
  'pdf.workday.ended',
  'pdf.workday.legCount',
  'pdf.workday.partial',
  'pdf.workday.intro',
  'pdf.workday.col.leg',
  'pdf.workday.col.arrived',
  'pdf.workday.col.left',
  'pdf.workday.col.distance',
  'pdf.workday.col.statement',
  'pdf.workday.cell.notLeft',
  'pdf.workday.cell.signedArrival',
  'pdf.workday.cell.signedDeparture',
  'pdf.workday.cell.noDistance',
  'pdf.workday.statement.firstLeg',
  'pdf.workday.statement.notAsked',
  'pdf.workday.statement.oppositeDirectionSign',
  'pdf.workday.statement.yellowEdgeLine',
  'pdf.workday.statement.tIntersectionOrDeadEnd',
  'pdf.workday.statement.leftParkingArea',
  'pdf.workday.statement.notSure',
  'pdf.workday.statement.notSureArea',
  'pdf.workday.legHeading',
  'pdf.workday.tagged',
  'pdf.workday.chain.heading',
  'pdf.workday.chain.intro',
  'pdf.workday.chain.equals',
  'pdf.workday.chain.equalsOneOf',
  'pdf.workday.chain.notLinked',
  'pdf.workday.chain.notInPdf',
])

/** The spec's own wording (build spec T6b): the en text must stay exactly this. */
const EXACT = {
  'workday.start.unavailable': "Workday mode is available in Victoria and Queensland while we check other states' rules.",
  'workday.start.useCurrent': "Use the car's current park as the first stop",
  'workday.ready.cantDeliver': "Workday reminders need notifications. Without them you'll need to watch the time yourself.",
  'workday.explainer.full':
    "Moving a few bays doesn't restart the time limit. You need to leave the signed length of road, or the whole area under an area sign. Paying again or topping up doesn't restart the limit either. Each move needs a fresh photo of the new sign.",
  'workday.card.move': "I'm moving the car now",
  'workday.card.moveHint': 'Tap before you drive off',
  'workday.card.scanNext': 'Parked again? Scan the new sign',
  'workday.history.row_other': 'Workday, {{count}} stops',
  'workday.noSign.body':
    'Workday mode needs a readable sign at each spot. Some areas, like central Brisbane, have time limits even where a street has no sign.',
  'workday.stopped.notAvailable':
    "Workday mode isn't available here yet. This park is saved as a normal record with its own sign reading.",
  // Item 8, the boundary question.
  'workday.boundary.title': 'This may be the same signed stretch.',
  'workday.boundary.body': "Moving bays doesn't restart the time limit. Did you pass one of these on the way here?",
  'workday.boundary.area':
    "This is a parking area. Moving to another street inside it doesn't count. You need to leave the whole area.",
  'workday.boundary.option.oppositeDirectionSign':
    "A sign showing this zone had ended (a two-way arrow sign in the middle of the block doesn't count)",
  'workday.boundary.option.yellowEdgeLine': 'A yellow edge line',
  'workday.boundary.option.tIntersectionOrDeadEnd': 'The end of the road at a T-intersection or dead end',
  'workday.boundary.option.leftParkingArea': 'I drove out of the parking area, past a sign saying it ends',
  'workday.boundary.option.notSure': "I'm not sure",
  'workday.boundary.footer': "If you're not sure, your original time limit is still running.",
  'workday.boundary.newLimit': 'New limit based on what you told us: you passed {{boundary}}.',
  'workday.boundary.notSure':
    'Your limit on this stretch still runs from {{start}}. Move the car off this stretch by {{deadline}}.',
  'workday.boundary.passedDeadline': 'Your time on this stretch ended at {{time}}. Move the car off this stretch now.',
  'workday.boundary.saveAnyway': 'Save anyway',
  'workday.boundary.dontSave': "Don't save this stop",
  // T6c, the workday record PDF.
  'workday.pdf.warning':
    'This PDF includes every leg you choose, with distances between them and what you told us at each move. Councils can read it.',
  'pdf.workday.title': 'Record of parking events.',
  'pdf.workday.footer':
    'This records what you did and what you told us. It is not a legal finding that you complied. Your council decides that.',
  'pdf.workday.councilLine': "Councils may interpret this rule more strictly. Check your council's parking page.",
  'pdf.workday.col.distance': 'Approx. distance from previous leg (phone GPS)',
  'pdf.workday.col.statement': "Driver's statement",
}

// ── New keys, appended inside their parent object ────────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position). Missing parent objects are created,
// appended at the end of their own parent.
const ADDITIONS = {
  // ── Start screen (T6b items 1 and 4) ──────────────────────────────────
  'workday.start.title': {
    en: 'Start a workday',
    'zh-CN': '开始工作日',
    vi: 'Bắt đầu một ngày làm việc',
    id: 'Mulai hari kerja',
    ko: '근무일 시작하기',
    it: 'Inizia una giornata di lavoro',
    el: 'Ξεκίνα μια εργάσιμη μέρα',
    hi: 'वर्कडे शुरू करें',
    pa: 'ਵਰਕਡੇ ਸ਼ੁਰੂ ਕਰੋ',
  },
  // What the mode is for, in facts: no promise about fines or limits.
  'workday.start.intro': {
    en: 'For a day of moving the car between time-limited spots. Each stop gets its own record, read from a fresh photo of its sign.',
    'zh-CN': '适用于需要在多个限时车位之间挪车的一天。每一站都有自己的记录,依据现场新拍的标志照片读取。',
    vi: 'Dành cho một ngày phải dời xe giữa các chỗ đỗ có giới hạn thời gian. Mỗi điểm dừng có bản ghi riêng, được đọc từ một ảnh mới chụp biển báo ở đó.',
    id: 'Untuk hari ketika kamu memindahkan mobil di antara tempat parkir berbatas waktu. Setiap perhentian punya catatannya sendiri, dibaca dari foto rambu yang baru diambil.',
    ko: '시간 제한이 있는 주차 자리 사이로 차를 옮기며 보내는 날을 위한 기능입니다. 각 정차 지점마다 별도의 기록이 생기며, 그 자리에서 새로 찍은 표지판 사진으로 읽습니다.',
    it: "Per una giornata in cui sposti l'auto tra posti con limite di tempo. Ogni sosta ha il suo record, letto da una foto nuova del suo cartello.",
    el: 'Για μια μέρα που μετακινείς το αυτοκίνητο ανάμεσα σε θέσεις με χρονικό όριο. Κάθε στάση έχει τη δική της εγγραφή, από νέα φωτογραφία της πινακίδας της.',
    hi: 'ऐसे दिन के लिए जब आप गाड़ी को समय सीमा वाली जगहों के बीच हटाते रहते हैं। हर स्टॉप का अपना रिकॉर्ड बनता है, जो उसके साइन की नई फोटो से पढ़ा जाता है।',
    pa: 'ਉਸ ਦਿਨ ਲਈ ਜਦੋਂ ਤੁਸੀਂ ਕਾਰ ਨੂੰ ਸਮਾਂ ਸੀਮਾ ਵਾਲੀਆਂ ਥਾਵਾਂ ਵਿਚਕਾਰ ਹਟਾਉਂਦੇ ਰਹਿੰਦੇ ਹੋ। ਹਰ ਸਟਾਪ ਦਾ ਆਪਣਾ ਰਿਕਾਰਡ ਬਣਦਾ ਹੈ, ਜੋ ਉਸਦੇ ਚਿੰਨ੍ਹ ਦੀ ਨਵੀਂ ਫੋਟੋ ਤੋਂ ਪੜ੍ਹਿਆ ਜਾਂਦਾ ਹੈ।',
  },
  'workday.start.locating': {
    en: "Checking which state you're in…",
    'zh-CN': '正在确认你所在的州…',
    vi: 'Đang kiểm tra bạn đang ở tiểu bang nào…',
    id: 'Memeriksa kamu berada di negara bagian mana…',
    ko: '현재 어느 주에 있는지 확인하는 중…',
    it: 'Verifica dello stato in cui ti trovi…',
    el: 'Ελέγχουμε σε ποια πολιτεία βρίσκεσαι…',
    hi: 'जाँच की जा रही है कि आप किस राज्य में हैं…',
    pa: 'ਜਾਂਚ ਕੀਤੀ ਜਾ ਰਹੀ ਹੈ ਕਿ ਤੁਸੀਂ ਕਿਸ ਰਾਜ ਵਿੱਚ ਹੋ…',
  },
  // Spec wording (T6b item 1): the gate before the explainer's Start button.
  'workday.start.unavailable': {
    en: "Workday mode is available in Victoria and Queensland while we check other states' rules.",
    'zh-CN': '工作日模式目前仅在维多利亚州和昆士兰州可用,我们正在核实其他州的规定。',
    vi: 'Chế độ ngày làm việc hiện có ở Victoria và Queensland trong khi chúng tôi kiểm tra quy định của các tiểu bang khác.',
    id: 'Mode hari kerja tersedia di Victoria dan Queensland selagi kami memeriksa aturan negara bagian lain.',
    ko: '다른 주의 규칙을 확인하는 동안 근무일 모드는 빅토리아주와 퀸즐랜드주에서만 사용할 수 있습니다.',
    it: 'La modalità giornata di lavoro è disponibile in Victoria e Queensland mentre verifichiamo le regole degli altri stati.',
    el: 'Η λειτουργία εργάσιμης μέρας είναι διαθέσιμη στη Βικτώρια και στο Κουίνσλαντ όσο ελέγχουμε τους κανόνες των άλλων πολιτειών.',
    hi: 'जब तक दूसरे राज्यों के नियमों की जाँच हो रही है, वर्कडे मोड विक्टोरिया और क्वींसलैंड में उपलब्ध है।',
    pa: 'ਜਦੋਂ ਤੱਕ ਹੋਰ ਰਾਜਾਂ ਦੇ ਨਿਯਮਾਂ ਦੀ ਜਾਂਚ ਹੋ ਰਹੀ ਹੈ, ਵਰਕਡੇ ਮੋਡ ਵਿਕਟੋਰੀਆ ਅਤੇ ਕੁਈਨਜ਼ਲੈਂਡ ਵਿੱਚ ਉਪਲਬਧ ਹੈ।',
  },
  // No fix, a failed lookup or no state code: the gate stays shut (no guess).
  'workday.start.unknown': {
    en: "ParkProof couldn't work out which state you're in from your phone's location. Workday mode is only available in Victoria and Queensland, so it needs to check first.",
    'zh-CN': 'ParkProof 无法根据你手机的位置判断你所在的州。工作日模式仅在维多利亚州和昆士兰州可用,所以需要先确认。',
    vi: 'ParkProof không xác định được bạn đang ở tiểu bang nào từ vị trí điện thoại. Chế độ ngày làm việc chỉ có ở Victoria và Queensland, nên cần kiểm tra trước.',
    id: 'ParkProof tidak bisa mengetahui kamu berada di negara bagian mana dari lokasi ponselmu. Mode hari kerja hanya tersedia di Victoria dan Queensland, jadi perlu diperiksa dulu.',
    ko: 'ParkProof가 휴대폰 위치로 현재 어느 주에 있는지 알아내지 못했습니다. 근무일 모드는 빅토리아주와 퀸즐랜드주에서만 사용할 수 있어서 먼저 확인이 필요합니다.',
    it: 'ParkProof non è riuscito a capire in quale stato ti trovi dalla posizione del telefono. La modalità giornata di lavoro è disponibile solo in Victoria e Queensland, quindi deve prima verificarlo.',
    el: 'Το ParkProof δεν μπόρεσε να βρει σε ποια πολιτεία βρίσκεσαι από την τοποθεσία του κινητού σου. Η λειτουργία εργάσιμης μέρας είναι διαθέσιμη μόνο στη Βικτώρια και στο Κουίνσλαντ, γι’ αυτό πρέπει να το ελέγξει πρώτα.',
    hi: 'ParkProof आपके फ़ोन की लोकेशन से यह पता नहीं लगा सका कि आप किस राज्य में हैं। वर्कडे मोड सिर्फ़ विक्टोरिया और क्वींसलैंड में उपलब्ध है, इसलिए पहले इसकी जाँच ज़रूरी है।',
    pa: 'ParkProof ਤੁਹਾਡੇ ਫ਼ੋਨ ਦੀ ਲੋਕੇਸ਼ਨ ਤੋਂ ਇਹ ਪਤਾ ਨਹੀਂ ਲਗਾ ਸਕਿਆ ਕਿ ਤੁਸੀਂ ਕਿਸ ਰਾਜ ਵਿੱਚ ਹੋ। ਵਰਕਡੇ ਮੋਡ ਸਿਰਫ਼ ਵਿਕਟੋਰੀਆ ਅਤੇ ਕੁਈਨਜ਼ਲੈਂਡ ਵਿੱਚ ਉਪਲਬਧ ਹੈ, ਇਸ ਲਈ ਪਹਿਲਾਂ ਇਸਦੀ ਜਾਂਚ ਜ਼ਰੂਰੀ ਹੈ।',
  },
  'workday.start.button': {
    en: 'Start workday',
    'zh-CN': '开始工作日',
    vi: 'Bắt đầu ngày làm việc',
    id: 'Mulai hari kerja',
    ko: '근무일 시작',
    it: 'Inizia la giornata di lavoro',
    el: 'Έναρξη εργάσιμης μέρας',
    hi: 'वर्कडे शुरू करें',
    pa: 'ਵਰਕਡੇ ਸ਼ੁਰੂ ਕਰੋ',
  },
  // Spec wording (T6b item 4).
  'workday.start.useCurrent': {
    en: "Use the car's current park as the first stop",
    'zh-CN': '把车现在的停车位置作为第一站',
    vi: 'Dùng chỗ đỗ hiện tại của xe làm điểm dừng đầu tiên',
    id: 'Gunakan tempat parkir mobil saat ini sebagai perhentian pertama',
    ko: '차의 현재 주차를 첫 번째 정차 지점으로 사용',
    it: "Usa il parcheggio attuale dell'auto come prima sosta",
    el: 'Χρήση της τωρινής στάθμευσης του αυτοκινήτου ως πρώτης στάσης',
    hi: 'गाड़ी की मौजूदा पार्किंग को पहला स्टॉप बनाएं',
    pa: 'ਕਾਰ ਦੀ ਮੌਜੂਦਾ ਪਾਰਕਿੰਗ ਨੂੰ ਪਹਿਲਾ ਸਟਾਪ ਬਣਾਓ',
  },
  // Leg 0 keeps its arrival and limit; a car that has gone needs I've left first.
  'workday.start.useCurrentHelp': {
    en: 'That park keeps the time you logged it and its time limit. Moving a few bays since then doesn\'t restart that limit, so use it anyway. If the car has left the signed stretch, go back and tap I\'ve left on it first.',
    'zh-CN': '这次停车会保留你记录它的时间和它的时限。之后挪了几个车位也不会让这个时限重新计时,所以照样使用它。如果车已经开出该标志适用的路段,请先返回并在该记录上点击"我已离开"。',
    vi: 'Chỗ đỗ đó giữ nguyên thời điểm bạn ghi lại và giới hạn thời gian của nó. Dời xe vài chỗ đỗ sau đó không làm giới hạn đó bắt đầu lại, nên bạn vẫn dùng nó. Nếu xe đã rời khỏi đoạn đường có biển báo, hãy quay lại và nhấn "Tôi đã đi" trên bản ghi đó trước.',
    id: 'Parkir itu tetap memakai waktu saat kamu mencatatnya dan batas waktunya. Pindah beberapa petak parkir sesudahnya tidak membuat batas waktu itu dimulai ulang, jadi tetap pakai parkir itu. Kalau mobil sudah keluar dari ruas jalan yang diatur rambu, kembali dan ketuk "Sudah pergi" pada catatan itu dulu.',
    ko: '그 주차는 기록한 시각과 시간 제한을 그대로 유지합니다. 그 뒤로 몇 칸 옮겼더라도 그 시간 제한은 다시 시작되지 않으니 그대로 사용하세요. 차가 표지판이 적용되는 구간을 벗어났다면 돌아가서 먼저 그 기록에서 "떠났습니다"를 누르세요.',
    it: 'Quel parcheggio mantiene l\'ora in cui l\'hai registrato e il suo limite di tempo. Spostarsi di qualche posto da allora non fa ripartire quel limite, quindi usalo comunque. Se l\'auto ha lasciato il tratto indicato dal cartello, torna indietro e prima tocca "Ho lasciato il posto" su quel record.',
    el: 'Αυτή η στάθμευση κρατά την ώρα που την κατέγραψες και το χρονικό της όριο. Η μετακίνηση λίγες θέσεις πιο κάτω από τότε δεν ξαναρχίζει αυτό το όριο, οπότε χρησιμοποίησέ την κανονικά. Αν το αυτοκίνητο έφυγε από το τμήμα του δρόμου με την πινακίδα, γύρνα πίσω και πάτησε πρώτα «Έφυγα» σε αυτή την εγγραφή.',
    hi: 'उस पार्किंग में वही समय रहेगा जब आपने उसे दर्ज किया था, और उसकी समय सीमा भी वही रहेगी। उसके बाद कुछ पार्किंग जगहें आगे जाने से वह समय सीमा फिर से शुरू नहीं होती, इसलिए इसी का इस्तेमाल करें। अगर गाड़ी साइन वाले सड़क के हिस्से से निकल चुकी है, तो वापस जाएं और पहले उस रिकॉर्ड पर "मैंने जगह खाली कर दी" पर टैप करें।',
    pa: 'ਉਸ ਪਾਰਕਿੰਗ ਵਿੱਚ ਉਹੀ ਸਮਾਂ ਰਹੇਗਾ ਜਦੋਂ ਤੁਸੀਂ ਉਸਨੂੰ ਦਰਜ ਕੀਤਾ ਸੀ, ਅਤੇ ਉਸਦੀ ਸਮਾਂ ਸੀਮਾ ਵੀ ਉਹੀ ਰਹੇਗੀ। ਉਸ ਤੋਂ ਬਾਅਦ ਕੁਝ ਪਾਰਕਿੰਗ ਥਾਵਾਂ ਅੱਗੇ ਜਾਣ ਨਾਲ ਉਹ ਸਮਾਂ ਸੀਮਾ ਮੁੜ ਸ਼ੁਰੂ ਨਹੀਂ ਹੁੰਦੀ, ਇਸ ਲਈ ਇਸੇ ਦੀ ਵਰਤੋਂ ਕਰੋ। ਜੇ ਕਾਰ ਚਿੰਨ੍ਹ ਵਾਲੇ ਸੜਕ ਦੇ ਹਿੱਸੇ ਤੋਂ ਨਿਕਲ ਚੁੱਕੀ ਹੈ, ਤਾਂ ਵਾਪਸ ਜਾਓ ਅਤੇ ਪਹਿਲਾਂ ਉਸ ਰਿਕਾਰਡ \'ਤੇ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" \'ਤੇ ਟੈਪ ਕਰੋ।',
  },
  // An active park that can't be leg 0: no readable sign, a no-sign park,
  // not in Victoria or Queensland by its own place, or another workday's.
  'workday.start.currentIneligible': {
    en: 'Your current park can\'t be a workday stop. Stops need a readable sign in Victoria or Queensland. Tap I\'ve left on it once the car has left the signed stretch, then start the workday.',
    'zh-CN': '你当前的停车无法作为工作日的一站。每一站都需要在维多利亚州或昆士兰州有可读的标志。等车开出该标志适用的路段后,在该记录上点击"我已离开",然后再开始工作日。',
    vi: 'Chỗ đỗ hiện tại của bạn không thể là một điểm dừng trong ngày làm việc. Mỗi điểm dừng cần một biển báo đọc được ở Victoria hoặc Queensland. Hãy nhấn "Tôi đã đi" trên bản ghi đó khi xe đã rời khỏi đoạn đường có biển báo, rồi bắt đầu ngày làm việc.',
    id: 'Parkirmu saat ini tidak bisa menjadi perhentian hari kerja. Setiap perhentian perlu rambu yang terbaca di Victoria atau Queensland. Ketuk "Sudah pergi" pada catatan itu setelah mobil keluar dari ruas jalan yang diatur rambu, lalu mulai hari kerja.',
    ko: '현재 주차는 근무일의 정차 지점이 될 수 없습니다. 정차 지점에는 빅토리아주나 퀸즐랜드주에서 읽을 수 있는 표지판이 필요합니다. 차가 표지판이 적용되는 구간을 벗어난 뒤 그 기록에서 "떠났습니다"를 누르고 근무일을 시작하세요.',
    it: 'Il tuo parcheggio attuale non può essere una sosta della giornata di lavoro. Le soste richiedono un cartello leggibile in Victoria o Queensland. Tocca "Ho lasciato il posto" su quel record quando l\'auto ha lasciato il tratto indicato dal cartello, poi inizia la giornata di lavoro.',
    el: 'Η τωρινή σου στάθμευση δεν μπορεί να είναι στάση της εργάσιμης μέρας. Οι στάσεις χρειάζονται ευανάγνωστη πινακίδα στη Βικτώρια ή στο Κουίνσλαντ. Πάτησε «Έφυγα» σε αυτή την εγγραφή όταν το αυτοκίνητο φύγει από το τμήμα του δρόμου με την πινακίδα και μετά ξεκίνα την εργάσιμη μέρα.',
    hi: 'आपकी मौजूदा पार्किंग वर्कडे का स्टॉप नहीं बन सकती। हर स्टॉप के लिए विक्टोरिया या क्वींसलैंड में पढ़ा जा सकने वाला साइन ज़रूरी है। गाड़ी के साइन वाले सड़क के हिस्से से निकल जाने के बाद उस रिकॉर्ड पर "मैंने जगह खाली कर दी" पर टैप करें, फिर वर्कडे शुरू करें।',
    pa: 'ਤੁਹਾਡੀ ਮੌਜੂਦਾ ਪਾਰਕਿੰਗ ਵਰਕਡੇ ਦਾ ਸਟਾਪ ਨਹੀਂ ਬਣ ਸਕਦੀ। ਹਰ ਸਟਾਪ ਲਈ ਵਿਕਟੋਰੀਆ ਜਾਂ ਕੁਈਨਜ਼ਲੈਂਡ ਵਿੱਚ ਪੜ੍ਹਿਆ ਜਾ ਸਕਣ ਵਾਲਾ ਚਿੰਨ੍ਹ ਜ਼ਰੂਰੀ ਹੈ। ਕਾਰ ਦੇ ਚਿੰਨ੍ਹ ਵਾਲੇ ਸੜਕ ਦੇ ਹਿੱਸੇ ਤੋਂ ਨਿਕਲ ਜਾਣ ਤੋਂ ਬਾਅਦ ਉਸ ਰਿਕਾਰਡ \'ਤੇ "ਥਾਂ ਖਾਲੀ ਕਰ ਦਿੱਤੀ" \'ਤੇ ਟੈਪ ਕਰੋ, ਫਿਰ ਵਰਕਡੇ ਸ਼ੁਰੂ ਕਰੋ।',
  },

  // ── Explainer (T6b item 3) ────────────────────────────────────────────
  'workday.explainer.heading': {
    en: 'How time limits work',
    'zh-CN': '时限如何计算',
    vi: 'Giới hạn thời gian được tính thế nào',
    id: 'Cara kerja batas waktu',
    ko: '시간 제한이 적용되는 방식',
    it: 'Come funzionano i limiti di tempo',
    el: 'Πώς λειτουργούν τα χρονικά όρια',
    hi: 'समय सीमा कैसे लागू होती है',
    pa: 'ਸਮਾਂ ਸੀਮਾ ਕਿਵੇਂ ਲਾਗੂ ਹੁੰਦੀ ਹੈ',
  },
  // Spec wording (T6b item 3), in full on the first workday.
  'workday.explainer.full': {
    en: "Moving a few bays doesn't restart the time limit. You need to leave the signed length of road, or the whole area under an area sign. Paying again or topping up doesn't restart the limit either. Each move needs a fresh photo of the new sign.",
    'zh-CN': '挪几个车位不会让时限重新计时。你需要离开该标志适用的路段,如果是区域标志,则需要离开整个区域。再次付费或续费也不会让时限重新计时。每次挪车都需要为新标志拍一张新照片。',
    vi: 'Dời xe vài chỗ đỗ không làm giới hạn thời gian bắt đầu lại. Bạn cần rời khỏi đoạn đường có biển báo, hoặc rời khỏi toàn bộ khu vực nếu là biển báo khu vực. Trả tiền lại hoặc nạp thêm tiền cũng không làm giới hạn bắt đầu lại. Mỗi lần dời xe cần một ảnh mới của biển báo mới.',
    id: 'Pindah beberapa petak parkir tidak membuat batas waktu dimulai ulang. Kamu harus meninggalkan ruas jalan yang diatur rambu, atau seluruh area jika rambunya rambu area. Membayar lagi atau menambah pembayaran juga tidak membuat batas waktu dimulai ulang. Setiap pindah perlu foto baru rambu yang baru.',
    ko: '몇 칸 옮기는 것만으로는 시간 제한이 다시 시작되지 않습니다. 표지판이 적용되는 도로 구간을 벗어나거나, 구역 표지판이라면 구역 전체를 벗어나야 합니다. 요금을 다시 내거나 추가로 내도 시간 제한은 다시 시작되지 않습니다. 옮길 때마다 새 표지판의 사진을 새로 찍어야 합니다.',
    it: "Spostarsi di qualche posto non fa ripartire il limite di tempo. Devi lasciare il tratto di strada indicato dal cartello, o l'intera area se il cartello è di area. Anche pagare di nuovo o aggiungere tempo non fa ripartire il limite. Ogni spostamento richiede una foto nuova del nuovo cartello.",
    el: 'Η μετακίνηση λίγες θέσεις πιο κάτω δεν ξαναρχίζει το χρονικό όριο. Πρέπει να φύγεις από το τμήμα του δρόμου που καλύπτει η πινακίδα, ή από όλη την περιοχή αν η πινακίδα είναι πινακίδα περιοχής. Ούτε η νέα πληρωμή ή η συμπλήρωση πληρωμής ξαναρχίζει το όριο. Κάθε μετακίνηση χρειάζεται νέα φωτογραφία της νέας πινακίδας.',
    hi: 'कुछ पार्किंग जगहें आगे जाने से समय सीमा फिर से शुरू नहीं होती। आपको सड़क का वह पूरा हिस्सा छोड़ना होगा जिस पर साइन लागू होता है, या एरिया साइन के तहत पूरा एरिया। दोबारा भुगतान करने या और पैसे डालने से भी समय सीमा फिर से शुरू नहीं होती। हर बार गाड़ी हटाने पर नए साइन की नई फोटो चाहिए।',
    pa: "ਕੁਝ ਪਾਰਕਿੰਗ ਥਾਵਾਂ ਅੱਗੇ ਜਾਣ ਨਾਲ ਸਮਾਂ ਸੀਮਾ ਮੁੜ ਸ਼ੁਰੂ ਨਹੀਂ ਹੁੰਦੀ। ਤੁਹਾਨੂੰ ਸੜਕ ਦਾ ਉਹ ਪੂਰਾ ਹਿੱਸਾ ਛੱਡਣਾ ਪਵੇਗਾ ਜਿਸ 'ਤੇ ਚਿੰਨ੍ਹ ਲਾਗੂ ਹੁੰਦਾ ਹੈ, ਜਾਂ ਖੇਤਰ ਵਾਲੇ ਚਿੰਨ੍ਹ ਹੇਠ ਪੂਰਾ ਖੇਤਰ। ਦੁਬਾਰਾ ਭੁਗਤਾਨ ਕਰਨ ਜਾਂ ਹੋਰ ਪੈਸੇ ਪਾਉਣ ਨਾਲ ਵੀ ਸਮਾਂ ਸੀਮਾ ਮੁੜ ਸ਼ੁਰੂ ਨਹੀਂ ਹੁੰਦੀ। ਹਰ ਵਾਰ ਕਾਰ ਹਟਾਉਣ 'ਤੇ ਨਵੇਂ ਚਿੰਨ੍ਹ ਦੀ ਨਵੀਂ ਫੋਟੋ ਚਾਹੀਦੀ ਹੈ।",
  },
  // The one line after the first workday: the explainer's first and last sentences.
  'workday.explainer.short': {
    en: "Moving a few bays doesn't restart the time limit. Each move needs a fresh photo of the new sign.",
    'zh-CN': '挪几个车位不会让时限重新计时。每次挪车都需要为新标志拍一张新照片。',
    vi: 'Dời xe vài chỗ đỗ không làm giới hạn thời gian bắt đầu lại. Mỗi lần dời xe cần một ảnh mới của biển báo mới.',
    id: 'Pindah beberapa petak parkir tidak membuat batas waktu dimulai ulang. Setiap pindah perlu foto baru rambu yang baru.',
    ko: '몇 칸 옮기는 것만으로는 시간 제한이 다시 시작되지 않습니다. 옮길 때마다 새 표지판의 사진을 새로 찍어야 합니다.',
    it: 'Spostarsi di qualche posto non fa ripartire il limite di tempo. Ogni spostamento richiede una foto nuova del nuovo cartello.',
    el: 'Η μετακίνηση λίγες θέσεις πιο κάτω δεν ξαναρχίζει το χρονικό όριο. Κάθε μετακίνηση χρειάζεται νέα φωτογραφία της νέας πινακίδας.',
    hi: 'कुछ पार्किंग जगहें आगे जाने से समय सीमा फिर से शुरू नहीं होती। हर बार गाड़ी हटाने पर नए साइन की नई फोटो चाहिए।',
    pa: "ਕੁਝ ਪਾਰਕਿੰਗ ਥਾਵਾਂ ਅੱਗੇ ਜਾਣ ਨਾਲ ਸਮਾਂ ਸੀਮਾ ਮੁੜ ਸ਼ੁਰੂ ਨਹੀਂ ਹੁੰਦੀ। ਹਰ ਵਾਰ ਕਾਰ ਹਟਾਉਣ 'ਤੇ ਨਵੇਂ ਚਿੰਨ੍ਹ ਦੀ ਨਵੀਂ ਫੋਟੋ ਚਾਹੀਦੀ ਹੈ।",
  },

  // ── Readiness (T6b item 2) ────────────────────────────────────────────
  'workday.ready.heading': {
    en: 'Reminders',
    'zh-CN': '提醒',
    vi: 'Lời nhắc',
    id: 'Pengingat',
    ko: '알림',
    it: 'Promemoria',
    el: 'Υπενθυμίσεις',
    hi: 'रिमाइंडर',
    pa: 'ਰਿਮਾਈਂਡਰ',
  },
  'workday.ready.on': {
    en: 'Notifications are on, so workday reminders can reach this phone while ParkProof is closed.',
    'zh-CN': '通知已开启,即使 ParkProof 已关闭,工作日提醒也能送达这部手机。',
    vi: 'Thông báo đã bật, nên lời nhắc ngày làm việc có thể đến điện thoại này cả khi ParkProof đã đóng.',
    id: 'Notifikasi aktif, jadi pengingat hari kerja bisa sampai ke ponsel ini meski ParkProof tertutup.',
    ko: '알림이 켜져 있어 ParkProof가 닫혀 있어도 근무일 알림이 이 휴대폰으로 올 수 있습니다.',
    it: 'Le notifiche sono attive, quindi i promemoria della giornata di lavoro possono arrivare su questo telefono anche con ParkProof chiuso.',
    el: 'Οι ειδοποιήσεις είναι ενεργές, οπότε οι υπενθυμίσεις της εργάσιμης μέρας μπορούν να φτάσουν σε αυτό το κινητό ακόμη κι όταν το ParkProof είναι κλειστό.',
    hi: 'नोटिफ़िकेशन चालू हैं, इसलिए ParkProof बंद होने पर भी वर्कडे रिमाइंडर इस फ़ोन पर आ सकते हैं।',
    pa: "ਨੋਟੀਫਿਕੇਸ਼ਨ ਚਾਲੂ ਹਨ, ਇਸ ਲਈ ParkProof ਬੰਦ ਹੋਣ 'ਤੇ ਵੀ ਵਰਕਡੇ ਰਿਮਾਈਂਡਰ ਇਸ ਫ਼ੋਨ 'ਤੇ ਆ ਸਕਦੇ ਹਨ।",
  },
  'workday.ready.ask': {
    en: 'Turn on notifications so workday reminders can reach this phone while ParkProof is closed.',
    'zh-CN': '请开启通知,这样即使 ParkProof 已关闭,工作日提醒也能送达这部手机。',
    vi: 'Hãy bật thông báo để lời nhắc ngày làm việc có thể đến điện thoại này cả khi ParkProof đã đóng.',
    id: 'Aktifkan notifikasi agar pengingat hari kerja bisa sampai ke ponsel ini meski ParkProof tertutup.',
    ko: 'ParkProof가 닫혀 있어도 근무일 알림이 이 휴대폰으로 올 수 있도록 알림을 켜세요.',
    it: 'Attiva le notifiche perché i promemoria della giornata di lavoro possano arrivare su questo telefono anche con ParkProof chiuso.',
    el: 'Ενεργοποίησε τις ειδοποιήσεις για να φτάνουν οι υπενθυμίσεις της εργάσιμης μέρας σε αυτό το κινητό ακόμη κι όταν το ParkProof είναι κλειστό.',
    hi: 'नोटिफ़िकेशन चालू करें ताकि ParkProof बंद होने पर भी वर्कडे रिमाइंडर इस फ़ोन पर आ सकें।',
    pa: 'ਨੋਟੀਫਿਕੇਸ਼ਨ ਚਾਲੂ ਕਰੋ ਤਾਂ ਜੋ ParkProof ਬੰਦ ਹੋਣ \'ਤੇ ਵੀ ਵਰਕਡੇ ਰਿਮਾਈਂਡਰ ਇਸ ਫ਼ੋਨ \'ਤੇ ਆ ਸਕਣ।',
  },
  'workday.ready.allow': {
    en: 'Turn on notifications',
    'zh-CN': '开启通知',
    vi: 'Bật thông báo',
    id: 'Aktifkan notifikasi',
    ko: '알림 켜기',
    it: 'Attiva le notifiche',
    el: 'Ενεργοποίηση ειδοποιήσεων',
    hi: 'नोटिफ़िकेशन चालू करें',
    pa: 'ਨੋਟੀਫਿਕੇਸ਼ਨ ਚਾਲੂ ਕਰੋ',
  },
  // Spec wording (T6b item 2).
  'workday.ready.cantDeliver': {
    en: "Workday reminders need notifications. Without them you'll need to watch the time yourself.",
    'zh-CN': '工作日提醒需要通知功能。没有通知,你就需要自己留意时间。',
    vi: 'Lời nhắc ngày làm việc cần thông báo. Nếu không có thông báo, bạn sẽ phải tự theo dõi thời gian.',
    id: 'Pengingat hari kerja memerlukan notifikasi. Tanpa notifikasi, kamu perlu memantau waktu sendiri.',
    ko: '근무일 알림에는 알림 기능이 필요합니다. 알림이 없으면 시간을 직접 확인해야 합니다.',
    it: "I promemoria della giornata di lavoro hanno bisogno delle notifiche. Senza notifiche, l'orario dovrai controllarlo tu.",
    el: 'Οι υπενθυμίσεις της εργάσιμης μέρας χρειάζονται ειδοποιήσεις. Χωρίς αυτές, την ώρα θα πρέπει να την προσέχεις εσύ.',
    hi: 'वर्कडे रिमाइंडर के लिए नोटिफ़िकेशन ज़रूरी हैं। इनके बिना आपको खुद समय का ध्यान रखना होगा।',
    pa: 'ਵਰਕਡੇ ਰਿਮਾਈਂਡਰਾਂ ਲਈ ਨੋਟੀਫਿਕੇਸ਼ਨ ਜ਼ਰੂਰੀ ਹਨ। ਇਨ੍ਹਾਂ ਤੋਂ ਬਿਨਾਂ ਤੁਹਾਨੂੰ ਆਪ ਸਮੇਂ ਦਾ ਧਿਆਨ ਰੱਖਣਾ ਪਵੇਗਾ।',
  },
  'workday.ready.iosInstall': {
    en: 'On iPhone, notifications need ParkProof on your Home Screen. Tap Share, then Add to Home Screen, and start the workday from there.',
    'zh-CN': '在 iPhone 上,通知需要先把 ParkProof 添加到主屏幕。点击"分享",再点击"添加到主屏幕",然后从那里开始工作日。',
    vi: 'Trên iPhone, thông báo cần ParkProof ở Màn hình chính. Nhấn Chia sẻ, rồi Thêm vào Màn hình chính, và bắt đầu ngày làm việc từ đó.',
    id: 'Di iPhone, notifikasi memerlukan ParkProof di Layar Utama. Ketuk Bagikan, lalu Tambah ke Layar Utama, dan mulai hari kerja dari sana.',
    ko: 'iPhone에서는 ParkProof를 홈 화면에 추가해야 알림을 받을 수 있습니다. 공유를 누른 다음 홈 화면에 추가를 누르고, 그곳에서 근무일을 시작하세요.',
    it: 'Su iPhone, le notifiche richiedono ParkProof nella schermata Home. Tocca Condividi, poi Aggiungi alla schermata Home, e inizia la giornata di lavoro da lì.',
    el: 'Στο iPhone, οι ειδοποιήσεις χρειάζονται το ParkProof στην οθόνη Αφετηρίας. Πάτησε Κοινοποίηση, μετά Προσθήκη στην οθόνη Αφετηρίας, και ξεκίνα την εργάσιμη μέρα από εκεί.',
    hi: 'iPhone पर नोटिफ़िकेशन के लिए ParkProof का होम स्क्रीन पर होना ज़रूरी है। शेयर पर टैप करें, फिर होम स्क्रीन में जोड़ें पर, और वहीं से वर्कडे शुरू करें।',
    pa: "iPhone 'ਤੇ ਨੋਟੀਫਿਕੇਸ਼ਨ ਲਈ ParkProof ਦਾ ਹੋਮ ਸਕ੍ਰੀਨ 'ਤੇ ਹੋਣਾ ਜ਼ਰੂਰੀ ਹੈ। ਸਾਂਝਾ ਕਰੋ 'ਤੇ ਟੈਪ ਕਰੋ, ਫਿਰ ਹੋਮ ਸਕ੍ਰੀਨ 'ਤੇ ਸ਼ਾਮਲ ਕਰੋ 'ਤੇ, ਅਤੇ ਉੱਥੋਂ ਹੀ ਵਰਕਡੇ ਸ਼ੁਰੂ ਕਰੋ।",
  },
  'workday.ready.denied': {
    en: "Notifications are blocked for ParkProof. You can allow them in your browser's site settings.",
    'zh-CN': 'ParkProof 的通知已被阻止。你可以在浏览器的网站设置中允许通知。',
    vi: 'Thông báo của ParkProof đang bị chặn. Bạn có thể cho phép trong phần cài đặt trang web của trình duyệt.',
    id: 'Notifikasi untuk ParkProof diblokir. Kamu bisa mengizinkannya di pengaturan situs browser.',
    ko: 'ParkProof의 알림이 차단되어 있습니다. 브라우저의 사이트 설정에서 허용할 수 있습니다.',
    it: 'Le notifiche di ParkProof sono bloccate. Puoi consentirle nelle impostazioni del sito del browser.',
    el: 'Οι ειδοποιήσεις του ParkProof είναι αποκλεισμένες. Μπορείς να τις επιτρέψεις στις ρυθμίσεις ιστότοπου του προγράμματος περιήγησης.',
    hi: 'ParkProof के नोटिफ़िकेशन ब्लॉक हैं। आप इन्हें ब्राउज़र की साइट सेटिंग में चालू कर सकते हैं।',
    pa: 'ParkProof ਦੇ ਨੋਟੀਫਿਕੇਸ਼ਨ ਬਲੌਕ ਹਨ। ਤੁਸੀਂ ਇਨ੍ਹਾਂ ਨੂੰ ਬ੍ਰਾਊਜ਼ਰ ਦੀ ਸਾਈਟ ਸੈਟਿੰਗ ਵਿੱਚ ਚਾਲੂ ਕਰ ਸਕਦੇ ਹੋ।',
  },
  'workday.ready.turnedOff': {
    en: 'Notifications are turned off for ParkProof on this phone. You can turn them on again in Settings.',
    'zh-CN': '这部手机上 ParkProof 的通知已关闭。你可以在"设置"中重新开启。',
    vi: 'Thông báo của ParkProof đã bị tắt trên điện thoại này. Bạn có thể bật lại trong Cài đặt.',
    id: 'Notifikasi ParkProof dimatikan di ponsel ini. Kamu bisa menyalakannya lagi di Pengaturan.',
    ko: '이 휴대폰에서 ParkProof 알림이 꺼져 있습니다. 설정에서 다시 켤 수 있습니다.',
    it: 'Le notifiche di ParkProof sono disattivate su questo telefono. Puoi riattivarle nelle Impostazioni.',
    el: 'Οι ειδοποιήσεις του ParkProof είναι απενεργοποιημένες σε αυτό το κινητό. Μπορείς να τις ενεργοποιήσεις ξανά στις Ρυθμίσεις.',
    hi: 'इस फ़ोन पर ParkProof के नोटिफ़िकेशन बंद हैं। आप इन्हें सेटिंग्स में फिर से चालू कर सकते हैं।',
    pa: "ਇਸ ਫ਼ੋਨ 'ਤੇ ParkProof ਦੇ ਨੋਟੀਫਿਕੇਸ਼ਨ ਬੰਦ ਹਨ। ਤੁਸੀਂ ਇਨ੍ਹਾਂ ਨੂੰ ਸੈਟਿੰਗਾਂ ਵਿੱਚ ਮੁੜ ਚਾਲੂ ਕਰ ਸਕਦੇ ਹੋ।",
  },

  // ── Calendar file with the same alarms (T6b item 2) ──────────────────
  'workday.ics.button': {
    en: 'Add calendar reminders for this stop',
    'zh-CN': '为这一站添加日历提醒',
    vi: 'Thêm lời nhắc vào lịch cho điểm dừng này',
    id: 'Tambahkan pengingat kalender untuk perhentian ini',
    ko: '이 정차 지점의 캘린더 알림 추가',
    it: 'Aggiungi promemoria al calendario per questa sosta',
    el: 'Προσθήκη υπενθυμίσεων ημερολογίου για αυτή τη στάση',
    hi: 'इस स्टॉप के लिए कैलेंडर रिमाइंडर जोड़ें',
    pa: 'ਇਸ ਸਟਾਪ ਲਈ ਕੈਲੰਡਰ ਰਿਮਾਈਂਡਰ ਸ਼ਾਮਲ ਕਰੋ',
  },
  // The calendar event's title. {{time}} is the deadline, an absolute time.
  'workday.ics.title': {
    en: 'Move off this signed stretch by {{time}}',
    'zh-CN': '在 {{time}} 前把车开出该标志适用的路段',
    vi: 'Dời xe ra khỏi đoạn đường có biển báo này trước {{time}}',
    id: 'Pindahkan mobil keluar dari ruas jalan yang diatur rambu ini sebelum pukul {{time}}',
    ko: '{{time}} 전에 표지판이 적용되는 이 구간을 벗어나세요',
    it: 'Esci da questo tratto indicato dal cartello entro le {{time}}',
    el: 'Φύγε από αυτό το τμήμα του δρόμου με την πινακίδα έως τις {{time}}',
    hi: '{{time}} से पहले साइन वाले सड़क के इस हिस्से से गाड़ी हटा लें',
    pa: '{{time}} ਤੋਂ ਪਹਿਲਾਂ ਚਿੰਨ੍ਹ ਵਾਲੇ ਸੜਕ ਦੇ ਇਸ ਹਿੱਸੇ ਤੋਂ ਕਾਰ ਹਟਾ ਲਵੋ',
  },
  // The same under an area sign (r335): the whole area.
  'workday.ics.titleArea': {
    en: 'Move the car out of this parking area by {{time}}',
    'zh-CN': '在 {{time}} 前把车开出此停车区域',
    vi: 'Dời xe ra khỏi khu vực đỗ xe này trước {{time}}',
    id: 'Pindahkan mobil keluar dari area parkir ini sebelum pukul {{time}}',
    ko: '{{time}} 전에 차를 이 주차 구역 밖으로 옮기세요',
    it: "Sposta l'auto fuori da quest'area di parcheggio entro le {{time}}",
    el: 'Βγάλε το αυτοκίνητο από αυτή την περιοχή στάθμευσης έως τις {{time}}',
    hi: '{{time}} से पहले गाड़ी को इस पार्किंग एरिया से बाहर ले जाएं',
    pa: '{{time}} ਤੋਂ ਪਹਿਲਾਂ ਕਾਰ ਨੂੰ ਇਸ ਪਾਰਕਿੰਗ ਖੇਤਰ ਤੋਂ ਬਾਹਰ ਲੈ ਜਾਓ',
  },

  // ── Home card (T6b items 5, 6 and 10) ─────────────────────────────────
  'workday.card.kicker': {
    en: 'Workday',
    'zh-CN': '工作日',
    vi: 'Ngày làm việc',
    id: 'Hari kerja',
    ko: '근무일',
    it: 'Giornata di lavoro',
    el: 'Εργάσιμη μέρα',
    hi: 'वर्कडे',
    pa: 'ਵਰਕਡੇ',
  },
  // {{number}} is the stop's place in the day (1, 2, 3...).
  'workday.card.stop': {
    en: 'Stop {{number}}',
    'zh-CN': '第 {{number}} 站',
    vi: 'Điểm dừng {{number}}',
    id: 'Perhentian {{number}}',
    ko: '정차 지점 {{number}}',
    it: 'Sosta {{number}}',
    el: 'Στάση {{number}}',
    hi: 'स्टॉप {{number}}',
    pa: 'ਸਟਾਪ {{number}}',
  },
  'workday.card.noStops': {
    en: 'No stops yet. Each stop starts with a photo of its sign.',
    'zh-CN': '还没有任何一站。每一站都从拍摄标志照片开始。',
    vi: 'Chưa có điểm dừng nào. Mỗi điểm dừng bắt đầu bằng một ảnh biển báo.',
    id: 'Belum ada perhentian. Setiap perhentian dimulai dengan foto rambunya.',
    ko: '아직 정차 지점이 없습니다. 각 정차 지점은 표지판 사진으로 시작합니다.',
    it: 'Nessuna sosta per ora. Ogni sosta inizia con una foto del suo cartello.',
    el: 'Καμία στάση ακόμη. Κάθε στάση ξεκινά με μια φωτογραφία της πινακίδας της.',
    hi: 'अभी कोई स्टॉप नहीं है। हर स्टॉप उसके साइन की फोटो से शुरू होता है।',
    pa: 'ਅਜੇ ਕੋਈ ਸਟਾਪ ਨਹੀਂ। ਹਰ ਸਟਾਪ ਉਸਦੇ ਚਿੰਨ੍ਹ ਦੀ ਫੋਟੋ ਨਾਲ ਸ਼ੁਰੂ ਹੁੰਦਾ ਹੈ।',
  },
  // Between moves. {{time}} is the stop's ended_at, a phone time.
  'workday.card.moved': {
    en: 'Stop {{number}} ended at {{time}} (phone clock).',
    'zh-CN': '第 {{number}} 站于 {{time}} 结束(手机时钟)。',
    vi: 'Điểm dừng {{number}} kết thúc lúc {{time}} (đồng hồ điện thoại).',
    id: 'Perhentian {{number}} berakhir pukul {{time}} (jam ponsel).',
    ko: '정차 지점 {{number}}이(가) {{time}}에 끝났습니다 (휴대폰 시계).',
    it: 'Sosta {{number}} terminata alle {{time}} (orologio del telefono).',
    el: 'Η στάση {{number}} τελείωσε στις {{time}} (ρολόι κινητού).',
    hi: 'स्टॉप {{number}} {{time}} पर खत्म हुआ (फ़ोन की घड़ी)।',
    pa: "ਸਟਾਪ {{number}} {{time}} 'ਤੇ ਖ਼ਤਮ ਹੋਇਆ (ਫ਼ੋਨ ਦੀ ਘੜੀ)।",
  },
  'workday.card.open': {
    en: 'Open this workday',
    'zh-CN': '打开这个工作日',
    vi: 'Mở ngày làm việc này',
    id: 'Buka hari kerja ini',
    ko: '이 근무일 열기',
    it: 'Apri questa giornata di lavoro',
    el: 'Άνοιγμα αυτής της εργάσιμης μέρας',
    hi: 'यह वर्कडे खोलें',
    pa: 'ਇਹ ਵਰਕਡੇ ਖੋਲ੍ਹੋ',
  },
  // Screen-reader name of the card. {{status}} is what the card shows.
  'workday.card.openAria': {
    en: 'Open this workday. {{status}}',
    'zh-CN': '打开这个工作日。{{status}}',
    vi: 'Mở ngày làm việc này. {{status}}',
    id: 'Buka hari kerja ini. {{status}}',
    ko: '이 근무일 열기. {{status}}',
    it: 'Apri questa giornata di lavoro. {{status}}',
    el: 'Άνοιγμα αυτής της εργάσιμης μέρας. {{status}}',
    hi: 'यह वर्कडे खोलें। {{status}}',
    pa: 'ਇਹ ਵਰਕਡੇ ਖੋਲ੍ਹੋ। {{status}}',
  },
  'workday.card.expiredHint': {
    en: "Still here? Move now. Already moved? Tap I'm moving the car now.",
    'zh-CN': '还在这里?现在就挪车。已经挪了?点击"我现在要挪车"。',
    vi: 'Vẫn còn ở đây? Hãy dời xe ngay. Đã dời rồi? Nhấn "Tôi đang dời xe".',
    id: 'Masih di sini? Pindahkan sekarang. Sudah pindah? Ketuk "Saya memindahkan mobil sekarang".',
    ko: '아직 여기 있나요? 지금 옮기세요. 이미 옮겼나요? "지금 차를 옮깁니다"를 누르세요.',
    it: 'Ancora qui? Sposta l\'auto ora. L\'hai già spostata? Tocca "Sto spostando l\'auto ora".',
    el: 'Ακόμη εδώ; Μετακίνησε το αυτοκίνητο τώρα. Το μετακίνησες ήδη; Πάτησε «Μετακινώ το αυτοκίνητο τώρα».',
    hi: 'अभी भी यहीं हैं? अभी गाड़ी हटाएं। गाड़ी हटा दी है? "गाड़ी अभी हटाई जा रही है" पर टैप करें।',
    pa: 'ਅਜੇ ਵੀ ਇੱਥੇ ਹੋ? ਹੁਣੇ ਕਾਰ ਹਟਾਓ। ਕਾਰ ਹਟਾ ਦਿੱਤੀ ਹੈ? "ਕਾਰ ਹੁਣ ਹਟਾਈ ਜਾ ਰਹੀ ਹੈ" \'ਤੇ ਟੈਪ ਕਰੋ।',
  },
  // Spec wording (T6b item 6). hi and pa: a passive ("the car is being
  // moved now"), so the line has no gendered first person.
  'workday.card.move': {
    en: "I'm moving the car now",
    'zh-CN': '我现在要挪车',
    vi: 'Tôi đang dời xe',
    id: 'Saya memindahkan mobil sekarang',
    ko: '지금 차를 옮깁니다',
    it: "Sto spostando l'auto ora",
    el: 'Μετακινώ το αυτοκίνητο τώρα',
    hi: 'गाड़ी अभी हटाई जा रही है',
    pa: 'ਕਾਰ ਹੁਣ ਹਟਾਈ ਜਾ ਰਹੀ ਹੈ',
  },
  // Spec wording (T6b item 6).
  'workday.card.moveHint': {
    en: 'Tap before you drive off',
    'zh-CN': '开车离开前点击',
    vi: 'Nhấn trước khi lái đi',
    id: 'Ketuk sebelum kamu berangkat',
    ko: '출발하기 전에 누르세요',
    it: 'Tocca prima di partire',
    el: 'Πάτησέ το πριν ξεκινήσεις',
    hi: 'निकलने से पहले टैप करें',
    pa: 'ਨਿਕਲਣ ਤੋਂ ਪਹਿਲਾਂ ਟੈਪ ਕਰੋ',
  },
  // The first stop's scan (a workday started with no record active).
  'workday.card.scanFirst': {
    en: 'Parked? Scan the sign where you are',
    'zh-CN': '停好了?扫描你所在位置的标志',
    vi: 'Đã đỗ xe? Quét biển báo nơi bạn đang ở',
    id: 'Sudah parkir? Pindai rambu di tempatmu',
    ko: '주차했나요? 지금 있는 곳의 표지판을 스캔하세요',
    it: 'Hai parcheggiato? Scansiona il cartello dove sei',
    el: 'Πάρκαρες; Σάρωσε την πινακίδα εκεί που βρίσκεσαι',
    hi: 'पार्क कर दिया? जहाँ आप हैं वहाँ का साइन स्कैन करें',
    pa: 'ਪਾਰਕ ਕਰ ਦਿੱਤੀ? ਜਿੱਥੇ ਤੁਸੀਂ ਹੋ ਉੱਥੋਂ ਦਾ ਚਿੰਨ੍ਹ ਸਕੈਨ ਕਰੋ',
  },
  // Spec wording (T6b item 6).
  'workday.card.scanNext': {
    en: 'Parked again? Scan the new sign',
    'zh-CN': '又停好了?扫描新的标志',
    vi: 'Đã đỗ lại? Quét biển báo mới',
    id: 'Sudah parkir lagi? Pindai rambu yang baru',
    ko: '다시 주차했나요? 새 표지판을 스캔하세요',
    it: 'Hai parcheggiato di nuovo? Scansiona il nuovo cartello',
    el: 'Πάρκαρες ξανά; Σάρωσε τη νέα πινακίδα',
    hi: 'फिर से पार्क कर दिया? नया साइन स्कैन करें',
    pa: 'ਮੁੜ ਪਾਰਕ ਕਰ ਦਿੱਤੀ? ਨਵਾਂ ਚਿੰਨ੍ਹ ਸਕੈਨ ਕਰੋ',
  },
  'workday.card.end': {
    en: 'End workday',
    'zh-CN': '结束工作日',
    vi: 'Kết thúc ngày làm việc',
    id: 'Akhiri hari kerja',
    ko: '근무일 끝내기',
    it: 'Termina la giornata di lavoro',
    el: 'Τέλος εργάσιμης μέρας',
    hi: 'वर्कडे खत्म करें',
    pa: 'ਵਰਕਡੇ ਖ਼ਤਮ ਕਰੋ',
  },

  // ── End between moves (T6b item 10) ───────────────────────────────────
  'workday.end.title': {
    en: 'End this workday?',
    'zh-CN': '结束这个工作日?',
    vi: 'Kết thúc ngày làm việc này?',
    id: 'Akhiri hari kerja ini?',
    ko: '이 근무일을 끝낼까요?',
    it: 'Terminare questa giornata di lavoro?',
    el: 'Να τελειώσει αυτή η εργάσιμη μέρα;',
    hi: 'यह वर्कडे खत्म करें?',
    pa: 'ਕੀ ਇਹ ਵਰਕਡੇ ਖ਼ਤਮ ਕਰਨਾ ਹੈ?',
  },
  'workday.end.body': {
    en: "Your stops stay in History. After this, a park you log is a normal record, and ParkProof won't ask whether you left the signed stretch.",
    'zh-CN': '你的各站会保留在停车记录中。之后你记录的停车都是普通记录,ParkProof 不会再询问你是否已离开该标志适用的路段。',
    vi: 'Các điểm dừng của bạn vẫn còn trong Lịch sử. Sau đó, chỗ đỗ bạn ghi lại sẽ là bản ghi thông thường, và ParkProof sẽ không hỏi bạn đã rời khỏi đoạn đường có biển báo hay chưa.',
    id: 'Perhentianmu tetap ada di Riwayat. Setelah ini, parkir yang kamu catat adalah catatan biasa, dan ParkProof tidak akan menanyakan apakah kamu sudah meninggalkan ruas jalan yang diatur rambu.',
    ko: '정차 지점은 주차 기록에 남습니다. 이후에 기록하는 주차는 일반 기록이 되며, ParkProof는 표지판이 적용되는 구간을 벗어났는지 묻지 않습니다.',
    it: 'Le tue soste restano nella Cronologia. Dopo, un parcheggio che registri è un record normale e ParkProof non chiederà se hai lasciato il tratto indicato dal cartello.',
    el: 'Οι στάσεις σου μένουν στο Ιστορικό. Μετά από αυτό, μια στάθμευση που καταγράφεις είναι κανονική εγγραφή, και το ParkProof δεν θα ρωτά αν έφυγες από το τμήμα του δρόμου με την πινακίδα.',
    hi: 'आपके स्टॉप रिकॉर्ड इतिहास में बने रहेंगे। इसके बाद आप जो पार्किंग दर्ज करेंगे वह सामान्य रिकॉर्ड होगी, और ParkProof यह नहीं पूछेगा कि आपने साइन वाला सड़क का हिस्सा छोड़ा या नहीं।',
    pa: 'ਤੁਹਾਡੇ ਸਟਾਪ ਰਿਕਾਰਡ ਇਤਿਹਾਸ ਵਿੱਚ ਰਹਿਣਗੇ। ਇਸ ਤੋਂ ਬਾਅਦ ਤੁਸੀਂ ਜੋ ਪਾਰਕਿੰਗ ਦਰਜ ਕਰੋਗੇ ਉਹ ਆਮ ਰਿਕਾਰਡ ਹੋਵੇਗੀ, ਅਤੇ ParkProof ਇਹ ਨਹੀਂ ਪੁੱਛੇਗਾ ਕਿ ਤੁਸੀਂ ਚਿੰਨ੍ਹ ਵਾਲਾ ਸੜਕ ਦਾ ਹਿੱਸਾ ਛੱਡਿਆ ਜਾਂ ਨਹੀਂ।',
  },

  // ── History: one row per workday (T6b item 5) ─────────────────────────
  'workday.history.row_one': {
    en: 'Workday, {{count}} stop',
    'zh-CN': '工作日,{{count}} 站',
    vi: 'Ngày làm việc, {{count}} điểm dừng',
    id: 'Hari kerja, {{count}} perhentian',
    ko: '근무일, 정차 지점 {{count}}곳',
    it: 'Giornata di lavoro, {{count}} sosta',
    el: 'Εργάσιμη μέρα, {{count}} στάση',
    hi: 'वर्कडे, {{count}} स्टॉप',
    pa: 'ਵਰਕਡੇ, {{count}} ਸਟਾਪ',
  },
  // Spec wording (T6b item 5).
  'workday.history.row_other': {
    en: 'Workday, {{count}} stops',
    'zh-CN': '工作日,{{count}} 站',
    vi: 'Ngày làm việc, {{count}} điểm dừng',
    id: 'Hari kerja, {{count}} perhentian',
    ko: '근무일, 정차 지점 {{count}}곳',
    it: 'Giornata di lavoro, {{count}} soste',
    el: 'Εργάσιμη μέρα, {{count}} στάσεις',
    hi: 'वर्कडे, {{count}} स्टॉप',
    pa: 'ਵਰਕਡੇ, {{count}} ਸਟਾਪ',
  },
  'workday.status.active': {
    en: 'In progress',
    'zh-CN': '进行中',
    vi: 'Đang diễn ra',
    id: 'Sedang berlangsung',
    ko: '진행 중',
    it: 'In corso',
    el: 'Σε εξέλιξη',
    hi: 'जारी है',
    pa: 'ਜਾਰੀ ਹੈ',
  },
  'workday.status.ended': {
    en: 'Ended',
    'zh-CN': '已结束',
    vi: 'Đã kết thúc',
    id: 'Selesai',
    ko: '끝남',
    it: 'Terminata',
    el: 'Ολοκληρώθηκε',
    hi: 'खत्म',
    pa: 'ਖ਼ਤਮ',
  },

  // ── Workday view (T6b item 5) ─────────────────────────────────────────
  'workday.view.title': {
    en: 'Workday',
    'zh-CN': '工作日',
    vi: 'Ngày làm việc',
    id: 'Hari kerja',
    ko: '근무일',
    it: 'Giornata di lavoro',
    el: 'Εργάσιμη μέρα',
    hi: 'वर्कडे',
    pa: 'ਵਰਕਡੇ',
  },
  'workday.view.started': {
    en: 'Started {{time}} (phone clock)',
    'zh-CN': '开始于 {{time}}(手机时钟)',
    vi: 'Bắt đầu {{time}} (đồng hồ điện thoại)',
    id: 'Dimulai {{time}} (jam ponsel)',
    ko: '시작 {{time}} (휴대폰 시계)',
    it: 'Iniziata {{time}} (orologio del telefono)',
    el: 'Ξεκίνησε {{time}} (ρολόι κινητού)',
    hi: '{{time}} पर शुरू हुआ (फ़ोन की घड़ी)',
    pa: "{{time}} 'ਤੇ ਸ਼ੁਰੂ ਹੋਇਆ (ਫ਼ੋਨ ਦੀ ਘੜੀ)",
  },
  'workday.view.ended': {
    en: 'Ended {{time}} (phone clock)',
    'zh-CN': '结束于 {{time}}(手机时钟)',
    vi: 'Kết thúc {{time}} (đồng hồ điện thoại)',
    id: 'Berakhir {{time}} (jam ponsel)',
    ko: '종료 {{time}} (휴대폰 시계)',
    it: 'Terminata {{time}} (orologio del telefono)',
    el: 'Τελείωσε {{time}} (ρολόι κινητού)',
    hi: '{{time}} पर खत्म हुआ (फ़ोन की घड़ी)',
    pa: "{{time}} 'ਤੇ ਖ਼ਤਮ ਹੋਇਆ (ਫ਼ੋਨ ਦੀ ਘੜੀ)",
  },
  'workday.view.stopsHeading': {
    en: 'Stops',
    'zh-CN': '各站',
    vi: 'Các điểm dừng',
    id: 'Perhentian',
    ko: '정차 지점',
    it: 'Soste',
    el: 'Στάσεις',
    hi: 'स्टॉप',
    pa: 'ਸਟਾਪ',
  },
  'workday.view.noStops': {
    en: 'No stops yet.',
    'zh-CN': '还没有任何一站。',
    vi: 'Chưa có điểm dừng nào.',
    id: 'Belum ada perhentian.',
    ko: '아직 정차 지점이 없습니다.',
    it: 'Nessuna sosta per ora.',
    el: 'Καμία στάση ακόμη.',
    hi: 'अभी कोई स्टॉप नहीं है।',
    pa: 'ਅਜੇ ਕੋਈ ਸਟਾਪ ਨਹੀਂ।',
  },
  // Leg 0 from "Use the car's current park": tagged locally, never re-signed.
  'workday.view.tagged': {
    en: "Added to this workday from an earlier park. Its signed details don't mention the workday.",
    'zh-CN': '这一站是从之前的一次停车加入此工作日的。它已签名的信息中没有提到这个工作日。',
    vi: 'Được thêm vào ngày làm việc này từ một lần đỗ xe trước đó. Các chi tiết đã ký của nó không nhắc đến ngày làm việc.',
    id: 'Ditambahkan ke hari kerja ini dari parkir sebelumnya. Detailnya yang ditandatangani tidak menyebut hari kerja ini.',
    ko: '이전 주차에서 이 근무일에 추가되었습니다. 서명된 세부 정보에는 근무일이 언급되어 있지 않습니다.',
    it: 'Aggiunta a questa giornata di lavoro da un parcheggio precedente. I suoi dati firmati non citano la giornata di lavoro.',
    el: 'Προστέθηκε σε αυτή την εργάσιμη μέρα από προηγούμενη στάθμευση. Τα υπογεγραμμένα στοιχεία της δεν αναφέρουν την εργάσιμη μέρα.',
    hi: 'यह स्टॉप पहले की एक पार्किंग से इस वर्कडे में जोड़ा गया है। इसके हस्ताक्षर किए गए विवरण में वर्कडे का ज़िक्र नहीं है।',
    pa: 'ਇਹ ਸਟਾਪ ਪਹਿਲਾਂ ਦੀ ਇੱਕ ਪਾਰਕਿੰਗ ਤੋਂ ਇਸ ਵਰਕਡੇ ਵਿੱਚ ਜੋੜਿਆ ਗਿਆ ਹੈ। ਇਸਦੇ ਹਸਤਾਖਰ ਕੀਤੇ ਵੇਰਵਿਆਂ ਵਿੱਚ ਵਰਕਡੇ ਦਾ ਜ਼ਿਕਰ ਨਹੀਂ ਹੈ।',
  },

  // ── Stops need a readable sign (T6b item 7) ───────────────────────────
  // Spec wording.
  'workday.noSign.body': {
    en: 'Workday mode needs a readable sign at each spot. Some areas, like central Brisbane, have time limits even where a street has no sign.',
    'zh-CN': '工作日模式要求每个停车位置都有可读的标志。有些地区,例如布里斯班市中心,即使街道上没有标志也有时间限制。',
    vi: 'Chế độ ngày làm việc cần một biển báo đọc được ở mỗi chỗ đỗ. Một số khu vực, như trung tâm Brisbane, có giới hạn thời gian ngay cả khi con đường không có biển báo.',
    id: 'Mode hari kerja memerlukan rambu yang terbaca di setiap tempat. Beberapa area, seperti pusat kota Brisbane, punya batas waktu meski jalannya tidak punya rambu.',
    ko: '근무일 모드에는 각 주차 자리마다 읽을 수 있는 표지판이 필요합니다. 브리즈번 도심처럼 일부 지역은 거리에 표지판이 없어도 시간 제한이 있습니다.',
    it: 'La modalità giornata di lavoro richiede un cartello leggibile in ogni posto. Alcune zone, come il centro di Brisbane, hanno limiti di tempo anche dove la strada non ha cartelli.',
    el: 'Η λειτουργία εργάσιμης μέρας χρειάζεται ευανάγνωστη πινακίδα σε κάθε θέση. Ορισμένες περιοχές, όπως το κέντρο του Μπρίσμπεϊν, έχουν χρονικά όρια ακόμη κι εκεί όπου ένας δρόμος δεν έχει πινακίδα.',
    hi: 'वर्कडे मोड के लिए हर जगह पढ़ा जा सकने वाला साइन ज़रूरी है। कुछ इलाकों में, जैसे ब्रिस्बेन के केंद्र में, जिस सड़क पर साइन नहीं है वहाँ भी समय सीमा लागू होती है।',
    pa: "ਵਰਕਡੇ ਮੋਡ ਲਈ ਹਰ ਥਾਂ 'ਤੇ ਪੜ੍ਹਿਆ ਜਾ ਸਕਣ ਵਾਲਾ ਚਿੰਨ੍ਹ ਜ਼ਰੂਰੀ ਹੈ। ਕੁਝ ਇਲਾਕਿਆਂ ਵਿੱਚ, ਜਿਵੇਂ ਬ੍ਰਿਸਬੇਨ ਦੇ ਕੇਂਦਰ ਵਿੱਚ, ਜਿਸ ਸੜਕ 'ਤੇ ਚਿੰਨ੍ਹ ਨਹੀਂ ਹੈ ਉੱਥੇ ਵੀ ਸਮਾਂ ਸੀਮਾ ਲਾਗੂ ਹੁੰਦੀ ਹੈ।",
  },
  // Spec wording: a stop outside Victoria and Queensland.
  'workday.stopped.notAvailable': {
    en: "Workday mode isn't available here yet. This park is saved as a normal record with its own sign reading.",
    'zh-CN': '工作日模式在这里暂不可用。这次停车已保存为普通记录,并有它自己的标志读取结果。',
    vi: 'Chế độ ngày làm việc chưa có ở đây. Lần đỗ xe này được lưu thành bản ghi thông thường với kết quả đọc biển báo riêng.',
    id: 'Mode hari kerja belum tersedia di sini. Parkir ini disimpan sebagai catatan biasa dengan pembacaan rambunya sendiri.',
    ko: '이곳에서는 아직 근무일 모드를 사용할 수 없습니다. 이 주차는 자체 표지판 판독 결과와 함께 일반 기록으로 저장되었습니다.',
    it: 'La modalità giornata di lavoro non è ancora disponibile qui. Questo parcheggio è salvato come record normale con la sua lettura del cartello.',
    el: 'Η λειτουργία εργάσιμης μέρας δεν είναι ακόμη διαθέσιμη εδώ. Αυτή η στάθμευση αποθηκεύτηκε ως κανονική εγγραφή με τη δική της ανάγνωση πινακίδας.',
    hi: 'वर्कडे मोड अभी यहाँ उपलब्ध नहीं है। यह पार्किंग अपने साइन की रीडिंग के साथ सामान्य रिकॉर्ड के रूप में सेव की गई है।',
    pa: 'ਵਰਕਡੇ ਮੋਡ ਅਜੇ ਇੱਥੇ ਉਪਲਬਧ ਨਹੀਂ ਹੈ। ਇਹ ਪਾਰਕਿੰਗ ਆਪਣੇ ਚਿੰਨ੍ਹ ਦੀ ਰੀਡਿੰਗ ਨਾਲ ਆਮ ਰਿਕਾਰਡ ਵਜੋਂ ਸੇਵ ਕੀਤੀ ਗਈ ਹੈ।',
  },
  // A stop whose state couldn't be told from its own place (no GPS fix at
  // Save, a fix too rough to look up, a typed address, a lookup that failed):
  // it can't be a stop, so the workday ends, but the park keeps the running
  // limit the driver was shown (fail safe). Not the spec's 'isn't available
  // here' line, which would be false in Victoria or Queensland.
  'workday.stopped.unknownState': {
    en: 'ParkProof couldn\'t tell which state this park is in, so the workday has ended. This park is saved as a normal record. If you told us you weren\'t sure, your original time limit still applies.',
    'zh-CN': 'ParkProof 无法判断这次停车位于哪个州,因此工作日已结束。这次停车已保存为普通记录。如果你告诉我们你不确定,原来的时限仍然适用。',
    vi: 'ParkProof không xác định được lần đỗ xe này ở tiểu bang nào, nên ngày làm việc đã kết thúc. Lần đỗ xe này được lưu thành bản ghi thông thường. Nếu bạn đã cho chúng tôi biết là bạn không chắc, giới hạn thời gian ban đầu của bạn vẫn được áp dụng.',
    id: 'ParkProof tidak bisa memastikan parkir ini ada di negara bagian mana, jadi hari kerja sudah berakhir. Parkir ini disimpan sebagai catatan biasa. Kalau kamu bilang tidak yakin, batas waktu awalmu masih berlaku.',
    ko: 'ParkProof가 이 주차가 어느 주에 있는지 확인할 수 없어 근무일이 종료되었습니다. 이 주차는 일반 기록으로 저장되었습니다. 잘 모르겠다고 답했다면 처음의 시간 제한이 계속 적용됩니다.',
    it: 'ParkProof non è riuscito a capire in quale stato si trova questo parcheggio, quindi la giornata di lavoro è terminata. Questo parcheggio è salvato come record normale. Se ci hai detto che non lo sapevi con certezza, il tuo limite di tempo iniziale continua a valere.',
    el: 'Το ParkProof δεν μπόρεσε να καταλάβει σε ποια πολιτεία βρίσκεται αυτή η στάθμευση, οπότε η εργάσιμη μέρα τελείωσε. Αυτή η στάθμευση αποθηκεύτηκε ως κανονική εγγραφή. Αν μας είπες ότι δεν το ξέρεις με βεβαιότητα, το αρχικό χρονικό όριο εξακολουθεί να ισχύει.',
    hi: 'ParkProof यह पता नहीं लगा सका कि यह पार्किंग किस राज्य में है, इसलिए वर्कडे खत्म हो गया है। यह पार्किंग सामान्य रिकॉर्ड के रूप में सेव की गई है। अगर आपने बताया था कि आपको पक्का नहीं पता, तो आपकी पहली समय सीमा अब भी लागू है।',
    pa: 'ParkProof ਇਹ ਪਤਾ ਨਹੀਂ ਲਗਾ ਸਕਿਆ ਕਿ ਇਹ ਪਾਰਕਿੰਗ ਕਿਸ ਰਾਜ ਵਿੱਚ ਹੈ, ਇਸ ਲਈ ਵਰਕਡੇ ਖ਼ਤਮ ਹੋ ਗਿਆ ਹੈ। ਇਹ ਪਾਰਕਿੰਗ ਆਮ ਰਿਕਾਰਡ ਵਜੋਂ ਸੇਵ ਕੀਤੀ ਗਈ ਹੈ। ਜੇ ਤੁਸੀਂ ਦੱਸਿਆ ਸੀ ਕਿ ਤੁਹਾਨੂੰ ਪੱਕਾ ਨਹੀਂ ਪਤਾ, ਤਾਂ ਤੁਹਾਡੀ ਪਹਿਲੀ ਸਮਾਂ ਸੀਮਾ ਹਾਲੇ ਵੀ ਲਾਗੂ ਹੈ।',
  },

  // ── Scanner: a fresh photo is mandatory (T6b item 6) ──────────────────
  'workday.scan.fresh': {
    en: 'Workday stop: take a fresh photo of the sign where the car is now.',
    'zh-CN': '工作日的一站:请为车现在所在位置的标志拍一张新照片。',
    vi: 'Điểm dừng trong ngày làm việc: hãy chụp ảnh mới biển báo ở nơi xe đang đỗ.',
    id: 'Perhentian hari kerja: ambil foto baru rambu di tempat mobil berada sekarang.',
    ko: '근무일 정차 지점: 지금 차가 있는 곳의 표지판을 새로 찍으세요.',
    it: "Sosta della giornata di lavoro: scatta una foto nuova del cartello dove si trova l'auto ora.",
    el: 'Στάση εργάσιμης μέρας: τράβηξε νέα φωτογραφία της πινακίδας εκεί που βρίσκεται τώρα το αυτοκίνητο.',
    hi: 'वर्कडे स्टॉप: जहाँ गाड़ी अभी खड़ी है वहाँ के साइन की नई फोटो लें।',
    pa: 'ਵਰਕਡੇ ਸਟਾਪ: ਜਿੱਥੇ ਕਾਰ ਹੁਣ ਖੜ੍ਹੀ ਹੈ ਉੱਥੋਂ ਦੇ ਚਿੰਨ੍ਹ ਦੀ ਨਵੀਂ ਫੋਟੋ ਲਓ।',
  },
  // In place of "Pick a photo from your library": a stop has no library option.
  'workday.scan.cameraDenied': {
    en: 'Turn camera access back on in your browser settings. Workday stops need a photo taken now.',
    'zh-CN': '请在浏览器设置中重新开启相机权限。工作日的每一站都需要现场拍摄的照片。',
    vi: 'Hãy bật lại quyền truy cập máy ảnh trong cài đặt trình duyệt. Mỗi điểm dừng trong ngày làm việc cần một ảnh chụp ngay lúc đó.',
    id: 'Nyalakan lagi akses kamera di pengaturan browser. Perhentian hari kerja perlu foto yang diambil saat ini.',
    ko: '브라우저 설정에서 카메라 접근을 다시 켜세요. 근무일 정차 지점에는 지금 찍은 사진이 필요합니다.',
    it: "Riattiva l'accesso alla fotocamera nelle impostazioni del browser. Le soste della giornata di lavoro richiedono una foto scattata ora.",
    el: 'Ενεργοποίησε ξανά την πρόσβαση στην κάμερα στις ρυθμίσεις του προγράμματος περιήγησης. Οι στάσεις της εργάσιμης μέρας χρειάζονται φωτογραφία που τραβιέται τώρα.',
    hi: 'ब्राउज़र सेटिंग में कैमरा एक्सेस फिर से चालू करें। वर्कडे स्टॉप के लिए अभी ली गई फोटो चाहिए।',
    pa: 'ਬ੍ਰਾਊਜ਼ਰ ਸੈਟਿੰਗਾਂ ਵਿੱਚ ਕੈਮਰਾ ਐਕਸੈਸ ਮੁੜ ਚਾਲੂ ਕਰੋ। ਵਰਕਡੇ ਸਟਾਪ ਲਈ ਹੁਣੇ ਲਈ ਗਈ ਫੋਟੋ ਚਾਹੀਦੀ ਹੈ।',
  },
  // A stop's photo that came in through the camera input but wasn't taken
  // just now (File.lastModified more than 2 minutes old: a desktop file
  // chooser, or an Android chooser's Files or Gallery). Refused: each move
  // needs a fresh photo of the new sign (T6b item 6).
  'workday.scan.notFresh': {
    en: 'That photo wasn\'t taken just now. Workday stops need a photo of the sign taken now. Take a new one with the camera.',
    'zh-CN': '这张照片不是刚刚拍的。工作日的每一站都需要现场拍摄的标志照片。请用相机重新拍一张。',
    vi: 'Ảnh đó không phải vừa mới chụp. Mỗi điểm dừng trong ngày làm việc cần một ảnh biển báo chụp ngay lúc đó. Hãy chụp ảnh mới bằng máy ảnh.',
    id: 'Foto itu tidak baru saja diambil. Perhentian hari kerja perlu foto rambu yang diambil saat ini. Ambil foto baru dengan kamera.',
    ko: '그 사진은 방금 찍은 사진이 아닙니다. 근무일 정차 지점에는 지금 찍은 표지판 사진이 필요합니다. 카메라로 새로 찍으세요.',
    it: 'Quella foto non è stata scattata adesso. Le soste della giornata di lavoro richiedono una foto del cartello scattata ora. Scattane una nuova con la fotocamera.',
    el: 'Αυτή η φωτογραφία δεν τραβήχτηκε μόλις τώρα. Οι στάσεις της εργάσιμης μέρας χρειάζονται φωτογραφία της πινακίδας που τραβιέται τώρα. Τράβηξε μια νέα με την κάμερα.',
    hi: 'वह फोटो अभी-अभी नहीं ली गई थी। वर्कडे स्टॉप के लिए साइन की अभी ली गई फोटो चाहिए। कैमरे से नई फोटो लें।',
    pa: 'ਉਹ ਫੋਟੋ ਹੁਣੇ-ਹੁਣੇ ਨਹੀਂ ਲਈ ਗਈ ਸੀ। ਵਰਕਡੇ ਸਟਾਪ ਲਈ ਚਿੰਨ੍ਹ ਦੀ ਹੁਣੇ ਲਈ ਗਈ ਫੋਟੋ ਚਾਹੀਦੀ ਹੈ। ਕੈਮਰੇ ਨਾਲ ਨਵੀਂ ਫੋਟੋ ਲਓ।',
  },
  // ── Boundary question (T6b item 8), unit t6b-boundary-reminders ───────
  // The only step that may block a workday stop's Save. The en text of the
  // title, body, area text, options, footer, "new limit", "not sure",
  // deadline-passed and the two buttons is the spec's own (EXACT). Moving a
  // few bays doesn't restart a limit (r205(2), r332); under an area sign
  // the whole area counts (r335). Every answer is the driver's own
  // statement. hi and pa: no gendered first person (the car is the subject,
  // or an ergative verb that agrees with the object).
  'workday.boundary.title': {
    en: 'This may be the same signed stretch.',
    'zh-CN': '这可能是同一个标志适用的路段。',
    vi: 'Đây có thể vẫn là cùng một đoạn đường có biển báo.',
    id: 'Ini mungkin masih ruas jalan yang sama yang diatur rambu.',
    ko: '표지판이 적용되는 같은 구간일 수 있습니다.',
    it: 'Potrebbe essere lo stesso tratto indicato dal cartello.',
    el: 'Μπορεί να είναι το ίδιο τμήμα του δρόμου με την ίδια πινακίδα.',
    hi: 'हो सकता है यह सड़क का वही हिस्सा हो जिस पर वही साइन लागू होता है।',
    pa: 'ਹੋ ਸਕਦਾ ਹੈ ਇਹ ਸੜਕ ਦਾ ਉਹੀ ਹਿੱਸਾ ਹੋਵੇ ਜਿਸ ਉੱਤੇ ਉਹੀ ਚਿੰਨ੍ਹ ਲਾਗੂ ਹੁੰਦਾ ਹੈ।',
  },
  'workday.boundary.body': {
    en: "Moving bays doesn't restart the time limit. Did you pass one of these on the way here?",
    'zh-CN': '换车位不会让时限重新计时。你来这里的路上经过了下面哪一个?',
    vi: 'Dời sang chỗ đỗ khác không làm giới hạn thời gian bắt đầu lại. Trên đường đến đây, bạn có đi qua một trong những thứ này không?',
    id: 'Pindah petak parkir tidak membuat batas waktu dimulai ulang. Apakah kamu melewati salah satu dari ini dalam perjalanan ke sini?',
    ko: '다른 칸으로 옮기는 것만으로는 시간 제한이 다시 시작되지 않습니다. 여기로 오는 길에 다음 중 하나를 지나왔나요?',
    it: 'Cambiare posto non fa ripartire il limite di tempo. Venendo qui, hai superato uno di questi?',
    el: 'Η αλλαγή θέσης δεν ξαναρχίζει το χρονικό όριο. Πέρασες κάποιο από αυτά στον δρόμο για εδώ;',
    hi: 'पार्किंग जगह बदलने से समय सीमा फिर से शुरू नहीं होती। क्या यहाँ आते समय आपने इनमें से कोई चीज़ पार की?',
    pa: 'ਪਾਰਕਿੰਗ ਥਾਂ ਬਦਲਣ ਨਾਲ ਸਮਾਂ ਸੀਮਾ ਮੁੜ ਸ਼ੁਰੂ ਨਹੀਂ ਹੁੰਦੀ। ਕੀ ਇੱਥੇ ਆਉਂਦੇ ਸਮੇਂ ਤੁਸੀਂ ਇਨ੍ਹਾਂ ਵਿੱਚੋਂ ਕੋਈ ਚੀਜ਼ ਪਾਰ ਕੀਤੀ?',
  },
  // Area mode, in place of the title and body (r335).
  'workday.boundary.area': {
    en: "This is a parking area. Moving to another street inside it doesn't count. You need to leave the whole area.",
    'zh-CN': '这里是停车区域。换到区域内的另一条街不算。你需要离开整个区域。',
    vi: 'Đây là khu vực đỗ xe. Chuyển sang một con đường khác trong khu vực không được tính. Bạn cần rời khỏi toàn bộ khu vực.',
    id: 'Ini area parkir. Pindah ke jalan lain di dalamnya tidak dihitung. Kamu harus meninggalkan seluruh area.',
    ko: '이곳은 주차 구역입니다. 구역 안의 다른 거리로 옮기는 것은 해당되지 않습니다. 구역 전체를 벗어나야 합니다.',
    it: "Questa è un'area di parcheggio. Spostarti in un'altra via al suo interno non conta. Devi lasciare tutta l'area.",
    el: 'Αυτή είναι περιοχή στάθμευσης. Η μετακίνηση σε άλλο δρόμο μέσα σε αυτήν δεν μετράει. Πρέπει να φύγεις από όλη την περιοχή.',
    hi: 'यह एक पार्किंग क्षेत्र है। इसके अंदर किसी दूसरी सड़क पर जाना नहीं गिना जाता। आपको पूरा क्षेत्र छोड़ना होगा।',
    pa: 'ਇਹ ਇੱਕ ਪਾਰਕਿੰਗ ਖੇਤਰ ਹੈ। ਇਸਦੇ ਅੰਦਰ ਕਿਸੇ ਹੋਰ ਸੜਕ ਉੱਤੇ ਜਾਣਾ ਨਹੀਂ ਗਿਣਿਆ ਜਾਂਦਾ। ਤੁਹਾਨੂੰ ਪੂਰਾ ਖੇਤਰ ਛੱਡਣਾ ਪਵੇਗਾ।',
  },
  'workday.boundary.option.oppositeDirectionSign': {
    en: "A sign showing this zone had ended (a two-way arrow sign in the middle of the block doesn't count)",
    'zh-CN': '一个表示该区段已结束的标志(街区中间的双向箭头标志不算)',
    vi: 'Một biển báo cho thấy đoạn đường này đã kết thúc (biển báo mũi tên hai chiều ở giữa dãy nhà không được tính)',
    id: 'Rambu yang menunjukkan zona ini sudah berakhir (rambu panah dua arah di tengah blok tidak dihitung)',
    ko: '이 구간이 끝났음을 보여 주는 표지판 (블록 중간에 있는 양방향 화살표 표지판은 해당되지 않음)',
    it: 'Un cartello che indicava la fine di questa zona (un cartello con freccia a doppio senso a metà isolato non conta)',
    el: 'Μια πινακίδα που έδειχνε ότι η ζώνη τελείωσε (μια πινακίδα με βέλος διπλής κατεύθυνσης στη μέση του τετραγώνου δεν μετράει)',
    hi: 'एक साइन जिससे पता चलता था कि यह ज़ोन खत्म हो गया (ब्लॉक के बीच में दोनों तरफ़ तीर वाला साइन नहीं गिना जाता)',
    pa: 'ਇੱਕ ਚਿੰਨ੍ਹ ਜਿਸ ਤੋਂ ਪਤਾ ਲੱਗਦਾ ਸੀ ਕਿ ਇਹ ਜ਼ੋਨ ਖ਼ਤਮ ਹੋ ਗਿਆ (ਬਲਾਕ ਦੇ ਵਿਚਕਾਰ ਦੋਹਾਂ ਪਾਸੇ ਤੀਰ ਵਾਲਾ ਚਿੰਨ੍ਹ ਨਹੀਂ ਗਿਣਿਆ ਜਾਂਦਾ)',
  },
  'workday.boundary.option.yellowEdgeLine': {
    en: 'A yellow edge line',
    'zh-CN': '一条黄色边线',
    vi: 'Một vạch vàng ở mép đường',
    id: 'Garis tepi kuning',
    ko: '노란색 가장자리 선',
    it: 'Una linea gialla sul bordo della strada',
    el: 'Μια κίτρινη γραμμή στην άκρη του δρόμου',
    hi: 'सड़क के किनारे पीली रेखा',
    pa: 'ਸੜਕ ਦੇ ਕਿਨਾਰੇ ਪੀਲੀ ਲਕੀਰ',
  },
  'workday.boundary.option.tIntersectionOrDeadEnd': {
    en: 'The end of the road at a T-intersection or dead end',
    'zh-CN': '道路在丁字路口或尽头路处的尽头',
    vi: 'Điểm cuối con đường tại ngã ba chữ T hoặc đường cụt',
    id: 'Ujung jalan di pertigaan T atau jalan buntu',
    ko: 'T자형 교차로나 막다른 길에서 끝나는 도로의 끝',
    it: 'La fine della strada a un incrocio a T o in una strada senza uscita',
    el: 'Το τέλος του δρόμου σε διασταύρωση σε σχήμα Τ ή σε αδιέξοδο',
    hi: 'T-चौराहे या बंद सड़क पर सड़क का अंत',
    pa: 'T-ਚੌਰਾਹੇ ਜਾਂ ਬੰਦ ਸੜਕ ਉੱਤੇ ਸੜਕ ਦਾ ਅੰਤ',
  },
  'workday.boundary.option.leftParkingArea': {
    en: 'I drove out of the parking area, past a sign saying it ends',
    'zh-CN': '我把车开出了停车区域,经过了表示区域结束的标志',
    vi: 'Tôi đã lái xe ra khỏi khu vực đỗ xe, qua một biển báo cho biết khu vực kết thúc',
    id: 'Saya mengemudi keluar dari area parkir, melewati rambu yang menyatakan area itu berakhir',
    ko: '구역이 끝난다는 표지판을 지나 주차 구역 밖으로 운전해 나왔습니다',
    it: "L'auto è uscita dall'area di parcheggio, oltre un cartello che ne indica la fine",
    el: 'Το αυτοκίνητο βγήκε από την περιοχή στάθμευσης, περνώντας μια πινακίδα που λέει ότι τελειώνει',
    hi: 'गाड़ी पार्किंग क्षेत्र से बाहर गई, उस साइन के आगे जो बताता है कि क्षेत्र खत्म होता है',
    pa: 'ਕਾਰ ਪਾਰਕਿੰਗ ਖੇਤਰ ਤੋਂ ਬਾਹਰ ਗਈ, ਉਸ ਚਿੰਨ੍ਹ ਤੋਂ ਅੱਗੇ ਜੋ ਦੱਸਦਾ ਹੈ ਕਿ ਖੇਤਰ ਖ਼ਤਮ ਹੁੰਦਾ ਹੈ',
  },
  'workday.boundary.option.notSure': {
    en: "I'm not sure",
    'zh-CN': '我不确定',
    vi: 'Tôi không chắc',
    id: 'Saya tidak yakin',
    ko: '잘 모르겠습니다',
    it: 'Non lo so con certezza',
    el: 'Δεν το ξέρω με βεβαιότητα',
    hi: 'मुझे पक्का नहीं पता',
    pa: 'ਮੈਨੂੰ ਪੱਕਾ ਨਹੀਂ ਪਤਾ',
  },
  'workday.boundary.footer': {
    en: "If you're not sure, your original time limit is still running.",
    'zh-CN': '如果你不确定,原来的时限仍在计算。',
    vi: 'Nếu bạn không chắc, giới hạn thời gian ban đầu của bạn vẫn đang tính.',
    id: 'Kalau kamu tidak yakin, batas waktu awalmu masih berjalan.',
    ko: '잘 모르겠다면 처음의 시간 제한이 계속 적용되고 있습니다.',
    it: 'Se non lo sai con certezza, il tuo limite di tempo iniziale continua a valere.',
    el: 'Αν δεν το ξέρεις με βεβαιότητα, το αρχικό χρονικό όριο εξακολουθεί να μετράει.',
    hi: 'अगर आपको पक्का नहीं पता, तो आपकी पहली समय सीमा अब भी चल रही है।',
    pa: 'ਜੇ ਤੁਹਾਨੂੰ ਪੱਕਾ ਨਹੀਂ ਪਤਾ, ਤਾਂ ਤੁਹਾਡੀ ਪਹਿਲੀ ਸਮਾਂ ਸੀਮਾ ਹਾਲੇ ਵੀ ਚੱਲ ਰਹੀ ਹੈ।',
  },
  // Save was tapped without an answer.
  'workday.boundary.required': {
    en: 'Choose an answer to save this stop.',
    'zh-CN': '请选择一个答案以保存这一站。',
    vi: 'Hãy chọn một câu trả lời để lưu điểm dừng này.',
    id: 'Pilih satu jawaban untuk menyimpan perhentian ini.',
    ko: '이 정차 지점을 저장하려면 답을 하나 고르세요.',
    it: 'Scegli una risposta per salvare questa sosta.',
    el: 'Διάλεξε μια απάντηση για να αποθηκευτεί αυτή η στάση.',
    hi: 'इस स्टॉप को सेव करने के लिए एक जवाब चुनें।',
    pa: 'ਇਸ ਸਟਾਪ ਨੂੰ ਸੇਵ ਕਰਨ ਲਈ ਇੱਕ ਜਵਾਬ ਚੁਣੋ।',
  },
  // After a boundary answer. {{boundary}} is one of workday.boundary.passed.*.
  'workday.boundary.newLimit': {
    en: 'New limit based on what you told us: you passed {{boundary}}.',
    'zh-CN': '根据你告诉我们的情况得出的新时限:你经过了{{boundary}}。',
    vi: 'Giới hạn mới dựa trên những gì bạn cho chúng tôi biết: bạn đã đi qua {{boundary}}.',
    id: 'Batas baru berdasarkan yang kamu sampaikan: kamu melewati {{boundary}}.',
    ko: '알려 주신 내용에 따른 새 제한입니다. 지나온 것: {{boundary}}.',
    it: 'Nuovo limite in base a quello che ci hai detto: hai superato {{boundary}}.',
    el: 'Νέο όριο με βάση όσα μας είπες: πέρασες {{boundary}}.',
    hi: 'आपकी बताई बात के आधार पर नई सीमा: आपने बताया कि आपने यह पार किया: {{boundary}}।',
    pa: 'ਤੁਹਾਡੀ ਦੱਸੀ ਗੱਲ ਦੇ ਆਧਾਰ ਉੱਤੇ ਨਵੀਂ ਸੀਮਾ: ਤੁਸੀਂ ਦੱਸਿਆ ਕਿ ਤੁਸੀਂ ਇਹ ਪਾਰ ਕੀਤਾ: {{boundary}}।',
  },
  'workday.boundary.passed.oppositeDirectionSign': {
    en: 'a sign showing this zone had ended',
    'zh-CN': '一个表示该区段已结束的标志',
    vi: 'một biển báo cho thấy đoạn đường này đã kết thúc',
    id: 'rambu yang menunjukkan zona ini sudah berakhir',
    ko: '이 구간이 끝났음을 보여 주는 표지판',
    it: 'un cartello che indicava la fine di questa zona',
    el: 'μια πινακίδα που έδειχνε ότι η ζώνη τελείωσε',
    hi: 'एक साइन जिससे पता चलता था कि यह ज़ोन खत्म हो गया',
    pa: 'ਇੱਕ ਚਿੰਨ੍ਹ ਜਿਸ ਤੋਂ ਪਤਾ ਲੱਗਦਾ ਸੀ ਕਿ ਇਹ ਜ਼ੋਨ ਖ਼ਤਮ ਹੋ ਗਿਆ',
  },
  'workday.boundary.passed.yellowEdgeLine': {
    en: 'a yellow edge line',
    'zh-CN': '一条黄色边线',
    vi: 'một vạch vàng ở mép đường',
    id: 'garis tepi kuning',
    ko: '노란색 가장자리 선',
    it: 'una linea gialla sul bordo della strada',
    el: 'μια κίτρινη γραμμή στην άκρη του δρόμου',
    hi: 'सड़क के किनारे पीली रेखा',
    pa: 'ਸੜਕ ਦੇ ਕਿਨਾਰੇ ਪੀਲੀ ਲਕੀਰ',
  },
  'workday.boundary.passed.tIntersectionOrDeadEnd': {
    en: 'the end of the road at a T-intersection or dead end',
    'zh-CN': '道路在丁字路口或尽头路处的尽头',
    vi: 'điểm cuối con đường tại ngã ba chữ T hoặc đường cụt',
    id: 'ujung jalan di pertigaan T atau jalan buntu',
    ko: 'T자형 교차로나 막다른 길에서 끝나는 도로의 끝',
    it: 'la fine della strada a un incrocio a T o in una strada senza uscita',
    el: 'το τέλος του δρόμου σε διασταύρωση σε σχήμα Τ ή σε αδιέξοδο',
    hi: 'T-चौराहे या बंद सड़क पर सड़क का अंत',
    pa: 'T-ਚੌਰਾਹੇ ਜਾਂ ਬੰਦ ਸੜਕ ਉੱਤੇ ਸੜਕ ਦਾ ਅੰਤ',
  },
  'workday.boundary.passed.leftParkingArea': {
    en: 'a sign saying the parking area ends',
    'zh-CN': '一个表示停车区域结束的标志',
    vi: 'một biển báo cho biết khu vực đỗ xe kết thúc',
    id: 'rambu yang menyatakan area parkir berakhir',
    ko: '주차 구역이 끝난다는 표지판',
    it: "un cartello che indica la fine dell'area di parcheggio",
    el: 'μια πινακίδα που λέει ότι η περιοχή στάθμευσης τελειώνει',
    hi: 'एक साइन जो बताता है कि पार्किंग क्षेत्र खत्म होता है',
    pa: 'ਇੱਕ ਚਿੰਨ੍ਹ ਜੋ ਦੱਸਦਾ ਹੈ ਕਿ ਪਾਰਕਿੰਗ ਖੇਤਰ ਖ਼ਤਮ ਹੁੰਦਾ ਹੈ',
  },
  // After "I'm not sure": the original limit keeps running. {{start}} is when
  // it started (the logged time of the stop that started it), {{deadline}}
  // when it ends, both absolute times in the stop's zone.
  'workday.boundary.notSure': {
    en: 'Your limit on this stretch still runs from {{start}}. Move the car off this stretch by {{deadline}}.',
    'zh-CN': '你在此路段的时限仍从 {{start}} 起计算。请在 {{deadline}} 前把车开出该路段。',
    vi: 'Giới hạn của bạn trên đoạn đường này vẫn tính từ {{start}}. Hãy dời xe ra khỏi đoạn đường này trước {{deadline}}.',
    id: 'Batas waktumu di ruas jalan ini masih dihitung sejak {{start}}. Pindahkan mobil keluar dari ruas jalan ini sebelum {{deadline}}.',
    ko: '이 구간의 제한 시간은 여전히 {{start}}부터 계산됩니다. {{deadline}}까지 이 구간 밖으로 차를 옮기세요.',
    it: "Il tuo limite su questo tratto continua a contare dalle {{start}}. Sposta l'auto fuori da questo tratto entro le {{deadline}}.",
    el: 'Το όριό σου σε αυτό το τμήμα του δρόμου μετράει ακόμα από τις {{start}}. Μετακίνησε το αυτοκίνητο έξω από αυτό το τμήμα ως τις {{deadline}}.',
    hi: 'सड़क के इस हिस्से पर आपकी सीमा अब भी {{start}} से चल रही है। {{deadline}} तक गाड़ी को सड़क के इस हिस्से से बाहर ले जाएं।',
    pa: 'ਸੜਕ ਦੇ ਇਸ ਹਿੱਸੇ ਉੱਤੇ ਤੁਹਾਡੀ ਸੀਮਾ ਹਾਲੇ ਵੀ {{start}} ਤੋਂ ਚੱਲ ਰਹੀ ਹੈ। {{deadline}} ਤੱਕ ਕਾਰ ਨੂੰ ਸੜਕ ਦੇ ਇਸ ਹਿੱਸੇ ਤੋਂ ਬਾਹਰ ਲੈ ਜਾਓ।',
  },
  // Not the spec's wording: the same under an area limit, so the driver is
  // never told a stretch when the whole area counts (r335).
  'workday.boundary.notSureArea': {
    en: 'Your limit in this parking area still runs from {{start}}. Move the car out of the whole area by {{deadline}}.',
    'zh-CN': '你在此停车区域的时限仍从 {{start}} 起计算。请在 {{deadline}} 前把车开出整个区域。',
    vi: 'Giới hạn của bạn trong khu vực đỗ xe này vẫn tính từ {{start}}. Hãy dời xe ra khỏi toàn bộ khu vực trước {{deadline}}.',
    id: 'Batas waktumu di area parkir ini masih dihitung sejak {{start}}. Pindahkan mobil keluar dari seluruh area sebelum {{deadline}}.',
    ko: '이 주차 구역의 제한 시간은 여전히 {{start}}부터 계산됩니다. {{deadline}}까지 구역 전체 밖으로 차를 옮기세요.',
    it: "Il tuo limite in quest'area di parcheggio continua a contare dalle {{start}}. Sposta l'auto fuori da tutta l'area entro le {{deadline}}.",
    el: 'Το όριό σου σε αυτή την περιοχή στάθμευσης μετράει ακόμα από τις {{start}}. Μετακίνησε το αυτοκίνητο έξω από όλη την περιοχή ως τις {{deadline}}.',
    hi: 'इस पार्किंग क्षेत्र में आपकी सीमा अब भी {{start}} से चल रही है। {{deadline}} तक गाड़ी को पूरे क्षेत्र से बाहर ले जाएं।',
    pa: 'ਇਸ ਪਾਰਕਿੰਗ ਖੇਤਰ ਵਿੱਚ ਤੁਹਾਡੀ ਸੀਮਾ ਹਾਲੇ ਵੀ {{start}} ਤੋਂ ਚੱਲ ਰਹੀ ਹੈ। {{deadline}} ਤੱਕ ਕਾਰ ਨੂੰ ਪੂਰੇ ਖੇਤਰ ਤੋਂ ਬਾਹਰ ਲੈ ਜਾਓ।',
  },
  // Not the spec's wording: "not sure" when the running limit has no end
  // time the app can name (the stop before it had no limit time).
  'workday.boundary.notSureNoDeadline': {
    en: 'Your limit on this stretch still runs from {{start}}.',
    'zh-CN': '你在此路段的时限仍从 {{start}} 起计算。',
    vi: 'Giới hạn của bạn trên đoạn đường này vẫn tính từ {{start}}.',
    id: 'Batas waktumu di ruas jalan ini masih dihitung sejak {{start}}.',
    ko: '이 구간의 제한 시간은 여전히 {{start}}부터 계산됩니다.',
    it: 'Il tuo limite su questo tratto continua a contare dalle {{start}}.',
    el: 'Το όριό σου σε αυτό το τμήμα του δρόμου μετράει ακόμα από τις {{start}}.',
    hi: 'सड़क के इस हिस्से पर आपकी सीमा अब भी {{start}} से चल रही है।',
    pa: 'ਸੜਕ ਦੇ ਇਸ ਹਿੱਸੇ ਉੱਤੇ ਤੁਹਾਡੀ ਸੀਮਾ ਹਾਲੇ ਵੀ {{start}} ਤੋਂ ਚੱਲ ਰਹੀ ਹੈ।',
  },
  'workday.boundary.notSureNoDeadlineArea': {
    en: 'Your limit in this parking area still runs from {{start}}.',
    'zh-CN': '你在此停车区域的时限仍从 {{start}} 起计算。',
    vi: 'Giới hạn của bạn trong khu vực đỗ xe này vẫn tính từ {{start}}.',
    id: 'Batas waktumu di area parkir ini masih dihitung sejak {{start}}.',
    ko: '이 주차 구역의 제한 시간은 여전히 {{start}}부터 계산됩니다.',
    it: "Il tuo limite in quest'area di parcheggio continua a contare dalle {{start}}.",
    el: 'Το όριό σου σε αυτή την περιοχή στάθμευσης μετράει ακόμα από τις {{start}}.',
    hi: 'इस पार्किंग क्षेत्र में आपकी सीमा अब भी {{start}} से चल रही है।',
    pa: 'ਇਸ ਪਾਰਕਿੰਗ ਖੇਤਰ ਵਿੱਚ ਤੁਹਾਡੀ ਸੀਮਾ ਹਾਲੇ ਵੀ {{start}} ਤੋਂ ਚੱਲ ਰਹੀ ਹੈ।',
  },
  // "Not sure" after the running limit has already ended: only "Save
  // anyway" and "Don't save this stop" are offered.
  'workday.boundary.passedDeadline': {
    en: 'Your time on this stretch ended at {{time}}. Move the car off this stretch now.',
    'zh-CN': '你在此路段的停车时间已于 {{time}} 结束。请现在就把车开出该路段。',
    vi: 'Thời gian của bạn trên đoạn đường này đã kết thúc lúc {{time}}. Hãy dời xe ra khỏi đoạn đường này ngay bây giờ.',
    id: 'Waktumu di ruas jalan ini sudah berakhir pukul {{time}}. Pindahkan mobil keluar dari ruas jalan ini sekarang.',
    ko: '이 구간에서의 주차 시간이 {{time}}에 끝났습니다. 지금 이 구간 밖으로 차를 옮기세요.',
    it: "Il tuo tempo su questo tratto è scaduto alle {{time}}. Sposta l'auto fuori da questo tratto adesso.",
    el: 'Ο χρόνος σου σε αυτό το τμήμα του δρόμου έληξε στις {{time}}. Μετακίνησε το αυτοκίνητο έξω από αυτό το τμήμα τώρα.',
    hi: 'सड़क के इस हिस्से पर आपका समय {{time}} पर खत्म हो गया। गाड़ी को अभी सड़क के इस हिस्से से बाहर ले जाएं।',
    pa: 'ਸੜਕ ਦੇ ਇਸ ਹਿੱਸੇ ਉੱਤੇ ਤੁਹਾਡਾ ਸਮਾਂ {{time}} ਉੱਤੇ ਖ਼ਤਮ ਹੋ ਗਿਆ। ਕਾਰ ਨੂੰ ਹੁਣੇ ਸੜਕ ਦੇ ਇਸ ਹਿੱਸੇ ਤੋਂ ਬਾਹਰ ਲੈ ਜਾਓ।',
  },
  // Not the spec's wording: the same under an area limit (r335).
  'workday.boundary.passedDeadlineArea': {
    en: 'Your time in this parking area ended at {{time}}. Move the car out of the whole area now.',
    'zh-CN': '你在此停车区域的停车时间已于 {{time}} 结束。请现在就把车开出整个区域。',
    vi: 'Thời gian của bạn trong khu vực đỗ xe này đã kết thúc lúc {{time}}. Hãy dời xe ra khỏi toàn bộ khu vực ngay bây giờ.',
    id: 'Waktumu di area parkir ini sudah berakhir pukul {{time}}. Pindahkan mobil keluar dari seluruh area sekarang.',
    ko: '이 주차 구역에서의 주차 시간이 {{time}}에 끝났습니다. 지금 구역 전체 밖으로 차를 옮기세요.',
    it: "Il tuo tempo in quest'area di parcheggio è scaduto alle {{time}}. Sposta l'auto fuori da tutta l'area adesso.",
    el: 'Ο χρόνος σου σε αυτή την περιοχή στάθμευσης έληξε στις {{time}}. Μετακίνησε το αυτοκίνητο έξω από όλη την περιοχή τώρα.',
    hi: 'इस पार्किंग क्षेत्र में आपका समय {{time}} पर खत्म हो गया। गाड़ी को अभी पूरे क्षेत्र से बाहर ले जाएं।',
    pa: 'ਇਸ ਪਾਰਕਿੰਗ ਖੇਤਰ ਵਿੱਚ ਤੁਹਾਡਾ ਸਮਾਂ {{time}} ਉੱਤੇ ਖ਼ਤਮ ਹੋ ਗਿਆ। ਕਾਰ ਨੂੰ ਹੁਣੇ ਪੂਰੇ ਖੇਤਰ ਤੋਂ ਬਾਹਰ ਲੈ ਜਾਓ।',
  },
  'workday.boundary.saveAnyway': {
    en: 'Save anyway',
    'zh-CN': '仍然保存',
    vi: 'Vẫn lưu',
    id: 'Tetap simpan',
    ko: '그래도 저장',
    it: 'Salva comunque',
    el: 'Αποθήκευση έτσι κι αλλιώς',
    hi: 'फिर भी सेव करें',
    pa: 'ਫਿਰ ਵੀ ਸੇਵ ਕਰੋ',
  },
  // Deletes the stop being logged and its photos. Nothing is signed.
  'workday.boundary.dontSave': {
    en: "Don't save this stop",
    'zh-CN': '不保存这一站',
    vi: 'Không lưu điểm dừng này',
    id: 'Jangan simpan perhentian ini',
    ko: '이 정차 지점 저장하지 않기',
    it: 'Non salvare questa sosta',
    el: 'Να μην αποθηκευτεί αυτή η στάση',
    hi: 'यह स्टॉप सेव न करें',
    pa: 'ਇਹ ਸਟਾਪ ਸੇਵ ਨਾ ਕਰੋ',
  },
  // ── Stop reminders on the home card (T6b item 9) ──────────────────────
  // Set when a stop is saved (no reminder screen). Shown when setting them
  // didn't reach the push service; a Retry button follows. The booked times
  // reuse reminders.remindMe.setBackground, and the reliability line is
  // reminders.reliability.
  'workday.reminders.notSet': {
    en: "Reminders for this stop couldn't be set up. Watch the time yourself, or try again.",
    'zh-CN': '这一站的提醒未能设置。请自己留意时间,或再试一次。',
    vi: 'Không thể thiết lập lời nhắc cho điểm dừng này. Hãy tự theo dõi thời gian, hoặc thử lại.',
    id: 'Pengingat untuk perhentian ini tidak bisa diatur. Perhatikan waktunya sendiri, atau coba lagi.',
    ko: '이 정차 지점의 알림을 설정하지 못했습니다. 시간을 직접 확인하거나 다시 시도하세요.',
    it: "Non è stato possibile impostare i promemoria per questa sosta. Tieni d'occhio l'ora o riprova.",
    el: 'Δεν ήταν δυνατό να οριστούν υπενθυμίσεις για αυτή τη στάση. Πρόσεχε την ώρα εσύ ή δοκίμασε ξανά.',
    hi: 'इस स्टॉप के रिमाइंडर सेट नहीं हो सके। समय पर खुद नज़र रखें, या फिर से कोशिश करें।',
    pa: 'ਇਸ ਸਟਾਪ ਦੇ ਰਿਮਾਈਂਡਰ ਸੈੱਟ ਨਹੀਂ ਹੋ ਸਕੇ। ਸਮੇਂ ਉੱਤੇ ਆਪ ਨਜ਼ਰ ਰੱਖੋ, ਜਾਂ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।',
  },
  // ── The workday record PDF (T6c) ─────────────────────────────────────
  // The workday view's button that opens the leg picker.
  'workday.pdf.open': {
    en: 'Export a PDF of this workday',
    'zh-CN': '导出此工作日的 PDF',
    vi: 'Xuất PDF của ngày làm việc này',
    id: 'Ekspor PDF hari kerja ini',
    ko: '이 근무일의 PDF 내보내기',
    it: 'Esporta un PDF di questa giornata di lavoro',
    el: 'Εξαγωγή PDF αυτής της εργάσιμης μέρας',
    hi: 'इस वर्कडे का PDF एक्सपोर्ट करें',
    pa: 'ਇਸ ਵਰਕਡੇ ਦੀ PDF ਐਕਸਪੋਰਟ ਕਰੋ',
  },
  'workday.pdf.title': {
    en: 'Workday PDF',
    'zh-CN': '工作日 PDF',
    vi: 'PDF ngày làm việc',
    id: 'PDF hari kerja',
    ko: '근무일 PDF',
    it: 'PDF della giornata di lavoro',
    el: 'PDF εργάσιμης μέρας',
    hi: 'वर्कडे PDF',
    pa: 'ਵਰਕਡੇ PDF',
  },
  // Spec wording (T6c item 1), shown above the leg picker before export.
  'workday.pdf.warning': {
    en: 'This PDF includes every leg you choose, with distances between them and what you told us at each move. Councils can read it.',
    'zh-CN': '这份 PDF 包含你选择的每一站,以及各站之间的距离和你在每次挪车时告诉我们的内容。市议会可以阅读它。',
    vi: 'PDF này gồm mọi điểm dừng bạn chọn, kèm khoảng cách giữa chúng và những gì bạn đã cho chúng tôi biết ở mỗi lần dời xe. Hội đồng địa phương có thể đọc nó.',
    id: 'PDF ini memuat setiap perhentian yang kamu pilih, beserta jarak di antaranya dan apa yang kamu sampaikan kepada kami di setiap pindah. Dewan kota bisa membacanya.',
    ko: '이 PDF에는 선택한 모든 정차 지점과 그 사이의 거리, 그리고 차를 옮길 때마다 알려 주신 내용이 들어 있습니다. 의회가 이 PDF를 읽을 수 있습니다.',
    it: 'Questo PDF include ogni sosta che scegli, con le distanze tra le soste e quello che ci hai detto a ogni spostamento. Il comune può leggerlo.',
    el: 'Αυτό το PDF περιέχει κάθε στάση που επιλέγεις, με τις αποστάσεις ανάμεσά τους και όσα μας είπες σε κάθε μετακίνηση. Ο δήμος μπορεί να το διαβάσει.',
    hi: 'इस PDF में आपके चुने हर स्टॉप, उनके बीच की दूरी, और हर बार गाड़ी हटाते समय आपने हमें जो बताया, वह शामिल है। परिषद इसे पढ़ सकती है।',
    pa: 'ਇਸ PDF ਵਿੱਚ ਤੁਹਾਡਾ ਚੁਣਿਆ ਹਰ ਸਟਾਪ, ਉਹਨਾਂ ਵਿਚਕਾਰ ਦੂਰੀ, ਅਤੇ ਹਰ ਵਾਰ ਕਾਰ ਹਟਾਉਂਦੇ ਸਮੇਂ ਤੁਸੀਂ ਸਾਨੂੰ ਜੋ ਦੱਸਿਆ, ਉਹ ਸ਼ਾਮਲ ਹੈ। ਕੌਂਸਲ ਇਸਨੂੰ ਪੜ੍ਹ ਸਕਦੀ ਹੈ।',
  },
  'workday.pdf.chooseLegs': {
    en: 'Legs to include',
    'zh-CN': '要包含的站',
    vi: 'Các điểm dừng cần đưa vào',
    id: 'Perhentian yang disertakan',
    ko: '포함할 정차 지점',
    it: 'Soste da includere',
    el: 'Στάσεις που θα περιλαμβάνει',
    hi: 'शामिल करने वाले स्टॉप',
    pa: 'ਸ਼ਾਮਲ ਕਰਨ ਵਾਲੇ ਸਟਾਪ',
  },
  // One leg in the picker. "Leg" is the spec's word (T6c); the other
  // locales use their word for a workday stop, so a leg never reads as a
  // signed stretch.
  'workday.pdf.leg': {
    en: 'Leg {{number}}',
    'zh-CN': '第 {{number}} 站',
    vi: 'Điểm dừng {{number}}',
    id: 'Perhentian {{number}}',
    ko: '정차 지점 {{number}}',
    it: 'Sosta {{number}}',
    el: 'Στάση {{number}}',
    hi: 'स्टॉप {{number}}',
    pa: 'ਸਟਾਪ {{number}}',
  },
  'workday.pdf.noneChosen': {
    en: 'Choose at least one leg to export.',
    'zh-CN': '请至少选择一站来导出。',
    vi: 'Hãy chọn ít nhất một điểm dừng để xuất.',
    id: 'Pilih setidaknya satu perhentian untuk diekspor.',
    ko: '내보낼 정차 지점을 하나 이상 선택하세요.',
    it: 'Scegli almeno una sosta da esportare.',
    el: 'Επίλεξε τουλάχιστον μία στάση για εξαγωγή.',
    hi: 'एक्सपोर्ट करने के लिए कम से कम एक स्टॉप चुनें।',
    pa: 'ਐਕਸਪੋਰਟ ਕਰਨ ਲਈ ਘੱਟੋ-ਘੱਟ ਇੱਕ ਸਟਾਪ ਚੁਣੋ।',
  },
  // ── The PDF itself. pdf.* keys: pdf-font-coverage.test.ts checks every
  // character against the locale's PDF font subset.
  // Spec wording (T6c item 2): the title on page 1 and the running header.
  'pdf.workday.title': {
    en: 'Record of parking events.',
    'zh-CN': '停车事件记录。',
    vi: 'Bản ghi các lần đỗ xe.',
    id: 'Catatan peristiwa parkir.',
    ko: '주차 이벤트 기록.',
    it: 'Registro degli eventi di parcheggio.',
    el: 'Καταγραφή συμβάντων στάθμευσης.',
    hi: 'पार्किंग घटनाओं का रिकॉर्ड।',
    pa: 'ਪਾਰਕਿੰਗ ਘਟਨਾਵਾਂ ਦਾ ਰਿਕਾਰਡ।',
  },
  // Spec wording (T6c item 2): the footer on every page.
  'pdf.workday.footer': {
    en: 'This records what you did and what you told us. It is not a legal finding that you complied. Your council decides that.',
    'zh-CN': '本记录记下的是你做了什么以及你告诉我们的内容。它不是关于你遵守了规定的法律认定。这由你所在的市议会决定。',
    vi: 'Bản ghi này ghi lại những gì bạn đã làm và những gì bạn đã cho chúng tôi biết. Đây không phải là kết luận pháp lý rằng bạn đã tuân thủ quy định. Việc đó do hội đồng địa phương của bạn quyết định.',
    id: 'Catatan ini merekam apa yang kamu lakukan dan apa yang kamu sampaikan kepada kami. Ini bukan putusan hukum bahwa kamu sudah mematuhi aturan. Dewan kotamu yang memutuskannya.',
    ko: '이 기록에는 한 일과 저희에게 알려 준 내용이 담겨 있습니다. 규정을 지켰다는 법적 판단이 아닙니다. 그 판단은 관할 의회가 내립니다.',
    it: 'Questo registra ciò che hai fatto e ciò che ci hai detto. Non è un accertamento legale che hai rispettato le regole. Lo decide il tuo comune.',
    el: 'Αυτό καταγράφει τι έκανες και τι μας είπες. Δεν αποτελεί νομική κρίση ότι τήρησες τους κανόνες. Αυτό το αποφασίζει ο δήμος σου.',
    hi: 'यह रिकॉर्ड बताता है कि आपने क्या किया और हमें क्या बताया। यह कोई कानूनी निर्णय नहीं है कि आपने नियमों का पालन किया। यह आपकी परिषद तय करती है।',
    pa: 'ਇਹ ਰਿਕਾਰਡ ਦੱਸਦਾ ਹੈ ਕਿ ਤੁਸੀਂ ਕੀ ਕੀਤਾ ਅਤੇ ਸਾਨੂੰ ਕੀ ਦੱਸਿਆ। ਇਹ ਕੋਈ ਕਾਨੂੰਨੀ ਫ਼ੈਸਲਾ ਨਹੀਂ ਕਿ ਤੁਸੀਂ ਨਿਯਮਾਂ ਦੀ ਪਾਲਣਾ ਕੀਤੀ। ਇਹ ਫ਼ੈਸਲਾ ਤੁਹਾਡੀ ਕੌਂਸਲ ਕਰਦੀ ਹੈ।',
  },
  // Spec wording (T6c item 4): on every leg's rule sheet, above its table.
  'pdf.workday.councilLine': {
    en: "Councils may interpret this rule more strictly. Check your council's parking page.",
    'zh-CN': '市议会对这条规定的解释可能更严格。请查看你所在市议会的停车页面。',
    vi: 'Hội đồng địa phương có thể diễn giải quy định này nghiêm ngặt hơn. Hãy xem trang về đỗ xe của hội đồng địa phương nơi bạn ở.',
    id: 'Dewan kota bisa menafsirkan aturan ini dengan lebih ketat. Cek halaman parkir dewan kotamu.',
    ko: '의회는 이 규칙을 더 엄격하게 해석할 수 있습니다. 관할 의회의 주차 안내 페이지를 확인하세요.',
    it: 'I comuni possono interpretare questa regola in modo più severo. Controlla la pagina sul parcheggio del tuo comune.',
    el: 'Οι δήμοι μπορεί να ερμηνεύουν αυτόν τον κανόνα πιο αυστηρά. Δες τη σελίδα στάθμευσης του δήμου σου.',
    hi: 'परिषदें इस नियम को और सख्ती से समझ सकती हैं। अपनी परिषद का पार्किंग पेज देखें।',
    pa: 'ਕੌਂਸਲਾਂ ਇਸ ਨਿਯਮ ਨੂੰ ਹੋਰ ਸਖ਼ਤੀ ਨਾਲ ਸਮਝ ਸਕਦੀਆਂ ਹਨ। ਆਪਣੀ ਕੌਂਸਲ ਦਾ ਪਾਰਕਿੰਗ ਪੰਨਾ ਦੇਖੋ।',
  },
  'pdf.workday.started': {
    en: 'Workday started {{time}} (phone clock)',
    'zh-CN': '工作日开始于 {{time}}(手机时钟)',
    vi: 'Ngày làm việc bắt đầu {{time}} (đồng hồ điện thoại)',
    id: 'Hari kerja dimulai {{time}} (jam ponsel)',
    ko: '근무일 시작 {{time}} (휴대폰 시계)',
    it: 'Giornata di lavoro iniziata {{time}} (orologio del telefono)',
    el: 'Η εργάσιμη μέρα ξεκίνησε {{time}} (ρολόι κινητού)',
    hi: 'वर्कडे {{time}} पर शुरू हुआ (फ़ोन की घड़ी)',
    pa: "ਵਰਕਡੇ {{time}} 'ਤੇ ਸ਼ੁਰੂ ਹੋਇਆ (ਫ਼ੋਨ ਦੀ ਘੜੀ)",
  },
  'pdf.workday.ended': {
    en: 'Workday ended {{time}} (phone clock)',
    'zh-CN': '工作日结束于 {{time}}(手机时钟)',
    vi: 'Ngày làm việc kết thúc {{time}} (đồng hồ điện thoại)',
    id: 'Hari kerja berakhir {{time}} (jam ponsel)',
    ko: '근무일 종료 {{time}} (휴대폰 시계)',
    it: 'Giornata di lavoro terminata {{time}} (orologio del telefono)',
    el: 'Η εργάσιμη μέρα τελείωσε {{time}} (ρολόι κινητού)',
    hi: 'वर्कडे {{time}} पर खत्म हुआ (फ़ोन की घड़ी)',
    pa: "ਵਰਕਡੇ {{time}} 'ਤੇ ਖ਼ਤਮ ਹੋਇਆ (ਫ਼ੋਨ ਦੀ ਘੜੀ)",
  },
  'pdf.workday.legCount': {
    en: 'Legs in this PDF: {{chosen}} of {{total}}',
    'zh-CN': '本 PDF 包含的站:{{chosen}}(共 {{total}} 站)',
    vi: 'Số điểm dừng trong PDF này: {{chosen}} trên {{total}}',
    id: 'Perhentian dalam PDF ini: {{chosen}} dari {{total}}',
    ko: '이 PDF의 정차 지점: {{total}}곳 중 {{chosen}}곳',
    it: 'Soste in questo PDF: {{chosen}} su {{total}}',
    el: 'Στάσεις σε αυτό το PDF: {{chosen}} από {{total}}',
    hi: 'इस PDF में स्टॉप: {{total}} में से {{chosen}}',
    pa: 'ਇਸ PDF ਵਿੱਚ ਸਟਾਪ: {{total}} ਵਿੱਚੋਂ {{chosen}}',
  },
  // When the picker left legs out: what each distance and statement is about.
  'pdf.workday.partial': {
    en: "Not every leg of this workday is in this PDF. Each distance and driver's statement is about the leg just before it on the workday, even when that leg is left out.",
    'zh-CN': '本 PDF 没有包含此工作日的每一站。每个距离和驾驶员陈述都是相对于该工作日中紧挨在前的一站,即使那一站没有包含在内。',
    vi: 'PDF này không gồm mọi điểm dừng của ngày làm việc. Mỗi khoảng cách và lời của tài xế đều nói về điểm dừng ngay trước đó trong ngày làm việc, kể cả khi điểm dừng đó không được đưa vào.',
    id: 'Tidak semua perhentian hari kerja ini ada di PDF ini. Setiap jarak dan pernyataan pengemudi menyangkut perhentian tepat sebelumnya pada hari kerja itu, meski perhentian tersebut tidak disertakan.',
    ko: '이 PDF에는 이 근무일의 모든 정차 지점이 들어 있지는 않습니다. 각 거리와 운전자의 진술은 근무일에서 바로 앞 정차 지점에 대한 것이며, 그 정차 지점이 빠져 있어도 마찬가지입니다.',
    it: 'Non tutte le soste di questa giornata di lavoro sono in questo PDF. Ogni distanza e ogni dichiarazione del conducente si riferisce alla sosta immediatamente precedente nella giornata, anche quando quella sosta non è inclusa.',
    el: 'Δεν περιλαμβάνονται όλες οι στάσεις αυτής της εργάσιμης μέρας σε αυτό το PDF. Κάθε απόσταση και δήλωση του οδηγού αφορά την αμέσως προηγούμενη στάση της εργάσιμης μέρας, ακόμη κι όταν εκείνη η στάση λείπει.',
    hi: 'इस PDF में इस वर्कडे का हर स्टॉप शामिल नहीं है। हर दूरी और चालक का हर बयान वर्कडे में ठीक पहले वाले स्टॉप के बारे में है, भले ही वह स्टॉप शामिल न हो।',
    pa: 'ਇਸ PDF ਵਿੱਚ ਇਸ ਵਰਕਡੇ ਦਾ ਹਰ ਸਟਾਪ ਸ਼ਾਮਲ ਨਹੀਂ ਹੈ। ਹਰ ਦੂਰੀ ਅਤੇ ਡਰਾਈਵਰ ਦਾ ਹਰ ਬਿਆਨ ਵਰਕਡੇ ਵਿੱਚ ਠੀਕ ਪਹਿਲਾਂ ਵਾਲੇ ਸਟਾਪ ਬਾਰੇ ਹੈ, ਭਾਵੇਂ ਉਹ ਸਟਾਪ ਸ਼ਾਮਲ ਨਾ ਹੋਵੇ।',
  },
  'pdf.workday.intro': {
    en: 'Each leg is its own parking record. A section for each leg follows this table, and the signature pages come last.',
    'zh-CN': '每一站都是一条单独的停车记录。此表之后是每一站的部分,签名页在最后。',
    vi: 'Mỗi điểm dừng là một bản ghi đỗ xe riêng. Sau bảng này là một phần cho từng điểm dừng, và các trang chữ ký nằm ở cuối.',
    id: 'Setiap perhentian adalah catatan parkir tersendiri. Setelah tabel ini ada bagian untuk setiap perhentian, dan halaman tanda tangan ada di akhir.',
    ko: '각 정차 지점은 별도의 주차 기록입니다. 이 표 다음에 정차 지점별 섹션이 이어지고, 서명 페이지는 맨 끝에 있습니다.',
    it: "Ogni sosta è un record di parcheggio a sé. Dopo questa tabella c'è una sezione per ogni sosta, e le pagine delle firme sono alla fine.",
    el: 'Κάθε στάση είναι ξεχωριστή εγγραφή στάθμευσης. Μετά από αυτόν τον πίνακα ακολουθεί μια ενότητα για κάθε στάση, και οι σελίδες υπογραφών είναι στο τέλος.',
    hi: 'हर स्टॉप एक अलग पार्किंग रिकॉर्ड है। इस तालिका के बाद हर स्टॉप का एक हिस्सा है, और हस्ताक्षर वाले पेज आखिर में हैं।',
    pa: 'ਹਰ ਸਟਾਪ ਇੱਕ ਵੱਖਰਾ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ ਹੈ। ਇਸ ਸਾਰਣੀ ਤੋਂ ਬਾਅਦ ਹਰ ਸਟਾਪ ਦਾ ਇੱਕ ਹਿੱਸਾ ਹੈ, ਅਤੇ ਹਸਤਾਖਰਾਂ ਵਾਲੇ ਪੰਨੇ ਅਖ਼ੀਰ ਵਿੱਚ ਹਨ।',
  },
  // The cover table (T6c item 3). The signed times column reuses
  // pdf.signature.signedAt and the address column pdf.evidence.field.address.
  'pdf.workday.col.leg': {
    en: 'Leg',
    'zh-CN': '站',
    vi: 'Điểm dừng',
    id: 'Perhentian',
    ko: '정차 지점',
    it: 'Sosta',
    el: 'Στάση',
    hi: 'स्टॉप',
    pa: 'ਸਟਾਪ',
  },
  'pdf.workday.col.arrived': {
    en: 'Arrived (phone clock)',
    'zh-CN': '到达(手机时钟)',
    vi: 'Đến lúc (đồng hồ điện thoại)',
    id: 'Tiba (jam ponsel)',
    ko: '도착 (휴대폰 시계)',
    it: 'Arrivo (orologio del telefono)',
    el: 'Άφιξη (ρολόι κινητού)',
    hi: 'आगमन (फ़ोन की घड़ी)',
    pa: 'ਆਮਦ (ਫ਼ੋਨ ਦੀ ਘੜੀ)',
  },
  'pdf.workday.col.left': {
    en: 'Left (phone clock)',
    'zh-CN': '离开(手机时钟)',
    vi: 'Rời đi (đồng hồ điện thoại)',
    id: 'Pergi (jam ponsel)',
    ko: '출차 (휴대폰 시계)',
    it: 'Partenza (orologio del telefono)',
    el: 'Αναχώρηση (ρολόι κινητού)',
    hi: 'प्रस्थान (फ़ोन की घड़ी)',
    pa: 'ਰਵਾਨਗੀ (ਫ਼ੋਨ ਦੀ ਘੜੀ)',
  },
  // Spec wording (T6c item 3). The signed boundary statement's distance
  // between the two parks, phone GPS to phone GPS.
  'pdf.workday.col.distance': {
    en: 'Approx. distance from previous leg (phone GPS)',
    'zh-CN': '与上一站的大约距离(手机 GPS)',
    vi: 'Khoảng cách ước tính từ điểm dừng trước (GPS điện thoại)',
    id: 'Perkiraan jarak dari perhentian sebelumnya (GPS ponsel)',
    ko: '이전 정차 지점과의 대략적 거리 (휴대폰 GPS)',
    it: 'Distanza approssimativa dalla sosta precedente (GPS del telefono)',
    el: 'Κατά προσέγγιση απόσταση από την προηγούμενη στάση (GPS κινητού)',
    hi: 'पिछले स्टॉप से अनुमानित दूरी (फ़ोन GPS)',
    pa: 'ਪਿਛਲੇ ਸਟਾਪ ਤੋਂ ਅੰਦਾਜ਼ਨ ਦੂਰੀ (ਫ਼ੋਨ GPS)',
  },
  // Spec wording (T6c item 3). What the driver answered at the move, as the
  // driver's own statement, read from the signed details at parking.
  'pdf.workday.col.statement': {
    en: "Driver's statement",
    'zh-CN': '驾驶员陈述',
    vi: 'Lời của tài xế',
    id: 'Pernyataan pengemudi',
    ko: '운전자의 진술',
    it: 'Dichiarazione del conducente',
    el: 'Δήλωση του οδηγού',
    hi: 'चालक का बयान',
    pa: 'ਡਰਾਈਵਰ ਦਾ ਬਿਆਨ',
  },
  'pdf.workday.cell.notLeft': {
    en: 'Not recorded',
    'zh-CN': '未记录',
    vi: 'Chưa ghi nhận',
    id: 'Belum dicatat',
    ko: '기록 없음',
    it: 'Non registrata',
    el: 'Δεν έχει καταγραφεί',
    hi: 'दर्ज नहीं',
    pa: 'ਦਰਜ ਨਹੀਂ',
  },
  'pdf.workday.cell.signedArrival': {
    en: 'Arrival: {{value}}',
    'zh-CN': '到达:{{value}}',
    vi: 'Lúc đến: {{value}}',
    id: 'Kedatangan: {{value}}',
    ko: '도착: {{value}}',
    it: 'Arrivo: {{value}}',
    el: 'Άφιξη: {{value}}',
    hi: 'आगमन: {{value}}',
    pa: 'ਆਮਦ: {{value}}',
  },
  'pdf.workday.cell.signedDeparture': {
    en: 'Departure: {{value}}',
    'zh-CN': '离开:{{value}}',
    vi: 'Rời đi: {{value}}',
    id: 'Saat pergi: {{value}}',
    ko: '출차: {{value}}',
    it: 'Partenza: {{value}}',
    el: 'Αναχώρηση: {{value}}',
    hi: 'प्रस्थान: {{value}}',
    pa: 'ਰਵਾਨਗੀ: {{value}}',
  },
  'pdf.workday.cell.noDistance': {
    en: 'Not measured. It needs a phone GPS fix at both legs.',
    'zh-CN': '未测量。需要两站都有手机 GPS 定位。',
    vi: 'Không đo được. Cần có định vị GPS điện thoại ở cả hai điểm dừng.',
    id: 'Tidak diukur. Perlu titik GPS ponsel di kedua perhentian.',
    ko: '측정되지 않음. 두 정차 지점 모두 휴대폰 GPS 위치가 필요합니다.',
    it: 'Non misurata. Serve un rilevamento GPS del telefono in entrambe le soste.',
    el: 'Δεν μετρήθηκε. Χρειάζεται εντοπισμός GPS του κινητού και στις δύο στάσεις.',
    hi: 'नापी नहीं गई। इसके लिए दोनों स्टॉप पर फ़ोन GPS स्थान चाहिए।',
    pa: "ਮਾਪੀ ਨਹੀਂ ਗਈ। ਇਸ ਲਈ ਦੋਹਾਂ ਸਟਾਪਾਂ 'ਤੇ ਫ਼ੋਨ GPS ਸਥਾਨ ਚਾਹੀਦਾ ਹੈ।",
  },
  // The statement cell: one whole sentence per answer (never a fragment
  // inside a sentence, so every locale can order it). The signing marks
  // after it reuse pdf.evidence.value.notSignedYet and its siblings.
  'pdf.workday.statement.firstLeg': {
    en: 'None. This is the first leg.',
    'zh-CN': '无。这是第一站。',
    vi: 'Không có. Đây là điểm dừng đầu tiên.',
    id: 'Tidak ada. Ini perhentian pertama.',
    ko: '없음. 첫 번째 정차 지점입니다.',
    it: 'Nessuna. Questa è la prima sosta.',
    el: 'Καμία. Αυτή είναι η πρώτη στάση.',
    hi: 'कोई नहीं। यह पहला स्टॉप है।',
    pa: 'ਕੋਈ ਨਹੀਂ। ਇਹ ਪਹਿਲਾ ਸਟਾਪ ਹੈ।',
  },
  'pdf.workday.statement.notAsked': {
    en: "Not asked. ParkProof didn't ask about this move.",
    'zh-CN': '未询问。ParkProof 没有就这次挪车提问。',
    vi: 'Không hỏi. ParkProof không hỏi về lần dời xe này.',
    id: 'Tidak ditanyakan. ParkProof tidak bertanya tentang pindah kali ini.',
    ko: '묻지 않음. ParkProof가 이번 이동에 대해 묻지 않았습니다.',
    it: 'Non chiesto. ParkProof non ha fatto domande su questo spostamento.',
    el: 'Δεν ρωτήθηκε. Το ParkProof δεν ρώτησε για αυτή τη μετακίνηση.',
    hi: 'पूछा नहीं गया। ParkProof ने इस बार गाड़ी हटाने के बारे में नहीं पूछा।',
    pa: 'ਪੁੱਛਿਆ ਨਹੀਂ ਗਿਆ। ParkProof ਨੇ ਇਸ ਵਾਰ ਕਾਰ ਹਟਾਉਣ ਬਾਰੇ ਨਹੀਂ ਪੁੱਛਿਆ।',
  },
  'pdf.workday.statement.oppositeDirectionSign': {
    en: 'The driver said they passed a sign showing this zone had ended.',
    'zh-CN': '驾驶员表示经过了一个表示该区段已结束的标志。',
    vi: 'Tài xế cho biết đã đi qua một biển báo cho thấy đoạn đường này đã kết thúc.',
    id: 'Pengemudi menyatakan melewati rambu yang menunjukkan zona ini sudah berakhir.',
    ko: '운전자는 이 구간이 끝났음을 보여 주는 표지판을 지나왔다고 했습니다.',
    it: 'Il conducente ha dichiarato di aver superato un cartello che indicava la fine di questa zona.',
    el: 'Ο οδηγός δήλωσε ότι πέρασε μια πινακίδα που έδειχνε ότι η ζώνη τελείωσε.',
    hi: 'चालक के अनुसार, गाड़ी एक ऐसे साइन से आगे गई जिससे पता चलता था कि यह ज़ोन खत्म हो गया।',
    pa: 'ਡਰਾਈਵਰ ਦੇ ਅਨੁਸਾਰ, ਕਾਰ ਇੱਕ ਅਜਿਹੇ ਚਿੰਨ੍ਹ ਤੋਂ ਅੱਗੇ ਗਈ ਜਿਸ ਤੋਂ ਪਤਾ ਲੱਗਦਾ ਸੀ ਕਿ ਇਹ ਜ਼ੋਨ ਖ਼ਤਮ ਹੋ ਗਿਆ।',
  },
  'pdf.workday.statement.yellowEdgeLine': {
    en: 'The driver said they passed a yellow edge line.',
    'zh-CN': '驾驶员表示经过了一条黄色边线。',
    vi: 'Tài xế cho biết đã đi qua một vạch vàng ở mép đường.',
    id: 'Pengemudi menyatakan melewati garis tepi kuning.',
    ko: '운전자는 노란색 가장자리 선을 지나왔다고 했습니다.',
    it: 'Il conducente ha dichiarato di aver superato una linea gialla sul bordo della strada.',
    el: 'Ο οδηγός δήλωσε ότι πέρασε μια κίτρινη γραμμή στην άκρη του δρόμου.',
    hi: 'चालक के अनुसार, गाड़ी सड़क के किनारे की पीली रेखा से आगे गई।',
    pa: 'ਡਰਾਈਵਰ ਦੇ ਅਨੁਸਾਰ, ਕਾਰ ਸੜਕ ਦੇ ਕਿਨਾਰੇ ਦੀ ਪੀਲੀ ਲਕੀਰ ਤੋਂ ਅੱਗੇ ਗਈ।',
  },
  'pdf.workday.statement.tIntersectionOrDeadEnd': {
    en: 'The driver said they passed the end of the road at a T-intersection or dead end.',
    'zh-CN': '驾驶员表示经过了道路在丁字路口或尽头路处的尽头。',
    vi: 'Tài xế cho biết đã đi qua điểm cuối con đường tại ngã ba chữ T hoặc đường cụt.',
    id: 'Pengemudi menyatakan melewati ujung jalan di pertigaan T atau jalan buntu.',
    ko: '운전자는 T자형 교차로나 막다른 길에서 끝나는 도로의 끝을 지나왔다고 했습니다.',
    it: 'Il conducente ha dichiarato di aver superato la fine della strada a un incrocio a T o in una strada senza uscita.',
    el: 'Ο οδηγός δήλωσε ότι πέρασε το τέλος του δρόμου σε διασταύρωση σε σχήμα Τ ή σε αδιέξοδο.',
    hi: 'चालक के अनुसार, गाड़ी T-चौराहे या बंद सड़क पर सड़क के अंत से आगे गई।',
    pa: 'ਡਰਾਈਵਰ ਦੇ ਅਨੁਸਾਰ, ਕਾਰ T-ਚੌਰਾਹੇ ਜਾਂ ਬੰਦ ਸੜਕ ਉੱਤੇ ਸੜਕ ਦੇ ਅੰਤ ਤੋਂ ਅੱਗੇ ਗਈ।',
  },
  'pdf.workday.statement.leftParkingArea': {
    en: 'The driver said they drove out of the parking area, past a sign saying it ends.',
    'zh-CN': '驾驶员表示把车开出了停车区域,经过了表示区域结束的标志。',
    vi: 'Tài xế cho biết đã lái xe ra khỏi khu vực đỗ xe, qua một biển báo cho biết khu vực kết thúc.',
    id: 'Pengemudi menyatakan mengemudi keluar dari area parkir, melewati rambu yang menyatakan area itu berakhir.',
    ko: '운전자는 구역이 끝난다는 표지판을 지나 주차 구역 밖으로 운전해 나왔다고 했습니다.',
    it: "Il conducente ha dichiarato che l'auto è uscita dall'area di parcheggio, oltre un cartello che ne indica la fine.",
    el: 'Ο οδηγός δήλωσε ότι το αυτοκίνητο βγήκε από την περιοχή στάθμευσης, περνώντας μια πινακίδα που λέει ότι τελειώνει.',
    hi: 'चालक के अनुसार, गाड़ी पार्किंग क्षेत्र से बाहर गई, उस साइन के आगे जो बताता है कि क्षेत्र खत्म होता है।',
    pa: 'ਡਰਾਈਵਰ ਦੇ ਅਨੁਸਾਰ, ਕਾਰ ਪਾਰਕਿੰਗ ਖੇਤਰ ਤੋਂ ਬਾਹਰ ਗਈ, ਉਸ ਚਿੰਨ੍ਹ ਤੋਂ ਅੱਗੇ ਜੋ ਦੱਸਦਾ ਹੈ ਕਿ ਖੇਤਰ ਖ਼ਤਮ ਹੁੰਦਾ ਹੈ।',
  },
  'pdf.workday.statement.notSure': {
    en: "Asked whether they had left the signed stretch, the driver answered: I'm not sure.",
    'zh-CN': '被问到是否已离开标志适用的路段时,驾驶员回答:我不确定。',
    vi: 'Khi được hỏi đã rời khỏi đoạn đường có biển báo chưa, tài xế trả lời: Tôi không chắc.',
    id: 'Saat ditanya apakah sudah meninggalkan ruas jalan yang diatur rambu, pengemudi menjawab: Saya tidak yakin.',
    ko: '표지판이 적용되는 구간을 벗어났는지 묻자 운전자는 "잘 모르겠습니다"라고 답했습니다.',
    it: 'Alla domanda se avesse lasciato il tratto indicato dal cartello, il conducente ha risposto: Non lo so con certezza.',
    el: 'Όταν ρωτήθηκε αν είχε φύγει από το τμήμα του δρόμου με την πινακίδα, ο οδηγός απάντησε: Δεν το ξέρω με βεβαιότητα.',
    hi: 'यह पूछे जाने पर कि क्या गाड़ी साइन वाले सड़क के हिस्से से बाहर गई थी, चालक ने जवाब दिया: मुझे पक्का नहीं पता।',
    pa: "ਇਹ ਪੁੱਛੇ ਜਾਣ 'ਤੇ ਕਿ ਕੀ ਕਾਰ ਚਿੰਨ੍ਹ ਵਾਲੇ ਸੜਕ ਦੇ ਹਿੱਸੇ ਤੋਂ ਬਾਹਰ ਗਈ ਸੀ, ਡਰਾਈਵਰ ਨੇ ਜਵਾਬ ਦਿੱਤਾ: ਮੈਨੂੰ ਪੱਕਾ ਨਹੀਂ ਪਤਾ।",
  },
  'pdf.workday.statement.notSureArea': {
    en: "Asked whether they had left the parking area, the driver answered: I'm not sure.",
    'zh-CN': '被问到是否已离开停车区域时,驾驶员回答:我不确定。',
    vi: 'Khi được hỏi đã rời khỏi khu vực đỗ xe chưa, tài xế trả lời: Tôi không chắc.',
    id: 'Saat ditanya apakah sudah meninggalkan area parkir, pengemudi menjawab: Saya tidak yakin.',
    ko: '주차 구역을 벗어났는지 묻자 운전자는 "잘 모르겠습니다"라고 답했습니다.',
    it: "Alla domanda se avesse lasciato l'area di parcheggio, il conducente ha risposto: Non lo so con certezza.",
    el: 'Όταν ρωτήθηκε αν είχε φύγει από την περιοχή στάθμευσης, ο οδηγός απάντησε: Δεν το ξέρω με βεβαιότητα.',
    hi: 'यह पूछे जाने पर कि क्या गाड़ी पार्किंग क्षेत्र से बाहर गई थी, चालक ने जवाब दिया: मुझे पक्का नहीं पता।',
    pa: "ਇਹ ਪੁੱਛੇ ਜਾਣ 'ਤੇ ਕਿ ਕੀ ਕਾਰ ਪਾਰਕਿੰਗ ਖੇਤਰ ਤੋਂ ਬਾਹਰ ਗਈ ਸੀ, ਡਰਾਈਵਰ ਨੇ ਜਵਾਬ ਦਿੱਤਾ: ਮੈਨੂੰ ਪੱਕਾ ਨਹੀਂ ਪਤਾ।",
  },
  // Each leg's section, and the subtitle of its signature pages.
  'pdf.workday.legHeading': {
    en: 'Leg {{number}}',
    'zh-CN': '第 {{number}} 站',
    vi: 'Điểm dừng {{number}}',
    id: 'Perhentian {{number}}',
    ko: '정차 지점 {{number}}',
    it: 'Sosta {{number}}',
    el: 'Στάση {{number}}',
    hi: 'स्टॉप {{number}}',
    pa: 'ਸਟਾਪ {{number}}',
  },
  'pdf.workday.tagged': {
    en: "This leg was an earlier park added to the workday. Its signed details don't mention the workday.",
    'zh-CN': '这一站是之前的一次停车,后来加入此工作日。它已签名的信息中没有提到这个工作日。',
    vi: 'Điểm dừng này là một lần đỗ xe trước đó được thêm vào ngày làm việc. Các chi tiết đã ký của nó không nhắc đến ngày làm việc.',
    id: 'Perhentian ini adalah parkir sebelumnya yang ditambahkan ke hari kerja. Detailnya yang ditandatangani tidak menyebut hari kerja ini.',
    ko: '이 정차 지점은 이전 주차를 근무일에 추가한 것입니다. 서명된 세부 정보에는 근무일이 언급되어 있지 않습니다.',
    it: 'Questa sosta era un parcheggio precedente aggiunto alla giornata di lavoro. I suoi dati firmati non citano la giornata di lavoro.',
    el: 'Αυτή η στάση ήταν προηγούμενη στάθμευση που προστέθηκε στην εργάσιμη μέρα. Τα υπογεγραμμένα στοιχεία της δεν αναφέρουν την εργάσιμη μέρα.',
    hi: 'यह स्टॉप पहले की एक पार्किंग थी जिसे वर्कडे में जोड़ा गया। इसके हस्ताक्षर किए गए विवरण में वर्कडे का ज़िक्र नहीं है।',
    pa: 'ਇਹ ਸਟਾਪ ਪਹਿਲਾਂ ਦੀ ਇੱਕ ਪਾਰਕਿੰਗ ਸੀ ਜਿਸਨੂੰ ਵਰਕਡੇ ਵਿੱਚ ਜੋੜਿਆ ਗਿਆ। ਇਸਦੇ ਹਸਤਾਖਰ ਕੀਤੇ ਵੇਰਵਿਆਂ ਵਿੱਚ ਵਰਕਡੇ ਦਾ ਜ਼ਿਕਰ ਨਹੀਂ ਹੈ।',
  },
  // The chain between legs: each leg's details at parking name the signed
  // departure of the leg before it (workday.previous_departure_payload_sha256).
  'pdf.workday.chain.heading': {
    en: 'The chain between legs',
    'zh-CN': '各站之间的链',
    vi: 'Chuỗi giữa các điểm dừng',
    id: 'Rantai antar perhentian',
    ko: '정차 지점 사이의 연결',
    it: 'La catena tra le soste',
    el: 'Η αλυσίδα ανάμεσα στις στάσεις',
    hi: 'स्टॉप के बीच की कड़ी',
    pa: 'ਸਟਾਪਾਂ ਵਿਚਕਾਰ ਕੜੀ',
  },
  'pdf.workday.chain.intro': {
    en: "Each leg's details at parking carry previous_departure_payload_sha256, the SHA-256 of the signed departure payload of the leg before it, when that departure was signed in time. Save each leg's files from its signature pages in a folder of its own (leg1, leg2 and so on) and decode them as in its steps. Then run the command shown for each pair.",
    'zh-CN': '每一站的停车时补充信息都带有 previous_departure_payload_sha256,即前一站已签名的离开负载的 SHA-256(前提是那次离开及时签了名)。把每一站签名页中的文件分别保存到各自的文件夹(leg1、leg2 等),并按该站的步骤解码。然后对每一对运行下面所示的命令。',
    vi: 'Thông tin khi đỗ xe của mỗi điểm dừng mang previous_departure_payload_sha256, tức SHA-256 của payload rời đi đã ký của điểm dừng trước nó, khi phần rời đi đó được ký kịp thời. Lưu các tệp của mỗi điểm dừng từ các trang chữ ký của nó vào một thư mục riêng (leg1, leg2, v.v.) và giải mã chúng theo các bước của điểm dừng đó. Sau đó chạy lệnh được hiển thị cho từng cặp.',
    id: 'Detail saat parkir setiap perhentian memuat previous_departure_payload_sha256, yaitu SHA-256 dari payload kepergian yang ditandatangani milik perhentian sebelumnya, jika kepergian itu ditandatangani tepat waktu. Simpan berkas setiap perhentian dari halaman tanda tangannya di folder tersendiri (leg1, leg2, dan seterusnya) lalu dekode sesuai langkahnya. Kemudian jalankan perintah yang ditampilkan untuk setiap pasangan.',
    ko: '각 정차 지점의 주차할 때의 세부 정보에는 previous_departure_payload_sha256이 들어 있습니다. 이는 바로 앞 정차 지점의 서명된 출차 페이로드의 SHA-256이며, 그 출차가 제때 서명된 경우에만 들어갑니다. 각 정차 지점의 서명 페이지에 있는 파일을 정차 지점별 폴더(leg1, leg2 등)에 저장하고 그 단계대로 디코딩하세요. 그런 다음 각 쌍에 대해 표시된 명령을 실행하세요.',
    it: "I dettagli all'arrivo di ogni sosta contengono previous_departure_payload_sha256, lo SHA-256 del payload di partenza firmato della sosta precedente, quando quella partenza è stata firmata in tempo. Salva i file di ogni sosta dalle sue pagine delle firme in una cartella a sé (leg1, leg2 e così via) e decodificali come nei suoi passaggi. Poi esegui il comando indicato per ogni coppia.",
    el: 'Τα στοιχεία κατά τη στάθμευση κάθε στάσης περιέχουν το previous_departure_payload_sha256, το SHA-256 του υπογεγραμμένου payload αναχώρησης της προηγούμενης στάσης, όταν εκείνη η αναχώρηση υπογράφηκε εγκαίρως. Αποθήκευσε τα αρχεία κάθε στάσης από τις σελίδες υπογραφών της σε δικό της φάκελο (leg1, leg2 κ.ο.κ.) και αποκωδικοποίησέ τα όπως στα βήματά της. Έπειτα τρέξε την εντολή που φαίνεται για κάθε ζεύγος.',
    hi: 'हर स्टॉप के पार्किंग के समय के विवरण में previous_departure_payload_sha256 होता है, यानी उससे पहले वाले स्टॉप के हस्ताक्षरित प्रस्थान पेलोड का SHA-256, जब वह प्रस्थान समय पर हस्ताक्षरित हुआ हो। हर स्टॉप की फ़ाइलें उसके हस्ताक्षर वाले पेजों से उसके अपने फ़ोल्डर (leg1, leg2 वगैरह) में सहेजें और उसके चरणों के अनुसार डिकोड करें। फिर हर जोड़ी के लिए दिखाया गया कमांड चलाएँ।',
    pa: 'ਹਰ ਸਟਾਪ ਦੇ ਪਾਰਕਿੰਗ ਵੇਲੇ ਦੇ ਵੇਰਵਿਆਂ ਵਿੱਚ previous_departure_payload_sha256 ਹੁੰਦਾ ਹੈ, ਯਾਨੀ ਉਸ ਤੋਂ ਪਹਿਲੇ ਸਟਾਪ ਦੇ ਹਸਤਾਖਰਿਤ ਰਵਾਨਗੀ ਪੇਲੋਡ ਦਾ SHA-256, ਜਦੋਂ ਉਹ ਰਵਾਨਗੀ ਸਮੇਂ ਸਿਰ ਹਸਤਾਖਰਿਤ ਹੋਈ ਹੋਵੇ। ਹਰ ਸਟਾਪ ਦੀਆਂ ਫ਼ਾਈਲਾਂ ਉਸਦੇ ਹਸਤਾਖਰਾਂ ਵਾਲੇ ਪੰਨਿਆਂ ਤੋਂ ਉਸਦੇ ਆਪਣੇ ਫ਼ੋਲਡਰ (leg1, leg2 ਆਦਿ) ਵਿੱਚ ਸੰਭਾਲੋ ਅਤੇ ਉਸਦੇ ਕਦਮਾਂ ਮੁਤਾਬਕ ਡੀਕੋਡ ਕਰੋ। ਫਿਰ ਹਰ ਜੋੜੀ ਲਈ ਦਿਖਾਈ ਗਈ ਕਮਾਂਡ ਚਲਾਓ।',
  },
  'pdf.workday.chain.equals': {
    en: 'That hex value must equal previous_departure_payload_sha256 in leg {{leg}}, link {{link}}.',
    'zh-CN': '这个十六进制值必须等于第 {{leg}} 站环节 {{link}} 中的 previous_departure_payload_sha256。',
    vi: 'Giá trị hex đó phải bằng previous_departure_payload_sha256 trong mắt xích {{link}} của điểm dừng {{leg}}.',
    id: 'Nilai hex itu harus sama dengan previous_departure_payload_sha256 di mata rantai {{link}} perhentian {{leg}}.',
    ko: '그 16진수 값이 정차 지점 {{leg}}, 링크 {{link}}의 previous_departure_payload_sha256과 일치해야 합니다.',
    it: "Quel valore esadecimale deve essere uguale a previous_departure_payload_sha256 nell'anello {{link}} della sosta {{leg}}.",
    el: 'Αυτή η δεκαεξαδική τιμή πρέπει να είναι ίδια με το previous_departure_payload_sha256 στον κρίκο {{link}} της στάσης {{leg}}.',
    hi: 'वह हेक्स मान स्टॉप {{leg}} की कड़ी {{link}} के previous_departure_payload_sha256 के बराबर होना चाहिए।',
    pa: 'ਉਹ ਹੈਕਸ ਮੁੱਲ ਸਟਾਪ {{leg}} ਦੀ ਕੜੀ {{link}} ਵਿਚਲੇ previous_departure_payload_sha256 ਦੇ ਬਰਾਬਰ ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ।',
  },
  'pdf.workday.chain.equalsOneOf': {
    en: 'One of these hex values must equal previous_departure_payload_sha256 in leg {{leg}}, link {{link}}.',
    'zh-CN': '这些十六进制值中必须有一个等于第 {{leg}} 站环节 {{link}} 中的 previous_departure_payload_sha256。',
    vi: 'Một trong các giá trị hex này phải bằng previous_departure_payload_sha256 trong mắt xích {{link}} của điểm dừng {{leg}}.',
    id: 'Salah satu nilai hex ini harus sama dengan previous_departure_payload_sha256 di mata rantai {{link}} perhentian {{leg}}.',
    ko: '이 16진수 값 중 하나가 정차 지점 {{leg}}, 링크 {{link}}의 previous_departure_payload_sha256과 일치해야 합니다.',
    it: "Uno di questi valori esadecimali deve essere uguale a previous_departure_payload_sha256 nell'anello {{link}} della sosta {{leg}}.",
    el: 'Μία από αυτές τις δεκαεξαδικές τιμές πρέπει να είναι ίδια με το previous_departure_payload_sha256 στον κρίκο {{link}} της στάσης {{leg}}.',
    hi: 'इनमें से कोई एक हेक्स मान स्टॉप {{leg}} की कड़ी {{link}} के previous_departure_payload_sha256 के बराबर होना चाहिए।',
    pa: 'ਇਹਨਾਂ ਵਿੱਚੋਂ ਕੋਈ ਇੱਕ ਹੈਕਸ ਮੁੱਲ ਸਟਾਪ {{leg}} ਦੀ ਕੜੀ {{link}} ਵਿਚਲੇ previous_departure_payload_sha256 ਦੇ ਬਰਾਬਰ ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ।',
  },
  'pdf.workday.chain.notLinked': {
    en: 'Leg {{leg}}, link {{link}} was signed without a departure of the leg before it, because none was signed in time. There is nothing to compare here.',
    'zh-CN': '第 {{leg}} 站的环节 {{link}} 签名时没有包含前一站的离开信息,因为那次离开没有及时签名。这里没有可比较的内容。',
    vi: 'Mắt xích {{link}} của điểm dừng {{leg}} được ký mà không có phần rời đi của điểm dừng trước nó, vì không có phần rời đi nào được ký kịp thời. Không có gì để so sánh ở đây.',
    id: 'Mata rantai {{link}} perhentian {{leg}} ditandatangani tanpa kepergian dari perhentian sebelumnya, karena tidak ada yang ditandatangani tepat waktu. Tidak ada yang perlu dibandingkan di sini.',
    ko: '정차 지점 {{leg}}의 링크 {{link}}는 제때 서명된 출차가 없어서 바로 앞 정차 지점의 출차 없이 서명되었습니다. 여기에는 비교할 것이 없습니다.',
    it: "L'anello {{link}} della sosta {{leg}} è stato firmato senza una partenza della sosta precedente, perché nessuna è stata firmata in tempo. Qui non c'è nulla da confrontare.",
    el: 'Ο κρίκος {{link}} της στάσης {{leg}} υπογράφηκε χωρίς αναχώρηση της προηγούμενης στάσης, επειδή καμία δεν υπογράφηκε εγκαίρως. Εδώ δεν υπάρχει κάτι για σύγκριση.',
    hi: 'स्टॉप {{leg}} की कड़ी {{link}} पर पिछले स्टॉप के प्रस्थान के बिना हस्ताक्षर हुए, क्योंकि कोई प्रस्थान समय पर हस्ताक्षरित नहीं हुआ। यहाँ तुलना करने के लिए कुछ नहीं है।',
    pa: "ਸਟਾਪ {{leg}} ਦੀ ਕੜੀ {{link}} 'ਤੇ ਪਿਛਲੇ ਸਟਾਪ ਦੀ ਰਵਾਨਗੀ ਤੋਂ ਬਿਨਾਂ ਹਸਤਾਖਰ ਹੋਏ, ਕਿਉਂਕਿ ਕੋਈ ਰਵਾਨਗੀ ਸਮੇਂ ਸਿਰ ਹਸਤਾਖਰਿਤ ਨਹੀਂ ਹੋਈ। ਇੱਥੇ ਤੁਲਨਾ ਕਰਨ ਲਈ ਕੁਝ ਨਹੀਂ ਹੈ।",
  },
  'pdf.workday.chain.notInPdf': {
    en: "Leg {{leg}}, link {{link}} names a signed departure of the leg before it that isn't in this PDF.",
    'zh-CN': '第 {{leg}} 站的环节 {{link}} 指向前一站一个已签名的离开信息,但它不在本 PDF 中。',
    vi: 'Mắt xích {{link}} của điểm dừng {{leg}} nhắc đến một phần rời đi đã ký của điểm dừng trước nó, nhưng phần đó không có trong PDF này.',
    id: 'Mata rantai {{link}} perhentian {{leg}} merujuk ke kepergian yang ditandatangani dari perhentian sebelumnya yang tidak ada di PDF ini.',
    ko: '정차 지점 {{leg}}의 링크 {{link}}는 바로 앞 정차 지점의 서명된 출차를 가리키지만, 그 출차는 이 PDF에 없습니다.',
    it: "L'anello {{link}} della sosta {{leg}} indica una partenza firmata della sosta precedente che non è in questo PDF.",
    el: 'Ο κρίκος {{link}} της στάσης {{leg}} αναφέρει μια υπογεγραμμένη αναχώρηση της προηγούμενης στάσης που δεν υπάρχει σε αυτό το PDF.',
    hi: 'स्टॉप {{leg}} की कड़ी {{link}} पिछले स्टॉप के एक हस्ताक्षरित प्रस्थान की ओर इशारा करती है जो इस PDF में नहीं है।',
    pa: 'ਸਟਾਪ {{leg}} ਦੀ ਕੜੀ {{link}} ਪਿਛਲੇ ਸਟਾਪ ਦੀ ਇੱਕ ਹਸਤਾਖਰਿਤ ਰਵਾਨਗੀ ਵੱਲ ਇਸ਼ਾਰਾ ਕਰਦੀ ਹੈ ਜੋ ਇਸ PDF ਵਿੱਚ ਨਹੀਂ ਹੈ।',
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

/** Every key the copy-pass data files overwrite (they run after this script). */
function copyPassKeys() {
  const keys = new Set()
  let files = []
  try {
    files = readdirSync(COPY_PASS).filter((f) => f.endsWith('.json'))
  } catch {
    return keys
  }
  for (const f of files) {
    const data = JSON.parse(readFileSync(join(COPY_PASS, f), 'utf8'))
    for (const k of Object.keys(data)) keys.add(k)
  }
  return keys
}

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
  const passKeys = copyPassKeys()
  for (const [path, byLocale] of [...Object.entries(ADDITIONS), ...Object.entries(OVERWRITES)]) {
    for (const locale of LOCALES) {
      if (typeof byLocale[locale] !== 'string' || byLocale[locale].trim() === '') {
        problems.push(`${locale}: no text for ${path}`)
      }
    }
    // The copy pass runs after this script and must never rewrite a workday key.
    if (passKeys.has(path)) problems.push(`${path} is in scripts/copy-pass: the copy pass would rewrite it`)
    // Plurals carry {{count}} in both forms (i18n rules), checked here for every key this script writes.
    if (path.endsWith('_one') || path.endsWith('_other')) {
      for (const [locale, s] of Object.entries(byLocale)) {
        if (!s.includes('{{count}}')) problems.push(`${locale}: ${path} must use {{count}}`)
      }
    }
    for (const s of Object.values(byLocale)) {
      // Copy rules: no em-dashes; PDF-safe symbols only.
      if (s.includes(EM_DASH)) problems.push(`em-dash in new copy at ${path}: ${s}`)
      if (/[✓⚠→≈≤]/u.test(s)) problems.push(`symbol in new copy at ${path}: ${s}`)
    }
    const en = byLocale.en
    // The en record noun is "record", never "session".
    if (/\bsessions?\b/i.test(en)) problems.push(`"session" in en copy at ${path}`)
    // Words and claims the copy rules ban outright.
    if (
      /\b(reset|compliant|compliance proven|admissible|authentic|verified location|accepted by (insurers|council)|strong evidence|verified)\b/i.test(
        en,
      )
    ) {
      problems.push(`banned wording in en copy at ${path}`)
    }
    // "ticket" alone can read as the fine notice; say "meter ticket".
    if (/(?<!meter )\btickets?\b/i.test(en)) problems.push(`ambiguous "ticket" in en copy at ${path}`)
    // Workday copy never names a distance (no rule sets a minimum
    // re-parking distance) and never says or implies that moving, paying or
    // topping up restarts the limit: "restart" only ever follows "doesn't".
    if (/\d\s*(m|metres?|meters?|km)\b/i.test(en)) problems.push(`distance in workday en copy at ${path}`)
    for (const m of en.matchAll(/\brestart\w*/gi)) {
      const before = en.slice(0, m.index)
      if (!/\b(doesn't|don't|does not|do not)\s+$/i.test(before)) problems.push(`restart wording in workday en copy at ${path}`)
    }
    if (/\b(new limit starts|fresh limit|resets?)\b/i.test(en)) problems.push(`restart wording in workday en copy at ${path}`)
    // Never an outcome: no "you won't be fined", "safe", "legal", "allowed to stay".
    if (/\b(won't be fined|can't be fined|safe to park|you're legal|stay legal|allowed to stay)\b/i.test(en)) {
      problems.push(`outcome wording in workday en copy at ${path}`)
    }
    // Phone times are labelled as phone times.
    if (/\{\{time\}\}/.test(en) && /\b(started|ended)\b/i.test(en) && !/phone clock/i.test(en) && !/^Your time/i.test(en)) {
      problems.push(`a phone time without "(phone clock)" at ${path}`)
    }
    // Absolute times only: no "in 10 minutes" style relative time.
    if (/\bin \d+\s*(min|minutes?|hours?)\b/i.test(en)) problems.push(`relative time in en copy at ${path}`)
  }
  for (const [path, text] of Object.entries(EXACT)) {
    if (!ADDITIONS[path]) problems.push(`EXACT key ${path} is not added by this script`)
    else if (ADDITIONS[path].en !== text) problems.push(`en text of ${path} isn't the spec's wording: ${ADDITIONS[path].en}`)
  }
  for (const k of LEGAL) if (!ADDITIONS[k] && !OVERWRITES[k]) problems.push(`LEGAL key ${k} is not written by this script`)
  return problems
}

// ── --list: keys for the T10 review ─────────────────────────────────────
if (process.argv.includes('--list')) {
  const keys = [...Object.keys(ADDITIONS), ...Object.keys(OVERWRITES)].sort()
  for (const k of keys) {
    const tags = [
      k in OVERWRITES ? 'overwrite' : null,
      LEGAL.has(k) ? 'legal' : null,
      k in EXACT ? 'exact' : null,
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
