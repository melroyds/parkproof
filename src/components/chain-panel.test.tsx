// @vitest-environment happy-dom
//
// The chain panel and the departure row on the record screen (spec T1a):
// collapsed by default to one line, each part with what it covers and
// ParkProof's signing time (record zone, with its name), "Not signed yet" /
// "This part couldn't be signed", forks before and after a check, the
// development-key wording, "Check signatures" (results per part and per
// photo, the success copy, the photos-not-checked copy, an unavailable
// verifier, a record that changed while checking, cloud photos fetched
// before a re-check, legacy photos by role, at most four fetches at once),
// the vault panel's zoned signing time, and the departure row's
// phone-clock and server-clock lines.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { getSession, notifyRecordsChanged, saveSession, updateSession } from '../lib/storage'
import { markEndedOnThisDevice } from '../lib/signing'
import type { LinkCheck, PhotoCheck, RecordVerification } from '../lib/verify'
import type { ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import ChainPanel from './ChainPanel'
import SessionDetail from './SessionDetail'

const mocks = vi.hoisted(() => ({
  verifyRecord: vi.fn(),
  fetchRemotePhoto: vi.fn(async (): Promise<string | null> => null),
  materializePhotoFromCloud: vi.fn(async (): Promise<string | null> => null),
}))
vi.mock('../lib/verify', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/verify')>()),
  verifyRecord: mocks.verifyRecord,
}))
vi.mock('../lib/session-photos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/session-photos')>()),
  fetchRemotePhoto: mocks.fetchRemotePhoto,
}))
vi.mock('../lib/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/sync')>()),
  materializePhotoFromCloud: mocks.materializePhotoFromCloud,
}))
vi.mock('../lib/pdf', () => ({ materializeRemotePhotos: async (s: ParkingSession) => s, downloadPdf: () => {} }))
vi.mock('../lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))

const TZ = 'Australia/Melbourne'
const SIGNED_0 = '2026-10-25T00:00:03.000Z' // 11:00 am AEDT
const SIGNED_1 = '2026-10-25T00:00:05.000Z'
const ENDED = '2026-10-25T02:55:00.000Z' // 1:55 pm AEDT
const CHAIN_KEY = 'cd'.repeat(32)

function bundle(payload: Record<string, unknown>, overrides: Partial<SignatureBundle> = {}): SignatureBundle {
  return {
    schema: String(payload.schema),
    signed_at: String(payload.signed_at),
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify(payload),
    signature_base64: `sig-${String(payload.signed_at)}-${String(payload.seq ?? 0)}-${String(payload.kind ?? '')}`,
    ...overrides,
  }
}

const LINK0 = bundle({ schema: 'parkproof-evidence-v2', session_id: 'rec-1', signed_at: SIGNED_0 })

function addendum(seq: number, kind: SignedAddendum['kind'], extra: Partial<SignedAddendum> = {}): SignedAddendum {
  return { id: `${kind}-${seq}`, seq, kind, captured_at: SIGNED_0, data: {}, ...extra }
}

function makeSession(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: '2026-10-24T23:58:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    signature: LINK0,
    addenda: [
      addendum(1, 'arrival_context', {
        bundle: bundle({ schema: 'parkproof-addendum-v1', kind: 'arrival_context', seq: 1, signed_at: SIGNED_1 }),
      }),
    ],
    ...overrides,
  }
}

function link(overrides: Partial<LinkCheck>): LinkCheck {
  return {
    seq: 0,
    kind: 'arrival',
    addendum_id: null,
    status: 'valid',
    problems: [],
    signature_ok: true,
    forked: false,
    bundle: null,
    payload: null,
    signed_at: SIGNED_0,
    captured_at: null,
    rejected_code: null,
    ...overrides,
  }
}

function photo(role: PhotoCheck['role'], sha256: string, status: PhotoCheck['status']): PhotoCheck {
  return { role, sha256, status, local_sha256: status === 'not_on_device' ? null : sha256, signer: 'parkproof', link_indexes: [0] }
}

function verification(links: LinkCheck[], photos: PhotoCheck[] = [], overall?: RecordVerification['overall']): RecordVerification {
  const counts = { valid: 0, invalid: 0, pending: 0, rejected: 0, dev_key: 0 }
  for (const l of links) counts[l.status]++
  return {
    session_id: 'rec-1',
    overall: overall ?? (counts.invalid ? 'problem' : counts.dev_key ? 'dev_key' : counts.valid ? 'valid' : 'unsigned'),
    counts,
    links,
    photos,
    forks: [],
    chain_key_on_device: 'matches',
  }
}

const AUTH: AuthContextValue = { user: null, loading: false, configured: false, refresh: async () => {}, signOut: () => {} }
const withAuth = (children: ReactNode) => <AuthContext.Provider value={AUTH}>{children}</AuthContext.Provider>
const disclosure = () => screen.getByRole('button', { name: new RegExp(i18n.t('chain.heading')) })
const expand = () => {
  if (disclosure().getAttribute('aria-expanded') !== 'true') fireEvent.click(disclosure())
}
const check = () => fireEvent.click(screen.getByRole('button', { name: i18n.t('chain.check') }))

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
  mocks.verifyRecord.mockReset()
  mocks.fetchRemotePhoto.mockReset()
  mocks.fetchRemotePhoto.mockResolvedValue(null)
  mocks.materializePhotoFromCloud.mockReset()
  mocks.materializePhotoFromCloud.mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
})

describe('ChainPanel before a check', () => {
  it('is collapsed by default to one line, and opens to the intro and the parts', () => {
    render(<ChainPanel session={makeSession()} timeZone={TZ} />)
    const button = disclosure()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.textContent).toContain('2 parts signed')
    expect(button.className).toContain('min-h-[44px]')
    const body = document.getElementById(button.getAttribute('aria-controls')!)!
    expect(body.hidden).toBe(true)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(body.hidden).toBe(false)
    expect(screen.getByText(i18n.t('chain.intro'))).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(button)
    expect(body.hidden).toBe(true)
  })

  it('lists each part, what it covers and ParkProof\'s signing time in the record zone', () => {
    render(
      <ChainPanel
        session={makeSession({
          addenda: [
            addendum(1, 'arrival_context', {
              bundle: bundle({ schema: 'parkproof-addendum-v1', kind: 'arrival_context', seq: 1, signed_at: SIGNED_1 }),
            }),
            addendum(2, 'departure'),
            addendum(3, 'condition', { rejected: { code: 'ERR_BAD_STRING', at: ENDED } }),
          ],
        })}
        timeZone={TZ}
      />,
    )
    expand()
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      `ArrivalThe time and place you logged on your phone, the sign reading and the photo fingerprints.Signed by ParkProof at Sun 25 Oct, 11:00 am AEDT.`,
      `Details at parkingWhat you added when you parked, such as who you said was driving, your answers and photo fingerprints.Signed by ParkProof at Sun 25 Oct, 11:00 am AEDT.`,
      `DepartureWhen you tapped I've left (phone clock), and where your phone was if a location was captured.Not signed yet`,
      `Condition photosFingerprints of your photos of the car's condition, and your note.This part couldn't be signed`,
    ])
  })

  it('nothing signed: "Not signed yet" collapsed, no sign reading for a no-sign record, and no Check button', () => {
    render(<ChainPanel session={makeSession({ signature: undefined, addenda: [], no_sign: true })} timeZone={TZ} />)
    expect(disclosure().textContent).toContain(i18n.t('verifier.link.pending'))
    expand()
    expect(screen.getByRole('listitem').textContent).toBe(
      'ArrivalThe time and place you logged on your phone, and the photo fingerprints.Not signed yet',
    )
    expect(screen.queryByRole('button', { name: i18n.t('chain.check') })).toBeNull()
  })

  it('a development-key link is never "Signed by ParkProof"', () => {
    render(<ChainPanel session={makeSession({ signature: { ...LINK0, key_alias: 'dev-ephemeral' }, addenda: [] })} timeZone={TZ} />)
    expand()
    expect(screen.queryByText(/Signed by ParkProof/)).toBeNull()
    expect(
      screen.getByText("Signed at Sun 25 Oct, 11:00 am AEDT with a development key, not ParkProof's published key."),
    ).toBeTruthy()
  })

  it('two parts signed at one place show "Added from two devices" before any check', () => {
    const dep = (id: string, sig: string) =>
      addendum(2, 'departure', {
        id,
        bundle: bundle({ schema: 'parkproof-addendum-v1', kind: 'departure', seq: 2, signed_at: ENDED }, { signature_base64: sig }),
      })
    render(
      <ChainPanel
        session={makeSession({
          addenda: [
            addendum(1, 'arrival_context', {
              bundle: bundle({ schema: 'parkproof-addendum-v1', kind: 'arrival_context', seq: 1, signed_at: SIGNED_1 }),
            }),
            dep('dep-a', 'sig-a'),
            dep('dep-b', 'sig-b'),
          ],
        })}
        timeZone={TZ}
      />,
    )
    expand()
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(items).toHaveLength(4)
    expect(items[1]).not.toContain(i18n.t('verifier.fork'))
    expect(items[2]).toContain(i18n.t('verifier.fork'))
    expect(items[3]).toContain(i18n.t('verifier.fork'))
  })
})

describe('Check signatures', () => {
  it('runs the verifier and shows the success copy and each part\'s result', async () => {
    const session = makeSession()
    mocks.verifyRecord.mockResolvedValue(
      verification([
        link({}),
        link({ seq: 1, kind: 'arrival_context', addendum_id: 'arrival_context-1', signed_at: SIGNED_1 }),
      ]),
    )
    render(<ChainPanel session={session} timeZone={TZ} />)
    expand()
    check()
    expect(
      await screen.findByText(
        "All 2 signatures are valid. The signed details haven't changed since ParkProof signed them. That doesn't show they're true.",
      ),
    ).toBeTruthy()
    expect(mocks.verifyRecord).toHaveBeenCalledWith(session)
    expect(screen.getAllByText(i18n.t('verifier.link.valid'))).toHaveLength(2)
    expect(screen.getAllByText('Signed by ParkProof at Sun 25 Oct, 11:00 am AEDT.')).toHaveLength(2)
  })

  it('one signature: the singular success copy, with its count', async () => {
    mocks.verifyRecord.mockResolvedValue(verification([link({})]))
    render(<ChainPanel session={makeSession({ addenda: [] })} timeZone={TZ} />)
    expand()
    check()
    expect(
      await screen.findByText(
        "1 signature is valid. The signed details haven't changed since ParkProof signed them. That doesn't show they're true.",
      ),
    ).toBeTruthy()
  })

  it("a valid chain with a signed photo not on this device never says the signed details haven't changed", async () => {
    mocks.verifyRecord.mockResolvedValue(
      verification([link({})], [photo('condition-front', 'a'.repeat(64), 'not_on_device')]),
    )
    render(<ChainPanel session={makeSession({ addenda: [] })} timeZone={TZ} />)
    expand()
    check()
    expect(
      await screen.findByText(
        "1 signature is valid. Some photos aren't on this device, so they couldn't be compared with their fingerprints. That doesn't show what the record says is true.",
      ),
    ).toBeTruthy()
    // The per-link "Signature valid" lines still say so; the summary doesn't.
    expect(screen.queryByText(/signatures? (is|are) valid\. The signed details haven't changed/)).toBeNull()
  })

  it('a problem: no signing time for the invalid part, its reason, and the fork badge', async () => {
    mocks.verifyRecord.mockResolvedValue(
      verification([
        link({}),
        link({ seq: 1, kind: 'arrival_context', addendum_id: 'a', status: 'invalid', problems: ['signature'], signature_ok: false, signed_at: null }),
        link({ seq: 2, kind: 'departure', addendum_id: 'b', status: 'invalid', problems: ['parent_hash'], signature_ok: true, signed_at: null }),
        link({ seq: 3, kind: 'condition', addendum_id: 'c', forked: true }),
        link({ seq: 3, kind: 'compliance', addendum_id: 'd', forked: true }),
        link({ seq: 4, kind: 'handover', addendum_id: 'e', status: 'pending', signature_ok: null, signed_at: null }),
      ]),
    )
    render(<ChainPanel session={makeSession()} timeZone={TZ} />)
    expand()
    check()
    expect(await screen.findByText(i18n.t('chain.checkProblem'))).toBeTruthy()
    // The problem line points at no direction: photo results sit below it.
    expect(i18n.t('chain.checkProblem')).not.toMatch(/above|below/)
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(items[1]).toContain(i18n.t('verifier.link.invalid'))
    expect(items[1]).not.toContain('Signed by ParkProof')
    expect(items[2]).toContain(i18n.t('verifier.link.chainBroken'))
    expect(items[3]).toContain(i18n.t('verifier.fork'))
    expect(items[4]).toContain(i18n.t('verifier.fork'))
    expect(items[5]).toContain(i18n.t('verifier.link.pending'))
    expect(screen.getByText('Proof of payment or permit')).toBeTruthy()
  })

  it('photo results: matches, differs, and not on this device with its fingerprint', async () => {
    const sha = 'ab12' + '0'.repeat(56) + 'cd34'
    mocks.verifyRecord.mockResolvedValue(
      verification(
        [link({})],
        [photo('sign', 'a'.repeat(64), 'matches'), photo('car', 'b'.repeat(64), 'differs'), photo('condition-front', sha, 'not_on_device')],
        'problem',
      ),
    )
    render(<ChainPanel session={makeSession({ addenda: [] })} timeZone={TZ} />)
    expand()
    check()
    expect(await screen.findByText('Sign photo')).toBeTruthy()
    expect(screen.getByText(i18n.t('verifier.photo.matches'))).toBeTruthy()
    expect(screen.getByText('Car photo')).toBeTruthy()
    expect(screen.getByText(i18n.t('verifier.photo.differs'))).toBeTruthy()
    expect(screen.getByText('Condition when parked, front')).toBeTruthy()
    expect(screen.getByText('Photo not on this device. Signed fingerprint ab12…cd34.')).toBeTruthy()
  })

  it('a photo ref not on this device is fetched from the cloud copy first, then checked again', async () => {
    const sha = 'e'.repeat(64)
    mocks.verifyRecord
      .mockResolvedValueOnce(verification([link({})], [photo('condition-front', sha, 'not_on_device')]))
      .mockResolvedValueOnce(verification([link({})], [photo('condition-front', sha, 'matches')]))
    mocks.fetchRemotePhoto.mockResolvedValueOnce('data:image/jpeg;base64,AAAA')
    render(<ChainPanel session={makeSession({ addenda: [] })} timeZone={TZ} />)
    expand()
    check()
    expect(await screen.findByText(i18n.t('verifier.photo.matches'))).toBeTruthy()
    expect(mocks.fetchRemotePhoto).toHaveBeenCalledWith('rec-1', sha)
    expect(mocks.materializePhotoFromCloud).not.toHaveBeenCalled()
    expect(mocks.verifyRecord).toHaveBeenCalledTimes(2)
  })

  it('an older record\'s car photo held only as a cloud URL is fetched by role and checked from those bytes', async () => {
    const sha = 'c'.repeat(64)
    const session = makeSession({ addenda: [], car_photo: 'https://bucket.example/rec-1/car.jpg?sig=1' })
    mocks.verifyRecord
      .mockResolvedValueOnce(verification([link({})], [photo('car', sha, 'not_on_device')]))
      .mockResolvedValueOnce(verification([link({})], [photo('car', sha, 'matches')]))
    mocks.materializePhotoFromCloud.mockResolvedValueOnce('data:image/jpeg;base64,Q0FS')
    render(<ChainPanel session={session} timeZone={TZ} />)
    expand()
    check()
    expect(await screen.findByText(i18n.t('verifier.photo.matches'))).toBeTruthy()
    expect(mocks.materializePhotoFromCloud).toHaveBeenCalledWith('rec-1', 'car')
    expect(mocks.fetchRemotePhoto).not.toHaveBeenCalled()
    // The bytes go to the verifier, never into the record.
    const [, options] = mocks.verifyRecord.mock.calls[1] as [ParkingSession, { localPhotos: Map<string, string> }]
    expect(options.localPhotos.get('car')).toBe('data:image/jpeg;base64,Q0FS')
    expect(session.car_photo).toBe('https://bucket.example/rec-1/car.jpg?sig=1')
  })

  it('nothing fetched: one check only', async () => {
    mocks.verifyRecord.mockResolvedValue(verification([link({})], [photo('car', 'f'.repeat(64), 'not_on_device')]))
    render(<ChainPanel session={makeSession({ addenda: [] })} timeZone={TZ} />)
    expand()
    check()
    expect(await screen.findByText(/^Photo not on this device/)).toBeTruthy()
    expect(mocks.verifyRecord).toHaveBeenCalledTimes(1)
  })

  it('fetches at most four missing photos at once', async () => {
    const shas = Array.from({ length: 10 }, (_, i) => String(i).repeat(64))
    mocks.verifyRecord.mockResolvedValue(
      verification(
        [link({})],
        shas.map((sha) => photo('return-detail', sha, 'not_on_device')),
      ),
    )
    let inFlight = 0
    let maxInFlight = 0
    const releases: Array<() => void> = []
    mocks.fetchRemotePhoto.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          inFlight++
          maxInFlight = Math.max(maxInFlight, inFlight)
          releases.push(() => {
            inFlight--
            resolve(null)
          })
        }),
    )
    render(<ChainPanel session={makeSession({ addenda: [] })} timeZone={TZ} />)
    expand()
    check()
    await waitFor(() => expect(releases.length).toBe(4))
    // Finish the fetches one at a time; the next starts only as one finishes.
    for (let i = 0; i < 500 && (releases.length > 0 || mocks.fetchRemotePhoto.mock.calls.length < shas.length); i++) {
      await act(async () => {
        releases.shift()?.()
        await new Promise((r) => setTimeout(r, 0))
      })
    }
    await waitFor(() => expect(screen.getAllByText(/^Photo not on this device/)).toHaveLength(10))
    expect(mocks.fetchRemotePhoto).toHaveBeenCalledTimes(10)
    expect(maxInFlight).toBe(4)
  })

  it('development key and unsigned summaries', async () => {
    mocks.verifyRecord.mockResolvedValue(verification([link({ status: 'dev_key', signature_ok: null })]))
    const { unmount } = render(<ChainPanel session={makeSession({ addenda: [] })} timeZone={TZ} />)
    expand()
    check()
    expect(await screen.findByText(i18n.t('chain.checkDevKey'))).toBeTruthy()
    // One line per dev-key part, never "Signed by ParkProof" or "Signature valid".
    expect(screen.getByRole('listitem').textContent).toContain(
      "Signed at Sun 25 Oct, 11:00 am AEDT with a development key, not ParkProof's published key.",
    )
    expect(screen.queryByText(/Signed by ParkProof/)).toBeNull()
    expect(screen.queryByText(i18n.t('verifier.link.valid'))).toBeNull()
    unmount()

    // A record whose stored link 0 is signed but whose check finds nothing signed.
    mocks.verifyRecord.mockResolvedValue(verification([link({ status: 'pending', signature_ok: null, signed_at: null })]))
    render(<ChainPanel session={makeSession({ addenda: [] })} timeZone={TZ} />)
    expand()
    check()
    expect(await screen.findByText(i18n.t('chain.checkUnsigned'))).toBeTruthy()
  })

  it('a browser without WebCrypto says it can\'t check', async () => {
    const { VerifierUnavailableError } = await vi.importActual<typeof import('../lib/verify')>('../lib/verify')
    mocks.verifyRecord.mockRejectedValue(new VerifierUnavailableError())
    render(<ChainPanel session={makeSession()} timeZone={TZ} />)
    expand()
    check()
    expect(await screen.findByText(i18n.t('chain.checkUnavailable'))).toBeTruthy()
  })

  it('is disabled while checking; once the chain changes the old result gives way to "check again"', async () => {
    let finish: (v: RecordVerification) => void = () => {}
    mocks.verifyRecord.mockReturnValue(new Promise<RecordVerification>((resolve) => (finish = resolve)))
    const session = makeSession({ addenda: [] })
    const { rerender } = render(<ChainPanel session={session} timeZone={TZ} />)
    expand()
    check()
    const button = screen.getByRole('button', { name: i18n.t('chain.checking') }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await act(async () => finish(verification([link({})])))
    expect(screen.getByText(/^1 signature is valid/)).toBeTruthy()
    expect(screen.queryByText(i18n.t('chain.checkChanged'))).toBeNull()

    // A departure is queued: the old result no longer describes the record.
    rerender(<ChainPanel session={{ ...session, addenda: [addendum(1, 'departure')] }} timeZone={TZ} />)
    expect(screen.queryByText(/^1 signature is valid/)).toBeNull()
    expect(screen.getByText(i18n.t('chain.checkChanged'))).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('the record screen', () => {
  function renderDetail(session: ParkingSession) {
    saveSession(session)
    render(
      withAuth(
        <SessionDetail session={session} onBack={() => {}} onDelete={() => {}} onDraftAppeal={() => {}} onEndSession={() => {}} />,
      ),
    )
  }

  it('puts the chain panel right under the vault signature panel', () => {
    renderDetail(makeSession())
    const seal = screen.getByText(i18n.t('session.cryptoSigned'))
    const chain = screen.getByRole('heading', { name: new RegExp(i18n.t('chain.heading')) })
    expect(seal.compareDocumentPosition(chain) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(chain.closest('section')?.previousElementSibling?.textContent).toContain(i18n.t('session.cryptoSigned'))
  })

  it('the vault panel: ParkProof\'s signing time in the record zone, and a caveat that matches the chain panel', () => {
    renderDetail(makeSession())
    expect(screen.getByText('· Sun 25 Oct, 11:00 am AEDT', { exact: false })).toBeTruthy()
    const caveat = screen.getByText(i18n.t('about.sealCaveat'))
    expect(caveat.textContent).not.toMatch(/prove|after you saved/i)
    expect(caveat.textContent).toContain('existed, unchanged, by the time ParkProof signed them')
    expect(caveat.textContent).toContain('who was driving, where the car was, or when it arrived or left')
  })

  it('a shared copy gets no chain panel here (T7 has its own check)', () => {
    renderDetail(
      makeSession({
        shared_from: { original_session_id: 'x', received_at: ENDED, shared_at: null, arrival_bundle: LINK0, snapshot: {} },
      }),
    )
    expect(screen.queryByRole('heading', { name: new RegExp(i18n.t('chain.heading')) })).toBeNull()
  })

  it('a link-0 refusal shows on the open screen without leaving it', () => {
    const session = makeSession({ signature: undefined, addenda: [] })
    renderDetail(session)
    expand()
    expect(screen.getByRole('listitem').textContent).toContain(i18n.t('verifier.link.pending'))
    act(() => {
      // What the signing queue stores on a 400 for link 0, then its notification.
      localStorage.setItem(
        'parkproof.signing.state.v2',
        JSON.stringify({ [session.id]: { link0_rejected: { code: 'ERR_BAD_VALUE', at: ENDED } } }),
      )
      notifyRecordsChanged(session.id)
    })
    expect(screen.getByRole('listitem').textContent).toContain(i18n.t('verifier.link.rejected'))
  })

  it('a part signed while the check runs is picked up by checking again', async () => {
    const pendingDep = addendum(2, 'departure')
    const session = makeSession({ ended_at: ENDED, chain_key: CHAIN_KEY, addenda: [...makeSession().addenda!, pendingDep] })
    let finishFirst: (v: RecordVerification) => void = () => {}
    mocks.verifyRecord
      .mockReturnValueOnce(new Promise<RecordVerification>((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce(
        verification([
          link({}),
          link({ seq: 1, kind: 'arrival_context', addendum_id: 'arrival_context-1', signed_at: SIGNED_1 }),
          link({ seq: 2, kind: 'departure', addendum_id: 'departure-2', signed_at: ENDED }),
        ]),
      )
    renderDetail(session)
    expand()
    check()
    // The departure lands mid-check.
    act(() => {
      updateSession(session.id, {
        addenda: [
          ...makeSession().addenda!,
          { ...pendingDep, bundle: bundle({ schema: 'parkproof-addendum-v1', kind: 'departure', seq: 2, signed_at: ENDED }) },
        ],
      })
    })
    await act(async () =>
      finishFirst(
        verification([
          link({}),
          link({ seq: 1, kind: 'arrival_context', addendum_id: 'arrival_context-1', signed_at: SIGNED_1 }),
          link({ seq: 2, kind: 'departure', addendum_id: 'departure-2', status: 'pending', signature_ok: null, signed_at: null }),
        ]),
      ),
    )
    expect(
      await screen.findByText(
        "All 3 signatures are valid. The signed details haven't changed since ParkProof signed them. That doesn't show they're true.",
      ),
    ).toBeTruthy()
    expect(mocks.verifyRecord).toHaveBeenCalledTimes(2)
    const second = mocks.verifyRecord.mock.calls[1][0] as ParkingSession
    expect(second.addenda!.find((a) => a.kind === 'departure')!.bundle).toBeDefined()
    expect(screen.queryByText(i18n.t('chain.checkChanged'))).toBeNull()
  })

  it('the departure row: phone tap time, ParkProof signing time from the signed departure, and the distance line', () => {
    const data = {
      ended_at: ENDED,
      location: { lat: -37.8118, lng: 144.9631, accuracy_meters: 12, source: 'gps' },
      distance_from_arrival_m: 201,
      return_photos: [],
    }
    renderDetail(
      makeSession({
        ended_at: ENDED,
        departure: { ended_at: ENDED, location: null, distance_from_arrival_m: 201 },
        addenda: [
          addendum(1, 'departure', {
            data,
            bundle: bundle({ schema: 'parkproof-addendum-v1', kind: 'departure', seq: 1, signed_at: '2026-10-25T02:56:04.000Z', data }),
          }),
        ],
      }),
    )
    // STATUS names the tap time, without the day (it ended on the day it
    // arrived; fix list item 6). The departure row labels it as the phone's.
    expect(document.getElementById('record-status')?.textContent).toBe('Ended 1:55 pm AEDT')
    expect(screen.getByText("You tapped I've left at Sun 25 Oct, 1:55 pm AEDT (phone clock).")).toBeTruthy()
    expand()
    // The departure row and the chain panel's departure part both carry ParkProof's time.
    expect(screen.getAllByText('Signed by ParkProof at Sun 25 Oct, 1:56 pm AEDT.')).toHaveLength(2)
    // ±8 m at arrival, ±12 m at the tap: 201 m is clearly away.
    expect(
      screen.getByText(
        "Your phone was 201 m from where you parked when you tapped I've left. The record shows when you tapped, not when the car moved.",
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/signed departure at/i)).toBeNull()
  })

  it('no distance line when the two fixes\' error could explain it (±95 m each, 170 m apart)', () => {
    const data = {
      ended_at: ENDED,
      location: { lat: -37.8121, lng: 144.9631, accuracy_meters: 95, source: 'gps' },
      distance_from_arrival_m: 170,
      return_photos: [],
    }
    renderDetail(
      makeSession({
        location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 95 },
        ended_at: ENDED,
        addenda: [
          addendum(1, 'departure', {
            data,
            bundle: bundle({ schema: 'parkproof-addendum-v1', kind: 'departure', seq: 1, signed_at: ENDED, data }),
          }),
        ],
      }),
    )
    expect(screen.getByText("You tapped I've left at Sun 25 Oct, 1:55 pm AEDT (phone clock).")).toBeTruthy()
    expect(screen.queryByText(/^Your phone was/)).toBeNull()
  })

  it('the departure row is "Not signed yet" until the departure lands, and hides the distance at 150 m or less', () => {
    const session = makeSession({ ended_at: ENDED, chain_key: CHAIN_KEY, addenda: [] })
    // Ended here: the departure (or its catch-up) is still coming from this device.
    markEndedOnThisDevice(session.id)
    renderDetail(session)
    const row = () => screen.getByText(i18n.t('departure.heading')).parentElement!.textContent
    expect(row()).toContain(i18n.t('verifier.link.pending'))
    act(() => {
      updateSession(session.id, { departure: { ended_at: ENDED, location: null, distance_from_arrival_m: 150 } })
    })
    expect(screen.queryByText(/^Your phone was/)).toBeNull()
  })

  it('a departure that will never be signed here says so instead of "Not signed yet"', () => {
    // A v2 chain whose key isn't on this device: no departure part can be added.
    markEndedOnThisDevice('rec-1')
    renderDetail(makeSession({ ended_at: ENDED, addenda: [] }))
    const row = screen.getByText(i18n.t('departure.heading')).parentElement!.textContent
    expect(row).toContain(i18n.t('departure.notSigned'))
    expect(row).not.toContain(i18n.t('verifier.link.pending'))
    expect(getSession('rec-1')!.chain_key).toBeUndefined()
    cleanup()
    localStorage.clear()

    // An old record, ended long ago before the ended-here mark existed: no catch-up will come.
    renderDetail(makeSession({ ended_at: ENDED, chain_key: CHAIN_KEY, addenda: [] }))
    expect(screen.getByText(i18n.t('departure.heading')).parentElement!.textContent).toContain(
      i18n.t('departure.notSigned'),
    )
  })

  it('no departure row before the record has ended', () => {
    renderDetail(makeSession())
    expect(screen.queryByText(i18n.t('departure.heading'))).toBeNull()
  })

  it('Check signatures on the record screen reads the live record', async () => {
    const session = makeSession()
    mocks.verifyRecord.mockResolvedValue(verification([link({})]))
    renderDetail(session)
    expand()
    check()
    await waitFor(() => expect(mocks.verifyRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'rec-1' })))
  })
})
