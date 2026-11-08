// @vitest-environment happy-dom
//
// LoadingProgress takes a `stages` prop (build spec T8 item 4: the notice
// view's reading screen). Custom stages advance on their own timings, the
// counter counts real steps only (a "still working" overflow stage isn't a
// step), the hint line can be swapped, and the scan screen's default
// stages are unchanged.
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import LoadingProgress from './LoadingProgress'
import { NOTICE_READING_STAGES } from '../lib/notice-read'

// The stage line is an <h2> with role="status" (a live region).
const heading = () => document.querySelector('h2')?.textContent
const counter = () => screen.getByText(/^Step \d+ of \d+$/).textContent

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('LoadingProgress', () => {
  it('without stages: the sign scan\'s steps and hint, as before', () => {
    render(<LoadingProgress />)
    expect(heading()).toBe('Reading the sign…')
    expect(counter()).toBe('Step 1 of 5')
    expect(screen.getByText('Usually takes about 10 seconds.')).toBeTruthy()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(heading()).toBe('Identifying parking rules…')
    expect(counter()).toBe('Step 2 of 5')
    act(() => {
      vi.advanceTimersByTime(22000)
    })
    // The "still working" fallback isn't a sixth step.
    expect(counter()).toBe('Step 5 of 5')
  })

  it('with the notice stages: their labels, their timings, three steps, and their hint', () => {
    render(<LoadingProgress stages={NOTICE_READING_STAGES} hintKey="notice.reading.hint" />)
    expect(heading()).toBe('Reading the notice…')
    expect(counter()).toBe('Step 1 of 3')
    expect(screen.getByText('Usually takes a few seconds.')).toBeTruthy()
    expect(screen.queryByText('Usually takes about 10 seconds.')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(2999)
    })
    expect(heading()).toBe('Reading the notice…')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(heading()).toBe('Finding the date, time and place…')
    expect(counter()).toBe('Step 2 of 3')
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(heading()).toBe('Looking for your records…')
    expect(counter()).toBe('Step 3 of 3')
    act(() => {
      vi.advanceTimersByTime(8000)
    })
    expect(heading()).toBe('Still reading. This can take a little longer…')
    expect(counter()).toBe('Step 3 of 3')
  })

  it('the scan\'s long-wait stages go through t() like every other stage', async () => {
    await act(async () => {
      await i18n.changeLanguage('it')
    })
    try {
      render(<LoadingProgress />)
      act(() => {
        vi.advanceTimersByTime(15000)
      })
      expect(heading()).toBe(i18n.t('loading.almostThere'))
      expect(heading()).toBe('Ci siamo quasi. Questo cartello è complesso…')
      act(() => {
        vi.advanceTimersByTime(7000)
      })
      expect(heading()).toBe('Ancora al lavoro. Ci vuole più del solito…')
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en')
      })
    }
  })

  it('renders a <main> by default, and a <div> when it sits inside another view', () => {
    const { container, unmount } = render(<LoadingProgress />)
    expect(container.querySelector('main')).not.toBeNull()
    unmount()
    const nested = render(<LoadingProgress as="div" stages={NOTICE_READING_STAGES} hintKey="notice.reading.hint" />)
    expect(nested.container.querySelector('main')).toBeNull()
    expect(heading()).toBe('Reading the notice…')
  })

  it('translates the step counter', async () => {
    await act(async () => {
      await i18n.changeLanguage('it')
    })
    try {
      render(<LoadingProgress stages={NOTICE_READING_STAGES} hintKey="notice.reading.hint" />)
      expect(screen.getByText('Passo 1 di 3')).toBeTruthy()
      expect(heading()).toBe('Lettura del verbale…')
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en')
      })
    }
  })
})
