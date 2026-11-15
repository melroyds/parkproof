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
  date: '2026-11-15',
  // Delete hardening: privacy.rightsDeleteOtherDevices (what is kept after
  // Delete forever, and why) is new in all 9 locales. Its review fixes (same
  // day): it names the server's log lines and their 90 days instead of
  // saying "and nothing else", Italian says "ancora connesso" (still signed
  // in), and privacy.rightsDelete says every record and photo goes instead
  // of "every DynamoDB row" (the delete writes one, the marker). A second
  // review (same day): a record's ID is logged only when a refused device's
  // record can't be removed, "your records on another device" covers the
  // ones it pulled, "the deletion time for a few days" can't read as
  // "deleted it for a few days" (en, vi, id), and Greek names the record
  // whose ID is logged, not the log. Before it,
  // on 9 November: fix round 2 had privacy.anonymousCloudwatch name every
  // field of the feedback log line, the T10 translation review rewrote
  // privacy.* strings in vi, id, el, hi and pa, and its fixes had vi
  // privacy.anonymousCloudwatch say the permit was "displayed" (hiển thị)
  // again, not just placed in the car.
  sha256: 'a8d39fccf947db81f7dcfa211395d4bc154b6be25a31a2db417da3cc65dc29b1',
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
    expect(privacyLastUpdatedLabel()).toBe('15 November 2026')
  })

  it('shows that date on the screen, not the day it is opened', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-03-15T02:00:00Z'))
    render(<PrivacyPolicy onBack={vi.fn()} />)
    expect(screen.getByText(i18n.t('privacy.lastUpdated', { date: '15 November 2026' }))).toBeTruthy()
    expect(screen.queryByText(/15 March 2027/)).toBeNull()
  })
})
