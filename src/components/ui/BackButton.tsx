import type { ReactNode } from 'react'

/**
 * The canonical "← Back" link, hand-written 15+ times and previously
 * inconsistent on its touch target. Bakes in the 44px minimum hit area.
 * The label (← Back / ← Home / etc.) is the children; the destination is
 * the onClick.
 */
interface Props {
  onClick: () => void
  children: ReactNode
  className?: string
}

export default function BackButton({ onClick, children, className = '' }: Props) {
  return (
    <button
      onClick={onClick}
      className={`self-start min-h-[44px] inline-flex items-center py-2.5 -my-2.5 text-ink-600 hover:text-ink-900 text-sm mb-4 transition-colors ${className}`.trim()}
    >
      {children}
    </button>
  )
}
