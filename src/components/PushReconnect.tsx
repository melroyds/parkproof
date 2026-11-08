import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { reconnectPush } from '../lib/push'

/**
 * "Reminders not arriving? Reconnect" (field-test fix list, item 5). A push
 * registration can go bad at the push service's end and keep accepting
 * reminders it then delivers late or never. A fresh registration fixes it,
 * and before this the only way to get one was resetting the site's
 * notification permission in the browser settings.
 *
 * Reminders already booked need no re-booking: the sender looks up this
 * device's current registration when each one fires.
 *
 * Shown inside the push management blocks (About, account settings) when
 * this device is subscribed, and in the Android tips on the reminder
 * screens (ReminderHelp) when notifications are allowed. `onFailed` lets
 * the parent re-check the subscription, because a failed reconnect can
 * leave the browser without one. `tone` 'vault' is for the dark page.
 */
export default function PushReconnect({
  onFailed,
  tone = 'card',
}: {
  onFailed?: () => void
  tone?: 'vault' | 'card'
}) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed' | 'denied'>('idle')

  const handleReconnect = async () => {
    if (state === 'busy') return
    setState('busy')
    const result = await reconnectPush()
    if (result.ok) {
      setState('done')
      return
    }
    setState(result.reason === 'denied' ? 'denied' : 'failed')
    onFailed?.()
  }

  const message =
    state === 'done'
      ? t('reminders.reconnect.done')
      : state === 'failed'
        ? t('reminders.reconnect.failed')
        : state === 'denied'
          ? t('reminders.reconnect.denied')
          : ''

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => void handleReconnect()}
        disabled={state === 'busy'}
        className={`text-xs font-semibold underline underline-offset-2 disabled:opacity-50 min-h-[44px] inline-flex items-center text-left ${
          tone === 'vault' ? 'text-paper-50 hover:text-white' : 'text-brand-700 hover:text-brand-800'
        }`}
      >
        {state === 'busy' ? t('reminders.reconnect.busy') : t('reminders.reconnect.cta')}
      </button>
      <p
        role="status"
        aria-live="polite"
        className={`text-xs leading-relaxed ${tone === 'vault' ? '' : 'text-ink-700'}`}
        style={tone === 'vault' ? { color: '#A9CFBE' } : undefined}
      >
        {message}
      </p>
    </div>
  )
}
