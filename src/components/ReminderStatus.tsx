import { Trans, useTranslation } from 'react-i18next'
import type { RemindMeSummary } from '../lib/remind-me'
import { formatReminderTimesLine } from '../lib/time-format'
import { isAndroid } from '../lib/platform'
import { getPushPermissionState } from '../lib/push'
import Icon from './Icon'
import PushReconnect from './PushReconnect'

/**
 * Pieces shared by every "Remind me" surface (the expiry and no-sign
 * pickers in ReminderOptions, and "+ Add reminder" in
 * ScheduledRemindersSection).
 */

type Tone = 'vault' | 'card'

/** The one next step when reminders can't reach the driver with ParkProof closed. */
const STEP_KEY: Record<NonNullable<RemindMeSummary['step']>, string> = {
  ios_install: 'reminders.remindMe.stepInstall',
  denied: 'reminders.remindMe.stepAllow',
  unsupported: 'reminders.remindMe.stepUnsupported',
  failed: 'reminders.remindMe.stepRetry',
  not_owner: 'scheduledReminders.otherDevice',
  allPast: 'reminders.remindMe.stepAllPast',
}

/**
 * What the last "Remind me" tap did, in plain words: the times booked and
 * whether they work with ParkProof closed, or why not and what to do. The
 * live region is always in the DOM so screen readers announce the change.
 */
export function RemindMeOutcome({
  summary,
  timeZone,
  className = '',
}: {
  summary: RemindMeSummary | null
  timeZone: string
  className?: string
}) {
  const { t } = useTranslation()
  const times =
    summary && summary.times.length > 0
      ? formatReminderTimesLine(summary.times, { now: new Date(), timeZone, t })
      : ''
  const strong = { strong: <span className="font-semibold" /> }
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={className}>
      {summary && (
        <div
          className={`border rounded-lg p-3 text-sm leading-relaxed ${
            summary.kind === 'background'
              ? 'bg-brand-50 border-brand-200 text-brand-800'
              : 'bg-accent-50 border-accent-300 text-accent-800'
          }`}
        >
          <p className="flex items-start gap-2">
            {summary.kind === 'background' && (
              <Icon name="check" className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={2.5} />
            )}
            <span>
              {summary.kind === 'background' ? (
                <Trans
                  i18nKey="reminders.remindMe.setBackground"
                  count={summary.times.length}
                  values={{ times }}
                  components={strong}
                />
              ) : summary.kind === 'openOnly' ? (
                <Trans
                  i18nKey="reminders.remindMe.setOpenOnly"
                  count={summary.times.length}
                  values={{ times }}
                  components={strong}
                />
              ) : (
                t('reminders.remindMe.notSet')
              )}
            </span>
          </p>
          {summary.step && <p className="mt-1.5 text-xs leading-relaxed">{t(STEP_KEY[summary.step])}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * The reliability line every reminder feature carries, plus, on Android
 * only, short collapsed tips for the two problems found on a Samsung phone
 * that code can't fix (Chrome's spam warning, battery management), and,
 * when notifications are allowed, "Reminders not arriving? Reconnect": the
 * fix for a registration that went bad at the push service (fix list,
 * item 5), where a driver whose reminder didn't come will look.
 * `reconnect={false}` where the surface shows its own Reconnect (About,
 * Settings).
 */
export function ReminderHelp({
  tone,
  className = '',
  reconnect = true,
}: {
  tone: Tone
  className?: string
  reconnect?: boolean
}) {
  const { t } = useTranslation()
  const muted = tone === 'vault' ? { color: '#A9CFBE' } : undefined
  const mutedClass = tone === 'vault' ? '' : 'text-ink-600'
  return (
    <div className={className}>
      <p className={`text-xs leading-relaxed ${mutedClass}`} style={muted}>
        {t('reminders.reliability')}
      </p>
      {isAndroid() && (
        <details className="mt-1">
          <summary
            className={`min-h-[44px] flex items-center cursor-pointer text-xs font-semibold ${
              tone === 'vault' ? 'text-paper-50' : 'text-ink-800'
            }`}
          >
            {t('reminders.androidTips.summary')}
          </summary>
          <ul className={`text-xs leading-relaxed list-disc pl-5 space-y-1 ${mutedClass}`} style={muted}>
            <li>{t('reminders.androidTips.spam')}</li>
            <li>{t('reminders.androidTips.battery')}</li>
          </ul>
          {reconnect && getPushPermissionState() === 'granted' && <PushReconnect tone={tone} />}
        </details>
      )}
    </div>
  )
}
