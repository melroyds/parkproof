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

// Slick + flat: solid pine, crisp radii, no gradients, no coloured drop-shadows.
const SIZE: Record<Size, string> = {
  sm: 'py-2.5 rounded-lg text-sm',
  md: 'py-3.5 rounded-xl text-base',
  lg: 'py-4 rounded-xl text-lg',
}

const VARIANT: Record<Variant, string> = {
  primary:
    'bg-brand-500 hover:bg-brand-600 active:bg-brand-700 disabled:bg-brand-300 text-white font-semibold gf-btn',
  secondary:
    'bg-brand-50 hover:bg-brand-100 active:bg-brand-200 disabled:opacity-60 text-brand-700 font-semibold',
  outline:
    'bg-white border border-paper-300 hover:border-brand-500 hover:text-brand-700 disabled:opacity-60 text-ink-900 font-medium',
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
