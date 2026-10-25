// Evidence-chain schemas (build spec N2).
//
// Shared by the Lambda, which validates every addendum before signing it,
// and the browser, which normalises addendum data before queueing it, so
// the copy stored on the phone is byte-for-byte the copy that gets signed.
//
// No SDK imports and no Node built-ins: this file is bundled into the app.
//
// Validation rejects, never repairs. Every key a schema lists is required
// (null when empty). A missing key, an unknown key at any depth, a string
// that is too long or carries control or bidi characters, a malformed time,
// or a value of the wrong type or range throws an AddendumValidationError
// with one of the ERR codes below. The Lambda turns that into HTTP 400.

export const EVIDENCE_V1_SCHEMA = 'parkproof-evidence-v1'
export const EVIDENCE_V2_SCHEMA = 'parkproof-evidence-v2'
export const ADDENDUM_SCHEMA = 'parkproof-addendum-v1'

/** Error codes returned (as `{ error: code }`) with HTTP 400. */
export const ERR = Object.freeze({
  BAD_REQUEST: 'ERR_BAD_REQUEST',
  MISSING_FIELD: 'ERR_MISSING_FIELD',
  UNKNOWN_FIELD: 'ERR_UNKNOWN_FIELD',
  BAD_STRING: 'ERR_BAD_STRING',
  BAD_VALUE: 'ERR_BAD_VALUE',
  BAD_TIME: 'ERR_BAD_TIME',
  TOO_LARGE: 'ERR_TOO_LARGE',
  PARENT_SIGNATURE: 'ERR_PARENT_SIGNATURE',
  PARENT_MISMATCH: 'ERR_PARENT_MISMATCH',
  CHAIN_KEY: 'ERR_CHAIN_KEY',
  FUTURE_TIME: 'ERR_FUTURE_TIME',
})

/**
 * Length caps. String lengths count UTF-16 code units, the same unit an
 * HTML `maxLength` uses, so a field capped in the UI can never fail here.
 */
export const CAPS = Object.freeze({
  driverName: 60,
  signIssue: 200,
  signIssues: 5,
  arrivalPhotos: 12,
  note: 280,
  paymentMethod: 20,
  paymentMethods: 6,
  permitArea: 20,
  conditionPhotosMin: 1,
  conditionPhotosMax: 5,
  returnPhotos: 5,
  previousSessionId: 64,
  askedBecause: 5,
  legIndexMax: 50,
  sessionId: 64,
  maxSeq: 100,
  signatureBase64: 200,
  parentPayloadBytes: 16 * 1024,
  bodyBytes: 32 * 1024,
  futureSkewMs: 5 * 60 * 1000,
})

export const ADDENDUM_KINDS = Object.freeze([
  'arrival_context',
  'condition',
  'compliance',
  'departure',
  'handover',
])

export const PHOTO_ROLES = Object.freeze([
  'sign',
  'car',
  'ambient',
  'condition-front',
  'condition-rear',
  'condition-left',
  'condition-right',
  'condition-detail',
  'return-front',
  'return-rear',
  'return-left',
  'return-right',
  'return-detail',
  'compliance',
])

export const PHOTO_SOURCES = Object.freeze(['camera_input', 'library'])

export const SIGN_STATUSES = Object.freeze([
  'readable',
  'partially_obscured',
  'missing',
  'contradictory',
  'not_a_parking_sign',
])

export const JURISDICTIONS = Object.freeze(['VIC', 'QLD', 'NSW', 'ACT', 'SA', 'WA', 'TAS', 'NT'])

export const COMPLIANCE_TYPES = Object.freeze([
  'meter_ticket',
  'payment_confirmation',
  'permit_displayed',
  'other',
])

export const CONDITION_WHEN = Object.freeze(['parking', 'return'])

export const BOUNDARY_ASKED_BECAUSE = Object.freeze([
  'within_30m',
  'same_street',
  'same_sign_text',
  'area_sign',
  'location_unreliable',
])

export const BOUNDARY_ANSWERS = Object.freeze([
  'opposite_direction_sign',
  'yellow_edge_line',
  't_intersection_or_dead_end',
  'left_parking_area',
  'not_sure',
  'not_asked',
])

/** Client ISO times: UTC, `Z` suffix, optional 1 to 3 fraction digits. */
export const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
export const HEX64_RE = /^[0-9a-f]{64}$/
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * Characters no signed string may contain: C0 and C1 controls (newlines
 * and tabs included), the Unicode line and paragraph separators, and the
 * bidi embedding, override and isolate controls that can make a printed
 * string read differently from its bytes.
 */
export const FORBIDDEN_CHAR_RANGES = Object.freeze([
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
])
// Built from code points so the source holds no raw separator characters
// (a literal U+2028 inside a regex literal is a syntax error).
export const FORBIDDEN_CHARS_RE = new RegExp(
  '[' +
    FORBIDDEN_CHAR_RANGES.map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') +
    ']',
)

export class AddendumValidationError extends Error {
  /**
   * @param {string} code one of ERR
   * @param {string} path where the problem is, e.g. `data.rule_flags.permit_area`
   */
  constructor(code, path) {
    super(`${code} at ${path || '(body)'}`)
    this.name = 'AddendumValidationError'
    this.code = code
    this.path = path
    this.statusCode = 400
  }
}

function fail(code, path) {
  throw new AddendumValidationError(code, path)
}

/**
 * Deterministic JSON: sorted keys, no whitespace, JSON.stringify for
 * primitives. The signer and every verifier must produce identical bytes.
 */
export function canonicalize(value) {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return JSON.stringify(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}'
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`)
}

export function hasForbiddenChars(s) {
  return FORBIDDEN_CHARS_RE.test(s)
}

/** True for a client time in the one accepted ISO form that is a real date. */
export function isIsoTime(s) {
  return typeof s === 'string' && ISO_TIME_RE.test(s) && Number.isFinite(Date.parse(s))
}

export function utf8ByteLength(s) {
  return new TextEncoder().encode(s).length
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

// ── Schema DSL ──────────────────────────────────────────────────────────
// Each node describes one value. `nullable` means null is accepted; a
// missing key is never accepted.

const str = (max, { min = 0, nullable = false } = {}) => ({ t: 'str', max, min, nullable })
const oneOf = (values, { nullable = false } = {}) => ({ t: 'enum', values, nullable })
const bool = ({ nullable = false } = {}) => ({ t: 'bool', nullable })
const int = (min, max, { nullable = false } = {}) => ({ t: 'int', min, max, nullable })
const num = (min, max, { nullable = false } = {}) => ({ t: 'num', min, max, nullable })
const iso = ({ nullable = false } = {}) => ({ t: 'iso', nullable })
const hex64 = ({ nullable = false } = {}) => ({ t: 'hex64', nullable })
const uuid = ({ nullable = false } = {}) => ({ t: 'uuid', nullable })
const arr = (of, { min = 0, max, nullable = false }) => ({ t: 'arr', of, min, max, nullable })
const obj = (fields, { nullable = false } = {}) => ({ t: 'obj', fields, nullable })

const PHOTO_REF = obj({
  role: oneOf(PHOTO_ROLES),
  sha256: hex64(),
  captured_at: iso(),
  source: oneOf(PHOTO_SOURCES),
})

const LOCATION = obj(
  {
    lat: num(-90, 90),
    lng: num(-180, 180),
    accuracy_meters: num(0, Infinity, { nullable: true }),
    source: oneOf(['gps']),
  },
  { nullable: true },
)

const RULE_FLAGS = obj(
  {
    requires_ticket: bool(),
    payment_methods: arr(str(CAPS.paymentMethod), { max: CAPS.paymentMethods, nullable: true }),
    requires_disabled_permit: bool(),
    is_permit_zone: bool(),
    permit_area: str(CAPS.permitArea, { nullable: true }),
    is_area_sign: bool(),
  },
  { nullable: true },
)

const GATE_ACKS = obj(
  {
    meter_ticket: bool({ nullable: true }),
    permit_zone: bool({ nullable: true }),
    accessible_permit: bool({ nullable: true }),
  },
  { nullable: true },
)

const WORKDAY = obj(
  {
    workday_id: uuid(),
    leg_index: int(0, CAPS.legIndexMax),
    stretch_deadline: iso({ nullable: true }),
    previous_departure_payload_sha256: hex64({ nullable: true }),
  },
  { nullable: true },
)

const BOUNDARY = obj(
  {
    previous_session_id: str(CAPS.previousSessionId),
    asked_because: arr(oneOf(BOUNDARY_ASKED_BECAUSE), { max: CAPS.askedBecause }),
    answer: oneOf(BOUNDARY_ANSWERS),
    distance_from_previous_m: num(0, Infinity, { nullable: true }),
  },
  { nullable: true },
)

/** Per-kind `data` schemas. Exported for tests and for later tasks' builders. */
export const KIND_SCHEMAS = Object.freeze({
  arrival_context: obj({
    driver_name: str(CAPS.driverName, { nullable: true }),
    sign_status: oneOf(SIGN_STATUSES, { nullable: true }),
    sign_issues: arr(str(CAPS.signIssue), { max: CAPS.signIssues }),
    rule_flags: RULE_FLAGS,
    gate_acks: GATE_ACKS,
    permit_commitment: hex64({ nullable: true }),
    photos: arr(PHOTO_REF, { max: CAPS.arrivalPhotos }),
    condition_note: str(CAPS.note, { nullable: true }),
    compliance_type: oneOf(COMPLIANCE_TYPES, { nullable: true }),
    jurisdiction: oneOf(JURISDICTIONS, { nullable: true }),
    workday: WORKDAY,
    boundary: BOUNDARY,
  }),
  condition: obj({
    when: oneOf(CONDITION_WHEN),
    photos: arr(PHOTO_REF, { min: CAPS.conditionPhotosMin, max: CAPS.conditionPhotosMax }),
    note: str(CAPS.note, { nullable: true }),
  }),
  compliance: obj({
    compliance_type: oneOf(COMPLIANCE_TYPES),
    photo: PHOTO_REF,
  }),
  departure: obj({
    ended_at: iso(),
    location: LOCATION,
    distance_from_arrival_m: num(0, Infinity, { nullable: true }),
    return_photos: arr(PHOTO_REF, { max: CAPS.returnPhotos }),
  }),
  handover: obj({
    from_driver: str(CAPS.driverName, { nullable: true }),
    to_driver: str(CAPS.driverName, { min: 1 }),
    handed_over_at: iso(),
    location: LOCATION,
  }),
})

const join = (path, key) => (path ? `${path}.${key}` : key)

/**
 * Check an object's keys against a list: an unknown key is reported first,
 * then the first missing key in list order. A key whose value is
 * `undefined` counts as missing, because JSON would drop it.
 */
function checkKeys(value, keys, path) {
  for (const k of Object.keys(value)) {
    if (!keys.includes(k)) fail(ERR.UNKNOWN_FIELD, join(path, k))
  }
  for (const k of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, k) || value[k] === undefined) {
      fail(ERR.MISSING_FIELD, join(path, k))
    }
  }
}

function normalizeNode(node, value, path) {
  if (value === null) {
    if (node.nullable) return null
    fail(node.t === 'str' ? ERR.BAD_STRING : node.t === 'iso' ? ERR.BAD_TIME : ERR.BAD_VALUE, path)
  }
  switch (node.t) {
    case 'str':
      if (typeof value !== 'string') fail(ERR.BAD_STRING, path)
      if (value.length > node.max || value.length < node.min || hasForbiddenChars(value)) {
        fail(ERR.BAD_STRING, path)
      }
      return value
    case 'enum':
      if (typeof value !== 'string' || !node.values.includes(value)) fail(ERR.BAD_VALUE, path)
      return value
    case 'bool':
      if (typeof value !== 'boolean') fail(ERR.BAD_VALUE, path)
      return value
    case 'int':
      if (!Number.isInteger(value) || value < node.min || value > node.max) fail(ERR.BAD_VALUE, path)
      return value
    case 'num':
      if (typeof value !== 'number' || !Number.isFinite(value) || value < node.min || value > node.max) {
        fail(ERR.BAD_VALUE, path)
      }
      // -0 and 0 canonicalise alike; store 0 so the stored copy reads the same.
      return value === 0 ? 0 : value
    case 'iso':
      if (!isIsoTime(value)) fail(ERR.BAD_TIME, path)
      return value
    case 'hex64':
      if (typeof value !== 'string' || !HEX64_RE.test(value)) fail(ERR.BAD_VALUE, path)
      return value
    case 'uuid':
      if (typeof value !== 'string' || !UUID_RE.test(value)) fail(ERR.BAD_VALUE, path)
      return value
    case 'arr': {
      if (!Array.isArray(value)) fail(ERR.BAD_VALUE, path)
      if (value.length < node.min || value.length > node.max) fail(ERR.BAD_VALUE, path)
      return value.map((item, i) => normalizeNode(node.of, item, `${path}[${i}]`))
    }
    case 'obj': {
      if (!isPlainObject(value)) fail(ERR.BAD_VALUE, path)
      const keys = Object.keys(node.fields)
      checkKeys(value, keys, path)
      const out = {}
      for (const k of keys) out[k] = normalizeNode(node.fields[k], value[k], join(path, k))
      return out
    }
    default:
      throw new Error(`addendum-schema: unknown node type ${node.t}`)
  }
}

/**
 * Validate one addendum kind's `data` and return a fresh plain copy holding
 * exactly the schema's keys. Throws AddendumValidationError on any problem.
 * The copy is what the client stores and what the server signs.
 */
export function normalizeAddendumData(kind, data, path = 'data') {
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(KIND_SCHEMAS, kind)) {
    fail(ERR.BAD_VALUE, 'kind')
  }
  if (data === undefined) fail(ERR.MISSING_FIELD, path)
  if (data === null) fail(ERR.BAD_VALUE, path)
  return normalizeNode(KIND_SCHEMAS[kind], data, path)
}

/** The keys an addendum signing request carries. All required. */
export const ADDENDUM_BODY_KEYS = Object.freeze([
  'schema',
  'addendum_id',
  'kind',
  'session_id',
  'seq',
  'captured_at',
  'chain_key',
  'parent',
  'data',
])

/**
 * Validate a `/sign-session` request for an addendum (body.schema is
 * ADDENDUM_SCHEMA). Returns the normalised request. Throws
 * AddendumValidationError. Checks that need the parent's contents or the
 * server clock (signature, seq, chain key, future times) are the
 * handler's job.
 *
 * `chain_key` is the record's secret (hex), or null for a chain whose
 * link 0 is a v1 bundle. The signed payload only ever carries its hash.
 */
export function validateAddendumBody(body) {
  if (!isPlainObject(body)) fail(ERR.BAD_REQUEST, '')
  checkKeys(body, ADDENDUM_BODY_KEYS, '')
  if (body.schema !== ADDENDUM_SCHEMA) fail(ERR.BAD_VALUE, 'schema')
  if (typeof body.addendum_id !== 'string' || !UUID_RE.test(body.addendum_id)) {
    fail(ERR.BAD_VALUE, 'addendum_id')
  }
  if (typeof body.kind !== 'string' || !ADDENDUM_KINDS.includes(body.kind)) fail(ERR.BAD_VALUE, 'kind')
  const session_id = normalizeNode(str(CAPS.sessionId, { min: 1 }), body.session_id, 'session_id')
  const seq = normalizeNode(int(1, CAPS.maxSeq), body.seq, 'seq')
  const captured_at = normalizeNode(iso(), body.captured_at, 'captured_at')
  const chain_key = normalizeNode(hex64({ nullable: true }), body.chain_key, 'chain_key')

  const parent = body.parent
  if (!isPlainObject(parent)) fail(ERR.BAD_VALUE, 'parent')
  checkKeys(parent, ['canonical_payload', 'signature_base64'], 'parent')
  if (typeof parent.canonical_payload !== 'string' || parent.canonical_payload.length === 0) {
    fail(ERR.BAD_VALUE, 'parent.canonical_payload')
  }
  if (utf8ByteLength(parent.canonical_payload) > CAPS.parentPayloadBytes) {
    fail(ERR.TOO_LARGE, 'parent.canonical_payload')
  }
  if (
    typeof parent.signature_base64 !== 'string' ||
    parent.signature_base64.length > CAPS.signatureBase64 ||
    !BASE64_RE.test(parent.signature_base64)
  ) {
    fail(ERR.BAD_VALUE, 'parent.signature_base64')
  }

  const data = normalizeAddendumData(body.kind, body.data, 'data')
  return {
    schema: ADDENDUM_SCHEMA,
    addendum_id: body.addendum_id,
    kind: body.kind,
    session_id,
    seq,
    captured_at,
    chain_key,
    parent: { canonical_payload: parent.canonical_payload, signature_base64: parent.signature_base64 },
    data,
  }
}

/**
 * The canonical addendum payload (before canonicalize). `parent_payload_sha256`
 * is the sha256 hex of the parent link's canonical_payload UTF-8 bytes;
 * `chain_key_sha256` is copied forward from link 0 (null for a v1 chain).
 */
export function buildAddendumPayload(
  { addendum_id, kind, session_id, seq, parent_payload_sha256, chain_key_sha256, captured_at, data },
  signed_at,
) {
  return {
    schema: ADDENDUM_SCHEMA,
    addendum_id,
    kind,
    session_id,
    seq,
    parent_payload_sha256,
    chain_key_sha256: chain_key_sha256 ?? null,
    captured_at,
    signed_at,
    data,
  }
}

/**
 * The client times inside an addendum that must not be in the future by
 * more than CAPS.futureSkewMs: `captured_at`, plus `ended_at` (departure)
 * and `handed_over_at` (handover) inside data. Returns the paths and values.
 */
export function clientTimesToCheck(request) {
  const out = [['captured_at', request.captured_at]]
  if (request.kind === 'departure') out.push(['data.ended_at', request.data.ended_at])
  if (request.kind === 'handover') out.push(['data.handed_over_at', request.data.handed_over_at])
  return out
}
