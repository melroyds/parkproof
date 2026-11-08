// Types for lambda/addendum-schema.js, which the browser imports too.
// The data shapes themselves live in src/types.ts (SignedAddendum and the
// per-kind data types); this file only types the module's API.

export declare const EVIDENCE_V1_SCHEMA: 'parkproof-evidence-v1'
export declare const EVIDENCE_V2_SCHEMA: 'parkproof-evidence-v2'
export declare const ADDENDUM_SCHEMA: 'parkproof-addendum-v1'

export type AddendumErrorCode =
  | 'ERR_BAD_REQUEST'
  | 'ERR_MISSING_FIELD'
  | 'ERR_UNKNOWN_FIELD'
  | 'ERR_BAD_STRING'
  | 'ERR_BAD_VALUE'
  | 'ERR_BAD_TIME'
  | 'ERR_TOO_LARGE'
  | 'ERR_PARENT_SIGNATURE'
  | 'ERR_PARENT_MISMATCH'
  | 'ERR_CHAIN_KEY'
  | 'ERR_FUTURE_TIME'

export declare const ERR: Readonly<{
  BAD_REQUEST: 'ERR_BAD_REQUEST'
  MISSING_FIELD: 'ERR_MISSING_FIELD'
  UNKNOWN_FIELD: 'ERR_UNKNOWN_FIELD'
  BAD_STRING: 'ERR_BAD_STRING'
  BAD_VALUE: 'ERR_BAD_VALUE'
  BAD_TIME: 'ERR_BAD_TIME'
  TOO_LARGE: 'ERR_TOO_LARGE'
  PARENT_SIGNATURE: 'ERR_PARENT_SIGNATURE'
  PARENT_MISMATCH: 'ERR_PARENT_MISMATCH'
  CHAIN_KEY: 'ERR_CHAIN_KEY'
  FUTURE_TIME: 'ERR_FUTURE_TIME'
}>

export declare const CAPS: Readonly<{
  driverName: number
  signIssue: number
  signIssues: number
  arrivalPhotos: number
  note: number
  paymentMethod: number
  paymentMethods: number
  permitArea: number
  conditionPhotosMin: number
  conditionPhotosMax: number
  returnPhotos: number
  previousSessionId: number
  askedBecause: number
  legIndexMax: number
  sessionId: number
  maxSeq: number
  signatureBase64: number
  parentPayloadBytes: number
  bodyBytes: number
  futureSkewMs: number
}>

export type AddendumKindName = 'arrival_context' | 'condition' | 'compliance' | 'departure' | 'handover'

export declare const ADDENDUM_KINDS: readonly AddendumKindName[]
export declare const PHOTO_ROLES: readonly string[]
export declare const PHOTO_SOURCES: readonly string[]
export declare const SIGN_STATUSES: readonly string[]
export declare const JURISDICTIONS: readonly string[]
export declare const COMPLIANCE_TYPES: readonly string[]
export declare const CONDITION_WHEN: readonly string[]
export declare const BOUNDARY_ASKED_BECAUSE: readonly string[]
export declare const BOUNDARY_ANSWERS: readonly string[]
export declare const ADDENDUM_BODY_KEYS: readonly string[]
export declare const KIND_SCHEMAS: Readonly<Record<AddendumKindName, unknown>>

export declare const ISO_TIME_RE: RegExp
export declare const HEX64_RE: RegExp
export declare const UUID_RE: RegExp
export declare const FORBIDDEN_CHARS_RE: RegExp

export declare class AddendumValidationError extends Error {
  constructor(code: AddendumErrorCode, path: string)
  readonly code: AddendumErrorCode
  readonly path: string
  readonly statusCode: 400
}

export declare function canonicalize(value: unknown): string
export declare function hasForbiddenChars(s: string): boolean
export declare function isIsoTime(s: unknown): s is string
export declare function utf8ByteLength(s: string): number

/** Validated plain copy of `data`, exactly the kind's keys. Throws AddendumValidationError. */
export declare function normalizeAddendumData(
  kind: AddendumKindName,
  data: unknown,
  path?: string,
): Record<string, unknown>

export interface AddendumSignRequest {
  schema: 'parkproof-addendum-v1'
  addendum_id: string
  kind: AddendumKindName
  session_id: string
  seq: number
  captured_at: string
  /** The record's chain secret (hex), or null when link 0 is a v1 bundle. */
  chain_key: string | null
  parent: { canonical_payload: string; signature_base64: string }
  data: Record<string, unknown>
}

export declare function validateAddendumBody(body: unknown): AddendumSignRequest

export interface AddendumPayload {
  schema: 'parkproof-addendum-v1'
  addendum_id: string
  kind: AddendumKindName
  session_id: string
  seq: number
  parent_payload_sha256: string
  chain_key_sha256: string | null
  captured_at: string
  signed_at: string
  data: Record<string, unknown>
}

export declare function buildAddendumPayload(
  fields: Omit<AddendumPayload, 'schema' | 'signed_at' | 'chain_key_sha256'> & {
    chain_key_sha256?: string | null
  },
  signed_at: string,
): AddendumPayload

export declare function clientTimesToCheck(
  request: Pick<AddendumSignRequest, 'kind' | 'captured_at' | 'data'>,
): Array<[string, unknown]>
