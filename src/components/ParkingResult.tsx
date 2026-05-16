import { useState } from 'react'
import type { ParkingRules } from '../types'
import Icon from './Icon'
import { submitFeedback } from '../lib/feedback'
import { useNow } from '../lib/use-now'
import { formatCountdown } from '../lib/countdown'
import { formatExpiryAbsolute } from '../lib/time-format'
import { timezoneForCoords } from '../lib/timezone'

interface Props {
  result: ParkingRules
  signPhoto: string
  /** Coords from the scan that produced this result — used to pin the displayed timezone. */
  coords: { lat: number; lng: number } | null
  onScanAnother: () => void
  onLogSession: () => void
  onRetake: () => void
}

function formatUntil(iso: string | null, timeZone: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  // Returns "10:00 am" when expiry is today, "10:00 am, Mon 18/05/2026"
  // when it's a future day — disambiguates 33h-away signs (until 10am
  // could be tomorrow OR Monday, the user shouldn't have to do the math).
  return formatExpiryAbsolute(d, { timeZone }).combined
}

const URGENCY_STYLE = {
  normal: 'text-white/85',
  warning: 'text-white font-semibold',
  urgent: 'text-white font-bold',
  expired: 'text-white font-extrabold uppercase tracking-widest',
} as const

const CONFIDENCE_LABEL = {
  low: { dot: 'bg-amber-400', text: 'Low confidence' },
  medium: { dot: 'bg-accent-400', text: 'Medium confidence' },
  high: { dot: 'bg-brand-500', text: 'High confidence' },
} as const

export default function ParkingResult({
  result,
  signPhoto,
  coords,
  onScanAnother,
  onLogSession,
  onRetake,
}: Props) {
  const [verified, setVerified] = useState(false)
  // One id per rendering of the result — used to dedupe feedback events server-side
  // without storing anything identifiable.
  const [feedbackId] = useState(() => crypto.randomUUID())
  const now = useNow()
  const { observations, can_park_now, until, confidence, chosen_label, next_transition } =
    result
  const timeZone = timezoneForCoords(coords?.lat, coords?.lng)
  const untilLabel = formatUntil(until, timeZone)
  const countdown =
    can_park_now && until ? formatCountdown(new Date(until).getTime() - now) : null
  const confidenceMeta = CONFIDENCE_LABEL[confidence] ?? CONFIDENCE_LABEL.low

  // Surface the transition banner only when the AI returned one AND it's
  // actually in the near future. Server is told ≤3h but we add a client-side
  // sanity guard in case it returns a stale or duplicate transition.
  const transitionLabel = (() => {
    if (!next_transition) return null
    const whenMs = new Date(next_transition.when).getTime()
    if (!Number.isFinite(whenMs)) return null
    const minutesAway = Math.round((whenMs - now) / 60_000)
    if (minutesAway <= 0 || minutesAway > 180) return null
    return formatUntil(next_transition.when, timeZone)
  })()

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      {/* Answer card — semantic green/red, kept */}
      <div
        className={`rounded-3xl p-8 text-center text-white shadow-xl ${
          can_park_now
            ? 'bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-emerald-600/30'
            : 'bg-gradient-to-br from-red-600 to-red-800 shadow-red-600/30'
        }`}
      >
        <div className="flex justify-center mb-3">
          <div className="w-20 h-20 rounded-full bg-white/15 flex items-center justify-center">
            <Icon name={can_park_now ? 'check' : 'warning'} className="w-12 h-12" strokeWidth={2.5} />
          </div>
        </div>
        <h2 className="font-display text-3xl font-extrabold tracking-tight">
          {can_park_now ? 'You can park here' : "Don't park here"}
        </h2>
        {can_park_now && untilLabel && (
          <p className="text-white/90 text-lg mt-2 font-display font-semibold">
            Until {untilLabel}
          </p>
        )}
        {countdown && (
          <p className={`text-sm mt-1 ${URGENCY_STYLE[countdown.urgency]}`}>
            {countdown.label}
          </p>
        )}
      </div>

      {/* Transition-awareness banner — surfaces approaching rule changes so
          the user can make a smarter decision than "should I start parking
          now or wait 5 minutes for the restriction to lift". */}
      {next_transition && transitionLabel && (
        <div className="mt-4 bg-brand-50 border border-brand-200 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-500 text-white flex items-center justify-center shrink-0 mt-0.5">
            <Icon name="bell" className="w-4 h-4" strokeWidth={2.5} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">
              Heads up — at {transitionLabel}
            </p>
            <p className="text-sm text-ink-900 mt-1 leading-relaxed">
              {next_transition.change}
            </p>
          </div>
        </div>
      )}

      {/* On the sign */}
      <section className="mt-6 bg-white rounded-2xl p-5 border border-paper-300">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-display font-bold text-ink-900 text-sm uppercase tracking-widest">
            On the sign
          </h3>
          {chosen_label && (
            <span className="text-xs font-semibold text-accent-800 bg-accent-50 border border-accent-200 rounded-full px-2.5 py-1">
              {chosen_label}
            </span>
          )}
        </div>

        <div className="space-y-4">
          {observations.map((group, gi) => (
            <div key={gi}>
              {(observations.length > 1 || group.scope !== 'Whole sign') && (
                <h4 className="text-xs font-semibold text-ink-600 uppercase tracking-wide mb-1.5">
                  {group.scope}
                </h4>
              )}
              <ul className="space-y-1.5">
                {group.items.map((item, ii) => (
                  <li key={ii} className="flex gap-2 text-ink-900 text-base">
                    <span className="text-brand-400 select-none">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-5 pt-4 border-t border-paper-200">
          <span className={`w-2 h-2 rounded-full ${confidenceMeta.dot}`} />
          <span className="text-xs text-ink-600">{confidenceMeta.text}</span>
        </div>
      </section>

      {/* Verification card */}
      {verified ? (
        <p className="mt-4 text-center text-sm text-accent-700 font-medium inline-flex items-center justify-center gap-1.5">
          <Icon name="check" className="w-4 h-4" strokeWidth={2.5} />
          You confirmed the reading
        </p>
      ) : (
        <section className="mt-4 bg-accent-50 border border-accent-200 rounded-2xl p-5">
          <h3 className="font-display font-bold text-ink-900 mb-1">Did we read this right?</h3>
          <p className="text-sm text-ink-700 mb-4">
            Compare the bullets above to the actual sign before you leave the car.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                submitFeedback({ verdict: 'correct', feedback_id: feedbackId })
                setVerified(true)
              }}
              className="flex-1 bg-white border border-paper-300 hover:border-ink-600 text-ink-900 font-medium py-2.5 rounded-xl transition-colors"
            >
              Yes, looks right
            </button>
            <button
              onClick={() => {
                submitFeedback({ verdict: 'retake', feedback_id: feedbackId })
                onRetake()
              }}
              className="flex-1 bg-accent-600 hover:bg-accent-700 text-white font-semibold py-2.5 rounded-xl shadow-md shadow-accent-500/25 transition-colors"
            >
              Retake photo
            </button>
          </div>
        </section>
      )}

      {/* View the photo */}
      <details className="mt-4 bg-white rounded-2xl border border-paper-300 overflow-hidden">
        <summary className="px-5 py-3 text-sm font-medium text-ink-700 cursor-pointer select-none">
          View the photo
        </summary>
        <img src={signPhoto} alt="Scanned sign" className="w-full border-t border-paper-200" />
      </details>

      <div className="mt-6 flex flex-col gap-2">
        {can_park_now && (
          <button
            onClick={onLogSession}
            className="bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-semibold py-4 rounded-2xl shadow-lg shadow-brand-500/25 transition-colors"
          >
            Log this parking session
          </button>
        )}
        <button
          onClick={onScanAnother}
          className="bg-paper-200 hover:bg-paper-300 text-ink-900 font-medium py-3 rounded-2xl transition-colors"
        >
          Scan another sign
        </button>
      </div>
    </div>
  )
}
