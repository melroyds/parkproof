import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { BoundaryAnswer } from '../types'
import { boundaryOptions, type StretchCheck } from '../lib/workday'
import { stopDeadlinePassed, type StopOutcome } from '../lib/workday-boundary'
import { formatInZone, isSameDayInZone, zoneNameInZone } from '../lib/time-format'
import Icon from './Icon'
import Button from './ui/Button'

/** Each answer's option label (T6b item 8, the spec's wording). */
const OPTION_KEYS: Record<Exclude<BoundaryAnswer, 'not_asked'>, string> = {
  opposite_direction_sign: 'workday.boundary.option.oppositeDirectionSign',
  yellow_edge_line: 'workday.boundary.option.yellowEdgeLine',
  t_intersection_or_dead_end: 'workday.boundary.option.tIntersectionOrDeadEnd',
  left_parking_area: 'workday.boundary.option.leftParkingArea',
  not_sure: 'workday.boundary.option.notSure',
}

/** What the driver said they passed, for "you passed {{boundary}}". */
const PASSED_KEYS: Partial<Record<BoundaryAnswer, string>> = {
  opposite_direction_sign: 'workday.boundary.passed.oppositeDirectionSign',
  yellow_edge_line: 'workday.boundary.passed.yellowEdgeLine',
  t_intersection_or_dead_end: 'workday.boundary.passed.tIntersectionOrDeadEnd',
  left_parking_area: 'workday.boundary.passed.leftParkingArea',
}

interface Props {
  /** The same-stretch check that asks (T6a's sameStretchCheck). */
  check: StretchCheck
  /** The answer picked so far, or null. */
  answer: BoundaryAnswer | null
  onAnswer: (answer: BoundaryAnswer) => void
  /** The stop's limit for the answer picked (null until one is). */
  outcome: StopOutcome | null
  /** The answer starts the stop's own limit ("New limit based on what you told us"). */
  startsNewLimit: boolean
  /** Save was tapped without an answer: say so. */
  required: boolean
  /** The "I'm not sure" option, focused by default and again when Save is blocked. */
  notSureRef: RefObject<HTMLInputElement | null>
  /** The stop's time zone, for the times the lines name. */
  timeZone: string
  now: number
  disabled?: boolean
  /** "Save anyway", once the time on this stretch has already ended. */
  onSaveAnyway: () => void
  /** "Don't save this stop": deletes the draft and its photos, signs nothing. */
  onDontSave: () => void
}

/**
 * The boundary question in the logger (build spec T6b item 8): the only
 * step that may block Save. Moving a few bays doesn't restart a time limit
 * (Road Rules r205(2), r332); under an area sign the car must leave the
 * whole area (r335). The app can't see where a signed length of road ends,
 * so it asks, and the answer is recorded as the driver's own statement.
 * Nothing is picked for the driver: "I'm not sure" is focused (never
 * checked) when the question first shows, and again when Save is tapped
 * without an answer, and it keeps the original limit running.
 */
export default function BoundaryQuestion({
  check,
  answer,
  onAnswer,
  outcome,
  startsNewLimit,
  required,
  notSureRef,
  timeZone,
  now,
  disabled = false,
  onSaveAnyway,
  onDontSave,
}: Props) {
  const { t } = useTranslation()
  const area = check.area_mode
  const options = boundaryOptions(check).filter((a): a is Exclude<BoundaryAnswer, 'not_asked'> => a !== 'not_asked')
  // Absolute times in the stop's zone: with the day when it isn't today, and
  // the zone's name when a daylight saving change falls in between.
  const at = (iso: string) =>
    formatInZone(iso, timeZone, {
      withDate: !isSameDayInZone(iso, now, timeZone),
      withZone: zoneNameInZone(iso, timeZone) !== zoneNameInZone(now, timeZone),
    })
  // The time the car has to move by: the stop's saved expiry (the stretch
  // deadline, or the new sign's own limit when that ends first), so the line
  // names the same time the record, the card and the reminders use.
  const moveBy = outcome?.move_by ?? null
  const passed = stopDeadlinePassed(answer, startsNewLimit, outcome)

  let afterLine: string | null = null
  if (answer && outcome) {
    const passedKey = PASSED_KEYS[answer]
    if (startsNewLimit && passedKey) {
      afterLine = t('workday.boundary.newLimit', { boundary: t(passedKey) })
    } else if (!startsNewLimit && !passed && outcome.stretch_start) {
      const start = at(outcome.stretch_start)
      afterLine = moveBy
        ? t(area ? 'workday.boundary.notSureArea' : 'workday.boundary.notSure', {
            start,
            deadline: at(moveBy),
          })
        : t(area ? 'workday.boundary.notSureNoDeadlineArea' : 'workday.boundary.notSureNoDeadline', { start })
    }
  }

  return (
    <section className="mb-3" aria-labelledby="boundary-question-title" data-testid="boundary-question">
      <div className="gf-card bg-white p-4">
        <fieldset disabled={disabled} aria-describedby="boundary-question-footer">
          <legend id="boundary-question-title" className="font-display font-bold text-ink-900 leading-snug">
            {area ? t('workday.boundary.area') : t('workday.boundary.title')}
          </legend>
          {!area && <p className="text-sm text-ink-700 mt-1 leading-relaxed">{t('workday.boundary.body')}</p>}
          <div className="mt-3 flex flex-col gap-2">
            {options.map((option) => {
              const checked = answer === option
              return (
                <label
                  key={option}
                  className={`flex items-start gap-3 min-h-[44px] rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${
                    checked ? 'border-brand-500 bg-brand-50' : 'border-paper-300 bg-white hover:border-brand-300'
                  }`}
                >
                  <input
                    ref={option === 'not_sure' ? notSureRef : undefined}
                    type="radio"
                    name="workday-boundary"
                    value={option}
                    checked={checked}
                    onChange={() => onAnswer(option)}
                    className="mt-1 w-4 h-4 shrink-0 accent-brand-500"
                  />
                  <span className="text-sm text-ink-900 leading-relaxed">{t(OPTION_KEYS[option])}</span>
                </label>
              )
            })}
          </div>
        </fieldset>
        <p id="boundary-question-footer" className="text-xs text-ink-600 mt-3 leading-relaxed">
          {t('workday.boundary.footer')}
        </p>
        {required && !answer && (
          <p role="alert" className="mt-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {t('workday.boundary.required')}
          </p>
        )}
        <div role="status" aria-live="polite">
          {afterLine && <p className="mt-3 text-sm font-semibold text-ink-900 leading-relaxed">{afterLine}</p>}
        </div>
        {passed && (
          <div role="alert" className="mt-3 rounded-xl bg-amber-50 border border-amber-300 p-3">
            <p className="flex items-start gap-2 text-sm font-semibold text-ink-900 leading-relaxed">
              <Icon name="warning" className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <span>
                {t(area ? 'workday.boundary.passedDeadlineArea' : 'workday.boundary.passedDeadline', {
                  time: at(moveBy!),
                })}
              </span>
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Button variant="outline" onClick={onSaveAnyway} disabled={disabled} className="w-full min-h-[44px]">
                {t('workday.boundary.saveAnyway')}
              </Button>
              <Button variant="outline" onClick={onDontSave} disabled={disabled} className="w-full min-h-[44px]">
                {t('workday.boundary.dontSave')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

