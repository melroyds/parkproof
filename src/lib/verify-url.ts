// /verify lives at site root with per-locale subdirectories
// (/verify/, /verify/ko/, /verify/zh-CN/, etc). English is the default at
// /verify/; other locales get their own subdir. Compute the right URL for the
// current user's UI language so the link goes straight to a page they can read.
//
// Shared by PrivacyPolicy (the privacy view) and SessionDetail (the "how a
// council verifies this record" link surfaced at the point a user exports their
// evidence). Keep the supported list in sync with the deployed /verify subdirs.
export function verifyUrlForLocale(lang: string): string {
  // Strip region tag for matching ('en-AU' -> 'en'), keep the full tag for the
  // multi-tag locales we actually ship ('zh-CN').
  const supported = ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']
  const exact = supported.find((l) => l === lang)
  const primary = supported.find((l) => l === lang.split('-')[0])
  const target = exact || primary || 'en'
  return target === 'en' ? '/verify/' : `/verify/${target}/`
}
