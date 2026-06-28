import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { TFunction } from 'i18next'
import type { AppealDraft, ParkingSession } from '../types'
import { ACCURACY_USABLE_M, formatAccuracy } from './accuracy'
import { sessionTimezone } from './timezone'
import { registerPdfFonts } from './pdf-fonts'

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

/**
 * Build the two ended_at-conditional rows for the evidence table — only
 * included when the driver explicitly signalled "I've left" on this session.
 * Shared across all three PDF generators (single-session evidence, appeal
 * attachment, full account export) so the duration math stays consistent.
 *
 * Returns an empty array when no ended_at is set; callers just spread the
 * result inline.
 */
function endedRows(
  session: ParkingSession,
  timezone: string,
  t: TFunction,
): [string, string][] {
  if (!session.ended_at) return []
  const rows: [string, string][] = [
    [t('pdf.evidence.field.endedAt'), fmtLocal(session.ended_at, timezone)],
  ]
  // Duration: arrived → ended. Only emit when both timestamps parse and the
  // result is non-negative (defensive — a clock skew could in theory produce
  // a negative). Show as "Xh Ym" with i18n-aware phrasing.
  const arrivedMs = new Date(session.arrived_at).getTime()
  const endedMs = new Date(session.ended_at).getTime()
  if (Number.isFinite(arrivedMs) && Number.isFinite(endedMs) && endedMs >= arrivedMs) {
    const totalMins = Math.max(0, Math.round((endedMs - arrivedMs) / 60_000))
    const hours = Math.floor(totalMins / 60)
    const mins = totalMins % 60
    // Dedicated bare-duration keys (pdf.duration.*) — same plural-aware pattern
    // as time.parkedFor* but without the "Parked for " prefix, which doesn't
    // fit the table-cell context (the row label already says "Actual duration").
    let durationLabel: string
    if (hours === 0) {
      durationLabel = t('pdf.duration.minOnly', { count: mins })
    } else if (mins === 0) {
      durationLabel =
        hours === 1
          ? t('pdf.duration.hourOnly', { count: hours })
          : t('pdf.duration.hoursOnly', { count: hours })
    } else {
      durationLabel = t('pdf.duration.hoursAndMins', { hours, mins })
    }
    rows.push([t('pdf.evidence.field.actualDuration'), durationLabel])
  }
  return rows
}

function buildGuidance(session: ParkingSession, timezone: string, t: TFunction): string {
  if (!session.expires_at) {
    return t('pdf.evidence.guidanceFreeNoExpiry')
  }
  const expiresMs = new Date(session.expires_at).getTime()
  // If the PDF is exported AFTER expiry (typical for evidence-after-the-fact),
  // the "Move by …" copy reads as a contradiction. State the past tense honestly
  // — the evidence record is about what the session was at the time of parking.
  if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
    return t('pdf.evidence.guidanceExpired', {
      when: fmtLocalShort(session.expires_at, timezone),
    })
  }
  return t('pdf.evidence.guidanceFree', {
    when: fmtLocalShort(session.expires_at, timezone),
  })
}

// ─── Cross-device photo materialization ────────────────────────────────────
/**
 * Cross-device fix: when a signed-in user pulls sessions from the cloud,
 * `sign_photo` / `car_photo` / `ambient_photo` arrive as short-TTL presigned
 * S3 GET URLs (HTTPS), not base64 data URLs. jsPDF's `addImage` and
 * `getImageProperties` only work synchronously with data URLs — passing an
 * HTTPS URL throws, which the PDF code catches and renders the
 * "Image could not be embedded" fallback. The user sees this on every
 * cross-device PDF even though the photos exist in S3.
 *
 * Fix: before generating the PDF, fetch any HTTPS photo URLs and convert
 * them to data URLs. Per-field failures are tolerated — if one photo can't
 * be fetched (S3 404, expired presign, network), the others still embed and
 * only the bad field falls back to "could not be embedded".
 *
 * Returns a NEW session object — the original is not mutated, because the
 * caller's localStorage copy should keep its HTTPS URLs (they'll be re-minted
 * with a fresh 1h TTL on the next /sessions/list call; the data URL we
 * generate here is only needed for the in-flight PDF).
 */
export async function materializeRemotePhotos(
  session: ParkingSession,
): Promise<ParkingSession> {
  // Lazy-import sync.ts to keep its deps out of the PDF chunk when the
  // session is fully same-device (every photo already a data URL).
  const { materializePhotoFromCloud } = await import('./sync')

  const fields = ['sign_photo', 'car_photo', 'ambient_photo'] as const
  const fieldToRole: Record<(typeof fields)[number], 'sign' | 'car' | 'ambient'> = {
    sign_photo: 'sign',
    car_photo: 'car',
    ambient_photo: 'ambient',
  }
  const out: ParkingSession = { ...session }
  await Promise.all(
    fields.map(async (field) => {
      const value = session[field]
      if (typeof value !== 'string') return
      if (value.startsWith('data:')) return // already inline; nothing to do
      if (!/^https?:/i.test(value)) return // not a remote URL we need to fetch
      try {
        // Server-side proxy fetches from S3 and returns base64. The direct
        // browser-to-S3 path (previously here) worked on desktop but failed
        // on some mobile carriers — see CLAUDE.md gotcha.
        const dataUrl = await materializePhotoFromCloud(
          session.id,
          fieldToRole[field],
        )
        if (dataUrl) {
          out[field] = dataUrl
        }
        // null → S3 has no object at the canonical key (historical session
        // from before the upload-CORS fix). Leave the field as the HTTPS
        // URL; jsPDF will catch and render the "could not embed" fallback.
      } catch (err) {
        console.warn(`[pdf] photo materialize failed for ${field}:`, err)
      }
    }),
  )
  return out
}

/**
 * Batch wrapper for the full-export PDF, which renders one block per session
 * and so needs every session's photos materialized up front.
 */
export async function materializeRemotePhotosBatch(
  sessions: ParkingSession[],
): Promise<ParkingSession[]> {
  return Promise.all(sessions.map(materializeRemotePhotos))
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
  t: TFunction,
  activeFont: string,
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
    doc.setFont(activeFont, 'normal')
    doc.setFontSize(9)
    caption.forEach((line, i) => {
      doc.text(line, captionX + padding, captionY + padding + (i + 1) * lineHeight - 2)
    })
    doc.setTextColor(0, 0, 0)

    return y + h
  } catch {
    doc.setFontSize(10)
    doc.setFont(activeFont, 'italic')
    doc.text(t('pdf.common.imageEmbedFailed'), MARGIN, y + 14)
    return y + 20
  }
}

function addImageFitted(
  doc: jsPDF,
  dataUrl: string,
  y: number,
  t: TFunction,
  activeFont: string,
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
    return y + h
  } catch {
    doc.setFontSize(10)
    doc.setFont(activeFont, 'italic')
    doc.text(t('pdf.common.imageEmbedFailed'), MARGIN, y + 14)
    return y + 20
  }
}

// ─── Main entry ─────────────────────────────────────────────────────────────
export function downloadPdf(
  session: ParkingSession,
  t: TFunction,
  locale: string,
): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  // Register the locale's Noto Sans font (if needed) and get back the
  // family name to thread through all setFont() calls. For en/it/id this
  // returns 'helvetica' — same as before. For zh-CN / ko / vi / el / hi /
  // pa it returns the registered Noto family, enabling glyph rendering.
  // Caller MUST have prefetched the font (see prefetchPdfFont in
  // pdf-fonts.ts); otherwise this returns 'helvetica' with a console
  // warning and the PDF renders with missing glyphs.
  const activeFont = registerPdfFonts(doc, locale)
  const timezone = timezoneFor(session)
  let y = MARGIN

  // Title
  doc.setFontSize(22)
  doc.setFont(activeFont, 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(t('pdf.evidence.title'), MARGIN, y)
  y += 28

  doc.setFontSize(10)
  doc.setFont(activeFont, 'normal')
  doc.setTextColor(100)
  doc.text(t('pdf.evidence.sessionId', { id: session.id }), MARGIN, y)
  y += 14
  doc.text(
    t('pdf.evidence.generated', { when: new Date().toLocaleString('en-AU') }),
    MARGIN,
    y,
  )
  y += 22

  // Summary table
  doc.setTextColor(15, 23, 42)
  // Describe how the location was obtained — relevant for evidence reliability.
  let locationSourceLabel = t('pdf.evidence.locationSourceValue.none')
  if (session.location) {
    if (session.location.source === 'manual') {
      locationSourceLabel = t('pdf.evidence.locationSourceValue.manuallyEntered')
    } else if (session.location.source === 'gps') {
      const acc = session.location.accuracy_meters
      if (typeof acc === 'number') {
        locationSourceLabel =
          acc > ACCURACY_USABLE_M
            ? t('pdf.evidence.locationSourceValue.gpsLowAccuracy', {
                accuracy: formatAccuracy(acc),
              })
            : t('pdf.evidence.locationSourceValue.gpsWithAccuracy', {
                accuracy: formatAccuracy(acc),
              })
      } else {
        locationSourceLabel = t('pdf.evidence.locationSourceValue.gps')
      }
    } else {
      locationSourceLabel = t('pdf.evidence.locationSourceValue.captured')
    }
  }

  const dash = t('pdf.common.dash')
  const notCaptured = t('pdf.common.notCaptured')

  const body: [string, string][] = [
    [t('pdf.evidence.field.arrivedAt'), fmtLocal(session.arrived_at, timezone)],
    [
      t('pdf.evidence.field.expiresAt'),
      session.expires_at ? fmtLocal(session.expires_at, timezone) : dash,
    ],
    // ended_at + actual-duration rows are appended only when the driver
    // explicitly signalled "I've left" — empty array otherwise so the
    // shape of the evidence record matches sessions saved before the
    // feature shipped.
    ...endedRows(session, timezone, t),
    [t('pdf.evidence.field.guidance'), buildGuidance(session, timezone, t)],
    [t('pdf.evidence.field.address'), session.location?.address ?? dash],
    [
      t('pdf.evidence.field.locationGps'),
      session.location
        ? `${session.location.lat.toFixed(6)}, ${session.location.lng.toFixed(6)}`
        : notCaptured,
    ],
    [t('pdf.evidence.field.locationSource'), locationSourceLabel],
    [
      t('pdf.evidence.field.mapLink'),
      session.location
        ? `https://www.google.com/maps?q=${session.location.lat},${session.location.lng}`
        : dash,
    ],
    [t('pdf.evidence.field.sideVariant'), session.chosen_label || dash],
    [
      t('pdf.evidence.field.signRules'),
      session.no_sign ? t('pdf.evidence.noSignRules') : splitRules(session.rules),
    ],
    // AI confidence is meaningless on no-sign sessions; surface that explicitly
    // instead of writing "low" (which is the data default but reads as wrong).
    [
      t('pdf.evidence.field.aiConfidence'),
      session.no_sign ? t('pdf.evidence.noSignConfidence') : session.confidence,
    ],
  ]
  autoTable(doc, {
    startY: y,
    head: [[t('pdf.common.fieldHeader'), t('pdf.common.valueHeader')]],
    body,
    // font: activeFont threads the locale's registered Noto Sans into
    // autoTable's cell rendering. Without this autoTable falls back to its
    // default helvetica regardless of what we setFont() globally, and the
    // table cells render as missing-glyph boxes in non-Latin locales.
    styles: { font: activeFont, fontSize: 10, cellPadding: 6, valign: 'top' },
    headStyles: { fillColor: [15, 23, 42] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 130 } },
    margin: { left: MARGIN, right: MARGIN },
  })
  const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
  y = (lastTable?.finalY ?? y) + 24

  // Sign photo (translated sessions) OR ambient surroundings photo (no-sign
  // sessions). Both serve the same evidentiary role — visual substantiation
  // of what was at the spot at the time of parking.
  if (session.no_sign) {
    if (session.ambient_photo) {
      y = ensureSpace(doc, y, 320)
      doc.setFontSize(13)
      doc.setFont(activeFont, 'bold')
      doc.text(t('pdf.evidence.ambientPhotoHeader'), MARGIN, y)
      y += 14
      y = addImageFitted(doc, session.ambient_photo, y, t, activeFont) + 6
      doc.setFontSize(9)
      doc.setFont(activeFont, 'italic')
      doc.setTextColor(80)
      doc.text(t('pdf.evidence.ambientPhotoCaption'), MARGIN, y, { maxWidth: doc.internal.pageSize.getWidth() - 2 * MARGIN })
      doc.setTextColor(20)
      y += 18
    } else {
      // No ambient photo captured. Stamp an explicit "no visual evidence"
      // line so the absence is documented rather than ambiguous.
      y = ensureSpace(doc, y, 60)
      doc.setFontSize(11)
      doc.setFont(activeFont, 'italic')
      doc.setTextColor(80)
      doc.text(t('pdf.evidence.noAmbientCaptured'), MARGIN, y, { maxWidth: doc.internal.pageSize.getWidth() - 2 * MARGIN })
      doc.setTextColor(20)
      y += 26
    }
  } else if (session.sign_photo) {
    y = ensureSpace(doc, y, 320)
    doc.setFontSize(13)
    doc.setFont(activeFont, 'bold')
    doc.text(t('pdf.evidence.signPhotoHeader'), MARGIN, y)
    y += 14
    y = addImageFitted(doc, session.sign_photo, y, t, activeFont) + 18
  }

  // Car photo with caption overlay
  if (session.car_photo) {
    y = ensureSpace(doc, y, 320)
    doc.setFontSize(13)
    doc.setFont(activeFont, 'bold')
    doc.text(t('pdf.evidence.carPhotoHeader'), MARGIN, y)
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

    y = addImageWithOverlayCaption(doc, session.car_photo, y, caption, t, activeFont) + 18
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
    doc.setFont(activeFont, 'bold')
    doc.setTextColor(142, 61, 39) // accent-700
    doc.text(t('pdf.evidence.gpsNoticeTitle'), MARGIN + 12, y + 18)
    doc.setFont(activeFont, 'normal')
    doc.setFontSize(9)
    doc.setTextColor(45, 55, 79) // ink-700
    const disclaimer = t('pdf.evidence.gpsNoticeBody', { accuracy: formatAccuracy(acc) })
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
    doc.setFont(activeFont, 'bold')
    doc.setTextColor(15, 23, 42)
    doc.text(t('pdf.evidence.driverNoteHeader'), MARGIN, y)
    y += 14
    // The note is user-supplied free text and is NOT part of the signed
    // payload, so mark it clearly — a reviewer must not read it as attested,
    // tamper-evident evidence the way the signed metadata is.
    doc.setFontSize(8)
    doc.setFont(activeFont, 'italic')
    doc.setTextColor(120)
    const pwNote = doc.internal.pageSize.getWidth()
    for (const ln of doc.splitTextToSize(
      t('pdf.evidence.driverNoteUnsigned'),
      pwNote - 2 * MARGIN,
    )) {
      doc.text(ln, MARGIN, y)
      y += 11
    }
    y += 4
    doc.setFontSize(10)
    doc.setFont(activeFont, 'normal')
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
  doc.setFont(activeFont, 'italic')
  doc.setTextColor(80)
  const statement = t('pdf.evidence.statement')
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
      drawSignatureAppendix(doc, session.signature, t, activeFont)
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

function drawSignatureAppendix(
  doc: jsPDF,
  sig: NonNullable<ParkingSession['signature']>,
  t: TFunction,
  activeFont: string,
): void {
  doc.addPage()
  let y = MARGIN
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFontSize(18)
  doc.setFont(activeFont, 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(t('pdf.signature.title'), MARGIN, y)
  y += 26

  doc.setFontSize(10)
  doc.setFont(activeFont, 'normal')
  doc.setTextColor(80)
  const intro = t('pdf.signature.intro')
  const introWrapped = doc.splitTextToSize(intro, pageWidth - 2 * MARGIN)
  doc.text(introWrapped, MARGIN, y)
  y += introWrapped.length * 12 + 10

  // Compact metadata table
  doc.setTextColor(15, 23, 42)
  autoTable(doc, {
    startY: y,
    head: [[t('pdf.common.fieldHeader'), t('pdf.common.valueHeader')]],
    body: [
      [t('pdf.signature.algorithm'), sig.algorithm],
      [t('pdf.signature.keyAlias'), sig.key_alias],
      [t('pdf.signature.signedAt'), sig.signed_at],
      [t('pdf.signature.schema'), sig.schema],
      [
        t('pdf.signature.publicKeyUrl'),
        'https://www.parkproof.com.au/parkproof-public-key.pem',
      ],
    ],
    styles: { font: activeFont, fontSize: 9, cellPadding: 5, valign: 'top' },
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
  doc.setFont(activeFont, 'bold')
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42)
  doc.text(t('pdf.signature.canonicalPayloadHeader'), MARGIN, y)
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
  doc.setFont(activeFont, 'bold')
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42)
  doc.text(t('pdf.signature.signatureBlobHeader'), MARGIN, y)
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
  doc.setFont(activeFont, 'bold')
  doc.setFontSize(10)
  doc.setTextColor(15, 23, 42)
  doc.text(t('pdf.signature.verifyHeader'), MARGIN, y)
  y += 14
  doc.setFont('courier', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(40)
  // The shell commands themselves are deliberately left in English / verbatim
  // because they're literal command-line invocations — they must be typed
  // exactly as shown. Only the descriptive text around each command is
  // translated.
  const verifySteps = [
    t('pdf.signature.verifyStep1'),
    t('pdf.signature.verifyStep2'),
    t('pdf.signature.verifyStep3'),
    '   curl -O https://www.parkproof.com.au/parkproof-public-key.pem',
    t('pdf.signature.verifyStep4'),
    '   base64 -d sig.base64 > sig.bin',
    t('pdf.signature.verifyStep5'),
    '   openssl dgst -sha256 -verify parkproof-public-key.pem \\',
    '     -signature sig.bin payload.txt',
    t('pdf.signature.verifyStep6'),
  ]
  for (const line of verifySteps) {
    y = ensureSpace(doc, y, 12)
    doc.text(line, MARGIN, y)
    y += 12
  }
  // Step 7 — the photo re-hash check. Longer prose (the openssl signature
  // check alone does NOT prove the embedded images match their signed hashes),
  // so it wraps rather than sitting in the fixed-line command list above.
  y += 4
  doc.setFont(activeFont, 'normal')
  doc.setFontSize(8)
  for (const ln of doc.splitTextToSize(t('pdf.signature.verifyStep7'), pageWidth - 2 * MARGIN)) {
    y = ensureSpace(doc, y, 11)
    doc.text(ln, MARGIN, y)
    y += 11
  }
}

// ─── Appeal letter PDF ──────────────────────────────────────────────────────
export function downloadAppealPdf(params: {
  session: ParkingSession
  draft: AppealDraft
  editedLetter: string
  ticketPhoto: string
  t: TFunction
  locale: string
}): void {
  const { session, draft, editedLetter, ticketPhoto, t, locale } = params
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const activeFont = registerPdfFonts(doc, locale)
  const timezone = timezoneFor(session)
  const pageWidth = doc.internal.pageSize.getWidth()
  let y = MARGIN

  // Title
  doc.setFontSize(18)
  doc.setFont(activeFont, 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(draft.appeal_subject, MARGIN, y, { maxWidth: pageWidth - 2 * MARGIN })
  y += 32

  // Meta
  doc.setFontSize(10)
  doc.setFont(activeFont, 'normal')
  doc.setTextColor(100)
  doc.text(
    t('pdf.appeal.drafted', { when: new Date().toLocaleString('en-AU') }),
    MARGIN,
    y,
  )
  y += 14
  doc.text(t('pdf.appeal.linkedSession', { id: session.id }), MARGIN, y)
  y += 22

  // Letter body
  doc.setTextColor(15, 23, 42)
  doc.setFontSize(11)
  doc.setFont(activeFont, 'normal')
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
  doc.setFont(activeFont, 'bold')
  doc.text(t('pdf.appeal.supportingEvidence'), MARGIN, y)
  y += 16

  const dash = t('pdf.common.dash')
  const notCaptured = t('pdf.common.notCaptured')

  const body: [string, string][] = [
    [t('pdf.evidence.field.arrivedAt'), fmtLocal(session.arrived_at, timezone)],
    [
      t('pdf.evidence.field.expiresAt'),
      session.expires_at ? fmtLocal(session.expires_at, timezone) : dash,
    ],
    // Driver-signalled end-of-session — empty when the user never tapped
    // "I've left". Useful in appeal context: shows actual time on-site,
    // not just the sign's posted limit.
    ...endedRows(session, timezone, t),
    [t('pdf.evidence.field.address'), session.location?.address ?? dash],
    [
      t('pdf.appeal.fieldGps'),
      session.location
        ? `${session.location.lat.toFixed(6)}, ${session.location.lng.toFixed(6)}`
        : notCaptured,
    ],
    [
      t('pdf.evidence.field.mapLink'),
      session.location
        ? `https://www.google.com/maps?q=${session.location.lat},${session.location.lng}`
        : dash,
    ],
    [t('pdf.appeal.fieldSideSelected'), session.chosen_label || dash],
    [t('pdf.evidence.field.signRules'), session.rules],
  ]
  autoTable(doc, {
    startY: y,
    head: [[t('pdf.common.fieldHeader'), t('pdf.common.valueHeader')]],
    body,
    styles: { font: activeFont, fontSize: 9, cellPadding: 5, valign: 'top' },
    headStyles: { fillColor: [15, 23, 42] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 110 } },
    margin: { left: MARGIN, right: MARGIN },
  })
  const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
  y = (lastTable?.finalY ?? y) + 24

  // Ticket photo
  y = ensureSpace(doc, y, 300)
  doc.setFontSize(11)
  doc.setFont(activeFont, 'bold')
  doc.text(t('pdf.appeal.ticketPhotoHeader'), MARGIN, y)
  y += 14
  y = addImageFitted(doc, ticketPhoto, y, t, activeFont, 260) + 18

  // Sign photo (appeal PDFs are usually generated from translated sessions —
  // a no-sign session has no rules to appeal against — but guard for the
  // edge case where someone drafts an appeal from a no-sign session anyway.)
  if (session.sign_photo) {
    y = ensureSpace(doc, y, 300)
    doc.setFontSize(11)
    doc.setFont(activeFont, 'bold')
    doc.text(t('pdf.appeal.signPhotoHeader'), MARGIN, y)
    y += 14
    y = addImageFitted(doc, session.sign_photo, y, t, activeFont, 260) + 18
  }

  // Car photo (if any)
  if (session.car_photo) {
    y = ensureSpace(doc, y, 300)
    doc.setFontSize(11)
    doc.setFont(activeFont, 'bold')
    doc.text(t('pdf.appeal.carPhotoHeader'), MARGIN, y)
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

    addImageWithOverlayCaption(doc, session.car_photo, y, caption, t, activeFont, 260)
  }

  doc.save(`parkproof-appeal-${session.id.slice(0, 8)}.pdf`)
}

// ─── Full-account export PDF ────────────────────────────────────────────────
//
// Multi-session "everything I have" PDF for the cloud-sync export route. The
// shape matches what /me/export returns. Single-session details get full
// metadata + photos; the cover page summarises the whole set so a reviewer
// (council, lawyer, accountant) can navigate quickly.

export interface FullExportPayload {
  exported_at: string
  schema: string
  account: {
    user_id: string
    email: string | null
    created_at: string | null
  }
  sessions: ParkingSession[]
  notes?: string
}

export function downloadFullExportPdf(
  payload: FullExportPayload,
  t: TFunction,
  locale: string,
): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const activeFont = registerPdfFonts(doc, locale)
  const pageWidth = doc.internal.pageSize.getWidth()

  // ─── Cover page ───
  let y = MARGIN

  doc.setFontSize(24)
  doc.setFont(activeFont, 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(t('pdf.fullExport.title'), MARGIN, y)
  y += 30

  doc.setFontSize(11)
  doc.setFont(activeFont, 'normal')
  doc.setTextColor(80)
  if (payload.account.email) {
    doc.text(t('pdf.fullExport.account', { email: payload.account.email }), MARGIN, y)
    y += 14
  }
  doc.text(t('pdf.fullExport.userId', { id: payload.account.user_id }), MARGIN, y)
  y += 14
  doc.text(
    t('pdf.fullExport.exportedAt', {
      when: new Date(payload.exported_at).toLocaleString('en-AU'),
    }),
    MARGIN,
    y,
  )
  y += 14
  doc.text(
    t('pdf.fullExport.sessionCount', { count: payload.sessions.length }),
    MARGIN,
    y,
  )
  y += 22

  // Intro paragraph — sets reviewer expectations.
  doc.setFontSize(10)
  doc.setTextColor(100)
  const intro = t('pdf.fullExport.intro')
  const introLines = doc.splitTextToSize(intro, pageWidth - 2 * MARGIN)
  doc.text(introLines, MARGIN, y)
  y += introLines.length * 12 + 16

  const dash = t('pdf.common.dash')
  const notCaptured = t('pdf.common.notCaptured')

  if (payload.sessions.length === 0) {
    // No sessions — still produce a valid file the user can keep.
    doc.setFontSize(11)
    doc.setTextColor(15, 23, 42)
    doc.text(t('pdf.fullExport.emptyState'), MARGIN, y)
    doc.save(`parkproof-export-${new Date().toISOString().slice(0, 10)}.pdf`)
    return
  }

  // ─── Cover summary table ───
  doc.setTextColor(15, 23, 42)
  const summary: [string, string, string, string][] = payload.sessions.map((s, i) => {
    const tz = timezoneFor(s)
    const arrived = fmtLocalShort(s.arrived_at, tz)
    const expires = s.expires_at ? fmtLocalShort(s.expires_at, tz) : dash
    const address =
      s.location?.address
      ?? (s.location
        ? `${s.location.lat.toFixed(4)}, ${s.location.lng.toFixed(4)}`
        : dash)
    return [String(i + 1), arrived, expires, address]
  })
  autoTable(doc, {
    startY: y,
    head: [[
      t('pdf.fullExport.summaryColIndex'),
      t('pdf.fullExport.summaryColArrived'),
      t('pdf.fullExport.summaryColExpires'),
      t('pdf.fullExport.summaryColLocation'),
    ]],
    body: summary,
    styles: { font: activeFont, fontSize: 9, cellPadding: 5, valign: 'top' },
    headStyles: { fillColor: [15, 23, 42] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 24 },
      1: { cellWidth: 105 },
      2: { cellWidth: 105 },
      // location takes the remaining width
    },
    margin: { left: MARGIN, right: MARGIN },
  })

  // ─── One detail block per session ───
  payload.sessions.forEach((session, i) => {
    doc.addPage()
    y = MARGIN

    const tz = timezoneFor(session)

    // Section header
    doc.setFontSize(16)
    doc.setFont(activeFont, 'bold')
    doc.setTextColor(15, 23, 42)
    doc.text(
      t('pdf.fullExport.sessionHeader', { n: i + 1, total: payload.sessions.length }),
      MARGIN,
      y,
    )
    y += 22

    // Signed badge (if applicable)
    if (isValidSignature(session.signature)) {
      doc.setFillColor(232, 240, 254) // brand-50
      doc.setDrawColor(124, 156, 222) // brand-300
      doc.setLineWidth(0.5)
      const badgeText = t('pdf.fullExport.signedBadge', {
        when: new Date(session.signature.signed_at).toLocaleString('en-AU'),
      })
      const badgeTextWidth = doc.getTextWidth(badgeText)
      doc.roundedRect(MARGIN, y - 10, badgeTextWidth + 16, 16, 8, 8, 'FD')
      doc.setFontSize(8)
      doc.setFont(activeFont, 'normal')
      doc.setTextColor(60, 96, 168) // brand-700
      doc.text(badgeText, MARGIN + 8, y + 1)
      y += 18
    }

    // Metadata table (compact)
    doc.setTextColor(15, 23, 42)
    const body: [string, string][] = [
      [t('pdf.evidence.field.arrivedAt'), fmtLocal(session.arrived_at, tz)],
      [
        t('pdf.evidence.field.expiresAt'),
        session.expires_at ? fmtLocal(session.expires_at, tz) : dash,
      ],
      ...endedRows(session, tz, t),
      [t('pdf.evidence.field.address'), session.location?.address ?? dash],
      [
        t('pdf.evidence.field.locationGps'),
        session.location
          ? `${session.location.lat.toFixed(6)}, ${session.location.lng.toFixed(6)}`
          : notCaptured,
      ],
      [t('pdf.evidence.field.sideVariant'), session.chosen_label || dash],
      [
        t('pdf.evidence.field.signRules'),
        session.no_sign ? t('pdf.evidence.noSignRules') : splitRules(session.rules),
      ],
      [
        t('pdf.evidence.field.aiConfidence'),
        session.no_sign ? t('pdf.evidence.noSignConfidence') : session.confidence,
      ],
    ]
    if (session.note && session.note.trim()) {
      body.push([t('pdf.fullExport.driverNoteField'), session.note.trim()])
    }
    autoTable(doc, {
      startY: y,
      head: [[t('pdf.common.fieldHeader'), t('pdf.common.valueHeader')]],
      body,
      styles: { font: activeFont, fontSize: 9, cellPadding: 5, valign: 'top' },
      headStyles: { fillColor: [15, 23, 42] },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 120 } },
      margin: { left: MARGIN, right: MARGIN },
    })
    const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } })
      .lastAutoTable
    y = (lastTable?.finalY ?? y) + 14

    // Photos — compact at 200pt max-height each so a typical session fits one page.
    // No-sign sessions show the ambient (surroundings) photo here in place of
    // the sign photo; the field labels above already tell the reader why.
    if (session.no_sign && session.ambient_photo) {
      y = ensureSpace(doc, y, 220)
      doc.setFontSize(11)
      doc.setFont(activeFont, 'bold')
      doc.text(t('pdf.evidence.ambientPhotoHeader'), MARGIN, y)
      y += 12
      y = addImageFitted(doc, session.ambient_photo, y, t, activeFont, 200) + 14
    } else if (!session.no_sign && session.sign_photo) {
      y = ensureSpace(doc, y, 220)
      doc.setFontSize(11)
      doc.setFont(activeFont, 'bold')
      doc.text(t('pdf.evidence.signPhotoHeader'), MARGIN, y)
      y += 12
      y = addImageFitted(doc, session.sign_photo, y, t, activeFont, 200) + 14
    }
    if (session.car_photo) {
      y = ensureSpace(doc, y, 220)
      doc.setFontSize(11)
      doc.setFont(activeFont, 'bold')
      doc.text(t('pdf.evidence.carPhotoHeader'), MARGIN, y)
      y += 12
      const caption: string[] = []
      if (session.location?.address) caption.push(session.location.address)
      else if (session.location) {
        caption.push(
          `${session.location.lat.toFixed(5)}, ${session.location.lng.toFixed(5)}`,
        )
      }
      caption.push(fmtLocal(session.arrived_at, tz))
      y = addImageWithOverlayCaption(doc, session.car_photo, y, caption, t, activeFont, 200) + 14
    }
  })

  doc.save(`parkproof-export-${new Date().toISOString().slice(0, 10)}.pdf`)
}
