// @vitest-environment happy-dom
//
// Sharing on screen (build spec T7 items 1 to 4, and item 6 on the share
// sheet): the logger's "Who's driving?" line, the share sheet (the confirm
// first, then the system share sheet, the clipboard or the link on
// screen), the receive view (signed details only from a link that checks
// out, the sender's extras labelled, the tampered message with no map
// link), and the read-only copy (its badge in History, its record screen
// with only the countdown, Directions, "Check the signature" and Remove).
// Bundles are signed by the REAL Lambda handler with a local test key.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from '../lib/photo-store'
import { buildArrivalContext, emptyLogDraft } from '../lib/evidence-chain'
import { createTestSigner, type TestSigner } from '../lib/test-support/test-signer'
import { signedOwnRecord } from '../lib/test-support/share-fixtures'
import { decodeShareToken, encodeShareToken, makeShareToken } from '../lib/share-link'
import { loadSessions, saveSession } from '../lib/storage'
import { formatInZone } from '../lib/time-format'
import { sharedCopyRecord, sharedFacts } from '../lib/shared-record'
import { shareExtrasOf } from '../lib/share-link'
import type { LogDraft, ParkingRules, ParkingSession, PermitContext } from '../types'
import en from '../locales/en.json'
import SessionLogger from './SessionLogger'
import ShareSheet from './ShareSheet'
import SharedLinkView from './SharedLinkView'
import SharedRecordScreen from './SharedRecordScreen'
import SharedFactsPanel from './SharedFactsPanel'
import SessionHistory from './SessionHistory'
import ActiveSessionCard from './ActiveSessionCard'

vi.mock('../lib/geocode', () => ({ reverseGeocode: async () => null, reverseGeocodeDetails: async () => null, forwardGeocode: async () => null }))

const RULES: ParkingRules = {
  rules: '2P Mon-Fri 8am-6pm',
  observations: [],
  can_park_now: true,
  until: '2026-11-08T03:00:00.000Z',
  duration_minutes: 120,
  confidence: 'high',
  clarification: null,
}
const SIGN = 'data:image/jpeg;base64,' + btoa('scan-sign')

let signer: TestSigner
let otherSigner: TestSigner

beforeAll(async () => {
  await i18n.changeLanguage('en')
  signer = await createTestSigner()
  otherSigner = await createTestSigner()
})

beforeEach(() => {
  localStorage.clear()
  setPhotoBackendForTests(createMemoryPhotoBackend())
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn() }, configurable: true })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  cleanup()
  await new Promise((r) => setTimeout(r, 20))
  setPhotoBackendForTests(null)
})

const permit = (type: PermitContext['type']): PermitContext => ({
  type,
  area: null,
  holder_present: null,
  sign_exception_applies: false,
  standard_until: null,
  permit_until: null,
  note: null,
})

// ─── Item 1: "Who's driving?" ────────────────────────────────────────────

describe("the logger's driver line", () => {
  const driverToggle = () =>
    screen.getByRole('button', { name: new RegExp('^' + en.logger.driver.label.replace(/[?()]/g, '\\$&')) })

  function renderLogger(draft: LogDraft | null, { open = true } = {}) {
    const onComplete = vi.fn<(s: ParkingSession) => void>()
    render(
      <SessionLogger
        rules={RULES}
        signPhoto={SIGN}
        signPhotoMeta={{ captured_at: '2026-11-08T00:58:00.000Z', source: 'camera_input' }}
        draft={draft}
        onComplete={onComplete}
        onCancel={vi.fn()}
      />,
    )
    if (!open) return { onComplete, field: null }
    fireEvent.click(driverToggle())
    return { onComplete, field: screen.getByLabelText(en.logger.driver.label) as HTMLInputElement }
  }

  it('is collapsed by default (an optional step), and the closed toggle shows the name that will be saved', async () => {
    const { onComplete } = renderLogger({ ...emptyLogDraft(), driver_name: 'Sam' }, { open: false })
    const toggle = driverToggle()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText(en.logger.driver.label)).toBeNull()
    // The prefilled name is never hidden: it is on the closed toggle.
    expect(toggle.textContent).toContain('Sam')
    // Saving without opening it saves that name (the common path is no slower).
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete.mock.calls[0][0].driver_name).toBe('Sam')
  })

  it('shows no name on the closed toggle when nobody is named', () => {
    renderLogger(null, { open: false })
    expect(driverToggle().textContent).toBe(en.logger.driver.label)
  })
  const save = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.logger.saveSession }))
    })
  }

  it('sits between the car photo and the condition section, optional and empty by default', async () => {
    const { field: opened, onComplete } = renderLogger(null)
    const field = opened!
    const car = screen.getByText(en.logger.carAtSpot)
    const condition = screen.getByRole('button', { name: new RegExp('^' + en.logger.condition.toggle.replace(/[()]/g, '\\$&')) })
    expect(car.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(field.compareDocumentPosition(condition) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(field.value).toBe('')
    expect(field.maxLength).toBe(60)
    // Save works with nobody named, and says so (null, never a default).
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    expect(onComplete.mock.calls[0][0].driver_name).toBeNull()
  })

  it("is prefilled from the draft's driver and saved on the record and in the arrival_context", async () => {
    const draft = { ...emptyLogDraft(), driver_name: 'Sam' }
    const { field: opened, onComplete } = renderLogger(draft)
    const field = opened!
    expect(field.value).toBe('Sam')
    fireEvent.change(field, { target: { value: '  Alex  ' } })
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const saved = onComplete.mock.calls[0][0]
    expect(saved.driver_name).toBe('Alex')
    expect(buildArrivalContext(saved, draft).driver_name).toBe('Alex')
  })

  it('a cleared prefilled field signs nobody, not the default', async () => {
    const draft = { ...emptyLogDraft(), driver_name: 'Sam' }
    const { field: opened, onComplete } = renderLogger(draft)
    const field = opened!
    fireEvent.change(field, { target: { value: '' } })
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const saved = onComplete.mock.calls[0][0]
    expect(saved.driver_name).toBeNull()
    expect(buildArrivalContext(saved, draft).driver_name).toBeNull()
  })

  it('keeps a name inside the signed field: no control characters, at most 60', async () => {
    const { field: opened, onComplete } = renderLogger(null)
    const field = opened!
    fireEvent.change(field, { target: { value: `Sam‮${'y'.repeat(80)}` } })
    expect(field.value.length).toBe(60)
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const name = onComplete.mock.calls[0][0].driver_name!
    expect(name).not.toMatch(/‮/)
    expect(name.length).toBeLessThanOrEqual(60)
  })
})

// ─── Item 2: the share sheet ─────────────────────────────────────────────

describe('the share sheet', () => {
  function renderSheet(session: ParkingSession, nav: Parameters<typeof ShareSheet>[0]['shareNavigator']) {
    const onClose = vi.fn()
    render(<ShareSheet session={session} onClose={onClose} shareNavigator={nav} />)
    return { onClose, dialog: screen.getByRole('dialog') }
  }

  it("shows the spec's confirm first and makes no link until Share link is tapped", async () => {
    const session = await signedOwnRecord(signer)
    const share = vi.fn(async () => {})
    const { dialog } = renderSheet(session, { share })
    expect(within(dialog).getByText(en.share.confirm)).toBeTruthy()
    expect(en.share.confirm).toBe(
      "Anyone with this link can see where the car is parked, who parked it and until when. It works for anyone it's forwarded to, and you can't switch it off.",
    )
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(share).not.toHaveBeenCalled()
  })

  it('hands /app/#share=1.<token> carrying the signed arrival to the system share sheet, then closes', async () => {
    const session = await signedOwnRecord(signer)
    const share = vi.fn(async (data: ShareData) => {
      void data
    })
    const { onClose } = renderSheet(session, { share })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.share.shareButton }))
    })
    expect(share).toHaveBeenCalledTimes(1)
    const url = share.mock.calls[0][0].url!
    expect(url.startsWith(`${window.location.origin}${import.meta.env.BASE_URL}#share=1.`)).toBe(true)
    const read = decodeShareToken(url.split('#share=')[1])
    expect(read.ok && read.payload.bundle.signature_base64).toBe(session.signature!.signature_base64)
    expect(read.ok && read.payload.driver).toBe('Sam')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('names the driver the handover flow passes instead of the record driver', async () => {
    const session = await signedOwnRecord(signer)
    const share = vi.fn(async (data: ShareData) => {
      void data
    })
    render(<ShareSheet session={session} onClose={vi.fn()} driver="Alex" shareNavigator={{ share }} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.share.shareButton }))
    })
    const read = decodeShareToken(share.mock.calls[0][0].url!.split('#share=')[1])
    expect(read.ok && read.payload.driver).toBe('Alex')
  })

  it('copies the link when there is no share sheet, and shows it when the clipboard fails too', async () => {
    const session = await signedOwnRecord(signer)
    const writeText = vi.fn(async (text: string) => {
      void text
    })
    renderSheet(session, { clipboard: { writeText } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.share.shareButton }))
    })
    expect(await screen.findByText(en.share.copied)).toBeTruthy()
    expect(writeText.mock.calls[0][0]).toContain('#share=1.')
    cleanup()
    renderSheet(session, {})
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.share.shareButton }))
    })
    const field = (await screen.findByLabelText(en.share.linkFieldLabel)) as HTMLInputElement
    expect(field.readOnly).toBe(true)
    expect(field.value).toContain('#share=1.')
  })

  it('cannot share a record whose arrival is not signed yet', async () => {
    const session = { ...(await signedOwnRecord(signer)), signature: undefined }
    const share = vi.fn(async () => {})
    renderSheet(session, { share })
    expect(screen.getByText(en.share.notSigned)).toBeTruthy()
    const button = screen.getByRole('button', { name: en.share.shareButton }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(share).not.toHaveBeenCalled()
  })

  it('warns about an accessible parking permit, and only that permit (item 6)', async () => {
    const accessible = await signedOwnRecord(signer, { permit_context: permit('accessible') })
    renderSheet(accessible, {})
    expect(screen.getByText(en.share.permitSafeguard)).toBeTruthy()
    cleanup()
    for (const other of [permit('resident'), permit('business'), null]) {
      renderSheet({ ...accessible, permit_context: other }, {})
      expect(screen.queryByText(en.share.permitSafeguard)).toBeNull()
      cleanup()
    }
  })

  it('Escape and Cancel close it', async () => {
    const session = await signedOwnRecord(signer)
    const { onClose } = renderSheet(session, {})
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: en.common.cancel }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

// ─── Item 3: the receive view ────────────────────────────────────────────

describe('the receive view', () => {
  const tokenOf = (session: ParkingSession, now = new Date()) => {
    const built = makeShareToken(session, { now })
    if (!built.ok) throw new Error(built.error)
    return built.token
  }
  const renderView = (token: string) =>
    render(<SharedLinkView token={token} onDone={vi.fn()} checkOptions={{ publicKeys: [signer.publicKey], acceptDevKey: false }} />)

  it('shows the banner, the signed details and the labelled extras, and keeps a copy', async () => {
    const title = document.title
    const sharedAt = new Date()
    const original = await signedOwnRecord(signer, { rules: '2P Mon-Fri 8am-6pm' })
    renderView(tokenOf(original, sharedAt))
    const banner = `Shared by Sam at ${formatInZone(sharedAt, 'Australia/Melbourne')}. This is a snapshot and doesn't update. The car may have moved.`
    expect(await screen.findByText(banner)).toBeTruthy()
    expect(screen.getAllByText('12 King St, Melbourne').length).toBeGreaterThan(0)
    expect(screen.getByText('-37.81360, 144.96310')).toBeTruthy()
    expect(screen.getByText(`${formatInZone(original.arrived_at, 'Australia/Melbourne')} (phone clock)`)).toBeTruthy()
    expect(screen.getByText(formatInZone(original.expires_at!, 'Australia/Melbourne'))).toBeTruthy()
    // The extras sit under the spec's label.
    const unsigned = screen.getByText(en.share.unsignedHeading).closest('section')!
    expect(within(unsigned).getByText('Sam')).toBeTruthy()
    expect(within(unsigned).getByText('2P Mon-Fri 8am-6pm')).toBeTruthy()
    const directions = screen.getByRole('link', { name: en.share.directions }) as HTMLAnchorElement
    expect(directions.href).toContain('-37.8136')
    expect(screen.getByText(en.share.saved)).toBeTruthy()
    expect(loadSessions().filter((s) => s.shared_from?.original_session_id === original.id)).toHaveLength(1)
    // Never the page title from the snapshot.
    expect(document.title).toBe(title)
  })

  it('names nobody when the sender named no driver', async () => {
    const sharedAt = new Date()
    renderView(tokenOf(await signedOwnRecord(signer, { driver_name: null }), sharedAt))
    expect(
      await screen.findByText(
        `Shared at ${formatInZone(sharedAt, 'Australia/Melbourne')}. This is a snapshot and doesn't update. The car may have moved.`,
      ),
    ).toBeTruthy()
  })

  it('a changed link shows the tampered message, no details, no map link, and keeps nothing', async () => {
    const original = await signedOwnRecord(signer)
    const read = decodeShareToken(tokenOf(original))
    if (!read.ok) throw new Error('unreadable')
    const changed = encodeShareToken({
      ...read.payload,
      bundle: { ...read.payload.bundle, canonical_payload: read.payload.bundle.canonical_payload.replace('12 King St', '14 King St') },
    })
    renderView(changed)
    expect(await screen.findByText('This link has been changed since it was shared')).toBeTruthy()
    expect(screen.queryByRole('link', { name: en.share.directions })).toBeNull()
    expect(screen.queryByText(/King St/)).toBeNull()
    expect(screen.queryByText(en.share.unsignedHeading)).toBeNull()
    expect(loadSessions()).toEqual([])
  })

  it('a bundle from another key reads as changed', async () => {
    renderView(tokenOf(await signedOwnRecord(otherSigner)))
    expect(await screen.findByText(en.share.tampered)).toBeTruthy()
    expect(screen.queryByRole('link', { name: en.share.directions })).toBeNull()
  })

  it('refuses a newer version and an unreadable link before checking anything', async () => {
    const token = tokenOf(await signedOwnRecord(signer))
    renderView(`2.${token.slice(2)}`)
    expect(screen.getByText('This link was made by a newer version of ParkProof')).toBeTruthy()
    cleanup()
    renderView('1.@@@')
    expect(screen.getByText(en.share.unreadable)).toBeTruthy()
    expect(loadSessions()).toEqual([])
  })
})

// ─── Item 4: the read-only copy ──────────────────────────────────────────

async function storedCopy(over: Partial<ParkingSession> = {}): Promise<ParkingSession> {
  const original = await signedOwnRecord(signer)
  const payload = JSON.parse(original.signature!.canonical_payload)
  const facts = sharedFacts(payload, shareExtrasOf({ driver: 'Sam', rules: '2P' }), new Date().toISOString())!
  const copy = { ...sharedCopyRecord(facts, original.signature!, new Date().toISOString(), 'copy-1'), ...over }
  saveSession(copy)
  return copy
}

describe("the copy's record screen", () => {
  it('has the countdown, Directions, Check the signature and Remove, and nothing else to do', async () => {
    const copy = await storedCopy()
    const onRemove = vi.fn()
    render(<SharedRecordScreen session={copy} onBack={vi.fn()} onRemove={onRemove} publicKeys={[signer.publicKey]} acceptDevKey={false} />)
    expect(screen.getByRole('heading', { name: en.share.badge })).toBeTruthy()
    expect(screen.getByText(/left$/)).toBeTruthy()
    expect(screen.getByRole('link', { name: en.share.directions })).toBeTruthy()
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons).toEqual([en.common.backToHistory, en.share.check, en.share.remove])
  })

  it('checks the sender bundle, and a copy that fails loses its map link', async () => {
    const copy = await storedCopy()
    render(<SharedRecordScreen session={copy} onBack={vi.fn()} onRemove={vi.fn()} publicKeys={[signer.publicKey]} acceptDevKey={false} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.share.check }))
    })
    expect(await screen.findByText(en.share.checkValid)).toBeTruthy()
    cleanup()
    // The stored copy's signature no longer verifies (the screen reads the stored record).
    localStorage.clear()
    const bad = {
      ...copy,
      shared_from: {
        ...copy.shared_from!,
        arrival_bundle: { ...copy.shared_from!.arrival_bundle!, signature_base64: copy.shared_from!.arrival_bundle!.signature_base64.replace(/^.{8}/, 'MEUCIQCA') },
      },
    }
    saveSession(bad)
    render(<SharedRecordScreen session={bad} onBack={vi.fn()} onRemove={vi.fn()} publicKeys={[signer.publicKey]} acceptDevKey={false} />)
    expect(screen.getByRole('link', { name: en.share.directions })).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.share.check }))
    })
    expect(await screen.findByText(en.share.tampered)).toBeTruthy()
    expect(screen.queryByRole('link', { name: en.share.directions })).toBeNull()
  })

  it('Remove asks first', async () => {
    const copy = await storedCopy()
    const onRemove = vi.fn()
    render(<SharedRecordScreen session={copy} onBack={vi.fn()} onRemove={onRemove} />)
    // happy-dom has no window.confirm: install one (no, then yes).
    const confirm = vi.fn((message?: string) => {
      void message
      return false
    })
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true)
    Object.defineProperty(window, 'confirm', { value: confirm, configurable: true, writable: true })
    fireEvent.click(screen.getByRole('button', { name: en.share.remove }))
    expect(onRemove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.share.remove }))
    expect(confirm).toHaveBeenCalledWith(en.share.removeConfirm)
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: 'copy-1' }))
  })
})

describe('History and the home card', () => {
  it('badges a shared copy, and only a shared copy, "Shared with you"', async () => {
    await storedCopy()
    saveSession({ ...(await signedOwnRecord(signer)), id: 'own-1' })
    render(<SessionHistory onBack={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.getAllByText(en.share.badge)).toHaveLength(1)
    const rows = screen.getAllByRole('button').filter((b) => b.className.includes('gf-card'))
    const badged = rows.filter((r) => within(r).queryByText(en.share.badge))
    expect(badged).toHaveLength(1)
    // Newest first: own-1 was saved last.
    expect(rows.indexOf(badged[0])).toBe(1)
  })

  it("the active card's Share icon asks App to open the share sheet; no icon without the handler", async () => {
    const session = await signedOwnRecord(signer)
    const onShare = vi.fn()
    render(<ActiveSessionCard session={session} extraCount={2} onOpen={vi.fn()} onShowMore={vi.fn()} onShare={onShare} />)
    const icon = screen.getByRole('button', { name: en.share.action })
    expect(icon.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(icon)
    expect(onShare).toHaveBeenCalledWith(session)
    // The "+N more" pill still works beside it.
    expect(screen.getByRole('button', { name: i18n.t('active.morePillAria', { count: 2 }) })).toBeTruthy()
    cleanup()
    render(<ActiveSessionCard session={session} extraCount={0} onOpen={vi.fn()} />)
    expect(screen.queryByRole('button', { name: en.share.action })).toBeNull()
  })
})

// ─── What the signed details say, and a permit-adjusted share ────────────

describe('the signed details of a shared record', () => {
  const NOW = Date.parse('2026-11-08T02:00:00.000Z')
  const TZ = 'Australia/Melbourne'
  const payload = {
    session_id: 'orig-1',
    arrived_at: '2026-11-08T01:00:00.000Z',
    expires_at: '2026-11-08T07:00:00.000Z',
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne' },
    rules: '2P',
    confidence: 'high',
    signed_at: '2026-11-08T01:00:05.000Z',
  }
  const facts = (extras: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    sharedFacts({ ...payload, ...over }, shareExtrasOf(extras), '2026-11-08T01:30:00.000Z')!
  const countdown = (container: HTMLElement) => container.querySelector('.tnum.text-3xl') as HTMLElement

  it('carry the full caveat of the copy rules wherever signed material is shown', () => {
    const caveat = 'who was driving, where the car was, or when it arrived or left.'
    expect(en.share.signedNote).toContain(`It doesn't show they are true, ${caveat}`)
    expect(en.share.signedNoteNoTime).toContain(`It doesn't show they are true, ${caveat}`)
    expect(en.share.checkValid).toContain(caveat)
    render(<SharedFactsPanel facts={facts({})} now={NOW} showDirections />)
    expect(screen.getByText(en.share.signedNote.replace('{{time}}', formatInZone(payload.signed_at, TZ)))).toBeTruthy()
  })

  it('label the signed limit as read from the sign, with no permit line, when no standard limit is shared', () => {
    render(<SharedFactsPanel facts={facts({})} now={NOW} showDirections />)
    expect(screen.getByText(en.share.field.limit)).toBeTruthy()
    expect(screen.queryByText(en.share.field.limitRecorded)).toBeNull()
    expect(screen.queryByText(/extra time from a permit/)).toBeNull()
  })

  it("on a permit-adjusted share, label the signed limit neutrally and say the sign's standard limit applies without the permit", () => {
    const standard = '2026-11-08T03:00:00.000Z'
    render(<SharedFactsPanel facts={facts({ standard_until: standard })} now={NOW} showDirections />)
    // Never "read from the sign": the signed limit is the permit time here.
    expect(screen.queryByText(en.share.field.limit)).toBeNull()
    expect(screen.getByText(en.share.field.limitRecorded)).toBeTruthy()
    expect(
      screen.getByText(
        `This limit includes extra time from a permit. Without the permit, the sign's standard limit applies. The sender says it ends at ${formatInZone(standard, TZ)}.`,
      ),
    ).toBeTruthy()
    // The standard limit is still listed as the sender's, not signed.
    expect(screen.getByText(en.share.field.standardLimit)).toBeTruthy()
  })

  it('glow mint only while the limit is ahead and the sender has not said they left', () => {
    const { container, unmount } = render(<SharedFactsPanel facts={facts({})} now={NOW} showDirections />)
    expect(countdown(container).className).toContain('text-[#7BE3A4]')
    expect(countdown(container).style.textShadow).not.toBe('')
    unmount()

    const expired = render(<SharedFactsPanel facts={facts({})} now={Date.parse('2026-11-08T08:00:00.000Z')} showDirections />)
    expect(countdown(expired.container).textContent).toBe(en.history.expired)
    expect(countdown(expired.container).className).not.toContain('text-[#7BE3A4]')
    expect(countdown(expired.container).style.textShadow).toBe('')
    expired.unmount()

    const left = render(<SharedFactsPanel facts={facts({ ended_at: '2026-11-08T01:50:00.000Z' })} now={NOW} showDirections />)
    expect(countdown(left.container).className).not.toContain('text-[#7BE3A4]')
  })
})
