import { CAPS, JURISDICTIONS } from '../../lambda/addendum-schema.js'
import { SIGN_READING_CAPS, USER_PERMIT_TYPES } from '../../lambda/sign-reading.js'
import type { DriverProfile, Jurisdiction, LogDraft, SavedPermit, UserPermitType } from '../types'
import type { SignReaderExtras } from './claude'
import { emptyLogDraft, fitText } from './evidence-chain'

// The driver's settings (build spec T4 items 2, 3 and 7): their name, which
// new records start with as the driver, and up to three saved permits,
// which go to the sign reader with each scan. Pure helpers only; the
// localStorage reads and writes are loadProfile and saveProfile in
// storage.ts.

/** localStorage key of the saved profile. */
export const PROFILE_KEY = 'parkproof.profile.v1'

/** The driver name's cap: the one arrival_context signs (addendum-schema `driverName`). */
export const DRIVER_NAME_MAX = CAPS.driverName
/** At most this many saved permits: the sign reader takes no more (validateUserPermits). */
export const MAX_SAVED_PERMITS = SIGN_READING_CAPS.userPermits
/** The area label's cap: the sign reader's cap for `user_permits[].area`. */
export const PERMIT_AREA_MAX = SIGN_READING_CAPS.userPermitArea

/** The permit types, in the order Settings offers them. */
export const PERMIT_TYPES = USER_PERMIT_TYPES as readonly UserPermitType[]
/** The states and territories, in the order Settings offers them. */
export const STATE_CODES = JURISDICTIONS as readonly Jurisdiction[]

 /** The i18n key of each permit type's name (enum values never print raw). */
export const PERMIT_TYPE_KEYS: Readonly<Record<UserPermitType, string>> = {
  accessible: 'prefs.permitType.accessible',
  resident: 'prefs.permitType.resident',
  business: 'prefs.permitType.business',
}

/** The i18n key of each state's or territory's full name. */
export const STATE_NAME_KEYS: Readonly<Record<Jurisdiction, string>> = {
  VIC: 'prefs.state.VIC',
  NSW: 'prefs.state.NSW',
  QLD: 'prefs.state.QLD',
  ACT: 'prefs.state.ACT',
  SA: 'prefs.state.SA',
  WA: 'prefs.state.WA',
  TAS: 'prefs.state.TAS',
  NT: 'prefs.state.NT',
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const ID_MAX = 64

export function emptyProfile(): DriverProfile {
  return { driver_name: null, permits: [] }
}

/** True for a real calendar date written 'YYYY-MM-DD' (not 2027-02-30). */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = DATE_RE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

/** Today in the phone's own time zone, 'YYYY-MM-DD'. */
export function localDateString(now: Date): string {
  const y = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

/**
 * A saved permit as kept: a known type, a state code or null, an area label
 * shaped the way the sign reader accepts it (fitText: control and bidi
 * characters become spaces, ends trimmed, cut at 60; null for an accessible
 * permit, which has no area), and a real expiry date or null. Null when the
 * entry can't be a permit (no id, unknown type).
 */
export function normalizeSavedPermit(value: unknown): SavedPermit | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || v.id.length === 0 || v.id.length > ID_MAX) return null
  if (typeof v.type !== 'string' || !PERMIT_TYPES.includes(v.type as UserPermitType)) return null
  const type = v.type as UserPermitType
  return {
    id: v.id,
    type,
    state: typeof v.state === 'string' && STATE_CODES.includes(v.state as Jurisdiction) ? (v.state as Jurisdiction) : null,
    area: type === 'accessible' ? null : fitText(v.area, PERMIT_AREA_MAX),
    expires_on: isDateOnly(v.expires_on) ? v.expires_on : null,
  }
}

/**
 * A profile as kept, from anything (a parsed localStorage value, or the
 * Settings form): the name shaped the way arrival_context signs it, and at
 * most 3 valid permits with distinct ids, in their saved order. Never throws.
 */
export function normalizeProfile(value: unknown): DriverProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyProfile()
  const v = value as Record<string, unknown>
  const permits: SavedPermit[] = []
  const ids = new Set<string>()
  for (const raw of Array.isArray(v.permits) ? v.permits : []) {
    const permit = normalizeSavedPermit(raw)
    if (!permit || ids.has(permit.id)) continue
    ids.add(permit.id)
    permits.push(permit)
    if (permits.length === MAX_SAVED_PERMITS) break
  }
  return { driver_name: fitText(v.driver_name, DRIVER_NAME_MAX), permits }
}

/**
 * True once the permit's printed expiry date has passed on the phone's
 * calendar. A permit is good through its expiry date. No date: not expired.
 */
export function isPermitExpired(permit: Pick<SavedPermit, 'expires_on'>, now: Date = new Date()): boolean {
  return isDateOnly(permit.expires_on) && permit.expires_on < localDateString(now)
}

/** The saved permits the driver can use today (not expired), in saved order. */
export function usablePermits(profile: DriverProfile, now: Date = new Date()): SavedPermit[] {
  return profile.permits.filter((p) => !isPermitExpired(p, now))
}

/**
 * What the sign reader is told about the driver's permits: each usable
 * permit's type, and the area label of a resident or business permit, in
 * exactly the shape lambda/sign-reading.js validates (at most 3, `{ type }`
 * or `{ type, area }`). Nothing else from Settings ever leaves the phone
 * with a scan: not the issuing state, not the expiry date, and never an
 * area for an accessible permit, so the Settings warning ("its type is
 * sent") stays true.
 */
export function signReaderPermits(
  profile: DriverProfile,
  now: Date = new Date(),
): Array<{ type: UserPermitType; area?: string }> {
  return usablePermits(profile, now)
    .slice(0, MAX_SAVED_PERMITS)
    .map((p) => (p.type !== 'accessible' && p.area ? { type: p.type, area: p.area } : { type: p.type }))
}

/**
 * The extras for translateSign and refreshInterpretation: the usable saved
 * permits and the parking state, each left out when there is none.
 */
export function signReaderExtras(
  profile: DriverProfile,
  parkingState: Jurisdiction | null,
  now: Date = new Date(),
): SignReaderExtras {
  const extras: SignReaderExtras = {}
  const permits = signReaderPermits(profile, now)
  if (permits.length > 0) extras.user_permits = permits
  if (parkingState) extras.parking_state = parkingState
  return extras
}

/**
 * The draft a new scan starts with (T4 item 7): empty, except that the
 * driver is the name saved in Settings. The logger's "Who's driving?" line
 * (T7) prefills from `draft.driver_name`, and a record saved without its
 * own driver takes it (applyLogDraftDefaults in evidence-chain.ts).
 */
export function logDraftFromProfile(profile: DriverProfile): LogDraft {
  // emptyLogDraft makes a new object each time; fill that one in.
  const draft = emptyLogDraft()
  draft.driver_name = profile.driver_name
  return draft
}

/** A new permit's id. */
export function newPermitId(): string {
  return crypto.randomUUID()
}
