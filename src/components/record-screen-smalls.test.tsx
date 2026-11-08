// @vitest-environment happy-dom
//
// Two small record-screen fixes from the end-to-end run (fix list, after
// the overnight build):
//   - the empty note line read "No note added. TapAdd noteto record why...":
//     a negative horizontal margin on the inline "Add note" button
//     swallowed the spaces either side of it. The line is now one
//     translated sentence (session.noteEmpty) with the button inside it as
//     <add>…</add>, so each language orders it naturally (fix list, last
//     lows); the spaces come from the sentence;
//   - "Delete record" and, on a shared copy, "Remove" were accent-600 text
//     on the vault (about 1.5:1). Both are Button's danger variant now
//     (src/lib/destructive-contrast.test.ts checks its contrast).
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import i18n from '../lib/i18n'
import { AuthContext, type AuthContextValue } from '../lib/auth-context-shape'
import { saveSession } from '../lib/storage'
import type { ParkingSession } from '../types'
import SessionDetail from './SessionDetail'
import SharedRecordScreen from './SharedRecordScreen'

// The record screen warms the PDF chunk on mount; keep jsPDF out of the test.
vi.mock('../lib/pdf', () => ({
  materializeRemotePhotos: async (s: ParkingSession) => s,
  downloadPdf: () => {},
}))
vi.mock('../lib/pdf-fonts', () => ({ prefetchPdfFont: async () => {} }))

const AUTH: AuthContextValue = {
  user: null,
  loading: false,
  configured: false,
  refresh: async () => {},
  signOut: () => {},
}

function withAuth(children: ReactNode) {
  return <AuthContext.Provider value={AUTH}>{children}</AuthContext.Provider>
}

function makeSession(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: new Date(Date.now() - 3600_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St, Melbourne VIC' },
    sign_photo: null,
    car_photo: null,
    rules: '2P Mon-Fri 8am-6pm',
    observations: [],
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    confidence: 'high',
    ...overrides,
  }
}

function renderDetail(session: ParkingSession) {
  saveSession(session)
  render(
    withAuth(
      <SessionDetail session={session} onBack={() => {}} onDelete={() => {}} onDraftAppeal={() => {}} onEndSession={() => {}} />,
    ),
  )
}

/** Classes that pull an inline element sideways over its neighbours. */
const NEGATIVE_X_MARGIN = /(?:^|\s)(?:[a-z0-9-]+:)*-m[xlrse]-/

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  localStorage.clear()
})

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('the empty note line', () => {
  it('reads as one sentence in English, with a space either side of the button', () => {
    renderDetail(makeSession())
    const inline = screen
      .getAllByRole('button', { name: 'Add note' })
      .find((b) => b.parentElement?.tagName === 'P')
    expect(inline).toBeDefined()
    expect(inline!.parentElement!.textContent).toBe(
      "No note added. Tap Add note to record why you were here, in your own words. Notes aren't signed.",
    )
  })

  for (const lng of ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']) {
    it(`is the one translated sentence with the Add note button inside it (${lng})`, async () => {
      await i18n.changeLanguage(lng)
      renderDetail(makeSession())
      const addNote = i18n.t('session.addNote')
      // The heading's button and the inline one share the name; the inline
      // one sits inside the sentence.
      const inline = screen
        .getAllByRole('button', { name: addNote })
        .find((b) => b.parentElement?.tagName === 'P')
      expect(inline).toBeDefined()
      expect(inline!.textContent).toBe(addNote)
      const line = inline!.parentElement!
      // The whole sentence, in the locale's own order, button text in place.
      const sentence = i18n.t('session.noteEmpty')
      expect(sentence).toMatch(/<add>[^<]+<\/add>/)
      expect(line.textContent).toBe(sentence.replace(/<\/?add>/g, ''))
      // A negative side margin overlaps the spaces around it on screen.
      expect(inline!.className).not.toMatch(NEGATIVE_X_MARGIN)
    })
  }

  it('puts the verb after the button in ko, hi and pa', async () => {
    for (const lng of ['ko', 'hi', 'pa']) {
      const sentence = i18n.getFixedT(lng)('session.noteEmpty')
      const afterButton = sentence.slice(sentence.indexOf('</add>') + '</add>'.length)
      // "를 누르세요", "पर टैप करें", "'ਤੇ ਟੈਪ ਕਰੋ": the tap comes after the label.
      expect(afterButton, lng).toMatch(/누르세요|टैप करें|ਟੈਪ ਕਰੋ/)
    }
  })

  it('the old split keys are gone', () => {
    for (const lng of ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']) {
      expect(i18n.exists('session.noNote', { lng, fallbackLng: false }), lng).toBe(false)
      expect(i18n.exists('session.noteHelp', { lng, fallbackLng: false }), lng).toBe(false)
    }
  })

  it('the inline button opens the note editor', () => {
    renderDetail(makeSession())
    const inline = screen
      .getAllByRole('button', { name: i18n.t('session.addNote') })
      .find((b) => b.parentElement?.tagName === 'P')!
    fireEvent.click(inline)
    expect(screen.getByPlaceholderText(i18n.t('session.notePlaceholder'))).toBeTruthy()
  })
})

describe('destructive actions on the vault', () => {
  it('Delete record uses the danger style, not the old accent text', () => {
    renderDetail(makeSession())
    const del = screen.getByRole('button', { name: i18n.t('session.deleteSession') })
    expect(del.className).toMatch(/\btext-danger-300\b/)
    expect(del.className).toMatch(/\bbg-transparent\b/)
    expect(del.className).toMatch(/min-h-\[44px\]/)
    expect(del.className).not.toMatch(/accent-600/)
  })

  it('Remove on a shared copy uses the same danger style', () => {
    const copy = makeSession({
      id: 'copy-1',
      shared_from: {
        original_session_id: 'orig-1',
        received_at: new Date().toISOString(),
        shared_at: null,
        arrival_bundle: null,
        snapshot: {},
      },
    })
    render(<SharedRecordScreen session={copy} onBack={() => {}} onRemove={() => {}} />)
    const remove = screen.getByRole('button', { name: i18n.t('share.remove') })
    expect(remove.className).toMatch(/\btext-danger-300\b/)
    expect(remove.className).toMatch(/\bbg-transparent\b/)
    expect(remove.className).toMatch(/min-h-\[44px\]/)
    expect(remove.className).not.toMatch(/accent-600/)
  })
})
