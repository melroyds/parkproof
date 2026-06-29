import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingRules } from '../types'
import Icon from './Icon'
import Button from './ui/Button'
import Card from './ui/Card'
import VerifiedSeal from './VerifiedSeal'
import { submitFeedback } from '../lib/feedback'
import { PARKING_APPS, launchUrlFor, type ParkingApp } from '../lib/parking-apps'
import { useNow } from '../lib/use-now'
import { formatCountdownLocalized } from '../lib/countdown'
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
  /**
   * True on the user's first-ever scan (no saved sessions yet). Surfaces the
   * evidence-chain payoff beside the save CTA so a first-timer understands why
   * a free, anonymous user would bother saving.
   */
  isFirstSave?: boolean
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
  normal: 'text-ink-600',
  warning: 'text-ink-700 font-semibold',
  urgent: 'text-brand-700 font-bold',
  expired: 'text-red-700 font-extrabold uppercase tracking-widest',
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
function buildFeedbackContext(
  result: ParkingRules,
  ticketAcknowledged: boolean,
  disabledAcknowledged: boolean,
  permitZoneAcknowledged: boolean,
) {
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
    // The model's detected payment methods — surfaced ALWAYS, not just when
    // requires_ticket is true. Without this, we can't see from CloudWatch
    // whether the prompt is correctly identifying "meter" / "easypark" on a
    // bay that's currently outside its paid window. The field is a few bytes
    // and additive — old clients without it still log everything else.
    payment_methods: result.payment_methods ?? null,
    // Disability-permit signals — same shape. Slice on retake rate by
    // "did the ♿ gate fire" to catch false positives (e.g. wheelchair
    // symbol on an unrelated adjacent sign mis-attributed).
    requires_disabled_permit: !!result.requires_disabled_permit,
    disabled_permit_acknowledged:
      !!result.requires_disabled_permit && disabledAcknowledged,
    // Permit-zone signals. Slice retake rate by permit-zone detection to
    // catch the inverse problem from disability-permit detection: false
    // negatives (we missed a Permit Zone sign that someone in the comments
    // points out we should've caught).
    is_permit_zone: !!result.is_permit_zone,
    permit_area: result.permit_area ?? null,
    permit_zone_acknowledged:
      !!result.is_permit_zone && permitZoneAcknowledged,
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
  // Any other named pay-by-app (e.g. Wilson) gets its own button from the
  // verified registry; Care Park has no verified listing so it falls to the
  // meter hint.
  const extraApps: ParkingApp[] = []
  if (has('wilson')) extraApps.push(PARKING_APPS.wilson)
  return {
    paystay: has('paystay') || unspecified,
    easypark: has('easypark') || unspecified,
    extraApps,
    // The meter / ticket-machine hint is the right fallback when only physical
    // methods are detected and no app applies.
    meterOnly:
      !has('paystay') &&
      !has('easypark') &&
      extraApps.length === 0 &&
      (has('meter') || has('ticket machine') || has('pay-by-plate')),
  }
}

// Platform-aware launch links from the verified parking-apps registry: on iOS
// the App Store / EasyPark universal link, on Android an intent:// keyed by the
// verified package name with a Play fallback, on desktop the website. No AU
// parking app publishes a custom URL scheme, so we never invent one.
const PAYSTAY_URL = launchUrlFor(PARKING_APPS.paystay)
const EASYPARK_URL = launchUrlFor(PARKING_APPS.easypark)

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
  isFirstSave,
}: Props) {
  const { t } = useTranslation()
  const [verified, setVerified] = useState(false)
  // Paid-parking acknowledgement — gates the "Save session" button when the
  // sign requires payment. Defaults false so the user has to deliberately
  // confirm; "yes I paid (or will pay before walking away)".
  const [ticketAcknowledged, setTicketAcknowledged] = useState(false)
  // Disability-permit acknowledgement — same gate pattern, separate state so
  // a sign that needs BOTH (paid bay AND disabled-only — yes, these exist:
  // some councils mark accessible bays with paid parking on the general
  // side) gates Save on both being ticked. Red-styled callout vs the yellow
  // paid-parking one because the cost of getting this wrong is materially
  // higher ($400+ fine + the social cost of taking a needed bay).
  const [disabledAcknowledged, setDisabledAcknowledged] = useState(false)
  // Permit-zone acknowledgement — same gate pattern. Amber-styled callout
  // (between the red disability-permit callout and the amber pay-gate)
  // because the cost of getting this wrong is real but lower than ♿
  // (~$200 fine for an unpermitted park in a residential permit zone, vs
  // $400+ for misusing an accessibility bay). The amber matches the
  // pay-gate, signalling "are you sure?" rather than "this is forbidden".
  const [permitZoneAcknowledged, setPermitZoneAcknowledged] = useState(false)
  // One id per rendering of the result — used to dedupe feedback events server-side
  // without storing anything identifiable.
  const [feedbackId] = useState(() => crypto.randomUUID())
  // Synchronous double-submit guard — a fast double-tap on the verify buttons
  // would otherwise fire submitFeedback twice with the same feedback_id and
  // over-count the accuracy telemetry. A ref, not state, so the second tap in
  // the same gesture sees the flag before React re-renders.
  const feedbackSent = useRef(false)
  // Move focus to the verdict heading when the result mounts so a screen reader
  // announces the can-park / can't-park answer (the app's core output) on this
  // route-like view change. Programmatic focus, so the ring is suppressed and
  // the "until" line is wired as the heading's description.
  const verdictRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    verdictRef.current?.focus()
  }, [])
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
    requires_disabled_permit,
    is_permit_zone,
    permit_area,
  } = result
  // Gate the Save button until the user acknowledges payment. Only meaningful
  // when can_park_now is true (we don't show Save at all when it's false).
  const mustPay = !!requires_ticket && can_park_now
  const mustHavePermit = !!requires_disabled_permit && can_park_now
  const isPermitZone = !!is_permit_zone && can_park_now
  const blockedByPayGate = mustPay && !ticketAcknowledged
  const blockedByPermitGate = mustHavePermit && !disabledAcknowledged
  const blockedByPermitZoneGate = isPermitZone && !permitZoneAcknowledged
  const saveBlocked = blockedByPayGate || blockedByPermitGate || blockedByPermitZoneGate
  const paymentActions = resolvePaymentActions(payment_methods, mustPay)
  const timeZone = timezoneForCoords(coords?.lat, coords?.lng)
  const untilLabel = formatUntil(until, timeZone)
  // Localized countdown so the "X min left" / "Xh Ym left" label translates
  // along with the rest of the result card. Was previously the English-only
  // formatCountdown which left the word "left" untranslated for every
  // non-English user.
  const countdown =
    can_park_now && until ? formatCountdownLocalized(new Date(until).getTime() - now, t) : null
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
      {/* Answer card — the one emphatic object that FLOATS off the page with a
          soft pine-tinted shadow. GO is pine, STOP keeps the quarantined red. */}
      <div
        className={`rounded-2xl p-8 text-center bg-white shadow-[0_14px_40px_rgba(7,59,37,0.16),0_2px_6px_rgba(7,59,37,0.08)] ${
          can_park_now
            ? 'border-[1.5px] border-brand-500'
            : 'border-[1.5px] border-red-500'
        }`}
      >
        <div className="flex justify-center mb-3">
          <div
            className={`w-20 h-20 rounded-full flex items-center justify-center ${
              can_park_now ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-600'
            }`}
          >
            <Icon name={can_park_now ? 'check' : 'warning'} className="w-12 h-12" strokeWidth={2.5} />
          </div>
        </div>
        <h2
          ref={verdictRef}
          tabIndex={-1}
          aria-describedby={can_park_now && untilLabel ? 'verdict-until' : undefined}
          className={`font-display text-4xl font-extrabold tracking-tight leading-[1.05] outline-none ${
            can_park_now ? 'text-ink-900' : 'text-red-700'
          }`}
        >
          {can_park_now ? t('result.canPark') : t('result.cantPark')}
        </h2>
        {can_park_now && untilLabel && (
          <p id="verdict-until" className="mt-3 flex justify-center">
            <span className="inline-block bg-brand-500 text-white text-lg font-display font-bold tabular-nums tnum rounded-full px-4 py-1.5 shadow-[0_2px_8px_rgba(7,59,37,0.2)]">
              {t('result.until', { when: untilLabel })}
            </span>
          </p>
        )}
        {countdown && (
          <p className={`text-sm mt-2 tabular-nums tnum ${URGENCY_STYLE[countdown.urgency]}`}>
            {countdown.label}
          </p>
        )}
      </div>

      {/* Persistent accuracy caveat — this is the screen the driver acts on
          before walking away, so the "it's a machine read, check the real
          sign" framing has to live here, not only on /verify. Shown for every
          result, both can-park and can't-park. */}
      <p className="mt-3 text-center text-xs text-ink-600 leading-relaxed px-2">
        {t('result.aiCaveat')}
      </p>

      {/* Transition-awareness banner — surfaces approaching rule changes so
          the user can make a smarter decision than "should I start parking
          now or wait 5 minutes for the restriction to lift". */}
      {next_transition && transitionLabel && (
        <div className="mt-4 bg-brand-50 border border-brand-200 rounded-lg p-4 flex items-start gap-3">
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
      <Card className="mt-6">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-display font-bold text-ink-900 text-sm uppercase tracking-widest">
            {t('result.onTheSign')}
          </h3>
          {chosen_label && (
            <span className="text-xs font-semibold text-brand-800 bg-brand-50 border border-brand-200 rounded px-2.5 py-1">
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
              {/* Square-ish chips so each observation reads like a field on a
                  parking ticket. */}
              <ul className="flex flex-wrap gap-1.5">
                {group.items.map((item, ii) => (
                  <li
                    key={ii}
                    className="bg-brand-50 border border-brand-200 text-ink-900 text-sm rounded px-2.5 py-1"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-5 pt-4 border-t border-paper-300">
          <span className={`w-2 h-2 rounded-full ${confidenceDot}`} />
          <span className="text-xs text-ink-600">{confidenceText}</span>
        </div>
      </Card>

      {/* Verification card */}
      {verified ? (
        /* VAULT signed-strip — the premium contrast moment. Dark vault panel
            with banknote guilloché texture, the mint-glowing Verified Seal,
            paper text, and a mono mint short-hash. */
        <div
          className="mt-4 rounded-xl px-5 py-4 flex items-center gap-4 border bg-brand-800 overflow-hidden"
          style={{
            backgroundImage:
              'repeating-linear-gradient(115deg, rgba(123,227,164,0.055) 0 1px, transparent 1px 8px)',
            borderColor: 'rgba(123,227,164,0.22)',
          }}
        >
          <VerifiedSeal glow size={38} className="shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-display font-semibold text-paper-50 inline-flex items-center gap-1.5">
              <Icon name="check" className="w-4 h-4 text-[#7BE3A4]" strokeWidth={2.5} />
              {t('result.verifyConfirmed')}
            </p>
            <p className="mt-0.5 font-mono text-xs tracking-wide text-[#7BE3A4]">
              {feedbackId.slice(0, 8)}
            </p>
          </div>
        </div>
      ) : (
        <section className="mt-4 bg-accent-50 border border-accent-200 rounded-lg p-5">
          <h3 className="font-display font-bold text-ink-900 mb-1">{t('result.verifyHeader')}</h3>
          <p className="text-sm text-ink-700 mb-4">
            {t('result.verifyCopy')}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (feedbackSent.current) return
                feedbackSent.current = true
                // Layer-2 context: enough metadata to slice failures by mode
                // (high-confidence-but-wrong, stacked sign, night scan) without
                // any PII. The feedback_id is a per-render UUID that ties this
                // event to nothing user-identifiable.
                submitFeedback({
                  verdict: 'correct',
                  feedback_id: feedbackId,
                  context: buildFeedbackContext(result, ticketAcknowledged, disabledAcknowledged, permitZoneAcknowledged),
                })
                setVerified(true)
              }}
              className="flex-1 bg-white border border-paper-300 hover:border-brand-500 text-ink-900 font-medium py-2.5 rounded-xl transition-colors"
            >
              {t('result.verifyYes')}
            </button>
            <button
              onClick={() => {
                if (feedbackSent.current) return
                feedbackSent.current = true
                submitFeedback({
                  verdict: 'retake',
                  feedback_id: feedbackId,
                  context: buildFeedbackContext(result, ticketAcknowledged, disabledAcknowledged, permitZoneAcknowledged),
                })
                onRetake()
              }}
              className="flex-1 bg-accent-600 hover:bg-accent-700 text-white font-semibold py-2.5 rounded-xl transition-colors"
            >
              {t('result.verifyRetake')}
            </button>
          </div>
        </section>
      )}

      {/* View the photo */}
      <details className="mt-4 bg-white rounded-lg border border-paper-300 overflow-hidden">
        <summary className="px-5 py-3 text-sm font-medium text-ink-700 cursor-pointer select-none">
          {t('result.viewPhoto')}
        </summary>
        <img src={signPhoto} alt={t('clarify.imageAlt')} className="w-full border-t border-paper-300" />
      </details>

      {/* Accessibility-permit gate — same architectural pattern as the
          paid-parking gate below but RED instead of YELLOW. Sits above the
          paid-parking gate because the cost of getting it wrong is higher
          ($400+ fine and the social cost of taking a needed bay) and the
          user should see this first if both are present (some bays are
          both ♿ AND metered). */}
      {mustHavePermit && (
        <section className="mt-4 bg-red-50 border-2 border-red-500 rounded-lg p-5">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-red-600 text-white flex items-center justify-center shrink-0 mt-0.5">
              {/* Wheelchair-style accessibility glyph — drawn inline rather
                  than via an Icon font to guarantee it renders consistently
                  across locales and platforms. */}
              <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
                <circle cx="11" cy="5.5" r="2" fill="currentColor" />
                <path
                  d="M9 9.5h2.5L13 14h3.5l1.5 5h-2l-1-3.5h-4L9.5 12V21h-2v-9.5l-3 1V19h-1.5v-9l4.5-1.5z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-red-700">
                {t('result.permitRequired.kicker')}
              </p>
              <h3 className="font-display font-bold text-ink-900 mt-1">
                {t('result.permitRequired.header')}
              </h3>
              <p className="text-sm text-ink-700 mt-1 leading-relaxed">
                {t('result.permitRequired.copy')}
              </p>
            </div>
          </div>

          <label className="mt-4 flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={disabledAcknowledged}
              onChange={(e) => setDisabledAcknowledged(e.target.checked)}
              className="mt-0.5 w-5 h-5 rounded border-2 border-red-500 accent-red-600 cursor-pointer shrink-0"
            />
            <span className="text-sm font-medium text-ink-900 leading-tight">
              {t('result.permitRequired.ack')}
            </span>
          </label>
        </section>
      )}

      {/* Permit-zone gate — surfaces when the AI detected a residential /
          business Permit Zone in force RIGHT NOW. Different from the red
          ♿ gate above: this is "are you sure you have a permit for THIS
          area?" not "this is restricted". Amber (matching the pay gate's
          tone of voice) rather than red. Sits between ♿ and pay gates so
          a sign that hits ♿ + permit + pay still surfaces them in
          severity order. */}
      {isPermitZone && (
        <section className="mt-4 bg-amber-50 border-2 border-amber-400 rounded-lg p-5">
          <div className="flex items-start gap-3">
            <div aria-hidden="true" className="w-9 h-9 rounded-lg bg-amber-700 text-white flex items-center justify-center shrink-0 mt-0.5 font-display font-extrabold text-lg">
              P
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                {t('result.permitZone.kicker')}
              </p>
              <h3 className="font-display font-bold text-ink-900 mt-1">
                {permit_area
                  ? t('result.permitZone.headerWithArea', { area: permit_area })
                  : t('result.permitZone.header')}
              </h3>
              <p className="text-sm text-ink-700 mt-1 leading-relaxed">
                {permit_area
                  ? t('result.permitZone.copyWithArea', { area: permit_area })
                  : t('result.permitZone.copy')}
              </p>
            </div>
          </div>

          <label className="mt-4 flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={permitZoneAcknowledged}
              onChange={(e) => setPermitZoneAcknowledged(e.target.checked)}
              className="mt-0.5 w-5 h-5 rounded border-2 border-amber-500 accent-amber-600 cursor-pointer shrink-0"
            />
            <span className="text-sm font-medium text-ink-900 leading-tight">
              {permit_area
                ? t('result.permitZone.ackWithArea', { area: permit_area })
                : t('result.permitZone.ack')}
            </span>
          </label>
        </section>
      )}

      {/* Pay-required gate — surfaces when the AI detected paid parking AND
          the current time is inside the paid window. Two jobs: (1) make the
          requirement impossible to miss, (2) actively help the user pay it.
          The Save button below is disabled until the checkbox is ticked. */}
      {mustPay && (
        <section className="mt-4 bg-amber-50 border-2 border-amber-400 rounded-lg p-5">
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

          {(paymentActions.paystay || paymentActions.easypark || paymentActions.extraApps.length > 0) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {paymentActions.extraApps.map((app) => (
                <a
                  key={app.id}
                  href={launchUrlFor(app)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-2 bg-white border-2 border-amber-400 hover:bg-amber-100 text-ink-900 font-semibold py-2.5 rounded-xl transition-colors text-sm"
                >
                  {t('result.payRequired.openApp', { app: app.name })}
                </a>
              ))}
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
        {can_park_now ? (
          <>
            {/* First-ever scan: reconnect the evidence-chain value at the one
                moment "Save" becomes actionable, so it doesn't read as
                optional busywork next to "Scan another". */}
            {isFirstSave && (
              <p className="text-xs text-ink-600 text-center leading-relaxed mb-1">
                {t('result.firstSaveValue')}
              </p>
            )}
            <Button
              onClick={onLogSession}
              disabled={saveBlocked}
              className="disabled:cursor-not-allowed disabled:shadow-none"
            >
              {blockedByPermitGate
                ? t('result.logCtaBlockedPermit')
                : blockedByPermitZoneGate
                  ? t('result.logCtaBlockedPermitZone')
                  : blockedByPayGate
                    ? t('result.logCtaBlocked')
                    : t('result.logCta')}
            </Button>
          </>
        ) : (
          /* Can't-park override — an AI misread that wrongly says "can't park"
             shouldn't strand the driver with no recourse. Offer to log the
             spot as evidence of a reasonable decision rather than overruling
             them silently. Routes to the same logger as the can-park save. */
          <Card as="div" pad="sm" className="mb-1">
            <p className="text-sm text-ink-700 leading-relaxed mb-3">
              {t('result.cantParkOverride')}
            </p>
            <button
              onClick={onLogSession}
              className="w-full bg-paper-200 hover:bg-paper-300 text-ink-900 font-medium py-2.5 rounded-xl transition-colors"
            >
              {t('result.cantParkOverrideCta')}
            </button>
          </Card>
        )}
        <button
          onClick={onScanAnother}
          className="bg-paper-200 hover:bg-paper-300 text-ink-900 font-medium py-3 rounded-xl transition-colors"
        >
          {t('result.scanAnother')}
        </button>
      </div>
    </div>
  )
}
