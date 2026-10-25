import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { departureSummary } from '../lib/chain-view'
import { farFromArrival } from '../lib/departure'
import { isEndedOnThisDevice } from '../lib/signing'
import { formatInZone } from '../lib/time-format'
import { formatDistance } from '../lib/walk-back'

interface Props {
  session: ParkingSession
  /** The record's own time zone. */
  timeZone: string
  /** The screen's clock tick (ms), so "Not signed yet" turns into "isn't signed" once no departure is coming. */
  now: number
}

/**
 * The departure row on the record screen (T1a), inside the details list:
 * "You tapped I've left at ... (phone clock)." and, separately, ParkProof's
 * signing time for the departure ("Signed by ParkProof at ..."), or "Not
 * signed yet" / "This part couldn't be signed" / "This departure isn't
 * signed" (no departure part is coming: an old record, or one this device
 * can't add to). The tap time is never called signed.
 *
 * When the phone was clearly far from where the car was logged (over
 * DEPARTURE_FAR_M once both fixes' error is taken off, `farFromArrival`),
 * it says so, and that the record shows the tap, not when the car moved.
 * Signed values come from the signed departure.
 */
export default function DepartureRow({ session, timeZone, now }: Props) {
  const { t } = useTranslation()
  const summary = departureSummary(session, { now, endedHere: isEndedOnThisDevice(session.id) })
  if (!summary) return null
  const when = (iso: string | null) => (iso ? formatInZone(iso, timeZone) : '')
  const signing = summary.signing
  const signingText =
    signing.state === 'signed'
      ? t('chain.signedAt', { time: when(signing.signed_at) })
      : signing.state === 'dev_key'
        ? t('chain.devKeySignedAt', { time: when(signing.signed_at) })
        : signing.state === 'rejected'
          ? t('verifier.link.rejected')
          : signing.state === 'none'
            ? t('departure.notSigned')
            : t('verifier.link.pending')
  const distance = summary.distance_from_arrival_m
  const far = farFromArrival(distance, session.location?.accuracy_meters, summary.location_accuracy_m)
  return (
    <div>
      <dt className="text-xs uppercase tracking-widest font-semibold text-ink-600">{t('departure.heading')}</dt>
      <dd className="mt-1 text-ink-900">{t('departure.tapped', { time: when(summary.tapped_at) })}</dd>
      <dd className="text-xs mt-0.5 text-ink-600">{signingText}</dd>
      {far && distance !== null && (
        <dd className="text-xs mt-1.5 text-ink-700 leading-relaxed">
          {t('departure.far', { distance: formatDistance(distance) })}
        </dd>
      )}
    </div>
  )
}
