#!/usr/bin/env python3
"""
One-shot helper to add settings.push* keys + installPrompt.* keys to all
9 locale JSONs. Idempotent — existing keys are NOT overwritten so manual
native-speaker tweaks survive re-runs.

Run:
  python scripts/_inject_push_mgmt_keys.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES_DIR = ROOT / "src" / "locales"

PUSH_MGMT = {
    "en": {
        "pushHeader": "Push notifications on this device",
        "pushCopy": "Reminders only fire when the app is closed if push is enabled. Subscription is per-browser-per-device, separate from your account.",
        "pushSubscribed": "✓ Subscribed on this device",
        "pushEnable": "Enable push",
        "pushDisable": "Disable push on this device",
        "pushDisableConfirm": "Disable push reminders on this device? Scheduled reminders will stop firing here, but you can re-enable any time.",
        "pushDisableNote": "This only unsubscribes this device. To fully revoke browser permission, change site settings in your browser.",
        "pushDenied": "You've blocked notifications for this site. To enable, change the permission in your browser's site settings, then revisit this page.",
        "pushRequesting": "Asking your browser…",
        "pushErrorRetry": "Couldn't enable — try again",
    },
    "zh-CN": {
        "pushHeader": "此设备上的推送通知",
        "pushCopy": "只有启用推送后,提醒才会在应用关闭时触发。订阅是按浏览器+设备的,独立于你的账户。",
        "pushSubscribed": "✓ 此设备已订阅",
        "pushEnable": "启用推送",
        "pushDisable": "在此设备上禁用推送",
        "pushDisableConfirm": "在此设备上禁用推送提醒?已安排的提醒将不再在此触发,但你可以随时重新启用。",
        "pushDisableNote": "这只会取消此设备的订阅。要完全撤销浏览器权限,请在浏览器的站点设置中更改。",
        "pushDenied": "你已阻止此站点的通知。要启用,请在浏览器的站点设置中更改权限,然后重新访问此页面。",
        "pushRequesting": "正在询问浏览器…",
        "pushErrorRetry": "无法启用 — 请重试",
    },
    "vi": {
        "pushHeader": "Thông báo đẩy trên thiết bị này",
        "pushCopy": "Lời nhắc chỉ phát khi ứng dụng đóng nếu đã bật đẩy. Đăng ký theo từng trình duyệt + thiết bị, độc lập với tài khoản.",
        "pushSubscribed": "✓ Đã đăng ký trên thiết bị này",
        "pushEnable": "Bật đẩy",
        "pushDisable": "Tắt đẩy trên thiết bị này",
        "pushDisableConfirm": "Tắt nhắc đẩy trên thiết bị này? Các lời nhắc đã lên lịch sẽ không phát ở đây nữa, nhưng bạn có thể bật lại bất cứ lúc nào.",
        "pushDisableNote": "Chỉ hủy đăng ký thiết bị này. Để thu hồi hoàn toàn quyền của trình duyệt, hãy thay đổi cài đặt trang trong trình duyệt.",
        "pushDenied": "Bạn đã chặn thông báo cho trang này. Để bật, thay đổi quyền trong cài đặt trang của trình duyệt rồi quay lại trang này.",
        "pushRequesting": "Đang hỏi trình duyệt…",
        "pushErrorRetry": "Không bật được — thử lại",
    },
    "id": {
        "pushHeader": "Notifikasi push di perangkat ini",
        "pushCopy": "Pengingat hanya menyala saat aplikasi tertutup jika push diaktifkan. Langganan per-browser-per-perangkat, terpisah dari akun.",
        "pushSubscribed": "✓ Berlangganan di perangkat ini",
        "pushEnable": "Aktifkan push",
        "pushDisable": "Nonaktifkan push di perangkat ini",
        "pushDisableConfirm": "Nonaktifkan pengingat push di perangkat ini? Pengingat terjadwal tidak akan menyala di sini, tapi kamu bisa mengaktifkan kembali kapan saja.",
        "pushDisableNote": "Ini hanya berhenti berlangganan perangkat ini. Untuk mencabut izin browser sepenuhnya, ubah pengaturan situs di browsermu.",
        "pushDenied": "Kamu memblokir notifikasi untuk situs ini. Untuk mengaktifkan, ubah izin di pengaturan situs browser, lalu kunjungi ulang halaman ini.",
        "pushRequesting": "Bertanya pada browser…",
        "pushErrorRetry": "Tidak bisa mengaktifkan — coba lagi",
    },
    "ko": {
        "pushHeader": "이 기기의 푸시 알림",
        "pushCopy": "푸시가 활성화된 경우에만 앱이 닫혔을 때 알림이 작동합니다. 구독은 브라우저+기기별이며 계정과 별개입니다.",
        "pushSubscribed": "✓ 이 기기에서 구독 중",
        "pushEnable": "푸시 활성화",
        "pushDisable": "이 기기에서 푸시 비활성화",
        "pushDisableConfirm": "이 기기에서 푸시 알림을 비활성화하시겠습니까? 예약된 알림이 여기에서 더 이상 발송되지 않지만 언제든지 다시 활성화할 수 있습니다.",
        "pushDisableNote": "이 기기의 구독만 해지합니다. 브라우저 권한을 완전히 취소하려면 브라우저의 사이트 설정을 변경하세요.",
        "pushDenied": "이 사이트의 알림을 차단했습니다. 활성화하려면 브라우저의 사이트 설정에서 권한을 변경한 후 이 페이지를 다시 방문하세요.",
        "pushRequesting": "브라우저에 요청 중…",
        "pushErrorRetry": "활성화할 수 없음 — 다시 시도",
    },
    "it": {
        "pushHeader": "Notifiche push su questo dispositivo",
        "pushCopy": "I promemoria suonano quando l'app è chiusa solo se il push è attivato. L'abbonamento è per-browser-per-dispositivo, separato dall'account.",
        "pushSubscribed": "✓ Iscritto su questo dispositivo",
        "pushEnable": "Attiva push",
        "pushDisable": "Disattiva push su questo dispositivo",
        "pushDisableConfirm": "Disattivare i promemoria push su questo dispositivo? I promemoria pianificati non suoneranno più qui, ma puoi riattivarli in qualsiasi momento.",
        "pushDisableNote": "Disabilita solo questo dispositivo. Per revocare completamente il permesso del browser, cambia le impostazioni del sito nel browser.",
        "pushDenied": "Hai bloccato le notifiche per questo sito. Per attivarle, modifica il permesso nelle impostazioni del sito del browser, poi rivisita questa pagina.",
        "pushRequesting": "Richiesta al browser…",
        "pushErrorRetry": "Impossibile attivare — riprova",
    },
    "el": {
        "pushHeader": "Ειδοποιήσεις push σε αυτή τη συσκευή",
        "pushCopy": "Οι υπενθυμίσεις ηχούν όταν η εφαρμογή είναι κλειστή μόνο αν είναι ενεργές οι ειδοποιήσεις push. Η συνδρομή είναι ανά browser+συσκευή, ξεχωριστή από τον λογαριασμό.",
        "pushSubscribed": "✓ Εγγεγραμμένος σε αυτή τη συσκευή",
        "pushEnable": "Ενεργοποίηση push",
        "pushDisable": "Απενεργοποίηση push σε αυτή τη συσκευή",
        "pushDisableConfirm": "Απενεργοποίηση ειδοποιήσεων push σε αυτή τη συσκευή; Οι προγραμματισμένες ειδοποιήσεις δεν θα ηχήσουν πια εδώ, αλλά μπορείς να τις ενεργοποιήσεις ξανά οποτεδήποτε.",
        "pushDisableNote": "Καταργεί την εγγραφή μόνο για αυτή τη συσκευή. Για πλήρη ανάκληση της άδειας του browser, άλλαξε τις ρυθμίσεις του ιστότοπου στον browser.",
        "pushDenied": "Έχεις μπλοκάρει τις ειδοποιήσεις για αυτόν τον ιστότοπο. Για να ενεργοποιήσεις, άλλαξε το δικαίωμα στις ρυθμίσεις του ιστότοπου, μετά επισκέψου ξανά αυτή τη σελίδα.",
        "pushRequesting": "Ερώτηση στον browser…",
        "pushErrorRetry": "Δεν ενεργοποιήθηκε — δοκίμασε ξανά",
    },
    "hi": {
        "pushHeader": "इस डिवाइस पर पुश सूचनाएं",
        "pushCopy": "पुश सक्षम होने पर ही ऐप बंद होने पर अनुस्मारक बजते हैं। सदस्यता प्रति-ब्राउज़र-प्रति-डिवाइस है, आपके खाते से अलग।",
        "pushSubscribed": "✓ इस डिवाइस पर सदस्यता ली गई",
        "pushEnable": "पुश सक्षम करें",
        "pushDisable": "इस डिवाइस पर पुश अक्षम करें",
        "pushDisableConfirm": "इस डिवाइस पर पुश अनुस्मारक अक्षम करें? निर्धारित अनुस्मारक यहां नहीं बजेंगे, लेकिन आप कभी भी फिर से सक्षम कर सकते हैं।",
        "pushDisableNote": "यह केवल इस डिवाइस की सदस्यता रद्द करता है। ब्राउज़र की अनुमति पूरी तरह से रद्द करने के लिए, अपने ब्राउज़र की साइट सेटिंग्स बदलें।",
        "pushDenied": "आपने इस साइट के लिए सूचनाएं अवरुद्ध कर दी हैं। सक्षम करने के लिए, ब्राउज़र की साइट सेटिंग्स में अनुमति बदलें, फिर इस पेज पर वापस आएं।",
        "pushRequesting": "ब्राउज़र से पूछ रहे हैं…",
        "pushErrorRetry": "सक्षम नहीं हो सका — दोबारा कोशिश करें",
    },
    "pa": {
        "pushHeader": "ਇਸ ਡਿਵਾਈਸ ਉੱਤੇ ਪੁਸ਼ ਸੂਚਨਾਵਾਂ",
        "pushCopy": "ਪੁਸ਼ ਚਾਲੂ ਹੋਣ 'ਤੇ ਹੀ ਐਪ ਬੰਦ ਹੋਣ ਵੇਲੇ ਯਾਦਾਂ ਵੱਜਦੀਆਂ ਹਨ। ਮੈਂਬਰਸ਼ਿਪ ਪ੍ਰਤੀ-ਬ੍ਰਾਊਜ਼ਰ-ਪ੍ਰਤੀ-ਡਿਵਾਈਸ ਹੈ, ਤੁਹਾਡੇ ਖਾਤੇ ਤੋਂ ਵੱਖਰੀ।",
        "pushSubscribed": "✓ ਇਸ ਡਿਵਾਈਸ ਉੱਤੇ ਸਬਸਕ੍ਰਾਈਬ ਕੀਤਾ",
        "pushEnable": "ਪੁਸ਼ ਚਾਲੂ ਕਰੋ",
        "pushDisable": "ਇਸ ਡਿਵਾਈਸ ਉੱਤੇ ਪੁਸ਼ ਬੰਦ ਕਰੋ",
        "pushDisableConfirm": "ਇਸ ਡਿਵਾਈਸ ਉੱਤੇ ਪੁਸ਼ ਯਾਦਾਂ ਬੰਦ ਕਰੋ? ਨਿਯਤ ਯਾਦਾਂ ਇੱਥੇ ਨਹੀਂ ਵੱਜਣਗੀਆਂ, ਪਰ ਤੁਸੀਂ ਕਿਸੇ ਵੀ ਵੇਲੇ ਫਿਰ ਚਾਲੂ ਕਰ ਸਕਦੇ ਹੋ।",
        "pushDisableNote": "ਇਹ ਸਿਰਫ਼ ਇਸ ਡਿਵਾਈਸ ਦੀ ਸਬਸਕ੍ਰਿਪਸ਼ਨ ਰੱਦ ਕਰਦਾ ਹੈ। ਬ੍ਰਾਊਜ਼ਰ ਦੀ ਇਜਾਜ਼ਤ ਪੂਰੀ ਤਰ੍ਹਾਂ ਰੱਦ ਕਰਨ ਲਈ, ਆਪਣੇ ਬ੍ਰਾਊਜ਼ਰ ਦੀਆਂ ਸਾਈਟ ਸੈਟਿੰਗਾਂ ਬਦਲੋ।",
        "pushDenied": "ਤੁਸੀਂ ਇਸ ਸਾਈਟ ਲਈ ਸੂਚਨਾਵਾਂ ਨੂੰ ਰੋਕ ਦਿੱਤਾ ਹੈ। ਚਾਲੂ ਕਰਨ ਲਈ, ਬ੍ਰਾਊਜ਼ਰ ਦੀਆਂ ਸਾਈਟ ਸੈਟਿੰਗਾਂ ਵਿੱਚ ਇਜਾਜ਼ਤ ਬਦਲੋ, ਫਿਰ ਇਸ ਪੰਨੇ 'ਤੇ ਵਾਪਸ ਆਓ।",
        "pushRequesting": "ਬ੍ਰਾਊਜ਼ਰ ਤੋਂ ਪੁੱਛ ਰਹੇ ਹਾਂ…",
        "pushErrorRetry": "ਚਾਲੂ ਨਹੀਂ ਹੋ ਸਕਿਆ — ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ",
    },
}


def main() -> None:
    for locale, kv in PUSH_MGMT.items():
        path = LOCALES_DIR / f"{locale}.json"
        if not path.is_file():
            print(f"  SKIP {locale}: not found", file=sys.stderr)
            continue
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        settings = data.setdefault("settings", {})
        added = 0
        for k, v in kv.items():
            if k not in settings:
                settings[k] = v
                added += 1
        with path.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"  {locale}: +{added} settings.push* keys")


if __name__ == "__main__":
    main()
