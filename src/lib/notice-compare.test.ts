// The notice screen's comparison lines (build spec T8 item 4). The en copy
// must be the spec's wording exactly; each line must appear only in the
// case it describes ("before the notice" rests on ParkProof's signing
// time, never the phone's clock); the driver and handover lines only when
// the record has that data (it won't until T7, so fixtures stand in); and
// every line must render in every locale with all its variables filled.
//
// Times: Melbourne on Sunday 25 October 2026 is AEDT (UTC+11).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import i18n from './i18n'
import en from '../locales/en.json'
import type { ParkingSession, SignatureBundle, SignedAddendum } from '../types'
import { matchNotice } from './notice-match'
import type { RecordTimesContext } from './record-times'
import {
  COMPARE_KEYS,
  formatNoticeDuration,
  noticeComparison,
  recordDriver,
  recordHandovers,
  renderComparisonLine,
  type ComparisonLine,
} from './notice-compare'

const MEL = 'Australia/Melbourne'
const NOTICE_AT = '2026-10-25T03:10:00.000Z' // 2:10 pm AEDT
const ARRIVED = '2026-10-25T01:31:20.000Z' // 12:31 pm AEDT
const TAPPED = '2026-10-25T02:55:40.000Z' // 1:55 pm AEDT
const SIGNED_BEFORE = '2026-10-25T02:56:02.000Z' // 1:56 pm AEDT
const SIGNED_AFTER = '2026-10-25T04:12:09.000Z' // 3:12 pm AEDT
const MATCH = { notice_at: NOTICE_AT, zone: MEL }

function bundle(payload: Record<string, unknown>, overrides: Partial<SignatureBundle> = {}): SignatureBundle {
  return {
    schema: String(payload.schema),
    signed_at: String(payload.signed_at),
    algorithm: 'ECDSA_SHA_256',
    key_alias: 'alias/parkproof-evidence-signing',
    canonical_payload: JSON.stringify(payload),
    signature_base64: `sig-${String(payload.signed_at)}-${String(payload.seq ?? 0)}`,
    ...overrides,
  }
}

const LINK0 = bundle({
  schema: 'parkproof-evidence-v2',
  session_id: 'rec-1',
  arrived_at: ARRIVED,
  expires_at: '2026-10-25T03:31:20.000Z',
  signed_at: '2026-10-25T01:31:25.000Z',
})

function departure(extra: Partial<SignedAddendum> = {}, signedAt: string | null = SIGNED_BEFORE, tapped = TAPPED): SignedAddendum {
  const data = { ended_at: tapped, location: null, distance_from_arrival_m: null, return_photos: [] }
  return {
    id: 'dep-1',
    seq: 2,
    kind: 'departure',
    captured_at: tapped,
    data,
    ...(signedAt
      ? { bundle: bundle({ schema: 'parkproof-addendum-v1', kind: 'departure', seq: 2, signed_at: signedAt, data }) }
      : {}),
    ...extra,
  }
}

function record(overrides: Partial<ParkingSession> = {}): ParkingSession {
  return {
    id: 'rec-1',
    arrived_at: ARRIVED,
    location: { lat: -37.8136, lng: 144.9631, address: '12 King St', source: 'gps', accuracy_meters: 8 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: '2026-10-25T03:31:20.000Z',
    confidence: 'high',
    signature: LINK0,
    chain_key: 'ab'.repeat(32),
    ended_at: TAPPED,
    addenda: [departure()],
    ...overrides,
  }
}

const tEn = () => i18n.getFixedT('en')
const render = (lines: ComparisonLine[]) => lines.map((l) => renderComparisonLine(l, tEn()))
const keys = (lines: ComparisonLine[]) => lines.map((l) => l.key)
const ALWAYS = [
  "Check the registration on the notice is the car in this record. ParkProof doesn't record registrations.",
  'Check the due date on the notice itself.',
]

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
afterAll(async () => {
  await i18n.changeLanguage('en')
})

describe('the en copy is the spec wording', () => {
  // The spec's sample sentences, rebuilt from the en strings with the spec's own values.
  const t = (key: string, vars: Record<string, string> = {}) => tEn()(key, vars)
  it('departure, arrival, driver, handover and the two checks', () => {
    expect(t(COMPARE_KEYS.departureSignedBefore, { time: '1:55 pm', duration: '15 minutes', signedTime: '1:56 pm' })).toBe(
      "You tapped I've left at 1:55 pm, 15 minutes before the time on the notice. ParkProof signed that record at 1:56 pm. The record shows when you tapped, not when the car moved.",
    )
    expect(t(COMPARE_KEYS.departureSignedAfter, { time: '1:55 pm', signedTime: '3:12 pm', noticeTime: '2:10 pm' })).toBe(
      "You tapped I've left at 1:55 pm by your phone's clock. ParkProof only signed it at 3:12 pm, after the time on the notice, so the signature can't show you'd left by 2:10 pm.",
    )
    expect(t(COMPARE_KEYS.departurePending, { time: '1:55 pm' })).toBe("You tapped I've left at 1:55 pm. This hasn't been signed yet.")
    expect(t(COMPARE_KEYS.arrivalBefore, { time: '12:31 pm', duration: '1 hour 39 minutes' })).toBe(
      'You logged this park at 12:31 pm, 1 hour 39 minutes before the time on the notice.',
    )
    expect(t(COMPARE_KEYS.driver, { driver: 'Sam' })).toBe(
      "Your record says Sam was driving. That's what was entered when the park was logged. ParkProof didn't check it. If someone else was driving, the notice explains how to nominate them. Only nominate the person who was actually driving.",
    )
    expect(t(COMPARE_KEYS.handover, { to_driver: 'Alex', time: '1:30 pm' })).toBe(
      'Your record says the car was handed to Alex at 1:30 pm.',
    )
    expect([t(COMPARE_KEYS.checkRegistration), t(COMPARE_KEYS.checkDueDate)]).toEqual(ALWAYS)
  })

  it('uses the spec variable names for the driver and handover lines', () => {
    expect(en.notice.compare.driver).toContain('{{driver}}')
    expect(en.notice.compare.handover).toContain('{{to_driver}}')
    expect(en.notice.compare.handover).toContain('{{time}}')
  })
})

describe('noticeComparison: the departure', () => {
  it('signed before the notice time: the tap time, the minutes before, and ParkProof\'s signing time', () => {
    const lines = noticeComparison(record(), MATCH)
    expect(render(lines)).toEqual([
      "You tapped I've left at Sun 25 Oct, 1:55 pm AEDT, 15 minutes before the time on the notice. ParkProof signed that record at Sun 25 Oct, 1:56 pm AEDT. The record shows when you tapped, not when the car moved.",
      'You logged this park at Sun 25 Oct, 12:31 pm AEDT, 1 hour 39 minutes before the time on the notice.',
      ...ALWAYS,
    ])
  })

  it('signed after the notice time: says the signature can\'t show the driver had left by then', () => {
    const lines = noticeComparison(record({ addenda: [departure({}, SIGNED_AFTER)] }), MATCH)
    expect(render(lines)[0]).toBe(
      "You tapped I've left at Sun 25 Oct, 1:55 pm AEDT by your phone's clock. ParkProof only signed it at Sun 25 Oct, 3:12 pm AEDT, after the time on the notice, so the signature can't show you'd left by Sun 25 Oct, 2:10 pm AEDT.",
    )
  })

  it('a signature inside the notice\'s minute counts as after: the notice time can be any second of it', () => {
    const lines = noticeComparison(record({ addenda: [departure({}, '2026-10-25T03:10:30.000Z')] }), MATCH)
    expect(lines[0].key).toBe(COMPARE_KEYS.departureSignedAfter)
    const atStart = noticeComparison(record({ addenda: [departure({}, '2026-10-25T03:09:59.999Z')] }), MATCH)
    expect(atStart[0].key).toBe(COMPARE_KEYS.departureSignedBefore)
  })

  it('a tap that is early by the phone clock but signed late never reads as "before the notice"', () => {
    // Tapped 1:55 pm by the phone, but ParkProof only signed it at 3:12 pm.
    const lines = noticeComparison(record({ addenda: [departure({}, SIGNED_AFTER)] }), MATCH)
    expect(keys(lines)).not.toContain(COMPARE_KEYS.departureSignedBefore)
    expect(render(lines)[0]).not.toMatch(/minutes? before/)
  })

  it('signed before the notice but the phone clock put the tap after it: no minutes from the phone clock', () => {
    // A phone clock running fast: the tap says 2:12 pm, ParkProof signed at 2:09 pm.
    const lines = noticeComparison(
      record({ ended_at: '2026-10-25T03:12:00.000Z', addenda: [departure({}, '2026-10-25T03:09:00.000Z', '2026-10-25T03:12:00.000Z')] }),
      MATCH,
    )
    expect(render(lines)[0]).toBe(
      "You tapped I've left at Sun 25 Oct, 2:12 pm AEDT by your phone's clock. ParkProof signed that record at Sun 25 Oct, 2:09 pm AEDT, before the time on the notice. The record shows when you tapped, not when the car moved.",
    )
  })

  it('not signed yet: the tap time only, and says so', () => {
    const lines = noticeComparison(record({ addenda: [departure({}, null)] }), MATCH)
    expect(render(lines)[0]).toBe("You tapped I've left at Sun 25 Oct, 1:55 pm AEDT. This hasn't been signed yet.")
  })

  it('refused by the server, or never to be signed: "This wasn\'t signed", not "yet"', () => {
    const refused = noticeComparison(
      record({ addenda: [departure({ rejected: { code: 'ERR_BAD_STRING', at: TAPPED } }, null)] }),
      MATCH,
    )
    expect(render(refused)[0]).toBe("You tapped I've left at Sun 25 Oct, 1:55 pm AEDT. This wasn't signed.")
    // A v2 chain whose key isn't on this device: no departure will ever be added here.
    const never = noticeComparison(record({ chain_key: undefined, addenda: [] }), MATCH)
    expect(never[0].key).toBe(COMPARE_KEYS.departureNotSigned)
  })

  it('a development-key signature is never worded as ParkProof\'s, and makes no "before the notice" claim', () => {
    // Signed (with the dev key) at 1:56 pm, before the 2:10 pm notice.
    const dev = departure({}, SIGNED_BEFORE)
    dev.bundle = { ...(dev.bundle as SignatureBundle), key_alias: 'dev-ephemeral' }
    const lines = noticeComparison(record({ addenda: [dev] }), MATCH)
    expect(lines[0].key).toBe(COMPARE_KEYS.departureDevKey)
    expect(keys(lines)).not.toContain(COMPARE_KEYS.departureSignedBefore)
    expect(render(lines)[0]).toBe(
      "You tapped I've left at Sun 25 Oct, 1:55 pm AEDT by your phone's clock. It was signed with a development key, not ParkProof's published key, so the signature can't show you'd left by Sun 25 Oct, 2:10 pm AEDT.",
    )
    expect(render(lines)[0]).not.toMatch(/ParkProof signed|minutes before/)
  })

  it('a record without I\'ve left says so instead of inventing a departure', () => {
    const lines = noticeComparison(record({ ended_at: undefined, addenda: [] }), MATCH)
    expect(render(lines)[0]).toBe("You haven't tapped I've left on this record.")
  })

  it('reads the tap time from the signed payload, not the stored record', () => {
    // The stored ended_at was changed after signing; the signed 1:55 pm wins.
    const lines = noticeComparison(record({ ended_at: '2026-10-25T03:05:00.000Z' }), MATCH)
    expect(render(lines)[0]).toContain('1:55 pm AEDT, 15 minutes before')
  })
})

describe('noticeComparison: the arrival', () => {
  it('after the notice time, and in the same minute', () => {
    const after = noticeComparison(record({ signature: undefined, arrived_at: '2026-10-25T03:12:00.000Z', addenda: [] , ended_at: undefined }), MATCH)
    expect(render(after)[1]).toBe('You logged this park at Sun 25 Oct, 2:12 pm AEDT, 2 minutes after the time on the notice.')
    const same = noticeComparison(record({ signature: undefined, arrived_at: '2026-10-25T03:10:45.000Z', addenda: [], ended_at: undefined }), MATCH)
    expect(render(same)[1]).toBe('You logged this park at Sun 25 Oct, 2:10 pm AEDT, the same minute as the time on the notice.')
  })

  it('uses the signed arrival time once link 0 is signed', () => {
    const lines = noticeComparison(record({ arrived_at: '2026-10-25T02:00:00.000Z' }), MATCH)
    expect(render(lines)[1]).toContain('12:31 pm AEDT, 1 hour 39 minutes before')
  })

  it('formats every time in the zone the notice was read in', () => {
    const lines = noticeComparison(record(), { notice_at: NOTICE_AT, zone: 'Australia/Brisbane' })
    // Brisbane has no daylight saving: 1:55 pm AEDT is 12:55 pm AEST.
    expect(render(lines)[0]).toContain('12:55 pm AEST')
  })
})

describe('noticeComparison: how the arrival\'s record stands (N5)', () => {
  // Link 0 signed at `signedAt` for a record logged (phone clock) at `arrived`.
  const linkZero = (signedAt: string, arrived = ARRIVED, overrides: Partial<SignatureBundle> = {}) =>
    bundle(
      { schema: 'parkproof-evidence-v2', session_id: 'rec-1', arrived_at: arrived, expires_at: null, signed_at: signedAt },
      overrides,
    )
  const arrivalLines = (lines: ComparisonLine[]) => lines.filter((l) => l.id.startsWith('arrival'))

  it('signed promptly, before the notice: the spec\'s arrival line alone', () => {
    expect(keys(arrivalLines(noticeComparison(record(), MATCH)))).toEqual([COMPARE_KEYS.arrivalBefore])
  })

  it('logged before the notice by the phone, but only signed after it: says the signature can\'t show the record existed by then', () => {
    // Logged offline at 12:31 pm (phone clock); ParkProof signed it at 3:12 pm.
    const lines = noticeComparison(record({ signature: linkZero(SIGNED_AFTER), ended_at: undefined, addenda: [] }), MATCH)
    expect(render(arrivalLines(lines))).toEqual([
      'You logged this park at Sun 25 Oct, 12:31 pm AEDT, 1 hour 39 minutes before the time on the notice.',
      "ParkProof only signed this record at Sun 25 Oct, 3:12 pm AEDT, after the time on the notice, so the signature can't show it existed by Sun 25 Oct, 2:10 pm AEDT.",
    ])
  })

  it('a phone clock running fast: logged "after" the notice, but ParkProof signed it before, so both are shown', () => {
    // Phone says 2:14 pm; ParkProof signed at 2:04 pm; notice 2:10 pm.
    const arrived = '2026-10-25T03:14:00.000Z'
    const lines = noticeComparison(
      record({ arrived_at: arrived, signature: linkZero('2026-10-25T03:04:00.000Z', arrived), ended_at: undefined, addenda: [] }),
      MATCH,
    )
    expect(render(arrivalLines(lines))).toEqual([
      'You logged this park at Sun 25 Oct, 2:14 pm AEDT, 4 minutes after the time on the notice.',
      'ParkProof signed this record at Sun 25 Oct, 2:04 pm AEDT, before the time on the notice. The signature shows the record existed by then, not when the car arrived or where it was.',
    ])
  })

  it('signed before the notice but more than 5 minutes after the log time: both are shown', () => {
    const late = noticeComparison(record({ signature: linkZero('2026-10-25T01:40:00.000Z'), ended_at: undefined, addenda: [] }), MATCH)
    expect(keys(arrivalLines(late))).toEqual([COMPARE_KEYS.arrivalBefore, COMPARE_KEYS.arrivalSignedBefore])
    // Exactly 5 minutes after: the phone's time and ParkProof's are close enough.
    const close = noticeComparison(record({ signature: linkZero('2026-10-25T01:36:20.000Z'), ended_at: undefined, addenda: [] }), MATCH)
    expect(keys(arrivalLines(close))).toEqual([COMPARE_KEYS.arrivalBefore])
  })

  it('not signed yet, refused, or signed with a development key: says so after the arrival line', () => {
    const pending = noticeComparison(record({ signature: undefined, ended_at: undefined, addenda: [] }), MATCH)
    expect(render(arrivalLines(pending))[1]).toBe("ParkProof hasn't signed this record yet.")
    const refused = noticeComparison(record({ signature: undefined, ended_at: undefined, addenda: [] }), MATCH, {
      arrivalRejection: 'ERR_BAD_STRING',
    })
    expect(render(arrivalLines(refused))[1]).toBe("This record wasn't signed.")
    const dev = noticeComparison(
      record({ signature: linkZero('2026-10-25T01:31:25.000Z', ARRIVED, { key_alias: 'dev-ephemeral' }), ended_at: undefined, addenda: [] }),
      MATCH,
    )
    expect(render(arrivalLines(dev))[1]).toBe(
      "This record was signed with a development key, not ParkProof's published key, so the signature can't show it existed by Sun 25 Oct, 2:10 pm AEDT.",
    )
  })
})

describe('noticeComparison: a notice time with two readings (the repeated daylight saving hour)', () => {
  // Melbourne, 4 April 2027: 02:30 happened at 15:30Z (AEDT) and again at 16:30Z (AEST).
  const EARLY = '2027-04-03T15:30:00.000Z'
  const LATE = '2027-04-03T16:30:00.000Z'
  const repeated = (overrides: Partial<ParkingSession>, signedAt: string, tapped: string) => {
    const arrived = '2027-04-03T15:39:00.000Z' // 02:39 AEDT
    return record({
      id: 'rec-1',
      arrived_at: arrived,
      expires_at: null,
      signature: bundle({ schema: 'parkproof-evidence-v2', session_id: 'rec-1', arrived_at: arrived, expires_at: null, signed_at: '2027-04-03T15:39:05.000Z' }),
      ended_at: tapped,
      addenda: [departure({}, signedAt, tapped)],
      ...overrides,
    })
  }

  it('says "signed before the notice" only when it holds for both readings', () => {
    // Tapped 02:24 AEST (16:24Z), signed 16:25Z: before the second 02:30, after the first.
    const session = repeated({}, '2027-04-03T16:25:00.000Z', '2027-04-03T16:24:00.000Z')
    const lines = noticeComparison(session, { notice_at: LATE, zone: MEL, candidates: [EARLY, LATE] })
    expect(lines[0].key).toBe(COMPARE_KEYS.departureSignedAfter)
    // It names the reading the signature is after (02:30 AEDT).
    expect(render(lines)[0]).toBe(
      "You tapped I've left at Sun 4 Apr, 2:24 am AEST by your phone's clock. ParkProof only signed it at Sun 4 Apr, 2:25 am AEST, after the time on the notice, so the signature can't show you'd left by Sun 4 Apr, 2:30 am AEDT.",
    )
    // With only the one reading, the same record reads as signed before.
    const single = noticeComparison(session, { notice_at: LATE, zone: MEL, candidates: [LATE] })
    expect(single[0].key).toBe(COMPARE_KEYS.departureSignedBefore)
  })

  it('a signature before both readings still reads as before, measured against the compared reading', () => {
    // Tapped 02:20 AEDT (15:20Z), signed 15:21Z: before both.
    const session = repeated({ arrived_at: '2027-04-03T15:00:00.000Z', signature: undefined }, '2027-04-03T15:21:00.000Z', '2027-04-03T15:20:00.000Z')
    const lines = noticeComparison(session, { notice_at: EARLY, zone: MEL, candidates: [EARLY, LATE] })
    expect(lines[0].key).toBe(COMPARE_KEYS.departureSignedBefore)
    expect(render(lines)[0]).toContain('10 minutes before the time on the notice')
  })
})

describe('noticeComparison: driver and handovers (data-driven)', () => {
  const ctx = (data: Record<string, unknown>, signed: boolean): SignedAddendum => ({
    id: 'ctx-1',
    seq: 1,
    kind: 'arrival_context',
    captured_at: ARRIVED,
    data,
    ...(signed
      ? { bundle: bundle({ schema: 'parkproof-addendum-v1', kind: 'arrival_context', seq: 1, signed_at: '2026-10-25T01:31:30.000Z', data }) }
      : {}),
  })
  const handover = (id: string, to: string, at: string, extra: Partial<SignedAddendum> = {}, signed = true): SignedAddendum => {
    const data = { from_driver: null, to_driver: to, handed_over_at: at, location: null }
    return {
      id,
      seq: 3,
      kind: 'handover',
      captured_at: at,
      data,
      ...(signed ? { bundle: bundle({ schema: 'parkproof-addendum-v1', kind: 'handover', seq: 3, signed_at: at, data }) } : {}),
      ...extra,
    }
  }

  it('shows neither line when the record has no driver and no handover', () => {
    const lines = noticeComparison(record({ addenda: [departure(), ctx({ driver_name: null }, true)] }), MATCH)
    expect(keys(lines)).not.toContain(COMPARE_KEYS.driver)
    expect(keys(lines)).not.toContain(COMPARE_KEYS.handover)
    expect(lines).toHaveLength(4)
  })

  it('the driver from the signed arrival details, in the spec wording, after the arrival line', () => {
    const lines = noticeComparison(record({ addenda: [departure(), ctx({ driver_name: 'Sam' }, true)] }), MATCH)
    expect(keys(lines)).toEqual([
      COMPARE_KEYS.departureSignedBefore,
      COMPARE_KEYS.arrivalBefore,
      COMPARE_KEYS.driver,
      COMPARE_KEYS.checkRegistration,
      COMPARE_KEYS.checkDueDate,
    ])
    expect(render(lines)[2]).toBe(
      "Your record says Sam was driving. That's what was entered when the park was logged. ParkProof didn't check it. If someone else was driving, the notice explains how to nominate them. Only nominate the person who was actually driving.",
    )
  })

  it('a signed arrival naming nobody wins over a stored name; before signing, the record\'s own name', () => {
    expect(recordDriver(record({ driver_name: 'Sam', addenda: [ctx({ driver_name: null }, true)] }))).toBeNull()
    expect(recordDriver(record({ driver_name: 'Sam', addenda: [ctx({ driver_name: 'Sam' }, false)] }))).toEqual({
      name: 'Sam',
      signing: 'pending',
    })
    expect(recordDriver(record({ driver_name: null, addenda: [ctx({ driver_name: 'Jo' }, false)] }))).toEqual({
      name: 'Jo',
      signing: 'pending',
    })
    expect(recordDriver(record({ driver_name: '   ', addenda: [] }))).toBeNull()
  })

  it('says how the driver\'s name stands: signed (nothing added), waiting, never to be signed, or a development key (N2)', () => {
    const driverLines = (session: ParkingSession) => render(noticeComparison(session, MATCH)).slice(2, -2)
    const DRIVER =
      "Your record says Sam was driving. That's what was entered when the park was logged. ParkProof didn't check it. If someone else was driving, the notice explains how to nominate them. Only nominate the person who was actually driving."
    expect(driverLines(record({ addenda: [departure(), ctx({ driver_name: 'Sam' }, true)] }))).toEqual([DRIVER])
    expect(driverLines(record({ addenda: [departure(), ctx({ driver_name: 'Sam' }, false)] }))).toEqual([
      DRIVER,
      "The driver's name hasn't been signed yet.",
    ])
    // Stored on the record, but the arrival details waiting to be signed name nobody (or were refused).
    expect(driverLines(record({ driver_name: 'Sam', addenda: [departure(), ctx({ driver_name: null }, false)] }))).toEqual([
      DRIVER,
      "The driver's name wasn't signed.",
    ])
    const refusedCtx = { ...ctx({ driver_name: 'Sam' }, false), rejected: { code: 'ERR_BAD_STRING', at: ARRIVED } }
    expect(driverLines(record({ driver_name: 'Sam', addenda: [departure(), refusedCtx] }))).toEqual([
      DRIVER,
      "The driver's name wasn't signed.",
    ])
    const devCtx = ctx({ driver_name: 'Sam' }, true)
    devCtx.bundle = { ...(devCtx.bundle as SignatureBundle), key_alias: 'dev-ephemeral' }
    expect(driverLines(record({ addenda: [departure(), devCtx] }))).toEqual([
      DRIVER,
      "Signed with a development key. It can't be checked with ParkProof's published key.",
    ])
  })

  it('one line per handover, oldest first, at the handover\'s own time, with an unsigned one labelled', () => {
    const session = record({
      addenda: [
        departure(),
        handover('h-2', 'Kim', '2026-10-25T02:40:00.000Z'),
        handover('h-1', 'Alex', '2026-10-25T02:30:00.000Z', {}, false),
      ],
    })
    const lines = noticeComparison(session, MATCH)
    expect(render(lines).slice(2, -2)).toEqual([
      'Your record says the car was handed to Alex at Sun 25 Oct, 1:30 pm AEDT.',
      "This handover hasn't been signed yet.",
      'Your record says the car was handed to Kim at Sun 25 Oct, 1:40 pm AEDT.',
    ])
  })

  it('leaves out refused handovers and a second copy of one handover', () => {
    const signed = handover('h-1', 'Alex', '2026-10-25T02:30:00.000Z')
    const pendingCopy = handover('h-1', 'Alex', '2026-10-25T02:30:00.000Z', {}, false)
    const refused = handover('h-9', 'Pat', '2026-10-25T02:35:00.000Z', { rejected: { code: 'ERR_BAD_STRING', at: TAPPED } }, false)
    expect(recordHandovers(record({ addenda: [pendingCopy, signed, refused] }))).toEqual([
      { addendum_id: 'h-1', to_driver: 'Alex', handed_over_at: '2026-10-25T02:30:00.000Z', signing: 'signed' },
    ])
  })

  it('a shared copy (someone else\'s record) has no driver or handover lines', () => {
    const session = record({
      driver_name: 'Sam',
      addenda: [handover('h-1', 'Alex', '2026-10-25T02:30:00.000Z')],
      shared_from: { original_session_id: 'x', received_at: TAPPED, shared_at: null, arrival_bundle: LINK0, snapshot: {} },
    })
    expect(recordDriver(session)).toBeNull()
    expect(recordHandovers(session)).toEqual([])
  })
})

describe('noticeComparison with matchNotice', () => {
  it('compares against the instant the matcher read the notice time as', () => {
    const [match] = matchNotice({ local: { year: 2026, month: 10, day: 25, hour: 14, minute: 10 }, records: [record()] })
    expect(match.notice_at).toBe(NOTICE_AT)
    expect(render(noticeComparison(record(), match))[0]).toContain('15 minutes before the time on the notice')
  })
})

describe('formatNoticeDuration', () => {
  it('minutes, hours, and both, with plurals', () => {
    const t = tEn()
    expect(formatNoticeDuration(1, t)).toBe('1 minute')
    expect(formatNoticeDuration(15, t)).toBe('15 minutes')
    expect(formatNoticeDuration(60, t)).toBe('1 hour')
    expect(formatNoticeDuration(120, t)).toBe('2 hours')
    expect(formatNoticeDuration(99, t)).toBe('1 hour 39 minutes')
    expect(formatNoticeDuration(121, t)).toBe('2 hours 1 minute')
  })
})

describe('a line that puts ParkProof\'s signing time before the notice says what the signature doesn\'t show', () => {
  // Copy rules: a signature shows the details existed by the signed time,
  // not where the car was or when it arrived or left; say so wherever
  // signed material is presented. Each locale keeps at least en's sentence
  // count, so a translation can't drop the limit sentence.
  const SIGNED_BEFORE_KEYS = [
    COMPARE_KEYS.departureSignedBefore,
    COMPARE_KEYS.departureSignedBeforeClock,
    COMPARE_KEYS.arrivalSignedBefore,
  ]
  const sentences = (s: string) => s.split(/。|।|\.(?=\s|$)/).filter((p) => p.trim()).length
  const template = (lng: string, key: string) => i18n.getResource(lng, 'translation', key) as string

  it('in en, the last sentence is the limit', () => {
    for (const key of SIGNED_BEFORE_KEYS) {
      expect(template('en', key), key).toMatch(/\. The (record|signature) shows [^.]*, not when the car (moved|arrived or where it was)\.$/)
    }
  })

  it('in every locale, no sentence is missing', () => {
    for (const key of SIGNED_BEFORE_KEYS) {
      const want = sentences(template('en', key))
      for (const lng of ['zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']) {
        expect(sentences(template(lng, key)), `${lng} ${key}`).toBeGreaterThanOrEqual(want)
      }
    }
  })
})

describe('every locale renders every line with its variables filled', () => {
  it('no {{placeholder}} is left in any line, in any of the 9 locales', async () => {
    const dev = departure({}, SIGNED_BEFORE)
    dev.bundle = { ...(dev.bundle as SignatureBundle), key_alias: 'dev-ephemeral' }
    const devCtx: SignedAddendum = {
      id: 'ctx-dev',
      seq: 1,
      kind: 'arrival_context',
      captured_at: ARRIVED,
      data: { driver_name: 'Jo' },
      bundle: bundle(
        { schema: 'parkproof-addendum-v1', kind: 'arrival_context', seq: 1, signed_at: ARRIVED, data: { driver_name: 'Jo' } },
        { key_alias: 'dev-ephemeral' },
      ),
    }
    const pendingCtx: SignedAddendum = { id: 'ctx-p', seq: 1, kind: 'arrival_context', captured_at: ARRIVED, data: { driver_name: 'Sam' } }
    const late = (signedAt: string, overrides: Partial<SignatureBundle> = {}) =>
      bundle({ schema: 'parkproof-evidence-v2', session_id: 'rec-1', arrived_at: ARRIVED, expires_at: null, signed_at: signedAt }, overrides)
    const sessions: Array<[ParkingSession, RecordTimesContext?]> = [
      [record({ driver_name: 'Sam', addenda: [departure(), { id: 'h', seq: 3, kind: 'handover', captured_at: TAPPED, data: { from_driver: null, to_driver: 'Alex', handed_over_at: TAPPED, location: null } }] })],
      [record({ addenda: [departure(), pendingCtx] })],
      [record({ addenda: [departure(), devCtx] })],
      [record({ addenda: [departure({}, SIGNED_AFTER)] })],
      [record({ addenda: [departure({}, null)] })],
      [record({ addenda: [departure({ rejected: { code: 'E', at: TAPPED } }, null)] })],
      [record({ ended_at: '2026-10-25T03:12:00.000Z', addenda: [departure({}, '2026-10-25T03:09:00.000Z', '2026-10-25T03:12:00.000Z')] })],
      [record({ signature: undefined, arrived_at: '2026-10-25T03:12:00.000Z', ended_at: undefined, addenda: [] })],
      [record({ signature: undefined, arrived_at: '2026-10-25T03:10:10.000Z', ended_at: undefined, addenda: [] }), { arrivalRejection: 'E' }],
      [record({ signature: late(SIGNED_AFTER), ended_at: undefined, addenda: [] })],
      [record({ signature: late('2026-10-25T01:45:00.000Z'), ended_at: undefined, addenda: [] })],
      [record({ signature: late(ARRIVED, { key_alias: 'dev-ephemeral' }), ended_at: undefined, addenda: [] })],
      [record({ addenda: [dev] })],
    ]
    const allKeys = new Set<string>()
    for (const lng of ['en', 'zh-CN', 'vi', 'id', 'ko', 'it', 'el', 'hi', 'pa']) {
      const t = i18n.getFixedT(lng)
      for (const [s, context] of sessions) {
        for (const line of noticeComparison(s, MATCH, context)) {
          allKeys.add(line.key)
          const text = renderComparisonLine(line, t)
          expect(text, `${lng} ${line.key}`).not.toMatch(/\{\{|\}\}/)
          expect(text, `${lng} ${line.key}`).not.toBe(line.key)
        }
      }
    }
    // Every comparison key was exercised above.
    expect([...allKeys].sort()).toEqual(Object.values(COMPARE_KEYS).sort())
  })
})
