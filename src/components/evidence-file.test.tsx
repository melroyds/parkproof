// @vitest-environment happy-dom
//
// The record screen's evidence file download (build spec T2, item 9). It
// shows once the record has a signed link. The "Include permit details"
// tick (N3) shows only for a record with permit details or a photo marked
// as a displayed permit, starts off, and decides whether the saved file
// carries them. After a download the screen says how many signed photos
// weren't on this device, and separately how many didn't match their
// signed fingerprint.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { saveSession } from '../lib/storage'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from '../lib/photo-store'
import { resetSigningQueueForTests, whenSigningIdle } from '../lib/signing'
import type { EvidenceFile } from '../lib/evidence-bundle'
import type { ParkingSession, PermitContext, PhotoRef, SignatureBundle } from '../types'
import SessionDetail from './SessionDetail'

vi.mock('../lib/api', () => ({ endpointUrl: (p: string) => `/api${p}` }))
vi.mock('../lib/pdf', () => ({ materializeRemotePhotos: async (s: ParkingSession) => s, downloadPdf: () => {} }))
vi.mock('../lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))

const AUTH: AuthContextValue = { user: null, loading: false, configured: false, refresh: async () => {}, signOut: () => {} }
const ID = '1679091c-5a88-4faf-9b2d-4e5f6a7b8c9d'
const PERMIT: PermitContext = {
  type: 'accessible',
  area: null,
  holder_present: true,
  sign_exception_applies: false,
  standard_until: null,
  permit_until: null,
  note: null,
}
const SALT = 'b2'.repeat(16)
const LINK0: SignatureBundle = {
  schema: 'parkproof-evidence-v2',
  signed_at: '2026-11-08T01:00:04.000Z',
  algorithm: 'ECDSA_SHA_256',
  key_alias: 'alias/parkproof-evidence-signing',
  canonical_payload: JSON.stringify({ schema: 'parkproof-evidence-v2', session_id: ID, signed_at: '2026-11-08T01:00:04.000Z' }),
  signature_base64: 'MEUCIQ-link0',
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: ID,
    arrived_at: '2026-11-08T01:00:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    ended_at: '2026-11-08T02:00:00.000Z',
    ...overrides,
  }
}

function renderDetail(session: ParkingSession) {
  saveSession(session)
  const wrap = (children: ReactNode) => <AuthContext.Provider value={AUTH}>{children}</AuthContext.Provider>
  return render(
    wrap(<SessionDetail session={session} onBack={() => {}} onDelete={() => {}} onDraftAppeal={() => {}} onEndSession={() => {}} />),
  )
}

let saved: Blob[]
let memory: ReturnType<typeof createMemoryPhotoBackend>

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  localStorage.clear()
  resetSigningQueueForTests()
  memory = createMemoryPhotoBackend()
  setPhotoBackendForTests(memory)
  saved = []
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    saved.push(blob as Blob)
    return 'blob:evidence'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(async () => {
  cleanup()
  await whenSigningIdle()
  setPhotoBackendForTests(null)
  vi.unstubAllGlobals()
})

async function lastFile(): Promise<EvidenceFile> {
  await waitFor(() => expect(saved.length).toBeGreaterThan(0))
  return JSON.parse(await saved[saved.length - 1].text()) as EvidenceFile
}

describe('the evidence file on the record screen', () => {
  it('is offered once the record has a signed link, and saves the signed payloads', async () => {
    renderDetail(record({ signature: LINK0 }))
    fireEvent.click(screen.getByRole('button', { name: 'Download evidence file' }))
    const file = await lastFile()
    expect(file.record_id).toBe(ID)
    expect(file.links.map((l) => l.canonical_payload)).toEqual([LINK0.canonical_payload])
    expect(file.permit).toBeNull()
    // No permit details on this record: no tick.
    expect(screen.queryByRole('checkbox', { name: /Include permit details/ })).toBeNull()
  })

  it('the help next to the download says everything a signature does not show', () => {
    renderDetail(record({ signature: LINK0 }))
    // Copy rule: true, who was driving, where the car was, when it arrived or left.
    expect(
      screen.getByText(/It doesn't show they're true, who was driving, where the car was, or when it arrived or left\./),
    ).toBeTruthy()
  })

  it('is not offered before anything is signed', () => {
    renderDetail(record())
    expect(screen.queryByRole('button', { name: 'Download evidence file' })).toBeNull()
  })

  it('permit details go in only when the driver ticks "Include permit details"', async () => {
    renderDetail(record({ signature: LINK0, permit_context: PERMIT, permit_salt: SALT }))
    const tick = screen.getByRole('checkbox', { name: /Include permit details/ }) as HTMLInputElement
    expect(tick.checked).toBe(false)
    expect(screen.getByText(/Accessible permit details are health information/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Download evidence file' }))
    const without = await lastFile()
    expect(without.permit).toBeNull()
    expect(JSON.stringify(without)).not.toContain(SALT)

    fireEvent.click(tick)
    expect(tick.checked).toBe(true)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Download evidence file' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Download evidence file' }))
    await waitFor(() => expect(saved.length).toBe(2))
    const withPermit = await lastFile()
    expect(withPermit.permit?.permit_context).toEqual(PERMIT)
    expect(withPermit.permit?.permit_salt).toBe(SALT)
  })

  it('tells photos that are not on this device apart from photos whose bytes differ from the signed fingerprint', async () => {
    const carSha = 'c1'.repeat(32)
    const signSha = 'd2'.repeat(32)
    // Bytes stored under the car photo's fingerprint that hash to something else.
    memory.records.set(`${ID}/${carSha}`, {
      key: `${ID}/${carSha}`,
      session_id: ID,
      sha256: carSha,
      type: 'image/jpeg',
      bytes: new TextEncoder().encode('not the signed photo').buffer as ArrayBuffer,
      created_at: 0,
    })
    const link0: SignatureBundle = {
      ...LINK0,
      canonical_payload: JSON.stringify({
        schema: 'parkproof-evidence-v2',
        session_id: ID,
        signed_at: '2026-11-08T01:00:04.000Z',
        sign_photo_sha256: signSha,
        car_photo_sha256: carSha,
      }),
    }
    renderDetail(record({ signature: link0 }))
    fireEvent.click(screen.getByRole('button', { name: 'Download evidence file' }))
    const file = await lastFile()
    expect(file.photos.map((p) => [p.sha256, p.bytes]).sort()).toEqual(
      [
        [carSha, 'differ_from_fingerprint'],
        [signSha, 'not_on_this_device'],
      ].sort(),
    )
    expect(await screen.findByText(i18n.t('evidenceFile.photosMissing', { count: 1 }))).toBeTruthy()
    expect(screen.getByText(i18n.t('evidenceFile.photosDiffer', { count: 1 }))).toBeTruthy()
    expect(i18n.t('evidenceFile.photosDiffer', { count: 1 })).toMatch(/doesn't match its signed fingerprint/)
  })

  it('a photo marked as a displayed permit is left out unless ticked; its fingerprint is always listed', async () => {
    const dataUrl = 'data:image/jpeg;base64,' + btoa('permit on the dash')
    const sha = await putPhoto(ID, dataUrl)
    const photo: PhotoRef = { role: 'compliance', sha256: sha, captured_at: '2026-11-08T01:01:00.000Z', source: 'camera_input' }
    const data = { compliance_type: 'permit_displayed', photo }
    const part: SignatureBundle = {
      schema: 'parkproof-addendum-v1',
      signed_at: '2026-11-08T01:01:10.000Z',
      algorithm: 'ECDSA_SHA_256',
      key_alias: 'alias/parkproof-evidence-signing',
      canonical_payload: JSON.stringify({ schema: 'parkproof-addendum-v1', kind: 'compliance', seq: 1, session_id: ID, signed_at: '2026-11-08T01:01:10.000Z', data }),
      signature_base64: 'MEUCIQ-link1',
    }
    renderDetail(
      record({
        signature: LINK0,
        photos: [photo],
        addenda: [{ id: '00000000-0000-4000-8000-0000000000a1', seq: 1, kind: 'compliance', captured_at: '2026-11-08T01:01:00.000Z', data, bundle: part }],
      }),
    )
    // No permit details on the record, but the photo alone brings the tick.
    const tick = screen.getByRole('checkbox', { name: /Include permit details/ }) as HTMLInputElement
    expect(tick.checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Download evidence file' }))
    const without = await lastFile()
    expect(without.photos).toEqual([
      { sha256: sha, role: 'compliance', signed_in: [{ link: '1', field: 'data.photo' }], bytes: 'withheld_permit', media_type: null, bytes_base64: null },
    ])
    // The withheld state is not counted as missing or differing.
    expect(screen.queryByText(i18n.t('evidenceFile.photosMissing', { count: 1 }))).toBeNull()
    expect(without.about_signatures).toMatch(/doesn't show that they are true, who was driving, where the car was/)

    fireEvent.click(tick)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Download evidence file' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Download evidence file' }))
    await waitFor(() => expect(saved.length).toBe(2))
    const withPermit = await lastFile()
    expect(withPermit.photos[0]).toMatchObject({ sha256: sha, bytes: 'included', media_type: 'image/jpeg', bytes_base64: btoa('permit on the dash') })
  })
})
