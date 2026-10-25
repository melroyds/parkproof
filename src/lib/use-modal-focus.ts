import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export interface ModalFocusOptions {
  /** Where focus starts (else the first focusable element). */
  initialFocus?: RefObject<HTMLElement | null>
  onEscape?: () => void
  /**
   * Where focus goes on close when the element that opened the dialog is no
   * longer on the page (the dialog's action removed it). Without it, or when
   * it returns null, focus would drop to <body>.
   */
  returnFocus?: () => HTMLElement | null
}

/**
 * Focus handling for a modal dialog, the FeedbackModal pattern as a hook:
 * moves focus into the dialog when it mounts (to `initialFocus`, else the
 * first focusable element), keeps Tab and Shift+Tab inside it, calls
 * `onEscape` on Escape, and gives focus back to whatever had it before the
 * dialog opened when it unmounts, or to `returnFocus()` when that element
 * has gone.
 */
export function useModalFocus(dialogRef: RefObject<HTMLElement | null>, options: ModalFocusOptions = {}): void {
  // The latest handlers, so a new callback doesn't re-run the effect (which
  // would move focus back to the start).
  const onEscape = useRef(options.onEscape)
  const returnFocus = useRef(options.returnFocus)
  useEffect(() => {
    onEscape.current = options.onEscape
    returnFocus.current = options.returnFocus
  })
  const initialFocus = options.initialFocus

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const focusables = (): HTMLElement[] =>
      dialogRef.current ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)) : []

    const first = initialFocus?.current ?? focusables()[0] ?? null
    first?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onEscape.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const els = focusables()
      if (els.length === 0) return
      const head = els[0]
      const tail = els[els.length - 1]
      const active = document.activeElement as HTMLElement | null
      const inside = !!active && !!dialogRef.current?.contains(active)
      if (e.shiftKey) {
        if (!inside || active === head || !els.includes(active as HTMLElement)) {
          e.preventDefault()
          tail.focus()
        }
      } else if (!inside || active === tail || !els.includes(active as HTMLElement)) {
        e.preventDefault()
        head.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (!opener || opener.isConnected) {
        opener?.focus?.()
        return
      }
      // The opener was removed while the dialog was open.
      try {
        returnFocus.current?.()?.focus?.()
      } catch {
        /* nowhere better to go: focus stays where the browser put it */
      }
    }
  }, [dialogRef, initialFocus])
}
