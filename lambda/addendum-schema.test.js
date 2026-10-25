// @vitest-environment node
//
// lambda/addendum-schema.js: the shared addendum schemas (spec N2).
// Validation rejects, never repairs: every rejection below must throw with
// the right ERR code and path, and a valid input must come back as a plain
// copy with exactly the schema's keys.
import { describe, it, expect } from 'vitest'
import {
  ADDENDUM_SCHEMA,
  AddendumValidationError,
  CAPS,
  ERR,
  KIND_SCHEMAS,
  buildAddendumPayload,
  canonicalize,
  clientTimesToCheck,
  hasForbiddenChars,
  isIsoTime,
  normalizeAddendumData,
  validateAddendumBody,
} from './addendum-schema.js'
import { canonicalize as lambdaCanonicalize } from './index.js'

const ch = (n) => String.fromCharCode(n)
const T = '2026-05-21T08:00:00.000Z'
const H = (c) => c.repeat(64)
const UUID = '0b6f7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e'

const photo = (role = 'sign', extra = {}) => ({
  role,
  sha256: H('a'),
  captured_at: T,
  source: 'camera_input',
  ...extra,
})

const EMPTY_ARRIVAL = {
  driver_name: null,
  sign_status: null,
  sign_issues: [],
  rule_flags: null,
  gate_acks: null,
  permit_commitment: null,
  photos: [],
  condition_note: null,
  compliance_type: null,
  jurisdiction: null,
  workday: null,
  boundary: null,
}

const FULL_ARRIVAL = {
  driver_name: 'Sam Lee',
  sign_status: 'partially_obscured',
  sign_issues: ['Bottom plate faded'],
  rule_flags: {
    requires_ticket: true,
    payment_methods: ['meter', 'paystay'],
    requires_disabled_permit: false,
    is_permit_zone: true,
    permit_area: '25',
    is_area_sign: false,
  },
  gate_acks: { meter_ticket: true, permit_zone: null, accessible_permit: false },
  permit_commitment: H('c'),
  photos: [photo('sign'), photo('condition-front', { source: 'library' })],
  condition_note: 'Scratch on the rear bumper',
  compliance_type: 'meter_ticket',
  jurisdiction: 'VIC',
  workday: {
    workday_id: UUID,
    leg_index: 2,
    stretch_deadline: '2026-05-21T10:00:00.000Z',
    previous_departure_payload_sha256: H('d'),
  },
  boundary: {
    previous_session_id: 'rec-prev',
    asked_because: ['within_30m', 'same_street'],
    answer: 'not_sure',
    distance_from_previous_m: 22.5,
  },
}

const VALID = {
  arrival_context: FULL_ARRIVAL,
  condition: { when: 'return', photos: [photo('return-front')], note: null },
  compliance: { compliance_type: 'payment_confirmation', photo: photo('compliance', { source: 'library' }) },
  departure: {
    ended_at: T,
    location: { lat: -37.8136, lng: 144.9631, accuracy_meters: 12, source: 'gps' },
    distance_from_arrival_m: 4,
    return_photos: [],
  },
  handover: { from_driver: null, to_driver: 'Alex', handed_over_at: T, location: null },
}

const clone = (v) => JSON.parse(JSON.stringify(v))

/** Expect normalizeAddendumData to throw this code at this path. */
function expectReject(kind, data, code, path) {
  let caught
  try {
    normalizeAddendumData(kind, data)
  } catch (err) {
    caught = err
  }
  expect(caught, `${kind} ${path}`).toBeInstanceOf(AddendumValidationError)
  expect(caught.code).toBe(code)
  if (path !== undefined) expect(caught.path).toBe(path)
  expect(caught.statusCode).toBe(400)
}

describe('normalizeAddendumData: valid input', () => {
  for (const kind of Object.keys(VALID)) {
    it(`accepts a valid ${kind} and returns an equal plain copy`, () => {
      const input = clone(VALID[kind])
      const out = normalizeAddendumData(kind, input)
      expect(out).toEqual(VALID[kind])
      expect(out).not.toBe(input)
      expect(canonicalize(out)).toBe(canonicalize(VALID[kind]))
    })
  }

  it('accepts an arrival_context where every field is empty', () => {
    expect(normalizeAddendumData('arrival_context', clone(EMPTY_ARRIVAL))).toEqual(EMPTY_ARRIVAL)
  })

  it('returns keys in schema order and never mutates the input', () => {
    const input = clone(VALID.departure)
    const reordered = {
      return_photos: input.return_photos,
      distance_from_arrival_m: input.distance_from_arrival_m,
      location: input.location,
      ended_at: input.ended_at,
    }
    const before = JSON.stringify(reordered)
    const out = normalizeAddendumData('departure', reordered)
    expect(Object.keys(out)).toEqual(['ended_at', 'location', 'distance_from_arrival_m', 'return_photos'])
    expect(JSON.stringify(reordered)).toBe(before)
  })

  it('stores -0 as 0, so the stored copy reads the same as the signed bytes', () => {
    const d = clone(VALID.departure)
    d.distance_from_arrival_m = -0
    expect(Object.is(normalizeAddendumData('departure', d).distance_from_arrival_m, 0)).toBe(true)
  })

  it('accepts strings exactly at each cap', () => {
    const d = clone(EMPTY_ARRIVAL)
    d.driver_name = 'x'.repeat(CAPS.driverName)
    d.condition_note = 'y'.repeat(CAPS.note)
    d.sign_issues = Array(CAPS.signIssues).fill('z'.repeat(CAPS.signIssue))
    d.photos = Array(CAPS.arrivalPhotos).fill(photo())
    expect(() => normalizeAddendumData('arrival_context', d)).not.toThrow()
  })

  it('has a schema for every addendum kind', () => {
    expect(Object.keys(KIND_SCHEMAS).sort()).toEqual(
      ['arrival_context', 'compliance', 'condition', 'departure', 'handover'],
    )
  })
})

describe('normalizeAddendumData: ERR_MISSING_FIELD', () => {
  it('rejects a missing top-level key', () => {
    const d = clone(EMPTY_ARRIVAL)
    delete d.jurisdiction
    expectReject('arrival_context', d, ERR.MISSING_FIELD, 'data.jurisdiction')
  })

  it('treats an undefined value as missing (JSON would drop it)', () => {
    const d = clone(EMPTY_ARRIVAL)
    d.driver_name = undefined
    expectReject('arrival_context', d, ERR.MISSING_FIELD, 'data.driver_name')
  })

  it('rejects a missing nested key at every depth', () => {
    const a = clone(FULL_ARRIVAL)
    delete a.rule_flags.is_area_sign
    expectReject('arrival_context', a, ERR.MISSING_FIELD, 'data.rule_flags.is_area_sign')

    const b = clone(FULL_ARRIVAL)
    delete b.photos[1].source
    expectReject('arrival_context', b, ERR.MISSING_FIELD, 'data.photos[1].source')

    const c = clone(FULL_ARRIVAL)
    delete c.workday.previous_departure_payload_sha256
    expectReject('arrival_context', c, ERR.MISSING_FIELD, 'data.workday.previous_departure_payload_sha256')

    const d = clone(VALID.departure)
    delete d.location.accuracy_meters
    expectReject('departure', d, ERR.MISSING_FIELD, 'data.location.accuracy_meters')
  })

  it('rejects missing data', () => {
    expectReject('departure', undefined, ERR.MISSING_FIELD, 'data')
  })
})

describe('normalizeAddendumData: ERR_UNKNOWN_FIELD', () => {
  it('rejects an unknown key at the top level', () => {
    expectReject('condition', { ...clone(VALID.condition), extra: 1 }, ERR.UNKNOWN_FIELD, 'data.extra')
  })

  it('rejects an unknown key at every depth', () => {
    const a = clone(FULL_ARRIVAL)
    a.gate_acks.other = true
    expectReject('arrival_context', a, ERR.UNKNOWN_FIELD, 'data.gate_acks.other')

    const b = clone(FULL_ARRIVAL)
    b.photos[0].exif = 'x'
    expectReject('arrival_context', b, ERR.UNKNOWN_FIELD, 'data.photos[0].exif')

    const c = clone(FULL_ARRIVAL)
    c.boundary.notes = 'x'
    expectReject('arrival_context', c, ERR.UNKNOWN_FIELD, 'data.boundary.notes')

    const d = clone(VALID.handover)
    d.location = { lat: 1, lng: 2, accuracy_meters: null, source: 'gps', address: '1 King St' }
    expectReject('handover', d, ERR.UNKNOWN_FIELD, 'data.location.address')
  })

  it('reports an unknown key before a missing one, and rejects __proto__ keys', () => {
    const d = JSON.parse('{"__proto__":{"x":1},"ended_at":"' + T + '"}')
    expectReject('departure', d, ERR.UNKNOWN_FIELD, 'data.__proto__')
  })
})

describe('normalizeAddendumData: ERR_BAD_STRING', () => {
  it('rejects strings over their cap', () => {
    const a = clone(EMPTY_ARRIVAL)
    a.driver_name = 'x'.repeat(CAPS.driverName + 1)
    expectReject('arrival_context', a, ERR.BAD_STRING, 'data.driver_name')

    const b = clone(EMPTY_ARRIVAL)
    b.condition_note = 'x'.repeat(CAPS.note + 1)
    expectReject('arrival_context', b, ERR.BAD_STRING, 'data.condition_note')

    const c = clone(EMPTY_ARRIVAL)
    c.sign_issues = ['x'.repeat(CAPS.signIssue + 1)]
    expectReject('arrival_context', c, ERR.BAD_STRING, 'data.sign_issues[0]')

    const d = clone(FULL_ARRIVAL)
    d.rule_flags.permit_area = 'x'.repeat(CAPS.permitArea + 1)
    expectReject('arrival_context', d, ERR.BAD_STRING, 'data.rule_flags.permit_area')

    const e = clone(FULL_ARRIVAL)
    e.rule_flags.payment_methods = ['x'.repeat(CAPS.paymentMethod + 1)]
    expectReject('arrival_context', e, ERR.BAD_STRING, 'data.rule_flags.payment_methods[0]')

    const f = clone(FULL_ARRIVAL)
    f.boundary.previous_session_id = 'x'.repeat(CAPS.previousSessionId + 1)
    expectReject('arrival_context', f, ERR.BAD_STRING, 'data.boundary.previous_session_id')

    const g = clone(VALID.handover)
    g.to_driver = 'x'.repeat(CAPS.driverName + 1)
    expectReject('handover', g, ERR.BAD_STRING, 'data.to_driver')
  })

  it('rejects an empty to_driver (1 to 60 characters)', () => {
    expectReject('handover', { ...clone(VALID.handover), to_driver: '' }, ERR.BAD_STRING, 'data.to_driver')
  })

  const forbidden = [
    ['NUL', 0x00],
    ['newline', 0x0a],
    ['tab', 0x09],
    ['unit separator', 0x1f],
    ['DEL', 0x7f],
    ['NEL', 0x85],
    ['C1 end', 0x9f],
    ['line separator', 0x2028],
    ['paragraph separator', 0x2029],
    ['LRE', 0x202a],
    ['RLO', 0x202e],
    ['LRI', 0x2066],
    ['PDI', 0x2069],
  ]
  for (const [name, code] of forbidden) {
    it(`rejects a string containing ${name} (U+${code.toString(16).padStart(4, '0').toUpperCase()})`, () => {
      const a = clone(EMPTY_ARRIVAL)
      a.driver_name = 'Sam' + ch(code) + 'Lee'
      expectReject('arrival_context', a, ERR.BAD_STRING, 'data.driver_name')
    })
  }

  it('accepts accented letters, CJK, Devanagari and Gurmukhi', () => {
    const a = clone(EMPTY_ARRIVAL)
    a.driver_name = 'Zo' + ch(0xeb) + ' ' + ch(0x674e) + ' ' + ch(0x0905) + ch(0x0a05)
    expect(() => normalizeAddendumData('arrival_context', a)).not.toThrow()
  })

  it('rejects a non-string where a string is expected', () => {
    expectReject('handover', { ...clone(VALID.handover), to_driver: 42 }, ERR.BAD_STRING, 'data.to_driver')
    expectReject('handover', { ...clone(VALID.handover), to_driver: null }, ERR.BAD_STRING, 'data.to_driver')
  })

  it('hasForbiddenChars agrees with the rule', () => {
    expect(hasForbiddenChars('ordinary text, 12:30 pm')).toBe(false)
    expect(hasForbiddenChars('a' + ch(0x2067) + 'b')).toBe(true)
    expect(hasForbiddenChars('a' + ch(0xa0) + 'b')).toBe(false)
  })
})

describe('normalizeAddendumData: ERR_BAD_TIME', () => {
  const bad = [
    '2026-05-21T18:00:00+10:00',
    '2026-05-21T08:00:00',
    '2026-05-21T08:00:00.1234Z',
    '2026-05-21 08:00:00Z',
    '2026-13-45T08:00:00Z',
    '1716278400000',
    '',
  ]
  for (const v of bad) {
    it(`rejects ended_at ${JSON.stringify(v)}`, () => {
      expectReject('departure', { ...clone(VALID.departure), ended_at: v }, ERR.BAD_TIME, 'data.ended_at')
    })
  }

  it('accepts 0 to 3 fraction digits with Z', () => {
    for (const v of ['2026-05-21T08:00:00Z', '2026-05-21T08:00:00.5Z', '2026-05-21T08:00:00.123Z']) {
      expect(isIsoTime(v)).toBe(true)
    }
  })

  it('rejects a bad time nested in a photo ref and a null required time', () => {
    const a = clone(FULL_ARRIVAL)
    a.photos[0].captured_at = 'yesterday'
    expectReject('arrival_context', a, ERR.BAD_TIME, 'data.photos[0].captured_at')
    expectReject('handover', { ...clone(VALID.handover), handed_over_at: null }, ERR.BAD_TIME, 'data.handed_over_at')
  })
})

describe('normalizeAddendumData: ERR_BAD_VALUE', () => {
  const cases = [
    ['an unknown enum value', 'arrival_context', (d) => (d.sign_status = 'blurry'), 'data.sign_status'],
    ['an unknown jurisdiction', 'arrival_context', (d) => (d.jurisdiction = 'NZ'), 'data.jurisdiction'],
    ['an unknown photo role', 'arrival_context', (d) => (d.photos[0].role = 'selfie'), 'data.photos[0].role'],
    ['an unknown photo source', 'arrival_context', (d) => (d.photos[0].source = 'screenshot'), 'data.photos[0].source'],
    ['an uppercase photo hash', 'arrival_context', (d) => (d.photos[0].sha256 = H('A')), 'data.photos[0].sha256'],
    ['a short permit commitment', 'arrival_context', (d) => (d.permit_commitment = 'abc'), 'data.permit_commitment'],
    ['too many sign issues', 'arrival_context', (d) => (d.sign_issues = Array(CAPS.signIssues + 1).fill('x')), 'data.sign_issues'],
    ['too many photos', 'arrival_context', (d) => (d.photos = Array(CAPS.arrivalPhotos + 1).fill(photo())), 'data.photos'],
    ['too many payment methods', 'arrival_context', (d) => (d.rule_flags.payment_methods = Array(CAPS.paymentMethods + 1).fill('m')), 'data.rule_flags.payment_methods'],
    ['a string boolean', 'arrival_context', (d) => (d.rule_flags.requires_ticket = 'true'), 'data.rule_flags.requires_ticket'],
    ['a null non-nullable boolean', 'arrival_context', (d) => (d.rule_flags.is_area_sign = null), 'data.rule_flags.is_area_sign'],
    ['leg_index above 50', 'arrival_context', (d) => (d.workday.leg_index = CAPS.legIndexMax + 1), 'data.workday.leg_index'],
    ['a fractional leg_index', 'arrival_context', (d) => (d.workday.leg_index = 1.5), 'data.workday.leg_index'],
    ['a negative leg_index', 'arrival_context', (d) => (d.workday.leg_index = -1), 'data.workday.leg_index'],
    ['a malformed workday_id', 'arrival_context', (d) => (d.workday.workday_id = 'day-1'), 'data.workday.workday_id'],
    ['an unknown boundary answer', 'arrival_context', (d) => (d.boundary.answer = 'yes'), 'data.boundary.answer'],
    ['an unknown asked_because', 'arrival_context', (d) => (d.boundary.asked_because = ['vibes']), 'data.boundary.asked_because[0]'],
    ['a negative boundary distance', 'arrival_context', (d) => (d.boundary.distance_from_previous_m = -1), 'data.boundary.distance_from_previous_m'],
    ['an array where an object is expected', 'arrival_context', (d) => (d.gate_acks = []), 'data.gate_acks'],
    ['an object where an array is expected', 'arrival_context', (d) => (d.photos = {}), 'data.photos'],
    ['a null array', 'arrival_context', (d) => (d.sign_issues = null), 'data.sign_issues'],
    ['zero condition photos', 'condition', (d) => (d.photos = []), 'data.photos'],
    ['six condition photos', 'condition', (d) => (d.photos = Array(6).fill(photo('return-rear'))), 'data.photos'],
    ['an unknown condition when', 'condition', (d) => (d.when = 'later'), 'data.when'],
    ['a null compliance type', 'compliance', (d) => (d.compliance_type = null), 'data.compliance_type'],
    ['a latitude above 90', 'departure', (d) => (d.location.lat = 91), 'data.location.lat'],
    ['a longitude below -180', 'departure', (d) => (d.location.lng = -181), 'data.location.lng'],
    ['a NaN accuracy', 'departure', (d) => (d.location.accuracy_meters = NaN), 'data.location.accuracy_meters'],
    ['a negative accuracy', 'departure', (d) => (d.location.accuracy_meters = -3), 'data.location.accuracy_meters'],
    ['a manual location source', 'departure', (d) => (d.location.source = 'manual'), 'data.location.source'],
    ['a string distance', 'departure', (d) => (d.distance_from_arrival_m = '4'), 'data.distance_from_arrival_m'],
    ['an Infinity distance', 'departure', (d) => (d.distance_from_arrival_m = Infinity), 'data.distance_from_arrival_m'],
    ['six return photos', 'departure', (d) => (d.return_photos = Array(6).fill(photo('return-left'))), 'data.return_photos'],
  ]
  for (const [name, kind, mutate, path] of cases) {
    it(`rejects ${name}`, () => {
      const d = clone(VALID[kind])
      mutate(d)
      expectReject(kind, d, ERR.BAD_VALUE, path)
    })
  }

  it('rejects an unknown kind and a null data object', () => {
    expectReject('parking_vibes', {}, ERR.BAD_VALUE, 'kind')
    expectReject('departure', null, ERR.BAD_VALUE, 'data')
  })
})

describe('validateAddendumBody', () => {
  const body = () => ({
    schema: ADDENDUM_SCHEMA,
    addendum_id: UUID,
    kind: 'departure',
    session_id: 'rec-1',
    seq: 1,
    captured_at: T,
    chain_key: H('e'),
    parent: { canonical_payload: '{"schema":"parkproof-evidence-v2"}', signature_base64: 'MEUCIQ==' },
    data: clone(VALID.departure),
  })
  const reject = (b, code, path) => {
    let caught
    try {
      validateAddendumBody(b)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AddendumValidationError)
    expect(caught.code).toBe(code)
    if (path !== undefined) expect(caught.path).toBe(path)
  }

  it('returns the normalised request', () => {
    const out = validateAddendumBody(body())
    expect(out.data).toEqual(VALID.departure)
    expect(out.parent.signature_base64).toBe('MEUCIQ==')
    expect(out.chain_key).toBe(H('e'))
  })

  it('accepts a null chain key (v1 chains have none)', () => {
    expect(validateAddendumBody({ ...body(), chain_key: null }).chain_key).toBeNull()
  })

  it('rejects unknown and missing top-level keys', () => {
    reject({ ...body(), extra: 1 }, ERR.UNKNOWN_FIELD, 'extra')
    const b = body()
    delete b.chain_key
    reject(b, ERR.MISSING_FIELD, 'chain_key')
    const c = body()
    delete c.parent.signature_base64
    reject(c, ERR.MISSING_FIELD, 'parent.signature_base64')
    reject({ ...body(), parent: { ...body().parent, key_alias: 'x' } }, ERR.UNKNOWN_FIELD, 'parent.key_alias')
  })

  it('rejects malformed fields', () => {
    reject({ ...body(), addendum_id: 'not-a-uuid' }, ERR.BAD_VALUE, 'addendum_id')
    reject({ ...body(), addendum_id: UUID.toUpperCase() }, ERR.BAD_VALUE, 'addendum_id')
    reject({ ...body(), kind: 'note' }, ERR.BAD_VALUE, 'kind')
    reject({ ...body(), seq: 0 }, ERR.BAD_VALUE, 'seq')
    reject({ ...body(), seq: 1.5 }, ERR.BAD_VALUE, 'seq')
    reject({ ...body(), seq: CAPS.maxSeq + 1 }, ERR.BAD_VALUE, 'seq')
    reject({ ...body(), session_id: '' }, ERR.BAD_STRING, 'session_id')
    reject({ ...body(), session_id: 'x'.repeat(CAPS.sessionId + 1) }, ERR.BAD_STRING, 'session_id')
    reject({ ...body(), captured_at: '2026-05-21T18:00:00+10:00' }, ERR.BAD_TIME, 'captured_at')
    reject({ ...body(), chain_key: 'short' }, ERR.BAD_VALUE, 'chain_key')
    reject({ ...body(), parent: { canonical_payload: '', signature_base64: 'MEUCIQ==' } }, ERR.BAD_VALUE, 'parent.canonical_payload')
    reject({ ...body(), parent: { canonical_payload: '{}', signature_base64: 'not base64!' } }, ERR.BAD_VALUE, 'parent.signature_base64')
    reject({ ...body(), parent: 'x' }, ERR.BAD_VALUE, 'parent')
    reject({ ...body(), schema: 'parkproof-addendum-v2' }, ERR.BAD_VALUE, 'schema')
    reject(null, ERR.BAD_REQUEST)
    reject([], ERR.BAD_REQUEST)
  })

  it('rejects a parent payload over 16 KB', () => {
    const big = '{"x":"' + 'a'.repeat(CAPS.parentPayloadBytes) + '"}'
    reject({ ...body(), parent: { canonical_payload: big, signature_base64: 'MEUCIQ==' } }, ERR.TOO_LARGE, 'parent.canonical_payload')
  })

  it('validates the data against the kind', () => {
    const b = body()
    b.data.ended_at = 'soon'
    reject(b, ERR.BAD_TIME, 'data.ended_at')
  })
})

describe('shared helpers', () => {
  it('canonicalize is the very function the Lambda signs with', () => {
    expect(lambdaCanonicalize).toBe(canonicalize)
  })

  it('buildAddendumPayload carries exactly the N2 keys', () => {
    const p = buildAddendumPayload(
      {
        addendum_id: UUID,
        kind: 'departure',
        session_id: 'rec-1',
        seq: 2,
        parent_payload_sha256: H('1'),
        chain_key_sha256: null,
        captured_at: T,
        data: VALID.departure,
      },
      '2026-05-21T08:00:05.000Z',
    )
    expect(Object.keys(p).sort()).toEqual(
      [
        'addendum_id',
        'captured_at',
        'chain_key_sha256',
        'data',
        'kind',
        'parent_payload_sha256',
        'schema',
        'seq',
        'session_id',
        'signed_at',
      ],
    )
    expect(p.schema).toBe(ADDENDUM_SCHEMA)
  })

  it('clientTimesToCheck lists captured_at plus the kind-specific times', () => {
    expect(clientTimesToCheck({ kind: 'condition', captured_at: T, data: {} })).toEqual([['captured_at', T]])
    expect(clientTimesToCheck({ kind: 'departure', captured_at: T, data: { ended_at: 'e' } })).toEqual([
      ['captured_at', T],
      ['data.ended_at', 'e'],
    ])
    expect(clientTimesToCheck({ kind: 'handover', captured_at: T, data: { handed_over_at: 'h' } })).toEqual([
      ['captured_at', T],
      ['data.handed_over_at', 'h'],
    ])
  })
})
