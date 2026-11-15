/**
 * Delete hardening i18n (fix/before-test-week): the strings for deleting an
 * account. Idempotent: running it twice leaves the files byte-identical
 * after the first run.
 *
 * Run order: LAST, after scripts/_i18n_inject_last_lows.mjs. The full chain
 * is fix_push, t6a, t8, t3, t5, t2, t4, t7, t6bc, fixlist_final, copy_pass,
 * t10_review, last_lows, then this script. Never re-run the T0a to T1b
 * scripts. No other inject script or data file writes the keys this script
 * owns: the copy pass (scripts/copy-pass/<locale>.json) and the T10 review
 * (scripts/t10-review/<locale>.json) must not carry any of them, which is
 * checked below before anything is written, so running either of them again
 * after this script changes nothing.
 *
 * ADDITIONS (new keys):
 *   - `errors.deleteAccountFailed`: Account, "Delete forever", when the
 *     delete fails (AuthSettings.tsx). It replaces the raw API text the
 *     screen used to show ("API 500: ..."), which was English in every
 *     locale. The records on this device are cleared only after the account
 *     is deleted, so they are still there when it fails.
 *   - `privacy.rightsDeleteOtherDevices` (legal): the privacy policy's item
 *     right after `privacy.rightsDelete` (PrivacyPolicy.tsx). Once an account
 *     is deleted, the server keeps its random ID and when it was deleted for
 *     a few days, so a device still signed in to it is refused (HTTP 410
 *     ERR_ACCOUNT_DELETED) instead of uploading records into it again, and
 *     signs out (src/lib/sync.ts authFetch, src/lib/auth-context.tsx). The
 *     server's logs record that ID too, at the delete and at each refusal
 *     ("[parkproof.me.delete]", "[parkproof.account]" in
 *     lambda/cloud-sync.js), and a record's random ID only when the row a
 *     refused device uploaded can't be deleted again ("row delete after
 *     refusal failed"). They are deleted after 90 days
 *     (scripts/setup-log-retention.sh). Signing out never clears that
 *     device's records, its own or pulled from the account: they stay until
 *     the driver deletes them there. "A few days" stays words in every
 *     locale, and 90 is the only number (checked below).
 *   - `settings.accountDeletedNotice`: Home and Account, on a device signed
 *     out because its account was deleted (App.tsx, AuthSettings.tsx),
 *     whichever device deleted it: another device, or this one when the
 *     answer to its Delete forever was lost (the delete may have gone
 *     through, and its next refused call signs it out). So it says only that
 *     the account was deleted, never where. Its records stay on it.
 * REMOVALS (REMOVED below: keys this script deletes from every locale that
 * still has one):
 *   - the notice's first key, which said the account was deleted on another
 *     device. That was wrong for a device whose own Delete forever lost its
 *     answer, so `settings.accountDeletedNotice` replaced it: the same text
 *     in each locale, without "on another device".
 * REWRITES (existing keys this script now owns, rewritten in place):
 *   - `privacy.rightsDelete` (legal): it said Delete removes "every DynamoDB
 *     row", but the delete itself writes one (the deletion marker above) and
 *     keeps it for a few days. It now says what goes: the sign-in record and
 *     every record and photo stored for the account (old photo versions
 *     included: deleteObjectsUnder in lambda/cloud-sync.js and
 *     scripts/setup-evidence-versions.sh). No earlier script writes it.
 * The terms follow each locale's existing account, record, device, delete,
 * sign in, sign out and upload strings (settings.deleteHeader,
 * settings.deleteCopy, settings.youSignedOut, privacy.rightsDelete,
 * privacy.rightsAnonymous, session.photoSyncRetry), checked against
 * docs/legal-pdf-review-worksheet.md, in the register the i18n rules set
 * (CLAUDE.md): el εσύ, id kamu, zh-CN 你, gender-neutral hi and pa.
 *
 * Writes nothing (exit 1) when:
 *   - an addition or rewrite has no text for one of the 9 locales, or a
 *     rewrite's key isn't in a locale already;
 *   - after applying, any locale fails the parity checks
 *     src/lib/locales.test.ts enforces (keys, array lengths, {{vars}},
 *     <tags>, plural pairs);
 *   - its text has an em-dash or a symbol, or the en text says "session",
 *     uses banned wording or says "ticket" alone;
 *   - `privacy.rightsDeleteOtherDevices` has any number but 90 in any
 *     locale, or lacks the 90;
 *   - a key it removes is also one it writes, or is still in a locale after
 *     applying;
 *   - a copy-pass or T10 review file writes any of its keys, or a key it
 *     removes (running that pass again would bring it back).
 *
 * Run:   node scripts/_i18n_inject_delete_hardening.mjs
 * List:  node scripts/_i18n_inject_delete_hardening.mjs --list
 *        prints every key this script adds, rewrites or removes and the
 *        locales it writes, for a translation review ('legal' marks the
 *        statements a lawyer should read, listed in
 *        docs/legal-review-queue.md). Writes nothing.
 * Other: node scripts/_i18n_inject_delete_hardening.mjs --dir <locales dir>
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

/** Keys whose wording makes a claim a lawyer should read (docs/legal-review-queue.md, section 7). */
export const LEGAL = new Set(['privacy.rightsDeleteOtherDevices', 'privacy.rightsDelete'])

// ── New keys (all 9 locales) ────────────────────────────────────────────
// This script owns these keys, so a re-run rewrites them to the text below
// (in place, keeping their position). A new key is appended at the end of
// its parent object.
export const ADDITIONS = {
  'errors.deleteAccountFailed': {
    en: "Couldn't finish deleting your account. Your records on this device are still here. Check your connection, then try again.",
    'zh-CN': '账户删除没能完成。你在这台设备上的记录都还在。请检查网络连接，然后重试。',
    vi: 'Chưa xoá xong tài khoản của bạn. Các bản ghi của bạn trên thiết bị này vẫn còn nguyên. Hãy kiểm tra kết nối, rồi thử lại.',
    id: 'Akunmu belum selesai dihapus. Catatanmu di perangkat ini masih ada. Cek koneksimu, lalu coba lagi.',
    ko: '계정 삭제를 완료하지 못했습니다. 이 기기에 있는 기록은 그대로 남아 있습니다. 연결 상태를 확인한 다음 다시 시도하세요.',
    it: "Non siamo riusciti a completare l'eliminazione del tuo account. I tuoi record su questo dispositivo sono ancora qui. Controlla la connessione, poi riprova.",
    el: 'Δεν μπορέσαμε να ολοκληρώσουμε τη διαγραφή του λογαριασμού σου. Τα αρχεία σου σε αυτή τη συσκευή είναι ακόμα εδώ. Έλεγξε τη σύνδεσή σου και μετά δοκίμασε ξανά.',
    hi: 'आपका खाता हटाने की प्रक्रिया पूरी नहीं हो सकी। इस डिवाइस पर आपके रिकॉर्ड अब भी मौजूद हैं। अपना कनेक्शन जांचें, फिर दोबारा कोशिश करें।',
    pa: "ਤੁਹਾਡਾ ਖਾਤਾ ਮਿਟਾਉਣ ਦੀ ਪ੍ਰਕਿਰਿਆ ਪੂਰੀ ਨਹੀਂ ਹੋ ਸਕੀ। ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਹਾਲੇ ਵੀ ਮੌਜੂਦ ਹਨ। ਆਪਣਾ ਕਨੈਕਸ਼ਨ ਜਾਂਚੋ, ਫਿਰ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
  },
  'privacy.rightsDeleteOtherDevices': {
    en: "When you delete your account, we keep its random ID and the deletion time for a few days, so a device still signed in to it can't upload records again. Our server's logs also record that ID when you delete the account and each time such a device is refused, with what was asked for, whether each step worked and how many records and photos were removed. If a record from such a device can't be removed, the log also gives that record's random ID. The logs are deleted after 90 days. Your records on another device stay on that device until you delete them there.",
    'zh-CN':
      '你删除账户后，我们会把该账户的随机 ID 和你删除它的时间保留几天，这样仍登录着该账户的设备就无法再上传记录。你删除账户时，以及这类设备每次被拒绝时，我们服务器的日志还会记录这个 ID，以及请求的内容、每个步骤是否成功，和删除了多少条记录和多少张照片。如果来自这类设备的某条记录无法删除，日志还会记下那条记录的随机 ID。这些日志会在 90 天后删除。你在另一台设备上的记录会留在那台设备上，直到你在那台设备上删除它们。',
    vi: 'Khi bạn xoá tài khoản, trong vài ngày chúng tôi vẫn giữ mã ngẫu nhiên của tài khoản đó và thời điểm xoá, để một thiết bị vẫn đang đăng nhập vào tài khoản đó không thể tải bản ghi lên lại. Nhật ký máy chủ của chúng tôi cũng ghi lại mã đó khi bạn xoá tài khoản và mỗi lần một thiết bị như vậy bị từ chối, cùng với yêu cầu đã gửi, việc mỗi bước có thành công hay không, và số bản ghi và ảnh đã bị xoá. Nếu một bản ghi từ thiết bị như vậy không xoá được, nhật ký còn ghi mã ngẫu nhiên của bản ghi đó. Nhật ký này bị xoá sau 90 ngày. Các bản ghi của bạn trên một thiết bị khác vẫn nằm trên thiết bị đó cho đến khi bạn xoá chúng ở đó.',
    id: 'Saat kamu menghapus akunmu, selama beberapa hari kami menyimpan ID acak akun itu dan waktu penghapusannya, supaya perangkat yang masih masuk ke akun itu tidak bisa mengunggah catatan lagi. Log server kami juga mencatat ID itu saat kamu menghapus akun dan setiap kali perangkat seperti itu ditolak, beserta apa yang diminta, apakah setiap langkah berhasil, dan berapa banyak catatan dan foto yang dihapus. Kalau catatan dari perangkat seperti itu tidak bisa dihapus, log itu juga mencatat ID acak catatan tersebut. Log ini dihapus setelah 90 hari. Catatanmu di perangkat lain tetap ada di perangkat itu sampai kamu menghapusnya di sana.',
    ko: '계정을 삭제하면, 아직 그 계정에 로그인되어 있는 기기가 기록을 다시 업로드하지 못하도록 계정의 임의 ID와 삭제한 시각을 며칠 동안 보관합니다. 계정을 삭제할 때와 그런 기기의 요청이 거부될 때마다, 저희 서버 로그에는 그 ID와 함께 요청 내용, 각 단계의 성공 여부, 삭제된 기록과 사진의 수도 기록됩니다. 그런 기기에서 온 기록을 삭제하지 못하면, 로그에는 그 기록의 임의 ID도 남습니다. 이 로그는 90일 후 삭제됩니다. 다른 기기에 있는 기록은 그 기기에서 삭제할 때까지 그 기기에 남아 있습니다.',
    it: "Quando elimini il tuo account, ne conserviamo per qualche giorno l'ID casuale e il momento in cui lo hai eliminato, così un dispositivo ancora connesso a quell'account non può caricare di nuovo dei record. I log del nostro server registrano anche quell'ID quando elimini l'account e ogni volta che un dispositivo del genere viene respinto, insieme a cosa è stato chiesto, se ogni passaggio è riuscito e quanti record e foto sono stati rimossi. Se non si riesce a rimuovere un record arrivato da un dispositivo del genere, il log riporta anche l'ID casuale di quel record. I log vengono cancellati dopo 90 giorni. I tuoi record su un altro dispositivo restano su quel dispositivo finché non li elimini lì.",
    el: 'Όταν διαγράφεις τον λογαριασμό σου, κρατάμε για λίγες ημέρες το τυχαίο αναγνωριστικό του και την ώρα που τον διέγραψες, ώστε μια συσκευή που είναι ακόμα συνδεδεμένη σε αυτόν να μην μπορεί να ανεβάσει ξανά αρχεία. Τα αρχεία καταγραφής του server μας σημειώνουν επίσης αυτό το αναγνωριστικό όταν διαγράφεις τον λογαριασμό και κάθε φορά που απορρίπτεται μια τέτοια συσκευή, μαζί με το τι ζητήθηκε, αν πέτυχε κάθε βήμα και πόσα αρχεία και φωτογραφίες αφαιρέθηκαν. Αν δεν μπορεί να αφαιρεθεί ένα αρχείο από μια τέτοια συσκευή, το αρχείο καταγραφής σημειώνει επίσης το τυχαίο αναγνωριστικό εκείνου του αρχείου. Τα αρχεία καταγραφής διαγράφονται μετά από 90 ημέρες. Τα αρχεία σου σε άλλη συσκευή μένουν σε εκείνη τη συσκευή μέχρι να τα διαγράψεις από εκεί.',
    hi: 'जब आप अपना खाता हटाते हैं, तो हम उसकी रैंडम ID और उसे हटाने का समय कुछ दिनों तक रखते हैं, ताकि जो डिवाइस अब भी उस खाते में साइन इन है, वह फिर से रिकॉर्ड अपलोड न कर सके। जब आप खाता हटाते हैं और जब भी ऐसे किसी डिवाइस का अनुरोध ठुकराया जाता है, तब हमारे सर्वर के लॉग में भी वह ID दर्ज होती है, साथ में क्या माँगा गया, हर चरण सफल हुआ या नहीं, और कितने रिकॉर्ड और फोटो हटाए गए। अगर ऐसे किसी डिवाइस से आया कोई रिकॉर्ड हटाया न जा सके, तो लॉग में उस रिकॉर्ड की रैंडम ID भी दर्ज होती है। ये लॉग 90 दिन बाद मिटा दिए जाते हैं। किसी दूसरे डिवाइस पर मौजूद आपके रिकॉर्ड उसी डिवाइस पर तब तक रहते हैं, जब तक आप उन्हें वहाँ से नहीं हटाते।',
    pa: "ਜਦੋਂ ਤੁਸੀਂ ਆਪਣਾ ਖਾਤਾ ਮਿਟਾਉਂਦੇ ਹੋ, ਤਾਂ ਅਸੀਂ ਉਸ ਦੀ ਰੈਂਡਮ ID ਅਤੇ ਉਸ ਨੂੰ ਮਿਟਾਉਣ ਦਾ ਸਮਾਂ ਕੁਝ ਦਿਨਾਂ ਲਈ ਰੱਖਦੇ ਹਾਂ, ਤਾਂ ਜੋ ਜਿਹੜੀ ਡਿਵਾਈਸ ਅਜੇ ਵੀ ਉਸ ਖਾਤੇ ਵਿੱਚ ਸਾਈਨ ਇਨ ਹੈ, ਉਹ ਦੁਬਾਰਾ ਰਿਕਾਰਡ ਅੱਪਲੋਡ ਨਾ ਕਰ ਸਕੇ। ਜਦੋਂ ਤੁਸੀਂ ਖਾਤਾ ਮਿਟਾਉਂਦੇ ਹੋ ਅਤੇ ਜਦੋਂ ਵੀ ਅਜਿਹੀ ਕਿਸੇ ਡਿਵਾਈਸ ਦੀ ਬੇਨਤੀ ਠੁਕਰਾਈ ਜਾਂਦੀ ਹੈ, ਤਾਂ ਸਾਡੇ ਸਰਵਰ ਦੇ ਲੌਗ ਵਿੱਚ ਵੀ ਉਹ ID ਦਰਜ ਹੁੰਦੀ ਹੈ, ਨਾਲ ਹੀ ਕੀ ਮੰਗਿਆ ਗਿਆ, ਹਰ ਕਦਮ ਸਫਲ ਹੋਇਆ ਜਾਂ ਨਹੀਂ, ਅਤੇ ਕਿੰਨੇ ਰਿਕਾਰਡ ਅਤੇ ਫੋਟੋਆਂ ਹਟਾਈਆਂ ਗਈਆਂ। ਜੇ ਅਜਿਹੀ ਕਿਸੇ ਡਿਵਾਈਸ ਤੋਂ ਆਇਆ ਕੋਈ ਰਿਕਾਰਡ ਹਟਾਇਆ ਨਾ ਜਾ ਸਕੇ, ਤਾਂ ਲੌਗ ਵਿੱਚ ਉਸ ਰਿਕਾਰਡ ਦੀ ਰੈਂਡਮ ID ਵੀ ਦਰਜ ਹੁੰਦੀ ਹੈ। ਇਹ ਲੌਗ 90 ਦਿਨਾਂ ਬਾਅਦ ਮਿਟਾ ਦਿੱਤੇ ਜਾਂਦੇ ਹਨ। ਕਿਸੇ ਹੋਰ ਡਿਵਾਈਸ 'ਤੇ ਮੌਜੂਦ ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਉਸੇ ਡਿਵਾਈਸ 'ਤੇ ਉਦੋਂ ਤੱਕ ਰਹਿੰਦੇ ਹਨ, ਜਦੋਂ ਤੱਕ ਤੁਸੀਂ ਉਨ੍ਹਾਂ ਨੂੰ ਉੱਥੋਂ ਨਹੀਂ ਮਿਟਾਉਂਦੇ।",
  },
  'settings.accountDeletedNotice': {
    en: "Your account was deleted, so you're signed out on this device. Your records on this device are still here.",
    'zh-CN': '你的账户已删除，所以这台设备已退出登录。你在这台设备上的记录都还在。',
    vi: 'Tài khoản của bạn đã bị xoá, nên thiết bị này đã được đăng xuất. Các bản ghi của bạn trên thiết bị này vẫn còn nguyên.',
    id: 'Akunmu sudah dihapus, jadi kamu sudah keluar di perangkat ini. Catatanmu di perangkat ini masih ada.',
    ko: '계정이 삭제되어 이 기기에서 로그아웃되었습니다. 이 기기에 있는 기록은 그대로 남아 있습니다.',
    it: "Il tuo account è stato eliminato, quindi questo dispositivo è stato disconnesso dall'account. I tuoi record su questo dispositivo sono ancora qui.",
    el: 'Ο λογαριασμός σου διαγράφηκε, οπότε έχεις αποσυνδεθεί σε αυτή τη συσκευή. Τα αρχεία σου σε αυτή τη συσκευή είναι ακόμα εδώ.',
    hi: 'आपका खाता हटा दिया गया है, इसलिए इस डिवाइस से साइन आउट कर दिया गया है। इस डिवाइस पर आपके रिकॉर्ड अब भी मौजूद हैं।',
    pa: "ਤੁਹਾਡਾ ਖਾਤਾ ਮਿਟਾ ਦਿੱਤਾ ਗਿਆ ਹੈ, ਇਸ ਲਈ ਇਸ ਡਿਵਾਈਸ ਤੋਂ ਸਾਈਨ ਆਊਟ ਕਰ ਦਿੱਤਾ ਗਿਆ ਹੈ। ਇਸ ਡਿਵਾਈਸ 'ਤੇ ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਹਾਲੇ ਵੀ ਮੌਜੂਦ ਹਨ।",
  },
}

// ── Rewritten keys (all 9 locales) ──────────────────────────────────────
// Keys that were already there, which this script now owns: a run rewrites
// each in place, and refuses to add one a locale doesn't have.
export const REWRITES = {
  'privacy.rightsDelete': {
    en: '<strong>Delete.</strong> Tap "Delete account" in Account. Removes your sign-in record and every record and photo stored for your account, within seconds. Irreversible.',
    'zh-CN': '<strong>删除。</strong>在账户里点"删除账户"。几秒内删掉你的登录记录，以及你账户里存储的每一条记录和每一张照片。无法撤销。',
    vi: '<strong>Xoá.</strong> Nhấn "Xoá tài khoản" trong Tài khoản. Xoá bản ghi đăng nhập của bạn cùng mọi bản ghi và mọi ảnh được lưu cho tài khoản của bạn trong vài giây. Không thể hoàn tác.',
    id: '<strong>Hapus.</strong> Ketuk "Hapus akun" di Akun. Menghapus catatan masukmu serta setiap catatan dan foto yang tersimpan untuk akunmu dalam hitungan detik. Tidak bisa dibatalkan.',
    ko: '<strong>삭제.</strong> 계정에서 "계정 삭제"를 누르세요. 로그인 기록, 그리고 계정에 저장된 모든 기록과 사진을 몇 초 안에 삭제. 되돌릴 수 없음.',
    it: '<strong>Elimina.</strong> Tocca "Elimina account" in Account. Rimuove in pochi secondi la tua registrazione di accesso e ogni record e foto salvati per il tuo account. Irreversibile.',
    el: '<strong>Διαγραφή.</strong> Πάτα "Διαγραφή λογαριασμού" στον Λογαριασμό. Αφαιρεί μέσα σε δευτερόλεπτα το αρχείο σύνδεσής σου και κάθε αρχείο και φωτογραφία που είναι αποθηκευμένα για τον λογαριασμό σου. Μη αναστρέψιμο.',
    hi: '<strong>हटाएँ।</strong> खाता में "खाता हटाएँ" पर टैप करें। आपका साइन-इन रिकॉर्ड और आपके खाते के लिए सहेजा गया हर रिकॉर्ड और हर फोटो सेकंडों में हटा देता है। वापस नहीं होता।',
    pa: '<strong>ਮਿਟਾਓ।</strong> ਖਾਤਾ ਵਿੱਚ "ਖਾਤਾ ਮਿਟਾਓ" \'ਤੇ ਟੈਪ ਕਰੋ। ਤੁਹਾਡਾ ਸਾਈਨ-ਇਨ ਰਿਕਾਰਡ ਅਤੇ ਤੁਹਾਡੇ ਖਾਤੇ ਲਈ ਸੰਭਾਲਿਆ ਹਰ ਰਿਕਾਰਡ ਅਤੇ ਹਰ ਫੋਟੋ ਸਕਿੰਟਾਂ ਵਿੱਚ ਹਟਾ ਦਿੰਦਾ ਹੈ। ਵਾਪਸ ਨਹੀਂ ਹੁੰਦਾ।',
  },
}

// ── Removed keys (all 9 locales) ────────────────────────────────────────
// Keys an earlier version of this script added: a run deletes each from
// every locale that still has it, and a locale without it is left as it is.
export const REMOVED = ['settings.deletedElsewhere']

/** Every key this script owns, added or rewritten. */
const OWNED = { ...ADDITIONS, ...REWRITES }

/**
 * The only number a key may hold, in every locale, and must: the logs' 90
 * days (RETENTION_DAYS in scripts/setup-log-retention.sh). "A few days" for
 * the server's own mark stays words: no number may promise a period.
 */
const ONLY_NUMBER = { 'privacy.rightsDeleteOtherDevices': '90' }

// ── helpers ─────────────────────────────────────────────────────────────
function fail(msg) {
  console.error(`ABORT (nothing written): ${msg}`)
  process.exit(1)
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

/** Delete a key this script removes, when the locale still has it. */
function removeKey(root, path, locale) {
  const parts = path.split('.')
  const leaf = parts.pop()
  let node = root
  for (const p of parts) {
    if (!node || typeof node !== 'object' || Array.isArray(node) || !Object.hasOwn(node, p)) return
    node = node[p]
  }
  if (!node || typeof node !== 'object' || Array.isArray(node) || !Object.hasOwn(node, leaf)) return
  if (typeof node[leaf] !== 'string') fail(`${locale}: ${path} is not a string`)
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
const loneTicket = (s) => /\btickets?\b|\bticket(ed|ing)\b/i.test(s.replace(/\b(meter|pay-and-display) tickets?\b/gi, ''))

/** Any digit: ASCII, Devanagari (hi), Gurmukhi (pa) or full-width (zh-CN). */
const DIGIT = /[0-9०-९੦-੯０-９]/

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
  for (const [path, byLocale] of Object.entries(OWNED)) {
    if (typeof byLocale.en !== 'string') problems.push(`${path} has no en text`)
    for (const [locale, s] of Object.entries(byLocale)) {
      if (!LOCALES.includes(locale)) problems.push(`${path}: ${locale} is not a ParkProof locale`)
      // Copy rules: no em-dashes, and no symbols or emoji in new copy.
      if (s.includes(EM_DASH)) problems.push(`${locale}: em-dash in new copy at ${path}`)
      if (/[✓⚠→≈≤±\u{1F300}-\u{1FAFF}]/u.test(s)) problems.push(`${locale}: symbol in new copy at ${path}`)
      // "A few days" in words: the server's period is its own, and no number
      // may promise one. The logs' 90 days is the one number, and it's there.
      const only = ONLY_NUMBER[path]
      if (only !== undefined) {
        if (!new RegExp(`(^|\\D)${only}(\\D|$)`).test(s)) problems.push(`${locale}: ${path} doesn't say ${only}`)
        if (DIGIT.test(s.split(only).join(''))) problems.push(`${locale}: a number other than ${only} in ${path}, which says "a few days" in words`)
      }
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
    for (const locale of LOCALES) if (typeof byLocale[locale] !== 'string') problems.push(`no ${locale} text for ${path}`)
  }
  for (const path of Object.keys(ADDITIONS)) if (path in REWRITES) problems.push(`${path} is both added and rewritten`)
  for (const path of LEGAL) if (!(path in OWNED)) problems.push(`${path} is marked legal but this script doesn't write it`)
  for (const path of REMOVED) {
    if (path in OWNED) problems.push(`${path} is both removed and written`)
    for (const locale of LOCALES) if (path in flatten(all[locale])) problems.push(`${locale}: ${path} is still there`)
  }
  return problems
}

/**
 * The copy pass and the T10 review run before this script and would win if
 * run again after it, so a key this script adds, rewrites or removes must
 * not be in any of their files.
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
      for (const path of Object.keys(OWNED)) {
        if (path in data) problems.push(`${label}/${locale}.json writes ${path}, which this script owns`)
      }
      for (const path of REMOVED) {
        if (path in data) problems.push(`${label}/${locale}.json writes ${path}, which this script removes`)
      }
    }
  }
  return problems
}

function main() {
  if (process.argv.includes('--list')) {
    for (const [path, byLocale] of Object.entries(OWNED)) {
      const how = path in REWRITES ? 'rewritten' : 'added'
      const tags = [`${how}: ${Object.keys(byLocale).join(' ')}`, LEGAL.has(path) ? 'legal' : null].filter(Boolean)
      console.log(`      ${path}  (${tags.join(', ')})`)
    }
    for (const path of REMOVED) console.log(`      ${path}  (removed: ${LOCALES.join(' ')})`)
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
    for (const path of REMOVED) removeKey(data[locale], path, locale)
    for (const [path, byLocale] of Object.entries(ADDITIONS)) {
      if (typeof byLocale[locale] !== 'string') fail(`no ${locale} text for new key ${path}`)
      setOwned(data[locale], path, byLocale[locale], locale)
    }
    for (const [path, byLocale] of Object.entries(REWRITES)) {
      if (typeof byLocale[locale] !== 'string') fail(`no ${locale} text for rewritten key ${path}`)
      if (typeof flatten(data[locale])[path] !== 'string') fail(`${locale}: ${path} isn't there to rewrite`)
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
}

// Run only when called as a script, so a test or a one-off can import the data.
const self = fileURLToPath(import.meta.url)
const invoked = process.argv[1] ? resolve(process.argv[1]) : ''
if (process.platform === 'win32' ? invoked.toLowerCase() === self.toLowerCase() : invoked === self) main()
