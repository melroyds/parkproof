import type { InputHTMLAttributes } from 'react'

/**
 * Text input, previously hand-written ~10 times with two divergent
 * focus-ring conventions. One accessible default (brand border + ring).
 * All native input props pass through; layout via className.
 */
type Props = InputHTMLAttributes<HTMLInputElement>

export default function Input({ className = '', ...rest }: Props) {
  return (
    <input
      className={`w-full bg-white text-ink-900 placeholder:text-ink-400 border border-paper-300 rounded-lg px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${className}`.trim()}
      {...rest}
    />
  )
}
