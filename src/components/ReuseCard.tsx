import type { ParkingSession } from '../types'
import { formatRelative } from '../lib/time-format'

interface Props {
  session: ParkingSession
  distanceMeters: number
  onReuse: () => void
  onDismiss: () => void
}

export default function ReuseCard({ session, distanceMeters, onReuse, onDismiss }: Props) {
  const age = formatRelative(Date.now() - new Date(session.arrived_at).getTime())
  const bulletItems = session.observations.flatMap((g) => g.items).slice(0, 4)

  return (
    <section className="mb-6 bg-brand-50 border border-brand-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-baseline justify-between mb-3 gap-2">
        <h3 className="font-display font-bold text-ink-900 text-lg leading-tight">
          You scanned here {age}
        </h3>
        <span className="text-[10px] uppercase tracking-widest font-semibold text-brand-700 shrink-0">
          {Math.round(distanceMeters)}m away
        </span>
      </div>

      <img
        src={session.sign_photo}
        alt="The sign you scanned previously"
        className="w-full h-32 object-contain rounded-xl mb-3 border border-paper-300 bg-white"
      />

      <p className="text-xs uppercase tracking-widest font-semibold text-ink-500 mb-2">
        Bullets we recorded
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
          You parked: <span className="font-semibold text-ink-900">{session.chosen_label}</span>
        </p>
      )}

      <p className="text-xs text-ink-700 mb-4">
        Does the sign in front of you match this? Reuse to skip the photo and get a fresh
        "can I park now?" answer in seconds.
      </p>

      <div className="flex gap-2">
        <button
          onClick={onDismiss}
          className="flex-1 bg-white border border-paper-300 hover:border-ink-600 text-ink-900 font-medium py-2.5 rounded-xl transition-colors text-sm"
        >
          No, scan fresh
        </button>
        <button
          onClick={onReuse}
          className="flex-1 bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-semibold py-2.5 rounded-xl shadow-md shadow-brand-500/20 transition-colors text-sm"
        >
          Reuse this reading
        </button>
      </div>
    </section>
  )
}
