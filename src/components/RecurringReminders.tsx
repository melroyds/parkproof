import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RecurringRule } from '../types'
import { blankRule, deviceTimeZone } from '../lib/recurring'
import { ruleStatusText, ruleSummary, ruleWhat } from '../lib/recurring-copy'
import { deleteRecurringRule, setRecurringRulePaused } from '../lib/storage'
import { useNow } from '../lib/use-now'
import { useRecurringRules } from '../lib/use-recurring-rules'
import { recurringAlertReach } from '../lib/recurring-push'
import { useRecurringPushRevision } from '../lib/use-recurring-push'
import Icon from './Icon'
import RecurringRuleEditor from './RecurringRuleEditor'
import BackButton from './ui/BackButton'
import Button from './ui/Button'

const SAGE = '#A9CFBE'

interface Props {
  onBack: () => void
}

type Mode = { name: 'list' } | { name: 'edit'; rule: RecurringRule; isNew: boolean }

function notificationsBlocked(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'denied'
}

/**
 * The street sweeping and weekly reminders view (T5a): every rule with its
 * next occurrence, and the editor to add, edit, pause or delete one. Each
 * rule can be added to the phone's calendar as a repeating event. Rules
 * live on this device only.
 */
export default function RecurringReminders({ onBack }: Props) {
  const { t, i18n } = useTranslation()
  const rules = useRecurringRules()
  // Re-render as the push sync (T5b) works out what each rule can do.
  useRecurringPushRevision()
  const now = useNow(30_000)
  const [mode, setMode] = useState<Mode>({ name: 'list' })
  const [saved, setSaved] = useState(false)
  const [calendar, setCalendar] = useState<Record<string, 'done' | 'error'>>({})
  const titleRef = useRef<HTMLHeadingElement>(null)

  // Moving between the list and the editor is a new screen: start reading at its title.
  useEffect(() => {
    titleRef.current?.focus()
  }, [mode.name])

  const addCalendar = async (rule: RecurringRule) => {
    try {
      const { downloadRecurringIcs } = await import('../lib/ics')
      downloadRecurringIcs(rule, t, i18n.language)
      setCalendar((c) => ({ ...c, [rule.id]: 'done' }))
    } catch (err) {
      console.warn('[recurring] calendar file failed:', err)
      setCalendar((c) => ({ ...c, [rule.id]: 'error' }))
    }
  }

  const togglePause = (rule: RecurringRule) => {
    try {
      setRecurringRulePaused(rule.id, !rule.paused)
    } catch (err) {
      console.warn('[recurring] could not pause:', err)
    }
  }

  const notes = (
    <div className="mt-6 space-y-2 text-xs leading-relaxed" style={{ color: SAGE }}>
      <p>{t('recurring.councilNote')}</p>
      <p>{t('recurring.reliability')}</p>
    </div>
  )

  if (mode.name === 'edit') {
    return (
      <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
        <BackButton onClick={() => setMode({ name: 'list' })}>
          {t('common.back')}
        </BackButton>
        <h2 ref={titleRef} tabIndex={-1} className="font-display text-3xl font-extrabold text-paper-50 mb-4 outline-none">
          {mode.isNew ? t('recurring.editTitleNew') : t('recurring.editTitle')}
        </h2>
        <div className="gf-card bg-white p-5">
          <RecurringRuleEditor
            // A fresh editor per rule, so its draft starts from that rule.
            key={mode.rule.id}
            initial={mode.rule}
            isNew={mode.isNew}
            onSaved={() => {
              setSaved(true)
              // An edit changes the calendar event: the next download is a new file.
              setCalendar((c) => {
                const next = { ...c }
                delete next[mode.rule.id]
                return next
              })
              setMode({ name: 'list' })
            }}
            onCancel={() => setMode({ name: 'list' })}
            onDelete={(rule) => {
              try {
                deleteRecurringRule(rule.id)
              } catch (err) {
                console.warn('[recurring] could not delete:', err)
              }
              setSaved(false)
              setMode({ name: 'list' })
            }}
          />
        </div>
        {notes}
      </div>
    )
  }

  const blocked = rules.some((r) => r.push && !r.paused) && notificationsBlocked()

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <BackButton onClick={onBack}>
        {t('common.backToHome')}
      </BackButton>
      <h2 ref={titleRef} tabIndex={-1} className="font-display text-3xl font-extrabold text-paper-50 mb-1 outline-none">
        {t('recurring.title')}
      </h2>
      <p className="text-sm mb-6 leading-relaxed" style={{ color: SAGE }}>
        {t('recurring.intro')}
      </p>

      <p role="status" aria-live="polite" className={saved ? 'mb-4 text-sm font-semibold text-[#7BE3A4]' : 'sr-only'}>
        {saved ? t('recurring.saved') : ''}
      </p>

      {blocked && (
        <p role="alert" className="mb-4 text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 leading-relaxed">
          {t('recurring.notifyDenied')}
        </p>
      )}

      {rules.length === 0 ? (
        <div className="gf-card bg-white p-6 text-center">
          <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto mb-3">
            <Icon name="repeat" className="w-6 h-6" />
          </div>
          <p className="text-ink-900 font-display font-bold">{t('recurring.empty')}</p>
          <p className="text-xs text-ink-600 mt-1 leading-relaxed">{t('recurring.emptyHelp')}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {rules.map((rule) => {
            const what = ruleWhat(rule, t)
            const cal = calendar[rule.id]
            // What this phone can do for the rule. The "can't alert" line is
            // left out while the blocked banner above already says so.
            const reach = recurringAlertReach(rule, t)
            const reachLine =
              reach === 'closed'
                ? t('recurring.pushStatus.closed')
                : reach === 'open_only'
                  ? t('recurring.pushStatus.openOnly')
                  : reach === 'none' && !blocked
                    ? t('recurring.pushStatus.none')
                    : null
            return (
              <li key={rule.id} className="gf-card bg-white p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                    <Icon name="repeat" className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display font-bold text-ink-900 break-words">{what}</h3>
                    <p className="text-xs text-ink-700 mt-0.5 leading-relaxed">{ruleSummary(rule, t, i18n.language)}</p>
                    {rule.address && <p className="text-xs text-ink-600 mt-0.5 break-words">{rule.address}</p>}
                    <p className={`text-xs font-semibold mt-1 ${rule.paused ? 'text-ink-600' : 'text-brand-700'}`}>
                      {ruleStatusText(rule, now, t)}
                    </p>
                    {reachLine && (
                      <p
                        className={`text-xs mt-1 leading-relaxed ${
                          reach === 'closed' ? 'text-brand-700' : reach === 'none' ? 'text-amber-800 font-semibold' : 'text-ink-600'
                        }`}
                      >
                        {reachLine}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="min-h-[44px] px-4"
                    aria-label={`${t('common.edit')}: ${what}`}
                    onClick={() => {
                      setSaved(false)
                      setMode({ name: 'edit', rule, isNew: false })
                    }}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-[44px] px-4"
                    aria-label={`${rule.paused ? t('recurring.resume') : t('recurring.pause')}: ${what}`}
                    onClick={() => togglePause(rule)}
                  >
                    {rule.paused ? t('recurring.resume') : t('recurring.pause')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-[44px] px-4"
                    aria-label={`${t('recurring.calendar')}: ${what}`}
                    onClick={() => void addCalendar(rule)}
                  >
                    {t('recurring.calendar')}
                  </Button>
                </div>
                {rule.paused && <p className="text-xs text-ink-600 mt-2 leading-relaxed">{t('recurring.pausedHint')}</p>}
                {cal && (
                  <p role="status" className={`text-xs mt-2 font-medium ${cal === 'done' ? 'text-brand-700' : 'text-accent-700'}`}>
                    {cal === 'done' ? t('recurring.calendarDone') : t('reminders.calendarError')}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <Button
        className="w-full mt-4 min-h-[44px]"
        onClick={() => {
          setSaved(false)
          setMode({ name: 'edit', rule: blankRule({ timezone: deviceTimeZone(), address: null, now: Date.now() }), isNew: true })
        }}
      >
        {t('recurring.add')}
      </Button>

      {notes}
    </div>
  )
}
