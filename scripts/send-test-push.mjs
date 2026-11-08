#!/usr/bin/env node
/**
 * Send a one-off test push to a device_id. Used to validate the
 * subscribe → store → fire pipeline end-to-end before the scheduling
 * layer ships.
 *
 * Usage:
 *   node scripts/send-test-push.mjs <device_id> [title] [body]
 *
 * device_id is logged to the browser console when you click "Enable
 * notifications" in the About page. Copy it from there.
 *
 * Pulls VAPID keys from scripts/.aws-resources.
 *
 * A dead endpoint (the push service answers 410 Gone or 404) gets the same
 * conditional tombstone dispatch writes (lambda/push-tombstone.js), never a
 * delete: deleting the row would let the app's next re-send register the
 * dead endpoint again. A row that is already a tombstone has no endpoint to
 * send to, so it is reported and skipped.
 */
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import webpush from 'web-push'
import { isDeadEndpointStatus, pushTombstonePut } from '../lambda/push-tombstone.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const RESOURCES_FILE = join(ROOT, 'scripts', '.aws-resources')
const DEFAULT_TABLE = 'parkproof-push-subscriptions'

/**
 * Look up the device's registration and send it one push. Returns the exit
 * code. `ddb` is a DynamoDB document client (anything with `send`), `push`
 * is web-push with VAPID details set. Never deletes a row: a dead endpoint
 * gets the tombstone, only while the row still holds that endpoint.
 */
export async function sendTestPush({ ddb, push, table = DEFAULT_TABLE, deviceId, title, body, log = console.log, logError = console.error }) {
  const result = await ddb.send(
    new GetCommand({ TableName: table, Key: { device_id: deviceId }, ConsistentRead: true }),
  )
  const item = result.Item
  if (!item) {
    logError(`No subscription found for device_id ${deviceId}`)
    return 1
  }
  if (typeof item.endpoint !== 'string' || !item.endpoint) {
    // A tombstone: the push service said this device's last endpoint is dead.
    logError(
      `device_id ${deviceId} has no live registration (its last endpoint is dead). Open ParkProof on that device to register a fresh one.`,
    )
    return 1
  }

  const subscription = { endpoint: item.endpoint, keys: { p256dh: item.p256dh, auth: item.auth } }
  let host = '(unparseable endpoint)'
  try {
    host = new URL(item.endpoint).host
  } catch {
    /* logged without a host */
  }
  log(`→ pushing to ${host} (device=${deviceId.slice(0, 8)}…)`)

  try {
    const resp = await push.sendNotification(
      subscription,
      JSON.stringify({ title, body, url: 'https://www.parkproof.com.au' }),
    )
    log(`✓ pushed (status=${resp.statusCode})`)
    return 0
  } catch (err) {
    logError(`✗ push failed:`, err?.statusCode ?? err?.message)
    if (isDeadEndpointStatus(err?.statusCode)) {
      log('  → the endpoint is dead. Leaving a tombstone, as dispatch does.')
      const nowSec = Math.floor(Date.now() / 1000)
      try {
        await ddb.send(
          new PutCommand(pushTombstonePut({ table, device_id: deviceId, endpoint: item.endpoint, nowSec })),
        )
        log('  → tombstone written.')
      } catch (putErr) {
        if (putErr?.name === 'ConditionalCheckFailedException') {
          log('  → the row changed since the lookup (a fresh registration). Left as it is.')
        } else {
          logError('  → could not write the tombstone:', putErr?.message || putErr)
        }
      }
    }
    return 1
  }
}

async function main() {
  // ─── Parse .aws-resources for VAPID keys + table name ──────────────────
  const resources = Object.fromEntries(
    readFileSync(RESOURCES_FILE, 'utf8')
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => {
        const idx = line.indexOf('=')
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()]
      }),
  )
  const VAPID_PUBLIC = resources.VAPID_PUBLIC_KEY
  const VAPID_PRIVATE = resources.VAPID_PRIVATE_KEY
  const VAPID_SUBJECT = resources.VAPID_SUBJECT || 'mailto:hello@parkproof.com.au'
  const TABLE = resources.DYNAMODB_TABLE_PUSH || DEFAULT_TABLE
  const REGION = process.env.AWS_REGION || 'ap-southeast-2'

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.error('Missing VAPID keys in scripts/.aws-resources. Run scripts/setup-push.sh first.')
    return 1
  }

  // ─── CLI args ───────────────────────────────────────────────────────────
  const [, , deviceId, ...rest] = process.argv
  if (!deviceId) {
    console.error('Usage: node scripts/send-test-push.mjs <device_id> [title] [body]')
    console.error('  device_id is logged by the frontend after the user clicks "Enable notifications"')
    return 1
  }
  const title = rest[0] || 'ParkProof'
  const body = rest[1] || 'This is a test push. It is wired up.'

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
  return sendTestPush({ ddb, push: webpush, table: TABLE, deviceId, title, body })
}

// Run only when invoked as a script, so tests can import sendTestPush.
// (Windows paths compare without case: c:\ and C:\ are the same file.)
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
if (process.argv[1] && samePath(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  process.exit(await main())
}
