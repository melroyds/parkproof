// Handing a share link to the phone (build spec T7 item 2): the Web Share
// API where there is one, else the clipboard, else the screen shows the
// link to copy by hand.

/** How a share attempt ended. */
export type ShareOutResult =
  /** The system share sheet took the link. */
  | 'shared'
  /** The driver closed the share sheet without sharing: nothing else is tried. */
  | 'cancelled'
  /** No share sheet (or it failed): the link is on the clipboard. */
  | 'copied'
  /** Neither worked: the screen shows the link to copy by hand. */
  | 'manual'

/** The parts of `navigator` this uses (injectable for tests). */
export interface ShareNavigator {
  share?: (data: ShareData) => Promise<void>
  canShare?: (data: ShareData) => boolean
  clipboard?: { writeText?: (text: string) => Promise<void> }
}

const defaultNavigator = (): ShareNavigator | undefined =>
  typeof navigator === 'undefined' ? undefined : (navigator as ShareNavigator)

/**
 * Share `url` with the system share sheet, falling back to the clipboard.
 * Call it straight from the tap handler: `navigator.share` runs before the
 * first await, inside the tap's user activation (iOS Safari requires it).
 * Never throws.
 */
export async function shareOrCopy(
  url: string,
  text: string,
  nav: ShareNavigator | undefined = defaultNavigator(),
): Promise<ShareOutResult> {
  const data: ShareData = { text, url }
  let canShare: boolean
  try {
    canShare = !!nav && typeof nav.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare(data))
  } catch {
    canShare = false
  }
  if (canShare && nav?.share) {
    try {
      await nav.share(data)
      return 'shared'
    } catch (err) {
      // The driver dismissed the sheet: they chose not to share.
      if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError') return 'cancelled'
      // Anything else (no user activation, a sheet that failed): try the clipboard.
    }
  }
  const writeText = nav?.clipboard?.writeText
  if (typeof writeText === 'function') {
    try {
      await writeText.call(nav!.clipboard, url)
      return 'copied'
    } catch {
      /* clipboard refused: show the link instead */
    }
  }
  return 'manual'
}
