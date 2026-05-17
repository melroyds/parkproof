import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { formatRelativeLocalized } from '../lib/time-format'

interface Props {
  sessions: ParkingSession[]
  onPick: (session: ParkingSession) => void
  onDismiss: () => void
}

export default function RecentScansPicker({ sessions, onPick, onDismiss }: Props) {
  const { t } = useTranslation()
  // Pre-compute ages at mount so the render-pass stays pure. The labels are
  // "5 minutes ago" coarse — fine to freeze them while the picker is open.
  const [agesById] = useState<Map<string, string>>(() => {
    const now = Date.now()
    const map = new Map<string, string>()
    for (const s of sessions) {
      map.set(s.id, formatRelativeLocalized(now - new Date(s.arrived_at).getTime(), t))
    }
    return map
  })

  if (sessions.length === 0) return null

  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-display font-bold text-ink-900 text-sm uppercase tracking-widest">
          {t('reuse.pickerHeader')}
        </h3>
        <button
          onClick={onDismiss}
          className="text-xs text-ink-600 hover:text-ink-900 underline"
        >
          {t('reuse.dismiss')}
        </button>
      </div>
      <p className="text-xs text-ink-600 mb-3">
        {t('reuse.pickerCopy')}
      </p>
      <div className="flex flex-col gap-2">
        {sessions.map((s) => {
          const age = agesById.get(s.id) ?? ''
          const headline = s.location?.address ?? 'Saved scan'
          return (
            <button
              key={s.id}
              onClick={() => onPick(s)}
              className="bg-white hover:bg-paper-50 border border-paper-300 hover:border-brand-300 rounded-2xl p-3 text-left flex items-center gap-3 transition-colors"
            >
              <img
                src={s.sign_photo}
                alt=""
                className="w-14 h-14 object-cover rounded-lg border border-paper-300 flex-none bg-white"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-900 truncate">{headline}</p>
                <p className="text-xs text-ink-600 truncate">
                  {age}
                  {s.chosen_label ? ` · ${s.chosen_label}` : ''}
                </p>
              </div>
              <span className="text-brand-500 text-xl leading-none" aria-hidden>
                ›
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
