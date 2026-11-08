// @vitest-environment happy-dom
//
// The one-time backup prompt (build spec T2, item 12): after the first
// signed photo, once, add to Home Screen or sign in to back up, with
// Safari's 7-day reason. Never for a driver who is signed in or uses the
// Home Screen app, never before a photo is signed, and never twice.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { BACKUP_PROMPT_KEY, backupPromptShown, shouldOfferBackup } from '../lib/backup-prompt'
import { saveSession, setArrivalSignature } from '../lib/storage'
import type { ParkingSession, SignatureBundle } from '../types'
import BackupPrompt from './BackupPrompt'

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-backup',
    arrived_at: '2026-11-08T01:00:00.000Z',
    location: null,
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    photos: [{ role: 'sign', sha256: 'a'.repeat(64), captured_at: '2026-11-08T01:00:00.000Z', source: 'camera_input' }],
    ...overrides,
  }
}

const LINK0: SignatureBundle = {
  schema: 'parkproof-evidence-v2',
  signed_at: '2026-11-08T01:00:05.000Z',
  algorithm: 'ECDSA_SHA_256',
  key_alias: 'alias/parkproof-evidence-signing',
  canonical_payload: JSON.stringify({ schema: 'parkproof-evidence-v2', sign_photo_sha256: 'a'.repeat(64) }),
  signature_base64: 'MEUCIQ',
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'matchMedia', {
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    configurable: true,
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('shouldOfferBackup', () => {
  const signed = record({ signature: LINK0 })
  it('only after a photo is inside a stored signature', () => {
    expect(shouldOfferBackup({ sessions: [record()], signedIn: false, standalone: false, shown: false })).toBe(false)
    expect(shouldOfferBackup({ sessions: [signed], signedIn: false, standalone: false, shown: false })).toBe(true)
  })
  it('never when signed in, opened from the Home Screen, or shown before', () => {
    expect(shouldOfferBackup({ sessions: [signed], signedIn: true, standalone: false, shown: false })).toBe(false)
    expect(shouldOfferBackup({ sessions: [signed], signedIn: false, standalone: true, shown: false })).toBe(false)
    expect(shouldOfferBackup({ sessions: [signed], signedIn: false, standalone: false, shown: true })).toBe(false)
  })
})

describe('BackupPrompt', () => {
  it('appears when the first photo gets signed, once, with the 7-day reason; Not now closes it for good', () => {
    saveSession(record())
    const onSignIn = vi.fn()
    const first = render(<BackupPrompt enabled signedIn={false} canSignIn onSignIn={onSignIn} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    // Link 0 lands in the background: the prompt follows the records-changed event.
    act(() => {
      setArrivalSignature('rec-backup', LINK0)
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText(i18n.t('backupPrompt.title'))).toBeTruthy()
    expect(screen.getByText(/Safari can clear a site's data after 7 days without a visit/)).toBeTruthy()
    expect(backupPromptShown()).toBe(true)
    expect(localStorage.getItem(BACKUP_PROMPT_KEY)).toBe('1')

    fireEvent.click(screen.getByRole('button', { name: i18n.t('backupPrompt.dismiss') }))
    expect(screen.queryByRole('dialog')).toBeNull()
    first.unmount()

    // Another screen, later: never again.
    render(<BackupPrompt enabled signedIn={false} canSignIn onSignIn={onSignIn} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Sign in to back up" goes to sign-in; without sign-in set up, only the Home Screen advice shows', () => {
    saveSession(record({ signature: LINK0 }))
    const onSignIn = vi.fn()
    render(<BackupPrompt enabled signedIn={false} canSignIn onSignIn={onSignIn} />)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('backupPrompt.signIn') }))
    expect(onSignIn).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()

    localStorage.removeItem(BACKUP_PROMPT_KEY)
    render(<BackupPrompt enabled signedIn={false} canSignIn={false} onSignIn={onSignIn} />)
    expect(screen.queryByRole('button', { name: i18n.t('backupPrompt.signIn') })).toBeNull()
    expect(screen.getByText(i18n.t('backupPrompt.homeScreenOther'))).toBeTruthy()
  })

  it('Escape closes it; it waits while sign-in is resolving and never shows to a signed-in driver', () => {
    saveSession(record({ signature: LINK0 }))
    const { rerender } = render(<BackupPrompt enabled={false} signedIn={false} canSignIn onSignIn={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(backupPromptShown()).toBe(false)
    rerender(<BackupPrompt enabled signedIn canSignIn onSignIn={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(backupPromptShown()).toBe(false)
    rerender(<BackupPrompt enabled signedIn={false} canSignIn onSignIn={() => {}} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('on an iPhone it explains Share, then Add to Home Screen', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    )
    saveSession(record({ signature: LINK0 }))
    render(<BackupPrompt enabled signedIn={false} canSignIn onSignIn={() => {}} />)
    expect(screen.getByText(i18n.t('backupPrompt.homeScreenIos'))).toBeTruthy()
  })
})
