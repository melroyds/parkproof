// The comparison lines on the notice screen (build spec T8 item 4): what a
// parking record says next to the time on a fine notice, worded as facts
// only. Pure: no storage, no network, no clock (the caller passes this
// device's signing state in, as deviceRecordContext reads it).
//
// The rules the wording follows (spec "Copy rules", N2, N5):
// - A statement that a part of the record was signed before the notice
//   rests on ParkProof's signing time, never on the phone's clock, and must
//   hold for every reading of the notice time (two in the hour repeated
//   when daylight saving ends): it is checked against the earliest. The
//   tap and log times are always labelled as the driver's (phone clock),
//   and the signing time as ParkProof's.
// - A development-key signature is never presented as ParkProof's.
// - Signed facts come from the signed payload (recordTimes, chain-view).
//   Driver names and handovers come from the signed part when there is
//   one, else from the record as stored, and then say they aren't signed;
//   the lines say "Your record says", never that ParkProof confirmed
//   anything.
// - Every time is formatted with formatInZone in the zone the notice time
//   was read in for this record (NoticeMatch.zone), with the zone's name.
//
// Lines are returned as i18n keys plus variables; renderComparisonLine
// turns one into text with `t`. Durations are kept as minutes until then,
// so they translate (with plurals) like everything else.
import type { TFunction } from 'i18next'
import type { HandoverData, ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import { DEV_KEY_ALIAS } from './evidence-chain'
import type { NoticeMatch } from './notice-match'
import { recordTimes, type RecordTimesContext } from './record-times'
import { formatInZone } from './time-format'

const MINUTE_MS = 60_000

/** One comparison line: an i18n key and its variables. */
export interface ComparisonLine {
  /** Stable React key. */
  id: string
  key: string
  vars: Record<string, string | number>
  /** Whole minutes between a record time and the notice time, rendered into vars.duration. */
  durationMinutes?: number
}

/** The keys of every comparison line, in one place for the screen, the tests and the legal review. */
export const COMPARE_KEYS = {
  departureSignedBefore: 'notice.compare.departureSignedBefore',
  departureSignedBeforeClock: 'notice.compare.departureSignedBeforeClock',
  departureSignedAfter: 'notice.compare.departureSignedAfter',
  departurePending: 'notice.compare.departurePending',
  departureNotSigned: 'notice.compare.departureNotSigned',
  departureDevKey: 'notice.compare.departureDevKey',
  devKey: 'verifier.link.devKey',
  noDeparture: 'notice.compare.noDeparture',
  arrivalBefore: 'notice.compare.arrivalBefore',
  arrivalAfter: 'notice.compare.arrivalAfter',
  arrivalSame: 'notice.compare.arrivalSame',
  arrivalSignedBefore: 'notice.compare.arrivalSignedBefore',
  arrivalSignedAfter: 'notice.compare.arrivalSignedAfter',
  arrivalDevKey: 'notice.compare.arrivalDevKey',
  arrivalPending: 'notice.compare.arrivalPending',
  arrivalNotSigned: 'notice.compare.arrivalNotSigned',
  driver: 'notice.compare.driver',
  driverPending: 'notice.compare.driverPending',
  driverNotSigned: 'notice.compare.driverNotSigned',
  handover: 'notice.compare.handover',
  handoverPending: 'notice.compare.handoverPending',
  checkRegistration: 'notice.compare.checkRegistration',
  checkDueDate: 'notice.compare.checkDueDate',
} as const

/** Above this gap between ParkProof's signing time and the phone's log time, both are shown (N5). */
export const SIGNED_GAP_SHOWN_MS = 5 * 60_000

/** How the part a line rests on stands. */
export type PartSigning = 'signed' | 'dev_key' | 'pending' | 'not_signed'

const bundleSigning = (bundle: SignatureBundle): 'signed' | 'dev_key' =>
  bundle.key_alias === DEV_KEY_ALIAS ? 'dev_key' : 'signed'

const msOf = (iso: string | null | undefined): number | null => {
  if (typeof iso !== 'string') return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/** The start of the minute an instant falls in: a time shown as "1:55 pm" is compared as 1:55:00. */
const floorMinute = (ms: number): number => Math.floor(ms / MINUTE_MS) * MINUTE_MS

/** Whole minutes from `fromMs` (as its shown minute) to `toMs` (positive when `to` is later). */
function minutesBetween(fromMs: number, toMs: number): number {
  return Math.round((floorMinute(toMs) - floorMinute(fromMs)) / MINUTE_MS)
}

function payloadOf(bundle: SignatureBundle | null | undefined): Record<string, unknown> | null {
  if (!bundle || typeof bundle.canonical_payload !== 'string') return null
  try {
    const p = JSON.parse(bundle.canonical_payload)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** An addendum's data: the signed payload's once signed, else the stored data. */
function addendumData(a: SignedAddendum): Record<string, unknown> | null {
  if (a.bundle) {
    const data = payloadOf(a.bundle)?.data
    return isObject(data) ? data : null
  }
  return isObject(a.data) ? a.data : null
}

function addendaOf(session: ParkingSession): SignedAddendum[] {
  return (Array.isArray(session.addenda) ? session.addenda : []).filter(
    (a): a is SignedAddendum => !!a && typeof a === 'object' && typeof a.id === 'string',
  )
}

const nonEmpty = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null)

export interface RecordDriver {
  name: string
  /**
   * 'signed' or 'dev_key': read from a signed arrival_context. 'pending':
   * an arrival_context naming this driver is waiting to be signed.
   * 'not_signed': nothing that will be signed names this driver.
   */
  signing: PartSigning
}

/**
 * Who the record says was driving, or null when nothing was entered.
 * A signed arrival_context is the source once there is one (even when it
 * names nobody); before that, the record's own driver_name, then the
 * arrival_context waiting to be signed. A shared copy has no driver line:
 * it is someone else's record.
 */
export function recordDriver(session: ParkingSession): RecordDriver | null {
  if (session.shared_from) return null
  const contexts = addendaOf(session).filter((a) => a.kind === 'arrival_context' && !a.rejected)
  const signed = contexts.find((a) => !!a.bundle)
  if (signed) {
    const name = nonEmpty(addendumData(signed)?.driver_name)
    return name ? { name, signing: bundleSigning(signed.bundle as SignatureBundle) } : null
  }
  const pendingNames = contexts.map((a) => nonEmpty(addendumData(a)?.driver_name))
  const name = nonEmpty(session.driver_name) ?? pendingNames.find((n): n is string => n !== null) ?? null
  if (!name) return null
  return { name, signing: pendingNames.includes(name) ? 'pending' : 'not_signed' }
}

export interface RecordHandover {
  addendum_id: string
  to_driver: string
  /** When the handover was entered, by the phone's clock. */
  handed_over_at: string
  /** Refused handovers are left out, so a handover is signed, dev-key signed, or waiting to be signed. */
  signing: Exclude<PartSigning, 'not_signed'>
}

/**
 * The handovers the record says happened, oldest first: the signed data of
 * each signed handover, the stored data of one still waiting to be signed.
 * Refused parts are left out (the server found their data malformed), and
 * so is a second copy of one handover (a sync merge can store both).
 */
export function recordHandovers(session: ParkingSession): RecordHandover[] {
  if (session.shared_from) return []
  const handovers = addendaOf(session).filter((a) => a.kind === 'handover' && !a.rejected)
  const byId = new Map<string, SignedAddendum>()
  for (const a of handovers) {
    const seen = byId.get(a.id)
    if (!seen || (!seen.bundle && a.bundle)) byId.set(a.id, a)
  }
  const out: RecordHandover[] = []
  for (const a of byId.values()) {
    const data = addendumData(a) as Partial<HandoverData> | null
    const to = nonEmpty(data?.to_driver)
    const at = typeof data?.handed_over_at === 'string' && msOf(data.handed_over_at) !== null ? data.handed_over_at : null
    const signing = a.bundle ? bundleSigning(a.bundle) : 'pending'
    if (to && at) out.push({ addendum_id: a.id, to_driver: to, handed_over_at: at, signing })
  }
  return out.sort((x, y) => (msOf(x.handed_over_at) as number) - (msOf(y.handed_over_at) as number))
}

// The line after a driver or handover line that isn't signed by ParkProof (N2).
const UNSIGNED_DRIVER_KEYS: Readonly<Record<PartSigning, string | null>> = {
  signed: null,
  dev_key: COMPARE_KEYS.devKey,
  pending: COMPARE_KEYS.driverPending,
  not_signed: COMPARE_KEYS.driverNotSigned,
}
const UNSIGNED_HANDOVER_KEYS: Readonly<Record<RecordHandover['signing'], string | null>> = {
  signed: null,
  dev_key: COMPARE_KEYS.devKey,
  pending: COMPARE_KEYS.handoverPending,
}

/**
 * The comparison lines for one record and the notice, in this order:
 * the departure (or that there was none), the arrival and how its record
 * stands, the driver and any handovers (only when the record has them,
 * each followed by a line when it isn't signed by ParkProof), then the two
 * checks that always show.
 *
 * Durations and the arrival's before or after are measured against
 * `notice_at`, the reading the screen names. A "signed before the notice"
 * statement must also hold for every other reading in `candidates`, so it
 * is checked against the earliest; when it doesn't hold for all of them,
 * the signed-after wording is used, naming the reading it fails for.
 */
export function noticeComparison(
  session: ParkingSession,
  match: Pick<NoticeMatch, 'notice_at' | 'zone'> & Partial<Pick<NoticeMatch, 'candidates'>>,
  context: RecordTimesContext = {},
): ComparisonLine[] {
  const zone = match.zone
  const noticeMs = msOf(match.notice_at)
  const fmt = (ms: number) => formatInZone(ms, zone)
  const times = recordTimes(session, context)
  const lines: ComparisonLine[] = []
  if (noticeMs === null) return lines
  const readings = (Array.isArray(match.candidates) ? match.candidates : [])
    .map(msOf)
    .filter((ms): ms is number => ms !== null)
  const earliestMs = Math.min(noticeMs, ...readings)
  // "Signed before the notice" rests on ParkProof's signing time: signed
  // before the notice's minute began, under every reading. A signature
  // inside that minute counts as after, as the notice time could be any
  // second of it.
  const signedBeforeNotice = (signedMs: number) => signedMs < earliestMs
  // The reading a signature isn't before: the compared one when it is
  // after that, else the earliest.
  const readingSignedAfter = (signedMs: number) => (signedMs >= noticeMs ? noticeMs : earliestMs)

  // ── The departure ──
  const departure = times.departure
  const tappedMs = departure ? msOf(departure.tapped_at) : null
  if (!departure || tappedMs === null) {
    lines.push({ id: 'departure', key: COMPARE_KEYS.noDeparture, vars: {} })
  } else {
    const signing = departure.signing
    const signedMs =
      signing.state === 'signed' || signing.state === 'dev_key' ? msOf(signing.signed_at) : null
    if (signing.state === 'dev_key') {
      // A development-key signature is never ParkProof's: no signing time
      // is shown as ParkProof's, and nothing is said to be before the notice.
      lines.push({
        id: 'departure',
        key: COMPARE_KEYS.departureDevKey,
        vars: { time: fmt(tappedMs), noticeTime: fmt(earliestMs) },
      })
    } else if (signedMs !== null) {
      if (signedBeforeNotice(signedMs)) {
        const minutes = minutesBetween(tappedMs, noticeMs)
        lines.push(
          minutes >= 1
            ? {
                id: 'departure',
                key: COMPARE_KEYS.departureSignedBefore,
                vars: { time: fmt(tappedMs), signedTime: fmt(signedMs) },
                durationMinutes: minutes,
              }
            : // The phone's clock put the tap at or after the notice time
              // although ParkProof signed it before (a phone clock running
              // fast): no "N minutes before" from the phone's clock then.
              {
                id: 'departure',
                key: COMPARE_KEYS.departureSignedBeforeClock,
                vars: { time: fmt(tappedMs), signedTime: fmt(signedMs) },
              },
        )
      } else {
        lines.push({
          id: 'departure',
          key: COMPARE_KEYS.departureSignedAfter,
          vars: { time: fmt(tappedMs), signedTime: fmt(signedMs), noticeTime: fmt(readingSignedAfter(signedMs)) },
        })
      }
    } else if (signing.state === 'rejected' || signing.state === 'none') {
      lines.push({ id: 'departure', key: COMPARE_KEYS.departureNotSigned, vars: { time: fmt(tappedMs) } })
    } else {
      lines.push({ id: 'departure', key: COMPARE_KEYS.departurePending, vars: { time: fmt(tappedMs) } })
    }
  }

  // ── The arrival (phone clock), then how its record stands ──
  const arrivedMs = msOf(times.arrived_at)
  if (arrivedMs !== null) {
    const minutes = minutesBetween(arrivedMs, noticeMs)
    const time = fmt(arrivedMs)
    if (minutes >= 1) {
      lines.push({ id: 'arrival', key: COMPARE_KEYS.arrivalBefore, vars: { time }, durationMinutes: minutes })
    } else if (minutes <= -1) {
      lines.push({ id: 'arrival', key: COMPARE_KEYS.arrivalAfter, vars: { time }, durationMinutes: -minutes })
    } else {
      lines.push({ id: 'arrival', key: COMPARE_KEYS.arrivalSame, vars: { time } })
    }

    // The log time is the phone's. What the signature can show about it
    // (N5): an arrival logged "before the notice" by a phone clock is only
    // shown to have existed then by a signature from before the notice.
    const arrivalSigning = times.arrival_signing
    if (arrivalSigning.state === 'signed') {
      const signedMs = msOf(arrivalSigning.signed_at)
      if (signedMs !== null && !signedBeforeNotice(signedMs)) {
        lines.push({
          id: 'arrival-signing',
          key: COMPARE_KEYS.arrivalSignedAfter,
          vars: { signedTime: fmt(signedMs), noticeTime: fmt(readingSignedAfter(signedMs)) },
        })
      } else if (signedMs !== null && (minutes < 1 || Math.abs(signedMs - arrivedMs) > SIGNED_GAP_SHOWN_MS)) {
        // Signed before the notice, but the phone's log time says otherwise
        // or is more than 5 minutes off ParkProof's: show both.
        lines.push({ id: 'arrival-signing', key: COMPARE_KEYS.arrivalSignedBefore, vars: { signedTime: fmt(signedMs) } })
      }
    } else if (arrivalSigning.state === 'dev_key') {
      lines.push({ id: 'arrival-signing', key: COMPARE_KEYS.arrivalDevKey, vars: { noticeTime: fmt(earliestMs) } })
    } else if (arrivalSigning.state === 'rejected') {
      lines.push({ id: 'arrival-signing', key: COMPARE_KEYS.arrivalNotSigned, vars: {} })
    } else {
      lines.push({ id: 'arrival-signing', key: COMPARE_KEYS.arrivalPending, vars: {} })
    }
  }

  // ── Who was driving, and handovers: only when the record has them ──
  const driver = recordDriver(session)
  if (driver) {
    lines.push({ id: 'driver', key: COMPARE_KEYS.driver, vars: { driver: driver.name } })
    const unsigned = UNSIGNED_DRIVER_KEYS[driver.signing]
    if (unsigned) lines.push({ id: 'driver-signing', key: unsigned, vars: {} })
  }
  for (const h of recordHandovers(session)) {
    lines.push({
      id: `handover-${h.addendum_id}`,
      key: COMPARE_KEYS.handover,
      vars: { to_driver: h.to_driver, time: fmt(msOf(h.handed_over_at) as number) },
    })
    const unsigned = UNSIGNED_HANDOVER_KEYS[h.signing]
    if (unsigned) lines.push({ id: `handover-${h.addendum_id}-signing`, key: unsigned, vars: {} })
  }

  // ── Always ──
  lines.push({ id: 'check-registration', key: COMPARE_KEYS.checkRegistration, vars: {} })
  lines.push({ id: 'check-due-date', key: COMPARE_KEYS.checkDueDate, vars: {} })
  return lines
}

/** "15 minutes", "1 hour", "1 hour 39 minutes", translated with plurals. */
export function formatNoticeDuration(totalMinutes: number, t: TFunction): string {
  const total = Math.max(0, Math.round(totalMinutes))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return t('notice.duration.minutes', { count: minutes })
  if (minutes === 0) return t('notice.duration.hours', { count: hours })
  return t('notice.duration.hoursMinutes', {
    hours: t('notice.duration.hours', { count: hours }),
    minutes: t('notice.duration.minutes', { count: minutes }),
  })
}

/** One comparison line as text. */
export function renderComparisonLine(line: ComparisonLine, t: TFunction): string {
  const vars: Record<string, string | number> = { ...line.vars }
  if (typeof line.durationMinutes === 'number') vars.duration = formatNoticeDuration(line.durationMinutes, t)
  return t(line.key, vars)
}
