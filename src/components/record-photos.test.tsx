// @vitest-environment happy-dom
//
// The record screen's condition and proof photos (build spec T2, items 5
// and 7): "Add condition photos" and "Add a photo of your ticket or permit"
// on a record that hasn't ended, each queueing its own signed part; the
// list of photos with the phone-clock time, the short fingerprint, the
// signing state from the signed payload, the exact library label, and the
// one bytes-missing state.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { endSession, getSession, saveSession } from '../lib/storage'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from '../lib/photo-store'
import { resetSigningQueueForTests, whenSigningIdle } from '../lib/signing'
import type { ParkingSession, PhotoRef, SignatureBundle } from '../types'
import SessionDetail from './SessionDetail'

vi.mock('../lib/api', () => ({ endpointUrl: (p: string) => `/api${p}` }))
vi.mock('../lib/pdf', () => ({
  materializeRemotePhotos: async (s: ParkingSession) => s,
  downloadPdf: () => {},
}))
vi.mock('../lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))
vi.mock('../lib/image', () => ({
  resizeImageFile: async (file: File) => ({
    dataUrl: 'data:image/jpeg;base64,' + btoa(await file.text()),
    mediaType: 'image/jpeg',
  }),
}))

const AUTH: AuthContextValue = { user: null, loading: false, configured: false, refresh: async () => {}, signOut: () => {} }
const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)
const MELBOURNE = { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne VIC' }

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-screen',
    arrived_at: '2026-11-08T01:00:00.000Z',
    location: MELBOURNE,
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    confidence: 'high',
    ...overrides,
  }
}

function renderDetail(session: ParkingSession, onSheetOpenChange?: (open: boolean) => void) {
  const wrap = (children: ReactNode) => <AuthContext.Provider value={AUTH}>{children}</AuthContext.Provider>
  return render(
    wrap(
      <SessionDetail
        session={session}
        onBack={() => {}}
        onDelete={() => {}}
        onDraftAppeal={() => {}}
        onEndSession={() => {}}
        onSheetOpenChange={onSheetOpenChange}
      />,
    ),
  )
}

let memory: ReturnType<typeof createMemoryPhotoBackend>

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  resetSigningQueueForTests()
  memory = createMemoryPhotoBackend()
  setPhotoBackendForTests(memory)
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  // No server: queued parts stay pending.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
})

afterEach(async () => {
  cleanup()
  await whenSigningIdle()
  await new Promise((r) => setTimeout(r, 20))
  setPhotoBackendForTests(null)
  vi.unstubAllGlobals()
})

function pick(container: HTMLElement, role: string, text: string, lastModified = Date.now()) {
  const input = container.querySelector<HTMLInputElement>(`input[data-role="${role}"]`)!
  fireEvent.change(input, { target: { files: [new File([text], `${text}.jpg`, { type: 'image/jpeg', lastModified })] } })
}

describe('adding photos after saving', () => {
  it('offers both actions on a record that has not ended, and neither once it has', () => {
    saveSession(record())
    renderDetail(record())
    expect(screen.getByRole('button', { name: 'Add condition photos' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add a photo of your ticket or permit' })).toBeTruthy()
    cleanup()
    const ended = record({ ended_at: '2026-11-08T02:00:00.000Z' })
    saveSession({ ...ended, id: 'rec-ended' })
    renderDetail({ ...ended, id: 'rec-ended' })
    expect(screen.queryByRole('button', { name: 'Add condition photos' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add a photo of your ticket or permit' })).toBeNull()
  })

  it('"Add condition photos" queues its own condition part with the photos and the note', async () => {
    saveSession(record())
    const { container } = renderDetail(record())
    fireEvent.click(screen.getByRole('button', { name: 'Add condition photos' }))
    const dialog = screen.getByRole('dialog')
    const add = within(dialog).getByRole('button', { name: i18n.t('evidence.addToRecord') }) as HTMLButtonElement
    expect(add.disabled).toBe(true) // a condition part needs at least one photo
    pick(container, 'condition-right', 'right-side')
    await within(dialog).findByText(i18n.t('photoGrid.saved'))
    fireEvent.change(within(dialog).getByLabelText(i18n.t('logger.condition.noteLabel')), { target: { value: 'Mirror cracked' } })
    expect(add.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(add)
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const s = getSession('rec-screen')!
    const part = s.addenda!.find((a) => a.kind === 'condition')!
    expect(part.data).toMatchObject({ when: 'parking', note: 'Mirror cracked' })
    const photos = (part.data as { photos: PhotoRef[] }).photos
    expect(photos.map((p) => p.role)).toEqual(['condition-right'])
    expect(s.photos).toEqual(photos)
    // The new photo shows on the record screen, not signed yet.
    expect(await screen.findByText(i18n.t('evidence.group.parking'))).toBeTruthy()
    expect(screen.getByText(i18n.t('chain.photoRole.conditionRight'))).toBeTruthy()
  })

  it('"Add a photo of your ticket or permit" preselects from the record\'s gate and queues a compliance part', async () => {
    const saved = record({ gate_acks: { meter_ticket: true, permit_zone: null, accessible_permit: null } })
    saveSession(saved)
    const { container } = renderDetail(saved)
    fireEvent.click(screen.getByRole('button', { name: 'Add a photo of your ticket or permit' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByRole('radio')).toBeNull()
    pick(container, 'compliance', 'ticket')
    await within(dialog).findByText(i18n.t('photoGrid.saved'))
    expect((within(dialog).getByRole('radio', { name: i18n.t('complianceType.meterTicket') }) as HTMLInputElement).checked).toBe(true)
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('evidence.addToRecord') }))
    })
    const part = getSession('rec-screen')!.addenda!.find((a) => a.kind === 'compliance')!
    expect(part.data).toMatchObject({ compliance_type: 'meter_ticket', photo: { role: 'compliance' } })
  })

  it('tells App when its sheet opens and closes (the backup prompt waits meanwhile)', () => {
    saveSession(record())
    const onSheetOpenChange = vi.fn()
    renderDetail(record(), onSheetOpenChange)
    expect(onSheetOpenChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Add condition photos' }))
    expect(onSheetOpenChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: i18n.t('common.cancel') }))
    expect(onSheetOpenChange).toHaveBeenLastCalledWith(false)
    fireEvent.click(screen.getByRole('button', { name: 'Add condition photos' }))
    expect(onSheetOpenChange).toHaveBeenLastCalledWith(true)
    // Leaving the screen with the sheet open: none is open any more.
    cleanup()
    expect(onSheetOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('a record ended while the sheet is open takes no "when parked" photos; the sheet then takes photos again', async () => {
    saveSession(record())
    const { container } = renderDetail(record())
    fireEvent.click(screen.getByRole('button', { name: 'Add condition photos' }))
    const dialog = screen.getByRole('dialog')
    pick(container, 'condition-front', 'front-one')
    await within(dialog).findByText(i18n.t('photoGrid.saved'))
    // Another tab (or a synced device) ends the record meanwhile.
    act(() => {
      endSession('rec-screen', new Date())
    })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('evidence.addToRecord') }))
    })
    expect(await within(dialog).findByText(i18n.t('evidence.cantAddNow'))).toBeTruthy()
    expect((getSession('rec-screen')!.addenda ?? []).filter((a) => a.kind === 'condition')).toEqual([])
    // After the failed add, Retake works again: the new photo is stored and shown.
    pick(container, 'condition-front', 'front-two')
    await waitFor(() => expect(memory.records.size).toBe(2))
    await waitFor(() => expect(within(dialog).getByRole('img', { name: i18n.t('photoGrid.front') }).getAttribute('src')).toBe(jpeg('front-two')))
    // Cancel tidies both photos away.
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('common.cancel') }))
    await waitFor(() => expect(memory.records.size).toBe(0))
  })

  it('without a gate the type must be chosen first; Cancel deletes the photo and adds nothing', async () => {
    saveSession(record())
    const { container } = renderDetail(record())
    fireEvent.click(screen.getByRole('button', { name: 'Add a photo of your ticket or permit' }))
    const dialog = screen.getByRole('dialog')
    pick(container, 'compliance', 'unsure')
    await within(dialog).findByText(i18n.t('photoGrid.saved'))
    expect((within(dialog).getByRole('button', { name: i18n.t('evidence.addToRecord') }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(dialog).getByText(i18n.t('evidence.needType'))).toBeTruthy()
    expect(memory.records.size).toBe(1)
    fireEvent.click(within(dialog).getByRole('button', { name: i18n.t('common.cancel') }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(memory.records.size).toBe(0))
    expect(getSession('rec-screen')!.addenda ?? []).toEqual([])
  })
})

describe('the photos on the record screen', () => {
  function signedBundle(payload: Record<string, unknown>): SignatureBundle {
    return {
      schema: 'parkproof-addendum-v1',
      signed_at: String(payload.signed_at),
      algorithm: 'ECDSA_SHA_256',
      key_alias: 'alias/parkproof-evidence-signing',
      canonical_payload: JSON.stringify(payload),
      signature_base64: 'MEUCIQ',
    }
  }

  it('shows the phone-clock time, fingerprint, ParkProof\'s signing time and the library label', async () => {
    const sha = await putPhoto('rec-screen', jpeg('front at parking'))
    const photo: PhotoRef = { role: 'condition-front', sha256: sha, captured_at: '2026-11-08T01:02:00.000Z', source: 'library' }
    const data = { when: 'parking', photos: [photo], note: 'Dent above the wheel' }
    const s = record({
      ended_at: '2026-11-08T03:00:00.000Z',
      photos: [photo],
      addenda: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          seq: 1,
          kind: 'condition',
          captured_at: '2026-11-08T01:02:30.000Z',
          data,
          bundle: signedBundle({ signed_at: '2026-11-08T01:03:00.000Z', data }),
        },
      ],
    })
    saveSession(s)
    renderDetail(s)
    const img = await screen.findByRole('img', { name: i18n.t('chain.photoRole.conditionFront') })
    const item = within(img.closest('li')!)
    // 12:02 pm AEDT on the phone clock; ParkProof signed at 12:03 pm AEDT (Melbourne, daylight time).
    expect(item.getByText('Added at Sun 8 Nov, 12:02 pm AEDT (phone clock).')).toBeTruthy()
    expect(item.getByText(`Fingerprint ${sha.slice(0, 4)}…${sha.slice(-4)}`)).toBeTruthy()
    expect(item.getByText('Signed by ParkProof at Sun 8 Nov, 12:03 pm AEDT.')).toBeTruthy()
    expect(
      item.getByText('Added from the photo library. The signature shows when it was added, not when it was taken.'),
    ).toBeTruthy()
    expect(screen.getByText('Dent above the wheel')).toBeTruthy()
    expect(
      screen.getAllByText("A signed photo shows the photo existed by the time it was signed. It doesn't show who caused any damage.").length,
    ).toBeGreaterThan(0)
  })

  it('a photo whose bytes are not on this device shows the one missing state with its signed fingerprint', async () => {
    const sha = 'ab12'.repeat(16)
    const photo: PhotoRef = { role: 'compliance', sha256: sha, captured_at: '2026-11-08T01:02:00.000Z', source: 'camera_input' }
    const data = { compliance_type: 'permit_displayed', photo }
    const s = record({
      ended_at: '2026-11-08T03:00:00.000Z',
      photos: [photo],
      addenda: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          seq: 1,
          kind: 'compliance',
          captured_at: '2026-11-08T01:02:30.000Z',
          data,
          bundle: signedBundle({ signed_at: '2026-11-08T01:03:00.000Z', data }),
        },
      ],
    })
    saveSession(s)
    renderDetail(s)
    expect(await screen.findByText('Photo not on this device. Signed fingerprint ab12…ab12.')).toBeTruthy()
    expect(screen.getByText(/Proof of payment or permit photo/)).toBeTruthy()
    // What the photo shows is the driver's own description, never an app finding.
    expect(screen.getByText(/Permit displayed \(as you described it\)/)).toBeTruthy()
    // The fingerprint isn't repeated under the missing state.
    expect(screen.queryByText(`Fingerprint ab12…ab12`)).toBeNull()
  })

  it('a damage note says when its part is not signed yet, or could not be signed', async () => {
    const photo: PhotoRef = { role: 'condition-rear', sha256: 'cd'.repeat(32), captured_at: '2026-11-08T01:02:00.000Z', source: 'camera_input' }
    const s = record({
      ended_at: '2026-11-08T03:00:00.000Z',
      photos: [photo],
      addenda: [
        {
          id: '00000000-0000-4000-8000-000000000011',
          seq: 1,
          kind: 'arrival_context',
          captured_at: '2026-11-08T01:00:30.000Z',
          data: { condition_note: 'Scratch on the bumper' },
          rejected: { code: 'ERR_BAD_STRING', at: '2026-11-08T01:01:00.000Z' },
        },
        {
          id: '00000000-0000-4000-8000-000000000012',
          seq: 2,
          kind: 'condition',
          captured_at: '2026-11-08T01:02:30.000Z',
          data: { when: 'return', photos: [photo], note: 'New dent on return' },
        },
      ],
    })
    saveSession(s)
    renderDetail(s)
    const refused = screen.getByText('Scratch on the bumper').parentElement!
    expect(within(refused).getByText(i18n.t('verifier.link.rejected'))).toBeTruthy()
    const pending = screen.getByText('New dent on return').parentElement!
    expect(within(pending).getByText(i18n.t('verifier.link.pending'))).toBeTruthy()
  })
})
