import { describe, it, expect } from 'vitest'
import { appUrl, parseDeepLink, recurringLink, sessionLink } from './deep-link'

describe('deep links', () => {
  it('points inside the PWA scope, not at the marketing landing', () => {
    expect(sessionLink('abc-123')).toBe(`${import.meta.env.BASE_URL}?session=abc-123`)
    expect(appUrl()).toBe(import.meta.env.BASE_URL)
  })

  it('parses a session link', () => {
    expect(parseDeepLink('?session=abc-123')).toEqual({ kind: 'session', sessionId: 'abc-123' })
  })

  it('rejects malformed session ids', () => {
    expect(parseDeepLink('?session=<script>')).toBeNull()
  })

  it('parses the landing footer links', () => {
    expect(parseDeepLink('?privacy=open')).toEqual({ kind: 'privacy' })
    expect(parseDeepLink('?feedback=open')).toEqual({ kind: 'feedback' })
  })

  it('opens the weekly reminders view from its link (T5a)', () => {
    expect(recurringLink()).toBe(`${import.meta.env.BASE_URL}?recurring=open`)
    expect(parseDeepLink(new URL(recurringLink(), 'https://x.test').search)).toEqual({ kind: 'recurring' })
    expect(parseDeepLink('?recurring=1')).toBeNull()
  })

  it('ignores unrelated params, including the OAuth ones', () => {
    expect(parseDeepLink('?code=x&state=y')).toBeNull()
    expect(parseDeepLink('')).toBeNull()
  })
})
