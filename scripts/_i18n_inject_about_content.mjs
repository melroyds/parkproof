/**
 * Inject the full About-page content into the 6 non-English locales.
 *
 * Translations written with these constraints (matching the English style guide
 * pinned in src/components/AboutFeatures.tsx):
 *   - Friendly / second-person register (tu / 你 / आप as the locale dictates)
 *   - Short sentences, conversational rhythm
 *   - No tech-jargon transplants — translate meaning, not literal words
 *   - Keep the brand and language-name proper nouns ASCII / native
 *     (ParkProof, EasyPark, PayStay; 中文 stays 中文 in zh-CN copy because
 *     listing one's own language under its English name reads odd)
 *
 * Idempotent — only writes missing keys. Re-runnable.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LOC = join(ROOT, 'src', 'locales')

const T = {
  'zh-CN': {
    title: 'ParkProof 的全部功能',
    lead: '你大概以为它只是一个停车标志翻译器。它确实是这个。但同时，我们还顺便帮你保存停车证据，以防遇到不公正的罚单。如果真的收到罚单，它还能帮你写申诉信，并在停车时间到期前提醒你挪车。下面是友好的功能介绍。',
    scan: {
      title: '拍下标志，得到答案',
      lead: '用手机对准任何停车标志拍照 — 哪怕是那种堆满箭头和清空区标识的复杂牌子。',
      items: [
        '大约 10 秒内就能给你一个明确的"能停"或"不能停"。',
        '如果标志对马路两侧有不同规定，我们会直接问你停在哪一侧。',
        '在调用 AI 之前，我们会先检查照片是否模糊或太暗 — 帮你省一次试错。',
      ],
    },
    evidence: {
      title: '你的停车凭证',
      lead: '每次登记停车，我们都会保存时间、GPS、地址，以及（如果你愿意）一张你的车在停车位的照片。',
      items: [
        '可以下载为整齐的 PDF — 万一需要申诉罚单时非常有用。',
        '记录使用数字签名加密 — 没人能事后篡改，包括我们自己。',
        '添加一段说明为什么停在那里（送妈妈看病、赶周六市集）— 这些细节会影响市政府的判断。',
      ],
    },
    reminders: {
      title: '在停车时间结束前提醒你',
      lead: '自选提醒时间 — 提前 30 分钟、15 分钟、5 分钟，怎么舒服怎么来。',
      items: [
        '会自动在你的手机日历里添加事件 — 即使没打开 ParkProof 也会提醒你。',
        '主屏上有实时倒计时 — 时间充裕时是绿色，临近时变橙色，必须立刻挪车时变红色。',
        '忘了车停在哪？点"返回停车点"，你的地图应用就会带你回去。',
      ],
    },
    gates: {
      title: '温柔地提醒你"等一下"',
      lead: '这些小检查能避免你拿到完全没预料到的罚单。',
      items: [
        '如果这个车位需要付费（仪表、EasyPark、PayStay），我们会让你先勾选"已付款"再保存。',
        '如果是残疾人专用车位，我们会显示一个明显的红色警告。',
        '停在完全没有标志的地方？你还是可以登记 — 拍一张周围环境的照片作为证据。',
      ],
    },
    appeal: {
      title: '万一还是收到罚单？',
      lead: '别自己写申诉信。我们来帮你写。',
      items: [
        '拍下罚单。我们会用你停车时保存的记录核对一遍。',
        '你会得到一份写给市政府的草稿信，外加一个对胜诉机会的诚实评估。',
        '想怎么改就怎么改，然后下载为附带停车记录的 PDF。打印邮寄或者发邮件都行。',
      ],
    },
    kindnesses: {
      title: '几个贴心的小细节',
      lead: '那些本不该让你操心的事情，我们替你想到了。',
      items: [
        '免费。不用从应用商店下载。加到主屏，用起来就跟正常 App 一样 — 离线也能用。',
        '支持 7 种语言，包括 简体中文、Tiếng Việt、Italiano、Ελληνικά、हिन्दी 和 ਪੰਜਾਬੀ。',
        '时间始终匹配停车地点 — 出差时在悉尼扫描标志，看到的就是悉尼时间，不是你手机的家乡时间。',
        '不用注册账号就能使用全部功能。匿名也完全没问题。',
      ],
    },
    signIn: {
      title: '如果你愿意，可以注册账号',
      lead: '可选。注册之后，你的记录可以在多个设备之间同步。',
      items: [
        '用邮箱、Apple ID 或 Google 账号登录。',
        '每一次停车记录都会同步到云端 — 即使手机坏了，证据也还在。',
        '一键下载所有记录。如果你改主意了，也可以一键删除所有记录和账号。',
      ],
    },
    footerNote: '在墨尔本制作。',
    sourceOnGitHub: '在 GitHub 上查看源代码 →',
    connectOnLinkedIn: '在 LinkedIn 上联系 →',
    cta: '马上试试 — 扫描一个停车标志',
  },

  vi: {
    title: 'Mọi thứ ParkProof có thể làm',
    lead: 'Bạn có lẽ đến đây với suy nghĩ ồ, nó đọc biển báo đỗ xe. Đúng là nó làm vậy. Nhưng nhân tiện, chúng tôi cũng lưu lại bằng chứng phòng khi bạn bị phạt oan, viết thư khiếu nại giúp bạn nếu cần, và nhắc bạn dời xe trước khi hết giờ. Đây là tour giới thiệu thân thiện.',
    scan: {
      title: 'Chụp biển báo, nhận câu trả lời',
      lead: 'Đưa điện thoại lên bất kỳ biển báo đỗ xe nào — kể cả những biển báo lộn xộn với mũi tên và khu vực cấm.',
      items: [
        'Bạn nhận được câu trả lời rõ ràng có hoặc không trong khoảng 10 giây.',
        'Nếu biển báo có quy định khác nhau cho từng bên đường, chúng tôi sẽ hỏi bạn đang đậu bên nào.',
        'Chúng tôi kiểm tra xem ảnh có quá mờ hay quá tối không trước khi gọi AI — tiết kiệm cho bạn một lần thử thất bại.',
      ],
    },
    evidence: {
      title: 'Biên lai cho chỗ đậu xe của bạn',
      lead: 'Mỗi lần đậu xe được ghi lại đều lưu thời gian, GPS, địa chỉ, và (nếu bạn muốn) một ảnh xe của bạn tại chỗ.',
      items: [
        'Tải xuống toàn bộ dưới dạng PDF gọn gàng — tiện lợi nếu bạn cần khiếu nại vé phạt.',
        'Hồ sơ được ký bằng dấu kỹ thuật số nên không ai có thể nói nó bị sửa sau đó — kể cả chúng tôi.',
        'Thêm ghi chú về lý do bạn đậu ở đó (đưa mẹ đi viện, đi chợ Thứ Bảy) — hội đồng thành phố coi trọng bối cảnh.',
      ],
    },
    reminders: {
      title: 'Nhắc nhở trước khi hết giờ',
      lead: 'Chọn lúc bạn muốn được nhắc — 30 phút trước, 15 phút, 5 phút, tuỳ bạn thấy phù hợp.',
      items: [
        'Tạo sự kiện trong lịch điện thoại của bạn để lời nhắc vang lên ngay cả khi ParkProof không mở.',
        'Hiển thị bộ đếm ngược trực tiếp trên màn hình chính — xanh khi còn nhiều thời gian, vàng khi sắp hết, đỏ khi bạn thực sự cần dời xe.',
        'Quên chỗ đậu xe? Nhấn Quay lại xe và ứng dụng bản đồ sẽ chỉ đường cho bạn.',
      ],
    },
    gates: {
      title: 'Một lời nhắc nhẹ nhàng khoan đã',
      lead: 'Những kiểm tra nhỏ ngăn bạn không bị phạt mà không hề hay biết.',
      items: [
        'Nếu ô đậu cần trả phí (đồng hồ đo, EasyPark, PayStay), chúng tôi sẽ yêu cầu bạn xác nhận đã trả tiền trước khi lưu.',
        'Nếu ô đậu dành riêng cho người khuyết tật, chúng tôi hiện một cảnh báo đỏ rõ ràng.',
        'Đậu ở chỗ hoàn toàn không có biển báo? Bạn vẫn có thể ghi lại — kèm ảnh môi trường xung quanh để chứng minh thực sự không có biển nào.',
      ],
    },
    appeal: {
      title: 'Vẫn bị phạt rồi?',
      lead: 'Đừng tự viết thư khiếu nại. Chúng tôi sẽ viết cho bạn.',
      items: [
        'Chụp ảnh vé phạt. Chúng tôi sẽ đối chiếu với hồ sơ đã lưu khi bạn đậu xe.',
        'Bạn nhận được bản nháp thư gửi hội đồng, kèm đánh giá trung thực về độ mạnh của trường hợp của bạn.',
        'Chỉnh sửa thoải mái, rồi tải xuống dưới dạng PDF kèm hồ sơ đậu xe. In gửi bưu điện, hoặc gửi email.',
      ],
    },
    kindnesses: {
      title: 'Một vài điều nhỏ chu đáo',
      lead: 'Những điều đáng ra bạn không phải lo, chúng tôi đã lo cho bạn rồi.',
      items: [
        'Miễn phí. Không cần kho ứng dụng. Thêm vào màn hình chính và nó hoạt động như một ứng dụng bình thường — kể cả khi không có mạng.',
        'Có sẵn 7 ngôn ngữ bao gồm 中文, Tiếng Việt, Italiano, Ελληνικά, हिन्दी và ਪੰਜਾਬੀ.',
        'Thời gian luôn khớp với chỗ đậu xe — quét ở Sydney khi đi du lịch, bạn thấy giờ Sydney. Không phải giờ nhà của điện thoại.',
        'Bạn không cần đăng nhập để dùng bất kỳ tính năng nào. Ẩn danh cũng hoạt động tốt.',
      ],
    },
    signIn: {
      title: 'Đăng nhập nếu bạn muốn',
      lead: 'Tùy chọn. Nếu đăng nhập, hồ sơ của bạn sẽ đi theo bạn qua các thiết bị.',
      items: [
        'Đăng nhập bằng email, Apple ID, hoặc tài khoản Google.',
        'Mỗi lần đậu xe đều được sao lưu lên đám mây — nếu điện thoại hỏng, bằng chứng vẫn còn đó.',
        'Một chạm để tải về mọi hồ sơ. Một chạm để xóa mọi hồ sơ và tài khoản, nếu bạn đổi ý.',
      ],
    },
    footerNote: 'Được xây dựng tại Melbourne.',
    sourceOnGitHub: 'Mã nguồn trên GitHub →',
    connectOnLinkedIn: 'Kết nối trên LinkedIn →',
    cta: 'Thử ngay — quét một biển báo',
  },

  it: {
    title: 'Tutto quello che fa ParkProof',
    lead: 'Probabilmente sei qui pensando ah, legge i cartelli di parcheggio. È vero. Ma già che c\'eravamo, abbiamo deciso di salvare anche le prove nel caso tu prenda una multa ingiusta, scriverti la lettera di ricorso se serve, e ricordarti di spostare la macchina prima che scada il tempo. Ecco il tour amichevole.',
    scan: {
      title: 'Fotografa un cartello, ottieni una risposta',
      lead: 'Punta il telefono su qualsiasi cartello di parcheggio — anche quelli incasinati con frecce e zone di rimozione.',
      items: [
        'Ricevi un sì o no chiaro in circa 10 secondi.',
        'Se il cartello ha regole diverse per i due lati della strada, ti chiediamo semplicemente da che parte sei.',
        'Controlliamo se la foto è troppo sfocata o scura prima ancora di chiamare l\'AI — ti risparmiamo un tentativo sprecato.',
      ],
    },
    evidence: {
      title: 'Una ricevuta per il tuo parcheggio',
      lead: 'Ogni parcheggio che registri salva l\'orario, il GPS, l\'indirizzo, e (se vuoi) una foto della tua auto sul posto.',
      items: [
        'Scarica tutto come PDF ordinato — comodo se mai dovrai contestare una multa.',
        'È firmato con un sigillo digitale, quindi nessuno può sostenere che sia stato modificato dopo — nemmeno noi.',
        'Aggiungi una nota sul perché hai parcheggiato lì (mamma in ospedale, mercato del sabato) — i comuni considerano il contesto.',
      ],
    },
    reminders: {
      title: 'Un promemoria prima che scada il tempo',
      lead: 'Scegli quando vuoi essere avvisato — 30 minuti prima, 15, 5, come ti senti meglio.',
      items: [
        'Aggiunge un evento al calendario del telefono, così il promemoria suona anche se ParkProof non è aperto.',
        'Mostra un conto alla rovescia in tempo reale nella schermata principale — verde quando hai tempo, ambra quando ti stai avvicinando, rosso quando devi davvero muoverti.',
        'Hai dimenticato dove hai parcheggiato? Tocca Torna all\'auto e l\'app mappe ti mostra la strada.',
      ],
    },
    gates: {
      title: 'Un gentile aspetta un attimo',
      lead: 'I piccoli controlli che ti evitano una multa che non avresti previsto.',
      items: [
        'Se lo stallo richiede pagamento (parchimetro, EasyPark, PayStay), ti chiediamo di confermare il pagamento prima di salvare.',
        'Se lo stallo è riservato ai permessi disabili, mostriamo un avviso rosso ben visibile.',
        'Hai parcheggiato dove non ci sono cartelli? Puoi comunque registrarlo — con una foto dell\'ambiente circostante a dimostrare che davvero non ce n\'erano.',
      ],
    },
    appeal: {
      title: 'Hai preso una multa lo stesso?',
      lead: 'Non scrivere il ricorso da solo. Lo scriviamo noi per te.',
      items: [
        'Fotografa la multa. La incroceremo con quello che abbiamo salvato quando hai parcheggiato.',
        'Ricevi una bozza di lettera al comune, più una valutazione onesta di quanto sia forte il tuo caso.',
        'Modifica quello che vuoi, poi scarica come PDF con il registro di parcheggio allegato. Stampa e spedisci, o invia via email.',
      ],
    },
    kindnesses: {
      title: 'Qualche piccola gentilezza',
      lead: 'Le cose a cui non dovresti dover pensare, e a cui abbiamo pensato per te.',
      items: [
        'Gratis. Niente app store. Aggiungilo alla schermata principale e funziona come una normale app — anche offline.',
        'Disponibile in 7 lingue tra cui 中文, Tiếng Việt, Italiano, Ελληνικά, हिन्दी e ਪੰਜਾਬੀ.',
        'L\'ora corrisponde sempre al luogo di parcheggio — scansiona a Sydney mentre sei in viaggio, vedi l\'ora di Sydney. Non quella del tuo telefono.',
        'Non devi accedere per usare nessuna di queste funzioni. L\'anonimo va benissimo.',
      ],
    },
    signIn: {
      title: 'Accedi se vuoi',
      lead: 'Opzionale. Se lo fai, i tuoi dati ti seguono tra i dispositivi.',
      items: [
        'Accedi con email, il tuo ID Apple, o il tuo account Google.',
        'Ogni parcheggio che salvi viene rispecchiato sul cloud — se il telefono si rompe, le prove sono ancora lì.',
        'Un tocco per scaricare ogni registro. Un tocco per cancellare ogni registro e il tuo account, se cambi idea.',
      ],
    },
    footerNote: 'Realizzato a Melbourne.',
    sourceOnGitHub: 'Codice sorgente su GitHub →',
    connectOnLinkedIn: 'Collegati su LinkedIn →',
    cta: 'Provalo — scansiona un cartello',
  },

  el: {
    title: 'Όλα όσα κάνει το ParkProof',
    lead: 'Πιθανότατα ήρθες εδώ σκεπτόμενος α, διαβάζει πινακίδες στάθμευσης. Όντως το κάνει. Αλλά μια που είμαστε εδώ, σκεφτήκαμε να αποθηκεύουμε και τα στοιχεία σε περίπτωση που πάρεις άδικη κλήση, να γράφουμε την ένσταση για σένα αν χρειαστεί, και να σου θυμίζουμε να μετακινήσεις το αυτοκίνητο πριν τελειώσει ο χρόνος. Να η φιλική περιήγηση.',
    scan: {
      title: 'Φωτογράφισε μια πινακίδα, πάρε απάντηση',
      lead: 'Στρέψε το κινητό σε οποιαδήποτε πινακίδα στάθμευσης — ακόμη και στις μπερδεμένες με βέλη και ζώνες απαγόρευσης.',
      items: [
        'Παίρνεις ένα ξεκάθαρο ναι ή όχι σε περίπου 10 δευτερόλεπτα.',
        'Αν η πινακίδα έχει διαφορετικούς κανόνες για κάθε πλευρά του δρόμου, απλά σε ρωτάμε σε ποια πλευρά είσαι.',
        'Ελέγχουμε αν η φωτογραφία είναι θολή ή πολύ σκοτεινή πριν καν ρωτήσουμε το AI — σου γλιτώνει μια χαμένη προσπάθεια.',
      ],
    },
    evidence: {
      title: 'Μια απόδειξη για τη θέση στάθμευσής σου',
      lead: 'Κάθε στάθμευση που καταγράφεις αποθηκεύει την ώρα, το GPS, τη διεύθυνση, και (αν θες) μια φωτογραφία του αυτοκινήτου σου στη θέση.',
      items: [
        'Κατέβασε όλο το πακέτο ως ένα προσεγμένο PDF — χρήσιμο αν χρειαστεί να αμφισβητήσεις μια κλήση.',
        'Είναι υπογεγραμμένο με ψηφιακή σφραγίδα, οπότε κανείς δεν μπορεί να ισχυριστεί ότι τροποποιήθηκε αργότερα — ούτε εμείς.',
        'Πρόσθεσε μια σημείωση για το γιατί στάθμευσες εκεί (η μαμά στο νοσοκομείο, η αγορά του Σαββάτου) — οι δήμοι δίνουν σημασία στο πλαίσιο.',
      ],
    },
    reminders: {
      title: 'Μια υπενθύμιση πριν τελειώσει ο χρόνος',
      lead: 'Διάλεξε πότε θες να σε ειδοποιήσουμε — 30 λεπτά πριν, 15, 5, όπως νιώθεις άνετα.',
      items: [
        'Προσθέτει ένα συμβάν στο ημερολόγιο του κινητού σου, ώστε η υπενθύμιση να χτυπήσει ακόμη και αν το ParkProof δεν είναι ανοιχτό.',
        'Εμφανίζει ζωντανή αντίστροφη μέτρηση στην αρχική οθόνη — πράσινο όταν έχεις χρόνο, πορτοκαλί όταν πλησιάζεις, κόκκινο όταν πρέπει πραγματικά να φύγεις.',
        'Ξέχασες πού στάθμευσες; Πάτα Επιστροφή στο αυτοκίνητο και η εφαρμογή χαρτών θα σε οδηγήσει.',
      ],
    },
    gates: {
      title: 'Ένα ευγενικό περίμενε μια στιγμή',
      lead: 'Οι μικροί έλεγχοι που σε εμποδίζουν να πάρεις μια κλήση που δεν περίμενες.',
      items: [
        'Αν η θέση χρειάζεται πληρωμή (παρκόμετρο, EasyPark, PayStay), σου ζητάμε να επιβεβαιώσεις ότι πλήρωσες πριν αποθηκεύσουμε.',
        'Αν η θέση είναι αποκλειστική για άδειες αναπηρίας, εμφανίζουμε ένα έντονο κόκκινο μήνυμα.',
        'Στάθμευσες κάπου χωρίς πινακίδες; Μπορείς ακόμη να το καταγράψεις — με μια φωτογραφία του περιβάλλοντος να αποδεικνύει ότι όντως δεν υπήρχαν.',
      ],
    },
    appeal: {
      title: 'Πήρες κλήση παρόλα αυτά;',
      lead: 'Μην γράψεις την ένσταση μόνος σου. Θα τη γράψουμε για σένα.',
      items: [
        'Φωτογράφισε την κλήση. Θα τη διασταυρώσουμε με αυτό που αποθηκεύσαμε όταν στάθμευσες.',
        'Παίρνεις ένα προσχέδιο επιστολής προς τον δήμο, μαζί με μια ειλικρινή αξιολόγηση για το πόσο δυνατή είναι η υπόθεσή σου.',
        'Επεξεργάσου ό,τι θέλεις, και κατέβασέ το ως PDF μαζί με το αρχείο στάθμευσης. Τύπωσε και ταχυδρόμησε, ή στείλε email.',
      ],
    },
    kindnesses: {
      title: 'Κάποιες μικρές ευγένειες',
      lead: 'Τα πράγματα για τα οποία δεν θα έπρεπε να σκέφτεσαι, και που σκεφτήκαμε εμείς για σένα.',
      items: [
        'Δωρεάν. Χωρίς app store. Πρόσθεσέ το στην αρχική σου οθόνη και λειτουργεί σαν κανονική εφαρμογή — ακόμη και χωρίς σύνδεση.',
        'Διαθέσιμο σε 7 γλώσσες όπως 中文, Tiếng Việt, Italiano, Ελληνικά, हिन्दी και ਪੰਜਾਬੀ.',
        'Η ώρα ταιριάζει πάντα με τη θέση στάθμευσης — αν σκανάρεις στο Σίδνεϊ ενώ ταξιδεύεις, βλέπεις την ώρα του Σίδνεϊ. Όχι του κινητού σου.',
        'Δεν χρειάζεται να συνδεθείς για να χρησιμοποιήσεις τίποτα από αυτά. Η ανώνυμη χρήση δουλεύει μια χαρά.',
      ],
    },
    signIn: {
      title: 'Συνδέσου αν θέλεις',
      lead: 'Προαιρετικό. Αν συνδεθείς, τα αρχεία σου σε ακολουθούν στις συσκευές σου.',
      items: [
        'Συνδέσου με email, το Apple ID σου, ή τον λογαριασμό σου Google.',
        'Κάθε στάθμευση που αποθηκεύεις αντικατοπτρίζεται στο cloud — αν το κινητό σου χαλάσει, τα στοιχεία είναι ακόμη εκεί.',
        'Ένα πάτημα για κατέβασμα όλων των εγγραφών. Ένα πάτημα για διαγραφή όλων των εγγραφών και του λογαριασμού σου, αν αλλάξεις γνώμη.',
      ],
    },
    footerNote: 'Φτιαγμένο στη Μελβούρνη.',
    sourceOnGitHub: 'Πηγαίος κώδικας στο GitHub →',
    connectOnLinkedIn: 'Σύνδεση στο LinkedIn →',
    cta: 'Δοκίμασέ το — σκάναρε μια πινακίδα',
  },

  hi: {
    title: 'ParkProof जो भी कर सकता है',
    lead: 'आप शायद यह सोचकर यहाँ आए हैं कि अरे, यह पार्किंग साइन पढ़ता है। हाँ, यह वही करता है। लेकिन इसी मौके पर, हमने सोचा क्यों न आपकी पार्किंग का सबूत भी सहेज लें ताकि अगर कभी गलत चालान मिले, तो आपके लिए अपील पत्र भी लिख दें, और समय खत्म होने से पहले गाड़ी हटाने की याद दिला दें। यह रहा दोस्ताना परिचय।',
    scan: {
      title: 'साइन की फोटो लो, जवाब पाओ',
      lead: 'किसी भी पार्किंग साइन पर अपना फोन तानें — चाहे वो तीरों और क्लीयरवे से भरा गड़बड़ साइन ही क्यों न हो।',
      items: [
        'लगभग 10 सेकंड में आपको साफ हाँ या ना का जवाब मिल जाता है।',
        'अगर साइन में सड़क के दोनों तरफ अलग नियम हैं, तो हम बस पूछ लेंगे आप किस तरफ हैं।',
        'AI को पूछने से पहले हम चेक करते हैं कि फोटो धुंधली या ज्यादा अंधेरी तो नहीं — एक बेकार कोशिश से बचा लेते हैं।',
      ],
    },
    evidence: {
      title: 'आपकी पार्किंग की रसीद',
      lead: 'हर पार्किंग जो आप दर्ज करते हैं, समय, GPS, पता, और (अगर आप चाहें) उस जगह पर आपकी कार की फोटो सहेजती है।',
      items: [
        'पूरी रिकॉर्ड एक साफ-सुथरे PDF में डाउनलोड करें — चालान का विरोध करने में बहुत काम आती है।',
        'यह एक डिजिटल मुहर से हस्ताक्षरित है, इसलिए कोई यह नहीं कह सकता कि बाद में बदला गया है — हम भी नहीं।',
        'जोड़ें कि आपने वहाँ क्यों पार्क किया (माँ की अस्पताल यात्रा, शनिवार का बाज़ार) — नगर निगम संदर्भ को गंभीरता से लेते हैं।',
      ],
    },
    reminders: {
      title: 'समय खत्म होने से पहले याद दिलाना',
      lead: 'चुनें कब याद दिलाना है — 30 मिनट पहले, 15, 5, जो भी सही लगे।',
      items: [
        'आपके फोन कैलेंडर में एक इवेंट जोड़ देता है ताकि याद ParkProof खुला न होने पर भी बजे।',
        'होम स्क्रीन पर लाइव काउंटडाउन दिखाता है — समय हो तो हरा, करीब आ रहा हो तो नारंगी, अब तुरंत हटाना हो तो लाल।',
        'भूल गए गाड़ी कहाँ खड़ी है? वापस कार तक पर टैप करें और आपका मैप ऐप रास्ता दिखाएगा।',
      ],
    },
    gates: {
      title: 'एक नरम ज़रा रुकिए',
      lead: 'छोटे चेक जो आपको ऐसा चालान पाने से बचाते हैं जिसकी आपने उम्मीद नहीं की थी।',
      items: [
        'अगर जगह के लिए पैसे देने हैं (मीटर, EasyPark, PayStay), तो हम आपसे सहेजने से पहले पुष्टि करवाएंगे कि आपने भुगतान किया है।',
        'अगर जगह विकलांगता परमिट के लिए आरक्षित है, तो हम एक साफ लाल चेतावनी दिखाते हैं।',
        'कहीं ऐसी जगह पार्क किया जहाँ कोई साइन नहीं है? आप फिर भी दर्ज कर सकते हैं — आस-पास की फोटो के साथ यह दिखाने के लिए कि वाकई कुछ नहीं था।',
      ],
    },
    appeal: {
      title: 'फिर भी चालान मिल गया?',
      lead: 'विरोध पत्र खुद मत लिखिए। हम आपके लिए लिख देंगे।',
      items: [
        'चालान की फोटो लें। हम पार्किंग के समय जो सहेजा था उसके साथ क्रॉस-चेक करेंगे।',
        'आपको नगर निगम को भेजने के लिए एक मसौदा पत्र मिलेगा, साथ ही आपके मामले की मजबूती का एक ईमानदार आकलन।',
        'जो चाहें संपादित करें, फिर पार्किंग रिकॉर्ड के साथ PDF के रूप में डाउनलोड करें। प्रिंट कर डाक से भेजें, या ईमेल करें।',
      ],
    },
    kindnesses: {
      title: 'कुछ छोटी सी सुविधाएं',
      lead: 'वो चीज़ें जिनके बारे में आपको नहीं सोचना चाहिए, और जो हमने आपके लिए सोच ली हैं।',
      items: [
        'मुफ़्त। ऐप स्टोर की ज़रूरत नहीं। होम स्क्रीन पर जोड़ें और यह सामान्य ऐप की तरह काम करता है — ऑफ़लाइन भी।',
        '7 भाषाओं में उपलब्ध जिनमें 中文, Tiếng Việt, Italiano, Ελληνικά, हिन्दी और ਪੰਜਾਬੀ शामिल हैं।',
        'समय हमेशा पार्किंग की जगह के अनुसार होता है — यात्रा के दौरान सिडनी में स्कैन करें, आपको सिडनी का समय दिखेगा। आपके फोन के घर का नहीं।',
        'इनमें से कुछ भी उपयोग करने के लिए आपको साइन इन करने की ज़रूरत नहीं है। अनाम मोड बिल्कुल ठीक काम करता है।',
      ],
    },
    signIn: {
      title: 'अगर आप चाहें तो साइन इन करें',
      lead: 'वैकल्पिक। अगर करते हैं, तो आपके रिकॉर्ड आपके सभी डिवाइसों में रहते हैं।',
      items: [
        'ईमेल, अपने Apple ID, या अपने Google खाते से साइन इन करें।',
        'हर पार्किंग जो आप सहेजते हैं वो क्लाउड में बैकअप होती है — फोन खराब हो जाए तो भी आपका सबूत वहीं रहेगा।',
        'सभी रिकॉर्ड डाउनलोड करने के लिए एक टैप। अगर मन बदल जाए तो सभी रिकॉर्ड और अकाउंट हटाने के लिए भी एक टैप।',
      ],
    },
    footerNote: 'मेलबर्न में बनाया गया।',
    sourceOnGitHub: 'GitHub पर सोर्स कोड →',
    connectOnLinkedIn: 'LinkedIn पर जुड़ें →',
    cta: 'अभी आज़माएं — एक साइन स्कैन करें',
  },

  pa: {
    title: 'ParkProof ਜੋ ਵੀ ਕਰ ਸਕਦਾ ਹੈ',
    lead: 'ਤੁਸੀਂ ਸ਼ਾਇਦ ਇਹ ਸੋਚ ਕੇ ਇੱਥੇ ਆਏ ਹੋ ਕਿ ਆਹ, ਇਹ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਪੜ੍ਹਦਾ ਹੈ। ਹਾਂ, ਇਹ ਉਹੀ ਕਰਦਾ ਹੈ। ਪਰ ਇਸ ਮੌਕੇ ’ਤੇ, ਅਸੀਂ ਸੋਚਿਆ ਕਿਉਂ ਨਾ ਤੁਹਾਡੀ ਪਾਰਕਿੰਗ ਦਾ ਸਬੂਤ ਵੀ ਸੰਭਾਲ ਲਈਏ, ਜੇ ਕਦੇ ਗਲਤ ਚਾਲਾਨ ਮਿਲੇ ਤਾਂ ਤੁਹਾਡੇ ਲਈ ਅਪੀਲ ਪੱਤਰ ਵੀ ਲਿਖ ਦੇਈਏ, ਅਤੇ ਸਮਾਂ ਖਤਮ ਹੋਣ ਤੋਂ ਪਹਿਲਾਂ ਗੱਡੀ ਹਟਾਉਣ ਦੀ ਯਾਦ ਦਿਵਾਈਏ। ਇਹ ਰਹੀ ਦੋਸਤਾਨਾ ਜਾਣ-ਪਛਾਣ।',
    scan: {
      title: 'ਚਿੰਨ੍ਹ ਦੀ ਫੋਟੋ ਲਓ, ਜਵਾਬ ਲਓ',
      lead: 'ਕਿਸੇ ਵੀ ਪਾਰਕਿੰਗ ਚਿੰਨ੍ਹ ਉੱਤੇ ਆਪਣਾ ਫੋਨ ਤਾਣੋ — ਚਾਹੇ ਤੀਰਾਂ ਅਤੇ ਕਲੀਅਰਵੇ ਨਾਲ ਭਰੀ ਉਲਝੀ ਪੱਥਰੀ ਹੀ ਕਿਉਂ ਨਾ ਹੋਵੇ।',
      items: [
        'ਲਗਭਗ 10 ਸਕਿੰਟਾਂ ਵਿੱਚ ਤੁਹਾਨੂੰ ਸਾਫ਼ ਹਾਂ ਜਾਂ ਨਾਂ ਮਿਲ ਜਾਂਦਾ ਹੈ।',
        'ਜੇ ਚਿੰਨ੍ਹ ਵਿੱਚ ਸੜਕ ਦੇ ਦੋਵੇਂ ਪਾਸੇ ਵੱਖਰੇ ਨਿਯਮ ਹਨ, ਤਾਂ ਅਸੀਂ ਬੱਸ ਪੁੱਛ ਲਵਾਂਗੇ ਕਿ ਤੁਸੀਂ ਕਿਹੜੇ ਪਾਸੇ ਹੋ।',
        'AI ਨੂੰ ਪੁੱਛਣ ਤੋਂ ਪਹਿਲਾਂ ਅਸੀਂ ਜਾਂਚਦੇ ਹਾਂ ਕਿ ਫੋਟੋ ਧੁੰਦਲੀ ਜਾਂ ਜ਼ਿਆਦਾ ਹਨੇਰੀ ਤਾਂ ਨਹੀਂ — ਇੱਕ ਬੇਕਾਰ ਕੋਸ਼ਿਸ਼ ਤੋਂ ਬਚਾ ਲੈਂਦੇ ਹਾਂ।',
      ],
    },
    evidence: {
      title: 'ਤੁਹਾਡੀ ਪਾਰਕਿੰਗ ਦੀ ਰਸੀਦ',
      lead: 'ਹਰ ਪਾਰਕਿੰਗ ਜੋ ਤੁਸੀਂ ਦਰਜ ਕਰਦੇ ਹੋ, ਸਮਾਂ, GPS, ਪਤਾ ਅਤੇ (ਜੇ ਤੁਸੀਂ ਚਾਹੋ) ਉਸ ਜਗ੍ਹਾ ’ਤੇ ਤੁਹਾਡੀ ਕਾਰ ਦੀ ਫੋਟੋ ਸੰਭਾਲਦੀ ਹੈ।',
      items: [
        'ਪੂਰੇ ਰਿਕਾਰਡ ਨੂੰ ਇੱਕ ਸਾਫ਼ PDF ਵਿੱਚ ਡਾਊਨਲੋਡ ਕਰੋ — ਚਾਲਾਨ ’ਤੇ ਇਤਰਾਜ਼ ਕਰਨ ਵੇਲੇ ਬਹੁਤ ਕੰਮ ਆਉਂਦੀ ਹੈ।',
        'ਇਹ ਡਿਜੀਟਲ ਮੋਹਰ ਨਾਲ ਦਸਤਖਤ ਕੀਤਾ ਗਿਆ ਹੈ, ਇਸ ਲਈ ਕੋਈ ਇਹ ਨਹੀਂ ਕਹਿ ਸਕਦਾ ਕਿ ਬਾਅਦ ਵਿੱਚ ਬਦਲਿਆ ਗਿਆ — ਅਸੀਂ ਵੀ ਨਹੀਂ।',
        'ਜੋੜੋ ਕਿ ਤੁਸੀਂ ਉੱਥੇ ਕਿਉਂ ਪਾਰਕ ਕੀਤਾ (ਮਾਂ ਦੀ ਹਸਪਤਾਲ ਫੇਰੀ, ਸ਼ਨੀਵਾਰ ਦਾ ਬਾਜ਼ਾਰ) — ਨਗਰ ਨਿਗਮ ਪ੍ਰਸੰਗ ਨੂੰ ਗੰਭੀਰਤਾ ਨਾਲ ਲੈਂਦੇ ਹਨ।',
      ],
    },
    reminders: {
      title: 'ਸਮਾਂ ਖਤਮ ਹੋਣ ਤੋਂ ਪਹਿਲਾਂ ਯਾਦ ਦਿਵਾਉਣਾ',
      lead: 'ਚੁਣੋ ਕਦੋਂ ਯਾਦ ਦਿਵਾਉਣਾ ਹੈ — 30 ਮਿੰਟ ਪਹਿਲਾਂ, 15, 5, ਜੋ ਵੀ ਸਹੀ ਲੱਗੇ।',
      items: [
        'ਤੁਹਾਡੇ ਫੋਨ ਕੈਲੰਡਰ ਵਿੱਚ ਇੱਕ ਇਵੈਂਟ ਜੋੜ ਦਿੰਦਾ ਹੈ ਤਾਂ ਜੋ ਯਾਦ ParkProof ਖੁੱਲ੍ਹਾ ਨਾ ਹੋਣ ’ਤੇ ਵੀ ਵੱਜੇ।',
        'ਮੁੱਖ ਸਕਰੀਨ ’ਤੇ ਲਾਈਵ ਕਾਊਂਟਡਾਊਨ ਦਿਖਾਉਂਦਾ ਹੈ — ਸਮਾਂ ਹੋਵੇ ਤਾਂ ਹਰਾ, ਨੇੜੇ ਆਉਂਦਾ ਹੋਵੇ ਤਾਂ ਪੀਲਾ, ਹੁਣ ਤੁਰੰਤ ਹਟਾਉਣਾ ਹੋਵੇ ਤਾਂ ਲਾਲ।',
        'ਭੁੱਲ ਗਏ ਗੱਡੀ ਕਿੱਥੇ ਖੜ੍ਹੀ ਹੈ? ਵਾਪਸ ਕਾਰ ਤੱਕ ’ਤੇ ਟੈਪ ਕਰੋ ਅਤੇ ਤੁਹਾਡੀ ਮੈਪ ਐਪ ਰਾਹ ਦਿਖਾਏਗੀ।',
      ],
    },
    gates: {
      title: 'ਇੱਕ ਨਰਮ ਜ਼ਰਾ ਰੁਕੋ',
      lead: 'ਛੋਟੇ ਚੈੱਕ ਜੋ ਤੁਹਾਨੂੰ ਅਜਿਹਾ ਚਾਲਾਨ ਪਾਉਣ ਤੋਂ ਬਚਾਉਂਦੇ ਹਨ ਜਿਸ ਦੀ ਤੁਹਾਨੂੰ ਉਮੀਦ ਨਹੀਂ ਸੀ।',
      items: [
        'ਜੇ ਜਗ੍ਹਾ ਲਈ ਪੈਸੇ ਦੇਣੇ ਹਨ (ਮੀਟਰ, EasyPark, PayStay), ਤਾਂ ਅਸੀਂ ਤੁਹਾਡੇ ਤੋਂ ਸੰਭਾਲਣ ਤੋਂ ਪਹਿਲਾਂ ਪੁਸ਼ਟੀ ਕਰਾਵਾਂਗੇ ਕਿ ਤੁਸੀਂ ਭੁਗਤਾਨ ਕੀਤਾ ਹੈ।',
        'ਜੇ ਜਗ੍ਹਾ ਅਪੰਗਤਾ ਪਰਮਿਟ ਲਈ ਰਾਖਵੀਂ ਹੈ, ਤਾਂ ਅਸੀਂ ਇੱਕ ਸਾਫ਼ ਲਾਲ ਚੇਤਾਵਨੀ ਦਿਖਾਉਂਦੇ ਹਾਂ।',
        'ਕਿਤੇ ਅਜਿਹੀ ਥਾਂ ਪਾਰਕ ਕੀਤਾ ਜਿੱਥੇ ਕੋਈ ਚਿੰਨ੍ਹ ਨਹੀਂ ਹੈ? ਤੁਸੀਂ ਫਿਰ ਵੀ ਦਰਜ ਕਰ ਸਕਦੇ ਹੋ — ਆਲੇ-ਦੁਆਲੇ ਦੀ ਫੋਟੋ ਨਾਲ ਇਹ ਦਿਖਾਉਣ ਲਈ ਕਿ ਸੱਚਮੁੱਚ ਕੁਝ ਨਹੀਂ ਸੀ।',
      ],
    },
    appeal: {
      title: 'ਫਿਰ ਵੀ ਚਾਲਾਨ ਮਿਲ ਗਿਆ?',
      lead: 'ਵਿਰੋਧ ਪੱਤਰ ਖੁਦ ਨਾ ਲਿਖੋ। ਅਸੀਂ ਤੁਹਾਡੇ ਲਈ ਲਿਖ ਦੇਵਾਂਗੇ।',
      items: [
        'ਚਾਲਾਨ ਦੀ ਫੋਟੋ ਲਓ। ਅਸੀਂ ਪਾਰਕਿੰਗ ਦੇ ਸਮੇਂ ਜੋ ਸੰਭਾਲਿਆ ਸੀ ਉਸ ਨਾਲ ਮਿਲਾਨ ਕਰਾਂਗੇ।',
        'ਤੁਹਾਨੂੰ ਨਗਰ ਨਿਗਮ ਨੂੰ ਭੇਜਣ ਲਈ ਇੱਕ ਡਰਾਫਟ ਪੱਤਰ ਮਿਲੇਗਾ, ਨਾਲ ਹੀ ਤੁਹਾਡੇ ਕੇਸ ਦੀ ਮਜ਼ਬੂਤੀ ਦਾ ਇੱਕ ਇਮਾਨਦਾਰ ਅੰਦਾਜ਼ਾ।',
        'ਜੋ ਚਾਹੋ ਸੋਧੋ, ਫਿਰ ਪਾਰਕਿੰਗ ਰਿਕਾਰਡ ਨਾਲ PDF ਵਜੋਂ ਡਾਊਨਲੋਡ ਕਰੋ। ਛਾਪ ਕੇ ਡਾਕ ਨਾਲ ਭੇਜੋ, ਜਾਂ ਈਮੇਲ ਕਰੋ।',
      ],
    },
    kindnesses: {
      title: 'ਕੁਝ ਛੋਟੀਆਂ ਮਿਹਰਬਾਨੀਆਂ',
      lead: 'ਉਹ ਚੀਜ਼ਾਂ ਜਿਨ੍ਹਾਂ ਬਾਰੇ ਤੁਹਾਨੂੰ ਨਹੀਂ ਸੋਚਣਾ ਚਾਹੀਦਾ, ਅਤੇ ਜੋ ਅਸੀਂ ਤੁਹਾਡੇ ਲਈ ਸੋਚ ਲਈਆਂ ਹਨ।',
      items: [
        'ਮੁਫ਼ਤ। ਐਪ ਸਟੋਰ ਦੀ ਲੋੜ ਨਹੀਂ। ਆਪਣੀ ਮੁੱਖ ਸਕਰੀਨ ’ਤੇ ਜੋੜੋ ਅਤੇ ਇਹ ਸਧਾਰਨ ਐਪ ਵਾਂਗ ਕੰਮ ਕਰਦਾ ਹੈ — ਔਫਲਾਈਨ ਵੀ।',
        '7 ਭਾਸ਼ਾਵਾਂ ਵਿੱਚ ਉਪਲਬਧ ਜਿਨ੍ਹਾਂ ਵਿੱਚ 中文, Tiếng Việt, Italiano, Ελληνικά, हिन्दी ਅਤੇ ਪੰਜਾਬੀ ਸ਼ਾਮਲ ਹਨ।',
        'ਸਮਾਂ ਹਮੇਸ਼ਾ ਪਾਰਕਿੰਗ ਥਾਂ ਨਾਲ ਮਿਲਦਾ ਹੈ — ਯਾਤਰਾ ਦੌਰਾਨ ਸਿਡਨੀ ਵਿੱਚ ਸਕੈਨ ਕਰੋ, ਤੁਹਾਨੂੰ ਸਿਡਨੀ ਦਾ ਸਮਾਂ ਦਿਖੇਗਾ। ਤੁਹਾਡੇ ਫੋਨ ਦੇ ਘਰ ਦਾ ਨਹੀਂ।',
        'ਇਨ੍ਹਾਂ ਵਿੱਚੋਂ ਕੁਝ ਵੀ ਵਰਤਣ ਲਈ ਤੁਹਾਨੂੰ ਸਾਈਨ ਇਨ ਕਰਨ ਦੀ ਲੋੜ ਨਹੀਂ। ਅਨਾਮ ਮੋਡ ਬਿਲਕੁਲ ਠੀਕ ਕੰਮ ਕਰਦਾ ਹੈ।',
      ],
    },
    signIn: {
      title: 'ਜੇ ਤੁਸੀਂ ਚਾਹੋ ਤਾਂ ਸਾਈਨ ਇਨ ਕਰੋ',
      lead: 'ਚੋਣਵਾਂ। ਜੇ ਕਰਦੇ ਹੋ, ਤਾਂ ਤੁਹਾਡੇ ਰਿਕਾਰਡ ਤੁਹਾਡੇ ਸਾਰੇ ਡਿਵਾਈਸਾਂ ਵਿੱਚ ਰਹਿੰਦੇ ਹਨ।',
      items: [
        'ਈਮੇਲ, ਆਪਣੀ Apple ID, ਜਾਂ ਆਪਣੇ Google ਖਾਤੇ ਨਾਲ ਸਾਈਨ ਇਨ ਕਰੋ।',
        'ਹਰ ਪਾਰਕਿੰਗ ਜੋ ਤੁਸੀਂ ਸੰਭਾਲਦੇ ਹੋ ਉਹ ਕਲਾਊਡ ’ਤੇ ਬੈਕਅਪ ਹੁੰਦੀ ਹੈ — ਫੋਨ ਖਰਾਬ ਹੋ ਜਾਵੇ ਤਾਂ ਵੀ ਤੁਹਾਡਾ ਸਬੂਤ ਉੱਥੇ ਰਹੇਗਾ।',
        'ਸਾਰੇ ਰਿਕਾਰਡ ਡਾਊਨਲੋਡ ਕਰਨ ਲਈ ਇੱਕ ਟੈਪ। ਜੇ ਮਨ ਬਦਲ ਜਾਵੇ ਤਾਂ ਸਾਰੇ ਰਿਕਾਰਡ ਅਤੇ ਖਾਤਾ ਮਿਟਾਉਣ ਲਈ ਵੀ ਇੱਕ ਟੈਪ।',
      ],
    },
    footerNote: 'ਮੈਲਬਰਨ ਵਿੱਚ ਬਣਾਇਆ ਗਿਆ।',
    sourceOnGitHub: 'GitHub ’ਤੇ ਸੋਰਸ ਕੋਡ →',
    connectOnLinkedIn: 'LinkedIn ’ਤੇ ਜੁੜੋ →',
    cta: 'ਹੁਣੇ ਅਜ਼ਮਾਓ — ਇੱਕ ਚਿੰਨ੍ਹ ਸਕੈਨ ਕਰੋ',
  },
}

function setIfMissing(target, path, value) {
  const keys = path.split('.')
  let cur = target
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] === undefined || cur[keys[i]] === null || typeof cur[keys[i]] !== 'object') {
      cur[keys[i]] = {}
    }
    cur = cur[keys[i]]
  }
  const last = keys[keys.length - 1]
  if (cur[last] === undefined) {
    cur[last] = value
    return 1
  }
  return 0
}

let total = 0
for (const [locale, content] of Object.entries(T)) {
  const file = join(LOC, `${locale}.json`)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  let added = 0

  // Top-level about.* keys
  added += setIfMissing(data, 'about.title', content.title)
  added += setIfMissing(data, 'about.lead', content.lead)
  added += setIfMissing(data, 'about.footerNote', content.footerNote)
  added += setIfMissing(data, 'about.sourceOnGitHub', content.sourceOnGitHub)
  added += setIfMissing(data, 'about.connectOnLinkedIn', content.connectOnLinkedIn)
  added += setIfMissing(data, 'about.cta', content.cta)

  // Per-section keys
  const sections = ['scan', 'evidence', 'reminders', 'gates', 'appeal', 'kindnesses', 'signIn']
  for (const id of sections) {
    const s = content[id]
    added += setIfMissing(data, `about.${id}.title`, s.title)
    added += setIfMissing(data, `about.${id}.lead`, s.lead)
    added += setIfMissing(data, `about.${id}.items`, s.items)
  }

  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(`${locale}.json: added ${added} keys`)
  total += added
}
console.log(`done — ${total} keys total`)
