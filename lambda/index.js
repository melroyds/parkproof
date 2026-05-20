import Anthropic from '@anthropic-ai/sdk'
import { KMSClient, SignCommand } from '@aws-sdk/client-kms'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb'
import crypto from 'node:crypto'
import tzlookup from 'tz-lookup'
import {
  handleMeDelete,
  handleMeExport,
  handlePhotosPresign,
  handleSessionsDelete,
  handleSessionsList,
  handleSessionsUpload,
} from './cloud-sync.js'

const MODEL = 'claude-sonnet-4-6'
const DEFAULT_TIMEZONE = 'Australia/Melbourne'
const REGION = process.env.AWS_REGION || 'ap-southeast-2'
const JOBS_TABLE = process.env.JOBS_TABLE || 'parkproof-jobs'
const SELF_FUNCTION_NAME =
  process.env.AWS_LAMBDA_FUNCTION_NAME || 'parkproof-sign-translator'

// ─── Async-job plumbing ───────────────────────────────────────────────────
// API Gateway HTTP APIs cap at 30 seconds. Claude vision on stacked
// multi-variant Melbourne signs can take 30–50s. Rather than block the
// HTTP request for that long, the slow handlers (sign-translate /
// draft-appeal) now use a fire-and-poll pattern:
//
//   1. POST /sign-translate  →  generate job_id, write DDB row
//                              (status=pending), async-invoke self with
//                              the work payload, return 202 + job_id
//   2. (background)          →  Lambda invocation runs Claude, writes
//                              the result back to DDB
//   3. GET /sign-translate/status/{id}  →  read DDB row, return
//                              {status, result?, error?}
//   4. Client polls #3 every 1.5s until status != 'pending'
//
// DynamoDB TTL purges rows 10 minutes after creation, so the table never
// grows. The polling endpoint is fast (single GetItem ≈ 50ms) — overhead
// vs a synchronous call is negligible.
let _lambdaClient = null
function lambdaClient() {
  if (!_lambdaClient) _lambdaClient = new LambdaClient({ region: REGION })
  return _lambdaClient
}

let _jobsDdb = null
function jobsDdb() {
  if (!_jobsDdb) {
    _jobsDdb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
      marshallOptions: { removeUndefinedValues: true },
    })
  }
  return _jobsDdb
}

const JOB_TTL_SECONDS = 600 // 10 minutes

async function putJob(job_id, fields) {
  await jobsDdb().send(
    new PutCommand({
      TableName: JOBS_TABLE,
      Item: {
        job_id,
        ttl: Math.floor(Date.now() / 1000) + JOB_TTL_SECONDS,
        ...fields,
      },
    }),
  )
}

async function getJob(job_id) {
  const resp = await jobsDdb().send(
    new GetCommand({ TableName: JOBS_TABLE, Key: { job_id } }),
  )
  return resp.Item || null
}

/**
 * Async-invoke ourselves with the given internal payload. The payload's
 * `_async_kind` marker is what the handler uses to recognise the call as
 * "do the work + write to DDB" instead of "respond to an HTTP request."
 */
async function asyncSelfInvoke(payload) {
  await lambdaClient().send(
    new InvokeCommand({
      FunctionName: SELF_FUNCTION_NAME,
      InvocationType: 'Event', // fire-and-forget; Lambda returns immediately
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  )
}

// ─── Appeal-letter drafter ────────────────────────────────────────────────
const APPEAL_SYSTEM_PROMPT = `You are an Australian parking-law assistant. The user received a parking infringement notice and wants a draft appeal letter to send to the issuing council.

You will be given:
- A photo of the infringement notice (read it carefully)
- The user's previously-saved evidence of the parking session: sign rules, observations from the sign, GPS coordinates, address, and arrival timestamp

Return a JSON object with these fields:
- ticket_summary: ONE short sentence describing what you read from the notice (e.g. "Infringement notice #12345 from City of Yarra dated 14 May 2026, $99, for overstaying 2P parking on Lygon St"). If you cannot read the notice clearly, say so honestly.
- appeal_subject: a short subject line like "Appeal — Infringement Notice [number]"
- appeal_letter: the full body of the letter as plain text, with double newlines between paragraphs. Use formal Australian English. Cite the user's specific evidence (timestamp, GPS address, what the sign actually said) where it supports the appeal. Address it to the issuing council if known. Sign off with "Yours sincerely," followed by a literal placeholder "[Your full name]" on the next line. Do NOT include the user's address or contact details — they'll add those themselves.
- evidence_strength: "strong", "moderate", or "weak" — your honest assessment of whether the user's evidence actually contradicts the offence. Don't oversell — councils respect calibrated arguments.
- notes: 1-2 sentences explaining your strategy and what evidence you leaned on, OR (if evidence is weak) what specifically the user could try to find to strengthen the case.

Letter construction principles:
- Be factual and concise. Councils receive thousands of appeals; clarity beats verbosity.
- Anchor every claim to specific evidence ("at 9:43 PM on Wednesday 14 May", "the sign clearly states '2P Mon–Fri 8am–6pm'", "GPS-verified location at 175 Lygon St, Carlton").
- Avoid emotional language ("unfair", "ridiculous"). Stick to facts.
- Acknowledge the council's role respectfully even when contesting.
- If the evidence is weak, write a request for consideration of mitigating circumstances rather than a forceful denial.
- Don't fabricate facts not present in the evidence. If something is unclear from the user's data (e.g. you can't tell if they had a permit), don't invent it.`

const APPEAL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    ticket_summary: { type: 'string' },
    appeal_subject: { type: 'string' },
    appeal_letter: { type: 'string' },
    evidence_strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
    notes: { type: 'string' },
  },
  required: ['ticket_summary', 'appeal_subject', 'appeal_letter', 'evidence_strength', 'notes'],
  additionalProperties: false,
}

function formatObservationsForAppeal(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return '(none recorded)'
  return groups
    .map((g) => {
      const items = (g.items || []).map((i) => `    • ${i}`).join('\n')
      return `  ${g.scope}:\n${items}`
    })
    .join('\n')
}

async function handleDraftAppeal(event) {
  const t0 = Date.now()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured')

  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {}
  const {
    ticket_image_base64,
    ticket_media_type = 'image/jpeg',
    session,
  } = body

  if (!ticket_image_base64) throw new Error('ticket_image_base64 is required')
  if (!session || typeof session !== 'object') throw new Error('session is required')

  const evidenceText = [
    `Sign rules (what the parking sign said): ${session.rules ?? '(not recorded)'}`,
    '',
    `Observations from the sign:`,
    formatObservationsForAppeal(session.observations),
    '',
    session.chosen_label
      ? `Side / variant the user selected: ${session.chosen_label}`
      : '',
    `Arrival timestamp: ${session.arrived_at ?? '(not recorded)'}`,
    session.expires_at ? `Parking was due to expire at: ${session.expires_at}` : '',
    session.location?.address
      ? `Address: ${session.location.address}`
      : '',
    session.location
      ? `GPS coordinates: ${session.location.lat}, ${session.location.lng}`
      : '',
    `AI confidence at original scan: ${session.confidence ?? 'unknown'}`,
  ]
    .filter(Boolean)
    .join('\n')

  const client = new Anthropic({ apiKey })
  const t1 = Date.now()
  console.log(
    `[parkproof] appeal_preflight=${t1 - t0}ms model=${MODEL} ticket_b64_len=${ticket_image_base64.length}`,
  )

  const response = await client.messages.create({
    model: MODEL,
    // No adaptive thinking. Letter generation is creative composition, not
    // multi-step reasoning. With thinking enabled we hit 50+ seconds and the
    // API Gateway 30-second timeout returned 503. Skipping thinking drops the
    // call to ~10-20s while keeping Sonnet's writing quality.
    max_tokens: 4096,
    system: APPEAL_SYSTEM_PROMPT,
    output_config: {
      format: { type: 'json_schema', schema: APPEAL_RESPONSE_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: ticket_media_type, data: ticket_image_base64 },
          },
          {
            type: 'text',
            text: `Please read the infringement notice in the attached photo and draft a concise appeal letter (target 250-400 words for the letter body) using the following parking-session evidence:\n\n${evidenceText}`,
          },
        ],
      },
    ],
  })
  const t2 = Date.now()
  console.log(
    `[parkproof] appeal_call=${t2 - t1}ms stop=${response.stop_reason} usage=${JSON.stringify(response.usage)}`,
  )

  if (response.stop_reason === 'max_tokens') {
    throw new Error('The model hit the token limit before finishing — try a clearer photo of the ticket.')
  }
  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to draft an appeal for this image.')
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || !textBlock.text) throw new Error('Model returned no text content')

  try {
    return JSON.parse(textBlock.text)
  } catch (parseErr) {
    console.error('Appeal JSON parse failed. Raw text:', textBlock.text)
    throw new Error(`Model returned malformed JSON: ${parseErr.message}`)
  }
}

const SYSTEM_PROMPT = `You are an Australian parking sign interpreter. The user has uploaded a photo of one or more parking signs at a single location.

Analyze the sign(s) and return a JSON object with these fields:
- rules: string — A short FACTUAL description of what the sign says. List the sign's restrictions only, joined with '; ' or '. ' between distinct sub-conditions. Do NOT include any current-time conclusion such as 'currently outside hours', 'free now', 'must leave by …', 'you can park for X hours'. Those are captured separately in 'can_park_now' / 'until' / 'duration_minutes' and rendered by the app on its own. e.g. CORRECT: "2P Mon–Fri 8am–6pm; Permit Zone Sat–Sun 8am–11pm". WRONG: "2P Mon–Fri 8am–6pm. Currently outside hours — free until 10am Friday".
- observations: array of observation GROUPS. Each group is { scope: string, items: string[] }.
  - 'scope' names which part of the sign the items refer to. Use one of: "← Left arrow", "→ Right arrow", "↑ Up arrow", "↓ Down arrow", "↔ Both directions", "Bay [N]", "Whole sign".
  - 'items' are 2 to 4 short factual bullets in sign-style clipped phrasing — e.g. "2P", "Mon–Fri 8am–6pm", "Permit Zone", "Sat–Sun 8am–11pm". Do NOT repeat arrow direction inside items; the scope already says it.
  - If the sign has no arrows / no positional ambiguity: emit exactly ONE group with scope "Whole sign".
  - If the sign has multiple arrows or position-specific rules: emit ONE group per scope, splitting the content. Rules that apply to every direction (e.g. a permit zone painted across the whole street) go in "↔ Both directions". Side-specific rules go in their own arrow group.
  - At the top level, when clarification is non-null, observations describe the WHOLE sign (every group present). Per-variant observations include only the groups that apply to that variant — typically that variant's own arrow group PLUS any "↔ Both directions" or "Whole sign" groups.
- can_park_now: boolean — can a car park here right now, given the current date/time supplied? When clarification is non-null this is your best guess assuming the LEAST-restrictive applicable rule.
- until: ISO 8601 timestamp or null — when the current parking window closes (in Melbourne local time, with timezone offset). null if can_park_now is false.
- duration_minutes: number or null — how many minutes from now the car can stay. null if can_park_now is false.
- confidence: "low" | "medium" | "high" — how confident you are in the reading
- requires_ticket: boolean — TRUE only when the parker must pay for parking RIGHT NOW (sign indicates Ticket / Meter / Pay & Display / Pay-by-Plate / Pay-by-app like PayStay/EasyPark/Wilson/Care Park AND the current time is INSIDE the paid window). FALSE when the sign is free, when it's outside paid hours (e.g. Sunday on a Mon–Fri Ticket sign), or when can_park_now is already false.
- payment_methods: array of strings or null — when requires_ticket is TRUE, list the payment methods visible on the sign in lowercase short form. Allowed values: "meter", "ticket machine", "paystay", "easypark", "wilson", "carepark", "pay-by-plate". Use null when requires_ticket is FALSE, OR when requires_ticket is TRUE but the method isn't specified on the sign.
- requires_disabled_permit: boolean — TRUE only when the bay is reserved for vehicles displaying a valid disability parking permit. Triggers include:
  • The wheelchair / accessibility pictogram (♿ or similar blue-square-with-wheelchair symbol)
  • Text: "DISABLED", "DISABLED ONLY", "PERMIT HOLDERS ONLY", "ACCESSIBLE PARKING", "ACROD" (WA disability permit), "MOBILITY PASS"
  Set TRUE only when the restriction applies to the bay you're answering about RIGHT NOW (i.e. inside any time window the sign specifies — "ALL OTHER TIMES ♿ ONLY" means the restriction is in force now if the current time falls outside other windows).
  When the disability restriction lives on ONE SIDE of a multi-variant sign (e.g. left side = general, right side = ♿ ONLY), set this flag at the variant level too (each variant has its own requires_disabled_permit field) so the user's chosen variant carries the correct permit requirement.
  At the top level: when there is a clarification, set requires_disabled_permit to FALSE — defer to the per-variant flags. Otherwise set it to the actual restriction state for the whole sign.
- clarification: object or null — fill this when the rule depends on WHERE the driver is parked relative to the sign (left vs right arrows, side-specific labels, numbered bays, accessibility/EV/loading bays). Shape: { question: string, options: array of { label, rules, observations, can_park_now, until, duration_minutes } }. Each option must reflect the rule for that specific position. The question should be short and direct, e.g. "Where are you parked?". Labels MUST be 1–3 words naming only the position. NO parentheticals, NO arrow symbols, NO duration info in the label. Good labels: "Left side", "Right side", "Bay 12", "Accessibility bay". Bad labels: "Right side (→ arrow)", "Left (15-min)", "Bay 12 (EV only)". Set clarification to null when there is no positional ambiguity.

Interpretation rules:
- If multiple signs are stacked, interpret them together. The most restrictive rule wins UNLESS the rules apply to different positions (arrows, side markers, bay numbers) — in that case populate 'clarification'.
- Arrows ("←", "→", "↑", "↓") on parking signs indicate the rule applies in that direction from the sign. If two signs have arrows pointing different ways, that is positional ambiguity → use clarification.
- "Ticket" signs (e.g. "2P Ticket Mon-Fri 8:30-18:30"), "Meter", "Pay & Display", "Pay-by-Plate", "PayStay/EasyPark/Wilson/Care Park" zones, and coin-meter icons all mean paid parking. Inside the paid window: parking is permitted but payment is required, so set requires_ticket=true AND populate payment_methods. Outside the paid window (e.g. Sunday on a Mon–Fri Ticket sign): parking is free, requires_ticket=false.
- "No Stopping", "No Standing", "Loading Zone", "Clearway", "Bus Zone", "Taxi Zone" → can_park_now is false during the listed hours.
- "1P", "2P", "4P" = 1, 2, 4 hour limits. "1/4P" = 15-minute limit.
- If the sign is unclear, blurry, or you can't read it, set confidence to "low" and explain in the rules field. Default can_park_now to false when in doubt.
- Always express 'until' in ISO 8601 with the correct timezone offset for the user's local timezone (supplied below). Account for daylight saving in that timezone — e.g. Australia/Melbourne is +11:00 in summer (AEDT) and +10:00 in winter (AEST); Australia/Brisbane is +10:00 year-round; Australia/Perth is +08:00.

HOW TO COMPUTE 'until' — read carefully. 'until' is the SOONEST future moment the car would need to be moved to avoid a ticket. Take the EARLIEST leave-by time across ALL rules on the sign; never pick a later restriction and ignore an earlier one.

For each rule, compute its leave-by time:
- Time-limited (1P/2P/4P/1/4P) and the current time is INSIDE the window: leave-by = now + duration, capped at the end of the window. (After the window ends, parking continues freely until the next restriction.)
- Time-limited and the current time is OUTSIDE the window: parking is free overnight/weekend, but the clock starts the moment the window reopens. leave-by = (start of next window) + duration. Do NOT skip past a future time-limited window just because the car is currently outside it.
- Prohibition (No Stopping/Standing/Clearway/Bus Zone/Taxi Zone/Loading Zone, or Permit Zone without a permit) and currently INSIDE: can_park_now = false, until = null.
- Prohibition and currently OUTSIDE: leave-by = start of the next prohibition window.

'until' = MIN(leave-by for every rule on the sign).

Quick reminders:
- "2P Mon–Fri 8am–6pm" + currently Wed 10pm → next window opens Thu 8am, leave-by = Thu 10am.
- "2P Mon–Fri" + "Permit Zone Sat–Sun" → take the earliest leave-by across both, not the latest.
- "No Stopping Mon–Fri 7am–9am" + currently Sun 2pm → 'until' = Mon 7am (start of next prohibition).
- "1/4P Mon–Fri 8am–6pm" + currently inside the window → leave-by = now + 15 min, capped at end of window.

Sanity check before returning: if your computed 'until' is more than ~24 hours away on a weekday, you have probably missed an earlier restriction — recheck.

NEXT_TRANSITION — the rule-of-thumb advice the user would get if they asked a knowledgeable friend.

Populate next_transition when the parking calculus is about to shift meaningfully within the next ~3 hours and the user genuinely benefits from knowing — typically:
- The current restriction is about to END and parking becomes free or longer-allowed (e.g. it's 5:50 pm at "2P Mon–Fri 8am–6pm" → after 6 pm the 2P limit no longer applies; or the user is currently inside No Stopping that lifts soon).
- A new restriction is about to START in the next ~3 hours that flips can_park_now from true to false (e.g. it's 6:55 am and Clearway begins at 7 am).

Do NOT populate next_transition when:
- The next transition is more than ~3 hours away (it's not actionable advice yet — keep the result clean).
- The transition is exactly equal to 'until' (it would just duplicate the existing answer).
- The current restriction simply continues unchanged (no transition is happening soon).

Shape: { when: ISO 8601 in user's local timezone, change: ≤80 chars plain-English description }.
Examples of good 'change' strings:
- "2P restriction ends — free parking until 8am tomorrow"
- "Clearway begins — must move by then"
- "Permit Zone ends — anyone can park"
- "1P starts — 1-hour limit kicks in"
Examples of bad 'change' strings (too verbose, not actionable, or duplicate of 'until'):
- "The restriction described above will conclude at this time, after which..." (verbose)
- "Same as until" (duplicates existing field)
- "Things change" (not actionable)

If no meaningful transition is approaching within 3 hours, set next_transition to null.`

const OBSERVATION_GROUP_SCHEMA = {
  type: 'object',
  properties: {
    scope: { type: 'string' },
    items: { type: 'array', items: { type: 'string' } },
  },
  required: ['scope', 'items'],
  additionalProperties: false,
}

const NEXT_TRANSITION_SCHEMA = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      properties: {
        when: { type: 'string' },
        change: { type: 'string' },
      },
      required: ['when', 'change'],
      additionalProperties: false,
    },
  ],
}

const RULE_VARIANT_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    rules: { type: 'string' },
    observations: { type: 'array', items: OBSERVATION_GROUP_SCHEMA },
    can_park_now: { type: 'boolean' },
    until: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    duration_minutes: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    /**
     * Per-variant disability-permit flag. Critical for multi-arrow signs
     * where one side is general parking and another is restricted to
     * permit holders — without this, the chosen-variant flag wouldn't flow
     * through to the result UI.
     */
    requires_disabled_permit: { type: 'boolean' },
    next_transition: NEXT_TRANSITION_SCHEMA,
  },
  required: [
    'label',
    'rules',
    'observations',
    'can_park_now',
    'until',
    'duration_minutes',
    'requires_disabled_permit',
    'next_transition',
  ],
  additionalProperties: false,
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    rules: { type: 'string' },
    observations: { type: 'array', items: OBSERVATION_GROUP_SCHEMA },
    can_park_now: { type: 'boolean' },
    until: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    duration_minutes: { anyOf: [{ type: 'number' }, { type: 'null' }] },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    /** True when the parker must buy a ticket / pay-by-app before parking is legal RIGHT NOW. */
    requires_ticket: { type: 'boolean' },
    /** Detected payment options ("meter", "PayStay", "EasyPark", "ticket machine", etc.). null when the sign is paid but the method isn't specified. */
    payment_methods: {
      anyOf: [
        { type: 'null' },
        { type: 'array', items: { type: 'string' } },
      ],
    },
    /**
     * True when the bay is restricted to vehicles displaying a valid disability
     * parking permit (ACROD / Mobility Pass / disability permit). At the top
     * level this reflects the whole-sign / non-variant case. For multi-variant
     * signs use the per-variant flag instead.
     */
    requires_disabled_permit: { type: 'boolean' },
    next_transition: NEXT_TRANSITION_SCHEMA,
    clarification: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            question: { type: 'string' },
            options: {
              type: 'array',
              items: RULE_VARIANT_SCHEMA,
            },
          },
          required: ['question', 'options'],
          additionalProperties: false,
        },
      ],
    },
  },
  required: [
    'rules',
    'observations',
    'can_park_now',
    'until',
    'duration_minutes',
    'confidence',
    'requires_ticket',
    'payment_methods',
    'requires_disabled_permit',
    'next_transition',
    'clarification',
  ],
  additionalProperties: false,
}

function nowInTimezone(timezone) {
  const date = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const get = (t) => parts.find((p) => p.type === t)?.value
  const tzPart =
    new Intl.DateTimeFormat('en-AU', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value || 'GMT+0'
  const offsetMatch = tzPart.match(/GMT([+-]?\d+)(?::?(\d+))?/)
  const offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : 0
  const offsetMinutes = offsetMatch && offsetMatch[2] ? parseInt(offsetMatch[2], 10) : 0
  const sign = offsetHours >= 0 ? '+' : '-'
  const offset = `${sign}${String(Math.abs(offsetHours)).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`
}

function resolveTimezone(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return DEFAULT_TIMEZONE
  if (Number.isNaN(lat) || Number.isNaN(lng)) return DEFAULT_TIMEZONE
  try {
    return tzlookup(lat, lng) || DEFAULT_TIMEZONE
  } catch {
    return DEFAULT_TIMEZONE
  }
}

function formatObservationsForPrompt(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return '(none recorded)'
  return groups
    .map((g) => {
      const items = (g.items || []).map((i) => `    • ${i}`).join('\n')
      return `  ${g.scope}:\n${items}`
    })
    .join('\n')
}

function buildRefreshUserText({ timezone, now, prior_rules, prior_observations, prior_chosen_label }) {
  const observationsText = formatObservationsForPrompt(prior_observations)
  const chosenLine = prior_chosen_label
    ? `\nSide / variant the user previously selected: ${prior_chosen_label}\n`
    : '\n'
  return `User's timezone: ${timezone} (IANA).
Current local time at the user's location: ${now}

This is a REFRESH request, NOT a fresh sign reading. The user previously scanned a parking sign at this exact location and stored the rules below. No photo is provided — do not request one and do not invent visual observations.

Previously recorded sign rules:
${prior_rules}

Observations recorded from the sign:
${observationsText}
${chosenLine}
Apply these EXACT rules to the current time. Compute can_park_now, until, and duration_minutes from scratch using the "HOW TO COMPUTE 'until'" steps in the system prompt. Echo rules and observations back unchanged. Set confidence to "high". clarification must be null.${prior_chosen_label ? ` Do not change the side/variant selection.` : ''}`
}

export async function translateSign({
  image_base64,
  media_type = 'image/jpeg',
  lat,
  lng,
  current_datetime,
  prior_rules,
  prior_observations,
  prior_chosen_label,
}) {
  const t0 = Date.now()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured')

  const isRefresh = !image_base64 && typeof prior_rules === 'string' && prior_rules.length > 0
  if (!isRefresh && !image_base64) {
    throw new Error('image_base64 is required (or prior_rules for refresh mode)')
  }

  const client = new Anthropic({ apiKey })
  const timezone = resolveTimezone(lat, lng)
  const now = current_datetime || nowInTimezone(timezone)
  const t1 = Date.now()
  console.log(
    `[parkproof] preflight=${t1 - t0}ms model=${MODEL} mode=${isRefresh ? 'refresh' : 'translate'} tz=${timezone} image_b64_len=${image_base64?.length ?? 0}`,
  )

  const userContent = isRefresh
    ? [
        {
          type: 'text',
          text: buildRefreshUserText({
            timezone,
            now,
            prior_rules,
            prior_observations,
            prior_chosen_label,
          }),
        },
      ]
    : [
        {
          type: 'image',
          source: { type: 'base64', media_type, data: image_base64 },
        },
        {
          type: 'text',
          text: `User's timezone: ${timezone} (IANA).\nCurrent local time at the user's location: ${now}\n\nRead this parking sign and tell me whether I can park here right now. All times in your 'until' field must be expressed in this timezone with the correct offset.`,
        },
      ]

  const response = await client.messages.create({
    model: MODEL,
    // max_tokens is shared between thinking + output for adaptive-thinking
    // calls. 8192 is comfortable headroom for the biggest multi-variant
    // signs we've seen (output up to ~2.5k tokens, plus thinking) while
    // capping the worst-case wall-clock to keep complex signs inside the
    // API Gateway 30s window. Raise if stop_reason=max_tokens starts
    // appearing in CloudWatch.
    max_tokens: 8192,
    // Adaptive thinking is required for the multi-rule "compute leave-by per
    // rule, take the earliest" reasoning. Haiku 4.5 doesn't support any form
    // of thinking and produced wrong answers on stacked signs. effort=low
    // keeps Sonnet's reasoning depth tight so we don't burn 15-30s per call.
    thinking: { type: 'adaptive' },
    // System prompt as a list with cache_control so once the cache is warm
    // (after the first request crosses Anthropic's 2048-token minimum), every
    // subsequent call within 5 minutes reads from cache and skips most of the
    // input compute. Worth a couple of seconds per call once it kicks in.
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    output_config: {
      format: { type: 'json_schema', schema: RESPONSE_SCHEMA },
      effort: 'low',
    },
    messages: [{ role: 'user', content: userContent }],
  })
  const t2 = Date.now()
  console.log(
    `[parkproof] anthropic_call=${t2 - t1}ms stop=${response.stop_reason} usage=${JSON.stringify(response.usage)}`,
  )

  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      'The model hit the token limit before finishing — try a clearer or tighter-cropped photo of the sign.',
    )
  }
  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to read this image. Try a different photo.')
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || !textBlock.text) {
    throw new Error('Model returned no text content')
  }

  try {
    const parsed = JSON.parse(textBlock.text)
    const t3 = Date.now()
    console.log(`[parkproof] parse=${t3 - t2}ms total=${t3 - t0}ms`)
    return parsed
  } catch (parseErr) {
    console.error('JSON parse failed. Raw text:', textBlock.text)
    throw new Error(`Model returned malformed JSON: ${parseErr.message}`)
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

// ─── /sign-session handler ────────────────────────────────────────────────
// Signs a canonical JSON payload of session metadata + photo hashes using the
// KMS-managed asymmetric key. The private key never leaves AWS. Anyone can
// verify the signature against the published public key.

const SIGNING_SCHEMA = 'parkproof-evidence-v1'
const SIGNING_ALGORITHM = 'ECDSA_SHA_256'
const KEY_ALIAS = 'alias/parkproof-evidence-signing'

let _kmsClient
function getKmsClient() {
  if (!_kmsClient) {
    _kmsClient = new KMSClient({ region: process.env.AWS_REGION || 'ap-southeast-2' })
  }
  return _kmsClient
}

/**
 * Deterministic JSON canonicalisation: sorted keys, no whitespace, JSON.stringify
 * for primitives. Both sides (Lambda + verifier) must produce identical bytes
 * for the signature to validate.
 */
function canonicalize(value) {
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

async function handleSignSession(event) {
  const keyId = process.env.KMS_KEY_ID
  if (!keyId) throw new Error('KMS_KEY_ID env var not configured')

  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {}
  const {
    session_id,
    arrived_at,
    expires_at,
    location,
    rules,
    chosen_label,
    confidence,
    no_sign,
    sign_photo_sha256,
    ambient_photo_sha256,
    car_photo_sha256,
  } = body

  if (typeof session_id !== 'string' || !session_id) throw new Error('session_id required')
  if (typeof arrived_at !== 'string' || !arrived_at) throw new Error('arrived_at required')
  if (typeof rules !== 'string') throw new Error('rules required')
  if (typeof confidence !== 'string') throw new Error('confidence required')
  // No-sign sessions have a null sign_photo_sha256 — that's fine, the
  // (optional) ambient hash + car hash + signed metadata still constitute a
  // tamper-evident bundle. Only enforce the 64-char hex shape when present.
  if (sign_photo_sha256 !== null && sign_photo_sha256 !== undefined) {
    if (typeof sign_photo_sha256 !== 'string' || sign_photo_sha256.length !== 64) {
      throw new Error('sign_photo_sha256 must be 64-char hex or null')
    }
  } else if (!no_sign) {
    throw new Error('sign_photo_sha256 required for translated sessions')
  }
  if (ambient_photo_sha256 !== null && ambient_photo_sha256 !== undefined) {
    if (typeof ambient_photo_sha256 !== 'string' || ambient_photo_sha256.length !== 64) {
      throw new Error('ambient_photo_sha256 must be 64-char hex or null')
    }
  }
  if (car_photo_sha256 !== null && car_photo_sha256 !== undefined) {
    if (typeof car_photo_sha256 !== 'string' || car_photo_sha256.length !== 64) {
      throw new Error('car_photo_sha256 must be 64-char hex or null')
    }
  }

  const signed_at = new Date().toISOString()

  const payload = {
    schema: SIGNING_SCHEMA,
    session_id,
    arrived_at,
    expires_at: expires_at || null,
    location: location || null,
    rules,
    chosen_label: chosen_label || null,
    confidence,
    // no_sign flag stays in the signed payload so the bundle is self-describing
    // — verifiers reading the canonical JSON can see whether this is a
    // translated session or a no-sign assertion at a glance.
    no_sign: !!no_sign,
    sign_photo_sha256: sign_photo_sha256 || null,
    ambient_photo_sha256: ambient_photo_sha256 || null,
    car_photo_sha256: car_photo_sha256 || null,
    signed_at,
  }

  const canonical_payload = canonicalize(payload)
  const digest = crypto.createHash('sha256').update(canonical_payload).digest()

  const t0 = Date.now()
  const result = await getKmsClient().send(
    new SignCommand({
      KeyId: keyId,
      Message: digest,
      MessageType: 'DIGEST',
      SigningAlgorithm: SIGNING_ALGORITHM,
    }),
  )
  const signMs = Date.now() - t0
  console.log(`[parkproof.signing] kms_sign=${signMs}ms session_id=${session_id}`)

  const signature_base64 = Buffer.from(result.Signature).toString('base64')

  return {
    schema: SIGNING_SCHEMA,
    signed_at,
    algorithm: SIGNING_ALGORITHM,
    key_alias: KEY_ALIAS,
    canonical_payload,
    signature_base64,
  }
}

// ─── /feedback handler ────────────────────────────────────────────────────
// Captures user verdicts on AI translations. Layer-1 feedback: just verdict +
// random id + timestamp. No photo, no rules text, no PII. Lands as a structured
// CloudWatch log line that Logs Insights can aggregate.
async function handleFeedback(event) {
  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {}
  const verdict = body.verdict
  const feedback_id = body.feedback_id

  if (verdict !== 'correct' && verdict !== 'retake') {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'verdict must be "correct" or "retake"' }),
    }
  }
  if (typeof feedback_id !== 'string' || feedback_id.length === 0 || feedback_id.length > 64) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'feedback_id is required (string, ≤ 64 chars)' }),
    }
  }

  // Layer-2 context fields. Optional — old clients still send just verdict +
  // feedback_id and that continues to work. New clients send a `context` object;
  // we whitelist what we log (don't blindly pass through any client field) and
  // truncate the rules_excerpt defensively. No PII in any of these fields.
  const ctx = body.context && typeof body.context === 'object' ? body.context : {}
  const safeCtx = {
    confidence:
      ctx.confidence === 'low' || ctx.confidence === 'medium' || ctx.confidence === 'high'
        ? ctx.confidence
        : undefined,
    had_clarification:
      typeof ctx.had_clarification === 'boolean' ? ctx.had_clarification : undefined,
    chosen_label:
      typeof ctx.chosen_label === 'string' ? ctx.chosen_label.slice(0, 60) : undefined,
    duration_minutes:
      typeof ctx.duration_minutes === 'number' && Number.isFinite(ctx.duration_minutes)
        ? ctx.duration_minutes
        : undefined,
    observations_count:
      typeof ctx.observations_count === 'number' && Number.isFinite(ctx.observations_count)
        ? ctx.observations_count
        : undefined,
    rules_excerpt:
      typeof ctx.rules_excerpt === 'string' ? ctx.rules_excerpt.slice(0, 120) : undefined,
    scanned_hour_local:
      typeof ctx.scanned_hour_local === 'number' &&
      ctx.scanned_hour_local >= 0 &&
      ctx.scanned_hour_local <= 23
        ? ctx.scanned_hour_local
        : undefined,
    is_refresh: typeof ctx.is_refresh === 'boolean' ? ctx.is_refresh : undefined,
    // Layer 2 cont. — paid-parking signal. Lets us slice retake rate by paid
    // vs free signs: "is the ticket-acknowledgment gate helping or annoying?"
    requires_ticket:
      typeof ctx.requires_ticket === 'boolean' ? ctx.requires_ticket : undefined,
    // Whether the user actually acknowledged the pay requirement before saving
    // (only meaningful when requires_ticket=true). Tells us if the gate is
    // friction worth keeping.
    ticket_acknowledged:
      typeof ctx.ticket_acknowledged === 'boolean' ? ctx.ticket_acknowledged : undefined,
    // For the no-sign flow (Feature 1) — distinguishes scan-based sessions
    // from "I parked at an unsigned spot" sessions.
    no_sign: typeof ctx.no_sign === 'boolean' ? ctx.no_sign : undefined,
    // Disability-permit gate. Same shape as the paid-parking gate: did we
    // detect it, did the user acknowledge it. Slice retake rate by these to
    // spot false-positive ♿ detection (e.g. AI reading a wheelchair symbol
    // on an adjacent unrelated sign as part of THIS bay's rules).
    requires_disabled_permit:
      typeof ctx.requires_disabled_permit === 'boolean'
        ? ctx.requires_disabled_permit
        : undefined,
    disabled_permit_acknowledged:
      typeof ctx.disabled_permit_acknowledged === 'boolean'
        ? ctx.disabled_permit_acknowledged
        : undefined,
  }

  console.log(
    `[parkproof.feedback] ${JSON.stringify({
      verdict,
      feedback_id,
      timestamp: new Date().toISOString(),
      ...safeCtx,
    })}`,
  )

  // 204 No Content — telemetry endpoint, nothing to return.
  return { statusCode: 204, headers: CORS_HEADERS, body: '' }
}

// ─── /sign-translate handler ──────────────────────────────────────────────
async function handleSignTranslate(event) {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body

    // Refresh mode (prior_rules supplied, no image) is a ~3-second text-only
    // call — well under the 30s gateway window, so we keep it synchronous.
    // No DDB roundtrip, no polling overhead.
    if (body && body.prior_rules) {
      const result = await translateSign(body)
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      }
    }

    // Fresh translate mode (image present). Could take 30–50s on complex
    // multi-variant signs → exceeds API Gateway's 30s cap. Enqueue a job,
    // async-invoke ourselves with the work, return 202 + job_id. The client
    // polls /sign-translate/status/{job_id} until the work completes.
    const job_id = crypto.randomUUID()
    await putJob(job_id, { status: 'pending', kind: 'sign-translate' })
    await asyncSelfInvoke({ _async_kind: 'sign-translate', job_id, body })
    return {
      statusCode: 202,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id, status: 'pending' }),
    }
  } catch (err) {
    console.error('translateSign enqueue error:', err)
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || String(err) }),
    }
  }
}

// ─── /sign-translate/status/{job_id} handler ─────────────────────────────
async function handleJobStatus(event) {
  // Extract job_id from the path. API Gateway HTTP API exposes it via
  // pathParameters, but we also support a manual parse so dev (no API GW)
  // works through the same handler.
  let job_id = event.pathParameters?.job_id
  if (!job_id) {
    const path = event.requestContext?.http?.path || event.rawPath || ''
    const match = path.match(/\/status\/([^/]+)$/)
    job_id = match ? match[1] : null
  }
  if (!job_id) {
    return {
      statusCode: 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'job_id required in path' }),
    }
  }
  const job = await getJob(job_id)
  if (!job) {
    // Either invalid id or the TTL purged it. Either way, can't proceed.
    return {
      statusCode: 404,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'job not found or expired' }),
    }
  }
  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_id: job.job_id,
      status: job.status,
      result: job.result ?? null,
      error: job.error ?? null,
    }),
  }
}

// ─── Async-work entry point ──────────────────────────────────────────────
// Triggered when the dispatcher sees `_async_kind` on the event payload —
// meaning we were invoked by ourselves (asyncSelfInvoke). Runs the actual
// Claude call and writes result/error back to DDB.
async function handleAsyncWork(event) {
  const { _async_kind, job_id, body } = event
  try {
    let result
    if (_async_kind === 'sign-translate') {
      result = await translateSign(body)
    } else if (_async_kind === 'draft-appeal') {
      // For draft-appeal we recreate the event shape the handler expects.
      result = await handleDraftAppeal({ body: JSON.stringify(body) })
    } else {
      throw new Error(`unknown async kind: ${_async_kind}`)
    }
    await putJob(job_id, { status: 'done', kind: _async_kind, result })
    console.log(`[parkproof.job] ${job_id} done (${_async_kind})`)
  } catch (err) {
    console.error(`[parkproof.job] ${job_id} error:`, err)
    await putJob(job_id, {
      status: 'error',
      kind: _async_kind,
      error: err?.message || String(err),
    })
  }
  // Lambda async invocations don't see the return value — write to DDB is
  // the only sink that matters. Return undefined for cleanliness.
  return
}

// ─── Top-level dispatcher ─────────────────────────────────────────────────
export async function handler(event) {
  // First check: was this an async self-invocation? Those events have a
  // `_async_kind` marker put there by asyncSelfInvoke. They bypass the
  // HTTP-style routing entirely and just do the work.
  if (event && event._async_kind) {
    return await handleAsyncWork(event)
  }

  const method = event.requestContext?.http?.method || event.httpMethod
  const path = event.requestContext?.http?.path || event.rawPath || ''

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' }
  }

  // Status polling endpoint. Shared between /sign-translate/status/{id} and
  // /draft-appeal/status/{id} — they both write into the same jobs table
  // so a single read endpoint serves both.
  if (path.includes('/status/')) {
    try {
      return await handleJobStatus(event)
    } catch (err) {
      console.error('job-status handler error:', err)
      return {
        statusCode: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err?.message || String(err) }),
      }
    }
  }

  if (path.endsWith('/feedback')) {
    try {
      return await handleFeedback(event)
    } catch (err) {
      console.error('feedback handler error:', err)
      return {
        statusCode: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err?.message || String(err) }),
      }
    }
  }

  if (path.endsWith('/draft-appeal')) {
    // Same async-polling pattern as /sign-translate. Appeal drafting is
    // vision + thinking + ~700-2000 output tokens; routinely 15-25s, can
    // exceed 30s on edge cases (long infringement notice + complex
    // session context).
    try {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body
      const job_id = crypto.randomUUID()
      await putJob(job_id, { status: 'pending', kind: 'draft-appeal' })
      await asyncSelfInvoke({ _async_kind: 'draft-appeal', job_id, body })
      return {
        statusCode: 202,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id, status: 'pending' }),
      }
    } catch (err) {
      console.error('draft-appeal enqueue error:', err)
      return {
        statusCode: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err?.message || String(err) }),
      }
    }
  }

  if (path.endsWith('/sign-session')) {
    try {
      const result = await handleSignSession(event)
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      }
    } catch (err) {
      console.error('sign-session handler error:', err)
      return {
        statusCode: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err?.message || String(err) }),
      }
    }
  }

  // Auth-required routes — API Gateway has already verified the JWT and put
  // claims on event.requestContext.authorizer.jwt.claims. Each handler reads
  // sub from there and scopes data access to that user only.
  const authRoutes = [
    { match: /\/sessions\/upload$/, handler: handleSessionsUpload },
    { match: /\/sessions\/list$/, handler: handleSessionsList },
    { match: /\/sessions\/delete$/, handler: handleSessionsDelete },
    { match: /\/photos\/presign$/, handler: handlePhotosPresign },
    { match: /\/me\/export$/, handler: handleMeExport },
    { match: /\/me\/delete$/, handler: handleMeDelete },
  ]
  for (const route of authRoutes) {
    if (route.match.test(path)) {
      try {
        const result = await route.handler(event)
        return {
          statusCode: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify(result),
        }
      } catch (err) {
        const status = err?.statusCode || 500
        console.error(`${path} handler error (${status}):`, err)
        return {
          statusCode: status,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: err?.message || String(err) }),
        }
      }
    }
  }

  return handleSignTranslate(event)
}
