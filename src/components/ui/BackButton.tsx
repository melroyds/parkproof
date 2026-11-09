import type { ReactNode } from 'react'

/**
 * The canonical "← Back" link, hand-written 15+ times and previously
 * inconsistent on its touch target. Bakes in the 44px minimum hit area.
 * The label (← Back / ← Home / etc.) is the children; the destination is
 * the onClick.
 *
 * Every back button sits straight on the dark vault (brand-800 #073B25),
 * so the colour is fixed here: sage #A9CFBE (7.4:1 on the vault), paper-50
 * on hover (12.1:1). Callers must not pass a text colour through className.
 * With two colour utilities on one element, Tailwind's stylesheet order
 * decides the winner, not the className order, which is how the old grey
 * default (1.4:1) beat every caller's override. If a back button is ever
 * needed on a light surface, add a `tone` prop here rather than stacking
 * classes. src/lib/app-shell.test.ts enforces this.
 */
interface Props {
  onClick: () => void
  children: ReactNode
  /** Layout only (margins, alignment). Never a text colour; see above. */
  className?: string
  /** For a screen that is busy (a save in progress) and can't be left yet. */
  disabled?: boolean
}

export default function BackButton({ onClick, children, className = '', disabled = false }: Props) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`self-start min-h-[44px] inline-flex items-center py-2.5 -my-2.5 text-[#A9CFBE] hover:text-paper-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm mb-4 transition-colors ${className}`.trim()}
    >
      {children}
    </button>
  )
}
