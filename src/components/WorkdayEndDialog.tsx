import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalFocus } from '../lib/use-modal-focus'
import Button from './ui/Button'

interface Props {
  onConfirm: () => void
  onCancel: () => void
  /** Where focus goes when the dialog closes and the button that opened it is gone. */
  returnFocus?: () => HTMLElement | null
}

/**
 * "End this workday?" (build spec T6b item 10), asked when the driver ends
 * a workday between moves, where there is no stop left to depart from.
 * With the car still at a stop, App opens the departure sheet instead (the
 * departure flow for that stop runs first), which asks on its own. Modal,
 * as FeedbackModal: focus stays inside, Escape and a tap outside cancel.
 */
export default function WorkdayEndDialog({ onConfirm, onCancel, returnFocus }: Props) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const done = useRef(false)
  useModalFocus(dialogRef, { initialFocus: titleRef, onEscape: onCancel, returnFocus })

  const confirm = () => {
    if (done.current) return
    done.current = true
    onConfirm()
  }

  return (
    <div
      ref={dialogRef}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/60 backdrop-blur-sm safe-p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workday-end-title"
      aria-describedby="workday-end-body"
    >
      <div className="bg-white gf-card max-w-md w-full p-6">
        <h2
          id="workday-end-title"
          ref={titleRef}
          tabIndex={-1}
          className="font-display text-2xl font-extrabold text-ink-900 outline-none"
        >
          {t('workday.end.title')}
        </h2>
        <p id="workday-end-body" className="text-sm text-ink-700 leading-relaxed mt-2">
          {t('workday.end.body')}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button type="button" onClick={confirm} className="w-full min-h-[44px]">
            {t('workday.card.end')}
          </Button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full min-h-[44px] text-sm font-medium text-ink-700 hover:text-ink-900 rounded-xl"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
