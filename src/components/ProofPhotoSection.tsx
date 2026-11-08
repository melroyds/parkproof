import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ComplianceType } from '../types'
import { COMPLIANCE_TYPE_KEYS, complianceTypesFor, proofInputOf } from '../lib/evidence-photos'
import type { PhotoSlots } from '../lib/use-photo-slots'
import Icon from './Icon'

interface Props {
  /** The screen's photo slots; this section uses the 'compliance' role. */
  slots: PhotoSlots
  /** What the photo shows, or null until the driver picks (or a gate preselected it). */
  type: ComplianceType | null
  onTypeChange: (type: ComplianceType) => void
  /** The camera button's text. */
  addLabel: string
  disabled?: boolean
}

/**
 * Proof of payment or permit (build spec T2, item 4): one button that opens
 * the camera for a photo of the meter ticket or permit on the dash. A
 * payment confirmation (a parking app's screen) may come from the photo
 * library, through the small link under it, and is then always a payment
 * confirmation. So is a photo the camera input recorded as a library photo
 * (N1: an old file, handed over by a desktop browser or a Files picker).
 * The type picker appears only once there is a photo; its type may already
 * be preselected from the result screen's gate, and it changes to payment
 * confirmation only once a library photo has actually been stored.
 */
export default function ProofPhotoSection({ slots, type, onTypeChange, addLabel, disabled = false }: Props) {
  const { t } = useTranslation()
  const legendId = useId()
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const slot = slots.slots.compliance
  const options = slot ? complianceTypesFor(proofInputOf(slot.input, slot.meta.source)) : []

  const pick = (file: File, input: 'camera' | 'library') => {
    void slots.capture('compliance', file, input).then((meta) => {
      // A library photo can only be a payment confirmation. Set once the
      // photo is being stored, so a file that couldn't be read leaves the
      // type the gate preselected alone.
      if (meta && proofInputOf(input, meta.source) === 'library') onTypeChange('payment_confirmation')
    })
  }

  return (
    <div>
      {!slot ? (
        <>
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            disabled={disabled}
            className="w-full min-h-[48px] bg-white border-2 border-dashed border-brand-300 hover:border-brand-500 hover:bg-brand-50/50 rounded-lg px-4 py-3 flex items-center justify-center gap-2 text-sm font-semibold text-ink-900 transition-colors disabled:opacity-60"
          >
            <Icon name="camera" className="w-5 h-5 text-brand-600 shrink-0" />
            <span className="text-left leading-snug">{addLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => libraryRef.current?.click()}
            disabled={disabled}
            className="mt-1 min-h-[44px] w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium text-brand-700 hover:text-brand-800 underline disabled:opacity-60"
          >
            <Icon name="gallery" className="w-4 h-4 shrink-0" />
            {t('proof.fromLibrary')}
          </button>
          {slots.readError === 'compliance' && (
            <p role="alert" className="mt-1 text-xs text-red-700 leading-snug">
              {t('scanner.couldntReadPhoto')}
            </p>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-paper-300 bg-white overflow-hidden">
          <img
            src={slot.dataUrl}
            alt={t('chain.photoRole.compliance')}
            className="w-full max-h-48 object-contain bg-paper-100"
          />
          <div className="px-3 py-2">
            <div role="status" aria-live="polite" className="text-xs">
              {slot.status === 'saving' && <span className="text-ink-600">{t('photoGrid.saving')}</span>}
              {slot.status === 'saved' && (
                <span className="inline-flex items-center gap-1 text-brand-700 font-medium">
                  <Icon name="check" className="w-3.5 h-3.5" strokeWidth={2.5} />
                  {t('photoGrid.saved')}
                </span>
              )}
            </div>
            {slot.status === 'failed' && (
              <div role="alert" className="mt-1">
                <p className="text-xs text-ink-900 leading-snug">{t('photoGrid.failed')}</p>
                <button
                  type="button"
                  onClick={() => slots.retry('compliance')}
                  disabled={disabled}
                  className="min-h-[44px] inline-flex items-center text-xs font-semibold text-brand-700 hover:text-brand-800 underline"
                >
                  {t('common.retry')}
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => (slot.input === 'library' ? libraryRef : cameraRef).current?.click()}
              disabled={disabled || slot.status === 'saving'}
              className="min-h-[44px] inline-flex items-center text-xs font-semibold text-brand-700 hover:text-brand-800 underline disabled:opacity-50"
            >
              {t('logger.carRetake')}
            </button>
          </div>
          <fieldset className="px-3 pb-3" aria-labelledby={legendId} disabled={disabled}>
            <legend id={legendId} className="text-xs uppercase tracking-widest font-semibold text-ink-600 mb-1">
              {t('proof.typeLegend')}
            </legend>
            {options.map((option) => (
              <label
                key={option}
                className="flex items-center gap-3 min-h-[44px] text-sm text-ink-900 cursor-pointer"
              >
                <input
                  type="radio"
                  name={`${legendId}-type`}
                  value={option}
                  checked={type === option}
                  onChange={() => onTypeChange(option)}
                  className="w-5 h-5 accent-brand-500 shrink-0"
                />
                {t(COMPLIANCE_TYPE_KEYS[option])}
              </label>
            ))}
          </fieldset>
        </div>
      )}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-role="compliance"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) pick(f, 'camera')
          e.target.value = ''
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-role="compliance-library"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) pick(f, 'library')
          e.target.value = ''
        }}
      />
    </div>
  )
}
