// "Who's driving?" (build spec T7 item 1): the field's prefill (the seam
// T4's saved name plugs into) and what a record saves from it.
import { describe, expect, it } from 'vitest'
import { DRIVER_BADGE_MAX, DRIVER_NAME_MAX, defaultDriverName, driverBadgeText, savedDriverName } from './driver-name'
import { emptyLogDraft } from './evidence-chain'

describe('defaultDriverName', () => {
  it("starts from the draft's driver, else empty", () => {
    expect(defaultDriverName({ ...emptyLogDraft(), driver_name: 'Sam' })).toBe('Sam')
    expect(defaultDriverName(emptyLogDraft())).toBe('')
    expect(defaultDriverName(null)).toBe('')
    expect(defaultDriverName(undefined)).toBe('')
  })

  it('shapes a draft name to the signed field', () => {
    expect(defaultDriverName({ driver_name: '  Sam\n ' })).toBe('Sam')
    expect(defaultDriverName({ driver_name: 'z'.repeat(90) })).toHaveLength(DRIVER_NAME_MAX)
  })
})

describe('savedDriverName', () => {
  it('saves a trimmed name, or null when the field is empty', () => {
    expect(DRIVER_NAME_MAX).toBe(60)
    expect(savedDriverName('  Alex ')).toBe('Alex')
    expect(savedDriverName('')).toBeNull()
    expect(savedDriverName('   ')).toBeNull()
    expect(savedDriverName('A⁦B')).toBe('A B')
  })
})

describe('driverBadgeText', () => {
  it("is the name the record will save, on the logger's closed toggle, or null for nobody", () => {
    expect(driverBadgeText('  Sam ')).toBe('Sam')
    expect(driverBadgeText('')).toBeNull()
    expect(driverBadgeText('   ')).toBeNull()
  })

  it('cuts a long name to fit beside the title, with an ellipsis', () => {
    const long = 'Alexandra Konstantinopoulou-Smith'
    const badge = driverBadgeText(long)!
    expect(Array.from(badge)).toHaveLength(DRIVER_BADGE_MAX)
    expect(badge.endsWith('…')).toBe(true)
    expect(long.startsWith(badge.slice(0, -1))).toBe(true)
    expect(driverBadgeText('x'.repeat(DRIVER_BADGE_MAX))).toBe('x'.repeat(DRIVER_BADGE_MAX))
  })
})
