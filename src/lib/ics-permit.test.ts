// @vitest-environment happy-dom
//
// The calendar file on a record whose permit allows a later time (build spec
// T4 item 6): the event moves to the permit time the driver read off the
// sign, every alarm fires at its own absolute time with the caller's
// translated text (the standard-limit alarm included), and the event title
// and description are the caller's, so the permit time is never called an
// expiry. Without options nothing changes.
//
// Also the no-sign "Check on your car" file (downloadIcsAbsolute), whose
// alarms all fire at absolute times.
//
// The `ics` package reads a date array in an alarm trigger as the machine's
// local time, so a regression to date arrays only shows east of UTC. This
// file runs on a Melbourne clock whatever the machine's zone (Node re-reads
// TZ when it is assigned), so a UTC CI runner catches it too.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { downloadIcs, downloadIcsAbsolute } from './ics'
import type { ParkingSession } from '../types'

const STANDARD = '2026-11-09T05:00:00.000Z'
const PERMIT = '2026-11-09T07:00:00.000Z'
const record = {
  id: 'rec-ics',
  arrived_at: '2026-11-09T03:00:00.000Z',
  location: { lat: -37.8136, lng: 144.9631, address: '12 King St' },
  expires_at: STANDARD,
} as unknown as ParkingSession

// vi.stubEnv assigns process.env.TZ, which Node applies at once.
beforeAll(() => {
  vi.stubEnv('TZ', 'Australia/Melbourne')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

/** Run downloadIcs and read back the calendar text it handed the browser. */
async function icsText(run: () => void): Promise<string> {
  let blob: Blob | null = null
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
    blob = b as Blob
    return 'blob:test'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  run()
  expect(blob).not.toBeNull()
  // Unfold RFC 5545 line folding so long lines can be matched whole.
  return (await (blob as unknown as Blob).text()).replace(/\r\n[ \t]/g, '')
}

afterEach(() => vi.restoreAllMocks())

describe('downloadIcs', () => {
  it('runs on a clock east of UTC', () => {
    // 2026-11-09T05:00Z is 4 pm AEDT: the file's own guard.
    expect(new Date(STANDARD).getHours()).toBe(16)
  })

  it('anchors on the expiry by default', async () => {
    const text = await icsText(() => downloadIcs(record, [15]))
    expect(text).toContain('DTSTART:20261109T050000Z')
    expect(text).toContain('TRIGGER:-PT15M')
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(1)
  })

  it('puts the at-expiry alarm at the expiry instant, not hours off on a phone east of UTC', async () => {
    const text = await icsText(() => downloadIcs(record, [0]))
    expect(text).toContain('TRIGGER;VALUE=DATE-TIME:20261109T050000Z')
  })

  it('on a permit-adjusted record: the permit time, absolute alarms and the caller\'s own words', async () => {
    const standardText = 'The standard limit on this sign ends now. Your permit time runs to 6:00 pm.'
    const permitText = 'The permit time you entered from the sign ends at 6:00 pm. Time to move the car.'
    const text = await icsText(() =>
      downloadIcs(record, [], {
        anchor: PERMIT,
        extraAlarms: [
          { at: new Date(STANDARD), description: standardText },
          { at: new Date(PERMIT), description: permitText },
        ],
        title: 'ParkProof: the permit time you entered ends',
        description: 'The permit time you entered from the sign ends at 6:00 pm.',
      }),
    )
    expect(text).toContain('DTSTART:20261109T070000Z')
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(2)
    expect(text).toContain('TRIGGER;VALUE=DATE-TIME:20261109T050000Z')
    expect(text).toContain('TRIGGER;VALUE=DATE-TIME:20261109T070000Z')
    expect(text).toContain(`DESCRIPTION:${standardText}`)
    expect(text).toContain(`DESCRIPTION:${permitText}`)
    expect(text).toContain('SUMMARY:ParkProof: the permit time you entered ends')
    // Nothing in the file calls the driver's permit time an expiry.
    expect(text).not.toMatch(/expires/i)
  })

  it('still needs at least one alarm', () => {
    expect(() => downloadIcs(record, [])).toThrow(/Pick at least one reminder time/)
  })
})

describe('downloadIcsAbsolute (a record with no sign)', () => {
  it('puts every alarm at its own fire time, not hours early on a phone east of UTC', async () => {
    // 2 pm and 4:30 pm AEDT on 9 November 2026.
    const first = new Date('2026-11-09T03:00:00.000Z')
    const second = new Date('2026-11-09T05:30:00.000Z')
    const text = await icsText(() => downloadIcsAbsolute(record, [second, first]))
    expect(text).toContain('DTSTART:20261109T030000Z')
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(2)
    expect(text).toContain('TRIGGER;VALUE=DATE-TIME:20261109T030000Z')
    expect(text).toContain('TRIGGER;VALUE=DATE-TIME:20261109T053000Z')
    // A local clock read as UTC would have put them 11 hours early, the evening before.
    expect(text).not.toContain('TRIGGER;VALUE=DATE-TIME:20261108T')
  })

  it('still needs at least one alarm', () => {
    expect(() => downloadIcsAbsolute(record, [])).toThrow(/Pick at least one reminder time/)
  })
})
