import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  strong: { color: 'text-brand-700 bg-brand-50 border-brand-200', textKey: 'appeal.strongEvidence' },
  moderate: { color: 'text-accent-700 bg-accent-50 border-accent-200', textKey: 'appeal.moderateEvidence' },
  weak: { color: 'text-ink-700 bg-paper-200 border-paper-300', textKey: 'appeal.weakEvidence' },
} as const

export default function AppealFlow({ session, onBack }: Props) {
  const { t, i18n } = useTranslation()
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

  const [pdfError, setPdfError] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const handleDownloadPdf = async () => {
    if (stage.name !== 'review') return
    setPdfError(null)
    setPdfBusy(true)
    try {
      const { downloadAppealPdf } = await import('../lib/pdf')
      // Prefetch the locale's Noto Sans font so non-Latin scripts render
      // properly in the appeal letter body + evidence summary. Idempotent
      // and cached; second call within the same session is a no-op.
      const { prefetchPdfFont } = await import('../lib/pdf-fonts')
      await prefetchPdfFont(i18n.language)
      downloadAppealPdf({
        session,
        draft: stage.draft,
        editedLetter,
        ticketPhoto: stage.ticketPhoto,
        t,
        locale: i18n.language,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[pdf] appeal export failed:', err)
      setPdfError(message)
    } finally {
      setPdfBusy(false)
    }
  }

  if (stage.name === 'drafting') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <BrandMark className="w-20 h-20 mb-5 animate-pulse" />
        <h2 className="font-display text-2xl font-extrabold text-ink-900">
          {t('appeal.draftingHeader')}
        </h2>
        <p className="text-sm text-ink-600 mt-2">
          {t('appeal.draftingSub')}
        </p>
      </main>
    )
  }

  if (stage.name === 'error') {
    return (
      <main className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
        <button onClick={onBack} className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4">
          {t('common.back')}
        </button>
        <div className="w-16 h-16 rounded-full bg-accent-100 border-2 border-accent-500 text-accent-700 flex items-center justify-center mb-4 mx-auto">
          <Icon name="warning" className="w-8 h-8" />
        </div>
        <h2 className="font-display text-2xl font-extrabold text-ink-900 text-center">
          {t('appeal.errorHeader')}
        </h2>
        <p className="text-sm text-ink-700 mt-3 mb-6 break-words text-center">{stage.message}</p>
        <button
          onClick={() => setStage({ name: 'capture' })}
          className="bg-brand-500 hover:bg-brand-600 text-white font-semibold py-3 rounded-2xl shadow-md"
        >
          {t('appeal.tryDifferentPhoto')}
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
          {t('common.backToSession')}
        </button>

        <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-2">
          {t('appeal.reviewHeader')}
        </h2>
        <p className="text-sm text-ink-600 mb-6 leading-relaxed">{stage.draft.ticket_summary}</p>

        <span
          className={`text-xs font-semibold uppercase tracking-widest border rounded-full px-3 py-1 self-start mb-4 ${strength.color}`}
        >
          {t(strength.textKey)}
        </span>

        <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-4">
          <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-500 mb-2">
            {t('appeal.strategy')}
          </h3>
          <p className="text-sm text-ink-800 leading-relaxed">{stage.draft.notes}</p>
        </section>

        <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-4">
          <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-500 mb-2">
            {t('appeal.subjectLine')}
          </h3>
          <p className="font-display text-base font-bold text-ink-900">
            {stage.draft.appeal_subject}
          </p>
        </section>

        <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-500">
              {t('appeal.letter')}
            </h3>
            <button
              onClick={() => setEditedLetter(stage.draft.appeal_letter)}
              className="text-xs text-ink-600 hover:text-ink-900 underline"
            >
              {t('appeal.resetDraft')}
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
            className="bg-gradient-to-r from-brand-500 via-brand-500 to-purple-600 hover:brightness-110 active:brightness-95 disabled:bg-none text-white font-semibold py-4 rounded-2xl shadow-lg shadow-brand-500/25 transition-colors"
          >
            {copied ? t('appeal.copied') : t('appeal.copyToClipboard')}
          </button>
          <button
            onClick={handleDownloadPdf}
            disabled={pdfBusy}
            className="bg-white border border-paper-300 hover:border-ink-600 disabled:opacity-60 text-ink-900 font-medium py-3 rounded-2xl transition-colors"
          >
            {pdfBusy ? t('appeal.downloadingPdf') : t('appeal.downloadPdf')}
          </button>
        </div>
        {pdfError && (
          <div className="mt-3 bg-accent-50 border-2 border-accent-400 rounded-xl p-3 text-sm">
            <p className="font-display font-bold text-ink-900 mb-1">
              {t('session.pdfErrorHeader')}
            </p>
            <p className="text-xs text-ink-700 leading-relaxed break-words">{pdfError}</p>
          </div>
        )}

        <p className="text-xs text-ink-500 mt-4 text-center leading-relaxed">
          {t('appeal.reviewDisclaimer')}
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
        {t('common.backToSession')}
      </button>

      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">
        {t('appeal.captureHeader')}
      </h2>
      <p className="text-sm text-ink-600 mb-6 leading-relaxed">
        {t('appeal.captureIntro')}
      </p>

      <div className="flex flex-col gap-3">
        <button
          onClick={() => cameraInputRef.current?.click()}
          className="border-2 border-dashed border-brand-300 hover:border-brand-500 hover:bg-brand-50/50 bg-white rounded-2xl py-8 px-4 flex flex-col items-center text-brand-600 transition-colors"
        >
          <Icon name="camera" className="w-10 h-10 mb-2" />
          <span className="text-sm font-semibold text-ink-900">{t('scanner.takePhoto')}</span>
          <span className="text-xs text-ink-600 mt-1 text-center">{t('appeal.captureTakePhotoSub')}</span>
        </button>
        <button
          onClick={() => libraryInputRef.current?.click()}
          className="border-2 border-dashed border-accent-300 hover:border-accent-500 hover:bg-accent-50/50 bg-white rounded-2xl py-8 px-4 flex flex-col items-center text-accent-700 transition-colors"
        >
          <Icon name="gallery" className="w-10 h-10 mb-2" />
          <span className="text-sm font-semibold text-ink-900">{t('scanner.fromLibrary')}</span>
          <span className="text-xs text-ink-600 mt-1 text-center">{t('appeal.captureFromLibrarySub')}</span>
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
        {t('appeal.captureDisclaimer')}
      </p>
    </div>
  )
}
