// @vitest-environment happy-dom
//
// endedRows (pdf.ts): ended_at is the phone's tap time, not when the car
// left. A late "I've left" tap must never print a duration that reads as an
// overstay in the evidence or appeal PDF.
import { beforeAll, describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import i18n from './i18n'
import { endedRows } from './pdf'
import type { ParkingSession } from '../types'

const TZ = 'Australia/Melbourne'
const HOUR = 60 * 60 * 1000

/** Echo the key (and count) so assertions don't depend on copy. */
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts && 'count' in opts ? `${key}:${String(opts.count)}` : key) as unknown as TFunction

function makeSession(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: '2026-10-24T09:00:00+11:00',
    location: { lat: -37.8136, lng: 144.9631 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: '2026-10-24T11:00:00+11:00',
    confidence: 'high',
    ...overrides,
  }
}

const labels = (rows: [string, string][]) => rows.map(([label]) => label)

describe('endedRows', () => {
  it('is empty for a record that was never ended', () => {
    expect(endedRows(makeSession(), TZ, t)).toEqual([])
  })

  it('shows the tap time and the duration when the tap came before expiry', () => {
    const rows = endedRows(makeSession({ ended_at: '2026-10-24T10:30:00+11:00' }), TZ, t)
    expect(labels(rows)).toEqual(['pdf.evidence.field.endedAt', 'pdf.evidence.field.actualDuration'])
    expect(rows[1][1]).toBe('pdf.duration.hoursAndMins')
  })

  it('keeps the duration for a tap exactly at expiry', () => {
    const rows = endedRows(makeSession({ ended_at: '2026-10-24T11:00:00+11:00' }), TZ, t)
    expect(labels(rows)).toContain('pdf.evidence.field.actualDuration')
    expect(rows[1][1]).toBe('pdf.duration.hoursOnly:2')
  })

  it('gives no duration row when the tap came after expiry (late I\'ve left)', () => {
    // 2P sign, driver left on time, tapped I've left three hours later.
    const rows = endedRows(makeSession({ ended_at: '2026-10-24T14:00:00+11:00' }), TZ, t)
    expect(labels(rows)).toEqual(['pdf.evidence.field.endedAt'])
  })

  it('gives no duration row for a tap one minute after expiry', () => {
    const rows = endedRows(makeSession({ ended_at: '2026-10-24T11:01:00+11:00' }), TZ, t)
    expect(labels(rows)).toEqual(['pdf.evidence.field.endedAt'])
  })

  it('no-expiry record: keeps the duration within 12 h of arrival, drops it after', () => {
    const arrived = new Date('2026-10-24T09:00:00+11:00').getTime()
    const within = endedRows(
      makeSession({ expires_at: null, no_sign: true, ended_at: new Date(arrived + 3 * HOUR).toISOString() }),
      TZ,
      t,
    )
    expect(labels(within)).toContain('pdf.evidence.field.actualDuration')

    const late = endedRows(
      makeSession({ expires_at: null, no_sign: true, ended_at: new Date(arrived + 13 * HOUR).toISOString() }),
      TZ,
      t,
    )
    expect(labels(late)).toEqual(['pdf.evidence.field.endedAt'])
  })

  it('labels the end row as a phone tap time in English', async () => {
    await i18n.changeLanguage('en')
    const rows = endedRows(makeSession({ ended_at: '2026-10-24T14:00:00+11:00' }), TZ, i18n.t)
    expect(rows[0][0]).toBe("Tapped I've left (phone clock)")
    expect(rows.some(([label]) => /actual duration/i.test(label))).toBe(false)
  })
})

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
