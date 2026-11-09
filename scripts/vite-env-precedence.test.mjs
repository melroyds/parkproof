// @vitest-environment node
//
// What a production build bakes in for VITE_* values when a .env file
// disagrees with the shell that runs the build (fix list, 9 Nov 2026).
//
// deploy.sh and _deploy-staging.sh pass VITE_FEATURE_WORKDAY=false (and the
// API URL, Cognito ids and VAPID key) to the build as environment variables.
// vite.config.ts also reads the repo's .env and copies it onto process.env,
// before Vite's own loadEnv runs. If that copy overwrote VITE_* keys, a
// VITE_FEATURE_WORKDAY=true line in .env would ship workday mode in a
// production build whose banner said "off".
//
// This runs Vite's real config loading and env resolution (resolveConfig with
// the real vite.config.ts) in a child process whose working folder holds a
// throwaway .env, so nothing here reads the owner's .env.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = join(ROOT, 'vite.config.ts')
const VITE_URL = pathToFileURL(createRequire(join(ROOT, 'package.json')).resolve('vite')).href
const TIMEOUT = 60_000

const PROBE = `
const [viteUrl, configFile, root] = process.argv.slice(2)
const { resolveConfig } = await import(viteUrl)
const c = await resolveConfig({ configFile, root, mode: 'production', logLevel: 'silent' }, 'build')
const pick = (k) => (Object.prototype.hasOwnProperty.call(c.env, k) ? c.env[k] : null)
console.log('RESULT ' + JSON.stringify({ workday: pick('VITE_FEATURE_WORKDAY'), api: pick('VITE_API_URL') }))
`

const scratch = []
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

/** Resolves the real Vite config for a build in a folder holding `dotenv` as its .env. */
function resolveWith(dotenv, shellEnv) {
  const dir = mkdtempSync(join(tmpdir(), 'pp-vite-env-'))
  scratch.push(dir)
  writeFileSync(join(dir, '.env'), dotenv)
  writeFileSync(join(dir, 'probe.mjs'), PROBE)
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^VITE_/i.test(key)) delete env[key]
  Object.assign(env, shellEnv)
  const res = spawnSync(process.execPath, [join(dir, 'probe.mjs'), VITE_URL, CONFIG, dir], {
    cwd: dir,
    env,
    encoding: 'utf8',
    timeout: TIMEOUT,
  })
  const line = (res.stdout || '').split(/\r?\n/).find((l) => l.startsWith('RESULT '))
  if (!line) throw new Error(`probe failed (exit ${res.status}):\n${res.stdout}\n${res.stderr}`)
  return JSON.parse(line.slice('RESULT '.length))
}

describe('VITE_* values in a production build', () => {
  const DOTENV = 'VITE_FEATURE_WORKDAY=true\nVITE_API_URL=http://from-dotenv.invalid\n'

  it('reads .env when the shell sets nothing (so the next check is not vacuous)', { timeout: TIMEOUT }, () => {
    expect(resolveWith(DOTENV, {})).toEqual({ workday: 'true', api: 'http://from-dotenv.invalid' })
  })

  it('keeps what the shell sets over a .env line, as deploy.sh relies on', { timeout: TIMEOUT }, () => {
    const out = resolveWith(DOTENV, { VITE_FEATURE_WORKDAY: 'false', VITE_API_URL: 'https://api.example.invalid' })
    expect(out).toEqual({ workday: 'false', api: 'https://api.example.invalid' })
  })
})

describe('the build scripts pass the workday flag explicitly', () => {
  for (const name of ['deploy.sh', '_deploy-staging.sh']) {
    it(`${name} sets VITE_FEATURE_WORKDAY on its build command`, () => {
      const text = readFileSync(join(ROOT, 'scripts', name), 'utf8')
      // The build command is a run of `VAR=value \` lines ending in the build itself.
      const build = text.match(/((?:^VITE_[A-Z_]+=.*\\\r?\n)+)\s*(?:npm run build|npx vite build)/m)
      expect(build, `${name} has no VITE_* prefixed build command`).not.toBeNull()
      expect(build[1]).toMatch(/^VITE_FEATURE_WORKDAY="\$WORKDAY_FLAG" \\$/m)
      // On only when the invoking shell set DEPLOY_ALLOW_WORKDAY=1, read-only after that.
      expect(text).toMatch(/if \[\[ "\$\{DEPLOY_ALLOW_WORKDAY:-\}" == "1" \]\]; then\s+WORKDAY_FLAG=true\s[\s\S]*?else\s+WORKDAY_FLAG=false\s/)
      expect(text).toMatch(/^readonly WORKDAY_FLAG\b/m)
    })
  }
})
