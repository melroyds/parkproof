import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { ParkingSession } from '../types'
import { useNow } from '../lib/use-now'
import { useLiveRecords } from '../lib/use-records-version'
import { recordStatus } from '../lib/record-status'
import { sessionTimezone } from '../lib/timezone'
import { isNoSignReadRecord } from '../lib/sign-result'
import Icon from './Icon'
import VerifiedSeal from './VerifiedSeal'
import BackButton from './ui/BackButton'
import { RecordThumbnail } from './RecordPhoto'

/** Thumbnail priority for a row: the sign photo, then the surroundings photo, then the car photo. */
const THUMB_ROLES = ['sign', 'ambient', 'car'] as const

interface Props {
  onBack: () => void
  onOpen: (session: ParkingSession) => void
}

function statusFor(
  session: ParkingSession,
  now: number,
  t: TFunction,
  timeZone: string,
): { label: string; color: string } {
  // An ended record reads "Ended ..." even if its expiry is still ahead.
  const status = recordStatus(session, now, t, timeZone)
  if (status.kind !== 'counting') return { label: status.label, color: 'text-ink-600' }
  const color =
    status.urgency === 'urgent' || status.urgency === 'expired'
      ? 'text-accent-700 font-bold'
      : status.urgency === 'warning'
        ? 'text-accent-600'
        : 'text-brand-700'
  return { label: status.label, color }
}

export default function SessionHistory({ onBack, onOpen }: Props) {
  const { t } = useTranslation()
  // Re-read on every records change, so a signature or a cloud pull that
  // lands while History is open shows up without leaving the screen.
  const sessions = useLiveRecords()
  const now = useNow()

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <BackButton onClick={onBack}>{t('common.backToHome')}</BackButton>

      <h2 className="font-display text-3xl font-extrabold text-paper-50 mb-1">
        {t('history.header')}
      </h2>
      <p className="text-sm mb-6 leading-relaxed" style={{ color: '#A9CFBE' }}>{t('history.intro')}</p>

      {sessions.length === 0 ? (
        <div className="gf-card bg-white p-8 text-center">
          <img
            // BASE_URL-aware so the asset resolves correctly under the
            // /app/ mount after the two-app cutover.
            src={`${import.meta.env.BASE_URL}empty-history.svg`}
            alt=""
            className="w-44 h-auto mx-auto mb-3 select-none pointer-events-none"
            aria-hidden
          />
          <p className="text-ink-900 font-display font-bold">{t('history.emptyTitle')}</p>
          <p className="text-xs text-ink-600 mt-1 leading-relaxed">{t('history.emptyHelp')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sessions.map((s) => {
            // One zone for the whole row (the record's own, as on the record
            // screen), so arrival and "Ended ..." can't disagree.
            const timeZone = sessionTimezone(s.location)
            const status = statusFor(s, now, t, timeZone)
            const arrival = new Date(s.arrived_at)
            return (
              <button
                key={s.id}
                onClick={() => onOpen(s)}
                className="gf-card text-left bg-white hover:bg-paper-50 p-4 transition-colors"
              >
                <div className="flex items-start gap-3">
                  {/* Thumbnail priority for the row: sign photo (translated
                      records) → surroundings photo (no-sign) → car photo →
                      placeholder square (no photo, or its bytes aren't on
                      this device). Read through the photo store for new
                      records. */}
                  <RecordThumbnail
                    session={s}
                    roles={THUMB_ROLES}
                    className="w-16 h-16 object-cover rounded-lg border border-paper-300 flex-none"
                    fallback={
                      <div className="w-16 h-16 rounded-lg border border-paper-300 bg-paper-100 flex items-center justify-center flex-none">
                        <Icon name="pin" className="w-7 h-7 text-ink-400" />
                      </div>
                    }
                  />
                  <div className="flex-1 min-w-0">
                    {/* A read-only copy from someone's share link (T7). */}
                    {s.shared_from && (
                      <span className="inline-flex items-center gap-1 mb-1 text-2xs font-semibold uppercase tracking-wider text-brand-800 bg-brand-50 border border-brand-200 rounded-full px-2 py-0.5">
                        <Icon name="share" className="w-3 h-3" strokeWidth={2.25} />
                        {t('share.badge')}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 min-w-0">
                      {s.signature && (
                        <VerifiedSeal size={16} glow={false} className="flex-none" />
                      )}
                      <p className="font-medium text-ink-900 truncate">
                        {arrival.toLocaleDateString('en-AU', {
                          timeZone,
                          weekday: 'short',
                          day: 'numeric',
                          month: 'short',
                        })}
                        {' · '}
                        {arrival.toLocaleTimeString('en-AU', {
                          timeZone,
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    {s.location?.address && (
                      <p className="text-xs text-ink-700 mt-0.5 truncate">{s.location.address}</p>
                    )}
                    <p className="text-xs text-ink-600 mt-0.5 line-clamp-2">
                      {s.no_sign ? t(isNoSignReadRecord(s) ? 'unclearSign.noSignReadLabel' : 'history.noSignBadge') : s.rules}
                    </p>
                    <p className={`text-xs font-semibold mt-1 ${status.color}`}>{status.label}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
