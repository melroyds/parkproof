// Clearing this device after the account is deleted. Settings promises it
// (settings.deleteCopy: "Local records on this device are also cleared as
// part of the sign-out that follows"), and About says one tap deletes every
// record and the account.
//
// What goes: every record (the driver's own and shared copies), their
// photos (the whole photo store, orphans included), the reminders booked for
// them (the in-tab timers here and, best-effort, the push schedules this
// device booked on the server), and the device state that only exists for
// records (the signing state, the upload markers, the workday state).
//
// What stays: this browser's own settings, which were never in the account
// (Settings says so: "Saved in this browser only, not in your account"): the
// name and saved permits, weekly reminders, the language, and this device's
// push registration.
import type { ParkingSession } from '../types'
import { deleteAllPhotos } from './photo-store'
import { cancelInTabReminders } from './notifications'
import { cancelPushReminders } from './push'
import { forgetSigningState } from './signing'
import { clearAllRecords, isActiveRecord, loadSessions } from './storage'
import { noteLocalRecordsWiped } from './sync'

export interface LocalWipeResult {
  /** How many records were removed. */
  records: number
  /** How many photos were removed, or null when the photo store couldn't be cleared. */
  photos: number | null
  /** The push cancels started (one per record whose push reminders may still fire), for callers that wait on them. */
  pushCancels: Promise<unknown>[]
}

/**
 * Could a push reminder booked for this record still fire? Decided from the
 * record, not only from its `push_reminders` cache, which is wrong both
 * ways: a booking whose answer was lost never writes it, and reminders that
 * have fired stay in it. So every active record (it may have reminders
 * booked with nothing cached), and any other whose cache holds a time still
 * ahead. A shared copy never books reminders (T7).
 */
function pushMayStillFire(record: ParkingSession, now: number): boolean {
  if (record.shared_from) return false
  if (isActiveRecord(record, now)) return true
  return Array.isArray(record.push_reminders) && record.push_reminders.some((r) => Date.parse(r?.fire_at) > now)
}

/**
 * Clear the records on this device. Call it after the account is deleted
 * on the server and the user is signed out (AuthSettings), so no sync can
 * put anything back. The records are gone before the first await (only the
 * photo store is cleared after it). The push cancels are started, not
 * awaited: each can take up to its 10 s timeout offline. A push reminder
 * whose cancel fails still fires as it was booked: its text is in the
 * schedule and the service worker doesn't look for the record, and tapping
 * it opens Home, because the record is gone.
 */
export async function clearLocalRecords(): Promise<LocalWipeResult> {
  // First, so a listing still in flight from before the delete writes nothing.
  noteLocalRecordsWiped()
  const now = Date.now()
  const records = loadSessions()

  const pushCancels: Promise<unknown>[] = []
  for (const record of records) {
    cancelInTabReminders(record.id)
    if (pushMayStillFire(record, now)) {
      pushCancels.push(
        cancelPushReminders(record.id).catch((err) => {
          console.warn('[wipe] push cancel failed:', err)
        }),
      )
    }
  }

  const removed = clearAllRecords()
  forgetSigningState()

  let photos: number | null = null
  try {
    photos = await deleteAllPhotos()
  } catch (err) {
    // The startup GC deletes photos whose record is gone, once they're a day old.
    console.warn('[wipe] photo store not cleared:', err)
  }

  return { records: removed, photos, pushCancels }
}
