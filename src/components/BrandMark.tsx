interface Props {
  className?: string
  /**
   * `badge`: includes the rounded-square tile background (standalone mark).
   * `glyph`: the Datum P only, transparent background (use inside coloured surfaces).
   */
  variant?: 'badge' | 'glyph'
  /**
   * `pine`: pine mark on a paper tile — for light surfaces (default).
   * `paper`: paper mark + glowing mint datum point on a vault tile — for dark surfaces.
   */
  tone?: 'pine' | 'paper'
}

/**
 * Datum P — the brand mark. A P drawn as a surveyor's instrument: the bowl is
 * an engineered ring fixed to a datum point, with a single index notch (the
 * lone mint spark). It encodes "Park", a fixed verified place, and a measuring
 * instrument at once, and shares the notch motif with the Verified Seal while
 * keeping a distinct silhouette so the two never compete.
 */
export default function BrandMark({
  className = 'w-16 h-16',
  variant = 'badge',
  tone = 'pine',
}: Props) {
  const mark = tone === 'paper' ? '#F3F6F4' : '#0E5C3A'
  const dot = tone === 'paper' ? '#7BE3A4' : '#073B25'
  const tile = tone === 'paper' ? '#073B25' : '#F3F6F4'
  // Datum P paths live in a 0..100 space; nudge to optical centre per variant.
  const g = variant === 'badge' ? 'translate(4 10) scale(0.85)' : 'translate(-11 -4) scale(1.15)'
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" className={className} role="img" aria-label="ParkProof">
      {variant === 'badge' && <rect x="4" y="4" width="92" height="92" rx="22" fill={tile} />}
      <g transform={g}>
        {/* stem (plumb-line) */}
        <rect x="27" y="19" width="12.5" height="63" fill={mark} />
        {/* bowl as an engineered ring (annulus) */}
        <path
          fillRule="evenodd"
          fill={mark}
          d="M57 13 A24 24 0 1 0 57 61 A24 24 0 1 0 57 13 Z M57 25 A12 12 0 1 1 57 49 A12 12 0 1 1 57 25 Z"
        />
        {/* datum point */}
        <circle cx="57" cy="37" r="5.5" fill={dot} />
        {/* index notch — the lone mint spark */}
        <path d="M73 20 L80.5 17.5 L77.5 27 Z" fill="#7BE3A4" />
      </g>
    </svg>
  )
}
