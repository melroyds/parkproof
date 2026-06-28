import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/use-auth'
import { deleteAccount, exportCloudData } from '../lib/sync'
import {
  getPushPermissionState,
  hasActiveSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/push'
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
      //
      // Cross-device: the /me/export response carries photos as HTTPS
      // presigned URLs (same hydration path as /sessions/list). jsPDF's
      // addImage only works with data URLs, so materialize every session's
      // photos before handing the payload to the generator. Per-photo
      // failures are tolerated — the bad field falls back to "could not be
      // embedded" while the rest of the export renders cleanly.
      const payload = data as Parameters<
        typeof pdfModule.downloadFullExportPdf
      >[0]
      const sessionsForPdf = await pdfModule.materializeRemotePhotosBatch(
        payload.sessions,
      )
      pdfModule.downloadFullExportPdf(
        { ...payload, sessions: sessionsForPdf },
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

      {/* Push notification management — per-device toggle for whether
          this browser receives Web Push reminders. Subscription state is
          per-browser-per-device (different from cloud-sync which is per-
          Cognito-account), so this lives in the signed-in settings even
          though anonymous users CAN technically be subscribed too.
          Anonymous users currently manage push only via the About page's
          Enable / browser-settings flow; adding a global "Account" entry
          for anonymous push management would need a separate non-auth
          settings screen — defer to post-launch. */}
      <PushManagementSection />

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
                className="flex-1 bg-paper-200 hover:bg-paper-300 text-ink-700 font-medium py-3 min-h-[44px] rounded-lg text-sm"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteStage === 'busy' || deleteConfirmText !== 'DELETE'}
                className="flex-1 bg-accent-600 hover:bg-accent-700 disabled:opacity-60 text-ink-900 font-semibold py-3 min-h-[44px] rounded-lg text-sm"
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

/**
 * Per-device push-notification management. Lives at the bottom of
 * AuthSettings as a sibling section because its state is independent
 * of the Cognito account (the same Cognito user can be subscribed on
 * device A and unsubscribed on device B).
 *
 * State machine:
 *   idle        — initial; we don't yet know the subscription status
 *   subscribed  — confirmed live PushSubscription on this device
 *   notSubscribed — no subscription (permission can be granted/denied/default)
 *   requesting  — mid-flight subscribe or unsubscribe
 *   unsupported — browser lacks PushManager (iOS Safari <16.4)
 *
 * Unsubscribe path is client-side only (see push.ts comments); the server
 * DDB row is reaped lazily on the next dispatch failure. Acceptable lag.
 */
function PushManagementSection() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<
    'idle' | 'requesting' | 'subscribed' | 'notSubscribed' | 'denied' | 'unsupported' | 'error'
  >(() => {
    const perm = getPushPermissionState()
    if (perm === 'unsupported') return 'unsupported'
    if (perm === 'denied') return 'denied'
    return 'idle'
  })

  useEffect(() => {
    let cancelled = false
    void hasActiveSubscription().then((has) => {
      if (cancelled) return
      setStatus(has ? 'subscribed' : 'notSubscribed')
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleEnable = async () => {
    setStatus('requesting')
    const result = await subscribeToPush()
    if (result.ok) setStatus('subscribed')
    else if (result.reason === 'denied') setStatus('denied')
    else if (result.reason === 'unsupported') setStatus('unsupported')
    else setStatus('error')
  }

  const handleDisable = async () => {
    if (!window.confirm(t('settings.pushDisableConfirm'))) return
    setStatus('requesting')
    const ok = await unsubscribeFromPush()
    setStatus(ok ? 'notSubscribed' : 'error')
  }

  if (status === 'unsupported') {
    // No UI surface — the browser literally can't do Web Push. Showing
    // a "you can't enable this" section is just noise.
    return null
  }

  return (
    <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-3">
      <h3 className="font-display font-bold text-ink-900 mb-1">
        {t('settings.pushHeader')}
      </h3>
      <p className="text-xs text-ink-600 mb-3 leading-relaxed">
        {t('settings.pushCopy')}
      </p>

      {status === 'subscribed' ? (
        <>
          <div className="mb-3 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
            <Icon name="check" className="w-4 h-4 shrink-0" strokeWidth={2.5} />
            <span className="leading-snug">{t('settings.pushSubscribed')}</span>
          </div>
          <button
            type="button"
            onClick={handleDisable}
            disabled={status !== 'subscribed'}
            className="w-full bg-paper-200 hover:bg-paper-300 disabled:opacity-50 text-ink-900 font-semibold py-3 rounded-xl transition-colors"
          >
            {t('settings.pushDisable')}
          </button>
          <p className="text-[11px] text-ink-500 mt-2 leading-relaxed">
            {t('settings.pushDisableNote')}
          </p>
        </>
      ) : status === 'denied' ? (
        <p className="text-xs text-ink-700 leading-relaxed">
          {t('settings.pushDenied')}
        </p>
      ) : (
        <button
          type="button"
          onClick={handleEnable}
          disabled={status === 'requesting'}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          {status === 'requesting'
            ? t('settings.pushRequesting')
            : status === 'error'
              ? t('settings.pushErrorRetry')
              : t('settings.pushEnable')}
        </button>
      )}
    </section>
  )
}
