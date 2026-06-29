import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * The one primary/secondary/outline button. Encapsulates the canonical
 * gradient/flat/outline treatments that were previously hand-written and
 * drifted across ~28 call sites (different radii, shadows, disabled states).
 *
 * - variant: primary = brand-blue gradient · secondary = flat brand ·
 *   outline = white-on-paper bordered.
 * - size: sm (py-3 rounded-xl) · md (py-4 rounded-2xl) · lg (py-5 rounded-2xl).
 *
 * Layout extras (w-full, flex-1, gap, margins) come through className.
 * The focus ring is the global :focus-visible rule in index.css.
 *
 * Genuinely bespoke buttons (the Apple/Google federation buttons, etc.)
 * stay inline by design — not everything is a primitive.
 */
type Variant = 'primary' | 'secondary' | 'outline'
type Size = 'sm' | 'md' | 'lg'

const SIZE: Record<Size, string> = {
  sm: 'py-3 rounded-xl text-base shadow-md shadow-brand-500/20',
  md: 'py-4 rounded-2xl text-base shadow-lg shadow-brand-500/25',
  lg: 'py-5 rounded-2xl text-lg shadow-xl shadow-brand-500/30',
}

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-gradient-to-r from-brand-500 via-brand-500 to-brand-700 hover:brightness-110 active:brightness-95 disabled:bg-none disabled:bg-brand-300 text-white font-semibold',
  secondary:
    'bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white font-semibold',
  outline:
    'bg-white border border-paper-300 hover:border-ink-600 disabled:opacity-60 text-ink-900 font-medium',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: Props) {
  // The outline variant carries no brand drop-shadow.
  const sizeClasses =
    variant === 'outline' ? SIZE[size].replace(/shadow-\S+/g, '').trim() : SIZE[size]
  return (
    <button
      className={`inline-flex items-center justify-center transition-colors ${VARIANT[variant]} ${sizeClasses} ${className}`
        .replace(/\s+/g, ' ')
        .trim()}
      {...rest}
    >
      {children}
    </button>
  )
}
