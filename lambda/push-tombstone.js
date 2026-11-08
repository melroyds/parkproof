// Push registrations and the tombstone a dead endpoint leaves (field-test
// review). Shared by the Lambda (lambda/index.js) and the operator script
// scripts/send-test-push.mjs, so both write exactly the same rows. No side
// effects on import: it only builds DynamoDB command inputs.
//
// When the push service answers a send with 410 Gone or 404, the endpoint
// will never deliver again, but the browser can keep reporting it and the
// app re-sends its registration on open and before every booking. Deleting
// the row let that re-send put the dead endpoint back. So the row becomes a
// tombstone instead (the dead endpoint's hash, no endpoint, no keys), and
// /push/subscribe refuses that same endpoint with 409 ERR_ENDPOINT_GONE.
import crypto from 'node:crypto'

/** DynamoDB's TTL sweep deletes a registration (or a tombstone) this long after its last write. */
export const PUSH_TTL_DAYS = 90
const PUSH_TTL_S = PUSH_TTL_DAYS * 24 * 60 * 60

/** The SHA-256 (hex) of an endpoint URL: a tombstone stores this, never the URL. */
export function pushEndpointHash(endpoint) {
  return crypto.createHash('sha256').update(String(endpoint), 'utf8').digest('hex')
}

/** True for a push service status that means the endpoint is dead for good. */
export function isDeadEndpointStatus(status) {
  return status === 410 || status === 404
}

/**
 * PutCommand input that replaces a device's row with the tombstone of
 * `endpoint`, only while the row still holds that endpoint: a fresh
 * registration stored since is kept (ConditionalCheckFailedException).
 */
export function pushTombstonePut({ table, device_id, endpoint, nowSec }) {
  return {
    TableName: table,
    Item: {
      device_id,
      gone_endpoint_sha256: pushEndpointHash(endpoint),
      gone_at: nowSec,
      expires_at: nowSec + PUSH_TTL_S,
    },
    ConditionExpression: '#ep = :dead',
    ExpressionAttributeNames: { '#ep': 'endpoint' },
    ExpressionAttributeValues: { ':dead': endpoint },
  }
}

/**
 * PutCommand input that stores a live registration (`item` holds
 * device_id, endpoint and keys), refused (ConditionalCheckFailedException)
 * when the row is the tombstone of this same endpoint. One conditional
 * write, not a read and then a write: a dispatch that tombstones the
 * endpoint in between can't be overwritten with the dead endpoint's keys.
 */
export function pushRegistrationPut({ table, item }) {
  return {
    TableName: table,
    Item: item,
    ConditionExpression: 'attribute_not_exists(#gone) OR #gone <> :gone',
    ExpressionAttributeNames: { '#gone': 'gone_endpoint_sha256' },
    ExpressionAttributeValues: { ':gone': pushEndpointHash(item.endpoint) },
  }
}
