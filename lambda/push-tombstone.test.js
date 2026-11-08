// @vitest-environment node
// The dead-endpoint tombstone (lambda/push-tombstone.js) and the operator
// script that also writes it (scripts/send-test-push.mjs). The script used
// to DELETE the row on a 410, wiping the tombstone so the app's next re-send
// put the dead endpoint back, and it crashed on a tombstone row (new URL of
// an undefined endpoint). Now it writes the same conditional tombstone as
// dispatch and skips a row with no endpoint.
//
// No AWS and no push service: the DynamoDB client and web-push are fakes
// passed in.
import { describe, expect, it } from 'vitest'
import { isDeadEndpointStatus, pushEndpointHash, pushRegistrationPut, pushTombstonePut } from './push-tombstone.js'
import { sendTestPush } from '../scripts/send-test-push.mjs'

const DEVICE = '11111111-1111-4111-8111-111111111111'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'
const TABLE = 'parkproof-push-subscriptions'

describe('push-tombstone.js', () => {
  it('a tombstone holds the hash of the dead endpoint, no endpoint or keys, and only replaces that endpoint', () => {
    const put = pushTombstonePut({ table: TABLE, device_id: DEVICE, endpoint: ENDPOINT, nowSec: 1000 })
    expect(put).toEqual({
      TableName: TABLE,
      Item: {
        device_id: DEVICE,
        gone_endpoint_sha256: pushEndpointHash(ENDPOINT),
        gone_at: 1000,
        expires_at: 1000 + 90 * 24 * 60 * 60,
      },
      ConditionExpression: '#ep = :dead',
      ExpressionAttributeNames: { '#ep': 'endpoint' },
      ExpressionAttributeValues: { ':dead': ENDPOINT },
    })
    expect(pushEndpointHash(ENDPOINT)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('a registration write is refused by the tombstone of its own endpoint', () => {
    const item = { device_id: DEVICE, endpoint: ENDPOINT, p256dh: 'p', auth: 'a' }
    expect(pushRegistrationPut({ table: TABLE, item })).toEqual({
      TableName: TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(#gone) OR #gone <> :gone',
      ExpressionAttributeNames: { '#gone': 'gone_endpoint_sha256' },
      ExpressionAttributeValues: { ':gone': pushEndpointHash(ENDPOINT) },
    })
  })

  it('410 and 404 mean dead; anything else does not', () => {
    expect(isDeadEndpointStatus(410)).toBe(true)
    expect(isDeadEndpointStatus(404)).toBe(true)
    for (const status of [201, 400, 403, 413, 429, 500, undefined]) expect(isDeadEndpointStatus(status)).toBe(false)
  })
})

/** A fake document client over one row; `send` gets the real lib-dynamodb commands. */
function fakeDdb(row) {
  const state = { row: row === undefined ? undefined : structuredClone(row), calls: [] }
  state.send = async (cmd) => {
    const op = cmd.constructor.name
    state.calls.push({ op, input: cmd.input })
    if (op === 'GetCommand') return { Item: state.row === undefined ? undefined : structuredClone(state.row) }
    if (op === 'PutCommand') {
      if (cmd.input.ConditionExpression === '#ep = :dead' && state.row?.endpoint !== cmd.input.ExpressionAttributeValues[':dead']) {
        throw Object.assign(new Error('condition'), { name: 'ConditionalCheckFailedException' })
      }
      state.row = structuredClone(cmd.input.Item)
      return {}
    }
    throw new Error(`unexpected ${op}`)
  }
  return state
}

function fakePush(statusCode) {
  const sent = []
  return {
    sent,
    async sendNotification(subscription) {
      sent.push(subscription.endpoint)
      if (statusCode === 201) return { statusCode }
      throw Object.assign(new Error('push failed'), { statusCode })
    },
  }
}

const quiet = { log: () => {}, logError: () => {} }
const run = (ddb, push) => sendTestPush({ ddb, push, table: TABLE, deviceId: DEVICE, title: 't', body: 'b', ...quiet })
const liveRow = { device_id: DEVICE, endpoint: ENDPOINT, p256dh: 'p', auth: 'a', expires_at: 9_999_999_999 }

describe('scripts/send-test-push.mjs', () => {
  it('sends to a live registration (read consistently)', async () => {
    const ddb = fakeDdb(liveRow)
    const push = fakePush(201)
    expect(await run(ddb, push)).toBe(0)
    expect(push.sent).toEqual([ENDPOINT])
    expect(ddb.calls[0].input.ConsistentRead).toBe(true)
  })

  it('a 410 leaves the same tombstone dispatch writes, never a delete', async () => {
    const ddb = fakeDdb(liveRow)
    expect(await run(ddb, fakePush(410))).toBe(1)
    expect(ddb.calls.map((c) => c.op)).toEqual(['GetCommand', 'PutCommand'])
    const put = ddb.calls[1].input
    expect(put.ConditionExpression).toBe('#ep = :dead')
    expect(ddb.row.endpoint).toBeUndefined()
    expect(ddb.row.p256dh).toBeUndefined()
    expect(ddb.row.gone_endpoint_sha256).toBe(pushEndpointHash(ENDPOINT))
  })

  it('a 404 is dead too; a 500 changes nothing', async () => {
    const dead = fakeDdb(liveRow)
    await run(dead, fakePush(404))
    expect(dead.row.gone_endpoint_sha256).toBe(pushEndpointHash(ENDPOINT))
    const flaky = fakeDdb(liveRow)
    await run(flaky, fakePush(500))
    expect(flaky.row).toEqual(liveRow)
    expect(flaky.calls.map((c) => c.op)).toEqual(['GetCommand'])
  })

  it('keeps a fresh registration stored while the send was in flight', async () => {
    const ddb = fakeDdb(liveRow)
    const fresh = { ...liveRow, endpoint: 'https://fcm.googleapis.com/fcm/send/fresh' }
    const push = {
      async sendNotification() {
        ddb.row = structuredClone(fresh)
        throw Object.assign(new Error('gone'), { statusCode: 410 })
      },
    }
    expect(await run(ddb, push)).toBe(1)
    expect(ddb.row).toEqual(fresh)
  })

  it('skips a tombstone row (no endpoint) without crashing or sending', async () => {
    const tombstone = { device_id: DEVICE, gone_endpoint_sha256: pushEndpointHash(ENDPOINT), gone_at: 1, expires_at: 2 }
    const ddb = fakeDdb(tombstone)
    const push = fakePush(201)
    expect(await run(ddb, push)).toBe(1)
    expect(push.sent).toEqual([])
    expect(ddb.row).toEqual(tombstone)
    expect(ddb.calls.map((c) => c.op)).toEqual(['GetCommand'])
  })

  it('reports a device with no row at all', async () => {
    const ddb = fakeDdb(undefined)
    const push = fakePush(201)
    expect(await run(ddb, push)).toBe(1)
    expect(push.sent).toEqual([])
  })
})
