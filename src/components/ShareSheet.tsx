import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { makeShareToken } from '../lib/share-link'
import { shareLink } from '../lib/deep-link'
import { shareOrCopy, type ShareNavigator } from '../lib/share-out'
import { isCompleteBundle } from '../lib/signed-links'
import { useLiveRecord } from '../lib/use-records-version'
import { useModalFocus } from '../lib/use-modal-focus'
import PermitSafeguardNote from './PermitSafeguardNote'
import Button from './ui/Button'

interface Props {
  /** The driver's own record to share (never a shared copy). */
  session: ParkingSession
  onClose: () => void
  /** Where focus goes on close when the button that opened the sheet has gone. */
  returnFocus?: () => HTMLElement | null
  /**
   * The driver the link names instead of the record's `driver_name` (the
   * handover flow, item 5, can name the person the car was handed to).
   * Omit to use the record's.
   */
  driver?: string | null
  /** Test hook: the navigator the share goes through. */
  shareNavigator?: ShareNavigator
}

type Step =
  | { kind: 'confirm' }
  | { kind: 'busy' }
  | { kind: 'copied' }
  | { kind: 'manual'; url: string }
  | { kind: 'error'; key: 'share.notSigned' | 'share.tooLarge' }

/**
 * "Share where the car is" (build spec T7 item 2), from the record screen
 * and the home card's Share icon. Says what a link gives away before
 * anything is made, then hands the link to the system share sheet, or the
 * clipboard, or shows it to copy by hand. Modal (FeedbackModal pattern).
 *
 * The link carries the record's signed arrival, so it can only be made
 * once that is signed; the sheet follows the stored record, so it enables
 * itself when the signature lands.
 */
export default function ShareSheet({ session: initial, onClose, returnFocus, driver, shareNavigator }: Props) {
  const { t } = useTranslation()
  const session = useLiveRecord(initial)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [step, setStep] = useState<Step>({ kind: 'confirm' })
  useModalFocus(dialogRef, { initialFocus: titleRef, onEscape: onClose, returnFocus })

  const signed = isCompleteBundle(session.signature)

  const share = () => {
    if (step.kind === 'busy') return
    const built = makeShareToken(session, driver !== undefined ? { driver } : {})
    if (!built.ok) {
      setStep({ kind: 'error', key: built.error === 'unsigned' ? 'share.notSigned' : 'share.tooLarge' })
      return
    }
    const url = shareLink(built.token)
    setStep({ kind: 'busy' })
    // Straight from the tap: the share sheet needs its user activation.
    void shareOrCopy(url, t('share.shareText'), shareNavigator).then((result) => {
      if (result === 'shared') onClose()
      else if (result === 'cancelled') setStep({ kind: 'confirm' })
      else if (result === 'copied') setStep({ kind: 'copied' })
      else setStep({ kind: 'manual', url })
    })
  }

  const done = step.kind === 'copied' || step.kind === 'manual'

  return (
    <div
      ref={dialogRef}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && step.kind !== 'busy') onClose()
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/60 backdrop-blur-sm safe-p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-sheet-title"
      aria-describedby="share-sheet-confirm"
    >
      <div className="bg-white gf-card max-w-md w-full p-6 max-h-[min(90vh,100%)] overflow-y-auto">
        <h2
          id="share-sheet-title"
          ref={titleRef}
          tabIndex={-1}
          className="font-display text-2xl font-extrabold text-ink-900 outline-none"
        >
          {t('share.action')}
        </h2>
        <p id="share-sheet-confirm" className="text-sm text-ink-700 leading-relaxed mt-2">
          {t('share.confirm')}
        </p>
        <PermitSafeguardNote session={session} className="mt-4" />

        {!signed && step.kind !== 'error' && (
          <p role="status" className="mt-4 text-sm text-ink-700 bg-paper-100 rounded-xl px-3 py-2.5 leading-relaxed">
            {t('share.notSigned')}
          </p>
        )}
        {step.kind === 'error' && (
          <p role="alert" className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
            {t(step.key)}
          </p>
        )}
        {step.kind === 'copied' && (
          <p role="status" className="mt-4 text-sm text-brand-800 bg-brand-50 rounded-xl px-3 py-2.5 leading-relaxed">
            {t('share.copied')}
          </p>
        )}
        {step.kind === 'manual' && (
          <div className="mt-4">
            <label htmlFor="share-sheet-link" className="block text-xs uppercase tracking-widest font-semibold text-ink-600 mb-1">
              {t('share.linkFieldLabel')}
            </label>
            <p className="text-sm text-ink-700 leading-relaxed mb-2" role="status">
              {t('share.copyManually')}
            </p>
            <input
              id="share-sheet-link"
              type="text"
              readOnly
              value={step.url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full bg-paper-50 text-ink-900 border border-paper-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
          {done ? (
            <Button type="button" onClick={onClose} className="w-full min-h-[44px]">
              {t('common.done')}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={share}
              disabled={!signed || step.kind === 'busy'}
              className="w-full min-h-[44px] disabled:cursor-not-allowed"
            >
              {t('share.shareButton')}
            </Button>
          )}
          {!done && (
            <button
              type="button"
              onClick={onClose}
              disabled={step.kind === 'busy'}
              className="w-full min-h-[44px] text-sm font-medium text-ink-700 hover:text-ink-900 rounded-xl disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
