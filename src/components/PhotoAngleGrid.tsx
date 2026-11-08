import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { PhotoRole } from '../types'
import { ANGLES, ANGLE_KEYS, angleRole, type Angle, type GridPhase } from '../lib/evidence-photos'
import type { PhotoSlot, PhotoSlots } from '../lib/use-photo-slots'
import Icon from './Icon'

interface Props {
  /** 'condition' at parking and after saving, 'return' on the departure sheet. */
  phase: GridPhase
  /** The screen's photo slots for this record (usePhotoSlots). */
  slots: PhotoSlots
  /** True once the screen is saving or closing: no new photos. */
  disabled?: boolean
}

/**
 * The car's condition, one photo per side (front, rear, left, right) and an
 * optional close-up (build spec T2, item 1). Camera only: each tile opens
 * the camera input (`capture="environment"`) and there is no library
 * button. Desktop browsers ignore `capture` and open a file picker, so a
 * file older than two minutes is recorded as a library photo (N1). Each
 * photo is resized, stored on the phone and only then gets its PhotoRef;
 * until then its tile says it is saving, and a failed write shows an error
 * with a retry.
 */
export default function PhotoAngleGrid({ phase, slots, disabled = false }: Props) {
  const { t } = useTranslation()
  const inputs = useRef(new Map<PhotoRole, HTMLInputElement | null>())

  const open = (role: PhotoRole) => {
    if (disabled) return
    inputs.current.get(role)?.click()
  }

  return (
    <div>
      <p className="text-xs text-ink-700 leading-relaxed mb-3">{t('photoGrid.hint')}</p>
      <ul className="grid grid-cols-2 gap-3">
        {ANGLES.map((angle) => {
          const role = angleRole(phase, angle)
          return (
            <li key={role} className={angle === 'detail' ? 'col-span-2' : undefined}>
              <Tile
                angle={angle}
                slot={slots.slots[role]}
                readError={slots.readError === role}
                disabled={disabled}
                onOpen={() => open(role)}
                onRetry={() => slots.retry(role)}
              />
              <input
                ref={(el) => {
                  inputs.current.set(role, el)
                }}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                data-role={role}
                aria-label={t('photoGrid.take', { angle: t(ANGLE_KEYS[angle]) })}
                tabIndex={-1}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void slots.capture(role, f, 'camera')
                  e.target.value = ''
                }}
              />
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-ink-600 mt-3 leading-relaxed">{t('photoGrid.signedNote')}</p>
    </div>
  )
}

function Tile({
  angle,
  slot,
  readError,
  disabled,
  onOpen,
  onRetry,
}: {
  angle: Angle
  slot: PhotoSlot | undefined
  readError: boolean
  disabled: boolean
  onOpen: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const label = t(ANGLE_KEYS[angle])
  if (!slot) {
    return (
      <>
        <button
          type="button"
          onClick={onOpen}
          disabled={disabled}
          aria-label={t('photoGrid.take', { angle: label })}
          className="w-full min-h-[88px] border-2 border-dashed border-brand-300 hover:border-brand-500 hover:bg-brand-50/50 bg-white rounded-lg py-3 px-2 flex flex-col items-center justify-center gap-1 text-brand-600 transition-colors disabled:opacity-60"
        >
          <Icon name="camera" className="w-7 h-7" />
          <span className="text-xs font-semibold text-ink-900 text-center leading-tight">{label}</span>
        </button>
        {readError && (
          <p role="alert" className="mt-1 text-2xs text-red-700 leading-snug">
            {t('scanner.couldntReadPhoto')}
          </p>
        )}
      </>
    )
  }
  return (
    <div className="rounded-lg border border-paper-300 bg-white overflow-hidden">
      <img src={slot.dataUrl} alt={label} className="w-full h-24 object-cover bg-paper-100" />
      <div className="px-2 py-1.5">
        <p className="text-xs font-semibold text-ink-900 leading-tight">{label}</p>
        <div role="status" aria-live="polite" className="text-2xs leading-snug mt-0.5">
          {slot.status === 'saving' && <span className="text-ink-600">{t('photoGrid.saving')}</span>}
          {slot.status === 'saved' && (
            <span className="inline-flex items-center gap-1 text-brand-700 font-medium">
              <Icon name="check" className="w-3 h-3" strokeWidth={2.5} />
              {t('photoGrid.saved')}
            </span>
          )}
        </div>
        {slot.status === 'failed' && (
          <div role="alert" className="mt-1">
            <p className="text-2xs text-ink-900 leading-snug">{t('photoGrid.failed')}</p>
            <button
              type="button"
              onClick={onRetry}
              disabled={disabled}
              className="min-h-[44px] inline-flex items-center text-xs font-semibold text-brand-700 hover:text-brand-800 underline"
            >
              {t('common.retry')}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onOpen}
          disabled={disabled || slot.status === 'saving'}
          aria-label={t('photoGrid.retake', { angle: label })}
          className="min-h-[44px] inline-flex items-center text-xs font-semibold text-brand-700 hover:text-brand-800 underline disabled:opacity-50"
        >
          {t('logger.carRetake')}
        </button>
      </div>
    </div>
  )
}
