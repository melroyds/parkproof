interface Props {
  className?: string
  /**
   * `badge`: includes the cool off-white rounded-square background. Use as a standalone brand mark.
   * `glyph`: the layered P + clock only, transparent background. Use inside coloured surfaces.
   */
  variant?: 'badge' | 'glyph'
}

const FONT_FAMILY = "'Fraunces', Georgia, 'Times New Roman', serif"

export default function BrandMark({ className = 'w-16 h-16', variant = 'badge' }: Props) {
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="ParkProof"
    >
      {variant === 'badge' && (
        <rect x="34" y="34" width="444" height="444" rx="96" fill="#F2F4F7" />
      )}
      {/* Shadow P (navy, behind/right) */}
      <text
        x="154"
        y="394"
        fontFamily={FONT_FAMILY}
        fontSize="330"
        fontWeight="800"
        fill="#1A2233"
      >
        P
      </text>
      {/* Front P (vivid blue, on top/left) */}
      <text
        x="106"
        y="344"
        fontFamily={FONT_FAMILY}
        fontSize="330"
        fontWeight="800"
        fill="#275BFF"
      >
        P
      </text>
      {/* Alarm clock — nestled in the bowl of the front P */}
      <g transform="translate(252 185)">
        <path
          d="M-70,-50 C-94,-44 -102,-22 -94,-4 L-48,-18 C-49,-35 -57,-45 -70,-50Z"
          fill="#F2F4F7"
        />
        <path
          d="M70,-50 C94,-44 102,-22 94,-4 L48,-18 C49,-35 57,-45 70,-50Z"
          fill="#F2F4F7"
        />
        <circle cx="-82" cy="-57" r="5" fill="#F2F4F7" />
        <circle cx="82" cy="-57" r="5" fill="#F2F4F7" />
        <circle cx="0" cy="0" r="76" fill="#F2F4F7" />
        <circle cx="0" cy="0" r="68" fill="none" stroke="#275BFF" strokeWidth="10" />
        <circle cx="0" cy="0" r="84" fill="none" stroke="#F2F4F7" strokeWidth="8" />
        <line
          x1="0"
          y1="0"
          x2="-38"
          y2="-28"
          stroke="#1A2233"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <line
          x1="0"
          y1="0"
          x2="45"
          y2="-34"
          stroke="#1A2233"
          strokeWidth="12"
          strokeLinecap="round"
        />
        <circle cx="0" cy="0" r="12" fill="#1A2233" />
      </g>
    </svg>
  )
}
