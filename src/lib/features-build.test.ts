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
//   3. the config never sets it, and the scripts that run production and
//      staging builds set it false unless DEPLOY_ALLOW_WORKDAY=1 asks for
//      it on purpose (fix list: an explicit false, so a .env line can't
//      turn it on).

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

  it('no build config turns it on', () => {
    // vite.config.ts may name it in a comment (why the shell wins over .env),
    // never in code; package.json never names it.
    const config = read('vite.config.ts')
    if (config !== null) {
      const code = config.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(code, 'vite.config.ts').not.toMatch(/VITE_FEATURE_WORKDAY/)
    }
    const pkg = read('package.json')
    if (pkg !== null) expect(pkg, 'package.json').not.toMatch(/VITE_FEATURE_WORKDAY/)
  })

  it('the deploy scripts set it off unless DEPLOY_ALLOW_WORKDAY=1 asks for it', () => {
    // Fix list (after the overnight build): deploy.sh and _deploy-staging.sh
    // pass it to the build explicitly, from WORKDAY_FLAG, which is false
    // unless the invoking shell set DEPLOY_ALLOW_WORKDAY=1, so a .env line
    // can't turn it on (scripts/vite-env-precedence.test.mjs). Nothing else
    // in them assigns it.
    for (const rel of ['scripts/deploy.sh', 'scripts/_deploy-staging.sh']) {
      const text = read(rel)
      if (text === null) continue
      const assignments = text
        .split(/\r?\n/)
        .filter((line) => /^\s*(export\s+)?VITE_FEATURE_WORKDAY=/.test(line))
        .map((line) => line.trim())
      expect(assignments, rel).toEqual(['VITE_FEATURE_WORKDAY="$WORKDAY_FLAG" \\'])
      const flagLines = text.split(/\r?\n/).filter((line) => /^\s*WORKDAY_FLAG=/.test(line)).map((l) => l.trim())
      expect(flagLines, rel).toEqual(['WORKDAY_FLAG=true', 'WORKDAY_FLAG=false'])
      expect(text, rel).toMatch(/if \[\[ "\$\{DEPLOY_ALLOW_WORKDAY:-\}" == "1" \]\]; then\s+WORKDAY_FLAG=true\s[\s\S]*?else\s+WORKDAY_FLAG=false\s/)
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
