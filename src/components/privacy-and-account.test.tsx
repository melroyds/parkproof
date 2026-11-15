// @vitest-environment happy-dom
//
// Privacy policy (build spec T4 item 8) and the Account view (item 1):
// - anonymousIntro is the spec's wording, rendered as plain text;
// - the policy says what goes to the AI with each scan (the photo, its
//   location, the saved permit types) and that fine notice photos do too;
// - weekly reminders by push (T5b) are kept on the server while they are
//   on, unlike a record's push reminders, which go once sent;
// - Account no longer has the push section, which moved to Settings.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n, { SUPPORTED_LANGUAGES } from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { RECURRING_SCHEDULE_DAYS } from '../../lambda/recurring-schedule.js'
import AuthSettings from './AuthSettings'
import PrivacyPolicy from './PrivacyPolicy'

vi.mock('../lib/push', () => ({
  getPushPermissionState: () => 'default',
  hasActiveSubscription: async () => false,
  subscribeToPush: async () => ({ ok: true }),
  unsubscribeFromPush: async () => true,
}))

const ANONYMOUS_INTRO =
  "ParkProof works without an account. Your records are stored in this browser. To sign a record, your phone sends its details (times, location, what you entered, and photo fingerprints, not the photos) to ParkProof's server, which signs them and doesn't keep a copy."

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
afterEach(() => cleanup())

describe('PrivacyPolicy', () => {
  it('opens with the anonymous-use paragraph exactly as specified', () => {
    render(<PrivacyPolicy onBack={() => {}} />)
    expect(screen.getByText(ANONYMOUS_INTRO)).toBeTruthy()
    expect(document.body.textContent).not.toContain('localStorage')
    expect(document.body.textContent).not.toMatch(/never leave your device/i)
  })

  it('lists what each scan sends to the AI: the photo, its location and the saved permit types', () => {
    render(<PrivacyPolicy onBack={() => {}} />)
    const item = screen.getByText('Each sign photo you scan').closest('li')!
    expect(item.textContent).toContain('Anthropic')
    expect(item.textContent).toMatch(/with its location/)
    expect(item.textContent).toMatch(/the type of each permit you've saved/)
    expect(item.textContent).toMatch(/area or zone of a resident or business permit/)
  })

  it('lists infringement notice photos as sent to the AI', () => {
    render(<PrivacyPolicy onBack={() => {}} />)
    const item = screen.getByText('Photos of an infringement notice').closest('li')!
    expect(item.textContent).toMatch(/sent to Anthropic to read the notice/)
    expect(item.textContent).toMatch(/parking record you chose/)
  })

  it('no longer counts "three things"', () => {
    render(<PrivacyPolicy onBack={() => {}} />)
    expect(screen.getByText('These also leave your device, even without an account:')).toBeTruthy()
    const list = screen.getByText('Each sign photo you scan').closest('ul')!
    expect(list.querySelectorAll('li')).toHaveLength(6)
  })

  it('lists push reminders, whose text can mention a permit time, as kept on the server until sent', () => {
    render(<PrivacyPolicy onBack={() => {}} />)
    const item = screen.getByText('Push reminders').closest('li')!
    expect(item.closest('ul')).toBe(screen.getByText('Each sign photo you scan').closest('ul'))
    expect(item.textContent).toMatch(/address, each reminder's time and its text/)
    expect(item.textContent).toMatch(/can mention a permit time you entered/)
    expect(item.textContent).toMatch(/keeps each one until it is sent, then deletes it/)
  })

  it('lists weekly push reminders as kept on the server while they are on, and when they are deleted', () => {
    render(<PrivacyPolicy onBack={() => {}} />)
    const item = screen.getByText('Weekly reminders by push').closest('li')!
    expect(item.closest('ul')).toBe(screen.getByText('Each sign photo you scan').closest('ul'))
    expect(item.textContent).toMatch(
      /name and any address you entered, its days, times, repeat pattern and time zone, when it should remind you, and its notification text/,
    )
    // Each schedule's Target Input carries the device id (lambda/recurring-schedule.js recurringDispatchInput).
    expect(item.textContent).toMatch(/with a random ID for this device/)
    expect(item.textContent).toMatch(/keeps them while the reminder is on/)
    // The phone's cancel (recurring-push.ts reconcile) runs while the app is open and online.
    expect(item.textContent).toMatch(
      /deleted when you pause or delete the reminder or switch off its notifications, the next time ParkProof is open and online/,
    )
    // The server's weekly schedules end and delete themselves this long after the phone last booked them.
    expect(item.textContent).toContain(`the server keeps them for ${RECURRING_SCHEDULE_DAYS} days at most`)
    expect(item.textContent).toContain(`they're deleted within ${RECURRING_SCHEDULE_DAYS} days of the last time you opened ParkProof.`)
    // Not the one-off promise the record reminders make.
    expect(item.textContent).not.toMatch(/until it is sent/)
  })

  it('says a permit used for a park stays with its record, is signed only as a fingerprint, and goes with the record to the cloud', () => {
    render(<PrivacyPolicy onBack={() => {}} />)
    const local = screen.getByText('A permit you use for a park').closest('p')!
    expect(local.textContent).toMatch(/kept with that record/)
    expect(local.textContent).toMatch(/sends a fingerprint of these details, not the details/)
    expect(local.textContent).toMatch(/answers to the permit questions/)
    // Deleting the saved permit doesn't reach records already saved.
    expect(local.textContent).toMatch(/Deleting a permit in Settings doesn't change records already saved/)

    const cloud = screen.getByText('Permit details').closest('li')!
    expect(cloud.closest('ul')).toBe(screen.getByText('parking record').closest('ul'))
    expect(cloud.textContent).toMatch(/stored with that record in AWS DynamoDB/)
    expect(cloud.textContent).toMatch(/saved permits in Settings aren't/)
  })

  it('says Delete removes every record and photo, not "every DynamoDB row": the delete itself writes one (the marker)', () => {
    render(<PrivacyPolicy onBack={() => {}} />)
    const deleteItem = screen.getByText('Delete.').closest('li')!
    expect(deleteItem.textContent).toMatch(/Removes your sign-in record and every record and photo stored for your account, within seconds\./)
    expect(deleteItem.textContent).not.toMatch(/DynamoDB row/)
  })

  it('says, right after Delete, what deleting the account keeps, what the logs record, and that records on another device stay there', () => {
    render(<PrivacyPolicy onBack={() => {}} />)
    const deleteItem = screen.getByText('Delete.').closest('li')!
    const next = deleteItem.nextElementSibling as HTMLElement
    expect(next.tagName).toBe('LI')
    expect(next.textContent).toBe(i18n.t('privacy.rightsDeleteOtherDevices'))
    // The marker holds the account's ID and when it was deleted, for a few
    // days, so a device still signed in to it is refused (HTTP 410) instead
    // of uploading into it again (src/lib/sync.ts authFetch).
    expect(next.textContent).toMatch(
      /we keep its random ID and the deletion time for a few days, so a device still signed in to it can't upload records again/,
    )
    // No "nothing else": the logs keep that ID too ([parkproof.me.delete]
    // and [parkproof.account] in lambda/cloud-sync.js), for 90 days.
    expect(next.textContent).not.toMatch(/nothing else/)
    expect(next.textContent).toMatch(/Our server's logs also record that ID when you delete the account and each time such a device is refused/)
    // A record's ID is logged only when the row a refused device uploaded
    // can't be deleted again (deleteRowBestEffort), not for any failed removal.
    expect(next.textContent).toMatch(
      /If a record from such a device can't be removed, the log also gives that record's random ID\. The logs are deleted after 90 days\./,
    )
    // Signing that device out never clears it (src/lib/auth-context.tsx):
    // its own records and those it pulled from the account alike.
    expect(next.textContent).toMatch(/Your records on another device stay on that device until you delete them there/)
    // Greek names the record whose ID is logged, not the log (both are αρχείο).
    expect(i18n.t('privacy.rightsDeleteOtherDevices', { lng: 'el' })).toContain(
      'το τυχαίο αναγνωριστικό εκείνου του αρχείου',
    )
  })

  it.each(SUPPORTED_LANGUAGES.map((l) => l.code))(
    'in %s, the delete statement says "a few days" in words, and its one number is the logs\' 90 days',
    (lng) => {
      const text = i18n.t('privacy.rightsDeleteOtherDevices', { lng })
      expect(text).not.toBe('privacy.rightsDeleteOtherDevices')
      if (lng !== 'en') expect(text).not.toBe(i18n.t('privacy.rightsDeleteOtherDevices', { lng: 'en' }))
      expect(text).toMatch(/(^|\D)90(\D|$)/)
      // ASCII, Devanagari, Gurmukhi and full-width digits, once the 90 is out.
      expect(text.split('90').join('')).not.toMatch(/[0-9०-९੦-੯０-９]/)
    },
  )
})

describe('AuthSettings (Account)', () => {
  it('has no push notification section any more', () => {
    const auth: AuthContextValue = {
      user: { userId: 'u-1', email: 'sam@example.com' } as AuthContextValue['user'],
      loading: false,
      configured: true,
      refresh: async () => {},
      signOut: () => {},
    }
    render(
      <AuthContext.Provider value={auth}>
        <AuthSettings onBack={() => {}} onOpenPrivacy={() => {}} onDeleted={() => {}} />
      </AuthContext.Provider>,
    )
    expect(screen.getByText('Account')).toBeTruthy()
    expect(screen.getByText('sam@example.com')).toBeTruthy()
    expect(screen.queryByText('Push notifications on this device')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enable push' })).toBeNull()
  })
})
