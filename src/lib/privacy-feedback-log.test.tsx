// @vitest-environment happy-dom
//
// The privacy policy's line on the "Did we read this right?" log
// (privacy.anonymousCloudwatch, fix round 2), held to the code end to end:
// what the result screen sends, what the Lambda keeps of it in its
// [parkproof.feedback] log line, and what the policy says in 9 languages.
// The policy used to say that only a random ID and a correct/retake verdict
// were logged, "No PII", while the line also held the start of the sign's
// rules text, the hour at the sign, the sign's permit area and the driver's
// answer to the accessible parking permit question.
//
// Adding or dropping a logged field fails the first test: change the
// policy text in all 9 locales (scripts/_i18n_inject_fixlist_final.mjs)
// and POLICY below together, then PRIVACY_LAST_UPDATED.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import en from '../locales/en.json'
import zhCN from '../locales/zh-CN.json'
import vi_ from '../locales/vi.json'
import id from '../locales/id.json'
import ko from '../locales/ko.json'
import it_ from '../locales/it.json'
import el from '../locales/el.json'
import hi from '../locales/hi.json'
import pa from '../locales/pa.json'
import { handler } from '../../lambda/index.js'
import retentionScript from '../../scripts/setup-log-retention.sh?raw'
import ParkingResult from '../components/ParkingResult'
import type { ParkingRules } from '../types'
import i18n from './i18n'

/** The Lambda log group's retention, as scripts/setup-log-retention.sh sets it. */
const LOG_RETENTION_DAYS = Number(/^RETENTION_DAYS=(\d+)$/m.exec(retentionScript)?.[1])
/** How much of the reading's rules text the log keeps (client and server both cut it here). */
const RULES_EXCERPT_CHARS = 120

/**
 * Every field of the [parkproof.feedback] line, with the words the English
 * policy uses for it. The other 8 locales say the same (T10 reads them).
 */
const POLICY: Record<string, string> = {
  verdict: 'logs your answer',
  timestamp: 'with when you gave it',
  feedback_id: 'a random ID for that answer',
  rules_excerpt: `the first ${RULES_EXCERPT_CHARS} characters of its description of the sign's rules`,
  confidence: 'how sure it was',
  duration_minutes: 'the time limit',
  payment_methods: 'any payment methods',
  permit_area: 'permit area',
  had_clarification: 'whether it asked where you parked',
  chosen_label: 'the option you picked',
  observations_count: 'how many groups of rules',
  sign_issues_count: 'reading problems',
  recurring_restrictions_count: 'weekly restrictions it found',
  sign_status: 'whether the sign was readable',
  is_refresh: 'whether the reading was a re-check',
  is_area_sign: 'an area sign',
  requires_ticket: 'paid parking',
  is_permit_zone: 'a permit zone',
  requires_disabled_permit: 'an accessible parking bay',
  scanned_hour_local: 'the hour of day where the sign is',
  ticket_acknowledged: 'Your answers so far to the paid parking',
  permit_zone_acknowledged: 'permit zone and accessible parking permit questions',
  disabled_permit_acknowledged: 'you said an accessible parking permit was displayed',
}

const LOCALES: Record<string, { privacy: { anonymousCloudwatch: string } }> = {
  en,
  'zh-CN': zhCN,
  vi: vi_,
  id,
  ko,
  it: it_,
  el,
  hi,
  pa,
}

const MELBOURNE = { lat: -37.8136, lng: 144.9631 }
const LONG_RULES = `2P 8am-6pm Mon-Fri; Permit Zone Area 25; Meter; ${'and more words on the sign '.repeat(10)}`

/** A reading that sets every flag and count the log can carry. */
const RESULT: ParkingRules = {
  rules: LONG_RULES,
  observations: [
    { scope: 'Right arrow', items: ['2P', 'Mon-Fri 8am-6pm'] },
    { scope: 'Whole sign', items: ['Permit Zone Area 25'] },
  ],
  can_park_now: true,
  until: '2026-11-09T18:00:00+11:00',
  duration_minutes: 120,
  confidence: 'medium',
  clarification: null,
  chosen_label: 'Right side',
  alternate_variants: [
    {
      label: 'Left side',
      rules: 'No stopping',
      observations: [{ scope: 'Left arrow', items: ['No stopping'] }],
      can_park_now: false,
      until: null,
      duration_minutes: null,
    },
  ],
  requires_ticket: true,
  payment_methods: ['meter'],
  requires_disabled_permit: true,
  is_permit_zone: true,
  permit_area: '25',
  sign_status: 'readable',
  sign_issues: [],
  is_area_sign: false,
  recurring_restrictions: [
    {
      kind: 'street_cleaning',
      days: ['TU'],
      start: '07:00',
      end: '09:00',
      week_of_month: [],
      exceptions_text: '',
      label: 'Street cleaning',
    },
  ],
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response('{}'))
let logSpy: MockInstance<typeof console.log>

beforeAll(async () => {
  await i18n.changeLanguage('en')
})
beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  logSpy.mockRestore()
})

/** The body the result screen sent to /feedback. */
function sentBody(): Record<string, unknown> {
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/feedback'))
  expect(calls).toHaveLength(1)
  return JSON.parse(String(calls[0][1]?.body)) as Record<string, unknown>
}

/** Run a /feedback body through the real Lambda; the log line it wrote. */
async function logLine(body: Record<string, unknown>): Promise<{ raw: string; logged: Record<string, unknown> }> {
  logSpy.mockClear()
  const res = await handler({
    requestContext: { http: { method: 'POST', path: '/feedback' } },
    body: JSON.stringify(body),
  })
  expect(res.statusCode).toBe(204)
  const raw = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[parkproof.feedback] '))
  expect(raw).toBeDefined()
  return { raw: raw!, logged: JSON.parse(raw!.slice('[parkproof.feedback] '.length)) as Record<string, unknown> }
}

describe('the feedback log holds what the privacy policy says, no more and no less', () => {
  it('a tap on "Yes, looks right" logs exactly the fields the policy names', async () => {
    render(
      <ParkingResult
        result={RESULT}
        signPhoto="data:image/jpeg;base64,AAAA"
        coords={MELBOURNE}
        onScanAnother={vi.fn()}
        onLogSession={vi.fn()}
        onRetake={vi.fn()}
      />,
    )
    // The driver answers the accessible parking permit question, then the
    // verification card.
    fireEvent.click(screen.getByRole('checkbox', { name: i18n.t('result.permitRequired.ack') }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('result.verifyYes') }))

    const { raw, logged } = await logLine(sentBody())
    expect(Object.keys(logged).sort()).toEqual(Object.keys(POLICY).sort())
    // The answer the policy warns about is really there.
    expect(logged.requires_disabled_permit).toBe(true)
    expect(logged.disabled_permit_acknowledged).toBe(true)
    expect(logged.ticket_acknowledged).toBe(false)
    expect(logged.permit_area).toBe('25')
    expect(logged.rules_excerpt).toBe(LONG_RULES.slice(0, RULES_EXCERPT_CHARS))
    // Nothing of the photo or the coordinates.
    expect(raw).not.toContain('AAAA')
    expect(raw).not.toContain(String(MELBOURNE.lat))
    expect(raw).not.toContain(String(MELBOURNE.lng))
  })

  it('drops whatever else a client sends: coordinates, ids, permit types, no_sign', async () => {
    const { raw, logged } = await logLine({
      verdict: 'retake',
      feedback_id: 'fb-privacy',
      context: {
        rules_excerpt: 'x'.repeat(300),
        no_sign: true,
        lat: -37.8136,
        lng: 144.9631,
        device_id: 'device-123',
        user_id: 'user-123',
        email: 'driver@example.com',
        user_permits: [{ type: 'accessible', area: 'Area 25' }],
        permit_type: 'accessible',
      },
    })
    expect(Object.keys(logged).filter((k) => !(k in POLICY))).toEqual([])
    expect(logged.rules_excerpt).toBe('x'.repeat(RULES_EXCERPT_CHARS))
    for (const leak of ['-37.8136', '144.9631', 'device-123', 'user-123', 'driver@example.com', 'accessible', 'no_sign']) {
      expect(raw).not.toContain(leak)
    }
  })
})

describe('privacy.anonymousCloudwatch', () => {
  it('in English, names every logged field and what is left out', () => {
    const text = en.privacy.anonymousCloudwatch
    for (const [field, words] of Object.entries(POLICY)) {
      expect(text, `the policy should name ${field}`).toContain(words)
    }
    expect(text).toContain("The log doesn't include the photo, its GPS location, or an ID for you or this device.")
    expect(text).toContain(`It's deleted after ${LOG_RETENTION_DAYS} days.`)
  })

  it.each(Object.keys(LOCALES))(
    '%s names the excerpt length and the log retention, and makes no "no personal data" claim',
    (locale) => {
      const text = LOCALES[locale].privacy.anonymousCloudwatch
      const numbers = [...new Set((text.match(/\d+/g) ?? []).map(Number))].sort((a, b) => a - b)
      expect(numbers).toEqual([LOG_RETENTION_DAYS, RULES_EXCERPT_CHARS].sort((a, b) => a - b))
      // The old line's claims, in the words each locale used for them.
      expect(text).not.toMatch(/PII|UUID|个人身份信息|nhận dạng cá nhân|dato personale|dati personali|προσωπικό δεδομένο/)
    },
  )
})
