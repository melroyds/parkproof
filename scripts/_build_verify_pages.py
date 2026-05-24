#!/usr/bin/env python3
"""
_build_verify_pages.py — generate the 9 localised /verify pages.

Re-run after editing TRANSLATIONS or TEMPLATE. Output goes to
migrations/two-app-architecture/landing-from-claude-design/verify/
(English at the root /verify/index.html, other locales at
/verify/{locale}/index.html so the URLs match the i18n locale codes
used elsewhere in the app).

Each generated page carries a locale switcher at the top — clicking
a native-language name jumps to that locale's version.

Translations are conservative / formal in register, matching the
existing privacy policy. Native-speaker review recommended before
any high-stakes use.
"""
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

# Translation dict — each locale has ~30 text strings.
# Keys are stable; values get string-formatted into TEMPLATE.
TRANSLATIONS = {
    'en': {
        'page_title': 'Verify a ParkProof evidence record — ParkProof',
        'meta_desc': "Step-by-step openssl walkthrough for verifying that a ParkProof evidence PDF hasn't been altered since it was saved. Cryptographic signing via AWS KMS ECDSA P-256.",
        'back_link': '← Back to ParkProof',
        'eyebrow': 'Verification',
        'h1_main': 'Verify a ParkProof',
        'h1_accent': 'evidence record',
        'h1_period': '.',
        'lede': 'Every ParkProof evidence PDF carries a cryptographic signature appendix. This page is the public, offline walkthrough for anyone — a council officer, an insurer, a court clerk, or the driver themselves — to confirm that the record hasn\'t been altered since the moment it was saved.',
        'callout_label': 'Honest framing.',
        'callout_body': 'The signature proves <em>integrity</em>: the bytes inside this record are identical to the bytes signed at scan time. It does not prove the record\'s <em>truthfulness</em> (the AI could have read the sign incorrectly), nor does it determine the legal weight of the evidence. That\'s a separate judgement made by whoever\'s reviewing it.',
        'h2_verifying': "What you're verifying",
        'p_verifying_1': 'Each ParkProof session has a <strong>payload</strong> (a small text file containing the canonical session metadata plus SHA-256 hashes of the sign + car photos) and a <strong>signature</strong> (the payload signed with an AWS KMS-managed ECDSA P-256 private key that never leaves AWS). Both are printed in the signature appendix of every exported evidence PDF.',
        'p_verifying_2': 'The <strong>public key</strong> needed to verify the signature is published at <a class="link" href="/parkproof-public-key.pem"><code>/parkproof-public-key.pem</code></a> — open it in a browser to confirm it loads, then save it locally.',
        'h2_need': "What you'll need",
        'li_need_1': '<strong>The evidence PDF</strong> — supplied by the person disputing or producing the record.',
        'li_need_2': '<strong><code>openssl</code></strong> — bundled with macOS and most Linux distros; on Windows, available via Git Bash, WSL, or the standalone OpenSSL build.',
        'li_need_3': '<strong>About 60 seconds.</strong>',
        'h2_steps': 'Step-by-step',
        'p_steps': 'Open the evidence PDF, scroll to the <strong>"Signature appendix"</strong> page at the back. You\'ll see three blocks of text: <code>payload</code>, <code>sig.base64</code>, and a reference to the public key URL. Save the first two to files on your machine, then run the verification:',
        'c_step_1': '1. Save the payload block from the PDF appendix to payload.txt',
        'c_step_1b': '   (copy-paste exactly; preserve line endings).',
        'c_step_2': '2. Save the base64 signature block to sig.base64.',
        'c_step_3': '3. Fetch the public key.',
        'c_step_4': '4. Decode the base64 signature to raw bytes.',
        'c_step_5': '5. Run the verification.',
        'h2_result': 'What the result means',
        'pass_title': 'Verified',
        'pass_label': 'PASS',
        'pass_body': '<code>Verified OK</code> — the payload in your PDF is byte-identical to what ParkProof signed at scan time. The sign rules, GPS, timestamp, address, and photo hashes have not been altered since.',
        'fail_title': 'Failure',
        'fail_label': 'FAIL',
        'fail_body': '<code>Verification failure</code> — the payload, the signature, or both have been modified since the record was saved. The PDF may have been edited, the appendix tampered with, or copy-paste introduced whitespace differences. Repeat the copy carefully before drawing conclusions.',
        'h2_beyond': 'Beyond "did the bytes change?"',
        'p_beyond': 'A successful verification confirms <em>integrity</em>. It does not confirm:',
        'li_beyond_1': '<strong>That the AI read the sign correctly.</strong> The ParkProof scan is a machine read of a parking sign, and machines can be wrong. The verdict text and rules in the record are the AI\'s best read at scan time, not ground truth.',
        'li_beyond_2': '<strong>That the photos depict what the person says they depict.</strong> The signature proves the photos haven\'t been altered <em>since saving</em>, not that the photos themselves were honestly captured.',
        'li_beyond_3': '<strong>Any legal outcome.</strong> Whether the evidence supports an appeal, a refund, or a court case is the reviewer\'s call. ParkProof is a tool, not a lawyer.',
        'h2_why': 'Why this exists',
        'p_why_1': 'Most parking apps that produce "evidence" produce a screenshot. Screenshots have no integrity story — they could have been edited at any point between when they were taken and when they were sent. The cryptographic signature is the difference between <em>"here\'s what I saw"</em> and <em>"here\'s what I saw, and here\'s mathematical proof I haven\'t changed it since."</em>',
        'p_why_2': 'The public key is published so the verification is fully offline — you do not need to trust ParkProof, contact our servers, or run our app to confirm the integrity claim. The verification can be performed years from now even if ParkProof is no longer maintained, as long as <code>openssl</code> still exists.',
        'h2_questions': 'Questions?',
        'p_questions': 'Email <a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>. We answer.',
        'footer_left': 'parkproof.com.au · verification page',
    },
    'zh-CN': {
        'page_title': '验证 ParkProof 证据记录 — ParkProof',
        'meta_desc': '使用 openssl 一步步验证 ParkProof 证据 PDF 自保存以来未被篡改。基于 AWS KMS ECDSA P-256 的密码学签名。',
        'back_link': '← 返回 ParkProof',
        'eyebrow': '验证',
        'h1_main': '验证一份 ParkProof',
        'h1_accent': '证据记录',
        'h1_period': '。',
        'lede': '每份 ParkProof 证据 PDF 都带有密码学签名附录。本页面是公开的离线指南,供任何人 — 市政官员、保险公司、法院书记员或司机本人 — 确认该记录自保存的那一刻起未被篡改。',
        'callout_label': '诚实表态。',
        'callout_body': '签名证明的是<em>完整性</em>:该记录中的字节与扫描时签名的字节完全一致。它不证明记录的<em>真实性</em>(AI 可能读错了路牌),也不决定证据的法律效力。那是审阅者的独立判断。',
        'h2_verifying': '你在验证什么',
        'p_verifying_1': '每个 ParkProof 会话包含一个<strong>载荷</strong>(一个小文本文件,含规范的会话元数据以及路牌+车辆照片的 SHA-256 哈希)和一个<strong>签名</strong>(用 AWS KMS 管理的 ECDSA P-256 私钥对载荷签名,该私钥永远不会离开 AWS)。两者都打印在每份导出的证据 PDF 的签名附录中。',
        'p_verifying_2': '验证签名所需的<strong>公钥</strong>发布在 <a class="link" href="/parkproof-public-key.pem"><code>/parkproof-public-key.pem</code></a> — 在浏览器中打开以确认加载,然后保存到本地。',
        'h2_need': '你需要的',
        'li_need_1': '<strong>证据 PDF</strong> — 由争议或提交该记录的人提供。',
        'li_need_2': '<strong><code>openssl</code></strong> — macOS 和大多数 Linux 发行版自带;Windows 上可通过 Git Bash、WSL 或独立的 OpenSSL 构建获取。',
        'li_need_3': '<strong>约 60 秒。</strong>',
        'h2_steps': '一步一步',
        'p_steps': '打开证据 PDF,滚动到末尾的<strong>"签名附录"</strong>页面。你会看到三块文本:<code>payload</code>、<code>sig.base64</code> 以及对公钥 URL 的引用。把前两块保存到本地文件,然后运行验证:',
        'c_step_1': '1. 把 PDF 附录中的载荷块保存到 payload.txt',
        'c_step_1b': '   (精确复制粘贴;保留行尾)。',
        'c_step_2': '2. 把 base64 签名块保存到 sig.base64。',
        'c_step_3': '3. 获取公钥。',
        'c_step_4': '4. 将 base64 签名解码为原始字节。',
        'c_step_5': '5. 运行验证。',
        'h2_result': '结果意味着什么',
        'pass_title': '已验证',
        'pass_label': '通过',
        'pass_body': '<code>Verified OK</code> — 你 PDF 中的载荷与 ParkProof 扫描时签名的字节完全一致。路牌规则、GPS、时间戳、地址和照片哈希自那时起未被更改。',
        'fail_title': '失败',
        'fail_label': '不通过',
        'fail_body': '<code>Verification failure</code> — 载荷、签名或两者自记录保存以来已被修改。PDF 可能被编辑、附录被篡改,或复制粘贴引入了空白差异。在得出结论之前,请仔细重复复制操作。',
        'h2_beyond': '不止"字节是否改变?"',
        'p_beyond': '验证成功只确认<em>完整性</em>。它不确认:',
        'li_beyond_1': '<strong>AI 是否正确读取了路牌。</strong>ParkProof 扫描是机器对停车标志的读取,机器可能出错。记录中的判定文本和规则是 AI 在扫描时的最佳读取,而非绝对真相。',
        'li_beyond_2': '<strong>照片是否如其所述。</strong>签名证明照片<em>自保存以来</em>未被更改,而非照片本身是诚实拍摄的。',
        'li_beyond_3': '<strong>任何法律结果。</strong>证据是否支持申诉、退款或诉讼,是审阅者的判断。ParkProof 是一个工具,不是律师。',
        'h2_why': '为什么存在',
        'p_why_1': '大多数生成"证据"的停车应用只产出截图。截图没有完整性的故事 — 它们可能在拍摄到发送之间的任何时刻被编辑。密码学签名是<em>"这是我看到的"</em>和<em>"这是我看到的,这是数学证明我此后没有改变它"</em>之间的差别。',
        'p_why_2': '公钥已发布,因此验证完全离线 — 你不需要信任 ParkProof、联系我们的服务器或运行我们的应用来确认完整性声明。即使 ParkProof 多年后不再维护,只要 <code>openssl</code> 仍然存在,验证就可以进行。',
        'h2_questions': '有疑问?',
        'p_questions': '发邮件到 <a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>。我们会回复。',
        'footer_left': 'parkproof.com.au · 验证页面',
    },
    'vi': {
        'page_title': 'Xác minh bản ghi bằng chứng ParkProof — ParkProof',
        'meta_desc': 'Hướng dẫn từng bước bằng openssl để xác minh PDF bằng chứng ParkProof không bị thay đổi từ khi lưu. Ký mật mã qua AWS KMS ECDSA P-256.',
        'back_link': '← Quay lại ParkProof',
        'eyebrow': 'Xác minh',
        'h1_main': 'Xác minh một',
        'h1_accent': 'bản ghi bằng chứng',
        'h1_period': ' ParkProof.',
        'lede': 'Mỗi PDF bằng chứng ParkProof mang một phụ lục chữ ký mật mã. Trang này là hướng dẫn công khai, ngoại tuyến cho bất kỳ ai — viên chức hội đồng, công ty bảo hiểm, thư ký toà án, hoặc chính người lái xe — để xác nhận rằng bản ghi không bị thay đổi từ thời khắc nó được lưu.',
        'callout_label': 'Khung trung thực.',
        'callout_body': 'Chữ ký chứng minh <em>tính toàn vẹn</em>: các byte bên trong bản ghi này giống hệt với các byte được ký vào thời điểm quét. Nó không chứng minh <em>tính xác thực</em> của bản ghi (AI có thể đọc sai biển báo), cũng không quyết định trọng lượng pháp lý của bằng chứng. Đó là một phán đoán riêng của người xem xét.',
        'h2_verifying': 'Bạn đang xác minh điều gì',
        'p_verifying_1': 'Mỗi phiên ParkProof có một <strong>payload</strong> (một tệp văn bản nhỏ chứa siêu dữ liệu chính tắc của phiên cộng với hash SHA-256 của các ảnh biển báo + xe) và một <strong>chữ ký</strong> (payload được ký bằng khoá riêng tư ECDSA P-256 do AWS KMS quản lý, không bao giờ rời khỏi AWS). Cả hai được in trong phụ lục chữ ký của mỗi PDF bằng chứng xuất ra.',
        'p_verifying_2': '<strong>Khoá công khai</strong> cần để xác minh chữ ký được xuất bản tại <a class="link" href="/parkproof-public-key.pem"><code>/parkproof-public-key.pem</code></a> — mở trong trình duyệt để xác nhận tải được, rồi lưu cục bộ.',
        'h2_need': 'Bạn cần',
        'li_need_1': '<strong>PDF bằng chứng</strong> — do người tranh chấp hoặc cung cấp bản ghi đưa cho bạn.',
        'li_need_2': '<strong><code>openssl</code></strong> — đi kèm với macOS và hầu hết các bản phân phối Linux; trên Windows, có sẵn qua Git Bash, WSL, hoặc bản OpenSSL độc lập.',
        'li_need_3': '<strong>Khoảng 60 giây.</strong>',
        'h2_steps': 'Từng bước',
        'p_steps': 'Mở PDF bằng chứng, cuộn đến trang <strong>"Phụ lục chữ ký"</strong> ở cuối. Bạn sẽ thấy ba khối văn bản: <code>payload</code>, <code>sig.base64</code>, và tham chiếu đến URL khoá công khai. Lưu hai khối đầu vào tệp trên máy của bạn, sau đó chạy lệnh xác minh:',
        'c_step_1': '1. Lưu khối payload từ phụ lục PDF vào payload.txt',
        'c_step_1b': '   (copy-paste chính xác; giữ nguyên kết thúc dòng).',
        'c_step_2': '2. Lưu khối chữ ký base64 vào sig.base64.',
        'c_step_3': '3. Lấy khoá công khai.',
        'c_step_4': '4. Giải mã chữ ký base64 thành byte thô.',
        'c_step_5': '5. Chạy xác minh.',
        'h2_result': 'Kết quả có nghĩa là gì',
        'pass_title': 'Đã xác minh',
        'pass_label': 'ĐẠT',
        'pass_body': '<code>Verified OK</code> — payload trong PDF của bạn giống hệt theo từng byte với những gì ParkProof đã ký vào thời điểm quét. Các quy tắc biển báo, GPS, timestamp, địa chỉ và hash ảnh chưa bị thay đổi kể từ đó.',
        'fail_title': 'Thất bại',
        'fail_label': 'KHÔNG ĐẠT',
        'fail_body': '<code>Verification failure</code> — payload, chữ ký, hoặc cả hai đã bị thay đổi kể từ khi bản ghi được lưu. PDF có thể đã được chỉnh sửa, phụ lục bị giả mạo, hoặc copy-paste tạo ra khác biệt khoảng trắng. Lặp lại việc sao chép cẩn thận trước khi rút ra kết luận.',
        'h2_beyond': 'Hơn cả "các byte có thay đổi không?"',
        'p_beyond': 'Một lần xác minh thành công xác nhận <em>tính toàn vẹn</em>. Nó không xác nhận:',
        'li_beyond_1': '<strong>Rằng AI đọc biển báo đúng.</strong> Quét ParkProof là một lần đọc máy của biển báo đỗ xe, và máy có thể sai. Văn bản phán quyết và các quy tắc trong bản ghi là cách đọc tốt nhất của AI tại thời điểm quét, không phải sự thật tuyệt đối.',
        'li_beyond_2': '<strong>Rằng các ảnh mô tả những gì người đó nói chúng mô tả.</strong> Chữ ký chứng minh các ảnh chưa bị thay đổi <em>kể từ khi lưu</em>, không phải rằng bản thân các ảnh được chụp một cách trung thực.',
        'li_beyond_3': '<strong>Bất kỳ kết quả pháp lý nào.</strong> Liệu bằng chứng có hỗ trợ kháng cáo, hoàn tiền, hoặc vụ kiện hay không là quyết định của người xem xét. ParkProof là một công cụ, không phải luật sư.',
        'h2_why': 'Vì sao nó tồn tại',
        'p_why_1': 'Hầu hết các ứng dụng đỗ xe tạo ra "bằng chứng" chỉ tạo ra ảnh chụp màn hình. Ảnh chụp màn hình không có câu chuyện toàn vẹn — chúng có thể được chỉnh sửa tại bất kỳ thời điểm nào giữa lúc chụp và lúc gửi. Chữ ký mật mã là sự khác biệt giữa <em>"đây là những gì tôi đã thấy"</em> và <em>"đây là những gì tôi đã thấy, và đây là bằng chứng toán học rằng tôi chưa thay đổi nó kể từ đó."</em>',
        'p_why_2': 'Khoá công khai được xuất bản để việc xác minh hoàn toàn ngoại tuyến — bạn không cần tin tưởng ParkProof, liên hệ máy chủ của chúng tôi, hoặc chạy ứng dụng của chúng tôi để xác nhận tuyên bố về tính toàn vẹn. Việc xác minh có thể thực hiện sau nhiều năm ngay cả khi ParkProof không còn được duy trì, miễn là <code>openssl</code> vẫn tồn tại.',
        'h2_questions': 'Câu hỏi?',
        'p_questions': 'Email <a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>. Chúng tôi trả lời.',
        'footer_left': 'parkproof.com.au · trang xác minh',
    },
    'id': {
        'page_title': 'Verifikasi catatan bukti ParkProof — ParkProof',
        'meta_desc': 'Panduan langkah demi langkah openssl untuk memverifikasi PDF bukti ParkProof tidak diubah sejak disimpan. Penandatanganan kriptografis melalui AWS KMS ECDSA P-256.',
        'back_link': '← Kembali ke ParkProof',
        'eyebrow': 'Verifikasi',
        'h1_main': 'Verifikasi sebuah',
        'h1_accent': 'catatan bukti',
        'h1_period': ' ParkProof.',
        'lede': 'Setiap PDF bukti ParkProof membawa lampiran tanda tangan kriptografis. Halaman ini adalah panduan publik, offline untuk siapa saja — petugas dewan, perusahaan asuransi, panitera pengadilan, atau pengemudi sendiri — untuk mengkonfirmasi bahwa catatan tidak diubah sejak saat itu disimpan.',
        'callout_label': 'Bingkai jujur.',
        'callout_body': 'Tanda tangan membuktikan <em>integritas</em>: byte di dalam catatan ini identik dengan byte yang ditandatangani pada saat pemindaian. Tanda tangan tidak membuktikan <em>kebenaran</em> catatan (AI bisa salah membaca rambu), juga tidak menentukan bobot hukum bukti. Itu adalah penilaian terpisah yang dibuat oleh siapa pun yang meninjaunya.',
        'h2_verifying': 'Apa yang kamu verifikasi',
        'p_verifying_1': 'Setiap sesi ParkProof memiliki <strong>payload</strong> (file teks kecil berisi metadata sesi kanonis plus hash SHA-256 dari foto rambu + mobil) dan <strong>tanda tangan</strong> (payload yang ditandatangani dengan kunci pribadi ECDSA P-256 yang dikelola AWS KMS dan tidak pernah meninggalkan AWS). Keduanya dicetak di lampiran tanda tangan setiap PDF bukti yang diekspor.',
        'p_verifying_2': '<strong>Kunci publik</strong> yang diperlukan untuk memverifikasi tanda tangan diterbitkan di <a class="link" href="/parkproof-public-key.pem"><code>/parkproof-public-key.pem</code></a> — buka di browser untuk memastikan dimuat, lalu simpan secara lokal.',
        'h2_need': 'Yang kamu butuhkan',
        'li_need_1': '<strong>PDF bukti</strong> — disediakan oleh orang yang menyengketakan atau memproduksi catatan.',
        'li_need_2': '<strong><code>openssl</code></strong> — disertakan dengan macOS dan kebanyakan distro Linux; di Windows, tersedia melalui Git Bash, WSL, atau build OpenSSL mandiri.',
        'li_need_3': '<strong>Sekitar 60 detik.</strong>',
        'h2_steps': 'Langkah demi langkah',
        'p_steps': 'Buka PDF bukti, gulir ke halaman <strong>"Lampiran tanda tangan"</strong> di belakang. Kamu akan melihat tiga blok teks: <code>payload</code>, <code>sig.base64</code>, dan referensi ke URL kunci publik. Simpan dua yang pertama ke file di mesinmu, lalu jalankan verifikasi:',
        'c_step_1': '1. Simpan blok payload dari lampiran PDF ke payload.txt',
        'c_step_1b': '   (copy-paste persis; pertahankan akhir baris).',
        'c_step_2': '2. Simpan blok tanda tangan base64 ke sig.base64.',
        'c_step_3': '3. Ambil kunci publik.',
        'c_step_4': '4. Dekode tanda tangan base64 ke byte mentah.',
        'c_step_5': '5. Jalankan verifikasi.',
        'h2_result': 'Apa arti hasilnya',
        'pass_title': 'Terverifikasi',
        'pass_label': 'LOLOS',
        'pass_body': '<code>Verified OK</code> — payload di PDF-mu identik secara byte dengan apa yang ParkProof tandatangani pada saat pemindaian. Aturan rambu, GPS, timestamp, alamat, dan hash foto belum diubah sejak itu.',
        'fail_title': 'Gagal',
        'fail_label': 'GAGAL',
        'fail_body': '<code>Verification failure</code> — payload, tanda tangan, atau keduanya telah dimodifikasi sejak catatan disimpan. PDF mungkin diedit, lampiran dirusak, atau copy-paste menimbulkan perbedaan spasi. Ulangi penyalinan dengan hati-hati sebelum menarik kesimpulan.',
        'h2_beyond': 'Lebih dari "apakah byte berubah?"',
        'p_beyond': 'Verifikasi yang berhasil mengkonfirmasi <em>integritas</em>. Itu tidak mengkonfirmasi:',
        'li_beyond_1': '<strong>Bahwa AI membaca rambu dengan benar.</strong> Pemindaian ParkProof adalah pembacaan mesin dari rambu parkir, dan mesin bisa salah. Teks putusan dan aturan dalam catatan adalah pembacaan terbaik AI pada saat pemindaian, bukan kebenaran absolut.',
        'li_beyond_2': '<strong>Bahwa foto menggambarkan apa yang orang itu katakan.</strong> Tanda tangan membuktikan foto belum diubah <em>sejak disimpan</em>, bukan bahwa foto itu sendiri ditangkap dengan jujur.',
        'li_beyond_3': '<strong>Hasil hukum apa pun.</strong> Apakah bukti mendukung banding, pengembalian dana, atau perkara pengadilan adalah keputusan peninjau. ParkProof adalah alat, bukan pengacara.',
        'h2_why': 'Mengapa ini ada',
        'p_why_1': 'Sebagian besar aplikasi parkir yang menghasilkan "bukti" hanya menghasilkan tangkapan layar. Tangkapan layar tidak punya cerita integritas — bisa saja diedit kapan pun antara saat diambil dan saat dikirim. Tanda tangan kriptografis adalah perbedaan antara <em>"inilah yang aku lihat"</em> dan <em>"inilah yang aku lihat, dan ini bukti matematis bahwa aku belum mengubahnya sejak itu."</em>',
        'p_why_2': 'Kunci publik diterbitkan sehingga verifikasi sepenuhnya offline — kamu tidak perlu mempercayai ParkProof, menghubungi server kami, atau menjalankan aplikasi kami untuk mengkonfirmasi klaim integritas. Verifikasi dapat dilakukan bertahun-tahun dari sekarang bahkan jika ParkProof tidak lagi dipelihara, selama <code>openssl</code> masih ada.',
        'h2_questions': 'Pertanyaan?',
        'p_questions': 'Email <a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>. Kami menjawab.',
        'footer_left': 'parkproof.com.au · halaman verifikasi',
    },
    'ko': {
        'page_title': 'ParkProof 증거 기록 검증 — ParkProof',
        'meta_desc': 'ParkProof 증거 PDF가 저장 이후 변경되지 않았음을 확인하는 단계별 openssl 가이드. AWS KMS ECDSA P-256을 통한 암호학적 서명.',
        'back_link': '← ParkProof로 돌아가기',
        'eyebrow': '검증',
        'h1_main': 'ParkProof',
        'h1_accent': '증거 기록 검증',
        'h1_period': '하기.',
        'lede': '모든 ParkProof 증거 PDF에는 암호학적 서명 부록이 포함되어 있습니다. 이 페이지는 누구든지 — 시청 공무원, 보험사, 법원 서기, 또는 운전자 본인 — 기록이 저장된 순간 이후 변경되지 않았음을 확인할 수 있는 공개 오프라인 가이드입니다.',
        'callout_label': '솔직한 프레임.',
        'callout_body': '서명은 <em>무결성</em>을 증명합니다: 이 기록 내부의 바이트는 스캔 시점에 서명된 바이트와 동일합니다. 기록의 <em>진실성</em>을 증명하지는 않으며(AI가 표지판을 잘못 읽었을 수 있음), 증거의 법적 무게도 결정하지 않습니다. 그것은 검토자가 별도로 내리는 판단입니다.',
        'h2_verifying': '무엇을 검증하는가',
        'p_verifying_1': '각 ParkProof 세션에는 <strong>페이로드</strong>(표준 세션 메타데이터와 표지판 + 차량 사진의 SHA-256 해시를 포함한 작은 텍스트 파일)와 <strong>서명</strong>(AWS KMS가 관리하고 AWS를 떠나지 않는 ECDSA P-256 개인 키로 페이로드를 서명한 것)이 있습니다. 둘 다 모든 내보낸 증거 PDF의 서명 부록에 인쇄됩니다.',
        'p_verifying_2': '서명을 검증하는 데 필요한 <strong>공개 키</strong>는 <a class="link" href="/parkproof-public-key.pem"><code>/parkproof-public-key.pem</code></a>에 게시되어 있습니다 — 브라우저에서 열어 로드되는지 확인한 다음 로컬로 저장하세요.',
        'h2_need': '필요한 것',
        'li_need_1': '<strong>증거 PDF</strong> — 기록을 분쟁하거나 제공하는 사람이 공급.',
        'li_need_2': '<strong><code>openssl</code></strong> — macOS와 대부분의 Linux 배포판에 내장; Windows에서는 Git Bash, WSL, 또는 독립형 OpenSSL 빌드를 통해 사용 가능.',
        'li_need_3': '<strong>약 60초.</strong>',
        'h2_steps': '단계별',
        'p_steps': '증거 PDF를 열고 뒤쪽의 <strong>"서명 부록"</strong> 페이지로 스크롤하세요. 세 개의 텍스트 블록이 보일 것입니다: <code>payload</code>, <code>sig.base64</code>, 그리고 공개 키 URL에 대한 참조. 처음 두 개를 컴퓨터의 파일에 저장한 다음 검증을 실행하세요:',
        'c_step_1': '1. PDF 부록의 페이로드 블록을 payload.txt에 저장',
        'c_step_1b': '   (정확히 복사-붙여넣기; 줄 끝을 유지).',
        'c_step_2': '2. base64 서명 블록을 sig.base64에 저장.',
        'c_step_3': '3. 공개 키 가져오기.',
        'c_step_4': '4. base64 서명을 원시 바이트로 디코딩.',
        'c_step_5': '5. 검증 실행.',
        'h2_result': '결과의 의미',
        'pass_title': '검증됨',
        'pass_label': '통과',
        'pass_body': '<code>Verified OK</code> — PDF의 페이로드는 ParkProof가 스캔 시점에 서명한 것과 바이트 단위로 동일합니다. 표지판 규칙, GPS, 타임스탬프, 주소, 사진 해시는 그 이후 변경되지 않았습니다.',
        'fail_title': '실패',
        'fail_label': '실패',
        'fail_body': '<code>Verification failure</code> — 페이로드, 서명 또는 둘 다 기록이 저장된 이후 수정되었습니다. PDF가 편집되었거나, 부록이 변조되었거나, 복사-붙여넣기로 공백 차이가 도입되었을 수 있습니다. 결론을 내리기 전에 복사를 신중하게 반복하세요.',
        'h2_beyond': '"바이트가 변경되었는가?" 그 너머',
        'p_beyond': '성공적인 검증은 <em>무결성</em>을 확인합니다. 다음은 확인하지 않습니다:',
        'li_beyond_1': '<strong>AI가 표지판을 올바르게 읽었는지.</strong> ParkProof 스캔은 주차 표지판의 기계 판독이며 기계는 틀릴 수 있습니다. 기록의 판정 텍스트와 규칙은 스캔 시점의 AI 최선의 판독이며 절대 진리가 아닙니다.',
        'li_beyond_2': '<strong>사진이 그 사람이 말하는 것을 묘사하는지.</strong> 서명은 사진이 <em>저장 이후</em> 변경되지 않았음을 증명할 뿐, 사진 자체가 정직하게 촬영되었음을 증명하지는 않습니다.',
        'li_beyond_3': '<strong>법적 결과.</strong> 증거가 항소, 환불 또는 법원 사건을 뒷받침하는지 여부는 검토자의 판단입니다. ParkProof는 도구이지 변호사가 아닙니다.',
        'h2_why': '왜 존재하는가',
        'p_why_1': '"증거"를 생산하는 대부분의 주차 앱은 스크린샷을 생산합니다. 스크린샷에는 무결성 스토리가 없습니다 — 촬영부터 전송까지 어느 시점에서도 편집될 수 있습니다. 암호학적 서명은 <em>"이게 내가 본 것"</em>과 <em>"이게 내가 본 것이며, 이것이 그 이후 변경하지 않았다는 수학적 증거"</em>의 차이입니다.',
        'p_why_2': '공개 키가 게시되어 있어 검증은 완전히 오프라인입니다 — 무결성 주장을 확인하기 위해 ParkProof를 신뢰하거나, 우리 서버에 연락하거나, 우리 앱을 실행할 필요가 없습니다. ParkProof가 더 이상 유지되지 않더라도 <code>openssl</code>이 존재하는 한 몇 년 후에도 검증을 수행할 수 있습니다.',
        'h2_questions': '질문이 있나요?',
        'p_questions': '<a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>로 이메일을 보내세요. 답변드립니다.',
        'footer_left': 'parkproof.com.au · 검증 페이지',
    },
    'it': {
        'page_title': 'Verifica un record di prova ParkProof — ParkProof',
        'meta_desc': "Procedura passo-passo con openssl per verificare che un PDF di prova ParkProof non sia stato alterato dal salvataggio. Firma crittografica tramite AWS KMS ECDSA P-256.",
        'back_link': '← Torna a ParkProof',
        'eyebrow': 'Verifica',
        'h1_main': 'Verifica un record di',
        'h1_accent': 'prova ParkProof',
        'h1_period': '.',
        'lede': "Ogni PDF di prova ParkProof porta un'appendice di firma crittografica. Questa pagina è la guida pubblica e offline perché chiunque — un funzionario comunale, un assicuratore, un cancelliere, o il conducente stesso — confermi che il record non è stato alterato dal momento del salvataggio.",
        'callout_label': 'Inquadramento onesto.',
        'callout_body': "La firma prova l'<em>integrità</em>: i byte all'interno di questo record sono identici ai byte firmati al momento della scansione. Non prova la <em>veridicità</em> del record (l'AI potrebbe aver letto male il cartello), né determina il peso legale della prova. Quel giudizio spetta a chi la rivede.",
        'h2_verifying': 'Cosa stai verificando',
        'p_verifying_1': "Ogni sessione ParkProof ha un <strong>payload</strong> (un piccolo file di testo contenente i metadati canonici della sessione più gli hash SHA-256 delle foto del cartello + dell'auto) e una <strong>firma</strong> (il payload firmato con una chiave privata ECDSA P-256 gestita da AWS KMS che non lascia mai AWS). Entrambi sono stampati nell'appendice di firma di ogni PDF di prova esportato.",
        'p_verifying_2': 'La <strong>chiave pubblica</strong> necessaria per verificare la firma è pubblicata su <a class="link" href="/parkproof-public-key.pem"><code>/parkproof-public-key.pem</code></a> — aprila nel browser per confermare il caricamento, poi salvala localmente.',
        'h2_need': 'Cosa ti serve',
        'li_need_1': '<strong>Il PDF di prova</strong> — fornito dalla persona che contesta o produce il record.',
        'li_need_2': '<strong><code>openssl</code></strong> — incluso in macOS e nella maggior parte delle distro Linux; su Windows, disponibile tramite Git Bash, WSL, o la build OpenSSL standalone.',
        'li_need_3': '<strong>Circa 60 secondi.</strong>',
        'h2_steps': 'Passo-passo',
        'p_steps': 'Apri il PDF di prova, scorri fino alla pagina <strong>"Appendice firma"</strong> in fondo. Vedrai tre blocchi di testo: <code>payload</code>, <code>sig.base64</code>, e un riferimento all\'URL della chiave pubblica. Salva i primi due in file sulla tua macchina, poi esegui la verifica:',
        'c_step_1': '1. Salva il blocco payload dall\'appendice PDF in payload.txt',
        'c_step_1b': '   (copia-incolla esattamente; preserva i fine-riga).',
        'c_step_2': '2. Salva il blocco firma base64 in sig.base64.',
        'c_step_3': '3. Scarica la chiave pubblica.',
        'c_step_4': '4. Decodifica la firma base64 in byte grezzi.',
        'c_step_5': '5. Esegui la verifica.',
        'h2_result': 'Cosa significa il risultato',
        'pass_title': 'Verificato',
        'pass_label': 'PASS',
        'pass_body': '<code>Verified OK</code> — il payload nel tuo PDF è byte-identico a quello che ParkProof ha firmato al momento della scansione. Le regole del cartello, GPS, timestamp, indirizzo e hash delle foto non sono stati alterati da allora.',
        'fail_title': 'Fallimento',
        'fail_label': 'FAIL',
        'fail_body': "<code>Verification failure</code> — il payload, la firma, o entrambi sono stati modificati da quando il record è stato salvato. Il PDF potrebbe essere stato modificato, l'appendice manomessa, o copia-incolla ha introdotto differenze di spaziatura. Ripeti la copia con attenzione prima di trarre conclusioni.",
        'h2_beyond': 'Oltre "i byte sono cambiati?"',
        'p_beyond': "Una verifica riuscita conferma l'<em>integrità</em>. Non conferma:",
        'li_beyond_1': "<strong>Che l'AI abbia letto il cartello correttamente.</strong> La scansione ParkProof è una lettura automatica di un cartello di parcheggio, e le macchine possono sbagliare. Il testo del verdetto e le regole nel record sono la migliore lettura dell'AI al momento della scansione, non la verità assoluta.",
        'li_beyond_2': '<strong>Che le foto raffigurino ciò che la persona dice raffigurino.</strong> La firma prova che le foto non sono state alterate <em>dal salvataggio</em>, non che le foto stesse siano state catturate onestamente.',
        'li_beyond_3': '<strong>Qualsiasi esito legale.</strong> Se la prova supporti un ricorso, un rimborso, o un caso giudiziario è la decisione del revisore. ParkProof è uno strumento, non un avvocato.',
        'h2_why': "Perché esiste",
        'p_why_1': 'La maggior parte delle app di parcheggio che producono "prova" producono uno screenshot. Gli screenshot non hanno storia di integrità — potrebbero essere stati modificati in qualunque momento tra quando sono stati scattati e quando sono stati inviati. La firma crittografica è la differenza tra <em>"ecco cosa ho visto"</em> e <em>"ecco cosa ho visto, ed ecco la prova matematica che non l\'ho cambiato da allora."</em>',
        'p_why_2': 'La chiave pubblica è pubblicata in modo che la verifica sia interamente offline — non devi fidarti di ParkProof, contattare i nostri server, o eseguire la nostra app per confermare la dichiarazione di integrità. La verifica può essere eseguita anni dopo, anche se ParkProof non è più mantenuta, finché <code>openssl</code> esiste ancora.',
        'h2_questions': 'Domande?',
        'p_questions': 'Email <a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>. Rispondiamo.',
        'footer_left': 'parkproof.com.au · pagina di verifica',
    },
    'el': {
        'page_title': 'Επαλήθευση μιας εγγραφής αποδείξεων ParkProof — ParkProof',
        'meta_desc': 'Οδηγός βήμα-βήμα με openssl για επαλήθευση ότι ένα PDF αποδείξεων ParkProof δεν έχει αλλοιωθεί από την αποθήκευση. Κρυπτογραφική υπογραφή μέσω AWS KMS ECDSA P-256.',
        'back_link': '← Πίσω στο ParkProof',
        'eyebrow': 'Επαλήθευση',
        'h1_main': 'Επαλήθευση μιας εγγραφής',
        'h1_accent': 'αποδείξεων ParkProof',
        'h1_period': '.',
        'lede': 'Κάθε PDF αποδείξεων ParkProof φέρει ένα παράρτημα κρυπτογραφικής υπογραφής. Αυτή η σελίδα είναι ο δημόσιος, εκτός σύνδεσης οδηγός για οποιονδήποτε — δημοτικό υπάλληλο, ασφαλιστή, γραμματέα δικαστηρίου, ή τον ίδιο τον οδηγό — για να επιβεβαιώσει ότι η εγγραφή δεν έχει αλλοιωθεί από τη στιγμή που αποθηκεύτηκε.',
        'callout_label': 'Έντιμη πλαισίωση.',
        'callout_body': 'Η υπογραφή αποδεικνύει την <em>ακεραιότητα</em>: τα byte μέσα σε αυτή την εγγραφή είναι πανομοιότυπα με τα byte που υπογράφηκαν τη στιγμή της σάρωσης. Δεν αποδεικνύει την <em>αλήθεια</em> της εγγραφής (η ΑΙ μπορεί να διάβασε λάθος την πινακίδα), ούτε καθορίζει το νομικό βάρος της απόδειξης. Αυτή είναι ξεχωριστή κρίση που γίνεται από όποιον την εξετάζει.',
        'h2_verifying': 'Τι επαληθεύεις',
        'p_verifying_1': 'Κάθε συνεδρία ParkProof έχει ένα <strong>payload</strong> (ένα μικρό αρχείο κειμένου που περιέχει τα κανονικά μεταδεδομένα της συνεδρίας συν τα hashes SHA-256 των φωτογραφιών πινακίδας + αυτοκινήτου) και μία <strong>υπογραφή</strong> (το payload υπογεγραμμένο με ιδιωτικό κλειδί ECDSA P-256 διαχειριζόμενο από το AWS KMS που δεν φεύγει ποτέ από το AWS). Και τα δύο εκτυπώνονται στο παράρτημα υπογραφής κάθε εξαγόμενου PDF αποδείξεων.',
        'p_verifying_2': 'Το <strong>δημόσιο κλειδί</strong> που χρειάζεται για την επαλήθευση της υπογραφής δημοσιεύεται στο <a class="link" href="/parkproof-public-key.pem"><code>/parkproof-public-key.pem</code></a> — άνοιξέ το σε browser για επιβεβαίωση φόρτωσης, μετά αποθήκευσέ το τοπικά.',
        'h2_need': 'Τι θα χρειαστείς',
        'li_need_1': '<strong>Το PDF αποδείξεων</strong> — που παρέχεται από το άτομο που αμφισβητεί ή προσκομίζει την εγγραφή.',
        'li_need_2': '<strong><code>openssl</code></strong> — συμπεριλαμβάνεται στο macOS και στις περισσότερες διανομές Linux· σε Windows, διαθέσιμο μέσω Git Bash, WSL, ή τη standalone OpenSSL build.',
        'li_need_3': '<strong>Περίπου 60 δευτερόλεπτα.</strong>',
        'h2_steps': 'Βήμα-βήμα',
        'p_steps': 'Άνοιξε το PDF αποδείξεων, κάνε scroll στη σελίδα <strong>"Παράρτημα υπογραφής"</strong> στο πίσω μέρος. Θα δεις τρία μπλοκ κειμένου: <code>payload</code>, <code>sig.base64</code>, και μία αναφορά στο URL του δημόσιου κλειδιού. Αποθήκευσε τα δύο πρώτα σε αρχεία στον υπολογιστή σου, μετά τρέξε την επαλήθευση:',
        'c_step_1': '1. Αποθήκευσε το payload block από το παράρτημα του PDF στο payload.txt',
        'c_step_1b': '   (copy-paste ακριβώς· διατήρησε τα τέλη γραμμών).',
        'c_step_2': '2. Αποθήκευσε το base64 signature block στο sig.base64.',
        'c_step_3': '3. Κατέβασε το δημόσιο κλειδί.',
        'c_step_4': '4. Αποκωδικοποίησε την base64 υπογραφή σε raw bytes.',
        'c_step_5': '5. Τρέξε την επαλήθευση.',
        'h2_result': 'Τι σημαίνει το αποτέλεσμα',
        'pass_title': 'Επαληθεύτηκε',
        'pass_label': 'PASS',
        'pass_body': '<code>Verified OK</code> — το payload στο PDF σου είναι byte-πανομοιότυπο με αυτό που υπέγραψε το ParkProof τη στιγμή της σάρωσης. Οι κανόνες της πινακίδας, GPS, timestamp, διεύθυνση και hashes φωτογραφιών δεν έχουν αλλοιωθεί από τότε.',
        'fail_title': 'Αποτυχία',
        'fail_label': 'FAIL',
        'fail_body': '<code>Verification failure</code> — το payload, η υπογραφή, ή και τα δύο έχουν τροποποιηθεί από τότε που αποθηκεύτηκε η εγγραφή. Το PDF μπορεί να έχει επεξεργαστεί, το παράρτημα παραποιηθεί, ή το copy-paste εισήγαγε διαφορές κενών χαρακτήρων. Επανάλαβε προσεκτικά την αντιγραφή πριν βγάλεις συμπεράσματα.',
        'h2_beyond': 'Πέρα από το "άλλαξαν τα bytes;"',
        'p_beyond': 'Μια επιτυχημένη επαλήθευση επιβεβαιώνει την <em>ακεραιότητα</em>. Δεν επιβεβαιώνει:',
        'li_beyond_1': '<strong>Ότι η ΑΙ διάβασε σωστά την πινακίδα.</strong> Η σάρωση του ParkProof είναι ανάγνωση μηχανής μιας πινακίδας στάθμευσης, και οι μηχανές μπορούν να κάνουν λάθος. Το κείμενο ετυμηγορίας και οι κανόνες στην εγγραφή είναι η καλύτερη ανάγνωση της ΑΙ τη στιγμή της σάρωσης, όχι απόλυτη αλήθεια.',
        'li_beyond_2': '<strong>Ότι οι φωτογραφίες απεικονίζουν αυτό που λέει το άτομο.</strong> Η υπογραφή αποδεικνύει ότι οι φωτογραφίες δεν έχουν αλλοιωθεί <em>από την αποθήκευση</em>, όχι ότι οι ίδιες οι φωτογραφίες ελήφθησαν με ειλικρίνεια.',
        'li_beyond_3': '<strong>Οποιοδήποτε νομικό αποτέλεσμα.</strong> Αν η απόδειξη υποστηρίζει μια έφεση, επιστροφή χρημάτων, ή δικαστική υπόθεση είναι κρίση του εξεταστή. Το ParkProof είναι εργαλείο, όχι δικηγόρος.',
        'h2_why': 'Γιατί υπάρχει αυτό',
        'p_why_1': 'Οι περισσότερες εφαρμογές στάθμευσης που παράγουν "αποδείξεις" παράγουν ένα screenshot. Τα screenshots δεν έχουν ιστορία ακεραιότητας — θα μπορούσαν να έχουν επεξεργαστεί σε οποιοδήποτε σημείο μεταξύ της λήψης και της αποστολής. Η κρυπτογραφική υπογραφή είναι η διαφορά μεταξύ <em>"να τι είδα"</em> και <em>"να τι είδα, και να η μαθηματική απόδειξη ότι δεν το άλλαξα από τότε."</em>',
        'p_why_2': 'Το δημόσιο κλειδί δημοσιεύεται έτσι ώστε η επαλήθευση να είναι πλήρως εκτός σύνδεσης — δεν χρειάζεται να εμπιστευτείς το ParkProof, να επικοινωνήσεις με τους διακομιστές μας, ή να τρέξεις την εφαρμογή μας για να επιβεβαιώσεις τον ισχυρισμό ακεραιότητας. Η επαλήθευση μπορεί να γίνει χρόνια από τώρα ακόμη και αν το ParkProof δεν συντηρείται πια, εφόσον το <code>openssl</code> εξακολουθεί να υπάρχει.',
        'h2_questions': 'Ερωτήσεις;',
        'p_questions': 'Email στο <a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a>. Απαντάμε.',
        'footer_left': 'parkproof.com.au · σελίδα επαλήθευσης',
    },
    'hi': {
        'page_title': 'ParkProof साक्ष्य रिकॉर्ड सत्यापित करें — ParkProof',
        'meta_desc': 'ParkProof साक्ष्य PDF सहेजे जाने के बाद बदला नहीं गया है यह सत्यापित करने के लिए चरण-दर-चरण openssl गाइड। AWS KMS ECDSA P-256 के माध्यम से क्रिप्टोग्राफिक हस्ताक्षर।',
        'back_link': '← ParkProof पर वापस',
        'eyebrow': 'सत्यापन',
        'h1_main': 'ParkProof',
        'h1_accent': 'साक्ष्य रिकॉर्ड',
        'h1_period': ' सत्यापित करें।',
        'lede': 'हर ParkProof साक्ष्य PDF में एक क्रिप्टोग्राफिक हस्ताक्षर परिशिष्ट होता है। यह पृष्ठ किसी के लिए भी — नगरपालिका अधिकारी, बीमाकर्ता, अदालत क्लर्क, या स्वयं चालक — सार्वजनिक, ऑफ़लाइन मार्गदर्शिका है जो यह पुष्टि करने के लिए है कि रिकॉर्ड सहेजे जाने के क्षण से बदला नहीं गया है।',
        'callout_label': 'ईमानदार ढांचा।',
        'callout_body': 'हस्ताक्षर <em>अखंडता</em> साबित करता है: इस रिकॉर्ड के अंदर के बाइट्स स्कैन के समय हस्ताक्षरित बाइट्स के समान हैं। यह रिकॉर्ड की <em>सच्चाई</em> साबित नहीं करता (AI साइन को गलत पढ़ सकती है), न ही यह साक्ष्य का कानूनी वजन निर्धारित करता है। यह एक अलग निर्णय है जो समीक्षक करता है।',
        'h2_verifying': 'आप क्या सत्यापित कर रहे हैं',
        'p_verifying_1': 'हर ParkProof सत्र में एक <strong>payload</strong> होता है (एक छोटी टेक्स्ट फ़ाइल जिसमें मानक सत्र मेटाडेटा प्लस साइन + कार फ़ोटो के SHA-256 हैश होते हैं) और एक <strong>हस्ताक्षर</strong> (AWS KMS-प्रबंधित ECDSA P-256 निजी कुंजी के साथ हस्ताक्षरित payload जो AWS से कभी बाहर नहीं जाती)। दोनों हर निर्यात किए गए साक्ष्य PDF के हस्ताक्षर परिशिष्ट में मुद्रित होते हैं।',
        'p_verifying_2': 'हस्ताक्षर को सत्यापित करने के लिए आवश्यक <strong>सार्वजनिक कुंजी</strong> <a class="link" href="/parkproof-public-key.pem"><code>/parkproof-public-key.pem</code></a> पर प्रकाशित है — लोड होने की पुष्टि के लिए ब्राउज़र में खोलें, फिर स्थानीय रूप से सहेजें।',
        'h2_need': 'आपको क्या चाहिए',
        'li_need_1': '<strong>साक्ष्य PDF</strong> — रिकॉर्ड विवाद करने या प्रस्तुत करने वाले व्यक्ति द्वारा प्रदान किया गया।',
        'li_need_2': '<strong><code>openssl</code></strong> — macOS और अधिकांश Linux वितरण के साथ शामिल; Windows पर, Git Bash, WSL, या स्टैंडअलोन OpenSSL बिल्ड के माध्यम से उपलब्ध।',
        'li_need_3': '<strong>लगभग 60 सेकंड।</strong>',
        'h2_steps': 'चरण-दर-चरण',
        'p_steps': 'साक्ष्य PDF खोलें, पीछे <strong>"हस्ताक्षर परिशिष्ट"</strong> पृष्ठ तक स्क्रॉल करें। आपको तीन टेक्स्ट ब्लॉक दिखाई देंगे: <code>payload</code>, <code>sig.base64</code>, और सार्वजनिक कुंजी URL का संदर्भ। पहले दो को अपनी मशीन पर फ़ाइलों में सहेजें, फिर सत्यापन चलाएं:',
        'c_step_1': '1. PDF परिशिष्ट से payload ब्लॉक को payload.txt में सहेजें',
        'c_step_1b': '   (बिल्कुल कॉपी-पेस्ट करें; लाइन एंडिंग्स संरक्षित करें)।',
        'c_step_2': '2. base64 हस्ताक्षर ब्लॉक को sig.base64 में सहेजें।',
        'c_step_3': '3. सार्वजनिक कुंजी प्राप्त करें।',
        'c_step_4': '4. base64 हस्ताक्षर को कच्चे बाइट्स में डिकोड करें।',
        'c_step_5': '5. सत्यापन चलाएं।',
        'h2_result': 'परिणाम का क्या मतलब है',
        'pass_title': 'सत्यापित',
        'pass_label': 'पास',
        'pass_body': '<code>Verified OK</code> — आपके PDF में payload स्कैन के समय ParkProof द्वारा हस्ताक्षरित से बाइट-समान है। साइन नियम, GPS, टाइमस्टैम्प, पता और फ़ोटो हैश तब से बदले नहीं गए हैं।',
        'fail_title': 'विफलता',
        'fail_label': 'फेल',
        'fail_body': '<code>Verification failure</code> — payload, हस्ताक्षर, या दोनों रिकॉर्ड सहेजे जाने के बाद से संशोधित किए गए हैं। PDF को संपादित किया गया हो सकता है, परिशिष्ट के साथ छेड़छाड़ की गई हो सकती है, या कॉपी-पेस्ट ने व्हाइटस्पेस अंतर पेश किए हों। निष्कर्ष निकालने से पहले सावधानी से कॉपी दोहराएं।',
        'h2_beyond': '"क्या बाइट्स बदले?" से परे',
        'p_beyond': 'सफल सत्यापन <em>अखंडता</em> की पुष्टि करता है। यह पुष्टि नहीं करता:',
        'li_beyond_1': '<strong>कि AI ने साइन को सही पढ़ा।</strong> ParkProof स्कैन एक पार्किंग साइन का मशीन रीडिंग है, और मशीनें गलत हो सकती हैं। रिकॉर्ड में फैसले का पाठ और नियम स्कैन के समय AI की सर्वोत्तम रीडिंग है, परम सत्य नहीं।',
        'li_beyond_2': '<strong>कि फ़ोटो वही दिखाती हैं जो व्यक्ति कहता है कि वे दिखाती हैं।</strong> हस्ताक्षर साबित करता है कि फ़ोटो <em>सहेजे जाने के बाद से</em> नहीं बदली गई हैं, यह नहीं कि फ़ोटो स्वयं ईमानदारी से कैप्चर की गई थीं।',
        'li_beyond_3': '<strong>कोई कानूनी परिणाम।</strong> क्या साक्ष्य एक अपील, धन वापसी, या अदालती मामले का समर्थन करता है यह समीक्षक का निर्णय है। ParkProof एक उपकरण है, वकील नहीं।',
        'h2_why': 'यह क्यों मौजूद है',
        'p_why_1': '"साक्ष्य" बनाने वाले अधिकांश पार्किंग ऐप एक स्क्रीनशॉट बनाते हैं। स्क्रीनशॉट में कोई अखंडता कहानी नहीं है — उन्हें लिए जाने और भेजे जाने के बीच किसी भी समय संपादित किया जा सकता था। क्रिप्टोग्राफिक हस्ताक्षर <em>"यह मैंने देखा"</em> और <em>"यह मैंने देखा, और यह गणितीय प्रमाण है कि मैंने तब से इसे नहीं बदला"</em> के बीच का अंतर है।',
        'p_why_2': 'सार्वजनिक कुंजी प्रकाशित है ताकि सत्यापन पूरी तरह ऑफ़लाइन हो — अखंडता दावे की पुष्टि के लिए आपको ParkProof पर भरोसा करने, हमारे सर्वर से संपर्क करने, या हमारा ऐप चलाने की आवश्यकता नहीं है। यदि ParkProof अब बनाए नहीं रखा जाता है तब भी सत्यापन वर्षों बाद किया जा सकता है, जब तक <code>openssl</code> मौजूद है।',
        'h2_questions': 'प्रश्न?',
        'p_questions': '<a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a> पर ईमेल करें। हम जवाब देते हैं।',
        'footer_left': 'parkproof.com.au · सत्यापन पृष्ठ',
    },
    'pa': {
        'page_title': 'ParkProof ਸਬੂਤ ਰਿਕਾਰਡ ਦੀ ਪੁਸ਼ਟੀ ਕਰੋ — ParkProof',
        'meta_desc': 'ParkProof ਸਬੂਤ PDF ਨੂੰ ਸੰਭਾਲਣ ਤੋਂ ਬਾਅਦ ਨਹੀਂ ਬਦਲਿਆ ਗਿਆ ਇਹ ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ ਕਦਮ-ਦਰ-ਕਦਮ openssl ਗਾਈਡ। AWS KMS ECDSA P-256 ਰਾਹੀਂ ਕ੍ਰਿਪਟੋਗ੍ਰਾਫਿਕ ਹਸਤਾਖਰ।',
        'back_link': '← ParkProof ਤੇ ਵਾਪਸ',
        'eyebrow': 'ਪੁਸ਼ਟੀਕਰਣ',
        'h1_main': 'ParkProof',
        'h1_accent': 'ਸਬੂਤ ਰਿਕਾਰਡ',
        'h1_period': ' ਦੀ ਪੁਸ਼ਟੀ ਕਰੋ।',
        'lede': "ਹਰ ParkProof ਸਬੂਤ PDF ਇੱਕ ਕ੍ਰਿਪਟੋਗ੍ਰਾਫਿਕ ਹਸਤਾਖਰ ਅੰਤਿਕਾ ਲੈ ਕੇ ਆਉਂਦੀ ਹੈ। ਇਹ ਪੰਨਾ ਕਿਸੇ ਵੀ — ਨਗਰ ਅਧਿਕਾਰੀ, ਬੀਮਾਕਰਤਾ, ਅਦਾਲਤੀ ਕਲਰਕ, ਜਾਂ ਡਰਾਈਵਰ ਖੁਦ — ਲਈ ਜਨਤਕ, ਔਫਲਾਈਨ ਗਾਈਡ ਹੈ ਜੋ ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ ਹੈ ਕਿ ਰਿਕਾਰਡ ਸੰਭਾਲੇ ਜਾਣ ਦੇ ਪਲ ਤੋਂ ਬਦਲਿਆ ਨਹੀਂ ਗਿਆ।",
        'callout_label': 'ਇਮਾਨਦਾਰ ਫਰੇਮ।',
        'callout_body': 'ਹਸਤਾਖਰ <em>ਅਖੰਡਤਾ</em> ਸਾਬਤ ਕਰਦਾ ਹੈ: ਇਸ ਰਿਕਾਰਡ ਦੇ ਅੰਦਰ ਦੇ ਬਾਈਟ ਸਕੈਨ ਦੇ ਸਮੇਂ ਹਸਤਾਖਰਿਤ ਬਾਈਟਾਂ ਨਾਲ ਇੱਕੋ ਜਿਹੇ ਹਨ। ਇਹ ਰਿਕਾਰਡ ਦੀ <em>�ੱਚਾਈ</em> ਸਾਬਤ ਨਹੀਂ ਕਰਦਾ (AI ਚਿੰਨ੍ਹ ਨੂੰ ਗਲਤ ਪੜ੍ਹ ਸਕਦੀ ਹੈ), ਨਾ ਹੀ ਇਹ ਸਬੂਤ ਦਾ ਕਾਨੂੰਨੀ ਭਾਰ ਨਿਰਧਾਰਤ ਕਰਦਾ ਹੈ। ਇਹ ਇੱਕ ਵੱਖਰਾ ਨਿਰਣਾ ਹੈ ਜੋ ਸਮੀਖਿਅਕ ਕਰਦਾ ਹੈ।',
        'h2_verifying': 'ਤੁਸੀਂ ਕੀ ਪੁਸ਼ਟੀ ਕਰ ਰਹੇ ਹੋ',
        'p_verifying_1': "ਹਰ ParkProof ਸੈਸ਼ਨ ਵਿੱਚ ਇੱਕ <strong>payload</strong> ਹੁੰਦਾ ਹੈ (ਇੱਕ ਛੋਟੀ ਟੈਕਸਟ ਫਾਈਲ ਜਿਸ ਵਿੱਚ ਮਿਆਰੀ ਸੈਸ਼ਨ ਮੈਟਾਡੇਟਾ ਅਤੇ ਚਿੰਨ੍ਹ + ਕਾਰ ਫੋਟੋਆਂ ਦੇ SHA-256 ਹੈਸ਼ ਹੁੰਦੇ ਹਨ) ਅਤੇ ਇੱਕ <strong>ਹਸਤਾਖਰ</strong> (AWS KMS-ਪ੍ਰਬੰਧਿਤ ECDSA P-256 ਨਿੱਜੀ ਕੁੰਜੀ ਨਾਲ ਹਸਤਾਖਰਿਤ payload ਜੋ AWS ਤੋਂ ਕਦੇ ਬਾਹਰ ਨਹੀਂ ਜਾਂਦੀ)। ਦੋਵੇਂ ਹਰ ਨਿਰਯਾਤ ਕੀਤੇ ਸਬੂਤ PDF ਦੇ ਹਸਤਾਖਰ ਅੰਤਿਕਾ ਵਿੱਚ ਛਾਪੇ ਜਾਂਦੇ ਹਨ।",
        'p_verifying_2': 'ਹਸਤਾਖਰ ਦੀ ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ ਲੋੜੀਂਦੀ <strong>ਜਨਤਕ ਕੁੰਜੀ</strong> <a class="link" href="/parkproof-public-key.pem"><code>/parkproof-public-key.pem</code></a> ਤੇ ਪ੍ਰਕਾਸ਼ਿਤ ਹੈ — ਲੋਡ ਹੋਣ ਦੀ ਪੁਸ਼ਟੀ ਲਈ ਬ੍ਰਾਉਜ਼ਰ ਵਿੱਚ ਖੋਲ੍ਹੋ, ਫਿਰ ਸਥਾਨਕ ਤੌਰ ਤੇ ਸੰਭਾਲੋ।',
        'h2_need': 'ਤੁਹਾਨੂੰ ਕੀ ਚਾਹੀਦਾ ਹੈ',
        'li_need_1': '<strong>ਸਬੂਤ PDF</strong> — ਉਸ ਵਿਅਕਤੀ ਦੁਆਰਾ ਪ੍ਰਦਾਨ ਕੀਤਾ ਜਾਂਦਾ ਹੈ ਜੋ ਰਿਕਾਰਡ ਨੂੰ ਚੁਣੌਤੀ ਦੇ ਰਿਹਾ ਹੈ ਜਾਂ ਪੇਸ਼ ਕਰ ਰਿਹਾ ਹੈ।',
        'li_need_2': '<strong><code>openssl</code></strong> — macOS ਅਤੇ ਜ਼ਿਆਦਾਤਰ Linux ਡਿਸਟਰੋ ਨਾਲ ਆਉਂਦਾ ਹੈ; Windows ਤੇ, Git Bash, WSL, ਜਾਂ ਸਟੈਂਡਅਲੋਨ OpenSSL ਬਿਲਡ ਰਾਹੀਂ ਉਪਲਬਧ।',
        'li_need_3': '<strong>ਲਗਭਗ 60 ਸਕਿੰਟ।</strong>',
        'h2_steps': 'ਕਦਮ-ਦਰ-ਕਦਮ',
        'p_steps': "ਸਬੂਤ PDF ਖੋਲ੍ਹੋ, ਪਿੱਛੇ <strong>\"ਹਸਤਾਖਰ ਅੰਤਿਕਾ\"</strong> ਪੰਨੇ ਤੱਕ ਸਕ੍ਰੌਲ ਕਰੋ। ਤੁਹਾਨੂੰ ਤਿੰਨ ਟੈਕਸਟ ਬਲਾਕ ਦਿਖਾਈ ਦੇਣਗੇ: <code>payload</code>, <code>sig.base64</code>, ਅਤੇ ਜਨਤਕ ਕੁੰਜੀ URL ਦਾ ਹਵਾਲਾ। ਪਹਿਲੇ ਦੋ ਨੂੰ ਆਪਣੀ ਮਸ਼ੀਨ ਉੱਤੇ ਫਾਈਲਾਂ ਵਿੱਚ ਸੰਭਾਲੋ, ਫਿਰ ਪੁਸ਼ਟੀਕਰਣ ਚਲਾਓ:",
        'c_step_1': '1. PDF ਅੰਤਿਕਾ ਤੋਂ payload ਬਲਾਕ ਨੂੰ payload.txt ਵਿੱਚ ਸੰਭਾਲੋ',
        'c_step_1b': "   (ਬਿਲਕੁਲ copy-paste ਕਰੋ; ਲਾਈਨ ਅੰਤ ਸੁਰੱਖਿਅਤ ਰੱਖੋ)।",
        'c_step_2': '2. base64 ਹਸਤਾਖਰ ਬਲਾਕ ਨੂੰ sig.base64 ਵਿੱਚ ਸੰਭਾਲੋ।',
        'c_step_3': '3. ਜਨਤਕ ਕੁੰਜੀ ਪ੍ਰਾਪਤ ਕਰੋ।',
        'c_step_4': '4. base64 ਹਸਤਾਖਰ ਨੂੰ ਕੱਚੇ ਬਾਈਟਾਂ ਵਿੱਚ ਡੀਕੋਡ ਕਰੋ।',
        'c_step_5': '5. ਪੁਸ਼ਟੀਕਰਣ ਚਲਾਓ।',
        'h2_result': 'ਨਤੀਜੇ ਦਾ ਕੀ ਮਤਲਬ ਹੈ',
        'pass_title': 'ਪੁਸ਼ਟੀ ਹੋਈ',
        'pass_label': 'ਪਾਸ',
        'pass_body': '<code>Verified OK</code> — ਤੁਹਾਡੇ PDF ਵਿੱਚ payload ਸਕੈਨ ਦੇ ਸਮੇਂ ParkProof ਦੁਆਰਾ ਹਸਤਾਖਰਿਤ ਨਾਲ ਬਾਈਟ-ਸਮਾਨ ਹੈ। ਚਿੰਨ੍ਹ ਨਿਯਮ, GPS, ਟਾਈਮਸਟੈਂਪ, ਪਤਾ ਅਤੇ ਫੋਟੋ ਹੈਸ਼ ਉਸ ਸਮੇਂ ਤੋਂ ਨਹੀਂ ਬਦਲੇ ਗਏ ਹਨ।',
        'fail_title': 'ਅਸਫਲਤਾ',
        'fail_label': 'ਫੇਲ',
        'fail_body': '<code>Verification failure</code> — payload, ਹਸਤਾਖਰ, ਜਾਂ ਦੋਵੇਂ ਰਿਕਾਰਡ ਸੰਭਾਲੇ ਜਾਣ ਤੋਂ ਬਾਅਦ ਸੋਧੇ ਗਏ ਹਨ। PDF ਨੂੰ ਸੰਪਾਦਿਤ ਕੀਤਾ ਗਿਆ ਹੋ ਸਕਦਾ ਹੈ, ਅੰਤਿਕਾ ਨਾਲ ਛੇੜਛਾੜ ਕੀਤੀ ਗਈ ਹੋ ਸਕਦੀ ਹੈ, ਜਾਂ copy-paste ਨੇ ਖਾਲੀ ਥਾਂ ਦੇ ਅੰਤਰ ਪੇਸ਼ ਕੀਤੇ ਹੋਣ। ਨਤੀਜੇ ਕੱਢਣ ਤੋਂ ਪਹਿਲਾਂ ਧਿਆਨ ਨਾਲ ਕਾਪੀ ਦੁਹਰਾਓ।',
        'h2_beyond': '"ਕੀ ਬਾਈਟ ਬਦਲੇ?" ਤੋਂ ਪਰੇ',
        'p_beyond': 'ਇੱਕ ਸਫਲ ਪੁਸ਼ਟੀਕਰਣ <em>ਅਖੰਡਤਾ</em> ਦੀ ਪੁਸ਼ਟੀ ਕਰਦਾ ਹੈ। ਇਹ ਪੁਸ਼ਟੀ ਨਹੀਂ ਕਰਦਾ:',
        'li_beyond_1': '<strong>ਕਿ AI ਨੇ ਚਿੰਨ੍ਹ ਨੂੰ ਸਹੀ ਪੜ੍ਹਿਆ।</strong> ParkProof ਸਕੈਨ ਇੱਕ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਦੀ ਮਸ਼ੀਨ ਪੜ੍ਹਨ ਹੈ, ਅਤੇ ਮਸ਼ੀਨਾਂ ਗਲਤ ਹੋ ਸਕਦੀਆਂ ਹਨ। ਰਿਕਾਰਡ ਵਿੱਚ ਫੈਸਲੇ ਦਾ ਟੈਕਸਟ ਅਤੇ ਨਿਯਮ ਸਕੈਨ ਦੇ ਸਮੇਂ AI ਦੀ ਸਭ ਤੋਂ ਵਧੀਆ ਪੜ੍ਹਨ ਹੈ, ਅੰਤਮ ਸੱਚ ਨਹੀਂ।',
        'li_beyond_2': '<strong>ਕਿ ਫੋਟੋਆਂ ਉਹੀ ਦਿਖਾਉਂਦੀਆਂ ਹਨ ਜੋ ਉਹ ਵਿਅਕਤੀ ਕਹਿੰਦਾ ਹੈ।</strong> ਹਸਤਾਖਰ ਸਾਬਤ ਕਰਦਾ ਹੈ ਕਿ ਫੋਟੋਆਂ <em>ਸੰਭਾਲਣ ਤੋਂ ਬਾਅਦ</em> ਨਹੀਂ ਬਦਲੀਆਂ ਗਈਆਂ, ਇਹ ਨਹੀਂ ਕਿ ਫੋਟੋਆਂ ਖੁਦ ਇਮਾਨਦਾਰੀ ਨਾਲ ਲਈਆਂ ਗਈਆਂ ਸਨ।',
        'li_beyond_3': '<strong>ਕੋਈ ਕਾਨੂੰਨੀ ਨਤੀਜਾ।</strong> ਕੀ ਸਬੂਤ ਅਪੀਲ, ਰਿਫੰਡ, ਜਾਂ ਅਦਾਲਤੀ ਮਾਮਲੇ ਦਾ ਸਮਰਥਨ ਕਰਦਾ ਹੈ ਇਹ ਸਮੀਖਿਅਕ ਦਾ ਫੈਸਲਾ ਹੈ। ParkProof ਇੱਕ ਟੂਲ ਹੈ, ਵਕੀਲ ਨਹੀਂ।',
        'h2_why': 'ਇਹ ਕਿਉਂ ਮੌਜੂਦ ਹੈ',
        'p_why_1': '"ਸਬੂਤ" ਬਣਾਉਣ ਵਾਲੇ ਜ਼ਿਆਦਾਤਰ ਪਾਰਕਿੰਗ ਐਪ ਸਕ੍ਰੀਨਸ਼ਾਟ ਬਣਾਉਂਦੇ ਹਨ। ਸਕ੍ਰੀਨਸ਼ਾਟ ਦੀ ਕੋਈ ਅਖੰਡਤਾ ਕਹਾਣੀ ਨਹੀਂ ਹੈ — ਉਹਨਾਂ ਨੂੰ ਲਏ ਜਾਣ ਅਤੇ ਭੇਜੇ ਜਾਣ ਦੇ ਵਿਚਕਾਰ ਕਿਸੇ ਵੀ ਸਮੇਂ ਸੰਪਾਦਿਤ ਕੀਤਾ ਜਾ ਸਕਦਾ ਸੀ। ਕ੍ਰਿਪਟੋਗ੍ਰਾਫਿਕ ਹਸਤਾਖਰ <em>"ਇਹ ਮੈਂ ਦੇਖਿਆ"</em> ਅਤੇ <em>"ਇਹ ਮੈਂ ਦੇਖਿਆ, ਅਤੇ ਇਹ ਗਣਿਤਿਕ ਸਬੂਤ ਹੈ ਕਿ ਮੈਂ ਉਸ ਤੋਂ ਬਾਅਦ ਇਸਨੂੰ ਨਹੀਂ ਬਦਲਿਆ"</em> ਵਿਚਕਾਰ ਫਰਕ ਹੈ।',
        'p_why_2': 'ਜਨਤਕ ਕੁੰਜੀ ਪ੍ਰਕਾਸ਼ਿਤ ਹੈ ਤਾਂ ਜੋ ਪੁਸ਼ਟੀਕਰਣ ਪੂਰੀ ਤਰ੍ਹਾਂ ਔਫਲਾਈਨ ਹੋਵੇ — ਅਖੰਡਤਾ ਦਾਅਵੇ ਦੀ ਪੁਸ਼ਟੀ ਕਰਨ ਲਈ ਤੁਹਾਨੂੰ ParkProof ਤੇ ਭਰੋਸਾ ਕਰਨ, ਸਾਡੇ ਸਰਵਰ ਨਾਲ ਸੰਪਰਕ ਕਰਨ, ਜਾਂ ਸਾਡੀ ਐਪ ਚਲਾਉਣ ਦੀ ਲੋੜ ਨਹੀਂ ਹੈ। ਜੇ ParkProof ਹੁਣ ਨਹੀਂ ਰੱਖੀ ਜਾਂਦੀ ਤਾਂ ਵੀ ਪੁਸ਼ਟੀਕਰਣ ਕਈ ਸਾਲਾਂ ਬਾਅਦ ਕੀਤਾ ਜਾ ਸਕਦਾ ਹੈ, ਜਦੋਂ ਤੱਕ <code>openssl</code> ਮੌਜੂਦ ਹੈ।',
        'h2_questions': 'ਸਵਾਲ?',
        'p_questions': '<a class="link" href="mailto:hello@parkproof.com.au">hello@parkproof.com.au</a> ਤੇ ਈਮੇਲ ਕਰੋ। ਅਸੀਂ ਜਵਾਬ ਦਿੰਦੇ ਹਾਂ।',
        'footer_left': 'parkproof.com.au · ਪੁਸ਼ਟੀਕਰਣ ਪੰਨਾ',
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

  /* Auto-detect chip — mirrors the landing's pp-locale-chip pattern.
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

  <pre><span class="comment"># {c_step_1}
# {c_step_1b}
# {c_step_2}
# {c_step_3}</span>
curl -O https://www.parkproof.com.au/parkproof-public-key.pem

<span class="comment"># {c_step_4}</span>
base64 -d sig.base64 > sig.bin

<span class="comment"># {c_step_5}</span>
openssl dgst -sha256 -verify parkproof-public-key.pem \\
  -signature sig.bin payload.txt</pre>

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

<!-- Auto-detect chip — nudges visitors whose browser language differs
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


def main():
    for locale in LOCALES:
        t = TRANSLATIONS[locale]
        out_dir = VERIFY_DIR if locale == 'en' else VERIFY_DIR / locale
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / 'index.html'

        # English's assets are 1 level up (verify/index.html -> ../assets/),
        # other locales are 2 levels up (verify/ko/index.html -> ../../assets/).
        asset_prefix = '../assets/' if locale == 'en' else '../../assets/'

        rendered = TEMPLATE.format(
            lang=locale,
            asset_prefix=asset_prefix,
            locale_switcher=render_locale_switcher(locale, asset_prefix),
            **t,
        )

        out_path.write_text(rendered, encoding='utf-8')
        print(f'wrote {out_path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
