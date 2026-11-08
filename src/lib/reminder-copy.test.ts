import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { reminderCopy, reminderTag } from './reminder-copy'
import type { ParkingSession } from '../types'

// Echo the key and interpolation values, so the test pins which copy is
// chosen and what time it carries without depending on locale files.
const t = ((key: string, opts?: Record<string, unknown>) =>
  `${key}|${JSON.stringify(opts ?? {})}`) as unknown as TFunction

const base = {
  id: 's1',
  arrived_at: '2026-10-25T01:00:00.000Z',
  expires_at: '2026-10-25T03:00:00.000Z',
  location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne' },
} as unknown as ParkingSession

describe('reminderCopy()', () => {
  it('names the absolute expiry time in the session timezone', () => {
    const { title, body } = reminderCopy(base, new Date('2026-10-25T02:45:00.000Z'), t)
    expect(title).toBe('12 King St, Melbourne')
    expect(body).toContain('reminders.pushBodyBefore')
    // 03:00Z is 2:00 pm in Melbourne (AEDT, UTC+11).
    expect(body).toMatch(/"time":"2:00\s?pm"/i)
    expect(body).toContain('"count":15')
  })

  it('uses the at-expiry copy when the reminder fires at expiry', () => {
    const { body } = reminderCopy(base, new Date('2026-10-25T03:00:00.000Z'), t)
    expect(body).toContain('reminders.pushBodyAtExpiry')
  })

  it('uses check-on copy anchored to arrival for no-sign sessions', () => {
    const s = { ...base, no_sign: true, expires_at: null } as ParkingSession
    const { body } = reminderCopy(s, new Date('2026-10-25T04:00:00.000Z'), t)
    expect(body).toContain('reminders.pushBodyCheckOn')
    expect(body).toMatch(/"time":"12:00\s?pm"/i)
  })

  it('falls back to the generic title without an address', () => {
    const s = { ...base, location: null } as unknown as ParkingSession
    expect(reminderCopy(s, new Date('2026-10-25T02:45:00.000Z'), t).title).toContain(
      'reminders.pushTitleFallback',
    )
  })
})

describe('reminderTag()', () => {
  it('matches the server formula in lambda/index.js pushReminderPlan()', () => {
    const fireAt = new Date('2026-10-25T02:45:00.000Z')
    expect(reminderTag('s1', fireAt)).toBe(`pp-s1-${fireAt.getTime()}`)
  })
})
