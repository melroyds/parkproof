import type { ParkingSession } from '../types'
import { deleteSession } from '../lib/storage'
import Icon from './Icon'
import { useNow } from '../lib/use-now'
import { formatCountdown } from '../lib/countdown'

interface Props {
  session: ParkingSession
  onBack: () => void
  onDeleted: () => void
  onDraftAppeal: () => void
}

function fmtMelb(iso: string, full = false): string {
  return new Date(iso).toLocaleString('en-AU', {
    timeZone: 'Australia/Melbourne',
    weekday: full ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: full ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function SessionDetail({ session, onBack, onDeleted, onDraftAppeal }: Props) {
  const now = useNow()
  const expiresMs = session.expires_at ? new Date(session.expires_at).getTime() : null
  const isExpired = expiresMs !== null && expiresMs < now
  const countdown =
    expiresMs !== null && !isExpired ? formatCountdown(expiresMs - now) : null

  const handleDelete = () => {
    if (!window.confirm('Delete this parking session? This cannot be undone.')) return
    deleteSession(session.id)
    onDeleted()
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <button
        onClick={onBack}
        className="self-start text-ink-600 hover:text-ink-900 text-sm mb-4 transition-colors"
      >
        ← Back to history
      </button>

      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">Parking session</h2>
      <p className="text-sm text-ink-600 mb-3 leading-relaxed">
        Arrived {fmtMelb(session.arrived_at, true)}
      </p>

      {session.signature && (
        <div className="mb-6 inline-flex items-center gap-2 self-start bg-brand-50 border border-brand-200 text-brand-800 text-xs font-semibold px-3 py-1.5 rounded-full">
          <Icon name="check" className="w-4 h-4" strokeWidth={2.5} />
          <span>Cryptographically signed</span>
          <span className="text-brand-600 font-normal">·</span>
          <span className="text-brand-700 font-mono text-[10px]">
            {new Date(session.signature.signed_at).toLocaleString('en-AU', {
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        </div>
      )}

      <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-3">
        <dl className="space-y-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-widest font-semibold text-ink-500">
              Status
            </dt>
            <dd
              className={`mt-1 font-display font-bold ${
                isExpired ? 'text-ink-500' : 'text-brand-700'
              }`}
            >
              {session.expires_at
                ? isExpired
                  ? 'Expired'
                  : `Active until ${fmtMelb(session.expires_at)}`
                : 'No expiry recorded'}
            </dd>
            {countdown && (
              <dd
                className={`text-xs mt-0.5 ${
                  countdown.urgency === 'urgent'
                    ? 'text-accent-700 font-bold'
                    : countdown.urgency === 'warning'
                      ? 'text-accent-600 font-semibold'
                      : 'text-brand-700'
                }`}
              >
                {countdown.label}
              </dd>
            )}
          </div>
          <div>
            <dt className="text-xs uppercase tracking-widest font-semibold text-ink-500">
              Sign rules
            </dt>
            <dd className="mt-1 text-ink-900">{session.rules}</dd>
          </div>
          {session.chosen_label && (
            <div>
              <dt className="text-xs uppercase tracking-widest font-semibold text-ink-500">
                Side chosen
              </dt>
              <dd className="mt-1 text-ink-900">{session.chosen_label}</dd>
            </div>
          )}
          {session.location && (
            <div>
              <dt className="text-xs uppercase tracking-widest font-semibold text-ink-500">
                Location
              </dt>
              <dd className="mt-1">
                <a
                  className="text-brand-700 hover:text-brand-800 underline inline-flex items-center gap-1"
                  href={`https://www.google.com/maps?q=${session.location.lat},${session.location.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="pin" className="w-4 h-4" />
                  {session.location.address ?? 'View on Google Maps'}
                </a>
                <p className="text-xs text-ink-500 font-mono mt-0.5">
                  ({session.location.lat.toFixed(5)}, {session.location.lng.toFixed(5)})
                </p>
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs uppercase tracking-widest font-semibold text-ink-500">
              AI confidence
            </dt>
            <dd className="mt-1 text-ink-900 capitalize">{session.confidence}</dd>
          </div>
        </dl>
      </section>

      <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-3">
        <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-500 mb-2">
          Sign photo
        </h3>
        <img
          src={session.sign_photo}
          alt="Sign"
          className="w-full rounded-xl border border-paper-300"
        />
      </section>

      {session.car_photo && (
        <section className="bg-white rounded-2xl border border-paper-300 p-5 mb-3">
          <h3 className="text-xs uppercase tracking-widest font-semibold text-ink-500 mb-2">
            Car at the spot
          </h3>
          <img
            src={session.car_photo}
            alt="Car"
            className="w-full rounded-xl border border-paper-300"
          />
        </section>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <button
          onClick={async () => {
            const { downloadPdf } = await import('../lib/pdf')
            downloadPdf(session)
          }}
          className="bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-semibold py-4 rounded-2xl shadow-lg shadow-brand-500/25 transition-colors"
        >
          Export as PDF
        </button>
        <button
          onClick={onDraftAppeal}
          className="bg-white border border-ink-700 hover:bg-ink-900 hover:text-white text-ink-900 font-semibold py-3 rounded-2xl transition-colors"
        >
          Got a ticket? Draft an appeal letter
        </button>
        <button
          onClick={handleDelete}
          className="text-accent-600 hover:text-accent-700 font-medium py-3 transition-colors"
        >
          Delete session
        </button>
      </div>
    </div>
  )
}
