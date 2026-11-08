// Where focus goes when a sheet closes and the control that opened it is
// gone (T1a). "Confirm I've left" ends the record, so the home card's and
// the record screen's "I've left" buttons are no longer on the page; focus
// moves to one of these instead of dropping to <body>.

/** The record screen's status value ("Ended" once the record has ended). */
export const RECORD_STATUS_ID = 'record-status'
/** The home screen's scan button. */
export const HOME_SCAN_ID = 'home-scan'
/** The workday card's scan button between moves (T6b): "Parked again? Scan the new sign". */
export const WORKDAY_SCAN_ID = 'workday-scan'

/** The first element on the page with one of these ids, or null. */
export function firstFocusTarget(...ids: readonly string[]): HTMLElement | null {
  if (typeof document === 'undefined') return null
  for (const id of ids) {
    const el = document.getElementById(id)
    if (el) return el
  }
  return null
}
