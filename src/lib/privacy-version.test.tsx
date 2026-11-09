// @vitest-environment happy-dom
//
// The privacy policy's "Last updated" date (fix round 1). The screen used to
// show the day it was opened (new Date()), so it always said the policy had
// changed today. It now shows PRIVACY_LAST_UPDATED, and this test fails when
// any privacy.* string in any locale changes while that date doesn't: the
// fingerprint below is of the text as it stood on that date. When you change
// the text, set PRIVACY_LAST_UPDATED to the day of the change and update both
// values in PINNED.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import en from '../locales/en.json'
import zhCN from '../locales/zh-CN.json'
import vi_ from '../locales/vi.json'
import id from '../locales/id.json'
import ko from '../locales/ko.json'
import it_ from '../locales/it.json'
import el from '../locales/el.json'
import hi from '../locales/hi.json'
import pa from '../locales/pa.json'
import i18n from './i18n'
import { sha256HexUtf8 } from './hash'
import { PRIVACY_LAST_UPDATED, privacyLastUpdatedLabel } from './privacy-version'
import PrivacyPolicy from '../components/PrivacyPolicy'

const PINNED = {
  date: '2026-11-09',
  // Fix round 2 (same day): privacy.anonymousCloudwatch now names every
  // field of the feedback log line. T10 (same day): the translation review
  // rewrote privacy.* strings in vi, id, el, hi and pa. T10 review fixes
  // (same day): vi privacy.anonymousCloudwatch says the permit was
  // "displayed" (hiển thị) again, not just placed in the car.
  sha256: '896a95f27e8a60944455d8305aa2b0c0733c554de8980e37d0f992413e348cb0',
}

/** Every locale's privacy.* strings, in the locales' fixed order. */
function privacyText(): string {
  const all = { en, 'zh-CN': zhCN, vi: vi_, id, ko, it: it_, el, hi, pa }
  return JSON.stringify(Object.fromEntries(Object.entries(all).map(([locale, data]) => [locale, data.privacy])))
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('the privacy policy date', () => {
  it('moves with the text: change a privacy string, change the date', async () => {
    const now = { date: PRIVACY_LAST_UPDATED, sha256: await sha256HexUtf8(privacyText()) }
    expect(
      now,
      'privacy.* text changed: set PRIVACY_LAST_UPDATED (src/lib/privacy-version.ts) to the day of the change, then update PINNED here',
    ).toEqual(PINNED)
  })

  it('is a real calendar date, written the way the app writes dates', () => {
    expect(PRIVACY_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(privacyLastUpdatedLabel()).toBe('9 November 2026')
  })

  it('shows that date on the screen, not the day it is opened', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-03-15T02:00:00Z'))
    render(<PrivacyPolicy onBack={vi.fn()} />)
    expect(screen.getByText(i18n.t('privacy.lastUpdated', { date: '9 November 2026' }))).toBeTruthy()
    expect(screen.queryByText(/15 March 2027/)).toBeNull()
  })
})
