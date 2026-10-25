// @vitest-environment happy-dom
//
// SessionLogger and the photo store (T0b2, spec N4): the record id is minted
// when the logger opens, the scan's sign photo is stored then, every photo
// is written on capture, a PhotoRef exists only after its write completed,
// a failed write shows an error on the tile, cancelling deletes the
// record's photos, and the saved record keeps the legacy fields null.
// Once Save has started, Cancel and Back can't take the photos away; a
// stuck write can't hang Save; and without a working photo store the car
// photo is kept in the record itself.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { createMemoryPhotoBackend, setPhotoBackendForTests, type PhotoBackend } from '../lib/photo-store'
import { PHOTO_WRITE_TIMEOUT_MS } from '../lib/session-photos'
import { hashDataUrlImage } from '../lib/hash'
import type { ParkingRules, ParkingSession } from '../types'
import SessionLogger from './SessionLogger'

// The resize step needs a canvas; the stand-in turns a file's text into a data URL.
vi.mock('../lib/image', () => ({
  resizeImageFile: async (file: File) => ({
    dataUrl: 'data:image/jpeg;base64,' + btoa(await file.text()),
    mediaType: 'image/jpeg',
  }),
}))
vi.mock('../lib/geocode', () => ({ reverseGeocode: async () => null, forwardGeocode: async () => null }))

const RULES: ParkingRules = {
  rules: '2P Mon-Fri 8am-6pm',
  observations: [],
  can_park_now: true,
  until: '2026-10-20T03:00:00.000Z',
  duration_minutes: 120,
  confidence: 'high',
  clarification: null,
}
const SIGN = 'data:image/jpeg;base64,' + btoa('scan-sign-bytes')
const SIGN_META = { captured_at: '2026-10-20T00:58:30.000Z', source: 'camera_input' as const }

let memory: ReturnType<typeof createMemoryPhotoBackend>
let failAdds = 0
const backend: PhotoBackend = {
  add: (r) => (failAdds-- > 0 ? Promise.reject(new Error('disk full')) : memory.add(r)),
  get: (k) => memory.get(k),
  listMeta: () => memory.listMeta(),
  delete: (k) => memory.delete(k),
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  memory = createMemoryPhotoBackend()
  failAdds = 0
  setPhotoBackendForTests(backend)
  // GPS never answers in these tests: the logger stays "acquiring".
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition: vi.fn() },
    configurable: true,
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  setPhotoBackendForTests(null)
  vi.useRealTimers()
})

function renderLogger(props: Partial<Parameters<typeof SessionLogger>[0]> = {}) {
  const onComplete = vi.fn<(s: ParkingSession) => void>()
  const onCancel = vi.fn()
  const utils = render(
    <SessionLogger
      rules={RULES}
      signPhoto={SIGN}
      signPhotoMeta={SIGN_META}
      onComplete={onComplete}
      onCancel={onCancel}
      {...props}
    />,
  )
  return { ...utils, onComplete, onCancel }
}

const keys = () => [...memory.records.keys()]

function pick(container: HTMLElement, which: 'camera' | 'library', text: string, lastModified = Date.now()) {
  const inputs = [...container.querySelectorAll<HTMLInputElement>('input[type="file"]')]
  const input = inputs.find((i) => (which === 'camera' ? i.hasAttribute('capture') : !i.hasAttribute('capture')))!
  const file = new File([text], `${text}.jpg`, { type: 'image/jpeg', lastModified })
  fireEvent.change(input, { target: { files: [file] } })
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.saveSession') }))
  })
}

describe('SessionLogger and the photo store', () => {
  it('stores the scan\'s sign photo on open under the minted id, and saves a record that refers to it', async () => {
    const { onComplete } = renderLogger()
    await waitFor(() => expect(keys()).toHaveLength(1))
    const [key] = keys()
    const [recordId, sha] = key.split('/')
    expect(sha).toBe(await hashDataUrlImage(SIGN))

    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
    const saved = onComplete.mock.calls[0][0]
    expect(saved.id).toBe(recordId)
    expect(saved.sign_photo).toBeNull()
    expect(saved.car_photo).toBeNull()
    expect(saved.photos).toEqual([{ role: 'sign', sha256: sha, ...SIGN_META }])
    expect(saved.rules).toBe(RULES.rules)
    // The photo the record refers to stays.
    await new Promise((r) => setTimeout(r, 0))
    expect(keys()).toEqual([key])
  })

  it('a car photo is written on capture; its ref records camera or library', async () => {
    const { container, onComplete } = renderLogger()
    pick(container, 'camera', 'car-from-camera')
    await waitFor(() => expect(keys()).toHaveLength(2))
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = onComplete.mock.calls[0][0]
    const car = saved.photos!.find((p) => p.role === 'car')!
    expect(car.source).toBe('camera_input')
    expect(car.sha256).toBe(await hashDataUrlImage('data:image/jpeg;base64,' + btoa('car-from-camera')))
    expect(saved.car_photo).toBeNull()
  })

  it('a camera-input file older than 2 minutes, or the library button, counts as library', async () => {
    const first = renderLogger()
    pick(first.container, 'camera', 'old-file', Date.now() - 10 * 60_000)
    await waitFor(() => expect(keys()).toHaveLength(2))
    await save()
    await waitFor(() => expect(first.onComplete).toHaveBeenCalled())
    expect(first.onComplete.mock.calls[0][0].photos!.find((p) => p.role === 'car')!.source).toBe('library')
    cleanup()

    const second = renderLogger()
    pick(second.container, 'library', 'from-library')
    await waitFor(() => expect(keys().length).toBeGreaterThanOrEqual(4))
    await save()
    await waitFor(() => expect(second.onComplete).toHaveBeenCalled())
    expect(second.onComplete.mock.calls[0][0].photos!.find((p) => p.role === 'car')!.source).toBe('library')
  })

  it('a failed car photo write shows the error on the tile and makes no ref; Retry stores it', async () => {
    const { container, onComplete } = renderLogger()
    await waitFor(() => expect(keys()).toHaveLength(1)) // the sign photo
    failAdds = 1
    pick(container, 'camera', 'car-fails-once')
    expect(await screen.findByText(i18n.t('logger.photoSaveFailed'))).toBeTruthy()
    expect(keys()).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.retry') }))
    await waitFor(() => expect(keys()).toHaveLength(2))
    await waitFor(() => expect(screen.queryByText(i18n.t('logger.photoSaveFailed'))).toBeNull())
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(onComplete.mock.calls[0][0].photos!.map((p) => p.role)).toEqual(['sign', 'car'])
  })

  it('saving with a failed car photo saves the record without it', async () => {
    const { container, onComplete } = renderLogger()
    await waitFor(() => expect(keys()).toHaveLength(1))
    failAdds = 1
    pick(container, 'camera', 'car-fails')
    await screen.findByText(i18n.t('logger.photoSaveFailed'))
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = onComplete.mock.calls[0][0]
    expect(saved.photos!.map((p) => p.role)).toEqual(['sign'])
    expect(saved.car_photo).toBeNull()
  })

  it('a replaced car photo is tidied away after the save; the kept ones stay', async () => {
    const { container, onComplete } = renderLogger()
    pick(container, 'camera', 'car-one')
    await waitFor(() => expect(keys()).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.carRetake') }))
    pick(container, 'camera', 'car-two')
    await waitFor(() => expect(keys()).toHaveLength(3))
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = onComplete.mock.calls[0][0]
    const kept = saved.photos!.map((p) => `${saved.id}/${p.sha256}`).sort()
    await waitFor(() => expect(keys().sort()).toEqual(kept))
    expect(saved.photos!.find((p) => p.role === 'car')!.sha256).toBe(
      await hashDataUrlImage('data:image/jpeg;base64,' + btoa('car-two')),
    )
  })

  it('Cancel deletes every photo of the unsaved record (after writes in flight land)', async () => {
    const { container, onCancel } = renderLogger()
    pick(container, 'library', 'car-then-cancel')
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(keys()).toEqual([]))
  })

  it('Cancel waits for a car photo write in flight, then deletes it too', async () => {
    const { container, onCancel } = renderLogger()
    await waitFor(() => expect(keys()).toHaveLength(1))
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const realAdd = backend.add
    backend.add = async (r) => {
      await gate
      return memory.add(r)
    }
    try {
      pick(container, 'camera', 'car-in-flight')
      await screen.findByRole('button', { name: i18n.t('logger.carRetake') }) // tile is up, write pending
      fireEvent.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
      expect(onCancel).toHaveBeenCalledTimes(1)
      release()
      await waitFor(() => expect(keys()).toEqual([]))
    } finally {
      backend.add = realAdd
    }
  })

  it('the back button cancels the same way', async () => {
    const { onCancel } = renderLogger()
    await waitFor(() => expect(keys()).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.back') }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(keys()).toEqual([]))
  })

  it('when the store cannot take the scan\'s sign photo, the record keeps it in the legacy field', async () => {
    failAdds = 1
    const { onComplete } = renderLogger()
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = onComplete.mock.calls[0][0]
    expect(saved.sign_photo).toBe(SIGN)
    expect(saved.photos).toEqual([])
  })

  it('without capture metadata the sign photo claims only "library"', async () => {
    const { onComplete } = renderLogger({ signPhotoMeta: null })
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(onComplete.mock.calls[0][0].photos![0]).toMatchObject({ role: 'sign', source: 'library' })
  })

  it('a no-sign record stores the surroundings photo as role "ambient"', async () => {
    const ambient = 'data:image/jpeg;base64,' + btoa('surroundings')
    const meta = { captured_at: '2026-10-20T00:59:00.000Z', source: 'camera_input' as const }
    const { onComplete } = renderLogger({ mode: 'no-sign', rules: null, signPhoto: null, ambientPhoto: ambient, ambientPhotoMeta: meta })
    await waitFor(() => expect(keys()).toHaveLength(1))
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = onComplete.mock.calls[0][0]
    expect(saved.no_sign).toBe(true)
    expect(saved.ambient_photo).toBeNull()
    expect(saved.sign_photo).toBeNull()
    expect(saved.photos).toEqual([{ role: 'ambient', sha256: await hashDataUrlImage(ambient), ...meta }])
  })

  it('Cancel or Back while Save waits for a write does nothing: the saved record keeps its photos', async () => {
    const { container, onComplete, onCancel } = renderLogger()
    await waitFor(() => expect(keys()).toHaveLength(1)) // the sign photo
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const realAdd = backend.add
    backend.add = async (r) => {
      await gate
      return memory.add(r)
    }
    try {
      pick(container, 'camera', 'car-saving')
      await screen.findByRole('button', { name: i18n.t('logger.carRetake') }) // write pending
      fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.saveSession') }))
      // Save is waiting for the car write: the label says so, and the way out is closed.
      const cancelButton = screen.getByRole('button', { name: i18n.t('common.cancel') })
      const backButton = screen.getByRole('button', { name: i18n.t('common.back') })
      expect(screen.getByRole('button', { name: i18n.t('logger.saving') })).toBeTruthy()
      expect((cancelButton as HTMLButtonElement).disabled).toBe(true)
      expect((backButton as HTMLButtonElement).disabled).toBe(true)
      // Even a click that gets through (a disabled button ignores it) changes nothing.
      fireEvent.click(cancelButton)
      fireEvent.click(backButton)
      release()
      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
      expect(onCancel).not.toHaveBeenCalled()
      const saved = onComplete.mock.calls[0][0]
      expect(saved.photos!.map((p) => p.role)).toEqual(['sign', 'car'])
      await new Promise((r) => setTimeout(r, 0))
      expect(keys().sort()).toEqual(saved.photos!.map((p) => `${saved.id}/${p.sha256}`).sort())
    } finally {
      backend.add = realAdd
    }
  })

  it('a stuck photo write cannot hang Save: it counts as failed after the timeout, and its late bytes are tidied', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const realAdd = backend.add
    backend.add = async (r) => {
      await gate
      return memory.add(r)
    }
    try {
      const { onComplete } = renderLogger() // the sign photo write sticks
      fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.saveSession') }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PHOTO_WRITE_TIMEOUT_MS)
      })
      await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
      const saved = onComplete.mock.calls[0][0]
      // The sign photo stays with the record, in the legacy field.
      expect(saved.sign_photo).toBe(SIGN)
      expect(saved.photos).toEqual([])
      // The stuck write lands later: nothing refers to those bytes, so they go.
      release()
      await vi.waitFor(() => expect(keys()).toEqual([]))
    } finally {
      backend.add = realAdd
    }
  })

  it('without a working photo store the car photo is kept in the record itself, with no error on the tile', async () => {
    setPhotoBackendForTests(null) // this test DOM has no IndexedDB
    const { container, onComplete } = renderLogger()
    pick(container, 'camera', 'car-no-idb')
    await screen.findByRole('button', { name: i18n.t('logger.carRetake') })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(i18n.t('logger.photoSaveFailed'))).toBeNull()
    expect(screen.queryByRole('button', { name: i18n.t('common.retry') })).toBeNull()
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = onComplete.mock.calls[0][0]
    expect(saved.car_photo).toBe('data:image/jpeg;base64,' + btoa('car-no-idb'))
    expect(saved.sign_photo).toBe(SIGN)
    expect(saved.photos).toEqual([])
  })

  it('a double tap on Save saves once', async () => {
    const { onComplete } = renderLogger()
    const button = screen.getByRole('button', { name: i18n.t('logger.saveSession') })
    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})
