import { useTranslation } from 'react-i18next'
import type { RecurringRule } from '../types'
import { recurringHomeCount, recurringHomeNext } from '../lib/recurring-copy'
import Icon from './Icon'

interface Props {
  rules: readonly RecurringRule[]
  now: number
  onOpen: () => void
  className?: string
}

/**
 * The "Street sweeping and weekly reminders" glass row on its own (T5a):
 * opens the recurring view, and when an active rule starts within 24 hours
 * (or is on now) names it and its time under the title. The home screen
 * shows the same words in T4's HomeMenu row (recurringHomeNext and
 * recurringHomeCount in src/lib/recurring-copy.ts).
 */
export default function RecurringHomeRow({ rules, now, onOpen, className = '' }: Props) {
  const { t } = useTranslation()
  const next = recurringHomeNext(rules, now, t)
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
        {recurringHomeCount(rules, t)}
      </span>
    </button>
  )
}
