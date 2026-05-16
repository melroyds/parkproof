import { useRef, useState } from 'react'
import type { AppealDraft, ParkingSession } from '../types'
import { draftAppeal } from '../lib/claude'
import { resizeImageFile } from '../lib/image'
import Icon from './Icon'
import BrandMark from './BrandMark'

interface Props {
  session: ParkingSession
  onBack: () => void
}

type Stage =
  | { name: 'capture' }
  | { name: 'drafting' }
  | { name: 'review'; draft: AppealDraft; ticketPhoto: string }
  | { name: 'error'; message: string }

const STRENGTH_LABEL = {
  strong: { color: 'text-brand-700 bg-brand-50 border-brand-200', text: 'Strong evidence' },
  moderate: { color: 'text-accent-700 bg-accent-50 border-accent-200', text: 'Moderate evidence' },
  weak: { color: 'text-ink-700 bg-paper-200 border-paper-300', text: 'Weak evidence' },
} as const

export default function AppealFlow({ session, onBack }: Props) {
  const [stage, setStage] = useState<Stage>({ name: 'capture' })
  const [editedLetter, setEditedLetter] = useState<string>('')
  const [copied, setCopied] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setStage({ name: 'drafting' })
    try {
      const { dataUrl, mediaType } = await resizeImageFile(file)
      const base64 = dataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
      const draft = await draftAppeal(base64, mediaType, session)
      setEditedLetter(draft.appeal_letter)
      setStage({ name: 'review', draft, ticketPhoto: dataUrl })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStage({ name: 'error', message })
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editedLetter)
      setCopied(true)
      setTimeout(() => setCopied(false), 2400)
    } catch {
      /* clipboard unavailable in some PWA contexts — user can still select + copy manually */
    }
  }

  const handleDownloadPdf = async () => {
    if (stage.name !== 'review') return
    const { downloadAppealPdf } = await import('../lib/pdf')
    downloadAppealPdf({
      session,
      draft: stage.draft,
      editedLetter,
      ticketPhoto: stage.ticketPhoto,
    })
  }

  if (stage.name === 'drafting') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <BrandMark className="w-20 h-20 mb-5 animate-pulse" />
        <h2 className="font-display text-2xl font-extrabold text-ink-900">
          Reading the ticket…
        </h2>
        <p className="text-sm text-ink-600 mt-2">
          Claude is cross-referencing it with your saved evidence.
        </p>
      </main>
    )
  }

  if (stage.name === 'error') {
    return (
      <main className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
        <button onClick={onBack} className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4">
          ← Back
        </button>
        <div className="w-16 h-16 rounded-full bg-accent-100 border-2 border-accent-500 text-accent-700 flex items-center justify-center mb-4 mx-auto">
          <Icon name="warning" className="w-8 h-8" />
        </div>
        <h2 className="font-display text-2xl font-extrabold text-ink-900 text-center">
          Couldn't draft the appeal
        </h2>
        <p className="text-sm text-ink-700 mt-3 mb-6 break-words text-center">{stage.message}</p>
        <button
          onClick={() => setStage({ name: 'capture' })}
          className="bg-brand-500 hover:bg-brand-600 text-white font-semibold py-3 rounded-2xl shadow-md"
        >
          Try a different photo
        </button>
      </main>
    )
  }

  if (stage.name === 'review') {
    const strength = STRENGTH_LABEL[stage.draft.evidence_strength] ?? STRENGTH_LABEL.moderate
    return (
      <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
        <button
          onClick={onBack}
          className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4"
        >
          ← Back to session
        </button>

        <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-2">
          Draft appeal
        </h2>
        <p className="text-sm text-ink-600 mb-6 leading-relaxed">{stage.draft.ticket_summary}</p>

        <span
          className={`text-xs font-semibold uppercase tracking-widest border rounded-full px-3 py-1 self-start mb-4 ${strength.color}`}
        >
          {strength.text}
        </span>

        <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-4">
          <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-500 mb-2">
            Strategy
          </h3>
          <p className="text-sm text-ink-800 leading-relaxed">{stage.draft.notes}</p>
        </section>

        <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-4">
          <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-500 mb-2">
            Subject line
          </h3>
          <p className="font-display text-base font-bold text-ink-900">
            {stage.draft.appeal_subject}
          </p>
        </section>

        <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-500">
              Letter (editable)
            </h3>
            <button
              onClick={() => setEditedLetter(stage.draft.appeal_letter)}
              className="text-xs text-ink-600 hover:text-ink-900 underline"
            >
              Reset to AI draft
            </button>
          </div>
          <textarea
            value={editedLetter}
            onChange={(e) => setEditedLetter(e.target.value)}
            rows={16}
            className="w-full text-sm text-ink-900 bg-paper-50 border border-paper-300 rounded-xl p-3 leading-relaxed focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 resize-y"
          />
        </section>

        <div className="flex flex-col gap-2">
          <button
            onClick={handleCopy}
            className="bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-semibold py-4 rounded-2xl shadow-lg shadow-brand-500/25 transition-colors"
          >
            {copied ? 'Copied ✓' : 'Copy letter to clipboard'}
          </button>
          <button
            onClick={handleDownloadPdf}
            className="bg-white border border-paper-300 hover:border-ink-600 text-ink-900 font-medium py-3 rounded-2xl transition-colors"
          >
            Download as PDF
          </button>
        </div>

        <p className="text-xs text-ink-500 mt-4 text-center leading-relaxed">
          The AI draft is a starting point. Read carefully, edit the letter to match your voice
          and circumstances, and verify every claim before sending. ParkProof doesn't lodge the
          appeal for you.
        </p>
      </div>
    )
  }

  // capture stage
  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <button
        onClick={onBack}
        className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4 transition-colors"
      >
        ← Back to session
      </button>

      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">
        Draft an appeal letter
      </h2>
      <p className="text-sm text-ink-600 mb-6 leading-relaxed">
        Take a photo of the infringement notice you received. Claude will read it, cross-reference
        with the evidence saved in this session, and draft a formal letter you can send to the
        issuing council.
      </p>

      <div className="flex flex-col gap-3">
        <button
          onClick={() => cameraInputRef.current?.click()}
          className="border-2 border-dashed border-brand-300 hover:border-brand-500 hover:bg-brand-50/50 bg-white rounded-2xl py-8 px-4 flex flex-col items-center text-brand-600 transition-colors"
        >
          <Icon name="camera" className="w-10 h-10 mb-2" />
          <span className="text-sm font-semibold text-ink-900">Take a photo</span>
          <span className="text-xs text-ink-600 mt-1 text-center">Camera of the ticket</span>
        </button>
        <button
          onClick={() => libraryInputRef.current?.click()}
          className="border-2 border-dashed border-accent-300 hover:border-accent-500 hover:bg-accent-50/50 bg-white rounded-2xl py-8 px-4 flex flex-col items-center text-accent-700 transition-colors"
        >
          <Icon name="gallery" className="w-10 h-10 mb-2" />
          <span className="text-sm font-semibold text-ink-900">From library</span>
          <span className="text-xs text-ink-600 mt-1 text-center">Photo / scan of the notice</span>
        </button>
      </div>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
          e.target.value = ''
        }}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
          e.target.value = ''
        }}
      />

      <p className="text-xs text-ink-500 mt-6 text-center leading-relaxed">
        The AI draft is a starting point, not legal advice. You're responsible for the final
        letter you send.
      </p>
    </div>
  )
}
