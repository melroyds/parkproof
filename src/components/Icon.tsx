import type { ReactNode } from 'react'

export type IconName =
  | 'camera'
  | 'gallery'
  | 'calendar'
  | 'bell'
  | 'list'
  | 'pin'
  | 'check'
  | 'warning'

interface Props {
  name: IconName
  className?: string
  strokeWidth?: number
}

export default function Icon({ name, className = 'w-6 h-6', strokeWidth = 2 }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

const PATHS: Record<IconName, ReactNode> = {
  camera: (
    <>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h2l1.2-1.8A1.5 1.5 0 0 1 11 3.5h2a1.5 1.5 0 0 1 1.3.7L15.5 6h2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </>
  ),
  gallery: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <circle cx="8.5" cy="9.5" r="1.2" />
      <path d="m5.5 17 4.2-4.2a1.5 1.5 0 0 1 2.1 0l1.2 1.2 2.2-2.2a1.5 1.5 0 0 1 2.1 0L20 14.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M8 3.5v3M16 3.5v3M4 9h16" />
      <path d="M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9.5a6 6 0 0 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
      <path d="M9.8 19a2.4 2.4 0 0 0 4.4 0" />
      <path d="M12 3.5V3" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </>
  ),
  pin: (
    <>
      <path d="M19 10.2c0 5.2-7 10.3-7 10.3s-7-5.1-7-10.3A7 7 0 0 1 19 10.2Z" />
      <circle cx="12" cy="10.2" r="2.4" />
    </>
  ),
  check: <path d="m5 12.5 4.2 4.2L19.5 6.5" />,
  warning: (
    <>
      <path d="M10.4 4.4a1.8 1.8 0 0 1 3.2 0l7.1 13.2A1.8 1.8 0 0 1 19.1 20H4.9a1.8 1.8 0 0 1-1.6-2.4z" />
      <path d="M12 8.5v4.8M12 17h.01" />
    </>
  ),
}
