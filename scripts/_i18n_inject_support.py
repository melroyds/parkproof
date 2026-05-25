"""
Inject `about.support.*` i18n keys for the Buy-Me-a-Coffee block.
Adds a title / body / button trio after `about.cta` in every locale.
Idempotent — re-running just overwrites the existing values.
"""
import json
import sys
from pathlib import Path

SUPPORT_KEYS = {
    'en': {
        'title': 'Like ParkProof?',
        'body': 'Built solo in 10 days, free forever. If it saved you from a ticket, chip in for the AWS bill.',
        'button': '☕ Buy me a coffee',
    },
    'zh-CN': {
        'title': '喜欢 ParkProof 吗?',
        'body': '一个人花 10 天打造,永久免费。如果它帮你省下了一张罚单,可以请我喝杯咖啡。',
        'button': '☕ 请我喝杯咖啡',
    },
    'vi': {
        'title': 'Thích ParkProof không?',
        'body': 'Tự xây dựng trong 10 ngày, miễn phí mãi mãi. Nếu nó giúp bạn tránh được vé phạt, hãy ủng hộ chi phí AWS.',
        'button': '☕ Mời tôi một ly cà phê',
    },
    'id': {
        'title': 'Suka ParkProof?',
        'body': 'Dibangun sendiri dalam 10 hari, gratis selamanya. Jika ini menyelamatkan Anda dari tilang, traktir saya kopi.',
        'button': '☕ Belikan saya kopi',
    },
    'ko': {
        'title': 'ParkProof이 마음에 드시나요?',
        'body': '혼자 10일 동안 만들었고 항상 무료입니다. 주차 위반 딱지를 면하셨다면 커피 한 잔 사주세요.',
        'button': '☕ 커피 사주기',
    },
    'it': {
        'title': 'Ti piace ParkProof?',
        'body': 'Creato da solo in 10 giorni, gratis per sempre. Se ti ha salvato da una multa, offrimi un caffè.',
        'button': '☕ Offrimi un caffè',
    },
    'el': {
        'title': 'Σου αρέσει το ParkProof;',
        'body': 'Φτιάχτηκε μόνος σε 10 μέρες, δωρεάν για πάντα. Αν σου γλίτωσε μια κλήση, κέρασέ με έναν καφέ.',
        'button': '☕ Κέρασέ με καφέ',
    },
    'hi': {
        'title': 'ParkProof पसंद है?',
        'body': '10 दिनों में अकेले बनाया, हमेशा के लिए मुफ्त। अगर इसने आपको पार्किंग टिकट से बचाया, तो मुझे एक कॉफी पिला दें।',
        'button': '☕ मुझे कॉफी पिलाएं',
    },
    'pa': {
        'title': 'ParkProof ਪਸੰਦ ਹੈ?',
        'body': '10 ਦਿਨਾਂ ਵਿੱਚ ਇਕੱਲੇ ਬਣਾਇਆ, ਹਮੇਸ਼ਾ ਲਈ ਮੁਫ਼ਤ। ਜੇ ਇਸਨੇ ਤੁਹਾਨੂੰ ਪਾਰਕਿੰਗ ਟਿਕਟ ਤੋਂ ਬਚਾਇਆ, ਤਾਂ ਮੈਨੂੰ ਇੱਕ ਕੌਫੀ ਪਿਆ ਦਿਓ।',
        'button': '☕ ਮੈਨੂੰ ਕੌਫੀ ਪਿਆਓ',
    },
}

LOCALES_DIR = Path(__file__).resolve().parent.parent / 'src' / 'locales'

for locale, support in SUPPORT_KEYS.items():
    path = LOCALES_DIR / f'{locale}.json'
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    about = data.setdefault('about', {})
    about['support'] = support
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'  {locale}: injected about.support.*')

print('Done.')
