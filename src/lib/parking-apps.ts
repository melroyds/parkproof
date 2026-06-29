// Native links to Australian parking-payment apps, surfaced when a scanned
// sign requires payment.
//
// Research finding (2026): NO major AU parking app publishes a custom URL
// scheme (easypark://, paystay://, …), so we do not invent one — a guessed
// scheme produces a dead "cannot open page" error. Instead, per platform:
//   - iOS:     a verified universal link where one exists (EasyPark), else
//              the App Store page (which hands off to the app if installed).
//   - Android: an intent:// URL keyed by the VERIFIED package name, with a
//              Play Store browser_fallback_url (opens the app if installed,
//              else Play).
//   - desktop: the website.
// None of these apps expose a per-bay deep link, so we open the app to its
// home screen and let the user enter the zone — the realistic ceiling.
// All store IDs / package names verified against the live listings.

export interface ParkingApp {
  id: string
  name: string
  iosAppStore: string
  androidPackage: string
  playStore: string
  website: string
  /** A verified universal link that opens the installed app, else store. */
  universalLink?: string
}

export const PARKING_APPS: Record<string, ParkingApp> = {
  easypark: {
    id: 'easypark',
    name: 'EasyPark',
    iosAppStore: 'https://apps.apple.com/au/app/easypark-parking-made-easy/id449594317',
    androidPackage: 'net.easypark.android',
    playStore: 'https://play.google.com/store/apps/details?id=net.easypark.android',
    website: 'https://www.easypark.com/en-au',
    universalLink: 'https://invite.easypark.com/',
  },
  paystay: {
    id: 'paystay',
    name: 'PayStay',
    iosAppStore: 'https://apps.apple.com/au/app/paystay/id879997168',
    androidPackage: 'au.com.paystay',
    playStore: 'https://play.google.com/store/apps/details?id=au.com.paystay',
    website: 'https://www.paystay.com.au/',
  },
  opark: {
    id: 'opark',
    name: 'OPark',
    iosAppStore: 'https://apps.apple.com/au/app/opark/id6449750852',
    androidPackage: 'au.com.vpark.opark',
    playStore: 'https://play.google.com/store/apps/details?id=au.com.vpark.opark',
    website: 'https://opark.com.au/',
  },
  wilson: {
    id: 'wilson',
    name: 'Wilson Parking',
    iosAppStore: 'https://apps.apple.com/au/app/wilson-parking/id1368305246',
    androidPackage: 'au.com.wilsonone',
    playStore: 'https://play.google.com/store/apps/details?id=au.com.wilsonone',
    website: 'https://www.wilsonparking.com.au/',
  },
  secure: {
    id: 'secure',
    name: 'Secure Parking',
    iosAppStore: 'https://apps.apple.com/au/app/secure-parking/id1552083105',
    androidPackage: 'au.com.secureparking.production',
    playStore: 'https://play.google.com/store/apps/details?id=au.com.secureparking.production',
    website: 'https://www.secureparking.com.au/en-au/',
  },
}

type Platform = 'ios' | 'android' | 'desktop'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

/** The "open the app, else fall back cleanly" link for the current platform. */
export function launchUrlFor(app: ParkingApp, platform: Platform = detectPlatform()): string {
  if (platform === 'ios') return app.universalLink || app.iosAppStore
  if (platform === 'android') {
    const fallback = encodeURIComponent(app.playStore)
    return `intent://#Intent;package=${app.androidPackage};scheme=https;S.browser_fallback_url=${fallback};end`
  }
  return app.website
}

/**
 * The short, relevant app list to show for a paid bay. EasyPark + PayStay
 * cover City of Melbourne street parking and are always shown; any app the
 * sign explicitly named (e.g. "Secure Parking") is promoted to the front.
 * Capped to keep the result card uncluttered.
 */
export function payAppsToShow(detected: string[] = []): ParkingApp[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
  const hits = detected.map(norm)
  const promoted = Object.values(PARKING_APPS).filter(
    (a) => a.id !== 'easypark' && a.id !== 'paystay' && hits.some((h) => h.includes(a.id) || a.id.includes(h)),
  )
  return [...promoted, PARKING_APPS.easypark, PARKING_APPS.paystay].slice(0, 3)
}
