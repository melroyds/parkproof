// @vitest-environment node
//
// Workday mode stays behind VITE_FEATURE_WORKDAY until a lawyer has read
// every workday string (build spec T6a to T6c). docs/legal-review-queue.md
// is the list the lawyer reads, so every workday key in the English locale
// (workday.*, and pdf.workday.* for the workday PDF) must be in it, named
// as `key`. A key added without being listed fails here, before it can
// reach the review queue's blind spot.
import { describe, expect, it } from 'vitest'
import en from '../locales/en.json'

interface Fs {
  readFileSync: (p: string, enc: 'utf8') => string
}
const fs = (await import('node:fs' as string)) as Fs
const { fileURLToPath } = (await import('node:url' as string)) as { fileURLToPath: (u: URL) => string }
const QUEUE = fileURLToPath(new URL('../../docs/legal-review-queue.md', import.meta.url))

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

  it('lists the boundary question and the stop reminder keys', () => {
    const doc = fs.readFileSync(QUEUE, 'utf8')
    for (const k of ['workday.boundary.title', 'workday.boundary.option.notSure', 'workday.boundary.dontSave', 'workday.reminders.notSet']) {
      expect(doc).toContain('`' + k + '`')
    }
  })
})
