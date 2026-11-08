import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { TFunction } from 'i18next'
import type { AppealDraft, ParkingSession, SignatureBundle, SignStatus } from '../types'
import { ACCURACY_USABLE_M, formatAccuracy } from './accuracy'
import { sessionTimezone } from './timezone'
import { registerPdfFonts } from './pdf-fonts'
import { ACTIVE_AFTER_EXPIRY_MS, loadSessions } from './storage'
import { DEV_KEY_ALIAS } from './evidence-chain'
import { mergeEvidence } from './evidence-merge'
import {
  arrivalContextView,
  departureSummary,
  signedTimeOf,
  type ChainLinkKind,
  type DepartureSigning,
} from './chain-view'
import {
  deviceRecordContext,
  evidenceTime,
  recordTimes,
  type ArrivalSigning,
  type RecordTimes,
  type RecordTimesContext,
} from './record-times'
import { formatDistance } from './walk-back'
import {
  legacyPhotoField,
  photoHashSigned,
  resolveSessionPhoto,
  type LegacyPhotoRole,
} from './session-photos'
import { createLimiter, type Limiter } from './concurrency'
import { isNoSignReadRecord, signIssuesOf, signStatusOf } from './sign-result'
import { plainNoteText } from '../../lambda/sign-reading.js'

const MARGIN = 40

// ─── Time helpers ───────────────────────────────────────────────────────────
// Every time in every PDF goes through evidenceTime (formatInZone with the
// year and the zone name, build spec N5), in the record's own zone.
function timezoneFor(session: ParkingSession): string {
  return sessionTimezone(session.location)
}

/** The zone this device is in, for times that belong to no one record (the export's own time). */
function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Melbourne'
  } catch {
    return 'Australia/Melbourne'
  }
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
 * Build the ended_at-conditional rows for the evidence table, only included
 * when the driver tapped "I've left" on this record. Part of sessionRows, so
 * all three PDFs share the duration maths.
 *
 * ended_at is the phone's clock at the moment of the tap, not when the car
 * left, so the row is labelled as a tap time (the signed one once the
 * departure is signed). A driver who moves the car on time but taps "I've
 * left" hours later (the home card keeps asking for 12 h after expiry, the
 * record screen asks on any record) would otherwise get a duration row that
 * shows an overstay nobody observed. The duration row is therefore left out
 * when the tap came after the record's expiry, or, for a record with no
 * expiry, more than ACTIVE_AFTER_EXPIRY_MS after arrival.
 *
 * Returns an empty array when no ended_at is set; callers just spread the
 * result inline.
 */
export function endedRows(
  session: ParkingSession,
  timezone: string,
  t: TFunction,
): [string, string][] {
  if (!session.ended_at) return []
  const tappedAt = departureSummary(session)?.tapped_at ?? session.ended_at
  const rows: [string, string][] = [
    [t('pdf.evidence.field.endedAt'), evidenceTime(tappedAt, timezone)],
  ]
  // Duration: arrived → tap. Only emit when both timestamps parse, the
  // result is non-negative (defensive — a clock skew could in theory produce
  // a negative) and the tap wasn't late (see above). Show as "Xh Ym" with
  // i18n-aware phrasing.
  const arrivedMs = new Date(session.arrived_at).getTime()
  const endedMs = new Date(tappedAt).getTime()
  const expiresMs = session.expires_at ? new Date(session.expires_at).getTime() : NaN
  const tappedLate = Number.isFinite(expiresMs)
    ? endedMs > expiresMs
    : endedMs - arrivedMs > ACTIVE_AFTER_EXPIRY_MS
  if (
    Number.isFinite(arrivedMs) &&
    Number.isFinite(endedMs) &&
    endedMs >= arrivedMs &&
    !tappedLate
  ) {
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
      durationLabel = t('pdf.duration.hoursOnly', { count: hours })
    } else {
      durationLabel = t('pdf.duration.hoursAndMins', { hours, mins })
    }
    rows.push([t('pdf.evidence.field.actualDuration'), durationLabel])
  }
  return rows
}

/**
 * The value of a "signed by ParkProof (server clock)" row: ParkProof's
 * signing time from the signed payload, or why there is none. A phone time
 * never goes here.
 */
export function signingValue(
  signing: ArrivalSigning | DepartureSigning,
  timezone: string,
  t: TFunction,
): string {
  switch (signing.state) {
    case 'signed':
      return signing.signed_at ? evidenceTime(signing.signed_at, timezone) : t('pdf.common.dash')
    case 'dev_key':
      return t('pdf.evidence.signing.devKey', {
        time: signing.signed_at ? evidenceTime(signing.signed_at, timezone) : t('pdf.common.dash'),
      })
    case 'pending':
      return t('pdf.evidence.signing.pending')
    case 'rejected':
      return t('pdf.evidence.signing.rejected')
    default:
      return t('pdf.evidence.signing.none')
  }
}

function coordsText(lat: number, lng: number): string {
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`
}

/**
 * A GPS accuracy as the PDFs print it: formatAccuracy's "±12m" with the
 * locale's plus-or-minus sign (pdf.common.plusMinus), because the hi and pa
 * PDF fonts have no ± glyph.
 */
export function pdfAccuracy(meters: number, t: TFunction): string {
  const text = formatAccuracy(meters)
  return text.startsWith('±') ? `${t('pdf.common.plusMinus')}${text.slice(1)}` : text
}

/**
 * The distance row's value. A tap fix that was rough (worse than
 * ACCURACY_USABLE_M) or gave no accuracy gets a line saying the distance is
 * rough, so a reader doesn't take it as where the phone was.
 */
function departureDistanceText(
  distance: number | null,
  tapAccuracy: number | null,
  t: TFunction,
): string {
  if (distance === null) return t('pdf.evidence.value.distanceUnavailable')
  const text = formatDistance(distance)
  if (tapAccuracy === null) return t('pdf.evidence.value.distanceRoughNoAccuracy', { distance: text })
  if (tapAccuracy > ACCURACY_USABLE_M) {
    return t('pdf.evidence.value.distanceRough', { distance: text, accuracy: pdfAccuracy(tapAccuracy, t) })
  }
  return text
}

/**
 * The departure rows after the tap time: ParkProof's signing time for the
 * departure part (server clock), where the phone was at the tap and its
 * approximate distance from the arrival (phone GPS to phone GPS). Signed
 * values come from the signed departure; until then from the stored one,
 * with the signing row saying "Not signed yet".
 */
function departureRows(times: RecordTimes, timezone: string, t: TFunction): [string, string][] {
  const departure = times.departure
  if (!departure) return []
  const rows: [string, string][] = [
    [t('pdf.evidence.field.departureSigned'), signingValue(departure.signing, timezone, t)],
  ]
  const location = departure.location
  if (!location) {
    rows.push([t('pdf.evidence.field.departureLocation'), t('pdf.common.notCaptured')])
    return rows
  }
  const coords = coordsText(location.lat, location.lng)
  rows.push([
    t('pdf.evidence.field.departureLocation'),
    location.accuracy_meters !== null
      ? t('pdf.evidence.value.coordsWithAccuracy', { coords, accuracy: pdfAccuracy(location.accuracy_meters, t) })
      : coords,
  ])
  rows.push([
    t('pdf.evidence.field.departureDistance'),
    departureDistanceText(departure.distance_from_arrival_m, location.accuracy_meters, t),
  ])
  return rows
}

/** The AI confidence cell: the model's enum through a key map, never printed raw. */
const CONFIDENCE_KEYS: Readonly<Record<string, string>> = {
  high: 'pdf.evidence.confidence.high',
  medium: 'pdf.evidence.confidence.medium',
  low: 'pdf.evidence.confidence.low',
}

function confidenceText(session: ParkingSession, t: TFunction): string {
  if (session.no_sign) return t('pdf.evidence.noSignConfidence')
  const key = Object.prototype.hasOwnProperty.call(CONFIDENCE_KEYS, session.confidence)
    ? CONFIDENCE_KEYS[session.confidence]
    : null
  return key ? t(key) : t('pdf.common.dash')
}

/** The sign condition cell: the reading's status through a key map, never printed raw (T3). */
const SIGN_CONDITION_KEYS: Readonly<Record<SignStatus, string>> = {
  readable: 'pdf.evidence.signCondition.readable',
  partially_obscured: 'pdf.evidence.signCondition.partiallyObscured',
  contradictory: 'pdf.evidence.signCondition.contradictory',
  missing: 'pdf.evidence.signCondition.missing',
  not_a_parking_sign: 'pdf.evidence.signCondition.notAParkingSign',
}

/** The line under a value of the arrival_context that isn't signed (yet). */
const UNSIGNED_CONTEXT_KEYS: Readonly<Record<'pending' | 'rejected' | 'none', string>> = {
  pending: 'pdf.evidence.signing.pending',
  rejected: 'pdf.evidence.signing.rejected',
  none: 'pdf.evidence.signing.none',
}

/**
 * The "Sign condition" row (build spec T3 item 6): what the AI made of the
 * sign in the photo when the record was logged, with its notes on what
 * stopped the sign being read clearly. Only for records read since T3, so
 * older records keep their table shape.
 *
 * The condition is a signed fact (arrival_context, link 1), so it is read
 * from the signed payload once that is signed (N2). Until then it comes
 * from the stored arrival_context (or the record) with "Not signed yet",
 * or "This part couldn't be signed" when it was refused. The notes are
 * the model's words in plain characters every PDF font can draw.
 */
function signConditionRows(session: ParkingSession, t: TFunction): [string, string][] {
  const context = arrivalContextView(session)
  const signed = context.signing === 'signed' || context.signing === 'dev_key'
  const source = signed || context.data ? context.data : session
  const status = signStatusOf(source)
  if (status === null) return []
  const lines = [t(SIGN_CONDITION_KEYS[status])]
  const issues = signIssuesOf(source).map(plainNoteText).filter((s) => s.length > 0)
  if (issues.length > 0) lines.push(t('pdf.evidence.signCondition.notes', { notes: issues.join('; ') }))
  if (context.signing !== 'signed' && context.signing !== 'dev_key') lines.push(t(UNSIGNED_CONTEXT_KEYS[context.signing]))
  return [[t('pdf.evidence.field.signCondition'), lines.join('\n')]]
}

/** The sign rules cell of a no-sign record: why no sign was read. */
function noSignRulesText(session: ParkingSession, t: TFunction): string {
  // Logged from the "no readable sign" screen: ParkProof looked and found
  // none in the photo; the driver didn't say there was no sign (T3).
  return isNoSignReadRecord(session) ? t('pdf.evidence.noSignRead') : t('pdf.evidence.noSignRules')
}

function buildGuidance(expiresAt: string | null, timezone: string, t: TFunction): string {
  if (!expiresAt) {
    return t('pdf.evidence.guidanceFreeNoExpiry')
  }
  const expiresMs = new Date(expiresAt).getTime()
  // If the PDF is exported AFTER expiry (typical for evidence-after-the-fact),
  // the "Move by …" copy reads as a contradiction. State the past tense honestly
  // — the evidence record is about what the session was at the time of parking.
  if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
    return t('pdf.evidence.guidanceExpired', { when: evidenceTime(expiresAt, timezone) })
  }
  return t('pdf.evidence.guidanceFree', { when: evidenceTime(expiresAt, timezone) })
}

/** How the arrival location was obtained, for the evidence table. */
function locationSourceText(session: ParkingSession, t: TFunction): string {
  if (!session.location) return t('pdf.evidence.locationSourceValue.none')
  if (session.location.source === 'manual') return t('pdf.evidence.locationSourceValue.manuallyEntered')
  if (session.location.source !== 'gps') return t('pdf.evidence.locationSourceValue.captured')
  const acc = session.location.accuracy_meters
  if (typeof acc !== 'number') return t('pdf.evidence.locationSourceValue.gps')
  return acc > ACCURACY_USABLE_M
    ? t('pdf.evidence.locationSourceValue.gpsLowAccuracy', { accuracy: pdfAccuracy(acc, t) })
    : t('pdf.evidence.locationSourceValue.gpsWithAccuracy', { accuracy: pdfAccuracy(acc, t) })
}

/**
 * The record's evidence table, the same in all three PDFs (build spec T1b).
 * Later tasks add rows here, and only here.
 *
 * Phone times are labelled as phone times (when the record was logged, when
 * I've left was tapped); ParkProof's signing time for each part sits in its
 * own "signed by ParkProof (server clock)" row, read from the signed
 * payload. Every time is in the record's zone with the zone name (N5).
 * `context` is this device's signing state; it defaults to the stored one.
 */
export function sessionRows(
  session: ParkingSession,
  timezone: string,
  t: TFunction,
  context: RecordTimesContext = deviceRecordContext(session.id),
): [string, string][] {
  const times = recordTimes(session, context)
  const dash = t('pdf.common.dash')
  const location = session.location
  return [
    [t('pdf.evidence.field.arrivedAt'), evidenceTime(times.arrived_at, timezone)],
    [t('pdf.evidence.field.arrivalSigned'), signingValue(times.arrival_signing, timezone, t)],
    [t('pdf.evidence.field.expiresAt'), times.expires_at ? evidenceTime(times.expires_at, timezone) : dash],
    // ended_at + actual-duration rows, then the departure's signing,
    // location and distance, appear only when the driver tapped "I've
    // left", so the shape matches records saved before the feature shipped.
    ...endedRows(session, timezone, t),
    ...departureRows(times, timezone, t),
    // A no-sign record without an expiry has no reading to give guidance
    // from: "Free to park. No expiry shown on the sign." would be a verdict
    // about a sign nobody read (T3).
    [
      t('pdf.evidence.field.guidance'),
      session.no_sign && !times.expires_at
        ? t('pdf.evidence.noSignConfidence')
        : buildGuidance(times.expires_at, timezone, t),
    ],
    [t('pdf.evidence.field.address'), location?.address ?? dash],
    [
      // Only a phone GPS fix is labelled GPS; a typed address's map point isn't.
      location?.source === 'gps' ? t('pdf.evidence.field.locationGps') : t('pdf.evidence.field.locationCoords'),
      location ? coordsText(location.lat, location.lng) : t('pdf.common.notCaptured'),
    ],
    [t('pdf.evidence.field.locationSource'), locationSourceText(session, t)],
    [
      t('pdf.evidence.field.mapLink'),
      location ? `https://www.google.com/maps?q=${location.lat},${location.lng}` : dash,
    ],
    [t('pdf.evidence.field.sideVariant'), session.chosen_label || dash],
    [
      t('pdf.evidence.field.signRules'),
      session.no_sign ? noSignRulesText(session, t) : splitRules(session.rules ?? ''),
    ],
    ...signConditionRows(session, t),
    // AI confidence is meaningless on no-sign records; surface that explicitly
    // instead of writing "low" (which is the data default but reads as wrong).
    [t('pdf.evidence.field.aiConfidence'), confidenceText(session, t)],
  ]
}

// ─── Cross-device photo materialization ────────────────────────────────────

/**
 * Stand-in value for a photo field of the in-flight PDF copy when the
 * record has the photo (a PhotoRef) but its bytes aren't on this device.
 * The image helpers draw the "not on this device" line with the signed
 * fingerprint instead of an image. Only ever set on the copy that
 * `materializeRemotePhotos` returns for one PDF; never stored.
 */
const MISSING_PHOTO_PREFIX = 'parkproof-missing-photo:'

export function missingPhotoMarker(sha256: string, signed: boolean): string {
  return `${MISSING_PHOTO_PREFIX}${signed ? 'signed' : 'unsigned'}:${sha256}`
}

export function parseMissingPhotoMarker(value: string): { sha256: string; signed: boolean } | null {
  if (!value.startsWith(MISSING_PHOTO_PREFIX)) return null
  const [state, sha256] = value.slice(MISSING_PHOTO_PREFIX.length).split(':')
  if (!sha256 || (state !== 'signed' && state !== 'unsigned')) return null
  return { sha256, signed: state === 'signed' }
}

/**
 * The PDF line for a photo whose bytes aren't on the device that made the
 * PDF. It gives the full SHA-256 (plain ASCII hex), so a reader can match
 * it against the photo hashes in the signature appendix.
 */
export function missingPhotoText(marker: { sha256: string; signed: boolean }, t: TFunction): string {
  const fingerprint = marker.sha256
  return marker.signed
    ? t('pdf.common.photoNotOnDevice', { fingerprint })
    : t('pdf.common.photoNotOnDeviceUnsigned', { fingerprint })
}

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
 *
 * Photos are read through the photo store (`resolveSessionPhoto`): a new
 * record's sign, car and ambient bytes come from IndexedDB (or, for a
 * signed-in user whose device doesn't have them, from the cloud, checked
 * against the ref's sha256) and are put on the copy's legacy fields, so the
 * drawing code below reads one shape for every record. A photo whose bytes
 * can't be had gets a `missingPhotoMarker` instead, and the PDF says so
 * with its fingerprint.
 *
 * Only the photos the PDF draws are materialised (`pdfPhotoRoles`); the
 * other photo fields of the copy are left as they are.
 */
export async function materializeRemotePhotos(
  session: ParkingSession,
  kind: PdfKind = 'evidence',
  limit: Limiter = createLimiter(PDF_PHOTO_CONCURRENCY),
): Promise<ParkingSession> {
  const out: ParkingSession = { ...session }
  await Promise.all(
    pdfPhotoRoles(session, kind).map((role) =>
      limit(async () => {
        const field = legacyPhotoField(role)
        const photo = await resolveSessionPhoto(session, role)
        if (photo.kind === 'none') return
        if (photo.kind === 'missing') {
          out[field] = missingPhotoMarker(photo.ref.sha256, photoHashSigned(session, photo.ref.sha256))
          return
        }
        const value = photo.src
        out[field] = value
        if (value.startsWith('data:')) return // already inline; nothing to do
        if (!/^https?:/i.test(value)) return // not a remote URL we need to fetch
        // A legacy photo shown from its hydrated cloud URL (a ref is never
        // read from a URL, see settleSessionPhoto).
        try {
          // Lazy-import sync.ts to keep its deps out of the PDF chunk when
          // every photo is on this device. Server-side proxy fetches from S3
          // and returns base64. The direct browser-to-S3 path (previously
          // here) worked on desktop but failed on some mobile carriers — see
          // CLAUDE.md gotcha.
          const { materializePhotoFromCloud } = await import('./sync')
          const dataUrl = await materializePhotoFromCloud(session.id, role)
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
    ),
  )
  return out
}

/** Which PDF a session's photos are being materialised for. */
export type PdfKind = 'evidence' | 'appeal' | 'export'

/** At most this many photos are fetched at once for one PDF (T0b4). */
export const PDF_PHOTO_CONCURRENCY = 4

/**
 * The photos a PDF draws for a record. Every PDF draws the record through
 * drawSessionBlock (T1b): the surroundings photo for a no-sign record and
 * the sign photo otherwise, then the car photo. (The appeal PDF's notice
 * photo comes from the appeal flow, not the record.)
 */
export function pdfPhotoRoles(session: ParkingSession, kind: PdfKind): LegacyPhotoRole[] {
  // The same for every kind since T1b; `kind` stays so a later section
  // drawn in only one PDF can add its photos here.
  void kind
  return [session.no_sign ? 'ambient' : 'sign', 'car']
}

/**
 * Batch wrapper for the full-export PDF, which renders one block per session
 * and so needs every session's photos materialized up front: only the
 * photos the export draws, at most PDF_PHOTO_CONCURRENCY at a time across
 * the whole export.
 */
export async function materializeRemotePhotosBatch(
  sessions: ParkingSession[],
): Promise<ParkingSession[]> {
  const limit = createLimiter(PDF_PHOTO_CONCURRENCY)
  return Promise.all(sessions.map((s) => materializeRemotePhotos(s, 'export', limit)))
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

function contentWidth(doc: jsPDF): number {
  return doc.internal.pageSize.getWidth() - 2 * MARGIN
}

/** Wrapped text, a line at a time so it can run onto the next page. Returns the y below it. */
function drawWrapped(
  doc: jsPDF,
  text: string,
  y: number,
  opts: { font: string; style?: string; size: number; lineHeight: number; indent?: number },
): number {
  doc.setFont(opts.font, opts.style ?? 'normal')
  doc.setFontSize(opts.size)
  const indent = opts.indent ?? 0
  const lines = doc.splitTextToSize(text, contentWidth(doc) - indent) as string[]
  for (const line of lines) {
    y = ensureSpace(doc, y, opts.lineHeight)
    doc.text(line, MARGIN + indent, y)
    y += opts.lineHeight
  }
  return y
}

/** jsPDF's built-in fonts (courier, helvetica) draw WinAnsi (cp1252) characters only. */
const WIN_ANSI_EXTRA = new Set(Array.from('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ', (c) => c.codePointAt(0)!))

/** Can courier draw every character of `text`? (Printable ASCII, Latin-1 and the cp1252 extras.) */
export function isWinAnsiText(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp)) continue
    return false
  }
  return true
}

/**
 * Monospace lines (base64 blocks, shell commands), wrapped to the page.
 * `font` replaces courier for text courier can't draw (a readable payload
 * with a non-Latin address, say); base64 and commands always use courier.
 */
function drawMono(doc: jsPDF, text: string, y: number, size = 7, lineHeight = 9, font = 'courier'): number {
  doc.setFont(font, 'normal')
  doc.setFontSize(size)
  for (const line of doc.splitTextToSize(text, contentWidth(doc)) as string[]) {
    y = ensureSpace(doc, y, lineHeight)
    doc.text(line, MARGIN, y)
    y += lineHeight
  }
  return y
}

function lastTableY(doc: jsPDF, fallback: number): number {
  const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
  return lastTable?.finalY ?? fallback
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
  const missing = parseMissingPhotoMarker(dataUrl)
  if (missing) return drawMissingPhoto(doc, missing, y, t, activeFont)
  try {
    const props = doc.getImageProperties(dataUrl)
    const ratio = Math.min(maxWidth / props.width, maxHeight / props.height)
    const w = props.width * ratio
    const h = props.height * ratio
    doc.addImage(dataUrl, 'JPEG', MARGIN, y, w, h)

    // Caption overlay: semi-transparent dark pill at the bottom of the image.
    // Each caption line wraps inside the pill, so a narrow (portrait) photo
    // doesn't cut the time off.
    const lineHeight = 12
    const padding = 8
    const captionW = w - 20
    doc.setFont(activeFont, 'normal')
    doc.setFontSize(9)
    const lines = caption.flatMap((line) => doc.splitTextToSize(line, Math.max(40, captionW - 2 * padding)) as string[])
    const captionBlockHeight = lines.length * lineHeight + padding * 2
    const captionX = MARGIN + 10
    const captionY = y + h - captionBlockHeight - 10

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
    lines.forEach((line, i) => {
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

/**
 * The "not on the device that made this PDF" line in place of a photo,
 * with the photo's SHA-256 fingerprint (called signed only when a stored
 * ParkProof signature contains it). Returns the new y.
 */
function drawMissingPhoto(
  doc: jsPDF,
  missing: { sha256: string; signed: boolean },
  y: number,
  t: TFunction,
  activeFont: string,
): number {
  const maxWidth = doc.internal.pageSize.getWidth() - 2 * MARGIN
  doc.setFontSize(10)
  doc.setFont(activeFont, 'italic')
  doc.setTextColor(80)
  const lines = doc.splitTextToSize(missingPhotoText(missing, t), maxWidth) as string[]
  doc.text(lines, MARGIN, y + 14)
  doc.setTextColor(20)
  return y + 14 + lines.length * 12
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
  const missing = parseMissingPhotoMarker(dataUrl)
  if (missing) return drawMissingPhoto(doc, missing, y, t, activeFont)
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

// ─── The record block (all three PDFs) ──────────────────────────────────────

const GPS_NOTICE_TITLE_Y = 18
const GPS_NOTICE_BODY_Y = 30
const GPS_NOTICE_BODY_SIZE = 9
const GPS_NOTICE_BOTTOM_PAD = 8

/**
 * The GPS accuracy notice's body lines and its box height: the title, then
 * the wrapped body at 9 pt, then padding, so the last line always sits
 * inside the box whatever the locale's wrapped length.
 */
export function gpsNoticeBox(doc: jsPDF, body: string, font: string, width: number): { lines: string[]; height: number } {
  doc.setFont(font, 'normal')
  doc.setFontSize(GPS_NOTICE_BODY_SIZE)
  const lines = doc.splitTextToSize(body, width - 24) as string[]
  const lineHeight = GPS_NOTICE_BODY_SIZE * doc.getLineHeightFactor()
  // The first line's baseline is at GPS_NOTICE_BODY_Y; each further line adds one line height.
  const lastBaseline = GPS_NOTICE_BODY_Y + (lines.length - 1) * lineHeight
  return { lines, height: Math.ceil(lastBaseline + lineHeight * 0.35 + GPS_NOTICE_BOTTOM_PAD) }
}

export interface SessionBlockOptions {
  /** Tallest a photo may be drawn, in points. Default 300 (the single-record PDF). */
  photoMaxHeight?: number
  /** The table's font size. Default 10. */
  fontSize?: number
  /** This device's signing state for the record (defaults to the stored one). */
  context?: RecordTimesContext
}

/**
 * One record as every PDF draws it (build spec T1b): the sessionRows table,
 * the sign photo (or the surroundings photo of a no-sign record), the car
 * photo with its caption, the low-accuracy GPS notice and the driver's
 * note. Returns the y below it. New record sections (later tasks) go here,
 * before the closing statement that each PDF draws after the block.
 */
export function drawSessionBlock(
  doc: jsPDF,
  session: ParkingSession,
  y: number,
  t: TFunction,
  font: string,
  timezone: string,
  options: SessionBlockOptions = {},
): number {
  const photoMaxHeight = options.photoMaxHeight ?? 300
  const fontSize = options.fontSize ?? 10
  const compact = photoMaxHeight < 300
  const context = options.context ?? deviceRecordContext(session.id)
  const times = recordTimes(session, context)
  const width = contentWidth(doc)

  doc.setTextColor(15, 23, 42)
  autoTable(doc, {
    startY: y,
    head: [[t('pdf.common.fieldHeader'), t('pdf.common.valueHeader')]],
    body: sessionRows(session, timezone, t, context),
    // font threads the locale's registered Noto Sans into autoTable's cell
    // rendering. Without this autoTable falls back to its default helvetica
    // regardless of what we setFont() globally, and the table cells render
    // as missing-glyph boxes in non-Latin locales.
    styles: { font, fontSize, cellPadding: compact ? 5 : 6, valign: 'top' },
    headStyles: { fillColor: [15, 23, 42] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: compact ? 120 : 130 } },
    margin: { left: MARGIN, right: MARGIN },
  })
  y = lastTableY(doc, y) + (compact ? 14 : 24)

  const headerSize = compact ? 11 : 13
  const photoHeader = (key: string) => {
    y = ensureSpace(doc, y, photoMaxHeight + 20)
    doc.setFontSize(headerSize)
    doc.setFont(font, 'bold')
    doc.setTextColor(15, 23, 42)
    doc.text(t(key), MARGIN, y)
    y += compact ? 12 : 14
  }

  // Sign photo (translated records) OR the surroundings photo (no-sign
  // records). Both are what was at the spot when the record was logged.
  if (session.no_sign) {
    if (session.ambient_photo) {
      photoHeader('pdf.evidence.ambientPhotoHeader')
      y = addImageFitted(doc, session.ambient_photo, y, t, font, photoMaxHeight) + 6
      // The caption describes the photo, so it goes only under a photo that
      // is in the PDF, not under the "not on this device" line.
      if (!parseMissingPhotoMarker(session.ambient_photo)) {
        doc.setFontSize(9)
        doc.setFont(font, 'italic')
        doc.setTextColor(80)
        // Also for a record logged from the "no readable sign" screen: the
        // caption attributes the photo to the driver and says it doesn't
        // show there was no sign nearby; the sign rules cell says no sign
        // was read (T3).
        doc.text(t('pdf.evidence.ambientPhotoCaption'), MARGIN, y, { maxWidth: width })
        doc.setTextColor(20)
        y += 18
      }
    } else {
      // No surroundings photo: say so, rather than leave the absence ambiguous.
      y = ensureSpace(doc, y, 60)
      doc.setFontSize(11)
      doc.setFont(font, 'italic')
      doc.setTextColor(80)
      doc.text(t('pdf.evidence.noAmbientCaptured'), MARGIN, y, { maxWidth: width })
      doc.setTextColor(20)
      y += 26
    }
  } else if (session.sign_photo) {
    photoHeader('pdf.evidence.signPhotoHeader')
    y = addImageFitted(doc, session.sign_photo, y, t, font, photoMaxHeight) + (compact ? 14 : 18)
  }

  // Car photo with caption overlay: the address (or the point) and the
  // record's logged time, by the phone's clock.
  if (session.car_photo) {
    photoHeader('pdf.evidence.carPhotoHeader')
    const caption: string[] = []
    if (session.location?.address) {
      caption.push(session.location.address)
    } else if (session.location) {
      caption.push(`${session.location.lat.toFixed(5)}, ${session.location.lng.toFixed(5)}`)
    }
    caption.push(t('pdf.evidence.carPhotoCaptionTime', { time: evidenceTime(times.arrived_at, timezone) }))
    y = addImageWithOverlayCaption(doc, session.car_photo, y, caption, t, font, photoMaxHeight) + (compact ? 14 : 18)
  }

  // Low-accuracy GPS notice (when relevant). The box grows with the body,
  // which wraps to 3 lines in en and 4 or more in vi, el or it.
  const acc = session.location?.accuracy_meters
  if (session.location?.source === 'gps' && typeof acc === 'number' && acc > ACCURACY_USABLE_M) {
    const box = gpsNoticeBox(doc, t('pdf.evidence.gpsNoticeBody', { accuracy: pdfAccuracy(acc, t) }), font, width)
    // Room below the box for the next heading's ascent.
    y = ensureSpace(doc, y, box.height + 24)
    doc.setFillColor(248, 233, 227) // accent-50
    doc.setDrawColor(192, 87, 58) // accent-500
    doc.setLineWidth(1)
    doc.roundedRect(MARGIN, y, width, box.height, 6, 6, 'FD')
    doc.setFontSize(10)
    doc.setFont(font, 'bold')
    doc.setTextColor(142, 61, 39) // accent-700
    doc.text(t('pdf.evidence.gpsNoticeTitle'), MARGIN + 12, y + GPS_NOTICE_TITLE_Y)
    doc.setFont(font, 'normal')
    doc.setFontSize(GPS_NOTICE_BODY_SIZE)
    doc.setTextColor(45, 55, 79) // ink-700
    doc.text(box.lines, MARGIN + 12, y + GPS_NOTICE_BODY_Y)
    y += box.height + 24
  }

  // Driver's note: the driver's own words about why they were here. It is
  // NOT part of any signed payload, so it is marked as such, and a reviewer
  // must not read it as signed the way the table's signed values are.
  if (session.note && session.note.trim()) {
    y = ensureSpace(doc, y, 80)
    doc.setFontSize(compact ? 11 : 13)
    doc.setFont(font, 'bold')
    doc.setTextColor(15, 23, 42)
    doc.text(t('pdf.evidence.driverNoteHeader'), MARGIN, y)
    y += 14
    doc.setTextColor(120)
    y = drawWrapped(doc, t('pdf.evidence.driverNoteUnsigned'), y, { font, style: 'italic', size: 8, lineHeight: 11 })
    y += 4
    doc.setTextColor(45, 55, 79)
    y = drawWrapped(doc, session.note.trim(), y, { font, size: 10, lineHeight: 13 })
    y += 10
  }
  doc.setTextColor(15, 23, 42)
  return y
}

/**
 * The closing statement under a record (pdf.evidence.statement). Unlike the
 * old one it advances y, but new record sections still go before it, in
 * drawSessionBlock.
 */
function drawStatement(doc: jsPDF, y: number, t: TFunction, font: string): number {
  y = ensureSpace(doc, y, 60)
  doc.setTextColor(80)
  y = drawWrapped(doc, t('pdf.evidence.statement'), y, { font, style: 'italic', size: 10, lineHeight: 12 })
  doc.setTextColor(15, 23, 42)
  return y + 8
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
  doc.text(t('pdf.evidence.generated', { when: evidenceTime(Date.now(), timezone) }), MARGIN, y)
  y += 22

  y = drawSessionBlock(doc, session, y, t, activeFont, timezone)
  drawStatement(doc, y, t, activeFont)
  drawAppendixSafely(doc, session, t, activeFont, timezone)

  doc.save(`parkproof-${session.id.slice(0, 8)}.pdf`)
}

/**
 * A signature bundle is "valid enough to render" if every field the appendix
 * actually reads is present and a string. We don't verify cryptographically
 * here — the PDF surfaces the raw bytes for an external `openssl dgst` check.
 */
function isValidSignature(sig: unknown): sig is SignatureBundle {
  if (!sig || typeof sig !== 'object') return false
  const s = sig as Record<string, unknown>
  const required = [
    'schema',
    'signed_at',
    'algorithm',
    'key_alias',
    'canonical_payload',
    'signature_base64',
  ] as const
  return required.every((k) => typeof s[k] === 'string' && (s[k] as string).length > 0)
}

/**
 * Base64 of the UTF-8 bytes of a string. The verifier decodes this with
 * `base64 -d`, which ignores the line wrapping the PDF introduces, so they
 * reconstruct the EXACT signed bytes (no stray trailing newline, no re-wrapped
 * whitespace). These bytes match what the Lambda hashed: Node's
 * `createHash('sha256').update(canonical_payload)` encodes the string as UTF-8,
 * and TextEncoder here produces the same UTF-8 byte sequence.
 */
export function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

/**
 * The line that opens the signature appendix when the bundle was signed by
 * the `npm run dev` key (key_alias 'dev-ephemeral'), or null. Such a
 * signature can't be checked with ParkProof's published key, so the PDF
 * must never present it as one.
 */
export function devKeyNotice(
  sig: Pick<NonNullable<ParkingSession['signature']>, 'key_alias'>,
  t: TFunction,
): string | null {
  return sig.key_alias === DEV_KEY_ALIAS ? t('pdf.signature.devKey') : null
}

// ─── The chained signature appendix ─────────────────────────────────────────

/**
 * The appendix's link headings ("Link 1: Details at parking"). PDF-only
 * twins of chain-view's CHAIN_KIND_KEYS: the PDF fonts are subsets, so a
 * PDF string may use only characters the subset has (pdf-font-coverage
 * test), while the screen's chain.kind.* strings may use any.
 */
export const PDF_KIND_KEYS: Readonly<Record<ChainLinkKind, string>> = {
  arrival: 'pdf.signature.kind.arrival',
  arrival_context: 'pdf.signature.kind.arrivalContext',
  condition: 'pdf.signature.kind.condition',
  compliance: 'pdf.signature.kind.compliance',
  departure: 'pdf.signature.kind.departure',
  handover: 'pdf.signature.kind.handover',
}

/** One signed link of a record, as the appendix prints it. */
export interface AppendixLink {
  /** "0", "1", "2a": the link's name in its heading, its file names and the chain step. */
  name: string
  /** 0 for link 0 (the arrival), the signed seq for an addendum. */
  seq: number
  kind: ChainLinkKind
  bundle: SignatureBundle
  /** Another signed link has the same seq: two devices each added a part there. */
  forked: boolean
  /** The names of the links at seq - 1, one of which is this link's parent. Empty for link 0. */
  parents: string[]
}

/** The file names a link's blocks are saved as (spec T1b: link0-payload.b64, link1-payload.b64 ...). */
export function appendixFileNames(name: string): { payloadB64: string; payloadTxt: string; sigB64: string; sigBin: string } {
  return {
    payloadB64: `link${name}-payload.b64`,
    payloadTxt: `link${name}-payload.txt`,
    sigB64: `link${name}-sig.b64`,
    sigBin: `link${name}-sig.bin`,
  }
}

function payloadSeq(bundle: SignatureBundle): number | null {
  try {
    const p = JSON.parse(bundle.canonical_payload) as { seq?: unknown }
    return typeof p?.seq === 'number' && Number.isInteger(p.seq) ? p.seq : null
  } catch {
    return null
  }
}

/**
 * The links the appendix prints (pure): link 0 when the record's own arrival
 * bundle is complete, then every signed addendum with a complete bundle, by
 * seq (the signed one), then signing time. A second stored copy of the same
 * signed link is printed once. Pending and refused parts have no signature
 * and aren't printed; a shared copy's sender bundle is left to the shared
 * view (T7). Two signed links at one seq are a fork: both are printed, as
 * "2a" and "2b".
 */
export function appendixLinks(session: ParkingSession): AppendixLink[] {
  if (session.shared_from) return []
  type Entry = { seq: number; kind: ChainLinkKind; bundle: SignatureBundle; at: string; id: string }
  const entries: Entry[] = []
  if (isValidSignature(session.signature)) {
    entries.push({ seq: 0, kind: 'arrival', bundle: session.signature, at: '', id: '' })
  }
  const seen = new Set<string>()
  for (const a of Array.isArray(session.addenda) ? session.addenda : []) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !isValidSignature(a.bundle)) continue
    // A kind no screen knows (garbled data) has no heading to print.
    if (!Object.prototype.hasOwnProperty.call(PDF_KIND_KEYS, a.kind) || (a.kind as string) === 'arrival') continue
    const key = `${a.id}\u0000${a.bundle.signature_base64}`
    if (seen.has(key)) continue
    seen.add(key)
    const seq = payloadSeq(a.bundle) ?? a.seq
    if (!Number.isInteger(seq) || seq < 1) continue
    entries.push({ seq, kind: a.kind, bundle: a.bundle, at: signedTimeOf(a.bundle) ?? '', id: a.id })
  }
  entries.sort((x, y) => x.seq - y.seq || x.at.localeCompare(y.at) || x.id.localeCompare(y.id))

  const perSeq = new Map<number, number>()
  for (const e of entries) perSeq.set(e.seq, (perSeq.get(e.seq) ?? 0) + 1)
  const used = new Map<number, number>()
  const links: AppendixLink[] = entries.map((e) => {
    const count = perSeq.get(e.seq) ?? 1
    const index = used.get(e.seq) ?? 0
    used.set(e.seq, index + 1)
    return {
      name: count > 1 ? `${e.seq}${String.fromCharCode(97 + index)}` : String(e.seq),
      seq: e.seq,
      kind: e.kind,
      bundle: e.bundle,
      forked: count > 1,
      parents: [],
    }
  })
  for (const link of links) {
    if (link.seq > 0) link.parents = links.filter((p) => p.seq === link.seq - 1).map((p) => p.name)
  }
  return links
}

/** The appendix, or nothing; a failure is logged and the rest of the PDF still saves. */
function drawAppendixSafely(
  doc: jsPDF,
  session: ParkingSession,
  t: TFunction,
  font: string,
  timezone: string,
  subtitle?: string,
): void {
  if (session.signature && !isValidSignature(session.signature)) {
    // Older records saved during the deploy-bug window briefly had an
    // empty-object signature; a partial bundle must not crash the PDF.
    console.warn(
      '[pdf] signature bundle is incomplete, leaving link 0 out of the appendix. Saved fields:',
      Object.keys(session.signature),
    )
  }
  try {
    drawSignatureAppendix(doc, session, t, font, timezone, subtitle)
  } catch (err) {
    console.warn('[pdf] signature appendix failed, omitting:', err)
  }
}

/**
 * The signature appendix (build spec T1b): every signed link of the record,
 * each with its heading, ParkProof's signing time, its payload (as text and
 * as base64, saved as linkN-payload.b64) and its signature (linkN-sig.b64),
 * then the openssl steps for link 0, the "repeat for each link" line, the
 * photo step and the chain step (`openssl dgst -sha256 link0-payload.txt`
 * prints the hex that must equal `parent_payload_sha256` in link 1; the
 * spec's `sha256sum` prints the same value but isn't on Windows or macOS). Starts on a new page; draws nothing
 * when the record has no signed link.
 */
export function drawSignatureAppendix(
  doc: jsPDF,
  session: ParkingSession,
  t: TFunction,
  font: string,
  timezone: string,
  subtitle?: string,
): void {
  const links = appendixLinks(session)
  if (links.length === 0) return
  doc.addPage()
  let y = MARGIN

  doc.setFontSize(18)
  doc.setFont(font, 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(t('pdf.signature.title'), MARGIN, y)
  y += 22
  if (subtitle) {
    doc.setFontSize(11)
    doc.setFont(font, 'normal')
    doc.setTextColor(100)
    doc.text(subtitle, MARGIN, y)
    y += 18
  }
  y += 4

  // A local `npm run dev` signature: the openssl steps below don't apply to
  // it, so say so before anything else.
  const devLinks = links.filter((l) => l.bundle.key_alias === DEV_KEY_ALIAS)
  const devNotice = devLinks.length > 0 ? devKeyNotice(devLinks[0].bundle, t) : null
  if (devNotice) {
    doc.setTextColor(146, 64, 14)
    y = drawWrapped(doc, devNotice, y, { font, style: 'bold', size: 11, lineHeight: 14 }) + 10
  }

  doc.setTextColor(80)
  y = drawWrapped(doc, t('pdf.signature.intro'), y, { font, size: 10, lineHeight: 12 }) + 10

  doc.setTextColor(15, 23, 42)
  autoTable(doc, {
    startY: y,
    body: [[t('pdf.signature.publicKeyUrl'), 'https://www.parkproof.com.au/parkproof-public-key.pem']],
    styles: { font, fontSize: 9, cellPadding: 5, valign: 'top' },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 110 } },
    margin: { left: MARGIN, right: MARGIN },
  })
  y = lastTableY(doc, y) + 18

  const mixedKeys = devLinks.length > 0 && devLinks.length < links.length
  for (const link of links) {
    const files = appendixFileNames(link.name)
    y = ensureSpace(doc, y, 140)
    doc.setTextColor(15, 23, 42)
    y = drawWrapped(doc, t('pdf.signature.linkHeading', { link: link.name, kind: t(PDF_KIND_KEYS[link.kind]) }), y, {
      font,
      style: 'bold',
      size: 13,
      lineHeight: 16,
    })
    if (link.forked) {
      doc.setTextColor(80)
      y = drawWrapped(doc, t('pdf.signature.forkNote'), y, { font, style: 'italic', size: 9, lineHeight: 11 })
    }
    if (mixedKeys && link.bundle.key_alias === DEV_KEY_ALIAS) {
      doc.setTextColor(146, 64, 14)
      y = drawWrapped(doc, t('pdf.signature.devKey'), y, { font, style: 'bold', size: 9, lineHeight: 11 })
    }
    y += 4

    const signedAt = signedTimeOf(link.bundle)
    doc.setTextColor(15, 23, 42)
    autoTable(doc, {
      startY: y,
      head: [[t('pdf.common.fieldHeader'), t('pdf.common.valueHeader')]],
      body: [
        [t('pdf.signature.signedAt'), signedAt ? evidenceTime(signedAt, timezone) : t('pdf.common.dash')],
        [t('pdf.signature.schema'), link.bundle.schema],
        [t('pdf.signature.keyAlias'), link.bundle.key_alias],
        [t('pdf.signature.algorithm'), link.bundle.algorithm],
      ],
      styles: { font, fontSize: 9, cellPadding: 5, valign: 'top' },
      headStyles: { fillColor: [15, 23, 42] },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 110 } },
      margin: { left: MARGIN, right: MARGIN },
    })
    y = lastTableY(doc, y) + 14

    // The payload as text (for reading), then as base64: the verify steps
    // decode the base64 because `base64 -d` strips the PDF's line wrapping
    // and yields the exact signed bytes; the wrapped text would not.
    const blockHeader = (text: string) => {
      y = ensureSpace(doc, y, 30)
      doc.setTextColor(15, 23, 42)
      y = drawWrapped(doc, text, y, { font, style: 'bold', size: 10, lineHeight: 13 }) + 1
      doc.setTextColor(40)
    }
    blockHeader(t('pdf.signature.canonicalPayloadHeader'))
    // Readable text only (the check uses the base64 below): courier draws
    // WinAnsi only, so a payload with, say, a Chinese address is drawn in
    // the locale's font instead of as garbage.
    const payload = link.bundle.canonical_payload
    y = drawMono(doc, payload, y, 7, 9, isWinAnsiText(payload) ? 'courier' : font) + 8
    blockHeader(t('pdf.signature.payloadB64Header', { file: files.payloadB64 }))
    y = drawMono(doc, base64Utf8(link.bundle.canonical_payload), y) + 8
    blockHeader(t('pdf.signature.signatureBlobHeader', { file: files.sigB64 }))
    y = drawMono(doc, link.bundle.signature_base64, y) + 18
  }

  // Verification instructions. The shell commands are left verbatim (they
  // must be typed exactly as shown) and drawn in courier; the steps around
  // them are translated and drawn in the locale's font, wrapped.
  const zero = appendixFileNames(links[0].name)
  const step = (text: string) => {
    doc.setTextColor(40)
    y = drawWrapped(doc, text, y, { font, size: 8.5, lineHeight: 11 }) + 2
  }
  const command = (line: string) => {
    doc.setTextColor(40)
    y = drawMono(doc, line, y, 8, 11) + 2
  }
  y = ensureSpace(doc, y, 100)
  doc.setTextColor(15, 23, 42)
  y = drawWrapped(doc, t('pdf.signature.verifyHeader'), y, { font, style: 'bold', size: 10, lineHeight: 14 })
  step(t('pdf.signature.verifyStep1'))
  command(`   base64 -d ${zero.payloadB64} > ${zero.payloadTxt}`)
  step(t('pdf.signature.verifyStep2'))
  step(t('pdf.signature.verifyStep3'))
  command('   curl -O https://www.parkproof.com.au/parkproof-public-key.pem')
  step(t('pdf.signature.verifyStep4'))
  command(`   base64 -d ${zero.sigB64} > ${zero.sigBin}`)
  step(t('pdf.signature.verifyStep5'))
  command('   openssl dgst -sha256 -verify parkproof-public-key.pem \\')
  command(`     -signature ${zero.sigBin} ${zero.payloadTxt}`)
  step(t('pdf.signature.verifyStep6'))
  if (links.length > 1) step(t('pdf.signature.verifyRepeat'))
  // Step 7, the photo re-hash check: the openssl check alone does NOT show
  // the embedded images match their signed hashes.
  y += 2
  step(t('pdf.signature.verifyStep7'))

  // Step 8, the chain: each link names the payload of the one before it.
  const children = links.filter((l) => l.parents.length > 0)
  if (children.length > 0) {
    y += 2
    step(t('pdf.signature.verifyChain'))
    for (const child of children) {
      y = ensureSpace(doc, y, 11 * (child.parents.length + 1) + 4)
      // openssl, which the steps above already need: sha256sum isn't on Windows or macOS.
      for (const parent of child.parents) command(`   openssl dgst -sha256 ${appendixFileNames(parent).payloadTxt}`)
      doc.setTextColor(40)
      y =
        drawWrapped(
          doc,
          child.parents.length > 1
            ? t('pdf.signature.chainEqualsOneOf', { link: child.name })
            : t('pdf.signature.chainEquals', { link: child.name }),
          y,
          { font, size: 8.5, lineHeight: 11, indent: 14 },
        ) + 4
    }
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
  doc.text(t('pdf.appeal.drafted', { when: evidenceTime(Date.now(), timezone) }), MARGIN, y)
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

  // The notice being appealed
  y = ensureSpace(doc, y, 300)
  doc.setFontSize(11)
  doc.setFont(activeFont, 'bold')
  doc.text(t('pdf.appeal.ticketPhotoHeader'), MARGIN, y)
  y += 14
  y = addImageFitted(doc, ticketPhoto, y, t, activeFont, 260) + 24

  // The record, as every PDF draws it
  y = ensureSpace(doc, y, 200)
  doc.setFontSize(12)
  doc.setFont(activeFont, 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(t('pdf.appeal.supportingEvidence'), MARGIN, y)
  y += 16
  y = drawSessionBlock(doc, session, y, t, activeFont, timezone, { photoMaxHeight: 260, fontSize: 9 })
  drawStatement(doc, y, t, activeFont)
  drawAppendixSafely(doc, session, t, activeFont, timezone)

  doc.save(`parkproof-appeal-${session.id.slice(0, 8)}.pdf`)
}

// ─── Full-account export PDF ────────────────────────────────────────────────
//
// Multi-session "everything I have" PDF for the cloud-sync export route. The
// shape matches what /me/export returns. Each record gets the same block as
// the single-record PDF (drawSessionBlock) and its own signature appendix;
// the cover page summarises the whole set so a reviewer (council, lawyer,
// accountant) can navigate quickly.

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

/**
 * The export's records with this device's copy of each merged in
 * (`mergeEvidence`, T0b4). /me/export strips `chain_key` and holds only the
 * addenda that were uploaded, so without this a departure still being
 * signed on this device would print as "Not signed" instead of "Not signed
 * yet", and a link signed here but not yet uploaded would be missing.
 * Records this device doesn't have are kept as the cloud sent them. Call it
 * BEFORE materializeRemotePhotosBatch, so the photos are read from the
 * merged record (this device's photo store first).
 */
export function withLocalEvidence(
  sessions: ParkingSession[],
  localRecords: () => ParkingSession[] = loadSessions,
): ParkingSession[] {
  let byId: Map<string, ParkingSession>
  try {
    byId = new Map(localRecords().map((s) => [s.id, s]))
  } catch (err) {
    console.warn('[pdf] could not read this device\'s records for the export:', err)
    return sessions
  }
  return sessions.map((s) => {
    const local = byId.get(s.id)
    return local ? mergeEvidence(local, s) : s
  })
}

/**
 * The full export. The caller passes the /me/export records through
 * withLocalEvidence and then materializeRemotePhotosBatch first.
 */
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
    t('pdf.fullExport.exportedAt', { when: evidenceTime(payload.exported_at, deviceTimezone()) }),
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
    const times = recordTimes(s, { now: Date.now() })
    const arrived = evidenceTime(times.arrived_at, tz)
    const expires = times.expires_at ? evidenceTime(times.expires_at, tz) : dash
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

  // ─── One detail block per session, each followed by its appendix ───
  const total = payload.sessions.length
  payload.sessions.forEach((session, i) => {
    doc.addPage()
    y = MARGIN

    const tz = timezoneFor(session)
    const header = t('pdf.fullExport.sessionHeader', { n: i + 1, total })

    // Section header
    doc.setFontSize(16)
    doc.setFont(activeFont, 'bold')
    doc.setTextColor(15, 23, 42)
    doc.text(header, MARGIN, y)
    y += 22

    // Signed badge (if applicable): ParkProof's signing time of link 0.
    const signedAt = isValidSignature(session.signature) ? signedTimeOf(session.signature) : null
    if (signedAt) {
      doc.setFillColor(232, 240, 254) // brand-50
      doc.setDrawColor(124, 156, 222) // brand-300
      doc.setLineWidth(0.5)
      doc.setFontSize(8)
      doc.setFont(activeFont, 'normal')
      const badgeText = t('pdf.fullExport.signedBadge', { when: evidenceTime(signedAt, tz) })
      const badgeTextWidth = doc.getTextWidth(badgeText)
      doc.roundedRect(MARGIN, y - 10, badgeTextWidth + 16, 16, 8, 8, 'FD')
      doc.setTextColor(60, 96, 168) // brand-700
      doc.text(badgeText, MARGIN + 8, y + 1)
      y += 18
    }

    y = drawSessionBlock(doc, session, y, t, activeFont, tz, { photoMaxHeight: 200, fontSize: 9 })
    drawStatement(doc, y, t, activeFont)
    drawAppendixSafely(doc, session, t, activeFont, tz, header)
  })

  doc.save(`parkproof-export-${new Date().toISOString().slice(0, 10)}.pdf`)
}
