import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { formatRelativeLocalized } from '../lib/time-format'

interface Props {
  session: ParkingSession
  distanceMeters: number
  onReuse: () => void
  onDismiss: () => void
}

export default function ReuseCard({ session, distanceMeters, onReuse, onDismiss }: Props) {
  const { t } = useTranslation()
  // Frozen at mount — "scanned 5 minutes ago" doesn't need live ticking; the
  // user is looking at the card for seconds, not minutes.
  const [age] = useState(() =>
    formatRelativeLocalized(Date.now() - new Date(session.arrived_at).getTime(), t),
  )
  const bulletItems = session.observations.flatMap((g) => g.items).slice(0, 4)

  return (
    <section className="mb-6 bg-brand-50 border border-brand-900/10 rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <h3 className="font-display font-bold text-ink-900 text-lg leading-tight">
          {t('reuse.scannedHere', { age })}
        </h3>
        <span className="text-2xs uppercase tracking-widest font-semibold text-brand-700 shrink-0 tnum">
          {t('reuse.metersAway', { meters: Math.round(distanceMeters) })}
        </span>
      </div>

      <img
        src={session.sign_photo ?? undefined}
        alt={t('reuse.signPhotoAlt')}
        className="w-full h-32 object-contain rounded-lg mb-3 border border-paper-300 bg-white"
      />

      <p className="text-xs uppercase tracking-widest font-semibold text-ink-600 mb-2">
        {t('reuse.bulletsHeader')}
      </p>
      <ul className="space-y-1 mb-4">
        {bulletItems.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-ink-900">
            <span className="text-brand-500 select-none">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>

      {session.chosen_label && (
        <p className="text-xs text-ink-600 mb-3">
          <Trans
            i18nKey="reuse.youParked"
            values={{ side: session.chosen_label }}
            components={{ strong: <span className="font-semibold text-ink-900" /> }}
          />
        </p>
      )}

      <p className="text-xs text-ink-700 mb-4">{t('reuse.matchCopy')}</p>

      <div className="flex gap-2">
        <button
          onClick={onDismiss}
          className="flex-1 bg-white border border-paper-300 hover:border-ink-600 text-ink-900 font-medium py-2.5 rounded-xl transition-colors text-sm"
        >
          {t('reuse.dismiss')}
        </button>
        <button
          onClick={onReuse}
          className="flex-1 bg-brand-700 hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-300 text-white font-semibold py-2.5 rounded-xl transition-colors text-sm"
        >
          {t('reuse.useThisRead')}
        </button>
      </div>
    </section>
  )
}
