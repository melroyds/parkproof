// @vitest-environment node
//
// Interop between the signer and the browser verifier (spec T0b3).
//
// The Lambda and KMS produce DER ECDSA signatures; the browser verifier
// (src/lib/verify.ts) converts DER to raw r||s and checks it with WebCrypto.
// Here the signatures come from Node's OpenSSL (`crypto.sign`), which emits
// the same DER that KMS does, including integers that need a 0x00 sign
// byte (33 bytes) and integers shorter than 32 bytes. The browser-side
// tests (src/lib/verify.test.ts) build their DER by hand instead.
//
//   1. 1,000 signatures from one local key all verify, and a changed
//      payload never does.
//   2. A chain signed by the real /sign-session handler, with a Node
//      signer standing in for KMS, verifies link by link in the browser
//      verifier.
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { handleSignSession, canonicalize } from './index.js'
import { ADDENDUM_SCHEMA, EVIDENCE_V2_SCHEMA } from './addendum-schema.js'
import { derToRawSignature, importPublicKeyPem, verifyRecord, verifySignature } from '../src/lib/verify.ts'

const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' })

/** The DER integer lengths (r, s) of a signature. */
function integerLengths(der) {
  const rLen = der[3]
  return [rLen, der[5 + rLen]]
}

describe('1,000 OpenSSL signatures through the browser verifier', () => {
  it('every one verifies, and a changed payload never does', async () => {
    const key = await importPublicKeyPem(PUBLIC_PEM)
    const lengths = new Set()
    let failures = 0
    for (let i = 0; i < 1000; i++) {
      const payload = canonicalize({ n: i, nonce: crypto.randomBytes(8).toString('hex'), schema: 'parkproof-evidence-v1' })
      const der = crypto.sign('sha256', Buffer.from(payload, 'utf8'), privateKey)
      for (const len of integerLengths(der)) lengths.add(len)
      const raw = derToRawSignature(new Uint8Array(der))
      expect(raw.length).toBe(64)
      const b64 = der.toString('base64')
      if (!(await verifySignature([key], payload, b64))) failures++
      if (i % 50 === 0) {
        expect(await verifySignature([key], payload.replace('"n":', '"m":'), b64)).toBe(false)
      }
    }
    expect(failures).toBe(0)
    // Half of all integers need the 0x00 sign byte, so 33-byte integers
    // show up in practice; shorter-than-32 ones turn up about 8 times in
    // 2,000 integers (the hand-made vectors cover them for certain).
    expect(lengths.has(33)).toBe(true)
    expect(lengths.has(32)).toBe(true)
  }, 60_000) // heavy: 1,000 signatures; slow CI runners need more than the 5 s default
})

describe('a chain signed by the real handler', () => {
  const nodeSigner = ({ message }) => crypto.sign('sha256', Buffer.from(message), privateKey)
  const sign = (body) =>
    handleSignSession(
      { body: JSON.stringify(body) },
      { signer: nodeSigner, keyAlias: 'alias/parkproof-evidence-signing', parentPublicKeys: [PUBLIC_PEM] },
    )

  it('verifies link 0 (v2) and two addenda, and catches a changed link', async () => {
    const id = crypto.randomUUID()
    const chain_key = crypto.randomBytes(32).toString('hex')
    const now = Date.now()
    const session = {
      id,
      arrived_at: new Date(now - 60_000).toISOString(),
      expires_at: new Date(now + 3_600_000).toISOString(),
      location: { lat: -27.4698, lng: 153.0251, address: '1 Queen St', source: 'gps', accuracy_meters: 6 },
      sign_photo: null,
      car_photo: null,
      rules: '1P 7am-6pm',
      observations: [],
      confidence: 'medium',
      chain_key,
      addenda: [],
    }
    session.signature = await sign({
      schema: EVIDENCE_V2_SCHEMA,
      session_id: id,
      arrived_at: session.arrived_at,
      expires_at: session.expires_at,
      location: session.location,
      rules: session.rules,
      chosen_label: null,
      confidence: session.confidence,
      no_sign: false,
      sign_photo_sha256: 'a'.repeat(64),
      ambient_photo_sha256: null,
      car_photo_sha256: null,
      chain_key_sha256: crypto.createHash('sha256').update(chain_key, 'utf8').digest('hex'),
    })

    let parent = session.signature
    const links = [
      ['departure', { ended_at: new Date(now).toISOString(), location: null, distance_from_arrival_m: null, return_photos: [] }],
      ['handover', { from_driver: 'Alex', to_driver: 'Sam', handed_over_at: new Date(now).toISOString(), location: null }],
    ]
    for (const [kind, data] of links) {
      const addendum = { id: crypto.randomUUID(), seq: session.addenda.length + 1, kind, captured_at: new Date().toISOString(), data }
      addendum.bundle = await sign({
        schema: ADDENDUM_SCHEMA,
        addendum_id: addendum.id,
        kind,
        session_id: id,
        seq: addendum.seq,
        captured_at: addendum.captured_at,
        chain_key,
        parent: { canonical_payload: parent.canonical_payload, signature_base64: parent.signature_base64 },
        data,
      })
      session.addenda.push(addendum)
      parent = addendum.bundle
    }

    const result = await verifyRecord(session, { publicKeys: [PUBLIC_PEM], arrivalRejection: null })
    expect(result.links.map((l) => `${l.kind}#${l.seq}:${l.status}`)).toEqual([
      'arrival#0:valid',
      'departure#1:valid',
      'handover#2:valid',
    ])
    expect(result.overall).toBe('valid')
    expect(result.chain_key_on_device).toBe('matches')
    // The signed sign-photo hash has no bytes on this device.
    expect(result.photos).toEqual([
      expect.objectContaining({ role: 'sign', status: 'not_on_device', signer: 'parkproof', link_indexes: [0] }),
    ])

    const changed = {
      ...session,
      addenda: [
        { ...session.addenda[0], bundle: { ...session.addenda[0].bundle, canonical_payload: session.addenda[0].bundle.canonical_payload.replace('"seq":1', '"seq":1 ') } },
        session.addenda[1],
      ],
    }
    const bad = await verifyRecord(changed, { publicKeys: [PUBLIC_PEM], arrivalRejection: null })
    expect(bad.links.map((l) => l.status)).toEqual(['valid', 'invalid', 'invalid'])
    expect(bad.links[1].problems).toEqual(['signature'])
    expect(bad.links[2].problems).toEqual(['parent_hash'])
    // The child is still exactly what the handler signed; only its parent changed.
    expect(bad.links[2].signature_ok).toBe(true)
  })
})
