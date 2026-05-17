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

export function handler(event: LambdaEvent): Promise<{
  statusCode: number
  headers: Record<string, string>
  body: string
}>
