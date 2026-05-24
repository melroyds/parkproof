#!/usr/bin/env python3
"""
One-shot helper to add the new reminder-visibility i18n keys to all 8
non-English locale JSON files. Idempotent — safe to re-run; existing keys
are NOT overwritten so manual native-speaker tweaks survive.

Adds:
  - reminders.pushStatus.* (7 keys)
  - reminders.pushScheduled.* (3 keys)
  - scheduledReminders.* (~16 keys, including _one / _other plural pairs)
  - active.nextPing

The English copy already lives in en.json — only the translated versions
land here. Run:

  python scripts/_inject_reminder_keys.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES_DIR = ROOT / "src" / "locales"

# Translated key → value mappings per locale. Keys are dotted paths into
# the JSON tree. `_one` / `_other` are i18next plural suffixes.
#
# All translations are machine-quality first-pass — meaning preserved, tone
# kept "warm + plain language", consistent with surrounding strings in
# each file. A native-speaker review pre-launch would be ideal but not
# blocking; the worst case is a slightly awkward phrasing, not a
# correctness issue.

TRANSLATIONS = {
    "zh-CN": {
        "reminders.pushStatus.subscribed": "✓ 此设备已启用推送提醒",
        "reminders.pushStatus.notSubscribed": "未启用推送。如果不启用,只有此标签页打开时提醒才会响起。",
        "reminders.pushStatus.enable": "启用推送",
        "reminders.pushStatus.requesting": "正在询问浏览器…",
        "reminders.pushStatus.denied": "你已阻止此网站的通知。请在浏览器的站点设置中更改权限以启用。",
        "reminders.pushStatus.errorRetry": "无法启用 — 请重试",
        "reminders.pushStatus.unsupported": "此浏览器不支持推送通知。",
        "reminders.pushScheduled.header": "推送提醒已安排",
        "reminders.pushScheduled.single": "将在 {{times}} 推送提醒。",
        "reminders.pushScheduled.multiple": "将在 {{times}} 推送提醒。",
        "scheduledReminders.header": "已安排的提醒",
        "scheduledReminders.noneYet": "此会话尚未设置推送提醒。",
        "scheduledReminders.firesAtExpiry": "{{when}} — 到期时",
        "scheduledReminders.firesBefore_one": "{{when}} — 到期前 1 分钟",
        "scheduledReminders.firesBefore_other": "{{when}} — 到期前 {{count}} 分钟",
        "scheduledReminders.firesFromNow_one": "{{when}} — 到达后 1 分钟",
        "scheduledReminders.firesFromNow_other": "{{when}} — 到达后 {{count}} 分钟",
        "scheduledReminders.firesAbsolute": "{{when}}",
        "scheduledReminders.addAnother": "+ 添加提醒",
        "scheduledReminders.cancelAll": "取消全部提醒",
        "scheduledReminders.cancelAllConfirm": "取消此会话的所有推送提醒?",
        "scheduledReminders.cancelOne": "移除此提醒",
        "scheduledReminders.pickHeader": "何时提醒你?",
        "scheduledReminders.pickCancel": "取消",
        "scheduledReminders.tooLateAll": "没有足够时间在未来安排任何提醒选项。如果你已离开,请点击「结束会话」。",
        "scheduledReminders.pushNotEnabled": "在此设备上启用推送通知以添加在应用关闭时也能触发的提醒。",
        "scheduledReminders.saving": "正在保存…",
        "scheduledReminders.errorRetry": "无法更新 — 请重试",
        "active.nextPing": "下次提醒:{{when}}",
    },
    "vi": {
        "reminders.pushStatus.subscribed": "✓ Đã bật nhắc nhở qua đẩy trên thiết bị này",
        "reminders.pushStatus.notSubscribed": "Chưa bật đẩy. Nếu không bật, nhắc nhở chỉ kêu khi tab này đang mở.",
        "reminders.pushStatus.enable": "Bật đẩy",
        "reminders.pushStatus.requesting": "Đang yêu cầu trình duyệt…",
        "reminders.pushStatus.denied": "Bạn đã chặn thông báo cho trang này. Hãy thay đổi quyền trong cài đặt trang của trình duyệt để bật.",
        "reminders.pushStatus.errorRetry": "Không thể bật — thử lại",
        "reminders.pushStatus.unsupported": "Trình duyệt này không hỗ trợ thông báo đẩy.",
        "reminders.pushScheduled.header": "Đã lên lịch nhắc nhở đẩy",
        "reminders.pushScheduled.single": "Bạn sẽ được nhắc lúc {{times}}.",
        "reminders.pushScheduled.multiple": "Bạn sẽ được nhắc lúc {{times}}.",
        "scheduledReminders.header": "Nhắc nhở đã lên lịch",
        "scheduledReminders.noneYet": "Phiên này chưa có nhắc nhở đẩy nào được đặt.",
        "scheduledReminders.firesAtExpiry": "{{when}} — vào lúc hết hạn",
        "scheduledReminders.firesBefore_one": "{{when}} — 1 phút trước hết hạn",
        "scheduledReminders.firesBefore_other": "{{when}} — {{count}} phút trước hết hạn",
        "scheduledReminders.firesFromNow_one": "{{when}} — 1 phút sau khi đến",
        "scheduledReminders.firesFromNow_other": "{{when}} — {{count}} phút sau khi đến",
        "scheduledReminders.firesAbsolute": "{{when}}",
        "scheduledReminders.addAnother": "+ Thêm nhắc nhở",
        "scheduledReminders.cancelAll": "Hủy tất cả nhắc nhở",
        "scheduledReminders.cancelAllConfirm": "Hủy mọi nhắc nhở đẩy đã lên lịch cho phiên này?",
        "scheduledReminders.cancelOne": "Xóa nhắc nhở này",
        "scheduledReminders.pickHeader": "Khi nào nên nhắc bạn?",
        "scheduledReminders.pickCancel": "Hủy",
        "scheduledReminders.tooLateAll": "Không còn tùy chọn nhắc nhở nào trong tương lai để lên lịch. Nhấn Kết thúc phiên nếu bạn đã đi.",
        "scheduledReminders.pushNotEnabled": "Bật thông báo đẩy trên thiết bị này để thêm nhắc nhở kêu khi ứng dụng đóng.",
        "scheduledReminders.saving": "Đang lưu…",
        "scheduledReminders.errorRetry": "Không thể cập nhật — thử lại",
        "active.nextPing": "Nhắc tiếp theo: {{when}}",
    },
    "id": {
        "reminders.pushStatus.subscribed": "✓ Pengingat push diaktifkan di perangkat ini",
        "reminders.pushStatus.notSubscribed": "Push belum diaktifkan. Tanpanya, pengingat hanya menyala saat tab ini terbuka.",
        "reminders.pushStatus.enable": "Aktifkan push",
        "reminders.pushStatus.requesting": "Bertanya pada browser…",
        "reminders.pushStatus.denied": "Kamu memblokir notifikasi untuk situs ini. Ubah izin di pengaturan situs browser untuk mengaktifkan.",
        "reminders.pushStatus.errorRetry": "Tidak bisa mengaktifkan — coba lagi",
        "reminders.pushStatus.unsupported": "Browser ini tidak mendukung notifikasi push.",
        "reminders.pushScheduled.header": "Pengingat push terjadwal",
        "reminders.pushScheduled.single": "Kamu akan diping pada {{times}}.",
        "reminders.pushScheduled.multiple": "Kamu akan diping pada {{times}}.",
        "scheduledReminders.header": "Pengingat terjadwal",
        "scheduledReminders.noneYet": "Belum ada pengingat push diatur untuk sesi ini.",
        "scheduledReminders.firesAtExpiry": "{{when}} — saat berakhir",
        "scheduledReminders.firesBefore_one": "{{when}} — 1 menit sebelum berakhir",
        "scheduledReminders.firesBefore_other": "{{when}} — {{count}} menit sebelum berakhir",
        "scheduledReminders.firesFromNow_one": "{{when}} — 1 menit setelah tiba",
        "scheduledReminders.firesFromNow_other": "{{when}} — {{count}} menit setelah tiba",
        "scheduledReminders.firesAbsolute": "{{when}}",
        "scheduledReminders.addAnother": "+ Tambah pengingat",
        "scheduledReminders.cancelAll": "Batalkan semua pengingat",
        "scheduledReminders.cancelAllConfirm": "Batalkan setiap pengingat push terjadwal untuk sesi ini?",
        "scheduledReminders.cancelOne": "Hapus pengingat ini",
        "scheduledReminders.pickHeader": "Kapan kami harus mengingatkanmu?",
        "scheduledReminders.pickCancel": "Batal",
        "scheduledReminders.tooLateAll": "Tidak ada opsi pengingat yang masih bisa dijadwalkan di masa depan. Ketuk Akhiri sesi jika kamu sudah pergi.",
        "scheduledReminders.pushNotEnabled": "Aktifkan notifikasi push di perangkat ini untuk menambah pengingat yang menyala saat aplikasi tertutup.",
        "scheduledReminders.saving": "Menyimpan…",
        "scheduledReminders.errorRetry": "Tidak bisa memperbarui — coba lagi",
        "active.nextPing": "Ping berikutnya: {{when}}",
    },
    "ko": {
        "reminders.pushStatus.subscribed": "✓ 이 기기에서 푸시 알림이 활성화되어 있음",
        "reminders.pushStatus.notSubscribed": "푸시가 활성화되지 않았습니다. 활성화하지 않으면 이 탭이 열려 있을 때만 알림이 울립니다.",
        "reminders.pushStatus.enable": "푸시 활성화",
        "reminders.pushStatus.requesting": "브라우저에 요청 중…",
        "reminders.pushStatus.denied": "이 사이트의 알림을 차단했습니다. 활성화하려면 브라우저의 사이트 설정에서 권한을 변경하세요.",
        "reminders.pushStatus.errorRetry": "활성화할 수 없음 — 다시 시도",
        "reminders.pushStatus.unsupported": "이 브라우저는 푸시 알림을 지원하지 않습니다.",
        "reminders.pushScheduled.header": "푸시 알림 예약됨",
        "reminders.pushScheduled.single": "{{times}}에 알림이 전송됩니다.",
        "reminders.pushScheduled.multiple": "{{times}}에 알림이 전송됩니다.",
        "scheduledReminders.header": "예약된 알림",
        "scheduledReminders.noneYet": "이 세션에는 아직 푸시 알림이 설정되지 않았습니다.",
        "scheduledReminders.firesAtExpiry": "{{when}} — 만료 시점",
        "scheduledReminders.firesBefore_one": "{{when}} — 만료 1분 전",
        "scheduledReminders.firesBefore_other": "{{when}} — 만료 {{count}}분 전",
        "scheduledReminders.firesFromNow_one": "{{when}} — 도착 1분 후",
        "scheduledReminders.firesFromNow_other": "{{when}} — 도착 {{count}}분 후",
        "scheduledReminders.firesAbsolute": "{{when}}",
        "scheduledReminders.addAnother": "+ 알림 추가",
        "scheduledReminders.cancelAll": "모든 알림 취소",
        "scheduledReminders.cancelAllConfirm": "이 세션의 모든 예약된 푸시 알림을 취소할까요?",
        "scheduledReminders.cancelOne": "이 알림 제거",
        "scheduledReminders.pickHeader": "언제 알려드릴까요?",
        "scheduledReminders.pickCancel": "취소",
        "scheduledReminders.tooLateAll": "예약할 수 있는 미래 시점의 알림 옵션이 없습니다. 이미 떠났다면 세션 종료를 누르세요.",
        "scheduledReminders.pushNotEnabled": "앱이 닫혀 있을 때도 작동하는 알림을 추가하려면 이 기기에서 푸시 알림을 활성화하세요.",
        "scheduledReminders.saving": "저장 중…",
        "scheduledReminders.errorRetry": "업데이트할 수 없음 — 다시 시도",
        "active.nextPing": "다음 알림: {{when}}",
    },
    "it": {
        "reminders.pushStatus.subscribed": "✓ Promemoria push attivati su questo dispositivo",
        "reminders.pushStatus.notSubscribed": "Push non attivato. Senza, i promemoria suonano solo mentre questa scheda è aperta.",
        "reminders.pushStatus.enable": "Attiva push",
        "reminders.pushStatus.requesting": "Richiesta al browser…",
        "reminders.pushStatus.denied": "Hai bloccato le notifiche per questo sito. Modifica il permesso nelle impostazioni del sito del browser per attivare.",
        "reminders.pushStatus.errorRetry": "Impossibile attivare — riprova",
        "reminders.pushStatus.unsupported": "Questo browser non supporta le notifiche push.",
        "reminders.pushScheduled.header": "Promemoria push pianificati",
        "reminders.pushScheduled.single": "Riceverai un ping alle {{times}}.",
        "reminders.pushScheduled.multiple": "Riceverai un ping alle {{times}}.",
        "scheduledReminders.header": "Promemoria pianificati",
        "scheduledReminders.noneYet": "Nessun promemoria push impostato per questa sessione.",
        "scheduledReminders.firesAtExpiry": "{{when}} — alla scadenza",
        "scheduledReminders.firesBefore_one": "{{when}} — 1 min prima della scadenza",
        "scheduledReminders.firesBefore_other": "{{when}} — {{count}} min prima della scadenza",
        "scheduledReminders.firesFromNow_one": "{{when}} — 1 min dopo l'arrivo",
        "scheduledReminders.firesFromNow_other": "{{when}} — {{count}} min dopo l'arrivo",
        "scheduledReminders.firesAbsolute": "{{when}}",
        "scheduledReminders.addAnother": "+ Aggiungi promemoria",
        "scheduledReminders.cancelAll": "Annulla tutti i promemoria",
        "scheduledReminders.cancelAllConfirm": "Annullare ogni promemoria push pianificato per questa sessione?",
        "scheduledReminders.cancelOne": "Rimuovi questo promemoria",
        "scheduledReminders.pickHeader": "Quando vuoi essere avvisato?",
        "scheduledReminders.pickCancel": "Annulla",
        "scheduledReminders.tooLateAll": "Nessuna opzione di promemoria è abbastanza nel futuro da poter essere pianificata. Tocca Termina sessione se sei già andato.",
        "scheduledReminders.pushNotEnabled": "Attiva le notifiche push su questo dispositivo per aggiungere promemoria che suonano anche quando l'app è chiusa.",
        "scheduledReminders.saving": "Salvataggio…",
        "scheduledReminders.errorRetry": "Impossibile aggiornare — riprova",
        "active.nextPing": "Prossimo ping: {{when}}",
    },
    "el": {
        "reminders.pushStatus.subscribed": "✓ Οι ειδοποιήσεις push είναι ενεργές σε αυτή τη συσκευή",
        "reminders.pushStatus.notSubscribed": "Το push δεν είναι ενεργό. Χωρίς αυτό, οι υπενθυμίσεις ηχούν μόνο όσο αυτή η καρτέλα είναι ανοιχτή.",
        "reminders.pushStatus.enable": "Ενεργοποίηση push",
        "reminders.pushStatus.requesting": "Ερώτηση στον browser…",
        "reminders.pushStatus.denied": "Έχεις μπλοκάρει τις ειδοποιήσεις για αυτόν τον ιστότοπο. Άλλαξε το δικαίωμα στις ρυθμίσεις του ιστότοπου στον browser για να ενεργοποιήσεις.",
        "reminders.pushStatus.errorRetry": "Δεν ενεργοποιήθηκε — δοκίμασε ξανά",
        "reminders.pushStatus.unsupported": "Αυτός ο browser δεν υποστηρίζει ειδοποιήσεις push.",
        "reminders.pushScheduled.header": "Προγραμματισμένες ειδοποιήσεις push",
        "reminders.pushScheduled.single": "Θα ειδοποιηθείς στις {{times}}.",
        "reminders.pushScheduled.multiple": "Θα ειδοποιηθείς στις {{times}}.",
        "scheduledReminders.header": "Προγραμματισμένες υπενθυμίσεις",
        "scheduledReminders.noneYet": "Καμία ειδοποίηση push δεν έχει οριστεί για αυτή τη συνεδρία.",
        "scheduledReminders.firesAtExpiry": "{{when}} — κατά τη λήξη",
        "scheduledReminders.firesBefore_one": "{{when}} — 1 λεπτό πριν τη λήξη",
        "scheduledReminders.firesBefore_other": "{{when}} — {{count}} λεπτά πριν τη λήξη",
        "scheduledReminders.firesFromNow_one": "{{when}} — 1 λεπτό μετά την άφιξη",
        "scheduledReminders.firesFromNow_other": "{{when}} — {{count}} λεπτά μετά την άφιξη",
        "scheduledReminders.firesAbsolute": "{{when}}",
        "scheduledReminders.addAnother": "+ Προσθήκη υπενθύμισης",
        "scheduledReminders.cancelAll": "Ακύρωση όλων των υπενθυμίσεων",
        "scheduledReminders.cancelAllConfirm": "Να ακυρωθούν όλες οι προγραμματισμένες ειδοποιήσεις push για αυτή τη συνεδρία;",
        "scheduledReminders.cancelOne": "Αφαίρεση αυτής της υπενθύμισης",
        "scheduledReminders.pickHeader": "Πότε να σε ειδοποιήσουμε;",
        "scheduledReminders.pickCancel": "Άκυρο",
        "scheduledReminders.tooLateAll": "Καμία επιλογή υπενθύμισης δεν είναι αρκετά στο μέλλον για να προγραμματιστεί. Πάτησε Τερματισμός συνεδρίας αν έχεις ήδη φύγει.",
        "scheduledReminders.pushNotEnabled": "Ενεργοποίησε τις ειδοποιήσεις push σε αυτή τη συσκευή για να προσθέσεις υπενθυμίσεις που ηχούν ακόμα και όταν η εφαρμογή είναι κλειστή.",
        "scheduledReminders.saving": "Αποθήκευση…",
        "scheduledReminders.errorRetry": "Δεν ενημερώθηκε — δοκίμασε ξανά",
        "active.nextPing": "Επόμενη ειδοποίηση: {{when}}",
    },
    "hi": {
        "reminders.pushStatus.subscribed": "✓ इस डिवाइस पर पुश अनुस्मारक चालू हैं",
        "reminders.pushStatus.notSubscribed": "पुश चालू नहीं है। इसके बिना, अनुस्मारक केवल तभी बजेंगे जब यह टैब खुला हो।",
        "reminders.pushStatus.enable": "पुश चालू करें",
        "reminders.pushStatus.requesting": "ब्राउज़र से पूछ रहे हैं…",
        "reminders.pushStatus.denied": "आपने इस साइट के लिए सूचनाएं अवरुद्ध कर दी हैं। चालू करने के लिए ब्राउज़र की साइट सेटिंग्स में अनुमति बदलें।",
        "reminders.pushStatus.errorRetry": "चालू नहीं हो सका — दोबारा कोशिश करें",
        "reminders.pushStatus.unsupported": "यह ब्राउज़र पुश सूचनाओं का समर्थन नहीं करता।",
        "reminders.pushScheduled.header": "पुश अनुस्मारक निर्धारित",
        "reminders.pushScheduled.single": "आपको {{times}} पर सूचित किया जाएगा।",
        "reminders.pushScheduled.multiple": "आपको {{times}} पर सूचित किया जाएगा।",
        "scheduledReminders.header": "निर्धारित अनुस्मारक",
        "scheduledReminders.noneYet": "इस सत्र के लिए अभी तक कोई पुश अनुस्मारक सेट नहीं है।",
        "scheduledReminders.firesAtExpiry": "{{when}} — समाप्ति पर",
        "scheduledReminders.firesBefore_one": "{{when}} — समाप्ति से 1 मिनट पहले",
        "scheduledReminders.firesBefore_other": "{{when}} — समाप्ति से {{count}} मिनट पहले",
        "scheduledReminders.firesFromNow_one": "{{when}} — पहुंचने के 1 मिनट बाद",
        "scheduledReminders.firesFromNow_other": "{{when}} — पहुंचने के {{count}} मिनट बाद",
        "scheduledReminders.firesAbsolute": "{{when}}",
        "scheduledReminders.addAnother": "+ अनुस्मारक जोड़ें",
        "scheduledReminders.cancelAll": "सभी अनुस्मारक रद्द करें",
        "scheduledReminders.cancelAllConfirm": "इस सत्र के सभी निर्धारित पुश अनुस्मारक रद्द करें?",
        "scheduledReminders.cancelOne": "यह अनुस्मारक हटाएं",
        "scheduledReminders.pickHeader": "हम आपको कब सूचित करें?",
        "scheduledReminders.pickCancel": "रद्द करें",
        "scheduledReminders.tooLateAll": "भविष्य में कोई अनुस्मारक विकल्प इतनी दूर नहीं है कि निर्धारित किया जा सके। यदि आप जा चुके हैं तो सत्र समाप्त करें पर टैप करें।",
        "scheduledReminders.pushNotEnabled": "ऐसे अनुस्मारक जोड़ने के लिए जो ऐप बंद होने पर भी बजें, इस डिवाइस पर पुश सूचनाएं चालू करें।",
        "scheduledReminders.saving": "सहेजा जा रहा है…",
        "scheduledReminders.errorRetry": "अपडेट नहीं हो सका — दोबारा कोशिश करें",
        "active.nextPing": "अगला पिंग: {{when}}",
    },
    "pa": {
        "reminders.pushStatus.subscribed": "✓ ਇਸ ਡਿਵਾਈਸ ਉੱਤੇ ਪੁਸ਼ ਯਾਦਾਂ ਚਾਲੂ ਹਨ",
        "reminders.pushStatus.notSubscribed": "ਪੁਸ਼ ਚਾਲੂ ਨਹੀਂ ਹੈ। ਇਸ ਤੋਂ ਬਿਨਾਂ, ਯਾਦਾਂ ਸਿਰਫ਼ ਉਦੋਂ ਵੱਜਣਗੀਆਂ ਜਦੋਂ ਇਹ ਟੈਬ ਖੁੱਲ੍ਹਾ ਹੋਵੇਗਾ।",
        "reminders.pushStatus.enable": "ਪੁਸ਼ ਚਾਲੂ ਕਰੋ",
        "reminders.pushStatus.requesting": "ਬ੍ਰਾਊਜ਼ਰ ਤੋਂ ਪੁੱਛ ਰਹੇ ਹਾਂ…",
        "reminders.pushStatus.denied": "ਤੁਸੀਂ ਇਸ ਸਾਈਟ ਲਈ ਸੂਚਨਾਵਾਂ ਨੂੰ ਰੋਕ ਦਿੱਤਾ ਹੈ। ਚਾਲੂ ਕਰਨ ਲਈ ਬ੍ਰਾਊਜ਼ਰ ਦੀ ਸਾਈਟ ਸੈਟਿੰਗਾਂ ਵਿੱਚ ਇਜਾਜ਼ਤ ਬਦਲੋ।",
        "reminders.pushStatus.errorRetry": "ਚਾਲੂ ਨਹੀਂ ਹੋ ਸਕਿਆ — ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ",
        "reminders.pushStatus.unsupported": "ਇਹ ਬ੍ਰਾਊਜ਼ਰ ਪੁਸ਼ ਸੂਚਨਾਵਾਂ ਦਾ ਸਮਰਥਨ ਨਹੀਂ ਕਰਦਾ।",
        "reminders.pushScheduled.header": "ਪੁਸ਼ ਯਾਦਾਂ ਨਿਯਤ ਹਨ",
        "reminders.pushScheduled.single": "ਤੁਹਾਨੂੰ {{times}} ਉੱਤੇ ਯਾਦ ਕਰਵਾਇਆ ਜਾਵੇਗਾ।",
        "reminders.pushScheduled.multiple": "ਤੁਹਾਨੂੰ {{times}} ਉੱਤੇ ਯਾਦ ਕਰਵਾਇਆ ਜਾਵੇਗਾ।",
        "scheduledReminders.header": "ਨਿਯਤ ਯਾਦਾਂ",
        "scheduledReminders.noneYet": "ਇਸ ਸੈਸ਼ਨ ਲਈ ਅਜੇ ਕੋਈ ਪੁਸ਼ ਯਾਦ ਸੈੱਟ ਨਹੀਂ ਹੈ।",
        "scheduledReminders.firesAtExpiry": "{{when}} — ਮਿਆਦ ਖਤਮ ਹੋਣ ’ਤੇ",
        "scheduledReminders.firesBefore_one": "{{when}} — ਮਿਆਦ ਖਤਮ ਹੋਣ ਤੋਂ 1 ਮਿੰਟ ਪਹਿਲਾਂ",
        "scheduledReminders.firesBefore_other": "{{when}} — ਮਿਆਦ ਖਤਮ ਹੋਣ ਤੋਂ {{count}} ਮਿੰਟ ਪਹਿਲਾਂ",
        "scheduledReminders.firesFromNow_one": "{{when}} — ਪਹੁੰਚਣ ਤੋਂ 1 ਮਿੰਟ ਬਾਅਦ",
        "scheduledReminders.firesFromNow_other": "{{when}} — ਪਹੁੰਚਣ ਤੋਂ {{count}} ਮਿੰਟ ਬਾਅਦ",
        "scheduledReminders.firesAbsolute": "{{when}}",
        "scheduledReminders.addAnother": "+ ਯਾਦ ਜੋੜੋ",
        "scheduledReminders.cancelAll": "ਸਾਰੀਆਂ ਯਾਦਾਂ ਰੱਦ ਕਰੋ",
        "scheduledReminders.cancelAllConfirm": "ਇਸ ਸੈਸ਼ਨ ਲਈ ਹਰ ਨਿਯਤ ਪੁਸ਼ ਯਾਦ ਰੱਦ ਕਰੋ?",
        "scheduledReminders.cancelOne": "ਇਹ ਯਾਦ ਹਟਾਓ",
        "scheduledReminders.pickHeader": "ਅਸੀਂ ਤੁਹਾਨੂੰ ਕਦੋਂ ਯਾਦ ਕਰਵਾਈਏ?",
        "scheduledReminders.pickCancel": "ਰੱਦ ਕਰੋ",
        "scheduledReminders.tooLateAll": "ਨਿਯਤ ਕਰਨ ਲਈ ਕੋਈ ਯਾਦ ਵਿਕਲਪ ਭਵਿੱਖ ਵਿੱਚ ਕਾਫ਼ੀ ਦੂਰ ਨਹੀਂ ਹੈ। ਜੇ ਤੁਸੀਂ ਪਹਿਲਾਂ ਹੀ ਚਲੇ ਗਏ ਹੋ ਤਾਂ ਸੈਸ਼ਨ ਖਤਮ ਕਰੋ ’ਤੇ ਟੈਪ ਕਰੋ।",
        "scheduledReminders.pushNotEnabled": "ਉਹ ਯਾਦਾਂ ਜੋੜਨ ਲਈ ਜੋ ਐਪ ਬੰਦ ਹੋਣ ’ਤੇ ਵੀ ਵੱਜਣ, ਇਸ ਡਿਵਾਈਸ ਉੱਤੇ ਪੁਸ਼ ਸੂਚਨਾਵਾਂ ਚਾਲੂ ਕਰੋ।",
        "scheduledReminders.saving": "ਸੰਭਾਲ ਰਿਹਾ ਹੈ…",
        "scheduledReminders.errorRetry": "ਅੱਪਡੇਟ ਨਹੀਂ ਹੋ ਸਕਿਆ — ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ",
        "active.nextPing": "ਅਗਲੀ ਯਾਦ: {{when}}",
    },
}


def set_nested(obj: dict, dotted_path: str, value: str) -> bool:
    """Set obj[a][b][c] = value for dotted path 'a.b.c'. Returns True if changed."""
    parts = dotted_path.split(".")
    cur = obj
    for p in parts[:-1]:
        if p not in cur or not isinstance(cur[p], dict):
            cur[p] = {}
        cur = cur[p]
    last = parts[-1]
    if cur.get(last) == value:
        return False
    # Don't overwrite if the key already exists with ANY value — a native-
    # speaker tweak survives the re-run.
    if last in cur and cur[last]:
        return False
    cur[last] = value
    return True


def main() -> None:
    for locale, kv in TRANSLATIONS.items():
        path = LOCALES_DIR / f"{locale}.json"
        if not path.is_file():
            print(f"  SKIP {locale}: file not found", file=sys.stderr)
            continue
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        added = 0
        for dotted, value in kv.items():
            if set_nested(data, dotted, value):
                added += 1
        with path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"  {locale}: +{added} keys")


if __name__ == "__main__":
    main()
