// @vitest-environment node
// Push delivery contract: every reminder alerts, stale reminders are dropped,
// and the push service is told the message is time-critical.
import { describe, it, expect } from 'vitest'
import { pushReminderPlan, pushSendOptions } from './index.js'

const SID = 'sess-123'
const EXP = '2026-10-25T05:00:00.000Z'
const expMs = Date.parse(EXP)

describe('pushReminderPlan()', () => {
  it('gives every fire time its own tag, so no reminder replaces another silently', () => {
    const a = pushReminderPlan({ session_id: SID, fire_at: '2026-10-25T04:30:00.000Z', expires_at: EXP })
    const b = pushReminderPlan({ session_id: SID, fire_at: '2026-10-25T04:55:00.000Z', expires_at: EXP })
    expect(a.tag).not.toBe(b.tag)
  })

  it('uses the same tag formula as the in-tab scheduler (src/lib/reminder-copy.ts)', () => {
    const fire = '2026-10-25T04:45:00.000Z'
    expect(pushReminderPlan({ session_id: SID, fire_at: fire, expires_at: EXP }).tag)
      .toBe(`pp-${SID}-${Date.parse(fire)}`)
  })

  it('labels the at-expiry reminder as expiry and earlier ones as before', () => {
    expect(pushReminderPlan({ session_id: SID, fire_at: EXP, expires_at: EXP }).kind).toBe('expiry')
    expect(pushReminderPlan({ session_id: SID, fire_at: '2026-10-25T04:45:00.000Z', expires_at: EXP }).kind)
      .toBe('before')
  })

  it('goes stale 15 minutes after the parking expires', () => {
    const plan = pushReminderPlan({ session_id: SID, fire_at: '2026-10-25T04:45:00.000Z', expires_at: EXP })
    expect(Date.parse(plan.stale_at)).toBe(expMs + 15 * 60 * 1000)
  })

  it('treats a no-sign session as a check-on reminder, stale an hour after firing', () => {
    const fire = '2026-10-25T04:45:00.000Z'
    const plan = pushReminderPlan({ session_id: SID, fire_at: fire, expires_at: null })
    expect(plan.kind).toBe('check')
    expect(Date.parse(plan.stale_at)).toBe(Date.parse(fire) + 60 * 60 * 1000)
  })
})

describe('pushSendOptions()', () => {
  it('sends with high urgency (the library default "normal" can be held in Doze)', () => {
    const opts = pushSendOptions({ session_id: SID, stale_at: EXP, nowMs: expMs - 10 * 60 * 1000 })
    expect(opts.urgency).toBe('high')
  })

  it('caps TTL at the time left until the reminder goes stale', () => {
    const opts = pushSendOptions({ session_id: SID, stale_at: EXP, nowMs: expMs - 10 * 60 * 1000 })
    expect(opts.TTL).toBe(600)
  })

  it('never sends a TTL below 60 seconds or above 6 hours', () => {
    expect(pushSendOptions({ session_id: SID, stale_at: EXP, nowMs: expMs - 5_000 }).TTL).toBe(60)
    expect(pushSendOptions({ session_id: SID, stale_at: EXP, nowMs: expMs - 48 * 3600_000 }).TTL).toBe(6 * 3600)
  })

  it('returns null once the reminder is stale, so it is not delivered late', () => {
    expect(pushSendOptions({ session_id: SID, stale_at: EXP, nowMs: expMs + 1 })).toBeNull()
  })

  it('falls back to a 30-minute TTL for schedules created before stale_at existed', () => {
    expect(pushSendOptions({ session_id: SID, stale_at: undefined, nowMs: expMs }).TTL).toBe(1800)
  })

  it('derives a stable RFC 8030 topic (at most 32 URL-safe characters) per session', () => {
    const a = pushSendOptions({ session_id: SID, stale_at: EXP, nowMs: expMs - 60_000 })
    const b = pushSendOptions({ session_id: SID, stale_at: EXP, nowMs: expMs - 120_000 })
    expect(a.topic).toBe(b.topic)
    expect(a.topic.length).toBeLessThanOrEqual(32)
    expect(a.topic).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
