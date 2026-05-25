"""
Rename `result.logCta` from "Log this parking session" → "Save & remind me"
across all 9 locales. Lead-with-benefit copy fix prompted by user testing:
the previous wording told users WHAT to tap (log a session) without
communicating WHY (get a reminder + save evidence).

Only touches `result.logCta`. The blocked-state siblings (logCtaBlocked,
logCtaBlockedPermit, logCtaBlockedPermitZone) already reference "save"
in benefit-oriented framing and don't need changing. The `logger.header`
key keeps its descriptive wording — that screen is where the user is
already actively logging, so the verbose label is fine there.
"""
import json
import sys
import io
from pathlib import Path

# Force UTF-8 stdout on Windows console (cp1252 default barfs on the arrow + non-Latin glyphs in the log lines)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

NEW_LOG_CTA = {
    'en':    'Save & remind me',
    'zh-CN': '保存并提醒我',
    'vi':    'Lưu & nhắc tôi',
    'id':    'Simpan & ingatkan saya',
    'ko':    '저장하고 알림 받기',
    'it':    'Salva e ricordami',
    'el':    'Αποθήκευση & υπενθύμιση',
    'hi':    'सेव करें और याद दिलाएं',
    'pa':    'ਸੇਵ ਕਰੋ ਅਤੇ ਯਾਦ ਕਰਵਾਓ',
}

LOCALES_DIR = Path(__file__).resolve().parent.parent / 'src' / 'locales'

for locale, new_cta in NEW_LOG_CTA.items():
    path = LOCALES_DIR / f'{locale}.json'
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    result = data.setdefault('result', {})
    old = result.get('logCta', '(missing)')
    result['logCta'] = new_cta
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'  {locale}: "{old}" → "{new_cta}"')

print('Done.')
