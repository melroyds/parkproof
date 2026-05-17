import { useState } from 'react'
import type { ParkingSession } from '../types'
import { loadSessions } from '../lib/storage'
import { useNow } from '../lib/use-now'
import { formatCountdown } from '../lib/countdown'

interface Props {
  onBack: () => void
  onOpen: (session: ParkingSession) => void
}

function statusFor(session: ParkingSession, now: number): { label: string; color: string } {
  if (!session.expires_at) return { label: 'No expiry', color: 'text-ink-500' }
  const expiresMs = new Date(session.expires_at).getTime()
  if (expiresMs < now) return { label: 'Expired', color: 'text-ink-500' }
  const countdown = formatCountdown(expiresMs - now)
  const color =
    countdown.urgency === 'urgent' || countdown.urgency === 'expired'
      ? 'text-accent-700 font-bold'
      : countdown.urgency === 'warning'
        ? 'text-accent-600'
        : 'text-brand-700'
  return { label: countdown.label, color }
}

export default function SessionHistory({ onBack, onOpen }: Props) {
  // Lazy init pulls the list from localStorage once at mount; no useEffect
  // needed (avoids the rules-of-hooks "setState inside effect" gripe).
  const [sessions] = useState<ParkingSession[]>(() => loadSessions())
  const now = useNow()

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <button
        onClick={onBack}
        className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4 transition-colors"
      >
        ← Home
      </button>

      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">Session history</h2>
      <p className="text-sm text-ink-600 mb-6 leading-relaxed">
        Every parking session you've logged. Tap one to view evidence or export a PDF.
      </p>

      {sessions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-paper-300 p-8 text-center">
          <img
            src="/empty-history.svg"
            alt=""
            className="w-44 h-auto mx-auto mb-3 select-none pointer-events-none"
            aria-hidden
          />
          <p className="text-ink-900 font-display font-bold">No sessions yet</p>
          <p className="text-xs text-ink-600 mt-1 leading-relaxed">
            Scan a sign and log a session — it'll appear here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sessions.map((s) => {
            const status = statusFor(s, now)
            const arrival = new Date(s.arrived_at)
            return (
              <button
                key={s.id}
                onClick={() => onOpen(s)}
                className="text-left bg-white hover:bg-paper-50 border border-paper-300 hover:border-brand-300 rounded-2xl p-4 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <img
                    src={s.sign_photo}
                    alt=""
                    className="w-16 h-16 object-cover rounded-lg border border-paper-300 flex-none"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-ink-900 truncate">
                      {arrival.toLocaleDateString('en-AU', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })}
                      {' · '}
                      {arrival.toLocaleTimeString('en-AU', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </p>
                    {s.location?.address && (
                      <p className="text-xs text-ink-700 mt-0.5 truncate">{s.location.address}</p>
                    )}
                    <p className="text-xs text-ink-600 mt-0.5 line-clamp-2">{s.rules}</p>
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
