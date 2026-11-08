// The permit tie-break (fix list, 9 Nov 2026), checked end to end against
// the app.
//
// The sign reader's model reports one permit exception per level (the
// schema's grammar budget allows no list). When a sign prints exceptions for
// more than one of the driver's saved permits, that one has to be the permit
// the app would use (permitAnswerFor). If it isn't, the result screen asks
// about one permit while the sign's words sit on another, and an accessible
// permit can lose its answer to a resident permit saved before it.
//
// Each case runs the real path: the saved permits as Settings sends them
// (signReaderPermits), the server's check and ordering (validateUserPermits,
// permitsInPriorityOrder), the model's pick by the prompt's tie-break, the
// server's normaliser, then the app's permitAnswerFor. That is compared with
// what the app picks when it can see every exception the sign prints. The
// tie-break is written out as code in modelPick; lambda/sign-reading.test.js
// checks the prompt says exactly this.
//
// The model's area comparison is written here as the app's areaKey ("Zone 25",
// "Area 25" and "25" are one area). That holds only because the prompt now
// states that rule, with examples lambda/sign-reading.test.js checks against
// areaKey (fix round 1). A model that still compared labels word for word
// could disagree with the app on a pair like "Zone 25" and "25"; how closely
// the real model follows the rule is for the accuracy benchmark and the
// field test, not this file.
import { describe, expect, it } from 'vitest'
import { normalizeModelOutput, permitsInPriorityOrder, validateUserPermits } from '../../lambda/sign-reading.js'
import { areaKey, permitAnswerFor, type PermitAnswer } from './permit-answer'
import { signReaderPermits } from './profile'
import type { ParkingRules, SavedPermit, UserPermitType } from '../types'

interface Sign {
  /** The permit types the sign prints an exception or allowance for. */
  excepts: UserPermitType[]
  /** The permit area the sign names, or null. */
  area: string | null
  /** The bay is for accessible permit holders (the accessible-permit gate shows). */
  accessibleBay: boolean
  /** A permit zone is in force (the permit-zone gate shows). */
  permitZone: boolean
}

type Listed = { type: UserPermitType; area: string | null }

/**
 * Whether the sign's exception counts for one listed permit, as PERMIT
 * EXCEPTIONS defines it: its type is excepted, and when both the sign and
 * the permit name an area, they're the same area.
 */
function signExcepts(sign: Sign, p: Listed): boolean {
  if (!sign.excepts.includes(p.type)) return false
  if (p.type === 'accessible') return true
  const mine = areaKey(p.area)
  const signs = areaKey(sign.area)
  return mine === null || signs === null || mine === signs
}

/**
 * The prompt's tie-break: "accessible" when it is one of the covered types;
 * otherwise a permit whose area label matches the sign's area; otherwise
 * the first covered one in the order the user message lists them.
 */
function modelPick(listed: Listed[], sign: Sign): UserPermitType | 'none' {
  const covered = listed.filter((p) => signExcepts(sign, p))
  if (covered.length === 0) return 'none'
  if (covered.some((p) => p.type === 'accessible')) return 'accessible'
  const signArea = areaKey(sign.area)
  const matched = covered.find((p) => signArea !== null && areaKey(p.area) === signArea)
  return (matched ?? covered[0]).type
}

/** What the user message lists: the server's checked permits, in its order. */
function listedFor(saved: SavedPermit[]): Listed[] {
  return permitsInPriorityOrder(validateUserPermits(signReaderPermits({ driver_name: null, permits: saved })))
}

type Rule = (saved: SavedPermit[], sign: Sign) => UserPermitType | 'none'

/** The model under the prompt's tie-break, given the list the server sends now. */
const priorityRule: Rule = (saved, sign) => modelPick(listedFor(saved), sign)

/**
 * The rule the fix replaced: the server listed permits in saved order, and
 * the model gave the first covered one in that order.
 */
const savedOrderRule: Rule = (saved, sign) =>
  validateUserPermits(signReaderPermits({ driver_name: null, permits: saved })).find((p) => signExcepts(sign, p))?.type ?? 'none'

/** The answer the app gets when the model reports `pick` for this sign. */
function answerFor(sign: Sign, listed: Listed[], pick: UserPermitType | 'none'): ParkingRules {
  const raw = {
    sign_status: 'readable',
    sign_issues: [],
    rules: 'Test sign',
    observations: [],
    can_park_now: true,
    until: '2026-11-09T14:00:00+11:00',
    duration_minutes: 120,
    confidence: 'high',
    requires_ticket: false,
    payment_methods: null,
    requires_disabled_permit: sign.accessibleBay,
    is_permit_zone: sign.permitZone,
    permit_area: sign.area,
    is_area_sign: false,
    permit_exception_type: pick,
    permit_exception_text: pick === 'none' ? '' : `${pick.toUpperCase()} PERMITS EXCEPTED`,
    recurring_restrictions: [],
    next_transition: null,
    clarification: null,
  }
  return normalizeModelOutput(raw, { user_permits: listed }) as unknown as ParkingRules
}

/** The same answer with every exception the sign prints showing, as the app would see it with no one-per-level limit. */
function everyException(answer: ParkingRules, sign: Sign, listed: Listed[]): ParkingRules {
  return {
    ...answer,
    permit_exception: (answer.permit_exception ?? []).map((e) => {
      const applies = listed.some((p) => p.type === e.permit_type && signExcepts(sign, p))
      return { applies, permit_type: e.permit_type, text: applies ? `${String(e.permit_type).toUpperCase()} PERMITS EXCEPTED` : '' }
    }),
  }
}

const permit = (id: string, type: UserPermitType, area: string | null): SavedPermit => ({
  id,
  type,
  state: 'VIC',
  area,
  expires_on: null,
})
const UNIVERSE: SavedPermit[] = [
  permit('acc', 'accessible', null),
  permit('res25', 'resident', 'Area 25'),
  permit('res12', 'resident', 'Area 12'),
  permit('res', 'resident', null),
  permit('biz25', 'business', 'Zone 25'),
  permit('biz', 'business', null),
]

/** Every ordered choice of 2 and of 3 different saved permits. */
function savedLists(): SavedPermit[][] {
  const out: SavedPermit[][] = []
  for (const a of UNIVERSE) {
    for (const b of UNIVERSE) {
      if (b === a) continue
      out.push([a, b])
      for (const c of UNIVERSE) if (c !== a && c !== b) out.push([a, b, c])
    }
  }
  return out
}

function signs(): Sign[] {
  const out: Sign[] = []
  const excepted: UserPermitType[][] = [
    ['accessible', 'resident'],
    ['accessible', 'business'],
    ['resident', 'business'],
    ['accessible', 'resident', 'business'],
  ]
  for (const excepts of excepted) {
    for (const area of ['25', null]) {
      for (const accessibleBay of [false, true]) {
        for (const permitZone of [false, true]) out.push({ excepts, area, accessibleBay, permitZone })
      }
    }
  }
  return out
}

/** The permit the app uses and whether it has the sign's words for it, in a form two answers can be compared by. */
const used = (a: PermitAnswer | null) => (a ? { id: a.permit.id, exception: a.exception?.permit_type ?? null } : null)

/** Cases where the model's single reported exception makes the app choose differently from the full picture. */
function disagreements(rule: Rule) {
  const out: Array<{ saved: string[]; sign: Sign; got: ReturnType<typeof used>; want: ReturnType<typeof used> }> = []
  for (const saved of savedLists()) {
    const listed = listedFor(saved)
    for (const sign of signs()) {
      const answer = answerFor(sign, listed, rule(saved, sign))
      const got = used(permitAnswerFor(answer, saved))
      const want = used(permitAnswerFor(everyException(answer, sign, listed), saved))
      if (JSON.stringify(got) !== JSON.stringify(want)) out.push({ saved: saved.map((p) => p.id), sign, got, want })
    }
  }
  return out
}

describe('the permit tie-break matches the app', () => {
  it('lists an accessible permit first to the model, whatever order it was saved in', () => {
    const saved = [permit('res25', 'resident', 'Area 25'), permit('biz', 'business', null), permit('acc', 'accessible', null)]
    expect(listedFor(saved)).toEqual([
      { type: 'accessible', area: null },
      { type: 'resident', area: 'Area 25' },
      { type: 'business', area: null },
    ])
  })

  it('a sign excepting a resident and an accessible permit: the app uses the accessible permit, with the sign\'s words', () => {
    const saved = [permit('res25', 'resident', 'Area 25'), permit('acc', 'accessible', null)]
    const sign: Sign = { excepts: ['accessible', 'resident'], area: '25', accessibleBay: false, permitZone: false }
    const listed = listedFor(saved)
    expect(modelPick(listed, sign)).toBe('accessible')
    const answer = answerFor(sign, listed, modelPick(listed, sign))
    expect(used(permitAnswerFor(answer, saved))).toEqual({ id: 'acc', exception: 'accessible' })
  })

  it('a permit zone excepting resident and business permits: the one whose area matches the sign wins, as in the app', () => {
    const saved = [permit('res', 'resident', null), permit('biz25', 'business', 'Zone 25')]
    const sign: Sign = { excepts: ['resident', 'business'], area: '25', accessibleBay: false, permitZone: true }
    const listed = listedFor(saved)
    expect(modelPick(listed, sign)).toBe('business')
    expect(used(permitAnswerFor(answerFor(sign, listed, 'business'), saved))).toEqual({ id: 'biz25', exception: 'business' })
  })

  it('agrees with the app for every mix of up to three saved permits and every kind of sign', () => {
    expect(savedLists().length * signs().length).toBeGreaterThan(4000)
    expect(disagreements(priorityRule)).toEqual([])
  })

  it('the saved-order rule it replaced did not', () => {
    const wrong = disagreements(savedOrderRule)
    expect(wrong.length).toBeGreaterThan(0)
    // For example: resident saved first, the sign excepts both, and the
    // accessible permit lost its answer.
    expect(wrong).toContainEqual({
      saved: ['res25', 'acc'],
      sign: { excepts: ['accessible', 'resident'], area: '25', accessibleBay: false, permitZone: false },
      got: { id: 'res25', exception: 'resident' },
      want: { id: 'acc', exception: 'accessible' },
    })
  })
})
