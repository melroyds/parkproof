// @vitest-environment node
//
// Corpus format v2 (spec T9 item 1): split, tags, expected_variant, sign
// detail expectations and expected_sign_status, with version 1 files still
// loading. A label that can't be scored stops the run.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { filterSplit, loadCorpus, normalizeEntry } from './corpus.mjs'

const V1 = {
  id: 'lygon-st-2p-clearway',
  image: 'lygon-st-2p-clearway.jpg',
  scanContext: { lat: -37.798, lng: 144.9675, datetime: '2026-05-20T14:30:00+10:00' },
  expected: { can_park_now: true, until: '2026-05-20T16:00:00+10:00', duration_minutes: 90, note: '2P, leave by 4pm' },
}

describe('normalizeEntry', () => {
  it('loads a version 1 label as a dev photo, with a warning', () => {
    const { entry, errors, warnings } = normalizeEntry(V1, 'lygon-st-2p-clearway.json')
    expect(errors).toEqual([])
    expect(entry).toMatchObject({ format: 1, split: 'dev', tags: [], expected_variant: null, expected_sign_status: null, expected_flags: {} })
    expect(warnings.join('\n')).toMatch(/no split, counted as dev/)
  })

  it('loads every version 2 field', () => {
    const { entry, errors } = normalizeEntry(
      {
        ...V1,
        format: 2,
        split: 'test',
        tags: ['stacked', 'clearway'],
        expected_variant: 'Right side',
        expected_sign_status: 'readable',
        expected_flags: { requires_ticket: true, payment_methods: ['meter'], permit_area: null, is_area_sign: false },
      },
      'x.json',
    )
    expect(errors).toEqual([])
    expect(entry).toMatchObject({
      format: 2,
      split: 'test',
      tags: ['stacked', 'clearway'],
      expected_variant: ['Right side'],
      expected_sign_status: 'readable',
      expected_flags: { requires_ticket: true, payment_methods: ['meter'], permit_area: null, is_area_sign: false },
      media_type: 'image/jpeg',
    })
  })

  it.each([
    [{ scanContext: { lat: 1, lng: 2 } }, /datetime must be an ISO time with an offset/],
    [{ scanContext: { lat: 1, lng: 2, datetime: '2026-05-20T14:30:00' } }, /datetime must be an ISO time with an offset/],
    [{ split: 'train' }, /split must be "dev" or "test"/],
    [{ expected: { can_park_now: 'yes' } }, /can_park_now must be true or false/],
    [{ expected: { can_park_now: false, until: '2026-05-20T16:00:00+10:00' } }, /until must be null when you can't park/],
    [{ expected: { can_park_now: false, until: null, duration_minutes: 30 } }, /duration_minutes must be null when you can't park/],
    [{ expected: { can_park_now: true, until: 'soon' } }, /until must be null or an ISO time/],
    [{ expected_sign_status: 'blurry' }, /expected_sign_status must be one of/],
    [{ expected_flags: { requires_permit: true } }, /not a sign detail the harness scores/],
    [{ expected_flags: { requires_ticket: 'true' } }, /requires_ticket must be true or false/],
    [{ expected_variant: [] }, /expected_variant must be a position label/],
    [{ image: 'sign.gif' }, /\.jpg, \.jpeg, \.png or \.webp/],
  ])('rejects a label it cannot score: %j', (patch, message) => {
    const { entry, errors } = normalizeEntry({ ...V1, ...patch }, 'bad.json')
    expect(entry).toBeNull()
    expect(errors.join('\n')).toMatch(message)
  })

  it('warns about unknown keys so a typo is noticed', () => {
    const { entry, warnings } = normalizeEntry({ ...V1, expected_flag: {} }, 'typo.json')
    expect(entry).not.toBeNull()
    expect(warnings.join('\n')).toMatch(/unknown key "expected_flag"/)
  })
})

describe('normalizeEntry: the scan time is the local time at the spot', () => {
  const MELBOURNE = { lat: -37.8136, lng: 144.9631 }
  const BRISBANE = { lat: -27.4698, lng: 153.0251 }
  // A label at a given place and time, can't park, so until doesn't matter.
  const at = (place, datetime) =>
    normalizeEntry(
      { ...V1, scanContext: { ...place, datetime }, expected: { can_park_now: false, until: null, duration_minutes: null } },
      'when.json',
    )

  it('accepts the zone\'s own offset on either side of a daylight saving change', () => {
    expect(at(MELBOURNE, '2026-05-20T14:30:00+10:00').errors).toEqual([])
    expect(at(MELBOURNE, '2026-11-01T14:30:00+11:00').errors).toEqual([])
    // The repeated hour when daylight saving ends: both readings are real clock times.
    expect(at(MELBOURNE, '2026-04-05T02:30:00+11:00').errors).toEqual([])
    expect(at(MELBOURNE, '2026-04-05T02:30:00+10:00').errors).toEqual([])
    expect(at(MELBOURNE, '2026-05-20T14:30:00+10:00').entry.timezone).toBe('Australia/Melbourne')
  })

  it('rejects a winter offset copied into daylight saving time, and says which offset is right', () => {
    const { entry, errors } = at(MELBOURNE, '2026-11-01T14:30:00+10:00')
    expect(entry).toBeNull()
    expect(errors.join('\n')).toMatch(/offset \+10:00 isn't Australia\/Melbourne's offset at that moment \(\+11:00\).*2026-11-01T14:30:00\+11:00/)
  })

  it('rejects a UTC time, which the reader would take as the local time', () => {
    const { entry, errors } = at(MELBOURNE, '2026-11-01T03:30:00Z')
    expect(entry).toBeNull()
    expect(errors.join('\n')).toMatch(/offset Z isn't Australia\/Melbourne's offset/)
  })

  it('rejects a time the clock skips on the morning daylight saving starts', () => {
    for (const datetime of ['2026-10-04T02:30:00+10:00', '2026-10-04T02:30:00+11:00']) {
      const { entry, errors } = at(MELBOURNE, datetime)
      expect(entry).toBeNull()
      expect(errors.join('\n')).toMatch(/2026-10-04 02:30:00 never shows on the clock in Australia\/Melbourne/)
    }
  })

  it('Brisbane has no daylight saving: +10:00 all year, +11:00 never', () => {
    expect(at(BRISBANE, '2026-11-01T14:30:00+10:00').errors).toEqual([])
    expect(at(BRISBANE, '2026-11-01T14:30:00+10:00').entry.timezone).toBe('Australia/Brisbane')
    expect(at(BRISBANE, '2026-11-01T14:30:00+11:00').errors.join('\n')).toMatch(/isn't Australia\/Brisbane's offset at that moment \(\+10:00\)/)
  })

  it('without coordinates the time is checked against Melbourne, as the reader assumes', () => {
    expect(at({}, '2026-11-01T14:30:00+11:00').errors).toEqual([])
    expect(at({}, '2026-11-01T14:30:00+10:00').errors.join('\n')).toMatch(/Australia\/Melbourne's offset/)
  })
})

describe('normalizeEntry: the leave-by time and the minutes', () => {
  const v2 = (expected) => normalizeEntry({ ...V1, format: 2, split: 'dev', expected }, 'v2.json')

  it('a format 2 label must state until and duration_minutes, null included', () => {
    const { entry, errors } = v2({ can_park_now: true })
    expect(entry).toBeNull()
    expect(errors.join('\n')).toMatch(/expected\.until is required in a format 2 label/)
    expect(errors.join('\n')).toMatch(/expected\.duration_minutes is required in a format 2 label/)
    expect(v2({ can_park_now: true, until: null, duration_minutes: null }).errors).toEqual([])
    // Version 1 labels stay lenient.
    expect(normalizeEntry({ ...V1, expected: { can_park_now: true } }, 'v1.json').errors).toEqual([])
  })

  it('the leave-by time must be after the scan time', () => {
    const { errors } = v2({ can_park_now: true, until: '2026-05-20T14:00:00+10:00', duration_minutes: null })
    expect(errors.join('\n')).toMatch(/expected\.until must be after scanContext\.datetime/)
  })

  it('the minutes must match the leave-by time, to within a minute', () => {
    // 14:30 to 16:00 is 90 minutes.
    expect(v2({ can_park_now: true, until: '2026-05-20T16:00:00+10:00', duration_minutes: 91 }).errors).toEqual([])
    const { errors } = v2({ can_park_now: true, until: '2026-05-20T16:00:00+10:00', duration_minutes: 500 })
    expect(errors.join('\n')).toMatch(/duration_minutes is 500, but until is 90 minutes after scanContext\.datetime/)
  })

  it('a leave-by time with no minutes is an error, as in the rubric (polish list)', () => {
    const { entry, errors } = v2({ can_park_now: true, until: '2026-05-20T16:00:00+10:00', duration_minutes: null })
    expect(entry).toBeNull()
    expect(errors.join('\n')).toMatch(/duration_minutes must be the minutes from scanContext\.datetime to until when until is set/)
    // Version 1 labels may still leave the minutes out (not scored).
    const v1 = normalizeEntry({ ...V1, expected: { can_park_now: true, until: '2026-05-20T16:00:00+10:00' } }, 'v1.json')
    expect(v1.errors).toEqual([])
    // But not state "no minutes" next to a leave-by time.
    const v1Null = normalizeEntry(
      { ...V1, expected: { can_park_now: true, until: '2026-05-20T16:00:00+10:00', duration_minutes: null } },
      'v1.json',
    )
    expect(v1Null.entry).toBeNull()
  })

  it('minutes with no leave-by time is an error', () => {
    const { errors } = v2({ can_park_now: true, until: null, duration_minutes: 30 })
    expect(errors.join('\n')).toMatch(/duration_minutes must be null when until is null/)
  })
})

describe('loadCorpus', () => {
  let dir
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  function corpus(files) {
    dir = mkdtempSync(join(tmpdir(), 'pp-corpus-'))
    mkdirSync(dir, { recursive: true })
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
    return loadCorpus(dir)
  }

  it('loads labels with their photos, sorted by id, and filters by split', () => {
    const result = corpus({
      'b.json': JSON.stringify({ ...V1, id: 'b', image: 'b.jpg', split: 'test' }),
      'b.jpg': 'x',
      'a.json': JSON.stringify({ ...V1, id: 'a', image: 'a.png', split: 'dev' }),
      'a.png': 'x',
    })
    expect(result.errors).toEqual([])
    expect(result.entries.map((e) => e.id)).toEqual(['a', 'b'])
    expect(result.entries[0].media_type).toBe('image/png')
    expect(filterSplit(result.entries, 'test').map((e) => e.id)).toEqual(['b'])
    expect(filterSplit(result.entries, 'all')).toHaveLength(2)
  })

  it('reports a missing photo, a repeated id and broken JSON', () => {
    const result = corpus({
      'one.json': JSON.stringify({ ...V1, id: 'same', image: 'one.jpg' }),
      'one.jpg': 'x',
      'two.json': JSON.stringify({ ...V1, id: 'same', image: 'one.jpg' }),
      'three.json': JSON.stringify({ ...V1, id: 'three', image: 'nowhere.jpg' }),
      'four.json': '{ not json',
    })
    const text = result.errors.join('\n')
    expect(text).toMatch(/id "same" is also used by one\.json/)
    expect(text).toMatch(/photo "nowhere\.jpg" not found/)
    expect(text).toMatch(/four\.json: not valid JSON/)
    expect(result.entries.map((e) => e.id)).toEqual(['same'])
  })

  it('an absent folder is an empty corpus', () => {
    expect(loadCorpus(join(tmpdir(), 'pp-no-such-corpus-dir'))).toEqual({ entries: [], errors: [], warnings: [] })
  })
})
