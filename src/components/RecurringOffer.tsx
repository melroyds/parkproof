import { useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { ParkingSession, RecurringRestriction, RecurringRule } from '../types'
import { recurringRestrictionsOf, ruleFromRestriction, sameSchedule } from '../lib/recurring'
import { ruleSummary, ruleWhat } from '../lib/recurring-copy'
import { recurringAlertReach } from '../lib/recurring-push'
import { sessionTimezone } from '../lib/timezone'
import { useModalFocus } from '../lib/use-modal-focus'
import { useRecurringPushRevision } from '../lib/use-recurring-push'
import { useRecurringRules } from '../lib/use-recurring-rules'
import Icon from './Icon'
import RecordPhoto from './RecordPhoto'
import RecurringRuleEditor from './RecurringRuleEditor'
import Button from './ui/Button'
import Card from './ui/Card'

/** At most this many weekly restrictions are offered from one sign. */
const MAX_OFFERED = 3

interface Props {
  /** The record just saved: its weekly restrictions (from T3's sign reading) and its place. */
  session: ParkingSession
  className?: string
}

/**
 * "Remind me every week" on the remind screen (T5a), shown only when the
 * saved record has weekly restrictions read from the sign (street
 * sweeping, a clearway). Each opens a sheet with the editor prefilled from
 * that restriction, asking the driver to check the days and times against
 * the sign before saving. Once saved, the card offers the calendar file.
 */
export default function RecurringOffer({ session, className = 'mb-3' }: Props) {
  const { t, i18n } = useTranslation()
  const uid = useId()
  const restrictions = useMemo(() => recurringRestrictionsOf(session).slice(0, MAX_OFFERED), [session])
  // A driver who parks here every week already has the reminder: say so
  // rather than offering a second copy.
  const rules = useRecurringRules()
  // Re-render as the push sync (T5b) works out what a saved rule can do here.
  useRecurringPushRevision()
  const [open, setOpen] = useState<number | null>(null)
  const [saved, setSaved] = useState<Record<number, RecurringRule>>({})
  const [calendar, setCalendar] = useState<Record<number, 'done' | 'error'>>({})
  // Prefilled rules for the summaries, made once per record (each has its own id).
  const timezone = useMemo(() => sessionTimezone(session.location), [session.location])
  // The sign reading's free-text label is written in English, so it only
  // names the reminder for an English reader. Everyone else gets the
  // translated kind ("Street sweeping") in the card, notifications and
  // calendar, and can type a name of their own.
  const englishUi = (i18n.resolvedLanguage ?? i18n.language ?? 'en').toLowerCase().startsWith('en')
  // When the card first showed: the prefilled rules' start date.
  const [openedAt] = useState(() => Date.now())
  const prefills = useMemo(
    () =>
      restrictions.map((r) =>
        ruleFromRestriction(r, {
          timezone,
          address: session.location?.address ?? null,
          now: openedAt,
          labelFromSign: englishUi,
        }),
      ),
    [restrictions, timezone, session.location?.address, englishUi, openedAt],
  )
  const savedId = (i: number) => `${uid}-saved-${i}`

  if (restrictions.length === 0) return null

  const addCalendar = async (i: number, rule: RecurringRule) => {
    try {
      const { downloadRecurringIcs } = await import('../lib/ics')
      downloadRecurringIcs(rule, t, i18n.language)
      setCalendar((c) => ({ ...c, [i]: 'done' }))
    } catch (err) {
      console.warn('[recurring] calendar file failed:', err)
      setCalendar((c) => ({ ...c, [i]: 'error' }))
    }
  }

  return (
    <Card className={className}>
      <div className="flex items-start gap-3 mb-3">
        <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
          <Icon name="repeat" className="w-6 h-6" />
        </div>
        <div>
          <h3 className="font-display font-bold text-ink-900">{t('recurring.offer.heading')}</h3>
          <p className="text-xs text-ink-600 mt-1 leading-relaxed">{t('recurring.offer.body')}</p>
        </div>
      </div>
      <ul className="flex flex-col gap-3">
        {prefills.map((rule, i) => {
          const what = ruleWhat(rule, t)
          const done = saved[i] ?? rules.find((r) => sameSchedule(r, rule))
          // What the saved reminder can actually do on this phone (T5b).
          const reach = done ? recurringAlertReach(rules.find((r) => r.id === done.id) ?? done, t) : null
          return (
            <li key={rule.id}>
              <p className="text-sm text-ink-900 leading-relaxed mb-2">
                {t('recurring.offer.line', { what, summary: ruleSummary(rule, t, i18n.language) })}
              </p>
              {done ? (
                <>
                  <p
                    id={savedId(i)}
                    role="status"
                    tabIndex={-1}
                    className="text-sm font-semibold text-brand-700 flex items-center gap-1.5 mb-2 outline-none"
                  >
                    <Icon name="check" className="w-4 h-4" strokeWidth={2.5} />
                    {saved[i] ? t('recurring.saved') : t('recurring.offer.already')}
                  </p>
                  {reach === 'none' && (
                    <p className="text-xs font-semibold text-amber-800 leading-relaxed mb-2">{t('recurring.pushStatus.none')}</p>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full min-h-[44px]"
                    aria-label={`${t('recurring.calendar')}: ${ruleWhat(done, t)}`}
                    onClick={() => void addCalendar(i, done)}
                  >
                    {calendar[i] === 'done' ? t('recurring.calendarDone') : t('recurring.calendar')}
                  </Button>
                  {calendar[i] === 'error' && (
                    <p role="alert" className="text-xs mt-2 text-accent-700">
                      {t('reminders.calendarError')}
                    </p>
                  )}
                </>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full min-h-[44px]"
                  aria-label={restrictions.length > 1 ? `${t('recurring.offer.cta')}: ${what}` : undefined}
                  onClick={() => setOpen(i)}
                >
                  {t('recurring.offer.cta')}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {open !== null && (
        <RecurringSheet
          session={session}
          restriction={restrictions[open]}
          initial={prefills[open]}
          onClose={() => setOpen(null)}
          // Saving swaps the button that opened the sheet for the saved
          // line, so focus lands there instead of dropping to <body>.
          returnFocus={() => document.getElementById(savedId(open))}
          onSaved={(rule) => {
            setSaved((s) => ({ ...s, [open]: rule }))
            setOpen(null)
          }}
        />
      )}
    </Card>
  )
}

interface SheetProps {
  session: ParkingSession
  restriction: RecurringRestriction
  initial: RecurringRule
  onClose: () => void
  onSaved: (rule: RecurringRule) => void
  /** Where focus goes on close when the button that opened the sheet is gone. */
  returnFocus: () => HTMLElement | null
}

/**
 * The "Remind me every week" sheet: the sign photo, "Check these days and
 * times against the sign", and the editor prefilled from the sign reading.
 * Modal like the feedback and departure sheets: focus starts on the title
 * and stays inside, Escape and a tap outside close it without saving.
 *
 * Rendered into document.body: the card it opens from is a .gf-card, whose
 * `filter` makes the card the containing block of a `position: fixed` child
 * and whose `clip-path` would cut the sheet down to the card's shape.
 */
function RecurringSheet({ session, restriction, initial, onClose, onSaved, returnFocus }: SheetProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useModalFocus(dialogRef, { initialFocus: titleRef, onEscape: onClose, returnFocus })

  return createPortal(
    <div
      ref={dialogRef}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recurring-sheet-title"
      aria-describedby="recurring-sheet-check"
    >
      <div className="bg-white gf-card max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2
            id="recurring-sheet-title"
            ref={titleRef}
            tabIndex={-1}
            className="font-display text-2xl font-extrabold text-ink-900 outline-none"
          >
            {t('recurring.sheet.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="text-ink-600 hover:text-ink-800 -mt-1 -mr-2 text-xl leading-none min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <RecurringRuleEditor
          initial={initial}
          isNew
          intro={
            <div className="flex flex-col gap-3">
              <p
                id="recurring-sheet-check"
                className="flex items-start gap-2 text-sm font-semibold text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 leading-relaxed"
              >
                <Icon name="warning" className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t('recurring.sheet.check')}</span>
              </p>
              <RecordPhoto
                session={session}
                role="sign"
                alt={t('session.signPhotoAlt')}
                className="w-full max-h-48 object-contain rounded-xl border border-paper-300 bg-paper-50"
              />
              {restriction.exceptions_text && (
                <p className="text-xs text-ink-700 leading-relaxed">
                  {t('recurring.sheet.signSays', { text: restriction.exceptions_text })}
                </p>
              )}
            </div>
          }
          onSaved={(rule) => onSaved(rule)}
          onCancel={onClose}
        />
        <div className="mt-5 space-y-2 text-xs text-ink-600 leading-relaxed">
          <p>{t('recurring.councilNote')}</p>
          <p>{t('recurring.reliability')}</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
