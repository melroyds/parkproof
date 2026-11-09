// @vitest-environment node
//
// scripts/teardown.sh, run for real in bash against a throwaway copy of the
// repo with a fake `aws` (and a fake `sleep`) first on the PATH, in the style
// of deploy-scripts.test.mjs. Nothing here can reach AWS: the fake aws
// answers from a script and logs every call, and the real CLI would find no
// credentials (AWS_CONFIG_FILE and friends point nowhere).
//
// What is checked:
// - With no argument, or anything but --confirm, it's a dry run: it lists
//   what it would delete and makes no call but the account id lookup.
// - Every resource name a setup script, deploy.sh, harden.sh or
//   anthropic-usage-alarm.sh creates is named in teardown.sh, so a new setup
//   script can't add a resource the teardown has never heard of.
// - --confirm, against an account where everything exists, deletes all of
//   it: every parkproof-push-* schedule, each role's inline policies before
//   the role, each bucket's object versions before the bucket, the Cognito
//   domain before the pool, the three tables, the log groups, and the KMS key
//   scheduled for deletion after 7 days (the minimum) before its alias goes.
// - --confirm against an empty account deletes nothing and finishes: each
//   service's own not-found error reads as "nothing to delete".
// - A lookup that fails any other way (here, a missing permission) stops the
//   run at that lookup, says it isn't complete and never says "Teardown
//   complete". A failed list of CloudFront distributions never lets the app
//   bucket be deleted, and neither does a distribution that still uses the
//   bucket as its origin, whatever its comment.
//
// Needs bash (Git Bash on Windows). Skipped with a warning without it.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TIMEOUT = 120_000
const TEARDOWN = readFileSync(join(ROOT, 'scripts', 'teardown.sh'), 'utf8')

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
if (!BASH) console.warn('[teardown] no bash found: skipped the runs')

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
// answers what teardown.sh reads. With FAKE_EMPTY=1 nothing exists, and each
// lookup fails the way AWS CLI v2 does for a missing thing: exit 254 and
// "An error occurred (<code>)" on stderr, with the service's own not-found
// code. FAKE_FAIL="<service> <command>" makes that call fail the way a
// missing permission does. FAKE_STRAY_ORIGIN=1 adds a distribution that its
// comment doesn't find but that still uses the app bucket as its origin.
// Anything it doesn't know is an error, so a new AWS call in teardown.sh
// shows up here.
const FAKE_AWS = String.raw`#!/usr/bin/env bash
{ printf '%s\x1f' "$@"; printf '\x1e'; } >> "$FAKE_LOG/aws.log"
args="$*"
op="$1 $2"
arg() { local want="$1"; shift; while [[ $# -gt 0 ]]; do [[ "$1" == "$want" ]] && { echo "$2"; return; }; shift; done; }
fail_with() { printf '\nAn error occurred (%s) when calling the %s operation: %s\n' "$1" "$op" "$2" >&2; exit 254; }
missing() { fail_with "$1" "not found"; }
empty="${'$'}{FAKE_EMPTY-}"
if [[ "$op" == "${'$'}{FAKE_FAIL-}" ]]; then fail_with AccessDenied "not authorized to perform this action"; fi
case "$op" in
  "sts get-caller-identity") echo "${'$'}{FAKE_ACCOUNT-123456789012}" ;;
  "scheduler list-schedules") [[ -n "$empty" ]] || printf 'parkproof-push-rec1-0\tdefault\nparkproof-push-r-rule1-1\tdefault\n' ;;
  "scheduler get-schedule") [[ -z "$empty" ]] && echo "arn:aws:iam::123456789012:role/hand-made-warmer-role" || missing ResourceNotFoundException ;;
  "scheduler delete-schedule") ;;
  "cloudfront list-distributions")
    if [[ "$args" == *Origins* ]]; then
      # The check before the app bucket goes: what still uses it as an origin.
      if [[ -n "${'$'}{FAKE_STRAY_ORIGIN-}" ]]; then echo E999
      elif [[ -n "$empty" ]]; then echo None
      elif [[ ! -f "$FAKE_LOG/deleted-E123" ]]; then echo E123
      fi
    else
      [[ -n "$empty" ]] && echo None || echo E123
    fi ;;
  "cloudfront get-distribution-config") if [[ "$args" == *ETag* ]]; then echo ETAG1; else echo '{"Enabled": true, "Comment": "parkproof-cdn"}'; fi ;;
  "cloudfront update-distribution"|"cloudfront wait") ;;
  "cloudfront delete-distribution") touch "$FAKE_LOG/deleted-$(arg --id "$@")" ;;
  "cloudfront describe-function") [[ -z "$empty" ]] && echo FETAG || missing NoSuchFunctionExists ;;
  "cloudfront delete-function") ;;
  "cloudfront list-origin-access-controls") [[ -n "$empty" ]] && echo None || echo OAC1 ;;
  "cloudfront get-origin-access-control") echo OETAG ;;
  "cloudfront delete-origin-access-control") ;;
  "s3api head-bucket") [[ -z "$empty" ]] || missing 404 ;;
  "s3api list-object-versions")
    bucket=$(arg --bucket "$@")
    if [[ -f "$FAKE_LOG/emptied-$bucket" ]]; then echo '{}'; else
      touch "$FAKE_LOG/emptied-$bucket"
      echo '{"Versions": [{"Key": "u/a.jpg", "VersionId": "v1", "Size": 3}], "DeleteMarkers": [{"Key": "u/b.jpg", "VersionId": "v2"}]}'
    fi ;;
  "s3api delete-objects")
    f=$(arg --delete "$@"); f="${'$'}{f#file://}"
    cp "$f" "$FAKE_LOG/delete-$(arg --bucket "$@").json"
    echo 0 ;;
  "s3api delete-bucket") ;;
  "apigatewayv2 get-apis") [[ -n "$empty" ]] && echo None || echo api123 ;;
  "apigatewayv2 delete-api") ;;
  "lambda get-function") [[ -z "$empty" ]] || missing ResourceNotFoundException ;;
  "lambda delete-function") ;;
  "logs describe-log-groups") [[ -n "$empty" ]] || printf '/aws/lambda/parkproof-sign-translator\n' ;;
  "logs delete-log-group") ;;
  "cloudwatch describe-alarms") [[ -n "$empty" ]] && echo None || echo parkproof-anthropic-usage ;;
  "cloudwatch delete-alarms") ;;
  "cloudwatch get-dashboard") [[ -z "$empty" ]] || missing ResourceNotFound ;;
  "cloudwatch delete-dashboards") ;;
  "sns get-topic-attributes") [[ -z "$empty" ]] || missing NotFound ;;
  "sns delete-topic") ;;
  "cognito-idp list-user-pools") [[ -n "$empty" ]] && echo None || echo ap-southeast-2_pool1 ;;
  "cognito-idp describe-user-pool") echo parkproof-123456789012 ;;
  "cognito-idp delete-user-pool-domain"|"cognito-idp delete-user-pool") ;;
  "dynamodb describe-table") [[ -z "$empty" ]] || missing ResourceNotFoundException ;;
  "dynamodb delete-table") ;;
  "kms describe-key")
    [[ -z "$empty" ]] || missing NotFoundException
    if [[ "$args" == *KeyState* ]]; then echo Enabled; else echo key-1234; fi ;;
  "kms schedule-key-deletion") echo 2026-11-16T10:00:00+11:00 ;;
  "kms delete-alias") ;;
  "iam get-role") [[ -z "$empty" ]] || missing NoSuchEntity ;;
  "iam list-role-policies")
    case "$(arg --role-name "$@")" in
      parkproof-lambda-role) printf 'parkproof-data-access\tparkproof-kms-sign\tparkproof-jobs-delete\thand-made-jobs\n' ;;
      parkproof-push-scheduler-role) echo parkproof-push-scheduler-invoke ;;
    esac ;;
  "iam list-attached-role-policies")
    if [[ "$(arg --role-name "$@")" == parkproof-lambda-role ]]; then echo arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole; fi ;;
  "iam delete-role-policy"|"iam detach-role-policy"|"iam delete-role") ;;
  *) echo "fake aws: unexpected call: $args" >&2; exit 64 ;;
esac
`

/** A throwaway repo with the real teardown.sh, the fakes and a log folder. */
function makeWorld() {
  const base = mkdtempSync(join(tmpdir(), 'pp-teardown-test-'))
  scratch.push(base)
  const repo = join(base, 'repo')
  const bin = join(base, 'bin')
  const log = join(base, 'log')
  for (const dir of [repo, bin, log]) mkdirSync(dir, { recursive: true })
  script(join(repo, 'scripts', 'teardown.sh'), TEARDOWN)
  script(join(bin, 'aws'), FAKE_AWS)
  // The 5-second pause before deleting, without the wait.
  script(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n')
  return { base, repo, bin, log }
}

/** Runs teardown.sh from the world's repo in bash, with the fakes first on the PATH. */
function run(world, args = [], extraEnv = {}) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^(AWS_|JOBS_TABLE$|MSYS_NO_PATHCONV$|FAKE_)/i.test(key)) delete env[key]
  }
  Object.assign(env, {
    FAKE_BIN: world.bin,
    FAKE_LOG: world.log,
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
  const target = join(world.repo, 'scripts', 'teardown.sh')
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

const argOf = (call, flag) => call[call.indexOf(flag) + 1]
const isDelete = (call) => /^(delete|detach|schedule-key-deletion|update-distribution)/.test(call[1] ?? '')

// ── Names ───────────────────────────────────────────────────────────────
/**
 * The scripts that create AWS resources: every setup-*.sh, deploy.sh,
 * harden.sh (the OAC) and anthropic-usage-alarm.sh (the alarm, its topic and
 * its metric filter).
 */
const CREATORS = [
  ...readdirSync(join(ROOT, 'scripts'))
    .filter((n) => /^setup-.*\.sh$/.test(n))
    .sort(),
  'deploy.sh',
  'harden.sh',
  'anthropic-usage-alarm.sh',
]

// Tokens that look like resource names but aren't: deploy.sh's temp folder
// (parkproof-lambda.XXXXXX) and setup-signing.sh's public key file.
const NOT_RESOURCES = new Set(['parkproof-lambda', 'parkproof-public-key'])

/**
 * Every parkproof-* name in a script, with $PROJECT spelled out. A name that
 * ends in the account id ("$PROJECT-evidence-$ACCOUNT_ID") gives its fixed
 * part, and a pattern ("parkproof-push-*") its prefix.
 */
function namesIn(source) {
  const text = source.replace(/\$\{?PROJECT\}?/g, 'parkproof')
  const names = new Set()
  for (const m of text.matchAll(/\bparkproof-[a-z0-9-]*[a-z0-9]/g)) names.add(m[0])
  for (const n of NOT_RESOURCES) names.delete(n)
  return [...names].sort()
}

describe('teardown.sh as committed', () => {
  it('keeps LF line endings and has no em-dash', () => {
    expect(TEARDOWN).not.toContain('\r')
    expect(TEARDOWN).not.toContain('\u2014')
  })

  it('is a dry run unless the only argument is --confirm', () => {
    expect(TEARDOWN).toMatch(/^CONFIRM="\$\{1:-\}"$/m)
    expect(TEARDOWN).toMatch(/if \[\[ "\$CONFIRM" != "--confirm" \]\]; then\n {2}echo "Dry run, nothing was deleted\."\n(?: {2}.*\n)* {2}exit 0\nfi/)
  })

  it('found the scripts that create resources', () => {
    expect(CREATORS).toEqual(
      expect.arrayContaining(['setup-auth.sh', 'setup-push.sh', 'setup-push-scheduler.sh', 'setup-signing.sh', 'setup-feedback-bucket.sh']),
    )
    expect(namesIn(readFileSync(join(ROOT, 'scripts', 'setup-auth.sh'), 'utf8'))).toEqual(
      expect.arrayContaining(['parkproof-sessions', 'parkproof-evidence', 'parkproof-users', 'parkproof-data-access']),
    )
  })

  it.each(CREATORS)('names every resource %s creates', (name) => {
    const created = namesIn(readFileSync(join(ROOT, 'scripts', name), 'utf8'))
    const named = namesIn(TEARDOWN)
    expect(created.length).toBeGreaterThan(0)
    expect(created.filter((n) => !named.includes(n))).toEqual([])
  })

  it('never reads a failed AWS lookup as "not there"', () => {
    const code = TEARDOWN.split('\n').filter((l) => !/^\s*#/.test(l) && !l.includes('command -v'))
    // No AWS error is thrown away; the one `|| true` is aws_text's, after
    // lookup has already stopped the run on any error but not-found.
    expect(code.filter((l) => /2>\s*\/dev\/null|>\s*\/dev\/null 2>&1|\|\| true/.test(l))).toEqual(['  lookup "$@" || true'])
    expect(TEARDOWN).not.toContain('read_text')
    // Every value lookup in $(…) stops the run when its subshell stopped.
    const valueLookups = TEARDOWN.match(/=\$\(aws_text /g) ?? []
    expect(valueLookups.length).toBeGreaterThan(10)
    expect(TEARDOWN.match(/\) \|\| exit 1$/gm)?.length).toBe(valueLookups.length)
  })

  it('schedules the KMS key for deletion after the minimum 7 days, and says so', () => {
    expect(TEARDOWN).toMatch(/^KMS_WAIT_DAYS=7$/m)
    expect(TEARDOWN).toContain('--pending-window-in-days "$KMS_WAIT_DAYS"')
    expect(TEARDOWN).toMatch(/the shortest wait KMS allows/)
  })
})

describe.skipIf(!BASH)('teardown.sh, run against a fake AWS', () => {
  it('a dry run lists everything and calls nothing but the account id lookup', { timeout: TIMEOUT }, () => {
    const world = makeWorld()
    const res = run(world)
    expect(res.status, res.out).toBe(0)
    expect(res.stdout).toContain('Dry run, nothing was deleted.')
    expect(awsCalls(world).map((c) => `${c[0]} ${c[1]}`)).toEqual(['sts get-caller-identity'])
    for (const name of [
      'parkproof-push-*',
      'parkproof-warmer',
      'parkproof-cdn',
      'parkproof-uri-rewrite',
      'parkproof-oac',
      'parkproof-app-123456789012',
      'parkproof-api',
      'parkproof-jwt',
      'parkproof-sign-translator',
      '/aws/lambda/parkproof-*',
      'parkproof-anthropic-usage',
      'parkproof-cost-alerts',
      'parkproof-launch',
      'parkproof-users',
      'parkproof-spa',
      'parkproof-123456789012',
      'parkproof-sessions',
      'parkproof-push-subscriptions',
      'parkproof-jobs',
      'parkproof-evidence-123456789012',
      'parkproof-user-feedback-123456789012',
      'alias/parkproof-evidence-signing',
      'parkproof-push-scheduler-role',
      'parkproof-lambda-role',
      'parkproof-push-scheduler-invoke',
      'parkproof-jobs-delete',
    ]) {
      expect(res.stdout, name).toContain(name)
    }
    expect(res.stdout).toMatch(/7 days, the shortest wait KMS allows/)
    expect(res.stdout).toMatch(/None of it can be\s+recovered/)
  })

  it('a mistyped --confirm is a dry run too', { timeout: TIMEOUT }, () => {
    const world = makeWorld()
    const res = run(world, ['--confrim'])
    expect(res.status, res.out).toBe(0)
    expect(res.stdout).toContain('Dry run, nothing was deleted.')
    expect(awsCalls(world).filter(isDelete)).toEqual([])
  })

  it('stops before anything when it can\'t read the account id', { timeout: TIMEOUT }, () => {
    const world = makeWorld()
    const res = run(world, ['--confirm'], { FAKE_ACCOUNT: 'None' })
    expect(res.status).toBe(1)
    expect(res.out).toContain("Couldn't read the AWS account id")
    expect(awsCalls(world).map((c) => c[1])).toEqual(['get-caller-identity'])
  })

  it('--confirm deletes everything, each thing after what blocks it', { timeout: TIMEOUT }, () => {
    const world = makeWorld()
    const res = run(world, ['--confirm'])
    expect(res.status, res.out).toBe(0)
    expect(res.stdout).toContain('Teardown complete')
    const calls = awsCalls(world)
    const at = (pred) => calls.findIndex(pred)
    const op = (svc, name) => (c) => c[0] === svc && c[1] === name

    // Every push schedule and the warmer, before the Lambda goes.
    const schedules = calls.filter(op('scheduler', 'delete-schedule')).map((c) => argOf(c, '--name'))
    expect(schedules).toEqual(['parkproof-push-rec1-0', 'parkproof-push-r-rule1-1', 'parkproof-warmer'])
    expect(at(op('scheduler', 'delete-schedule'))).toBeLessThan(at(op('lambda', 'delete-function')))
    expect(res.stdout).toContain('hand-made-warmer-role')

    // CloudFront: disabled, then deleted, then its function.
    expect(at(op('cloudfront', 'update-distribution'))).toBeLessThan(at(op('cloudfront', 'delete-distribution')))
    expect(at(op('cloudfront', 'delete-distribution'))).toBeLessThan(at(op('cloudfront', 'delete-function')))
    expect(argOf(calls.find(op('cloudfront', 'delete-function')), '--name')).toBe('parkproof-uri-rewrite')
    expect(calls.some(op('cloudfront', 'delete-origin-access-control'))).toBe(true)
    expect(existsSync(join(world.repo, 'dist-current.tmp.json'))).toBe(false)

    // Before the app bucket goes, after the distribution: nothing still uses it.
    const originCheck = at((c) => op('cloudfront', 'list-distributions')(c) && argOf(c, '--query').includes('Origins'))
    expect(originCheck).toBeGreaterThan(at(op('cloudfront', 'delete-distribution')))
    expect(originCheck).toBeLessThan(at(op('s3api', 'head-bucket')))

    // Each bucket emptied of every version and delete marker, then deleted.
    const buckets = ['parkproof-app-123456789012', 'parkproof-evidence-123456789012', 'parkproof-user-feedback-123456789012']
    for (const bucket of buckets) {
      const emptied = at((c) => op('s3api', 'delete-objects')(c) && argOf(c, '--bucket') === bucket)
      const deleted = at((c) => op('s3api', 'delete-bucket')(c) && argOf(c, '--bucket') === bucket)
      expect(emptied, bucket).toBeGreaterThan(-1)
      expect(emptied, bucket).toBeLessThan(deleted)
      const batch = JSON.parse(readFileSync(join(world.log, `delete-${bucket}.json`), 'utf8'))
      expect(batch).toEqual({
        Objects: [
          { Key: 'u/a.jpg', VersionId: 'v1' },
          { Key: 'u/b.jpg', VersionId: 'v2' },
        ],
        Quiet: true,
      })
    }
    expect(existsSync(join(world.repo, 'teardown-batch.tmp.json'))).toBe(false)

    expect(argOf(calls.find(op('apigatewayv2', 'delete-api')), '--api-id')).toBe('api123')
    expect(argOf(calls.find(op('lambda', 'delete-function')), '--function-name')).toBe('parkproof-sign-translator')

    // The log group after the Lambda; its leading slash survives Git Bash.
    expect(calls.filter(op('logs', 'delete-log-group')).map((c) => argOf(c, '--log-group-name'))).toEqual([
      '/aws/lambda/parkproof-sign-translator',
    ])
    expect(at(op('lambda', 'delete-function'))).toBeLessThan(at(op('logs', 'delete-log-group')))
    expect(argOf(calls.find(op('cloudwatch', 'delete-alarms')), '--alarm-names')).toBe('parkproof-anthropic-usage')
    expect(argOf(calls.find(op('sns', 'delete-topic')), '--topic-arn')).toBe(
      'arn:aws:sns:ap-southeast-2:123456789012:parkproof-cost-alerts',
    )
    expect(argOf(calls.find(op('cloudwatch', 'delete-dashboards')), '--dashboard-names')).toBe('parkproof-launch')

    // Cognito: the Hosted UI domain, then the pool.
    const domain = calls.find(op('cognito-idp', 'delete-user-pool-domain'))
    expect(argOf(domain, '--domain')).toBe('parkproof-123456789012')
    expect(at(op('cognito-idp', 'delete-user-pool-domain'))).toBeLessThan(at(op('cognito-idp', 'delete-user-pool')))
    expect(argOf(calls.find(op('cognito-idp', 'delete-user-pool')), '--user-pool-id')).toBe('ap-southeast-2_pool1')

    expect(calls.filter(op('dynamodb', 'delete-table')).map((c) => argOf(c, '--table-name'))).toEqual([
      'parkproof-sessions',
      'parkproof-push-subscriptions',
      'parkproof-jobs',
    ])

    // KMS: scheduled for deletion after the minimum 7 days, then the alias.
    const kms = calls.find(op('kms', 'schedule-key-deletion'))
    expect(argOf(kms, '--key-id')).toBe('key-1234')
    expect(argOf(kms, '--pending-window-in-days')).toBe('7')
    expect(at(op('kms', 'schedule-key-deletion'))).toBeLessThan(at(op('kms', 'delete-alias')))
    expect(argOf(calls.find(op('kms', 'delete-alias')), '--alias-name')).toBe('alias/parkproof-evidence-signing')
    expect(res.stdout).toMatch(/after 7 days: the shortest wait KMS allows/)
    expect(res.stdout).toContain('aws kms cancel-key-deletion --key-id key-1234')

    // Roles: every inline policy deleted and every managed one detached first.
    for (const [role, inline] of [
      ['parkproof-push-scheduler-role', ['parkproof-push-scheduler-invoke']],
      ['parkproof-lambda-role', ['parkproof-data-access', 'parkproof-kms-sign', 'parkproof-jobs-delete', 'hand-made-jobs']],
    ]) {
      const forRole = (name) => (c) => op('iam', name)(c) && argOf(c, '--role-name') === role
      const roleDeleted = at(forRole('delete-role'))
      expect(roleDeleted, role).toBeGreaterThan(-1)
      const removed = calls.filter(forRole('delete-role-policy'))
      expect(removed.map((c) => argOf(c, '--policy-name'))).toEqual(inline)
      for (const c of removed) expect(calls.indexOf(c)).toBeLessThan(roleDeleted)
      expect(at(forRole('detach-role-policy'))).toBeLessThan(roleDeleted)
    }
    const detached = calls.filter(op('iam', 'detach-role-policy'))
    expect(detached.map((c) => argOf(c, '--policy-arn'))).toEqual([
      'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    ])
    // The roles go last: nothing after them still needs them.
    expect(at(op('iam', 'delete-role'))).toBeGreaterThan(at(op('kms', 'delete-alias')))
  })

  it('--confirm against an empty account deletes nothing and finishes', { timeout: TIMEOUT }, () => {
    const world = makeWorld()
    const res = run(world, ['--confirm'], { FAKE_EMPTY: '1' })
    expect(res.status, res.out).toBe(0)
    expect(res.stdout).toContain('Teardown complete')
    expect(awsCalls(world).filter(isDelete)).toEqual([])
    expect(res.stdout.match(/nothing to delete/g)?.length).toBeGreaterThan(15)
  })

  // The worst case: a failed CloudFront list read as "no distribution" would
  // skip step 2 and delete the app bucket while the distribution still used
  // it, leaving the bucket's name free for anyone to create and serve from.
  it('keeps the app bucket when the CloudFront list fails', { timeout: TIMEOUT }, () => {
    const world = makeWorld()
    const res = run(world, ['--confirm'], { FAKE_FAIL: 'cloudfront list-distributions' })
    expect(res.status).toBe(1)
    expect(res.out).toContain('An error occurred (AccessDenied)')
    expect(res.out).toContain("Couldn't look up the CloudFront distributions")
    expect(res.out).toContain('Teardown stopped before the end. It is NOT complete.')
    expect(res.stdout).not.toContain('Teardown complete')
    expect(res.stdout).not.toContain('CloudFront: nothing to delete')
    const calls = awsCalls(world)
    expect(calls.filter((c) => c[0] === 's3api')).toEqual([])
    expect(calls.filter((c) => c[0] === 'cloudfront').map((c) => c[1])).toEqual(['list-distributions'])
  })

  it('keeps the app bucket while any distribution still uses it as an origin', { timeout: TIMEOUT }, () => {
    const world = makeWorld()
    const res = run(world, ['--confirm'], { FAKE_EMPTY: '1', FAKE_STRAY_ORIGIN: '1' })
    expect(res.status).toBe(1)
    expect(res.out).toContain('CloudFront distribution E999 still uses parkproof-app-123456789012 as its origin')
    expect(res.stdout).not.toContain('Teardown complete')
    expect(awsCalls(world).filter((c) => c[0] === 's3api')).toEqual([])
  })

  // One of each kind: a list, a get that returns a value, and checks that
  // only ask whether the thing is there (a 403 from head-bucket included).
  it.each([
    ['scheduler list-schedules', 'the push schedules'],
    ['scheduler get-schedule', 'the parkproof-warmer schedule'],
    ['s3api head-bucket', 'the app bucket parkproof-app-123456789012'],
    ['lambda get-function', 'the Lambda parkproof-sign-translator'],
    ['dynamodb describe-table', 'the table parkproof-sessions'],
    ['kms describe-key', 'the KMS key alias/parkproof-evidence-signing'],
    ['iam list-role-policies', 'the inline policies on parkproof-push-scheduler-role'],
  ])('a failed %s stops the run right there', (failing, what) => {
    const world = makeWorld()
    const res = run(world, ['--confirm'], { FAKE_FAIL: failing })
    expect(res.status, res.out).toBe(1)
    expect(res.out).toContain('An error occurred (AccessDenied)')
    expect(res.out).toContain(`Couldn't look up ${what}`)
    expect(res.out).toContain('It is NOT complete.')
    expect(res.stdout).not.toContain('Teardown complete')
    // The failed lookup is the last AWS call: nothing after it ran.
    const calls = awsCalls(world)
    expect(`${calls.at(-1)[0]} ${calls.at(-1)[1]}`).toBe(failing)
    expect(calls.findIndex((c) => `${c[0]} ${c[1]}` === failing)).toBe(calls.length - 1)
  }, TIMEOUT)
})
