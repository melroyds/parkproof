// @vitest-environment node
//
// The fix list's clean-ups (docs/build/fix-list.md, "Status after the
// overnight build"), held in place:
//   - the privacy policy says how long push data is kept, the same in both
//     places it says it and the same as the code (item 6);
//   - the unused locale keys stay deleted, and no inject script or copy-pass
//     file brings them back (item 3), nor the two home-row duplicates
//     (item 4);
//   - one definition each for the driver name's cap and for reading a
//     zone's wall clock (item 5).
import { describe, expect, it } from 'vitest'
import en from '../locales/en.json'
import zhCN from '../locales/zh-CN.json'
import vi from '../locales/vi.json'
import id from '../locales/id.json'
import ko from '../locales/ko.json'
import it_ from '../locales/it.json'
import el from '../locales/el.json'
import hi from '../locales/hi.json'
import pa from '../locales/pa.json'
import { RECURRING_SCHEDULE_DAYS } from '../../lambda/recurring-schedule.js'
import { RECURRING_PUSH_RESYNC_MS } from './recurring-push'
import { DRIVER_NAME_MAX as LOGGER_MAX } from './driver-name'
import { DRIVER_NAME_MAX as PROFILE_MAX } from './profile'
import { CAPS } from '../../lambda/addendum-schema.js'

interface Fs {
  readFileSync: (p: URL, enc: 'utf8') => string
  readdirSync: (p: URL, opts: { withFileTypes: true }) => { name: string; isDirectory: () => boolean }[]
}
// node:fs through a dynamic import, so the browser tsconfig needs no Node types.
const fs = (await import('node:fs' as string)) as Fs

const REPO = new URL('../../', import.meta.url)
const SRC = new URL('src/', REPO)
const SCRIPTS = new URL('scripts/', REPO)
const read = (rel: string) => fs.readFileSync(new URL(rel, REPO), 'utf8')

const LOCALES: Record<string, unknown> = { en, 'zh-CN': zhCN, vi, id, ko, it: it_, el, hi, pa }
const DAY_MS = 24 * 60 * 60 * 1000

function flatten(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (typeof value === 'string') out[prefix] = value
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out)
  }
  return out
}

/** Every file under `dir` whose name passes `keep`, as [path relative to the repo, source]. */
function filesUnder(dir: URL, keep: (name: string) => boolean): [string, string][] {
  const out: [string, string][] = []
  const walk = (d: URL) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') walk(new URL(`${e.name}/`, d))
      } else if (keep(e.name)) {
        const url = new URL(e.name, d)
        out.push([decodeURIComponent(url.pathname.slice(REPO.pathname.length)), fs.readFileSync(url, 'utf8')])
      }
    }
  }
  walk(dir)
  return out
}

/** PUSH_TTL_DAYS from lambda/push-tombstone.js (no type declarations for the browser build, so read as text). */
const PUSH_TTL_DAYS = Number(/export const PUSH_TTL_DAYS = (\d+)/.exec(read('lambda/push-tombstone.js'))?.[1])
/** The Lambda log group's retention, as scripts/setup-log-retention.sh sets it (fix round 1). */
const LOG_RETENTION_DAYS = Number(/^RETENTION_DAYS=(\d+)$/m.exec(read('scripts/setup-log-retention.sh'))?.[1])

describe('privacy: how long push data is kept (item 6)', () => {
  it('reads the code\'s retention constants', () => {
    expect(PUSH_TTL_DAYS).toBeGreaterThan(0)
    expect(RECURRING_SCHEDULE_DAYS).toBeGreaterThan(0)
    expect(LOG_RETENTION_DAYS).toBeGreaterThan(0)
    // "ParkProof sends them again while you keep opening it": the phone
    // books a weekly rule again well before its schedules end.
    expect(RECURRING_PUSH_RESYNC_MS).toBeLessThan(RECURRING_SCHEDULE_DAYS * DAY_MS)
  })

  it.each(Object.keys(LOCALES))('%s states the same periods as the code, in both places', (locale) => {
    const strings = flatten(LOCALES[locale])
    const weekly = strings['privacy.anonymousWeeklyPush']
    const rights = strings['privacy.rightsAnonymous']
    // Weekly schedules: at most RECURRING_SCHEDULE_DAYS after each booking.
    expect(weekly).toContain(String(RECURRING_SCHEDULE_DAYS))
    expect(rights).toContain(String(RECURRING_SCHEDULE_DAYS))
    // The registration and a dead endpoint's tombstone: PUSH_TTL_DAYS.
    expect(rights).toContain(String(PUSH_TTL_DAYS))
    // The server's logs: the retention setup-log-retention.sh sets.
    expect(rights).toContain(String(LOG_RETENTION_DAYS))
    // No other period is named in either.
    const periods = (s: string) => new Set((s.match(/\d+/g) ?? []).map(Number).filter((n) => n !== 2))
    expect([...periods(weekly)]).toEqual([RECURRING_SCHEDULE_DAYS])
    expect([...periods(rights)].sort()).toEqual(
      [...new Set([RECURRING_SCHEDULE_DAYS, PUSH_TTL_DAYS, LOG_RETENTION_DAYS])].sort(),
    )
  })

  it('in English, says the same thing both times about weekly reminders and what renews the registration', () => {
    const weekly = en.privacy.anonymousWeeklyPush
    const rights = en.privacy.rightsAnonymous
    const lastOpened = `within ${RECURRING_SCHEDULE_DAYS} days of the last time you opened ParkProof`
    expect(weekly).toContain(lastOpened)
    expect(rights).toContain(`A weekly reminder by push is deleted ${lastOpened}.`)
    // The registration is renewed on open (push.ts installPushRegistrationRefresh),
    // not only when a reminder is set.
    expect(rights).toContain('ParkProof renews it when you open the app with push reminders on and when you set a reminder.')
    expect(rights).not.toMatch(/after you last set a reminder|or expires\)/)
    // Switching push off tells the server nothing, but it can lead to the
    // address being deleted sooner: a reminder booked earlier that fires
    // afterwards gets 410 or 404, and dispatch writes the tombstone (fix
    // round 1; the old "doesn't delete it sooner" wasn't always true).
    expect(rights).not.toMatch(/doesn't delete it sooner/)
    expect(rights).toContain("Switching push reminders off, in ParkProof or in your browser, doesn't tell our server")
    expect(rights).toContain('this can happen when a reminder you set earlier is sent after you switched them off')
    expect(rights).toContain('we delete the address and keys at once')
    // The tombstone keeps a fingerprint, never the address.
    expect(rights).toContain("We keep only this device's ID, a fingerprint of the address and when we found out")
    // The server's logs, and how long they're kept.
    expect(rights).toContain(
      "Our server's logs also record this device's ID when it registers for push, sets a reminder or is sent one, with the push service it uses, the random ID of the record or weekly reminder, and when each reminder was set, sent or skipped.",
    )
    expect(rights).toContain(`The logs are deleted after ${LOG_RETENTION_DAYS} days.`)
  })

  it('a dead address leaves no address or keys behind, as the policy says', async () => {
    // No type declarations for the browser build, so typed here.
    type Put = { Item: Record<string, unknown> & { expires_at: number } }
    const { pushTombstonePut } = (await import('../../lambda/push-tombstone.js' as string)) as {
      pushTombstonePut: (args: { table: string; device_id: string; endpoint: string; nowSec: number }) => Put
    }
    const put = pushTombstonePut({ table: 't', device_id: 'd', endpoint: 'https://push.example/abc', nowSec: 1000 })
    expect(Object.keys(put.Item).sort()).toEqual(['device_id', 'expires_at', 'gone_at', 'gone_endpoint_sha256'])
    expect(put.Item.expires_at - 1000).toBe(PUSH_TTL_DAYS * DAY_MS / 1000)
    // A put replaces the whole row, so the endpoint and keys are gone with it.
    expect(JSON.stringify(put.Item)).not.toContain('push.example')
  })

  it('the push log lines hold only what the policy says the logs hold', () => {
    // "this device's ID ..., the push service it uses, the random ID of the
    // record or weekly reminder, and when each reminder was set, sent or
    // skipped": ids, the push service's host, counts and outcomes. Never a
    // reminder's text, address, title, days, times, pattern or zone.
    const lambda = read('lambda/index.js')
    const ALLOWED = new Set([
      'device_id', 'endpoint_host', 'session_id', 'rule_id', 'timestamp',
      'created', 'kept', 'skipped', 'deleted', 'failed', 'kind', 'ttl', 'stale_at', 'reminder', 'reason', 'date',
    ])
    const logged: string[] = []
    const re = /console\.(?:log|warn|error)\(\s*`\[parkproof\.push[^\]]*\][^`]*?JSON\.stringify\(\{([\s\S]*?)\}\)/g
    for (const m of lambda.matchAll(re)) {
      for (const part of m[1].split(',')) {
        const key = part.trim().split(':')[0].trim()
        if (key) logged.push(key)
      }
    }
    expect(logged.length).toBeGreaterThan(10)
    expect(logged).toContain('device_id')
    expect([...new Set(logged)].filter((k) => !ALLOWED.has(k))).toEqual([])
  })

  it('switching push off in the app sends nothing to the server, as the policy says', () => {
    const push = read('src/lib/push.ts')
    const start = push.indexOf('export async function unsubscribeFromPush')
    const end = push.indexOf('\n}\n', start) > -1 ? push.indexOf('\n}\n', start) : push.indexOf('\r\n}\r\n', start)
    const body = push.slice(start, end)
    expect(start).toBeGreaterThan(-1)
    expect(body).not.toMatch(/pushPost|fetch\(/)
  })

  it.each(Object.keys(LOCALES))('the copy pass carries the same rights text in %s, so it can\'t undo it', (locale) => {
    const pass = JSON.parse(read(`scripts/copy-pass/${locale}.json`)) as Record<string, string>
    expect(pass['privacy.rightsAnonymous']).toBe(flatten(LOCALES[locale])['privacy.rightsAnonymous'])
  })
})

// ── Deleted keys (items 3 and 4) ─────────────────────────────────────────
const DELETED = [
  'appeal.strongEvidence',
  'appeal.moderateEvidence',
  'appeal.weakEvidence',
  'landing.feature.translateTitle',
  'landing.feature.translateDesc',
  'landing.feature.evidenceTitle',
  'landing.feature.evidenceDesc',
  'landing.feature.appealTitle',
  'landing.feature.appealDesc',
  'prefs.remindersReliability',
  'active.shareAria',
  'notice.homeLink',
  'home.weeklyReminders',
]

describe('deleted locale keys (items 3 and 4)', () => {
  it.each(Object.keys(LOCALES))('none is left in %s', (locale) => {
    const keys = Object.keys(flatten(LOCALES[locale]))
    expect(DELETED.filter((k) => keys.includes(k))).toEqual([])
    expect(keys.some((k) => k.startsWith('landing.feature.'))).toBe(false)
  })

  it('no app code reads one', () => {
    const sources = filesUnder(SRC, (n) => /\.tsx?$/.test(n) && !n.includes('.test.') && !n.endsWith('.d.ts'))
    expect(sources.length).toBeGreaterThan(50)
    const hits: string[] = []
    for (const [path, src] of sources) {
      for (const key of DELETED) if (src.includes(key)) hits.push(`${key} in ${path}`)
      if (/landing\.feature\b|['"`]feature\./.test(src)) hits.push(`landing.feature in ${path}`)
    }
    expect(hits).toEqual([])
  })

  it('no inject script or copy-pass file writes one again', () => {
    const scripts = filesUnder(SCRIPTS, (n) => /^_i18n_inject_.*\.(mjs|py)$/.test(n) || /\.json$/.test(n))
    expect(scripts.some(([p]) => p === 'scripts/_i18n_inject_fixlist_final.mjs')).toBe(true)
    expect(scripts.some(([p]) => p.startsWith('scripts/copy-pass/'))).toBe(true)
    const hits: string[] = []
    for (const [path, src] of scripts) {
      // The clean-ups script lists them to delete them.
      if (path === 'scripts/_i18n_inject_fixlist_final.mjs') continue
      for (const key of DELETED) {
        if (new RegExp(`['"\`]${key.replace(/\./g, '\\.')}['"\`]\\s*:`).test(src)) hits.push(`${key} in ${path}`)
      }
      if (/landing\.feature\./.test(src)) hits.push(`landing.feature in ${path}`)
    }
    expect(hits).toEqual([])
  })
})

// ── One definition each (item 5) ─────────────────────────────────────────
describe('one definition each (item 5)', () => {
  it('the driver name cap is the signed field\'s cap, defined once', () => {
    expect(LOGGER_MAX).toBe(CAPS.driverName)
    expect(PROFILE_MAX).toBe(CAPS.driverName)
    const sources = filesUnder(SRC, (n) => /\.tsx?$/.test(n) && !n.includes('.test.'))
    const defining = sources.filter(([, src]) => /DRIVER_NAME_MAX\s*=/.test(src)).map(([p]) => p)
    expect(defining).toEqual(['src/lib/profile.ts'])
  })

  it("permit-answer.ts reads a zone's clock through time-format.ts, not a formatter of its own", () => {
    const src = read('src/lib/permit-answer.ts')
    expect(src).toContain("from './time-format'")
    expect(src).toMatch(/wallClockInZone\(/)
    expect(src).not.toMatch(/Intl\.DateTimeFormat|formatToParts/)
  })
})
