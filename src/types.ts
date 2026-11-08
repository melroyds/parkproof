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
  /**
   * Frontend-only: true when this answer came from a re-check (the
   * text-only refresh of a saved record's rules), not a fresh photo read.
   * Set by refreshInterpretation; reported in the feedback telemetry and
   * never saved on a record.
   */
  is_refresh?: boolean
}

export interface SignatureBundle {
  schema: string
  signed_at: string
  algorithm: string
  key_alias: string
  canonical_payload: string
  signature_base64: string
}

// ─── Evidence chain (build spec N1, N2) ─────────────────────────────────
// Link 0 of a record is its arrival bundle (`ParkingSession.signature`).
// Links 1, 2, 3... are signed addenda, each committing to its parent's
// canonical payload. The shapes below are the data model every later task
// fills in; they are all optional on a record so old records keep loading.

export type PhotoRole =
  | 'sign'
  | 'car'
  | 'ambient'
  | 'condition-front'
  | 'condition-rear'
  | 'condition-left'
  | 'condition-right'
  | 'condition-detail'
  | 'return-front'
  | 'return-rear'
  | 'return-left'
  | 'return-right'
  | 'return-detail'
  | 'compliance'

export interface PhotoRef {
  role: PhotoRole
  /** Hex sha256 of the exact JPEG bytes stored; computed at capture. */
  sha256: string
  /** Client ISO time. */
  captured_at: string
  /** 'library' when the file came from the library, or File.lastModified is more than 2 min old. */
  source: 'camera_input' | 'library'
}

/** A photo reference inside signed addendum data (N2 `PhotoRefData`). */
export type PhotoRefData = PhotoRef

export type AddendumKind = 'arrival_context' | 'condition' | 'compliance' | 'departure' | 'handover'

export interface SignedAddendum {
  /** uuid, also inside the signed payload as addendum_id. */
  id: string
  /** 1, 2, 3...; link 0 is the arrival bundle. Assigned by appendAddendum, never by a caller. */
  seq: number
  kind: AddendumKind
  /** Client ISO time, frozen at queue time. */
  captured_at: string
  /** Frozen at queue time, normalised by lambda/addendum-schema.js. */
  data: Record<string, unknown>
  /** Absent = pending. */
  bundle?: SignatureBundle
  /** The server said 400; never retried. */
  rejected?: { code: string; at: string }
}

export type SignStatus = 'readable' | 'partially_obscured' | 'missing' | 'contradictory' | 'not_a_parking_sign'
export type Jurisdiction = 'VIC' | 'QLD' | 'NSW' | 'ACT' | 'SA' | 'WA' | 'TAS' | 'NT'
export type ComplianceType = 'meter_ticket' | 'payment_confirmation' | 'permit_displayed' | 'other'

export interface GateAcks {
  meter_ticket: boolean | null
  permit_zone: boolean | null
  accessible_permit: boolean | null
}

export interface RuleFlags {
  requires_ticket: boolean
  payment_methods: string[] | null
  requires_disabled_permit: boolean
  is_permit_zone: boolean
  permit_area: string | null
  is_area_sign: boolean
}

/** A phone GPS fix as signed in addenda (N2 `Location`). */
export interface GpsLocation {
  lat: number
  lng: number
  accuracy_meters: number | null
  source: 'gps'
}

export interface PermitContext {
  type: 'accessible' | 'resident' | 'business'
  area: string | null
  /** Accessible only; null for resident and business permits. */
  holder_present: boolean | null
  /** The sign itself prints an exception for this permit. */
  sign_exception_applies: boolean
  standard_until: string | null
  permit_until: string | null
  note: string | null
}

export type BoundaryAskedBecause =
  | 'within_30m'
  | 'same_street'
  | 'same_sign_text'
  | 'area_sign'
  | 'location_unreliable'

export type BoundaryAnswer =
  | 'opposite_direction_sign'
  | 'yellow_edge_line'
  | 't_intersection_or_dead_end'
  | 'left_parking_area'
  | 'not_sure'
  | 'not_asked'

export interface BoundaryStatement {
  previous_session_id: string
  asked_because: BoundaryAskedBecause[]
  answer: BoundaryAnswer
  distance_from_previous_m: number | null
}

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

/** A weekly restriction read from the sign (T3 fills these in). */
export interface RecurringRestriction {
  kind: 'street_cleaning' | 'clearway' | 'no_stopping' | 'other'
  days: Weekday[]
  /** 'HH:MM' local time. */
  start: string
  /** 'HH:MM' local time. */
  end: string
  week_of_month: number[]
  exceptions_text: string
  label: string
}

/** The workday link inside arrival_context data. */
export interface ArrivalWorkday {
  workday_id: string
  leg_index: number
  stretch_deadline: string | null
  previous_departure_payload_sha256: string | null
}

// Per-kind addendum data (N2). Every key is required; null when empty.

export interface ArrivalContextData {
  driver_name: string | null
  sign_status: SignStatus | null
  sign_issues: string[]
  rule_flags: RuleFlags | null
  gate_acks: GateAcks | null
  /** sha256 hex of permit_salt + canonicalize(permit_context) (N3), never the permit itself. */
  permit_commitment: string | null
  photos: PhotoRefData[]
  condition_note: string | null
  compliance_type: ComplianceType | null
  jurisdiction: Jurisdiction | null
  workday: ArrivalWorkday | null
  boundary: BoundaryStatement | null
}

export interface ConditionData {
  when: 'parking' | 'return'
  photos: PhotoRefData[]
  note: string | null
}

export interface ComplianceData {
  compliance_type: ComplianceType
  photo: PhotoRefData
}

export interface DepartureData {
  ended_at: string
  location: GpsLocation | null
  distance_from_arrival_m: number | null
  return_photos: PhotoRefData[]
}

export interface HandoverData {
  from_driver: string | null
  to_driver: string
  handed_over_at: string
  location: GpsLocation | null
}

export interface AddendumDataByKind {
  arrival_context: ArrivalContextData
  condition: ConditionData
  compliance: ComplianceData
  departure: DepartureData
  handover: HandoverData
}

/**
 * What the clarify, result and logging views carry towards the logger.
 * Later tasks add data to a new record only through this draft.
 */
export interface LogDraft {
  gate_acks: GateAcks
  permit_context: PermitContext | null
  workday: { workday_id: string; leg_index: number; previous_session_id: string | null } | null
  driver_name: string | null
}

/**
 * Raw reverse-geocode parts saved on a record as `place` (T6a). Unsigned and
 * never edited. `state_code` is Nominatim's raw `ISO3166-2-lvl4` value (for
 * example "AU-VIC"); a record's jurisdiction is read from it and nothing else.
 */
export type PlaceParts = NonNullable<ParkingSession['place']>

/**
 * Workday mode (T6a, behind VITE_FEATURE_WORKDAY). Stored on this device
 * only under `parkproof.workday.v1` (helpers in storage.ts). At most one
 * workday is active (status other than 'ended') at a time.
 *   - 'parked': the car is at `current_session_id`, the leg in progress.
 *   - 'between_moves': the driver tapped "I'm moving the car now" (that leg
 *     has ended), or the workday has no leg yet; the next scan makes a leg.
 *   - 'ended': the driver ended the workday at `ended_at`.
 * The legs themselves are ordinary records carrying `workday_id` and
 * `leg_index`, so they sync and sign like any other record.
 */
export type WorkdayStatus = 'parked' | 'between_moves' | 'ended'

export interface WorkdayState {
  /** uuid (lower case), the `workday_id` every leg carries. */
  id: string
  /** Phone time the driver started the workday (ISO, UTC). */
  started_at: string
  /** Where the workday was started. Only 'VIC' and 'QLD' can start one. */
  jurisdiction: Jurisdiction
  status: WorkdayStatus
  /** The leg the car is at ('parked'), or the leg just left ('between_moves'). */
  current_session_id: string | null
  /** The leg before `current_session_id`. */
  previous_session_id: string | null
  /** Phone time the workday ended (ISO, UTC); null while active. */
  ended_at: string | null
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
   *   - App.handleEndSession ("I've left") and "Cancel all" clear this array
   *     only after /push/cancel succeeded. After a failure, or a 403
   *     ERR_NOT_OWNER (another device created the schedules), it is left as
   *     it is, because those pushes may still fire.
   *
   * Additive — old sessions saved pre-feature have no field, treated as []
   * by all readers.
   */
  push_reminders?: Array<{
    /** ISO 8601 — when EventBridge will fire the push. */
    fire_at: string
  }>
  /**
   * Set true when a cloud mirror synced the session metadata but one or more
   * photo uploads to S3 failed (the warned-and-swallowed path in sync.ts). The
   * DDB row exists with a null photo, so on another device the image would be
   * missing and the evidence PDF would render blank. SessionDetail surfaces a
   * "Photo not backed up — retry" affordance when this is set, and clears it on
   * a successful retry. Additive; absent ⇒ no known photo-sync failure.
   */
  photo_sync_failed?: boolean

  // ── Evidence chain and later-task fields (build spec N1) ──
  // All optional, so records saved before this build keep loading. Every
  // field of this interface is in ALLOWED_SESSION_FIELDS (lambda/cloud-sync.js;
  // a test in lambda/cloud-sync.test.js fails when one is missing). A field
  // that needs more than "this device's copy wins" when two copies meet
  // also needs a rule in the client merge (src/lib/evidence-merge.ts) and
  // the server merge (mergeSessionRows).

  /**
   * 32 random bytes as 64 lowercase hex characters, generated at save.
   * Secret: lives on this device and the user's own cloud copy only. Link 0
   * signs its sha256 (`chain_key_sha256`); every addendum request proves
   * the key is known. Absent on records saved before the chain (their link
   * 0 is a v1 bundle).
   */
  chain_key?: string
  /** Every IndexedDB-backed photo of this record (from T0b2: sign, car and ambient too). */
  photos?: PhotoRef[]
  /** The link-0 photo hashes, stored at save so link 0 can always be signed. */
  v1_hashes?: { sign: string | null; car: string | null; ambient: string | null }
  /**
   * Links 1, 2, 3... Written only through appendAddendum, setAddendumBundle,
   * rejectAddendum and the cloud merge (mergeCloudEvidence). Only signed and
   * rejected addenda are uploaded; a pending one stays on the device that
   * queued it.
   */
  addenda?: SignedAddendum[]
  /** Existing damage the driver noticed, at most 280 characters. */
  condition_note?: string | null
  compliance_type?: ComplianceType | null
  gate_acks?: LogDraft['gate_acks']
  rule_flags?: RuleFlags
  sign_status?: SignStatus
  sign_issues?: string[]
  recurring_restrictions?: RecurringRestriction[]
  /** Raw reverse-geocode parts. Unsigned, never edited. */
  place?: { road: string | null; suburb: string | null; state_code: string | null }
  departure?: {
    ended_at: string
    location: { lat: number; lng: number; accuracy_meters: number | null; source: 'gps' } | null
    distance_from_arrival_m: number | null
  }
  driver_name?: string | null
  permit_context?: PermitContext | null
  /** Hex; lets the driver reveal permit_context later (N3). */
  permit_salt?: string | null
  jurisdiction?: Jurisdiction | null
  workday_id?: string | null
  leg_index?: number | null
  boundary?: BoundaryStatement | null
  stretch_deadline?: string | null
  /** Set on a read-only copy imported from someone's share link (T7). */
  shared_from?: {
    original_session_id: string
    received_at: string
    shared_at: string | null
    arrival_bundle: SignatureBundle | null
    snapshot: Record<string, unknown>
  } | null
}
