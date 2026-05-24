export type Confidence = 'low' | 'medium' | 'high'

export interface ObservationGroup {
  scope: string
  items: string[]
}

export interface NextTransition {
  /** ISO 8601 timestamp (in the spot's local timezone) when the parking rule changes. */
  when: string
  /** Plain-English description of what changes — ≤80 chars. Shown verbatim in a banner. */
  change: string
}

export interface RuleVariant {
  label: string
  rules: string
  observations: ObservationGroup[]
  can_park_now: boolean
  until: string | null
  duration_minutes: number | null
  /**
   * Per-variant disability-permit flag. Set true when this side / bay is
   * reserved for vehicles displaying a valid permit. Critical for the
   * multi-arrow case where the user's chosen variant determines whether
   * the gate fires.
   */
  requires_disabled_permit?: boolean
  /**
   * Per-variant general parking-permit flag. Set true when this side / bay
   * is in a residential or business Permit Zone. Like requires_disabled_permit,
   * the variant value is merged up to the top-level result after the user
   * picks a clarification option.
   */
  is_permit_zone?: boolean
  /** The permit-area identifier (e.g. "25") when visible on the sign; null otherwise. */
  permit_area?: string | null
  /** Optional heads-up — set when a meaningful rule change is approaching. */
  next_transition?: NextTransition | null
}

export interface Clarification {
  question: string
  options: RuleVariant[]
}

export interface ParkingRules {
  rules: string
  observations: ObservationGroup[]
  can_park_now: boolean
  until: string | null
  duration_minutes: number | null
  confidence: Confidence
  clarification: Clarification | null
  /** Optional heads-up — set when a meaningful rule change is approaching. */
  next_transition?: NextTransition | null
  /**
   * True when the sign indicates paid parking AND the current time is inside
   * the paid window. The frontend gates the "Save session" button on an
   * explicit user acknowledgement when this is true.
   */
  requires_ticket?: boolean
  /**
   * Lowercase short-form payment methods detected on the sign (e.g.
   * `["paystay", "meter"]`). null when the sign is free OR when paid but the
   * method isn't specified. Drives the deep-link buttons on the result card.
   */
  payment_methods?: string[] | null
  /**
   * True when the bay is restricted to vehicles displaying a valid disability
   * parking permit (ACROD / Mobility Pass). For multi-variant signs use the
   * per-variant RuleVariant.requires_disabled_permit field — the chosen
   * variant's value gets merged onto the top-level result by App.tsx after
   * the user picks a side.
   */
  requires_disabled_permit?: boolean
  /**
   * True when the bay is in a residential / business Permit Zone — the
   * red "PERMIT ZONE" + yellow "PERMIT AREA N" pattern. Like
   * requires_disabled_permit, the frontend surfaces an acknowledgement
   * checkbox gating Save (the user must confirm they hold a valid permit).
   */
  is_permit_zone?: boolean
  /** Permit area identifier from the yellow plate (e.g. "25"), if visible. */
  permit_area?: string | null
  /** Frontend-only — set when the user picked a variant from a clarification step. */
  chosen_label?: string
  /** Frontend-only — variants the user did NOT pick. Carried through for PDF context. */
  alternate_variants?: RuleVariant[]
}

export interface SignatureBundle {
  schema: string
  signed_at: string
  algorithm: string
  key_alias: string
  canonical_payload: string
  signature_base64: string
}

export interface AppealDraft {
  ticket_summary: string
  appeal_subject: string
  appeal_letter: string
  evidence_strength: 'strong' | 'moderate' | 'weak'
  notes: string
}

export interface ParkingSession {
  id: string
  arrived_at: string
  location: {
    lat: number
    lng: number
    address?: string | null
    /** How the coords were obtained — informs evidence reliability in the PDF. */
    source?: 'gps' | 'manual'
    /** GPS accuracy at capture time, in metres. Only meaningful when source='gps'. */
    accuracy_meters?: number
  } | null
  /**
   * Data URL of the parking-sign photo. null only on no-sign sessions
   * (the user logged a park where no sign was present).
   */
  sign_photo: string | null
  car_photo: string | null
  /**
   * Free-text rules description from the AI read. Empty string on no-sign
   * sessions (nothing to translate).
   */
  rules: string
  observations: ObservationGroup[]
  expires_at: string | null
  confidence: Confidence
  /**
   * True when the session was logged WITHOUT an AI sign read — the user
   * parked at an unsigned spot and just wanted a GPS + time evidence record.
   * Renderers (history, detail, PDF) downgrade to "no posted restrictions"
   * messaging when this is true.
   */
  no_sign?: boolean
  /**
   * Optional photo of the spot's surroundings, captured on no-sign sessions
   * to evidence that no signs were visible at the time of parking. Data URL,
   * same encoding as sign_photo / car_photo.
   */
  ambient_photo?: string | null
  chosen_label?: string
  /** Variants the user did NOT pick — used in the PDF to show full sign context. */
  alternate_variants?: RuleVariant[]
  /** Cryptographic signature over the session evidence — added asynchronously after save. */
  signature?: SignatureBundle
  /**
   * Free-text context the user adds about the session — e.g. "Mum's chemo at
   * the Royal Melbourne", "Saturday market on Lygon", "Christmas party at
   * work". Surfaces in the evidence PDF and helps soften a council review
   * when the context matters.
   */
  note?: string
  /**
   * ISO 8601 timestamp the user explicitly signalled "I've left". Set via the
   * "End session" action on the active card / session detail. When present,
   * the session is treated as complete regardless of `expires_at` — it falls
   * out of the home "Currently parked" surface and shows an ended-at row in
   * detail. Primary purpose: no-sign sessions have no natural expiry, so
   * without an explicit end they'd hang around forever. Also useful on
   * expiry-bearing sessions when the user leaves early and wants the evidence
   * record to reflect actual duration.
   */
  ended_at?: string
  /**
   * Server-side Web Push reminders scheduled for this session, mirrored from
   * the /push/schedule API response. Locally-persisted so SessionDetail can
   * surface "scheduled for 4:00 PM, 4:25 PM" + a per-row cancel + an "Add
   * another" picker WITHOUT a round trip to EventBridge on every render.
   *
   * Authoritative copy lives server-side (EventBridge Scheduler). This array
   * is a cache for display + management UX. Each entry is one fire time;
   * offset-vs-expiry / "before vs from-now" is derived at render time by
   * comparing fire_at to session.expires_at.
   *
   * Mutations:
   *   - ReminderOptions writes the initial set after /push/schedule succeeds
   *   - SessionDetail's "+ Add reminder" / per-row cancel re-call /push/schedule
   *     with the new desired union/difference, then overwrites this array
   *   - cancelPushReminders (e.g. "I've left") doesn't currently clear this
   *     array — the times are still "what was scheduled at the time", and the
   *     session is over anyway. Stale fire_at after end-of-session is harmless.
   *
   * Additive — old sessions saved pre-feature have no field, treated as []
   * by all readers.
   */
  push_reminders?: Array<{
    /** ISO 8601 — when EventBridge will fire the push. */
    fire_at: string
  }>
}
