// @vitest-environment happy-dom
//
// The anonymous Settings view (build spec T4 items 1 and 2):
// - the driver name ("Your name on records you share", 60 characters);
// - My permits: type, issuing state, area or zone (resident and business
//   only), optional expiry, at most 3, delete; an accessible permit is
//   stored only after its warning has been shown and confirmed;
// - notifications on this device (PushManagementSection, moved here from
//   Account, with the reminder reliability line);
// - Account when signed in, sign-in when it is set up, neither otherwise.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { loadProfile, saveProfile } from '../lib/storage'
import type { DriverProfile, SavedPermit } from '../types'
import Settings from './Settings'

const push = vi.hoisted(() => ({
  state: 'default' as NotificationPermission | 'unsupported',
  subscribed: false,
}))
vi.mock('../lib/push', () => ({
  getPushPermissionState: () => push.state,
  hasActiveSubscription: async () => push.subscribed,
  subscribeToPush: async () => ({ ok: true }),
  unsubscribeFromPush: async () => true,
}))

const ACCESSIBLE_WARNING =
  'Saving this permit means its type is sent with each sign photo you scan, so the answer can include what the sign says about permits. Accessible permit details are health information. You can delete them any time.'
const RELIABILITY = "Reminders can be delayed or silenced, for example by Focus or battery saving. Don't rely on them alone."

const ANON: AuthContextValue = { user: null, loading: false, configured: false, refresh: async () => {}, signOut: () => {} }

function renderSettings(auth: AuthContextValue = ANON) {
  const props = { onBack: vi.fn(), onOpenAccount: vi.fn(), onSignIn: vi.fn(), onOpenPrivacy: vi.fn() }
  render(
    <AuthContext.Provider value={auth}>
      <Settings {...props} />
    </AuthContext.Provider>,
  )
  return props
}

const button = (name: string | RegExp) => screen.getByRole('button', { name })
const permit = (over: Partial<SavedPermit> = {}): SavedPermit => ({
  id: 'p1',
  type: 'resident',
  state: 'VIC',
  area: 'Area 25',
  expires_on: null,
  ...over,
})

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  localStorage.clear()
  push.state = 'default'
  push.subscribed = false
})
afterEach(() => cleanup())

describe('driver name', () => {
  it('saves "Your name on records you share" to the profile', () => {
    renderSettings()
    const input = screen.getByLabelText(/Your name on records you share/)
    expect(input.getAttribute('maxlength')).toBe('60')
    expect(button('Save name')).toHaveProperty('disabled', true)

    fireEvent.change(input, { target: { value: '  Sam Lee ' } })
    fireEvent.click(button('Save name'))

    expect(loadProfile().driver_name).toBe('Sam Lee')
    expect(screen.getByRole('status').textContent).toBe('Saved')
    expect((input as HTMLInputElement).value).toBe('Sam Lee')
    // Nothing left to save.
    expect(button('Save name')).toHaveProperty('disabled', true)
  })

  it('clears the saved name when emptied', () => {
    saveProfile({ driver_name: 'Sam', permits: [] })
    renderSettings()
    const input = screen.getByLabelText(/Your name on records you share/) as HTMLInputElement
    expect(input.value).toBe('Sam')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(button('Save name'))
    expect(loadProfile().driver_name).toBeNull()
  })

  it('keeps permits saved meanwhile in another tab', () => {
    renderSettings()
    saveProfile({ driver_name: null, permits: [permit()] })
    fireEvent.change(screen.getByLabelText(/Your name on records you share/), { target: { value: 'Sam' } })
    fireEvent.click(button('Save name'))
    expect(loadProfile()).toEqual({ driver_name: 'Sam', permits: [permit()] })
  })
})

describe('My permits', () => {
  it('saves a resident permit with its state, area and expiry', () => {
    renderSettings()
    expect(screen.getByText('No permits saved.')).toBeTruthy()
    fireEvent.click(button('Add a permit'))
    expect(button('Save permit')).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByLabelText('Resident parking permit'))
    fireEvent.change(screen.getByLabelText('State or territory that issued it'), { target: { value: 'VIC' } })
    fireEvent.change(screen.getByLabelText(/Area or zone on the permit/), { target: { value: 'Area 25' } })
    fireEvent.change(screen.getByLabelText(/Expiry date/), { target: { value: '2099-06-30' } })
    fireEvent.click(button('Save permit'))

    const [saved] = loadProfile().permits
    expect(saved).toMatchObject({ type: 'resident', state: 'VIC', area: 'Area 25', expires_on: '2099-06-30' })
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/)
    // Listed, and the form is closed.
    const item = screen.getByRole('listitem')
    expect(within(item).getByText('Resident parking permit')).toBeTruthy()
    expect(within(item).getByText('Victoria · Area or zone: Area 25')).toBeTruthy()
    expect(within(item).getByText('Expires 30 June 2099')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save permit' })).toBeNull()
  })

  it('asks no area for an accessible permit', () => {
    renderSettings()
    fireEvent.click(button('Add a permit'))
    fireEvent.click(screen.getByLabelText('Business parking permit'))
    expect(screen.getByLabelText(/Area or zone on the permit/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Accessible parking permit'))
    expect(screen.queryByLabelText(/Area or zone on the permit/)).toBeNull()
  })

  it('shows the accessible-permit warning before saving, and saves only on confirm', () => {
    renderSettings()
    fireEvent.click(button('Add a permit'))
    fireEvent.click(screen.getByLabelText('Accessible parking permit'))
    fireEvent.change(screen.getByLabelText('State or territory that issued it'), { target: { value: 'NSW' } })
    expect(screen.queryByText(ACCESSIBLE_WARNING)).toBeNull()

    fireEvent.click(button('Save permit'))
    expect(screen.getByRole('alert').textContent).toContain(ACCESSIBLE_WARNING)
    expect(loadProfile().permits).toEqual([])

    fireEvent.click(button('Save this permit'))
    expect(loadProfile().permits).toEqual([expect.objectContaining({ type: 'accessible', state: 'NSW', area: null })])
    expect(screen.queryByText(ACCESSIBLE_WARNING)).toBeNull()
  })

  it('moves focus to the warning, then back to "Add a permit" when it is saved or cancelled', () => {
    renderSettings()
    fireEvent.click(button('Add a permit'))
    fireEvent.click(screen.getByLabelText('Accessible parking permit'))
    const save = button('Save permit')
    save.focus()
    fireEvent.click(save)
    // "Save permit" is gone; focus is on the warning, not lost to the page.
    const warning = screen.getByRole('alert')
    expect(document.activeElement).toBe(warning)

    fireEvent.click(within(warning).getByRole('button', { name: 'Cancel' }))
    expect(document.activeElement).toBe(button('Add a permit'))

    fireEvent.click(button('Add a permit'))
    fireEvent.click(screen.getByLabelText('Accessible parking permit'))
    fireEvent.click(button('Save permit'))
    fireEvent.click(button('Save this permit'))
    expect(loadProfile().permits).toHaveLength(1)
    expect(document.activeElement).toBe(button('Add a permit'))
  })

  it('stores nothing when the warning is cancelled', () => {
    renderSettings()
    fireEvent.click(button('Add a permit'))
    fireEvent.click(screen.getByLabelText('Accessible parking permit'))
    fireEvent.click(button('Save permit'))
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Cancel' }))
    expect(loadProfile().permits).toEqual([])
    expect(screen.queryByText(ACCESSIBLE_WARNING)).toBeNull()
    expect(button('Add a permit')).toBeTruthy()
  })

  it('asks again after the form changes', () => {
    renderSettings()
    fireEvent.click(button('Add a permit'))
    fireEvent.click(screen.getByLabelText('Accessible parking permit'))
    fireEvent.click(button('Save permit'))
    expect(screen.getByText(ACCESSIBLE_WARNING)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/Expiry date/), { target: { value: '2099-01-01' } })
    expect(screen.queryByText(ACCESSIBLE_WARNING)).toBeNull()
    fireEvent.click(button('Save permit'))
    expect(loadProfile().permits).toEqual([])
    expect(screen.getByText(ACCESSIBLE_WARNING)).toBeTruthy()
  })

  it('saves a resident or business permit without the accessible warning', () => {
    renderSettings()
    fireEvent.click(button('Add a permit'))
    fireEvent.click(screen.getByLabelText('Business parking permit'))
    fireEvent.click(button('Save permit'))
    expect(screen.queryByText(ACCESSIBLE_WARNING)).toBeNull()
    expect(loadProfile().permits).toEqual([expect.objectContaining({ type: 'business', state: null, area: null })])
  })

  it('stops at 3 permits', () => {
    saveProfile({
      driver_name: null,
      permits: [permit({ id: 'a' }), permit({ id: 'b', type: 'business' }), permit({ id: 'c', type: 'accessible' })],
    })
    renderSettings()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Add a permit' })).toBeNull()
    expect(screen.getByText('You can save up to 3 permits.')).toBeTruthy()
  })

  it('deletes a permit', () => {
    saveProfile({ driver_name: 'Sam', permits: [permit({ id: 'a' }), permit({ id: 'b', type: 'accessible', area: null })] })
    renderSettings()
    fireEvent.click(button('Delete Accessible parking permit'))
    expect(loadProfile()).toEqual({ driver_name: 'Sam', permits: [permit({ id: 'a' })] })
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('says when a permit has expired and is no longer sent', () => {
    saveProfile({ driver_name: null, permits: [permit({ expires_on: '2020-01-31' })] })
    renderSettings()
    expect(screen.getByText("Expired 31 January 2020. It isn't sent with your scans.")).toBeTruthy()
  })

  it('says so when storage is full, and keeps the form', () => {
    renderSettings()
    fireEvent.click(button('Add a permit'))
    fireEvent.click(screen.getByLabelText('Resident parking permit'))
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
    const failing = {
      getItem: (k: string) => original.value?.getItem?.(k) ?? null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError')
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    }
    Object.defineProperty(globalThis, 'localStorage', { value: failing, configurable: true, writable: true })
    try {
      fireEvent.click(button('Save permit'))
    } finally {
      Object.defineProperty(globalThis, 'localStorage', original)
    }
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('errors.storageFull'))
    expect(button('Save permit')).toBeTruthy()
    expect(loadProfile().permits).toEqual([])
  })
})

describe('notifications', () => {
  it('shows the push section with the reliability line', async () => {
    renderSettings()
    expect(screen.getByText('Push notifications on this device')).toBeTruthy()
    expect(screen.getByText(RELIABILITY)).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Enable push' })).toBeTruthy()
  })

  it('explains an unsupported browser instead of hiding the section', () => {
    push.state = 'unsupported'
    renderSettings()
    expect(screen.getByText('Push notifications on this device')).toBeTruthy()
    expect(screen.getByText(/This browser can't show reminders while ParkProof is closed/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enable push' })).toBeNull()
    // Calendar reminders still work there, so the reliability line still applies.
    expect(screen.getByText(RELIABILITY)).toBeTruthy()
  })

  it('keeps saying notifications are blocked once the subscription check is back', async () => {
    push.state = 'denied'
    renderSettings()
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.getByText(/You've blocked notifications for this site/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enable push' })).toBeNull()
  })
})

describe('account', () => {
  it('links to Account when signed in', () => {
    const props = renderSettings({
      ...ANON,
      configured: true,
      user: { userId: 'u-1', email: 'sam@example.com' } as AuthContextValue['user'],
    })
    expect(screen.getByText('sam@example.com')).toBeTruthy()
    fireEvent.click(button('Open account'))
    expect(props.onOpenAccount).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
  })

  it('offers sign-in when it is set up and nobody is signed in', () => {
    const props = renderSettings({ ...ANON, configured: true })
    fireEvent.click(button('Sign in'))
    expect(props.onSignIn).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Open account' })).toBeNull()
  })

  it('shows neither without sign-in, and everything else still works', () => {
    renderSettings()
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open account' })).toBeNull()
    expect(button('Add a permit')).toBeTruthy()
  })

  it('opens the privacy policy and goes back', () => {
    const props = renderSettings()
    fireEvent.click(button('Open privacy policy'))
    expect(props.onOpenPrivacy).toHaveBeenCalledTimes(1)
    fireEvent.click(button(/Back/))
    expect(props.onBack).toHaveBeenCalledTimes(1)
  })
})

describe('profile shape', () => {
  it('stores exactly the profile shape under parkproof.profile.v1', () => {
    renderSettings()
    fireEvent.change(screen.getByLabelText(/Your name on records you share/), { target: { value: 'Sam' } })
    fireEvent.click(button('Save name'))
    fireEvent.click(button('Add a permit'))
    fireEvent.click(screen.getByLabelText('Resident parking permit'))
    fireEvent.click(button('Save permit'))
    const stored = JSON.parse(localStorage.getItem('parkproof.profile.v1')!) as DriverProfile
    expect(Object.keys(stored).sort()).toEqual(['driver_name', 'permits'])
    expect(Object.keys(stored.permits[0]).sort()).toEqual(['area', 'expires_on', 'id', 'state', 'type'])
  })
})
