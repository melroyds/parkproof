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
  sign_photo: string
  car_photo: string | null
  rules: string
  observations: ObservationGroup[]
  expires_at: string | null
  confidence: Confidence
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
}
