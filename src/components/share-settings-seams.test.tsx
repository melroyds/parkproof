// @vitest-environment happy-dom
//
// Where T7 (sharing, handover, "Who's driving?") meets T4 (Settings: the
// driver's name and saved permits), checked with records built by T4's own
// code rather than hand-made fixtures:
// - "Who's driving?" starts from the name saved in Settings (T4's
//   loadProfile and logDraftFromProfile), the no-sign logger included, and
//   the logger's value, even a cleared one, wins over the Settings default
//   applyLogDraftDefaults would otherwise add at save;
// - the accessible-permit safeguard (T7 item 6) shows on the share and
//   handover screens for a permit_context T4 really saves, and only for an
//   accessible permit;
// - a share link carries nothing of the permit, and carries standard_until
//   exactly when T4's permit_context made the park permit-adjusted. T4
//   keeps the signed limit (expires_at) as the sign's standard limit and
//   the permit's later time in permit_until, so the receive view labels
//   the signed limit as read from the sign and never says it includes
//   time from a permit.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { getSession, loadProfile, saveProfile, saveSession } from '../lib/storage'
import { createMemoryPhotoBackend, setPhotoBackendForTests } from '../lib/photo-store'
import { applyLogDraftDefaults, buildArrivalContext } from '../lib/evidence-chain'
import { logDraftFromProfile, usablePermits } from '../lib/profile'
import { buildPermitContext, permitAdjustedUntil, permitAnswerFor, withResultAnswers } from '../lib/permit-answer'
import { prepareNewRecord, resetSigningQueueForTests, whenSigningIdle } from '../lib/signing'
import { SHARE_PAYLOAD_KEYS, makeShareToken } from '../lib/share-link'
import { createTestSigner, type TestSigner } from '../lib/test-support/test-signer'
import { signedOwnRecord } from '../lib/test-support/share-fixtures'
import type { ParkingRules, ParkingSession, SavedPermit } from '../types'
import en from '../locales/en.json'
import SessionLogger from './SessionLogger'
import ShareSheet from './ShareSheet'
import SessionDetail from './SessionDetail'
import SharedLinkView from './SharedLinkView'

vi.mock('../lib/pdf', () => ({ materializeRemotePhotos: async (s: ParkingSession) => s, downloadPdf: () => {} }))
vi.mock('../lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))
vi.mock('../lib/geocode', () => ({
  reverseGeocode: async () => null,
  reverseGeocodeDetails: async () => null,
  forwardGeocode: async () => null,
}))

const AUTH: AuthContextValue = { user: null, loading: false, configured: false, refresh: async () => {}, signOut: () => {} }

let signer: TestSigner

beforeAll(async () => {
  await i18n.changeLanguage('en')
  signer = await createTestSigner()
})

beforeEach(() => {
  localStorage.clear()
  resetSigningQueueForTests()
  setPhotoBackendForTests(createMemoryPhotoBackend())
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn() }, configurable: true })
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) =>
    String(input).endsWith('/sign-session') ? signer.fetch(input, init) : new Response('{}', { status: 503 }),
  )
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  cleanup()
  await whenSigningIdle()
  await new Promise((r) => setTimeout(r, 20))
  setPhotoBackendForTests(null)
  vi.unstubAllGlobals()
})

/** A T3-shaped sign reading: parking allowed now, for 90 minutes. */
function reading(over: Partial<ParkingRules> = {}): ParkingRules {
  return {
    sign_status: 'readable',
    sign_issues: [],
    rules: '2P 8am-6pm',
    observations: [],
    can_park_now: true,
    until: new Date(Date.now() + 90 * 60_000).toISOString(),
    duration_minutes: 90,
    confidence: 'high',
    requires_ticket: false,
    payment_methods: null,
    requires_disabled_permit: false,
    is_permit_zone: false,
    permit_area: null,
    is_area_sign: false,
    permit_exception: [],
    recurring_restrictions: [],
    next_transition: null,
    clarification: null,
    ...over,
  }
}

// ─── Item 1 and T4 item 7: who was driving ───────────────────────────────

describe('"Who\'s driving?" and the name saved in Settings', () => {
  const driverField = () => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + en.logger.driver.label.replace(/[?()]/g, '\\$&')) }))
    return screen.getByLabelText(en.logger.driver.label) as HTMLInputElement
  }
  const save = async () => {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en.logger.saveSession }))
    })
  }
  const signLogger = (draft: ReturnType<typeof logDraftFromProfile>, onComplete: (s: ParkingSession) => void) =>
    render(
      <SessionLogger
        rules={reading()}
        signPhoto={'data:image/jpeg;base64,' + btoa('scan-sign')}
        signPhotoMeta={{ captured_at: new Date().toISOString(), source: 'camera_input' }}
        draft={draft}
        onComplete={onComplete}
        onCancel={vi.fn()}
      />,
    )

  it('the no-sign logger, which gets no draft, starts from the Settings name, and the record keeps it', async () => {
    saveProfile({ driver_name: 'Alex Settings', permits: [] })
    const onComplete = vi.fn<(s: ParkingSession) => void>()
    render(<SessionLogger mode="no-sign" rules={null} signPhoto={null} onComplete={onComplete} onCancel={vi.fn()} />)
    expect(driverField().value).toBe('Alex Settings')
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    // App's save path for a no-sign record: a fresh draft from Settings.
    const draft = logDraftFromProfile(loadProfile())
    const record = applyLogDraftDefaults(onComplete.mock.calls[0][0], draft)
    expect(record.driver_name).toBe('Alex Settings')
    expect(buildArrivalContext(record, draft).driver_name).toBe('Alex Settings')
  })

  it('a scan starts from the Settings name too, and a cleared field saves nobody: the default never comes back', async () => {
    saveProfile({ driver_name: 'Alex Settings', permits: [] })
    const draft = logDraftFromProfile(loadProfile())
    const onComplete = vi.fn<(s: ParkingSession) => void>()
    signLogger(draft, onComplete)
    const field = driverField()
    expect(field.value).toBe('Alex Settings')
    fireEvent.change(field, { target: { value: '' } })
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const record = applyLogDraftDefaults(onComplete.mock.calls[0][0], draft)
    expect(record.driver_name).toBeNull()
    expect(buildArrivalContext(record, draft).driver_name).toBeNull()
  })

  it("the scan draft's driver comes before the Settings name", async () => {
    saveProfile({ driver_name: 'Alex Settings', permits: [] })
    signLogger({ ...logDraftFromProfile(loadProfile()), driver_name: 'Sam' }, vi.fn())
    expect(driverField().value).toBe('Sam')
  })
})

// ─── Records whose permit_context T4's own code built ────────────────────

const ACCESSIBLE: SavedPermit = { id: 'p-acc', type: 'accessible', state: 'VIC', area: null, expires_on: null }
const RESIDENT: SavedPermit = { id: 'p-res', type: 'resident', state: 'VIC', area: 'Area 25', expires_on: null }

/** A disabled bay: T4 asks the accessible-permit gate. */
const ACCESSIBLE_BAY = () => reading({ requires_disabled_permit: true })
/** A sign that prints an exception for resident permits in Area 25. */
const RESIDENT_EXCEPTION = () =>
  reading({
    is_permit_zone: true,
    permit_area: '25',
    permit_exception: [{ applies: true, permit_type: 'resident', text: 'PERMIT ZONE AREA 25' }],
  })

/**
 * A saved record with a signed arrival whose permit_context comes from T4:
 * the permit saved in Settings, the result screen's permit answer with
 * "Yes" (and the later permit time the driver typed, if any), the draft
 * App carries to the logger, and App's save path (applyLogDraftDefaults,
 * then prepareNewRecord for the salt). Its limit is the sign's standard
 * answer (`result.until`), as the logger saves it and link 0 signs it.
 */
async function t4PermitRecord(permit: SavedPermit, result: ParkingRules, permitUntil: Date | null = null): Promise<ParkingSession> {
  saveProfile({ driver_name: 'Sam', permits: [permit] })
  const profile = loadProfile()
  const answer = permitAnswerFor(result, usablePermits(profile))
  if (!answer) throw new Error('T4 found no permit for this sign')
  const draft = withResultAnswers(logDraftFromProfile(profile), {
    gate_acks: {
      meter_ticket: null,
      permit_zone: answer.gate === 'permit_zone' ? true : null,
      accessible_permit: answer.gate === 'accessible' ? true : null,
    },
    permit_context: buildPermitContext(answer, result, 'yes', permitUntil),
  })
  const logged = await signedOwnRecord(signer, { expires_at: result.until, rules: result.rules })
  const record = await prepareNewRecord(applyLogDraftDefaults(logged, draft))
  saveSession(record)
  return getSession(record.id)!
}

describe('the accessible-permit safeguard on a record T4 saved (item 6)', () => {
  it('T4 really saves the permit_context the safeguard reads', async () => {
    const accessible = await t4PermitRecord(ACCESSIBLE, ACCESSIBLE_BAY())
    expect(accessible.permit_context).toMatchObject({ type: 'accessible', holder_present: true })
    expect(accessible.permit_salt).toMatch(/^[0-9a-f]{64}$/)
    const resident = await t4PermitRecord(RESIDENT, RESIDENT_EXCEPTION())
    expect(resident.permit_context).toMatchObject({ type: 'resident', area: 'Area 25', holder_present: null })
  })

  it('shows on the share sheet for an accessible permit, and not for a resident permit', async () => {
    for (const [permit, result, shown] of [
      [ACCESSIBLE, ACCESSIBLE_BAY(), true],
      [RESIDENT, RESIDENT_EXCEPTION(), false],
    ] as const) {
      const record = await t4PermitRecord(permit, result)
      render(<ShareSheet session={record} onClose={vi.fn()} shareNavigator={{ share: vi.fn(async () => {}) }} />)
      expect(!!within(screen.getByRole('dialog')).queryByText(en.share.permitSafeguard)).toBe(shown)
      cleanup()
    }
  })

  it('shows on the handover sheet for an accessible permit, and not for a resident permit', async () => {
    const wrap = (children: ReactNode) => <AuthContext.Provider value={AUTH}>{children}</AuthContext.Provider>
    for (const [permit, result, shown] of [
      [ACCESSIBLE, ACCESSIBLE_BAY(), true],
      [RESIDENT, RESIDENT_EXCEPTION(), false],
    ] as const) {
      const record = await t4PermitRecord(permit, result)
      render(
        wrap(<SessionDetail session={record} onBack={() => {}} onDelete={() => {}} onDraftAppeal={() => {}} onEndSession={() => {}} />),
      )
      fireEvent.click(screen.getByRole('button', { name: en.handover.action }))
      const dialog = await screen.findByRole('dialog', { name: en.handover.action })
      expect(!!within(dialog).queryByText(en.share.permitSafeguard)).toBe(shown)
      cleanup()
      await whenSigningIdle()
    }
  })
})

describe("a share link from a record T4 saved: nothing of the permit, the standard limit when it was permit-adjusted", () => {
  const jsonOf = (token: string): Record<string, unknown> => {
    const body = token.slice(2).replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(body + '='.repeat((4 - (body.length % 4)) % 4))
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))))
  }
  /** The link's text a reader sees, without the signature's random base64 (it could hold any letters). */
  const readableText = (json: Record<string, unknown>) => {
    const bundle = json.bundle as Record<string, unknown>
    return JSON.stringify({ ...json, bundle: { ...bundle, signature_base64: '' } })
  }
  const tokenOf = (record: ParkingSession) => {
    const built = makeShareToken(record)
    if (!built.ok) throw new Error(built.error)
    return built.token
  }

  it('no standard_until when the permit gave no later time (no exception printed, or no later time typed)', async () => {
    const accessible = await t4PermitRecord(ACCESSIBLE, ACCESSIBLE_BAY())
    const resident = await t4PermitRecord(RESIDENT, RESIDENT_EXCEPTION())
    for (const record of [accessible, resident]) {
      expect(permitAdjustedUntil(record)).toBeNull()
      const json = jsonOf(tokenOf(record))
      expect(Object.keys(json)).toEqual([...SHARE_PAYLOAD_KEYS])
      expect(json.standard_until).toBeNull()
      const text = readableText(json)
      for (const secret of ['accessible', 'resident', 'Area 25', 'VIC', 'permit', record.permit_salt!]) {
        expect(text).not.toContain(secret)
      }
    }
  })

  it('shares the standard limit, which is the signed limit, when the sign gave the permit more time', async () => {
    const result = RESIDENT_EXCEPTION()
    const later = new Date(Date.parse(result.until!) + 2 * 60 * 60_000)
    const record = await t4PermitRecord(RESIDENT, result, later)
    // T4: permit-adjusted, with the later time in permit_until and the
    // record's limit left as the sign's standard answer.
    expect(record.permit_context!.permit_until).toBe(later.toISOString())
    expect(permitAdjustedUntil(record)).toBe(later.toISOString())
    expect(record.expires_at).toBe(result.until)

    const json = jsonOf(tokenOf(record))
    expect(Object.keys(json)).toEqual([...SHARE_PAYLOAD_KEYS])
    expect(json.standard_until).toBe(new Date(result.until!).toISOString())
    const text = readableText(json)
    for (const secret of ['resident', 'Area 25', 'VIC', 'permit', later.toISOString(), record.permit_salt!]) {
      expect(text).not.toContain(secret)
    }
  })

  it('the receive view labels that signed limit as read from the sign, with no permit-time line', async () => {
    const result = RESIDENT_EXCEPTION()
    const record = await t4PermitRecord(RESIDENT, result, new Date(Date.parse(result.until!) + 2 * 60 * 60_000))
    render(
      <SharedLinkView token={tokenOf(record)} onDone={vi.fn()} checkOptions={{ publicKeys: [signer.publicKey], acceptDevKey: false }} />,
    )
    expect(await screen.findByText(en.share.field.limit)).toBeTruthy()
    expect(screen.queryByText(en.share.field.limitRecorded)).toBeNull()
    expect(screen.queryByText(/extra time from a permit/)).toBeNull()
    // The sender's standard limit is still listed, under the unsigned extras.
    const unsigned = screen.getByText(en.share.unsignedHeading).closest('section')!
    expect(within(unsigned).getByText(en.share.field.standardLimit)).toBeTruthy()
  })
})
