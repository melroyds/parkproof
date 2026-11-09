import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { canEndRecord, endConfirmText, endedStatusTime, isLateEnd, recordStatus } from './record-status'
import type { ParkingSession, SignedAddendum } from '../types'

const NOW = new Date('2026-05-21T10:00:00+10:00').getTime()
const TZ = 'Australia/Melbourne'

/** Echoes the key and its options so tests can assert what was asked for. */
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}|${JSON.stringify(opts)}` : key) as unknown as TFunction

function makeSession(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 's1',
    arrived_at: '2026-05-21T08:00:00+10:00',
    location: { lat: -37.8136, lng: 144.9631 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
    ...overrides,
  }
}

describe('canEndRecord', () => {
  it('offers "I\'ve left" on any record without ended_at', () => {
    expect(canEndRecord(makeSession({ expires_at: '2026-05-21T12:00:00+10:00' }))).toBe(true)
    // Past its expiry: the driver may come back late and still needs it.
    expect(canEndRecord(makeSession({ expires_at: '2026-05-21T09:00:00+10:00' }))).toBe(true)
    // No expiry at all (no-sign, or a "can't park" record logged anyway).
    expect(canEndRecord(makeSession({ expires_at: null }))).toBe(true)
  })

  it('hides it once the record is ended', () => {
    expect(canEndRecord(makeSession({ ended_at: '2026-05-21T09:30:00+10:00' }))).toBe(false)
  })
})

describe('recordStatus (History rows)', () => {
  it('treats ended_at as ended, even when the expiry is still ahead', () => {
    const s = makeSession({
      expires_at: '2026-05-21T18:00:00+10:00',
      ended_at: '2026-05-21T09:30:00+10:00',
    })
    const status = recordStatus(s, NOW, t, TZ)
    expect(status.kind).toBe('ended')
    expect(status.urgency).toBeNull()
    expect(status.label.startsWith('session.endedAt|')).toBe(true)
    // The time is shown in the record's own zone.
    expect(status.label).toContain('9:30')
  })

  it('treats ended_at as ended on a no-expiry record', () => {
    const s = makeSession({ no_sign: true, ended_at: '2026-05-21T09:30:00+10:00' })
    expect(recordStatus(s, NOW, t, TZ).kind).toBe('ended')
  })

  it('says Expired for a past expiry that was never ended', () => {
    const s = makeSession({ expires_at: '2026-05-21T09:00:00+10:00' })
    expect(recordStatus(s, NOW, t, TZ)).toEqual({ kind: 'expired', label: 'history.expired', urgency: null })
  })

  it('says No expiry when there is none (or it cannot be read)', () => {
    expect(recordStatus(makeSession({ expires_at: null }), NOW, t, TZ).label).toBe('history.noExpiry')
    expect(recordStatus(makeSession({ expires_at: 'garbage' }), NOW, t, TZ).kind).toBe('no_expiry')
  })

  it('counts down a future expiry with the countdown urgency', () => {
    const s = makeSession({ expires_at: '2026-05-21T10:10:00+10:00' })
    const status = recordStatus(s, NOW, t, TZ)
    expect(status.kind).toBe('counting')
    expect(status.urgency).toBe('urgent')
    expect(status.label).toBe('time.minLeft|{"count":10}')
  })

  it('ignores an unparseable ended_at rather than calling the record ended', () => {
    const s = makeSession({ expires_at: '2026-05-21T09:00:00+10:00', ended_at: 'not a date' })
    expect(recordStatus(s, NOW, t, TZ).kind).toBe('expired')
  })
})

describe('isLateEnd / endConfirmText (the I have left confirm)', () => {
  it('is late once the expiry has passed', () => {
    expect(isLateEnd(makeSession({ expires_at: '2026-05-21T09:59:00+10:00' }), NOW)).toBe(true)
    expect(isLateEnd(makeSession({ expires_at: '2026-05-21T10:01:00+10:00' }), NOW)).toBe(false)
  })

  it('a no-expiry record is late only after 12 h open', () => {
    expect(isLateEnd(makeSession({ no_sign: true, arrived_at: '2026-05-21T08:00:00+10:00' }), NOW)).toBe(false)
    expect(isLateEnd(makeSession({ no_sign: true, arrived_at: '2026-05-20T21:00:00+10:00' }), NOW)).toBe(true)
  })

  it('an on-time tap gets the screen confirm, which says it is the phone tap time', () => {
    const s = makeSession({ expires_at: '2026-05-21T12:00:00+10:00' })
    expect(endConfirmText(s, t, TZ, 'active.iveLeftConfirm', NOW)).toBe('active.iveLeftConfirm')
    expect(endConfirmText(s, t, TZ, 'session.endConfirm', NOW)).toBe('session.endConfirm')
  })

  it('a late tap names the tap time that will be recorded, in the record time zone', () => {
    const s = makeSession({ expires_at: '2026-05-03T11:00:00+10:00', arrived_at: '2026-05-03T09:00:00+10:00' })
    const text = endConfirmText(s, t, TZ, 'session.endConfirm', NOW)
    expect(text.startsWith('session.endConfirmLate|')).toBe(true)
    // NOW is Thu 21 May, 10:00 am in Melbourne: the stored day, not the expiry day.
    expect(text).toContain('21 May')
    expect(text).toContain('10:00')
  })
})

describe('endedStatusTime (the record screen status line, fix list item 6)', () => {
  // Test D: 4e53e51d arrived 5:08 pm and ended 5:23 pm AEDT; e11bc03b
  // arrived 5:02 pm and ended 5:03 pm. Their status lines must differ.
  const testD = (overrides: Partial<ParkingSession> = {}) =>
    makeSession({
      arrived_at: '2026-11-08T06:08:11.000Z',
      ended_at: '2026-11-08T06:23:23.000Z',
      location: { lat: -37.8136, lng: 144.9631 },
      ...overrides,
    })

  it('is the tap time without the day when the record ended on the day it arrived', () => {
    expect(endedStatusTime(testD(), TZ)).toBe('5:23 pm AEDT')
    const other = testD({ arrived_at: '2026-11-08T06:02:47.000Z', ended_at: '2026-11-08T06:03:02.000Z' })
    expect(endedStatusTime(other, TZ)).toBe('5:03 pm AEDT')
  })

  it('is in the record zone, not the device zone', () => {
    const perth = testD({ location: { lat: -31.9523, lng: 115.8613 } })
    expect(endedStatusTime(perth, 'Australia/Perth')).toBe('2:23 pm AWST')
  })

  it('adds the day when the record ended on a later day than it arrived', () => {
    const overnight = testD({ ended_at: '2026-11-08T22:05:00.000Z' })
    expect(endedStatusTime(overnight, TZ)).toBe('Mon 9 Nov, 9:05 am AEDT')
  })

  it('uses the signed departure tap time, as the departure row does', () => {
    const departure: SignedAddendum = {
      id: 'dep-1',
      seq: 1,
      kind: 'departure',
      captured_at: '2026-11-08T06:23:23.000Z',
      data: {},
      bundle: {
        schema: 'parkproof-addendum-v1',
        signed_at: '2026-11-08T06:23:24.000Z',
        algorithm: 'ECDSA_SHA_256',
        key_alias: 'alias/parkproof-evidence-signing',
        canonical_payload: JSON.stringify({
          signed_at: '2026-11-08T06:23:24.000Z',
          data: { ended_at: '2026-11-08T06:23:20.000Z' },
        }),
        signature_base64: 'MEUCIQ==',
      },
    }
    // The signed tap was 5:23:20 pm; the stored ended_at says 5:24 pm.
    const s = testD({ ended_at: '2026-11-08T06:24:00.000Z', addenda: [departure] })
    expect(endedStatusTime(s, TZ)).toBe('5:23 pm AEDT')
  })

  it('is null for a record that has not ended, or an unreadable end', () => {
    expect(endedStatusTime(testD({ ended_at: undefined }), TZ)).toBeNull()
    expect(endedStatusTime(testD({ ended_at: 'garbage' }), TZ)).toBeNull()
  })
})
