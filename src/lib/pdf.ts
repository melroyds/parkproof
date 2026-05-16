import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { AppealDraft, ParkingSession } from '../types'
import { ACCURACY_USABLE_M, formatAccuracy } from './accuracy'
import { sessionTimezone } from './timezone'

const MARGIN = 40

// ─── Time helpers ───────────────────────────────────────────────────────────
function timezoneFor(session: ParkingSession): string {
  // Thin wrapper — kept so the existing callsites stay readable.
  return sessionTimezone(session.location)
}

function fmtLocal(iso: string, timezone: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function fmtLocalShort(iso: string, timezone: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// ─── Content helpers ────────────────────────────────────────────────────────
// Phrases that indicate a current-time conclusion rather than a sign restriction.
// The ParkProof Guidance row already conveys this info; strip from sign rules so
// the same fact doesn't appear twice in the PDF.
const GUIDANCE_PHRASES = [
  'currently outside',
  'currently inside',
  'currently in',
  'free now',
  'free until',
  'must leave',
  'must move',
  'you can stay',
  'you can park for',
  'until the next',
]

function isGuidanceSentence(sentence: string): boolean {
  const lower = sentence.toLowerCase()
  return GUIDANCE_PHRASES.some((p) => lower.includes(p))
}

function splitRules(rules: string): string {
  // Split on '; ' and '. ' (period-space, but not the trailing period of the string).
  // One sub-condition per line. Drop any "currently free/leave by" conclusions
  // that the model may have included historically (now covered by Guidance row).
  return rules
    .replace(/\.\s+/g, '.\n')
    .replace(/;\s+/g, ';\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isGuidanceSentence(s))
    .join('\n')
    .trim()
}

function buildGuidance(session: ParkingSession, timezone: string): string {
  if (!session.expires_at) {
    return 'Free to park. No expiry shown on the sign.'
  }
  const expiresMs = new Date(session.expires_at).getTime()
  // If the PDF is exported AFTER expiry (typical for evidence-after-the-fact),
  // the "Move by …" copy reads as a contradiction. State the past tense honestly
  // — the evidence record is about what the session was at the time of parking.
  if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
    return `Session expired at ${fmtLocalShort(session.expires_at, timezone)}.`
  }
  return `Free to park. Move by ${fmtLocalShort(session.expires_at, timezone)}.`
}

// ─── PDF layout helpers ─────────────────────────────────────────────────────
function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const pageHeight = doc.internal.pageSize.getHeight()
  if (y + needed > pageHeight - MARGIN) {
    doc.addPage()
    return MARGIN
  }
  return y
}

function addImageWithOverlayCaption(
  doc: jsPDF,
  dataUrl: string,
  y: number,
  caption: string[],
  maxHeight = 300,
): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const maxWidth = pageWidth - 2 * MARGIN
  try {
    const props = doc.getImageProperties(dataUrl)
    const ratio = Math.min(maxWidth / props.width, maxHeight / props.height)
    const w = props.width * ratio
    const h = props.height * ratio
    doc.addImage(dataUrl, 'JPEG', MARGIN, y, w, h)

    // Caption overlay: semi-transparent dark pill at the bottom of the image.
    const lineHeight = 12
    const padding = 8
    const captionBlockHeight = caption.length * lineHeight + padding * 2
    const captionX = MARGIN + 10
    const captionY = y + h - captionBlockHeight - 10
    const captionW = w - 20

    // GState lets us draw with opacity. Wrapped in save/restore so we don't
    // leak the opacity setting to subsequent draw calls.
    const docAny = doc as unknown as {
      saveGraphicsState: () => void
      restoreGraphicsState: () => void
      setGState: (gstate: unknown) => void
      GState: new (opts: { opacity: number }) => unknown
    }
    if (typeof docAny.saveGraphicsState === 'function') {
      docAny.saveGraphicsState()
      docAny.setGState(new docAny.GState({ opacity: 0.7 }))
    }
    doc.setFillColor(15, 23, 42)
    doc.roundedRect(captionX, captionY, captionW, captionBlockHeight, 6, 6, 'F')
    if (typeof docAny.restoreGraphicsState === 'function') {
      docAny.restoreGraphicsState()
    }

    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    caption.forEach((line, i) => {
      doc.text(line, captionX + padding, captionY + padding + (i + 1) * lineHeight - 2)
    })
    doc.setTextColor(0, 0, 0)

    return y + h
  } catch {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'italic')
    doc.text('(Image could not be embedded)', MARGIN, y + 14)
    return y + 20
  }
}

function addImageFitted(doc: jsPDF, dataUrl: string, y: number, maxHeight = 300): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const maxWidth = pageWidth - 2 * MARGIN
  try {
    const props = doc.getImageProperties(dataUrl)
    const ratio = Math.min(maxWidth / props.width, maxHeight / props.height)
    const w = props.width * ratio
    const h = props.height * ratio
    doc.addImage(dataUrl, 'JPEG', MARGIN, y, w, h)
    return y + h
  } catch {
    doc.setFontSize(10)
    doc.setFont('helvetica', 'italic')
    doc.text('(Image could not be embedded)', MARGIN, y + 14)
    return y + 20
  }
}

// ─── Main entry ─────────────────────────────────────────────────────────────
export function downloadPdf(session: ParkingSession): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const timezone = timezoneFor(session)
  let y = MARGIN

  // Title
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text('ParkProof — Parking Evidence', MARGIN, y)
  y += 28

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100)
  doc.text(`Session ID: ${session.id}`, MARGIN, y)
  y += 14
  doc.text(`PDF generated: ${new Date().toLocaleString('en-AU')}`, MARGIN, y)
  y += 22

  // Summary table
  doc.setTextColor(15, 23, 42)
  // Describe how the location was obtained — relevant for evidence reliability.
  let locationSourceLabel = '—'
  if (session.location) {
    if (session.location.source === 'manual') {
      locationSourceLabel = 'Manually entered'
    } else if (session.location.source === 'gps') {
      const acc = session.location.accuracy_meters
      if (typeof acc === 'number') {
        locationSourceLabel =
          acc > ACCURACY_USABLE_M
            ? `GPS — LOW ACCURACY ${formatAccuracy(acc)} (see appendix)`
            : `GPS — ${formatAccuracy(acc)}`
      } else {
        locationSourceLabel = 'GPS'
      }
    } else {
      locationSourceLabel = 'Captured'
    }
  }

  const body: [string, string][] = [
    ['Arrived at', fmtLocal(session.arrived_at, timezone)],
    ['Expires at', session.expires_at ? fmtLocal(session.expires_at, timezone) : '—'],
    ['ParkProof Guidance', buildGuidance(session, timezone)],
    ['Address', session.location?.address ?? '—'],
    [
      'Location (GPS)',
      session.location
        ? `${session.location.lat.toFixed(6)}, ${session.location.lng.toFixed(6)}`
        : 'Not captured',
    ],
    ['Location source', locationSourceLabel],
    [
      'Map link',
      session.location
        ? `https://www.google.com/maps?q=${session.location.lat},${session.location.lng}`
        : '—',
    ],
    ['Side / Variant selected', session.chosen_label || '—'],
    ['Sign rules', splitRules(session.rules)],
    ['AI confidence', session.confidence],
  ]
  autoTable(doc, {
    startY: y,
    head: [['Field', 'Value']],
    body,
    styles: { fontSize: 10, cellPadding: 6, valign: 'top' },
    headStyles: { fillColor: [15, 23, 42] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 130 } },
    margin: { left: MARGIN, right: MARGIN },
  })
  const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
  y = (lastTable?.finalY ?? y) + 24

  // Sign photo — sits on page 1 directly after the summary table
  y = ensureSpace(doc, y, 320)
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.text('Sign photo', MARGIN, y)
  y += 14
  y = addImageFitted(doc, session.sign_photo, y) + 18

  // Car photo with caption overlay
  if (session.car_photo) {
    y = ensureSpace(doc, y, 320)
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.text('Car at the spot', MARGIN, y)
    y += 14

    const caption: string[] = []
    if (session.location?.address) {
      caption.push(session.location.address)
    } else if (session.location) {
      caption.push(
        `${session.location.lat.toFixed(5)}, ${session.location.lng.toFixed(5)}`,
      )
    }
    caption.push(fmtLocal(session.arrived_at, timezone))

    y = addImageWithOverlayCaption(doc, session.car_photo, y, caption) + 18
  }

  // Low-accuracy GPS disclaimer (when relevant)
  const acc = session.location?.accuracy_meters
  if (session.location?.source === 'gps' && typeof acc === 'number' && acc > ACCURACY_USABLE_M) {
    y = ensureSpace(doc, y, 60)
    doc.setFillColor(248, 233, 227) // accent-50
    doc.setDrawColor(192, 87, 58) // accent-500
    doc.setLineWidth(1)
    doc.roundedRect(MARGIN, y, doc.internal.pageSize.getWidth() - 2 * MARGIN, 50, 6, 6, 'FD')
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(142, 61, 39) // accent-700
    doc.text('⚠ GPS accuracy notice', MARGIN + 12, y + 18)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(45, 55, 79) // ink-700
    const disclaimer = `The GPS reading at capture time was ${formatAccuracy(acc)} — wider than typical for evidence purposes. The coordinates above identify a point within that radius, not an exact spot. Common causes: indoor / multi-storey carparks, Starlink or VPN connections, or weak satellite signal. Reviewers should weight the captured address against this radius.`
    const wrapped = doc.splitTextToSize(
      disclaimer,
      doc.internal.pageSize.getWidth() - 2 * MARGIN - 24,
    )
    doc.text(wrapped, MARGIN + 12, y + 30)
    y += 60
  }

  // User note — context the user added about why they were here.
  // Reviewers value this: an "appointment at hospital" or "school pickup"
  // can materially soften a council's stance.
  if (session.note && session.note.trim()) {
    y = ensureSpace(doc, y, 80)
    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(15, 23, 42)
    doc.text("Driver's note", MARGIN, y)
    y += 16
    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(45, 55, 79)
    const pageWidth0 = doc.internal.pageSize.getWidth()
    const noteLines = doc.splitTextToSize(
      session.note.trim(),
      pageWidth0 - 2 * MARGIN,
    )
    for (const line of noteLines) {
      y = ensureSpace(doc, y, 13)
      doc.text(line, MARGIN, y)
      y += 13
    }
    y += 10
  }

  // Statement
  y = ensureSpace(doc, y, 80)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'italic')
  doc.setTextColor(80)
  const statement =
    'This record was generated automatically by ParkProof at the time of parking. The arrival timestamp, GPS coordinates, sign translation, and photographs constitute a contemporaneous evidence record suitable for attachment to a parking infringement review submission with the relevant Australian local council.'
  const pageWidth = doc.internal.pageSize.getWidth()
  const wrapped = doc.splitTextToSize(statement, pageWidth - 2 * MARGIN)
  doc.text(wrapped, MARGIN, y)

  // Signature appendix (only if the session was signed AND the bundle is
  // structurally complete). Older sessions saved during the deploy-bug
  // window briefly had an empty-object signature; we don't want a partial
  // bundle to crash the whole PDF. If anything is missing or the appendix
  // itself fails, log + continue without it — the main evidence record
  // (page 1) is the user's actual deliverable.
  if (isValidSignature(session.signature)) {
    try {
      drawSignatureAppendix(doc, session.signature)
    } catch (err) {
      console.warn('[pdf] signature appendix failed, omitting:', err)
    }
  } else if (session.signature) {
    console.warn(
      '[pdf] signature bundle is incomplete, omitting appendix. Saved fields:',
      Object.keys(session.signature),
    )
  }

  doc.save(`parkproof-${session.id.slice(0, 8)}.pdf`)
}

/**
 * A signature bundle is "valid enough to render" if every field the appendix
 * actually reads is present and a string. We don't verify cryptographically
 * here — the PDF surfaces the raw bytes for an external `openssl dgst` check.
 */
function isValidSignature(
  sig: ParkingSession['signature'],
): sig is NonNullable<ParkingSession['signature']> {
  if (!sig || typeof sig !== 'object') return false
  const required = [
    'schema',
    'signed_at',
    'algorithm',
    'key_alias',
    'canonical_payload',
    'signature_base64',
  ] as const
  return required.every((k) => typeof sig[k] === 'string' && sig[k].length > 0)
}

function drawSignatureAppendix(doc: jsPDF, sig: NonNullable<ParkingSession['signature']>): void {
  doc.addPage()
  let y = MARGIN
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text('Cryptographic signature', MARGIN, y)
  y += 26

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(80)
  const intro =
    "This evidence record was signed by ParkProof's AWS KMS-managed private key at the time of saving. The signature lets any third party (council, court, insurer) verify that the metadata and photo hashes below have not been altered since the signed_at timestamp. The private key never leaves AWS; the public key is published openly for verification."
  const introWrapped = doc.splitTextToSize(intro, pageWidth - 2 * MARGIN)
  doc.text(introWrapped, MARGIN, y)
  y += introWrapped.length * 12 + 10

  // Compact metadata table
  doc.setTextColor(15, 23, 42)
  autoTable(doc, {
    startY: y,
    head: [['Field', 'Value']],
    body: [
      ['Algorithm', sig.algorithm],
      ['Key alias', sig.key_alias],
      ['Signed at (UTC)', sig.signed_at],
      ['Schema', sig.schema],
      [
        'Public key URL',
        'https://d1jmpu2roekssu.cloudfront.net/parkproof-public-key.pem',
      ],
    ],
    styles: { fontSize: 9, cellPadding: 5, valign: 'top' },
    headStyles: { fillColor: [15, 23, 42] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 110 } },
    margin: { left: MARGIN, right: MARGIN },
  })
  const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
  y = (lastTable?.finalY ?? y) + 18

  // Canonical payload + signature blobs in monospace
  doc.setFont('courier', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(40)

  y = ensureSpace(doc, y, 40)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42)
  doc.text('Canonical payload (the exact bytes that were signed):', MARGIN, y)
  y += 14
  doc.setFont('courier', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(40)
  const payloadLines = doc.splitTextToSize(sig.canonical_payload, pageWidth - 2 * MARGIN)
  for (const line of payloadLines) {
    y = ensureSpace(doc, y, 9)
    doc.text(line, MARGIN, y)
    y += 9
  }
  y += 10

  y = ensureSpace(doc, y, 40)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42)
  doc.text('Signature (DER, base64):', MARGIN, y)
  y += 14
  doc.setFont('courier', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(40)
  const sigLines = doc.splitTextToSize(sig.signature_base64, pageWidth - 2 * MARGIN)
  for (const line of sigLines) {
    y = ensureSpace(doc, y, 9)
    doc.text(line, MARGIN, y)
    y += 9
  }
  y += 14

  // Verification instructions
  y = ensureSpace(doc, y, 100)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42)
  doc.text('To verify with openssl (any platform):', MARGIN, y)
  y += 14
  doc.setFont('courier', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(40)
  const verifySteps = [
    '1. Save the canonical payload above to a file: payload.txt (no trailing newline)',
    '2. Save the signature base64 string above to a file: sig.base64',
    '3. Download the public key:',
    '   curl -O https://d1jmpu2roekssu.cloudfront.net/parkproof-public-key.pem',
    '4. Decode the signature:',
    '   base64 -d sig.base64 > sig.bin',
    '5. Verify:',
    '   openssl dgst -sha256 -verify parkproof-public-key.pem \\',
    '     -signature sig.bin payload.txt',
    '6. Expect output: "Verified OK"',
  ]
  for (const line of verifySteps) {
    y = ensureSpace(doc, y, 12)
    doc.text(line, MARGIN, y)
    y += 12
  }
}

// ─── Appeal letter PDF ──────────────────────────────────────────────────────
export function downloadAppealPdf(params: {
  session: ParkingSession
  draft: AppealDraft
  editedLetter: string
  ticketPhoto: string
}): void {
  const { session, draft, editedLetter, ticketPhoto } = params
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const timezone = timezoneFor(session)
  const pageWidth = doc.internal.pageSize.getWidth()
  let y = MARGIN

  // Title
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(draft.appeal_subject, MARGIN, y, { maxWidth: pageWidth - 2 * MARGIN })
  y += 32

  // Meta
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100)
  doc.text(`Drafted ${new Date().toLocaleString('en-AU')}`, MARGIN, y)
  y += 14
  doc.text(`Linked ParkProof session: ${session.id}`, MARGIN, y)
  y += 22

  // Letter body
  doc.setTextColor(15, 23, 42)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'normal')
  const lines = doc.splitTextToSize(editedLetter, pageWidth - 2 * MARGIN)
  for (const line of lines) {
    y = ensureSpace(doc, y, 14)
    doc.text(line, MARGIN, y)
    y += 14
  }
  y += 18

  // Evidence summary
  y = ensureSpace(doc, y, 200)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('Supporting evidence (from ParkProof)', MARGIN, y)
  y += 16

  const body: [string, string][] = [
    ['Arrived at', fmtLocal(session.arrived_at, timezone)],
    [
      'Expires at',
      session.expires_at ? fmtLocal(session.expires_at, timezone) : '—',
    ],
    ['Address', session.location?.address ?? '—'],
    [
      'GPS',
      session.location
        ? `${session.location.lat.toFixed(6)}, ${session.location.lng.toFixed(6)}`
        : 'Not captured',
    ],
    [
      'Map link',
      session.location
        ? `https://www.google.com/maps?q=${session.location.lat},${session.location.lng}`
        : '—',
    ],
    ['Side selected', session.chosen_label || '—'],
    ['Sign rules', session.rules],
  ]
  autoTable(doc, {
    startY: y,
    head: [['Field', 'Value']],
    body,
    styles: { fontSize: 9, cellPadding: 5, valign: 'top' },
    headStyles: { fillColor: [15, 23, 42] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 110 } },
    margin: { left: MARGIN, right: MARGIN },
  })
  const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
  y = (lastTable?.finalY ?? y) + 24

  // Ticket photo
  y = ensureSpace(doc, y, 300)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Infringement notice (photo)', MARGIN, y)
  y += 14
  y = addImageFitted(doc, ticketPhoto, y, 260) + 18

  // Sign photo
  y = ensureSpace(doc, y, 300)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Parking sign at the time of parking', MARGIN, y)
  y += 14
  y = addImageFitted(doc, session.sign_photo, y, 260) + 18

  // Car photo (if any)
  if (session.car_photo) {
    y = ensureSpace(doc, y, 300)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('Car at the spot', MARGIN, y)
    y += 14

    const caption: string[] = []
    if (session.location?.address) {
      caption.push(session.location.address)
    } else if (session.location) {
      caption.push(
        `${session.location.lat.toFixed(5)}, ${session.location.lng.toFixed(5)}`,
      )
    }
    caption.push(fmtLocal(session.arrived_at, timezone))

    addImageWithOverlayCaption(doc, session.car_photo, y, caption, 260)
  }

  doc.save(`parkproof-appeal-${session.id.slice(0, 8)}.pdf`)
}
