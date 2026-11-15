// @vitest-environment happy-dom
//
// Account, "Delete forever": the account is deleted on the server first,
// then the user is signed out, and only then is this device cleared, as the
// delete text promises ("Local records on this device are also cleared as
// part of the sign-out that follows"). The screen is left once the records
// are gone, without waiting for the photo store. Nothing leaves the screen
// while the delete runs, and a failed delete clears nothing.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import type { LocalWipeResult } from '../lib/local-wipe'

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  deleteAccount: vi.fn(async () => {}),
  clearLocalRecords: vi.fn(async (): Promise<LocalWipeResult> => ({ records: 0, photos: 0, pushCancels: [] })),
}))
vi.mock('../lib/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/sync')>()),
  deleteAccount: mocks.deleteAccount,
}))
vi.mock('../lib/local-wipe', () => ({ clearLocalRecords: mocks.clearLocalRecords }))

import AuthSettings from './AuthSettings'

const en = (key: string) => i18n.t(key)

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** The Account screen with "DELETE" typed in, ready for a tap on Delete forever. */
function renderAccount({
  onDeleted = vi.fn(),
  onBack = vi.fn(),
  onOpenPrivacy = vi.fn(),
}: { onDeleted?: () => void; onBack?: () => void; onOpenPrivacy?: () => void } = {}) {
  const signOut = vi.fn(() => {
    mocks.order.push('signOut')
  })
  const auth: AuthContextValue = {
    user: { userId: 'u-1', email: 'sam@example.com' } as AuthContextValue['user'],
    loading: false,
    configured: true,
    refresh: async () => {},
    signOut,
  }
  render(
    <AuthContext.Provider value={auth}>
      <AuthSettings onBack={onBack} onOpenPrivacy={onOpenPrivacy} onDeleted={onDeleted} />
    </AuthContext.Provider>,
  )
  fireEvent.click(screen.getByRole('button', { name: en('settings.deleteStart') }))
  fireEvent.change(screen.getByLabelText(en('settings.deleteConfirmLabel')), { target: { value: 'DELETE' } })
  const deleteForever = screen.getByRole('button', { name: en('settings.deleteForever') })
  return { signOut, onDeleted, deleteForever }
}

const button = (key: string) => screen.getByRole('button', { name: en(key) }) as HTMLButtonElement

beforeEach(() => {
  mocks.order.length = 0
  mocks.deleteAccount.mockReset().mockImplementation(async () => {
    mocks.order.push('deleteAccount')
  })
  mocks.clearLocalRecords.mockReset().mockImplementation(async () => {
    mocks.order.push('clearLocalRecords')
    return { records: 2, photos: 3, pushCancels: [] }
  })
})

afterEach(() => cleanup())

describe('Delete forever', () => {
  it('deletes the account, signs out, then clears this device, then leaves', async () => {
    const onDeleted = vi.fn(() => {
      mocks.order.push('onDeleted')
    })
    const { deleteForever } = renderAccount({ onDeleted })
    fireEvent.click(deleteForever)
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(mocks.order).toEqual(['deleteAccount', 'signOut', 'clearLocalRecords', 'onDeleted'])
  })

  it('leaves once the clearing has started, without waiting for the photo store', async () => {
    const photoStoreCleared = deferred<LocalWipeResult>()
    mocks.clearLocalRecords.mockImplementation(() => {
      mocks.order.push('clearLocalRecords')
      return photoStoreCleared.promise
    })
    const onDeleted = vi.fn(() => {
      mocks.order.push('onDeleted')
    })
    const { deleteForever } = renderAccount({ onDeleted })
    fireEvent.click(deleteForever)
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(mocks.order).toEqual(['deleteAccount', 'signOut', 'clearLocalRecords', 'onDeleted'])
    photoStoreCleared.resolve({ records: 2, photos: 3, pushCancels: [] })
  })

  it('a double tap on Delete forever deletes the account once', async () => {
    const answered = deferred()
    mocks.deleteAccount.mockImplementation(async () => {
      mocks.order.push('deleteAccount')
      await answered.promise
    })
    const { deleteForever, onDeleted } = renderAccount()
    fireEvent.click(deleteForever)
    fireEvent.click(deleteForever)
    answered.resolve()
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(mocks.deleteAccount).toHaveBeenCalledTimes(1)
    expect(mocks.clearLocalRecords).toHaveBeenCalledTimes(1)
    expect(onDeleted).toHaveBeenCalledTimes(1)
  })

  it('nothing leaves the screen while the account is being deleted', async () => {
    const answered = deferred()
    mocks.deleteAccount.mockImplementation(async () => {
      await answered.promise
    })
    const onBack = vi.fn()
    const onOpenPrivacy = vi.fn()
    const { deleteForever, signOut, onDeleted } = renderAccount({ onBack, onOpenPrivacy })
    fireEvent.click(deleteForever)
    const ways = [button('common.back'), button('settings.privacyCta'), button('settings.signOutCta')]
    expect(ways.map((b) => b.disabled)).toEqual([true, true, true])
    for (const way of ways) fireEvent.click(way)
    expect(onBack).not.toHaveBeenCalled()
    expect(onOpenPrivacy).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
    answered.resolve()
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
  })

  it('a failed delete clears nothing, keeps the user signed in and says so in their language', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // What expectJson throws for a failed /me/delete: the status and the
    // server's own English text.
    const raw = new Error('API 500: Could not delete all rows, please try again.')
    mocks.deleteAccount.mockImplementation(async () => {
      throw raw
    })
    const { deleteForever, signOut, onDeleted } = renderAccount()
    fireEvent.click(deleteForever)
    expect(await screen.findByText(en('errors.deleteAccountFailed'))).toBeTruthy()
    // The raw API text never reaches the screen, only the console.
    expect(document.body.textContent).not.toContain('API 500')
    expect(document.body.textContent).not.toContain('Could not delete all rows')
    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/^\[account\] /), raw)
    expect(signOut).not.toHaveBeenCalled()
    expect(mocks.clearLocalRecords).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
    // The driver can leave again, having seen it fail.
    expect(button('common.back').disabled).toBe(false)
  })

  it('the failed delete line is translated, and says the records here are still here', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.deleteAccount.mockImplementation(async () => {
      throw new Error('API 500: ERR_INTERNAL')
    })
    await i18n.changeLanguage('it')
    try {
      const { deleteForever } = renderAccount()
      fireEvent.click(deleteForever)
      expect(await screen.findByText(i18n.t('errors.deleteAccountFailed'))).toBeTruthy()
      expect(i18n.t('errors.deleteAccountFailed')).not.toBe(i18n.t('errors.deleteAccountFailed', { lng: 'en' }))
      expect(document.body.textContent).not.toContain('ERR_INTERNAL')
    } finally {
      await i18n.changeLanguage('en')
    }
    expect(en('errors.deleteAccountFailed')).toContain('Your records on this device are still here')
  })

  it('if clearing this device fails, the deleted account still signs out and leaves', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.clearLocalRecords.mockImplementation(async () => {
      mocks.order.push('clearLocalRecords')
      throw new Error('storage broke')
    })
    const { deleteForever, signOut, onDeleted } = renderAccount()
    fireEvent.click(deleteForever)
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(signOut).toHaveBeenCalled()
    expect(mocks.clearLocalRecords).toHaveBeenCalled()
    // The failure is caught and logged, never left unhandled.
    await waitFor(() => expect(warn).toHaveBeenCalledWith('[account] clearing this device failed:', expect.any(Error)))
  })

  it('the delete text still promises that this device is cleared', () => {
    expect(en('settings.deleteCopy')).toContain('Local records on this device are also cleared')
  })
})

describe('Account, signed out while it is open', () => {
  const props = { onBack: vi.fn(), onOpenPrivacy: vi.fn(), onDeleted: vi.fn() }
  const authValue = (overrides: Partial<AuthContextValue> = {}): AuthContextValue => ({
    user: null,
    loading: false,
    configured: true,
    refresh: async () => {},
    signOut: vi.fn(),
    ...overrides,
  })

  it('says the account was deleted when that is why, and that the records here stay, never which device deleted it', () => {
    render(
      <AuthContext.Provider value={authValue({ accountDeletedNotice: true })}>
        <AuthSettings {...props} />
      </AuthContext.Provider>,
    )
    expect(screen.getByText(en('settings.accountDeletedNotice'))).toBeTruthy()
    expect(screen.queryByText(en('settings.youSignedOut'))).toBeNull()
    // The same notice follows this device's own Delete forever whose answer
    // was lost, so it can't say "on another device".
    expect(en('settings.accountDeletedNotice')).toBe(
      "Your account was deleted, so you're signed out on this device. Your records on this device are still here.",
    )
  })

  it('otherwise says only that you are signed out', () => {
    render(
      <AuthContext.Provider value={authValue()}>
        <AuthSettings {...props} />
      </AuthContext.Provider>,
    )
    expect(screen.getByText(en('settings.youSignedOut'))).toBeTruthy()
    expect(screen.queryByText(en('settings.accountDeletedNotice'))).toBeNull()
  })

  it('never leaves Account on its own, nor clears this device, nor deletes anything', () => {
    render(
      <AuthContext.Provider value={authValue({ accountDeletedNotice: true })}>
        <AuthSettings {...props} />
      </AuthContext.Provider>,
    )
    expect(props.onDeleted).not.toHaveBeenCalled()
    expect(mocks.clearLocalRecords).not.toHaveBeenCalled()
    expect(mocks.deleteAccount).not.toHaveBeenCalled()
  })
})
