import { useMemo, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import type { DepartureFixRequest } from '../lib/departure'
import { formatAccuracy } from '../lib/accuracy'
import { endConfirmText } from '../lib/record-status'
import { sessionTimezone } from '../lib/timezone'
import { useModalFocus } from '../lib/use-modal-focus'
import { useNow } from '../lib/use-now'
import Icon from './Icon'
import Button from './ui/Button'

interface Props {
  /** The record the driver is ending. */
  session: ParkingSession
  /** The GPS fix App started when it opened the sheet. */
  fix: DepartureFixRequest
  /** The confirm text for an on-time tap on the screen the driver came from. */
  confirmKey: 'active.iveLeftConfirm' | 'session.endConfirm'
  /**
   * "Confirm I've left". App stamps ended_at with this tap's time and closes
   * the sheet at once; it keeps waiting for the fix in the background.
   */
  onConfirm: () => void
  /** Cancel, Escape or a tap outside: nothing is recorded. */
  onCancel: () => void
  /**
   * Where focus goes when the sheet closes and the "I've left" button that
   * opened it is gone (Confirm ended the record, so the button went too).
   */
  returnFocus?: () => HTMLElement | null
}

/**
 * The departure sheet (T1a), opened by "I've left" on the home card and the
 * record screen in place of the old browser confirm. It says what will be
 * stored (the tap time, from the phone's clock; a late tap names that
 * time), shows one location status line while the GPS fix comes in, and
 * offers "Confirm I've left" and "Cancel". Modal: focus stays inside,
 * Escape and a tap outside cancel.
 */
export default function DepartureSheet({ session, fix, confirmKey, onConfirm, onCancel, returnFocus }: Props) {
  const { t } = useTranslation()
  const state = useSyncExternalStore(fix.subscribe, fix.current, fix.current)
  // The late confirm names the tap time to the minute; tick so it follows the clock.
  const now = useNow(1_000)
  const timeZone = useMemo(() => sessionTimezone(session.location), [session.location])
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  // A second tap before the sheet goes away mustn't confirm twice.
  const confirmed = useRef(false)
  // Focus starts on the title, so neither action fires on a stray Enter.
  useModalFocus(dialogRef, { initialFocus: titleRef, onEscape: onCancel, returnFocus })

  const confirm = () => {
    if (confirmed.current) return
    confirmed.current = true
    onConfirm()
  }

  const status =
    state.status === 'pending'
      ? { text: t('departure.locating'), tone: 'pending' as const }
      : state.status === 'ok'
        ? { text: t('departure.located', { accuracy: formatAccuracy(state.fix.accuracy_meters) }), tone: 'ok' as const }
        : { text: t('departure.noLocation'), tone: 'none' as const }

  return (
    <div
      ref={dialogRef}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="departure-title"
      aria-describedby="departure-body"
    >
      <div className="bg-white gf-card max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        <h2
          id="departure-title"
          ref={titleRef}
          tabIndex={-1}
          className="font-display text-2xl font-extrabold text-ink-900 outline-none"
        >
          {t('active.iveLeft')}
        </h2>
        <p id="departure-body" className="text-sm text-ink-700 leading-relaxed mt-2">
          {endConfirmText(session, t, timeZone, confirmKey, now)}
        </p>
        <p
          role="status"
          aria-live="polite"
          className={`mt-4 flex items-center gap-2 text-sm font-semibold ${
            status.tone === 'ok' ? 'text-brand-700' : 'text-ink-600'
          }`}
        >
          {status.tone === 'pending' ? (
            <span aria-hidden className="relative flex w-4 h-4 items-center justify-center shrink-0">
              <span className="absolute inline-flex h-3 w-3 rounded-full bg-brand-500 opacity-60 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
            </span>
          ) : (
            <Icon name="pin" className="w-4 h-4 shrink-0" strokeWidth={2.25} />
          )}
          <span>{status.text}</span>
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Button type="button" onClick={confirm} className="w-full min-h-[44px]">
            {t('departure.confirm')}
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
