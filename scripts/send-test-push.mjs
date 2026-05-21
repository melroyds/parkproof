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
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import webpush from 'web-push'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const RESOURCES_FILE = join(ROOT, 'scripts', '.aws-resources')

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
const VAPID_SUBJECT = resources.VAPID_SUBJECT || 'mailto:melroy@parkproof.com.au'
const TABLE = resources.DYNAMODB_TABLE_PUSH || 'parkproof-push-subscriptions'
const REGION = process.env.AWS_REGION || 'ap-southeast-2'

if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
  console.error('Missing VAPID keys in scripts/.aws-resources. Run scripts/setup-push.sh first.')
  process.exit(1)
}

// ─── CLI args ───────────────────────────────────────────────────────────
const [, , deviceId, ...rest] = process.argv
if (!deviceId) {
  console.error('Usage: node scripts/send-test-push.mjs <device_id> [title] [body]')
  console.error('  device_id is logged by the frontend after the user clicks "Enable notifications"')
  process.exit(1)
}
const title = rest[0] || 'ParkProof'
const body = rest[1] || 'This is a test push — wired up successfully.'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

// ─── Look up the subscription ───────────────────────────────────────────
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }))
const result = await ddb.send(
  new GetCommand({ TableName: TABLE, Key: { device_id: deviceId } }),
)
if (!result.Item) {
  console.error(`No subscription found for device_id ${deviceId}`)
  process.exit(1)
}

const subscription = {
  endpoint: result.Item.endpoint,
  keys: { p256dh: result.Item.p256dh, auth: result.Item.auth },
}

console.log(`→ pushing to ${new URL(subscription.endpoint).host} (device=${deviceId.slice(0, 8)}…)`)

try {
  const resp = await webpush.sendNotification(
    subscription,
    JSON.stringify({ title, body, url: 'https://www.parkproof.com.au' }),
  )
  console.log(`✓ pushed (status=${resp.statusCode})`)
} catch (err) {
  console.error(`✗ push failed:`, err.statusCode ?? err.message)
  if (err.statusCode === 410 || err.statusCode === 404) {
    console.log('  → subscription is stale (browser rotated endpoint). Removing from DDB.')
    await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { device_id: deviceId } }))
    console.log('  → removed.')
  }
  process.exit(1)
}
