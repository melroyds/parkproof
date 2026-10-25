// Types for lambda/cloud-sync.js. The browser never imports it; the client
// tests do, so a client upload goes through the same merge the server runs.
// Rows are typed loosely: a stored row is a ParkingSession (src/types.ts)
// plus the server's own attributes.

type Row = Record<string, unknown>
type HandlerEvent = { body?: string | null; requestContext?: unknown }

export declare const ALLOWED_SESSION_FIELDS: readonly string[]
/** Whitelisted, but never stored from an upload: they describe one device's copy. */
export declare const DEVICE_LOCAL_FIELDS: readonly string[]
export declare const LEGACY_PHOTO_FIELDS: Readonly<{ sign: 'sign_photo'; car: 'car_photo'; ambient: 'ambient_photo' }>
export declare const MAX_SESSION_ITEM_BYTES: number
export declare const MAX_USER_OBJECTS: number
export declare const MAX_ADDENDA: number
export declare const MAX_PHOTO_REFS: number
export declare const MAX_UPLOAD_ATTEMPTS: number
export declare const ERR_CONFLICT: 'ERR_CONFLICT'
export declare const SHA256_HEX_RE: RegExp

export declare function isValidSessionId(id: unknown): boolean
export declare function legacyPhotoKey(userId: string, sessionId: string, role: 'sign' | 'car' | 'ambient'): string
export declare function refPhotoKey(userId: string, sessionId: string, sha256: string): string

/** Union by id; a stored signed addendum is never dropped; capped at MAX_ADDENDA. */
export declare function mergeAddendaRows(stored: unknown, incoming: unknown): Row[]
export declare function mergePhotoRefs(stored: unknown, incoming: unknown): Row[]
/** The row to store when an upload meets the stored row (null for a new record). */
export declare function mergeSessionRows(stored: Row | null, incoming: Row): Row
/** The whitelisted, shape-checked fields of an uploaded record. Throws a 400-shaped error. */
export declare function readIncomingSession(session: unknown): Row
export declare function readPhotoTarget(
  body: unknown,
  userId: string,
): { sessionId: string; key: string; sha256?: string; role?: 'sign' | 'car' | 'ambient' }

export declare function handleSessionsUpload(event: HandlerEvent): Promise<Row>
export declare function handleSessionsList(event: HandlerEvent): Promise<{ sessions: Row[] }>
export declare function handleSessionsDelete(event: HandlerEvent): Promise<Row>
export declare function handlePhotosPresign(event: HandlerEvent): Promise<Row>
export declare function handlePhotosMaterialize(event: HandlerEvent): Promise<{ data_url: string | null }>
export declare function handleMeExport(event: HandlerEvent): Promise<Row>
export declare function handleMeDelete(event: HandlerEvent): Promise<Row>
