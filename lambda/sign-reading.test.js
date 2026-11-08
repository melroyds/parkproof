// @vitest-environment node
//
// Build spec T3 items 1 to 4 (server): the sign reader's new schema fields,
// the prompt sections that define them, the user_permits and parking_state
// request checks, refresh-mode echoes, and normalizeModelOutput. The
// Anthropic SDK is mocked; nothing here calls the real API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {
      this.messages = { create: mockCreate }
    }
  },
}))

const { SYSTEM_PROMPT, RESPONSE_SCHEMA, handler, translateSign } = await import('./index.js')
const {
  NO_READABLE_SIGN_STATUSES,
  RECURRING_KINDS,
  SIGN_READING_CAPS,
  SignInputError,
  USER_PERMIT_TYPES,
  WEEKDAYS,
  normalizeModelOutput,
  plainNoteText,
  readPriorSignContext,
  readRecurringRestrictions,
  validateParkingState,
  validateUserPermits,
} = await import('./sign-reading.js')
const { CAPS, ERR, SIGN_STATUSES } = await import('./addendum-schema.js')

/** No permits listed: no permit_exception entries. */
const NONE = []
/** A resident permit listed; the sign prints nothing for it. */
const RESIDENT_NONE = [{ applies: false, permit_type: 'resident', text: '' }]
const ch = (code) => String.fromCharCode(code)
/** WinAnsi (cp1252): what jsPDF's Helvetica draws for the en, it and id PDFs. */
const isWinAnsi = (text) =>
  [...text].every((c) => {
    const cp = c.codePointAt(0)
    return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178'.includes(c)
  })

/** A complete, valid answer as the model returns it. */
function fullAnswer(overrides = {}) {
  return {
    sign_status: 'readable',
    sign_issues: [],
    rules: '2P Mon-Fri 8am-6pm; Permit Zone Area 25 excepted; Clearway Mon-Fri 4:30pm-6:30pm',
    observations: [{ scope: 'Whole sign', items: ['2P', 'Mon-Fri 8am-6pm', 'Area 25 excepted'] }],
    can_park_now: true,
    until: '2026-11-09T12:00:00+11:00',
    duration_minutes: 120,
    confidence: 'high',
    requires_ticket: false,
    payment_methods: null,
    requires_disabled_permit: false,
    is_permit_zone: false,
    permit_area: '25',
    is_area_sign: false,
    permit_exception: [{ applies: true, permit_type: 'resident', text: 'PERMIT ZONE AREA 25 EXCEPTED' }],
    recurring_restrictions: [
      {
        kind: 'clearway',
        days: ['MO', 'TU', 'WE', 'TH', 'FR'],
        start: '16:30',
        end: '18:30',
        week_of_month: [],
        exceptions_text: 'PUBLIC HOLIDAYS EXCEPTED',
        label: 'Clearway Mon-Fri 4:30pm-6:30pm',
      },
    ],
    next_transition: { when: '2026-11-09T16:30:00+11:00', change: 'Clearway begins, move by then' },
    clarification: null,
    ...overrides,
  }
}

function variant(overrides = {}) {
  return {
    label: 'Left side',
    rules: '1/4P 8am-6pm',
    observations: [{ scope: '← Left arrow', items: ['1/4P', '8am-6pm'] }],
    can_park_now: true,
    until: '2026-11-09T10:15:00+11:00',
    duration_minutes: 15,
    requires_disabled_permit: false,
    is_permit_zone: false,
    permit_area: null,
    is_area_sign: false,
    permit_exception: [],
    next_transition: null,
    ...overrides,
  }
}

const RESIDENT = [{ type: 'resident', area: 'Area 25' }]

function mockModel(answer) {
  mockCreate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify(answer) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 100 },
  })
}

const call = () => mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0]
const systemText = (c) => c.system.map((s) => s.text).join('\n')
const userText = (c) => c.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')

const fresh = (overrides = {}) =>
  translateSign({
    image_base64: 'AAAA',
    media_type: 'image/jpeg',
    lat: -37.8136,
    lng: 144.9631,
    current_datetime: '2026-11-09T10:00:00+11:00',
    ...overrides,
  })

const refresh = (overrides = {}) =>
  translateSign({
    prior_rules: '2P Mon-Fri 8am-6pm',
    prior_observations: [{ scope: 'Whole sign', items: ['2P', 'Mon-Fri 8am-6pm'] }],
    lat: -37.8136,
    lng: 144.9631,
    current_datetime: '2026-11-09T10:00:00+11:00',
    ...overrides,
  })

beforeEach(() => {
  mockCreate.mockReset()
  process.env.ANTHROPIC_API_KEY = 'test-sk-mock'
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Item 1: schema ──────────────────────────────────────────────────────

/** Every object node in a schema, with a path for failure messages. */
function objectNodes(node, path = '$', out = []) {
  if (!node || typeof node !== 'object') return out
  if (node.type === 'object') out.push({ path, node })
  for (const [k, v] of Object.entries(node.properties || {})) objectNodes(v, `${path}.${k}`, out)
  if (node.items) objectNodes(node.items, `${path}[]`, out)
  for (const [i, branch] of (node.anyOf || []).entries()) objectNodes(branch, `${path}|${i}`, out)
  return out
}

/** Parameters that use anyOf or a type array, as the structured-outputs limit counts them. */
function unionParameterCount(node) {
  let n = 0
  for (const v of Object.values(node.properties || {})) {
    if (v.anyOf || Array.isArray(v.type)) n++
    n += unionParameterCount(v)
  }
  if (node.items) n += unionParameterCount(node.items)
  for (const branch of node.anyOf || []) n += unionParameterCount(branch)
  return n
}

const variantSchema = () => RESPONSE_SCHEMA.properties.clarification.anyOf[1].properties.options.items

describe('RESPONSE_SCHEMA (T3 item 1)', () => {
  it('puts sign_status first, in properties and in required, with exactly the five statuses', () => {
    expect(Object.keys(RESPONSE_SCHEMA.properties)[0]).toBe('sign_status')
    expect(RESPONSE_SCHEMA.required[0]).toBe('sign_status')
    expect(RESPONSE_SCHEMA.properties.sign_status).toEqual({
      type: 'string',
      enum: ['readable', 'partially_obscured', 'missing', 'contradictory', 'not_a_parking_sign'],
    })
  })

  it('lists every property in required, in property order, at every level, with additionalProperties false', () => {
    const nodes = objectNodes(RESPONSE_SCHEMA)
    // top level, observation group, permit exception, recurring item,
    // next transition, clarification, variant (and their nested copies)
    expect(nodes.length).toBeGreaterThanOrEqual(7)
    for (const { path, node } of nodes) {
      expect(node.additionalProperties, path).toBe(false)
      expect(node.required, path).toEqual(Object.keys(node.properties))
    }
  })

  it('adds sign_issues as a plain (never null) string array', () => {
    expect(RESPONSE_SCHEMA.properties.sign_issues).toEqual({ type: 'array', items: { type: 'string' } })
  })

  it('has is_area_sign and permit_exception at the top level and per variant', () => {
    for (const [where, schema] of [
      ['top', RESPONSE_SCHEMA],
      ['variant', variantSchema()],
    ]) {
      expect(schema.properties.is_area_sign, where).toEqual({ type: 'boolean' })
      // One entry per user permit type (spec T3 item 1), so a list.
      const list = schema.properties.permit_exception
      expect(list.type, where).toBe('array')
      const pe = list.items
      expect(pe.type, where).toBe('object')
      expect(Object.keys(pe.properties), where).toEqual(['applies', 'permit_type', 'text'])
      expect(pe.required, where).toEqual(['applies', 'permit_type', 'text'])
      expect(pe.additionalProperties, where).toBe(false)
      expect(pe.properties.applies).toEqual({ type: 'boolean' })
      expect(pe.properties.permit_type).toEqual({
        anyOf: [{ type: 'string', enum: ['accessible', 'resident', 'business'] }, { type: 'null' }],
      })
      expect(pe.properties.text).toEqual({ type: 'string' })
    }
  })

  it('keeps recurring_restrictions top level only, with the exact field shapes', () => {
    expect(variantSchema().properties.recurring_restrictions).toBeUndefined()
    const rr = RESPONSE_SCHEMA.properties.recurring_restrictions
    expect(rr.type).toBe('array')
    const item = rr.items
    expect(Object.keys(item.properties)).toEqual(['kind', 'days', 'start', 'end', 'week_of_month', 'exceptions_text', 'label'])
    expect(item.properties.kind).toEqual({ type: 'string', enum: ['street_cleaning', 'clearway', 'no_stopping', 'other'] })
    expect(item.properties.days).toEqual({
      type: 'array',
      items: { type: 'string', enum: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] },
    })
    expect(item.properties.start).toEqual({ type: 'string' })
    expect(item.properties.end).toEqual({ type: 'string' })
    expect(item.properties.week_of_month).toEqual({ type: 'array', items: { type: 'integer' } })
    expect(item.properties.exceptions_text).toEqual({ type: 'string' })
    expect(item.properties.label).toEqual({ type: 'string' })
  })

  it('stays inside the structured-outputs limits (16 union parameters, no unsupported keywords)', () => {
    expect(unionParameterCount(RESPONSE_SCHEMA)).toBeLessThanOrEqual(16)
    const text = JSON.stringify(RESPONSE_SCHEMA)
    for (const keyword of ['minimum', 'maximum', 'minLength', 'maxLength', 'maxItems', 'pattern', 'multipleOf']) {
      expect(text, keyword).not.toContain(`"${keyword}"`)
    }
  })

  it('is the schema sent with the request, with max_tokens 16384, adaptive thinking and effort low', async () => {
    mockModel(fullAnswer())
    await fresh()
    const c = call()
    expect(c.output_config.format).toEqual({ type: 'json_schema', schema: RESPONSE_SCHEMA })
    expect(c.output_config.effort).toBe('low')
    expect(c.thinking).toEqual({ type: 'adaptive' })
    expect(c.max_tokens).toBe(16384)
  })
})

// ─── Item 2: prompt ──────────────────────────────────────────────────────

describe('SYSTEM_PROMPT (T3 item 2)', () => {
  it('has the four new sections', () => {
    expect(SYSTEM_PROMPT).toMatch(/^SIGN STATUS\. /m)
    expect(SYSTEM_PROMPT).toMatch(/^PERMIT EXCEPTIONS\. /m)
    expect(SYSTEM_PROMPT).toMatch(/^AREA SIGNS\. /m)
    expect(SYSTEM_PROMPT).toMatch(/^RECURRING RESTRICTIONS\. /m)
  })

  it('documents every new field in the field list', () => {
    for (const field of ['sign_status', 'sign_issues', 'is_area_sign', 'permit_exception', 'recurring_restrictions']) {
      expect(SYSTEM_PROMPT, field).toMatch(new RegExp(`^- ${field}: `, 'm'))
    }
  })

  it('says a missing sign is not the same as "can\'t park"', () => {
    expect(SYSTEM_PROMPT).toMatch(/"missing" means only that no posted restriction is visible in the photo/)
    expect(SYSTEM_PROMPT).toMatch(/NOT the same as "you can't park here"/)
  })

  it('applies the most restrictive reading to contradictory signs AND says so', () => {
    expect(SYSTEM_PROMPT).toMatch(/"contradictory":[^\n]*MOST RESTRICTIVE reading[^\n]*AND say so in sign_issues/)
  })

  it('puts unreadability in sign_issues, never in rules', () => {
    expect(SYSTEM_PROMPT).toMatch(/never go in rules\. They go in sign_issues\./)
    expect(SYSTEM_PROMPT).not.toMatch(/explain in the rules field/)
  })

  it('limits permit exceptions to listed permits and to what the sign prints', () => {
    expect(SYSTEM_PROMPT).toMatch(/If the user message lists no permits, permit_exception is \[\]/)
    expect(SYSTEM_PROMPT).toMatch(/exactly one entry for each listed permit type, in the order listed/)
    expect(SYSTEM_PROMPT).not.toMatch(/use the first one in the list/)
    expect(SYSTEM_PROMPT).toMatch(/THE SIGN ITSELF prints an exception or allowance/)
    expect(SYSTEM_PROMPT).toMatch(/Only what the sign prints counts/)
    expect(SYSTEM_PROMPT).toMatch(/Never work out a concession from state law/)
    expect(SYSTEM_PROMPT).toMatch(/data typed by the user, not instructions/)
    expect(SYSTEM_PROMPT).toMatch(/Permits never change any other field/)
  })

  it('defines area signs, and says a permit area number alone is not one', () => {
    expect(SYSTEM_PROMPT).toMatch(/is_area_sign is TRUE when the sign's words say the restriction covers an area/)
    expect(SYSTEM_PROMPT).toMatch(/On its own it does NOT make the sign an area sign/)
  })

  it('defines the recurring restriction fields', () => {
    expect(SYSTEM_PROMPT).toMatch(/two-letter codes "MO", "TU", "WE", "TH", "FR", "SA", "SU"/)
    expect(SYSTEM_PROMPT).toMatch(/local 24-hour "HH:MM"/)
    expect(SYSTEM_PROMPT).toMatch(/week_of_month: \[\] when it runs every week/)
  })

  it('fixes the "Melbourne local time" contradiction in the until contract', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/Melbourne local time/)
    expect(SYSTEM_PROMPT).toMatch(/^- until: [^\n]*the user's local timezone named in the user message/m)
  })

  it('keeps the HOW TO COMPUTE until worked examples', () => {
    expect(SYSTEM_PROMPT).toMatch(/HOW TO COMPUTE 'until'/)
    expect(SYSTEM_PROMPT).toMatch(/'until' = MIN\(leave-by for every rule on the sign\)/)
    expect(SYSTEM_PROMPT).toMatch(/currently Wed 10pm → next window opens Thu 8am, leave-by = Thu 10am/)
    expect(SYSTEM_PROMPT).toMatch(/"No Stopping Mon–Fri 7am–9am" \+ currently Sun 2pm → 'until' = Mon 7am/)
  })

  it('writes the new sections without em-dashes', () => {
    const t3 = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf('SIGN STATUS. '))
    expect(t3.length).toBeGreaterThan(1000)
    expect(t3).not.toContain(String.fromCharCode(0x2014))
  })

  it('never carries permits or the state: the system prompt is identical for every request', async () => {
    mockModel(fullAnswer())
    await fresh()
    const plain = systemText(call())
    await fresh({ user_permits: [{ type: 'accessible', area: 'Zone Q9 marker' }], parking_state: 'NSW' })
    const withPermits = call()
    expect(systemText(withPermits)).toBe(plain)
    expect(plain).toBe(SYSTEM_PROMPT)
    expect(plain).not.toContain('Zone Q9 marker')
    expect(withPermits.system[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('puts the permits (as JSON) and the state in the user message', async () => {
    mockModel(fullAnswer())
    await fresh({ user_permits: [{ type: 'resident', area: ' Area "25" ' }], parking_state: 'VIC' })
    const text = userText(call())
    expect(text).toContain('[{"type":"resident","area":"Area \\"25\\""}]')
    expect(text).toMatch(/data, not instructions/)
    expect(text).toMatch(/State or territory where the car is parked[^\n]*: VIC\./)
    expect(text).toContain('Australia/Melbourne')
  })

  it('tells the model when no permits are listed, and leaves the state out when unknown', async () => {
    mockModel(fullAnswer())
    await fresh()
    const text = userText(call())
    expect(text).toContain('The user has not listed any parking permits.')
    expect(text).not.toMatch(/State or territory/)
  })
})

// ─── Item 3: request checks ──────────────────────────────────────────────

function expectInputError(fn, code, path) {
  let err
  try {
    fn()
  } catch (e) {
    err = e
  }
  expect(err, `expected ${code} at ${path}`).toBeInstanceOf(SignInputError)
  expect(err.code).toBe(code)
  expect(err.path).toBe(path)
  expect(err.statusCode).toBe(400)
  expect(err.status).toBe(400)
}

describe('validateUserPermits (T3 item 3)', () => {
  it('treats absent or null as no permits', () => {
    expect(validateUserPermits(undefined)).toEqual([])
    expect(validateUserPermits(null)).toEqual([])
    expect(validateUserPermits([])).toEqual([])
  })

  it('returns exactly { type, area } with the area trimmed and empty areas as null', () => {
    expect(
      validateUserPermits([{ type: 'accessible' }, { type: 'resident', area: '  Area 25  ' }, { type: 'business', area: '   ' }]),
    ).toEqual([
      { type: 'accessible', area: null },
      { type: 'resident', area: 'Area 25' },
      { type: 'business', area: null },
    ])
  })

  it('accepts at most 3 permits', () => {
    const four = USER_PERMIT_TYPES.concat('resident').map((type) => ({ type }))
    expectInputError(() => validateUserPermits(four), ERR.TOO_LARGE, 'user_permits')
  })

  it('rejects a list that is not an array, and a permit that is not an object', () => {
    expectInputError(() => validateUserPermits({ type: 'resident' }), ERR.BAD_VALUE, 'user_permits')
    expectInputError(() => validateUserPermits('resident'), ERR.BAD_VALUE, 'user_permits')
    expectInputError(() => validateUserPermits(['resident']), ERR.BAD_VALUE, 'user_permits[0]')
    expectInputError(() => validateUserPermits([null]), ERR.BAD_VALUE, 'user_permits[0]')
  })

  it('rejects a type outside accessible, resident and business', () => {
    expectInputError(() => validateUserPermits([{ type: 'disabled' }]), ERR.BAD_VALUE, 'user_permits[0].type')
    expectInputError(() => validateUserPermits([{ type: 'resident' }, {}]), ERR.BAD_VALUE, 'user_permits[1].type')
    expectInputError(() => validateUserPermits([{ type: 'Resident' }]), ERR.BAD_VALUE, 'user_permits[0].type')
  })

  it('caps the area at 60 characters after trimming', () => {
    expect(validateUserPermits([{ type: 'resident', area: '  ' + 'a'.repeat(60) + '  ' }])[0].area).toBe('a'.repeat(60))
    expectInputError(
      () => validateUserPermits([{ type: 'resident', area: 'a'.repeat(61) }]),
      ERR.BAD_STRING,
      'user_permits[0].area',
    )
  })

  it.each([
    ['newline', '\n'],
    ['trailing newline', '', '\n'],
    ['tab', '\t'],
    ['bell', ch(0x07)],
    ['DEL', ch(0x7f)],
    ['C1 NEL', ch(0x85)],
    ['line separator', ch(0x2028)],
    ['right-to-left override', ch(0x202e)],
    ['isolate', ch(0x2066)],
  ])('rejects an area holding a control or bidi character (%s)', (_name, mid, end = '') => {
    expectInputError(
      () => validateUserPermits([{ type: 'resident', area: 'Area' + mid + '25' + end }]),
      ERR.BAD_STRING,
      'user_permits[0].area',
    )
  })

  it('rejects a non-string area and any key other than type and area', () => {
    expectInputError(() => validateUserPermits([{ type: 'resident', area: 25 }]), ERR.BAD_STRING, 'user_permits[0].area')
    expectInputError(
      () => validateUserPermits([{ type: 'accessible', expiry: '2027-01-01' }]),
      ERR.UNKNOWN_FIELD,
      'user_permits[0].expiry',
    )
  })
})

describe('validateParkingState (T3 item 3)', () => {
  it('accepts the eight Australian codes or nothing', () => {
    for (const s of ['VIC', 'QLD', 'NSW', 'ACT', 'SA', 'WA', 'TAS', 'NT']) expect(validateParkingState(s)).toBe(s)
    expect(validateParkingState(undefined)).toBeNull()
    expect(validateParkingState(null)).toBeNull()
  })

  it('rejects anything else', () => {
    for (const bad of ['Victoria', 'vic', '', 3, {}]) {
      expectInputError(() => validateParkingState(bad), ERR.BAD_VALUE, 'parking_state')
    }
  })
})

describe('translateSign request handling (T3 item 3)', () => {
  it('rejects bad permits before calling the model', async () => {
    await expect(fresh({ user_permits: [{ type: 'resident', area: 'x\ny' }] })).rejects.toBeInstanceOf(SignInputError)
    await expect(refresh({ parking_state: 'Victoria' })).rejects.toMatchObject({ code: ERR.BAD_VALUE, path: 'parking_state' })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('sends permits in refresh mode too', async () => {
    mockModel(fullAnswer())
    await refresh({ user_permits: RESIDENT, parking_state: 'VIC' })
    const text = userText(call())
    expect(text).toMatch(/REFRESH/)
    expect(text).toContain('[{"type":"resident","area":"Area 25"}]')
    expect(text).toMatch(/: VIC\./)
  })

  it('gives refresh mode the recorded sign status, issues and area flag to echo', async () => {
    mockModel(fullAnswer())
    await refresh({ prior_sign_status: 'partially_obscured', prior_sign_issues: ['Bottom plate faded'], prior_is_area_sign: true })
    const text = userText(call())
    expect(text).toContain('Sign status recorded at the first reading: partially_obscured')
    expect(text).toContain('Sign issues recorded at the first reading: ["Bottom plate faded"]')
    expect(text).toContain('Area sign recorded at the first reading: yes')
    expect(text).toMatch(/Echo sign_status, sign_issues and is_area_sign as recorded above/)
    expect(text).toMatch(/recurring_restrictions must be \[\]/)
  })

  it('says "not recorded" for an old record without them', async () => {
    mockModel(fullAnswer())
    await refresh({ prior_sign_status: 'blurry' })
    const text = userText(call())
    expect(text).toContain('Sign status recorded at the first reading: not recorded')
    expect(text).toContain('Area sign recorded at the first reading: not recorded')
    // The status the schema needs is a placeholder the app doesn't keep,
    // never a reading: no photo is read on a re-check.
    expect(text).toMatch(/If the status isn't recorded, put "readable" and \[\] only as placeholders/)
    expect(text).toMatch(/the app doesn't keep them/)
  })

  it('echoes the recorded values even when the model answers otherwise', async () => {
    mockModel(fullAnswer({ sign_status: 'readable', sign_issues: [], is_area_sign: false }))
    const result = await refresh({
      prior_sign_status: 'contradictory',
      prior_sign_issues: ['Right arrow plates disagree', 7, 'Right arrow plates disagree'],
      prior_is_area_sign: true,
    })
    expect(result.sign_status).toBe('contradictory')
    expect(result.sign_issues).toEqual(['Right arrow plates disagree'])
    expect(result.is_area_sign).toBe(true)
  })

  it('returns the normalised answer, not the raw model text', async () => {
    mockModel({ ...fullAnswer(), sign_status: 'blurry', extra_key: 'dropped' })
    const result = await fresh({ user_permits: RESIDENT })
    expect(result.sign_status).toBe('partially_obscured')
    expect(result).not.toHaveProperty('extra_key')
    expect(Object.keys(result)).toEqual(Object.keys(RESPONSE_SCHEMA.properties))
  })

  it('never logs permit types or area labels', async () => {
    const lines = []
    for (const level of ['log', 'warn', 'error', 'info']) {
      vi.spyOn(console, level).mockImplementation((...args) => lines.push(args.map(String).join(' ')))
    }
    mockModel(fullAnswer({ permit_exception: [{ applies: true, permit_type: 'accessible', text: 'EXCEPT DISABLED' }] }))
    await fresh({ user_permits: [{ type: 'accessible', area: 'Secret Area 77' }] })
    await fresh({ user_permits: [{ type: 'accessible', area: 'Secret Area 77\n' }] }).catch(() => {})
    await handler({
      requestContext: { http: { method: 'POST', path: '/sign-translate' } },
      body: JSON.stringify({ image_base64: 'AAAA', user_permits: [{ type: 'accessible', area: 'Secret Area 77' + ch(0x202e) }] }),
    })
    const all = lines.join('\n')
    expect(lines.length).toBeGreaterThan(0)
    expect(all).not.toMatch(/accessible/i)
    expect(all).not.toContain('Secret Area 77')
  })
})

describe('/sign-translate handler (T3 item 3)', () => {
  const post = (body) =>
    handler({ requestContext: { http: { method: 'POST', path: '/sign-translate' } }, body: JSON.stringify(body) })

  it('returns 400 with the code and field for bad permits, before any job is queued', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post({ image_base64: 'AAAA', user_permits: [{ type: 'resident', area: 'a'.repeat(61) }] })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ error: ERR.BAD_STRING, field: 'user_permits[0].area' })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns 400 for a bad parking state in refresh mode', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post({ prior_rules: '2P', parking_state: 'Queensland' })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toEqual({ error: ERR.BAD_VALUE, field: 'parking_state' })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('answers a valid refresh with the normalised result', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    mockModel(fullAnswer())
    const res = await post({ prior_rules: '2P', user_permits: RESIDENT, parking_state: 'VIC' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.permit_exception).toEqual([{ applies: true, permit_type: 'resident', text: 'PERMIT ZONE AREA 25 EXCEPTED' }])
    expect(body.recurring_restrictions).toHaveLength(1)
  })
})

describe('readPriorSignContext', () => {
  it('cleans the echoes rather than rejecting them', () => {
    expect(readPriorSignContext({})).toEqual({ sign_status: null, sign_issues: [], is_area_sign: null })
    expect(
      readPriorSignContext({
        prior_sign_status: 'partially_obscured',
        prior_sign_issues: Array(8).fill(0).map((_, i) => `Issue ${i}` + ch(0x2028) + 'x'.repeat(300)),
        prior_is_area_sign: 'yes',
      }),
    ).toMatchObject({ sign_status: 'partially_obscured', is_area_sign: null })
    const issues = readPriorSignContext({ prior_sign_status: 'missing', prior_sign_issues: Array(8).fill('y'.repeat(300)) }).sign_issues
    expect(issues).toEqual(['y'.repeat(CAPS.signIssue)])
    expect(readPriorSignContext({ prior_sign_status: 'readable', prior_sign_issues: ['x'] }).sign_issues).toEqual([])
  })
})

// ─── Item 4: normalizeModelOutput ───────────────────────────────────────

describe('normalizeModelOutput (T3 item 4)', () => {
  it('passes a complete valid answer through unchanged, keys in schema order', () => {
    const answer = fullAnswer({
      clarification: {
        question: 'Where are you parked?',
        options: [
          variant({ permit_exception: RESIDENT_NONE }),
          variant({ label: 'Right side', is_area_sign: true, permit_exception: [{ applies: true, permit_type: 'resident', text: 'AREA 25 EXCEPTED' }] }),
        ],
      },
      is_area_sign: true,
    })
    const out = normalizeModelOutput(structuredClone(answer), { user_permits: RESIDENT })
    expect(out).toEqual(answer)
    expect(Object.keys(out)).toEqual(Object.keys(RESPONSE_SCHEMA.properties))
    expect(Object.keys(out.clarification.options[0])).toEqual(Object.keys(variantSchema().properties))
  })

  it('throws ERR_SIGN_UNREADABLE for an answer that is not an object', () => {
    for (const bad of [null, [], 'text', 3]) {
      expect(() => normalizeModelOutput(bad)).toThrow('ERR_SIGN_UNREADABLE')
    }
  })

  it('fills every missing field with its stated default', () => {
    expect(normalizeModelOutput({})).toEqual({
      sign_status: 'partially_obscured',
      sign_issues: [],
      rules: '',
      observations: [],
      can_park_now: false,
      until: null,
      duration_minutes: null,
      confidence: 'low',
      requires_ticket: false,
      payment_methods: null,
      requires_disabled_permit: false,
      is_permit_zone: false,
      permit_area: null,
      is_area_sign: false,
      permit_exception: NONE,
      recurring_restrictions: [],
      next_transition: null,
      clarification: null,
    })
  })

  describe('bad enums', () => {
    it('falls back to the cautious status and low confidence', () => {
      const out = normalizeModelOutput(fullAnswer({ sign_status: 'blurry', confidence: 'certain', sign_issues: ['Glare'] }))
      expect(out.sign_status).toBe('partially_obscured')
      expect(out.confidence).toBe('low')
      expect(out.sign_issues).toEqual(['Glare'])
    })

    it('keeps every valid status', () => {
      for (const s of SIGN_STATUSES) expect(normalizeModelOutput(fullAnswer({ sign_status: s })).sign_status).toBe(s)
    })

    it('turns an unknown recurring kind into other, and keeps only valid days in week order', () => {
      const [r] = normalizeModelOutput(
        fullAnswer({
          recurring_restrictions: [
            { kind: 'parking', days: ['FR', 'MON', 'TU', 'XX', 'TU', 3], start: '7:00', end: '24:00', week_of_month: [], exceptions_text: '', label: 'x' },
          ],
        }),
      ).recurring_restrictions
      expect(RECURRING_KINDS).toContain('other')
      expect(r).toEqual({ kind: 'other', days: ['TU', 'FR'], start: '07:00', end: '23:59', week_of_month: [], exceptions_text: '', label: 'x' })
    })

    it('treats an unknown permit type as no exception', () => {
      const out = normalizeModelOutput(fullAnswer({ permit_exception: [{ applies: true, permit_type: 'disabled', text: 'DISABLED 4P' }] }), {
        user_permits: [{ type: 'accessible', area: null }],
      })
      expect(out.permit_exception).toEqual([{ applies: false, permit_type: 'accessible', text: '' }])
    })
  })

  describe('caps', () => {
    it('cuts sign_issues to the signed-addendum caps and strips control and bidi characters', () => {
      const issues = Array.from({ length: 9 }, (_, i) => `Issue ${i}` + ch(0x202e) + ch(0x0a) + 'z'.repeat(300))
      const out = normalizeModelOutput(fullAnswer({ sign_status: 'partially_obscured', sign_issues: issues }))
      expect(out.sign_issues).toHaveLength(CAPS.signIssues)
      for (const s of out.sign_issues) {
        expect(s.length).toBeLessThanOrEqual(CAPS.signIssue)
        expect(s).not.toMatch(/[\u0000-\u001f‮]/)
      }
      expect(out.sign_issues[0].startsWith('Issue 0 z')).toBe(true)
    })

    it('cuts payment methods and the permit area to the signed-addendum caps', () => {
      const out = normalizeModelOutput(
        fullAnswer({
          payment_methods: ['meter', 'easypark', 'paystay', 'wilson', 'carepark', 'pay-by-plate', 'ticket machine', 'cellopark', 'x'.repeat(40)],
          permit_area: 'A'.repeat(30),
        }),
      )
      expect(out.payment_methods).toEqual(['meter', 'easypark', 'paystay', 'wilson', 'carepark', 'pay-by-plate'])
      expect(out.payment_methods).toHaveLength(CAPS.paymentMethods)
      expect(out.permit_area).toBe('A'.repeat(CAPS.permitArea))
      expect(normalizeModelOutput(fullAnswer({ permit_area: '   ' })).permit_area).toBeNull()
      expect(normalizeModelOutput(fullAnswer({ payment_methods: 'meter' })).payment_methods).toBeNull()
    })

    it('cuts recurring restrictions, observations, options and long strings', () => {
      const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
      const many = Array.from({ length: 12 }, (_, i) => ({
        kind: 'street_cleaning',
        days: [days[i % 7]],
        start: `0${i % 10}:00`,
        end: '23:00',
        week_of_month: [],
        exceptions_text: 'e'.repeat(300),
        label: 'l'.repeat(300),
      }))
      const out = normalizeModelOutput(
        fullAnswer({
          rules: 'r'.repeat(5000),
          recurring_restrictions: many,
          observations: Array.from({ length: 20 }, (_, i) => ({ scope: `S${i}`, items: Array(20).fill('item') .map((x, j) => `${x}${j}`) })),
          clarification: { question: 'q'.repeat(500), options: Array.from({ length: 9 }, (_, i) => variant({ label: `Bay ${i}` })) },
        }),
      )
      expect(out.rules).toHaveLength(SIGN_READING_CAPS.rules)
      expect(out.recurring_restrictions).toHaveLength(SIGN_READING_CAPS.recurringRestrictions)
      expect(out.recurring_restrictions[0].label).toHaveLength(SIGN_READING_CAPS.recurringLabel)
      expect(out.recurring_restrictions[0].exceptions_text).toHaveLength(SIGN_READING_CAPS.recurringExceptionsText)
      expect(out.observations).toHaveLength(SIGN_READING_CAPS.observationGroups)
      expect(out.observations[0].items).toHaveLength(SIGN_READING_CAPS.observationItems)
      expect(out.clarification.options).toHaveLength(SIGN_READING_CAPS.clarificationOptions)
      expect(out.clarification.question).toHaveLength(SIGN_READING_CAPS.clarificationQuestion)
    })

    it('never splits a surrogate pair when cutting', () => {
      const out = normalizeModelOutput(fullAnswer({ permit_area: 'A'.repeat(19) + '\u{1F697}' }))
      expect(out.permit_area).toBe('A'.repeat(19))
    })
  })

  describe('recurring restrictions', () => {
    const base = { kind: 'street_cleaning', days: ['TU'], start: '07:00', end: '09:00', week_of_month: [], exceptions_text: '', label: 'Street cleaning Tue 7am-9am' }

    it('drops entries that cannot be scheduled', () => {
      const out = normalizeModelOutput(
        fullAnswer({
          recurring_restrictions: [
            { ...base, days: [] },
            { ...base, days: ['TUE'] },
            { ...base, start: '7am' },
            { ...base, end: '25:00' },
            { ...base, start: '09:00', end: '09:00' },
            'not an object',
            base,
          ],
        }),
      )
      expect(out.recurring_restrictions).toEqual([base])
    })

    it('keeps an all-day restriction written as 00:00 to 24:00, ending at 23:59', () => {
      const allDay = { ...base, kind: 'no_stopping', days: ['SU'], start: '00:00', end: '24:00', label: 'No Stopping Sunday' }
      const [r] = normalizeModelOutput(fullAnswer({ recurring_restrictions: [allDay] })).recurring_restrictions
      expect(r).toEqual({ ...allDay, end: '23:59' })
      // 'H:MM' and an evening-to-end-of-day window too.
      expect(normalizeModelOutput(fullAnswer({ recurring_restrictions: [{ ...base, start: '0:00', end: '24:00' }] })).recurring_restrictions).toHaveLength(1)
      const [late] = normalizeModelOutput(fullAnswer({ recurring_restrictions: [{ ...base, start: '22:00', end: '24:00' }] })).recurring_restrictions
      expect([late.start, late.end]).toEqual(['22:00', '23:59'])
      // As a start time, 24:00 is midnight.
      const [overnight] = normalizeModelOutput(fullAnswer({ recurring_restrictions: [{ ...base, start: '24:00', end: '06:00' }] }))
        .recurring_restrictions
      expect([overnight.start, overnight.end]).toEqual(['00:00', '06:00'])
    })

    it('keeps weeks 1 to 5 only, sorted and unique', () => {
      const [r] = normalizeModelOutput(fullAnswer({ recurring_restrictions: [{ ...base, week_of_month: [3, 0, 1, 3, 6, 2.5, '2'] }] }))
        .recurring_restrictions
      expect(r.week_of_month).toEqual([1, 3])
    })

    it('lists a restriction repeated on two plates once', () => {
      const out = normalizeModelOutput(fullAnswer({ recurring_restrictions: [base, { ...base, label: 'Same, other plate' }] }))
      expect(out.recurring_restrictions).toEqual([base])
    })

    it('becomes [] when the field is missing or not a list', () => {
      expect(normalizeModelOutput(fullAnswer({ recurring_restrictions: undefined })).recurring_restrictions).toEqual([])
      expect(normalizeModelOutput(fullAnswer({ recurring_restrictions: base })).recurring_restrictions).toEqual([])
    })

    it('answers only restrictions the app keeps as they are: the one check, readRecurringRestrictions (polish list)', () => {
      const out = normalizeModelOutput(
        fullAnswer({
          recurring_restrictions: [
            { ...base, start: '7:00', end: '24:00', week_of_month: [3, 1] },
            { ...base, kind: 'parade', days: ['SA', 'MO'] },
            { ...base, week_of_month: 'first' },
            { ...base, end: '07:00' },
          ],
        }),
      ).recurring_restrictions
      expect(out).toEqual([
        { ...base, start: '07:00', end: '23:59', week_of_month: [1, 3] },
        { ...base, kind: 'other', days: ['MO', 'SA'] },
      ])
      expect(readRecurringRestrictions(out)).toEqual(out)
    })
  })

  describe('sign notes in plain characters', () => {
    it('writes arrows as ASCII and drops other symbols, so every PDF font can draw them', () => {
      const out = normalizeModelOutput(
        fullAnswer({
          sign_status: 'partially_obscured',
          sign_issues: ['\u2192 plate faded', '\u2190 arrow: 2P cut off \u26A0\uFE0F', '\u2194 both plates \u2713 read', '\u{1F697} car blocks the bottom'],
        }),
      )
      expect(out.sign_issues).toEqual(['-> plate faded', '<- arrow: 2P cut off', '<-> both plates read', 'car blocks the bottom'])
      expect(out.sign_issues.every((n) => isWinAnsi(n))).toBe(true)
    })

    it('drops a note that was only symbols, and cleans recorded notes in refresh mode', () => {
      expect(normalizeModelOutput(fullAnswer({ sign_status: 'contradictory', sign_issues: ['\u26A0', 'Plates disagree'] })).sign_issues).toEqual([
        'Plates disagree',
      ])
      const out = normalizeModelOutput(fullAnswer(), {
        refresh: { sign_status: 'partially_obscured', sign_issues: ['\u2192 plate faded'], is_area_sign: null },
      })
      expect(out.sign_issues).toEqual(['-> plate faded'])
    })

    it('writes comparison signs as ASCII and drops other maths signs the en, it and id fonts lack (polish list)', () => {
      expect(plainNoteText('Limit ≤ 2P')).toBe('Limit <= 2P')
      expect(plainNoteText('≥ 1 hour, ≈ 50 m away')).toBe('>= 1 hour, ~ 50 m away')
      expect(plainNoteText('Left plate ≠ right plate')).toBe('Left plate != right plate')
      expect(plainNoteText('Hours 8−6, 2′ high')).toBe("Hours 8-6, 2' high")
      expect(plainNoteText('Sum ∑ and ∞ and ⨀ and ⟂ gone')).toBe('Sum and and and gone')
      const notes = [
        '≤≥≠≈≦≧⩽⩾≃≅∼−‐‑‒―∕⁄∗′″‴',
        'a ∀∃∈∑√∞∫∴⋅⋯⟀⟨⦀⧿⨀⫿ b',
      ].map(plainNoteText)
      for (const n of notes) expect(isWinAnsi(n), n).toBe(true)
      // Through the model answer too, so the signed notes are drawable.
      const out = normalizeModelOutput(fullAnswer({ sign_status: 'partially_obscured', sign_issues: ['Time limit ≤ 2P faded'] }))
      expect(out.sign_issues).toEqual(['Time limit <= 2P faded'])
      // WinAnsi signs that the fonts draw stay as they are.
      expect(plainNoteText('± 5 min, 2 × 1P, 90° – angle')).toBe('± 5 min, 2 × 1P, 90° – angle')
    })

    it('leaves letters of any script alone', () => {
      expect(plainNoteText('Bi\u1EC3n b\u00E1o m\u1EDD, \u6807\u5FD7\u6A21\u7CCA')).toBe('Bi\u1EC3n b\u00E1o m\u1EDD, \u6807\u5FD7\u6A21\u7CCA')
      expect(plainNoteText(3)).toBe('')
    })

    it('tells the model to write notes in plain words', () => {
      expect(SYSTEM_PROMPT).toMatch(/Plain words only: no arrow symbols, emoji or other symbols/)
    })
  })

  describe('permit exceptions (one entry per listed permit type)', () => {
    const exception = { applies: true, permit_type: 'resident', text: 'PERMIT ZONE AREA 25 EXCEPTED' }

    it('keeps an exception for a permit type the user listed', () => {
      expect(normalizeModelOutput(fullAnswer({ permit_exception: [exception] }), { user_permits: RESIDENT }).permit_exception).toEqual([exception])
    })

    it('reports every listed permit type the sign covers, not just the first', () => {
      // A sign printing "DISABLED PERMIT HOLDERS 4P" and "RESIDENT PERMITS EXCEPTED", with both permits saved.
      const out = normalizeModelOutput(
        fullAnswer({
          permit_exception: [
            { applies: true, permit_type: 'accessible', text: 'DISABLED PERMIT HOLDERS 4P' },
            { applies: true, permit_type: 'resident', text: 'RESIDENT PERMITS EXCEPTED' },
          ],
        }),
        { user_permits: [{ type: 'accessible', area: null }, { type: 'resident', area: 'Area 25' }] },
      )
      expect(out.permit_exception).toEqual([
        { applies: true, permit_type: 'accessible', text: 'DISABLED PERMIT HOLDERS 4P' },
        { applies: true, permit_type: 'resident', text: 'RESIDENT PERMITS EXCEPTED' },
      ])
    })

    it('has exactly one entry per listed type, in list order, filling in the ones the model left out', () => {
      const out = normalizeModelOutput(fullAnswer({ permit_exception: [exception] }), {
        user_permits: [
          { type: 'business', area: null },
          { type: 'resident', area: 'Area 25' },
          { type: 'business', area: 'Zone B' },
        ],
      })
      expect(out.permit_exception).toEqual([{ applies: false, permit_type: 'business', text: '' }, exception])
    })

    it('drops an entry for a permit type the user did not list', () => {
      const out = normalizeModelOutput(fullAnswer({ permit_exception: [exception] }), { user_permits: [{ type: 'accessible', area: null }] })
      expect(out.permit_exception).toEqual([{ applies: false, permit_type: 'accessible', text: '' }])
    })

    it('has no entries when no permits were listed', () => {
      expect(normalizeModelOutput(fullAnswer({ permit_exception: [exception] })).permit_exception).toEqual(NONE)
      expect(normalizeModelOutput(fullAnswer({ permit_exception: [exception] }), { user_permits: [] }).permit_exception).toEqual(NONE)
    })

    it('needs a quote from the sign', () => {
      const out = normalizeModelOutput(fullAnswer({ permit_exception: [{ ...exception, text: ch(0x202e) + '  ' }] }), { user_permits: RESIDENT })
      expect(out.permit_exception).toEqual(RESIDENT_NONE)
    })

    it('clears the text when applies is false', () => {
      const out = normalizeModelOutput(fullAnswer({ permit_exception: [{ ...exception, applies: false }] }), { user_permits: RESIDENT })
      expect(out.permit_exception).toEqual(RESIDENT_NONE)
    })

    it('reads a single object instead of a list as no exception rather than guessing', () => {
      const out = normalizeModelOutput(fullAnswer({ permit_exception: exception }), { user_permits: RESIDENT })
      expect(out.permit_exception).toEqual(RESIDENT_NONE)
    })
  })

  describe('variants', () => {
    it('fills missing per-variant fields with their defaults', () => {
      const out = normalizeModelOutput(
        fullAnswer({ clarification: { question: 'Where are you parked?', options: [{ label: 'Left side', rules: '1/4P', can_park_now: true }] } }),
      )
      expect(out.clarification.options).toEqual([
        {
          label: 'Left side',
          rules: '1/4P',
          observations: [],
          can_park_now: true,
          until: null,
          duration_minutes: null,
          requires_disabled_permit: false,
          is_permit_zone: false,
          permit_area: null,
          is_area_sign: false,
          permit_exception: NONE,
          next_transition: null,
        },
      ])
    })

    it('checks each variant\'s permit exception against the listed permits', () => {
      const out = normalizeModelOutput(
        fullAnswer({
          clarification: {
            question: 'Where are you parked?',
            options: [
              variant({ permit_exception: [{ applies: true, permit_type: 'resident', text: 'AREA 25 EXCEPTED' }] }),
              variant({ label: 'Right side', permit_exception: [{ applies: true, permit_type: 'business', text: 'TRADERS EXCEPTED' }] }),
            ],
          },
        }),
        { user_permits: RESIDENT },
      )
      expect(out.clarification.options[0].permit_exception).toEqual([{ applies: true, permit_type: 'resident', text: 'AREA 25 EXCEPTED' }])
      expect(out.clarification.options[1].permit_exception).toEqual(RESIDENT_NONE)
    })

    it('drops options without a label, and the clarification when none are left', () => {
      const some = normalizeModelOutput(fullAnswer({ clarification: { question: 'Where?', options: [variant({ label: ' ' }), 'x', variant()] } }))
      expect(some.clarification.options.map((o) => o.label)).toEqual(['Left side'])
      const none = normalizeModelOutput(fullAnswer({ clarification: { question: 'Where?', options: [variant({ label: '' })] } }))
      expect(none.clarification).toBeNull()
    })

    it('sets the top-level area flag when any position is under an area sign', () => {
      const out = normalizeModelOutput(
        fullAnswer({ is_area_sign: false, clarification: { question: 'Where?', options: [variant(), variant({ label: 'Right side', is_area_sign: true })] } }),
      )
      expect(out.is_area_sign).toBe(true)
    })

    it('rejects a variant with a malformed leave-by time', () => {
      expect(() =>
        normalizeModelOutput(fullAnswer({ clarification: { question: 'Where?', options: [variant({ until: 'tomorrow 10am' })] } })),
      ).toThrow('ERR_SIGN_UNREADABLE')
    })
  })

  describe('times', () => {
    it('rejects a leave-by time that is not a zoned ISO time, rather than dropping it', () => {
      for (const bad of ['tomorrow', '2026-11-09', '2026-11-09T12:00:00', '2026-13-40T12:00:00+11:00', 12]) {
        expect(() => normalizeModelOutput(fullAnswer({ until: bad })), String(bad)).toThrow('ERR_SIGN_UNREADABLE')
      }
      for (const good of ['2026-11-09T12:00:00+11:00', '2026-11-09T01:00:00Z', '2026-11-09T12:00+10:00', null]) {
        expect(normalizeModelOutput(fullAnswer({ until: good })).until).toBe(good)
      }
    })

    it('reads a blank leave-by time as null when null is all it can mean', () => {
      // The prompt says null when the car can't park; the model sometimes writes "".
      for (const blank of ['', '   ']) {
        const cannot = normalizeModelOutput(fullAnswer({ can_park_now: false, until: blank, duration_minutes: null }))
        expect(cannot.until).toBeNull()
        expect(cannot.can_park_now).toBe(false)
        // Can park with no limit at all (a permit zone): also null.
        expect(normalizeModelOutput(fullAnswer({ can_park_now: true, until: blank, duration_minutes: null })).until).toBeNull()
        // In a clarification option too, so one blank option doesn't fail the scan.
        const out = normalizeModelOutput(
          fullAnswer({ clarification: { question: 'Where?', options: [variant(), variant({ label: 'Right side', can_park_now: false, until: blank, duration_minutes: null })] } }),
        )
        expect(out.clarification.options[1].until).toBeNull()
      }
    })

    it('still rejects a blank leave-by time on an answer that has a time limit', () => {
      // "2P" with no end time would otherwise read as "no limit".
      expect(() => normalizeModelOutput(fullAnswer({ can_park_now: true, until: '', duration_minutes: 120 }))).toThrow('ERR_SIGN_UNREADABLE')
      expect(() =>
        normalizeModelOutput(fullAnswer({ clarification: { question: 'Where?', options: [variant({ until: ' ', duration_minutes: 15 })] } })),
      ).toThrow('ERR_SIGN_UNREADABLE')
    })

    it('drops a heads-up whose time is malformed', () => {
      expect(normalizeModelOutput(fullAnswer({ next_transition: { when: 'soon', change: 'Clearway begins' } })).next_transition).toBeNull()
      expect(normalizeModelOutput(fullAnswer({ next_transition: { when: '2026-11-09T16:30:00+11:00', change: ' ' } })).next_transition).toBeNull()
    })

    it('keeps only a usable duration', () => {
      expect(normalizeModelOutput(fullAnswer({ duration_minutes: -5 })).duration_minutes).toBeNull()
      expect(normalizeModelOutput(fullAnswer({ duration_minutes: '120' })).duration_minutes).toBeNull()
      expect(normalizeModelOutput(fullAnswer({ duration_minutes: 0 })).duration_minutes).toBe(0)
    })
  })

  describe('sign status rules', () => {
    it('clears sign_issues on a readable sign', () => {
      expect(normalizeModelOutput(fullAnswer({ sign_status: 'readable', sign_issues: ['Slight glare'] })).sign_issues).toEqual([])
    })

    it('keeps the most restrictive answer and the issues on a contradictory sign', () => {
      const answer = fullAnswer({
        sign_status: 'contradictory',
        sign_issues: ['Right arrow plates disagree: 2P and No Parking. Applied No Parking.'],
        can_park_now: false,
        until: null,
        duration_minutes: null,
      })
      expect(normalizeModelOutput(structuredClone(answer), { user_permits: RESIDENT })).toEqual(answer)
    })

    it.each(NO_READABLE_SIGN_STATUSES)('carries no reading at all when the status is %s', (status) => {
      const out = normalizeModelOutput(
        fullAnswer({
          sign_status: status,
          sign_issues: ['The photo shows a street with no sign in view'],
          rules: 'No sign visible',
          is_area_sign: true,
          payment_methods: ['meter'],
          requires_ticket: true,
          is_permit_zone: true,
          clarification: { question: 'Where?', options: [variant()] },
        }),
        { user_permits: RESIDENT },
      )
      expect(out).toEqual({
        sign_status: status,
        sign_issues: ['The photo shows a street with no sign in view'],
        rules: '',
        observations: [],
        can_park_now: false,
        until: null,
        duration_minutes: null,
        confidence: 'high',
        requires_ticket: false,
        payment_methods: null,
        requires_disabled_permit: false,
        is_permit_zone: false,
        permit_area: null,
        is_area_sign: false,
        permit_exception: RESIDENT_NONE,
        recurring_restrictions: [],
        next_transition: null,
        clarification: null,
      })
    })

    it.each(NO_READABLE_SIGN_STATUSES)('shows the %s screen even when the discarded fields carry a malformed time', (status) => {
      // These fields are thrown away for this status, so a bad time in them
      // must not turn the "no readable sign" screen into an error.
      const out = normalizeModelOutput(
        fullAnswer({
          sign_status: status,
          sign_issues: ['Speed limit sign'],
          until: 'n/a',
          clarification: { question: 'Where?', options: [variant({ until: 'later' })] },
        }),
      )
      expect(out.sign_status).toBe(status)
      expect(out.until).toBeNull()
      expect(out.clarification).toBeNull()
      expect(out.sign_issues).toEqual(['Speed limit sign'])
      // A readable answer with the same bad time still can't be trusted.
      expect(() => normalizeModelOutput(fullAnswer({ until: 'n/a' }))).toThrow('ERR_SIGN_UNREADABLE')
    })

    it('uses the recorded status in refresh mode, with its issues', () => {
      const out = normalizeModelOutput(fullAnswer({ sign_status: 'readable', is_area_sign: false }), {
        refresh: { sign_status: 'partially_obscured', sign_issues: ['Bottom plate faded'], is_area_sign: true },
      })
      expect(out.sign_status).toBe('partially_obscured')
      expect(out.sign_issues).toEqual(['Bottom plate faded'])
      expect(out.is_area_sign).toBe(true)
    })

    it('keeps the model\'s values in refresh mode when nothing was recorded', () => {
      const out = normalizeModelOutput(fullAnswer({ sign_status: 'readable', is_area_sign: true }), {
        refresh: { sign_status: null, sign_issues: [], is_area_sign: null },
      })
      expect(out.sign_status).toBe('readable')
      expect(out.is_area_sign).toBe(true)
    })

    it('re-checking a record saved before T3 never blanks the answer, whatever status the model gives (polish list)', () => {
      // The model was sent no photo and calls the sign missing, but the
      // re-check answers from the recorded rules.
      const answer = fullAnswer({
        can_park_now: true,
        requires_ticket: true,
        is_permit_zone: true,
        permit_area: '25',
      })
      for (const status of ['missing', 'not_a_parking_sign', 'partially_obscured', 'contradictory', 'nonsense']) {
        const out = normalizeModelOutput(
          { ...answer, sign_status: status, sign_issues: ['No photo was provided'] },
          { refresh: { sign_status: null, sign_issues: [], is_area_sign: null } },
        )
        expect(out.sign_status, status).toBe('readable')
        expect(out.sign_issues, status).toEqual([])
        expect(out.can_park_now, status).toBe(true)
        expect(out.until, status).toBe(answer.until)
        expect(out.rules, status).toBe(answer.rules)
        expect(out.requires_ticket, status).toBe(true)
        expect(out.is_permit_zone, status).toBe(true)
        expect(out.permit_area, status).toBe('25')
      }
      // A recorded status is still echoed as recorded.
      const recorded = normalizeModelOutput(
        { ...answer, sign_status: 'missing' },
        { refresh: { sign_status: 'contradictory', sign_issues: ['Plates disagree'], is_area_sign: null } },
      )
      expect(recorded.sign_status).toBe('contradictory')
      expect(recorded.sign_issues).toEqual(['Plates disagree'])
      expect(recorded.can_park_now).toBe(true)
    })
  })

  it('exposes the enums the schema uses', () => {
    expect(WEEKDAYS).toEqual(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'])
    expect(USER_PERMIT_TYPES).toEqual(['accessible', 'resident', 'business'])
  })
})
