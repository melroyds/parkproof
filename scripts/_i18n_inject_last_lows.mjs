/**
 * Last lows i18n (docs/build/fix-list.md, "Copy and translation"): the
 * empty-note sentence as one string, and "fine" for a fine in the older
 * English strings that said "ticket". Idempotent: running it twice leaves
 * the files byte-identical after the first run.
 *
 * Run order: LAST, after scripts/_i18n_inject_t10_review.mjs. The full chain
 * is fix_push, t6a, t8, t3, t5, t2, t4, t7, t6bc, fixlist_final, copy_pass,
 * t10_review, then this script. Never re-run the T0a to T1b scripts.
 * So the order can't matter, a key this script overwrites that the copy pass
 * (scripts/copy-pass/<locale>.json) or the T10 review
 * (scripts/t10-review/<locale>.json) also overwrites must carry this
 * script's text there too, and a key this script adds or deletes must not be
 * in either. Both are checked below before anything is written, so running
 * the copy pass or the review again after this script changes nothing. No
 * other inject script writes these keys.
 *
 * ADDITIONS:
 *   - `session.noteEmpty`: the record screen's empty-note line, one sentence
 *     with the Add note button inside it as <add>…</add> (SessionDetail.tsx
 *     renders it with react-i18next's <Trans>). It replaces three keys
 *     around a button, which put the verb in the wrong place in ko, hi and
 *     pa. Each locale puts the button where its own word order wants it, and
 *     its text is the locale's `session.addNote`, so the button's accessible
 *     name is the same as before (checked below).
 *
 * DELETIONS: `session.noNote` and `session.noteHelp`, the two halves of the
 * old line. `session.addNote` stays: the note card's heading button reads it.
 * The copy-pass files no longer overwrite `session.noteHelp`.
 *
 * OVERWRITES ("ticket" in older English strings): the build spec says
 * "ticket" alone is ambiguous in English (a pay-and-display ticket or a
 * fine). Every English string that used it for a fine now says "fine", or
 * "infringement notice" / "notice" for the paper itself, as the newer
 * strings do (home.fineStart, notice.*, appeal.captureIntro). The other 8
 * locales change only where they said ticket (hi टिकट, pa ਟਿਕਟ, vi vé phạt,
 * ko 딱지), or used a word other than the verified term for a fine
 * (docs/legal-pdf-review-worksheet.md: zh 罚款 for 罚单, el πρόστιμο for
 * κλήση, hi जुर्माना and pa ਜੁਰਮਾਨਾ for चालान and ਚਾਲਾਨ), and they use the
 * same word for the notice as T8 does (zh 违章通知, vi thông báo vi phạm,
 * id surat denda, it verbale or notifica, hi उल्लंघन नोटिस, pa ਉਲੰਘਣਾ ਨੋਟਿਸ;
 * el keeps κλήση and ko 통지서 for the paper, as T8 does). A locale that
 * already said the same thing is left alone.
 *   about.lead, about.evidence.items.0, about.appeal.title,
 *   about.appeal.items.0, about.support.body, landing.bullet.defensible,
 *   home.tagline, home.draftAppeal, reminders.expired, session.draftAppeal,
 *   appeal.captureTakePhotoSub ("Camera of the ticket": now "Photograph the
 *   notice" in all 9), appeal.draftingHeader.
 *   session.notePlaceholder, in all 9: it said the note is "used as
 *   context" for an appeal, but the appeal draft never reads the note
 *   (buildAppealEvidenceText in lambda/index.js). What the app does is put
 *   it in the record's PDF (src/lib/pdf.ts, "Driver's note"), so it now
 *   says that.
 * src/lib/copy-lint.test.ts now fails on "ticket" alone in any English string.
 *
 * Writes nothing (exit 1) when:
 *   - an overwrite isn't an existing string in the locale it overwrites, or
 *     an overwrite or addition has no en text;
 *   - after applying, any locale fails the parity checks
 *     src/lib/locales.test.ts enforces, or a deleted key is still there;
 *   - `session.noteEmpty` has anything but one <add>…</add>, or the button
 *     text in it isn't that locale's `session.addNote`;
 *   - new text has an em-dash or a symbol, or the en text says "session",
 *     uses banned wording or says "ticket" alone;
 *   - a copy-pass or T10 review file would undo or bring back any of it.
 *
 * Run:   node scripts/_i18n_inject_last_lows.mjs
 * List:  node scripts/_i18n_inject_last_lows.mjs --list
 *        prints every key this script adds, rewrites or deletes, and the
 *        locales it writes, for a translation review.
 * Other: node scripts/_i18n_inject_last_lows.mjs --dir <locales dir>
 *        runs against another copy of the locale files (replay checks).
 *        --pass <copy-pass dir> and --review <review dir> read the copy-pass
 *        and T10 review files from other folders.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const argAfter = (flag, fallback) => {
  const i = process.argv.indexOf(flag)
  return i > -1 ? resolve(process.argv[i + 1]) : fallback
}
const LOC = argAfter('--dir', join(ROOT, 'src', 'locales'))
const PASS = argAfter('--pass', join(ROOT, 'scripts', 'copy-pass'))
const REVIEW = argAfter('--review', join(ROOT, 'scripts', 't10-review'))
export const LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

// ── New keys (all 9 locales) ────────────────────────────────────────────
export const ADDITIONS = {
  'session.noteEmpty': {
    en: 'No note added. Tap <add>Add note</add> to record why you were here, in your own words. Notes aren\'t signed.',
    'zh-CN': '尚未添加备注。点击<add>添加备注</add>，用你自己的话记下你为什么停在这里。备注不会被签名。',
    vi: 'Chưa có ghi chú. Nhấn <add>Thêm ghi chú</add> để ghi lại lý do bạn ở đây, theo lời của chính bạn. Ghi chú không được ký.',
    id: 'Belum ada catatan. Ketuk <add>Tambah catatan</add> untuk menuliskan alasan kamu ada di sana, dengan kata-katamu sendiri. Catatan tidak ditandatangani.',
    ko: '아직 메모가 없습니다. 여기 계셨던 이유를 직접 적어 두시려면 <add>메모 추가</add>를 누르세요. 메모는 서명되지 않습니다.',
    it: 'Nessuna nota aggiunta. Tocca <add>Aggiungi nota</add> per annotare con parole tue perché eri qui. Le note non sono firmate.',
    el: 'Δεν προστέθηκε σημείωση. Πάτα <add>Πρόσθεσε σημείωση</add> για να καταγράψεις με δικά σου λόγια γιατί ήσουν εδώ. Οι σημειώσεις δεν υπογράφονται.',
    hi: 'कोई टिप्पणी नहीं जोड़ी गई। आप यहाँ क्यों थे, यह अपने शब्दों में दर्ज करने के लिए <add>टिप्पणी जोड़ें</add> पर टैप करें। टिप्पणियों पर हस्ताक्षर नहीं होते।',
    pa: 'ਕੋਈ ਨੋਟ ਨਹੀਂ ਜੋੜਿਆ ਗਿਆ। ਤੁਸੀਂ ਇੱਥੇ ਕਿਉਂ ਸੀ, ਇਹ ਆਪਣੇ ਸ਼ਬਦਾਂ ਵਿੱਚ ਦਰਜ ਕਰਨ ਲਈ <add>ਨੋਟ ਜੋੜੋ</add> \'ਤੇ ਟੈਪ ਕਰੋ। ਨੋਟਾਂ \'ਤੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹੁੰਦੇ।',
  },
}

// ── Deleted keys (all 9 locales) ────────────────────────────────────────
export const DELETIONS = ['session.noNote', 'session.noteHelp']

// ── Rewritten strings: en plus each locale that said ticket ─────────────
// A numeric segment indexes into an array (`about.evidence.items.0`).
export const OVERWRITES = {
  'about.lead': {
    en: "You probably came here thinking oh, it reads parking signs. It does. But while it's at it, we figured we'd also save the evidence in case you get a wrongful fine, draft a dispute letter for you to check if you do, and remind you to move your car before time runs out. Here's the friendly tour.",
    'zh-CN': '你大概以为它只是一个停车标志翻译器。它确实是这个。但同时，我们还顺便帮你保存停车证据，以防被不公正地罚款。如果真的被罚款，它还能帮你起草一封申诉信，由你检查和修改，并在停车时间到期前提醒你挪车。下面是友好的功能介绍。',
    el: 'Μάλλον ήρθες εδώ νομίζοντας «α, διαβάζει πινακίδες στάθμευσης». Όντως το κάνει. Αλλά μια που μπήκαμε στον κόπο, σκεφτήκαμε να αποθηκεύουμε και τα στοιχεία σε περίπτωση που σου βάλουν άδικο πρόστιμο, να σου ετοιμάζουμε ένα προσχέδιο ένστασης για να το ελέγξεις αν συμβεί, και να σου θυμίζουμε να μετακινήσεις το αυτοκίνητο πριν τελειώσει ο χρόνος. Πάμε μια φιλική βόλτα.',
    hi: 'आप शायद यह सोचकर आए हैं कि अरे, यह तो पार्किंग साइन पढ़ता है। हाँ, यह वही करता है। पर इसी मौके पर हमने सोचा क्यों न आपकी पार्किंग का सबूत भी सहेज लें, गलत जुर्माना लगे तो आपके लिए अपील पत्र का एक मसौदा भी तैयार कर दें जिसे आप जाँच सकें, और समय खत्म होने से पहले गाड़ी हटाने की याद भी दिला दें। तो लीजिए, एक दोस्ताना सैर।',
    pa: 'ਤੁਸੀਂ ਸ਼ਾਇਦ ਇਹ ਸੋਚ ਕੇ ਇੱਥੇ ਆਏ ਹੋ ਕਿ ਆਹ, ਇਹ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਪੜ੍ਹਦਾ ਹੈ। ਹਾਂ, ਇਹ ਉਹੀ ਕਰਦਾ ਹੈ। ਪਰ ਨਾਲ ਦੀ ਨਾਲ ਅਸੀਂ ਸੋਚਿਆ ਕਿਉਂ ਨਾ ਤੁਹਾਡੀ ਪਾਰਕਿੰਗ ਦਾ ਸਬੂਤ ਵੀ ਸੰਭਾਲ ਲਈਏ, ਜੇ ਕਦੇ ਗਲਤ ਜੁਰਮਾਨਾ ਲੱਗੇ ਤਾਂ ਅਪੀਲ ਪੱਤਰ ਦਾ ਖਰੜਾ ਵੀ ਤਿਆਰ ਕਰ ਦੇਈਏ ਜਿਸ ਨੂੰ ਤੁਸੀਂ ਜਾਂਚ ਸਕੋ, ਅਤੇ ਸਮਾਂ ਮੁੱਕਣ ਤੋਂ ਪਹਿਲਾਂ ਗੱਡੀ ਹਟਾਉਣ ਦੀ ਯਾਦ ਵੀ ਕਰਵਾ ਦੇਈਏ। ਇਹ ਰਹੀ ਦੋਸਤਾਨਾ ਜਾਣ-ਪਛਾਣ।',
  },
  'about.evidence.items.0': {
    en: 'Download the whole thing as a tidy PDF. Handy if you ever need to dispute a fine.',
    'zh-CN': '可以下载为整齐的 PDF，万一需要对罚款提出申诉时非常有用。',
    el: 'Κατέβασε όλο το πακέτο ως ένα προσεγμένο PDF. Είναι χρήσιμο αν ποτέ χρειαστεί να αμφισβητήσεις ένα πρόστιμο.',
  },
  'about.appeal.title': {
    en: 'Got a fine anyway?',
    'zh-CN': '万一还是被罚款了？',
    el: 'Πήρες πρόστιμο παρόλα αυτά;',
    hi: 'फिर भी जुर्माना लग गया?',
    pa: 'ਫਿਰ ਵੀ ਜੁਰਮਾਨਾ ਲੱਗ ਗਿਆ?',
  },
  'about.appeal.items.0': {
    en: "Photograph the infringement notice. We'll cross-check it against what we saved when you parked.",
    'zh-CN': '拍下违章通知。我们会用你停车时保存的记录核对一遍。',
    vi: 'Chụp ảnh thông báo vi phạm. Chúng tôi sẽ đối chiếu với hồ sơ đã lưu khi bạn đỗ xe.',
    id: 'Foto surat dendanya. Kami cocokkan dengan apa yang tersimpan waktu kamu parkir.',
    it: 'Fotografa il verbale. Lo incroceremo con quello che abbiamo salvato quando hai parcheggiato.',
    hi: 'उल्लंघन नोटिस की फोटो लें। हम उसे उससे मिलाकर देखेंगे जो आपने पार्किंग के समय सहेजा था।',
    pa: 'ਉਲੰਘਣਾ ਨੋਟਿਸ ਦੀ ਫੋਟੋ ਲਓ। ਅਸੀਂ ਪਾਰਕਿੰਗ ਦੇ ਸਮੇਂ ਜੋ ਸੰਭਾਲਿਆ ਸੀ ਉਸ ਨਾਲ ਮਿਲਾਨ ਕਰਾਂਗੇ।',
  },
  'about.support.body': {
    en: 'Built solo in 10 days, free forever. If it saved you from a fine, chip in for the AWS bill.',
    'zh-CN': '一个人花 10 天打造,永久免费。如果它帮你躲过了一笔罚款,可以请我喝杯咖啡。',
    vi: 'Tự tay làm một mình trong 10 ngày, miễn phí mãi mãi. Nếu nó giúp bạn tránh được một khoản tiền phạt, hãy góp một tay cho hoá đơn AWS.',
    ko: '혼자 10일 동안 만들었고, 앞으로도 쭉 무료입니다. 덕분에 주차 벌금을 피하셨다면 커피 한 잔 보태주세요.',
    el: 'Φτιάχτηκε από έναν άνθρωπο σε 10 μέρες, δωρεάν για πάντα. Αν σε γλίτωσε από ένα πρόστιμο, κέρασέ με έναν καφέ.',
    hi: '10 दिनों में अकेले बनाया, हमेशा के लिए मुफ़्त। अगर इसकी वजह से आप किसी जुर्माने से बच गए, तो मुझे एक कॉफ़ी पिला दीजिए।',
    pa: '10 ਦਿਨਾਂ ਵਿੱਚ ਇਕੱਲੇ ਬਣਾਇਆ, ਹਮੇਸ਼ਾ ਲਈ ਮੁਫ਼ਤ। ਜੇ ਇਸਨੇ ਤੁਹਾਨੂੰ ਕਿਸੇ ਜੁਰਮਾਨੇ ਤੋਂ ਬਚਾਇਆ, ਤਾਂ ਮੈਨੂੰ ਇੱਕ ਕੌਫੀ ਪਿਆ ਦਿਓ।',
  },
  'landing.bullet.defensible': {
    en: "Tamper-evident if you're fined",
    'zh-CN': '被罚款时，可核对记录是否被改动',
    el: 'Με ανιχνεύσιμη αλλοίωση αν σου βάλουν πρόστιμο',
    hi: 'जुर्माना लगने पर छेड़छाड़ पकड़ी जा सकती है',
    pa: "ਜੁਰਮਾਨਾ ਲੱਗਣ 'ਤੇ ਛੇੜਛਾੜ-ਪਛਾਣਯੋਗ",
  },
  'home.tagline': {
    en: 'Aussie parking, decoded, with photo evidence in case of a wrongful fine.',
    'zh-CN': '澳洲停车,一眼看懂,还顺手存好照片证据,以防被错误罚款。',
    el: 'Η αυστραλιανή στάθμευση, αποκωδικοποιημένη. Με φωτογραφική απόδειξη αν σου βάλουν άδικο πρόστιμο.',
  },
  'home.draftAppeal': {
    en: 'Got a fine? Draft an appeal',
    'zh-CN': '收到罚款?起草申诉信',
    el: 'Πήρες πρόστιμο; Σύνταξε ένσταση',
    hi: 'जुर्माना मिला? अपील का मसौदा तैयार करें',
    pa: 'ਜੁਰਮਾਨਾ ਮਿਲਿਆ? ਅਪੀਲ ਦਾ ਖਰੜਾ ਤਿਆਰ ਕਰੋ',
  },
  'reminders.expired': {
    en: 'Parking expired at <strong>{{when}}</strong>. Too late for a reminder, but your record is still saved as evidence if you need to dispute a fine.',
    'zh-CN': '停车已于 <strong>{{when}}</strong> 到期。提醒已经来不及了,但你的记录仍作为证据保存,需要对罚款提出异议时能用上。',
    el: 'Η στάθμευση έληξε στις <strong>{{when}}</strong>. Πολύ αργά για υπενθύμιση, αλλά το αρχείο σου μένει αποθηκευμένο ως απόδειξη αν χρειαστεί να αμφισβητήσεις ένα πρόστιμο.',
  },
  'session.notePlaceholder': {
    en: "Why you were here, e.g. 'Mum's chemo at the Royal', 'Saturday market on Lygon'. It goes in this record's PDF, in case you ever need to appeal a fine.",
    'zh-CN': '你为什么停在这里,比如"妈妈在皇家医院化疗"、"Lygon 街周六市集"。它会写进这条记录的 PDF,以备日后需要对罚款提出申诉。',
    vi: "Vì sao bạn ở đây? Ví dụ: 'Đưa mẹ đi hoá trị tại Royal', 'Chợ thứ Bảy ở Lygon'. Ghi chú sẽ được đưa vào file PDF của bản ghi này, phòng khi bạn cần khiếu nại một khoản phạt.",
    id: "Kenapa kamu di sini, misalnya 'kemoterapi ibu di RS Royal', 'pasar Sabtu di Lygon'. Ini ikut dimuat di PDF catatan parkir ini, kalau-kalau suatu saat kamu perlu mengajukan banding atas denda.",
    ko: "여기 계셨던 이유를 적어 주세요. 예: 'Royal 병원에서 어머니 항암치료', 'Lygon 토요일 시장'. 이 기록의 PDF에 함께 들어가므로, 나중에 벌금에 이의신청을 할 때 쓸 수 있습니다.",
    it: 'Perché eri qui, es. "Chemio della mamma al Royal", "Mercato del sabato a Lygon". Viene inclusa nel PDF di questo record, nel caso dovessi mai fare ricorso contro una multa.',
    el: 'Γιατί ήσουν εδώ, π.χ. «Χημειοθεραπεία της μαμάς στο Royal», «Λαϊκή Σαββάτου στο Lygon». Μπαίνει στο PDF αυτού του αρχείου, σε περίπτωση που χρειαστεί ποτέ να κάνεις ένσταση για ένα πρόστιμο.',
    hi: "आप यहाँ क्यों थे, जैसे 'माँ की Royal में कीमो', 'Lygon पर शनिवार का बाज़ार'। यह इस रिकॉर्ड की PDF में शामिल होता है, ताकि कभी जुर्माने के ख़िलाफ़ अपील करनी पड़े तो काम आए।",
    pa: "ਤੁਸੀਂ ਇੱਥੇ ਕਿਉਂ ਸੀ, ਜਿਵੇਂ 'ਮਾਂ ਦਾ Royal 'ਤੇ ਕੀਮੋ', 'Lygon 'ਤੇ ਸ਼ਨੀਵਾਰ ਦਾ ਬਾਜ਼ਾਰ'। ਇਹ ਇਸ ਰਿਕਾਰਡ ਦੀ PDF ਵਿੱਚ ਸ਼ਾਮਲ ਹੁੰਦਾ ਹੈ, ਤਾਂ ਜੋ ਕਦੇ ਜੁਰਮਾਨੇ ਵਿਰੁੱਧ ਅਪੀਲ ਕਰਨੀ ਪਵੇ ਤਾਂ ਕੰਮ ਆਵੇ।",
  },
  'session.draftAppeal': {
    en: 'Got a fine? Draft an appeal letter',
    'zh-CN': '收到罚款?起草申诉信',
    el: 'Πήρες πρόστιμο; Σύνταξε επιστολή ένστασης',
    hi: 'जुर्माना मिला? अपील पत्र का मसौदा तैयार करें',
    pa: 'ਜੁਰਮਾਨਾ ਮਿਲਿਆ? ਅਪੀਲ ਪੱਤਰ ਦਾ ਖਰੜਾ ਤਿਆਰ ਕਰੋ',
  },
  'appeal.captureTakePhotoSub': {
    en: 'Photograph the notice',
    'zh-CN': '用相机拍下通知',
    vi: 'Chụp ảnh thông báo',
    id: 'Foto surat dendanya',
    ko: '카메라로 통지서 찍기',
    it: 'Fotografa la notifica',
    el: 'Φωτογράφισε την κλήση',
    hi: 'नोटिस की फोटो लें',
    pa: 'ਨੋਟਿਸ ਦੀ ਫੋਟੋ ਖਿੱਚੋ',
  },
  'appeal.draftingHeader': {
    en: 'Reading the notice…',
    'zh-CN': '正在读取通知…',
    vi: 'Đang đọc thông báo…',
    ko: '통지서 읽는 중…',
    it: 'Lettura della notifica…',
    hi: 'नोटिस पढ़ा जा रहा है…',
    pa: 'ਨੋਟਿਸ ਪੜ੍ਹਿਆ ਜਾ ਰਿਹਾ ਹੈ…',
  },
}

// ── helpers ─────────────────────────────────────────────────────────────
function fail(msg) {
  console.error(`ABORT (nothing written): ${msg}`)
  process.exit(1)
}

/**
 * The container holding `path`'s leaf and the leaf's key, or null when any
 * step is missing. Object steps must be own keys; array steps must be an
 * index inside the array.
 */
function locate(root, path) {
  const parts = path.split('.')
  const leaf = parts.pop()
  let node = root
  for (const p of parts) {
    if (Array.isArray(node)) {
      if (!/^\d+$/.test(p) || Number(p) >= node.length) return null
      node = node[Number(p)]
    } else if (node && typeof node === 'object' && Object.hasOwn(node, p)) {
      node = node[p]
    } else {
      return null
    }
  }
  if (Array.isArray(node)) {
    if (!/^\d+$/.test(leaf) || Number(leaf) >= node.length) return null
    return { node, leaf: Number(leaf) }
  }
  if (!node || typeof node !== 'object' || !Object.hasOwn(node, leaf)) return null
  return { node, leaf }
}

/** The string at `path`, or undefined when there is no string there. */
function stringAt(root, path) {
  const at = locate(root, path)
  return at && typeof at.node[at.leaf] === 'string' ? at.node[at.leaf] : undefined
}

/** Rewrite an existing string in place. Aborts when it isn't there: an overwrite never adds a key. */
function overwrite(root, path, value, locale) {
  const at = locate(root, path)
  if (!at || typeof at.node[at.leaf] !== 'string') fail(`${locale}: ${path} to overwrite is not an existing string`)
  at.node[at.leaf] = value
}

/** Set a key this script owns: appended at the end of its parent when new, rewritten in place when present. */
function setOwned(root, path, value, locale) {
  const parts = path.split('.')
  const leaf = parts.pop()
  let node = root
  for (const p of parts) {
    if (node[p] === undefined) node[p] = {}
    if (!node[p] || typeof node[p] !== 'object' || Array.isArray(node[p])) fail(`${locale}: "${p}" in ${path} is not an object`)
    node = node[p]
  }
  if (node[leaf] !== undefined && typeof node[leaf] !== 'string') fail(`${locale}: ${path} is not a string`)
  node[leaf] = value
}

/** Delete a string key when present. Never deletes an object, an array item or anything else. */
function remove(root, path, locale) {
  const parts = path.split('.')
  const leaf = parts.pop()
  let node = root
  for (const p of parts) {
    node = node && typeof node === 'object' && !Array.isArray(node) ? node[p] : undefined
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
  }
  if (!Object.hasOwn(node, leaf)) return
  if (typeof node[leaf] !== 'string') fail(`${locale}: ${path} to delete is not a string`)
  delete node[leaf]
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

/**
 * "ticket" alone, which can read as a fine in English. A pay-and-display
 * ticket is "meter ticket" or "pay-and-display ticket" (the same rule as
 * src/lib/copy-lint.test.ts).
 */
export const loneTicket = (s) =>
  /\btickets?\b|\bticket(ed|ing)\b/i.test(s.replace(/\b(meter|pay-and-display) tickets?\b/gi, ''))

/** The text of the one <add>…</add> in a string, or null when there isn't exactly one. */
export function addButtonText(s) {
  const opens = s.match(/<add>/g) || []
  const tags = s.match(/<\/?[a-zA-Z][\w-]*\s*\/?>/g) || []
  const m = s.match(/<add>([^<]*)<\/add>/)
  if (opens.length !== 1 || tags.length !== 2 || !m) return null
  return m[1]
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
    for (const path of DELETIONS) if (path in flat) problems.push(`${locale}: ${path} is still there after deleting it`)

    // The button inside the sentence keeps the heading button's name.
    const line = stringAt(all[locale], 'session.noteEmpty')
    const button = line === undefined ? null : addButtonText(line)
    if (button === null) problems.push(`${locale}: session.noteEmpty needs exactly one <add>…</add> and no other tag`)
    else if (button !== stringAt(all[locale], 'session.addNote')) {
      problems.push(`${locale}: the button in session.noteEmpty ("${button}") isn't session.addNote`)
    }
  }
  for (const [path, byLocale] of [...Object.entries(ADDITIONS), ...Object.entries(OVERWRITES)]) {
    if (DELETIONS.includes(path)) problems.push(`${path} is both written and deleted`)
    if (typeof byLocale.en !== 'string') problems.push(`${path} has no en text`)
    for (const [locale, s] of Object.entries(byLocale)) {
      if (!LOCALES.includes(locale)) problems.push(`${path}: ${locale} is not a ParkProof locale`)
      // Copy rules: no em-dashes, and no symbols or emoji in new copy.
      if (s.includes(EM_DASH)) problems.push(`${locale}: em-dash in new copy at ${path}`)
      if (/[✓⚠→≈≤±\u{1F300}-\u{1FAFF}]/u.test(s)) problems.push(`${locale}: symbol in new copy at ${path}`)
    }
    const en_ = byLocale.en ?? ''
    // The en record noun is "record", never "session".
    if (/\bsessions?\b/i.test(en_)) problems.push(`"session" in en copy at ${path}`)
    // Words and claims the copy rules ban outright.
    if (
      /\b(reset|compliant|compliance proven|admissible|authentic|verified location|accepted by (insurers|council)|strong evidence|proves?|proved)\b/i.test(
        en_,
      )
    ) {
      problems.push(`banned wording in en copy at ${path}`)
    }
    if (loneTicket(en_)) problems.push(`"ticket" alone in en copy at ${path}: say "fine", "notice" or "meter ticket"`)
  }
  for (const path of Object.keys(ADDITIONS)) {
    for (const locale of LOCALES) if (typeof ADDITIONS[path][locale] !== 'string') problems.push(`no ${locale} text for new key ${path}`)
  }
  return problems
}

/**
 * The copy pass and the T10 review run before this script and would win if
 * run again after it, so: a key this script overwrites in a locale must
 * carry this script's text in that locale's file, and a key it adds or
 * deletes must not be in any file.
 */
function laterRunProblems() {
  const problems = []
  for (const [dir, label] of [
    [PASS, 'scripts/copy-pass'],
    [REVIEW, 'scripts/t10-review'],
  ]) {
    for (const locale of LOCALES) {
      const file = join(dir, `${locale}.json`)
      if (!existsSync(file)) continue
      const data = JSON.parse(readFileSync(file, 'utf8'))
      for (const [path, byLocale] of Object.entries(OVERWRITES)) {
        if (typeof byLocale[locale] === 'string' && path in data && data[path] !== byLocale[locale]) {
          problems.push(`${label}/${locale}.json has other text for ${path}, which would undo this script`)
        }
      }
      for (const path of [...Object.keys(ADDITIONS), ...DELETIONS]) {
        if (path in data) problems.push(`${label}/${locale}.json writes ${path}, which this script owns or deletes`)
      }
    }
  }
  return problems
}

function main() {
  if (process.argv.includes('--list')) {
    for (const [path, byLocale] of Object.entries(ADDITIONS)) console.log(`      ${path}  (added: ${Object.keys(byLocale).join(' ')})`)
    for (const [path, byLocale] of Object.entries(OVERWRITES)) console.log(`      ${path}  (overwrite: ${Object.keys(byLocale).join(' ')})`)
    for (const path of DELETIONS) console.log(`      ${path}  (deleted)`)
    return
  }

  const later = laterRunProblems()
  if (later.length) fail(`\n  ${later.join('\n  ')}`)

  const original = {}
  const data = {}
  for (const locale of LOCALES) {
    original[locale] = readFileSync(join(LOC, `${locale}.json`), 'utf8')
    data[locale] = JSON.parse(original[locale])
  }

  for (const locale of LOCALES) {
    for (const path of DELETIONS) remove(data[locale], path, locale)
    for (const [path, byLocale] of Object.entries(ADDITIONS)) setOwned(data[locale], path, byLocale[locale], locale)
    for (const [path, byLocale] of Object.entries(OVERWRITES)) {
      if (typeof byLocale[locale] === 'string') overwrite(data[locale], path, byLocale[locale], locale)
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
}

// Run only when called as a script, so a test or a one-off can import the data.
const self = fileURLToPath(import.meta.url)
const invoked = process.argv[1] ? resolve(process.argv[1]) : ''
if (process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self) main()
