import { useEffect, useMemo, useRef, useState } from 'react'
import type { ParkingSession } from '../types'
import { deleteSession, updateSession } from '../lib/storage'
import Icon from './Icon'
import { useNow } from '../lib/use-now'
import { formatCountdown } from '../lib/countdown'
import { sessionTimezone } from '../lib/timezone'
import { navigationUrl } from '../lib/walk-back'
import { useAuth } from '../lib/use-auth'
import { deleteCloudSession, mirrorSessionUpdateToCloud } from '../lib/sync'

const NOTE_MAX_LENGTH = 280

interface Props {
  session: ParkingSession
  onBack: () => void
  onDeleted: () => void
  onDraftAppeal: () => void
}

function fmtLocal(iso: string, timeZone: string, full = false): string {
  return new Date(iso).toLocaleString('en-AU', {
    timeZone,
    weekday: full ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: full ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function SessionDetail({ session, onBack, onDeleted, onDraftAppeal }: Props) {
  const { user } = useAuth()
  const now = useNow()
  const expiresMs = session.expires_at ? new Date(session.expires_at).getTime() : null
  const isExpired = expiresMs !== null && expiresMs < now
  const countdown =
    expiresMs !== null && !isExpired ? formatCountdown(expiresMs - now) : null
  const timeZone = useMemo(() => sessionTimezone(session.location), [session.location])

  // Pre-import the PDF chunk so the click → save chain stays inside the
  // user-gesture window (iOS Safari otherwise sometimes blocks the download
  // because the await import() breaks the gesture). We hold the module in a
  // ref and call it synchronously from the click handler.
  const pdfModuleRef = useRef<typeof import('../lib/pdf') | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void import('../lib/pdf').then((mod) => {
      if (!cancelled) pdfModuleRef.current = mod
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleExportPdf = async () => {
    setPdfError(null)
    setPdfBusy(true)
    try {
      // If the chunk is already in the ref, run synchronously. Otherwise
      // fall back to a fresh dynamic import — slower on first click on a
      // cold cache, but at least it works.
      const mod = pdfModuleRef.current ?? (await import('../lib/pdf'))
      mod.downloadPdf(session)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[pdf] export failed:', err)
      setPdfError(message)
    } finally {
      setPdfBusy(false)
    }
  }

  const handleDelete = () => {
    if (!window.confirm('Delete this parking session? This cannot be undone.')) return
    deleteSession(session.id)
    // Mirror the deletion to the cloud when signed in — fire-and-forget; the
    // local delete is authoritative for this device regardless of network.
    if (user) {
      void deleteCloudSession(session.id).catch((err) => {
        console.warn('[sync] cloud delete failed:', err)
      })
    }
    onDeleted()
  }

  // Editable note — persists to localStorage on save. The committed value lives
  // in `currentNote` so re-renders pick up the latest copy without re-reading
  // session storage; `noteDraft` is the in-progress textarea state.
  const [currentNote, setCurrentNote] = useState(session.note ?? '')
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
      setCurrentNote(trimmed)
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
      const message = err instanceof Error ? err.message : String(err)
      setNoteError(message)
    }
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <button
        onClick={onBack}
        className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4 transition-colors"
      >
        ← Back to history
      </button>

      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">Parking session</h2>
      <p className="text-sm text-ink-600 mb-3 leading-relaxed">
        Arrived {fmtLocal(session.arrived_at, timeZone, true)}
      </p>

      {session.signature && (
        <div className="mb-6 inline-flex items-center gap-2 self-start bg-brand-50 border border-brand-200 text-brand-800 text-xs font-semibold px-3 py-1.5 rounded-full">
          <Icon name="check" className="w-4 h-4" strokeWidth={2.5} />
          <span>Cryptographically signed</span>
          <span className="text-brand-600 font-normal">·</span>
          <span className="text-brand-700 font-mono text-[10px]">
            {new Date(session.signature.signed_at).toLocaleString('en-AU', {
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        </div>
      )}

      <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-3">
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-widest font-semibold text-ink-500">
              Status
            </dt>
            <dd
              className={`mt-1 font-display font-bold ${
                isExpired ? 'text-ink-500' : 'text-brand-700'
              }`}
            >
              {session.expires_at
                ? isExpired
                  ? 'Expired'
                  : `Active until ${fmtLocal(session.expires_at, timeZone)}`
                : 'No expiry recorded'}
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
          <div>
            <dt className="text-xs uppercase tracking-widest font-semibold text-ink-500">
              Sign rules
            </dt>
            <dd className="mt-1 text-ink-900">{session.rules}</dd>
          </div>
          {session.chosen_label && (
            <div>
              <dt className="text-xs uppercase tracking-widest font-semibold text-ink-500">
                Side chosen
              </dt>
              <dd className="mt-1 text-ink-900">{session.chosen_label}</dd>
            </div>
          )}
          {session.location && (
            <div>
              <dt className="text-xs uppercase tracking-widest font-semibold text-ink-500">
                Location
              </dt>
              <dd className="mt-1">
                <a
                  className="text-brand-700 hover:text-brand-800 underline inline-flex items-center gap-1"
                  href={`https://www.google.com/maps?q=${session.location.lat},${session.location.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="pin" className="w-4 h-4" />
                  {session.location.address ?? 'View on Google Maps'}
                </a>
                <p className="text-xs text-ink-500 font-mono mt-0.5">
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
                      Walk back to the car
                      <span aria-hidden>→</span>
                    </a>
                  )
                })()}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs uppercase tracking-widest font-semibold text-ink-500">
              AI confidence
            </dt>
            <dd className="mt-1 text-ink-900 capitalize">{session.confidence}</dd>
          </div>
        </dl>
      </section>

      {/* Note — user-supplied context. Soft-asks for it on empty so people
          remember to add the WHY rather than just the WHEN-and-WHERE. */}
      <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-3">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-500">
            Note
          </h3>
          {!noteEditing && (
            <button
              onClick={startNoteEdit}
              className="text-xs font-medium text-brand-700 hover:text-brand-800 underline"
            >
              {currentNote ? 'Edit' : 'Add note'}
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
              placeholder="Why you were here — e.g. 'Mum's chemo at the Royal', 'Saturday market on Lygon'. Used as context if you ever need to appeal a ticket."
              className="w-full text-sm text-ink-900 bg-paper-50 border border-paper-300 rounded-xl p-3 leading-relaxed focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 resize-y"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-ink-500 font-mono">
                {noteDraft.length}/{NOTE_MAX_LENGTH}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={cancelNoteEdit}
                  className="bg-paper-200 hover:bg-paper-300 text-ink-700 font-medium px-3 py-1.5 rounded-lg text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveNote}
                  className="bg-brand-500 hover:bg-brand-600 text-white font-semibold px-3 py-1.5 rounded-lg text-xs transition-colors"
                >
                  Save note
                </button>
              </div>
            </div>
            {noteError && (
              <p className="text-xs text-accent-700 break-words leading-relaxed">
                {noteError}
              </p>
            )}
          </div>
        ) : currentNote ? (
          <p className="text-sm text-ink-900 whitespace-pre-wrap break-words leading-relaxed">
            {currentNote}
          </p>
        ) : (
          <p className="text-xs text-ink-500 italic leading-relaxed">
            No note added. Tap{' '}
            <button
              onClick={startNoteEdit}
              className="underline font-medium text-brand-700"
            >
              Add note
            </button>{' '}
            to record why you were here — softens a council review when the
            context matters.
          </p>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-3">
        <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-500 mb-2">
          Sign photo
        </h3>
        <img
          src={session.sign_photo}
          alt="Sign"
          className="w-full rounded-xl border border-paper-300"
        />
      </section>

      {session.car_photo && (
        <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-3">
          <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-500 mb-2">
            Car at the spot
          </h3>
          <img
            src={session.car_photo}
            alt="Car"
            className="w-full rounded-xl border border-paper-300"
          />
        </section>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <button
          onClick={handleExportPdf}
          disabled={pdfBusy}
          className="bg-brand-500 hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-300 text-white font-semibold py-4 rounded-2xl shadow-lg shadow-brand-500/25 transition-colors"
        >
          {pdfBusy ? 'Building PDF…' : 'Export as PDF'}
        </button>
        {pdfError && (
          <div className="bg-accent-50 border-2 border-accent-400 rounded-xl p-3 text-sm">
            <p className="font-display font-bold text-ink-900 mb-1">
              Couldn't build the PDF
            </p>
            <p className="text-xs text-ink-700 leading-relaxed break-words">
              {pdfError}
            </p>
            <p className="text-[10px] text-ink-500 mt-2">
              The error has been logged to the browser console. If this keeps
              happening, take a screenshot of the console output and share it.
            </p>
          </div>
        )}
        <button
          onClick={onDraftAppeal}
          className="bg-white border border-ink-700 hover:bg-ink-900 hover:text-white text-ink-900 font-semibold py-3 rounded-2xl transition-colors"
        >
          Got a ticket? Draft an appeal letter
        </button>
        <button
          onClick={handleDelete}
          className="text-accent-600 hover:text-accent-700 font-medium py-3 transition-colors"
        >
          Delete session
        </button>
      </div>
    </div>
  )
}
