// @vitest-environment node
//
// Workday mode stays behind VITE_FEATURE_WORKDAY until a lawyer has read
// every workday string (build spec T6a to T6c). docs/legal-review-queue.md
// is the list the lawyer reads, so every workday key in the English locale
// (workday.*, and pdf.workday.* for the workday PDF) must be in it, named
// as `key`. A key added without being listed fails here, before it can
// reach the review queue's blind spot.
//
// The workday screens also show keys from outside those namespaces (the
// home card's "Move by {{time}}", "Logged {{when}} (phone clock)"). The
// queue's Gate says approving the workday section is enough to ship
// workday mode, so every key a workday screen names in a t('...') call must
// be named in that section too, unless it is a plain control in CONTROLS.
// Keys a helper picks (the countdown's time.* lines) or a variable holds
// aren't seen here; the section lists them by hand.
import { describe, expect, it } from 'vitest'
import en from '../locales/en.json'

interface Fs {
  readFileSync: (p: string, enc: 'utf8') => string
  readdirSync: (p: string) => string[]
}
const fs = (await import('node:fs' as string)) as Fs
const { fileURLToPath } = (await import('node:url' as string)) as { fileURLToPath: (u: URL) => string }
const QUEUE = fileURLToPath(new URL('../../docs/legal-review-queue.md', import.meta.url))
const COMPONENTS = new URL('../components/', import.meta.url)

/**
 * Shared keys the workday screens show that state nothing about the rules,
 * the record or a time: buttons, navigation, counts and a generic error.
 * Every entry must still be shown by a workday screen (checked below).
 */
const CONTROLS = new Set([
  'active.lastLoggedSpot', // "Last logged spot", the card's place name when the stop has no address
  'active.morePill', // "+{{count}} more"
  'active.morePillAria',
  'active.walkBackAria',
  'active.walkBackButton', // "Walk back"
  'common.back',
  'common.cancel',
  'common.retry',
  'errors.somethingWrong',
  'share.action', // "Share where the car is": the share flow's own copy is under "Sharing the record"
])

/** The workday section of the queue: from its heading to the next top-level heading. */
function workdaySection(doc: string): string {
  const start = doc.indexOf('\n## Workday mode')
  const end = doc.indexOf('\n## ', start + 1)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return doc.slice(start, end)
}

/** Every key outside workday.* and pdf.workday.* named in a t('...') call in src/components/Workday*.tsx. */
function sharedKeysOnWorkdayScreens(): Map<string, string[]> {
  const files = fs.readdirSync(fileURLToPath(COMPONENTS)).filter((f) => /^Workday\w*\.tsx$/.test(f) && !f.endsWith('.test.tsx'))
  expect(files.length).toBeGreaterThan(0)
  const keys = new Map<string, string[]>()
  for (const f of files) {
    const src = fs.readFileSync(fileURLToPath(new URL(f, COMPONENTS)), 'utf8')
    for (const m of src.matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)) {
      const key = m[1]
      if (key.startsWith('workday.') || key.startsWith('pdf.workday.')) continue
      keys.set(key, [...new Set([...(keys.get(key) ?? []), f])])
    }
  }
  return keys
}

function keysUnder(node: unknown, prefix: string): string[] {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [prefix]
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => keysUnder(v, `${prefix}.${k}`))
}

describe('docs/legal-review-queue.md', () => {
  it('lists every workday string key', () => {
    const doc = fs.readFileSync(QUEUE, 'utf8')
    const keys = keysUnder((en as Record<string, unknown>).workday, 'workday')
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.filter((k) => !doc.includes('`' + k + '`'))).toEqual([])
  })

  it('lists every string the workday PDF prints (pdf.workday.*, T6c), which councils read', () => {
    const doc = fs.readFileSync(QUEUE, 'utf8')
    const pdf = (en as { pdf: Record<string, unknown> }).pdf
    const keys = keysUnder(pdf.workday, 'pdf.workday')
    expect(keys).toContain('pdf.workday.footer')
    expect(keys).toContain('pdf.workday.councilLine')
    expect(keys.filter((k) => !doc.includes('`' + k + '`'))).toEqual([])
    // The PDF also prints these shared keys in its cover table; the queue says so.
    for (const k of ['pdf.signature.signedAt', 'pdf.evidence.field.address', 'pdf.evidence.statement']) {
      expect(doc).toContain('`' + k + '`')
    }
  })

  it('names in the workday section every other key a workday screen shows, except plain controls', () => {
    const section = workdaySection(fs.readFileSync(QUEUE, 'utf8'))
    const shared = sharedKeysOnWorkdayScreens()
    // The ones that prompted this check (the home workday card).
    for (const k of ['active.moveBy', 'active.expiredAt', 'session.arrived']) {
      expect(shared.has(k), `${k} is no longer shown by a workday screen`).toBe(true)
      expect(section).toContain('`' + k + '`')
    }
    const missing = [...shared]
      .filter(([k]) => !CONTROLS.has(k) && !section.includes('`' + k + '`'))
      .map(([k, files]) => `${k} (${files.join(', ')})`)
    expect(missing, 'add these to the workday section of docs/legal-review-queue.md, or to CONTROLS if they state nothing').toEqual([])
  })

  it('every CONTROLS entry is still shown by a workday screen and exists in en', () => {
    const shared = sharedKeysOnWorkdayScreens()
    const g = (path: string) => path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], en)
    for (const k of CONTROLS) {
      expect(shared.has(k), `${k} is in CONTROLS but no workday screen shows it`).toBe(true)
      // Plural keys are stored as key_one / key_other.
      expect(g(k) !== undefined || g(`${k}_one`) !== undefined || g(`${k}_other`) !== undefined, `${k} is not in en`).toBe(true)
    }
  })

  it('lists the boundary question and the stop reminder keys', () => {
    const doc = fs.readFileSync(QUEUE, 'utf8')
    for (const k of ['workday.boundary.title', 'workday.boundary.option.notSure', 'workday.boundary.dontSave', 'workday.reminders.notSet']) {
      expect(doc).toContain('`' + k + '`')
    }
  })
})
