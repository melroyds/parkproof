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
  requestContext?: { http?: { method?: string; path?: string } }
  httpMethod?: string
  rawPath?: string
}

export function handler(event: LambdaEvent): Promise<{
  statusCode: number
  headers: Record<string, string>
  body: string
}>
