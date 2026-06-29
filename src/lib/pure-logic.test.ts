// Pure, deterministic helpers the audit flagged as untested. Each is fast,
// dependency-free, and a regression ships a visibly-wrong UI (a dead pay-app
// link, a raw AWS error shown to a user, a mislabelled GPS radius).
import { describe, it, expect } from 'vitest'
import { launchUrlFor, payAppsToShow, PARKING_APPS } from './parking-apps'
import { friendlyErrorFor, endpointUrl } from './api'
import { formatAccuracy } from './accuracy'
import { verifyUrlForLocale } from './verify-url'

describe('parking-apps · launchUrlFor (platform-aware, no invented schemes)', () => {
  it('iOS prefers a verified universal link, else the App Store', () => {
    expect(launchUrlFor(PARKING_APPS.easypark, 'ios')).toBe('https://invite.easypark.com/')
    // PayStay has no universal link → App Store page (never a guessed paystay://)
    expect(launchUrlFor(PARKING_APPS.paystay, 'ios')).toBe(PARKING_APPS.paystay.iosAppStore)
  })

  it('Android builds an intent:// keyed by the verified package + Play fallback', () => {
    const url = launchUrlFor(PARKING_APPS.easypark, 'android')
    expect(url).toBe(
      'intent://#Intent;package=net.easypark.android;scheme=https;' +
        'S.browser_fallback_url=' +
        encodeURIComponent(PARKING_APPS.easypark.playStore) +
        ';end',
    )
    expect(url).not.toContain('easypark://') // never an invented scheme
  })

  it('desktop falls back to the website', () => {
    expect(launchUrlFor(PARKING_APPS.paystay, 'desktop')).toBe('https://www.paystay.com.au/')
  })
})

describe('parking-apps · payAppsToShow', () => {
  it('always shows EasyPark + PayStay when nothing else is detected', () => {
    expect(payAppsToShow([]).map((a) => a.id)).toEqual(['easypark', 'paystay'])
  })

  it('promotes a sign-named app to the front (fuzzy match)', () => {
    expect(payAppsToShow(['Wilson Parking'])[0].id).toBe('wilson')
    expect(payAppsToShow(['Secure'])[0].id).toBe('secure')
  })

  it('caps the list at 3 even when several apps are named', () => {
    const out = payAppsToShow(['Wilson', 'Secure', 'OPark'])
    expect(out).toHaveLength(3)
    expect(out.map((a) => a.id)).toContain('wilson')
  })
})

describe('api · friendlyErrorFor — no raw system string ever reaches a user', () => {
  it('maps a known ERR_ code to friendly copy', () => {
    expect(friendlyErrorFor('ERR_SIGN_UNREADABLE')).toMatch(/couldn't read that sign/i)
    expect(friendlyErrorFor('ERR_IMAGE_TOO_LARGE')).toMatch(/too large/i)
  })

  it('collapses any unknown raw error (or null) to the generic retry line', () => {
    const generic = friendlyErrorFor(null)
    expect(generic).toMatch(/went wrong/i)
    // A raw AWS/validation string must NOT surface verbatim.
    expect(friendlyErrorFor('ValidationException: secret stack detail at 0x1234')).toBe(generic)
    expect(friendlyErrorFor(undefined)).toBe(generic)
  })
})

describe('api · endpointUrl (dev middleware path)', () => {
  it('routes to the /api dev middleware when no gateway URL is configured', () => {
    // VITE_API_URL is unset in the test env → dev branch.
    expect(endpointUrl('/sign-session')).toBe('/api/sign-session')
    expect(endpointUrl('/sign-translate')).toBe('/api/sign-translate')
  })
})

describe('accuracy · formatAccuracy unit-switch boundaries', () => {
  it('metres below 1km', () => {
    expect(formatAccuracy(5)).toBe('±5m')
    expect(formatAccuracy(53.4)).toBe('±53m')
    expect(formatAccuracy(999)).toBe('±999m')
  })
  it('one-decimal km from 1km to 10km', () => {
    expect(formatAccuracy(1000)).toBe('±1.0km')
    expect(formatAccuracy(1200)).toBe('±1.2km')
  })
  it('whole km at/above 10km', () => {
    expect(formatAccuracy(10000)).toBe('±10km')
    expect(formatAccuracy(53000)).toBe('±53km')
  })
  it('guards NaN/negative', () => {
    expect(formatAccuracy(NaN)).toBe('±?')
    expect(formatAccuracy(-1)).toBe('±?')
  })
})

describe('verify-url · verifyUrlForLocale', () => {
  it('English (with or without region) → root /verify/', () => {
    expect(verifyUrlForLocale('en')).toBe('/verify/')
    expect(verifyUrlForLocale('en-AU')).toBe('/verify/')
  })
  it('exact multi-tag locale kept', () => {
    expect(verifyUrlForLocale('zh-CN')).toBe('/verify/zh-CN/')
  })
  it('region tag stripped to a shipped primary', () => {
    expect(verifyUrlForLocale('ko-KR')).toBe('/verify/ko/')
    expect(verifyUrlForLocale('hi-IN')).toBe('/verify/hi/')
  })
  it('unsupported language falls back to English', () => {
    expect(verifyUrlForLocale('fr')).toBe('/verify/')
  })
})
