#!/usr/bin/env python3
"""
_build_verify_pages.py: generate the 9 localised /verify pages.

Re-run after editing TRANSLATIONS or TEMPLATE. Output goes to
migrations/two-app-architecture/landing-from-claude-design/verify/
(English at the root /verify/index.html, other locales at
/verify/{locale}/index.html so the URLs match the i18n locale codes
used elsewhere in the app).

Each generated page carries a locale switcher at the top. Clicking
a native-language name jumps to that locale's version.

The steps follow the PDF's signature appendix (src/lib/pdf.ts): each
link's base64 blocks decode with base64 -d (certutil -decode on Windows),
the chain step checks parent_payload_sha256, and the photo step re-hashes
the originals in the record's evidence file (src/lib/evidence-bundle.ts).

Run:   python scripts/_build_verify_pages.py           (writes the 9 pages)
Check: python scripts/_build_verify_pages.py --check   (writes nothing; exits 1
       when a page on disk differs from what this script renders)
Every run first checks the copy: each locale has exactly en's keys, the
same HTML tags as en per key, and no em-dash or replacement character.

Translations are conservative / formal in register, matching the
existing privacy policy. Native-speaker review recommended before
any high-stakes use.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
VERIFY_DIR = ROOT / 'migrations' / 'two-app-architecture' / 'landing-from-claude-design' / 'verify'

LOCALES = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']

NATIVE_NAMES = {
    'en': 'English',
    'zh-CN': '简体中文',
    'vi': 'Tiếng Việt',
    'id': 'Bahasa Indonesia',
    'ko': '한국어',
    'it': 'Italiano',
    'el': 'Ελληνικά',
    'hi': 'हिन्दी',
    'pa': 'ਪੰਜਾਬੀ',
}

# Translation dict: each locale has the same keys. Keys are stable; values
# get string-formatted into TEMPLATE. STEPS (below) adds the T2 steps.
TRANSLATIONS = {
    'en': {
        'back_link': '← Back to ParkProof',
        'eyebrow': 'Verification',
        'h1_main': 'Verify a ParkProof',
        'h1_accent': 'evidence record',
        'h1_period': '.',
        'callout_label': 'Honest framing.',
        'h2_verifying': "What you're verifying",
        'h2_need': "What you'll need",
        'h2_steps': 'Step-by-step',
        'h2_result': 'What the result means',
        'pass_title': 'Verified',
        'pass_label': 'PASS',
        'fail_title': 'Failure',
        'fail_label': 'FAIL',
        'h2_beyond': 'Beyond "did the bytes change?"',
        'p_beyond': 'A successful verification confirms <em>integrity</em>. It does not confirm:',
        'li_beyond_1': '<strong>That the AI read the sign correctly.</strong> The ParkProof scan is a machine read of a parking sign, and machines can be wrong. The verdict text and rules in the record are the AI\'s best read at scan time, not ground truth.',
        'li_beyond_3': '<strong>Any legal outcome.</strong> Whether the evidence supports an appeal, a refund, or a court case is the reviewer\'s call. ParkProof is a tool, not a lawyer.',
        'h2_why': 'Why this exists',
        'h2_questions': 'Questions?',
        'p_questions': 'Email <a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>. We answer.',
        'footer_left': 'parkproof.com.au · verification page',
    },
    'zh-CN': {
        'back_link': '← 返回 ParkProof',
        'eyebrow': '验证',
        'h1_main': '验证一份 ParkProof',
        'h1_accent': '证据记录',
        'h1_period': '。',
        'callout_label': '诚实表态。',
        'h2_verifying': '你在验证什么',
        'h2_need': '你需要的',
        'h2_steps': '一步一步',
        'h2_result': '结果意味着什么',
        'pass_title': '已验证',
        'pass_label': '通过',
        'fail_title': '失败',
        'fail_label': '不通过',
        'h2_beyond': '不止"字节是否改变?"',
        'p_beyond': '验证成功只确认<em>完整性</em>。它不确认:',
        'li_beyond_1': '<strong>AI 是否正确读取了路牌。</strong>ParkProof 扫描是机器对停车标志的读取,机器可能出错。记录中的判定文本和规则是 AI 在扫描时的最佳读取,而非绝对真相。',
        'li_beyond_3': '<strong>任何法律结果。</strong>证据是否支持申诉、退款或诉讼,是审阅者的判断。ParkProof 是一个工具,不是律师。',
        'h2_why': '为什么存在',
        'h2_questions': '有疑问?',
        'p_questions': '发邮件到 <a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>。我们会回复。',
        'footer_left': 'parkproof.com.au · 验证页面',
    },
    'vi': {
        'back_link': '← Quay lại ParkProof',
        'eyebrow': 'Xác minh',
        'h1_main': 'Xác minh một',
        'h1_accent': 'bản ghi bằng chứng',
        'h1_period': ' ParkProof.',
        'callout_label': 'Khung trung thực.',
        'h2_verifying': 'Bạn đang xác minh điều gì',
        'h2_need': 'Bạn cần',
        'h2_steps': 'Từng bước',
        'h2_result': 'Kết quả có nghĩa là gì',
        'pass_title': 'Đã xác minh',
        'pass_label': 'ĐẠT',
        'fail_title': 'Thất bại',
        'fail_label': 'KHÔNG ĐẠT',
        'h2_beyond': 'Hơn cả "các byte có thay đổi không?"',
        'p_beyond': 'Một lần xác minh thành công xác nhận <em>tính toàn vẹn</em>. Nó không xác nhận:',
        'li_beyond_1': '<strong>Rằng AI đọc biển báo đúng.</strong> Quét ParkProof là một lần đọc máy của biển báo đỗ xe, và máy có thể sai. Văn bản phán quyết và các quy tắc trong bản ghi là cách đọc tốt nhất của AI tại thời điểm quét, không phải sự thật tuyệt đối.',
        'li_beyond_3': '<strong>Bất kỳ kết quả pháp lý nào.</strong> Liệu bằng chứng có hỗ trợ kháng cáo, hoàn tiền, hoặc vụ kiện hay không là quyết định của người xem xét. ParkProof là một công cụ, không phải luật sư.',
        'h2_why': 'Vì sao nó tồn tại',
        'h2_questions': 'Câu hỏi?',
        'p_questions': 'Email <a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>. Chúng tôi trả lời.',
        'footer_left': 'parkproof.com.au · trang xác minh',
    },
    'id': {
        'back_link': '← Kembali ke ParkProof',
        'eyebrow': 'Verifikasi',
        'h1_main': 'Verifikasi sebuah',
        'h1_accent': 'catatan bukti',
        'h1_period': ' ParkProof.',
        'callout_label': 'Bingkai jujur.',
        'h2_verifying': 'Apa yang kamu verifikasi',
        'h2_need': 'Yang kamu butuhkan',
        'h2_steps': 'Langkah demi langkah',
        'h2_result': 'Apa arti hasilnya',
        'pass_title': 'Terverifikasi',
        'pass_label': 'LOLOS',
        'fail_title': 'Gagal',
        'fail_label': 'GAGAL',
        'h2_beyond': 'Lebih dari "apakah byte berubah?"',
        'p_beyond': 'Verifikasi yang berhasil mengkonfirmasi <em>integritas</em>. Itu tidak mengkonfirmasi:',
        'li_beyond_1': '<strong>Bahwa AI membaca rambu dengan benar.</strong> Pemindaian ParkProof adalah pembacaan mesin dari rambu parkir, dan mesin bisa salah. Teks putusan dan aturan dalam catatan adalah pembacaan terbaik AI pada saat pemindaian, bukan kebenaran absolut.',
        'li_beyond_3': '<strong>Hasil hukum apa pun.</strong> Apakah bukti mendukung banding, pengembalian dana, atau perkara pengadilan adalah keputusan peninjau. ParkProof adalah alat, bukan pengacara.',
        'h2_why': 'Mengapa ini ada',
        'h2_questions': 'Pertanyaan?',
        'p_questions': 'Email <a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>. Kami menjawab.',
        'footer_left': 'parkproof.com.au · halaman verifikasi',
    },
    'ko': {
        'back_link': '← ParkProof로 돌아가기',
        'eyebrow': '검증',
        'h1_main': 'ParkProof',
        'h1_accent': '증거 기록 검증',
        'h1_period': '하기.',
        'callout_label': '솔직한 프레임.',
        'h2_verifying': '무엇을 검증하는가',
        'h2_need': '필요한 것',
        'h2_steps': '단계별',
        'h2_result': '결과의 의미',
        'pass_title': '검증됨',
        'pass_label': '통과',
        'fail_title': '실패',
        'fail_label': '실패',
        'h2_beyond': '"바이트가 변경되었는가?" 그 너머',
        'p_beyond': '성공적인 검증은 <em>무결성</em>을 확인합니다. 다음은 확인하지 않습니다:',
        'li_beyond_1': '<strong>AI가 표지판을 올바르게 읽었는지.</strong> ParkProof 스캔은 주차 표지판의 기계 판독이며 기계는 틀릴 수 있습니다. 기록의 판정 텍스트와 규칙은 스캔 시점의 AI 최선의 판독이며 절대 진리가 아닙니다.',
        'li_beyond_3': '<strong>법적 결과.</strong> 증거가 항소, 환불 또는 법원 사건을 뒷받침하는지 여부는 검토자의 판단입니다. ParkProof는 도구이지 변호사가 아닙니다.',
        'h2_why': '왜 존재하는가',
        'h2_questions': '질문이 있나요?',
        'p_questions': '<a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>로 이메일을 보내세요. 답변드립니다.',
        'footer_left': 'parkproof.com.au · 검증 페이지',
    },
    'it': {
        'back_link': '← Torna a ParkProof',
        'eyebrow': 'Verifica',
        'h1_main': 'Verifica un record di',
        'h1_accent': 'prova ParkProof',
        'h1_period': '.',
        'callout_label': 'Inquadramento onesto.',
        'h2_verifying': 'Cosa stai verificando',
        'h2_need': 'Cosa ti serve',
        'h2_steps': 'Passo-passo',
        'h2_result': 'Cosa significa il risultato',
        'pass_title': 'Verificato',
        'pass_label': 'PASS',
        'fail_title': 'Fallimento',
        'fail_label': 'FAIL',
        'h2_beyond': 'Oltre "i byte sono cambiati?"',
        'p_beyond': "Una verifica riuscita conferma l'<em>integrità</em>. Non conferma:",
        'li_beyond_1': "<strong>Che l'AI abbia letto il cartello correttamente.</strong> La scansione ParkProof è una lettura automatica di un cartello di parcheggio, e le macchine possono sbagliare. Il testo del verdetto e le regole nel record sono la migliore lettura dell'AI al momento della scansione, non la verità assoluta.",
        'li_beyond_3': '<strong>Qualsiasi esito legale.</strong> Se la prova supporti un ricorso, un rimborso, o un caso giudiziario è la decisione del revisore. ParkProof è uno strumento, non un avvocato.',
        'h2_why': "Perché esiste",
        'h2_questions': 'Domande?',
        'p_questions': 'Email <a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>. Rispondiamo.',
        'footer_left': 'parkproof.com.au · pagina di verifica',
    },
    'el': {
        'back_link': '← Πίσω στο ParkProof',
        'eyebrow': 'Επαλήθευση',
        'h1_main': 'Επαλήθευση μιας εγγραφής',
        'h1_accent': 'αποδείξεων ParkProof',
        'h1_period': '.',
        'callout_label': 'Έντιμη πλαισίωση.',
        'h2_verifying': 'Τι επαληθεύεις',
        'h2_need': 'Τι θα χρειαστείς',
        'h2_steps': 'Βήμα-βήμα',
        'h2_result': 'Τι σημαίνει το αποτέλεσμα',
        'pass_title': 'Επαληθεύτηκε',
        'pass_label': 'PASS',
        'fail_title': 'Αποτυχία',
        'fail_label': 'FAIL',
        'h2_beyond': 'Πέρα από το "άλλαξαν τα bytes;"',
        'p_beyond': 'Μια επιτυχημένη επαλήθευση επιβεβαιώνει την <em>ακεραιότητα</em>. Δεν επιβεβαιώνει:',
        'li_beyond_1': '<strong>Ότι η ΑΙ διάβασε σωστά την πινακίδα.</strong> Η σάρωση του ParkProof είναι ανάγνωση μηχανής μιας πινακίδας στάθμευσης, και οι μηχανές μπορούν να κάνουν λάθος. Το κείμενο ετυμηγορίας και οι κανόνες στην εγγραφή είναι η καλύτερη ανάγνωση της ΑΙ τη στιγμή της σάρωσης, όχι απόλυτη αλήθεια.',
        'li_beyond_3': '<strong>Οποιοδήποτε νομικό αποτέλεσμα.</strong> Αν η απόδειξη υποστηρίζει μια έφεση, επιστροφή χρημάτων, ή δικαστική υπόθεση είναι κρίση του εξεταστή. Το ParkProof είναι εργαλείο, όχι δικηγόρος.',
        'h2_why': 'Γιατί υπάρχει αυτό',
        'h2_questions': 'Ερωτήσεις;',
        'p_questions': 'Email στο <a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>. Απαντάμε.',
        'footer_left': 'parkproof.com.au · σελίδα επαλήθευσης',
    },
    'hi': {
        'back_link': '← ParkProof पर वापस',
        'eyebrow': 'सत्यापन',
        'h1_main': 'ParkProof',
        'h1_accent': 'साक्ष्य रिकॉर्ड',
        'h1_period': ' सत्यापित करें।',
        'callout_label': 'ईमानदार ढांचा।',
        'h2_verifying': 'आप क्या सत्यापित कर रहे हैं',
        'h2_need': 'आपको क्या चाहिए',
        'h2_steps': 'चरण-दर-चरण',
        'h2_result': 'परिणाम का क्या मतलब है',
        'pass_title': 'सत्यापित',
        'pass_label': 'पास',
        'fail_title': 'विफलता',
        'fail_label': 'फेल',
        'h2_beyond': '"क्या बाइट्स बदले?" से परे',
        'p_beyond': 'सफल सत्यापन <em>अखंडता</em> की पुष्टि करता है। यह पुष्टि नहीं करता:',
        'li_beyond_1': '<strong>कि AI ने साइन को सही पढ़ा।</strong> ParkProof स्कैन एक पार्किंग साइन का मशीन रीडिंग है, और मशीनें गलत हो सकती हैं। रिकॉर्ड में फैसले का पाठ और नियम स्कैन के समय AI की सर्वोत्तम रीडिंग है, परम सत्य नहीं।',
        'li_beyond_3': '<strong>कोई कानूनी परिणाम।</strong> क्या साक्ष्य एक अपील, धन वापसी, या अदालती मामले का समर्थन करता है यह समीक्षक का निर्णय है। ParkProof एक उपकरण है, वकील नहीं।',
        'h2_why': 'यह क्यों मौजूद है',
        'h2_questions': 'प्रश्न?',
        'p_questions': '<a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a> पर ईमेल करें। हम जवाब देते हैं।',
        'footer_left': 'parkproof.com.au · सत्यापन पृष्ठ',
    },
    'pa': {
        'back_link': '← ParkProof ਤੇ ਵਾਪਸ',
        'eyebrow': 'ਪੁਸ਼ਟੀਕਰਣ',
        'h1_main': 'ParkProof',
        'h1_accent': 'ਸਬੂਤ ਰਿਕਾਰਡ',
        'h1_period': ' ਦੀ ਪੁਸ਼ਟੀ ਕਰੋ।',
        'callout_label': 'ਇਮਾਨਦਾਰ ਫਰੇਮ।',
        'h2_verifying': 'ਤੁਸੀਂ ਕੀ ਪੁਸ਼ਟੀ ਕਰ ਰਹੇ ਹੋ',
        'h2_need': 'ਤੁਹਾਨੂੰ ਕੀ ਚਾਹੀਦਾ ਹੈ',
        'h2_steps': 'ਕਦਮ-ਦਰ-ਕਦਮ',
        'h2_result': 'ਨਤੀਜੇ ਦਾ ਕੀ ਮਤਲਬ ਹੈ',
        'pass_title': 'ਪੁਸ਼ਟੀ ਹੋਈ',
        'pass_label': 'ਪਾਸ',
        'fail_title': 'ਅਸਫਲਤਾ',
        'fail_label': 'ਫੇਲ',
        'h2_beyond': '"ਕੀ ਬਾਈਟ ਬਦਲੇ?" ਤੋਂ ਪਰੇ',
        'p_beyond': 'ਇੱਕ ਸਫਲ ਪੁਸ਼ਟੀਕਰਣ <em>ਅਖੰਡਤਾ</em> ਦੀ ਪੁਸ਼ਟੀ ਕਰਦਾ ਹੈ। ਇਹ ਪੁਸ਼ਟੀ ਨਹੀਂ ਕਰਦਾ:',
        'li_beyond_1': '<strong>ਕਿ AI ਨੇ ਚਿੰਨ੍ਹ ਨੂੰ ਸਹੀ ਪੜ੍ਹਿਆ।</strong> ParkProof ਸਕੈਨ ਇੱਕ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਦੀ ਮਸ਼ੀਨ ਪੜ੍ਹਨ ਹੈ, ਅਤੇ ਮਸ਼ੀਨਾਂ ਗਲਤ ਹੋ ਸਕਦੀਆਂ ਹਨ। ਰਿਕਾਰਡ ਵਿੱਚ ਫੈਸਲੇ ਦਾ ਟੈਕਸਟ ਅਤੇ ਨਿਯਮ ਸਕੈਨ ਦੇ ਸਮੇਂ AI ਦੀ ਸਭ ਤੋਂ ਵਧੀਆ ਪੜ੍ਹਨ ਹੈ, ਅੰਤਮ ਸੱਚ ਨਹੀਂ।',
        'li_beyond_3': '<strong>ਕੋਈ ਕਾਨੂੰਨੀ ਨਤੀਜਾ।</strong> ਕੀ ਸਬੂਤ ਅਪੀਲ, ਰਿਫੰਡ, ਜਾਂ ਅਦਾਲਤੀ ਮਾਮਲੇ ਦਾ ਸਮਰਥਨ ਕਰਦਾ ਹੈ ਇਹ ਸਮੀਖਿਅਕ ਦਾ ਫੈਸਲਾ ਹੈ। ParkProof ਇੱਕ ਟੂਲ ਹੈ, ਵਕੀਲ ਨਹੀਂ।',
        'h2_why': 'ਇਹ ਕਿਉਂ ਮੌਜੂਦ ਹੈ',
        'h2_questions': 'ਸਵਾਲ?',
        'p_questions': '<a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a> ਤੇ ਈਮੇਲ ਕਰੋ। ਅਸੀਂ ਜਵਾਬ ਦਿੰਦੇ ਹਾਂ।',
        'footer_left': 'parkproof.com.au · ਪੁਸ਼ਟੀਕਰਣ ਪੰਨਾ',
    },
}


# The verification steps (build spec T2, item 10) and every string rewritten
# with them. Merged over TRANSLATIONS per locale; a key in both is an error.
# The steps match the PDF's signature appendix: copy the base64 blocks to
# linkN-payload.b64 and linkN-sig.b64, decode them with base64 -d (certutil
# -decode on Windows), check each link, check the chain, and re-hash the
# photos from the record's evidence file (src/lib/evidence-bundle.ts).
KEY_LINK = '<a class="link" href="/parkproof-public-key.pem"><code>/parkproof-public-key.pem</code></a>'

STEPS = {
    'en': {
        'page_title': 'Verify a ParkProof evidence record | ParkProof',
        'lede': "Every ParkProof evidence PDF carries a cryptographic signature appendix, and every record can be saved as an evidence file. This page shows anyone, such as a council officer, an insurer, a court clerk or the driver, how to check offline that a record hasn't changed since ParkProof signed it.",
        'callout_body': "A valid signature shows <em>integrity</em>: the signed details and photo fingerprints are exactly what ParkProof signed, at the signed time. It doesn't show that the record is <em>true</em> (the AI could have read the sign wrongly), who was driving, where the car was, or when the car arrived or left, and it doesn't decide what weight the record carries. That's for whoever reviews it.",
        'p_verifying_1': "A ParkProof record is signed in parts, called links. Link 0 is signed when ParkProof receives the saved record. Each later link, such as the details at parking, condition photos, a proof of payment photo or the departure, is signed when ParkProof receives it, and carries the SHA-256 of the link before it, so the links form a chain. Each link has a <strong>payload</strong> (the exact text that was signed, including the SHA-256 fingerprints of its photos) and a <strong>signature</strong> made with ParkProof's private key (ECDSA P-256), which never leaves AWS KMS. The evidence PDF prints every link in its signature appendix. The record's <strong>evidence file</strong> (a .json file the driver can download from the record in the app) holds the same payloads and signatures, plus the original photos.",
        'p_verifying_2': 'The <strong>public key</strong> needed to check the signatures is published at ' + KEY_LINK + '. Open it in a browser to confirm it loads, then save it.',
        'li_need_1': '<strong>The evidence PDF or the evidence file</strong>, from the person producing the record. Checking the photos needs the evidence file.',
        'li_need_2': '<strong><code>openssl</code></strong>. It comes with macOS and most Linux systems. On Windows, it comes with Git for Windows (Git Bash) or WSL.',
        'li_need_3': '<strong>A few minutes.</strong>',
        'p_steps': 'In the PDF, go to the signature appendix at the back. Each link has three blocks: the payload as text, the payload in base64 and the signature in base64. Copy the two base64 blocks of link 0 into files named <code>link0-payload.b64</code> and <code>link0-sig.b64</code>, then run:',
        'c_step_1': "1. Decode the payload. base64 -d ignores the PDF's line wrapping.",
        'c_step_2': '2. Decode the signature.',
        'c_step_3': "3. Download ParkProof's public key.",
        'c_step_4': '4. Check the signature. Expect "Verified OK".',
        'p_repeat': "Do steps 1, 2 and 4 for each link, with its own file names (<code>link1-payload.b64</code>, <code>link1-sig.b64</code> and so on). Don't copy the readable payload text instead of the base64 block: the PDF wraps long lines, which changes the bytes, and the check fails.",
        'h3_windows': 'On Windows',
        'p_windows': "In cmd or PowerShell, <code>base64 -d</code> isn't available. Decode with <code>certutil</code>, which comes with Windows, and in PowerShell type <code>curl.exe</code> in place of <code>curl</code>. You can also run every command on this page as written in Git Bash.",
        'h2_chain': 'Check the links are joined in order',
        'p_chain': "Each link after link 0 carries <code>parent_payload_sha256</code>: the SHA-256 of the payload of the link before it. Print the SHA-256 of each payload file and compare it with the next link's value.",
        'c_chain_1': "5. Print the SHA-256 of link 0's payload.",
        'c_chain_2': 'The value after "=" must equal parent_payload_sha256 in link 1.',
        'c_chain_3': 'Do the same for each link that follows.',
        'p_chain_fork': 'If two links share a number (2a and 2b), two devices each added a part at that point. Both name the same link before them.',
        'h2_photos': 'Check the photos',
        'p_photos': "The signatures cover each photo's SHA-256 fingerprint, not the image itself. The photos printed in the PDF are re-encoded copies, so their bytes never match. To check a photo, use the record's evidence file. It lists each photo under <code>photos</code>, with its <code>sha256</code>, the links that sign it (<code>signed_in</code>) and the original bytes in base64 (<code>bytes_base64</code>). The file's name starts with parkproof-evidence- and the start of the record's ID. These commands call it <code>evidence.json</code>.",
        'c_photo_1': '6. Take the first photo out of the file with jq, a free JSON tool.',
        'c_photo_2': '7. Print its SHA-256.',
        'c_photo_3': '8. See which link and field sign it.',
        'p_photo_match': "The hex value must equal the photo's <code>sha256</code> inside the signed payload of each link in <code>signed_in</code>: <code>sign_photo_sha256</code>, <code>car_photo_sha256</code> or <code>ambient_photo_sha256</code> in link 0, or a <code>sha256</code> under <code>photos</code>, <code>photo</code> or <code>return_photos</code> in a later link. Check it against the payload you verified, not just the <code>sha256</code> next to the photo in the file, which isn't signed. Use <code>.photos[1]</code> for the second photo, and so on.",
        'p_photo_nojq': "Without jq, open the file in a text editor, copy a photo's <code>bytes_base64</code> value into a file named <code>photo1.b64</code>, then run <code>base64 -d photo1.b64 &gt; photo1.jpg</code>.",
        'p_photo_windows': 'On Windows, PowerShell can read the file itself:',
        'callout_photo_label': 'The photo check is separate.',
        'callout_photo_body': "<code>Verified OK</code> shows the fingerprints in a payload haven't changed. Only re-hashing the original photo shows a photo is the one that was signed. If the hashes differ, that photo isn't the one ParkProof signed, even when the signature check passed. A file with no bytes for a photo (<code>bytes</code> is <code>not_on_this_device</code>, or <code>withheld_permit</code> for a photo of a permit the driver chose not to include) can't be used to check that photo.",
        'h2_file': 'Using the evidence file instead of the PDF',
        'p_file': "The evidence file also holds each link's payload and signature in base64, so you can do steps 1 to 5 without the PDF. Take link 0 out of the file, then run steps 3 to 5 as above:",
        'p_file_windows': 'In PowerShell:',
        'pass_body': "<code>Verified OK</code>: the payload is exactly what ParkProof signed. The details and photo fingerprints in it haven't changed since ParkProof signed them, at the <code>signed_at</code> time inside it. The photos themselves are checked in steps 6 to 8.",
        'fail_body': "<code>Verification failure</code>: the payload or the signature isn't what ParkProof signed. The record may have been changed, or a block may have been copied with a mistake. Copy the base64 blocks again in full and retry before drawing conclusions.",
        'li_beyond_4': "<strong>Where the car was, when it arrived or left, or who was driving.</strong> The location in the record comes from the driver's phone, or the driver typed it in. Times marked as phone times come from the driver's phone, and ParkProof's signing time is when ParkProof received each part.",
        'li_beyond_2': "<strong>That the photos depict what the person says they depict.</strong> A valid signature shows the photo fingerprints haven't changed since ParkProof signed them, and re-hashing shows whether a photo matches its fingerprint. Neither shows the photos were honestly taken.",
        'meta_desc': "Step-by-step openssl walkthrough for checking that a ParkProof evidence record hasn't changed since ParkProof signed it. Cryptographic signing via AWS KMS ECDSA P-256.",
        'p_why_1': 'Most parking apps that produce "evidence" produce a screenshot. A screenshot could have been edited at any point between when it was taken and when it was sent. The cryptographic signature is the difference between <em>"here\'s what I saw"</em> and <em>"here\'s what I saw, and anyone can check it hasn\'t changed since ParkProof signed it."</em>',
        'p_why_2': "The public key is published so the check works offline. You don't need to trust ParkProof, contact our servers or run our app. The check can be done years from now, even if ParkProof is no longer running, as long as <code>openssl</code> exists.",
    },
    'zh-CN': {
        'page_title': '验证 ParkProof 证据记录 | ParkProof',
        'lede': '每份 ParkProof 证据 PDF 都带有密码学签名附录，每条记录也都可以保存为证据文件。本页面向任何人（例如市议会工作人员、保险公司、法院书记员或驾驶员本人）说明，如何离线核对一条记录自 ParkProof 签名以来没有改动。',
        'callout_body': '有效的签名表明的是<em>完整性</em>：已签名的详情和照片指纹与 ParkProof 在签名时间签名的内容完全一致。它不表明记录是<em>真实的</em>（AI 可能读错了路牌），不表明谁在驾驶、车停在哪里，也不表明车辆何时到达或离开，更不决定这条记录有多大分量。那由审阅的人判断。',
        'p_verifying_1': 'ParkProof 记录是分成几个部分签名的，这些部分称为环节。环节 0 在 ParkProof 收到保存的记录时签名。之后的每个环节（例如停车时的详情、车况照片、付款凭证照片或离开）在 ParkProof 收到时签名，并带有前一个环节的 SHA-256，因此各环节连成一条链。每个环节都有一个<strong>负载</strong>（被签名的确切文本，包括其照片的 SHA-256 指纹）和一个用 ParkProof 私钥（ECDSA P-256）生成的<strong>签名</strong>，该私钥从不离开 AWS KMS。证据 PDF 在签名附录中打印每个环节。记录的<strong>证据文件</strong>（驾驶员可以在应用中的记录页面下载的 .json 文件）包含同样的负载和签名，以及原始照片。',
        'p_verifying_2': '核对签名所需的<strong>公钥</strong>发布在 ' + KEY_LINK + '。请在浏览器中打开以确认能加载，然后保存下来。',
        'li_need_1': '<strong>证据 PDF 或证据文件</strong>，由提交记录的人提供。核对照片需要证据文件。',
        'li_need_2': '<strong><code>openssl</code></strong>。macOS 和大多数 Linux 系统自带。在 Windows 上，Git for Windows（Git Bash）或 WSL 中都有。',
        'li_need_3': '<strong>几分钟时间。</strong>',
        'p_steps': '在 PDF 中翻到末尾的签名附录。每个环节有三块内容：文本形式的负载、base64 形式的负载和 base64 形式的签名。把环节 0 的两块 base64 内容复制到名为 <code>link0-payload.b64</code> 和 <code>link0-sig.b64</code> 的文件中，然后运行：',
        'c_step_1': '1. 解码负载。base64 -d 会忽略 PDF 中的换行。',
        'c_step_2': '2. 解码签名。',
        'c_step_3': '3. 下载 ParkProof 的公钥。',
        'c_step_4': '4. 核对签名。预期输出 "Verified OK"。',
        'p_repeat': '对每个环节用它自己的文件名（<code>link1-payload.b64</code>、<code>link1-sig.b64</code> 等）重复第 1、2、4 步。不要复制可读的负载文本来代替 base64 块：PDF 会把长行折行，字节因此改变，核对就会失败。',
        'h3_windows': '在 Windows 上',
        'p_windows': '在 cmd 或 PowerShell 中没有 <code>base64 -d</code>。请用 Windows 自带的 <code>certutil</code> 解码；在 PowerShell 中，请输入 <code>curl.exe</code> 而不是 <code>curl</code>。你也可以在 Git Bash 中按原样运行本页的所有命令。',
        'h2_chain': '核对各环节按顺序相连',
        'p_chain': '环节 0 之后的每个环节都带有 <code>parent_payload_sha256</code>，即前一个环节负载的 SHA-256。打印每个负载文件的 SHA-256，并与下一个环节中的值比较。',
        'c_chain_1': '5. 打印环节 0 负载的 SHA-256。',
        'c_chain_2': '"=" 后面的值必须等于环节 1 中的 parent_payload_sha256。',
        'c_chain_3': '对后面的每个环节都这样做。',
        'p_chain_fork': '如果两个环节的编号相同（2a 和 2b），说明两台设备在同一位置各添加了一个部分。它们指向同一个前一环节。',
        'h2_photos': '核对照片',
        'p_photos': '签名针对的是每张照片的 SHA-256 指纹，而不是图像本身。PDF 中打印的照片是重新编码的副本，字节永远不会一致。要核对照片，请使用记录的证据文件。文件在 <code>photos</code> 下列出每张照片，包括它的 <code>sha256</code>、为它签名的环节（<code>signed_in</code>）以及 base64 形式的原始字节（<code>bytes_base64</code>）。文件名以 parkproof-evidence- 开头，后面是记录 ID 的开头部分。下面的命令把它称为 <code>evidence.json</code>。',
        'c_photo_1': '6. 用 jq（一个免费的 JSON 工具）从文件中取出第一张照片。',
        'c_photo_2': '7. 打印它的 SHA-256。',
        'c_photo_3': '8. 查看哪个环节、哪个字段为它签名。',
        'p_photo_match': '这个十六进制值必须等于 <code>signed_in</code> 中每个环节的已签名负载里这张照片的 <code>sha256</code>：环节 0 中的 <code>sign_photo_sha256</code>、<code>car_photo_sha256</code> 或 <code>ambient_photo_sha256</code>，或后续环节中 <code>photos</code>、<code>photo</code> 或 <code>return_photos</code> 下的 <code>sha256</code>。请与你已核对过的负载比较，而不只是与文件中照片旁边的 <code>sha256</code> 比较，后者没有签名。第二张照片用 <code>.photos[1]</code>，依此类推。',
        'p_photo_nojq': '如果没有 jq，可以用文本编辑器打开文件，把某张照片的 <code>bytes_base64</code> 值复制到名为 <code>photo1.b64</code> 的文件中，然后运行 <code>base64 -d photo1.b64 &gt; photo1.jpg</code>。',
        'p_photo_windows': '在 Windows 上，PowerShell 可以直接读取这个文件：',
        'callout_photo_label': '照片核对是单独的一步。',
        'callout_photo_body': '<code>Verified OK</code> 表明负载中的指纹没有改动。只有重新计算原始照片的哈希，才能表明照片就是被签名的那张。如果哈希不一致，那张照片就不是 ParkProof 签名的那张，即使签名核对通过也是如此。如果文件中某张照片没有字节（<code>bytes</code> 为 <code>not_on_this_device</code>，或者对于驾驶员选择不包含的许可证照片为 <code>withheld_permit</code>），就无法用它核对那张照片。',
        'h2_file': '用证据文件代替 PDF',
        'p_file': '证据文件也以 base64 形式包含每个环节的负载和签名，所以不用 PDF 也能完成第 1 到 5 步。从文件中取出环节 0，然后按上面的说明运行第 3 到 5 步：',
        'p_file_windows': '在 PowerShell 中：',
        'pass_body': '<code>Verified OK</code>：负载正是 ParkProof 签名的内容。其中的详情和照片指纹自 ParkProof 在负载内的 <code>signed_at</code> 时间签名以来没有改动。照片本身在第 6 到 8 步中核对。',
        'fail_body': '<code>Verification failure</code>：负载或签名不是 ParkProof 签名的内容。记录可能被改动过，也可能是复制时出了错。在下结论之前，请完整地重新复制 base64 块并重试。',
        'li_beyond_4': '<strong>车停在哪里，车辆何时到达或离开，或者谁在驾驶。</strong>记录中的位置来自驾驶员的手机，或由驾驶员手动输入。标为手机时间的时间来自驾驶员的手机，ParkProof 的签名时间是 ParkProof 收到每个部分的时间。',
        'li_beyond_2': '<strong>照片是否如其所述。</strong>有效的签名表明照片指纹自 ParkProof 签名以来没有改动，重新计算哈希可以表明照片是否与其指纹一致。两者都不表明照片是诚实拍摄的。',
        'meta_desc': '使用 openssl 一步步核对 ParkProof 证据记录自 ParkProof 签名以来没有改动。基于 AWS KMS ECDSA P-256 的密码学签名。',
        'p_why_1': '大多数生成"证据"的停车应用只产出截图。截图在拍下到发送之间的任何时候都可能被编辑。密码学签名的区别在于：<em>"这是我看到的"</em>和<em>"这是我看到的，任何人都可以核对它自 ParkProof 签名以来没有改动"</em>。',
        'p_why_2': '公钥已公开发布，所以核对可以完全离线进行。你不需要信任 ParkProof、联系我们的服务器或运行我们的应用。即使多年以后 ParkProof 不再运行，只要 <code>openssl</code> 还在，就可以进行核对。',
    },
    'vi': {
        'page_title': 'Xác minh bản ghi bằng chứng ParkProof | ParkProof',
        'lede': 'Mỗi PDF bằng chứng ParkProof có một phụ lục chữ ký mã hóa, và mỗi bản ghi đều có thể lưu thành tệp bằng chứng. Trang này hướng dẫn bất kỳ ai, chẳng hạn nhân viên hội đồng, công ty bảo hiểm, thư ký tòa án hoặc chính tài xế, cách kiểm tra ngoại tuyến rằng một bản ghi không thay đổi kể từ khi ParkProof ký.',
        'callout_body': 'Chữ ký hợp lệ cho thấy <em>tính toàn vẹn</em>: các thông tin và dấu vân tay số của ảnh đã ký đúng là những gì ParkProof đã ký, vào thời điểm ký. Nó không cho thấy bản ghi là <em>đúng sự thật</em> (AI có thể đọc sai biển báo), ai đã lái xe, xe ở đâu, hay xe đến hoặc rời đi lúc nào, và không quyết định bản ghi có giá trị đến đâu. Việc đó do người xem xét quyết định.',
        'p_verifying_1': 'Một bản ghi ParkProof được ký theo từng phần, gọi là mắt xích. Mắt xích 0 được ký khi ParkProof nhận được bản ghi đã lưu. Mỗi mắt xích sau đó, chẳng hạn thông tin lúc đỗ, ảnh tình trạng xe, ảnh bằng chứng thanh toán hoặc lúc rời đi, được ký khi ParkProof nhận được và mang SHA-256 của mắt xích trước nó, nên các mắt xích nối thành một chuỗi. Mỗi mắt xích có một <strong>payload</strong> (đúng đoạn văn bản đã được ký, gồm cả dấu vân tay số SHA-256 của các ảnh) và một <strong>chữ ký</strong> tạo bằng khóa riêng của ParkProof (ECDSA P-256), khóa này không bao giờ rời khỏi AWS KMS. PDF bằng chứng in mọi mắt xích trong phụ lục chữ ký. <strong>Tệp bằng chứng</strong> của bản ghi (một tệp .json mà tài xế có thể tải về từ bản ghi trong ứng dụng) chứa cùng các payload và chữ ký đó, cùng với ảnh gốc.',
        'p_verifying_2': '<strong>Khóa công khai</strong> cần để kiểm tra chữ ký được công bố tại ' + KEY_LINK + '. Mở trong trình duyệt để xác nhận tải được, rồi lưu lại.',
        'li_need_1': '<strong>PDF bằng chứng hoặc tệp bằng chứng</strong>, do người cung cấp bản ghi đưa cho bạn. Cần tệp bằng chứng để kiểm tra ảnh.',
        'li_need_2': '<strong><code>openssl</code></strong>. Có sẵn trên macOS và hầu hết các hệ thống Linux. Trên Windows, có trong Git for Windows (Git Bash) hoặc WSL.',
        'li_need_3': '<strong>Vài phút.</strong>',
        'p_steps': 'Trong PDF, mở phụ lục chữ ký ở cuối. Mỗi mắt xích có ba khối: payload dạng văn bản, payload dạng base64 và chữ ký dạng base64. Sao chép hai khối base64 của mắt xích 0 vào các tệp tên <code>link0-payload.b64</code> và <code>link0-sig.b64</code>, rồi chạy:',
        'c_step_1': '1. Giải mã payload. base64 -d bỏ qua việc xuống dòng trong PDF.',
        'c_step_2': '2. Giải mã chữ ký.',
        'c_step_3': '3. Tải khóa công khai của ParkProof.',
        'c_step_4': '4. Kiểm tra chữ ký. Kết quả mong đợi: "Verified OK".',
        'p_repeat': 'Làm các bước 1, 2 và 4 cho từng mắt xích, với tên tệp riêng của nó (<code>link1-payload.b64</code>, <code>link1-sig.b64</code>, v.v.). Đừng sao chép payload dạng văn bản thay cho khối base64: PDF ngắt các dòng dài, làm thay đổi các byte, và việc kiểm tra sẽ thất bại.',
        'h3_windows': 'Trên Windows',
        'p_windows': 'Trong cmd hoặc PowerShell không có <code>base64 -d</code>. Hãy giải mã bằng <code>certutil</code>, có sẵn trong Windows, và trong PowerShell hãy gõ <code>curl.exe</code> thay cho <code>curl</code>. Bạn cũng có thể chạy mọi lệnh trên trang này đúng như đã viết trong Git Bash.',
        'h2_chain': 'Kiểm tra các mắt xích được nối đúng thứ tự',
        'p_chain': 'Mỗi mắt xích sau mắt xích 0 mang <code>parent_payload_sha256</code>: SHA-256 của payload của mắt xích trước nó. In SHA-256 của từng tệp payload và so sánh với giá trị trong mắt xích tiếp theo.',
        'c_chain_1': '5. In SHA-256 của payload mắt xích 0.',
        'c_chain_2': 'Giá trị sau dấu "=" phải bằng parent_payload_sha256 trong mắt xích 1.',
        'c_chain_3': 'Làm tương tự với từng mắt xích tiếp theo.',
        'p_chain_fork': 'Nếu hai mắt xích có cùng số (2a và 2b), hai thiết bị đã cùng thêm một phần tại điểm đó. Cả hai đều trỏ đến cùng một mắt xích trước.',
        'h2_photos': 'Kiểm tra ảnh',
        'p_photos': 'Chữ ký bao gồm dấu vân tay số SHA-256 của từng ảnh, không phải bản thân hình ảnh. Ảnh in trong PDF là bản sao được mã hóa lại, nên các byte không bao giờ khớp. Để kiểm tra một ảnh, hãy dùng tệp bằng chứng của bản ghi. Tệp liệt kê từng ảnh trong <code>photos</code>, kèm <code>sha256</code> của ảnh, các mắt xích ký nó (<code>signed_in</code>) và các byte gốc dạng base64 (<code>bytes_base64</code>). Tên tệp bắt đầu bằng parkproof-evidence-, tiếp theo là phần đầu ID của bản ghi. Các lệnh dưới đây gọi nó là <code>evidence.json</code>.',
        'c_photo_1': '6. Lấy ảnh đầu tiên ra khỏi tệp bằng jq, một công cụ JSON miễn phí.',
        'c_photo_2': '7. In SHA-256 của ảnh.',
        'c_photo_3': '8. Xem mắt xích và trường nào ký ảnh này.',
        'p_photo_match': 'Giá trị hex phải bằng <code>sha256</code> của ảnh trong payload đã ký của từng mắt xích trong <code>signed_in</code>: <code>sign_photo_sha256</code>, <code>car_photo_sha256</code> hoặc <code>ambient_photo_sha256</code> ở mắt xích 0, hoặc một <code>sha256</code> trong <code>photos</code>, <code>photo</code> hoặc <code>return_photos</code> ở mắt xích sau. Hãy đối chiếu với payload bạn đã kiểm tra, chứ không chỉ với <code>sha256</code> đặt cạnh ảnh trong tệp, vốn không được ký. Dùng <code>.photos[1]</code> cho ảnh thứ hai, v.v.',
        'p_photo_nojq': 'Nếu không có jq, hãy mở tệp bằng trình soạn thảo văn bản, sao chép giá trị <code>bytes_base64</code> của một ảnh vào tệp tên <code>photo1.b64</code>, rồi chạy <code>base64 -d photo1.b64 &gt; photo1.jpg</code>.',
        'p_photo_windows': 'Trên Windows, PowerShell có thể tự đọc tệp:',
        'callout_photo_label': 'Kiểm tra ảnh là một bước riêng.',
        'callout_photo_body': '<code>Verified OK</code> cho thấy các dấu vân tay số trong payload không thay đổi. Chỉ việc băm lại ảnh gốc mới cho thấy ảnh đó đúng là ảnh đã được ký. Nếu giá trị băm khác nhau, ảnh đó không phải ảnh ParkProof đã ký, kể cả khi kiểm tra chữ ký đã đạt. Nếu tệp không có byte của một ảnh (<code>bytes</code> là <code>not_on_this_device</code>, hoặc <code>withheld_permit</code> với ảnh giấy phép mà tài xế chọn không đưa vào), không thể dùng tệp để kiểm tra ảnh đó.',
        'h2_file': 'Dùng tệp bằng chứng thay cho PDF',
        'p_file': 'Tệp bằng chứng cũng chứa payload và chữ ký của từng mắt xích dạng base64, nên bạn có thể làm các bước 1 đến 5 mà không cần PDF. Lấy mắt xích 0 ra khỏi tệp, rồi chạy các bước 3 đến 5 như trên:',
        'p_file_windows': 'Trong PowerShell:',
        'pass_body': '<code>Verified OK</code>: payload đúng là những gì ParkProof đã ký. Các thông tin và dấu vân tay số của ảnh trong đó không thay đổi kể từ khi ParkProof ký, vào thời điểm <code>signed_at</code> ghi trong payload. Bản thân các ảnh được kiểm tra ở các bước 6 đến 8.',
        'fail_body': '<code>Verification failure</code>: payload hoặc chữ ký không phải là những gì ParkProof đã ký. Bản ghi có thể đã bị thay đổi, hoặc một khối đã bị sao chép sai. Hãy sao chép lại đầy đủ các khối base64 và thử lại trước khi kết luận.',
        'li_beyond_4': '<strong>Xe ở đâu, xe đến hoặc rời đi lúc nào, hay ai đã lái xe.</strong> Vị trí trong bản ghi lấy từ điện thoại của tài xế, hoặc do tài xế tự nhập. Các thời điểm ghi là giờ điện thoại lấy từ điện thoại của tài xế, còn thời điểm ký của ParkProof là lúc ParkProof nhận được từng phần.',
        'li_beyond_2': '<strong>Rằng các ảnh mô tả những gì người đó nói chúng mô tả.</strong> Chữ ký hợp lệ cho thấy dấu vân tay số của các ảnh không thay đổi kể từ khi ParkProof ký, và việc băm lại cho thấy một ảnh có khớp với dấu vân tay số của nó hay không. Cả hai đều không cho thấy các ảnh được chụp một cách trung thực.',
        'meta_desc': 'Hướng dẫn từng bước bằng openssl để kiểm tra một bản ghi bằng chứng ParkProof không thay đổi kể từ khi ParkProof ký. Ký mật mã qua AWS KMS ECDSA P-256.',
        'p_why_1': 'Hầu hết các ứng dụng đỗ xe tạo ra "bằng chứng" chỉ tạo ra ảnh chụp màn hình. Ảnh chụp màn hình có thể bị chỉnh sửa vào bất kỳ lúc nào giữa lúc chụp và lúc gửi. Chữ ký mã hóa là sự khác biệt giữa <em>"đây là những gì tôi đã thấy"</em> và <em>"đây là những gì tôi đã thấy, và bất kỳ ai cũng có thể kiểm tra rằng nó không thay đổi kể từ khi ParkProof ký."</em>',
        'p_why_2': 'Khóa công khai được công bố nên việc kiểm tra có thể làm hoàn toàn ngoại tuyến. Bạn không cần tin ParkProof, liên hệ máy chủ của chúng tôi hay chạy ứng dụng của chúng tôi. Việc kiểm tra vẫn làm được sau nhiều năm, kể cả khi ParkProof không còn hoạt động, miễn là <code>openssl</code> vẫn còn.',
    },
    'id': {
        'page_title': 'Verifikasi catatan bukti ParkProof | ParkProof',
        'lede': 'Setiap PDF bukti ParkProof memuat lampiran tanda tangan kriptografis, dan setiap catatan bisa disimpan sebagai berkas bukti. Halaman ini menunjukkan kepada siapa pun, misalnya petugas dewan kota, perusahaan asuransi, panitera pengadilan, atau pengemudi sendiri, cara mengecek secara offline bahwa sebuah catatan tidak berubah sejak ParkProof menandatanganinya.',
        'callout_body': 'Tanda tangan yang sah menunjukkan <em>integritas</em>: detail dan sidik jari foto yang ditandatangani persis sama dengan yang ditandatangani ParkProof, pada waktu penandatanganan. Tanda tangan tidak menunjukkan bahwa catatan itu <em>benar</em> (AI bisa salah membaca rambu), siapa yang mengemudi, di mana mobil berada, atau kapan mobil tiba atau pergi, dan tidak menentukan seberapa besar bobot catatan itu. Itu keputusan orang yang meninjaunya.',
        'p_verifying_1': 'Catatan ParkProof ditandatangani per bagian, yang disebut mata rantai. Mata rantai 0 ditandatangani saat ParkProof menerima catatan yang disimpan. Setiap mata rantai berikutnya, misalnya detail saat parkir, foto kondisi mobil, foto bukti pembayaran, atau saat pergi, ditandatangani saat diterima ParkProof dan memuat SHA-256 mata rantai sebelumnya, sehingga semua mata rantai membentuk rantai. Setiap mata rantai punya <strong>payload</strong> (teks persis yang ditandatangani, termasuk sidik jari SHA-256 foto-fotonya) dan <strong>tanda tangan</strong> yang dibuat dengan kunci privat ParkProof (ECDSA P-256), yang tidak pernah keluar dari AWS KMS. PDF bukti mencetak setiap mata rantai di lampiran tanda tangannya. <strong>Berkas bukti</strong> catatan (berkas .json yang bisa diunduh pengemudi dari catatan di aplikasi) berisi payload dan tanda tangan yang sama, ditambah foto aslinya.',
        'p_verifying_2': '<strong>Kunci publik</strong> yang diperlukan untuk mengecek tanda tangan diterbitkan di ' + KEY_LINK + '. Buka di browser untuk memastikan kunci itu dimuat, lalu simpan.',
        'li_need_1': '<strong>PDF bukti atau berkas bukti</strong>, dari orang yang menyerahkan catatan. Untuk mengecek foto, kamu perlu berkas bukti.',
        'li_need_2': '<strong><code>openssl</code></strong>. Tersedia di macOS dan kebanyakan sistem Linux. Di Windows, tersedia di Git for Windows (Git Bash) atau WSL.',
        'li_need_3': '<strong>Beberapa menit.</strong>',
        'p_steps': 'Di PDF, buka lampiran tanda tangan di bagian belakang. Setiap mata rantai punya tiga blok: payload sebagai teks, payload dalam base64, dan tanda tangan dalam base64. Salin dua blok base64 dari mata rantai 0 ke berkas bernama <code>link0-payload.b64</code> dan <code>link0-sig.b64</code>, lalu jalankan:',
        'c_step_1': '1. Dekode payload. base64 -d mengabaikan pembungkusan baris di PDF.',
        'c_step_2': '2. Dekode tanda tangan.',
        'c_step_3': '3. Unduh kunci publik ParkProof.',
        'c_step_4': '4. Cek tanda tangan. Keluaran yang diharapkan: "Verified OK".',
        'p_repeat': 'Lakukan langkah 1, 2, dan 4 untuk setiap mata rantai, dengan nama berkasnya sendiri (<code>link1-payload.b64</code>, <code>link1-sig.b64</code>, dan seterusnya). Jangan menyalin teks payload yang bisa dibaca sebagai ganti blok base64: PDF memotong baris yang panjang, sehingga byte-nya berubah dan pengecekan gagal.',
        'h3_windows': 'Di Windows',
        'p_windows': 'Di cmd atau PowerShell, <code>base64 -d</code> tidak tersedia. Dekode dengan <code>certutil</code>, yang sudah ada di Windows, dan di PowerShell ketik <code>curl.exe</code> sebagai ganti <code>curl</code>. Kamu juga bisa menjalankan semua perintah di halaman ini persis seperti tertulis di Git Bash.',
        'h2_chain': 'Cek bahwa mata rantai tersambung berurutan',
        'p_chain': 'Setiap mata rantai setelah mata rantai 0 memuat <code>parent_payload_sha256</code>: SHA-256 dari payload mata rantai sebelumnya. Cetak SHA-256 setiap berkas payload dan bandingkan dengan nilai di mata rantai berikutnya.',
        'c_chain_1': '5. Cetak SHA-256 payload mata rantai 0.',
        'c_chain_2': 'Nilai setelah "=" harus sama dengan parent_payload_sha256 di mata rantai 1.',
        'c_chain_3': 'Lakukan hal yang sama untuk setiap mata rantai berikutnya.',
        'p_chain_fork': 'Jika dua mata rantai punya nomor yang sama (2a dan 2b), dua perangkat masing-masing menambahkan bagian di titik itu. Keduanya menunjuk ke mata rantai sebelumnya yang sama.',
        'h2_photos': 'Cek foto',
        'p_photos': 'Tanda tangan mencakup sidik jari SHA-256 setiap foto, bukan gambarnya sendiri. Foto yang dicetak di PDF adalah salinan yang dikodekan ulang, jadi byte-nya tidak akan pernah cocok. Untuk mengecek foto, gunakan berkas bukti catatan. Berkas itu mencantumkan setiap foto di bawah <code>photos</code>, dengan <code>sha256</code>-nya, mata rantai yang menandatanganinya (<code>signed_in</code>), dan byte aslinya dalam base64 (<code>bytes_base64</code>). Nama berkasnya diawali parkproof-evidence-, diikuti awal ID catatan. Perintah di bawah menyebutnya <code>evidence.json</code>.',
        'c_photo_1': '6. Ambil foto pertama dari berkas dengan jq, alat JSON gratis.',
        'c_photo_2': '7. Cetak SHA-256-nya.',
        'c_photo_3': '8. Lihat mata rantai dan kolom mana yang menandatanganinya.',
        'p_photo_match': 'Nilai hex itu harus sama dengan <code>sha256</code> foto tersebut di dalam payload yang ditandatangani dari setiap mata rantai di <code>signed_in</code>: <code>sign_photo_sha256</code>, <code>car_photo_sha256</code>, atau <code>ambient_photo_sha256</code> di mata rantai 0, atau sebuah <code>sha256</code> di bawah <code>photos</code>, <code>photo</code>, atau <code>return_photos</code> di mata rantai berikutnya. Cocokkan dengan payload yang sudah kamu cek, bukan hanya dengan <code>sha256</code> di sebelah foto dalam berkas, yang tidak ditandatangani. Gunakan <code>.photos[1]</code> untuk foto kedua, dan seterusnya.',
        'p_photo_nojq': 'Tanpa jq, buka berkas di editor teks, salin nilai <code>bytes_base64</code> sebuah foto ke berkas bernama <code>photo1.b64</code>, lalu jalankan <code>base64 -d photo1.b64 &gt; photo1.jpg</code>.',
        'p_photo_windows': 'Di Windows, PowerShell bisa membaca berkas itu sendiri:',
        'callout_photo_label': 'Pengecekan foto adalah langkah terpisah.',
        'callout_photo_body': '<code>Verified OK</code> menunjukkan sidik jari di dalam payload tidak berubah. Hanya menghitung ulang hash foto asli yang bisa menunjukkan bahwa foto itu adalah foto yang ditandatangani. Jika hash-nya berbeda, foto itu bukan foto yang ditandatangani ParkProof, meskipun pengecekan tanda tangan lolos. Jika berkas tidak memuat byte sebuah foto (<code>bytes</code> bernilai <code>not_on_this_device</code>, atau <code>withheld_permit</code> untuk foto izin yang tidak disertakan pengemudi), berkas itu tidak bisa dipakai untuk mengecek foto tersebut.',
        'h2_file': 'Memakai berkas bukti sebagai ganti PDF',
        'p_file': 'Berkas bukti juga memuat payload dan tanda tangan setiap mata rantai dalam base64, jadi kamu bisa melakukan langkah 1 sampai 5 tanpa PDF. Ambil mata rantai 0 dari berkas, lalu jalankan langkah 3 sampai 5 seperti di atas:',
        'p_file_windows': 'Di PowerShell:',
        'pass_body': '<code>Verified OK</code>: payload itu persis yang ditandatangani ParkProof. Detail dan sidik jari foto di dalamnya tidak berubah sejak ParkProof menandatanganinya, pada waktu <code>signed_at</code> di dalamnya. Foto-fotonya sendiri dicek di langkah 6 sampai 8.',
        'fail_body': '<code>Verification failure</code>: payload atau tanda tangan bukan yang ditandatangani ParkProof. Catatan itu mungkin telah diubah, atau sebuah blok tersalin dengan keliru. Salin ulang blok base64 secara lengkap dan coba lagi sebelum menarik kesimpulan.',
        'li_beyond_4': '<strong>Di mana mobil berada, kapan mobil tiba atau pergi, atau siapa yang mengemudi.</strong> Lokasi dalam catatan berasal dari ponsel pengemudi, atau diketik sendiri oleh pengemudi. Waktu yang ditandai sebagai waktu ponsel berasal dari ponsel pengemudi, dan waktu penandatanganan ParkProof adalah saat ParkProof menerima setiap bagian.',
        'li_beyond_2': '<strong>Bahwa foto menggambarkan apa yang orang itu katakan.</strong> Tanda tangan yang valid menunjukkan sidik jari foto tidak berubah sejak ditandatangani ParkProof, dan menghitung ulang hash menunjukkan apakah sebuah foto cocok dengan sidik jarinya. Keduanya tidak menunjukkan bahwa foto diambil dengan jujur.',
        'meta_desc': 'Panduan langkah demi langkah openssl untuk mengecek bahwa catatan bukti ParkProof tidak berubah sejak ditandatangani ParkProof. Penandatanganan kriptografis melalui AWS KMS ECDSA P-256.',
        'p_why_1': 'Sebagian besar aplikasi parkir yang menghasilkan "bukti" hanya menghasilkan tangkapan layar. Tangkapan layar bisa saja diedit kapan pun antara saat diambil dan saat dikirim. Tanda tangan kriptografis adalah perbedaan antara <em>"inilah yang aku lihat"</em> dan <em>"inilah yang aku lihat, dan siapa pun bisa mengecek bahwa itu tidak berubah sejak ParkProof menandatanganinya."</em>',
        'p_why_2': 'Kunci publik diterbitkan sehingga pengecekan bisa dilakukan sepenuhnya offline. Kamu tidak perlu memercayai ParkProof, menghubungi server kami, atau menjalankan aplikasi kami. Pengecekan bisa dilakukan bertahun-tahun dari sekarang, bahkan jika ParkProof sudah tidak berjalan, selama <code>openssl</code> masih ada.',
    },
    'ko': {
        'page_title': 'ParkProof 증거 기록 검증 | ParkProof',
        'lede': '모든 ParkProof 증거 PDF에는 암호학적 서명 부록이 있고, 모든 기록은 증거 파일로 저장할 수 있습니다. 이 페이지는 의회 직원, 보험사, 법원 서기, 운전자 본인 등 누구나 기록이 ParkProof의 서명 이후 변경되지 않았음을 오프라인으로 확인하는 방법을 안내합니다.',
        'callout_body': '유효한 서명은 <em>무결성</em>을 보여 줍니다. 서명된 내용과 사진 지문이 ParkProof가 서명 시각에 서명한 것과 정확히 같다는 뜻입니다. 서명은 기록이 <em>사실</em>임을 보여 주지 않으며(AI가 표지판을 잘못 읽었을 수 있음), 누가 운전했는지, 차가 어디에 있었는지, 차가 언제 도착하거나 떠났는지도 보여 주지 않고, 기록이 어떤 무게를 갖는지도 정하지 않습니다. 그것은 검토하는 사람이 판단합니다.',
        'p_verifying_1': 'ParkProof 기록은 링크라는 여러 부분으로 나누어 서명됩니다. 링크 0은 ParkProof가 저장된 기록을 받을 때 서명됩니다. 이후의 각 링크(주차 시 정보, 차량 상태 사진, 결제 증빙 사진, 출발 등)는 ParkProof가 받을 때 서명되며 바로 앞 링크의 SHA-256을 담고 있어, 링크들이 하나의 체인을 이룹니다. 각 링크에는 <strong>페이로드</strong>(서명된 정확한 텍스트로, 사진의 SHA-256 디지털 지문 포함)와 ParkProof의 개인 키(ECDSA P-256)로 만든 <strong>서명</strong>이 있으며, 이 개인 키는 AWS KMS 밖으로 나가지 않습니다. 증거 PDF는 서명 부록에 모든 링크를 인쇄합니다. 기록의 <strong>증거 파일</strong>(운전자가 앱의 기록 화면에서 다운로드할 수 있는 .json 파일)에는 같은 페이로드와 서명, 그리고 원본 사진이 들어 있습니다.',
        'p_verifying_2': '서명을 확인하는 데 필요한 <strong>공개 키</strong>는 ' + KEY_LINK + '에 게시되어 있습니다. 브라우저에서 열어 로드되는지 확인한 다음 저장하세요.',
        'li_need_1': '<strong>증거 PDF 또는 증거 파일</strong>. 기록을 제출하는 사람에게서 받습니다. 사진을 확인하려면 증거 파일이 필요합니다.',
        'li_need_2': '<strong><code>openssl</code></strong>. macOS와 대부분의 Linux 시스템에 들어 있습니다. Windows에서는 Git for Windows(Git Bash)나 WSL에 들어 있습니다.',
        'li_need_3': '<strong>몇 분.</strong>',
        'p_steps': 'PDF에서 맨 뒤의 서명 부록으로 가세요. 각 링크에는 텍스트로 된 페이로드, base64로 된 페이로드, base64로 된 서명의 세 블록이 있습니다. 링크 0의 base64 블록 두 개를 <code>link0-payload.b64</code>와 <code>link0-sig.b64</code>라는 파일에 복사한 다음 실행하세요:',
        'c_step_1': '1. 페이로드를 디코딩합니다. base64 -d는 PDF의 줄바꿈을 무시합니다.',
        'c_step_2': '2. 서명을 디코딩합니다.',
        'c_step_3': '3. ParkProof의 공개 키를 다운로드합니다.',
        'c_step_4': '4. 서명을 확인합니다. 예상 출력: "Verified OK".',
        'p_repeat': '각 링크마다 해당 파일 이름(<code>link1-payload.b64</code>, <code>link1-sig.b64</code> 등)으로 1, 2, 4단계를 반복하세요. base64 블록 대신 읽을 수 있는 페이로드 텍스트를 복사하지 마세요. PDF는 긴 줄을 줄바꿈하므로 바이트가 바뀌어 확인에 실패합니다.',
        'h3_windows': 'Windows에서',
        'p_windows': 'cmd나 PowerShell에는 <code>base64 -d</code>가 없습니다. Windows에 들어 있는 <code>certutil</code>로 디코딩하고, PowerShell에서는 <code>curl</code> 대신 <code>curl.exe</code>를 입력하세요. Git Bash에서는 이 페이지의 모든 명령을 그대로 실행할 수도 있습니다.',
        'h2_chain': '링크가 순서대로 이어져 있는지 확인',
        'p_chain': '링크 0 다음의 각 링크에는 <code>parent_payload_sha256</code>, 즉 바로 앞 링크 페이로드의 SHA-256이 들어 있습니다. 각 페이로드 파일의 SHA-256을 출력해 다음 링크의 값과 비교하세요.',
        'c_chain_1': '5. 링크 0 페이로드의 SHA-256을 출력합니다.',
        'c_chain_2': '"=" 뒤의 값은 링크 1의 parent_payload_sha256과 같아야 합니다.',
        'c_chain_3': '그 뒤의 각 링크도 같은 방법으로 확인합니다.',
        'p_chain_fork': '두 링크의 번호가 같다면(2a와 2b), 두 기기가 같은 지점에 각각 부분을 추가한 것입니다. 두 링크 모두 같은 앞 링크를 가리킵니다.',
        'h2_photos': '사진 확인',
        'p_photos': '서명은 이미지 자체가 아니라 각 사진의 SHA-256 디지털 지문에 대한 것입니다. PDF에 인쇄된 사진은 다시 인코딩된 사본이므로 바이트가 절대 일치하지 않습니다. 사진을 확인하려면 기록의 증거 파일을 사용하세요. 이 파일은 <code>photos</code> 아래에 각 사진을 나열하며, 사진의 <code>sha256</code>, 그 사진에 서명한 링크(<code>signed_in</code>), base64로 된 원본 바이트(<code>bytes_base64</code>)가 들어 있습니다. 파일 이름은 parkproof-evidence-로 시작하고 기록 ID의 앞부분이 이어집니다. 아래 명령에서는 이 파일을 <code>evidence.json</code>이라고 부릅니다.',
        'c_photo_1': '6. 무료 JSON 도구인 jq로 파일에서 첫 번째 사진을 꺼냅니다.',
        'c_photo_2': '7. 사진의 SHA-256을 출력합니다.',
        'c_photo_3': '8. 어느 링크의 어느 필드가 서명했는지 확인합니다.',
        'p_photo_match': '이 16진수 값은 <code>signed_in</code>에 있는 각 링크의 서명된 페이로드 안에 있는 해당 사진의 <code>sha256</code>과 같아야 합니다. 링크 0에서는 <code>sign_photo_sha256</code>, <code>car_photo_sha256</code>, <code>ambient_photo_sha256</code>이고, 이후 링크에서는 <code>photos</code>, <code>photo</code>, <code>return_photos</code> 아래의 <code>sha256</code>입니다. 파일에서 사진 옆에 있는 <code>sha256</code>은 서명되지 않았으므로, 그것만이 아니라 이미 확인한 페이로드와 비교하세요. 두 번째 사진은 <code>.photos[1]</code>을 사용하는 식입니다.',
        'p_photo_nojq': 'jq가 없다면 텍스트 편집기로 파일을 열어 사진의 <code>bytes_base64</code> 값을 <code>photo1.b64</code>라는 파일에 복사한 다음 <code>base64 -d photo1.b64 &gt; photo1.jpg</code>를 실행하세요.',
        'p_photo_windows': 'Windows에서는 PowerShell이 파일을 직접 읽을 수 있습니다:',
        'callout_photo_label': '사진 확인은 별도의 단계입니다.',
        'callout_photo_body': '<code>Verified OK</code>는 페이로드 안의 디지털 지문이 변경되지 않았음을 보여 줍니다. 원본 사진의 해시를 다시 계산해야만 그 사진이 서명된 사진임을 보여 줄 수 있습니다. 해시가 다르면 서명 확인을 통과했더라도 그 사진은 ParkProof가 서명한 사진이 아닙니다. 파일에 사진의 바이트가 없다면(<code>bytes</code>가 <code>not_on_this_device</code>이거나, 운전자가 포함하지 않기로 한 허가증 사진이라 <code>withheld_permit</code>인 경우) 그 파일로는 해당 사진을 확인할 수 없습니다.',
        'h2_file': 'PDF 대신 증거 파일 사용하기',
        'p_file': '증거 파일에는 각 링크의 페이로드와 서명도 base64로 들어 있으므로 PDF 없이 1~5단계를 할 수 있습니다. 파일에서 링크 0을 꺼낸 다음 위와 같이 3~5단계를 실행하세요:',
        'p_file_windows': 'PowerShell에서:',
        'pass_body': '<code>Verified OK</code>: 페이로드가 ParkProof가 서명한 것과 정확히 같습니다. 그 안의 내용과 사진 지문은 페이로드 안의 <code>signed_at</code> 시각에 ParkProof가 서명한 이후 변경되지 않았습니다. 사진 자체는 6~8단계에서 확인합니다.',
        'fail_body': '<code>Verification failure</code>: 페이로드나 서명이 ParkProof가 서명한 것이 아닙니다. 기록이 변경되었거나 블록이 잘못 복사되었을 수 있습니다. 결론을 내리기 전에 base64 블록을 빠짐없이 다시 복사해 다시 시도하세요.',
        'li_beyond_4': '<strong>차가 어디에 있었는지, 언제 도착하거나 떠났는지, 누가 운전했는지.</strong> 기록의 위치는 운전자의 휴대폰에서 가져온 것이거나 운전자가 직접 입력한 것입니다. 휴대폰 시간으로 표시된 시간은 운전자의 휴대폰에서 온 것이며, ParkProof의 서명 시각은 ParkProof가 각 부분을 받은 시각입니다.',
        'li_beyond_2': '<strong>사진이 그 사람이 말하는 것을 묘사하는지.</strong> 유효한 서명은 ParkProof가 서명한 이후 사진의 디지털 지문이 바뀌지 않았음을 보여 주고, 해시를 다시 계산하면 사진이 그 디지털 지문과 일치하는지 알 수 있습니다. 둘 다 사진이 정직하게 촬영되었음을 보여 주지는 않습니다.',
        'meta_desc': 'ParkProof 증거 기록이 ParkProof가 서명한 이후 변경되지 않았는지 확인하는 단계별 openssl 가이드. AWS KMS ECDSA P-256을 통한 암호학적 서명.',
        'p_why_1': '"증거"를 만든다는 대부분의 주차 앱은 스크린샷을 만듭니다. 스크린샷은 찍은 뒤 보내기 전까지 언제든 편집될 수 있습니다. 암호학적 서명은 <em>"이것이 내가 본 것"</em>과 <em>"이것이 내가 본 것이며, ParkProof가 서명한 뒤로 바뀌지 않았음을 누구나 확인할 수 있다"</em>의 차이입니다.',
        'p_why_2': '공개 키가 게시되어 있으므로 확인은 완전히 오프라인으로 할 수 있습니다. ParkProof를 신뢰하거나, 우리 서버에 연락하거나, 우리 앱을 실행할 필요가 없습니다. ParkProof가 더 이상 운영되지 않더라도 <code>openssl</code>이 있는 한 몇 년 뒤에도 확인할 수 있습니다.',
    },
    'it': {
        'page_title': 'Verifica un record di prova ParkProof | ParkProof',
        'lede': "Ogni PDF di prova ParkProof contiene un'appendice di firma crittografica, e ogni record si può salvare come file delle prove. Questa pagina mostra a chiunque, per esempio un funzionario del comune, un assicuratore, un cancelliere o il conducente stesso, come verificare offline che un record non è cambiato da quando ParkProof lo ha firmato.",
        'callout_body': "Una firma valida mostra l'<em>integrità</em>: i dettagli e le impronte digitali delle foto firmati sono esattamente quelli che ParkProof ha firmato, all'ora della firma. Non mostra che il record sia <em>vero</em> (l'AI potrebbe aver letto male il cartello), chi guidava, dove si trovava l'auto, né quando è arrivata o ripartita, e non stabilisce quale peso abbia il record. Questo spetta a chi lo esamina.",
        'p_verifying_1': "Un record ParkProof è firmato in parti, chiamate anelli. L'anello 0 viene firmato quando ParkProof riceve il record salvato. Ogni anello successivo, come i dettagli al parcheggio, le foto delle condizioni dell'auto, una foto della prova di pagamento o la partenza, viene firmato quando ParkProof lo riceve e contiene lo SHA-256 dell'anello precedente, così gli anelli formano una catena. Ogni anello ha un <strong>payload</strong> (il testo esatto che è stato firmato, comprese le impronte digitali SHA-256 delle sue foto) e una <strong>firma</strong> fatta con la chiave privata di ParkProof (ECDSA P-256), che non esce mai da AWS KMS. Il PDF di prova stampa ogni anello nella sua appendice di firma. Il <strong>file delle prove</strong> del record (un file .json che il conducente può scaricare dal record nell'app) contiene gli stessi payload e le stesse firme, più le foto originali.",
        'p_verifying_2': 'La <strong>chiave pubblica</strong> necessaria per verificare le firme è pubblicata su ' + KEY_LINK + '. Aprila nel browser per confermare che si carica, poi salvala.',
        'li_need_1': '<strong>Il PDF di prova o il file delle prove</strong>, fornito da chi presenta il record. Per verificare le foto serve il file delle prove.',
        'li_need_2': '<strong><code>openssl</code></strong>. È incluso in macOS e nella maggior parte dei sistemi Linux. Su Windows è incluso in Git for Windows (Git Bash) o in WSL.',
        'li_need_3': '<strong>Qualche minuto.</strong>',
        'p_steps': "Nel PDF, vai all'appendice di firma in fondo. Ogni anello ha tre blocchi: il payload come testo, il payload in base64 e la firma in base64. Copia i due blocchi base64 dell'anello 0 in file chiamati <code>link0-payload.b64</code> e <code>link0-sig.b64</code>, poi esegui:",
        'c_step_1': '1. Decodifica il payload. base64 -d ignora gli a capo del PDF.',
        'c_step_2': '2. Decodifica la firma.',
        'c_step_3': '3. Scarica la chiave pubblica di ParkProof.',
        'c_step_4': '4. Verifica la firma. Output atteso: "Verified OK".',
        'p_repeat': 'Ripeti i passaggi 1, 2 e 4 per ogni anello, con i relativi nomi di file (<code>link1-payload.b64</code>, <code>link1-sig.b64</code> e così via). Non copiare il testo leggibile del payload al posto del blocco base64: il PDF manda a capo le righe lunghe, i byte cambiano e la verifica non riesce.',
        'h3_windows': 'Su Windows',
        'p_windows': 'In cmd o PowerShell <code>base64 -d</code> non è disponibile. Decodifica con <code>certutil</code>, incluso in Windows, e in PowerShell digita <code>curl.exe</code> al posto di <code>curl</code>. Puoi anche eseguire tutti i comandi di questa pagina così come sono scritti in Git Bash.',
        'h2_chain': 'Controlla che gli anelli siano collegati in ordine',
        'p_chain': "Ogni anello dopo l'anello 0 contiene <code>parent_payload_sha256</code>: lo SHA-256 del payload dell'anello precedente. Stampa lo SHA-256 di ogni file payload e confrontalo con il valore nell'anello successivo.",
        'c_chain_1': "5. Stampa lo SHA-256 del payload dell'anello 0.",
        'c_chain_2': 'Il valore dopo "=" deve essere uguale a parent_payload_sha256 nell\'anello 1.',
        'c_chain_3': 'Fai lo stesso per ogni anello successivo.',
        'p_chain_fork': 'Se due anelli hanno lo stesso numero (2a e 2b), due dispositivi hanno aggiunto ciascuno una parte in quel punto. Entrambi indicano lo stesso anello precedente.',
        'h2_photos': 'Verifica le foto',
        'p_photos': "Le firme coprono l'impronta digitale SHA-256 di ogni foto, non l'immagine stessa. Le foto stampate nel PDF sono copie ricodificate, quindi i loro byte non corrispondono mai. Per verificare una foto, usa il file delle prove del record. Elenca ogni foto sotto <code>photos</code>, con il suo <code>sha256</code>, gli anelli che la firmano (<code>signed_in</code>) e i byte originali in base64 (<code>bytes_base64</code>). Il nome del file inizia con parkproof-evidence-, seguito dall'inizio dell'ID del record. I comandi qui sotto lo chiamano <code>evidence.json</code>.",
        'c_photo_1': '6. Estrai la prima foto dal file con jq, uno strumento JSON gratuito.',
        'c_photo_2': '7. Stampa il suo SHA-256.',
        'c_photo_3': '8. Guarda quale anello e quale campo la firmano.',
        'p_photo_match': "Il valore esadecimale deve essere uguale allo <code>sha256</code> della foto nel payload firmato di ogni anello in <code>signed_in</code>: <code>sign_photo_sha256</code>, <code>car_photo_sha256</code> o <code>ambient_photo_sha256</code> nell'anello 0, oppure uno <code>sha256</code> sotto <code>photos</code>, <code>photo</code> o <code>return_photos</code> in un anello successivo. Confrontalo con il payload che hai verificato, non solo con lo <code>sha256</code> accanto alla foto nel file, che non è firmato. Usa <code>.photos[1]</code> per la seconda foto, e così via.",
        'p_photo_nojq': 'Senza jq, apri il file in un editor di testo, copia il valore <code>bytes_base64</code> di una foto in un file chiamato <code>photo1.b64</code>, poi esegui <code>base64 -d photo1.b64 &gt; photo1.jpg</code>.',
        'p_photo_windows': 'Su Windows, PowerShell può leggere il file da sé:',
        'callout_photo_label': 'La verifica delle foto è un passaggio a parte.',
        'callout_photo_body': "<code>Verified OK</code> mostra che le impronte digitali nel payload non sono cambiate. Solo ricalcolare l'hash della foto originale mostra che la foto è quella firmata. Se gli hash sono diversi, quella foto non è quella firmata da ParkProof, anche se la verifica della firma è riuscita. Se il file non ha i byte di una foto (<code>bytes</code> vale <code>not_on_this_device</code>, oppure <code>withheld_permit</code> per la foto di un permesso che il conducente ha scelto di non includere), non si può usare per verificare quella foto.",
        'h2_file': 'Usare il file delle prove al posto del PDF',
        'p_file': "Il file delle prove contiene anche il payload e la firma di ogni anello in base64, quindi puoi fare i passaggi da 1 a 5 senza il PDF. Estrai l'anello 0 dal file, poi esegui i passaggi da 3 a 5 come sopra:",
        'p_file_windows': 'In PowerShell:',
        'pass_body': "<code>Verified OK</code>: il payload è esattamente ciò che ParkProof ha firmato. I dettagli e le impronte digitali delle foto che contiene non sono cambiati da quando ParkProof li ha firmati, all'ora <code>signed_at</code> indicata al suo interno. Le foto stesse si verificano nei passaggi da 6 a 8.",
        'fail_body': '<code>Verification failure</code>: il payload o la firma non sono ciò che ParkProof ha firmato. Il record potrebbe essere stato modificato, oppure un blocco è stato copiato con un errore. Copia di nuovo i blocchi base64 per intero e riprova prima di trarre conclusioni.',
        'li_beyond_4': "<strong>Dove si trovava l'auto, quando è arrivata o ripartita, o chi guidava.</strong> La posizione nel record viene dal telefono del conducente, oppure l'ha inserita il conducente a mano. Gli orari indicati come ora del telefono vengono dal telefono del conducente, e l'ora della firma di ParkProof è il momento in cui ParkProof ha ricevuto ogni parte.",
        'li_beyond_2': "<strong>Che le foto raffigurino ciò che la persona dice raffigurino.</strong> Una firma valida mostra che le impronte digitali delle foto non sono cambiate da quando ParkProof le ha firmate, e ricalcolare l'hash mostra se una foto corrisponde alla sua impronta digitale. Nessuna delle due cose mostra che le foto siano state scattate onestamente.",
        'meta_desc': 'Procedura passo-passo con openssl per verificare che un record di prova ParkProof non sia cambiato da quando ParkProof lo ha firmato. Firma crittografica tramite AWS KMS ECDSA P-256.',
        'p_why_1': 'La maggior parte delle app di parcheggio che producono "prove" producono uno screenshot. Uno screenshot può essere modificato in qualunque momento tra quando viene fatto e quando viene inviato. La firma crittografica è la differenza tra <em>"ecco cosa ho visto"</em> e <em>"ecco cosa ho visto, e chiunque può verificare che non è cambiato da quando ParkProof lo ha firmato."</em>',
        'p_why_2': 'La chiave pubblica è pubblicata perché la verifica si possa fare del tutto offline. Non devi fidarti di ParkProof, contattare i nostri server o usare la nostra app. La verifica si può fare anche tra anni, anche se ParkProof non fosse più attivo, finché esiste <code>openssl</code>.',
    },
    'el': {
        'page_title': 'Επαλήθευση μιας εγγραφής αποδεικτικών ParkProof | ParkProof',
        'lede': 'Κάθε PDF αποδεικτικών του ParkProof έχει ένα παράρτημα κρυπτογραφικής υπογραφής, και κάθε εγγραφή μπορεί να αποθηκευτεί ως αρχείο αποδεικτικών. Αυτή η σελίδα δείχνει σε οποιονδήποτε, για παράδειγμα σε έναν υπάλληλο του δήμου, έναν ασφαλιστή, έναν γραμματέα δικαστηρίου ή στον ίδιο τον οδηγό, πώς να ελέγξει εκτός σύνδεσης ότι μια εγγραφή δεν έχει αλλάξει από τότε που την υπέγραψε το ParkProof.',
        'callout_body': 'Μια έγκυρη υπογραφή δείχνει την <em>ακεραιότητα</em>: τα υπογεγραμμένα στοιχεία και τα αποτυπώματα των φωτογραφιών είναι ακριβώς αυτά που υπέγραψε το ParkProof, την ώρα της υπογραφής. Δεν δείχνει ότι η εγγραφή είναι <em>αληθινή</em> (η ΑΙ μπορεί να διάβασε λάθος την πινακίδα), ποιος οδηγούσε, πού ήταν το αυτοκίνητο ή πότε έφτασε ή έφυγε, και δεν κρίνει πόσο βάρος έχει η εγγραφή. Αυτό το κρίνει όποιος την εξετάζει.',
        'p_verifying_1': 'Μια εγγραφή ParkProof υπογράφεται σε μέρη, που λέγονται κρίκοι. Ο κρίκος 0 υπογράφεται όταν το ParkProof λάβει την αποθηκευμένη εγγραφή. Κάθε επόμενος κρίκος, όπως τα στοιχεία κατά τη στάθμευση, οι φωτογραφίες κατάστασης του αυτοκινήτου, μια φωτογραφία απόδειξης πληρωμής ή η αναχώρηση, υπογράφεται όταν το λάβει το ParkProof και περιέχει το SHA-256 του προηγούμενου κρίκου, ώστε οι κρίκοι να σχηματίζουν αλυσίδα. Κάθε κρίκος έχει ένα <strong>payload</strong> (το ακριβές κείμενο που υπογράφηκε, μαζί με τα αποτυπώματα SHA-256 των φωτογραφιών του) και μια <strong>υπογραφή</strong> με το ιδιωτικό κλειδί του ParkProof (ECDSA P-256), που δεν φεύγει ποτέ από το AWS KMS. Το PDF αποδεικτικών τυπώνει κάθε κρίκο στο παράρτημα υπογραφής. Το <strong>αρχείο αποδεικτικών</strong> της εγγραφής (ένα αρχείο .json που ο οδηγός μπορεί να κατεβάσει από την εγγραφή στην εφαρμογή) περιέχει τα ίδια payload και τις ίδιες υπογραφές, καθώς και τις πρωτότυπες φωτογραφίες.',
        'p_verifying_2': 'Το <strong>δημόσιο κλειδί</strong> που χρειάζεται για τον έλεγχο των υπογραφών δημοσιεύεται στο ' + KEY_LINK + '. Άνοιξέ το σε έναν browser για να δεις ότι φορτώνει, και μετά αποθήκευσέ το.',
        'li_need_1': '<strong>Το PDF αποδεικτικών ή το αρχείο αποδεικτικών</strong>, από το άτομο που προσκομίζει την εγγραφή. Για τον έλεγχο των φωτογραφιών χρειάζεται το αρχείο αποδεικτικών.',
        'li_need_2': '<strong><code>openssl</code></strong>. Υπάρχει στο macOS και στα περισσότερα συστήματα Linux. Στα Windows, υπάρχει στο Git for Windows (Git Bash) ή στο WSL.',
        'li_need_3': '<strong>Λίγα λεπτά.</strong>',
        'p_steps': 'Στο PDF, πήγαινε στο παράρτημα υπογραφής στο τέλος. Κάθε κρίκος έχει τρία μπλοκ: το payload ως κείμενο, το payload σε base64 και την υπογραφή σε base64. Αντίγραψε τα δύο μπλοκ base64 του κρίκου 0 σε αρχεία με ονόματα <code>link0-payload.b64</code> και <code>link0-sig.b64</code>, και μετά τρέξε:',
        'c_step_1': '1. Αποκωδικοποίησε το payload. Το base64 -d αγνοεί τις αλλαγές γραμμής του PDF.',
        'c_step_2': '2. Αποκωδικοποίησε την υπογραφή.',
        'c_step_3': '3. Κατέβασε το δημόσιο κλειδί του ParkProof.',
        'c_step_4': '4. Έλεγξε την υπογραφή. Αναμενόμενη έξοδος: "Verified OK".',
        'p_repeat': 'Κάνε τα βήματα 1, 2 και 4 για κάθε κρίκο, με τα δικά του ονόματα αρχείων (<code>link1-payload.b64</code>, <code>link1-sig.b64</code> κ.ο.κ.). Μην αντιγράφεις το αναγνώσιμο κείμενο του payload αντί για το μπλοκ base64: το PDF αναδιπλώνει τις μεγάλες γραμμές, τα bytes αλλάζουν και ο έλεγχος αποτυγχάνει.',
        'h3_windows': 'Στα Windows',
        'p_windows': 'Στο cmd ή στο PowerShell δεν υπάρχει <code>base64 -d</code>. Αποκωδικοποίησε με το <code>certutil</code>, που υπάρχει στα Windows, και στο PowerShell πληκτρολόγησε <code>curl.exe</code> αντί για <code>curl</code>. Μπορείς επίσης να τρέξεις όλες τις εντολές αυτής της σελίδας όπως είναι γραμμένες στο Git Bash.',
        'h2_chain': 'Έλεγξε ότι οι κρίκοι συνδέονται με τη σειρά',
        'p_chain': 'Κάθε κρίκος μετά τον κρίκο 0 περιέχει το <code>parent_payload_sha256</code>: το SHA-256 του payload του προηγούμενου κρίκου. Τύπωσε το SHA-256 κάθε αρχείου payload και σύγκρινέ το με την τιμή στον επόμενο κρίκο.',
        'c_chain_1': '5. Τύπωσε το SHA-256 του payload του κρίκου 0.',
        'c_chain_2': 'Η τιμή μετά το "=" πρέπει να είναι ίση με το parent_payload_sha256 στον κρίκο 1.',
        'c_chain_3': 'Κάνε το ίδιο για κάθε επόμενο κρίκο.',
        'p_chain_fork': 'Αν δύο κρίκοι έχουν τον ίδιο αριθμό (2a και 2b), δύο συσκευές πρόσθεσαν η καθεμία ένα μέρος στο ίδιο σημείο. Και οι δύο δείχνουν τον ίδιο προηγούμενο κρίκο.',
        'h2_photos': 'Έλεγξε τις φωτογραφίες',
        'p_photos': 'Οι υπογραφές καλύπτουν το αποτύπωμα SHA-256 κάθε φωτογραφίας, όχι την ίδια την εικόνα. Οι φωτογραφίες που τυπώνονται στο PDF είναι επανακωδικοποιημένα αντίγραφα, οπότε τα bytes τους δεν ταιριάζουν ποτέ. Για να ελέγξεις μια φωτογραφία, χρησιμοποίησε το αρχείο αποδεικτικών της εγγραφής. Παραθέτει κάθε φωτογραφία κάτω από το <code>photos</code>, με το <code>sha256</code> της, τους κρίκους που την υπογράφουν (<code>signed_in</code>) και τα πρωτότυπα bytes σε base64 (<code>bytes_base64</code>). Το όνομα του αρχείου ξεκινά με parkproof-evidence- και ακολουθεί η αρχή του ID της εγγραφής. Οι παρακάτω εντολές το λένε <code>evidence.json</code>.',
        'c_photo_1': '6. Βγάλε την πρώτη φωτογραφία από το αρχείο με το jq, ένα δωρεάν εργαλείο JSON.',
        'c_photo_2': '7. Τύπωσε το SHA-256 της.',
        'c_photo_3': '8. Δες ποιος κρίκος και ποιο πεδίο την υπογράφουν.',
        'p_photo_match': 'Η δεκαεξαδική τιμή πρέπει να είναι ίση με το <code>sha256</code> της φωτογραφίας μέσα στο υπογεγραμμένο payload κάθε κρίκου στο <code>signed_in</code>: <code>sign_photo_sha256</code>, <code>car_photo_sha256</code> ή <code>ambient_photo_sha256</code> στον κρίκο 0, ή ένα <code>sha256</code> κάτω από τα <code>photos</code>, <code>photo</code> ή <code>return_photos</code> σε επόμενο κρίκο. Σύγκρινέ την με το payload που έλεγξες, όχι μόνο με το <code>sha256</code> δίπλα στη φωτογραφία στο αρχείο, το οποίο δεν είναι υπογεγραμμένο. Χρησιμοποίησε <code>.photos[1]</code> για τη δεύτερη φωτογραφία, κ.ο.κ.',
        'p_photo_nojq': 'Χωρίς jq, άνοιξε το αρχείο σε έναν επεξεργαστή κειμένου, αντίγραψε την τιμή <code>bytes_base64</code> μιας φωτογραφίας σε ένα αρχείο με όνομα <code>photo1.b64</code>, και μετά τρέξε <code>base64 -d photo1.b64 &gt; photo1.jpg</code>.',
        'p_photo_windows': 'Στα Windows, το PowerShell μπορεί να διαβάσει το αρχείο μόνο του:',
        'callout_photo_label': 'Ο έλεγχος των φωτογραφιών είναι ξεχωριστό βήμα.',
        'callout_photo_body': 'Το <code>Verified OK</code> δείχνει ότι τα αποτυπώματα μέσα στο payload δεν έχουν αλλάξει. Μόνο ο εκ νέου υπολογισμός του hash της πρωτότυπης φωτογραφίας δείχνει ότι η φωτογραφία είναι αυτή που υπογράφηκε. Αν τα hash διαφέρουν, η φωτογραφία δεν είναι αυτή που υπέγραψε το ParkProof, ακόμη κι αν ο έλεγχος της υπογραφής πέτυχε. Αν το αρχείο δεν έχει τα bytes μιας φωτογραφίας (το <code>bytes</code> είναι <code>not_on_this_device</code>, ή <code>withheld_permit</code> για φωτογραφία άδειας που ο οδηγός επέλεξε να μην συμπεριλάβει), δεν μπορεί να χρησιμοποιηθεί για τον έλεγχο αυτής της φωτογραφίας.',
        'h2_file': 'Χρήση του αρχείου αποδεικτικών αντί για το PDF',
        'p_file': 'Το αρχείο αποδεικτικών περιέχει επίσης το payload και την υπογραφή κάθε κρίκου σε base64, οπότε μπορείς να κάνεις τα βήματα 1 έως 5 χωρίς το PDF. Βγάλε τον κρίκο 0 από το αρχείο και μετά τρέξε τα βήματα 3 έως 5 όπως παραπάνω:',
        'p_file_windows': 'Στο PowerShell:',
        'pass_body': '<code>Verified OK</code>: το payload είναι ακριβώς αυτό που υπέγραψε το ParkProof. Τα στοιχεία και τα αποτυπώματα φωτογραφιών που περιέχει δεν έχουν αλλάξει από τότε που τα υπέγραψε το ParkProof, την ώρα <code>signed_at</code> που αναγράφεται μέσα του. Οι ίδιες οι φωτογραφίες ελέγχονται στα βήματα 6 έως 8.',
        'fail_body': '<code>Verification failure</code>: το payload ή η υπογραφή δεν είναι αυτό που υπέγραψε το ParkProof. Η εγγραφή μπορεί να έχει αλλάξει ή ένα μπλοκ να αντιγράφηκε με λάθος. Αντίγραψε ξανά ολόκληρα τα μπλοκ base64 και δοκίμασε ξανά πριν βγάλεις συμπεράσματα.',
        'li_beyond_4': '<strong>Πού ήταν το αυτοκίνητο, πότε έφτασε ή έφυγε, ή ποιος οδηγούσε.</strong> Η τοποθεσία στην εγγραφή προέρχεται από το κινητό του οδηγού ή την πληκτρολόγησε ο ίδιος ο οδηγός. Οι ώρες που σημειώνονται ως ώρες κινητού προέρχονται από το κινητό του οδηγού, και η ώρα υπογραφής του ParkProof είναι η στιγμή που το ParkProof έλαβε κάθε μέρος.',
        'li_beyond_2': '<strong>Ότι οι φωτογραφίες απεικονίζουν αυτό που λέει το άτομο.</strong> Μια έγκυρη υπογραφή δείχνει ότι τα αποτυπώματα των φωτογραφιών δεν έχουν αλλάξει από τότε που τα υπέγραψε το ParkProof, και ο εκ νέου υπολογισμός του hash δείχνει αν μια φωτογραφία ταιριάζει με το αποτύπωμά της. Κανένα από τα δύο δεν δείχνει ότι οι φωτογραφίες τραβήχτηκαν με ειλικρίνεια.',
        'meta_desc': 'Οδηγός βήμα-βήμα με openssl για να ελέγξεις ότι μια εγγραφή αποδεικτικών ParkProof δεν έχει αλλάξει από τότε που την υπέγραψε το ParkProof. Κρυπτογραφική υπογραφή μέσω AWS KMS ECDSA P-256.',
        'p_why_1': 'Οι περισσότερες εφαρμογές στάθμευσης που παράγουν "αποδείξεις" παράγουν ένα στιγμιότυπο οθόνης. Ένα στιγμιότυπο μπορεί να έχει επεξεργαστεί οποιαδήποτε στιγμή από τη λήψη μέχρι την αποστολή. Η κρυπτογραφική υπογραφή είναι η διαφορά ανάμεσα στο <em>"να τι είδα"</em> και στο <em>"να τι είδα, και οποιοσδήποτε μπορεί να ελέγξει ότι δεν έχει αλλάξει από τότε που το υπέγραψε το ParkProof."</em>',
        'p_why_2': 'Το δημόσιο κλειδί είναι δημοσιευμένο ώστε ο έλεγχος να γίνεται εντελώς εκτός σύνδεσης. Δεν χρειάζεται να εμπιστευτείς το ParkProof, να επικοινωνήσεις με τους διακομιστές μας ή να τρέξεις την εφαρμογή μας. Ο έλεγχος μπορεί να γίνει και σε χρόνια από τώρα, ακόμη κι αν το ParkProof δεν λειτουργεί πια, αρκεί να υπάρχει το <code>openssl</code>.',
    },
    'hi': {
        'page_title': 'ParkProof साक्ष्य रिकॉर्ड सत्यापित करें | ParkProof',
        'lede': 'हर ParkProof साक्ष्य PDF में एक क्रिप्टोग्राफ़िक हस्ताक्षर परिशिष्ट होता है, और हर रिकॉर्ड को साक्ष्य फ़ाइल के रूप में सहेजा जा सकता है। यह पृष्ठ किसी को भी, जैसे परिषद के अधिकारी, बीमाकर्ता, अदालत के क्लर्क या स्वयं चालक को, बताता है कि ऑफ़लाइन कैसे जाँचें कि ParkProof के हस्ताक्षर करने के बाद से कोई रिकॉर्ड बदला नहीं है।',
        'callout_body': 'मान्य हस्ताक्षर <em>अखंडता</em> दिखाता है: हस्ताक्षरित विवरण और फ़ोटो के फिंगरप्रिंट ठीक वही हैं जिन पर ParkProof ने हस्ताक्षर के समय हस्ताक्षर किए थे। यह नहीं दिखाता कि रिकॉर्ड <em>सच</em> है (AI साइन को गलत पढ़ सकती है), चालक कौन था, कार कहाँ थी, या वह कब पहुँची या कब गई, और यह तय नहीं करता कि रिकॉर्ड का कितना महत्व है। यह समीक्षा करने वाले व्यक्ति पर है।',
        'p_verifying_1': 'ParkProof रिकॉर्ड पर हिस्सों में हस्ताक्षर होते हैं, जिन्हें कड़ियाँ कहते हैं। ParkProof को सहेजा गया रिकॉर्ड मिलने पर कड़ी 0 पर हस्ताक्षर होते हैं। बाद की हर कड़ी, जैसे पार्क करते समय का विवरण, कार की हालत की फ़ोटो, भुगतान के प्रमाण की फ़ोटो या प्रस्थान, ParkProof को मिलने पर हस्ताक्षरित होती है और उसमें पिछली कड़ी का SHA-256 होता है, इसलिए कड़ियाँ मिलकर एक शृंखला बनाती हैं। हर कड़ी में एक <strong>पेलोड</strong> (वह सटीक पाठ जिस पर हस्ताक्षर हुए, उसकी फ़ोटो के SHA-256 फिंगरप्रिंट सहित) और ParkProof की निजी कुंजी (ECDSA P-256) से बना एक <strong>हस्ताक्षर</strong> होता है, और यह कुंजी कभी AWS KMS से बाहर नहीं जाती। साक्ष्य PDF अपने हस्ताक्षर परिशिष्ट में हर कड़ी छापता है। रिकॉर्ड की <strong>साक्ष्य फ़ाइल</strong> (एक .json फ़ाइल, जिसे ऐप में रिकॉर्ड से डाउनलोड किया जा सकता है) में वही पेलोड और हस्ताक्षर होते हैं, और साथ में मूल फ़ोटो भी।',
        'p_verifying_2': 'हस्ताक्षर जाँचने के लिए ज़रूरी <strong>सार्वजनिक कुंजी</strong> ' + KEY_LINK + ' पर प्रकाशित है। यह पुष्टि करने के लिए कि यह लोड होती है, इसे ब्राउज़र में खोलें, फिर सहेजें।',
        'li_need_1': '<strong>साक्ष्य PDF या साक्ष्य फ़ाइल</strong>, जो रिकॉर्ड पेश करने वाले व्यक्ति से मिलेगी। फ़ोटो जाँचने के लिए साक्ष्य फ़ाइल ज़रूरी है।',
        'li_need_2': '<strong><code>openssl</code></strong>। यह macOS और ज़्यादातर Linux सिस्टम में होता है। Windows पर यह Git for Windows (Git Bash) या WSL में होता है।',
        'li_need_3': '<strong>कुछ मिनट।</strong>',
        'p_steps': 'PDF में पीछे दिए हस्ताक्षर परिशिष्ट पर जाएँ। हर कड़ी के तीन ब्लॉक होते हैं: पाठ के रूप में पेलोड, base64 में पेलोड और base64 में हस्ताक्षर। कड़ी 0 के दोनों base64 ब्लॉक <code>link0-payload.b64</code> और <code>link0-sig.b64</code> नाम की फ़ाइलों में कॉपी करें, फिर चलाएँ:',
        'c_step_1': '1. पेलोड डिकोड करें। base64 -d, PDF की लाइन रैपिंग को अनदेखा करता है।',
        'c_step_2': '2. हस्ताक्षर डिकोड करें।',
        'c_step_3': '3. ParkProof की सार्वजनिक कुंजी डाउनलोड करें।',
        'c_step_4': '4. हस्ताक्षर जाँचें। अपेक्षित आउटपुट: "Verified OK"।',
        'p_repeat': 'हर कड़ी के लिए उसके अपने फ़ाइल नामों (<code>link1-payload.b64</code>, <code>link1-sig.b64</code> आदि) के साथ चरण 1, 2 और 4 दोहराएँ। base64 ब्लॉक की जगह पढ़ने योग्य पेलोड पाठ कॉपी न करें: PDF लंबी लाइनों को तोड़ देता है, जिससे बाइट्स बदल जाते हैं और जाँच विफल हो जाती है।',
        'h3_windows': 'Windows पर',
        'p_windows': 'cmd या PowerShell में <code>base64 -d</code> उपलब्ध नहीं है। Windows के साथ आने वाले <code>certutil</code> से डिकोड करें, और PowerShell में <code>curl</code> की जगह <code>curl.exe</code> टाइप करें। आप इस पृष्ठ के सभी कमांड Git Bash में वैसे ही चला भी सकते हैं जैसे लिखे हैं।',
        'h2_chain': 'जाँचें कि कड़ियाँ क्रम से जुड़ी हैं',
        'p_chain': 'कड़ी 0 के बाद की हर कड़ी में <code>parent_payload_sha256</code> होता है, यानी उससे पहले की कड़ी के पेलोड का SHA-256। हर पेलोड फ़ाइल का SHA-256 दिखाएँ और उसकी तुलना अगली कड़ी के मान से करें।',
        'c_chain_1': '5. कड़ी 0 के पेलोड का SHA-256 दिखाएँ।',
        'c_chain_2': '"=" के बाद का मान कड़ी 1 के parent_payload_sha256 के बराबर होना चाहिए।',
        'c_chain_3': 'आगे की हर कड़ी के लिए यही करें।',
        'p_chain_fork': 'अगर दो कड़ियों का नंबर एक ही है (2a और 2b), तो दो डिवाइस ने उसी जगह एक-एक हिस्सा जोड़ा है। दोनों एक ही पिछली कड़ी की ओर इशारा करती हैं।',
        'h2_photos': 'फ़ोटो जाँचें',
        'p_photos': 'हस्ताक्षर हर फ़ोटो के SHA-256 फिंगरप्रिंट पर होते हैं, छवि पर नहीं। PDF में छपी फ़ोटो फिर से एन्कोड की गई प्रतियाँ हैं, इसलिए उनके बाइट्स कभी मेल नहीं खाते। किसी फ़ोटो की जाँच के लिए रिकॉर्ड की साक्ष्य फ़ाइल का उपयोग करें। इसमें <code>photos</code> के नीचे हर फ़ोटो दी होती है, उसके <code>sha256</code>, उस पर हस्ताक्षर करने वाली कड़ियों (<code>signed_in</code>) और base64 में मूल बाइट्स (<code>bytes_base64</code>) के साथ। फ़ाइल का नाम parkproof-evidence- से शुरू होता है, और उसके बाद रिकॉर्ड ID का शुरुआती हिस्सा आता है। नीचे के कमांड इसे <code>evidence.json</code> कहते हैं।',
        'c_photo_1': '6. मुफ़्त JSON टूल jq से फ़ाइल में से पहली फ़ोटो निकालें।',
        'c_photo_2': '7. उसका SHA-256 दिखाएँ।',
        'c_photo_3': '8. देखें कि किस कड़ी और किस फ़ील्ड में उस पर हस्ताक्षर हैं।',
        'p_photo_match': 'यह हेक्स मान <code>signed_in</code> में दी हर कड़ी के हस्ताक्षरित पेलोड में उस फ़ोटो के <code>sha256</code> के बराबर होना चाहिए: कड़ी 0 में <code>sign_photo_sha256</code>, <code>car_photo_sha256</code> या <code>ambient_photo_sha256</code>, या बाद की कड़ी में <code>photos</code>, <code>photo</code> या <code>return_photos</code> के नीचे कोई <code>sha256</code>। इसकी तुलना उस पेलोड से करें जिसे आपने जाँचा है, न कि सिर्फ़ फ़ाइल में फ़ोटो के पास लिखे <code>sha256</code> से, जिस पर हस्ताक्षर नहीं है। दूसरी फ़ोटो के लिए <code>.photos[1]</code> का उपयोग करें, और इसी तरह आगे।',
        'p_photo_nojq': 'jq के बिना, फ़ाइल को टेक्स्ट एडिटर में खोलें, किसी फ़ोटो का <code>bytes_base64</code> मान <code>photo1.b64</code> नाम की फ़ाइल में कॉपी करें, फिर <code>base64 -d photo1.b64 &gt; photo1.jpg</code> चलाएँ।',
        'p_photo_windows': 'Windows पर PowerShell फ़ाइल को खुद पढ़ सकता है:',
        'callout_photo_label': 'फ़ोटो की जाँच एक अलग चरण है।',
        'callout_photo_body': '<code>Verified OK</code> दिखाता है कि पेलोड में दिए फिंगरप्रिंट नहीं बदले हैं। सिर्फ़ मूल फ़ोटो का हैश फिर से निकालने से ही पता चलता है कि फ़ोटो वही है जिस पर हस्ताक्षर हुए थे। अगर हैश अलग हैं, तो वह फ़ोटो वह नहीं है जिस पर ParkProof ने हस्ताक्षर किए थे, भले ही हस्ताक्षर की जाँच सफल रही हो। अगर फ़ाइल में किसी फ़ोटो के बाइट्स नहीं हैं (<code>bytes</code> का मान <code>not_on_this_device</code> है, या परमिट की ऐसी फ़ोटो के लिए <code>withheld_permit</code> है जिसे चालक ने शामिल न करना चुना), तो उस फ़ोटो की जाँच इस फ़ाइल से नहीं हो सकती।',
        'h2_file': 'PDF की जगह साक्ष्य फ़ाइल का उपयोग',
        'p_file': 'साक्ष्य फ़ाइल में हर कड़ी का पेलोड और हस्ताक्षर भी base64 में होते हैं, इसलिए आप PDF के बिना चरण 1 से 5 कर सकते हैं। फ़ाइल से कड़ी 0 निकालें, फिर ऊपर की तरह चरण 3 से 5 चलाएँ:',
        'p_file_windows': 'PowerShell में:',
        'pass_body': '<code>Verified OK</code>: पेलोड ठीक वही है जिस पर ParkProof ने हस्ताक्षर किए थे। इसमें दिए विवरण और फ़ोटो के फिंगरप्रिंट, पेलोड में दिए <code>signed_at</code> समय पर ParkProof के हस्ताक्षर करने के बाद से नहीं बदले हैं। फ़ोटो की जाँच खुद चरण 6 से 8 में होती है।',
        'fail_body': '<code>Verification failure</code>: पेलोड या हस्ताक्षर वह नहीं है जिस पर ParkProof ने हस्ताक्षर किए थे। हो सकता है रिकॉर्ड बदला गया हो, या कोई ब्लॉक गलत कॉपी हुआ हो। निष्कर्ष निकालने से पहले base64 ब्लॉक पूरे फिर से कॉपी करें और दोबारा कोशिश करें।',
        'li_beyond_4': '<strong>कार कहाँ थी, कब पहुँची या कब गई, या चालक कौन था।</strong> रिकॉर्ड में दर्ज जगह चालक के फ़ोन से आती है, या चालक ने उसे खुद दर्ज किया है। फ़ोन के समय के रूप में दिखाए गए समय चालक के फ़ोन से आते हैं, और ParkProof के हस्ताक्षर का समय वह समय है जब ParkProof को हर हिस्सा मिला।',
        'li_beyond_2': '<strong>कि फ़ोटो वही दिखाती हैं जो व्यक्ति कहता है कि वे दिखाती हैं।</strong> एक मान्य हस्ताक्षर दिखाता है कि ParkProof के हस्ताक्षर करने के बाद से फ़ोटो के फिंगरप्रिंट नहीं बदले हैं, और हैश फिर से निकालने से पता चलता है कि कोई फ़ोटो अपने फिंगरप्रिंट से मेल खाती है या नहीं। इनमें से कोई भी यह नहीं दिखाता कि फ़ोटो ईमानदारी से ली गई थीं।',
        'meta_desc': 'यह जाँचने के लिए चरण-दर-चरण openssl गाइड कि ParkProof साक्ष्य रिकॉर्ड ParkProof के हस्ताक्षर करने के बाद से नहीं बदला है। AWS KMS ECDSA P-256 के माध्यम से क्रिप्टोग्राफिक हस्ताक्षर।',
        'p_why_1': '"साक्ष्य" बनाने वाले ज़्यादातर पार्किंग ऐप एक स्क्रीनशॉट बनाते हैं। स्क्रीनशॉट को लेने और भेजने के बीच किसी भी समय संपादित किया जा सकता है। क्रिप्टोग्राफ़िक हस्ताक्षर <em>"यह मैंने देखा"</em> और <em>"यह मैंने देखा, और कोई भी जाँच सकता है कि ParkProof के हस्ताक्षर के बाद से यह बदला नहीं है"</em> के बीच का अंतर है।',
        'p_why_2': 'सार्वजनिक कुंजी प्रकाशित है, ताकि जाँच पूरी तरह ऑफ़लाइन हो सके। आपको ParkProof पर भरोसा करने, हमारे सर्वर से संपर्क करने या हमारा ऐप चलाने की ज़रूरत नहीं है। ParkProof के बंद हो जाने पर भी, जब तक <code>openssl</code> मौजूद है, जाँच बरसों बाद भी की जा सकती है।',
    },
    'pa': {
        'page_title': 'ParkProof ਸਬੂਤ ਰਿਕਾਰਡ ਦੀ ਪੁਸ਼ਟੀ ਕਰੋ | ParkProof',
        'lede': 'ਹਰ ParkProof ਸਬੂਤ PDF ਵਿੱਚ ਇੱਕ ਕ੍ਰਿਪਟੋਗ੍ਰਾਫਿਕ ਹਸਤਾਖਰ ਅੰਤਿਕਾ ਹੁੰਦੀ ਹੈ, ਅਤੇ ਹਰ ਰਿਕਾਰਡ ਨੂੰ ਸਬੂਤ ਫ਼ਾਈਲ ਵਜੋਂ ਸੰਭਾਲਿਆ ਜਾ ਸਕਦਾ ਹੈ। ਇਹ ਪੰਨਾ ਕਿਸੇ ਨੂੰ ਵੀ, ਜਿਵੇਂ ਕੌਂਸਲ ਦੇ ਅਧਿਕਾਰੀ, ਬੀਮਾਕਰਤਾ, ਅਦਾਲਤ ਦੇ ਕਲਰਕ ਜਾਂ ਖੁਦ ਡਰਾਈਵਰ ਨੂੰ, ਦੱਸਦਾ ਹੈ ਕਿ ਔਫਲਾਈਨ ਕਿਵੇਂ ਜਾਂਚਣਾ ਹੈ ਕਿ ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਕੋਈ ਰਿਕਾਰਡ ਬਦਲਿਆ ਨਹੀਂ।',
        'callout_body': "ਵੈਧ ਹਸਤਾਖਰ <em>ਅਖੰਡਤਾ</em> ਦਿਖਾਉਂਦਾ ਹੈ: ਹਸਤਾਖਰਿਤ ਵੇਰਵੇ ਅਤੇ ਫੋਟੋਆਂ ਦੇ ਫਿੰਗਰਪ੍ਰਿੰਟ ਬਿਲਕੁਲ ਉਹੀ ਹਨ ਜਿਨ੍ਹਾਂ 'ਤੇ ParkProof ਨੇ ਹਸਤਾਖਰ ਦੇ ਸਮੇਂ ਹਸਤਾਖਰ ਕੀਤੇ ਸਨ। ਇਹ ਨਹੀਂ ਦਿਖਾਉਂਦਾ ਕਿ ਰਿਕਾਰਡ <em>ਸੱਚ</em> ਹੈ (AI ਚਿੰਨ੍ਹ ਨੂੰ ਗਲਤ ਪੜ੍ਹ ਸਕਦੀ ਹੈ), ਡਰਾਈਵਰ ਕੌਣ ਸੀ, ਕਾਰ ਕਿੱਥੇ ਸੀ, ਜਾਂ ਉਹ ਕਦੋਂ ਪਹੁੰਚੀ ਜਾਂ ਕਦੋਂ ਗਈ, ਅਤੇ ਇਹ ਤੈਅ ਨਹੀਂ ਕਰਦਾ ਕਿ ਰਿਕਾਰਡ ਦੀ ਕਿੰਨੀ ਅਹਿਮੀਅਤ ਹੈ। ਇਹ ਸਮੀਖਿਆ ਕਰਨ ਵਾਲੇ 'ਤੇ ਹੈ।",
        'p_verifying_1': "ParkProof ਰਿਕਾਰਡ 'ਤੇ ਹਿੱਸਿਆਂ ਵਿੱਚ ਹਸਤਾਖਰ ਹੁੰਦੇ ਹਨ, ਜਿਨ੍ਹਾਂ ਨੂੰ ਕੜੀਆਂ ਕਹਿੰਦੇ ਹਨ। ParkProof ਨੂੰ ਸੰਭਾਲਿਆ ਰਿਕਾਰਡ ਮਿਲਣ 'ਤੇ ਕੜੀ 0 'ਤੇ ਹਸਤਾਖਰ ਹੁੰਦੇ ਹਨ। ਬਾਅਦ ਦੀ ਹਰ ਕੜੀ, ਜਿਵੇਂ ਪਾਰਕ ਕਰਦੇ ਸਮੇਂ ਦੇ ਵੇਰਵੇ, ਕਾਰ ਦੀ ਹਾਲਤ ਦੀਆਂ ਫੋਟੋਆਂ, ਭੁਗਤਾਨ ਦੇ ਸਬੂਤ ਦੀ ਫੋਟੋ ਜਾਂ ਰਵਾਨਗੀ, ParkProof ਨੂੰ ਮਿਲਣ 'ਤੇ ਹਸਤਾਖਰਿਤ ਹੁੰਦੀ ਹੈ ਅਤੇ ਉਸ ਵਿੱਚ ਪਿਛਲੀ ਕੜੀ ਦਾ SHA-256 ਹੁੰਦਾ ਹੈ, ਇਸ ਲਈ ਕੜੀਆਂ ਮਿਲ ਕੇ ਇੱਕ ਲੜੀ ਬਣਾਉਂਦੀਆਂ ਹਨ। ਹਰ ਕੜੀ ਵਿੱਚ ਇੱਕ <strong>ਪੇਲੋਡ</strong> (ਉਹ ਸਹੀ ਲਿਖਤ ਜਿਸ 'ਤੇ ਹਸਤਾਖਰ ਹੋਏ, ਉਸ ਦੀਆਂ ਫੋਟੋਆਂ ਦੇ SHA-256 ਫਿੰਗਰਪ੍ਰਿੰਟਾਂ ਸਮੇਤ) ਅਤੇ ParkProof ਦੀ ਨਿੱਜੀ ਕੁੰਜੀ (ECDSA P-256) ਨਾਲ ਬਣਿਆ ਇੱਕ <strong>ਹਸਤਾਖਰ</strong> ਹੁੰਦਾ ਹੈ, ਅਤੇ ਇਹ ਕੁੰਜੀ ਕਦੇ AWS KMS ਤੋਂ ਬਾਹਰ ਨਹੀਂ ਜਾਂਦੀ। ਸਬੂਤ PDF ਆਪਣੀ ਹਸਤਾਖਰ ਅੰਤਿਕਾ ਵਿੱਚ ਹਰ ਕੜੀ ਛਾਪਦੀ ਹੈ। ਰਿਕਾਰਡ ਦੀ <strong>ਸਬੂਤ ਫ਼ਾਈਲ</strong> (ਇੱਕ .json ਫ਼ਾਈਲ, ਜਿਸ ਨੂੰ ਐਪ ਵਿੱਚ ਰਿਕਾਰਡ ਤੋਂ ਡਾਊਨਲੋਡ ਕੀਤਾ ਜਾ ਸਕਦਾ ਹੈ) ਵਿੱਚ ਉਹੀ ਪੇਲੋਡ ਅਤੇ ਹਸਤਾਖਰ ਹੁੰਦੇ ਹਨ, ਨਾਲ ਹੀ ਅਸਲ ਫੋਟੋਆਂ ਵੀ।",
        'p_verifying_2': 'ਹਸਤਾਖਰਾਂ ਦੀ ਜਾਂਚ ਲਈ ਲੋੜੀਂਦੀ <strong>ਜਨਤਕ ਕੁੰਜੀ</strong> ' + KEY_LINK + " 'ਤੇ ਪ੍ਰਕਾਸ਼ਿਤ ਹੈ। ਇਹ ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ ਕਿ ਇਹ ਲੋਡ ਹੁੰਦੀ ਹੈ, ਇਸ ਨੂੰ ਬ੍ਰਾਊਜ਼ਰ ਵਿੱਚ ਖੋਲ੍ਹੋ, ਫਿਰ ਸੰਭਾਲੋ।",
        'li_need_1': '<strong>ਸਬੂਤ PDF ਜਾਂ ਸਬੂਤ ਫ਼ਾਈਲ</strong>, ਜੋ ਰਿਕਾਰਡ ਪੇਸ਼ ਕਰਨ ਵਾਲੇ ਵਿਅਕਤੀ ਤੋਂ ਮਿਲੇਗੀ। ਫੋਟੋਆਂ ਦੀ ਜਾਂਚ ਲਈ ਸਬੂਤ ਫ਼ਾਈਲ ਲੋੜੀਂਦੀ ਹੈ।',
        'li_need_2': "<strong><code>openssl</code></strong>। ਇਹ macOS ਅਤੇ ਜ਼ਿਆਦਾਤਰ Linux ਸਿਸਟਮਾਂ ਵਿੱਚ ਹੁੰਦਾ ਹੈ। Windows 'ਤੇ ਇਹ Git for Windows (Git Bash) ਜਾਂ WSL ਵਿੱਚ ਹੁੰਦਾ ਹੈ।",
        'li_need_3': '<strong>ਕੁਝ ਮਿੰਟ।</strong>',
        'p_steps': "PDF ਵਿੱਚ ਪਿੱਛੇ ਦਿੱਤੀ ਹਸਤਾਖਰ ਅੰਤਿਕਾ 'ਤੇ ਜਾਓ। ਹਰ ਕੜੀ ਦੇ ਤਿੰਨ ਬਲਾਕ ਹੁੰਦੇ ਹਨ: ਲਿਖਤ ਵਜੋਂ ਪੇਲੋਡ, base64 ਵਿੱਚ ਪੇਲੋਡ ਅਤੇ base64 ਵਿੱਚ ਹਸਤਾਖਰ। ਕੜੀ 0 ਦੇ ਦੋਵੇਂ base64 ਬਲਾਕ <code>link0-payload.b64</code> ਅਤੇ <code>link0-sig.b64</code> ਨਾਂ ਦੀਆਂ ਫ਼ਾਈਲਾਂ ਵਿੱਚ ਕਾਪੀ ਕਰੋ, ਫਿਰ ਚਲਾਓ:",
        'c_step_1': '1. ਪੇਲੋਡ ਡੀਕੋਡ ਕਰੋ। base64 -d, PDF ਦੀ ਲਾਈਨ ਰੈਪਿੰਗ ਨੂੰ ਅਣਡਿੱਠ ਕਰਦਾ ਹੈ।',
        'c_step_2': '2. ਹਸਤਾਖਰ ਡੀਕੋਡ ਕਰੋ।',
        'c_step_3': '3. ParkProof ਦੀ ਜਨਤਕ ਕੁੰਜੀ ਡਾਊਨਲੋਡ ਕਰੋ।',
        'c_step_4': '4. ਹਸਤਾਖਰ ਦੀ ਜਾਂਚ ਕਰੋ। ਉਮੀਦ ਕੀਤਾ ਆਉਟਪੁੱਟ: "Verified OK"।',
        'p_repeat': 'ਹਰ ਕੜੀ ਲਈ ਉਸ ਦੇ ਆਪਣੇ ਫ਼ਾਈਲ ਨਾਵਾਂ (<code>link1-payload.b64</code>, <code>link1-sig.b64</code> ਆਦਿ) ਨਾਲ ਕਦਮ 1, 2 ਅਤੇ 4 ਦੁਹਰਾਓ। base64 ਬਲਾਕ ਦੀ ਥਾਂ ਪੜ੍ਹਨਯੋਗ ਪੇਲੋਡ ਲਿਖਤ ਕਾਪੀ ਨਾ ਕਰੋ: PDF ਲੰਬੀਆਂ ਲਾਈਨਾਂ ਨੂੰ ਤੋੜ ਦਿੰਦੀ ਹੈ, ਜਿਸ ਨਾਲ ਬਾਈਟਾਂ ਬਦਲ ਜਾਂਦੀਆਂ ਹਨ ਅਤੇ ਜਾਂਚ ਅਸਫਲ ਹੋ ਜਾਂਦੀ ਹੈ।',
        'h3_windows': "Windows 'ਤੇ",
        'p_windows': 'cmd ਜਾਂ PowerShell ਵਿੱਚ <code>base64 -d</code> ਉਪਲਬਧ ਨਹੀਂ ਹੈ। Windows ਨਾਲ ਆਉਣ ਵਾਲੇ <code>certutil</code> ਨਾਲ ਡੀਕੋਡ ਕਰੋ, ਅਤੇ PowerShell ਵਿੱਚ <code>curl</code> ਦੀ ਥਾਂ <code>curl.exe</code> ਟਾਈਪ ਕਰੋ। ਤੁਸੀਂ ਇਸ ਪੰਨੇ ਦੀਆਂ ਸਾਰੀਆਂ ਕਮਾਂਡਾਂ Git Bash ਵਿੱਚ ਉਵੇਂ ਹੀ ਚਲਾ ਵੀ ਸਕਦੇ ਹੋ ਜਿਵੇਂ ਲਿਖੀਆਂ ਹਨ।',
        'h2_chain': 'ਜਾਂਚੋ ਕਿ ਕੜੀਆਂ ਤਰਤੀਬ ਨਾਲ ਜੁੜੀਆਂ ਹਨ',
        'p_chain': 'ਕੜੀ 0 ਤੋਂ ਬਾਅਦ ਹਰ ਕੜੀ ਵਿੱਚ <code>parent_payload_sha256</code> ਹੁੰਦਾ ਹੈ, ਯਾਨੀ ਉਸ ਤੋਂ ਪਹਿਲੀ ਕੜੀ ਦੇ ਪੇਲੋਡ ਦਾ SHA-256। ਹਰ ਪੇਲੋਡ ਫ਼ਾਈਲ ਦਾ SHA-256 ਦਿਖਾਓ ਅਤੇ ਅਗਲੀ ਕੜੀ ਦੇ ਮੁੱਲ ਨਾਲ ਤੁਲਨਾ ਕਰੋ।',
        'c_chain_1': '5. ਕੜੀ 0 ਦੇ ਪੇਲੋਡ ਦਾ SHA-256 ਦਿਖਾਓ।',
        'c_chain_2': '"=" ਤੋਂ ਬਾਅਦ ਦਾ ਮੁੱਲ ਕੜੀ 1 ਦੇ parent_payload_sha256 ਦੇ ਬਰਾਬਰ ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ।',
        'c_chain_3': 'ਅੱਗੇ ਦੀ ਹਰ ਕੜੀ ਲਈ ਇਹੀ ਕਰੋ।',
        'p_chain_fork': 'ਜੇ ਦੋ ਕੜੀਆਂ ਦਾ ਨੰਬਰ ਇੱਕੋ ਹੈ (2a ਅਤੇ 2b), ਤਾਂ ਦੋ ਡਿਵਾਈਸਾਂ ਨੇ ਉਸੇ ਥਾਂ ਇੱਕ-ਇੱਕ ਹਿੱਸਾ ਜੋੜਿਆ ਹੈ। ਦੋਵੇਂ ਇੱਕੋ ਪਿਛਲੀ ਕੜੀ ਵੱਲ ਇਸ਼ਾਰਾ ਕਰਦੀਆਂ ਹਨ।',
        'h2_photos': 'ਫੋਟੋਆਂ ਦੀ ਜਾਂਚ ਕਰੋ',
        'p_photos': "ਹਸਤਾਖਰ ਹਰ ਫੋਟੋ ਦੇ SHA-256 ਫਿੰਗਰਪ੍ਰਿੰਟ 'ਤੇ ਹੁੰਦੇ ਹਨ, ਤਸਵੀਰ 'ਤੇ ਨਹੀਂ। PDF ਵਿੱਚ ਛਪੀਆਂ ਫੋਟੋਆਂ ਮੁੜ-ਏਨਕੋਡ ਕੀਤੀਆਂ ਨਕਲਾਂ ਹਨ, ਇਸ ਲਈ ਉਨ੍ਹਾਂ ਦੀਆਂ ਬਾਈਟਾਂ ਕਦੇ ਮੇਲ ਨਹੀਂ ਖਾਂਦੀਆਂ। ਕਿਸੇ ਫੋਟੋ ਦੀ ਜਾਂਚ ਲਈ ਰਿਕਾਰਡ ਦੀ ਸਬੂਤ ਫ਼ਾਈਲ ਵਰਤੋ। ਇਸ ਵਿੱਚ <code>photos</code> ਹੇਠ ਹਰ ਫੋਟੋ ਦਿੱਤੀ ਹੁੰਦੀ ਹੈ, ਉਸ ਦੇ <code>sha256</code>, ਉਸ 'ਤੇ ਹਸਤਾਖਰ ਕਰਨ ਵਾਲੀਆਂ ਕੜੀਆਂ (<code>signed_in</code>) ਅਤੇ base64 ਵਿੱਚ ਅਸਲ ਬਾਈਟਾਂ (<code>bytes_base64</code>) ਸਮੇਤ। ਫ਼ਾਈਲ ਦਾ ਨਾਂ parkproof-evidence- ਨਾਲ ਸ਼ੁਰੂ ਹੁੰਦਾ ਹੈ, ਅਤੇ ਉਸ ਤੋਂ ਬਾਅਦ ਰਿਕਾਰਡ ID ਦਾ ਸ਼ੁਰੂਆਤੀ ਹਿੱਸਾ ਆਉਂਦਾ ਹੈ। ਹੇਠਲੀਆਂ ਕਮਾਂਡਾਂ ਇਸ ਨੂੰ <code>evidence.json</code> ਕਹਿੰਦੀਆਂ ਹਨ।",
        'c_photo_1': '6. ਮੁਫ਼ਤ JSON ਟੂਲ jq ਨਾਲ ਫ਼ਾਈਲ ਵਿੱਚੋਂ ਪਹਿਲੀ ਫੋਟੋ ਕੱਢੋ।',
        'c_photo_2': '7. ਉਸ ਦਾ SHA-256 ਦਿਖਾਓ।',
        'c_photo_3': "8. ਦੇਖੋ ਕਿ ਕਿਸ ਕੜੀ ਅਤੇ ਕਿਸ ਫੀਲਡ ਵਿੱਚ ਉਸ 'ਤੇ ਹਸਤਾਖਰ ਹਨ।",
        'p_photo_match': "ਇਹ ਹੈਕਸ ਮੁੱਲ <code>signed_in</code> ਵਿੱਚ ਦਿੱਤੀ ਹਰ ਕੜੀ ਦੇ ਹਸਤਾਖਰਿਤ ਪੇਲੋਡ ਵਿੱਚ ਉਸ ਫੋਟੋ ਦੇ <code>sha256</code> ਦੇ ਬਰਾਬਰ ਹੋਣਾ ਚਾਹੀਦਾ ਹੈ: ਕੜੀ 0 ਵਿੱਚ <code>sign_photo_sha256</code>, <code>car_photo_sha256</code> ਜਾਂ <code>ambient_photo_sha256</code>, ਜਾਂ ਬਾਅਦ ਦੀ ਕੜੀ ਵਿੱਚ <code>photos</code>, <code>photo</code> ਜਾਂ <code>return_photos</code> ਹੇਠ ਕੋਈ <code>sha256</code>। ਇਸ ਦੀ ਤੁਲਨਾ ਉਸ ਪੇਲੋਡ ਨਾਲ ਕਰੋ ਜਿਸ ਦੀ ਤੁਸੀਂ ਜਾਂਚ ਕੀਤੀ ਹੈ, ਨਾ ਕਿ ਸਿਰਫ਼ ਫ਼ਾਈਲ ਵਿੱਚ ਫੋਟੋ ਦੇ ਕੋਲ ਲਿਖੇ <code>sha256</code> ਨਾਲ, ਜਿਸ 'ਤੇ ਹਸਤਾਖਰ ਨਹੀਂ ਹਨ। ਦੂਜੀ ਫੋਟੋ ਲਈ <code>.photos[1]</code> ਵਰਤੋ, ਅਤੇ ਇਸੇ ਤਰ੍ਹਾਂ ਅੱਗੇ।",
        'p_photo_nojq': 'jq ਤੋਂ ਬਿਨਾਂ, ਫ਼ਾਈਲ ਨੂੰ ਟੈਕਸਟ ਐਡੀਟਰ ਵਿੱਚ ਖੋਲ੍ਹੋ, ਕਿਸੇ ਫੋਟੋ ਦਾ <code>bytes_base64</code> ਮੁੱਲ <code>photo1.b64</code> ਨਾਂ ਦੀ ਫ਼ਾਈਲ ਵਿੱਚ ਕਾਪੀ ਕਰੋ, ਫਿਰ <code>base64 -d photo1.b64 &gt; photo1.jpg</code> ਚਲਾਓ।',
        'p_photo_windows': "Windows 'ਤੇ PowerShell ਫ਼ਾਈਲ ਨੂੰ ਖੁਦ ਪੜ੍ਹ ਸਕਦਾ ਹੈ:",
        'callout_photo_label': 'ਫੋਟੋਆਂ ਦੀ ਜਾਂਚ ਇੱਕ ਵੱਖਰਾ ਕਦਮ ਹੈ।',
        'callout_photo_body': "<code>Verified OK</code> ਦਿਖਾਉਂਦਾ ਹੈ ਕਿ ਪੇਲੋਡ ਵਿੱਚ ਦਿੱਤੇ ਫਿੰਗਰਪ੍ਰਿੰਟ ਨਹੀਂ ਬਦਲੇ। ਸਿਰਫ਼ ਅਸਲ ਫੋਟੋ ਦਾ ਹੈਸ਼ ਮੁੜ ਕੱਢਣ ਨਾਲ ਹੀ ਪਤਾ ਲੱਗਦਾ ਹੈ ਕਿ ਫੋਟੋ ਉਹੀ ਹੈ ਜਿਸ 'ਤੇ ਹਸਤਾਖਰ ਹੋਏ ਸਨ। ਜੇ ਹੈਸ਼ ਵੱਖਰੇ ਹਨ, ਤਾਂ ਉਹ ਫੋਟੋ ਉਹ ਨਹੀਂ ਹੈ ਜਿਸ 'ਤੇ ParkProof ਨੇ ਹਸਤਾਖਰ ਕੀਤੇ ਸਨ, ਭਾਵੇਂ ਹਸਤਾਖਰ ਦੀ ਜਾਂਚ ਸਫਲ ਰਹੀ ਹੋਵੇ। ਜੇ ਫ਼ਾਈਲ ਵਿੱਚ ਕਿਸੇ ਫੋਟੋ ਦੀਆਂ ਬਾਈਟਾਂ ਨਹੀਂ ਹਨ (<code>bytes</code> ਦਾ ਮੁੱਲ <code>not_on_this_device</code> ਹੈ, ਜਾਂ ਪਰਮਿਟ ਦੀ ਅਜਿਹੀ ਫੋਟੋ ਲਈ <code>withheld_permit</code> ਹੈ ਜਿਸ ਨੂੰ ਡਰਾਈਵਰ ਨੇ ਸ਼ਾਮਲ ਨਾ ਕਰਨਾ ਚੁਣਿਆ), ਤਾਂ ਉਸ ਫੋਟੋ ਦੀ ਜਾਂਚ ਇਸ ਫ਼ਾਈਲ ਨਾਲ ਨਹੀਂ ਹੋ ਸਕਦੀ।",
        'h2_file': 'PDF ਦੀ ਥਾਂ ਸਬੂਤ ਫ਼ਾਈਲ ਵਰਤਣਾ',
        'p_file': 'ਸਬੂਤ ਫ਼ਾਈਲ ਵਿੱਚ ਹਰ ਕੜੀ ਦਾ ਪੇਲੋਡ ਅਤੇ ਹਸਤਾਖਰ ਵੀ base64 ਵਿੱਚ ਹੁੰਦੇ ਹਨ, ਇਸ ਲਈ ਤੁਸੀਂ PDF ਤੋਂ ਬਿਨਾਂ ਕਦਮ 1 ਤੋਂ 5 ਕਰ ਸਕਦੇ ਹੋ। ਫ਼ਾਈਲ ਵਿੱਚੋਂ ਕੜੀ 0 ਕੱਢੋ, ਫਿਰ ਉੱਪਰ ਵਾਂਗ ਕਦਮ 3 ਤੋਂ 5 ਚਲਾਓ:',
        'p_file_windows': 'PowerShell ਵਿੱਚ:',
        'pass_body': "<code>Verified OK</code>: ਪੇਲੋਡ ਬਿਲਕੁਲ ਉਹੀ ਹੈ ਜਿਸ 'ਤੇ ParkProof ਨੇ ਹਸਤਾਖਰ ਕੀਤੇ ਸਨ। ਇਸ ਵਿੱਚ ਦਿੱਤੇ ਵੇਰਵੇ ਅਤੇ ਫੋਟੋਆਂ ਦੇ ਫਿੰਗਰਪ੍ਰਿੰਟ, ਪੇਲੋਡ ਵਿੱਚ ਦਿੱਤੇ <code>signed_at</code> ਸਮੇਂ 'ਤੇ ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਨਹੀਂ ਬਦਲੇ। ਫੋਟੋਆਂ ਦੀ ਜਾਂਚ ਖੁਦ ਕਦਮ 6 ਤੋਂ 8 ਵਿੱਚ ਹੁੰਦੀ ਹੈ।",
        'fail_body': "<code>Verification failure</code>: ਪੇਲੋਡ ਜਾਂ ਹਸਤਾਖਰ ਉਹ ਨਹੀਂ ਹੈ ਜਿਸ 'ਤੇ ParkProof ਨੇ ਹਸਤਾਖਰ ਕੀਤੇ ਸਨ। ਹੋ ਸਕਦਾ ਹੈ ਰਿਕਾਰਡ ਬਦਲਿਆ ਗਿਆ ਹੋਵੇ, ਜਾਂ ਕੋਈ ਬਲਾਕ ਗਲਤ ਕਾਪੀ ਹੋਇਆ ਹੋਵੇ। ਨਤੀਜਾ ਕੱਢਣ ਤੋਂ ਪਹਿਲਾਂ base64 ਬਲਾਕ ਪੂਰੇ ਮੁੜ ਕਾਪੀ ਕਰੋ ਅਤੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।",
        'li_beyond_4': '<strong>ਕਾਰ ਕਿੱਥੇ ਸੀ, ਕਦੋਂ ਪਹੁੰਚੀ ਜਾਂ ਕਦੋਂ ਗਈ, ਜਾਂ ਡਰਾਈਵਰ ਕੌਣ ਸੀ।</strong> ਰਿਕਾਰਡ ਵਿਚਲੀ ਥਾਂ ਡਰਾਈਵਰ ਦੇ ਫ਼ੋਨ ਤੋਂ ਆਉਂਦੀ ਹੈ, ਜਾਂ ਡਰਾਈਵਰ ਨੇ ਉਸ ਨੂੰ ਖੁਦ ਦਰਜ ਕੀਤਾ ਹੈ। ਫ਼ੋਨ ਦੇ ਸਮੇਂ ਵਜੋਂ ਦਿਖਾਏ ਗਏ ਸਮੇਂ ਡਰਾਈਵਰ ਦੇ ਫ਼ੋਨ ਤੋਂ ਆਉਂਦੇ ਹਨ, ਅਤੇ ParkProof ਦੇ ਹਸਤਾਖਰ ਦਾ ਸਮਾਂ ਉਹ ਸਮਾਂ ਹੈ ਜਦੋਂ ParkProof ਨੂੰ ਹਰ ਹਿੱਸਾ ਮਿਲਿਆ।',
        'li_beyond_2': '<strong>ਕਿ ਫੋਟੋਆਂ ਉਹੀ ਦਿਖਾਉਂਦੀਆਂ ਹਨ ਜੋ ਉਹ ਵਿਅਕਤੀ ਕਹਿੰਦਾ ਹੈ।</strong> ਇੱਕ ਯੋਗ ਹਸਤਾਖਰ ਦਿਖਾਉਂਦਾ ਹੈ ਕਿ ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਫੋਟੋਆਂ ਦੇ ਫਿੰਗਰਪ੍ਰਿੰਟ ਨਹੀਂ ਬਦਲੇ, ਅਤੇ ਹੈਸ਼ ਮੁੜ ਕੱਢਣ ਨਾਲ ਪਤਾ ਲੱਗਦਾ ਹੈ ਕਿ ਕੋਈ ਫੋਟੋ ਆਪਣੇ ਫਿੰਗਰਪ੍ਰਿੰਟ ਨਾਲ ਮੇਲ ਖਾਂਦੀ ਹੈ ਜਾਂ ਨਹੀਂ। ਇਨ੍ਹਾਂ ਵਿੱਚੋਂ ਕੋਈ ਵੀ ਇਹ ਨਹੀਂ ਦਿਖਾਉਂਦਾ ਕਿ ਫੋਟੋਆਂ ਇਮਾਨਦਾਰੀ ਨਾਲ ਲਈਆਂ ਗਈਆਂ ਸਨ।',
        'meta_desc': 'ਇਹ ਜਾਂਚਣ ਲਈ ਕਦਮ-ਦਰ-ਕਦਮ openssl ਗਾਈਡ ਕਿ ParkProof ਸਬੂਤ ਰਿਕਾਰਡ ParkProof ਦੇ ਹਸਤਾਖਰ ਕਰਨ ਤੋਂ ਬਾਅਦ ਨਹੀਂ ਬਦਲਿਆ। AWS KMS ECDSA P-256 ਰਾਹੀਂ ਕ੍ਰਿਪਟੋਗ੍ਰਾਫਿਕ ਹਸਤਾਖਰ।',
        'p_why_1': '"ਸਬੂਤ" ਬਣਾਉਣ ਵਾਲੇ ਜ਼ਿਆਦਾਤਰ ਪਾਰਕਿੰਗ ਐਪ ਸਕ੍ਰੀਨਸ਼ਾਟ ਬਣਾਉਂਦੇ ਹਨ। ਸਕ੍ਰੀਨਸ਼ਾਟ ਨੂੰ ਲੈਣ ਅਤੇ ਭੇਜਣ ਦੇ ਵਿਚਕਾਰ ਕਿਸੇ ਵੀ ਸਮੇਂ ਸੰਪਾਦਿਤ ਕੀਤਾ ਜਾ ਸਕਦਾ ਹੈ। ਕ੍ਰਿਪਟੋਗ੍ਰਾਫਿਕ ਹਸਤਾਖਰ <em>"ਇਹ ਮੈਂ ਦੇਖਿਆ"</em> ਅਤੇ <em>"ਇਹ ਮੈਂ ਦੇਖਿਆ, ਅਤੇ ਕੋਈ ਵੀ ਜਾਂਚ ਸਕਦਾ ਹੈ ਕਿ ParkProof ਦੇ ਹਸਤਾਖਰ ਤੋਂ ਬਾਅਦ ਇਹ ਬਦਲਿਆ ਨਹੀਂ"</em> ਵਿਚਕਾਰ ਫਰਕ ਹੈ।',
        'p_why_2': "ਜਨਤਕ ਕੁੰਜੀ ਪ੍ਰਕਾਸ਼ਿਤ ਹੈ, ਤਾਂ ਜੋ ਜਾਂਚ ਪੂਰੀ ਤਰ੍ਹਾਂ ਔਫਲਾਈਨ ਹੋ ਸਕੇ। ਤੁਹਾਨੂੰ ParkProof 'ਤੇ ਭਰੋਸਾ ਕਰਨ, ਸਾਡੇ ਸਰਵਰ ਨਾਲ ਸੰਪਰਕ ਕਰਨ ਜਾਂ ਸਾਡੀ ਐਪ ਚਲਾਉਣ ਦੀ ਲੋੜ ਨਹੀਂ। ParkProof ਬੰਦ ਹੋ ਜਾਣ 'ਤੇ ਵੀ, ਜਦੋਂ ਤੱਕ <code>openssl</code> ਮੌਜੂਦ ਹੈ, ਜਾਂਚ ਕਈ ਸਾਲਾਂ ਬਾਅਦ ਵੀ ਕੀਤੀ ਜਾ ਸਕਦੀ ਹੈ।",
    },
}


def render_locale_switcher(current_locale, asset_prefix):
    """
    Inline list of native language names. Current locale is bold + dark;
    others are brand-blue links. Each link points at /verify/{locale}/
    (or /verify/ for English).
    """
    items = []
    for loc in LOCALES:
        native = NATIVE_NAMES[loc]
        url = '/verify/' if loc == 'en' else f'/verify/{loc}/'
        if loc == current_locale:
            items.append(f'<span class="active">{native}</span>')
        else:
            items.append(f'<a href="{url}" hreflang="{loc}">{native}</a>')
    inner = ' <span class="sep">·</span> '.join(items)
    return f'<nav class="locale-switcher" aria-label="Language"><span class="marker">🌏</span> {inner}</nav>'


TEMPLATE = '''<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{page_title}</title>
<meta name="description" content="{meta_desc}">
<meta name="robots" content="index, follow">
<link rel="icon" href="{asset_prefix}parkproof-icon.svg" type="image/svg+xml">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700;9..144,800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

<style>
  :root {{
    --brand-50:  #EAEFFF;
    --brand-100: #CDD9FF;
    --brand-500: #275BFF;
    --brand-700: #173EB3;
    --ink-500:   #5C6680;
    --ink-700:   #2D374F;
    --ink-900:   #1A2233;
    --paper-100: #F2F4F7;
    --paper-300: #DDE4EE;
    --sage:      #C8DCCF;
    --emerald:   #10B981;
    --red:       #EF4444;
    --font-display: 'Fraunces', Georgia, serif;
    --font-sans:    'Inter', system-ui, sans-serif;
    --font-mono:    'JetBrains Mono', ui-monospace, 'Cascadia Code', monospace;
  }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  html {{ -webkit-text-size-adjust: 100%; }}
  body {{
    font-family: var(--font-sans);
    color: var(--ink-900);
    background: var(--sage);
    font-size: 16px;
    line-height: 1.55;
    min-height: 100vh;
  }}
  .wrap {{
    max-width: 760px;
    margin: 0 auto;
    padding: 32px 24px 80px;
  }}
  nav.top {{
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 18px;
  }}
  nav.top img {{ width: 32px; height: 32px; border-radius: 8px; }}
  nav.top a.brand {{
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 18px;
    color: var(--ink-900);
    text-decoration: none;
    letter-spacing: -0.01em;
  }}
  nav.top .sep {{ color: var(--ink-500); font-size: 14px; }}
  nav.top a.back {{
    color: var(--brand-500);
    text-decoration: none;
    font-size: 13px;
    font-weight: 600;
  }}
  nav.top a.back:hover {{ text-decoration: underline; }}

  nav.locale-switcher {{
    margin-bottom: 40px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--paper-300);
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    font-size: 13px;
    color: var(--ink-500);
    align-items: center;
  }}
  nav.locale-switcher .marker {{ color: var(--brand-500); margin-right: 6px; }}
  nav.locale-switcher .sep {{ color: var(--paper-300); }}
  nav.locale-switcher a {{
    color: var(--brand-700);
    text-decoration: none;
    padding: 2px 0;
  }}
  nav.locale-switcher a:hover {{ text-decoration: underline; }}
  nav.locale-switcher .active {{
    font-weight: 700;
    color: var(--ink-900);
  }}

  .eyebrow {{
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 12px;
    font-weight: 600;
    color: var(--brand-500);
    margin-bottom: 14px;
  }}
  h1 {{
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(34px, 5vw, 48px);
    line-height: 1.1;
    letter-spacing: -0.02em;
    margin-bottom: 20px;
    color: var(--ink-900);
  }}
  h1 .accent {{ color: var(--brand-500); font-style: italic; }}
  .lede {{
    font-size: clamp(17px, 1.8vw, 19px);
    line-height: 1.55;
    color: var(--ink-700);
    margin-bottom: 36px;
    max-width: 620px;
  }}

  h2 {{
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(22px, 2.8vw, 26px);
    color: var(--ink-900);
    margin-top: 48px;
    margin-bottom: 14px;
    letter-spacing: -0.01em;
  }}
  h3 {{
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 18px;
    color: var(--ink-900);
    margin-top: 28px;
    margin-bottom: 10px;
  }}
  p {{ margin-bottom: 14px; color: var(--ink-700); }}
  p.small {{ font-size: 14px; color: var(--ink-500); }}

  ol, ul {{ padding-left: 22px; margin-bottom: 18px; }}
  li {{ margin-bottom: 10px; color: var(--ink-700); }}
  li code {{ font-size: 0.92em; }}

  code {{
    font-family: var(--font-mono);
    font-size: 0.9em;
    background: var(--brand-50);
    color: var(--ink-900);
    padding: 1px 6px;
    border-radius: 4px;
  }}

  pre {{
    background: var(--ink-900);
    color: #E5E8EE;
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    padding: 18px 20px;
    border-radius: 12px;
    overflow-x: auto;
    margin: 18px 0 24px;
    -webkit-overflow-scrolling: touch;
  }}
  pre code {{
    background: transparent;
    color: inherit;
    padding: 0;
    font-size: inherit;
  }}
  pre .comment {{ color: #5C6680; }}

  .callout {{
    background: white;
    border: 1px solid var(--paper-300);
    border-left: 3px solid var(--brand-500);
    border-radius: 10px;
    padding: 14px 18px;
    margin: 20px 0;
    font-size: 14px;
    color: var(--ink-700);
  }}
  .callout strong {{ color: var(--ink-900); }}

  .grid-2 {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin: 18px 0 28px;
  }}
  .grid-2 .card {{
    background: white;
    border: 1px solid var(--paper-300);
    border-radius: 12px;
    padding: 16px 18px;
  }}
  .grid-2 .card h3 {{
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 15px;
    margin-bottom: 6px;
    color: var(--ink-900);
  }}
  .grid-2 .card h3 .label {{ font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 99px; vertical-align: middle; margin-left: 8px; letter-spacing: 0.04em; }}
  .grid-2 .card.ok h3 .label {{ background: #D1FADF; color: #047857; }}
  .grid-2 .card.fail h3 .label {{ background: #FEE2E2; color: #B91C1C; }}
  .grid-2 .card p {{ font-size: 13px; margin: 0; color: var(--ink-700); }}

  @media (max-width: 560px) {{
    .grid-2 {{ grid-template-columns: 1fr; }}
    pre {{ font-size: 12px; padding: 14px 14px; }}
  }}

  a.link {{
    color: var(--brand-700);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 2px;
  }}
  a.link:hover {{ color: var(--brand-500); }}

  footer {{
    margin-top: 64px;
    padding-top: 24px;
    border-top: 1px solid var(--paper-300);
    font-size: 13px;
    color: var(--ink-500);
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 10px;
  }}
  footer a {{ color: var(--brand-700); text-decoration: none; }}
  footer a:hover {{ text-decoration: underline; }}

  /* Auto-detect chip. Mirrors the landing's pp-locale-chip pattern.
     Shown only when the visitor's browser language is supported AND
     different from the current page's language. Dismissable per
     session via sessionStorage. */
  .pp-verify-chip {{
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 100;
    display: none;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: var(--brand-500);
    color: #fff;
    border-radius: 999px;
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
    box-shadow: 0 4px 16px rgba(39, 91, 255, 0.32);
    max-width: calc(100vw - 32px);
  }}
  .pp-verify-chip:hover {{ transform: translateY(-1px); box-shadow: 0 6px 20px rgba(39, 91, 255, 0.4); }}
  .pp-verify-chip[data-show="1"] {{ display: inline-flex; }}
  .pp-verify-chip .close {{
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 50%;
    background: rgba(255, 255, 255, 0.18); color: #fff;
    font-size: 14px; line-height: 1; margin-left: 4px;
  }}
  .pp-verify-chip .close:hover {{ background: rgba(255, 255, 255, 0.28); }}
  @media (max-width: 480px) {{
    .pp-verify-chip {{ top: 12px; right: 12px; font-size: 12px; padding: 8px 12px; }}
  }}
</style>
</head>
<body>

<div class="wrap">
  <nav class="top">
    <img src="{asset_prefix}parkproof-icon.svg" alt="">
    <a href="/" class="brand">ParkProof</a>
    <span class="sep">·</span>
    <a href="/" class="back">{back_link}</a>
  </nav>

  {locale_switcher}

  <div class="eyebrow">{eyebrow}</div>
  <h1>{h1_main} <span class="accent">{h1_accent}</span>{h1_period}</h1>
  <p class="lede">{lede}</p>

  <div class="callout">
    <strong>{callout_label}</strong> {callout_body}
  </div>

  <h2>{h2_verifying}</h2>
  <p>{p_verifying_1}</p>
  <p>{p_verifying_2}</p>

  <h2>{h2_need}</h2>
  <ul>
    <li>{li_need_1}</li>
    <li>{li_need_2}</li>
    <li>{li_need_3}</li>
  </ul>

  <h2>{h2_steps}</h2>

  <p>{p_steps}</p>

  <pre><span class="comment"># {c_step_1}</span>
base64 -d link0-payload.b64 > link0-payload.txt

<span class="comment"># {c_step_2}</span>
base64 -d link0-sig.b64 > link0-sig.bin

<span class="comment"># {c_step_3}</span>
curl -O https://www.parkproof.com.au/parkproof-public-key.pem

<span class="comment"># {c_step_4}</span>
openssl dgst -sha256 -verify parkproof-public-key.pem \\
  -signature link0-sig.bin link0-payload.txt</pre>

  <p>{p_repeat}</p>

  <h3>{h3_windows}</h3>
  <p>{p_windows}</p>

  <pre>certutil -decode link0-payload.b64 link0-payload.txt
certutil -decode link0-sig.b64 link0-sig.bin
curl.exe -O https://www.parkproof.com.au/parkproof-public-key.pem</pre>

  <h2>{h2_chain}</h2>
  <p>{p_chain}</p>

  <pre><span class="comment"># {c_chain_1}</span>
openssl dgst -sha256 link0-payload.txt
<span class="comment"># {c_chain_2}
# {c_chain_3}</span></pre>

  <p>{p_chain_fork}</p>

  <h2>{h2_photos}</h2>
  <p>{p_photos}</p>

  <pre><span class="comment"># {c_photo_1}</span>
jq -r '.photos[0].bytes_base64' evidence.json | base64 -d > photo1.jpg

<span class="comment"># {c_photo_2}</span>
openssl dgst -sha256 photo1.jpg

<span class="comment"># {c_photo_3}</span>
jq '.photos[0].signed_in' evidence.json</pre>

  <p>{p_photo_match}</p>
  <p>{p_photo_nojq}</p>

  <h3>{h3_windows}</h3>
  <p>{p_photo_windows}</p>

  <pre>$e = Get-Content evidence.json -Raw | ConvertFrom-Json
[IO.File]::WriteAllBytes((Join-Path $PWD 'photo1.jpg'), [Convert]::FromBase64String($e.photos[0].bytes_base64))
certutil -hashfile photo1.jpg SHA256
$e.photos[0].signed_in</pre>

  <div class="callout">
    <strong>{callout_photo_label}</strong> {callout_photo_body}
  </div>

  <h2>{h2_file}</h2>
  <p>{p_file}</p>

  <pre>jq -r '.links[0].canonical_payload_base64' evidence.json | base64 -d > link0-payload.txt
jq -r '.links[0].signature_base64' evidence.json | base64 -d > link0-sig.bin</pre>

  <p>{p_file_windows}</p>

  <pre>$e = Get-Content evidence.json -Raw | ConvertFrom-Json
[IO.File]::WriteAllBytes((Join-Path $PWD 'link0-payload.txt'), [Convert]::FromBase64String($e.links[0].canonical_payload_base64))
[IO.File]::WriteAllBytes((Join-Path $PWD 'link0-sig.bin'), [Convert]::FromBase64String($e.links[0].signature_base64))</pre>

  <h2>{h2_result}</h2>

  <div class="grid-2">
    <div class="card ok">
      <h3>{pass_title} <span class="label">{pass_label}</span></h3>
      <p>{pass_body}</p>
    </div>
    <div class="card fail">
      <h3>{fail_title} <span class="label">{fail_label}</span></h3>
      <p>{fail_body}</p>
    </div>
  </div>

  <h2>{h2_beyond}</h2>
  <p>{p_beyond}</p>
  <ul>
    <li>{li_beyond_1}</li>
    <li>{li_beyond_2}</li>
    <li>{li_beyond_3}</li>
    <li>{li_beyond_4}</li>
  </ul>

  <h2>{h2_why}</h2>
  <p>{p_why_1}</p>
  <p>{p_why_2}</p>

  <h2>{h2_questions}</h2>
  <p>{p_questions}</p>

  <footer>
    <span>{footer_left}</span>
    <span><a href="/parkproof-public-key.pem">/parkproof-public-key.pem</a> <span class="sep">·</span> <a href="/">{back_link}</a></span>
  </footer>
</div>

<!-- Auto-detect chip: nudges visitors whose browser language differs
     from the current page's language to their language's /verify/
     subdirectory. The locale switcher at top remains for explicit
     switching; this chip is the one-tap discoverability layer. -->
<a id="pp-verify-chip" class="pp-verify-chip" href="#" hreflang="auto">
  <span id="pp-verify-chip-text">Continue in your language →</span>
  <span class="close" role="button" aria-label="Dismiss">×</span>
</a>
<script>
  (function() {{
    // Map of supported locales to (chip text, URL). Chip text is in the
    // TARGET language so a Korean speaker sees Korean prompt etc.
    var TARGETS = {{
      'en':    {{ url: '/verify/',         text: 'View in English →' }},
      'zh-cn': {{ url: '/verify/zh-CN/',   text: '查看简体中文版 →' }},
      'vi':    {{ url: '/verify/vi/',      text: 'Xem bằng tiếng Việt →' }},
      'id':    {{ url: '/verify/id/',      text: 'Lihat dalam Bahasa Indonesia →' }},
      'ko':    {{ url: '/verify/ko/',      text: '한국어로 보기 →' }},
      'it':    {{ url: '/verify/it/',      text: 'Visualizza in italiano →' }},
      'el':    {{ url: '/verify/el/',      text: 'Δες στα ελληνικά →' }},
      'hi':    {{ url: '/verify/hi/',      text: 'हिन्दी में देखें →' }},
      'pa':    {{ url: '/verify/pa/',      text: 'ਪੰਜਾਬੀ ਵਿੱਚ ਵੇਖੋ →' }}
    }};

    var current = (document.documentElement.lang || 'en').toLowerCase();

    function pickTarget() {{
      var langs = (Array.isArray(navigator.languages) && navigator.languages.length)
        ? navigator.languages : [navigator.language || 'en'];
      for (var i = 0; i < langs.length; i++) {{
        var raw = String(langs[i] || '').toLowerCase();
        if (raw === current) return null;  // already on user's language
        if (TARGETS[raw]) return raw;
        var primary = raw.split('-')[0];
        if (primary === current) return null;
        if (TARGETS[primary]) return primary;
      }}
      return null;
    }}

    var chip = document.getElementById('pp-verify-chip');
    var text = document.getElementById('pp-verify-chip-text');
    if (!chip || !text) return;

    try {{ if (sessionStorage.getItem('pp-verify-chip-dismissed') === '1') return; }} catch(e) {{}}

    var target = pickTarget();
    if (!target) return;

    chip.href = TARGETS[target].url;
    text.textContent = TARGETS[target].text;
    chip.setAttribute('data-show', '1');

    chip.querySelector('.close').addEventListener('click', function(ev) {{
      ev.preventDefault();
      ev.stopPropagation();
      chip.removeAttribute('data-show');
      try {{ sessionStorage.setItem('pp-verify-chip-dismissed', '1'); }} catch(e) {{}}
    }});
  }})();
</script>

</body>
</html>
'''


EM_DASH = '\u2014'
REPLACEMENT_CHAR = '\ufffd'


def strings_for(locale):
    """A locale's strings: TRANSLATIONS with STEPS merged over it (no key in both)."""
    base, steps = TRANSLATIONS[locale], STEPS[locale]
    both = sorted(set(base) & set(steps))
    if both:
        raise SystemExit(f'{locale}: keys in both TRANSLATIONS and STEPS: {both}')
    return {**base, **steps}


def tags_of(value):
    """The HTML tags in a string, as a sorted list (attributes kept, so links must match too)."""
    return sorted(re.findall(r'</?[a-zA-Z][^>]*>', value))


def check_strings():
    """Every locale has exactly en's keys and en's tags per key; no em-dash, no replacement character."""
    problems = []
    en = strings_for('en')
    for locale in LOCALES:
        t = strings_for(locale)
        for k in sorted(set(en) - set(t)):
            problems.append(f'{locale}: missing {k}')
        for k in sorted(set(t) - set(en)):
            problems.append(f'{locale}: extra {k}')
        for k, v in t.items():
            if EM_DASH in v:
                problems.append(f'{locale}: em-dash in {k}')
            if REPLACEMENT_CHAR in v:
                problems.append(f'{locale}: replacement character in {k}')
            if k in en and tags_of(v) != tags_of(en[k]):
                problems.append(f'{locale}: HTML tags differ from en in {k}')
    if problems:
        raise SystemExit('ABORT (nothing written):\n  ' + '\n  '.join(problems))


def out_path_for(locale):
    out_dir = VERIFY_DIR if locale == 'en' else VERIFY_DIR / locale
    return out_dir / 'index.html'


def render(locale):
    """One locale's page, as the text written to disk."""
    # English's assets are 1 level up (verify/index.html -> ../assets/),
    # other locales are 2 levels up (verify/ko/index.html -> ../../assets/).
    asset_prefix = '../assets/' if locale == 'en' else '../../assets/'
    page = TEMPLATE.format(
        lang=locale,
        asset_prefix=asset_prefix,
        locale_switcher=render_locale_switcher(locale, asset_prefix),
        **strings_for(locale),
    )
    if EM_DASH in page:
        raise SystemExit(f'{locale}: the rendered page has an em-dash')
    return page


def main(argv):
    check_strings()
    if '--check' in argv:
        stale = []
        for locale in LOCALES:
            path = out_path_for(locale)
            on_disk = path.read_text(encoding='utf-8') if path.exists() else None
            if on_disk != render(locale):
                stale.append(path.relative_to(ROOT).as_posix())
        if stale:
            print('out of date (run python scripts/_build_verify_pages.py):')
            for name in stale:
                print(f'  {name}')
            return 1
        print(f'all {len(LOCALES)} verify pages match')
        return 0
    for locale in LOCALES:
        path = out_path_for(locale)
        path.parent.mkdir(parents=True, exist_ok=True)
        # newline='\n': the same bytes on every platform.
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            f.write(render(locale))
        print(f'wrote {path.relative_to(ROOT).as_posix()}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
