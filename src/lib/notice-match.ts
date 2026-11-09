// Matching a parking fine notice to the driver's records (build spec T8
// item 3). Pure: no storage, no network, no clock. The caller passes the
// records, the notice's local time (as read, or as the driver corrected
// it), the forward-geocoded point of the notice's location and the issuing
// state; geocoding (src/lib/geocode.ts forwardGeocode) happens outside.
//
// A notice prints a local wall-clock time with no zone, so it is read in the
// zone of the record it is compared with: the record's own zone when the
// record has a location, otherwise the zone of the notice's geocoded
// location, else the issuing state's zone, else every Australian zone.
// Around a daylight-saving change a wall-clock time can name two instants
// (the repeated hour when clocks go back) or none (the skipped hour when
// they go forward); zonedWallClockToUtc returns both, or the shifted one.
//
// What this module decides is only which records are worth showing next to
// the notice, and in what order. It makes no claim about what happened: the
// comparison lines on the notice screen do that, from signed values only.
import tzlookup from 'tz-lookup'
import type { Jurisdiction, NoticeFields, ParkingSession } from '../types'
import { haversineMeters } from './geo'
import { recordTimes } from './record-times'
import { wallClockInZone } from './time-format'
import { sessionTimezone } from './timezone'

// ─── Wall-clock times ─────────────────────────────────────────────────────

export interface CalendarDate {
  year: number
  /** 1 to 12. */
  month: number
  day: number
}

export interface ClockTime {
  /** 0 to 23. */
  hour: number
  minute: number
}

/** A local date and time with no zone, as printed on a notice. */
export interface WallClock extends CalendarDate, ClockTime {}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** A real calendar day (1970 to 2100). */
export function isValidDate(d: CalendarDate | null | undefined): d is CalendarDate {
  if (!d || !isInt(d.year) || !isInt(d.month) || !isInt(d.day)) return false
  if (d.year < 1970 || d.year > 2100 || d.month < 1 || d.month > 12 || d.day < 1) return false
  const probe = new Date(Date.UTC(d.year, d.month - 1, d.day))
  return probe.getUTCMonth() === d.month - 1 && probe.getUTCDate() === d.day
}

export function isValidTime(t: ClockTime | null | undefined): t is ClockTime {
  return !!t && isInt(t.hour) && isInt(t.minute) && t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute <= 59
}

export function isValidWallClock(w: WallClock | null | undefined): w is WallClock {
  return isValidDate(w) && isValidTime(w)
}

/**
 * The wall clock in `timeZone` at instant `ms` (seconds dropped). Read
 * through time-format.ts's wallClockInZone, the app's one reading of a
 * zone's clock. Throws RangeError for an unknown zone.
 */
export function wallClockAt(ms: number, timeZone: string): WallClock {
  const w = wallClockInZone(ms, timeZone)
  return { year: w.year, month: w.month, day: w.day, hour: w.hour, minute: w.minute }
}

function wallClockWithSeconds(ms: number, timeZone: string): WallClock & { second: number } {
  return wallClockInZone(ms, timeZone)
}

/** The zone's UTC offset at instant `ms`, in ms (east positive). */
function offsetAt(ms: number, timeZone: string): number {
  const whole = Math.floor(ms / 1000) * 1000
  const w = wallClockWithSeconds(whole, timeZone)
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - whole
}

const sameWallClock = (a: WallClock, b: WallClock): boolean =>
  a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute

/**
 * Every instant (epoch ms, ascending) at which the clocks in `timeZone`
 * showed this wall-clock time:
 * - one instant normally;
 * - two in the hour repeated when the clocks go back (02:30 on
 *   4 April 2027 in Melbourne is 02:30 AEDT and, an hour later, 02:30 AEST);
 * - for a time skipped when the clocks go forward, the one instant the time
 *   lands on read with the offset in force before the change, which moves it
 *   forward by the gap (02:30 on 4 October 2026 in Melbourne becomes
 *   03:30 AEDT), as Temporal's 'compatible' reading does.
 * Empty for an impossible date or time, or an unknown zone.
 */
export function zonedWallClockToUtc(parts: WallClock, timeZone: string): number[] {
  if (!isValidWallClock(parts)) return []
  try {
    wallClockInZone(0, timeZone)
  } catch {
    return []
  }
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  // The offsets in force a day either side cover both sides of any change.
  const offsets = new Set([offsetAt(naive - DAY_MS, timeZone), offsetAt(naive, timeZone), offsetAt(naive + DAY_MS, timeZone)])
  const hits = new Set<number>()
  for (const offset of offsets) {
    const instant = naive - offset
    if (sameWallClock(wallClockAt(instant, timeZone), parts)) hits.add(instant)
  }
  if (hits.size > 0) return [...hits].sort((a, b) => a - b)
  return [naive - offsetAt(naive - DAY_MS, timeZone)]
}

export type WallClockStatus = 'normal' | 'repeated' | 'skipped' | 'invalid'

/** Whether this wall-clock time happened once, twice, or never (skipped) in `timeZone`. */
export function wallClockStatus(parts: WallClock, timeZone: string): WallClockStatus {
  const instants = zonedWallClockToUtc(parts, timeZone)
  if (instants.length === 0) return 'invalid'
  if (instants.length > 1) return 'repeated'
  return sameWallClock(wallClockAt(instants[0], timeZone), parts) ? 'normal' : 'skipped'
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** 'YYYY-MM-DDTHH:MM', the shape of offence_datetime_local (and of an <input type="datetime-local">). */
export function formatWallClock(w: WallClock): string {
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** A 'YYYY-MM-DDTHH:MM' value (the model's offence_datetime_local, or an edited one), or null. */
export function parseWallClock(value: string | null | undefined): WallClock | null {
  if (typeof value !== 'string') return null
  const m = LOCAL_RE.exec(value.trim())
  if (!m) return null
  const [year, month, day, hour, minute] = m.slice(1).map(Number)
  const w = { year, month, day, hour, minute }
  return isValidWallClock(w) ? w : null
}

// ─── Reading the printed date and time ────────────────────────────────────

const MONTH_RE =
  /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function monthOf(word: string): number | null {
  const m = MONTH_RE.exec(word)
  return m ? MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1 : null
}

function fullYear(text: string): number {
  const n = Number(text)
  return text.length === 2 ? 2000 + n : n
}

function dateOrNull(year: number, month: number, day: number): CalendarDate | null {
  const d = { year, month, day }
  return isValidDate(d) ? d : null
}

/**
 * The date printed on a notice, read day first as Australian notices print
 * it: "04/05/2027" and "4-5-27" are 4 May 2027. Also reads year-first ISO
 * dates ("2027-05-04") and dates with a month name ("Tue 4 May 2027",
 * "04-May-2027", "May 4, 2027"). Null when no real date can be read.
 */
export function parseDayFirstDate(raw: string | null | undefined): CalendarDate | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().replace(/\s+/g, ' ')
  if (!s) return null
  let m = /(?:^|\D)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(s)
  if (m) return dateOrNull(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /(?:^|\D)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/.exec(s)
  if (m) return dateOrNull(fullYear(m[3]), Number(m[2]), Number(m[1]))
  m = /(?:^|\D)(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*([A-Za-z]{3,9})\.?[\s\-/.,]*(\d{4}|\d{2})(?!\d)/.exec(s)
  if (m) {
    const month = monthOf(m[2])
    if (month) return dateOrNull(fullYear(m[3]), month, Number(m[1]))
  }
  m = /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})(?!\d)/.exec(s)
  if (m) {
    const month = monthOf(m[1])
    if (month) return dateOrNull(Number(m[3]), month, Number(m[2]))
  }
  return null
}

/**
 * A printed time as read. `halfOfDayUnknown` is true for a time written
 * without am or pm whose hour is 1 to 12 ("2:10", "12:30"): it could be
 * either half of the day (the am or pm may be printed in another box, or
 * cut off). A 24-hour hour (0 or 13 to 23), a zero-padded hour ("02:10",
 * the way a 24-hour clock writes 2:10 am), an am or pm, a four-digit
 * "1410 hrs", noon and midnight are all unambiguous.
 */
interface PrintedClock {
  time: ClockTime
  halfOfDayUnknown: boolean
}

function printedOrNull(time: ClockTime | null, halfOfDayUnknown: boolean): PrintedClock | null {
  return time ? { time, halfOfDayUnknown: halfOfDayUnknown && time.hour >= 1 && time.hour <= 12 } : null
}

function clockOrNull(hour: number, minute: number, period: string | undefined): ClockTime | null {
  if (minute < 0 || minute > 59) return null
  if (period) {
    const pm = period.startsWith('p')
    if (hour >= 13 && hour <= 23) return pm ? { hour, minute } : null // "14:30 pm" is consistent; "13:00 am" isn't
    if (hour === 0) return pm ? null : { hour: 0, minute }
    if (hour < 1 || hour > 12) return null
    return { hour: (hour % 12) + (pm ? 12 : 0), minute }
  }
  return hour >= 0 && hour <= 23 ? { hour, minute } : null
}

const PERIOD = '(a\\.?m\\.?|p\\.?m\\.?)'
const HM_RE = new RegExp(`(?:^|\\D)(\\d{1,2})[:.](\\d{2})(?::\\d{2})?\\s*${PERIOD}?(?![\\d])`)
const HM_COLON_RE = new RegExp(`(?:^|\\D)(\\d{1,2}):(\\d{2})(?::\\d{2})?\\s*${PERIOD}?(?![\\d])`)
const H_PERIOD_RE = new RegExp(`(?:^|\\D)(\\d{1,2})\\s*${PERIOD}(?![a-z])`)

function periodOf(text: string | undefined): string | undefined {
  return text ? text.replace(/\./g, '') : undefined
}

/**
 * True when an hour printed without am or pm leaves the half of the day
 * open: "2" or "12" could be either, but a zero-padded "02" is how a
 * 24-hour clock writes the small hours, never an afternoon.
 */
function hourLeavesHalfOfDayOpen(hourText: string, period: string | undefined): boolean {
  return !period && !(hourText.length === 2 && hourText.startsWith('0'))
}

/**
 * The time printed on a notice: "2:10 PM", "2.10pm", "14:10", "14:10:32",
 * "1410", "1410 hrs", "2pm", "noon", "midnight". Null when no valid time
 * can be read.
 */
export function parseClockTime(raw: string | null | undefined): ClockTime | null {
  return readPrintedClock(raw)?.time ?? null
}

function readPrintedClock(raw: string | null | undefined): PrintedClock | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!s) return null
  if (/\b(noon|midday)\b/.test(s)) return printedOrNull({ hour: 12, minute: 0 }, false)
  if (/\bmidnight\b/.test(s)) return printedOrNull({ hour: 0, minute: 0 }, false)
  let m = HM_RE.exec(s)
  if (m) return printedOrNull(clockOrNull(Number(m[1]), Number(m[2]), periodOf(m[3])), hourLeavesHalfOfDayOpen(m[1], m[3]))
  m = /^(\d{2})(\d{2})\s*(?:hrs?|h|hours)?$/.exec(s)
  if (m) return printedOrNull(clockOrNull(Number(m[1]), Number(m[2]), undefined), false)
  m = H_PERIOD_RE.exec(s)
  if (m) return printedOrNull(clockOrNull(Number(m[1]), 0, periodOf(m[2])), false)
  return null
}

/**
 * A time printed inside the date field ("04.05.2027 2:10 PM"). Stricter
 * than parseClockTime: a colon or an am/pm is required, so the "04.05" of
 * a dotted date is never read as a time.
 */
function timeInDateText(raw: string | null | undefined): PrintedClock | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  let m = HM_COLON_RE.exec(s)
  if (m) return printedOrNull(clockOrNull(Number(m[1]), Number(m[2]), periodOf(m[3])), hourLeavesHalfOfDayOpen(m[1], m[3]))
  m = H_PERIOD_RE.exec(s)
  if (m) return printedOrNull(clockOrNull(Number(m[1]), 0, periodOf(m[2])), false)
  return null
}

export interface NoticeLocalTime {
  /** The wall-clock time matching uses: the printed reading where there is one, else the model's. Null without both a date and a time. */
  local: WallClock | null
  /** offence_date_raw read day first, or null. */
  raw_date: CalendarDate | null
  /** offence_time_raw read (or a time printed in the date field), or null. */
  raw_time: ClockTime | null
  /** The model's offence_datetime_local, or null. */
  model: WallClock | null
  date_source: 'printed' | 'model' | null
  time_source: 'printed' | 'model' | null
  /** The model's date differs from the day-first reading of the printed date (for example it read 04/05 as 5 April). */
  date_disagrees: boolean
  time_disagrees: boolean
  /** Either disagrees: show the date and time for the driver to check. */
  disagrees: boolean
}

/**
 * The notice's local offence time. The printed date is re-read here, day
 * first, rather than trusted from the model, and any disagreement with the
 * model's own reading is flagged so the screen can ask the driver to check.
 * A printed time without am or pm ("2:10") is the one exception: when the
 * model read the same time in the other half of the day (14:10, from an am
 * or pm printed elsewhere on the notice), the model's reading is used.
 */
export function noticeLocalTime(
  notice: Pick<NoticeFields, 'offence_date_raw' | 'offence_time_raw' | 'offence_datetime_local'>,
): NoticeLocalTime {
  const raw_date = parseDayFirstDate(notice.offence_date_raw)
  const printed = readPrintedClock(notice.offence_time_raw) ?? timeInDateText(notice.offence_date_raw)
  const raw_time = printed?.time ?? null
  const model = parseWallClock(notice.offence_datetime_local)
  const modelFillsHalfOfDay =
    !!printed &&
    printed.halfOfDayUnknown &&
    !!model &&
    model.minute === printed.time.minute &&
    model.hour !== printed.time.hour &&
    model.hour % 12 === printed.time.hour % 12
  const date: CalendarDate | null = raw_date ?? (model ? { year: model.year, month: model.month, day: model.day } : null)
  const printedTime = modelFillsHalfOfDay ? null : raw_time
  const time: ClockTime | null = printedTime ?? (model ? { hour: model.hour, minute: model.minute } : null)
  const date_disagrees =
    !!raw_date && !!model && (raw_date.year !== model.year || raw_date.month !== model.month || raw_date.day !== model.day)
  const time_disagrees = !!printedTime && !!model && (printedTime.hour !== model.hour || printedTime.minute !== model.minute)
  return {
    local: date && time ? { ...date, ...time } : null,
    raw_date,
    raw_time,
    model,
    date_source: raw_date ? 'printed' : model ? 'model' : null,
    time_source: printedTime ? 'printed' : model ? 'model' : null,
    date_disagrees,
    time_disagrees,
    disagrees: date_disagrees || time_disagrees,
  }
}

// ─── Where the notice was issued ──────────────────────────────────────────

/** The zone each state's notices are read in when nothing more precise is known. */
export const STATE_ZONES: Readonly<Record<Jurisdiction, string>> = {
  VIC: 'Australia/Melbourne',
  NSW: 'Australia/Sydney',
  ACT: 'Australia/Sydney',
  QLD: 'Australia/Brisbane',
  SA: 'Australia/Adelaide',
  WA: 'Australia/Perth',
  TAS: 'Australia/Hobart',
  NT: 'Australia/Darwin',
}

/** Every mainland and Tasmanian zone, for a record and a notice with no place at all. */
export const ALL_AUSTRALIAN_ZONES: readonly string[] = [
  'Australia/Perth',
  'Australia/Darwin',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Hobart',
]

const STATE_NAMES: Readonly<Record<Jurisdiction, string>> = {
  VIC: 'Victoria',
  NSW: 'New South Wales',
  ACT: 'Australian Capital Territory',
  QLD: 'Queensland',
  SA: 'South Australia',
  WA: 'Western Australia',
  TAS: 'Tasmania',
  NT: 'Northern Territory',
}

/** The state an Australian postcode belongs to, or null. */
export function stateForPostcode(postcode: number): Jurisdiction | null {
  if (!isInt(postcode)) return null
  if (postcode >= 200 && postcode <= 299) return 'ACT'
  if (postcode >= 800 && postcode <= 999) return 'NT'
  if (postcode >= 1000 && postcode <= 2599) return 'NSW'
  if (postcode >= 2600 && postcode <= 2618) return 'ACT'
  if (postcode >= 2619 && postcode <= 2899) return 'NSW'
  if (postcode >= 2900 && postcode <= 2920) return 'ACT'
  if (postcode >= 2921 && postcode <= 2999) return 'NSW'
  if (postcode >= 3000 && postcode <= 3999) return 'VIC'
  if (postcode >= 4000 && postcode <= 4999) return 'QLD'
  if (postcode >= 5000 && postcode <= 5999) return 'SA'
  if (postcode >= 6000 && postcode <= 6999) return 'WA'
  if (postcode >= 7000 && postcode <= 7999) return 'TAS'
  if (postcode >= 8000 && postcode <= 8999) return 'VIC'
  if (postcode >= 9000 && postcode <= 9999) return 'QLD'
  return null
}

// Abbreviations that are also ordinary words or syllables (SA, WA, NT, ACT)
// count only in capitals. Vic, Qld, NSW and Tas count in any case.
const ABBREVIATIONS: Array<[RegExp, Jurisdiction]> = [
  [/\bvic\b/i, 'VIC'],
  [/\bnsw\b/i, 'NSW'],
  [/\bqld\b/i, 'QLD'],
  [/\btas\b/i, 'TAS'],
  [/\bACT\b/, 'ACT'],
  [/\bSA\b/, 'SA'],
  [/\bWA\b/, 'WA'],
  [/\bNT\b/, 'NT'],
]

// State and capital-city names. Only read from the issuing authority:
// street names are full of them ("Sydney Rd" is in Melbourne).
const AUTHORITY_NAMES: Array<[RegExp, Jurisdiction]> = [
  [/\bvictoria\b(?!\s+park)|\bmelbourne\b/i, 'VIC'],
  [/\bnew south wales\b|\bsydney\b/i, 'NSW'],
  [/\bqueensland\b|\bbrisbane\b|\bgold coast\b/i, 'QLD'],
  [/\baustralian capital territory\b|\bcanberra\b/i, 'ACT'],
  [/\bsouth australia\b|\badelaide\b/i, 'SA'],
  [/\bwestern australia\b|\bperth\b/i, 'WA'],
  [/\btasmania\b|\bhobart\b/i, 'TAS'],
  [/\bnorthern territory\b|\bdarwin\b/i, 'NT'],
]

const POSTCODE_AFTER_STATE_RE = /\b(?:vic|nsw|qld|tas|act|sa|wa|nt)\.?,?\s+(\d{4})\b/gi
// A trailing four-digit number, unless it is a bay, meter or space number.
const TRAILING_POSTCODE_RE = /(?<!\b(?:bay|meter|space|zone|no\.?|number|#)\s*)\b(\d{4})\s*$/i

function statesIn(text: string | null | undefined, { names }: { names: boolean }): Set<Jurisdiction> {
  const found = new Set<Jurisdiction>()
  if (typeof text !== 'string' || !text.trim()) return found
  for (const [re, state] of ABBREVIATIONS) if (re.test(text)) found.add(state)
  if (names) for (const [re, state] of AUTHORITY_NAMES) if (re.test(text)) found.add(state)
  for (const m of text.matchAll(POSTCODE_AFTER_STATE_RE)) {
    const state = stateForPostcode(Number(m[1]))
    if (state) found.add(state)
  }
  const trailing = TRAILING_POSTCODE_RE.exec(text.trim())
  if (trailing) {
    const state = stateForPostcode(Number(trailing[1]))
    if (state) found.add(state)
  }
  return found
}

/**
 * The state that issued the notice, when the notice says so without doubt:
 * a state abbreviation or postcode in the location ("Carlton VIC 3053"),
 * else a state, capital city, abbreviation or postcode in the issuing
 * authority ("Fines Victoria", "Revenue NSW", "Brisbane City Council").
 * Null when nothing points to one state, or the clues disagree.
 */
export function inferIssuingState(
  notice: Pick<NoticeFields, 'issuing_authority' | 'location_text'>,
): Jurisdiction | null {
  const fromLocation = statesIn(notice.location_text, { names: false })
  if (fromLocation.size === 1) return [...fromLocation][0]
  if (fromLocation.size > 1) return null
  const fromAuthority = statesIn(notice.issuing_authority, { names: true })
  return fromAuthority.size === 1 ? [...fromAuthority][0] : null
}

/**
 * What to forward-geocode for the notice's location: the printed location,
 * with the state and the country added when they aren't there, so a street
 * name isn't found in another country. Null without a location.
 */
export function noticeGeocodeQuery(
  notice: Pick<NoticeFields, 'location_text'>,
  issuingState: Jurisdiction | null = null,
): string | null {
  const location = typeof notice.location_text === 'string' ? notice.location_text.trim() : ''
  if (!location) return null
  const parts = [location]
  if (issuingState && statesIn(location, { names: false }).size === 0 && !location.includes(STATE_NAMES[issuingState])) {
    parts.push(issuingState)
  }
  if (!/\baustralia\b/i.test(location)) parts.push('Australia')
  return parts.join(', ')
}

// ─── Zones for a record ───────────────────────────────────────────────────

export type ZoneSource = 'record' | 'notice_location' | 'issuing_state' | 'all_zones'

export interface LatLng {
  lat: number
  lng: number
}

const isPoint = (p: unknown): p is LatLng =>
  !!p &&
  typeof (p as LatLng).lat === 'number' &&
  typeof (p as LatLng).lng === 'number' &&
  Number.isFinite((p as LatLng).lat) &&
  Number.isFinite((p as LatLng).lng) &&
  Math.abs((p as LatLng).lat) <= 90 &&
  Math.abs((p as LatLng).lng) <= 180

/** The Australian zone at a point, or null (outside Australia, or no answer). */
export function australianZoneAt(lat: number, lng: number): string | null {
  try {
    const zone = tzlookup(lat, lng)
    return typeof zone === 'string' && zone.startsWith('Australia/') ? zone : null
  } catch {
    return null
  }
}

export interface NoticePlace {
  /** The forward geocode of the notice's location_text, or null. */
  noticePoint?: LatLng | null
  /** inferIssuingState, or the driver's choice. */
  issuingState?: Jurisdiction | null
}

/**
 * The zones a notice time is read in for a record with no location: the
 * zone of the notice's geocoded location, else the issuing state's, else
 * every Australian zone.
 */
export function noticeFallbackZones(
  place: NoticePlace,
  zoneForPoint: (lat: number, lng: number) => string | null = australianZoneAt,
): { zones: string[]; source: Exclude<ZoneSource, 'record'> } {
  if (isPoint(place.noticePoint)) {
    const zone = zoneForPoint(place.noticePoint.lat, place.noticePoint.lng)
    if (zone) return { zones: [zone], source: 'notice_location' }
  }
  if (place.issuingState && STATE_ZONES[place.issuingState]) {
    return { zones: [STATE_ZONES[place.issuingState]], source: 'issuing_state' }
  }
  return { zones: [...ALL_AUSTRALIAN_ZONES], source: 'all_zones' }
}

// ─── A record's window ────────────────────────────────────────────────────

/** A notice up to this long before the record was logged still counts (the driver may log a minute late). */
export const WINDOW_BEFORE_ARRIVAL_MS = 10 * MINUTE_MS
/** A notice up to this long after the record's end still counts (a late tap, a late notice time). */
export const WINDOW_AFTER_END_MS = 6 * HOUR_MS
/** A record with no departure and no expiry is taken to run this long. */
export const OPEN_RECORD_SPAN_MS = 24 * HOUR_MS

export type RecordEndSource = 'departure_signed' | 'ended' | 'expires' | 'arrived_plus_24h'

export interface RecordWindow {
  arrived_ms: number
  /** The record's end: the first of ParkProof's signing time for the departure, the I've left tap, the sign's expiry, or arrival plus 24 h. */
  end_ms: number
  end_source: RecordEndSource
  /**
   * The end the ranking measures from: the I've left tap, or end_ms when
   * that is earlier (a phone clock running fast); without a tap, end_ms.
   * A departure can be signed long after the tap (offline, or only on the
   * next app open), so its signing time widens the window (end_ms) but
   * never stretches the span the record is ranked on.
   */
  span_end_ms: number
  /** arrived_ms minus 10 minutes. */
  start_ms: number
  /** end_ms plus 6 hours. */
  until_ms: number
}

const msOf = (iso: string | null | undefined): number | null => {
  if (typeof iso !== 'string') return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

/**
 * The span of time a notice must fall in to be matched with this record,
 * or null when the record's arrival time can't be read. Times are the
 * signed values once signed (recordTimes). The end is the first one the
 * record has, in this order: ParkProof's signing time of the departure
 * (an upper bound that doesn't depend on the phone's clock), the I've left
 * tap, the sign's expiry, then arrival plus 24 hours. Ranking measures from
 * span_end_ms instead (the tap), so a departure signed a day late can't
 * make its record look as if it ran until then.
 */
export function recordWindow(session: ParkingSession): RecordWindow | null {
  const times = recordTimes(session)
  const arrived = msOf(times.arrived_at)
  if (arrived === null) return null
  const departure = times.departure
  const signedDeparture =
    departure && (departure.signing.state === 'signed' || departure.signing.state === 'dev_key')
      ? msOf(departure.signing.signed_at)
      : null
  const tapped = departure ? msOf(departure.tapped_at) : null
  const candidates: Array<[number | null, RecordEndSource]> = [
    [signedDeparture, 'departure_signed'],
    [tapped, 'ended'],
    [msOf(times.expires_at), 'expires'],
    [arrived + OPEN_RECORD_SPAN_MS, 'arrived_plus_24h'],
  ]
  const [end, end_source] = candidates.find(([ms]) => ms !== null) as [number, RecordEndSource]
  const end_ms = Math.max(end, arrived)
  return {
    arrived_ms: arrived,
    end_ms,
    end_source,
    span_end_ms: tapped === null ? end_ms : Math.max(Math.min(tapped, end_ms), arrived),
    start_ms: arrived - WINDOW_BEFORE_ARRIVAL_MS,
    until_ms: end_ms + WINDOW_AFTER_END_MS,
  }
}

// ─── Matching and ranking ─────────────────────────────────────────────────

/** Beyond this, a record is flagged as far from the notice's location. */
export const FAR_FROM_NOTICE_M = 5_000
/** Ranking weight: one kilometre between the record and the notice's location counts like this many minutes. */
export const MINUTES_PER_KM = 30
/** Ranking weight for a record whose distance from the notice can't be worked out (about 500 m). */
export const UNKNOWN_DISTANCE_PENALTY_MIN = 15

export interface MatchNoticeInput extends NoticePlace {
  /** The notice's local offence time (noticeLocalTime().local, or the driver's correction). */
  local: WallClock
  records: readonly ParkingSession[]
}

export interface MatchNoticeOptions {
  /** The zone at a point (default: tz-lookup, Australian zones only). */
  zoneForPoint?: (lat: number, lng: number) => string | null
}

export interface NoticeMatch {
  session_id: string
  /** The notice time as an instant, read in `zone`: the reading closest to the record. */
  notice_at: string
  /** Every reading of the notice time that falls in this record's window (two in a repeated hour). */
  candidates: string[]
  zone: string
  zone_source: ZoneSource
  /** 'repeated': the notice's time happened twice in this zone; 'skipped': it never happened and was moved forward. */
  time_status: Exclude<WallClockStatus, 'invalid'>
  /** notice_at is between the record's arrival and the end of its span (the I've left tap; RecordWindow.span_end_ms). */
  inside: boolean
  /** 0 when inside, else how far notice_at is from the arrival or the end of the span. */
  time_distance_ms: number
  /** Metres from the record's location to the notice's geocoded location, or null. */
  distance_m: number | null
  /** distance_m is over FAR_FROM_NOTICE_M. */
  far: boolean
  /** Lower ranks first. */
  score: number
  window: { start: string; end: string }
  record_end: { at: string; source: RecordEndSource }
}

const iso = (ms: number) => new Date(ms).toISOString()

function recordPoint(session: ParkingSession): LatLng | null {
  const loc = session.location
  return loc && isPoint(loc) ? { lat: loc.lat, lng: loc.lng } : null
}

/**
 * The records the notice may be about, best first. A record matches when
 * some reading of the notice's local time falls between 10 minutes before
 * it was logged and 6 hours after its end (recordWindow). The time is read
 * in the record's own zone when it has a location, else by
 * noticeFallbackZones. Ranked by how far the notice time is from the
 * record's span (arrival to the I've left tap, never to a late signing
 * time) plus how far the record is from the notice's geocoded location
 * (30 minutes a kilometre; unknown counts as 15 minutes).
 */
export function matchNotice(input: MatchNoticeInput, options: MatchNoticeOptions = {}): NoticeMatch[] {
  if (!isValidWallClock(input.local)) return []
  const noticePoint = isPoint(input.noticePoint) ? input.noticePoint : null
  const fallback = noticeFallbackZones({ noticePoint, issuingState: input.issuingState ?? null }, options.zoneForPoint)
  const ranked: Array<{ match: NoticeMatch; arrived_ms: number }> = []

  for (const session of input.records) {
    if (!session || typeof session.id !== 'string') continue
    const window = recordWindow(session)
    if (!window) continue
    const point = recordPoint(session)
    const { zones, source } = point ? { zones: [sessionTimezone(session.location)], source: 'record' as const } : fallback

    let best: { at: number; zone: string; distance: number } | null = null
    const inWindow: number[] = []
    for (const zone of zones) {
      for (const at of zonedWallClockToUtc(input.local, zone)) {
        if (at < window.start_ms || at > window.until_ms) continue
        inWindow.push(at)
        const distance =
          at < window.arrived_ms ? window.arrived_ms - at : at > window.span_end_ms ? at - window.span_end_ms : 0
        if (!best || distance < best.distance || (distance === best.distance && at < best.at)) best = { at, zone, distance }
      }
    }
    if (!best) continue

    const distance_m = point && noticePoint ? haversineMeters(point, noticePoint) : null
    const status = wallClockStatus(input.local, best.zone)
    const score =
      best.distance / MINUTE_MS + (distance_m === null ? UNKNOWN_DISTANCE_PENALTY_MIN : (distance_m / 1000) * MINUTES_PER_KM)
    const match: NoticeMatch = {
      session_id: session.id,
      notice_at: iso(best.at),
      candidates: [...new Set(inWindow)].sort((a, b) => a - b).map(iso),
      zone: best.zone,
      zone_source: source,
      time_status: status === 'invalid' ? 'normal' : status,
      inside: best.distance === 0,
      time_distance_ms: best.distance,
      distance_m,
      far: distance_m !== null && distance_m > FAR_FROM_NOTICE_M,
      score,
      window: { start: iso(window.start_ms), end: iso(window.until_ms) },
      record_end: { at: iso(window.end_ms), source: window.end_source },
    }
    ranked.push({ match, arrived_ms: window.arrived_ms })
  }

  // Ties: the nearer time, then the later record, then the id (a stable order).
  ranked.sort(
    (a, b) =>
      a.match.score - b.match.score ||
      a.match.time_distance_ms - b.match.time_distance_ms ||
      b.arrived_ms - a.arrived_ms ||
      a.match.session_id.localeCompare(b.match.session_id),
  )
  return ranked.map((r) => r.match)
}
