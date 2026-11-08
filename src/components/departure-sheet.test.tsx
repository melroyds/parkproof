// @vitest-environment happy-dom
//
// The departure sheet (spec T1a) that replaced the browser confirm behind
// "I've left": what it says will be stored (the phone's tap time; a late
// tap names that time), its one location status line, Confirm and Cancel,
// and the modal rules (focus inside, Tab trapped, Escape and a tap outside
// cancel, focus back to the opener, or to returnFocus() when Confirm
// removed the opener).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import type { DepartureFixRequest, DepartureFixState } from '../lib/departure'
import type { ParkingSession } from '../types'
import DepartureSheet from './DepartureSheet'

function makeSession(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    confidence: 'high',
    ...overrides,
  }
}

function fakeFix(initial: DepartureFixState = { status: 'pending' }) {
  let state = initial
  const listeners = new Set<() => void>()
  const request: DepartureFixRequest = {
    current: () => state,
    settled: new Promise(() => {}),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    request,
    set(next: DepartureFixState) {
      state = next
      act(() => {
        for (const l of listeners) l()
      })
    },
  }
}

function renderSheet(
  session = makeSession(),
  fix = fakeFix(),
  confirmKey: 'active.iveLeftConfirm' | 'session.endConfirm' = 'active.iveLeftConfirm',
) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<DepartureSheet session={session} fix={fix.request} confirmKey={confirmKey} onConfirm={onConfirm} onCancel={onCancel} />)
  return { onConfirm, onCancel, fix }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('DepartureSheet', () => {
  it('is a modal dialog titled "I\'ve left" whose body is the phone-clock confirm', () => {
    renderSheet(makeSession(), fakeFix(), 'session.endConfirm')
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('heading', { name: i18n.t('active.iveLeft') })).toBeTruthy()
    expect(screen.getByText(i18n.t('session.endConfirm'))).toBeTruthy()
    // Focus starts on the title, so a stray Enter fires neither action.
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: i18n.t('active.iveLeft') }))
  })

  it('a late tap names the phone time that will be recorded, and follows the clock', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-25T02:55:10.000Z'))
    renderSheet(
      makeSession({ arrived_at: '2026-10-25T00:00:00.000Z', expires_at: '2026-10-25T02:00:00.000Z' }),
    )
    // The same format, zone name included, as the departure row will show the tap in.
    expect(screen.getByRole('dialog').textContent).toContain('It will record Sun 25 Oct, 1:55 pm AEDT, the time you tap')
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByRole('dialog').textContent).toContain('It will record Sun 25 Oct, 1:56 pm AEDT')
  })

  it('the status line: getting the location, then captured with its accuracy, or none', () => {
    const { fix } = renderSheet()
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toBe('Getting your location')
    fix.set({ status: 'ok', fix: { lat: -37.81, lng: 144.96, accuracy_meters: 12, received_at: Date.now() } })
    expect(screen.getByRole('status').textContent).toBe('Location captured, ±12m')
    cleanup()

    const none = fakeFix({ status: 'none', reason: 'denied', at: Date.now() })
    renderSheet(makeSession(), none)
    expect(screen.getByRole('status').textContent).toBe('No location')
  })

  it('Confirm asks once, even when tapped twice; Cancel cancels', () => {
    const { onConfirm, onCancel } = renderSheet()
    const confirm = screen.getByRole('button', { name: i18n.t('departure.confirm') })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Escape and a tap outside cancel; a tap inside does not', () => {
    const { onCancel } = renderSheet()
    fireEvent.mouseDown(screen.getByText(i18n.t('active.iveLeftConfirm')))
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(screen.getByRole('dialog'))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('Tab stays inside the sheet, and focus returns to the opener when it closes', () => {
    const opener = document.createElement('button')
    opener.textContent = 'opener'
    document.body.appendChild(opener)
    opener.focus()
    renderSheet()
    // The first control is the collapsed condition section above Confirm (T2).
    const first = screen.getByRole('button', { name: i18n.t('departure.condition.toggle') })
    const cancel = screen.getByRole('button', { name: i18n.t('common.cancel') })

    cancel.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel)

    cleanup()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('when Confirm removed the opener, focus goes to returnFocus() instead of <body>', () => {
    const opener = document.createElement('button')
    opener.textContent = "I've left"
    document.body.appendChild(opener)
    opener.focus()
    const status = document.createElement('p')
    status.tabIndex = -1
    status.textContent = 'Ended'
    document.body.appendChild(status)
    const returnFocus = vi.fn(() => status)
    const { unmount } = render(
      <DepartureSheet
        session={makeSession()}
        fix={fakeFix().request}
        confirmKey="session.endConfirm"
        onConfirm={() => {}}
        onCancel={() => {}}
        returnFocus={returnFocus}
      />,
    )
    // The record ended: the I've left button went away while the sheet was open.
    opener.remove()
    unmount()
    expect(returnFocus).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(status)
    status.remove()
  })

  it('a cancelled sheet gives focus back to the opener, not to returnFocus()', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const returnFocus = vi.fn(() => null)
    const { unmount } = render(
      <DepartureSheet
        session={makeSession()}
        fix={fakeFix().request}
        confirmKey="session.endConfirm"
        onConfirm={() => {}}
        onCancel={() => {}}
        returnFocus={returnFocus}
      />,
    )
    unmount()
    expect(returnFocus).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('every action is at least 44px tall', () => {
    renderSheet()
    for (const name of [i18n.t('departure.confirm'), i18n.t('common.cancel')]) {
      expect(screen.getByRole('button', { name }).className).toContain('min-h-[44px]')
    }
  })
})
