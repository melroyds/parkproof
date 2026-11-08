import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  getPushPermissionState,
  hasActiveSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/push'
import Icon from './Icon'
import Card from './ui/Card'

/**
 * Per-device push-notification management, shown in Settings (T4; it used
 * to sit in Account). Its state is independent of the Cognito account (the
 * same user can be subscribed on device A and unsubscribed on device B), so
 * it works signed in or not.
 *
 * State machine:
 *   idle        initial; we don't yet know the subscription status
 *   subscribed  confirmed live PushSubscription on this device
 *   notSubscribed  no subscription (permission can be granted/denied/default)
 *   requesting  mid-flight subscribe or unsubscribe
 *   unsupported browser lacks PushManager (iOS Safari before 16.4, or not
 *               added to the Home Screen)
 *
 * Unsubscribe path is client-side only (see push.ts comments); the server
 * DDB row is reaped lazily on the next dispatch failure. Acceptable lag.
 */
export default function PushManagementSection() {
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
      // hasActiveSubscription is false without permission or support, so a
      // blocked or unsupported browser keeps saying so rather than offering
      // "Enable push".
      setStatus((s) => (s === 'denied' || s === 'unsupported' ? s : has ? 'subscribed' : 'notSubscribed'))
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

  return (
    <Card className="mb-3">
      <h3 className="font-display font-bold text-ink-900 mb-1">{t('settings.pushHeader')}</h3>
      {status === 'unsupported' ? (
        // Settings is where the driver looks for notifications, so say why
        // there's nothing to switch on rather than leaving a gap.
        <>
          <p className="text-xs text-ink-600 mb-2 leading-relaxed">{t('prefs.pushUnsupported')}</p>
          {/* Calendar reminders are reminders too: the reliability line applies. */}
          <p className="text-xs text-ink-600 leading-relaxed">{t('prefs.remindersReliability')}</p>
        </>
      ) : (
        <>
          <p className="text-xs text-ink-600 mb-2 leading-relaxed">{t('settings.pushCopy')}</p>
          <p className="text-xs text-ink-600 mb-3 leading-relaxed">{t('prefs.remindersReliability')}</p>

          {status === 'subscribed' ? (
            <>
              <div className="mb-3 px-3 py-2 rounded-lg bg-brand-50 border border-brand-200 text-brand-800 text-xs font-medium flex items-center gap-2">
                <Icon name="check" className="w-4 h-4 shrink-0" strokeWidth={2.5} />
                <span className="leading-snug">{t('settings.pushSubscribed')}</span>
              </div>
              <button
                type="button"
                onClick={handleDisable}
                className="w-full min-h-[44px] bg-paper-200 hover:bg-paper-300 disabled:opacity-50 text-ink-900 font-semibold py-3 rounded-xl transition-colors"
              >
                {t('settings.pushDisable')}
              </button>
              <p className="text-2xs text-ink-600 mt-2 leading-relaxed">{t('settings.pushDisableNote')}</p>
            </>
          ) : status === 'denied' ? (
            <p className="text-xs text-ink-700 leading-relaxed">{t('settings.pushDenied')}</p>
          ) : (
            <button
              type="button"
              onClick={handleEnable}
              disabled={status === 'requesting'}
              className="w-full min-h-[44px] bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {status === 'requesting'
                ? t('settings.pushRequesting')
                : status === 'error'
                  ? t('settings.pushErrorRetry')
                  : t('settings.pushEnable')}
            </button>
          )}
        </>
      )}
    </Card>
  )
}
