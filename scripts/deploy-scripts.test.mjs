// @vitest-environment node
//
// scripts/deploy.sh, scripts/setup-jobs-table.sh and
// scripts/setup-log-retention.sh, run for real in bash
// against a throwaway copy of the repo, with fake `aws`, `npm` and `python`
// first on the PATH (fix list, 9 Nov 2026). Nothing here can reach AWS: the
// fake aws answers from a script and logs every call, and the real CLI
// would find no credentials (AWS_CONFIG_FILE and friends point nowhere).
//
// What is checked:
// - deploy.sh packages the Lambda in a temp folder outside the repo. It
//   never deletes or installs lambda/node_modules in the working tree, and
//   the zip path the aws CLI gets is one it can read (a Windows path from
//   cygpath -w on Git Bash).
// - --package-only builds and lists the package and makes no AWS call.
// - The frontend build gets VITE_FEATURE_WORKDAY=false unless the shell
//   that ran the deploy set DEPLOY_ALLOW_WORKDAY=1. A line in .env can't
//   turn it on. (This fake npm sees only the build command's env; Vite's
//   side, where vite.config.ts reads .env, is vite-env-precedence.test.mjs.)
// - setup-jobs-table.sh makes one change: dynamodb:DeleteItem on the jobs
//   table for parkproof-lambda-role.
// - setup-log-retention.sh makes one change: a 90-day retention on the
//   Lambda's log group (the privacy policy's number), and checks it took.
//
// Needs bash (Git Bash on Windows) and zip or PowerShell. Skipped with a
// warning without them.
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TIMEOUT = 180_000

/** Git Bash on Windows (never WSL's bash, which can't run these paths), bash elsewhere. */
function findBash() {
  const candidates = process.platform === 'win32' ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'bash'] : ['bash']
  for (const bash of candidates) {
    const probe = spawnSync(bash, ['-c', 'uname -s'], { encoding: 'utf8' })
    if (probe.status !== 0) continue
    if (process.platform === 'win32' && !/MINGW|MSYS|CYGWIN/i.test(probe.stdout)) continue
    return bash
  }
  return null
}

const BASH = findBash()
const CAN_ZIP =
  BASH !== null &&
  spawnSync(BASH, ['-c', 'command -v zip || command -v pwsh || command -v powershell.exe'], { encoding: 'utf8' }).status === 0
const HAS_UNZIP = BASH !== null && spawnSync(BASH, ['-c', 'command -v unzip'], { encoding: 'utf8' }).status === 0
if (!BASH) console.warn('[deploy-scripts] no bash found: skipped')
else if (!CAN_ZIP) console.warn('[deploy-scripts] neither zip nor PowerShell found: skipped the packaging checks')

const scratch = []
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

/** Writes an LF script and makes it executable. */
function script(path, body) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body.replace(/\r\n/g, '\n'))
  chmodSync(path, 0o755)
}

// The fake aws: logs each call (arguments split by 0x1f, calls by 0x1e) and
// answers what deploy.sh and the setup scripts read back. Anything else
// is an error, so a new AWS call in any of them shows up here.
const FAKE_AWS = String.raw`#!/usr/bin/env bash
{ printf '%s\x1f' "$@"; printf '\x1e'; } >> "$FAKE_LOG/aws.log"
args="$*"
case "$1 $2" in
  "sts get-caller-identity") echo "${'$'}{FAKE_ACCOUNT-123456789012}" ;;
  "iam get-role") if [[ "$args" == *--query* ]]; then echo "arn:aws:iam::123456789012:role/parkproof-lambda-role"; fi ;;
  "iam put-role-policy") ;;
  "logs put-retention-policy") ;;
  "logs describe-log-groups") echo "${'$'}{FAKE_RETENTION-90}" ;;
  "lambda get-function") if [[ "$args" == *--query* ]]; then echo "arn:aws:lambda:ap-southeast-2:123456789012:function:parkproof-sign-translator"; fi ;;
  "lambda get-function-configuration") if [[ "$args" == *Runtime* ]]; then echo nodejs22.x; else echo '{}'; fi ;;
  "lambda update-function-code")
    for a in "$@"; do
      case "$a" in
        fileb://*)
          f="${'$'}{a#fileb://}"
          if command -v cygpath >/dev/null 2>&1; then f=$(cygpath -u "$f"); fi
          [[ -s "$f" ]] || { echo "fake aws: can't read the zip at $a" >&2; exit 3; }
          printf '%s' "$a" > "$FAKE_LOG/zip-arg"
          cp "$f" "$FAKE_LOG/uploaded.zip"
          ;;
      esac
    done
    ;;
  "lambda wait"|"lambda update-function-configuration"|"lambda add-permission") ;;
  "apigatewayv2 get-apis") echo api123 ;;
  "apigatewayv2 get-routes") echo route123 ;;
  "apigatewayv2 get-integrations") echo int123 ;;
  "s3api head-bucket"|"s3 sync") ;;
  "cloudfront list-distributions") echo E123 ;;
  "cloudfront get-distribution") if [[ "$args" == *DomainName* ]]; then echo d123.cloudfront.net; else echo Deployed; fi ;;
  "cloudfront create-invalidation") echo I123 ;;
  *) echo "fake aws: unexpected call: $args" >&2; exit 64 ;;
esac
`

// The fake npm: logs where it ran, its arguments and the workday flag it
// was given. "ci" installs one fake dependency; "run build" writes dist/app.
const FAKE_NPM = String.raw`#!/usr/bin/env bash
here="$PWD"
if command -v cygpath >/dev/null 2>&1; then here=$(cygpath -w "$PWD"); fi
printf '%s|%s|VITE_FEATURE_WORKDAY=%s\n' "$here" "$*" "${'$'}{VITE_FEATURE_WORKDAY-unset}" >> "$FAKE_LOG/npm.log"
case "$1" in
  ci) mkdir -p node_modules/fake-dep && echo 'module.exports = 1' > node_modules/fake-dep/index.js ;;
  run) mkdir -p dist/app && echo '<!doctype html>' > dist/app/index.html ;;
esac
`

/**
 * A throwaway repo with the real scripts and a small lambda/ (with a
 * node_modules the deploy must leave alone), the fakes, a TMPDIR outside
 * the repo and a log folder.
 */
function makeWorld({ env = true, indexJs = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'pp-deploy-test-'))
  scratch.push(base)
  const repo = join(base, 'repo')
  const bin = join(base, 'bin')
  const tmp = join(base, 'tmp')
  const log = join(base, 'log')
  for (const dir of [repo, bin, tmp, log]) mkdirSync(dir, { recursive: true })

  for (const name of ['deploy.sh', 'setup-jobs-table.sh', 'setup-log-retention.sh']) {
    script(join(repo, 'scripts', name), readFileSync(join(ROOT, 'scripts', name), 'utf8'))
  }
  const lambda = join(repo, 'lambda')
  mkdirSync(join(lambda, 'node_modules', 'sentinel'), { recursive: true })
  if (indexJs) writeFileSync(join(lambda, 'index.js'), 'export const handler = async () => ({ statusCode: 200 })\n')
  writeFileSync(join(lambda, 'helper.js'), 'export const x = 1\n')
  writeFileSync(join(lambda, 'helper.test.js'), 'throw new Error("tests are not shipped")\n')
  writeFileSync(join(lambda, 'package.json'), '{ "name": "fake-lambda", "type": "module" }\n')
  writeFileSync(join(lambda, 'package-lock.json'), '{ "lockfileVersion": 3 }\n')
  writeFileSync(join(lambda, 'node_modules', 'sentinel', 'keep.txt'), 'the working tree copy\n')

  if (env) {
    // A .env that tries to switch workday mode on both ways.
    writeFileSync(join(repo, '.env'), 'ANTHROPIC_API_KEY=sk-test-not-real\nVITE_FEATURE_WORKDAY=true\nDEPLOY_ALLOW_WORKDAY=1\n')
  }
  const landing = join(repo, 'migrations', 'two-app-architecture', 'landing-from-claude-design')
  mkdirSync(landing, { recursive: true })
  writeFileSync(join(landing, 'index.html'), '<!doctype html><title>Landing</title>\n')
  writeFileSync(join(repo, 'migrations', 'two-app-architecture', 'public-sw-shim.js'), 'self.registration.unregister()\n')

  script(join(bin, 'aws'), FAKE_AWS)
  script(join(bin, 'npm'), FAKE_NPM)
  // No fontTools: deploy.sh skips the font re-subset.
  script(join(bin, 'python'), '#!/usr/bin/env bash\nexit 1\n')
  return { base, repo, bin, tmp, log, lambda }
}

/** Runs a script from the world's repo in bash, with the fakes first on the PATH. */
function run(world, scriptName, args = [], extraEnv = {}) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(AWS_|DEPLOY_ALLOW_WORKDAY$|VITE_FEATURE_WORKDAY$|JOBS_TABLE$|LAMBDA_ROLE_NAME$|LAMBDA_NAME$|MSYS_NO_PATHCONV$)/i.test(key)) delete env[key]
  }
  Object.assign(env, {
    FAKE_BIN: world.bin,
    FAKE_LOG: world.log,
    TMPDIR: world.tmp,
    // The real CLI, were it ever reached, would have no credentials.
    AWS_CONFIG_FILE: join(world.base, 'no-aws-config'),
    AWS_SHARED_CREDENTIALS_FILE: join(world.base, 'no-aws-credentials'),
    AWS_PROFILE: 'parkproof-test-none',
    AWS_EC2_METADATA_DISABLED: 'true',
    ...extraEnv,
  })
  const launcher =
    'bin="$FAKE_BIN"; if command -v cygpath >/dev/null 2>&1; then bin=$(cygpath -u "$bin"); fi; ' +
    'export PATH="$bin:$PATH"; script="$1"; shift; exec bash "$script" "$@"'
  const target = join(world.repo, 'scripts', scriptName)
  const res = spawnSync(BASH, ['-c', launcher, 'launcher', target, ...args], { env, encoding: 'utf8', timeout: TIMEOUT })
  const stdout = String(res.stdout ?? '').replace(/\r/g, '')
  const stderr = String(res.stderr ?? '').replace(/\r/g, '')
  return { status: res.status, out: `${stdout}\n${stderr}`, stdout }
}

/** Every logged aws call, as its argument list. */
function awsCalls(world) {
  const file = join(world.log, 'aws.log')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\x1e')
    .filter(Boolean)
    .map((call) => call.split('\x1f').slice(0, -1))
}

function npmCalls(world) {
  const file = join(world.log, 'npm.log')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [cwd, args, flag] = line.split('|')
      return { cwd, args, flag }
    })
}

/** For comparing a path the fake logged with one from Node. */
const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const isInside = (child, parent) => norm(child).startsWith(`${norm(parent)}/`)

function zipEntries(world, zipPath) {
  const res = spawnSync(BASH, ['-c', 'f="$1"; if command -v cygpath >/dev/null 2>&1; then f=$(cygpath -u "$f"); fi; unzip -Z1 "$f"', 'x', zipPath], {
    encoding: 'utf8',
  })
  expect(res.status, res.stderr).toBe(0)
  return res.stdout.split(/\r?\n/).filter(Boolean)
}

function expectWorkingTreeUntouched(world) {
  expect(readFileSync(join(world.lambda, 'node_modules', 'sentinel', 'keep.txt'), 'utf8')).toBe('the working tree copy\n')
  expect(existsSync(join(world.lambda, 'node_modules', 'fake-dep'))).toBe(false)
  expect(existsSync(join(world.repo, 'function.zip'))).toBe(false)
}

describe.skipIf(!BASH || !CAN_ZIP)('deploy.sh --package-only', () => {
  it('builds and lists the package in a temp folder outside the repo, with no AWS call and no .env', { timeout: TIMEOUT }, () => {
    const world = makeWorld({ env: false })
    const res = run(world, 'deploy.sh', ['--package-only'])
    expect(res.status, res.out).toBe(0)
    expect(res.stdout).toContain('No AWS call is made')
    expect(res.stdout).toContain('Nothing was deployed')
    expect(awsCalls(world)).toEqual([])

    // npm ci ran once, in the temp folder, for production dependencies only.
    const npm = npmCalls(world)
    expect(npm).toHaveLength(1)
    expect(npm[0].args).toMatch(/^ci --omit=dev\b/)
    expect(isInside(npm[0].cwd, world.tmp), npm[0].cwd).toBe(true)
    expect(isInside(npm[0].cwd, world.repo)).toBe(false)
    expectWorkingTreeUntouched(world)

    // The listing: sources and the fresh node_modules, no tests.
    const top = res.stdout.match(/top-level entries:\n((?: {6}\S.*\n)+)/)
    expect(top, res.stdout).not.toBeNull()
    expect(top[1].trim().split(/\s+/).sort()).toEqual(['helper.js', 'index.js', 'node_modules', 'package-lock.json', 'package.json'])
    expect(res.stdout).toMatch(/package: \d+ bytes \(\d+\.\d MB\), \d+ entries/)
    expect(res.stdout).toMatch(/workday mode off \(VITE_FEATURE_WORKDAY=false/)

    // The zip is kept for inspection, the staged copy is gone.
    const kept = res.stdout.match(/kept for inspection: (.+function\.zip)/)
    expect(kept, res.stdout).not.toBeNull()
    expect(existsSync(kept[1])).toBe(true)
    expect(isInside(kept[1], world.tmp)).toBe(true)
    const pkgDir = readdirSync(world.tmp).filter((d) => d.startsWith('parkproof-lambda.'))
    expect(pkgDir).toHaveLength(1)
    expect(readdirSync(join(world.tmp, pkgDir[0]))).toEqual(['function.zip'])
    if (HAS_UNZIP) {
      const entries = zipEntries(world, kept[1]).map((e) => e.replace(/\\/g, '/'))
      expect(entries).toContain('index.js')
      expect(entries).toContain('node_modules/fake-dep/index.js')
      expect(entries.some((e) => e.includes('sentinel'))).toBe(false)
      expect(entries.some((e) => e.endsWith('.test.js'))).toBe(false)
    }
  })

  it('stops before any AWS call when the package has no index.js', { timeout: TIMEOUT }, () => {
    const world = makeWorld({ env: false, indexJs: false })
    const res = run(world, 'deploy.sh', ['--package-only'])
    expect(res.status).toBe(1)
    expect(res.out).toContain("index.js isn't at the top of the Lambda package")
    expect(awsCalls(world)).toEqual([])
  })

  it('refuses an unknown option without doing anything', () => {
    const world = makeWorld({ env: false })
    const res = run(world, 'deploy.sh', ['--packge-only'])
    expect(res.status).toBe(2)
    expect(res.out).toContain('Unknown option: --packge-only')
    expect(npmCalls(world)).toEqual([])
    expect(awsCalls(world)).toEqual([])
  })
})

describe.skipIf(!BASH || !CAN_ZIP)('deploy.sh, a full run against a fake AWS', () => {
  it('uploads the zip from the temp folder by a path the CLI can read, and leaves lambda/node_modules alone', { timeout: TIMEOUT }, () => {
    const world = makeWorld()
    const res = run(world, 'deploy.sh')
    expect(res.status, res.out).toBe(0)
    expect(res.stdout).toContain('Deploy complete')

    const calls = awsCalls(world)
    const upload = calls.find((c) => c[0] === 'lambda' && c[1] === 'update-function-code')
    expect(upload, JSON.stringify(calls.map((c) => c.slice(0, 2)))).toBeDefined()
    const zipArg = readFileSync(join(world.log, 'zip-arg'), 'utf8')
    expect(upload).toContain(zipArg)
    // The Windows aws.exe can't read a Git Bash path, so it gets a Windows one.
    if (process.platform === 'win32') expect(zipArg).toMatch(/^fileb:\/\/[A-Za-z]:\\/)
    else expect(zipArg).toMatch(/^fileb:\/\/\//)
    expect(isInside(zipArg.slice('fileb://'.length), world.tmp)).toBe(true)
    if (HAS_UNZIP) expect(zipEntries(world, join(world.log, 'uploaded.zip'))).toContain('index.js')

    // Packaging ran in the temp folder, and the temp folder is cleaned up.
    const ci = npmCalls(world).filter((c) => c.args.startsWith('ci '))
    expect(ci).toHaveLength(1)
    expect(isInside(ci[0].cwd, world.tmp)).toBe(true)
    expect(readdirSync(world.tmp).filter((d) => d.startsWith('parkproof-lambda.'))).toEqual([])
    expectWorkingTreeUntouched(world)

    // The code goes up before the routes and the site, as before.
    const order = calls.map((c) => `${c[0]} ${c[1]}`)
    expect(order.indexOf('lambda update-function-code')).toBeLessThan(order.indexOf('apigatewayv2 get-apis'))
    expect(order.indexOf('apigatewayv2 get-apis')).toBeLessThan(order.indexOf('s3 sync'))
  })

  it('builds with workday mode off, even when .env tries to turn it on', { timeout: TIMEOUT }, () => {
    const world = makeWorld()
    const res = run(world, 'deploy.sh')
    expect(res.status, res.out).toBe(0)
    const builds = npmCalls(world).filter((c) => c.args.startsWith('run build'))
    expect(builds).toHaveLength(1)
    expect(builds[0].flag).toBe('VITE_FEATURE_WORKDAY=false')
    expect(res.stdout).toContain('workday mode: off (VITE_FEATURE_WORKDAY=false')
    expect(res.stdout).toContain('Workday: off')
  })

  it('builds with workday mode on only when the shell that ran it set DEPLOY_ALLOW_WORKDAY=1', { timeout: TIMEOUT }, () => {
    const world = makeWorld()
    const res = run(world, 'deploy.sh', [], { DEPLOY_ALLOW_WORKDAY: '1' })
    expect(res.status, res.out).toBe(0)
    const builds = npmCalls(world).filter((c) => c.args.startsWith('run build'))
    expect(builds.map((b) => b.flag)).toEqual(['VITE_FEATURE_WORKDAY=true'])
    expect(res.stdout).toContain('workday mode: ON')
  })
})

describe.skipIf(!BASH)('setup-jobs-table.sh', () => {
  const policyOf = (call) => JSON.parse(call[call.indexOf('--policy-document') + 1])
  const argOf = (call, flag) => call[call.indexOf(flag) + 1]

  it('adds only dynamodb:DeleteItem on the jobs table to the Lambda role', { timeout: TIMEOUT }, () => {
    const world = makeWorld({ env: false })
    const res = run(world, 'setup-jobs-table.sh')
    expect(res.status, res.out).toBe(0)
    const calls = awsCalls(world)
    expect(calls.map((c) => `${c[0]} ${c[1]}`)).toEqual(['sts get-caller-identity', 'iam put-role-policy'])
    const put = calls[1]
    expect(argOf(put, '--role-name')).toBe('parkproof-lambda-role')
    expect(argOf(put, '--policy-name')).toBe('parkproof-jobs-delete')
    expect(policyOf(put)).toEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'NoticeJobDeleteAfterRead',
          Effect: 'Allow',
          Action: 'dynamodb:DeleteItem',
          Resource: 'arn:aws:dynamodb:ap-southeast-2:123456789012:table/parkproof-jobs',
        },
      ],
    })
    // It writes nothing locally (setup-auth.sh, by contrast, rewrites this file).
    expect(existsSync(join(world.repo, 'scripts', '.aws-resources'))).toBe(false)
    expect(res.stdout).toContain('dynamodb:DeleteItem  allowed')
  })

  it('uses the Lambda\'s JOBS_TABLE name when it is set, and is the same on a re-run', { timeout: TIMEOUT }, () => {
    const world = makeWorld({ env: false })
    expect(run(world, 'setup-jobs-table.sh', [], { JOBS_TABLE: 'parkproof-jobs-b' }).status).toBe(0)
    expect(run(world, 'setup-jobs-table.sh', [], { JOBS_TABLE: 'parkproof-jobs-b' }).status).toBe(0)
    const puts = awsCalls(world).filter((c) => c[1] === 'put-role-policy')
    expect(puts).toHaveLength(2)
    expect(puts[0]).toEqual(puts[1])
    expect(policyOf(puts[0]).Statement[0].Resource).toBe('arn:aws:dynamodb:ap-southeast-2:123456789012:table/parkproof-jobs-b')
  })

  it('changes nothing when it can\'t read the account id', { timeout: TIMEOUT }, () => {
    const world = makeWorld({ env: false })
    const res = run(world, 'setup-jobs-table.sh', [], { FAKE_ACCOUNT: 'None' })
    expect(res.status).toBe(1)
    expect(res.out).toContain("Couldn't read the AWS account id")
    expect(awsCalls(world).map((c) => c[1])).toEqual(['get-caller-identity'])
  })
})

describe.skipIf(!BASH)('setup-log-retention.sh', () => {
  const argOf = (call, flag) => call[call.indexOf(flag) + 1]

  it("sets 90 days on the Lambda's log group, reads it back, and calls nothing else", { timeout: TIMEOUT }, () => {
    const world = makeWorld({ env: false })
    const res = run(world, 'setup-log-retention.sh')
    expect(res.status, res.out).toBe(0)
    const calls = awsCalls(world)
    expect(calls.map((c) => `${c[0]} ${c[1]}`)).toEqual(['logs put-retention-policy', 'logs describe-log-groups'])
    const [put, read] = calls
    // The leading slash survives Git Bash (MSYS_NO_PATHCONV), so the right group is changed.
    expect(argOf(put, '--log-group-name')).toBe('/aws/lambda/parkproof-sign-translator')
    expect(argOf(put, '--retention-in-days')).toBe('90')
    expect(argOf(put, '--region')).toBe('ap-southeast-2')
    expect(argOf(read, '--log-group-name-prefix')).toBe('/aws/lambda/parkproof-sign-translator')
    expect(res.stdout).toContain('keeps log events for 90 days')
    expect(existsSync(join(world.repo, 'scripts', '.aws-resources'))).toBe(false)
  })

  it('fails when the group reports another retention afterwards', { timeout: TIMEOUT }, () => {
    const world = makeWorld({ env: false })
    const res = run(world, 'setup-log-retention.sh', [], { FAKE_RETENTION: 'None' })
    expect(res.status).toBe(1)
    expect(res.out).toContain("reports a retention of 'None' days, not 90")
  })

  it('keeps the number the privacy policy states', () => {
    const text = readFileSync(join(ROOT, 'scripts', 'setup-log-retention.sh'), 'utf8')
    expect(text).toMatch(/^RETENTION_DAYS=90$/m)
    const en = JSON.parse(readFileSync(join(ROOT, 'src', 'locales', 'en.json'), 'utf8'))
    expect(en.privacy.rightsAnonymous).toMatch(/The logs are deleted after 90 days\./)
  })
})

describe('the deploy scripts as committed', () => {
  // Bash can't run a script whose lines end in CR (.gitattributes keeps
  // *.sh LF); and the old in-place packaging must not come back.
  const deploy = readFileSync(join(ROOT, 'scripts', 'deploy.sh'), 'utf8')
  it('keep LF line endings', () => {
    expect(deploy).not.toContain('\r')
    expect(readFileSync(join(ROOT, 'scripts', 'setup-jobs-table.sh'), 'utf8')).not.toContain('\r')
    expect(readFileSync(join(ROOT, 'scripts', 'setup-log-retention.sh'), 'utf8')).not.toContain('\r')
  })
  it('never delete or install lambda/node_modules in the working tree', () => {
    expect(deploy).not.toMatch(/rm -rf node_modules/)
    expect(deploy).not.toMatch(/pushd lambda/)
    expect(deploy).not.toMatch(/fileb:\/\/function\.zip/)
  })
})
