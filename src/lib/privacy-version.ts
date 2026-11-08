/**
 * The day the privacy policy's text last changed, as YYYY-MM-DD. The
 * policy screen shows it as "Last updated" (PrivacyPolicy.tsx). It used to
 * show the day it was opened, so every visit said the policy had just
 * changed, and nobody could tell when a statement really did.
 *
 * Change it in the same commit as any privacy.* string in any locale, and
 * update the fingerprint in privacy-version.test.tsx with it: that test fails
 * when the text changes and this date doesn't.
 */
export const PRIVACY_LAST_UPDATED = '2026-11-09'

/** PRIVACY_LAST_UPDATED written the way the app writes dates ("9 November 2026"). */
export function privacyLastUpdatedLabel(): string {
  return new Date(`${PRIVACY_LAST_UPDATED}T00:00:00Z`).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
