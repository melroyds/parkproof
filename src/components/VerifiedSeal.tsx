interface Props {
  /** Pixel size (square). */
  size?: number
  /** When true, renders the mint "spark" glow ring (use on freshly-signed
   *  records and the detail screen; omit for tiny list thumbnails). */
  glow?: boolean
  className?: string
  /**
   * What the seal says to a screen reader, in the reader's language. Pass it
   * only where the seal itself is the signal and says something true there:
   * a History row, with t('common.signedSeal') for a record signed with
   * ParkProof's key and t('session.devKeySigned') for a development-key
   * signature (spec N2: never presented as valid). Without it the seal is
   * decorative and hidden from screen readers: where the text beside it
   * already says what happened (the record screen's signature panel), and
   * where nothing has been signed (the result card after "correct", the
   * landing callout).
   */
  label?: string
}

/**
 * The Verified Seal, the Greenfield hero object. A pine certification stamp
 * with a guilloché (engine-turned) dashed rim and a rare mint glow spark,
 * pressed onto every KMS-signed, tamper-evident record. It carries from the
 * app to the exported PDF to the app icon, so the cryptographic record becomes
 * the brand's central visual mark.
 *
 * Colours are intentionally hardcoded (like BrandMark) so the seal is identical
 * everywhere it appears, including outside the app (PDF, icon).
 */
export default function VerifiedSeal({ size = 48, glow = true, className = '', label }: Props) {
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true, focusable: 'false' } as const)
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} {...a11y}>
      {/* Mint spark: the one rare use of mint, a glow ring around the seal. */}
      {glow && <circle cx="24" cy="24" r="22.5" fill="none" stroke="#7BE3A4" strokeWidth="2" />}
      {/* Guilloché rim: fine dashed pine ring, banknote/certificate feel. */}
      <circle cx="24" cy="24" r="20" fill="none" stroke="#0E5C3A" strokeWidth="1.2" strokeDasharray="1.6 1.6" />
      {/* Pine disc + check. */}
      <circle cx="24" cy="24" r="14.5" fill="#0E5C3A" />
      <path
        d="M18 24.2l4 4 8.4-8.6"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
