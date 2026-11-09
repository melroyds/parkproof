import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingRules } from '../types'
import { signIssuesOf } from '../lib/sign-result'
import Icon from './Icon'
import Button from './ui/Button'
import BackButton from './ui/BackButton'
import Card from './ui/Card'

interface Props {
  /** The answer, with sign_status 'missing' or 'not_a_parking_sign'. */
  result: ParkingRules
  /** The photo the driver took. */
  signPhoto: string
  onRetake: () => void
  /** Log the park without a sign; the photo is kept as the surroundings photo. */
  onLogWithoutSign: () => void
  onBack: () => void
  /**
   * A workday stop's scan (build spec T6b item 7): stops need a readable
   * sign, so the only actions are "Retake photo" and "End workday" (this),
   * and the screen says why. "Log without a sign" isn't offered.
   */
  onEndWorkday?: () => void
}

/**
 * The screen for a photo in which the sign reader found no readable parking
 * sign (build spec T3 item 6). There is no answer to show: "no posted
 * restriction in the photo" is not "you can park here", and not "there are
 * no rules here", so the screen says that general road rules still apply.
 * The driver retakes the photo or logs the park without a sign.
 */
export default function NoReadableSign({ result, signPhoto, onRetake, onLogWithoutSign, onBack, onEndWorkday }: Props) {
  const { t } = useTranslation()
  // The model's notes on what the photo shows instead (its own words).
  const notes = signIssuesOf(result)
  // Focus the heading on this route-like change so a screen reader reads the
  // outcome first, as the result screen does with its verdict.
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      {/* BackButton owns its colour (sage on the vault); no text colour here. */}
      <BackButton onClick={onBack}>
        {t('common.back')}
      </BackButton>

      <div className="gf-card-lg p-8 bg-white">
        <div className="flex justify-center mb-3">
          <div className="w-20 h-20 rounded-full flex items-center justify-center bg-amber-50 text-amber-700">
            <Icon name="warning" className="w-12 h-12" strokeWidth={2.5} />
          </div>
        </div>
        <h2
          ref={headingRef}
          tabIndex={-1}
          aria-describedby="no-readable-sign-body"
          className="font-display text-3xl font-extrabold tracking-tight leading-tight text-ink-900 text-center outline-none"
        >
          {t('unclearSign.noSignTitle')}
        </h2>
        <p id="no-readable-sign-body" className="mt-4 text-sm text-ink-700 leading-relaxed">
          {onEndWorkday ? t('workday.noSign.body') : t('unclearSign.noSignBody')}
        </p>
      </div>

      {notes.length > 0 && (
        <Card className="mt-4" pad="sm">
          <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-600 mb-1.5">
            {t('unclearSign.notesLabel')}
          </h3>
          <ul className="list-disc pl-5 space-y-0.5 text-sm text-ink-900">
            {notes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </Card>
      )}

      <img
        src={signPhoto}
        alt={t('unclearSign.photoAlt')}
        className="w-full rounded-lg mt-4 border border-white/10 object-contain max-h-[32vh] bg-white"
      />

      <div className="mt-6 flex flex-col gap-2">
        <Button onClick={onRetake}>
          <Icon name="camera" className="w-5 h-5 mr-2" />
          {t('unclearSign.retake')}
        </Button>
        {onEndWorkday ? (
          <Button variant="outline" onClick={onEndWorkday}>
            {t('workday.card.end')}
          </Button>
        ) : (
          <Button variant="outline" onClick={onLogWithoutSign}>
            {t('unclearSign.logWithoutSign')}
          </Button>
        )}
      </div>
    </div>
  )
}
