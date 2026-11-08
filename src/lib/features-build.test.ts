// @vitest-environment node
//
// A production build has workday mode OFF by default (build spec T6a and
// T6b; docs/legal-review-queue.md). The owner has no lawyer to read the
// workday copy yet, so the flag stays off in production indefinitely: a
// production build may only turn it on when someone sets
// VITE_FEATURE_WORKDAY on purpose, and nothing in the build pipeline does.
//
// Checked four ways:
//   1. the flag rule itself: unset in a production build means off;
//   1b. the module as the app loads it: features.ts reads the build's env
//      (import.meta.env.DEV and VITE_FEATURE_WORKDAY) into that rule, so a
//      change to that wiring (a default of on, DEV hard-coded) fails here;
//   2. what `vite build` (mode production) would read from this checkout's
//      .env files and the shell, through Vite's own loadEnv;
//   3. the scripts and config that run production and staging builds never
//      set it.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { workdayFlagFrom } from './features'

interface Fs {
  readFileSync: (p: string, enc: 'utf8') => string
  existsSync: (p: string) => boolean
}
// Node and Vite through dynamic imports, so the browser tsconfig needs no Node types.
const fs = (await import('node:fs' as string)) as Fs
const { fileURLToPath } = (await import('node:url' as string)) as { fileURLToPath: (u: URL) => string }
const { loadEnv } = (await import('vite' as string)) as {
  loadEnv: (mode: string, envDir: string, prefixes?: string | string[]) => Record<string, string>
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (rel: string): string | null => {
  const p = `${ROOT}${rel}`
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
}

describe('VITE_FEATURE_WORKDAY in a production build', () => {
  it('unset means off in production (and on only in dev)', () => {
    expect(workdayFlagFrom({ DEV: false, VITE_FEATURE_WORKDAY: undefined })).toBe(false)
    expect(workdayFlagFrom({ DEV: true, VITE_FEATURE_WORKDAY: undefined })).toBe(true)
  })

  it("is off for `vite build` with this checkout's env files and shell", () => {
    const env = loadEnv('production', ROOT, 'VITE_')
    expect(workdayFlagFrom({ DEV: false, VITE_FEATURE_WORKDAY: env.VITE_FEATURE_WORKDAY })).toBe(false)
  })

  it('no build script or config turns it on', () => {
    for (const rel of ['scripts/deploy.sh', 'scripts/_deploy-staging.sh', 'vite.config.ts', 'package.json']) {
      const text = read(rel)
      if (text === null) continue
      expect(text, rel).not.toMatch(/VITE_FEATURE_WORKDAY/)
    }
  })
})

describe('isWorkdayEnabled() as the app loads it, from the build env', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })
  /** A fresh copy of features.ts, evaluated against the env stubbed now. */
  async function flagFor(env: { DEV: boolean; VITE_FEATURE_WORKDAY: string | undefined }): Promise<boolean> {
    vi.stubEnv('DEV', env.DEV)
    vi.stubEnv('PROD', !env.DEV)
    vi.stubEnv('VITE_FEATURE_WORKDAY', env.VITE_FEATURE_WORKDAY)
    vi.resetModules()
    const features = (await import('./features')) as typeof import('./features')
    return features.isWorkdayEnabled()
  }

  it('a production build with VITE_FEATURE_WORKDAY unset: off', async () => {
    expect(await flagFor({ DEV: false, VITE_FEATURE_WORKDAY: undefined })).toBe(false)
  })

  it('a production build with it empty: off', async () => {
    expect(await flagFor({ DEV: false, VITE_FEATURE_WORKDAY: '' })).toBe(false)
  })

  it('dev with it unset: on', async () => {
    expect(await flagFor({ DEV: true, VITE_FEATURE_WORKDAY: undefined })).toBe(true)
  })

  it('the variable reaches the flag: set on purpose it turns a production build on, and dev off', async () => {
    expect(await flagFor({ DEV: false, VITE_FEATURE_WORKDAY: '1' })).toBe(true)
    expect(await flagFor({ DEV: true, VITE_FEATURE_WORKDAY: 'off' })).toBe(false)
  })
})
