// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { appUrl, clearDeepLinkParams, parseDeepLink, recurringLink, sessionLink, shareLink, shareTokenFromHash } from './deep-link'

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

  // T7: share links live in the fragment, so the snapshot never reaches a server.
  it('builds a share link as /app/#share=<token> under the PWA scope', () => {
    expect(shareLink('1.abc_-', 'https://www.parkproof.com.au')).toBe(
      `https://www.parkproof.com.au${import.meta.env.BASE_URL}#share=1.abc_-`,
    )
  })

  it('reads a share token from the fragment, and it wins over a query param', () => {
    expect(parseDeepLink('', '#share=1.abc_-')).toEqual({ kind: 'share', token: '1.abc_-' })
    expect(parseDeepLink('?session=abc-123', '#share=1.xyz')).toEqual({ kind: 'share', token: '1.xyz' })
    expect(parseDeepLink('?session=abc-123', '#other=1')).toEqual({ kind: 'session', sessionId: 'abc-123' })
    expect(shareTokenFromHash('')).toBeNull()
    expect(shareTokenFromHash('#')).toBeNull()
    // An empty token is still a share link (it is refused as unreadable later).
    expect(parseDeepLink('', '#share=')).toEqual({ kind: 'share', token: '' })
    // A share token in the query is not a share link.
    expect(parseDeepLink('?share=1.abc', '')).toBeNull()
  })

  it('clears a share link from the address bar with replaceState, keeping the path', () => {
    window.history.replaceState({}, '', '/app/?session=abc-123#share=1.abc_-')
    clearDeepLinkParams()
    expect(window.location.pathname).toBe('/app/')
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('')
    // An unrelated fragment is left alone.
    window.history.replaceState({}, '', '/app/#section')
    clearDeepLinkParams()
    expect(window.location.hash).toBe('#section')
  })
})
