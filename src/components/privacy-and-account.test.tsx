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
import i18n from '../lib/i18n'
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
