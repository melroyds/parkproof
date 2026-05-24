import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/use-auth'
import { deleteAccount, exportCloudData } from '../lib/sync'
import Icon from './Icon'

interface Props {
  onBack: () => void
  onOpenPrivacy: () => void
  onDeleted: () => void
}

export default function AuthSettings({ onBack, onOpenPrivacy, onDeleted }: Props) {
  const { t, i18n } = useTranslation()
  const { user, signOut } = useAuth()
  const [exportStatus, setExportStatus] = useState<'idle' | 'busy' | 'error'>('idle')
  const [exportError, setExportError] = useState<string | null>(null)
  const [deleteStage, setDeleteStage] = useState<'idle' | 'confirm' | 'busy' | 'error'>('idle')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  if (!user) {
    // Defensive — shouldn't render unless signed in; App-level routing handles
    // this but the type system can't know.
    return (
      <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
        <button onClick={onBack} className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4">
          {t('common.back')}
        </button>
        <p className="text-ink-700">{t('settings.youSignedOut')}</p>
      </div>
    )
  }

  const handleExport = async () => {
    setExportStatus('busy')
    setExportError(null)
    try {
      const [data, pdfModule, fontsModule] = await Promise.all([
        exportCloudData(),
        import('../lib/pdf'),
        import('../lib/pdf-fonts'),
      ])
      // Prefetch the locale's Noto Sans font before rendering — without
      // this, non-Latin scripts (Chinese / Korean / Devanagari / Gurmukhi
      // / Greek / Vietnamese diacritics) render as missing-glyph boxes
      // across every session detail block in the multi-page export.
      await fontsModule.prefetchPdfFont(i18n.language)
      // The cloud /me/export response shape matches downloadFullExportPdf's
      // FullExportPayload exactly. Renders a multi-page PDF: cover with
      // summary table, then one detail block per session with photos.
      pdfModule.downloadFullExportPdf(
        data as Parameters<typeof pdfModule.downloadFullExportPdf>[0],
        t,
        i18n.language,
      )
      setExportStatus('idle')
    } catch (err) {
      setExportStatus('error')
      setExportError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDelete = async () => {
    if (deleteConfirmText !== 'DELETE') {
      setDeleteError(t('settings.deleteTypoError'))
      return
    }
    setDeleteStage('busy')
    setDeleteError(null)
    try {
      await deleteAccount()
      // Sign out locally — the Cognito user is already gone server-side.
      signOut()
      onDeleted()
    } catch (err) {
      setDeleteStage('error')
      setDeleteError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <button onClick={onBack} className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4">
        {t('common.back')}
      </button>

      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">{t('settings.header')}</h2>
      <p className="text-sm text-ink-600 mb-6 leading-relaxed">
        {t('settings.intro')}
      </p>

      <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-3">
        <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-500 mb-2">
          {t('settings.signedInAs')}
        </h3>
        <p className="text-ink-900 break-words">{user.email}</p>
        <p className="text-[10px] text-ink-500 font-mono mt-1 break-all">{user.userId}</p>
      </section>

      <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-3">
        <h3 className="font-display font-bold text-ink-900 mb-1">{t('settings.exportHeader')}</h3>
        <p className="text-xs text-ink-600 mb-3 leading-relaxed">
          {t('settings.exportCopy')}
        </p>
        <button
          onClick={handleExport}
          disabled={exportStatus === 'busy'}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white font-semibold py-3 rounded-xl shadow-md transition-colors"
        >
          {exportStatus === 'busy' ? t('settings.exportBuilding') : t('settings.exportCta')}
        </button>
        {exportError && (
          <p className="text-xs text-accent-700 mt-2 break-words">{exportError}</p>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-3">
        <h3 className="font-display font-bold text-ink-900 mb-1">{t('settings.privacyHeader')}</h3>
        <p className="text-xs text-ink-600 mb-3 leading-relaxed">
          {t('settings.privacyCopy')}
        </p>
        <button
          onClick={onOpenPrivacy}
          className="w-full bg-white border border-ink-700 hover:bg-ink-900 hover:text-white text-ink-900 font-semibold py-3 rounded-xl transition-colors"
        >
          {t('settings.privacyCta')}
        </button>
      </section>

      <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-3">
        <h3 className="font-display font-bold text-ink-900 mb-1">{t('settings.signOutHeader')}</h3>
        <p className="text-xs text-ink-600 mb-3 leading-relaxed">
          {t('settings.signOutCopy')}
        </p>
        <button
          onClick={() => {
            signOut()
            onBack()
          }}
          className="w-full bg-paper-200 hover:bg-paper-300 text-ink-900 font-semibold py-3 rounded-xl transition-colors"
        >
          {t('settings.signOutCta')}
        </button>
      </section>

      <section className="bg-accent-50 border-2 border-accent-300 rounded-2xl p-5 mt-3">
        <h3 className="font-display font-bold text-ink-900 mb-1 flex items-center gap-2">
          <Icon name="warning" className="w-5 h-5 text-accent-700" />
          {t('settings.deleteHeader')}
        </h3>
        <p className="text-xs text-ink-700 mb-3 leading-relaxed">
          {t('settings.deleteCopy')}
        </p>
        {deleteStage === 'idle' && (
          <button
            onClick={() => {
              setDeleteStage('confirm')
              setDeleteConfirmText('')
              setDeleteError(null)
            }}
            className="w-full bg-white border border-accent-500 text-accent-700 font-semibold py-3 rounded-xl hover:bg-accent-100 transition-colors"
          >
            {t('settings.deleteStart')}
          </button>
        )}
        {(deleteStage === 'confirm' || deleteStage === 'error' || deleteStage === 'busy') && (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-ink-700 block">
              {t('settings.deleteConfirmLabel')}
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                disabled={deleteStage === 'busy'}
                className="mt-1 w-full border border-paper-300 rounded-lg px-3 py-2 text-sm font-mono focus:border-accent-500 focus:outline-none"
              />
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteStage('idle')}
                disabled={deleteStage === 'busy'}
                className="flex-1 bg-paper-200 hover:bg-paper-300 text-ink-700 font-medium py-2.5 rounded-lg text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteStage === 'busy' || deleteConfirmText !== 'DELETE'}
                className="flex-1 bg-accent-600 hover:bg-accent-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm"
              >
                {deleteStage === 'busy' ? t('settings.deleting') : t('settings.deleteForever')}
              </button>
            </div>
            {deleteError && (
              <p className="text-xs text-accent-700 leading-relaxed break-words">
                {deleteError}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
