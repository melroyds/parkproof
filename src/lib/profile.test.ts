// The driver's settings as data (build spec T4 items 2, 3 and 7): how a
// saved profile is shaped, which permits go to the sign reader and in what
// form, and how the saved name reaches a new record and its draft.
import { describe, expect, it } from 'vitest'
import { validateUserPermits } from '../../lambda/sign-reading.js'
import { normalizeAddendumData } from '../../lambda/addendum-schema.js'
import {
  DRIVER_NAME_MAX,
  MAX_SAVED_PERMITS,
  PERMIT_AREA_MAX,
  emptyProfile,
  isDateOnly,
  isPermitExpired,
  logDraftFromProfile,
  normalizeProfile,
  normalizeSavedPermit,
  signReaderExtras,
  signReaderPermits,
  usablePermits,
} from './profile'
import { applyLogDraftDefaults, buildArrivalContext, emptyLogDraft } from './evidence-chain'
import type { DriverProfile, ParkingSession, SavedPermit } from '../types'

const permit = (over: Partial<SavedPermit> = {}): SavedPermit => ({
  id: 'p-1',
  type: 'resident',
  state: 'VIC',
  area: 'Area 25',
  expires_on: null,
  ...over,
})

/** 3 pm on 9 November 2026 on the phone's own calendar. */
const NOW = new Date(2026, 10, 9, 15, 0, 0)

describe('normalizeSavedPermit', () => {
  it('keeps a valid permit as it is', () => {
    expect(normalizeSavedPermit(permit({ expires_on: '2027-03-31' }))).toEqual(permit({ expires_on: '2027-03-31' }))
  })

  it('drops entries that cannot be a permit', () => {
    expect(normalizeSavedPermit(null)).toBeNull()
    expect(normalizeSavedPermit([])).toBeNull()
    expect(normalizeSavedPermit(permit({ id: '' }))).toBeNull()
    expect(normalizeSavedPermit({ ...permit(), id: 7 })).toBeNull()
    expect(normalizeSavedPermit(permit({ id: 'x'.repeat(65) }))).toBeNull()
    expect(normalizeSavedPermit({ ...permit(), type: 'disabled' })).toBeNull()
  })

  it('never keeps an area on an accessible permit', () => {
    expect(normalizeSavedPermit(permit({ type: 'accessible', area: 'Area 25' }))?.area).toBeNull()
  })

  it('shapes the area label the way the sign reader accepts it', () => {
    const shaped = normalizeSavedPermit(permit({ area: '  Area\u000a25‮  ' }))
    expect(shaped?.area).toBe('Area 25')
    expect(normalizeSavedPermit(permit({ area: '   ' }))?.area).toBeNull()
    expect(normalizeSavedPermit(permit({ area: 'Z'.repeat(80) }))?.area).toHaveLength(PERMIT_AREA_MAX)
  })

  it('keeps only known state codes and real dates', () => {
    expect(normalizeSavedPermit({ ...permit(), state: 'Victoria' })?.state).toBeNull()
    expect(normalizeSavedPermit({ ...permit(), state: 'AU-VIC' })?.state).toBeNull()
    expect(normalizeSavedPermit(permit({ expires_on: '2027-02-30' }))?.expires_on).toBeNull()
    expect(normalizeSavedPermit(permit({ expires_on: '31/03/2027' }))?.expires_on).toBeNull()
    expect(normalizeSavedPermit(permit({ expires_on: '2028-02-29' }))?.expires_on).toBe('2028-02-29')
  })
})

describe('isDateOnly', () => {
  it('accepts real calendar dates only', () => {
    expect(isDateOnly('2026-11-09')).toBe(true)
    expect(isDateOnly('2027-02-29')).toBe(false)
    expect(isDateOnly('2026-13-01')).toBe(false)
    expect(isDateOnly('2026-11-00')).toBe(false)
    expect(isDateOnly('2026-11-09T00:00:00Z')).toBe(false)
    expect(isDateOnly(20261109)).toBe(false)
  })
})

describe('normalizeProfile', () => {
  it('reads anything that is not a profile as the empty profile', () => {
    for (const v of [null, undefined, 'x', 3, [], true]) expect(normalizeProfile(v)).toEqual(emptyProfile())
  })

  it('shapes the driver name the way arrival_context signs it', () => {
    expect(normalizeProfile({ driver_name: '  Sam\tLee  ' }).driver_name).toBe('Sam Lee')
    expect(normalizeProfile({ driver_name: '   ' }).driver_name).toBeNull()
    expect(normalizeProfile({ driver_name: 42 }).driver_name).toBeNull()
    expect(normalizeProfile({ driver_name: 'N'.repeat(90) }).driver_name).toHaveLength(DRIVER_NAME_MAX)
  })

  it('keeps at most 3 valid permits with distinct ids, in saved order', () => {
    const p = normalizeProfile({
      driver_name: null,
      permits: [
        permit({ id: 'a' }),
        { id: 'bad', type: 'boat' },
        permit({ id: 'a', area: 'duplicate id' }),
        permit({ id: 'b', type: 'business', area: 'Zone 3' }),
        permit({ id: 'c', type: 'accessible', area: null }),
        permit({ id: 'd' }),
      ],
    })
    expect(p.permits.map((x) => x.id)).toEqual(['a', 'b', 'c'])
    expect(p.permits[0].area).toBe('Area 25')
    expect(p.permits).toHaveLength(MAX_SAVED_PERMITS)
  })
})

describe('isPermitExpired', () => {
  it('counts the expiry date itself as still valid', () => {
    expect(isPermitExpired({ expires_on: '2026-11-09' }, NOW)).toBe(false)
    expect(isPermitExpired({ expires_on: '2026-11-08' }, NOW)).toBe(true)
    expect(isPermitExpired({ expires_on: '2027-01-01' }, NOW)).toBe(false)
  })

  it('never treats a permit without a date as expired', () => {
    expect(isPermitExpired({ expires_on: null }, NOW)).toBe(false)
  })

  // Only meaningful where the test machine's zone isn't UTC.
  const offsetMinutes = -new Date(2026, 10, 10, 12).getTimezoneOffset()
  it.skipIf(offsetMinutes === 0)("uses the phone's calendar day, not UTC", () => {
    if (offsetMinutes > 0) {
      // 12:30 am on 10 November here is still 9 November in UTC. The permit
      // that ran to the 9th has expired here.
      expect(isPermitExpired({ expires_on: '2026-11-09' }, new Date(2026, 10, 10, 0, 30))).toBe(true)
    } else {
      // 11:30 pm on 9 November here is already 10 November in UTC. The
      // permit that runs to the 9th is still good here.
      expect(isPermitExpired({ expires_on: '2026-11-09' }, new Date(2026, 10, 9, 23, 30))).toBe(false)
    }
  })
})

describe('signReaderPermits', () => {
  const profile: DriverProfile = {
    driver_name: 'Sam',
    permits: [
      permit({ id: 'a', type: 'accessible', area: null, state: 'NSW', expires_on: '2028-01-01' }),
      permit({ id: 'b', type: 'resident', area: 'Area 25', state: 'VIC' }),
      permit({ id: 'c', type: 'business', area: null }),
    ],
  }

  it('sends only the type, plus the area of a resident or business permit', () => {
    expect(signReaderPermits(profile, NOW)).toEqual([
      { type: 'accessible' },
      { type: 'resident', area: 'Area 25' },
      { type: 'business' },
    ])
  })

  it('never sends the issuing state, the expiry date or an id', () => {
    const sent = JSON.stringify(signReaderPermits(profile, NOW))
    expect(sent).not.toMatch(/NSW|VIC|2028|"id"|state|expires/)
  })

  it('never sends an area for an accessible permit, even from a damaged stored value', () => {
    const damaged = { driver_name: null, permits: [{ ...permit({ type: 'accessible' }), area: 'Area 9' }] } as DriverProfile
    expect(signReaderPermits(damaged, NOW)).toEqual([{ type: 'accessible' }])
  })

  it('leaves out expired permits', () => {
    const withExpired: DriverProfile = {
      driver_name: null,
      permits: [permit({ id: 'old', expires_on: '2026-11-08' }), permit({ id: 'new', type: 'business', area: 'B1' })],
    }
    expect(usablePermits(withExpired, NOW).map((p) => p.id)).toEqual(['new'])
    expect(signReaderPermits(withExpired, NOW)).toEqual([{ type: 'business', area: 'B1' }])
  })

  it('always passes the server check for user_permits', () => {
    const awkward = normalizeProfile({
      permits: [
        permit({ id: 'a', area: '\u0000⁦' + 'Q'.repeat(100) }),
        permit({ id: 'b', type: 'business', area: '  ' }),
        permit({ id: 'c', type: 'accessible', area: 'x' }),
      ],
    })
    const sent = signReaderPermits(awkward, NOW)
    expect(validateUserPermits(sent)).toHaveLength(3)
    expect(sent[1]).toEqual({ type: 'business' })
  })
})

describe('signReaderExtras', () => {
  it('carries the permits and the parking state', () => {
    const profile: DriverProfile = { driver_name: null, permits: [permit()] }
    expect(signReaderExtras(profile, 'VIC', NOW)).toEqual({
      user_permits: [{ type: 'resident', area: 'Area 25' }],
      parking_state: 'VIC',
    })
  })

  it('leaves out what there is none of', () => {
    expect(signReaderExtras(emptyProfile(), null, NOW)).toEqual({})
    expect(signReaderExtras(emptyProfile(), 'QLD', NOW)).toEqual({ parking_state: 'QLD' })
    const expiredOnly: DriverProfile = { driver_name: null, permits: [permit({ expires_on: '2020-01-01' })] }
    expect(signReaderExtras(expiredOnly, null, NOW)).toEqual({})
  })
})

describe('the saved name reaches new records', () => {
  const record: ParkingSession = {
    id: 'r1',
    arrived_at: '2026-11-09T04:00:00.000Z',
    location: { lat: -37.81, lng: 144.96 },
    sign_photo: null,
    car_photo: null,
    rules: '2P',
    observations: [],
    expires_at: null,
    confidence: 'high',
  }

  it('starts every scan with the saved name as the draft driver', () => {
    expect(logDraftFromProfile({ driver_name: 'Sam Lee', permits: [] })).toEqual({
      ...emptyLogDraft(),
      driver_name: 'Sam Lee',
    })
    expect(logDraftFromProfile(emptyProfile())).toEqual(emptyLogDraft())
  })

  it('gives a record without a driver the draft driver', () => {
    const draft = logDraftFromProfile({ driver_name: 'Sam Lee', permits: [] })
    const saved = applyLogDraftDefaults(record, draft)
    expect(saved.driver_name).toBe('Sam Lee')
    // ...and that is what link 1 signs.
    const context = buildArrivalContext(saved, draft)
    expect(context.driver_name).toBe('Sam Lee')
    expect(() => normalizeAddendumData('arrival_context', context)).not.toThrow()
  })

  it("keeps a record's own driver, including a cleared one", () => {
    const draft = logDraftFromProfile({ driver_name: 'Sam Lee', permits: [] })
    expect(applyLogDraftDefaults({ ...record, driver_name: 'Alex' }, draft).driver_name).toBe('Alex')
    const cleared = applyLogDraftDefaults({ ...record, driver_name: null }, draft)
    expect(cleared.driver_name).toBeNull()
    expect(buildArrivalContext(cleared, draft).driver_name).toBeNull()
  })

  it('adds nothing when no name is saved', () => {
    const saved = applyLogDraftDefaults(record, logDraftFromProfile(emptyProfile()))
    expect(saved).toBe(record)
    expect('driver_name' in saved).toBe(false)
  })
})
