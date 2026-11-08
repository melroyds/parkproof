import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { isStorageFullError, updateSession } from '../lib/storage'
import { useLiveRecord } from '../lib/use-records-version'
import { canEndRecord, endedStatusTime } from '../lib/record-status'
import { DEV_KEY_ALIAS } from '../lib/evidence-chain'
import { LEGACY_PHOTO_ROLES, hasSessionPhoto, legacyPhotoValue, photoRefFor } from '../lib/session-photos'
import { useSessionPhoto } from '../lib/use-session-photo'
import { canAddEvidence, signedPhotoRef } from '../lib/evidence-photos'
import {
  collectEvidenceFile,
  hasEvidenceFile,
  hasPermitDetails,
  hasPermitPhoto,
  saveEvidenceFile,
} from '../lib/evidence-bundle'
import { arrivalSigningRejection } from '../lib/signing'
import ScheduledRemindersSection from './ScheduledRemindersSection'
import RecordPhoto from './RecordPhoto'
import EvidencePhotos, { PhotoRefMeta } from './EvidencePhotos'
import AddEvidenceSheet, { type AddEvidenceKind } from './AddEvidenceSheet'
import VerifiedSeal from './VerifiedSeal'
import ChainPanel from './ChainPanel'
import DepartureRow from './DepartureRow'
import Icon from './Icon'
import Button from './ui/Button'
import BackButton from './ui/BackButton'
import Card from './ui/Card'
import { useNow } from '../lib/use-now'
import { formatCountdownLocalized } from '../lib/countdown'
import { sessionTimezone } from '../lib/timezone'
import { navigationUrl } from '../lib/walk-back'
import { useAuth } from '../lib/use-auth'
import { mirrorSessionToCloud, mirrorSessionUpdateToCloud } from '../lib/sync'
import { verifyUrlForLocale } from '../lib/verify-url'
import { signedTimeOf } from '../lib/chain-view'
import { formatInZone } from '../lib/time-format'
import { RECORD_STATUS_ID } from '../lib/focus-targets'

const NOTE_MAX_LENGTH = 280

interface Props {
  /**
   * The record to show. The screen re-reads it from storage on every
   * records change, so this is only the starting copy.
   */
  session: ParkingSession
  onBack: () => void
  /**
   * Called when the driver confirms Delete. App.handleDeleteRecord owns the
   * whole delete path (the record, its photos, the cloud copy, push and
   * in-tab reminders) and leaves this screen; this screen only asks.
   */
  onDelete: (session: ParkingSession) => void
  onDraftAppeal: () => void
  /**
   * Called when the driver taps "I've left". App opens the departure sheet
   * and, on "Confirm I've left", runs the one end path (stamp ended_at,
   * cloud mirror, push and in-tab cancels, the signed departure); this
   * screen only asks. The record stays in history with ended_at set.
   */
  onEndSession: (session: ParkingSession) => void
  /**
   * Told when one of this screen's own sheets (the add-photo sheets) opens
   * or closes, and that none is open when the screen goes. App holds the
   * one-time backup prompt back meanwhile: one dialog at a time.
   */
  onSheetOpenChange?: (open: boolean) => void
}

function fmtLocal(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function SessionDetail({
  session: initialSession,
  onBack,
  onDelete,
  onDraftAppeal,
  onEndSession,
  onSheetOpenChange,
}: Props) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const now = useNow()
  // Live copy: background signing, a cloud pull or the end-session path
  // update storage, and this re-reads it, so the screen never goes stale.
  const session = useLiveRecord(initialSession)
  // The surroundings photo's caption describes the photo, so it shows only
  // when the photo itself does (not under the "not on this device" line).
  const ambientPhoto = useSessionPhoto(session, 'ambient')
  const expiresMs = session.expires_at ? new Date(session.expires_at).getTime() : null
  const isExpired = expiresMs !== null && expiresMs < now
  const isEnded = !!session.ended_at
  // Localized so the "X min left" / "Xh Ym left" label translates with
  // the rest of the detail-view UI. Previously the English-only
  // formatCountdown left the word "left" untranslated.
  const countdown =
    expiresMs !== null && !isExpired && !isEnded
      ? formatCountdownLocalized(expiresMs - now, t)
      : null
  // "I've left" is offered on any record that hasn't been ended, including
  // one past its expiry (the driver may come back late).
  const canEnd = canEndRecord(session)
  // After saving, on a record that hasn't ended: "Add condition photos" and
  // "Add a photo of your ticket or permit", each its own signed part.
  const canAdd = canAddEvidence(session)
  const [addSheet, setAddSheet] = useState<AddEvidenceKind | null>(null)
  const sheetOpenChange = useRef(onSheetOpenChange)
  useEffect(() => {
    sheetOpenChange.current = onSheetOpenChange
  })
  useEffect(() => {
    sheetOpenChange.current?.(addSheet !== null)
  }, [addSheet])
  useEffect(() => () => sheetOpenChange.current?.(false), [])
  const timeZone = useMemo(() => sessionTimezone(session.location), [session.location])
  // "Ended 5:23 pm AEDT" on the status line (the I've left tap time).
  const endedTime = isEnded ? endedStatusTime(session, timeZone) : null
  // Locale-aware link to the plain-English /verify walkthrough — surfaced at
  // the point the user exports evidence, the moment they most want to know how
  // a council actually verifies the tamper-proof claim.
  const verifyHref = verifyUrlForLocale(i18n.language)
  // #3 — a silent photo-sync failure flagged on the session. The cloud row
  // exists but an image didn't reach S3, so it's missing cross-device and in
  // the PDF. Offer a retry (signed-in only — the only state a mirror runs in).
  // Read from the live record, so a flag set after save shows up here too.
  const photoSyncFailed = !!session.photo_sync_failed
  const [retryingPhoto, setRetryingPhoto] = useState(false)
  // #9 — an older record pulled from the cloud shows its legacy photos from
  // HTTPS URLs. Since T0b4 the list mints a fresh URL only for a photo that
  // is in S3, so such a photo normally loads and embeds. The warning shows
  // only after one actually failed: its <img> didn't load, or the last
  // export couldn't fetch it. Keyed by URL, so a fresh URL from the next
  // sync clears it. A role with a photo ref is never read from a URL.
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<ReadonlySet<string>>(() => new Set())
  const noteFailedPhotoUrls = (urls: readonly string[]) => {
    if (urls.length === 0) return
    setFailedPhotoUrls((prev) => (urls.every((u) => prev.has(u)) ? prev : new Set([...prev, ...urls])))
  }
  const hasRemotePhoto = LEGACY_PHOTO_ROLES.some((role) => {
    if (photoRefFor(session, role)) return false
    const value = legacyPhotoValue(session, role)
    return !!value && /^https?:/i.test(value) && failedPhotoUrls.has(value)
  })

  // Pre-import the PDF chunk so the click → save chain stays inside the
  // user-gesture window (iOS Safari otherwise sometimes blocks the download
  // because the await import() breaks the gesture). We hold the module in a
  // ref and call it synchronously from the click handler.
  const pdfModuleRef = useRef<typeof import('../lib/pdf') | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Prefetch BOTH the PDF chunk AND the locale's Noto Sans font (if
    // needed). Both are no-ops for en/it/id where the built-in font
    // suffices. For zh-CN / ko / vi / el / hi / pa, this warms the font
    // cache so the click handler can register the font synchronously —
    // avoiding an await between the click and `doc.save()` that would
    // break Safari's user-gesture download policy.
    void Promise.all([
      import('../lib/pdf').then((mod) => {
        if (!cancelled) pdfModuleRef.current = mod
      }),
      import('../lib/pdf-fonts').then((mod) => mod.prefetchPdfFont(i18n.language)),
    ])
    return () => {
      cancelled = true
    }
    // i18n.language is stable per session; we deliberately don't re-fetch on
    // every language toggle (cold-cache UX hit on no benefit) — the cache
    // in pdf-fonts.ts dedupes anyway, so an extra fetch is harmless if the
    // user does change language mid-detail-view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleExportPdf = async () => {
    setPdfError(null)
    setPdfBusy(true)
    try {
      // If the chunk is already in the ref, run synchronously. Otherwise
      // fall back to a fresh dynamic import — slower on first click on a
      // cold cache, but at least it works. Same fallback for the font:
      // prefetch should have completed on mount, but if the user clicks
      // immediately we await it here as belt-and-braces. Acceptable to
      // break the Safari gesture in this rare cold-cache path; the
      // typical case stays inside the gesture window.
      const mod = pdfModuleRef.current ?? (await import('../lib/pdf'))
      const { prefetchPdfFont } = await import('../lib/pdf-fonts')
      await prefetchPdfFont(i18n.language)
      // Cross-device: cloud-synced photos arrive as HTTPS presigned URLs.
      // jsPDF's addImage only works with data URLs — materialize first.
      // No-op for same-device sessions (photos already data URLs).
      const sessionForPdf = await mod.materializeRemotePhotos(session)
      // A cloud URL still on a photo the PDF draws couldn't be fetched: it
      // draws as "could not be embedded", so say why under the button.
      noteFailedPhotoUrls(
        mod.pdfPhotoRoles(session, 'evidence').flatMap((role) => {
          const value = legacyPhotoValue(sessionForPdf, role)
          return value && /^https?:/i.test(value) ? [value] : []
        }),
      )
      mod.downloadPdf(sessionForPdf, t, i18n.language)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[pdf] export failed:', err)
      setPdfError(message)
    } finally {
      setPdfBusy(false)
    }
  }

  // The evidence file (T2 item 9): every signed payload and signature and
  // the original photos, for a third party to check. Permit details go in
  // only when the driver ticks "Include permit details" (N3); the tick
  // starts off on every visit.
  const canDownloadFile = hasEvidenceFile(session)
  // The tick shows when there is something it would add: permit details, or
  // a proof photo marked as a displayed permit.
  const permitDetails = hasPermitDetails(session) || hasPermitPhoto(session)
  const [includePermit, setIncludePermit] = useState(false)
  const [fileBusy, setFileBusy] = useState(false)
  const [fileError, setFileError] = useState(false)
  // After a download: signed photos whose bytes aren't on this device, and
  // ones whose bytes here don't hash to the signed fingerprint.
  const [fileMissingPhotos, setFileMissingPhotos] = useState(0)
  const [fileDifferingPhotos, setFileDifferingPhotos] = useState(0)

  const handleEvidenceFile = async () => {
    setFileError(false)
    setFileMissingPhotos(0)
    setFileDifferingPhotos(0)
    setFileBusy(true)
    try {
      const file = await collectEvidenceFile(session, {
        includePermit: includePermit && permitDetails,
        arrivalRejection: arrivalSigningRejection(session.id),
      })
      saveEvidenceFile(file)
      setFileMissingPhotos(file.photos.filter((p) => p.bytes === 'not_on_this_device').length)
      setFileDifferingPhotos(file.photos.filter((p) => p.bytes === 'differ_from_fingerprint').length)
    } catch (err) {
      console.error('[evidence-file] could not make the file:', err)
      setFileError(true)
    } finally {
      setFileBusy(false)
    }
  }

  const retryPhotoSync = async () => {
    setRetryingPhoto(true)
    try {
      const { photoFailed } = await mirrorSessionToCloud(session)
      if (!photoFailed) {
        // The write re-renders this screen through the records-changed event.
        updateSession(session.id, { photo_sync_failed: false })
      }
    } catch (err) {
      console.warn('[sync] photo re-upload failed:', err)
    } finally {
      setRetryingPhoto(false)
    }
  }

  const handleDelete = () => {
    if (!window.confirm(t('session.deleteConfirm'))) return
    // App owns deleting: the record and its photos, the cloud copy, push and
    // in-tab reminders. It also leaves this screen.
    onDelete(session)
  }

  const handleEnd = () => {
    // App owns ending: its departure sheet asks (naming the time a late tap
    // will store), then ended_at, cloud mirror, push and in-tab cancels and
    // the signed departure. We stay on this screen; the live record shows
    // "Ended ..." and the departure row once stored.
    onEndSession(session)
  }

  // Editable note — persists to localStorage on save. The committed value is
  // the live record's note; `noteDraft` is the in-progress textarea state.
  const currentNote = session.note ?? ''
  const [noteEditing, setNoteEditing] = useState(false)
  const [noteDraft, setNoteDraft] = useState(currentNote)
  const [noteError, setNoteError] = useState<string | null>(null)

  const startNoteEdit = () => {
    setNoteDraft(currentNote)
    setNoteError(null)
    setNoteEditing(true)
  }
  const cancelNoteEdit = () => {
    setNoteEditing(false)
    setNoteDraft(currentNote)
    setNoteError(null)
  }
  const saveNote = () => {
    const trimmed = noteDraft.trim()
    try {
      updateSession(session.id, { note: trimmed || undefined })
      setNoteEditing(false)
      setNoteError(null)
      // Mirror the patched session to the cloud — picks up the latest local
      // copy from storage so the cloud row matches what the user just saved.
      if (user) {
        mirrorSessionUpdateToCloud(session.id)
      }
    } catch (err) {
      // Quota error after recovery exhausted, or another storage failure.
      // Keep the user in edit mode so their text isn't lost.
      const message = isStorageFullError(err)
        ? t('errors.storageFull')
        : err instanceof Error
          ? err.message
          : String(err)
      setNoteError(message)
    }
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <BackButton onClick={onBack}>
        {t('common.backToHistory')}
      </BackButton>

      <h2 className="font-display text-3xl font-extrabold tracking-tight text-paper-50 mb-1">
        {t('session.header')}
      </h2>
      {/* Which record this is: the arrival day and time, in the record's own
          zone with its name (field-test fix list, item 6). Prominent, so two
          records from the same afternoon can't be mixed up. */}
      <p className="text-base font-semibold text-paper-50 mb-3 leading-snug tnum">
        {t('session.arrived', { when: formatInZone(session.arrived_at, timeZone, { withYear: true }) })}
      </p>

      {/* Register A — the signed-record vault panel. The cryptographic proof
          is the brand's hero moment, so it sits on vault green with a
          banknote guilloché texture, a glowing mint Verified Seal, paper
          text, and the signature hash in mono mint. */}
      {session.signature && (
        <div
          className="gf-card-lg mb-5 p-5"
          style={{
            background: '#073B25',
            backgroundImage:
              'repeating-linear-gradient(115deg, rgba(123,227,164,0.055) 0 1px, transparent 1px 8px)',
          }}
        >
          <div className="flex items-center gap-3.5">
            {/* A local `npm run dev` signature (key_alias 'dev-ephemeral')
                can't be checked with the published key, so it never gets
                the mint glow or the plain "signed" claim. */}
            <VerifiedSeal size={48} glow={session.signature.key_alias !== DEV_KEY_ALIAS} />
            <div className="min-w-0">
              <p className="text-sm font-display font-bold text-paper-50">
                {session.signature.key_alias === DEV_KEY_ALIAS
                  ? t('session.devKeySigned')
                  : t('session.cryptoSigned')}
              </p>
              <p className="text-2xs font-mono truncate text-[#7BE3A4]">
                {session.signature.signature_base64.slice(0, 16)}
                <span style={{ color: '#A9CFBE' }}>
                  {' · '}
                  {/* ParkProof's signing time from the signed payload, in the
                      record's zone with its name: the same as the chain
                      panel's arrival part below. */}
                  {formatInZone(signedTimeOf(session.signature) ?? session.signature.signed_at, timeZone)}
                </span>
              </p>
            </div>
          </div>
          {/* Plain-English meaning of the "Cryptographically signed" badge —
              what tamper-proof does and does NOT prove. On the vault panel it
              reads in muted sage. */}
          <p
            className="text-xs leading-relaxed mt-3"
            style={{ color: '#A9CFBE' }}
          >
            {t('about.sealCaveat')}
          </p>
        </div>
      )}

      {/* The evidence chain: each signed part, what it covers and when
          ParkProof signed it, with "Check signatures" (the on-device
          verifier). A read-only shared copy gets its own check (T7). */}
      {!session.shared_from && <ChainPanel session={session} timeZone={timeZone} />}

      {/* #3 — silent photo-sync failure made visible, with a retry. */}
      {photoSyncFailed && user && (
        <div className="mb-4 flex items-center justify-between gap-3 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2">
          <span className="text-xs text-amber-800 font-medium inline-flex items-center gap-1.5 min-w-0">
            <Icon name="warning" className="w-4 h-4 shrink-0" />
            <span>{t('session.photoSyncFailed')}</span>
          </span>
          <button
            onClick={retryPhotoSync}
            disabled={retryingPhoto}
            className="text-xs font-semibold text-brand-700 hover:text-brand-800 underline shrink-0 disabled:opacity-60 min-h-[44px] inline-flex items-center -my-1.5"
          >
            {t('session.photoSyncRetry')}
          </button>
        </div>
      )}

      <Card className="mb-3 rounded-2xl border-transparent shadow-[0_14px_40px_rgba(7,59,37,0.16),0_2px_6px_rgba(7,59,37,0.08)]">
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-widest font-semibold text-ink-600">
              {t('session.status')}
            </dt>
            <dd
              id={RECORD_STATUS_ID}
              tabIndex={-1}
              className={`mt-1 font-display font-bold outline-none ${
                isEnded || isExpired ? 'text-ink-600' : 'text-brand-700'
              }`}
            >
              {/* An ended record names its I've left tap time, so the line
                  says which record this is. The departure row below labels
                  that time as the phone's and adds ParkProof's signing time. */}
              {isEnded
                ? endedTime
                  ? t('session.endedAt', { when: endedTime })
                  : t('session.ended')
                : session.expires_at
                  ? isExpired
                    ? t('history.expired')
                    : t('session.active', {
                        when: fmtLocal(session.expires_at, timeZone),
                      })
                  : t('session.noExpiryRecorded')}
            </dd>
            {countdown && (
              <dd
                className={`text-xs mt-0.5 ${
                  countdown.urgency === 'urgent'
                    ? 'text-accent-700 font-bold'
                    : countdown.urgency === 'warning'
                      ? 'text-accent-600 font-semibold'
                      : 'text-brand-700'
                }`}
              >
                {countdown.label}
              </dd>
            )}
          </div>
          {/* The I've left tap (phone clock) and, separately, when ParkProof
              signed the departure. Shown once the record has ended. */}
          <DepartureRow session={session} timeZone={timeZone} now={now} />
          <div>
            <dt className="text-xs uppercase tracking-widest font-semibold text-ink-600">
              {t('session.signRules')}
            </dt>
            <dd className="mt-1 text-ink-900">
              {session.no_sign ? (
                <span className="italic text-ink-600">
                  {t('session.noSignBadgeLong')}
                </span>
              ) : (
                session.rules
              )}
            </dd>
          </div>
          {session.chosen_label && (
            <div>
              <dt className="text-xs uppercase tracking-widest font-semibold text-ink-600">
                {t('session.sideChosen')}
              </dt>
              <dd className="mt-1 text-ink-900">{session.chosen_label}</dd>
            </div>
          )}
          {session.location && (
            <div>
              <dt className="text-xs uppercase tracking-widest font-semibold text-ink-600">
                {t('session.locationLabel')}
              </dt>
              <dd className="mt-1">
                <a
                  className="text-brand-700 hover:text-brand-800 underline inline-flex items-center gap-1"
                  href={`https://www.google.com/maps?q=${session.location.lat},${session.location.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="pin" className="w-4 h-4" />
                  {session.location.address ?? t('session.viewOnMaps')}
                </a>
                <p className="text-xs text-ink-600 font-mono mt-0.5">
                  ({session.location.lat.toFixed(5)}, {session.location.lng.toFixed(5)})
                </p>
                {/* Walking-mode deep-link — separate from the "View on Maps"
                    pin above because they're different intents. The pin shows
                    "where is it"; this navigates you there. */}
                {(() => {
                  const mapsUrl = navigationUrl(session)
                  if (!mapsUrl) return null
                  return (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 bg-brand-50 hover:bg-brand-100 text-brand-800 border border-brand-200 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
                    >
                      <Icon name="pin" className="w-3.5 h-3.5" />
                      {t('session.walkBackPill')}
                      <span aria-hidden>→</span>
                    </a>
                  )
                })()}
              </dd>
            </div>
          )}
          {/* AI confidence is meaningless for no-sign sessions (the AI never
              looked at anything). Hide the row entirely rather than render
              a misleading "low" value. */}
          {!session.no_sign && (
            <div>
              <dt className="text-xs uppercase tracking-widest font-semibold text-ink-600">
                {t('session.aiConfidence')}
              </dt>
              <dd className="mt-1 text-ink-900 capitalize">{session.confidence}</dd>
            </div>
          )}
        </dl>
      </Card>

      {/* Note — user-supplied context. Soft-asks for it on empty so people
          remember to add the WHY rather than just the WHEN-and-WHERE. */}
      <Card className="mb-3 rounded-2xl border-transparent shadow-[0_14px_40px_rgba(7,59,37,0.16),0_2px_6px_rgba(7,59,37,0.08)]">
        <div className="flex items-baseline justify-between mb-2">
          <h3
            id="session-note-label"
            className="text-xs uppercase tracking-widest font-semibold text-ink-600"
          >
            {t('session.noteLabel')}
          </h3>
          {!noteEditing && (
            <button
              onClick={startNoteEdit}
              className="text-xs font-medium text-brand-700 hover:text-brand-800 underline min-h-[44px] inline-flex items-center -my-1.5"
            >
              {currentNote ? t('common.edit') : t('session.addNote')}
            </button>
          )}
        </div>
        {noteEditing ? (
          <div className="space-y-2">
            <textarea
              value={noteDraft}
              onChange={(e) =>
                setNoteDraft(e.target.value.slice(0, NOTE_MAX_LENGTH))
              }
              rows={3}
              autoFocus
              placeholder={t('session.notePlaceholder')}
              aria-labelledby="session-note-label"
              aria-invalid={noteError ? true : undefined}
              aria-describedby={noteError ? 'session-note-error' : undefined}
              className="w-full text-sm text-ink-900 bg-paper-50 border border-paper-300 rounded-xl p-3 leading-relaxed focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 resize-y"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-2xs text-ink-600 font-mono">
                {noteDraft.length}/{NOTE_MAX_LENGTH}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={cancelNoteEdit}
                  className="bg-paper-200 hover:bg-paper-300 text-ink-700 font-medium px-3 py-2.5 min-h-[44px] inline-flex items-center justify-center rounded-lg text-xs transition-colors"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={saveNote}
                  className="bg-brand-500 hover:bg-brand-600 text-white font-semibold px-3 py-2.5 min-h-[44px] inline-flex items-center justify-center rounded-lg text-xs transition-colors"
                >
                  {t('session.saveNote')}
                </button>
              </div>
            </div>
            {noteError && (
              <p
                id="session-note-error"
                role="alert"
                className="text-xs text-accent-700 break-words leading-relaxed"
              >
                {noteError}
              </p>
            )}
          </div>
        ) : currentNote ? (
          <p className="text-sm text-ink-900 whitespace-pre-wrap break-words leading-relaxed">
            {currentNote}
          </p>
        ) : (
          <p className="text-xs text-ink-600 italic leading-relaxed">
            {t('session.noNote')}{' '}
            <button
              onClick={startNoteEdit}
              className="underline font-medium text-brand-700 min-h-[44px] inline-flex items-center py-2.5 -my-2 -mx-1 align-middle"
            >
              {t('session.addNote')}
            </button>{' '}
            {t('session.noteHelp')}
          </p>
        )}
      </Card>

      {/* Scheduled push reminders — self-managing surface for "what
          notifications are queued for this session" with per-row × cancel,
          smart-filtered "+ Add reminder" chip picker, and "Cancel all".
          Self-hides for ended/expired-no-sign-eligible sessions. */}
      <ScheduledRemindersSection session={session} />

      {/* Sign photo — only rendered for sign-translated sessions. No-sign
          sessions drop straight to the ambient/car photos below. */}
      {/* Photos read through the photo store for new records (the legacy
          fields for old ones). A photo whose bytes aren't on this device
          shows the one "not on this device" line with its fingerprint. */}
      {hasSessionPhoto(session, 'sign') && (
        <Card className="mb-3 rounded-2xl border-transparent shadow-[0_14px_40px_rgba(7,59,37,0.16),0_2px_6px_rgba(7,59,37,0.08)]">
          <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-600 mb-2">
            {t('session.signPhotoLabel')}
          </h3>
          <RecordPhoto
            session={session}
            role="sign"
            alt={t('session.signPhotoAlt')}
            className="w-full rounded-xl border border-paper-300"
            onRemoteLoadError={(url) => noteFailedPhotoUrls([url])}
          />
          <RefMetaFor session={session} role="sign" timeZone={timeZone} />
        </Card>
      )}

      {/* No-sign sessions: show the "no posted restrictions" banner and the
          optional ambient (surroundings) photo, which substitutes for the
          sign photo as the user-supplied visual evidence. */}
      {session.no_sign && (
        <Card className="mb-3 rounded-2xl border-transparent shadow-[0_14px_40px_rgba(7,59,37,0.16),0_2px_6px_rgba(7,59,37,0.08)]">
          <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-600 mb-2">
            {t('session.noSignLabel')}
          </h3>
          <p className="text-sm text-ink-700 leading-relaxed mb-3">
            {t('session.noSignDescription')}
          </p>
          {hasSessionPhoto(session, 'ambient') ? (
            <>
              <RecordPhoto
                session={session}
                role="ambient"
                alt={t('session.ambientPhotoLabel')}
                className="w-full rounded-xl border border-paper-300"
                onRemoteLoadError={(url) => noteFailedPhotoUrls([url])}
              />
              {ambientPhoto.status === 'available' && (
                <p className="text-xs text-ink-600 mt-2">
                  {t('session.ambientPhotoCaption')}
                </p>
              )}
              <RefMetaFor session={session} role="ambient" timeZone={timeZone} />
            </>
          ) : (
            <p className="text-xs text-ink-600 italic">
              {t('session.noAmbientCaptured')}
            </p>
          )}
        </Card>
      )}

      {hasSessionPhoto(session, 'car') && (
        <Card className="mb-3 rounded-2xl border-transparent shadow-[0_14px_40px_rgba(7,59,37,0.16),0_2px_6px_rgba(7,59,37,0.08)]">
          <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-600 mb-2">
            {t('session.carPhotoLabel')}
          </h3>
          <RecordPhoto
            session={session}
            role="car"
            alt={t('session.carPhotoAlt')}
            className="w-full rounded-xl border border-paper-300"
            onRemoteLoadError={(url) => noteFailedPhotoUrls([url])}
          />
          <RefMetaFor session={session} role="car" timeZone={timeZone} />
        </Card>
      )}

      {/* Condition photos (when parked, on return) and the proof of payment
          or permit, each with its time, fingerprint and signing state. */}
      <EvidencePhotos session={session} timeZone={timeZone} />

      {canAdd && (
        <div className="mb-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setAddSheet('condition')}
            aria-haspopup="dialog"
            className="gf-card w-full min-h-[48px] text-paper-50 font-medium py-3 px-5 flex items-center gap-2 transition-colors hover:brightness-110"
            style={{ background: 'rgba(255,255,255,0.055)' }}
          >
            <Icon name="camera" className="w-5 h-5 shrink-0 text-[#A9CFBE]" />
            <span className="text-left leading-snug">{t('evidence.addCondition')}</span>
          </button>
          <button
            type="button"
            onClick={() => setAddSheet('compliance')}
            aria-haspopup="dialog"
            className="gf-card w-full min-h-[48px] text-paper-50 font-medium py-3 px-5 flex items-center gap-2 transition-colors hover:brightness-110"
            style={{ background: 'rgba(255,255,255,0.055)' }}
          >
            <Icon name="camera" className="w-5 h-5 shrink-0 text-[#A9CFBE]" />
            <span className="text-left leading-snug">{t('evidence.addMeterTicketOrPermit')}</span>
          </button>
        </div>
      )}
      {addSheet && (
        <AddEvidenceSheet
          session={session}
          kind={addSheet}
          onAdded={(id) => {
            if (user) mirrorSessionUpdateToCloud(id)
          }}
          onClose={() => setAddSheet(null)}
        />
      )}

      <div className="mt-6 flex flex-col gap-2">
        <Button onClick={handleExportPdf} disabled={pdfBusy}>
          {pdfBusy ? t('session.buildingPdf') : t('session.exportAsPdf')}
        </Button>
        {pdfError && (
          <div className="bg-accent-50 border-2 border-accent-400 rounded-xl p-3 text-sm">
            <p className="font-display font-bold text-ink-900 mb-1">
              {t('session.pdfErrorHeader')}
            </p>
            <p className="text-xs text-ink-700 leading-relaxed mt-1">
              {t('session.pdfErrorHelp')}
            </p>
          </div>
        )}
        {/* #9 — say so when a cloud-pulled record's photo couldn't be
            loaded, so a blank-evidence PDF doesn't leave silently. */}
        {hasRemotePhoto && (
          <p className="text-xs leading-relaxed text-center px-2" style={{ color: '#A9CFBE' }}>
            {t('session.exportPhotoWarning')}
          </p>
        )}
        {canDownloadFile && (
          <div className="flex flex-col gap-2 mt-3">
            {permitDetails && (
              <label className="flex items-start gap-3 min-h-[44px] py-2 cursor-pointer text-paper-50">
                <input
                  type="checkbox"
                  checked={includePermit}
                  onChange={(e) => setIncludePermit(e.target.checked)}
                  className="mt-0.5 w-5 h-5 shrink-0 accent-[#7BE3A4]"
                  aria-describedby="evidence-file-permit-help"
                />
                <span className="text-sm leading-snug">
                  <span className="font-semibold">{t('evidenceFile.includePermit')}</span>
                  <span id="evidence-file-permit-help" className="block text-xs mt-1 leading-relaxed" style={{ color: '#A9CFBE' }}>
                    {t('evidenceFile.permitHelp')}
                  </span>
                </span>
              </label>
            )}
            <Button variant="outline" onClick={handleEvidenceFile} disabled={fileBusy} aria-describedby="evidence-file-help">
              {fileBusy ? t('evidenceFile.busy') : t('evidenceFile.download')}
            </Button>
            <p id="evidence-file-help" className="text-xs leading-relaxed px-1" style={{ color: '#A9CFBE' }}>
              {t('evidenceFile.help')}
            </p>
            {fileMissingPhotos > 0 && (
              <p className="text-xs leading-relaxed px-1" style={{ color: '#A9CFBE' }} role="status">
                {t('evidenceFile.photosMissing', { count: fileMissingPhotos })}
              </p>
            )}
            {fileDifferingPhotos > 0 && (
              <p className="text-xs leading-relaxed px-1" style={{ color: '#A9CFBE' }} role="status">
                {t('evidenceFile.photosDiffer', { count: fileDifferingPhotos })}
              </p>
            )}
            {fileError && (
              <p className="bg-accent-50 border-2 border-accent-400 rounded-xl p-3 text-sm text-ink-900" role="alert">
                {t('evidenceFile.error')}
              </p>
            )}
          </div>
        )}
        {/* #18 — the plain-English "how a council verifies this" walkthrough,
            surfaced at the moment the user is producing evidence. */}
        <a
          href={verifyHref}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[#7BE3A4] hover:text-paper-50 underline text-center min-h-[44px] inline-flex items-center justify-center py-2.5 -my-1.5"
        >
          {t('session.howToVerify')}
        </a>
        <button
          onClick={onDraftAppeal}
          className="bg-white border border-ink-700 hover:bg-ink-900 hover:text-white text-ink-900 font-semibold py-3 rounded-xl transition-colors"
        >
          {t('session.draftAppeal')}
        </button>
        {/* End session — only shown for sessions the user can still terminate.
            Visually distinct from Delete (which destroys the record): this
            keeps the evidence intact and just stamps an ended_at timestamp. */}
        {canEnd && (
          <button
            onClick={handleEnd}
            aria-haspopup="dialog"
            className="bg-white border border-brand-500 hover:bg-brand-50 active:bg-brand-100 text-brand-700 font-semibold py-3 rounded-xl transition-colors"
          >
            {t('session.endSession')}
          </button>
        )}
        <button
          onClick={handleDelete}
          className="text-accent-600 hover:text-accent-700 font-medium py-3 transition-colors"
        >
          {t('session.deleteSession')}
        </button>
      </div>
    </div>
  )
}

/**
 * Time, signing state and the library label under a sign, car or
 * surroundings photo that has a PhotoRef (records from the photo store).
 * Its fingerprint is in the chain panel and in the not-on-this-device line.
 */
function RefMetaFor({ session, role, timeZone }: { session: ParkingSession; role: 'sign' | 'car' | 'ambient'; timeZone: string }) {
  const ref = photoRefFor(session, role)
  if (!ref) return null
  // Time and source as a signed part carries them, when one does (N2).
  return (
    <PhotoRefMeta
      photoRef={signedPhotoRef(session, ref)}
      session={session}
      timeZone={timeZone}
      showFingerprint={false}
      showSigning={false}
    />
  )
}
