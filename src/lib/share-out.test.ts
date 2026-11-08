// Handing a share link to the phone (build spec T7 item 2): the system
// share sheet first, the clipboard when there is none or it fails, and the
// link on screen when neither works. A dismissed share sheet is the
// driver's choice: nothing else is tried.
import { describe, expect, it, vi } from 'vitest'
import { shareOrCopy, type ShareNavigator } from './share-out'

const URL_ = 'https://www.parkproof.com.au/app/#share=1.abc'

const abort = () => Object.assign(new Error('cancelled'), { name: 'AbortError' })

describe('shareOrCopy', () => {
  it('uses the Web Share API with the link and the text, and nothing else', async () => {
    const share = vi.fn(async () => {})
    const writeText = vi.fn(async () => {})
    expect(await shareOrCopy(URL_, 'Where the car is', { share, clipboard: { writeText } })).toBe('shared')
    expect(share).toHaveBeenCalledWith({ text: 'Where the car is', url: URL_ })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('calls share synchronously, inside the tap', () => {
    const share = vi.fn(async () => {})
    void shareOrCopy(URL_, 't', { share })
    // No await yet: the share sheet was already asked for.
    expect(share).toHaveBeenCalledTimes(1)
  })

  it('stops when the driver dismisses the share sheet', async () => {
    const writeText = vi.fn(async () => {})
    const nav: ShareNavigator = { share: vi.fn(async () => Promise.reject(abort())), clipboard: { writeText } }
    expect(await shareOrCopy(URL_, 't', nav)).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to the clipboard with the bare link when there is no share sheet, or it fails', async () => {
    const writeText = vi.fn(async () => {})
    expect(await shareOrCopy(URL_, 't', { clipboard: { writeText } })).toBe('copied')
    expect(writeText).toHaveBeenLastCalledWith(URL_)
    const failing: ShareNavigator = {
      share: vi.fn(async () => Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' }))),
      clipboard: { writeText },
    }
    expect(await shareOrCopy(URL_, 't', failing)).toBe('copied')
    // canShare saying no skips the sheet.
    const refused: ShareNavigator = { share: vi.fn(async () => {}), canShare: () => false, clipboard: { writeText } }
    expect(await shareOrCopy(URL_, 't', refused)).toBe('copied')
    expect(refused.share).not.toHaveBeenCalled()
  })

  it('leaves the link on screen when neither works', async () => {
    expect(await shareOrCopy(URL_, 't', {})).toBe('manual')
    const nav: ShareNavigator = { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } }
    expect(await shareOrCopy(URL_, 't', nav)).toBe('manual')
  })
})
