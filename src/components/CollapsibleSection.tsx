import { useId, type ReactNode } from 'react'
import Icon from './Icon'

interface Props {
  /** The toggle's text, for example "Record the car's condition (optional)". */
  title: string
  open: boolean
  onToggle: () => void
  /** Short state shown on the closed toggle, for example "3 photos". */
  badge?: string | null
  /** 'vault': a glass row on the dark screens. 'paper': inside a white sheet or card. */
  tone?: 'vault' | 'paper'
  disabled?: boolean
  className?: string
  children: ReactNode
}

/**
 * An optional step, collapsed by default (design rules: the common path
 * must not get slower). The toggle is a full-width 44px+ button with
 * aria-expanded; the body is only rendered while open.
 */
export default function CollapsibleSection({
  title,
  open,
  onToggle,
  badge,
  tone = 'vault',
  disabled = false,
  className = '',
  children,
}: Props) {
  const bodyId = useId()
  const vault = tone === 'vault'
  return (
    <section className={className}>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={bodyId}
        className={`w-full min-h-[48px] px-4 py-3 flex items-center justify-between gap-3 text-left font-semibold text-sm transition-colors disabled:opacity-60 ${
          vault ? 'gf-card text-paper-50 hover:brightness-110' : 'rounded-xl border border-paper-300 bg-paper-50 text-ink-900 hover:border-brand-500'
        }`}
        style={vault ? { background: 'rgba(255,255,255,0.055)' } : undefined}
      >
        <span className="min-w-0 leading-snug">{title}</span>
        <span className="flex items-center gap-2 shrink-0">
          {badge && !open && (
            <span className={`text-xs font-medium ${vault ? 'text-[#A9CFBE]' : 'text-ink-600'}`}>{badge}</span>
          )}
          <Icon name="chevron" className={`w-5 h-5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && (
        <div id={bodyId} className="mt-2">
          {children}
        </div>
      )}
    </section>
  )
}
