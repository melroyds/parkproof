import { useMemo, useState } from 'react'
import type { ParkingSession } from '../types'
import { scheduleParkingReminder, type ScheduleResult } from '../lib/notifications'
import Icon from './Icon'

const MINUTES_BEFORE_EXPIRY = 15

interface Props {
  session: ParkingSession
  onDone: () => void
}

function NotifMessage({ state }: { state: ScheduleResult | 'idle' | 'pending' }) {
  switch (state) {
    case 'idle':
      return <span>Enable browser notification</span>
    case 'pending':
      return <span>Requesting permission…</span>
    case 'scheduled':
      return <span>✓ Notification scheduled</span>
    case 'denied':
      return <span>Permission denied — use the calendar option</span>
    case 'unsupported':
      return <span>Not supported on this browser</span>
    case 'past':
      return <span>Reminder time has already passed</span>
    case 'no-expiry':
      return <span>No expiry time on this session</span>
    case 'too-far':
      return <span>Expires in over 24h — use calendar instead</span>
  }
}

export default function ReminderOptions({ session, onDone }: Props) {
  const [icsState, setIcsState] = useState<'idle' | 'downloaded' | 'error'>('idle')
  const [notifState, setNotifState] = useState<ScheduleResult | 'idle' | 'pending'>('idle')

  const expiryInfo = useMemo(() => {
    if (!session.expires_at) return null
    const expires = new Date(session.expires_at)
    const reminderAt = new Date(expires.getTime() - MINUTES_BEFORE_EXPIRY * 60 * 1000)
    return {
      expiresLabel: expires.toLocaleTimeString('en-AU', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Australia/Melbourne',
      }),
      reminderLabel: reminderAt.toLocaleTimeString('en-AU', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Australia/Melbourne',
      }),
      reminderInPast: reminderAt.getTime() < Date.now(),
    }
  }, [session.expires_at])

  const handleIcs = async () => {
    try {
      const { downloadIcs } = await import('../lib/ics')
      downloadIcs(session)
      setIcsState('downloaded')
    } catch {
      setIcsState('error')
    }
  }

  const handleNotify = async () => {
    setNotifState('pending')
    const result = await scheduleParkingReminder(session, MINUTES_BEFORE_EXPIRY)
    setNotifState(result)
  }

  return (
    <div className="min-h-screen flex flex-col p-6 max-w-md mx-auto w-full">
      <h2 className="font-display text-3xl font-extrabold text-ink-900 mb-1">Set a reminder</h2>
      {expiryInfo ? (
        <p className="text-sm text-ink-700 mb-6 leading-relaxed">
          Parking expires at{' '}
          <span className="font-display font-bold text-ink-900">{expiryInfo.expiresLabel}</span>.
          We'll remind you 15 minutes before — at{' '}
          <span className="font-display font-bold text-ink-900">{expiryInfo.reminderLabel}</span>.
        </p>
      ) : (
        <p className="text-sm text-ink-700 mb-6 leading-relaxed">
          This session has no expiry time, so a timed reminder doesn't apply.
        </p>
      )}

      {/* Calendar */}
      <section className="mb-3 bg-white rounded-2xl border border-paper-300 p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
            <Icon name="calendar" className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-display font-bold text-ink-900">Calendar reminder</h3>
            <p className="text-xs text-ink-600 mt-1 leading-relaxed">
              Drops into the iPhone / Android / Outlook calendar. Survives even if you close this
              app.
            </p>
          </div>
        </div>
        <button
          onClick={handleIcs}
          disabled={icsState === 'downloaded' || !expiryInfo || expiryInfo.reminderInPast}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:bg-brand-200 disabled:text-white/70 text-white font-semibold py-3 rounded-xl shadow-md shadow-brand-500/20 transition-colors"
        >
          {icsState === 'downloaded'
            ? '✓ Downloaded — open the file to add it'
            : icsState === 'error'
              ? 'Download failed — try again'
              : 'Download .ics file'}
        </button>
      </section>

      {/* Push */}
      <section className="mb-6 bg-white rounded-2xl border border-paper-300 p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-12 h-12 rounded-xl bg-accent-50 text-accent-700 flex items-center justify-center shrink-0">
            <Icon name="bell" className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-display font-bold text-ink-900">Browser notification</h3>
            <p className="text-xs text-ink-600 mt-1 leading-relaxed">
              Only fires while this tab stays open. Good as a backup to the calendar option.
            </p>
          </div>
        </div>
        <button
          onClick={handleNotify}
          disabled={notifState === 'pending' || notifState === 'scheduled'}
          className="w-full bg-accent-500 hover:bg-accent-600 disabled:opacity-60 text-white font-semibold py-3 rounded-xl shadow-md shadow-accent-500/20 transition-colors"
        >
          <NotifMessage state={notifState} />
        </button>
      </section>

      <button
        onClick={onDone}
        className="mt-auto bg-ink-900 hover:bg-ink-800 text-white font-semibold py-4 rounded-2xl shadow-md transition-colors"
      >
        Done
      </button>
    </div>
  )
}
