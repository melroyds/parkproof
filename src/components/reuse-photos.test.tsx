// @vitest-environment happy-dom
//
// The re-check entry points on the scan screen (T0b2): a re-check reuses
// the record's sign photo, so when that photo can't be read (its bytes
// aren't on this device) ReuseCard doesn't offer "Use this read again" and
// RecentScansPicker leaves the row out, instead of a tap that does nothing.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from '../lib/photo-store'
import type { ParkingSession, PhotoRef } from '../types'
import ReuseCard from './ReuseCard'
import RecentScansPicker from './RecentScansPicker'

const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)
const ref = (sha256: string): PhotoRef => ({
  role: 'sign',
  sha256,
  captured_at: '2026-10-25T00:58:00.000Z',
  source: 'camera_input',
})

function record(id: string, address: string, photos: PhotoRef[]): ParkingSession {
  return {
    id,
    arrived_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [{ scope: 'Sign', items: ['2P'] }],
    expires_at: null,
    confidence: 'high',
    photos,
  }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => setPhotoBackendForTests(createMemoryPhotoBackend()))
afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
})

describe('ReuseCard', () => {
  it('offers "Use this read again" when the sign photo is here', async () => {
    const sha = await putPhoto('kept-1', jpeg('sign'))
    render(<ReuseCard session={record('kept-1', '1 Kept St', [ref(sha)])} distanceMeters={12} onReuse={vi.fn()} onDismiss={vi.fn()} />)
    expect(await screen.findByRole('img', { name: i18n.t('reuse.signPhotoAlt') })).toBeTruthy()
    expect(screen.getByRole('button', { name: i18n.t('reuse.useThisRead') })).toBeTruthy()
  })

  it('without the sign photo bytes: the note and Dismiss, no "Use this read again"', async () => {
    render(
      <ReuseCard session={record('gone-1', '2 Gone St', [ref('a'.repeat(64))])} distanceMeters={12} onReuse={vi.fn()} onDismiss={vi.fn()} />,
    )
    await waitFor(() => expect(screen.queryByRole('button', { name: i18n.t('reuse.useThisRead') })).toBeNull())
    expect(screen.getByText(/Photo not on this device/)).toBeTruthy()
    expect(screen.getByRole('button', { name: i18n.t('reuse.dismiss') })).toBeTruthy()
  })
})

describe('RecentScansPicker', () => {
  it('leaves out a record whose sign photo bytes are not on this device', async () => {
    const sha = await putPhoto('kept-2', jpeg('sign-2'))
    const sessions = [record('kept-2', '3 Kept St', [ref(sha)]), record('gone-2', '4 Gone St', [ref('b'.repeat(64))])]
    render(<RecentScansPicker sessions={sessions} onPick={vi.fn()} onDismiss={vi.fn()} />)
    await waitFor(() => expect(screen.queryByText('4 Gone St')).toBeNull())
    expect(screen.getByText('3 Kept St')).toBeTruthy()
  })

  it('shows nothing when no record can be re-checked', async () => {
    const sessions = [record('gone-3', '5 Gone St', [ref('c'.repeat(64))])]
    const { container } = render(<RecentScansPicker sessions={sessions} onPick={vi.fn()} onDismiss={vi.fn()} />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})
