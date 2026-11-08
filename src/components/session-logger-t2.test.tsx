// @vitest-environment happy-dom
//
// SessionLogger, T2 (build spec items 1 to 4): the fixed section order, the
// collapsed "Record the car's condition (optional)" section with its
// camera-only angle grid and the damage note, and the proof of payment or
// permit section (one button with the type preselected from the gate, the
// type picker only after a photo, payment confirmations from the library,
// collapsed when no gate applies). What is saved reaches the record and,
// through buildArrivalContext, the signed arrival_context.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../lib/i18n'
import { createMemoryPhotoBackend, putPhoto, setPhotoBackendForTests } from '../lib/photo-store'
import { PHOTO_WRITE_TIMEOUT_MS } from '../lib/session-photos'
import { hashDataUrlImage } from '../lib/hash'
import { buildArrivalContext, emptyLogDraft } from '../lib/evidence-chain'
import type { LogDraft, ParkingRules, ParkingSession } from '../types'
import SessionLogger from './SessionLogger'

vi.mock('../lib/image', () => ({
  resizeImageFile: async (file: File) => {
    // A file named unreadable-* can't be decoded, like a corrupt image.
    if (file.name.startsWith('unreadable')) throw new Error('could not decode')
    return { dataUrl: 'data:image/jpeg;base64,' + btoa(await file.text()), mediaType: 'image/jpeg' }
  },
}))
vi.mock('../lib/geocode', () => ({ reverseGeocode: async () => null, forwardGeocode: async () => null }))

const RULES: ParkingRules = {
  rules: '2P Ticket Mon-Fri 8am-6pm',
  observations: [],
  can_park_now: true,
  until: '2026-11-08T03:00:00.000Z',
  duration_minutes: 120,
  confidence: 'high',
  clarification: null,
}
const SIGN = 'data:image/jpeg;base64,' + btoa('scan-sign')
const jpeg = (text: string) => 'data:image/jpeg;base64,' + btoa(text)

let memory: ReturnType<typeof createMemoryPhotoBackend>

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  memory = createMemoryPhotoBackend()
  setPhotoBackendForTests(memory)
  Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn() }, configurable: true })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  cleanup()
  // Let photo writes started by this test land before the next test's backend is set.
  await new Promise((r) => setTimeout(r, 20))
  setPhotoBackendForTests(null)
})

function renderLogger(props: Partial<Parameters<typeof SessionLogger>[0]> = {}) {
  const onComplete = vi.fn<(s: ParkingSession) => void>()
  const onCancel = vi.fn()
  const utils = render(
    <SessionLogger
      rules={RULES}
      signPhoto={SIGN}
      signPhotoMeta={{ captured_at: '2026-11-08T00:58:00.000Z', source: 'camera_input' }}
      onComplete={onComplete}
      onCancel={onCancel}
      {...props}
    />,
  )
  return { ...utils, onComplete, onCancel }
}

function draftWith(acks: Partial<LogDraft['gate_acks']>): LogDraft {
  const d = emptyLogDraft()
  return { ...d, gate_acks: { ...d.gate_acks, ...acks } }
}

function file(text: string, lastModified = Date.now()) {
  return new File([text], `${text}.jpg`, { type: 'image/jpeg', lastModified })
}

function pickInto(container: HTMLElement, role: string, text: string, lastModified?: number) {
  const input = container.querySelector<HTMLInputElement>(`input[data-role="${role}"]`)
  if (!input) throw new Error(`no input for ${role}`)
  fireEvent.change(input, { target: { files: [file(text, lastModified)] } })
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.saveSession') }))
  })
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The toggle's name starts with its title; a closed one with photos adds the count. */
const conditionToggle = () =>
  screen.getByRole('button', { name: new RegExp('^' + escapeRe(i18n.t('logger.condition.toggle'))) })

describe('section order', () => {
  it('location, car photo, condition, proof, then Save; nothing before Save blocks it', async () => {
    const { container, onComplete } = renderLogger()
    const order = [
      screen.getByText(i18n.t('logger.location')),
      screen.getByText(i18n.t('logger.carAtSpot')),
      conditionToggle(),
      screen.getByRole('button', { name: i18n.t('logger.proof.toggle') }),
      screen.getByRole('button', { name: i18n.t('logger.saveSession') }),
    ]
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // Both optional sections start collapsed: no grid or proof inputs yet.
    expect(container.querySelector('input[data-role^="condition-"]')).toBeNull()
    expect(container.querySelector('input[data-role="compliance"]')).toBeNull()
    expect(conditionToggle().getAttribute('aria-expanded')).toBe('false')
    // Save works with nothing optional filled in.
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
  })
})

describe('the condition section', () => {
  it('opens a camera-only grid: every tile input captures from the camera, and there is no library input', () => {
    const { container } = renderLogger()
    fireEvent.click(conditionToggle())
    expect(conditionToggle().getAttribute('aria-expanded')).toBe('true')
    const inputs = [...container.querySelectorAll<HTMLInputElement>('input[data-role^="condition-"]')]
    expect(inputs.map((i) => i.dataset.role)).toEqual([
      'condition-front',
      'condition-rear',
      'condition-left',
      'condition-right',
      'condition-detail',
    ])
    for (const input of inputs) expect(input.getAttribute('capture')).toBe('environment')
    for (const name of ['Front', 'Rear', 'Left side', 'Right side', 'Close-up (optional)']) {
      expect(screen.getByRole('button', { name: `Take a photo: ${name}` })).toBeTruthy()
    }
    // The car photo above may come from the library; the condition grid may not.
    const section = conditionToggle().closest('section')!
    expect(within(section).queryByText(i18n.t('scanner.fromLibrary'))).toBeNull()
    expect(section.querySelectorAll('input[type="file"]:not([capture])')).toHaveLength(0)
    expect(within(section).getByText(i18n.t('photoGrid.signedNote'))).toBeTruthy()
  })

  it('stores each photo on capture and saves the refs and the damage note into the record and its arrival_context', async () => {
    const { container, onComplete } = renderLogger()
    fireEvent.click(conditionToggle())
    pickInto(container, 'condition-rear', 'rear-bumper')
    // An old file through the camera input (a desktop file picker) counts as a library photo.
    pickInto(container, 'condition-front', 'front-old', Date.now() - 10 * 60_000)
    await waitFor(() => expect(memory.records.size).toBe(3)) // sign + two condition photos
    await waitFor(() => expect(screen.getAllByText(i18n.t('photoGrid.saved'))).toHaveLength(2))
    fireEvent.change(screen.getByLabelText(i18n.t('logger.condition.noteLabel')), {
      target: { value: 'Scratch on the\nrear bumper' },
    })
    // Collapsing keeps the photos, and the toggle says how many.
    fireEvent.click(conditionToggle())
    expect(within(conditionToggle()).getByText('2 photos')).toBeTruthy()

    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = onComplete.mock.calls[0][0]
    const condition = saved.photos!.filter((p) => p.role.startsWith('condition-'))
    expect(condition.map((p) => [p.role, p.source])).toEqual([
      ['condition-front', 'library'],
      ['condition-rear', 'camera_input'],
    ])
    expect(condition[1].sha256).toBe(await hashDataUrlImage(jpeg('rear-bumper')))
    expect(saved.condition_note).toBe('Scratch on the rear bumper')
    const ctx = buildArrivalContext(saved, emptyLogDraft())
    expect(ctx.photos.map((p) => p.role)).toEqual(['sign', 'condition-front', 'condition-rear'])
    expect(ctx.condition_note).toBe('Scratch on the rear bumper')
  })

  it('a retaken tile keeps only the new photo; the replaced bytes are tidied after Save', async () => {
    const { container, onComplete } = renderLogger()
    fireEvent.click(conditionToggle())
    pickInto(container, 'condition-left', 'left-one')
    await screen.findByRole('button', { name: 'Retake: Left side' })
    pickInto(container, 'condition-left', 'left-two')
    await waitFor(() => expect(memory.records.size).toBe(3))
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = onComplete.mock.calls[0][0]
    expect(saved.photos!.filter((p) => p.role === 'condition-left').map((p) => p.sha256)).toEqual([
      await hashDataUrlImage(jpeg('left-two')),
    ])
    await waitFor(() => expect(memory.records.size).toBe(2))
  })

  it('Cancel deletes the condition photos with the rest', async () => {
    const { container, onCancel } = renderLogger()
    fireEvent.click(conditionToggle())
    pickInto(container, 'condition-front', 'cancel-me')
    await waitFor(() => expect(memory.records.size).toBe(2))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.cancel') }))
    expect(onCancel).toHaveBeenCalled()
    await waitFor(() => expect(memory.records.size).toBe(0))
  })
})

describe('proof of payment or permit', () => {
  it('with no gate it is collapsed; opened, it offers the one button and the library link', () => {
    renderLogger()
    expect(screen.queryByRole('button', { name: i18n.t('logger.proof.addMeterTicketOrPermit') })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.proof.toggle') }))
    expect(screen.getByRole('button', { name: 'Add a photo of your ticket or permit (optional)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: i18n.t('proof.fromLibrary') })).toBeTruthy()
  })

  it('a gate opens it with one button; the type picker appears only after the photo, preselected from the gate', async () => {
    const draft = draftWith({ meter_ticket: true })
    const { container, onComplete } = renderLogger({ draft })
    expect(screen.queryByRole('button', { name: i18n.t('logger.proof.toggle') })).toBeNull()
    expect(screen.getByText(i18n.t('logger.proof.heading'))).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add a photo of your ticket or permit (optional)' })).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()

    pickInto(container, 'compliance', 'ticket-on-dash')
    await screen.findByText(i18n.t('photoGrid.saved'))
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.value)).toEqual(['meter_ticket', 'payment_confirmation', 'permit_displayed', 'other'])
    expect(radios.find((r) => r.checked)?.value).toBe('meter_ticket')

    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = onComplete.mock.calls[0][0]
    expect(saved.compliance_type).toBe('meter_ticket')
    expect(saved.gate_acks).toEqual({ meter_ticket: true, permit_zone: null, accessible_permit: null })
    expect(saved.photos!.find((p) => p.role === 'compliance')!.sha256).toBe(await hashDataUrlImage(jpeg('ticket-on-dash')))
    const ctx = buildArrivalContext(saved, emptyLogDraft())
    expect(ctx.compliance_type).toBe('meter_ticket')
    expect(ctx.gate_acks).toEqual({ meter_ticket: true, permit_zone: null, accessible_permit: null })
    expect(ctx.photos.map((p) => p.role)).toContain('compliance')
  })

  it('a permit gate preselects "Permit displayed", and the driver can change it', async () => {
    const { container, onComplete } = renderLogger({ rules: { ...RULES, is_permit_zone: true } })
    pickInto(container, 'compliance', 'permit')
    await screen.findByText(i18n.t('photoGrid.saved'))
    expect((screen.getByRole('radio', { name: i18n.t('complianceType.permitDisplayed') }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: i18n.t('complianceType.other') }))
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(onComplete.mock.calls[0][0].compliance_type).toBe('other')
  })

  it('a payment confirmation may come from the library, and is then always a payment confirmation', async () => {
    const { container, onComplete } = renderLogger({ draft: draftWith({ meter_ticket: true }) })
    pickInto(container, 'compliance-library', 'paystay-screenshot')
    await screen.findByText(i18n.t('photoGrid.saved'))
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => [r.value, r.checked])).toEqual([['payment_confirmation', true]])
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = onComplete.mock.calls[0][0]
    expect(saved.compliance_type).toBe('payment_confirmation')
    expect(saved.photos!.find((p) => p.role === 'compliance')!.source).toBe('library')
  })

  it('a library file that cannot be read leaves the type the gate preselected', async () => {
    const { container, onComplete } = renderLogger({ draft: draftWith({ meter_ticket: true }) })
    pickInto(container, 'compliance-library', 'unreadable-screenshot')
    expect(await screen.findByText(i18n.t('scanner.couldntReadPhoto'))).toBeTruthy()
    // Now a camera photo of the ticket: still a meter ticket, as the gate said.
    pickInto(container, 'compliance', 'ticket-after-all')
    await screen.findByText(i18n.t('photoGrid.saved'))
    expect((screen.getByRole('radio', { name: i18n.t('complianceType.meterTicket') }) as HTMLInputElement).checked).toBe(true)
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(onComplete.mock.calls[0][0].compliance_type).toBe('meter_ticket')
  })

  it('an old file handed to the camera input is a library photo: only a payment confirmation', async () => {
    const { container, onComplete } = renderLogger({ draft: draftWith({ meter_ticket: true }) })
    // Desktop browsers and Android's Files option hand the camera input any file; this one is a day old.
    pickInto(container, 'compliance', 'old-gallery-photo', Date.now() - 24 * 3600_000)
    await screen.findByText(i18n.t('photoGrid.saved'))
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => [r.value, r.checked])).toEqual([['payment_confirmation', true]])
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = onComplete.mock.calls[0][0]
    expect(saved.photos!.find((p) => p.role === 'compliance')!.source).toBe('library')
    expect(saved.compliance_type).toBe('payment_confirmation')
  })

  it('without a proof photo, nothing about proof is saved; the gate acknowledgements still are', async () => {
    const { onComplete } = renderLogger({ draft: draftWith({ permit_zone: true }) })
    await save()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    const saved = onComplete.mock.calls[0][0]
    expect(saved.compliance_type).toBeUndefined()
    expect(saved.photos!.map((p) => p.role)).toEqual(['sign'])
    expect(saved.gate_acks).toEqual({ meter_ticket: null, permit_zone: true, accessible_permit: null })
  })
})

describe('after Save, the logger tidies only its own photos', () => {
  it('a stalled logger write that lands late never deletes a photo another screen added to the saved record', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const realAdd = memory.add.bind(memory)
    let stall = true
    memory.add = async (r) => {
      if (stall) {
        stall = false
        await gate // the first write (the scan's sign photo) sticks
      }
      return realAdd(r)
    }
    try {
      const { onComplete } = renderLogger()
      fireEvent.click(screen.getByRole('button', { name: i18n.t('logger.saveSession') }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PHOTO_WRITE_TIMEOUT_MS)
      })
      await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1))
      const recordId = onComplete.mock.calls[0][0].id
      // The record screen's add sheet stores a condition photo for the saved record.
      const added = await putPhoto(recordId, jpeg('condition photo added after saving'))
      // The stalled sign photo write lands; the logger's tidy runs now.
      release()
      const lateSign = `${recordId}/${await hashDataUrlImage(SIGN)}`
      await vi.waitFor(() => expect(memory.records.has(lateSign)).toBe(false))
      expect([...memory.records.keys()]).toEqual([`${recordId}/${added}`])
    } finally {
      memory.add = realAdd
      vi.useRealTimers()
    }
  })
})
