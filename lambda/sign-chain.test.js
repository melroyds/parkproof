// @vitest-environment node
//
// /sign-session after the evidence chain (spec N2, T0b1):
//   - golden vectors for v1 (byte-identical to the pre-chain handler),
//     v2 and the addendum payload
//   - the KMS call: DIGEST mode, Message = sha256(expected canonical bytes),
//     answered by a mock that really signs with a local P-256 key (DER)
//   - every server check on an addendum: parent signature, parent
//     session/seq, chain key, future times, sizes
//   - validation (and the parent checks) run before the KMS_KEY_ID check
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const kms = vi.hoisted(() => ({
  calls: [],
  /** Called with the SignCommand input; returns the Signature bytes. */
  respond: null,
}))
vi.mock('@aws-sdk/client-kms', () => {
  class KMSClient {
    async send(cmd) {
      kms.calls.push(cmd.input)
      return { Signature: kms.respond(cmd.input) }
    }
  }
  class SignCommand {
    constructor(input) {
      this.input = input
    }
  }
  return { KMSClient, SignCommand }
})

import {
  PARKPROOF_PUBLIC_KEY_PEM,
  buildEvidenceV1Payload,
  buildEvidenceV2Payload,
  chainKeyHash,
  canonicalize,
  handleSignSession,
  handleSignSessionRequest,
} from './index.js'
import { ERR } from './addendum-schema.js'

const A64 = 'a'.repeat(64)
const B64 = 'b'.repeat(64)
const C64 = 'c'.repeat(64)
const SID = '6f1c2a3b-4d5e-4f60-8a71-b2c3d4e5f607'
const CHAIN_KEY = '0123456789abcdef'.repeat(4)
const CHAIN_HASH = 'a8ae6e6ee929abea3afcfc5258c8ccd6f85273e0d4626d26c7279f3250f77c8e'
const ADD_ID = '0b6f7c1e-2d3a-4b5c-8d9e-0f1a2b3c4d5e'
const ADD_ID_2 = '1c7a8d2f-3e4b-4c6d-9e0f-1a2b3c4d5e6f'
const SIGNED_AT = '2026-05-21T08:00:05.000Z'

const V1_BODY = {
  session_id: SID,
  arrived_at: '2026-05-21T08:00:00.000Z',
  expires_at: '2026-05-21T10:00:00.000Z',
  location: {
    lat: -37.8136,
    lng: 144.9631,
    address: '12 King St, Melbourne VIC 3000',
    source: 'gps',
    accuracy_meters: 8,
  },
  rules: '2P Mon-Fri 8am-6pm',
  chosen_label: 'Left side',
  confidence: 'high',
  no_sign: false,
  sign_photo_sha256: A64,
  ambient_photo_sha256: null,
  car_photo_sha256: B64,
}

const NO_SIGN_BODY = {
  session_id: 'rec-no-sign',
  arrived_at: '2026-05-21T08:00:00.000Z',
  location: null,
  rules: '',
  confidence: 'low',
  no_sign: true,
  sign_photo_sha256: null,
  ambient_photo_sha256: C64,
  car_photo_sha256: null,
}

// Captured from the handler BEFORE the chain refactor. If either string
// has to change, that is a signature-format break for every v1 record.
const GOLDEN_V1 =
  '{"ambient_photo_sha256":null,"arrived_at":"2026-05-21T08:00:00.000Z",' +
  '"car_photo_sha256":"' + B64 + '","chosen_label":"Left side","confidence":"high",' +
  '"expires_at":"2026-05-21T10:00:00.000Z",' +
  '"location":{"accuracy_meters":8,"address":"12 King St, Melbourne VIC 3000","lat":-37.8136,"lng":144.9631,"source":"gps"},' +
  '"no_sign":false,"rules":"2P Mon-Fri 8am-6pm","schema":"parkproof-evidence-v1",' +
  '"session_id":"' + SID + '","sign_photo_sha256":"' + A64 + '","signed_at":"2026-05-21T08:00:05.000Z"}'

const GOLDEN_V1_NO_SIGN =
  '{"ambient_photo_sha256":"' + C64 + '","arrived_at":"2026-05-21T08:00:00.000Z",' +
  '"car_photo_sha256":null,"chosen_label":null,"confidence":"low","expires_at":null,' +
  '"location":null,"no_sign":true,"rules":"","schema":"parkproof-evidence-v1",' +
  '"session_id":"rec-no-sign","sign_photo_sha256":null,"signed_at":"2026-05-21T08:00:05.000Z"}'

const GOLDEN_V2 =
  '{"ambient_photo_sha256":null,"arrived_at":"2026-05-21T08:00:00.000Z",' +
  '"car_photo_sha256":"' + B64 + '","chain_key_sha256":"' + CHAIN_HASH + '",' +
  '"chosen_label":"Left side","confidence":"high","expires_at":"2026-05-21T10:00:00.000Z",' +
  '"location":{"accuracy_meters":8,"address":"12 King St, Melbourne VIC 3000","lat":-37.8136,"lng":144.9631,"source":"gps"},' +
  '"no_sign":false,"rules":"2P Mon-Fri 8am-6pm","schema":"parkproof-evidence-v2",' +
  '"session_id":"' + SID + '","sign_photo_sha256":"' + A64 + '","signed_at":"2026-05-21T08:00:05.000Z"}'

const GOLDEN_V2_SHA256 = 'e93576cb2bea4262cc5f1833a68c724a87471d4e4255129a647b0fd84e66b942'

const EMPTY_ARRIVAL = {
  driver_name: null,
  sign_status: null,
  sign_issues: [],
  rule_flags: null,
  gate_acks: null,
  permit_commitment: null,
  photos: [],
  condition_note: null,
  compliance_type: null,
  jurisdiction: null,
  workday: null,
  boundary: null,
}

const GOLDEN_ADDENDUM =
  '{"addendum_id":"' + ADD_ID + '","captured_at":"2026-05-21T08:00:01.000Z",' +
  '"chain_key_sha256":"' + CHAIN_HASH + '",' +
  '"data":{"boundary":null,"compliance_type":null,"condition_note":null,"driver_name":null,' +
  '"gate_acks":null,"jurisdiction":null,"permit_commitment":null,"photos":[],"rule_flags":null,' +
  '"sign_issues":[],"sign_status":null,"workday":null},' +
  '"kind":"arrival_context","parent_payload_sha256":"' + GOLDEN_V2_SHA256 + '",' +
  '"schema":"parkproof-addendum-v1","seq":1,"session_id":"' + SID + '",' +
  '"signed_at":"2026-05-21T08:00:06.000Z"}'

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest()
const sha256Hex = (s) => sha256(s).toString('hex')

// The "KMS" key for these tests, and a second key nobody trusts.
const testKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const TEST_PUBLIC_PEM = testKey.publicKey.export({ type: 'spki', format: 'pem' })
const otherKey = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })

/** KMS mock answer: really sign the bytes whose digest KMS was handed. */
let expectedMessage = null
function signLikeKms(input) {
  if (expectedMessage !== null) {
    expect(Buffer.from(input.Message).equals(sha256(expectedMessage))).toBe(true)
  }
  expect(input.MessageType).toBe('DIGEST')
  expect(input.SigningAlgorithm).toBe('ECDSA_SHA_256')
  // KMS signs the digest; signing the message with sha256 is the same
  // operation, and returns DER just as KMS does.
  return new Uint8Array(crypto.sign('sha256', Buffer.from(lastPayload(), 'utf8'), testKey.privateKey))
}
// The handler hands KMS only a digest, so the mock signs the canonical
// payload the test predicted: `expectedMessage` (also asserted against the
// digest) or, for set-up signing that isn't under test, `pendingPayload`.
let pendingPayload = null
function lastPayload() {
  return expectedMessage ?? pendingPayload
}

const verifies = (bundle, publicKey = testKey.publicKey) =>
  crypto.verify(
    'sha256',
    Buffer.from(bundle.canonical_payload, 'utf8'),
    publicKey,
    Buffer.from(bundle.signature_base64, 'base64'),
  )

const call = (body, options) => handleSignSession({ body: JSON.stringify(body) }, options)
const request = (body, options) => handleSignSessionRequest({ body: JSON.stringify(body) }, options)

/** A local signer with the same shape the dev server uses. */
const localSigner = ({ message }) => crypto.sign('sha256', message, testKey.privateKey)
const TRUST_TEST_KEY = { signer: localSigner, keyAlias: 'test-local', parentPublicKeys: [TEST_PUBLIC_PEM] }

function freeze(iso) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

beforeEach(() => {
  kms.calls.length = 0
  kms.respond = signLikeKms
  expectedMessage = null
  pendingPayload = null
  process.env.KMS_KEY_ID = 'test-key-id'
})

afterEach(() => {
  vi.useRealTimers()
  delete process.env.KMS_KEY_ID
})

describe('link 0 golden vectors', () => {
  it('buildEvidenceV1Payload is byte-identical to the pre-chain handler', () => {
    expect(canonicalize(buildEvidenceV1Payload(V1_BODY, SIGNED_AT))).toBe(GOLDEN_V1)
    expect(canonicalize(buildEvidenceV1Payload(NO_SIGN_BODY, SIGNED_AT))).toBe(GOLDEN_V1_NO_SIGN)
  })

  it('a v1 request signs the golden bytes through KMS in DIGEST mode', async () => {
    freeze(SIGNED_AT)
    expectedMessage = GOLDEN_V1
    const bundle = await call(V1_BODY)
    expect(bundle.canonical_payload).toBe(GOLDEN_V1)
    expect(bundle.schema).toBe('parkproof-evidence-v1')
    expect(bundle.signed_at).toBe(SIGNED_AT)
    expect(bundle.algorithm).toBe('ECDSA_SHA_256')
    expect(bundle.key_alias).toBe('alias/parkproof-evidence-signing')
    expect(kms.calls).toHaveLength(1)
    expect(kms.calls[0].KeyId).toBe('test-key-id')
    expect(Buffer.from(kms.calls[0].Message).equals(sha256(GOLDEN_V1))).toBe(true)
    expect(kms.calls[0].MessageType).toBe('DIGEST')
    expect(verifies(bundle)).toBe(true)
  })

  it('a v1 body that names its schema signs the same bytes', async () => {
    freeze(SIGNED_AT)
    expectedMessage = GOLDEN_V1
    const bundle = await call({ ...V1_BODY, schema: 'parkproof-evidence-v1' })
    expect(bundle.canonical_payload).toBe(GOLDEN_V1)
  })

  it('a no-sign v1 request signs its golden bytes', async () => {
    freeze(SIGNED_AT)
    expectedMessage = GOLDEN_V1_NO_SIGN
    const bundle = await call(NO_SIGN_BODY)
    expect(bundle.canonical_payload).toBe(GOLDEN_V1_NO_SIGN)
    expect(verifies(bundle)).toBe(true)
  })

  it('v2 = every v1 field plus chain_key_sha256', async () => {
    expect(chainKeyHash(CHAIN_KEY)).toBe(CHAIN_HASH)
    const body = { ...V1_BODY, schema: 'parkproof-evidence-v2', chain_key_sha256: CHAIN_HASH }
    expect(canonicalize(buildEvidenceV2Payload(body, SIGNED_AT))).toBe(GOLDEN_V2)
    expect(sha256Hex(GOLDEN_V2)).toBe(GOLDEN_V2_SHA256)

    freeze(SIGNED_AT)
    expectedMessage = GOLDEN_V2
    const bundle = await call(body)
    expect(bundle.schema).toBe('parkproof-evidence-v2')
    expect(bundle.canonical_payload).toBe(GOLDEN_V2)
    expect(verifies(bundle)).toBe(true)
  })

  it('v2 requires a lowercase 64-hex chain_key_sha256', async () => {
    const res1 = await request({ ...V1_BODY, schema: 'parkproof-evidence-v2' })
    expect(res1.statusCode).toBe(400)
    expect(JSON.parse(res1.body).error).toBe(ERR.MISSING_FIELD)
    const res2 = await request({ ...V1_BODY, schema: 'parkproof-evidence-v2', chain_key_sha256: CHAIN_HASH.toUpperCase() })
    expect(res2.statusCode).toBe(400)
    expect(JSON.parse(res2.body).error).toBe(ERR.BAD_VALUE)
    expect(kms.calls).toHaveLength(0)
  })

  it('an unknown schema is a 400', async () => {
    const res = await request({ ...V1_BODY, schema: 'parkproof-evidence-v9' })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error: ERR.BAD_VALUE, field: 'schema' })
  })
})

/** Sign link 0 (v2 unless told otherwise) with the KMS mock. */
async function signLinkZero({ v1 = false, at = SIGNED_AT } = {}) {
  freeze(at)
  const body = v1 ? V1_BODY : { ...V1_BODY, schema: 'parkproof-evidence-v2', chain_key_sha256: CHAIN_HASH }
  pendingPayload = canonicalize(v1 ? buildEvidenceV1Payload(body, at) : buildEvidenceV2Payload(body, at))
  const bundle = await call(body)
  pendingPayload = null
  vi.useRealTimers()
  return bundle
}

function addendumBody(parentBundle, overrides = {}) {
  return {
    schema: 'parkproof-addendum-v1',
    addendum_id: ADD_ID,
    kind: 'arrival_context',
    session_id: SID,
    seq: 1,
    captured_at: '2026-05-21T08:00:01.000Z',
    chain_key: CHAIN_KEY,
    parent: {
      canonical_payload: parentBundle.canonical_payload,
      signature_base64: parentBundle.signature_base64,
    },
    data: EMPTY_ARRIVAL,
    ...overrides,
  }
}

describe('addendum golden vector and the chain', () => {
  it('signs the golden addendum payload over a v2 parent', async () => {
    const parent = await signLinkZero()
    expect(parent.canonical_payload).toBe(GOLDEN_V2)

    freeze('2026-05-21T08:00:06.000Z')
    expectedMessage = GOLDEN_ADDENDUM
    kms.calls.length = 0
    const bundle = await call(addendumBody(parent), { parentPublicKeys: [TEST_PUBLIC_PEM] })
    expect(bundle.canonical_payload).toBe(GOLDEN_ADDENDUM)
    expect(bundle.schema).toBe('parkproof-addendum-v1')
    expect(bundle.key_alias).toBe('alias/parkproof-evidence-signing')
    expect(kms.calls).toHaveLength(1)
    expect(kms.calls[0].MessageType).toBe('DIGEST')
    expect(verifies(bundle)).toBe(true)
  })

  it('links 0, 1 and 2: each parent hash and the chain key hash carry forward', async () => {
    const link0 = await signLinkZero()
    freeze('2026-05-21T09:00:00.000Z')
    const link1 = await call(addendumBody(link0), TRUST_TEST_KEY)
    const link2 = await call(
      addendumBody(link1, {
        addendum_id: ADD_ID_2,
        kind: 'departure',
        seq: 2,
        captured_at: '2026-05-21T08:59:00.000Z',
        data: { ended_at: '2026-05-21T08:58:30.000Z', location: null, distance_from_arrival_m: null, return_photos: [] },
      }),
      TRUST_TEST_KEY,
    )
    const p1 = JSON.parse(link1.canonical_payload)
    const p2 = JSON.parse(link2.canonical_payload)
    expect(p1.parent_payload_sha256).toBe(sha256Hex(link0.canonical_payload))
    expect(p2.parent_payload_sha256).toBe(sha256Hex(link1.canonical_payload))
    expect(p1.chain_key_sha256).toBe(CHAIN_HASH)
    expect(p2.chain_key_sha256).toBe(CHAIN_HASH)
    expect([p1.seq, p2.seq]).toEqual([1, 2])
    expect(p2.data.ended_at).toBe('2026-05-21T08:58:30.000Z')
    expect(link2.key_alias).toBe('test-local')
    // The payload carries only the key's hash, never the key.
    expect(link1.canonical_payload).not.toContain(CHAIN_KEY)
    expect(link2.canonical_payload).not.toContain(CHAIN_KEY)
    expect(verifies(link1) && verifies(link2)).toBe(true)
  })

  it('a v1 chain has no key: chain_key null in, chain_key_sha256 null out', async () => {
    const link0 = await signLinkZero({ v1: true })
    const link1 = await call(addendumBody(link0, { chain_key: null }), TRUST_TEST_KEY)
    expect(JSON.parse(link1.canonical_payload).chain_key_sha256).toBeNull()
  })

  it('the signed data is exactly the normalised request data', async () => {
    const link0 = await signLinkZero()
    const data = {
      ...EMPTY_ARRIVAL,
      driver_name: 'Sam',
      gate_acks: { accessible_permit: null, permit_zone: true, meter_ticket: null },
    }
    const link1 = await call(addendumBody(link0, { data }), TRUST_TEST_KEY)
    expect(canonicalize(JSON.parse(link1.canonical_payload).data)).toBe(canonicalize(data))
  })
})

describe('server checks', () => {
  const codeOf = async (body, options = TRUST_TEST_KEY) => {
    const res = await request(body, options)
    return { status: res.statusCode, ...JSON.parse(res.body) }
  }

  it('ERR_PARENT_SIGNATURE: a tampered parent payload', async () => {
    const link0 = await signLinkZero()
    const tampered = { ...link0, canonical_payload: link0.canonical_payload.replace('2P Mon-Fri', '4P Mon-Fri') }
    expect(await codeOf(addendumBody(tampered))).toMatchObject({ status: 400, error: ERR.PARENT_SIGNATURE })
  })

  it('ERR_PARENT_SIGNATURE: a parent signed by an untrusted key', async () => {
    const payload = canonicalize(buildEvidenceV2Payload({ ...V1_BODY, chain_key_sha256: CHAIN_HASH }, SIGNED_AT))
    const forged = {
      canonical_payload: payload,
      signature_base64: crypto.sign('sha256', Buffer.from(payload), otherKey.privateKey).toString('base64'),
    }
    expect(await codeOf(addendumBody(forged))).toMatchObject({ status: 400, error: ERR.PARENT_SIGNATURE })
  })

  it('ERR_PARENT_SIGNATURE: production trusts only the published key', async () => {
    const link0 = await signLinkZero() // signed by the test key, not ParkProof's
    const res = await request(addendumBody(link0)) // no options: production defaults
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe(ERR.PARENT_SIGNATURE)
  })

  it('ERR_PARENT_MISMATCH: the parent belongs to another record', async () => {
    const link0 = await signLinkZero()
    expect(await codeOf(addendumBody(link0, { session_id: 'someone-else' }))).toMatchObject({
      status: 400,
      error: ERR.PARENT_MISMATCH,
      field: 'parent.session_id',
    })
  })

  it('ERR_PARENT_MISMATCH: seq 2 on a link-0 parent, and a skipped seq on an addendum parent', async () => {
    const link0 = await signLinkZero()
    expect(await codeOf(addendumBody(link0, { seq: 2 }))).toMatchObject({ error: ERR.PARENT_MISMATCH, field: 'seq' })
    const link1 = await call(addendumBody(link0), TRUST_TEST_KEY)
    expect(await codeOf(addendumBody(link1, { addendum_id: ADD_ID_2, seq: 3 }))).toMatchObject({
      error: ERR.PARENT_MISMATCH,
      field: 'seq',
    })
    expect(await codeOf(addendumBody(link1, { addendum_id: ADD_ID_2, seq: 1 }))).toMatchObject({
      error: ERR.PARENT_MISMATCH,
    })
  })

  it('ERR_PARENT_MISMATCH: a validly signed parent of an unknown schema', async () => {
    const payload = canonicalize({ schema: 'something-else', session_id: SID, seq: 0 })
    const parent = {
      canonical_payload: payload,
      signature_base64: crypto.sign('sha256', Buffer.from(payload), testKey.privateKey).toString('base64'),
    }
    expect(await codeOf(addendumBody(parent))).toMatchObject({ error: ERR.PARENT_MISMATCH, field: 'parent.schema' })
  })

  it('ERR_CHAIN_KEY: wrong key, missing key, or a key for a v1 chain', async () => {
    const link0 = await signLinkZero()
    expect(await codeOf(addendumBody(link0, { chain_key: 'f'.repeat(64) }))).toMatchObject({ error: ERR.CHAIN_KEY })
    expect(await codeOf(addendumBody(link0, { chain_key: null }))).toMatchObject({ error: ERR.CHAIN_KEY })
    const v1 = await signLinkZero({ v1: true })
    expect(await codeOf(addendumBody(v1, { chain_key: CHAIN_KEY }))).toMatchObject({ error: ERR.CHAIN_KEY })
  })

  it('ERR_CHAIN_KEY is checked on every link, not just link 1', async () => {
    const link0 = await signLinkZero()
    const link1 = await call(addendumBody(link0), TRUST_TEST_KEY)
    expect(
      await codeOf(addendumBody(link1, { addendum_id: ADD_ID_2, seq: 2, chain_key: 'f'.repeat(64) })),
    ).toMatchObject({ error: ERR.CHAIN_KEY })
  })

  it('ERR_FUTURE_TIME: client times more than 5 minutes ahead of the server', async () => {
    const link0 = await signLinkZero()
    freeze('2026-05-21T08:00:00.000Z')
    const ahead6 = '2026-05-21T08:06:00.000Z'
    const ahead4 = '2026-05-21T08:04:00.000Z'
    expect(await codeOf(addendumBody(link0, { captured_at: ahead6 }))).toMatchObject({
      error: ERR.FUTURE_TIME,
      field: 'captured_at',
    })
    const departure = (ended_at) => ({ ended_at, location: null, distance_from_arrival_m: null, return_photos: [] })
    expect(
      await codeOf(addendumBody(link0, { kind: 'departure', captured_at: ahead4, data: departure(ahead6) })),
    ).toMatchObject({ error: ERR.FUTURE_TIME, field: 'data.ended_at' })
    const handover = { from_driver: null, to_driver: 'Alex', handed_over_at: ahead6, location: null }
    expect(await codeOf(addendumBody(link0, { kind: 'handover', data: handover }))).toMatchObject({
      error: ERR.FUTURE_TIME,
      field: 'data.handed_over_at',
    })
    // Within the 5-minute allowance is fine.
    const ok = await request(addendumBody(link0, { kind: 'departure', captured_at: ahead4, data: departure(ahead4) }), TRUST_TEST_KEY)
    expect(ok.statusCode).toBe(200)
  })

  it('ERR_TOO_LARGE: a body over 32 KB, before parsing', async () => {
    const res = await handleSignSessionRequest({ body: JSON.stringify({ ...V1_BODY, rules: 'x'.repeat(33 * 1024) }) })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe(ERR.TOO_LARGE)
  })

  it('ERR_BAD_REQUEST: a body that is not a JSON object', async () => {
    for (const body of ['{not json', 'null', '[1,2]']) {
      const res = await handleSignSessionRequest({ body })
      expect(res.statusCode).toBe(400)
      expect(JSON.parse(res.body).error).toBe(ERR.BAD_REQUEST)
    }
  })

  it('an invalid addendum is a 400 and reaches no signer', async () => {
    const link0 = await signLinkZero()
    kms.calls.length = 0
    const res = await request({ ...addendumBody(link0), extra: true })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error: ERR.UNKNOWN_FIELD, field: 'extra' })
    expect(kms.calls).toHaveLength(0)
  })

  it('logs codes and fields, never the submitted values', async () => {
    const link0 = await signLinkZero()
    const lines = []
    for (const m of ['log', 'warn', 'error', 'info']) {
      vi.spyOn(console, m).mockImplementation((...args) => lines.push(args.map(String).join(' ')))
    }
    const secret = 'PermitHolderSecretName'
    const data = { ...EMPTY_ARRIVAL, driver_name: secret + String.fromCharCode(10) }
    const res = await request(addendumBody(link0, { data }), TRUST_TEST_KEY)
    expect(res.statusCode).toBe(400)
    expect(res.body).not.toContain(secret)
    expect(lines.join('\n')).not.toContain(secret)
    expect(lines.join('\n')).toContain('ERR_BAD_STRING')
  })
})

describe('validation runs before the KMS_KEY_ID check', () => {
  beforeEach(() => {
    delete process.env.KMS_KEY_ID
  })

  it('an invalid v1 request is a 400 even without KMS_KEY_ID', async () => {
    const res = await request({ ...V1_BODY, session_id: '' })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error: ERR.MISSING_FIELD, field: 'session_id' })
  })

  it('v1 validation errors map to 400 with a code (they used to be 500s)', async () => {
    const res = await request({ ...V1_BODY, car_photo_sha256: 'xyz' })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body)).toMatchObject({ error: ERR.BAD_VALUE, field: 'car_photo_sha256' })
  })

  it('a forged parent is a 400 even without KMS_KEY_ID', async () => {
    process.env.KMS_KEY_ID = 'test-key-id'
    const link0 = await signLinkZero()
    delete process.env.KMS_KEY_ID
    const res = await request(addendumBody(link0)) // production keys: test key untrusted
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBe(ERR.PARENT_SIGNATURE)
  })

  it('a valid request without KMS_KEY_ID is a 500, not a signature', async () => {
    const res = await request(V1_BODY)
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body).error).toMatch(/KMS_KEY_ID/)
    expect(kms.calls).toHaveLength(0)
  })

  it('a local signer (the dev server) signs without KMS or KMS_KEY_ID', async () => {
    const bundle = await call(V1_BODY, { signer: localSigner, keyAlias: 'dev-ephemeral' })
    expect(bundle.key_alias).toBe('dev-ephemeral')
    expect(verifies(bundle)).toBe(true)
    expect(kms.calls).toHaveLength(0)
  })
})

describe('the embedded public key', () => {
  it('equals public/parkproof-public-key.pem (line endings normalised)', () => {
    const pemPath = fileURLToPath(new URL('../public/parkproof-public-key.pem', import.meta.url))
    const onDisk = readFileSync(pemPath, 'utf8').replace(/\r\n/g, '\n').trim()
    expect(PARKPROOF_PUBLIC_KEY_PEM.replace(/\r\n/g, '\n').trim()).toBe(onDisk)
  })

  it('is a P-256 public key', () => {
    const key = crypto.createPublicKey(PARKPROOF_PUBLIC_KEY_PEM)
    expect(key.asymmetricKeyType).toBe('ec')
    expect(key.asymmetricKeyDetails.namedCurve).toBe('prime256v1')
  })
})
