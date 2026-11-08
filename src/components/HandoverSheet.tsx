import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { HANDOVER_NAME_MAX, currentDriver, queueHandover } from '../lib/handover'
import { fitText } from '../lib/evidence-chain'
import { isStorageFullError } from '../lib/storage'
import { useLiveRecord } from '../lib/use-records-version'
import { useModalFocus } from '../lib/use-modal-focus'
import PermitSafeguardNote from './PermitSafeguardNote'
import Button from './ui/Button'
import Input from './ui/Input'

interface Props {
  /** The driver's own record, not ended (the record screen offers this only then). */
  session: ParkingSession
  /** After the handover was queued: the record screen mirrors the record to the cloud when signed in. */
  onAdded: (sessionId: string) => void
  /** "Share where the car is" after the handover: the record screen swaps this sheet for its share sheet. */
  onShare: () => void
  /** Closes the sheet (Cancel, Done, Escape or a tap outside). */
  onClose: () => void
  /** Where focus goes on close when the button that opened the sheet has gone. */
  returnFocus?: () => HTMLElement | null
}

/**
 * "Hand the car over" on the record screen of an active record (build spec
 * T7 item 5). Asks for the next driver's name, queues a signed `handover`
 * part (lambda/addendum-schema.js), then offers the share link. The record
 * stays active. When the park used an accessible parking permit, says the
 * permit stays with its holder (item 6). Modal (FeedbackModal pattern).
 */
export default function HandoverSheet({ session: initial, onAdded, onShare, onClose, returnFocus }: Props) {
  const { t } = useTranslation()
  const session = useLiveRecord(initial)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const doneRef = useRef<HTMLParagraphElement>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  // The handover once it is queued (who to, and who from as stored): the
  // sheet then says what the record now says and offers the share link.
  const [handedTo, setHandedTo] = useState<{ to: string; from: string | null } | null>(null)
  // Who the record will say handed the car over: the driver it names now
  // (handoverData signs the same). Shown before the tap, so nothing is
  // signed as the driver's statement without them seeing it.
  const fromDriver = fitText(currentDriver(session), HANDOVER_NAME_MAX)
  // Set while a handover is being added and after it was: one tap adds one part.
  const adding = useRef(false)
  useModalFocus(dialogRef, { initialFocus: titleRef, onEscape: onClose, returnFocus })

  // The form is replaced by the outcome: move focus there, so it isn't lost
  // with the button that was tapped, and the outcome is read out.
  useEffect(() => {
    if (handedTo) doneRef.current?.focus()
  }, [handedTo])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (adding.current) return
    const to = fitText(name, HANDOVER_NAME_MAX)
    if (!to) {
      setError(t('handover.nameRequired'))
      return
    }
    adding.current = true
    setError(null)
    let added: ReturnType<typeof queueHandover> = null
    try {
      added = queueHandover(session.id, to)
    } catch (err) {
      console.warn('[handover] could not add the handover:', err)
      if (isStorageFullError(err)) {
        // Nothing was stored, so another try is safe.
        setError(t('errors.storageFull'))
        adding.current = false
        return
      }
    }
    if (!added) {
      setError(t('handover.failed'))
      adding.current = false
      return
    }
    onAdded(session.id)
    const from = added.data.from_driver
    setHandedTo({ to, from: typeof from === 'string' && from.length > 0 ? from : null })
  }

  const errorId = 'handover-sheet-error'
  const fromId = 'handover-sheet-from'

  return (
    <div
      ref={dialogRef}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/60 backdrop-blur-sm safe-p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="handover-sheet-title"
      aria-describedby="handover-sheet-intro"
    >
      <div className="bg-white gf-card max-w-md w-full p-6 max-h-[min(90vh,100%)] overflow-y-auto">
        <h2
          id="handover-sheet-title"
          ref={titleRef}
          tabIndex={-1}
          className="font-display text-2xl font-extrabold text-ink-900 outline-none"
        >
          {t('handover.action')}
        </h2>
        <p id="handover-sheet-intro" className="text-sm text-ink-700 leading-relaxed mt-2">
          {t('handover.intro')}
        </p>
        <PermitSafeguardNote session={session} className="mt-4" />

        {handedTo ? (
          <>
            <p
              ref={doneRef}
              tabIndex={-1}
              role="status"
              className="mt-4 text-sm text-brand-800 bg-brand-50 rounded-xl px-3 py-2.5 leading-relaxed outline-none"
            >
              {handedTo.from
                ? t('handover.doneFromTo', { from_driver: handedTo.from, to_driver: handedTo.to })
                : t('handover.done', { to_driver: handedTo.to })}
            </p>
            <p className="mt-3 text-sm text-ink-700 leading-relaxed">{t('handover.offerShare')}</p>
            <div className="mt-6 flex flex-col gap-2">
              <Button type="button" onClick={onShare} aria-haspopup="dialog" className="w-full min-h-[44px]">
                {t('share.action')}
              </Button>
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[44px] text-sm font-medium text-ink-700 hover:text-ink-900 rounded-xl"
              >
                {t('common.done')}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="mt-4">
            {fromDriver && (
              <p id={fromId} className="mb-3 text-sm text-ink-700 leading-relaxed">
                {t('handover.fromDriver', { from_driver: fromDriver })}
              </p>
            )}
            <label
              htmlFor="handover-sheet-name"
              className="block text-xs uppercase tracking-widest font-semibold text-ink-600 mb-1"
            >
              {t('handover.nameLabel')}
            </label>
            <Input
              id="handover-sheet-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value.slice(0, HANDOVER_NAME_MAX))
                if (error) setError(null)
              }}
              maxLength={HANDOVER_NAME_MAX}
              autoComplete="off"
              placeholder={t('logger.driver.placeholder')}
              aria-invalid={error ? true : undefined}
              aria-describedby={[fromDriver ? fromId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined}
            />
            {error && (
              <p id={errorId} role="alert" className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-col gap-2">
              <Button type="submit" className="w-full min-h-[44px]">
                {t('handover.submit')}
              </Button>
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[44px] text-sm font-medium text-ink-700 hover:text-ink-900 rounded-xl"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
