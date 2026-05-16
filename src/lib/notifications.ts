import type { ParkingSession } from '../types'

export type ScheduleResult =
  | 'scheduled'
  | 'denied'
  | 'unsupported'
  | 'past'
  | 'no-expiry'
  | 'too-far'

const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000 // 24 hours — keep things reasonable for in-page timers

export async function scheduleParkingReminder(
  session: ParkingSession,
  minutesBefore: number,
): Promise<ScheduleResult> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  if (!session.expires_at) return 'no-expiry'

  const reminderTime = new Date(session.expires_at).getTime() - minutesBefore * 60 * 1000
  const delay = reminderTime - Date.now()
  if (delay <= 0) return 'past'
  if (delay > MAX_TIMEOUT_MS) return 'too-far'

  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }
  if (permission !== 'granted') return 'denied'

  const locationLabel = session.location
    ? `${session.location.lat.toFixed(4)}, ${session.location.lng.toFixed(4)}`
    : 'your spot'

  setTimeout(() => {
    try {
      new Notification('⏰ Move your car', {
        body: `Parking expires in ${minutesBefore} mins at ${locationLabel}.`,
        tag: `parkproof-${session.id}`,
      })
    } catch {
      // Notification can fail silently if permission was revoked mid-flight — nothing to do.
    }
  }, delay)

  return 'scheduled'
}
