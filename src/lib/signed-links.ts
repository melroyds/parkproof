// The signed links of a record, as the PDF's signature appendix and the
// evidence file (T2) both list them. Pure: no storage, no network, no
// jsPDF, so the record screen can build the evidence file without loading
// the PDF code.
//
// Link 0 is the record's own arrival bundle; links 1, 2, 3... are the
// signed addenda, by the seq inside their signed payload (N2). Pending and
// refused parts have no signature and are not listed. A shared copy's
// sender bundle belongs to the shared view (T7), so a shared copy lists
// nothing here.
import type { ParkingSession, SignatureBundle } from '../types'
import { signedTimeOf, type ChainLinkKind } from './chain-view'

/**
 * Every field the appendix and the evidence file read is present and a
 * string. Nothing is checked cryptographically here: the PDF and the file
 * carry the raw bytes for an external `openssl dgst` check.
 */
export function isCompleteBundle(sig: unknown): sig is SignatureBundle {
  if (!sig || typeof sig !== 'object') return false
  const s = sig as Record<string, unknown>
  const required = ['schema', 'signed_at', 'algorithm', 'key_alias', 'canonical_payload', 'signature_base64'] as const
  return required.every((k) => typeof s[k] === 'string' && (s[k] as string).length > 0)
}

/** One signed link of a record. */
export interface SignedLink {
  /** "0", "1", "2a": the link's name in the PDF heading, its file names and the chain step. */
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

/** The file names a link's blocks are saved as (T1b: link0-payload.b64, link1-payload.b64 ...). */
export function linkFileNames(name: string): { payloadB64: string; payloadTxt: string; sigB64: string; sigBin: string } {
  return {
    payloadB64: `link${name}-payload.b64`,
    payloadTxt: `link${name}-payload.txt`,
    sigB64: `link${name}-sig.b64`,
    sigBin: `link${name}-sig.bin`,
  }
}

/** The addendum kinds a link can have (link 0 is 'arrival'). Anything else is garbled data. */
const ADDENDUM_KINDS: ReadonlySet<string> = new Set(['arrival_context', 'condition', 'compliance', 'departure', 'handover'])

function payloadSeq(bundle: SignatureBundle): number | null {
  try {
    const p = JSON.parse(bundle.canonical_payload) as { seq?: unknown }
    return typeof p?.seq === 'number' && Number.isInteger(p.seq) ? p.seq : null
  } catch {
    return null
  }
}

/**
 * The record's signed links (pure): link 0 when the record's own arrival
 * bundle is complete, then every signed addendum with a complete bundle, by
 * seq (the signed one), then signing time. A second stored copy of the same
 * signed link is listed once. Two signed links at one seq are a fork: both
 * are listed, as "2a" and "2b".
 */
export function signedLinks(session: ParkingSession): SignedLink[] {
  if (session.shared_from) return []
  type Entry = { seq: number; kind: ChainLinkKind; bundle: SignatureBundle; at: string; id: string }
  const entries: Entry[] = []
  if (isCompleteBundle(session.signature)) {
    entries.push({ seq: 0, kind: 'arrival', bundle: session.signature, at: '', id: '' })
  }
  const seen = new Set<string>()
  for (const a of Array.isArray(session.addenda) ? session.addenda : []) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !isCompleteBundle(a.bundle)) continue
    // A kind no screen knows (garbled data) has no heading to print.
    if (!ADDENDUM_KINDS.has(a.kind as string)) continue
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
  const links: SignedLink[] = entries.map((e) => {
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

/**
 * Base64 of the UTF-8 bytes of a string. A reader decodes it with
 * `base64 -d` (or `certutil -decode` on Windows), which ignores line
 * wrapping, so they get the EXACT signed bytes. These bytes match what the
 * Lambda hashed: Node's `createHash('sha256').update(canonical_payload)`
 * encodes the string as UTF-8, and TextEncoder produces the same bytes.
 */
export function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(bin)
}
