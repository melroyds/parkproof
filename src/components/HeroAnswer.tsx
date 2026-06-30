interface Props {
  className?: string
}

/**
 * The landing hero — "the sign resolves into a verified record". An illustrated
 * Aussie parking sign (pine on paper, the real signage colour) feeds a stamped,
 * tamper-evident verdict card: VERIFIED RECORD, a plain-English answer, the
 * leave-by time, the KMS hash, and the Datum-notch seal pressing on. It says
 * what ParkProof actually is (a verified answer, not just an answer) in one
 * fully-designed image, replacing the old stock photo.
 *
 * Animates once on mount (scan → record rises → seal stamps + mint pulse); the
 * `gf-hero-*` classes degrade to the clean static frame under reduced-motion.
 */
export default function HeroAnswer({ className = '' }: Props) {
  return (
    <svg
      viewBox="0 0 480 300"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="A parking sign resolving into a verified parking record: you can park until 4:00 PM."
    >
      <defs>
        <filter id="hero-ds" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="9" stdDeviation="12" floodColor="#000" floodOpacity="0.30" />
        </filter>
        <pattern id="hero-gl" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(115)">
          <rect width="9" height="9" fill="#FFFFFF" />
          <rect width="1" height="9" fill="#0E5C3A" fillOpacity="0.06" />
        </pattern>
        <clipPath id="hero-sign">
          <path d="M70 78 H156 L174 96 V196 H70 Z" />
        </clipPath>
      </defs>

      {/* ambient mint glow */}
      <ellipse cx="270" cy="150" rx="210" ry="124" fill="#7BE3A4" opacity="0.06" />

      {/* the sign on its post */}
      <rect x="118" y="172" width="8" height="118" rx="3" fill="#0B2A1C" />
      <g transform="rotate(-5 122 130)">
        <path d="M70 78 H156 L174 96 V196 H70 Z" fill="#F3F6F4" />
        <text x="84" y="158" fontFamily="'Space Grotesk', sans-serif" fontWeight="700" fontSize="46" fill="#0E5C3A" letterSpacing="-1">2P</text>
        <path d="M84 100 H140 M133 93 L141 100 L133 107" stroke="#0E5C3A" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {/* scan sweep, clipped to the sign face */}
        <g clipPath="url(#hero-sign)">
          <g className="gf-hero-scan">
            <rect x="70" y="92" width="104" height="22" fill="#7BE3A4" opacity="0.16" />
            <rect x="70" y="103" width="104" height="2.5" fill="#7BE3A4" />
          </g>
        </g>
      </g>

      {/* the verified record card */}
      <g className="gf-hero-card">
        <path d="M196 84 H432 L456 108 V232 H196 Z" fill="url(#hero-gl)" filter="url(#hero-ds)" />
        <text x="218" y="116" fontFamily="'IBM Plex Mono', monospace" fontWeight="500" fontSize="11" fill="#0E5C3A" letterSpacing="1.5">VERIFIED RECORD</text>
        <text x="218" y="152" fontFamily="'Space Grotesk', sans-serif" fontWeight="700" fontSize="26" fill="#0B1A14" letterSpacing="-0.5">You can park</text>
        <rect x="218" y="166" width="150" height="32" rx="8" fill="#0E5C3A" />
        <text x="234" y="188" fontFamily="'Inter', sans-serif" fontWeight="600" fontSize="15" fill="#EAF7EF">until 4:00 PM</text>
        <text x="218" y="222" fontFamily="'IBM Plex Mono', monospace" fontWeight="500" fontSize="11" fill="#0E5C3A" opacity="0.7">KMS · f3a9c4…b21</text>
      </g>

      {/* the seal, pressed onto the record */}
      <circle className="gf-hero-pulse" cx="430" cy="200" r="26" fill="none" stroke="#7BE3A4" strokeWidth="2" />
      <g className="gf-hero-seal">
        <circle cx="430" cy="200" r="29" fill="none" stroke="#7BE3A4" strokeWidth="1.6" />
        <circle cx="430" cy="200" r="26" fill="none" stroke="#7BE3A4" strokeWidth="1" strokeDasharray="1.4 1.6" />
        <circle cx="430" cy="200" r="20" fill="#0E5C3A" />
        <path d="M419 200 l6.5 6.5 13.5-14.5" stroke="#FFFFFF" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}
