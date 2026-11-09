// The one-time backup prompt (build spec T2, item 12): after the first
// signed photo, suggest adding ParkProof to the Home Screen or signing in
// to back up, because Safari can clear a site's data (the records and the
// photo store with them) after 7 days without a visit.
import type { ParkingSession } from '../types'
import { recordHasSignedPhoto } from './evidence-photos'

/** Set once the prompt has been shown on this device. It is never shown again. */
export const BACKUP_PROMPT_KEY = 'parkproof.backupPrompt.v1'

export function backupPromptShown(): boolean {
  try {
    return localStorage.getItem(BACKUP_PROMPT_KEY) === '1'
  } catch {
    return false
  }
}

export function markBackupPromptShown(): void {
  try {
    localStorage.setItem(BACKUP_PROMPT_KEY, '1')
  } catch {
    /* storage blocked: the prompt may show once more on a later visit */
  }
}

export interface BackupPromptState {
  sessions: readonly ParkingSession[]
  /** Signed in: the records are backed up to the driver's account already. */
  signedIn: boolean
  /** Opened from the Home Screen: Safari's 7-day rule doesn't apply. */
  standalone: boolean
  /** Shown before on this device. */
  shown: boolean
}

/**
 * Should the prompt show now? Once, only after a photo of one of the
 * driver's own records is inside a stored signature, and only while
 * neither remedy is in place (not signed in, not opened from the Home
 * Screen).
 */
export function shouldOfferBackup(state: BackupPromptState): boolean {
  if (state.shown || state.signedIn || state.standalone) return false
  return state.sessions.some(recordHasSignedPhoto)
}
