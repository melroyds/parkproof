import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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

const CONFIDENCE_DOT = {
  low: 'bg-amber-400',
  medium: 'bg-accent-400',
  high: 'bg-brand-500',
} as const

/**
 * Snapshot the Layer-2 feedback context from a ParkingRules object. None of
 * the fields here identify a user — they're all model-output metadata about
 * the sign read itself. Kept as a pure function (no useMemo / hooks) so it
 * runs only when the user actually taps the verify buttons.
 */
function buildFeedbackContext(result: ParkingRules, ticketAcknowledged: boolean) {
  return {
    confidence: result.confidence,
    had_clarification:
      result.alternate_variants !== undefined &&
      result.alternate_variants !== null &&
      result.alternate_variants.length > 0,
    chosen_label: result.chosen_label ?? null,
    duration_minutes: result.duration_minutes,
    observations_count: result.observations?.length ?? 0,
    // First 120 chars only — enough to group similar sign-patterns in Logs
    // Insights queries without bloating CloudWatch storage.
    rules_excerpt: (result.rules ?? '').slice(0, 120),
    scanned_hour_local: new Date().getHours(),
    // Refresh-mode results have a marker rule prefix; cheaper than threading
    // the mode down from App.tsx and good enough for telemetry purposes.
    is_refresh: false,
    // Paid-parking signals — lets us slice retake rate by paid vs free signs
    // and see whether the acknowledgement gate is real friction or just noise.
    requires_ticket: !!result.requires_ticket,
    ticket_acknowledged: !!result.requires_ticket && ticketAcknowledged,
  }
}

/**
 * Map a model-emitted payment_methods array into the deep-link / hint shape
 * the UI consumes. Falls back to "show both apps as options" when paid is
 * detected but no specific method is named, on the assumption it's better to
 * offer the user something than nothing.
 */
function resolvePaymentActions(methods: string[] | null | undefined, requiresTicket: boolean) {
  const list = (methods ?? []).map((m) => m.toLowerCase())
  const has = (s: string) => list.includes(s)
  // "Unspecified" = paid required but the AI didn't pick out which method.
  const unspecified = requiresTicket && list.length === 0
  return {
    paystay: has('paystay') || unspecified,
    easypark: has('easypark') || unspecified,
    // Wilson / Care Park aren't ubiquitous enough to warrant top-level buttons,
    // but the meter / ticket-machine hint is the right fallback when only
    // physical methods are detected.
    meterOnly:
      !has('paystay') &&
      !has('easypark') &&
      (has('meter') || has('ticket machine') || has('pay-by-plate')),
  }
}

// Universal links — if the user has the app installed iOS/Android intercepts
// and opens it directly; otherwise the user lands on the marketing site.
// Easier to maintain than per-platform custom schemes (`paystay://`) that
// silently fail when the app isn't installed.
const PAYSTAY_URL = 'https://paystay.com.au/'
const EASYPARK_URL = 'https://easypark.net/'

const CONFIDENCE_KEY = {
  low: 'common.lowConfidence',
  medium: 'common.mediumConfidence',
  high: 'common.highConfidence',
} as const

export default function ParkingResult({
  result,
  signPhoto,
  coords,
  onScanAnother,
  onLogSession,
  onRetake,
}: Props) {
  const { t } = useTranslation()
  const [verified, setVerified] = useState(false)
  // Paid-parking acknowledgement — gates the "Save session" button when the
  // sign requires payment. Defaults false so the user has to deliberately
  // confirm; "yes I paid (or will pay before walking away)".
  const [ticketAcknowledged, setTicketAcknowledged] = useState(false)
  // One id per rendering of the result — used to dedupe feedback events server-side
  // without storing anything identifiable.
  const [feedbackId] = useState(() => crypto.randomUUID())
  const now = useNow()
  const {
    observations,
    can_park_now,
    until,
    confidence,
    chosen_label,
    next_transition,
    requires_ticket,
    payment_methods,
  } = result
  // Gate the Save button until the user acknowledges payment. Only meaningful
  // when can_park_now is true (we don't show Save at all when it's false).
  const mustPay = !!requires_ticket && can_park_now
  const blockedByPayGate = mustPay && !ticketAcknowledged
  const paymentActions = resolvePaymentActions(payment_methods, mustPay)
  const timeZone = timezoneForCoords(coords?.lat, coords?.lng)
  const untilLabel = formatUntil(until, timeZone)
  const countdown =
    can_park_now && until ? formatCountdown(new Date(until).getTime() - now) : null
  const confidenceDot = CONFIDENCE_DOT[confidence] ?? CONFIDENCE_DOT.low
  const confidenceText = t(CONFIDENCE_KEY[confidence] ?? CONFIDENCE_KEY.low)

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
          {can_park_now ? t('result.canPark') : t('result.cantPark')}
        </h2>
        {can_park_now && untilLabel && (
          <p className="text-white/90 text-lg mt-2 font-display font-semibold">
            {t('result.until', { when: untilLabel })}
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
              {t('result.transitionHeadsUp', { when: transitionLabel })}
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
            {t('result.onTheSign')}
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
          <span className={`w-2 h-2 rounded-full ${confidenceDot}`} />
          <span className="text-xs text-ink-600">{confidenceText}</span>
        </div>
      </section>

      {/* Verification card */}
      {verified ? (
        <p className="mt-4 text-center text-sm text-accent-700 font-medium inline-flex items-center justify-center gap-1.5">
          <Icon name="check" className="w-4 h-4" strokeWidth={2.5} />
          {t('result.verifyConfirmed')}
        </p>
      ) : (
        <section className="mt-4 bg-accent-50 border border-accent-200 rounded-2xl p-5">
          <h3 className="font-display font-bold text-ink-900 mb-1">{t('result.verifyHeader')}</h3>
          <p className="text-sm text-ink-700 mb-4">
            {t('result.verifyCopy')}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                // Layer-2 context: enough metadata to slice failures by mode
                // (high-confidence-but-wrong, stacked sign, night scan) without
                // any PII. The feedback_id is a per-render UUID that ties this
                // event to nothing user-identifiable.
                submitFeedback({
                  verdict: 'correct',
                  feedback_id: feedbackId,
                  context: buildFeedbackContext(result, ticketAcknowledged),
                })
                setVerified(true)
              }}
              className="flex-1 bg-white border border-paper-300 hover:border-ink-600 text-ink-900 font-medium py-2.5 rounded-xl transition-colors"
            >
              {t('result.verifyYes')}
            </button>
            <button
              onClick={() => {
                submitFeedback({
                  verdict: 'retake',
                  feedback_id: feedbackId,
                  context: buildFeedbackContext(result, ticketAcknowledged),
                })
                onRetake()
              }}
              className="flex-1 bg-accent-600 hover:bg-accent-700 text-white font-semibold py-2.5 rounded-xl shadow-md shadow-accent-500/25 transition-colors"
            >
              {t('result.verifyRetake')}
            </button>
          </div>
        </section>
      )}

      {/* View the photo */}
      <details className="mt-4 bg-white rounded-2xl border border-paper-300 overflow-hidden">
        <summary className="px-5 py-3 text-sm font-medium text-ink-700 cursor-pointer select-none">
          {t('result.viewPhoto')}
        </summary>
        <img src={signPhoto} alt={t('clarify.imageAlt')} className="w-full border-t border-paper-200" />
      </details>

      {/* Pay-required gate — surfaces when the AI detected paid parking AND
          the current time is inside the paid window. Two jobs: (1) make the
          requirement impossible to miss, (2) actively help the user pay it.
          The Save button below is disabled until the checkbox is ticked. */}
      {mustPay && (
        <section className="mt-4 bg-amber-50 border-2 border-amber-400 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0 mt-0.5">
              <Icon name="warning" className="w-4 h-4" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                {t('result.payRequired.kicker')}
              </p>
              <h3 className="font-display font-bold text-ink-900 mt-1">
                {t('result.payRequired.header')}
              </h3>
              <p className="text-sm text-ink-700 mt-1 leading-relaxed">
                {t('result.payRequired.copy')}
              </p>
            </div>
          </div>

          {(paymentActions.paystay || paymentActions.easypark) && (
            <div className="mt-4 flex gap-2">
              {paymentActions.paystay && (
                <a
                  href={PAYSTAY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-white border-2 border-amber-400 hover:bg-amber-100 text-ink-900 font-semibold py-2.5 rounded-xl transition-colors text-sm"
                >
                  {t('result.payRequired.openPaystay')}
                </a>
              )}
              {paymentActions.easypark && (
                <a
                  href={EASYPARK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-white border-2 border-amber-400 hover:bg-amber-100 text-ink-900 font-semibold py-2.5 rounded-xl transition-colors text-sm"
                >
                  {t('result.payRequired.openEasypark')}
                </a>
              )}
            </div>
          )}

          {paymentActions.meterOnly && (
            <p className="mt-3 text-sm text-ink-700 leading-relaxed">
              {t('result.payRequired.meterHint')}
            </p>
          )}

          <label className="mt-4 flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={ticketAcknowledged}
              onChange={(e) => setTicketAcknowledged(e.target.checked)}
              className="mt-0.5 w-5 h-5 rounded border-2 border-amber-500 accent-amber-600 cursor-pointer shrink-0"
            />
            <span className="text-sm font-medium text-ink-900 leading-tight">
              {t('result.payRequired.ack')}
            </span>
          </label>
        </section>
      )}

      <div className="mt-6 flex flex-col gap-2">
        {can_park_now && (
          <button
            onClick={onLogSession}
            disabled={blockedByPayGate}
            className="bg-brand-500 hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-300 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-2xl shadow-lg shadow-brand-500/25 disabled:shadow-none transition-colors"
          >
            {blockedByPayGate ? t('result.logCtaBlocked') : t('result.logCta')}
          </button>
        )}
        <button
          onClick={onScanAnother}
          className="bg-paper-200 hover:bg-paper-300 text-ink-900 font-medium py-3 rounded-2xl transition-colors"
        >
          {t('result.scanAnother')}
        </button>
      </div>
    </div>
  )
}
