// Types for the plain-JS Lambda handler so the Vite config can import it
// during dev without TS complaining about implicit `any`.

export interface TranslateSignInput {
  image_base64: string
  media_type?: string
  lat?: number
  lng?: number
  current_datetime?: string
}

export function translateSign(input: TranslateSignInput): Promise<unknown>

/**
 * For the accuracy harness only: wraps the model client translateSign
 * creates, to record requests and usage or to answer offline. Pass null to
 * restore the real client.
 */
export function setSignClientWrapper(wrap: ((client: unknown) => unknown) | null): void

interface LambdaEvent {
  body?: string | Record<string, unknown>
  requestContext?: {
    http?: { method?: string; path?: string }
    /**
     * API Gateway HTTP API JWT-authorizer claims, mirrored in dev by the
     * Vite middleware that decodes the bearer token without verification.
     * Production: API Gateway validates the JWT before invoking Lambda.
     */
    authorizer?: { jwt?: { claims?: Record<string, unknown> } }
  }
  httpMethod?: string
  rawPath?: string
}

interface LambdaResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

export function handler(event: LambdaEvent): Promise<LambdaResponse>

/**
 * Overrides for /sign-session, used only by the local dev server and tests.
 * The Lambda dispatcher never passes them: production signs with KMS under
 * 'alias/parkproof-evidence-signing' and trusts only the published key.
 */
export interface SignSessionOptions {
  /** Returns the DER ECDSA P-256 signature over `message` (sha256 = `digest`). */
  signer?: (input: { digest: Uint8Array; message: Uint8Array }) => Uint8Array | Promise<Uint8Array>
  /** Written into the bundle's key_alias. */
  keyAlias?: string
  /** PEM public keys a parent link may be signed with. */
  parentPublicKeys?: string[]
}

export interface SignatureBundleShape {
  schema: string
  signed_at: string
  algorithm: string
  key_alias: string
  canonical_payload: string
  signature_base64: string
}

/** The published evidence-signing public key (public/parkproof-public-key.pem). */
export const PARKPROOF_PUBLIC_KEY_PEM: string

export function canonicalize(value: unknown): string
export function chainKeyHash(chain_key: string): string
export function buildEvidenceV1Payload(body: Record<string, unknown>, signed_at: string): Record<string, unknown>
export function buildEvidenceV2Payload(body: Record<string, unknown>, signed_at: string): Record<string, unknown>

/** Sign one link (v1, v2 or addendum). Throws AddendumValidationError (400) or Error (500). */
export function handleSignSession(event: LambdaEvent, options?: SignSessionOptions): Promise<SignatureBundleShape>

/** The /sign-session HTTP response: 200 bundle, 400 `{ error: code, field, detail }`, or 500. */
export function handleSignSessionRequest(event: LambdaEvent, options?: SignSessionOptions): Promise<LambdaResponse>

/**
 * The `session.evidence` object in a /draft-appeal body (build spec T1b),
 * built by src/lib/record-times.ts appealEvidence. Every time is
 * pre-formatted in the record's zone with the zone name.
 */
export interface AppealEvidenceInput {
  time_zone?: string
  arrival_phone?: string | null
  arrival_signed?: string | null
  arrival_signing?: 'signed' | 'dev_key' | 'pending' | 'rejected'
  expires?: string | null
  departure_tapped?: string | null
  departure_signed?: string | null
  departure_signing?: 'signed' | 'dev_key' | 'pending' | 'rejected' | 'none' | null
  location_source?: 'gps' | 'manual' | null
}

/** The `session` object in a /draft-appeal body. */
export interface AppealSessionInput {
  arrived_at?: string
  expires_at?: string | null
  location?: { lat: number; lng: number; address?: string | null; source?: string; accuracy_meters?: number } | null
  rules?: string
  observations?: Array<{ scope: string; items: string[] }>
  chosen_label?: string
  confidence?: string
  evidence?: AppealEvidenceInput | null
}

/** The appeal drafter's system prompt (exported for prompt guard tests). */
export const APPEAL_SYSTEM_PROMPT: string

/** An ISO time formatted as the client's formatInZone does (year and zone name), or null when it doesn't parse. */
export function appealZonedTime(value: unknown, timeZone: string): string | null

/** The record as labelled lines for the appeal drafter: phone-clock and server-clock times kept apart. */
export function buildAppealEvidenceText(session: AppealSessionInput): string

/** Draft an appeal letter (the async /draft-appeal worker). */
export function handleDraftAppeal(event: LambdaEvent): Promise<unknown>
