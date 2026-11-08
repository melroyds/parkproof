// @vitest-environment happy-dom
//
// The departure sheet's "Record the car's condition now (optional)" (build
// spec T2, item 6): collapsed above Confirm, a camera-only grid with the
// return-* roles, Confirm hands App the photos' refs (once stored) without
// waiting for them, and Cancel deletes the photos taken on the sheet but
// nothing else of the record.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import type { DepartureFixRequest } from '../lib/departure'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from '../lib/photo-store'
import { hashDataUrlImage } from '../lib/hash'
import { saveSession } from '../lib/storage'
import type { ParkingSession, PhotoRef } from '../types'
import DepartureSheet, { type DepartureConfirmation } from './DepartureSheet'

vi.mock('../lib/image', () => ({
  resizeImageFile: async (file: File) => ({
    dataUrl: 'data:image/jpeg;base64,' + btoa(await file.text()),
    mediaType: 'image/jpeg',
  }),
}))

const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)

function makeSession(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-sheet',
    arrived_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    confidence: 'high',
    ...overrides,
  }
}

// A stable snapshot, as useSyncExternalStore needs.
const PENDING = { status: 'pending' } as const
const pendingFix: DepartureFixRequest = {
  current: () => PENDING,
  settled: new Promise(() => {}),
  subscribe: () => () => {},
}

let memory: ReturnType<typeof createMemoryPhotoBackend>

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  memory = createMemoryPhotoBackend()
  setPhotoBackendForTests(memory)
})

afterEach(async () => {
  cleanup()
  await new Promise((r) => setTimeout(r, 20))
  setPhotoBackendForTests(null)
})

function renderSheet(session = makeSession()) {
  const onConfirm = vi.fn<(c: DepartureConfirmation) => void>()
  const onCancel = vi.fn()
  const utils = render(
    <DepartureSheet session={session} fix={pendingFix} confirmKey="session.endConfirm" onConfirm={onConfirm} onCancel={onCancel} />,
  )
  return { ...utils, onConfirm, onCancel }
}

const toggle = () =>
  screen.getByRole('button', { name: new RegExp('^' + i18n.t('departure.condition.toggle').replace(/[()]/g, '\\$&')) })

function pick(container: HTMLElement, role: string, text: string) {
  const input = container.querySelector<HTMLInputElement>(`input[data-role="${role}"]`)!
  fireEvent.change(input, { target: { files: [new File([text], `${text}.jpg`, { type: 'image/jpeg', lastModified: Date.now() })] } })
}

describe('DepartureSheet: condition on return', () => {
  it('is collapsed above Confirm; opened, it shows a camera-only grid with the return roles', () => {
    const { container } = renderSheet()
    const confirm = screen.getByRole('button', { name: i18n.t('departure.confirm') })
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(toggle().compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelector('input[type="file"]')).toBeNull()
    fireEvent.click(toggle())
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')]
    expect(inputs.map((i) => i.dataset.role)).toEqual(['return-front', 'return-rear', 'return-left', 'return-right', 'return-detail'])
    for (const i of inputs) expect(i.getAttribute('capture')).toBe('environment')
    expect(screen.getByText(i18n.t('photoGrid.signedNote'))).toBeTruthy()
  })

  it('is not offered when the photos could not be signed into the record (a chain this device cannot extend)', () => {
    const { container } = renderSheet(
      makeSession({
        signature: {
          schema: 'parkproof-evidence-v2',
          signed_at: '2026-11-08T01:00:05.000Z',
          algorithm: 'ECDSA_SHA_256',
          key_alias: 'alias/parkproof-evidence-signing',
          canonical_payload: JSON.stringify({ schema: 'parkproof-evidence-v2', chain_key_sha256: 'f'.repeat(64) }),
          signature_base64: 'MEUCIQ',
        },
      }),
    )
    const toggleName = new RegExp('^' + i18n.t('departure.condition.toggle').replace(/[()]/g, '\\$&'))
    expect(screen.queryByRole('button', { name: toggleName })).toBeNull()
    // The same pattern finds the toggle on a record whose chain can be extended.
    expect(toggleName.test(i18n.t('departure.condition.toggle'))).toBe(true)
    expect(container.querySelector('input[type="file"]')).toBeNull()
    // Confirm and Cancel are still there.
    expect(screen.getByRole('button', { name: i18n.t('departure.confirm') })).toBeTruthy()
  })

  it('Confirm hands over the refs of the stored photos at once, without waiting for them', async () => {
    saveSession(makeSession())
    const { container, onConfirm } = renderSheet()
    fireEvent.click(toggle())
    pick(container, 'return-front', 'front-on-return')
    await screen.findByText(i18n.t('photoGrid.saved'))
    pick(container, 'return-rear', 'rear-on-return')
    await screen.findByRole('button', { name: 'Retake: Rear' }) // its tile is up
    // Confirm while the rear photo may still be saving: the tap isn't held up.
    fireEvent.click(screen.getByRole('button', { name: i18n.t('departure.confirm') }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const refs = await onConfirm.mock.calls[0][0].returnPhotos
    expect(refs.map((r: PhotoRef) => r.role)).toEqual(['return-front', 'return-rear'])
    expect(refs[0].sha256).toBe(await hashDataUrlImage(jpeg('front-on-return')))
    expect(refs[1].source).toBe('camera_input')
    // The photos stay on the phone (App adds them to the record).
    await new Promise((r) => setTimeout(r, 0))
    expect(memory.records.size).toBe(2)
  })

  it('a retaken return photo is dropped after Confirm; the kept one stays', async () => {
    saveSession(makeSession())
    const { container, onConfirm } = renderSheet()
    fireEvent.click(toggle())
    pick(container, 'return-left', 'left-one')
    await screen.findByText(i18n.t('photoGrid.saved'))
    pick(container, 'return-left', 'left-two')
    await waitFor(() => expect(memory.records.size).toBe(2))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('departure.confirm') }))
    const refs = await onConfirm.mock.calls[0][0].returnPhotos
    expect(refs).toHaveLength(1)
    await waitFor(() => expect([...memory.records.keys()]).toEqual([`rec-sheet/${refs[0].sha256}`]))
  })

  it("Cancel deletes the photos taken on the sheet, and none of the record's own", async () => {
    const carSha = await putPhoto('rec-sheet', jpeg('car at arrival'))
    saveSession(
      makeSession({ photos: [{ role: 'car', sha256: carSha, captured_at: new Date().toISOString(), source: 'camera_input' }] }),
    )
    const { container, onCancel, onConfirm } = renderSheet()
    fireEvent.click(toggle())
    pick(container, 'return-right', 'right-on-return')
    await waitFor(() => expect(memory.records.size).toBe(2))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    await waitFor(() => expect([...memory.records.keys()]).toEqual([`rec-sheet/${carSha}`]))
  })
})
