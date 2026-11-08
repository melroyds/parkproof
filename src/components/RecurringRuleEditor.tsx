import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { RecurringFrequency, RecurringRule, Weekday } from '../types'
import {
  ADDRESS_MAX,
  DEFAULT_EVENING_TIME,
  DEFAULT_MINUTES_BEFORE,
  LABEL_MAX,
  MINUTES_BEFORE_OPTIONS,
  NTH_VALUES,
  RECURRING_FREQUENCIES,
  RECURRING_KINDS,
  WEEKDAYS,
  nextDateOnDays,
  todayInZone,
} from '../lib/recurring'
import { dayName, zonePlace } from '../lib/recurring-copy'
import { ensureReminderPermission, type ReminderPermission } from '../lib/recurring-reminders'
import { registerForRecurringPush } from '../lib/recurring-push'
import { isStorageFullError, saveRecurringRule } from '../lib/storage'
import Button from './ui/Button'
import Input from './ui/Input'

interface Props {
  /** The rule to edit, or a new rule's starting values. */
  initial: RecurringRule
  isNew: boolean
  /** Shown above the form when the values came from a sign reading. */
  intro?: ReactNode
  /** Called with the stored rule, and the notification permission when notifications are on. */
  onSaved: (rule: RecurringRule, permission: ReminderPermission | null) => void
  onCancel: () => void
  /** Edit mode only: delete the rule (the editor asks first). */
  onDelete?: (rule: RecurringRule) => void
}

type Problem = 'days' | 'times' | 'nth' | 'anchor'

/** What stops the draft being saved, if anything (the store checks again). */
function problemOf(rule: RecurringRule): Problem | null {
  if (rule.days.length === 0) return 'days'
  if (!/^\d{2}:\d{2}$/.test(rule.start) || !/^\d{2}:\d{2}$/.test(rule.end) || rule.start === rule.end) return 'times'
  if (rule.frequency === 'monthly_nth' && rule.nth.length === 0) return 'nth'
  if (rule.frequency === 'fortnightly' && !/^\d{4}-\d{2}-\d{2}$/.test(rule.anchor_date)) return 'anchor'
  return null
}

const LABEL_CLASS = 'block text-xs uppercase tracking-widest font-semibold text-ink-600 mb-2'
// A chip around a visually hidden native radio or checkbox: real form
// semantics and keyboard handling, with the focus ring drawn on the chip.
const CHIP_CLASS =
  'relative inline-flex items-center justify-center px-4 py-2.5 min-h-[44px] min-w-[44px] rounded-full text-sm font-semibold border-2 transition-colors cursor-pointer select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500 has-[:focus-visible]:ring-offset-2'
// A time or select beside its checkbox: the Input look, at its own width.
const INLINE_FIELD_CLASS =
  'bg-white text-ink-900 border border-paper-300 rounded-lg px-3 py-2.5 min-h-[44px] text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20'
const chipTone = (on: boolean) =>
  on ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-paper-300 text-ink-700 hover:border-brand-300'

/**
 * The weekly reminder editor (T5a), on a white surface: what it is, its
 * name, days, times, how often (every week, every second week from a date,
 * or some weeks of the month), where, when to be reminded, and whether to
 * notify on this phone. Used full screen in the recurring view and inside
 * the "Remind me every week" sheet. Save stores the rule (the store bumps
 * the calendar sequence on an edit) and asks for notification permission
 * first when notifications are on.
 */
export default function RecurringRuleEditor({ initial, isNew, intro, onSaved, onCancel, onDelete }: Props) {
  const { t } = useTranslation()
  const uid = useId()
  const [draft, setDraft] = useState<RecurringRule>(initial)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saving = useRef(false)

  const set = (patch: Partial<RecurringRule>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setSaveError(null)
  }
  const problem = problemOf(draft)

  const toggleDay = (day: Weekday) =>
    set({ days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : WEEKDAYS.filter((d) => d === day || draft.days.includes(d)) })
  const toggleNth = (n: number) =>
    set({ nth: draft.nth.includes(n) ? draft.nth.filter((x) => x !== n) : [...draft.nth, n].sort((a, b) => a - b) })
  const setFrequency = (frequency: RecurringFrequency) => {
    if (frequency === draft.frequency) return
    set({
      frequency,
      nth: frequency === 'monthly_nth' ? (draft.nth.length ? draft.nth : [1]) : [],
      // Every second week counts from a date the driver picks: the rule's
      // own when it already was fortnightly, else the next of the chosen
      // days. Leaving it goes back to the rule's own start date (today for
      // a rule that was fortnightly), so a date picked for the fortnight
      // can't hold back a weekly rule.
      anchor_date:
        frequency === 'fortnightly'
          ? initial.frequency === 'fortnightly'
            ? initial.anchor_date
            : nextDateOnDays(draft.days.length ? draft.days : WEEKDAYS, draft.timezone)
          : initial.frequency === 'fortnightly'
            ? todayInZone(draft.timezone)
            : initial.anchor_date,
    })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (problem || saving.current) return
    saving.current = true
    setBusy(true)
    try {
      const permission = draft.push ? await ensureReminderPermission() : null
      // Register this phone for push inside the same tap (T5b), so the
      // background sync can book the rule with the server and it alerts
      // even when ParkProof is closed. Not awaited: Save never waits on the
      // network, and without push the reminders still run while it's open.
      if (permission === 'granted') void registerForRecurringPush()
      const stored = saveRecurringRule(draft)
      onSaved(stored, permission)
    } catch (err) {
      console.warn('[recurring] could not save:', err)
      setSaveError(isStorageFullError(err) ? t('errors.storageFull') : t('recurring.errors.saveFailed'))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  const minuteOptions = [...new Set<number>([...MINUTES_BEFORE_OPTIONS, ...(draft.remind_minutes_before ? [draft.remind_minutes_before] : [])])].sort(
    (a, b) => a - b,
  )
  const minutesLabel = (m: number) =>
    m >= 60 && m % 60 === 0 ? t('recurring.remind.hours', { count: m / 60 }) : t('recurring.remind.minutes', { count: m })

  const showProblem = tried && problem !== null
  const errorId = `${uid}-error`

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {intro}

      <fieldset>
        <legend className={LABEL_CLASS}>{t('recurring.field.kind')}</legend>
        <div className="flex flex-wrap gap-2">
          {RECURRING_KINDS.map((kind) => (
            <label key={kind} className={`${CHIP_CLASS} ${chipTone(draft.kind === kind)}`}>
              <input
                type="radio"
                name={`${uid}-kind`}
                className="sr-only"
                checked={draft.kind === kind}
                onChange={() => set({ kind })}
              />
              {t(`recurring.kind.${kind}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${uid}-label`} className={LABEL_CLASS}>
          {t('recurring.field.label')}
        </label>
        <Input
          id={`${uid}-label`}
          value={draft.label}
          maxLength={LABEL_MAX}
          placeholder={t(`recurring.kind.${draft.kind}`)}
          onChange={(e) => set({ label: e.target.value })}
        />
      </div>

      <fieldset aria-describedby={showProblem && problem === 'days' ? errorId : undefined}>
        <legend className={LABEL_CLASS}>{t('recurring.field.days')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((day) => (
            <label key={day} className={`${CHIP_CLASS} px-3 ${chipTone(draft.days.includes(day))}`}>
              <input
                type="checkbox"
                className="sr-only"
                aria-label={dayName(day, t)}
                checked={draft.days.includes(day)}
                onChange={() => toggleDay(day)}
              />
              <span aria-hidden="true">{t(`recurring.daysShort.${day}`)}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${uid}-start`} className={LABEL_CLASS}>
            {t('recurring.field.start')}
          </label>
          <Input id={`${uid}-start`} type="time" required value={draft.start} onChange={(e) => set({ start: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${uid}-end`} className={LABEL_CLASS}>
            {t('recurring.field.end')}
          </label>
          <Input id={`${uid}-end`} type="time" required value={draft.end} onChange={(e) => set({ end: e.target.value })} />
        </div>
      </div>

      <fieldset>
        <legend className={LABEL_CLASS}>{t('recurring.field.frequency')}</legend>
        <div className="flex flex-wrap gap-2">
          {RECURRING_FREQUENCIES.map((frequency) => (
            <label key={frequency} className={`${CHIP_CLASS} ${chipTone(draft.frequency === frequency)}`}>
              <input
                type="radio"
                name={`${uid}-frequency`}
                className="sr-only"
                checked={draft.frequency === frequency}
                onChange={() => setFrequency(frequency)}
              />
              {t(`recurring.frequency.${frequency}`)}
            </label>
          ))}
        </div>
        {draft.frequency === 'fortnightly' && (
          <div className="mt-3">
            <label htmlFor={`${uid}-anchor`} className={LABEL_CLASS}>
              {t('recurring.field.anchor')}
            </label>
            <Input
              id={`${uid}-anchor`}
              type="date"
              required
              value={draft.anchor_date}
              onChange={(e) => set({ anchor_date: e.target.value })}
            />
          </div>
        )}
        {draft.frequency === 'monthly_nth' && (
          <fieldset className="mt-3">
            <legend className={LABEL_CLASS}>{t('recurring.field.nth')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {NTH_VALUES.map((n) => (
                <label key={n} className={`${CHIP_CLASS} px-3 ${chipTone(draft.nth.includes(n))}`}>
                  <input type="checkbox" className="sr-only" checked={draft.nth.includes(n)} onChange={() => toggleNth(n)} />
                  {t(`recurring.nth.n${n}`)}
                </label>
              ))}
            </div>
          </fieldset>
        )}
      </fieldset>

      <div>
        <label htmlFor={`${uid}-address`} className={LABEL_CLASS}>
          {t('recurring.field.address')}
        </label>
        <Input
          id={`${uid}-address`}
          value={draft.address ?? ''}
          maxLength={ADDRESS_MAX}
          placeholder={t('recurring.field.addressPlaceholder')}
          autoComplete="off"
          onChange={(e) => set({ address: e.target.value || null })}
        />
      </div>

      <fieldset>
        <legend className={LABEL_CLASS}>{t('recurring.field.remind')}</legend>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-3 min-h-[44px] text-sm text-ink-900 cursor-pointer">
              <input
                type="checkbox"
                className="w-5 h-5 accent-brand-500"
                checked={draft.remind_evening_before !== null}
                onChange={(e) => set({ remind_evening_before: e.target.checked ? DEFAULT_EVENING_TIME : null })}
              />
              {t('recurring.remind.evening')}
            </label>
            {draft.remind_evening_before !== null && (
              <input
                type="time"
                aria-label={t('recurring.remind.evening')}
                className={INLINE_FIELD_CLASS}
                value={draft.remind_evening_before}
                onChange={(e) => set({ remind_evening_before: e.target.value || DEFAULT_EVENING_TIME })}
              />
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-3 min-h-[44px] text-sm text-ink-900 cursor-pointer">
              <input
                type="checkbox"
                className="w-5 h-5 accent-brand-500"
                checked={draft.remind_minutes_before !== null}
                onChange={(e) => set({ remind_minutes_before: e.target.checked ? DEFAULT_MINUTES_BEFORE : null })}
              />
              {t('recurring.remind.before')}
            </label>
            {draft.remind_minutes_before !== null && (
              <select
                aria-label={t('recurring.remind.before')}
                value={draft.remind_minutes_before}
                onChange={(e) => set({ remind_minutes_before: Number(e.target.value) })}
                className={INLINE_FIELD_CLASS}
              >
                {minuteOptions.map((m) => (
                  <option key={m} value={m}>
                    {minutesLabel(m)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <label className="flex items-center gap-3 min-h-[44px] text-sm text-ink-900 cursor-pointer">
            <input
              type="checkbox"
              className="w-5 h-5 accent-brand-500"
              checked={draft.push}
              onChange={(e) => set({ push: e.target.checked })}
            />
            {t('recurring.field.push')}
          </label>
          <p className="text-xs text-ink-600 leading-relaxed">{t('recurring.pushHint')}</p>
        </div>
      </fieldset>

      <p className="text-xs text-ink-600 leading-relaxed">{t('recurring.zoneNote', { place: zonePlace(draft.timezone, t) })}</p>

      {(showProblem || saveError) && (
        <p id={errorId} role="alert" className="text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
          {saveError ?? t(`recurring.errors.${problem}`)}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={busy} className="w-full min-h-[44px]">
          {t('common.save')}
        </Button>
        <button
          type="button"
          onClick={onCancel}
          className="w-full min-h-[44px] text-sm font-medium text-ink-700 hover:text-ink-900 rounded-xl"
        >
          {t('common.cancel')}
        </button>
      </div>

      {!isNew && onDelete && (
        <div className="border-t border-paper-200 pt-4">
          {confirmDelete ? (
            <div role="group" aria-labelledby={`${uid}-delete-q`} className="flex flex-col gap-2">
              <p id={`${uid}-delete-q`} className="text-sm text-ink-900 leading-relaxed">
                {t('recurring.deleteConfirm')}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1 min-h-[44px]" onClick={() => setConfirmDelete(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="button" className="flex-1 min-h-[44px]" onClick={() => onDelete(initial)}>
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="w-full min-h-[44px] text-sm font-semibold text-accent-700 hover:text-accent-800 underline"
            >
              {t('recurring.delete')}
            </button>
          )}
        </div>
      )}
    </form>
  )
}
