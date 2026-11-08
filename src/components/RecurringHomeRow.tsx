import { useTranslation } from 'react-i18next'
import type { RecurringRule } from '../types'
import { nextOccurrenceWithin } from '../lib/recurring'
import { differsFromPhoneClock, formatClock, ruleWhat } from '../lib/recurring-copy'
import { formatExpiryAbsolute, formatInZone } from '../lib/time-format'
import Icon from './Icon'

/** The home row shows the next occurrence inline when it starts within this window. */
const HOME_NEXT_WINDOW_MS = 24 * 60 * 60 * 1000

interface Props {
  rules: readonly RecurringRule[]
  now: number
  onOpen: () => void
  className?: string
}

/**
 * The home screen's "Street sweeping and weekly reminders" glass row
 * (T5a fills it, T4's layout places it): opens the recurring view, and
 * when an active rule starts within 24 hours (or is on now) names it and
 * its time under the title.
 */
export default function RecurringHomeRow({ rules, now, onOpen, className = '' }: Props) {
  const { t } = useTranslation()
  const soon = nextOccurrenceWithin(rules, now, HOME_NEXT_WINDOW_MS)
  let next: string | null = null
  if (soon) {
    const what = ruleWhat(soon.rule, t)
    const tz = soon.rule.timezone
    next =
      soon.occurrence.start.getTime() <= now
        ? t('recurring.homeOnNow', { what, time: formatClock(soon.rule.end) })
        : t('recurring.homeNext', {
            what,
            // The rule's own zone, named when the phone's clock reads it
            // differently (as in the list), so 7 am in Melbourne isn't read
            // as 7 am on a phone in Perth.
            time: differsFromPhoneClock(soon.occurrence.start, tz)
              ? formatInZone(soon.occurrence.start, tz, { withZone: true })
              : formatExpiryAbsolute(soon.occurrence.start, { timeZone: tz, now: new Date(now) }).combined,
          })
  }
  return (
    <button
      onClick={onOpen}
      className={`gf-card w-full text-paper-50 font-medium py-3 min-h-[44px] flex items-start justify-between gap-3 px-5 transition-colors hover:brightness-110 ${className}`.trim()}
      style={{ background: 'rgba(255,255,255,0.055)' }}
    >
      <span className="flex items-start gap-2 min-w-0 flex-1">
        <Icon name="repeat" className="w-5 h-5 shrink-0 mt-px text-[#A9CFBE]" />
        <span className="min-w-0 text-left">
          <span className="block leading-snug">{t('recurring.homeRow')}</span>
          {next && <span className="block text-sm font-semibold mt-0.5 text-[#7BE3A4] leading-snug">{next}</span>}
        </span>
      </span>
      <span className="text-sm shrink-0 mt-px pr-2" style={{ color: '#A9CFBE' }}>
        {rules.length === 0 ? t('recurring.homeNone') : t('recurring.homeCount', { count: rules.length })}
      </span>
    </button>
  )
}
