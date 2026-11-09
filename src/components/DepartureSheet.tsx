import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession, PhotoRef } from '../types'
import type { DepartureFixRequest } from '../lib/departure'
import { formatAccuracy } from '../lib/accuracy'
import { canTakeReturnPhotos, gridRoles } from '../lib/evidence-photos'
import { discardUnreferencedPhotos } from '../lib/record-photos'
import { endConfirmText } from '../lib/record-status'
import { sessionTimezone } from '../lib/timezone'
import { useModalFocus } from '../lib/use-modal-focus'
import { useNow } from '../lib/use-now'
import { usePhotoSlots } from '../lib/use-photo-slots'
import CollapsibleSection from './CollapsibleSection'
import Icon from './Icon'
import PhotoAngleGrid from './PhotoAngleGrid'
import Button from './ui/Button'

/** What "Confirm I've left" hands App besides the tap itself. */
export interface DepartureConfirmation {
  /**
   * The condition photos taken on the sheet (return-* roles): their refs
   * once their writes have settled. They go into the departure addendum.
   */
  returnPhotos: Promise<PhotoRef[]>
}

interface Props {
  /** The record the driver is ending. */
  session: ParkingSession
  /** The GPS fix App started when it opened the sheet. */
  fix: DepartureFixRequest
  /** The confirm text for an on-time tap on the screen the driver came from. */
  confirmKey: 'active.iveLeftConfirm' | 'session.endConfirm'
  /**
   * "Confirm I've left". App stamps ended_at with this tap's time and closes
   * the sheet at once; it keeps waiting for the fix (and any condition
   * photos still being stored) in the background.
   */
  onConfirm: (confirmation: DepartureConfirmation) => void
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
  // Photos taken on the sheet are kept (Confirm) or deleted (Cancel) once.
  const photosSettled = useRef(false)
  // "Record the car's condition now (optional)": collapsed until opened.
  // Photos are stored under the record as they are taken.
  const returnSlots = usePhotoSlots(session.id)
  const [conditionOpen, setConditionOpen] = useState(false)
  // Offered only when the photos can be signed into the record (its chain
  // can be extended on this device and has room for them). Decided when
  // the sheet opens, so the section doesn't vanish under the driver.
  const [offerCondition] = useState(() => canTakeReturnPhotos(session))

  // Cancel, Escape or a tap outside: nothing is recorded, and photos taken
  // on the sheet are deleted once their writes have landed.
  const cancel = () => {
    if (!photosSettled.current) {
      photosSettled.current = true
      returnSlots.close()
      void discardUnreferencedPhotos(session.id, returnSlots.captured())
    }
    onCancel()
  }
  // Focus starts on the title, so neither action fires on a stray Enter.
  useModalFocus(dialogRef, { initialFocus: titleRef, onEscape: cancel, returnFocus })

  const confirm = () => {
    if (confirmed.current || photosSettled.current) return
    confirmed.current = true
    photosSettled.current = true
    returnSlots.close()
    // ended_at is this tap (App stamps it now). The photos follow once stored.
    const captured = returnSlots.captured()
    const returnPhotos = returnSlots.settle(gridRoles('return'))
    // Photos retaken on the sheet are dropped; the kept ones go into the record.
    void returnPhotos.then((refs) =>
      discardUnreferencedPhotos(
        session.id,
        captured,
        refs.map((r) => r.sha256),
      ),
    )
    onConfirm({ returnPhotos })
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
        if (e.target === e.currentTarget) cancel()
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/60 backdrop-blur-sm safe-p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="departure-title"
      aria-describedby="departure-body"
    >
      <div className="bg-white gf-card max-w-md w-full p-6 max-h-[min(90vh,100%)] overflow-y-auto">
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
        {offerCondition && (
          <CollapsibleSection
            className="mt-4"
            tone="paper"
            title={t('departure.condition.toggle')}
            open={conditionOpen}
            onToggle={() => setConditionOpen((o) => !o)}
            badge={returnSlots.savedCount > 0 ? t('photoGrid.count', { count: returnSlots.savedCount }) : null}
          >
            <PhotoAngleGrid phase="return" slots={returnSlots} />
          </CollapsibleSection>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <Button type="button" onClick={confirm} className="w-full min-h-[44px]">
            {t('departure.confirm')}
          </Button>
          <button
            type="button"
            onClick={cancel}
            className="w-full min-h-[44px] text-sm font-medium text-ink-700 hover:text-ink-900 rounded-xl"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
