import { useTranslation } from 'react-i18next'
import type { SharedFacts } from '../lib/shared-record'
import { formatCountdownLocalized } from '../lib/countdown'
import { formatInZone } from '../lib/time-format'
import { navigationUrlForPoint } from '../lib/walk-back'
import Icon from './Icon'
import Card from './ui/Card'

interface Props {
  facts: SharedFacts
  now: number
  /** Show the Directions link. Hidden whenever the signature didn't check out. */
  showDirections: boolean
  /** The bundle was signed with a development key (`npm run dev` builds only). */
  devKey?: boolean
}

const FIELD_LABEL = 'text-xs uppercase tracking-widest font-semibold text-ink-600'
const SECTION_HEADING = 'font-display text-base font-bold text-ink-900'

/**
 * What a share link shows (build spec T7 item 3), on the receive view and
 * on a stored copy's record screen: the snapshot banner, the countdown,
 * the signed details (address, coordinates, arrival and expiry, all from
 * the verified signed payload), Directions, and the sender's extras under
 * "From the sender, not signed". Never sets the page title or meta tags.
 */
export default function SharedFactsPanel({ facts, now, showDirections, devKey = false }: Props) {
  const { t } = useTranslation()
  const tz = facts.time_zone
  const when = (iso: string) => formatInZone(iso, tz)
  const { driver, ended_at, rules, standard_until } = facts.extras

  const banner = facts.shared_at
    ? driver
      ? t('share.banner', { driver, time: when(facts.shared_at) })
      : t('share.bannerNoDriver', { time: when(facts.shared_at) })
    : t('share.bannerNoTime')

  const expiresMs = facts.expires_at ? Date.parse(facts.expires_at) : NaN
  const live = Number.isFinite(expiresMs) && expiresMs > now
  const status = Number.isFinite(expiresMs)
    ? live
      ? formatCountdownLocalized(expiresMs - now, t).label
      : t('history.expired')
    : null
  // Mint is for active states only (design rules): a running countdown on a
  // park the sender hasn't said they left. Expired, or after the sender's
  // I've left, it is muted sage.
  const glowing = live && !ended_at
  // When the park was permit-adjusted the signed limit is the permit's
  // later time, and the sender shares the sign's standard limit (unsigned).
  // The signed limit is then labelled neutrally, never "read from the
  // sign", and a line says the earlier standard limit applies without the
  // permit (T7 item 6's risk: someone driving without the permit holder).
  const permitAdjusted = !!standard_until
  const place = facts.location
    ? facts.location.address ?? `${facts.location.lat.toFixed(5)}, ${facts.location.lng.toFixed(5)}`
    : t('share.noPlace')
  const hasExtras = !!(driver || rules || ended_at || standard_until)

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-amber-50 border border-amber-300 rounded-2xl px-4 py-3 flex items-start gap-2.5" role="note">
        <Icon name="share" className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-900 leading-relaxed">{banner}</p>
      </div>

      <div
        className="gf-card-lg p-5 text-paper-50"
        style={{ background: 'rgba(255,255,255,0.055)', borderColor: 'rgba(123,227,164,0.22)' }}
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-[#A9CFBE]">{t('share.field.place')}</p>
        <p className="font-display text-base font-bold leading-snug mt-0.5 break-words">{place}</p>
        {status && (
          <p
            className={`font-display tnum text-3xl font-extrabold tracking-tight mt-3 ${glowing ? 'text-[#7BE3A4]' : 'text-[#A9CFBE]'}`}
            style={glowing ? { textShadow: '0 0 18px rgba(123,227,164,0.45)' } : undefined}
          >
            {status}
          </p>
        )}
        {permitAdjusted && standard_until && (
          <p className="text-sm text-paper-50 leading-relaxed mt-2">
            {t('share.permitTimeNote', { time: when(standard_until) })}
          </p>
        )}
      </div>

      <Card className="rounded-2xl">
        <h3 className={SECTION_HEADING}>{t('share.signedHeading')}</h3>
        <p className="text-xs text-ink-600 leading-relaxed mt-1">
          {devKey
            ? t('verifier.link.devKey')
            : facts.signed_at
              ? t('share.signedNote', { time: when(facts.signed_at) })
              : t('share.signedNoteNoTime')}
        </p>
        <dl className="space-y-3 text-sm mt-4">
          <div>
            <dt className={FIELD_LABEL}>{t('share.field.place')}</dt>
            <dd className="mt-1 text-ink-900 break-words">
              {facts.location ? (
                <>
                  {facts.location.address && <span className="block">{facts.location.address}</span>}
                  <span className="block text-xs text-ink-600 font-mono">
                    {facts.location.lat.toFixed(5)}, {facts.location.lng.toFixed(5)}
                  </span>
                </>
              ) : (
                t('share.noPlace')
              )}
            </dd>
          </div>
          <div>
            <dt className={FIELD_LABEL}>{t('share.field.arrived')}</dt>
            <dd className="mt-1 text-ink-900 tnum">{t('share.phoneClock', { time: when(facts.arrived_at) })}</dd>
          </div>
          <div>
            <dt className={FIELD_LABEL}>{t(permitAdjusted ? 'share.field.limitRecorded' : 'share.field.limit')}</dt>
            <dd className="mt-1 text-ink-900 tnum">{facts.expires_at ? when(facts.expires_at) : t('share.noLimit')}</dd>
          </div>
        </dl>
      </Card>

      {showDirections && facts.location && (
        <a
          href={navigationUrlForPoint(facts.location)}
          target="_blank"
          rel="noreferrer"
          className="w-full min-h-[48px] bg-paper-50 hover:bg-white active:bg-paper-100 text-brand-800 font-semibold py-3 rounded-xl gf-btn flex items-center justify-center gap-2 transition-colors"
        >
          <Icon name="pin" className="w-5 h-5" />
          {t('share.directions')}
        </a>
      )}

      {hasExtras && (
        <Card className="rounded-2xl">
          <h3 className={SECTION_HEADING}>{t('share.unsignedHeading')}</h3>
          <dl className="space-y-3 text-sm mt-3">
            {driver && (
              <div>
                <dt className={FIELD_LABEL}>{t('share.field.driver')}</dt>
                <dd className="mt-1 text-ink-900 break-words">{driver}</dd>
              </div>
            )}
            {rules && (
              <div>
                <dt className={FIELD_LABEL}>{t('share.field.rules')}</dt>
                <dd className="mt-1 text-ink-900 break-words">{rules}</dd>
              </div>
            )}
            {standard_until && (
              <div>
                <dt className={FIELD_LABEL}>{t('share.field.standardLimit')}</dt>
                <dd className="mt-1 text-ink-900 tnum">{when(standard_until)}</dd>
              </div>
            )}
            {ended_at && (
              <div>
                <dt className={FIELD_LABEL}>{t('share.field.ended')}</dt>
                <dd className="mt-1 text-ink-900">{t('share.endedValue', { time: when(ended_at) })}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}
    </div>
  )
}
