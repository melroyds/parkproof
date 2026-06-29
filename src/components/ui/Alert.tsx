import type { ReactNode } from 'react'

/**
 * Inline notice box, previously hand-written ~6 times. ParkProof's
 * convention: brand-blue for informational notices, teal accent for
 * "something needs attention / went wrong" (red is reserved for the
 * parking STOP verdict only), so this keeps that grammar rather than
 * introducing red error boxes.
 *
 * - variant: info (brand) · notice (accent).
 * - role: status (polite live region, default) · alert.
 */
type Variant = 'info' | 'notice'

const VARIANT: Record<Variant, string> = {
  info: 'bg-brand-50 border-brand-200 text-brand-800',
  notice: 'bg-accent-50 border-accent-300 text-accent-800',
}

interface Props {
  variant?: Variant
  role?: 'status' | 'alert'
  id?: string
  className?: string
  children: ReactNode
}

export default function Alert({
  variant = 'info',
  role = 'status',
  id,
  className = '',
  children,
}: Props) {
  return (
    <div
      id={id}
      role={role}
      aria-live={role === 'status' ? 'polite' : undefined}
      className={`border rounded-xl p-3 text-sm leading-relaxed ${VARIANT[variant]} ${className}`.trim()}
    >
      {children}
    </div>
  )
}
