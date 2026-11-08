// @vitest-environment happy-dom
//
// What the Verified Seal says to a screen reader (fix round 1). Its label,
// "Signed, tamper-evident record" (common.signedSeal), used to be fixed inside
// the component, so it was read out wherever the seal appeared: on the result
// card after the driver tapped "correct", where nothing has been signed, and
// beside a development-key signature, which spec N2 says is never presented
// as valid. The label is now given only where the seal is the signal and true
// there; everywhere else the seal is decorative.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { saveSession } from '../lib/storage'
import { DEV_KEY_ALIAS } from '../lib/evidence-chain'
import type { ParkingRules, ParkingSession, SignatureBundle } from '../types'
import VerifiedSeal from './VerifiedSeal'
import SessionHistory from './SessionHistory'
import ParkingResult from './ParkingResult'
import LandingFeatures from './LandingFeatures'

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Every seal on the page: the svg drawn with the seal's 48-unit viewBox and pine disc. */
function seals(root: ParentNode = document.body): SVGSVGElement[] {
  return [...root.querySelectorAll('svg')].filter(
    (svg) => svg.getAttribute('viewBox') === '0 0 48 48' && svg.querySelector('circle[r="14.5"]'),
  ) as SVGSVGElement[]
}

function bundle(key_alias: string): SignatureBundle {
  return {
    schema: 'parkproof-evidence-v2',
    signed_at: '2026-11-09T01:00:00.000Z',
    algorithm: 'ECDSA_SHA_256',
    key_alias,
    canonical_payload: '{}',
    signature_base64: 'MEUCIQ' + 'A'.repeat(60),
  }
}

function record(id: string, arrivedAt: string, signature?: SignatureBundle): ParkingSession {
  return {
    id,
    arrived_at: arrivedAt,
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne', source: 'gps', accuracy_meters: 9 },
    sign_photo: null,
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: null,
    confidence: 'high',
    ended_at: new Date(Date.parse(arrivedAt) + 60 * 60_000).toISOString(),
    ...(signature ? { signature } : {}),
  }
}

describe('VerifiedSeal', () => {
  it('is hidden from screen readers unless it is given a label', () => {
    const { container } = render(<VerifiedSeal />)
    const svg = seals(container)[0]
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.hasAttribute('role')).toBe(false)
    expect(svg.hasAttribute('aria-label')).toBe(false)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('says what it is given', () => {
    render(<VerifiedSeal label="A label" />)
    expect(screen.getByRole('img', { name: 'A label' })).toBeTruthy()
  })
})

describe('the seal in History', () => {
  it('says a record signed with ParkProof\'s key is signed, and a development-key one is not checkable', () => {
    saveSession(record('kms', '2026-11-09T00:30:00.000Z', bundle('alias/parkproof-evidence-signing')))
    saveSession(record('dev', '2026-11-08T00:30:00.000Z', bundle(DEV_KEY_ALIAS)))
    saveSession(record('unsigned', '2026-11-07T00:30:00.000Z'))
    render(<SessionHistory onBack={vi.fn()} onOpen={vi.fn()} />)

    const signed = screen.getAllByRole('img', { name: i18n.t('common.signedSeal') })
    const dev = screen.getAllByRole('img', { name: i18n.t('session.devKeySigned') })
    expect(signed).toHaveLength(1)
    expect(dev).toHaveLength(1)
    // Each label sits on its own record's row, and the unsigned record has no seal.
    const rows = screen.getAllByRole('button').filter((b) => b.className.includes('gf-card'))
    expect(rows).toHaveLength(3)
    const rowWith = (text: string) => rows.find((r) => within(r).queryAllByText(text, { exact: false }).length > 0)
    expect(rowWith('9 Nov')!.contains(signed[0])).toBe(true)
    expect(rowWith('8 Nov')!.contains(dev[0])).toBe(true)
    expect(seals(rowWith('7 Nov')!)).toHaveLength(0)
  })
})

describe('the seal where nothing is signed', () => {
  const RESULT: ParkingRules = {
    rules: '2P Mon-Fri 8am-6pm',
    observations: [{ scope: 'Whole sign', items: ['2P'] }],
    can_park_now: true,
    until: '2026-11-09T05:00:00.000Z',
    duration_minutes: 120,
    confidence: 'high',
    clarification: null,
  }

  it('is decorative on the result card once the driver confirms the reading', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
    render(
      <ParkingResult
        result={RESULT}
        signPhoto="data:image/jpeg;base64,AAAA"
        coords={{ lat: -37.8136, lng: 144.9631 }}
        onScanAnother={vi.fn()}
        onLogSession={vi.fn()}
        onRetake={vi.fn()}
      />,
    )
    expect(seals()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('result.verifyYes') }))
    expect(screen.getByText(i18n.t('result.verifyConfirmed'))).toBeTruthy()
    const shown = seals()
    expect(shown).toHaveLength(1)
    expect(shown[0].getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('img', { name: i18n.t('common.signedSeal') })).toBeNull()
  })

  it('is decorative in the first-run landing callout', () => {
    render(<LandingFeatures onScanCta={vi.fn()} onSignInCta={vi.fn()} />)
    const shown = seals()
    expect(shown.length).toBeGreaterThan(0)
    for (const svg of shown) expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('img', { name: i18n.t('common.signedSeal') })).toBeNull()
  })
})
