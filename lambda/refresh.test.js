// @vitest-environment node
//
// Lambda refresh-mode reasoning — text-only path.
//
// We mock the Anthropic SDK and test the CONTRACT around the model call:
//
//   1. System prompt content (catches regressions in shipped prompt fixes —
//      e.g. someone refactoring SYSTEM_PROMPT and accidentally deleting the
//      EasyPark or ♿-permit instructions).
//   2. Request shape (model, thinking config, JSON-schema enforcement,
//      cache_control on the system prompt).
//   3. Refresh-mode branching (prior_rules + no image_base64 → text-only
//      user message, no image block).
//   4. Response parsing (text block → JSON, max_tokens / refusal / parse
//      failures all raise actionable errors).
//
// What this DOESN'T test: the model's actual reasoning. That's the live
// site's job — real users on real signs are the integration test. What
// this catches is regressions in the wiring around the model call.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted lifts these above the vi.mock factory hoisting, so they're
// in scope when the mock is created.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))

// The lambda does `new Anthropic({apiKey})` — the default export needs to
// be a real constructable. vi.fn().mockImplementation(arrow) doesn't work
// here because the arrow function inside isn't constructable. Use a class.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {
      this.messages = { create: mockCreate }
    }
  },
}))

// Import AFTER the mock is in place.
const { translateSign } = await import('./index.js')

/**
 * Build a valid mock Anthropic response. The lambda parses
 * response.content.find(b => b.type === 'text').text as JSON, so we wrap
 * the desired ParkingRules in that shape.
 */
function mockResponse(partial = {}, opts = {}) {
  const full = {
    rules: 'mock rules',
    observations: [{ scope: 'Whole sign', items: ['mock'] }],
    can_park_now: true,
    until: null,
    duration_minutes: null,
    confidence: 'high',
    clarification: null,
    requires_ticket: false,
    payment_methods: null,
    requires_disabled_permit: false,
    ...partial,
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(full) }],
    stop_reason: opts.stop_reason ?? 'end_turn',
    usage: { input_tokens: 100, output_tokens: 100 },
  }
}

/**
 * Minimum-viable refresh-mode call args. Tests override individual fields.
 */
function refreshCall(overrides = {}) {
  return translateSign({
    prior_rules: '2P Mon-Fri 8am-6pm',
    prior_observations: [{ scope: 'Whole sign', items: ['2P', 'Mon-Fri 8am-6pm'] }],
    lat: -37.8136,
    lng: 144.9631,
    current_datetime: '2026-05-21T10:00:00+10:00',
    ...overrides,
  })
}

beforeEach(() => {
  mockCreate.mockReset()
  // API key check happens before the mock is called.
  process.env.ANTHROPIC_API_KEY = 'test-sk-mock'
})

// ─── System prompt content (regression tests for shipped prompt fixes) ─────
describe('system prompt — regression tests for shipped prompt fixes', () => {
  it('includes the EasyPark / payment-method instruction (regression for a2b2b4f)', async () => {
    mockCreate.mockResolvedValue(mockResponse())
    await refreshCall()
    const call = mockCreate.mock.calls[0][0]
    const systemText = Array.isArray(call.system)
      ? call.system.map((s) => s.text).join('\n')
      : call.system
    expect(systemText).toMatch(/EasyPark/i)
    expect(systemText).toMatch(/PayStay/i)
    // The "regardless of paid window" copy is the heart of the fix — without
    // it, the model nulls payment_methods on after-hours metered scans.
    expect(systemText).toMatch(/regardless of whether the current time is inside the paid window/i)
    // And the explicit "look BELOW or BESIDE the main pole" guidance.
    expect(systemText).toMatch(/BELOW or BESIDE/i)
  })

  it('includes the ♿-permit-is-orthogonal-to-can_park_now instruction (regression for d9437fa)', async () => {
    mockCreate.mockResolvedValue(mockResponse())
    await refreshCall()
    const call = mockCreate.mock.calls[0][0]
    const systemText = Array.isArray(call.system)
      ? call.system.map((s) => s.text).join('\n')
      : call.system
    expect(systemText).toMatch(/ORTHOGONAL to can_park_now/i)
    expect(systemText).toMatch(/Disability-permit.*are NOT prohibitions/i)
    // Worked example: ♿-only inside its window should set both flags
    expect(systemText).toMatch(/can_park_now=TRUE/i)
  })

  it('keeps the JSON-schema-enforced output config + adaptive thinking', async () => {
    mockCreate.mockResolvedValue(mockResponse())
    await refreshCall()
    const call = mockCreate.mock.calls[0][0]
    expect(call.thinking).toEqual({ type: 'adaptive' })
    expect(call.output_config?.format?.type).toBe('json_schema')
    expect(call.output_config?.format?.schema).toBeDefined()
    expect(call.output_config?.effort).toBe('low')
  })

  it('targets claude-sonnet-4-6 (Haiku 4.5 broke stacked-sign math — do not downgrade)', async () => {
    mockCreate.mockResolvedValue(mockResponse())
    await refreshCall()
    expect(mockCreate.mock.calls[0][0].model).toBe('claude-sonnet-4-6')
  })

  it('applies cache_control on the system prompt (prompt > 2048 tokens uses ephemeral cache)', async () => {
    mockCreate.mockResolvedValue(mockResponse())
    await refreshCall()
    const call = mockCreate.mock.calls[0][0]
    expect(Array.isArray(call.system)).toBe(true)
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' })
  })
})

// ─── Refresh-mode branching ─────────────────────────────────────────────────
describe('refresh-mode branching (prior_rules → text-only)', () => {
  it('omits the image block when refresh mode is active', async () => {
    mockCreate.mockResolvedValue(mockResponse())
    await refreshCall()
    const userContent = mockCreate.mock.calls[0][0].messages[0].content
    expect(Array.isArray(userContent)).toBe(true)
    const hasImageBlock = userContent.some((c) => c.type === 'image')
    expect(hasImageBlock).toBe(false)
  })

  it('user message is a single text block in refresh mode', async () => {
    mockCreate.mockResolvedValue(mockResponse())
    await refreshCall()
    const userContent = mockCreate.mock.calls[0][0].messages[0].content
    expect(userContent.length).toBe(1)
    expect(userContent[0].type).toBe('text')
  })

  it('user-text labels itself as a REFRESH request so the model does not re-read a sign', async () => {
    mockCreate.mockResolvedValue(mockResponse())
    await refreshCall()
    const text = mockCreate.mock.calls[0][0].messages[0].content[0].text
    expect(text).toMatch(/REFRESH/i)
  })

  it('embeds prior_rules + prior_observations + prior_chosen_label in the user text', async () => {
    mockCreate.mockResolvedValue(mockResponse())
    await refreshCall({
      prior_rules: 'Permit Zone Sat-Sun; 2P Mon-Fri 8am-6pm',
      prior_observations: [{ scope: '→ Right arrow', items: ['2P', 'Permit Zone'] }],
      prior_chosen_label: 'Right side',
    })
    const text = mockCreate.mock.calls[0][0].messages[0].content[0].text
    expect(text).toContain('Permit Zone Sat-Sun; 2P Mon-Fri 8am-6pm')
    expect(text).toContain('Right arrow')
    expect(text).toContain('Right side')
  })

  it('passes current_datetime through to the user message (used as "now")', async () => {
    mockCreate.mockResolvedValue(mockResponse())
    await refreshCall({ current_datetime: '2026-05-21T15:30:00+10:00' })
    const text = mockCreate.mock.calls[0][0].messages[0].content[0].text
    expect(text).toContain('2026-05-21T15:30:00+10:00')
  })

  it('uses the spot timezone resolved from lat/lng', async () => {
    mockCreate.mockResolvedValue(mockResponse())
    // Melbourne CBD → Australia/Melbourne via tz-lookup
    await refreshCall({ lat: -37.8136, lng: 144.9631 })
    const text = mockCreate.mock.calls[0][0].messages[0].content[0].text
    expect(text).toContain('Australia/Melbourne')
  })
})

// ─── Response handling ──────────────────────────────────────────────────────
describe('response handling', () => {
  it('returns the parsed ParkingRules shape verbatim', async () => {
    mockCreate.mockResolvedValue(
      mockResponse({
        can_park_now: true,
        until: '2026-05-21T12:30:00+10:00',
        duration_minutes: 120,
        requires_disabled_permit: true,
        rules: 'echoed back unchanged',
      }),
    )
    const result = await refreshCall()
    expect(result.can_park_now).toBe(true)
    expect(result.until).toBe('2026-05-21T12:30:00+10:00')
    expect(result.duration_minutes).toBe(120)
    expect(result.requires_disabled_permit).toBe(true)
    expect(result.rules).toBe('echoed back unchanged')
  })

  it('preserves payment_methods array when the model surfaces it', async () => {
    mockCreate.mockResolvedValue(
      mockResponse({ requires_ticket: true, payment_methods: ['meter', 'easypark'] }),
    )
    const result = await refreshCall()
    expect(result.payment_methods).toEqual(['meter', 'easypark'])
  })

  it('preserves clarification when the model returns variants', async () => {
    mockCreate.mockResolvedValue(
      mockResponse({
        clarification: {
          question: 'Where are you parked?',
          options: [
            {
              label: 'Left side',
              rules: '1/4P',
              observations: [],
              can_park_now: true,
              until: null,
              duration_minutes: 15,
            },
          ],
        },
      }),
    )
    const result = await refreshCall()
    expect(result.clarification?.options.length).toBe(1)
    expect(result.clarification?.options[0].label).toBe('Left side')
  })
})

// ─── Error handling ─────────────────────────────────────────────────────────
describe('error handling', () => {
  it('throws when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY
    await expect(refreshCall()).rejects.toThrow(/ANTHROPIC_API_KEY/)
  })

  it('throws when neither image_base64 nor prior_rules is supplied', async () => {
    await expect(
      translateSign({ lat: -37.81, lng: 144.96 }),
    ).rejects.toThrow(/image_base64 is required/i)
  })

  it('throws an actionable error on stop_reason=max_tokens (truncated JSON)', async () => {
    mockCreate.mockResolvedValue(mockResponse({}, { stop_reason: 'max_tokens' }))
    await expect(refreshCall()).rejects.toThrow(/token limit|clearer|tighter/i)
  })

  it('throws an actionable error on stop_reason=refusal', async () => {
    mockCreate.mockResolvedValue(mockResponse({}, { stop_reason: 'refusal' }))
    await expect(refreshCall()).rejects.toThrow(/declined|different photo/i)
  })

  it('throws when the model returns no text content', async () => {
    mockCreate.mockResolvedValue({
      content: [], // no text block
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 0 },
    })
    await expect(refreshCall()).rejects.toThrow(/no text content/i)
  })

  it('throws on malformed JSON in the response text', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{not valid json' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    })
    await expect(refreshCall()).rejects.toThrow(/malformed JSON/i)
  })
})
