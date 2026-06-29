import type { ReactNode } from 'react'

/**
 * The white content card, previously `bg-white rounded-2xl border
 * border-paper-300 p-5` hand-written 25+ times with p-4/p-5 drift.
 * pad: md = p-5 (default) · sm = p-4. Margins/extras via className.
 * `as` keeps the original element (most were <section>).
 */
interface Props {
  as?: 'div' | 'section'
  pad?: 'sm' | 'md'
  className?: string
  children: ReactNode
}

export default function Card({ as: Tag = 'section', pad = 'md', className = '', children }: Props) {
  const p = pad === 'sm' ? 'p-4' : 'p-5'
  return (
    <Tag className={`bg-white gf-card ${p} ${className}`.trim()}>{children}</Tag>
  )
}
