// @vitest-environment happy-dom
//
// The reliability line and the Reconnect fix (review of the field-test
// build):
//   - every reminder feature carries the reliability line, including the
//     About push block (which also offers Reconnect);
//   - a driver whose reminder didn't arrive finds "Reminders not arriving?
//     Reconnect" in the Android tips on the reminder screens, not only in
//     About and account settings (fix list item 5: a registration that went
//     bad at the push service is fixed only by a fresh one);
//   - the About push copy no longer says allowing notifications makes
//     future reminders fire: nothing is set until Remind me is tapped.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import AboutFeatures from './AboutFeatures'
import { ReminderHelp } from './ReminderStatus'

const mocks = vi.hoisted(() => ({
  isAndroid: vi.fn(() => false),
  permission: vi.fn((): NotificationPermission | 'unsupported' => 'granted'),
  hasActiveSubscription: vi.fn(async () => true),
}))
vi.mock('../lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/platform')>()),
  isAndroid: mocks.isAndroid,
}))
vi.mock('../lib/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/push')>()),
  getPushPermissionState: mocks.permission,
  hasActiveSubscription: mocks.hasActiveSubscription,
}))

const reconnect = () => screen.queryByRole('button', { name: i18n.t('reminders.reconnect.cta') })
const reliability = () => i18n.t('reminders.reliability')

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  mocks.isAndroid.mockReturnValue(false)
  mocks.permission.mockReturnValue('granted')
  mocks.hasActiveSubscription.mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
})

describe('ReminderHelp', () => {
  it('on Android with notifications allowed, the tips offer Reconnect', () => {
    mocks.isAndroid.mockReturnValue(true)
    render(<ReminderHelp tone="vault" />)
    expect(screen.getByText(reliability())).toBeTruthy()
    expect(screen.getByText(i18n.t('reminders.androidTips.summary'))).toBeTruthy()
    const button = reconnect()
    expect(button).toBeTruthy()
    // Collapsed with the tips, so the common path doesn't get longer.
    expect(button!.closest('details')).toBeTruthy()
  })

  it('offers no Reconnect before notifications are allowed', () => {
    mocks.isAndroid.mockReturnValue(true)
    mocks.permission.mockReturnValue('default')
    render(<ReminderHelp tone="card" />)
    expect(screen.getByText(i18n.t('reminders.androidTips.summary'))).toBeTruthy()
    expect(reconnect()).toBeNull()
  })

  it('leaves Reconnect out where the surface has its own (reconnect={false})', () => {
    mocks.isAndroid.mockReturnValue(true)
    render(<ReminderHelp tone="card" reconnect={false} />)
    expect(screen.getByText(i18n.t('reminders.androidTips.battery'))).toBeTruthy()
    expect(reconnect()).toBeNull()
  })

  it('elsewhere shows the reliability line only', () => {
    render(<ReminderHelp tone="vault" />)
    expect(screen.getByText(reliability())).toBeTruthy()
    expect(screen.queryByText(i18n.t('reminders.androidTips.summary'))).toBeNull()
  })
})

describe('About: the push block', () => {
  it('carries the reliability line and promises no reminder by itself', async () => {
    render(<AboutFeatures onBack={() => {}} onTryIt={() => {}} />)
    expect(await screen.findByText(i18n.t('about.push.subscribed'))).toBeTruthy()
    expect(screen.getByText(reliability())).toBeTruthy()
    expect(screen.getAllByRole('button', { name: i18n.t('reminders.reconnect.cta') })).toHaveLength(1)
    const en = `${i18n.t('about.push.body')} ${i18n.t('about.push.subscribed')} ${i18n.t('settings.pushCopy')}`
    expect(en).not.toMatch(/fire/i)
    expect(en).toContain('Remind me')
  })
})
