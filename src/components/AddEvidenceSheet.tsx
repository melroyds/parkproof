import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ComplianceType, ParkingSession } from '../types'
import {
  CONDITION_NOTE_MAX,
  allowedComplianceType,
  canAddEvidence,
  gridRoles,
  preselectedComplianceType,
  recordProofGates,
} from '../lib/evidence-photos'
import { addCompliancePhoto, addConditionPhotos, discardUnreferencedPhotos } from '../lib/record-photos'
import { getSession, isStorageFullError } from '../lib/storage'
import { useModalFocus } from '../lib/use-modal-focus'
import { usePhotoSlots } from '../lib/use-photo-slots'
import PhotoAngleGrid from './PhotoAngleGrid'
import ProofPhotoSection from './ProofPhotoSection'
import Button from './ui/Button'

export type AddEvidenceKind = 'condition' | 'compliance'

interface Props {
  /** The record (saved, not ended) the photos are added to. */
  session: ParkingSession
  kind: AddEvidenceKind
  /** After the part was queued: App mirrors the record to the cloud when signed in. */
  onAdded: (sessionId: string) => void
  /** Closes the sheet (after an add, Cancel, Escape or a tap outside). */
  onClose: () => void
}

/**
 * "Add condition photos" and "Add a photo of your ticket or permit" on a
 * record that hasn't ended (build spec T2, item 5). Each adds its own
 * signed part: a condition part (one to five photos and an optional note)
 * or a compliance part (one photo and what it shows). The photos are
 * stored on the phone as they are taken; Cancel deletes them. Modal
 * (FeedbackModal pattern).
 */
export default function AddEvidenceSheet({ session, kind, onAdded, onClose }: Props) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const slots = usePhotoSlots(session.id)
  const [note, setNote] = useState('')
  // Preselected only from a gate the result screen actually asked about:
  // never a type the driver didn't choose (a "can't park" record asks none,
  // unless the driver confirmed a saved permit there: its permit_context).
  const [type, setType] = useState<ComplianceType | null>(() => preselectedComplianceType(recordProofGates(session)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set once Add or Cancel has started: neither runs twice.
  const done = useRef(false)

  const cancel = () => {
    if (done.current) return
    done.current = true
    slots.close()
    void discardUnreferencedPhotos(session.id, slots.captured())
    onClose()
  }
  useModalFocus(dialogRef, { initialFocus: titleRef, onEscape: cancel })

  const ready =
    !slots.saving && slots.savedCount > 0 && (kind === 'condition' || type !== null)

  // Nothing was added: the photos stay, and the sheet takes photos again,
  // so Retake, Retry, Cancel (which deletes them) and another try all work.
  const failed = (message: string) => {
    setError(message)
    setBusy(false)
    slots.reopen()
    done.current = false
  }

  const add = async () => {
    if (done.current || !ready) return
    done.current = true
    slots.close()
    setBusy(true)
    setError(null)
    const captured = slots.captured()
    const refs = await slots.settle(kind === 'condition' ? gridRoles('condition') : ['compliance'])
    // The record may have changed while the sheet was open (ended in
    // another tab, or by a synced device): photos taken now aren't "when
    // parked" photos of an ended record.
    const fresh = getSession(session.id)
    if (!fresh || !canAddEvidence(fresh)) {
      failed(t('evidence.cantAddNow'))
      return
    }
    let added = false
    try {
      added =
        kind === 'condition'
          ? !!addConditionPhotos(session.id, 'parking', refs, note)
          : !!(type && refs[0] && addCompliancePhoto(session.id, allowedComplianceType(refs[0].source, type) ?? type, refs[0]))
    } catch (err) {
      console.warn('[evidence] could not add the photos:', err)
      if (isStorageFullError(err)) {
        // The part couldn't be stored, so nothing was queued: another try is safe.
        failed(t('errors.storageFull'))
        return
      }
    }
    if (!added) {
      failed(t('evidence.addFailed'))
      return
    }
    // Photos retaken on the sheet are dropped; the ones added stay.
    void discardUnreferencedPhotos(session.id, captured, refs.map((r) => r.sha256))
    onAdded(session.id)
    onClose()
  }

  const title = kind === 'condition' ? t('evidence.addCondition') : t('evidence.addMeterTicketOrPermit')

  return (
    <div
      ref={dialogRef}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) cancel()
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/60 backdrop-blur-sm safe-p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-evidence-title"
      aria-describedby="add-evidence-intro"
    >
      <div className="bg-white gf-card max-w-md w-full p-6 max-h-[min(90vh,100%)] overflow-y-auto">
        <h2
          id="add-evidence-title"
          ref={titleRef}
          tabIndex={-1}
          className="font-display text-2xl font-extrabold text-ink-900 outline-none"
        >
          {title}
        </h2>
        <p id="add-evidence-intro" className="text-sm text-ink-700 leading-relaxed mt-2 mb-4">
          {t('evidence.addIntro')}
        </p>
        {kind === 'condition' ? (
          <>
            <PhotoAngleGrid phase="condition" slots={slots} disabled={busy} />
            <label htmlFor="add-evidence-note" className="block text-xs uppercase tracking-widest font-semibold text-ink-600 mt-4 mb-1">
              {t('logger.condition.noteLabel')}
            </label>
            <textarea
              id="add-evidence-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, CONDITION_NOTE_MAX))}
              maxLength={CONDITION_NOTE_MAX}
              rows={2}
              disabled={busy}
              placeholder={t('logger.condition.notePlaceholder')}
              className="w-full text-sm text-ink-900 bg-paper-50 border border-paper-300 rounded-xl p-3 leading-relaxed focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 resize-y"
            />
            <p className="text-2xs text-ink-600 font-mono text-right">
              {note.length}/{CONDITION_NOTE_MAX}
            </p>
          </>
        ) : (
          <>
            <ProofPhotoSection
              slots={slots}
              type={type}
              onTypeChange={setType}
              addLabel={t('scanner.takePhoto')}
              disabled={busy}
            />
          </>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <Button type="button" onClick={() => void add()} disabled={!ready || busy} className="w-full min-h-[44px] disabled:cursor-not-allowed">
            {busy ? t('evidence.adding') : t('evidence.addToRecord')}
          </Button>
          {!ready && !busy && (
            <p className="text-xs text-ink-600 text-center leading-relaxed">
              {slots.savedCount === 0
                ? t('evidence.needPhoto')
                : slots.saving
                  ? t('photoGrid.saving')
                  : t('evidence.needType')}
            </p>
          )}
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="w-full min-h-[44px] text-sm font-medium text-ink-700 hover:text-ink-900 rounded-xl disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
