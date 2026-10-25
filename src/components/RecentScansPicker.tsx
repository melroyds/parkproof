import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ParkingSession } from '../types'
import { formatRelativeLocalized } from '../lib/time-format'
import { hasSessionPhoto, resolveSessionPhoto } from '../lib/session-photos'
import { RecordThumbnail } from './RecordPhoto'

const SIGN_ONLY = ['sign'] as const

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
  // A re-check reuses the record's sign photo, so a row whose photo can't
  // be read (none, or its bytes aren't on this device) would be a dead tap.
  // Records with no sign photo at all are left out at once; photo-store
  // photos are checked as the picker opens.
  const [unusable, setUnusable] = useState<ReadonlySet<string>>(
    () => new Set(sessions.filter((s) => !hasSessionPhoto(s, 'sign')).map((s) => s.id)),
  )
  useEffect(() => {
    let cancelled = false
    void Promise.all(
      sessions.map(async (s) => ((await resolveSessionPhoto(s, 'sign')).kind === 'available' ? null : s.id)),
    ).then((ids) => {
      if (!cancelled) setUnusable(new Set(ids.filter((id): id is string => id !== null)))
    })
    return () => {
      cancelled = true
    }
  }, [sessions])
  const usable = sessions.filter((s) => !unusable.has(s.id))

  if (usable.length === 0) return null

  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-display font-bold text-paper-50 text-sm uppercase tracking-widest">
          {t('reuse.pickerHeader')}
        </h3>
        <button
          onClick={onDismiss}
          className="text-xs underline hover:opacity-80"
          style={{ color: '#7BE3A4' }}
        >
          {t('reuse.dismiss')}
        </button>
      </div>
      <p className="text-xs mb-3" style={{ color: '#A9CFBE' }}>
        {t('reuse.pickerCopy')}
      </p>
      <div className="flex flex-col gap-2">
        {usable.map((s) => {
          const age = agesById.get(s.id) ?? ''
          const headline = s.location?.address ?? 'Saved scan'
          return (
            <button
              key={s.id}
              onClick={() => onPick(s)}
              className="gf-card bg-white hover:bg-brand-50 p-3 text-left flex items-center gap-3 transition-colors"
            >
              <RecordThumbnail
                session={s}
                roles={SIGN_ONLY}
                className="w-14 h-14 object-cover rounded-md border border-brand-900/10 flex-none bg-white"
                fallback={<div className="w-14 h-14 rounded-md border border-brand-900/10 flex-none bg-white" aria-hidden="true" />}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink-900 truncate">{headline}</p>
                <p className="text-xs text-ink-600 truncate">
                  {age}
                  {s.chosen_label ? ` · ${s.chosen_label}` : ''}
                </p>
              </div>
              <span className="text-brand-600 text-xl leading-none" aria-hidden>
                ›
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
