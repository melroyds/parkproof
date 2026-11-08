// Handing the car over (build spec T7 item 5): whether a record can take a
// handover, who the record says is driving now, recording a handover as a
// signed `handover` addendum (schema and caps in lambda/addendum-schema.js),
// and the handovers a record holds, for the record screen and the PDF.
//
// A handover is the driver's own statement: who they say is taking the car
// next, and when they entered it (phone clock). ParkProof signs it as a link
// of the record's chain, which shows only that it existed, unchanged, by the
// signing time. Signed values are read from the signed payload (N2); values
// not signed yet come from the stored addendum and say so.
//
// The record stays active: a handover never sets ended_at.
import type { HandoverData, ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import { CAPS } from '../../lambda/addendum-schema.js'
import { DEV_KEY_ALIAS, MAX_ADDENDA, chainKeyForAddenda, fitText } from './evidence-chain'
import { signedTimeOf, type StoredLinkState } from './chain-view'
import { recordDriver } from './notice-compare'
import { queueAddendum } from './signing'
import { getSession, isActiveRecord } from './storage'

/** The longest name a handover keeps (and signs): the same cap as the record's driver. */
export const HANDOVER_NAME_MAX = CAPS.driverName

/** One handover as the record holds it. */
export interface HandoverPart {
  addendum_id: string
  /** Who the record says handed the car over, or null when nobody was named. */
  from_driver: string | null
  /** Who the driver said is taking the car. */
  to_driver: string
  /** When the handover was entered, by the phone's clock. */
  handed_over_at: string
  /** Signed (ParkProof's key or a development key), waiting to be signed, or refused. */
  state: StoredLinkState
  /** ParkProof's signing time, from the signed payload. Null unless signed. */
  signed_at: string | null
}

function payloadData(bundle: SignatureBundle): Record<string, unknown> | null {
  try {
    const p = JSON.parse(bundle.canonical_payload) as unknown
    const data = p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>).data : null
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const hasBundle = (a: SignedAddendum): boolean => a.bundle !== undefined && a.bundle !== null

function stateOf(a: SignedAddendum): StoredLinkState {
  if (hasBundle(a)) return a.bundle!.key_alias === DEV_KEY_ALIAS ? 'dev_key' : 'signed'
  return a.rejected ? 'rejected' : 'pending'
}

// Which copy of one handover to show when a sync merge stored two: signed first, then waiting, then refused.
const STATE_RANK: Record<StoredLinkState, number> = { signed: 0, dev_key: 0, pending: 1, rejected: 2 }

const nameOf = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null)

/**
 * The handovers the record holds, oldest first (by the phone's handover
 * time, then by seq): the signed data of each signed handover, the stored
 * data of one waiting to be signed or refused. One entry per handover,
 * however many copies a sync merge stored. A shared copy has none: it is
 * someone else's record.
 */
export function handoverParts(session: ParkingSession): HandoverPart[] {
  if (session.shared_from) return []
  const addenda = (Array.isArray(session.addenda) ? session.addenda : []).filter(
    (a): a is SignedAddendum => !!a && typeof a === 'object' && a.kind === 'handover' && typeof a.id === 'string',
  )
  const byId = new Map<string, SignedAddendum>()
  for (const a of addenda) {
    const seen = byId.get(a.id)
    if (!seen || STATE_RANK[stateOf(a)] < STATE_RANK[stateOf(seen)]) byId.set(a.id, a)
  }
  const out: Array<{ part: HandoverPart; seq: number }> = []
  for (const a of byId.values()) {
    const state = stateOf(a)
    const signed = state === 'signed' || state === 'dev_key'
    const data = signed
      ? payloadData(a.bundle as SignatureBundle)
      : a.data && typeof a.data === 'object'
        ? (a.data as Record<string, unknown>)
        : null
    const to = nameOf(data?.to_driver)
    const at =
      typeof data?.handed_over_at === 'string' && Number.isFinite(Date.parse(data.handed_over_at)) ? data.handed_over_at : null
    if (!to || !at) continue
    out.push({
      part: {
        addendum_id: a.id,
        from_driver: nameOf(data?.from_driver),
        to_driver: to,
        handed_over_at: at,
        state,
        signed_at: signed ? signedTimeOf(a.bundle as SignatureBundle) : null,
      },
      seq: typeof a.seq === 'number' ? a.seq : 0,
    })
  }
  return out
    .sort((x, y) => Date.parse(x.part.handed_over_at) - Date.parse(y.part.handed_over_at) || x.seq - y.seq)
    .map((entry) => entry.part)
}

/**
 * Who the record says is driving now: the person the latest handover (not
 * refused) named, else the driver entered when the park was logged (as
 * notice-compare's recordDriver reads it), else null.
 */
export function currentDriver(session: ParkingSession): string | null {
  const handovers = handoverParts(session).filter((h) => h.state !== 'rejected')
  if (handovers.length > 0) return handovers[handovers.length - 1].to_driver
  return recordDriver(session)?.name ?? null
}

/**
 * Can "Hand the car over" be offered on this record at `now`? Only on an
 * active record of the driver's own (as the home screen decides it,
 * `isActiveRecord`: not ended, and its limit still ahead or passed less
 * than 12 hours ago, or a no-sign park with no limit), whose chain this
 * device can extend, with room for the handover and still for the
 * departure part. A park that finished long ago never takes a handover
 * dated now.
 */
export function canHandOver(session: ParkingSession, now: number = Date.now()): boolean {
  if (!isActiveRecord(session, now)) return false
  if (chainKeyForAddenda(session) === undefined) return false
  const addenda = Array.isArray(session.addenda) ? session.addenda : []
  const forDeparture = addenda.some((a) => a?.kind === 'departure') ? 0 : 1
  return addenda.length < MAX_ADDENDA - forDeparture
}

/**
 * The signed handover data for handing the car to `toDriver` at `now`
 * (phone clock), or null when the name is empty once shaped to fit (control
 * and bidi characters removed, trimmed, at most 60 characters). The person
 * handing over is the record's current driver. No location: the phone may
 * not be at the car, and a handover doesn't move it.
 */
export function handoverData(session: ParkingSession, toDriver: string, now: number = Date.now()): HandoverData | null {
  const to = fitText(toDriver, HANDOVER_NAME_MAX)
  if (!to) return null
  return {
    from_driver: fitText(currentDriver(session), HANDOVER_NAME_MAX),
    to_driver: to,
    handed_over_at: new Date(now).toISOString(),
    location: null,
  }
}

/**
 * Hand the car over: queue a signed `handover` addendum on the record (its
 * capture time is the handover time) and start signing it. The record stays
 * active. Returns the queued addendum, or null when the record is gone,
 * can't take a handover, or the name is empty. Throws StorageFullError only
 * when the part itself can't be stored.
 */
export function queueHandover(sessionId: string, toDriver: string, now: number = Date.now()): SignedAddendum | null {
  const session = getSession(sessionId)
  if (!session || !canHandOver(session, now)) return null
  const data = handoverData(session, toDriver, now)
  if (!data) return null
  return queueAddendum(sessionId, 'handover', data, { captured_at: data.handed_over_at })
}
