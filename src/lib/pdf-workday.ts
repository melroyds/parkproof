// The workday record PDF (build spec T6c). One PDF for the legs of a
// workday the driver picks: the header "Record of parking events.", a
// cover table of the legs, one section per leg drawn exactly as every
// other PDF draws a record (drawSessionBlock) under the council line, the
// signature pages of each leg, and the steps that check the chain between
// legs. The footer is on every page.
//
// Workday mode is behind VITE_FEATURE_WORKDAY (features.ts). With the flag
// off, downloadWorkdayPdf draws and saves nothing, so no workday PDF can be
// made even if a caller reached it.
//
// What the PDF never prints: permit details or their salt (N3). Each leg is
// drawn by drawSessionBlock and the signature appendix, which print only
// what every record's PDF prints (the signed payloads carry the permit
// commitment, a hash, never the permit or the salt). The cover table and
// the chain steps print phone times, signing times, addresses, the signed
// boundary statement and file names, nothing else.
//
// The row and chain helpers are pure (no jsPDF), so they are tested on
// their own.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { TFunction } from 'i18next'
import type { BoundaryAnswer, BoundaryAskedBecause, BoundaryStatement, ParkingSession, WorkdayState } from '../types'
import { HEX64_RE } from '../../lambda/addendum-schema.js'
import { isWorkdayEnabled } from './features'
import { registerPdfFonts } from './pdf-fonts'
import { arrivalContextView, type ArrivalContextSigning } from './chain-view'
import { deviceRecordContext, evidenceTime, recordTimes, type RecordTimesContext } from './record-times'
import { linkFileNames, signedLinks } from './signed-links'
import { sessionTimezone } from './timezone'
import { formatDistance } from './walk-back'
import { arrivalWorkday, previousLegOf } from './workday-chain'
import { legTaggedLater, stopNumber } from './workday-flow'
import {
  PDF_MARGIN,
  contentWidth,
  drawAppendixSafely,
  drawMono,
  drawSessionBlock,
  drawStatement,
  drawWrapped,
  ensureSpace,
  lastTableY,
  signingValue,
} from './pdf'

// The caller materialises the chosen legs' photos with the same batch as
// the full export before calling downloadWorkdayPdf (Safari's download
// gesture: no await between the tap and doc.save()).
export { materializeRemotePhotosBatch } from './pdf'

// ─── Legs ───────────────────────────────────────────────────────────────────
// The leg picker's choice is workday-flow.ts's chosenWorkdayLegs (no PDF
// code, so the picker loads without it).

/** A saved leg of a workday: the driver's own record with a leg index (never a shared copy). */
function isLeg(s: ParkingSession): boolean {
  return !s.shared_from && typeof s.workday_id === 'string' && Number.isInteger(s.leg_index) && (s.leg_index as number) >= 0
}

function byLegOrder(a: ParkingSession, b: ParkingSession): number {
  return (a.leg_index as number) - (b.leg_index as number) || Date.parse(a.arrived_at) - Date.parse(b.arrived_at)
}

// ─── The cover table (T6c item 3) ───────────────────────────────────────────

/** The cover table's column headings, in order (keys). */
export const WORKDAY_COVER_COLUMNS = [
  'pdf.workday.col.leg',
  'pdf.workday.col.arrived',
  'pdf.workday.col.left',
  'pdf.signature.signedAt',
  'pdf.evidence.field.address',
  'pdf.workday.col.distance',
  'pdf.workday.col.statement',
] as const

const ANSWERS: ReadonlySet<string> = new Set<BoundaryAnswer>([
  'opposite_direction_sign',
  'yellow_edge_line',
  't_intersection_or_dead_end',
  'left_parking_area',
  'not_sure',
  'not_asked',
])

/** A boundary statement as stored or signed, or null when it is missing or garbled. */
function boundaryOf(value: unknown): BoundaryStatement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const b = value as Partial<BoundaryStatement>
  if (typeof b.answer !== 'string' || !ANSWERS.has(b.answer) || !Array.isArray(b.asked_because)) return null
  const distance = b.distance_from_previous_m
  return {
    previous_session_id: typeof b.previous_session_id === 'string' ? b.previous_session_id : '',
    asked_because: b.asked_because.filter((r): r is BoundaryAskedBecause => typeof r === 'string'),
    answer: b.answer,
    distance_from_previous_m: typeof distance === 'number' && Number.isFinite(distance) && distance >= 0 ? distance : null,
  }
}

/** What the driver told ParkProof at a move, and whether ParkProof has signed it. */
export interface LegBoundary {
  boundary: BoundaryStatement | null
  signing: ArrivalContextSigning
}

/**
 * A leg's boundary statement (N2: signed facts come from the signed
 * payload). Once its details at parking (arrival_context) are signed, the
 * statement is the one in the signed payload; until then the stored
 * arrival_context's, and without one the record's own `boundary`.
 */
export function legBoundary(leg: ParkingSession): LegBoundary {
  const view = arrivalContextView(leg)
  if (view.data) return { boundary: boundaryOf(view.data.boundary), signing: view.signing }
  return { boundary: boundaryOf(leg.boundary), signing: view.signing }
}

/** The mark after a value that ParkProof hasn't signed (the PDFs' usual marks). */
const UNSIGNED_MARK_KEYS: Readonly<Record<ArrivalContextSigning, string | null>> = {
  signed: null,
  dev_key: null,
  pending: 'pdf.evidence.value.notSignedYet',
  rejected: 'pdf.evidence.value.partRejected',
  none: 'pdf.evidence.value.notSigned',
}

function withMark(text: string, signing: ArrivalContextSigning, t: TFunction): string {
  const mark = UNSIGNED_MARK_KEYS[signing]
  return mark ? `${text} ${t(mark)}` : text
}

/** The statement for each answer, one whole sentence each, never the answer's code. */
const STATEMENT_KEYS: Readonly<Record<Exclude<BoundaryAnswer, 'not_sure'>, string>> = {
  opposite_direction_sign: 'pdf.workday.statement.oppositeDirectionSign',
  yellow_edge_line: 'pdf.workday.statement.yellowEdgeLine',
  t_intersection_or_dead_end: 'pdf.workday.statement.tIntersectionOrDeadEnd',
  left_parking_area: 'pdf.workday.statement.leftParkingArea',
  not_asked: 'pdf.workday.statement.notAsked',
}

const isFirstLeg = (leg: ParkingSession) => leg.leg_index === 0

/**
 * The "Driver's statement" cell: what the driver answered when the app
 * asked which boundary they passed, worded as the driver's own statement
 * (copy rules), or that the app didn't ask. The area question's "I'm not
 * sure" says the question was about the parking area. Marked "(not signed
 * yet)" and so on until ParkProof has signed it.
 */
export function legStatementText(leg: ParkingSession, t: TFunction): string {
  if (isFirstLeg(leg)) return t('pdf.workday.statement.firstLeg')
  const { boundary, signing } = legBoundary(leg)
  if (!boundary) return t('pdf.common.dash')
  const text =
    boundary.answer === 'not_sure'
      ? t(boundary.asked_because.includes('area_sign') ? 'pdf.workday.statement.notSureArea' : 'pdf.workday.statement.notSure')
      : t(STATEMENT_KEYS[boundary.answer])
  return withMark(text, signing, t)
}

/**
 * The "Approx. distance from previous leg (phone GPS)" cell: the distance
 * in the leg's boundary statement, measured between the two parks' phone
 * GPS fixes when the leg was logged. "Not measured" when either park had
 * no GPS fix; a dash for the first leg.
 */
export function legDistanceText(leg: ParkingSession, t: TFunction): string {
  if (isFirstLeg(leg)) return t('pdf.common.dash')
  const { boundary, signing } = legBoundary(leg)
  if (!boundary) return t('pdf.common.dash')
  const d = boundary.distance_from_previous_m
  return d === null ? t('pdf.workday.cell.noDistance') : withMark(formatDistance(d), signing, t)
}

function addressText(leg: ParkingSession, t: TFunction): string {
  const location = leg.location
  if (location?.address) return location.address
  return location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : t('pdf.common.dash')
}

/**
 * The cover table's rows (pure), one per leg in the order given: the leg
 * number, when it was logged and when the departure was tapped (phone
 * clock), ParkProof's signing times for the arrival and the departure
 * (server clock, or why there is none), the address, the distance from the
 * previous leg and the driver's statement. Every time is in the leg's own
 * zone with the zone name (N5).
 */
export function workdayCoverRows(
  legs: readonly ParkingSession[],
  t: TFunction,
  contextFor: (leg: ParkingSession) => RecordTimesContext = (leg) => deviceRecordContext(leg.id),
): string[][] {
  return legs.map((leg) => {
    const tz = sessionTimezone(leg.location)
    const times = recordTimes(leg, contextFor(leg))
    const signed = [t('pdf.workday.cell.signedArrival', { value: signingValue(times.arrival_signing, tz, t) })]
    if (times.departure) {
      signed.push(t('pdf.workday.cell.signedDeparture', { value: signingValue(times.departure.signing, tz, t) }))
    }
    const number = stopNumber(leg)
    return [
      number === null ? t('pdf.common.dash') : String(number),
      evidenceTime(times.arrived_at, tz),
      times.departure ? evidenceTime(times.departure.tapped_at, tz) : t('pdf.workday.cell.notLeft'),
      signed.join('\n'),
      addressText(leg, t),
      legDistanceText(leg, t),
      legStatementText(leg, t),
    ]
  })
}

// ─── The chain between legs ─────────────────────────────────────────────────

/** One step of the chain check between a leg and the leg before it. */
export type WorkdayChainCheck =
  /** Hash each of `files` (the previous leg's signed departure payloads); one must equal the hash in `link`. */
  | { kind: 'pair'; leg: number; link: string; previous: number; files: string[] }
  /** The leg's details at parking were signed with no previous departure (none was signed in time). */
  | { kind: 'not_linked'; leg: number; link: string }
  /** They name a signed departure of the leg before, but that departure isn't in this PDF. */
  | { kind: 'not_in_pdf'; leg: number; link: string }

/** The `data` object of a signed addendum payload, or {} when it can't be read. */
function payloadData(canonical: string): Record<string, unknown> {
  try {
    const data = (JSON.parse(canonical) as { data?: unknown } | null)?.data
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * The chain steps between the chosen legs (pure). For each chosen leg
 * after the first whose details at parking (arrival_context) are signed
 * and name this workday: the previous leg's signed departure payload
 * files, to hash and compare with the signed
 * `workday.previous_departure_payload_sha256` (T6b item 11). The files are
 * named as that leg's signature pages name them, inside a folder per leg
 * (`leg1/link3-payload.txt`), because every leg's pages start at link 0.
 * `allLegs` is every saved leg of the workday, to find the leg before.
 */
export function workdayChainChecks(
  chosen: readonly ParkingSession[],
  allLegs: readonly ParkingSession[],
): WorkdayChainCheck[] {
  const chosenIds = new Set(chosen.map((l) => l.id))
  const out: WorkdayChainCheck[] = []
  for (const leg of chosen) {
    const number = stopNumber(leg)
    if (number === null || isFirstLeg(leg) || typeof leg.workday_id !== 'string') continue
    const link = signedLinks(leg).find((l) => l.kind === 'arrival_context')
    if (!link) continue
    const workday = arrivalWorkday({ kind: 'arrival_context', data: payloadData(link.bundle.canonical_payload) })
    // A leg tagged later (an earlier park made leg 0) or another workday's details: nothing links here.
    if (!workday || workday.workday_id !== leg.workday_id) continue
    const hash = workday.previous_departure_payload_sha256
    if (hash === null) {
      out.push({ kind: 'not_linked', leg: number, link: link.name })
      continue
    }
    if (typeof hash !== 'string' || !HEX64_RE.test(hash)) continue
    const previous = previousLegOf(leg.id, workday, allLegs.filter(isLeg))
    const previousNumber = previous ? stopNumber(previous) : null
    const departures =
      previous && chosenIds.has(previous.id) ? signedLinks(previous).filter((l) => l.kind === 'departure') : []
    if (!previous || previousNumber === null || departures.length === 0) {
      out.push({ kind: 'not_in_pdf', leg: number, link: link.name })
      continue
    }
    out.push({
      kind: 'pair',
      leg: number,
      link: link.name,
      previous: previousNumber,
      files: departures.map((d) => `leg${previousNumber}/${linkFileNames(d.name).payloadTxt}`),
    })
  }
  return out
}

// ─── Drawing ────────────────────────────────────────────────────────────────

const HEADER_SIZE = 7.5
/** The running header's baseline, clear of a page heading drawn at PDF_MARGIN. */
const HEADER_Y = 20
const FOOTER_SIZE = 7.5
const FOOTER_LINE = 9.5

/**
 * "Councils may interpret this rule more strictly. Check your council's
 * parking page." in a box at the top of each leg's rule sheet, above the
 * table with the sign's rules. Returns the y below it.
 */
function drawCouncilLine(doc: jsPDF, y: number, t: TFunction, font: string): number {
  const width = contentWidth(doc)
  doc.setFont(font, 'bold')
  doc.setFontSize(9.5)
  const lines = doc.splitTextToSize(t('pdf.workday.councilLine'), width - 24) as string[]
  const height = lines.length * 12 + 14
  y = ensureSpace(doc, y, height + 12)
  doc.setFillColor(242, 244, 247)
  doc.setDrawColor(45, 55, 79)
  doc.setLineWidth(0.75)
  doc.roundedRect(PDF_MARGIN, y, width, height, 6, 6, 'FD')
  doc.setTextColor(15, 23, 42)
  lines.forEach((line, i) => doc.text(line, PDF_MARGIN + 12, y + 16 + i * 12))
  return y + height + 12
}

/**
 * The running header (pages after the first) and the footer (every page),
 * drawn last in the page margins, which no content uses: content stops
 * PDF_MARGIN above the bottom edge and starts PDF_MARGIN below the top.
 */
function drawHeaderAndFooter(doc: jsPDF, t: TFunction, font: string): void {
  const width = contentWidth(doc)
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFont(font, 'normal')
    if (page > 1) {
      doc.setFontSize(HEADER_SIZE)
      doc.setTextColor(110)
      doc.text(t('pdf.workday.title'), PDF_MARGIN, HEADER_Y)
    }
    doc.setFontSize(FOOTER_SIZE)
    doc.setTextColor(90)
    const lines = doc.splitTextToSize(t('pdf.workday.footer'), width) as string[]
    const first = pageHeight - 14 - (lines.length - 1) * FOOTER_LINE
    lines.forEach((line, i) => doc.text(line, PDF_MARGIN, first + i * FOOTER_LINE))
  }
  doc.setTextColor(15, 23, 42)
}

export interface WorkdayPdfInput {
  /** The legs the driver chose, with their photos materialised for this PDF. Printed in leg order. */
  legs: readonly ParkingSession[]
  /** Every saved leg of the workday (for "not every leg" and the chain). Defaults to `legs`. */
  allLegs?: readonly ParkingSession[]
  /** The workday's state on this device, when it is here: its start and end (phone clock). */
  workday?: Pick<WorkdayState, 'id' | 'started_at' | 'ended_at'> | null
  t: TFunction
  /** The locale whose PDF font was prefetched (prefetchPdfFont). */
  locale: string
}

/**
 * Build and save the workday record PDF (build spec T6c). Returns true when
 * a PDF was saved; false, drawing nothing, when workday mode is off in this
 * build or no leg was chosen.
 */
export function downloadWorkdayPdf(input: WorkdayPdfInput): boolean {
  if (!isWorkdayEnabled()) return false
  const { t, workday } = input
  // One workday per PDF: its id from the state, else from the first leg.
  const workdayId = workday?.id ?? input.legs.find(isLeg)?.workday_id
  const ofWorkday = (s: ParkingSession) => isLeg(s) && s.workday_id === workdayId
  const legs = input.legs.filter(ofWorkday).sort(byLegOrder)
  if (legs.length === 0) return false
  const allLegs = (input.allLegs ?? legs).filter(ofWorkday)
  const total = new Set([...allLegs, ...legs].map((l) => l.id)).size

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const font = registerPdfFonts(doc, input.locale)
  const zone = sessionTimezone(legs[0].location)
  let y = PDF_MARGIN

  // ─── Cover ───
  doc.setFontSize(22)
  doc.setFont(font, 'bold')
  doc.setTextColor(15, 23, 42)
  doc.text(t('pdf.workday.title'), PDF_MARGIN, y)
  y += 28

  doc.setFontSize(10)
  doc.setFont(font, 'normal')
  doc.setTextColor(100)
  const meta: string[] = []
  if (workday?.started_at) meta.push(t('pdf.workday.started', { time: evidenceTime(workday.started_at, zone) }))
  if (workday?.ended_at) meta.push(t('pdf.workday.ended', { time: evidenceTime(workday.ended_at, zone) }))
  meta.push(t('pdf.evidence.generated', { when: evidenceTime(Date.now(), zone) }))
  meta.push(t('pdf.workday.legCount', { chosen: legs.length, total }))
  for (const line of meta) {
    doc.text(line, PDF_MARGIN, y)
    y += 14
  }
  y += 6
  if (legs.length < total) {
    doc.setTextColor(146, 64, 14)
    y = drawWrapped(doc, t('pdf.workday.partial'), y, { font, style: 'bold', size: 9.5, lineHeight: 12 }) + 6
  }
  doc.setTextColor(80)
  y = drawWrapped(doc, t('pdf.workday.intro'), y, { font, size: 9.5, lineHeight: 12 }) + 8

  doc.setTextColor(15, 23, 42)
  autoTable(doc, {
    startY: y,
    head: [WORKDAY_COVER_COLUMNS.map((key) => t(key))],
    body: workdayCoverRows(legs, t),
    styles: { font, fontSize: 7.5, cellPadding: 4, valign: 'top' },
    headStyles: { fillColor: [15, 23, 42] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 44 },
      1: { cellWidth: 68 },
      2: { cellWidth: 68 },
      3: { cellWidth: 88 },
      // 4, the address, takes the width left over.
      5: { cellWidth: 60 },
      6: { cellWidth: 100 },
    },
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
  })
  y = lastTableY(doc, y) + 18
  drawStatement(doc, y, t, font)

  // ─── One section per leg: its rule sheet ───
  for (const leg of legs) {
    doc.addPage()
    y = PDF_MARGIN
    const tz = sessionTimezone(leg.location)
    doc.setFontSize(16)
    doc.setFont(font, 'bold')
    doc.setTextColor(15, 23, 42)
    doc.text(t('pdf.workday.legHeading', { number: stopNumber(leg) }), PDF_MARGIN, y)
    y += 14
    y = drawCouncilLine(doc, y, t, font)
    if (legTaggedLater(leg)) {
      doc.setTextColor(80)
      y = drawWrapped(doc, t('pdf.workday.tagged'), y, { font, style: 'italic', size: 9, lineHeight: 11 }) + 6
    }
    drawSessionBlock(doc, leg, y, t, font, tz, { photoMaxHeight: 200, fontSize: 9 })
  }

  // ─── The signature pages, leg by leg ───
  for (const leg of legs) {
    drawAppendixSafely(doc, leg, t, font, sessionTimezone(leg.location), t('pdf.workday.legHeading', { number: stopNumber(leg) }))
  }

  // ─── The chain between legs ───
  const checks = workdayChainChecks(legs, allLegs)
  if (checks.length > 0) {
    doc.addPage()
    y = PDF_MARGIN
    doc.setFontSize(18)
    doc.setFont(font, 'bold')
    doc.setTextColor(15, 23, 42)
    doc.text(t('pdf.workday.chain.heading'), PDF_MARGIN, y)
    y += 22
    doc.setTextColor(80)
    y = drawWrapped(doc, t('pdf.workday.chain.intro'), y, { font, size: 9.5, lineHeight: 12 }) + 10
    for (const check of checks) {
      doc.setTextColor(40)
      if (check.kind === 'pair') {
        y = ensureSpace(doc, y, 11 * (check.files.length + 2) + 6)
        // openssl, as in each leg's own steps: sha256sum isn't on Windows or macOS.
        for (const file of check.files) y = drawMono(doc, `   openssl dgst -sha256 ${file}`, y, 8, 11) + 2
        doc.setTextColor(40)
        y =
          drawWrapped(
            doc,
            t(check.files.length > 1 ? 'pdf.workday.chain.equalsOneOf' : 'pdf.workday.chain.equals', {
              leg: check.leg,
              link: check.link,
            }),
            y,
            { font, size: 8.5, lineHeight: 11, indent: 14 },
          ) + 8
      } else {
        const key = check.kind === 'not_linked' ? 'pdf.workday.chain.notLinked' : 'pdf.workday.chain.notInPdf'
        y = drawWrapped(doc, t(key, { leg: check.leg, link: check.link }), y, { font, size: 8.5, lineHeight: 11 }) + 8
      }
    }
  }

  drawHeaderAndFooter(doc, t, font)
  doc.save(`parkproof-workday-${String(workdayId).slice(0, 8)}.pdf`)
  return true
}
