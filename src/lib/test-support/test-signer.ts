// Test-only: a local stand-in for ParkProof's signing key. `fetch` answers
// /api/sign-session with the REAL Lambda handler (lambda/index.js) signing
// with a fresh P-256 key, so every request the client builds is one the
// server accepts and every stored bundle verifies against `publicKey`.
// The same pattern as signing.test.ts, packaged for later tests.
import { handleSignSessionRequest } from '../../../lambda/index.js'

export interface TestSigner {
  /** The verifying key, for `verifyRecord(session, { publicKeys: [signer.publicKey] })`. */
  publicKey: CryptoKey
  publicPem: string
  /** Every /sign-session body the client sent, parsed. */
  calls: Array<Record<string, unknown>>
  /** A fetch to stub globally (`vi.stubGlobal('fetch', signer.fetch)`). */
  fetch: (input: string, init?: RequestInit) => Promise<Response>
}

const ECDSA = { name: 'ECDSA', hash: 'SHA-256' } as const

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))
}

/** One DER INTEGER from a 32-byte big-endian value. */
function derInteger(value: Uint8Array): number[] {
  let i = 0
  while (i < value.length - 1 && value[i] === 0) i++
  const body = Array.from(value.slice(i))
  if (body[0] & 0x80) body.unshift(0)
  return [0x02, body.length, ...body]
}

/** WebCrypto's raw r||s as the DER that KMS (and the Lambda) produce. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const r = derInteger(raw.slice(0, 32))
  const s = derInteger(raw.slice(32, 64))
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s])
}

/** A fresh signer. `keyAlias` defaults to a test alias (use 'dev-ephemeral' for dev-key links). */
export async function createTestSigner(options: { keyAlias?: string } = {}): Promise<TestSigner> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  const NL = String.fromCharCode(10)
  const publicPem = ['-----BEGIN PUBLIC KEY-----', bytesToBase64(spki).match(/.{1,64}/g)!.join(NL), '-----END PUBLIC KEY-----', ''].join(NL)
  const calls: Array<Record<string, unknown>> = []
  const fetch = async (_input: string, init?: RequestInit): Promise<Response> => {
    const text = String(init?.body ?? '')
    calls.push(JSON.parse(text) as Record<string, unknown>)
    const res = await handleSignSessionRequest(
      { body: text },
      {
        signer: async ({ message }) =>
          rawToDer(new Uint8Array(await crypto.subtle.sign(ECDSA, pair.privateKey, message as Uint8Array<ArrayBuffer>))),
        keyAlias: options.keyAlias ?? 'test-local',
        parentPublicKeys: [publicPem],
      },
    )
    return new Response(res.body, { status: res.statusCode })
  }
  return { publicKey: pair.publicKey, publicPem, calls, fetch }
}
